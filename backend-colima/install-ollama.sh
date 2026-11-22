#!/usr/bin/env bash
# Modo grátis nesta máquina (tutorial 16): o Ollama do meu-bot numa pasta própria (~/.local/share/meu-bot/ollama, na
# versão fixa que o app manda, conferida pelo sha256; nada em /usr e sem mexer num Ollama que a pessoa já tenha), como
# serviço do usuário `meu-bot-ollama.service` numa porta própria (a do backend - 200, como no Mac), e a entrada
# "ollama-local" no providers.json do backend (mesclada: as outras entradas ficam). O molde é o install-grok-oauth.sh.
# Rodar no host, sem sudo. Idempotente. A versão, o sha256, a URL e o modelo vêm do app (fonte única: ollamaLocal-core.ts):
#   OLLAMA_VERSION OLLAMA_SHA256 OLLAMA_URL OLLAMA_MODELO [OLLAMA_PACOTE_MB]
#   bash install-ollama.sh           instala (ou completa uma instalação interrompida)
#   bash install-ollama.sh remover   para o serviço, tira o ollama-local do providers.json e apaga a pasta
set -euo pipefail
ACAO=${1:-instalar}
CANON=$HOME/.local/share/meu-bot/backend; LEGACY=$HOME/.hermes/agente-rene/backend-sdk-claude
if [ -f "$CANON/server.js" ]; then BACKEND=$CANON; elif [ -f "$LEGACY/server.js" ] && grep -q "meu-bot/hello" "$LEGACY/server.js" 2>/dev/null; then BACKEND=$LEGACY; else BACKEND=$CANON; fi
[ -f "$BACKEND/server.js" ] || { echo "esta máquina não tem o backend do meu-bot; instale pelo seletor antes"; exit 2; }
[ -f "$BACKEND/providers.js" ] || { echo "o backend desta máquina é antigo (sem providers.js): use \"Reinstalar backend\" no seletor e tente de novo"; exit 3; }

PREFIX=$HOME/.local/share/meu-bot/ollama
U=$HOME/.config/systemd/user
UNIT=meu-bot-ollama.service
USER_UNIT=$U/meu-bot-backend.service
SYS_UNIT=/etc/systemd/system/meu-bot-backend.service
# O backend pode ser serviço de usuário (o normal), de sistema ou nenhum dos dois: reiniciar o que existe.
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
# O node do backend (num shell sem login ele pode não estar no PATH): é ele quem mescla o providers.json e segue o download do modelo.
NODE=$(grep -h '^ExecStart=' "$USER_UNIT" "$SYS_UNIT" 2>/dev/null | head -1 | awk '{print $1}' | sed 's/^ExecStart=//' || true)
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then NODE=$(command -v node || true); fi
[ -n "$NODE" ] || { echo "node não encontrado nesta máquina (o backend do meu-bot precisa dele)"; exit 1; }
if ! command -v systemctl >/dev/null 2>&1 || ! systemctl --user show-environment >/dev/null 2>&1; then echo "esta conta não tem systemd de usuário; o modo grátis precisa dele para o Ollama ficar no ar"; exit 1; fi

