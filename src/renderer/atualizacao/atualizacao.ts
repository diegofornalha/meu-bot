import type { UpdateState } from "../../shared/ipc";
import { byId as $ } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { updateStateText, updateBlockerText, updateNowButton, notasUrl, linhaRelease, releasesVisiveis, dataCurta, APLICAR, ATUALIZAR_AGORA } from "../lib/update-text.js";
import { aoMudarConta, contaAtual } from "../conta/conta.js";
import type { ReleasePublicada } from "../../shared/ipc";
import { ctx } from "../app/ctx.js";

/* ---------- Atualização automática (molde do Grok Bot): faixa com a versão pronta, ponto de progresso na barra,
   "Sobre e atualização" nas Configurações e o bloqueador quando o backend exige uma versão mais nova ---------- */
const updateBar = $<HTMLElement>("update-bar");
const updateText = $<HTMLElement>("update-text");
const updateApply = $<HTMLButtonElement>("update-apply");
const updateCheckDot = $<HTMLElement>("update-check-dot");
const aboutVersion = $<HTMLElement>("about-version");
const aboutSum = $<HTMLElement>("about-sum");
const updateLine = $<HTMLElement>("update-line");
const updateCheckBtn = $<HTMLButtonElement>("update-check-btn");
const updateNowBtn = $<HTMLButtonElement>("update-now-btn");
const updateSoltarBtn = $<HTMLButtonElement>("update-soltar-btn");
const releasesBox = $<HTMLDetailsElement>("releases-box");
const releasesStatus = $<HTMLElement>("releases-status");
const releasesLista = $<HTMLUListElement>("releases-lista");
const updateNotesBtn = $<HTMLButtonElement>("update-notes-btn");
const updateApply2 = $<HTMLButtonElement>("update-apply-2");
const updateMoveBtn = $<HTMLButtonElement>("update-move-btn");
export const atualizarOciosoInput = $<HTMLInputElement>("atualizar-ocioso");
export const corretorInput = $<HTMLInputElement>("corretor-ortografico");
export const aceleracaoInput = $<HTMLInputElement>("aceleracao-hardware");
export const notificacoesInput = $<HTMLInputElement>("notificacoes-ligadas");
export const notificacaoSomInput = $<HTMLInputElement>("notificacao-som");
const notificacaoTestarBtn = $<HTMLButtonElement>("notificacao-testar");
const notificacaoTesteLinha = $<HTMLElement>("notificacao-teste-linha");
const updateBlocker = $<HTMLElement>("update-blocker");
const updateBlockerTitle = $<HTMLElement>("update-blocker-title");
const updateBlockerMsg = $<HTMLElement>("update-blocker-text");
const updateBlockerApply = $<HTMLButtonElement>("update-blocker-apply");
const updateBlockerManual = $<HTMLButtonElement>("update-blocker-manual");
const updateBlockerMove = $<HTMLButtonElement>("update-blocker-move");
const RELEASES_URL = "https://github.com/diegofornalha/meu-bot/releases";
/** Último estado recebido do main; os botões mandam a versão que a tela mostrou (`expectedVersion`). */
export let lastUpdate: UpdateState | null = null;
export function paintUpdateState(u: UpdateState): void {
  lastUpdate = u;
  // Antes de window:info (caps e versão) não há como pintar certo; a IIFE de arranque pede o estado de novo.
  if (ctx.appVersion === "") return;
  const t = updateStateText(u, ctx.caps.nome);
  updateCheckDot.textContent = t.short ?? "";
  updateCheckDot.hidden = t.short === null;
  aboutVersion.textContent = `${ctx.caps.nome} ${u.current}${u.commit === "" ? "" : ` · ${u.commit}`}${u.buildLocal ? " (build local)" : ""} · ${u.arch === "arm64" ? "Apple Silicon" : "Intel"}`;
  aboutSum.textContent = `versão ${u.current}`;
  updateLine.textContent = t.text;
  updateLine.className = `update-line ${t.kind === "muted" ? "" : t.kind}`.trim();
  updateCheckBtn.disabled = u.phase === "checking" || u.phase === "idle" || u.phase === "downloading" || u.phase === "verifying" || u.phase === "applying";
  updateSoltarBtn.hidden = u.fixada === null || u.fixada === undefined;
  updateSoltarBtn.disabled = false;
  const agora = updateNowButton(u);
  updateNowBtn.hidden = agora.hidden; updateNowBtn.disabled = agora.disabled; updateNowBtn.textContent = agora.label; updateNowBtn.title = agora.title;
  updateApply2.hidden = !t.showApply;
  updateApply2.disabled = false;
  updateApply2.textContent = t.applyLabel;
  updateMoveBtn.hidden = !t.showMove;
  updateMoveBtn.disabled = false;
  updateMoveBtn.textContent = "Mover para Aplicativos";
  atualizarOciosoInput.checked = u.atualizarOcioso;
  // Faixa de cima: só com a versão pronta. Staging (como as trilhas de teste do Cursor) não mostra a faixa; a versão
  // nova entra calada ao fechar o app ou com o Mac ocioso (Configurações › Sobre e atualização continua com o botão).
  const faixa = t.showApply && ctx.caps.canal !== "staging" && !u.abaixoDaMinima;
  if (faixa) { updateText.textContent = u.ocupadoAoAplicar ? t.text : `${ctx.caps.nome} ${u.ready ?? ""} pronta para instalar (você está na ${ctx.appVersion}).`; updateApply.disabled = false; updateApply.textContent = t.applyLabel; }
  updateBar.hidden = !faixa;
  // Bloqueador: o backend exige uma versão mais nova; até reiniciar nela, só esta tela.
  const b = updateBlockerText(u, ctx.caps.nome);
  updateBlockerTitle.textContent = b.title; updateBlockerMsg.textContent = b.text;
  updateBlockerApply.hidden = !b.showApply; updateBlockerApply.disabled = false; updateBlockerApply.textContent = b.applyLabel;
  updateBlockerMove.hidden = !b.showMove; updateBlockerMove.disabled = false; updateBlockerMove.textContent = "Mover para Aplicativos";
  updateBlockerManual.hidden = !b.showManual;
  updateBlocker.hidden = !u.abaixoDaMinima;
}
/**
 * "Reiniciar e atualizar": a versão que a tela mostrou vai junto; se uma MAIS NOVA ficou pronta no meio, o main segue
 * nela, e só recusa se andou para trás. O segundo clique, já com a frase da resposta em andamento na tela, é o
 * "Parar e atualizar": é ele que autoriza interromper o trabalho.
 */
