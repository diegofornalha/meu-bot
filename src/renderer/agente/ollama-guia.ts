import { byId as $, el } from "../lib/dom.js";
import { TUTORIAIS, type Tutorial } from "../lib/tutoriais.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import type { OllamaEvento, OllamaStatus } from "../../shared/ipc";
import { ctx } from "../app/ctx.js";
import { modoOllama, type ModoOllama } from "../lib/modo-ollama.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { registrarPassos } from "../tutoriais/passos.js";

// ---- Modo grátis no Mac (tutorial 16): o Ollama do meu-bot (ollamaLocal.ts no main). Linha na lateral abaixo da xAI,
// os passos "Conferir o seu Mac" e "Instalar" e a fonte `ollama` do guia. Só na janela "Este Mac", no staging.

export const OLLAMA_TUTORIAL = TUTORIAIS.find((t) => t.id === "ollama-local") as Tutorial;
const ollamaLine = $<HTMLDivElement>("ollama-line");
const ollamaLineText = $<HTMLSpanElement>("ollama-line-text");
const ollamaLineBtn = $<HTMLButtonElement>("ollama-line-btn");

/** null = não consultado (ou a janela não é este Mac). */
export let ollamaStatus: OllamaStatus | null = null;
const st = { preparing: false, removing: false, toggling: false, status: "", log: [] as string[], result: null as "ok" | "fail" | null };

/** O modo grátis é oferecido nesta janela: este Mac com chip Apple e, por enquanto, só no canal de staging. */
const oferecido = (): boolean => ctx.caps.canal === "staging" && ctx.windowHost === "local" && ollamaStatus?.possivel === true;
/** O que o menu "Modos do agente" mostra para o ollama-local nesta janela. */
export const ollamaNoMenu = (emUso: boolean): ModoOllama => modoOllama({ oferecido: oferecido(), instalado: ollamaStatus?.instalado === true, modelo: ollamaStatus?.modelo ?? null, emUso });
const gb = (mb: number): string => (mb / 1024).toFixed(1).replace(".", ",");

function paintOllamaLine(): void {
  const s = ollamaStatus;
  // Só depois de instalado: antes disso quem leva ao modo grátis é o tutorial (e a primeira abertura).
  if (!oferecido() || s === null || !s.instalado || s.modelo === null) { ollamaLine.hidden = true; return; }
  ollamaLine.hidden = false;
  ollamaLine.className = `wa-line cl-line ${s.pronto ? "on" : "off"}`;
  ollamaLineText.textContent = s.pronto ? `Ollama · ${s.modelo} (neste Mac)` : `Ollama · ${s.modelo} · parado · o ollama-local não responde`;
  ollamaLineBtn.textContent = st.toggling ? "…" : s.rodando ? "parar" : "ligar";
  ollamaLineBtn.disabled = st.toggling || st.preparing || st.removing;
}

/** Consulta o Ollama desta máquina; a lateral, o tutorial 16 e a primeira abertura seguem o resultado. */
export async function refreshOllamaLine(): Promise<void> {
  try { ollamaStatus = await window.meuBot.ollamaStatus(); } catch { ollamaStatus = null; }
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
  if (s === null) { check.aviso.textContent = "Consultando este Mac…"; check.remover.hidden = true; }
  else {
    const li = (t: string): void => { check.info.append(el("li", "", t)); };
    li(s.possivel ? "Chip Apple: ok" : "Este Mac não tem chip Apple: o modo grátis precisa de um M1 ou mais novo.");
    if (s.memMb !== null) li(`Memória: ${gb(s.memMb)} GB → modelo ${s.recomendado.rotulo}`);
    li(`Download: ~${gb(s.recomendado.downloadMb)} GB do modelo, mais ~0,2 GB do programa`);
    if (s.livreMb !== null) li(`Espaço livre: ${gb(s.livreMb)} GB (precisa de ~${gb(s.necessarioMb)} GB)`);
    const falta = s.livreMb !== null && s.livreMb < s.necessarioMb && !s.pronto;
    check.aviso.textContent = s.pronto ? `Modo grátis instalado: ${s.modelo ?? ""}.` : falta ? "Falta espaço: libere alguns GB e volte aqui (o passo se confere sozinho)." : "Tudo certo para instalar.";
    check.remover.hidden = !s.instalado || st.preparing;
    check.remover.disabled = st.removing;
    check.remover.textContent = st.removing ? "Removendo…" : "Remover o modo grátis…";
  }
  const pronto = s?.pronto === true;
  prep.status.textContent = st.preparing || st.removing ? st.status : pronto ? `Pronto: o ${s?.modelo ?? "modelo"} responde neste Mac.` : st.result === "fail" ? st.status
    : s === null ? "" : `Vou baixar ~${gb(s.recomendado.downloadMb + 200)} GB para ~/.local/share/meu-bot/ollama (só do meu-bot; nada em Aplicativos). Dá para remover depois.`;
  prep.start.hidden = st.preparing || st.removing || pronto || s === null || !s.possivel;
  prep.start.textContent = st.result === "fail" ? "Tentar de novo" : "Instalar o modo grátis";
  prep.start.classList.toggle("pulse", !prep.start.hidden);
  prep.log.hidden = !st.preparing && !st.removing && st.log.length === 0;
  prep.log.textContent = st.log.join("\n");
  prep.log.scrollTop = prep.log.scrollHeight; // o progresso mais novo sempre à vista
}

