/**
 * Importar uma skill pelo link do repositório, lado do SSH (a parte pura é skills-importar-core.ts): pede a prévia à
 * máquina da janela, instala o commit visto, lista e remove. A instalação só aceita a prévia que esta janela acabou de
 * pedir: o nome e o commit vêm do que a máquina leu, nunca do que a tela manda.
 */
import type { SkillImportada, SkillInstalada, SkillPrevia, SkillPreviaResultado } from "../../shared/ipc";
import { instalarSh, linkDaSkill, listarSh, parseInstalar, parseLista, parsePrevia, previaSh, removerSh, SKILL_NOME_RE } from "./skills-importar-core";
import { runSsh } from "../whatsapp/whatsapp";
import { isValidHost } from "../app/settings";
import { LOCAL_HOST } from "../maquina/localBackend";
import { log } from "../maquina/backend";
import { registrar } from "../auditoria/auditoria";

const hostOk = (host: string): boolean => host === LOCAL_HOST || isValidHost(host);
const lastLine = (r: { stdout: string; stderr: string }): string => (r.stderr.trim() || r.stdout.trim()).split("\n").pop() || "sem resposta da máquina";
/** A última prévia de cada máquina e quando foi pedida: é ela que o "Instalar" instala. */
const previas = new Map<string, { previa: SkillPrevia; em: number }>();
const PREVIA_VALE_MS = 30 * 60_000;

export async function skillsImportadas(host: string): Promise<SkillImportada[]> {
  if (!hostOk(host)) return [];
  const r = await runSsh(host, listarSh(), 20_000);
  if (!r.stdout.includes("FIM=1")) throw new Error(`não consegui ler as skills importadas: ${lastLine(r)}`);
  return parseLista(r.stdout);
}

export async function skillPrevia(host: string, link: unknown): Promise<SkillPreviaResultado> {
  if (!hostOk(host)) return { ok: false, erro: "máquina inválida" };
  const url = linkDaSkill(link);
  if (url === null) return { ok: false, erro: "isso não parece o link de um repositório. Cole o endereço do GitHub (https://github.com/dono/repositorio) ou só dono/repositorio" };
  previas.delete(host);
  const r = await runSsh(host, previaSh(url), 150_000);
  if (r.code === null && r.stdout.trim() === "") return { ok: false, erro: `a máquina não respondeu a tempo: ${lastLine(r)}` };
  const res = parsePrevia(r.stdout, url);
  if (res.ok) previas.set(host, { previa: res.previa, em: Date.now() });
  return res;
}

export async function skillInstalar(host: string, commit: unknown): Promise<SkillInstalada> {
  if (!hostOk(host)) throw new Error("máquina inválida");
  const p = previas.get(host);
  if (p === undefined || p.previa.commit !== commit || Date.now() - p.em > PREVIA_VALE_MS) throw new Error("a prévia venceu; peça a prévia de novo antes de instalar");
  const r = await runSsh(host, instalarSh(p.previa.url, p.previa.commit, p.previa.nome, new Date().toISOString()), 180_000);
  const res = parseInstalar(r.stdout);
  if (!res.ok) throw new Error(res.erro === "a instalação não concluiu" ? `a instalação não concluiu: ${lastLine(r)}` : res.erro);
  previas.delete(host);
  log(`[skills] ${host}: ${p.previa.nome} importada de ${p.previa.rotulo} (${p.previa.commit.slice(0, 7)}) em ${res.destinos.map((d) => d.agente).join(", ")}`);
  void registrar(host, res.atualizou ? "skill.atualizar" : "skill.importar", p.previa.nome, `${p.previa.rotulo}, commit ${p.previa.commit.slice(0, 7)}`);
  // A skill já está instalada e registrada: a releitura da lista não pode transformar isso em "falhou" na tela.
  const skills = await skillsImportadas(host).catch((e: unknown) => { log(`[skills] ${host}: instalou, mas não reli a lista: ${e instanceof Error ? e.message : String(e)}`); return null; });
  return { skills, destinos: res.destinos };
}

export async function skillRemover(host: string, nome: unknown): Promise<SkillImportada[]> {
  if (!hostOk(host)) throw new Error("máquina inválida");
  if (typeof nome !== "string" || !SKILL_NOME_RE.test(nome)) throw new Error("skill inválida");
  const r = await runSsh(host, removerSh(nome), 30_000);
  if (!r.stdout.includes("OK=1")) throw new Error(r.stdout.includes("ERRO=ausente") ? "essa skill não está mais importada nesta máquina" : `não deu para remover: ${lastLine(r)}`);
  log(`[skills] ${host}: ${nome} removida`);
  void registrar(host, "skill.remover", nome);
  return skillsImportadas(host);
}
