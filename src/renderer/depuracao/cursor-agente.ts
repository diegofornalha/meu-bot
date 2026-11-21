/**
 * Cursor do agente (19 nov): com a depuração ligada, quando uma ação do Navegador acontece num lugar da página (clicar,
 * digitar), um cursor único anda até ESSE ponto (o main mede o elemento e manda em `EventoDepuracao.ponto`), com o nome
 * de quem age. Ele fica parado onde agiu e some depois de um tempo sem ação, ou na hora se a aba dele sair da vista. Serve para ver de fora onde o agente mexe.
 * É o modo "real" do instagramável: enquanto ele está em cena, as marcas e a lista (instagramavel.ts) saem do palco e o que cada log
 * fez aparece no balão dele; o show só volta CENA_MS depois da última ação na página.
 */
import type { EventoDepuracao, PontoDepuracao } from "../../shared/ipc";
import { pontoNaTela, rotuloDoDono, textoDoBalao } from "../lib/instagramavel-core.js";
import { faixaLigada } from "./faixa.js";

/** Sem ação por este tempo, o cursor esmaece (a próxima ação o traz de volta de onde parou). */
const SOME_MS = 8000;
/**
 * Depois da última ação na página, o real segura a cena por este tempo, mesmo já esmaecido: o show só volta depois.
 * Sem isso os dois modos se intercalam a cada pausa do agente (clica, lê, clica).
 */
const CENA_MS = 30_000;
const SETA = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 2l16 11.5-7 1.2 4.2 7.3-3 1.7-4.2-7.3L5 21z" fill="currentColor" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
type WebviewComId = HTMLElement & { getWebContentsId(): number };

let el: HTMLDivElement | null = null;
let nomeEl: HTMLSpanElement | null = null;
let balaoEl: HTMLSpanElement | null = null;
let emCena = false;
const ouvintes: Array<(emCena: boolean) => void> = [];

/** O cursor real está à vista (agiu há menos de SOME_MS)? Enquanto está, o show não entra. */
export const realEmCena = (): boolean => emCena;
/** Avisa quando o real entra em cena e quando sai (o show usa para sair do palco e voltar). */
export function aoMudarCena(fn: (emCena: boolean) => void): void { ouvintes.push(fn); }
function cena(on: boolean): void {
  if (on === emCena) return;
  emCena = on;
  for (const fn of ouvintes) fn(on);
}
/** O que o log fez, no balão do real (vazio esconde o balão). */
function falar(e: EventoDepuracao): void {
  if (balaoEl === null) return;
  const fala = textoDoBalao(e);
  if (fala === "") return; // sem nada a dizer (js, sonda): fica o que estava
  balaoEl.textContent = fala; balaoEl.classList.add("on"); balaoEl.classList.toggle("agente-balao-erro", !e.ok);
}
let ultimo: { x: number; y: number } | null = null;
let sumir: ReturnType<typeof setTimeout> | null = null;
let soltar: ReturnType<typeof setTimeout> | null = null;
/** A aba onde o cursor está e o retângulo dela naquele momento: mudou (outra aba, outra tela, janela) → ele sai. */
let onde: { aba: number; chave: string } | null = null;
let vigia: ReturnType<typeof setInterval> | null = null;
const chaveDe = (r: DOMRect): string => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
/** Tira o cursor da tela na hora e solta a cena (a aba dele saiu da vista: ele não pode ficar em cima de outra página). */
function sair(): void {
  if (sumir !== null) { clearTimeout(sumir); sumir = null; }
  if (soltar !== null) { clearTimeout(soltar); soltar = null; }
  if (vigia !== null) { clearInterval(vigia); vigia = null; }
  if (el !== null) el.hidden = true;
  balaoEl?.classList.remove("on");
  ultimo = null; onde = null; cena(false);
}

