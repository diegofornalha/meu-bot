import { byId as $, el } from "../lib/dom.js";
import { planMascots } from "../lib/intro-mascots.js";
import { type OnboardState, type Feedback, ONBOARD_STEPS, initialOnboardState, FINAL_MESSAGE, SKIPPED_MESSAGE, welcomeMessage, type OnboardEvent, advanceOnboard, pickFeedback, TOUR_INVITE, AI_CHOICE_INVITE, AI_NONE_INFO, type AiChoice, comModoGratis, opcoesVisiveis, parseAiChoice, preselecao, pularEscolhaIa, tutorialDaEscolha } from "../lib/onboarding.js";
import { hostLabel } from "../lib/probe-text.js";
import { mountSnake } from "../snake.js";
import type { Tab } from "../renderer.js";
import { ctx, ehRemoto } from "../app/ctx.js";

// ---- Abertura (opcional, interruptor "Intro" do seletor): o topo se materializa em etapas e o túnel acende como clímax.
const introEl = $<HTMLElement>("intro");
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function playIntro(): Promise<void> {
  // Caixinha "abrir direto" do seletor (padrão marcada): sem abertura. Desmarcada: toda vez.
  if (ctx.settings?.openDirect !== false || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { introEl.remove(); return; }
  const brand = $<HTMLElement>("intro-brand");
  const host = $<HTMLElement>("intro-host");
  host.textContent = hostLabel(ctx.windowHost);
  // Mascotes: a bolha do ícone, 5 cores, em arco sobre o nome; cada um com semente própria para os loops não coincidirem.
  const tpl = $<HTMLTemplateElement>("intro-mascot-tpl");
  const stage = $<HTMLElement>("intro-mascots");
  const mascots = planMascots(5).map((m) => {
    const el = (tpl.content.firstElementChild as SVGSVGElement).cloneNode(true) as SVGSVGElement;
    el.style.setProperty("--x", `${m.x}px`); el.style.setProperty("--y", `${m.y}px`); el.style.setProperty("--size", `${m.size}px`);
    el.style.setProperty("--hue", String(m.hue)); el.style.setProperty("--seed", m.seed.toFixed(3));
    stage.append(el);
    return { el, m };
  });
  introEl.hidden = false;
  await wait(30); brand.classList.add("in");            // meu-bot no centro, discreto
  for (const { el, m } of mascots) setTimeout(() => el.classList.add("in"), m.delayMs); // pop com overshoot, em cascata
  await wait(300); host.classList.add("in");            // o nome da máquina, embaixo
  // Clímax: espera o túnel real ficar pronto, mas por pouco tempo; espera longa vira tédio. O estado em si fica na barra.
  const t0 = Date.now();
  while (ctx.hostStatus.get(ctx.windowHost)?.state !== "ready" && Date.now() - t0 < 700) await wait(40);
  const ready = ctx.hostStatus.get(ctx.windowHost)?.state === "ready";
  if (ready) mascots.forEach(({ el }, i) => setTimeout(() => el.classList.add("cheer"), i * 40)); // pulinho em cascata: o túnel acendeu
  await wait(ready ? 520 : 300);
  // Portal: o nome escala e some, e o app por baixo assenta (scale 1.03 → 1) enquanto a camada se dissolve.
  introEl.classList.add("out");
  document.body.classList.add("app-enter");
  await wait(480);
  introEl.remove();
  document.body.classList.remove("app-enter");
}

// ---- Onboarding guiado (primeira vez, sem conversas): a pessoa faz cada ação, o app só orienta.
const onboardEl = $<HTMLElement>("onboard");
const obCount = $<HTMLSpanElement>("ob-count");
const obLead = $<HTMLParagraphElement>("ob-lead");
const obFeedback = $<HTMLParagraphElement>("ob-feedback");
const obTitle = $<HTMLHeadingElement>("ob-title");
const obText = $<HTMLParagraphElement>("ob-text");
const obSkip = $<HTMLButtonElement>("ob-skip");
const obStage = $<HTMLElement>("ob-mascots");
const obRipple = $<HTMLElement>("ob-ripple");
export const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let obMascots: SVGSVGElement[] = [];

/**
 * Entrada do onboarding (shot "capwords-splash"): o cartão chega com mola, os mascotes (os da abertura) deslizam das
 * bordas e param em volta dele, em idle até o fim, e aviso, título e texto sobem em sequência.
 */
function onboardEnter(): void {
  if (prefersReducedMotion) return;
  onboardEl.classList.remove("enter", "shrink"); void onboardEl.offsetWidth; onboardEl.classList.add("enter");
  setTimeout(() => onboardEl.classList.remove("enter"), 800);
  const tpl = $<HTMLTemplateElement>("intro-mascot-tpl");
  obStage.replaceChildren(); obStage.hidden = false; obMascots = [];
  for (const m of planMascots(5, Math.random, 310, 150)) {
    const el = (tpl.content.firstElementChild as SVGSVGElement).cloneNode(true) as SVGSVGElement;
    el.classList.add("from-edge");
    el.style.setProperty("--x", `${m.x}px`); el.style.setProperty("--y", `${m.y}px`); el.style.setProperty("--size", `${m.size + 6}px`);
    el.style.setProperty("--hue", String(m.hue)); el.style.setProperty("--seed", m.seed.toFixed(3));
    el.style.setProperty("--fx", `${Math.round(m.x * 1.6)}px`); el.style.setProperty("--fy", `${Math.round(m.y * 2.2)}px`); // nasce empurrado para a borda
    obStage.append(el); obMascots.push(el);
    setTimeout(() => el.classList.add("in"), 30 + m.delayMs);
  }
}

/** Saída. "done": o cartão se dissolve encolhendo de leve, os mascotes se despedem junto e uma onda verde se abre do centro do cartão e se dissolve. "skipped": só dispensa os mascotes. */
async function onboardLeave(how: "done" | "skipped"): Promise<void> {
  const bye = (): void => { for (const el of obMascots) el.classList.add("bye"); setTimeout(() => { obStage.replaceChildren(); obStage.hidden = true; obMascots = []; }, 400); };
  if (prefersReducedMotion || how === "skipped") { bye(); return; }
  const r = onboardEl.getBoundingClientRect();
  obRipple.style.setProperty("--cx", `${r.left + r.width / 2}px`); obRipple.style.setProperty("--cy", `${r.top + r.height / 2}px`);
  bye();
  onboardEl.classList.add("shrink");
  await wait(280);                         // a onda nasce enquanto o cartão ainda está se dissolvendo
  obRipple.hidden = false; obRipple.classList.add("go");
  await wait(1000);
  obRipple.classList.remove("go"); obRipple.hidden = true; onboardEl.classList.remove("shrink");
}
let onboard: OnboardState | null = null;

// ---- Tela vazia: sem aba e sem onboarding, a cobrinha (snake.ts) ocupa o painel e já sai andando.
export const restEl = $<HTMLElement>("rest");
const rest = mountSnake($<HTMLCanvasElement>("rest-canvas"));
const tabPlus = $<HTMLButtonElement>("tab-plus");
export function syncRest(): void {
  tabPlus.hidden = ctx.tabs.size > 0; // a aba "+" só existe quando não há aba de conversa
  // Com alguma aba de página aberta (Navegador, Tutoriais…) a cobrinha não aparece: a última página vem para a frente.
  if (ctx.tabs.size === 0 && ctx.pageActive === null && !ctx.splitOnAny()) {
    const aberta = [...ctx.pages.values()].filter((p) => p.tabEl !== null && !ctx.ehVazia(p)).at(-1);
    if (aberta !== undefined) { ctx.activatePage(aberta); return; }
  }
  const show = ctx.tabs.size === 0 && onboard === null && ctx.pageActive === null && document.getElementById("tour-welcome")?.hidden !== false;
  restEl.hidden = !show;
  ctx.newBtn.classList.toggle("shine", show);
  if (show) rest.start(); else rest.stop();
  ctx.relayoutSplit();
}
let lastFeedback: Feedback | undefined;
let feedbackTimer: number | null = null;

function paintOnboard(feedback?: Feedback): void {
  const step = onboard === null ? undefined : ONBOARD_STEPS[onboard.step];
  // O botão do passo atual pulsa em azul (e pode ser clicado); os outros ficam normais.
  const targets: Record<string, HTMLButtonElement> = { sidebar: ctx.sidebarBtn, palette: ctx.paletteBtn, settings: ctx.settingsBtn, new: ctx.newBtn };
  for (const [id, btn] of Object.entries(targets)) btn.classList.toggle("attention", step?.id === id);
  if (onboard === null || step === undefined) { onboardEl.hidden = true; return; }
  onboardEl.hidden = false;
  // Número do passo em negrito e azul, para a mudança de passo ser percebida.
  obCount.replaceChildren(el("strong", "n", String(onboard.step + 1)), document.createTextNode(` de ${ONBOARD_STEPS.length}`));
  obLead.hidden = onboard.step !== 0; // o aviso de "leia e siga" só no primeiro passo
  obTitle.textContent = step.title;
  obText.textContent = step.text;
  if (feedbackTimer !== null) { clearTimeout(feedbackTimer); feedbackTimer = null; }
  if (feedback === undefined || feedback.kind === "none") { obFeedback.hidden = true; return; }
  obFeedback.hidden = false;
  obFeedback.className = `onboard-feedback ${feedback.kind}`;
  obFeedback.textContent = feedback.text;
  feedbackTimer = window.setTimeout(() => { obFeedback.hidden = true; feedbackTimer = null; }, 2200);
}

// ---- Convite do tour (primeira abertura): "Iniciar tour" começa o onboarding; pular ou fechar marca pulado.
// No staging, o mesmo cartão pergunta antes "Você já tem assinatura de IA?" (modo "ia") e, sem nenhuma, explica
// como assinar (modo "nenhuma"). `twMode` diz o que o botão principal faz.
const tourWelcomeEl = $<HTMLElement>("tour-welcome");
const twTitle = $<HTMLElement>("tw-title");
const twText = $<HTMLElement>("tw-text");
const twChoice = $<HTMLElement>("tw-choice");
const twStart = $<HTMLButtonElement>("tw-start");
let twMode: "tour" | "ia" | "nenhuma" = "tour";
let aiChoice: AiChoice | null = null;
export function showTourWelcome(): void {
  twMode = "tour"; twChoice.hidden = true; twChoice.replaceChildren(); tourWelcomeEl.classList.remove("tw-escolha");
  twTitle.textContent = TOUR_INVITE.title; twText.textContent = TOUR_INVITE.text; twStart.textContent = "Iniciar tour"; twStart.disabled = false;
  tourWelcomeEl.hidden = false; syncRest(); twStart.focus();
}
function closeTourWelcome(start: boolean): void {
  tourWelcomeEl.hidden = true;
  if (start) startOnboarding(); else void finishOnboarding("skipped");
  syncRest();
}

const aiChoiceKey = (): string => `escolhaIa:${ctx.windowHost}`;
/**
 * Staging: "Você já tem assinatura de IA?" no lugar do convite do tour. Confere as contas antes, para marcar a que
 * já está logada; com o Claude Code Global do admin a conta já existe e segue direto para o convite do tour.
 */
export async function showAiChoice(): Promise<void> {
  await Promise.allSettled([ctx.refreshClaudeLine(), ctx.refreshXaiLine(), ctx.refreshOllamaLine()]);
  const g = ctx.guideCtx();
  if (pularEscolhaIa(g)) { showTourWelcome(); return; }
  const opcoes = comModoGratis(opcoesVisiveis(g.xai.possible), g.ollama.possible === true);
  let guardada: AiChoice | null = null;
  try { guardada = parseAiChoice(localStorage.getItem(aiChoiceKey())); } catch { /* opcional */ }
  const marcada = guardada ?? preselecao(g);
  aiChoice = marcada !== null && opcoes.some((o) => o.id === marcada) ? marcada : null;
  twMode = "ia"; tourWelcomeEl.classList.add("tw-escolha");
  twTitle.textContent = AI_CHOICE_INVITE.title; twText.textContent = AI_CHOICE_INVITE.text; twStart.textContent = "Continuar";
  const paint = (): void => {
    const cards = el("div", "reply-cards guide-cards"); cards.setAttribute("role", "radiogroup");
    for (const o of opcoes) {
      const on = aiChoice === o.id;
      const card = el("button", `reply-card${on ? " on" : ""}`); card.type = "button";
      card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(on));
      const title = el("div", "reply-title"); title.append(el("strong", "", o.title));
      const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
      card.append(el("span", "reply-radio"), body);
      card.addEventListener("click", () => { aiChoice = o.id; paint(); });
      cards.append(card);
    }
    twChoice.replaceChildren(cards);
    // Este Mac: o backend local ainda só sobe com o Claude Code logado; o Grok sozinho não liga o agente aqui.
    if (aiChoice === "grok" && !ehRemoto()) twChoice.append(el("p", "hint", "Neste Mac o agente ainda precisa do Claude Code para ligar; o Grok entra como reserva."));
    twStart.disabled = aiChoice === null;
  };
  paint();
  twChoice.hidden = false; tourWelcomeEl.hidden = false; syncRest();
}

