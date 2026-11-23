#!/usr/bin/env bash
# Respostas em áudio do agente do WhatsApp (OpenClaw), com voz local: Piper + voz pt-BR "faber" (medium), ou o
# Kokoro com a voz pt-BR feminina "dora" ou a masculina "alex" (pacote kokoro-onnx num venv). Sem
# chave e sem servidor: a extensão tts-local-cli do OpenClaw chama ~/.local/bin/meu-bot-falar com o texto na
# entrada e o caminho do WAV em {{OutputPath}}; o próprio OpenClaw converte para nota de voz do WhatsApp.
# Uso: install-voz.sh <off|inbound|always> [faber|dora|alex]   (voz padrão: faber)
#      install-voz.sh motor <dora|alex>   só instala o Kokoro, sem tocar no OpenClaw: é o que o app usa numa máquina
#                                         com Hermes, onde quem chama a voz é o hermes-voz.sh. Imprime `motor=ok`.
#   off     = nunca responde em áudio (instala nada; só desliga)
#   inbound = responde em áudio quando recebe áudio
#   always  = toda resposta vira áudio
# Idempotente. A versão do Piper e da voz é fixa (sem "latest").
set -euo pipefail
MODE=${1:-}
VOZ=${2:-faber}
case "$MODE" in off|inbound|always|motor) ;; *) echo "uso: install-voz.sh <off|inbound|always> [faber|dora|alex]  |  install-voz.sh motor <dora|alex>"; exit 64 ;; esac
case "$VOZ" in faber|dora|alex) ;; *) echo "voz desconhecida: $VOZ (faber, dora ou alex)"; exit 64 ;; esac
[ "$MODE" != motor ] || [ "$VOZ" != faber ] || { echo "o modo motor é para as vozes do Kokoro (dora ou alex)"; exit 64; }
KOKORO_PKG=kokoro-onnx==0.4.9
KOKORO_URL=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
PIPER_URL=https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
VOICE_URL=https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx
D=$HOME/.local/share/meu-bot/voz
BIN=$HOME/.local/bin/meu-bot-falar
export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH
# ffmpeg é pacote do sistema: instala pelo apt quando este usuário é root ou tem sudo sem senha. Numa box (sem root) a
# pendência é do admin: meu-bot-admin › Preparar máquina › Pacotes do sistema instala o ffmpeg para todos de uma vez.
# Sai com 3 nesse caso (como o install-tela.sh): o app sabe que é com o admin.
ffmpeg_ou_avisa() {
  local para=$1
  command -v ffmpeg >/dev/null 2>&1 && return 0
  if [ "$(id -u)" = 0 ]; then DEBIAN_FRONTEND=noninteractive apt-get install -y -q ffmpeg >/dev/null 2>&1 || true
  elif sudo -n true 2>/dev/null; then sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -q ffmpeg >/dev/null 2>&1 || true; fi
  command -v ffmpeg >/dev/null 2>&1 && { echo "ffmpeg instalado"; return 0; }
  echo "Falta o ffmpeg e esta máquina não deixa instalar programas sem senha. O admin instala uma vez (pelo app dele: Preparar máquina › Pacotes do sistema) e aí $para."
  return 1
}