/** O webview da aba (id do webContents) nesta janela, ou null. */
function webviewDaAba(aba: number): (WebviewComId & { getURL(): string }) | null {
  for (const w of document.querySelectorAll<WebviewComId & { getURL(): string }>("webview")) {
    try { if (w.getWebContentsId() === aba) return w; } catch { /* ainda não anexado */ }
  }
  return null;
}
/** O retângulo, na janela, do webview da aba, se ela está à vista; senão null. */
export function retanguloDaAba(aba: number): DOMRect | null {
  const r = webviewDaAba(aba)?.getBoundingClientRect();
  return r !== undefined && r.width > 0 && r.height > 0 ? r : null;
}
/** O endereço que a aba mostra agora ("" se não há): mudou desde a leitura → a página é outra. */
export function urlDaAba(aba: number): string {
  try { return webviewDaAba(aba)?.getURL() ?? ""; } catch { return ""; }
}
/** O ponto real na tela, se a aba da ação está à vista nesta janela. */
export function pontoReal(p: PontoDepuracao | undefined): { x: number; y: number } | null {
  if (p === undefined) return null;
  const r = retanguloDaAba(p.aba);
  return r === null ? null : pontoNaTela(p, r);
}
function criar(): HTMLDivElement {
  const d = document.createElement("div"); d.className = "agente-cursor"; d.setAttribute("aria-hidden", "true"); d.hidden = true;
  d.innerHTML = SETA;
  nomeEl = document.createElement("span"); nomeEl.className = "agente-nome";
  balaoEl = document.createElement("span"); balaoEl.className = "agente-balao";
  d.append(nomeEl, balaoEl); document.body.append(d);
  return d;
}
function mover(e: EventoDepuracao): void {
  if (!faixaLigada()) return;
  const fim = pontoReal(e.ponto);
  // Log sem lugar na página (nota, terminal): com o real em cena, ele conta no balão, sem sair de onde está.
  // Ele reaparece onde parou, mas não renova a cena: só ação na página segura o show fora.
  if (fim === null) { if (emCena && el !== null) { falar(e); el.classList.remove("some"); armarSumico(); } return; }
  el ??= criar();
  falar(e);
  cena(true);
  nomeEl!.textContent = rotuloDoDono(e.dono);
  el.classList.toggle("agente-erro", !e.ok);
  const ini = ultimo ?? { x: fim.x - 120, y: fim.y + 90 };
  el.hidden = false; el.classList.remove("some");
  const calmo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Anda do último ponto até o novo, como uma mão no mouse; no fim, o clique (afunda e volta) e um anel.
  const anda = el.animate([{ transform: `translate(${ini.x}px, ${ini.y}px)` }, { transform: `translate(${fim.x}px, ${fim.y}px)` }], { duration: calmo ? 0 : 520, easing: "cubic-bezier(.3,.1,.2,1)", fill: "forwards" });
  anda.onfinish = () => {
    if (el === null) return;
    if (!calmo) el.animate([{ transform: `translate(${fim.x}px, ${fim.y}px) scale(1)` }, { transform: `translate(${fim.x}px, ${fim.y}px) scale(.8)` }, { transform: `translate(${fim.x}px, ${fim.y}px) scale(1)` }], { duration: 200, fill: "forwards" });
    const anel = document.createElement("span"); anel.className = "agente-anel"; anel.style.left = `${fim.x}px`; anel.style.top = `${fim.y}px`;
    document.body.append(anel);
    anel.animate([{ transform: "translate(-50%, -50%) scale(.3)", opacity: 1 }, { transform: "translate(-50%, -50%) scale(1.5)", opacity: 0 }], { duration: calmo ? 1 : 500, easing: "ease-out" }).onfinish = () => anel.remove();
  };
  ultimo = fim;
  const r = e.ponto === undefined ? null : retanguloDaAba(e.ponto.aba);
  onde = e.ponto === undefined || r === null ? null : { aba: e.ponto.aba, chave: chaveDe(r) };
  vigia ??= setInterval(() => {
    const agora = onde === null ? null : retanguloDaAba(onde.aba);
    if (onde === null || agora === null || chaveDe(agora) !== onde.chave) sair();
  }, 400);
  armarSumico();
  if (soltar !== null) clearTimeout(soltar);
  soltar = setTimeout(sair, CENA_MS);
}
/** Esmaece depois de SOME_MS sem log; a cena continua dele até CENA_MS sem ação na página. */
function armarSumico(): void {
  if (sumir !== null) clearTimeout(sumir);
  sumir = setTimeout(() => { el?.classList.add("some"); balaoEl?.classList.remove("on"); }, SOME_MS);
}
/** O renderer.ts chama uma vez, depois de ligarFaixaDepuracao. */
export function ligarCursorAgente(): void {
  window.meuBot.on("depuracao:evento", mover);
  window.meuBot.on("depuracao:estado", (s: { ligado: boolean }) => {
    if (!s.ligado) sair();
  });
}
