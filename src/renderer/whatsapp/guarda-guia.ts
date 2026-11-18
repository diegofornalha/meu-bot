/** Guarda do WhatsApp no guia (tutorial 8): estado na máquina, ativar e o progresso do instalador. */
import { el } from "../lib/dom.js";
import { esperaOuFalha } from "../lib/carregando.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { ctx, ehRemoto } from "../app/ctx.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { registrarPassos } from "../tutoriais/passos.js";

/** Guarda do WhatsApp nesta máquina (tutorial 8): null = não consultado ou sem OpenClaw (`guardaRespondeu` separa os dois). */
export let guardaState: boolean | null = null;
/** A máquina já respondeu à consulta; com `guardaState === null`, é máquina sem OpenClaw, e não espera. */
let guardaRespondeu = false;
let guardaErro: string | null = null;
let guardaBusy = false;
let guardaLog: string[] = [];
/** Último recado do passo "Ativar" (erro ou "Guarda ativa."); `setGuardaMsg` para quem muda de fora (o reset do tutorial). */
export let guardaMsg: { text: string; bad: boolean } | null = null;
export function setGuardaMsg(v: { text: string; bad: boolean } | null): void { guardaMsg = v; }

export async function refreshGuarda(): Promise<void> {
  if (!ctx.caps.install || ctx.windowHost === "") return;
  try { guardaState = await window.meuBot.guardaInstalled(); guardaRespondeu = true; guardaErro = null; } catch (err) { guardaErro = ipcErrorText(err); /* fica o estado que havia */ }
  ctx.paintGuide();
}
export function renderGuardaInstall(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  // Agente que não aceita a guarda (capacidade): explica, sem botão que falharia na máquina.
  if (ctx.waStatus !== null && !ctx.waStatus.capacidades.guarda) { box.append(el("p", "hint", "O agente desta máquina não aceita a guarda do meu-bot; este tutorial não se aplica aqui.")); container.append(box); return; }
  // Sem OpenClaw nesta máquina: a consulta respondeu, e não há onde instalar. Antes isto era lido como "consultando".
  if (guardaRespondeu && guardaState === null && !guardaBusy) {
    box.append(el("p", "hint", "Esta máquina não tem o OpenClaw instalado; a guarda do WhatsApp não se aplica aqui."));
    const again = el("button", "btn btn-ghost btn-small", "Conferir de novo"); again.type = "button";
    again.addEventListener("click", () => { guardaRespondeu = false; ctx.paintGuide(); void refreshGuarda(); });
    box.append(again); container.append(box); return;
  }
  const row = el("div", "audio-row");
  if (guardaState === true && !guardaBusy) row.append(el("span", "audio-ok", "✓ ativa nesta máquina"));
  const b = el("button", `btn ${guardaState === true ? "btn-ghost" : "btn-primary"} btn-small`, guardaBusy ? "Ativando…" : guardaState === true ? "Reinstalar" : "Ativar");
  b.type = "button"; b.disabled = guardaBusy || guardaState === null;
  b.addEventListener("click", () => {
    guardaBusy = true; guardaLog = []; guardaMsg = null; ctx.paintGuide();
    void window.meuBot.installGuarda()
      .then((r) => { guardaMsg = r.ok ? { text: "Guarda ativa.", bad: false } : { text: r.log.at(-1) ?? "a instalação falhou", bad: true }; })
      .catch((err: unknown) => { guardaMsg = { text: ipcErrorText(err), bad: true }; })
      .finally(() => { guardaBusy = false; void refreshGuarda(); });
  });
  row.append(b);
  box.append(row);
  if (guardaState === null) box.append(esperaOuFalha({ erro: guardaErro, chave: "guia-guarda", tentar: () => { guardaErro = null; ctx.paintGuide(); void refreshGuarda(); } }));
  if (guardaBusy && guardaLog.length > 0) box.append(el("pre", "admin-logs", guardaLog.join("\n")));
  if (guardaMsg !== null) box.append(el("p", `hint ${guardaMsg.bad ? "guide-pair-note" : "audio-ok"}`, guardaMsg.text));
  container.append(box);
}

/** Liga o passo da guarda ao guia e o progresso do instalador; o renderer.ts chama uma vez. */
export function ligarGuardaGuia(): void {
  registrarFonte("guarda", () => ({ known: guardaState !== null || guardaRespondeu || !ehRemoto() || (ctx.waStatus !== null && !ctx.waStatus.capacidades.guarda), dados: { guarda: { installed: guardaState, possible: ctx.waStatus === null ? null : ctx.waStatus.capacidades.guarda } } }));
  registrarPassos({ "guarda-install": (txt) => renderGuardaInstall(txt) });
  window.meuBot.on("guarda:progress", ({ line }) => { guardaLog = [...guardaLog, line].slice(-6); if (guardaBusy) ctx.paintGuide(); });
}
