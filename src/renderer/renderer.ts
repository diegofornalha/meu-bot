import type { ZoomAction, ZoomState, BrowserAgentState, BrowserExtensionInfo, NavFavorito, NavService, NavWorkspace, NavWorkspaces, CrmInfo, CrmDiag, CrmLocal, LicenseView, NetState, UpdateState, AccountStatus, ClaudeAuthInfo, ClaudeLoginEvent, ContasClaudeView, ObjectiveChoice, ObjectiveInfo, WaMarkPatch, WhatsappChat, WhatsappEvent, WhatsappReplyChoice, WhatsappStatus, WhatsappThreadMessage, WhatsappMenuAction, WhatsappGroup, WhatsappGroups, WhatsappGroupMenuAction, WhatsappGroupPatch, WhatsappOrigin, WhatsappArchive, AudioSetup, VoiceReplyMode, VozId, SupportInfo, SupportShare, Capabilities, ToolEvent, BackendModel, BackendStatusEvent, ContextEvent, DoneEvent, ErrorEvent, ExportFormat, MemoryView, SettingsView, StoredConversationView, TabMenuAction, Theme, StatusLineSegments, ContaEstado, ContaEvento, ContaId , DonoInfo } from "../shared/ipc";
import { hostAccent } from "./lib/host-color.js";
import { byId as $, el } from "./lib/dom.js";
import { deviceLine, licenseSummary } from "./lib/admin-view.js";
import type { PageTab } from "./lib/pages-types.js";
import { mountSuportePage } from "./admin/suporte-page.js";
import { mountAuditoriaPage } from "./admin/auditoria-page.js";
import { mountUsuariosPage } from "./admin/usuarios-page.js";
import { mountClaudeGlobalPage } from "./admin/claude-global-page.js";
import { mountLinkPublicoPage } from "./admin/link-publico-page.js";
import { mountPrepararPage } from "./admin/preparar-page.js";
import { mountBotMirror, type BotMirror } from "./admin/bot-mirror.js";
import { ipcErrorText } from "./lib/ipc-error.js";
import { avisoSemConta, estadoTexto, nomeConta, usoTexto } from "./lib/contas-claude.js";
import { planMascots } from "./lib/intro-mascots.js";
import { mountSnake } from "./snake.js";
import { ACERVO_SKILLS, installPrompt } from "./lib/acervo.js";
import { hostLabel, setHostNicknames } from "./lib/probe-text.js";
import { shellBlockToPaste, xtermTheme } from "./lib/terminal.js";
import { ID_INFO_TEXT, ID_INFO_TITLE, infoBalloon } from "./lib/info-balloon.js";
import { GUIDE_ACTION_LABEL, TUTORIAIS, emptyFlags, guideTabTitle, parseTutMemory, parseTutPulados, sidebarBadge, tutorialState, tutorialBadge, visibleTutorials, type GuideContext, type GuideFlagName, type GuideFlags, type GuideTarget, type Tutorial, type TutorialState } from "./lib/tutoriais.js";
import { REPLY_NOTE, REPLY_OPTIONS, listedNumbers, parseWaNumbers, replyChoiceOf } from "./lib/whatsapp-resposta.js";
import { GRUPOS_AVISO, GRUPOS_QUEM_NOTA, grupoAlvo, quemEscolhido } from "./lib/whatsapp-grupos.js";
import { matizDoModelo, modelosDaMaquina, rotuloDoModelo } from "../shared/modelos.js";
import { LEVEL_OPTIONS, OBJECTIVE_OPTIONS } from "./lib/objetivo.js";
import { renderMarkdown } from "./lib/markdown.js";
import { MODELOS_PIPELINE, etapasDoTexto, validarPipeline } from "./lib/crm-modelos.js";
import { groupByDate, matches, normalize, shortDate, type SidebarConversation } from "./lib/sidebar.js";
import { dropCache, readCache, writeCache, type CacheStore, type Cached } from "./lib/cache.js";
import { conversationReferenceText, grupoReferenceText, waReferenceText } from "./lib/reference.js";
import { providerLabel } from "./lib/provider-label.js";
import { etiquetaPro, placeholderDaCaixa, resumoAgente } from "./lib/casca.js";
import { nesteComputador } from "./lib/plataforma.js";
import { updateBlockerText, updateStateText } from "./lib/update-text.js";
import { offlineBarText } from "./lib/offline-text.js";
import { browserAccess, displayUrl, planoLiberaPro, proBlockText, tabLabel, type ProAccess, crmProprioOk, modulosNaLicenca } from "./lib/pro.js";
import { mountModulosPage } from "./modulos/modulos-page.js";
import { paginaModulos } from "./modulos/modulos-crm.js";
import { mountContaGoogle } from "./conta-google/conta-google-page.js";
import { mountGmail } from "./gmail/gmail-page.js";
import { gmailGuiaFato, ligarGmailGuia, refreshGmailGuia } from "./gmail/gmail-guia.js";
import { mountComputador } from "./computador/computador-page.js";
import { mountInspector } from "./inspector/inspector-page.js";
import { montarExtensao } from "./extensao/extensao.js";
import type { PaginaDeExtensao } from "./extensao/api.js";
import { clampSplitRatio, maxColunas, minDireita, parseSplitPref, splitAdd, splitLabel, splitLayout, splitPrefPageIds, SPLIT_MIN_PX } from "./lib/split.js";
import { recorteOculto, recorteTitulo, recortesPara, parseRecortesPref, type Recorte, type RecortesPref } from "./lib/recortes.js";
import { favLabel, favOf, favTitleFor } from "./lib/favoritos.js";
import { rankPalette, type PaletteItem } from "./lib/palette-rank.js";
import { ESPACO_THRESHOLDS, buildSegments, previewLine, SL_TEST_COMMAND, thresholdToWarn, timeUntil } from "./lib/status-line.js";
import { advanceOnboard, FINAL_MESSAGE, SKIPPED_MESSAGE, TOUR_INVITE, initialOnboardState, pickFeedback, welcomeMessage, type Feedback, type OnboardEvent, type OnboardState } from "./lib/onboarding.js";
import { firstReplyOnHost, FALLBACK_TUTORIAL, clAuth, enterClaude, ligarContasAgente, logoutClaude, navHostsIn, offerClaudeLogin, offerSkillFromTurn, refreshClaudeLine, refreshContasClaude, renderContasClaude, contasClaudeView } from "./agente/contas-agente.js";
import { ctx, ehRemoto } from "./app/ctx.js";
import { conferirPassos } from "./tutoriais/passos.js";
import { abaFixaAtual, inserirAba, activatePage, closePage, deactivatePage, definePage, pintarFixada, ehVazia, ligarPaginas, openPage, pageActive, pagePrev, pageShown, pages, preencherEsquerda, relayoutSplit, restoreSplit, splitColunaVazia, splitOff, splitOn, splitOnAny, splitPages, toggleSplit } from "./app/paginas.js";
import { acervoList, ligarAcervo, paintAcervoCount } from "./acervo/acervo.js";
import { nomesImportados, refreshSkillsImportadas, renderMinhasSkills } from "./acervo/minhas-skills.js";
import { activeGuide, ligarTutoriais, loadGuideFlags, openGuide, paintGuide, paintGuideTargets, paintTutCount, reportProgress, resetTutorial, saveGuideFlag, tutCounts, tutorialDone, tutorialsReady, visibleNow } from "./tutoriais/tutoriais.js";
import { chooseReply, comPareamento, disconnectWhatsapp, fmtPhone, ligarAgenteWhatsapp, openWhatsapp, paintWhatsapp, pairWhatsapp, refreshWhatsapp, renderAudioControls, renderChannelEditor, renderReplyCards, replyChoiceNow, requestAgentPrepare, waAgentBtn, waConnected, waDialog, waPairBtn, waPairing, waPolicyBox, waPolicyCards, waPolicySaving, waProgress, waProgressText, waQr, waSuccess } from "./whatsapp/agente-whatsapp.js";
import { cacheDrop, cacheRead, cacheWrite, getListMode, ligarConversas, paintArquivadas, paintListMode, paintWaSidebar, setListMode, waChatTitle } from "./whatsapp/conversas.js";
import { TUT_GRUPOS, ligarGrupos, loadGrupoAlvo, refreshWaGroups, waGroupReplied, waGroupTitle, waGroups, waGroupsAt, waGroupsInflight, waGroupsSection } from "./whatsapp/grupos.js";
import { ligarChat, openWaBranch, openWaChat, paintWaChatTab, renderWaChat, renderWaQuote, waBubble, waChatPages, waCopy, waMsgKey, waSkeleton } from "./whatsapp/chat.js";
import { OLLAMA_TUTORIAL, enterOllama, ligarOllama, ollamaNoMenu, refreshOllamaLine, removerOllama } from "./agente/ollama-guia.js";
import { ligarInicio, onboardEvent, playIntro, prefersReducedMotion, restEl, restartTour, showAiChoice, showTourWelcome, syncRest } from "./inicio/inicio.js";
import { ligarEnvio, sendMessage, sendText } from "./conversa/envio.js";
import { conferirBackend, ligarBackendFalta } from "./conversa/backend-falta.js";
import { ligarGuiaSecoes, paintSupport, refreshStatusLine, refreshSupportState, renderStatusLineSegments, renderStatusLineTest, renderSupportParts, repaintSupport } from "./tutoriais/guia-secoes.js";
import { conferirFontes, montarGuideCtx } from "./tutoriais/fontes.js";
import { abrirLinkDoChat, ligarNavegadorGuia, refreshNavInst } from "./navegador/navegador-guia.js";
import { ligarLinkPublicoGuia, refreshLinkPublico } from "./agente/link-publico-guia.js";
import { ligarContasCliGuia, refreshContas, renderConta } from "./agente/contas-cli-guia.js";
import { guardaMsg, ligarGuardaGuia, refreshGuarda, setGuardaMsg } from "./whatsapp/guarda-guia.js";
import { ligarDigitandoGuia } from "./whatsapp/digitando-guia.js";
import { ligarEntradaRapidaGuia } from "./configuracoes/entrada-rapida-guia.js";
import { ligarObjetivoGuia, objectiveBusy, objectiveDo, objectiveDraft, objectiveMsg, objectiveState, refreshObjective, setObjectiveDraft, setObjectiveMsg, setObjectiveState } from "./agente/objetivo-guia.js";
import { ligarCatalogo, setTutNext, tutNext, tutoriaisPage } from "./tutoriais/catalogo.js";
import { aoMudarCrm, crmAfterAgentKey, crmLocalState, crmSituacao, crmState, instalarCrm, ligarCrmGuia, refreshCrm } from "./crm/crm-guia.js";
import { crmProprio, license, motorCrm, navLicenseAsked, refreshLicense, setPlanBadge } from "./licenca/licenca.js";
import { NAV_TUTORIAL, disposeNav, ligarNavegador, navAccess, navCurrent, navCurrentHost, navDonoView, navEstavaAberto, navExtensions, navFavsShown, navMarcarAberto, navPage, navPartition, navServicosCount, navTabs, navReavaliar, navZoomStep, openNavTab, origemNome, paintNav, paintNavCount, toggleFavsBar } from "./navegador/navegador.js";
import { cssVar, disposeTerminal, ligarTerminal, openTerminalTab, rethemeTerminals, runInTerminal, terminals, themeNow, xtermClass } from "./terminal/terminal.js";
import type { XTermCtor } from "./terminal/terminal.js";
import { askAgentAbout, cancelAutoSend, goToChatFromGuide, preencherChat } from "./conversa/ponte-chat.js";
import { activityPage, ligarAtividade } from "./conversa/atividade.js";
import { ligarRede, net, paintNet, setNet } from "./app/rede.js";
import { alternarDepuracao, faixaLigada, ligarFaixaDepuracao } from "./depuracao/faixa.js";
import { alternarInstagramavel, instagramavelLigado, ligarInstagramavel } from "./depuracao/instagramavel.js";
import { ligarCursorAgente } from "./depuracao/cursor-agente.js";
import { aceleracaoInput, atualizarOciosoInput, corretorInput, lastUpdate, ligarAtualizacao, notificacaoSomInput, notificacoesInput, paintUpdateState } from "./atualizacao/atualizacao.js";
import { abrirAtalhos, abrirBusca, buscaAberta, ligarAlvoWebview, ligarBusca, pararBusca, usarTeclaCmd, type AlvoWebview } from "./busca/busca.js";
import { dicaTeclas, ehDoShell, rotuloTeclas, temTeclaDoApp } from "./lib/teclas-core.js";
import { ligarConfiguracoes, maybeAskNotificationsOnce } from "./configuracoes/configuracoes.js";
import { aoMudarConta, contaAtual, ligarConta } from "./conta/conta.js";
import { ligarAvisoPlano } from "./lib/aviso-pagamento.js";
import { paintEspaco } from "./configuracoes/espaco.js";
import { tam as tamEspaco } from "./lib/espaco.js";
import type { CotaInfo } from "../shared/ipc";

