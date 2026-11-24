/**
 * Conversas do WhatsApp numa máquina com o Hermes Agent, para o espelho só-leitura do app. O Hermes guarda tudo em
 * `~/.hermes/state.db` (SQLite): `sessions` (uma por contato, `session_key` = `agent:<perfil>:whatsapp:dm:<número>`,
 * `display_name` = o nome do contato) e `messages` (`role` user/assistant/tool/session_meta, `content`, `timestamp`
 * em segundos, `display_kind` hidden/internal_notification para o que não foi ao WhatsApp). Os programas Python
 * abaixo leem o banco em modo só-leitura na máquina e devolvem JSON numa linha; as funções puras viram isso nos
 * tipos do contrato. É a fronteira dona desse formato: o renderer nunca vê o esquema do Hermes.
 */
import type { VozId } from "../../shared/ipc";
import { isVozId } from "./vozes-core";
import type { TypingChoice, TypingMode, WhatsappChat, WhatsappDmPolicy, WhatsappGroup, WhatsappGroupAgent, WhatsappGroupPatch, WhatsappGroups, WhatsappReplyChoice, WhatsappThreadMessage } from "../../shared/ipc";
import { donosDe, souEu, type WaQuem } from "./whatsapp-marks";
import { JID_RE, parseCacheGrupos } from "./whatsapp-grupos-core";
import { BACKEND_DIR_SH } from "../maquina/backend-dir-core";
import { TRANSCRITOR_BIN, lerAudioEstado } from "./transcritor-core";

const digits = (s: string): string => s.replace(/\D/g, "");
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Chave de sessão de contato do Hermes: `agent:main:whatsapp:dm:5521…` (grupos são `…:whatsapp:group:<jid>:<quem>`). */
export const hermesPeerOfKey = (key: string): string | null => { const m = /^agent:[^:]+:whatsapp:dm:\+?(\d{8,15})$/.exec(key); return m === null ? null : m[1]!; };
export const isHermesKey = (key: string): boolean => /^agent:[^:]+:whatsapp:(dm|group):/.test(key);
/** Id de sessão do Hermes (`20261024_175234_c37905b9`): o que pode ir num argumento de shell sem escapar. */
export const HERMES_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

/** Número do próprio aparelho, do creds.json do bridge do Hermes. */
export const HERMES_SELF_SH = `python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$HOME/.hermes/whatsapp/session/creds.json" 2>/dev/null`;

/** Lista das sessões de contato (source whatsapp, chat_type dm) em JSON numa linha; `null` sem banco. */
export const HERMES_LIST_PY = `python3 -c '
import json, os, sqlite3
p = os.path.expanduser("~/.hermes/state.db")
if not os.path.exists(p):
    print("null"); raise SystemExit
c = sqlite3.connect("file:" + p + "?mode=ro", uri=True)
rows = c.execute("select id, session_key, display_name, message_count, started_at, last_activity_at, archived, hidden, ended_at from sessions where source = ? and chat_type = ?", ("whatsapp", "dm")).fetchall()
print(json.dumps({"sessions": [{"id": r[0], "key": r[1], "name": r[2], "count": r[3], "started": r[4], "last": r[5], "archived": r[6], "hidden": r[7], "ended": r[8]} for r in rows]}, ensure_ascii=True))
'`;

/**
 * Sessões de grupo (source whatsapp, chat_type group): no Hermes há UMA por grupo e por remetente
 * (`agent:<perfil>:whatsapp:group:<jid>:<número de quem falou>`); `user_name` do origin_json é o nome de quem falou.
 */
export const HERMES_GROUPS_PY = `python3 -c '
import json, os, sqlite3
p = os.path.expanduser("~/.hermes/state.db")
if not os.path.exists(p):
    print("null"); raise SystemExit
c = sqlite3.connect("file:" + p + "?mode=ro", uri=True)
rows = c.execute("select id, session_key, display_name, origin_json, message_count, started_at, last_activity_at, hidden, ended_at from sessions where source = ? and chat_type = ?", ("whatsapp", "group")).fetchall()
out = []
for r in rows:
    try: o = json.loads(r[3] or "{}") or {}
    except Exception: o = {}
    out.append({"id": r[0], "key": r[1], "name": r[2], "user": o.get("user_name"), "count": r[4], "started": r[5], "last": r[6], "hidden": r[7], "ended": r[8]})
print(json.dumps({"sessions": out}, ensure_ascii=True))
'`;
/** Jid e remetente de uma chave de sessão de grupo do Hermes. */
export const hermesGroupOfKey = (key: string): { jid: string; sender: string } | null => { const m = /^agent:[^:]+:whatsapp:group:(\d{10,25}(?:-\d+)?@g\.us):\+?(\d{8,15})$/.exec(key); return m === null ? null : { jid: m[1]!, sender: m[2]! }; };
export interface HermesGroupSession { id: string; sender: string; nome: string | null; ended: boolean; started: number }
/** Sessões de um grupo (todas, com a marca de encerrada), da mais antiga para a mais nova. */
export function hermesGroupSessions(data: unknown, jid: string): HermesGroupSession[] {
  const rows = isObj(data) && Array.isArray(data.sessions) ? data.sessions : [];
  const out: HermesGroupSession[] = [];
  for (const s of rows) {
    if (!isObj(s) || typeof s.id !== "string" || typeof s.key !== "string" || !HERMES_ID_RE.test(s.id)) continue;
    const g = hermesGroupOfKey(s.key);
    if (g === null || g.jid !== jid) continue;
    out.push({ id: s.id, sender: g.sender, nome: typeof s.user === "string" && s.user.trim() !== "" ? s.user.trim() : null, ended: s.ended !== null && s.ended !== undefined, started: typeof s.started === "number" ? s.started : 0 });
  }
  return out.sort((a, b) => a.started - b.started);
}

/** Mensagens das sessões pedidas (ids em argv; o último argumento é o limite por sessão), em JSON numa linha. */
export const HERMES_THREAD_PY = `python3 -c '
import json, os, sqlite3, sys
ids = sys.argv[1:-1]; limit = int(sys.argv[-1])
p = os.path.expanduser("~/.hermes/state.db")
c = sqlite3.connect("file:" + p + "?mode=ro", uri=True)
out = []
for sid in ids:
    rows = c.execute("select id, role, content, timestamp, display_kind from messages where session_id = ? and role in (?, ?) order by id desc limit ?", (sid, "user", "assistant", limit)).fetchall()
    out.extend({"sid": sid, "role": r[1], "content": r[2], "ts": r[3], "kind": r[4]} for r in reversed(rows))
print(json.dumps({"messages": out}, ensure_ascii=True))
'`;

/**
 * Encerra sessões (ids em argv) do jeito que o próprio `/reset` do gateway faz: `SessionDB.end_session(id,
 * "session_reset")` carimba `ended_at`/`end_reason` e avança a geração da conversa; na próxima mensagem do contato o
 * gateway vê a rota encerrada no state.db, descarta a entrada em memória e abre uma sessão nova (auto-cura #54878).
 * Roda com o Python do próprio Hermes (venv do runtime), nunca escrevendo no banco à mão. Imprime "ok".
 */
/**
 * PATH para falar com o Hermes por SSH não interativo: o `hermes` do npm é um script Node, e o Node fica fora do
 * PATH (o do Hermes em ~/.hermes/tools, ou ~/.local/node). Sem isto, "env: node: No such file or directory".
 */
/** PATH do Hermes e do Node dele: o do usuário (~/.local, ~/.hermes/tools) na frente do de todos (/opt/hermes), que vem por último. */
export const HERMES_PATH_SH = `[ -d /opt/hermes/node/bin ] && PATH=/opt/hermes/node/bin:$PATH; export PATH=$HOME/.local/bin:$HOME/.npm-global/bin:$PATH; for d in "$HOME/.local/node/bin" "$HOME"/.hermes/tools/node-*/bin "$HOME"/.hermes/tools/npm-*/bin; do [ -d "$d" ] && PATH=$d:$PATH; done
hermes_version() { local C="$HOME/.cache/meu-bot/hermes-version" B P J; B=$(command -v hermes 2>/dev/null) || return 0; P=$(readlink -f "$B" 2>/dev/null); J="$(dirname "$(dirname "$P")")/package.json"; if [ -s "$C" ] && [ ! "$B" -nt "$C" ] && { [ -z "$P" ] || [ ! "$P" -nt "$C" ]; } && { [ ! -f "$J" ] || [ ! "$J" -nt "$C" ]; } && [ -n "$(find "$C" -mmin -1440 2>/dev/null)" ]; then cat "$C"; else mkdir -p "$(dirname "$C")"; timeout 20 hermes --version 2>/dev/null > "$C.tmp" && mv -f "$C.tmp" "$C" && cat "$C"; fi; }`;
/**
 * R = pasta do código do Hermes, pelo próprio `hermes` (o de ~/.local ou o de todos, em /opt/hermes); sem resposta,
 * o lugar de sempre em ~/.local. Exige HERMES_PATH_SH antes.
 */
export const HERMES_DIR_SH = `R=$(hermes_version | sed -n "s/^Install directory: //p"); [ -n "$R" ] || R=$HOME/.local/lib/node_modules/hermes-agent/runtime/hermes-agent`;
export const HERMES_END_SH = `${HERMES_PATH_SH}; R=$(hermes_version | sed -n "s/^Install directory: //p"); [ -n "$R" ] || R=$HOME/.local/lib/node_modules/hermes-agent/runtime/hermes-agent; cd "$R" && "$R/venv/bin/python3" -c '
import sys, hermes_state
db = hermes_state.SessionDB()
for sid in sys.argv[1:]:
    db.end_session(sid, "session_reset")
print("ok")
'`;

/** Nome útil: o display_name do Hermes, exceto vazio, só dígitos ou um id interno do WhatsApp (`…@lid`). */
const nameOf = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" && !/^\d+$/.test(v.trim()) && !/@lid$/.test(v) ? v.trim() : null);
const isoOf = (seconds: unknown): string => (typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : "");

