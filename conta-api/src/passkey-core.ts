/**
 * Passkey (WebAuthn), a parte pura: lê o que o navegador devolve de `navigator.credentials.create()` e `.get()` e
 * confere, sem biblioteca (WebCrypto, roda no Worker e no node --test). Vem de fora = dado, nunca comando.
 *
 * O cadastro não confere atestado (pedimos `attestation: "none"`): quem prova que a chave é da pessoa é a sessão com
 * que ela cadastra (o Bearer do console). O navegador manda a chave pública já em SPKI (`getPublicKey()`), e aqui se
 * confere que ela é a mesma que está dentro do `authenticatorData` (a chave COSE), sem decodificar o CBOR inteiro.
 * O login confere origem, RP, presença e verificação da pessoa, o desafio e a assinatura.
 */
import { APP_RE, b64url, CHALLENGE_RE, deB64url, ESQUEMA_RE, TOKEN_RE, VERSAO_RE } from "./sessao-core.js";

/** Algoritmos COSE aceitos: ES256 (P-256) e RS256. É o que `pubKeyCredParams` pede. */
export const ALG_ES256 = -7, ALG_RS256 = -257;
export const ALGS = [ALG_ES256, ALG_RS256] as const;
/** Quanto vale um desafio. */
export const DESAFIO_TTL_S = 5 * 60;
/** Quantas passkeys uma conta guarda. */
export const LIMITE_PASSKEYS = 10;
const B64_RE = /^[A-Za-z0-9_-]+$/;
const FLAG_UP = 0x01, FLAG_UV = 0x04, FLAG_BE = 0x08, FLAG_AT = 0x40;

export interface AuthData { rpIdHash: Uint8Array; flags: number; contador: number; credId: Uint8Array | null; resto: Uint8Array | null }
/** O `authenticatorData`: hash do RP (32), flags (1), contador (4) e, no cadastro, AAGUID (16), id da credencial e a chave COSE. */
export function lerAuthData(b: Uint8Array): AuthData | null {
  if (b.length < 37) return null;
  const flags = b[32]!;
  const contador = ((b[33]! << 24) | (b[34]! << 16) | (b[35]! << 8) | b[36]!) >>> 0;
  if ((flags & FLAG_AT) === 0) return { rpIdHash: b.subarray(0, 32), flags, contador, credId: null, resto: null };
  if (b.length < 55) return null;
  const n = (b[53]! << 8) | b[54]!;
  if (n === 0 || n > 1023 || b.length < 55 + n + 1) return null;
  return { rpIdHash: b.subarray(0, 32), flags, contador, credId: b.subarray(55, 55 + n), resto: b.subarray(55 + n) };
}

const contem = (onde: Uint8Array, oQue: Uint8Array): boolean => {
  fora: for (let i = 0; i + oQue.length <= onde.length; i++) { for (let j = 0; j < oQue.length; j++) if (onde[i + j] !== oQue[j]) continue fora; return true; }
  return false;
};
const iguais = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && contem(a, b);

/**
 * A chave SPKI que o navegador mandou é a que o autenticador pôs no `authenticatorData`? ES256: o SPKI termina em
 * 04 || x || y, e a chave COSE traz x e y (32 bytes cada). RS256: a chave COSE traz o módulo de 2048 bits (bstr de
 * 256 bytes, prefixo 59 01 00), que tem de aparecer no SPKI.
 */
export function chaveConfere(spki: Uint8Array, alg: number, cose: Uint8Array): boolean {
  if (alg === ALG_ES256) {
    if (spki.length < 65 || spki[spki.length - 65] !== 0x04) return false;
    return contem(cose, spki.subarray(spki.length - 64, spki.length - 32)) && contem(cose, spki.subarray(spki.length - 32));
  }
  if (alg === ALG_RS256) {
    for (let i = 0; i + 3 + 256 <= cose.length; i++) if (cose[i] === 0x59 && cose[i + 1] === 0x01 && cose[i + 2] === 0x00 && contem(spki, cose.subarray(i + 3, i + 3 + 256))) return true;
    return false;
  }
  return false;
}

/** Assinatura ECDSA em DER (como o WebAuthn manda) para r || s de 64 bytes (como o WebCrypto quer). */
export function derParaRaw(der: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (der.length < 8 || der[0] !== 0x30) return null;
  let p = 2;
  if (der[1]! & 0x80) { if (der[1] !== 0x81) return null; p = 3; }
  const out = new Uint8Array(64);
  for (const fim of [32, 64]) {
    if (der[p] !== 0x02) return null;
    const n = der[p + 1]!;
    if (n === 0 || n > 33 || p + 2 + n > der.length) return null;
    let v = der.subarray(p + 2, p + 2 + n);
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    if (v.length > 32) return null;
    out.set(v, fim - v.length);
    p += 2 + n;
  }
  return p === der.length ? out : null;
}

