/** Seletor de máquinas: lista imediata, sondagens em paralelo, teclado completo. */
import type { ContaView, HostProbe, PickerApi, PickerInit, SshSyncResult, SupportPerson, PlanName } from "../shared/ipc";
import { hostAccent } from "./lib/host-color.js";
import { el } from "./lib/dom.js";
import { montarMenuConta } from "./lib/conta-menu.js";
import { resumoPlano } from "./lib/conta-resumo.js";
import { ESTE_MAC_MAQUINA, maquinasParaAdotar, personSuffix } from "./lib/admin-view.js";
import { mountAdminPickerChrome } from "./admin/picker-chrome.js";
import { ipcErrorText } from "./lib/ipc-error.js";
import { describeProbe, enderecoLabel, hostLabel, setApelidoMaquina, setHostNicknames, type ProbeText } from "./lib/probe-text.js";

declare global { interface Window { picker: PickerApi } }

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const listEl = $<HTMLUListElement>("pk-list");
const filterEl = $<HTMLInputElement>("pk-filter");
const errorEl = $<HTMLParagraphElement>("pk-error");
const detailEl = $<HTMLElement>("pk-detail");
const statusEl = $<HTMLParagraphElement>("pk-status");
const installBtn = $<HTMLButtonElement>("pk-install");
const reliefShortcutBtn = $<HTMLButtonElement>("pk-relief-shortcut");
const removeBtn = $<HTMLButtonElement>("pk-remove");
const renameBtn = $<HTMLButtonElement>("pk-rename");
const archiveBtn = $<HTMLButtonElement>("pk-archive");
const removePersonBtn = $<HTMLButtonElement>("pk-remove-person");
const grokbotResetBtn = $<HTMLButtonElement>("pk-grokbot-reset");
const tailscaleBtn = $<HTMLButtonElement>("pk-tailscale");
const tailscaleOffBtn = $<HTMLButtonElement>("pk-tailscale-off");
const claudeLoginBtn = $<HTMLButtonElement>("pk-claude-login");
const modoGratisBtn = $<HTMLButtonElement>("pk-modo-gratis");
const tsForm = $<HTMLDivElement>("pk-ts-form");
const tsId = $<HTMLInputElement>("pk-ts-id");
const tsSecret = $<HTMLInputElement>("pk-ts-secret");
const tsSave = $<HTMLButtonElement>("pk-ts-save");
const tsCancel = $<HTMLButtonElement>("pk-ts-cancel");
const tsForget = $<HTMLButtonElement>("pk-ts-forget");
const tsOpen = $<HTMLButtonElement>("pk-ts-open");
const needsCheck = new Set<string>();
const logEl = $<HTMLPreElement>("pk-log");
const noteEl = $<HTMLParagraphElement>("pk-note");
const openBtn = $<HTMLButtonElement>("pk-open");
const glowEl = $<HTMLDivElement>("pk-glow");
const logoEl = document.getElementById("pk-logo") as unknown as SVGSVGElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let firstInit = true;

/**
 * Chegada (shot "particle-news-splash"), só na primeira abertura da sessão: o logo nasce grande no centro da janela e
 * encolhe subindo até a casa dele no cabeçalho (FLIP: medimos a casa e transformamos a partir dela), enquanto o brilho de
 * cor acende e título, filtro, máquinas e rodapé chegam em sequência. Sem chegada: só tira o `pre` e tudo aparece de vez.
 */
function arrive(animate: boolean): void {
  const body = document.body;
  if (!animate || reducedMotion) { body.classList.remove("pre"); return; }
  const r = logoEl.getBoundingClientRect();
  logoEl.style.setProperty("--dx", `${window.innerWidth / 2 - (r.left + r.width / 2)}px`);
  logoEl.style.setProperty("--dy", `${window.innerHeight * 0.42 - (r.top + r.height / 2)}px`);
  body.classList.add("arriving"); body.classList.remove("pre");
  // Dois frames: o navegador precisa pintar o logo no centro antes de transicioná-lo para casa.
  requestAnimationFrame(() => requestAnimationFrame(() => { body.classList.remove("arriving"); body.classList.add("arrive"); }));
  setTimeout(() => body.classList.remove("arrive"), 900); // linhas criadas depois (sincronizar ssh) não repetem a entrada
}

/** Brilho atrás do cabeçalho: a cor da máquina em foco e a de uma vizinha. */
function paintGlow(primary: string): void {
  glowEl.style.setProperty("--g1", accentOf(primary));
  glowEl.style.setProperty("--g2", accentOf(hosts.find((h) => h !== primary) ?? primary));
  glowEl.classList.add("on");
}
const cancelBtn = $<HTMLButtonElement>("pk-cancel");
const syncBtn = $<HTMLButtonElement>("pk-sync");
const directCheck = $<HTMLInputElement>("pk-direct");
const onboardedCheck = $<HTMLInputElement>("pk-onboarded");
const instaBtn = $<HTMLButtonElement>("pk-insta");
/** O ✨ colado no Intro: aceso = modo instagramável ligado (aria-pressed). */
const pintarInsta = (on: boolean): void => { instaBtn.classList.toggle("on", on); instaBtn.setAttribute("aria-pressed", String(on)); };

interface Row { host: string; li: HTMLLIElement; badgeEl: HTMLSpanElement; shortcutBtn: HTMLButtonElement; relieveBtn: HTMLButtonElement }
let shortcuts = new Map<string, string | null>();
let reliefShortcuts = new Set<string>();
/** Atalhos na mesa (caps.atalhosMesa, do main): sem ela, o botão de cada linha e o do alívio na mesa ficam escondidos. */
let atalhosMesa = true;
let pods = new Set<string>();

let hosts: string[] = [];
let enderecos: PickerInit["enderecos"] = {};
/** meu-bot-admin: as pessoas do suporte (null = meu-bot normal). */
let support: PickerInit["support"] = null;
/**
 * Plano por host (lido por SSH), para o selo "PRO"; vale nos dois apps. Começa com o último plano conhecido (guardado
 * neste Mac): o selo aparece na hora, como no admin, e a leitura por SSH só confirma ou corrige.
 */
