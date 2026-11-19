/**
 * Conta meu-bot neste Mac (molde Rambox): "Entrar" abre a página de login no navegador do sistema (Google ou link por
 * e-mail, no Firebase), a página volta por deep link `<esquema>://auth?code&state` (deep-link.ts) e o app troca o
 * code por uma sessão no `POST /token` (PKCE + state, conta-core.ts). A sessão (refresh rotativo + acesso de 1 h + a
 * última cópia da conta) fica cifrada com safeStorage em userData/conta.bin, decifrada uma vez por processo (o diálogo
 * do Chaveiro prende o fio principal: ver conta-google.ts). O login pendente fica em conta-login.json (10 min) para o
 * app poder reabrir no meio. Nesta versão a conta ainda não muda a licença da máquina (ela continua vindo do backend).
 */
import { app, safeStorage, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ContaDaPessoa, ContaView } from "../../shared/ipc";
import { marcar } from "../app/depuracao";
import { broadcast } from "../app/windows";
import { caps, produto } from "../app/variant";
import { esquemaDe } from "../app/variant-core";
import { gravar, temKeychain } from "../google/comum";
import { log } from "../maquina/tunnel";
import { refreshPickerIfOpen, sendToPicker } from "../maquina/picker";
import { parseRetornoAuth } from "./deep-link-core";
import { deviceIdentidade, devicePedido } from "./device";
import { FOTO_MAX, URLS, deveRenovar, erroDaApi, novoLogin, parseContaInfo, parseLoginPendente, parsePrefs, parseSessao, retornoConfere, sessaoAcabou, urlDeLogin, type ContaPrefs, type LoginPendente, type SessaoGuardada, acessoGestao, parseContaDoAdmin, rotaDaContaAdmin, type PistasDaConta } from "./conta-core";

const ARQ = (): string => path.join(app.getPath("userData"), "conta.bin");
const ARQ_LOGIN = (): string => path.join(app.getPath("userData"), "conta-login.json");
/** Preferências da conta em claro (hoje só "dados de uso"): o app precisa delas antes de ter sessão, e "Sair" não as apaga. */
const ARQ_PREFS = (): string => path.join(app.getPath("userData"), "conta-prefs.json");
const urls = (): { auth: string; api: string; console: string } => URLS[produto().canal];
const TEMPO_API_MS = 20_000;

let sessao: SessaoGuardada | null | undefined; // undefined = ainda não lida neste processo
let pendente: LoginPendente | null | undefined;
let erro: string | null = null;
let renovando: Promise<SessaoGuardada | null> | null = null;

function lerSessao(): SessaoGuardada | null {
  if (sessao !== undefined) return sessao;
  const f = ARQ();
  if (!fs.existsSync(f)) { sessao = null; return null; }
  marcar("safeStorage: decifrar conta.bin");
  try {
    const s = parseSessao(JSON.parse(safeStorage.decryptString(fs.readFileSync(f))));
    if (s === null) log("[conta] conta.bin não tem uma sessão válida; ignorado");
    sessao = s;
    if (s !== null) garantirFoto(s);
  } catch (e) { log(`[conta] não decifrou conta.bin: ${e instanceof Error ? e.message : String(e)}`); return null; } // Chaveiro negado: tenta de novo na próxima leitura
  return sessao;
}
function gravarSessao(s: SessaoGuardada): void { sessao = s; gravar(ARQ(), safeStorage.encryptString(JSON.stringify(s))); garantirFoto(s); gravarPrefs({ dadosUso: s.conta.dadosUso }); }
function lerPrefs(): ContaPrefs {
  try { return parsePrefs(JSON.parse(fs.readFileSync(ARQ_PREFS(), "utf8"))); } catch { return parsePrefs(null); }
}
function gravarPrefs(p: ContaPrefs): void {
  if (lerPrefs().dadosUso === p.dadosUso) return;
  try { gravar(ARQ_PREFS(), JSON.stringify(p)); log(`[conta] dados de uso: ${p.dadosUso ? "ligados" : "desligados"}`); } catch (e) { log(`[conta] não gravou conta-prefs.json: ${e instanceof Error ? e.message : String(e)}`); }
}
function apagarSessao(): void { sessao = null; try { fs.rmSync(ARQ(), { force: true }); } catch { /* ok */ } }
function lerPendente(): LoginPendente | null {
  if (pendente === undefined) { try { pendente = parseLoginPendente(JSON.parse(fs.readFileSync(ARQ_LOGIN(), "utf8"))); } catch { pendente = null; } }
  // Os 10 min contam também para o que já está em memória: um login abandonado deixa de ser "entrando" sozinho.
  return pendente === null ? null : parseLoginPendente(pendente);
}
function gravarPendente(p: LoginPendente | null): void {
  pendente = p;
  try { if (p === null) fs.rmSync(ARQ_LOGIN(), { force: true }); else gravar(ARQ_LOGIN(), JSON.stringify(p)); } catch (e) { log(`[conta] não gravou conta-login.json: ${e instanceof Error ? e.message : String(e)}`); }
}