# O venv precisa do pacote python3-venv, que o Debian/Ubuntu não trazem com o python3: instala pelo apt como root ou com
# sudo sem senha. Uma tentativa sem ele deixa a pasta sem pip ("No module named pip"): refaz do zero. Sem como instalar,
# a pendência é do admin (Preparar máquina › Pacotes do sistema), como o ffmpeg.
venv_ou_avisa() {
  local v=$1 para=$2
  [ -x "$v/bin/python" ] && "$v/bin/python" -m pip --version >/dev/null 2>&1 && return 0
  rm -rf "$v"
  python3 -m venv "$v" >/dev/null 2>&1 && return 0
  rm -rf "$v"
  if [ "$(id -u)" = 0 ]; then DEBIAN_FRONTEND=noninteractive apt-get install -y -q python3-venv >/dev/null 2>&1 || true
  elif sudo -n true 2>/dev/null; then sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -q python3-venv >/dev/null 2>&1 || true; fi
  python3 -m venv "$v" >/dev/null 2>&1 && { echo "python3-venv instalado"; return 0; }
  rm -rf "$v"
  echo "Falta o python3-venv (pacote do sistema) e esta máquina não deixa instalar programas sem senha. O admin instala uma vez (pelo app dele: Preparar máquina › Pacotes do sistema) e aí $para."
  return 1
}
# Daqui até o `fi`: só para o OpenClaw (skill, permissões, desligar, voz de terceiros). O modo motor pula.
if [ "$MODE" != motor ]; then
command -v openclaw >/dev/null 2>&1 || { echo "esta máquina não tem OpenClaw: a voz é para o agente do WhatsApp dele"; exit 2; }

# O agente (chat do meu-bot e o dono pelo WhatsApp) também troca a voz a pedido: uma cópia deste script fica na máquina
# e a skill "voz-das-respostas" ensina como chamá-la. A tela do app lê a mesma marcação (voz/voz-atual).
# A skill é semente (skills-lib.sh): ~/.claude/skills e, com Hermes, ~/.hermes/skills; a cópia sem hash, de quando este
# script a regravava sempre, é atualizada ("*"). A biblioteca vai para a máquina ao lado da cópia do script.
HERE=$(cd "$(dirname "$0")" && pwd)
[ -f "$HERE/skills-lib.sh" ] || { echo "skills-lib.sh não está ao lado deste script: o envio veio incompleto ou o app é de antes desta versão. Atualize o meu-bot e instale de novo; nada foi alterado nesta máquina"; exit 1; }
. "$HERE/skills-lib.sh"
mkdir -p "$D"
[ -f "$0" ] && [ "$(readlink -f "$0")" != "$(readlink -f "$D/install-voz.sh" 2>/dev/null)" ] && cp "$0" "$D/install-voz.sh" && chmod 755 "$D/install-voz.sh"
[ "$HERE/skills-lib.sh" -ef "$D/skills-lib.sh" ] || { cp "$HERE/skills-lib.sh" "$D/skills-lib.sh" && chmod 644 "$D/skills-lib.sh"; }
SEMENTE="$D/skill-voz-das-respostas.md"
cat > "$SEMENTE" <<'MD'
---
name: voz-das-respostas
description: Troca ou liga/desliga a voz das respostas em áudio do agente do WhatsApp (voz feminina, masculina, masculina natural; responder em áudio sempre, só quando receber áudio, ou nunca). Use quando o dono pedir "voz feminina", "muda a voz", "responde em áudio", "para de mandar áudio".
---

# Voz das respostas em áudio (meu-bot)

Script: `bash ~/.local/share/meu-bot/voz/install-voz.sh <modo> <voz>`

- **voz:** `dora` (feminina), `faber` (masculina, padrão), `alex` (masculina natural). Todas rodam nesta máquina.
- **modo:** `inbound` (responde em áudio quando recebe áudio), `always` (toda resposta em áudio), `off` (só texto).
- Para trocar só a voz, mantenha o modo atual: `openclaw config get tts.auto` (se vier `off` ou vazio, use `inbound`
  e diga ao dono que ligou "responder em áudio quando receber áudio").
- Voz atual: `cat ~/.local/share/meu-bot/voz/voz-atual`.
- Na primeira vez que usa a dora ou o alex, a máquina baixa ~350 MB (pode levar 1–2 min): avise antes.
- Só o dono pede isto. Se outra pessoa pedir pelo WhatsApp, não troque.
- Responda ao dono, em português, com a última linha que o script imprimir.
MD
skill_semente voz-das-respostas "$SEMENTE" "$SEMENTE" "*"
# Só estes comandos ficam liberados para o agente sem pedir autorização (o resto das permissões não muda).
python3 - "$HOME" <<'PY' 2>/dev/null || true
import json, os, sys
h = sys.argv[1]; f = os.path.join(h, ".claude", "settings.json")
try: c = json.load(open(f))
except Exception: c = {}
if not isinstance(c, dict): c = {}
p = c.setdefault("permissions", {}); a = p.setdefault("allow", [])
for r in ["Bash(bash ~/.local/share/meu-bot/voz/install-voz.sh:*)", f"Bash(bash {h}/.local/share/meu-bot/voz/install-voz.sh:*)",
          "Bash(openclaw config get tts.auto)", "Bash(cat ~/.local/share/meu-bot/voz/voz-atual)", f"Bash(cat {h}/.local/share/meu-bot/voz/voz-atual)"]:
    if r not in a: a.append(r)
