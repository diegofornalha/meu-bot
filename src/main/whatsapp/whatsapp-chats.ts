/**
 * Conversas do WhatsApp (OpenClaw) para o espelho só-leitura do app. Puro (sem IO): recebe o JSON que
 * `openclaw gateway call sessions.list` e `chat.history` devolvem e produz os tipos do contrato. É a fronteira
 * dona desses dados: o renderer nunca vê o formato do OpenClaw.
 *
 * Duas formas de sessão convivem: a principal (`agent:main:main`, dmScope padrão, todos os contatos
 * misturados) e as por contato (`…:whatsapp:<conta>:direct:+<número>`, com `session.dmScope =
 * per-channel-peer`). Um contato pode ter mensagens nas duas (antes e depois do isolamento).
 */
import type { WhatsappChat, WhatsappThreadMessage } from "../../shared/ipc";
import { quemOf, type QuemArg } from "./whatsapp-hermes-core";

const digits = (s: string): string => s.replace(/\D/g, "");
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Número do contato quando a sessão é por contato; senão null. O OpenClaw 2026.9.9 grava
 * `agent:main:whatsapp:direct:+5521…`; com várias contas entra a conta antes (`…:whatsapp:<conta>:direct:…`).
 */
export function peerOfSessionKey(key: string): string | null {
  const m = /:whatsapp:(?:[^:]+:)?direct:\+?(\d{8,15})$/.exec(key);
  return m === null ? null : m[1]!;
}

/**
 * Só as sessões de um agente (`agent:<id>:…`), para um gateway compartilhado: o `sessions.list` do gateway traz as
 * sessões de todos os usuários da máquina, e sem este filtro um veria as conversas do outro. Formato desconhecido
 * volta como veio (o parse seguinte o descarta).
 */
export function sessoesDoAgente(list: unknown, agentId: string): unknown {
  if (!isObj(list) || !Array.isArray(list.sessions)) return list;
  const prefixo = `agent:${agentId}:`;
  return { ...list, sessions: list.sessions.filter((s) => isObj(s) && typeof s.key === "string" && s.key.startsWith(prefixo)) };
}

/** Números de WhatsApp que participam de uma sessão (lista de `participants[].identity`). */
function participantNumbers(session: Record<string, unknown>): string[] {
  const out: string[] = [];
  const parts = Array.isArray(session.participants) ? session.participants : [];
  for (const p of parts) {
    const id = isObj(p) && isObj(p.identity) ? p.identity : null;
    if (id === null || id.pluginId !== "whatsapp" || typeof id.id !== "string") continue;
    const n = digits(id.id);
    if (n.length >= 8) out.push(n);
  }
  return out;
}

/**
 * Lista de conversas a partir do `sessions.list`. Junta por número; `updatedAt` = sessão mais recente do
 * contato. `names` traz o último `senderName` visto (cache do main); `self` marca o próprio aparelho;
 * `pausedNumbers` = pausados pela lista durável do openclaw.json (whatsapp-pause.ts).
 */
