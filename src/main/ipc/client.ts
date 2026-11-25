/**
 * Variante: cliente. Handlers IPC só do meu-bot normal: conversar com o agente, parear e mexer no WhatsApp,
 * logins, instalar coisas na máquina, suporte do lado da pessoa. No meu-bot-admin cada canal daqui vira um
 * stub que recusa (ipc/registry.ts): o admin só lê e usa as ações de suporte.
 */
import { VOZES, isVozId } from "../whatsapp/vozes-core";
import { app, dialog, Menu, Notification } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { CrmPipelineExtras, AudioSetup, ClaudeLoginEvent, LicenseView, ClaudeSessionRef, ExportFormat, LimiaresClaude, TabMenuAction, WhatsappEvent, WhatsappStatus } from "../../shared/ipc";
import { conversationToMarkdown, conversationTitle, slugify } from "../conversa/export";
import { atualizarContaClaude, conferirContaClaude, criarContaClaude, deleteBackendSession, fetchAccountStatus, fetchAlertPrefs, fetchBackendSession, fetchContasClaude, limiaresContasClaude, log, reapresentarMachine, removerContaClaude, reordenarContasClaude, runBackendTurn, saveAlertPrefs, usarAgoraContaClaude } from "../maquina/backend";
import { lerLicenca, lerLicencaDaMaquina } from "../licenca/licenca-maquina";
import { avisarMaquinaVista, avisoDaRenovacao, renovarSePreciso, tirarProDaConta, usarProDaConta } from "../licenca/licenca-conta";
import { assertAcesso } from "../licenca/acesso";
import { telaAcordar, telaStatus, telaUrl } from "../maquina/tela";
import { abrirInspector } from "../inspector/inspector";
import { despacharExtInvoke } from "../extensao/extensao-core";
import { estadoDaExtensao } from "../extensao/registro";
import { esquecerPermissoes, responderPermissao } from "../navegador/nav-permissoes";
import { navWhatsappInfo, setNavWhatsapp } from "../navegador/navegador-whatsapp";
import { numerosOk } from "../navegador/navegador-whatsapp-hermes-core";
import { crmCriarPipeline, crmDefinirPadrao, crmLocal } from "../crm/crm-local";
import { caps } from "../app/variant";
import { eventoHook } from "../app/depuracao";
import { disableSshCheck, restoreLastPolicy } from "../maquina/tailscale";
import { cancelPairing, esquecerWhatsapp, pairingInProgress, runSsh, setDmPolicy, setTypingMode, startPairing, whatsappBranch, whatsappEscolherAgente, whatsappLogout, whatsappSetDono, whatsappStatus } from "../whatsapp/whatsapp";
import { pauseRuleSh } from "../whatsapp/whatsapp-pause";
import { whatsappSugestaoAcao } from "../whatsapp/whatsapp-sugestoes";
import { parseSugestaoComando } from "../whatsapp/whatsapp-sugestoes-core";
import { cancelClaudeLogin, claudeLogout, startClaudeLogin, submitClaudeLoginCode } from "../agente/claudeLogin";
import { ollamaStatusLocal, prepareOllamaLocal, removerOllamaLocal, setOllamaLigadoLocal } from "../agente/ollamaLocal";
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
import { getHostNames, getNotificacaoSom, isBackendModel } from "../app/settings";
import { objectiveInfo, resetObjective, saveObjectiveSkill, setObjective } from "../agente/objetivo";
import { skillInstalar, skillPrevia, skillRemover, skillsImportadas } from "../agente/skills-importar";
import { crmInfo, crmTest, resetCrm, setCrm } from "../crm/crm";
import { toggleQuickEntry } from "../app/quickEntry";
import { gmailInstalled, guardaInstalled, installAudio, installCrm, installGmail, installGuarda, installHermesPausa, installNavegador, installStatusLine, installTela, navegadorInstalled, ollamaStatusRemoto, prepareOllamaRemoto, removerOllamaRemoto, setOllamaLigadoRemoto, statusLineInstalled, uninstallCrm, uninstallGuarda, uninstallStatusLine } from "../maquina/hostProbe";
import { gmailAgente, gmailAgenteInfo, gmailAgenteReligar } from "../google/gmail-api";
import { readSegments, writeSegments } from "../agente/statusLine";
import { deliverNow, reportSupportProgress, resetSupport, setSupport, setSupportNameOnly, setSupportShare, supportCodeText, supportInfo } from "../client/support";
import { openMainWindow, sendWhenLoaded } from "../app/windows";
import { hostFromEvent, ownedConversation, waNumber } from "./context";
import { exigeCap, handleClient, onClient } from "./registry";
import { SEM_CAPACIDADE_MSG } from "./ipc-policy";
import { setObservadorStatus } from "./shared";
import { browserAgent, browserAgentInfo, browserExtensions, browserOpen, browserRemoveExtension, browserSetActive, browserSincronizarCrm, browserFavoriteAdd, browserFavoriteRemove, browserWorkspacesSet } from "../navegador/browser";
import { registrar } from "../auditoria/auditoria";
import { abrirPaginaModulo, atualizarFontes, planilhaParaModulo, desligarModulo, ligarModulo, listarModulos, salvarCredenciais, salvarOpcoes, temModulos, testarModulo } from "../modulos/modulos";

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
  // Skills importadas pelo link do repositório (docs/planos/marketplace-skills.md): a máquina baixa, a tela mostra a
  // prévia e só então instala. O "instalar" só leva o commit: o resto vem da prévia guardada no main.
  handleClient("skills:listar", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return skillsImportadas(h.host); });
  handleClient("skills:previa", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return skillPrevia(h.host, (payload as { link?: unknown } | null)?.link); });
  handleClient("skills:instalar", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return skillInstalar(h.host, (payload as { commit?: unknown } | null)?.commit); });
  handleClient("skills:remover", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return skillRemover(h.host, (payload as { nome?: unknown } | null)?.nome); });
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
  // O agente do WhatsApp também usa o Navegador. OpenClaw: o número do agente e a lista dos grupos (trava por remetente do
  // gateway). Hermes: só os números que o dono marcar aqui (passe por turno, navegador-whatsapp-hermes.ts).
  handleClient("browser:agent-whatsapp", exigeCap("agenteNavegador", async (event, payload: unknown) => {
    const h = ctxOf(event);
    const p = payload as { on?: unknown; numeros?: unknown } | null;
    const on = p?.on;
    if (typeof on !== "boolean") return navWhatsappInfo(h.host);
    // `numeros` = a lista marcada pelo dono (só onde ela é do app: Hermes); no OpenClaw quem pode vem da config do gateway.
    const numeros = Array.isArray(p?.numeros) ? numerosOk(p.numeros) : undefined;
    await assertAcesso(h.host);
    const r = await setNavWhatsapp(h.host, on, numeros);
    void registrar(h.host, !on ? "navegador.whatsapp-desligar" : numeros !== undefined ? "navegador.whatsapp-numeros" : "navegador.whatsapp-ligar", r.liberados.map((n) => `+${n}`).join(", "));
    return r;
  }));
  handleClient("browser:agent", exigeCap("agenteNavegador", (event, payload: unknown) => { const h = ctxOf(event); browserAgent(h.host, (payload as { on?: unknown } | null)?.on === true); return browserAgentInfo(h.host); }));
  onClient("browser:active", (event, payload: unknown) => { const h = hostFromEvent(event); const id = (payload as { wcId?: unknown } | null)?.wcId; if (h !== null && typeof id === "number") browserSetActive(h.host, id); });
  handleClient("browser:remove-extension", (event, payload: unknown) => { const id = (payload as { extId?: unknown } | null)?.extId; if (typeof id !== "string" || !/^[a-p]{32}$/.test(id)) throw new Error("id de extensão inválido"); return browserRemoveExtension(ctxOf(event).host, id); });
  handleClient("browser:favorite-add", (event, payload: unknown) => { const p = payload as { titulo?: unknown; url?: unknown } | null; if (typeof p?.url !== "string") throw new Error("falta url"); return browserFavoriteAdd(ctxOf(event).host, { titulo: typeof p.titulo === "string" ? p.titulo : "", url: p.url }); });
  handleClient("browser:favorite-remove", (event, payload: unknown) => { const id = (payload as { id?: unknown } | null)?.id; if (typeof id !== "string" || id === "") throw new Error("falta id"); return browserFavoriteRemove(ctxOf(event).host, id); });
  handleClient("browser:workspaces-set", (event, payload: unknown) => { const h = ctxOf(event); return browserWorkspacesSet(h.host, (payload as { espacos?: unknown } | null)?.espacos, h.win); });
  handleClient("browser:permissao", (event, payload: unknown) => { ctxOf(event); const p = (payload ?? {}) as { id?: unknown; decisao?: unknown }; if (typeof p.id === "string" && (p.decisao === "sempre" || p.decisao === "agora" || p.decisao === "nunca")) responderPermissao(p.id, p.decisao); });
  handleClient("browser:permissoes-esquecer", (event, payload: unknown) => { const h = ctxOf(event); const o = (payload as { origem?: unknown } | null)?.origem; esquecerPermissoes(h.host, typeof o === "string" ? o : undefined); });
  handleClient("browser:request-pro", async (event) => { const h = ctxOf(event); const pedido = caps().planoExigido === "free" ? "pediu o plano Pro (aba Navegador)" : `pediu para liberar o ${caps().produto} (assinatura)`; await registrar(h.host, "plano.pedir", pedido); log(`[navegador] ${h.host}: ${pedido}`); });
  // Tutorial 18 · CRM pelo WhatsApp (Pro): estado, instalar plugin, gravar chave/pipeline/regras, testar, refazer.
  // Módulos de produto (o fixo do app e os add-ons com módulos na licença da máquina): a licença do add-on de cada
  // módulo é conferida no main a cada ação e de novo pelo backend da máquina a cada turno.
  const modId = (p: unknown): string => { const id = p !== null && typeof p === "object" ? (p as { id?: unknown }).id : undefined; if (typeof id !== "string" || !/^[a-z][a-z0-9-]{1,40}$/.test(id) || !temModulos()) throw new Error("módulo inválido"); return id; };
  const progressoModulo = (h: ReturnType<typeof ctxOf>, id: string) => (line: string): void => { if (!h.win.isDestroyed()) h.win.webContents.send("modulos:progress", { id, line }); };
  // Os módulos vêm do repositório de cada produto, baixado com git neste Mac (atualizarFontes).
  const semModulos = (): void => { if (!temModulos()) throw new Error("este app não tem módulos"); };
  handleClient("modulos:atualizar-fonte", async (event) => { semModulos(); return atualizarFontes(ctxOf(event).host); });
  handleClient("modulos:abrir-pagina", async (event, p: unknown) => { const h = ctxOf(event); const id = modId(p); const r = await abrirPaginaModulo(h.host, id); void registrar(h.host, "modulo.pagina", id); return r; });
  handleClient("modulos:planilha", async (event, p: unknown) => {
    const h = ctxOf(event); const id = modId(p);
    const o = p as { link?: unknown; aba?: unknown; tipo?: unknown; simular?: unknown };
    if (typeof o.link !== "string" || typeof o.aba !== "string" || typeof o.tipo !== "string" || typeof o.simular !== "boolean") throw new Error("pedido de planilha inválido");
    const r = await planilhaParaModulo(h.host, id, { link: o.link, aba: o.aba, tipo: o.tipo, simular: o.simular });
    // A prévia também fica na auditoria: é nela que as células saem da Conta Google para o serviço do módulo.
    void registrar(h.host, o.simular ? "modulo.planilha-previa" : "modulo.planilha", id);
    return r;
  });
  handleClient("modulos:testar", async (event, p: unknown) => { const h = ctxOf(event); const id = modId(p); return testarModulo(h.host, id, progressoModulo(h, id)); });
  handleClient("modulos:listar", async (event) => { semModulos(); return listarModulos(ctxOf(event).host); });
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
  const comp = async (event: Electron.IpcMainInvokeEvent): Promise<string> => { if (!caps().telaComputador) throw new Error(SEM_CAPACIDADE_MSG); const h = ctxOf(event); await assertAcesso(h.host); return h.host; };
  handleClient("computador:status", async (event) => telaStatus(await comp(event)));
  handleClient("computador:acordar", async (event) => { const host = await comp(event); const st = await telaAcordar(host); log(`[computador] ${host}: acordar → ${st.erro ?? (st.rodando ? "no ar" : "parada")}`); return st; });
  handleClient("computador:instalar", async (event) => { const host = await comp(event); const r = await installTela(host); void registrar(host, "computador.instalar", "", r.ok ? "ok" : `código ${r.codigo ?? "timeout"}`); return r; });
  handleClient("computador:url", async (event) => telaUrl(await comp(event)));
  // Inspector: só no produto que tem a capacidade (meu-bot-inspector-staging); nos outros o canal recusa.
  handleClient("inspector:abrir", exigeCap("controleRemoto", async () => { if (!caps().inspector) throw new Error("o Inspector só existe no meu-bot-inspector-staging"); return abrirInspector(); }));
  // Página própria de um app derivado: o canal único por onde ela fala com o código do derivado no main. Só exige que
  // haja extensão (sem ela, ou com nome que ela não registrou, recusa); cada handler valida o que recebe.
  handleClient("ext:invoke", (_event, payload) => despacharExtInvoke(estadoDaExtensao(), payload));
  // A própria pessoa leva a licença da conta dela (Pro e add-ons pagos) à máquina desta janela, e tira.
  const relerLicenca = (host: string) => async (): Promise<LicenseView | null> => { const lic = await lerLicencaDaMaquina(host); void browserSincronizarCrm(host, lic); void avisarMaquinaVista(host, lic.view?.origem); return lic.view; };
  handleClient("plano:usar-da-conta", async (event) => { const h = ctxOf(event); const r = await usarProDaConta(h.host, relerLicenca(h.host)); void registrar(h.host, "plano.conta", "usou a licença da conta nesta máquina", r.ok ? "ok" : r.erro); return r; });
  // Aviso de device no chat, "Já adicionei: conferir": reemite a licença da conta nesta máquina (o limite novo) e
  // apresenta este Mac de novo; o backend diz se ele entrou.
  handleClient("plano:conferir-device", async (event) => { const h = ctxOf(event); await renovarSePreciso(h.host, Date.now(), { agora: true }).catch(() => false); const status = await reapresentarMachine(h.host).catch(() => null); void registrar(h.host, "plano.conta", "conferiu a vaga de device deste Mac", status ?? "sem resposta"); return { status }; });
  handleClient("plano:tirar-da-conta", async (event) => { const h = ctxOf(event); const r = await tirarProDaConta(h.host, relerLicenca(h.host)); void registrar(h.host, "plano.conta", "tirou a licença da conta desta máquina", r.ok ? "ok" : r.erro); return r; });
  handleClient("plano:avisar-pagamento", async (event) => { const h = ctxOf(event); await registrar(h.host, "plano.pago", "avisou que já pagou (aviso de plano)"); log(`[plano] ${h.host}: avisou que já pagou`); });
  // Espaço da conta na máquina (Configurações › Espaço): a cota dela, o que dá para apagar (só caches e workspaces, como ela) e o pedido de mais espaço.
  handleClient("cota:status", (event) => cotaStatus(ctxOf(event).host));
  handleClient("cota:maiores", (event) => cotaMaiores(ctxOf(event).host));
  handleClient("cota:apagar-item", (event, payload: unknown) => cotaApagarItem(ctxOf(event).host, (payload as { caminho?: unknown } | null)?.caminho));
  handleClient("cota:pedir-mais", async (event, payload: unknown) => { const h = ctxOf(event); const pct = Number((payload as { pct?: unknown } | null)?.pct); await registrar(h.host, "cota.pedir-mais", Number.isFinite(pct) ? `${Math.round(pct)}%` : ""); log(`[cota] ${h.host}: pediu mais espaço${Number.isFinite(pct) ? ` (${Math.round(pct)}%)` : ""}`); });
  handleClient("crm:info", (event) => crmInfo(ctxOf(event).host));
  // Tutorial 18 (meu-bot-crm): o primeiro pipeline do CRM da máquina e qual é o do WhatsApp.
  handleClient("crm:local", (event) => crmLocal(ctxOf(event).host));
  handleClient("crm:pipeline-criar", async (event, payload: unknown) => {
    const h = ctxOf(event); await assertAcesso(h.host);
    const p = payload as { name?: unknown; stages?: unknown; fields?: unknown; agenteAutonomo?: unknown } | null;
    if (typeof p?.name !== "string" || p.name.trim() === "" || p.name.length > 60) throw new Error("nome inválido");
    if (!Array.isArray(p.stages) || p.stages.length < 2 || p.stages.length > 12 || !p.stages.every((s) => typeof s === "string" && s.trim() !== "" && s.length <= 40)) throw new Error("etapas inválidas (2 a 12)");
    // Campos e autonomia vêm do modelo escolhido; a forma de cada campo quem valida é o crm-modelo.js da máquina.
    if (p.fields !== undefined && (!Array.isArray(p.fields) || p.fields.length > 30)) throw new Error("campos inválidos");
    if (p.agenteAutonomo !== undefined && typeof p.agenteAutonomo !== "boolean") throw new Error("agenteAutonomo inválido");
    const extras: CrmPipelineExtras = { ...(p.fields !== undefined ? { fields: p.fields as NonNullable<CrmPipelineExtras["fields"]> } : {}), ...(p.agenteAutonomo !== undefined ? { agenteAutonomo: p.agenteAutonomo } : {}) };
    const r = await crmCriarPipeline(h.host, p.name.trim(), (p.stages as string[]).map((s) => s.trim()), extras);
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
  handleClient("gmail:agent", exigeCap("agenteNavegador", async (event, payload: unknown) => {
    const h = ctxOf(event); const on = (payload as { on?: unknown } | null)?.on;
    if (typeof on !== "boolean") { await gmailAgenteReligar(h.host); return gmailAgenteInfo(h.host); }
    if (on) await assertAcesso(h.host);
    return gmailAgente(h.host, on);
  }));
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
      : p?.kind === "out" && (p.mode === "off" || p.mode === "inbound" || p.mode === "always") ? { kind: "out", mode: p.mode, ...(isVozId(voz) ? { voz } : {}), ...(typeof (p as { soAudio?: unknown }).soAudio === "boolean" ? { soAudio: (p as { soAudio: boolean }).soAudio } : {}) } : null;
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
  // "Digitando…" do agente no WhatsApp: mostrar sempre ou nunca (tutorial 16); o motor decide se reinicia o gateway.
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
  // Modo "sugere e você aprova": ligar/desligar, aprovar (como está ou editada) e descartar. Só no canal staging por enquanto.
  handleClient("whatsapp:sugestao", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    if (caps().canal !== "staging") throw new Error("o modo sugestão ainda não está disponível nesta versão");
    const c = parseSugestaoComando(payload);
    if (c === null || c.acao === "listar") throw new Error("pedido inválido");
    return whatsappSugestaoAcao(h.host, c).then((r) => {
      void registrar(h.host, c.acao === "ligar" ? "whatsapp.sugestao.ligar" : c.acao === "desligar" ? "whatsapp.sugestao.desligar" : c.acao === "aprovar" ? "whatsapp.sugestao.aprovar" : "whatsapp.sugestao.descartar", c.acao === "aprovar" ? (c.texto !== undefined ? "editada" : "") : c.acao === "descartar" && c.id === "todas" ? "todas" : "", "id" in c ? c.id : "");
      return r;
    });
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

  // Login do Claude.
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
  // Modo grátis (tutorial 16): o Ollama do meu-bot neste Mac (ollamaLocal.ts) ou na máquina por SSH desta janela
  // (install-ollama.sh, pelo hostProbe.ts). Na máquina remota só no staging, como o resto do modo grátis.
  const hostOllama = (event: Electron.IpcMainInvokeEvent): { win: Electron.BrowserWindow; host: string } => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return h;
  };
  const exigeRemotoOferecido = (): void => { if (caps().canal !== "staging") throw new Error("o modo grátis numa máquina por SSH ainda não é oferecido nesta versão"); };
  const eventoOllama = (win: Electron.BrowserWindow) => (line: string): void => { if (!win.isDestroyed()) win.webContents.send("ollama:event", { text: line }); };
  handleClient("ollama:status", (event) => {
    const h = hostOllama(event);
    if (h.host === LOCAL_HOST) return ollamaStatusLocal();
    return caps().canal === "staging" ? ollamaStatusRemoto(h.host) : null;
  });
  handleClient("ollama:prepare", (event) => {
    const h = hostOllama(event);
    if (h.host === LOCAL_HOST) return prepareOllamaLocal(eventoOllama(h.win));
    exigeRemotoOferecido();
    return prepareOllamaRemoto(h.host, eventoOllama(h.win));
  });
  handleClient("ollama:ligar", (event, payload) => {
    const h = hostOllama(event);
    const ligado = (payload as { ligado?: unknown } | undefined)?.ligado === true;
    if (h.host === LOCAL_HOST) return setOllamaLigadoLocal(ligado);
    exigeRemotoOferecido();
    return setOllamaLigadoRemoto(h.host, ligado);
  });
  handleClient("ollama:remover", (event) => {
    const h = hostOllama(event);
    if (h.host === LOCAL_HOST) return removerOllamaLocal(eventoOllama(h.win));
    exigeRemotoOferecido();
    return removerOllamaRemoto(h.host, eventoOllama(h.win));
  });
  handleClient("contas:entrar", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = (payload ?? {}) as { id?: unknown; navegador?: unknown; trocar?: unknown };
    if (!isContaId(p.id)) throw new Error("conta desconhecida");
    return entrarConta(h.host, p.id, p.navegador === true, p.trocar === true, (ev) => { if (!h.win.isDestroyed()) h.win.webContents.send("contas:evento", ev); });
  });
  handleClient("contas:instalar-gh", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return instalarGh(h.host); });
  // Tutorial 12: a pessoa troca o nome do link público dela (o comando da máquina renomeia a pasta dela, sem root).
  handleClient("link-publico:nome", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return linkPublicoNome(h.host, (payload as { nome?: unknown } | null)?.nome); });
  // Tutorial 12: o que está no ar, tirar do ar e publicar um arquivo deste Mac (o diálogo abre no main; o renderer nunca manda caminho), tudo como ela.
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
    const n = new Notification({ title: "meu-bot", body: "As notificações estão funcionando. Até logo!", silent: !getNotificacaoSom() });
    n.on("click", () => { notificacaoClicada(); h.win.show(); h.win.focus(); });
    n.show();
  });
  // Licença e devices desta conta (licenca.json + maquinas.json): pelo backend, ou por SSH onde ele não tem a rota (Hermes).
  handleClient("license:get", async (event) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    const lic = await lerLicencaDaMaquina(h.host);
    void browserSincronizarCrm(h.host, lic); // a extensão do CRM acompanha a licença relida (admin liberou o Pro com o app aberto)
    // A licença da conta nesta máquina vale 30 dias: renova em segundo plano; se o arquivo mudou, a janela relê.
    void renovarSePreciso(h.host).then((mudou) => { if (mudou && !h.win.isDestroyed()) h.win.webContents.send("license:changed", {}); });
    // A conta fica sabendo que a pessoa usa esta máquina (o console a lista, mesmo com a licença do admin).
    void avisarMaquinaVista(h.host, lic.view?.origem);
    // A conta recusou renovar a licença daqui (máquina fora do limite): a tela da conta mostra o motivo.
    const aviso = avisoDaRenovacao(h.host);
    return lic.view === null || aviso === null ? lic.view : { ...lic.view, avisoRenovacao: aviso };
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
      silent: !getNotificacaoSom(),
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
