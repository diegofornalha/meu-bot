---
name: publicar
description: Leva uma mudança do meu-bot (app, financeiro, CRM, backend) do desenvolvimento até o usuário final pelo caminho staging → estável, com releases assinadas. Use quando o usuário disser "publica", "solta no staging", "manda pro estável", "lança a versão", "faz a release", "aprovado, pode publicar", ou perguntar como uma mudança chega aos usuários.
---

# Publicar o meu-bot (staging → estável)

Como o Brave (Sparkle) e o Cursor: o app baixa a versão nova sozinho, só instala o que a chave da release assinou e o
usuário só reinicia. Detalhes em `docs/guia/app.md`, seção "Revisão no molde do Brave/Sparkle".

## Caminho normal: automático depois do merge

O agente do launchd `scripts/release-auto.mjs` (rótulo `com.meu-bot.release-auto`, a cada 10 min, log em
`~/Library/Logs/meu-bot-release.log`) faz a sequência abaixo sozinho, no worktree fixo `../meu-bot-release`:

1. **Staging**: 10 min depois do último merge no `main` (junta merges seguidos), `npm test` + `npm run release:staging`.
   O macOS pede a chave da release no Chaveiro: é o único clique. Negou ou ninguém viu: tenta de novo em 1 h.
2. **Saúde**: o `meu-bot-staging` deste Mac (vindo da release) precisa receber a versão pelo atualizador e confirmá-la
   (`[atualização] <v> confirmada` no log; `node scripts/release-saude.mjs <v>`). Se ele estiver fechado, o agente o
   abre escondido. Se a versão voltou para a anterior, nada é promovido e o Mac avisa.
3. **Estável**: 24 h depois do staging, saudável e ainda no HEAD do `main` → `npm run release` no mesmo commit, e
   o deploy do site se `conta-api/` mudou desde a estável anterior. Merge novo no meio solta um staging novo e
   recomeça as 24 h.
4. **Base**: PR "Versão: base sobe para X" (`package.json` + "Ainda não lançado" vira a seção datada), mergeado sozinho.

- Ver a decisão da vez: `node scripts/release-auto.mjs --check`.
- Instalar o agente (e trocar os staging locais pelos da release): `node scripts/release-auto.mjs --instalar`;
  tirar: `--desinstalar`.
- O PR garante o que a release exige: o CI roda `scripts/release-checar.mjs` (componente sem versão nova falha) e avisa
  quando o app muda sem item no CHANGELOG.

O caminho manual abaixo segue valendo para emergência (agente parado, release fora de hora, chave de reserva).

## Onde publicar

As releases saem do Mac que tem o `gh` logado como **diegofornalha** (`gh auth status`; o `box-grok` recebe 403 ao
empurrar a tag) e a chave privada da release no Chaveiro (`npm run chave-release -- --testar` responde `✓ ok`). A
estável também precisa de `build/suporte/` (o admin). Sem um desses, pare e diga o que falta; não tente de outro lugar.
Publique do checkout principal só se ele estiver limpo e no `origin/main`; senão, de um worktree (abaixo).

## A sequência

1. **Desenvolver e testar localmente**: `npm test`, depois a skill `rebuildar`. Os builds locais saem com a versão do
   `package.json` sem sufixo (ex.: `0.2.0`), que conta como mais nova que qualquer `0.2.0-staging.N` publicado: a
   release nunca sobrescreve o que está em desenvolvimento.
2. **Subir a versão do que muda na máquina da pessoa** (senão as máquinas nunca recebem a mudança, porque só
   atualizam para cima; o release recusa se você esquecer):
   - backend (`server.js`, `finance-api.js`, `licenca.js`… a lista é `COMPONENTES` em `src/main/backend-bundle-core.ts`)
     → `backend-colima/VERSION`;
   - plugin do financeiro → `backend-colima/finance/package.json`; CRM → `crm/package.json`; guarda → `guarda/package.json`.
3. **Commitar tudo**: o release exige árvore limpa e `gh` logado (`gh auth status`; se expirou, o usuário roda
   `! gh auth refresh -h github.com`).
4. **`npm run release:staging`**: publica a pre-release `v<versão>-staging.N` com os apps staging (meu-bot-staging,
   meu-bot-finance-staging), cada zip com o `.sig`. Os staging instalados a partir de release atualizam calados ao fechar.
   O app das pessoas (meu-bot, meu-bot-staging: campo `instalador` em `variant-core.ts`) sai também como instalador
   `.dmg` (`scripts/dmg.mjs`, Python do sistema; o ambiente fica em `build/.venv-dmg`), que é o que o site entrega; o
   atualizador segue no `.zip` + `.sig`.
   As notas da release saem dos arquivos de `docs/changelog/` (um por PR) mais o que ainda estiver em "Ainda não
   lançado" do `docs/CHANGELOG.md` — escreva-os antes, em linguagem de quem usa; sem ela o release avisa e cai na lista de commits do GitHub, que descreve o diff e não a mudança.