async function sha256(b: Uint8Array): Promise<Uint8Array> { return new Uint8Array(await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>)); }

async function importar(spki: Uint8Array, alg: number): Promise<CryptoKey | null> {
  try {
    if (alg === ALG_ES256) return await crypto.subtle.importKey("spki", spki as Uint8Array<ArrayBuffer>, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    if (alg === ALG_RS256) return await crypto.subtle.importKey("spki", spki as Uint8Array<ArrayBuffer>, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  } catch { return null; }
  return null;
}

export interface Rp { rpId: string; origens: readonly string[] }
/** O `clientDataJSON`: o tipo certo, a origem de uma das nossas páginas e sem iframe de outra origem. Devolve o desafio. */
export function lerClientData(b: Uint8Array, tipo: "webauthn.create" | "webauthn.get", origens: readonly string[]): { desafio: string } | { erro: string } {
  let j: unknown;
  try { j = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b)); } catch { return { erro: "clientDataJSON ilegível" }; }
  if (j === null || typeof j !== "object" || Array.isArray(j)) return { erro: "clientDataJSON ilegível" };
  const o = j as Record<string, unknown>;
  if (o.type !== tipo) return { erro: "a resposta não é deste tipo de pedido" };
  if (typeof o.origin !== "string" || !origens.includes(o.origin)) return { erro: "a resposta veio de outra página" };
  if (o.crossOrigin === true) return { erro: "a resposta veio de dentro de outra página" };
  if (typeof o.challenge !== "string" || !TOKEN_RE.test(o.challenge)) return { erro: "desafio fora do formato" };
  return { desafio: o.challenge };
}

async function conferirAuthData(b: Uint8Array, rp: Rp): Promise<AuthData | { erro: string }> {
  const a = lerAuthData(b);
  if (a === null) return { erro: "authenticatorData fora do formato" };
  if (!iguais(a.rpIdHash, await sha256(new TextEncoder().encode(rp.rpId)))) return { erro: "a passkey é de outro site" };
  if ((a.flags & FLAG_UP) === 0) return { erro: "o autenticador não confirmou a presença da pessoa" };
  if ((a.flags & FLAG_UV) === 0) return { erro: "o autenticador não conferiu a pessoa (biometria ou senha do aparelho)" };
  return a;
}

export interface CadastroBruto { clientDataJSON: string; authenticatorData: string; publicKey: string; alg: number; transportes: string[]; nome: string | null }
const TRANSPORTE_RE = /^(usb|nfc|ble|internal|hybrid|smart-card|cable)$/;
const NOME_RE = /^[^\p{C}]{1,60}$/u;
const b64 = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max && B64_RE.test(v) ? v : null);
/** O corpo de `POST /conta/passkeys` (o console manda a resposta do `create()` em base64url). */
export function validaCadastro(raw: unknown): CadastroBruto | { erro: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { erro: "corpo inválido" };
  const o = raw as Record<string, unknown>;
  const clientDataJSON = b64(o.clientDataJSON, 4096), authenticatorData = b64(o.authenticatorData, 4096), publicKey = b64(o.publicKey, 2048);
  if (clientDataJSON === null || authenticatorData === null || publicKey === null) return { erro: "resposta do navegador incompleta; este navegador pode ser antigo demais para passkey" };
  if (o.alg !== ALG_ES256 && o.alg !== ALG_RS256) return { erro: "algoritmo da passkey não aceito" };
  const transportes = Array.isArray(o.transportes) ? [...new Set(o.transportes.filter((t): t is string => typeof t === "string" && TRANSPORTE_RE.test(t)))].slice(0, 7) : [];
  const nome = typeof o.nome === "string" && NOME_RE.test(o.nome.trim()) ? o.nome.trim() : null;
  return { clientDataJSON, authenticatorData, publicKey, alg: o.alg, transportes, nome };
}

