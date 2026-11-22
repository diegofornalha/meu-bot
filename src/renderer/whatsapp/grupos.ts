import type { WhatsappGroups, WhatsappGroup, WhatsappGroupPatch, WhatsappGroupMenuAction, WhatsappThreadMessage } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import type { PageTab } from "../lib/pages-types.js";
import { hostLabel } from "../lib/probe-text.js";
import { grupoReferenceText } from "../lib/reference.js";
import { normalize, shortDate } from "../lib/sidebar.js";
import { TUTORIAIS } from "../lib/tutoriais.js";
import { parseWaNumbers } from "../lib/whatsapp-resposta.js";
import { grupoAlvo, quemEscolhido, GRUPOS_AVISO, GRUPOS_QUEM_NOTA } from "../lib/whatsapp-grupos.js";
import { ctx, ehRemoto } from "../app/ctx.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { registrarPassos } from "../tutoriais/passos.js";

// ---- Grupos do WhatsApp: a área "Grupos" no fim da lista, a página de cada grupo (só leitura, com o autor de cada
// mensagem) e os passos do tutorial 10. As regras (nunca "*", nunca ligar sem quem aciona, desligar o último fecha o
// canal de grupos) moram no main (whatsapp-grupos-core.ts); aqui só a tela. Lidos a cada minuto no modo WhatsApp.
export let waGroups: WhatsappGroups | null = null;
let waGroupsErr: string | null = null;
export let waGroupsInflight: Promise<void> | null = null;
export let waGroupsAt = 0;
/** "Atualizar lista" em andamento (o gateway fica parado ~30 s) e o último recado da área. */
let waGroupsListing = false;
let waGroupsMsg: { text: string; bad: boolean } | null = null;
/** Grupo com gravação em andamento (desliga os botões dele). */
let waGroupSaving: string | null = null;
/** O agente já respondeu neste grupo (jid → sim/não), para o passo "Testar" do tutorial 10. */
export const waGroupReplied = new Map<string, boolean>();
const waGroupCheckedAt = new Map<string, number>();
export const TUT_GRUPOS = TUTORIAIS.find((t) => t.id === "whatsapp-grupos") ?? null;
const waGroupsOpenKey = (): string => `waGruposAberto:${ctx.windowHost}`;
const waGrupoAlvoKey = (): string => `waGrupoAlvo:${ctx.windowHost}`;
function waGroupsOpen(): boolean { try { return localStorage.getItem(waGroupsOpenKey()) !== "0"; } catch { return true; } }
export function loadGrupoAlvo(): string | null { try { return localStorage.getItem(waGrupoAlvoKey()); } catch { return null; } }
function saveGrupoAlvo(jid: string): void { try { localStorage.setItem(waGrupoAlvoKey(), jid); } catch { /* opcional */ } }
export const waGroupTitle = (g: WhatsappGroup): string => g.apelido ?? g.nome ?? "Grupo sem nome";
const WA_GROUP_AGENTE: Record<WhatsappGroup["agente"], string> = { mencao: "agente: só quando chamado", sempre: "agente: sempre", desligado: "agente desligado" };
/** Nome de um número para a tela: apelido/pushname das conversas, senão o telefone formatado. */
const waNumberLabel = (n: string): string => { const c = ctx.waChats.find((x) => x.number === n); const nome = c?.alias ?? c?.name ?? null; return nome !== null ? `${nome} (${ctx.fmtPhone(n)})` : ctx.fmtPhone(n); };
const waQuemTexto = (q: WhatsappGroups): string =>
  q.quemAciona === "todos" ? "qualquer pessoa do grupo" : q.quemAciona.length === 0 ? "ninguém escolhido ainda" : q.quemAciona.map(waNumberLabel).join(", ");

/** Grupos da última vez (cache desta janela), uma vez: a área aparece na hora e a leitura real troca por baixo. */
let waGroupsFromCache = false;
function waGroupsSeed(): void {
  if (waGroups !== null || waGroupsFromCache) return;
  waGroupsFromCache = true;
  const c = ctx.cacheRead<WhatsappGroups>("waGroups");
  if (c !== null) waGroups = c.value;
}
export function refreshWaGroups(): Promise<void> {
  if (waGroupsInflight !== null) return waGroupsInflight;
  waGroupsSeed();
  waGroupsInflight = (async () => {
    try { waGroups = await window.meuBot.whatsappGroups(); waGroupsErr = null; ctx.cacheWrite("waGroups", waGroups); }
    catch (err) { waGroupsErr = ipcErrorText(err); }
    finally { waGroupsInflight = null; waGroupsAt = Date.now(); }
    afterWaGroups();
  })();
  return waGroupsInflight;
}
/** Grupos mudaram: páginas abertas, lista e guia acompanham. */
function afterWaGroups(): void {
  // O agente já respondeu no grupo do tutorial 10: é um fato que não se desfaz (limpar o grupo não reabre o tutorial).
  const alvo = grupoAlvo(waGroups, loadGrupoAlvo());
  if (TUT_GRUPOS !== null && alvo !== null && (alvo.agenteRespondeu === true || waGroupReplied.get(alvo.jid) === true) && !ctx.loadGuideFlags(TUT_GRUPOS).gruposTested) ctx.saveGuideFlag(TUT_GRUPOS, "gruposTested");
  for (const g of waGroupPages.values()) {
    const x = waGroups?.grupos.find((y) => y.jid === g.grupo.jid);
    if (x !== undefined) g.grupo = x;
    paintWaGroupTab(g);
    if (ctx.pageShown(g.page)) renderWaGroup(g);
  }
  if (ctx.getListMode() === "whatsapp") ctx.renderSidebar();
  ctx.paintGuide();
}
/** A máquina deixa ligar/desligar grupos e escolher quem conversa pelo app? (capacidade `grupos`; sem status ainda, não). */
const gruposGerenciaveis = (): boolean => ctx.waStatus !== null && ctx.waStatus.capacidades.grupos;
/**
 * `waGroups.skill` = a máquina consegue listar os grupos pelo WhatsApp: no OpenClaw, a skill whatsapp-grupos; no Hermes,
 * o bridge pareado (hermes-grupos-listar.ts). Sem isso, o motivo muda conforme o agente: no Hermes (sem guarda possível)
 * é o pareamento; no OpenClaw é a guarda, que traz a skill.
 */
