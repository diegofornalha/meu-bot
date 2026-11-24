import { byId as $, el } from "../lib/dom.js";
import { TUTORIAIS, type Tutorial } from "../lib/tutoriais.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import type { OllamaEvento, OllamaStatus } from "../../shared/ipc";
import { ctx } from "../app/ctx.js";
import { modoOllama, type ModoOllama } from "../lib/modo-ollama.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { registrarPassos } from "../tutoriais/passos.js";

// ---- Modo grátis (tutorial 16): o Ollama do meu-bot neste Mac (ollamaLocal.ts no main) ou na máquina por SSH desta
// janela (install-ollama.sh). Linha na lateral abaixo do Claude, os passos "Conferir a máquina" e "Instalar" e a fonte
// `ollama` do guia. Só no staging; onde roda, quem diz é o status (`possivel`).

export const OLLAMA_TUTORIAL = TUTORIAIS.find((t) => t.id === "ollama-local") as Tutorial;
const ollamaLine = $<HTMLDivElement>("ollama-line");
const ollamaLineText = $<HTMLSpanElement>("ollama-line-text");
const ollamaLineBtn = $<HTMLButtonElement>("ollama-line-btn");

/** null = não consultado, ou o modo grátis não existe na máquina desta janela. */
export let ollamaStatus: OllamaStatus | null = null;
/** A máquina já respondeu (ou falhou) uma vez: com status null, o guia sabe que não há modo grátis aqui. */
let consultado = false;
const st = { preparing: false, removing: false, toggling: false, status: "", log: [] as string[], result: null as "ok" | "fail" | null };

/** O modo grátis é oferecido nesta janela: a máquina aguenta (o status diz) e, por enquanto, só no canal de staging. */
const oferecido = (): boolean => ctx.caps.canal === "staging" && ollamaStatus?.possivel === true;
const remoto = (): boolean => ollamaStatus?.remoto === true;
/** "neste Mac" / "nesta máquina": o Ollama pode ser o deste Mac ou o da máquina por SSH da janela. */
const aqui = (): string => (remoto() ? "nesta máquina" : "neste Mac");
const daqui = (): string => (remoto() ? "desta máquina" : "deste Mac");
/** O que o menu "Modos do agente" mostra para o ollama-local nesta janela. */
export const ollamaNoMenu = (emUso: boolean): ModoOllama => modoOllama({ oferecido: oferecido(), instalado: ollamaStatus?.instalado === true, modelo: ollamaStatus?.modelo ?? null, emUso, remoto: remoto() });
const gb = (mb: number): string => (mb / 1024).toFixed(1).replace(".", ",");

function paintOllamaLine(): void {
  const s = ollamaStatus;
  // Só depois de instalado: antes disso quem leva ao modo grátis é o tutorial (e a primeira abertura).
  if (!oferecido() || s === null || !s.instalado || s.modelo === null) { ollamaLine.hidden = true; return; }
  ollamaLine.hidden = false;
  ollamaLine.className = `wa-line cl-line ${s.pronto ? "on" : "off"}`;
  ollamaLineText.textContent = s.pronto ? `Ollama · ${s.modelo} (${aqui()})` : `Ollama · ${s.modelo} · parado · o ollama-local não responde`;
  ollamaLineBtn.textContent = st.toggling ? "…" : s.rodando ? "parar" : "ligar";
  // Modo grátis para todos: o serviço é da máquina; quem administra é que liga e para.
  ollamaLineBtn.hidden = s.global === true;
  ollamaLineBtn.disabled = st.toggling || st.preparing || st.removing;
}

/** Consulta o Ollama desta máquina; a lateral, o tutorial 16 e a primeira abertura seguem o resultado. */
export async function refreshOllamaLine(): Promise<void> {
  try { ollamaStatus = await window.meuBot.ollamaStatus(); } catch { ollamaStatus = null; }
  consultado = true;
  paintOllamaLine();
  // O menu de modos acompanha: o ollama-local aparece, fica escolhível ou some conforme o estado.
  ctx.syncComposer();
  if (ctx.tutorialsReady) { paintOllamaGuide(); ctx.paintGuide(); }
}

/** Porta única para o modo grátis: abre o tutorial 16 (a primeira abertura e o clique na linha). */
export function enterOllama(): void { ctx.tutNext = false; ctx.openGuide(OLLAMA_TUTORIAL); }

