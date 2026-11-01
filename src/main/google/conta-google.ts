/**
 * Conta Google de cada máquina (login + Gmail + Agenda + Sheets + Drive), separada do token de Contatos do CRM
 * (google-contatos.bin): mesmo fluxo oficial de app de desktop (loopback 127.0.0.1 + PKCE + authorization code), o
 * refresh token cifrado com safeStorage (Keychain) em userData/google-conta/<máquina>.bin e nunca sai do Mac. Cada VM
 * entra com a própria conta (26/10: a VM da LV mostrava a conta do dono). O token antigo, único do Mac
 * (userData/google-conta.bin), não vale sozinho em máquina nenhuma: a tela oferece "usar a conta que já estava neste
 * Mac" (adotarContaDoMac), que copia para a máquina da janela por escolha explícita. A verificação de
 * telefone/QR, quando o Google pede, é feita pela pessoa na tela oficial; o app só recebe o token.
 */
import { app, shell } from "electron";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { safeStorage } from "electron";
import { marcar } from "../app/depuracao";
import { log } from "../maquina/tunnel";
import { browserAsk, browserWebContents, reservarRetornoLocal } from "../navegador/browser";
import { ESCOPOS_CONTA, ESCOPOS_PEDIDOS, GMAIL_MODIFY, URL_TOKEN, parseIdToken, refreshRecusadoDeVez, temEscopo, temTodosEscopos, urlDeAutorizacao, type PerfilGoogle } from "./google-core";
import { acessoDeRefresh, clienteConta, clienteContaOrigem, gravar, postForm, temKeychain } from "./comum";

export interface GoogleContaStatus { configurado: boolean; conectado: boolean; conectando: boolean; /** Máquina a que esta conta pertence (cada VM tem a sua). */ maquina: string; /** E-mail da conta antiga, única do Mac, que pode ser adotada nesta máquina; null = não há. */ contaDoMac: string | null; precisaReconectar: boolean; /** A autorização inclui gmail.modify (lixeira do Gmail). */ gmailEscreve: boolean; perfil: PerfilGoogle | null; escopos: string[]; cliente: { projeto: string; origem: string } | null; busca?: string | null }
const sanitHost = (h: string): string => (h || "sem-maquina").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
const DIR = (): string => path.join(app.getPath("userData"), "google-conta");
const ARQ = (host: string): string => path.join(DIR(), `${sanitHost(host)}.bin`);
/** O token único de antes (um por Mac): só lido para oferecer a adoção explícita. */
const ARQ_DO_MAC = (): string => path.join(app.getPath("userData"), "google-conta.bin");
interface Guardado { refresh: string; perfil: PerfilGoogle | null; escopo: string }
function lerToken(host: string): Guardado | null { return lerArq(ARQ(host)); }
/**
 * Decifrado uma vez por arquivo (31 out): `safeStorage.decryptString` é síncrono e, com o diálogo do Chaveiro na tela,
 * prende o fio principal do app inteiro; `contaStatus` roda a cada sonda do socket do Gmail, então decifrar sempre era
 * um pedido de senha atrás do outro. Arquivo ausente também fica lembrado (null); gravar ou apagar invalida. Falha ao
 * decifrar (Chaveiro negado) não entra no cache: a próxima leitura tenta de novo.
 */
const decifrados = new Map<string, Guardado | null>();
function lerArq(arq: string): Guardado | null {
  const lembrado = decifrados.get(arq);
  if (lembrado !== undefined) return lembrado;
  if (!fs.existsSync(arq)) { decifrados.set(arq, null); return null; }
  marcar(`safeStorage: decifrar ${path.basename(arq)}`);
  const r = decifrarArq(arq);
  if (r !== null) decifrados.set(arq, r);
  return r;
}
function decifrarArq(arq: string): Guardado | null {
  try {
    const j = JSON.parse(safeStorage.decryptString(fs.readFileSync(arq))) as Partial<Guardado>;
    if (typeof j.refresh !== "string") return null;
    const p = (j.perfil ?? null) as PerfilGoogle | null;
    // Tokens gravados antes do cache da foto nao tem `fotoLocal`: aqui ela vira null explicito, nao undefined.
    const perfil = p === null ? null : { ...p, fotoLocal: typeof p.fotoLocal === "string" ? p.fotoLocal : null };
    return { refresh: j.refresh, perfil, escopo: typeof j.escopo === "string" ? j.escopo : "" };
  } catch { return null; }
}
const conectando = new Set<string>();
/** Teto da foto de perfil guardada em data URL; um avatar do Google fica muito abaixo disso. */
const FOTO_MAX = 512 * 1024;
const TIPO_FOTO = /^image\/(png|jpeg|webp|gif)$/;

