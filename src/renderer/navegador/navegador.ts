import type { BrowserExtensionInfo, NavFavorito, NavWorkspaces, DonoInfo, NavWorkspace, NavService, NavWhatsappInfo } from "../../shared/ipc";
import { el, byId as $ } from "../lib/dom.js";
import { favLabel, favOf, favTitleFor } from "../lib/favoritos.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import type { PageTab } from "../lib/pages-types.js";
import { type ProAccess, proBlockText, tabLabel, displayUrl, browserAccess, pagamentoDoBloqueio } from "../lib/pro.js";
import { blocoPagamento } from "../lib/aviso-pagamento.js";
import { aoMudarConta, contaAtual, contaEntrou } from "../conta/conta.js";
import { hostLabel } from "../lib/probe-text.js";
import { type RecortesPref, parseRecortesPref, recortesPara, recorteOculto, type Recorte, recorteTitulo } from "../lib/recortes.js";
import { NAV_ZOOM_STEPS, caberAuto, larguraMinima, zoomParaCaber } from "../lib/nav-caber-core.js";
import { barraCompacta } from "../lib/nav-barra-core.js";
import { TUTORIAIS, type Tutorial } from "../lib/tutoriais.js";
import type { Tab } from "../renderer.js";
import { ctx } from "../app/ctx.js";

/* ---------- Navegador (módulo Pro), como no Rambox: abas internas são <webview> na partição da máquina ---------- */
/** O <webview> do Electron: só o que usamos (o renderer não tem os tipos do Electron). */
interface WebviewEl extends HTMLElement {
  src: string; partition: string; allowpopups: boolean;
  loadURL(url: string): Promise<void>; getURL(): string; getTitle(): string; isLoading(): boolean;
  canGoBack(): boolean; canGoForward(): boolean; goBack(): void; goForward(): void; reload(): void; stop(): void; focus(): void;
  getWebContentsId(): number; setZoomFactor(factor: number): void;
  insertCSS(css: string): Promise<string>; removeInsertedCSS(key: string): Promise<void>; executeJavaScript(code: string): Promise<unknown>;
}
/** `cssKeys`: recortes aplicados neste documento (id do recorte → chaves do insertCSS); zera a cada navegação. */
interface NavTab { id: string; wv: WebviewEl; title: string; url: string; favicon: string | null; loading: boolean; failed: string | null; cssKeys: Map<string, string[]>; /** Aba fixa de um serviço do espaço de trabalho (id do serviço). */ serviceId?: string; /** Aba aberta por um tutorial ("Tutorial 11"): selo na tira, como o dono de uma conversa. */ rotulo?: string; }
/** canGoBack/canGoForward lançam antes do dom-ready do <webview> (aba recém-criada): até lá, nem voltar nem avançar; o dom-ready repinta. */
const navPode = (f: () => boolean): boolean => { try { return f(); } catch { return false; } };
export let navPage: PageTab | null = null;
export let navTabs: NavTab[] = [];
let navActive: string | null = null;
let navSeq = 0;
export let navPartition: string | null = null;
export let navExtensions: BrowserExtensionInfo[] = [];
export let navAccess: ProAccess | null = null;
let navEls: { rail: HTMLElement; favs: HTMLElement; star: HTMLButtonElement; tabs: HTMLElement; url: HTMLInputElement; back: HTMLButtonElement; fwd: HTMLButtonElement; reload: HTMLButtonElement; loading: HTMLElement; box: HTMLElement; block: HTMLElement; note: HTMLElement; menu: HTMLElement; bar: HTMLElement; agent: HTMLButtonElement; wa: HTMLButtonElement; actions: HTMLElement; popup: HTMLElement } | null = null;
let navPopupFor: string | null = null;
/** Barra de favoritos (lista por máquina, do main); mostrar/ocultar é escolha do app (Cmd+Shift+F). */
let navFavs: NavFavorito[] = [];
/** Espaços de trabalho desta máquina (do REA do Rambox): sites fixos em abas permanentes, agrupados por projeto ou cliente. */
let navWs: NavWorkspaces = { ativo: null, lista: [] };
/** Formulário aberto no trilho (adicionar site, novo espaço, renomear) e o erro da última gravação. */
let navRailForm: { kind: "site" | "espaco" | "renomear" } | null = null;
let navRailMsg: string | null = null;
/** Trilho dos espaços à vista? (◧ na barra recolhe/mostra; lembrado neste Mac.) */
let navRailShown = (() => { try { return localStorage.getItem("navRailShown") !== "0"; } catch { return true; } })();
/** A barra de favoritos sempre começa à vista; esconder (Cmd+Shift+F, paleta) vale só até fechar o app. */
export let navFavsShown = true;
function paintNavFavs(): void {
  if (navEls === null) return;
  const e = navEls;
  e.favs.hidden = !navFavsShown;
  e.favs.replaceChildren();
  if (navFavs.length === 0) { e.favs.append(el("span", "nav-favs-hint", "Sem favoritos: ☆ guarda a página aberta; o agente também adiciona (\"favorite este link\"). Cmd+Shift+F esconde a barra.")); }
  for (const f of navFavs) {
    const b = el("button", "nav-fav"); b.type = "button"; b.title = `${f.titulo}\n${f.url}`;
    b.append(el("span", "nav-fav-label", favLabel(f)));
    const x = el("span", "nav-fav-x", "×"); x.title = "Tirar dos favoritos"; x.setAttribute("role", "button");
    x.addEventListener("click", (ev) => { ev.stopPropagation(); void window.meuBot.browserFavoriteRemove(f.id).then((list) => { navFavs = list; paintNavFavs(); paintNavStar(); }).catch(() => undefined); });
    b.append(x);
    b.addEventListener("click", (ev) => { const cur = navCurrent(); if (ev.metaKey || ev.ctrlKey || cur === null) navNewTab(f.url); else { void cur.wv.loadURL(f.url); cur.wv.focus(); } });
    e.favs.append(b);
  }
  paintNavStar();
}
export const navCurrentHost = (): string | null => { const c = navCurrent(); if (c === null || !/^https?:/.test(c.url)) return null; try { return new URL(c.url).hostname; } catch { return null; } };
function paintNavStar(): void {
  if (navEls === null) return;
  const cur = navCurrent();
  const fav = cur === null ? null : favOf(navFavs, cur.url);
  navEls.star.textContent = fav === null ? "☆" : "★";
  navEls.star.classList.toggle("on", fav !== null);
  navEls.star.disabled = cur === null || !/^https?:/.test(cur.url);
  navEls.star.title = fav === null ? "Guardar esta página nos favoritos" : "Tirar esta página dos favoritos";
}
function toggleFavCurrent(): void {
  const cur = navCurrent(); if (cur === null || !/^https?:/.test(cur.url)) return;
  const fav = favOf(navFavs, cur.url);
  const p = fav === null ? window.meuBot.browserFavoriteAdd({ titulo: favTitleFor(cur.title, cur.url), url: cur.url }) : window.meuBot.browserFavoriteRemove(fav.id);
  void p.then((list) => { navFavs = list; if (fav === null && !navFavsShown) navFavsShown = true; paintNavFavs(); })
    .catch((err: unknown) => { if (navEls !== null) { navEls.note.hidden = false; navEls.note.textContent = `Favoritos: ${ipcErrorText(err)}`; } });
}
export function toggleFavsBar(): void {
  navFavsShown = !navFavsShown;
  paintNavFavs();
}
/** Recortes (partes do site ocultas, ver lib/recortes.ts): escolha por recorte, lembrada no app. */
let navRecortes: RecortesPref = (() => { try { return parseRecortesPref(localStorage.getItem("navRecortes")); } catch { return {}; } })();
let navActionsHost = "";
/**
 * Aplica os recortes no documento atual. Só depois de `dom-ready` (e de novo em `did-finish-load`): o Gmail
 * reescreve o documento no começo da carga e um CSS inserido no `did-navigate` se perde, enquanto a chave guardada
 * impediria a reinserção. Inserir duas vezes é inofensivo; por isso as chaves são lista e `mostrar` remove todas.
 */
/** Uma aplicação de recortes por aba de cada vez: cliques rápidos (ocultar/mostrar/ocultar) não se atropelam. */
const navCutChain = new WeakMap<NavTab, Promise<void>>();
function applyRecortes(tab: NavTab, fresh = false): void {
  const list = recortesPara(tab.url);
  let touched = false;
  const run = async (): Promise<void> => {
    for (const r of list) {
      const keys = tab.cssKeys.get(r.id) ?? [];
      const hide = recorteOculto(navRecortes, r);
      try {
        if (hide && (fresh || keys.length === 0)) { const k = await tab.wv.insertCSS(r.css); tab.cssKeys.set(r.id, [...(tab.cssKeys.get(r.id) ?? []), k]); touched = touched || r.resize === true; }
        else if (!hide && keys.length > 0) { tab.cssKeys.delete(r.id); for (const k of keys) await tab.wv.removeInsertedCSS(k); touched = touched || r.resize === true; }
      } catch { /* documento trocou no meio: a próxima carga reaplica */ }
    }
    if (touched) navRefit(tab);
  };
  // O estado desejado é lido na hora de rodar (recorteOculto), então a fila sempre termina no último clique.
  const next = (navCutChain.get(tab) ?? Promise.resolve()).then(run, run);
  navCutChain.set(tab, next);
}
/** Sites fixos do espaço ativo: do Navegador aberto, ou das Configurações antes de ele abrir. */
export function navServicosCount(): number {
  const src = navWs.lista.length > 0 ? navWs : (ctx.settings?.navEspacos ?? navWs);
  return src.lista.find((w) => w.id === src.ativo)?.servicos.length ?? 0;
}
/**
 * Chrome Web Store dentro da aba: a loja vê que o navegador não é o Chrome (as marcas do client hint do Electron não
 * têm "Google Chrome"; o User-Agent não resolve) e abre "Mudar para o Chrome?" a cada visita. Aqui a loja É o
 * lugar certo (electron-chrome-web-store instala por "Usar no Chrome"), então o aviso só atrapalha: um vigia no
 * documento clica "Agora não" (a loja guarda a escolha) ou, sem botão, tira o diálogo. Idempotente por documento.
 */
