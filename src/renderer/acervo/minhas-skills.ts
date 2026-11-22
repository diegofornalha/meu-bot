/**
 * Acervo › Minhas skills: importar uma skill pelo link do repositório (docs/planos/marketplace-skills.md, fase 1). A
 * máquina baixa, a pessoa vê nome, descrição, arquivos e commit, e só então instala. A skill roda com as permissões do
 * agente e, por este caminho, ninguém a revisou: por isso a prévia vem antes e o aviso fica à vista.
 */
import type { SkillDestino, SkillImportada, SkillPrevia } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { hostLabel } from "../lib/probe-text.js";
import { shortDate } from "../lib/sidebar.js";
import { ctx } from "../app/ctx.js";

let skills: SkillImportada[] | null = null;
let link = "";
let previa: SkillPrevia | null = null;
let ocupado: "previa" | "instalar" | "remover" | null = null;
let msg: { text: string; bad: boolean } | null = null;
let removendo: string | null = null;

/** Nomes das skills importadas: o Acervo as tira da lista de "aprendidas" (elas moram na mesma pasta do Claude). */
export const nomesImportados = (): ReadonlySet<string> => new Set((skills ?? []).map((s) => s.nome));
const repinta = (): void => { if (ctx.pageShown(ctx.acervoPage)) ctx.acervoPage.render(); };
const tamanho = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
export function textoDestinos(d: readonly SkillDestino[]): string {
  const onde = d.map((x) => x.agente).join(", ");
  const editadas = d.filter((x) => x.editada).map((x) => x.agente);
  return `instalada em: ${onde}${editadas.length > 0 ? `. No ${editadas.join(" e no ")} o SKILL.md que o agente tinha editado foi mantido` : ""}.`;
}

export async function refreshSkillsImportadas(): Promise<void> {
  try { skills = await window.meuBot.skillsImportadas(); } catch { skills = skills ?? []; }
  repinta();
}
async function pedirPrevia(l: string): Promise<void> {
  if (ocupado !== null || l.trim() === "") return;
  link = l.trim(); ocupado = "previa"; msg = null; previa = null; repinta();
  try {
    const r = await window.meuBot.skillPrevia(link);
    if (r.ok) previa = r.previa; else msg = { text: `✗ ${r.erro}`, bad: true };
  } catch (err) { msg = { text: `✗ ${ipcErrorText(err)}`, bad: true }; }
  finally { ocupado = null; repinta(); }
}
async function instalar(p: SkillPrevia): Promise<void> {
  if (ocupado !== null) return;
  ocupado = "instalar"; msg = null; repinta();
  try {
    const r = await window.meuBot.skillInstalar(p.commit);
    skills = r.skills; previa = null; link = "";
    msg = { text: `✓ ${p.nome} ${textoDestinos(r.destinos)} O agente passa a usá-la nas próximas conversas.`, bad: false };
  } catch (err) { msg = { text: `✗ ${ipcErrorText(err)}`, bad: true }; }
  finally { ocupado = null; repinta(); }
}
async function remover(nome: string): Promise<void> {
  if (ocupado !== null) return;
  ocupado = "remover"; msg = null; repinta();
  try { skills = await window.meuBot.skillRemover(nome); msg = { text: `✓ ${nome} removida desta máquina.`, bad: false }; }
  catch (err) { msg = { text: `✗ ${ipcErrorText(err)}`, bad: true }; }
  finally { ocupado = null; removendo = null; repinta(); }
}

