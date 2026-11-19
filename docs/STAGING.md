# Roteiro de conferência do staging

**A regra: main → staging → produção, sempre nessa ordem e no mesmo histórico.** A produção só recebe o commit que
está no staging e que o dono aprovou, depois deste roteiro:

```sh
node scripts/site-publicar.mjs --conferir                            # o commit de cada ambiente e o básico no ar
node scripts/site-publicar.mjs --aprovar <sha> --roteiro <arquivo>   # <arquivo> = o "Registro da conferência" preenchido
node scripts/site-publicar.mjs --producao                            # de um worktree no commit aprovado
```

O `--conferir` só garante o básico (`/health`, download, páginas com 200, os dias do teste na home, a medição de cada
ambiente). O resto é este roteiro, feito na mão, no staging: `site-staging.`, `auth-staging.`, `console-staging.` e
`conta-staging.agentesgrok.com`. Como publicar está na skill `publicar-site`.

**Como ler.** Uma linha por fluxo: o que fazer, onde, e o que tem de aparecer. Os textos entre aspas são os da tela,
copiados do código no commit em que este arquivo foi escrito; se a tela mudou de propósito, corrija a linha na mesma
PR. Os valores vêm do `[env.staging.vars]` de `conta-api/wrangler.toml`: hoje `TRIAL_DIAS = 3`, `PROMO_DIAS = 3`,
`PROMO_CUPOM = PRIMEIROMES1`, `PROMO_PRECO_CENTAVOS = 100` (R$ 1), Pro a R$ 97, add-ons a R$ 997.

**Não precisa conferir tudo sempre.** Confira as seções que a mudança toca e anote as outras em "itens não
conferidos", com o motivo. O que está marcado **Ainda não verificado** nunca foi visto acontecer por ninguém: a linha
diz o que o código faz, não o que foi observado. A lista completa está no fim.

## Contas de teste

Os fluxos pedem contas em quatro estados. `scripts/staging-contas.mjs` põe cada uma no estado dela pela API de admin
do staging (`PATCH /admin/contas/:id/licenca`), sem escrever no banco:

| Estado | E-mail (para `--base voce@gmail.com`) | Como fica |
|---|---|---|
| `teste` | `voce+mb-staging-teste@gmail.com` | teste grátis em vigor, acaba daqui a `TRIAL_DIAS` dias |
| `teste-vencido` | `voce+mb-staging-teste-vencido@gmail.com` | teste acabou ontem: é quem vê a promoção do primeiro mês |
| `promo-vencida` | `voce+mb-staging-promo-vencida@gmail.com` | teste acabou há `PROMO_DIAS` + 1 dias: a promoção já não vale |
| `pro-pago` | `voce+mb-staging-pro-pago@gmail.com` | Pro ativo por 30 dias, liberado pelo admin, **sem assinatura** |

```sh
MEU_BOT_STAGING_ADMIN_TOKEN=… node scripts/staging-contas.mjs --api https://conta-staging.agentesgrok.com --base voce@gmail.com --listar
MEU_BOT_STAGING_ADMIN_TOKEN=… node scripts/staging-contas.mjs --api https://conta-staging.agentesgrok.com --base voce@gmail.com --aplicar
```

O script recusa qualquer endereço que não seja `https://conta-staging.agentesgrok.com`, recusa se o `/health` não
disser `canal: "staging"`, só toca contas com exatamente esses e-mails e nunca uma conta com perfil de acesso.

**O que é passo seu (o script não faz nem contorna):**

1. **Criar as contas, uma vez.** Conta nasce no primeiro login. Para cada um dos quatro e-mails, abra
   `https://console-staging.agentesgrok.com`, toque em Entrar, digite o e-mail sem senha e abra o link que chega na
   sua caixa (o Gmail entrega `voce+qualquer-coisa@` para `voce@`). Conta que não existe aparece como "falta".
