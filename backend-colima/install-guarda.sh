#!/usr/bin/env bash
# Instala a guarda do WhatsApp do meu-bot no OpenClaw desta máquina: plugin local (index.js + regras.mjs +
# manifest) em ~/.local/share/meu-bot/guarda, registrado por `openclaw plugins install --link` (o gateway
# aplica na hora, sem reiniciar). Rodar no host, com a pasta guarda/ ao lado. Idempotente: copia por cima e
# reaplica. Sai com 2 se a máquina não tem OpenClaw (a guarda é do agente do WhatsApp dele).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:$PATH"
command -v openclaw >/dev/null 2>&1 || { echo "esta máquina não tem OpenClaw; a guarda é para o agente do WhatsApp dele"; exit 2; }
[ -f "$HERE/guarda/index.js" ] || { echo "a pasta guarda/ não está ao lado deste script"; exit 1; }
[ -f "$HERE/skills-lib.sh" ] || { echo "skills-lib.sh não está ao lado deste script: o envio veio incompleto ou o app é de antes desta versão. Atualize o meu-bot e instale de novo; nada foi alterado nesta máquina"; exit 1; }
. "$HERE/skills-lib.sh"
SRC=$HOME/.local/share/meu-bot/guarda
mkdir -p "$SRC"
cp "$HERE/guarda/index.js" "$HERE/guarda/regras.mjs" "$HERE/guarda/memoria.mjs" "$HERE/guarda/package.json" "$HERE/guarda/openclaw.plugin.json" "$SRC/"
# Vigia do gateway: timer de usuário a cada minuto que religa o openclaw-gateway parado sem ninguém para religar
# (ex.: wa-admin.sh morto no meio). Respeita o "disable" da migração de máquina; nunca desloga.
if [ -f "$HERE/guarda/vigia-gateway.sh" ] && command -v systemctl >/dev/null 2>&1; then
  cp "$HERE/guarda/vigia-gateway.sh" "$SRC/"; chmod 755 "$SRC/vigia-gateway.sh"
  U=$HOME/.config/systemd/user; mkdir -p "$U"
  printf '[Unit]\nDescription=meu-bot: religa o gateway do OpenClaw se ele ficou parado\n\n[Service]\nType=oneshot\nExecStart=/bin/bash %s/vigia-gateway.sh\n' "$SRC" > "$U/meu-bot-vigia-gateway.service"
  printf '[Unit]\nDescription=meu-bot: vigia do gateway do OpenClaw (a cada minuto)\n\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=1min\nAccuracySec=15s\n\n[Install]\nWantedBy=timers.target\n' > "$U/meu-bot-vigia-gateway.timer"
  systemctl --user daemon-reload >/dev/null 2>&1 && systemctl --user enable --now meu-bot-vigia-gateway.timer >/dev/null 2>&1 && echo "vigia do gateway ligado (a cada minuto)" || echo "aviso: não consegui ligar o vigia do gateway (systemd de usuário)"
fi
# Skill whatsapp-grupos (grupos do agente: listar, habilitar com --remetentes, criar), junto da guarda. Os scripts são
# do app e moram num lugar só, ~/.claude/skills/whatsapp-grupos/scripts (é o caminho que o SKILL.md e o app usam):
# regravados a cada atualização; data/ (cache nome↔JID desta conta) nunca é tocado. O SKILL.md é semente
# (skills-lib.sh): vai para ~/.claude/skills e, com Hermes, ~/.hermes/skills; a cópia sem hash, de quando este
# instalador a regravava sempre, é atualizada ("*").
if [ -f "$HERE/skills/whatsapp-grupos/SKILL.md" ]; then
  K=$HOME/.claude/skills/whatsapp-grupos
  mkdir -p "$K/scripts" "$K/data"; chmod 700 "$K/data"
  cp "$HERE/skills/whatsapp-grupos/scripts/"* "$K/scripts/"; chmod 755 "$K/scripts/"*
  echo "scripts da skill whatsapp-grupos em $K/scripts"
  skill_semente whatsapp-grupos "$HERE/skills/whatsapp-grupos/SKILL.md" "" "*"
fi
# Uma cópia antiga dentro de extensions/ (instalação à mão) confunde o registro: a fonte é o link.
[ -d "$HOME/.openclaw/extensions/meu-bot-guarda" ] && [ ! -L "$HOME/.openclaw/extensions/meu-bot-guarda" ] && rm -rf "$HOME/.openclaw/extensions/meu-bot-guarda"
# Regra de encerramento no AGENTS.md do workspace do agente: a guarda pausa de fora; esta regra evita que o loop
# comece, porque o próprio agente para de responder a cortesias depois da despedida (vale para humanos também).
RULE='<!-- meu-bot:encerramento v2 inicio -->
## Encerramento de conversa (meu-bot)
- Quando a conversa já se encerrou (os dois lados se despediram ou combinaram o próximo passo), não responda a
  novas cortesias, agradecimentos ou despedidas ("obrigado", "até mais", "bom descanso", "igualmente", "chau",
  "gracias", "nos vemos"): responda com a palavra NO_REPLY, sozinha. Nunca devolva uma resposta vazia: vazio
  é tratado como erro pelo sistema (ele tenta de novo e gera avisos); NO_REPLY é silêncio limpo. Despeça-se uma vez só.