export interface CadastroConferido { id: string; chave: string; alg: number; contador: number; sincronizada: boolean; desafio: string }
/** Confere a resposta do `create()`; quem chama confere (e gasta) o `desafio`. */
export async function conferirCadastro(c: CadastroBruto, rp: Rp): Promise<CadastroConferido | { erro: string }> {
  const cd = deB64url(c.clientDataJSON), ad = deB64url(c.authenticatorData), spki = deB64url(c.publicKey);
  if (cd === null || ad === null || spki === null) return { erro: "resposta do navegador fora do formato" };
  const cliente = lerClientData(cd, "webauthn.create", rp.origens);
  if ("erro" in cliente) return cliente;
  const a = await conferirAuthData(ad, rp);
  if ("erro" in a) return a;
  if (a.credId === null || a.resto === null) return { erro: "o autenticador não mandou a credencial" };
  if (!chaveConfere(spki, c.alg, a.resto)) return { erro: "a chave pública não é a que o autenticador criou" };
  if ((await importar(spki, c.alg)) === null) return { erro: "chave pública ilegível" };
  return { id: b64url(a.credId), chave: c.publicKey, alg: c.alg, contador: a.contador, sincronizada: (a.flags & FLAG_BE) !== 0, desafio: cliente.desafio };
}

export interface LoginBruto { id: string; clientDataJSON: string; authenticatorData: string; signature: string; userHandle: string | null; state: string; challenge: string; esquema: string; app: string | null; versao: string | null; org: string | null }
/** O corpo de `POST /sessao/passkey`: a resposta do `get()` mais o que o app pôs na URL de login (como em `POST /sessao`). */
export function validaLogin(raw: unknown): LoginBruto | { erro: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { erro: "corpo inválido" };
  const o = raw as Record<string, unknown>;
  const id = b64(o.id, 1400), clientDataJSON = b64(o.clientDataJSON, 4096), authenticatorData = b64(o.authenticatorData, 1024), signature = b64(o.signature, 1024);
  if (id === null || clientDataJSON === null || authenticatorData === null || signature === null) return { erro: "resposta da passkey incompleta" };
  const s = (v: unknown, re: RegExp): string | null => (typeof v === "string" && re.test(v) ? v : null);
  const state = s(o.state, TOKEN_RE), challenge = s(o.challenge, CHALLENGE_RE), esquema = s(o.esquema, ESQUEMA_RE);
  if (state === null) return { erro: "state ausente ou fora do formato" };
  if (challenge === null) return { erro: "challenge (PKCE) ausente ou fora do formato" };
  if (esquema === null) return { erro: "esquema do app ausente ou fora do formato" };
  const semOrg = o.org === undefined || o.org === null || o.org === "";
  const org = semOrg ? null : s(o.org, /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/);
  if (!semOrg && org === null) return { erro: "org: endereço da organização fora do formato" };
  return { id, clientDataJSON, authenticatorData, signature, userHandle: b64(o.userHandle, 200), state, challenge, esquema, app: s(o.app, APP_RE), versao: s(o.v, VERSAO_RE), org };
}

export interface ChaveGuardada { chave: string; alg: number; contador: number }
/**
 * Confere a resposta do `get()` contra a chave guardada: origem, RP, presença, verificação, assinatura sobre
 * authenticatorData || sha256(clientDataJSON) e o contador (se o autenticador conta, ele só sobe: um contador que
 * volta é sinal de chave clonada). Quem chama confere (e gasta) o `desafio`.
 */
export async function conferirLogin(l: Pick<LoginBruto, "clientDataJSON" | "authenticatorData" | "signature">, guardada: ChaveGuardada, rp: Rp): Promise<{ desafio: string; contador: number } | { erro: string }> {
  const cd = deB64url(l.clientDataJSON), ad = deB64url(l.authenticatorData), sig = deB64url(l.signature), spki = deB64url(guardada.chave);
  if (cd === null || ad === null || sig === null || spki === null) return { erro: "resposta da passkey fora do formato" };
  const cliente = lerClientData(cd, "webauthn.get", rp.origens);
  if ("erro" in cliente) return cliente;
  const a = await conferirAuthData(ad, rp);
  if ("erro" in a) return a;
  const chave = await importar(spki, guardada.alg);
  if (chave === null) return { erro: "chave guardada ilegível" };
  const dados = new Uint8Array(ad.length + 32);
  dados.set(ad); dados.set(await sha256(cd), ad.length);
  let ok = false;
  try {
    if (guardada.alg === ALG_ES256) { const raw = derParaRaw(sig); ok = raw !== null && await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, chave, raw, dados); }
    else ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", chave, sig, dados);
  } catch { ok = false; }
  if (!ok) return { erro: "a assinatura da passkey não confere" };
  if ((a.contador !== 0 || guardada.contador !== 0) && a.contador <= guardada.contador) return { erro: "o contador da passkey voltou; por segurança, remova esta passkey no console e crie outra" };
  return { desafio: cliente.desafio, contador: a.contador };
}