2. **O token de admin.** Entre no console do staging com uma conta que tem perfil de acesso. O token fica no
   `localStorage` do navegador, chave `meu-bot-console-sessao`, campo `acesso`, e vale 1 hora. Vai na variável
   `MEU_BOT_STAGING_ADMIN_TOKEN`, nunca num argumento, num chat ou num commit.

**Limites, para não tirar conclusão errada:**

- `pro-pago` é Pro liberado pelo admin. Não cria assinatura: "Suas assinaturas" fica vazia e o painel "Assinar o Pro"
  não aparece (volta nos últimos 7 dias do prazo, com o aviso "Você já tem o Pro até …, sem assinatura ativa"); no
  topo da Visão geral entra o painel "Some mais à sua conta", com o botão "Ver o Marketplace". Assinatura de verdade só pagando no
  Modo Teste (seção 4).
- O script não apaga pagamentos. Conta que já pagou o Pro uma vez não volta a ver a promoção, mesmo em
  `teste-vencido` (`jaPagouPro`). Para repetir a promoção na mesma conta, o super admin remove a assinatura (console
  › Assinaturas › Remover) e depois zera a Auditoria (só existe no staging). **Ainda não verificado:** essa sequência
  sai da leitura do código (`removerAssinatura`, `zerarAuditoria`); ninguém a rodou para este fim. O caminho certo de
  errar é usar outro e-mail-base.
- `teste-vencido` deixa de ser `teste-vencido` sozinho quando passam os `PROMO_DIAS`: rode `--aplicar` no dia da
  conferência.
- `conta-api/scripts/conta-teste-staging.mjs` (contas `promo-teste-…@example.com` gravadas direto no D1) continua
  existindo, mas essas contas não entram pelo login: não servem para os fluxos de tela daqui.

## 1. Site no computador e no celular

No celular de verdade ou no modo de dispositivo do navegador (o site decide pelo `userAgent`; iPad conta como celular).

| O que fazer | Onde | Resultado esperado |
|---|---|---|
| Abrir a home num Mac | `site-staging.agentesgrok.com` | Faixa "Staging: o mesmo site da produção, em conferência. O site de produção é agentesgrok.com." (só na home), selo "staging" ao lado da marca e título com " · staging" (em todas as páginas do site). Fora isso, planos, preços, botões e respostas são os da produção: o HTML servido é o mesmo. Botão do topo "Testar grátis por 3 dias"; a página fala em "3 dias" em todo lugar (o número é o `TRIAL_DIAS`) e nunca em 14. |
| Tocar em "Testar grátis por 3 dias" | home, Mac | Vai para `/obrigado` e, em menos de 1 segundo, o download começa sozinho. A linha da versão mostra a release de **staging** (na produção, a estável). |
| Abrir a home no celular | home | O botão de baixar some. Aparece o cartão "Você está no celular" com "Falar com a gente no WhatsApp", "Mandar o link para o meu Mac" e "Mandar por e-mail". O botão fixo do rodapé vira "Falar no WhatsApp". O botão flutuante do WhatsApp some. |
| Abrir a home no Windows | home | Cartão da lista de espera: "Avise-me quando sair para Windows", campo de e-mail ou WhatsApp, e "Tenho um Mac: mandar o link para mim". Nenhum botão de baixar o app do Mac. |
| Chegar de um anúncio, no celular | `site-staging.agentesgrok.com/?utm_source=google&utm_medium=cpc&utm_campaign=teste&utm_content=empresario&gclid=abc` | "Mandar o link para o meu Mac" abre o WhatsApp com "Baixar o meu-bot no Mac: https://site-staging.agentesgrok.com/?utm_source=google&utm_medium=cpc&utm_campaign=teste&utm_content=empresario-celular": a campanha segue, o `utm_content` ganha "-celular" e o `gclid` não vai. |
| Mesma visita, tocar em "Falar com a gente no WhatsApp" | home, celular | A mensagem pronta termina com "(ref: empresario · cód: ABC234)", com o código da visita (seis letras e números, o mesmo depois de recarregar a página). Sem `utm_content`, a referência é a campanha: "(ref: teste · cód: …)". No clique, a aba Rede mostra `POST /lead-ref` com resposta 200. |
| Sem campanha, no celular | home sem query | O link para o Mac é `https://site-staging.agentesgrok.com/?utm_source=celular` (a origem do site em que você está; na produção, `https://agentesgrok.com/…`), e a mensagem do WhatsApp termina só com "(cód: …)", sem "ref". |
| Marketplace público | `site-staging.agentesgrok.com/marketplace` | Grade com um cartão por item à venda no ambiente (no staging: Pro, Finanças, Módulos do Diego e os extras), cada um com o preço do catálogo; o Pro mostra "De R$ 997 por R$ 97 por mês". O cartão inteiro ("Saber mais") abre `/marketplace/<slug>`, com "Contratar pelo console", que leva ao console do staging. `/marketplace/nao-existe` dá a página 404. No staging a resposta traz `x-robots-tag: noindex`; na produção, não, e só aparecem os itens que a produção vende. |
| Abrir `/promocao` | site | Página "Primeiro mês do Pro por R$ 1" com as regras (existe porque a promoção está ligada). Fora do menu e do sitemap. |
| Ver um ramo antes do merge | neste Mac, não no staging | O staging é sempre a `origin/main`: `node scripts/site-publicar.mjs --so-staging` recusa qualquer outro commit (saída 1, sem deploy) e diz o caminho (abrir a PR, mesclar, o staging recebe sozinho). O ramo se vê no Worker local, de dentro de `conta-api` no worktree do ramo, com o comando abaixo da tabela; abre em `http://localhost:8787`. Serve para página, texto, estilo e rota; não para login, pagamento nem dados (banco local vazio, sem secrets). |

