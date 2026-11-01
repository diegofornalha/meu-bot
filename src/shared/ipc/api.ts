/** Contrato IPC · A superfície exposta às telas (window.meuBot) e os eventos do main. Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */
import type { BatimentoDepuracao, EstadoDepuracao, EventoDepuracao } from "./depuracao";
import type { AccountStatus, AudioSetup, ClaudeAuthInfo, ClaudeLoginEvent, ContaEstado, ContaEvento, ContaId, ContasClaudeView, LinkPublicoInfo, LinkPublicoStatus, CotaInfo, LinkPublicoLista, LinkPublicoPublicado, FreedomLevel, LimiaresClaude, ObjectiveChoice, ObjectiveInfo, StatusLineSegments, XaiKeyStatus } from "./agente";
import type { AlertPrefs, BackendModel, DonoInfo, NetState, SettingsUpdate, SettingsView, WindowInfo, ZoomAction, ZoomState } from "./app";
import type { UpdateState } from "./atualizacao";
import type { TelaEndereco, TelaInstalacao, TelaStatus } from "./computador";
import type { ClaudeSessionRef, ContextEvent, ConversationRef, DoneEvent, ErrorEvent, ExportFormat, MemoryView, StoredConversationView, TabMenuAction, ToolEvent } from "./conversa";
import type { CrmDiag, CrmInfo, CrmLocal } from "./crm";
import type { FinanceAbc, FinanceAbcLado, FinanceAbcPor, FinanceCategoria, FinanceConfig, FinanceConta, FinanceImportacao, FinanceInfo, FinanceLancamento, FinanceLancarInput, FinanceMoeda, FinanceTipoLinha } from "./financeiro";
import type { AgendaEvento, BackupDadosProgresso, BackupDadosView, GmailAgenteState, GmailApagado, GmailDetalhe, GmailLista, GoogleContaStatus, PlanilhaLeitura } from "./google";
import type { LicensePatch, LicenseView } from "./licenca";
import type { ModuloResultado, ModulosLista } from "./modulos";
import type { BackendStatusEvent, InstallBackendResult, TailscaleSshResult } from "./maquina";
import type { BrowserAgentState, BrowserExtensionInfo, BrowserOpenInfo, NavFavorito, NavWorkspaces } from "./navegador";
import type { AdminAction, AdminHealth, AuditoriaVisao, UsuariosVisao, PrepararId, PrepararVisao, BackupIndiceView, BackupRestauracao, BotChat, BotMenuAction, BotMessage, ProdutoMvp, SupportInfo, SupportProgress, SupportShare, CgEstado, LpEstado, LpAviso } from "./suporte";
import type { WaMarkPatch, WhatsappArchive, WhatsappChat, WhatsappEvent, WhatsappGroupAgent, WhatsappGroupArchive, WhatsappGroupMenuAction, WhatsappGroupPatch, WhatsappGroups, WhatsappMenuAction, WhatsappAgente, WhatsappReplyChoice, WhatsappStatus, WhatsappThreadMessage } from "./whatsapp";

