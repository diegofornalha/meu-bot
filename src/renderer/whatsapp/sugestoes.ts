/**
 * Modo "sugere e você aprova" do WhatsApp, na lateral (lista WhatsApp): com o modo ligado, a guarda do OpenClaw segura
 * as respostas do agente e elas aparecem aqui para a pessoa aprovar, editar ou descartar. Só no canal staging por
 * enquanto (docs/planos/modo-gratis-sugestoes.md). O meu-bot-admin vê a fila, sem os botões.
 */
import type { WhatsappSugestao, WhatsappSugestaoPedido, WhatsappSugestoes } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { haQuanto, numeroDoDestino, resumoDoModo, rotuloComContador } from "../lib/sugestoes-view.js";
import { ctx } from "../app/ctx.js";

let estado: WhatsappSugestoes | null = null;
let lidoEm = 0;
let lendo: Promise<void> | null = null;
/** O que está em andamento: o id da sugestão, ou "modo" (ligar/desligar). */
let ocupada: string | null = null;
let editando: { id: string; texto: string; pos: number } | null = null;
let recado: { texto: string; ruim: boolean } | null = null;

const oferecido = (): boolean => ctx.caps.canal === "staging" && ctx.windowHost !== "";
/** Quantas sugestões esperam a pessoa nesta máquina (0 sem o modo, fora do staging ou antes da primeira leitura). */
export const sugestoesPendentes = (): number => (oferecido() && estado !== null && estado.disponivel ? estado.sugestoes.length : 0);

/** O contador no botão "WhatsApp" do seletor das listas. */
export function pintarContadorSugestoes(): void {
  const b = document.querySelector<HTMLButtonElement>('#list-mode button[data-mode="whatsapp"]');
  if (b !== null) b.textContent = rotuloComContador(sugestoesPendentes());
}

/** Lê o modo e a fila (no máximo a cada 10 s, a não ser com `forcar`); repinta a lateral se mudou. */
export function refreshSugestoes(forcar = false): Promise<void> {
  if (!oferecido()) return Promise.resolve();
  if (lendo !== null) return lendo;
  if (!forcar && Date.now() - lidoEm < 10_000) return Promise.resolve();
  lendo = (async () => {
    const antes = JSON.stringify(estado);
    try { estado = await window.meuBot.whatsappSugestoes(); lidoEm = Date.now(); }
    catch { /* fica o que havia: a lista de conversas já mostra a falha de conexão */ }
    finally { lendo = null; }
    if (JSON.stringify(estado) !== antes) { pintarContadorSugestoes(); ctx.renderSidebar(); }
  })();
  return lendo;
}

async function pedir(pedido: WhatsappSugestaoPedido, feito: string): Promise<void> {
  ocupada = "id" in pedido ? pedido.id : "modo"; recado = null; ctx.renderSidebar();
  try { estado = await window.meuBot.whatsappSugestao(pedido); lidoEm = Date.now(); recado = { texto: feito, ruim: false }; if (editando !== null && "id" in pedido && editando.id === pedido.id) editando = null; }
  catch (err) { recado = { texto: ipcErrorText(err), ruim: true }; void refreshSugestoes(true); }
  finally { ocupada = null; pintarContadorSugestoes(); ctx.renderSidebar(); }
}

function botao(texto: string, classe: string, acao: () => void, desligado: boolean): HTMLButtonElement {
  const b = el("button", `btn ${classe} btn-small`, texto);
  b.type = "button"; b.disabled = desligado;
  b.addEventListener("click", (ev) => { ev.stopPropagation(); acao(); });
  return b;
}