5. **O usuário testa e aprova**, pelo roteiro de dez minutos em [`docs/ROTEIRO-upgrade.md`](../../../docs/ROTEIRO-upgrade.md):
   instalar a nova por cima da antiga, sem desinstalar, e conferir a versão preparada, a recusa do que não
   confere, a troca, as preferências e abas, e a volta atrás matando o processo no meio. É onde um atualizador
   quebra; nenhum teste automatizado encena a pessoa no meio da troca. Não promova sem a aprovação explícita dele.
   O checklist de antes e depois (staging no ar, `npm run release -- --conferir`, estável chegou certa) é a skill
   `aprovar-estavel`.
6. **`npm run release`** no MESMO commit (ele recusa se o HEAD não tiver a tag `-staging.N` dessa versão). Se o `main`
   andou depois do staging (merges de outras pessoas), há dois caminhos; diga qual ao usuário:
   - promover o que ele testou: `git worktree add --detach ../meu-bot-promover v<versão>-staging.N` (nunca
     `../meu-bot-release`, que é do agente automático; pause o agente antes, como na skill `aprovar-estavel`), prepare
     o worktree como na fase 2 da skill `aprovar-estavel` (`node_modules` e `extensao-crm/node_modules`, `build/` inteiro com `build/suporte`, `config/google-*.json`)
     e rode o `npm run release` de lá; os merges novos ficam para a próxima versão;
   - incluir os merges: novo `npm run release:staging` (`-staging.N+1`) e o usuário testa de novo.
   Publica
   `v<versão>` com o meu-bot e o meu-bot-admin. Os apps dos usuários baixam, verificam a assinatura e mostram
   "Reiniciar e atualizar" (ou aplicam ao fechar). Na abertura seguinte, o seletor atualiza o backend (só ocioso)
   e os plugins de cada máquina.
7. **Subir a versão base** para a próxima estável (`npm version minor --no-git-tag-version`) e, no `docs/CHANGELOG.md`,
   transformar "Ainda não lançado" na seção datada da versão publicada (`## <dia> de <mês> de <ano> · v<versão>`), com
   os itens de `docs/changelog/` no topo dela (e os arquivos apagados) e um "Ainda não lançado" novo e vazio em cima
   (o `fecharChangelog` da release automática faz isso). Vai num PR (worktree próprio, skill `contribuir`).
8. **Conferir no ar:** `curl -s https://agentesgrok.com/download/mac.json` traz a estável nova e
   `https://site-staging.agentesgrok.com/download/mac.json` o staging mais novo, até 10 min depois (cache do edge). Se a
   release veio junto com mudanças em `conta-api/`, publique o site também (skill `publicar-site`).

## Regras

- Nunca reescrever (rebase/amend/split) um commit que já tem tag de release publicada: a tag ficaria fora do
  histórico e a promoção para o estável quebraria.
- A chave privada da release fica em `~/.config/meu-bot/release-ed25519.pem` (criada por `npm run chave-release`;
  a pública está em `UPDATE_PUBLIC_KEY`, `src/main/updater-core.ts`). Nunca commitar, nunca trocar sem combinar com
  o usuário: apps instalados com a pública antiga recusariam toda atualização nova.
- Publicar é público (`diegofornalha/meu-bot`) e definitivo: confirme a versão e o canal antes de rodar.
- Ao terminar, diga em pt-BR o link da release, o que cada canal recebe e o próximo passo.

## Quando algo não chega

- App não atualizou: peça para a pessoa clicar em **Atualizar agora** (Configurações › Sobre e atualização, ou no
  menu do app), que verifica, baixa e reinicia; no staging a faixa "pronta para instalar" não aparece. Se nem assim:
  o build instalado é local (a tela diz "Build local do commit …" e o botão fica desligado; passo 1), a release não
  tem o `.sig`, ou a assinatura não confere (log `[atualização]` em `~/Library/Application Support/<app>/meu-bot.log`).
- Versão nova com defeito numa pessoa: um super admin (conta com o papel no console) abre Configurações › Sobre e
  atualização › Versões publicadas e instala a anterior; ela fica fixada até "Voltar a atualizar sozinho". Numa versão
  anterior ao seletor, a fixação dura só até fechar o app (o código velho não a conhece).
- Máquina não atualizou: a versão do componente não subiu, o backend estava ocupado (tenta na próxima sondagem) ou
  o instalador falhou (log `[backend]`/`[finance]` no mesmo arquivo).
- Versão nova não abre: depois de 3 aberturas sem ficar 30 s de pé, o app volta sozinho para a anterior.
