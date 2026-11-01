import type { WhatsappAgente, WhatsappStatus, WhatsappReplyChoice, VoiceReplyMode, VozId, AudioSetup, WhatsappEvent } from "../../shared/ipc";
import { byId as $, el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { TUTORIAIS } from "../lib/tutoriais.js";
import { REPLY_NOTE, replyChoiceOf, REPLY_OPTIONS, listedNumbers, parseWaNumbers, replySelfTextoDono, REPLY_AVISO_SELF_CHAT, donoLinhaTexto, DONO_HINT } from "../lib/whatsapp-resposta.js";
import { ctx } from "../app/ctx.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { registrarPassos } from "../tutoriais/passos.js";

const waLine = $<HTMLButtonElement>("wa-line");
export const waDialog = $<HTMLDialogElement>("wa-dialog");
const waStatusEl = $<HTMLParagraphElement>("wa-status");
export const waQr = $<HTMLImageElement>("wa-qr");
const waHow = $<HTMLParagraphElement>("wa-how");
export const waSuccess = $<HTMLElement>("wa-success");
const waSuccessText = $<HTMLElement>("wa-success-text");
export const waProgress = $<HTMLElement>("wa-progress");
export const waProgressText = $<HTMLElement>("wa-progress-text");
const waProgressMeta = $<HTMLElement>("wa-progress-meta");
/**
 * QR da vez: quantos já vieram, quando chegou o último e quanto os próximos duram. O WhatsApp Web dá ~60 s ao
 * primeiro QR e ~20 s aos seguintes; o ciclo é medido só entre QRs seguintes (medir o 1º→2º, de 60 s, fazia
 * a contagem do 2º trocar de imagem no meio). A previsão nunca é exata: passou do tempo, mostra "renovando…".
 */
const WA_QR_FIRST = 60_000;
let waQrCount = 0; let waQrAt = 0; let waQrEvery = 20_000;
let waTick: ReturnType<typeof setInterval> | null = null;
function setWaProgress(text: string, tone: "run" | "ok" | "bad" = "run"): void {
  waProgress.hidden = false;
  waProgress.className = `wa-progress${tone === "run" ? "" : ` ${tone}`}`;
  waProgressText.textContent = text;
}
function paintWaMeta(): void {
  if (waQrCount === 0 || !waPairing || waConnected) { waProgressMeta.textContent = ""; return; }
  const left = Math.ceil((waQrAt + (waQrCount === 1 ? WA_QR_FIRST : waQrEvery) - Date.now()) / 1000);
  waProgressMeta.textContent = left > 0 ? `QR ${waQrCount} · renova em ${left} s` : `QR ${waQrCount} · renovando…`;
}
function resetWaProgress(): void {
  waQrCount = 0; waQrAt = 0; waQrEvery = 20_000;
  if (waTick !== null) { clearInterval(waTick); waTick = null; }
  waProgressMeta.textContent = "";
}
export const waPairBtn = $<HTMLButtonElement>("wa-pair");
const waResetBtn = $<HTMLButtonElement>("wa-reset");
const waCloseBtn = $<HTMLButtonElement>("wa-close");
export const waAgentBtn = $<HTMLButtonElement>("wa-agent");
const waRefreshBtn = $<HTMLButtonElement>("wa-refresh");
export const waPolicyBox = $<HTMLElement>("wa-policy");
const waPolicyHint = $<HTMLElement>("wa-policy-hint");
export const waPolicyCards = $<HTMLElement>("wa-policy-cards");
const waAgenteBox = $<HTMLElement>("wa-agente");
const waAgenteCards = $<HTMLElement>("wa-agente-cards");
/** Seletor de agente no modal: some durante o pareamento (trocar no meio do QR desfaria o que está sendo lido). */
function paintWaAgente(): void {
  waAgenteBox.hidden = waPairing;
  if (waAgenteBox.hidden) return;
  waAgenteCards.replaceChildren();
  renderAgentChoice(waAgenteCards);
}
const waPolicyEditor = $<HTMLElement>("wa-policy-editor");
export let waPolicySaving = false;
/** Pedido ao agente da máquina para ajustar o canal do WhatsApp por conversa, em vez do editor técnico de JSON. */
function waChannelPrompt(st: WhatsappStatus): string {
  if (st.gateway === "hermes") {
    return [
      "Quero ajustar o WhatsApp (Hermes) desta máquina conversando, sem eu editar arquivo.",
      st.number !== null ? `Número conectado: ${fmtPhone(st.number)}.` : "",
      "Config atual (~/.hermes/.env):",
      "```json\n" + (st.channelConfig ?? "{}") + "\n```",
      "O WhatsApp do Hermes fica em ~/.hermes/.env (WHATSAPP_MODE, WHATSAPP_DM_POLICY, WHATSAPP_ALLOWED_USERS) e em ~/.hermes/config.yaml (platforms.whatsapp, para grupos). Faça backup antes de mudar; modo e política só valem depois de `hermes gateway restart`.",
      "Me diga em uma frase o que dá para mudar (quem o agente responde, lista de números permitidos, grupos) e espere eu pedir. Não mude nada antes de eu confirmar.",
    ].filter((l) => l !== "").join("\n");
  }
  return [
    "Quero ajustar o WhatsApp (OpenClaw) desta máquina conversando, sem eu editar JSON.",
    st.number !== null ? `Número conectado: ${fmtPhone(st.number)}.` : "",
    "Config atual do canal:",
    "```json\n" + (st.channelConfig ?? "{}") + "\n```",
    "Você pode alterar `channels.whatsapp` com `openclaw config set <caminho> <valor> --strict-json` (valide antes com `--dry-run`; nunca reinicie o gateway na mão, as mudanças valem sozinhas).",
    "Me diga em uma frase o que dá para mudar (quem o agente responde, lista de números permitidos, grupos, limite de mídia) e espere eu pedir. Não mude nada antes de eu confirmar.",
  ].filter((l) => l !== "").join("\n");
}
/** Botão que leva ao chat para ajustar o canal em linguagem natural (reaproveitado no guia e no modal). */
export function renderChannelEditor(host: HTMLElement): void {
  const st = ctx.waStatus;
  if (st === null || !st.connected) return;
  const row = el("div", "channel-chat");
  const btn = el("button", "btn btn-ghost btn-small", "Ajustar pelo chat"); btn.type = "button";
  btn.title = "Abre uma conversa com o agente desta máquina para mudar a configuração do WhatsApp pedindo em português";
  btn.addEventListener("click", () => {
    void (async () => { const tab = await ctx.newTab(); await ctx.sendText(tab, waChannelPrompt(st)); })();
  });
  row.append(btn, el("span", "hint", "Peça em português: quem responde, números permitidos, grupos…"));
  host.append(row);
}
/** Os dois cartões de rádio (só você / todo mundo), iguais no modal e no guia; o escolhido fica verde. */
/** Cartão sendo gravado nesta hora (mostra o spinner e a seleção otimista); null = nenhum. */
let waPolicyTarget: WhatsappReplyChoice | null = null;
/** Último erro ao aplicar um cartão: aparece embaixo dos cartões (guia e modal), não só no texto do modal. */
let waPolicyError: string | null = null;
/** "Só alguns contatos": a lista está aberta para edição (o cartão foi clicado, ainda sem salvar), o rascunho e o último erro. */
let waListEditing = false;
let waListDraft: string | null = null;
let waListError: string | null = null;
/** O cartão marcado hoje, pelo que está gravado na máquina. */
export const replyChoiceNow = (st: WhatsappStatus): WhatsappReplyChoice | null => replyChoiceOf(st.dmPolicy, st.allowFrom, st.number, st.dono?.numero ?? st.number);
/** O que a pessoa listou além do aparelho e do dono. */
const listados = (st: WhatsappStatus): string[] => listedNumbers(st.allowFrom, st.number, st.dono?.numero ?? st.number);
export function renderReplyCards(container: HTMLElement, current: WhatsappReplyChoice | null, disabled: boolean, onChoose: (c: WhatsappReplyChoice) => void): void {
  container.replaceChildren();
  // Máquina cujo agente não deixa escolher pelo app (capacidade, não produto): diz isso em vez de cartões que falhariam.
  if (ctx.waStatus !== null && !ctx.waStatus.capacidades.politicaDm) { container.append(el("p", "hint", `O agente desta máquina (${ctx.waStatus.gateway ?? "desconhecido"}) não permite escolher quem responde pelo app.`)); return; }
  // Quem manda no agente, antes dos cartões: pré-preenchido com o número pareado; troca só para quem usa um chip dedicado.
  if (ctx.waStatus?.dono !== undefined) renderDonoLinha(container, ctx.waStatus, disabled);
  const marked = waPolicyTarget ?? (waListEditing ? "list" : current); // otimista: enquanto grava, o cartão clicado já aparece marcado
  const dono = ctx.waStatus?.dono;
  const avisoSelfChat = ctx.waStatus?.gateway === "hermes" && (dono === undefined || dono.souEu);
  for (const o of REPLY_OPTIONS) {
    const saving = waPolicyTarget === o.id;
    const card = el("button", `reply-card${marked === o.id ? " on" : ""}${saving ? " saving" : ""}`);
    card.type = "button"; card.disabled = disabled; card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(marked === o.id));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.title));
    if (o.isDefault) title.append(el("span", "reply-default", "Padrão"));
    if (saving) title.append(el("span", "reply-saving", "aplicando…"));
    const texto = o.id === "self" && dono !== undefined && !dono.souEu ? replySelfTextoDono(fmtPhone(dono.numero)) : o.text;
    const body = el("div", "reply-body"); body.append(title, el("p", "", texto));
    if (o.id !== "self" && avisoSelfChat) body.append(el("p", "hint", REPLY_AVISO_SELF_CHAT));
    if (o.id === "list" && current === "list" && ctx.waStatus !== null && !waListEditing) {
      const nums = listados(ctx.waStatus);
      body.append(el("p", "reply-list-now", `Na lista: ${nums.map((n) => fmtPhone(n)).join(", ")}. Clique para mudar.`));
    }
    card.append(saving ? el("span", "reply-spin") : el("span", "reply-radio"), body);
    card.addEventListener("click", () => onChoose(o.id));
    container.append(card);
    // A lista editável fica fora do cartão (botão não pode conter campo de texto).
    if (o.id === "list" && waListEditing) container.append(renderListEditor(disabled));
  }
  if (waPolicyError !== null) container.append(el("p", "hint bad-hint", waPolicyError));
  else if (ctx.waStatus?.capacidades.politicaReinicia === true && waPolicySaving) container.append(el("p", "hint", "Trocar o modo reinicia o gateway do WhatsApp desta máquina: leva alguns segundos."));
}
let waDonoEditing = false;
let waDonoDraft: string | null = null;
let waDonoError: string | null = null;
let waDonoSaving = false;
/**
 * Linha "Dono" (padrão da linha de áudio): quem manda no agente e de onde fala; "Trocar" abre o editor inline.
 * Padrão = o número pareado, sem nada a decidir; a troca é para quem tem um chip dedicado para o agente.
 */