function cartao(s: WhatsappSugestao, titulo: (para: string) => string): HTMLElement {
  const box = el("div", "wa-sugestao");
  const cabeca = el("div", "wa-sugestao-head");
  cabeca.append(el("strong", "", `Para ${titulo(s.para)}`), el("span", "", haQuanto(s.em)));
  box.append(cabeca);
  const parado = ocupada !== null;
  const acoes = el("div", "wa-sugestao-acoes");
  if (editando?.id === s.id) {
    const ed = editando;
    const ta = el("textarea", "wa-sugestao-texto");
    ta.value = ed.texto; ta.rows = Math.min(8, Math.max(3, ed.texto.split("\n").length + 1)); ta.maxLength = 4000; ta.disabled = parado;
    ta.addEventListener("input", () => { ed.texto = ta.value; ed.pos = ta.selectionStart; enviar.disabled = ocupada !== null || ta.value.trim() === ""; });
    ta.addEventListener("keyup", () => { ed.pos = ta.selectionStart; });
    ta.addEventListener("click", (ev) => { ev.stopPropagation(); ed.pos = ta.selectionStart; });
    // A lateral se repinta sozinha (a lista relê a cada 30 s): o cursor volta para onde estava.
    queueMicrotask(() => { if (ta.isConnected && !ta.disabled) { ta.focus(); ta.setSelectionRange(ed.pos, ed.pos); } });
    const enviar = botao(ocupada === s.id ? "Enviando…" : "Aprovar com a edição", "btn-primary", () => { void pedir({ acao: "aprovar", id: s.id, texto: ed.texto.trim() }, "Enviada com a sua edição."); }, parado || ed.texto.trim() === "");
    acoes.append(enviar, botao("Cancelar", "btn-ghost", () => { editando = null; ctx.renderSidebar(); }, parado));
    box.append(ta, acoes);
    return box;
  }
  box.append(el("p", "wa-sugestao-corpo", s.texto));
  if (ctx.caps.supportAdmin) return box; // o admin acompanha; quem aprova é a pessoa
  acoes.append(
    botao(ocupada === s.id ? "Enviando…" : "Aprovar", "btn-primary", () => { void pedir({ acao: "aprovar", id: s.id }, "Enviada."); }, parado),
    botao("Editar", "btn-ghost", () => { editando = { id: s.id, texto: s.texto, pos: s.texto.length }; recado = null; ctx.renderSidebar(); }, parado),
    botao("Descartar", "btn-ghost", () => { void pedir({ acao: "descartar", id: s.id }, "Sugestão descartada; nada foi enviado."); }, parado),
  );
  box.append(acoes);
  return box;
}

/**
 * O bloco do modo sugestão no topo da lista do WhatsApp; vazio quando não se aplica (fora do staging, guarda sem o
 * modo, ou modo desligado e sem nada na fila no meu-bot-admin). `titulo` resolve o destino para o nome da conversa.
 */
export function sugestoesSection(titulo: (para: string) => string): HTMLElement[] {
  if (!oferecido() || estado === null || !estado.disponivel) return [];
  const st = estado;
  if (ctx.caps.supportAdmin && !st.ligado && st.sugestoes.length === 0) return [];
  const box = el("div", `wa-sugestoes${st.ligado ? " on" : ""}`);
  const cabeca = el("div", "wa-sugestoes-head");
  cabeca.append(el("span", "grow", resumoDoModo(st.ligado, st.sugestoes.length)));
  if (!ctx.caps.supportAdmin) cabeca.append(botao(ocupada === "modo" ? "Aguarde…" : st.ligado ? "Desligar" : "Ligar", "btn-ghost", () => { void pedir({ acao: st.ligado ? "desligar" : "ligar" }, st.ligado ? "Modo sugestão desligado: o agente volta a responder sozinho." : "Modo sugestão ligado: o agente escreve e você aprova antes de sair."); }, ocupada !== null));
  box.title = "Com o modo sugestão ligado, a resposta do agente no WhatsApp não sai sozinha: ela aparece aqui e você aprova, edita ou descarta. A conversa do seu número com ele mesmo continua direta.";
  box.append(cabeca);
  if (recado !== null) box.append(el("p", `wa-sugestoes-recado${recado.ruim ? " bad" : ""}`, recado.texto));
  for (const s of st.sugestoes) box.append(cartao(s, titulo));
  if (st.sugestoes.length > 1 && !ctx.caps.supportAdmin && editando === null) {
    const pe = el("div", "wa-sugestao-acoes");
    pe.append(botao("Descartar todas", "btn-ghost", () => { void pedir({ acao: "descartar", id: "todas" }, "Sugestões descartadas; nada foi enviado."); }, ocupada !== null));
    box.append(pe);
  }
  return [box];
}

export { numeroDoDestino };
