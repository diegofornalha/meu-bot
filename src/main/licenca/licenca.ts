/**
 * Licença (meu-bot-admin): valida e monta o que o admin lê por SSH da máquina da pessoa (licenca.json e
 * maquinas.json). Puro, sem IO: a fronteira dona do formato do lado do admin. Vem de fora = dado, nunca comando.
 * Mesmo esquema do backend-colima/licenca.js (o backend é quem grava de fato); mudar os dois juntos.
 */
import type { License, LicenseDevice, LicensePatch, LicenseView, Pagamento, PlanName } from "../../shared/ipc";
import { ADDONS_DO_PERSONALIZADO, NAO_ADDON } from "../app/variant-core";

const PLANS: License["plan"][] = ["free", "pro"];
const STATUSES: License["status"][] = ["free", "trialing", "active", "expired"];
const INTERVALS: NonNullable<License["interval"]>[] = ["month", "year"];

const isIso = (v: unknown): v is string => typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v));
const nowIso = (now: number): string => new Date(now).toISOString();
/** Add-ons contratados (meu-bot-finance, meu-bot-fit…): nomes válidos, únicos, ordenados. */
const PRODUTO_NOME_RE = /^meu-bot-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Nomes que não são add-on (catálogo em app/variant-core.ts). */
const NAO_ADDON_SET = new Set(NAO_ADDON);
/** Id de device: o alias antigo (12 hex de hostname+usuário) ou o uuid v4 do device.json (conta meu-bot). Cópia em backend-colima/licenca.js. */
export const DEVICE_ID_RE = /^(?:[a-f0-9]{12}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
/** Id de máquina (uuid v4 do backend-colima, maquina.json) e de conta (uuid v4 da API da conta). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const parseProdutos = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && PRODUTO_NOME_RE.test(x) && !NAO_ADDON_SET.has(x)))].sort() : []);

/** Orientação de pagamento gravada pelo admin (texto até 2000, link só http(s)); vazia/inválida = null. Igual ao licenca.js. */
export function parsePagamento(v: unknown): Pagamento | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const instrucoes = typeof o.instrucoes === "string" ? o.instrucoes.trim().slice(0, 2000) : "";
  const link = typeof o.link === "string" && /^https?:\/\/\S+$/i.test(o.link.trim()) ? o.link.trim() : null;
  return instrucoes === "" && link === null ? null : { instrucoes, link };
}

/** Licença de uma conta ainda não configurada: grátis, um device. */
export function defaultLicense(now: number = Date.now()): License {
  const at = nowIso(now);
  return { plan: "free", status: "free", interval: null, memberSince: at, trialEnd: null, expiresAt: null, deviceLimit: 1, produtos: [], pagamento: null, updatedAt: at, updatedBy: "system" };
}

/** Normaliza o licenca.json lido; campo inválido/ausente cai no default (memberSince preservado). Nunca lança. */
export function parseLicense(raw: unknown, now: number = Date.now()): License {
  const base = defaultLicense(now);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const personalizado = o.plan === "personalizado";
  return {
    plan: personalizado ? "pro" : PLANS.includes(o.plan as License["plan"]) ? (o.plan as License["plan"]) : base.plan,
    status: STATUSES.includes(o.status as License["status"]) ? (o.status as License["status"]) : base.status,
    interval: INTERVALS.includes(o.interval as NonNullable<License["interval"]>) ? (o.interval as License["interval"]) : null,
    memberSince: isIso(o.memberSince) ? o.memberSince : base.memberSince,
    trialEnd: isIso(o.trialEnd) ? o.trialEnd : null,
    expiresAt: isIso(o.expiresAt) ? o.expiresAt : null,
    deviceLimit: Number.isInteger(o.deviceLimit) && (o.deviceLimit as number) >= 1 && (o.deviceLimit as number) <= 100 ? (o.deviceLimit as number) : base.deviceLimit,
    produtos: parseProdutos(personalizado ? [...(Array.isArray(o.produtos) ? o.produtos : []), ...ADDONS_DO_PERSONALIZADO] : o.produtos),
    pagamento: parsePagamento(o.pagamento),
    updatedAt: isIso(o.updatedAt) ? o.updatedAt : base.updatedAt,
    updatedBy: o.updatedBy === "admin" || o.updatedBy === "system" ? o.updatedBy : base.updatedBy,
  };
}