function renderDonoLinha(container: HTMLElement, st: WhatsappStatus, disabled: boolean): void {
  const dono = st.dono; if (dono === undefined) return;
  const row = el("div", "audio-row wa-dono-row");
  row.append(el("strong", "", "Dono"), el("span", "audio-ok", donoLinhaTexto(dono, dono.souEu ? null : st.number, fmtPhone)));
  if (ctx.caps.manageWa && !waDonoEditing) {
    const b = el("button", "btn btn-ghost btn-small", "Trocar"); b.type = "button"; b.title = DONO_HINT;
    b.disabled = disabled || waDonoSaving || waPolicySaving || !st.connected;
    b.addEventListener("click", () => { waDonoEditing = true; waDonoDraft = null; waDonoError = null; paintWhatsapp(); ctx.paintGuide(); });
    row.append(b);
  }
  container.append(row);
  if (waDonoEditing) container.append(renderDonoEditor(st, disabled));
}
function renderDonoEditor(st: WhatsappStatus, disabled: boolean): HTMLElement {
  const dono = st.dono;
  const box = el("div", "wa-list-editor");
  const input = document.createElement("input"); input.type = "text"; input.className = "wa-list-input";
  input.placeholder = "Com DDD: 11 99999-9999 (o +55 entra sozinho) ou +1 212 555 0100";
  input.value = waDonoDraft ?? (dono === undefined || dono.souEu ? "" : `+${dono.numero}`);
  input.disabled = disabled || waDonoSaving;
  input.addEventListener("input", () => { waDonoDraft = input.value; waDonoError = null; });
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); void saveDono(input.value); } });
  const row = el("div", "wa-list-row");
  const save = el("button", "btn btn-primary btn-small", waDonoSaving ? "Salvando…" : "Salvar"); save.type = "button"; save.disabled = disabled || waDonoSaving;
  save.addEventListener("click", () => { void saveDono(input.value); });
  const cancel = el("button", "btn btn-ghost btn-small", "Cancelar"); cancel.type = "button"; cancel.disabled = waDonoSaving;
  cancel.addEventListener("click", () => { waDonoEditing = false; waDonoDraft = null; waDonoError = null; paintWhatsapp(); ctx.paintGuide(); });
  row.append(save, cancel);
  if (dono !== undefined && !dono.souEu) {
    const volta = el("button", "btn btn-ghost btn-small", "Voltar para este número"); volta.type = "button"; volta.disabled = disabled || waDonoSaving;
    volta.addEventListener("click", () => { void saveDono(null); });
    row.append(volta);
  }
  box.append(input, row, el("p", waDonoError === null ? "hint" : "hint bad-hint", waDonoError ?? DONO_HINT));
  return box;
}
/** Grava o dono (null = volta ao pareado): a máquina reaplica "quem responde" e, no Hermes, o home channel (reinicia o gateway). */
async function saveDono(texto: string | null): Promise<void> {
  if (waDonoSaving) return;
  let numero: string | null = null;
  if (texto !== null) {
    const { ok, bad } = parseWaNumbers(texto);
    if (bad.length > 0) { waDonoError = `não entendi: ${bad.join(", ")} (use só dígitos, com DDD; de fora do Brasil, comece com +)`; paintWhatsapp(); ctx.paintGuide(); return; }
    if (ok.length === 0) { waDonoError = "digite o seu número ou use \"Voltar para este número\""; paintWhatsapp(); ctx.paintGuide(); return; }
    if (ok.length > 1) { waDonoError = "um número só: o dono é uma pessoa"; paintWhatsapp(); ctx.paintGuide(); return; }
    numero = ok[0]!;
    const atual = ctx.waStatus?.dono;
    if (atual !== undefined && numero === atual.numero) { waDonoEditing = false; waDonoDraft = null; paintWhatsapp(); ctx.paintGuide(); return; }
  }
  waDonoSaving = true; waDonoError = null; waPolicySaving = true;
  paintWhatsapp(); ctx.paintGuide();
  segurarConexao();
  try {
    ctx.waStatus = comPareamento(await window.meuBot.whatsappSetDono(numero));
    waDonoEditing = false; waDonoDraft = null;
  } catch (err) {
    waDonoError = ipcErrorText(err);
  } finally { acaoTerminou(); waDonoSaving = false; waPolicySaving = false; paintWhatsapp(); ctx.paintGuide(); }
}
/** Campo da lista: um número por linha; "Salvar lista" grava a allowlist (o dono entra sempre). */
function renderListEditor(disabled: boolean): HTMLElement {
  const box = el("div", "wa-list-editor");
  const ta = document.createElement("textarea"); ta.className = "wa-list-input"; ta.rows = 3;
  ta.placeholder = "Um número por linha, com DDD: 11 99999-9999 (o +55 entra sozinho) ou +1 212 555 0100";
  ta.value = waListDraft ?? (ctx.waStatus === null ? "" : listados(ctx.waStatus).map((n) => `+${n}`).join("\n"));
  ta.disabled = disabled;
  ta.addEventListener("input", () => { waListDraft = ta.value; waListError = null; });
  const row = el("div", "wa-list-row");
  const save = el("button", "btn btn-primary btn-small", waPolicySaving ? "Aplicando…" : "Salvar lista"); save.type = "button"; save.disabled = disabled;
  save.addEventListener("click", () => { void saveReplyList(ta.value); });
  const cancel = el("button", "btn btn-ghost btn-small", "Cancelar"); cancel.type = "button"; cancel.disabled = disabled;
  cancel.addEventListener("click", () => { waListEditing = false; waListDraft = null; waListError = null; paintWhatsapp(); });
  row.append(save, cancel);
  box.append(ta, row, el("p", waListError === null ? "hint" : "hint bad-hint", waListError ?? "O dono fica na lista sempre. Vale na hora, sem reiniciar nada."));
  return box;
}
async function saveReplyList(text: string): Promise<void> {
  if (waPolicySaving) return;
  const { ok, bad } = parseWaNumbers(text);
  if (bad.length > 0) { waListError = `não entendi: ${bad.join(", ")} (use só dígitos, com DDD; de fora do Brasil, comece com +)`; paintWhatsapp(); return; }
  if (ok.length === 0) { waListError = "a lista está vazia; para só você falar com o agente, use o primeiro cartão"; paintWhatsapp(); return; }
  for (const t of TUTORIAIS) if (t.steps.some((st) => st.target === "wa-policy")) ctx.saveGuideFlag(t, "policyChosen");
  waPolicySaving = true; waPolicyTarget = "list"; waListError = null; paintWhatsapp();
  segurarConexao();
  try { ctx.waStatus = comPareamento(await window.meuBot.whatsappSetDmPolicy("list", ok)); waListEditing = false; waListDraft = null; }
  catch (err) { waListError = `✗ ${err instanceof Error ? err.message : String(err)}`; }
  finally { acaoTerminou(); waPolicySaving = false; waPolicyTarget = null; paintWhatsapp(); }
}
/** Quando o agente responde em áudio (os três cartões). */
const VOICE_OPTIONS: readonly { id: VoiceReplyMode; title: string; text: string; isDefault: boolean }[] = [
  { id: "off", title: "Nunca", text: "Responde sempre em texto.", isDefault: true },
  { id: "inbound", title: "Quando receber áudio", text: "Áudio vira áudio; texto continua texto.", isDefault: false },
  { id: "always", title: "Sempre", text: "Toda resposta vira nota de voz.", isDefault: false },
];
/** Vozes (cópia mínima de src/main/vozes-core.ts; o teste confere que batem). */
const VOZES_UI: readonly { id: VozId; rotulo: string; texto: string; padrao: boolean }[] = [
  { id: "faber", rotulo: "Masculina", texto: "Voz local (Piper). Na primeira vez baixa ~70 MB.", padrao: true },
  { id: "dora", rotulo: "Feminina", texto: "Voz local natural (Kokoro). Na primeira vez baixa ~350 MB.", padrao: false },
  { id: "alex", rotulo: "Masculina natural", texto: "Voz local natural (Kokoro). Na primeira vez baixa ~350 MB.", padrao: false },
];
/** Voz escolhida com o áudio desligado: guardada aqui e aplicada ao ligar. */
let waVozEscolhida: VozId | null = null;
let waVozBusy: VozId | null = null;
/** O que está sendo aplicado agora ("in" = transcrição; um modo = voz) e o último recado (erro ou aviso). */
let waAudioBusy: "in" | VoiceReplyMode | null = null;
let waAudioMsg: { text: string; bad: boolean; kind: "in" | "out" } | null = null;
/** O recado do áudio fica onde a ação foi feita: embaixo de "Ativar transcrição" ou dos cartões de voz. */
const audioMsgEl = (kind: "in" | "out"): HTMLElement | null => waAudioMsg !== null && waAudioMsg.kind === kind ? el("p", `hint ${waAudioMsg.bad ? "guide-pair-note" : "audio-ok"}`, waAudioMsg.text) : null;
/** Linha "Ouvir áudios": ativar a transcrição (ou o ✓) e o recado da última tentativa, embaixo. */
function renderOuvir(box: HTMLElement, st: typeof ctx.waStatus): void {
  const hear = el("div", "audio-row");
  hear.append(el("strong", "", "Ouvir áudios"));
  if (st?.audioIn === true) hear.append(el("span", "audio-ok", "✓ ativo: a transcrição roda na própria máquina"));
  else {
    const b = el("button", "btn btn-primary btn-small", waAudioBusy === "in" ? "Ativando… (na primeira vez baixa ~500 MB)" : "Ativar transcrição");
    b.type = "button"; b.disabled = waAudioBusy !== null || st === null || !st.connected;
    b.addEventListener("click", () => { void runAudioSetup({ kind: "in" }); });
    hear.append(b);
  }
  box.append(hear);
  { const m = audioMsgEl("in"); if (m !== null) box.append(m); }
}
/**
 * Áudio do agente do WhatsApp: ouvir (transcrição local, faster-whisper) e falar (voz local, Piper), com quando
 * responder em áudio. `parte`: "ouvir" no tutorial 4 (só a transcrição), "responder" no painel de gerência do
 * tutorial 3 (só a resposta em áudio e a voz); os instaladores rodam na máquina.
 */