// ---- passos do tutorial 16 ----
const check = (() => {
  const box = el("div", "guide-login");
  const info = el("ul", "hint");
  const aviso = el("p", "hint");
  const remover = el("button", "btn btn-ghost btn-small", "Remover o modo grátis…"); remover.type = "button";
  const actions = el("div", "actions"); actions.append(remover);
  box.append(info, aviso, actions);
  remover.addEventListener("click", () => { void removerOllama(); });
  return { box, info, aviso, remover };
})();
const prep = (() => {
  const box = el("div", "guide-login");
  const status = el("p", "hint");
  const start = el("button", "btn btn-primary btn-small", "Instalar o modo grátis"); start.type = "button";
  const actions = el("div", "actions"); actions.append(start);
  const log = el("pre", "log"); log.hidden = true;
  box.append(status, actions, log);
  start.addEventListener("click", () => { void prepareOllama(); });
  return { box, status, start, log };
})();

function paintOllamaGuide(): void {
  const s = ollamaStatus;
  check.info.replaceChildren();
  if (s === null) { check.aviso.textContent = "Consultando a máquina…"; check.remover.hidden = true; }
  else {
    const li = (t: string): void => { check.info.append(el("li", "", t)); };
    if (s.global === true) li(s.possivel ? "Esta máquina já tem o modo grátis para todos (um Ollama da máquina): esta conta não baixa nada" : "Esta conta ainda não tem o backend do meu-bot: instale pelo seletor antes.");
    else if (s.remoto === true) li(s.possivel ? "Máquina Linux x86_64 com o backend do meu-bot: ok (o modelo roda na CPU, mais devagar que num Mac)" : "Esta máquina não roda o modo grátis: ele precisa de Linux x86_64, do backend do meu-bot instalado e de pelo menos 6 GB de memória.");
    else li(s.possivel ? "Chip Apple: ok" : "Este Mac não tem chip Apple: o modo grátis precisa de um M1 ou mais novo.");
    if (s.global === true) li(`Modelo: ${s.recomendado.rotulo}, compartilhado com as outras contas desta máquina`);
    else if (s.memMb !== null) li(`Memória: ${gb(s.memMb)} GB → modelo ${s.recomendado.rotulo}`);
    if (s.global !== true) li(`Download: ~${gb(s.recomendado.downloadMb)} GB do modelo, mais ~${gb(s.programaMb ?? 200)} GB do programa`);
    if (s.global !== true && s.livreMb !== null) li(`Espaço livre: ${gb(s.livreMb)} GB (precisa de ~${gb(s.necessarioMb)} GB)`);
    const falta = s.livreMb !== null && s.livreMb < s.necessarioMb && !s.pronto;
    check.aviso.textContent = s.pronto ? `Modo grátis instalado: ${s.modelo ?? ""}.` : falta ? "Falta espaço: libere alguns GB e volte aqui (o passo se confere sozinho)." : "Tudo certo para instalar.";
    check.remover.hidden = !s.instalado || st.preparing;
    check.remover.disabled = st.removing;
    check.remover.textContent = st.removing ? "Removendo…" : "Remover o modo grátis…";
  }
  const pronto = s?.pronto === true;
  prep.status.textContent = st.preparing || st.removing ? st.status : pronto ? `Pronto: o ${s?.modelo ?? "modelo"} responde ${aqui()}.` : st.result === "fail" ? st.status
    : s === null ? "" : s.global === true ? "É só ligar nesta conta: leva alguns segundos e não baixa nada. Dá para remover depois."
    : `Vou baixar ~${gb(s.recomendado.downloadMb + (s.programaMb ?? 200))} GB para ~/.local/share/meu-bot/ollama ${s.remoto === true ? "na máquina (só do meu-bot; sem sudo)" : "(só do meu-bot; nada em Aplicativos)"}. Dá para remover depois.`;
  prep.start.hidden = st.preparing || st.removing || pronto || s === null || !s.possivel;
  prep.start.textContent = st.result === "fail" ? "Tentar de novo" : s?.global === true ? "Ligar o modo grátis nesta conta" : "Instalar o modo grátis";
  prep.start.classList.toggle("pulse", !prep.start.hidden);
  prep.log.hidden = !st.preparing && !st.removing && st.log.length === 0;
  prep.log.textContent = st.log.join("\n");
  prep.log.scrollTop = prep.log.scrollHeight; // o progresso mais novo sempre à vista
}