const NAV_STORE_HOST = "chromewebstore.google.com";
const NAV_STORE_JS = `(() => {
  if (window.__meuBotStore) return; window.__meuBotStore = true;
  const RE = /mudar para o chrome|switch to chrome|cambiar a chrome|passer a chrome|zu chrome wechseln/i;
  const sweep = () => {
    for (const d of document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog')) {
      if (!RE.test(d.textContent || '')) continue;
      const no = [...d.querySelectorAll('button, [role="button"]')].find((b) => /agora não|not now|ahora no|plus tard|nicht jetzt/i.test(b.textContent || ''));
      if (no) no.click(); else d.remove();
    }
  };
  sweep();
  new MutationObserver(sweep).observe(document.documentElement, { childList: true, subtree: true });
})(); undefined`;
function navStoreTweaks(tab: NavTab): void {
  let host = ""; try { host = new URL(tab.url).hostname; } catch { return; }
  if (host !== NAV_STORE_HOST) return;
  try { void tab.wv.executeJavaScript(NAV_STORE_JS).catch(() => undefined); } catch { /* webview ainda não anexado */ }
}
/**
 * Pede à página que refaça o layout: sites como o Gmail medem a janela por JS e, se a medida aconteceu com a aba
 * escondida (display:none) ou com o documento rolado, a parte de baixo some (planilha do Streak cortada). Zera a
 * rolagem do documento e dispara `resize`; chamado ao mostrar a aba, ao mudar o tamanho da área e nos recortes.
 */
const NAV_REFIT_JS = "window.scrollTo(0, 0); document.documentElement.scrollTop = 0; if (document.body) document.body.scrollTop = 0; window.dispatchEvent(new Event('resize')); undefined";
function navRefit(tab: NavTab): void {
  if (tab.loading) return;
  if (navZoomAuto(tab)) navApplyZoom(tab); // a área mudou de largura: o zoom automático acompanha antes de a página medir
  try { void tab.wv.executeJavaScript(NAV_REFIT_JS).catch(() => undefined); } catch { /* webview ainda não anexado */ }
  navCaberSoon(tab);
}
let navRefitTimer: ReturnType<typeof setTimeout> | null = null;
function navRefitSoon(): void {
  if (navRefitTimer !== null) clearTimeout(navRefitTimer);
  navRefitTimer = setTimeout(() => { navRefitTimer = null; const cur = navCurrent(); if (cur !== null) navRefit(cur); }, 150);
}
function toggleRecorte(r: Recorte): void {
  const cur = navCurrent();
  navRecortes = { ...navRecortes, [r.id]: !recorteOculto(navRecortes, r) };
  try { localStorage.setItem("navRecortes", JSON.stringify(navRecortes)); } catch { /* opcional */ }
  for (const t of navTabs) applyRecortes(t);
  // Atualiza o próprio botão em vez de recriar a barra: recriar sob o mouse deixava a dica antiga presa na tela.
  if (r.resize === true) navMinimos.clear(); // mostrar/ocultar uma coluna muda a largura mínima do site: mede de novo
  const hidden = recorteOculto(navRecortes, r);
  const b = navEls?.actions.querySelector<HTMLButtonElement>(`.nav-cut[data-cut="${r.id}"]`);
  if (b != null) { b.classList.toggle("off", hidden); b.title = recorteTitulo(r, hidden); b.setAttribute("aria-pressed", String(!hidden)); }
  else { navActionsHost = ""; paintNavActions(); }
  void cur;
}
/** Botões das extensões na barra (ícone da ação, como no Chrome/Rambox); clique abre o popup da extensão num webview pequeno. */
/** Extensões fixadas na barra (como no Brave: por padrão todas ficam no 🧩); por máquina, neste Mac. */
const navExtPinKey = (): string => `navExtFixadas:${ctx.windowHost}`;
function navExtPinned(): Set<string> { try { const raw = localStorage.getItem(navExtPinKey()); if (raw !== null) return new Set((JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === "string")); } catch { /* opcional */ } return new Set(); }
function navExtSetPinned(id: string, on: boolean): void {
  const s = navExtPinned(); if (on) s.add(id); else s.delete(id);
  try { localStorage.setItem(navExtPinKey(), JSON.stringify([...s])); } catch { /* opcional */ }
  paintNavActions(); if (navEls !== null && !navEls.menu.hidden) paintNavMenu();
}
/** Clique numa extensão (na barra ou no 🧩): abre/fecha o popup dela ancorado em `anchor`. */
function navExtClick(x: BrowserExtensionInfo, anchor: HTMLElement): void {
  if (navPopupFor === x.id || x.popup === null) { navClosePopup(); if (x.popup === null && navEls !== null) { navEls.note.hidden = false; navEls.note.textContent = `${x.name} não tem popup; ela age dentro das páginas que suporta.`; } return; }
  navOpenPopup(x.id, x.popup, anchor, x.embutida === true);
}
const navExtIcon = (x: BrowserExtensionInfo): HTMLElement => { if (x.icon !== null) { const img = document.createElement("img"); img.src = x.icon; img.alt = ""; img.className = "nav-ext-icon"; return img; } return el("span", "nav-ext-icon nav-ext-initial", x.name.slice(0, 1)); };
function paintNavActions(): void {
  if (navEls === null) return;
  const e = navEls;
  e.actions.replaceChildren();
  // Na barra, só as fixadas (📌 no 🧩); as outras abrem pelo próprio 🧩.
  const pinned = navExtPinned();
  for (const x of navExtensions) {
    if (!pinned.has(x.id)) continue;
    const b = el("button", `nav-action${navPopupFor === x.id ? " on" : ""}`); b.type = "button"; b.title = x.name;
    if (x.icon !== null) { const img = document.createElement("img"); img.src = x.icon; img.alt = x.name; b.append(img); } else b.textContent = x.name.slice(0, 1);
    b.addEventListener("click", () => navExtClick(x, b));
    e.actions.append(b);
  }
  // Recortes do site da aba ativa: botão aceso = parte visível; apagado = oculta.
  const cur = navCurrent();
  for (const r of cur === null ? [] : recortesPara(cur.url)) {
    const hidden = recorteOculto(navRecortes, r);
    const b = el("button", `nav-action nav-cut${hidden ? " off" : ""}`, r.icone); b.type = "button"; b.title = recorteTitulo(r, hidden); b.setAttribute("aria-pressed", String(!hidden)); b.dataset["cut"] = r.id;
    b.addEventListener("click", () => toggleRecorte(r));
    e.actions.append(b);
  }
  try { navActionsHost = cur === null ? "" : new URL(cur.url).hostname; } catch { navActionsHost = ""; }
}
/** `proprioFechar`: a extensão nativa desenha o próprio ✕ (window.close → evento "close"); as outras ganham o × do app. */
function navOpenPopup(id: string, url: string, anchor: HTMLElement, proprioFechar: boolean): void {
  if (navEls === null || navPartition === null) return;
  navClosePopup();
  const wv = document.createElement("webview") as WebviewEl;
  wv.setAttribute("partition", navPartition);
  wv.className = "nav-popup-view";
  wv.setAttribute("src", url);
  // O clique na página não chega aqui (o <webview> engole o mousedown): "×" no canto, Esc (com o foco no app) e foco numa aba fecham.
  const fechar = el("button", "nav-popup-x", "×"); fechar.type = "button"; fechar.title = "Fechar (Esc)";
  fechar.addEventListener("click", () => navClosePopup());
  // Toda página de popup pode se fechar sozinha (window.close), como no Chrome.
  wv.addEventListener("close", () => { if (navPopupFor === id) navClosePopup(); });
  if (proprioFechar) navEls.popup.replaceChildren(wv); else navEls.popup.replaceChildren(wv, fechar);
  const r = anchor.getBoundingClientRect(); const bar = navEls.bar.getBoundingClientRect();
  navEls.popup.style.right = `${Math.max(8, bar.right - r.right)}px`;
  navEls.popup.style.width = ""; navEls.popup.style.height = "";
  navEls.popup.hidden = false;
  navPopupFor = id;
  // Como no Chrome, o popup tem o tamanho do próprio documento (até 800×600): mede a página depois de carregar e
  // mais algumas vezes (as extensões montam o conteúdo por JS). A altura vem do fim do último elemento do body,
  // não só do scrollHeight: um body com height:100% devolveria sempre a caixa atual e o popup nunca encolheria.
  const fit = async (): Promise<void> => {
    if (navPopupFor !== id || navEls === null) return;
    try {
      const [w, h] = await wv.executeJavaScript(NAV_POPUP_MEASURE_JS) as [number, number];
      if (navPopupFor !== id || !Number.isFinite(w) || !Number.isFinite(h)) return;
      const maxH = Math.min(600, Math.floor(window.innerHeight * 0.8));
      navEls.popup.style.width = `${Math.min(800, Math.max(200, Math.ceil(w)))}px`;
      navEls.popup.style.height = `${Math.min(maxH, Math.max(60, Math.ceil(h)))}px`;
    } catch { /* documento trocou ou webview fechou */ }
  };
  const fitSoon = (): void => { for (const ms of [0, 150, 500, 1500]) setTimeout(() => { void fit(); }, ms); };
  wv.addEventListener("dom-ready", fitSoon);
  wv.addEventListener("did-finish-load", fitSoon);
  // O conteúdo muda depois de aberto (o Autenticador mostra o formulário ao achar o QR): continua medindo enquanto o
  // popup estiver aberto, como o Chrome, que redimensiona o popup quando o documento cresce ou encolhe.
  const acompanhar = window.setInterval(() => { if (navPopupFor !== id || !wv.isConnected) { window.clearInterval(acompanhar); return; } void fit(); }, 400);
  paintNavActions();
}
const NAV_POPUP_MEASURE_JS = `(() => {
  const d = document.documentElement, b = document.body;
  if (!b) return [d.scrollWidth, d.scrollHeight];
  const cs = getComputedStyle(b);
  const bottom = Math.max(0, ...[...b.children].map((e) => e.getBoundingClientRect().bottom)) + window.scrollY + (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.marginBottom) || 0);
  const h = bottom > 0 ? Math.min(d.scrollHeight, Math.ceil(bottom)) : d.scrollHeight;
  return [Math.max(d.scrollWidth, b.scrollWidth), h];
})()`;
function navClosePopup(): void {
  if (navEls === null) return;
  navEls.popup.hidden = true; navEls.popup.replaceChildren(); navPopupFor = null;
  paintNavActions();
}
let navAgentBusy = false;
/** O agente do WhatsApp também pode usar o Navegador (null = ainda não lido nesta janela). */
let navWa: NavWhatsappInfo | null = null;
/** O que o menu da barra mostra: as extensões (🧩) ou quem pode usar o Navegador pelo WhatsApp (📱, só onde a lista é do app). */
let navMenuModo: "ext" | "wa" = "ext";
let navWaBusy = false;
/** Ligado por padrão: ao abrir o Navegador, liga sozinho; quem desligar de propósito fica desligado (lembrado por máquina). */
const navWaOffKey = (): string => `navWaDesligado:${ctx.windowHost}`;
function refreshNavWa(): void {
  void window.meuBot.browserAgentWhatsapp().then((r) => {
    navWa = r; paintNav();
    let off = false; try { off = localStorage.getItem(navWaOffKey()) === "1"; } catch { /* opcional */ }
    // Onde a lista é do app (Hermes) não liga sozinho: a primeira vez instala um plugin e reinicia o gateway, e é a pessoa quem escolhe os números.
    if (r.suportado && !r.editavel && !r.on && !off && !navWaBusy) setNavWa(true);
  }).catch(() => undefined);
}
function setNavWa(ligar: boolean, numeros?: string[]): void {
  try { if (ligar) localStorage.removeItem(navWaOffKey()); else localStorage.setItem(navWaOffKey(), "1"); } catch { /* opcional */ }
  navWaBusy = true; paintNav();
  if (navEls !== null) navEls.note.hidden = true;
  void window.meuBot.browserAgentWhatsapp(ligar, numeros).then((r) => { navWa = r; }).catch((err: unknown) => { if (navEls !== null) { navEls.note.hidden = false; navEls.note.textContent = `WhatsApp: ${ipcErrorText(err)}`; } }).finally(() => { navWaBusy = false; paintNav(); if (navEls !== null && !navEls.menu.hidden && navMenuModo === "wa") paintNavMenu(); });
}
/** Menu do 📱 onde a lista é do app (Hermes): quem pode usar o Navegador pelo WhatsApp, acrescentar, tirar, ligar e desligar. */
function paintNavWaMenu(): void {
  if (navEls === null || navWa === null) return;
  const m = navEls.menu, w = navWa;
  m.replaceChildren();
  m.append(el("p", "hint strong-hint", "Navegador pelo WhatsApp"));
  m.append(el("p", "hint", w.on
    ? "Só estes números conseguem pedir ao agente, na conversa direta, para usar este Navegador (com os seus logins). Para todos os outros ele responde sem navegador."
    : "Desligado. Ao ligar, só os números desta lista conseguem pedir ao agente, na conversa direta, para usar este Navegador. A primeira vez reinicia o agente do WhatsApp por alguns segundos."));
  for (const n of w.liberados) {
    const row = el("div", "nav-ext");
    const tirar = el("button", "mini-btn", "✕"); tirar.type = "button"; tirar.title = `Tirar ${ctx.fmtPhone(n)}`; tirar.disabled = navWaBusy || (w.on && w.liberados.length === 1);
    if (w.on && w.liberados.length === 1) tirar.title = "É o único número: para ninguém usar, desligue.";
    tirar.addEventListener("click", () => setNavWa(w.on, w.liberados.filter((x) => x !== n)));
    row.append(el("span", "grow", ctx.fmtPhone(n)), tirar);
    m.append(row);
  }
  const novo = el("div", "nav-ext");
  const campo = document.createElement("input"); campo.type = "tel"; campo.className = "nav-url grow"; campo.placeholder = "+55 16 99999-9999"; campo.autocomplete = "off";
  const add = el("button", "btn btn-small", "Adicionar"); add.type = "button"; add.disabled = navWaBusy;
  const incluir = (): void => {
    const d = campo.value.replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(d)) { campo.focus(); campo.select(); campo.title = "Número com DDI e DDD, só dígitos (8 a 15)"; return; }
    if (w.liberados.includes(d)) { campo.value = ""; return; }
    setNavWa(w.on, [...w.liberados, d]);
  };
  add.addEventListener("click", incluir);
  campo.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); incluir(); } });
  novo.append(campo, add);
  m.append(novo);
  const liga = el("button", w.on ? "btn btn-small" : "btn btn-primary btn-small", navWaBusy ? "gravando na máquina…" : w.on ? "Desligar" : "Ligar"); liga.type = "button"; liga.disabled = navWaBusy;
  liga.addEventListener("click", () => setNavWa(!w.on, w.liberados.length > 0 ? w.liberados : undefined));
  m.append(liga);
}
const NAV_HOME = "https://www.google.com";
/** Página inicial: com o CRM próprio liberado nesta máquina, o Gmail (onde o CRM mora); senão o Google. */
const navHome = (): string => (ctx.crmProprio() ? "https://mail.google.com/" : NAV_HOME);
const NAV_WEB_STORE = "https://chromewebstore.google.com/";
export const NAV_TUTORIAL = TUTORIAIS.find((t) => t.id === "navegador") as Tutorial;
export const navCurrent = (): NavTab | null => navTabs.find((t) => t.id === navActive) ?? null;
/** O que a pessoa digitou: endereço, host sem esquema ou busca. */
function navNormalize(raw: string): string {
  const t = raw.trim();
  if (t === "") return navHome();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && !/^file:/i.test(t)) return t;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$|:|\?)/i.test(t) || /^localhost(:|\/|$)/.test(t)) return `https://${t}`;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}
