#!/usr/bin/env bash
# Instala o CRM do meu-bot nesta máquina: a pasta crm/ (plugin do OpenClaw meu-bot-crm + crm-job.mjs + as CLIs
# crm.mjs [CRM próprio, plano pro] e streak.mjs [Streak pela API, plano free] + importador) em
# ~/.local/share/meu-bot/crm, registrada por `openclaw plugins install --link`, com a permissão de hooks de
# conversa; e as skills para o agente. Rodar no host, com a pasta crm/ e as skills ao lado. Idempotente.
# Nunca apaga crm/db/ (os dados do CRM próprio). Sai com 2 sem OpenClaw.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:/usr/local/bin:$PATH"
# Sem OpenClaw (máquina com Hermes): entra a CLI crm.mjs e a skill do agente; o plugin do WhatsApp (hooks e notas
# automáticas) é só do OpenClaw e fica de fora, dito na saída. O CRM em si (API e dados) mora no backend do meu-bot.
if command -v openclaw >/dev/null 2>&1; then OC=1; else OC=0; echo "esta máquina não tem OpenClaw: instalando só a CLI e a skill do CRM (sem o plugin do WhatsApp)"; fi
command -v node >/dev/null 2>&1 || { echo "esta máquina não tem node; reinstale o backend do meu-bot"; exit 2; }
[ -f "$HERE/crm/index.js" ] || { echo "a pasta crm/ não está ao lado deste script"; exit 1; }
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
# Skills do agente (sementes; o agente pode editar as dele): a do CRM próprio e a do Streak. Vão para ~/.claude/skills
# e, em máquina com Hermes (~/.hermes existe), também para ~/.hermes/skills, que é onde o Hermes as lê.
# Ao lado de cada SKILL.md fica .semente.sha256, o hash da semente instalada. Na reinstalação: SKILL.md igual a esse
# hash é cópia intocada e recebe a semente nova; diferente, o agente editou e fica como está; sem o arquivo de hash
# (instalação antiga) não dá para saber, então também fica. A semente fica guardada em $SRC para quem quiser comparar.
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
HERMES=""; [ -d "$HOME/.hermes" ] && HERMES=1
for par in "skill-crm-api.md:crm-api" "skill-streak-crm-api.md:streak-crm-api"; do
  src="$HERE/${par%%:*}"; nome="${par##*:}"
  if [ -f "$src" ]; then
    GUARDADA="$SRC/${par%%:*}"; cp "$src" "$GUARDADA"; chmod 644 "$GUARDADA"
    NOVA=$(sha "$src")
    for alvo in "Claude:$HOME/.claude" ${HERMES:+"Hermes:$HOME/.hermes"}; do
      ag="${alvo%%:*}"; SK="${alvo#*:}/skills/$nome/SKILL.md"; MARCA="$(dirname "$SK")/.semente.sha256"
      if [ ! -f "$SK" ]; then
        mkdir -p "$(dirname "$SK")"; cp "$src" "$SK"; printf '%s\n' "$NOVA" > "$MARCA"; echo "skill $nome instalada no $ag"
      else
        ATUAL=$(sha "$SK"); GRAVADA=$(cat "$MARCA" 2>/dev/null || true)
        if [ "$ATUAL" = "$NOVA" ]; then
          printf '%s\n' "$NOVA" > "$MARCA"; echo "skill $nome já existe no $ag (mantida)"
        elif [ -n "$GRAVADA" ] && [ "$ATUAL" = "$GRAVADA" ]; then
          cp "$src" "$SK"; printf '%s\n' "$NOVA" > "$MARCA"; echo "skill $nome atualizada no $ag"
        elif [ -n "$GRAVADA" ]; then
          echo "skill $nome no $ag foi editada pelo agente (mantida); o texto novo está em $GUARDADA"
        else
          echo "skill $nome já existe no $ag e não sei se foi editada (mantida); o texto novo está em $GUARDADA"
        fi
      fi
    done
  fi
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