async function prepareOllama(): Promise<void> {
  if (st.preparing || st.removing) return;
  st.preparing = true; st.result = null; st.log = [];
  st.status = "Instalando o modo grátis neste Mac (na primeira vez, o download do modelo leva alguns minutos)…";
  paintOllamaGuide(); paintOllamaLine();
  try {
    const r = await window.meuBot.ollamaPrepare();
    if (!r.ok) { st.status = `✗ ${r.log.at(-1) ?? "não deu para instalar"}`; st.result = "fail"; return; }
    st.preparing = false;
    await refreshOllamaLine();
    if (ollamaStatus?.pronto !== true) { st.status = "✗ a instalação terminou mas o Ollama não respondeu; feche e abra a janela deste Mac."; st.result = "fail"; return; }
    st.result = "ok"; st.status = `✓ Modo grátis pronto: ${ollamaStatus.modelo ?? ""}.`;
    // Sem o Claude, o modelo padrão desta máquina vira o ollama-local (quem responde nas conversas novas).
    if (ctx.clAuth?.loggedIn !== true) { try { ctx.applySettings(await window.meuBot.setSettings({ backendModelForHost: "ollama-local" })); } catch { /* fica o padrão */ } }
  } catch (err) { st.status = `✗ ${ipcErrorText(err)}`; st.result = "fail"; }
  finally { st.preparing = false; paintOllamaGuide(); paintOllamaLine(); ctx.paintGuide(); }
}

/** Remove o programa e os modelos (pede confirmação; o tamanho vem do status). Também o "Refazer do zero" do tutorial 16. */
export async function removerOllama(confirmar = true): Promise<void> {
  if (st.preparing || st.removing) return;
  if (confirmar && !window.confirm(`Remover o modo grátis deste Mac? O ollama-local para de responder e o programa e o modelo (~${gb((ollamaStatus?.recomendado.downloadMb ?? 0) + 200)} GB) são apagados da pasta do meu-bot.`)) return;
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
  // "Usar o modo grátis" do seletor: a janela deste Mac abre já no tutorial 16.
  window.meuBot.on("ui:modo-gratis", () => enterOllama());
  registrarFonte("ollama", () => ({
    known: ctx.windowHost !== "local" || ollamaStatus !== null,
    dados: { ollama: { possible: ctx.windowHost !== "local" || ctx.caps.canal !== "staging" ? false : ollamaStatus === null ? null : ollamaStatus.possivel, status: ollamaStatus } },
  }));
  registrarPassos({
    "ollama-check": (txt) => { txt.append(check.box); paintOllamaGuide(); },
    "ollama-prepare": (txt) => { txt.append(prep.box); paintOllamaGuide(); },
  });
  window.meuBot.on("ollama:event", (ev: OllamaEvento) => { st.log = [...st.log, ev.text].slice(-10); st.status = ev.text; paintOllamaGuide(); });
  ollamaLine.addEventListener("click", () => enterOllama());
  ollamaLineBtn.addEventListener("click", (e) => { e.stopPropagation(); void toggleOllama(); });
}