/**
 * Baixa a foto de perfil aqui no main e devolve data URL. A tela roda com `img-src 'self' data:`, entao a URL do
 * googleusercontent seria bloqueada; baixando aqui a imagem aparece e o renderer continua sem falar com o Google.
 * Falha vira null: o perfil sem foto e um estado normal, nao um erro de login.
 */
async function baixarFoto(url: string): Promise<string | null> {
  try {
    if (new URL(url).protocol !== "https:") return null;
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) return null;
    const tipo = (r.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!TIPO_FOTO.test(tipo)) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length === 0 || bytes.length > FOTO_MAX) return null;
    return `data:${tipo};base64,${bytes.toString("base64")}`;
  } catch { return null; }
}
const comFoto = async (p: PerfilGoogle | null): Promise<PerfilGoogle | null> =>
  p === null || p.foto === null ? p : { ...p, fotoLocal: await baixarFoto(p.foto) };

/** Uma tentativa por (conta, URL) enquanto o app vive: sem foto a tela so fica sem avatar, nao vale repetir em loop. */
const fotoTentada = new Set<string>();
/**
 * Completa a foto de quem ja estava conectado antes deste cache (ou quando o download falhou no login). Devolve o
 * status novo so quando realmente gravou, para o chamador avisar as telas; null quando nao havia o que fazer.
 */
export async function garantirFotoPerfil(host: string): Promise<GoogleContaStatus | null> {
  const t = lerToken(host);
  if (t === null || t.perfil === null || t.perfil.foto === null || t.perfil.fotoLocal !== null) return null;
  const chave = `${t.perfil.sub} ${t.perfil.foto}`;
  if (fotoTentada.has(chave)) return null;
  fotoTentada.add(chave);
  const fotoLocal = await baixarFoto(t.perfil.foto);
  if (fotoLocal === null) return null;
  const atual = lerToken(host);
  // Desconectou ou reconectou durante o download: o token de agora manda, nao reescreve por cima.
  if (atual === null || atual.perfil === null || atual.refresh !== t.refresh || atual.perfil.fotoLocal !== null) return null;
  decifrados.delete(ARQ(host)); gravar(ARQ(host), safeStorage.encryptString(JSON.stringify({ ...atual, perfil: { ...atual.perfil, fotoLocal } })));
  return contaStatus(host);
}
/** Access token em cache (expira antes da hora real, com folga), para não trocar o refresh a cada chamada. */
const cache = new Map<string, { acesso: string; expira: number }>();

export function contaStatus(host: string): GoogleContaStatus {
  const t = lerToken(host);
  const doMac = t === null ? lerArq(ARQ_DO_MAC()) : null;
  const c = clienteContaOrigem();
  return { configurado: c !== null, conectado: t !== null, conectando: conectando.has(host), maquina: host, contaDoMac: doMac?.perfil?.email ?? (doMac !== null ? "(conta sem e-mail)" : null), precisaReconectar: t !== null && !temTodosEscopos(t.escopo, ESCOPOS_CONTA), gmailEscreve: t !== null && temEscopo(t.escopo, GMAIL_MODIFY), perfil: t?.perfil ?? null, escopos: t ? t.escopo.split(/\s+/).filter(Boolean) : [], cliente: c === null ? null : { projeto: c.projeto, origem: c.origem } };
}

