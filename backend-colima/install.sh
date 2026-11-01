#!/usr/bin/env bash
# Instala/atualiza o backend do meu-bot nesta máquina. Rodar no host, com o pacote inteiro (a lista
# BACKEND_RUNTIME_FILES de src/main/maquina/backend-bundle-core.ts, meu-bot-backend.service e este script) no mesmo
# diretório; o app manda tudo por scp para ~/.meu-bot-install/backend. Idempotente: pode rodar de novo.
# - Node: usa o existente se for >= 18; senão baixa o 20 LTS (.tar.gz) em ~/.local/node.
# - Serviço: unidade systemd de usuário; como root (ou sem gerenciador de usuário) vira unidade do sistema.
#   Onde o systemd não roda (Computador do Grok Bot: PID 1 é o pod-daemon, mas /usr/bin/systemctl existe),
#   cai no nohup — por isso testamos /run/systemd/system, não a presença do binário.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# Pasta do backend do meu-bot (backend-dir-core.ts no app, mesma regra): a própria, ou a herdada só se o server.js de lá
# é o nosso (tem a rota meu-bot/hello). Outro backend na herdada (o do Hermes na grokbot-1) fica intocado. MEU_BOT_BACKEND_DIR força.
CANON=$HOME/.local/share/meu-bot/backend
LEGACY=$HOME/.hermes/agente-rene/backend-sdk-claude
if [ -n "${MEU_BOT_BACKEND_DIR:-}" ]; then DEST=$MEU_BOT_BACKEND_DIR
elif [ -f "$CANON/server.js" ]; then DEST=$CANON
elif [ -f "$LEGACY/server.js" ] && grep -q "meu-bot/hello" "$LEGACY/server.js" 2>/dev/null; then DEST=$LEGACY
else DEST=$CANON; fi
echo "pasta do backend: $DEST"
NODE_DIR=$HOME/.local/node
NODE_VER=${NODE_VER:-v20.20.2}
PORT=${PORT:-8080}

node_ok() { local v; v=$("$1" -v 2>/dev/null | sed 's/^v//; s/\..*//') || return 1; [ "${v:-0}" -ge 18 ]; }
NODE=""
if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then NODE=$(command -v node)
elif [ -x "$NODE_DIR/bin/node" ] && node_ok "$NODE_DIR/bin/node"; then NODE=$NODE_DIR/bin/node
else
  arch=$(uname -m); case "$arch" in aarch64|arm64) a=arm64;; x86_64) a=x64;; *) echo "arquitetura $arch não suportada"; exit 1;; esac
  tmp=$(mktemp -d); echo "baixando node $NODE_VER $a…"
  curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-$a.tar.gz" -o "$tmp/node.tar.gz"
  rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"; tar -xzf "$tmp/node.tar.gz" -C "$NODE_DIR" --strip-components=1; rm -rf "$tmp"
  NODE=$NODE_DIR/bin/node
fi
echo "node: $("$NODE" -v) em $NODE"

# O claude REAL: nunca o porteiro do meu-bot (claude-porteiro.sh, que pode estar na frente do PATH desde uma
# instalação anterior); o backend chama o real direto e faz o rodízio por conta própria.
e_porteiro() { head -c 4096 "$1" 2>/dev/null | grep -q 'meu-bot-porteiro'; }
CLAUDE=""
for c in $(which -a claude 2>/dev/null) "$HOME/.local/bin/claude"; do [ -x "$c" ] || continue; e_porteiro "$c" && continue; CLAUDE=$c; break; done
[ -n "$CLAUDE" ] || { echo "claude não encontrado no PATH nem em ~/.local/bin"; exit 1; }
grep -q '"oauthAccount"' "$HOME/.claude.json" 2>/dev/null || echo "aviso: Claude Code parece deslogado (sem oauthAccount em ~/.claude.json); o backend vai responder 401 até fazer /login"

# Trava: na grokbot-1 o mesmo caminho é o backend ORIGINAL do Hermes (app.js, services/, git). Copiar o
# server.js genérico por cima apaga o dele; o processo vivo não nota, mas o próximo restart sobe o
# genérico e o WhatsApp (rene-dm) para. Aconteceu em 14/15 out 2026. Nunca mais.
if [ -f "$DEST/app.js" ] || [ -d "$DEST/services" ]; then
  echo "ERRO: $DEST já é o backend do Hermes (app.js/services). Este instalador é só para máquinas sem ele." >&2
  echo "      Para o modelo agente/grok-4 nessa máquina use backend-vm/deploy-agente.sh." >&2
  exit 3
