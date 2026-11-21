/** "Digitando…" do agente no WhatsApp (tutorial 15): dois cartões, mostrar sempre ou nunca; grava na máquina na hora. */
import type { TypingChoice, WhatsappStatus } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { ctx } from "../app/ctx.js";
import { registrarPassos } from "../tutoriais/passos.js";
import { comPareamento } from "./agente-whatsapp.js";

/** Cartão sendo aplicado (o spinner fica nele); null = parado. */
let digBusy: TypingChoice | null = null;
/** Último recado embaixo dos cartões (erro da máquina); some no próximo clique. */
let digMsg: string | null = null;

const OPCOES: readonly { id: TypingChoice; title: string; text: string }[] = [
  { id: "instant", title: "Mostrar digitando…", text: "Aparece assim que o agente começa a trabalhar na resposta e some quando ela chega. Parece uma conversa com uma pessoa." },
  { id: "never", title: "Não mostrar", text: "O agente responde sem aviso nenhum antes. Quem conversa só vê a resposta chegar." },
];

/** Estado atual numa frase, ao lado do rótulo. */
export function digitandoEstado(st: WhatsappStatus | null): { text: string; on: boolean } {
  if (st?.typingMode === "instant") return { text: "✓ mostrando", on: true };
  if (st?.typingMode === "never") return { text: "não mostra", on: true };
  if (st?.typingMode === "thinking" || st?.typingMode === "message") return { text: `modo "${st.typingMode}", ajustado à mão`, on: true };
  return { text: "automático: ainda sem escolha", on: false };
}

async function escolher(mode: TypingChoice): Promise<void> {
  digBusy = mode; digMsg = null; ctx.paintGuide();
  try {
    const st = comPareamento(await window.meuBot.whatsappTyping(mode));
    ctx.waStatus = st;
    if (st.typingMode !== mode) digMsg = `✗ a máquina ficou em "${st.typingMode ?? "automático"}", não no que você escolheu. Tente de novo.`;
  }
  catch (err: unknown) { digMsg = ipcErrorText(err); }
  finally { digBusy = null; ctx.paintGuide(); }
}

export function renderDigitandoEscolher(container: HTMLElement): void {
  const st = ctx.waStatus;
  const box = el("div", "audio-controls");
  if (st !== null && !st.capacidades.digitando) { box.append(el("p", "hint", "O agente desta máquina não mostra \"digitando…\" nem tem esse ajuste; este tutorial não se aplica aqui.")); container.append(box); return; }
  const estado = digitandoEstado(st);
  const row = el("div", "audio-row");
  row.append(el("strong", "", "Digitando…"), el("span", estado.on ? "audio-ok" : "hint", estado.text));
  box.append(row);
  const cards = el("div", "reply-cards voice-cards");
  const marked = digBusy ?? st?.typingMode ?? null;
  for (const o of OPCOES) {
    const saving = digBusy === o.id;
    const card = el("button", `reply-card${marked === o.id ? " on" : ""}${saving ? " saving" : ""}`);
    card.type = "button"; card.disabled = digBusy !== null || st === null || !st.connected;
    card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(marked === o.id));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.title));
    const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
    card.append(saving ? el("span", "reply-spin") : el("span", "reply-radio"), body);
    card.addEventListener("click", () => { if (digBusy === null && st?.typingMode !== o.id) void escolher(o.id); });
    cards.append(card);
  }
  box.append(cards);
  if (st !== null && st.capacidades.digitandoReinicia) box.append(el("p", "hint", "Nesta máquina, aplicar reinicia o gateway do WhatsApp do agente: ele fica alguns segundos fora do ar."));
  if (st !== null && !st.connected) box.append(el("p", "hint", "Conecte o WhatsApp (tutorial 3) para escolher."));
  if (digMsg !== null) box.append(el("p", "hint guide-pair-note", digMsg));
  container.append(box);
}

/** Liga o passo do "digitando…" ao guia; o renderer.ts chama uma vez. */
export function ligarDigitandoGuia(): void {
  registrarPassos({ "digitando-escolher": (txt) => renderDigitandoEscolher(txt) });
}
