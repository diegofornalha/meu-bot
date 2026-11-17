import type { DonoInfo } from "../../shared/ipc";
import { byId as $, el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import type { PageTab } from "../lib/pages-types.js";
import { hostLabel } from "../lib/probe-text.js";
import { xtermTheme, shellBlockToPaste } from "../lib/terminal.js";
import { ctx } from "../app/ctx.js";
import { temTeclaDoApp } from "../lib/teclas-core.js";

/* ---------- Terminal: abas com xterm.js; o PTY roda na máquina da janela (pty-broker.py por ssh) ---------- */
export type XTermCtor = typeof import("@xterm/xterm").Terminal;
/** A classe Terminal do xterm: o UMD no navegador expõe a classe direto; o tipo cobre também o namespace. */
export const xtermClass = (): XTermCtor => (typeof window.Terminal === "function" ? window.Terminal : (window.Terminal as { Terminal: XTermCtor }).Terminal);
interface TermTab {
  page: PageTab;
  term: InstanceType<XTermCtor> | null;
  fit: InstanceType<typeof window.FitAddon.FitAddon> | null;
  search: InstanceType<typeof window.SearchAddon.SearchAddon> | null;
  box: HTMLElement;
  head: HTMLElement;
  bar: HTMLElement;
  id: string | null;          // sessão no main (null = ainda não abriu / encerrada)
  exited: { code: number; detail: string | null } | null;
  opening: boolean;
  n: number;
  resizeTimer: number | null;
  /** Quem usou este terminal pelo controle local por último (term-api.ts); some depois de TERM_DONO_MS. */
  dono: (DonoInfo & { acao: "abriu" | "leu" | "digitou" | "dividiu"; em: number }) | null;
  donoTimer: number | null;
}
export const terminals = new Map<string, TermTab>();
const TERM_DONO_MS = 10 * 60_000;
let termCounter = 0;
export const cssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const isDark = (): boolean => document.documentElement.dataset["theme"] === "dark" || (document.documentElement.dataset["theme"] !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
export const themeNow = (): Record<string, string> => xtermTheme({ bg: cssVar("--bg"), fg: cssVar("--fg"), muted: cssVar("--muted"), accent: cssVar("--accent"), dark: isDark() });
export function rethemeTerminals(): void { for (const t of terminals.values()) if (t.term !== null) t.term.options.theme = themeNow(); }
function paintTerminalCount(): void {
  const n = [...terminals.values()].filter((t) => t.id !== null && t.exited === null).length;
  $<HTMLElement>("terminal-count").textContent = n === 0 ? "" : n === 1 ? "1 aberto" : `${n} abertos`;
}

/** Abre um terminal novo ("new"), ou foca o último vivo ("focus"; abre um se não há). Devolve a aba. */
export async function openTerminalTab(mode: "new" | "focus" = "new"): Promise<TermTab | null> {
  if (mode === "focus") {
    const live = [...terminals.values()].filter((t) => t.exited === null && t.id !== null).at(-1);
    if (live !== undefined) { ctx.openPage(live.page); live.term?.focus(); return live; }
  }
  const n = ++termCounter;
  const pageId = `term-${n}`;
  const panel = el("section", "term-panel"); panel.hidden = true;
  const head = el("div", "term-head");
  const box = el("div", "term-box");
  const bar = el("div", "term-selbar"); bar.hidden = true;
  panel.append(head, box, bar);
  ctx.panelsEl.append(panel);
  const t: TermTab = { page: null as unknown as PageTab, term: null, fit: null, search: null, box, head, bar, id: null, exited: null, opening: false, n, resizeTimer: null, dono: null, donoTimer: null };
  t.page = ctx.definePage(pageId, `Terminal ${n} · ${hostLabel(ctx.windowHost)}`, panel, () => renderTerminal(t));
  terminals.set(pageId, t);
  ctx.openPage(t.page);
  await connectTerminal(t);
  return t;
}

function renderTerminal(t: TermTab): void {
  if (t.term === null) {
    const Term = xtermClass();
    const term = new Term({ fontFamily: cssVar("--mono") || "ui-monospace, Menlo, monospace", fontSize: 13, lineHeight: 1.15, cursorBlink: true, scrollback: 10_000, allowProposedApi: true, theme: themeNow(), macOptionIsMeta: false });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new window.Unicode11Addon.Unicode11Addon()); term.unicode.activeVersion = "11";
    term.loadAddon(new window.WebLinksAddon.WebLinksAddon((ev: MouseEvent, uri: string) => { void ctx.abrirLinkDoChat(uri, ev.metaKey); }));
    const search = new window.SearchAddon.SearchAddon(); term.loadAddon(search);
    term.open(t.box);
    try { const gl = new window.WebglAddon.WebglAddon(); gl.onContextLoss(() => gl.dispose()); term.loadAddon(gl); } catch { /* fica no renderer DOM */ }
    // Cmd+K/N/B/W/J/F e o zoom da janela (Cmd+=/-/0) são do app; o resto (inclusive Ctrl+*) é do shell. Cmd+C sem seleção vira ^C.
    // Sem a ⌘ (caps.teclaCmd falso), os do app aqui dentro são Ctrl+Shift+tecla (teclas-core.ts).
    term.attachCustomKeyEventHandler((ev) => {
      if (temTeclaDoApp(ev, ctx.caps.teclaCmd, true) && ["k", "n", "b", "w", "j", "f", "=", "+", "-", "0"].includes(ev.key.toLowerCase())) { if (ev.key.toLowerCase() === "f" && ev.type === "keydown") { ev.preventDefault(); termSearch(t); } return false; }
      return true;
    });
    term.onData((d) => { if (t.id !== null) window.meuBot.termInput(t.id, d); });
    term.onBinary((d) => { if (t.id !== null) window.meuBot.termInput(t.id, Uint8Array.from(d, (c) => c.charCodeAt(0))); });
    term.onResize(({ cols, rows }) => { if (t.id !== null) window.meuBot.termResize(t.id, cols, rows); });
    term.onSelectionChange(() => { const sel = term.getSelection(); t.bar.hidden = sel.trim() === ""; });
    t.term = term; t.fit = fit; t.search = search;
    new ResizeObserver(() => {
      if (t.resizeTimer !== null) clearTimeout(t.resizeTimer);
      t.resizeTimer = window.setTimeout(() => { t.resizeTimer = null; if (!t.page.panel.hidden) t.fit?.fit(); }, 60);
    }).observe(t.box);
    // Barra de seleção: Copiar / Perguntar ao agente (pré-preenche o compositor; nada é enviado sozinho).
    const copy = el("button", "btn btn-ghost btn-small", "Copiar"); copy.type = "button";
    copy.addEventListener("click", () => { void navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); term.focus(); });
    const ask = el("button", "btn btn-primary btn-small", "Perguntar ao agente"); ask.type = "button";
    ask.addEventListener("click", () => { void ctx.askAgentAbout(term.getSelection()); term.clearSelection(); });
    t.bar.append(copy, ask);
  }
  paintTermHead(t);
  requestAnimationFrame(() => { t.fit?.fit(); t.term?.focus(); });
}

