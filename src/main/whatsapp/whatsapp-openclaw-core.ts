/**
 * OpenClaw, parte pura: os trechos de shell que os scripts da máquina usam (status, pareamento, lista, grupos, logout,
 * política, trava do dono) e o parse do que eles imprimem. Nada aqui fala com a máquina; whatsapp-openclaw.ts é o IO.
 */
import type { VoiceReplyMode, WhatsappAlvo, WhatsappDmPolicy, WhatsappStatus } from "../../shared/ipc";
import { DESCONHECIDO_DENY, NAV_DENY } from "../navegador/navegador-whatsapp-core";
import { OPENCLAW_WA_PLUGIN_VERSAO } from "../maquina/motor-versoes";
import { donosDe, type WaQuem } from "./whatsapp-marks";
import { isVozId } from "./vozes-core";
import { describeInstall, phoneOf } from "./whatsapp-kv";

/** O alvo de sempre: conta `default`, agente `main`, gateway próprio. */
export const ALVO_PADRAO: WhatsappAlvo = { accountId: "default", agentId: "main", gatewayUser: null };
/** Onde a conta vive no openclaw.json: a raiz para `default`, `channels.whatsapp.accounts.<id>` para as nomeadas. */
export const cfgDe = (a: WhatsappAlvo): string => (a.accountId === "default" ? "channels.whatsapp" : `channels.whatsapp.accounts.${a.accountId}`);
/** Credenciais do WhatsApp da conta (creds.json do Baileys). */
export const credsDe = (a: WhatsappAlvo): string => `$HOME/.openclaw/credentials/whatsapp/${a.accountId}/creds.json`;
/** Número pareado lido direto do creds.json (barato); evita o `channels status` caro só para montar o allowFrom. */
export const credsMeSh = (a: WhatsappAlvo): string => `python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "${credsDe(a)}" 2>/dev/null`;
export const CREDS_ME = credsMeSh(ALVO_PADRAO);
/** O banco do agente (sessões, transcript) no gateway. */
export const sqliteDe = (a: WhatsappAlvo): string => `~/.openclaw/agents/${a.agentId}/agent/openclaw-agent.sqlite`;
/**
 * Deixa em $W o workspace do agente: `agents.entries.<id>.workspace`, senão `agents.defaults.workspace` (só para `main`),
 * senão `~/.openclaw/workspace` (`main`) ou `~/.openclaw/workspace-<id>` (os outros), como o OpenClaw resolve.
 */
export const workspaceSh = (a: WhatsappAlvo): string => `W=$(python3 - '${a.agentId}' <<'PY' 2>/dev/null
import json, os, sys
aid = sys.argv[1]
try:
    c = json.load(open(os.path.expanduser("~/.openclaw/openclaw.json")))
except Exception:
    c = {}
ag = c.get("agents") or {}
w = ((ag.get("entries") or {}).get(aid) or {}).get("workspace") or (((ag.get("defaults") or {}).get("workspace") or "") if aid == "main" else "")
print(os.path.expanduser(w) if w else os.path.expanduser("~/.openclaw/workspace" if aid == "main" else "~/.openclaw/workspace-" + aid))
PY
); case "$W" in /*) ;; *) W="$HOME/.openclaw/workspace${a.agentId === "main" ? "" : `-${a.agentId}`}" ;; esac`;
export const WA_GRUPOS_DIR = "$HOME/.claude/skills/whatsapp-grupos";

/**
 * A vista efetiva de uma conta no `channels.whatsapp` (Python, para os scripts): a conta nomeada herda de `accounts.default`
 * e da raiz tudo menos authDir, enabled, name e selfChatMode (como o OpenClaw documenta); a `default` é a raiz mais o
 * bloco `accounts.default`. É o que o app lê e confere como "a config do canal" desta conta.
 */
export const CONTA_EFETIVA_PY = `def efetiva(c, aid):
    w = (c.get("channels") or {}).get("whatsapp") or {}
    accs = w.get("accounts") or {}
    d = accs.get("default") or {}
    if aid == "default":
        base = {k: v for k, v in w.items() if k != "accounts"}; base.update(d); return base
    excl = {"authDir", "enabled", "name", "selfChatMode", "accounts"}
    base = {k: v for k, v in w.items() if k not in excl}
    base.update({k: v for k, v in d.items() if k not in excl})
    base.update(accs.get(aid) or {})
    return base`;

/**
 * O plugin do WhatsApp do OpenClaw está instalado e ligado? Pelo id exato ("whatsapp") no `plugins list --json`:
 * contar a palavra no texto da lista dava falso positivo com os plugins do meu-bot ("guarda do WhatsApp",
 * "CRM pelo WhatsApp"), e numa VM nova o login caía num assistente que se cancela ("wizard cancelled").
 */
export const WA_PLUGIN_SH = `wa_plugin() { timeout 40 openclaw plugins list --json 2>/dev/null | python3 -c 'import json,sys
t=sys.stdin.read(); i=t.find("{")
try: d=json.loads(t[i:]) if i>=0 else {}
except Exception: d={}
print(int(any(p.get("id")=="whatsapp" and p.get("enabled",True) is not False for p in d.get("plugins",[]) if isinstance(p,dict))))' 2>/dev/null || echo 0; }`;

/**
 * Gateway do OpenClaw desta conta apontando para o gateway de OUTRA conta (duas contas na mesma máquina: a
 * segunda fica sem \`gateway.port\`, a CLI cai no padrão 18789, que é da primeira, e tudo responde "gateway token
 * mismatch"; o serviço dela, preso à mesma porta, nunca sobe). Conserto: a primeira porta livre a partir da
 * configurada vira \`gateway.port\`, o serviço é regravado nela (\`gateway install --force --port\`) e esperamos o
 * \`channels status\` responder. Só para gateway local sob systemd; sob supervisord (computador do Grok Bot)
 * ou modo remoto, não mexe. Imprime a porta nova em stdout; falha em silêncio (código 1).
 */
