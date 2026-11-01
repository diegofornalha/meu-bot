import type { BackendModel, ClaudeAuthInfo, ContasClaudeView, ClaudeLoginEvent, XaiKeyStatus } from "../../shared/ipc";
import { avisoSemConta, estadoTexto, eventoTexto, nomeConta, usoTexto } from "../lib/contas-claude.js";
import { byId as $, el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { type LoginView, type LoginProvider, loginView } from "../lib/login-steps.js";
import { hostLabel } from "../lib/probe-text.js";
import { TUTORIAIS, type Tutorial } from "../lib/tutoriais.js";
import type { Tab } from "../renderer.js";
import { ctx, ehRemoto } from "../app/ctx.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { FALLBACK_PRIMARIES, fallbackOrderText } from "../lib/fallback.js";
import { registrarPassos } from "../tutoriais/passos.js";

// ---- Entrar no Claude Code: roda `claude auth login` na máquina, abre o link e recebe o código. Um estado só
// (clState) pintado em dois conjuntos de controles: o passo 1 do tutorial "Entrar no Claude Code" (dentro da
// aba, criado uma vez e reanexado a cada repintura, para o campo do código não perder o que foi digitado) e o
// modal #cl-dialog, que fica para quem já concluiu o tutorial e quer trocar de conta.
const clDialog = $<HTMLDialogElement>("cl-dialog");
const clClose = $<HTMLButtonElement>("cl-close");
interface LoginControls { box: HTMLElement; status: HTMLElement; open: HTMLButtonElement; codeRow: HTMLElement; code: HTMLInputElement; send: HTMLButtonElement; log: HTMLElement; start: HTMLButtonElement; cancel: HTMLButtonElement | null }
const clState = { running: false, url: null as string | null, needCode: false, status: "", log: [] as string[], result: null as "ok" | "fail" | null };
const clModal: LoginControls = { box: clDialog, status: $<HTMLElement>("cl-status"), open: $<HTMLButtonElement>("cl-open"), codeRow: $<HTMLElement>("cl-code-row"), code: $<HTMLInputElement>("cl-code"), send: $<HTMLButtonElement>("cl-send"), log: $<HTMLElement>("cl-log"), start: $<HTMLButtonElement>("cl-start"), cancel: null };
function buildLoginControls(): LoginControls {
  const box = el("div", "guide-login");
  const status = el("p", "hint");
  const start = el("button", "btn btn-primary btn-small", "Entrar"); start.type = "button";
  const cancel = el("button", "btn btn-ghost btn-small", "Cancelar"); cancel.type = "button";
  const open = el("button", "btn btn-ghost btn-small", "abrir o link de novo"); open.type = "button";
  const actions = el("div", "actions"); actions.append(start, cancel, open);
  const codeRow = el("div", "row"); codeRow.hidden = true;
  const code = el("input") as HTMLInputElement; code.type = "text"; code.autocomplete = "off"; code.spellcheck = false; code.placeholder = "cole o código aqui";
  const send = el("button", "btn btn-primary btn-small", "Enviar código"); send.type = "button";
  const label = el("label", "grow", "Código de autorização"); label.append(code);
  codeRow.append(label, send);
  const log = el("pre", "log"); log.hidden = true;
  box.append(status, actions, codeRow, log);
  return { box, status, start, cancel, open, codeRow, code, send, log };
}
export const clGuide: LoginControls = buildLoginControls();
const CL_INTRO = (): string => `Máquina: ${hostLabel(ctx.windowHost)}. Abre o link de autorização no navegador; você entra na conta e cola aqui o código que aparece.`;

/** Pinta um conjunto de controles a partir do clState; só textos, hidden e classes (nunca cria nós). */
export function paintLoginControls(c: LoginControls, variant: "modal" | "guide"): void {
  c.status.textContent = clState.status === "" ? CL_INTRO() : clState.status;
  c.open.hidden = clState.url === null || clState.result === "ok";
  c.codeRow.hidden = !clState.needCode;
  c.log.hidden = clState.log.length === 0; c.log.textContent = clState.log.join("\n");
  c.start.hidden = clState.running || clState.result === "ok";
  c.start.textContent = clState.result === "fail" ? "Tentar de novo" : variant === "guide" ? "Entrar" : "Começar";
  c.start.classList.toggle("pulse", variant === "guide" && !c.start.hidden);
  if (c.cancel !== null) c.cancel.hidden = !clState.running;
  if (variant === "modal") clClose.textContent = clState.running ? "Cancelar" : "Fechar";
}
function paintClaudeLogin(): void { paintLoginControls(clModal, "modal"); paintLoginControls(clGuide, "guide"); }

/** Login do Claude Code na máquina; com `contaId`, numa conta isolada (CLAUDE_CONFIG_DIR dela), mesmo fluxo de link + código. */
async function runClaudeLogin(contaId: string | null = null): Promise<void> {
  if (clState.running) return;
  clState.running = true; clState.result = null; clState.url = null; clState.needCode = false; clState.log = []; clState.status = "Iniciando o login na máquina…";
  paintClaudeLogin();
  try { if (contaId === null) await window.meuBot.claudeLogin(); else await window.meuBot.contasClaudeEntrar(contaId); } catch (err) { clState.status = `✗ ${ipcErrorText(err)}`; clState.result = "fail"; }
  finally { clState.running = false; clState.needCode = false; paintClaudeLogin(); if (contaId !== null) void refreshContasClaude(); }
}
function submitClaudeCode(c: LoginControls): void {
  const code = c.code.value.trim();
  if (code === "") return;
  c.send.disabled = true;
  void window.meuBot.claudeLoginCode(code).then((ok) => {
    if (ok) { clState.status = "Código enviado; conferindo o login…"; clModal.code.value = ""; clGuide.code.value = ""; }
    else clState.status = "✗ não há login em andamento; clique em Entrar.";
  }).finally(() => { c.send.disabled = false; paintClaudeLogin(); });
}
function wireLogin(c: LoginControls): void {
  c.start.addEventListener("click", () => { void runClaudeLogin(); });
  c.send.addEventListener("click", () => submitClaudeCode(c));
  // Enter manda o código; stopPropagation para os atalhos globais (Cmd+K, Esc…) não dispararem enquanto digita.
  c.code.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); submitClaudeCode(c); } ev.stopPropagation(); });
  c.open.addEventListener("click", () => { if (clState.url !== null) void window.meuBot.openExternal(clState.url); });
  if (c.cancel !== null) c.cancel.addEventListener("click", () => { if (clState.running) void window.meuBot.claudeLoginCancel(); });
}

