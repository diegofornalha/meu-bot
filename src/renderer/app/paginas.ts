import { el, byId as $ } from "../lib/dom.js";
import type { AbaFixa } from "../../shared/ipc";
import type { PageTab } from "../lib/pages-types.js";
import { browserAccess } from "../lib/pro.js";
import { linhaDaPagina } from "../lib/casca.js";
import { splitPrefPageIds, maxColunas, clampSplitRatio, SPLIT_MIN_PX, minDireita, splitLayout, splitAdd, parseSplitPref } from "../lib/split.js";
import { TUTORIAIS } from "../lib/tutoriais.js";
import { mountSnake } from "../snake.js";
import { ctx } from "./ctx.js";

// ---- WhatsApp do agente da máquina (Hermes ou OpenClaw): linha no topo da lista de conversas e modal de pareamento por QR.
// ---- Páginas em aba própria (Acervo, Tutoriais…): não são conversas. Uma de cada vez na frente; o compositor
// desliga; qualquer conversa ativada manda a página para trás; fechar volta à conversa de antes.
export const pages = new Map<string, PageTab>();
export let pageActive: PageTab | null = null;
/** Conversa que estava ativa quando a página tomou a frente; volta a ela ao fechar. */
export let pagePrev: string | null = null;

/** Páginas que aceitam o 📌 (abrir na frente quando a janela abre); terminal, guias e WhatsApp não. */
const FIXAVEIS = new Set(["tutoriais", "acervo", "conta-google", "gmail", "computador", "inspector", "modulos", "navegador", "usuarios"]);
/** A aba que abre na frente: a escolhida, ou a do produto enquanto a pessoa não escolheu (Tutoriais para quem chega). */
export function abaFixaAtual(): string {
  const v = ctx.settings?.abaFixa ?? "padrao";
  return v === "padrao" ? (ctx.caps.abreEm ?? "tutoriais") : v;
}
/** Marca a aba fixada e a põe no começo da barra, como aba fixada de navegador. */
export function pintarFixada(): void {
  const fixa = abaFixaAtual();
  for (const p of pages.values()) {
    if (p.tabEl === null) continue;
    const sim = p.id === fixa;
    p.tabEl.classList.toggle("fixada", sim);
    const pin = p.tabEl.querySelector<HTMLButtonElement>(".tab-pin");
    if (pin !== null) pin.title = sim ? "Abre primeiro quando a janela abre. Clique para desafixar (volta a abrir na conversa)" : "Fixar: esta aba abre primeiro quando a janela abrir";
    if (sim && ctx.tabsEl.firstElementChild !== p.tabEl) ctx.tabsEl.prepend(p.tabEl);
  }
}
/** Aba nova entra no começo da barra, logo depois da fixada (📌), em vez de ir para o fim da fila. */
export function inserirAba(tabEl: HTMLElement): void {
  const fixa = pages.get(abaFixaAtual())?.tabEl ?? null;
  const ref = fixa !== null && fixa !== tabEl && fixa.parentElement === ctx.tabsEl ? fixa.nextSibling : ctx.tabsEl.firstChild;
  ctx.tabsEl.insertBefore(tabEl, ref);
}
function alternarFixada(page: PageTab): void {
  const abaFixa = (abaFixaAtual() === page.id ? "conversa" : page.id) as AbaFixa;
  void window.meuBot.setSettings({ abaFixa }).then(ctx.applySettings).catch(() => { /* não salvou: o alfinete fica como estava */ });
}

/**
 * "Você está aqui" na lateral: a linha da página que está na frente ganha aria-current="page" (o realce é do
 * style.css); com uma conversa na frente, nenhuma. Uma linha só por vez: quem a tinha antes perde.
 */
function pintarLinhaAtiva(): void {
  const alvo = linhaDaPagina(pageActive?.id ?? null);
  for (const l of document.querySelectorAll<HTMLElement>('#atalhos [aria-current="page"]')) if (l.id !== alvo) l.removeAttribute("aria-current");
  if (alvo !== null) document.getElementById(alvo)?.setAttribute("aria-current", "page");
}

