#!/bin/bash
# Modo grátis para todos (root): UM Ollama na máquina, que todas as contas usam sem baixar nada. O programa fica em
# /opt/meu-bot-ollama (todos leem, como o /opt/hermes), os modelos em /var/lib/meu-bot-ollama, e o serviço de sistema
# meu-bot-ollama-global roda como o usuário de sistema meu-bot-ollama (não root) em 127.0.0.1, fora do teto de RAM das
# boxes. A marca /opt/meu-bot-ollama/global.json (porta, modelo, versão; todos leem) é por onde o install-ollama.sh de
# cada conta descobre o global e só aponta o providers.json para ele. Idempotente; o download retoma de onde parou.
# A versão, o sha256, a URL e o modelo vêm do app (fonte única: ollamaLocal-core.ts):
#   OLLAMA_VERSION OLLAMA_SHA256 OLLAMA_URL OLLAMA_MODELO [OLLAMA_PACOTE_MB]
#   bash install-ollama-global.sh           instala (ou completa uma instalação interrompida)
#   bash install-ollama-global.sh remover   para o serviço e apaga programa, modelos, usuário e marca
# Saída: OLLAMA_GLOBAL=ok <porta> (ou OLLAMA_GLOBAL=removido), ou ERRO=<motivo>.
set -u
umask 022
ACAO=${1:-instalar}
[ "$(id -u)" = 0 ] || { echo "ERRO=o modo grátis para todos precisa ser instalado como root"; exit 0; }
D=/opt/meu-bot-ollama; VAR=/var/lib/meu-bot-ollama; MARCA=$D/global.json
U=meu-bot-ollama-global; USR=meu-bot-ollama
UNIT=/etc/systemd/system/$U.service

if [ "$ACAO" = "remover" ]; then
  systemctl disable --now "$U" >/dev/null 2>&1 || true
  rm -f "$UNIT"; systemctl daemon-reload >/dev/null 2>&1 || true
  rm -rf "${D:?}" "${VAR:?}"
  id "$USR" >/dev/null 2>&1 && userdel "$USR" >/dev/null 2>&1 || true
  echo "OLLAMA_GLOBAL=removido"
  exit 0
fi

for v in OLLAMA_VERSION OLLAMA_SHA256 OLLAMA_URL OLLAMA_MODELO; do [ -n "${!v:-}" ] || { echo "ERRO=falta $v"; exit 0; }; done
echo "$OLLAMA_VERSION" | grep -qE '^[0-9]+(\.[0-9]+){1,3}$' || { echo "ERRO=versão do Ollama inválida"; exit 0; }
echo "$OLLAMA_MODELO" | grep -qE '^[A-Za-z0-9.:_-]{1,80}$' || { echo "ERRO=nome de modelo inválido"; exit 0; }
PACOTE_MB=${OLLAMA_PACOTE_MB:-1500}
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then echo "ERRO=o modo grátis precisa de Linux x86_64 (esta máquina: $(uname -s) $(uname -m))"; exit 0; fi
for c in curl sha256sum tar zstd python3 systemctl; do command -v "$c" >/dev/null 2>&1 || { echo "ERRO=falta o programa \"$c\" nesta máquina (apt install $c)"; exit 0; }; done

DIR=$D/v$OLLAMA_VERSION
BIN=$DIR/bin/ollama
mkdir -p "$D" "$VAR/models" || { echo "ERRO=não consegui criar $D ou $VAR"; exit 0; }
chmod 755 "$D"
if [ ! -x "$BIN" ]; then
  PKG=$D/ollama-$OLLAMA_VERSION.tar.zst.parcial
  TMP=$D/v$OLLAMA_VERSION.extraindo
  echo "baixando o Ollama $OLLAMA_VERSION (~$PACOTE_MB MB; retoma de onde parou)…"
  curl -fsSL --retry 5 --retry-delay 5 -C - -o "$PKG" "$OLLAMA_URL" &
  CURL=$!
  ULT=0
  while kill -0 "$CURL" 2>/dev/null; do
    sleep 3
    FEITO=$(( $(stat -c %s "$PKG" 2>/dev/null || echo 0) / 1048576 ))
    PCT=$(( FEITO * 100 / PACOTE_MB ))
    if [ "$PCT" -ge $((ULT+20)) ] && [ "$PCT" -lt 100 ]; then ULT=$PCT; echo "baixando o Ollama: $PCT%"; fi
  done
  # Falhou no meio: o .parcial fica, e rodar de novo continua dali.
  wait "$CURL" || { echo "ERRO=o download do Ollama parou; rode de novo que ele continua de onde parou"; exit 0; }
  echo "$OLLAMA_SHA256  $PKG" | sha256sum -c - >/dev/null 2>&1 || { rm -f "${PKG:?}"; echo "ERRO=o pacote do Ollama não confere (sha256); nada foi instalado"; exit 0; }
  echo "pacote conferido (sha256); extraindo…"
  rm -rf "${TMP:?}"; mkdir -p "$TMP"
  tar --zstd -xf "$PKG" -C "$TMP" || { rm -rf "${TMP:?}" "${PKG:?}"; echo "ERRO=não deu para extrair o Ollama"; exit 0; }
  rm -f "${PKG:?}"
  [ -x "$TMP/bin/ollama" ] || { rm -rf "${TMP:?}"; echo "ERRO=o pacote do Ollama veio sem bin/ollama"; exit 0; }
  rm -rf "${DIR:?}"; mv "$TMP" "$DIR"
