#!/bin/bash
# Hook `Stop` do Claude Code (ver .claude/settings.json): ao fim de cada resposta, mantém os apps instalados em
# ~/Applications iguais ao `origin/main` de agora, e só isso. Até 1/11 empacotava a árvore de trabalho onde morava:
# com vários worktrees e sessões (Claude, Cursor) instalando no mesmo ~/Applications, o app instalado virava "o último
# branch em que alguém mexeu" (issue #57). Agora:
# - o que se instala sai de um worktree fixo de build, `<checkout principal>/../meu-bot-build-main`, sempre em `origin/main`
#   (detached). Um `main` local com commits fora do origin não conta: o que vale é o que já entrou no GitHub;
# - num branch, mudança no código só roda `npm test` em segundo plano e avisa se quebrou; nada é instalado. Para ver
#   um branch na tela, empacote à mão (`npm run dist…` de dentro do worktree) e confira pelo grep do asar (CLAUDE.md);
# - trava e carimbo do que está instalado são globais (~/Library/Application Support/meu-bot-rebuild/): um ciclo por Mac,
#   qualquer que seja o worktree que o disparou.
#
#   rebuild-auto.sh            modo hook: fetch rápido, compara origin/main com o instalado e dispara `--run` destacado;
#                              num branch com mudança, dispara `--testar`
#   rebuild-auto.sh --check    só mostra: branch, origin/main × instalado, o que mudou e o plano
#   rebuild-auto.sh --run      o ciclo inteiro: worktree de build em origin/main → testes → fecha → empacota → reabre
#   rebuild-auto.sh --testar   só `npm test` neste checkout (o que um branch ganha), avisando se quebrou
set -u
# Homebrew e /usr/local no fim: quem chama (ou os testes, com npm/open falsos) decide o que vem primeiro.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ" || exit 0
# Estado global (um por Mac): trava do ciclo e o commit instalado. MEU_BOT_REBUILD_* só existem para os testes.
ESTADO="${MEU_BOT_REBUILD_DIR:-$HOME/Library/Application Support/meu-bot-rebuild}"
LOCK="$ESTADO/lock"; INSTALADO="$ESTADO/instalado"
LOG="${MEU_BOT_REBUILD_LOG:-$HOME/Library/Logs/meu-bot-rebuild.log}"
# Carimbo por checkout: "o que mudou aqui desde a última conferência" (só decide se os testes do branch rodam).
STAMP="$RAIZ/.claude/.rebuild-stamp"
mkdir -p "$ESTADO" "$(dirname "$LOG")" "$RAIZ/.claude"
# pastas que o app empacotado usa (a skill rebuildar): mudou aqui = vale conferir
# (build/ e dist/ ficam de fora: são saída do empacotamento; vigiá-los faria o ciclo disparar a si mesmo)
VIGIAR=(src scripts/tests scripts/package.mjs scripts/dist.mjs scripts/fuses.mjs scripts/vendor.mjs scripts/icons.mjs config assets extensao-crm/src extensao-crm/package.json package.json package-lock.json)
# variante | app em ~/Applications | script npm
TABELA="admin|meu-bot-admin|dist:admin
meu-bot|meu-bot|dist
staging|meu-bot-staging|dist:staging
finance-staging|meu-bot-finance-staging|dist:finance-staging
diego|meu-bot-diego|dist:diego
diego-staging|meu-bot-diego-staging|dist:diego-staging"
# Checkout principal (o dono do .git; worktrees apontam para ele) e, ao lado dele, o worktree fixo de build.
PRINCIPAL="$(cd "$(git rev-parse --git-common-dir 2>/dev/null || echo .git)/.." && pwd)"
BUILD="${MEU_BOT_BUILD_DIR:-$(dirname "$PRINCIPAL")/meu-bot-build-main}"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }
avisar() { osascript -e "display notification \"$2\" with title \"meu-bot · rebuild\" subtitle \"$1\"" >/dev/null 2>&1 || true; }
branch_atual() { git branch --show-current 2>/dev/null; }
sha_origin() { git rev-parse --short=12 origin/main 2>/dev/null; }
# `instalado` guarda "<sha> ok" ou "<sha> falhou": um build que falhou não é tentado de novo até o main mudar.
sha_instalado() { cut -d' ' -f1 "$INSTALADO" 2>/dev/null; }
# fetch só quando o GitHub responde rápido: sem rede, o hook não pode segurar a resposta esperando o git.
fetch_main() { curl -s -m 3 -o /dev/null https://github.com 2>/dev/null || return 1; git fetch -q origin main 2>/dev/null; }
mudados() {
  local alvos=()
  for p in "${VIGIAR[@]}"; do [ -e "$p" ] && alvos+=("$p"); done
  [ ${#alvos[@]} -gt 0 ] || return 0
  if [ -f "$STAMP" ]; then
    find "${alvos[@]}" -type f -newer "$STAMP" -not -path "*/node_modules/*" -not -path "*/dist/*" -not -name ".DS_Store" 2>/dev/null
  else
    echo "(sem carimbo: ainda sem ponto de partida)"
  fi
}
aberto() { pgrep -f "/$1.app/Contents/MacOS/" >/dev/null 2>&1; }
fechar() {
  osascript -e "quit app \"$1\"" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8; do aberto "$1" || return 0; sleep 1; done
  pkill -f "/$1.app/Contents/MacOS/" >/dev/null 2>&1 || true; sleep 1
}
# ordem: abertos primeiro, depois admin, depois os outros instalados
planejar() {
  local abertos=() resto=()
  while IFS='|' read -r v app script; do
    [ -d "$HOME/Applications/$app.app" ] || continue
    if aberto "$app"; then abertos+=("$v|$app|$script|reabrir"); elif [ "$v" = admin ]; then resto=("$v|$app|$script|so-build" ${resto[@]+"${resto[@]}"}); else resto+=("$v|$app|$script|so-build"); fi
  done <<< "$TABELA"
  printf '%s\n' ${abertos[@]+"${abertos[@]}"} ${resto[@]+"${resto[@]}"} | sed '/^$/d'
}
# O worktree de build em origin/main, com o que o git não guarda: dependências (link para o checkout principal) e os
# arquivos locais do empacotamento (extensão do autenticador compilada e os clients do Google).
preparar_build() {
  if [ -e "$BUILD/.git" ]; then git -C "$BUILD" checkout -q --detach origin/main || return 1
  else git worktree add -q --detach "$BUILD" origin/main || return 1; fi
  [ -e "$BUILD/node_modules" ] || ln -s "$PRINCIPAL/node_modules" "$BUILD/node_modules"
  [ -e "$BUILD/extensao-crm/node_modules" ] || { [ -d "$PRINCIPAL/extensao-crm/node_modules" ] && ln -s "$PRINCIPAL/extensao-crm/node_modules" "$BUILD/extensao-crm/node_modules"; }
  mkdir -p "$BUILD/build" "$BUILD/config"
  [ -d "$BUILD/build/extensao-autenticador" ] || { [ -d "$PRINCIPAL/build/extensao-autenticador" ] && cp -R "$PRINCIPAL/build/extensao-autenticador" "$BUILD/build/"; }
  for f in google-oauth.json google-conta-oauth.json; do [ -f "$PRINCIPAL/config/$f" ] && cp "$PRINCIPAL/config/$f" "$BUILD/config/$f"; done
  return 0
}

modo="${1:-hook}"
case "$modo" in
  --check)
    echo "branch: $(branch_atual || echo '(detached)') · checkout principal: $PRINCIPAL · worktree de build: $BUILD"
    echo "origin/main: $(sha_origin || echo '?') · instalado: $(cat "$INSTALADO" 2>/dev/null || echo nenhum)"
    echo "Mudou neste checkout desde a última conferência:"; mudados | sed 's/^/  /'
    echo "Plano (só a partir de origin/main):"; planejar | sed 's/^/  /';;
  --testar)
    touch "$STAMP"
    log "=== testes do branch $(branch_atual) em $RAIZ"
    if npm test >> "$LOG" 2>&1; then log "testes ok (nada instalado: o branch não é o origin/main)"
    else log "TESTES FALHARAM no branch $(branch_atual) (carimbo desfeito para conferir de novo)"; rm -f "$STAMP"; avisar "testes falharam" "branch $(branch_atual): veja ~/Library/Logs/meu-bot-rebuild.log"; fi;;
  --run)
    if ! mkdir "$LOCK" 2>/dev/null; then log "já há um ciclo rodando; este sai"; exit 0; fi
    trap 'rmdir "$LOCK" 2>/dev/null' EXIT
    fetch_main || true
    alvo=$(sha_origin) || { log "sem origin/main: nada a instalar"; exit 0; }
    log "=== ciclo: instalar origin/main $alvo (instalado: $(cat "$INSTALADO" 2>/dev/null || echo nenhum))"
    avisar "começando" "origin/main $alvo: testes e empacotamento em segundo plano"
    if ! preparar_build; then log "não consegui preparar o worktree de build em $BUILD"; echo "$alvo falhou" > "$INSTALADO"; avisar "falhou" "worktree de build em $BUILD"; exit 0; fi
    cd "$BUILD" || exit 0
    npm run build:extensao >> "$LOG" 2>&1 || true
    if ! npm test >> "$LOG" 2>&1; then
      log "TESTES FALHARAM no origin/main $alvo: nada empacotado"; echo "$alvo falhou" > "$INSTALADO"
      avisar "testes falharam" "origin/main $alvo não foi empacotado; veja ~/Library/Logs/meu-bot-rebuild.log"; exit 0
    fi
    feitos=(); falhas=()
    while IFS='|' read -r v app script acao; do
      [ -n "$v" ] || continue
      [ "$acao" = reabrir ] && { log "fechando $app"; fechar "$app"; }
      log "npm run $script"
      if npm run "$script" >> "$LOG" 2>&1; then feitos+=("$app"); else falhas+=("$app"); log "FALHOU: $script"; fi
      if [ "$acao" = reabrir ]; then
        # passo 4 da skill testar-no-app: abre, espera, confere que ficou de pé e que não há erro novo no log do app
        applog="$HOME/Library/Application Support/$app/meu-bot.log"; antes=$( [ -f "$applog" ] && wc -l < "$applog" || echo 0 )
        open "$HOME/Applications/$app.app"; sleep 8
        if aberto "$app"; then
          erros=$( [ -f "$applog" ] && tail -n +$((antes+1)) "$applog" | grep -iE "erro|error|falh|exception|uncaught" | head -3 )
          if [ -n "$erros" ]; then log "reaberto $app, MAS com erro novo no log: $erros"; falhas+=("$app (erro no log)"); else log "reaberto $app: de pé, sem erro novo"; fi
        else log "$app NÃO ficou de pé depois de reabrir"; falhas+=("$app (caiu)"); fi
      fi
    done <<< "$(planejar)"
    if [ -z "${falhas[*]:-}" ]; then echo "$alvo ok" > "$INSTALADO"; else echo "$alvo falhou" > "$INSTALADO"; fi
    log "=== fim: origin/main $alvo · ok=${feitos[*]:-nenhum} falhas=${falhas[*]:-nenhuma}"
    if [ -z "${falhas[*]:-}" ]; then avisar "pronto" "origin/main $alvo: ${feitos[*]:-nada} reempacotado(s); o app aberto já reabriu"; else avisar "com falhas" "falhou: ${falhas[*]} (log em ~/Library/Logs)"; fi;;
  *)
    cat >/dev/null 2>&1 || true   # stdin JSON do hook: não usamos
    fetch_main || true
    alvo=$(sha_origin || true)
    if [ -n "$alvo" ] && [ "$alvo" != "$(sha_instalado)" ]; then
      if [ -d "$LOCK" ]; then echo '{"systemMessage":"Rebuild automático já está rodando em segundo plano."}'; exit 0; fi
      nohup bash "$0" --run >/dev/null 2>&1 &
      echo "{\"systemMessage\":\"origin/main mudou ($alvo): instalando em ~/Applications em segundo plano, a partir do worktree de build $BUILD. Testes → fecha → empacota → reabre; o Mac avisa quando terminar (log: ~/Library/Logs/meu-bot-rebuild.log).\"}"
      exit 0
    fi
    # Sem carimbo neste checkout: a primeira resposta só marca o ponto de partida (não há "mudança" para conferir).
    [ -f "$STAMP" ] || { touch "$STAMP"; exit 0; }
    lista="$(mudados)"
    [ -z "$lista" ] && exit 0
    n=$(printf '%s\n' "$lista" | wc -l | tr -d ' ')
    branch=$(branch_atual)
    if [ "$branch" = main ]; then
      touch "$STAMP"
      echo "{\"systemMessage\":\"$n arquivo(s) do app mudaram neste checkout, mas o hook só instala o que está no origin/main: mudança local no main não é empacotada até entrar lá.\"}"
      exit 0
    fi
    nohup bash "$0" --testar >/dev/null 2>&1 &
    echo "{\"systemMessage\":\"Branch ${branch:-detached}: $n arquivo(s) do app mudaram. O hook não empacota branches (os apps instalados seguem o origin/main); rodando só npm test em segundo plano. Para ver este branch na tela, empacote à mão com npm run dist… neste worktree e confira pelo grep do asar.\"}";;
esac
exit 0
