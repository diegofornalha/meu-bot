/** Contrato IPC · WhatsApp do agente: estado, conversas, grupos, marcas. Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */
import type { VoiceReplyMode, VozId } from "./agente";
import type { Gateway } from "./maquina";

/**
 * WhatsApp do agente da máquina (Hermes: bridge em ~/.hermes/whatsapp; OpenClaw: `openclaw channels`;
 * PicoClaw: canal `whatsapp_native` do ~/.picoclaw/config.json, sessão em store.db e /health do gateway).
 */
/**
 * O que a máquina sabe fazer no WhatsApp, independente de qual framework ela roda. A tela lê daqui
 * em vez de comparar o nome do gateway: uma VM com Hermes mostra o que o Hermes faz, e pronto.
 */
/** Quando o agente mostra "digitando…": `instant` liga assim que ele começa; `never` nunca; `thinking`/`message` esperam raciocínio ou texto (só no OpenClaw; o Hermes é ligado/desligado, lido como `instant`/`never`). */
export type TypingMode = "instant" | "never" | "thinking" | "message";
export const TYPING_MODES: readonly TypingMode[] = ["instant", "never", "thinking", "message"];
/** O que a tela oferece: mostrar sempre ou nunca (os outros modos ficam para quem edita a configuração à mão). */
export type TypingChoice = "instant" | "never";
export interface WhatsappCapacidades {
  parear: boolean; listarConversas: boolean; lerConversa: boolean; limparHistorico: boolean;
  /** O gateway do WhatsApp é desta própria conta da máquina (o app pode instalá-lo, religá-lo, pôr a guarda). Com gateway compartilhado, não. */
  gatewayProprio: boolean;
  /** "Atualizar lista" de grupos pelo WhatsApp é possível (para o gateway uns 30 s; só com gateway próprio). */
  gruposAtualizar: boolean;
  pausar: boolean;
  /** Pausar aceita prazo (2 h / 24 h / até retomar), vale em qualquer política e guarda o que chegou na pausa (Hermes com o plugin meu-bot-pausa, ou nativo). */
  pausaPrazo: boolean;
  /** O próprio Hermes faz a pausa por contato (ainda não existe; quando existir, o app prefere o nativo ao plugin). */
  pausaNativa: boolean;
  grupos: boolean; guarda: boolean; politicaDm: boolean; audio: boolean;
  /** O agente gerencia grupos pelo app, com ou sem número conectado agora (OpenClaw e Hermes): com `grupos` falso, o que falta é conectar o WhatsApp, não o agente. */
  gruposAoConectar: boolean;
  /** O app liga/desliga o "digitando…" do agente (OpenClaw: `agents.defaults.typingMode`; Hermes: `platforms.whatsapp.typing_indicator`). */
  digitando: boolean;
  /** Aplicar o "digitando…" reinicia o gateway do WhatsApp da máquina (Hermes: a chave é lida na subida). */
  digitandoReinicia: boolean;
  /** Aplicar "quem o agente responde" reinicia o gateway do WhatsApp da máquina (alguns segundos fora do ar). */
  politicaReinicia: boolean;
}
export interface WhatsappStatus {
  /** O que esta máquina sabe fazer; a tela decide por aqui, nunca pelo nome do gateway. */
  capacidades: WhatsappCapacidades;
  /** A máquina tem um agente com WhatsApp (Hermes, OpenClaw ou PicoClaw). */
  present: boolean;
  gateway: Gateway | null;
  /** O que foi encontrado, para humanos: "OpenClaw 2026.9.9 em /usr/local/bin (global, todos os usuários)". */
  agent: string;
  /** Dá para parear: o Hermes tem o bridge; o OpenClaw tem o plugin do WhatsApp. */
  ready: boolean;
  /** O que falta quando `ready` é falso (pt-BR, com o comando quando há um). */
  missing: string | null;
  connected: boolean;
  /** Estado do bridge (open, connecting, close, "sem bridge"…). */
  state: string;
  /** Número pareado (só dígitos), se há sessão. */
  number: string | null;
  loggedOut: boolean;
  detail: string;
  /** OpenClaw: quem o agente responde nas DMs (`channels.whatsapp.dmPolicy`); null = Hermes ou desconhecido. */
  dmPolicy: WhatsappDmPolicy | null;
  /** OpenClaw: o bloco `channels.whatsapp` como está no openclaw.json (JSON), para "Ver configuração do canal". */
  channelConfig: string | null;
  /** OpenClaw: `channels.whatsapp.allowFrom` como está ("+55…" ou "*"); ausente = Hermes ou bloco sem a lista. */
  allowFrom?: string[];
  /** O agente entende áudio (OpenClaw: transcritor em `tools.media.models`; Hermes: `stt` do config.yaml). Ausente = não se sabe. */
  audioIn?: boolean;
  /**
   * A máquina tem o que a transcrição precisa (o transcritor compartilhado do root em /opt/transcriber, ou o ffmpeg para
   * o caminho por usuário). `false` = só o admin resolve (Preparar máquina). Ausente = não se sabe.
   */
  audioMaquina?: boolean;
  /** A transcrição foi desligada de propósito (pelo admin ou pela pessoa): o app não a religa sozinho. */
  audioDesligado?: boolean;
  /** O app está ligando a transcrição agora (sozinho ou a pedido). */
  audioLigando?: boolean;
  /** A última tentativa automática de ligar a transcrição falhou com este motivo (a pessoa pode tentar à mão). */
  audioErro?: string;
  /** Quando o agente responde em áudio (OpenClaw: `tts.auto`; Hermes: `voice.auto_tts`); null = sem voz configurada. */
  audioOut?: VoiceReplyMode | null;
  /** Hermes: a resposta em áudio vai sem o texto embaixo e sem o eco da transcrição (marca do app + plugin meu-bot-pausa ≥ 1.3.0). */
  audioSoAudio?: boolean;
  /** Voz das respostas em áudio instalada na máquina (null = nenhuma escolhida ainda; a faber de antes conta como faber). */
  audioVoice?: VozId | null;
  /** Quando o agente mostra "digitando…" (OpenClaw: `typingMode` do agente ou o padrão); null = chave vazia (OpenClaw: a regra automática; Hermes: o padrão, ligado). Ausente = PicoClaw, que não mostra. */
  typingMode?: TypingMode | null;
  /** O que o app consertou sozinho nesta consulta (pt-BR), para a pessoa saber que a máquina mudou (ex.: gateway em porta própria). */
  repaired?: string;
  /** Agente que a pessoa escolheu para o WhatsApp desta máquina; null = ainda não escolheu (vale o que estiver instalado). */
  escolha?: WhatsappAgente | null;
  /** O comando `hermes` existe nesta máquina (PATH do agente). Em Este Mac, é o que libera o cartão Hermes no tutorial 3. */
  hermesCli?: boolean;
  /** Quem manda no agente: o dono gravado na máquina (whatsapp-lista.json › dono) ou o próprio número pareado (`souEu`). Ausente sem número. */
  dono?: { numero: string; nome: string | null; souEu: boolean };
  /** Onde vive o WhatsApp desta máquina (OpenClaw): conta e agente no gateway, e de quem é o gateway. Ausente = o padrão (próprio). */
  alvo?: WhatsappAlvoResolvido;
}

