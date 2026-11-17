/**
 * Variante: cliente. Handlers IPC só do meu-bot normal: conversar com o agente, parear e mexer no WhatsApp,
 * logins, instalar coisas na máquina, suporte do lado da pessoa. No meu-bot-admin cada canal daqui vira um
 * stub que recusa (ipc/registry.ts): o admin só lê e usa as ações de suporte.
 */
import { VOZES, isVozId } from "../whatsapp/vozes-core";
import { app, dialog, Menu, Notification } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { AudioSetup, ClaudeLoginEvent, ClaudeSessionRef, ExportFormat, LimiaresClaude, TabMenuAction, WhatsappEvent, WhatsappStatus } from "../../shared/ipc";
import { conversationToMarkdown, conversationTitle, slugify } from "../conversa/export";
import { atualizarContaClaude, conferirContaClaude, criarContaClaude, deleteBackendSession, fetchAccountStatus, fetchAlertPrefs, fetchBackendSession, fetchContasClaude, limiaresContasClaude, log, removerContaClaude, reordenarContasClaude, runBackendTurn, saveAlertPrefs, usarAgoraContaClaude } from "../maquina/backend";
import { lerLicenca, lerLicencaDaMaquina } from "../licenca/licenca-maquina";
import { assertAcesso, assertFinance } from "../licenca/acesso";
import { telaAcordar, telaStatus, telaUrl } from "../maquina/tela";
import { abrirInspector } from "../inspector/inspector";
import { esquecerPermissoes, responderPermissao } from "../navegador/nav-permissoes";
import { financeAbc, financeImportarPlanilha, financeCategorias, financeComprovante, financeConfig, financeConfigLer, financeCorrigir, financeLinhaRemover, financeLinhaSalvar, financeConfirmar, financeConfirmarTodas, financeContaCriar, financeDescartar, financeFecharMes, financeInfo, financeLancamentos, financeLancar, financeMes } from "../financeiro/finance-local";
import { navWhatsappInfo, setNavWhatsapp } from "../navegador/navegador-whatsapp";
import { crmCriarPipeline, crmDefinirPadrao, crmLocal } from "../crm/crm-local";
import { caps } from "../app/variant";
import { eventoHook } from "../app/depuracao";
import { disableSshCheck, restoreLastPolicy } from "../maquina/tailscale";
import { cancelPairing, esquecerWhatsapp, pairingInProgress, runSsh, setDmPolicy, setTypingMode, startPairing, whatsappBranch, whatsappEscolherAgente, whatsappLogout, whatsappSetDono, whatsappStatus } from "../whatsapp/whatsapp";
import { pauseRuleSh } from "../whatsapp/whatsapp-pause";
import { cancelClaudeLogin, claudeLogout, startClaudeLogin, submitClaudeLoginCode } from "../agente/claudeLogin";
import { cancelXaiLogin, startXaiLogin, xaiLogout } from "../agente/xaiLogin";
import { prepareGrokOauthLocal } from "../agente/xaiLocal";
import { cancelarConta, entrarConta, instalarGh, sairConta } from "../agente/contas-cli";
import { isContaId } from "../agente/contas-cli-core";
import { linkPublicoLista, linkPublicoNome, linkPublicoPublicar, linkPublicoRemover } from "../agente/link-publico";
import { cotaApagarItem, cotaMaiores, cotaStatus } from "../agente/espaco";
import {
  archiveConversation, branchConversation, closeTab, createConversation, dropConversation, duplicateConversation, getConversation,
  getStoredConversation, listConversationsForHost, openConversation, persistConversations, renameConversation, reorderConversations, setConversationModel,
} from "../conversa/conversation";
import { APAGADAS_FILE, conversasApagadas, parseApagadas } from "../conversa/apagadas-core";
import { LOCAL_HOST } from "../maquina/localBackend";
import { backendPresente, instalarBackendDaMaquina, notificacaoClicada } from "../maquina/picker";

/** Depois de um turno, guarda a sessão do Claude Code desta conversa (o .jsonl): a referência vale mesmo depois do TTL do backend. */
async function rememberClaudeSession(conv: { id: string; host: string; claude?: ClaudeSessionRef }): Promise<ClaudeSessionRef | null> {
  const ref = await fetchBackendSession(conv.host, conv.id);
  if (ref !== null && (conv.claude === undefined || conv.claude.sessionId !== ref.sessionId)) { conv.claude = ref; persistConversations(); }
  return ref ?? conv.claude ?? null;
}
import { getHostNames, isBackendModel } from "../app/settings";
import { objectiveInfo, resetObjective, saveObjectiveSkill, setObjective } from "../agente/objetivo";
import { crmInfo, crmTest, resetCrm, setCrm } from "../crm/crm";
import { toggleQuickEntry } from "../app/quickEntry";
import { gmailInstalled, guardaInstalled, installAudio, installCrm, installFinance, installGmail, installGuarda, installHermesPausa, installNavegador, installStatusLine, installTela, navegadorInstalled, prepareGrokOauth, statusLineInstalled, uninstallCrm, uninstallGuarda, uninstallStatusLine } from "../maquina/hostProbe";
import { gmailAgente, gmailAgenteInfo, gmailAgenteReligar } from "../google/gmail-api";
import { readSegments, writeSegments } from "../agente/statusLine";
import { deliverNow, reportSupportProgress, resetSupport, setSupport, setSupportNameOnly, setSupportShare, supportCodeText, supportInfo } from "../client/support";
import { openMainWindow, sendWhenLoaded } from "../app/windows";
import { hostFromEvent, ownedConversation, waNumber } from "./context";
import { handleClient, onClient } from "./registry";
import { setObservadorStatus } from "./shared";
import { browserAgent, browserAgentInfo, browserExtensions, browserOpen, browserRemoveExtension, browserSetActive, browserSincronizarCrm, browserFavoriteAdd, browserFavoriteRemove, browserWorkspacesSet } from "../navegador/browser";
import { registrar } from "../auditoria/auditoria";
import { atualizarFonte, desligarModulo, ligarModulo, listarModulos, salvarCredenciais, salvarOpcoes, testarModulo } from "../modulos/modulos";

/**
 * Padrão do app: máquina cujo agente transcreve áudio (capacidade `audio`) entende áudios sem a pessoa fazer nada. Liga
 * depois de parear e a cada leitura do status (observador abaixo) enquanto a máquina tiver o necessário (`audioMaquina`:
 * o transcritor do root ou o ffmpeg) e ninguém tiver desligado de propósito (`audioDesligado`). Com a máquina sem o
 * necessário não tenta: a tela diz que é com o admin, e quando ele prepara a máquina a leitura seguinte liga. Uma
 * tentativa por máquina por sessão quando falha (o botão "Ativar transcrição" continua lá). Conta pelo canal de eventos
 * do pareamento quando veio dele; fora dele, só no log, e a tela vê `audioLigando`/`audioErro` no status.
 */
