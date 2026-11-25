---
name: contribuir
description: Leva uma correção do meu-bot feita neste Mac até um pull request no diegofornalha/meu-bot, direto no origin quando o gh está logado como diegofornalha, ou pelo fork box-grok/meu-bot quando a conta só lê o original. Use quando o usuário disser "manda PR", "abre um PR", "faz o fork e manda", "envia a correção", "escreve uma issue e manda PR" ou "aproveita que corrigiu e manda".
---

# Contribuir: branch → pull request

Toda mudança vai por um branch e chega no `main` por PR. De onde o branch sai depende da conta logada no `gh`:
`diegofornalha` (dona do repositório) empurra para o próprio `origin`; `box-grok` só lê o original e vai pelo fork
`box-grok/meu-bot` (remote `fork`). Publicar é público: abra o PR quando o usuário pedir **ou
quando o hook `scripts/hooks/pr-lembrete.sh` apontar, ao fim de uma resposta, commits sem PR num branch que você fez
nesta sessão** (branch de outra sessão: só avise o usuário).

## Antes

- `gh`: fica em `~/.local/bin/gh`, que pode não estar no PATH deste shell; use `export PATH="$HOME/.local/bin:$PATH"`
  no começo do comando. `gh auth status` diz a conta: `diegofornalha` → caminho **origin**; `box-grok` → caminho
  **fork**. Se não estiver logado, o usuário roda `! gh auth login -h github.com -p https -w` e depois `! gh auth setup-git`.
- Identidade dos commits, só neste repositório (não no global): `user.name cursor` (o nome da máquina) e
  `user.email box@agentesgrok.com`. Confira com `git config user.name`; se faltar, grave com `git config` sem `--global`.
- Só no caminho fork, remote `fork`: `git remote get-url fork`. Se faltar: `gh repo fork diegofornalha/meu-bot --clone=false`
  (não falha se o fork já existe) e `git remote add fork https://github.com/box-grok/meu-bot.git`.

## A sequência

1. **Testes**: `npm test` (já roda o build). Com teste quebrado, pare e mostre a falha: não mande PR.
2. **Worktree próprio, branch atualizado**: `git fetch origin` e um worktree novo com o branch a partir de `origin/main`,
   nome curto em pt-BR do que muda: `git worktree add -b <branch> ../meu-bot-<nome> origin/main`. Nunca troque de branch
   no checkout principal (outras sessões usam o mesmo diretório ao mesmo tempo) e nunca commite direto no `main`. Se a
   mudança já foi feita no checkout principal, leve-a para o worktree (`git stash` → `git -C ../meu-bot-<nome> stash pop`,
   ou `git diff | git -C ../meu-bot-<nome> apply`). Para o worktree empacotar: `ln -s` de `node_modules` e de
   `extensao-crm/node_modules` do checkout principal; cópia (não symlink: o `build:extensao` recusa) de
   `build/extensao-autenticador`; cópia de `build/suporte` (o `suporte.json` do admin, fora do git; sem ele o
   meu-bot-admin sai "sem caixa de entrada configurada"); cópia de `config/google-oauth.json` e `config/google-conta-oauth.json` (fora do git; sem
   eles o cliente sai sem Google e o `package.mjs` avisa). Rode `npm test` e `npm run dist…` de dentro do worktree.
   **Para a release automática não travar**, no mesmo PR: mudou componente da máquina (backend, CRM,
   guarda; lista em `COMPONENTES`, `src/main/maquina/backend-bundle-core.ts`) → suba a versão dele (o CI roda
   `scripts/release-checar.mjs` e recusa sem); mudança que a pessoa vê → o item dela num arquivo novo,
   `docs/changelog/<branch>.md` (formato no `docs/changelog/README.md`), em linguagem de quem usa (vira as notas da
   release). **Não escreva direto em "Ainda não lançado" do `docs/CHANGELOG.md`**: toda PR mexia nas mesmas linhas e
   cada merge deixava as outras em conflito. Se uma PR antiga ainda conflitar no CHANGELOG, mova o item dela para o
   arquivo da pasta ao juntar o `main`.
3. **Commit**: só os arquivos da mudança (`git add <arquivos>`, nada de `git add -A`, que pegaria `.env`, `out/` e afins).
   Mensagem no estilo do `git log`: `Área: o que muda` na primeira linha, em pt-BR, e um parágrafo com o porquê. Termine
   com a linha de coautoria que a conversa indicar.
