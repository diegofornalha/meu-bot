import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ClaudeSessionRef, BackendModel, WhatsappOrigin, WhatsappThreadMessage } from "../../shared/ipc";
import { getBackendModel, getLastHost, isBackendModel, isValidHost } from "../app/settings";
import { trocaPendente } from "../../shared/modelos";
import { LOCAL_HOST } from "../maquina/localBackend";
import { nextOrderAmong, reorderWithin } from "./order";
import type { SummaryState } from "./context";

export interface BackendMessage {
  role: "user" | "assistant";
  content: string;
  /** Linha de contexto injetada pelo app (ex.: troca de modelo). Vai ao backend junto do conteúdo; nunca aparece na tela. */
  note?: string;
  /** Quem respondeu de fato (X-Provider). Só nas de assistant; não vai ao backend. */
  provider?: string;
  /** Aviso de fallback do backend neste turno, guardado para a tela. Não vai ao backend. */
  fallback?: string;
}

export interface Conversation {
  id: string;
  title?: string;
  /** Modelo do backend usado nesta conversa. */
  model: BackendModel;
  /** Host SSH (máquina) desta conversa; fixo desde a criação. */
  host: string;
  /** Histórico no formato OpenAI-compatível do backend. */
  backendMessages: BackendMessage[];
  /** Troca de modelo ainda não comunicada ao backend; vira nota na próxima mensagem. Transitório. */
  pendingSwitch?: { from: BackendModel; to: BackendModel };
  createdAt: string;
  updatedAt: string;
  /** Posição da aba; menor fica mais à esquerda. */
  order: number;
  archived: boolean;
  /** Aberta como aba; fechar a aba não apaga a conversa. */
  openAsTab: boolean;
  branchedFrom?: { id: string; index: number };
  /** Trazida de uma conversa do WhatsApp ("Ramificar daqui" no espelho). */
  fromWhatsapp?: WhatsappOrigin;
  /** Contexto trazido que ainda não foi ao backend; vira nota da próxima mensagem da pessoa. */
  pendingNote?: string;
  /** Sessão do Claude Code na máquina (o .jsonl), lida do backend depois de um turno; para "Copiar ID". */
  claude?: ClaudeSessionRef;
  /** Resumo do meio da conversa, gerado em background. */
  summary?: SummaryState;
  /** Turnos do usuário desde a última extração de memória. */
  userTurnsSinceMemory: number;
  /** Quantas mensagens do histórico a sessão do backend já conhece (retomada de sessão). */
  serverSeen: number;
  /** O último turno foi retomado no servidor (então não precisa resumir no cliente). */
  lastResumed: boolean;
  /** Há um resumo sendo gerado agora. */
  summarizing: boolean;
  /** Cancela o turno em andamento (botão Parar). */
  abort?: AbortController;
  busy: boolean;
  /** Conversa excluída: um turno em andamento descarta a resposta. */
  closed: boolean;
}

/** Forma gravada em disco e enviada ao renderer na abertura. */
export interface StoredConversation {
  id: string;
  title?: string;
  model: BackendModel;
  host: string;
  messages: BackendMessage[];
  createdAt: string;
  updatedAt: string;
  order: number;
  archived: boolean;
  openAsTab: boolean;
  branchedFrom?: { id: string; index: number };
  fromWhatsapp?: WhatsappOrigin;
  pendingNote?: string;
  claude?: ClaudeSessionRef;
  summary?: SummaryState;
  userTurnsSinceMemory?: number;
  serverSeen?: number;
}

/** Uma conversa por aba, identificada pelo id que o renderer recebe. */
const conversations = new Map<string, Conversation>();
let counter = 0;

const storePath = (): string => path.join(app.getPath("userData"), "conversations.json");
const newId = (): string => `${new Date().toISOString().replace(/[:.]/g, "-")}-${++counter}`;