os.makedirs(os.path.dirname(f), exist_ok=True)
tmp = f + ".tmp"; json.dump(c, open(tmp, "w"), indent=2); os.replace(tmp, f)
PY

if [ "$MODE" = off ]; then
  if openclaw config get tts.provider 2>/dev/null | grep -q tts-local-cli; then
    openclaw config set tts.auto '"off"' --strict-json >/dev/null
  fi
  echo "pronto: o agente responde só em texto"
  exit 0
fi

# Outra voz já configurada (de quem não é o meu-bot): respeita.
CUR=$(openclaw config get tts.provider 2>/dev/null | tr -d '"' || true)
case "$CUR" in ""|*unset*|tts-local-cli) ;; *) echo "o OpenClaw desta máquina já usa outra voz ($CUR); nada foi alterado"; exit 3 ;; esac
fi

[ "$(uname -m)" = x86_64 ] || { echo "a voz local só está pronta para x86_64 (esta máquina é $(uname -m))"; exit 1; }
ffmpeg_ou_avisa "a resposta em áudio funciona aqui" || exit 3
mkdir -p "$D" "$HOME/.local/bin"
ANTES=$(cat "$D/voz-atual" 2>/dev/null || echo faber)
if [ "$VOZ" = faber ]; then
if [ ! -x "$D/piper/piper" ]; then
  echo "baixando o Piper…"
  curl -fsSL --retry 5 -o "$D/piper.tgz" "$PIPER_URL"
  tar xzf "$D/piper.tgz" -C "$D"; rm -f "$D/piper.tgz"
fi
# A voz tem ~63 MB e o download às vezes corta: retoma (-C -) e confere o tamanho.
if [ "$(stat -c %s "$D/faber.onnx" 2>/dev/null || echo 0)" -lt 50000000 ]; then
  echo "baixando a voz pt-BR (faber)…"
  curl -fsSL --retry 5 -C - -o "$D/faber.onnx" "$VOICE_URL"
fi
[ -s "$D/faber.onnx.json" ] || curl -fsSL --retry 5 -o "$D/faber.onnx.json" "$VOICE_URL.json"
[ "$(stat -c %s "$D/faber.onnx")" -ge 50000000 ] || { echo "a voz baixou incompleta; rode de novo"; exit 1; }

fi