function navNewTab(url: string = navHome(), activate = true, serviceId?: string, rotulo?: string): NavTab | null {
  if (navEls === null || navPartition === null) return null;
  const wv = document.createElement("webview") as WebviewEl;
  wv.setAttribute("partition", navPartition);
  wv.setAttribute("allowpopups", "");
  // O guest herda o zoom da janela (Cmd+= do app) ao anexar; o zoom aqui é por site, então nasce em 100% e navApplyZoom manda.
  wv.setAttribute("webpreferences", "zoomFactor=1");
  wv.className = "nav-view";
  wv.hidden = true;
  const tab: NavTab = { id: `nav-${++navSeq}`, wv, title: "", url, favicon: null, loading: true, failed: null, cssKeys: new Map(), ...(serviceId !== undefined ? { serviceId } : {}), ...(rotulo !== undefined ? { rotulo } : {}) };
  const sync = (): void => { const antes = tab.url; tab.url = wv.getURL(); tab.title = wv.getTitle(); tab.loading = wv.isLoading(); paintNav(); if (tab.url !== antes) navSalvarAbas(); };
  wv.addEventListener("did-start-loading", () => { tab.loading = true; tab.failed = null; paintNav(); });
  wv.addEventListener("did-stop-loading", sync);
  wv.addEventListener("did-navigate", () => { tab.cssKeys.clear(); navApplyZoom(tab); sync(); });
  wv.addEventListener("did-finish-load", () => { navApplyZoom(tab); applyRecortes(tab, true); navStoreTweaks(tab); navCaberSoon(tab); });
  wv.addEventListener("did-navigate-in-page", sync);
  wv.addEventListener("page-title-updated", sync);
  wv.addEventListener("page-favicon-updated", (ev) => { tab.favicon = ((ev as unknown as { favicons?: string[] }).favicons ?? [])[0] ?? null; paintNav(); });
  wv.addEventListener("did-fail-load", (ev) => { const e = ev as unknown as { errorCode: number; errorDescription: string; validatedURL: string }; if (e.errorCode !== -3) { tab.failed = `${e.errorDescription} (${e.errorCode})`; tab.loading = false; paintNav(); } });
  wv.addEventListener("dom-ready", () => { sync(); navApplyZoom(tab); applyRecortes(tab); navStoreTweaks(tab); if (navActive === tab.id) { try { window.meuBot.browserActive(wv.getWebContentsId()); } catch { /* idem */ } } });
  wv.setAttribute("src", url);
  navEls.box.append(wv);
  navTabs.push(tab);
  if (activate || navActive === null) navSelect(tab.id); else paintNav();
  navSalvarAbas();
  return tab;
}
/**
 * Divisão dentro do Navegador: uma aba dele fixada ao lado da ativa (Option+clique na aba; de novo tira). A ativa fica
 * à esquerda e manda na barra de endereço; a do lado só aparece. Clicar na aba do lado troca as duas de lugar.
 */
let navLado: string | null = null;
function navAplicarLado(): void {
  const e = navEls; if (e === null) return;
  const lado = navLado !== null && navLado !== navActive ? navTabs.find((t) => t.id === navLado) ?? null : null;
  if (lado === null) navLado = null;
  e.box.classList.toggle("lado", lado !== null);
  for (const t of navTabs) {
    t.wv.hidden = t.id !== navActive && t.id !== lado?.id;
    t.wv.classList.toggle("nav-view-esq", lado !== null && t.id === navActive);
    t.wv.classList.toggle("nav-view-dir", lado !== null && t.id === lado.id);
  }
}
function navLadoToggle(id: string): void {
  if (navLado === id) navLado = null;
  else if (id === navActive) { if (navLado === null) return; const outra = navLado; navLado = id; navSelect(outra); return; } // a ativa vai para o lado e a do lado vem para a frente
  else navLado = id;
  navAplicarLado(); paintNav(); navSalvarAbas();
}
function navSelect(id: string): void {
  if (navLado === id) navLado = navActive; // clicou na aba do lado: as duas trocam de lugar
  navActive = id;
  navSalvarAbas();
  navAplicarLado();
  paintNav();
  navRefitSoon();
  const cur = navCurrent();
  if (cur !== null) { cur.wv.focus(); try { window.meuBot.browserActive(cur.wv.getWebContentsId()); } catch { /* ainda não anexado: o dom-ready avisa */ } }
}
/** Quem está usando cada aba (wcId → conversa), vindo do main: selo e ID na faixa de abas. */
let navDonos: Record<number, DonoInfo> = {};
/**
 * A conversa dona de uma aba, como aparece no app: no WhatsApp, o nome do contato/grupo e os 8 primeiros caracteres da
 * sessão do OpenClaw (o mesmo "ID" da aba da conversa); no meu-bot, o título e o começo do id da conversa.
 */
export function navDonoView(d: DonoInfo): { icone: string; nome: string; curto: string; sessao: string | null } {
  if (d.origem === "claude-code") return { icone: "✳️", nome: d.rotulo, curto: "", sessao: null };
  // Quem chamou sem se identificar (DONO_SEM_IDENTIDADE, nav-donos-core.ts): o selo diz isso, não um pedaço do id.
  if (d.id === "meu-bot:sem-identificacao") return { icone: "❔", nome: d.rotulo, curto: "", sessao: null };
  if (d.origem === "meu-bot") { const conv = d.id.replace(/^meu-bot:/, ""); return { icone: "🤖", nome: d.rotulo, curto: conv.slice(0, 8), sessao: null }; }
  const grupo = ctx.waGroups?.grupos.find((g) => g.sessionKey === d.id);
  if (grupo !== undefined) return { icone: "📱", nome: ctx.waGroupTitle(grupo), curto: grupo.sessionId?.slice(0, 8) ?? "", sessao: grupo.sessionId };
  const chat = ctx.waChats.find((c) => c.sessionKeys.includes(d.id));
  if (chat !== undefined) { const sid = chat.sessionIds[d.id] ?? null; return { icone: "📱", nome: ctx.waChatTitle(chat), curto: sid?.slice(0, 8) ?? "", sessao: sid }; }
  return { icone: "📱", nome: d.rotulo, curto: /^agent:/.test(d.id) ? "" : d.id.slice(-8), sessao: null };
}
export const origemNome = (o: DonoInfo["origem"]): string => (o === "whatsapp" ? "WhatsApp" : o === "claude-code" ? "Claude Code" : "meu-bot");
const navTabByWc = (wcId: number): NavTab | null => navTabs.find((t) => { try { return t.wv.getWebContentsId() === wcId; } catch { return false; } }) ?? null;
/**
 * O Navegador volta como estava ao reabrir o app: as abas soltas desta máquina (endereço, ordem, qual na frente) e se
 * ele estava aberto. Fechar o app não conta como fechar o Navegador; só o × da aba dele. Os sites fixos voltam pelos
 * espaços de trabalho, como sempre. Sem o Navegador aberto, o agente (do meu-bot e do WhatsApp) não tem onde abrir páginas.
 */
