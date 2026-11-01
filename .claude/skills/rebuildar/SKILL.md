---
name: rebuildar
description: Rebuilda e reinstala o meu-bot-admin (e as outras variantes afetadas) depois de qualquer modificação no código do meu-bot. Use SEMPRE ao terminar uma mudança em src/, scripts/, build/, config/, assets/ ou extensao-crm/, sem esperar o usuário pedir, e também quando ele disser "rebuilda", "refilda", "reempacota" ou "gera o app de novo".
---

# Rebuildar o meu-bot depois de mudar o código

> **Automático (desde 1 nov 2026, issue #57):** o hook `Stop` em `.claude/settings.json` roda
> `scripts/hooks/rebuild-auto.sh` ao fim de cada resposta e mantém `~/Applications` igual ao **`origin/main`**: quando
> o `main` do GitHub muda, ele empacota num worktree fixo (`../meu-bot-build-main`, ao lado do checkout principal) em
> segundo plano: testes → fecha os apps abertos → empacota (abertos primeiro, depois admin, depois os demais
> instalados) → reabre, e o Mac avisa. Num branch, mudança no código só roda `npm test`; **nada de branch é instalado
> pelo hook**. Os passos abaixo são para ver um branch na tela antes do merge (rode-os de dentro do worktree) ou para
> uma variante específica agora; o próximo merge no `main` reinstala por cima. `--check` mostra branch, `origin/main` ×
> instalado e o plano; a trava e o commit instalado ficam em `~/Library/Application Support/meu-bot-rebuild/`.

O app instalado é empacotado: mudança no código só vale depois de rebuildar. Ao terminar uma modificação, faça isto sem perguntar.

1. **Testes primeiro**: `npm test` (já roda o build). Se falhar, pare, corrija ou mostre a falha ao usuário. Não empacote com teste quebrado.
2. **Feche o app velho** (o novo substitui o .app instalado):
   `pgrep -f "meu-bot-admin.app/Contents/MacOS"`. Se estiver aberto, avise o usuário e só feche com `osascript -e 'quit app "meu-bot-admin"'` se ele concordar.
3. **Empacote a variante certa** pelo que mudou (`git status --short` / `git diff --name-only`):
   - Sempre: `npm run dist:admin` (instala em ~/Applications/meu-bot-admin.app e atualiza o atalho na Área de Trabalho).
   - Mudou algo fora de `src/*/admin/` que o app comum usa (inclui `extensao-crm/` e o CRM): também `npm run dist`.
   - Mudou algo que os staging usam: também `npm run dist:staging` e `npm run dist:finance-staging`.
   Use timeout de 10 min. Confira na saída "Assinado com" e "Instalado em".
   **Mudança sem efeito visível** (refatoração, mover ou renomear arquivo, só teste ou doc): empacote só a variante que
   vai ser conferida na tela (`npm run dist` para o cliente, ou `dist:admin`); as outras ficam para a última fase de
   uma série de PRs ou para quando a mudança for visível. Cada variante leva minutos e o hook de outra sessão pode
   sobrescrever o resultado logo depois. Num worktree, rode o `npm run dist…` de dentro dele (ver skill `contribuir`).
4. **Avise em pt-BR**, em poucas linhas: o que foi rebuildado, onde ficou instalado e que é só abrir o app de novo.

Não faça commit nem push por conta disso.