function applyFromButton(btn: HTMLButtonElement, onError: (msg: string) => void): void {
  const v = lastUpdate?.ready ?? null;
  if (v === null) return;
  const forcar = lastUpdate?.ocupadoAoAplicar === true;
  const rotulo = btn.textContent ?? APLICAR;
  btn.disabled = true; btn.textContent = forcar ? "Parando…" : "Reiniciando…";
  void window.meuBot.applyUpdate(v, forcar).catch((err: unknown) => { btn.disabled = false; btn.textContent = rotulo; onError(ipcErrorText(err)); });
}
/* ---------- Versões publicadas (só conta super admin; o main confere o papel no servidor a cada chamada) ---------- */
let releases: ReleasePublicada[] = [];
let confirmando: string | null = null;
/** "Mostrar mais" clicado: a lista inteira, até recarregar. */
let todasReleases = false;
const ehSuper = (): boolean => contaAtual()?.conta?.admin === "super";
function pintarReleases(): void {
  releasesLista.replaceChildren();
  const { visiveis, ocultas } = releasesVisiveis(releases, todasReleases);
  for (const r of visiveis) {
    const l = linhaRelease(r, confirmando === r.versao);
    const li = document.createElement("li");
    const v = document.createElement("span"); v.className = "rel-versao"; v.textContent = r.versao;
    const d = document.createElement("span"); d.className = "rel-data"; d.textContent = dataCurta(r.publicadaEm);
    const s = document.createElement("span"); s.className = `rel-selo ${l.kind === "muted" ? "" : l.kind}`.trim(); s.textContent = l.selo;
    li.append(v, d, s);
    if (l.botao !== null) {
      const b = document.createElement("button"); b.type = "button";
      b.className = `btn btn-small ${confirmando === r.versao ? "btn-primary" : "btn-ghost"}`; b.textContent = l.botao;
      b.addEventListener("click", () => { if (confirmando !== r.versao) { confirmando = r.versao; pintarReleases(); return; } instalar(r.versao, b); });
      li.append(b);
    }
    if (l.aviso !== null) { const p = document.createElement("p"); p.className = "rel-aviso"; p.textContent = l.aviso; li.append(p); }
    releasesLista.append(li);
  }
  if (ocultas > 0) {
    const li = document.createElement("li");
    const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-small btn-ghost";
    b.textContent = `Mostrar mais ${ocultas} ${ocultas === 1 ? "versão mais velha" : "versões mais velhas"}`;
    b.addEventListener("click", () => { todasReleases = true; pintarReleases(); });
    li.append(b); releasesLista.append(li);
  }
}
function instalar(versao: string, b: HTMLButtonElement): void {
  b.disabled = true; b.textContent = "Preparando…";
  releasesStatus.textContent = `Baixando e conferindo a ${versao}…`; releasesStatus.className = "update-line warn";
  void window.meuBot.updateInstalarVersao(versao).then(paintUpdateState).catch((err: unknown) => {
    confirmando = null; pintarReleases();
    releasesStatus.textContent = `Não instalei a ${versao}: ${ipcErrorText(err)}`; releasesStatus.className = "update-line bad";
  });
}
function carregarReleases(forcar = false): void {
  releasesStatus.textContent = "Consultando as releases…"; releasesStatus.className = "update-line";
  void window.meuBot.updateReleases(forcar).then((rs) => {
    releases = rs; confirmando = null; todasReleases = false; pintarReleases();
    releasesStatus.textContent = rs.length === 0 ? "Nenhuma release deste canal publicada." : ""; releasesStatus.className = "update-line";
  }).catch((err: unknown) => { releases = []; pintarReleases(); releasesStatus.textContent = ipcErrorText(err); releasesStatus.className = "update-line bad"; });
}
/** A seção só aparece para super admin; quem deixa de ser (saiu, foi rebaixado) a vê sumir na próxima mudança da conta. */
function pintarReleasesBox(): void {
  const mostra = ehSuper() && ctx.caps.canal !== undefined;
  releasesBox.hidden = !mostra;
  if (!mostra) { releasesBox.open = false; releases = []; releasesLista.replaceChildren(); }
}