export function renderAudioControls(container: HTMLElement, parte: "ouvir" | "responder"): void {
  const st = ctx.waStatus;
  const box = el("div", "audio-controls");
  const hermes = st?.gateway === "hermes";
  if (parte === "ouvir") { renderOuvir(box, st); container.append(box); return; }
  // Hermes: a pausa por contato com prazo vem do plugin meu-bot-pausa; o app instala sozinho, mas o botão fica aqui para quem ficou sem.
  if (hermes) renderPausaContato(box, st);
  // Responder em áudio só acontece quando o agente entende o áudio que recebeu.
  if (st?.audioIn !== true) box.append(el("p", "hint", "Responder em áudio depende da transcrição ligada: tutorial 4, Ouvir áudios do WhatsApp."));
  // Mesma forma da linha "Ouvir áudios": rótulo e estado atual; os cartões abaixo, lado a lado.
  const current = st?.audioOut ?? "off";
  const speak = el("div", "audio-row");
  speak.append(el("strong", "", "Responder em áudio"), el("span", current === "off" ? "hint" : "audio-ok", current === "off" ? "só texto (padrão)" : current === "inbound" ? "✓ quando receber áudio" : "✓ sempre"));
  box.append(speak);
  const cards = el("div", "reply-cards voice-cards");
  const marked = waAudioBusy !== null && waAudioBusy !== "in" ? waAudioBusy : current;
  // O Hermes responde em áudio quando recebe áudio (voice.auto_tts), com a voz dele: sem "sempre" e sem escolher voz.
  for (const o of hermes ? VOICE_OPTIONS.filter((v) => v.id !== "always") : VOICE_OPTIONS) {
    const saving = waAudioBusy === o.id;
    const card = el("button", `reply-card${marked === o.id ? " on" : ""}${saving ? " saving" : ""}`);
    card.type = "button"; card.disabled = waAudioBusy !== null || st === null || !st.connected;
    card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(marked === o.id));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.title));
    if (o.isDefault) title.append(el("span", "reply-default", "Padrão"));
    // O spinner no lugar do rádio já diz "aplicando"; texto só quando há download (voz do OpenClaw).
    if (saving && o.id !== "off" && !hermes) title.append(el("span", "reply-saving", "instalando a voz…"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
    card.append(saving ? el("span", "reply-spin") : el("span", "reply-radio"), body);
    card.addEventListener("click", () => { if (o.id !== current) void runAudioSetup({ kind: "out", mode: o.id, ...(o.id !== "off" && !hermes ? { voz: waVozEscolhida ?? st?.audioVoice ?? "faber" } : {}) }); });
    cards.append(card);
  }
  box.append(cards);
  if (hermes) {
    box.append(el("p", "hint", "Usa a voz do próprio agente. Mudar reinicia o WhatsApp da máquina por alguns segundos."));
    { const m = audioMsgEl("out"); if (m !== null) box.append(m); }
    container.append(box);
    return;
  }
  // Voz: com o áudio ligado, troca na hora; desligado, fica guardada para quando ligar. Todas rodam na máquina.
  box.append(el("p", "hint strong-hint", "Voz"));
  const vozes = el("div", "reply-cards voice-cards");
  const vozAtual: VozId = waVozBusy ?? waVozEscolhida ?? st?.audioVoice ?? "faber";
  for (const v of VOZES_UI) {
    const saving = waVozBusy === v.id;
    const card = el("button", `reply-card${vozAtual === v.id ? " on" : ""}${saving ? " saving" : ""}`);
    card.type = "button"; card.disabled = waAudioBusy !== null || waVozBusy !== null || st === null || !st.connected;
    card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(vozAtual === v.id));
    const title = el("div", "reply-title"); title.append(el("strong", "", v.rotulo));
    if (v.padrao) title.append(el("span", "reply-default", "Padrão"));
    if (saving) title.append(el("span", "reply-saving", "instalando a voz…"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", v.texto));
    card.append(saving ? el("span", "reply-spin") : el("span", "reply-radio"), body);
    card.addEventListener("click", () => {
      if (v.id === vozAtual) return;
      waVozEscolhida = v.id;
      if (current === "off") { waAudioMsg = { text: `Voz ${v.rotulo.toLowerCase()} escolhida: vale quando ligar a resposta em áudio.`, bad: false, kind: "out" }; ctx.paintGuide(); return; }
      waVozBusy = v.id; ctx.paintGuide();
      void runAudioSetup({ kind: "out", mode: current, voz: v.id }).finally(() => { waVozBusy = null; ctx.paintGuide(); });
    });
    vozes.append(card);
  }
  box.append(vozes, el("div", "guide-note", "Todas as vozes rodam na própria máquina, sem custo; o texto das respostas não sai dela."));
  { const m = audioMsgEl("out"); if (m !== null) box.append(m); }
  container.append(box);
}
let waPausaBusy = false;
let waPausaMsg: { text: string; bad: boolean } | null = null;
/** Linha "Pausar por contato" (Hermes): ✓ com prazo quando o plugin está carregado; senão o botão que o instala, e o recado embaixo. */
function renderPausaContato(box: HTMLElement, st: typeof ctx.waStatus): void {
  const row = el("div", "audio-row");
  row.append(el("strong", "", "Pausar por contato"));
  if (st?.capacidades.pausaPrazo === true) row.append(el("span", "audio-ok", "✓ com prazo: no menu da conversa (2 h / 24 h / até retomar) ou /pausar 2h pelo WhatsApp"));
  else {
    const b = el("button", "btn btn-primary btn-small", waPausaBusy ? "Ativando…" : "Ativar pausa com prazo");
    b.type = "button"; b.disabled = waPausaBusy || st === null || !st.connected;
    b.addEventListener("click", () => { void runPausaPlugin(); });
    row.append(b, el("span", "hint", "sem o plugin, pausar tira da lista de quem o agente responde e reinicia o gateway"));
  }
  box.append(row);
  if (waPausaMsg !== null) box.append(el("p", `hint ${waPausaMsg.bad ? "guide-pair-note" : "audio-ok"}`, waPausaMsg.text));
}
async function runPausaPlugin(): Promise<void> {
  if (waPausaBusy) return;
  waPausaBusy = true; waPausaMsg = null;
  ctx.paintGuide();
  segurarConexao();
  try {
    const r = await window.meuBot.installPausaPlugin();
    waPausaMsg = { text: r.log.at(-1) ?? (r.ok ? "pronto" : "não deu certo"), bad: !r.ok };
    await refreshWhatsapp();
  } catch (err) {
    waPausaMsg = { text: ipcErrorText(err), bad: true };
  } finally { acaoTerminou(); waPausaBusy = false; ctx.paintGuide(); }
}
async function runAudioSetup(setup: AudioSetup): Promise<void> {
  if (waAudioBusy !== null) return;
  waAudioBusy = setup.kind === "in" ? "in" : waVozBusy !== null ? null : setup.mode; waAudioMsg = null;
  ctx.paintGuide();
  segurarConexao();
  try {
    const r = await window.meuBot.whatsappAudio(setup);
    waAudioMsg = { text: r.log.at(-1) ?? (r.ok ? "pronto" : "não deu certo"), bad: !r.ok, kind: setup.kind };
    await refreshWhatsapp();
  } catch (err) {
    waAudioMsg = { text: ipcErrorText(err), bad: true, kind: setup.kind };
  } finally { acaoTerminou(); waAudioBusy = null; ctx.paintGuide(); }
}
export function chooseReply(choice: WhatsappReplyChoice): void {
  if (waPolicySaving) return;
  // "Só alguns contatos" abre a lista para a pessoa preencher; grava só no "Salvar lista".
  if (choice === "list") { waListEditing = true; waListError = null; paintWhatsapp(); return; }
  waListEditing = false; waListDraft = null; waListError = null;
  for (const t of TUTORIAIS) if (t.steps.some((st) => st.target === "wa-policy")) ctx.saveGuideFlag(t, "policyChosen");
  if (ctx.waStatus !== null && replyChoiceNow(ctx.waStatus) === choice) { waPolicyError = null; paintWhatsapp(); return; }
  waPolicySaving = true; waPolicyTarget = choice; waPolicyError = null; paintWhatsapp(); // seleção na hora + spinner no cartão
  segurarConexao();
  void window.meuBot.whatsappSetDmPolicy(choice)
    .then((st) => { ctx.waStatus = comPareamento(st); if (replyChoiceNow(st) !== choice) waPolicyError = `✗ a máquina ficou em "${st.dmPolicy ?? "?"}", não no que você escolheu. Tente de novo.`; })
    .catch((err: unknown) => { waPolicyError = `✗ ${err instanceof Error ? err.message : String(err)}`; waStatusEl.textContent = waPolicyError; })
    .finally(() => { acaoTerminou(); waPolicySaving = false; waPolicyTarget = null; paintWhatsapp(); });
}
function paintWaPolicy(): void {
  const st = ctx.waStatus;
  const show = st !== null && st.capacidades.politicaDm && st.connected && st.dmPolicy !== null && !waPairing;
  waPolicyBox.hidden = !show;
  if (!show || st === null) return;
  renderReplyCards(waPolicyCards, replyChoiceNow(st), waPolicySaving, chooseReply);
  waPolicyEditor.replaceChildren(); renderChannelEditor(waPolicyEditor);
  waPolicyHint.textContent = waPolicySaving ? "Aplicando na máquina…"
    : st.dmPolicy === "pairing" ? "Hoje está no padrão do agente: quem manda mensagem recebe um código de pareamento e espera aprovação. Escolha uma das opções para mudar."
    : st.dmPolicy === "disabled" ? "Hoje está tudo desligado, inclusive suas próprias mensagens. Escolha uma das opções."
    : "Vale na hora, sem reiniciar nada. Grupos continuam desativados.";
}

/**
 * Pedido pronto ao agente da máquina (Claude Code em bypass): instala (se faltar) e configura o agente escolhido
 * para o WhatsApp; o pareamento (QR) fica com o app. Idempotente por instrução: pular o que já está feito.
 */
function waAgentPrompt(st: WhatsappStatus): string {
  if (st.gateway === "hermes") {
    return [
      "Prepare o Hermes desta máquina para o WhatsApp, sem interação e sem parear (o QR eu faço pelo meu-bot).",
      "Falta: " + (st.missing ?? "o bridge do WhatsApp") + ".",
      "",
      "Passos (pule o que já estiver feito):",
      "1. Se o comando `hermes` não existir (confira com `command -v hermes`; o da máquina toda fica em /usr/local/bin/hermes): `npm install -g --prefix ~/.local hermes-agent@0.22.2` (a mesma versão do Grok do meu-bot). Se já existir, não instale outro.",
      "2. A pasta do Hermes é a linha `Install directory:` de `hermes --version`. Confira o bridge em `<pasta>/scripts/whatsapp-bridge/bridge.js`. Se a pasta for /opt/hermes (o Hermes de todos os usuários, do root), não mexa nela: se faltar algo lá, me diga para usar \"Instalar Hermes para todos\" no meu-bot-admin. As dependências do bridge e o `.env` do WhatsApp o meu-bot ajusta sozinho ao gerar o QR.",
      "3. Não mexa no backend do meu-bot, no `model:` do ~/.hermes/config.yaml (o meu-bot liga o Hermes ao Claude desta máquina) nem rode `hermes whatsapp` ou `hermes setup` (são interativos).",
      "",
      "No fim, resuma o que fez e o que ainda falta. Não pareie o WhatsApp.",
    ].join("\n");
  }
  return [
    "Prepare o OpenClaw desta máquina para o WhatsApp, sem interação e sem parear (o QR eu faço pelo meu-bot).",
    "Encontrado: " + st.agent + ".",
    "Falta:\n" + (st.missing ?? "?").split("\n").map((l) => "- " + l).join("\n"),
    "",
    "Passos (pule o que já estiver feito):",
    "0. Se `openclaw` não existir: instale com `npm install -g openclaw@latest` (sem root, use `--prefix ~/.local`) e confira `openclaw --version`.",
    "1. Se não houver ~/.openclaw/openclaw.json: `openclaw onboard --non-interactive --accept-risk --auth-choice anthropic-cli --skip-channels --skip-skills --skip-hooks --skip-search --skip-ui --install-daemon --gateway-bind loopback --gateway-auth token --gateway-token \"$(openssl rand -hex 24)\" --json`. Se o anthropic-cli não servir, me diga o que falta em vez de inventar chave.",
    "2. Plugin: `openclaw plugins install clawhub:@openclaw/whatsapp --accept-capabilities`.",
    "3. Confira com `openclaw gateway status` e `openclaw plugins list | grep -i whatsapp`. Se o serviço for systemd de usuário, veja `loginctl show-user $USER -p Linger`; se for `no`, avise (precisa de root para o gateway sobreviver ao logout).",
    "",
    "No fim, resuma o que fez e o que ainda falta. Não rode `openclaw channels login`; não pareie o WhatsApp.",
  ].join("\n");
}

/** Os dois agentes que atendem o WhatsApp, como a pessoa os vê (o app trabalha igual com os dois). */
const AGENTE_OPTIONS: readonly { id: WhatsappAgente; title: string; text: string; recomendado: boolean }[] = [
  { id: "openclaw", title: "OpenClaw", text: "Responde pelo Claude Code desta máquina. É o mais usado com o meu-bot.", recomendado: true },
  { id: "hermes", title: "Hermes", text: "Responde pelo Claude do meu-bot desta máquina, com troca automática de contas e, com a xAI logada, o Grok de reserva.", recomendado: false },
];
/** Agente que vale agora: o escolhido, senão o que a máquina já tem. */
export const agenteAtual = (st: WhatsappStatus | null): WhatsappAgente | null =>
  st?.escolha ?? (st?.present === true && (st.gateway === "openclaw" || st.gateway === "hermes") ? st.gateway : null);
let waAgenteSaving: WhatsappAgente | null = null;
let waAgenteMsg: { text: string; bad: boolean } | null = null;
/**
 * Cartões "qual agente atende o seu WhatsApp" (passo 1 do tutorial e o modal). Sem escolha, o recomendado vem
 * marcado e um clique grava; trocar com número conectado desconecta o agente anterior (o QR é lido de novo).
 */
export function renderAgentChoice(container: HTMLElement): void {
  const st = ctx.waStatus;
  const atual = agenteAtual(st);
  const marcado = waAgenteSaving ?? atual ?? "openclaw";
  const cards = el("div", "reply-cards guide-cards");
  for (const o of AGENTE_OPTIONS) {
    const saving = waAgenteSaving === o.id;
    const card = el("button", `reply-card${marcado === o.id ? " on" : ""}${saving ? " saving" : ""}`);
    card.type = "button"; card.disabled = waAgenteSaving !== null || waPairing;
    card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(marcado === o.id));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.title));
    if (o.recomendado) title.append(el("span", "reply-default", "Recomendado"));
    if (saving) title.append(el("span", "reply-saving", "aplicando…"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
    card.append(saving ? el("span", "reply-spin") : el("span", "reply-radio"), body);
    card.addEventListener("click", () => { if (o.id !== atual || st?.escolha == null) void escolherAgente(o.id); });
    cards.append(card);
  }
  container.append(cards);
  const conectadoNoOutro = st?.number != null && atual !== null;
  container.append(el("div", "guide-note", conectadoNoOutro ? "Trocar desconecta o número do agente atual; depois é só ler o QR de novo." : "Dá para trocar depois; trocar pede para ler o QR de novo."));
  if (waAgenteMsg !== null) container.append(el("p", `hint ${waAgenteMsg.bad ? "bad-hint" : "audio-ok"}`, waAgenteMsg.text));
}
async function escolherAgente(agente: WhatsappAgente): Promise<void> {
  if (waAgenteSaving !== null) return;
  waAgenteSaving = agente; waAgenteMsg = null; paintWhatsapp(); ctx.paintGuide();
  try {
    ctx.waStatus = await window.meuBot.whatsappEscolherAgente(agente);
    waAgenteMsg = { text: `✓ ${agente === "openclaw" ? "OpenClaw" : "Hermes"} vai atender o WhatsApp desta máquina.`, bad: false };
  } catch (err) { waAgenteMsg = { text: `✗ ${ipcErrorText(err)}`, bad: true }; }
  finally { waAgenteSaving = null; paintWhatsapp(); ctx.paintGuide(); }
}