fi
# Porta: numa máquina com backend, a do .env dele manda (um PORT= diferente aqui só serviria para a checagem
# do fim falhar). Numa instalação nova, porta já ocupada (outra conta desta máquina, outro programa) é erro
# claro antes de escrever qualquer coisa: o seletor do app escolhe uma livre sozinho e grava para a máquina.
listening() { (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":$1 "; }
if [ -f "$DEST/.env" ]; then
  EP=$(grep '^PORT=' "$DEST/.env" | head -1 | cut -d= -f2- | tr -dc 0-9)
  if [ -n "$EP" ] && [ "$EP" != "$PORT" ]; then echo "porta: o .env desta máquina usa $EP (pedida: $PORT); mantendo $EP"; PORT=$EP; fi
elif listening "$PORT"; then
  echo "ERRO: a porta $PORT já está ocupada nesta máquina (outra conta ou outro programa). Instale em outra porta: PORT=<n> bash install.sh" >&2
  exit 4
fi
mkdir -p "$DEST/data" "$HOME/chat-workspace" "$HOME/agent-workspace"
# --- copiar: início (o teste install-backend-copia.test.mjs roda este trecho sozinho)
# Sem lista aqui: a lista é a BACKEND_RUNTIME_FILES de backend-bundle-core.ts, que é o que o app manda para o stage.
# Antes de tocar em $DEST confere que todo require('./x') do server.js chegou; depois copia tudo para uma pasta
# temporária dentro de $DEST e só então move. Assim o server.js novo nunca fica sozinho com módulos velhos (em 1/11 um
# cp de lista copiou o server.js, parou no gmail.js que faltava e as quatro VMs caíram em MODULE_NOT_FOUND).
copiar_backend() { # $1 origem  $2 destino
  local origem=$1 destino=$2 m faltam="" tmp f
  for m in $(grep -oE "require\(['\"]\./[A-Za-z0-9_-]+['\"]\)" "$origem/server.js" | sed -E "s/require\(['\"]\.\/([A-Za-z0-9_-]+)['\"]\)/\1/" | sort -u); do
    [ -f "$origem/$m.js" ] || faltam="$faltam $m.js"
  done
  if [ -n "$faltam" ]; then echo "ERRO: pacote incompleto, o server.js exige:$faltam. Nada foi alterado em $destino." >&2; return 5; fi
  tmp=$(mktemp -d "$destino/.novo.XXXXXX") || return 5
  if ! cp "$origem"/*.js "$origem"/*.py "$tmp/"; then rm -rf "$tmp"; echo "ERRO: não consegui copiar o backend para $tmp" >&2; return 5; fi
  for f in "$tmp"/*; do mv -f "$f" "$destino/"; done
  rmdir "$tmp"
}
# --- copiar: fim
copiar_backend "$HERE" "$DEST"
[ -f "$DEST/providers.json" ] || { cp "$HERE/providers.json" "$DEST/providers.json"; echo "providers.json criado (agente → grok-4; grok-4 precisa de XAI_API_KEY no .env ou base_url local)"; }
if [ ! -f "$DEST/.env" ]; then
  # umask só para o .env (num subshell): vazando para o resto, a unidade de sistema nascia 600 e ilegível.
  ( umask 077; printf 'OPENAI_COMPAT_KEY=%s\nCRM_AGENT_KEY=%s\nMODULOS_KEY=%s\nPORT=%s\nHOST=127.0.0.1\nCLAUDE_BIN=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$PORT" "$CLAUDE" > "$DEST/.env" ); echo ".env criado"
else
  grep -q '^CLAUDE_BIN=' "$DEST/.env" || printf 'CLAUDE_BIN=%s\n' "$CLAUDE" >> "$DEST/.env"
  # CLAUDE_BIN apontando para o porteiro (instalação feita com ele no PATH): corrige para o real.
  cur=$(grep '^CLAUDE_BIN=' "$DEST/.env" | head -1 | cut -d= -f2-); if [ -n "$cur" ] && { [ ! -x "$cur" ] || e_porteiro "$cur"; }; then sed -i "s#^CLAUDE_BIN=.*#CLAUDE_BIN=$CLAUDE#" "$DEST/.env"; echo "CLAUDE_BIN do .env corrigido para $CLAUDE"; fi
  # Chave própria do agente (CRM): aditiva e idempotente; sem ela o agente cai na chave do app e perde a separação.
  grep -q '^CRM_AGENT_KEY=' "$DEST/.env" || { ( umask 077; printf 'CRM_AGENT_KEY=%s\n' "$(openssl rand -hex 32)" >> "$DEST/.env" ); echo "CRM_AGENT_KEY acrescentada ao .env"; }
  grep -q '^MODULOS_KEY=' "$DEST/.env" || { ( umask 077; printf 'MODULOS_KEY=%s\n' "$(openssl rand -hex 32)" >> "$DEST/.env" ); echo "MODULOS_KEY acrescentada ao .env"; }
fi
chmod 600 "$DEST/.env"

render_unit() { # $1 = USERLINE, $2 = TARGET
  sed -e "s|__DEST__|$DEST|g" -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$NODE|g" -e "s|__NODEDIR__|$(dirname "$NODE")|g" \
      -e "s|__USERLINE__|$1|g" -e "s|__TARGET__|$2|g" "$HERE/meu-bot-backend.service"
}

# Serviço de usuário sempre que há um gerenciador de usuário, mesmo "degraded" (uma unidade qualquer falhou;
# o gerenciador funciona). Testar só o código de saída de is-system-running mandava o backend para o sistema
# numa conta com um serviço falho, e todo script que fala "systemctl --user restart meu-bot-backend" quebrava.
# --- migrar xai-proxy: início (o teste install-xai-proxy-unidade.test.mjs roda este trecho sozinho)
# O proxy da xAI (install-grok-oauth.sh) até 1/11 se chamava hermes-xai-proxy.service; o nome novo segue o padrão
# meu-bot-* das outras unidades do app (a máquina é agnóstica: Hermes, OpenClaw ou os dois; o Hermes é só o programa
# por baixo). Mesma unidade, mesma porta (o providers.json aponta para ela); a antiga sai do systemd e do disco.
# Nada a fazer sem a antiga. Um tropeço aqui não derruba a instalação do backend: só avisa.
migrar_unidade_xai_proxy() { # $1 = pasta das unidades de usuário
  local u=$1 antiga="$1/hermes-xai-proxy.service" nova="$1/meu-bot-xai-proxy.service" porta
  [ -f "$antiga" ] || return 0
  porta=$(grep -h '^ExecStart=' "$antiga" 2>/dev/null | grep -o -- '--port [0-9]*' | awk '{print $2}' || true)
  if [ ! -f "$nova" ]; then
    sed 's/^Description=.*/Description=meu-bot: proxy da xAI (Grok por OAuth, pelo Hermes)/' "$antiga" > "$nova" || { echo "aviso: não consegui gravar $nova; a unidade antiga fica"; rm -f "$nova"; return 0; }
  fi
  systemctl --user disable --now hermes-xai-proxy.service >/dev/null 2>&1 || true
  rm -f "$antiga" "$u/default.target.wants/hermes-xai-proxy.service"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  systemctl --user enable --now meu-bot-xai-proxy.service >/dev/null 2>&1 || echo "aviso: meu-bot-xai-proxy.service não subiu; veja: systemctl --user status meu-bot-xai-proxy"
  echo "unidade antiga hermes-xai-proxy.service removida; o proxy passa a ser meu-bot-xai-proxy.service${porta:+ (porta $porta)}"
}
# --- migrar xai-proxy: fim
user_manager() { case "$(systemctl --user is-system-running 2>/dev/null)" in running|degraded|starting|maintenance) return 0;; *) return 1;; esac; }
SYS_UNIT=/etc/systemd/system/meu-bot-backend.service
user_manager && migrar_unidade_xai_proxy "$HOME/.config/systemd/user"
if [ "$(id -u)" -ne 0 ] && user_manager; then
  mkdir -p "$HOME/.config/systemd/user"
  # Esta conta já tem o backend como serviço de sistema (instalação antiga com o gerenciador degradado): migra.
  # `systemctl show` responde a qualquer usuário; ler o arquivo não (uma instalação antiga o deixou 600).
  if [ -f "$SYS_UNIT" ] && [ "$(systemctl show -p User --value meu-bot-backend.service 2>/dev/null)" = "$(id -un)" ]; then
    if sudo -n systemctl disable --now meu-bot-backend.service >/dev/null 2>&1 && sudo -n rm -f "$SYS_UNIT" && sudo -n systemctl daemon-reload; then
      echo "serviço de sistema antigo desta conta removido; o backend passa a ser serviço de usuário"
    else
      echo "aviso: o backend desta conta é serviço de sistema e não consegui removê-lo (sem sudo); mantendo-o como está"
      SYS_KEEP=1
    fi
  fi
