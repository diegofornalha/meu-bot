#!/usr/bin/env bash
# Fumaça do controle externo (MCP) com um cliente real: prova que o Claude Code deste Mac conecta no servidor embutido
# do app (Configurações › Controle externo (MCP)). Rode depois de mexer no protocolo (controle-remoto-core.ts,
# controle-remoto.ts) ou no term.sock. O teste unitário cobre o núcleo puro; isto cobre o aperto de mão de verdade:
#   1. lê porta e chave do settings.json do app (o app precisa estar aberto com o controle ligado);
#   2. curl: initialize anuncia a revisão certa, tools/list vem com ferramentas, GET → 405, sem Bearer → 401;
#   3. `claude mcp add --transport http` em escopo local (só este diretório) e `claude mcp list` tem de dizer Connected;
#   4. remove o registro, sempre (também em falha).
# Uso: scripts/mcp-fumaca.sh [meu-bot|meu-bot-staging|meu-bot-inspector-staging|meu-bot-admin-gestao]  (padrão: meu-bot)
# Sai 0 quando tudo passou; 1 com a primeira falha explicada. Nada aqui muda o app nem a configuração global do Claude Code.
set -u
export PATH="$HOME/.local/bin:$PATH"
APP="${1:-meu-bot}"
SETTINGS="$HOME/Library/Application Support/$APP/settings.json"
NOME="${APP}-fumaca"
falha() { echo "✗ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }

command -v claude >/dev/null || falha "claude (Claude Code) não está no PATH"
command -v node >/dev/null || falha "node não está no PATH (só para ler o settings.json)"
[ -f "$SETTINGS" ] || falha "não achei $SETTINGS: abra o $APP uma vez"

# Porta e chave: o que está gravado; porta null = a padrão da variante (Produto.portaMcp, dist/main/app/variant-core.js).
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
LEITURA="$(node -e '
const fs = require("fs"); const [settings, raiz, app] = process.argv.slice(1);
const j = JSON.parse(fs.readFileSync(settings, "utf8"));
let porta = j.mcpPorta ?? null;
if (porta === null) { try { const { PRODUTOS } = require(raiz + "/dist/main/app/variant-core.js"); porta = PRODUTOS.find((p) => p.nome === app)?.portaMcp ?? null; } catch { /* sem dist: pede --porta */ } }
console.log(JSON.stringify({ ligado: j.mcpLigado === true, porta, token: j.mcpToken || "" }));
' "$SETTINGS" "$RAIZ" "$APP")"
LIGADO="$(node -e 'console.log(JSON.parse(process.argv[1]).ligado)' "$LEITURA")"
PORTA="$(node -e 'console.log(JSON.parse(process.argv[1]).porta ?? "")' "$LEITURA")"
TOKEN="$(node -e 'console.log(JSON.parse(process.argv[1]).token)' "$LEITURA")"
[ "$LIGADO" = "true" ] || falha "o controle externo está desligado no $APP: ligue em Configurações › Controle externo (MCP)"
[ -n "$PORTA" ] || falha "não consegui saber a porta (sem mcpPorta gravado e sem dist/: rode npm run build)"
[ -n "$TOKEN" ] || falha "sem chave gravada: desligue e ligue o controle externo no app"
URL="http://127.0.0.1:$PORTA/mcp"

# 2. O endpoint responde como o núcleo promete.
post() { curl -s -m 10 -X POST "$URL" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "X-Meu-Bot-Cliente: fumaca" -d "$1"; }
INIT="$(post '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mcp-fumaca","version":"1"}}}')" || falha "o app não respondeu em $URL (está aberto? o controle está ligado?)"
echo "$INIT" | grep -q '"protocolVersion":"2025-06-18"' || falha "initialize não anunciou 2025-06-18: $INIT"
ok "initialize em $URL (revisão 2025-06-18)"
N="$(post '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const j=JSON.parse(s);console.log(Array.isArray(j.result?.tools)?j.result.tools.length:0)})')"
[ "$N" -ge 30 ] || falha "tools/list veio com $N ferramentas (esperava pelo menos 30)"
ok "tools/list: $N ferramentas"
C="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$URL" -H "Authorization: Bearer $TOKEN")"; [ "$C" = "405" ] || falha "GET devia dar 405 e deu $C"
C="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$URL" -H "Content-Type: application/json" -d '{}')"; [ "$C" = "401" ] || falha "sem Bearer devia dar 401 e deu $C"
ok "GET → 405, sem chave → 401"

# 3. O cliente de verdade. Escopo local: só este diretório, e sai no fim de qualquer jeito.
limpar() { claude mcp remove -s local "$NOME" >/dev/null 2>&1 || true; }
trap limpar EXIT
limpar
claude mcp add --transport http -s local "$NOME" "$URL" --header "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || falha "claude mcp add falhou"
LISTA="$(claude mcp list 2>&1 | grep -F "$NOME" || true)"
echo "$LISTA" | grep -q "Connected" || falha "o Claude Code não conectou: ${LISTA:-(o servidor nem apareceu na lista)}"
ok "Claude Code: $LISTA"
echo "Tudo certo: o $APP aceita um cliente MCP real em $URL."