const PLANS_KEY = "picker:plans";
const plans = new Map<string, PlanName>((() => {
  try { const v = JSON.parse(localStorage.getItem(PLANS_KEY) ?? "{}") as Record<string, unknown>; return Object.entries(v).filter((e): e is [string, PlanName] => e[1] === "pro" || e[1] === "free"); } catch { return []; }
})());
const guardarPlans = (): void => { try { localStorage.setItem(PLANS_KEY, JSON.stringify(Object.fromEntries(plans))); } catch { /* opcional */ } };
const personOf = (host: string): SupportPerson | undefined => support?.people.find((p) => p.alias === host);
/** O que a lista diz quando não há máquina nenhuma para escolher. */
const SEM_MAQUINAS_TEXT = "Nenhuma máquina ainda. Este app conecta numa máquina remota por SSH: adicione a sua ao arquivo config da pasta .ssh do seu usuário e abra o meu-bot de novo.";
/** Nome na lista: a pessoa (admin) ou a máquina. */
const rowLabel = (host: string): string => personOf(host)?.name ?? hostLabel(host);
let openHosts = new Set<string>();
let selected: string | null = null;
const rows = new Map<string, Row>();
const results = new Map<string, ProbeText>();
let installing = false;



function showError(prefix: string, err: unknown): void {
  errorEl.hidden = false;
  errorEl.textContent = `${prefix}: ${ipcErrorText(err)}`;
}

/** Cor da máquina: no admin, pela máquina como a pessoa a chama no ~/.ssh dela (a mesma cor que ela vê); sem isso, pelo host. */
const accentOf = (host: string): string => hostAccent(personOf(host)?.machine ?? host);

/**
 * Depois do nome, menor: o nome SSH quando há apelido (é por ele que se entra) e o endereço do ~/.ssh/config (IP ou
 * DNS, e o usuário se o alias não o diz). Duas máquinas com o mesmo apelido se distinguem pelo endereço.
 */
function pintarNomeSsh(host: string, nameEl: HTMLElement): void {
  nameEl.querySelector(".ssh-nome")?.remove();
  nameEl.querySelector(".endereco")?.remove();
  if (personOf(host) !== undefined || host === "local") return;
  const endereco = enderecoLabel(host, enderecos[host]);
  if (endereco !== "") nameEl.firstChild?.after(el("span", "seen endereco", endereco));
  if (rowLabel(host) !== host) nameEl.firstChild?.after(el("span", "seen ssh-nome", ` · ${host}`));
}

function buildRows(): void {
  listEl.replaceChildren();
  rows.clear();
  for (const host of hosts) {
    const li = el("li", "row");
    li.setAttribute("role", "option");
    const dot = el("span", "dot");
    dot.style.background = accentOf(host);
    const name = el("span", "name", rowLabel(host));
    pintarNomeSsh(host, name);
    const person = personOf(host);
    { const plan = person?.plan ?? plans.get(host) ?? null; if (plan === "pro") name.append(el("span", "badge pro", "PRO")); }
    if (person !== undefined) name.append(el("span", "seen", personSuffix(person)));
    const badge = el("span", "badge open", "janela aberta");
    badge.hidden = !openHosts.has(host);
    // Só num computador do Grok Bot: aliviar agora (abre a janela de alívio e fecha o seletor).
    const relieveBtn = el("button", "relieve", "🧯");
    relieveBtn.type = "button";
    relieveBtn.title = `Aliviar ${host} agora: limpa processos presos no pod e reinicia o Tailscale`;
    relieveBtn.setAttribute("aria-label", `aliviar ${host} agora`);
    relieveBtn.addEventListener("click", (ev) => { ev.stopPropagation(); void relieve(host, relieveBtn); });
    const shortcutBtn = el("button", "shortcut");
    shortcutBtn.type = "button";
    shortcutBtn.hidden = !atalhosMesa;
    shortcutBtn.addEventListener("click", (ev) => { ev.stopPropagation(); void toggleShortcut(host, shortcutBtn); });
    li.append(dot, name, badge, relieveBtn, shortcutBtn);
    li.addEventListener("click", () => select(host));
    li.addEventListener("dblclick", () => { select(host); void open(); });
    li.style.setProperty("--i", String(rows.size)); // ordem, para a chegada escalonar as linhas
    listEl.appendChild(li);
    rows.set(host, { host, li, badgeEl: badge, shortcutBtn, relieveBtn });
    paintShortcut(host);
    paintPod(host);
  }
  applyFilter();
}

function paintPod(host: string): void {
  const r = rows.get(host);
  if (r !== undefined) r.relieveBtn.hidden = !pods.has(host);
  if (host === selected) paintDetail();
}

function paintShortcut(host: string): void {
  const btn = rows.get(host)?.shortcutBtn;
  if (btn === undefined) return;
  const has = shortcuts.has(host);
  const emoji = shortcuts.get(host) ?? null;
  btn.textContent = has ? (emoji ?? "★") : "+";
  btn.classList.toggle("on", has);
  btn.setAttribute("aria-label", has ? "remover atalho da área de trabalho" : "criar atalho na área de trabalho");
  btn.title = has ? `Remover "${host}.app" da área de trabalho` : `Criar "${host}.app" na área de trabalho, que abre direto a janela de ${hostLabel(host)}`;
}

async function toggleShortcut(host: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  try {
    const r = await window.picker.setShortcut(host, !shortcuts.has(host));
    if (r.has) shortcuts.set(host, r.emoji); else shortcuts.delete(host);
    errorEl.hidden = true;
  } catch (err) {
    showError("Atalho", err);
  } finally {
    btn.disabled = false;
    paintShortcut(host);
  }
}

async function toggleReliefShortcut(): Promise<void> {
  if (selected === null || !pods.has(selected)) return;
  const host = selected;
  reliefShortcutBtn.disabled = true;
  try {
    const r = await window.picker.setReliefShortcut(host, !reliefShortcuts.has(host));
    if (r.has) reliefShortcuts.add(host); else reliefShortcuts.delete(host);
    errorEl.hidden = true;
  } catch (err) {
    showError("Botão de alívio", err);
  } finally {
    reliefShortcutBtn.disabled = false;
    paintDetail();
  }
}

async function relieve(host: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  try {
    await window.picker.relieve(host);
  } catch (err) {
    showError("Alívio", err);
    btn.disabled = false;
  }
}

/** meu-bot-admin: pessoas arquivadas só aparecem com o interruptor "arquivadas" ligado. */
let showArchivedPeople = false;

/**
 * Abas por tipo de máquina (Usuário · Root · Grok Bot · Este Mac), no admin e no app de cada um. Este Mac = a própria máquina e
 * conexões locais (VM de teste); Grok Bot = pod reconhecido pela sondagem; Root = entra como root; o resto, Usuário.
 * O tipo visto fica guardado neste Mac: a máquina não pula de aba enquanto a sondagem responde.
 */
