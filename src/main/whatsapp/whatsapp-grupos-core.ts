/**
 * Grupos do WhatsApp (OpenClaw) para a área "Grupos" da lista e o tutorial 11. Puro (sem IO): recebe o
 * `sessions.list`, o `channels.whatsapp` do openclaw.json e o cache da skill whatsapp-grupos
 * (`data/grupos-live.json`) e é o dono das regras de grupo do app, as mesmas do `habilitar.py` da skill:
 *
 * - ligar põe `groupPolicy: "allowlist"` e `groups[jid] = { requireMention }`;
 * - desligar o último grupo volta a `groupPolicy: "disabled"` e apaga `groups` (groups vazio com a política
 *   ligada admite TODOS os grupos da conta);
 * - `groupAllowFrom` (quem aciona, vale para todos os grupos ligados) nunca fica vazio com o agente ligado: sem
 *   ele o OpenClaw cai no `allowFrom` das conversas diretas, que com "todo mundo" é `["*"]`;
 * - "todos do grupo" é `groupPolicy: "open"`, nunca um "*" na lista.
 */
import type { WhatsappGroup, WhatsappGroupAgent, WhatsappGroupPatch, WhatsappGroups, WhatsappThreadMessage } from "../../shared/ipc";
import { isDelivered, spokenText, textOf } from "./whatsapp-chats";

const digits = (s: string): string => s.replace(/\D/g, "");
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Jid de grupo (o mesmo formato que o habilitar.py aceita). Todo jid que chega pelo IPC passa por aqui. */
export const JID_RE = /^\d{10,25}(-\d+)?@g\.us$/;
/** Número E.164 de quem aciona (só dígitos, com DDI). */
const NUMERO_RE = /^\d{10,15}$/;

/** Jid do grupo quando a sessão é de grupo (`agent:main:whatsapp[:<conta>]:group:<jid>`); senão null. */
export function groupOfSessionKey(key: string): string | null {
  const m = /:whatsapp:(?:[^:]+:)?group:(\d{10,25}(?:-\d+)?@g\.us)$/.exec(key);
  return m === null ? null : m[1]!;
}

interface CacheGrupo { jid: string; nome: string; membros: number; participantes: string[] }
/** Cache da skill: `{ atualizadoEm, conta, grupos: [{ jid, nome, membros, participantes: [{ jid, phone }] }] }`. */
export function parseCacheGrupos(cache: unknown): { em: string | null; grupos: CacheGrupo[] } {
  if (!isObj(cache) || !Array.isArray(cache.grupos)) return { em: null, grupos: [] };
  const grupos: CacheGrupo[] = [];
  for (const g of cache.grupos) {
    if (!isObj(g) || typeof g.jid !== "string" || !JID_RE.test(g.jid)) continue;
    const parts = Array.isArray(g.participantes) ? g.participantes : [];
    const nums = parts.flatMap((p) => {
      const ph = isObj(p) ? (typeof p.phone === "string" ? p.phone : typeof p.jid === "string" && p.jid.endsWith("@s.whatsapp.net") ? p.jid : "") : "";
      const n = digits(ph.split("@")[0] ?? "");
      return NUMERO_RE.test(n) ? [n] : [];
    });
    grupos.push({ jid: g.jid, nome: typeof g.nome === "string" ? g.nome : "", membros: typeof g.membros === "number" ? g.membros : parts.length, participantes: nums });
  }
  return { em: typeof cache.atualizadoEm === "string" ? cache.atualizadoEm : null, grupos };
}

const numerosDe = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Como o agente fica num grupo, pela config. */
function agenteDe(wa: Record<string, unknown>, jid: string): WhatsappGroupAgent {
  const policy = typeof wa.groupPolicy === "string" ? wa.groupPolicy : "allowlist";
  if (policy === "disabled") return "desligado";
  const groups = isObj(wa.groups) ? wa.groups : null;
  // Sem `groups` (ou vazio) com a política ligada, o OpenClaw admite todos os grupos; "*" também.
  const g = groups === null || Object.keys(groups).length === 0 ? {} : isObj(groups[jid]) ? groups[jid] : isObj(groups["*"]) ? groups["*"] : null;
  if (g === null) return "desligado";
  return (g as Record<string, unknown>).requireMention === false ? "sempre" : "mencao";
}