export const GATEWAY_FIX_SH = `
# GW_PROPRIO=1: o gateway do OpenClaw é desta conta (hoje sempre). Com gateway compartilhado (0), o app nunca instala,
# religa nem muda a porta de gateway nenhum: foi o gw_ensure que religou o gateway do root da VM agente (1 nov).
GW_PROPRIO=\${GW_PROPRIO:-1}
gw_mismatch() { timeout 25 openclaw channels status --json 2>&1 | grep -q 'token mismatch'; }
gw_fix() {
  [ "$GW_PROPRIO" = 1 ] || return 1
  [ "$(openclaw config get gateway.mode 2>/dev/null | tr -d '"')" = "local" ] || return 1
  [ -d /run/systemd/system ] || return 1
  supervisorctl status 2>/dev/null | grep -q openclaw-gateway && return 1
  P=$(openclaw config get gateway.port 2>/dev/null); case "$P" in *unset*) P=;; esac; P=$(printf '%s' "$P" | tr -dc 0-9); [ -n "$P" ] || P=18789
  L=$(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null)
  N=$P; while echo "$L" | grep -q ":$N "; do N=$((N+1)); [ $N -gt $((P+30)) ] && return 1; done
  openclaw config set gateway.port "$N" >/dev/null 2>&1 || return 1
  timeout 150 openclaw gateway install --force --port "$N" >/dev/null 2>&1 || return 1
  systemctl --user reset-failed openclaw-gateway.service >/dev/null 2>&1
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 3; if timeout 20 openclaw channels status --json >/dev/null 2>&1; then echo "$N"; return 0; fi; done
  return 1
}
# Agente do WhatsApp sem modelo (OpenClaw recém-instalado cai num padrão sem chave, ex. openai/gpt-6-astra, e não
# responde nada): com o Claude Code logado nesta conta, usa o Claude por ele (runtime claude-cli), como na agente-box.
# Modelo já escolhido (à mão ou antes) nunca é trocado. Imprime "set" quando gravou.
oc_model_ensure() {
  M=$(openclaw config get agents.defaults.model 2>&1 || true)
  case "$M" in *unset*|"") ;; *) return 0 ;; esac
  { [ -s "$HOME/.claude/.credentials.json" ] || grep -q '"oauthAccount"' "$HOME/.claude.json" 2>/dev/null; } || return 0
  openclaw config set agents.defaults.models '{"anthropic/claude-opus-5-5":{"agentRuntime":{"id":"claude-cli"}},"anthropic/claude-sonnet-5-5":{"agentRuntime":{"id":"claude-cli"}},"anthropic/claude-haiku-5-5":{"agentRuntime":{"id":"claude-cli"}}}' --strict-json >/dev/null 2>&1 || return 1
  openclaw config set agents.defaults.model '{"primary":"anthropic/claude-opus-5-5"}' --strict-json >/dev/null 2>&1 || return 1
  echo set
}
# Reserva de modelo do agente do WhatsApp: esgotadas as contas do Claude (porteiro), o OpenClaw cai no Grok, se a
# máquina tem o provedor grok configurado e a pessoa não definiu a própria lista de fallbacks (lista cheia nunca é tocada).
oc_fallback_ensure() {
  F=$(openclaw config get agents.defaults.model.fallbacks 2>&1 || true)
  case "$F" in *unset*|""|"[]") ;; *) return 0 ;; esac
  G=$(openclaw config get models.providers.grok --json 2>/dev/null || true)
  case "$G" in *unset*|"") return 0 ;; esac
  M=$(printf '%s' "$G" | python3 -c 'import json,sys
try:
  p=json.load(sys.stdin); ms=p.get("models") or []
  print(next((m.get("id") for m in ms if isinstance(m,dict) and m.get("id")), ""))
except Exception: print("")' 2>/dev/null)
  [ -n "$M" ] || return 0
  openclaw config set agents.defaults.model.fallbacks "[\\"grok/$M\\"]" --strict-json >/dev/null 2>&1 || return 1
  echo set
}
# Conta nova (outra conta de uma VM já usada, ou VM recém-criada) sem o serviço do gateway: sem ele o QR vincula,
# mas o WhatsApp nunca fica "conectado". Instala como o onboarding do OpenClaw faria: modo local, primeira porta livre
# a partir da configurada (18789; outra conta pode ter a dela) e as pastas do systemd sem escrita de grupo (contas com
# umask 002 nascem assim e o OpenClaw recusa instalar). Imprime a porta; sem systemd ou sob supervisord, não faz nada.
gw_ensure() {
  [ "$GW_PROPRIO" = 1 ] || return 0
  [ -d /run/systemd/system ] || return 0
  supervisorctl status 2>/dev/null | grep -q openclaw-gateway && return 0
  systemctl --user cat openclaw-gateway.service >/dev/null 2>&1 && return 0
  mkdir -p "$HOME/.config/systemd/user"
  for d in "$HOME/.config" "$HOME/.config/systemd" "$HOME/.config/systemd/user"; do [ -O "$d" ] && chmod go-w "$d"; done
  case "$(openclaw config get gateway.mode 2>/dev/null | tr -d '"')" in local) ;; *) openclaw config set gateway.mode local >/dev/null 2>&1 || return 1 ;; esac
  P=$(openclaw config get gateway.port 2>/dev/null); case "$P" in *unset*) P=;; esac; P=$(printf '%s' "$P" | tr -dc 0-9); [ -n "$P" ] || P=18789
  L=$(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null)
  N=$P; while echo "$L" | grep -q ":$N "; do N=$((N+1)); [ $N -gt $((P+30)) ] && return 1; done
  openclaw config set gateway.port "$N" >/dev/null 2>&1 || return 1
  timeout 150 openclaw gateway install --force --port "$N" >/dev/null 2>&1 || return 1
  echo "$N"
}
# Versão do OpenClaw sem subir a CLI (~300 MB, 1-2 s): o package.json ao lado do binário resolvido (/opt/node/lib/node_modules/
# openclaw ou ~/.local/lib/...); sem ele, a resposta de \`openclaw --version\` guardada em cache enquanto o binário não muda.
oc_versao() {
  B=$(readlink -f "$(command -v openclaw)" 2>/dev/null); P=$(dirname "$B")/package.json; C=$HOME/.cache/meu-bot/openclaw-version
  if [ -n "$B" ] && [ -f "$P" ]; then V=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("version",""))' "$P" 2>/dev/null); [ -n "$V" ] && { echo "$V"; return; }; fi
  if [ -s "$C" ] && [ -n "$B" ] && [ ! "$B" -nt "$C" ]; then cat "$C"; return; fi
  V=$(timeout 10 openclaw --version 2>/dev/null | head -1); mkdir -p "$(dirname "$C")" 2>/dev/null; printf '%s\\n' "$V" > "$C" 2>/dev/null; printf '%s\\n' "$V"
}`;