export function requestAgentPrepare(): void {
  const st = ctx.waStatus;
  if (st === null) return;
  void (async () => {
    if (waDialog.open) waDialog.close();
    const tab = await ctx.newTab();
    await ctx.sendText(tab, waAgentPrompt(st));
  })();
}
export let waPairing = false;
/** O pareamento em curso já vinculou: o resto (gateway voltando) é pano de fundo. */
export let waConnected = false;

/** "5516992294486" → "+55 (16) 99229-4486"; outros formatos ficam com o + na frente. */
export function fmtPhone(digits: string | null): string {
  if (digits === null) return "";
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return m === null ? `+${digits}` : `+55 (${m[1]}) ${m[2]}-${m[3]}`;
}

export function paintWhatsapp(): void {
  const st = ctx.waStatus;
  ctx.paintListMode();
  if (st === null || !st.present) { waLine.hidden = true; return; }
  waLine.hidden = false;
  // Ponto verde conectado; cinza no resto (limpo: vermelho só assusta, e o clique já leva à solução).
  waLine.className = `wa-line ${st.connected ? "on" : ""}`;
  const who = st.number !== null ? fmtPhone(st.number) : "sem número";
  const via = st.gateway === "openclaw" ? "WhatsApp (OpenClaw)" : st.gateway === "hermes" ? "WhatsApp (Hermes)" : st.gateway === "picoclaw" ? "WhatsApp (PicoClaw)" : "WhatsApp";
  paintWaAgente();
  if (!st.ready) {
    waLine.replaceChildren(el("span", "dot"), el("span", "", `${via} · sem configurar`));
    waStatusEl.textContent = `${st.agent}.\nFalta:\n${(st.missing ?? "?").split("\n").map((l) => `• ${l}`).join("\n")}`;
    waPairBtn.hidden = true; waResetBtn.hidden = true; waCloseBtn.textContent = "Fechar";
    waAgentBtn.hidden = waPairing;
    waRefreshBtn.hidden = waPairing;
    waPolicyBox.hidden = true;
    return;
  }
  waAgentBtn.hidden = true;
  paintWaPolicy();
  const soEu = st.dono !== undefined && !st.dono.souEu ? "só o dono" : "só você";
  const responde = st.connected && st.dmPolicy !== null ? ` · responde ${st.dmPolicy === "open" ? "todo mundo" : st.dmPolicy === "allowlist" ? (listados(st).length > 0 ? "a lista" : soEu) : st.dmPolicy === "disabled" ? "ninguém" : "com código"}` : "";
  // Antes da primeira resposta desta sessão o estado é o da última vez (cache): dizer "desconectado" aqui assustaria à toa.
  const verificando = waCheckedAt === null && !waPairing;
  waLine.replaceChildren(el("span", "dot"), el("span", "", st.connected ? `${via} · ${who}${responde}${verificando ? " · verificando…" : ""}` : verificando ? `${via} · verificando…` : `${via} · desconectado`));
  // Conectado: só o número. Desconectado: nada (o QR e a linha de progresso dizem o resto). A ficha técnica fica no title.
  // O que o app consertou sozinho na consulta (gateway em porta própria) aparece uma vez, aqui, para a pessoa saber.
  waStatusEl.textContent = `${st.connected ? `Conectado como ${who}.` : ""}${st.repaired !== undefined ? `${st.connected ? "\n" : ""}✓ Consertado sozinho: ${st.repaired}.` : ""}`;
  waStatusEl.title = st.agent;
  waPairBtn.hidden = st.connected || waPairing;
  waPairBtn.textContent = st.number === null ? "Gerar QR" : "Tentar reconectar e gerar QR";
  waResetBtn.hidden = waPairing || st.number === null;
  ctx.paintGuide();
  waCloseBtn.textContent = waConnected && !waSuccess.hidden ? "Concluído" : waPairing ? "Cancelar" : "Fechar";
  waCloseBtn.classList.toggle("btn-done", waConnected && !waSuccess.hidden);
  waRefreshBtn.hidden = waPairing;
}
let waRefreshing = false;
/**
 * Consulta o estado e agenda a próxima: 10 s enquanto a máquina tem WhatsApp mas não está conectado
 * (gateway reiniciando, sessão caindo), 60 s quando está bem. Sem isso a linha congelava no estado da
 * abertura da janela — vermelha depois de um alívio, mesmo com o gateway já de volta.
 */