/** Encerra a primeira abertura sem o tour (ele continua em Tutoriais) e sem o cartão de "Tour pulado". */
async function closeAiChoice(): Promise<void> {
  tourWelcomeEl.hidden = true; twChoice.hidden = true; twChoice.replaceChildren(); twMode = "tour"; tourWelcomeEl.classList.remove("tw-escolha");
  syncRest();
  try { ctx.applySettings(await window.meuBot.setSettings({ onboarding: "skipped" })); } catch { /* fica pendente; volta na próxima vez */ }
  ctx.reportProgress();
}

function showAiNone(): void {
  twMode = "nenhuma";
  twTitle.textContent = AI_NONE_INFO.title; twText.textContent = AI_NONE_INFO.text; twStart.textContent = "Entendi"; twStart.disabled = false;
  const links = el("div", "tw-links");
  for (const l of AI_NONE_INFO.links) {
    const b = el("button", "btn btn-small", l.label); b.type = "button";
    b.addEventListener("click", () => { void window.meuBot.openExternal(l.url); });
    links.append(b);
  }
  twChoice.replaceChildren(links, el("p", "hint", AI_NONE_INFO.soon));
}

async function confirmAiChoice(): Promise<void> {
  const c = aiChoice;
  if (c === null) return;
  try { localStorage.setItem(aiChoiceKey(), c); } catch { /* opcional */ }
  const tut = tutorialDaEscolha(c);
  if (tut === null) {
    // Com o modo grátis nesta janela (tutorial 17), "Não tenho nenhuma" vai direto à instalação; sem ele, como assinar.
    if (ctx.guideCtx().ollama.possible === true) { await closeAiChoice(); ctx.enterOllama(); return; }
    showAiNone(); return;
  }
  await closeAiChoice();
  if (tut === "xai-login") ctx.enterXai(); else ctx.enterClaude();
}