/**
 * Lista de conversas a partir das sessões do Hermes. Uma sessão por contato (sempre "própria"); `self` marca o
 * próprio aparelho; `names` (cache do main) vence só quando o Hermes não tem o nome. Sessões escondidas no Hermes
 * ficam de fora; arquivado/apelido/excluído vêm das marcas da máquina (whatsapp-marks.ts), como no OpenClaw.
 */
export function chatsFromHermes(list: unknown, quem: QuemArg, names: ReadonlyMap<string, string> = new Map()): WhatsappChat[] {
  const sessions = isObj(list) && Array.isArray(list.sessions) ? list.sessions : [];
  const q = quemOf(quem);
  // "5516992294486:36@s.whatsapp.net": o sufixo de aparelho (:36) e o domínio não fazem parte do número.
  const selfN = q.self === null ? null : digits(q.self.replace(/[:@].*$/, ""));
  const donoN = q.dono === null ? null : digits(q.dono.replace(/[:@].*$/, ""));
  const byNumber = new Map<string, { keys: string[]; ids: Record<string, string>; started: Record<string, number>; updated: string; name: string | null }>();
  for (const s of sessions) {
    if (!isObj(s) || typeof s.key !== "string" || typeof s.id !== "string" || s.hidden === 1 || s.hidden === true) continue;
    const number = hermesPeerOfKey(s.key);
    if (number === null) continue;
    const updated = isoOf(s.last ?? s.started);
    const cur = byNumber.get(number) ?? { keys: [], ids: {}, started: {}, updated: "", name: null };
    if (!cur.keys.includes(s.key)) cur.keys.push(s.key);
    // A sessão viva mais recente da chave é a que vale para ler e limpar; uma encerrada ("Limpar histórico") só
    // mantém o contato na lista, com a conversa vazia, até ele escrever de novo e o gateway abrir outra.
    const ended = s.ended !== null && s.ended !== undefined;
    const started = typeof s.started === "number" ? s.started : 0;
    if (!ended && HERMES_ID_RE.test(s.id) && started >= (cur.started[s.key] ?? -1)) { cur.ids[s.key] = s.id; cur.started[s.key] = started; }
    if (updated > cur.updated) { cur.updated = updated; cur.name = nameOf(s.name) ?? cur.name; } else cur.name ??= nameOf(s.name);
    byNumber.set(number, cur);
  }
  return [...byNumber.entries()]
    .map(([number, v]) => ({
      number, name: v.name ?? names.get(number) ?? null, isSelf: number === selfN, isDono: number === donoN && donoN !== selfN, sessionKeys: v.keys, sessionIds: v.ids,
      ownSession: true, paused: false, updatedAt: v.updated, alias: null, archived: false, deleted: false,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Conversa de um contato a partir das mensagens das sessões dele: `user` é o contato, `assistant` é o agente. Fica
 * de fora o que não foi ao WhatsApp: ferramentas, metadados, respostas vazias (turno só de ferramenta), `NO_REPLY` e
 * mensagens marcadas hidden/internal_notification.
 */
export function threadFromHermes(data: unknown, autores: ReadonlyMap<string, string> = new Map()): WhatsappThreadMessage[] {
  const rows = isObj(data) && Array.isArray(data.messages) ? data.messages : [];
  const out: WhatsappThreadMessage[] = [];
  for (const m of rows) {
    if (!isObj(m) || (m.role !== "user" && m.role !== "assistant")) continue;
    if (typeof m.kind === "string" && m.kind !== "") continue;
    const text = typeof m.content === "string" ? m.content.trim() : "";
    if (text === "" || text === "NO_REPLY") continue;
    // Grupo: cada sessão é de um remetente; `autores` (id da sessão → nome ou +número) diz quem falou.
    const autor = m.role === "user" && typeof m.sid === "string" ? autores.get(m.sid) : undefined;
    out.push({ role: m.role === "user" ? "contact" : "agent", text, at: isoOf(m.ts), ...(autor === undefined ? {} : { autor }) });
  }
  const seen = new Set<string>();
  return out.filter((m) => { const k = `${m.role}|${m.at}|${m.text}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.at.localeCompare(b.at));
}

// ---- Quem o agente responde (política de DM) no Hermes: vive em ~/.hermes/.env.
// WHATSAPP_MODE (self-chat | bot), WHATSAPP_DM_POLICY (pairing | allowlist | open | disabled), WHATSAPP_ALLOWED_USERS
// (lista separada por vírgula; "*" = todos) e WHATSAPP_ALLOW_ALL_USERS (opt-in obrigatório do "open": sem ele o
// gateway se recusa a subir). Tudo isso, a lista inclusive, só vale depois de reiniciar o gateway: o adapter lê
// WHATSAPP_ALLOWED_USERS na subida e o bridge recebe a lista no spawn (Hermes 0.22.2; visto no box-2: pausa gravada
// no .env e o contato respondido 20 s depois). Esta é a fronteira dona desse formato.
// "Todo mundo" exige a lista com "*": o bridge.js (Node) filtra as conversas diretas pela WHATSAPP_ALLOWED_USERS
// antes de o Python ver a mensagem e só conhece "*" como "qualquer um" (allowlist.js, matchesAllowedUser); o
// WHATSAPP_DM_POLICY=open e o WHATSAPP_ALLOW_ALL_USERS=true valem só no gateway Python (authz_mixin). Com "open"
// e a lista de números, quem não está nela morre no bridge com `allowlist_mismatch` (box-1, 30 out: o bot não
// respondia ninguém além do dono).
/** Imprime `wamode=`, `wadm=`, `waallow=` e `waall=` a partir de ~/.hermes/.env (aspas e `export` tolerados). */
export const HERMES_POLICY_PY = `python3 -c '
import os, re
p = os.path.expanduser("~/.hermes/.env"); kv = {}
try:
    for l in open(p):
        m = re.match(r"\\s*(?:export\\s+)?([A-Z0-9_]+)\\s*=\\s*(.*?)\\s*$", l)
        if m:
            v = m.group(2)
            kv[m.group(1)] = v[1:-1] if len(v) > 1 and v[0] == v[-1] and v[0] in "\\x27\\x22" else v
except Exception:
    pass
for k, n in (("WHATSAPP_MODE", "wamode"), ("WHATSAPP_DM_POLICY", "wadm"), ("WHATSAPP_ALLOWED_USERS", "waallow"), ("WHATSAPP_ALLOW_ALL_USERS", "waall")):
    print("%s=%s" % (n, kv.get(k, "")))
'`;

/** Valores lidos do .env do Hermes (strings cruas; vazio = ausente). */
export interface HermesWaEnv { mode: string; dm: string; allow: string; all: string }
export const hermesEnvOf = (kv: Map<string, string>): HermesWaEnv => ({ mode: kv.get("wamode") ?? "", dm: kv.get("wadm") ?? "", allow: kv.get("waallow") ?? "", all: kv.get("waall") ?? "" });
const truthy = (v: string): boolean => /^(true|1|yes|on)$/i.test(v.trim());
const listaDe = (allow: string): string[] => [...new Set(allow.split(",").map((s) => s.trim()).filter((s) => s !== ""))];
const comMais = (n: string): string => (n === "*" || n.startsWith("+") ? n : `+${n}`);
/** Quem manda: `WaQuem` (whatsapp-marks.ts quemDe) ou, pelo jeito antigo, só o número pareado (dono = ele). */
export type QuemArg = WaQuem | string | null;
export const quemOf = (q: QuemArg): WaQuem => (q === null || typeof q === "string" ? { self: q, dono: q } : q);

/**
 * O .env do Hermes → a política no contrato do app (a mesma que o OpenClaw devolve): self-chat é "só você";
 * open só vale com o opt-in (sem ele o gateway nem sobe: tratado como desligado); "*" na lista também é todo mundo;
 * lista preenchida é allowlist; pairing sem lista fica pairing.
 */
export function politicaHermes(env: HermesWaEnv, quem: QuemArg): { dmPolicy: WhatsappDmPolicy; allowFrom: string[] } {
  const mode = (env.mode.trim().toLowerCase() || "self-chat");
  const dm = (env.dm.trim().toLowerCase() || "pairing");
  const lista = listaDe(env.allow);
  if (mode === "self-chat") return { dmPolicy: "allowlist", allowFrom: donosDe(quemOf(quem)).map(comMais) };
  if (dm === "disabled") return { dmPolicy: "disabled", allowFrom: lista.map(comMais) };
  if ((dm === "open" && truthy(env.all)) || lista.includes("*")) return { dmPolicy: "open", allowFrom: ["*"] };
  if (dm === "open") return { dmPolicy: "disabled", allowFrom: lista.map(comMais) };
  if (lista.length > 0) return { dmPolicy: "allowlist", allowFrom: lista.map(comMais) };
  return { dmPolicy: dm === "allowlist" ? "allowlist" : "pairing", allowFrom: [] };
}

/**
 * CONTORNO #5 (Hermes): em modo bot o bridge descarta tudo que vem do próprio aparelho, e em self-chat só atende o
 * próprio chat — não há modo que atenda a pessoa no próprio chat E outros contatos (issue upstream: a abrir).
 * O que fazemos: o conceito "dono" (whatsapp-lista.json › dono): com dono ≠ pareado, "só eu" vira bot + allowlist
 * [pareado, dono], e a pessoa fala com o agente do celular dela; com dono == pareado, os cartões Lista/Todo mundo
 * avisam que o próprio chat não é respondido.
 * Sai quando: o Hermes aceitar self-chat em modo bot (uma chave do tipo WHATSAPP_SELF_CHAT junto de MODE=bot em
 * `hermes whatsapp --help` ou no .env.example): "self" grava bot sempre e o aviso dos cartões some.
 * Tabela: docs/guia/contornos.md.
 *
 * O que gravar no .env para cada cartão. "open" grava a lista como "*": é o único valor que o bridge aceita como
 * "todo mundo" (ver o comentário acima); a lista anterior não precisa sobreviver, porque "só eu" e "você e a lista"
 * reconstroem a lista a partir do dono/pareado e dos números escolhidos na tela. O dono (e o pareado) entram sempre
 * na lista.
 */
export function hermesEnvPara(escolha: WhatsappReplyChoice, quem: QuemArg, numbers: readonly string[] = []): Record<string, string> {
  if (escolha === "open") return { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "open", WHATSAPP_ALLOWED_USERS: "*", WHATSAPP_ALLOW_ALL_USERS: "true" };
  const q = quemOf(quem);
  const lista = [...new Set([...donosDe(q), ...numbers.map((n) => n.replace(/\D/g, ""))])].filter((n) => n !== "");
  if (escolha === "self") return { WHATSAPP_MODE: souEu(q) ? "self-chat" : "bot", WHATSAPP_DM_POLICY: "allowlist", WHATSAPP_ALLOWED_USERS: lista.join(","), WHATSAPP_ALLOW_ALL_USERS: "false" };
  return { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "allowlist", WHATSAPP_ALLOWED_USERS: lista.join(","), WHATSAPP_ALLOW_ALL_USERS: "false" };
}

/**
 * O agente não responde a este contato pela política de hoje? É o que a lista mostra como "pausado" além da marca:
 * em "só você" todo mundo menos o próprio; desligado, todos; numa lista, quem está fora dela. "Todo mundo" e pairing
 * (o número fora da lista recebe pedido de pareamento, não silêncio) não pausam ninguém.
 */
export function hermesNaoResponde(env: HermesWaEnv, quem: QuemArg, number: string): boolean {
  if (donosDe(quemOf(quem)).includes(number)) return false;
  const mode = env.mode.trim().toLowerCase() || "self-chat";
  const dm = env.dm.trim().toLowerCase() || "pairing";
  const lista = listaDe(env.allow);
  if (mode === "self-chat") return true;
  if (dm === "disabled") return true;
  if (lista.includes("*")) return false;
  if (dm === "open") return !truthy(env.all);
  if (lista.length > 0) return !lista.includes(number);
  return false;
}

/**
 * CONTORNO #1 (Hermes): não há pausa por contato (NousResearch/hermes-agent#146672).
 * O que fazemos: pausar é tirar o número da WHATSAPP_ALLOWED_USERS e reiniciar o gateway; retomar é devolvê-lo.
 * Sai quando: toda máquina Hermes do mapa estiver com o plugin meu-bot-pausa (pausaplugin) ou com pausanativa=1 — o
 * ramo "allowlist" de hermesPausaModo some e esta função com ele. Tabela: docs/guia/contornos.md.
 *
 * Pausar um contato no Hermes sem o plugin: não existe pausa por contato lá, então pausar é tirá-lo da lista de quem
 * o agente responde (WHATSAPP_ALLOWED_USERS) enquanto a pausa durar, e retomar é devolvê-lo. A marca "pausado" mora em
 * whatsapp-lista.json (whatsapp-marks.ts); os outros pausados ficam fora da lista gravada. A política fica fixa em
 * "lista" (allowlist): em pairing, um número fora da lista receberia pedido de pareamento, o oposto de pausa.
 * Retomar vale em qualquer política: em "só você" ou desligado, a conversa clicada vira "você e ele" (a pessoa não
 * precisa passar por "Quem o agente responde"). Pausar em "só você"/desligado não tem o que tirar; em "todo mundo"
 * não há lista de onde tirar. Diferença do OpenClaw, dita na tela: o agente nem vê as mensagens durante a pausa.
 */
export function hermesPausaPlano(env: HermesWaEnv, quem: QuemArg, number: string, paused: boolean, pausados: readonly string[]): { patch: Record<string, string>; reinicia: boolean } {
  const mode = env.mode.trim().toLowerCase() || "self-chat";
  const dm = env.dm.trim().toLowerCase() || "pairing";
  const lista = listaDe(env.allow);
  if (paused && mode === "self-chat") throw new Error("o Hermes está em modo \"só você\": o agente não responde a outros contatos, não há o que pausar");
  if (paused && dm === "disabled") throw new Error("o agente está desligado para conversas diretas nesta máquina: não há o que pausar");
  if ((dm === "open" && truthy(env.all)) || lista.includes("*")) throw new Error(paused ? "com \"todo mundo\" o Hermes não tem lista de onde tirar o contato: escolha uma lista em \"Quem o agente responde\" antes de pausar" : "o agente já responde a todo mundo nesta máquina: não há o que retomar");
  // Em "só você" a lista gravada pode trazer números de antes; a pausa/retomada parte do que vale hoje (só o próprio).
  const efetiva = new Set(mode === "self-chat" ? [] : lista);
  if (paused) efetiva.delete(number); else efetiva.add(number);
  for (const d of donosDe(quemOf(quem))) efetiva.add(d);
  for (const n of pausados) if (n !== number) efetiva.delete(n);
  const patch: Record<string, string> = { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "allowlist", WHATSAPP_ALLOWED_USERS: [...efetiva].join(","), WHATSAPP_ALLOW_ALL_USERS: "false" };
  return { patch, reinicia: hermesPrecisaReiniciar(env, patch) };
}

/**
 * Qualquer mudança no .env pede reinício do gateway: modo, política e opt-in são lidos na subida, e a lista também
 * (o adapter guarda `_allow_from` ao iniciar e o bridge recebe a lista no spawn). Sem reiniciar, pausar/retomar
 * grava o .env e nada muda: foi o que trancou um usuário fora do próprio bot e deixou um pausado sendo respondido.
 */
export function hermesPrecisaReiniciar(antes: HermesWaEnv, depois: Record<string, string>): boolean {
  const norm = (v: string | undefined, padrao: string): string => (v ?? "").trim().toLowerCase() || padrao;
  const listaIgual = (a: string, b: string | undefined): boolean => { const x = listaDe(a).sort(), y = listaDe(b ?? a).sort(); return x.length === y.length && x.every((v, i) => v === y[i]); };
  return norm(antes.mode, "self-chat") !== norm(depois["WHATSAPP_MODE"], "self-chat")
    || norm(antes.dm, "pairing") !== norm(depois["WHATSAPP_DM_POLICY"], "pairing")
    || truthy(antes.all) !== truthy(depois["WHATSAPP_ALLOW_ALL_USERS"] ?? "")
    || !listaIgual(antes.allow, depois["WHATSAPP_ALLOWED_USERS"]);
}

// ---- Home channel do Hermes: para onde ele manda avisos e cron (`WHATSAPP_HOME_CHANNEL` no .env e
// `platforms.whatsapp.home_channel` no config.yaml; gateway/config.py lê o yaml, o .env entra na entrega do cron).
/** Nome do dono como vai para o .env/yaml: uma linha, sem aspas simples nem controle, até 60 caracteres. */
export const nomeHomeChannel = (nome: string | null): string => (nome ?? "").replace(/['\\\r\n\t]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "Dono";
/**
 * Grava o home channel do Hermes para o dono: o .env (`WHATSAPP_HOME_CHANNEL`, `_NAME`) e o config.yaml
 * (`platforms.whatsapp.home_channel {platform, chat_id, name, user_id}`), iguais, com o jid em `@s.whatsapp.net`
 * (o LID fica por conta do Hermes; sessões já são por número). Imprime `home=ok`. Lido na subida: quem chama reinicia.
 */
export function hermesHomeChannelSh(numero: string, nome: string | null): string {
  if (!/^\d{8,15}$/.test(numero)) throw new Error("número do dono inválido");
  const jid = `${numero}@s.whatsapp.net`;
  const b64 = Buffer.from(JSON.stringify({ platform: "whatsapp", chat_id: jid, name: nomeHomeChannel(nome), user_id: jid }), "utf8").toString("base64");
  return `${HERMES_ENV_SET_PY} 'WHATSAPP_HOME_CHANNEL=${jid}' 'WHATSAPP_HOME_CHANNEL_NAME=${nomeHomeChannel(nome)}' >/dev/null
${HERMES_PY_SH}; "$PY" -c '
import base64, json, sys
${HERMES_YAML_PY}
h = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
pw = sub(sub(doc, "platforms"), "whatsapp")
pw["home_channel"] = h
salvar(); print("home=ok")
' '${b64}'`;
}

// ---- Como a pausa por contato é feita nesta máquina.
/**
 * `nativa` = o Hermes tem pausa por contato (ainda não existe; critério abaixo); `plugin` = o meu-bot-pausa está
 * instalado E carregado pelo gateway de agora (a marca basta, vale em qualquer política, sem reinício);
 * `allowlist` = sem os dois: pausar é tirar da WHATSAPP_ALLOWED_USERS com reinício (contorno #1).
 */
export type HermesPausaModo = "nativa" | "plugin" | "allowlist";
/**
 * CONTORNO #2 (Hermes): não há pausa por contato (NousResearch/hermes-agent#146672).
 * O que fazemos: a sonda diz se o plugin meu-bot-pausa está instalado (`pausaplugin` = versão do .ok) e carregado
 * (`pausavivo` = versão que o register() gravou); iguais = o gateway de agora já pausa pela marca.
 * Sai quando: `pausanativa=1`. Hoje é um palpite declarado (`hermes whatsapp --help` cita "pause"); trocar pelo
 * sinal real da release que fechar a issue. Tabela: docs/guia/contornos.md.
 */
export const HERMES_PAUSA_SH = `${HERMES_PATH_SH}
echo "pausaplugin=$( [ -f "$HOME/.hermes/plugins/meu-bot-pausa/plugin.yaml" ] && cat "$HOME/.hermes/plugins/meu-bot-pausa/.ok" 2>/dev/null | tr -dc '0-9.')"
echo "pausavivo=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["versao"])' "$HOME/.local/share/meu-bot/whatsapp-pausa.carregado" 2>/dev/null | tr -dc '0-9.')"
PV=$(hermes_version | head -1 | tr -dc '0-9A-Za-z.'); PC="$HOME/.cache/meu-bot/pausanativa-$PV"
if [ -n "$PV" ] && [ -s "$PC" ]; then echo "pausanativa=$(cat "$PC")"
else N=$(timeout 10 hermes whatsapp --help 2>/dev/null | grep -qiE '(^|[^a-z])pause([^a-z]|$)' && echo 1 || echo 0); [ -n "$PV" ] && { mkdir -p "$(dirname "$PC")"; printf '%s' "$N" > "$PC"; }; echo "pausanativa=$N"; fi`;
const VERSAO_RE = /^\d+(\.\d+)*$/;
/** O que a sonda (HERMES_PAUSA_SH) disse → o modo. Plugin instalado mas ainda não carregado (gateway antigo) = allowlist. */
export function hermesPausaModo(kv: Map<string, string>): HermesPausaModo {
  if ((kv.get("pausanativa") ?? "").trim() === "1") return "nativa";
  const instalado = (kv.get("pausaplugin") ?? "").trim(), vivo = (kv.get("pausavivo") ?? "").trim();
  return VERSAO_RE.test(instalado) && instalado === vivo ? "plugin" : "allowlist";
}

/** Valores que podem ir num argumento de shell entre aspas simples (os nossos: palavras, números, vírgulas). */
export const HERMES_ENV_VALUE_RE = /^[A-Za-z0-9_,.*+-]*$/;
/** `KEY=valor …` em argv: grava em ~/.hermes/.env (linha existente trocada, senão acrescentada), com backup ao lado. */
export const HERMES_ENV_SET_PY = `python3 -c '
import os, re, sys, shutil, time
p = os.path.expanduser("~/.hermes/.env")
lines = open(p).read().splitlines(True) if os.path.exists(p) else []
if os.path.exists(p):
    shutil.copy2(p, p + ".bak-meu-bot-" + time.strftime("%Y%m%d-%H%M%S"))
for a in sys.argv[1:]:
    k, _, v = a.partition("=")
    done = False
    for i, l in enumerate(lines):
        if re.match(r"\\s*(?:export\\s+)?" + re.escape(k) + r"\\s*=", l):
            lines[i] = "%s=%s\\n" % (k, v); done = True
    if not done:
        if lines and not lines[-1].endswith("\\n"):
            lines[-1] += "\\n"
        lines.append("%s=%s\\n" % (k, v))
tmp = p + ".tmp"
open(tmp, "w").write("".join(lines)); os.chmod(tmp, 0o600); os.replace(tmp, p)
print("envset=ok")
'`;

/**
 * CONTORNO #3 (Hermes): `hermes pm install --extra stt-whisper` recusa num usuário novo de Hermes global porque as
 * ferramentas (ffmpeg, ripgrep) são por HERMES_HOME (issue upstream a abrir; ver a tabela).
 * O que fazemos: instalamos só as ferramentas que ele listou e tentamos de novo.
 * Sai quando: `hermes pm install --extra stt-whisper` sair 0 num usuário recém-criado de Hermes global, sem o passo extra.
 * Tabela: docs/guia/contornos.md.
 *
 * Instala um extra do Hermes (`stt-whisper`, `piper`) no ambiente do gateway; imprime `extra=ok` ou `extra=falhou` e
 * sai 3. O `hermes pm` recusa o extra quando faltam as ferramentas dele no PATH ("tools not on PATH before venv sync:
 * ffmpeg: …; ripgrep: …"), o que acontece num usuário novo de um Hermes global (/opt/hermes): as ferramentas são por
 * HERMES_HOME. Aí instala só as que ele listou e tenta de novo (`--tools-only` traria também o Chromium, ~300 MB).
 */
export const hermesPmExtraSh = (extra: string): string => `${HERMES_PATH_SH}
O=$(timeout 1200 hermes pm install --extra ${extra} 2>&1) || {
  F=$(printf '%s\\n' "$O" | sed -n 's/.*tools not on PATH before venv sync: //p' | tr ';' '\\n' | sed 's/:.*//; s/^ *//' | tr '\\n' ' ')
  [ -n "$F" ] && timeout 1200 hermes pm install $F >/dev/null 2>&1 && timeout 1200 hermes pm install --extra ${extra} >/dev/null 2>&1
} || { echo "extra=falhou"; exit 3; }
echo "extra=ok"`;

/**
 * Reinicia o gateway do Hermes onde ele estiver: processo do PM2 que roda `hermes gateway`, senão o serviço de
 * usuário do systemd (sem depender do Node), senão `hermes gateway restart`.
 */
export const HERMES_RESTART_SH = `${HERMES_PATH_SH}
N=$(pm2 jlist 2>/dev/null | python3 -c '
import sys, json
try:
    for p in json.load(sys.stdin):
        e = p.get("pm2_env", {}); a = " ".join([str(e.get("pm_exec_path", "")), str(e.get("args", ""))])
        if "hermes" in a and "gateway" in a:
            print(p["name"]); break
except Exception:
    pass
')
if [ -n "$N" ]; then pm2 restart "$N" --update-env >/dev/null 2>&1 && echo "restart=pm2:$N" || echo "restart=falhou: pm2 restart $N"
elif systemctl --user cat hermes-gateway >/dev/null 2>&1; then systemctl --user reset-failed hermes-gateway >/dev/null 2>&1; systemctl --user restart hermes-gateway >/dev/null 2>&1 && echo "restart=systemd" || echo "restart=falhou: systemctl --user restart hermes-gateway"
elif command -v hermes >/dev/null 2>&1; then hermes gateway restart >/dev/null 2>&1 && echo "restart=hermes" || echo "restart=falhou: hermes gateway restart"
else echo "restart=sem-servico"; fi`;

// ------------------------------------------------------------------ grupos (config.yaml do Hermes)
/**
 * Grupos no Hermes: dois portões por mensagem. (1) O grupo é admitido? `platforms.whatsapp.group_policy` do
 * ~/.hermes/config.yaml: `allowlist` com `group_allow_from` (jids), `open` = todos, `disabled`/`pairing` = nenhum.
 * (2) O agente responde a tudo ou só quando chamado? `require_mention` (global) com as exceções `free_response_chats`
 * (jids que respondem sempre). Quem fala dentro de um grupo admitido passa pela MESMA lista global das conversas
 * diretas (WHATSAPP_ALLOWED_USERS): não existe "quem aciona" por grupo no Hermes. O config.yaml tem precedência
 * sobre o .env e os dois são lidos na subida do gateway, então gravar exige reiniciar (HERMES_RESTART_SH).
 *
 * Tradução para o contrato do app (o mesmo do OpenClaw): `desligado` = fora da lista; `sempre` = admitido e
 * (sem menção obrigatória ou nas exceções); `mencao` = admitido com menção obrigatória. "Quando chamado" num
 * grupo liga `require_mention` para todos e põe os outros ligados nas exceções, para ninguém mudar sem querer.
 */
export type HermesGroupPolicy = "open" | "allowlist" | "disabled" | "pairing";
export interface HermesGroupCfg { policy: HermesGroupPolicy; allow: string[]; requireMention: boolean; free: string[] }

/**
 * Python do ambiente que o gateway do Hermes usa (o `hermes pm` registra em ~/.hermes/installs/<id>/facts.json; o mais
 * recente vale). É nele que os extras (faster-whisper) são instalados. Deixa em $HPY; vazio quando não há.
 */
export const HERMES_VENV_PY_SH = `HPY=$(for f in "$HOME"/.hermes/installs/*/facts.json; do [ -f "$f" ] && echo "$(stat -c %Y "$f" 2>/dev/null || echo 0) $f"; done | sort -rn | head -1 | awk '{print $2}' | xargs -r python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["packages"]["venv"]["environment"]+"/bin/python3")' 2>/dev/null); [ -x "$HPY" ] || HPY=""`;
/** Python do runtime do Hermes (tem ruamel; PyYAML nem sempre); sem ele, o python3 da máquina. Deixa em $PY. */
export const HERMES_PY_SH = `${HERMES_PATH_SH}; R=$(hermes_version | sed -n "s/^Install directory: //p"); [ -n "$R" ] || R=$HOME/.local/lib/node_modules/hermes-agent/runtime/hermes-agent; PY=$R/venv/bin/python; [ -x "$PY" ] || PY=python3`;

/**
 * Porta do bridge do WhatsApp do Hermes deste usuário, em `$HBP`. O Hermes usa a 3000 quando ninguém diz outra; com
 * vários usuários na mesma máquina (cada um com o seu número), o segundo gateway não subia. O root fica na 3000; os
 * outros ganham 3100 + (uid − 1000), gravada no config.yaml por HERMES_WA_ENSURE_SH. Ordem: config (solta ou em
 * `extra`), o registro do Hermes (~/.hermes/platforms/whatsapp/bridge_port), a regra pelo uid.
 */
export const portaBridgeHermes = (uid: number): number => (uid === 0 ? 3000 : 3100 + Math.max(0, uid - 1000));
export const HERMES_BRIDGE_PORT_SH = `${HERMES_PY_SH}; HBP=$("$PY" -c '
import os
try:
    try:
        from ruamel.yaml import YAML
        c = YAML(typ="safe").load(open(os.path.expanduser("~/.hermes/config.yaml"))) or {}
    except ImportError:
        import yaml
        c = yaml.safe_load(open(os.path.expanduser("~/.hermes/config.yaml"))) or {}
    w = (c.get("platforms") or {}).get("whatsapp") or {}
    x = w.get("extra") if isinstance(w.get("extra"), dict) else {}
    p = w.get("bridge_port", x.get("bridge_port"))
    print(int(p) if p is not None else "")
except Exception:
    print("")
' 2>/dev/null | tr -dc 0-9); [ -n "$HBP" ] || HBP=$(cat "$HOME/.hermes/platforms/whatsapp/bridge_port" 2>/dev/null | tr -dc 0-9); [ -n "$HBP" ] || { U=$(id -u); if [ "$U" = 0 ]; then HBP=3000; else HBP=$((3100 + (U > 1000 ? U - 1000 : 0))); fi; }`;

/** Imprime `gcfg=<json>` com a política de grupos como o Hermes a vê: o .env primeiro, depois o config.yaml (platforms.whatsapp, chaves soltas ou em `extra`). */
export const HERMES_GROUP_CFG_SH = `${HERMES_PY_SH}; "$PY" -c '
import json, os, re
e = {}
try:
    for l in open(os.path.expanduser("~/.hermes/.env")):
        m = re.match(r"\\s*(?:export\\s+)?([A-Z0-9_]+)\\s*=\\s*(.*)$", l)
        if m: e[m.group(1)] = m.group(2).strip().strip("\\"").strip("\\x27")
except Exception:
    pass
# ruamel primeiro: é o que o venv do Hermes tem (PyYAML nem sempre; no meu-root o import de yaml falhava, tudo vinha
# nulo e a tela recusava a mudança já gravada com "o config.yaml relido não bate").
try:
    try:
        from ruamel.yaml import YAML
        c = YAML(typ="safe").load(open(os.path.expanduser("~/.hermes/config.yaml"))) or {}
    except ImportError:
        import yaml
        c = yaml.safe_load(open(os.path.expanduser("~/.hermes/config.yaml"))) or {}
except Exception:
    c = {}
w = (c.get("platforms") or {}).get("whatsapp") or {}
if not isinstance(w, dict): w = {}
x = w.get("extra") if isinstance(w.get("extra"), dict) else {}
# Mesma ordem do Hermes (plugins/platforms/whatsapp/adapter.py, _YAML_BRIDGE): a variável do .env vence o YAML.
def pick(k, envk):
    if e.get(envk) not in (None, ""): return e[envk]
    if k in w: return w[k]
    if k in x: return x[k]
    return None
print("gcfg=" + json.dumps({"group_policy": pick("group_policy", "WHATSAPP_GROUP_POLICY"), "group_allow_from": pick("group_allow_from", "WHATSAPP_GROUP_ALLOWED_USERS"), "require_mention": pick("require_mention", "WHATSAPP_REQUIRE_MENTION"), "free_response_chats": pick("free_response_chats", "WHATSAPP_FREE_RESPONSE_CHATS")}, ensure_ascii=True))
'`;

/**
 * Grava a política de grupos em ~/.hermes/config.yaml (platforms.whatsapp), com backup ao lado e escrita atômica.
 * ruamel (round-trip) preserva comentários e os prompts por grupo; sem ele, PyYAML sem reordenar. As mesmas chaves
 * em `extra:` saem, e as variáveis equivalentes saem do ~/.hermes/.env: no Hermes o .env vence o YAML, e uma
 * WHATSAPP_GROUP_POLICY=disabled esquecida lá deixava o grupo "ligado" na tela e recusado no bridge (box-2, 6 nov).
 * Imprime `cfgset=ok`.
 */
export function hermesGroupCfgSetSh(cfg: HermesGroupCfg): string {
  const b64 = Buffer.from(JSON.stringify({ group_policy: cfg.policy, group_allow_from: cfg.allow, require_mention: cfg.requireMention, free_response_chats: cfg.free }), "utf8").toString("base64");
  return `${HERMES_PY_SH}; "$PY" -c '
import base64, json, os, shutil, sys, time
p = os.path.expanduser("~/.hermes/config.yaml")
novo = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
try:
    from ruamel.yaml import YAML
    y = YAML(); y.preserve_quotes = True; y.width = 4096; y.indent(mapping=2, sequence=4, offset=2)
    doc = (y.load(open(p)) if os.path.exists(p) else None)
    if doc is None:
        from ruamel.yaml.comments import CommentedMap
        doc = CommentedMap()
    def dump(d, f): y.dump(d, f)
except Exception:
    import yaml
    doc = (yaml.safe_load(open(p)) if os.path.exists(p) else None) or {}
    def dump(d, f): yaml.safe_dump(d, f, allow_unicode=True, sort_keys=False)
pl = doc.get("platforms")
if not isinstance(pl, dict): doc["platforms"] = pl = type(doc)()
w = pl.get("whatsapp")
if not isinstance(w, dict): pl["whatsapp"] = w = type(doc)()
x = w.get("extra")
for k in ("group_policy", "group_allow_from", "require_mention", "free_response_chats"):
    w[k] = novo[k]
    if isinstance(x, dict): x.pop(k, None)
if os.path.exists(p): shutil.copy2(p, p + ".bak-meu-bot-" + time.strftime("%Y%m%d-%H%M%S"))
tmp = p + ".tmp"
with open(tmp, "w") as f: dump(doc, f)
os.chmod(tmp, 0o600); os.replace(tmp, p)
import re
ep = os.path.expanduser("~/.hermes/.env")
fora = ("WHATSAPP_GROUP_POLICY", "WHATSAPP_GROUP_ALLOWED_USERS", "WHATSAPP_GROUP_ALLOW_FROM", "WHATSAPP_REQUIRE_MENTION", "WHATSAPP_FREE_RESPONSE_CHATS")
if os.path.exists(ep):
    linhas = open(ep).read().splitlines(True)
    resto = [l for l in linhas if not (lambda m: m is not None and m.group(1) in fora)(re.match(r"\\s*(?:export\\s+)?([A-Z0-9_]+)\\s*=", l))]
    if len(resto) != len(linhas):
        shutil.copy2(ep, ep + ".bak-meu-bot-" + time.strftime("%Y%m%d-%H%M%S"))
        with open(ep + ".tmp", "w") as f: f.writelines(resto)
        os.chmod(ep + ".tmp", 0o600); os.replace(ep + ".tmp", ep)
print("cfgset=ok")
' '${b64}'`;
}

/**
 * Abre ~/.hermes/config.yaml para editar: `doc` (ruamel round-trip preserva comentários; sem ele, PyYAML), `sub(d, k)`
 * devolve/cria um mapa filho e `salvar()` grava com backup e escrita atômica. Vai dentro de `"$PY" -c '…'` (sem aspas simples).
 */
export const HERMES_YAML_PY = `
import os, shutil, time
p = os.path.expanduser("~/.hermes/config.yaml")
try:
    from ruamel.yaml import YAML
    y = YAML(); y.preserve_quotes = True; y.width = 4096; y.indent(mapping=2, sequence=4, offset=2)
    doc = (y.load(open(p)) if os.path.exists(p) else None)
    if doc is None:
        from ruamel.yaml.comments import CommentedMap
        doc = CommentedMap()
    def dump(d, f): y.dump(d, f)
except Exception:
    import yaml
    doc = (yaml.safe_load(open(p)) if os.path.exists(p) else None) or {}
    def dump(d, f): yaml.safe_dump(d, f, allow_unicode=True, sort_keys=False)
def sub(d, k):
    v = d.get(k)
    if not isinstance(v, dict):
        d[k] = v = type(doc)()
    return v
def salvar():
    os.makedirs(os.path.dirname(p), exist_ok=True)
    if os.path.exists(p): shutil.copy2(p, p + ".bak-meu-bot-" + time.strftime("%Y%m%d-%H%M%S"))
    tmp = p + ".tmp"
    with open(tmp, "w") as f: dump(doc, f)
    os.chmod(tmp, 0o600); os.replace(tmp, p)
`;

// ------------------------------------------------------------------ "digitando…" (config.yaml do Hermes)
/**
 * "Digitando…" no Hermes: `platforms.whatsapp.typing_indicator` do config.yaml (gateway/config.py › PlatformConfig,
 * desde a 0.22.2 que o app instala), lido na subida do gateway. Ligado (o padrão), o gateway pede ao bridge o estado
 * "composing" assim que começa a processar a mensagem e renova a cada 2 s até a resposta sair (o `instant` do
 * OpenClaw); desligado, nunca. Não há `thinking`/`message` nem intervalo. A chave também vale dentro de `extra:`
 * (toplevel_or_extra), por isso os dois lugares são lidos e, ao gravar, a cópia em `extra` sai.
 * Imprime `typing=true|false|` (vazio = chave ausente).
 */
export const HERMES_TYPING_SH = `${HERMES_PY_SH}; echo "typing=$("$PY" -c '
import os
try:
    try:
        from ruamel.yaml import YAML
        c = YAML(typ="safe").load(open(os.path.expanduser("~/.hermes/config.yaml"))) or {}
    except ImportError:
        import yaml
        c = yaml.safe_load(open(os.path.expanduser("~/.hermes/config.yaml"))) or {}
except Exception:
    c = {}
w = (c.get("platforms") or {}).get("whatsapp") or {}
w = w if isinstance(w, dict) else {}
x = w.get("extra") if isinstance(w.get("extra"), dict) else {}
v = w.get("typing_indicator")
if v is None: v = x.get("typing_indicator")
print("" if v is None else ("true" if (v if isinstance(v, bool) else str(v).strip().lower() in ("1", "true", "yes", "on")) else "false"))
' 2>/dev/null)"`;

/** `typing=` do Hermes no contrato da tela: ligado = `instant`, desligado = `never`, chave ausente = null (vale o padrão do Hermes, ligado). */
export const hermesTypingModeDe = (v: string | undefined): TypingMode | null => v === "true" ? "instant" : v === "false" ? "never" : null;

/** Grava `platforms.whatsapp.typing_indicator` (true = mostrar, false = nunca) com backup e escrita atômica; tira a cópia de `extra`. Imprime `typingset=ok`. */
export const hermesTypingSetSh = (mode: TypingChoice): string => `${HERMES_PY_SH}; "$PY" -c '
${HERMES_YAML_PY}
w = sub(sub(doc, "platforms"), "whatsapp")
w["typing_indicator"] = ${mode === "instant" ? "True" : "False"}
x = w.get("extra")
if isinstance(x, dict): x.pop("typing_indicator", None)
salvar()
print("typingset=ok")
'`;

/**
 * Depois de parear o Hermes (o `hermes whatsapp` faz isto no assistente interativo): liga o WhatsApp no .env e, sem
 * escolha anterior, começa em "só você" (o mesmo padrão do OpenClaw no app). E o modelo: com `model.provider` vazio
 * ou "auto", o Hermes responde pelo backend do meu-bot desta máquina (OpenAI-compatível, modelo `agente`): é o
 * Claude Code oficial, com o rodízio de contas. Modelo já escolhido nunca é trocado. A chave
 * do backend vai por variável de ambiente, nunca por argv nem pelo app. Imprime `hwa=<o que mudou>`.
 */
export const HERMES_WA_ENSURE_SH = `${HERMES_PY_SH}; ${BACKEND_DIR_SH}
HK=$(grep '^OPENAI_COMPAT_KEY=' "$BD/.env" 2>/dev/null | head -1 | cut -d= -f2-)
HP=$(grep '^PORT=' "$BD/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -dc 0-9)
HV=$(cat "$BD/VERSION" 2>/dev/null | tr -dc '0-9.')
HK="$HK" HP="$HP" HV="$HV" "$PY" -c '
import json, os, re
${HERMES_YAML_PY}
mud = []
e = os.path.expanduser("~/.hermes/.env")
linhas = open(e).read().splitlines() if os.path.exists(e) else []
def tem(k): return any(re.match(r"\\s*(?:export\\s+)?" + k + r"\\s*=", l) for l in linhas)
def pega(k):
    for l in linhas:
        m = re.match(r"\\s*(?:export\\s+)?" + k + r"\\s*=\\s*(.*?)\\s*$", l)
        if m: return m.group(1).strip("\\"").strip("\\x27")
    return ""
eu = ""
try:
    eu = (json.load(open(os.path.expanduser("~/.hermes/whatsapp/session/creds.json"))).get("me") or {}).get("id", "")
except Exception:
    pass
eu = (re.match(r"(\\d{8,15})[:@]", eu) or [None, ""])[1]
novos = {}
if pega("WHATSAPP_ENABLED").lower() != "true": novos["WHATSAPP_ENABLED"] = "true"
if not tem("WHATSAPP_MODE"): novos["WHATSAPP_MODE"] = "self-chat"
if not tem("WHATSAPP_ALLOWED_USERS") and eu: novos["WHATSAPP_ALLOWED_USERS"] = eu
# Avisos e cron do Hermes vão para o dono; sem nada definido, o próprio número (a tela "Dono" troca os dois depois).
if not tem("WHATSAPP_HOME_CHANNEL") and eu: novos["WHATSAPP_HOME_CHANNEL"] = eu + "@s.whatsapp.net"
if novos:
    feitos = set()
    for i, l in enumerate(linhas):
        for k, v in novos.items():
            if re.match(r"\\s*(?:export\\s+)?" + k + r"\\s*=", l): linhas[i] = k + "=" + v; feitos.add(k)
    linhas += [k + "=" + v for k, v in novos.items() if k not in feitos]
    os.makedirs(os.path.dirname(e), exist_ok=True)
    tmp = e + ".tmp"; open(tmp, "w").write("\\n".join(linhas) + "\\n"); os.chmod(tmp, 0o600); os.replace(tmp, e)
    mud.append("env:" + ",".join(sorted(novos)))
m = sub(doc, "model")
prov = str(m.get("provider") or "auto").strip().lower()
grava = False
# Modelo do WhatsApp: "whatsapp" (o agente com o nível de liberdade do tutorial 7, nivel-ferramentas.js) quando o
# backend da máquina já o conhece (1.3.0+); num backend mais antigo, "agente" (o "whatsapp" daria erro lá).
def vtupla(v):
    try: return tuple(int(x) for x in (v or "0").split(".")[:3])
    except Exception: return (0,)
mod_wa = "whatsapp" if vtupla(os.environ.get("HV")) >= (1, 3, 0) else "agente"
if prov == "auto" and os.environ.get("HK") and os.environ.get("HP"):
    m["provider"] = "custom"; m["base_url"] = "http://127.0.0.1:%s/v1" % os.environ["HP"]
    m["api_key"] = os.environ["HK"]; m["default"] = mod_wa
    grava = True; mud.append("modelo:" + mod_wa)
elif prov == "custom" and str(m.get("base_url") or "").startswith("http://127.0.0.1:") and m.get("default") == "agente" and mod_wa == "whatsapp":
    m["default"] = "whatsapp"; grava = True; mud.append("modelo:whatsapp")
# Textos do gateway em português e sem a bolha "Generating speech…" no chat (só o que ainda não foi definido).
d = sub(doc, "display")
if "language" not in d: d["language"] = "pt"; grava = True; mud.append("display:pt")
w = sub(sub(d, "platforms"), "whatsapp")
if "tool_progress" not in w: w["tool_progress"] = "off"; grava = True; mud.append("display:tool_progress")
# Uma porta de bridge por usuário (o root fica na 3000 do Hermes): sem isso, o 2º gateway da máquina não sobe.
pw = sub(sub(doc, "platforms"), "whatsapp")
ex = pw.get("extra") if isinstance(pw.get("extra"), dict) else {}
if os.getuid() != 0 and "bridge_port" not in pw and "bridge_port" not in ex:
    pw["bridge_port"] = 3100 + max(0, os.getuid() - 1000); grava = True; mud.append("bridge_port:%d" % pw["bridge_port"])
if "home_channel" not in pw and eu:
    pw["home_channel"] = {"platform": "whatsapp", "chat_id": eu + "@s.whatsapp.net", "name": "Dono", "user_id": eu + "@s.whatsapp.net"}; grava = True; mud.append("home_channel")
if grava: salvar()
print("hwa=" + (";".join(mud) or "nada"))
' 2>&1 | grep '^hwa=' || echo "hwa=falhou"`;

/** Voz padrão do Hermes: Piper pt-BR local (masculina; nada sai da máquina). Extra `piper` do `hermes pm`. */
export const HERMES_PIPER_VOICE = "pt_BR-faber-medium";
/**
 * Áudio do Hermes no config.yaml. Ouvir = `stt` local em português, modelo small (bom em CPU). Responder em áudio =
 * `voice.auto_tts` (na 0.22 só vale quando a pessoa manda áudio; não há "sempre") com `tts.provider: piper` e a voz
 * pt-BR; sem a seção `tts:` o Hermes usa a Edge em inglês, e a resposta sai com sotaque americano. A Edge também fica
 * em pt-BR: alguns modelos passam `provider: edge` por conta própria na ferramenta de voz.
 */
/**
 * O Whisper local sai da memória depois de 5 min sem áudio e volta no próximo (o Hermes recarrega sob demanda). Sem
 * isso ele fica carregado para sempre: era a maior parte dos ~530 MB de cada gateway na meu-root (27 out).
 */
export const STT_OCIOSO_S = 300;
/**
 * Transcritor compartilhado da máquina: o root o instala uma vez em /opt/transcriber (dono root, 755, como o
 * /opt/hermes; ver transcritorSh no admin) e cada Hermes o chama como o próprio usuário, pelo provedor
 * `local_command`. Ninguém além do root grava lá; nenhum Hermes mexe no de outro. Caminhos em transcritor-core.ts.
 */
export { TRANSCRITOR_BIN };
/** O Hermes só lê o comando do `local_command` do ambiente (HERMES_LOCAL_STT_COMMAND no ~/.hermes/.env), não do config. */
export const HERMES_STT_COMANDO = `${TRANSCRITOR_BIN} {input_path} {output_dir} {language}`;
/** Grava (ou troca) a linha do comando no ~/.hermes/.env deste usuário; o resto do arquivo fica como está. */
export const HERMES_STT_COMPARTILHADO_SH = `install -d -m 700 "$HOME/.hermes"; [ -e "$HOME/.hermes/.env" ] || (umask 077; touch "$HOME/.hermes/.env"); sed -i '/^HERMES_LOCAL_STT_COMMAND=/d' "$HOME/.hermes/.env"; printf '%s\\n' 'HERMES_LOCAL_STT_COMMAND="${HERMES_STT_COMANDO}"' >> "$HOME/.hermes/.env"`;
/**
 * CONTORNO #4 (Hermes): cada usuário baixava o próprio transcritor e modelo (~1,5 GB) e rodava um Whisper por gateway
 * (sem issue: desenho de produto).
 * O que fazemos: um transcritor compartilhado em /opt/transcriber e cada Hermes aponta por HERMES_LOCAL_STT_COMMAND.
 * Sai quando: o Hermes oferecer STT compartilhado entre HERMES_HOMEs. Tabela: docs/guia/contornos.md.
 *
 * Ligar a transcrição no Hermes deste usuário. Com o transcritor compartilhado da máquina (`bin` executável), só aponta
 * o Hermes para ele (.env + local_command) e imprime `stt=compartilhado`; sem ele (máquina de antes do padrão), instala
 * o extra no ambiente deste usuário e grava o provedor local, imprimindo `stt=proprio`. Os dois imprimem `cfgset=ok`.
 * `bin` só muda nos testes.
 */
export const hermesSttLigarSh = (bin: string = TRANSCRITOR_BIN): string => `if [ -x ${bin} ]; then
${HERMES_STT_COMPARTILHADO_SH}
${hermesConfigSetSh(hermesAudioPatch({ kind: "in", compartilhado: true }))}
echo "stt=compartilhado"
else
${hermesPmExtraSh("stt-whisper")}
${hermesConfigSetSh(hermesAudioPatch({ kind: "in" }))}
echo "stt=proprio"
fi`;
/**
 * `cmd=1` quando o .env deste usuário tem o comando do local_command e, se o comando é o nosso, o binário existe (o root
 * pode ter tirado o /opt/transcriber). `bin` só muda nos testes.
 */
export const hermesSttCmdSh = (bin: string = TRANSCRITOR_BIN): string => `echo "cmd=$(grep -q '^HERMES_LOCAL_STT_COMMAND=' "$HOME/.hermes/.env" 2>/dev/null && { ! grep -qF '${bin}' "$HOME/.hermes/.env" || [ -x ${bin} ]; } && echo 1 || echo 0)"`;
/**
 * O que a tela mostra do áudio do Hermes, a partir das linhas `stt= prov= whisper= cmd= tts=` (e `audiomaq= audiooff=`,
 * quando vieram); null = não deu para ler.
 */
export function lerHermesAudio(out: string): { audioIn: boolean; audioOut: "off" | "inbound" | "always"; audioSoAudio?: boolean; audioVoice?: VozId | null; audioMaquina?: boolean; audioDesligado?: boolean } | null {
  const stt = /^stt=([01])$/m.exec(out); const tts = /^tts=(off|inbound|always)$/m.exec(out);
  if (stt === null || tts === null) return null;
  const kv = new Map<string, string>(); for (const l of out.split("\n")) { const i = l.indexOf("="); if (i > 0) kv.set(l.slice(0, i), l.slice(i + 1).trim()); }
  const prov = /^prov=(.*)$/m.exec(out)?.[1]?.trim() ?? "";
  // Provedor local (ou nenhum, que o Hermes resolve como local) só ouve com o faster-whisper instalado; local_command
  // (o transcritor compartilhado da máquina) só com o comando no .env e, se for o nosso, o binário lá.
  const whisper = /^whisper=1$/m.test(out); const cmd = /^cmd=1$/m.test(out);
  const ouve = stt[1] === "1" && (prov === "local" || prov === "" ? whisper : prov === "local_command" ? cmd : true);
  // `vozid=` vem do hermes-voz.sh da máquina (HERMES_VOZ_ID_SH); vazio = nenhuma voz instalada ainda.
  const vozid = kv.get("vozid");
  // "sempre" e "só áudio" são da marca do app (whatsapp-lista.json › audio), que o plugin meu-bot-pausa aplica: o
  // Hermes só tem o áudio sempre por conversa e não tem como mandar o áudio sem o texto. Sem a chave: como antes.
  const sempre = tts[1] !== "off" && kv.get("sempre") === "1";
  const so = kv.get("soaudio");
  return { audioIn: ouve, audioOut: sempre ? "always" : tts[1] as "off" | "inbound" | "always", ...(so === undefined ? {} : { audioSoAudio: so === "1" }), ...(vozid === undefined ? {} : { audioVoice: isVozId(vozid) ? vozid : null }), ...lerAudioEstado(kv) };
}
export function hermesAudioPatch(setup: { kind: "in"; off?: boolean; compartilhado?: boolean } | { kind: "out"; mode: "off" | "inbound" | "always" }): Record<string, unknown> {
  if (setup.kind === "in" && setup.off !== true && setup.compartilhado === true) return { "stt.enabled": true, "stt.provider": "local_command", "stt.language": "pt" };
  if (setup.kind === "in") return setup.off === true ? { "stt.enabled": false } : { "stt.enabled": true, "stt.provider": "local", "stt.language": "pt", "stt.local.model": "small", "stt.local.unload_after_idle_seconds": STT_OCIOSO_S };
  if (setup.mode === "off") return { "voice.auto_tts": false };
  // O provedor padrão (voz-local) entra por hermesVozLocalSh, que precisa do caminho da máquina e da voz escolhida.
  return { "voice.auto_tts": true, "tts.piper.voice": HERMES_PIPER_VOICE, "tts.edge.voice": "pt-BR-FranciscaNeural" };
}
/**
 * CONTORNO #7 (Hermes): o gateway não tem "responder em áudio sempre" como padrão (só por conversa, /voice tts) nem
 * "mandar só o áudio" (no WhatsApp o texto vai sempre depois do áudio). O que fazemos: a escolha do painel fica na
 * marca do app (whatsapp-lista.json › audio), e o plugin meu-bot-pausa (≥ 1.3.0) a aplica a cada mensagem.
 * Sai quando: o Hermes tiver as duas opções no config.yaml. Tabela: docs/guia/contornos.md.
 * Mescla só as chaves dadas (as outras marcas do arquivo ficam). Saída `audiomarca=ok`.
 */
export function hermesAudioMarcaSh(a: { sempre?: boolean; soAudio?: boolean }): string {
  const b64 = Buffer.from(JSON.stringify(a), "utf8").toString("base64");
  return `python3 -c '
import base64, json, os, sys
f = os.path.expanduser("~/.local/share/meu-bot/whatsapp-lista.json")
try:
    cur = json.load(open(f))
    assert isinstance(cur, dict)
except Exception:
    cur = {}
a = cur.get("audio") if isinstance(cur.get("audio"), dict) else {}
a.update({k: v for k, v in json.loads(base64.b64decode(sys.argv[1])).items() if k in ("sempre", "soAudio") and isinstance(v, bool)})
cur["audio"] = a
os.makedirs(os.path.dirname(f), exist_ok=True)
tmp = f + ".audio.tmp"
with open(tmp, "w") as o: json.dump(cur, o, indent=1, ensure_ascii=False)
os.chmod(tmp, 0o600); os.replace(tmp, f)
print("audiomarca=ok")
' ${b64}`;
}
/** Script de voz do meu-bot na máquina: acha o Python do gateway na hora e roda o Piper (WAV). */
export const HERMES_VOZ_SH_FILE = "$HOME/.local/share/meu-bot/hermes-voz.sh";
/**
 * Linha do hermes-voz.sh que passa o texto pelo fala-texto.py (números por extenso, sem markdown nem links; o
 * install.sh do backend o copia). O Piper lê um arquivo limpo aberto no fd 3 (já apagado do disco); sem o filtro ou
 * com falha, lê o original. O install.sh insere esta mesma linha nos hermes-voz.sh de antes dela.
 */
export const HERMES_VOZ_FILTRO = `L=$(mktemp) && python3 "$HOME/.local/share/meu-bot/fala-texto.py" <"$1" >"$L" 2>/dev/null && [ -s "$L" ] && exec 3<"$L" && set -- /dev/fd/3 "$2"; rm -f "$L"`;
/** Onde o install-voz.sh (modo motor) deixa o Kokoro: venv, modelo e o falar.py. */
const KOKORO_DIR = "$HOME/.local/share/meu-bot/voz/kokoro";
/** Voz do Kokoro de cada id nosso. */
const KOKORO_VOZ: Record<Exclude<VozId, "faber">, string> = { dora: "pf_dora", alex: "pm_alex" };
/**
 * `vozid=` da máquina, lido do próprio hermes-voz.sh (é ele que fala; uma marca à parte podia ficar para trás):
 * dora, alex, faber (script do Piper) ou vazio (sem voz instalada).
 */
export const HERMES_VOZ_ID_SH = `echo "vozid=$(F="${HERMES_VOZ_SH_FILE}"; if grep -q ${KOKORO_VOZ.dora} "$F" 2>/dev/null; then echo dora; elif grep -q ${KOKORO_VOZ.alex} "$F" 2>/dev/null; then echo alex; elif [ -f "$F" ]; then echo faber; fi)"`;
/**
 * Voz local como `tts.providers.voz-local` (type command, WAV, voice_compatible) e `tts.provider: voz-local`. O
 * provedor "piper" embutido do Hermes 0.22 grava Ogg VORBIS quando o nome termina em .ogg e pula o ffmpeg: o
 * WhatsApp não toca. Pelo command provider o Hermes recebe WAV e converte para Ogg/Opus de verdade. O comando é um
 * script nosso (HERMES_VOZ_SH_FILE), porque o venv do gateway muda de pasta a cada `hermes pm install --extra`.
 * A voz: faber roda o Piper do ambiente do gateway; dora e alex rodam o Kokoro que o `install-voz.sh motor` deixou
 * na máquina (o mesmo do OpenClaw). O script do Kokoro só troca o atual depois de falar uma frase de teste: se não
 * sair WAV, imprime `voz=falhou`, não mexe no hermes-voz.sh nem no config e SAI com 7. Por isso quem monta o script
 * da máquina põe este trecho antes de gravar `voice.auto_tts` e de reiniciar o gateway: voz reprovada, nada muda.
 * Roda depois de HERMES_PY_SH; imprime `voz=ok`.
 */
export function hermesVozLocalSh(voz: VozId = "faber"): string {
  const kokoro = voz !== "faber";
  const corpo = kokoro
    ? `# Voz local do meu-bot para o Hermes: texto em $1, WAV em $2 (o Hermes converte para Ogg/Opus). Voz: ${voz} (Kokoro).
${HERMES_VOZ_FILTRO}
exec "${KOKORO_DIR}/venv/bin/python" "${KOKORO_DIR}/falar.py" ${KOKORO_VOZ[voz]} "$2" <"$1"`
    : `# Voz local do meu-bot para o Hermes: texto em $1, WAV em $2 (o Hermes converte para Ogg/Opus).
${HERMES_VENV_PY_SH}
[ -n "$HPY" ] || { echo "sem ambiente do Hermes" >&2; exit 1; }
${HERMES_VOZ_FILTRO}
exec "$HPY" -m piper -m "$HOME/.hermes/cache/piper-voices/${HERMES_PIPER_VOICE}.onnx" -i "$1" -f "$2"`;
  // Kokoro: carrega um modelo de ~325 MB a cada fala; numa conta no teto de RAM ele não termina. Prova antes de trocar.
  const prova = kokoro ? `VT=$(mktemp -d); printf 'Olá! Esta é a voz das respostas.\\n' > "$VT/t.txt"
if timeout 150 /bin/bash "${HERMES_VOZ_SH_FILE}.novo" "$VT/t.txt" "$VT/t.wav" >/dev/null 2>"$VT/err" && [ -s "$VT/t.wav" ]; then VOZ_OK=1; else VOZ_OK=0; echo "voz=falhou $(tail -c 200 "$VT/err" 2>/dev/null | tr '\\n' ' ')"; fi
rm -rf "$VT"` : "VOZ_OK=1";
  return `mkdir -p "$(dirname "${HERMES_VOZ_SH_FILE}")"
cat > "${HERMES_VOZ_SH_FILE}.novo" <<'VOZ'
#!/bin/bash
${corpo}
VOZ
chmod 755 "${HERMES_VOZ_SH_FILE}.novo"
${prova}
if [ "$VOZ_OK" = 1 ]; then
mv -f "${HERMES_VOZ_SH_FILE}.novo" "${HERMES_VOZ_SH_FILE}"
VOZCMD="/bin/bash ${HERMES_VOZ_SH_FILE} {input_path} {output_path}" VOZT=${kokoro ? 120 : 60} "$PY" -c '
import os
${HERMES_YAML_PY}
t = sub(doc, "tts")
t["provider"] = "voz-local"
pv = sub(sub(t, "providers"), "voz-local")
pv["type"] = "command"; pv["command"] = os.environ["VOZCMD"]; pv["format"] = "wav"; pv["voice_compatible"] = True; pv["timeout"] = int(os.environ["VOZT"])
salvar()
print("voz=ok")
'
else rm -f "${HERMES_VOZ_SH_FILE}.novo"; exit 7; fi`;
}
/** A voz padrão (faber), como era antes de a voz poder ser escolhida. */
export const HERMES_VOZ_LOCAL_SH = hermesVozLocalSh("faber");
/** Grava chaves com ponto (`stt.enabled`) no config.yaml do Hermes, com backup. Imprime `cfgset=ok`. */
export function hermesConfigSetSh(patch: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(patch), "utf8").toString("base64");
  return `${HERMES_PY_SH}; "$PY" -c '
import base64, json, sys
${HERMES_YAML_PY}
for chave, valor in json.loads(base64.b64decode(sys.argv[1]).decode("utf-8")).items():
    partes = chave.split(".")
    d = doc
    for k in partes[:-1]: d = sub(d, k)
    d[partes[-1]] = valor
salvar()
print("cfgset=ok")
' '${b64}'`;
}

const jidsDe = (v: unknown): string[] => {
  const parts = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [...new Set(parts.map((s) => String(s).trim()).filter((s) => s === "*" || JID_RE.test(s)))];
};
/** O JSON de HERMES_GROUP_CFG_SH no contrato; null quando não veio objeto (não deu para ler). */
export function parseHermesGroupCfg(raw: unknown): HermesGroupCfg | null {
  if (!isObj(raw)) return null;
  const p = String(raw["group_policy"] ?? "").trim().toLowerCase();
  const policy: HermesGroupPolicy = p === "open" || p === "allowlist" || p === "disabled" ? p : "pairing";
  const rm = raw["require_mention"];
  const requireMention = typeof rm === "boolean" ? rm : typeof rm === "string" ? truthy(rm) : false;
  return { policy, allow: jidsDe(raw["group_allow_from"]), requireMention, free: jidsDe(raw["free_response_chats"]) };
}
/** Todos os grupos admitidos (`open`, ou `allowlist` com "*"): o mesmo "perigoso" da tela. */
export const hermesTodosAdmitidos = (cfg: HermesGroupCfg | null): boolean => cfg !== null && (cfg.policy === "open" || (cfg.policy === "allowlist" && cfg.allow.includes("*")));
const hermesAdmitido = (cfg: HermesGroupCfg, jid: string): boolean => cfg.policy === "open" || (cfg.policy === "allowlist" && (cfg.allow.includes(jid) || cfg.allow.includes("*")));
/** Estado de um grupo no contrato do app, pela config (null = sem config legível: nada ligado). */
export function hermesEstadoDoGrupo(cfg: HermesGroupCfg | null, jid: string): WhatsappGroupAgent {
  if (cfg === null || !hermesAdmitido(cfg, jid)) return "desligado";
  return !cfg.requireMention || cfg.free.includes(jid) ? "sempre" : "mencao";
}
/**
 * Config nova para o pedido da tela; null = nada a mudar. "Quem aciona" não existe por grupo no Hermes: a tela é
 * mandada para "Quem o agente responde", que é a lista única. Desligar o último grupo volta a `disabled` (lista
 * vazia com `allowlist` já é nenhum grupo, mas `disabled` diz isso sem depender da leitura). Com todos os grupos
 * admitidos (`open`/"*") não há lista para tirar um grupo nem para preservar os outros: explica em vez de chutar.
 */
export function hermesGroupCfgPara(cfg: HermesGroupCfg | null, jid: string, pedido: WhatsappGroupPatch): HermesGroupCfg | null {
  if (pedido.quemAciona !== undefined) throw new Error("no Hermes quem pode chamar o agente é uma lista só, a mesma das conversas diretas: mude em \"Quem o agente responde\", na tela do WhatsApp desta máquina");
  if (pedido.agente === undefined) return null;
  const base: HermesGroupCfg = cfg ?? { policy: "pairing", allow: [], requireMention: false, free: [] };
  if (hermesEstadoDoGrupo(base, jid) === pedido.agente) return null;
  const todos = hermesTodosAdmitidos(base);
  if (todos && pedido.agente === "desligado") throw new Error("a configuração do Hermes admite TODOS os grupos (group_policy open ou \"*\"): para desligar um grupo, troque group_allow_from por uma lista no ~/.hermes/config.yaml");
  if (todos && pedido.agente === "mencao" && !base.requireMention) throw new Error("com TODOS os grupos admitidos não dá para deixar só este \"quando chamado\" sem mudar os outros: troque group_allow_from por uma lista no ~/.hermes/config.yaml");
  let allow = [...base.allow]; let free = [...base.free]; let { policy, requireMention } = base;
  if (pedido.agente === "desligado") {
    allow = allow.filter((j) => j !== jid); free = free.filter((j) => j !== jid);
    policy = allow.length === 0 ? "disabled" : "allowlist";
  } else {
    if (!todos) { policy = "allowlist"; if (!allow.includes(jid)) allow.push(jid); }
    if (pedido.agente === "sempre") { if (requireMention && !free.includes(jid)) free.push(jid); }
    else {
      // Primeiro grupo "quando chamado" numa máquina que respondia a tudo: a menção passa a valer para todos e os
      // outros ligados viram exceção, para continuarem respondendo sempre.
      if (!requireMention) { requireMention = true; for (const j of base.allow) if (j !== jid && j !== "*" && !free.includes(j)) free.push(j); }
      free = free.filter((j) => j !== jid);
    }
  }
  return { policy, allow, requireMention, free };
}

const msDe = (v: unknown): number => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0; return !Number.isFinite(n) || n <= 0 ? 0 : n < 1e11 ? n * 1000 : n; };
/**
 * Grupos da máquina com Hermes no contrato do app: a lista admitida (config) mais os grupos com sessão no state.db
 * (HERMES_GROUPS_PY; uma sessão por remetente, a mais recente dá hora, chave e id). `quemAciona` é a lista única
 * das conversas diretas (quem chama o agente nos grupos é quem ele responde no privado); nunca "herdado", porque
 * no Hermes não há lista própria para herdar de. O Hermes guarda a sessão de grupo com o id como nome, então o nome
 * vem do cache da skill whatsapp-grupos quando ele existe na máquina (`cache`); sem ele, fica sem nome (apelido na tela).
 */
export function gruposHermes(cfg: HermesGroupCfg | null, data: unknown, self: string | null, quemAciona: string[] | "todos", cache: unknown = null): WhatsappGroups {
  const byJid = new Map<string, WhatsappGroup>();
  const get = (jid: string): WhatsappGroup => {
    let g = byJid.get(jid);
    if (g === undefined) { g = { jid, nome: null, apelido: null, membros: null, participantes: [], agente: "desligado", sessionKey: null, sessionId: null, transcript: null, updatedAt: null, agenteRespondeu: false, deleted: false }; byJid.set(jid, g); }
    return g;
  };
  const lido = parseCacheGrupos(cache);
  for (const c of lido.grupos) { const g = get(c.jid); if (c.nome !== "") g.nome = c.nome; g.membros = c.membros; g.participantes = c.participantes; }
  const rows = isObj(data) && Array.isArray(data.sessions) ? data.sessions : [];
  for (const s of rows) {
    if (!isObj(s) || typeof s.key !== "string") continue;
    const k = hermesGroupOfKey(s.key);
    if (k === null) continue;
    const g = get(k.jid);
    const last = msDe(s.last) || msDe(s.started);
    if (last > 0 && (g.updatedAt === null || last > Date.parse(g.updatedAt))) { g.updatedAt = new Date(last).toISOString(); g.sessionKey = s.key; g.sessionId = typeof s.id === "string" && HERMES_ID_RE.test(s.id) ? s.id : null; }
    if (g.nome === null) g.nome = nameOf(s.name);
    if (typeof s.count === "number" && s.count > 0) g.agenteRespondeu = true;
  }
  if (cfg !== null) for (const jid of cfg.allow) if (JID_RE.test(jid)) get(jid);
  for (const g of byJid.values()) g.agente = hermesEstadoDoGrupo(cfg, g.jid);
  const peso = (g: WhatsappGroup): number => (g.agente === "desligado" ? 1 : 0);
  const grupos = [...byJid.values()].sort((a, b) => peso(a) - peso(b) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || (a.nome ?? a.jid).localeCompare(b.nome ?? b.jid));
  return { grupos, quemAciona, quemAcionaHerdado: false, quemListaUnica: true, todosAdmitidos: hermesTodosAdmitidos(cfg), cacheEm: lido.em, skill: false, self: self === null ? null : (self.split(/[:@]/)[0] ?? "").replace(/\D/g, "") || null };
}