/** Consulta em andamento: quem chama de novo (o botão Atualizar) espera por ela em vez de ser ignorado. */
let waInflight: Promise<void> | null = null;
let waCheckedAt: Date | null = null;
export function refreshWhatsapp(force = false): Promise<void> {
  if (waInflight !== null) return waInflight;
  waRefreshing = true;
  if (ctx.waTimer !== null) { clearTimeout(ctx.waTimer); ctx.waTimer = null; }
  waInflight = (async () => {
    try { const raw = await window.meuBot.whatsappStatus(force); waRealConectado = raw.connected; ctx.waStatus = comPareamento(raw); waCheckedAt = new Date(); if (raw.present) ctx.cacheWrite("waStatus", raw); else ctx.cacheDrop("waStatus"); } catch { ctx.waStatus = null; }
    finally { waRefreshing = false; waInflight = null; }
    paintWhatsapp();
    if (ctx.waStatus?.capacidades.grupos === true && ctx.waGroups === null && ctx.waGroupsInflight === null && ctx.waGroupsAt === 0) void ctx.refreshWaGroups();
    if (waPairing && ctx.waStatus?.connected === true) waShowSuccess(ctx.waStatus.number);
    const soon = ctx.waStatus !== null && ctx.waStatus.present && !ctx.waStatus.connected;
    agendarWa(waPairing && !waConnected ? 8_000 : soon ? 10_000 : 120_000);
  })();
  return waInflight;
}
/**
 * Agenda a próxima consulta. Com a janela escondida (outra área de trabalho, minimizada) não consulta: só reagenda, e o
 * `focus` traz o estado na hora quando a pessoa volta. Cada consulta sobe um `openclaw` de ~300 MB na máquina; conectado,
 * a cada 2 min basta (o main ainda guarda a resposta por 45 s para as outras janelas da mesma máquina).
 */
