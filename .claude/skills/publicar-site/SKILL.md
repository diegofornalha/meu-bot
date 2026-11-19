---
name: publicar-site
description: Publica o Worker conta-api (site agentesgrok.com, login, console e API da conta) no Cloudflare, na ordem main → staging → produção (o staging sai sozinho; a produção só com o commit aprovado no staging), e confere no ar. Use quando o usuário disser "publica o site", "sobe o site", "deploy do Worker", "atualiza o site de staging", "manda o site pra produção", "aprovado o site", "qual commit está no site", quando uma PR que mexe em conta-api/ entrar no main, ou quando o site mostrar algo velho (versão, página) que o main já corrigiu.
---

# Publicar o site (Worker conta-api)

Um Worker só serve `agentesgrok.com` (site), `auth.`, `console.` e `conta.` (API); o de staging serve os mesmos com
`-staging` (`site-staging.agentesgrok.com` …). O app (`npm run release…`) é outra coisa: ver skill `publicar`.

**A regra: main → staging → produção, sempre nessa ordem e no mesmo histórico.** O que ainda vai sair fica no staging;
a produção só recebe um commit que **já está no staging** e que o **dono aprovou**. **Ramo não vai para o staging:**
ele é sempre o `origin/main`, e o script recusa qualquer outro commit (em 19 nov 2026 uma sessão publicou um ramo por
cima da main e quem conferia o staging via outra coisa). Para ver um ramo antes do merge, veja "Ver um ramo antes do
merge", abaixo.

1. **Merge no `main`** de algo em `conta-api/`.
2. **O staging recebe sozinho:** o agente da release (`scripts/release-auto.mjs`, a cada 10 min) vê que `conta-api/`
   mudou entre o commit que está no staging e o `origin/main` e roda `node scripts/site-publicar.mjs --so-staging`
   (`=== site staging ok` em `~/Library/Logs/meu-bot-release.log`; o Mac avisa). Falhou: tenta de novo em 1 h.
3. **Conferir** o staging no ar: `node scripts/site-publicar.mjs --conferir` e, na mão, o que a mudança alterou (o
   roteiro `docs/STAGING.md`, quando existir).
4. **Aprovar o commit:** `node scripts/site-publicar.mjs --aprovar <sha> [--roteiro <arquivo>]`. Só aceita o `<sha>`
   inteiro que o `/health` do staging mostra; grava sha, data e o roteiro conferido em
   `~/Library/Application Support/meu-bot-release/site-aprovado.json`. Não publica nada.
5. **Publicar a produção:** `node scripts/site-publicar.mjs --producao`, de um worktree nesse commit.

O agente **nunca** publica a produção. Quando sai uma estável nova com `conta-api/` diferente, ele só avisa "site
pronto para aprovar no staging (commit X)". **A aprovação é do dono:** rode `--aprovar` só depois do "aprovado" dele
para aquele commit, nunca por conta própria.

Cada ambiente diz o commit que tem no ar: `curl -s https://conta-staging.agentesgrok.com/health` e
`curl -s https://conta.agentesgrok.com/health` devolvem `{"ok":true,"canal":…,"commit":"<sha>"}`. `commit: null` é
"desconhecido" (publicado antes do portão ou por `wrangler deploy` à mão), não erro; só não serve para aprovar.

## Antes

- **Login no Cloudflare:** `cd conta-api && npx wrangler whoami`. Sem login, peça ao usuário para rodar no prompt
  `! cd <worktree>/conta-api && npx wrangler login` e clicar em **Allow** no navegador (conta que tem o agentesgrok.com).
- **De onde publicar:** de um worktree, nunca do checkout principal (outras sessões o usam). Para o staging, o
  worktree fica **no `origin/main`** (`git -C ../meu-bot-site-deploy fetch origin && git -C ../meu-bot-site-deploy
  checkout -q --detach origin/main`). Para a produção, fica **no commit aprovado** (o script recusa outro):
  `git fetch origin && git worktree add --detach ../meu-bot-site-deploy <sha>` (se já existe:
  `git -C ../meu-bot-site-deploy checkout -q --detach <sha>`).
- `conta-api/node_modules` não vem no worktree: o script roda `npm ci` dentro de `conta-api`.
- `conta-api/` tem de estar igual ao commit (sem mudança solta): senão o `/health` diria um commit que não é o que subiu.

## Os modos do script

`node scripts/site-publicar.mjs …`, de dentro do worktree; para no primeiro erro.

- **Sem argumento ou `--so-staging`:** antes de tudo, `git fetch origin` e a pergunta "o `HEAD` deste worktree é
  exatamente o `origin/main`?". Não é (um ramo, uma main velha), ou o fetch falhou (sem rede): recusa com saída 1, sem
  login, teste nem deploy, e diz o caminho (abrir a PR, mesclar, o staging recebe sozinho). Passando: `wrangler whoami`, `npm ci` e `npm test` em `conta-api`, migrações
  (`npm run migrar:staging`), deploy do staging com o commit (`wrangler deploy --env staging --var COMMIT:<sha>`) e a
  conferência no ar. Termina dizendo os dois comandos da aprovação. **Não publica a produção.**