export function definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab {
  const page: PageTab = { id, title, panel, render, tabEl: null };
  pages.set(id, page);
  return page;
}

export function activatePage(page: PageTab): void {
  if (splitOnAny() && !semRotaSplit && pageActive !== page) {
    // Janela estreita demais (direita recolhida): a página clicada não apareceria; sai da divisão e mostra a página.
    if (contentEl.classList.contains("split-collapsed")) splitOff();
    else { if (!splitPages.includes(page)) splitOn(page, "trocar"); else focusSplit(page); return; }
  }
  if (pageActive === page) return;
  if (pageActive === null) {
    const prev = ctx.active();
    if (prev !== null) prev.draft = ctx.inputEl.value;
    pagePrev = ctx.activeId;
  } else { pageActive.panel.hidden = true; pageActive.tabEl?.classList.remove("active"); }
  ctx.activeId = null;
  pageActive = page;
  for (const t of ctx.tabs.values()) { t.tabEl.classList.remove("active"); t.messagesEl.hidden = true; }
  page.tabEl?.classList.add("active");
  page.panel.hidden = false;
  pintarLinhaAtiva();
  relayoutSplit();
  page.render();
  ctx.inputEl.value = "";
  ctx.syncComposer();
  ctx.renderSidebar();
  ctx.syncRest();
  ctx.paintGuideTargets();
}

/** Uma conversa tomou a frente: a página vai para trás (a aba continua aberta). */
export function deactivatePage(): void {
  if (pageActive === null) return;
  pageActive.panel.hidden = true;
  pageActive.tabEl?.classList.remove("active");
  pageActive = null;
  pintarLinhaAtiva();
  relayoutSplit();
  ctx.paintGuideTargets();
}

export function openPage(page: PageTab, activateIt = true): void {
  if (page.tabEl === null) {
    const tabEl = el("div", `tab tab-page tab-${page.id}`);
    const titleEl = el("span", "tab-title", page.title);
    const closeBtn = el("button", "tab-close", "×");
    closeBtn.type = "button"; closeBtn.title = "Fechar aba";
    if (FIXAVEIS.has(page.id)) {
      const pin = el("button", "tab-pin", "📌"); pin.type = "button";
      pin.addEventListener("click", (ev) => { ev.stopPropagation(); alternarFixada(page); });
      tabEl.append(pin);
    }
    tabEl.append(titleEl, closeBtn);
    tabEl.title = "Arraste para o lado para ver ao lado da conversa";
    tabEl.draggable = true;
    tabEl.addEventListener("dragstart", (ev) => { pageDragStart(page, tabEl, ev); });
    tabEl.addEventListener("dragend", () => { pageDragEnd(tabEl); });
    tabEl.addEventListener("click", () => activatePage(page));
    closeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      // Fecha direto, terminal inclusive (o shell vivo é encerrado ao fechar a aba).
      closePage(page);
    });
    inserirAba(tabEl);
    page.tabEl = tabEl;
    pintarFixada();
  }
  if (activateIt) activatePage(page);
}

export function closePage(page: PageTab): void {
  if (page.tabEl === null) return;
  if (splitPages.includes(page)) vaziaNoLugar(page);
  if (page.id.startsWith("tut-")) setTimeout(ctx.paintGuideTargets, 0); // a aba do guia saiu: nada mais pulsa
  if (page.id.startsWith("term-")) ctx.disposeTerminal(page.id);
  if (page.id === "navegador") { ctx.navMarcarAberto(false); ctx.disposeNav(); }
  const wasActive = pageActive === page;
  if (wasActive) deactivatePage();
  page.tabEl.remove();
  page.tabEl = null;
  if (!wasActive) return;
  const back = pagePrev !== null && ctx.tabs.has(pagePrev) ? pagePrev : [...ctx.tabs.keys()].at(-1);
  pagePrev = null;
  if (back !== undefined) { ctx.activate(back); return; }
  ctx.activeId = null;
  if (preencherEsquerda()) return;
  ctx.syncComposer();
  ctx.renderSidebar();
  ctx.syncRest();
}