const toStored = (c: Conversation): StoredConversation => ({
  id: c.id, ...(c.title === undefined ? {} : { title: c.title }), model: c.model, host: c.host,
  messages: c.backendMessages, createdAt: c.createdAt, updatedAt: c.updatedAt, order: c.order,
  archived: c.archived, openAsTab: c.openAsTab,
  ...(c.branchedFrom === undefined ? {} : { branchedFrom: c.branchedFrom }),
  ...(c.fromWhatsapp === undefined ? {} : { fromWhatsapp: c.fromWhatsapp }),
  ...(c.pendingNote === undefined ? {} : { pendingNote: c.pendingNote }),
  ...(c.claude === undefined ? {} : { claude: c.claude }),
  ...(c.summary === undefined ? {} : { summary: c.summary }),
  userTurnsSinceMemory: c.userTurnsSinceMemory,
  serverSeen: c.serverSeen,
});

const validSummary = (v: unknown, length: number): SummaryState | undefined => {
  const s = v as Partial<SummaryState> | undefined;
  if (s === undefined || s === null || typeof s.text !== "string" || typeof s.coveredUntil !== "number" || s.coveredUntil > length) return undefined;
  return { text: s.text, coveredUntil: s.coveredUntil, updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : "" };
};

/** Ordem é por máquina: cada janela reordena só as suas abas. */
const nextOrder = (host: string): number => nextOrderAmong([...conversations.values()].filter((c) => c.host === host).map((c) => c.order));

/** Reordena pelas ids recebidas, só entre conversas da máquina; desconhecidas ignoradas, ausentes vão para o fim. */
export function reorderConversations(ids: string[], host: string): void {
  const orders = reorderWithin([...conversations.values()].map((c) => ({ id: c.id, host: c.host, order: c.order })), ids, host);
  for (const [id, order] of orders) { const c = conversations.get(id); if (c !== undefined) c.order = order; }
  persistConversations();
}

const MAX_TITLE = 60;

export function renameConversation(id: string, title: string): void {
  const conv = conversations.get(id);
  if (conv === undefined) return;
  const clean = title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  if (clean === "") delete conv.title;
  else conv.title = clean;
  persistConversations();
}

/** Grava todas as conversas de uma vez, atomicamente. Pequeno o bastante para isso. */
export function persistConversations(): void {
  try {
    const target = storePath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const list = [...conversations.values()].map(toStored);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, conversations: list }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch {
    /* persistência é cortesia; nunca derruba o chat */
  }
}

/** Mensagens do WhatsApp gravadas na conversa; formato inválido fica de fora (a aba só não mostra o trecho). */
function waMessages(v: unknown): { messages?: WhatsappThreadMessage[] } {
  if (!Array.isArray(v)) return {};
  const messages = v.filter((m): m is WhatsappThreadMessage => m !== null && typeof m === "object"
    && (m.role === "contact" || m.role === "agent") && typeof m.text === "string" && typeof m.at === "string")
    .map((m) => ({ role: m.role, text: m.text, at: m.at }));
  return { messages };
}

