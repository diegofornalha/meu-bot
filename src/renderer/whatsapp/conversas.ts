import type { WhatsappChat, WaMarkPatch, WhatsappMenuAction, WhatsappArchive } from "../../shared/ipc";
import { type CacheStore, type Cached, readCache, writeCache, dropCache } from "../lib/cache.js";
import { byId as $, el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { pausaAteTexto, pausaRestanteTexto } from "../lib/pausa-texto.js";
import { acaoTerminou, segurarConexao } from "./agente-whatsapp.js";
import { hostLabel } from "../lib/probe-text.js";
import { waReferenceText } from "../lib/reference.js";
import { normalize, groupByDate, shortDate } from "../lib/sidebar.js";
import { ctx } from "../app/ctx.js";

// ---- Conversas do WhatsApp (espelho só leitura, OpenClaw). Seletor `[ meu-bot | WhatsApp ]` acima da busca;
// no modo WhatsApp a lista lateral mostra os contatos, e cada conversa abre numa aba própria (página, não
// conversa do meu-bot: o compositor desliga sozinho). Lista a cada 20 s no modo WhatsApp; aberta a cada 8 s.
type ListMode = "bot" | "whatsapp";
const listModeEl = $<HTMLElement>("list-mode");
const listModeBtn = $<HTMLButtonElement>("list-mode-btn");
const sidebarFootEl = document.querySelector<HTMLElement>(".sidebar-foot");
let waChatsErr: string | null = null;
let waChatsInflight: Promise<void> | null = null;
let waChatsTimer: number | null = null;
/** Já tentou pintar a lista pelo cache nesta janela (uma vez; depois a leitura real manda). */
let waChatsFromCache = false;
/** Contatos cujo nome já se tentou descobrir nesta abertura (quem não tem pushname fica com o número, sem insistir). */
const waNamesTried = new Set<string>();
let waNamesInflight: Promise<void> | null = null;
/**
 * Nomes dos contatos sem nome, em segundo plano e uma vez por contato por abertura: o main lê o histórico deles de
 * uma vez e guarda na máquina; aqui só se aplica o resultado. Mais de 20: o resto vai na próxima lista.
 */
function learnMissingWaNames(): Promise<void> {
  if (waNamesInflight !== null) return waNamesInflight;
  const missing = ctx.waChats.filter((c) => c.name === null && c.alias === null && !c.isSelf && !c.deleted && !waNamesTried.has(c.number)).map((c) => c.number).slice(0, 20);
  if (missing.length === 0) return Promise.resolve();
  for (const n of missing) waNamesTried.add(n);
  waNamesInflight = (async () => {
    try {
      const names = await window.meuBot.learnWhatsappNames(missing);
      if (Object.keys(names).length === 0) return;
      ctx.waChats = ctx.waChats.map((c) => (names[c.number] !== undefined && c.name === null ? { ...c, name: names[c.number]! } : c));
      for (const g of ctx.waChatPages.values()) { const c = ctx.waChats.find((x) => x.number === g.chat.number); if (c !== undefined) { g.chat = c; ctx.paintWaChatTab(g); if (ctx.pageShown(g.page)) ctx.renderWaChat(g); } }
      cacheWrite("waChats", ctx.waChats);
      if (getListMode() === "whatsapp") ctx.renderSidebar();
    } catch (err) { console.warn("nomes do WhatsApp:", err); }
    finally { waNamesInflight = null; }
  })();
  return waNamesInflight;
}
const listModeKey = (): string => `listMode:${ctx.windowHost}`;
// Espelho das conversas: OpenClaw (pelo gateway) e Hermes (pelo state.db, só-leitura); o PicoClaw ainda não lista.
const waMirrorAvailable = (): boolean => ctx.waStatus?.capacidades.listarConversas === true;
export function getListMode(): ListMode {
  if (!waMirrorAvailable()) return "bot";
  try { return localStorage.getItem(listModeKey()) === "whatsapp" ? "whatsapp" : "bot"; } catch { return "bot"; }
}
export function paintListMode(): void {
  listModeEl.hidden = !waMirrorAvailable();
  const mode = getListMode();
  // Atalho ao lado da caixa de texto: só existe quando o espelho do WhatsApp está disponível,
  // igual ao alternador do topo, de quem ele é apenas um atalho.
  listModeBtn.hidden = !waMirrorAvailable();
  listModeBtn.classList.toggle("on", mode === "whatsapp");
  listModeBtn.title = mode === "whatsapp" ? "Mostrando o WhatsApp; clique para ver as conversas do meu-bot" : "Mostrando o meu-bot; clique para ver o WhatsApp";
  for (const b of listModeEl.querySelectorAll<HTMLButtonElement>("button")) { const on = b.dataset["mode"] === mode; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); }
  paintArquivadas();
  ctx.sidebarSearch.placeholder = mode === "whatsapp" ? "Buscar no WhatsApp…" : "Buscar conversas…";
  if (mode === "whatsapp" && waChatsInflight === null && waChatsTimer === null) void refreshWaChats();
}
/**
 * O interruptor "arquivadas" só existe quando há algo arquivado para mostrar; nas duas listas, não
 * só na do WhatsApp. Fica aqui, e não espalhado, porque quem repinta a lista também precisa chamar:
 * arquivar a primeira conversa tem que fazer o interruptor aparecer na hora.
 *
 * No meu-bot-admin a lista é o espelho da máquina, que não tem conversa arquivada: lá nunca aparece.
 * Já no WhatsApp do admin ele também cobre as excluídas (exclusão lógica: a pessoa não vê, o admin restaura).
 */