export async function contaConectar(host: string): Promise<GoogleContaStatus> {
  const c = clienteConta(); if (c === null) throw new Error("o app ainda não tem o client OAuth do Google (google-conta-oauth.json ou google-oauth.json)");
  if (!temKeychain()) throw new Error("este Mac não tem o Keychain disponível para guardar a autorização");
  if (!conectando.has(host)) {
    conectando.add(host);
    void fluxo(host, c).catch((e: unknown) => log(`[google conta] login não concluído: ${e instanceof Error ? e.message : String(e)}`)).finally(() => conectando.delete(host));
  }
  return contaStatus(host);
}
async function fluxo(host: string, c: { clientId: string; clientSecret: string }): Promise<void> {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = (await import("node:crypto")).createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  const codigo = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/oauth") { res.writeHead(404); res.end(); return; }
      const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>meu-bot</title><body style="font:16px system-ui;padding:40px">${ok ? "✅ Conta Google conectada. Pode fechar esta aba e voltar ao meu-bot." : "❌ Não foi possível conectar. Volte ao meu-bot e tente de novo."}</body>`);
      clearTimeout(timer); srv.close();
      // `access_denied` não é só "a pessoa recusou": o Google manda o mesmo quando o projeto está em
      // modo Teste e o e-mail não é testador. Dizer só "você não autorizou" manda procurar no lugar errado.
      if (ok) resolve({ code: u.searchParams.get("code") as string, redirect });
      else reject(new Error(u.searchParams.get("error") === "access_denied" ? "o Google recusou: ou você não autorizou, ou este e-mail não tem acesso ao projeto do Google Cloud (app em modo Teste só aceita testadores aprovados)" : "retorno inválido do Google"));
    });
    let redirect = "";
    const timer = setTimeout(() => { srv.close(); reject(new Error("o login do Google não foi concluído em 5 minutos")); }, 5 * 60_000);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address(); const port = typeof a === "object" && a !== null ? a.port : 0;
      srv.on("close", reservarRetornoLocal(port)); // o retorno deste loopback é local (Mac), não entrega por SSH
      redirect = `http://127.0.0.1:${port}/oauth`;
      const url = urlDeAutorizacao({ clientId: c.clientId, redirect, challenge, state, scope: ESCOPOS_PEDIDOS.join(" ") });
      const navAberto = browserWebContents(host).some((w) => { try { return w.getURL().startsWith("http"); } catch { return false; } });
      if (!navAberto || !browserAsk(host, { kind: "new-tab", url })) void shell.openExternal(url);
    });
  });
  const tok = await postForm(URL_TOKEN, { code: codigo.code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: codigo.redirect, grant_type: "authorization_code", code_verifier: verifier });
  if (typeof tok["refresh_token"] !== "string") throw new Error("o Google não devolveu a autorização permanente; tente conectar de novo");
  const perfil = await comFoto(parseIdToken(tok["id_token"]));
  fs.mkdirSync(DIR(), { recursive: true, mode: 0o700 });
  decifrados.delete(ARQ(host)); gravar(ARQ(host), safeStorage.encryptString(JSON.stringify({ refresh: tok["refresh_token"], perfil, escopo: typeof tok["scope"] === "string" ? tok["scope"] : "" })));
  cache.delete(host);
  log(`[google conta] ${host}: conectada (${perfil?.email ?? "conta sem e-mail"})`);
}

/**
 * A mesma conta Google está em uso em outra máquina (ou no token antigo do Mac)? Revogar no Google derruba a autorização
 * do app para a CONTA inteira (todas as máquinas que entraram com ela), então só se revoga quando esta é a última.
 * Compara pela conta (sub do id_token) e, sem perfil, pelo próprio refresh.
 */