/** Quem aciona o agente nos grupos: groupAllowFrom; sem ele, o allowFrom das diretas (herdado). */
export function quemAcionaDe(wa: Record<string, unknown>): { quem: string[] | "todos"; herdado: boolean } {
  if (wa.groupPolicy === "open") return { quem: "todos", herdado: false };
  const gaf = numerosDe(wa.groupAllowFrom);
  const herdado = gaf.length === 0;
  const lista = herdado ? numerosDe(wa.allowFrom) : gaf;
  if (lista.includes("*")) return { quem: "todos", herdado };
  return { quem: [...new Set(lista.map(digits).filter((n) => NUMERO_RE.test(n)))], herdado };
}

/**
 * Grupos da máquina: junta a sessão (houve conversa), a config (o agente está ligado) e o cache (nome e membros
 * mesmo sem conversa). Ordem: com agente ligado primeiro, depois pela conversa mais recente, depois pelo nome.
 */
/** Sessões de grupo lidas do banco do OpenClaw (só leitura): chave → UUID, transcrição do Claude Code, assunto e hora. */
export interface SessaoDoBanco { sessionId?: unknown; jsonl?: unknown; subject?: unknown; updatedAt?: unknown; respondeu?: unknown }
const UUID_RE = /^[A-Za-z0-9-]{8,80}$/;
const JSONL_RE = /^~\/\.claude\/projects\/[A-Za-z0-9._-]+\/[A-Za-z0-9-]{8,80}\.jsonl$/;

export function gruposDaMaquina(list: unknown, waConfig: unknown, cache: unknown, self: string | null = null, banco: unknown = null): WhatsappGroups {
  const wa = isObj(waConfig) ? waConfig : {};
  const c = parseCacheGrupos(cache);
  const byJid = new Map<string, WhatsappGroup>();
  const get = (jid: string): WhatsappGroup => {
    let g = byJid.get(jid);
    if (g === undefined) { g = { jid, nome: null, apelido: null, membros: null, participantes: [], agente: "desligado", sessionKey: null, sessionId: null, transcript: null, updatedAt: null, agenteRespondeu: false, deleted: false }; byJid.set(jid, g); }
    return g;
  };
  for (const e of c.grupos) { const g = get(e.jid); g.nome = e.nome || null; g.membros = e.membros; g.participantes = e.participantes; }
  const sessions = isObj(list) && Array.isArray(list.sessions) ? list.sessions : [];
  for (const s of sessions) {
    if (!isObj(s) || typeof s.key !== "string") continue;
    const jid = groupOfSessionKey(s.key);
    if (jid === null) continue;
    const g = get(jid);
    const updated = typeof s.updatedAt === "number" ? s.updatedAt : 0;
    if (g.updatedAt === null || updated > Date.parse(g.updatedAt)) { g.sessionKey = s.key; g.updatedAt = new Date(updated).toISOString(); }
    if (g.sessionKey === s.key && typeof s.sessionId === "string" && UUID_RE.test(s.sessionId)) g.sessionId = s.sessionId;
    const nome = typeof s.subject === "string" && s.subject !== "" ? s.subject : typeof s.displayName === "string" && s.displayName !== "" ? s.displayName : null;
    if (g.nome === null && nome !== null) g.nome = nome;
  }
  // O banco completa (e substitui, quando o gateway não respondeu ao sessions.list): UUID, .jsonl, assunto e hora.
  for (const [key, raw] of Object.entries(isObj(banco) ? banco : {})) {
    const jid = groupOfSessionKey(key);
    if (jid === null || !isObj(raw)) continue;
    const b = raw as SessaoDoBanco;
    const g = get(jid);
    const updated = typeof b.updatedAt === "number" ? b.updatedAt : 0;
    if (g.sessionKey === null || g.sessionKey === key) {
      g.sessionKey = key;
      if (typeof b.sessionId === "string" && UUID_RE.test(b.sessionId)) g.sessionId = b.sessionId;
      if (typeof b.jsonl === "string" && JSONL_RE.test(b.jsonl)) g.transcript = b.jsonl;
      if (b.respondeu === true) g.agenteRespondeu = true;
      if (g.updatedAt === null && updated > 0) g.updatedAt = new Date(updated).toISOString();
    }
    if (g.nome === null && typeof b.subject === "string" && b.subject !== "") g.nome = b.subject;
  }
  const groups = isObj(wa.groups) ? wa.groups : {};
  for (const jid of Object.keys(groups)) if (JID_RE.test(jid)) get(jid);
  for (const g of byJid.values()) g.agente = agenteDe(wa, g.jid);
  const policy = typeof wa.groupPolicy === "string" ? wa.groupPolicy : "allowlist";
  // Sem o `channels.whatsapp` do openclaw.json (máquina sem OpenClaw, como a do Hermes, ou leitura que falhou) não há
  // política para julgar: "todos admitidos" seria alarme falso. O aviso só vale com a configuração em mãos.
  const todosAdmitidos = isObj(waConfig) && policy !== "disabled" && (Object.keys(groups).length === 0 || "*" in groups);
  const q = quemAcionaDe(wa);
  const peso = (g: WhatsappGroup): number => (g.agente === "desligado" ? 1 : 0);
  const grupos = [...byJid.values()].sort((a, b) => peso(a) - peso(b) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || (a.nome ?? a.jid).localeCompare(b.nome ?? b.jid));
  return { grupos, quemAciona: q.quem, quemAcionaHerdado: q.herdado, todosAdmitidos, cacheEm: c.em, skill: false, self: self === null ? null : digits(self.split(/[:@]/)[0] ?? "") || null };
}