function agendarWa(ms: number): void {
  ctx.waTimer = setTimeout(() => { if (document.visibilityState === "hidden") { agendarWa(30_000); return; } void refreshWhatsapp(); }, ms);
}

export function openWhatsapp(): void {
  // No meio de um pareamento o QR e o log continuam: reabrir o modal não pode esconder o QR da vez.
  if (!waPairing) { waQr.hidden = true; waHow.hidden = true; waProgress.hidden = true; waSuccess.hidden = true; resetWaProgress(); }
  paintWhatsapp();
  if (!waDialog.open) waDialog.showModal();
}

/**
 * Só desconecta (antes chamava o pareamento com reset, que já gerava outro QR: a tela ficava em "escaneie"
 * e terminava em "QR expirou", parecendo que não tinha desconectado). Depois o status volta a "desconectado"
 * e o guia volta ao passo de conectar.
 */
export async function disconnectWhatsapp(btn: HTMLButtonElement): Promise<void> {
  const label = btn.dataset.label ?? btn.textContent ?? "Desconectar";
  btn.disabled = true; btn.textContent = "Desconectando…";
  try {
    await window.meuBot.whatsappLogout();
    await refreshWhatsapp();
  } catch (err) {
    btn.textContent = `Não desconectou: ${ipcErrorText(err)}`;
    btn.classList.add("btn-bad");
    window.setTimeout(() => { btn.textContent = label; btn.classList.remove("btn-bad"); }, 5000);
    return;
  } finally { btn.disabled = false; }
  btn.textContent = label;
}
/**
 * Depois de parear, até a máquina confirmar a conexão (o gateway volta em segundos; no Hermes, às vezes minutos):
 * o estado vale como conectado com o número pareado, e o tutorial segue para o passo seguinte logo depois do ✓.
 */