- Volte a responder apenas quando vier conteúdo: uma pergunta, um pedido, uma informação nova.
- Se o contato repetir cortesias várias vezes seguidas, é provável que seja outro agente automático: NO_REPLY em
  todas, sem comentar isso com ele.
- Nunca diga ao contato que está deixando de responder nem que foi pausado.
<!-- meu-bot:encerramento v2 fim -->'
W="$(openclaw config get agents.defaults.workspace 2>/dev/null | tr -d '\n' || true)"; case "$W" in /*) ;; *) W="$HOME/.openclaw/workspace" ;; esac
mkdir -p "$W"
printf '%s\n' "$RULE" | python3 -c '
import re, sys, os
f = sys.argv[1]; block = sys.stdin.read()
try: cur = open(f, encoding="utf-8").read()
except FileNotFoundError: cur = ""
pat = re.compile(r"\n?<!-- meu-bot:encerramento v\d+ inicio -->.*?<!-- meu-bot:encerramento v\d+ fim -->\n?", re.S)
m = pat.search(cur)
if m and m.group(0).strip() == block.strip(): print("regra de encerramento ok em " + f); sys.exit(0)
new = (cur[:m.start()] + "\n" + block + cur[m.end():]) if m else (cur + ("" if cur == "" or cur.endswith("\n") else "\n") + "\n" + block)
tmp = f + ".tmp"; open(tmp, "w", encoding="utf-8").write(new); os.replace(tmp, f); print("regra de encerramento gravada em " + f)
' "$W/AGENTS.md"
echo "registrando a guarda no OpenClaw…"
# Versões novas do OpenClaw pedem consentimento de capacidades (--accept-capabilities); as antigas não conhecem a flag.
OUT=$(timeout 120 openclaw plugins install --link "$SRC" --force --accept-capabilities 2>&1 || true)
case "$OUT" in *"unknown option"*|*"Unknown option"*|*"too many arguments"*) OUT=$(timeout 120 openclaw plugins install --link "$SRC" --force 2>&1 || true);; esac
printf '%s\n' "$OUT" | grep -v "^WARNING\|outside ClawHub" | tail -2 || true
# Sem esta permissão o OpenClaw não entrega message_received a plugins de fora do catálogo: a guarda via só as
# saídas e nunca fechava um ciclo (o anti-loop não disparava).
timeout 60 openclaw config set plugins.entries.meu-bot-guarda.hooks.allowConversationAccess true --strict-json >/dev/null 2>&1 || echo "aviso: não consegui gravar hooks.allowConversationAccess (confira no openclaw.json)"
# Gateway leve (plugins.allow nosso, do Preparar máquina ou do pareamento): a guarda precisa estar na lista para carregar.
python3 - <<'PY' || true
import json, os
f = os.path.expanduser("~/.openclaw/openclaw.json")
try: cfg = json.load(open(f))
except Exception: raise SystemExit(0)
allow = (cfg.get("plugins") or {}).get("allow")
if isinstance(allow, list) and allow and "meu-bot-guarda" not in allow:
    allow.append("meu-bot-guarda"); tmp = f + ".tmp"; json.dump(cfg, open(tmp, "w"), ensure_ascii=False, indent=2); os.replace(tmp, f)
    print("plugins.allow: meu-bot-guarda acrescentada (gateway leve)")
PY
VER=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("version",""))' "$SRC/package.json" 2>/dev/null || true)
if timeout 60 openclaw plugins inspect meu-bot-guarda --runtime 2>/dev/null | grep -q "^Status: loaded"; then
  printf '%s' "$VER" > "$SRC/.ok"
  echo "pronto: guarda ativa (nota de fallback bloqueada; pausa automática em loop de 3 ciclos)"
else
  # Sem gateway rodando (máquina sem o agente do WhatsApp ligado) o --link não registra: gravar a config direto para
  # o plugin subir junto com o gateway quando ele existir. Não é erro desta máquina; é o que dá para fazer agora.
  python3 - "$SRC" <<'PY' || true
import json, os, sys
src = sys.argv[1]; f = os.path.expanduser("~/.openclaw/openclaw.json")
try: cfg = json.load(open(f))
except Exception: cfg = {}
plugins = cfg.setdefault("plugins", {}); load = plugins.setdefault("load", {}); paths = load.setdefault("paths", [])
if src not in paths: paths.append(src)
entry = plugins.setdefault("entries", {}).setdefault("meu-bot-guarda", {}); entry["enabled"] = True; entry.setdefault("hooks", {})["allowConversationAccess"] = True
tmp = f + ".tmp"; json.dump(cfg, open(tmp, "w"), ensure_ascii=False, indent=2); os.replace(tmp, f)
print("config do OpenClaw gravada (plugins.load.paths + entries.meu-bot-guarda)")
PY
  printf '%s' "$VER" > "$SRC/.ok"
  if (systemctl --user is-active openclaw-gateway >/dev/null 2>&1) || pgrep -u "$(id -u)" -f "openclaw(-gateway| gateway)( |$)" >/dev/null 2>&1; then
    echo "a guarda foi copiada e configurada, mas o OpenClaw não a mostra carregada; veja na máquina: openclaw plugins inspect meu-bot-guarda"
    exit 3
  fi
  echo "pronto: guarda copiada e configurada; o gateway do OpenClaw não está rodando nesta máquina, ela entra quando ele subir"
fi