async function prepareOllama(): Promise<void> {
  if (st.preparing || st.removing) return;
  st.preparing = true; st.result = null; st.log = [];
  st.status = `Instalando o modo grátis ${aqui()} (na primeira vez, o download do modelo leva alguns minutos)…`;
  paintOllamaGuide(); paintOllamaLine();
  try {
    const r = await window.meuBot.ollamaPrepare();
    if (!r.ok) { st.status = `✗ ${r.log.at(-1) ?? "não deu para instalar"}`; st.result = "fail"; return; }
    st.preparing = false;
    await refreshOllamaLine();
    if (ollamaStatus?.pronto !== true) { st.status = `✗ a instalação terminou mas o Ollama não respondeu; feche e abra a janela ${daqui()}.`; st.result = "fail"; return; }
    st.result = "ok"; st.status = `✓ Modo grátis pronto: ${ollamaStatus.modelo ?? ""}.`;
    // Sem o Claude, o modelo padrão desta máquina vira o ollama-local (quem responde nas conversas novas).
    if (ctx.clAuth?.loggedIn !== true) { try { ctx.applySettings(await window.meuBot.setSettings({ backendModelForHost: "ollama-local" })); } catch { /* fica o padrão */ } }
  } catch (err) { st.status = `✗ ${ipcErrorText(err)}`; st.result = "fail"; }
  finally { st.preparing = false; paintOllamaGuide(); paintOllamaLine(); ctx.paintGuide(); }
}

/** Remove o programa e os modelos (pede confirmação; o tamanho vem do status). Também o "Refazer do zero" do tutorial 16. */
export async function removerOllama(confirmar = true): Promise<void> {
  if (st.preparing || st.removing) return;
  if (confirmar && !window.confirm(`Remover o modo grátis ${daqui()}? O ollama-local para de responder e o programa e o modelo são apagados da pasta do meu-bot.`)) return;
  st.removing = true; st.result = null; st.log = []; st.status = "Removendo o modo grátis…";
  paintOllamaGuide(); paintOllamaLine();
  try {
    const r = await window.meuBot.ollamaRemover();
    st.status = r.ok ? "✓ Modo grátis removido." : `✗ ${r.log.at(-1) ?? "não deu para remover"}`;
    if (r.ok && ctx.settings?.backendModelForHost === "ollama-local") { try { ctx.applySettings(await window.meuBot.setSettings({ backendModelForHost: "agente" })); } catch { /* segue */ } }
  } catch (err) { st.status = `✗ ${ipcErrorText(err)}`; }
  finally { st.removing = false; await refreshOllamaLine(); }
}

async function toggleOllama(): Promise<void> {
  if (ollamaStatus === null || st.toggling) return;
  st.toggling = true; paintOllamaLine();
  try { ollamaStatus = await window.meuBot.ollamaLigar(!ollamaStatus.rodando); } catch { /* relê abaixo */ }
  finally { st.toggling = false; await refreshOllamaLine(); }
}

export function ligarOllama(): void {
  // "Usar o modo grátis" do seletor: a janela abre já no tutorial 16.
  window.meuBot.on("ui:modo-gratis", () => enterOllama());
  registrarFonte("ollama", () => ({
    known: ctx.caps.canal !== "staging" || consultado,
    dados: { ollama: { possible: ctx.caps.canal !== "staging" ? false : ollamaStatus !== null ? ollamaStatus.possivel : consultado ? false : null, status: ollamaStatus } },
  }));
  registrarPassos({
    "ollama-check": (txt) => { txt.append(check.box); paintOllamaGuide(); },
    "ollama-prepare": (txt) => { txt.append(prep.box); paintOllamaGuide(); },
  });
  window.meuBot.on("ollama:event", (ev: OllamaEvento) => { st.log = [...st.log, ev.text].slice(-10); st.status = ev.text; paintOllamaGuide(); });
  ollamaLine.addEventListener("click", () => enterOllama());
  ollamaLineBtn.addEventListener("click", (e) => { e.stopPropagation(); void toggleOllama(); });
}