type Tipo = "pessoa" | "root" | "grok" | "mac";
const TIPOS_KEY = "picker:tipos";
const tiposEl = $<HTMLDivElement>("pk-tipos");
const tiposVistos = new Map<string, Tipo>((() => {
  try { const v = JSON.parse(localStorage.getItem(TIPOS_KEY) ?? "{}") as Record<string, unknown>; return Object.entries(v).filter((e): e is [string, Tipo] => e[1] === "pessoa" || e[1] === "root" || e[1] === "grok" || e[1] === "mac"); } catch { return []; }
})());
let tipoAtivo: Tipo = (() => { try { const t = localStorage.getItem("picker:tipo-aba"); return t === "root" || t === "grok" || t === "mac" ? t : "pessoa"; } catch { return "pessoa"; } })();
/** Máquinas que o main reconheceu como este Mac por SSH (127.0.0.1: a VM da Colima). */
const locais = new Set<string>();
/** Computador do Grok Bot pelo nome (grokbot-1, grokbot-3…): vale antes de a sondagem responder, ou com ele fora do ar. */
const nomeDeGrok = (h: string): boolean => /^grokbot\b|^grokbot-/i.test(h) || /^grokbot\b|^grokbot-/i.test(hostLabel(h));
function tipoDe(h: string): Tipo {
  if (h === "local" || personOf(h)?.local === true || locais.has(h)) return "mac";
  if (pods.has(h) || nomeDeGrok(h)) return "grok";
  return tiposVistos.get(h) ?? "pessoa";
}
function anotarTipo(h: string, user: string | null): void {
  const t: Tipo = h === "local" || personOf(h)?.local === true || locais.has(h) ? "mac" : pods.has(h) || nomeDeGrok(h) ? "grok" : user === "root" ? "root" : "pessoa";
  if (tiposVistos.get(h) === t) return;
  tiposVistos.set(h, t);
  try { localStorage.setItem(TIPOS_KEY, JSON.stringify(Object.fromEntries(tiposVistos))); } catch { /* opcional */ }
  pintarTipos(); applyFilter();
}
/**
 * Só as abas que têm máquina: sem root, sem pod ou sem este Mac, a aba some; com um tipo só, a barra inteira some e a
 * lista mostra tudo. A aba escolhida que ficou vazia cede para a primeira que tem máquina.
 */
let tiposComMaquina: Tipo[] = [];
function pintarTipos(): void {
  const base = hosts.filter((h) => showArchivedPeople || personOf(h)?.archived !== true);
  const conta = (t: Tipo): number => base.filter((h) => tipoDe(h) === t).length;
  tiposComMaquina = (["pessoa", "root", "grok", "mac"] as Tipo[]).filter((t) => conta(t) > 0);
  tiposEl.hidden = tiposComMaquina.length < 2;
  if (tiposEl.hidden) return;
  if (!tiposComMaquina.includes(tipoAtivo)) tipoAtivo = tiposComMaquina[0] ?? "pessoa";
  for (const b of tiposEl.querySelectorAll<HTMLButtonElement>("button")) {
    const t = b.dataset["tipo"] as Tipo;
    const n = conta(t);
    b.hidden = n === 0;
    b.classList.toggle("on", t === tipoAtivo);
    b.setAttribute("aria-selected", String(t === tipoAtivo));
    // A primeira aba: máquinas em que se entra com usuário comum (o par de "Root").
    b.dataset["rotulo"] = t === "pessoa" ? "Usuário" : (b.dataset["rotulo"] ?? b.textContent ?? "");
    b.replaceChildren(b.dataset["rotulo"], ...(n > 0 ? [el("span", "n", String(n))] : []));
  }
}
tiposEl.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-tipo]");
  if (b === null) return;
  tipoAtivo = b.dataset["tipo"] as Tipo;
  try { localStorage.setItem("picker:tipo-aba", tipoAtivo); } catch { /* opcional */ }
  pintarTipos(); applyFilter();
});

function visibleHosts(): string[] {
  const q = filterEl.value.trim().toLowerCase();
  const porTipo = q === "" && tiposComMaquina.length >= 2;
  return hosts.filter((h) => (showArchivedPeople || personOf(h)?.archived !== true) && (!porTipo || tipoDe(h) === tipoAtivo) && (q === "" || h.toLowerCase().includes(q) || rowLabel(h).toLowerCase().includes(q) || (enderecos[h]?.hostName ?? "").toLowerCase().includes(q)));
}

function applyFilter(): void {
  const vis = new Set(visibleHosts());
  for (const r of rows.values()) r.li.hidden = !vis.has(r.host);
  if (selected !== null && !vis.has(selected)) select(visibleHosts()[0] ?? null);
}

/** O estado só aparece na caixa de baixo, para a máquina selecionada. */
function paintState(host: string): void {
  if (host === selected) paintDetail();
}

function paintDetail(): void {
  if (selected === null) { detailEl.hidden = true; openBtn.disabled = true; return; }
  detailEl.hidden = false;
  const t = results.get(selected);
  installBtn.hidden = true;
  removeBtn.hidden = selected === "local" || support !== null;
  renameBtn.hidden = selected === "local";
  renameBtn.title = support !== null ? "Apelido para esta pessoa no admin (vazio volta ao nome que ela deu). O alias não muda." : "Apelido desta máquina no app (seletor, título da janela). A chave SSH não muda.";
  archiveBtn.hidden = support === null || selected === "local";
  archiveBtn.textContent = personOf(selected)?.archived === true ? "Desarquivar" : "Arquivar";
  removePersonBtn.hidden = support === null || selected === "local";
  if (removePersonBtn.dataset["host"] !== selected) resetRemovePerson();
  if (renameBtn.hidden) renameForm.hidden = true;
  const isPod = pods.has(selected);
  reliefShortcutBtn.hidden = !isPod || !atalhosMesa;
  // Pod inacessível: o alívio não alcança; o que resolve é o reset pelo app do Grok Bot.
  grokbotResetBtn.hidden = !(isPod && t !== undefined && t.kind === "bad");
  tailscaleBtn.hidden = !needsCheck.has(selected);
  tailscaleOffBtn.hidden = !needsCheck.has(selected);
  if (tailscaleOffBtn.hidden) tsForm.hidden = true;
  if (isPod) {
    const has = reliefShortcuts.has(selected);
    reliefShortcutBtn.textContent = has ? "🧯 Tirar o botão de alívio da mesa" : "🧯 Botão de alívio na mesa";
    reliefShortcutBtn.title = has ? `Remover "aliviar ${selected}.app" da área de trabalho` : `Criar "aliviar ${selected}.app" na área de trabalho: um clique limpa o pod e abre a janela`;
  }
  if (t === undefined) {
    statusEl.className = "status";
    statusEl.textContent = `verificando ${hostLabel(selected)}…`;
    openBtn.disabled = true;
    claudeLoginBtn.hidden = true;
    modoGratisBtn.hidden = true;
    return;
  }
  statusEl.className = `status ${t.kind}`;
  statusEl.textContent = t.text;
  openBtn.disabled = !t.canOpen || installing;
  claudeLoginBtn.hidden = t.login !== true;
  modoGratisBtn.hidden = t.gratis !== true;
  if (t.install !== null && !installing) {
    installBtn.textContent = t.install === "reinstall" ? "Reinstalar backend" : t.install === "statusline" ? "Instalar status line" : t.install === "transcricao" ? "Ativar transcrição de áudio" : t.install === "guarda" ? "Ativar guarda do WhatsApp" : t.install === "claude" ? "Instalar Claude Code" : t.install === "porta" ? `Usar porta ${t.port ?? "?"}` : t.port !== undefined ? `Instalar backend na porta ${t.port}` : "Instalar backend";
    installBtn.hidden = false;
  }
}