- **`--aprovar <sha> [--roteiro <arquivo>]`:** recusa se o staging não está exatamente nesse commit (e diz qual está).
- **`--producao`:** recusa, sem publicar, se não há aprovação, se o commit aprovado não é o `HEAD` do worktree, se o
  staging não está mais nesse commit (a main andou e o agente publicou outro: confira e aprove o novo), se `conta-api/`
  tem mudança solta ou se o commit não está no `origin/main`. Passando: testes, migrações (`npm run migrar`), deploy e
  conferência; o `/health` da produção tem de passar a mostrar o commit.
- **`--conferir`:** só lê os dois ambientes. Mostra o commit de cada um, se a produção é um ancestral do staging
  (`git merge-base --is-ancestor`; avisa quando não é) e as diferenças de conteúdo com `⚠`. Não desfaz nada e só sai
  com 1 se o básico falhar.

**O que a conferência olha:** `/health` com `{"ok":true,"canal":"<ambiente>"}`; `/download/mac.json` com versão, nome e
url (na produção, versão **estável**); `/` e `/obrigado` com 200 (na produção também `robots.txt`, `sitemap.xml` e
`llms.txt`); a home citando o teste grátis com os dias do `TRIAL_DIAS` daquele ambiente; o `/config.js` do site com o
`canal` e a medição (`GA_ID`) daquele ambiente; e, depois de um deploy, o `commit` do `/health`.

**Conferência que falha depois do deploy desfaz o deploy** daquele ambiente (`wrangler rollback`) e o script sai com 1:
mostre as linhas `✗` ao usuário. Sem resposta do site (rede deste Mac, GitHub fora) nada é desfeito.

O staging fica fora dos buscadores pelo cabeçalho `x-robots-tag: noindex, nofollow`; o `robots.txt` é o mesmo da
produção. Confira também, à mão, o que a mudança da vez alterou (a página nova, o texto novo): o script só garante o
básico.

## Ver um ramo antes do merge

O staging não serve para isso (`--so-staging` recusa o ramo). O Worker do ramo roda **neste Mac**, sem publicar nada e
sem login no Cloudflare, de dentro de `conta-api` no worktree do ramo (com `node_modules`: `npm ci`, ou o symlink do
checkout principal):

```bash
npx wrangler dev --env staging --host site-staging.agentesgrok.com --upstream-protocol https \
  --persist-to "${TMPDIR:-/tmp}/meu-bot-wrangler-dev"
# abre em http://localhost:8787 (outra porta: --port <n>)
```

- **As duas flags são obrigatórias.** O Worker escolhe o que servir pelo host e manda para https tudo o que chega por
  http (`redirecionamentoInicial`, `conta-api/src/site-core.ts`). Sem `--upstream-protocol https`, toda rota responde
  301 (para o próprio endereço, num laço); sem `--host`, o host é o da primeira rota do `wrangler.toml`, a API
  (`conta-staging…`), e a home dá 404.
- **Um host por vez.** `--host site-staging.agentesgrok.com` serve o site (home, `/baixar`, `/obrigado`, `/config.js`
  com `canal: "staging"`, o `x-robots-tag`); `--host console-staging.agentesgrok.com` serve as páginas do console;
  `--host auth-staging.agentesgrok.com`, as do login (a raiz dele redireciona para o console de verdade); sem `--host`,
  a API (`/health` responde com `commit: null`). Conferido com o wrangler 4.158.0, o do `package-lock.json`.
- **Limites.** O banco é um D1 local e vazio e os secrets não existem aqui: serve para ver página, texto, estilo e
  rota, não login, pagamento nem dados. As páginas apontam para os endereços de verdade do staging (`/config.js`): um
  clique em "entrar" sai do Mac e cai no staging no ar, que está na main, não no ramo. `/promocao` deu 404 aqui (ela só existe com a
  promoção e os pagamentos ligados).
- **`--persist-to` fora do repositório:** sem ele o wrangler grava o estado em `conta-api/.wrangler/`.

Commit de ramo nunca chega à produção (o `--producao` recusa o que não está no `origin/main`).

## Ao terminar

Diga em pt-BR, em poucas linhas: o ambiente publicado, o commit (o do `/health`), o Version ID e o que foi conferido no
ar. Depois de publicar o staging, diga que a produção espera o "aprovado" e mostre os dois comandos.

## Regras

- O download do site lê o GitHub com cache de 10 min no edge: release nova aparece sozinha, sem deploy.
- Nunca `npx wrangler deploy` à mão (o `npm run deploy` do `conta-api` recusa): sobe sem o commit e fura a ordem.
- Ramo não vai para o staging, nem "só para mostrar": abra a PR, mescle, e o staging recebe a main.
- Rollback: `npx wrangler rollback [--env staging]` volta ao deploy anterior; use se a conferência falhar e avise.
- Paridade: as vars dos dois ambientes no `wrangler.toml` têm de ser iguais, fora as exceções escritas com motivo (e as
  temporárias, com validade) em `conta-api/tests/paridade-ambientes.test.mjs`. O teste roda no `npm test` do
  `conta-api`, antes de todo deploy.
- Não mexa em secrets (`wrangler secret put`) nem em vars do `wrangler.toml` sem o usuário pedir (README do conta-api).