/** Lista de quem aciona validada: E.164, sem repetição, sem "*" e sem o próprio número do agente. */
export function normalizarQuem(nums: readonly string[], self: string | null): string[] {
  const out: string[] = [];
  for (const raw of nums) {
    if (raw.trim() === "*") throw new Error("\"todo mundo\" não entra na lista: escolha \"todos do grupo\", que pede confirmação");
    const n = digits(raw);
    if (!NUMERO_RE.test(n)) throw new Error(`número inválido: ${raw} (use DDI + DDD + número, ex. +5511999998888)`);
    if (self !== null && n === digits(self)) continue; // o agente não aciona a si mesmo
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Patch de `channels.whatsapp` (merge: null apaga) para `openclaw config patch --stdin`; null = nada a mudar.
 * Recusa ligar sem ninguém para acionar: a pessoa escolhe quem (o tutorial abre nesse passo).
 */
export function patchGrupo(waConfig: unknown, jid: string, pedido: WhatsappGroupPatch, self: string | null = null): Record<string, unknown> | null {
  if (!JID_RE.test(jid)) throw new Error("grupo inválido");
  const wa = isObj(waConfig) ? waConfig : {};
  const groups = isObj(wa.groups) ? wa.groups : {};
  const policy = typeof wa.groupPolicy === "string" ? wa.groupPolicy : "allowlist";
  const out: Record<string, unknown> = {};
  const atual = agenteDe(wa, jid);
  const ligadoDepois = pedido.agente !== undefined ? pedido.agente !== "desligado" : jid in groups && policy !== "disabled";

  if (pedido.agente === "desligado") {
    if (jid in groups) {
      const restantes = Object.keys(groups).filter((k) => k !== jid);
      if (restantes.length === 0) { out.groups = null; out.groupPolicy = "disabled"; }
      else out.groups = { [jid]: null };
    } else if (atual !== "desligado") {
      // Admitido por groups vazio/"*": fecha o canal de grupos em vez de deixar todos admitidos.
      out.groups = null; out.groupPolicy = "disabled";
    }
  } else if (pedido.agente !== undefined) {
    const requireMention = pedido.agente === "mencao";
    const g = isObj(groups[jid]) ? groups[jid] : null;
    if (g === null || (g as Record<string, unknown>).requireMention !== requireMention || policy === "disabled") out.groups = { [jid]: { requireMention } };
    if (policy !== "allowlist" && policy !== "open") out.groupPolicy = "allowlist";
  }

  // Desligando, a política é a do desligar; a lista de quem aciona ainda pode ser gravada.
  const mexePolitica = pedido.agente !== "desligado";
  if (pedido.quemAciona === "todos") {
    if (!mexePolitica) throw new Error("\"todos do grupo\" só com o agente ligado");
    if (policy !== "open") out.groupPolicy = "open";
  } else if (pedido.quemAciona !== undefined) {
    const lista = normalizarQuem(pedido.quemAciona, self);
    if (lista.length === 0) throw new Error("escolha pelo menos uma pessoa que pode conversar com o agente no grupo");
    const cur = numerosDe(wa.groupAllowFrom).map(digits);
    if (cur.length !== lista.length || cur.some((n, i) => n !== lista[i])) out.groupAllowFrom = lista.map((n) => `+${n}`);
    if (mexePolitica && (policy === "open" || (policy === "disabled" && ligadoDepois))) out.groupPolicy = "allowlist";
  } else if (ligadoDepois && policy !== "open") {
    // Ligar sem dizer quem: vale a lista que já existe; sem lista própria (cairia no allowFrom das diretas), recusa.
    const cur = numerosDe(wa.groupAllowFrom).filter((n) => n !== "*");
    if (cur.length === 0) throw new Error("antes de ligar, diga quem pode conversar com o agente nos grupos");
  }
  return Object.keys(out).length === 0 ? null : { channels: { whatsapp: out } };
}

/**
 * O mesmo patch endereçado a uma conta nomeada: `channels.whatsapp.accounts.<id>` em vez da raiz (a conta `default` fica
 * na raiz, como sempre). A conferência depois continua pela vista efetiva da conta (`aplicarPatch` sobre ela).
 */
export function envolverPatch(patch: Record<string, unknown>, accountId: string): Record<string, unknown> {
  if (accountId === "default") return patch;
  const wa = isObj(patch.channels) && isObj(patch.channels.whatsapp) ? patch.channels.whatsapp : {};
  return { channels: { whatsapp: { accounts: { [accountId]: wa } } } };
}

/** Aplica um patch de merge (o mesmo que o `config patch` faz) em `channels.whatsapp`: para conferir o que foi gravado. */
export function aplicarPatch(waConfig: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const merge = (a: unknown, b: unknown): unknown => {
    if (!isObj(b)) return b;
    const base: Record<string, unknown> = isObj(a) ? { ...a } : {};
    for (const [k, v] of Object.entries(b)) { if (v === null) delete base[k]; else base[k] = merge(base[k], v); }
    return base;
  };
  const wa = (isObj(patch.channels) && isObj(patch.channels.whatsapp) ? patch.channels.whatsapp : {}) as Record<string, unknown>;
  return merge(isObj(waConfig) ? waConfig : {}, wa) as Record<string, unknown>;
}

/** O que importa para conferir uma gravação: o agente no grupo e quem aciona. */
export function estadoDoGrupo(waConfig: unknown, jid: string): string {
  const wa = isObj(waConfig) ? waConfig : {};
  const q = quemAcionaDe(wa);
  return `${agenteDe(wa, jid)}|${q.quem === "todos" ? "todos" : [...q.quem].sort().join(",")}|${q.herdado ? "h" : ""}|${typeof wa.groupPolicy === "string" ? wa.groupPolicy : ""}`;
}

/**
 * Conversa de um grupo (só leitura): todas as mensagens humanas com o autor (o nome pelo cache de nomes; o
 * `senderName` do OpenClaw em grupo costuma vir com o nome do grupo, então só vale quando é outro) e as respostas
 * que o agente entregou. Avisos de sistema (sem `senderId`), `NO_REPLY` e rascunho interno ficam de fora.
 */
export function threadDoGrupo(history: unknown, nomes: ReadonlyMap<string, string> = new Map(), nomeDoGrupo: string | null = null): WhatsappThreadMessage[] {
  const messages = isObj(history) && Array.isArray(history.messages) ? history.messages : [];
  const out: WhatsappThreadMessage[] = [];
  for (const m of messages) {
    if (!isObj(m)) continue;
    const at = typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString() : "";
    const text = textOf(m.content).trim();
    if (m.role === "user") {
      const meta = isObj(m.__openclaw) ? m.__openclaw : {};
      const sender = typeof meta.senderId === "string" ? digits(meta.senderId) : "";
      if (sender === "" || text === "") continue;
      const sn = typeof meta.senderName === "string" ? meta.senderName.trim() : "";
      const autor = nomes.get(sender) ?? (sn !== "" && sn !== nomeDoGrupo ? sn : `+${sender}`);
      out.push({ role: "contact", text, at, autor });
    } else if (m.role === "assistant") {
      const spoken = spokenText(m.content);
      if (spoken !== null) { out.push({ role: "agent", text: `🎙️ ${spoken}`, at }); continue; }
      if (text === "" || text === "NO_REPLY" || !isDelivered(m)) continue;
      out.push({ role: "agent", text, at });
    }
  }
  const seen = new Set<string>();
  return out.filter((m) => { const k = `${m.role}|${m.at}|${m.text}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.at.localeCompare(b.at));
}