/* ctx:inicio */
// Ponte para as páginas por domínio: cada uma usa o que é do renderer por ctx.<nome> (app/ctx.ts).
// Getters preguiçosos: valem a partir do momento em que o nome já existiria aqui.
const ctxImpl = {
  get abrirLinkDoChat() { return abrirLinkDoChat; },
  get account() { return account; }, set account(v) { account = v; syncModelos(); },
  get acervoPage() { return acervoPage; },
  get activate() { return activate; },
  get activatePage() { return activatePage; },
  get active() { return active; },
  get activeGuide() { return activeGuide; },
  get activeId() { return activeId; }, set activeId(v) { activeId = v; },
  get activityPage() { return activityPage; },
  get addNotice() { return addNotice; },
  get adminBotMirror() { return adminBotMirror; },
  get appBuild() { return appBuild; },
  get appendMessage() { return appendMessage; },
  get applyCustomTitle() { return applyCustomTitle; },
  get applySettings() { return applySettings; },
  get appVersion() { return appVersion; },
  get armConfirm() { return armConfirm; },
  get askAgentAbout() { return askAgentAbout; },
  get autoSend() { return autoSend; }, set autoSend(v) { autoSend = v; },
  get buildTab() { return buildTab; },
  get cacheDrop() { return cacheDrop; },
  get cacheRead() { return cacheRead; },
  get cacheWrite() { return cacheWrite; },
  get cancelBtn() { return cancelBtn; },
  get caps() { return caps; },
  get checkSessionThreshold() { return checkSessionThreshold; },
  get checkEspacoThreshold() { return checkEspacoThreshold; },
  get atualizarCota() { return atualizarCota; },
  get chooseReply() { return chooseReply; },
  get clAuth() { return clAuth; },
  get closePage() { return closePage; },
  get closePalette() { return closePalette; },
  get copyReference() { return copyReference; },
  get crmAfterAgentKey() { return crmAfterAgentKey; },
  get crmKeyFromAgent() { return crmKeyFromAgent; }, set crmKeyFromAgent(v) { crmKeyFromAgent = v; },
  get crmLocalState() { return crmLocalState; },
  get crmProprio() { return crmProprio; },
  get crmState() { return crmState; },
  get cssVar() { return cssVar; },
  get definePage() { return definePage; },
  get dialog() { return dialog; },
  get disconnectWhatsapp() { return disconnectWhatsapp; },
  get disposeNav() { return disposeNav; },
  get disposeTerminal() { return disposeTerminal; },
  get ehVazia() { return ehVazia; },
  get enterClaude() { return enterClaude; },
  get enterOllama() { return enterOllama; },
  get refreshOllamaLine() { return refreshOllamaLine; },
  get removerOllama() { return removerOllama; },
  get OLLAMA_TUTORIAL() { return OLLAMA_TUTORIAL; },
  get FALLBACK_TUTORIAL() { return FALLBACK_TUTORIAL; },
  get firstReplyOnHost() { return firstReplyOnHost; },
  get flushRender() { return flushRender; },
  get fmtPhone() { return fmtPhone; },
  get form() { return form; },
  get getListMode() { return getListMode; },
  get gmailPage() { return gmailPage; },
  get contaGooglePage() { return contaGooglePage; },
  get refreshGmailGuia() { return refreshGmailGuia; },
  get goToChatFromGuide() { return goToChatFromGuide; },
  get guardaMsg() { return guardaMsg; }, set guardaMsg(v) { setGuardaMsg(v); },
  get guideCtx() { return montarGuideCtx; },
  get hostLocalAddr() { return hostLocalAddr; },
  get hostStatus() { return hostStatus; },
  get ICON_CHECK() { return ICON_CHECK; },
  get ICON_COPY() { return ICON_COPY; },
  get iconButton() { return iconButton; },
  get index() { return index; },
  get inputEl() { return inputEl; },
  get license() { return license; },
  get loadGrupoAlvo() { return loadGrupoAlvo; },
  get loadGuideFlags() { return loadGuideFlags; },
  get logoutClaude() { return logoutClaude; },
  get resetTutorial() { return resetTutorial; },
  get maybeAskNotificationsOnce() { return maybeAskNotificationsOnce; },
  get maybeNotify() { return maybeNotify; },
  get motorCrm() { return motorCrm; },
  get NAV_TUTORIAL() { return NAV_TUTORIAL; },
  get navAccess() { return navAccess; },
  get navAgent() { return navAgent; }, set navAgent(v) { navAgent = v; },
  get navAskedPro() { return navAskedPro; }, set navAskedPro(v) { navAskedPro = v; },
  get navCurrent() { return navCurrent; },
  get navCurrentHost() { return navCurrentHost; },
  get navDonoView() { return navDonoView; },
  get navExtensions() { return navExtensions; },
  get navHostsIn() { return navHostsIn; },
  get navLicenseAsked() { return navLicenseAsked; },
  get navMarcarAberto() { return navMarcarAberto; },
  get navPage() { return navPage; },
  get navPartition() { return navPartition; },
  get navServicosCount() { return navServicosCount; },
  get navTabs() { return navTabs; },
  get newBtn() { return newBtn; },
  get newTab() { return newTab; },
  get objectiveBusy() { return objectiveBusy; },
  get objectiveDo() { return objectiveDo; },
  get objectiveDraft() { return objectiveDraft; }, set objectiveDraft(v) { setObjectiveDraft(v); },
  get objectiveMsg() { return objectiveMsg; }, set objectiveMsg(v) { setObjectiveMsg(v); },
  get objectiveState() { return objectiveState; }, set objectiveState(v) { setObjectiveState(v); },
  get offerClaudeLogin() { return offerClaudeLogin; },
  get offerSkillFromTurn() { return offerSkillFromTurn; },
  get onboardEvent() { return onboardEvent; },
  get openFromIndex() { return openFromIndex; },
  get openGuide() { return openGuide; },
  get visibleNow() { return visibleNow; },
  get openNavTab() { return openNavTab; },
  get openPage() { return openPage; },
  get openPalette() { return openPalette; },
  get openTerminalTab() { return openTerminalTab; },
  get openWaBranch() { return openWaBranch; },
  get openWaChat() { return openWaChat; },
  get openWhatsapp() { return openWhatsapp; },
  get origemNome() { return origemNome; },
  get pageActive() { return pageActive; },
  get pagePrev() { return pagePrev; },
  get pages() { return pages; },
  get pageShown() { return pageShown; },
  get paintAcervoCount() { return paintAcervoCount; },
  get paintContext() { return paintContext; },
  get paintModulosLine() { return paintModulosLine; },
  get paintEtiquetasPro() { return paintEtiquetasPro; },
  get paintGuide() { return paintGuide; },
  get paintGuideTargets() { return paintGuideTargets; },
  get paintListMode() { return paintListMode; },
  get paintNav() { return paintNav; },
  get paintProviderLabel() { return paintProviderLabel; },
  get paintStatus() { return paintStatus; },
  get paintSupport() { return paintSupport; },
  get paintUpdateState() { return paintUpdateState; },
  get paintWaChatTab() { return paintWaChatTab; },
  get pairWhatsapp() { return pairWhatsapp; },
  get paletteBtn() { return paletteBtn; },
  get paletteEl() { return paletteEl; },
  get panelsEl() { return panelsEl; },
  get patchIndex() { return patchIndex; },
  get perguntar() { return perguntar; },
  get prefersReducedMotion() { return prefersReducedMotion; },
  get refreshClaudeLine() { return refreshClaudeLine; },
  get refreshContas() { return refreshContas; },
  get refreshLinkPublico() { return refreshLinkPublico; },
  get refreshContasClaude() { return refreshContasClaude; },
  get refreshCrm() { return refreshCrm; },
  get refreshGuarda() { return refreshGuarda; },
  get refreshLicense() { return refreshLicense; },
  get refreshNavInst() { return refreshNavInst; },
  get refreshStatusLine() { return refreshStatusLine; },
  get refreshSupportState() { return refreshSupportState; },
  get refreshWaGroups() { return refreshWaGroups; },
  get refreshWhatsapp() { return refreshWhatsapp; },
  get relayoutSplit() { return relayoutSplit; },
  get renderAssistant() { return renderAssistant; },
  get renderAudioControls() { return renderAudioControls; },
  get renderChannelEditor() { return renderChannelEditor; },
  get renderConta() { return renderConta; },
  get renderContasClaude() { return renderContasClaude; },
  get contasClaudeView() { return contasClaudeView; },
  get renderReplyCards() { return renderReplyCards; },
  get renderSidebar() { return renderSidebar; },
  get renderStatusLineSegments() { return renderStatusLineSegments; },
  get renderStatusLineTest() { return renderStatusLineTest; },
  get renderSupportParts() { return renderSupportParts; },
  get renderWaChat() { return renderWaChat; },
  get repaintSupport() { return repaintSupport; },
  get replyChoiceNow() { return replyChoiceNow; },
  get reportProgress() { return reportProgress; },
  get requestAgentPrepare() { return requestAgentPrepare; },
  get restEl() { return restEl; },
  get runInTerminal() { return runInTerminal; },
  get saveGuideFlag() { return saveGuideFlag; },
  get scheduleRender() { return scheduleRender; },
  get scrollToBottom() { return scrollToBottom; },
  get sendBtn() { return sendBtn; },
  get sendMessage() { return sendMessage; },
  get sendPhase() { return sendPhase; },
  get sendText() { return sendText; },
  get setBusy() { return setBusy; },
  get setListMode() { return setListMode; },
  get setSendPhase() { return setSendPhase; },
  get setTabModel() { return setTabModel; },
  get settings() { return settings; },
  get settingsBtn() { return settingsBtn; },
  get settingsError() { return settingsError; },
  get settingsGroups() { return settingsGroups; },
  get setTitle() { return setTitle; },
  get setTopbarHidden() { return setTopbarHidden; },
  get showModeToast() { return showModeToast; },
  get showTextToast() { return showTextToast; },
  get sidebarArchived() { return sidebarArchived; },
  get sidebarBtn() { return sidebarBtn; },
  get sidebarEl() { return sidebarEl; },
  get sidebarList() { return sidebarList; },
  get sidebarSearch() { return sidebarSearch; },
  get splitOn() { return splitOn; },
  get splitOnAny() { return splitOnAny; },
  get splitPages() { return splitPages; },
  get startAssistantBubble() { return startAssistantBubble; },
  get statusLineSegs() { return statusLineSegs; }, set statusLineSegs(v) { statusLineSegs = v; },
  get supportState() { return supportState; }, set supportState(v) { supportState = v; },
  get svgIcon() { return svgIcon; },
  get syncComposer() { return syncComposer; },
  get syncRest() { return syncRest; },
  get tabs() { return tabs; },
  get tabsEl() { return tabsEl; },
  get themeNow() { return themeNow; },
  get toggleSidebar() { return toggleSidebar; },
  get toggleSplit() { return toggleSplit; },
  get TUT_GRUPOS() { return TUT_GRUPOS; },
  get tutNext() { return tutNext; }, set tutNext(v) { setTutNext(v); },
  get tutoriaisPage() { return tutoriaisPage; },
  get tutorialDone() { return tutorialDone; },
  get tutorialsReady() { return tutorialsReady; },
  get upsertIndex() { return upsertIndex; },
  get waAgentBtn() { return waAgentBtn; },
  get waBubble() { return waBubble; },
  get waChatPages() { return waChatPages; },
  get waChats() { return waChats; }, set waChats(v) { waChats = v; },
  get waChatTitle() { return waChatTitle; },
  get waConnected() { return waConnected; },
  get waDialog() { return waDialog; },
  get waGroupReplied() { return waGroupReplied; },
  get waGroups() { return waGroups; },
  get waGroupsAt() { return waGroupsAt; },
  get waGroupsInflight() { return waGroupsInflight; },
  get waGroupsSection() { return waGroupsSection; },
  get waGroupTitle() { return waGroupTitle; },
  get waMsgKey() { return waMsgKey; },
  get waPairBtn() { return waPairBtn; },
  get waPairing() { return waPairing; },
  get waPolicyBox() { return waPolicyBox; },
  get waPolicyCards() { return waPolicyCards; },
  get waPolicySaving() { return waPolicySaving; },
  get waProgress() { return waProgress; },
  get waProgressText() { return waProgressText; },
  get waQr() { return waQr; },
  get waSkeleton() { return waSkeleton; },
  get waStatus() { return waStatus; }, set waStatus(v) { waStatus = v; },
  get waSuccess() { return waSuccess; },
  get waTimer() { return waTimer; }, set waTimer(v) { waTimer = v; },
  get windowHost() { return windowHost; },
  get xtermClass() { return xtermClass; },
};
export type AppCtx = typeof ctxImpl;
Object.defineProperties(ctx, Object.getOwnPropertyDescriptors(ctxImpl));
/* ctx:fim */


const tabsEl = $<HTMLElement>("tabs");
const panelsEl = $<HTMLElement>("panels");
const inputEl = $<HTMLTextAreaElement>("input");
const sendBtn = $<HTMLButtonElement>("btn-send");
/** Contagem "Enviando em 3…" em andamento (startAutoSend); null fora dela. */
let autoSend: { timer: number; tab: Tab } | null = null;
/** Fase do botão Enviar por conversa: ausente = parado. "sending" até a resposta começar, "streaming" enquanto chega, "done" por 900 ms. */
const sendPhase = new Map<string, "sending" | "streaming" | "done">();
function setSendPhase(tab: Tab, phase: "sending" | "streaming" | "done" | null): void {
  if (phase === null) sendPhase.delete(tab.id); else sendPhase.set(tab.id, phase);
  if (tab.id === activeId) syncComposer();
}
const newBtn = $<HTMLButtonElement>("btn-new");
const settingsBtn = $<HTMLButtonElement>("btn-settings");
const keyPill = $<HTMLSpanElement>("key-pill");
const hostPill = $<HTMLSpanElement>("host-pill");
const statusPill = $<HTMLSpanElement>("status-pill");
const sidebarStatus = $<HTMLElement>("sidebar-status");
const modelSelect = $<HTMLSelectElement>("model-select");
const dialog = $<HTMLDialogElement>("settings-dialog");
const form = $<HTMLFormElement>("settings-form");
/** Máquina desta janela; vem do main em window:info e não muda. */
let windowHost = "";
/** meu-bot-admin: nome da pessoa desta janela (o mesmo da aba e do seletor); null no app da pessoa. */
let windowPersonName: string | null = null;
/** Janela do meu-bot-admin (suporte): espelho só leitura + ações de suporte. */
/** O que esta variante pode fazer (vem do main em window:info); até lá, o padrão do meu-bot normal. */
/** meu-bot-admin: espelho das conversas dela com o meu-bot (admin/bot-mirror.ts); null no meu-bot normal. */
let adminBotMirror: BotMirror | null = null;
/** Aba Usuários do admin, quando ele entra como root nesta máquina (null = não é admin ou não é root). */
let usuariosAdmin: { open: () => void } | null = null;
/** Versão deste app (de window:info) e quando esta sessão abriu: vão no progresso para o admin ver se ela está atualizada e ativa. */
let appVersion = "";
/** Build deste app (`WindowInfo.build`): o cache só devolve o que este mesmo build gravou. */
let appBuild = "";
let caps: Capabilities = { variant: "client", produto: "meu-bot", canal: "estavel", nome: "meu-bot", titulo: "meu-bot", chat: true, pair: true, login: true, manageWa: true, tunnel: true, install: true, supportClient: true, supportAdmin: false, navegador: true, planoExigido: "free", usuariosMac: false, inspector: false, modulos: null, extensao: null, addon: null, abreEm: null, addons: [], hostLocal: true, terminalLocal: true, atalhosMesa: true, agenteNavegador: true, controleRemoto: true, telaComputador: true, semaforoNaBarra: true, teclaCmd: true, hostWsl: false };
const lastHostEl = $<HTMLParagraphElement>("last-host");
const settingsError = $<HTMLParagraphElement>("settings-error");
const cancelBtn = $<HTMLButtonElement>("btn-cancel");
const ctxLine = $<HTMLElement>("ctx-line");
/** A janela terminou de abrir (abas restauradas e a fixada na frente): a status line pode aparecer. */
let aberturaPronta = false;
const sidebarEl = $<HTMLElement>("sidebar");
const sidebarBtn = $<HTMLButtonElement>("btn-sidebar");
const sidebarSearch = $<HTMLInputElement>("sidebar-search");
const sidebarArchived = $<HTMLInputElement>("sidebar-archived");
const sidebarList = $<HTMLElement>("sidebar-list");
const paletteBtn = $<HTMLButtonElement>("btn-palette");
const modeBtn = $<HTMLButtonElement>("mode-btn");
const modeIcon = $<HTMLSpanElement>("mode-icon");
const modeMenu = $<HTMLDivElement>("mode-menu");
const modeList = $<HTMLUListElement>("mode-list");
const topbarMini = $<HTMLElement>("topbar-mini");
const composerMini = $<HTMLElement>("composer-mini");
const miniText = $<HTMLSpanElement>("mini-text");
const topbarHost = $<HTMLSpanElement>("topbar-host");
const atalhosHost = $<HTMLSpanElement>("atalhos-host");
const topbarHideBtn = $<HTMLButtonElement>("btn-topbar-hide");
const topbarShowBtn = $<HTMLButtonElement>("btn-topbar-show");
const paletteEl = $<HTMLElement>("palette");
const paletteInput = $<HTMLInputElement>("palette-input");
const paletteList = $<HTMLUListElement>("palette-list");

export interface Tab {
  id: string;
  model: BackendModel;
  tabEl: HTMLElement;
  titleEl: HTMLElement;
  modelEl: HTMLElement;
  /** Sites que o agente visitou pelo Navegador neste turno (para sugerir uma skill no fim). */
  navSitesTurn: Set<string>;
  /** Máquina (host SSH) desta conversa; fixa desde a criação. */
  host: string;
  dotEl: HTMLElement;
  messagesEl: HTMLElement;
  /** Acompanhar o fim durante a resposta: só enquanto a pessoa estiver perto do fim. Rolou para cima para ler = fica onde está. */
  followBottom: boolean;
  currentAssistant: HTMLElement | null;
  /** Texto acumulado da resposta em andamento (renderizado com throttle). */
  pendingText: string;
  renderTimer: number | null;
  busy: boolean;
  draft: string;
  /** Já tem título automático pela primeira mensagem. */
  titled: boolean;
  /** Nome dado pelo usuário; não é trocado pelo título automático. */
  customTitle: boolean;
  context: ContextEvent | null;
  /** Último turno concluído (status line). */
  lastTurn: { ms: number; completion: number } | null;
}

const tabs = new Map<string, Tab>();
/** Todas as conversas conhecidas (abertas ou não), para a lista lateral e a paleta. */
const index = new Map<string, StoredConversationView>();
let activeId: string | null = null;
let tabCount = 0;
let draggingId: string | null = null;
let settings: SettingsView | null = null;


const active = (): Tab | null => (activeId === null ? null : (tabs.get(activeId) ?? null));
/** Rola até o fim. Sem `force`, só se a pessoa já estava acompanhando o fim (não puxa quem rolou para cima para ler). */
const scrollToBottom = (tab: Tab, force = true): void => {
  if (!force && !tab.followBottom) return;
  tab.followBottom = true;
  tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight;
};
const NEAR_BOTTOM_PX = 48;
const nearBottom = (elm: HTMLElement): boolean => elm.scrollHeight - elm.scrollTop - elm.clientHeight <= NEAR_BOTTOM_PX;

function addNotice(tab: Tab, text: string, kind: "info" | "error" | "warn" = "info"): void {
  const cls = kind === "error" ? "notice notice-error" : kind === "warn" ? "notice notice-warn" : "notice";
  tab.messagesEl.appendChild(el("div", cls, text));
  scrollToBottom(tab, false);
}

/** Resposta do assistente: Markdown sanitizado. Mensagens do usuário continuam texto puro. */
function renderAssistant(target: HTMLElement, text: string): void {
  let body = target.querySelector<HTMLElement>(":scope > .md-body");
  if (body === null) { body = el("div", "md-body"); target.prepend(body); }
  // Bolha à espera da primeira palavra: três pontinhos (como o "digitando…" do WhatsApp), não uma bolha vazia.
  if (text === "" && target.classList.contains("typing")) { body.replaceChildren(el("span", "typing-dot"), el("span", "typing-dot"), el("span", "typing-dot")); return; }
  target.classList.remove("typing");
  body.replaceChildren(renderMarkdown(text));
}

/** Bolha do assistente recém-aberta, antes de qualquer texto: nasce "digitando". */
function startAssistantBubble(tab: Tab, conversationId: string): HTMLElement {
  const node = appendMessage(tab, "assistant", "", index.get(conversationId)?.messages.length ?? 0);
  node.classList.add("typing");
  node.setAttribute("aria-label", "o assistente está respondendo");
  renderAssistant(node, "");
  return node;
}

function flushRender(tab: Tab): void {
  tab.renderTimer = null;
  if (tab.currentAssistant !== null) renderAssistant(tab.currentAssistant, tab.pendingText);
  scrollToBottom(tab, false);
}

function scheduleRender(tab: Tab): void {
  if (tab.renderTimer !== null) return;
  tab.renderTimer = window.setTimeout(() => flushRender(tab), 80);
}

function syncComposer(): void {
  const tab = active();
  const busy = tab?.busy ?? true;
  inputEl.disabled = busy;
  // O exemplo fala da máquina desta janela ("neste Mac" ou "na máquina"); "na VM" era mentira na janela local.
  inputEl.placeholder = placeholderDaCaixa(windowHost, nesteComputador());
  // Enviar (shot "cred-button-loading-to-tick"): clique → ponto pulsando até a resposta começar; aí Parar; ao terminar, ✓.
  const phase = tab === null ? "idle" : (sendPhase.get(tab.id) ?? (busy ? "streaming" : "idle"));
  sendBtn.disabled = tab === null;
  if (autoSend !== null && phase === "idle") return; // contagem "Enviando em 3…" no botão; sai com cancelAutoSend
  sendBtn.textContent = phase === "streaming" ? "Parar" : "Enviar";
  sendBtn.classList.toggle("btn-bad", phase === "streaming");
  sendBtn.classList.toggle("is-sending", phase === "sending");
  sendBtn.classList.toggle("is-done", phase === "done");
  sendBtn.classList.toggle("shine", tab !== null && phase === "idle" && inputEl.value.trim().length >= 2);
  modelSelect.disabled = tab === null;
  syncModelos();
  keyPill.textContent = tab === null ? "backend" : `backend · ${tab.model}`;
  hostPill.textContent = `máquina: ${hostLabel(windowHost)}`;
  paintStatus(windowHost);
  paintContext(tab);
  if (!busy) inputEl.focus();
}

function describeContext(c: ContextEvent): string {
  const base = c.mode === "full" ? `contexto: ${c.total} msgs inteiras`
    : c.mode === "summary" ? `contexto: resumo + ${c.sent} de ${c.total} msgs`
    : `contexto: ${c.sent} de ${c.total} msgs (sem resumo ainda)`;
  return c.summarizing ? `${base} · resumindo…` : base;
}