/** A seção inteira, no topo do Acervo: importar, a prévia aberta e as skills já importadas. */
export function renderMinhasSkills(out: HTMLElement): void {
  if (skills === null) void refreshSkillsImportadas();
  out.append(el("div", "tut-group", `Minhas skills em ${hostLabel(ctx.windowHost)}`));
  const form = el("form", "skill-import");
  const campo = el("input"); campo.type = "text"; campo.placeholder = "Link do repositório no GitHub, ou dono/repositorio"; campo.value = link; campo.spellcheck = false;
  campo.setAttribute("aria-label", "Link do repositório da skill"); campo.disabled = ocupado !== null;
  campo.addEventListener("input", () => { link = campo.value; });
  const ver = el("button", "btn btn-primary btn-small", ocupado === "previa" ? "Baixando…" : "Importar pelo link"); ver.type = "submit"; ver.disabled = ocupado !== null;
  form.append(campo, ver);
  form.addEventListener("submit", (e) => { e.preventDefault(); void pedirPrevia(campo.value); });
  out.append(form);
  out.append(el("p", "hint", "A skill é um repositório com um SKILL.md na raiz. A máquina baixa com o GitHub conectado nela (repositório privado funciona) e você vê o que vem antes de instalar. Usar a sua própria skill não custa nada."));
  if (msg !== null) out.append(el("p", `hint ${msg.bad ? "bad-hint" : "audio-ok"}`, msg.text));

  if (previa !== null) {
    const p = previa;
    const jaTem = (skills ?? []).find((s) => s.nome === p.nome);
    const card = el("div", "acervo-item skill-previa");
    const info = el("div", "grow");
    info.append(el("strong", "", p.nome), el("span", "", p.descricao));
    info.append(el("span", "skill-meta", `${p.rotulo} · commit ${p.commit.slice(0, 7)}${p.data !== null ? ` · ${shortDate(p.data)}` : ""} · ${p.total} ${p.total === 1 ? "arquivo" : "arquivos"} · ${tamanho(p.bytes)}`));
    const lista = el("pre", "log skill-arquivos", p.arquivos.join("\n") + (p.total > p.arquivos.length ? `\n… e mais ${p.total - p.arquivos.length}` : ""));
    info.append(lista);
    info.append(el("span", "skill-aviso", jaTem !== undefined && jaTem.commit === p.commit
      ? "Esta máquina já tem este mesmo commit instalado."
      : "Ninguém revisou esta skill: ela roda com as permissões do agente desta máquina. Instale só o que é seu ou de quem você confia."));
    const acoes = el("div", "skill-acoes");
    const ok = el("button", "btn btn-primary btn-small", ocupado === "instalar" ? "Instalando…" : jaTem !== undefined ? `Atualizar para ${p.commit.slice(0, 7)}` : "Instalar"); ok.type = "button"; ok.disabled = ocupado !== null;
    ok.addEventListener("click", () => { void instalar(p); });
    const nao = el("button", "btn btn-ghost btn-small", "Cancelar"); nao.type = "button"; nao.disabled = ocupado !== null;
    nao.addEventListener("click", () => { previa = null; msg = null; repinta(); });
    acoes.append(ok, nao);
    card.append(info, acoes);
    out.append(card);
  }

  if (skills !== null && skills.length === 0 && previa === null) out.append(el("div", "acervo-empty", "Nenhuma skill importada nesta máquina ainda."));
  for (const s of skills ?? []) {
    const info = el("div", "grow");
    info.append(el("strong", "", s.nome), el("span", "", s.descricao !== "" ? s.descricao : "sem descrição"));
    info.append(el("span", "skill-meta", `${s.rotulo} · commit ${s.commit.slice(0, 7)}${s.em !== null ? ` · importada em ${shortDate(s.em)}` : ""}`));
    const item = el("div", "acervo-item on");
    const acoes = el("div", "skill-acoes");
    if (removendo === s.nome) {
      const sim = el("button", "btn btn-danger btn-small", ocupado === "remover" ? "Removendo…" : "Remover mesmo"); sim.type = "button"; sim.disabled = ocupado !== null;
      sim.addEventListener("click", () => { void remover(s.nome); });
      const nao = el("button", "btn btn-ghost btn-small", "Manter"); nao.type = "button"; nao.disabled = ocupado !== null;
      nao.addEventListener("click", () => { removendo = null; repinta(); });
      acoes.append(sim, nao);
    } else {
      const up = el("button", "btn btn-ghost btn-small", "Atualizar"); up.type = "button"; up.disabled = ocupado !== null;
      up.title = "Baixa o repositório de novo e mostra o que mudou antes de trocar";
      up.addEventListener("click", () => { void pedirPrevia(s.url); });
      const rm = el("button", "btn btn-ghost btn-small", "Remover"); rm.type = "button"; rm.disabled = ocupado !== null;
      rm.addEventListener("click", () => { removendo = s.nome; repinta(); });
      acoes.append(up, rm);
    }
    item.append(info, acoes);
    out.append(item);
  }
}