function select(host: string | null): void {
  selected = host;
  if (host !== null) glowEl.style.setProperty("--g1", accentOf(host)); // o brilho acompanha a máquina em foco
  for (const r of rows.values()) r.li.classList.toggle("selected", r.host === host);
  if (host !== null) rows.get(host)?.li.scrollIntoView({ block: "nearest" });
  logEl.hidden = true;
  paintDetail();
}

/** Máquinas cuja porta a sondagem já ajustou sozinha nesta sessão (uma vez só: se não resolver, fica o botão). */
const portaAdotada = new Set<string>();
/** Hosts que a última sondagem não alcançou: "Excluir máquina" não perde tempo tentando limpar o WhatsApp lá. */
const foraDoAr = new Set<string>();

async function probe(host: string, force = false): Promise<void> {
  if (!force && results.has(host)) return;
  results.delete(host);
  paintState(host);
  try {
    const p: HostProbe = await window.picker.probe(host);
    // "este Mac" no admin (o Mac do próprio admin como pessoa): o backend é o dos apps meu-bot, não o das VMs que a
    // sondagem procura; o "sem o backend do meu-bot" seria falso. Entrou por SSH: está tudo certo para o suporte.
    const t0 = describeProbe(p);
    const t = personOf(host)?.machine === ESTE_MAC_MAQUINA && p.reachable
      ? { ...t0, kind: "ok" as const, text: `✓ este Mac · entra por SSH · ${p.claudeLoggedIn ? "Claude Code logado" : "Claude Code deslogado"} · o backend é o de cada app meu-bot (sobe quando o app abre)`, canOpen: true }
      : t0;
    // O backend desta conta está em outra porta (outra conta da máquina tem a do app): a sondagem leu a porta no
    // .env do próprio backend, então é a certa. Grava só para esta máquina e sonda de novo, sem pedir o clique.
    if (t.install === "porta" && t.port !== undefined && !portaAdotada.has(host)) {
      portaAdotada.add(host);
      await window.picker.usePort(host, t.port);
      return probe(host, true);
    }
    // Admin não instala nem faz login na máquina da pessoa: só a sondagem. "Usar porta N" fica: é configuração deste Mac.
    results.set(host, support !== null ? { ...t, install: t.install === "porta" ? "porta" : null, login: false } : t);
    if (p.reachable) foraDoAr.delete(host); else foraDoAr.add(host);
    if (p.tailscaleCheck) needsCheck.add(host); else needsCheck.delete(host);
    if (p.reachable) { if (p.grokPod) pods.add(host); else pods.delete(host); paintPod(host); anotarTipo(host, p.user); }
    // Apelido gravado na máquina (o admin dá na aba Usuários): aparece no lugar do nome SSH, se este Mac não deu um seu.
    if (p.reachable && setApelidoMaquina(host, p.apelido)) {
      const nameEl = rows.get(host)?.li.querySelector<HTMLElement>(".name") ?? null;
      if (nameEl !== null && nameEl.firstChild?.nodeType === Node.TEXT_NODE) { nameEl.firstChild.textContent = rowLabel(host); pintarNomeSsh(host, nameEl); }
    }
  } catch (err) {
    results.set(host, { kind: "bad", text: `✗ ${hostLabel(host)}: ${ipcErrorText(err)}`, install: null, canOpen: false });
    foraDoAr.add(host);
  }
  paintState(host);
}

async function open(): Promise<void> {
  if (selected === null || openBtn.disabled) return;
  openBtn.disabled = true;
  // Commit (shot "opal-hold-to-commit"): preenche da esquerda para a direita e fecha em branco com ✓ enquanto a janela abre.
  if (!reducedMotion) {
    const label = openBtn.querySelector("span");
    openBtn.classList.add("committing"); if (label !== null) label.textContent = "Abrindo…";
    await new Promise((r) => setTimeout(r, 340));
    openBtn.classList.add("committed"); if (label !== null) label.textContent = "✓ Abrindo";
    await new Promise((r) => setTimeout(r, 120));
  }
  await window.picker.choose(selected);
}

async function install(): Promise<void> {
  if (selected === null || installing) return;
  const host = selected;
  // O mesmo botão instala o backend ou a status line, conforme o que a sondagem pediu.
  const current = results.get(host);
  const what = current?.install ?? "install";
  const port = current?.port;
  // Opcionais (status line, transcrição): falhar não impede abrir, o backend continua de pé.
  const statusLine = what === "statusline" || what === "transcricao" || what === "guarda";
  installing = true;
  installBtn.hidden = true;
  logEl.hidden = false;
  logEl.textContent = "";
  statusEl.className = "status";
  statusEl.textContent = what === "statusline" ? `instalando a status line em ${hostLabel(host)}…`
    : what === "transcricao" ? `ativando a transcrição de áudio em ${hostLabel(host)}… (na primeira vez baixa ~500 MB)`
    : what === "guarda" ? `ativando a guarda do WhatsApp em ${hostLabel(host)}… (plugin no OpenClaw; sem reiniciar)`
    : what === "claude" ? `instalando o Claude Code em ${hostLabel(host)}… (instalador oficial, em ~/.local/bin)`
    : what === "porta" ? `ajustando ${hostLabel(host)} para a porta ${port ?? "?"}…`
    : `instalando o backend em ${hostLabel(host)}${port !== undefined ? ` na porta ${port}` : ""}… (pode levar alguns minutos)`;
  openBtn.disabled = true;
  const failed = (why: string): void => { results.set(host, { kind: "bad", text: `✗ ${what === "porta" ? "ajuste da porta" : "instalação"} falhou: ${why}`, install: what, canOpen: statusLine, ...(port !== undefined ? { port } : {}) }); paintState(host); };
  try {
    if (what === "porta") {
      if (port === undefined) { failed("a sondagem não disse a porta do backend"); return; }
      await window.picker.usePort(host, port);
    } else {
      const r = what === "statusline" ? await window.picker.installStatusLine(host)
        : what === "transcricao" ? await window.picker.installTranscription(host)
        : what === "claude" ? await window.picker.installClaude(host)
        : what === "guarda" ? await window.picker.installGuarda(host)
        : await window.picker.install(host);
      if (!r.ok) { failed(r.log.at(-1) ?? "sem detalhes"); return; }
    }
  } catch (err) {
    failed(ipcErrorText(err));
    return;
  } finally {
    installing = false;
  }
  await probe(host, true);
}