/** Conta e limites do Claude nesta máquina (GET /v1/meu-bot/status); null = backend sem o endpoint. */
let account: AccountStatus | null = null;
/** Último limiar de sessão já avisado nesta janela (80, 90 ou 95); zera quando a sessão renova. */
let warnedThreshold = 0;

/** Status line no rodapé da conversa, no modelo do statusline.sh da box: modelo | Ctx | conta | Sessão | Semanal. */
function paintContext(tab: Tab | null): void {
  // Zoom da janela fora de 100%: um segmento no fim (clique volta ao tamanho real), como a entrada de status do Cursor.
  const zoomSeg = (): HTMLElement => {
    const span = el("span", "seg seg-zoom", `Zoom ${Math.round(Math.pow(1.2, zoomLevel) * 100)}%`);
    span.title = "Zoom da janela (Cmd+= / Cmd+-). Clique para voltar a 100%.";
    span.addEventListener("click", () => zoomWindow({ action: "reset" }));
    return span;
  };
  // Só com uma conversa na frente, e só depois da abertura: antes disso a conversa restaurada acendia a linha e a aba
  // fixada (Tutoriais) a apagava logo em seguida.
  if (!aberturaPronta) tab = null;
  if (tab === null) {
    if (zoomLevel === 0) { ctxLine.hidden = true; return; }
    ctxLine.hidden = false; ctxLine.replaceChildren(zoomSeg()); ctxLine.title = ""; return;
  }
  const ctx = tab.context !== null && tab.context.tokens !== undefined && tab.context.budget !== undefined ? { tokens: tab.context.tokens, budget: tab.context.budget } : null;
  const segs = buildSegments({ model: tab.model, ctx, turn: tab.lastTurn, account, segments: statusLineSegs ?? account?.segments ?? null });
  ctxLine.hidden = false;
  const nodes = segs.flatMap((s, i) => {
    const span = el("span", `seg seg-${s.kind}${s.tone !== undefined ? ` seg-${s.tone}` : ""}`, s.text);
    if (s.title !== undefined) span.title = s.title;
    return i === 0 ? [span] : [el("span", "seg-sep", "|"), span];
  });
  if (zoomLevel !== 0) nodes.push(...(nodes.length > 0 ? [el("span", "seg-sep", "|")] : []), zoomSeg());
  ctxLine.replaceChildren(...nodes);
  if (tab.context !== null && tab.context.total > 0) ctxLine.title = describeContext(tab.context);
}

/** Mesma regra do alerta do Hermes no WhatsApp: avisa ao cruzar 80, 90 e 95% da sessão de 5 h. */
function checkSessionThreshold(): void {
  const pct = account?.sessionPct ?? null;
  if (pct !== null && pct < 80) warnedThreshold = 0;
  const t = thresholdToWarn(pct, warnedThreshold);
  if (t === null || account === null) return;
  warnedThreshold = t;
  const tab = active();
  if (tab === null) return;
  const renew = account.sessionResets !== null ? ` Renova em ${timeUntil(account.sessionResets)}.` : "";
  addNotice(tab, `⚠ Sessão do Claude em ${Math.round(pct ?? 0)}% do limite de 5 h.${renew}`, "warn");
}

/** Último limiar do espaço (cota de disco) já avisado nesta janela (80 ou 95); zera quando baixa de 75. */
let warnedEspaco = 0;
/** Mesma regra do aviso do backend no WhatsApp: avisa na conversa ao cruzar 80 e 95% do espaço da conta na máquina. */
function checkEspacoThreshold(): void {
  const c = account?.cota ?? null;
  const pct = c?.pct ?? null;
  if (pct !== null && pct < 75) warnedEspaco = 0;
  const t = thresholdToWarn(pct, warnedEspaco, ESPACO_THRESHOLDS);
  if (t === null || c === null) return;
  warnedEspaco = t;
  const tab = active();
  if (tab === null) return;
  addNotice(tab, `⚠ Espaço da sua conta na máquina em ${c.pct}% (${tamEspaco(c.usadoKb)} de ${tamEspaco(c.limiteKb)}). Em Configurações › Espaço dá para liberar ou aumentar.`, "warn");
}
/** A cota relida (depois de "Liberar espaço"): rodapé, aviso e o bloco Espaço acompanham. */
function atualizarCota(c: CotaInfo | null): void {
  if (account !== null) account = { ...account, cota: c };
  paintContext(active()); checkEspacoThreshold(); paintEspaco(c);
}

function setBusy(tab: Tab, value: boolean): void {
  tab.busy = value;
  tab.tabEl.classList.toggle("busy", value);
  if (tab.id === activeId) syncComposer();
}

function activate(id: string): void {
  deactivatePage();
  const prev = active();
  if (prev !== null) prev.draft = inputEl.value;
  for (const t of tabs.values()) {
    const on = t.id === id;
    t.tabEl.classList.toggle("active", on);
    t.messagesEl.hidden = !on;
    if (on) t.dotEl.hidden = true;
  }
  activeId = id;
  const tab = tabs.get(id);
  inputEl.value = tab?.draft ?? "";
  if (tab !== undefined) scrollToBottom(tab);
  relayoutSplit();
  syncComposer();
  renderSidebar();
  syncRest();
}

const shorten = (text: string): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 28 ? `${clean.slice(0, 28)}…` : clean;
};

/** Título automático: só quando o usuário não deu um nome. */
function setTitle(tab: Tab, text: string): void {
  if (tab.customTitle) return;
  tab.titleEl.textContent = shorten(text);
  tab.titleEl.title = text.replace(/\s+/g, " ").trim();
  tab.titled = true;
}

function applyCustomTitle(tab: Tab, title: string): void {
  tab.customTitle = true;
  tab.titled = true;
  tab.titleEl.textContent = shorten(title);
  tab.titleEl.title = title;
}

/** Dois cliques no título: campo de edição no lugar. Enter confirma, Esc cancela, vazio volta ao automático. */
function startRename(tab: Tab): void {
  if (tab.tabEl.querySelector("input") !== null) return;
  const input = el("input", "tab-rename");
  input.type = "text";
  input.value = tab.titleEl.title || tab.titleEl.textContent || "";
  input.maxLength = 60;
  tab.titleEl.replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = (commit: boolean): void => {
    if (finished) return;
    finished = true;
    input.replaceWith(tab.titleEl);
    if (!commit) return;
    const value = input.value.replace(/\s+/g, " ").trim();
    if (value === "") {
      tab.customTitle = false;
      tab.titled = false;
      const firstUser = tab.messagesEl.querySelector(".msg-user");
      if (firstUser !== null) setTitle(tab, firstUser.textContent ?? "");
      else tab.titleEl.textContent = "Nova conversa";
    } else {
      applyCustomTitle(tab, value);
    }
    void window.meuBot.renameConversation(tab.id, value);
    const v = index.get(tab.id);
    if (v !== undefined) patchIndex(tab.id, { title: value === "" ? undefined : value, updatedAt: v.updatedAt });
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
    if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    ev.stopPropagation();
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (ev) => ev.stopPropagation());
}

/** Ordem atual das abas no DOM, salva no processo principal. */
function persistOrder(): void {
  const ids = [...tabsEl.querySelectorAll<HTMLElement>(".tab")]
    .map((node) => [...tabs.values()].find((t) => t.tabEl === node)?.id)
    .filter((id): id is string => id !== undefined);
  void window.meuBot.reorderConversations(ids);
}

function setTabModel(tab: Tab, model: BackendModel): void {
  tab.model = model;
  refreshTabBadges();
  if (tab.id === activeId) syncComposer();
}

/** Badge da aba: o modelo; a máquina é a da janela inteira. */
function refreshTabBadges(): void {
  for (const t of tabs.values()) {
    t.modelEl.textContent = t.model;
    t.tabEl.title = `Máquina: ${hostLabel(t.host)} · modelo: ${t.model}`;
  }
}

/** Modelos anunciados por cada host (preenchido pela sondagem das Configurações). */
const hostModels = new Map<string, string[]>();
/**
 * As opções do <select> que não estão no index.html: um provedor que o backend desta máquina informa (do providers.json
 * ou de um módulo) vira modelo escolhível, com o rótulo dele. As fixas (perfis do Claude, modo grátis) ficam como estão.
 */
function syncProviderOptions(select: HTMLSelectElement, host: string | null): void {
  const fixas = new Set([...select.options].filter((o) => o.dataset["provedor"] === undefined).map((o) => o.value));
  const modelos = modelosDaMaquina({ provedores: account?.providers ?? null, anunciados: host === null ? [] : hostModels.get(host) ?? [], atual: active()?.model ?? null }).filter((m) => !fixas.has(m.nome));
  for (const o of [...select.options]) if (o.dataset["provedor"] !== undefined && !modelos.some((m) => m.nome === o.value)) o.remove();
  const depois = [...select.options].find((o) => o.value === "ollama-local") ?? null;
  for (const m of modelos) {
    let o = [...select.options].find((x) => x.value === m.nome);
    if (o === undefined) { o = document.createElement("option"); o.value = m.nome; o.dataset["provedor"] = "1"; select.insertBefore(o, depois); }
    o.disabled = !m.disponivel;
    o.textContent = `${m.rotulo !== m.nome ? `${m.rotulo} · ${m.nome}` : m.nome}${m.disponivel ? "" : " · não existe nesta máquina"}`;
  }
}
/** A lista de modelos e o botão de modo acompanham a conversa ativa e a conta (os provedores chegam com o /status), sem mexer no foco. */
function syncModelos(): void {
  const tab = active();
  applyModelAvailability(modelSelect, tab === null ? null : tab.host);
  if (tab !== null) modelSelect.value = tab.model;
  paintModeButton();
}
/** Desabilita no <select> os modelos que o host não oferece; host nunca sondado deixa tudo liberado. */
function applyModelAvailability(select: HTMLSelectElement, host: string | null): void {
  syncProviderOptions(select, host);
  const avail = host === null ? undefined : hostModels.get(host);
  for (const opt of select.options) {
    if (opt.dataset["provedor"] !== undefined) continue; // quem diz se responde é o /status, não a sondagem da abertura
    // O ollama-local segue o estado do Ollama, não a sondagem (que é anterior à instalação dele).
    if (opt.value === "ollama-local") {
      const o = ollamaNoMenu(active()?.model === "ollama-local");
      opt.hidden = !o.mostrar; opt.disabled = !o.disponivel;
      opt.textContent = `${o.texto}${o.disponivel ? "" : " · não existe nesta máquina"}`;
      continue;
    }
    const off = avail !== undefined && avail.length > 0 && !avail.includes(opt.value);
    opt.disabled = off;
    opt.textContent = `${opt.textContent?.replace(/ · não existe nesta máquina$/, "") ?? opt.value}${off ? " · não existe nesta máquina" : ""}`;
  }
}

/** Último estado do túnel por host; o pill mostra o da conversa ativa. */
const hostStatus = new Map<string, BackendStatusEvent>();
function paintStatus(host: string | null): void {
  paintMini();
  // Sem internet, a pill diz isso e nada mais: o estado do túnel não explica o que a pessoa está vendo.
  if (net.online === false) { statusPill.hidden = false; statusPill.textContent = "sem internet"; statusPill.className = "pill pill-off"; sidebarStatus.hidden = false; return; }
  const st = host === null ? undefined : hostStatus.get(host);
  if (st === undefined) { statusPill.hidden = true; sidebarStatus.hidden = true; return; }
  statusPill.hidden = false;
  statusPill.textContent = st.state === "degraded" ? `túnel instável: ${st.detail}` : st.detail;
  statusPill.className = `pill ${st.state === "ready" ? "pill-on" : st.state === "error" ? "pill-off" : "pill-neutral"}`;
  // Verde não precisa aparecer: o bloco na base da lista só abre quando há algo a resolver.
  sidebarStatus.hidden = !(st.state === "error" || st.state === "degraded");
}

/** Tira a aba da tela; a conversa continua na lista lateral. */
function detachTab(id: string): void {
  const tab = tabs.get(id);
  if (tab === undefined) return;
  tabs.delete(id);
  refreshTabBadges();
  tab.tabEl.remove();
  tab.messagesEl.remove();
}

/** Depois de fechar/arquivar/excluir: ativa a aba vizinha. Sem nenhuma, a tela fica vazia (sem aba
 *  automática): Novo, Cmd+N ou a lista lateral abrem a próxima. */
function afterTabGone(id: string): void {
  if (activeId !== id) { renderSidebar(); return; }
  const last = [...tabs.keys()].at(-1);
  if (last !== undefined) { activate(last); return; }
  activeId = null;
  if (preencherEsquerda()) return;
  inputEl.value = "";
  syncComposer();
  renderSidebar();
  syncRest();
}

async function closeTab(id: string): Promise<void> {
  if (!tabs.has(id)) return;
  detachTab(id);
  const cur = index.get(id);
  if (cur !== undefined && cur.messages.length === 0) {
    index.delete(id);
    void window.meuBot.deleteConversation(id);
  } else {
    patchIndex(id, { openAsTab: false, updatedAt: cur?.updatedAt });
    void window.meuBot.closeConversation(id);
  }
  afterTabGone(id);
}

/** "Excluir" exclui direto, sem confirmar (27 out), como as conversas do WhatsApp e o espelho do admin. */
async function deleteConversation(id: string): Promise<void> {
  detachTab(id);
  index.delete(id);
  renderSidebar();
  void window.meuBot.deleteConversation(id);
  afterTabGone(id);
}

/**
 * Conversas que o admin excluiu na máquina: o main já as tirou do armazenamento; aqui saem da lista e das abas, sem
 * confirmar (a exclusão já foi decidida). Na abertura e ao voltar o foco, no máximo uma vez por minuto.
 */
let apagadasEm = 0;
function aplicarApagadas(): void {
  if (windowHost === "" || windowHost === "local" || Date.now() - apagadasEm < 60_000) return;
  apagadasEm = Date.now();
  void window.meuBot.syncApagadas().then((ids) => {
    for (const id of ids) { if (!index.has(id) && !tabs.has(id)) continue; detachTab(id); index.delete(id); afterTabGone(id); }
    if (ids.length > 0) renderSidebar();
  }).catch(() => { /* sem máquina agora: tenta no próximo foco */ });
}

async function archive(id: string, archived: boolean): Promise<void> {
  const cur = index.get(id);
  if (archived) detachTab(id);
  patchIndex(id, { archived, openAsTab: archived ? false : (cur?.openAsTab ?? false), updatedAt: cur?.updatedAt });
  await window.meuBot.archiveConversation(id, archived);
  if (archived) afterTabGone(id);
}

/** Abre (ou foca) a aba de uma conversa da lista. */
async function openFromIndex(id: string): Promise<void> {
  if (tabs.has(id)) { activate(id); return; }
  const view = await window.meuBot.openConversation(id);
  if (view === null) return;
  upsertIndex(view);
  buildTab(view.id, view.model, view.host, view);
  activate(view.id);
}

async function duplicate(id: string): Promise<void> {
  const view = await window.meuBot.duplicateConversation(id);
  if (view === null) return;
  upsertIndex(view);
  const tab = buildTab(view.id, view.model, view.host, view);
  const origin = tabs.get(id)?.tabEl;
  if (origin !== undefined) origin.after(tab.tabEl);
  persistOrder();
  activate(view.id);
}

async function branchFrom(id: string, messageIndex: number): Promise<void> {
  const view = await window.meuBot.branchConversation(id, messageIndex);
  if (view === null) { const t = tabs.get(id); if (t !== undefined) addNotice(t, "Não dá pra ramificar agora (resposta em andamento?).", "warn"); return; }
  upsertIndex(view);
  buildTab(view.id, view.model, view.host, view);
  activate(view.id);
}

async function exportConversation(id: string, format: ExportFormat): Promise<void> {
  const result = await window.meuBot.exportConversation(id, format);
  const tab = active();
  if (tab !== null) addNotice(tab, result === null ? "Exportação cancelada." : `Exportado em ${result.path}`);
}

async function showTabMenu(tab: Tab): Promise<void> {
  const cur = index.get(tab.id);
  const action: TabMenuAction | null = await window.meuBot.showTabMenu(tab.id, { busy: tab.busy, archived: cur?.archived ?? false });
  await runTabAction(tab.id, action);
}

/** Linha discreta no topo da lateral por 1,5 s ("✓ ID copiado"). */
function sidebarNotice(text: string): void {
  const n = el("div", "sidebar-empty sidebar-notice", text);
  sidebarList.prepend(n);
  window.setTimeout(() => n.remove(), 1500);
}
/** Copia e avisa; em erro de clipboard, avisa também (sem caixa). */
function copyReference(text: string): void {
  void navigator.clipboard.writeText(text).then(() => {
    sidebarNotice("✓ ID copiado");
    // O ⓘ do item: na primeira cópia neste Mac, o balão explica o que o ID é; depois, só copia.
    let seen = false; try { seen = localStorage.getItem("idInfoSeen") === "1"; } catch { /* opcional */ }
    if (!seen) { infoBalloon(ID_INFO_TITLE, ID_INFO_TEXT); try { localStorage.setItem("idInfoSeen", "1"); } catch { /* opcional */ } }
  }, () => sidebarNotice("✗ Não deu para copiar"));
}

async function runTabAction(id: string, action: TabMenuAction | null): Promise<void> {
  const tab = tabs.get(id);
  switch (action) {
    case "rename": if (tab !== undefined) startRename(tab); else { const v = index.get(id); if (v !== undefined) { void perguntar("Novo nome:", titleOf(v)).then((name) => { if (name !== null) { patchIndex(id, { title: name.trim() || undefined, updatedAt: v.updatedAt }); void window.meuBot.renameConversation(id, name); } }); } } break;
    case "duplicate": await duplicate(id); break;
    case "export-md": await exportConversation(id, "md"); break;
    case "export-json": await exportConversation(id, "json"); break;
    case "copy-ref": {
      // A sessão do Claude Code (o .jsonl) vem guardada ou do backend; sem ela, plano B com o id do app.
      let claude = null;
      try { claude = (await window.meuBot.conversationReference(id)).claude; } catch { /* plano B */ }
      copyReference(conversationReferenceText(id, hostLabel(windowHost), claude, index.get(id)?.model ?? ""));
      break;
    }
    case "archive": await archive(id, true); break;
    case "unarchive": await archive(id, false); break;
    case "close": await closeTab(id); break;
    case "delete": await deleteConversation(id); break;
    default: break;
  }
}

