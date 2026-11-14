# conta-api

Um Worker só para a conta meu-bot: a API (`conta.agentesgrok.com`), a página de login (`auth.agentesgrok.com`) e o
console da conta (`console.agentesgrok.com/account/…`). O `wrangler.toml` descreve os dois ambientes (produção e
`--env staging`), os secrets e as vars; os comandos estão no `package.json` (`npm test`, `npm run dev`, `migrar`,
`deploy`).

## Chave Web do Firebase (projeto `meu-bot-conta`)

A chave em `FIREBASE_API_KEY` (a "Browser key (auto created by Firebase)" do Google Cloud) é **pública por desenho**:
ela vai para o navegador em `/config.js` e a página de login a usa para falar com o Firebase Auth. O que a protege
não é o segredo, e sim a restrição no Google Cloud (APIs e serviços › Credenciais), aplicada em 7 nov 2026:

- **Referers aceitos:** `auth.agentesgrok.com`, `auth-staging.agentesgrok.com`, `meu-bot-conta.firebaseapp.com`,
  `meu-bot-conta.web.app` e `localhost`.
- **APIs aceitas:** só Identity Toolkit e Token Service (antes aceitava 27 APIs de qualquer origem).

Com isso, a chave sem referer ou com referer de outro site recebe 403; da página de login, 200. O app desktop nunca
chama o Firebase: o login acontece na página do navegador e volta ao app por deep link, então a restrição não muda
nada do fluxo da conta.

O que isso exige de quem mexer aqui:

- **Domínio de login novo** (outra variante, outro ambiente): acrescente o referer na restrição *antes* de publicar;
  sem ele, a página abre, mas o login responde 403.
- **Chave recriada ou "renovada" no console do Firebase:** ela nasce sem restrição; aplique a mesma lista de novo e
  troque o valor nas vars dos dois ambientes.
- **Alerta de "secret exposto" do GitHub apontando para esta chave:** é falso positivo (chave Web, restrita); feche
  com essa justificativa, como foi feito no fork `box-grok/meu-bot`.
- Se o Google recusar a mudança alegando "uso de outra API nos últimos 7 dias", confira se foi um teste seu (um
  `curl` de geocoding, por exemplo) e aplique com o override.
- **O Worker também usa a chave**, em `POST /conta/senha` (`accounts:sendOobCode`, o e-mail de criar/redefinir senha):
  como a restrição é por referer, esse `fetch` manda `Referer: https://<FIREBASE_AUTH_DOMAIN>/`. Se a lista de referers
  mudar, esse host precisa continuar nela.
- **Senha** (console › Perfil › Login e segurança › "Criar senha") exige o provedor **E-mail/senha** ativado em
  Authentication › Sign-in method do projeto; sem ele o Firebase responde `OPERATION_NOT_ALLOWED` e o console avisa.
- **O super admin define a senha de alguém** (console › Plano › Mudar › Senha) pela conta de serviço do projeto
  (`firebase-adminsdk-fbsvc@meu-bot-conta.iam.gserviceaccount.com`): o JSON da chave fica no secret
  `FIREBASE_ADMIN_SA` (staging e produção), nunca no repositório. A organização agentesgrok.com proíbe criar chaves
  de conta de serviço; no projeto `meu-bot-conta` as duas restrições (`iam.disableServiceAccountKeyCreation` e
  `iam.managed.disableServiceAccountKeyCreation`) foram sobrescritas para "não aplicada" em 7 nov 2026, só para
  esse projeto. Para trocar a chave: IAM › Contas de serviço › firebase-adminsdk › Chaves › Adicionar chave (JSON),
  `wrangler secret put FIREBASE_ADMIN_SA [--env staging] < arquivo.json`, apagar o arquivo e a chave antiga.

## Organizações (molde Rambox Enterprise)