# Kokoro (dora/alex): venv + modelo de ~325 MB + vozes de ~28 MB, baixados uma vez (download cortado retoma).
K=$D/kokoro
if [ "$VOZ" != faber ]; then
  command -v python3 >/dev/null 2>&1 || { echo "python3 não encontrado: a voz $VOZ precisa dele"; exit 1; }
  # Numa box com teto de RAM (cgroup da conta), o Kokoro precisa de ~550 MB de pico além do que o gateway e os claude já
  # usam; sem isso a síntese entra em thrashing no teto e o teste de voz do OpenClaw cai mudo depois de 2 min. Confere antes.
  # O memory.current conta o cache de arquivos, que o kernel devolve quando falta: depois de um download grande (o
  # Ollama, o próprio Kokoro) ele passava de 2 GB numa box com 400 MB de programas e a voz era recusada à toa. O
  # inactive_file do memory.stat volta a contar como livre.
  CG=/sys/fs/cgroup/user.slice/user-$(id -u).slice
  if [ -r "$CG/memory.max" ] && [ "$(cat "$CG/memory.max")" != max ]; then
    LIVRE=$(( ($(cat "$CG/memory.max") - $(cat "$CG/memory.current" 2>/dev/null || echo 0) + $(awk '/^inactive_file /{print $2; f=1} END{if(!f) print 0}' "$CG/memory.stat" 2>/dev/null || echo 0)) / 1048576 ))
    [ "$LIVRE" -ge 700 ] || { echo "a voz $VOZ precisa de ~700 MB livres no teto de RAM desta conta e só há $LIVRE MB (teto de $(( $(cat "$CG/memory.max") / 1048576 )) MB). Peça ao admin para subir o teto de RAM na aba Usuários (3 GB é o padrão); a voz faber (Piper) não precisa disso."; exit 4; }
  fi
  # Voz para todos (install-voz-global.sh, pelo root): a máquina já tem o Kokoro pronto em /opt/meu-bot-voz. Esta conta
  # não baixa nem instala nada: a pasta dela aponta para lá (links), e a cópia própria, se tinha, sai e devolve a cota.
  G=${MEU_BOT_VOZ_GLOBAL:-/opt/meu-bot-voz}
  if [ -r "$G/global.json" ] && [ -x "$G/venv/bin/python" ] && [ -r "$G/kokoro-v1.0.onnx" ] && [ -r "$G/voices-v1.0.bin" ]; then
    mkdir -p "$K"
    for f in venv kokoro-v1.0.onnx voices-v1.0.bin; do
      [ "$(readlink "$K/$f" 2>/dev/null)" = "$G/$f" ] || { rm -rf "${K:?}/$f"; ln -s "$G/$f" "$K/$f"; }
    done
    echo "esta máquina já tem a voz para todos: nada para baixar"
  fi
  if [ ! -x "$K/venv/bin/python" ] || ! "$K/venv/bin/python" -c "import kokoro_onnx, soundfile" 2>/dev/null; then
    echo "preparando o Kokoro (uma vez)…"
    # Link para um global que saiu da máquina: sai o link, e a conta volta a ter a cópia dela.
    for f in venv kokoro-v1.0.onnx voices-v1.0.bin; do [ -L "$K/$f" ] && rm -f "${K:?}/$f"; done
    mkdir -p "$K"
    venv_ou_avisa "$K/venv" "a voz $VOZ funciona aqui" || exit 3
    "$K/venv/bin/pip" -q install "$KOKORO_PKG" soundfile >/dev/null 2>&1 || { echo "não consegui instalar o $KOKORO_PKG"; exit 1; }
  fi
  if [ "$(stat -L -c %s "$K/kokoro-v1.0.onnx" 2>/dev/null || echo 0)" -lt 300000000 ]; then
    echo "baixando a voz natural (Kokoro, ~325 MB; só na primeira vez)…"
    curl -fsSL --retry 5 -C - -o "$K/kokoro-v1.0.onnx" "$KOKORO_URL/kokoro-v1.0.onnx"
  fi
  [ "$(stat -L -c %s "$K/voices-v1.0.bin" 2>/dev/null || echo 0)" -ge 25000000 ] || curl -fsSL --retry 5 -C - -o "$K/voices-v1.0.bin" "$KOKORO_URL/voices-v1.0.bin"
  [ "$(stat -L -c %s "$K/kokoro-v1.0.onnx")" -ge 300000000 ] && [ "$(stat -L -c %s "$K/voices-v1.0.bin")" -ge 25000000 ] || { echo "a voz baixou incompleta; rode de novo"; exit 1; }
  cat > "$K/falar.py" <<'PY'
# Texto na entrada, WAV em argv[2] com a voz argv[1] (pt-BR). Chamado pelo meu-bot-falar.
import os, sys, soundfile as sf
from kokoro_onnx import Kokoro
d = os.path.dirname(os.path.abspath(__file__))
texto = sys.stdin.read().strip() or "."
k = Kokoro(os.path.join(d, "kokoro-v1.0.onnx"), os.path.join(d, "voices-v1.0.bin"))
audio, sr = k.create(texto, voice=sys.argv[1], speed=1.0, lang="pt-br")
sf.write(sys.argv[2], audio, sr)
PY
fi
# Hermes: o motor está pronto; quem o chama é o hermes-voz.sh, que o app grava em seguida.
if [ "$MODE" = motor ]; then echo "motor=ok"; exit 0; fi