function syncSummary(r: SshSyncResult): { kind: "ok" | "warn"; text: string } {
  const lines: string[] = [];
  if (r.added.length === 0 && r.includesAdded === 0) lines.push("✓ ~/.ssh/config já tinha todas as máquinas do projeto; nada mudou.");
  else lines.push(`✓ entraram no ~/.ssh/config: ${[...r.added, ...(r.includesAdded > 0 ? [`${r.includesAdded} Include`] : [])].join(", ")}${r.backup !== null ? ` (backup em ${r.backup.replace(/^.*\//, "")})` : ""}.`);
  if (r.kept.length > 0) lines.push(`mantidas como estavam: ${r.kept.join(", ")}.`);
  if (r.onlyLocal.length > 0) lines.push(`só neste Mac (o projeto não conhece): ${r.onlyLocal.join(", ")}.`);
  if (r.sameTarget.length > 0) lines.push(`já existem com outro nome: ${r.sameTarget.map((x) => `${x.alias} = ${x.as}`).join(", ")}.`);
  if (r.skipped.length > 0) lines.push(`removidas por você, não voltam: ${r.skipped.join(", ")}.`);
  let kind: "ok" | "warn" = "ok";
  if (r.missingKeys.length > 0) {
    kind = "warn";
    lines.push(`⚠ falta a chave ${r.missingKeys.map((k) => k.replace(/^.*\/\.ssh\//, "~/.ssh/")).join(", ")} neste Mac: copie do outro Mac, ou gere uma nova e coloque a .pub no authorized_keys de cada máquina (PLAYBOOK, seção 1).`);
  }
  lines.push("O Cursor (Remote SSH) lê o mesmo arquivo (ou um que ele inclui), então as máquinas aparecem lá também.");
  if (support !== null) lines.push("Pessoas do suporte não passam por aqui: o endereço delas vem do código que a pessoa manda. Máquina que mudou de IP ou foi reinstalada: \"Adicionar pessoa\" com o código novo ou com \"ssh <host>\", e \"Excluir máquina\" na antiga.");
  return { kind, text: lines.join("\n") };
}

/**
 * No admin a lista é de pessoas: toda máquina que o meu-bot mostraria neste Mac (o ~/.ssh/config inteiro, Includes
 * dentro, mais o que o sync acabou de acrescentar) vira pessoa pelo mesmo caminho de "Adicionar pessoa" com o nome
 * SSH, uma a uma, para o clique no ⇅ dar o mesmo resultado que no meu-bot: a máquina aparece na lista. Quem não entra
 * (máquina fora, usuário que não existe mais, sem a chave) é relatado e volta a ser tentado no próximo clique.
 */
async function adotarMaquinasDoProjeto(r: SshSyncResult, texto: string): Promise<string[]> {
  if (support === null) return [];
  const linhas: string[] = [];
  const faltam = maquinasParaAdotar([...r.added, ...r.kept, ...Object.keys(enderecos)], support.people);
  if (faltam.length === 0) return linhas;
  if (!support.adminKey) return [`⚠ ${faltam.length === 1 ? `${faltam[0]} não entrou` : `${faltam.join(", ")} não entraram`} na lista: falta a chave ~/.ssh/meu-bot-admin neste Mac.`];
  const entraram: string[] = []; const falharam: string[] = []; const jaEram: string[] = []; const renomeadas: string[] = [];
  // O sufixo de 4 hex do alias de suporte é da identidade da máquina (chave do host + usuário): é por ele que se
  // reconhece "a mesma pessoa" mesmo quando o nome (e o alias) mudou por um alias renomeado no ~/.ssh/config.
  const pessoasAntes = new Map(support.people.map((p) => [p.alias.slice(-4), p]));
  for (const h of faltam) {
    noteEl.textContent = `${texto}\nadicionando ${h} à lista (${entraram.length + falharam.length + jaEram.length + renomeadas.length + 1}/${faltam.length})…`;
    try {
      const p = await window.picker.supportAdd(h);
      const antes = pessoasAntes.get(p.alias.slice(-4));
      if (antes === undefined) { entraram.push(h); pessoasAntes.set(p.alias.slice(-4), p); }
      else if (antes.alias === p.alias) jaEram.push(`${h} = ${p.name}`);
      else { renomeadas.push(`${antes.name} → ${p.name}`); pessoasAntes.set(p.alias.slice(-4), p); }
    } catch (err) { falharam.push(`${h} (${ipcErrorText(err)})`); }
  }
  if (entraram.length > 0) linhas.push(`✓ na lista: ${entraram.join(", ")}.`);
  if (renomeadas.length > 0) linhas.push(`✓ renomeadas pelo alias novo do ~/.ssh/config: ${renomeadas.join(", ")}.`);
  if (jaEram.length > 0) linhas.push(`já estavam (mesma máquina e usuário): ${jaEram.join(", ")}.`);
  if (falharam.length > 0) linhas.push(`⚠ não entraram na lista: ${falharam.join("; ")}.`);
  return linhas;
}

/** Acrescenta as máquinas do projeto ao ~/.ssh/config e recarrega a lista. */
async function syncSsh(): Promise<void> {
  syncBtn.disabled = true;
  noteEl.hidden = false;
  noteEl.className = "note";
  noteEl.textContent = "sincronizando o ~/.ssh/config com as máquinas do projeto…";
  try {
    const r = await window.picker.syncSsh();
    const s = syncSummary(r);
    noteEl.className = `note ${s.kind}`;
    noteEl.textContent = s.text;
    const adocao = await adotarMaquinasDoProjeto(r, s.text);
    if (adocao.length > 0) {
      noteEl.className = `note ${adocao.some((l) => l.startsWith("⚠")) ? "warn" : s.kind}`;
      noteEl.textContent = `${s.text}
${adocao.join("\n")}`;
    }
    if (r.added.length > 0 || r.includesAdded > 0 || adocao.length > 0) {
      const keep = selected;
      init(await window.picker.list(), keep);
    }
  } catch (err) {
    noteEl.className = "note bad";
    noteEl.textContent = `✗ sincronização falhou: ${ipcErrorText(err)}`;
  } finally {
    syncBtn.disabled = false;
  }
}

/** Variante: admin. O que o seletor de pessoas tem a mais (admin/picker-chrome.ts). */
const adminChrome = mountAdminPickerChrome({ listEl, filterEl, noteEl, api: window.picker, syncSsh, reinit: (p, keep) => init(p, keep), selected: () => selected, showError, setShowArchived: (v) => { showArchivedPeople = v; pintarTipos(); applyFilter(); } });
archiveBtn.addEventListener("click", () => {
  const alias = selected; const person = alias === null ? undefined : personOf(alias);
  if (alias === null || person === undefined) return;
  archiveBtn.disabled = true;
  void window.picker.supportArchive(alias, !person.archived).then(async () => init(await window.picker.list(), alias)).catch((err: unknown) => showError("arquivar", err)).finally(() => { archiveBtn.disabled = false; });
});

/**
 * "Excluir máquina" (só o admin): um clique, sem confirmação. Na máquina dela limpa todo o histórico do
 * WhatsApp e desliga o suporte; aqui ela sai da lista. Se a máquina não responder, o botão vira "Excluir mesmo
 * assim", que só tira da lista.
 */
const REMOVE_PERSON_LABEL = "Excluir máquina";
function resetRemovePerson(): void {
  removePersonBtn.dataset["armed"] = ""; removePersonBtn.dataset["host"] = selected ?? ""; removePersonBtn.textContent = REMOVE_PERSON_LABEL; removePersonBtn.disabled = false;
}
removePersonBtn.addEventListener("click", () => {
  const alias = selected; const person = alias === null ? undefined : personOf(alias);
  if (alias === null || person === undefined) return;
  if (removePersonBtn.disabled) return;
  const force = removePersonBtn.dataset["armed"] === "force";
  // O segundo caminho só tira da lista. Fica armado até a pessoa trocar de seleção (resetRemovePerson): antes
  // sumia em 10 s, e quem não estava olhando na hora achava que o botão não fazia nada.
  const armarMesmoAssim = (): void => {
    removePersonBtn.disabled = false; removePersonBtn.dataset["armed"] = "force"; removePersonBtn.textContent = "Excluir máquina mesmo assim (só tira da lista)";
  };
  // A sondagem já viu a máquina fora do ar: limpar o WhatsApp lá levaria minutos de timeout para falhar do mesmo jeito.
  if (!force && foraDoAr.has(alias)) {
    noteEl.hidden = false; noteEl.className = "note warn";
    noteEl.textContent = `⚠ ${person.name} está fora do ar: não dá para limpar o WhatsApp nem desligar o suporte lá. Clique de novo para só tirar da lista (ela volta se a pessoa mandar o código de novo).`;
    armarMesmoAssim();
    return;
  }
  removePersonBtn.dataset["armed"] = ""; removePersonBtn.textContent = force ? "Tirando da lista…" : "Limpando o WhatsApp da máquina…"; removePersonBtn.disabled = true;
  void window.picker.supportRemove(alias, force).then(async (r) => {
    noteEl.hidden = false; noteEl.className = "note ok";
    noteEl.textContent = `✓ máquina de ${person.name} excluída: ${r.detail}.`;
    resetRemovePerson();
    init(await window.picker.list());
  }).catch((err: unknown) => {
    showError("excluir", err);
    armarMesmoAssim();
  });
});

/**
 * Lê o plano de cada host por SSH (melhor esforço) e repinta as linhas para o selo "PRO" aparecer. Uma máquina por vez
 * no IPC, em paralelo: antes era uma chamada só que esperava todas, e uma máquina fora do ar (até 90 s) segurava o
 * selo de todas as outras, que respondem em 1 s.
 */
async function loadPlans(): Promise<void> {
  await Promise.all(hosts.filter((h) => h !== "local").map(async (h) => {
    try {
      const map = await window.picker.plans(h);
      const p = map[h];
      if (p !== undefined && plans.get(h) !== p) { plans.set(h, p); guardarPlans(); buildRows(); if (selected !== null) select(selected); }
    } catch { /* fora do ar: sem selo */ }
  }));
}
function init(payload: PickerInit, keepSelected: string | null = null): void {
  hosts = payload.hosts;
  enderecos = payload.enderecos;
  support = payload.support;
  { const v = document.getElementById("pk-version"); if (v !== null) v.textContent = `v${payload.version}`; }
  setHostNicknames(payload.names);
  if (support !== null) { adminChrome.paint(support); adminChrome.refreshPeopleOnce(); }
  if (firstInit) { firstInit = false; arrive(payload.arrival); }
  paintGlow(keepSelected !== null && hosts.includes(keepSelected) ? keepSelected : (payload.preselect ?? ""));
  openHosts = new Set(payload.open);
  shortcuts = new Map(payload.shortcuts.map((s) => [s.host, s.emoji]));
  reliefShortcuts = new Set(payload.reliefShortcuts);
  atalhosMesa = payload.caps.atalhosMesa;
  document.body.classList.toggle("sem-semaforo", !payload.caps.semaforoNaBarra);
  pods = new Set(payload.pods);
  // Interruptores "Intro" e "Onboarding": ligado = tem. O settings.json guarda o contrário (openDirect, onboarding done).
  directCheck.checked = !payload.openDirect;
  onboardedCheck.checked = !payload.onboardingDone;
  pintarInsta(payload.instagramavel);
  errorEl.hidden = payload.error === null;
  errorEl.textContent = payload.error ?? "";
  pintarTipos();
  buildRows();
  void window.picker.locais().then((ls) => { let mudou = false; for (const h of ls) if (!locais.has(h)) { locais.add(h); mudou = true; } if (mudou) { pintarTipos(); applyFilter(); } }).catch(() => { /* sem a lista: fica pela sondagem */ });
  // "este Mac" está sempre na lista do admin: sem nenhuma pessoa, o texto de como trazer pessoas vem logo abaixo dele.
  if (support !== null && hosts.every((h) => h === "local")) listEl.append(adminChrome.emptyRow());
  // Lista vazia de verdade: só acontece onde "este computador" não é oferecido (Windows) e não há máquina no ssh.
  if (support === null && hosts.length === 0) { const li = document.createElement("li"); li.className = "row empty"; li.textContent = SEM_MAQUINAS_TEXT; listEl.append(li); }
  const wanted = keepSelected !== null && hosts.includes(keepSelected) ? keepSelected : payload.preselect;
  select(wanted !== null && hosts.includes(wanted) ? wanted : (hosts[0] ?? null));
  // A conta acabou de ser preparada: a sondagem guardada dela é de antes (dizia "sem backend, sem login"); vai de novo.
  for (const h of payload.resondar ?? []) results.delete(h);
  // Todas em paralelo: a lista nunca espera a máquina lenta.
  for (const h of hosts) void probe(h);
  void loadPlans();
  filterEl.focus();
}

// Reenvio porque a lista mudou com o seletor aberto: mantém a máquina selecionada.
window.picker.on("picker:init", (p) => { const init0 = p as PickerInit; init(init0, init0.manterSelecao === true ? selected : null); });

/* ---------- Portão da conta (molde Rambox): sem sessão, só o cartão de login; entrou, a lista e o avatar no rodapé ---------- */
let conta: ContaView | null = null;
const portao = document.getElementById("pk-portao") as HTMLElement;
const portaoErro = document.getElementById("pk-portao-erro") as HTMLElement;
const portaoSub = document.getElementById("pk-portao-sub") as HTMLElement;
const portaoEntrar = document.getElementById("pk-portao-entrar") as HTMLButtonElement;
const portaoCancelar = document.getElementById("pk-portao-cancelar") as HTMLButtonElement;
const portaoReabrir = document.getElementById("pk-portao-reabrir") as HTMLButtonElement;
const portaoTitulo = document.getElementById("pk-portao-titulo") as HTMLElement;
const contaTexto = document.getElementById("pk-conta-texto") as HTMLElement;
const menuConta = montarMenuConta([document.getElementById("pk-avatar") as HTMLButtonElement], {
  api: window.picker, view: () => conta, aoMudar: (v) => contaMudou(v),
  extras: () => [{ ico: "📣", texto: "Novidades", acao: () => { void window.picker.openExternal("https://github.com/diegofornalha/meu-bot/blob/main/docs/CHANGELOG.md").catch(() => undefined); } }],
});
function contaMudou(v: ContaView): void {
  conta = v;
  const dentro = v.situacao === "dentro" && v.conta !== null;
  document.body.classList.toggle("portao", !dentro);
  portao.hidden = dentro;
  if (!dentro) {
    const entrando = v.situacao === "entrando";
    portaoEntrar.hidden = entrando; portaoReabrir.hidden = !entrando; portaoCancelar.hidden = !entrando; portaoEntrar.disabled = false; portaoReabrir.disabled = false;
    portaoTitulo.textContent = entrando ? "Aguardando login…" : "Entre com sua conta meu-bot";
    portaoSub.textContent = entrando ? "Conclua o login na janela do navegador que acabou de abrir." : "Você entra no navegador, com Google ou link por e-mail, e volta sozinho para cá.";
    portaoErro.hidden = !(v.situacao === "erro" && v.erro !== null); portaoErro.textContent = v.erro ?? "";
  }
  contaTexto.hidden = !dentro;
  if (dentro && v.conta !== null) { const r = resumoPlano(v.conta); contaTexto.textContent = `${v.conta.nome ?? v.conta.email} · ${r.prazo ?? r.rotulo}`; }
  menuConta.fechar(); menuConta.pintar();
}
portaoEntrar.addEventListener("click", () => { portaoEntrar.disabled = true; void window.picker.contaEntrar().then(contaMudou).catch((err: unknown) => { portaoEntrar.disabled = false; portaoErro.hidden = false; portaoErro.textContent = `Não consegui abrir o login: ${ipcErrorText(err)}`; }); });
portaoCancelar.addEventListener("click", () => { void window.picker.contaCancelar().then(contaMudou).catch(() => undefined); });
portaoReabrir.addEventListener("click", () => { portaoReabrir.disabled = true; void window.picker.contaEntrar().then(contaMudou).catch(() => { portaoReabrir.disabled = false; }); });
window.picker.on("conta:changed", (p) => contaMudou(p as ContaView));
void window.picker.contaGet().then(contaMudou).catch(() => undefined);
window.picker.on("picker:install-progress", (p) => {
  const ev = p as { host: string; line: string };
  if (ev.host !== selected) return;
  logEl.hidden = false;
  logEl.textContent = `${logEl.textContent ?? ""}${ev.line}\n`.split("\n").slice(-12).join("\n");
  logEl.scrollTop = logEl.scrollHeight;
});

filterEl.addEventListener("input", () => applyFilter());
installBtn.addEventListener("click", () => { void install(); });
reliefShortcutBtn.addEventListener("click", () => { void toggleReliefShortcut(); });
/** "Renomear": campo inline com o apelido; Enter ou Salvar grava (vazio tira o apelido). */
const renameForm = el("div", "add-form"); renameForm.hidden = true;
const renameInput = el("input"); renameInput.type = "text"; renameInput.maxLength = 40; renameInput.placeholder = "Apelido (vazio volta ao nome SSH)";
const renameSave = el("button", "btn btn-primary btn-small", "Salvar"); renameSave.type = "button";
renameForm.append(renameInput, renameSave);
detailEl.append(renameForm);
renameBtn.addEventListener("click", () => {
  if (selected === null) return;
  renameForm.hidden = !renameForm.hidden;
  if (!renameForm.hidden) { renameInput.value = support !== null ? (personOf(selected)?.name ?? "") : hostLabel(selected) === selected ? "" : hostLabel(selected); renameInput.placeholder = support !== null ? "Apelido (vazio volta ao nome dela)" : "Apelido (vazio volta ao nome SSH)"; renameInput.focus(); renameInput.select(); }
});
async function saveRename(): Promise<void> {
  if (selected === null) return;
  const host = selected;
  renameSave.disabled = true;
  try { if (support !== null) await window.picker.supportRename(host, renameInput.value); else await window.picker.renameHost(host, renameInput.value); renameForm.hidden = true; init(await window.picker.list(), host); }
  catch (err) { showError("renomear", err); }
  finally { renameSave.disabled = false; }
}
renameSave.addEventListener("click", () => { void saveRename(); });
renameInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); void saveRename(); } if (ev.key === "Escape") { ev.stopPropagation(); renameForm.hidden = true; } });