/**
 * Onde vive o WhatsApp de uma máquina com OpenClaw: a conta (`channels.whatsapp.accounts.<id>`) e o agente
 * (`agents.entries.<id>`) no gateway, e de quem é o gateway (`gatewayUser`: o usuário Linux da mesma máquina que o
 * roda; null = o próprio). Gravado na máquina em ~/.local/share/meu-bot/whatsapp-alvo.json; sem o arquivo vale
 * `default`/`main`/próprio, o layout de sempre. `numero` é o pareado, copiado pelo app (o backend do usuário não lê as
 * credenciais que ficam no home de outro).
 */
export interface WhatsappAlvo { accountId: string; agentId: string; gatewayUser: string | null; numero?: string | null }
/** O alvo com o alias SSH do gateway resolvido neste Mac (mesmo HostName, User = gatewayUser); `proprio` = o gateway é desta conta. */
export interface WhatsappAlvoResolvido extends WhatsappAlvo { gatewayHost: string | null; proprio: boolean }

/** O motor gravado como escolha para o WhatsApp (whatsapp-agente): os mesmos nomes de `Gateway`; a tela só oferece OpenClaw e Hermes. */
export type WhatsappAgente = Gateway;

export type WhatsappDmPolicy = "pairing" | "allowlist" | "open" | "disabled";