const navAbasKey = (): string => `navAbas:${ctx.windowHost}`;
const navAbertoKey = (): string => `navAberto:${ctx.windowHost}`;
function navSalvarAbas(): void {
  const soltas = navTabs.filter((t) => t.serviceId === undefined && /^https?:\/\//.test(t.url));
  const ativa = soltas.findIndex((t) => t.id === navActive);
  const lado = navLado === null ? -1 : soltas.findIndex((t) => t.id === navLado);
  try { localStorage.setItem(navAbasKey(), JSON.stringify({ urls: soltas.map((t) => t.url).slice(0, 30), ativa, lado })); } catch { /* opcional */ }
}
function navAbasSalvas(): { urls: string[]; ativa: number; lado: number } {
  try {
    const j = JSON.parse(localStorage.getItem(navAbasKey()) ?? "null") as { urls?: unknown; ativa?: unknown; lado?: unknown } | null;
    const urls = Array.isArray(j?.urls) ? j!.urls.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 30) : [];
    return { urls, ativa: typeof j?.ativa === "number" ? j.ativa : 0, lado: typeof j?.lado === "number" ? j.lado : -1 };
  } catch { return { urls: [], ativa: 0, lado: -1 }; }
}
export function navMarcarAberto(aberto: boolean): void { try { if (aberto) localStorage.setItem(navAbertoKey(), "1"); else localStorage.removeItem(navAbertoKey()); } catch { /* opcional */ } }
export const navEstavaAberto = (): boolean => { try { return localStorage.getItem(navAbertoKey()) === "1"; } catch { return false; } };
function navClose(id: string): void {
  const i = navTabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [t] = navTabs.splice(i, 1);
  t!.wv.remove();
  if (navLado === id) { navLado = null; navAplicarLado(); }
  if (navActive === id) { const next = navTabs[Math.min(i, navTabs.length - 1)]; if (next !== undefined) navSelect(next.id); else { navActive = null; paintNav(); } }
  else paintNav();
  navSalvarAbas();
}
// Entrou ou saiu da conta com o bloqueio na tela: o botão "Entrar" some ou volta.
aoMudarConta(() => { if (navEls !== null && navAccess !== "ok") paintNav(); });
/**
 * A licença da janela mudou (a pessoa aplicou a da conta, ou ela foi renovada ou tirada): com o bloqueio na tela, o
 * Navegador reabre (monta as abas se liberou); fora da tela só o estado é refeito, sem trazer a página para a frente.
 */