4. **Push**: origin → `git push -u origin <branch>`; fork → `git push -u fork <branch>`.
5. **PR**: escreva o corpo num arquivo no scratchpad e rode
   `gh pr create -R diegofornalha/meu-bot --head <branch> --base main --title "<título>" --body-file <arquivo>`
   (no caminho fork, `--head box-grok:<branch>`). O hook `scripts/hooks/pr-lembrete.sh` reconhece a PR nos dois caminhos.
   Corpo com estas seções: **O que acontece** (o sintoma, como o usuário viu, a versão e a máquina), **Por quê** (a
   causa no código), **Correção** (arquivos e o que mudou), **Como conferir** (passos e o resultado esperado) e
   **Testes** (o que rodou e o que ainda não foi conferido na tela). Termine com a linha de atribuição que a conversa
   indicar.
6. **Issue**, só se o usuário pedir uma separada: `gh issue create -R diegofornalha/meu-bot --title … --body-file …`.
   Aí ponha `Closes #<n>` no corpo do PR.
7. **Rebuildar** (skill `rebuildar`) para o usuário ver a correção no app instalado, se ainda não foi feito.

## Ao terminar

- **Quadro** (skill `quadro`): ponha a PR no Project #6 em "Claude trabalhando"
  (`gh project item-add 6 --owner diegofornalha --url <url da PR>`). **Você não liga o auto-merge nem
  mescla na mão**: o workflow `.github/workflows/auto-merge.yml` liga o auto-merge sozinho quando a Revisão Claude
  termina (decisão do usuário em 15 nov 2026: nenhuma pessoa como gargalo), e o `main` só deixa entrar com o check
  `testes` verde e **todas as conversas da revisão resolvidas**. O que fica com você:
  - **Provar** a mudança (memória "PR só aprovada funcionando") antes de abrir a PR. O que ainda não foi provado
    abre como **rascunho** (`gh pr create --draft`) ou com o rótulo `nao-mesclar`, que seguram o auto-merge; "NÃO
    MESCLAR" no título faz o mesmo. Ao tirar o rascunho, a revisão roda e o auto-merge é ligado no fim dela.
  - **Ler os comentários** da Revisão Claude e do CodeQL, corrigir num commit novo, responder em cada um e
    **resolver a conversa**: responder não resolve, e conversa aberta segura a PR. Liste as abertas e resolva com
    `gh api graphql -f query='{repository(owner:"diegofornalha",name:"meu-bot"){pullRequest(number:<n>){reviewThreads(first:50){nodes{id isResolved comments(first:1){nodes{path body}}}}}}}'`
    e `gh api graphql -f query='mutation{resolveReviewThread(input:{threadId:"<id>"}){thread{isResolved}}}'`. Só
    resolva o que foi corrigido ou respondido com o motivo; a do CodeQL se resolve sozinha quando o alerta some.
  - **Mostrar como ficou**, sem esperar o usuário pedir (pedido dele em 25 nov 2026: "sempre que fizer uma PR e ela
    passar gostaria de ver como ficou"): PR que muda o que se vê e entrou → abra o resultado na tela dele e mande a
    captura. Mudança no app: skill `testar-no-app`, "Ver um ramo no meu-bot-staging" (fecha o app, abre o build do
    commit, `print_janela`), e volte ao da release quando ele terminar de ver. Mudança no site: o Worker local ou o
    site de staging, com a captura da página (skill `publicar-site`). PR sem nada visível: diga isso em uma linha.
  - Conferir depois (`gh pr view <n> --json state,autoMergeRequest`), mover o cartão para Arquivados e apagar o
    worktree. `node scripts/auto-merge.mjs <n> --check` mostra o que o workflow decide para a PR.
  - PR de outra sessão ou pessoa, e mudança que o usuário pediu para ver antes: ponha `nao-mesclar` e mande para
    "Esperando você" com a ação exata.

Diga em pt-BR, em poucas linhas: o link do PR, o branch, o que foi testado e o que falta conferir. Avise onde está o
worktree (`../meu-bot-<nome>`), que o checkout principal não mudou, e que ele sai com `git worktree remove ../meu-bot-<nome>`
quando a PR entrar.

## Regras

- Nunca `push --force` num branch que já tem PR aberto sem combinar com o usuário. Para corrigir, faça um commit novo.
- Correção nova vai em branch novo, não no branch de outro PR ainda aberto.
- Ramo não vai para o staging do site: ele é sempre a main (`scripts/site-publicar.mjs --so-staging` recusa o que não é
  o `origin/main`). Mudança em `conta-api/` chega lá pelo merge (o agente da release publica em até 10 min). Para ver
  o ramo antes disso, o Worker roda local: skill `publicar-site`, "Ver um ramo antes do merge".
- Não feche, não faça merge e não comente em PR ou issue de outra pessoa sem o usuário pedir.
