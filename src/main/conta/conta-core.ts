/**
 * Conta meu-bot, a parte pura (sem Electron, testável): endereços por canal, o login pendente (state + PKCE, como
 * `pkce()` de src/main/google/google-core.ts), a URL da página, o que a API devolve e o que o app guarda. Tudo que
 * vem da API ou do disco passa por um parse: dado, nunca comando. O lado de fora é conta-api/ (Cloudflare Worker).
 */
import { createHash, randomBytes } from "node:crypto";
import type { Canal } from "../app/variant-core";
import type { ContaAddonPago, ContaDaPessoa, ContaDevice, ContaInfo, ContaMaquina, ContaOrg, ContaPerfil, AtribuirMaquinaResultado } from "../../shared/ipc";
import { DEVICE_ID_RE, parseLicense, UUID_RE } from "../licenca/licenca";

/** Página de login e API, por canal: o staging nunca fala com a produção (conta e D1 separados). */
export const URLS: Record<Canal, { auth: string; api: string; console: string }> = {
  estavel: { auth: "https://auth.agentesgrok.com", api: "https://conta.agentesgrok.com", console: "https://console.agentesgrok.com" },
  staging: { auth: "https://auth-staging.agentesgrok.com", api: "https://conta-staging.agentesgrok.com", console: "https://console-staging.agentesgrok.com" },
};
/** Code do deep link e `state`: 32 bytes em base64url (43 caracteres), como TOKEN_RE do Worker. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
/** Quanto tempo o login no navegador pode levar; depois disso o retorno é recusado e a pessoa entra de novo. */
export const LOGIN_PENDENTE_MS = 10 * 60 * 1000;
/** Renova o token de acesso quando faltam menos de 5 min (ele vale 1 h). */
export const RENOVAR_ANTES_MS = 5 * 60 * 1000;

export interface LoginPendente { state: string; verifier: string; challenge: string; em: string }
/** State + PKCE S256 novos para um login. */
export function novoLogin(now: number = Date.now()): LoginPendente {
  const verifier = randomBytes(48).toString("base64url");
  return { state: randomBytes(32).toString("base64url"), verifier, challenge: createHash("sha256").update(verifier).digest("base64url"), em: new Date(now).toISOString() };
}
/** O login pendente gravado em disco (o app pode reabrir no meio): válido se inteiro e com menos de 10 min. */
export function parseLoginPendente(raw: unknown, now: number = Date.now()): LoginPendente | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.state !== "string" || !TOKEN_RE.test(r.state) || typeof r.verifier !== "string" || !VERIFIER_RE.test(r.verifier) || typeof r.challenge !== "string" || !TOKEN_RE.test(r.challenge) || typeof r.em !== "string") return null;
  const em = Date.parse(r.em);
  if (Number.isNaN(em) || now - em > LOGIN_PENDENTE_MS || em > now + 60_000) return null;
  return { state: r.state, verifier: r.verifier, challenge: r.challenge, em: r.em };
}
/** URL da página de login com o que a página devolve no `POST /sessao` (esquema do deep link, state, challenge, app e versão). */
export function urlDeLogin(auth: string, p: { esquema: string; state: string; challenge: string; app: string; versao: string }): string {
  const q = new URLSearchParams({ esquema: p.esquema, state: p.state, challenge: p.challenge, app: p.app, v: p.versao });
  return `${auth}/entrar?${q.toString()}`;
}

/** O que o app guarda cifrado (conta.bin): a sessão e a última cópia da conta. É o mesmo formato que `POST /token` devolve. */
export interface SessaoGuardada { refresh: string; acesso: string; expiraEm: string; conta: ContaInfo; /** Foto do perfil em data URL (a CSP da janela não deixa carregar de fora); null = não buscada ou sem foto. */ fotoLocal: string | null }
/** Teto da foto guardada em data URL; um avatar do Google fica bem abaixo. */
export const FOTO_MAX = 512 * 1024;
export const fotoLocalOk = (v: unknown): v is string => typeof v === "string" && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= FOTO_MAX * 1.4;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strOuNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const iso = (v: unknown): string | null => (typeof v === "string" && ISO_RE.test(v) ? v : null);