/** Selo de quem está usando o terminal (vale até TERM_DONO_MS depois do último uso). */
const termDonoVivo = (t: TermTab): TermTab["dono"] => (t.dono !== null && Date.now() - t.dono.em < TERM_DONO_MS ? t.dono : null);
function termDonoChip(t: TermTab): HTMLElement | null {
  const d = termDonoVivo(t); if (d === null) return null;
  const v = ctx.navDonoView(d);
  const hora = new Date(d.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const chip = el("span", `nav-tab-id dono ${d.origem}`, `${v.icone} ${v.nome}`);
  chip.title = `${ctx.origemNome(d.origem)}: ${v.nome} ${d.acao} às ${hora}${v.curto !== "" ? ` · ID ${v.curto}` : ""}`;
  return chip;
}
/** Selo também na aba da página (Terminal N), para ver de longe quem está mexendo. */
function paintTermTab(t: TermTab): void {
  const tabEl = t.page.tabEl; if (tabEl === null) return;
  tabEl.querySelector(".nav-tab-id")?.remove();
  const chip = termDonoChip(t);
  if (chip !== null) tabEl.querySelector(".tab-title")?.after(chip);
}

function paintTermHead(t: TermTab): void {
  t.head.replaceChildren();
  t.head.append(el("span", "term-where", `${hostLabel(ctx.windowHost)}${ctx.windowHost === "local" ? " · shell deste Mac" : " · shell por SSH"}`));
  // ID do terminal (o que o controle local usa em /ler e /digitar); clique copia a referência.
  if (t.id !== null) {
    const id = t.id;
    const chip = el("button", "nav-tab-id", `ID ${id}`); chip.type = "button";
    chip.title = `Terminal ${t.n} · ID ${id}\n\nClique para copiar o ID`;
    chip.addEventListener("click", () => { ctx.copyReference(`terminal · ${hostLabel(ctx.windowHost)} · Terminal ${t.n} · ID ${id}`); });
    t.head.append(chip);
  }
  const quem = termDonoChip(t);
  if (quem !== null) { const d = termDonoVivo(t)!; quem.textContent += ` · ${d.acao} às ${new Date(d.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`; t.head.append(quem); }
  if (t.opening) t.head.append(el("span", "hint", "conectando…"));
  if (t.exited !== null) {
    t.head.append(el("span", "term-exit", `sessão encerrada (código ${t.exited.code})${t.exited.detail !== null ? ` · ${t.exited.detail}` : ""}`));
    const again = el("button", "btn btn-primary btn-small", "Reconectar"); again.type = "button";
    again.addEventListener("click", () => { t.term?.reset(); void connectTerminal(t); });
    t.head.append(again);
  }
  const spacer = el("span", "spacer"); t.head.append(spacer);
  const find = el("button", "btn btn-ghost btn-small", "Buscar"); find.type = "button"; find.title = "Buscar no terminal (Cmd+F)";
  find.addEventListener("click", () => termSearch(t));
  const toChat = el("button", "btn btn-ghost btn-small", "Últimas linhas → conversa"); toChat.type = "button"; toChat.title = "Leva as últimas 50 linhas do terminal para o compositor da conversa";
  toChat.addEventListener("click", () => { void ctx.askAgentAbout(lastTermLines(t, 50)); });
  const novo = el("button", "btn btn-ghost btn-small", "+ Novo terminal"); novo.type = "button"; novo.title = "Abre mais uma aba de terminal nesta máquina (Cmd+Shift+J)";
  novo.addEventListener("click", () => { void openTerminalTab("new"); });
  t.head.append(novo, find, toChat);
}

async function connectTerminal(t: TermTab): Promise<void> {
  if (t.opening) return;
  t.opening = true; t.exited = null; t.id = null; paintTermHead(t);
  try {
    t.fit?.fit();
    const { id } = await window.meuBot.termOpen(t.term?.cols ?? 80, t.term?.rows ?? 24);
    t.id = id;
  } catch (err) {
    t.exited = { code: -1, detail: ipcErrorText(err) };
  } finally { t.opening = false; paintTermHead(t); paintTerminalCount(); t.term?.focus(); }
}

export function disposeTerminal(pageId: string): void {
  const t = terminals.get(pageId);
  if (t === undefined) return;
  if (t.id !== null && t.exited === null) void window.meuBot.termClose(t.id);
  t.term?.dispose();
  t.page.panel.remove();
  terminals.delete(pageId);
  paintTerminalCount();
}

function termSearch(t: TermTab): void {
  void ctx.perguntar("Buscar no terminal:", "").then((q) => {
    if (q === null || q === "" || t.search === null) return;
    t.search.findNext(q, { caseSensitive: false, incremental: false });
  });
}

/** Últimas `n` linhas não vazias do buffer do terminal, como texto. */
function lastTermLines(t: TermTab, n: number): string {
  const term = t.term; if (term === null) return "";
  const buf = term.buffer.active; const lines: string[] = [];
  for (let i = buf.length - 1; i >= 0 && lines.length < n; i--) { const l = buf.getLine(i)?.translateToString(true) ?? ""; if (l.trim() !== "" || lines.length > 0) lines.unshift(l); }
  return lines.join("\n").trim();
}

/**
 * Integração B: "Rodar no terminal" digita o comando (bracketed paste) num terminal desta máquina. Por
 * padrão sem Enter (a pessoa confirma); `enter` só para comandos do próprio app, inofensivos e conhecidos.
 */
export async function runInTerminal(code: string, lang: string, enter = false): Promise<void> {
  const t = await openTerminalTab("focus");
  if (t === null || t.id === null) return;
  window.meuBot.termInput(t.id, shellBlockToPaste(code, lang));
  if (enter) window.meuBot.termInput(t.id, "\r");
  t.term?.focus();
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarTerminal(): void {
  window.meuBot.on("term:dono", ({ id, dono }) => {
    for (const t of terminals.values()) if (t.id === id) {
      t.dono = dono;
      if (t.donoTimer !== null) clearTimeout(t.donoTimer);
      t.donoTimer = dono === null ? null : window.setTimeout(() => { t.donoTimer = null; paintTermHead(t); paintTermTab(t); }, TERM_DONO_MS);
      paintTermHead(t); paintTermTab(t);
      return;
    }
  });
  window.meuBot.on("term:data", ({ id, data }) => {
    for (const t of terminals.values()) if (t.id === id) { t.term?.write(data); return; }
  });
  window.meuBot.on("term:exit", ({ id, code, detail }) => {
    for (const t of terminals.values()) if (t.id === id) { t.exited = { code, detail }; paintTermHead(t); paintTerminalCount(); return; }
  });
  window.meuBot.on("term:ask", () => { void openTerminalTab("new"); });
}