fi
chown -R root:root "$DIR"; chmod -R a+rX "$DIR"
echo "Ollama $OLLAMA_VERSION em $DIR"

# Usuário de sistema, sem shell: o serviço não roda como root e só escreve na pasta dos modelos.
id "$USR" >/dev/null 2>&1 || useradd --system --home-dir "$VAR" --shell /usr/sbin/nologin "$USR" || { echo "ERRO=não consegui criar o usuário $USR"; exit 0; }
chown -R "$USR:$USR" "$VAR"; chmod 755 "$VAR" "$VAR/models"

# Porta: a que já está gravada; senão a primeira livre de 18760 a 18779 (o Claude Code Global usa 18780 a 18799).
P=$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1]))["porta"]))' "$MARCA" 2>/dev/null)
if [ -z "$P" ]; then
  for c in $(seq 18760 18779); do ss -ltn 2>/dev/null | grep -q "127.0.0.1:$c \|\*:$c \|0.0.0.0:$c " || { P=$c; break; }; done
  [ -n "$P" ] || { echo "ERRO=nenhuma porta livre entre 18760 e 18779"; exit 0; }
fi
BASE=http://127.0.0.1:$P

cat > "$UNIT" <<EOF
[Unit]
Description=meu-bot: modo grátis para todos (Ollama da máquina)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$BIN serve
User=$USR
Group=$USR
Restart=always
RestartSec=15
Environment=HOME=$VAR
Environment=OLLAMA_HOST=127.0.0.1:$P
Environment=OLLAMA_MODELS=$VAR/models
# O modelo sai da memória depois de 10 min parado: a máquina não fica com ~2 GB presos à toa.
Environment=OLLAMA_KEEP_ALIVE=10m

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$U" >/dev/null 2>&1
systemctl restart "$U" || { echo "ERRO=o serviço $U não subiu (journalctl -u $U)"; exit 0; }
ok=0; for i in $(seq 1 40); do curl -fsS -m 2 "$BASE/api/version" >/dev/null 2>&1 && { ok=1; break; }; sleep 0.5; done
[ "$ok" = 1 ] || { echo "ERRO=o Ollama não respondeu em 127.0.0.1:$P (journalctl -u $U)"; exit 0; }

if curl -fsS -m 5 "$BASE/api/tags" 2>/dev/null | grep -q "\"$OLLAMA_MODELO\""; then
  echo "modelo $OLLAMA_MODELO já baixado"
else
  echo "baixando o modelo $OLLAMA_MODELO (pode levar alguns minutos)…"
  # POST /api/pull com stream: uma linha a cada 10% do arquivo grande; o Ollama retoma o que já baixou.
  curl -fsS -N -X POST -H 'content-type: application/json' -d "{\"model\":\"$OLLAMA_MODELO\",\"stream\":true}" "$BASE/api/pull" 2>/dev/null | python3 -c '
import json, sys
pct = -10; ok = False; erro = None
for l in sys.stdin:
    try: e = json.loads(l)
    except Exception: continue
    if e.get("status") == "success": ok = True
    if isinstance(e.get("error"), str): erro = e["error"]
    t, c = e.get("total"), e.get("completed")
    if isinstance(t, (int, float)) and t > 50e6 and isinstance(c, (int, float)):
        p = int(c * 100 / t)
        if p >= pct + 10 and p < 100: pct = p; print("baixando o modelo: %d%%" % p, flush=True)
if erro: print("ERRO=o Ollama não baixou o modelo: " + erro); sys.exit(1)
if not ok: print("ERRO=o download do modelo parou antes do fim; rode de novo que ele continua"); sys.exit(1)
' || exit 0
fi

# A marca por último: só existe com o serviço no ar e o modelo baixado (é ela que as contas leem).
printf '{"porta": %s, "modelo": "%s", "versao": "%s"}\n' "$P" "$OLLAMA_MODELO" "$OLLAMA_VERSION" > "$MARCA.tmp" && mv "$MARCA.tmp" "$MARCA"
chmod 644 "$MARCA"
# Confere como um usuário comum: lê a marca e fala com o Ollama.
runuser -u nobody -- cat "$MARCA" >/dev/null 2>&1 || { echo "ERRO=um usuário comum não consegue ler $MARCA; confira as permissões"; exit 0; }
echo "OLLAMA_GLOBAL=ok $P"