O Worker local do ramo (copiado da skill `publicar-site`, seção "Ver um ramo antes do merge", que explica as duas
flags obrigatórias e os limites):

```bash
npx wrangler dev --env staging --host site-staging.agentesgrok.com --upstream-protocol https \
  --persist-to "${TMPDIR:-/tmp}/meu-bot-wrangler-dev"
# abre em http://localhost:8787 (outra porta: --port <n>)
```

Dois cuidados: o link "para o meu Mac" usa a origem do site em que você está (`location.origin`, que o `site.js` passa
ao `celular.js`): no staging é `https://site-staging.agentesgrok.com/`, no Worker local `http://localhost:8787/`. Só os
links estáticos do HTML, que valem para quem está sem JavaScript, continuam apontando para a **produção**. E os botões
do WhatsApp abrem a conversa com o número real da Coflow: confira a mensagem pronta e não envie.

## 2. Cadastro e teste grátis

| O que fazer | Onde | Resultado esperado |
|---|---|---|
| Entrar pela primeira vez com um e-mail novo (link por e-mail ou Google) | `console-staging.agentesgrok.com` › Entrar | A conta é criada e o console abre. Em Plano: Plano "Pro", Status "Trial", "Vale até" daqui a `TRIAL_DIAS` dias. |
| Criar conta com senha | `auth-staging.agentesgrok.com/signup` | Pede a confirmação do e-mail; só depois de confirmar o login entra ("confirme o e-mail antes de entrar"). |
| Entrar de novo com a mesma conta | console | O prazo do teste não muda: o teste é dado uma vez, no primeiro login. |
| Apagar a conta (Perfil › Apagar conta) e entrar de novo com o mesmo e-mail | console | A conta nova **não** ganha outro teste (Plano "Free"). Use um e-mail descartável: é um caminho sem volta para aquele e-mail. |
| Ver a conta nova como admin | console › Plano › "Planos de todas as contas" | A conta aparece com Fase "Trial · 3 dias". |

## 3. Console: Plano