function maybeNotify(tab: Tab, body: string): void {
  if (settings?.notifications !== true) return;
  if (document.hasFocus() && tab.id === activeId) return;
  const cur = index.get(tab.id);
  void window.meuBot.notify(tab.id, cur !== undefined ? titleOf(cur) : "meu-bot", body.replace(/\s+/g, " ").trim().slice(0, 140));
}

/* ---------- Lista lateral ---------- */
let sidebarTimer: number | null = null;

function renderSidebar(): void {
  if (sidebarTimer !== null) return;
  sidebarTimer = window.setTimeout(() => { sidebarTimer = null; paintSidebar(); }, 30);
}

function paintSidebar(): void {
  const query = sidebarSearch.value;
  // Antes dos desvios abaixo: arquivar ou desarquivar muda se o interruptor deve existir.
  paintArquivadas();
  if (getListMode() === "whatsapp") { paintWaSidebar(query); return; }
  // meu-bot-admin: no modo "meu-bot" a lista são as conversas dela, lidas da máquina (não há conversas locais).
  if (adminBotMirror !== null) { adminBotMirror.paintList(sidebarList, query); return; }
  const showArchived = sidebarArchived.checked;
  const rows: (SidebarConversation & { view: StoredConversationView })[] = [...index.values()]
    .filter((c) => c.messages.length > 0 && (showArchived || !c.archived))
    .map((c) => ({ id: c.id, title: titleOf(c), updatedAt: c.updatedAt, archived: c.archived, text: c.messages.map((m) => m.content).join("\n"), view: c }))
    .filter((c) => matches(c, query));
  sidebarList.replaceChildren();
  if (rows.length === 0) { sidebarList.appendChild(el("div", "sidebar-empty", query ? "Nada encontrado." : "Nenhuma conversa ainda.")); return; }
  for (const group of groupByDate(rows)) {
    sidebarList.appendChild(el("div", "sidebar-group", group.label));
    for (const row of group.items) {
      const item = el("div", `sidebar-item${row.id === activeId ? " active" : ""}${row.archived ? " archived" : ""}`);
      item.dataset["id"] = row.id;
      item.appendChild(el("span", "si-title", row.title));
      if (tabs.has(row.id)) item.appendChild(el("span", "si-tab", "aba"));
      item.appendChild(el("span", "si-date", shortDate(row.updatedAt)));
      const menu = el("button", "si-menu", "…");
      menu.type = "button";
      menu.title = "Ações";
      menu.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void window.meuBot.showTabMenu(row.id, { busy: tabs.get(row.id)?.busy ?? false, archived: row.archived }).then((a) => runTabAction(row.id, a));
      });
      item.appendChild(menu);
      item.addEventListener("click", () => { void openFromIndex(row.id); });
      sidebarList.appendChild(item);
    }
  }
}

/**
 * Atalhos da lateral (Acervo, Conta Google, Finanças, Terminal, Navegador, Produtos, Tutoriais) num grupo
 * recolhível: eram sete linhas comendo a altura da lista de conversas. Recolhido por padrão; a escolha fica no
 * localStorage da janela, como a barra de cima. As linhas de conta ficam fora do grupo, porque o ponto verde
 * delas é sinal de estado e esconder isso por padrão esconderia problema.
 */
function setAtalhosAbertos(abertos: boolean, opts: { lembrar: boolean } = { lembrar: true }): void {
  const grupo = document.getElementById("atalhos");
  const bt = document.getElementById("atalhos-toggle");
  if (grupo === null || bt === null) return;
  grupo.hidden = !abertos;
  bt.setAttribute("aria-expanded", abertos ? "true" : "false");
  // `lembrar: false` quando quem fechou foi o Cmd+B: recolher tudo não deve apagar a escolha do grupo.
  if (opts.lembrar) { try { localStorage.setItem("atalhosAbertos", abertos ? "1" : "0"); } catch { /* opcional */ } }
  paintAtalhosAviso();
}
/**
 * Recolhido, pendencia la dentro vira um ponto no chevron, para a faixa fina nao virar ruido.
 *
 * So conta o que esta marcado com `data-pendencia` no HTML (Tutoriais, que sao "N para confirmar" e
 * "N para fazer"). Os outros contadores sao estado, nao pendencia: "33 skills" do Acervo, "2 abertos" do
 * Terminal, "1 aba" do Navegador. Somar todos dava 35 onde o certo era 2.
 */
function paintAtalhosAviso(): void {
  const grupo = document.getElementById("atalhos");
  const ponto = document.querySelector<HTMLElement>(".atalhos-dot");
  if (grupo === null || ponto === null) return;
  if (grupo.hidden === false) { ponto.hidden = true; return; }
  let pendente = false;
  for (const b of grupo.querySelectorAll<HTMLElement>("[data-pendencia]")) {
    const linha = b.closest<HTMLElement>(".acervo-line");
    if (linha !== null && linha.hidden !== false) continue; // atalho escondido por licenca nao conta
    if (/^\d+/.test((b.textContent ?? "").trim())) { pendente = true; break; }
  }
  ponto.hidden = !pendente;
}
/**
 * Um padrão só para toda a moldura: **Cmd+B** recolhe (ou mostra) de uma vez a barra de cima, os atalhos da
 * lateral, a lista de conversas e a barra de escrever. É o "modo limpo": sobra a conversa (ou a página). Cmd+Shift+B
 * faz o mesmo, por hábito antigo.
 *
 * Cada peça continua tendo o controle dela no clique, para quem quer granularidade: o ☰ para a lista, o botão
 * Atalhos para o grupo e a alça ⌄ para a barra de escrever.
 */
const interfaceRecolhida = (): boolean => document.body.classList.contains("topbar-hidden");
function setInterfaceRecolhida(recolhida: boolean): void {
  setTopbarHidden(recolhida);
  // Ao mostrar de volta, o grupo volta ao que a pessoa escolheu, não forçado aberto: a preferência dela manda.
  setAtalhosAbertos(recolhida ? false : atalhosLembrado(), { lembrar: recolhida ? false : true });
  toggleSidebar(!recolhida);
  setComposerHidden(recolhida);
}
/**
 * Barra de escrever recolhida: vira a faixa fina "⌃ Escrever" (como a topbar-mini). Volta pelo clique, pelo Cmd+B
 * ou simplesmente começando a digitar fora de um campo: a tecla já cai na caixa. A escolha fica no localStorage.
 */
const composerHidden = (): boolean => document.body.classList.contains("composer-hidden");
function setComposerHidden(hidden: boolean, opts: { focar?: boolean } = {}): void {
  document.body.classList.toggle("composer-hidden", hidden);
  composerMini.hidden = !hidden;
  try { localStorage.setItem("composerShown", hidden ? "0" : "1"); } catch { /* opcional */ }
  if (!hidden && opts.focar === true) inputEl.focus();
}
/** O que a pessoa escolheu para o grupo; padrão recolhido. */
function atalhosLembrado(): boolean {
  try { return localStorage.getItem("atalhosAbertos") === "1"; } catch { return false; }
}

function ligarAtalhos(): void {
  const bt = document.getElementById("atalhos-toggle");
  const grupo = document.getElementById("atalhos");
  if (bt === null || grupo === null) return;
  // `hidden` no DOM moderno é `boolean | string` (por causa de hidden="until-found"): normaliza antes de inverter.
  bt.addEventListener("click", () => { setAtalhosAbertos(Boolean(grupo.hidden)); });
  let abertos = false;
  try { abertos = localStorage.getItem("atalhosAbertos") === "1"; } catch { /* padrão: recolhido */ }
  setAtalhosAbertos(abertos);
  // Os números são escritos em vários lugares; observar o grupo evita ter que lembrar de avisar em cada um.
  new MutationObserver(() => { paintAtalhosAviso(); }).observe(grupo, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
}

/**
 * Grupo "Agente" da lateral: WhatsApp, Claude Code e Ollama (as linhas de estado). Com duas ou mais à mostra o grupo
 * vira uma linha de resumo ("2 de 3 prontos", verde com tudo pronto, âmbar no resto) e o clique abre as linhas com os
 * botões de cada uma; com uma só ela aparece direto, sem resumo; sem nenhuma o grupo some com o título. Recolhido por
 * padrão; a escolha fica no localStorage da janela, como a do grupo de atalhos. "Pronta" é a linha com a classe `on`,
 * que cada dono pinta (paintWhatsapp, paintClaudeLine, paintOllamaLine).
 */
const LINHAS_AGENTE = ["wa-line", "cl-line", "ollama-line"];
function agenteAberto(): boolean {
  try { return localStorage.getItem("agenteAberto") === "1"; } catch { return false; }
}
function pintarAgente(): void {
  const grupo = document.getElementById("agente-grupo");
  const resumo = document.getElementById("agente-resumo");
  const texto = document.getElementById("agente-resumo-texto");
  const linhas = document.getElementById("agente-linhas");
  if (grupo === null || resumo === null || texto === null || linhas === null) return;
  const r = resumoAgente(LINHAS_AGENTE.map((id) => { const l = document.getElementById(id); return { visivel: l !== null && !l.hidden, pronto: l?.classList.contains("on") === true }; }));
  const aberto = r.modo !== "resumo" || agenteAberto();
  grupo.hidden = r.modo === "grupo-vazio";
  resumo.hidden = r.modo !== "resumo";
  resumo.className = `wa-line agente-resumo ${r.tom === "ok" ? "on" : "warn"}`;
  resumo.setAttribute("aria-expanded", aberto ? "true" : "false");
  texto.textContent = r.texto;
  linhas.hidden = !aberto;
}
function ligarAgente(): void {
  document.getElementById("agente-resumo")?.addEventListener("click", () => {
    try { localStorage.setItem("agenteAberto", agenteAberto() ? "0" : "1"); } catch { /* opcional */ }
    pintarAgente();
  });
  // Cada linha é pintada pelo seu dono (hidden e classe on/off): observar as três, e só elas, evita avisar em cada
  // um. Não observa o contêiner: pintarAgente mexe no hidden dele e se chamaria de volta.
  const obs = new MutationObserver(() => { pintarAgente(); });
  for (const id of LINHAS_AGENTE) { const l = document.getElementById(id); if (l !== null) obs.observe(l, { attributes: true, attributeFilter: ["hidden", "class"] }); }
  pintarAgente();
}

/**
 * Caixa de pergunta com um campo, no lugar de window.prompt: o Electron não implementa prompt (devolve undefined
 * e o código seguia como se a pessoa tivesse cancelado). Resolve com o texto, ou null se cancelou.
 */
function perguntar(rotulo: string, valor = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog"); dlg.className = "perguntar";
    const form = document.createElement("form"); form.method = "dialog";
    const lab = document.createElement("label"); lab.textContent = rotulo;
    const inp = document.createElement("input"); inp.type = "text"; inp.value = valor; inp.maxLength = 200;
    const no = document.createElement("button"); no.type = "button"; no.className = "btn btn-ghost btn-small"; no.textContent = "Cancelar";
    const ok = document.createElement("button"); ok.type = "submit"; ok.className = "btn btn-primary btn-small"; ok.textContent = "OK";
    lab.append(inp); form.append(lab, no, ok); dlg.append(form); document.body.append(dlg);
    const fim = (v: string | null): void => { dlg.close(); dlg.remove(); resolve(v); };
    no.addEventListener("click", () => fim(null));
    dlg.addEventListener("cancel", (ev) => { ev.preventDefault(); fim(null); });
    form.addEventListener("submit", (ev) => { ev.preventDefault(); fim(inp.value); });
    dlg.showModal(); inp.focus(); inp.select();
  });
}

/** Barra recolhida por padrão; a escolha fica no localStorage da janela. */
function setTopbarHidden(hidden: boolean): void {
  document.body.classList.toggle("topbar-hidden", hidden);
  topbarMini.hidden = !hidden;
  try { localStorage.setItem("topbarShown", hidden ? "0" : "1"); } catch { /* opcional */ }
  paintMini();
}
/**
 * O nome da máquina (ou da pessoa, na janela de suporte): o mesmo que a barra recolhida mostra. Fica ao lado da seta
 * dos atalhos, na lateral; a barra de cima só o mostra quando a lista está escondida (style.css decide pelo `:has`).
 */
function paintTopbarHost(): void {
  const nome = windowHost === "" ? "" : windowPersonName ?? hostLabel(windowHost);
  topbarHost.textContent = nome;
  atalhosHost.textContent = nome;
}
function paintMini(): void {
  if (topbarMini.hidden) return;
  const st = hostStatus.get(windowHost);
  const tab = active();
  const off = net.online === false;
  miniText.textContent = `${windowPersonName ?? hostLabel(windowHost)}${tab !== null ? ` · ${tab.model}` : ""}${off ? " · sem internet" : st !== undefined ? ` · ${st.detail}` : ""}`;
}

/** Botão e menu "Modos do agente", espelhando o <select> escondido (que continua sendo a fonte do valor). */
function paintModeButton(): void {
  const cur = modelSelect.selectedOptions[0];
  const text = cur?.textContent?.replace(/ · não existe nesta máquina$/, "") ?? modelSelect.value;
  // O botão é só o mascote na cor do modo (o mesmo ícone e a mesma cor do toast de troca).
  const tpl = $<HTMLTemplateElement>("intro-mascot-tpl");
  const icon = (tpl.content.firstElementChild as SVGSVGElement).cloneNode(true) as SVGSVGElement;
  icon.removeAttribute("class");
  modeIcon.replaceChildren(icon);
  // A cor do modo vive no anel do botão; o mascote fica na cor do texto, para contrastar no escuro.
  modeBtn.style.setProperty("--hue", String(matizDoModelo(modelSelect.value)));
  modeBtn.title = `Modo do agente nesta conversa: ${text}`;
  modeBtn.setAttribute("aria-label", modeBtn.title); // o botão é só o mascote: sem isto o leitor de tela diz "botão"
  modeBtn.disabled = modelSelect.disabled;
}
function paintModeMenu(): void {
  modeList.replaceChildren();
  for (const opt of modelSelect.options) {
    if (opt.hidden) continue;
    const label = (opt.textContent ?? opt.value).replace(/ · não existe nesta máquina$/, "");
    const [name, ...rest] = label.split(" · ");
    const li = el("li", `mode-item${opt.disabled ? " off" : ""}${opt.value === modelSelect.value ? " current" : ""}`);
    li.setAttribute("role", "option");
    li.append(el("span", "tick", opt.value === modelSelect.value ? "✓" : ""), el("span", "name", name ?? opt.value), el("span", "desc", rest.join(" · ")));
    if (!opt.disabled) li.addEventListener("click", () => { modelSelect.value = opt.value; modelSelect.dispatchEvent(new Event("change")); modeMenu.hidden = true; paintModeButton(); });
    modeList.appendChild(li);
  }
}
modeBtn.addEventListener("click", (ev) => { ev.stopPropagation(); if (modeMenu.hidden) { paintModeMenu(); modeMenu.hidden = false; } else modeMenu.hidden = true; });
document.addEventListener("click", (ev) => { if (!modeMenu.hidden && !(ev.target as HTMLElement).closest(".mode-wrap")) modeMenu.hidden = true; });

const modeToast = $<HTMLElement>("mode-toast");
let modeToastTimer: ReturnType<typeof setTimeout> | null = null;
/** Toast de modo (shot "telegram-copy-link-toast"): sobe acima da caixa com mola, o mascote-ícone nasce girando na cor do modo e pisca, e sai descendo 2 s depois. */
function showModeToast(model: string): void {
  const opt = [...modelSelect.options].find((o) => o.value === model);
  const label = (opt?.textContent ?? model).replace(/ · não existe nesta máquina$/, "");
  const [name, ...rest] = label.split(" · ");
  const tpl = $<HTMLTemplateElement>("intro-mascot-tpl");
  const icon = (tpl.content.firstElementChild as SVGSVGElement).cloneNode(true) as SVGSVGElement;
  icon.removeAttribute("class"); icon.style.setProperty("--hue", String(matizDoModelo(model)));
  modeToast.querySelector(".mt-icon")?.replaceChildren(icon);
  const nameEl = modeToast.querySelector(".mt-name"); if (nameEl !== null) nameEl.textContent = `modo ${name ?? model}`;
  const descEl = modeToast.querySelector(".mt-desc"); if (descEl !== null) descEl.textContent = rest.join(" · ");
  if (modeToastTimer !== null) clearTimeout(modeToastTimer);
  modeToast.classList.remove("in"); modeToast.hidden = false; void modeToast.offsetWidth;
  modeToast.classList.add("in");
  modeToastTimer = setTimeout(() => { modeToast.classList.remove("in"); modeToastTimer = setTimeout(() => { modeToast.hidden = true; modeToastTimer = null; }, 240); }, 2000);
}
/** O mesmo toast com um texto qualquer (zoom da janela): mascote na cor neutra, nome e descrição. */
function showTextToast(name: string, desc: string): void {
  const tpl = $<HTMLTemplateElement>("intro-mascot-tpl");
  const icon = (tpl.content.firstElementChild as SVGSVGElement).cloneNode(true) as SVGSVGElement;
  icon.removeAttribute("class"); icon.style.setProperty("--hue", "200");
  modeToast.querySelector(".mt-icon")?.replaceChildren(icon);
  const nameEl = modeToast.querySelector(".mt-name"); if (nameEl !== null) nameEl.textContent = name;
  const descEl = modeToast.querySelector(".mt-desc"); if (descEl !== null) descEl.textContent = desc;
  if (modeToastTimer !== null) clearTimeout(modeToastTimer);
  modeToast.classList.remove("in"); modeToast.hidden = false; void modeToast.offsetWidth;
  modeToast.classList.add("in");
  modeToastTimer = setTimeout(() => { modeToast.classList.remove("in"); modeToastTimer = setTimeout(() => { modeToast.hidden = true; modeToastTimer = null; }, 240); }, 2000);
}