export function paintArquivadas(): void {
  const mode = getListMode();
  const tem = mode === "whatsapp"
    ? ctx.waChats.some((c) => (isWaArchived(c) && !isWaDeleted(c)) || (ctx.caps.supportAdmin && isWaDeleted(c)))
    : ctx.adminBotMirror === null && [...ctx.index.values()].some((c) => c.messages.length > 0 && c.archived);
  if (sidebarFootEl !== null) sidebarFootEl.hidden = !tem;
  const archLabel = ctx.sidebarArchived.parentElement?.querySelector(".switch-label");
  if (archLabel !== null && archLabel !== undefined) archLabel.textContent = mode === "whatsapp" && ctx.caps.supportAdmin ? "arquivadas e excluídas" : "arquivadas";
}
export function setListMode(mode: ListMode): void {
  try { localStorage.setItem(listModeKey(), mode); } catch { /* opcional */ }
  paintListMode();
  ctx.renderSidebar();
}
/** Próxima leitura da lista; com a janela escondida só reagenda (cada leitura é uma chamada ao gateway na máquina). */
function agendarWaChats(ms: number): void {
  waChatsTimer = window.setTimeout(() => { waChatsTimer = null; if (document.visibilityState === "hidden") { agendarWaChats(30_000); return; } void refreshWaChats(); }, ms);
}
function refreshWaChats(): Promise<void> {
  if (waChatsInflight !== null) return waChatsInflight;
  if (waChatsTimer !== null) { clearTimeout(waChatsTimer); waChatsTimer = null; }
  // Primeira leitura: a lista da última vez aparece na hora (cache desta janela) e a leitura real troca por baixo.
  // Grupos em paralelo (não esperam a lista de conversas), no máximo a cada minuto.
  if (Date.now() - ctx.waGroupsAt > 60_000) void ctx.refreshWaGroups();
  if (ctx.waChats.length === 0 && !waChatsFromCache) { waChatsFromCache = true; const c = cacheRead<WhatsappChat[]>("waChats"); if (c !== null && c.value.length > 0) { ctx.waChats = c.value; if (getListMode() === "whatsapp") ctx.renderSidebar(); } }
  waChatsInflight = (async () => {
    try { ctx.waChats = await window.meuBot.whatsappChats(); waChatsErr = null; await migrateWaMarks(); cacheWrite("waChats", ctx.waChats); void learnMissingWaNames(); }
    catch (err) { waChatsErr = err instanceof Error ? err.message : String(err); }
    finally { waChatsInflight = null; }
    for (const g of ctx.waChatPages.values()) { const c = ctx.waChats.find((x) => x.number === g.chat.number); if (c !== undefined) { g.chat = c; ctx.paintWaChatTab(g); } }
    if (getListMode() === "whatsapp") { ctx.renderSidebar(); agendarWaChats(30_000); }
  })();
  return waChatsInflight;
}
/**
 * Arquivada/excluída moram na máquina (whatsapp-lista.json, lidas junto com a lista): o meu-bot da pessoa e o
 * meu-bot-admin veem a mesma coisa. Excluída some mesmo com "arquivadas" ligado e volta só se o contato mandar
 * outra mensagem depois da exclusão (o main compara as horas).
 */
const isWaArchived = (c: WhatsappChat): boolean => c.archived;
const isWaDeleted = (c: WhatsappChat): boolean => c.deleted;
/**
 * Cache "stale-while-revalidate" desta janela (lib/cache.ts): pinta o último estado conhecido na hora e a leitura
 * real troca por baixo. Chave por máquina; sem localStorage, segue sem cache.
 */