/**
 * Lê do openclaw.json, numa passada de Python, o que antes eram cinco chamadas da CLI por consulta (dmPolicy, o bloco do
 * canal, modelo e reserva do agente, plugin do WhatsApp, áudio e voz). Imprime \`chave=valor\` como a CLI imprimia e mais:
 * plugin (ligado na config e com a pasta instalada), ocmodel=1 quando falta modelo, ocfallback=1 quando falta reserva e há
 * provedor grok. A CLI só é chamada quando o arquivo não basta (plugin não achado, modelo/reserva a gravar).
 */
export const ocConfigPy = (a: WhatsappAlvo): string => `python3 - '${a.accountId}' '${a.agentId}' <<'PY' 2>/dev/null
import glob, json, os, sys
aid, agid = sys.argv[1], sys.argv[2]
${CONTA_EFETIVA_PY}
try:
    c = json.load(open(os.path.expanduser("~/.openclaw/openclaw.json")))
except Exception:
    raise SystemExit
w = efetiva(c, aid)
print("dmpolicy=%s" % (w.get("dmPolicy") or ""))
print("channel=%s" % json.dumps(w, separators=(",", ":")))
pe = ((c.get("plugins") or {}).get("entries") or {}).get("whatsapp") or {}
allow = (c.get("plugins") or {}).get("allow")
ligado = pe.get("enabled", True) is not False and (not isinstance(allow, list) or "whatsapp" in allow)
inst = os.path.isfile(os.path.expanduser("~/.openclaw/extensions/whatsapp/package.json")) or bool(glob.glob(os.path.expanduser("~/.openclaw/npm/projects/openclaw-whatsapp-*/package.json")))
print("plugin=%d" % (ligado and inst))
ag = c.get("agents") or {}
d = ag.get("defaults") or {}
e = (ag.get("entries") or {}).get(agid) or {}
modelo = e.get("model") if agid != "main" and e.get("model") else d.get("model")
print("ocmodel=%d" % (not modelo))
fb = modelo.get("fallbacks") if isinstance(modelo, dict) else None
grok = ((c.get("models") or {}).get("providers") or {}).get("grok") or {}
print("ocfallback=%d" % (not fb and any(isinstance(m, dict) and m.get("id") for m in (grok.get("models") or []))))
m = (c.get("tools") or {}).get("media") or {}
print("audioin=%d" % any("audio" in (x.get("capabilities") or []) for x in (m.get("models") or []) if isinstance(x, dict)))
t = c.get("tts") or {}
print("voz=%s" % (t.get("auto") or "off" if t.get("provider") else ""))
PY`;
export const OC_CONFIG_PY = ocConfigPy(ALVO_PADRAO);

/** O estado desta conta no `channels status --json`: a conta `default` pelo bloco do canal; uma nomeada pela sua entrada em channelAccounts. */
export const ocStatusPy = (a: WhatsappAlvo): string => `python3 -c 'import json,sys
aid = sys.argv[1]
d = json.load(sys.stdin); c = d.get("channels",{}).get("whatsapp") or {}
if aid != "default":
    e = next((x for x in (d.get("channelAccounts") or {}).get("whatsapp") or [] if isinstance(x, dict) and x.get("accountId") == aid), None)
    if e is None:
        print(json.dumps({"linked":False,"connected":False,"state":"conta nao configurada no gateway","lifecycle":None,"loggedOut":False,"e164":None,"starting":d.get("status")=="starting","conta":False}))
        raise SystemExit
    h = e.get("healthState"); ld = e.get("lastDisconnect") or {}
    print(json.dumps({"linked": h not in ("logged-out","not-linked") and e.get("enabled") is not False,"connected": h == "healthy" and e.get("lifecycle") == "running","state": h,"lifecycle": e.get("lifecycle"),"loggedOut": h == "logged-out" or ld.get("loggedOut") is True,"e164": None,"starting": d.get("status")=="starting","conta": True}))
else:
    print(json.dumps({"linked":c.get("linked"),"connected":c.get("connected"),"state":c.get("statusState"),"lifecycle":c.get("lifecycle"),"loggedOut":(c.get("lastDisconnect") or {}).get("loggedOut"),"e164":(c.get("self") or {}).get("e164"),"starting":d.get("status")=="starting","conta":True}))' '${a.accountId}' 2>/dev/null`;

/**
 * Ramo do STATUS_SCRIPT para um alvo (conta, agente, gateway próprio ou não): instalado (uma chamada da CLI no caminho
 * normal) ou escolhido e ainda não instalado. Com gateway de outro usuário (`proprio` false), GW_PROPRIO=0: nada de
 * instalar, religar ou mudar porta de gateway.
 */
