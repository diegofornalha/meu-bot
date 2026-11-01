#!/usr/bin/env bash
# Grok (xAI) por OAuth nesta máquina, do jeito que funcionava no grokbot: o Hermes (pacote npm, em ~/.local)
# faz o login por código de dispositivo (`hermes auth add xai-oauth`, que o app dispara em seguida) e serve um
# proxy OpenAI-compatível local (`hermes proxy start --provider xai`, porta 8645, aceita qualquer bearer e usa
# o OAuth); o backend do meu-bot aponta o modelo grok-4 para esse proxy (providers.json). Sem chave de API.
# O proxy roda como `meu-bot-xai-proxy.service` (systemd --user): é uma peça do meu-bot, como as outras unidades
# meu-bot-*; o Hermes é só o programa por baixo (a máquina pode ter Hermes, OpenClaw ou os dois).
# Rodar no host. Idempotente. Não mexe no login do Claude nem no resto do backend.
set -euo pipefail
HERMES_VERSION=0.22.2
DEFAULT_PROXY_PORT=8645
CANON=$HOME/.local/share/meu-bot/backend; LEGACY=$HOME/.hermes/agente-rene/backend-sdk-claude
if [ -f "$CANON/server.js" ]; then BACKEND=$CANON; elif [ -f "$LEGACY/server.js" ] && grep -q "meu-bot/hello" "$LEGACY/server.js" 2>/dev/null; then BACKEND=$LEGACY; else BACKEND=$CANON; fi
[ -f "$BACKEND/server.js" ] || { echo "esta máquina não tem o backend do meu-bot; instale pelo seletor antes"; exit 2; }
# O fallback e o grok-4 vivem no providers.js; um backend antigo não o tem (reinstalar pelo seletor atualiza).
[ -f "$BACKEND/providers.js" ] || { echo "o backend desta máquina é antigo (sem providers.js): use \"Reinstalar backend\" no seletor e tente de novo"; exit 3; }

# O backend pode ser serviço de usuário (o normal), de sistema (conta cujo gerenciador estava degradado na
# instalação) ou nenhum dos dois: reiniciar o que existe, nunca presumir o de usuário.
USER_UNIT=$HOME/.config/systemd/user/meu-bot-backend.service
SYS_UNIT=/etc/systemd/system/meu-bot-backend.service
backend_restart() {
  if systemctl --user cat meu-bot-backend.service >/dev/null 2>&1; then
    systemctl --user restart meu-bot-backend.service; echo "backend: $(systemctl --user is-active meu-bot-backend.service)"
  elif [ -f "$SYS_UNIT" ]; then
    if sudo -n systemctl restart meu-bot-backend.service >/dev/null 2>&1; then echo "backend (serviço de sistema): $(sudo -n systemctl is-active meu-bot-backend.service)"
    else echo "aviso: o backend é serviço de sistema e não consegui reiniciá-lo (sem sudo); use \"Reinstalar backend\" no seletor para ele ler o providers.json novo"; fi
  else
    echo "aviso: o backend não é serviço do systemd nesta máquina; use \"Reinstalar backend\" no seletor para ele ler o providers.json novo"
  fi
}

# O node do backend (num shell sem login ele pode não estar no PATH).
NODE=$(grep -h '^ExecStart=' "$USER_UNIT" "$SYS_UNIT" 2>/dev/null | head -1 | awk '{print $1}' | sed 's/^ExecStart=//' || true)
[ -n "$NODE" ] && [ -x "$NODE" ] && export PATH="$(dirname "$NODE"):$PATH"
export PATH="$HOME/.local/bin:$PATH"
command -v npm >/dev/null 2>&1 || { echo "npm não encontrado nesta máquina"; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "esta máquina não tem systemd; o proxy do Hermes precisa dele para ficar no ar"; exit 1; }