const DICA_SEM_SKILL = (): string => ctx.waStatus !== null && !ctx.waStatus.capacidades.guarda
  ? "O WhatsApp do Hermes não está pareado nesta máquina: faça o tutorial 3 e volte aqui."
  : "A skill whatsapp-grupos não está nesta máquina: atualize a guarda do WhatsApp pelo seletor.";
const GRUPOS_SEM_SUPORTE = "O agente desta máquina ainda não permite ligar o grupo nem escolher quem conversa pelo app. Dá para ler e limpar o histórico; para mudar quem responde, ajuste na própria máquina.";
const GRUPOS_SEM_CONEXAO = "O WhatsApp desta máquina não está conectado. Conecte pelo tutorial 3 (WhatsApp) e volte aqui: aí dá para ligar o grupo e escolher quem conversa.";
/** Por que os grupos não podem ser gerenciados agora: falta conectar o WhatsApp (OpenClaw, Hermes) ou o agente não tem isso. */
const gruposIndisponivel = (): string => (ctx.waStatus !== null && ctx.waStatus.capacidades.gruposAoConectar ? GRUPOS_SEM_CONEXAO : GRUPOS_SEM_SUPORTE);
/** Sem a capacidade, a seção explica em vez de oferecer botões que falhariam. Devolve true quando bloqueou. */
function gruposIndisponivelNota(container: HTMLElement): boolean {
  if (gruposGerenciaveis()) return false;
  container.append(el("p", "hint guide-pair-note", gruposIndisponivel()));
  return true;
}
async function setWaGroup(jid: string, patch: WhatsappGroupPatch): Promise<boolean> {
  if (!gruposGerenciaveis()) { waGroupsMsg = { text: gruposIndisponivel(), bad: true }; afterWaGroups(); return false; }
  waGroupSaving = jid; waGroupsMsg = null; afterWaGroups();
  try { waGroups = await window.meuBot.setWhatsappGroup(jid, patch); ctx.cacheWrite("waGroups", waGroups); return true; }
  catch (err) { waGroupsMsg = { text: `Não deu para mudar: ${ipcErrorText(err)}`, bad: true }; return false; }
  finally { waGroupSaving = null; afterWaGroups(); }
}
async function listarWaGroups(): Promise<void> {
  if (waGroupsListing) return;
  if (!window.confirm("Atualizar a lista de grupos pelo WhatsApp?\n\nO WhatsApp do agente fica parado uns 30 segundos. As mensagens que chegarem nesse tempo são entregues quando ele voltar.")) return;
  waGroupsListing = true; waGroupsMsg = null; afterWaGroups();
  try { waGroups = await window.meuBot.refreshWhatsappGroups(); ctx.cacheWrite("waGroups", waGroups); waGroupsMsg = { text: `✓ Lista atualizada: ${waGroups.grupos.length} ${waGroups.grupos.length === 1 ? "grupo" : "grupos"}.`, bad: false }; }
  catch (err) { waGroupsMsg = { text: `Não deu para atualizar a lista: ${ipcErrorText(err)}`, bad: true }; }
  finally { waGroupsListing = false; afterWaGroups(); }
}
/** Ligar pelo menu: com a lista de quem aciona já escolhida, liga em "só quando chamado"; sem ela, o tutorial 10. */
async function ligarWaGroup(g: WhatsappGroup): Promise<void> {
  saveGrupoAlvo(g.jid);
  if (waGroups === null || !quemEscolhido(waGroups) || TUT_GRUPOS === null) { if (TUT_GRUPOS !== null) ctx.openGuide(TUT_GRUPOS); return; }
  if (!window.confirm(`Ligar o agente em "${waGroupTitle(g)}"?\n\nEle responde só quando alguém da lista o chamar: ${waQuemTexto(waGroups)}.\n\n${GRUPOS_AVISO}`)) return;
  await setWaGroup(g.jid, { agente: "mencao" });
}
function waGroupMenuAction(g: WhatsappGroup, a: WhatsappGroupMenuAction | null): void {
  if (a === null) return;
  if (a === "group-copy-id") { ctx.copyReference(grupoReferenceText(g, hostLabel(ctx.windowHost))); return; }
  if (a === "groups-refresh") { void listarWaGroups(); return; }
  if (a === "group-who") { openWaGroup(g, true); return; }
  if (a === "group-off") { void setWaGroup(g.jid, { agente: "desligado" }); return; }
  if (a === "group-clear") { void startWaGroupClear(g); return; }
  if (a === "group-delete") { void markWaGroup(g, true); return; }
  if (a === "group-restore") { void markWaGroup(g, false); return; }
  if (a === "group-rename") { void renameWaGroup(g); return; }
  void ligarWaGroup(g);
}
/** Apelido do grupo (marca na máquina; os dois apps veem). Vazio apaga e volta ao nome do WhatsApp. */
async function renameWaGroup(g: WhatsappGroup): Promise<void> {
  const v = await ctx.perguntar(`Apelido do grupo${g.nome !== null ? ` (${g.nome})` : ""}:`, g.apelido ?? g.nome ?? "");
  if (v === null) return;
  const alias = v.replace(/\s+/g, " ").trim().slice(0, 80);
  const apelido = alias === "" ? null : alias;
  if (waGroups !== null) { waGroups = { ...waGroups, grupos: waGroups.grupos.map((x) => (x.jid === g.jid ? { ...x, apelido } : x)) }; ctx.cacheWrite("waGroups", waGroups); }
  waGroupsMsg = null; afterWaGroups();
  try { await window.meuBot.renameWhatsappGroup(g.jid, alias); }
  catch (err) { waGroupsMsg = { text: `Não deu para renomear "${waGroupTitle(g)}": ${ipcErrorText(err)}`, bad: true }; void refreshWaGroups(); }
}
/** Excluir/restaurar na lista: marca na máquina e some/volta na hora (otimista); em erro, relê os grupos e avisa. */
async function markWaGroup(g: WhatsappGroup, deleted: boolean): Promise<void> {
  if (waGroups !== null) { waGroups = { ...waGroups, grupos: waGroups.grupos.map((x) => (x.jid === g.jid ? { ...x, deleted } : x)) }; ctx.cacheWrite("waGroups", waGroups); }
  waGroupsMsg = null; afterWaGroups();
  try { await window.meuBot.markWhatsappGroup(g.jid, deleted); }
  catch (err) { waGroupsMsg = { text: `${deleted ? "Não deu para excluir" : "Não deu para restaurar"} "${waGroupTitle(g)}": ${ipcErrorText(err)}`, bad: true }; void refreshWaGroups(); }
}
/**
 * "Limpar histórico" de um grupo: o menu já limpa, sem perguntar (escolha do dono). A caixa embaixo
 * do grupo só mostra o andamento e, quando é o caso, o motivo de não ter limpado. A conversa vai
 * para o CRM antes; se isso falhar, nada é limpo, que é o que torna o clique direto seguro.
 */