fi
if [ -n "${SYS_KEEP:-}" ]; then
  sudo -n systemctl restart meu-bot-backend.service >/dev/null 2>&1 || echo "aviso: não consegui reiniciar o serviço de sistema (sem sudo); o backend continua com a versão que já rodava"
  sleep 1.5
elif [ "$(id -u)" -ne 0 ] && user_manager; then
  render_unit "" "default.target" > "$HOME/.config/systemd/user/meu-bot-backend.service"
  systemctl --user daemon-reload
  systemctl --user enable meu-bot-backend.service >/dev/null
  systemctl --user restart meu-bot-backend.service
  command -v loginctl >/dev/null && loginctl enable-linger "$(id -un)" 2>/dev/null || true
  sleep 1.5; systemctl --user --no-pager --lines=3 status meu-bot-backend.service || true
elif [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
  SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo -n"
  render_unit "User=$(id -un)" "multi-user.target" | $SUDO tee /etc/systemd/system/meu-bot-backend.service >/dev/null
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable meu-bot-backend.service >/dev/null
  $SUDO systemctl restart meu-bot-backend.service
  sleep 1.5; $SUDO systemctl --no-pager --lines=3 status meu-bot-backend.service || true
elif supervisorctl status meu-bot-backend >/dev/null 2>&1; then
  # Computador do Grok Bot com supervisord e o programa já cadastrado (ver PERSISTENCIA.md da máquina):
  # reiniciar por ele, nunca por nohup — senão nascem dois server.js disputando a porta.
  echo "supervisord gerencia meu-bot-backend: reiniciando por ele"
  supervisorctl restart meu-bot-backend >/dev/null 2>&1 || { echo "supervisorctl restart falhou"; exit 1; }
  sleep 2
elif PM2=$(command -v pm2 2>/dev/null || { [ -x "$HOME/.local/bin/pm2" ] && echo "$HOME/.local/bin/pm2"; }) && [ -n "$PM2" ]; then
  # Máquina sem systemd mas com PM2 (a grokbot-1, que já roda o Hermes por ele): o nosso backend entra como
  # `meu-bot-backend`, com `pm2 save` para voltar no reinício. Reinstalar reinicia o mesmo processo (--update-env).
  if "$PM2" id meu-bot-backend 2>/dev/null | grep -q '[0-9]'; then
    echo "PM2 gerencia meu-bot-backend: reiniciando por ele"
    "$PM2" restart meu-bot-backend --update-env >/dev/null 2>&1 || { echo "pm2 restart falhou"; exit 1; }
  else
    echo "sem systemd: subindo pelo PM2 (meu-bot-backend)"
    (cd "$DEST" && OPENAI_COMPAT_SESSIONS_PATH="$DEST/data/openai-compat-sessions.json" "$PM2" start server.js --name meu-bot-backend --interpreter "$NODE" --cwd "$DEST" --time >/dev/null 2>&1) || { echo "pm2 start falhou"; exit 1; }
  fi
  "$PM2" save >/dev/null 2>&1 || echo "aviso: pm2 save falhou; o backend pode não voltar no reinício"
  sleep 2
else
  echo "sem systemd: subindo com nohup (não sobrevive a reinício)"
  # O processo anterior foi iniciado como `node server.js` (relativo, a partir de $DEST): `pkill -f` pelo
  # caminho completo nunca casa, o novo nasce com EADDRINUSE e o curl do fim responde pelo velho. Mata
  # pelo cwd, que é o que identifica o nosso.
  for p in $(pgrep -f 'node server\.js' 2>/dev/null); do [ "$(readlink "/proc/$p/cwd" 2>/dev/null)" = "$DEST" ] && kill "$p" 2>/dev/null; done
  pkill -f "$DEST/server.js" 2>/dev/null || true; sleep 0.5
  (cd "$DEST" && OPENAI_COMPAT_SESSIONS_PATH="$DEST/data/openai-compat-sessions.json" nohup "$NODE" server.js >> "$DEST/backend.log" 2>&1 &)
  sleep 1.5
fi

K=$(grep '^OPENAI_COMPAT_KEY=' "$DEST/.env" | cut -d= -f2-)
if curl -s -m 5 -H "Authorization: Bearer $K" "http://127.0.0.1:$PORT/v1/models" | grep -q claudecode; then echo "OK: backend respondendo em 127.0.0.1:$PORT"; else echo "AVISO: backend ainda não respondeu em 127.0.0.1:$PORT"; exit 1; fi
# Versão só depois de responder: instalação que falhou no meio continua "desatualizada" e o app tenta de novo.
if [ -f "$HERE/VERSION" ]; then cp "$HERE/VERSION" "$DEST/VERSION"; echo "versão do backend: $(cat "$DEST/VERSION")"; fi

# Status line do Claude (Sessão/Semanal no app) vai junto quando o instalador está ao lado. Não derruba o
# backend: numa máquina com statusLine gerenciada ele sai com 3 e explica.
if [ -f "$HERE/install-statusline.sh" ]; then bash "$HERE/install-statusline.sh" || echo "aviso: status line não instalada (código $?)"; fi
# Porteiro do claude: rodízio de contas para o OpenClaw (WhatsApp) e o Terminal. Nunca derruba o backend.
if [ -f "$HERE/install-porteiro.sh" ]; then MEU_BOT_NODE="$NODE" MEU_BOT_BACKEND_DIR="$DEST" bash "$HERE/install-porteiro.sh" || echo "aviso: porteiro do claude não instalado (código $?)"; fi

# Voz das respostas: o texto passa pelo fala-texto.py (números por extenso, sem markdown nem links) antes do motor.
# Máquinas que já tinham voz ligada são ajustadas aqui, sem reinstalar a voz: o meu-bot-falar antigo (motor direto)
# vira o meu-bot-falar-motor com o filtro na frente (mesmo texto do install-voz.sh); o hermes-voz.sh ganha a linha
# do filtro (mesma de HERMES_VOZ_FILTRO, whatsapp-hermes-core.ts). Sem python3 ou com falha, fala o texto original.
if [ -f "$HERE/fala-texto.py" ]; then
  mkdir -p "$HOME/.local/share/meu-bot"; cp "$HERE/fala-texto.py" "$HOME/.local/share/meu-bot/fala-texto.py"
  FALAR=$HOME/.local/bin/meu-bot-falar
  if [ -f "$FALAR" ] && ! grep -q fala-texto "$FALAR"; then
    mv "$FALAR" "$HOME/.local/bin/meu-bot-falar-motor"
    cat > "$FALAR" <<'SH'
#!/bin/sh
# Texto na entrada, WAV em $1 (o OpenClaw passa {{OutputPath}}): limpa o texto para a fala e chama o motor da voz.
T=$(cat)
L=$(printf '%s' "$T" | python3 "$HOME/.local/share/meu-bot/fala-texto.py" 2>/dev/null) && [ -n "$L" ] || L=$T
printf '%s\n' "$L" | "$HOME/.local/bin/meu-bot-falar-motor" "$@"
SH
    chmod +x "$FALAR"; echo "voz: filtro de texto ligado no meu-bot-falar"
  fi
  HV=$HOME/.local/share/meu-bot/hermes-voz.sh
  if [ -f "$HV" ] && ! grep -q fala-texto "$HV"; then
    python3 - "$HV" <<'PY' && echo "voz: filtro de texto ligado no hermes-voz.sh"
import sys
p = sys.argv[1]; linhas = open(p).read().split("\n")
filtro = 'L=$(mktemp) && python3 "$HOME/.local/share/meu-bot/fala-texto.py" <"$1" >"$L" 2>/dev/null && [ -s "$L" ] && exec 3<"$L" && set -- /dev/fd/3 "$2"; rm -f "$L"'
i = next((n for n, l in enumerate(linhas) if l.startswith('exec "$HPY" -m piper')), None)
if i is None: sys.exit(1)
linhas.insert(i, filtro); open(p, "w").write("\n".join(linhas))
PY
  fi
fi