| O que fazer | Onde | Resultado esperado |
|---|---|---|
| Abrir Plano com a conta `teste` | console › Plano | Cartões: Plano "Pro", Status "Trial", Vale até a data do fim, Ciclo "-", Limite de devices, Máquinas com a licença, Add-ons "nenhum". No cabeçalho, o selo "faltam 3 dias de teste". |
| Conta `teste` no último dia | idem, com o teste a menos de 24 h do fim | O selo passa a contar horas ("faltam N horas de teste") e fica em vermelho. Para ver sem esperar: admin › Editar › "Vale até" com a data de hoje (o prazo vale até 23:59:59 UTC desse dia). |
| Abrir Plano com `teste-vencido` | console › Plano | Selo "teste venceu há 1 dia", em vermelho, e o aviso da promoção (seção 4). |
| Abrir Plano com `promo-vencida` | console › Plano | Selo "teste venceu há 4 dias". Sem aviso de promoção; o botão é "Assinar por R$ 97/mês". |
| Abrir Plano com `pro-pago` | console › Plano | Status "Ativo", Ciclo "mensal", selo "faltam 30 dias do Pro". Aviso "Você já tem o Pro até …, sem assinatura ativa…". |
| Abrir Plano logado como super admin | console › Plano | Selo "∞ sem prazo"; "Vale até", "Limite de devices", "Máquinas com a licença" e "Add-ons" mostram "∞". O painel "Assinar o Pro" e a promoção não aparecem. |
| Outras seções | console › Visão geral, Devices… | O selo da contagem só aparece na página Plano. |
| Suas assinaturas | console › Plano, numa conta que pagou no Modo Teste | Tabela com Produto, Valor ("R$ 97,00/mês"), Situação "Em dia", Vale até e o botão "Cancelar". Conta que nunca pagou não vê a tabela. |
| Cancelar | "Cancelar" na linha | Pede confirmação na própria linha ("Cancelar o Pro: ele continua até … e depois nada mais é cobrado."). "Confirmar cancelamento": situação "Cancelada", aviso "Assinatura do Pro cancelada. O acesso continua até …". O Pro continua até a data. |

## 4. Pagamento no Modo Teste da AbacatePay

O staging usa a loja no **Modo Teste**: nenhum dinheiro de verdade passa. **Qual cartão ou dado de teste usar não
está documentado neste repositório**; use o que a documentação da AbacatePay indicar para o Modo Teste
(`https://docs.abacatepay.com`) e não invente número. Evento real é ignorado pelo staging, e evento de teste é
ignorado pela produção.

