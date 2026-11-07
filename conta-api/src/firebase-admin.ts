/**
 * O Worker como administrador do Firebase Auth, sem Admin SDK: uma conta de serviço do projeto (secret
 * FIREBASE_ADMIN_SA, o JSON que o console do Firebase gera em Configurações › Contas de serviço) assina um JWT RS256,
 * troca por um access token do Google (1 h, guardado no isolate) e chama a REST do Identity Toolkit. Hoje serve
 * para o super admin definir a senha de uma conta (projects/<id>/accounts:update). A chave Web não faz isso.
 */
import { b64url } from "./sessao-core.js";

export interface ContaServico { client_email: string; private_key: string; token_uri?: string }
const ESCOPO = "https://www.googleapis.com/auth/identitytoolkit";
const enc = new TextEncoder();

/** O JSON da conta de serviço, só com o que usamos; null se não for uma. */
export function parseContaServico(raw: unknown): ContaServico | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.client_email !== "string" || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(r.client_email)) return null;
  if (typeof r.private_key !== "string" || !r.private_key.includes("-----BEGIN PRIVATE KEY-----")) return null;
  return { client_email: r.client_email, private_key: r.private_key, token_uri: typeof r.token_uri === "string" ? r.token_uri : "https://oauth2.googleapis.com/token" };
}
/** PEM PKCS#8 → DER. */
export function pemParaDer(pem: string): Uint8Array<ArrayBuffer> {
  const bin = atob(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** As claims do JWT de conta de serviço (RFC 7523 como o Google pede): iss = sub = e-mail, scope, aud = token_uri. */
export const claimsServico = (sa: ContaServico, agoraS: number): Record<string, unknown> => ({ iss: sa.client_email, sub: sa.client_email, scope: ESCOPO, aud: sa.token_uri, iat: agoraS, exp: agoraS + 3600 });

export async function assinarJwtServico(sa: ContaServico, agoraS = Math.floor(Date.now() / 1000)): Promise<string> {
  const chave = await crypto.subtle.importKey("pkcs8", pemParaDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const corpo = `${b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${b64url(enc.encode(JSON.stringify(claimsServico(sa, agoraS))))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave, enc.encode(corpo));
  return `${corpo}.${b64url(sig)}`;
}

let cache: { token: string; expiraMs: number } | null = null;
/** Access token do Google para a conta de serviço; guardado no isolate até 5 min antes de vencer. */
export async function tokenDeServico(saJson: string): Promise<string> {
  if (cache !== null && cache.expiraMs > Date.now()) return cache.token;
  let raw: unknown; try { raw = JSON.parse(saJson); } catch { raw = null; }
  const sa = parseContaServico(raw);
  if (sa === null) throw new Error("FIREBASE_ADMIN_SA não é o JSON de uma conta de serviço");
  const r = await fetch(sa.token_uri!, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await assinarJwtServico(sa) }) });
  const j = (await r.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
  if (!r.ok || j === null || typeof j.access_token !== "string") throw new Error(`token da conta de serviço recusado: ${j?.error_description ?? j?.error ?? `HTTP ${r.status}`}`);
  cache = { token: j.access_token, expiraMs: Date.now() + ((j.expires_in ?? 3600) - 300) * 1000 };
  return cache.token;
}

/** O que o Firebase sabe de um uid (accounts:lookup): diagnóstico do super admin; `users` vazio = não conhece. */
export async function consultarFirebase(saJson: string, projectId: string, uid: string, email: string): Promise<{ ok: true; porUid: unknown[]; porEmail: unknown[] } | { ok: false; erro: string }> {
  let token: string;
  try { token = await tokenDeServico(saJson); } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : String(e) }; }
  const busca = async (corpo: Record<string, string[]>): Promise<unknown[] | string> => {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:lookup`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(corpo) });
    const j = (await r.json().catch(() => null)) as { users?: unknown[]; error?: { message?: string } } | null;
    if (!r.ok) return `HTTP ${r.status} ${j?.error?.message ?? ""}`;
    return (j?.users ?? []).map((u) => { const x = u as Record<string, unknown>; return { localId: x.localId, email: x.email, providers: Array.isArray(x.providerUserInfo) ? (x.providerUserInfo as { providerId?: string }[]).map((p) => p.providerId) : [] }; });
  };
  const porUid = await busca({ localId: [uid] }), porEmail = await busca({ email: [email] });
  if (typeof porUid === "string") return { ok: false, erro: porUid };
  return { ok: true, porUid, porEmail: typeof porEmail === "string" ? [porEmail] : porEmail };
}
/** Define a senha de um usuário do Firebase (também cria o provedor "password" para quem só tinha Google). */
export async function definirSenhaFirebase(saJson: string, projectId: string, uid: string, senha: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  let token: string;
  try { token = await tokenDeServico(saJson); } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : String(e) }; }
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:update`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ localId: uid, password: senha }) });
  if (r.ok) return { ok: true };
  const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
  const msg = j?.error?.message ?? `HTTP ${r.status}`;
  if (r.status === 401 || r.status === 403) cache = null; // token velho ou sem papel: na próxima tenta de novo
  return { ok: false, erro: msg };
}
