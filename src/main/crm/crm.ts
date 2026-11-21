/**
 * Variante: cliente. Tutorial 18 · CRM pelo WhatsApp (módulo Pro), lado do SSH: lê/grava crm.json na máquina e
 * roda o `streak.mjs diag` dela para conferir a chave e listar os pipelines (crm-core.ts tem a parte pura).
 * Gate aqui também (acesso.ts; o renderer bloqueia, o job na máquina recusa sem licença): três camadas, como o Navegador.
 */
import type { CrmDiag, CrmInfo } from "../../shared/ipc";
import { crmInfoSh, parseCrmInfo, parseCrmPatch, parseStreakOut, resetCrmSh, setCrmSh, streakSh } from "./crm-core";
import { runSsh } from "../whatsapp/whatsapp";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";
import { log } from "../maquina/backend";
import { assertAcesso } from "../licenca/acesso";

const lastLine = (r: { stdout: string; stderr: string }): string => (r.stderr.trim() || r.stdout.trim()).split("\n").pop() || "ssh falhou";
const requirePro = (host: string): Promise<void> => assertAcesso(host);

export async function crmInfo(host: string): Promise<CrmInfo> {
  const none: CrmInfo = { available: false, installed: false, configured: false, streakKey: false, motor: null, pipelineKey: null, pipelineName: null, silencioMin: 10, criarSemPerguntar: false, savedAt: null };
  if (host === LOCAL_HOST || !isValidHost(host)) return none;
  const r = await runSsh(host, crmInfoSh(), 20_000);
  if (r.code !== 0 && r.stdout.trim() === "") throw new Error(`não consegui ler o CRM na máquina: ${lastLine(r)}`);
  return { available: true, ...parseCrmInfo(r.stdout) };
}
/** Grava chave, pipeline e regras (só o que veio); a chave nunca volta. */
export async function setCrm(host: string, payload: unknown): Promise<CrmInfo> {
  await requirePro(host);
  const patch = parseCrmPatch(payload);
  const r = await runSsh(host, `${setCrmSh(patch)}\n`, 30_000);
  if (r.code !== 0 || !r.stdout.includes("CRM=1")) throw new Error(`não deu para gravar na máquina: ${lastLine(r)}`);
  log(`[crm] ${host}: ${Object.keys(patch).join(",")}`);
  return crmInfo(host);
}
/** `streak.mjs diag` na máquina: valida a chave e lista os pipelines para a pessoa escolher. */
export async function crmTest(host: string): Promise<CrmDiag> {
  await requirePro(host);
  const r = await runSsh(host, streakSh("diag"), 90_000);
  const out = parseStreakOut(r.stdout);
  if (typeof out["erro"] === "string") return { ok: false, erro: out["erro"], usuario: null, pipelines: [], pipeline: null };
  const pipelines = Array.isArray(out["pipelines"]) ? (out["pipelines"] as unknown[]).filter((p): p is { key: string; name: string } => p !== null && typeof p === "object" && typeof (p as { key?: unknown }).key === "string" && typeof (p as { name?: unknown }).name === "string").map((p) => ({ key: p.key, name: p.name })) : [];
  const pi = out["pipeline"] !== null && typeof out["pipeline"] === "object" ? (out["pipeline"] as { name?: unknown; stages?: unknown; fields?: unknown; erro?: unknown }) : null;
  const names = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (x !== null && typeof x === "object" && typeof (x as { name?: unknown }).name === "string" ? (x as { name: string }).name : "")).filter(Boolean) : []);
  return { ok: true, erro: null, usuario: typeof out["usuario"] === "string" ? out["usuario"] : null, pipelines, pipeline: pi !== null && typeof pi.name === "string" ? { name: pi.name, stages: names(pi.stages), fields: names(pi.fields) } : null };
}
export async function resetCrm(host: string): Promise<CrmInfo> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  const r = await runSsh(host, `${resetCrmSh()}\n`, 20_000);
  if (r.code !== 0 || !r.stdout.includes("CRM=1")) throw new Error(`não deu para apagar: ${lastLine(r)}`);
  log(`[crm] ${host}: configuração apagada`);
  return crmInfo(host);
}