export function contaView(): ContaView {
  const s = lerSessao(), p = lerPendente();
  return { situacao: s !== null ? "dentro" : erro !== null ? "erro" : p !== null ? "entrando" : "fora", conta: s?.conta ?? null, foto: s?.fotoLocal ?? null, erro, keychain: temKeychain(), canal: produto().canal, device: deviceIdentidade().id, urlLogin: urls().auth, urlConsole: urls().console };
}
/** A foto do perfil vem de fora (Google) e a CSP da janela só deixa `data:`: o main baixa uma vez e guarda junto da sessão. */
let fotoBuscando: string | null = null;
function garantirFoto(s: SessaoGuardada): void {
  const url = s.conta.foto;
  if (url === null || s.fotoLocal !== null || fotoBuscando === url) return;
  fotoBuscando = url;
  void (async () => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(TEMPO_API_MS) });
      const tipo = r.headers.get("content-type") ?? "";
      if (!r.ok || !/^image\/(png|jpeg|webp|gif)/.test(tipo)) return;
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length > FOTO_MAX) return;
      const atual = lerSessao();
      if (atual === null || atual.conta.foto !== url) return;
      gravarSessao({ ...atual, fotoLocal: `data:${tipo.split(";")[0]};base64,${bytes.toString("base64")}` });
      avisar();
    } catch (e) { log(`[conta] foto do perfil não veio: ${e instanceof Error ? e.message : String(e)}`); }
    finally { fotoBuscando = null; }
  })();
}
const avisar = (): ContaView => {
  const v = contaView(); broadcast("conta:changed", v); sendToPicker("conta:changed", v);
  // No Gestão a lista de pessoas depende do papel da conta (picker.ts): entrou, saiu ou o papel mudou → o seletor relê.
  if (caps().supportAdmin) refreshPickerIfOpen();
  return v;
};
/** Há sessão guardada neste Mac? É o portão: sem conta, o app só mostra o seletor com o cartão de login. */
export const contaEntrada = (): boolean => lerSessao() !== null;
/**
 * A gestão está aberta para a conta que entrou neste app? Só com papel de admin ou super admin (acessoGestao). É o
 * portão de tudo que o meu-bot-admin-gestao faz nas máquinas das pessoas: handlers (handleAdmin), lista de pessoas e
 * varredura. Vale o papel guardado na sessão, que cada leitura da conta atualiza.
 */
export const gestaoLiberada = (): boolean => acessoGestao(lerSessao()?.conta ?? null) === "ok";
const ouvintesSaida = new Set<() => void>();
/** Quem quer saber quando a sessão acaba (Sair, ou a API a derrubou): o main fecha as janelas e volta ao seletor. */
export function aoSair(cb: () => void): void { ouvintesSaida.add(cb); }
const saiu = (): void => { for (const cb of ouvintesSaida) { try { cb(); } catch (e) { log(`[conta] ao sair: ${e instanceof Error ? e.message : String(e)}`); } } };
const ouvintesRetorno = new Set<() => void>();
/** Qualquer retorno pelo esquema do app (login concluído ou "Abrir o meu-bot" clicado de novo): o main traz o app para a frente. */
export function aoRetorno(cb: () => void): void { ouvintesRetorno.add(cb); }

