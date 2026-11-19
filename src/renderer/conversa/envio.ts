import type { DoneEvent, ErrorEvent, BackendStatusEvent, SettingsView } from "../../shared/ipc";
import { TUTORIAIS } from "../lib/tutoriais.js";
import type { Tab } from "../renderer.js";
import { ctx } from "../app/ctx.js";
import { backendStatusVisto, offerBackendInstall } from "./backend-falta.js";
import { CAMINHO_DEVICE, DEVICE_PENDENTE_TEXTO, DEVICE_PENDENTE_TITULO, ehDevicePendente, resultadoDaConferencia } from "../lib/device-pendente.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { el } from "../lib/dom.js";
import { avisoLimiteNoChat } from "../lib/contas-claude.js";

export async function sendText(tab: Tab, raw: string): Promise<void> {
  const text = raw.trim();
  if (text === "" || tab.busy) return;
  const cur = ctx.index.get(tab.id);
  const userIndex = cur?.messages.length ?? 0;
  ctx.appendMessage(tab, "user", text, userIndex);
  if (!tab.titled) ctx.setTitle(tab, text);
  ctx.patchIndex(tab.id, { messages: [...(cur?.messages ?? []), { role: "user", content: text }], openAsTab: true });
  ctx.scrollToBottom(tab);
  ctx.setBusy(tab, true);
  tab.currentAssistant = null;
  tab.pendingText = "";
  ctx.setSendPhase(tab, "sending");
  try {
    await window.meuBot.send(tab.id, text);
  } catch (err) {
    ctx.addNotice(tab, err instanceof Error ? err.message : String(err), "error");
    ctx.setSendPhase(tab, null);
  } finally {
    if (ctx.tabs.has(tab.id)) { ctx.setBusy(tab, false); if (ctx.sendPhase.get(tab.id) !== "done") ctx.setSendPhase(tab, null); }
  }
}

export async function sendMessage(): Promise<void> {
  const tab = ctx.active();
  if (tab === null) return;
  const text = ctx.inputEl.value;
  if (text.trim() === "" || tab.busy) return;
  ctx.inputEl.value = "";
  tab.draft = "";
  await sendText(tab, text);
}