function parseDevice(raw: unknown): ContaDevice | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (id === null || !DEVICE_ID_RE.test(id)) return null;
  const apps: ContaDevice["apps"] = {};
  if (r.apps !== null && typeof r.apps === "object") for (const [k, v] of Object.entries(r.apps as Record<string, unknown>)) { const a = v as Record<string, unknown> | null; if (a !== null && typeof a === "object" && typeof a.version === "string" && typeof a.lastSeen === "string") apps[k] = { version: a.version, lastSeen: a.lastSeen }; }
  return { id, alias: strOuNull(r.alias), name: str(r.name) ?? "", user: str(r.user) ?? "", platform: str(r.platform) ?? "", status: r.status === "pending" ? "pending" : "active", requestedAt: strOuNull(r.requestedAt), firstSeen: str(r.firstSeen) ?? "", lastSeen: str(r.lastSeen) ?? "", apps, este: r.este === true };
}
function parseMaquina(raw: unknown): ContaMaquina | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (id === null || !UUID_RE.test(id)) return null;
  const data = (v: unknown): string | null => { const t = strOuNull(v); return t !== null && !Number.isNaN(Date.parse(t)) ? t : null; };
  return { id, apelido: strOuNull(r.apelido), vinculadaPor: str(r.vinculadaPor) ?? "", proAte: data(r.proAte), desvinculadaEm: data(r.desvinculadaEm) };
}
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
function parseOrg(raw: unknown): ContaOrg | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id), slug = str(r.slug), nome = strOuNull(r.nome);
  if (id === null || !UUID_RE.test(id) || slug === null || !SLUG_RE.test(slug) || nome === null) return null;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return { id, slug, nome, papel: r.papel === "dona" || r.papel === "admin" ? r.papel : "membro", membros: n(r.membros), assentos: n(r.assentos) };
}
/**
 * Modo instagramável: os nomes que os cursores levam, de `GET /orgs/:slug` (`OrgApi.membros`). Só membros ativos e só
 * o primeiro nome (a tela vai parar em print e vídeo: e-mail nunca); quem não tem nome fica de fora. Lixo → [].
 */
export function parseNomesDaOrg(raw: unknown): string[] {
  const membros = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>).membros : null;
  if (!Array.isArray(membros)) return [];
  const nomes: string[] = [];
  for (const m of membros) {
    if (m === null || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const primeiro = r.status === "ativo" ? strOuNull(r.nome)?.trim().split(/\s+/)[0] ?? "" : "";
    if (primeiro !== "" && !primeiro.includes("@")) nomes.push(primeiro.slice(0, 24));
  }
  return nomes;
}
const PROVEDOR_RE = /^(google\.com|password|emailLink)$/;
/** O perfil editável, campo a campo; o que não vier (API antiga) fica null. */
export function parsePerfil(raw: unknown): ContaPerfil {
  const r = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { nomeProprio: strOuNull(r.nomeProprio), sobrenome: strOuNull(r.sobrenome) };
}
/**
 * A conta como a API devolve; null se faltar o essencial (id, e-mail). A licença passa pelo mesmo parse da máquina; o
 * `semPrazo` (Pro sem prazo do super admin) é só da licença da conta, então é lido aqui e não no parse da máquina.
 */