/** Pedido à API: JSON de ida e volta; `status` 0 = sem resposta (rede, tempo). */
async function api(metodo: "GET" | "POST" | "DELETE", rota: string, corpo: unknown = null, bearer: string | null = null): Promise<{ status: number; corpo: unknown }> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (corpo !== null) headers["content-type"] = "application/json";
  if (bearer !== null) headers.authorization = `Bearer ${bearer}`;
  try {
    const r = await fetch(`${urls().api}${rota}`, { method: metodo, headers, ...(corpo === null ? {} : { body: JSON.stringify(corpo) }), signal: AbortSignal.timeout(TEMPO_API_MS) });
    return { status: r.status, corpo: await r.json().catch(() => null) };
  } catch (e) { return { status: 0, corpo: { erro: `sem resposta da API da conta (${e instanceof Error ? e.name === "TimeoutError" ? "tempo esgotado" : e.message : String(e)})` } }; }
}

/**
 * meu-bot-admin-gestao: manda o resumo de uma janela de suporte para a API (POST /admin/suporte), que o super admin vê
 * no console (/support-window). Só com conta de admin; sem sessão ou sem rede, false e nada mais.
 */
export async function enviarResumoSuporte(corpo: unknown): Promise<boolean> {
  if (lerSessao()?.conta.admin == null) return false;
  const token = await tokenDeAcesso();
  if (token === null) return false;
  const r = await api("POST", "/admin/suporte", corpo, token);
  if (r.status !== 200) log(`[suporte] resumo não foi para o console: HTTP ${r.status}`);
  return r.status === 200;
}

/**
 * meu-bot-admin-gestao: a conta de uma pessoa como o console a mostra (GET /admin/conta), achada pelas pistas que a
 * máquina dela dá. Só com conta de admin. Nunca lança: o que deu errado vai no `estado`.
 */
export async function lerContaDoAdmin(pistas: PistasDaConta): Promise<ContaDaPessoa> {
  const rota = rotaDaContaAdmin(pistas);
  if (rota === null) return { estado: "sem-ligacao" };
  if (lerSessao()?.conta.admin == null) return { estado: "sem-resposta", motivo: "entre com a conta de admin" };
  const token = await tokenDeAcesso();
  if (token === null) return { estado: "sem-resposta", motivo: "a sessão do admin não vale mais: entre de novo" };
  const r = await api("GET", rota, null, token);
  return parseContaDoAdmin(r.status, r.corpo);
}

/** "Entrar": abre a página de login no navegador do sistema e fica esperando o deep link. */
export async function entrar(): Promise<ContaView> {
  erro = null;
  // "Reabrir o navegador": com um login pendente ainda válido, abre a mesma página (mesmo state), sem invalidar a aba anterior.
  const p = lerPendente() ?? novoLogin();
  gravarPendente(p);
  const url = urlDeLogin(urls().auth, { esquema: esquemaDe(produto()), state: p.state, challenge: p.challenge, app: produto().nome, versao: app.getVersion() });
  log(`[conta] login: abrindo ${urls().auth} no navegador (state ${p.state.slice(0, 6)}…)`);
  try { await shell.openExternal(url); } catch (e) { gravarPendente(null); erro = `não abriu o navegador: ${e instanceof Error ? e.message : String(e)}`; }
  return avisar();
}
export function cancelarEntrada(): ContaView { gravarPendente(null); erro = null; return avisar(); }

/** O deep link chegou (app aberto ou recém-aberto por ele): confere o state e troca o code pela sessão. */
let trocando = false;
export async function aoRetornarAuth(url: string): Promise<void> {
  const r = parseRetornoAuth(url, esquemaDe(produto()));
  if (r === null) return;
  for (const cb of ouvintesRetorno) { try { cb(); } catch (e) { log(`[conta] ao voltar: ${e instanceof Error ? e.message : String(e)}`); } }
  // O macOS pode entregar a mesma URL duas vezes (open-url e argv da segunda instância): a segunda cópia é ignorada.
  if (trocando) { log("[conta] retorno do login repetido enquanto o primeiro ainda está sendo trocado; ignorado"); return; }
  trocando = true;
  try { await trocarRetorno(r); } finally { trocando = false; }
}
async function trocarRetorno(r: Exclude<ReturnType<typeof parseRetornoAuth>, null>): Promise<void> {
  if (!r.ok) { erro = r.erro; log(`[conta] retorno do login recusado: ${r.erro}`); avisar(); return; }
  const p = lerPendente();
  if (!retornoConfere(p, r.retorno.state)) { erro = p === null ? "o login demorou mais de 10 min ou não foi pedido por este app; clique em Entrar de novo" : "o retorno não é deste login (state diferente); clique em Entrar de novo"; log(`[conta] retorno do login: ${erro}`); avisar(); return; }
  const resp = await api("POST", "/token", { grant: "code", code: r.retorno.code, verifier: p!.verifier, device: devicePedido(lerPrefs().dadosUso) });
  const s = resp.status === 200 ? parseSessao(resp.corpo) : null;
  if (s === null) { erro = resp.status === 200 ? "a API devolveu uma sessão fora do formato" : erroDaApi(resp.status, resp.corpo); log(`[conta] POST /token falhou (${resp.status}): ${erro}`); avisar(); return; }
  gravarSessao(s); gravarPendente(null); erro = null;
  log(`[conta] entrou: ${s.conta.email} (${s.conta.licenca.plan}, ${s.conta.devices.length} device(s))`);
  avisar();
}