/** Carrega o que foi salvo na última execução. Chamar uma vez, após app.whenReady(). */
export function loadConversations(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8")) as { conversations?: unknown };
    if (!Array.isArray(raw.conversations)) return;
    let fallbackOrder = 0;
    for (const item of raw.conversations as Partial<StoredConversation>[]) {
      if (typeof item.id !== "string" || !Array.isArray(item.messages)) continue;
      const order = typeof item.order === "number" && Number.isFinite(item.order) ? item.order : fallbackOrder;
      fallbackOrder = Math.max(fallbackOrder, order) + 1;
      const messages = item.messages.filter(
        (m): m is BackendMessage => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string",
      ).map((m): BackendMessage => ({
        role: m.role, content: m.content,
        ...(typeof m.note === "string" ? { note: m.note } : {}),
        ...(typeof m.provider === "string" && m.provider !== "" ? { provider: m.provider } : {}),
        ...(typeof m.fallback === "string" && m.fallback !== "" ? { fallback: m.fallback } : {}),
      }));
      const now = new Date().toISOString();
      const host = typeof item.host === "string" && isValidHost(item.host) ? item.host : (getLastHost() ?? LOCAL_HOST);
      conversations.set(item.id, {
        id: item.id, backendMessages: messages,
        model: isBackendModel(item.model) ? item.model : getBackendModel(host),
        host,
        ...(typeof item.title === "string" && item.title.trim() !== "" ? { title: item.title.slice(0, MAX_TITLE) } : {}),
        createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now,
        order,
        archived: item.archived === true,
        openAsTab: item.openAsTab !== false,
        ...(item.branchedFrom !== undefined && typeof item.branchedFrom === "object" && item.branchedFrom !== null
          && typeof item.branchedFrom.id === "string" && typeof item.branchedFrom.index === "number"
          ? { branchedFrom: { id: item.branchedFrom.id, index: item.branchedFrom.index } } : {}),
        ...((): { fromWhatsapp?: WhatsappOrigin } => {
          const w = item.fromWhatsapp as Partial<WhatsappOrigin> | undefined;
          return w !== undefined && w !== null && typeof w.number === "string" && typeof w.name === "string" && typeof w.count === "number" && typeof w.until === "string"
            ? { fromWhatsapp: { number: w.number, name: w.name, count: w.count, until: w.until, ...waMessages(w.messages) } } : {};
        })(),
        ...(typeof item.pendingNote === "string" && item.pendingNote !== "" ? { pendingNote: item.pendingNote } : {}),
        ...((): { claude?: ClaudeSessionRef } => {
          const c = item.claude as Partial<ClaudeSessionRef> | undefined;
          return c !== undefined && c !== null && typeof c.sessionId === "string" && typeof c.file === "string" && typeof c.profile === "string" ? { claude: { sessionId: c.sessionId, file: c.file, profile: c.profile } } : {};
        })(),
        ...((): { summary?: SummaryState } => { const sm = validSummary(item.summary, messages.length); return sm === undefined ? {} : { summary: sm }; })(),
        userTurnsSinceMemory: typeof item.userTurnsSinceMemory === "number" ? item.userTurnsSinceMemory : 0,
        serverSeen: typeof item.serverSeen === "number" && item.serverSeen <= messages.length ? item.serverSeen : 0,
        lastResumed: false,
        summarizing: false,
        busy: false, closed: false,
      });
    }
  } catch {
    /* sem arquivo ou inválido: começa vazio */
  }
}

export function createConversation(host: string, model: BackendModel = getBackendModel(host)): Conversation {
  const now = new Date().toISOString();
  const conv: Conversation = {
    id: newId(), model, host, backendMessages: [], createdAt: now, updatedAt: now, order: nextOrder(host),
    archived: false, openAsTab: true, userTurnsSinceMemory: 0, serverSeen: 0, lastResumed: false, summarizing: false, busy: false, closed: false,
  };
  conversations.set(conv.id, conv);
  persistConversations();
  return conv;
}

export const getConversation = (id: string): Conversation | undefined => conversations.get(id);

/** Troca o modelo da conversa; um turno em andamento continua no modelo com que começou. */
export function setConversationModel(id: string, model: BackendModel): void {
  const conv = conversations.get(id);
  if (conv === undefined || !isBackendModel(model)) return;
  if (conv.model === model) return;
  // Com histórico, o próximo turno avisa o novo modelo de quem respondeu antes (senão ele assume que foi ele).
  const troca = trocaPendente(conv.model, model, conv.pendingSwitch, conv.backendMessages.length > 0);
  if (troca === undefined) delete conv.pendingSwitch; else conv.pendingSwitch = troca;
  conv.model = model;
  persistConversations();
}

/** Alguma conversa aguardando resposta do backend. */
export const anyConversationBusy = (): boolean => [...conversations.values()].some((c) => c.busy);

/** Alguma conversa da máquina em turno ou resumo (o túnel não deve cair). */
export const hostBusy = (host: string): boolean => [...conversations.values()].some((c) => c.host === host && (c.busy || c.summarizing));

export const getStoredConversation = (id: string): StoredConversation | undefined => {
  const conv = conversations.get(id);
  return conv === undefined ? undefined : toStored(conv);
};