export function navReavaliar(): void {
  if (navEls === null) return;
  if (navAccess !== "ok" && navEls.block.offsetParent !== null) { void openNavTab(); return; }
  navAccess = browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto);
  paintNav();
}
export function paintNav(): void {
  if (navEls === null || navPage === null) return;
  const e = navEls;
  const blocked = navAccess !== "ok";
  e.block.hidden = !blocked; e.tabs.hidden = blocked; e.bar.hidden = blocked; e.box.hidden = blocked; e.favs.hidden = blocked || !navFavsShown;
  if (blocked) {
    const a = navAccess === null || navAccess === "ok" ? "unknown" : navAccess;
    const t = proBlockText(a, ctx.license, "navegador", ctx.caps.produto);
    e.block.replaceChildren(...(ctx.caps.planoExigido === "free" ? [el("span", "nav-pro-badge", "módulo Pro")] : []), el("h2", "", t.title), el("p", "", t.text));
    const pg = pagamentoDoBloqueio(a, ctx.license);
    if (pg !== null) e.block.append(blocoPagamento(pg));
    const row = el("div", "actions");
    // Sem conta meu-bot neste Mac: "Entrar" primeiro (a conta é o caminho para o plano: é nela que a assinatura fica).
    if (a !== "unknown" && contaAtual() !== null && !contaEntrou()) {
      const entrar = el("button", "btn btn-ghost", contaAtual()?.situacao === "entrando" ? "Aguardando o login no navegador…" : "Entrar na conta meu-bot"); entrar.type = "button"; entrar.disabled = contaAtual()?.situacao === "entrando";
      entrar.addEventListener("click", () => { entrar.disabled = true; void window.meuBot.contaEntrar().catch((err: unknown) => { entrar.disabled = false; e.note.hidden = false; e.note.textContent = `Não consegui abrir o login: ${ipcErrorText(err)}`; }); });
      row.append(entrar);
    }
    if (t.askAdmin) {
      const b = el("button", "btn btn-primary", ctx.navAskedPro ? "Pedido enviado ao admin ✓" : a === "assinatura" ? "Avisar o admin" : a === "expired" ? "Pedir a renovação ao admin" : "Pedir o Pro ao admin"); b.type = "button"; b.disabled = ctx.navAskedPro;
      b.addEventListener("click", () => { b.disabled = true; void window.meuBot.browserRequestPro().then(() => { ctx.navAskedPro = true; paintNav(); }).catch((err: unknown) => { b.disabled = false; e.note.hidden = false; e.note.textContent = `Não consegui registrar o pedido: ${ipcErrorText(err)}`; }); });
      row.append(b);
    }
    const again = el("button", "btn btn-ghost", "Conferir de novo"); again.type = "button";
    again.addEventListener("click", () => { void openNavTab(); });
    row.append(again);
    e.block.append(row);
    return;
  }
  e.tabs.replaceChildren();
  for (const t of navVisibleTabs()) {
    const fixed = t.serviceId !== undefined;
    const tabEl = el("div", `nav-tab${t.id === navActive ? " active" : ""}${fixed ? " fixed" : ""}`);
    if (t.favicon !== null) { const img = document.createElement("img"); img.src = t.favicon; img.alt = ""; tabEl.append(img); }
    tabEl.append(el("span", "nav-tab-title", tabLabel(t.title, t.url)));
    // ID da aba (o número que o agente usa) e, se uma conversa a está usando, o selo com o ID da conversa; clique copia.
    let wcId: number | null = null; try { wcId = t.wv.getWebContentsId(); } catch { /* ainda não anexada */ }
    if (wcId !== null) {
      const d = navDonos[wcId];
      const v = d === undefined ? (t.rotulo !== undefined ? { icone: "🎓", nome: t.rotulo, curto: "", sessao: null } : null) : navDonoView(d);
      const ref = `navegador · ${hostLabel(ctx.windowHost)} · aba ${wcId} · ${t.url}${d === undefined ? (t.rotulo !== undefined ? ` · aberta pelo ${t.rotulo}` : " · da pessoa") : ` · dono: ${origemNome(d.origem)} ${v!.nome} · ${d.id}${v!.sessao !== null ? ` · sessão ${v!.sessao}` : ""}`}`;
      const chip = el("button", `nav-tab-id${d !== undefined ? ` dono ${d.origem}` : t.rotulo !== undefined ? " dono tutorial" : ""}`, v === null ? `aba ${wcId}` : `${v.icone} ${v.curto || v.nome}`); chip.type = "button";
      chip.title = `${v === null ? `Aba ${wcId} (da pessoa)` : d === undefined ? `Aba ${wcId} · aberta pelo ${t.rotulo}` : `Aba ${wcId} · em uso por ${v.nome}${v.curto !== "" ? ` · ID ${v.curto}` : ""}`}\n\nClique para copiar o ID`;
      chip.addEventListener("click", (ev) => { ev.stopPropagation(); ctx.copyReference(ref); });
      tabEl.append(chip);
    }
    // Aba fixa de um serviço: não fecha pela tira (sai do trilho, com ×); a solta fecha como sempre.
    if (!fixed) { const x = el("button", "tab-close", "×"); x.type = "button"; x.title = "Fechar aba"; x.addEventListener("click", (ev) => { ev.stopPropagation(); navClose(t.id); }); tabEl.append(x); }
    else tabEl.title = "Site fixo do espaço de trabalho";
    tabEl.title = `${t.url}\n\nOption+clique: ${t.id === navLado ? "tira do lado" : "mostra ao lado da aba ativa"}`;
    if (t.id === navLado) { tabEl.classList.add("lado"); tabEl.append(el("span", "nav-tab-lado", "ao lado")); }
    tabEl.addEventListener("click", (ev) => { if (ev.altKey) navLadoToggle(t.id); else navSelect(t.id); });
    e.tabs.append(tabEl);
  }
  const add = el("button", "nav-tab-add", "+"); add.type = "button"; add.title = "Nova aba (Cmd+T)";
  add.addEventListener("click", () => { navNewTab(); });
  e.tabs.append(add);
  const cur = navCurrent();
  if (cur !== null && document.activeElement !== e.url) e.url.value = displayUrl(cur.url);
  { let h = ""; try { h = cur === null ? "" : new URL(cur.url).hostname; } catch { /* url em branco */ } if (h !== navActionsHost) paintNavActions(); }
  paintNavStar();
  paintNavPin();
  paintNavZoom();
  e.back.disabled = cur === null || !navPode(() => cur.wv.canGoBack());
  e.fwd.disabled = cur === null || !navPode(() => cur.wv.canGoForward());
  e.loading.hidden = cur === null || !cur.loading;
  e.reload.textContent = cur !== null && cur.loading ? "✕" : "↻";
  e.reload.title = cur !== null && cur.loading ? "Parar" : "Recarregar";
  e.note.hidden = cur === null || cur.failed === null;
  if (cur !== null && cur.failed !== null) e.note.textContent = `Não carregou: ${cur.failed}`;
  const a = ctx.navAgent;
  e.agent.classList.toggle("on", a.on);
  e.agent.disabled = navAgentBusy;
  // Só o robô: o estado vem da cor (aceso = pode usar) e o texto fica na dica.
  e.agent.textContent = "🤖";
  e.agent.classList.toggle("wait", a.on && a.state !== "up");
  e.agent.setAttribute("aria-label", !a.on ? "agente: desligado" : a.state === "up" ? "agente: pode usar" : a.state === "connecting" ? "agente: conectando" : "agente: sem túnel");
  e.wa.classList.toggle("on", navWa?.on === true);
  e.wa.disabled = navWaBusy || navWa === null || !navWa.suportado;
  e.wa.title = navWaBusy ? "gravando na máquina…" : navWa === null ? "lendo a máquina…" : !navWa.suportado ? `Navegador pelo WhatsApp: ${navWa.motivo ?? "não disponível nesta máquina"}.` : navWa.editavel
    ? (navWa.on ? `O agente do WhatsApp também usa este Navegador, só para: ${navWa.liberados.map((n) => ctx.fmtPhone(n)).join(", ") || "ninguém"} (na conversa direta). Clique para mudar a lista ou desligar.` : "Deixar o agente do WhatsApp usar este Navegador, só para os números que você marcar. Clique para escolher e ligar.")
    : navWa.on
    ? `O agente do WhatsApp também usa este Navegador: ${navWa.liberados.map((n) => ctx.fmtPhone(n)).join(", ") || "ninguém"} (na conversa direta e nos grupos). Para os outros contatos ele fica bloqueado. Clique para desligar.`
    : "Deixar o agente do WhatsApp usar este Navegador (só você e quem pode conversar com ele nos grupos). Clique para ligar.";
  e.agent.title = a.on ? `O agente da conversa pode abrir, ler e clicar nestas abas (túnel ${a.state === "up" ? `ativo, porta ${a.port}` : a.state}). Clique para desligar.` : "Deixar o agente da conversa usar este navegador (ele avisa antes de agir e não compra/envia nada sem você confirmar). Clique para ligar.";
  paintNavRail();
  if (navPage.tabEl !== null) { const title = navPage.tabEl.querySelector(".tab-title"); if (title !== null) title.textContent = `Navegador${navTabs.length > 1 ? ` (${navTabs.length})` : ""}`; }
  $<HTMLElement>("navegador-count").textContent = navTabs.length === 0 ? "Pro" : navTabs.length === 1 ? "1 aba" : `${navTabs.length} abas`;
}
function paintNavMenu(): void {
  if (navEls === null) return;
  if (navMenuModo === "wa") { paintNavWaMenu(); return; }
  const m = navEls.menu;
  m.replaceChildren();
  const ws = el("button", "btn btn-primary btn-small", "Abrir a Chrome Web Store"); ws.type = "button";
  ws.addEventListener("click", () => { m.hidden = true; navNewTab(NAV_WEB_STORE); });
  m.append(el("p", "hint strong-hint", "Gerenciar extensões"), ws);
  if (navExtensions.length === 0) m.append(el("p", "hint", "Nenhuma ainda. Na Web Store, abra a página da extensão e clique em \"Usar no Chrome\"; ela aparece aqui e fica salva para esta máquina."));
  const pinned = navExtPinned();
  for (const x of navExtensions) {
    const row = el("div", "nav-ext");
    // Clique no nome abre o popup da extensão (ancorado no 🧩); 📌 fixa/solta na barra.
    const open = el("button", "nav-ext-open"); open.type = "button"; open.title = x.popup === null ? `${x.name}: age dentro das páginas que suporta` : `Abrir ${x.name}`;
    open.append(navExtIcon(x), el("span", "grow", x.name), el("span", "hint", x.version));
    open.addEventListener("click", () => { m.hidden = true; const anchor = navEls?.bar.querySelector<HTMLElement>(".nav-ext-btn") ?? open; navExtClick(x, anchor); });
    const on = pinned.has(x.id);
    const pin = el("button", `mini-btn nav-ext-pin${on ? " on" : ""}`, "📌"); pin.type = "button"; pin.title = on ? "Tirar da barra (continua aqui no 🧩)" : "Fixar na barra do Navegador";
    pin.addEventListener("click", () => navExtSetPinned(x.id, !on));
    if (x.embutida === true) row.append(open, pin, el("span", "hint", "vem com o app"));
    else {
      const rm = el("button", "btn btn-ghost btn-small", "Remover"); rm.type = "button";
      rm.addEventListener("click", () => ctx.armConfirm(rm, "remover?", () => { if (navPopupFor === x.id) navClosePopup(); void window.meuBot.browserRemoveExtension(x.id).then((list) => { navExtensions = list; navExtSetPinned(x.id, false); paintNavMenu(); paintNavActions(); }); }));
      row.append(open, pin, rm);
    }
    m.append(row);
  }
  m.append(el("p", "hint", ctx.crmProprio() ? "O CRM do meu-bot já vem no Gmail e o Autenticador guarda seus códigos de dois fatores na máquina; outras extensões de conteúdo também funcionam. Se o Streak ainda estiver instalado, pode removê-lo aqui." : "Extensões rodam só neste navegador, com as APIs que o Electron oferece: as de conteúdo (como o Streak no Gmail) funcionam; popups de botão ainda não."));
}
/** Abre a aba Navegador (ou traz para a frente). Sem Pro, abre bloqueada com a explicação e o pedido ao admin. */
export async function openNavTab(url?: string, frente = true, rotulo?: string): Promise<void> {
  if (!ctx.caps.chat) return; // só o meu-bot da pessoa (o admin não tem conversas nem licença própria)
  navMarcarAberto(true);
  if (navPage === null) {
    const panel = el("section", "nav-panel"); panel.hidden = true;
    const tabsEl2 = el("div", "nav-tabs");
    const bar = el("div", "nav-bar");
    const back = el("button", "mini-btn", "←"); back.type = "button"; back.title = "Voltar (Cmd+[)";
    const fwd = el("button", "mini-btn", "→"); fwd.type = "button"; fwd.title = "Avançar (Cmd+])";
    const reload = el("button", "mini-btn", "↻"); reload.type = "button"; reload.title = "Recarregar";
    const urlEl = document.createElement("input"); urlEl.type = "text"; urlEl.className = "nav-url"; urlEl.placeholder = "endereço ou busca (Cmd+L)"; urlEl.autocomplete = "off"; urlEl.spellcheck = false;
    const loading = el("span", "nav-loading"); loading.hidden = true;
    const ext = el("button", "mini-btn nav-ext-btn", "🧩"); ext.type = "button"; ext.title = "Gerenciar extensões";
    const open = el("button", "mini-btn", "↗"); open.type = "button"; open.title = "Abrir esta página no navegador do Mac";
    const menu = el("div", "nav-menu"); menu.hidden = true;
    const agent = el("button", "mini-btn nav-agent", "🤖"); agent.type = "button"; agent.hidden = !ctx.caps.agenteNavegador;
    const wa = el("button", "mini-btn nav-agent nav-wa", "📱"); wa.type = "button"; wa.hidden = !ctx.caps.agenteNavegador;
    wa.addEventListener("click", () => {
      // Onde a lista é do app (Hermes), o 📱 abre o menu de quem pode; ligar e desligar ficam lá dentro.
      if (navWa?.editavel === true) { const abrir = menu.hidden || navMenuModo !== "wa"; navMenuModo = "wa"; menu.hidden = !abrir; if (abrir) paintNavMenu(); return; }
      const ligar = navWa?.on !== true;
      // Desligar pergunta (fica lembrado nesta máquina); ligar é o padrão e não pergunta.
      if (!ligar && !window.confirm("Tirar o Navegador do agente do WhatsApp?\n\nEle volta a não conseguir abrir páginas pelo WhatsApp. Fica desligado nesta máquina até você ligar de novo no 📱.")) return;
      setNavWa(ligar);
    });
    const star = el("button", "mini-btn nav-star", "☆"); star.type = "button"; star.title = "Guardar esta página nos favoritos";
    const favs = el("div", "nav-favs"); favs.hidden = true;
    const actions = el("div", "nav-actions");
    const popup = el("div", "nav-popup"); popup.hidden = true;
    // Área estreita: as ações secundárias (classe nav-secundario) somem atrás do "⋯" e voltam numa segunda linha da
    // barra quando ele é apertado; o endereço fica com a largura. O ResizeObserver abaixo decide pela largura da barra.
    const mais = el("button", "mini-btn nav-mais", "⋯"); mais.type = "button"; mais.title = "Mais ações (favorito, zoom, recortes, extensões…)"; mais.setAttribute("aria-expanded", "false");
    mais.addEventListener("click", () => { const aberta = bar.classList.toggle("aberta"); mais.setAttribute("aria-expanded", String(aberta)); mais.classList.toggle("on", aberta); });
    const quebra = el("div", "nav-quebra");
    for (const b of [star, wa, actions, ext, open]) b.classList.add("nav-secundario");
    bar.append(back, fwd, reload, urlEl, loading, mais, agent, quebra, star, wa, actions, ext, open, menu, popup);
    new ResizeObserver(() => {
      const compacta = barraCompacta(bar.clientWidth);
      bar.classList.toggle("compacta", compacta);
      if (!compacta) { bar.classList.remove("aberta"); mais.classList.remove("on"); mais.setAttribute("aria-expanded", "false"); }
    }).observe(bar);
    if (ctx.caps.agenteNavegador) refreshNavWa();
    star.addEventListener("click", () => toggleFavCurrent());
    agent.addEventListener("click", () => {
      navAgentBusy = true; paintNav();
      void window.meuBot.browserAgent(!ctx.navAgent.on).then((st) => { ctx.navAgent = st; }).catch((err: unknown) => { if (navEls !== null) { navEls.note.hidden = false; navEls.note.textContent = `Agente: ${ipcErrorText(err)}`; } }).finally(() => { navAgentBusy = false; paintNav(); });
    });
    const note = el("div", "nav-note"); note.hidden = true;
    const box = el("div", "nav-box");
    // Divisor da divisão interna (aba ativa | aba ao lado): arrasto com pointer events; os webviews perdem o mouse (body.dragging).
    const navHandle = el("div", "nav-split-handle"); navHandle.title = "Arraste para redimensionar"; box.append(navHandle);
    navHandle.addEventListener("pointerdown", (ev) => {
      ev.preventDefault(); navHandle.setPointerCapture(ev.pointerId); document.body.classList.add("dragging");
      const rect = box.getBoundingClientRect();
      const move = (e: PointerEvent): void => { const r = Math.min(0.8, Math.max(0.2, (e.clientX - rect.left) / rect.width)); box.style.setProperty("--nav-split", `${(r * 100).toFixed(2)}%`); };
      const up = (): void => { document.body.classList.remove("dragging"); navHandle.removeEventListener("pointermove", move); navHandle.removeEventListener("pointerup", up); navHandle.removeEventListener("pointercancel", up); };
      navHandle.addEventListener("pointermove", move); navHandle.addEventListener("pointerup", up); navHandle.addEventListener("pointercancel", up);
    });
    const block = el("div", "nav-block"); block.hidden = true;
    // Trilho dos espaços de trabalho à esquerda; a coluna da direita é o navegador de sempre.
    const rail = el("aside", "nav-rail");
    const main = el("div", "nav-main");
    main.append(tabsEl2, bar, favs, note, box, block);
    panel.classList.add("with-rail");
    panel.append(rail, main);
    ctx.panelsEl.append(panel);
    const railBtn = el("button", "mini-btn nav-rail-toggle", "◧"); railBtn.type = "button";
    railBtn.addEventListener("click", () => { navRailShown = !navRailShown; try { localStorage.setItem("navRailShown", navRailShown ? "1" : "0"); } catch { /* opcional */ } paintNavRail(); });
    bar.prepend(railBtn);
    // Pino: esta aba é um site fixo do espaço? Aceso = fixa (clique solta); apagado = solta (clique fixa).
    const pin = el("button", "mini-btn nav-pin nav-secundario", "📌"); pin.type = "button";
    pin.addEventListener("click", () => { void navTogglePin(); });
    star.insertAdjacentElement("afterend", pin);
    // Zoom da aba: clique alterna 100% ↔ 75% (o comum para planilhas largas); Cmd+=/-/0 ajusta fino.
    const zoom = el("button", "mini-btn nav-zoom nav-secundario", "100%"); zoom.type = "button";
    zoom.addEventListener("click", () => {
      const c = navCurrent(); if (c === null) return; const h = navHostOf(c.url); if (h === null) return;
      // Site de largura fixa (Gmail): o clique alterna automático ↔ 100% fixo. Nos outros, 100% ↔ 75%.
      if (caberAuto(h)) { if (navZoomManual(h) === undefined) navZoomSet(h, 1); else navZoomStep(0); return; }
      const z = navZoomFor(c); if (Math.abs(z - 1) > 0.001) navZoomStep(0); else { navZoomStep(-1); navZoomStep(-1); navZoomStep(-1); }
    });
    pin.insertAdjacentElement("afterend", zoom);
    navEls = { rail, favs, star, tabs: tabsEl2, url: urlEl, back, fwd, reload, loading, box, block, note, menu, bar, agent, wa, actions, popup };
    back.addEventListener("click", () => navCurrent()?.wv.goBack());
    fwd.addEventListener("click", () => navCurrent()?.wv.goForward());
    reload.addEventListener("click", () => { const c = navCurrent(); if (c === null) return; if (c.loading) c.wv.stop(); else c.wv.reload(); });
    urlEl.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") { ev.preventDefault(); const c = navCurrent(); const target = navNormalize(urlEl.value); if (c === null) navNewTab(target); else void c.wv.loadURL(target); urlEl.blur(); navCurrent()?.wv.focus(); }
      if (ev.key === "Escape") { const c = navCurrent(); urlEl.value = c === null ? "" : displayUrl(c.url); urlEl.blur(); }
    });
    urlEl.addEventListener("focus", () => urlEl.select());
    ext.addEventListener("click", () => { const abrir = menu.hidden || navMenuModo !== "ext"; navMenuModo = "ext"; menu.hidden = !abrir; if (abrir) paintNavMenu(); });
    open.addEventListener("click", () => { const c = navCurrent(); if (c !== null && /^https?:/.test(c.url)) void window.meuBot.openExternal(c.url); });
    box.addEventListener("mousedown", () => { menu.hidden = true; navClosePopup(); });
    // Clique dentro de uma página (webview) foca o elemento, mas o mousedown não sobe: o foco fecha menu e popup.
    box.addEventListener("focusin", (ev) => { if ((ev.target as HTMLElement).tagName === "WEBVIEW") { menu.hidden = true; navClosePopup(); } });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && navPopupFor !== null) navClosePopup(); });
    new ResizeObserver(() => navRefitSoon()).observe(box);
    navPage = ctx.definePage("navegador", "Navegador", panel, () => { paintNav(); });
  }
  ctx.openPage(navPage, frente);
  await ctx.refreshLicense();
  navAccess = browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto);
  paintNav();
  if (navAccess === "ok" && navPartition === null) {
    try { const info = await window.meuBot.browserOpen(); navPartition = info.partition; navExtensions = info.extensions; ctx.navAgent = info.agent; navFavs = info.favoritos; navWs = info.espacos; paintNavActions(); paintNavFavs(); navMountWorkspace(false); }
    catch (err) { navAccess = /ASSINATURA_REQUIRED/.test(ipcErrorText(err)) ? "assinatura" : /PRO_REQUIRED/.test(ipcErrorText(err)) ? "free" : navAccess; if (navEls !== null) { navEls.note.hidden = false; navEls.note.textContent = `Não consegui abrir o navegador: ${ipcErrorText(err)}`; } }
    paintNav();
  }
  if (navAccess === "ok" && navPartition !== null) {
    if (url !== undefined) navNewTab(navNormalize(url), true, undefined, rotulo);
    else if (navTabs.length === 0) {
      // Reabrindo o app: as abas de antes, na mesma ordem e com a mesma na frente; sem nenhuma guardada, a página inicial.
      const salvas = navAbasSalvas();
      if (salvas.urls.length === 0) navNewTab();
      else {
        const criadas = salvas.urls.map((u) => navNewTab(u, false));
        const na = criadas[Math.min(Math.max(salvas.ativa, 0), criadas.length - 1)]; if (na) navSelect(na.id);
        const ld = salvas.lado >= 0 ? criadas[salvas.lado] : undefined; if (ld && ld.id !== navActive) { navLado = ld.id; navAplicarLado(); paintNav(); }
      }
    }
    else if (navCurrent() === null) { const first = navVisibleTabs()[0]; if (first !== undefined) navSelect(first.id); }
    else navCurrent()?.wv.focus();
    navAtenderPedidos();
  }
}
// ---- Espaços de trabalho (do REA do Rambox: grupos com apps fixos num trilho; aqui por máquina, nas Configurações).
const navActiveWs = (): NavWorkspace | null => navWs.lista.find((w) => w.id === navWs.ativo) ?? null;
/** Abas do espaço ativo + as soltas; as fixas de outros espaços ficam vivas (notificações) mas fora da tira. */
function navVisibleTabs(): NavTab[] {
  const active = navActiveWs();
  const ids = new Set((active?.servicos ?? []).map((s) => s.id));
  return navTabs.filter((t) => t.serviceId === undefined || ids.has(t.serviceId));
}
const navId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
async function navSaveWs(next: NavWorkspaces): Promise<void> {
  navWs = next; navRailMsg = null;
  try { navWs = await window.meuBot.browserWorkspacesSet(next); } catch (err) { navRailMsg = `Não gravou: ${ipcErrorText(err)}`; }
  navMountWorkspace(false); paintNav();
}
/** Abre (sem ativar) as abas fixas do espaço ativo que ainda não existem; remove as de serviços que já não existem. */
function navMountWorkspace(activateFirst: boolean): void {
  if (navEls === null || navPartition === null) return;
  const all = new Set(navWs.lista.flatMap((w) => w.servicos.map((s) => s.id)));
  for (const t of [...navTabs]) if (t.serviceId !== undefined && !all.has(t.serviceId)) navClose(t.id);
  const active = navActiveWs(); if (active === null) return;
  let first: NavTab | null = null;
  for (const s of active.servicos) {
    let t = navTabs.find((x) => x.serviceId === s.id);
    if (t === undefined) t = navNewTab(s.url, false, s.id) ?? undefined;
    if (t !== undefined && first === null) first = t;
  }
  if (activateFirst && first !== null) navSelect(first.id);
  else if (navCurrent() !== null && !navVisibleTabs().some((t) => t.id === navActive)) { const v = navVisibleTabs()[0]; if (v !== undefined) navSelect(v.id); }
}
function navServiceOpen(s: NavService): void {
  const t = navTabs.find((x) => x.serviceId === s.id);
  if (t !== undefined) { navSelect(t.id); t.wv.focus(); return; }
  navNewTab(s.url, true, s.id);
}
function navUpdateActive(fn: (w: NavWorkspace) => NavWorkspace): NavWorkspaces | null {
  const a = navActiveWs(); if (a === null) return null;
  return { ...navWs, lista: navWs.lista.map((w) => (w.id === a.id ? fn(w) : w)) };
}
/**
 * Zoom por site (como no Chrome): sites largos (a planilha do Streak no Gmail) cabem na área do Navegador com
 * menos zoom. Cmd+= / Cmd+- / Cmd+0 ou o botão "%" na barra; lembrado por host neste Mac e reaplicado a cada carga.
 */
