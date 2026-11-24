/** Contrato IPC · Conversas com o meu-bot: mensagens, eventos do chat, exportação. Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */
import type { BackendModel } from "./app";
import type { WhatsappOrigin } from "./whatsapp";

export interface ContextEvent {
  conversationId: string;
  /** Mensagens do histórico enviadas ao vivo. */
  sent: number;
  total: number;
  mode: "full" | "summary" | "truncated";
  summarizing: boolean;
  summaryUpdatedAt?: string;
  /** Tokens estimados do que foi enviado e o orçamento (para a status line). */
  tokens?: number;
  budget?: number;
}

export interface MemoryView {
  notas: string;
  perfil: string;
  updatedAt: string;
  limits: { notas: number; perfil: number };
}

export interface DoneEvent {
  conversationId: string;
  stopReason: string;
  /** O backend retomou a sessão do Claude Code desta conversa. */
  resumed?: boolean;
  refusal?: { category: string | null; explanation: string };
  /** Duração do turno e tokens informados pelo backend (status line). */
  ms?: number;
  usage?: { prompt: number; completion: number };
  /** Quem respondeu de fato (X-Provider). */
  provider?: string;
  /** Houve fallback de provedor neste turno (aviso do backend), para ficar gravado na mensagem. */
  fallback?: string;
}

export type ErrorKind = "backend" | "unknown";

export interface ErrorEvent {
  conversationId: string;
  kind: ErrorKind;
  message: string;
  /** Código que o backend da máquina mandou (model_limit, conta_limite, auth…), quando mandou. */
  code?: string;
}

export interface ConversationRef {
  conversationId: string;
}

/** Atividade do agente vinda do backend (x_meu_bot.tool): uso de ferramenta ou resultado. */
export type ToolEvent =
  | { kind: "use"; name: string; summary: string }
  | { kind: "result"; name: string | null; ok: boolean; text: string };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Quem produziu a resposta de fato (X-Provider do backend): "agente", "ollama-local"… Só nas de assistant. */
  provider?: string;
  /** Houve fallback de provedor neste turno: o aviso do backend, guardado ("agente falhou (…); respondendo com ollama-local"). */
  fallback?: string;
}

export interface StoredConversationView {
  id: string;
  /** Nome dado pelo usuário; ausente = título automático pela primeira mensagem. */
  title?: string;
  model: BackendModel;
  /** Host SSH (máquina) desta conversa; fixo desde a criação. */
  host: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  /** Posição da aba; menor fica mais à esquerda. */
  order: number;
  archived: boolean;
  /** Está aberta como aba (fechar a aba não apaga a conversa). */
  openAsTab: boolean;
  branchedFrom?: { id: string; index: number };
  /** Trazida de uma conversa do WhatsApp. */
  fromWhatsapp?: WhatsappOrigin;
  /** O trecho trazido ainda não foi ao agente (vai com a primeira mensagem). */
  pendingNote?: string;
}
export type TabMenuAction = "rename" | "duplicate" | "export-md" | "export-json" | "copy-ref" | "archive" | "unarchive" | "close" | "delete";
/** Sessão do Claude Code por trás de uma conversa do app (vem do backend; é o .jsonl na máquina). */
export interface ClaudeSessionRef { sessionId: string; file: string; profile: string }
export type ExportFormat = "md" | "json";