`console.agentesgrok.com/organizations/<slug>/members` e `/settings`. Qualquer conta cria uma organização (`POST /orgs`
`{nome, slug}`) e vira a **dona**; convida por e-mail (`POST /orgs/:slug/membros` `{email, papel: admin|membro}`). Não há
envio de e-mail: o convite é o e-mail cadastrado, e o console dá o link para a pessoa; quando aquele e-mail entra (Google
ou link por e-mail), `aceitarConvites` no `POST /sessao` liga a conta e o membro vira ativo. Papéis: dona (tudo, inclusive
apagar e promover), admin (convida, remove e muda entre admin↔membro), membro (vê). A organização precisa de pelo menos
uma dona; uma dona não apaga a própria conta (`DELETE /conta` → 403) sem passar o bastão. **Assentos** (ativos +
convidados) começam em 5 e só o super admin muda (`PATCH /admin/orgs/:slug` `{assentos}`); `dominio_email` restringe os
convites a um domínio. Quem não é membro recebe 404 em tudo (a organização não existe para quem está fora); o super admin
vê todas (`GET /admin/visao` → `orgs`; console › Todas as organizações). Slugs seguem `SLUG_RE` e a lista
`SLUGS_RESERVADOS` (hosts nossos, `www`, `api`…), porque na próxima versão `<slug>.agentesgrok.com` abre o console da
organização (`slugDoHost` já existe; falta o registro `*` no DNS e a rota curinga). Apagar é soft delete: o slug vira
`apagada:<id>:<slug>` e continua reservado. Depois: times com permissões por área, login com a cara da empresa, plano
Enterprise com assentos cobrados.

## Analytics (Google Analytics 4 no site, na página de login e no console)

`GA_ID` (`wrangler.toml`, por ambiente) é o ID de métricas do fluxo Web (`G-…`). Uma propriedade por ambiente:
produção = **meu-bot-conta** (`G-12CJ787RGJ`, criada pelo Firebase, conta box@agentesgrok.com); staging =
**agentesintegrados** (`G-FCKW62SB1K`, de diegofornalha, fluxo "agentesgrok-site-staging"). Vazio desliga tudo. A var
aceita vários IDs separados por vírgula, mas dois containers do Google na mesma página duplicam o `page_view` (o segundo
ignora `send_page_view: false`): deixe um por ambiente. O Worker põe a lista no `/config.js` de cada host
(`ga`) e libera na CSP de cada host os domínios da tag (`googletagmanager.com`, `google-analytics.com`,
`analytics.google.com`) **só** quando há ID (`src/analytics-core.ts`). No site, a CSP libera também a medição de
conversão do Google Ads (`CSP_ADS`: `/ccm/` e o cookie de atribuição) e continua bloqueando os envios de remarketing. As páginas carregam `public/analytics.js` logo
depois de `/config.js`; ele expõe `window.meuBotGa = { pagina, evento }` e, sem ID, as duas funções não fazem nada.

Regras: `send_page_view: false` em todo `config` e `page_view` à mão com `page_location = origem + caminho` (sem query
nem fragmento: o console recebe `#code&verifier`, o login tem `?state&challenge`); o caminho de uma organização vai
anonimizado (`/organizations/_/members`); nenhum parâmetro leva e-mail, nome, slug, código, token ou id de conta; sem
sinais de anúncios (`allow_google_signals: false`); todo evento leva `ambiente` (`staging` | `producao`) e, em staging,
o `config` tem `debug_mode` (os eventos aparecem no DebugView do Analytics na hora). O evento sai sempre **antes** da
linha que navega (deep link, `location.replace` para o console, redirecionamento do download). Não há aviso de cookies
nesta versão: o rodapé do site diz que medimos visitas sem anúncios e sem dados pessoais.