| O que fazer | Onde | Resultado esperado |
|---|---|---|
| Pro pelo preço cheio, durante o teste | conta `teste` › Plano › "Assinar por R$ 97/mês" | Abre a página da AbacatePay com R$ 97,00, sem cupom aplicado pelo console. Pago, volta para `/account/plan?assinatura=paga`: "Recebemos você de volta…" e, em segundos, "Pagamento confirmado: o Pro está ativo.". Status "Ativo", Ciclo "mensal", "Vale até" = um mês depois do pagamento mais 3 dias. |
| Promoção: o aviso | conta `teste-vencido` › Plano | Caixa "Seu teste acabou: o primeiro mês do Pro sai por R$ 1. Depois, R$ 97 por mês. Só no cartão. Vale até …", o cupom `PRIMEIROMES1`, "Copiar cupom", "Prefiro pagar com Pix: R$ 97 por mês, sem o desconto" e "Ver as regras" (abre `/promocao`). O botão vira "Assinar por R$ 1 no primeiro mês". |
| Promoção: pagar | "Assinar por R$ 1 no primeiro mês" | A página da AbacatePay abre **só com cartão** e com o preço cheio: ela não aplica o cupom sozinha. Cole `PRIMEIROMES1` em "Código do cupom" e toque em Aplicar: o total cai para R$ 1,00. Pago: Pro "Ativo", como no preço cheio. |
| Promoção: depois de pagar | mesma conta › Plano | "Suas assinaturas" mostra o Pro a "R$ 97,00/mês" (é o valor do mês, não o da primeira cobrança). O aviso da promoção some e não volta. Para o super admin, a Auditoria registra "assinatura.paga … 100 centavos (promoção do primeiro mês)". |
| Promoção: renovação | 1 mês depois | **Ainda não verificado por ninguém:** o valor que a AbacatePay cobra na segunda mensalidade de uma assinatura criada com o cupom. O esperado é R$ 97,00; o servidor exige o preço cheio na renovação e manda cobrança menor para "Revisar pagamento". As assinaturas de teste de 18/11/2026 renovam em 18/12/2026. |
| Promoção sem colar o cupom | pagar os R$ 97,00 na página da promoção | O Pro é liberado normalmente (pagou mais que o mínimo). **Ainda não verificado.** |
| "Prefiro pagar com Pix" | conta `teste-vencido` › o link do aviso | Abre o pagamento normal: R$ 97,00, sem cupom, com as formas de pagamento do ambiente (cartão e Pix; se a loja não tiver o Pix Automático liberado, só cartão). |
| Promoção vencida | conta `promo-vencida` › Plano | Sem aviso; "Assinar por R$ 97/mês" abre o preço cheio. |
| Prazo acaba com a tela aberta | deixar a tela da promoção aberta até passar o "Vale até" e tocar em Assinar | Não abre o pagamento: "o primeiro mês com desconto não vale mais para esta conta; o Pro sai pelo preço normal. Toque em Assinar de novo para continuar". **Ainda não verificado na tela** (a regra tem teste). |
| Add-on | qualquer conta › Marketplace › "Assinar o Finanças" › "Assinar por R$ 997,00/mês" | Pago, volta com "Pagamento confirmado: o Finanças está ativo nesta conta. Falta um passo para ele aparecer no app: a liberação na sua máquina. O pedido já está com o suporte. Quando for liberado, ele aparece na página Módulos do app." e o cartão Add-ons mostra "Finanças". O plano da conta não muda. No staging existe também "Módulos do Diego" (seção 7). |
| Add-on: a mensagem de pós-compra nos três estados | mesma conta › Marketplace, depois de pagar o add-on | **Pedido aberto** (o admin ainda não atendeu): o painel "Finanças" com a mensagem da linha acima continua na página Marketplace mesmo recarregando sem o `?assinatura=paga`. **Pedido atendido** (admin › Suporte › "Atender", seção 5): recarregando sem a query o painel some; abrindo `/account/marketplace?assinatura=paga&produto=meu-bot-finance` ele diz "Pagamento confirmado: o Finanças está ativo nesta conta. O suporte já marcou a liberação na sua máquina como feita: ele deve aparecer na página Módulos do app. Se não aparecer, fale com o suporte.". **Sem pedido** (add-on concedido pelo admin em Editar › Add-ons, sem compra), no mesmo endereço com a query: "Pagamento confirmado: o Finanças está ativo nesta conta. Ele aparece no app depois de liberado na sua máquina; se não aparecer, fale com o suporte.". **Ainda não verificado na tela** (os três textos e a leitura do pedido têm teste). |
| Já tem assinatura | conta com assinatura do Pro em dia | O painel "Assinar o Pro" não aparece. |
| Máquina extra | Marketplace, conta com o Pro valendo | Painel "Mais uma máquina para o agente", com a frase que diz que não é um Mac a mais com o app, e o botão "Adicionar uma máquina por R$ 97,00/mês". |
| Device extra | Marketplace | O painel "Mais um Mac com o app" **não** aparece enquanto o `device` não estiver no `ABACATEPAY_EXTRAS`. Quando entrar: "De R$ 97 por R$ 47 por mês" e o botão "Adicionar um Mac por R$ 47,00/mês". |
| Marketplace | console › menu lateral "Marketplace" | "O que a sua conta tem" lista o Pro, os add-ons e as unidades extras. Embaixo, uma grade de cartões, um por item à venda, cada um com a letra, o selo ("Você tem", "Disponível", "Precisa do Pro", "Falta liberar na máquina"), o nome, o resumo e o preço. O cartão não vende: abre a página do item (`/account/marketplace/<slug>`), com "Como funciona", o que inclui, o que é preciso e, só ali, o botão de contratar. Item que a conta paga mostra também o painel "Sua assinatura", com o valor, a situação, até quando vale e "Cancelar" (mesma confirmação de Plano › Suas assinaturas). A página Plano não tem mais painéis de compra, só o link para o Marketplace. Depois de pagar um add-on ou uma unidade, a AbacatePay devolve em `/account/marketplace?assinatura=paga&produto=…`, que abre a página do item pago; um link antigo `/account/plan?…&produto=…` cai no mesmo lugar. |
| Aviso ao admin | console do admin › Suporte | Cada primeira cobrança paga abre um pedido "Liberar na máquina" (detalhe "liberar na máquina: Pro" ou o nome do add-on). |