/** Modal do login (trocar de conta quando o tutorial 1 já foi concluído). */
function openClaudeLogin(): void {
  if (!clState.running) { clState.status = ""; clState.log = []; clState.url = null; clState.needCode = false; clState.result = null; clModal.code.value = ""; }
  paintClaudeLogin();
  if (!clDialog.open) clDialog.showModal();
}
const CLAUDE_TUTORIAL = TUTORIAIS.find((t) => t.id === "claude-login") as Tutorial;
/**
 * Porta única para "Entrar no Claude Code": enquanto o tutorial 1 não foi concluído, abre o guia (o botão
 * Entrar pulsa no passo 1; nada roda sozinho); concluído, é trocar de conta: o modal, que já começa o login.
 */
export function enterClaude(): void {
  if (ctx.caps.install && !ctx.tutorialDone(CLAUDE_TUTORIAL)) { ctx.tutNext = false; ctx.openGuide(CLAUDE_TUTORIAL); return; }
  openClaudeLogin(); void runClaudeLogin();
}

/** Erro/aviso que indica Claude Code deslogado: a notice ganha o botão "Entrar no Claude Code". */
const LOGGED_OUT_RE = /not logged in|please run \/?login|deslogad|não está logado/i;
/** Hosts http(s) citados no resumo de uma ferramenta do Navegador (url do `abrir`, por exemplo). */
export function navHostsIn(summary: string): string[] {
  const out = new Set<string>();
  for (const m of summary.matchAll(/https?:\/\/[^\s"'\\)]+/g)) { try { out.add(new URL(m[0]).hostname.toLowerCase()); } catch { /* não é url */ } }
  return [...out];
}
/**
 * O agente navegou neste turno: o que ele descobriu vale uma skill (do REA do Rambox nada disto; é do meu-bot).
 * Balão no fim da resposta: atualizar uma skill da máquina que combine com os sites visitados (nome/descrição
 * citam o host, um pedaço dele ou o título da aba) ou criar uma do zero a partir desta conversa. "Agora não" fecha.
 */
export function offerSkillFromTurn(tab: Tab): void {
  // O turno que era o próprio pedido de skill não oferece outra (senão cada clique gerava mais um balão).
  const lastUser = [...tab.messagesEl.querySelectorAll(".msg-user")].pop()?.textContent ?? "";
  if (/^(Crie uma skill nova|Atualize a skill)/.test(lastUser)) return;
  // Um balão por conversa à vista: o anterior sai.
  for (const old of tab.messagesEl.querySelectorAll(".skill-offer")) old.remove();
  const sites = [...tab.navSitesTurn].filter((s) => s !== "*");
  const label = sites.length > 0 ? sites.join(", ") : "o site aberto";
  const tokens = new Set<string>();
  for (const s of sites) { tokens.add(s); for (const part of s.split(".")) if (part.length >= 4 && !["google", "com", "www", "app", "mail"].includes(part)) tokens.add(part); for (const t of ctx.navTabs) { let h = ""; try { h = new URL(t.url).hostname.toLowerCase(); } catch { continue; } if (h === s) for (const w of t.title.toLowerCase().split(/[^a-z0-9à-ú]+/)) if (w.length >= 5) tokens.add(w); } }
  if (sites.some((s) => s.includes("google"))) tokens.add("gmail");
  const skills = (ctx.objectiveState?.skills ?? []).filter((sk) => !sk.objective);
  const matches = skills.filter((sk) => { const hay = `${sk.name} ${sk.description}`.toLowerCase(); return [...tokens].some((t) => hay.includes(t)); }).slice(0, 2);
  const box = el("div", "notice skill-offer");
  box.append(el("span", "", `O agente usou o Navegador em ${label}. Quer guardar o que ele aprendeu numa skill, para a próxima vez ir direto? `));
  const row = el("div", "skill-offer-row");
  const ask = (text: string): void => { box.remove(); void ctx.sendText(tab, text); };
  for (const sk of matches) {
    const b = el("button", "btn btn-ghost btn-small", `Atualizar «${sk.name}»`); b.type = "button";
    b.addEventListener("click", () => ask(`Atualize a skill "${sk.name}" (o SKILL.md dela nesta máquina) com o que você aprendeu nesta conversa sobre ${label}: o caminho que funcionou passo a passo, o que falhou e por quê, urls, seletores e rótulos úteis. Acrescente numa seção "Diário" com a data de hoje; não repita o que já está lá e não apague nada. No fim, me diga em uma linha o que mudou.`));
    row.append(b);
  }
  const create = el("button", "btn btn-primary btn-small", matches.length > 0 ? "Criar outra skill do zero" : "Criar uma skill do zero"); create.type = "button";
  create.addEventListener("click", () => ask(`Crie uma skill nova em ~/.claude/skills/<nome-curto-em-kebab-case>/SKILL.md (frontmatter com name e description, como as outras skills desta máquina) com o que você aprendeu nesta conversa sobre ${label}: quando usar, o caminho que funcionou passo a passo, o que falhou e por quê, urls, seletores e rótulos úteis, e uma seção "Diário" com a data de hoje. Escolha o nome pelo site e pela tarefa. No fim, me diga o nome do arquivo e, em uma linha, o que ela ensina.`));
  const no = el("button", "btn btn-ghost btn-small", "Agora não"); no.type = "button"; no.addEventListener("click", () => box.remove());
  row.append(create, no);
  box.append(row);
  tab.messagesEl.appendChild(box);
  ctx.scrollToBottom(tab, false);
}
export function offerClaudeLogin(tab: Tab, text: string): void {
  if (!LOGGED_OUT_RE.test(text)) return;
  const box = el("div", "notice notice-warn");
  box.append(el("span", "", "O Claude Code desta máquina está deslogado. "));
  const btn = el("button", "btn btn-ghost btn-small", "Entrar no Claude Code");
  btn.type = "button";
  btn.addEventListener("click", () => enterClaude());
  box.append(btn);
  tab.messagesEl.appendChild(box);
  ctx.scrollToBottom(tab, false);
}

// ---- Linha "Claude Code" na lista de conversas: conta logada, sair (para entrar com outra) ou entrar.
const clLine = $<HTMLDivElement>("cl-line");
const clLineText = $<HTMLSpanElement>("cl-line-text");
const clLineBtn = $<HTMLButtonElement>("cl-line-btn");
export let clAuth: ClaudeAuthInfo | null = null;

function paintClaudeLine(): void {
  if (clAuth === null) { clLine.hidden = true; return; }
  clLine.hidden = false;
  clLine.className = `wa-line cl-line ${clAuth.loggedIn ? "on" : "off"}`;
  // Global do admin: mostra que está nele e de quem é a conta, sem "sair" (a gestão é do admin).
  if (clAuth.global === true) {
    clLineText.textContent = `Claude Code · global${clAuth.email !== null ? ` (${clAuth.email})` : ""}`;
    clLine.title = "Esta máquina responde pelo Claude Code Global do admin. Só o admin mexe nele; uma conta própria fica como reserva (tutorial 2).";
    clLineBtn.hidden = true;
    return;
  }
  clLineBtn.hidden = false;
  clLine.title = "Conta do Claude Code nesta máquina";
  clLineText.textContent = clAuth.loggedIn ? `Claude Code · ${clAuth.email ?? "logado"}` : "Claude Code · deslogado";
  clLineBtn.textContent = clAuth.loggedIn ? "sair" : "entrar";
  clLineBtn.title = clAuth.loggedIn ? "Sai da conta do Claude Code nesta máquina e abre o login para entrar com outra" : "Abre o login do Claude Code nesta máquina";
}

/** Consulta a conta na máquina; o tutorial 1 e a lateral seguem o resultado (é aqui que o e-mail chega). */
export async function refreshClaudeLine(): Promise<void> {
  try { clAuth = await window.meuBot.claudeAuth(); } catch { clAuth = null; }
  paintClaudeLine();
  if (ctx.tutorialsReady) ctx.paintGuide();
}

// ---- Contas do Claude na máquina (rodízio ao bater o limite de uso): lista e controles no guia do tutorial 1.
// O backend (contas-claude.js) é o dono do registro; aqui só se mostra e se manda comandos.
let contasClaude: ContasClaudeView | null = null;
/** A vista atual, para o guia (tutorial das contas) saber quantas extras estão logadas e se já houve troca. */
export const contasClaudeView = (): ContasClaudeView | null => contasClaude;
let contasMsg: string | null = null;
let contasOcupado = false;
export async function refreshContasClaude(): Promise<void> {
  try { contasClaude = await window.meuBot.contasClaude(); } catch { contasClaude = null; }
  if (ctx.tutorialsReady) ctx.paintGuide();
}
/** Roda uma ação do backend e repinta; erro vira recado na seção. */
async function acaoContaClaude(run: () => Promise<ContasClaudeView | null>): Promise<void> {
  if (contasOcupado) return;
  contasOcupado = true; contasMsg = null; ctx.paintGuide();
  try { const v = await run(); if (v !== null) contasClaude = v; else contasMsg = "o backend desta máquina não respondeu (atualize o backend no seletor)"; }
  catch (err) { contasMsg = ipcErrorText(err); }
  finally { contasOcupado = false; ctx.paintGuide(); }
}
/** Cria a conta isolada e já abre o login nela (modal do tutorial 1, com link + código). */
async function adicionarContaClaude(): Promise<void> {
  if (contasOcupado || clState.running) return;
  let nova: string | null = null;
  await acaoContaClaude(async () => { const r = await window.meuBot.contasClaudeCriar(""); if (r !== null) nova = r.contas.find((c) => !c.logada && !c.padrao && r.atual !== c.id)?.id ?? null; return r; });
  if (nova !== null) { openClaudeLogin(); void runClaudeLogin(nova); }
}
export function renderContasClaude(box: HTMLElement): void {
  const v = contasClaude;
  box.append(el("p", "hint strong-hint", "Contas do Claude nesta máquina"));
  if (v === null) { box.append(el("p", "hint", "Lista indisponível: a máquina está fora do ar ou o backend é antigo (atualize no seletor).")); return; }
  box.append(el("p", "hint", "Com mais de uma conta, a troca é automática quando uma bate o limite: vale para as conversas do app, para o agente do WhatsApp e para o Terminal desta máquina. A conversa continua na próxima conta, do ponto em que parou. A ordem da lista é a preferência; o login da máquina é a base e fica por último."));
  const aviso = avisoSemConta(v, xaiAuth === null ? null : xaiAuth.loggedIn);
  if (aviso !== null) box.append(el("p", "hint guide-pair-note", aviso));
  // Trocas feitas fora do app (porteiro do claude): a pessoa vê que o WhatsApp/Terminal mudaram de conta e por quê.
  const trocas = (v.eventos ?? []).slice(-5).reverse();
  if (trocas.length > 0) {
    const bloco = el("div", "guide-note"); bloco.append(el("strong", "", "Últimas trocas"));
    for (const ev of trocas) bloco.append(el("div", "hint", eventoTexto(ev)));
    box.append(bloco);
  }
  const lista = el("div", "contas-claude");
  const isoladas = v.contas.filter((c) => !c.padrao && c.global !== true);
  for (const c of v.contas) {
    const row = el("div", "conta-claude-row");
    if (c.global === true) {
      // Global do admin: primeiro da fila, sem controles aqui (a gestão é só do admin).
      const st = estadoTexto(c, v.atual);
      const head = el("div", "conta-claude-head");
      head.append(el("span", "conta-claude-nome", `Claude Code Global${c.email !== null ? ` · ${c.email}` : ""}`), el("span", `conta-claude-estado ${st.tone}`, st.text));
      row.append(head, el("div", "hint", "Do admin: responde primeiro por todos nesta máquina. As suas contas abaixo são a reserva quando ele chega ao limite."));
      lista.append(row);
      continue;
    }
    const st = estadoTexto(c, v.atual);
    const head = el("div", "conta-claude-head");
    head.append(el("span", "conta-claude-nome", nomeConta(c)), el("span", `conta-claude-estado ${st.tone}`, st.text));
    row.append(head);
    const uso = usoTexto(c);
    if (uso !== "") row.append(el("div", "hint conta-claude-uso", uso));
    const acts = el("div", "actions");
    const btn = (label: string, title: string, run: () => void): HTMLButtonElement => { const b = el("button", "btn btn-ghost btn-small", label); b.type = "button"; b.title = title; b.disabled = contasOcupado; b.addEventListener("click", run); acts.append(b); return b; };
    if (!c.logada || c.uso.estado === "bloqueada") btn("Entrar", "Login do Claude Code nesta conta (link + código)", () => { if (clState.running) return; openClaudeLogin(); void runClaudeLogin(c.padrao ? null : c.id); });
    if (c.uso.estado === "esgotada") btn("Usar agora", "Volta a usar esta conta antes da hora (se o limite já passou)", () => { void acaoContaClaude(() => window.meuBot.contasClaudeUsarAgora(c.id)); });
    btn("Conferir", "Relê login, e-mail e uso desta conta", () => { void acaoContaClaude(() => window.meuBot.contasClaudeConferir(c.id)); });
    btn(c.ativa ? "Desligar" : "Ligar", c.ativa ? "Tira esta conta do rodízio (sem sair dela)" : "Devolve esta conta ao rodízio", () => { void acaoContaClaude(() => window.meuBot.contasClaudeAtualizar(c.id, { ativa: !c.ativa })); });
    if (!c.padrao) {
      const i = isoladas.findIndex((x) => x.id === c.id);
      if (i > 0) btn("↑", "Preferir antes", () => { const ids = isoladas.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!]; void acaoContaClaude(() => window.meuBot.contasClaudeReordenar(ids)); });
      if (i < isoladas.length - 1) btn("↓", "Preferir depois", () => { const ids = isoladas.map((x) => x.id); [ids[i], ids[i + 1]] = [ids[i + 1]!, ids[i]!]; void acaoContaClaude(() => window.meuBot.contasClaudeReordenar(ids)); });
      const rem = btn("Remover", "Apaga a pasta desta conta nesta máquina (o histórico das conversas fica)", () => {});
      rem.addEventListener("click", () => ctx.armConfirm(rem, "Confirmar? apaga o login desta conta", () => { void acaoContaClaude(() => window.meuBot.contasClaudeRemover(c.id)); }));
    }
    row.append(acts);
    lista.append(row);
  }
  box.append(lista);
  const add = el("button", "btn btn-ghost btn-small", "Adicionar conta"); add.type = "button"; add.disabled = contasOcupado || clState.running;
  add.title = "Cria uma conta isolada nesta máquina e abre o login dela";
  add.addEventListener("click", () => { void adicionarContaClaude(); });
  const limiares = el("div", "conta-claude-limiares");
  const num = (label: string, key: "sessao" | "semanal"): HTMLLabelElement => {
    const l = el("label", "", `${label} `); const i = el("input"); i.type = "number"; i.min = "50"; i.max = "100"; i.step = "1"; i.value = String(v.limiares[key]); i.disabled = contasOcupado;
    i.addEventListener("change", () => { const n = Number(i.value); if (Number.isFinite(n)) void acaoContaClaude(() => window.meuBot.contasClaudeLimiares({ [key]: n })); });
    l.append(i, "%"); return l;
  };
  const sel = el("select"); sel.disabled = contasOcupado;
  for (const [val, txt] of [["ordem", "pela ordem da lista"], ["folga", "quem tem mais cota sobrando"]] as const) { const o = el("option", "", txt); o.value = val; o.selected = v.limiares.estrategia === val; sel.append(o); }
  sel.addEventListener("change", () => { const e = sel.value; if (e === "ordem" || e === "folga") void acaoContaClaude(() => window.meuBot.contasClaudeLimiares({ estrategia: e })); });
  const selLabel = el("label", "", "Qual conta vai primeiro: "); selLabel.append(sel);
  limiares.append(el("span", "hint", "Troca de conta ao passar de"), num("sessão (5 h)", "sessao"), num("semana", "semanal"), selLabel);
  box.append(add, limiares);
  if (contasMsg !== null) box.append(el("p", "hint guide-pair-note", contasMsg));
}

/** Sai da conta do Claude Code nesta máquina; com `relogin`, já leva ao login (tutorial 1 ou modal). */
export async function logoutClaude(relogin: boolean): Promise<void> {
  clLineBtn.disabled = true;
  try { clAuth = await window.meuBot.claudeLogout(); paintClaudeLine(); ctx.paintGuide(); if (relogin) enterClaude(); }
  finally { clLineBtn.disabled = false; }
}

// ---- Linha "xAI (Grok)": OAuth da xAI no Hermes da máquina, que o grok-4 usa. Mesmo molde do Claude: um
// estado (xaiState) pintado nos controles do passo 2 do tutorial 5 (xaiGuide, criados uma vez) e no modal
// #xai-dialog (trocar de conta depois de concluído). O passo 1 (preparar: Hermes + proxy) tem seu bloco.
const xaiLine = $<HTMLDivElement>("xai-line");
const xaiLineText = $<HTMLSpanElement>("xai-line-text");
const xaiLineBtn = $<HTMLButtonElement>("xai-line-btn");
/** Desenha um LoginView (lib/login-steps.ts): passos com estado, código do dispositivo em destaque, detalhes técnicos recolhidos. */
function paintLoginSteps(box: HTMLElement, view: LoginView, show: boolean): void {
  box.hidden = !show;
  box.replaceChildren();
  if (!show) return;
  const ol = el("ol", "login-steps");
  for (const st of view.steps) {
    const li = el("li", `login-step ${st.state}`);
    li.append(el("span", "ls-dot"), el("span", "ls-title", st.title));
    if (st.detail !== null) li.append(el("span", "ls-detail", st.detail));
    ol.append(li);
  }
  box.append(ol);
  if (view.code !== null) {
    const chip = el("div", "login-code");
    const copy = el("button", "btn btn-ghost btn-small", "Copiar"); copy.type = "button";
    copy.addEventListener("click", () => { void navigator.clipboard.writeText(view.code ?? "").then(() => { copy.textContent = "Copiado"; window.setTimeout(() => { copy.textContent = "Copiar"; }, 1500); }); });
    chip.append(el("span", "lc-label", "Código do dispositivo"), el("span", "lc-value", view.code), copy);
    box.append(chip);
  }
  if (view.details.length > 0) {
    const d = el("details", "login-details"); d.append(el("summary", "", "detalhes técnicos"), el("pre", "", view.details.slice(-12).join("\n")));
    box.append(d);
  }
}
const loginViewOf = (provider: LoginProvider, events: readonly ClaudeLoginEvent[], running: boolean): LoginView => loginView(provider, events, { machine: hostLabel(ctx.windowHost), running });

const xaiDialog = $<HTMLDialogElement>("xai-dialog");
const xaiClose = $<HTMLButtonElement>("xai-close");
export let xaiAuth: ClaudeAuthInfo | null = null;
export let xaiKey: XaiKeyStatus | null = null;
const xaiState = { running: false, preparing: false, url: null as string | null, status: "", log: [] as string[], events: [] as ClaudeLoginEvent[], result: null as "ok" | "fail" | null };
const xaiModal: LoginControls = { box: xaiDialog, status: $<HTMLElement>("xai-status"), open: $<HTMLButtonElement>("xai-open"), codeRow: el("div"), code: el("input") as HTMLInputElement, send: el("button") as HTMLButtonElement, log: $<HTMLElement>("xai-steps"), start: $<HTMLButtonElement>("xai-start"), cancel: null };
export const xaiGuide: LoginControls = buildLoginControls();
const XAI_INTRO = (): string => `Máquina: ${hostLabel(ctx.windowHost)}. Abre o link da xAI no navegador, já com o código do dispositivo. Entre na conta e aprove; aqui não precisa colar nada.`;
/** Passo 1 do tutorial 5: preparar (Hermes + proxy). Status, botão e o mesmo log do estado. */
export const xaiPrep = (() => {
  const box = el("div", "guide-login");
  const status = el("p", "hint");
  const start = el("button", "btn btn-primary btn-small", "Preparar"); start.type = "button";
  const actions = el("div", "actions"); actions.append(start);
  const log = el("pre", "log"); log.hidden = true;
  box.append(status, actions, log);
  start.addEventListener("click", () => { void prepareXai(); });
  return { box, status, start, log };
})();

function paintXaiControls(c: LoginControls, variant: "modal" | "guide"): void {
  c.status.textContent = xaiState.status === "" ? XAI_INTRO() : xaiState.status;
  c.open.hidden = xaiState.url === null || xaiState.result === "ok";
  c.codeRow.hidden = true;
  paintLoginSteps(c.log, loginViewOf("xai", xaiState.events, xaiState.running), xaiState.events.length > 0 || xaiState.running);
  c.start.hidden = xaiState.running || xaiState.preparing || xaiState.result === "ok";
  c.start.textContent = xaiState.result === "fail" ? "Tentar de novo" : variant === "guide" ? "Entrar" : "Começar";
  c.start.classList.toggle("pulse", variant === "guide" && !c.start.hidden);
  if (c.cancel !== null) c.cancel.hidden = !xaiState.running;
  if (variant === "modal") xaiClose.textContent = xaiState.running || xaiState.preparing ? "Cancelar" : "Fechar";
}
export function paintXaiLogin(): void {
  paintXaiControls(xaiModal, "modal"); paintXaiControls(xaiGuide, "guide");
  xaiPrep.status.textContent = xaiState.preparing ? xaiState.status : xaiAuth !== null ? "Hermes e proxy prontos nesta máquina." : xaiState.result === "fail" ? xaiState.status : "Instala o Hermes e o proxy da xAI nesta máquina; o backend reinicia no fim.";
  xaiPrep.start.hidden = xaiState.preparing || xaiAuth !== null;
  xaiPrep.start.textContent = xaiState.result === "fail" ? "Tentar de novo" : "Preparar";
  xaiPrep.start.classList.toggle("pulse", !xaiPrep.start.hidden);
  xaiPrep.log.hidden = !xaiState.preparing && xaiState.log.length === 0; xaiPrep.log.textContent = xaiState.log.join("\n");
}

function paintXaiLine(): void {
  if (xaiAuth === null) {
    // Sem Hermes ainda: a linha aparece quando há backend; "entrar" leva ao tutorial 5 (preparar + login).
    if (xaiKey === null || !xaiKey.backend) { xaiLine.hidden = true; return; }
    xaiLine.hidden = false;
    xaiLine.className = "wa-line cl-line off";
    xaiLineText.textContent = "xAI (Grok) · deslogada · o grok-4 não responde";
    xaiLineBtn.textContent = "entrar";
    return;
  }
  xaiLine.hidden = false;
  xaiLine.className = `wa-line cl-line ${xaiAuth.loggedIn ? "on" : "off"}`;
  xaiLineText.textContent = xaiAuth.loggedIn ? `xAI (Grok) · ${xaiAuth.email ?? "logada"}` : "xAI (Grok) · deslogada · o grok-4 não responde";
  xaiLineBtn.textContent = xaiAuth.loggedIn ? "sair" : "entrar";
}
/** Consulta a conta da xAI (e, sem Hermes, se há backend); o tutorial 5 e a lateral seguem o resultado. */
export async function refreshXaiLine(): Promise<void> {
  try { xaiAuth = await window.meuBot.xaiAuth(); } catch { xaiAuth = null; }
  if (xaiAuth === null && ctx.caps.login && ctx.windowHost !== "local") { try { xaiKey = await window.meuBot.xaiKeyStatus(); } catch { xaiKey = null; } }
  paintXaiLine();
  if (ctx.tutorialsReady) { paintXaiLogin(); ctx.paintGuide(); }
}
/** Modal do login da xAI (trocar de conta quando o tutorial 5 já foi concluído). */
function openXai(): void {
  if (!xaiState.running && !xaiState.preparing) { xaiState.status = ""; xaiState.log = []; xaiState.events = []; xaiState.url = null; xaiState.result = null; }
  paintXaiLogin();
  if (!xaiDialog.open) xaiDialog.showModal();
}
/** Máquina sem Hermes: instala Hermes + proxy da xAI (install-grok-oauth.sh). O passo 1 do tutorial 5. */
async function prepareXai(): Promise<void> {
  if (xaiState.running || xaiState.preparing) return;
  xaiState.preparing = true; xaiState.result = null; xaiState.log = [];
  xaiState.status = `Preparando o Grok em ${hostLabel(ctx.windowHost)} (Hermes + proxy local; na primeira vez baixa o Hermes)…`;
  paintXaiLogin();
  try {
    const r = await window.meuBot.xaiPrepare();
    if (!r.ok) { xaiState.status = `✗ ${r.log.at(-1) ?? "não deu para preparar"}`; xaiState.result = "fail"; return; }
    xaiState.preparing = false;
    await refreshXaiLine();
    if (xaiAuth === null) { xaiState.status = "✗ o Hermes foi instalado mas o app ainda não o enxerga; feche e abra a janela desta máquina."; xaiState.result = "fail"; return; }
    xaiState.status = xaiAuth.loggedIn ? "✓ xAI já logada nesta máquina; o grok-4 responde pelo proxy." : "✓ Hermes e proxy prontos. Agora é entrar na conta da xAI.";
  } catch (err) { xaiState.status = `✗ ${ipcErrorText(err)}`; xaiState.result = "fail"; }
  finally { xaiState.preparing = false; paintXaiLogin(); ctx.paintGuide(); }
}
async function runXaiLogin(): Promise<void> {
  if (xaiState.running || xaiState.preparing) return;
  xaiState.running = true; xaiState.result = null; xaiState.url = null; xaiState.log = []; xaiState.events = []; xaiState.status = "";
  paintXaiLogin();
  try { await window.meuBot.xaiLogin(); } catch (err) { xaiState.status = `✗ ${ipcErrorText(err)}`; xaiState.result = "fail"; }
  finally { xaiState.running = false; paintXaiLogin(); }
}
export const XAI_TUTORIAL = TUTORIAIS.find((t) => t.id === "xai-login") as Tutorial;
export const FALLBACK_TUTORIAL = TUTORIAIS.find((t) => t.id === "fallback-contas") as Tutorial;
/**
 * Porta única para "Entrar na xAI": enquanto o tutorial 5 não foi concluído (e o Grok é possível aqui), abre o
 * guia (Preparar ou Entrar pulsando; nada roda sozinho); concluído, é trocar de conta: o modal já com o login.
 */
function enterXai(): void {
  if (ctx.caps.install && !ctx.tutorialDone(XAI_TUTORIAL)) { ctx.tutNext = false; ctx.openGuide(XAI_TUTORIAL); return; }
  openXai(); void runXaiLogin();
}
/** Sai da conta da xAI no Hermes desta máquina; com `relogin`, já leva ao login (tutorial 5 ou modal). */
export async function logoutXai(relogin: boolean): Promise<void> {
  xaiLineBtn.disabled = true;
  try { xaiAuth = await window.meuBot.xaiLogout(); paintXaiLine(); ctx.paintGuide(); if (relogin) enterXai(); }
  finally { xaiLineBtn.disabled = false; }
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
/** Passo "Entrar na conta do Claude" do guia: os controles são os mesmos de sempre (reanexados), o código digitado sobrevive à repintura e o foco volta. */
function renderClaudeLoginPasso(txt: HTMLElement): void {
  const refocus = document.activeElement === clGuide.code;
  const sel: [number, number] = [clGuide.code.selectionStart ?? 0, clGuide.code.selectionEnd ?? 0];
  txt.append(clGuide.box);
  paintLoginControls(clGuide, "guide");
  if (refocus) { clGuide.code.focus(); clGuide.code.setSelectionRange(sel[0], sel[1]); }
}
/** Primário do tutorial 6 → modelo padrão da máquina (Claude = agente, xAI = grok-4). */
const PRIMARY_OF: Record<string, BackendModel> = { claude: "agente", xai: "grok-4" };
/**
 * Passo "Escolher primário e reserva" (tutorial 6): a mesma escolha de Configurações › Fallback, salva na hora
 * (o modelo padrão desta máquina muda), com a linha da corrente e o estado das duas contas.
 */
export function renderFallbackOrder(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const accounts = el("div", "sl-switches");
  const line = (ok: boolean | null, text: string): HTMLElement => el("div", `hint${ok === true ? " ok" : ok === false ? " bad" : ""}`, `${ok === true ? "✓" : ok === false ? "✗" : "•"} ${text}`);
  accounts.append(
    line(ctx.clAuth?.loggedIn ?? null, `Claude Code${ctx.clAuth?.email ? `: ${ctx.clAuth.email}` : ""} → modelo agente`),
    line(ctx.xaiAuth?.loggedIn ?? null, `xAI${ctx.xaiAuth?.email ? `: ${ctx.xaiAuth.email}` : ""} → modelo grok-4`),
  );
  const label = el("label", "", "Primário nesta máquina ");
  const sel = el("select");
  for (const [value, text] of [["claude", "Claude (agente)"], ["xai", "xAI (grok-4)"]] as const) { const o = el("option", "", text); o.value = value; sel.append(o); }
  const cur: string = ctx.settings?.backendModelForHost ?? "";
  if (cur === "grok-4") sel.value = "xai"; else if (cur === "agente") sel.value = "claude"; else { const o = el("option", "", `outro (${cur || "sem modelo"}): fora da corrente`); o.value = "other"; o.disabled = true; sel.append(o); sel.value = "other"; }
  label.append(sel);
  const hint = el("p", "hint", fallbackOrderText(cur, ctx.account?.providers ?? null));
  sel.addEventListener("change", () => {
    const m = PRIMARY_OF[sel.value];
    if (m === undefined) return;
    sel.disabled = true;
    void window.meuBot.setSettings({ backendModelForHost: m }).then((view) => {
      ctx.applySettings(view);
      ctx.saveGuideFlag(FALLBACK_TUTORIAL, "fallbackChosen"); ctx.paintGuide();
    }).catch((err: unknown) => { hint.textContent = `✗ ${ipcErrorText(err)}`; }).finally(() => { sel.disabled = false; });
  });
  const keep = el("button", "btn btn-small", "Manter assim"); keep.type = "button";
  keep.title = "A escolha atual já serve: o primário fica como está";
  keep.hidden = !FALLBACK_PRIMARIES.includes(cur) || ctx.loadGuideFlags(FALLBACK_TUTORIAL).fallbackChosen;
  keep.addEventListener("click", () => { ctx.saveGuideFlag(FALLBACK_TUTORIAL, "fallbackChosen"); ctx.paintGuide(); });
  box.append(accounts, label, hint, keep);
  container.append(box);
}
/** Alguma conversa desta máquina já teve resposta do agente (o index só tem conversas do windowHost): tutorial 1, passo 3. */
export const firstReplyOnHost = (): boolean => [...ctx.index.values()].some((c) => c.messages.some((m) => m.role === "assistant"));
export function ligarContasAgente(): void {
  registrarFonte("claude", () => ({ known: clAuth !== null, dados: { claude: { loggedIn: clAuth?.loggedIn ?? null, email: clAuth?.email ?? null, global: clAuth?.global === true, firstReply: firstReplyOnHost(), contasExtras: (contasClaudeView()?.contas ?? []).filter((c) => !c.padrao && c.global !== true && c.logada).length, trocas: (contasClaudeView()?.eventos ?? []).length } } }));
  registrarFonte("xai", () => ({
    known: !ehRemoto() || xaiAuth !== null || xaiKey !== null,
    dados: { xai: { possible: !ctx.caps.install || ctx.windowHost === "local" ? false : xaiAuth !== null ? true : xaiKey === null ? null : xaiKey.backend, hermes: xaiAuth !== null ? true : xaiKey === null ? null : false, loggedIn: xaiAuth?.loggedIn ?? null, label: xaiAuth?.email ?? null } },
  }));
  registrarFonte("fallback", () => ({ known: ctx.account !== null, dados: { fallback: { primary: ctx.settings?.backendModelForHost ?? null, chain: ctx.account?.providers ?? null } } }));
  registrarPassos({
    "contas-claude": (txt) => renderContasClaude(txt),
    "claude-login": renderClaudeLoginPasso,
    "xai-prepare": (txt) => { txt.append(xaiPrep.box); paintXaiLogin(); },
    "xai-login": (txt) => { txt.append(xaiGuide.box); paintXaiLogin(); },
    "fallback-order": (txt) => renderFallbackOrder(txt),
  });
  wireLogin(clModal);
   wireLogin(clGuide);
  window.meuBot.on("claude-login:event", (ev: ClaudeLoginEvent) => {
    const appendLog = (t: string): void => { clState.log = [...clState.log, t].slice(-8); };
    switch (ev.kind) {
      case "url": clState.url = ev.url; clState.status = "Abri o link no navegador. Entre na conta e copie o código que a página mostra."; appendLog("▸ link aberto no navegador"); break;
      case "waiting-code": {
        clState.needCode = true; clState.status = "Cole o código da página e clique em Enviar código.";
        paintClaudeLogin();
        // Foco no campo que está à vista: o do guia (aba do tutorial 1 aberta) ou o do modal.
        const guideOpen = ctx.pageActive !== null && ctx.pageActive.id === `tut-${CLAUDE_TUTORIAL.id}`;
        if (guideOpen) clGuide.code.focus(); else if (clDialog.open) clModal.code.focus();
        break;
      }
      case "log": appendLog(ev.text); break;
      case "done":
        clState.result = ev.ok ? "ok" : "fail"; clState.needCode = false;
        clState.status = ev.ok ? `✓ ${ev.text}` : `✗ ${ev.text}`;
        appendLog(ev.ok ? "✓ logado" : "não concluiu");
        if (ev.ok) {
          const tab = ctx.active();
          if (tab !== null) ctx.addNotice(tab, "✓ Claude Code logado nesta máquina. Pode mandar a próxima mensagem.", "info");
          void window.meuBot.getAccountStatus().then((s) => { ctx.account = s; ctx.paintContext(ctx.active()); ctx.paintGuide(); });
          clAuth = { loggedIn: true, email: clAuth?.email ?? null }; paintClaudeLine(); ctx.paintGuide(); // otimista: o ✓ do passo 1 não espera o SSH
          void refreshClaudeLine();
          void refreshContasClaude();
          // Deu certo: o modal se fecha sozinho; o aviso fica na conversa.
          setTimeout(() => { if (clDialog.open) clDialog.close(); }, 1200);
        }
        break;
    }
    paintClaudeLogin();
  });
  clClose.addEventListener("click", () => { if (clState.running) void window.meuBot.claudeLoginCancel(); clDialog.close(); });
  window.meuBot.on("ui:claude-login", () => enterClaude());
  // Clique na linha (fora do botão) abre o tutorial da conta, como a linha do WhatsApp: o das contas (15) quando já
  // logado e ele está na trilha; senão o 1, "Entrar no Claude Code".
  clLine.addEventListener("click", () => {
    const quer = clAuth?.loggedIn === true && ctx.visibleNow().some((t) => t.id === "contas-claude") ? "contas-claude" : "claude-login";
    const t = TUTORIAIS.find((x) => x.id === quer) ?? TUTORIAIS.find((x) => x.id === "claude-login");
    if (t !== undefined) ctx.openGuide(t);
  });
  clLineBtn.addEventListener("click", (ev) => {
    ev.stopPropagation(); // o botão sair/entrar não abre o guia
    if (clAuth !== null && clAuth.loggedIn) {
      if (!window.confirm(`Sair da conta ${clAuth.email ?? "do Claude Code"} nesta máquina? O agente para de responder pelo Claude até entrar de novo${xaiAuth?.loggedIn === true ? " (o grok-4 continua)" : ""}.`)) return;
      void logoutClaude(true);
      return;
    }
    enterClaude();
  });
  // No guia, o log cru vira a caixa de passos (lib/login-steps.ts), como no modal.
  { const steps = el("div", "login-steps-box"); steps.hidden = true; xaiGuide.log.replaceWith(steps); xaiGuide.log = steps; }
  window.meuBot.on("xai-login:event", (ev: ClaudeLoginEvent) => {
    const appendLog = (t: string): void => { xaiState.log = [...xaiState.log, t].slice(-8); };
    // Preparando (Hermes + proxy), as linhas são do instalador e vão para o log do passo 1; no login viram passos.
    if (!xaiState.preparing) { xaiState.events = [...xaiState.events, ev].slice(-60); if (ev.kind !== "done") xaiState.status = loginViewOf("xai", xaiState.events, true).headline; }
    switch (ev.kind) {
      case "url": xaiState.url = ev.url; break;
      case "waiting-code": break;
      case "log": if (xaiState.preparing) appendLog(ev.text); break;
      case "done":
        // O prepare também manda `log`; `done` é só do login.
        xaiState.result = ev.ok ? "ok" : "fail";
        xaiState.status = ev.ok ? `✓ ${ev.text}` : `✗ ${ev.text}`;
        if (ev.ok) {
          // Verde na hora, com o rótulo que veio no texto; a consulta de confirmação roda em segundo plano.
          xaiAuth = { loggedIn: true, email: /\(([^)]+)\)/.exec(ev.text)?.[1] ?? xaiAuth?.email ?? null };
          paintXaiLine(); ctx.paintGuide();
          const tab = ctx.active(); if (tab !== null) ctx.addNotice(tab, "✓ xAI logada no Hermes desta máquina; o grok-4 já usa a conta nova.", "info");
          void refreshXaiLine();
          setTimeout(() => { if (xaiDialog.open) xaiDialog.close(); }, 1200);
        }
        break;
    }
    paintXaiLogin();
  });
  for (const c of [xaiModal, xaiGuide]) {
    c.start.addEventListener("click", () => { void runXaiLogin(); });
    c.open.addEventListener("click", () => { if (xaiState.url !== null) void window.meuBot.openExternal(xaiState.url); });
    if (c.cancel !== null) c.cancel.addEventListener("click", () => { if (xaiState.running) void window.meuBot.xaiLoginCancel(); });
  }
  xaiClose.addEventListener("click", () => { if (xaiState.running) void window.meuBot.xaiLoginCancel(); xaiDialog.close(); });
  xaiLineBtn.addEventListener("click", () => {
    if (xaiAuth !== null && xaiAuth.loggedIn) {
      if (!window.confirm("Sair da conta da xAI no Hermes desta máquina? O grok-4 para de responder até entrar de novo.")) return;
      void logoutXai(true);
      return;
    }
    enterXai();
  });
}