// ---- Modo dividido: o que está na frente (conversa do meu-bot, WhatsApp ou outra página) fica à esquerda e as
// páginas fixadas viram colunas à direita, quantas a largura comportar. NADA muda de lugar no DOM: todos os painéis
// continuam filhos de #panels (mover um <webview> no DOM recarrega o Navegador); com a divisão ligada, #panels vira
// um grid e cada painel à vista recebe a sua coluna (`split-cell` + grid-column). `layoutSplit()` deriva o layout
// inteiro do estado (`splitPages` + o que está na frente) e é chamado depois de qualquer mudança. Lembrado por máquina.
const contentEl = $<HTMLElement>("content-root");
const splitHandle = $<HTMLElement>("split-handle"); // o divisor vive dentro do grid de #panels (coluna 2)
/** Páginas fixadas à direita, em colunas (da esquerda para a direita). Quantas aparecem depende da largura. */
export let splitPages: PageTab[] = [];
/** Coluna onde abre a próxima página clicada (a vazia, senão a última em que a pessoa clicou). */
let splitAlvo: PageTab | null = null;
/**
 * Coluna vazia: a cobrinha da tela vazia num espaço reservado. Clicar numa página (aba, lateral, paleta) com a tela
 * dividida abre ali; fechar a página de uma coluna deixa a coluna vazia, desde que outra página de verdade siga ao lado.
 */
