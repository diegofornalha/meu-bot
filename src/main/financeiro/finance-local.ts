/**
 * Financeiro da máquina (produto meu-bot-finance) pelo túnel: o mesmo caminho do crm-local.ts, sobre /v1/finance/*.
 * A página Finanças e o tutorial 12 leem e mexem por aqui; a validação final é da máquina (finance-modelo.js), e a
 * licença é conferida nas três camadas (renderer, acesso.ts › assertFinance, backend › financeOk).
 */
import type { FinanceImportacao, FinanceAbc, FinanceAbcLado, FinanceAbcPor, FinanceCategoria, FinanceConfig, FinanceConta, FinanceEstado, FinanceInfo, FinanceLancamento, FinanceLancarInput } from "../../shared/ipc";
import { ensureTunnel } from "../maquina/tunnel";
import { getBackendPort } from "../app/settings";
import { runSsh } from "../whatsapp/whatsapp";
import { lerValoresPlanilha } from "../google/planilha";
import { idDaPlanilha } from "../google/planilha-core";

type Metodo = "GET" | "POST" | "PUT";
/** Erro da API do financeiro com o código que a máquina mandou (ex.: finance_modulo), para quem precisa decidir por ele. */
class FinanceApiErro extends Error { constructor(message: string, readonly code: string | null) { super(message); } }
async function api<T>(host: string, method: Metodo, rota: string, body?: unknown): Promise<T> {
  const t = await ensureTunnel(host, getBackendPort(host));
  const r = await fetch(`http://127.0.0.1:${t.localPort}/v1/finance${rota}`, {
    method,
    headers: { authorization: `Bearer ${t.apiKey}`, "content-type": "application/json", "x-finance-por": "app" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await r.json().catch(() => null)) as (Record<string, unknown> & { error?: { message?: string; code?: string } }) | null;
  if (!r.ok) {
    if (j?.error?.code === "finance_license") throw new Error("FINANCE_REQUIRED");
    // Backend de antes do financeiro: o server.js responde 404 sem o código do financeiro.
    if (r.status === 404 && j?.error?.code !== "nao_encontrado") throw new Error("o backend desta máquina é anterior ao financeiro: atualize-o pelo seletor (Reinstalar backend)");
    throw new FinanceApiErro(j?.error?.message ?? `o financeiro respondeu ${r.status}`, j?.error?.code ?? null);
  }
  return j as T;
}

/** O módulo (CLI + plugin) está na máquina? null = não deu para saber (fora do ar). */
async function moduloInstalado(host: string): Promise<boolean | null> {
  const r = await runSsh(host, '[ -f "$HOME/.local/share/meu-bot/finance/finance.mjs" ] && echo finance=1 || echo finance=0', 20_000);
  return r.code !== 0 ? null : r.stdout.includes("finance=1");
}

export async function financeInfo(host: string): Promise<FinanceInfo> {
  const [modulo, estado] = await Promise.all([
    moduloInstalado(host).catch(() => null),
    api<FinanceEstado>(host, "GET", "/estado").then((e) => ({ e, erro: null as string | null, virouModulo: false }))
      .catch((err: unknown) => err instanceof FinanceApiErro && err.code === "finance_modulo" ? { e: null, erro: null, virouModulo: true } : { e: null, erro: err instanceof Error ? err.message : String(err), virouModulo: false }),
  ]);
  return { modulo, estado: estado.e, erro: estado.erro, virouModulo: estado.virouModulo };
}
const q = (o: Record<string, string | number | undefined>): string => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v)); const s = p.toString(); return s === "" ? "" : `?${s}`; };
export const financeLancamentos = (host: string, f: { mes?: string; status?: string; limite?: number } = {}): Promise<{ total: number; lancamentos: FinanceLancamento[] }> =>
  api(host, "GET", `/lancamentos${q({ mes: f.mes, status: f.status, limite: f.limite })}`);
export const financeCategorias = async (host: string): Promise<FinanceCategoria[]> => (await api<{ categorias: FinanceCategoria[] }>(host, "GET", "/categorias")).categorias;
export const financeLancar = async (host: string, input: FinanceLancarInput): Promise<FinanceLancamento> =>
  (await api<{ lancamento: FinanceLancamento }>(host, "POST", input.tipo === "renda" ? "/renda" : "/lancamentos", { ...input, ...(input.tipo === "renda" ? { fonte: input.favorecido } : {}), origem: "app", status: "confirmado" })).lancamento;
export const financeConfirmar = async (host: string, id: string, categoria?: string): Promise<FinanceLancamento> =>
  (await api<{ lancamento: FinanceLancamento }>(host, "POST", `/lancamentos/${encodeURIComponent(id)}/confirmar`, categoria ? { categoria } : {})).lancamento;