| Página | Evento | Parâmetros (listas fechadas) |
|---|---|---|
| site | `page_view` | `page_location` limpo |
| site | `baixar_mac` | `origem`: qual botão levou à /obrigado (`hero`, `teste`, `final`, `fixo`, `baixar`, `perguntas`, `grok-whatsapp-topo`…; staging: `beta`). Não é evento principal: o download é o `download_iniciado` |
| site | `plano_interesse` | `plano`: `chip-coflow` (R$ 97/mês), `proprio-chip` (cotação); os botões levam ao console da conta |
| site | `link_celular` | `via`: `whatsapp`, `email` (no celular e no Windows, o download vira "mandar o link para o meu Mac") |
| site | `download_iniciado` | `versao` (da release) |
| site | `download_repetido` | `versao`: clique em "use este link" na /obrigado (não conta como conversão) |
| login | `page_view` | `tipo`: `app`, `console`, `sem-app`, `org-pergunta`, `org-nao-achada`, `org-redirect` |
| login | `login_iniciado`, `login_concluido` | `metodo`: `google`, `lembrado`, `senha`, `link`; `destino`: `app`, `console`; `org: true` na página da organização |
| login | `login_falhou` | `motivo`: `popup-fechado`, `google`, `senha`, `muitas-tentativas`, `sem-conta`, `link-invalido`, `api`, `sessao-vencida`, `outro`; `metodo`; `destino` |
| login | `link_enviado`, `senha_recuperar` | `destino` |
| login | `app_aberto` | `repeticao`: `false` (automático), `true` (botão "Abrir o meu-bot") |
| login | `sem_app_visto` | `acao`: `visto`, `baixar`, `console`, `signup` |
| login | `login_org_visto`, `login_org_perguntado` | `com_slug`, `achada` |
| cadastro | `cadastro_iniciado`, `cadastro_concluido`, `cadastro_falhou` | `cadastro_concluido` sai no /signup e também no login, quando a conta Firebase nasce ali (`via: login`, `metodo`: `google`, `link`); `metodo`: `senha`, `google`; `motivo`: `senha-curta`, `email-em-uso`, `senha-fraca`, `email-invalido`, `popup-fechado`, `google`, `outro` |
| console | `checkout_iniciado` | `plano`: `chip-coflow` (clique em "Assinar", antes de ir à AbacatePay) |
| servidor | `purchase`, `assinatura_renovada` | Measurement Protocol, no client_id/session_id do console guardado no checkout: `transaction_id` (id do pagamento), `value`, `currency: BRL`, `items`. `purchase` só na primeira cobrança (é o que o Google Ads importa); renovações vão como `assinatura_renovada` |
| console | `page_view` | `secao` (`overview`, `plan`, `org`, `entrada`…), caminho anonimizado |
| console | `console_entrada`, `console_saida` | `via`: `app`, `login`; `admin` |
| console | `org_criada`, `org_apagada`, `convite_enviado`, `membro_removido` | `papel`, `status`, `eu` |
| console | `plano_alterado`, `perfil_salvo`, `dados_uso_alterado`, `senha_pedida`, `conta_apagada` | `plan`, `status`, `ligado` |
| todas | `click`, `scroll`, `file_download`, `form_start`, `form_submit` | medição otimizada do GA4 (automática) |

Campanha: o `page_location` leva só as chaves de `CHAVES_CAMPANHA` (`src/analytics-core.ts`: `utm_*`, `gclid`, `gbraid`,
`wbraid`); o resto da query e o fragmento nunca vão. Assim o clique de um anúncio chega ao GA4 com a campanha.

O que o Analytics não faz sozinho, na propriedade (Administrador): eventos principais (`download_iniciado`,
`login_concluido`, `cadastro_concluido`, `org_criada`, depois de aparecerem na lista de eventos; `baixar_mac` não);
dimensões personalizadas de evento para cada parâmetro acima (senão não aparecem nos relatórios); retenção de dados em
14 meses; sinais do Google desligados; encobrir dados com as chaves `code, state, verifier, challenge, retorno, oobCode,
apiKey`; referências indesejadas `accounts.google.com`, `*.firebaseapp.com`; URL do fluxo (`https://agentesgrok.com` na de
produção, `https://site-staging.agentesgrok.com` na de staging); fuso horário de Brasília e moeda BRL. Conferir cada
evento em staging pelo DebugView antes de publicar em produção; a mesma configuração vale nas duas propriedades.

Feito em 9 nov 2026 nas duas propriedades, pelo Navegador do meu-bot: fuso (São Paulo) e moeda, URL do fluxo, medição
otimizada ligada **sem** "alterações de página por histórico do navegador" (o console mede as seções à mão; ligada, a tag
mandaria um page_view duplicado a cada pushState), sinais do Google desligados, retenção de 14 meses, encobrir dados
com as 7 chaves, e as 20 dimensões personalizadas de evento. As **referências indesejadas** (`accounts.google.com`,
`*.firebaseapp.com`) ficam no código: o `analytics.js` manda `ignore_referrer` e não manda `page_referrer` quando a
visita volta do login (`HOSTS_LOGIN`, `veioDoLogin` em `src/analytics-core.ts`), porque a tela do GA4 abre fora do
Navegador. Ficaram à mão, no Analytics, os **eventos principais** (Administrador › Eventos › estrela em
`download_iniciado`, `login_concluido`, `cadastro_concluido`, `org_criada`, sem `baixar_mac` desde 12 nov, que só aparecem na lista até
24 h depois do primeiro disparo).