const transcricaoEmCurso = new Set<string>();
const transcricaoTentada = new Set<string>();
const transcricaoErro = new Map<string, string>();
const precisaLigarTranscricao = (st: WhatsappStatus): boolean => st.present && st.connected && st.capacidades.audio && st.audioIn === false && st.audioMaquina !== false && st.audioDesligado !== true;
async function ensureTranscription(host: string, send?: (ev: WhatsappEvent) => void): Promise<void> {
  if (transcricaoEmCurso.has(host) || transcricaoTentada.has(host) || pairingInProgress() !== null) return;
  const st = await whatsappStatus(host).catch(() => null);
  if (st === null || !precisaLigarTranscricao(st)) return;
  transcricaoEmCurso.add(host); transcricaoErro.delete(host);
  send?.({ kind: "step", text: "ligando a transcrição de áudio (padrão do meu-bot)…" });
  try {
    const r = await installAudio(host, { kind: "in" }, (line) => { send?.({ kind: "log", text: line }); log(`[transcrição] ${host}: ${line}`); });
    esquecerWhatsapp(host);
    if (!r.ok) { transcricaoTentada.add(host); transcricaoErro.set(host, r.log.at(-1) ?? "erro"); }
    send?.({ kind: r.ok ? "step" : "log", text: r.ok ? "transcrição de áudio pronta: o agente entende áudios" : `a transcrição não ligou: ${r.log.at(-1) ?? "erro"}` });
  } finally { transcricaoEmCurso.delete(host); }
}
/** A cada status lido pela janela: dispara a ligação automática quando cabe e anota o que está acontecendo. */
function observarStatusWhatsapp(host: string, st: WhatsappStatus): WhatsappStatus {
  if (precisaLigarTranscricao(st) && !transcricaoTentada.has(host) && !transcricaoEmCurso.has(host) && pairingInProgress() === null) void ensureTranscription(host);
  const ligando = transcricaoEmCurso.has(host); const erro = transcricaoErro.get(host);
  return ligando || erro !== undefined ? { ...st, ...(ligando ? { audioLigando: true } : {}), ...(erro !== undefined ? { audioErro: erro } : {}) } : st;
}

/**
 * Padrão do app: o agente sabe o que é a pausa do meu-bot. Depois de parear, grava no AGENTS.md do workspace a
 * regra das notas de pausa (whatsapp-pause.ts); idempotente. Toda pausa confere de novo (máquinas antigas).
 */
