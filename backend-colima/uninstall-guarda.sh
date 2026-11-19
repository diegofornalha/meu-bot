#!/usr/bin/env bash
# Desfaz a guarda do WhatsApp: tira o plugin do OpenClaw e apaga a cópia local. Rodar no host.
set -uo pipefail
export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:$PATH"
command -v openclaw >/dev/null 2>&1 && timeout 90 openclaw plugins uninstall meu-bot-guarda >/dev/null 2>&1
systemctl --user disable --now meu-bot-vigia-gateway.timer >/dev/null 2>&1
rm -f "$HOME/.config/systemd/user/meu-bot-vigia-gateway.timer" "$HOME/.config/systemd/user/meu-bot-vigia-gateway.service"
systemctl --user daemon-reload >/dev/null 2>&1
rm -rf "$HOME/.local/share/meu-bot/guarda" "$HOME/.openclaw/extensions/meu-bot-guarda"
# A skill whatsapp-grupos fica onde está (~/.claude/skills e, com Hermes, ~/.hermes/skills): o agente pode tê-la editado
# e data/ é o cache desta conta. Sai só a semente que o install-guarda.sh guardou para comparação.
rm -f "$HOME/.local/share/meu-bot/skills-semente/whatsapp-grupos.md"; rmdir "$HOME/.local/share/meu-bot/skills-semente" 2>/dev/null
echo "guarda removida"
