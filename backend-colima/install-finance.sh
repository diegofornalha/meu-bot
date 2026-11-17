#!/usr/bin/env bash
# Instala o financeiro do meu-bot nesta máquina (produto meu-bot-finance): a pasta finance/ (plugin do OpenClaw
# meu-bot-finance + a CLI finance.mjs do agente) em ~/.local/share/meu-bot/finance, registrada por
# `openclaw plugins install --link`, com a permissão de hooks de conversa; e a skill finance-api para o agente.
# Rodar no host, com a pasta finance/ e a skill ao lado. Idempotente. Nunca apaga finance/db/ (os dados).
# A skill é atualizada enquanto ainda tiver o marcador de versão do meu-bot (apagar o marcador = manter a sua).
# Sai com 2 sem OpenClaw/node; 3 se o OpenClaw não carregar o plugin (a CLI e a skill funcionam mesmo assim).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:/usr/local/bin:$PATH"
command -v node >/dev/null 2>&1 || { echo "esta máquina não tem node; reinstale o backend do meu-bot"; exit 2; }
[ -f "$HERE/finance/index.js" ] || { echo "a pasta finance/ não está ao lado deste script"; exit 1; }
SRC=$HOME/.local/share/meu-bot/finance
# Com o módulo financas ligado (marcador MODULO, issue #312), o plugin e os dados são dele: este instalador não mexe.
[ -f "$SRC/MODULO" ] && { echo "o financeiro desta máquina é o módulo Finanças (página Módulos); o instalador antigo não roda"; exit 4; }
mkdir -p "$SRC/db"
for f in index.js regras.mjs backend.mjs finance.mjs package.json openclaw.plugin.json; do cp "$HERE/finance/$f" "$SRC/"; done
chmod 700 "$SRC" "$SRC/db"; chmod 644 "$SRC"/*.js "$SRC"/*.mjs "$SRC"/*.json; chmod 755 "$SRC/finance.mjs"
echo "arquivos do financeiro copiados"
# Skill do agente (Claude Code da máquina: chat do app e WhatsApp).
SK="$HOME/.claude/skills/finance-api/SKILL.md"
if [ -f "$SK" ] && ! grep -q "meu-bot-finance skill v" "$SK"; then echo "skill finance-api editada por você (mantida)";
else mkdir -p "$(dirname "$SK")"; cp "$HERE/skill-finance-api.md" "$SK"; echo "skill finance-api instalada"; fi
command -v openclaw >/dev/null 2>&1 || { echo "pronto: financeiro instalado para o chat do app (esta máquina não tem OpenClaw: sem o agente do WhatsApp)"; exit 0; }
[ -d "$HOME/.openclaw/extensions/meu-bot-finance" ] && [ ! -L "$HOME/.openclaw/extensions/meu-bot-finance" ] && rm -rf "$HOME/.openclaw/extensions/meu-bot-finance"
echo "registrando o plugin meu-bot-finance no OpenClaw…"
OUT=$(timeout 120 openclaw plugins install --link "$SRC" --force --accept-capabilities 2>&1 || true)
case "$OUT" in *"unknown option"*|*"Unknown option"*|*"too many arguments"*) OUT=$(timeout 120 openclaw plugins install --link "$SRC" --force 2>&1 || true);; esac
printf '%s\n' "$OUT" | grep -v "^WARNING\|outside ClawHub" | tail -2 || true
timeout 60 openclaw config set plugins.entries.meu-bot-finance.hooks.allowConversationAccess true --strict-json >/dev/null 2>&1 || echo "aviso: não consegui gravar hooks.allowConversationAccess (confira no openclaw.json)"
timeout 60 openclaw config set plugins.entries.meu-bot-finance.enabled true --strict-json >/dev/null 2>&1 || true
if timeout 60 openclaw plugins inspect meu-bot-finance --runtime 2>/dev/null | grep -q "^Status: loaded"; then echo "pronto: financeiro instalado (WhatsApp e chat do app)"
else
  timeout 60 openclaw plugins reload >/dev/null 2>&1 || true
  if timeout 60 openclaw plugins inspect meu-bot-finance --runtime 2>/dev/null | grep -q "^Status: loaded"; then echo "pronto: financeiro instalado (WhatsApp e chat do app)"; else echo "o financeiro foi copiado, mas o OpenClaw não mostra o plugin carregado; veja: openclaw plugins inspect meu-bot-finance"; exit 3; fi
fi
