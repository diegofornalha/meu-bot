/**
 * Registro de auditoria pelo app: quem agiu (o dono, ou o admin pelo nome do app dele), gravação na máquina
 * (auditoria.py vai junto pelo SSH) e envio à cópia central (usuário "auditoria" na caixa do suporte).
 *
 * A máquina é a fila: o app guarda só até onde já entregou (o hash da última linha, por máquina, em
 * userData/auditoria-entregue.json) e, depois de cada gravação, manda o que veio depois dele, inclusive linhas do
 * backend e dos plugins (sistema/agente). Sem rede, nada se perde: vai na próxima vez. A central carimba quem
 * entregou pela chave SSH (a do admin, ou a de entrega das pessoas) e ignora linhas repetidas.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { auditoriaLerSh, auditoriaSh, isApp, parseCentral, parseLinhas, type Acao, type AuditoriaCentral, type AuditoriaEntrada, type AuditoriaLinha } from "./auditoria-core";
import { adminAuditoriaSsh, adminName } from "../admin/support-admin";
import { clienteAuditoriaSsh, supportName } from "../client/support";
import { backendBundleDir } from "../maquina/hostProbe";
import { caps } from "../app/variant";
import { runSsh } from "../whatsapp/whatsapp";
import { log } from "../maquina/backend";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";

let py: string | null = null;
/** O auditoria.py do pacote do app (o mesmo que o backend instala na máquina). */
export function auditoriaPy(): string {
  py ??= fs.readFileSync(path.join(backendBundleDir(), "auditoria.py"), "utf8");
  return py;
}

/** Quem está agindo neste app: o admin (nome do app dele) ou o dono (o nome que deu no suporte). */
export function quemDoApp(): AuditoriaEntrada["quem"] {
  return caps().supportAdmin ? { tipo: "admin", nome: adminName() } : { tipo: "dono", nome: supportName() || "dono" };
}
/** O app que agiu, pelo nome real (meu-bot-staging inclusive): a história mostra de qual canal veio a ação. */
const appDoApp = (): AuditoriaEntrada["app"] => { const n = caps().nome; return isApp(n) ? n : "meu-bot"; };

/** Trecho de script que grava a ação (para ir junto de outro script na mesma conexão). */
export function registroSh(acao: Acao, alvo = "", detalhe = ""): string {
  return auditoriaSh(auditoriaPy(), { quem: quemDoApp(), app: appDoApp(), acao, alvo, detalhe });
}

/** Grava a ação na máquina e entrega à central em segundo plano. Falha de registro nunca desfaz a ação. */
export function registrar(host: string, acao: Acao, alvo = "", detalhe = ""): Promise<void> {
  return registrarVarios(host, [{ acao, alvo, detalhe }]);
}
/** Várias ações de uma vez (ex.: excluir em massa): uma conexão, uma linha por ação. */
export async function registrarVarios(host: string, acoes: readonly { acao: Acao; alvo?: string; detalhe?: string }[]): Promise<void> {
  if (host === LOCAL_HOST || !isValidHost(host) || acoes.length === 0) return;
  const nomes = [...new Set(acoes.map((a) => a.acao))].join(", ");
  try {
    const r = await runSsh(host, `${acoes.map((a) => registroSh(a.acao, a.alvo ?? "", a.detalhe ?? "")).join("\n")}\n`, 30_000);
    if (r.code !== 0) { log(`[auditoria] ${host}: não gravou ${nomes}: ${r.stderr.trim().split("\n").pop() ?? ""}`); return; }
  } catch (e) { log(`[auditoria] ${host}: não gravou ${nomes}: ${e instanceof Error ? e.message : String(e)}`); return; }
  void entregar(host);
}

const entreguePath = (): string => path.join(app.getPath("userData"), "auditoria-entregue.json");
function lerEntregue(): Record<string, string> {
  try { const v = JSON.parse(fs.readFileSync(entreguePath(), "utf8")) as unknown; return v !== null && typeof v === "object" ? v as Record<string, string> : {}; } catch { return {}; }
}

/** ssh para a central com a chave deste app (null = este app não tem chave para ela). */
function centralSsh(): string[] | null {
  return caps().supportAdmin ? adminAuditoriaSsh() : clienteAuditoriaSsh();
}
function sshComEntrada(args: string[], entrada: string, timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("ssh", args, { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, out, errOut) => (err ? reject(new Error(String(errOut).trim().split("\n").pop() || err.message)) : resolve(String(out))));
    child.stdin?.end(entrada);
  });
}

const entregando = new Map<string, Promise<void>>();
/** Manda à central o que a máquina gravou depois da última entrega (em lotes de 2000). */
export function entregar(host: string): Promise<void> {
  if (host === LOCAL_HOST || !isValidHost(host)) return Promise.resolve();
  const cur = entregando.get(host);
  if (cur !== undefined) return cur;
  const p = (async () => {
    const ssh = centralSsh();
    if (ssh === null) return;
    const feito = lerEntregue();
    const r = await runSsh(host, `${auditoriaLerSh(auditoriaPy(), { apos: feito[host] })}\n`, 30_000);
    const linhas = r.stdout.split("\n").filter((l) => l.startsWith("{")).slice(0, 2000);
    if (linhas.length === 0) return;
    const resp = await sshComEntrada([...ssh, "gravar"], `${linhas.join("\n")}\n`);
    const ultimo = parseLinhas(linhas.at(-1)!)[0]?.linha.hash;
    if (ultimo !== undefined) fs.writeFileSync(entreguePath(), JSON.stringify({ ...lerEntregue(), [host]: ultimo }, null, 1), { mode: 0o600 });
    log(`[auditoria] ${host}: ${resp.trim()} na central`);
  })().catch((e: unknown) => { log(`[auditoria] ${host}: central fora: ${e instanceof Error ? e.message : String(e)}`); }).finally(() => entregando.delete(host));
  entregando.set(host, p);
  return p;
}

/** As `n` últimas linhas do registro da máquina (a pessoa e o admin veem). */
export async function lerRegistro(host: string, n: number): Promise<AuditoriaLinha[]> {
  const r = await runSsh(host, `${auditoriaLerSh(auditoriaPy(), { n })}\n`, 30_000);
  if (r.code !== 0) throw new Error("não consegui ler o registro desta máquina");
  return parseLinhas(r.stdout).map((x) => x.linha);
}
/** O registro inteiro da máquina, com os objetos originais (para conferir a corrente). */
export async function lerRegistroBruto(host: string): Promise<Record<string, unknown>[]> {
  const r = await runSsh(host, `${auditoriaLerSh(auditoriaPy(), {})}\n`, 60_000);
  if (r.code !== 0) throw new Error("não consegui ler o registro desta máquina");
  return parseLinhas(r.stdout).map((x) => x.bruto);
}

/** Super admin: o registro central de uma máquina. */
export async function centralRegistro(maquina: string): Promise<{ registro: AuditoriaCentral; bruto: Record<string, unknown> }[]> {
  if (!/^[0-9a-f]{12}$/.test(maquina)) throw new Error("máquina inválida");
  const ssh = adminAuditoriaSsh();
  if (ssh === null) throw new Error("este meu-bot-admin não tem acesso à central de auditoria");
  return parseCentral(await sshComEntrada([...ssh, "ler", maquina], ""));
}
