/**
 * Licença da CONTA assinada (Ed25519), a parte pura: formato, verificação e a vista que o app mostra.
 *
 * Com a conta meu-bot (login no navegador, molde Rambox), a licença deixa de ser um arquivo que o admin grava por SSH
 * e passa a ser emitida pela API da conta (conta.agentesgrok.com) para UMA máquina: `payload` são os bytes JSON
 * exatos que a API produziu (guardados em base64url, sem canonicalizar), `sig` é a assinatura Ed25519 crua deles em
 * base64, e `kid` diz qual chave pública confere. Quem verifica (este app e o backend-colima da máquina, que tem a
 * cópia em backend-colima/licenca.js) decodifica o payload, confere a assinatura e usa o payload como verdade; os
 * campos de topo do licenca.json são só espelho legível para o backend antigo.
 *
 * As chaves são próprias da licença (não as das releases): a privada mora no Worker da API como secret; a reserva,
 * só no gerenciador de senhas (scripts/chave-licenca.mjs). A verificação é a mesma das releases
 * (verificaAssinatura, src/main/atualizacao/updater-core.ts).
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import type { License, LicenseDevice, LicenseView } from "../../shared/ipc";
import { verificaAssinatura } from "../atualizacao/updater-core";
import { buildLicenseView, DEVICE_ID_RE, parseLicense, proOk, UUID_RE } from "../licenca/licenca";

export { DEVICE_ID_RE, UUID_RE };

/**
 * Chaves públicas Ed25519 da licença (SPKI DER em base64). A principal assina toda licença emitida; a reserva existe
 * para trocar de chave sem reinstalar ninguém. Mesma lista em backend-colima/licenca.js (o teste
 * licenca-assinada-core confere).
 */
export const LICENCA_PUBLIC_KEYS: readonly { id: string; chave: string }[] = [
  { id: "licenca-2026-11", chave: "MCowBQYDK2VwAyEA+E6wqc9j/NjhAhNLnLtDT1GLmA0cchXaepFJ0rLt3Zg=" },
];

/** Quanto a cópia assinada vale sem renovar (folga para ficar offline); a API carimba `exp` = emitidaEm + isto. */
export const LICENCA_VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;

/** O bloco `assinada` do licenca.json v2. */
export interface LicencaAssinada { kid: string; payload: string; sig: string }
/** O que a API assinou. `licenca` tem o mesmo esquema de License; `devices` são os Macs da conta e o status de cada um. */
export interface PayloadLicenca {
  v: 2;
  conta: { id: string; email: string };
  maquina: string;
  emitidaEm: string;
  exp: string;
  licenca: License;
  devices: { id: string; status: "active" | "pending" }[];
}
export type MotivoLicencaInvalida = "sem-assinatura" | "formato" | "assinatura" | "expirada";
export type VerificacaoLicenca = { ok: true; payload: PayloadLicenca; kid: string } | { ok: false; motivo: MotivoLicencaInvalida };

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isIso = (v: unknown): v is string => typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v));
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