export function chatsFromSessions(list: unknown, quem: QuemArg, names: ReadonlyMap<string, string> = new Map(), pausedNumbers: ReadonlySet<string> = new Set()): WhatsappChat[] {
  const sessions = isObj(list) && Array.isArray(list.sessions) ? list.sessions : [];
  const byNumber = new Map<string, { keys: string[]; ids: Record<string, string>; updated: number; paused: boolean }>();
  const q = quemOf(quem);
  const selfN = q.self === null ? null : digits(q.self);
  const donoN = q.dono === null ? null : digits(q.dono);
  for (const s of sessions) {
    if (!isObj(s) || typeof s.key !== "string") continue;
    // Sessão de grupo é do grupo (área "Grupos"), nunca de um contato: senão "Limpar histórico" de quem fala no grupo
    // zerava a memória do agente no grupo inteiro.
    if (/:whatsapp:(?:[^:]+:)?group:/.test(s.key) || s.chatType === "group") continue;
    const peer = peerOfSessionKey(s.key);
    // Na sessão principal o próprio aparelho aparece como participante mesmo sem mensagens (avisos do gateway):
    // fica de fora; conversa consigo mesmo ganha sessão própria com o isolamento por contato.
    const numbers = peer !== null ? [peer] : participantNumbers(s).filter((n) => n !== selfN);
    const updated = typeof s.updatedAt === "number" ? s.updatedAt : 0;
    for (const n of numbers) {
      const cur = byNumber.get(n) ?? { keys: [], ids: {}, updated: 0, paused: false };
      if (!cur.keys.includes(s.key)) cur.keys.push(s.key);
      // UUID interno da sessão (troca a cada "Limpar"): só para "Copiar ID".
      if (typeof s.sessionId === "string" && /^[A-Za-z0-9-]{8,80}$/.test(s.sessionId)) cur.ids[s.key] = s.sessionId;
      // Pausa = envio negado na sessão só do contato (a principal nunca é pausada pelo app).
      if (peer !== null && s.sendPolicy === "deny") cur.paused = true;
      cur.updated = Math.max(cur.updated, updated);
      byNumber.set(n, cur);
    }
  }
  return [...byNumber.entries()]
    .map(([number, v]) => ({
      number, name: names.get(number) ?? null, isSelf: number === selfN, isDono: number === donoN && donoN !== selfN, sessionKeys: v.keys, sessionIds: v.ids,
      ownSession: v.keys.some((k) => peerOfSessionKey(k) === number), paused: v.paused || pausedNumbers.has(number), updatedAt: new Date(v.updated).toISOString(),
      // Arquivado/excluído/apelido vêm do whatsapp-lista.json da máquina (whatsapp-marks.ts aplica depois).
      alias: null, archived: false, deleted: false,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Partes que são mídia de verdade; chamadas de ferramenta, resultados e raciocínio não são. */
const MEDIA_PARTS = new Set(["image", "audio", "video", "document", "file", "sticker", "media"]);

/** Texto de uma mensagem: string, ou partes `{type:"text", text}`; só mídia (sem texto) vira "[mídia]". */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  let media = false;
  for (const p of content) {
    if (!isObj(p)) continue;
    if (p.type === "text" && typeof p.text === "string") texts.push(p.text);
    else if (typeof p.type === "string" && MEDIA_PARTS.has(p.type)) media = true;
  }
  return texts.length > 0 ? texts.join("\n") : media ? "[mídia]" : "";
}

/**
 * Resposta em voz: o agente chamou a ferramenta de TTS do OpenClaw (`mcp__openclaw__tts`) com o texto falado, e
 * o `tool_result` confirma "(spoken) …". É uma resposta entregue (o áudio foi ao WhatsApp) mesmo com
 * `stopReason: "tool_use"` e sem `runId`: sem isto, o espelho não via a resposta e o balão de "digitando" ficava
 * preso. Devolve o texto falado, ou null se não é uma resposta em voz.
 */
export function spokenText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const calls = new Map<string, string>();
  for (const p of content) {
    if (!isObj(p) || p.type !== "toolcall" || typeof p.name !== "string" || !/(^|_)tts$/.test(p.name)) continue;
    const args = isObj(p.arguments) ? p.arguments : {};
    if (typeof args.text === "string" && args.text.trim() !== "") calls.set(typeof p.id === "string" ? p.id : "", args.text.trim());
  }
  if (calls.size === 0) return null;
  for (const p of content) {
    if (!isObj(p) || p.type !== "tool_result") continue;
    const id = typeof p.tool_use_id === "string" ? p.tool_use_id : "";
    const res = textOf(p.content);
    if (/^\(spoken\)/.test(res) && (calls.has(id) || calls.has(""))) return calls.get(id) ?? calls.get("") ?? null;
  }
  return null;
}

/**
 * Resposta que foi ao WhatsApp. Com o backend claude-cli, a entregue é a da execução (`__openclaw.runId`);
 * as importadas do CLI sem `runId` são o rascunho interno (ferramentas, textos intermediários) e nunca saem
 * do agente. Parada por ferramenta (`stopReason: "tool_use"`) também é meio de turno.
 */
export function isDelivered(m: Record<string, unknown>): boolean {
  const meta = isObj(m.__openclaw) ? m.__openclaw : {};
  if (m.stopReason === "tool_use") return false;
  return !(meta.importedFrom === "claude-cli" && typeof meta.runId !== "string");
}

export interface SessionHistory { sessionKey: string; history: unknown }
export interface Thread { messages: WhatsappThreadMessage[]; name: string | null }

/**
 * Histórico de um contato. Na sessão por contato, tudo é dele; na principal, só as mensagens com
 * `senderId` = número e as respostas do agente que vêm logo depois (até outro remetente ou um aviso de
 * sistema). Descarta avisos de sistema (sem `senderId`), `NO_REPLY` e respostas vazias (`tool_use`).
 */
export function threadFor(number: string, histories: readonly SessionHistory[]): Thread {
  const want = digits(number);
  const out: WhatsappThreadMessage[] = [];
  let name: string | null = null;
  for (const { sessionKey, history } of histories) {
    const perPeer = peerOfSessionKey(sessionKey) === want;
    const messages = isObj(history) && Array.isArray(history.messages) ? history.messages : [];
    let current: string | null = perPeer ? want : null; // remetente da vez, para atribuir as respostas
    for (const m of messages) {
      if (!isObj(m)) continue;
      const at = typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString() : "";
      const text = textOf(m.content).trim();
      if (m.role === "user") {
        const meta = isObj(m.__openclaw) ? m.__openclaw : {};
        const sender = typeof meta.senderId === "string" ? digits(meta.senderId) : "";
        if (sender === "") { current = perPeer ? want : null; continue; } // aviso de sistema
        current = sender;
        if (sender !== want || text === "") continue;
        if (typeof meta.senderName === "string" && meta.senderName !== "") name = meta.senderName;
        out.push({ role: "contact", text, at });
      } else if (m.role === "assistant") {
        if (current !== want) continue;
        const spoken = spokenText(m.content);
        if (spoken !== null) { out.push({ role: "agent", text: `🎙️ ${spoken}`, at }); continue; }
        if (text === "" || text === "NO_REPLY" || !isDelivered(m)) continue;
        out.push({ role: "agent", text, at });
      }
    }
  }
  // Mesma mensagem não pode vir duas vezes (sessões sobrepostas): chave = papel + hora + texto.
  const seen = new Set<string>();
  const unique = out.filter((m) => { const k = `${m.role}|${m.at}|${m.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  unique.sort((a, b) => a.at.localeCompare(b.at));
  return { messages: unique, name };
}

/** Teto do trecho levado ao meu-bot: as mensagens mais recentes que cabem; as antigas viram uma contagem. */
export const CONTEXT_MAX_CHARS = 24_000;

export interface WhatsappContext { note: string; count: number; omitted: number }

/** "2026-10-15T17:32:00Z" → "15/10 14:32" no fuso local. */
const stamp = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * Nota que leva um trecho do WhatsApp para uma conversa do meu-bot. Vai junto da primeira mensagem da
 * pessoa (como a nota de troca de modelo): o agente sabe que é contexto trazido, não fala do usuário.
 */
export function whatsappContextNote(contact: string, number: string, messages: readonly WhatsappThreadMessage[]): WhatsappContext {
  const lines = messages.map((m) => `[${stamp(m.at)}] ${m.role === "contact" ? contact : "Agente"}: ${m.text}`);
  let size = 0;
  let first = lines.length;
  while (first > 0 && size + lines[first - 1]!.length + 1 <= CONTEXT_MAX_CHARS) size += lines[--first]!.length + 1;
  if (first === lines.length && lines.length > 0) { first = lines.length - 1; lines[first] = lines[first]!.slice(0, CONTEXT_MAX_CHARS); }
  const kept = lines.slice(first);
  const head = `[Nota do app meu-bot, não é fala do usuário: o usuário trouxe para esta conversa um trecho do WhatsApp entre o contato ${contact} (+${digits(number)}) e o agente que atende esse número nesta máquina. Use como contexto para o que ele pedir; quem está no WhatsApp não vê esta conversa e nada aqui é enviado para lá.]`;
  const omitted = first > 0 ? `(${first} mensagens anteriores omitidas)\n` : "";
  return { note: `${head}\n\n--- conversa do WhatsApp ---\n${omitted}${kept.join("\n")}\n--- fim do trecho ---`, count: kept.length, omitted: first };
}

/** Sessões só deste contato (por contato); a principal, compartilhada com os outros, nunca entra. */
export const ownSessionKeys = (number: string, keys: readonly string[]): string[] =>
  keys.filter((k) => peerOfSessionKey(k) === digits(number));

/**
 * Saída dos scripts que chamam o gateway por sessão (`sessions.reset`, `sessions.patch`): uma linha
 * `R<TAB>chave<TAB>json` por chamada.
 * Devolve as chaves que não voltaram com `ok: true` (vazio = todas limpas).
 */
export function gatewayFailures(out: string, keys: readonly string[]): string[] {
  const ok = new Set<string>();
  for (const line of out.split("\n")) {
    const parts = line.split("\t");
    if (parts[0] !== "R" || parts.length < 3) continue;
    try { const r = JSON.parse(parts.slice(2).join("\t")) as unknown; if (isObj(r) && r.ok === true) ok.add(parts[1]!); } catch { /* falhou */ }
  }
  return keys.filter((k) => !ok.has(k));
}

/**
 * Chaves de sessão que podem entrar no script remoto (vão dentro de aspas simples, num JSON de --params). Só o
 * alfabeto que o próprio OpenClaw gera: grupo termina em "@g.us" e conversa direta traz "+" do E.164, então o
 * "@" faz parte do conjunto — sem ele toda sessão de grupo era descartada e parecia não existir.
 */
export const SAFE_KEY = /^[A-Za-z0-9:+._@-]{1,200}$/;

/** Markdown legível da conversa inteira do WhatsApp (exportar). */
export function threadToMarkdown(contact: string, number: string, host: string, messages: readonly WhatsappThreadMessage[], exportedAt: string): string {
  const day = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR"); };
  const lines = [`# WhatsApp: ${contact}`, "", `- Contato: ${contact} (+${digits(number)})`, `- Máquina: ${host}`, `- Mensagens: ${messages.length}`];
  if (messages.length > 0) lines.push(`- Período: ${stamp(messages[0]!.at)} a ${stamp(messages.at(-1)!.at)}`);
  lines.push(`- Exportada em: ${stamp(exportedAt)}`, "");
  let lastDay = "";
  for (const m of messages) {
    const d = day(m.at);
    if (d !== lastDay) { lines.push(`## ${d}`, ""); lastDay = d; }
    lines.push(`**${m.role === "contact" ? contact : "Agente"}** · ${stamp(m.at).slice(6)}`, "", m.text.trim(), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * Markdown da conversa de um grupo. Difere do de contato em duas coisas: identifica quem mandou cada mensagem
 * (`autor`, que `threadDoGrupo` já resolve para nome ou +número) e traz o jid no lugar do telefone.
 */
export function grupoToMarkdown(nome: string, jid: string, host: string, messages: readonly WhatsappThreadMessage[], exportedAt: string): string {
  const day = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR"); };
  const autores = new Set(messages.flatMap((m) => (m.role === "contact" && m.autor !== undefined ? [m.autor] : [])));
  const lines = [`# WhatsApp (grupo): ${nome}`, "", `- Grupo: ${nome} (${jid})`, `- Máquina: ${host}`, `- Mensagens: ${messages.length}`];
  if (autores.size > 0) lines.push(`- Quem falou: ${[...autores].join(", ")}`);
  if (messages.length > 0) lines.push(`- Período: ${stamp(messages[0]!.at)} a ${stamp(messages.at(-1)!.at)}`);
  lines.push(`- Exportada em: ${stamp(exportedAt)}`, "");
  let lastDay = "";
  for (const m of messages) {
    const d = day(m.at);
    if (d !== lastDay) { lines.push(`## ${d}`, ""); lastDay = d; }
    lines.push(`**${m.role === "agent" ? "Agente" : m.autor ?? "Alguém"}** · ${stamp(m.at).slice(6)}`, "", m.text.trim(), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Linha "POLICY=… ALLOW=[…]" que o setDmPolicy relê da máquina depois de gravar; null se não veio. */
export function politicaGravada(stdout: string): { dmPolicy: string; allowFrom: string[] } | null {
  const m = /POLICY=(\S*) ALLOW=(\[.*\])/.exec(stdout);
  if (m === null) return null;
  try { const a = JSON.parse(m[2]!) as unknown; return { dmPolicy: m[1]!, allowFrom: Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [] }; } catch { return null; }
}
/** O que ficou gravado não bate com a escolha? Devolve o motivo (open sem "*" descarta tudo), ou null se bate. */
export function politicaNaoBate(escolha: "open" | "self" | "list", g: { dmPolicy: string; allowFrom: string[] }): string | null {
  if (escolha === "open") return g.dmPolicy !== "open" ? `dmPolicy ficou "${g.dmPolicy}"` : g.allowFrom.includes("*") ? null : "allowFrom sem \"*\" (todas as mensagens seriam descartadas)";
  return g.dmPolicy === "allowlist" ? null : `dmPolicy ficou "${g.dmPolicy}"`;
}
