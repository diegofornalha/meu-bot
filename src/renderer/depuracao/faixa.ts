/**
 * Faixa de depuração no topo da janela (31 out): esquerda o build (versão · branch · commit), centro a última ação que
 * chegou de fora (fase 2 traz o fluxo inteiro), direita a saúde: batimento do main, túnel e reversos. Ligada no
 * staging; nas outras variantes pela paleta ou `--depuracao`. Molde: app/rede.ts (faixa OFFLINE).
 */
import type { BackendStatusEvent, BatimentoDepuracao, BrowserAgentState, EstadoDepuracao, EventoDepuracao, GmailAgenteState } from "../../shared/ipc";
import { byId as $ } from "../lib/dom.js";
import { estadoBatimento, linhaEvento, rotuloBuild, rotuloReversos, rotuloTunel, textoSaude } from "../lib/depuracao-core.js";
import { ctx } from "../app/ctx.js";

const bar = $<HTMLElement>("depuracao-bar");
const buildEl = $<HTMLElement>("dep-build");
const feedEl = $<HTMLElement>("dep-feed");
const saudeEl = $<HTMLElement>("dep-saude");
const listaEl = $<HTMLElement>("dep-lista");
/** Selos "DEPURAÇÃO" ao lado do PRO nas duas barras: acesos com o modo ligado; o clique alterna. */
const selos = [$<HTMLButtonElement>("dep-badge"), $<HTMLButtonElement>("mini-dep")];
let estadoConhecido = false;
/** A lista das últimas ações, aberta pelo clique no fluxo. */
let aberta = false;
let ligada = false;
/** Hora (deste relógio) em que o último tique do main chegou; null = nenhum ainda. */
let ultimoTique: number | null = null;
let marca: string | null = null;
let navPorta: number | null = null;
let gmailPorta: number | null = null;
let eventos: EventoDepuracao[] = [];
let relogio: ReturnType<typeof setInterval> | null = null;
const hora = (em: number): string => new Date(em).toLocaleTimeString("pt-BR");

export const faixaLigada = (): boolean => ligada;
function pintar(): void {
  for (const b of selos) { b.hidden = !estadoConhecido; b.classList.toggle("on", ligada); b.setAttribute("aria-pressed", String(ligada)); }
  bar.hidden = !ligada;
  if (!ligada) return;
  const b = estadoBatimento(ultimoTique, Date.now());
  bar.classList.toggle("dep-travado", !b.ok);
  const st = ctx.hostStatus.get(ctx.windowHost) ?? null;
  saudeEl.textContent = [textoSaude(b, b.ok ? null : marca), rotuloTunel(st?.state ?? null), rotuloReversos(navPorta, gmailPorta)].filter((x) => x !== "").join(" · ");
  const ultimo = eventos[eventos.length - 1];
  feedEl.textContent = ultimo !== undefined ? linhaEvento(ultimo, hora) : "sem ações de fora ainda";
  feedEl.classList.toggle("dep-nota", ultimo?.origem === "nota");
  feedEl.title = ultimo !== undefined ? "clique para ver as últimas ações" : "";
  listaEl.hidden = !aberta;
  if (aberta) pintarLista();
}
/** As últimas 6 ações, mais nova primeiro; cada uma abre o JSON do pedido. */
function pintarLista(): void {
  listaEl.replaceChildren();
  for (const e of eventos.slice(-6).reverse()) {
    const d = document.createElement("details"); d.className = `dep-item${e.ok ? "" : " dep-erro"}${e.origem === "nota" ? " dep-nota" : ""}`;
    const sum = document.createElement("summary"); sum.textContent = linhaEvento(e, hora) + (e.ms !== null ? ` · ${e.ms} ms` : "");
    const pre = document.createElement("pre"); pre.textContent = JSON.stringify({ origem: e.origem, dono: e.dono, rota: e.rota, ok: e.ok, ms: e.ms, em: new Date(e.em).toISOString(), detalhe: e.detalhe ?? null }, null, 1);
    d.append(sum, pre); listaEl.append(d);
  }
  if (eventos.length === 0) listaEl.textContent = "nada chegou de fora ainda";
}
function aplicarEstado(e: EstadoDepuracao): void {
  estadoConhecido = true;
  ligada = e.ligado; eventos = e.eventos; ultimoTique = Date.now(); marca = e.batimento.marca;
  if (ligada && relogio === null) relogio = setInterval(pintar, 1000);
  if (!ligada && relogio !== null) { clearInterval(relogio); relogio = null; }
  pintar();
}
/** Liga eventos e o estado inicial; o renderer.ts chama uma vez (depois de ligarEnvio, que mantém ctx.hostStatus). */
export function ligarFaixaDepuracao(): void {
  feedEl.addEventListener("click", () => { aberta = !aberta; pintar(); });
  for (const b of selos) b.addEventListener("click", () => { void alternarDepuracao(); });
  void window.meuBot.getWindowInfo().then((i) => { if (i !== null) buildEl.textContent = rotuloBuild(i.version, i.compilacao); }).catch(() => undefined);
  void window.meuBot.depuracaoEstado().then(aplicarEstado).catch(() => undefined);
  window.meuBot.on("depuracao:estado", aplicarEstado);
  window.meuBot.on("depuracao:batimento", (b: BatimentoDepuracao) => { ultimoTique = Date.now(); marca = b.marca; if (ligada) pintar(); });
  window.meuBot.on("depuracao:evento", (e: EventoDepuracao) => { eventos.push(e); if (eventos.length > 300) eventos.shift(); if (ligada) pintar(); });
  window.meuBot.on("backend:status", (st: BackendStatusEvent) => { if (ligada && st.host === ctx.windowHost) pintar(); });
  window.meuBot.on("browser:agent", (a: BrowserAgentState) => { navPorta = a.on && a.state === "up" ? a.port : null; if (ligada) pintar(); });
  window.meuBot.on("gmail:agent", (a: GmailAgenteState) => { gmailPorta = a.on && a.state === "up" ? a.port : null; if (ligada) pintar(); });
}
/** Paleta: liga ou desliga para todas as janelas (fica gravado). */
export async function alternarDepuracao(): Promise<void> {
  const ligar = !ligada;
  aplicarEstado(await window.meuBot.depuracaoLigar(ligar));
  ctx.showTextToast(ligar ? "Modo de depuração ligado" : "Modo de depuração desligado", ligar ? "A faixa no topo mostra o build, o batimento do processo principal, o túnel e o que chega de fora." : "A faixa some; o selo ao lado do PRO liga de novo.");
}