/** Largura mínima medida de cada site de largura fixa (px CSS), nesta sessão; `caberAuto` diz quais sites entram. */
const navMinimos = new Map<string, number>();
function navZoomMap(): Record<string, number> { try { const v = JSON.parse(localStorage.getItem("navZoom") ?? "{}") as Record<string, unknown>; const out: Record<string, number> = {}; for (const [k, n] of Object.entries(v)) if (typeof n === "number" && n >= 0.3 && n <= 3) out[k] = n; return out; } catch { return {}; } }
const navHostOf = (url: string): string | null => { try { return /^https?:/.test(url) ? new URL(url).hostname : null; } catch { return null; } };
/** Zoom escolhido pela pessoa para o host (undefined = nenhum: 100%, ou o automático nos sites de largura fixa). */
const navZoomManual = (h: string): number | undefined => navZoomMap()[h];
/** Largura da área da aba em px da tela (0 enquanto escondida). */
const navLarguraDe = (tab: NavTab): number => tab.wv.clientWidth || navEls?.box.clientWidth || 0;
/**
 * Zoom da aba: o escolhido pela pessoa; senão, num site de largura fixa (Gmail), o maior degrau em que a largura mínima
 * medida cabe na área; senão 100%.
 */
function navZoomFor(tab: NavTab): number {
  const h = navHostOf(tab.url); if (h === null) return 1;
  const manual = navZoomManual(h); if (manual !== undefined) return manual;
  return caberAuto(h) ? zoomParaCaber(navLarguraDe(tab), navMinimos.get(h) ?? null) : 1;
}
/** O zoom desta aba está no automático (site de largura fixa sem escolha da pessoa)? */
function navZoomAuto(tab: NavTab): boolean { const h = navHostOf(tab.url); return h !== null && caberAuto(h) && navZoomManual(h) === undefined; }
function navApplyZoom(tab: NavTab): void { try { tab.wv.setZoomFactor(navZoomFor(tab)); } catch { /* ainda não anexado */ } }
/** Grava (ou apaga, com null) a escolha da pessoa para o host e aplica em todas as abas dele. */
function navZoomSet(h: string, z: number | null): void {
  const map = navZoomMap(); if (z === null) delete map[h]; else map[h] = z;
  try { localStorage.setItem("navZoom", JSON.stringify(map)); } catch { /* opcional */ }
  for (const t of navTabs) if (navHostOf(t.url) === h) navApplyZoom(t);
  paintNavZoom(); navRefitSoon();
}
export function navZoomStep(dir: -1 | 0 | 1): void {
  const cur = navCurrent(); if (cur === null) return;
  const h = navHostOf(cur.url); if (h === null) return;
  const z = navZoomFor(cur);
  let i = NAV_ZOOM_STEPS.findIndex((s) => s >= z - 0.001); if (i < 0) i = NAV_ZOOM_STEPS.length - 1;
  const next = dir === 0 ? 1 : NAV_ZOOM_STEPS[Math.max(0, Math.min(NAV_ZOOM_STEPS.length - 1, i + dir))]!;
  // Cmd+0 apaga a escolha (100%, ou o automático no Gmail); num site de largura fixa, 100% escolhido fica gravado.
  navZoomSet(h, dir === 0 || (next === 1 && !caberAuto(h)) ? null : next);
}
/**
 * Mede a página de um site de largura fixa depois do relayout: estourou (scrollWidth > innerWidth) → a largura mínima
 * cresce e o zoom desce um degrau de cada vez até caber (cada aplicação dispara um novo refit, que mede de novo).
 */