export interface MainEvents {
  /** Modo de depuração: tique de 1 s do main (para a faixa saber se ele está preso) e a última marca. */
  "depuracao:batimento": BatimentoDepuracao;
  /** Modo de depuração ligado/desligado (ou o estado inicial pedido). */
  "depuracao:estado": EstadoDepuracao;
  /** Uma ação de fora que o main viu (só com o modo ligado). */
  "depuracao:evento": EventoDepuracao;
  "chat:assistant-start": ConversationRef;
  "chat:delta": ConversationRef & { text: string };
  "chat:done": DoneEvent;
  "chat:error": ErrorEvent;
  "backend:status": BackendStatusEvent;
  /** Configurações mudaram em outra janela. */
  "settings:changed": SettingsView;
  /** Clique numa notificação: ativar esta conversa. */
  "ui:focus-conversation": ConversationRef;
  "chat:context": ContextEvent;
  "memory:changed": MemoryView;
  /** Texto vindo da janela de entrada rápida; responder com quickAck. */
  "ui:quick-submit": { correlationId: string; text: string };
  /** Menu meu-bot › Configurações… (Cmd+,): abre, ou fecha se já está aberto. */
  "ui:toggle-settings": Record<string, never>;
  /** Aviso do backend no meio de um turno (ex.: caiu para outro provedor). */
  "chat:notice": { conversationId: string; text: string };
  /** O agente usou uma ferramenta (modo agente): o que rodou/leu e o resultado resumido. */
  "chat:tool": { conversationId: string; tool: ToolEvent };
  /** Conta e limites do Claude na máquina, depois de cada turno. */
  "chat:account": { host: string; status: AccountStatus | null };
  /** Pareamento do WhatsApp do Hermes em andamento. */
  "whatsapp:event": WhatsappEvent;
  /** Linha de progresso do instalador da status line (tutorial). */
  "statusline:progress": { line: string };
  "backend:install-progress": { line: string };
  /** Linha de progresso do instalador da guarda do WhatsApp (tutorial). */
  "guarda:progress": { line: string };
  /** Linha de progresso do instalador do Navegador do agente (tutorial 10). */
  "navegador:progress": { line: string };
  "gmail:progress": { line: string };
  /** Gmail: estado do "o agente pode usar" (socket + túnel reverso). */
  "gmail:agent": GmailAgenteState;
  /** Instalação do CRM pelo WhatsApp (tutorial 17): uma linha de progresso. */
  "crm:progress": { line: string };
  /** Instalação do financeiro na máquina, linha a linha (tutorial 13). */
  "finance:progress": { line: string };
  /** Módulos de produto (meu-bot-diego): uma linha do instalador do módulo `id`. */
  "modulos:progress": { id: string; line: string };
  /** meu-bot-admin, backup e mudança de máquina: bytes recebidos ou uma linha da restauração. */
  "admin:backup-progress": { bytes?: number; line?: string };
  /** Uma linha do job de criar/preparar usuário (onboarding), para o log ao vivo da aba Usuários. */
  "admin:usuarios-progresso": { line: string };
  /** Login do Claude Code em andamento. */
  "claude-login:event": ClaudeLoginEvent;
  /** Login OAuth da xAI no Hermes em andamento (mesmo formato). */
  "xai-login:event": ClaudeLoginEvent;
  "contas:evento": ContaEvento;
  /** Terminal: bytes crus do shell (o xterm decodifica) e o fim da sessão. */
  "term:data": { id: string; data: Uint8Array };
  "term:exit": { id: string; code: number; detail: string | null };
  /** Uma versão nova do app foi baixada e preparada: "Reiniciar e atualizar" troca na hora. */
  /** Cada fase da verificação de atualização (verificando, mais recente, baixando, pronta, erro). */
  "update:state": UpdateState;
  /** Seletor pediu: abrir o modal de login do Claude Code nesta janela. */
  "ui:claude-login": Record<string, never>;
  /** Internet deste Mac mudou ou foi sondada (faixa OFFLINE em todas as janelas). */
  "net:state": NetState;
  /** Navegador: a lista de extensões da sessão mudou (instalou pela Web Store, removeu). */
  "browser:extensions": BrowserExtensionInfo[];
  /** Navegador: uma página pediu janela nova (target=_blank): abrir como aba interna. */
  "browser:open-url": { url: string };
  /** Navegador: um site pede câmera/microfone (balão como o do Brave); `fechar` = o pedido expirou; `aviso` = só um recado (macOS bloqueou). */
  "browser:permissao": { id: string; origem: string; tipos: ("camera" | "microfone")[]; texto: string; fechar?: boolean; aviso?: boolean };
  /** A extensão do CRM (Gmail) pediu para abrir a aba da conversa do WhatsApp deste número (só dígitos, com DDI). */
  "whatsapp:abrir": { number: string };
  /** Navegador: atalho Cmd+<tecla> apertado com o foco dentro de um webview (o app trata). */
  "browser:key": { key: string; shift: boolean };
  /** Navegador: o agente (pelas ações) pede uma aba nova, ativar ou fechar uma aba (id do webContents). */
  "browser:ask": { kind: "new-tab"; url: string; fundo?: boolean } | { kind: "activate" | "close"; wcId: number };
  /** Terminal: o controle local (term-api.ts) pede uma aba nova de terminal nesta janela. */
  "term:ask": { kind: "new" };
  /** Controle local (term-api.ts): mais uma coluna com a página à direita; juntar tira uma (id/pagina) ou todas. */
  "ui:split": { alvo: "terminal"; id: string } | { alvo: "navegador" | "tutoriais" | "acervo" | "vazia" } | { alvo: "juntar"; id?: string; pagina?: "navegador" | "tutoriais" | "acervo" };
  /** Quem está usando cada aba do Navegador (wcId → conversa): selo e ID na faixa de abas. */
  "browser:donos": { donos: Record<number, DonoInfo> };
  /** Terminal: quem o está usando pelo controle local (term-api.ts) e o que fez por último; null = ninguém (só a pessoa). */
  "term:dono": { id: string; dono: (DonoInfo & { acao: "abriu" | "leu" | "digitou" | "dividiu"; em: number }) | null };
  /** Navegador: estado do "agente pode usar" (socket + túnel reverso). */
  "browser:agent": BrowserAgentState;
  /** Navegador: a barra de favoritos da máquina mudou (pela pessoa ou pelo agente). */
  "browser:favorites": NavFavorito[];
  "browser:workspaces": NavWorkspaces;
  /** Zoom da janela mudou (atalho, menu Visualizar, paleta, Configurações ou outra janela); vale para todas. */
  "window:zoom-changed": ZoomState;
  /** Conta Google deste Mac conectou/desconectou: a página Conta Google relê o estado. */
  "google-conta:changed": GoogleContaStatus;
  /** Cópia no Drive em curso: uma etapa de um conjunto (só para as janelas da máquina que está copiando). */
  "backup-dados:progress": BackupDadosProgresso;
}

export type MainEventChannel = keyof MainEvents;