function twPrimary(): void {
  if (twMode === "ia") void confirmAiChoice();
  else if (twMode === "nenhuma") void closeAiChoice();
  else closeTourWelcome(true);
}
/** Começar/rever o tour a partir de Tutoriais ou da paleta: marca pendente e começa já. */
export async function restartTour(): Promise<void> {
  try { ctx.applySettings(await window.meuBot.setSettings({ onboarding: "pending" })); } catch { /* segue mesmo assim */ }
  tourWelcomeEl.hidden = true;
  startOnboarding();
  syncRest();
}

function startOnboarding(): void {
  onboard = initialOnboardState();
  lastFeedback = undefined;
  paintOnboard();
  onboardEnter();
}

async function finishOnboarding(how: "done" | "skipped"): Promise<void> {
  onboard = null;
  paintOnboard(); // tira o pulso dos botões
  // Transição final (concluído ou pulado): o cartão fica mais alguns segundos deixando claro que acabou.
  const msg = how === "done" ? FINAL_MESSAGE : SKIPPED_MESSAGE;
  onboardEl.hidden = false;
  obCount.textContent = how === "done" ? "pronto" : "ignorado";
  obLead.hidden = true;
  obSkip.hidden = true;
  obFeedback.hidden = true;
  obTitle.textContent = msg.title;
  obText.textContent = msg.text;
  window.setTimeout(() => {
    if (onboard !== null) return;
    void onboardLeave(how).then(() => {
      if (onboard !== null) return;
      onboardEl.hidden = true; obSkip.hidden = false;
      // Concluiu: volta aos Tutoriais com o próximo (o WhatsApp, para quem começa do zero) em destaque.
      if (how === "done") { ctx.tutNext = true; ctx.openPage(ctx.tutoriaisPage); }
    });
  }, how === "done" ? 3200 : 4500);
  try { ctx.applySettings(await window.meuBot.setSettings({ onboarding: how })); } catch { /* fica pendente; volta na próxima vez */ }
  ctx.reportProgress();
  if (how === "skipped" && ctx.tabs.size === 0) await ctx.newTab();
}