let vaziaSeq = 0;
const vazias = new Map<string, { stop(): void; start(): void }>();
export const ehVazia = (p: PageTab | null | undefined): boolean => p?.id.startsWith("vazia-") === true;
function novaVazia(): PageTab {
  const id = `vazia-${++vaziaSeq}`;
  const panel = el("section", "rest split-vazia"); panel.hidden = true;
  const canvas = document.createElement("canvas"); canvas.className = "rest-canvas";
  const dica = el("div", "split-vazia-dica", "Clique numa aba, no Terminal ou no Navegador: abre aqui");
  const x = el("button", "split-vazia-x", "×"); x.type = "button"; x.title = "Tirar esta coluna";
  panel.append(canvas, dica, x);
  ctx.panelsEl.append(panel);
  const jogo = mountSnake(canvas);
  vazias.set(id, jogo);
  const page = definePage(id, "Coluna vazia", panel, () => { jogo.start(); });
  x.addEventListener("click", () => { splitOff(false, page); });
  return page;
}
function largarVazia(page: PageTab): void {
  vazias.get(page.id)?.stop(); vazias.delete(page.id);
  page.panel.remove(); pages.delete(page.id);
}
/** Para onde vai a próxima página: a primeira coluna vazia, senão a escolhida, senão a última. */
const alvoAtual = (): PageTab | null => splitPages.find(ehVazia) ?? (splitAlvo !== null && splitPages.includes(splitAlvo) ? splitAlvo : splitPages.at(-1) ?? null);
function pintarAlvo(): void {
  const alvo = splitPages.length > 1 ? alvoAtual() : null;
  for (const p of splitPages) p.panel.classList.toggle("alvo", p === alvo);
}
let splitRatio = 0.55;
const splitKey = (): string => `split:${ctx.windowHost}`;
export const splitOnAny = (): boolean => splitPages.length > 0;
/** A página está à vista (na frente ou fixada ao lado)? Quem repinta por `pageActive === page` usa isto. */
export const pageShown = (page: PageTab | null): boolean => page !== null && (pageActive === page || splitPages.includes(page));
function saveSplit(): void {
  const ids = splitPages.filter((p) => !ehVazia(p)).map((p) => p.id);
  try { if (ids.length === 0) localStorage.removeItem(splitKey()); else localStorage.setItem(splitKey(), JSON.stringify({ pageIds: splitPrefPageIds(ids), ratio: splitRatio })); } catch { /* opcional */ }
}
/** Colunas que cabem nesta largura; as outras ficam escondidas (continuam fixadas e voltam quando couber). */
const splitVisiveis = (): number => Math.min(splitPages.length, maxColunas(contentEl.clientWidth));
/** O elemento que está na frente (à esquerda): a página ativa, a conversa ativa ou, no limite, a tela vazia. */
const esquerdaEl = (): HTMLElement => pageActive?.panel ?? (ctx.activeId !== null ? ctx.tabs.get(ctx.activeId)?.messagesEl : undefined) ?? ctx.restEl;
const CELL = "split-cell";
/** Tira de todo filho de #panels a marca de célula do grid (o layout é refeito do zero a cada vez). */
function limparCelulas(): void {
  for (const c of ctx.panelsEl.querySelectorAll<HTMLElement>(`.${CELL}`)) { c.classList.remove(CELL, "col-dir", "split-fora"); c.style.removeProperty("grid-column"); }
}
function applySplitRatio(): void {
  const w = contentEl.clientWidth;
  const n = splitVisiveis();
  const r = clampSplitRatio(splitRatio, w, SPLIT_MIN_PX, minDireita(n));
  const recolhida = splitLayout(w) === "collapsed" || r === null;
  contentEl.classList.toggle("split-collapsed", recolhida);
  ctx.panelsEl.classList.toggle("split", splitOnAny() && !recolhida);
  if (r !== null) contentEl.style.setProperty("--split", `${(r * 100).toFixed(2)}%`);
  ctx.panelsEl.style.setProperty("--grade", `minmax(${SPLIT_MIN_PX}px, var(--split, 55%)) 6px repeat(${Math.max(1, n)}, minmax(0, 1fr))`);
  splitPages.forEach((p, i) => { p.panel.classList.toggle("split-fora", i >= n); });
}
/** Deriva o layout do estado: célula 1 = o que está na frente; células 3… = as colunas; classes do grid. */
function layoutSplit(): void {
  limparCelulas();
  const on = splitOnAny();
  contentEl.classList.toggle("split", on);
  if (!on) { contentEl.classList.remove("split-collapsed"); ctx.panelsEl.classList.remove("split"); return; }
  const esq = esquerdaEl();
  esq.classList.add(CELL); esq.style.gridColumn = "1";
  splitPages.forEach((p, i) => { p.panel.classList.add(CELL, "col-dir"); p.panel.style.gridColumn = String(i + 3); });
  applySplitRatio();
  pintarAlvo();
}
/** Quem muda o que está na frente (activate, activatePage, syncRest…) chama isto para o grid acompanhar. */
export function relayoutSplit(): void { if (splitOnAny()) layoutSplit(); }
function unpin(page: PageTab): void {
  if (splitAlvo === page) splitAlvo = null;
  page.panel.classList.remove(CELL, "col-dir", "split-fora", "alvo"); page.panel.style.removeProperty("grid-column");
  if (ehVazia(page)) { largarVazia(page); return; }
  page.panel.hidden = true;
  page.tabEl?.classList.remove("split", "active");
}
/**
 * Fixa a página ao lado. `modo`: "coluna" acrescenta uma coluna (substitui a última se não couber mais); "trocar" põe
 * no lugar da coluna alvo (a vazia, senão a última clicada): clicar numa aba com a tela dividida.
 */