/** Token de acesso válido (renova pelo refresh quando perto de vencer); null = sem sessão (a tela mostra "Entrar"). */
export async function tokenDeAcesso(): Promise<string | null> {
  const s = lerSessao();
  if (s === null) return null;
  if (!deveRenovar(s.expiraEm)) return s.acesso;
  if (renovando === null) renovando = renovar(s).finally(() => { renovando = null; });
  return (await renovando)?.acesso ?? null;
}
async function renovar(s: SessaoGuardada): Promise<SessaoGuardada | null> {
  const resp = await api("POST", "/token", { grant: "refresh", refresh: s.refresh });
  const novo = resp.status === 200 ? parseSessao(resp.corpo) : null;
  if (novo !== null) { gravarSessao({ ...novo, fotoLocal: novo.conta.foto === s.conta.foto ? s.fotoLocal : null }); erro = null; avisar(); return novo; }
  if (sessaoAcabou(resp.status)) { apagarSessao(); erro = erroDaApi(resp.status, resp.corpo); log(`[conta] sessão acabou: ${erro}`); avisar(); saiu(); return null; }
  log(`[conta] renovar falhou (${resp.status}): ${erroDaApi(resp.status, resp.corpo)}; a sessão continua até a próxima tentativa`);
  return s; // rede ou API fora: o acesso guardado ainda pode valer
}
/** Relê a conta na API (plano, devices, pedidos) e guarda a cópia; sem rede devolve o que estava. */
export async function atualizarConta(): Promise<ContaView> {
  const tok = await tokenDeAcesso();
  const s = lerSessao();
  if (tok === null || s === null) return contaView();
  const resp = await api("GET", "/conta", null, tok);
  if (resp.status === 200) { const c = parseContaInfo(resp.corpo); if (c !== null) { gravarSessao({ ...s, conta: c, fotoLocal: c.foto === s.conta.foto ? s.fotoLocal : null }); erro = null; } }
  else if (sessaoAcabou(resp.status)) { apagarSessao(); erro = erroDaApi(resp.status, resp.corpo); log(`[conta] sessão acabou: ${erro}`); avisar(); saiu(); }
  else log(`[conta] GET /conta falhou (${resp.status}): ${erroDaApi(resp.status, resp.corpo)}`);
  return avisar();
}
/** Resposta das rotas `/conta/maquinas`: o arquivo assinado, ou o erro (com as máquinas que ocupam a vaga, se for isso). */
export type LicencaDaApi = { ok: true; arquivo: unknown } | { ok: false; status: number; erro: string; ocupadas: string[] };
async function pedirLicenca(rota: string, corpo: unknown): Promise<LicencaDaApi> {
  const tok = await tokenDeAcesso();
  if (tok === null) return { ok: false, status: 401, erro: "entre na sua conta meu-bot para usar a licença dela aqui", ocupadas: [] };
  const r = await api("POST", rota, corpo, tok);
  const c = r.corpo !== null && typeof r.corpo === "object" ? (r.corpo as { licenca?: unknown; ocupadas?: unknown }) : {};
  if (r.status === 200 && c.licenca !== null && typeof c.licenca === "object") { void atualizarConta(); return { ok: true, arquivo: c.licenca }; }
  const ocupadas = Array.isArray(c.ocupadas) ? c.ocupadas.map((m) => (m !== null && typeof m === "object" ? (m as { apelido?: unknown; id?: unknown }) : {})).map((m) => (typeof m.apelido === "string" && m.apelido !== "" ? m.apelido : typeof m.id === "string" ? `máquina ${m.id.slice(0, 8)}` : "outra máquina")) : [];
  return { ok: false, status: r.status, erro: erroDaApi(r.status, r.corpo), ocupadas };
}
/** `POST /conta/maquinas`: vincula a máquina (uuid do maquina.json dela) à conta e devolve o licenca-conta.json assinado. */
export const licencaParaMaquina = (id: string, apelido: string | null): Promise<LicencaDaApi> => pedirLicenca("/conta/maquinas", { id, apelido });
/** `POST /conta/maquinas/:id/licenca`: emite de novo para uma máquina já vinculada (404 = não é mais desta conta). */
export const renovarLicencaDaMaquina = (id: string): Promise<LicencaDaApi> => pedirLicenca(`/conta/maquinas/${id}/licenca`, {});
/** `DELETE /conta/maquinas/:id`: `apagada` = o app já apagou o arquivo da máquina, então a vaga abre na hora. */
export async function tirarLicencaDaMaquina(id: string, apagada: boolean): Promise<{ ok: boolean; erro: string }> {
  const tok = await tokenDeAcesso();
  if (tok === null) return { ok: false, erro: "entre na sua conta meu-bot" };
  const r = await api("DELETE", `/conta/maquinas/${id}`, { apagada }, tok);
  void atualizarConta();
  return r.status === 200 || r.status === 404 ? { ok: true, erro: "" } : { ok: false, erro: erroDaApi(r.status, r.corpo) };
}
/**
 * Papel da conta confirmado pelo servidor AGORA (GET /conta com resposta 200): o que libera uma ação só de super
 * admin. O papel guardado no conta.bin não basta: pode estar velho (rebaixado no console) e não tem assinatura.
 * Sem sessão, sem rede ou com a API fora: null, e a ação não acontece.
 */