export const openclawStatusSh = (a: WhatsappAlvo & { proprio?: boolean }): string => `GW_PROPRIO=${a.proprio === false ? 0 : 1}
${GATEWAY_FIX_SH}
if command -v openclaw >/dev/null 2>&1; then
  echo gateway=openclaw; echo present=1
  echo "bin=$(command -v openclaw)"
  echo "real=$(readlink -f "$(command -v openclaw)" 2>/dev/null)"
  echo "ver=$(oc_versao)"
  [ -f "$HOME/.openclaw/openclaw.json" ] && echo cfg=1 || echo cfg=0
  echo "me=$(${credsMeSh(a)})"
  # Sem config não há gateway; pular o channels status poupa 25 s.
  [ -f "$HOME/.openclaw/openclaw.json" ] || exit 0
  # Uma passada no openclaw.json no lugar de cinco chamadas da CLI (cada uma sobe um node de ~300 MB na VM).
  OJ=$(${ocConfigPy(a)}); printf '%s\\n' "$OJ"
  # Plugin do WhatsApp não achado pelos arquivos (VM nova, ou instalado de outro jeito): a CLI confirma, só nesse caso.
  ${WA_PLUGIN_SH}
  case "$OJ" in *plugin=1*) ;; *) echo "plugin=$(wa_plugin)" ;; esac
  echo "vozid=$(cat "$HOME/.local/share/meu-bot/voz/voz-atual" 2>/dev/null || { [ -s "$HOME/.local/share/meu-bot/voz/faber.onnx" ] && echo faber; })"
  # A única chamada da CLI no caminho normal. "token mismatch" = esta conta aponta para o gateway de outra: conserta e consulta de novo.
  CS=$(timeout 25 openclaw channels status --channel whatsapp --json 2>&1)
  if printf '%s' "$CS" | grep -q 'token mismatch'; then
    if N=$(gw_fix); then echo "gwfix=$N"; CS=$(timeout 25 openclaw channels status --channel whatsapp --json 2>&1); else echo "gwfix=fail"; fi
  fi
  # Agente sem modelo e Claude logado: configura o Claude (uma vez; só quando o arquivo disse que falta). Reserva idem.
  case "$OJ" in *ocmodel=1*) echo "ocmodel=$(oc_model_ensure 2>/dev/null)" ;; esac
  case "$OJ" in *ocfallback=1*) echo "ocfallback=$(oc_fallback_ensure 2>/dev/null)" ;; esac
  echo "oc=$(printf '%s' "$CS" | ${ocStatusPy(a)})"
  exit 0
fi
# Escolheu OpenClaw e ele ainda não está aqui: o passo "preparar" instala (status sem binário = falta instalar).
echo gateway=openclaw; echo present=1; echo bin=; exit 0`;
/**
 * O ramo estático do STATUS_SCRIPT (roda no alias da própria conta): com um alvo gravado (whatsapp-alvo.json), para cedo
 * com `poralvo=1` e a fachada consulta o gateway certo com o fragmento do alvo; sem alvo, o de sempre.
 */
export const OPENCLAW_STATUS_SH = `if [ -n "\${ALVO:-}" ]; then echo gateway=openclaw; echo present=1; echo poralvo=1; exit 0; fi
${openclawStatusSh(ALVO_PADRAO)}`;

/** `channels status --json` do OpenClaw; sem gateway no ar, sobra o número do creds.json. */
export function openclawStatus(kv: Map<string, string>): Omit<WhatsappStatus, "capacidades"> {
  if ((kv.get("bin") ?? "") === "") return { present: true, gateway: "openclaw", agent: "OpenClaw (não instalado)", ready: false, missing: "o OpenClaw ainda não está instalado nesta máquina", connected: false, state: "sem instalar", number: null, loggedOut: false, detail: "OpenClaw escolhido, ainda não instalado", dmPolicy: null, channelConfig: null };
  const agent = describeInstall("OpenClaw", kv);
  const plugin = Number(kv.get("plugin") ?? "0") > 0;
  const cfg = kv.get("cfg") === "1";
  if (!plugin || !cfg) {
    const faltas = [...(!cfg ? ["sem configuração (~/.openclaw/openclaw.json)"] : []), ...(!plugin ? ["sem o plugin do WhatsApp (o \"Gerar QR\" instala sozinho, na versão do OpenClaw da máquina)"] : [])];
    return { present: true, gateway: "openclaw", agent, ready: false, missing: faltas.join("\n"), connected: false, state: "sem configurar", number: null, loggedOut: false, detail: `OpenClaw instalado, mas ${!cfg ? "sem configurar" : "sem o plugin do WhatsApp"}`, dmPolicy: null, channelConfig: null };
  }
  let oc: { linked?: unknown; connected?: unknown; state?: unknown; lifecycle?: unknown; loggedOut?: unknown; e164?: unknown; starting?: unknown } = {};
  try { oc = JSON.parse(kv.get("oc") || "{}") as typeof oc; } catch { /* gateway fora do ar ou CLI sem --json */ }
  const number = phoneOf(kv.get("me") ?? "") ?? (typeof oc.e164 === "string" ? oc.e164.replace(/\D/g, "") || null : null);
  if ((oc as { conta?: unknown }).conta === false) return { present: true, gateway: "openclaw", agent, ready: false, missing: "a conta deste usuário ainda não existe no gateway (channels.whatsapp.accounts): registre-a no gateway antes de parear", connected: false, state: "conta não registrada", number, loggedOut: false, detail: "conta não registrada no gateway", dmPolicy: null, channelConfig: null };
  const connected = oc.connected === true;
  const loggedOut = oc.loggedOut === true;
  const state = typeof oc.state === "string" ? oc.state : oc.starting === true ? "gateway iniciando" : kv.get("oc") ? "sem estado" : "gateway fora do ar";
  const detail = connected ? "conectado" : loggedOut ? "deslogado no WhatsApp; precisa parear de novo" : number === null ? "sem sessão; precisa parear" : oc.linked === true ? (state === "linked" ? "vinculado, conectando" : `vinculado, ${state}`) : state;
  const dm = kv.get("dmpolicy") ?? "";
  const dmPolicy: WhatsappDmPolicy | null = dm === "pairing" || dm === "allowlist" || dm === "open" || dm === "disabled" ? dm : dm === "" ? "pairing" : null; // sem valor autorado, o OpenClaw usa pairing
  let channelConfig: string | null = null;
  let allowFrom: string[] | undefined;
  try {
    const raw = kv.get("channel") ?? "";
    if (raw !== "") {
      const parsed = JSON.parse(raw) as { allowFrom?: unknown };
      channelConfig = JSON.stringify(parsed, null, 2);
      if (Array.isArray(parsed.allowFrom)) allowFrom = parsed.allowFrom.filter((x): x is string => typeof x === "string");
    }
  } catch { /* sem bloco ainda */ }
  const voz = kv.get("voz");
  const audioOut: VoiceReplyMode | null = voz === "inbound" || voz === "always" ? voz : voz === undefined || voz === "" ? null : "off";
  const vozid = (kv.get("vozid") ?? "").trim();
  const audioVoice = isVozId(vozid) ? vozid : null;
  const gwfix = kv.get("gwfix") ?? "";
  const repaired = /^\d+$/.test(gwfix) ? `o gateway do OpenClaw desta conta apontava para o gateway de outra conta da máquina (token diferente); ganhou a porta própria ${gwfix}` : null;
  const unrepaired = gwfix === "fail" ? "o gateway do OpenClaw desta conta aponta para o gateway de outra conta da máquina (token diferente) e não consegui dar a ele uma porta própria; na máquina: openclaw config set gateway.port <porta livre> && openclaw gateway install --force --port <porta livre>" : null;
  return { present: true, gateway: "openclaw", agent, ready: true, missing: null, connected, state, number, loggedOut, detail: unrepaired ?? detail, dmPolicy, channelConfig, ...(allowFrom !== undefined ? { allowFrom } : {}), audioIn: kv.get("audioin") === "1", audioOut, audioVoice, ...(repaired !== null ? { repaired } : {}) };
}