# O meu-bot-falar limpa o texto (fala-texto.py, que o install.sh do backend copia) e chama o motor da voz escolhida,
# o meu-bot-falar-motor (o provedor no OpenClaw é sempre o tts-local-cli). O install.sh grava o mesmo meu-bot-falar.
MOTOR=$HOME/.local/bin/meu-bot-falar-motor
grava_falar() {
  case "$1" in
    faber) printf '#!/bin/sh\n# Texto na entrada, WAV em $1. Voz: faber (Piper).\nexec "%s/piper/piper" --model "%s/faber.onnx" --output_file "$1" --quiet\n' "$D" "$D" > "$MOTOR" ;;
    dora) printf '#!/bin/sh\n# Texto na entrada, WAV em $1. Voz: dora (Kokoro, feminina).\nexec "%s/venv/bin/python" "%s/falar.py" pf_dora "$1"\n' "$K" "$K" > "$MOTOR" ;;
    alex) printf '#!/bin/sh\n# Texto na entrada, WAV em $1. Voz: alex (Kokoro, masculina).\nexec "%s/venv/bin/python" "%s/falar.py" pm_alex "$1"\n' "$K" "$K" > "$MOTOR" ;;
  esac
  cat > "$BIN" <<'SH'
#!/bin/sh
# Texto na entrada, WAV em $1 (o OpenClaw passa {{OutputPath}}): limpa o texto para a fala e chama o motor da voz.
T=$(cat)
L=$(printf '%s' "$T" | python3 "$HOME/.local/share/meu-bot/fala-texto.py" 2>/dev/null) && [ -n "$L" ] || L=$T
printf '%s\n' "$L" | "$HOME/.local/bin/meu-bot-falar-motor" "$@"
SH
  chmod +x "$MOTOR" "$BIN"
}
grava_falar "$VOZ"
echo "comando em $BIN (voz $VOZ)"

echo "ligando no OpenClaw (respostas em áudio: $MODE)…"
TMS=60000; [ "$VOZ" = faber ] || TMS=120000
openclaw config set tts "{\"auto\":\"$MODE\",\"provider\":\"tts-local-cli\",\"providers\":{\"tts-local-cli\":{\"command\":\"$BIN\",\"args\":[\"{{OutputPath}}\"],\"outputFormat\":\"wav\",\"timeoutMs\":$TMS}}}" --strict-json >/dev/null

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
if timeout 120 openclaw capability tts convert --text "Olá! Agora eu também respondo em áudio." --output "$T/teste" --json >"$T/out" 2>&1 && grep -q '"ok": *true' "$T/out"; then
  echo "$VOZ" > "$D/voz-atual"
  echo "pronto: o agente do WhatsApp responde em áudio ($MODE, voz $VOZ)"
else
  # A voz nova não passou no teste: volta para a anterior (se estiver instalada) para não ficar sem áudio.
  MSG=$(tail -c 300 "$T/out" | tr '\n' ' '); [ -n "$(printf '%s' "$MSG" | tr -d ' ')" ] || MSG="sem resposta do OpenClaw em 120 s: a conta pode estar no teto de RAM"
  tem_motor() { case "$1" in faber) [ -x "$D/piper/piper" ] ;; *) [ -x "$K/venv/bin/python" ] && [ -s "$K/falar.py" ] ;; esac; }
  if [ "$ANTES" != "$VOZ" ] && tem_motor "$ANTES"; then grava_falar "$ANTES"; echo "a voz $VOZ não passou no teste ($MSG); voltei para a voz $ANTES"; exit 4; fi
  echo "configurado, mas o teste de voz do OpenClaw não confirmou: $MSG"
  exit 4
fi