const cacheStore = (): CacheStore | null => { try { return window.localStorage; } catch { return null; } };
/** `qualquerBuild`: aceita o valor gravado por outro build (estado do WhatsApp: a forma é estável e vale mais mostrar o de ontem do que nada). */
export function cacheRead<T>(name: string, qualquerBuild = false): Cached<T> | null { const st = cacheStore(); return st === null ? null : readCache<T>(st, ctx.windowHost, name, ctx.appBuild, Number.POSITIVE_INFINITY, Date.now(), qualquerBuild); }
export function cacheWrite(name: string, value: unknown): void { const st = cacheStore(); if (st !== null) writeCache(st, ctx.windowHost, name, ctx.appBuild, value); }
export function cacheDrop(name: string): void { const st = cacheStore(); if (st !== null) dropCache(st, ctx.windowHost, name); }
/** Marca na máquina e aplica na lista local na hora (otimista); em erro, relê a lista e avisa. */
async function markWa(patch: WaMarkPatch, what: string): Promise<boolean> {
  ctx.waChats = ctx.waChats.map((c) => (c.number === patch.number ? { ...c, ...(patch.archived !== undefined ? { archived: patch.archived } : {}), ...(patch.deleted !== undefined ? { deleted: patch.deleted } : {}), ...(patch.alias !== undefined ? { alias: patch.alias === "" ? null : patch.alias } : {}) } : c));
  for (const g of ctx.waChatPages.values()) { const c = ctx.waChats.find((x) => x.number === g.chat.number); if (c !== undefined) { g.chat = c; ctx.paintWaChatTab(g); if (ctx.pageShown(g.page)) ctx.renderWaChat(g); } }
  paintListMode(); ctx.renderSidebar();
  try { await window.meuBot.markWhatsapp([patch]); return true; }
  catch (err) {
    void refreshWaChats();
    ctx.sidebarList.prepend(el("div", "sidebar-empty wa-menu-err", `${what}: ${ipcErrorText(err)}`));
    return false;
  }
}
/**
 * Migração única: o que este app guardava só no localStorage (waHidden = arquivadas, com a hora de então;
 * waDeleted = excluídas, com a hora da exclusão) vai para a máquina, e as chaves locais somem. Se a gravação
 * falhar, as chaves ficam e a próxima lista tenta de novo: nada se perde.
 */
async function migrateWaMarks(): Promise<void> {
  const read = (key: string): Record<string, string> => {
    try { const v = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown; return v !== null && typeof v === "object" ? v as Record<string, string> : {}; } catch { return {}; }
  };
  const archKey = `waHidden:${ctx.windowHost}`, delKey = `waDeleted:${ctx.windowHost}`;
  const patches: WaMarkPatch[] = [];
  const iso = (v: string): string | undefined => (Number.isNaN(Date.parse(v)) ? undefined : v);
  for (const [number, at] of Object.entries(read(archKey))) { const a = iso(at); patches.push({ number, archived: true, ...(a === undefined ? {} : { at: a }) }); }
  for (const [number, at] of Object.entries(read(delKey))) { const a = iso(at); patches.push({ number, deleted: true, ...(a === undefined ? {} : { at: a }) }); }
  if (patches.length === 0) return;
  await window.meuBot.markWhatsapp(patches.slice(0, 200));
  try { localStorage.removeItem(archKey); localStorage.removeItem(delKey); } catch { /* opcional */ }
  ctx.waChats = await window.meuBot.whatsappChats();
}

/** Pausar/retomar em andamento por contato: a linha mostra "aguarde…" piscando e depois "pronto!" por um instante. */
const waPausaEtapa = new Map<string, "aguarde" | "pronto">();
async function waMenuAction(row: WhatsappChat, action: WhatsappMenuAction | null): Promise<void> {
  if (action === null) return;
  const fail = (what: string, err: unknown): void => {
    ctx.sidebarList.prepend(el("div", "sidebar-empty wa-menu-err", `${what}: ${ipcErrorText(err)}`));
  };
  switch (action) {
    case "talk": {
      // Relê o histórico pela máquina (alguns segundos): o contato pisca até a aba nova abrir.
      const item = [...ctx.sidebarList.querySelectorAll<HTMLElement>(".wa-item")].find((x) => x.dataset["number"] === row.number);
      item?.classList.add("wa-busy");
      try { await ctx.openWaBranch(row.number); }
      catch (err) { fail("Não deu para levar ao meu-bot", err); }
      finally { item?.classList.remove("wa-busy"); }
      break;
    }
    case "export-md": case "export-json":
      try { await window.meuBot.exportWhatsapp(row.number, action === "export-md" ? "md" : "json"); }
      catch (err) { fail("Não deu para exportar", err); }
      break;
    case "rename":
      waClear = null; waRename = row.number; ctx.renderSidebar();
      break;
    case "copy-ref":
      ctx.copyReference(waReferenceText(row, hostLabel(ctx.windowHost)));
      break;
    case "archive":
      { const g = ctx.waChatPages.get(`wa-${row.number}`); if (g !== undefined && g.page.tabEl !== null) ctx.closePage(g.page); }
      await markWa({ number: row.number, archived: true }, "Não deu para arquivar");
      break;
    case "unarchive":
      await markWa({ number: row.number, archived: false }, "Não deu para desarquivar");
      break;
    case "restore":
      await markWa({ number: row.number, deleted: false }, "Não deu para restaurar");
      break;
    case "pause": case "pause-2h": case "pause-24h": case "resume": {
      const pausar = action !== "resume";
      const horas = action === "pause-2h" ? 2 : action === "pause-24h" ? 24 : undefined;
      // Otimista: o fim real vem da máquina na próxima leitura da lista (relógio dela).
      const pausaAte = pausar && horas !== undefined ? new Date(Date.now() + horas * 3_600_000).toISOString() : null;
      // A etiqueta da linha conta a história: "pausado" → "aguarde…" (piscando; sem o plugin o gateway reinicia, ~15 s) → "pronto!" → some.
      waPausaEtapa.set(row.number, "aguarde"); ctx.renderSidebar();
      // Sem o plugin, pausar/retomar reinicia o gateway: segura "conectado" até ele voltar (senão o tutorial voltava ao QR).
      const reinicia = ctx.waStatus?.capacidades.pausaPrazo !== true;
      if (reinicia) segurarConexao();
      try {
        await window.meuBot.pauseWhatsapp(row.number, pausar, horas);
        if (reinicia) acaoTerminou();
        ctx.waChats = ctx.waChats.map((c) => (c.number === row.number ? { ...c, paused: pausar, pausaAte } : c));
        for (const g of ctx.waChatPages.values()) if (g.chat.number === row.number) { g.chat = { ...g.chat, paused: pausar, pausaAte }; if (ctx.pageShown(g.page)) ctx.renderWaChat(g); }
        waPausaEtapa.set(row.number, "pronto"); ctx.renderSidebar();
        setTimeout(() => { if (waPausaEtapa.get(row.number) === "pronto") { waPausaEtapa.delete(row.number); ctx.renderSidebar(); } }, 2500);
      } catch (err) { if (reinicia) acaoTerminou(); waPausaEtapa.delete(row.number); ctx.renderSidebar(); fail(pausar ? "Não deu para pausar" : "Não deu para retomar", err); }
      break;
    }
    case "clear":
      void startWaClear(row.number);
      break;
    case "delete":
      void deleteWaChat(row.number);
      break;
  }
}
/**
 * "Limpar histórico": limpa direto; a caixa abaixo do contato mostra o andamento e só pede escolha quando a conversa
 * está na sessão principal do agente ou quando guardar no CRM falhou.
 * Sobrevive às atualizações da lista porque o estado fica aqui, não no DOM.
 */