/**
 * "Remover do seletor": dois cliques (o primeiro arma por 4 s, como no resto do app). Sai do ~/.ssh/config com
 * backup; a lista é refeita.
 */
removeBtn.addEventListener("click", () => {
  if (selected === null) return;
  const host = selected;
  if (removeBtn.dataset["armed"] !== "1") {
    removeBtn.dataset["armed"] = "1"; removeBtn.textContent = "Confirmar? sai também do ~/.ssh/config";
    window.setTimeout(() => { if (removeBtn.dataset["armed"] === "1") { removeBtn.dataset["armed"] = ""; removeBtn.textContent = "Remover do seletor"; } }, 4000);
    return;
  }
  removeBtn.dataset["armed"] = ""; removeBtn.textContent = "Removendo…"; removeBtn.disabled = true;
  void window.picker.removeHost(host).then(async (r) => {
    noteEl.hidden = false; noteEl.className = "note ok";
    noteEl.textContent = `✓ ${host} saiu do seletor e do ~/.ssh/config (backup em ${r.backup.replace(/^.*\//, "")}).`;
    init(await window.picker.list());
  }).catch((err: unknown) => { showError("remover", err); })
    .finally(() => { removeBtn.disabled = false; removeBtn.textContent = "Remover do seletor"; });
});
tailscaleBtn.addEventListener("click", () => {
  if (selected === null) return;
  const host = selected;
  tailscaleBtn.disabled = true;
  statusEl.className = "status";
  statusEl.textContent = `abri o link de verificação no navegador; esperando você aprovar para ${host} (até 4 min)…`;
  void window.picker.approveTailscale(host).then(async (r) => {
    if (!r.ok) { results.set(host, { kind: "bad", text: `✗ ${host}: ${r.detail}`, install: null, canOpen: false }); paintState(host); return; }
    needsCheck.delete(host);
    await probe(host, true);
  }).finally(() => { tailscaleBtn.disabled = false; paintDetail(); });
});
// ---- Desligar a verificação do Tailscale SSH de vez (edita a política do tailnet pela API).
function note(kind: "ok" | "warn" | "bad", text: string): void { noteEl.hidden = false; noteEl.className = `note ${kind}`; noteEl.textContent = text; }