export const base64url = (b: Buffer): string => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function deBase64url(s: string): Buffer | null {
  if (!B64URL_RE.test(s)) return null;
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** O bloco `assinada` como veio do arquivo ou da API; null se não é um bloco (kid, payload base64url, sig base64). */
export function parseLicencaAssinada(raw: unknown): LicencaAssinada | null {
  if (!isObj(raw)) return null;
  const { kid, payload, sig } = raw;
  if (typeof kid !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(kid)) return null;
  if (typeof payload !== "string" || payload === "" || !B64URL_RE.test(payload)) return null;
  if (typeof sig !== "string" || !/^[A-Za-z0-9+/]{86}==\s*$/.test(sig)) return null;
  return { kid, payload, sig: sig.trim() };
}

/** O payload decodificado, validado campo a campo; null se não é o que a API emite. */
export function parsePayloadLicenca(raw: unknown, now: number = Date.now()): PayloadLicenca | null {
  if (!isObj(raw) || raw.v !== 2) return null;
  const { conta, maquina, emitidaEm, exp, devices } = raw;
  if (!isObj(conta) || typeof conta.id !== "string" || !UUID_RE.test(conta.id) || typeof conta.email !== "string" || conta.email === "") return null;
  if (typeof maquina !== "string" || !UUID_RE.test(maquina)) return null;
  if (!isIso(emitidaEm) || !isIso(exp) || Date.parse(exp) < Date.parse(emitidaEm)) return null;
  if (!isObj(raw.licenca) || !Array.isArray(devices)) return null;
  const ds: PayloadLicenca["devices"] = [];
  for (const d of devices) {
    if (!isObj(d) || typeof d.id !== "string" || !DEVICE_ID_RE.test(d.id)) return null;
    if (d.status !== "active" && d.status !== "pending") return null;
    ds.push({ id: d.id, status: d.status });
  }
  return { v: 2, conta: { id: conta.id, email: conta.email }, maquina, emitidaEm, exp, licenca: parseLicense(raw.licenca, now), devices: ds };
}

/**
 * Verifica um licenca.json (o objeto inteiro, ou só o bloco `assinada`): a assinatura confere com a chave `kid` (ou,
 * faltando ela na lista, com qualquer uma das aceitas), o payload é o que a API emite e ainda não venceu. `maquina`
 * dado = exige que a licença seja desta máquina. Nunca lança.
 */
export function verificaLicencaAssinada(raw: unknown, opts: { chaves?: readonly { id: string; chave: string }[]; now?: number; maquina?: string } = {}): VerificacaoLicenca {
  const chaves = opts.chaves ?? LICENCA_PUBLIC_KEYS, now = opts.now ?? Date.now();
  if (!isObj(raw)) return { ok: false, motivo: "sem-assinatura" };
  // O licenca.json inteiro (bloco em `assinada`; v1 legado não o tem) ou o bloco sozinho (tem `payload` e `sig`).
  const bloco = "assinada" in raw ? raw.assinada : "payload" in raw && "sig" in raw ? raw : undefined;
  if (bloco === undefined || bloco === null) return { ok: false, motivo: "sem-assinatura" };
  const a = parseLicencaAssinada(bloco);
  if (a === null) return { ok: false, motivo: "formato" };
  const bytes = deBase64url(a.payload);
  if (bytes === null) return { ok: false, motivo: "formato" };
  const daKid = chaves.filter((k) => k.id === a.kid).map((k) => k.chave);
  if (!verificaAssinatura(bytes, a.sig, daKid.length > 0 ? daKid : chaves.map((k) => k.chave))) return { ok: false, motivo: "assinatura" };
  let json: unknown;
  try { json = JSON.parse(bytes.toString("utf8")); } catch { return { ok: false, motivo: "formato" }; }
  const payload = parsePayloadLicenca(json, now);
  if (payload === null) return { ok: false, motivo: "formato" };
  if (opts.maquina !== undefined && payload.maquina !== opts.maquina) return { ok: false, motivo: "formato" };
  if (Date.parse(payload.exp) < now) return { ok: false, motivo: "expirada" };
  return { ok: true, payload, kid: a.kid };
}

/** De onde vem o plano em vigor numa máquina: do que o admin gravou ou da licença da conta da pessoa. */
export type OrigemLicenca = "admin" | "conta";
const vencida = (l: License, now: number): boolean => l.status === "expired" || (l.expiresAt !== null && Date.parse(l.expiresAt) < now);
/**
 * A licença em vigor numa máquina: a que o admin gravou (`licenca.json`) somada à da conta da pessoa
 * (`licenca-conta.json`, assinada pela API para a máquina `maquina`). A máquina tem o Pro se uma das duas der; os
 * add-ons são a união dos que cada licença não vencida traz. Limite de devices e orientação de pagamento seguem os do
 * admin, que são daquela máquina. Arquivo da conta ausente, mexido, de outra máquina ou vencido não conta: vale só a
 * do admin. `exp` é até quando a emissão da conta sustenta isso (null quando ela não entra). Mesma regra de
 * `licencaEmVigor` em backend-colima/licenca.js (o teste licenca-assinada-core compara as duas).
 */
export function licencaEmVigor(admin: unknown, rawConta: unknown, maquina: string | null, opts: { chaves?: readonly { id: string; chave: string }[]; now?: number } = {}): { license: License; origem: OrigemLicenca; exp: string | null } {
  const now = opts.now ?? Date.now();
  const base = parseLicense(admin, now);
  if (maquina === null || !UUID_RE.test(maquina)) return { license: base, origem: "admin", exp: null };
  const v = verificaLicencaAssinada(rawConta, { ...(opts.chaves === undefined ? {} : { chaves: opts.chaves }), now, maquina });
  if (!v.ok) return { license: base, origem: "admin", exp: null };
  const conta = v.payload.licenca;
  const produtos = [...new Set([...(vencida(base, now) ? [] : base.produtos), ...(vencida(conta, now) ? [] : conta.produtos)])].sort();
  // A da conta entra quando dá o que a do admin não dá: o Pro, ou (sem Pro em nenhuma) add-ons com a do admin vencida.
  const usaConta = proOk(base, now) ? false : proOk(conta, now) || (vencida(base, now) && !vencida(conta, now));
  if (!usaConta) return { license: { ...base, produtos }, origem: "admin", exp: null };
  return { license: { ...conta, deviceLimit: base.deviceLimit, pagamento: base.pagamento, produtos }, origem: "conta", exp: v.payload.exp };
}

/** A licença mais recente vale (a API carimba `emitidaEm`); empate = não é mais nova. */
export const maisNova = (a: PayloadLicenca, b: PayloadLicenca): boolean => Date.parse(a.emitidaEm) > Date.parse(b.emitidaEm);

/**
 * A vista da licença a partir do payload: o status de cada device vem dele (a API é a verdade), e nome, sistema e
 * apps vêm da telemetria da máquina (maquinas.json) quando ela conhece o device; device que só a API conhece entra
 * com o que há.
 */
export function viewDaAssinada(p: PayloadLicenca, telemetria: readonly LicenseDevice[] = [], now: number = Date.now()): LicenseView {
  const porId = new Map(telemetria.map((d) => [d.id, d]));
  const maquinas: Record<string, unknown> = {};
  for (const d of p.devices) {
    const t = porId.get(d.id);
    maquinas[d.id] = t === undefined ? { status: d.status, firstSeen: p.emitidaEm, lastSeen: p.emitidaEm } : { ...t, status: d.status, requestedAt: d.status === "pending" ? t.requestedAt : null };
  }
  return buildLicenseView(p.licenca, maquinas, now);
}

/** Assina um payload (a API, os testes e o `--testar` do chave-licenca.mjs): os bytes JSON exatos vão no `payload`. */
export function assinarLicenca(p: PayloadLicenca, privada: KeyObject | string, kid: string): LicencaAssinada {
  const k = typeof privada === "string" ? createPrivateKey({ key: Buffer.from(privada, "base64"), format: "der", type: "pkcs8" }) : privada;
  const bytes = Buffer.from(JSON.stringify(p), "utf8");
  return { kid, payload: base64url(bytes), sig: sign(null, bytes, k).toString("base64") };
}

/** O licenca.json v2 inteiro: a cópia legível no topo (para quem não verifica) e o bloco assinado. */
export function licencaJsonV2(p: PayloadLicenca, assinada: LicencaAssinada): Record<string, unknown> {
  return { ...p.licenca, v: 2, conta: p.conta, maquina: p.maquina, emitidaEm: p.emitidaEm, exp: p.exp, assinada };
}