/* ---------- Zoom da janela (interface inteira; modelo do Cursor/VS Code) ----------
 * Nível -8..8 (fator 1.2^nível), um só para todas as janelas, guardado em settings.json pelo main. Cmd+= / Cmd+- /
 * Cmd+0 com o foco na página do Navegador (webview, barra de endereço, botões dela) continuam sendo o zoom do site;
 * em qualquer outro lugar são o zoom da janela. O menu Visualizar, a paleta e as Configurações são sempre da janela. */
let zoomLevel = 0;
/** O foco está na página do Navegador (webview ativa ou a barra dela)? Aí Cmd+=/-/0 são do site, não da janela. */
function navHasFocus(): boolean {
  if (navPage === null || navPage.panel.hidden) return false;
  const a = document.activeElement;
  if (a !== null && a !== document.body && navPage.panel.contains(a)) return true;
  // Nada focado (clique numa área da barra do Navegador que não recebe foco) com o Navegador na frente: ainda é dele.
  return (a === null || a === document.body) && pageActive === navPage;
}
/**
 * ⌘F não tem um dono só: com o terminal em foco ele busca no terminal (terminal.ts trata e nós saímos da frente);
 * com o Navegador em foco, busca dentro da página aberta; no resto, no conteúdo da janela.
 */
const termHasFocus = (): boolean => document.activeElement?.closest(".term-panel") != null;
const webviewDoNavegador = (): AlvoWebview => (navHasFocus() ? (navCurrent()?.wv as unknown as AlvoWebview) ?? null : null);

function zoomWindow(action: ZoomAction): void { void window.meuBot.zoomWindow(action).catch(() => { /* a janela fica como está */ }); }
/** Pinta o nível: variável CSS (a barra de título compensa os semáforos), rodapé, Configurações e, se mudou, o toast. */
function applyZoomState(st: ZoomState, announce: boolean): void {
  const changed = st.level !== zoomLevel;
  zoomLevel = st.level;
  document.documentElement.style.setProperty("--zoom-factor", String(st.factor));
  document.documentElement.dataset["zoom"] = String(st.level);
  paintContext(active());
  if (announce && changed) showTextToast(`Zoom ${st.percent}%`, st.level === 0 ? "tamanho real" : "Cmd+0 volta a 100%");
}
window.meuBot.on("window:zoom-changed", (st) => applyZoomState(st, true));

/* Janela estreita (em CSS px, então o zoom entra na conta): a lateral recolhe sozinha e volta quando cabe de novo, sem
 * mexer na preferência (localStorage). Cmd+B / ☰ nesse estado mostram a lateral por cima do conteúdo até o próximo
 * clique fora, como a barra lateral do Cursor em modo compacto. 760 ≈ 260 da lateral + 300 do mínimo da conversa + folga. */
const narrowMq = window.matchMedia("(max-width: 760px)");
let sidebarAutoHidden = false;
let sidebarPeek = false;
function applyNarrow(): void {
  const narrow = narrowMq.matches;
  document.body.classList.toggle("narrow", narrow);
  if (narrow) {
    if (!sidebarEl.hidden && !sidebarPeek) { sidebarEl.hidden = true; sidebarAutoHidden = true; }
  } else {
    if (sidebarPeek) { sidebarPeek = false; sidebarEl.classList.remove("peek"); }
    if (sidebarAutoHidden) { sidebarAutoHidden = false; sidebarEl.hidden = false; }
  }
}
narrowMq.addEventListener("change", applyNarrow);
document.addEventListener("pointerdown", (ev) => {
  if (!sidebarPeek) return;
  const t = ev.target as HTMLElement | null;
  if (t?.closest("#sidebar, #btn-sidebar") != null) return;
  toggleSidebar(false);
});
function toggleSidebar(force?: boolean): void {
  const hidden = force === undefined ? !sidebarEl.hidden : !force;
  sidebarEl.hidden = hidden;
  if (document.body.classList.contains("narrow")) {
    // Estreita: é só uma espiada por cima; a preferência fica como estava.
    sidebarPeek = !hidden;
    sidebarEl.classList.toggle("peek", !hidden);
    if (!hidden) onboardEvent("sidebar");
    return;
  }
  if (!hidden) {
    // Entra deslizando com um brilho curto: quem apertou Cmd+B olhando o teclado percebe que ela apareceu.
    sidebarEl.classList.remove("reveal");
    void sidebarEl.offsetWidth; // reinicia a animação
    sidebarEl.classList.add("reveal");
    window.setTimeout(() => sidebarEl.classList.remove("reveal"), 3700);
    onboardEvent("sidebar");
  }
  try { localStorage.setItem("sidebarShown", hidden ? "0" : "1"); } catch { /* opcional */ }
}

/* ---------- Paleta de comandos ---------- */
let paletteItems: PaletteItem[] = [];
let paletteSelected = 0;
const paletteActions = new Map<string, () => void | Promise<void>>();

function buildPaletteItems(): PaletteItem[] {
  paletteActions.clear();
  const items: PaletteItem[] = [];
  const add = (item: PaletteItem, run: () => void | Promise<void>): void => { items.push(item); paletteActions.set(item.id, run); };
  const cur = active();
  add({ id: "a:new", kind: "action", label: "Nova conversa", detail: "Cmd+N" }, async () => { await newTab(); });
  add({ id: "a:settings", kind: "action", label: "Configurações" }, () => settingsBtn.click());
  add({ id: "a:acervo", kind: "action", label: "Acervo: biblioteca de skills", detail: ACERVO_SKILLS.length === 0 ? "vazio por enquanto" : `${ACERVO_SKILLS.length} skills; instalar é pedir ao agente`, keywords: ["acervo", "skills", "biblioteca", "instalar"] }, () => openPage(acervoPage));
  if (gmailPage !== null) { const g = gmailPage; add({ id: "a:gmail", kind: "action", label: "E-mail", detail: `seus e-mails da Conta Google da máquina, dentro do meu-bot: ler, buscar e mandar para a lixeira${caps.planoExigido === "free" ? " (Pro)" : ""}`, keywords: ["e-mail", "email", "correio", "gmail", "caixa", "mensagens", "google"] }, () => g.open()); }
  add({ id: "a:atividade", kind: "action", label: "Atividade do agente", detail: "o que o modo agente roda nesta máquina, ao vivo", keywords: ["atividade", "agente", "ferramentas", "comandos", "log"] }, () => { openPage(activityPage(), true); });
  add({ id: "a:split-vazia", kind: "action", label: "Nova coluna vazia", detail: "a próxima página que você abrir entra nela", keywords: ["coluna", "dividir", "vazia", "split", "tela"] }, () => splitColunaVazia());
  add({ id: "a:split", kind: "action", label: splitLabel(splitPages.at(-1)?.title ?? null, (pageActive ?? [...pages.values()].filter((p) => p.tabEl !== null).at(-1))?.title ?? null), detail: "Cmd+\\ · conversa à esquerda, página à direita", keywords: ["dividir", "split", "lado a lado", "tela"] }, () => toggleSplit());
  if (navPage !== null && navAccess === "ok") add({ id: "a:favs", kind: "action", label: navFavsShown ? "Navegador: esconder a barra de favoritos" : "Navegador: mostrar a barra de favoritos", detail: "Cmd+Shift+F", keywords: ["favoritos", "barra", "bookmarks", "navegador"] }, () => toggleFavsBar());
  if (usuariosAdmin !== null) { const u = usuariosAdmin; add({ id: "a:usuarios", kind: "action", label: `Usuários de ${hostLabel(windowHost)}`, detail: "criar, limitar e apagar os usuários de login desta máquina", keywords: ["usuarios", "usuários", "contas", "box", "criar", "linux"] }, () => u.open()); }
  add({ id: "a:terminal", kind: "action", label: `Terminal em ${hostLabel(windowHost)}`, detail: "abre um shell nesta máquina (Cmd+J)", keywords: ["terminal", "shell", "ssh", "console"] }, () => { void openTerminalTab(); });
  if (caps.chat) add({ id: "a:navegador", kind: "action", label: `Navegador em ${hostLabel(windowHost)}`, detail: `quick view com extensões do Chrome; o agente pode navegar por você${caps.planoExigido === "free" ? " (Pro)" : ""}`, keywords: ["navegador", "browser", "site", "web", "extensão", "chrome", "pro"] }, () => { void openNavTab(); });
  for (const t of visibleNow()) if (t.comingSoon !== true) add({ id: `a:tut:${t.id}`, kind: "action", label: `Tutorial ${t.number}: ${t.title}`, detail: tutorialBadge(t, false), keywords: ["tutorial", String(t.number), t.short.toLowerCase(), ...t.title.toLowerCase().split(/\s+/)] }, () => { setTutNext(false); openGuide(t); });
  add({ id: "a:tutoriais", kind: "action", label: "Tutoriais: passo a passo do meu-bot", detail: ((c) => c.todo === 0 ? "tudo feito" : `${c.todo} para fazer`)(tutCounts()), keywords: ["tutorial", "tutoriais", "ajuda", "como"] }, () => openPage(tutoriaisPage));
  add({ id: "a:sidebar", kind: "action", label: "Mostrar ou ocultar lista de conversas", detail: "Cmd+B" }, () => toggleSidebar());
  add({ id: "a:topbar", kind: "action", label: "Recolher ou mostrar tudo (barra, atalhos, lista e barra de escrever)", detail: "Cmd+B" }, () => setInterfaceRecolhida(!interfaceRecolhida()));
  add({ id: "a:depuracao", kind: "action", label: faixaLigada() ? "Modo de depuração: desligar" : "Modo de depuração: ligar", detail: "faixa no topo com build, batimento do processo principal, túnel e o que chega de fora", keywords: ["debug", "depuração", "depuracao", "faixa", "log"] }, () => { void alternarDepuracao(); });
  add({ id: "a:instagramavel", kind: "action", label: instagramavelLigado() ? "Modo instagramável: desligar" : "Modo instagramável: ligar", detail: "com a depuração ligada, marca na página os elementos que o agente leu, com o número de cada um", keywords: ["instagram", "instagramável", "instagramavel", "cursores", "show", "video"] }, () => { void alternarInstagramavel(); });
  add({ id: "a:composer", kind: "action", label: "Mostrar ou ocultar barra de escrever", detail: "alça ⌄ na barra", keywords: ["escrever", "caixa", "composer", "barra de baixo", "recolher"] }, () => setComposerHidden(!composerHidden(), { focar: true }));
  add({ id: "a:zoom-in", kind: "action", label: "Aumentar zoom da janela", detail: "Cmd+= (fora da página do Navegador)", keywords: ["zoom", "ampliar", "maior", "aumentar", "fonte"] }, () => zoomWindow({ action: "step", delta: 1 }));
  add({ id: "a:zoom-out", kind: "action", label: "Diminuir zoom da janela", detail: "Cmd+-", keywords: ["zoom", "reduzir", "menor", "diminuir", "fonte"] }, () => zoomWindow({ action: "step", delta: -1 }));
  add({ id: "a:zoom-reset", kind: "action", label: "Restaurar zoom da janela (100%)", detail: "Cmd+0", keywords: ["zoom", "restaurar", "100", "tamanho real"] }, () => zoomWindow({ action: "reset" }));
  add({ id: "a:claude-login", kind: "action", label: "Entrar no Claude Code nesta máquina", detail: "tutorial 1: link no navegador + código", keywords: ["login", "claude", "deslogado", "entrar"] }, () => enterClaude());
  add({ id: "a:whatsapp", kind: "action", label: "WhatsApp: estado e pareamento por QR", detail: waStatus?.present ? (waStatus.connected ? `conectado · ${fmtPhone(waStatus.number)}` : "desconectado") : "só em máquinas com Hermes, OpenClaw ou PicoClaw", keywords: ["whatsapp", "qr", "parear", "hermes", "openclaw", "picoclaw"] }, async () => { await refreshWhatsapp(); if (waStatus?.present) openWhatsapp(); else { const tab = active(); if (tab !== null) addNotice(tab, "Esta máquina não tem agente com WhatsApp (Hermes, OpenClaw ou PicoClaw).", "warn"); } });
  add({ id: "a:tailscale-off", kind: "action", label: "Tailscale: desligar verificação do SSH", detail: "edita a política do tailnet: check → accept", keywords: ["tailscale", "ssh", "check", "verificação"] }, async () => {
    const r = await window.meuBot.disableTailscaleCheck();
    const tab = active();
    if (tab !== null) addNotice(tab, r.ok ? `✓ ${r.detail}` : `✗ ${r.detail}`, r.ok ? "info" : "error");
  });
  add({ id: "a:tailscale-restore", kind: "action", label: "Tailscale: restaurar política do último backup", detail: "desfaz a última edição", keywords: ["tailscale", "backup", "restaurar"] }, async () => {
    const r = await window.meuBot.restoreTailscalePolicy();
    const tab = active();
    if (tab !== null) addNotice(tab, r.ok ? `✓ ${r.detail}` : `✗ ${r.detail}`, r.ok ? "info" : "error");
  });
  add({ id: "a:onboard", kind: "action", label: "Tour do meu-bot (rever onboarding)", detail: "começa agora nesta janela", keywords: ["tour", "onboarding", "ajuda"] }, () => restartTour());
  add({ id: "a:quick", kind: "action", label: "Entrada rápida: mostrar", detail: settings?.quickEntryShortcut ?? "" }, () => window.meuBot.toggleQuickEntry());
  if (cur !== null) {
    add({ id: "a:rename", kind: "action", label: "Renomear conversa atual" }, () => startRename(cur));
    add({ id: "a:export-md", kind: "action", label: "Exportar conversa atual em Markdown" }, () => exportConversation(cur.id, "md"));
    add({ id: "a:export-json", kind: "action", label: "Exportar conversa atual em JSON" }, () => exportConversation(cur.id, "json"));
    add({ id: "a:archive", kind: "action", label: "Arquivar conversa atual" }, () => archive(cur.id, true));
    add({ id: "a:close", kind: "action", label: "Fechar aba atual", detail: "Cmd+W" }, () => closeTab(cur.id));
    // Os mesmos modelos do menu de modos: os fixos e os provedores que a máquina informa (um que ela não tem mais fica de fora).
    for (const opt of modelSelect.options) {
      if (opt.dataset["provedor"] !== undefined && opt.disabled) continue;
      const m = opt.value;
      add({ id: `a:model:${m}`, kind: "action", label: `Usar modelo ${rotuloDoModelo(m, account?.providers ?? null)} nesta conversa`, ...(rotuloDoModelo(m, account?.providers ?? null) !== m ? { keywords: [m] } : {}) }, () => { if (cur.model !== m && !prefersReducedMotion) showModeToast(m); setTabModel(cur, m); void window.meuBot.setConversationModel(cur.id, m); });
    }
  }
  for (const c of index.values()) {
    if (c.messages.length === 0) continue;
    add({
      id: `c:${c.id}`, kind: "conversation", label: titleOf(c),
      detail: `${c.model}${c.archived ? " · arquivada" : ""} · ${shortDate(c.updatedAt)}`,
      keywords: c.messages.filter((m) => m.role === "user").map((m) => m.content.slice(0, 500)),
      recency: new Date(c.updatedAt).getTime(),
    }, () => openFromIndex(c.id));
  }
  add({ id: "a:new-window", kind: "action", label: "Nova janela em outra máquina", detail: "Cmd+Shift+N", keywords: ["janela", "máquina", "host", "ssh", "trocar"] }, () => { void window.meuBot.openPicker(); });
  // Conexão saiu das Configurações (30 out): o modelo de cada conversa muda no seletor da caixa de texto e a porta é
  // ajustada pelo seletor de máquinas; a informação continua à mão pela paleta.
  if (settings !== null) {
    const info = `Modelo padrão ${settings.backendModelForHost} · porta ${settings.backendPortForHost}`;
    add({ id: "s:backend-info", kind: "setting", label: "Backend desta máquina", detail: info, keywords: ["modelo", "porta", "backend", "padrão", "conexão"] }, () => showTextToast(info, "O modelo de cada conversa muda no seletor da caixa de texto; a porta, no seletor de máquinas."));
  }
  return items;
}

/**
 * Marca o item selecionado sem reconstruir a lista. Reconstruir (replaceChildren) zera a rolagem: era o
 * "pulo para cima" ao mover o mouse sobre a lista rolada. `scroll` só no teclado; com o mouse o item já
 * está à vista.
 */
function selectPalette(i: number, scroll: boolean): void {
  const lis = paletteList.querySelectorAll<HTMLElement>("li[role=option]");
  if (lis.length === 0) { paletteSelected = 0; return; }
  paletteSelected = Math.max(0, Math.min(i, lis.length - 1));
  lis.forEach((li, k) => li.setAttribute("aria-selected", k === paletteSelected ? "true" : "false"));
  if (scroll) lis[paletteSelected]?.scrollIntoView({ block: "nearest" });
}

/** Reconstrói a lista (ao abrir e ao digitar). */
function paintPalette(): void {
  const ranked = rankPalette(paletteItems, paletteInput.value);
  paletteList.replaceChildren();
  if (ranked.length === 0) { paletteList.appendChild(el("li", "palette-empty", "Nada encontrado.")); return; }
  ranked.forEach((item, i) => {
    const li = el("li");
    li.setAttribute("role", "option");
    li.dataset["id"] = item.id;
    li.appendChild(el("span", "pk", item.kind === "action" ? "ação" : item.kind === "conversation" ? "conversa" : "config"));
    li.appendChild(el("span", "pl", item.label));
    if (item.detail !== undefined) li.appendChild(el("span", "pd", item.detail));
    li.addEventListener("click", () => { void runPalette(item.id); });
    li.addEventListener("mousemove", () => { if (paletteSelected !== i) selectPalette(i, false); });
    paletteList.appendChild(li);
  });
  selectPalette(paletteSelected, true);
}

