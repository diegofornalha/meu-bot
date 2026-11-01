# meu-bot

- Os apps instalados em `~/Applications` são sempre o `origin/main` de agora: o hook `Stop` `scripts/hooks/rebuild-auto.sh` os reempacota (de um worktree fixo, `../meu-bot-build-main`) quando o `main` do GitHub muda. Mudança num branch ganha só `npm test` pelo hook; para vê-la na tela antes do merge, empacote à mão (`npm run dist…` de dentro do worktree, skill `rebuildar`) e lembre que o próximo merge no `main` reinstala por cima.
- Mudança que vai virar PR nasce num worktree próprio (`git worktree add -b <branch> ../meu-bot-<nome> origin/main`), nunca trocando de branch neste checkout: outras sessões (Claude, Cursor) usam este diretório ao mesmo tempo. A skill `contribuir` diz como preparar o worktree para empacotar.
- Antes de conferir uma mudança na tela, confirme que o app instalado é o seu build: `grep -a -c <símbolo novo> ~/Applications/<app>.app/Contents/Resources/app.asar`. O hook de rebuild de outra sessão pode ter reinstalado a partir de outro branch.
- Trabalho commitado num branch sem PR: o hook `Stop` `scripts/hooks/pr-lembrete.sh` avisa ao fim da resposta; se o branch é seu, abra a PR pela skill `contribuir` sem esperar o usuário pedir.
