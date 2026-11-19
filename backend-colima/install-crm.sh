#!/usr/bin/env bash
# Instala o CRM do meu-bot nesta máquina: a pasta crm/ (plugin do OpenClaw meu-bot-crm + crm-job.mjs + as CLIs
# crm.mjs [CRM próprio, plano pro] e streak.mjs [Streak pela API, plano free] + importador) em
# ~/.local/share/meu-bot/crm, registrada por `openclaw plugins install --link`, com a permissão de hooks de
# conversa; e as skills para o agente. Rodar no host, com a pasta crm/ e as skills ao lado. Idempotente.
# Nunca apaga crm/db/ (os dados do CRM próprio). Sai com 2 sem node; com 1 se crm/ ou skills-lib.sh não vieram junto.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:/usr/local/bin:$PATH"
# Sem OpenClaw (máquina com Hermes): entra a CLI crm.mjs e a skill do agente; o plugin do WhatsApp (hooks e notas
# automáticas) é só do OpenClaw e fica de fora, dito na saída. O CRM em si (API e dados) mora no backend do meu-bot.
if command -v openclaw >/dev/null 2>&1; then OC=1; else OC=0; echo "esta máquina não tem OpenClaw: instalando só a CLI e a skill do CRM (sem o plugin do WhatsApp)"; fi
command -v node >/dev/null 2>&1 || { echo "esta máquina não tem node; reinstale o backend do meu-bot"; exit 2; }
[ -f "$HERE/crm/index.js" ] || { echo "a pasta crm/ não está ao lado deste script"; exit 1; }
[ -f "$HERE/skills-lib.sh" ] || { echo "skills-lib.sh não está ao lado deste script: o envio veio incompleto ou o app é de antes desta versão. Atualize o meu-bot e instale de novo; nada foi alterado nesta máquina"; exit 1; }
. "$HERE/skills-lib.sh"
SRC=$HOME/.local/share/meu-bot/crm
mkdir -p "$SRC/db"
for f in index.js regras.mjs licenca-crm.mjs crm-job.mjs backend.mjs crm.mjs streak.mjs importar-streak.mjs package.json openclaw.plugin.json; do
  [ -f "$HERE/crm/$f" ] && cp "$HERE/crm/$f" "$SRC/"
done
chmod 700 "$SRC" "$SRC/db"; chmod 644 "$SRC"/*.js "$SRC"/*.mjs "$SRC"/*.json
if [ "$OC" = 1 ]; then
  [ -d "$HOME/.openclaw/extensions/meu-bot-crm" ] && [ ! -L "$HOME/.openclaw/extensions/meu-bot-crm" ] && rm -rf "$HOME/.openclaw/extensions/meu-bot-crm"
  echo "registrando o plugin meu-bot-crm no OpenClaw…"
  OUT=$(timeout 120 openclaw plugins install --link "$SRC" --force --accept-capabilities 2>&1 || true)
  case "$OUT" in *"unknown option"*|*"Unknown option"*|*"too many arguments"*) OUT=$(timeout 120 openclaw plugins install --link "$SRC" --force 2>&1 || true);; esac
  printf '%s\n' "$OUT" | grep -v "^WARNING\|outside ClawHub" | tail -2 || true
  # Hooks de conversa (message_received/sending) exigem esta permissão para plugins de fora do catálogo.
  timeout 60 openclaw config set plugins.entries.meu-bot-crm.hooks.allowConversationAccess true --strict-json >/dev/null 2>&1 || echo "aviso: não consegui gravar hooks.allowConversationAccess (confira no openclaw.json)"
  timeout 60 openclaw config set plugins.entries.meu-bot-crm.enabled true --strict-json >/dev/null 2>&1 || true
fi
# Skills do agente (sementes; o agente pode editar as dele): a do CRM próprio e a do Streak. Quem decide os destinos
# (~/.claude/skills e, com Hermes, ~/.hermes/skills) e o que fazer com a cópia que já existe é a skills-lib.sh. A
# semente fica guardada em $SRC para quem quiser comparar.
for par in "skill-crm-api.md:crm-api" "skill-streak-crm-api.md:streak-crm-api"; do
  src="$HERE/${par%%:*}"; nome="${par##*:}"
  if [ -f "$src" ]; then skill_semente "$nome" "$src" "$SRC/${par%%:*}"; fi
done
# Lê o arquivo cru (o backend pode ainda não ter migrado a licença antiga): "personalizado" virou Pro em 22 out.
PLANO=$(python3 -c 'import json,os; print(json.load(open(os.path.expanduser("~/.local/share/meu-bot/licenca.json"))).get("plan","free"))' 2>/dev/null || echo free)
if [ "$PLANO" = "pro" ] || [ "$PLANO" = "personalizado" ]; then FALTA="o CRM próprio está nesta máquina: escolha ou importe um pipeline no app"; else FALTA="falta a chave da API do Streak, pelo tutorial 17"; fi
if [ "$OC" = 0 ]; then
  echo "pronto: CRM instalado nesta máquina sem OpenClaw ($FALTA). O agente usa o CRM pela CLI crm.mjs e pela skill crm-api; as notas automáticas do WhatsApp (plugin) são só do OpenClaw."
elif timeout 60 openclaw plugins inspect meu-bot-crm --runtime 2>/dev/null | grep -q "^Status: loaded"; then
  echo "pronto: CRM instalado ($FALTA)"
else
  timeout 60 openclaw plugins reload >/dev/null 2>&1 || true
  if timeout 60 openclaw plugins inspect meu-bot-crm --runtime 2>/dev/null | grep -q "^Status: loaded"; then echo "pronto: CRM instalado ($FALTA)"; else echo "o CRM foi copiado, mas o OpenClaw não mostra o plugin carregado; veja: openclaw plugins inspect meu-bot-crm"; exit 3; fi
fi