/** Política "só você" (ver setDmPolicy) da conta; também é o padrão gravado antes do primeiro login. */
export const selfPolicyBaseSh = (a: WhatsappAlvo): string => `openclaw config set session.dmScope per-channel-peer && openclaw config set ${cfgDe(a)}.dmPolicy allowlist && openclaw config set ${cfgDe(a)}.allowFrom '[]' --strict-json && openclaw config set ${cfgDe(a)}.selfChatMode true --strict-json && openclaw config set ${cfgDe(a)}.groupPolicy disabled && openclaw config set ${cfgDe(a)}.responsePrefix '""' --strict-json`;
export const SELF_POLICY_SH = selfPolicyBaseSh(ALVO_PADRAO);
/** Com o número já conhecido, ele entra no allowFrom: tira o aviso "allowFrom vazio" e deixa explícito quem é "você". */
export const selfPolicySh = (quem: WaQuem, a: WhatsappAlvo & { proprio?: boolean } = ALVO_PADRAO): string => {
  const donos = donosDe(quem);
  const base = selfPolicyBaseSh(a);
  return quem.dono === null ? base : `${base.replace(`'[]'`, `'${JSON.stringify(donos.map((n) => `+${n}`))}'`)} && ${ownerLockSh(quem.dono, a)}`;
};
/** Num gateway compartilhado (ou conta nomeada) a trava do dono é por união: nunca tira o `e164:` de outro usuário. */
const travaPorUniao = (a: WhatsappAlvo & { proprio?: boolean }): boolean => a.proprio === false || a.accountId !== "default";

/** O que um contato que não é o dono não pode usar: gravar, editar, rodar comandos, agendar, mexer no gateway. */
export const NON_OWNER_DENY = ["write", "edit", "apply_patch", "exec", "process", "code_execution", "cron", "gateway", "group:automation", "group:nodes", "terminal", "skill_workshop", "sessions_spawn"] as const;
/**
 * Trava do dono (`tools.toolsBySender`): o número pareado sem restrição; qualquer outro remetente sem as
 * ferramentas que mudam a máquina ou o próprio agente (nome, personalidade, arquivos). Sem isso, um contato
 * pedia e o agente reescrevia o IDENTITY.md. O claude-cli aplica por argv (`nativeToolMode: selectable`).
 * Só grava se estiver vazio ou já for a do meu-bot (tem `apply_patch`): uma regra feita à mão fica.
 */
export const ownerLockSh = (number: string, a: WhatsappAlvo & { proprio?: boolean } = ALVO_PADRAO): string => {
  const deny = [...NON_OWNER_DENY, ...DESCONHECIDO_DENY, ...NAV_DENY];
  const lock = JSON.stringify({ [`e164:+${number}`]: {}, "*": { deny } });
  if (!travaPorUniao(a)) return `{ cur=$(openclaw config get tools.toolsBySender 2>&1 || true); case "$cur" in *unset*|*apply_patch*) openclaw config set tools.toolsBySender '${lock}' --strict-json >/dev/null ;; esac; }`;
  // União: o mapa é de todos os usuários do gateway. Acrescenta este dono (sem restrição) e põe o "*" só se ainda não há um
  // ou se o que há é o nosso (tem apply_patch); nunca remove o e164 de outro dono.
  return `{ NOVO=$(python3 - '+${number}' '${JSON.stringify(deny)}' <<'PY' 2>/dev/null
import json, os, sys
n, deny = sys.argv[1], json.loads(sys.argv[2])
try:
    c = json.load(open(os.path.expanduser("~/.openclaw/openclaw.json")))
except Exception:
    c = {}
cur = ((c.get("tools") or {}).get("toolsBySender") or {})
cur = dict(cur) if isinstance(cur, dict) else {}
cur["e164:" + n] = cur.get("e164:" + n) if isinstance(cur.get("e164:" + n), dict) else {}
star = cur.get("*")
if not isinstance(star, dict) or "apply_patch" in json.dumps(star):
    cur["*"] = {"deny": deny}
print(json.dumps(cur, separators=(",", ":")))
PY
); [ -n "$NOVO" ] && openclaw config set tools.toolsBySender "$NOVO" --strict-json >/dev/null; }`;
};

