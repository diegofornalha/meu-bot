import type { ToolEvent } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import type { PageTab } from "../lib/pages-types.js";
import { hostLabel } from "../lib/probe-text.js";
import type { XTermCtor } from "../terminal/terminal.js";
import type { Tab } from "../renderer.js";
import { ehAcaoDoNavegador } from "../lib/navegador-ferramenta.js";
import { ctx } from "../app/ctx.js";

/* ---------- Atividade do agente: o que o modo agente roda (chat:tool), na conversa e numa aba só leitura ---------- */
let activity: { page: PageTab; term: InstanceType<XTermCtor> | null; fit: InstanceType<typeof window.FitAddon.FitAddon> | null; box: HTMLElement; pending: string[] } | null = null;
export function activityPage(): PageTab {
  if (activity !== null) return activity.page;
  const panel = el("section", "term-panel"); panel.hidden = true;
  const head = el("div", "term-head");
  head.append(el("span", "term-where", `${hostLabel(ctx.windowHost)} · atividade do agente`), el("span", "hint", "só leitura: cada ferramenta que o modo agente usa aparece aqui ao vivo"));
  const box = el("div", "term-box");
  panel.append(head, box);
  ctx.panelsEl.append(panel);
  const a = { page: null as unknown as PageTab, term: null as InstanceType<XTermCtor> | null, fit: null as InstanceType<typeof window.FitAddon.FitAddon> | null, box, pending: [] as string[] };
  a.page = ctx.definePage("atividade", `Agente · atividade`, panel, () => {
    if (a.term === null) {
      const Term = ctx.xtermClass();
      const term = new Term({ fontFamily: ctx.cssVar("--mono") || "ui-monospace, Menlo, monospace", fontSize: 12.5, lineHeight: 1.2, scrollback: 20_000, disableStdin: true, cursorBlink: false, cursorStyle: "underline", theme: ctx.themeNow(), allowProposedApi: true });
      const fit = new window.FitAddon.FitAddon(); term.loadAddon(fit);
      term.loadAddon(new window.WebLinksAddon.WebLinksAddon((ev: MouseEvent, uri: string) => { void ctx.abrirLinkDoChat(uri, ev.metaKey); }));
      term.open(box);
      a.term = term; a.fit = fit;
      new ResizeObserver(() => { if (!panel.hidden) fit.fit(); }).observe(box);
      for (const line of a.pending.splice(0)) term.write(line);
    }
    requestAnimationFrame(() => a.fit?.fit());
  });
  activity = a;
  return a.page;
}
/** Linhas guardadas enquanto a aba nunca foi aberta: o bastante para o histórico recente, sem crescer sem fim. */
const PENDENTES_MAX = 2000;
/**
 * A aba não nasce sozinha (31 out): cada ferramenta já aparece na conversa como linha recolhível, e a aba surgindo
 * (e voltando a cada ferramenta depois de fechada) só atrapalhava. Ela abre pela paleta ("Atividade do agente") ou
 * pelo modo dividido, já com o histórico; fechada, fica fechada e segue recebendo as linhas por trás.
 */
function activityWrite(text: string): void {
  activityPage();
  const a = activity!;
  if (a.term !== null) { a.term.write(text); return; }
  a.pending.push(text);
  if (a.pending.length > PENDENTES_MAX) a.pending.splice(0, a.pending.length - PENDENTES_MAX);
}
const ANSI = { dim: "\u001b[2m", bold: "\u001b[1m", yellow: "\u001b[33m", cyan: "\u001b[36m", red: "\u001b[31m", green: "\u001b[32m", reset: "\u001b[0m" };
/** Linha recolhível na conversa + eco na aba de atividade. */
/** Desenha a linha da ferramenta; devolve o nome dela (no resultado sem nome, o da linha que ele fechou). */
function showTool(tab: Tab, tool: ToolEvent): string | null {
  const host = tab.currentAssistant ?? tab.messagesEl;
  let resolved: string | null = tool.name;
  if (tool.kind === "use") {
    // A chave da API do Streak passa pelo `chave-set`: na tela ela não aparece (fica só no crm.json da máquina).
    const summary = tool.summary.replace(/(chave-set\s+)(\S+)/g, "$1••••");
    if (tool.name === "Bash" && /streak\.mjs\s+chave-set/.test(tool.summary)) ctx.crmKeyFromAgent = true;
    const d = el("details", "tool-line");
    const s = el("summary"); s.append(el("span", "tool-name", tool.name === "Bash" ? "rodou" : tool.name), el("code", "", summary || "(sem detalhes)"));
    d.append(s);
    d.dataset["tool"] = tool.name;
    (tab.currentAssistant === null ? tab.messagesEl : host).insertAdjacentElement(tab.currentAssistant === null ? "beforeend" : "beforebegin", d);
    const when = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    activityWrite(`\r\n${ANSI.dim}${when}${ANSI.reset} ${tool.name === "Bash" ? `${ANSI.bold}${ANSI.yellow}$ ${summary}` : `${ANSI.cyan}• ${tool.name} ${summary}`}${ANSI.reset}\r\n`);
  } else {
    const lines = [...tab.messagesEl.querySelectorAll<HTMLDetailsElement>(".tool-line")];
    const target = [...lines].reverse().find((d) => !d.classList.contains("done") && (tool.name === null || d.dataset["tool"] === tool.name));
    if (target !== undefined) {
      resolved = target.dataset["tool"] ?? tool.name;
      target.classList.add("done", tool.ok ? "ok" : "bad");
      if (tool.text.trim() !== "") target.append(el("pre", "tool-result", tool.text));
    }
    if (tool.text.trim() !== "") activityWrite(`${tool.ok ? "" : ANSI.red}${tool.text.replace(/\n/g, "\r\n")}${ANSI.reset}\r\n`);
  }
  ctx.scrollToBottom(tab, false);
  return resolved;
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarAtividade(): void {
  window.meuBot.on("chat:tool", ({ conversationId, tool }) => {
    const tab = ctx.tabs.get(conversationId);
    const name = tab !== undefined ? showTool(tab, tool) : tool.name;
    if (tab !== undefined && tool.kind === "use" && tool.name.startsWith("mcp__navegador__")) { for (const h of ctx.navHostsIn(tool.summary)) tab.navSitesTurn.add(h); if (tab.navSitesTurn.size === 0) tab.navSitesTurn.add(ctx.navCurrentHost() ?? "*"); }
    // "Deixar o agente navegar" só conclui com uma ação do Navegador que deu certo. A tentativa (o `use`) e o erro
    // com "agente pode usar" desligado não contam: antes, qualquer tentativa marcava o passo e o tutorial "concluía".
    if (tool.kind === "result" && tool.ok && name !== null && ehAcaoDoNavegador(name) && !ctx.loadGuideFlags(ctx.NAV_TUTORIAL).navAgentUsed) { ctx.saveGuideFlag(ctx.NAV_TUTORIAL, "navAgentUsed"); ctx.paintGuide(); }
    // O agente acabou de gravar a chave do Streak na máquina: o passo 3 do CRM segue sozinho (teste, pipeline único).
    if (tool.kind === "result" && ctx.crmKeyFromAgent && name === "Bash") void ctx.crmAfterAgentKey();
  });
}