type WaGroupClear = {
  jid: string; nome: string;
  fase: "plano" | "parado" | "rodando";
  err: string | null;
  passo: string;
};
let waGroupClear: WaGroupClear | null = null;

async function startWaGroupClear(g: WhatsappGroup): Promise<void> {
  const base = { jid: g.jid, nome: waGroupTitle(g), passo: "" };
  waGroupClear = { ...base, fase: "plano", err: null };
  ctx.renderSidebar();
  try {
    const plano = await window.meuBot.whatsappGroupClearPlan(g.jid);
    if (waGroupClear?.jid !== g.jid) return;
    // Sem histórico não há o que limpar: avisa em vez de rodar à toa.
    if (plano.sessoes === 0) { waGroupClear = { ...base, fase: "parado", err: "O agente ainda não tem histórico neste grupo." }; ctx.renderSidebar(); return; }
    void runWaGroupClear({ ...base, fase: "rodando", err: null });
    return;
  } catch (err) {
    if (waGroupClear?.jid !== g.jid) return;
    waGroupClear = { ...base, fase: "parado", err: ipcErrorText(err) };
  }
  ctx.renderSidebar();
}

/** Guardar no CRM e só então limpar. Falhou o CRM, nada é limpo: a mesma regra da conversa de contato. */
async function runWaGroupClear(c: WaGroupClear): Promise<void> {
  const andar = (passo: string): void => { waGroupClear = { ...c, fase: "rodando", passo }; ctx.renderSidebar(); };
  try {
    if (ctx.crmProprio()) {
      andar("Guardando a conversa no CRM…");
      await window.meuBot.archiveWhatsappGroupToCrm(c.jid);
      if (waGroupClear?.jid !== c.jid) return;
    }
    andar("Limpando o histórico…");
    await window.meuBot.clearWhatsappGroup(c.jid);
    // Sem aviso de sucesso: a conversa somindo da aba já diz que deu certo. O que foi guardado no
    // CRM está na caixa do grupo, com o comentário do arquivamento, e na auditoria da máquina.
    waGroupClear = null;
    void listarWaGroups();
  } catch (err) {
    if (waGroupClear?.jid !== c.jid) return;
    waGroupClear = { ...c, fase: "parado", err: ipcErrorText(err) };
  }
  ctx.renderSidebar();
}

/** Só andamento e motivo de parada: a confirmação saiu, o menu limpa direto. */
function waGroupClearBox(c: WaGroupClear): HTMLElement {
  const box = el("div", "wa-clear");
  if (c.fase === "plano") { box.append(el("span", "wa-clear-text", "Consultando…")); return box; }
  if (c.fase === "rodando") { box.append(el("span", "wa-clear-text", c.passo)); return box; }
  // Parado: nada foi limpo. Diz por quê e deixa a pessoa fechar o aviso.
  box.append(el("span", "wa-clear-text wa-clear-err", c.err ?? "Não deu para limpar."));
  const acoes = el("div", "wa-clear-actions");
  const ok = el("button", "btn", "Entendi"); ok.type = "button";
  ok.addEventListener("click", () => { waGroupClear = null; ctx.renderSidebar(); });
  acoes.append(ok); box.append(acoes);
  return box;
}

