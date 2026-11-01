/**
 * O agente sabe que foi pausado e que voltou. A pausa do meu-bot é só `sendPolicy: "deny"` na sessão do contato:
 * o agente continua rodando e o gateway descarta a entrega, sem avisar ninguém. Aqui, as duas peças que dão o
 * contexto a ele, iguais em todas as máquinas (a regra é do meu-bot, que é quem pausa):
 *
 * 1. uma nota na própria conversa ao pausar e ao retomar, como um turno de verdade do agente
 *    (`openclaw agent --session-key … --message-file …`, sem entregar nada ao WhatsApp): com o runtime
 *    claude-cli o contexto do modelo é a sessão do Claude Code, e só um turno chega lá. O `chat.inject` do
 *    gateway grava uma linha "visível ao operador" no transcript, mas o modelo nunca a vê (testado: o agente
 *    disse que nenhum aviso chegou). A de retomada aponta para a de pausa, então não há estado a guardar;
 * 2. um bloco padrão no AGENTS.md do workspace do agente explicando o que as notas significam e como agir.
 *
 * A pausa também fica numa lista durável, as regras `session.sendPolicy.rules` do openclaw.json (`deny` por
 * prefixo da chave do contato): a marca na sessão some quando a conversa é limpa ou excluída, a regra não. O
 * OpenClaw olha primeiro a marca da sessão e depois as regras ("primeira negação vence"), então pausar grava as
 * duas e retomar tira as duas.
 *
 * Puro (sem Electron): whatsapp.ts e ipc/client.ts rodam os scripts por SSH.
 */
import { SAFE_KEY } from "./whatsapp-chats";