export function splitOn(page: PageTab, modo: "coluna" | "trocar" = "coluna"): void {
  if (splitPages.includes(page)) { focusSplit(page); return; }
  // A esquerda fica com o que está na frente. Se o que está na frente é a própria página que vai para o lado, entra a
  // conversa de antes, senão outra aba aberta; sem nada para pôr à esquerda, não divide (a página fica em tela cheia).
  const frenteOk = (pageActive !== null && pageActive !== page) || (pageActive === null && ctx.activeId !== null);
  let esquerda: { conv: string } | { pag: PageTab } | null = null;
  if (!frenteOk) {
    const conv = pagePrev !== null && ctx.tabs.has(pagePrev) ? pagePrev : [...ctx.tabs.keys()].at(-1);
    const outra = [...pages.values()].filter((p) => p.tabEl !== null && p !== page && !ehVazia(p) && !splitPages.includes(p)).at(-1);
    esquerda = conv !== undefined ? { conv } : outra !== undefined ? { pag: outra } : null;
    if (esquerda === null) {
      if (ehVazia(page)) { largarVazia(page); return; }
      if (splitOnAny()) splitOff();
      activatePage(page); return;
    }
  }
  const max = maxColunas(contentEl.clientWidth);
  const alvo = alvoAtual();
  // Acrescentar com uma coluna vazia aberta também ocupa a vazia (ela existe para isso).
  const ocupar = alvo !== null && (modo === "trocar" || ehVazia(alvo));
  const ids = ocupar ? splitPages.map((p) => (p === alvo ? page.id : p.id)) : splitAdd(splitPages.map((p) => p.id), page.id, Math.max(max, 1));
  const antes = splitPages;
  splitPages = ids.map((id) => (id === page.id ? page : antes.find((p) => p.id === id)!));
  for (const old of antes) if (!splitPages.includes(old)) unpin(old);
  if (pageActive === page) deactivatePage();
  if (esquerda !== null) { if ("conv" in esquerda) { pagePrev = null; ctx.activate(esquerda.conv); } else mostrarNaEsquerda(esquerda.pag); }
  page.panel.hidden = false;
  page.tabEl?.classList.add("split");
  page.render();
  if (ocupar) splitAlvo = page;
  layoutSplit();
  // Janela estreita com a lateral aberta: esconde a lateral para a coluna caber (Cmd+B traz de volta).
  if (contentEl.classList.contains("split-collapsed") && !ctx.sidebarEl.hidden) { ctx.toggleSidebar(false); applySplitRatio(); }
  if (!ehVazia(page)) focusSplit(page);
  saveSplit();
  ctx.syncComposer(); ctx.renderSidebar(); ctx.syncRest(); ctx.paintGuideTargets();
}
/** Mais uma coluna, vazia (a cobrinha), à espera da próxima página clicada. */
export function splitColunaVazia(): void { splitOn(novaVazia()); }
/** Põe a página na frente (à esquerda) sem a regra "páginas vão para a direita" da tela dividida. */
let semRotaSplit = false;
function mostrarNaEsquerda(p: PageTab): void { semRotaSplit = true; try { activatePage(p); } finally { semRotaSplit = false; } }
/**
 * A esquerda ficou vazia com a tela dividida (fechou a conversa ou a página da frente): entra outra conversa; sem
 * conversa, a primeira página das colunas passa para a esquerda. Sem página de verdade nas colunas, a divisão acaba
 * (a cobrinha só fica ao lado de algo de verdade). Devolve se pôs algo à esquerda.
 */
export function preencherEsquerda(): boolean {
  if (!splitOnAny() || ctx.activeId !== null || pageActive !== null) return false;
  const conv = [...ctx.tabs.keys()].at(-1);
  if (conv !== undefined) { ctx.activate(conv); return true; }
  const p = splitPages.find((x) => !ehVazia(x));
  if (p === undefined) { splitOff(false); return false; }
  splitPages = splitPages.filter((x) => x !== p);
  unpin(p);
  if (!splitPages.some((x) => !ehVazia(x))) { for (const v of splitPages) unpin(v); splitPages = []; } // só vazias: saem junto
  mostrarNaEsquerda(p);
  layoutSplit(); saveSplit();
  return true;
}
/** A página de uma coluna fechou: vira coluna vazia se ainda há outra página de verdade ao lado; senão a divisão acaba. */
function vaziaNoLugar(page: PageTab): void {
  if (!splitPages.includes(page)) return;
  if (!splitPages.some((p) => p !== page && !ehVazia(p))) { splitOff(false); return; }
  const v = novaVazia();
  splitPages = splitPages.map((p) => (p === page ? v : p));
  unpin(page);
  v.panel.hidden = false; v.render();
  splitAlvo = v;
  layoutSplit(); saveSplit();
}
/** Tira uma página das colunas (ou todas, sem argumento); ela volta a ser uma aba comum. */
export function splitOff(keepPref = false, page?: PageTab): void {
  const sai = page === undefined ? splitPages : splitPages.filter((p) => p === page);
  splitPages = splitPages.filter((p) => !sai.includes(p));
  for (const p of sai) unpin(p);
  if (!splitPages.some((p) => !ehVazia(p))) { for (const v of splitPages) unpin(v); splitPages = []; } // só vazias: acabou
  layoutSplit();
  if (!keepPref) saveSplit();
  ctx.syncComposer(); ctx.renderSidebar(); ctx.syncRest(); ctx.paintGuideTargets();
}
function focusSplit(page: PageTab | null = splitPages.at(-1) ?? null): void { const p = page; if (p === null) return; if (p.id === "navegador") ctx.navCurrent()?.wv.focus(); else (p.panel.querySelector<HTMLElement>("textarea, input, .xterm-helper-textarea") ?? p.panel).focus?.(); }
/** Cmd+\: alterna. Sem página à vista, divide a última aberta; sem nenhuma, abre o Navegador (Pro) ou o Terminal. */
export function toggleSplit(): void {
  if (splitOnAny()) { splitOff(); return; }
  const candidate = pageActive ?? [...pages.values()].filter((p) => p.tabEl !== null).at(-1) ?? null;
  if (candidate !== null) { splitOn(candidate); return; }
  if (ctx.caps.chat && browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto) === "ok") void ctx.openNavTab().then(() => { if (ctx.navPage !== null) splitOn(ctx.navPage); });
  else void ctx.openTerminalTab("new").then((t) => { if (t !== null) splitOn(t.page); });
}