## 5. Admin

Logado no console do staging com perfil de acesso (admin ou super admin).

| O que fazer | Onde | Resultado esperado |
|---|---|---|
| Lista de contas e fase | Plano › "Planos de todas as contas" | Uma linha por conta, com Plano, Fase, Vale até, Devices, Máquinas, Pedidos. Com as quatro contas de teste: "Trial · 3 dias", "Trial venceu há 1 dia", "Trial venceu há 4 dias", "Pro · 30 dias". Super admin: "Pro · ∞". |
| Totais | Visão geral › "Todas as contas" | Cartões Contas, Em trial, Trial vencido (com "converter ou liberar"), Pro ativo, Devices pendentes, Pedidos abertos. |
| Buscar | campo "Buscar por e-mail ou nome" | Filtra a lista; `+mb-staging-` traz só as contas de teste. |
| Editor de licença | "Editar" na linha | Abre Plano, Status, "Vale até", Devices, Máquinas, Senha e os add-ons da conta. Salvar grava e a linha muda na hora. |
| "+30 dias de teste" | no editor | Preenche Pro, Trial e hoje mais 30 dias; **só vale depois de Salvar**. Salvo, a Fase vira "Trial · 30 dias" ou "· 31 dias" (o prazo vale até 23:59:59 UTC do 30º dia). A conta passa a ter os `PROMO_DIAS` da promoção depois desse novo fim. |
| Trocar o Status de Trial para outro | no editor | O fim do teste é apagado: a conta deixa de ter direito à promoção. |
| Liberar um add-on na máquina | Suporte › "Pedidos abertos de todas as contas" | O pedido "Liberar na máquina" da compra aparece; "Atender" o fecha. Ele fecha sozinho quando a pessoa aplica a licença na máquina pelo app ("Usar o meu Pro nesta máquina"). **Ainda não verificado neste roteiro:** a aplicação na máquina é do app, não do site. |
| Encerrar um add-on pago | Editar › Add-ons › "Encerrar" | Dois cliques; o add-on sai da conta na hora. A assinatura na AbacatePay é cancelada à parte. |
| Só super admin | menu | Assinaturas, Perfis de acesso, Janelas de suporte e Auditoria só aparecem para o super admin. |

## 6. Analytics do ensaio

A propriedade de ensaio se identifica pelo ID de medição `G-FCKW62SB1K` (o `GA_ID` do staging no `wrangler.toml`) e
pelo número da propriedade, **485491921**; o fluxo é `agentesgrok-site-staging`. Os nomes variam: na tela do Google
Analytics a conta aparece como "AgentesGrokStaging" e a propriedade como "agentesgrokstaging"; o README do `conta-api`
ainda a chama de "agentesintegrados". Na dúvida, vale o ID e o número. No staging todo evento leva `ambiente: staging` e
`debug_mode`: aparece na hora em Administrador › DebugView. Confira ali, um fluxo de cada vez.