type WaClear = {
  number: string; phase: "plan" | "confirm" | "archive" | "run"; shared: boolean; /** Sem histórico na máquina. */ empty: boolean; err: string | null;
  /** meu-bot-crm: guardar no CRM falhou; o botão vira "Limpar sem guardar" e só limpa se a pessoa escolher. */ crmFalhou?: boolean; /** A pessoa escolheu limpar sem guardar. */ semCrm?: boolean;
};
let waClear: WaClear | null = null;
/** Onde a conversa ficou no CRM, mostrado embaixo do contato por alguns segundos depois de limpar. */
type WaArchiveNote = { number: string; text: string; bad: boolean };
let waArchiveNote: WaArchiveNote | null = null;
function archiveNoteText(a: WhatsappArchive): { text: string; bad: boolean } {
  const onde = a.box !== null ? `na caixa "${a.box.nome}"` : "no contato";
  const drive = a.drive !== null ? ` Cópia no Google Drive: ${a.drive}.` : " Google Drive: não conectado neste Mac (só no CRM).";
  return a.resumo ? { text: `Conversa guardada no CRM ${onde} (${a.mensagens} mensagens, com resumo).${drive}`, bad: false } : { text: `Transcrição guardada no CRM ${onde}; resumo não atualizado${a.aviso !== null ? ` (${a.aviso})` : ""}.${drive}`, bad: true };
}
async function startWaClear(number: string): Promise<void> {
  waClear = { number, phase: "plan", shared: false, empty: false, err: null };
  ctx.renderSidebar();
  try {
    const plan = await window.meuBot.whatsappClearPlan(number);
    if (waClear?.number !== number) return;
    // "Limpar" limpa direto (27 out), como o dos grupos. A confirmação fica só quando a conversa está na sessão
    // principal do agente: aí limpar zera os outros contatos juntos, e isso não é o que o clique pediu.
    if (plan.own + plan.shared > 0 && plan.shared === 0) { void runWaClear({ number, phase: "confirm", shared: false, empty: false, err: null }); return; }
    waClear = plan.own + plan.shared === 0
      ? { number, phase: "confirm", shared: false, empty: true, err: "Não há histórico desta conversa na máquina." }
      : { number, phase: "confirm", shared: true, empty: false, err: null };
  } catch (err) {
    if (waClear?.number !== number) return;
    waClear = { number, phase: "confirm", shared: false, empty: false, err: ipcErrorText(err) };
  }
  ctx.renderSidebar();
}
/**
 * "Excluir conversa": sem confirmação, só tira da lista (marca na máquina, some nos dois apps). O agente não
 * esquece nada e continua de onde parou; mensagem nova do contato traz a conversa de volta. Zerar é o "Limpar".
 */