// Arrastar a aba de uma página para a área de conteúdo: soltar à direita fixa numa coluna; soltar à esquerda traz a
// página para a frente. A camada cobre o conteúdo durante o arrasto porque o <webview> engole os eventos de arrastar.
const splitDrop = el("div", "split-drop");
const splitDropLeft = el("div", "split-drop-zone split-drop-left");
const splitDropRight = el("div", "split-drop-zone split-drop-right", "Soltar aqui: lado a lado");
let draggingPage: PageTab | null = null;
/** Lado do soltar pela divisória de verdade (com a tela dividida, a esquerda é o que está na frente; sem, a metade). */
const dropSide = (ev: DragEvent): "left" | "right" => (ev.clientX >= splitDropRight.getBoundingClientRect().left ? "right" : "left");
function esconderDrop(): void { splitDrop.hidden = true; splitDrop.classList.remove("over-left", "over-right"); draggingPage = null; }
function pageDragStart(page: PageTab, tabEl: HTMLElement, ev: DragEvent): void {
  draggingPage = page;
  tabEl.classList.add("dragging");
  ev.dataTransfer?.setData("text/plain", page.id);
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
  const naFrente = pageActive === page;
  splitDropLeft.textContent = naFrente ? "Já está na frente" : "Soltar aqui: trazer para a frente";
  splitDropRight.textContent = splitPages.includes(page) ? "Já está ao lado" : splitOnAny() ? (splitPages.some(ehVazia) ? "Soltar aqui: na coluna vazia" : splitPages.length >= maxColunas(contentEl.clientWidth) ? "Soltar aqui: no lugar da última coluna" : "Soltar aqui: mais uma coluna") : "Soltar aqui: lado a lado";
  // Mostrar a camada no mesmo tique cancela o arrasto no Chromium.
  setTimeout(() => { if (draggingPage === page) splitDrop.hidden = false; }, 0);
}
function pageDragEnd(tabEl: HTMLElement): void { tabEl.classList.remove("dragging"); esconderDrop(); }
/** Ao abrir a janela: volta dividida com a página lembrada, se ela puder abrir. */
export async function restoreSplit(): Promise<void> {
  let pref: ReturnType<typeof parseSplitPref> = null;
  try { pref = parseSplitPref(localStorage.getItem(splitKey())); } catch { /* opcional */ }
  if (pref === null) return;
  splitRatio = pref.ratio;
  for (const id of pref.pageIds) {
    try {
      if (id === "navegador") { if (!ctx.caps.chat) continue; await ctx.refreshLicense(); if (browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto) !== "ok") continue; await ctx.openNavTab(); if (ctx.navPage !== null) splitOn(ctx.navPage); }
      else if (id.startsWith("term-")) { const t = await ctx.openTerminalTab("new"); if (t !== null) splitOn(t.page); }
      else if (id === "atividade") splitOn(ctx.activityPage());
      else if (id === "tutoriais") { openPage(ctx.tutoriaisPage); splitOn(ctx.tutoriaisPage); }
      else if (id === "acervo") { openPage(ctx.acervoPage); splitOn(ctx.acervoPage); }
      // Páginas montadas na abertura (Computador, Conta Google, Gmail; Inspector só no produto dele): já estão registradas; elas mesmas conferem o plano.
      else if (id === "computador" || id === "conta-google" || id === "gmail" || id === "inspector" || id === "modulos") { const p = pages.get(id); if (p !== undefined) { openPage(p); splitOn(p); } }
      else if (id.startsWith("tut-")) { const t = TUTORIAIS.find((x) => `tut-${x.id}` === id); if (t !== undefined) { ctx.openGuide(t); const g = pages.get(id); if (g !== undefined) splitOn(g); } }
    } catch { /* essa página não abriu: segue com as outras */ }
  }
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarPaginas(): void {
  ctx.panelsEl.append(splitHandle);
  // Divisor: arrasto com pointer events; webview/xterm perdem o mouse durante o arrasto (body.dragging).
  splitHandle.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    splitHandle.setPointerCapture(ev.pointerId);
    document.body.classList.add("dragging"); contentEl.classList.add("dragging");
    const rect = contentEl.getBoundingClientRect();
    const move = (e: PointerEvent): void => { const r = clampSplitRatio((e.clientX - rect.left) / rect.width, rect.width, SPLIT_MIN_PX, minDireita(splitVisiveis())); if (r !== null) { splitRatio = r; applySplitRatio(); } };
    const up = (): void => { document.body.classList.remove("dragging"); contentEl.classList.remove("dragging"); splitHandle.removeEventListener("pointermove", move); splitHandle.removeEventListener("pointerup", up); splitHandle.removeEventListener("pointercancel", up); saveSplit(); };
    splitHandle.addEventListener("pointermove", move);
    splitHandle.addEventListener("pointerup", up);
    splitHandle.addEventListener("pointercancel", up);
  });
  new ResizeObserver(() => { if (splitOnAny()) applySplitRatio(); }).observe(contentEl);
   splitDrop.hidden = true;
  splitDrop.append(splitDropLeft, splitDropRight);
  contentEl.append(splitDrop);
  // Rede de segurança: qualquer fim de arrasto (ou clique) com a camada à vista a esconde.
  for (const evName of ["dragend", "mouseup"] as const) document.addEventListener(evName, () => { if (!splitDrop.hidden && (evName === "mouseup" || draggingPage === null)) esconderDrop(); }, true);
  splitDrop.addEventListener("dragover", (ev) => {
    if (draggingPage === null) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    const side = dropSide(ev);
    splitDrop.classList.toggle("over-right", side === "right" && !splitPages.includes(draggingPage));
    splitDrop.classList.toggle("over-left", side === "left" && pageActive !== draggingPage);
  });
  splitDrop.addEventListener("dragleave", (ev) => { if (ev.target === splitDrop) splitDrop.classList.remove("over-left", "over-right"); });
  splitDrop.addEventListener("drop", (ev) => {
    ev.preventDefault();
    const page = draggingPage;
    esconderDrop(); // some já no soltar: se o dragend da aba não vier (foco num webview), a camada não fica presa
    if (page === null) return;
    if (dropSide(ev) === "right") { if (!splitPages.includes(page)) splitOn(page); return; }
    // Esquerda: a página vem para a frente (sai da coluna, se estava numa; o que estava na frente vai para trás).
    if (pageActive === page) return;
    if (splitPages.includes(page)) {
      if (splitPages.some((p) => p !== page && !ehVazia(p)) || ctx.activeId !== null || (pageActive !== null && !ehVazia(pageActive))) {
        // Sobra algo de verdade: a página sai da coluna e vai para a frente; a coluna some (nada de cobrinha no lugar).
        splitPages = splitPages.filter((p) => p !== page); unpin(page);
        if (!splitPages.some((p) => !ehVazia(p))) { for (const v of splitPages) unpin(v); splitPages = []; }
        mostrarNaEsquerda(page); layoutSplit(); saveSplit();
      } else { splitOff(false, page); activatePage(page); }
      return;
    }
    mostrarNaEsquerda(page);
  });
}