# Porta do proxy: a que o serviço desta conta já usa, se ninguém de fora a ocupou; senão a primeira livre a partir
# de 8645. Outra conta da mesma máquina pode ter o proxy dela na 8645: subir aí falhava e o grok-4 ia parar no
# proxy (e na conta xAI) do vizinho. `ss -ltnp` só mostra o processo dos sockets desta conta: "ouvindo sem
# processo" = de outra conta.
U=$HOME/.config/systemd/user
UNIT=meu-bot-xai-proxy.service
# Até 1/11 a unidade se chamava hermes-xai-proxy.service; o install.sh do backend (1.9.2) a migra para o nome novo na
# mesma porta. Se a antiga ainda está aqui, o backend desta máquina é anterior a isso: reinstalar pelo seletor resolve.
[ -f "$U/hermes-xai-proxy.service" ] && { echo "o backend desta máquina é anterior à 1.9.2 (ainda tem hermes-xai-proxy.service): use \"Reinstalar backend\" no seletor e tente de novo"; exit 3; }
porta_da_unidade() { grep -h '^ExecStart=' "$1" 2>/dev/null | grep -o -- '--port [0-9]*' | awk '{print $2}' || true; }
listening() { (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":$1 "; }
mine() { (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep ":$1 " | grep -q 'users:\|/'; }
PROXY_PORT=$(porta_da_unidade "$U/$UNIT")
if [ -n "$PROXY_PORT" ] && listening "$PROXY_PORT" && ! mine "$PROXY_PORT"; then echo "porta $PROXY_PORT do proxy já é de outra conta desta máquina; escolhendo outra"; PROXY_PORT=; fi
if [ -z "$PROXY_PORT" ]; then
  PROXY_PORT=$DEFAULT_PROXY_PORT
  while listening "$PROXY_PORT"; do PROXY_PORT=$((PROXY_PORT+1)); [ $PROXY_PORT -gt $((DEFAULT_PROXY_PORT+30)) ] && { echo "nenhuma porta livre entre $DEFAULT_PROXY_PORT e $PROXY_PORT para o proxy"; exit 1; }; done
fi

if ! hermes --version 2>/dev/null | grep -q "v$HERMES_VERSION"; then
  echo "instalando o Hermes $HERMES_VERSION em ~/.local (só na primeira vez demora)…"
  mkdir -p "$HOME/.local"
  npm install -g --prefix "$HOME/.local" "hermes-agent@$HERMES_VERSION" >/dev/null 2>&1 || { echo "a instalação do Hermes falhou"; exit 1; }
fi
echo "Hermes: $(hermes --version 2>/dev/null | head -1)"
hermes proxy providers 2>/dev/null | grep -qi xai || { echo "este Hermes não tem o proxy da xAI"; exit 1; }

# providers.json do backend: grok-4 pelo proxy local (endpoint local dispensa chave). Um providers.json de
# outra origem fica guardado ao lado.
P=$BACKEND/providers.json
if [ -f "$P" ] && ! grep -q "127.0.0.1:$PROXY_PORT" "$P"; then cp "$P" "$P.antes-do-grok-oauth"; echo "providers.json anterior guardado em $P.antes-do-grok-oauth"; fi
cat > "$P" <<JSON
[
  { "name": "agente", "type": "claude", "priority": 0, "description": "Claude Code com ferramentas, sem pedir permissão (bypass)" },
  { "name": "grok-4", "type": "openai", "priority": 1, "base_url": "http://127.0.0.1:$PROXY_PORT/v1", "model": "grok-4", "description": "Grok da xAI pelo proxy local do Hermes (login OAuth: hermes auth add xai-oauth)" }
]
JSON
echo "grok-4 apontado para o proxy local (porta $PROXY_PORT)"

# O proxy como serviço do usuário: sobe no boot e volta se cair.
mkdir -p "$U"
HB=$(command -v hermes)
cat > "$U/$UNIT" <<EOF
[Unit]
Description=meu-bot: proxy da xAI (Grok por OAuth, pelo Hermes)
After=network.target

[Service]
ExecStart=$HB proxy start --provider xai --host 127.0.0.1 --port $PROXY_PORT
Restart=always
# Antes do login da xAI o proxy sai na hora ("Not logged in"); sem pressa para tentar de novo.
RestartSec=15
Environment=PATH=$(dirname "$HB"):$(dirname "${NODE:-/usr/bin/node}"):/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now "$UNIT" >/dev/null 2>&1 || systemctl --user restart "$UNIT"
loginctl enable-linger "$USER" >/dev/null 2>&1 || true
backend_restart
sleep 2
echo "proxy ($UNIT): $(systemctl --user is-active "$UNIT") na porta $PROXY_PORT"
if hermes auth status xai-oauth 2>/dev/null | grep -qi "logged in"; then
  echo "pronto: xAI já logada; o grok-4 responde pelo proxy"
else
  echo "pronto: falta entrar na xAI (o app abre o link de login agora)"
fi