async function deleteWaChat(number: string): Promise<void> {
  try {
    await window.meuBot.markWhatsapp([{ number, deleted: true, archived: false }]);
    const g = ctx.waChatPages.get(`wa-${number}`); if (g !== undefined && g.page.tabEl !== null) ctx.closePage(g.page);
    void refreshWaChats();
  } catch (err) { ctx.sidebarList.prepend(el("div", "sidebar-empty wa-menu-err", `Não deu para excluir: ${ipcErrorText(err)}`)); }
}
async function runWaClear(c: WaClear): Promise<void> {
  // Com o CRM próprio: a conversa vai antes para o CRM; se não der, volta à confirmação e nunca limpa sem a pessoa escolher.
  let note: WaArchiveNote | null = null;
  if (ctx.crmProprio() && c.semCrm !== true) {
    waClear = { ...c, phase: "archive" };
    ctx.renderSidebar();
    try {
      const a = await window.meuBot.archiveWhatsappToCrm(c.number);
      if (!a.vazio) note = { number: c.number, ...archiveNoteText(a) };
    } catch (err) {
      if (waClear?.number === c.number) { waClear = { ...c, phase: "confirm", crmFalhou: true, err: `Não deu para guardar: ${ipcErrorText(err)}` }; ctx.renderSidebar(); }
      return;
    }
  }
  waClear = { ...c, phase: "run" };
  ctx.renderSidebar();
  try {
    await window.meuBot.clearWhatsapp(c.number, c.shared);
    // Limpar desarquiva, se estava arquivada.
    if (ctx.waChats.find((x) => x.number === c.number)?.archived === true) await window.meuBot.markWhatsapp([{ number: c.number, archived: false }]);
    waClear = null;
    cacheDrop(`waThread:${c.number}`);
    const g = ctx.waChatPages.get(`wa-${c.number}`); if (g !== undefined && g.page.tabEl !== null) ctx.closePage(g.page);
    if (note !== null) { waArchiveNote = note; setTimeout(() => { if (waArchiveNote === note) { waArchiveNote = null; ctx.renderSidebar(); } }, 10_000); }
    void refreshWaChats();
  } catch (err) { waClear = { ...c, phase: "confirm", err: ipcErrorText(err) }; }
  ctx.renderSidebar();
}
function waClearBox(c: WaClear): HTMLElement {
  const box = el("div", "wa-clear");
  if (c.phase === "plan") { box.append(el("span", "wa-clear-text", "Verificando o histórico na máquina…")); return box; }
  if (c.phase === "archive") { box.append(el("span", "wa-clear-text", "Guardando a conversa no CRM…")); return box; }
  if (c.phase === "run") { box.append(el("span", "wa-clear-text", "Limpando o histórico…")); return box; }
  const cancel = el("button", "btn", c.err !== null && !c.shared ? "Fechar" : "Cancelar"); cancel.type = "button";
  cancel.addEventListener("click", (ev) => { ev.stopPropagation(); waClear = null; ctx.renderSidebar(); });
  if (c.empty) { box.append(el("span", "wa-clear-text", c.err ?? ""), el("div", "wa-clear-actions")); box.lastElementChild!.append(cancel); return box; }
  box.append(el("strong", "", c.shared ? "Limpar o histórico de todos?" : "Limpar o histórico?"));
  box.append(el("span", "wa-clear-text", c.shared
    ? "Esta conversa está na sessão principal do agente, que mistura os contatos. Limpar zera ela inteira, com os outros contatos e o que você conversou direto com o agente."
    : "O agente esquece o que conversou com este contato e recomeça do zero."));
  if (ctx.crmProprio() && c.crmFalhou !== true) box.append(el("span", "wa-clear-text", "Antes, a conversa vai para o histórico do contato no CRM (resumo + transcrição)."));
  if (c.err !== null) box.append(el("span", "wa-clear-err", c.err));
  const semCrm = c.crmFalhou === true;
  const go = el("button", "btn btn-bad", semCrm ? "Limpar sem guardar" : c.shared ? "Limpar tudo" : "Limpar"); go.type = "button";
  go.addEventListener("click", (ev) => { ev.stopPropagation(); void runWaClear(semCrm ? { ...c, semCrm: true } : c); });
  const actions = el("div", "wa-clear-actions");
  if (semCrm) {
    const again = el("button", "btn", "Tentar de novo"); again.type = "button";
    again.addEventListener("click", (ev) => { ev.stopPropagation(); void runWaClear({ ...c, crmFalhou: false, err: null }); });
    actions.append(cancel, again, go);
  } else actions.append(cancel, go);
  box.append(actions);
  box.addEventListener("click", (ev) => ev.stopPropagation());
  return box;
}
/**
 * "Renomear": apelido guardado na máquina (vale na lista e no título dos dois apps; o nome original fica dentro da
 * conversa). Caixa inline abaixo do contato, como a do limpar; vazio tira o apelido.
 */