async function ensurePauseRule(host: string, send: (ev: WhatsappEvent) => void): Promise<void> {
  const st = await whatsappStatus(host).catch(() => null);
  // A regra vai no AGENTS.md do workspace do OpenClaw; no Hermes pausar é tirar da lista (o agente nem vê a mensagem).
  if (st === null || !st.capacidades.pausar || st.gateway !== "openclaw") return;
  const r = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${pauseRuleSh()}\n`, 30_000).catch(() => null);
  const rule = r === null ? "erro" : (/REGRA=(\S+)/.exec(r.stdout)?.[1] ?? "erro");
  send({ kind: rule === "erro" ? "log" : "step", text: rule === "erro" ? "não deu para gravar a regra de pausa no AGENTS.md do agente" : rule === "1" ? "regra de pausa do meu-bot gravada no agente (AGENTS.md)" : "regra de pausa do meu-bot já estava no agente" });
}

/**
 * Padrão do app: no Hermes, a pausa por contato com prazo vem do plugin meu-bot-pausa. Depois de parear, se a máquina
 * ainda pausa pela lista (sem `pausaPrazo`), instala o plugin e conta pelo canal do pareamento. Idempotente.
 */
async function ensureHermesPausa(host: string, send: (ev: WhatsappEvent) => void): Promise<void> {
  const st = await whatsappStatus(host).catch(() => null);
  if (st === null || st.gateway !== "hermes" || !st.capacidades.pausar || st.capacidades.pausaPrazo) return;
  send({ kind: "step", text: "ligando a pausa por contato com prazo (padrão do meu-bot: plugin do Hermes)…" });
  const r = await installHermesPausa(host, (line) => send({ kind: "log", text: line }));
  send({ kind: r.ok ? "step" : "log", text: r.ok ? "pausa por contato pronta: Pausar o agente por 2 h / 24 h / até retomar" : `a pausa com prazo não ligou: ${r.log.at(-1) ?? "erro"}` });
}

export function registerClientIpc(): void {
  setObservadorStatus(observarStatusWhatsapp);
  // Pausa por contato com prazo no Hermes: instala (ou atualiza) o plugin meu-bot-pausa nesta máquina.
  handleClient("whatsapp:pausa-plugin", async (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const r = await installHermesPausa(h.host, (line) => { if (!h.win.isDestroyed()) h.win.webContents.send("whatsapp:event", { kind: "log", text: line }); });
    if (r.ok) void registrar(h.host, "whatsapp.pausa-plugin");
    return r;
  });
  // Suporte, lado da pessoa (só com o pacote de suporte no .dmg).
  handleClient("support:info", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return supportInfo(h.host);
  });
  handleClient("support:set", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = payload as { on?: unknown; name?: unknown } | null;
    return setSupport(h.host, p?.on === true, typeof p?.name === "string" ? p.name : "");
  });
  handleClient("support:progress", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) return;
    await reportSupportProgress(h.host, payload).catch(() => undefined);
  });
  handleClient("support:name", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return setSupportNameOnly(h.host, String((payload as { name?: unknown } | null)?.name ?? ""));
  });
  handleClient("support:deliver", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return deliverNow(h.host);
  });
  handleClient("support:code", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return supportCodeText(h.host);
  });
  handleClient("support:share", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return setSupportShare(h.host, payload);
  });
  // Tutorial 7 · objetivo do WhatsApp: tudo mora na máquina (objetivo.json, skill no workspace, trava do nível).
  handleClient("objective:info", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return objectiveInfo(h.host);
  });
  handleClient("objective:set", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return setObjective(h.host, payload);
  });
  handleClient("objective:save", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    // A trava do objetivo regrava toolsBySender: o Navegador do WhatsApp (se ligado) refaz a lista dos liberados.
    return saveObjectiveSkill(h.host, getHostNames()[h.host] ?? h.host).finally(() => { void setNavWhatsapp(h.host, "sincronizar").catch(() => undefined); });
  });
  handleClient("objective:reset", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return resetObjective(h.host).finally(() => { void setNavWhatsapp(h.host, "sincronizar").catch(() => undefined); });
  });
  // "Refazer do zero" do tutorial de suporte: desliga e esquece o nome.
  handleClient("support:reset", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return resetSupport(h.host);
  });

  // Grok por OAuth: instala Hermes + proxy (install-grok-oauth.sh por SSH; no Mac, xaiLocal.ts); cada linha vai ao log do login.
  handleClient("xai-login:prepare", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const onLine = (line: string): void => { if (!h.win.isDestroyed()) h.win.webContents.send("xai-login:event", { kind: "log", text: line }); };
    if (h.host === LOCAL_HOST) return prepareGrokOauthLocal(onLine);
    return prepareGrokOauth(h.host, onLine);
  });
  // Status line do Claude (tutorial): checar e instalar na máquina desta janela.
  handleClient("statusline:status", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return statusLineInstalled(h.host);
  });
  // Máquina sem o backend do meu-bot: a própria janela instala (o mesmo do seletor) e manda o progresso para ela.
  handleClient("backend:presente", async (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return h.host === LOCAL_HOST ? true : backendPresente(h.host);
  });
  handleClient("backend:install", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    if (h.host === LOCAL_HOST) throw new Error("este Mac não usa backend por SSH");
    return instalarBackendDaMaquina(h.host, (line) => { if (!h.win.isDestroyed()) (h.win.webContents.send("backend:install-progress", { line }), eventoHook("backend:install-progress", line)); });
  });
  handleClient("statusline:install", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return installStatusLine(h.host, (line) => { if (!h.win.isDestroyed()) (h.win.webContents.send("statusline:progress", { line }), eventoHook("statusline:progress", line)); });
  });
  // Aba "Navegador" (módulo Pro): a sessão é da máquina da janela; abrir exige plano Pro (o renderer já bloqueia;
  // aqui é a defesa). Os <webview> são do renderer; o main só prepara a sessão e cuida das extensões.
  const ctxOf = (event: Electron.IpcMainInvokeEvent) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return h; };
  handleClient("browser:open", async (event) => {
    const h = ctxOf(event);
    await assertAcesso(h.host);
    return browserOpen(h.win, h.host, await lerLicencaDaMaquina(h.host).catch(() => null)); // a extensão do CRM segue a licença e o backend
  });
  handleClient("browser:extensions", (event) => browserExtensions(ctxOf(event).host));
  // O agente do WhatsApp também usa o Navegador: só o número do agente e a lista dos grupos (trava do OpenClaw por remetente).
  handleClient("browser:agent-whatsapp", async (event, payload: unknown) => {
    const h = ctxOf(event);
    const on = (payload as { on?: unknown } | null)?.on;
    if (typeof on !== "boolean") return navWhatsappInfo(h.host);
    await assertAcesso(h.host);
    const r = await setNavWhatsapp(h.host, on);
    void registrar(h.host, on ? "navegador.whatsapp-ligar" : "navegador.whatsapp-desligar", r.liberados.map((n) => `+${n}`).join(", "));
    return r;
  });
  handleClient("browser:agent", (event, payload: unknown) => { const h = ctxOf(event); browserAgent(h.host, (payload as { on?: unknown } | null)?.on === true); return browserAgentInfo(h.host); });
  onClient("browser:active", (event, payload: unknown) => { const h = hostFromEvent(event); const id = (payload as { wcId?: unknown } | null)?.wcId; if (h !== null && typeof id === "number") browserSetActive(h.host, id); });
  handleClient("browser:remove-extension", (event, payload: unknown) => { const id = (payload as { extId?: unknown } | null)?.extId; if (typeof id !== "string" || !/^[a-p]{32}$/.test(id)) throw new Error("id de extensão inválido"); return browserRemoveExtension(ctxOf(event).host, id); });
  handleClient("browser:favorite-add", (event, payload: unknown) => { const p = payload as { titulo?: unknown; url?: unknown } | null; if (typeof p?.url !== "string") throw new Error("falta url"); return browserFavoriteAdd(ctxOf(event).host, { titulo: typeof p.titulo === "string" ? p.titulo : "", url: p.url }); });
  handleClient("browser:favorite-remove", (event, payload: unknown) => { const id = (payload as { id?: unknown } | null)?.id; if (typeof id !== "string" || id === "") throw new Error("falta id"); return browserFavoriteRemove(ctxOf(event).host, id); });
  handleClient("browser:workspaces-set", (event, payload: unknown) => { const h = ctxOf(event); return browserWorkspacesSet(h.host, (payload as { espacos?: unknown } | null)?.espacos, h.win); });
  handleClient("browser:permissao", (event, payload: unknown) => { ctxOf(event); const p = (payload ?? {}) as { id?: unknown; decisao?: unknown }; if (typeof p.id === "string" && (p.decisao === "sempre" || p.decisao === "agora" || p.decisao === "nunca")) responderPermissao(p.id, p.decisao); });
  handleClient("browser:permissoes-esquecer", (event, payload: unknown) => { const h = ctxOf(event); const o = (payload as { origem?: unknown } | null)?.origem; esquecerPermissoes(h.host, typeof o === "string" ? o : undefined); });
  handleClient("browser:request-pro", async (event) => { const h = ctxOf(event); const pedido = caps().planoExigido === "free" ? "pediu o plano Pro (aba Navegador)" : `pediu para liberar o ${caps().produto} (assinatura)`; await registrar(h.host, "plano.pedir", pedido); log(`[navegador] ${h.host}: ${pedido}`); });
  // Tutorial 17 · CRM pelo WhatsApp (Pro): estado, instalar plugin, gravar chave/pipeline/regras, testar, refazer.
  // Financeiro (produto meu-bot-finance): página Finanças e tutorial 12. Tudo passa pelo gate da licença (o backend confere de novo).
  const fin = async (event: Electron.IpcMainInvokeEvent): Promise<string> => { const h = ctxOf(event); await assertFinance(h.host); return h.host; };
  const txt = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : undefined);
  const mesOk = (v: unknown): string => { if (typeof v !== "string" || !/^\d{4}-\d{2}$/.test(v)) throw new Error("mês inválido"); return v; };
  const idOk = (v: unknown): string => { if (typeof v !== "string" || !/^[A-Za-z0-9_-]{2,80}$/.test(v)) throw new Error("lançamento inválido"); return v; };
  handleClient("finance:info", async (event) => financeInfo(await fin(event)));
  handleClient("finance:importar-planilha", async (event, payload: unknown) => {
    const p = (payload ?? {}) as { link?: unknown; aba?: unknown; tipo?: unknown; simular?: unknown };
    if (typeof p.link !== "string" || p.link.length > 500) throw new Error("link inválido");
    const host = await fin(event);
    const r = await financeImportarPlanilha(host, { link: p.link, ...(typeof p.aba === "string" ? { aba: p.aba } : {}), tipo: p.tipo === "venda" ? "venda" : "compra", simular: p.simular !== false });
    if (!r.simulado && r.importadas > 0) void registrar(host, "financeiro.importar", `planilha ${r.planilha}`, `${r.importadas} lançamento(s)`);
    return r;
  });
  handleClient("finance:abc", async (event, payload: unknown) => {
    const p = (payload ?? {}) as { lado?: unknown; por?: unknown; meses?: unknown; ate?: unknown };
    const lado = p.lado === "venda" ? "venda" : "compra"; const por = p.por === "categoria" ? "categoria" : p.por === "favorecido" ? "favorecido" : "produto";
    const meses = Number.isInteger(p.meses) ? Math.min(24, Math.max(1, p.meses as number)) : 3;
    return financeAbc(await fin(event), { lado, por, meses, ...(p.ate !== undefined ? { ate: mesOk(p.ate) } : {}) });
  });
  handleClient("finance:lancamentos", async (event, payload: unknown) => { const p = (payload ?? {}) as { mes?: unknown; status?: unknown; limite?: unknown }; return financeLancamentos(await fin(event), { ...(p.mes !== undefined ? { mes: mesOk(p.mes) } : {}), ...(p.status === "pendente" || p.status === "confirmado" ? { status: p.status } : {}), ...(typeof p.limite === "number" ? { limite: Math.min(500, Math.max(1, Math.trunc(p.limite))) } : {}) }); });
  handleClient("finance:categorias", async (event) => financeCategorias(await fin(event)));
  handleClient("finance:lancar", async (event, payload: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>; const host = await fin(event);
    const valor = txt(p.valor, 30); if (valor === undefined) throw new Error("diga o valor");
    const l = await financeLancar(host, { valor, favorecido: txt(p.favorecido, 80) ?? "", ...(p.tipo === "renda" ? { tipo: "renda" as const } : {}), ...(p.retorno === "indireto" || p.retorno === "direto" ? { retorno: p.retorno } : {}), ...(txt(p.categoria) ? { categoria: txt(p.categoria)! } : {}), ...(txt(p.conta) ? { conta: txt(p.conta)! } : {}), ...(txt(p.data, 12) ? { data: txt(p.data, 12)! } : {}), ...(txt(p.notas, 500) ? { notas: txt(p.notas, 500)! } : {}) });
    void registrar(host, "finance.lancar", `${l.valor} · ${l.categoriaNome}`); return l;
  });
  handleClient("finance:confirmar", async (event, payload: unknown) => { const p = (payload ?? {}) as { id?: unknown; categoria?: unknown }; return financeConfirmar(await fin(event), idOk(p.id), txt(p.categoria)); });
  handleClient("finance:descartar", async (event, payload: unknown) => { const host = await fin(event); const id = idOk((payload as { id?: unknown } | null)?.id); await financeDescartar(host, id); void registrar(host, "finance.descartar", id); });
  handleClient("finance:corrigir", async (event, payload: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>; const host = await fin(event); const id = idOk(p.id);
    const patch: Record<string, string | null> = {};
    for (const [k, max] of [["valor", 30], ["favorecido", 80], ["categoria", 80], ["data", 12], ["notas", 500]] as const) if (typeof p[k] === "string") patch[k] = String(p[k]).slice(0, max);
    if (p.linha === null || typeof p.linha === "string") patch.linha = p.linha === null || p.linha === "" ? null : String(p.linha).slice(0, 80);
    if (p.conta === null || typeof p.conta === "string") patch.conta = p.conta === null || p.conta === "" ? null : String(p.conta).slice(0, 80);
    if (Object.keys(patch).length === 0) throw new Error("nada para corrigir");
    const l = await financeCorrigir(host, id, patch); void registrar(host, "finance.corrigir", `${l.valor} · ${l.categoriaNome}`); return l;
  });
  handleClient("finance:linha-salvar", async (event, payload: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>; const host = await fin(event);
    const nome = txt(p.nome, 80); if (nome === undefined) throw new Error("dê um nome à linha");
    if (p.tipo !== "custo" && p.tipo !== "ganho-direto" && p.tipo !== "ganho-indireto") throw new Error("tipo de linha inválido");
    const key = p.key === undefined ? undefined : idOk(p.key);
    await financeLinhaSalvar(host, { ...(key ? { key } : {}), nome, tipo: p.tipo, valor: typeof p.valor === "string" && p.valor.trim() !== "" ? p.valor.slice(0, 30) : null, ...(typeof p.notas === "string" ? { notas: p.notas.slice(0, 500) } : {}) });
    void registrar(host, "finance.linha", `${nome} (${p.tipo})`);
  });
  handleClient("finance:linha-remover", async (event, payload: unknown) => { const host = await fin(event); const key = idOk((payload as { key?: unknown } | null)?.key); await financeLinhaRemover(host, key); void registrar(host, "finance.linha", `removeu ${key}`); });
  handleClient("finance:comprovante", async (event, payload: unknown) => { const sha = (payload as { sha256?: unknown } | null)?.sha256; if (typeof sha !== "string" || !/^[0-9a-f]{64}$/.test(sha)) throw new Error("comprovante inválido"); return financeComprovante(await fin(event), sha); });
  handleClient("finance:confirmar-todas", async (event) => financeConfirmarTodas(await fin(event)));
  handleClient("finance:conta-criar", async (event, payload: unknown) => { const p = (payload ?? {}) as Record<string, unknown>; const nome = txt(p.nome, 80); if (nome === undefined) throw new Error("dê um nome à conta"); return financeContaCriar(await fin(event), { nome, ...(txt(p.tipo, 20) ? { tipo: txt(p.tipo, 20)! } : {}), ...(txt(p.moeda, 8) ? { moeda: txt(p.moeda, 8)! } : {}), ...(txt(p.saldoInicial, 30) ? { saldoInicial: txt(p.saldoInicial, 30)! } : {}) }); });
  handleClient("finance:config-ler", async (event) => financeConfigLer(await fin(event)));
  handleClient("finance:config-salvar", async (event, payload: unknown) => { const p = (payload ?? {}) as Record<string, unknown>; const patch: { taxas?: Record<string, number>; moedaExibicao?: string } = {}; if (p.taxas && typeof p.taxas === "object") { const t: Record<string, number> = {}; for (const [k, v] of Object.entries(p.taxas as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && v > 0) t[k] = v; patch.taxas = t; } if (txt(p.moedaExibicao, 8)) patch.moedaExibicao = txt(p.moedaExibicao, 8)!; return financeConfig(await fin(event), patch); });
  handleClient("finance:mes", async (event, payload: unknown) => { const p = (payload ?? {}) as Record<string, unknown>; return financeMes(await fin(event), mesOk(p.mes), { ...(p.metaDireto === null || typeof p.metaDireto === "string" ? { metaDireto: p.metaDireto as string | null } : {}), ...(p.metaIndireto === null || typeof p.metaIndireto === "string" ? { metaIndireto: p.metaIndireto as string | null } : {}), ...(typeof p.metaNotas === "string" ? { metaNotas: p.metaNotas.slice(0, 500) } : {}), ...(p.orcamento === null || typeof p.orcamento === "string" ? { orcamento: p.orcamento as string | null } : {}), ...(p.rendaPrevista === null || typeof p.rendaPrevista === "string" ? { rendaPrevista: p.rendaPrevista as string | null } : {}), ...(typeof p.dinheiroInformado === "boolean" ? { dinheiroInformado: p.dinheiroInformado } : {}) }); });
  handleClient("finance:fechar-mes", async (event, payload: unknown) => { const host = await fin(event); const mes = mesOk((payload as { mes?: unknown } | null)?.mes); await financeFecharMes(host, mes); void registrar(host, "finance.fechar-mes", mes); });
  handleClient("finance:install", async (event) => { const h = ctxOf(event); await assertFinance(h.host); const r = await installFinance(h.host, (line) => { if (!h.win.isDestroyed()) (h.win.webContents.send("finance:progress", { line }), eventoHook("finance:progress", line)); }); if (r.ok) void registrar(h.host, "finance.instalar"); return r; });
  // Módulos de produto (meu-bot-diego): só nos apps com caps().modulos; a licença (add-on do produto) é conferida no
  // main a cada ação e de novo pelo backend da máquina a cada turno.
  const modId = (p: unknown): string => { const id = p !== null && typeof p === "object" ? (p as { id?: unknown }).id : undefined; if (typeof id !== "string" || !/^[a-z][a-z0-9-]{1,40}$/.test(id) || caps().modulos === null) throw new Error("módulo inválido"); return id; };
  const progressoModulo = (h: ReturnType<typeof ctxOf>, id: string) => (line: string): void => { if (!h.win.isDestroyed()) h.win.webContents.send("modulos:progress", { id, line }); };
  // Os módulos vêm do repositório do produto, baixado com git neste Mac (atualizarFonte).
  handleClient("modulos:atualizar-fonte", async () => { if (caps().modulos === null) throw new Error("este app não tem módulos"); return atualizarFonte(); });
  handleClient("modulos:testar", async (event, p: unknown) => { const h = ctxOf(event); const id = modId(p); return testarModulo(h.host, id, progressoModulo(h, id)); });
  handleClient("modulos:listar", async (event) => { if (caps().modulos === null) throw new Error("este app não tem módulos"); return listarModulos(ctxOf(event).host); });
  handleClient("modulos:ligar", async (event, p: unknown) => { const h = ctxOf(event); const id = modId(p); const r = await ligarModulo(h.host, id, progressoModulo(h, id)); if (r.ok) void registrar(h.host, "modulo.ligar", id); return r; });
  handleClient("modulos:desligar", async (event, p: unknown) => { const h = ctxOf(event); const id = modId(p); const r = await desligarModulo(h.host, id, progressoModulo(h, id)); if (r.ok) void registrar(h.host, "modulo.desligar", id); return r; });
  handleClient("modulos:credenciais", async (event, p: unknown) => {
    const h = ctxOf(event); const id = modId(p);
    const patch = (p as { patch?: unknown }).patch;
    if (patch === null || typeof patch !== "object" || Array.isArray(patch) || !Object.values(patch).every((v) => typeof v === "string")) throw new Error("credenciais inválidas");
    await salvarCredenciais(h.host, id, patch as Record<string, string>);
    void registrar(h.host, "modulo.credenciais", `${id} (${Object.keys(patch).join(", ")})`);
    return listarModulos(h.host);
  });
  handleClient("modulos:opcoes", async (event, p: unknown) => {
    const h = ctxOf(event); const id = modId(p);
    const patch = (p as { patch?: unknown }).patch;
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) throw new Error("opções inválidas");
    const r = await salvarOpcoes(h.host, id, patch as Record<string, unknown>, progressoModulo(h, id));
    void registrar(h.host, "modulo.opcoes", id);
    return r;
  });
  // Computador (módulo Pro): a tela do bot ao vivo. O plano é conferido aqui de novo, não só na tela.
  const comp = async (event: Electron.IpcMainInvokeEvent): Promise<string> => { const h = ctxOf(event); await assertAcesso(h.host); return h.host; };
  handleClient("computador:status", async (event) => telaStatus(await comp(event)));
  handleClient("computador:acordar", async (event) => { const host = await comp(event); const st = await telaAcordar(host); log(`[computador] ${host}: acordar → ${st.erro ?? (st.rodando ? "no ar" : "parada")}`); return st; });
  handleClient("computador:instalar", async (event) => { const host = await comp(event); const r = await installTela(host); void registrar(host, "computador.instalar", "", r.ok ? "ok" : `código ${r.codigo ?? "timeout"}`); return r; });
  handleClient("computador:url", async (event) => telaUrl(await comp(event)));
  // Inspector: só no produto que tem a capacidade (meu-bot-inspector-staging); nos outros o canal recusa.
  handleClient("inspector:abrir", async () => { if (!caps().inspector) throw new Error("o Inspector só existe no meu-bot-inspector-staging"); return abrirInspector(); });
  handleClient("plano:avisar-pagamento", async (event) => { const h = ctxOf(event); await registrar(h.host, "plano.pago", "avisou que já pagou (aviso de plano)"); log(`[plano] ${h.host}: avisou que já pagou`); });
  // Espaço da conta na máquina (Configurações › Espaço): a cota dela, o que dá para apagar (só caches e workspaces, como ela) e o pedido de mais espaço.
  handleClient("cota:status", (event) => cotaStatus(ctxOf(event).host));
  handleClient("cota:maiores", (event) => cotaMaiores(ctxOf(event).host));
  handleClient("cota:apagar-item", (event, payload: unknown) => cotaApagarItem(ctxOf(event).host, (payload as { caminho?: unknown } | null)?.caminho));
  handleClient("cota:pedir-mais", async (event, payload: unknown) => { const h = ctxOf(event); const pct = Number((payload as { pct?: unknown } | null)?.pct); await registrar(h.host, "cota.pedir-mais", Number.isFinite(pct) ? `${Math.round(pct)}%` : ""); log(`[cota] ${h.host}: pediu mais espaço${Number.isFinite(pct) ? ` (${Math.round(pct)}%)` : ""}`); });
  handleClient("finance:pedir", async (event) => { const h = ctxOf(event); await registrar(h.host, "plano.pedir", "pediu para liberar o meu-bot-finance (financeiro)"); log(`[finance] ${h.host}: pediu o meu-bot-finance`); });
  handleClient("crm:info", (event) => crmInfo(ctxOf(event).host));
  // Tutorial 17 (meu-bot-crm): o primeiro pipeline do CRM da máquina e qual é o do WhatsApp.
  handleClient("crm:local", (event) => crmLocal(ctxOf(event).host));
  handleClient("crm:pipeline-criar", async (event, payload: unknown) => {
    const h = ctxOf(event); await assertAcesso(h.host);
    const p = payload as { name?: unknown; stages?: unknown } | null;
    if (typeof p?.name !== "string" || p.name.trim() === "" || p.name.length > 60) throw new Error("nome inválido");
    if (!Array.isArray(p.stages) || p.stages.length < 2 || p.stages.length > 12 || !p.stages.every((s) => typeof s === "string" && s.trim() !== "" && s.length <= 40)) throw new Error("etapas inválidas (2 a 12)");
    const r = await crmCriarPipeline(h.host, p.name.trim(), (p.stages as string[]).map((s) => s.trim()));
    void registrar(h.host, "crm.pipeline-criar", `"${p.name.trim()}"`);
    return r;
  });
  handleClient("crm:pipeline-padrao", async (event, payload: unknown) => {
    const h = ctxOf(event); await assertAcesso(h.host);
    const key = (payload as { key?: unknown } | null)?.key;
    if (typeof key !== "string" || !/^[\w-]{1,80}$/.test(key)) throw new Error("pipeline inválido");
    const r = await crmDefinirPadrao(h.host, key);
    void registrar(h.host, "crm.pipeline-padrao", `"${r.pipelines.find((x) => x.key === key)?.name ?? key}"`);
    return r;
  });
  handleClient("crm:install", async (event) => { const h = ctxOf(event); await assertAcesso(h.host); const r = await installCrm(h.host, (line) => { if (!h.win.isDestroyed()) (h.win.webContents.send("crm:progress", { line }), eventoHook("crm:progress", line)); }); if (r.ok) void registrar(h.host, "crm.instalar"); return r; });
  handleClient("crm:set", (event, payload: unknown) => setCrm(ctxOf(event).host, payload));
  handleClient("crm:test", (event) => crmTest(ctxOf(event).host));
  handleClient("crm:reset", async (event) => { const h = ctxOf(event); await uninstallCrm(h.host).catch(() => undefined); void registrar(h.host, "crm.desinstalar"); return resetCrm(h.host); });
  // Guarda do WhatsApp (tutorial): está? instalar (progresso em guarda:progress) e desfazer.
  handleClient("guarda:status", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return guardaInstalled(h.host); });
  handleClient("navegador:status", (event) => navegadorInstalled(ctxOf(event).host));
  // Gmail para o agente (Pro): a chave da página, e o lado da máquina (MCP + regra), como o Navegador.
  handleClient("gmail:agent", async (event, payload: unknown) => {
    const h = ctxOf(event); const on = (payload as { on?: unknown } | null)?.on;
    if (typeof on !== "boolean") { await gmailAgenteReligar(h.host); return gmailAgenteInfo(h.host); }
    if (on) await assertAcesso(h.host);
    return gmailAgente(h.host, on);
  });
  handleClient("gmail:status", (event) => gmailInstalled(ctxOf(event).host));
  handleClient("gmail:install", (event) => { const h = ctxOf(event); return installGmail(h.host, (line) => { if (!h.win.isDestroyed()) (h.win.webContents.send("gmail:progress", { line }), eventoHook("gmail:progress", line)); }); });
  handleClient("navegador:install", (event) => { const h = ctxOf(event); return installNavegador(h.host, (line) => { if (!h.win.isDestroyed()) (h.win.webContents.send("navegador:progress", { line }), eventoHook("navegador:progress", line)); }); });
  handleClient("guarda:install", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return installGuarda(h.host, (line) => { if (!h.win.isDestroyed()) (h.win.webContents.send("guarda:progress", { line }), eventoHook("guarda:progress", line)); });
  });
  handleClient("guarda:uninstall", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return uninstallGuarda(h.host); });
  // Segmentos da status line (preferência na máquina) e "Refazer do zero".
  handleClient("statusline:segments", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return readSegments(h.host);
  });
  handleClient("statusline:set-segments", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return writeSegments(h.host, payload);
  });
  handleClient("statusline:uninstall", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return uninstallStatusLine(h.host);
  });
  handleClient("tailscale:disable-check", (event) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    return disableSshCheck();
  });
  handleClient("tailscale:restore", (event) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    return restoreLastPolicy();
  });

  // WhatsApp: parear, áudio, política, pausar, limpar.
  handleClient("whatsapp:pair", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const reset = (payload as { reset?: unknown } | null)?.reset === true;
    let connected = false;
    const send = (ev: WhatsappEvent): void => { if (ev.kind === "connected") connected = true; if (!h.win.isDestroyed()) h.win.webContents.send("whatsapp:event", ev); };
    await startPairing(h.host, reset, send);
    if (connected) { void ensureTranscription(h.host, send); void ensurePauseRule(h.host, send); void ensureHermesPausa(h.host, send); void registrar(h.host, "whatsapp.parear"); }
  });
  handleClient("whatsapp:audio", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = payload as { kind?: unknown; mode?: unknown } | null;
    const voz = (p as { voz?: unknown } | null)?.voz;
    const setup: AudioSetup | null = p?.kind === "in" ? { kind: "in", ...((p as { off?: unknown }).off === true ? { off: true } : {}) }
      : p?.kind === "out" && (p.mode === "off" || p.mode === "inbound" || p.mode === "always") ? { kind: "out", mode: p.mode, ...(isVozId(voz) ? { voz } : {}) } : null;
    if (setup === null) throw new Error("pedido inválido");
    const r = await installAudio(h.host, setup);
    esquecerWhatsapp(h.host);
    // A pessoa ligou à mão: a próxima falha automática não fica presa a esta sessão.
    if (setup.kind === "in") { transcricaoTentada.delete(h.host); transcricaoErro.delete(h.host); }
    if (r.ok && setup.kind === "out" && setup.voz !== undefined) void registrar(h.host, "audio.voz", VOZES.find((v) => v.id === setup.voz)?.rotulo.toLowerCase() ?? setup.voz);
    return r;
  });
  handleClient("whatsapp:logout", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return whatsappLogout(h.host).then(() => { void registrar(h.host, "whatsapp.desconectar"); });
  });
  handleClient("whatsapp:dm-policy", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = payload as { policy?: unknown; numbers?: unknown } | null;
    const policy = p?.policy;
    if (policy !== "open" && policy !== "self" && policy !== "list") throw new Error("política inválida");
    const numbers = Array.isArray(p?.numbers) ? p.numbers.filter((n): n is string => typeof n === "string") : [];
    if (policy === "list" && numbers.length === 0) throw new Error("a lista precisa de pelo menos um número");
    return setDmPolicy(h.host, policy, numbers).then((r) => { void registrar(h.host, "whatsapp.quem-responde", policy === "open" ? "todo mundo" : policy === "self" ? "só você" : `você e ${numbers.length} números`); return r; });
  });
  // "Digitando…" do agente no WhatsApp: mostrar sempre ou nunca (tutorial 17); o motor decide se reinicia o gateway.
  handleClient("whatsapp:typing", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const mode = (payload as { mode?: unknown } | null)?.mode;
    if (mode !== "instant" && mode !== "never") throw new Error("modo inválido");
    return setTypingMode(h.host, mode).then((r) => { void registrar(h.host, "whatsapp.digitando", mode === "instant" ? "mostrar" : "não mostrar"); return r; });
  });
  // Dono do agente: quem manda nele (null = volta ao número pareado). Reaplica "quem responde" e, no Hermes, o home channel.
  handleClient("whatsapp:dono", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const raw = (payload as { numero?: unknown } | null)?.numero;
    const numero = raw === null ? null : typeof raw === "string" ? raw.replace(/\D/g, "") : undefined;
    if (numero === undefined || (numero !== null && !/^\d{8,15}$/.test(numero))) throw new Error("número inválido (só dígitos, com DDI, 8 a 15)");
    return whatsappSetDono(h.host, numero).then((r) => { void registrar(h.host, "whatsapp.dono", numero === null ? "este número" : `+${numero}`); return r; });
  });
  handleClient("whatsapp:agente", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const agente = (payload as { agente?: unknown } | null)?.agente;
    if (agente !== "openclaw" && agente !== "hermes") throw new Error("agente inválido");
    return whatsappEscolherAgente(h.host, agente).then((r) => { void registrar(h.host, "whatsapp.agente", agente === "openclaw" ? "OpenClaw" : "Hermes"); return r; });
  });
  handleClient("whatsapp:branch", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return whatsappBranch(h.host, waNumber(payload));
  });
  handleClient("whatsapp:cancel", (event) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    cancelPairing();
  });

  // Logins Claude e xAI.
  handleClient("claude-login:start", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return startClaudeLogin(h.host, (ev) => { if (!h.win.isDestroyed()) h.win.webContents.send("claude-login:event", ev); });
  });
  handleClient("claude-login:code", (event, payload: unknown) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    return submitClaudeLoginCode(String((payload as { code?: unknown } | null)?.code ?? ""));
  });
  handleClient("claude-login:logout", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return claudeLogout(h.host);
  });
  handleClient("claude-login:cancel", (event) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    cancelClaudeLogin();
  });

  // Várias contas do Claude na máquina (backend: contas-claude.js). O login numa conta isolada é o mesmo fluxo do
  // tutorial 1 (link + código, eventos em claude-login:event), só que com CLAUDE_CONFIG_DIR na pasta da conta.
  const contaId = (payload: unknown): string => { const id = String((payload as { id?: unknown } | null)?.id ?? ""); if (!/^(padrao|c-[a-f0-9]{8})$/.test(id)) throw new Error("conta inválida"); return id; };
  const entrarNaConta = async (h: { host: string; win: Electron.BrowserWindow }, id: string): Promise<void> => {
    const view = await fetchContasClaude(h.host);
    const conta = view?.contas.find((c) => c.id === id);
    if (conta === undefined) throw new Error("conta não encontrada na máquina (backend antigo?)");
    const send = (ev: ClaudeLoginEvent): void => { if (!h.win.isDestroyed()) h.win.webContents.send("claude-login:event", ev); };
    await startClaudeLogin(h.host, send, conta.home ?? undefined);
    await conferirContaClaude(h.host, id); // o backend relê login, e-mail e uso
  };
  handleClient("contas-claude:listar", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return fetchContasClaude(h.host); });
  handleClient("contas-claude:criar", async (event, payload: unknown) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    const rotulo = String((payload as { rotulo?: unknown } | null)?.rotulo ?? "").slice(0, 60);
    const r = await criarContaClaude(h.host, rotulo);
    if (r === null) throw new Error("o backend desta máquina não tem contas (atualize o backend no seletor)");
    return r; // o renderer abre o login na conta nova (contas-claude:entrar); o backend registra na auditoria da máquina
  });
  handleClient("contas-claude:entrar", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return entrarNaConta(h, contaId(payload)); });
  handleClient("contas-claude:atualizar", (event, payload: unknown) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    const p = payload as { rotulo?: unknown; ativa?: unknown };
    return atualizarContaClaude(h.host, contaId(payload), { ...(typeof p.rotulo === "string" ? { rotulo: p.rotulo.slice(0, 60) } : {}), ...(typeof p.ativa === "boolean" ? { ativa: p.ativa } : {}) });
  });
  handleClient("contas-claude:reordenar", (event, payload: unknown) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    const ids = (payload as { ids?: unknown } | null)?.ids;
    return reordenarContasClaude(h.host, Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && /^c-[a-f0-9]{8}$/.test(x)) : []);
  });
  handleClient("contas-claude:remover", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return removerContaClaude(h.host, contaId(payload)); });
  handleClient("contas-claude:usar-agora", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return usarAgoraContaClaude(h.host, contaId(payload)); });
  handleClient("contas-claude:conferir", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return conferirContaClaude(h.host, contaId(payload)); });
  handleClient("contas-claude:limiares", (event, payload: unknown) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    const p = (payload ?? {}) as { sessao?: unknown; semanal?: unknown; estrategia?: unknown };
    const pct = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.max(50, Math.min(100, Math.round(v))) : undefined);
    const l: Partial<LimiaresClaude> = {};
    const s = pct(p.sessao); if (s !== undefined) l.sessao = s;
    const w = pct(p.semanal); if (w !== undefined) l.semanal = w;
    if (p.estrategia === "ordem" || p.estrategia === "folga") l.estrategia = p.estrategia;
    return limiaresContasClaude(h.host, l);
  });
  handleClient("xai-login:start", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return startXaiLogin(h.host, (ev) => { if (!h.win.isDestroyed()) h.win.webContents.send("xai-login:event", ev); });
  });
  handleClient("xai-login:cancel", (event) => { if (hostFromEvent(event) === null) throw new Error("origem inválida"); cancelXaiLogin(); });
  handleClient("xai-login:logout", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return xaiLogout(h.host); });
  handleClient("contas:entrar", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = (payload ?? {}) as { id?: unknown; navegador?: unknown; trocar?: unknown };
    if (!isContaId(p.id)) throw new Error("conta desconhecida");
    return entrarConta(h.host, p.id, p.navegador === true, p.trocar === true, (ev) => { if (!h.win.isDestroyed()) h.win.webContents.send("contas:evento", ev); });
  });
  handleClient("contas:instalar-gh", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return instalarGh(h.host); });
  // Tutorial 13: a pessoa troca o nome do link público dela (o comando da máquina renomeia a pasta dela, sem root).
  handleClient("link-publico:nome", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return linkPublicoNome(h.host, (payload as { nome?: unknown } | null)?.nome); });
  // Tutorial 13: o que está no ar, tirar do ar e publicar um arquivo deste Mac (o diálogo abre no main; o renderer nunca manda caminho), tudo como ela.
  handleClient("link-publico:lista", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return linkPublicoLista(h.host); });
  handleClient("link-publico:remover", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return linkPublicoRemover(h.host, (payload as { nome?: unknown } | null)?.nome); });
  handleClient("link-publico:publicar", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return linkPublicoPublicar(h.host, h.win, (payload as { nome?: unknown } | null)?.nome); });
  handleClient("contas:cancelar", (event) => { if (hostFromEvent(event) === null) throw new Error("origem inválida"); cancelarConta(); });
  handleClient("contas:sair", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const id = (payload as { id?: unknown } | null)?.id;
    if (!isContaId(id)) throw new Error("conta desconhecida");
    return sairConta(h.host, id);
  });

  handleClient("backend:account", async (event) => {
    const host = hostFromEvent(event)?.host;
    return host === undefined ? null : fetchAccountStatus(host);
  });
  handleClient("ui:quick-toggle", () => toggleQuickEntry());

  // Conversas com o agente.
  handleClient("chat:send", async (event, payload: unknown) => {
    const ctx = hostFromEvent(event);
    const p = payload as { conversationId?: unknown; text?: unknown };
    const text = typeof p?.text === "string" ? p.text.trim() : "";
    const conv = typeof p?.conversationId === "string" ? getConversation(p.conversationId) : undefined;
    if (ctx === null || text === "" || conv === undefined || conv.host !== ctx.host) return;
    if (conv.busy) {
      ctx.win.webContents.send("chat:error", { conversationId: conv.id, kind: "unknown", message: "Espere a resposta atual terminar." });
      return;
    }
    conv.busy = true;
    try {
      await runBackendTurn(conv, text);
    } finally {
      conv.busy = false;
    }
    if (!conv.closed) void rememberClaudeSession(conv);
  });
  // "Copiar ID": a sessão do Claude Code (o .jsonl na máquina); guardada, ou lida agora do backend.
  handleClient("chat:reference", async (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned === null) throw new Error("origem inválida");
    return { claude: owned.conv.claude ?? await rememberClaudeSession(owned.conv) };
  });
  handleClient("chat:cancel", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    owned?.conv.abort?.abort();
  });
  handleClient("chat:new", (event) => {
    const ctx = hostFromEvent(event);
    if (ctx === null) return { conversationId: "" };
    return { conversationId: createConversation(ctx.host).id };
  });
  handleClient("chat:list", (event) => {
    const ctx = hostFromEvent(event);
    return ctx === null ? [] : listConversationsForHost(ctx.host);
  });
  // Conversas que o admin excluiu na máquina (conversas-apagadas.json): saem daqui também. Devolve os ids que saíram.
  handleClient("chat:apagadas", async (event) => {
    const ctx = hostFromEvent(event);
    if (ctx === null || ctx.host === LOCAL_HOST) return [];
    const r = await runSsh(ctx.host, `cat "${APAGADAS_FILE}" 2>/dev/null\n`, 20_000);
    if (r.code !== 0) return [];
    const ids = conversasApagadas(listConversationsForHost(ctx.host), parseApagadas(r.stdout));
    for (const id of ids) { dropConversation(id); log(`[${ctx.host}] conversa ${id} excluída pelo admin: saiu daqui também`); }
    return ids;
  });
  handleClient("chat:rename", (event, payload: unknown) => {
    const p = payload as { conversationId?: unknown; title?: unknown };
    const owned = ownedConversation(event, payload);
    if (owned !== null && typeof p?.title === "string") renameConversation(owned.conv.id, p.title);
  });
  handleClient("chat:set-model", (event, payload: unknown) => {
    const p = payload as { conversationId?: unknown; model?: unknown };
    const owned = ownedConversation(event, payload);
    if (owned !== null && isBackendModel(p?.model)) setConversationModel(owned.conv.id, p.model);
  });
  handleClient("chat:reorder", (event, payload: unknown) => {
    const ctx = hostFromEvent(event);
    const ids = (payload as { conversationIds?: unknown })?.conversationIds;
    if (ctx === null || !Array.isArray(ids) || !ids.every((x) => typeof x === "string")) return;
    reorderConversations(ids, ctx.host);
  });
  // Fechar a aba mantém a conversa na lista lateral; excluir é explícito.
  handleClient("chat:close", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned !== null) closeTab(owned.conv.id);
  });
  handleClient("chat:delete", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned === null) return;
    dropConversation(owned.conv.id);
    // A transcrição do Claude Code na máquina vai junto (o admin também deixa de vê-la). Backend antigo: ignora.
    void deleteBackendSession(owned.host, owned.conv.id).then((n) => { if (n !== null && n > 0) log(`[${owned.host}] conversa ${owned.conv.id}: ${n} transcrição(ões) apagada(s) na máquina`); });
  });
  handleClient("chat:open", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    return owned === null ? null : (openConversation(owned.conv.id) ?? null);
  });
  handleClient("chat:archive", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const archived = (payload as { archived?: unknown })?.archived === true;
    if (owned !== null) archiveConversation(owned.conv.id, archived);
  });
  handleClient("chat:duplicate", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    return owned === null ? null : (duplicateConversation(owned.conv.id) ?? null);
  });
  handleClient("chat:branch", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const index = (payload as { index?: unknown })?.index;
    return owned === null || typeof index !== "number" ? null : (branchConversation(owned.conv.id, index) ?? null);
  });
  handleClient("chat:export", async (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const format = (payload as { format?: unknown })?.format;
    if (owned === null || (format !== "md" && format !== "json")) return null;
    const stored = getStoredConversation(owned.conv.id);
    if (stored === undefined) return null;
    const ext: ExportFormat = format;
    const result = await dialog.showSaveDialog(owned.win, {
      title: "Exportar conversa",
      defaultPath: path.join(app.getPath("documents"), `${slugify(conversationTitle(stored))}.${ext}`),
      filters: ext === "md" ? [{ name: "Markdown", extensions: ["md"] }] : [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || result.filePath === undefined || result.filePath === "") return null;
    const body = ext === "md" ? conversationToMarkdown(stored) : `${JSON.stringify(stored, null, 2)}\n`;
    fs.writeFileSync(result.filePath, body, { mode: 0o600 });
    return { path: result.filePath };
  });
  handleClient("ui:tab-menu", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned === null) return null;
    const state = (payload as { state?: { busy?: unknown; archived?: unknown } })?.state ?? {};
    const busy = state.busy === true;
    const archived = state.archived === true;
    return new Promise<TabMenuAction | null>((resolve) => {
      let settled = false;
      const pick = (action: TabMenuAction | null): void => { if (!settled) { settled = true; resolve(action); } };
      const item = (label: string, action: TabMenuAction, enabled = true): Electron.MenuItemConstructorOptions =>
        ({ label, enabled, click: () => pick(action) });
      const menu = Menu.buildFromTemplate([
        item("Renomear", "rename"),
        item("Duplicar", "duplicate", !busy),
        { label: "Exportar", submenu: [item("Markdown (.md)", "export-md"), item("JSON (.json)", "export-json")] },
        item("Copiar ID  ⓘ", "copy-ref"),
        archived ? item("Desarquivar", "unarchive") : item("Arquivar", "archive", !busy),
        { type: "separator" },
        item("Fechar aba", "close"),
        item("Excluir conversa…", "delete", !busy),
      ]);
      // O callback de fechamento corre antes do click; o adiamento deixa o click vencer.
      menu.popup({ window: owned.win, callback: () => setTimeout(() => pick(null), 0) });
    });
  });

  const liveNotifications = new Set<Notification>();
  // Notificação de teste (como no Rambox): a pessoa confirma que o macOS deixa as do meu-bot passarem; na primeira, o
  // sistema pede a permissão junto. Clicar traz a janela.
  handleClient("ui:notify-test", (event) => {
    const h = hostFromEvent(event);
    if (h === null || !Notification.isSupported()) throw new Error("este sistema não mostra notificações");
    const n = new Notification({ title: "meu-bot", body: "As notificações estão funcionando. Até logo!", silent: false });
    n.on("click", () => { notificacaoClicada(); h.win.show(); h.win.focus(); });
    n.show();
  });
  // Licença e devices desta conta (licenca.json + maquinas.json): pelo backend, ou por SSH onde ele não tem a rota (Hermes).
  handleClient("license:get", async (event) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    const lic = await lerLicencaDaMaquina(h.host);
    void browserSincronizarCrm(h.host, lic); // a extensão do CRM acompanha a licença relida (admin liberou o Pro com o app aberto)
    return lic.view;
  });
  // Avisos de segurança desta máquina (alertas.json, via backend): um Mac novo usou o meu-bot dela.
  handleClient("alerts:get", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return fetchAlertPrefs(h.host); });
  handleClient("alerts:set", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = payload as { whatsapp?: unknown } | null;
    return saveAlertPrefs(h.host, { whatsapp: p?.whatsapp !== false });
  });
  handleClient("ui:notify", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const p = payload as { title?: unknown; body?: unknown };
    if (owned === null || !Notification.isSupported()) return;
    const { host, conv } = owned;
    const n = new Notification({
      title: typeof p.title === "string" ? p.title.slice(0, 80) : "meu-bot",
      body: typeof p.body === "string" ? p.body.slice(0, 200) : "",
      silent: false,
    });
    liveNotifications.add(n);
    const done = (): void => { liveNotifications.delete(n); };
    n.on("click", () => {
      done();
      notificacaoClicada();
      // A janela dona pode ter sido fechada: reabre a da máquina e foca a conversa quando ela carregar.
      const win = openMainWindow(host, "notify");
      app.focus({ steal: true });
      sendWhenLoaded(win, "ui:focus-conversation", { conversationId: conv.id });
    });
    n.on("close", done);
    n.show();
  });
}