/** Regra de envio do openclaw.json (session.sendPolicy.rules[]). */
export interface SendPolicyRule { action?: string; match?: { channel?: string; chatType?: string; keyPrefix?: string; rawKeyPrefix?: string } }
export interface SendPolicy { rules?: SendPolicyRule[]; default?: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Número de uma regra de pausa do meu-bot (deny com prefixo `…whatsapp:[conta:]direct:+N`), senão null. */
function pausedNumberOfRule(r: unknown): string | null {
  if (!isObj(r) || String(r.action ?? "").toLowerCase() !== "deny" || !isObj(r.match)) return null;
  const m = r.match;
  if (m.channel !== undefined || m.chatType !== undefined) return null;
  const prefix = typeof m.keyPrefix === "string" ? m.keyPrefix : typeof m.rawKeyPrefix === "string" ? m.rawKeyPrefix : "";
  const x = /(?:^|:)whatsapp:(?:[^:]+:)?direct:\+?(\d{8,15})$/i.exec(prefix);
  return x === null ? null : x[1]!;
}
/** A regra é de um agente (`rawKeyPrefix: agent:<id>:…`)? null = regra sem agente (`keyPrefix`, vale para qualquer agente). */
function agentOfRule(r: unknown): string | null {
  if (!isObj(r) || !isObj(r.match) || typeof r.match.rawKeyPrefix !== "string") return null;
  return /^agent:([^:]+):/.exec(r.match.rawKeyPrefix)?.[1] ?? null;
}
/**
 * Números pausados pela lista durável (session.sendPolicy do openclaw.json; formato desconhecido = nenhum). Com `agentId`
 * (gateway compartilhado), só as regras desse agente: a pausa de um contato no agente de outro usuário não é deste.
 */
export function pausedNumbersOfPolicy(policy: unknown, agentId: string | null = null): Set<string> {
  const out = new Set<string>();
  if (!isObj(policy) || !Array.isArray(policy.rules)) return out;
  for (const r of policy.rules) {
    if (agentId !== null && agentOfRule(r) !== agentId) continue;
    const n = pausedNumberOfRule(r); if (n !== null) out.add(n);
  }
  return out;
}
/**
 * Prefixos das regras para um contato. Sem `agentId`: a chave de cada sessão própria sem o "agent:<id>:" (vale para
 * qualquer agente; `keyPrefix`); sem sessão própria ainda, a forma padrão `whatsapp:direct:+N` (dmScope per-channel-peer).
 * Com `agentId` (gateway compartilhado, `rawKeyPrefix`): a chave inteira com o agente, só as sessões dele; sem sessão,
 * `agent:<id>:whatsapp:direct:+N`. Sem o agente na regra, pausar num usuário pausaria o contato nos agentes de todos.
 */
export function pauseRulePrefixes(number: string, ownKeys: readonly string[], agentId: string | null = null): string[] {
  const n = number.replace(/\D/g, "");
  const seguras = ownKeys.filter((k) => SAFE_KEY.test(k));
  if (agentId !== null) {
    const doAgente = seguras.filter((k) => k.startsWith(`agent:${agentId}:`) && new RegExp(`:whatsapp:(?:[^:]+:)?direct:\\+?${n}$`).test(k));
    return [...new Set(doAgente.length > 0 ? doAgente : [`agent:${agentId}:whatsapp:direct:+${n}`])];
  }
  const fromKeys = seguras.map((k) => k.replace(/^agent:[^:]+:/, "")).filter((k) => new RegExp(`^whatsapp:(?:[^:]+:)?direct:\\+?${n}$`).test(k));
  return [...new Set(fromKeys.length > 0 ? fromKeys : [`whatsapp:direct:+${n}`])];
}
/**
 * A política com o contato pausado ou retomado: tira as regras de pausa dele (as deste agente, com `agentId`; todas,
 * sem) e, se pausado, põe as novas no começo (primeira negação vence). As outras regras e o `default` ficam como
 * estavam. Devolve null quando não sobra nada para guardar (aí a chave sai do openclaw.json, como era antes da primeira
 * pausa). Com `agentId` as regras novas vão em `rawKeyPrefix` (a chave inteira, com o agente).
 */
export function withPauseRule(policy: unknown, number: string, paused: boolean, prefixes: readonly string[], agentId: string | null = null): SendPolicy | null {
  const n = number.replace(/\D/g, "");
  const base: SendPolicy = isObj(policy) ? { ...(policy as SendPolicy) } : {};
  const others = (Array.isArray(base.rules) ? base.rules : []).filter((r) => pausedNumberOfRule(r) !== n || (agentId !== null && agentOfRule(r) !== agentId));
  const rules = paused ? [...prefixes.map((p): SendPolicyRule => ({ action: "deny", match: agentId === null ? { keyPrefix: p } : { rawKeyPrefix: p } })), ...others] : others;
  const out: SendPolicy = { ...base, rules };
  if (rules.length === 0) delete out.rules;
  return Object.keys(out).length === 0 ? null : out;
}
/** Script que grava a política (ou tira a chave, se null) no openclaw.json; imprime POL=1 se deu certo. */
export function sendPolicySh(policy: SendPolicy | null): string {
  if (policy === null) return `timeout 60 openclaw config unset session.sendPolicy >/dev/null 2>&1; echo POL=1`;
  const json = JSON.stringify(policy).replace(/'/g, "'\\''");
  return `timeout 60 openclaw config set session.sendPolicy '${json}' --strict-json >/dev/null 2>&1 && echo POL=1 || echo POL=0`;
}
/** Leitura da política atual (o openclaw.json é JSON puro): uma linha `policy=<json|null>`. */
export const SEND_POLICY_READ_SH = `echo "policy=$(python3 -c 'import json,os;c=json.load(open(os.path.expanduser("~/.openclaw/openclaw.json")));print(json.dumps((c.get("session") or {}).get("sendPolicy")))' 2>/dev/null)"`;

export type PauseBy = "dono" | "admin";

/** Só chaves que o próprio OpenClaw gera entram no script remoto (as mesmas de whatsapp.ts). */


export const PAUSE_RULE_VERSION = 2;
const RULE_START = `<!-- meu-bot:pausa v${PAUSE_RULE_VERSION} inicio -->`;
const RULE_END = `<!-- meu-bot:pausa v${PAUSE_RULE_VERSION} fim -->`;
export const PAUSE_RULE_BLOCK = `${RULE_START}
## Pausa pelo meu-bot
O app meu-bot pode pausar você para um contato. Você sabe pelas notas "Nota do meu-bot: … pausado …" e
"… pausa encerrada …" no histórico desta conversa.
- Enquanto pausado: as mensagens do contato continuam chegando, mas nada do que você responder é entregue.
  Responda exatamente NO_REPLY a cada mensagem dele (e às notas do meu-bot): nada fica registrado como
  resposta sua. Não insista, não repita, não tente outro canal.
- Ao ver "pausa encerrada": na próxima mensagem do contato, responda ao que ficou pendente numa mensagem só,
  resumida. Não repita respostas antigas.
- A pausa é um controle interno do dono: nunca mencione ao contato que você foi pausado ou retomado.
${RULE_END}
`;

/** "17/10/2026 00:20 (Horário Padrão de Brasília)": a hora do Mac de quem clicou, porque a VM costuma estar em UTC. */
export function localWhenText(d: Date, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "long", ...(timeZone === undefined ? {} : { timeZone }) };
  const parts = new Intl.DateTimeFormat("pt-BR", opts).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")} (${get("timeZoneName")})`;
}

/**
 * A nota que entra na conversa como mensagem para o agente. Começa com "Nota do meu-bot:" (não é o contato
 * falando) e pede uma resposta de uma palavra: a resposta não é entregue, só fecha o turno.
 */
export function pauseNoteText(kind: "pause" | "resume", whenText: string, by: PauseBy): string {
  const who = by === "admin" ? "pelo suporte" : "pelo dono do número";
  const tail = " Responda a esta nota apenas com NO_REPLY. A pausa é controle interno do dono: nunca a mencione ao contato.";
  return kind === "pause"
    ? `Nota do meu-bot: o agente foi pausado para este contato em ${whenText} ${who}. A partir daqui, nada do que você responder será entregue ao contato. Enquanto a pausa durar, responda NO_REPLY a tudo o que ele mandar: não escreva nada, nem para registrar.${tail}`
    : `Nota do meu-bot: pausa encerrada em ${whenText} ${who}. Nada do que você respondeu desde a nota "pausado" acima chegou ao contato; ele só vê o que você mandar a partir de agora. Na próxima mensagem dele, responda ao que ficou pendente de forma resumida, sem repetir tudo.${tail}`;
}

/**
 * Um turno do agente na sessão com a nota, em segundo plano na máquina (a pausa em si volta na hora; a nota
 * entra uns segundos depois). `openclaw agent` sem `--deliver` não manda nada ao WhatsApp; a mensagem vai por
 * arquivo (base64 → mktemp) para texto com aspas e acentos não passar pelo shell. Imprime NOTA=agendada.
 */
export function pauseNoteSh(key: string, text: string): string {
  if (!SAFE_KEY.test(key)) throw new Error("chave de sessão inválida");
  const b64 = Buffer.from(text, "utf8").toString("base64");
  return `F=$(mktemp /tmp/meu-bot-nota.XXXXXX) && printf '%s' '${b64}' | base64 -d > "$F" && ( nohup sh -c 'timeout 180 openclaw agent --session-key "$1" --message-file "$2" >/dev/null 2>&1; rm -f "$2"' sh '${key}' "$F" >/dev/null 2>&1 & ) && echo "NOTA=agendada" || echo "NOTA=erro"`;
}

/**
 * Garante o bloco da pausa no AGENTS.md do workspace do agente (o configurado, senão ~/.openclaw/workspace).
 * Idempotente: sem bloco acrescenta no fim; bloco de outra versão é trocado; igual, nada. Imprime REGRA=1
 * (gravou/trocou), REGRA=0 (já estava) ou REGRA=erro.
 */
export function pauseRuleSh(workspaceSh = `W="$(openclaw config get agents.defaults.workspace 2>/dev/null | tr -d '\\n')"; case "$W" in /*) ;; *) W="$HOME/.openclaw/workspace" ;; esac`): string {
  const b64 = Buffer.from(PAUSE_RULE_BLOCK, "utf8").toString("base64");
  return `${workspaceSh}
mkdir -p "$W" && printf '%s' '${b64}' | base64 -d | python3 -c '
import re, sys, os
f = sys.argv[1]
block = sys.stdin.read()
try:
    cur = open(f, encoding="utf-8").read()
except FileNotFoundError:
    cur = ""
pat = re.compile(r"\\n?<!-- meu-bot:pausa v\\d+ inicio -->.*?<!-- meu-bot:pausa v\\d+ fim -->\\n?", re.S)
m = pat.search(cur)
if m and m.group(0).strip() == block.strip():
    print("REGRA=0"); sys.exit(0)
new = (cur[:m.start()] + "\\n" + block + cur[m.end():]) if m else (cur + ("" if cur == "" or cur.endswith("\\n") else "\\n") + "\\n" + block)
tmp = f + ".tmp"
open(tmp, "w", encoding="utf-8").write(new)
os.replace(tmp, f)
print("REGRA=1")
' "$W/AGENTS.md" 2>/dev/null || echo "REGRA=erro"`;
}
