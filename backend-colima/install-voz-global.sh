#!/bin/bash
# Voz para todos (root): UM Kokoro na máquina, em /opt/meu-bot-voz (todos leem, como o /opt/transcriber): o ambiente
# Python com o kokoro-onnx, o modelo (~325 MB) e as vozes (~28 MB). O install-voz.sh de cada conta acha a marca
# /opt/meu-bot-voz/global.json e só aponta a pasta dela para cá: não baixa nada, não gasta a cota de disco e fica
# pronto em segundos (eram ~600 MB e, numa VM em que o GitHub entrega a 60 KB/s, mais de uma hora por conta).
# Idempotente; o download retoma de onde parou. Antes de baixar, aproveita o arquivo que alguma conta desta máquina já
# tem, se o sha256 conferir (é o sha256 que impede uma conta de trocar o modelo de todas).
#   bash install-voz-global.sh           instala (ou completa uma instalação interrompida)
#   bash install-voz-global.sh remover   apaga /opt/meu-bot-voz (as contas voltam a baixar a própria cópia ao reinstalar a voz)
# Saída: VOZ_GLOBAL=ok (ou VOZ_GLOBAL=removido), ou ERRO=<motivo>.
set -u
umask 022
ACAO=${1:-instalar}
[ "$(id -u)" = 0 ] || { echo "ERRO=a voz para todos precisa ser instalada como root"; exit 0; }
D=/opt/meu-bot-voz; MARCA=$D/global.json
# Os mesmos do install-voz.sh (o teste vozes-core confere que não divergem).
KOKORO_PKG=kokoro-onnx==0.4.9
KOKORO_URL=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
ONNX_SHA256=7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5
VOZES_SHA256=bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d
# Onde procurar a cópia que uma conta já baixou (uma pasta por linha do glob).
SEMENTES=${MEU_BOT_VOZ_SEMENTES:-/home/*/.local/share/meu-bot/voz/kokoro}

if [ "$ACAO" = "remover" ]; then
  rm -rf "${D:?}"
  echo "VOZ_GLOBAL=removido"
  exit 0
fi

if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then echo "ERRO=a voz natural precisa de Linux x86_64 (esta máquina: $(uname -s) $(uname -m))"; exit 0; fi
for c in curl sha256sum python3 runuser; do command -v "$c" >/dev/null 2>&1 || { echo "ERRO=falta o programa \"$c\" nesta máquina (apt install $c)"; exit 0; }; done
mkdir -p "$D" || { echo "ERRO=não consegui criar $D"; exit 0; }
chmod 755 "$D"

# --- arquivos: início ---
# confere <arquivo> <sha256>: o arquivo existe e é exatamente o esperado.
confere() { [ -f "$1" ] && echo "$2  $1" | sha256sum -c - >/dev/null 2>&1; }
# traz <nome> <sha256> <mb>: deixa $D/<nome> conferido. Ordem: já está; cópia de uma conta desta máquina; download.
# O arquivo só ganha o nome final depois de conferido: quem o lê nunca pega um pedaço.
traz() {
  local nome=$1 sha=$2 mb=$3 dest=$D/$1 parcial=$D/$1.parcial s
  confere "$dest" "$sha" && { echo "$nome já está em $D"; return 0; }
  for s in $SEMENTES; do
    # Só arquivo de verdade: o link de uma conta já convertida aponta para cá mesmo.
    [ -f "$s/$nome" ] && [ ! -L "$s/$nome" ] || continue
    confere "$s/$nome" "$sha" || continue
    cp "$s/$nome" "$parcial" && confere "$parcial" "$sha" && { mv -f "$parcial" "$dest"; echo "$nome aproveitado de uma conta desta máquina (sha256 conferido)"; return 0; }
    rm -f "${parcial:?}"
  done
  echo "baixando $nome (~$mb MB; retoma de onde parou)…"
  curl -fsSL --retry 5 --retry-delay 5 -C - -o "$parcial" "$KOKORO_URL/$nome" || { echo "ERRO=o download de $nome parou; rode de novo que ele continua de onde parou"; return 1; }
  confere "$parcial" "$sha" || { rm -f "${parcial:?}"; echo "ERRO=$nome não confere (sha256); nada foi instalado"; return 1; }
  mv -f "$parcial" "$dest"
  echo "$nome conferido (sha256)"
}
# --- arquivos: fim ---

traz kokoro-v1.0.onnx "$ONNX_SHA256" 325 || exit 0
traz voices-v1.0.bin "$VOZES_SHA256" 28 || exit 0

# O ambiente Python, uma vez: as contas o executam direto daqui (só leitura para elas).
V=$D/venv
if [ ! -x "$V/bin/python" ] || ! "$V/bin/python" -c "import kokoro_onnx, soundfile" 2>/dev/null; then
  echo "preparando o Kokoro ($KOKORO_PKG)…"
  rm -rf "${V:?}"
  if ! python3 -m venv "$V" >/dev/null 2>&1; then
    rm -rf "${V:?}"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q python3-venv >/dev/null 2>&1 || true
    python3 -m venv "$V" >/dev/null 2>&1 || { rm -rf "${V:?}"; echo "ERRO=falta o python3-venv e o apt não o instalou (Preparar máquina › Pacotes do sistema)"; exit 0; }
  fi
  "$V/bin/pip" -q install "$KOKORO_PKG" soundfile >/dev/null 2>&1 || { rm -rf "${V:?}"; echo "ERRO=não consegui instalar o $KOKORO_PKG"; exit 0; }
fi

chown -R root:root "$D"; chmod -R u=rwX,go=rX "$D"
# Confere como um usuário comum: lê o modelo e roda o Python daqui.
runuser -u nobody -- test -r "$D/kokoro-v1.0.onnx" || { echo "ERRO=um usuário comum não consegue ler $D/kokoro-v1.0.onnx; confira as permissões"; exit 0; }
runuser -u nobody -- "$V/bin/python" -c "import kokoro_onnx, soundfile" >/dev/null 2>&1 || { echo "ERRO=um usuário comum não consegue usar o Kokoro de $V"; exit 0; }

# A marca por último: só existe com os arquivos conferidos e o ambiente pronto (é ela que as contas leem).
printf '{"pacote": "%s"}\n' "$KOKORO_PKG" > "$MARCA.tmp" && mv "$MARCA.tmp" "$MARCA"
chmod 644 "$MARCA"
echo "VOZ_GLOBAL=ok"