export async function papelConfirmado(): Promise<{ email: string; admin: "super" | "admin" | null } | null> {
  const tok = await tokenDeAcesso();
  const s = lerSessao();
  if (tok === null || s === null) return null;
  const resp = await api("GET", "/conta", null, tok);
  if (resp.status !== 200) return null;
  const c = parseContaInfo(resp.corpo);
  if (c === null) return null;
  gravarSessao({ ...s, conta: c, fotoLocal: c.foto === s.conta.foto ? s.fotoLocal : null }); avisar();
  return { email: c.email, admin: c.admin };
}
/**
 * Perfil / Plano / Devices do menu: abre o console no navegador já entrado. Com sessão, pede à API um código de uso
 * único (60 s) preso a um PKCE novo e abre `<console><caminho>#code&verifier`; o console troca no POST /token. Sem
 * sessão (ou API fora), abre o caminho puro e o console pede o login.
 */
export async function abrirConsole(caminho: string): Promise<void> {
  const c = /^\/[A-Za-z0-9/_-]{0,80}$/.test(caminho) ? caminho : "/account/overview";
  const base = `${urls().console}${c}`;
  const tok = await tokenDeAcesso();
  if (tok !== null) {
    const p = novoLogin();
    const resp = await api("POST", "/sessao/console", { challenge: p.challenge, state: p.state }, tok);
    const code = resp.status === 200 && resp.corpo !== null && typeof resp.corpo === "object" ? (resp.corpo as { code?: unknown }).code : undefined;
    if (typeof code === "string") { await shell.openExternal(`${base}#code=${encodeURIComponent(code)}&verifier=${encodeURIComponent(p.verifier)}`); return; }
    log(`[conta] console: a API não deu o código (${resp.status}: ${erroDaApi(resp.status, resp.corpo)}); abrindo sem sessão`);
  }
  await shell.openExternal(base);
}

/** "Sair": encerra a família de sessões na API (melhor esforço) e apaga a cópia local. */
export async function sair(): Promise<ContaView> {
  const s = lerSessao();
  if (s !== null) { const resp = await api("POST", "/sessao/sair", {}, s.acesso); if (resp.status !== 200) log(`[conta] sair: a API respondeu ${resp.status} (${erroDaApi(resp.status, resp.corpo)}); a cópia local sai mesmo assim`); }
  apagarSessao(); gravarPendente(null); erro = null;
  log("[conta] saiu");
  avisar();
  saiu();
  // Como o Rambox: sair já abre a página de login no navegador (trocar de conta é o caso comum); o seletor fica no
  // portão "aguardando", com Cancelar.
  return entrar();
}
