import type { BackendModel } from "../../shared/ipc";
import type { Tab } from "../renderer.js";
import { ctx } from "../app/ctx.js";

/** Integração A: o trecho vai para o compositor da conversa (atual ou nova) em bloco de código; a pessoa escreve a pergunta e envia. */
/** Volta à conversa: a que estava aberta antes da página, senão a última aba; sem nenhuma, cria uma. */
async function backToChat(): Promise<Tab | null> {
  const cur = ctx.active();
  if (cur !== null) return cur;
  const back = ctx.pagePrev !== null && ctx.tabs.has(ctx.pagePrev) ? ctx.pagePrev : [...ctx.tabs.keys()].at(-1);
  if (back !== undefined) { ctx.activate(back); return ctx.active(); }
  return ctx.newTab();
}

/**
 * Passo "Ver os limites na conversa" do tutorial da status line: leva à conversa com uma mensagem pronta no
 * compositor (nada é enviado sozinho) e diz onde olhar. O passo se conclui sozinho quando a conta traz os limites.
 */
export async function goToChatFromGuide(message: string, hint: string, model?: BackendModel): Promise<void> {
  const tab = await backToChat();
  if (tab === null) return;
  // Tutorial 4: a conversa passa a usar o grok-4 (o backend recebe a nota de troca de modelo, como pela paleta).
  if (model !== undefined && tab.model !== model) { if (!ctx.prefersReducedMotion) ctx.showModeToast(model); ctx.setTabModel(tab, model); void window.meuBot.setConversationModel(tab.id, model); }
  if (ctx.inputEl.value.trim() === "") ctx.inputEl.value = message;
  ctx.addNotice(tab, `Vou enviar em 3, 2, 1 para você ver acontecendo (digitar ou Esc cancela; Enviar manda já). ${hint}`);
  ctx.inputEl.focus(); ctx.inputEl.setSelectionRange(ctx.inputEl.value.length, ctx.inputEl.value.length);
  ctx.syncComposer();
  if (!tab.busy) startAutoSend(tab);
}

/**
 * Contagem regressiva no botão Enviar ("Enviando em 3 → 2 → 1") e envio sozinho, para a pessoa ver o fluxo
 * acontecer. Qualquer gesto dela manda: digitar ou Esc cancela, clicar em Enviar manda na hora; trocar de
 * aba ou esvaziar o compositor também cancela.
 */
function startAutoSend(tab: Tab): void {
  cancelAutoSend();
  let n = 3;
  const paint = (): void => { ctx.sendBtn.textContent = `Enviando em ${n}`; ctx.sendBtn.classList.add("countdown"); ctx.sendBtn.classList.remove("shine"); };
  paint();
  const timer = window.setInterval(() => {
    if (ctx.active() !== tab || tab.busy || ctx.inputEl.value.trim() === "") { cancelAutoSend(); return; }
    n -= 1;
    if (n > 0) { paint(); return; }
    cancelAutoSend();
    void ctx.sendMessage();
  }, 1000);
  ctx.autoSend = { timer, tab };
}
export function cancelAutoSend(): void {
  if (ctx.autoSend === null) return;
  window.clearInterval(ctx.autoSend.timer);
  ctx.autoSend = null;
  ctx.sendBtn.classList.remove("countdown");
  ctx.syncComposer();
}

export async function askAgentAbout(text: string): Promise<void> {
  const trecho = text.replace(/\s+$/, "");
  if (trecho === "") return;
  const tab = await backToChat();
  if (tab === null) return;
  const cur = ctx.inputEl.value.trim();
  const fence = "```";
  ctx.inputEl.value = `${cur === "" ? "" : `${cur}\n\n`}Sobre esta saída do terminal:\n\n${fence}\n${trecho}\n${fence}\n\n`;
  ctx.inputEl.focus(); ctx.inputEl.setSelectionRange(ctx.inputEl.value.length, ctx.inputEl.value.length);
  ctx.syncComposer();
}

/**
 * Leva ao chat um texto pedido por fora (a página de um módulo): só preenche a caixa, com um aviso de onde veio; quem
 * envia é a pessoa. Diferente do goToChatFromGuide, não há envio automático.
 */
export async function preencherChat(message: string, aviso: string): Promise<void> {
  const tab = await backToChat();
  if (tab === null) return;
  ctx.inputEl.value = message;
  ctx.addNotice(tab, aviso);
  ctx.inputEl.focus(); ctx.inputEl.setSelectionRange(ctx.inputEl.value.length, ctx.inputEl.value.length);
  ctx.syncComposer();
}
