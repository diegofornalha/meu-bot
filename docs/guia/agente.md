# Agente: modelos, fallback, status line e Claude

> Parte do diário técnico do meu-bot, dividido por assunto em 27 out 2026. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

## Provedores com fallback (15 out 2026; só o Claude no produto base desde 24 nov)

- `providers.json` ao lado do backend: lista ordenada `{ name, type: claude|openai, priority, … }`.
  Padrão: só o `agente` (claude, 0); até 24 nov (#514) era `agente` → `grok-4`. Entrada openai tem `base_url`,
  `model`, `key_env`/`key` e `timeout_ms`; sem chave só fica disponível com endpoint local (127.0.0.1 ou localhost).
- De onde vêm os outros provedores:
  - **Modo grátis:** o `install-ollama.sh` mescla a entrada `ollama-local` no `providers.json` da máquina (endpoint
    local, sem chave) e a tira ao remover. Nada mudou aqui.
  - **Módulo:** o instalador de um módulo grava `provedores.json` na pasta dele e o backend o junta aos da máquina
    na subida (`modulos.js › provedores`). O exemplo é o `grok-4` do módulo do Grok, com `rotulo: "Grok (xAI)"`.
    Contrato, chave e o que o módulo deixa na máquina:
    [meu-bot-diego.md › Motor de IA trazido por módulo](meu-bot-diego.md#motor-de-ia-trazido-por-módulo-24-nov-2026).
- Módulo `providers.js` (cópia idêntica em `backend-colima/` e `backend-vm/services/`): `load(file, env, log, extras)`
  (`extras` = os provedores dos módulos), `chain(requested)`, `openaiCompletion` (SSE), `fallbackChunk`. Testes em
  `scripts/tests/providers.test.mjs` (mock HTTP incluso).
- `reserva` (24 nov, #513): diz se o provedor entra na corrente quando OUTRO modelo falha. Entrada do
  `providers.json` da máquina vale como reserva por padrão (`reserva: false` a tira); provedor de módulo só é reserva
  com `reserva: true`. Escolhido de propósito, qualquer provedor disponível responde.
  `chain(requested)` = o pedido primeiro + os outros disponíveis que aceitam ser reserva, por prioridade.
- Regra do fallback: só se o provedor pedido falhar ANTES de produzir texto; já saiu delta, o erro é
  definitivo. O cliente recebe um chunk com `x_meu_bot.fallback {from,to,reason}` (delta vazio) e o
  cabeçalho `X-Provider`. Modelo fora da corrente (rene, rene-dm, claudecode) roda como sempre.
- Backend genérico (`server.js`): `attempts = chain(model)`, laço de tentativas, `used` vira o model dos
  chunks. Com a corrente só no `agente`, uma falha do Claude não tem para onde descer: o erro vai ao cliente.
  `/v1/models` lista os openai disponíveis.
- Backend do Hermes (`backend-vm/`, máquina legada; o `providers.json` e o `openai-compat.js` de lá ficaram
  como estavam): `_serveOpenai` atende direto o provedor openai; `_streamLive` com `ctx.canFallback` devolve o erro
  ao chamador em vez de responder 503, e aí `_nextOpenai(reqModel)` decide. Deploy: `backend-vm/deploy-agente.sh`
  leva `openai-compat.js` + `providers.js` e cria `providers.json` só se faltar.
- App (24 nov, #515): a lista de modelos vem da máquina, não de uma tabela no código. `src/shared/modelos.ts`
  (puro, testado) junta os perfis do Claude (`PERFIS_CLAUDE`: `claudecode`, `agente`, `rene-dm`, `rene`) com os
  provedores openai que o `GET /v1/meu-bot/status` informa (`lerProvedores`, `modelosDaMaquina`); o nome na tela é o
  `rotulo` do provedor, ou o `name`. Enquanto o status não chega valem os modelos do `/v1/models` da sondagem.
  `tempoLimiteMs`: 120 s para o `claudecode`, 600 s para o resto. Se a máquina responde `model_not_found` (módulo
  desligado, provedor removido), o turno é refeito uma vez no modelo padrão dela (`recuoDoTurno`, `modeloDeRecuo`).
- `backend.ts` lê `x_meu_bot.fallback` e manda `chat:notice` (aviso amarelo na conversa) +
  `backend:status degraded`.

### Incidente: o instalador genérico sobrescreveu o server.js do Hermes
- `install.sh` copia para `~/.hermes/agente-rene/backend-sdk-claude`, que na grokbot-1 é o backend
  ORIGINAL do Hermes (git em `~/.hermes/agente-rene`). Em 14 out 17:00 o `server.js` do Hermes foi
  substituído pelo genérico. O processo vivo continuou com o código antigo em memória; só o restart do
  deploy de 15 out 01:18 subiu o genérico, e por 3 minutos a porta 8080 não conhecia `rene-dm` (WhatsApp).
  Restaurado com `git checkout -- server.js` + `rm session-map.js` (cópia do genérico em `/tmp`).
- Trava nova no `install.sh`: se `$DEST/app.js` ou `$DEST/services/` existir, recusa (exit 3) e aponta
  para o `deploy-agente.sh`. Não existe backup automático do `server.js` do Hermes fora do git: não
  rodar o instalador genérico na grokbot-1.
- Outra regra da grokbot-1: `hermes gateway restart` na mão deixa um gateway solto fora do PM2 e o PM2
  entra em loop (17 mil reinícios em 2,5 h). Sempre `pm2 restart hermes-gateway`.
- Pill do túnel mostra quem respondeu de fato (`X-Provider` do backend): "túnel ativo · agente ·
  respondeu <provedor>", em amarelo quando difere do pedido. Lição do diálogo na grokbot-1 (15 out): a prova
  do modelo é o log/cabeçalho, nunca o nome que o modelo dá a si mesmo.
- Troca de modelo no meio da conversa: `setConversationModel` guarda `pendingSwitch {from,to}`
  (transitório; a regra é `trocaPendente`, em `src/shared/modelos.ts`) e o próximo turno manda a mensagem do usuário
  com `note` (campo de `BackendMessage`, persistido mas nunca exibido; `toWire` concatena antes do conteúdo). A nota
  diz ao modelo novo que as respostas anteriores foram de outro modelo. Motivo: no teste do usuário o modelo novo
  disse "na mensagem anterior eu respondi errado" sobre uma resposta que era do Claude.

## Status line, primário e reserva (15 out 2026)

- **Tutorial 16 oculto (30 out):** o cartão "Status line do Claude" saiu da lista (`oculto: true` em `lib/tutoriais.ts`; o
  guia, os canais `statusline:*` e o reset continuam no código). O admin instala a status line ao criar a conta
  (`prepararUsuario` → `installStatusLine`, também no "Preparar"): a pessoa não tem passo nenhum. A escolha de segmentos
  deixa de ter tela; o rodapé mostra todos.

- Rodapé da conversa (`#ctx-line`) virou a status line no modelo do `statusline.sh` da box:
  `agente | Ctx: 13% · 3.2k/24.0k | 6.3 s · 258 tok · 41 t/s | m6@… (Premium) | Sessão: 37% · 1h35m |
  Semanal: 37% · 5d0h | há 12 min`. Cores: modelo amarelo, Ctx/Sessão ciano, conta verde, Semanal
  magenta. Conta e limites só aparecem em perfis do Claude (`ehPerfilClaude`), não num provedor `openai`. Puro em
  `lib/status-line.ts` (`buildSegments`, `timeUntil`, `fmtK`, `thresholdToWarn`), testado.
- Dados: `GET /v1/meu-bot/status` nos dois backends (`account-status.js`, cópia idêntica) lê
  `~/.cache/claude-statusline/{profile,ratelimits}.json`, que o statusline.sh do Claude Code interativo
  mantém na máquina; `updated` vira "há N min". No backend do meu-bot o mesmo endpoint traz `providers`, a corrente
  da máquina: `{ name, type, available, reserva }` e, quando há, `rotulo` e `modulo` (o módulo que trouxe o
  provedor). O app busca no boot (`backend:account`) e depois de
  cada turno (`chat:account`). Tokens de contexto: `chat:context.tokens/budget` (estimativa do que foi
  enviado); turno: `chat:done.ms/usage` (usage vem do chunk final do SSE).
- Aviso de sessão: ao cruzar 80, 90 e 95% da sessão de 5 h, um aviso amarelo na conversa ativa
  ("Sessão do Claude em 92% … renova em 1h35m"), uma vez por limiar; zera quando a sessão renova.
  Mesma regra do alerta do Hermes no WhatsApp da box, adaptada ao painel.
- Primário e reserva (`lib/fallback.ts`, puro, testado): `opcoesDePrimario` dá o Claude sempre e depois cada
  provedor da corrente que o backend informa (`providers` do status), com o `rotulo` dele; `fallbackReserve` é quem
  está disponível, não é o primário e aceita ser reserva; `fallbackOrderText` escreve a linha "Primário: … Reserva: …".
  O primário gasta o orçamento da conta dele; a reserva não consome nada até ser acionada. No produto base a corrente
  só tem o `agente`, então a linha diz "Sem reserva disponível nesta máquina". O grupo Configurações › Fallback, que
  mostrava isso, saiu em 30 out.
- Na grokbot-1 o endpoint foi implantado e devolve a conta Premium e 37%/37% (cache de 01:14). No Mac
  (`local`) só há `profile.json`: o statusline do Mac é o da biblioteca gerenciada e não grava limites.

## Instalar status line pelo seletor (15 out 2026)

- A status line do app só tem Sessão/Semanal se a máquina grava `~/.cache/claude-statusline/ratelimits.json`.
  O `statusline.sh` do `claude-statusline` (Diego) lê esses limites do stdin que o Claude Code manda
  (`rate_limits.five_hour/seven_day`), mas só persistia `profile.json`; o semanal nem era lido. Sem o arquivo,
  `account-status.js` devolve null e o rodapé fica só com modelo, Ctx e conta.
- `backend-colima/statusline.sh` é aquele script com um bloco a mais que grava `ratelimits.json`
  (`session_pct`, `session_resets`, `weekly_pct`, `weekly_resets`, `updated`), só quando há dado. O semanal vai
  para o cache mesmo sem aparecer na barra do terminal; quem o mostra é o painel. Testado em
  `scripts/tests/statusline-cache.test.mjs` (HOME descartável, `security`/`curl` neutralizados no PATH).
- `backend-colima/install-statusline.sh` copia para `~/.claude/statusline.sh`, injeta `statusLine` no
  `~/.claude/settings.json` preservando o resto (backup `.antes-do-meu-bot`, uma vez) e prova que o script roda.
  Idempotente. Se a máquina tem settings gerenciadas com `statusLine`, sai com 3 e explica: elas ganham do
  settings.json, e instalar ali não teria efeito — é o caso deste Mac (`/Library/Application Support/ClaudeCode`),
  que se atualiza pela skill `global-statusline`, não pelo app.
- Sondagem: `statusline=1` quando `~/.claude/statusline.sh` contém `ratelimits.json` (no `local`, se há
  gerenciada, é o script dela que conta). `probe-text.ts` mantém a máquina em ✓ e abrível, só acrescenta
  "sem status line do Claude" e troca o botão para "Instalar status line" (`install: "statusline"`); o mesmo
  `install()` do seletor atende os dois, pelo canal `picker:install-statusline`, com o log de progresso de sempre.

## Entrar no Claude Code pelo app (15 out 2026)

- `claude auth login` (CLI 2.1.300) sem terminal imprime o link `https://claude.com/cai/oauth/authorize?…`
  e espera o código no stdin ("Paste code here if prompted >"). `src/main/claudeLogin.ts` roda isso por
  ssh (ou local), abre o link no navegador do Mac, recebe o código pelo modal (`#cl-dialog`) e
  escreve no stdin; no fim confere com `claude auth status` (JSON `loggedIn`). Timeout 10 min.
- Entradas: botão "Entrar no Claude Code" na notice de erro/fallback que mencione login/deslogado
  (`offerClaudeLogin`), ação na paleta, e no seletor (abre a janela da máquina já no modal, via
  `ui:claude-login`). Sondagem: backend no ar + Claude deslogado agora é amarelo com o botão
  (antes ficava verde). `probe-text` ganhou o campo `login`.
- Backend do Hermes: pedido direto a um provedor `openai` passa antes do corte do authDown, e em authDown um
  modelo com reserva na corrente cai para ela com aviso em vez de 503. `rene-dm` segue 503
  (fora da corrente), que é o que o Hermes do WhatsApp espera.
- Pegadinha mantida: o login reescreve `settings.json`/`.bashrc` na máquina; o backend não depende
  disso (bypass vai por flag).
- Lista de conversas ganhou linhas de conta no topo: WhatsApp do Hermes e Claude Code
  (`claudeAuthInfo`: `claude auth status` + e-mail do `~/.claude.json`; "sair" = `claude auth logout`
  e já abre o login). A terceira linha, "xAI (Grok)", o modal "Entrar na xAI" e o `xaiLogin.ts` que os servia saíram em
  24 nov (#518): o login da xAI passou a ser o `entrar.sh` do módulo do Grok
  ([meu-bot-diego.md](meu-bot-diego.md#motor-de-ia-trazido-por-módulo-24-nov-2026)).
  Modais: um botão só (Cancelar enquanto roda, Fechar depois), "Começar" some ao concluir e vira
  "Tentar de novo" se falhar; fecham sozinhos no sucesso.
- Pegadinha que o módulo herdou: `hermes auth add xai-oauth --type oauth --no-browser` sem pseudo-terminal não
  imprime nada e fica parado (o CLI exige tty). O `entrar.sh` roda direto quando está num terminal (o do app) e,
  fora de um, pede um emprestado ao `script`. Já `claude auth login` funciona sem tty.
- Interface "clean" (15 out, madrugada): ☰ na ponta esquerda da barra; "arquivadas" virou interruptor
  no rodapé da lista; barra superior recolhível (Cmd+Shift+B, botão ⌃/⌄, paleta) com faixa fina
  mostrando máquina · modelo · estado do túnel. Lista e barra começam recolhidas por padrão
  (`localStorage.sidebarShown` / `topbarShown`).

## Grok (xAI): virou módulo (24 nov 2026)

- Até 24 nov o Grok vinha dentro do meu-bot: o `backend-colima/install-grok-oauth.sh` instalava o Hermes, o proxy
  local (`meu-bot-xai-proxy.service`) e gravava o `grok-4` no `providers.json`; o app tinha a linha "xAI (Grok)", o
  login por `xaiLogin.ts` e o tutorial "Entrar na xAI (Grok)".
- Agora o produto base só tem o Claude, e o Grok é o módulo `grok` do complemento `meu-bot-grok` (com licença). O que
  ele instala, o login (`entrar.sh` no terminal do app), a opção `reserva` e como desinstalar estão num lugar só:
  [meu-bot-diego.md › Motor de IA trazido por módulo](meu-bot-diego.md#motor-de-ia-trazido-por-módulo-24-nov-2026).
- O que saiu do backend (#514, backend 1.18.8): o padrão `agente → grok-4` do `providers.json` e a reserva do Grok no
  OpenClaw (`oc_fallback_ensure`). O `install.sh` tira o `grok-4` e o proxy das máquinas sem o módulo
  (`tirar_grok_sem_modulo`).
- O que saiu do app (#518): `src/main/agente/xai*`, os canais `xai-login:*`, a linha "xAI (Grok)" da lateral, o modal
  "Entrar na xAI", a opção "Tenho Grok" da primeira abertura, a linha da xAI na saúde do admin e o
  `backend-colima/install-grok-oauth.sh`. O tutorial 4 (`xai-login`, "Entrar na xAI (Grok)") saiu e o número 4 ficou
  vago: os outros tutoriais não foram renumerados.
- **Tutorial 5 · Fallback: primário e reserva** (`fallback-contas`; era "Fallback: Claude e Grok", 17 out): ficou, sem
  `after` nem `needsXai`. Aparece quando a corrente da máquina tem um provedor que não é perfil do Claude
  (`needsOutroModelo` → `temOutroModelo`, `lib/fallback.ts`): o modo grátis ou o motor de um módulo. Passos: (1) "Outro
  modelo pronto nesta máquina", concluído com `outroModeloPronto` (um provedor que não é Claude e está disponível);
  (2) "Escolher primário e reserva" (corpo `fallback-order`, `renderFallbackOrder`), salvo na hora com
  `setSettings({ backendModelForHost })`, concluído com a flag `fallbackChosen` e o primário na corrente; (3) "Ver a
  reserva assumir": a flag `fallbackSeen` é gravada quando um `chat:done` traz `fallback`, ou pelo botão "Entendi como
  funciona".
- Primeira abertura: a escolha de IA guardada de uma versão anterior é relida por `parseAiChoice`
  (`lib/onboarding.ts`): `"ambos"` vira `"claude"`; `"grok"` não existe mais e vira "sem escolha" (a pergunta volta
  sem nada marcado).
- **Este Mac:** o app não sobe mais o proxy da xAI no Mac. Na subida do backend local, `limparGrokHerdado`
  (`src/main/maquina/localBackend.ts`; regras puras em `providers-local-core.ts`) tira do `providers.json` local a
  entrada `grok-4` do proxy antigo (`semProviderDoProxyAntigo`: nome e endereço exatos, 100 portas abaixo do backend)
  e o `grok-4` do padrão antigo (`semProviderDoPadraoAntigo`: `https://api.x.ai/v1` com `key_env: XAI_API_KEY`), este
  só quando não há `XAI_API_KEY` no `.env` do backend local nem no ambiente (`temChaveXai`); com a chave ele fica.
  Antes da primeira mudança o arquivo é copiado para `providers.json.antes-de-tirar-o-grok`. O módulo do Grok não
  cobre "Este Mac": o instalador dele exige systemd de usuário, numa máquina por SSH.
- O que ficou no app é genérico: a lista de modelos vem da máquina (`src/shared/modelos.ts`) e o primário e a reserva
  saem da corrente que o backend informa (`lib/fallback.ts`), como descrito nas duas primeiras seções deste guia.

## Limite do Fable: o turno refaz com o Opus 5.5 (19 out 2026)

- A CLI do Claude Code devolve "You've reached your Fable limit…" como **texto de resposta**. `runClaude` retém as
  primeiras ~120 letras de cada turno até descartar a hipótese (`LIMIT_RE`), então o aviso nunca chega à conversa:
  vira erro `model_limit`. O provedor refaz o mesmo turno com `--model ${MODEL_FALLBACK}` (padrão
  `claude-opus-5-5`, rótulo `MODEL_FALLBACK_LABEL`), emite o chunk de fallback ("Fable falhou (limite de uso da conta; o Opus 5.5 segue por 60 min)", o app
  mostra como os outros fallbacks) e fica no reserva por `LIMIT_HOLD_MS` (1 h) sem tentar o padrão a cada
  mensagem. No reserva, o system prompt diz ao modelo qual ele é. Se o reserva também bater limite, segue a
  corrente normal: o próximo provedor que aceita ser reserva, se houver (no produto base não há).
- Verificado na `agente-box` com o limite real ativo: resposta veio do Opus 5.5, o aviso de limite não apareceu,
  log "limite do modelo (…); refazendo com claude-opus-5-5".
- (19/10) Status line: o segmento do modelo mostra o nome do modelo que responde de fato (`/v1/meu-bot/status › model`: o reserva durante o limite, senão o `model` do ~/.claude/settings.json da máquina, em nome legível); provedor que não é Claude e backend antigo continuam com o modo.
- (19/10) O 📌 voltou à barra, ao lado do 🔔, com estado: aceso = a aba é site fixo do espaço (clique solta, a aba continua aberta); apagado = solta (clique fixa no espaço ativo; sem espaço, abre o trilho para criar um).
- (19/10) Extensões como no Brave: todas ficam no 🧩 ("Gerenciar extensões": clique no nome abre o popup, 📌 fixa/solta na barra, Remover); na barra só as fixadas (`navExtFixadas:<host>` no localStorage).
- (19/10) Zoom por site no Navegador: botão "%" na barra (alterna 100% ↔ 75%) e Cmd+= / Cmd+- / Cmd+0 (o main devolve as teclas do webview); lembrado por host em `navZoom` (localStorage) e reaplicado em dom-ready/did-finish-load. Resolve a planilha do Streak cortada à direita.
- (19/10) Recortes do Gmail: "Painel do Gemini" (✦, oculto por padrão: `.aUx:has([aria-label="Gemini"])`) e "Painel lateral direito" (◨, visível por padrão: `.bAw:has([role="complementary"])`, `.WN9Ejb.br3`). Eram eles que espremiam a planilha do Streak; vieram do DOM colado pela pessoa.
- (19/10) Recortes: a "Barra superior" também estica a área do InboxSDK (`.inboxsdk__custom_view_element{height:100vh}`): ela tinha altura fixa calculada com a barra e sobrava uma faixa em branco embaixo da planilha do Streak (medido ao vivo: 504 px numa aba de 584). Aplicação dos recortes enfileirada por aba (cliques rápidos não se atropelam) e o botão é atualizado no lugar, sem recriar a barra sob o mouse.

## Skill do token do Cloudflare e ferramenta `guardar` (22 out)

- **Ferramenta `guardar` do Navegador** (`navegador-mcp.mjs` v4): lê um valor na página, por seletor ou por expressão
  regular, e grava direto num arquivo da máquina. Só dentro de `~/.config/`, sem link, com pasta 0700 e arquivo 0600.
  Ao modelo volta só o número de caracteres: a credencial não passa pela conversa. A trava do WhatsApp nega
  `navegador__guardar` para quem não está liberado, como as outras ferramentas.
- **Skill `cloudflare-token`** (`backend-colima/skill-cloudflare-token.md`): é semeada pelo `install-navegador-mcp.sh`
  junto com o Navegador e não sobrescreve a versão que o agente tiver ajustado. Ela cria um token só de leitura
  (DNS:Read e Zone:Read, uma zona) pelo dashboard. Escolhe as opções das listas de React por `js` com `[role=option]`,
  para antes do "Create Token" para o dono conferir, usa `guardar` e testa com `verify` e uma leitura do DNS. Recusa
  pelo WhatsApp. Se algo do token vazar, faz "Roll". Validada na agente-box-lv em 22 out.
- **Acervo:** o primeiro cartão é "Token do Cloudflare (só leitura)". Skills que já vêm com o meu-bot têm `usar`, com o
  botão "Criar o token" e o pedido pronto, em vez de "Pedir ao agente para instalar".

## Links do terminal e tutorial 12 · Conectar contas na máquina (22 out)

- **Links do terminal** abrem no Navegador do app (Cmd+clique abre no navegador do Mac).
- **Retorno de login de CLI** (`browser.ts` › `retornoParaMaquina`): numa janela de máquina por SSH, quando a página vai
  para `http://localhost:<porta>/…` com cara de retorno OAuth, o app entrega esse endereço na máquina por SSH (`curl`) e
  segue para o redirecionamento ou mostra "Login concluído". É assim que o `wrangler login` termina, mesmo com o
  navegador no Mac.
- **Tutorial 12 (`contas-cli`, after 1, só em máquina por SSH):** "Conectar" roda o login da ferramenta na máquina e o
  link abre sozinho no Navegador. Não precisa de terminal.
  - **Cloudflare:** `wrangler login --scopes account:read user:read pages:write zone:read`, só sites e domínios.
    - O `wrangler login` puro pede quase a conta inteira: Workers, D1, e-mail e segredos.
    - Quando a conta foi logada com mais que isso, o passo avisa "acesso amplo" e "Conectar de novo" troca o acesso.
    - Sem o Navegador (sem Pro), o login vai por código de dispositivo (`--device`).
  - **GitHub:** `gh auth login -w` sem terminal, por código de dispositivo. O código aparece no passo com o botão
    Copiar. O passo é opcional: "Não uso GitHub".
  - **Status:** `contas-cli-core.ts` › `STATUS_SH`, um SSH só.

## Tutorial 14 · Seu link público (30 out)

- **Janela do root (30 out):** o status (`link-publico:status`) responde `LINK=root` quando `id -u` é 0 e o tutorial some
  (`needsLinkPublico` + `linkPublicoPossivel: false` no contexto): o link público é das contas de usuário, o admin não
  liga para o root. Antes o passo 1 ficava eternamente em "o admin liga" e "Conferir de novo" não mudava nada.

- **`link-publico`, number 14, after 1, só em máquina por SSH (`needsLinkPublico`; o `needsXai` que ele também levava saiu em 24 nov, #518):** o link `https://<nome>.<domínio>/` que o
  admin liga para a pessoa (Link Público Global, `guia/maquinas.md`). Fonte `linkpublico` (`window.meuBot.linkPublico()`,
  um SSH como ela: `~/.local/share/meu-bot/link-publico.json` + quantos itens em `~/publico`).
  1. **Ver o seu link:** concluído quando o admin ligou (o json existe). Desligado, o passo diz quem liga.
  2. **Colocar algo no ar** (30 out): "Publicar um arquivo…" abre o diálogo do Mac no main (`link-publico:publicar
     {nome?}`; o renderer nunca manda caminho), o main faz `scp` como ela para `~/.local/share/meu-bot/publicar-tmp/<id>/`
     e roda o `publicar` dela (um .md vira página; até 100 MB; nome no link opcional, acentos e espaços viram hífen, e
     um arquivo comum com nome sem extensão ganha a do arquivo). Mostra a URL com Copiar e a lista do que está no ar
     (`link-publico:lista` = `publicar --lista`, só URLs do link dela com nome seguro) com Abrir e "Tirar do ar" em dois
     cliques ("Tirar mesmo?" por 5 s, sem `confirm()`; `link-publico:remover` = `publicar --remover`). O botão "Pedir um
     link de teste ao agente" continua, secundário. Concluído (`lembrar`, `refazer`) quando há algo no ar. Auditoria
     `link-publico.publicar` / `link-publico.remover`.
  3. **Escolher o nome do link:** campo com o nome atual e "Trocar o nome" (`link-publico:nome` → comando
     `link-publico-nome` na máquina, como ela); concluído quando o nome difere do login, ou "Deixar como está"
     (flag `linkNomeVisto`). `refazer` para trocar de novo.
    - Sem o arquivo de login do wrangler, não chama o `npx`.
    - A saída vai para um arquivo com `timeout`: num pipe, o `npm exec` às vezes fica pendurado.
  - **Canais:** `contas:status` (shared); `contas:entrar`, `contas:cancelar` e `contas:sair` (client); evento
    `contas:evento`.
  - **Quem usa a conta:** a credencial fica na máquina. No WhatsApp, só o dono tem `exec`; grupos e as outras pessoas
    da lista não rodam comandos.

## Nível de liberdade no backend e agente como root (28 out, backend 1.3.0)

- **Perfil `whatsapp`** (backend-colima/server.js): igual ao `agente`, mas com o nível do tutorial 8 aplicado pelo
  `nivel-ferramentas.js`, que lê `~/.local/share/meu-bot/objetivo.json` a cada turno: `conversa` bloqueia Bash,
  BashOutput, KillShell, Write, Edit, MultiEdit, NotebookEdit e Task; `consulta` bloqueia Bash/BashOutput/KillShell/Task
  (lê, pesquisa e anota); `age` sem trava. Vai como `--disallowedTools`, e o agente recebe a frase do nível para
  recusar explicando. Segue a corrente do `agente`; uma reserva do tipo `openai` não tem ferramentas. Quando nenhum
  provedor responde, o WhatsApp do Hermes fica em silêncio em vez de entregar o aviso de erro (`sem-claude.js`,
  contorno #8 em [contornos.md](contornos.md)).
- **Quem chama:** o Hermes, com `model.default: whatsapp` no config.yaml, só quando o backend da máquina é 1.3.0+
  (`HERMES_WA_ENSURE_SH`; antes disso fica `agente`). O OpenClaw segue com a trava dele (`tools.toolsBySender`).
- **Limite:** no Hermes o nível vale para todas as conversas do WhatsApp dele (quem fala é a allowlist do Hermes); não há
  trava por remetente como no OpenClaw. A exceção é o Navegador: só os números que o dono marca o recebem, por um passe
  de turno (`docs/guia/navegador.md`, "No Hermes").
- **Backend como root:** o Claude Code recusa `--dangerously-skip-permissions` como root; na meu-root todo turno do
  agente falhava e caía na reserva. O backend passa `IS_SANDBOX=1` quando roda como uid 0 no modo sem permissões.
- Testado na meu-root chamando o backend como o Hermes: `conversa` e `consulta` recusam "rode echo", `age` executa.

## Espaço da conta (Configurações › Espaço, 30 out)

- **Por quê:** o limite de disco por conta (1%) é de propósito (a pessoa sente e faz upgrade), mas até aqui ela só
  sofria: nada na tela, e com a cota cheia o Hermes falhava em gravar, a mídia não chegava, o áudio não transcrevia.
- **Rodapé:** segmento "Espaço: 82%" (`status-line.ts › buildSegments`, de qualquer modelo), amarelo a partir de 80% e
  vermelho de 95%; liga/desliga em Tutoriais › Status line (chave `espaco`, só do rodapé: o statusline.sh ignora). Aviso
  único na conversa ao cruzar 80 e 95% (`checkEspacoThreshold`, rearma abaixo de 75), como o da sessão do Claude.
- **Grupo Espaço** (`src/renderer/configuracoes/espaco.ts`, oculto em `local`): barra, "3,2 GB usados de 3,9 GB · 82%",
  o que ocupa (programas do agente marcados como fixos), **Liberar espaço** (lista do que ela pode apagar: caches de
  imagens e áudios, workspaces do agente e sessões antigas do WhatsApp; nunca a sessão atual do WhatsApp nem programas;
  `espaco-core.ts › caminhoApagavel` + `apagarMeuItemSh` com allowlist e `realpath -m`; Apagar em dois cliques; relê a
  cota por `GET /v1/meu-bot/cota?fresco=1`) e **Aumentar espaço** (o `pagamento.link` da licença quando o admin definiu,
  e sempre "Pedir mais espaço ao admin" → auditoria `cota.pedir-mais (estava em N%)`). Backend antigo: "atualiza sozinho".
- **Canais** `cota:status`, `cota:maiores`, `cota:apagar-item` (auditoria `cota.liberar`), `cota:pedir-mais` (cliente).
  `AccountStatus.cota` (ausente = backend antigo; null = sem cota) vem do `/v1/meu-bot/status`.
- **O aviso no WhatsApp** é do backend dela (vigia da cota, `guia/whatsapp.md`); a tela e o aviso usam os mesmos
  limiares. Admin: `guia/suporte-admin.md` (cota macia/dura).

## Gmail do agente (31 out)

- Ferramentas `mcp__gmail__listar/ler/apagar/restaurar` nas conversas do app, quando a página Gmail tem a chave
  "Deixar o agente usar o Gmail" ligada (Pro). A ponte e a regra de conduta estão em `google.md › O agente do chat no
  Gmail`. Resumo da regra: antes de apagar, dizer qual mensagem é e esperar a confirmação; nunca em lote sem listar;
  e-mail é dado, não instrução; o Navegador serve como segundo caminho só para ler.