async function runDisableCheck(host: string): Promise<void> {
  tailscaleBtn.disabled = true; tailscaleOffBtn.disabled = true;
  statusEl.className = "status";
  statusEl.textContent = "editando a política do tailnet pela API do Tailscale…";
  try {
    const r = await window.picker.disableTailscaleCheck(host);
    if (!r.ok) { note("bad", `✗ ${r.detail}`); paintDetail(); return; }
    if (!r.changed) { note("warn", `${r.detail}.`); paintDetail(); return; }
    note("ok", `✓ ${r.detail}. O tailscaled de cada máquina recarrega a política em segundos (a porta 22 pode recusar nesse meio-tempo); sondando de novo em 8 s…`);
    needsCheck.delete(host);
    paintDetail();
    await new Promise((res) => setTimeout(res, 8000));
    await probe(host, true);
    if (needsCheck.has(host)) note("warn", "ainda pediu verificação: espere mais um pouco e aprove o link uma última vez; depois não será mais exigido.");
    else if (results.get(host)?.kind === "ok") note("ok", "✓ Política salva e a máquina entrou sem pedir verificação.");
  } catch (err) {
    note("bad", `✗ ${ipcErrorText(err)}`);
  } finally {
    tailscaleBtn.disabled = false; tailscaleOffBtn.disabled = false;
    paintDetail();
  }
}