export function parseContaInfo(raw: unknown, now: number = Date.now()): ContaInfo | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id), email = str(r.email);
  if (id === null || !UUID_RE.test(id) || email === null || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const foto = strOuNull(r.foto);
  return {
    id, email: email.toLowerCase(), nome: strOuNull(r.nome), nomeLogin: strOuNull(r.nomeLogin), foto: foto !== null && /^https:\/\//.test(foto) ? foto : null,
    perfil: parsePerfil(r.perfil),
    provedores: Array.isArray(r.provedores) ? r.provedores.filter((p): p is string => typeof p === "string" && PROVEDOR_RE.test(p)) : [],
    dadosUso: r.dadosUso !== false,
    admin: r.admin === "super" || r.admin === "admin" ? r.admin : null,
    licenca: { ...parseLicense(r.licenca, now), ...((r.licenca as { semPrazo?: unknown } | null)?.semPrazo === true ? { semPrazo: true as const } : {}) },
    devices: Array.isArray(r.devices) ? r.devices.map(parseDevice).filter((d): d is ContaDevice => d !== null) : [],
    maquinas: Array.isArray(r.maquinas) ? r.maquinas.map(parseMaquina).filter((m): m is ContaMaquina => m !== null) : [],
    maquinaLimite: typeof r.maquinaLimite === "number" && Number.isInteger(r.maquinaLimite) && r.maquinaLimite >= 1 ? r.maquinaLimite : null,
    pedidos: typeof r.pedidos === "number" && Number.isFinite(r.pedidos) && r.pedidos >= 0 ? Math.floor(r.pedidos) : 0,
    orgs: Array.isArray(r.orgs) ? r.orgs.map(parseOrg).filter((o): o is ContaOrg => o !== null) : [],
  };
}
/** conta-prefs.json (em claro, sobrevive ao "Sair"): o que o app precisa saber antes de ter sessão. Hoje só `dadosUso`. */
export interface ContaPrefs { dadosUso: boolean }
export const parsePrefs = (raw: unknown): ContaPrefs => ({ dadosUso: !(raw !== null && typeof raw === "object" && (raw as Record<string, unknown>).dadosUso === false) });
/** Resposta do `POST /token` (grant code ou refresh) e o conteúdo de conta.bin: os dois têm o mesmo formato. */
export function parseSessao(raw: unknown, now: number = Date.now()): SessaoGuardada | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const refresh = str(r.refresh), acesso = str(r.acesso), expiraEm = iso(r.expiraEm);
  if (refresh === null || !TOKEN_RE.test(refresh) || acesso === null || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(acesso) || expiraEm === null) return null;
  const conta = parseContaInfo(r.conta, now);
  if (conta === null) return null;
  return { refresh, acesso, expiraEm, conta, fotoLocal: fotoLocalOk(r.fotoLocal) ? r.fotoLocal : null };
}
/** O token de acesso está perto de vencer (ou a data não é legível): renova antes de usar. */
export function deveRenovar(expiraEm: string, now: number = Date.now()): boolean {
  const t = Date.parse(expiraEm);
  return Number.isNaN(t) || t - now < RENOVAR_ANTES_MS;
}
/** Texto do erro de uma resposta da API para a tela: o `erro` do corpo quando há, senão o status. */
export function erroDaApi(status: number, corpo: unknown): string {
  const e = corpo !== null && typeof corpo === "object" ? (corpo as Record<string, unknown>).erro : undefined;
  if (typeof e === "string" && e.trim() !== "") return e.trim().slice(0, 200);
  return status === 429 ? "muitas tentativas; espere um minuto" : status >= 500 ? `a API da conta respondeu ${status}` : `pedido recusado (${status})`;
}
/** O que liga a máquina de uma pessoa à conta dela (meu-bot-admin-gestao); cada pista pode faltar. */
export interface PistasDaConta { maquina: string | null; id: string | null; email: string | null }
/** `GET /admin/conta?…` com as pistas que valem; null sem nenhuma (não há o que perguntar à API). */
export function rotaDaContaAdmin(p: PistasDaConta): string | null {
  const q = new URLSearchParams();
  if (p.maquina !== null && UUID_RE.test(p.maquina)) q.set("maquina", p.maquina);
  if (p.id !== null && UUID_RE.test(p.id)) q.set("id", p.id);
  if (p.email !== null && /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,50}$/.test(p.email.trim())) q.set("email", p.email.trim().toLowerCase());
  const s = q.toString();
  return s === "" ? null : `/admin/conta?${s}`;
}
/** A resposta de `GET /admin/conta` para a tela. Vem da API: passa pelo mesmo parse da conta do próprio app. */
export function parseContaDoAdmin(status: number, corpo: unknown, now: number = Date.now()): ContaDaPessoa {
  const r = corpo !== null && typeof corpo === "object" ? (corpo as Record<string, unknown>) : null;
  // 404 sem `semConta` é a própria rota que não existe (API publicada antes dela), não uma conta que falta.
  if (status === 404) return r?.semConta === true ? { estado: "nao-achada" } : { estado: "sem-resposta", motivo: "a API da conta ainda não tem esta leitura (aguarda publicação)" };
  const conta = status === 200 && r !== null ? parseContaInfo(r.conta, now) : null;
  const por = r?.achadaPor;
  if (conta === null || (por !== "maquina" && por !== "id" && por !== "email")) return { estado: "sem-resposta", motivo: status === 200 ? "a API da conta respondeu fora do formato" : erroDaApi(status, corpo) };
  const c = r!.conta as Record<string, unknown>;
  const extras = c.maquinaExtras;
  const addonsPagos: ContaAddonPago[] = (Array.isArray(c.assinaturas) ? c.assinaturas : []).flatMap((a: unknown): ContaAddonPago[] => {
    if (a === null || typeof a !== "object") return [];
    const x = a as Record<string, unknown>;
    // Só add-on em andamento: o Pro (produto null) já está na licença e a máquina extra na contagem de máquinas.
    if (x.status !== "ACTIVE" || typeof x.produto !== "string" || !/^meu-bot-[a-z0-9-]{1,40}$/.test(x.produto)) return [];
    return [{ produto: x.produto, valeAte: iso(x.valeAte) }];
  });
  const cortesias = c.maquinaCortesias;
  return { estado: "ok", conta, maquinaExtras: typeof extras === "number" && Number.isInteger(extras) && extras >= 0 ? extras : 0, maquinaCortesias: typeof cortesias === "number" && Number.isInteger(cortesias) && cortesias >= 0 ? cortesias : 0, addonsPagos, achadaPor: por, lidaEm: new Date(now).toISOString(), ...(r!.atribuida === true ? { atribuida: true } : {}) };
}
/** 401 da API: a sessão não vale mais (vencida, revogada, conta apagada): o app sai sozinho e pede para entrar de novo. */
export const sessaoAcabou = (status: number): boolean => status === 401;
/** Retorno do deep link confere com o login pendente? (state igual: o code é de outro login ou de outro app senão.) */
export const retornoConfere = (pendente: LoginPendente | null, state: string): boolean => pendente !== null && pendente.state === state;

