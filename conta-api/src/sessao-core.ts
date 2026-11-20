/**
 * Sessão da conta, a parte pura (WebCrypto, roda no Worker e no node --test): segredos, PKCE, JWT HS256 do token de
 * acesso, validação do que o app e a página mandam. Vem de fora = dado, nunca comando.
 */

/** Código do deep link e `state` do app: 32 bytes em base64url (43 caracteres). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
/** PKCE (RFC 7636): verifier de 43 a 128 caracteres; challenge = base64url(sha256(verifier)), 43 caracteres. */
export const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
export const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
/**
 * Esquema do deep link (esquemaDe em src/main/app/variant-core.ts): o nome do produto, sempre `meu-bot…`, ou `web`
 * (o console). Nunca um esquema genérico como `javascript`, `data` ou `http`, que a página de login abriria.
 */
export const ESQUEMA_RE = /^(?:web|meu-bot(?:-[a-z0-9]+){0,6})$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Id de device: o uuid do device.json, ou o alias antigo (12 hex). */
export const DEVICE_ID_RE = /^(?:[a-f0-9]{12}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
/** Campos livres do device e do app (nome do Mac, usuário…), como MACHINE_FIELD_RE do backend. */
const CAMPO_RE = /^[^\p{C}]{0,80}$/u;
export const APP_RE = /^meu-bot(?:-[a-z0-9-]{1,30})?$/;
export const VERSAO_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,40})?$/;

export const CODE_TTL_S = 120;
export const ACESSO_TTL_S = 60 * 60;
/** Refresh: 90 dias em produção; 7 no staging (lá o safeStorage do app é só ofuscação, use-mock-keychain). */
export const refreshTtlS = (canal: string): number => (canal === "staging" ? 7 : 90) * 24 * 60 * 60;
/** Quantos /sessao por IP por minuto. */
export const LIMITE_SESSAO_POR_MIN = 20;

const enc = new TextEncoder();

export function b64url(b: ArrayBuffer | Uint8Array): string {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function deB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
/** `n` bytes aleatórios em base64url (code, state, refresh). */
export function segredo(n = 32): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64url(b);
}
export const uuid = (): string => crypto.randomUUID();
export const agoraIso = (agoraMs = Date.now()): string => new Date(agoraMs).toISOString();
export const maisSegundos = (s: number, agoraMs = Date.now()): string => new Date(agoraMs + s * 1000).toISOString();