const markUnread = (tab: Tab): void => { if (tab.id !== ctx.activeId) tab.dotEl.hidden = false; };

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarEnvio(): void {
  window.meuBot.on("chat:assistant-start", ({ conversationId }) => {
    const tab = ctx.tabs.get(conversationId);
    if (tab === undefined) return;
    if (ctx.sendPhase.get(tab.id) === "sending") ctx.setSendPhase(tab, "streaming");
    tab.pendingText = "";
    tab.navSitesTurn = new Set();
    tab.currentAssistant = ctx.startAssistantBubble(tab, conversationId);
    ctx.scrollToBottom(tab, false);
  });
  window.meuBot.on("chat:delta", ({ conversationId, text }) => {
    const tab = ctx.tabs.get(conversationId);
    if (tab === undefined) return;
    if (ctx.sendPhase.get(tab.id) === "sending") ctx.setSendPhase(tab, "streaming");
    if (tab.currentAssistant === null) tab.currentAssistant = ctx.startAssistantBubble(tab, conversationId);
    tab.pendingText += text;
    ctx.scheduleRender(tab);
    markUnread(tab);
  });
  window.meuBot.on("chat:done", (done: DoneEvent) => {
    const tab = ctx.tabs.get(done.conversationId);
    if (tab === undefined) return;
    if (done.stopReason === "cancelled" || done.refusal !== undefined) ctx.setSendPhase(tab, null);
    else { ctx.setSendPhase(tab, "done"); setTimeout(() => { if (ctx.sendPhase.get(tab.id) === "done") ctx.setSendPhase(tab, null); }, 900); }
    if (done.ms !== undefined) { tab.lastTurn = { ms: done.ms, completion: done.usage?.completion ?? 0 }; if (tab.id === ctx.activeId) ctx.paintContext(tab); }
    if (tab.renderTimer !== null) { clearTimeout(tab.renderTimer); ctx.flushRender(tab); }
    if (tab.currentAssistant !== null && tab.pendingText === "") tab.currentAssistant.remove();
    if (done.stopReason === "cancelled") ctx.addNotice(tab, "Resposta interrompida.", "warn");
    if (done.refusal !== undefined) {
      const cat = done.refusal.category ?? "não informada";
      ctx.addNotice(tab, `A resposta foi recusada pelo modelo (categoria: ${cat}). ${done.refusal.explanation}`.trim(), "warn");
    }
    if (tab.pendingText !== "") {
      const cur = ctx.index.get(tab.id);
      const had = ctx.firstReplyOnHost();
      ctx.patchIndex(tab.id, { messages: [...(cur?.messages ?? []), { role: "assistant", content: tab.pendingText, ...(done.provider === undefined ? {} : { provider: done.provider }), ...(done.fallback === undefined ? {} : { fallback: done.fallback }) }] });
      // Tutorial 1: a primeira resposta aconteceu; lembrar na flag, senão apagar as conversas "desfaz" o passo.
      if (!had && ctx.windowHost !== "") { const t1 = TUTORIAIS.find((x) => x.id === "claude-login"); if (t1 !== undefined && !ctx.loadGuideFlags(t1).claudeReplied) ctx.saveGuideFlag(t1, "claudeReplied"); }
      if (tab.currentAssistant !== null) ctx.paintProviderLabel(tab.currentAssistant, tab.model, done.provider, done.fallback);
      // Tutorial 4: a prova de que o grok-4 responde é o X-Provider da resposta, não o que o modelo diz de si.
      const grokNow = done.provider === "grok-4" && !ctx.loadGuideFlags(ctx.XAI_TUTORIAL).grokReplied;
      if (grokNow) ctx.saveGuideFlag(ctx.XAI_TUTORIAL, "grokReplied");
      // A reserva assumiu de verdade: o passo 3 do tutorial 5 se marca sozinho.
      if (done.fallback !== undefined && !ctx.loadGuideFlags(ctx.FALLBACK_TUTORIAL).fallbackSeen) { ctx.saveGuideFlag(ctx.FALLBACK_TUTORIAL, "fallbackSeen"); ctx.paintGuide(); }
      if (!had || grokNow) ctx.paintGuide(); // primeira resposta nesta máquina (tutorial 1) / primeira do grok-4 (tutorial 4)
    }
    markUnread(tab);
    ctx.maybeNotify(tab, tab.pendingText);
    if (tab.navSitesTurn.size > 0) { ctx.offerSkillFromTurn(tab); tab.navSitesTurn = new Set(); }
  });
  window.meuBot.on("chat:error", (e: ErrorEvent) => {
    const tab = ctx.tabs.get(e.conversationId);
    if (tab === undefined) return;
    ctx.setSendPhase(tab, null);
    if (tab.renderTimer !== null) { clearTimeout(tab.renderTimer); ctx.flushRender(tab); }
    if (tab.currentAssistant !== null && tab.pendingText === "") tab.currentAssistant.remove();
    const limite = avisoLimiteNoChat(e.code);
    if (ehDevicePendente(e.code)) avisarDevicePendente(tab);
    else ctx.addNotice(tab, limite !== null ? `${limite.title}. ${limite.text}` : e.message, limite !== null ? "warn" : "error");
    ctx.offerClaudeLogin(tab, e.message);
    offerBackendInstall(tab, e.message);
    markUnread(tab);
    ctx.maybeNotify(tab, e.message);
  });
  window.meuBot.on("backend:status", (st: BackendStatusEvent) => {
    ctx.hostStatus.set(st.host, st);
    backendStatusVisto(st);
    const tab = ctx.active();
    if (tab !== null && tab.host === st.host) ctx.paintStatus(st.host);
  });
  window.meuBot.on("settings:changed", (view: SettingsView) => {
    // Outra janela salvou: fonte/tema/notificações valem para todas; o modelo padrão vem resolvido pela máquina.
    ctx.applySettings({ ...view, backendModelForHost: ctx.settings?.backendModelForHost ?? view.backendModelForHost });
  });
}

/**
 * O backend recusou o chat porque este Mac passou do limite de devices: o aviso explica e traz os dois caminhos,
 * adicionar um device no console e conferir se a vaga já abriu (reemite a licença da conta na máquina e apresenta o Mac).
 */
function avisarDevicePendente(tab: Tab): void {
  const box = el("div", "notice notice-warn");
  const resultado = el("p", "hint"); resultado.setAttribute("role", "status");
  const adicionar = el("button", "btn btn-primary btn-small", "Adicionar um device"); adicionar.type = "button";
  adicionar.addEventListener("click", () => { void window.meuBot.contaAbrirConsole(CAMINHO_DEVICE).catch((err: unknown) => { resultado.textContent = ipcErrorText(err); }); });
  const conferir = el("button", "btn btn-ghost btn-small", "Já adicionei: conferir"); conferir.type = "button";
  conferir.addEventListener("click", () => {
    conferir.disabled = true; resultado.textContent = "Conferindo…";
    void window.meuBot.planoConferirDevice()
      .then((r) => { resultado.textContent = resultadoDaConferencia(r.status).texto; })
      .catch((err: unknown) => { resultado.textContent = ipcErrorText(err); })
      .finally(() => { conferir.disabled = false; });
  });
  const acoes = el("div", "notice-actions"); acoes.append(adicionar, conferir);
  box.append(el("strong", "", DEVICE_PENDENTE_TITULO), el("p", "", DEVICE_PENDENTE_TEXTO), acoes, resultado);
  tab.messagesEl.appendChild(box);
  ctx.scrollToBottom(tab, false);
}