let waRename: string | null = null;
function waRenameBox(row: WhatsappChat): HTMLElement {
  const box = el("div", "wa-clear wa-rename");
  box.append(el("strong", "", "Apelido desta conversa"));
  const input = el("input"); input.type = "text"; input.maxLength = 80; input.value = row.alias ?? "";
  input.placeholder = row.name !== null ? `Apelido (vazio volta a "${row.name}")` : "Apelido (vazio volta ao número)";
  const cancel = el("button", "btn", "Cancelar"); cancel.type = "button";
  const save = el("button", "btn btn-primary", "Salvar"); save.type = "button";
  const close = (): void => { waRename = null; ctx.renderSidebar(); };
  const commit = (): void => {
    const alias = input.value.replace(/\s+/g, " ").trim();
    if (alias === (row.alias ?? "")) { close(); return; }
    waRename = null;
    void markWa({ number: row.number, alias }, "Não deu para renomear");
  };
  cancel.addEventListener("click", (ev) => { ev.stopPropagation(); close(); });
  save.addEventListener("click", (ev) => { ev.stopPropagation(); commit(); });
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); commit(); } if (ev.key === "Escape") { ev.stopPropagation(); close(); } });
  const actions = el("div", "wa-clear-actions"); actions.append(cancel, save);
  box.append(input, actions);
  box.addEventListener("click", (ev) => ev.stopPropagation());
  requestAnimationFrame(() => { input.focus(); input.select(); });
  return box;
}
export const waChatTitle = (c: WhatsappChat): string => c.isSelf ? "Você (este número)" : c.isDono === true ? (c.alias ?? c.name ?? "Você (dono)") : (c.alias ?? c.name ?? ctx.fmtPhone(c.number));
/**
 * Seleção em massa na lista do WhatsApp ("Selecionar"): marca várias conversas e exclui ou limpa de uma vez.
 * Excluir é só tirar da lista (o agente continua de onde parou); uma gravação só na máquina. Limpar histórico zera o
 * agente de cada uma, direto; no meu-bot-crm guarda cada conversa no CRM antes, e a que não guardou não é
 * limpa. Uma linha de auditoria por contato nos dois casos.
 */