const navCaberTimers = new Map<string, ReturnType<typeof setTimeout>>();
function navCaberSoon(tab: NavTab): void {
  if (!navZoomAuto(tab)) return;
  const t = navCaberTimers.get(tab.id); if (t !== undefined) clearTimeout(t);
  navCaberTimers.set(tab.id, setTimeout(() => { navCaberTimers.delete(tab.id); void navMedirCaber(tab); }, 400));
}
async function navMedirCaber(tab: NavTab): Promise<void> {
  const h = navHostOf(tab.url); if (h === null || tab.loading || !navZoomAuto(tab) || tab.wv.hidden) return;
  let medida: unknown;
  try { medida = await tab.wv.executeJavaScript("[document.documentElement.scrollWidth, window.innerWidth]"); } catch { return; }
  if (!Array.isArray(medida) || typeof medida[0] !== "number" || typeof medida[1] !== "number") return;
  const antes = navMinimos.get(h) ?? null;
  const novo = larguraMinima(antes, medida[0], medida[1]);
  if (novo === null || novo === antes) return;
  navMinimos.set(h, novo);
  const zAntes = navZoomFor(tab);
  for (const t of navTabs) if (navHostOf(t.url) === h) navApplyZoom(t);
  paintNavZoom();
  if (Math.abs(navZoomFor(tab) - zAntes) > 0.001) navRefitSoon();
}
function paintNavZoom(): void {
  if (navEls === null) return;
  const b = navEls.bar.querySelector<HTMLButtonElement>(".nav-zoom"); if (b === null) return;
  const cur = navCurrent(); const z = cur === null ? 1 : navZoomFor(cur);
  const h = cur === null ? null : navHostOf(cur.url);
  b.hidden = cur === null || h === null;
  b.textContent = `${Math.round(z * 100)}%`;
  b.classList.toggle("on", Math.abs(z - 1) > 0.001);
  const auto = cur !== null && navZoomAuto(cur);
  b.classList.toggle("auto", auto);
  b.title = h !== null && caberAuto(h)
    ? (auto ? "Zoom automático: reduz sozinho para a página caber na largura. Clique para fixar 100%; Cmd+= / Cmd+- fixam outro valor." : "Zoom fixado por você (Cmd+= aumenta, Cmd+- diminui). Clique ou Cmd+0 voltam ao automático, que reduz para a página caber.")
    : "Zoom deste site (Cmd+= aumenta, Cmd+- diminui, Cmd+0 volta a 100%). Clique para alternar 100% e 75%.";
}
/** 📌 na barra: fixa a aba atual no espaço ativo (nome = título, ícone = favicon) ou, se já é fixa, solta. */
async function navTogglePin(): Promise<void> {
  const cur = navCurrent(); if (cur === null || !/^https?:/.test(cur.url)) return;
  if (cur.serviceId !== undefined) {
    const sid = cur.serviceId; delete cur.serviceId; // a aba continua aberta, agora solta
    const next = { ...navWs, lista: navWs.lista.map((w) => ({ ...w, servicos: w.servicos.filter((s) => s.id !== sid) })) };
    await navSaveWs(next); return;
  }
  if (navActiveWs() === null) { navRailShown = true; navRailForm = { kind: "espaco" }; navRailMsg = "Crie um espaço para fixar esta aba nele."; paintNavRail(); return; }
  const id = navId();
  let nome = cur.title.trim(); try { if (nome === "") nome = new URL(cur.url).hostname; } catch { /* fica o título */ }
  const next = navUpdateActive((w) => ({ ...w, servicos: [...w.servicos, { id, nome: nome.slice(0, 40), url: cur.url, icone: cur.favicon }] }));
  if (next === null) return;
  cur.serviceId = id;
  await navSaveWs(next);
}
function paintNavPin(): void {
  if (navEls === null) return;
  const b = navEls.bar.querySelector<HTMLButtonElement>(".nav-pin"); if (b === null) return;
  const cur = navCurrent(); const ok = cur !== null && /^https?:/.test(cur.url);
  const fixed = ok && cur.serviceId !== undefined;
  b.hidden = !ok;
  b.classList.toggle("on", fixed);
  b.title = fixed ? "Aba fixa no espaço de trabalho: abre sozinha com o Navegador. Clique para soltar." : "Fixar esta aba no espaço de trabalho: ela passa a abrir sozinha com o Navegador.";
}
async function navAddService(nome: string, url: string): Promise<void> {
  const target = navNormalize(url); if (!/^https?:/.test(target)) { navRailMsg = "Endereço inválido."; paintNavRail(); return; }
  const id = navId(); let n = nome.trim(); try { if (n === "") n = new URL(target).hostname; } catch { n = target; }
  const next = navUpdateActive((w) => ({ ...w, servicos: [...w.servicos, { id, nome: n.slice(0, 40), url: target, icone: null }] }));
  if (next === null) return;
  navRailForm = null;
  await navSaveWs(next);
  const s = navActiveWs()?.servicos.find((x) => x.id === id); if (s !== undefined) navServiceOpen(s);
}
async function navRemoveService(id: string): Promise<void> {
  const next = navUpdateActive((w) => ({ ...w, servicos: w.servicos.filter((s) => s.id !== id) })); if (next === null) return;
  await navSaveWs(next);
}
async function navCreateWorkspace(nome: string): Promise<void> {
  const n = nome.trim().slice(0, 40); if (n === "") { navRailMsg = "Dê um nome ao espaço."; paintNavRail(); return; }
  const id = navId(); navRailForm = null;
  await navSaveWs({ ...navWs, ativo: id, lista: [...navWs.lista, { id, nome: n, servicos: [] }] });
}
async function navRenameWorkspace(nome: string): Promise<void> {
  const n = nome.trim().slice(0, 40); if (n === "") return;
  const next = navUpdateActive((w) => ({ ...w, nome: n })); if (next === null) return;
  navRailForm = null; await navSaveWs(next);
}
async function navRemoveWorkspace(): Promise<void> {
  const a = navActiveWs(); if (a === null) return;
  const lista = navWs.lista.filter((w) => w.id !== a.id);
  await navSaveWs({ ...navWs, ativo: lista[0]?.id ?? null, lista });
}
async function navSelectWorkspace(id: string): Promise<void> {
  const w = navWs.lista.find((x) => x.id === id);
  if (w === undefined || id === navWs.ativo) return;
  // Um oculto escolhido no seletor volta a aparecer.
  const lista = w.oculto === true ? navWs.lista.map((x) => (x.id === id ? { id: x.id, nome: x.nome, servicos: x.servicos } : x)) : navWs.lista;
  await navSaveWs({ ...navWs, ativo: id, lista });
  navMountWorkspace(true);
}
/** Oculta o espaço ativo: fecha as abas fixas dele e passa ao próximo visível. Nada é apagado. */
async function navHideWorkspace(): Promise<void> {
  const a = navActiveWs(); if (a === null) return;
  for (const t of [...navTabs]) if (t.serviceId !== undefined && a.servicos.some((s) => s.id === t.serviceId)) navClose(t.id);
  const lista = navWs.lista.map((w) => (w.id === a.id ? { ...w, oculto: true as const } : w));
  navRailForm = null;
  await navSaveWs({ ...navWs, ativo: lista.find((w) => w.oculto !== true)?.id ?? null, lista });
  navMountWorkspace(true);
}
function paintNavRail(): void {
  if (navEls === null) return;
  const r = navEls.rail; r.replaceChildren();
  r.hidden = navAccess !== "ok" || !navRailShown;
  const toggle = navEls.bar.querySelector<HTMLButtonElement>(".nav-rail-toggle");
  // Na barra, o ◧ só aparece com o trilho recolhido (para trazê-lo de volta); com ele à vista, o ◧ fica no título.
  if (toggle !== null) { toggle.title = "Mostrar os espaços de trabalho"; toggle.hidden = navAccess !== "ok" || navRailShown; }
  if (r.hidden) return;
  const head = el("div", "nav-rail-head");
  const titleRow = el("div", "nav-rail-row nav-rail-titlerow");
  const collapse = el("button", "mini-btn nav-rail-collapse", "◧"); collapse.type = "button"; collapse.title = "Recolher os espaços de trabalho";
  collapse.addEventListener("click", () => { navRailShown = false; try { localStorage.setItem("navRailShown", "0"); } catch { /* opcional */ } paintNavRail(); });
  titleRow.append(el("div", "nav-rail-title", "Espaços de trabalho"), collapse);
  head.append(titleRow);
  const sel = document.createElement("select"); sel.className = "nav-rail-select"; sel.title = "Espaço de trabalho (um cliente, um projeto, o que você quiser)";
  const ph = document.createElement("option"); ph.value = ""; ph.textContent = navWs.lista.length === 0 ? "Nenhum espaço ainda" : "Escolher espaço…"; ph.disabled = true; ph.selected = navWs.ativo === null; sel.append(ph);
  for (const w of navWs.lista) { if (w.oculto === true) continue; const o = document.createElement("option"); o.value = w.id; o.textContent = w.nome; o.selected = w.id === navWs.ativo; sel.append(o); }
  // Ocultos ficam num grupo no fim: escolher um traz de volta (e o torna ativo).
  const ocultos = navWs.lista.filter((w) => w.oculto === true);
  if (ocultos.length > 0) { const g = document.createElement("optgroup"); g.label = "Ocultos (escolher mostra de novo)"; for (const w of ocultos) { const o = document.createElement("option"); o.value = w.id; o.textContent = w.nome; g.append(o); } sel.append(g); }
  sel.addEventListener("change", () => { void navSelectWorkspace(sel.value); });
  const newBtn = el("button", "mini-btn", "＋"); newBtn.type = "button"; newBtn.title = "Novo espaço de trabalho";
  newBtn.addEventListener("click", () => { navRailForm = navRailForm?.kind === "espaco" ? null : { kind: "espaco" }; paintNavRail(); });
  const more = el("button", "mini-btn", "⋯"); more.type = "button"; more.title = "Renomear ou remover este espaço"; more.disabled = navActiveWs() === null;
  more.addEventListener("click", () => { navRailForm = navRailForm?.kind === "renomear" ? null : { kind: "renomear" }; paintNavRail(); });
  const top = el("div", "nav-rail-row"); top.append(sel, newBtn, more); head.append(top);
  r.append(head);
  const form = (kind: "site" | "espaco" | "renomear"): HTMLElement => {
    const f = el("div", "nav-rail-form");
    const name = document.createElement("input"); name.type = "text"; name.className = "nav-rail-input"; name.maxLength = 40;
    name.placeholder = kind === "site" ? "Nome (ex.: Gmail)" : kind === "espaco" ? "Nome do espaço (ex.: Cliente ACME, Projeto X)" : "Novo nome";
    if (kind === "renomear") name.value = navActiveWs()?.nome ?? "";
    f.append(name);
    let urlIn: HTMLInputElement | null = null;
    if (kind === "site") { urlIn = document.createElement("input"); urlIn.type = "text"; urlIn.className = "nav-rail-input"; urlIn.placeholder = "https://…"; urlIn.value = navCurrent()?.url.startsWith("http") ? navCurrent()!.url : ""; f.append(urlIn); }
    const row = el("div", "nav-rail-row");
    const ok = el("button", "btn btn-primary btn-small", kind === "site" ? "Adicionar" : kind === "espaco" ? "Criar" : "Salvar"); ok.type = "button";
    const go = (): void => { if (kind === "site") void navAddService(name.value, urlIn?.value ?? ""); else if (kind === "espaco") void navCreateWorkspace(name.value); else void navRenameWorkspace(name.value); };
    ok.addEventListener("click", go);
    const cancel = el("button", "btn btn-ghost btn-small", "Cancelar"); cancel.type = "button"; cancel.addEventListener("click", () => { navRailForm = null; paintNavRail(); });
    row.append(ok, cancel);
    if (kind === "renomear") {
      const hide = el("button", "btn btn-ghost btn-small", "Ocultar"); hide.type = "button"; hide.title = "Some do seletor e fecha as abas fixas dele; nada é apagado. Volta pelo grupo \"Ocultos\" do seletor.";
      hide.addEventListener("click", () => { void navHideWorkspace(); });
      const del = el("button", "btn btn-ghost btn-small nav-rail-del", "Remover"); del.type = "button"; del.addEventListener("click", () => ctx.armConfirm(del, "Confirmar? remove o espaço", () => { void navRemoveWorkspace(); }));
      row.append(hide, del);
    }
    f.append(row);
    for (const i of [name, urlIn]) i?.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); go(); } if (ev.key === "Escape") { navRailForm = null; paintNavRail(); } });
    setTimeout(() => name.focus(), 0);
    return f;
  };
  if (navRailForm !== null && (navRailForm.kind !== "site" || navActiveWs() !== null)) r.append(form(navRailForm.kind));
  const a = navActiveWs();
  const list = el("div", "nav-rail-list");
  if (a === null) list.append(el("p", "hint", navWs.lista.length === 0 ? "Crie o primeiro espaço com ＋: um por cliente, por projeto, do seu jeito." : "Escolha um espaço acima."));
  else {
    if (a.servicos.length === 0) list.append(el("p", "hint", "Sem sites fixos ainda: ＋ Adicionar site, ou 📌 na barra fixa a aba aberta."));
    for (const s of a.servicos) {
      const t = navTabs.find((x) => x.serviceId === s.id);
      const b = el("button", `nav-service${t !== undefined && t.id === navActive ? " active" : ""}`); b.type = "button"; b.title = s.url;
      if (s.icone !== null) { const img = document.createElement("img"); img.src = s.icone; img.alt = ""; b.append(img); } else b.append(el("span", "nav-service-initial", s.nome.slice(0, 1).toUpperCase()));
      b.append(el("span", "nav-service-name", s.nome));
      const x = el("span", "nav-service-x", "×"); x.title = "Tirar do espaço"; x.setAttribute("role", "button");
      x.addEventListener("click", (ev) => { ev.stopPropagation(); void navRemoveService(s.id); });
      b.append(x);
      b.addEventListener("click", () => navServiceOpen(s));
      list.append(b);
    }
  }
  r.append(list);
  if (a !== null) { const add = el("button", "btn btn-ghost btn-small nav-rail-add", "＋ Adicionar site"); add.type = "button"; add.addEventListener("click", () => { navRailForm = navRailForm?.kind === "site" ? null : { kind: "site" }; paintNavRail(); }); r.append(add); }
  if (navRailMsg !== null) r.append(el("p", "hint bad-hint", navRailMsg));
}
export function disposeNav(): void {
  if (navPage === null) return;
  for (const t of navTabs) t.wv.remove();
  navTabs = []; navActive = null;
  navPage.panel.remove();
  navPage = null; navEls = null;
  $<HTMLElement>("navegador-count").textContent = "Pro";
}
/* Câmera/microfone de um site (como o Brave): balão embaixo da barra do Navegador com as três respostas. */
const navPermBaloes = new Map<string, HTMLElement>();
// O agente (pelas ações do main) pede aba nova, ativar ou fechar; o DOM é nosso.
/**
 * Abas novas pedidas pelo agente enquanto o Navegador ainda se prepara (app abrindo, abas sendo restauradas): antes
 * eram descartadas em silêncio e o agente recebia "a aba nova não apareceu". Ficam aqui até o Navegador ficar pronto.
 */