/** Área "Grupos (N)" no fim da lista do WhatsApp: recolhível; cada grupo com o selo do agente e o menu "…". */
export function waGroupsSection(q: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  waGroupsSeed();
  // Excluído é só tirar da vista (como na conversa): o admin, com o interruptor de arquivadas, vê também os excluídos para restaurar.
  const showDeleted = ctx.sidebarArchived.checked && ctx.caps.supportAdmin;
  const visiveis = (waGroups?.grupos ?? []).filter((g) => showDeleted || !g.deleted);
  const grupos = visiveis.filter((g) => q === "" || normalize(`${g.nome ?? ""} ${g.jid}`).includes(q));
  const open = waGroupsOpen();
  const head = el("button", "sidebar-group wa-groups-head", `${open ? "▾" : "▸"} Grupos${waGroups !== null ? ` (${visiveis.length})` : ""}`); head.type = "button";
  head.title = open ? "Recolher os grupos" : "Mostrar os grupos";
  head.addEventListener("click", () => { try { localStorage.setItem(waGroupsOpenKey(), open ? "0" : "1"); } catch { /* opcional */ } ctx.renderSidebar(); });
  out.push(head);
  if (!open) return out;
  if (waGroups?.todosAdmitidos === true) out.push(el("div", "wa-archive-note bad", "⚠ A configuração admite TODOS os grupos deste número. Ligue o agente só nos grupos certos (menu \"…\" de cada um) para fechar o resto."));
  if (waGroupsMsg !== null) out.push(el("div", `wa-archive-note${waGroupsMsg.bad ? " bad" : ""}`, waGroupsMsg.text));
  if (waGroupsListing) out.push(el("div", "wa-archive-note", "Atualizando a lista de grupos… o WhatsApp do agente volta em uns 30 segundos."));
  if (waGroups === null) { out.push(waGroupsErr !== null ? el("div", "sidebar-empty", `Não consegui ler os grupos: ${waGroupsErr}`) : carregando("Lendo os grupos…", "lateral-grupos")); return out; }
  if (grupos.length === 0) {
    const empty = el("div", "sidebar-empty wa-groups-empty");
    if (q !== "") empty.textContent = "Nenhum grupo com esse nome.";
    else {
      empty.append(el("span", "", waGroups.cacheEm === null ? "Nenhum grupo listado ainda · " : "Nenhum grupo · "));
      const b = el("button", "linkish", "Atualizar lista"); b.type = "button"; b.disabled = waGroupsListing || !waGroups.skill;
      b.title = waGroups.skill ? "Lê os grupos pelo WhatsApp (o agente fica parado ~30 s)" : DICA_SEM_SKILL();
      b.addEventListener("click", () => { void listarWaGroups(); });
      empty.append(b);
    }
    out.push(empty);
    return out;
  }
  for (const g of grupos) {
    const item = el("div", `sidebar-item wa-item wa-group-item${ctx.pageActive?.id === `wag-${g.jid}` ? " active" : ""}${g.deleted ? " archived" : ""}`);
    item.dataset["jid"] = g.jid;
    item.append(el("span", `wa-group-dot ${g.agente}`), el("span", "si-title", waGroupTitle(g)));
    item.append(el("span", `si-tab wa-group-badge ${g.agente}`, g.agente === "desligado" ? "desligado" : g.agente === "mencao" ? "quando chamado" : "sempre"));
    if (g.deleted) item.append(el("span", "si-tab", "excluído"));
    if (waGroupSaving === g.jid) item.append(el("span", "si-date", "gravando…"));
    else if (g.updatedAt !== null) item.append(el("span", "si-date", shortDate(g.updatedAt)));
    const menu = el("button", "si-menu", "…"); menu.type = "button"; menu.title = "Ações do grupo";
    menu.addEventListener("click", (ev) => { ev.stopPropagation(); void window.meuBot.showWhatsappGroupMenu(g.jid, { agente: g.agente, deleted: g.deleted }).then((a) => waGroupMenuAction(g, a)); });
    item.append(menu);
    item.title = `${waGroupTitle(g)}${g.membros !== null ? ` · ${g.membros} membros` : ""} · ${WA_GROUP_AGENTE[g.agente]}`;
    item.title = "Option+clique: abre ao lado (tela dividida)";
    item.addEventListener("click", (ev) => openWaGroup(g, false, ev.altKey));
    out.push(item);
    if (waGroupClear?.jid === g.jid) out.push(waGroupClearBox(waGroupClear));
  }
  return out;
}