let waSelecao: Set<string> | null = null;
type WaLimpezaMassa = { fase: "rodando" | "fim"; numeros: string[]; feito: number; limpas: number; puladas: { numero: string; motivo: string }[] };
let waLimpeza: WaLimpezaMassa | null = null;
function waLimpezaBox(l: WaLimpezaMassa): HTMLElement {
  const box = el("div", "wa-clear");
  box.addEventListener("click", (ev) => ev.stopPropagation());
  const n = l.numeros.length;
  if (l.fase === "rodando") { box.append(el("span", "wa-clear-text", `${ctx.crmProprio() ? "Guardando no CRM e limpando" : "Limpando"} ${Math.min(l.feito + 1, n)} de ${n}…`)); return box; }
  // Fim: quantas limparam e quais ficaram de fora (sessão principal do agente, ou não guardou no CRM).
  const acoes = el("div", "wa-clear-actions");
  box.append(el("strong", "", `${l.limpas} ${l.limpas === 1 ? "conversa limpa" : "conversas limpas"}${l.puladas.length > 0 ? ` · ${l.puladas.length} ${l.puladas.length === 1 ? "ficou" : "ficaram"} de fora` : ""}`));
  for (const p of l.puladas) { const c = ctx.waChats.find((x) => x.number === p.numero); box.append(el("span", "wa-clear-err", `${c !== undefined ? waChatTitle(c) : ctx.fmtPhone(p.numero)}: ${p.motivo}`)); }
  const ok = el("button", "btn", "OK"); ok.type = "button";
  ok.addEventListener("click", () => { waLimpeza = null; ctx.renderSidebar(); });
  acoes.append(ok); box.append(acoes);
  return box;
}
/** Uma por vez (cada uma é um SSH com o gateway): plano → guardar no CRM (meu-bot-crm) → limpar. */
async function limparSelecionadas(numeros: string[]): Promise<void> {
  const l: WaLimpezaMassa = { fase: "rodando", numeros, feito: 0, limpas: 0, puladas: [] };
  waLimpeza = l; waSelecao = null; ctx.renderSidebar();
  for (const numero of numeros) {
    try {
      const plano = await window.meuBot.whatsappClearPlan(numero);
      if (plano.own + plano.shared === 0) l.puladas.push({ numero, motivo: "não há histórico na máquina" });
      else if (plano.shared > 0) l.puladas.push({ numero, motivo: "está na sessão principal do agente; limpe sozinha" });
      else {
        let guardou = true;
        if (ctx.crmProprio()) { try { await window.meuBot.archiveWhatsappToCrm(numero); } catch (err) { guardou = false; l.puladas.push({ numero, motivo: `não guardou no CRM (${ipcErrorText(err)}); não foi limpa` }); } }
        if (guardou) {
          await window.meuBot.clearWhatsapp(numero, false);
          l.limpas++;
          cacheDrop(`waThread:${numero}`);
          const g = ctx.waChatPages.get(`wa-${numero}`); if (g !== undefined && g.page.tabEl !== null) ctx.closePage(g.page);
        }
      }
    } catch (err) { l.puladas.push({ numero, motivo: ipcErrorText(err) }); }
    l.feito++;
    if (waLimpeza === l) ctx.renderSidebar();
  }
  l.fase = "fim";
  if (waLimpeza === l) ctx.renderSidebar();
  void refreshWaChats();
}
function waSelecaoBar(rows: readonly WhatsappChat[]): HTMLElement {
  const bar = el("div", "wa-sel-bar");
  if (waSelecao === null) {
    const sel = el("button", "btn btn-ghost btn-small", "Selecionar"); sel.type = "button"; sel.title = "Marcar várias conversas para excluir ou limpar o histórico de uma vez";
    sel.disabled = waLimpeza !== null && waLimpeza.fase === "rodando";
    sel.addEventListener("click", () => { waSelecao = new Set(); waClear = null; waRename = null; if (waLimpeza?.fase !== "rodando") waLimpeza = null; ctx.renderSidebar(); });
    bar.append(sel);
    return bar;
  }
  const s = waSelecao;
  const visiveis = rows.filter((r) => !isWaDeleted(r));
  const todas = visiveis.length > 0 && visiveis.every((r) => s.has(r.number));
  bar.append(el("span", "wa-sel-count", s.size === 0 ? "Nenhuma marcada" : `${s.size} marcada${s.size === 1 ? "" : "s"}`));
  const tudo = el("button", "btn btn-ghost btn-small", todas ? "Desmarcar todas" : "Marcar todas"); tudo.type = "button";
  tudo.addEventListener("click", () => { if (todas) s.clear(); else for (const r of visiveis) s.add(r.number); ctx.renderSidebar(); });
  const del = el("button", "btn btn-bad btn-small", s.size === 0 ? "Excluir" : `Excluir ${s.size}`); del.type = "button"; del.disabled = s.size === 0;
  del.title = "Tira da lista; o agente não esquece nada e a conversa volta se a pessoa escrever";
  del.addEventListener("click", () => { void excluirSelecionadas([...s]); });
  const limpar = el("button", "btn btn-bad btn-small", s.size === 0 ? "Limpar histórico" : `Limpar histórico ${s.size}`); limpar.type = "button"; limpar.disabled = s.size === 0;
  limpar.title = "O agente esquece o que conversou com cada uma e recomeça do zero (pede confirmação)";
  // Limpa direto, sem a caixa de confirmar (27 out); a que não guardar no CRM continua sem limpar.
  limpar.addEventListener("click", () => { void limparSelecionadas([...s]); });
  const cancel = el("button", "btn btn-small", "Cancelar"); cancel.type = "button";
  cancel.addEventListener("click", () => { waSelecao = null; waLimpeza = null; ctx.renderSidebar(); });
  bar.append(tudo, del, limpar, cancel);
  return bar;
}
async function excluirSelecionadas(numbers: string[]): Promise<void> {
  if (numbers.length === 0) return;
  try {
    // A máquina aceita até 200 ajustes por gravação.
    for (let i = 0; i < numbers.length; i += 200) await window.meuBot.markWhatsapp(numbers.slice(i, i + 200).map((number) => ({ number, deleted: true, archived: false })));
    for (const n of numbers) { const g = ctx.waChatPages.get(`wa-${n}`); if (g !== undefined && g.page.tabEl !== null) ctx.closePage(g.page); }
    waSelecao = null;
    void refreshWaChats();
  } catch (err) { ctx.sidebarList.prepend(el("div", "sidebar-empty wa-menu-err", `Não deu para excluir: ${ipcErrorText(err)}`)); }
  ctx.renderSidebar();
}
export function paintWaSidebar(query: string): void {
  ctx.sidebarList.replaceChildren();
  const q = normalize(query.trim());
  const showHidden = ctx.sidebarArchived.checked;
  // Excluir é só tirar da vista da pessoa: no meu-bot-admin o interruptor mostra também as excluídas (para restaurar).
  const showDeleted = showHidden && ctx.caps.supportAdmin;
  const rows = ctx.waChats.filter((c) => (showDeleted || !isWaDeleted(c)) && (showHidden || !isWaArchived(c)) && (q === "" || normalize(`${c.alias ?? ""} ${c.name ?? ""} ${c.number} ${ctx.fmtPhone(c.number)}`).includes(q)));
  if (rows.length === 0) {
    const msg = waChatsErr !== null && ctx.waChats.length === 0 ? `Não consegui ler as conversas: ${waChatsErr}`
      : waChatsInflight !== null && ctx.waChats.length === 0 ? "Carregando conversas do WhatsApp…"
      : q !== "" ? "Nada encontrado." : "Nenhuma conversa do WhatsApp ainda.";
    ctx.sidebarList.appendChild(msg === "Carregando conversas do WhatsApp…" ? carregando(msg) : el("div", "sidebar-empty", msg));
    ctx.sidebarList.append(...ctx.waGroupsSection(q));
    return;
  }
  ctx.sidebarList.appendChild(waSelecaoBar(rows));
  if (waLimpeza !== null) ctx.sidebarList.appendChild(waLimpezaBox(waLimpeza));
  for (const group of groupByDate(rows)) {
    ctx.sidebarList.appendChild(el("div", "sidebar-group", group.label));
    for (const row of group.items) {
      const archived = isWaArchived(row);
      const deleted = isWaDeleted(row);
      const item = el("div", `sidebar-item wa-item${ctx.pageActive?.id === `wa-${row.number}` ? " active" : ""}${archived || deleted ? " archived" : ""}`);
      item.dataset["number"] = row.number;
      const menu = el("button", "si-menu", "…");
      menu.type = "button"; menu.title = "Ações";
      menu.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void window.meuBot.showWhatsappMenu(row.number, { archived, paused: row.paused, deleted, pausaRotulo: pausaAteTexto(row.pausaAte).replace(/^até /, "volta às ").replace(/^volta às amanhã, /, "volta amanhã às ") || null, dono: row.isSelf || row.isDono === true }).then((a) => waMenuAction(row, a));
      });
      if (waSelecao !== null) {
        const sel = waSelecao;
        const cb = el("input", "wa-sel-check"); cb.type = "checkbox"; cb.checked = sel.has(row.number); cb.disabled = deleted;
        cb.addEventListener("click", (ev) => ev.stopPropagation());
        cb.addEventListener("change", () => { if (cb.checked) sel.add(row.number); else sel.delete(row.number); ctx.renderSidebar(); });
        item.append(cb);
        item.classList.toggle("wa-sel-on", sel.has(row.number));
      }
      // Etiqueta curta: ⏸ e quanto falta ("⏸ 1h58"); sem prazo, só o ⏸. A explicação inteira fica no title e no cabeçalho da conversa.
      const restante = row.paused ? pausaRestanteTexto(row.pausaAte) : "";
      const rotuloPausa = row.paused ? `⏸${restante ? ` ${restante}` : ""}` : "";
      const etapa = waPausaEtapa.get(row.number);
      item.append(el("span", `wa-item-dot${row.paused ? " paused" : ""}`), el("span", "si-title", waChatTitle(row)));
      if (row.isDono === true && !row.isSelf) item.append(el("span", "si-tab", "dono"));
      if (etapa === "aguarde") item.append(el("span", "si-tab wa-aguarde", "aguarde…"));
      else if (etapa === "pronto") item.append(el("span", "si-tab wa-pronto", "✓ pronto"));
      else if (row.paused) item.append(el("span", "si-tab", rotuloPausa));
      if (deleted) item.append(el("span", "si-tab", "excluída"));
      item.append(el("span", "si-date", shortDate(row.updatedAt)), menu);
      const quemE = row.isSelf ? "Mensagens que você manda para o próprio número" : row.isDono === true ? `Dono: fala com o agente do celular dele (${ctx.fmtPhone(row.number)})` : ctx.fmtPhone(row.number);
      item.title = `${quemE}${row.paused ? ` · pausado${pausaAteTexto(row.pausaAte) ? ` ${pausaAteTexto(row.pausaAte)}` : ""}: o agente não responde` : ""} · Option+clique: abre ao lado (tela dividida)`;
      // Selecionando, o clique na linha marca/desmarca em vez de abrir a conversa.
      item.addEventListener("click", (ev) => { if (waSelecao === null) { ctx.openWaChat(row, ev.altKey); return; } if (deleted) return; if (waSelecao.has(row.number)) waSelecao.delete(row.number); else waSelecao.add(row.number); ctx.renderSidebar(); });
      ctx.sidebarList.appendChild(item);
      if (waClear?.number === row.number) ctx.sidebarList.appendChild(waClearBox(waClear));
      if (waArchiveNote?.number === row.number) ctx.sidebarList.appendChild(el("div", `wa-archive-note${waArchiveNote.bad ? " bad" : ""}`, waArchiveNote.text));
      if (waRename === row.number) ctx.sidebarList.appendChild(waRenameBox(row));
    }
  }
  ctx.sidebarList.append(...ctx.waGroupsSection(q));
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarConversas(): void {
  listModeEl.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
    const mode = b?.dataset["mode"];
    if (mode === "bot" || mode === "whatsapp") setListMode(mode);
  });
  // O atalho da caixa de texto inverte a lista e, com a lateral fechada, abre junto: trocar de lista
  // sem ver a lista não serve para nada. Já aberta, não mexe (senão repetiria a animação de entrada).
  // A barra de cima não volta: quem está no modo limpo (Cmd+B) continua nele, só com a lista à mostra.
  listModeBtn.addEventListener("click", () => {
    setListMode(getListMode() === "whatsapp" ? "bot" : "whatsapp");
    if (ctx.sidebarEl.hidden) ctx.toggleSidebar(true);
  });
}