/**
 * Ramo do PAIR_SCRIPT para um alvo: plugin, política silenciosa, modelo, gateway desta conta e `channels login` com o vigia
 * do creds.json. Gateway de outro usuário (`proprio` false): sem instalar/religar gateway, `--account`, sem reinício no fim
 * (o canal da conta sobe sozinho) e o pkill só do login desta conta.
 */
export const openclawPairSh = (a: WhatsappAlvo & { proprio?: boolean }): string => {
  const conta = a.accountId === "default" ? "" : ` --account ${a.accountId}`;
  const proprio = a.proprio !== false;
  return `GW_PROPRIO=${proprio ? 1 : 0}
${GATEWAY_FIX_SH}
command -v openclaw >/dev/null 2>&1 || { echo '{"event":"error","error":"o OpenClaw não está instalado nesta máquina; use \\"Preparar\\" antes de gerar o QR"}'; exit 2; }
echo '{"event":"meu-bot","step":"openclaw"}'
if [ ! -f "$HOME/.openclaw/openclaw.json" ]; then echo '{"event":"error","error":"OpenClaw instalado, mas sem configurar nesta máquina (não há ~/.openclaw/openclaw.json); rode o onboarding do OpenClaw antes de parear"}'; exit 2; fi
# Sem o plugin do WhatsApp (VM nova: ele não vem de fábrica), instala do ClawHub e segue para o QR.
${WA_PLUGIN_SH}
if [ "$(wa_plugin)" != "1" ]; then
  echo '{"event":"meu-bot","step":"plugin-installing"}'
  # Na versão do OpenClaw da máquina (a última do ClawHub exige runtime mais novo: "requires plugin API"); sem ler a versão,
  # a fixada em maquina/motor-versoes.ts. Nunca sem versão: na agente (1 nov) resolvia 2026.10.9 num 2026.9.9 e falhava.
  # --accept-capabilities responde a pergunta do instalador (sem terminal ela trava); runtime sem a opção cai no comando sem ela.
  OCV=$(timeout 20 openclaw --version 2>/dev/null | grep -Eo '[0-9]+\\.[0-9]+\\.[0-9]+' | head -n1); [ -n "$OCV" ] || OCV=${OPENCLAW_WA_PLUGIN_VERSAO}
  timeout 300 openclaw plugins install "clawhub:@openclaw/whatsapp@$OCV" --accept-capabilities >/dev/null 2>&1 || timeout 300 openclaw plugins install "clawhub:@openclaw/whatsapp@$OCV" >/dev/null 2>&1 || true
  timeout 60 openclaw plugins enable whatsapp >/dev/null 2>&1 || true
  if [ "$(wa_plugin)" != "1" ]; then echo "{\\"event\\":\\"error\\",\\"error\\":\\"OpenClaw sem o plugin do WhatsApp e a instalação automática falhou; na máquina: openclaw plugins install clawhub:@openclaw/whatsapp@$OCV\\"}"; exit 2; fi
  echo '{"event":"meu-bot","step":"plugin-installed"}'
fi
# Padrão do OpenClaw é "pairing": qualquer desconhecido que mandar DM recebe um código. Antes de conectar, sem
# política autorada, deixa silencioso (ninguém é respondido); a pessoa escolhe depois, no app ou no tutorial.
if [ -z "$(openclaw config get ${cfgDe(a)}.dmPolicy 2>/dev/null | tr -d '"')" ] || openclaw config get ${cfgDe(a)}.dmPolicy 2>&1 | grep -q unset; then
  ( ${selfPolicyBaseSh(a)} ) >/dev/null 2>&1 && echo '{"event":"meu-bot","step":"silent"}'
fi
${proprio ? `# Agente sem modelo: com o Claude Code logado, usa o Claude (senão o WhatsApp conecta e nada responde).
[ "$(oc_model_ensure 2>/dev/null)" = set ] && echo '{"event":"meu-bot","step":"model-set"}'
[ "$(oc_fallback_ensure 2>/dev/null)" = set ] && echo '{"event":"meu-bot","step":"fallback-set"}'` : "# Gateway de outro usuário: modelo e reserva são do agente, já configurados por quem registrou a conta."}
# Sem o serviço do gateway nesta conta: instala antes do QR (senão vincula e nunca conecta).
if GWN=$(gw_ensure); then [ -n "$GWN" ] && echo "{\\"event\\":\\"meu-bot\\",\\"step\\":\\"gateway-installed\\",\\"port\\":$GWN}"; else echo '{"event":"error","error":"esta conta não tem o gateway do OpenClaw como serviço e não consegui instalar. Na máquina: chmod go-w ~/.config ~/.config/systemd ~/.config/systemd/user; openclaw config set gateway.mode local; openclaw gateway install --port <porta livre>"}'; exit 2; fi
# Esta conta apontando para o gateway de outra (token mismatch): o login falharia na hora. Dá uma porta própria antes.
if gw_mismatch; then
  if N=$(gw_fix); then echo "{\\"event\\":\\"meu-bot\\",\\"step\\":\\"gateway-port\\",\\"port\\":$N}"; else echo '{"event":"error","error":"o gateway do OpenClaw desta conta aponta para o gateway de outra conta desta máquina (token diferente) e não consegui dar a ele uma porta própria. Na máquina: openclaw config set gateway.port <porta livre> && openclaw gateway install --force --port <porta livre>"}'; exit 2; fi
fi
if [ "$RESET" = "1" ]; then timeout 60 openclaw channels logout --channel whatsapp${conta} >/dev/null 2>&1; echo '{"event":"meu-bot","step":"logged-out"}'; fi
# Gateway: sob supervisord (computador do Grok Bot) o programa se chama openclaw-gateway; senão o daemon do próprio openclaw.
# Gateway de outro usuário: nada de reiniciar (derrubaria as contas dos outros); o canal desta conta sobe sozinho.
GW=$(supervisorctl status 2>/dev/null | awk '/openclaw-gateway/ {print $1; exit}')
restart() { ${proprio ? `if [ -n "$GW" ]; then supervisorctl restart "$GW" >/dev/null 2>&1; else openclaw gateway restart >/dev/null 2>&1; fi; ` : ""}echo '{"event":"meu-bot","step":"gateway-started"}'; }
echo '{"event":"started"}'
# O CLI pode ficar pendurado depois de vincular (sincronizando); a janela não deve esperar por isso.
# Um vigia lê a saída: viu "linked/paired/…", dá 4 s para o CLI guardar as credenciais e o encerra.
LOG=$(mktemp); rm -f "$LOG.linked"
# O app só faz um pareamento por vez: um login que ainda roda aqui é órfão (app fechado ou reinstalado no
# meio do QR; sem terminal o ssh caído não manda HUP) e faz o novo falhar na hora.
pkill -u "$(id -u)" -f "openclaw channels login --channel whatsapp${conta}$" 2>/dev/null && sleep 1
openclaw channels login --channel whatsapp${conta} >"$LOG" 2>&1 &
P=$!
tail -n +1 -F --pid=$P "$LOG" 2>/dev/null & TAIL=$!
# Vinculou = o creds.json do WhatsApp ganhou o número (me.id). Texto não serve: o próprio convite diz
# "go to Linked Devices", e casar "linked" fechava o QR antes de alguém escanear.
CREDS=${credsDe(a)}
# Vinculou = o creds.json foi reescrito DEPOIS de o login começar e tem número. Comparar só o número falhava:
# ao reparear, o logout ainda não tinha limpado o arquivo e o número antigo virava um "conectado" falso.
T0=$(date +%s)
linked_now() { [ -f "$CREDS" ] || return 1; [ "$(stat -c %Y "$CREDS" 2>/dev/null || echo 0)" -ge "$T0" ] || return 1; ME=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$CREDS" 2>/dev/null); [ -n "$ME" ]; }
( while kill -0 $P 2>/dev/null; do
    if linked_now; then
      touch "$LOG.linked"; echo "{\\"event\\":\\"connected\\",\\"user\\":{\\"id\\":\\"$ME\\"}}"
      # "só você": o número recém-vinculado entra no allowFrom (antes do login ele não existia).
      if [ "$(openclaw config get ${cfgDe(a)}.dmPolicy 2>/dev/null | tr -d '"')" = "allowlist" ]; then NUM=$(printf '%s' "$ME" | sed 's/[:@].*//'); openclaw config set ${cfgDe(a)}.allowFrom "[\\"+$NUM\\"]" --strict-json >/dev/null 2>&1; fi
      sleep 4; kill $P 2>/dev/null; break
    fi
    sleep 1
  done ) & W=$!
trap 'kill $P $W 2>/dev/null; exit 130' HUP TERM INT
( sleep 300 >/dev/null 2>&1; kill $P 2>/dev/null ) >/dev/null 2>&1 & T=$!
wait $P; rc=$?
pkill -P $T 2>/dev/null; pkill -P $W 2>/dev/null; kill $T $W 2>/dev/null; wait $TAIL 2>/dev/null
trap - HUP TERM INT
LINKED=0; [ -f "$LOG.linked" ] && LINKED=1
# O CLI encerra sozinho logo depois de vincular, às vezes antes de o vigia olhar: confere uma última vez.
if [ $LINKED -eq 0 ]; then
  for _ in 1 2 3 4 5; do
    if linked_now; then LINKED=1; echo "{\\"event\\":\\"connected\\",\\"user\\":{\\"id\\":\\"$ME\\"}}"; break; fi
    sleep 1
  done
fi
rm -f "$LOG" "$LOG.linked"
if [ $rc -eq 0 ] || [ $LINKED -eq 1 ]; then restart; exit 0; fi
exit $rc`;
};
export const OPENCLAW_PAIR_SH = openclawPairSh(ALVO_PADRAO);

