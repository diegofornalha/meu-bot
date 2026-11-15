---
name: publicar-site
description: Publica o Worker conta-api (site agentesgrok.com, login, console e API da conta) no Cloudflare, em staging ou produção, e confere no ar. Use quando o usuário disser "publica o site", "sobe o site", "deploy do Worker", "atualiza o site de staging", "manda o site pra produção", quando uma PR que mexe em conta-api/ entrar no main, ou quando o site mostrar algo velho (versão, página) que o main já corrigiu.
---

# Publicar o site (Worker conta-api)

Um Worker só serve `agentesgrok.com` (site), `auth.`, `console.` e `conta.` (API); o de staging serve os mesmos com
`-staging` (`site-staging.agentesgrok.com` …). Merge no `main` **não publica** na hora: o site acompanha a
estável. A cada estável nova com `conta-api/` diferente, o agente da release publica sozinho
(`scripts/site-publicar.mjs`; `=== site ok` em `~/Library/Logs/meu-bot-release.log`). Use esta skill para publicar
antes disso (mudança só de site que não deve esperar a estável) ou para mostrar um branch no staging. O app
(`npm run release…`) é outra coisa: ver skill `publicar`.

## Antes

- **Login no Cloudflare:** `cd conta-api && npx wrangler whoami`. Sem login, peça ao usuário para rodar no prompt
  `! cd <worktree>/conta-api && npx wrangler login` e clicar em **Allow** no navegador (conta que tem o agentesgrok.com).
- **De onde publicar:** de um worktree no `origin/main` atual, nunca do checkout principal (outras sessões o usam) e
  nunca de um branch para produção:
  `git fetch origin && git worktree add --detach ../meu-bot-site-deploy origin/main` (se já existe:
  `git -C ../meu-bot-site-deploy checkout -q --detach origin/main`). Para mostrar um branch no **staging** antes do
  merge, publique de dentro do worktree do branch e avise que o próximo deploy do `main` passa por cima.
- `conta-api/node_modules` não vem no worktree: `npm ci` dentro de `conta-api` (symlink não serve: o checkout principal
  costuma não ter).

## A sequência

De dentro do worktree no `origin/main`: `node scripts/site-publicar.mjs`. Ele faz tudo e para no primeiro erro:

1. **Login e testes:** `wrangler whoami`, `npm ci` e `npm test` em `conta-api`.
2. **Staging:** migrações (`npm run migrar:staging`), `npm run deploy:staging` e a conferência no ar: `/health` com
   `{"ok":true,"canal":"staging"}`, `/download/mac.json` com versão, nome e url, `/` e `/obrigado` com 200.
3. **Produção**, sem esperar "pode" (decisão do usuário em 15 nov 2026: nenhuma pessoa como gargalo): migrações
   (`npm run migrar`), `npm run deploy` e a conferência: `/health` com `"canal":"producao"`, `/download/mac.json` com
   uma versão **estável**, `/`, `/obrigado`, `robots.txt`, `sitemap.xml` e `llms.txt` com 200.
4. **Conferência que falha desfaz o deploy** daquele ambiente (`wrangler rollback`) e o script sai com 1: mostre as
   linhas `✗` ao usuário.

`--so-staging` para depois do passo 2 (branch em revisão); `--conferir` só confere os dois ambientes no ar. O staging
fica fora dos buscadores pelo cabeçalho `x-robots-tag: noindex, nofollow`; o `robots.txt` é o mesmo da produção.
Confira também, à mão, o que a mudança da vez alterou (a página nova, o texto novo): o script só garante o básico.

## Ao terminar

Diga em pt-BR, em poucas linhas: o ambiente publicado, o commit (`git -C ../meu-bot-site-deploy log -1 --oneline`), o
Version ID e o que foi conferido no ar. Se publicou de um branch, lembre que o merge precisa de outro deploy.

## Regras

- O download do site lê o GitHub com cache de 10 min no edge: release nova aparece sozinha, sem deploy.
- Rollback: `npx wrangler rollback [--env staging]` volta ao deploy anterior; use se a conferência falhar e avise.
- Não mexa em secrets (`wrangler secret put`) nem em vars do `wrangler.toml` sem o usuário pedir (README do conta-api).