/** Aplica a mudança do admin (só campos válidos) e carimba updatedAt/updatedBy=admin. */
export function applyLicensePatch(current: unknown, patch: LicensePatch, now: number = Date.now()): License {
  const lic = parseLicense(current, now);
  const p = patch && typeof patch === "object" ? patch : {};
  const next: License = { ...lic };
  if (p.plan !== undefined && PLANS.includes(p.plan)) next.plan = p.plan;
  if (p.status !== undefined && STATUSES.includes(p.status)) next.status = p.status;
  if (p.interval !== undefined && (p.interval === null || INTERVALS.includes(p.interval))) next.interval = p.interval;
  if (p.trialEnd !== undefined && (p.trialEnd === null || isIso(p.trialEnd))) next.trialEnd = p.trialEnd;
  if (p.expiresAt !== undefined && (p.expiresAt === null || isIso(p.expiresAt))) next.expiresAt = p.expiresAt;
  if (p.deviceLimit !== undefined && Number.isInteger(p.deviceLimit) && p.deviceLimit >= 1 && p.deviceLimit <= 100) next.deviceLimit = p.deviceLimit;
  if (p.produtos !== undefined) next.produtos = parseProdutos(p.produtos);
  if (p.pagamento !== undefined) next.pagamento = parsePagamento(p.pagamento);
  next.updatedAt = nowIso(now);
  next.updatedBy = "admin";
  return next;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Licença em vigor: status active/trialing e, se houver validade, ainda não vencida. */
export function isActive(l: License, now: number = Date.now()): boolean {
  if (l.status !== "active" && l.status !== "trialing") return false;
  return !(l.expiresAt !== null && !Number.isNaN(Date.parse(l.expiresAt)) && Date.parse(l.expiresAt) < now);
}
/** Ordem dos planos: cada um libera o que os de baixo liberam. */
const RANK: Record<PlanName, number> = { free: 0, pro: 1 };
export const planoLibera = (tem: PlanName, exige: PlanName): boolean => RANK[tem] >= RANK[exige];
/** Módulos Pro do meu-bot (Navegador, CRM no Gmail e no WhatsApp): plano pro em vigor. */
export const proOk = (l: License, now: number = Date.now()): boolean => planoLibera(l.plan, "pro") && isActive(l, now);

export type AcessoProduto = "ok" | "ausente" | "expirada" | "unknown";
/**
 * CRM próprio (no Gmail e no WhatsApp) nesta máquina: faz parte do plano Pro em vigor. É por máquina (a licença mora
 * nela), nunca por variante do app. Mesma regra do renderer (lib/pro.ts) e do backend (licenca.js crmOk).
 */
export const crmProprioOk = (view: LicenseView | null, host: string, now: number = Date.now()): boolean =>
  host !== "local" && view !== null && proOk(view.license, now);
/**
 * Licença da máquina com a sua origem: `viaBackend` = veio de `GET /v1/meu-bot/license` do nosso backend-colima;
 * false = lida dos arquivos por SSH (a máquina roda outro backend, o do Hermes, ou o nosso está fora do ar).
 */
export interface LicencaDaMaquina { view: LicenseView | null; viaBackend: boolean }
/**
 * O CRM próprio *disponível* nesta máquina: a licença libera (crmProprioOk) E o nosso backend responde, porque a API
 * `/v1/crm/*` mora nele. Licença Pro lida por SSH numa máquina com outro backend não basta: carregar a extensão do CRM,
 * importar o Google ou guardar conversa ali só renderia 404 (grokbot-1, 25 out).
 */
export const crmDaMaquinaOk = (l: LicencaDaMaquina | null, host: string, now: number = Date.now()): boolean =>
  l !== null && l.viaBackend && crmProprioOk(l.view, host, now);
/** Licença vencida: status expired ou validade no passado (o plano free, sem validade, não está vencido). */
const vencida = (l: License, now: number): boolean => l.status === "expired" || (l.expiresAt !== null && !Number.isNaN(Date.parse(l.expiresAt)) && Date.parse(l.expiresAt) < now);
/**
 * Add-on contratado (meu-bot-finance…): add-ons são acumulativos por cima do plano, então basta `produto` estar em
 * `licenca.produtos` e a licença não estar vencida. "ausente" = não contratado; "expirada" = contratado mas vencida;
 * "unknown" = este Mac ou backend antigo/fora do ar (null).
 */
export function acessoAddon(view: LicenseView | null, host: string, produto: string, now: number = Date.now()): AcessoProduto {
  if (host === "local" || view === null) return "unknown";
  const l = view.license;
  if (!(l.produtos ?? []).includes(produto)) return "ausente";
  return vencida(l, now) ? "expirada" : "ok";
}
/** O app inteiro (caps.planoExigido): "free" nunca bloqueia (os módulos Pro têm o gate próprio); acima disso, o add-on `produto`. */
export const acessoProduto = (view: LicenseView | null, host: string, exige: PlanName, produto: string, now: number = Date.now()): AcessoProduto =>
  exige === "free" ? "ok" : acessoAddon(view, host, produto, now);

const PRODUTO_RE = /^meu-bot(-[a-z0-9-]{1,30})?$/;
function parseApps(raw: unknown): LicenseDevice["apps"] {
  const out: LicenseDevice["apps"] = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!PRODUTO_RE.test(k) || v === null || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    out[k] = { version: str(e.version), lastSeen: str(e.lastSeen) };
  }
  return out;
}

/** Lê o maquinas.json (mapa id → entrada) e devolve os devices; status ausente (registro antigo) = ativo. */
export function parseDevices(raw: unknown): LicenseDevice[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: LicenseDevice[] = [];
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!DEVICE_ID_RE.test(id) || v === null || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    const status: LicenseDevice["status"] = e.status === "pending" ? "pending" : "active";
    out.push({
      id,
      name: str(e.name),
      user: str(e.user),
      platform: str(e.platform),
      app: str(e.app),
      firstSeen: str(e.firstSeen),
      lastSeen: str(e.lastSeen),
      status,
      requestedAt: isIso(e.requestedAt) ? e.requestedAt : null,
      apps: parseApps(e.apps),
    });
  }
  // Mais recentes primeiro, como a tabela "Last seen" do Rambox.
  out.sort((a, b) => (Date.parse(b.lastSeen) || 0) - (Date.parse(a.lastSeen) || 0));
  return out;
}

/** Monta a visão (licença + devices + contagens) a partir do que veio por SSH. */
export function buildLicenseView(licenseRaw: unknown, machinesRaw: unknown, now: number = Date.now()): LicenseView {
  const license = parseLicense(licenseRaw, now);
  const devices = parseDevices(machinesRaw);
  const activeCount = devices.filter((d) => d.status === "active").length;
  const pendingCount = devices.filter((d) => d.status === "pending").length;
  return { license, devices, activeCount, pendingCount, deviceLimit: license.deviceLimit };
}