modoGratisBtn.addEventListener("click", () => { void window.picker.modoGratis().catch((err: unknown) => showError("Modo grátis", err)); });
claudeLoginBtn.addEventListener("click", () => { if (selected !== null) void window.picker.claudeLogin(selected).catch((err: unknown) => showError("Login", err)); });
tailscaleOffBtn.addEventListener("click", () => {
  if (selected === null) return;
  const host = selected;
  void window.picker.tailscaleCredential().then((st) => {
    if (!st.encryptionAvailable) { note("bad", "✗ este Mac não tem o Keychain disponível para guardar o secret do Tailscale."); return; }
    if (!st.configured) { tsForget.hidden = true; tsForm.hidden = false; tsId.focus(); return; }
    return runDisableCheck(host);
  }).catch((err: unknown) => note("bad", `✗ ${ipcErrorText(err)}`));
});
tsSave.addEventListener("click", () => {
  if (selected === null) return;
  const host = selected;
  tsSave.disabled = true;
  void window.picker.saveTailscaleCredential(tsId.value, tsSecret.value).then((st) => {
    tsForm.hidden = true;
    if (st.configured) return runDisableCheck(host);
    note("bad", "✗ a credencial não ficou salva.");
  }).catch((err: unknown) => note("bad", `✗ ${ipcErrorText(err)}`)).finally(() => { tsSecret.value = ""; tsSave.disabled = false; });
});
tsCancel.addEventListener("click", () => { tsSecret.value = ""; tsForm.hidden = true; });
tsForget.addEventListener("click", () => {
  void window.picker.forgetTailscaleCredential().then(() => { note("warn", "credencial do Tailscale removida do Keychain."); tsForget.hidden = true; }).catch((err: unknown) => note("bad", `✗ ${ipcErrorText(err)}`));
});
tsOpen.addEventListener("click", () => { void window.picker.openKnownUrl("tailscale-keys").catch((err: unknown) => note("bad", `✗ ${ipcErrorText(err)}`)); });
// Atalho de "esquecer": clique com a tecla Option no botão principal mostra o formulário com a opção.
tailscaleOffBtn.addEventListener("click", (ev) => { if (ev.altKey) { tsForget.hidden = false; tsForm.hidden = false; } });

grokbotResetBtn.addEventListener("click", () => {
  grokbotResetBtn.disabled = true;
  void window.picker.openGrokbotReset().then((ok) => {
    noteEl.hidden = false;
    noteEl.className = `note ${ok ? "warn" : "bad"}`;
    noteEl.textContent = ok
      ? "O app do Grok Bot abriu no card \"Reset computer\". O reset só acontece quando você clicar no botão vermelho lá. Depois, volte aqui e espere a máquina ficar verde."
      : "Não achei quem atenda grokbot:// neste Mac. O app do Grok Bot está instalado?";
  }).finally(() => { grokbotResetBtn.disabled = false; });
});
openBtn.addEventListener("click", () => { void open(); });
cancelBtn.addEventListener("click", () => window.picker.cancel());
syncBtn.addEventListener("click", () => { void syncSsh(); });
directCheck.addEventListener("change", () => { void window.picker.setOpenDirect(!directCheck.checked).catch((err: unknown) => showError("Intro", err)); });
instaBtn.addEventListener("click", () => { const on = !instaBtn.classList.contains("on"); pintarInsta(on); void window.picker.setInstagramavel(on).catch((err: unknown) => { pintarInsta(!on); showError("Instagramável", err); }); });
onboardedCheck.addEventListener("change", () => { void window.picker.setOnboardingDone(!onboardedCheck.checked).catch((err: unknown) => showError("Onboarding", err)); });
document.addEventListener("keydown", (ev) => {
  // Digitando no formulário do Tailscale: Enter e setas não podem abrir máquina nem mover a seleção.
  if ((ev.target as HTMLElement | null)?.closest("#pk-ts-form") !== null) { if (ev.key === "Escape") { tsSecret.value = ""; tsForm.hidden = true; } return; }
  if (ev.key === "Escape") { ev.preventDefault(); window.picker.cancel(); return; }
  if (ev.key === "Enter") { ev.preventDefault(); void open(); return; }
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    const vis = visibleHosts();
    if (vis.length === 0) return;
    const i = selected === null ? -1 : vis.indexOf(selected);
    const next = ev.key === "ArrowDown" ? Math.min(vis.length - 1, i + 1) : Math.max(0, i - 1);
    select(vis[next] ?? null);
  }
});
