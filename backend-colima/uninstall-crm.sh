#!/usr/bin/env bash
# Desfaz o install-crm.sh: tira o plugin do OpenClaw e apaga os scripts. Os dados do CRM próprio (crm/db/) e o
# crm.json ficam; `--apagar-dados` leva o db para ~/.local/share/meu-bot/crm-db-removido-<data>/ (nunca destrói).
set -uo pipefail
export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:/usr/local/bin:$PATH"
SRC="$HOME/.local/share/meu-bot/crm"
timeout 120 openclaw plugins uninstall meu-bot-crm >/dev/null 2>&1 || true
rm -rf "$HOME/.openclaw/extensions/meu-bot-crm"
if [ -d "$SRC/db" ]; then
  if [ "${1:-}" = "--apagar-dados" ]; then mv "$SRC/db" "$HOME/.local/share/meu-bot/crm-db-removido-$(date +%Y%m%d-%H%M%S)"; echo "dados do CRM movidos para crm-db-removido-*"; fi
  find "$SRC" -maxdepth 1 -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.json' -o -name 'skill-*.md' -o -name 'lock-*' -o -name '*.log' \) -delete
  echo "CRM removido desta máquina (os dados em $SRC/db ficaram)"
else
  rm -rf "$SRC"
  echo "CRM pelo WhatsApp removido desta máquina"
fi