export let waAguardando = false;
let waPareadoNumero: string | null = null;
/** O que a máquina respondeu de verdade na última consulta (antes de segurar "conectado"); decide quando parar de segurar. */
let waRealConectado = false;
export const comPareamento = (st: WhatsappStatus): WhatsappStatus =>
  waAguardando && !st.connected && st.present ? { ...st, connected: true, number: st.number ?? waPareadoNumero } : st;
/**
 * Ação que reinicia o gateway na máquina (Hermes: áudio e quem responde): o número continua pareado, só o bridge
 * cai por alguns segundos. Segura "conectado" até ele voltar, senão o tutorial voltava ao passo do QR.
 */
let waAcaoEmCurso = false;
export function segurarConexao(): void {
  const st = ctx.waStatus;
  if (st === null || st.number === null || !st.capacidades.politicaReinicia) return;
  waPareadoNumero = st.number; waAcaoEmCurso = true;
  if (!waAguardando) aguardarConexao(24);
}
/** A ação terminou na máquina: a partir daqui, "conectado" de verdade solta a segurada (antes, era o estado de antes do reinício). */
export const acaoTerminou = (): void => { waAcaoEmCurso = false; };
function aguardarConexao(tentativas: number): void {
  waAguardando = true; ctx.paintGuide();
  setTimeout(() => {
    void refreshWhatsapp().then(() => {
      // Enquanto a ação roda, um "conectado" é o de antes do reinício: não solta ainda.
      if ((waRealConectado && !waAcaoEmCurso) || tentativas <= 1) { waAguardando = false; ctx.paintGuide(); return; }
      aguardarConexao(tentativas - 1);
    });
  }, 5000);
}
export async function pairWhatsapp(reset: boolean): Promise<void> {
  if (waPairing) return;
  waPairing = true; waConnected = false;
  resetWaProgress(); waSuccess.hidden = true;
  setWaProgress(reset ? "Apagando a sessão antiga…" : "Conectando à máquina…");
  waTick = setInterval(paintWaMeta, 1000);
  waStatusEl.textContent = reset ? "Apagando a sessão antiga e gerando um QR novo…" : "Gerando o QR…";
  paintWhatsapp();
  try {
    await window.meuBot.whatsappPair(reset);
  } catch (err) {
    setWaProgress(err instanceof Error ? err.message : String(err), "bad");
  } finally {
    waPairing = false;
    if (waTick !== null) { clearInterval(waTick); waTick = null; }
    paintWaMeta();
    if (!waConnected && !waProgress.classList.contains("bad")) setWaProgress("O QR expirou sem leitura. Gere outro quando quiser.", "bad");
    waQr.hidden = true; waHow.hidden = true;
    // O gateway acabou de voltar; o bridge leva alguns segundos (no Hermes, às vezes minutos) para abrir a sessão.
    // Pareou: consulta a cada 5 s até ver conectado (até ~3 min), em vez de deixar o passo voltar a "Gerar QR".
    if (waConnected) aguardarConexao(36); else setTimeout(() => { void refreshWhatsapp(); }, 6000);
    paintWhatsapp();
  }
}


