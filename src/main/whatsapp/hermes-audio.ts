/**
 * Áudio do agente do WhatsApp numa máquina com Hermes: ouvir (stt) e responder em voz (voice/tts) são do próprio
 * Hermes, no `~/.hermes/config.yaml` (`stt.enabled` e o provedor; `voice.auto_tts` = responde em áudio quando a
 * pessoa manda áudio). O app grava os dois (hostProbe.installAudio) e aqui lê. Transcrição local de verdade exige o
 * faster-whisper no ambiente do gateway (`hermes pm install --extra stt-whisper`) ou o transcritor compartilhado da
 * máquina (`local_command` → /opt/transcriber): sem um dos dois, "ouvir" fica desligado na tela mesmo com o config gravado. Lê com o Python do runtime do Hermes (ruamel; PyYAML nem sempre existe).
 */
import type { VoiceReplyMode } from "../../shared/ipc";
import { runSsh } from "./whatsapp-ssh";
import { HERMES_PATH_SH, HERMES_VENV_PY_SH, hermesSttCmdSh, lerHermesAudio } from "./whatsapp-hermes-core";

const LER_SH = `${HERMES_PATH_SH}; R=$(hermes_version | sed -n "s/^Install directory: //p"); [ -n "$R" ] || R=$HOME/.local/lib/node_modules/hermes-agent/runtime/hermes-agent; PY="$R/venv/bin/python3"; [ -x "$PY" ] || PY=python3
${HERMES_VENV_PY_SH}
echo "whisper=$( [ -n "$HPY" ] && "$HPY" -c "import faster_whisper" >/dev/null 2>&1 && echo 1 || echo 0)"
${hermesSttCmdSh()}
"$PY" -c '
import os
p = os.path.expanduser("~/.hermes/config.yaml")
try:
    try:
        from ruamel.yaml import YAML
        c = YAML(typ="safe").load(open(p)) or {}
    except ImportError:
        import yaml
        c = yaml.safe_load(open(p)) or {}
except Exception:
    c = {}
s = c.get("stt") or {}
en = s.get("enabled", True)
en = en if isinstance(en, bool) else str(en).strip().lower() in ("1", "true", "yes", "on")
print("stt=" + ("1" if en else "0"))
print("prov=" + str(s.get("provider") or ""))
v = c.get("voice") or {}
print("tts=" + ("inbound" if v.get("auto_tts") else "off"))
' 2>/dev/null`;

export interface HermesAudio { audioIn: boolean; audioOut: VoiceReplyMode }

/** Estado do áudio no Hermes da máquina; null se não deu para ler (a tela fica sem a linha, sem inventar). */
export async function hermesAudioStatus(host: string): Promise<HermesAudio | null> {
  const r = await runSsh(host, `${LER_SH}\n`, 30_000).catch(() => null);
  if (r === null || r.code !== 0) return null;
  return lerHermesAudio(r.stdout);
}