/** API exposta ao renderer via contextBridge como window.meuBot. */
/** Janela principal, os dois apps: leituras da máquina e o que é só deste Mac. */
export interface MeuBotSharedApi {
  getMemory(): Promise<MemoryView>;
  setMemory(update: { notas?: string; perfil?: string }): Promise<MemoryView>;
  getSettings(): Promise<SettingsView>;
  /** Máquina desta janela; null se a janela não está registrada (não deveria acontecer). */
  getWindowInfo(): Promise<WindowInfo | null>;
  /** Modo de depuração: estado atual (com os últimos eventos) e ligar/desligar (null = padrão da variante). */
  depuracaoEstado(): Promise<EstadoDepuracao>;
  depuracaoLigar(on: boolean | null): Promise<EstadoDepuracao>;
  /** Abre o seletor de máquinas (nova janela em outra máquina). */
  openPicker(): Promise<void>;
  /** WhatsApp do Hermes na máquina desta janela. */
  whatsappStatus(): Promise<WhatsappStatus>;
  xaiKeyStatus(): Promise<XaiKeyStatus>;
  /** Terminal na máquina desta janela (pty-broker por ssh; neste Mac, local). Os dois apps; no admin fica no registro da pessoa. */
  termOpen(cols: number, rows: number): Promise<{ id: string }>;
  termInput(id: string, data: string | Uint8Array): void;
  termResize(id: string, cols: number, rows: number): void;
  termClose(id: string): Promise<void>;
  termReplay(id: string): Promise<Uint8Array>;
  /** Atualização automática: estado (versão atual, disponível, pronta) e trocar + reiniciar. */
  updateState(): Promise<UpdateState>;
  /** "Verificar agora": consulta o GitHub fora do ciclo; devolve o estado ao fim. */
  checkUpdate(): Promise<UpdateState>;
  /** "Reiniciar e atualizar": só troca se a versão pronta ainda é a que o botão mostrou (`expectedVersion`). */
  applyUpdate(expectedVersion: string): Promise<void>;
  /** Internet deste Mac: sonda (com `force`, mesmo com resultado fresco) e devolve o estado. */
  netCheck(force?: boolean): Promise<NetState>;
  /** A máquina desta janela é este próprio Mac (colima)? O túnel para ela não precisa de internet. */
  hostLocalAddr(): Promise<boolean>;
  /** Conversas do WhatsApp (OpenClaw) desta máquina, mais recente primeiro. Só leitura. */
  whatsappChats(): Promise<WhatsappChat[]>;
  /** Histórico de um contato (número só com dígitos). Só leitura. */
  whatsappThread(number: string): Promise<WhatsappThreadMessage[]>;
  /** Menu "…" de uma conversa do WhatsApp na lista. */
  showWhatsappMenu(number: string, state: { archived: boolean; paused: boolean; deleted: boolean; pausaRotulo: string | null; dono: boolean }): Promise<WhatsappMenuAction | null>;
  /** Grupos do WhatsApp desta máquina: agente ligado ou não, quem o aciona, membros (cache da skill). Só leitura. */
  whatsappGroups(): Promise<WhatsappGroups>;
  /** Conversa de um grupo (jid "…@g.us"), com o autor de cada mensagem. Só leitura. */
  whatsappGroupThread(jid: string): Promise<WhatsappThreadMessage[]>;
  /** Liga/desliga o agente num grupo e/ou muda quem o aciona; relê e confere. Os dois apps (registrado na auditoria). */
  setWhatsappGroup(jid: string, patch: WhatsappGroupPatch): Promise<WhatsappGroups>;
  /** Relê a lista de grupos pelo WhatsApp (para o gateway ~30 s). */
  refreshWhatsappGroups(): Promise<WhatsappGroups>;
  /** Menu "…" de um grupo. */
  showWhatsappGroupMenu(jid: string, state: { agente: WhatsappGroupAgent; deleted: boolean }): Promise<WhatsappGroupMenuAction | null>;
  /** Pausa (true) ou retoma (false) as respostas do agente a este contato; `horas` (2|24) só com a capacidade `pausaPrazo`. Os dois apps (no admin, registrado). */
  pauseWhatsapp(number: string, paused: boolean, horas?: 2 | 24): Promise<void>;
  /** O que limpar o histórico deste contato vai zerar: só sessões dele, ou também a principal (de todos). Os dois apps. */
  whatsappClearPlan(number: string): Promise<{ own: number; shared: number }>;
  /** meu-bot-crm: guarda a conversa no CRM (transcrição + resumo) antes de limpar/excluir. */
  archiveWhatsappToCrm(number: string): Promise<WhatsappArchive>;
  /** Limpa na máquina o histórico do agente com este contato; `includeShared` confirma zerar a principal. */
  clearWhatsapp(number: string, includeShared: boolean): Promise<void>;
  /** O que "Limpar histórico" de um grupo vai zerar (0 = o agente nunca falou nele). */
  whatsappGroupClearPlan(jid: string): Promise<{ sessoes: number }>;
  /** Guarda a conversa do grupo na caixa fixa dele no CRM antes de limpar (a máquina abre a caixa na primeira vez). */
  archiveWhatsappGroupToCrm(jid: string): Promise<WhatsappGroupArchive>;
  /** Limpa na máquina o histórico do agente neste grupo. */
  clearWhatsappGroup(jid: string): Promise<void>;
  /** Arquiva/desarquiva/exclui conversas na máquina (whatsapp-lista.json): os dois apps veem igual. No admin, registrado. */
  markWhatsapp(marks: WaMarkPatch[]): Promise<void>;
  /** Excluir/restaurar um grupo na lista (marca na máquina, como na conversa; o openclaw.json não muda). */
  markWhatsappGroup(jid: string, deleted: boolean): Promise<void>;
  /** Apelido do grupo na lista (marca na máquina, os dois apps veem); "" apaga. */
  renameWhatsappGroup(jid: string, alias: string): Promise<void>;
  /** Descobre o nome (pushname) de contatos sem nome lendo o histórico deles de uma vez (até 20) e guarda na máquina. Devolve só os achados. */
  learnWhatsappNames(numbers: string[]): Promise<Record<string, string>>;
  /** Salva a conversa toda num arquivo; null = cancelado. */
  exportWhatsapp(number: string, format: ExportFormat): Promise<{ path: string } | null>;
  /** Conta do Claude Code na máquina desta janela (null se não deu para consultar). */
  claudeAuth(): Promise<ClaudeAuthInfo | null>;
  /** OAuth da xAI no Hermes da máquina (credencial xai-oauth); null se a máquina não tem Hermes. */
  xaiAuth(): Promise<ClaudeAuthInfo | null>;
  /** Contas de CLI desta máquina (Cloudflare, GitHub); null = máquina fora do alcance. */
  contasStatus(): Promise<ContaEstado[] | null>;
  /** Link público desta pessoa na máquina (tutorial 14): `info` null = desligado, máquina fora ou este Mac; `possivel` false = conta root (sem link por desenho). */
  linkPublico(): Promise<LinkPublicoStatus>;
  setSettings(update: SettingsUpdate): Promise<SettingsView>;
  /** Conta Google geral deste Mac (login + Gmail + Agenda + Sheets): estado, conectar/desconectar e as APIs. */
  /** `forcar`: repete a busca do client na release agora, mesmo tendo tentado há pouco. */
  googleContaStatus(forcar?: boolean): Promise<GoogleContaStatus>;
  /** Usa nesta máquina a conta que estava conectada no Mac antes de a conta ser por máquina. */
  googleContaAdotarDoMac(): Promise<GoogleContaStatus>;
  googleContaConectar(): Promise<GoogleContaStatus>;
  googleContaDesconectar(): Promise<GoogleContaStatus>;
  /** Estado da cópia dos dados desta máquina no Drive. */
  backupDadosStatus(): Promise<BackupDadosView>;
  /** Faz a cópia agora, sem esperar o ciclo diário. */
  backupDadosAgora(): Promise<BackupDadosView>;
  /** Liga ou desliga a cópia diária (vale para todas as máquinas deste Mac). */
  backupDadosLigar(ligado: boolean): Promise<BackupDadosView>;
  /** Abre no Finder a pasta com as cópias locais desta máquina. */
  backupDadosAbrirPasta(): Promise<{ pasta: string }>;
  /** Define a senha do pacote cifrado (credenciais). Mínimo de 8 caracteres. */
  backupDadosSenha(senha: string): Promise<BackupDadosView>;
  /** Apaga a senha: o pacote cifrado deixa de ser enviado (o que já está no Drive continua lá). */
  backupDadosLimparSenha(): Promise<BackupDadosView>;
  /** Página Gmail (Pro): uma página da caixa de entrada, ou de uma busca na sintaxe do Gmail; `pagina` é o token de `proxima`. */
  gmailListar(opts?: { busca?: string; max?: number; pagina?: string | undefined }): Promise<GmailLista>;
  gmailLer(id: string): Promise<GmailDetalhe>;
  /** Move para a lixeira (reversível); sem gmail.modify na autorização, falha com GMAIL_SEM_PERMISSAO. */
  gmailApagar(id: string): Promise<GmailApagado>;
  gmailRestaurar(id: string): Promise<GmailApagado>;
  agendaProximos(dias?: number): Promise<AgendaEvento[]>;
  agendaCriar(evento: { titulo: string; inicio: string; fim: string; descricao?: string }): Promise<AgendaEvento>;
  planilhaLer(id: string, intervalo: string): Promise<PlanilhaLeitura>;
  planilhaEscrever(id: string, intervalo: string, valores: string[][]): Promise<{ celulasAtualizadas: number }>;
  /** Zoom da janela (interface inteira, todas as janelas): Cmd+= / Cmd+- / Cmd+0 fora do Navegador, menu Visualizar, paleta. */
  zoomWindow(action: ZoomAction): Promise<ZoomState>;
  /** Fator de zoom desta janela agora (síncrono, do webFrame): para a barra de título compensar os semáforos já na primeira pintura. */
  zoomFactorNow(): number;
  /** Abre um link http(s) no navegador do sistema. */
  openExternal(url: string): Promise<void>;
  on<K extends MainEventChannel>(channel: K, callback: (payload: MainEvents[K]) => void): () => void;
}