**page_view duplicado em produção.** A tag da propriedade meu-bot-conta manda um `page_view` automático com a URL real
a cada carregamento, ignorando `send_page_view: false`, o `set` de `page_location` e a troca da URL durante o
carregamento (testado em staging apontado para ela; a de staging não faz isso). O nosso `page_view` leva `manual: true`,
e na propriedade existe a regra Administrador › Fluxo › Modificar eventos "page_view automático da tag vira
page_view_tag" (`event_name` igual a `page_view` e `manual` não é igual a `true` → `event_name = page_view_tag`), que
tira o automático da métrica de visualizações. O fragmento (`#code&verifier`) nunca vai no pedido; as chaves da query
são encobertas. Se um dia a tag passar a respeitar o `send_page_view`, a regra simplesmente deixa de casar.

## Assinatura do Pro (AbacatePay)

O console › Plano mostra "Assinar por R$ 97/mês" quando o Worker tem `ABACATEPAY_KEY`, `ABACATEPAY_WEBHOOK_SECRET` e
`ABACATEPAY_PRODUTO`. O fluxo (código em `src/rotas/pagamentos.ts`, regras testadas em `src/pagamento-core.ts`):

1. `POST /conta/assinatura` cria um checkout de assinatura na AbacatePay com `externalId = mb_<uuid>` e guarda, em
   `pagamento_checkouts`, a conta e o client_id/session_id do GA4. Devolve a `url`; o console vai para lá.
2. A AbacatePay chama `POST /pagamentos/abacatepay` (webhook v2). O Worker confere o secret (`X-Webhook-Secret`) e a
   assinatura HMAC-SHA256 do corpo bruto (`X-Webhook-Signature`), grava o `id` do evento em `webhook_eventos` (repetido
   = 200 sem processar) e decide:
   - `subscription.completed` / `subscription.renewed` pagos e com valor ≥ `ABACATEPAY_PRECO_CENTAVOS`: Pro ativo, mensal,
     até um mês de calendário + 3 dias (nunca encurta). Cada pagamento entra uma vez em `pagamentos`. A compra vai ao
     GA4 se houver `GA_MP_SECRET` e client_id.
   - `checkout.completed` é ignorado (é o mesmo pagamento da assinatura).
   - `subscription.cancelled`: a assinatura vira `CANCELLED`; o Pro segue até o fim do mês pago.
   - Reembolso, disputa, valor abaixo do preço ou externalId estranho: pedido `pagamento.revisar` para o admin
     (console › Suporte). Ninguém perde o Pro automaticamente.
   - Produção ignora eventos do Modo Teste (`devMode: true`), e o staging ignora eventos reais.

Ligar num ambiente (o staging usa a loja no Modo Teste):

```bash
npx wrangler d1 migrations apply conta-staging --env staging --remote   # 0006_pagamentos.sql
npx wrangler secret put ABACATEPAY_KEY --env staging                     # chave com SUBSCRIPTION:CREATE
npx wrangler secret put ABACATEPAY_WEBHOOK_SECRET --env staging          # o mesmo secret do webhook no dashboard
npx wrangler secret put GA_MP_SECRET --env staging                       # GA4 › fluxo Web › Measurement Protocol
```

No dashboard da AbacatePay: produto de assinatura mensal (o `prod_...` vai em `ABACATEPAY_PRODUTO`, `wrangler.toml`) e
um webhook v2 para `https://conta[-staging].agentesgrok.com/pagamentos/abacatepay` com os eventos
`subscription.completed`, `subscription.renewed`, `subscription.cancelled`, `subscription.payment_failed`,
`checkout.refunded`, `checkout.disputed` e `checkout.lost`.