/** Ramo do logout de um alvo: `channels logout` apaga as credenciais da conta e o gateway para o canal dela. */
export const openclawLogoutSh = (a: WhatsappAlvo): string => `command -v openclaw >/dev/null 2>&1 || { echo OUT=none; exit 0; }
pkill -u "$(id -u)" -f "openclaw channels login --channel whatsapp${a.accountId === "default" ? "" : ` --account ${a.accountId}`}$" 2>/dev/null
timeout 60 openclaw channels logout --channel whatsapp${a.accountId === "default" ? "" : ` --account ${a.accountId}`} >/dev/null 2>&1
[ -s "${credsDe(a)}" ] && echo OUT=still || echo OUT=openclaw`;
export const OPENCLAW_LOGOUT_SH = openclawLogoutSh(ALVO_PADRAO);

export const OPENCLAW_RESTART_SH = `systemctl --user restart openclaw-gateway 2>&1 || openclaw gateway restart 2>&1`;

/** Ramo da lista de conversas de um alvo: o número pareado e as sessões pelo gateway (a fachada filtra as do agente). */
export const openclawChatsSh = (a: WhatsappAlvo): string => `echo gateway=openclaw
  echo "self=$(${credsMeSh(a)})"
  echo "list=$(timeout 40 openclaw gateway call sessions.list --json --params '{"limit":200}' 2>/dev/null | tr -d '\\n')"`;
/** O ramo estático (alias da própria conta): com alvo gravado, para cedo (`poralvo=1`); a fachada consulta o gateway certo. */
export const OPENCLAW_CHATS_SH = `if [ -n "\${ALVO:-}" ]; then echo gateway=openclaw; echo poralvo=1; else
${openclawChatsSh(ALVO_PADRAO)}
fi`;

/** A vista efetiva do `channels.whatsapp` da conta (só essa seção: nada de tokens). */
export const waConfigSh = (a: WhatsappAlvo): string => `echo "wa=$(python3 - '${a.accountId}' <<'PY' 2>/dev/null
import json, os, sys
${CONTA_EFETIVA_PY}
try:
    print(json.dumps(efetiva(json.load(open(os.path.expanduser("~/.openclaw/openclaw.json"))), sys.argv[1])))
except Exception:
    pass
PY
)"`;
export const WA_CONFIG_SH = waConfigSh(ALVO_PADRAO);