| O que fazer | Onde | Evento esperado |
|---|---|---|
| Tocar em "Testar grátis por 3 dias" | home, Mac | `baixar_mac` com `origem` (`hero`, `teste`, `final`, `fixo`…) |
| Chegar na `/obrigado` | site, Mac | `download_iniciado` com `versao`, antes de o download começar. O link "use este link" manda `download_repetido`, que não conta. |
| "Mandar o link para o meu Mac" / "Mandar por e-mail" | home, celular | `link_celular` com `via`: `whatsapp` ou `email` |
| "Falar com a gente no WhatsApp" | home, celular | `falar_whatsapp` com `origem`: `celular` (ou `fixo`, `final`, `flutuante`) |
| Criar conta | `/signup`, ou primeiro login por Google ou link | `cadastro_concluido` com `metodo`; no login, também `via: login` |
| Entrar | página de login | `login_concluido` com `metodo` e `destino` (`console` ou `app`) |
| Abrir o Marketplace | site `/marketplace` e console › Marketplace | `view_item_list` com os itens; tocar num cartão manda `select_item`; a página do item manda `view_item` com `value` e `items[0].item_id` no formato `<id>-mensal`. No site, "Contratar pelo console" manda `marketplace_contratar`. |
| Tocar em Assinar | console › Plano (Pro) ou Marketplace (add-on, unidade extra) | `checkout_iniciado` com `plano` (`chip-coflow`, ou o nome do add-on). Na promoção, também `promo: primeiro-mes`. |
| Pagar no Modo Teste | depois do pagamento confirmado | `purchase` com `value` igual ao que foi pago (1 na promoção, 97 no preço cheio, 997 no add-on), `currency: BRL` e `transaction_id`. Sai do servidor, na mesma visita do `checkout_iniciado`. Renovação é `assinatura_renovada`, não `purchase`. |

O `purchase` só sai se o staging tiver o secret `GA_MP_SECRET`. **Ainda não verificado daqui** se ele está posto: é
secret do Worker, o repositório não diz. Sem ele, o log do Worker mostra "compra … fora do GA4".

## 7. Diferenças conscientes entre staging e produção

O staging só prova a produção se os dois forem iguais em tudo o que não é, por natureza, de cada um. O que pode
diferir nas vars está escrito, com o motivo, em `conta-api/tests/paridade-ambientes.test.mjs`; qualquer outra
diferença reprova o `npm test` do `conta-api`, antes de todo deploy.

| O que difere | Staging | Produção | Por quê |
|---|---|---|---|
| `CANAL` | `staging` | `producao` | é o nome do ambiente |
| `API_ORIGIN`, `AUTH_ORIGIN`, `CONSOLE_ORIGIN`, `SITE_ORIGIN`, `FIREBASE_AUTH_DOMAIN` | hosts com `-staging` | hosts de produção | o endereço de cada ambiente |
| `GA_ID` | `G-FCKW62SB1K` | `G-12CJ787RGJ` | uma propriedade do Analytics por ambiente, para o ensaio não sujar os números |
| `ABACATEPAY_PRODUTO` e o `produto` de cada add-on | ids do Modo Teste | ids da loja de produção | cada loja tem os seus ids; preço e nome têm de ser iguais |
| Add-on `meu-bot-diego` | à venda | não existe | exceção **temporária, até 15/12/2026**: falta criar o produto de produção. Depois dessa data o teste falha até alguém decidir. |
| Banco D1 | `conta-staging` | `conta` | dados separados; as migrações são as mesmas |
| Secrets (chave da AbacatePay, webhook, HMAC da sessão…) | os do Modo Teste | os de produção | postos por ambiente com `wrangler secret put`, fora do repositório |
| Sessão do app (refresh) | 7 dias | 90 dias | `refreshTtlS` em `sessao-core.ts`: no staging o cofre do app é só ofuscação |
| Webhook de pagamento | ignora evento real | ignora evento do Modo Teste | `decidir` em `pagamento-core.ts` |
| Analytics | `debug_mode` em todo evento | sem | para o DebugView mostrar na hora |
| Download do Mac | a release de staging | a estável | cada site entrega o app do seu canal |
| Buscadores | `x-robots-tag: noindex, nofollow` | indexado | o staging não compete com o site |
| Site | faixa na home, selo "staging" ao lado da marca e " · staging" no título (`site.js`) | sem | para ninguém confundir; o HTML servido é o mesmo nos dois, e não há página só do staging |
| Console e login | a palavra "staging" ao lado da marca | sem | idem |
| "Zerar a Auditoria" | o botão aparece para o super admin (`console.js`) | botão escondido, e a rota responde 403 | em produção o registro é o rastro das vendas |