interface WaGroupPage { page: PageTab; grupo: WhatsappGroup; msgs: WhatsappThreadMessage[]; err: string | null; loaded: boolean; inflight: Promise<void> | null; timer: number | null; editQuem: boolean; shown?: string | undefined; /** O que está na tela veio do cache; a leitura real ainda não chegou. */ stale?: boolean }
const waGroupPages = new Map<string, WaGroupPage>();
function paintWaGroupTab(g: WaGroupPage): void {
  g.page.title = `👥 ${waGroupTitle(g.grupo)}`;
  const t = g.page.tabEl?.querySelector(".tab-title"); if (t !== null && t !== undefined) t.textContent = g.page.title;
}
function openWaGroup(grupo: WhatsappGroup, editQuem = false, aoLado = false): void {
  const id = `wag-${grupo.jid}`;
  let g = waGroupPages.get(id);
  if (g === undefined) {
    const panel = el("section", "wa-chat-panel"); panel.hidden = true;
    ctx.panelsEl.append(panel);
    const created: WaGroupPage = { page: null as unknown as PageTab, grupo, msgs: [], err: null, loaded: false, inflight: null, timer: null, editQuem };
    // A conversa da última vez aparece na hora (cache desta janela, até 200 mensagens); a leitura real troca por baixo.
    const cached = ctx.cacheRead<WhatsappThreadMessage[]>(`waGroupThread:${grupo.jid}`);
    if (cached !== null && cached.value.length > 0) { created.msgs = cached.value; created.loaded = true; created.stale = true; }
    created.page = ctx.definePage(id, `👥 ${waGroupTitle(grupo)}`, panel, () => renderWaGroup(created));
    waGroupPages.set(id, created);
    g = created;
  } else { g.grupo = grupo; if (editQuem) g.editQuem = true; }
  if (aoLado) { ctx.openPage(g.page, false); ctx.splitOn(g.page); } else ctx.openPage(g.page);
  paintWaGroupTab(g);
  ctx.renderSidebar();
}
function refreshWaGroupThread(g: WaGroupPage): Promise<void> {
  if (g.inflight !== null) return g.inflight;
  if (g.timer !== null) { clearTimeout(g.timer); g.timer = null; }
  g.inflight = (async () => {
    try { g.msgs = await window.meuBot.whatsappGroupThread(g.grupo.jid); g.err = null; g.stale = false; ctx.cacheWrite(`waGroupThread:${g.grupo.jid}`, g.msgs.slice(-200)); noteGroupReplied(g.grupo.jid, g.msgs); }
    catch (err) { g.err = ipcErrorText(err); }
    finally { g.loaded = true; g.inflight = null; }
    if (ctx.pageShown(g.page)) { g.timer = window.setTimeout(() => { g.timer = null; void refreshWaGroupThread(g); }, 8_000); renderWaGroup(g); }
  })();
  return g.inflight;
}
function noteGroupReplied(jid: string, msgs: readonly WhatsappThreadMessage[]): void {
  const yes = msgs.some((m) => m.role === "agent");
  waGroupCheckedAt.set(jid, Date.now());
  if (waGroupReplied.get(jid) !== yes) { waGroupReplied.set(jid, yes); if (yes && TUT_GRUPOS !== null && grupoAlvo(waGroups, loadGrupoAlvo())?.jid === jid && !ctx.loadGuideFlags(TUT_GRUPOS).gruposTested) ctx.saveGuideFlag(TUT_GRUPOS, "gruposTested"); ctx.paintGuide(); }
}
/** Passo "Testar" do tutorial 10: relê a conversa do grupo (no máximo a cada 8 s) até aparecer a resposta do agente. */
function checkGroupReplied(jid: string): void {
  if (waGroupReplied.get(jid) === true || Date.now() - (waGroupCheckedAt.get(jid) ?? 0) < 8_000) return;
  waGroupCheckedAt.set(jid, Date.now());
  void window.meuBot.whatsappGroupThread(jid).then((msgs) => noteGroupReplied(jid, msgs)).catch(() => undefined)
    .finally(() => { if (waGroupReplied.get(jid) !== true) window.setTimeout(() => { if (ctx.activeGuide()?.id === "whatsapp-grupos") ctx.paintGuide(); }, 8_500); });
}
/** Resumo no topo da página do grupo: como o agente está aqui e quem o aciona, com os atalhos. */
function waGroupSummary(g: WaGroupPage): HTMLElement {
  const box = el("div", "wa-group-summary");
  const q = waGroups;
  if (!gruposGerenciaveis()) {
    box.append(el("p", "hint", "Este app ainda não lê, nesta máquina, se o agente está ligado neste grupo."), el("p", "hint", gruposIndisponivel()));
    if (waGroupsMsg !== null && waGroupsMsg.bad) box.append(el("p", "hint guide-pair-note", waGroupsMsg.text));
    return box;
  }
  box.append(el("p", `wa-group-state ${g.grupo.agente}`, g.grupo.agente === "desligado" ? "O agente está desligado neste grupo: ele não lê nem responde nada aqui."
    : g.grupo.agente === "mencao" ? "O agente responde aqui só quando alguém da lista o menciona ou responde a uma mensagem dele."
      : "O agente lê tudo aqui e entra quando acha que ajuda."));
  if (q !== null) box.append(el("p", "hint", `Quem pode conversar com ele nos grupos: ${waQuemTexto(q)}${q.quemAcionaHerdado ? " (herdado das conversas diretas: escolha uma lista própria)" : ""}.`));
  const acts = el("div", "wa-group-acts");
  const quem = el("button", "btn btn-ghost btn-small", g.editQuem ? "Fechar a lista" : "Quem pode conversar…"); quem.type = "button";
  quem.addEventListener("click", () => { g.editQuem = !g.editQuem; grupoQuemDraft = null; renderWaGroup(g); });
  const saving = waGroupSaving === g.grupo.jid;
  const liga = el("button", `btn btn-small ${g.grupo.agente === "desligado" ? "btn-primary" : "btn-ghost"}`, saving ? "gravando…" : g.grupo.agente === "desligado" ? "Ligar o agente…" : "Desligar o agente"); liga.type = "button"; liga.disabled = saving;
  liga.addEventListener("click", () => { if (g.grupo.agente === "desligado") void ligarWaGroup(g.grupo); else void setWaGroup(g.grupo.jid, { agente: "desligado" }); });
  acts.append(quem, liga);
  box.append(acts);
  if (waGroupsMsg !== null && waGroupsMsg.bad) box.append(el("p", "hint guide-pair-note", waGroupsMsg.text));
  if (g.editQuem) renderGruposQuem(box, g.grupo);
  return box;
}
function renderWaGroup(g: WaGroupPage): void {
  const panel = g.page.panel;
  const first = panel.dataset["rendered"] !== "1";
  const atEnd = first || panel.scrollHeight - panel.scrollTop - panel.clientHeight < 60;
  let head = panel.querySelector<HTMLElement>(".wa-chat-head");
  let summary = panel.querySelector<HTMLElement>(".wa-group-summary");
  let list = panel.querySelector<HTMLElement>(".wa-chat-msgs");
  if (head === null || list === null || summary === null) {
    head = el("div", "wa-chat-head"); summary = el("div", "wa-group-summary"); list = el("div", "wa-chat-msgs");
    panel.replaceChildren(head, summary, list);
  }
  // ID do grupo (o mesmo do "Copiar ID" do menu): sessão atual do OpenClaw e o .jsonl do Claude Code; clique copia.
  const ref = grupoReferenceText(g.grupo, hostLabel(ctx.windowHost));
  const idBtn = el("button", "wa-chat-id", g.grupo.sessionId !== null ? `ID ${g.grupo.sessionId.slice(0, 8)}` : "ID"); idBtn.type = "button";
  idBtn.title = `${ref}\n\nClique para copiar`;
  idBtn.addEventListener("click", () => ctx.copyReference(ref));
  head.replaceChildren(el("strong", "", `👥 ${waGroupTitle(g.grupo)}`), el("span", "wa-chat-num", g.grupo.membros !== null ? `${g.grupo.membros} membros` : "grupo"), idBtn,
    el("span", "wa-chat-hint", g.stale === true ? "atualizando…" : "somente leitura · atualiza sozinho"));
  // O editor da lista tem campo de texto: só deixa de redesenhar o resumo enquanto há algo digitado nele. Botão com foco
  // (um "+ membro" recém-clicado) não segura o redesenho: senão o botão continua ali e cada clique repete o número.
  const foco = document.activeElement;
  const noCampo = foco instanceof HTMLInputElement && summary.contains(foco);
  if (!(noCampo && foco.value !== "")) {
    summary.replaceWith(summary = waGroupSummary(g));
    if (noCampo) summary.querySelector<HTMLInputElement>(".grupos-add input")?.focus();
  }
  panel.dataset["rendered"] = "1";
  const key = g.msgs.map(ctx.waMsgKey).join("\n");
  if (!g.loaded) { list.replaceChildren(ctx.waSkeleton()); g.shown = undefined; }
  else if (g.shown !== key) {
    list.replaceChildren();
    if (g.err !== null && g.msgs.length === 0) list.append(el("p", "hint wa-fade", `Não consegui ler a conversa do grupo: ${g.err}`));
    else if (g.msgs.length === 0) list.append(el("p", "hint wa-fade", g.grupo.sessionKey === null ? "O agente ainda não viu nenhuma mensagem deste grupo (ele só guarda a conversa dos grupos em que está ligado)." : "Sem mensagens ainda."));
    let lastDay = "";
    for (const m of g.msgs) {
      const day = new Date(m.at).toLocaleDateString("pt-BR");
      if (day !== lastDay) { list.append(el("div", "wa-day", day)); lastDay = day; }
      list.append(ctx.waBubble(m));
    }
    g.shown = key;
    if (atEnd) panel.scrollTo({ top: panel.scrollHeight, behavior: "auto" });
  }
  if (ctx.pageShown(g.page) && g.inflight === null && g.timer === null) void refreshWaGroupThread(g);
}