/** "Mover para Aplicativos": o app está numa pasta sem escrita; o main copia e reabre de lá. */
function moveFromButton(btn: HTMLButtonElement, onError: (msg: string) => void): void {
  btn.disabled = true; btn.textContent = "Movendo…";
  void window.meuBot.moveAppToApplications().catch((err: unknown) => { btn.disabled = false; btn.textContent = "Mover para Aplicativos"; onError(ipcErrorText(err)); });
}

/** Interruptor de configuração simples: salva, repinta e desfaz na tela se o main recusar. */
function ligarInterruptor(input: HTMLInputElement, campo: (v: boolean) => Record<string, boolean>): void {
  input.addEventListener("change", () => {
    void window.meuBot.setSettings(campo(input.checked)).then(ctx.applySettings).catch((err: unknown) => {
      input.checked = !input.checked;
      updateLine.textContent = `Não salvou: ${ipcErrorText(err)}`;
      updateLine.className = "update-line bad";
    });
  });
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarAtualizacao(): void {
  updateCheckBtn.addEventListener("click", () => { updateCheckBtn.disabled = true; void window.meuBot.checkUpdate().then(paintUpdateState).catch(() => { updateCheckBtn.disabled = false; }); });
  updateNowBtn.addEventListener("click", () => {
    updateNowBtn.disabled = true; updateNowBtn.textContent = "Atualizando…";
    void window.meuBot.updateNow().then(paintUpdateState).catch((err: unknown) => {
      updateNowBtn.disabled = false; updateNowBtn.textContent = ATUALIZAR_AGORA;
      updateLine.textContent = `Não consegui atualizar: ${ipcErrorText(err)}`; updateLine.className = "update-line bad";
    });
  });
  updateNotesBtn.addEventListener("click", () => { void window.meuBot.openExternal(lastUpdate === null ? RELEASES_URL : notasUrl(lastUpdate)); });
  updateBlockerManual.addEventListener("click", () => { void window.meuBot.openExternal(RELEASES_URL); });
  updateApply2.addEventListener("click", () => applyFromButton(updateApply2, (msg) => { updateLine.textContent = `Não consegui atualizar: ${msg}`; updateLine.className = "update-line bad"; }));
  updateApply.addEventListener("click", () => applyFromButton(updateApply, (msg) => { updateText.textContent = `Não consegui atualizar: ${msg}`; }));
  updateMoveBtn.addEventListener("click", () => moveFromButton(updateMoveBtn, (msg) => { updateLine.textContent = msg; updateLine.className = "update-line bad"; }));
  updateBlockerMove.addEventListener("click", () => moveFromButton(updateBlockerMove, (msg) => { updateBlockerMsg.textContent = msg; }));
  updateBlockerApply.addEventListener("click", () => applyFromButton(updateBlockerApply, (msg) => { updateBlockerMsg.textContent = `Não consegui atualizar: ${msg}`; }));
  atualizarOciosoInput.addEventListener("change", () => { void window.meuBot.setSettings({ atualizarOcioso: atualizarOciosoInput.checked }).then(ctx.applySettings).catch((err: unknown) => { atualizarOciosoInput.checked = !atualizarOciosoInput.checked; updateLine.textContent = `Não salvou: ${ipcErrorText(err)}`; }); });
  // Corretor e aceleração: o interruptor volta sozinho se o main recusar, para a tela nunca mostrar o que não valeu.
  ligarInterruptor(corretorInput, (v) => ({ corretorOrtografico: v }));
  ligarInterruptor(aceleracaoInput, (v) => ({ aceleracaoHardware: v }));
  ligarInterruptor(notificacoesInput, (v) => ({ notifications: v }));
  ligarInterruptor(notificacaoSomInput, (v) => ({ notificacaoSom: v }));
  // O teste sai mesmo com os avisos desligados (é para ouvir e ver o que o macOS mostra), com o som como estiver marcado.
  notificacaoTestarBtn.addEventListener("click", () => {
    notificacaoTesteLinha.textContent = "";
    void window.meuBot.notifyTest().then(() => { notificacaoTesteLinha.textContent = notificacaoSomInput.checked ? "Aviso enviado, com som." : "Aviso enviado, em silêncio."; })
      .catch((err: unknown) => { notificacaoTesteLinha.textContent = `Não saiu: ${ipcErrorText(err)}`; });
  });
  window.meuBot.on("update:state", paintUpdateState);
  updateSoltarBtn.addEventListener("click", () => {
    updateSoltarBtn.disabled = true;
    void window.meuBot.updateSoltarFixada().then(paintUpdateState).catch((err: unknown) => { updateSoltarBtn.disabled = false; updateLine.textContent = ipcErrorText(err); updateLine.className = "update-line bad"; });
  });
  releasesBox.addEventListener("toggle", () => { if (releasesBox.open) carregarReleases(); });
  aoMudarConta(pintarReleasesBox);
  pintarReleasesBox();
}