# Porta do Ollama: a do backend desta conta - 200 (cada conta da máquina tem a sua, como o backend).
BPORT=$(grep -h '^PORT=' "$BACKEND/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -dc '0-9' || true)
[ -n "$BPORT" ] || BPORT=8080
OPORT=$((BPORT-200))
BASE=http://127.0.0.1:$OPORT
P=$BACKEND/providers.json
listening() { (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":$1 "; }
responde() { curl -fsS -m 3 "$BASE/api/version" >/dev/null 2>&1; }

# --- providers.json: início ---
# Mescla (ou tira) a entrada ollama-local sem tocar nas outras; um arquivo ilegível recomeça do agente, como no Mac.
providers_ollama() { # $1 = arquivo, $2 = "por" | "tirar", $3 = porta, $4 = modelo
  "$NODE" -e '
    const fs = require("fs"); const [arq, acao, porta, modelo] = process.argv.slice(1);
    let l; try { l = JSON.parse(fs.readFileSync(arq, "utf8")); } catch { l = null; }
    if (!Array.isArray(l)) l = [{ name: "agente", type: "claude", priority: 0, description: "Claude Code com ferramentas, sem pedir permissão (bypass)" }];
    l = l.filter((e) => !(e && typeof e === "object" && e.name === "ollama-local"));
    if (acao === "por") l.push({ name: "ollama-local", type: "openai", priority: 9, base_url: `http://127.0.0.1:${porta}/v1`, model: modelo, timeout_ms: 300000, description: "Modo grátis: Ollama nesta máquina (tutorial 16)" });
    fs.writeFileSync(arq, "[\n" + l.map((e) => "  " + JSON.stringify(e)).join(",\n") + "\n]\n");
  ' "$1" "$2" "${3:-}" "${4:-}"
}
# --- providers.json: fim ---

if [ "$ACAO" = "remover" ]; then
  systemctl --user disable --now "$UNIT" >/dev/null 2>&1 || true
  rm -f "${U:?}/${UNIT:?}"; systemctl --user daemon-reload >/dev/null 2>&1 || true
  echo "serviço $UNIT parado e removido"
  if [ -f "$P" ] && grep -q '"ollama-local"' "$P"; then providers_ollama "$P" tirar; echo "ollama-local tirado do providers.json"; backend_restart; fi
  rm -rf "${HOME:?}/.local/share/meu-bot/ollama"
  echo "pronto: modo grátis removido desta máquina"
  exit 0
fi

: "${OLLAMA_VERSION:?falta OLLAMA_VERSION}" "${OLLAMA_SHA256:?falta OLLAMA_SHA256}" "${OLLAMA_URL:?falta OLLAMA_URL}" "${OLLAMA_MODELO:?falta OLLAMA_MODELO}"
PACOTE_MB=${OLLAMA_PACOTE_MB:-1500}
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then echo "o modo grátis remoto precisa de Linux x86_64 (esta máquina: $(uname -s) $(uname -m))"; exit 1; fi
for c in curl sha256sum tar zstd; do command -v "$c" >/dev/null 2>&1 || { echo "falta o programa \"$c\" nesta máquina (peça a quem administra: apt install $c)"; exit 1; }; done

DIR=$PREFIX/v$OLLAMA_VERSION
BIN=$DIR/bin/ollama
mkdir -p "$PREFIX"
if [ ! -x "$BIN" ]; then
  PKG=$PREFIX/ollama-$OLLAMA_VERSION.tar.zst.parcial
  TMP=$PREFIX/v$OLLAMA_VERSION.extraindo
  echo "baixando o Ollama $OLLAMA_VERSION (~$PACOTE_MB MB)…"
  rm -f "${PKG:?}"
  curl -fsSL -o "$PKG" "$OLLAMA_URL" &
  CURL=$!
  ULT=0
  while kill -0 "$CURL" 2>/dev/null; do
    sleep 3
    FEITO=$(( $(stat -c %s "$PKG" 2>/dev/null || echo 0) / 1048576 ))
    PCT=$(( FEITO * 100 / PACOTE_MB ))
    if [ "$PCT" -ge $((ULT+20)) ] && [ "$PCT" -lt 100 ]; then ULT=$PCT; echo "baixando o Ollama: $PCT%"; fi
  done
  wait "$CURL" || { rm -f "${PKG:?}"; echo "o download do Ollama falhou"; exit 1; }
  echo "$OLLAMA_SHA256  $PKG" | sha256sum -c - >/dev/null 2>&1 || { rm -f "${PKG:?}"; echo "o pacote do Ollama não confere (sha256); nada foi instalado"; exit 1; }
  echo "pacote conferido (sha256); extraindo…"
  rm -rf "${TMP:?}"; mkdir -p "$TMP"
  tar --zstd -xf "$PKG" -C "$TMP" || { rm -rf "${TMP:?}" "${PKG:?}"; echo "não deu para extrair o Ollama"; exit 1; }
  rm -f "${PKG:?}"
  [ -x "$TMP/bin/ollama" ] || { rm -rf "${TMP:?}"; echo "o pacote do Ollama veio sem bin/ollama"; exit 1; }
  rm -rf "${DIR:?}"; mv "$TMP" "$DIR"
fi
echo "Ollama $OLLAMA_VERSION em $DIR"

# A porta é desta conta? Outra conta (ou outro programa) nela faria o ollama-local responder pelo vizinho.
mkdir -p "$U" "$PREFIX/models"
if listening "$OPORT" && ! systemctl --user is-active "$UNIT" >/dev/null 2>&1; then echo "a porta $OPORT já está em uso nesta máquina por outro programa"; exit 1; fi
cat > "$U/$UNIT" <<UNIDADE
[Unit]
Description=meu-bot: modo grátis (Ollama nesta máquina)
After=network.target

[Service]
ExecStart=$BIN serve
Restart=always
RestartSec=15
Environment=HOME=$HOME
Environment=OLLAMA_HOST=127.0.0.1:$OPORT
Environment=OLLAMA_MODELS=$PREFIX/models
# O modelo sai da memória depois de 10 min parado: a máquina não fica com ~2 GB presos à toa.
Environment=OLLAMA_KEEP_ALIVE=10m

[Install]
WantedBy=default.target
UNIDADE
systemctl --user daemon-reload
systemctl --user enable "$UNIT" >/dev/null 2>&1 || true
systemctl --user restart "$UNIT"
loginctl enable-linger "$USER" >/dev/null 2>&1 || true
for _ in $(seq 1 40); do responde && break; sleep 0.5; done
responde || { echo "o Ollama não respondeu em 20 s (veja: journalctl --user -u $UNIT)"; exit 1; }

if curl -fsS -m 5 "$BASE/api/tags" 2>/dev/null | grep -q "\"$OLLAMA_MODELO\""; then
  echo "modelo $OLLAMA_MODELO já baixado"
else
  echo "baixando o modelo $OLLAMA_MODELO (pode levar alguns minutos)…"
  # POST /api/pull com stream: uma linha a cada 10% do arquivo grande.
  "$NODE" -e '
    const [base, modelo] = process.argv.slice(1);
    (async () => {
      const r = await fetch(base + "/api/pull", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: modelo, stream: true }) });
      if (!r.ok || !r.body) { console.log("o Ollama recusou baixar " + modelo + " (HTTP " + r.status + ")"); process.exit(1); }
      const dec = new TextDecoder(); let buf = ""; let pct = -10; let ok = false; let erro = null;
      const linha = (l) => {
        if (!l.trim()) return; let e; try { e = JSON.parse(l); } catch { return; }
        if (e.status === "success") ok = true;
        if (typeof e.error === "string") erro = e.error;
        if (typeof e.total === "number" && e.total > 50e6 && typeof e.completed === "number") { const p = Math.floor(e.completed * 100 / e.total); if (p >= pct + 10 && p < 100) { pct = p; console.log("baixando o modelo: " + p + "%"); } }
      };
      for await (const c of r.body) { buf += dec.decode(c, { stream: true }); const ls = buf.split("\n"); buf = ls.pop(); ls.forEach(linha); }
      linha(buf);
      if (erro) { console.log("o Ollama não baixou " + modelo + ": " + erro); process.exit(1); }
      if (!ok) { console.log("o download de " + modelo + " parou antes do fim"); process.exit(1); }
    })().catch((e) => { console.log("o download do modelo falhou: " + e.message); process.exit(1); });
  ' "$BASE" "$OLLAMA_MODELO"
fi

providers_ollama "$P" por "$OPORT" "$OLLAMA_MODELO"
printf '%s\n' "$OLLAMA_MODELO" > "$PREFIX/modelo"
echo "ollama-local apontado para o Ollama desta conta (porta $OPORT, modelo $OLLAMA_MODELO)"
backend_restart
echo "pronto: o modo grátis responde nesta máquina"