const navPedidosNovos: { url: string; fundo: boolean }[] = [];
function navAtenderPedidos(): void {
  if (navPage === null || navPartition === null) return;
  for (const p of navPedidosNovos.splice(0)) { navNewTab(p.url, !p.fundo); if (!p.fundo && !ctx.pageShown(navPage)) ctx.openPage(navPage); }
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarNavegador(): void {
  try { localStorage.removeItem("navFavsShown"); } catch { /* opcional */ }
  window.meuBot.on("browser:donos", ({ donos }) => { navDonos = donos; paintNav(); });
  window.meuBot.on("browser:workspaces", (w) => { navWs = w; navMountWorkspace(false); paintNav(); });
  window.meuBot.on("browser:extensions", (list) => { navExtensions = list; paintNavActions(); if (navEls !== null && !navEls.menu.hidden) paintNavMenu(); });
  window.meuBot.on("browser:open-url", ({ url }) => { if (navPage !== null && navPartition !== null) { navNewTab(url); } });
  window.meuBot.on("browser:permissao", (p) => {
    const antigo = navPermBaloes.get(p.id); if (antigo !== undefined) { antigo.remove(); navPermBaloes.delete(p.id); }
    if (p.fechar === true) return;
    if (navPage !== null && !ctx.pageShown(navPage)) ctx.openPage(navPage);
    const host = (navEls?.box ?? document.body);
    const b = el("div", `nav-perm${p.aviso === true ? " aviso" : ""}`); b.setAttribute("role", "dialog"); b.setAttribute("aria-label", "Permissão do site");
    b.append(el("span", "nav-perm-icone", p.tipos.includes("camera") ? "📷" : "🎙"), el("span", "nav-perm-texto", p.texto));
    const acoes = el("div", "nav-perm-acoes");
    const fechar = (): void => { b.remove(); navPermBaloes.delete(p.id); };
    const btn = (rotulo: string, cls: string, d: "sempre" | "agora" | "nunca"): HTMLButtonElement => { const x = el("button", `btn ${cls} btn-small`, rotulo); x.type = "button"; x.addEventListener("click", () => { void window.meuBot.browserPermissao(p.id, d); fechar(); }); return x; };
    if (p.aviso === true) { const ok = el("button", "btn btn-ghost btn-small", "Entendi"); ok.type = "button"; ok.addEventListener("click", fechar); acoes.append(ok); }
    else acoes.append(btn("Permitir sempre neste site", "btn-primary", "sempre"), btn("Permitir desta vez", "btn-ghost", "agora"), btn("Não permitir", "btn-ghost", "nunca"));
    b.append(acoes); host.prepend(b); navPermBaloes.set(p.id, b);
  });
  window.meuBot.on("browser:agent", (st) => { ctx.navAgent = st; paintNav(); });
  window.meuBot.on("browser:favorites", (list) => { navFavs = list; paintNavFavs(); });
  window.meuBot.on("browser:ask", (msg) => {
    // Controle externo (MCP) com a aba Navegador fechada: abre em segundo plano (restaura as abas de antes) para o
    // socket do agente subir; a tela da pessoa não muda e ela vê o selo de quem usa quando abrir a aba.
    if (msg.kind === "open") { if (navPage === null) void openNavTab(undefined, false); return; }
    if (msg.kind === "new-tab") {
      // Pedido do WhatsApp (fundo): a aba nasce em segundo plano e a tela da pessoa não muda.
      navPedidosNovos.push({ url: msg.url, fundo: msg.fundo === true });
      if (navPage === null) void openNavTab(undefined, msg.fundo !== true); // fechado: abre (e restaura as abas de antes)
      navAtenderPedidos();
      return;
    }
    if (navPage === null || navPartition === null) return;
    const t = navTabByWc(msg.wcId); if (t === null) return;
    if (msg.kind === "activate") { navSelect(t.id); if (!ctx.pageShown(navPage)) ctx.openPage(navPage); }
    else navClose(t.id);
  });
  // Cmd+… apertado com o foco dentro de um webview: o main devolve e o app faz o de sempre.
  window.meuBot.on("browser:key", ({ key, shift }) => {
    if (key === "=" || key === "+") { navZoomStep(1); return; }
    if (key === "-") { navZoomStep(-1); return; }
    if (key === "0") { navZoomStep(0); return; }
    if (key === "k") { if (ctx.paletteEl.hidden) ctx.openPalette(); else ctx.closePalette(); return; }
    if (key === "\\") { ctx.toggleSplit(); return; }
    if (key === "f" && shift) { toggleFavsBar(); return; }
    if (key === "j") { void ctx.openTerminalTab(shift ? "new" : "focus"); return; }
    if (key === "n") { void ctx.newTab(); return; }
    if (key === "b" && shift) { ctx.setTopbarHidden(!document.body.classList.contains("topbar-hidden")); return; }
    if (key === "b") { ctx.toggleSidebar(); return; }
    if (key === "t") { navNewTab(); return; }
    if (key === "l") { navEls?.url.focus(); return; }
    if (key === "[") { navCurrent()?.wv.goBack(); return; }
    if (key === "]") { navCurrent()?.wv.goForward(); return; }
    if (key === "w") {
      if (navTabs.length > 1 && navActive !== null) navClose(navActive);
      else if (navPage !== null) ctx.closePage(navPage);
    }
  });
  $<HTMLButtonElement>("navegador-line").addEventListener("click", () => { void openNavTab(); });
}
