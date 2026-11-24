/**
 * Variante: admin. Conversas da pessoa com o meu-bot, lidas da máquina dela: o backend roda cada turno pelo
 * Claude Code (com --resume), e o Claude Code grava a transcrição em ~/.claude/projects/<cwd>/<sessão>.jsonl.
 * Aqui só o puro: a lista a partir do que o script remoto imprime (uma linha por sessão) e a thread a partir
 * das linhas `user`/`assistant` do jsonl (o resto do arquivo é ruído: pedidos à API, anexos, filas). Testado.
 */
import type { BotChat, BotMessage } from "../../shared/ipc";

export const SESSION_ID_RE = /^[0-9a-f-]{8,64}$/;
export const PROJECT_DIR_RE = /^[A-Za-z0-9._-]{1,120}$/;
/** Id de conversa do app (diário do backend para os provedores fora do Claude Code): o mesmo CONV_ID_RE do server.js. */
export const APP_CONV_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
/** Pasta do diário na máquina (o backend grava; o admin lê). */
export const APP_CONVERSAS_DIR = "$HOME/.local/share/meu-bot/conversas";
export const isBotChatId = (id: string): boolean => SESSION_ID_RE.test(id) || APP_CONV_ID_RE.test(id);

/** Primeira mensagem da pessoa vira título: sem o "User: " que o backend põe, numa linha, curto. */
export function botChatTitle(firstUser: string): string {
  const t = firstUser.replace(/^\s*User:\s*/i, "").replace(/\s+/g, " ").trim();
  return t === "" ? "(sem texto)" : t.length > 90 ? `${t.slice(0, 89)}…` : t;
}

/** Texto de uma mensagem do jsonl: string ou blocos de texto; tool_result conta como "resultado de ferramenta". */
function textOf(content: unknown): { text: string; tools: string[] } {
  if (typeof content === "string") return { text: content, tools: [] };
  const parts: string[] = []; const tools: string[] = [];
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b === null || typeof b !== "object") continue;
      const o = b as { type?: unknown; text?: unknown; name?: unknown };
      if (o.type === "text" && typeof o.text === "string") parts.push(o.text);
      else if (o.type === "tool_use" && typeof o.name === "string") tools.push(o.name);
    }
  }
  return { text: parts.join("\n").trim(), tools };
}

/**
 * Linhas `F\t<sessão>\t<mtime unix>\t<pasta do projeto>\t<nº de respostas>\t<1ª linha user do jsonl>` → lista,
 * mais recente primeiro. Linhas que não casam são ignoradas (vêm de fora).
 */
export function parseBotChatList(stdout: string): BotChat[] {
  const out: BotChat[] = [];
  for (const line of stdout.split("\n")) {
    const [tag, id, mtime, dir, replies, first = ""] = line.split("\t");
    // `A\t<id da conversa>\t<mtime>\t<provedor>\t<nº de respostas>\t<1ª linha user>`: o diário do backend (provedores fora do Claude Code).
    if (tag === "A" && id !== undefined && mtime !== undefined && dir !== undefined && APP_CONV_ID_RE.test(id)) {
      const t = Number(mtime); if (!Number.isFinite(t) || t <= 0) continue;
      let firstText = "";
      try { const o = JSON.parse(first) as { text?: unknown }; firstText = typeof o.text === "string" ? o.text : ""; } catch { firstText = ""; }
      if (firstText === "") continue;
      const provider = /^[A-Za-z0-9._-]{1,40}$/.test(dir) ? dir : "";
      out.push({ sessionId: id, project: "conversas", title: botChatTitle(firstText), updatedAt: new Date(t * 1000).toISOString(), replies: Number(replies) || 0, source: "app", ...(provider === "" ? {} : { provider }) });
      continue;
    }
    if (tag !== "F" || id === undefined || mtime === undefined || dir === undefined || !SESSION_ID_RE.test(id) || !PROJECT_DIR_RE.test(dir)) continue;
    const t = Number(mtime); if (!Number.isFinite(t) || t <= 0) continue;
    let firstText = "";
    try { const o = JSON.parse(first) as { message?: { content?: unknown } }; firstText = textOf(o.message?.content).text; } catch { firstText = ""; }
    if (firstText === "") continue; // sessão sem fala da pessoa (só ruído): não é conversa
    out.push({ sessionId: id, project: dir, title: botChatTitle(firstText), updatedAt: new Date(t * 1000).toISOString(), replies: Number(replies) || 0, source: "claude" });
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** Linhas `user`/`assistant` do jsonl → mensagens em ordem. Ferramentas viram uma linha "ferramenta" por uso. */
export function parseClaudeTranscript(text: string): BotMessage[] {
  const out: BotMessage[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let o: { type?: unknown; timestamp?: unknown; message?: { role?: unknown; content?: unknown } };
    try { o = JSON.parse(line) as typeof o; } catch { continue; }
    if (o.type !== "user" && o.type !== "assistant") continue;
    const at = typeof o.timestamp === "string" ? o.timestamp : "";
    const { text: t, tools } = textOf(o.message?.content);
    if (o.type === "user") {
      const clean = t.replace(/^\s*User:\s*/i, "").trim();
      if (clean !== "") out.push({ role: "person", text: clean, at });
    } else {
      for (const name of tools) out.push({ role: "tool", text: name, at });
      if (t !== "") out.push({ role: "agent", text: t, at });
    }
  }
  return out;
}

/** Diário do backend (uma linha JSON por mensagem: {at, role, model, provider, text}) → mensagens em ordem. */
export function parseAppTranscript(text: string): BotMessage[] {
  const out: BotMessage[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let o: { at?: unknown; role?: unknown; provider?: unknown; text?: unknown };
    try { o = JSON.parse(line) as typeof o; } catch { continue; }
    if ((o.role !== "user" && o.role !== "assistant") || typeof o.text !== "string" || o.text.trim() === "") continue;
    const at = typeof o.at === "string" ? o.at : "";
    if (o.role === "user") out.push({ role: "person", text: o.text.trim(), at });
    else out.push({ role: "agent", text: o.text.trim(), at, ...(typeof o.provider === "string" && o.provider !== "" ? { provider: o.provider } : {}) });
  }
  return out;
}