async function runPalette(id: string): Promise<void> {
  const run = paletteActions.get(id);
  closePalette();
  if (run !== undefined) await run();
}

function openPalette(): void {
  paletteItems = buildPaletteItems();
  paletteSelected = 0;
  paletteInput.value = "";
  paletteEl.hidden = false;
  paintPalette();
  paletteInput.focus();
  onboardEvent("palette-open");
}

function closePalette(): void {
  paletteEl.hidden = true;
  if (!inputEl.disabled) inputEl.focus();
  onboardEvent("palette-close");
}

const titleOf = (c: StoredConversationView): string =>
  (c.title ?? c.messages.find((m) => m.role === "user")?.content ?? "Nova conversa").replace(/\s+/g, " ").trim().slice(0, 60) || "Nova conversa";

function addNote(tab: Tab, text: string): void {
  tab.messagesEl.appendChild(el("div", "branch-note", text));
}

/** Ícone SVG inline (traço, 16px) construído via DOM, compatível com a CSP sem img-src. */
function svgIcon(d: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "14"); svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path"); path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}

const ICON_COPY = "M9 11a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1";
const ICON_CHECK = "M20 6 9 17l-5-5";
const ICON_BRANCH = "M6 3v12M18 9a9 9 0 0 1-9 9M21 6a3 3 0 1 1-6 0a3 3 0 0 1 6 0M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0";

/** Botão só com ícone: tooltip e rótulo acessível carregam o texto. */
function iconButton(action: string, label: string, iconPath: string): HTMLButtonElement {
  const btn = el("button", "icon-btn");
  btn.type = "button"; btn.dataset["action"] = action;
  btn.title = label; btn.setAttribute("aria-label", label);
  btn.appendChild(svgIcon(iconPath));
  return btn;
}

/** Mensagem com índice no histórico e ações no hover (Copiar, Ramificar daqui). */
/** Rótulo "quem respondeu" no pé da bolha do assistente (o nome do provedor; ou "respondeu X (fallback de agente)", em aviso). */
function paintProviderLabel(node: HTMLElement, model: string, provider: string | undefined, fallback: string | undefined): void {
  node.querySelector(":scope > .msg-provider")?.remove();
  const text = providerLabel(model, provider, fallback);
  if (text === "") return;
  const tag = el("span", `msg-provider${provider !== undefined && provider !== model ? " fallback" : ""}`, text);
  if (fallback !== undefined) tag.title = fallback;
  node.appendChild(tag);
}
function appendMessage(tab: Tab, role: "user" | "assistant", content: string, indexInHistory: number, meta?: { provider?: string | undefined; fallback?: string | undefined }): HTMLElement {
  const node = el("div", role === "user" ? "msg msg-user" : "msg msg-assistant");
  node.dataset["index"] = String(indexInHistory);
  if (role === "user") node.textContent = content;
  else { renderAssistant(node, content); if (meta !== undefined) paintProviderLabel(node, tab.model, meta.provider, meta.fallback); }
  const actions = el("div", "msg-actions");
  const copy = iconButton("copy", "Copiar", ICON_COPY);
  const branch = iconButton("branch", "Ramificar daqui", ICON_BRANCH);
  actions.append(copy, branch);
  node.appendChild(actions);
  tab.messagesEl.appendChild(node);
  return node;
}

function upsertIndex(view: StoredConversationView): void {
  index.set(view.id, view);
  renderSidebar();
}

type IndexPatch = { [K in keyof StoredConversationView]?: StoredConversationView[K] | undefined };

/** Atualiza o índice local sem ir ao processo principal. `title: undefined` remove o nome. */
function patchIndex(id: string, patch: IndexPatch): void {
  const cur = index.get(id);
  if (cur === undefined) return;
  const next: StoredConversationView = { ...cur, updatedAt: patch.updatedAt ?? new Date().toISOString() };
  if (patch.messages !== undefined) next.messages = patch.messages;
  if (patch.archived !== undefined) next.archived = patch.archived;
  if (patch.openAsTab !== undefined) next.openAsTab = patch.openAsTab;
  if (patch.model !== undefined) next.model = patch.model;
  if ("title" in patch) { if (patch.title === undefined) delete next.title; else next.title = patch.title; }
  index.set(id, next);
  renderSidebar();
}

/** Cria a aba de uma conversa já existente (nova ou restaurada do disco). */
function buildTab(conversationId: string, model: BackendModel, host: string, restored?: StoredConversationView): Tab {
  tabCount += 1;
  const tabEl = el("div", "tab");
  const dotEl = el("span", "tab-dot");
  dotEl.hidden = true;
  const titleEl = el("span", "tab-title", `Conversa ${tabCount}`);
  const modelEl = el("span", "tab-model", model);
  const closeBtn = el("button", "tab-close", "×");
  closeBtn.type = "button";
  closeBtn.title = "Fechar aba";
  tabEl.append(dotEl, titleEl, modelEl, closeBtn);
  const messagesEl = el("div", "messages");
  messagesEl.setAttribute("aria-live", "polite");
  // Rolagem da pessoa decide se a resposta em andamento continua puxando para o fim.
  messagesEl.addEventListener("scroll", () => { tab.followBottom = nearBottom(messagesEl); }, { passive: true });
  const tab: Tab = {
    id: conversationId, model, host, tabEl, titleEl, modelEl, dotEl, messagesEl, followBottom: true, currentAssistant: null,
    pendingText: "", navSitesTurn: new Set(), renderTimer: null, busy: false, draft: "", titled: false, customTitle: false, context: null, lastTurn: null,
  };
  tabs.set(conversationId, tab);
  // Voltando do disco, na ordem salva; aberta agora, entra na frente (depois da fixada) e a ordem nova fica salva.
  if (restaurandoAbas) tabsEl.appendChild(tabEl); else { inserirAba(tabEl); persistOrder(); }
  refreshTabBadges();
  panelsEl.appendChild(messagesEl);
  tabEl.addEventListener("click", () => activate(conversationId));
  tabEl.addEventListener("dblclick", (ev) => { ev.preventDefault(); startRename(tab); });
  closeBtn.addEventListener("click", (ev) => { ev.stopPropagation(); void closeTab(conversationId); });
  tabEl.draggable = true;
  tabEl.addEventListener("dragstart", (ev) => {
    if (tabEl.querySelector("input") !== null) { ev.preventDefault(); return; }
    draggingId = conversationId;
    tabEl.classList.add("dragging");
    ev.dataTransfer?.setData("text/plain", conversationId);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
  });
  tabEl.addEventListener("dragend", () => {
    tabEl.classList.remove("dragging");
    draggingId = null;
    persistOrder();
  });
  tabEl.addEventListener("dragover", (ev) => {
    if (draggingId === null || draggingId === conversationId) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    const dragged = tabs.get(draggingId)?.tabEl;
    if (dragged === undefined) return;
    const rect = tabEl.getBoundingClientRect();
    const before = ev.clientX < rect.left + rect.width / 2;
    const next = before ? tabEl : tabEl.nextSibling;
    if (dragged !== next) tabsEl.insertBefore(dragged, next);
  });
  tabEl.addEventListener("drop", (ev) => ev.preventDefault());
  tabEl.addEventListener("contextmenu", (ev) => { ev.preventDefault(); void showTabMenu(tab); });
  if (restored?.fromWhatsapp !== undefined) {
    const w = restored.fromWhatsapp;
    if (w.messages !== undefined && w.messages.length > 0) renderWaQuote(tab, w, restored.pendingNote !== undefined);
    else {
      // Conversas trazidas antes de a aba guardar as mensagens: só a nota.
      const until = new Date(w.until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      addNote(tab, `Trazida do WhatsApp: ${w.name} · ${w.count} ${w.count === 1 ? "mensagem" : "mensagens"} até ${until}`);
    }
  }
  if (restored !== undefined && restored.messages.length > 0) {
    if (restored.branchedFrom !== undefined) {
      const origin = index.get(restored.branchedFrom.id);
      addNote(tab, `Ramificada de "${origin !== undefined ? titleOf(origin) : "outra conversa"}" (mensagem ${restored.branchedFrom.index + 1})`);
    }
    restored.messages.forEach((m, i) => appendMessage(tab, m.role, m.content, i, { provider: m.provider, fallback: m.fallback }));
    const first = restored.messages.find((m) => m.role === "user");
    if (first !== undefined) setTitle(tab, first.content);
  } else if (restored?.fromWhatsapp === undefined) {
    addNotice(tab, host === "local" ? "Nova conversa neste Mac. Suas mensagens vão pro backend local, que roda o Claude Code daqui por baixo." : `Nova conversa na máquina ${hostLabel(host)}. Suas mensagens vão pro backend dela, que roda o Claude Code por baixo.`);
  }
  if (restored?.title !== undefined && restored.title !== "") applyCustomTitle(tab, restored.title);
  return tab;
}

async function newTab(): Promise<Tab> {
  const { conversationId } = await window.meuBot.newConversation();
  const model = settings?.backendModelForHost ?? "agente";
  const host = windowHost;
  const now = new Date().toISOString();
  index.set(conversationId, { id: conversationId, model, host, messages: [], createdAt: now, updatedAt: now, order: index.size, archived: false, openAsTab: true });
  const tab = buildTab(conversationId, model, host);
  activate(conversationId);
  onboardEvent("new-tab");
  return tab;
}

/** Reabre as abas salvas; sem nenhuma, cria a primeira. */
/** true enquanto restoreTabs monta as abas salvas: aí elas vão em ordem, sem pular para a frente. */
let restaurandoAbas = false;
async function restoreTabs(): Promise<void> {
  const saved = await window.meuBot.listConversations();
  // Conversas vazias não voltam; são apagadas de vez.
  for (const c of saved) if (c.messages.length === 0) void window.meuBot.deleteConversation(c.id);
  for (const c of saved) if (c.messages.length > 0) index.set(c.id, c);
  const asTabs = saved.filter((c) => c.messages.length > 0 && c.openAsTab && !c.archived);
  // Onboarding pendente (primeira vez, ou interruptor "Onboarding" ligado no seletor): começa
  // sempre, com ou sem conversas; o passo "Novo" cria a conversa, então não se cria a automática.
  const pending = settings?.onboarding === "pending";
  // Convite; o tour só começa se a pessoa aceitar. No staging, antes dele vem "Você já tem assinatura de IA?".
  if (pending) { if (caps.canal === "staging") void showAiChoice(); else showTourWelcome(); }
  if (asTabs.length === 0) {
    if (!pending) await newTab();
    else syncRest();
    return;
  }
  restaurandoAbas = true;
  try { for (const c of asTabs) buildTab(c.id, c.model, c.host, c); } finally { restaurandoAbas = false; }
  const latest = [...asTabs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  activate(latest?.id ?? asTabs[asTabs.length - 1]!.id);
}

function applySettings(view: SettingsView): void {
  settings = view;
  setHostNicknames(view.hostNames);
  paintTopbarHost();
  rethemeTerminals();
  if (windowHost !== "" && caps.chat) document.title = `${caps.titulo} · ${hostLabel(windowHost)}`;
  if (tutorialsReady) paintTutCount(); // o tour concluído sai da contagem de ativos
  lastHostEl.textContent = view.lastHost === null ? "" : `Última máquina aberta pelo seletor: ${hostLabel(view.lastHost)}.`;
  atualizarOciosoInput.checked = view.atualizarOcioso;
  corretorInput.checked = view.corretorOrtografico;
  aceleracaoInput.checked = view.aceleracaoHardware;
  notificacoesInput.checked = view.notifications;
  notificacaoSomInput.checked = view.notificacaoSom;
  // Sem aviso não há som para escolher.
  notificacaoSomInput.disabled = !view.notifications;
  applyZoomState({ level: view.zoomLevel, factor: Math.pow(1.2, view.zoomLevel), percent: Math.round(Math.pow(1.2, view.zoomLevel) * 100) }, false);
  document.documentElement.dataset["theme"] = view.theme;
  pintarFixada();
  syncComposer();
}
ligarContasAgente();
ligarOllama();
ligarPaginas();

/** A Biblioteca do meu-bot (skills do Cloudflare) fica oculta até a pessoa pedir. */
let acervoBibliotecaAberta = false;
const acervoPage = definePage("acervo", "Acervo", $<HTMLElement>("acervo-panel"), () => {
  acervoList.replaceChildren();
  // Minhas skills (importadas pelo link) vêm primeiro; elas moram nas mesmas pastas, então saem das listas de baixo.
  if (caps.install) renderMinhasSkills(acervoList);
  const importadas = nomesImportados();
  const machine = (objectiveState?.skills ?? []).filter((sk) => sk.learned !== true && !importadas.has(sk.name));
  const learned = (objectiveState?.skills ?? []).filter((sk) => sk.learned === true && !importadas.has(sk.name));
  if (objectiveState?.available === true && learned.length > 0) {
    acervoList.append(el("div", "tut-group", `Skills aprendidas em ${hostLabel(windowHost)}`));
    acervoList.append(el("div", "acervo-empty", "O agente da conversa registra aqui o que aprendeu (ex.: como operar um site pelo Navegador) e consulta antes de repetir a tarefa. Para mudar uma, peça na conversa: \"atualize a skill <nome>: …\"."));
    for (const sk of learned) {
      const info = el("div", "acervo-info");
      info.append(el("strong", "", sk.name), el("span", "", sk.description !== "" ? sk.description : "sem descrição"));
      const item = el("div", "acervo-item on");
      item.append(info);
      acervoList.append(item);
    }
  }
  if (objectiveState?.available === true) {
    acervoList.append(el("div", "tut-group", `Skills do agente do WhatsApp em ${hostLabel(windowHost)}`));
    if (machine.length === 0) acervoList.append(el("div", "acervo-empty", "O agente desta máquina ainda não tem skills no workspace. O tutorial 7 cria a primeira: o objetivo dele no WhatsApp."));
    for (const sk of machine) {
      const info = el("div", "grow");
      info.append(el("strong", "", sk.objective ? `${sk.name} · objetivo do WhatsApp` : sk.name), el("span", "", sk.description !== "" ? sk.description : "sem descrição"));
      const item = el("div", `acervo-item${sk.objective ? " on" : ""}`);
      item.append(info);
      if (sk.objective) {
        const go = el("button", "btn btn-ghost btn-small", "Ajustar no tutorial 7"); go.type = "button";
        go.addEventListener("click", () => { const t = TUTORIAIS.find((x) => x.id === "whatsapp-objetivo"); if (t !== undefined) openGuide(t); });
        item.append(go);
      }
      acervoList.append(item);
    }
  }
  if (ACERVO_SKILLS.length === 0 && machine.length === 0 && objectiveState?.available !== true) {
    acervoList.append(el("div", "acervo-empty", "Nenhuma skill no acervo ainda. As mais usadas vão entrar aqui, cada uma com instalação pelo agente da máquina."));
  }
  if (ACERVO_SKILLS.length > 0) {
    const head = el("div", "tut-group", "Biblioteca do meu-bot ");
    const tg = el("button", "btn btn-ghost btn-small", acervoBibliotecaAberta ? "Ocultar" : "Mostrar"); tg.type = "button";
    tg.addEventListener("click", () => { acervoBibliotecaAberta = !acervoBibliotecaAberta; acervoPage.render(); });
    head.append(tg); acervoList.append(head);
  }
  for (const skill of acervoBibliotecaAberta ? ACERVO_SKILLS : []) {
    const info = el("div", "grow");
    info.append(el("strong", "", skill.name), el("span", "", skill.summary));
    const btn = el("button", "btn btn-primary btn-small", skill.usar?.botao ?? "Pedir ao agente para instalar");
    btn.type = "button";
    btn.addEventListener("click", () => {
      void (async () => {
        const tab = await newTab();
        await sendText(tab, skill.usar?.pedido ?? installPrompt(skill, hostLabel(windowHost)));
      })();
    });
    const item = el("div", "acervo-item");
    item.append(info, btn);
    acervoList.append(item);
  }
});
ligarAcervo();

ligarCatalogo();
ligarTutoriais();
/** Pede ao agente da máquina para preparar (modal ou guia): fecha o modal se aberto, abre uma conversa e manda o pedido. */
/** Confirmação sem caixa sobreposta: o 1º clique arma o botão ("Confirmar?"), o 2º em até 4 s executa. */
function armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void {
  const armed = btn.dataset.armed === "1";
  // Botão de perigo que já nasce com `btn-bad` (páginas com seções que abrem) fica vermelho ao desarmar: só se tira a
  // cor que o próprio armConfirm pôs.
  const soltar = (): void => { if (btn.dataset.eraBad !== "1") btn.classList.remove("btn-bad"); };
  if (armed) { btn.dataset.armed = ""; btn.textContent = btn.dataset.label ?? btn.textContent; soltar(); run(); return; }
  btn.dataset.label = btn.textContent ?? "";
  btn.dataset.eraBad = btn.classList.contains("btn-bad") ? "1" : "";
  btn.dataset.armed = "1"; btn.textContent = label; btn.classList.add("btn-bad");
  const reset = (): void => { if (btn.dataset.armed === "1") { btn.dataset.armed = ""; btn.textContent = btn.dataset.label ?? ""; soltar(); } };
  window.setTimeout(reset, 4000);
}
let waStatus: WhatsappStatus | null = null;
let waChats: WhatsappChat[] = [];
ligarConversas();
ligarChat();

let waTimer: ReturnType<typeof setTimeout> | null = null;
ligarAgenteWhatsapp();
ligarGrupos();
ligarInicio();
ligarEnvio();

// Cliques dentro das respostas: botão Copiar dos blocos de código e links externos.
panelsEl.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement | null;
  if (target === null) return;
  const run = target.closest<HTMLButtonElement>(".btn-run");
  if (run !== null) {
    const block = run.closest<HTMLElement>(".code-block");
    const code = block?.querySelector("pre")?.textContent ?? "";
    void runInTerminal(code, block?.dataset["lang"] ?? "bash");
    return;
  }
  const copy = target.closest<HTMLButtonElement>(".btn-copy");
  if (copy !== null) {
    const code = copy.closest(".code-block")?.querySelector("pre")?.textContent ?? "";
    void navigator.clipboard.writeText(code).then(() => {
      copy.textContent = "Copiado";
      window.setTimeout(() => { copy.textContent = "Copiar"; }, 1500);
    });
    return;
  }
  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (link !== null) {
    ev.preventDefault();
    void abrirLinkDoChat(link.href, ev.metaKey || ev.ctrlKey);
    return;
  }
  const waBtn = target.closest<HTMLButtonElement>(".wa-msg .msg-actions button");
  if (waBtn !== null) { waCopy(waBtn); return; }
  const actionBtn = target.closest<HTMLButtonElement>(".msg-actions button");
  if (actionBtn !== null) {
    const msg = actionBtn.closest<HTMLElement>(".msg");
    const tab = active();
    if (msg === null || tab === null) return;
    const i = Number(msg.dataset["index"]);
    if (actionBtn.dataset["action"] === "copy") {
      const content = index.get(tab.id)?.messages[i]?.content ?? msg.textContent ?? "";
      void navigator.clipboard.writeText(content).then(() => {
        actionBtn.replaceChildren(svgIcon(ICON_CHECK)); actionBtn.title = "Copiado"; actionBtn.classList.add("done");
        window.setTimeout(() => { actionBtn.replaceChildren(svgIcon(ICON_COPY)); actionBtn.title = "Copiar"; actionBtn.classList.remove("done"); }, 1500);
      });
    } else if (actionBtn.dataset["action"] === "branch") {
      void branchFrom(tab.id, i);
    }
  }
});