/** Pareou (pelo vigia do script ou pela consulta de estado): ✓ animado no lugar do QR, aviso na aba, modal fecha. */
function waShowSuccess(number: string | null): void {
  if (waConnected) return;
  const ev = { number };
  // O tutorial segue já: o passo do QR fica feito e o próximo abre depois da animação (a máquina confirma em segundo plano).
  waPareadoNumero = number; waAguardando = true;
  if (ctx.waStatus !== null) ctx.waStatus = comPareamento(ctx.waStatus);
  setTimeout(() => ctx.paintGuide(), 1800);
      // Vinculou: a janela fecha sozinha; o gateway volta em segundo plano e o refresh depois do `done` mostra o número.
      waConnected = true;
      setWaProgress(`Pareado${ev.number !== null ? ` como ${fmtPhone(ev.number)}` : ""}`, "ok");
      waProgressMeta.textContent = "";
      waQr.hidden = true; waHow.hidden = true;
      waSuccessText.textContent = ev.number !== null ? `Pareado como ${fmtPhone(ev.number)}` : "Pareado";
      waSuccess.hidden = false; waStatusEl.textContent = `✓ Pareado${ev.number !== null ? ` como ${fmtPhone(ev.number)}` : ""}. O gateway está voltando…`;       // O único botão vira "Concluído" (verde): cancelar depois de pareado não faz sentido.
      waCloseBtn.textContent = "Concluído"; waCloseBtn.classList.add("btn-done");
      const tab = ctx.active(); if (tab !== null) ctx.addNotice(tab, "✓ WhatsApp pareado; o gateway está voltando.", "info");
      setTimeout(() => { if (waDialog.open) waDialog.close(); }, 2600);
}
const waCancelIfPairing = (): void => { if (waPairing && !waConnected) void window.meuBot.whatsappCancel(); };

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
/**
 * Passo "Quem o agente responde" do guia: os cartões, o editor do canal e o aviso de que os grupos têm outra lista.
 * Sem o status do WhatsApp ainda, devolve `false` e o guia mostra o botão de ação do alvo.
 */
function renderReplyChoicePasso(txt: HTMLElement): void | false {
  const st = ctx.waStatus; if (st === null) return false;
  const cards = el("div", "reply-cards guide-cards");
  renderReplyCards(cards, replyChoiceNow(st), waPolicySaving || !st.connected, chooseReply);
  txt.append(cards, el("div", "guide-note", REPLY_NOTE));
  renderChannelEditor(txt);
  // Grupos têm a própria lista de quem conversa com o agente (tutorial 11).
  if ((ctx.waGroups?.grupos.length ?? 0) > 0 && ctx.TUT_GRUPOS !== null) {
    const tg = ctx.TUT_GRUPOS;
    const p = el("p", "hint"); p.append("Isto vale para as conversas diretas. Nos grupos, quem conversa com o agente é outra lista: ");
    const b = el("button", "linkish", `tutorial ${tg.number}, ${tg.title}`); b.type = "button"; b.addEventListener("click", () => ctx.openGuide(tg));
    p.append(b, "."); txt.append(p);
  }
}
export function ligarAgenteWhatsapp(): void {
  // O estado do WhatsApp vai ao guia por fora do contexto (`status`); aqui só se a consulta já respondeu.
  registrarFonte("whatsapp", () => ({ known: ctx.waStatus !== null, dados: {} }));
  registrarPassos({
    "agent-choice": (txt) => renderAgentChoice(txt),
    "reply-choice": renderReplyChoicePasso,
    "audio-ouvir": (txt) => renderAudioControls(txt, "ouvir"),
  });
  waRefreshBtn.addEventListener("click", () => {
    waRefreshBtn.disabled = true; waRefreshBtn.textContent = "Consultando a máquina…";
    void refreshWhatsapp(true).finally(() => {
      waRefreshBtn.disabled = false; waRefreshBtn.textContent = "Atualizar";
      // Mesmo sem mudança, dizer que consultou: senão o clique parece não fazer nada.
      if (waCheckedAt !== null) waStatusEl.textContent = `${waStatusEl.textContent ?? ""}\nConsultado às ${waCheckedAt.toLocaleTimeString("pt-BR")}.`;
    });
  });
  waAgentBtn.addEventListener("click", () => requestAgentPrepare());
  window.addEventListener("focus", () => { if (ctx.waStatus?.present) void refreshWhatsapp(); });
  window.meuBot.on("whatsapp:event", (ev: WhatsappEvent) => {
    switch (ev.kind) {
      // Só a linha de progresso: cada passo substitui o anterior; o log cru do CLI não aparece.
      case "step": if (waQrCount === 0 && !waConnected) setWaProgress(ev.text.charAt(0).toUpperCase() + ev.text.slice(1)); break;
      case "log": break;
      case "qr": {
        if (waConnected) break; // já pareou nesta rodada: nenhum QR atrasado volta por cima do ✓
        const now = Date.now();
        if (waQrCount >= 2 && now - waQrAt > 5_000) waQrEvery = now - waQrAt; // mede o ciclo real (do 2º em diante)
        waQrCount += 1; waQrAt = now;
        waQr.src = ev.dataUrl; waQr.hidden = false; waHow.hidden = false;
        waStatusEl.textContent = "Leia o QR com o WhatsApp do número do agente.";
        setWaProgress("Aguardando a leitura no celular"); paintWaMeta();
        break;
      }
      case "connected": { waShowSuccess(ev.number); break; }
      case "error": waStatusEl.textContent = `✗ ${ev.text}`; setWaProgress(ev.text, "bad"); break;
      case "done":
        if (ev.ok && waDialog.open) setTimeout(() => { if (waDialog.open) waDialog.close(); }, 2600);
        break;
    }
  });
  // A linha sempre leva à aba do guia (tudo na aba, sem modal); só cai no modal se a máquina não é OpenClaw.
  waLine.addEventListener("click", () => {
    const guide = TUTORIAIS.find((t) => t.id === "whatsapp-openclaw");
    if (guide !== undefined && ctx.waStatus !== null && ctx.waStatus.capacidades.parear) { ctx.openGuide(guide); return; }
    openWhatsapp();
  });
  waPairBtn.addEventListener("click", () => { void pairWhatsapp(false); });
  waResetBtn.addEventListener("click", () => ctx.armConfirm(waResetBtn, "Confirmar? desconecta o número", () => { void disconnectWhatsapp(waResetBtn); }));
  waCloseBtn.addEventListener("click", () => { waCancelIfPairing(); waDialog.close(); });
  // Esc fecha o <dialog> por conta própria; tem que cancelar o pareamento do mesmo jeito que o botão.
  waDialog.addEventListener("cancel", () => { waCancelIfPairing(); });
}