/** Fechar a aba: a conversa continua na lista lateral. */
export function closeTab(id: string): void {
  const conv = conversations.get(id);
  if (conv === undefined) return;
  conv.openAsTab = false;
  persistConversations();
}

/** Abrir como aba (desarquiva se preciso) e devolver a conversa. */
export function openConversation(id: string): StoredConversation | undefined {
  const conv = conversations.get(id);
  if (conv === undefined) return undefined;
  conv.openAsTab = true;
  conv.archived = false;
  persistConversations();
  return toStored(conv);
}

export function archiveConversation(id: string, archived: boolean): void {
  const conv = conversations.get(id);
  if (conv === undefined) return;
  conv.archived = archived;
  if (archived) conv.openAsTab = false;
  persistConversations();
}

const copyTitleBase = (conv: Conversation): string => {
  const base = conv.title ?? conv.backendMessages.find((m) => m.role === "user")?.content ?? "Conversa";
  return base.replace(/\s+/g, " ").trim().slice(0, 40);
};

function cloneFrom(conv: Conversation, messages: BackendMessage[], title: string, branchedFrom?: { id: string; index: number }): Conversation {
  const now = new Date().toISOString();
  const copy: Conversation = {
    id: newId(), model: conv.model, host: conv.host, title: title.slice(0, MAX_TITLE),
    backendMessages: messages.map((m) => ({ ...m })), createdAt: now, updatedAt: now, order: nextOrder(conv.host),
    archived: false, openAsTab: true, userTurnsSinceMemory: 0, serverSeen: 0, lastResumed: false, summarizing: false, busy: false, closed: false,
    ...(branchedFrom === undefined ? {} : { branchedFrom }),
  };
  conversations.set(copy.id, copy);
  persistConversations();
  return copy;
}

export function duplicateConversation(id: string): StoredConversation | undefined {
  const conv = conversations.get(id);
  if (conv === undefined || conv.busy) return undefined;
  return toStored(cloneFrom(conv, conv.backendMessages, `${copyTitleBase(conv)} (cópia)`));
}

/** Ramifica a partir da mensagem `index` (inclusive). */
export function branchConversation(id: string, index: number): StoredConversation | undefined {
  const conv = conversations.get(id);
  if (conv === undefined || conv.busy) return undefined;
  if (!Number.isInteger(index) || index < 0 || index >= conv.backendMessages.length) return undefined;
  return toStored(cloneFrom(conv, conv.backendMessages.slice(0, index + 1), `Ramo de ${copyTitleBase(conv)}`, { id, index }));
}

/** Conversa nova com um trecho do WhatsApp como contexto (vai como nota na primeira mensagem da pessoa). */
export function createFromWhatsapp(host: string, origin: WhatsappOrigin, note: string): StoredConversation {
  const conv = createConversation(host);
  conv.title = `WhatsApp: ${origin.name}`.slice(0, MAX_TITLE);
  conv.fromWhatsapp = origin;
  conv.pendingNote = note;
  persistConversations();
  return toStored(conv);
}

/** Conversas de uma máquina, em ordem de aba e criação. */
export function listConversationsForHost(host: string): StoredConversation[] {
  return [...conversations.values()].filter((c) => c.host === host)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)).map(toStored);
}

export function touchConversation(conv: Conversation): void {
  conv.updatedAt = new Date().toISOString();
  persistConversations();
}

export function dropConversation(id: string): void {
  const conv = conversations.get(id);
  if (conv === undefined) return;
  conv.closed = true;
  conv.abort?.abort();
  conversations.delete(id);
  persistConversations();
}

/** Transcript em disco, só para consulta do usuário. Falhas são ignoradas. */
export function saveTranscript(conv: Conversation): void {
  touchConversation(conv);
  try {
    const dir = path.join(app.getPath("userData"), "transcripts");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${conv.id}.json`), JSON.stringify(conv.backendMessages, null, 2), { mode: 0o600 });
  } catch {
    /* transcript é cortesia; nunca derruba o chat */
  }
}
