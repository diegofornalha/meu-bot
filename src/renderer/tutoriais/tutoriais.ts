import { byId as $, el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import type { PageTab } from "../lib/pages-types.js";
import { parseTutMemory, type TutorialState, TUTORIAIS, tutorialKnown, type Tutorial, tutorialState, visibleTutorials, parseTutPulados, sidebarBadge, type GuideFlags, emptyFlags, type GuideFlagName, type GuideTarget, guideView, guideTabTitle, GUIDE_ACTION_LABEL, type GuideContext } from "../lib/tutoriais.js";
import { grupoAlvo } from "../lib/whatsapp-grupos.js";
import { ctx } from "../app/ctx.js";
import { renderPasso } from "./passos.js";
import { renderBackendInstall } from "../conversa/backend-falta.js";

// ---- Tutoriais (lib/tutoriais.ts): passo a passo em aba própria.
export const tutList = $<HTMLElement>("tutoriais-list");
// Concluídos (o tour feito, um guia terminado) vão para "arquivados"; a contagem da lateral mostra só os ativos.
export const tutArchivedEl = $<HTMLInputElement>("tut-archived");
export var tutorialsReady = true;
export const tourDone = (): boolean => ctx.settings?.onboarding === "done";
/**
 * Lembrança por máquina do que estava concluído da última vez em que as fontes chegaram: enquanto a janela ainda
 * consulta a máquina, a lista e o selo nascem como ficaram, em vez de mostrar tudo pendente e corrigir depois.
 */
const tutMemoryKey = (): string => `tutLembrado:${ctx.windowHost}`;
function loadTutMemory(): Record<string, boolean> { try { return parseTutMemory(localStorage.getItem(tutMemoryKey())); } catch { return {}; } }
function rememberTutorials(states: Map<string, TutorialState>): void {
  const mem = loadTutMemory(); let changed = false;
  for (const t of TUTORIAIS) {
    if (t.comingSoon === true || !tutorialKnown(t, ctx.guideCtx())) continue;
    // Só sobe para concluído (e grava "a fazer" na primeira vez, para a próxima abertura não ficar "verificando");
    // nunca desfaz sozinho: isso é do "Refazer do zero".
    const done = states.get(t.id) === "done";
    if (mem[t.id] === undefined || (done && mem[t.id] !== true)) { mem[t.id] = done; changed = true; }
  }
  if (changed) { try { localStorage.setItem(tutMemoryKey(), JSON.stringify(mem)); } catch { /* opcional */ } }
}
export const tutState = (t: Tutorial): TutorialState => tutorialState(t, ctx.waStatus, loadGuideFlags(t), ctx.guideCtx(), loadTutMemory()[t.id] ?? null);
export const tutorialDone = (t: Tutorial): boolean => tutState(t) === "done";
/** Os tutoriais desta janela agora (pacote de suporte e trilha: o 3 e o 4 só depois do 1 concluído). */
export const visibleNow = (): Tutorial[] => visibleTutorials(ctx.guideCtx(), tutorialDone);
/**
 * Tutoriais já vistos nesta máquina (ids), só cresce: a pessoa "vê" ao abrir Tutoriais. Novidade = visível,
 * pendente e nunca visto (novo numa atualização, ou recém-destravado na trilha). Um que some e volta
 * (Refazer do 1 esconde o 2 e o 5; relogar mostra de novo) continua visto: reaparecer não é novidade.
 */
const tutSeenKey = (): string => `tutVisto:${ctx.windowHost}`;
export function loadTutSeen(): Set<string> {
  try { const raw = localStorage.getItem(tutSeenKey()); if (raw !== null) return new Set((JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === "string")); } catch { /* opcional */ }
  return new Set();
}
export function markTutSeen(ids: string[]): void {
  const seen = loadTutSeen(); for (const id of ids) seen.add(id);
  try { localStorage.setItem(tutSeenKey(), JSON.stringify([...seen])); } catch { /* opcional */ }
}
/** Ids que eram novidade quando Tutoriais abriu desta vez: ganham "Novo" no cartão enquanto a página está à vista. */
export let tutNovoLabels = new Set<string>();
/**
 * Pulados por máquina ("Pular" no cartão): o pendente vai para Arquivados e sai da contagem, sem desfazer nada na
 * máquina; "Retomar" o traz de volta. Concluir de fato vence o pulo (um concluído nunca aparece como pulado).
 */
const tutPuladoKey = (): string => `tutPulado:${ctx.windowHost}`;
export function loadTutPulados(): Set<string> { try { return parseTutPulados(localStorage.getItem(tutPuladoKey())); } catch { return new Set(); } }
export function setTutPulado(id: string, pulado: boolean): void {
  const s = loadTutPulados(); if (pulado) s.add(id); else s.delete(id);
  try { localStorage.setItem(tutPuladoKey(), JSON.stringify([...s])); } catch { /* opcional */ }
}
/** Contagem dos tutoriais: para fazer (inclui o tour), arquivados (concluídos), "em breve", total, novidades e o próximo. */
export function tutCounts(): { todo: number; archived: number; pulados: number; soon: number; checking: number; total: number; novos: number; next: Tutorial | null } {
  const all = visibleNow();
  const seen = loadTutSeen();
  const states = new Map(all.map((t) => [t.id, tutState(t)] as const));
  rememberTutorials(states);
  const soon = all.filter((t) => t.comingSoon === true).length;
  const done = all.filter((t) => states.get(t.id) === "done").length;
  const checking = all.filter((t) => states.get(t.id) === "unknown").length;
  const pulados = loadTutPulados();
  const abertos = all.filter((t) => t.comingSoon !== true && states.get(t.id) === "todo");
  const pending = abertos.filter((t) => !pulados.has(t.id));
  const todo = (tourDone() ? 0 : 1) + pending.length;
  const archived = (tourDone() ? 1 : 0) + done + (abertos.length - pending.length);
  return { todo, archived, pulados: abertos.length - pending.length, soon, checking, total: todo + archived + checking, novos: pending.filter((t) => !seen.has(t.id)).length, next: pending[0] ?? null };
}
/** Aviso na lateral (número ao lado de "Tutoriais"): a pessoa desliga em Tutoriais › "avisar na lateral"; a novidade pulsa mesmo assim. */
const tutBadgeEl = $<HTMLInputElement>("tut-badge");
export function paintTutCount(): void {
  // A página mostra só TUT_VISIVEIS pendentes por vez; o número da barra acompanha.
  const c = { ...tutCounts() }; c.todo = Math.min(c.todo, TUT_VISIVEIS);
  const b = sidebarBadge({ todo: c.todo, novos: c.novos, avisar: tutBadgeEl.checked });
  const n = $<HTMLElement>("tutoriais-count");
  n.textContent = b?.text ?? "";
  n.classList.toggle("tut-badge-n", b !== null);
  n.classList.toggle("pulse", b?.pulse === true);
  n.title = b === null ? "" : b.pulse ? `${c.novos === 1 ? "1 tutorial novo" : `${c.novos} tutoriais novos`} · ${c.todo} para fazer` : (c.todo === 1 ? "1 tutorial para fazer" : `${c.todo} tutoriais para fazer`);
  if (ctx.pageActive !== ctx.tutoriaisPage) tutNovoLabels = new Set();
}
/** Quantos tutoriais pendentes aparecem de cada vez. */
export const TUT_VISIVEIS = 2;
export const TUT_ICONS = {
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  tour: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 17c4-1 3-7 7-8s3-1 3-1" stroke-dasharray="2 3"/></svg>',
} as const;

// ---- Guia ao vivo (estilo onboarding), um por aba: "Começar" abre a aba do tutorial ("WhatsApp 2/4"); o passo
// atual tem o botão que leva ao lugar certo, os botões do modal pulsam, e os passos concluídos ganham ✓ pelo
// estado real do WhatsApp. O que o app não vê (a mensagem de teste) a pessoa marca. Uma aba por tutorial.
const guidePages = new Map<string, { page: PageTab; tutorial: Tutorial }>();
const guideFlagsKey = (t: Tutorial): string => `guia:${t.id}:${ctx.windowHost}`;
export function loadGuideFlags(t: Tutorial): GuideFlags {
  try { const raw = localStorage.getItem(guideFlagsKey(t)); if (raw !== null) return { ...emptyFlags(), ...(JSON.parse(raw) as Partial<GuideFlags>) }; } catch { /* opcional */ }
  return emptyFlags();
}
export function saveGuideFlag(t: Tutorial, flag: GuideFlagName): void {
  if (flag === "tested") ctx.maybeAskNotificationsOnce();
  const f = loadGuideFlags(t); f[flag] = true; f.number = ctx.waStatus?.number ?? f.number;
  try { localStorage.setItem(guideFlagsKey(t), JSON.stringify(f)); } catch { /* opcional */ }
}
/** As marcações manuais ("escolhi", "testei") valem para o número pareado na hora. Trocou o número, zeram. */
function reconcileGuideFlags(t: Tutorial): void {
  const num = ctx.waStatus?.connected === true ? ctx.waStatus.number : null;
  if (num === null) return;
  const f = loadGuideFlags(t);
  if (f.number !== num && (f.policyChosen || f.tested)) {
    try { localStorage.setItem(guideFlagsKey(t), JSON.stringify({ policyChosen: false, tested: false, number: num })); } catch { /* opcional */ }
  } else if (f.number !== num) {
    try { localStorage.setItem(guideFlagsKey(t), JSON.stringify({ ...f, number: num })); } catch { /* opcional */ }
  }
}
/** O guia na frente, se a aba ativa é de um tutorial. */
export function activeGuide(): Tutorial | null {
  const shown = ctx.pageActive ?? ctx.splitPages.at(-1) ?? null;
  if (shown === null) return null;
  return guidePages.get(shown.id)?.tutorial ?? ctx.splitPages.map((p) => guidePages.get(p.id)?.tutorial).find((t) => t !== undefined) ?? null;
}
const guideTargets = (): Record<Exclude<GuideTarget, "none">, HTMLElement[]> => ({
  "wa-line": [], "wa-agent": [ctx.waAgentBtn], "wa-pair": [ctx.waPairBtn], "wa-policy": [ctx.waPolicyCards], "chat": [],
});
/** Só os botões do modal do passo atual pulsam (nada na lateral). */
export function paintGuideTargets(): void {
  const all = new Set(Object.values(guideTargets()).flat());
  const want = new Set<HTMLElement>();
  const t = activeGuide();
  if (t !== null) {
    const v = guideView(t, ctx.waStatus, loadGuideFlags(t), ctx.guideCtx());
    const step = v.finished ? undefined : t.steps[v.current];
    if (step !== undefined && step.target !== "none") for (const e of guideTargets()[step.target]) want.add(e);
  }
  for (const e of all) e.classList.toggle("attention", want.has(e));
}
/** Guia que está mostrando o pareamento dentro da própria aba (os nós do QR/progresso são movidos para lá). */
let waInlineGuide: Tutorial | null = null;
/**
 * Passo concluído reaberto pelo "Refazer" (tutorial + passo): o corpo volta para a pessoa remarcar a opção. `marca` é a
 * escolha no momento de reabrir (grupo alvo e quem aciona): mudou, o passo fecha sozinho e o foco volta ao passo atual.
 */
let passoReaberto: { tut: string; step: string; marca: string } | null = null;
const marcaDoPasso = (): string => { const c = ctx.guideCtx(); return JSON.stringify([c.grupos.alvo, c.grupos.info?.quemAciona ?? null, grupoAlvo(c.grupos.info, c.grupos.alvo)?.agente ?? null]); };
/** Como o último "Gerar QR" do guia terminou sem conectar; fica no passo (os nós de progresso voltam ao modal). */
let waGuidePairNote: string | null = null;
function runGuideAction(target: GuideTarget, t: Tutorial): void {
  if (target === "none") return;
  if (target === "chat") {
    if (t.id === "navegador") { if (!ctx.navAgent.on) void window.meuBot.browserAgent(true).then((st) => { ctx.navAgent = st; ctx.paintNav(); }); void ctx.goToChatFromGuide("Abra o site https://google.com no meu navegador e me diga o título da página.", "O agente vai abrir a página na aba Navegador e cada ação aparece aqui com 🌐; quando ele responder, o tutorial se conclui sozinho."); return; }
    if (t.id === "xai-login") {
      // O passo 3 só aparece com Hermes e xAI logada, mas a promessa do grok-4 não sai sem os dois (a máquina sem Hermes responderia por outro modelo).
      const x = ctx.guideCtx().xai;
      if (x.hermes !== true || x.loggedIn !== true) { const tab = ctx.active(); if (tab !== null) ctx.addNotice(tab, "Esta máquina ainda não tem o Hermes com a conta da xAI; faça os passos 1 e 2 do tutorial.", "warn"); return; }
      void ctx.goToChatFromGuide("Oi! Qual modelo está respondendo agora? Uma linha.", "A conversa muda para o grok-4. Se a xAI responder, a pill do túnel mostra \"respondeu grok-4\" e o tutorial se conclui sozinho; se outro modelo responder, volte ao passo 2.", "grok-4");
    }
    else if (t.id === "claude-login") void ctx.goToChatFromGuide("Oi! Você está aí? Me responde em uma linha.", "Quando a resposta chegar, o tutorial se conclui sozinho: é a sua conta do Claude respondendo nesta máquina.");
    else void ctx.goToChatFromGuide("Oi! Me responde em uma linha, só para eu ver a status line aqui embaixo.", "Quando a resposta chegar, olhe o rodapé desta conversa: Sessão e Semanal aparecem ali, e o tutorial se conclui sozinho.");
    return;
  }
  if (ctx.waStatus === null || !ctx.waStatus.present) { void ctx.refreshWhatsapp(); const tab = ctx.active(); if (tab !== null) ctx.addNotice(tab, "Esta máquina não tem agente com WhatsApp (Hermes, OpenClaw ou PicoClaw).", "warn"); return; }
  if (target === "wa-agent") { ctx.requestAgentPrepare(); return; }
  if (target === "wa-pair") {
    if (ctx.waPairing) return;
    if (!ctx.waStatus.ready) { waGuidePairNote = "O WhatsApp desta máquina ainda não está pronto; faça o passo anterior."; paintGuide(); return; }
    if (ctx.waStatus.connected) { waGuidePairNote = null; void ctx.refreshWhatsapp(); return; }
    waInlineGuide = t;
    waGuidePairNote = null;
    void ctx.pairWhatsapp(false).finally(() => {
      waInlineGuide = null;
      if (!ctx.waConnected) waGuidePairNote = (ctx.waProgressText.textContent ?? "").trim() || "O QR não foi lido. Gere outro quando quiser.";
      restorePairNodes(); paintGuide();
    });
    paintGuide();
    return;
  }
  ctx.openWhatsapp();
}
/** Devolve ao modal os nós do pareamento (QR, ✓ e linha de progresso) na ordem original. */
function restorePairNodes(): void {
  const box = ctx.waDialog.querySelector(".wa-box");
  if (box === null) return;
  box.insertBefore(ctx.waQr, ctx.waPolicyBox); box.insertBefore(ctx.waSuccess, ctx.waPolicyBox); box.insertBefore(ctx.waProgress, ctx.waDialog.querySelector(".dialog-actions"));
}
/** Chamado sempre que o estado do WhatsApp muda: redesenha o guia da frente, os títulos das abas e o catálogo. */
/**
 * Progresso nos tutoriais para o suporte (o main só grava na máquina se o suporte estiver ligado e se algo
 * mudou). Agrupado: o guia repinta muito; manda 3 s depois da última mudança.
 */
let progressTimer: number | null = null;
export function reportProgress(): void {
  if (!ctx.caps.supportClient || ctx.windowHost === "" || ctx.windowHost === "local" || ctx.settings === null) return;
  if (progressTimer !== null) clearTimeout(progressTimer);
  progressTimer = window.setTimeout(() => {
    progressTimer = null;
    const tutorials = visibleNow().map((t) => {
      const v = guideView(t, ctx.waStatus, loadGuideFlags(t), ctx.guideCtx());
      const done = v.done.filter(Boolean).length;
      return { id: t.id, title: t.title, done, total: t.steps.length, current: v.finished ? null : (t.steps[v.current]?.title ?? null), finished: v.finished && t.comingSoon !== true, comingSoon: t.comingSoon === true };
    });
    const tour = ctx.settings?.onboarding === "done" ? "done" : ctx.settings?.onboarding === "skipped" ? "skipped" : "pending";
    void window.meuBot.reportProgress({ at: new Date().toISOString(), tour, tutorials }).catch(() => undefined);
  }, 3000);
}

/** Passos `lembrar` concluídos agora pelo estado real ficam gravados (o tutorial não volta a "falta fazer" depois). */
function lembrarFeitos(c: GuideContext): void {
  for (const t of TUTORIAIS) {
    const novos = t.steps.filter((s) => s.lembrar === true && s.done(ctx.waStatus, loadGuideFlags(t), c)).map((s) => s.id);
    if (novos.length === 0) continue;
    const f = loadGuideFlags(t); const antes = f.feitos ?? [];
    if (novos.every((id) => antes.includes(id))) continue;
    try { localStorage.setItem(guideFlagsKey(t), JSON.stringify({ ...f, feitos: [...new Set([...antes, ...novos])] })); } catch { /* opcional */ }
  }
}
export function paintGuide(): void {
  // O contexto é montado uma vez por pintura (antes era remontado por guia aberto e mais uma vez em lembrarFeitos).
  const c = ctx.guideCtx();
  lembrarFeitos(c);
  reportProgress();
  paintTutCount();
  for (const { tutorial } of guidePages.values()) reconcileGuideFlags(tutorial);
  for (const { page, tutorial } of guidePages.values()) {
    const v = guideView(tutorial, ctx.waStatus, loadGuideFlags(tutorial), c);
    const title = page.tabEl?.querySelector(".tab-title"); if (title !== null && title !== undefined) title.textContent = guideTabTitle(tutorial, v);
    if (ctx.pageShown(page)) page.render();
  }
  if (ctx.pageShown(ctx.tutoriaisPage)) ctx.tutoriaisPage.render();
  paintGuideTargets();
}
function renderGuide(t: Tutorial, panel: HTMLElement): void {
  const flags = loadGuideFlags(t);
  const st = ctx.waStatus;
  const view = guideView(t, st, flags, ctx.guideCtx());
  panel.replaceChildren();
  // Cabeçalho: ícone, selo "0 de 4 · 4 passos · 3 min", título e resumo (o mesmo cartão do catálogo, sem botão).
  const head = el("div", "guide-head");
  const icon = el("span", `tut-icon${view.finished ? " ok" : ""}`); icon.innerHTML = TUT_ICONS[t.icon ?? "target"];
  const body = el("div", "tut-body");
  const doneN = view.done.filter(Boolean).length;
  body.append(el("span", "tut-badge", `Tutorial ${t.number} · ${view.finished ? "Concluído" : `${doneN} de ${t.steps.length} · ${t.minutes} min`}`), el("h2", "", t.title), el("p", "", t.summary));
  head.append(icon, body);
  panel.append(head);
  // Máquina sem o backend: nenhum passo anda sem ele; o cartão instala ali e o tutorial segue de onde estava.
  renderBackendInstall(panel);
  // Guia do WhatsApp sem o estado da máquina ainda: não há como saber em que passo a pessoa está; dizer isso,
  // não chutar o passo 1. Os outros tutoriais não dependem do WhatsApp e abrem direto.
  if (st === null && t.steps.some((x) => x.target.startsWith("wa-"))) {
    const wait = el("div", "wa-progress"); wait.append(el("span", "wa-pulse"), el("span", "grow", "Consultando o WhatsApp desta máquina…"));
    panel.append(wait);
    void ctx.refreshWhatsapp();
    return;
  }
  // Lista dos passos: concluídos com ✓, o atual aberto (texto, corpo e botões), os futuros recolhidos.
  const steps = el("ol", "tut-steps");
  if (passoReaberto !== null && passoReaberto.tut === t.id && passoReaberto.marca !== marcaDoPasso()) passoReaberto = null;
  t.steps.forEach((step, i) => {
    const done = view.done[i] === true;
    const cur = i === view.current;
    const li = el("li", done ? "done" : cur ? "current" : "pending");
    const num = el("span", "tut-num", done ? "✓" : String(i + 1));
    const txt = el("div", "tut-step");
    txt.append(el("strong", "", step.title));
    const reaberto = done && step.refazer === true && passoReaberto?.tut === t.id && passoReaberto.step === step.id;
    if (done) {
      // A linha da etapa feita diz o resultado ("Grupo: status · Trocar"); sem resumo, "concluído".
      const linha = el("p", "", step.resumo?.(ctx.guideCtx()) ?? "concluído");
      if (step.refazer === true) {
        const b = el("button", "linkish", reaberto ? "Pronto" : "Trocar"); b.type = "button";
        b.title = reaberto ? "Fecha o passo; o que você marcou já vale" : "Reabre este passo para trocar a escolha, sem recomeçar o tutorial";
        b.addEventListener("click", () => { passoReaberto = reaberto ? null : { tut: t.id, step: step.id, marca: marcaDoPasso() }; paintGuide(); });
        linha.append(" · ", b);
      }
      txt.append(linha);
    }
    if (cur || reaberto) {
      txt.append(el("p", "", step.text));
      // O corpo do passo é de quem registrou o body (tutoriais/passos.ts); `false` = não desenhou, e o alvo ganha o botão.
      const desenhado = step.body !== undefined && renderPasso(step.body, txt, step, t);
      if (desenhado) {
        // Nada: quem desenhou o corpo não quer botão de ação (é o que a cadeia antiga fazia ao casar o body).
      } else if (step.target === "wa-pair" && ctx.waPairing && waInlineGuide === t) {
        // Pareamento dentro da aba: só o QR (o texto do passo já diz onde ler), linha de progresso e Cancelar embaixo.
        const pair = el("div", "pair-inline");
        const side = el("div", "pair-side");
        side.append(ctx.waQr, ctx.waSuccess);
        pair.append(side);
        const foot = el("div", "pair-foot");
        const cancel = el("button", "btn btn-ghost btn-small", "Cancelar"); cancel.type = "button";
        cancel.addEventListener("click", () => { if (ctx.waPairing && !ctx.waConnected) void window.meuBot.whatsappCancel(); });
        foot.append(ctx.waProgress, cancel);
        txt.append(pair, foot);
      } else if (step.target !== "none") {
        const b = el("button", "btn btn-primary btn-small", GUIDE_ACTION_LABEL[step.target]); b.type = "button";
        const target = step.target;
        b.addEventListener("click", () => runGuideAction(target, t));
        txt.append(b);
        if (target === "wa-pair" && waGuidePairNote !== null) txt.append(el("p", "hint guide-pair-note", waGuidePairNote));
      }
      if (step.manual !== undefined) {
        const b = el("button", "btn btn-ghost btn-small", step.manual.label); b.type = "button";
        const flag = step.manual.flag;
        b.addEventListener("click", () => { saveGuideFlag(t, flag); paintGuide(); });
        txt.append(b);
      }
    }
    li.append(num, txt);
    steps.append(li);
  });
  panel.append(steps);
  // Concluído: o guia vira painel de gerência (o "editar" do CRUD): o que foi escolhido nos passos continua
  // ajustável aqui, sem refazer nada.
  if (view.finished && ctx.caps.install) {
    if (t.id === "statusline") {
      const manage = el("div", "guide-manage");
      manage.append(el("p", "hint strong-hint", "O que aparece na status line"));
      ctx.renderStatusLineSegments(manage);
      manage.append(el("p", "hint strong-hint", "Conferir no terminal"));
      ctx.renderStatusLineTest(manage);
      manage.append(el("p", "hint strong-hint", "Onde aparece"));
      const go = el("button", "btn btn-ghost btn-small", GUIDE_ACTION_LABEL.chat); go.type = "button";
      go.addEventListener("click", () => { void ctx.goToChatFromGuide("Oi! Me responde em uma linha, só para eu ver a status line aqui embaixo.", "Quando a resposta chegar, olhe o rodapé desta conversa: Sessão e Semanal aparecem ali."); });
      const where = el("div", "guide-note"); where.append("No rodapé de cada conversa do meu-bot, a cada resposta do agente. ", go);
      manage.append(where);
      panel.append(manage);
    } else if (t.id === "suporte") {
      const manage = el("div", "guide-manage");
      manage.append(el("p", "hint strong-hint", "Suporte nesta máquina"));
      ctx.renderSupportParts(manage, ["name", "share", "delivery", "log"]);
      panel.append(manage);
    } else if (t.id === "xai-login") {
      const manage = el("div", "guide-manage");
      manage.append(el("p", "hint strong-hint", "Conta da xAI nesta máquina"));
      const row = el("div", "guide-note");
      const swap = el("button", "btn btn-ghost btn-small", "Sair e entrar com outra conta"); swap.type = "button";
      swap.addEventListener("click", () => ctx.armConfirm(swap, "Confirmar? o grok-4 para até entrar de novo", () => { void ctx.logoutXai(true); }));
      row.append(`xAI (Grok) · ${ctx.xaiAuth?.email ?? "logada"}. `, swap);
      manage.append(row, el("p", "hint", "Para o Grok assumir quando o Claude falhar: tutorial 6 · Fallback (em breve)."));
      panel.append(manage);
    } else if (t.id === "claude-login") {
      const manage = el("div", "guide-manage");
      manage.append(el("p", "hint strong-hint", "Conta do Claude nesta máquina"));
      const row = el("div", "guide-note");
      const swap = el("button", "btn btn-ghost btn-small", "Sair e entrar com outra conta"); swap.type = "button";
      swap.addEventListener("click", () => ctx.armConfirm(swap, "Confirmar? o agente para até entrar de novo", () => { void ctx.logoutClaude(true); }));
      row.append(`Claude Code · ${ctx.clAuth?.email ?? "logado"}. `, swap);
      manage.append(row);
      panel.append(manage);
    } else if (t.id === "contas-claude") {
      // Concluído: a lista (adicionar, ordem, conferir, desligar) e as últimas trocas ficam aqui.
      const manage = el("div", "guide-manage");
      ctx.renderContasClaude(manage);
      panel.append(manage);
    } else if (t.id === "contas-cli") {
      // Concluído, os passos viram só "concluído": trocar de conta, reconectar e sair ficam aqui.
      const manage = el("div", "guide-manage");
      for (const id of ["cloudflare", "github"] as const) {
        manage.append(el("p", "hint strong-hint", id === "cloudflare" ? "Cloudflare nesta máquina" : "GitHub nesta máquina"));
        ctx.renderConta(manage, id);
      }
      panel.append(manage);
    }
  }
  // Concluído: o mesmo "Refazer do zero" dos cartões arquivados, aqui no fim do guia (dois cliques).
  if (view.finished && t.reset !== undefined && ctx.caps.install) {
    const foot = el("div", "tut-reset guide-reset");
    const btn = el("button", "btn btn-ghost btn-small", tutResetting === t.id ? "Desfazendo…" : "Refazer do zero"); btn.type = "button"; btn.disabled = tutResetting !== null;
    btn.title = `Desfaz: ${t.reset.what}. Depois o tutorial volta ao passo 1.`;
    btn.addEventListener("click", () => ctx.armConfirm(btn, "Confirmar? desfaz na máquina", () => { void resetTutorial(t); }));
    foot.append(el("span", "tut-finished-line", "✓ Concluído."), btn, el("span", "hint", t.reset.what));
    if (tutResetMsg?.id === t.id) foot.append(el("span", `hint ${tutResetMsg.bad ? "guide-pair-note" : "audio-ok"}`, tutResetMsg.text));
    panel.append(foot);
  }
  // Tutorial concluído e conectado: a aba do guia do WhatsApp vira o painel de gerência (quem responde, áudio,
  // atualizar, desconectar) — sem modal. Com passos pendentes, os próprios passos já oferecem esses controles:
  // repetir tudo embaixo deixava a aba cheia de coisa aberta. Só nos guias do WhatsApp.
  if (st !== null && st.connected && view.finished && t.steps.some((x) => x.target.startsWith("wa-"))) {
    const manage = el("div", "guide-manage");
    manage.append(el("span", "tut-finished-line", "✓ Conectado. Ajuste aqui quando quiser."));
    manage.append(el("p", "hint strong-hint", "Quem o agente responde no WhatsApp"));
    const cards = el("div", "reply-cards guide-cards");
    ctx.renderReplyCards(cards, ctx.replyChoiceNow(st), ctx.waPolicySaving, ctx.chooseReply);
    manage.append(cards);
    ctx.renderChannelEditor(manage);
    manage.append(el("p", "hint strong-hint", "Áudio no WhatsApp"));
    ctx.renderAudioControls(manage, "responder");
    const acts = el("div", "dialog-actions");
    const refresh = el("button", "btn btn-ghost btn-small", "Atualizar"); refresh.type = "button";
    refresh.addEventListener("click", () => { refresh.disabled = true; void ctx.refreshWhatsapp().finally(() => { refresh.disabled = false; }); });
    const disc = el("button", "btn btn-ghost btn-small", "Desconectar"); disc.type = "button";
    disc.addEventListener("click", () => ctx.armConfirm(disc, "Confirmar? desconecta o número", () => { void ctx.disconnectWhatsapp(disc); }));
    const spacer = el("span", "spacer");
    const close = el("button", "btn btn-ghost btn-small", "Fechar"); close.type = "button";
    close.addEventListener("click", () => { const g = guidePages.get(`tut-${t.id}`); if (g !== undefined) ctx.closePage(g.page); });
    acts.append(refresh, disc, spacer, close);
    manage.append(acts);
    panel.append(manage);
  }
}
/** Abre (ou traz para a frente) a aba do guia de um tutorial. */
export function openGuide(t: Tutorial): void {
  let g = guidePages.get(`tut-${t.id}`);
  if (g === undefined) {
    const panel = el("section", "acervo-panel guide-panel"); panel.hidden = true;
    ctx.panelsEl.append(panel);
    const page = ctx.definePage(`tut-${t.id}`, t.short, panel, () => renderGuide(t, panel));
    g = { page, tutorial: t };
    guidePages.set(page.id, g);
  }
  ctx.openPage(g.page);
  void ctx.refreshWhatsapp(); // o guia depende do estado real; consultar ao abrir, não só no ciclo automático
  if (t.id === "claude-login" || t.id === "contas-claude") { void ctx.refreshClaudeLine(); void ctx.refreshContasClaude(); }
  if (t.id === "guarda-whatsapp") void ctx.refreshGuarda();
  if (t.id === "navegador") { void ctx.refreshLicense().then(() => paintGuide()); void ctx.refreshNavInst(); }
  if (t.id === "crm-whatsapp" || t.id === "crm-gmail") { void ctx.refreshLicense().then(() => paintGuide()); void ctx.refreshCrm(); }
  if (t.id === "financeiro") void ctx.refreshLicense().then(() => ctx.financePage?.refresh());
  if (t.id === "xai-login") void ctx.refreshXaiLine();
  if (t.id === "whatsapp-grupos") void ctx.refreshWaGroups();
  if (t.id === "contas-cli") void ctx.refreshContas();
  if (t.id === "gmail") { void ctx.refreshLicense().then(() => paintGuide()); void ctx.refreshGmailGuia(); }
  paintGuide();
}
/** "Refazer do zero" em andamento (id do tutorial) e o último recado por tutorial. */
export let tutResetting: string | null = null;
export let tutResetMsg: { id: string; text: string; bad: boolean } | null = null;
/**
 * Desfaz na máquina o que o tutorial fez (status line: desinstala; suporte: desliga e esquece o nome;
 * WhatsApp: desconecta), esquece as marcações manuais e volta ao passo 1. É o "excluir" do CRUD dos tutoriais.
 */
export async function resetTutorial(t: Tutorial): Promise<void> {
  if (tutResetting !== null) return;
  tutResetting = t.id; tutResetMsg = null; ctx.tutoriaisPage.render();
  try {
    if (t.id === "statusline") {
      const r = await window.meuBot.uninstallStatusLine();
      if (!r.ok) throw new Error(r.log.at(-1) ?? "não deu para desinstalar");
      ctx.statusLineSegs = null;
      await ctx.refreshStatusLine();
    } else if (t.id === "guarda-whatsapp") {
      const r = await window.meuBot.uninstallGuarda();
      if (!r.ok) throw new Error(r.log.at(-1) ?? "não deu para tirar a guarda");
      ctx.guardaMsg = null;
      await ctx.refreshGuarda();
    } else if (t.id === "suporte") {
      ctx.supportState = await window.meuBot.resetSupport();
      ctx.repaintSupport();
    } else if (t.id === "whatsapp-openclaw") {
      if (ctx.waStatus?.connected === true) await window.meuBot.whatsappLogout();
      await ctx.refreshWhatsapp();
    } else if (t.id === "claude-login") {
      await ctx.logoutClaude(false);
    } else if (t.id === "xai-login") {
      if (ctx.xaiAuth?.loggedIn === true) await ctx.logoutXai(false);
    } else if (t.id === "whatsapp-objetivo") {
      ctx.objectiveState = await window.meuBot.resetObjective(); ctx.objectiveDraft = null; ctx.objectiveMsg = null; ctx.paintAcervoCount();
    }
    try { localStorage.removeItem(guideFlagsKey(t)); } catch { /* opcional */ }
    // A lembrança de "concluído" sai junto: é ela que segura o tutorial como feito.
    try { const mem = loadTutMemory(); delete mem[t.id]; localStorage.setItem(tutMemoryKey(), JSON.stringify(mem)); } catch { /* opcional */ }
    const g = guidePages.get(`tut-${t.id}`); if (g !== undefined && g.page.tabEl !== null) ctx.closePage(g.page);
    tutResetMsg = { id: t.id, text: "Desfeito. O tutorial voltou ao passo 1.", bad: false };
  } catch (err) {
    tutResetMsg = { id: t.id, text: ipcErrorText(err), bad: true };
  } finally { tutResetting = null; paintGuide(); ctx.tutoriaisPage.render(); }
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarTutoriais(): void {
   // applySettings pode rodar antes deste trecho; var evita a zona morta do let
  try { tutArchivedEl.checked = localStorage.getItem("tutArchived") === "1"; } catch { /* opcional */ }
  try { tutBadgeEl.checked = localStorage.getItem("tutBadge") !== "0"; } catch { /* opcional */ }
  tutArchivedEl.addEventListener("change", () => {
    try { localStorage.setItem("tutArchived", tutArchivedEl.checked ? "1" : "0"); } catch { /* opcional */ }
    ctx.tutoriaisPage.render();
  });
  tutBadgeEl.addEventListener("change", () => {
    try { localStorage.setItem("tutBadge", tutBadgeEl.checked ? "1" : "0"); } catch { /* opcional */ }
    paintTutCount();
  });
  $<HTMLButtonElement>("tutoriais-line").addEventListener("click", () => ctx.openPage(ctx.tutoriaisPage));
}