/** Uma conversa do WhatsApp (OpenClaw) no espelho só-leitura: um contato, juntando as sessões dele. */
export interface WhatsappChat {
  /** Só dígitos, com DDI. */
  number: string;
  /** Último nome que o contato mandou (pushname): da leitura do histórico ou do cache na máquina (whatsapp-lista.json). */
  name: string | null;
  /** Apelido dado na tela ("Renomear"), guardado na máquina: vence o nome na lista e no título. */
  alias: string | null;
  /** O próprio número do aparelho (mensagens para si mesmo). */
  isSelf: boolean;
  /** O dono gravado na máquina (quem manda no agente), quando não é o próprio aparelho. */
  isDono?: boolean;
  /** Sessões do agente com mensagens desse contato (principal e/ou por contato). */
  sessionKeys: string[];
  /** Chave da sessão → UUID interno do OpenClaw (troca a cada "Limpar"); para "Copiar ID". */
  sessionIds: Record<string, string>;
  /** Tem sessão só dele (isolamento por contato): dá para pausar sem afetar os outros. */
  ownSession: boolean;
  /** O agente está pausado para este contato (não responde). */
  paused: boolean;
  /** Fim da pausa (ISO) quando ela tem prazo; null/ausente = sem prazo ou não pausado. */
  pausaAte?: string | null;
  /** ISO da atividade mais recente. */
  updatedAt: string;
  /** Arquivada na máquina (whatsapp-lista.json): os dois apps veem igual. */
  archived: boolean;
  /** Excluída na máquina e sem mensagem nova desde então (some da lista; volta se o contato escrever). */
  deleted: boolean;
}

/** Um ajuste de uma conversa do WhatsApp gravado na máquina: arquivado/excluído, nome em cache, apelido (vazio apaga); `at` só na migração. */
export interface WaMarkPatch {
  number: string; archived?: boolean; deleted?: boolean; name?: string; alias?: string; at?: string;
  /** Só o main grava (pausa no Hermes); a tela não manda. */
  paused?: boolean;
  /** Só com `paused: true`: prazo em horas (2 ou 24); a máquina calcula o fim com o relógio dela. Sem ele, até retomar. */
  pausaHoras?: 2 | 24;
}
/** Marca de um grupo (`<dígitos>@g.us`): só excluído/restaurado; `at` como na conversa. */
/** Marca de grupo: excluir/restaurar da lista e/ou o apelido ("" apaga). */
export interface WaGroupMarkPatch { jid: string; deleted?: boolean; alias?: string; at?: string }

