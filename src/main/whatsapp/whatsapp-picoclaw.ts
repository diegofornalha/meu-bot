/**
 * PicoClaw (sipeed): o canal "whatsapp" do ~/.picoclaw/config.json em modo nativo (whatsmeow dentro do gateway). A
 * sessão é o store.db na pasta do canal; "no ar" é o /health do gateway. Serviço: runit no Termux, systemd de usuário
 * fora. Só estado e reinício estão mapeados; o QR sai no registro do gateway (capacidades: parear e política de DM).
 */
import type { WhatsappDmPolicy, WhatsappStatus } from "../../shared/ipc";
import type { Exec, MotorWhatsapp } from "./whatsapp-motor";
import { runSsh } from "./whatsapp-ssh";
import { describeInstall, phoneOf } from "./whatsapp-kv";

export const PICOCLAW_STATUS_SH = `echo gateway=picoclaw; echo present=1
  echo "bin=$(command -v picoclaw)"
  echo "ver=$(NO_COLOR=1 timeout 10 picoclaw version 2>/dev/null | grep -o 'picoclaw [^ ]*' | head -1)"
  python3 - <<'PY' 2>/dev/null
import json, os, sqlite3
h = os.path.expanduser("~/.picoclaw")
c = json.load(open(h + "/config.json"))
w = (c.get("channel_list") or {}).get("whatsapp") or {}
s = w.get("settings") or {}
print("enabled=%d" % bool(w.get("enabled")))
print("type=%s" % (w.get("type") or ""))
print("native=%d" % bool(s.get("use_native")))
print("selfchat=%d" % bool(s.get("self_chat_only")))
print("allow=%s" % ",".join(str(x) for x in (w.get("allow_from") or [])))
print("port=%s" % ((c.get("gateway") or {}).get("port") or 18790))
ws = ((c.get("agents") or {}).get("defaults") or {}).get("workspace") or (h + "/workspace")
db = os.path.join(s.get("session_store_path") or os.path.join(ws, "whatsapp"), "store.db")
print("store=%d" % os.path.exists(db))
print("channel=%s" % json.dumps(w))
try:
    r = sqlite3.connect(db).execute("select jid from whatsmeow_device").fetchone()
    print("me=%s" % (r[0] if r else ""))
except Exception:
    print("me=")
PY
  P=$(python3 -c 'import json,os;c=json.load(open(os.path.expanduser("~/.picoclaw/config.json")));print((c.get("gateway") or {}).get("port") or 18790)' 2>/dev/null)
  echo "health=$(curl -s -m 3 "http://127.0.0.1:\${P:-18790}/health" 2>/dev/null | tr -d '\\n')"
  echo "svc=$( { [ -n "$PREFIX" ] && SVDIR=$PREFIX/var/service sv status picoclaw 2>/dev/null; } || systemctl --user is-active picoclaw-gateway 2>/dev/null)"
  exit 0`;

/** Reinício com força no Termux (fechar o WhatsApp pode travar o TERM); systemd de usuário fora dele. */
export const PICOCLAW_RESTART_SH = `{ [ -n "$PREFIX" ] && SVDIR=$PREFIX/var/service sv -w 30 force-restart picoclaw 2>&1; } || systemctl --user restart picoclaw-gateway 2>&1`;

/**
 * O canal `whatsapp` do config.json (modo nativo), a sessão (store.db) e o /health do gateway. Puro sobre o
 * `chave=valor` do STATUS_SCRIPT, para o teste. Sem `channels status` como o OpenClaw: "conectado" é sessão pareada +
 * gateway no ar (o canal reconecta sozinho ao subir).
 */
export function picoclawStatus(kv: Map<string, string>): Omit<WhatsappStatus, "capacidades"> {
  const agent = describeInstall("PicoClaw", kv);
  const enabled = kv.get("enabled") === "1";
  const native = kv.get("type") === "whatsapp_native" || kv.get("native") === "1";
  if (!enabled || !native) {
    const missing = !enabled ? "o canal whatsapp está desligado no ~/.picoclaw/config.json (channel_list.whatsapp.enabled)" : "o canal whatsapp não está em modo nativo (type \"whatsapp_native\" + settings.use_native no config.json)";
    return { present: true, gateway: "picoclaw", agent, ready: false, missing, connected: false, state: "sem configurar", number: null, loggedOut: false, detail: `PicoClaw instalado, mas ${!enabled ? "com o WhatsApp desligado" : "sem o WhatsApp nativo"}`, dmPolicy: null, channelConfig: null };
  }
  const number = phoneOf(kv.get("me") ?? "");
  const paired = kv.get("store") === "1" && number !== null;
  let running = false;
  try { const h = JSON.parse(kv.get("health") || "{}") as { status?: unknown }; running = h.status === "ok"; } catch { /* gateway fora do ar */ }
  const svc = (kv.get("svc") ?? "").trim();
  const state = running ? (paired ? "conectado" : "sem sessão") : svc.startsWith("down") ? "gateway parado" : svc.startsWith("run") ? "gateway iniciando" : "gateway fora do ar";
  const connected = running && paired;
  const detail = connected ? "conectado" : !paired ? "sem sessão; precisa parear (o QR sai no registro do gateway)" : state === "gateway parado" ? "sessão pareada, gateway parado (serviço picoclaw)" : `sessão pareada, ${state}`;
  // Quem responde: self_chat_only = só a conversa do próprio número; allow_from = lista; nada = todo mundo.
  const allow = (kv.get("allow") ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "");
  const dmPolicy: WhatsappDmPolicy = kv.get("selfchat") === "1" || allow.length > 0 ? "allowlist" : "open";
  let channelConfig: string | null = null;
  try { const raw = kv.get("channel") ?? ""; if (raw !== "") channelConfig = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* bloco ilegível */ }
  return { present: true, gateway: "picoclaw", agent, ready: true, missing: null, connected, state, number, loggedOut: false, detail, dmPolicy, channelConfig, ...(allow.length > 0 ? { allowFrom: allow } : {}) };
}

const naoTem = (o: string): never => { throw new Error(`o PicoClaw desta máquina ainda não ${o} pelo app`); };

export function criarMotorPicoclaw(_run: Exec = runSsh): MotorWhatsapp {
  return {
    nome: "picoclaw",
    statusSh: PICOCLAW_STATUS_SH,
    parseStatus: (_host, kv) => picoclawStatus(kv),
    chatsSh: "echo gateway=picoclaw",
    parseChats: () => [],
    groupsSh: "echo gateway=picoclaw",
    parseGroups: () => ({ grupos: [], quemAciona: [], quemAcionaHerdado: false, todosAdmitidos: false, cacheEm: null, skill: false, self: null }),
    pairSh: `echo '{"event":"error","error":"o PicoClaw pareia pelo registro do gateway (o QR sai lá), não pelo app"}'; exit 2`,
    logoutSh: "echo OUT=none",
    restartSh: PICOCLAW_RESTART_SH,
    readQuem: async () => naoTem("diz quem manda"),
    thread: async () => naoTem("lista conversas"),
    learnNames: async () => ({}),
    clearSessions: async () => naoTem("limpa histórico"),
    pause: async () => naoTem("pausa contatos"),
    keepPaused: async () => naoTem("pausa contatos"),
    setDmPolicy: async () => naoTem("muda quem responde"),
    groupClearPlan: async () => ({ sessoes: 0 }),
    groupClear: async () => naoTem("limpa grupos"),
    groupThread: async () => [],
    setGroup: async () => naoTem("muda grupos"),
    refreshGroups: async () => naoTem("lista grupos"),
  };
}