/** Variante: cliente. Só o meu-bot normal: conversar com o agente, parear e mexer no WhatsApp, logins, instalar, suporte do lado da pessoa. */
export interface MeuBotClientApi {
  send(conversationId: string, text: string): Promise<void>;
  /** Interrompe a resposta em andamento desta conversa. */
  cancel(conversationId: string): Promise<void>;
  newConversation(): Promise<ConversationRef>;
  closeConversation(conversationId: string): Promise<void>;
  /** Conversas salvas, em ordem de criação, para reabrir as abas. */
  listConversations(): Promise<StoredConversationView[]>;
  /** "" remove o nome e volta ao título automático. */
  renameConversation(conversationId: string, title: string): Promise<void>;
  /** Nova ordem das abas, da esquerda para a direita. */
  reorderConversations(conversationIds: string[]): Promise<void>;
  setConversationModel(conversationId: string, model: BackendModel): Promise<void>;
  /** Marca como aberta em aba e devolve a conversa completa. */
  openConversation(conversationId: string): Promise<StoredConversationView | null>;
  deleteConversation(conversationId: string): Promise<void>;
  /** Tira daqui as conversas que o admin excluiu na máquina (conversas-apagadas.json); devolve os ids que saíram. */
  syncApagadas(): Promise<string[]>;
  archiveConversation(conversationId: string, archived: boolean): Promise<void>;
  duplicateConversation(conversationId: string): Promise<StoredConversationView | null>;
  /** Nova conversa com o histórico até a mensagem de índice `index` (inclusive). */
  branchConversation(conversationId: string, index: number): Promise<StoredConversationView | null>;
  /** Abre o diálogo de salvar; null se cancelado. */
  exportConversation(conversationId: string, format: ExportFormat): Promise<{ path: string } | null>;
  /** Sessão do Claude Code desta conversa (o .jsonl na máquina), para "Copiar ID"; null = ainda não há. */
  conversationReference(conversationId: string): Promise<{ claude: ClaudeSessionRef | null }>;
  /** Menu de contexto nativo da aba; null se fechado sem escolher. */
  showTabMenu(conversationId: string, state: { busy: boolean; archived: boolean }): Promise<TabMenuAction | null>;
  notify(conversationId: string, title: string, body: string): Promise<void>;
  /** Notificação de teste do sistema ("as notificações estão funcionando"); o macOS pede a permissão junto, na primeira. */
  notifyTest(): Promise<void>;
  /** Avisos de segurança desta máquina (backend); null = backend sem a rota ou fora do ar. */
  alertPrefs(): Promise<AlertPrefs | null>;
  setAlertPrefs(prefs: AlertPrefs): Promise<void>;
  quickAck(correlationId: string, ok: boolean, message?: string): void;
  /** Mostra/esconde a janela de entrada rápida (mesmo efeito do atalho global). */
  toggleQuickEntry(): Promise<void>;
  /** Conta e limites do Claude na máquina desta janela (null se o backend não tem o endpoint). */
  getAccountStatus(): Promise<AccountStatus | null>;
  /** Licença e devices desta conta (plano, status, membro desde, máquinas); null se o backend é antigo/fora do ar. */
  getLicense(): Promise<LicenseView | null>;
  /** Tailscale: ssh check → accept na política do tailnet (precisa da credencial salva no seletor). */
  disableTailscaleCheck(): Promise<TailscaleSshResult>;
  /** Tailscale: volta a política para o backup mais novo. */
  restoreTailscalePolicy(): Promise<TailscaleSshResult>;
  /** Pareia por QR (eventos em whatsapp:event). `reset` apaga a sessão atual antes. Resolve ao terminar. */
  whatsappPair(reset: boolean): Promise<void>;
  /** Desconecta o número da máquina (sem gerar QR novo). */
  whatsappLogout(): Promise<void>;
  /** Suporte (lado da pessoa): estado, ligar/desligar, código para copiar. */
  supportInfo(): Promise<SupportInfo>;
  setSupport(on: boolean, name: string): Promise<SupportInfo>;
  supportCode(): Promise<string>;
  /** Há backend do meu-bot nesta máquina? (decide se a linha "xAI (Grok)" aparece sem Hermes; o login é OAuth pelo Hermes). */
  /** Prepara o Grok por OAuth na máquina (Hermes + proxy local); progresso em xai-login:event (log). */
  xaiPrepare(): Promise<InstallBackendResult>;
  /** Status line do Claude na máquina desta janela: instalada? e instalar (progresso em statusline:progress). */
  statusLineInstalled(): Promise<boolean>;
  /** "Refazer do zero": desfaz a status line na máquina (script, settings.json, preferências). */
  uninstallStatusLine(): Promise<InstallBackendResult>;
  /** "Refazer do zero" do suporte: desliga e esquece o nome. */
  resetSupport(): Promise<SupportInfo>;
  /** Segmentos da status line nesta máquina (null = sem preferência gravada = todos). */
  statusLineSegments(): Promise<StatusLineSegments | null>;
  setStatusLineSegments(prefs: StatusLineSegments): Promise<StatusLineSegments>;
  installStatusLine(): Promise<InstallBackendResult>;
  /** Hermes: instala (ou atualiza) o plugin de pausa por contato com prazo (meu-bot-pausa) na máquina desta janela. */
  installPausaPlugin(): Promise<InstallBackendResult>;
  /** O backend do meu-bot está instalado na máquina desta janela? (este Mac: sempre; `null` = a máquina não respondeu) */
  backendPresente(): Promise<boolean | null>;
  /** Instala o backend do meu-bot na máquina desta janela (o mesmo do seletor); progresso em backend:install-progress. */
  installBackend(): Promise<InstallBackendResult>;
  /** Guarda do WhatsApp (plugin meu-bot-guarda no OpenClaw da máquina): instalada? (null = sem OpenClaw), instalar, desfazer. */
  /**
   * Aba "Navegador" (Pro), como no Rambox: as abas internas são `<webview>` do renderer na partição que
   * `browserOpen` devolve (exige plano Pro na máquina: erro "PRO_REQUIRED"); o main cuida da sessão e das extensões.
   */
  browserOpen(): Promise<BrowserOpenInfo>;
  browserExtensions(): Promise<BrowserExtensionInfo[]>;
  /** Liga/desliga "agente pode usar" (socket de ações + túnel reverso); estado em browser:agent. */
  browserAgent(on: boolean): Promise<BrowserAgentState>;
  /** O agente do WhatsApp também usa o Navegador (sem `on`: só lê). `liberados` = números (só dígitos) que podem. */
  browserAgentWhatsapp(on?: boolean): Promise<{ on: boolean; liberados: string[] }>;
  /** meu-bot-crm: pipelines do CRM da máquina e o padrão do WhatsApp. */
  crmLocal(): Promise<CrmLocal>;
  /** meu-bot-crm: cria um pipeline (o único vira o padrão do WhatsApp). */
  crmCriarPipeline(name: string, stages: string[]): Promise<CrmLocal>;
  /** meu-bot-crm: escolhe o pipeline onde as conversas do WhatsApp são anotadas. */
  crmDefinirPadrao(key: string): Promise<CrmLocal>;
  /** Qual aba interna está ativa (id do webContents): as ações do agente sem `aba` caem nela. */
  browserActive(wcId: number): void;
  browserRemoveExtension(extId: string): Promise<BrowserExtensionInfo[]>;
  /** Free pediu o Pro: fica no registro do suporte da máquina. */
  browserRequestPro(): Promise<void>;
  /** A pessoa avisou que já pagou (aviso de plano): fica no registro do suporte da máquina para o admin liberar. */
  planoAvisarPagamento(): Promise<void>;
  /** Espaço da conta na máquina (Configurações › Espaço): a cota relida agora pelo backend dela; null = sem cota, fora do ar ou este Mac. */
  cotaStatus(): Promise<CotaInfo | null>;
  /** O que ela pode apagar para liberar espaço (só caches de mídia, workspaces e sessões antigas do WhatsApp), como ela. */
  cotaMaiores(): Promise<{ home: string | null; itens: { kb: number; pasta: boolean; caminho: string }[] }>;
  /** Apaga um item dessa lista (conferido de novo na máquina) e devolve a lista nova. */
  cotaApagarItem(caminho: string): Promise<{ home: string | null; itens: { kb: number; pasta: boolean; caminho: string }[] }>;
  /** "Pedir mais espaço ao admin": fica no registro do suporte da máquina, com o % em que ela estava. */
  cotaPedirMais(pct: number): Promise<void>;
  /** Computador (Pro): o que a máquina diz da tela do bot. */
  computadorStatus(): Promise<TelaStatus>;
  /** Liga a tela (até 3 tentativas) e devolve o status depois. */
  computadorAcordar(): Promise<TelaStatus>;
  /** Instala a tela na máquina (pacotes + serviço de usuário). */
  computadorInstalar(): Promise<TelaInstalacao>;
  /** Endereço local do noVNC (abre o forward); lança se a tela não está ligada. */
  computadorUrl(): Promise<TelaEndereco>;
  /** Resposta ao balão de câmera/microfone de um site do Navegador. */
  browserPermissao(id: string, decisao: "sempre" | "agora" | "nunca"): Promise<void>;
  /** Esquece as permissões de câmera/microfone dadas aos sites (uma origem ou todas) nesta máquina. */
  browserPermissoesEsquecer(origem?: string): Promise<void>;
  /** Barra de favoritos do Navegador (por máquina): adicionar (url repetida só atualiza o título) e remover por id. */
  browserFavoriteAdd(f: { titulo: string; url: string }): Promise<NavFavorito[]>;
  browserFavoriteRemove(id: string): Promise<NavFavorito[]>;
  /** Grava os espaços de trabalho desta máquina (o main valida e devolve o que ficou). */
  browserWorkspacesSet(w: NavWorkspaces): Promise<NavWorkspaces>;
  guardaInstalled(): Promise<boolean | null>;
  /** Navegador do agente na máquina (MCP + regra): instalado? e instalar (progresso em navegador:progress). */
  navegadorInstalled(): Promise<boolean | null>;
  installNavegador(): Promise<InstallBackendResult>;
  /** Gmail para o agente (Pro): liga/desliga (socket + túnel reverso) ou só consulta, sem `on` (religa se a chave estiver lembrada); estado em gmail:agent. */
  gmailAgente(on?: boolean): Promise<GmailAgenteState>;
  /** O lado da máquina do Gmail (MCP + regra) está instalado? e instalar (progresso em gmail:progress). */
  gmailInstalado(): Promise<boolean | null>;
  instalarGmail(): Promise<InstallBackendResult>;
  installGuarda(): Promise<InstallBackendResult>;
  uninstallGuarda(): Promise<InstallBackendResult>;
  /** Tutorial 17 · CRM pelo WhatsApp (Pro): estado, instalar o plugin na máquina, gravar chave/pipeline/regras, testar a chave, refazer. */
  crmInfo(): Promise<CrmInfo>;
  /** Financeiro (produto meu-bot-finance): estado do módulo e dos números; lançamentos e ações da página Finanças. */
  financeInfo(): Promise<FinanceInfo>;
  financeLancamentos(filtro?: { mes?: string; status?: "pendente" | "confirmado"; limite?: number }): Promise<{ total: number; lancamentos: FinanceLancamento[] }>;
  financeCategorias(): Promise<FinanceCategoria[]>;
  financeLancar(input: FinanceLancarInput): Promise<FinanceLancamento>;
  financeConfirmar(id: string, categoria?: string): Promise<FinanceLancamento>;
  financeDescartar(id: string): Promise<void>;
  /** Corrige um lançamento (o que vier muda; categoria/conta pelo nome ou chave, data dd/mm ou AAAA-MM-DD). */
  financeCorrigir(id: string, patch: { valor?: string; favorecido?: string; categoria?: string; conta?: string | null; data?: string; notas?: string; linha?: string | null }): Promise<FinanceLancamento>;
  /** Cria (sem key) ou edita uma linha da DRE prevista; valor "" ou null = a definir. */
  financeLinhaSalvar(linha: { key?: string; nome: string; tipo: FinanceTipoLinha; valor: string | null; notas?: string }): Promise<void>;
  financeLinhaRemover(key: string): Promise<void>;
  /** A foto do comprovante de um lançamento (data URL), ou null se não está na máquina. */
  financeComprovante(sha256: string): Promise<string | null>;
  financeConfirmarTodas(): Promise<{ confirmados: number; restantes: number }>;
  financeContaCriar(input: { nome: string; tipo?: FinanceConta["tipo"]; moeda?: FinanceMoeda; saldoInicial?: string }): Promise<FinanceConta>;
  financeMes(mes: string, patch: { metaDireto?: string | null; metaIndireto?: string | null; metaNotas?: string; orcamento?: string | null; rendaPrevista?: string | null; dinheiroInformado?: boolean }): Promise<void>;
  /** Config de moeda do sistema: taxas (unidades por 1 US$) e a moeda de exibição. */
  financeConfigLer(): Promise<FinanceConfig>;
  financeConfig(patch: { taxas?: Record<string, number>; moedaExibicao?: FinanceMoeda }): Promise<FinanceConfig>;
  financeFecharMes(mes: string): Promise<void>;
  /** Curva ABC: últimos `meses` (1–24) até `ate` (AAAA-MM, padrão o mês atual). */
  financeAbc(filtro: { lado: FinanceAbcLado; por: FinanceAbcPor; meses: number; ate?: string }): Promise<FinanceAbc>;
  /** Lê uma planilha do Google Sheets (link) com a Conta Google do app e importa as linhas no financeiro da máquina. */
  financeImportarPlanilha(p: { link: string; aba?: string; tipo: FinanceAbcLado; simular: boolean }): Promise<FinanceImportacao>;
  installFinance(): Promise<InstallBackendResult>;
  /** Módulos de produto (só nos apps com `caps.modulos`): o manifesto com o estado de cada um nesta máquina. */
  modulosListar(): Promise<ModulosLista>;
  modulosLigar(id: string): Promise<ModuloResultado>;
  modulosDesligar(id: string): Promise<ModuloResultado>;
  /** Grava credenciais (valor vazio apaga); nunca devolve valores, só o estado. */
  modulosCredenciais(id: string, patch: Record<string, string>): Promise<ModulosLista>;
  /** Grava opções; com o módulo ligado, reinstala para valerem. */
  modulosOpcoes(id: string, patch: Record<string, string | number | boolean>): Promise<ModuloResultado>;
  /** Pede ao admin para liberar o meu-bot-finance (fica no registro de auditoria). */
  financePedir(): Promise<void>;
  installCrm(): Promise<InstallBackendResult>;
  setCrm(patch: { apiKey?: string; pipelineKey?: string | null; pipelineName?: string; silencioMin?: number; criarSemPerguntar?: boolean }): Promise<CrmInfo>;
  crmTest(): Promise<CrmDiag>;
  resetCrm(): Promise<CrmInfo>;
  /** Salva só o nome (passo 1 do tutorial), sem ligar nada. */
  setSupportName(name: string): Promise<SupportInfo>;
  /** Tutorial 8: estado na máquina (objetivo, nível, skill salva, skills do workspace). */
  objectiveInfo(): Promise<ObjectiveInfo>;
  /** Tutorial 8, passos 1 e 2: grava o objetivo e/ou o nível em objetivo.json na máquina. */
  setObjective(patch: { objective?: ObjectiveChoice; level?: FreedomLevel }): Promise<ObjectiveInfo>;
  /** Tutorial 8, passo 3: escreve a skill no workspace do OpenClaw e aplica a trava do nível. */
  saveObjectiveSkill(): Promise<ObjectiveInfo & { detail: string }>;
  /** "Refazer do zero" do tutorial 8: apaga a skill e o objetivo; o dono volta à liberdade total. */
  resetObjective(): Promise<ObjectiveInfo>;
  /** "Tentar de novo": entrega o aviso na caixa do admin agora. */
  supportDeliver(): Promise<SupportInfo>;
  /** Progresso nos tutoriais desta pessoa (vai para a máquina só com o suporte ligado). */
  reportProgress(p: SupportProgress): Promise<void>;
  /** O que o app do admin pode ver desta máquina (vale na hora). */
  setSupportShare(share: SupportShare): Promise<SupportInfo>;
  /** Instala/ajusta o áudio do agente do WhatsApp nesta máquina (transcrição ou voz). */
  whatsappAudio(setup: AudioSetup): Promise<InstallBackendResult>;
  whatsappCancel(): Promise<void>;
  /** OpenClaw: "self" = só você fala com o agente; "open" = responde todo mundo; "list" = você + `numbers` (só dígitos, com DDI). Vale sem reiniciar o gateway. */
  whatsappSetDmPolicy(policy: WhatsappReplyChoice, numbers?: readonly string[]): Promise<WhatsappStatus>;
  /** Quem manda no agente (null = volta ao número pareado). Reaplica "quem responde" e, no Hermes, o home channel (reinicia o gateway). */
  whatsappSetDono(numero: string | null): Promise<WhatsappStatus>;
  /** Grava qual agente atende o WhatsApp desta máquina; trocar desconecta o número do agente anterior. */
  whatsappEscolherAgente(agente: WhatsappAgente): Promise<WhatsappStatus>;
  /** Conversa nova do meu-bot com a conversa do WhatsApp como contexto. */
  whatsappBranch(number: string): Promise<StoredConversationView>;
  /** Login do Claude Code na máquina desta janela (eventos em claude-login:event). Resolve ao terminar. */
  claudeLogin(): Promise<void>;
  /** Código colado pela pessoa; false se não há login em andamento. */
  claudeLoginCode(code: string): Promise<boolean>;
  claudeLoginCancel(): Promise<void>;
  /** `claude auth logout` na máquina; devolve o estado depois. */
  claudeLogout(): Promise<ClaudeAuthInfo | null>;
  /** Contas do Claude na máquina desta janela; null = backend antigo (sem a rota) ou fora do ar. */
  contasClaude(): Promise<ContasClaudeView | null>;
  /** Cria uma conta isolada (pasta própria, histórico compartilhado) e já inicia o login nela (eventos em claude-login:event). */
  contasClaudeCriar(rotulo: string): Promise<ContasClaudeView | null>;
  /** Login numa conta existente (eventos em claude-login:event). Resolve ao terminar; a conta é conferida no fim. */
  contasClaudeEntrar(id: string): Promise<void>;
  contasClaudeAtualizar(id: string, patch: { rotulo?: string; ativa?: boolean }): Promise<ContasClaudeView | null>;
  /** Nova ordem das contas isoladas (ids); a padrão fica por último. */
  contasClaudeReordenar(ids: string[]): Promise<ContasClaudeView | null>;
  contasClaudeRemover(id: string): Promise<ContasClaudeView | null>;
  /** "Usar agora": tira a conta de `esgotada` antes da hora. */
  contasClaudeUsarAgora(id: string): Promise<ContasClaudeView | null>;
  /** Relê login, e-mail e uso da conta pela API. */
  contasClaudeConferir(id: string): Promise<ContasClaudeView | null>;
  contasClaudeLimiares(limiares: Partial<LimiaresClaude>): Promise<ContasClaudeView | null>;
  /** `hermes auth add xai-oauth --type oauth --no-browser` (eventos em xai-login:event). */
  xaiLogin(): Promise<void>;
  xaiLoginCancel(): Promise<void>;
  xaiLogout(): Promise<ClaudeAuthInfo | null>;
  /**
   * Login por SSH; o link vem em contas:evento (abrir no Navegador). `navegador` false = Cloudflare por código;
   * `trocar` = entrar com outra conta (a página não cai na conta que o Navegador já tem).
   */
  contasEntrar(id: ContaId, navegador: boolean, trocar: boolean): Promise<void>;
  /** Tutorial 14: troca o nome do link público dela (`<nome>.<domínio>`); devolve o estado novo. */
  linkPublicoNome(nome: string): Promise<LinkPublicoInfo>;
  /** Tutorial 14: o que está no ar no link dela (`publicar --lista`, como ela); null = desligado, máquina fora ou este Mac. */
  linkPublicoLista(): Promise<LinkPublicoLista | null>;
  /** Tutorial 14: tira um item do ar (`publicar --remover`, como ela); devolve a lista nova. */
  linkPublicoRemover(nome: string): Promise<LinkPublicoLista>;
  /** Tutorial 14: escolhe um arquivo neste Mac (diálogo do main) e publica no link dela (um .md vira página; até 100 MB); `nome` = o nome no link, opcional. null = cancelou. */
  linkPublicoPublicar(nome?: string): Promise<LinkPublicoPublicado | null>;
  contasCancelar(): Promise<void>;
  contasSair(id: ContaId): Promise<ContaEstado[] | null>;
  /** Instala o GitHub CLI (gh) na máquina da janela, sem sudo; devolve o estado novo das contas. */
  contasInstalarGh(): Promise<ContaEstado[] | null>;
}
export interface MeuBotAdminApi {
  /** meu-bot-admin: nomes dos MVPs registrados (botões "＋ produto" da licença); criar e editar ficam no seletor. */
  adminProdutos(): Promise<ProdutoMvp[]>;
  /** meu-bot-admin: saúde, registros e ações na máquina da pessoa desta janela. */
  adminHealth(): Promise<AdminHealth>;
  /** meu-bot-admin: a aba Auditoria aparece (só o super admin). */
  adminAuditoriaVisivel(): Promise<boolean>;
  /** Registro de auditoria da máquina desta janela (central conferida com a cópia da máquina). */
  adminAuditoria(): Promise<AuditoriaVisao>;
  /** Salva a prova (JSON com os hashes + CSV legível); null = cancelou. */
  adminAuditoriaExportar(): Promise<{ path: string } | null>;
  /** Aba Usuários: só numa máquina em que o admin entra como root. */
  adminUsuariosVisivel(): Promise<boolean>;
  adminUsuarios(): Promise<UsuariosVisao>;
  adminUsuarioCriar(nome: string, pct?: number): Promise<UsuariosVisao>;
  /** Limite de disco em % do disco principal (0 = sem limite). */
  adminUsuarioLimite(nome: string, pct: number): Promise<UsuariosVisao>;
  adminUsuarioApagar(nome: string): Promise<UsuariosVisao>;
  /** Tetos de RAM (MB) e CPU (% de um núcleo) do usuário; 0 = sem teto. */
  adminUsuarioRecursos(nome: string, ramMb: number, cpuPct: number): Promise<UsuariosVisao>;
  /** Liga 8 GB de swap na máquina (só quando não tem nenhuma). */
  adminSwapLigar(): Promise<UsuariosVisao>;
  /** Governança de RAM/CPU: reserva para o sistema (teto no user.slice) e isolamento das boxes que ainda não têm; nada reinicia. */
  adminGovernanca(): Promise<UsuariosVisao>;
  /** Reinstala o backend do meu-bot nas boxes atrás da versão deste app, uma por vez (pula quem está com chat em andamento ou sem alias neste Mac). */
  adminBackendsAtualizar(): Promise<UsuariosVisao>;
  /** Preparar máquina (root): o checklist (ok / falta / humano). */
  adminPrepararEstado(): Promise<PrepararVisao>;
  /** Aplica os ids pedidos (sem lista = tudo que falta, sem os opcionais) na ordem de dependência; devolve o estado relido com `falhas`. */
  adminPrepararAplicar(ids?: PrepararId[]): Promise<PrepararVisao>;
  /** Instala o Hermes para todos os usuários da máquina (/opt/hermes); só root. */
  adminHermesGlobal(): Promise<UsuariosVisao>;
  /** Apelido (nome de exibição) do usuário; vazio tira. */
  adminUsuarioApelido(nome: string, apelido: string): Promise<UsuariosVisao>;
  /** Liga o linger do usuário: o agente dele segue rodando sem ele conectado e volta ao reiniciar. */
  adminUsuarioManterLigado(nome: string): Promise<UsuariosVisao>;
  /** Refaz o onboarding da conta (Claude Code, backend, Hermes e transcrição); o que já está feito passa direto. */
  adminUsuarioPreparar(nome: string): Promise<UsuariosVisao>;
  /** Claude Code Global: estado (intermediário, conta do root, rodízio, usuários). */
  adminClaudeGlobal(): Promise<CgEstado>;
  /** Instala ou atualiza o intermediário do root (idempotente). */
  adminClaudeGlobalInstalar(): Promise<CgEstado>;
  /** Abre o login do Claude Code do root no Terminal deste Mac. */
  adminClaudeGlobalEntrar(): Promise<void>;
  /** Conta nova no rodízio do root (abre o login dela no Terminal). */
  adminClaudeGlobalContaNova(): Promise<CgEstado>;
  adminClaudeGlobalContaRemover(id: string): Promise<CgEstado>;
  adminClaudeGlobalContaUsar(id: string): Promise<CgEstado>;
  /** Ordem (ids das contas isoladas), ligar/desligar ou conferir uma conta do rodízio do root. */
  adminClaudeGlobalContaEditar(p: { ordem: string[] } | { id: string; ativa: boolean } | { id: string; conferir: true }): Promise<CgEstado>;
  /** Liga ou desliga o global para um usuário da máquina. */
  adminClaudeGlobalUsuario(nome: string, ligado: boolean): Promise<CgEstado>;
  /** Limiares do rodízio do root: troca ao passar de sessão %/semana %, e qual conta vai primeiro. */
  adminClaudeGlobalLimiares(t: { sessao?: number; semanal?: number; estrategia?: "ordem" | "folga" }): Promise<CgEstado>;
  /** Link Público Global: estado (instalação, login do root na Cloudflare, túnel, usuários). */
  adminLinkPublico(): Promise<LpEstado>;
  /** Instala nginx e cloudflared com o domínio dos links (idempotente). */
  adminLinkPublicoInstalar(dominio: string): Promise<LpEstado>;
  /** Abre o login do root na Cloudflare (no navegador deste Mac); a página confirma sozinha. */
  adminLinkPublicoEntrar(): Promise<{ url: string }>;
  /** Cria o túnel, aponta `*.<domínio>` e sobe o serviço. */
  adminLinkPublicoTunel(): Promise<LpEstado>;
  /** Liga ou desliga o link de um usuário da máquina; `avisos` = o que o ligar pulou (conta sem Hermes ou sem agent-workspace). */
  adminLinkPublicoUsuario(nome: string, ligado: boolean): Promise<{ estado: LpEstado; avisos: LpAviso[] }>;
  /** Escolhe um arquivo neste Mac e publica no link do usuário, como ele (um .md vira página; até 100 MB). `url` null = cancelou. */
  adminLinkPublicoPublicar(nome: string): Promise<{ estado: LpEstado; url: string | null }>;
  /** Tira um item do ar no link do usuário (`publicar --remover`, como ele). */
  adminLinkPublicoRemover(nome: string, item: string): Promise<LpEstado>;
  /** Põe o usuário no ~/.ssh/config deste Mac como máquina; ele aparece no seletor do meu-bot. */
  /** Põe o usuário nos dois seletores (meu-bot e admin), sem preparar a conta; `aviso` = o do admin falhou. */
  adminUsuarioNosSeletores(nome: string): Promise<{ alias: string; novo: boolean; aviso: string | null }>;
  /** Os usuários comuns com a chave deste Mac que faltam em algum seletor entram (ao abrir a aba). */
  adminUsuariosSincronizar(): Promise<{ entraram: string[]; semChave: string[]; falhas: { nome: string; motivo: string }[] }>;
  /** O que ocupa espaço na pasta do usuário, e apagar um item escolhido (para baixar o limite). */
  adminUsuarioMaiores(nome: string): Promise<{ home: string | null; itens: { kb: number; pasta: boolean; caminho: string }[] }>;
  adminUsuarioApagarItem(nome: string, caminho: string): Promise<{ home: string | null; itens: { kb: number; pasta: boolean; caminho: string }[] }>;
  /** Backup completo e mudança de máquina (a desta janela). Restaurar e trocar o WhatsApp: só o super admin. */
  adminBackupListar(todos?: boolean): Promise<{ backups: BackupIndiceView[]; podeRestaurar: boolean; podeCriar: boolean }>;
  adminBackupCriar(): Promise<BackupIndiceView>;
  adminBackupConferir(arquivo: string, substituir: boolean): Promise<BackupRestauracao>;
  adminBackupRestaurar(arquivo: string, substituir: boolean): Promise<{ log: string[] }>;
  adminBackupWhatsapp(arquivo: string, antigaDesligada: boolean): Promise<{ log: string[] }>;
  adminLogs(): Promise<string>;
  adminAction(action: AdminAction): Promise<{ ok: boolean; detail: string }>;
  /** Conversas dela com o meu-bot (transcrições do Claude Code na máquina), só leitura. */
  adminBotChats(): Promise<BotChat[]>;
  adminBotThread(sessionId: string): Promise<BotMessage[]>;
  /** Apaga na máquina dela a transcrição de uma conversa com o meu-bot (travou, ficou lixo); fica no registro. */
  adminBotDelete(sessionId: string): Promise<void>;
  /** Menu "…" de uma conversa dela com o meu-bot no espelho. */
  showBotMenu(sessionId: string): Promise<BotMenuAction | null>;
  /** meu-bot-admin: muda a licença da pessoa (plano, status, validade, limite); grava licenca.json por SSH. */
  setLicense(patch: LicensePatch): Promise<LicenseView>;
  /** meu-bot-admin: libera um device pendente (sobe o limite se preciso e marca o device como ativo). */
  approveDevice(deviceId: string): Promise<LicenseView>;
  /** meu-bot-admin: revoga um device (tira do registro); ele volta no próximo hello se couber no limite. */
  removeDevice(deviceId: string): Promise<LicenseView>;
}

/** O que o renderer vê em `window.meuBot`: os três grupos juntos (o main recusa o que não é da variante). */
export type MeuBotApi = MeuBotSharedApi & MeuBotClientApi & MeuBotAdminApi;