/** Rascunho da lista de quem aciona (editor do tutorial 10 e da página do grupo). */
let grupoQuemDraft: { nums: string[]; todosArmado: boolean; bad: string | null } | null = null;
/** "Quem pode conversar com o agente no grupo": só você por padrão; gente de casa pelos membros ou digitando; "todos" escondido atrás de aviso. */
export function renderGruposQuem(container: HTMLElement, grupo: WhatsappGroup): void {
  if (gruposIndisponivelNota(container)) return;
  const q = waGroups;
  if (q === null) { container.append(carregando("Lendo os grupos…")); return; }
  const self = q.self;
  // Hermes: a lista dos grupos é a das conversas diretas, e gravar por aqui só daria erro. Mostra a lista e onde mudar.
  if (q.quemListaUnica === true) {
    const box = el("div", "wa-list-editor grupos-quem");
    box.append(el("p", q.quemAciona === "todos" ? "guide-note bad" : "hint", `Hoje quem pode conversar com ele: ${waQuemTexto(q)}.`),
      el("p", "hint", "Neste agente, quem pode chamá-lo nos grupos é a mesma lista de quem ele responde no privado. Para mudar, use \"Quem o agente responde\", na tela do WhatsApp desta máquina."));
    container.append(box);
    return;
  }
  if (grupoQuemDraft === null) grupoQuemDraft = { nums: q.quemAciona === "todos" ? [] : [...new Set(q.quemAciona)].filter((n) => n !== self), todosArmado: false, bad: null };
  const d = grupoQuemDraft;
  const box = el("div", "wa-list-editor grupos-quem");
  if (q.quemAciona === "todos") box.append(el("p", "guide-note bad", "Hoje qualquer pessoa do grupo conversa com o agente. Salve uma lista abaixo para voltar ao controle."));
  else if (q.quemAcionaHerdado) box.append(el("p", "hint", "Ainda não há uma lista para os grupos. Comece por você: o número pessoal que você usa no grupo."));
  const chips = el("div", "grupos-chips");
  if (d.nums.length === 0) chips.append(el("span", "hint", "Ninguém na lista ainda."));
  for (const n of d.nums) {
    const chip = el("span", "grupos-chip", waNumberLabel(n));
    const x = el("button", "grupos-chip-x", "×"); x.type = "button"; x.title = "Tirar da lista";
    x.addEventListener("click", () => { d.nums = d.nums.filter((y) => y !== n); ctx.paintGuide(); afterWaGroups(); });
    chip.append(x); chips.append(chip);
  }
  box.append(chips);
  const membros = grupo.participantes.filter((n) => n !== self && !d.nums.includes(n));
  if (membros.length > 0) {
    const sug = el("div", "grupos-sug"); sug.append(el("span", "hint", "Membros do grupo:"));
    for (const n of membros) {
      const b = el("button", "btn btn-ghost btn-small", `+ ${waNumberLabel(n)}`); b.type = "button";
      b.addEventListener("click", () => { if (!d.nums.includes(n)) d.nums.push(n); ctx.paintGuide(); afterWaGroups(); });
      sug.append(b);
    }
    box.append(sug);
  }
  const row = el("div", "grupos-add");
  const input = el("input") as HTMLInputElement; input.type = "text"; input.placeholder = "Digite um número com DDD (ex. 11 99999-8888)";
  const add = el("button", "btn btn-ghost btn-small", "Adicionar"); add.type = "button";
  const doAdd = (): void => { const r = parseWaNumbers(input.value); for (const n of r.ok) if (n !== self && !d.nums.includes(n)) d.nums.push(n); d.bad = r.bad.length > 0 ? `Não entendi: ${r.bad.join(", ")}` : null; input.value = ""; ctx.paintGuide(); afterWaGroups(); };
  add.addEventListener("click", doAdd);
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); doAdd(); } });
  row.append(input, add);
  box.append(row);
  if (d.bad !== null) box.append(el("p", "hint guide-pair-note", d.bad));
  box.append(el("p", "hint", GRUPOS_QUEM_NOTA));
  const saving = waGroupSaving !== null;
  const save = el("button", "btn btn-primary btn-small", saving ? "gravando…" : "Salvar quem pode conversar"); save.type = "button";
  save.disabled = saving || d.nums.length === 0;
  save.addEventListener("click", () => { void setWaGroup(grupo.jid, { quemAciona: [...new Set(d.nums)].map((n) => `+${n}`) }).then((ok) => { if (ok) grupoQuemDraft = null; afterWaGroups(); }); });
  box.append(save);
  // "Todo mundo do grupo": não é uma opção da lista; fica recolhido, com aviso vermelho e confirmação extra.
  const det = el("details", "grupos-todos");
  det.append(el("summary", "", "Outras opções"));
  det.append(el("p", "guide-note bad", "Todo mundo do grupo: qualquer pessoa que estiver no grupo, hoje ou no futuro, conversa com o agente e gasta a sua conta. Só faz sentido em grupo pequeno, só de gente de casa e sem outro robô. Vale para todos os grupos com o agente ligado."));
  const todos = el("button", "btn btn-bad btn-small", d.todosArmado ? "Confirmar: todo mundo do grupo" : "Liberar para todo mundo do grupo"); todos.type = "button"; todos.disabled = saving || q.quemAciona === "todos";
  todos.addEventListener("click", () => {
    if (!d.todosArmado) { d.todosArmado = true; ctx.paintGuide(); afterWaGroups(); return; }
    if (!window.confirm("Tem certeza? Qualquer pessoa dos grupos com o agente ligado vai poder conversar com ele.")) { d.todosArmado = false; ctx.paintGuide(); afterWaGroups(); return; }
    void setWaGroup(grupo.jid, { quemAciona: "todos" }).then((ok) => { if (ok) grupoQuemDraft = null; afterWaGroups(); });
  });
  det.append(todos);
  if (d.todosArmado) det.open = true;
  box.append(det);
  container.append(box);
}
/** Tutorial 10, passo 1: os grupos como cartões; aviso fixo de "só grupos internos". */
export function renderGruposEscolher(container: HTMLElement): void {
  if (gruposIndisponivelNota(container)) return;
  container.append(el("p", "hint bad-hint", GRUPOS_AVISO));
  if (waGroups === null) { container.append(waGroupsErr !== null ? el("p", "hint", `Não consegui ler os grupos: ${waGroupsErr}`) : carregando("Lendo os grupos…")); if (waGroupsInflight === null) void refreshWaGroups(); return; }
  const alvo = grupoAlvo(waGroups, loadGrupoAlvo());
  const cards = el("div", "reply-cards guide-cards");
  for (const g of waGroups.grupos) {
    const card = el("button", `reply-card${alvo?.jid === g.jid ? " on" : ""}`); card.type = "button";
    const body = el("div", "reply-body");
    const title = el("div", "reply-title"); title.append(el("strong", "", waGroupTitle(g)));
    if (g.membros !== null) body.append(title, el("p", "", `${g.membros} membros`)); else body.append(title);
    card.append(el("span", "reply-radio"), body);
    card.addEventListener("click", () => { saveGrupoAlvo(g.jid); grupoQuemDraft = null; ctx.paintGuide(); });
    cards.append(card);
  }
  if (waGroups.grupos.length === 0) container.append(el("p", "hint", "Nenhum grupo listado ainda. Atualize a lista; se o grupo é novo, ponha o número do agente nele antes."));
  else container.append(cards);
  if (waGroups.todosAdmitidos) container.append(el("p", "guide-note bad", "⚠ Hoje a configuração admite TODOS os grupos deste número. Ao ligar o agente num grupo pelo passo 3, os outros ficam de fora."));
  // Atualizar é secundário: um link. O grupo novo só aparece depois que o número do agente entrou nele.
  const p = el("p", "hint"); p.append("Não achou o grupo? ");
  const b = el("button", "linkish", waGroupsListing ? "atualizando… (uns 30 s)" : "atualizar a lista"); b.type = "button"; b.disabled = waGroupsListing || !waGroups.skill;
  b.addEventListener("click", () => { void listarWaGroups(); });
  p.append(b); container.append(p);
  if (!waGroups.skill) container.append(el("p", "hint", DICA_SEM_SKILL()));
  if (waGroupsMsg !== null) container.append(el("p", `hint${waGroupsMsg.bad ? " guide-pair-note" : ""}`, waGroupsMsg.text));
}
/**
 * Tutorial 10, passo 3: um botão grande "Ligar o agente neste grupo" (só quando chamado, o que evita bagunça) e, à
 * parte, "ou responder sempre", que mostra o aviso do robô antes de ligar.
 */
