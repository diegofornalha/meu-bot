/** Entrada rápida no guia (tutorial 13): o gravador de atalho e o botão que mostra a janela flutuante. */
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { ctx } from "../app/ctx.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { registrarPassos } from "../tutoriais/passos.js";

/** Texto do status do atalho global, como era nas Configurações. */
const quickStatusText = (): string => {
  const st = ctx.settings?.quickEntryStatus ?? null;
  return st === "registered" ? "✓ ativo" : st === "taken" ? "em uso por outro app: escolha outra combinação" : st === "invalid" ? "combinação inválida" : st === "disabled" ? "desligado" : "…";
};
let quickMsg: string | null = null;
/** Tutorial 13, passo 1: o gravador de atalho (saiu das Configurações em 30 out). A combinação pressionada é salva na hora. */
export function renderQuickAtalho(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const row = el("div", "audio-row");
  const input = el("input") as HTMLInputElement;
  input.type = "text"; input.autocomplete = "off"; input.placeholder = "CommandOrControl+Shift+Space";
  input.value = ctx.settings?.quickEntryShortcut ?? "";
  input.title = "Clique e pressione a combinação; Backspace limpa";
  const salvar = (shortcut: string): void => {
    input.disabled = true; quickMsg = null;
    void window.meuBot.setSettings({ quickEntryShortcut: shortcut }).then((view) => { ctx.applySettings(view); ctx.paintGuide(); })
      .catch((err: unknown) => { quickMsg = `✗ ${ipcErrorText(err)}`; ctx.paintGuide(); })
      .finally(() => { input.disabled = false; });
  };
  input.addEventListener("keydown", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (ev.key === "Backspace") { input.value = ""; return; }
    if (["Meta", "Control", "Alt", "Shift"].includes(ev.key)) return;
    const mods = [ev.metaKey || ev.ctrlKey ? "CommandOrControl" : null, ev.altKey ? "Alt" : null, ev.shiftKey ? "Shift" : null].filter((m): m is string => m !== null);
    if (mods.length === 0) return;
    const key = ev.key === " " ? "Space" : ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
    input.value = [...mods, key].join("+");
    salvar(input.value);
  });
  const status = el("span", (ctx.settings?.quickEntryStatus ?? null) === "registered" ? "audio-ok" : "hint", quickStatusText());
  row.append(input, status);
  box.append(row);
  if (quickMsg !== null) box.append(el("p", "hint guide-pair-note", quickMsg));
  container.append(box);
}
/** Tutorial 13, passo 2: mostrar a janela flutuante daqui mesmo, para quem quer ver antes de decorar o atalho. */
export function renderQuickTestar(container: HTMLElement): void {
  const b = el("button", "btn btn-ghost btn-small", "Mostrar a janela flutuante"); b.type = "button";
  b.title = ctx.settings?.quickEntryShortcut ? `O mesmo que pressionar ${ctx.settings.quickEntryShortcut}` : "";
  b.addEventListener("click", () => { void window.meuBot.toggleQuickEntry(); });
  container.append(b);
}

/** Liga os dois passos da entrada rápida ao guia; o renderer.ts chama uma vez. */
export function ligarEntradaRapidaGuia(): void {
  registrarFonte("quickentry", () => ({ known: ctx.settings !== null, dados: { quickEntry: { status: ctx.settings?.quickEntryStatus ?? null, shortcut: ctx.settings?.quickEntryShortcut ?? "" } } }));
  registrarPassos({ "quick-atalho": (txt) => renderQuickAtalho(txt), "quick-testar": (txt) => renderQuickTestar(txt) });
}