O rascunho `public/site/suporte.html` fica no repositório, mas nenhum ambiente o serve: `/suporte` dá a 404 do site
nos dois.

## 8. Serviços de fora do repositório

O `main → staging → produção` cobre o código. Estes serviços têm configuração própria, que não vem no commit: cada um
tem a sua regra.

| Serviço | A regra | Como conferir |
|---|---|---|
| **AbacatePay** | Modo Teste primeiro. Produto, cupom ou webhook novo nasce no Modo Teste, é provado no staging e só então é criado igual na loja de produção (mesmo preço, mesmo código de cupom). | Seção 4 inteira no staging. Na produção, depois: o produto e o cupom existem com os mesmos valores. |
| **Google Analytics** | Propriedade de ensaio primeiro. Evento, dimensão ou regra nova entra na de ensaio, aparece no DebugView, e só então na de produção. As duas listas de **eventos principais** têm de ser iguais. | Seção 6. Em Administrador › Eventos, comparar as estrelas das duas propriedades (hoje, pelo README: `download_iniciado`, `login_concluido`, `cadastro_concluido`, `org_criada`). |
| **Google Ads** | Não tem staging. Toda mudança entra **pausada**, ou com a **hora anotada** no registro da conferência, para dar para ligar a mudança ao que os números fizerem depois. | Anotar no registro: o que mudou, a hora, quem. |
| **Banco D1** | Migração no staging antes da produção. O `site-publicar.mjs` já faz nessa ordem (`migrar:staging` no deploy do staging, `migrar` no da produção); nunca rode migração à mão direto na produção. | O deploy do staging passou e os fluxos que usam a tabela nova funcionam. |

## Ainda não verificado por ninguém

- O valor da **renovação** de uma assinatura feita com o cupom (seção 4). É a ponta mais importante: confere-se em
  18/12/2026, ou antes se o Modo Teste tiver como adiantar o ciclo.
- Pagar o preço cheio na página da promoção, sem colar o cupom (seção 4).
- O aviso "o primeiro mês com desconto não vale mais" com a tela aberta (seção 4).
- Repetir a promoção na mesma conta depois de remover a assinatura e zerar a Auditoria ("Contas de teste").
- Se o staging tem o `GA_MP_SECRET`, sem o qual o `purchase` não sai (seção 6).
- A mensagem de pós-compra de add-on nos três estados: pedido aberto, atendido e sem pedido (seção 4).
- O pedido "Liberar na máquina" fechar sozinho quando a pessoa aplica a licença pelo app (seção 5).
- `scripts/staging-contas.mjs --listar` e `--aplicar` contra o staging de verdade: quando este arquivo foi escrito, só
  a parte pura tinha teste. Tire este item depois da primeira rodada.

Quando alguém verificar um destes, tire-o daqui e da linha da tabela, na mesma PR.

## Registro da conferência

Copie o bloco para um arquivo fora do repositório, preencha e passe em `--aprovar <sha> --roteiro <arquivo>`: ele fica
gravado junto da aprovação. Sem segredo nenhum dentro (nem token, nem chave).

```markdown
# Conferência do staging

- Data e hora:
- Commit do staging (o `commit` de https://conta-staging.agentesgrok.com/health):
- Quem conferiu:
- O que esta publicação muda:

## Seções

- [ ] 1. Site no computador e no celular
- [ ] 2. Cadastro e teste grátis
- [ ] 3. Console: Plano
- [ ] 4. Pagamento no Modo Teste
- [ ] 5. Admin
- [ ] 6. Analytics do ensaio
- [ ] 7. Diferenças conscientes (nenhuma nova, ou qual)
- [ ] 8. Serviços de fora (o que mudou em cada um, com a hora)

## Itens não conferidos, e por quê

-

## O que apareceu diferente do roteiro

-

## Mudanças em serviços de fora (AbacatePay, Analytics, Ads, D1)

- Serviço · o que mudou · hora · pausada?
```