export const financeDescartar = async (host: string, id: string): Promise<void> => { await api(host, "POST", `/lancamentos/${encodeURIComponent(id)}/descartar`, {}); };
export const financeCorrigir = async (host: string, id: string, patch: Record<string, string | null>): Promise<FinanceLancamento> =>
  (await api<{ lancamento: FinanceLancamento }>(host, "PUT", `/lancamentos/${encodeURIComponent(id)}`, patch)).lancamento;
/** Foto do comprovante como data URL (o tipo sai dos primeiros bytes: JPEG, PNG, WebP ou HEIC; o resto como JPEG). */
export async function financeComprovante(host: string, sha256: string): Promise<string | null> {
  try {
    const { base64 } = await api<{ base64: string }>(host, "GET", `/comprovantes/${encodeURIComponent(sha256)}`);
    const b = Buffer.from(base64.slice(0, 24), "base64");
    const tipo = b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b.slice(8, 12).toString("latin1") === "WEBP" ? "image/webp" : b.slice(4, 12).toString("latin1").includes("ftyphei") ? "image/heic" : "image/jpeg";
    return `data:${tipo};base64,${base64}`;
  } catch { return null; }
}
export async function financeLinhaSalvar(host: string, l: { key?: string; nome: string; tipo: string; valor: string | null; notas?: string }): Promise<void> {
  const corpo = { nome: l.nome, tipo: l.tipo, valor: l.valor, ...(l.notas !== undefined ? { notas: l.notas } : {}) };
  if (l.key === undefined) await api(host, "POST", "/linhas", corpo); else await api(host, "PUT", `/linhas/${encodeURIComponent(l.key)}`, corpo);
}
export const financeLinhaRemover = async (host: string, key: string): Promise<void> => { await api(host, "POST", `/linhas/${encodeURIComponent(key)}/remover`, {}); };
export const financeConfirmarTodas = (host: string): Promise<{ confirmados: number; restantes: number }> => api(host, "POST", "/pendencias/confirmar-todas", {});
export const financeContaCriar = async (host: string, input: { nome: string; tipo?: string; moeda?: string; saldoInicial?: string }): Promise<FinanceConta> => (await api<{ conta: FinanceConta }>(host, "POST", "/contas", input)).conta;
export const financeConfigLer = async (host: string): Promise<FinanceConfig> => (await api<{ config: FinanceConfig }>(host, "GET", "/config")).config;
export const financeConfig = async (host: string, patch: { taxas?: Record<string, number>; moedaExibicao?: string }): Promise<FinanceConfig> => (await api<{ config: FinanceConfig }>(host, "PUT", "/config", patch)).config;
export const financeMes = async (host: string, mes: string, patch: { metaDireto?: string | null; metaIndireto?: string | null; metaNotas?: string; orcamento?: string | null; rendaPrevista?: string | null; dinheiroInformado?: boolean }): Promise<void> => { await api(host, "PUT", `/meses/${encodeURIComponent(mes)}`, patch); };
export const financeFecharMes = async (host: string, mes: string): Promise<void> => { await api(host, "POST", "/fechamento", { mes }); };
/**
 * Importa uma planilha do Google Sheets no financeiro da máquina: o Mac lê as células com a Conta Google do app
 * (escopo de planilhas; a planilha precisa estar compartilhada com essa conta) e a máquina interpreta e grava
 * (finance-modelo.js › linhasDePlanilha, rota /importar). Sem aba, lê a primeira.
 */
export async function financeImportarPlanilha(host: string, p: { link: string; aba?: string; tipo: FinanceAbcLado; simular: boolean }): Promise<FinanceImportacao> {
  const id = idDaPlanilha(p.link);
  if (id === null) throw new Error("cole o link da planilha do Google Sheets (docs.google.com/spreadsheets/d/…)");
  const aba = (p.aba ?? "").trim().slice(0, 100);
  const valores = await lerValoresPlanilha(host, id, aba);
  const r = await api<Omit<FinanceImportacao, "planilha">>(host, "POST", "/importar", { valores, fonte: `sheets:${id}${aba ? `:${aba}` : ""}`, tipo: p.tipo === "venda" ? "renda" : "gasto", simular: p.simular });
  return { ...r, planilha: id };
}
/** Curva ABC da máquina (a regra é do finance-modelo.js › curvaABC). */
export const financeAbc = (host: string, f: { lado: FinanceAbcLado; por: FinanceAbcPor; meses: number; ate?: string }): Promise<FinanceAbc> =>
  api<FinanceAbc>(host, "GET", `/abc?${new URLSearchParams({ lado: f.lado, por: f.por, meses: String(f.meses), ...(f.ate ? { ate: f.ate } : {}) }).toString()}`);