let modoSempreAberto = false;
export function renderGruposModo(container: HTMLElement): void {
  if (gruposIndisponivelNota(container)) return;
  const alvo = grupoAlvo(waGroups, loadGrupoAlvo());
  if (alvo === null) return;
  const saving = waGroupSaving === alvo.jid;
  const ligar = el("button", "btn btn-primary", saving ? "Ligando…" : alvo.agente === "mencao" ? "✓ Ligado: responde quando chamado" : `Ligar o agente em ${waGroupTitle(alvo)}`); ligar.type = "button";
  ligar.disabled = saving || alvo.agente === "mencao";
  ligar.addEventListener("click", () => { void setWaGroup(alvo.jid, { agente: "mencao" }); });
  container.append(ligar);
  const p = el("p", "hint");
  const ou = el("button", "linkish", alvo.agente === "sempre" ? "responde sempre (ligado)" : "ou responder sempre que tiver algo útil"); ou.type = "button"; ou.disabled = saving;
  ou.addEventListener("click", () => { modoSempreAberto = !modoSempreAberto; ctx.paintGuide(); afterWaGroups(); });
  p.append(ou); container.append(p);
  if (modoSempreAberto && alvo.agente !== "sempre") {
    const box = el("div", "guide-note bad");
    box.append(el("p", "", "Ele lê tudo e entra quando acha que ajuda. Nunca use num grupo com outro robô: os dois ficam respondendo um ao outro."));
    const s2 = el("button", "btn btn-ghost btn-small", "Ligar respondendo sempre"); s2.type = "button"; s2.disabled = saving;
    s2.addEventListener("click", () => { modoSempreAberto = false; void setWaGroup(alvo.jid, { agente: "sempre" }); });
    box.append(s2); container.append(box);
  }
  if (waGroupsMsg !== null && waGroupsMsg.bad) container.append(el("p", "hint guide-pair-note", waGroupsMsg.text));
}
/** Desde quando o passo 4 está aberto para este grupo (a dica de "não respondeu" espera 1 min). */
let testeDesde: { jid: string; em: number } | null = null;
/** Tutorial 10, passo 4: abrir o grupo e esperar a resposta do agente aparecer. */
export function renderGruposTeste(container: HTMLElement): void {
  const alvo = grupoAlvo(waGroups, loadGrupoAlvo());
  if (alvo === null) return;
  checkGroupReplied(alvo.jid);
  const b = el("button", "btn btn-primary btn-small", `Abrir o grupo ${waGroupTitle(alvo)}`); b.type = "button";
  b.addEventListener("click", () => openWaGroup(alvo));
  container.append(b);
  // A dica de "não respondeu" só depois de 1 min no passo: antes disso ela só atrapalha.
  if (testeDesde?.jid !== alvo.jid) { testeDesde = { jid: alvo.jid, em: Date.now() }; setTimeout(() => { ctx.paintGuide(); }, 61_000); }
  if (Date.now() - testeDesde.em > 60_000) container.append(el("p", "hint", "Não respondeu? Quem mandou precisa estar na lista do passo 2 e mencionar o número do agente (escrever o nome não basta)."));
}

/** Liga os passos do tutorial 10 ao guia: os renderizadores moram aqui, junto do estado dos grupos. */
export function ligarGrupos(): void {
  registrarFonte("grupos", () => {
    const alvo = grupoAlvo(waGroups, loadGrupoAlvo());
    return { known: waGroups !== null || !ehRemoto() || (ctx.waStatus !== null && !ctx.waStatus.capacidades.grupos), dados: { grupos: { info: waGroups, alvo: loadGrupoAlvo(), respondeu: alvo !== null && (alvo.agenteRespondeu === true || waGroupReplied.get(alvo.jid) === true) } } };
  });
  registrarPassos({
    "grupos-escolher": (txt) => renderGruposEscolher(txt),
    "grupos-quem": (txt) => {
      const alvo = grupoAlvo(waGroups, loadGrupoAlvo());
      if (alvo !== null) { txt.append(el("p", "hint", `Grupo: ${waGroupTitle(alvo)}`)); renderGruposQuem(txt, alvo); }
    },
    "grupos-modo": (txt) => renderGruposModo(txt),
    "grupos-teste": (txt) => renderGruposTeste(txt),
  });
}