sidebarBtn.addEventListener("click", () => toggleSidebar());
$<HTMLButtonElement>("composer-toggle").addEventListener("click", () => setComposerHidden(true));
$<HTMLButtonElement>("composer-show").addEventListener("click", () => setComposerHidden(false, { focar: true }));
sidebarSearch.addEventListener("input", () => renderSidebar());
sidebarArchived.addEventListener("change", () => renderSidebar());
// Seções das Configurações: todas recolhidas sempre que o painel abre; abrir uma recolhe as outras. Nada é lembrado.
const settingsGroups = [...document.querySelectorAll<HTMLDetailsElement>("details.group")];
for (const g of settingsGroups) {
  g.addEventListener("toggle", () => { if (g.open) for (const other of settingsGroups) if (other !== g) other.open = false; });
}
paletteBtn.addEventListener("click", () => openPalette());
topbarHideBtn.addEventListener("click", () => setTopbarHidden(true));
topbarShowBtn.addEventListener("click", () => setTopbarHidden(false));
ligarAtalhos();
ligarAgente();
paletteInput.addEventListener("input", () => { paletteSelected = 0; paintPalette(); });
paletteInput.addEventListener("keydown", (ev) => {
  const count = paletteList.querySelectorAll("li[role=option]").length;
  if (ev.key === "ArrowDown") { ev.preventDefault(); selectPalette(count === 0 ? 0 : (paletteSelected + 1) % count, true); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); selectPalette(count === 0 ? 0 : (paletteSelected - 1 + count) % count, true); }
  else if (ev.key === "Enter") { ev.preventDefault(); const sel = paletteList.querySelector<HTMLElement>("li[aria-selected=true]"); if (sel?.dataset["id"] !== undefined) void runPalette(sel.dataset["id"]); }
  else if (ev.key === "Escape") { ev.preventDefault(); closePalette(); }
  // Cmd+K de novo fecha. O handler global não recebe a tecla: o stopPropagation abaixo é para as setas/Enter não vazarem.
  else if ((ev.metaKey || ev.ctrlKey) && ev.key === "k") { ev.preventDefault(); closePalette(); }
  ev.stopPropagation();
});
paletteEl.addEventListener("click", (ev) => { if (ev.target === paletteEl) closePalette(); });
const pendingFocus: string[] = [];
window.meuBot.on("ui:focus-conversation", ({ conversationId }) => {
  if (!tabsReady) { pendingFocus.push(conversationId); return; }
  void openFromIndex(conversationId);
});
window.meuBot.on("chat:context", (c: ContextEvent) => {
  const tab = tabs.get(c.conversationId);
  if (tab === undefined) return;
  // "sent: 0" vem dos avisos de resumo; preserva a contagem do último envio.
  tab.context = { ...c, sent: c.sent === 0 && tab.context !== null ? tab.context.sent : c.sent };
  if (tab.id === activeId) paintContext(tab);
});
// A memória não tem mais editor nas Configurações: o agente a preenche sozinho e a pessoa ajusta pelo chat.
window.meuBot.on("memory:changed", (_m: MemoryView) => {
  const tab = active();
  if (tab !== null) addNotice(tab, "Memória atualizada automaticamente.");
});

/** Texto vindo da entrada rápida: vai pra aba ativa (ou nova se ocupada) e confirma pro main. */
const pendingQuick: { correlationId: string; text: string }[] = [];
let tabsReady = false;
async function handleQuickSubmit(correlationId: string, text: string): Promise<void> {
  try {
    let tab = active();
    if (tab === null || tab.busy) tab = await newTab();
    window.meuBot.quickAck(correlationId, true);
    // Tutorial 13: uma mensagem chegou pela janela flutuante; a flag lembra, senão o passo "desfaz" ao recarregar.
    const tq = TUTORIAIS.find((x) => x.id === "entrada-rapida");
    if (tq !== undefined && !loadGuideFlags(tq).quickUsado) { saveGuideFlag(tq, "quickUsado"); paintGuide(); }
    await sendText(tab, text);
  } catch (err) {
    window.meuBot.quickAck(correlationId, false, err instanceof Error ? err.message : String(err));
  }
}
window.meuBot.on("ui:quick-submit", ({ correlationId, text }) => {
  if (!tabsReady) { pendingQuick.push({ correlationId, text }); return; }
  void handleQuickSubmit(correlationId, text);
});

tabsEl.addEventListener("dragover", (ev) => {
  if (draggingId === null) return;
  ev.preventDefault();
  const dragged = tabs.get(draggingId)?.tabEl;
  const last = tabsEl.lastElementChild;
  if (dragged !== undefined && last !== null && last !== dragged && ev.clientX > last.getBoundingClientRect().right) tabsEl.appendChild(dragged);
});
tabsEl.addEventListener("drop", (ev) => ev.preventDefault());

modelSelect.addEventListener("change", () => {
  const tab = active();
  if (tab === null) return;
  const model = modelSelect.value as BackendModel;
  if (tab.model !== model && !prefersReducedMotion) showModeToast(model);
  setTabModel(tab, model);
  void window.meuBot.setConversationModel(tab.id, model);
});
sendBtn.addEventListener("click", () => {
  const tab = active();
  if (tab !== null && tab.busy) { void window.meuBot.cancel(tab.id); return; }
  cancelAutoSend();
  void sendMessage();
});
inputEl.addEventListener("input", () => { cancelAutoSend(); const t = active(); sendBtn.classList.toggle("shine", t !== null && !t.busy && (sendPhase.get(t.id) ?? "idle") === "idle" && inputEl.value.trim().length >= 2); });
inputEl.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && autoSend !== null) { ev.preventDefault(); cancelAutoSend(); return; }
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    cancelAutoSend();
    void sendMessage();
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !modeMenu.hidden) { modeMenu.hidden = true; return; }
  // Com o terminal focado, Ctrl+* é do shell (Ctrl+C, Ctrl+W, Ctrl+N…); só Cmd+* continua do app.
  // Sem a ⌘ (caps.teclaCmd falso), a tecla do app é a Ctrl, e no terminal Ctrl+Shift (teclas-core.ts).
  const inTerm = (ev.target as HTMLElement | null)?.closest?.(".term-panel") != null;
  if (inTerm && ehDoShell(ev, caps.teclaCmd)) return;
  if (temTeclaDoApp(ev, caps.teclaCmd, inTerm) && (ev.key === "j" || ev.key === "J")) { ev.preventDefault(); void openTerminalTab(ev.shiftKey ? "new" : "focus"); return; }
  const mod = ev.metaKey || ev.ctrlKey;
  // Cmd+= / Cmd++ / Cmd+- / Cmd+0: com o foco na página do Navegador (webview, barra de endereço, botões dela) é o zoom
  // do site; clicou fora (lateral, conversa, terminal, outra aba) é o zoom da janela inteira, como no Cursor.
  if (mod && !ev.altKey && ["=", "+", "-", "0"].includes(ev.key)) {
    ev.preventDefault();
    const dir = ev.key === "-" ? -1 : ev.key === "0" ? 0 : 1;
    if (navHasFocus()) navZoomStep(dir); else zoomWindow(dir === 0 ? { action: "reset" } : { action: "step", delta: dir });
    return;
  }
  if (mod && ev.key === "k") { ev.preventDefault(); if (paletteEl.hidden) openPalette(); else closePalette(); return; }
  // Localizar na página. O terminal tem a sua busca e já tratou o ⌘F dele: aqui só se sai da frente.
  if (mod && (ev.key === "f" || ev.key === "F") && !ev.shiftKey && !ev.altKey) {
    if (termHasFocus()) return;
    ev.preventDefault();
    const sel = String(window.getSelection() ?? "");
    abrirBusca(sel.trim());
    return;
  }
  if (mod && ev.key === "/") { ev.preventDefault(); abrirAtalhos(); return; }
  // Esc fecha a busca mesmo com o foco fora do campo dela.
  if (ev.key === "Escape" && buscaAberta() && paletteEl.hidden) { ev.preventDefault(); pararBusca(); return; }
  // Barra de escrever recolhida e a pessoa começou a digitar fora de um campo: a barra volta e a tecla cai nela.
  if (composerHidden() && !mod && !ev.altKey && ev.key.length === 1 && (ev.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable], webview, dialog") == null) { setComposerHidden(false, { focar: true }); return; }
  if (!paletteEl.hidden) return;
  if (mod && ev.key === "n" && !ev.shiftKey) { ev.preventDefault(); void newTab(); } // Cmd+Shift+N é a janela nova (menu)
  if (mod && ev.shiftKey && (ev.key === "b" || ev.key === "B")) { ev.preventDefault(); setInterfaceRecolhida(!interfaceRecolhida()); return; }
  // Cmd+B é o padrão único: recolhe tudo. Cmd+Shift+B (acima) continua valendo como atalho antigo, para a mesma coisa.
  if (mod && ev.key === "b") { ev.preventDefault(); setInterfaceRecolhida(!interfaceRecolhida()); }
  if (mod && ev.key === "\\") { ev.preventDefault(); toggleSplit(); return; }
  if (mod && ev.shiftKey && (ev.key === "f" || ev.key === "F") && navPage !== null && pageShown(navPage)) { ev.preventDefault(); toggleFavsBar(); return; }
  if (mod && ev.key === "w" && pageActive !== null) { ev.preventDefault(); closePage(pageActive); return; }
  if (mod && ev.key === "w" && activeId !== null) { ev.preventDefault(); void closeTab(activeId); }
});
/** Novo (shot "x-campaign grok-bot like button"): afunda e volta com mola; bolhas-mascote saltam em leque enquanto a aba nova aparece. */
function burstNew(): void {
  if (prefersReducedMotion) return;
  newBtn.classList.remove("pressed"); void newBtn.offsetWidth; newBtn.classList.add("pressed");
  setTimeout(() => newBtn.classList.remove("pressed"), 500);
  const tpl = $<HTMLTemplateElement>("intro-mascot-tpl");
  const hues = [220, 145, 40, 330, 270];
  for (let i = 0; i < 5; i++) {
    const el = (tpl.content.firstElementChild as SVGSVGElement).cloneNode(true) as SVGSVGElement;
    el.setAttribute("class", "burst-m");
    const ang = ((-150 + i * 30 + (Math.random() - 0.5) * 14) * Math.PI) / 180; // leque para cima
    const d = 34 + Math.random() * 22;
    el.style.setProperty("--bx", `${Math.round(Math.cos(ang) * d)}px`); el.style.setProperty("--by", `${Math.round(Math.sin(ang) * d)}px`);
    el.style.setProperty("--hue", String(hues[i])); el.style.setProperty("--d", `${i * 40}ms`);
    newBtn.append(el);
    setTimeout(() => el.remove(), 1000);
  }
}
newBtn.addEventListener("click", () => { burstNew(); void newTab(); });

/** Abre as Configurações (botão ou Cmd+,): sempre com as seções recolhidas e a memória recém-lida. */
/**
 * Suporte, lado da pessoa: o estado (`supportState`) e as peças da tela, usadas nas Configurações › Suporte e
 * nos passos do tutorial "Ligar o suporte": nome, interruptor, aviso entregue/código (plano B) e o registro do
 * que o suporte fez aqui. Tudo vale na hora; depois de cada ação as duas telas repintam.
 */
let supportState: SupportInfo | null = null;
/** Segmentos escolhidos (arquivo na máquina); null = todos. O rodapé e a barra do terminal seguem a mesma escolha. */
let statusLineSegs: StatusLineSegments | null = null;
ligarCrmGuia();
/** O agente rodou o `chave-set`? Quando o resultado chegar, consulta o CRM e segue (teste da chave, pipeline único). */
let crmKeyFromAgent = false;
ligarGuiaSecoes();
ligarNavegadorGuia();
ligarObjetivoGuia();
ligarLinkPublicoGuia();
ligarContasCliGuia();
ligarGuardaGuia();
ligarDigitandoGuia();
ligarEntradaRapidaGuia();
ligarGmailGuia();
ligarBackendFalta();
let navAskedPro = false;
let navAgent: BrowserAgentState = { on: false, state: "down", port: null };

/** Página Gmail (31 out): montada na abertura, como a Conta Google; a paleta e a aba fixada a alcançam por aqui. */
let gmailPage: ReturnType<typeof mountGmail> | null = null;
let contaGooglePage: ReturnType<typeof mountContaGoogle> | null = null;
/** Página Computador, para o controle remoto (`pagina_abrir`) alcançar como as outras. */
let computadorPage: ReturnType<typeof mountComputador> | null = null;
/** Só existe no produto com a capacidade `inspector` (meu-bot-inspector-staging). */
let inspectorPage: ReturnType<typeof mountInspector> | null = null;
/** Página própria de um app derivado (`caps.extensao`); null nos apps da tabela e quando o código dela não carregou. */
let extensaoPage: PaginaDeExtensao | null = null;
let modulosPage: ReturnType<typeof mountModulosPage> | null = null;
/**
 * Etiqueta "Pro" nas linhas da lateral (Conta Google, E-mail, Computador e Navegador): só no produto free e só para
 * quem não tem o acesso; quem é Pro via a etiqueta em tudo o que já podia usar. Em branco enquanto a licença não
 * chegou; refreshLicense (licenca.ts) repinta a cada leitura.
 */
function paintEtiquetasPro(): void {
  const etiqueta = etiquetaPro(caps.planoExigido, navLicenseAsked ? browserAccess(license, windowHost, caps.planoExigido, caps.produto) : null);
  for (const id of ["conta-google-count", "gmail-count", "computador-count"]) $<HTMLElement>(id).textContent = etiqueta;
  paintNavCount();
}
/** A página Módulos nesta janela (regra em modulos-crm.ts): produto fixo do app, add-on de módulos em vigor, ou máquina por SSH (o CRM). */
const modulosAqui = (): { visivel: boolean; temProdutos: boolean } => paginaModulos({ produtoFixo: caps.modulos !== null, addonEmVigor: modulosNaLicenca(license, windowHost, caps.addons), remoto: ehRemoto() });
/** Botão "Módulos" da lateral. A etiqueta "Custom" é dos produtos sob medida: quem só tem o CRM (do Pro) não a vê. */
function paintModulosLine(): void {
  if (modulosPage === null) return;
  const m = modulosAqui();
  $<HTMLButtonElement>("modulos-line").hidden = !m.visivel;
  $<HTMLElement>("modulos-count").textContent = caps.planoExigido === "free" && m.temProdutos ? "Custom" : "";
  modulosPage.repintarLista();
}
ligarNavegador();
ligarTerminal();
// Controle local pedindo a tela dividida: a página vai para a direita, como arrastar a aba.
window.meuBot.on("ui:split", (msg) => {
  if (msg.alvo === "juntar") {
    const page = msg.id !== undefined ? [...terminals.values()].find((x) => x.id === msg.id)?.page : msg.pagina === "navegador" ? navPage : msg.pagina === "tutoriais" ? tutoriaisPage : msg.pagina === "acervo" ? acervoPage : undefined;
    if (page === null || (page === undefined && (msg.id !== undefined || msg.pagina !== undefined))) return;
    splitOff(false, page); return;
  }
  if (msg.alvo === "terminal") { const t = [...terminals.values()].find((x) => x.id === msg.id); if (t !== undefined) splitOn(t.page); return; }
  if (msg.alvo === "vazia") { splitColunaVazia(); return; }
  if (msg.alvo === "navegador") { void openNavTab(undefined, false).then(() => { if (navPage !== null) splitOn(navPage); }); return; }
  const page = msg.alvo === "tutoriais" ? tutoriaisPage : acervoPage;
  openPage(page, false); splitOn(page);
});
// Controle remoto (MCP), `pagina_abrir`: a mesma escolha da aba fixada ao abrir a janela.
window.meuBot.on("ui:abrir-pagina", ({ pagina }) => {
  if (pagina === "tutoriais") openPage(tutoriaisPage);
  else if (pagina === "acervo") openPage(acervoPage);
  else if (pagina === "inspector") inspectorPage?.open();
  else if (pagina === "extensao") extensaoPage?.open();
  else if (pagina === "modulos") modulosPage?.open();
  else if (pagina === "conta-google") contaGooglePage?.open();
  else if (pagina === "gmail") gmailPage?.open();
  else if (pagina === "computador") computadorPage?.open();
  else if (pagina === "navegador") void openNavTab();
});
// Clique foca o último terminal; Option+clique (ou o "+" na aba) abre mais um.
$<HTMLButtonElement>("terminal-line").addEventListener("click", (ev) => { void openTerminalTab(ev.altKey ? "new" : "focus"); });
ligarAtividade();
/** A máquina desta janela é este próprio Mac (colima): sem internet o túnel segue, só o Claude não responde. */
let hostLocalAddr = false;
ligarRede();
ligarFaixaDepuracao();
ligarInstagramavel();
ligarCursorAgente();
ligarAtualizacao();
ligarAlvoWebview(webviewDoNavegador);
ligarBusca();
ligarConfiguracoes();
ligarConta();
// Todo body dos tutoriais precisa de alguém que o desenhe (cada módulo registra os seus no `ligar…()` dele).
{ const faltam = conferirPassos(TUTORIAIS); if (faltam.length > 0) console.error("passos de tutorial sem tela:", faltam.join(", ")); }
{ const faltam = conferirFontes(); if (faltam.length > 0) console.error("fontes do guia sem registro:", faltam.join(", ")); }