/** Uma mensagem do espelho: do contato ou do agente; hora em ISO. */
export interface WhatsappThreadMessage {
  role: "contact" | "agent"; text: string; at: string;
  /** Grupos: quem mandou (nome ou +número). */
  autor?: string;
  /** Chegou enquanto o contato estava pausado: o agente não a viu (whatsapp-pausados.jsonl do plugin meu-bot-pausa). */
  durantePausa?: true;
}
/** Uma resposta que o agente escreveu e a guarda segurou (modo "sugere e você aprova"). */
export interface WhatsappSugestao {
  id: string;
  /** "+5511…" (contato) ou "<dígitos>@g.us" (grupo). */
  para: string;
  texto: string;
  /** Quando o agente escreveu, em ISO. */
  em: string;
}
/** O modo sugestão na máquina: `disponivel: false` = a guarda dela ainda não tem o modo (ou não há OpenClaw). */
export interface WhatsappSugestoes { disponivel: boolean; ligado: boolean; desde: string | null; sugestoes: WhatsappSugestao[] }
/** O que a tela pede sobre uma sugestão ou sobre o modo. */
export type WhatsappSugestaoPedido = { acao: "ligar" } | { acao: "desligar" } | { acao: "aprovar"; id: string; texto?: string } | { acao: "descartar"; id: string };
/** Como o agente fica num grupo: desligado, "só quando mencionado" (requireMention) ou "sempre". */
export type WhatsappGroupAgent = "desligado" | "mencao" | "sempre";
export interface WhatsappGroup {
  /** "<dígitos>@g.us". */
  jid: string;
  nome: string | null;
  /** Apelido dado na tela (marca na máquina, whatsapp-lista.json); vence o nome na lista e no título. */
  apelido: string | null;
  /** Do cache da skill whatsapp-grupos; null sem cache. */
  membros: number | null;
  /** Números (só dígitos) dos membros, do cache; vazio sem cache. */
  participantes: string[];
  agente: WhatsappGroupAgent;
  /** Sessão do agente neste grupo (null = ninguém falou com ele ainda). */
  sessionKey: string | null;
  /** UUID atual da sessão no OpenClaw (troca a cada /new ou limpar); para o ID da aba. */
  sessionId: string | null;
  /** Transcrição do Claude Code desta sessão na máquina (~/.claude/projects/…/<id>.jsonl), se achada. */
  transcript: string | null;
  /** O agente já respondeu neste grupo (sessão atual, pelo banco do OpenClaw): tutorial 10, passo "Testar". */
  agenteRespondeu: boolean;
  updatedAt: string | null;
  /** Excluído da lista (marca na máquina, whatsapp-lista.json; só a vista, o openclaw.json não muda). Volta sozinho quando o agente recebe mensagem nova do grupo. */
  deleted: boolean;
}
/** Grupos da máquina e quem aciona o agente neles (groupAllowFrom vale para TODOS os grupos ligados). */
export interface WhatsappGroups {
  grupos: WhatsappGroup[];
  /** Números (só dígitos) que acionam o agente nos grupos, ou "todos" (qualquer membro). */
  quemAciona: string[] | "todos";
  /** Sem groupAllowFrom: o OpenClaw usa a lista das conversas diretas (allowFrom). */
  quemAcionaHerdado: boolean;
  /** Config que admite todos os grupos (groups vazio ou "*" com grupos ligados): perigoso. */
  todosAdmitidos: boolean;
  /** Quando a lista de grupos foi lida do WhatsApp (cache da skill); null = nunca. */
  cacheEm: string | null;
  /** A skill whatsapp-grupos está na máquina (sem ela não dá para atualizar a lista). */
  skill: boolean;
  /** Número do próprio agente (só dígitos). */
  self: string | null;
  /** Quem aciona nos grupos é a mesma lista das conversas diretas (Hermes): o app não grava uma lista só dos grupos. */
  quemListaUnica?: boolean;
}
/** Mudança pedida num grupo: ligar/desligar e/ou quem aciona (lista de números ou "todos", que exige confirmação). */
export interface WhatsappGroupPatch { agente?: WhatsappGroupAgent; quemAciona?: string[] | "todos" }
/** Resultado de guardar a conversa no CRM antes de limpar (meu-bot-crm): onde ficou e se o resumo foi atualizado. */
export interface WhatsappArchive {
  /** Não havia mensagens para guardar (nada foi enviado ao CRM). */
  vazio: boolean;
  contato: string | null;
  box: { key: string; nome: string } | null;
  arquivo: string | null;
  mensagens: number;
  resumo: boolean;
  aviso: string | null;
  /** Cópia no Google Drive: o caminho (meu-bot / máquina / WhatsApp / contato / arquivo); null = Google não conectado. */
  drive: string | null;
}
/** Caixa do CRM oferecida na escolha ao limpar um grupo pela primeira vez (as mais ativas primeiro). */
/**
 * Resultado de guardar a conversa de um grupo no CRM. A caixa é fixa por grupo: a máquina abre uma no pipeline
 * padrão, com o nome do grupo, na primeira vez (`criada`) e reaproveita nas seguintes; o dono não escolhe.
 */
export interface WhatsappGroupArchive {
  vazio: boolean;
  /** A caixa do grupo nasceu nesta chamada. */
  criada: boolean;
  box: { key: string; nome: string } | null;
  arquivo: string | null;
  mensagens: number;
  resumo: boolean;
  aviso: string | null;
}
/** De onde veio uma conversa do meu-bot criada a partir do WhatsApp: contato, quantas mensagens e até quando. */
export interface WhatsappOrigin {
  number: string; name: string; count: number; until: string;
  /** As mensagens trazidas, para a aba mostrar a conversa do WhatsApp antes da conversa com o meu-bot. */
  messages?: WhatsappThreadMessage[];
}
/** O que o app oferece: "self" = só você (allowlist + selfChatMode); "open" = todo mundo (open + allowFrom *). */
/** Cartão escolhido: "self" = só você; "open" = todo mundo; "list" = você e os números listados (allowlist com allowFrom). */
export type WhatsappReplyChoice = "self" | "open" | "list";

/** Eventos do pareamento por QR. */
export type WhatsappEvent =
  | { kind: "step"; text: string }
  | { kind: "log"; text: string }
  | { kind: "qr"; dataUrl: string }
  | { kind: "connected"; number: string | null }
  | { kind: "error"; text: string }
  | { kind: "done"; ok: boolean };

/** Menu "…" de um grupo na área "Grupos". */
export type WhatsappGroupMenuAction = "group-on" | "group-off" | "group-who" | "group-copy-id" | "group-rename" | "group-clear" | "group-delete" | "group-restore" | "groups-refresh";
/** `pause` = até eu retomar; `pause-2h`/`pause-24h` = com prazo (só com a capacidade `pausaPrazo`). */
export type WhatsappMenuAction = "talk" | "export-md" | "export-json" | "copy-ref" | "rename" | "archive" | "unarchive" | "clear" | "delete" | "restore" | "pause" | "pause-2h" | "pause-24h" | "resume";