export async function sha256(s: string): Promise<Uint8Array<ArrayBuffer>> { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
export async function sha256Hex(s: string): Promise<string> { return [...await sha256(s)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
/** O challenge que o app mandou é deste verifier? (S256) */
export async function pkceConfere(verifier: string, challenge: string): Promise<boolean> {
  if (!VERIFIER_RE.test(verifier) || !CHALLENGE_RE.test(challenge)) return false;
  return b64url(await sha256(verifier)) === challenge;
}

// ---- JWT HS256 (token de acesso): header fixo, claims JSON, assinatura HMAC com a chave do secret.
const HEADER = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
async function chaveHmac(segredoB64: string): Promise<CryptoKey> {
  const raw = deB64url(segredoB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  if (raw === null || raw.length < 32) throw new Error("SESSAO_HMAC_KEY precisa ter pelo menos 32 bytes em base64");
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function assinarJwt(claims: Record<string, unknown>, segredoB64: string): Promise<string> {
  const corpo = `${HEADER}.${b64url(enc.encode(JSON.stringify(claims)))}`;
  const sig = await crypto.subtle.sign("HMAC", await chaveHmac(segredoB64), enc.encode(corpo));
  return `${corpo}.${b64url(sig)}`;
}
/** Claims de um JWT HS256 nosso, válido e não vencido; null para qualquer outra coisa. */
export async function verificarJwt(token: string, segredoB64: string, agoraS = Math.floor(Date.now() / 1000)): Promise<Record<string, unknown> | null> {
  const partes = token.split(".");
  if (partes.length !== 3 || partes[0] !== HEADER) return null;
  const [h, p, s] = partes as [string, string, string];
  const sig = deB64url(s);
  if (sig === null) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", await chaveHmac(segredoB64), sig, enc.encode(`${h}.${p}`)); } catch { return null; }
  if (!ok) return null;
  const claims = parseJsonB64url(p);
  if (claims === null) return null;
  const exp = claims.exp, iat = claims.iat;
  if (typeof exp !== "number" || typeof iat !== "number" || exp <= agoraS || iat > agoraS + 60) return null;
  return claims;
}
export function parseJsonB64url(s: string): Record<string, unknown> | null {
  const b = deB64url(s);
  if (b === null) return null;
  try { const j: unknown = JSON.parse(new TextDecoder().decode(b)); return j !== null && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null; } catch { return null; }
}

// ---- O que chega nos pedidos.
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, re: RegExp): string | null => (typeof v === "string" && re.test(v) ? v : null);

/** Como a pessoa entrou na página (o Firebase reporta "password" tanto para senha quanto para link por e-mail). */
export type MetodoLogin = "google" | "emailLink" | "password";
/** `org`: slug da organização quando o login veio de auth.<host>/org/<slug> (só membro entra por ali). */
export interface PedidoSessao { idToken: string; state: string; challenge: string; esquema: string; app: string | null; versao: string | null; metodo: MetodoLogin | null; org: string | null }
/** `POST /sessao` da página: ID token do Firebase mais o que o app pôs na URL de login. */
export function validaPedidoSessao(raw: unknown): PedidoSessao | { erro: string } {
  if (!isObj(raw)) return { erro: "corpo inválido" };
  const idToken = typeof raw.idToken === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw.idToken) && raw.idToken.length < 8192 ? raw.idToken : null;
  if (idToken === null) return { erro: "idToken ausente ou fora do formato" };
  const state = str(raw.state, TOKEN_RE), challenge = str(raw.challenge, CHALLENGE_RE), esquema = str(raw.esquema, ESQUEMA_RE);
  if (state === null) return { erro: "state ausente ou fora do formato" };
  if (challenge === null) return { erro: "challenge (PKCE) ausente ou fora do formato" };
  if (esquema === null) return { erro: "esquema do app ausente ou fora do formato" };
  const org = raw.org === undefined || raw.org === null || raw.org === "" ? null : str(raw.org, /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/);
  if (raw.org !== undefined && raw.org !== null && raw.org !== "" && org === null) return { erro: "org: endereço da organização fora do formato" };
  return { idToken, state, challenge, esquema, app: str(raw.app, APP_RE), versao: str(raw.v, VERSAO_RE), metodo: str(raw.metodo, /^(google|emailLink|password)$/) as MetodoLogin | null, org };
}

export interface DeviceValido { id: string; alias: string | null; name: string; user: string; platform: string; app: string; versao: string }
export function validaDevice(raw: unknown): DeviceValido | { erro: string } {
  if (!isObj(raw)) return { erro: "device ausente" };
  const id = str(raw.id, DEVICE_ID_RE);
  if (id === null) return { erro: "id do device fora do formato" };
  const alias = raw.alias === undefined || raw.alias === null ? null : str(raw.alias, /^[a-f0-9]{12}$/);
  if (raw.alias !== undefined && raw.alias !== null && alias === null) return { erro: "alias do device fora do formato" };
  const app = str(raw.app, APP_RE), versao = str(raw.versao, VERSAO_RE);
  if (app === null || versao === null) return { erro: "app ou versão fora do formato" };
  const campo = (k: string): string => str(raw[k], CAMPO_RE) ?? "";
  return { id, alias, name: campo("name"), user: campo("user"), platform: str(raw.platform, /^(darwin|win32|linux)$/) ?? "", app, versao };
}

/** Esquema reservado do console web: o código volta para o console (sem device nem refresh), não para um app. */
export const ESQUEMA_WEB = "web";
export type PedidoToken = { grant: "code"; code: string; verifier: string; device: DeviceValido } | { grant: "refresh"; refresh: string } | { grant: "web"; code: string; verifier: string };
export function validaPedidoToken(raw: unknown): PedidoToken | { erro: string } {
  if (!isObj(raw)) return { erro: "corpo inválido" };
  if (raw.grant === "code") {
    const code = str(raw.code, TOKEN_RE), verifier = str(raw.verifier, VERIFIER_RE);
    if (code === null) return { erro: "code ausente ou fora do formato" };
    if (verifier === null) return { erro: "verifier (PKCE) ausente ou fora do formato" };
    const device = validaDevice(raw.device);
    if ("erro" in device) return device;
    return { grant: "code", code, verifier, device };
  }
  if (raw.grant === "refresh") {
    const refresh = str(raw.refresh, TOKEN_RE);
    if (refresh === null) return { erro: "refresh ausente ou fora do formato" };
    return { grant: "refresh", refresh };
  }
  if (raw.grant === "web") {
    const code = str(raw.code, TOKEN_RE), verifier = str(raw.verifier, VERIFIER_RE);
    if (code === null) return { erro: "code ausente ou fora do formato" };
    if (verifier === null) return { erro: "verifier (PKCE) ausente ou fora do formato" };
    return { grant: "web", code, verifier };
  }
  return { erro: "grant desconhecido (code | refresh | web)" };
}

/**
 * Admissão de um device (mesma regra de admitDevice do backend-colima/licenca.js). Novo ou pendente: entra se cabe no
 * limite (`ativos` = os outros ativos da conta). Ativo: continua enquanto está entre os `limite` ativos mais antigos
 * (`ativosMaisAntigos` = quantos ativos entraram antes dele); quando o limite cai (um device extra venceu), os mais
 * novos voltam a esperar.
 */
export function admitirDevice(conhecido: { status: string } | null, ativos: number, limite: number, ativosMaisAntigos = 0): "active" | "pending" {
  if (conhecido !== null && conhecido.status !== "pending") return ativosMaisAntigos < limite ? "active" : "pending";
  return ativos < limite ? "active" : "pending";
}

/** Teto do limite de devices de uma conta (o mesmo de validaPatchLicenca). */
export const DEVICE_LIMITE_MAX = 50;
/**
 * O admin libera um device pendente. Com vaga, só ativa. Sem vaga, recusa (`noLimite`) a menos que o admin tenha pedido
 * para subir o limite junto: aí o limite vira `ativos + 1`, o que cabe este device e nada além. Já ativo não muda nada.
 */
export function decidirLiberarDevice(status: string, ativos: number, limite: number, subirLimite: boolean): { acao: "ja-ativo" } | { acao: "liberar"; novoLimite: number | null } | { erro: string; noLimite: true } {
  if (status !== "pending") return { acao: "ja-ativo" };
  if (ativos < limite) return { acao: "liberar", novoLimite: null };
  if (!subirLimite) return { erro: `a conta já usa ${ativos} de ${limite} devices; para liberar este, o limite precisa subir`, noLimite: true };
  if (ativos + 1 > DEVICE_LIMITE_MAX) return { erro: `o limite de devices não passa de ${DEVICE_LIMITE_MAX}`, noLimite: true };
  return { acao: "liberar", novoLimite: ativos + 1 };
}

/**
 * O admin inicial (var ADMIN_BOOTSTRAP_EMAIL) é o dono da instalação: entra como super no primeiro login e o perfil
 * dele não é removido nem rebaixado por outro super admin. Var vazia: ninguém é o admin inicial.
 */
export function ehAdminInicial(email: string, bootstrap: string): boolean {
  const b = bootstrap.trim().toLowerCase();
  return b !== "" && email === b;
}
/** O que o admin pode mudar na licença de uma conta (campos omitidos ficam como estão), como LicensePatch do app. */
export interface PatchLicenca { plan?: "free" | "pro"; status?: "free" | "trialing" | "active" | "expired"; interval?: "month" | "year" | null; trialEnd?: string | null; expiresAt?: string | null; deviceLimit?: number; maquinaLimit?: number; orgLimit?: number; produtos?: string[]; pagamento?: { instrucoes: string; link: string | null } | null }
const DATA_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/;
const dataOuNull = (v: unknown): string | null | undefined => (v === null ? null : typeof v === "string" && DATA_RE.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);
/** Teto de quantas organizações o admin pode liberar para uma conta criar. */
export const ORG_LIMITE_MAX = 20;
/**
 * A conta pode criar mais uma organização? Só com o Pro valendo de verdade (plano pro, status ativo, prazo no futuro
 * ou sem prazo): teste grátis não cria. E só até `limite` organizações em que ela é a dona (`donaDe`); o padrão é 1 e
 * o admin sobe pela licença. Super admin (`papel`) cria sem limite. Devolve null quando pode, ou o motivo, que a tela
 * mostra com o caminho.
 */
export function podeCriarOrg(p: { licenca: { plan: string; status: string; expiresAt: string | null }; papel: "super" | "admin" | null; donaDe: number; limite: number; agoraMs: number }): { motivo: "sem-pro" | "no-limite"; erro: string } | null {
  if (p.papel === "super") return null;
  const fim = p.licenca.expiresAt === null ? null : Date.parse(p.licenca.expiresAt);
  const proValendo = p.licenca.plan === "pro" && p.licenca.status === "active" && (fim === null || (!Number.isNaN(fim) && fim > p.agoraMs));
  if (!proValendo) return { motivo: "sem-pro", erro: p.licenca.status === "trialing" ? "criar organização faz parte do Pro assinado; o teste grátis não inclui. Assine o Pro e crie a sua" : "criar organização faz parte do Pro; assine o Pro e crie a sua" };
  if (p.donaDe >= p.limite) return { motivo: "no-limite", erro: p.limite === 1 ? "a sua conta já tem uma organização, e o plano inclui uma. Para criar outra, fale com o suporte" : `a sua conta já tem ${p.donaDe} organizações, o limite dela. Para criar outra, fale com o suporte` };
  return null;
}

export function validaPatchLicenca(raw: unknown): PatchLicenca | { erro: string } {
  if (!isObj(raw)) return { erro: "corpo inválido" };
  const p: PatchLicenca = {};
  if (raw.plan !== undefined) { if (raw.plan !== "free" && raw.plan !== "pro") return { erro: "plan: free ou pro" }; p.plan = raw.plan; }
  if (raw.status !== undefined) { if (raw.status !== "free" && raw.status !== "trialing" && raw.status !== "active" && raw.status !== "expired") return { erro: "status: free, trialing, active ou expired" }; p.status = raw.status; }
  if (raw.interval !== undefined) { if (raw.interval !== null && raw.interval !== "month" && raw.interval !== "year") return { erro: "interval: month, year ou null" }; p.interval = raw.interval; }
  if (raw.trialEnd !== undefined) { const d = dataOuNull(raw.trialEnd); if (d === undefined) return { erro: "trialEnd: data ISO ou null" }; p.trialEnd = d; }
  if (raw.expiresAt !== undefined) { const d = dataOuNull(raw.expiresAt); if (d === undefined) return { erro: "expiresAt: data ISO ou null" }; p.expiresAt = d; }
  if (raw.deviceLimit !== undefined) { if (typeof raw.deviceLimit !== "number" || !Number.isInteger(raw.deviceLimit) || raw.deviceLimit < 1 || raw.deviceLimit > 50) return { erro: "deviceLimit: inteiro de 1 a 50" }; p.deviceLimit = raw.deviceLimit; }
  if (raw.maquinaLimit !== undefined) { if (typeof raw.maquinaLimit !== "number" || !Number.isInteger(raw.maquinaLimit) || raw.maquinaLimit < 1 || raw.maquinaLimit > 50) return { erro: "maquinaLimit: inteiro de 1 a 50" }; p.maquinaLimit = raw.maquinaLimit; }
  if (raw.orgLimit !== undefined) { if (typeof raw.orgLimit !== "number" || !Number.isInteger(raw.orgLimit) || raw.orgLimit < 1 || raw.orgLimit > ORG_LIMITE_MAX) return { erro: `orgLimit: inteiro de 1 a ${ORG_LIMITE_MAX}` }; p.orgLimit = raw.orgLimit; }
  if (raw.produtos !== undefined) { if (!Array.isArray(raw.produtos) || !raw.produtos.every((x) => typeof x === "string" && /^[a-z][a-z0-9-]{1,40}$/.test(x))) return { erro: "produtos: lista de nomes (letras, dígitos, hífen)" }; p.produtos = [...new Set(raw.produtos as string[])].sort(); }
  if (raw.pagamento !== undefined) {
    if (raw.pagamento === null) p.pagamento = null;
    else { if (!isObj(raw.pagamento) || typeof raw.pagamento.instrucoes !== "string" || raw.pagamento.instrucoes.length > 500) return { erro: "pagamento: {instrucoes (até 500), link (https ou null)} ou null" }; const link = raw.pagamento.link; if (link !== undefined && link !== null && (typeof link !== "string" || !/^https?:\/\/\S{1,300}$/.test(link))) return { erro: "pagamento.link: http(s) ou null" }; p.pagamento = { instrucoes: raw.pagamento.instrucoes.trim(), link: typeof link === "string" ? link : null }; }
  }
  if (Object.keys(p).length === 0) return { erro: "nada para mudar" };
  return p;
}
// ---- Perfil da conta (console › Perfil), molde Rambox.
/** `PATCH /conta`: campos omitidos ficam; null ou "" limpa; texto livre até 80 sem caracteres de controle. */
export interface PatchPerfil { nomeProprio?: string | null; sobrenome?: string | null; dadosUso?: boolean }
const TEXTOS_PERFIL = ["nomeProprio", "sobrenome"] as const;
export function validaPatchPerfil(raw: unknown): PatchPerfil | { erro: string } {
  if (!isObj(raw)) return { erro: "corpo inválido" };
  const p: PatchPerfil = {};
  for (const k of TEXTOS_PERFIL) {
    const v = raw[k];
    if (v === undefined) continue;
    if (v === null) { p[k] = null; continue; }
    if (typeof v !== "string" || !CAMPO_RE.test(v)) return { erro: `${k}: texto até 80 caracteres` };
    const t = v.trim(); p[k] = t === "" ? null : t;
  }
  if (raw.dadosUso !== undefined) { if (typeof raw.dadosUso !== "boolean") return { erro: "dadosUso: true ou false" }; p.dadosUso = raw.dadosUso; }
  if (Object.keys(p).length === 0) return { erro: "nada para mudar" };
  return p;
}
/** O nome que se mostra: o digitado no console (nome próprio + sobrenome); senão o que veio do login. */
export const nomeExibicao = (c: { nome_proprio: string | null; sobrenome: string | null; nome: string | null }): string | null => {
  const digitado = [c.nome_proprio, c.sobrenome].filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).join(" ");
  return digitado !== "" ? digitado : c.nome;
};
/** Provedores que a conta conhece. "emailLink" é nosso: o Firebase chama os dois de "password". */
export const PROVEDORES_RE = /^(google\.com|password|emailLink)$/;
/** Lê a coluna `provedores` (JSON) com defesa: lixo vira lista vazia. */
export function parseProvedores(raw: string | null | undefined): string[] {
  try { const p: unknown = JSON.parse(raw ?? "[]"); return Array.isArray(p) ? [...new Set(p.filter((x): x is string => typeof x === "string" && PROVEDORES_RE.test(x)))].sort() : []; } catch { return []; }
}
/** A união do que já havia com os provedores deste login, como JSON para a coluna. */
export const unirProvedores = (atuais: string | null | undefined, novos: string[]): string => JSON.stringify([...new Set([...parseProvedores(atuais), ...novos.filter((x) => PROVEDORES_RE.test(x))])].sort());
/** Os provedores deste login: o token diz "password" para senha e para link por e-mail; o `metodo` da página desempata. */
export const provedoresDoLogin = (doToken: string[], metodo: MetodoLogin | null): string[] => doToken.map((p) => (p === "password" && metodo === "emailLink" ? "emailLink" : p));
/** Senha que o super admin define para alguém: 8 a 128 caracteres, sem controle. */
export const validaSenhaNova = (v: unknown): string | null => (typeof v === "string" && v.length >= 8 && v.length <= 128 && /^[^\p{C}]+$/u.test(v) ? v : null);
/** E-mail de um perfil de acesso (minúsculas) e o papel; null se fora do formato. */
export const validaEmail = (v: unknown): string | null => (typeof v === "string" && /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,50}$/.test(v.trim()) ? v.trim().toLowerCase() : null);
export const validaPapel = (v: unknown): "super" | "admin" | null => (v === "super" || v === "admin" ? v : null);
/** `?busca=` do admin: até 80 caracteres sem controle; o resto vira vazio (lista tudo). */
export const validaBusca = (v: unknown): string => (typeof v === "string" && /^[^\p{C}]{0,80}$/u.test(v) ? v.trim().toLowerCase() : "");
/** Janela do rate limit: minuto corrente em ISO sem segundos. */
export const janelaMinuto = (agoraMs = Date.now()): string => new Date(agoraMs).toISOString().slice(0, 16);

// ---- Organizações (molde Rambox Enterprise): slug, papéis, convites e assentos.
/** O slug é o futuro `<slug>.agentesgrok.com`: minúsculas, dígitos e hífen no meio, 2 a 40 caracteres. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** Hosts nossos e nomes que confundiriam (nunca viram organização). */
export const SLUGS_RESERVADOS = new Set(["auth", "conta", "console", "site", "www", "api", "admin", "mail", "app", "apps", "download", "account", "organizations", "orgs", "teams", "staging", "auth-staging", "conta-staging", "console-staging", "site-staging", "meu-bot", "meubot", "agentesgrok", "suporte", "ajuda", "blog", "docs", "status", "dev", "test", "teste", "cdn", "static", "assets", "login", "entrar", "ns1", "ns2", "smtp", "imap", "ftp", "new", "nova"]);
export const validaSlug = (v: unknown): string | null => (typeof v === "string" && SLUG_RE.test(v) && v.length >= 2 && !SLUGS_RESERVADOS.has(v) ? v : null);
/** Sugere um slug a partir do nome ("Coflow Tecnologia" → "coflow-tecnologia"); pode sair vazio ou reservado: quem valida é validaSlug. */
export const slugDoNome = (nome: string): string => nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
export type PapelOrg = "dona" | "admin" | "membro";
export const validaPapelOrg = (v: unknown): PapelOrg | null => (v === "dona" || v === "admin" || v === "membro" ? v : null);
const NOME_ORG_RE = /^[^\p{C}]{2,80}$/u;
const DOMINIO_RE = /^(?=.{3,120}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** `POST /orgs`: nome (2 a 80, sem controle) e slug (válido e fora da lista reservada). */
export function validaNovaOrg(raw: unknown): { nome: string; slug: string } | { erro: string } {
  if (!isObj(raw)) return { erro: "corpo inválido" };
  const nome = typeof raw.nome === "string" ? raw.nome.trim() : "";
  if (!NOME_ORG_RE.test(nome)) return { erro: "nome: 2 a 80 caracteres" };
  const slug = validaSlug(raw.slug);
  if (slug === null) return { erro: typeof raw.slug === "string" && SLUGS_RESERVADOS.has(raw.slug) ? "esse endereço é reservado; escolha outro" : "endereço: letras minúsculas, dígitos e hífen, 2 a 40 caracteres" };
  return { nome, slug };
}
/** `PATCH /orgs/:slug`: nome e/ou domínio de e-mail (null limpa). */
export interface PatchOrg { nome?: string; dominioEmail?: string | null }
export function validaPatchOrg(raw: unknown): PatchOrg | { erro: string } {
  if (!isObj(raw)) return { erro: "corpo inválido" };
  const p: PatchOrg = {};
  if (raw.nome !== undefined) { const nome = typeof raw.nome === "string" ? raw.nome.trim() : ""; if (!NOME_ORG_RE.test(nome)) return { erro: "nome: 2 a 80 caracteres" }; p.nome = nome; }
  if (raw.dominioEmail !== undefined) {
    const v = raw.dominioEmail;
    if (v === null || v === "") p.dominioEmail = null;
    else if (typeof v === "string" && DOMINIO_RE.test(v.trim().toLowerCase().replace(/^@/, ""))) p.dominioEmail = v.trim().toLowerCase().replace(/^@/, "");
    else return { erro: "dominioEmail: um domínio como empresa.com.br, ou null" };
  }
  if (Object.keys(p).length === 0) return { erro: "nada para mudar" };
  return p;
}
/** `POST /orgs/:slug/membros`: e-mail e papel (admin ou membro; dona só por promoção). */
export function validaConvite(raw: unknown): { email: string; papel: "admin" | "membro" } | { erro: string } {
  if (!isObj(raw)) return { erro: "corpo inválido" };
  const email = validaEmail(raw.email);
  if (email === null) return { erro: "e-mail fora do formato" };
  const papel = raw.papel === undefined ? "membro" : raw.papel;
  if (papel !== "admin" && papel !== "membro") return { erro: "papel: admin ou membro" };
  return { email, papel };
}
/** Com domínio definido, só e-mails daquele domínio entram (subdomínios não). */
export const emailNoDominio = (email: string, dominio: string | null): boolean => dominio === null || email.toLowerCase().endsWith(`@${dominio.toLowerCase()}`);
/** Quantos usuários toda organização inclui sem pagar: a dona. Os outros são usuários pagos (extra "assento") ou cortesia do super admin. */
export const ASSENTOS_INCLUSOS = 1;
/** Teto de usuários de uma organização (o mesmo de validaAssentos). */
export const ASSENTOS_MAX = 1000;
/** Assentos livres: ativos e convidados ocupam; nunca negativo. */
export const assentosLivres = (assentos: number, ocupados: number): number => Math.max(0, assentos - ocupados);
/** `PATCH /admin/orgs/:slug`: assentos de 1 a 1000. */
export const validaAssentos = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= ASSENTOS_MAX ? v : null);
/**
 * `coflow.agentesgrok.com` → "coflow": o host de uma organização (PR do subdomínio). Hosts nossos (auth., console.,
 * www.…) e nomes reservados dão null; o site (`siteHost`) é o domínio-base.
 */
export function slugDoHost(host: string, siteHost: string): string | null {
  const h = host.toLowerCase().replace(/:\d+$/, ""), base = siteHost.toLowerCase().replace(/^https?:\/\//, "");
  if (!h.endsWith(`.${base}`)) return null;
  const slug = h.slice(0, -(base.length + 1));
  return validaSlug(slug);
}