void (async () => {
  // Lista de conversas oculta por padrão (Cmd+B ou ☰ mostra); só fica visível se a pessoa a abriu antes.
  try { sidebarEl.hidden = localStorage.getItem("sidebarShown") !== "1"; } catch { sidebarEl.hidden = true; }
  // A barra de título compensa os semáforos pelo fator de zoom: lê o atual já na primeira pintura (o main confirma em seguida).
  try { document.documentElement.style.setProperty("--zoom-factor", String(window.meuBot.zoomFactorNow())); } catch { /* fica em 1 */ }
  applyNarrow();
  // Barra recolhida por padrão (como a lista): só fica aberta se a pessoa a mostrou da última vez.
  try { setTopbarHidden(localStorage.getItem("topbarShown") !== "1"); } catch { setTopbarHidden(true); }
  try { setComposerHidden(localStorage.getItem("composerShown") === "0"); } catch { setComposerHidden(false); }
  const info = await window.meuBot.getWindowInfo();
  if (info === null) throw new Error("janela sem máquina registrada");
  windowHost = info.host;
  caps = info.caps;
  $<HTMLElement>("mcp-group").hidden = !caps.controleRemoto;
  // Fora do macOS: a barra não guarda a folga dos semáforos, e os atalhos escritos na tela dizem Ctrl em vez de ⌘.
  document.body.classList.toggle("sem-semaforo", !caps.semaforoNaBarra);
  if (!caps.teclaCmd) {
    usarTeclaCmd(false);
    for (const e of document.querySelectorAll<HTMLElement>("[title]")) e.title = dicaTeclas(e.title, false);
    paletteBtn.textContent = rotuloTeclas(paletteBtn.textContent ?? "", false);
  }
  if (caps.supportAdmin) sidebarArchived.parentElement?.setAttribute("title", "Mostrar também as conversas arquivadas e, no WhatsApp, as que a pessoa excluiu (nada foi apagado)");
  appVersion = info.version;
  for (const id of ["app-version", "mini-version"]) { const v = $<HTMLElement>(id); v.textContent = `v${info.version}`; v.title = `${caps.nome} ${info.version}`; }
  appBuild = info.build;
  // Estado da atualização só agora, com caps e versão em mãos (um estado que chegou antes ficou guardado em lastUpdate).
  void window.meuBot.updateState().then(paintUpdateState).catch(() => { if (lastUpdate !== null) paintUpdateState(lastUpdate); });
  // Faixa OFFLINE nos dois apps: estado atual da internet e se a máquina desta janela é este próprio Mac.
  void window.meuBot.netCheck().then(setNet).catch(() => { /* a próxima sondagem avisa */ });
  void window.meuBot.hostLocalAddr().then((v) => { hostLocalAddr = v; paintNet(); }).catch(() => { /* fica como remota */ });
  if (caps.supportAdmin) {
    // meu-bot-admin: espelho da máquina da pessoa (saúde, WhatsApp, registros) + ações de suporte. Sem compositor,
    // sem conversas com o agente, sem logins nem pareamento (o main nem registra esses canais no admin).
    document.body.classList.add("admin-mode");
    document.title = `${info.person ?? windowHost} · suporte`;
    windowPersonName = info.person;
    // A mesma cor que a pessoa vê na janela dela: pela máquina como ela a chama; sem isso, pelo alias de suporte.
    document.documentElement.style.setProperty("--host-accent", hostAccent(info.machine ?? windowHost));
    applySettings(await window.meuBot.getSettings());
    // O WhatsApp só entra se a pessoa compartilha: a saúde diz, e aí começa o ciclo normal de consulta.
    const suportePage = mountSuportePage({
      addons: () => caps.addons,
      who: { host: windowHost, person: info.person, machine: info.machine }, panelsEl, definePage, openPage, armConfirm, fmtPhone, api: window.meuBot, cache: { read: cacheRead, write: cacheWrite },
      onPlan: (plan) => setPlanBadge(plan !== null && planoLiberaPro(plan)),
      onWhatsapp: (st) => {
        if (st === null) { if (waTimer !== null) { clearTimeout(waTimer); waTimer = null; } waStatus = null; }
        else { waStatus = comPareamento(st); if (waTimer === null) void refreshWhatsapp(); }
        paintWhatsapp(); renderSidebar();
      },
    });
    suportePage.open();
    // A aba Suporte pode ser fechada no ×: a lateral a reabre. Produtos (MVPs) ficam no seletor.
    $<HTMLButtonElement>("suporte-line").addEventListener("click", () => suportePage.open());
    // Auditoria (só o super admin): aba própria logo abaixo de Suporte, com o registro desta máquina.
    const auditoriaLine = $<HTMLButtonElement>("auditoria-line");
    const auditoriaPage = mountAuditoriaPage({ who: info.person ?? windowHost, panelsEl, definePage, openPage, api: window.meuBot });
    auditoriaLine.addEventListener("click", () => auditoriaPage.open());
    // Usuários: só quando o admin entra como root nesta máquina (o main confirma com `id -u`).
    const usuariosLine = $<HTMLButtonElement>("usuarios-line");
    const usuariosPage = mountUsuariosPage({ who: info.person ?? windowHost, panelsEl, definePage, openPage, api: window.meuBot });
    usuariosLine.addEventListener("click", () => usuariosPage.open());
    // Como root, a aba Usuários já abre junto com a Suporte; fixada (📌), fica na frente.
    // Claude Code Global: abaixo de Usuários, também só como root (a mesma conferência).
    const claudeGlobalLine = $<HTMLButtonElement>("claude-global-line");
    const claudeGlobalPage = mountClaudeGlobalPage({ who: info.person ?? windowHost, panelsEl, definePage, openPage, api: window.meuBot });
    claudeGlobalLine.addEventListener("click", () => claudeGlobalPage.open());
    // Link Público Global: abaixo do Claude Code Global, também só como root.
    const linkPublicoLine = $<HTMLButtonElement>("link-publico-line");
    const linkPublicoPage = mountLinkPublicoPage({ who: info.person ?? windowHost, panelsEl, definePage, openPage, api: window.meuBot });
    linkPublicoLine.addEventListener("click", () => linkPublicoPage.open());
    // Preparar máquina: o checklist do root, acima de Usuários (os passos humanos abrem as duas abas de cima).
    const prepararLine = $<HTMLButtonElement>("preparar-line");
    const prepararPage = mountPrepararPage({ who: info.person ?? windowHost, panelsEl, definePage, openPage, api: window.meuBot, abrirPagina: (id) => { if (id === "claude-global") claudeGlobalPage.open(); else linkPublicoPage.open(); } });
    prepararLine.addEventListener("click", () => prepararPage.open());
    const paginaAntes = pageActive;
    void window.meuBot.adminUsuariosVisivel().then((v) => {
      usuariosLine.hidden = !v;
      claudeGlobalLine.hidden = !v;
      linkPublicoLine.hidden = !v;
      prepararLine.hidden = !v;
      if (!v) return;
      usuariosAdmin = usuariosPage;
      // A resposta leva de 2 a 20 s: quem já clicou em outra aba nesse meio tempo não é puxado de volta.
      if (pageActive !== paginaAntes) return;
      usuariosPage.open();
      if (abaFixaAtual() !== "usuarios") suportePage.open();
    }).catch(() => { /* sem resposta: sem a linha */ });
    // Terminal na máquina da pessoa: só no admin (no meu-bot da pessoa a linha fica oculta).
    $<HTMLButtonElement>("terminal-line").hidden = false;
    void window.meuBot.adminAuditoriaVisivel().then((v) => { auditoriaLine.hidden = !v; }).catch(() => { /* sem resposta: sem a linha */ });
    adminBotMirror = mountBotMirror({ panelsEl, definePage, openPage, closePage, activePage: () => pageActive, api: window.meuBot, onListChanged: () => renderSidebar(), machine: () => hostLabel(windowHost), copyReference, cache: { read: cacheRead, write: cacheWrite, drop: cacheDrop } });
    renderSidebar();
    tabsReady = true;
    return;
  }
  document.title = `${caps.titulo} · ${hostLabel(windowHost)}`;
  paintTopbarHost();
  document.documentElement.style.setProperty("--host-accent", hostAccent(windowHost));
  // Estado do WhatsApp da última vez: o modo WhatsApp e a lista em cache aparecem antes do SSH responder.
  { const c = cacheRead<WhatsappStatus>("waStatus", true); if (c !== null && waStatus === null && typeof c.value.connected === "boolean" && c.value.capacidades !== undefined) { waStatus = c.value; paintListMode(); } }
  if (info.models.length > 0) hostModels.set(windowHost, info.models);
  applySettings(await window.meuBot.getSettings());
  const contaGoogle = mountContaGoogle({ panelsEl, definePage, openPage, openGmail: () => gmailPage?.open(), armConfirm, api: window.meuBot, host: () => windowHost, license: () => license, licenseKnown: () => navLicenseAsked, planoExigido: caps.planoExigido, produto: caps.produto });
  $<HTMLButtonElement>("conta-google-line").addEventListener("click", () => contaGoogle.open());
  contaGooglePage = contaGoogle;
  const gmail = mountGmail({ panelsEl, definePage, openPage, openContaGoogle: () => contaGoogle.open(), aoUsar: gmailGuiaFato, agente: caps.agenteNavegador, api: window.meuBot, host: () => windowHost, license: () => license, licenseKnown: () => navLicenseAsked, planoExigido: caps.planoExigido, produto: caps.produto });
  gmailPage = gmail;
  $<HTMLButtonElement>("gmail-line").addEventListener("click", () => gmail.open());
  // Computador: por capacidade (caps.telaComputador); sem ela a linha fica escondida (licenca.ts) e a página nem é montada.
  const computador = caps.telaComputador ? mountComputador({ panelsEl, definePage, openPage, api: window.meuBot, host: () => windowHost, local: () => windowHost === "local", license: () => license, licenseKnown: () => navLicenseAsked, planoExigido: caps.planoExigido, produto: caps.produto }) : null;
  computadorPage = computador;
  $<HTMLButtonElement>("computador-line").addEventListener("click", () => computador?.open());
  paintEtiquetasPro();
  // Módulos de produto: o fixo do app (caps.modulos, como no meu-bot-diego-staging) e os add-ons com módulos na licença
  // da máquina; e, nas máquinas por SSH, o CRM que já vem no meu-bot. A página é montada no app que pode ter módulos ou
  // instalar numa máquina; o botão segue a licença e a máquina da janela (paintModulosLine).
  if (caps.modulos !== null || caps.addons.some((a) => a.modulos) || caps.install) {
    modulosPage = mountModulosPage({
      panelsEl, definePage, openPage, armConfirm, api: window.meuBot, host: () => windowHost, goToChat: goToChatFromGuide,
      temProdutos: () => modulosAqui().temProdutos,
      // Cartão do CRM ("Já incluído"): o estado e a instalação são os do guia do CRM (crm-guia.ts), um caminho só.
      // "Configurar" abre o guia direto (o tutorial segue fora da lista): o do Gmail no CRM próprio, o do Streak no outro.
      crm: !caps.install ? null : {
        estado: () => ({ remoto: ehRemoto(), acesso: navLicenseAsked ? browserAccess(license, windowHost, caps.planoExigido, caps.produto) : null, produto: caps.produto, info: crmState, local: crmLocalState, ...crmSituacao() }),
        atualizar: async () => { await refreshLicense(); await refreshCrm(); },
        instalar: instalarCrm,
        abrirNoGmail: () => { void openNavTab("https://mail.google.com/"); },
        configurar: () => { const id = crmProprio() && motorCrm() === "proprio" ? "crm-gmail" : "crm-whatsapp"; const t = TUTORIAIS.find((x) => x.id === id); if (t !== undefined) openGuide(t); },
      },
    });
    aoMudarCrm(() => modulosPage?.repintarLista());
    $<HTMLButtonElement>("modulos-line").addEventListener("click", () => modulosPage?.open());
    // A página de um módulo pediu para levar um texto ao chat: só preenche; quem envia é a pessoa.
    // Planilha: só um cartão de confirmação acima da página do módulo (nada é lido sem a pessoa clicar).
    window.meuBot.on("modulos:acao", (a) => {
      if (a.acao === "chat") void preencherChat(a.texto, `Sugerido pela página ${a.rotulo}: revise e envie quando quiser.`);
      else if (a.acao === "planilha") modulosPage?.pedirPlanilha(a);
    });
    paintModulosLine();
  }
  // Inspector: por capacidade (só o meu-bot-inspector-staging); nos outros produtos o botão fica escondido e a página nem é montada.
  if (caps.inspector && caps.controleRemoto) {
    inspectorPage = mountInspector({ panelsEl, definePage, openPage, api: window.meuBot });
    const linha = $<HTMLButtonElement>("inspector-line");
    linha.hidden = false;
    linha.addEventListener("click", () => inspectorPage?.open());
  }
  void window.meuBot.getAccountStatus().then((s) => { account = s; syncModelos(); paintContext(active()); checkSessionThreshold(); checkEspacoThreshold(); paintEspaco(s?.cota); paintGuide(); });
  void refreshStatusLine();
  void refreshWhatsapp();
  // O Navegador estava aberto quando o app fechou: volta sozinho, em segundo plano, com as abas de antes.
  if (caps.chat && windowHost !== "" && navEstavaAberto()) void openNavTab(undefined, false);
  void refreshSupportState();
  void refreshObjective();
  if (caps.install) void refreshSkillsImportadas();
  void refreshClaudeLine();
  void conferirBackend();
  void refreshOllamaLine();
  // O que a lista de Tutoriais e o selo precisam saber vem todo na abertura, em paralelo: guarda, licença (Pro),
  // Navegador e CRM antes só eram consultados ao abrir o guia, e até lá os cartões ficavam "pendentes" por engano.
  void refreshGuarda();
  void refreshContas();
  void refreshLinkPublico();
  void refreshGmailGuia();
  /** A licença da janela pode ter mudado: relê e repinta toda tela que mostra bloqueio de plano. */
  const relerLicenca = async (): Promise<void> => { await refreshLicense(); paintGuide(); contaGoogle.repintar(); gmail.repintar(); computador?.repintar(); navReavaliar(); };
  void relerLicenca();
  // O aviso de plano sabe quem é a conta e a máquina: é ele que oferece "Usar o meu Pro nesta máquina".
  ligarAvisoPlano({ conta: contaAtual, remoto: ehRemoto, origem: () => license?.origem, aoLiberar: relerLicenca });
  // A licença da conta nesta máquina foi renovada ou tirada por baixo (main), ou a conta mudou: em Este Mac o plano
  // da janela É o da conta, então entrar, sair ou pagar muda o que abre; numa máquina, muda o que o aviso oferece.
  window.meuBot.on("license:changed", () => { void relerLicenca(); });
  let planoDaConta = JSON.stringify(contaAtual()?.conta?.licenca ?? null);
  aoMudarConta(() => { const agora = JSON.stringify(contaAtual()?.conta?.licenca ?? null); if (agora === planoDaConta) return; planoDaConta = agora; void relerLicenca(); });
  void refreshNavInst();
  void refreshCrm();
  const intro = playIntro(); // cobre a janela enquanto as abas voltam; some sozinha
  await restoreTabs();
  aplicarApagadas();
  window.addEventListener("focus", aplicarApagadas);
  renderSidebar();
  tabsReady = true;
  // Página própria de um app derivado: o código veio no pacote (dist/renderer/derivado/pagina.js). Montada aqui, antes
  // da aba fixada e da tela dividida, que podem pedi-la; se não carregar, o botão segue escondido e o app abre igual.
  if (caps.extensao !== null) {
    extensaoPage = await montarExtensao({ panelsEl, definePage, openPage, api: window.meuBot, registrar: (linha) => { console.error(linha); } });
    if (extensaoPage !== null) {
      const linha = $<HTMLButtonElement>("extensao-line");
      $<HTMLElement>("extensao-rotulo").textContent = caps.extensao.rotulo;
      linha.title = caps.extensao.rotulo;
      linha.hidden = false;
      linha.addEventListener("click", () => extensaoPage?.open());
    }
  }
  // A aba fixada (📌) fica na frente depois de restaurar as conversas: Tutoriais por padrão (quem chega leigo começa
  // pelo passo a passo), Inspector no inspector-staging; desafixar volta a abrir na conversa.
  const fixa = abaFixaAtual();
  if (fixa === "tutoriais") openPage(tutoriaisPage);
  else if (fixa === "acervo") openPage(acervoPage);
  else if (fixa === "inspector") inspectorPage?.open();
  else if (fixa === "extensao") extensaoPage?.open();
  else if (fixa === "modulos") modulosPage?.open();
  else if (fixa === "conta-google") contaGoogle.open();
  else if (fixa === "gmail") gmail.open();
  else if (fixa === "computador") computador?.open();
  else if (fixa === "navegador") void openNavTab();
  aberturaPronta = true;
  paintContext(active());
  void restoreSplit();
  for (const q of pendingQuick.splice(0)) void handleQuickSubmit(q.correlationId, q.text);
  for (const id of pendingFocus.splice(0)) void openFromIndex(id);
  await intro;
})();