/**
 * Quem abre o meu-bot-admin-gestao: só conta com papel de admin ou super admin. "sem-conta": ninguém entrou (o seletor
 * mostra o cartão de login); "sem-papel": entrou uma conta comum, que não vê as pessoas nem abre máquina.
 */
export type AcessoGestao = "ok" | "sem-conta" | "sem-papel";
export function acessoGestao(conta: { admin: "super" | "admin" | null } | null): AcessoGestao {
  if (conta === null) return "sem-conta";
  return conta.admin === "super" || conta.admin === "admin" ? "ok" : "sem-papel";
}
/**
 * O papel que vale na hora de abrir uma máquina pelo Gestão: o que o servidor confirmou agora; sem resposta (este Mac
 * sem internet, API fora), o último confirmado, que é o guardado na sessão. O suporte não para por uma queda da API, e
 * quem foi rebaixado perde o acesso na primeira conferência que chegar ao servidor.
 */
export function papelParaGestao<P extends "super" | "admin" | null>(confirmado: { admin: P } | null, guardado: { admin: P } | null): { admin: P } | null {
  return confirmado ?? guardado;
}
export const SEM_PAPEL_GESTAO = "Esta conta não tem acesso à gestão: só admin ou super admin. Saia e entre com uma conta de admin.";


/** O e-mail de uma conta, como a gestão o digita: aparado e minúsculo; null se não tem a forma de um e-mail. */
export function emailDeConta(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,50}$/.test(t) ? t : null;
}
/** A resposta de `POST|DELETE /admin/maquinas/:id/conta` para a tela da gestão. */
export function parseAtribuicao(status: number, corpo: unknown): AtribuirMaquinaResultado {
  const r = corpo !== null && typeof corpo === "object" ? (corpo as Record<string, unknown>) : null;
  if (status === 200) {
    const c = r?.conta !== null && typeof r?.conta === "object" ? (r.conta as Record<string, unknown>) : null;
    return { ok: true, conta: c !== null && typeof c.email === "string" ? { email: c.email, nome: typeof c.nome === "string" && c.nome !== "" ? c.nome : null } : null };
  }
  // 404 sem texto de erro, ou "rota desconhecida", é a rota que ainda não existe na API publicada.
  if (status === 404 && (typeof r?.erro !== "string" || r.erro === "rota desconhecida")) return { ok: false, erro: "a API da conta ainda não tem a atribuição de máquina (aguarda publicação)" };
  return { ok: false, erro: erroDaApi(status, corpo) };
}