/**
 * Sessões de grupo pelo banco do OpenClaw, só leitura: UUID atual, a transcrição do Claude Code (o .jsonl do runtime
 * claude-cli, para o ID da aba), assunto e hora. Vale também quando o gateway não responde ao sessions.list.
 */
export const gruposDoBancoSh = (a: WhatsappAlvo): string => `echo "banco=$(python3 - <<'MEUBOT_PY' 2>/dev/null
import sqlite3, os, json, glob, re
db = os.path.expanduser("${sqliteDe(a)}")
out = {}
try:
    c = sqlite3.connect("file:" + db + "?mode=ro", uri=True, timeout=5)
    for k, e in c.execute("select session_key, entry_json from session_nodes where session_key like '%:group:%'"):
        try:
            d = json.loads(e or "{}") or {}
        except Exception:
            d = {}
        cli = ((d.get("cliSessionBindings") or {}).get("claude-cli") or {}).get("sessionId") or (d.get("cliSessionIds") or {}).get("claude-cli")
        j = None
        if isinstance(cli, str) and re.fullmatch(r"[A-Za-z0-9-]{8,80}", cli):
            m = glob.glob(os.path.expanduser("~/.claude/projects/*/" + cli + ".jsonl"))
            if m:
                j = "~" + m[0][len(os.path.expanduser("~")):]
        resp = False
        for (ev,) in c.execute("select event_json from transcript_events where session_id=? and event_json is not null order by seq desc limit 200", (d.get("sessionId") or "",)):
            try:
                m = (json.loads(ev) or {}).get("message") or {}
            except Exception:
                continue
            if m.get("role") == "assistant" and m.get("stopReason") != "tool_use":
                resp = True
                break
        out[k] = {"sessionId": d.get("sessionId"), "jsonl": j, "subject": d.get("subject"), "updatedAt": d.get("updatedAt"), "respondeu": resp}
except Exception:
    pass
print(json.dumps(out))
MEUBOT_PY
)"`;
export const GRUPOS_DO_BANCO_SH = gruposDoBancoSh(ALVO_PADRAO);

/** Ramo dos grupos de um alvo: sessões pelo gateway, a config efetiva da conta, o cache da skill e o banco do agente. */
export const openclawGroupsSh = (a: WhatsappAlvo): string => `echo gateway=openclaw
  echo "self=$(${credsMeSh(a)})"
  echo "list=$(timeout 15 openclaw gateway call sessions.list --json --params '{"limit":200}' 2>/dev/null | tr -d '\\n')"
  ${waConfigSh(a)}
  echo "cache=$(cat "${WA_GRUPOS_DIR}/data/grupos-live.json" 2>/dev/null | tr -d '\\n')"
  echo "skill=$([ -f "${WA_GRUPOS_DIR}/scripts/wa-admin.sh" ] && echo 1 || echo 0)"
  ${gruposDoBancoSh(a)}`;
/** O ramo estático (alias da própria conta): com alvo gravado, para cedo (`poralvo=1`). */
export const OPENCLAW_GROUPS_SH = `if [ -n "\${ALVO:-}" ]; then echo gateway=openclaw; echo poralvo=1; else
${openclawGroupsSh(ALVO_PADRAO)}
fi`;

/**
 * Mensagens da sessão atual de um grupo direto do banco do OpenClaw (só leitura): o mesmo formato do `chat.history`
 * (`{ messages: [...] }`), sem depender do gateway (que ocupado demorava minutos e a tela via "sem mensagens").
 * Sem o banco (OpenClaw antigo), cai no `chat.history`. Imprime `OK <json>` ou `FALHA <motivo>`.
 */
export const grupoThreadSh = (jid: string, n: number, a: WhatsappAlvo = ALVO_PADRAO): string => `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH
python3 - '${jid}' ${n} <<'MEUBOT_PY'
import sqlite3, os, json, sys, subprocess
jid, n = sys.argv[1], int(sys.argv[2])
db = os.path.expanduser("${sqliteDe(a)}")
def ev(js, zb):
    if js:
        return json.loads(js)
    if zb is None:
        return None
    try:
        import zstandard
        return json.loads(zstandard.ZstdDecompressor().decompress(zb))
    except ImportError:
        p = subprocess.run(["zstd", "-dc"], input=bytes(zb), capture_output=True, timeout=10)
        return json.loads(p.stdout) if p.returncode == 0 else None
try:
    c = sqlite3.connect("file:" + db + "?mode=ro", uri=True, timeout=5)
    row = next((r for r in c.execute("select session_key, current_session_id, entry_json from session_nodes where session_key like ?", ("%:group:" + jid,))), None)
    if row is None:
        print("OK " + json.dumps({"messages": []}))
        sys.exit(0)
    msgs = []
    for js, zb in c.execute("select event_json, event_zstd from (select seq, event_json, event_zstd from transcript_events where session_id=? order by seq desc limit ?) order by seq", (row[1], n * 4)):
        try:
            e = ev(js, zb)
        except Exception:
            continue
        if not isinstance(e, dict):
            continue
        # "Limpar histórico" grava um evento de reset NA MESMA sessão, em vez de abrir outra: o que
        # veio antes dele o agente já esqueceu. Sem isto a aba seguia mostrando a conversa limpa.
        if e.get("type") == "reset":
            msgs = []
            continue
        if e.get("type") == "message" and isinstance(e.get("message"), dict):
            msgs.append(e["message"])
    try:
        subject = (json.loads(row[2] or "{}") or {}).get("subject")
    except Exception:
        subject = None
    print("OK " + json.dumps({"messages": msgs[-n:], "subject": subject}))
except Exception as e:
    print("FALHA " + type(e).__name__)
MEUBOT_PY
`;