/**
 * Mensagem de boas-vindas (mock, só na tela: não vai ao agente nem fica salva). Confere o login do Claude Code
 * da máquina antes: deslogado, a própria mensagem traz o botão "Entrar no Claude Code".
 */
async function showWelcome(tab: Tab): Promise<void> {
  await ctx.refreshClaudeLine();
  const loggedIn = ctx.clAuth === null ? null : ctx.clAuth.loggedIn;
  const bubble = el("div", "msg msg-assistant msg-welcome");
  ctx.renderAssistant(bubble, welcomeMessage(hostLabel(ctx.windowHost), loggedIn));
  if (loggedIn === false) {
    const btn = el("button", "btn btn-primary btn-small", "Entrar no Claude Code");
    btn.type = "button";
    btn.addEventListener("click", () => ctx.enterClaude());
    bubble.append(btn);
  }
  bubble.append(el("span", "msg-welcome-tag", "boas-vindas do meu-bot · não enviada ao agente"));
  tab.messagesEl.appendChild(bubble);
  ctx.scrollToBottom(tab, false);
}

/** O renderer avisa o que aconteceu; só o evento do passo atual avança. */
export function onboardEvent(ev: OnboardEvent): void {
  if (onboard === null) return;
  const r = advanceOnboard(onboard, ev);
  onboard = r.state;
  if (r.finished) {
    // Último passo concluído: boas-vindas local na conversa nova (sem chamar o agente) e a transição final.
    const tab = ctx.active();
    if (tab !== null) void showWelcome(tab);
    void finishOnboarding("done");
    return;
  }
  if (!r.advanced) return;
  const fb = pickFeedback(Math.random, lastFeedback);
  lastFeedback = fb;
  paintOnboard(fb);
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarInicio(): void {
  tabPlus.addEventListener("click", () => { void ctx.newTab(); });
  twTitle.textContent = TOUR_INVITE.title;
  twText.textContent = TOUR_INVITE.text;
  twStart.addEventListener("click", twPrimary);
  $<HTMLButtonElement>("tw-skip").addEventListener("click", () => closeTourWelcome(false));
  $<HTMLButtonElement>("tw-close").addEventListener("click", () => closeTourWelcome(false));
  obSkip.addEventListener("click", () => { void finishOnboarding("skipped"); });
}