function contaEmUsoEmOutra(t: Guardado, exceto: string): boolean {
  const outros: string[] = [ARQ_DO_MAC()];
  try { for (const f of fs.readdirSync(DIR())) if (f.endsWith(".bin")) outros.push(path.join(DIR(), f)); } catch { /* sem pasta */ }
  return outros.some((f) => { if (f === exceto) return false; const o = lerArq(f); return o !== null && (o.refresh === t.refresh || (t.perfil?.sub !== undefined && o.perfil?.sub === t.perfil.sub)); });
}
export async function contaDesconectar(host: string): Promise<GoogleContaStatus> {
  const t = lerToken(host);
  if (t && !contaEmUsoEmOutra(t, ARQ(host))) { try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh)}`, { method: "POST" }); } catch { /* cortesia */ } }
  try { decifrados.delete(ARQ(host)); fs.rmSync(ARQ(host), { force: true }); } catch { /* ok */ }
  cache.delete(host); log(`[google conta] ${host}: desconectada`);
  return contaStatus(host);
}
/**
 * Usa nesta máquina a conta que estava conectada no Mac antes de a conta ser por máquina (escolha explícita na tela).
 * Testa o refresh antes de copiar: um token antigo já revogado era copiado, a tela dizia "conectada" e o primeiro uso
 * (backup no Drive) apagava em silêncio; ao reabrir o app o botão voltava. Revogado, o token antigo é apagado também,
 * para a tela parar de oferecê-lo e pedir o login de novo.
 */
export async function adotarContaDoMac(host: string): Promise<GoogleContaStatus> {
  const t = lerArq(ARQ_DO_MAC());
  if (t === null) throw new Error("não há conta antiga neste Mac para usar");
  const c = clienteConta(); if (c === null) throw new Error("o app ainda não tem o client OAuth do Google (google-conta-oauth.json ou google-oauth.json)");
  try { await acessoDeRefresh(c, t.refresh); } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/invalid_grant|revoked|expired/i.test(msg)) throw e;
    try { decifrados.delete(ARQ_DO_MAC()); fs.rmSync(ARQ_DO_MAC(), { force: true }); } catch { /* ok */ }
    log(`[google conta] ${host}: conta antiga do Mac (${t.perfil?.email ?? "sem e-mail"}) revogada no Google; apagada`);
    throw new Error(`a autorização antiga de ${t.perfil?.email ?? "conta"} não vale mais (o Google revogou); use "Entrar com Google" para conectar de novo`);
  }
  fs.mkdirSync(DIR(), { recursive: true, mode: 0o700 });
  decifrados.delete(ARQ(host)); gravar(ARQ(host), safeStorage.encryptString(JSON.stringify(t)));
  cache.delete(host); log(`[google conta] ${host}: usando a conta que já estava no Mac (${t.perfil?.email ?? "sem e-mail"})`);
  return contaStatus(host);
}

/** access token válido para as APIs; renova pelo refresh quando o cache venceu. Refresh recusado de vez (revogado, vencido ou de outro client) apaga o token. */
export async function acessoValido(host: string): Promise<string> {
  const t = lerToken(host); const c = clienteConta();
  if (t === null || c === null) throw new Error("GOOGLE_CONTA_DESCONECTADA");
  const em = cache.get(host); if (em !== undefined && em.expira > Date.now()) return em.acesso;
  try {
    const acesso = await acessoDeRefresh(c, t.refresh);
    cache.set(host, { acesso, expira: Date.now() + 50 * 60_000 });
    return acesso;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (refreshRecusadoDeVez(msg)) {
      try { decifrados.delete(ARQ(host)); fs.rmSync(ARQ(host), { force: true }); } catch { /* ok */ }
      cache.delete(host);
      // Antes isto era silencioso: a janela seguia "conectada" e o log não dizia por quê. Agora o motivo do Google fica
      // registrado e quem ouve (ipc/shared.ts) manda google-conta:changed e para o agente do Gmail.
      log(`[google conta] ${host}: o Google recusou renovar a autorização de ${t.perfil?.email ?? "conta sem e-mail"} (${msg}); token apagado, é preciso entrar de novo`);
      for (const cb of desconectadaListeners) { try { cb(host, msg); } catch { /* ouvinte não derruba o pedido */ } }
      throw new Error("GOOGLE_CONTA_DESCONECTADA");
    }
    throw e;
  }
}
/** Quem quer saber que o token de uma máquina foi apagado por refresh recusado (registrado em ipc/shared.ts: evita o ciclo com gmail-api). */
const desconectadaListeners = new Set<(host: string, motivo: string) => void>();
export function onContaDesconectada(cb: (host: string, motivo: string) => void): void { desconectadaListeners.add(cb); }
