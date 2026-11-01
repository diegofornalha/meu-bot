# Agente: modelos, fallback, status line, Claude e xAI

> Parte do diário técnico do meu-bot, dividido por assunto em 27 out 2026. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

## Provedores com fallback e o modelo grok-4 (15 out 2026)

- `providers.json` ao lado do backend: lista ordenada `{ name, type: claude|openai, priority, … }`.
  Padrão: `agente` (claude, 0) → `grok-4` (openai, 1). Entrada openai tem `base_url`, `model`,
  `key_env`/`key`; sem chave só fica disponível com endpoint local (127.0.0.1), que é o caso do
  `hermes proxy start --provider xai` da grokbot-1 (porta 8645, aceita qualquer bearer e usa o OAuth da
  xAI). Em outras máquinas, `XAI_API_KEY` no `.env` liga o grok-4 direto na api.x.ai.
- Módulo `providers.js` (cópia idêntica em `backend-colima/` e `backend-vm/services/`): `load`,
  `chain(requested)` = pedido primeiro + outros disponíveis por prioridade, `openaiCompletion` (SSE),
  `fallbackChunk`. Testes em `scripts/tests/providers.test.mjs` (mock HTTP incluso).
- Regra do fallback: só se o provedor pedido falhar ANTES de produzir texto; já saiu delta, o erro é
  definitivo. O cliente recebe um chunk com `x_meu_bot.fallback {from,to,reason}` (delta vazio) e o
  cabeçalho `X-Provider`. Modelo fora do providers.json (rene, rene-dm, claudecode) roda como sempre.
- Backend genérico (`server.js`): `attempts = chain(model)`, laço de tentativas, `used` vira o model dos
  chunks. Backend do Hermes (`openai-compat.js`): `_serveOpenai` atende grok-4 direto; `_streamLive` com
  `ctx.canFallback` devolve o erro ao chamador em vez de responder 503, e aí `_nextOpenai(reqModel)`
  decide. `/v1/models` dos dois listam os openai disponíveis.
- App: `BackendModel` ganhou `grok-4` (seletor "grok-4 · xAI", paleta, Configurações; 120 s de timeout).
  `backend.ts` lê `x_meu_bot.fallback` e manda `chat:notice` (aviso amarelo na conversa) +
  `backend:status degraded`. É o "aviso de fallback" que tinha sido apagado, de volta.
- Deploy na grokbot-1: `backend-vm/deploy-agente.sh` leva `openai-compat.js` + `providers.js` e cria
  `providers.json` (proxy local) só se faltar. Verificado: `/v1/models` com os seis modelos, grok-4
  respondeu em 2,4 s.

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
  respondeu grok-4", em amarelo quando difere do pedido. Lição do diálogo na grokbot-1 (15 out): a prova
  do modelo é o log/cabeçalho, nunca o nome que o modelo dá a si mesmo.
- Troca de modelo no meio da conversa: `setConversationModel` guarda `pendingSwitch {from,to}`
  (transitório) e o próximo turno manda a mensagem do usuário com `note` (campo de `BackendMessage`,
  persistido mas nunca exibido; `toWire` concatena antes do conteúdo). A nota diz ao modelo novo que as
  respostas anteriores foram de outro modelo. Motivo: no teste do usuário o grok-4 disse "na mensagem
  anterior eu respondi errado" sobre uma resposta que era do Claude.

## Status line e seção Fallback (15 out 2026)

- **Tutorial 16 oculto (30 out):** o cartão "Status line do Claude" saiu da lista (`oculto: true` em `lib/tutoriais.ts`; o
  guia, os canais `statusline:*` e o reset continuam no código). O admin instala a status line ao criar a conta
  (`prepararUsuario` → `installStatusLine`, também no "Preparar"): a pessoa não tem passo nenhum. A escolha de segmentos
  deixa de ter tela; o rodapé mostra todos.

- Rodapé da conversa (`#ctx-line`) virou a status line no modelo do `statusline.sh` da box:
  `agente | Ctx: 13% · 3.2k/24.0k | 6.3 s · 258 tok · 41 t/s | m6@… (Premium) | Sessão: 37% · 1h35m |
  Semanal: 37% · 5d0h | há 12 min`. Cores: modelo amarelo, Ctx/Sessão ciano, conta verde, Semanal
  magenta. Conta e limites só aparecem em modelos do Claude (não no grok-4). Puro em
  `lib/status-line.ts` (`buildSegments`, `timeUntil`, `fmtK`, `thresholdToWarn`), testado.
- Dados: `GET /v1/meu-bot/status` nos dois backends (`account-status.js`, cópia idêntica) lê
  `~/.cache/claude-statusline/{profile,ratelimits}.json`, que o statusline.sh do Claude Code interativo
  mantém na máquina; `updated` vira "há N min". O app busca no boot (`backend:account`) e depois de
  cada turno (`chat:account`). Tokens de contexto: `chat:context.tokens/budget` (estimativa do que foi
  enviado); turno: `chat:done.ms/usage` (usage vem do chunk final do SSE).
- Aviso de sessão: ao cruzar 80, 90 e 95% da sessão de 5 h, um aviso amarelo na conversa ativa
  ("Sessão do Claude em 92% … renova em 1h35m"), uma vez por limiar; zera quando a sessão renova.
  Mesma regra do alerta do Hermes no WhatsApp da box, adaptada ao painel.
- Configurações › Fallback: seletor "Primário nesta máquina" (Claude = agente, xAI = grok-4) que é só
  uma cara amigável do "Modelo padrão nesta máquina" (os dois ficam sincronizados), mais a linha da
  reserva calculada da corrente do backend (`providers` do status). O primário gasta o orçamento da
  conta dele; a reserva não consome nada até ser acionada.
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
- Backend do Hermes: pedido direto a `grok-4` passa antes do corte do authDown, e em authDown um
  modelo com reserva (agente → grok-4) cai para ela com aviso em vez de 503. `rene-dm` segue 503
  (fora da corrente), que é o que o Hermes do WhatsApp espera.
- Pegadinha mantida: o login reescreve `settings.json`/`.bashrc` na máquina; o backend não depende
  disso (bypass vai por flag).
- Lista de conversas ganhou três linhas de conta no topo: WhatsApp do Hermes, Claude Code
  (`claudeAuthInfo`: `claude auth status` + e-mail do `~/.claude.json`; "sair" = `claude auth logout`
  e já abre o login) e xAI (Grok) (`src/main/xaiLogin.ts`: `hermes auth status/list/add/logout
  xai-oauth`; o login abre o link de código de dispositivo e espera a aprovação; ao concluir remove
  as credenciais antigas do provedor, porque uma vencida na frente derruba o proxy com invalid_grant).
  Modais: um botão só (Cancelar enquanto roda, Fechar depois), "Começar" some ao concluir e vira
  "Tentar de novo" se falhar; fecham sozinhos no sucesso.
- Pegadinha: `hermes auth add xai-oauth --type oauth --no-browser` sem pseudo-terminal não imprime
  nada e fica parado (o CLI exige tty); o app usa `ssh -tt` com stdin aberto e limpa ANSI/CR da saída.
  Já `claude auth login`, `hermes auth status/list/logout` funcionam sem tty.
- Interface "clean" (15 out, madrugada): ☰ na ponta esquerda da barra; "arquivadas" virou interruptor
  no rodapé da lista; barra superior recolhível (Cmd+Shift+B, botão ⌃/⌄, paleta) com faixa fina
  mostrando máquina · modelo · estado do túnel. Lista e barra começam recolhidas por padrão
  (`localStorage.sidebarShown` / `topbarShown`).

## Grok (xAI) em máquinas sem Hermes (16 out 2026)

- O login por conta da xAI (OAuth) é do Hermes: `hermes auth add xai-oauth --type oauth --no-browser` (link
  de código de dispositivo) e `hermes proxy start --provider xai` (127.0.0.1:8645, aceita qualquer bearer e
  usa o OAuth). Era assim no grokbot. Em colima/agente-box não havia Hermes, então a linha "xAI (Grok)" não
  aparecia e o grok-4 não existia no modo nem no fallback.
- `backend-colima/install-grok-oauth.sh` (idempotente) reproduz o arranjo em qualquer máquina com o backend
  do meu-bot: instala `hermes-agent@0.22.2` (npm, `--prefix ~/.local`, com o node do backend), grava
  `providers.json` com o grok-4 em `http://127.0.0.1:8645/v1` (endpoint local dispensa chave; um
  providers.json alheio vai para `.antes-do-grok-oauth`), cria `meu-bot-xai-proxy.service` (systemd --user,
  `RestartSec=15`: antes do login o proxy sai com "Not logged in" e volta sozinho depois), liga linger e
  reinicia o backend. Até 1/11 a unidade se chamava `hermes-xai-proxy.service`; o nome novo segue o padrão
  `meu-bot-*` das outras unidades do app (a máquina pode ter Hermes, OpenClaw ou os dois; o Hermes é só o
  programa por baixo do proxy). Quem migra a unidade antiga é o `install.sh` do backend (1.9.2), na mesma porta,
  na atualização automática do seletor; o `install-grok-oauth.sh` recusa rodar enquanto a antiga existir. Exige
  `providers.js` no backend: um backend antigo (caso da colima, 16 out) não tem fallback nem grok-4, e "Reinstalar
  backend" no seletor resolve.
- App: a linha "xAI (Grok)" aparece também sem Hermes quando há backend (`xaiKeyStatus`); "entrar" roda o
  instalador pela janela (`xai-login:prepare`, progresso no diálogo) e emenda no login OAuth de sempre
  (`xaiLogin.ts`). A opção de chave de API foi retirada a pedido do usuário (só OAuth); `src/main/xaiKey.ts`
  ficou só com a checagem "há backend?" que decide se a linha aparece. `install-statusline.sh` instala o
  `jq` sozinho quando há `sudo` sem senha (caso da colima).
- Depois do login, o backend lista o grok-4 e ele entra no modo e em Configurações › Fallback. Verificado na
  colima (16 out): login OAuth concluído pelo app; o proxy aceita o id `grok-4` (responde com `grok-4.3`; lista
  também 4.5/4.6/4.7 e os de imagem) e o backend respondeu `X-Provider: grok-4`. O `hermes` precisa do node no
  PATH do ssh sem login (`~/.local/node/bin` do backend, `/opt/node/bin`): `REMOTE_PATH` do `xaiLogin.ts`.
- Tutorial 6 · Fallback: Claude e Grok (17 out; antes "Em breve"): três passos. (1) "As duas contas nesta máquina":
  conclui com `claude.loggedIn && xai.loggedIn` no `GuideContext`. (2) "Escolher primário e reserva" (corpo
  `fallback-order`, `renderFallbackOrder`): o estado das duas contas, o seletor do primário (Claude = agente, xAI = grok-4; o grupo
  Configurações › Fallback que o espelhava saiu em 30 out 2026, o tutorial é o único lugar), salvo na hora com `setSettings({ backendModelForHost })`, a linha da corrente
  (`fallbackOrderText`, pura em `lib/tutoriais.ts`) e "Manter assim" quando o
  primário já está na corrente; conclui com a flag `fallbackChosen` (também gravada ao escolher nas Configurações) e
  o primário em `FALLBACK_PRIMARIES`. (3) "Ver a reserva assumir": a flag `fallbackSeen` é gravada sozinha quando um
  `chat:done` traz `fallback` (a reserva respondeu de verdade) ou pelo botão "Entendi como funciona". `needsXai`
  (some onde o Grok não é possível) e `after: "xai-login"`; "Refazer do zero" só esquece as duas flags.

## Limite do Fable: o turno refaz com o Opus 5.5 (19 out 2026)

- A CLI do Claude Code devolve "You've reached your Fable limit…" como **texto de resposta**. `runClaude` retém as
  primeiras ~120 letras de cada turno até descartar a hipótese (`LIMIT_RE`), então o aviso nunca chega à conversa:
  vira erro `model_limit`. O provedor refaz o mesmo turno com `--model ${MODEL_FALLBACK}` (padrão
  `claude-opus-5-5`, rótulo `MODEL_FALLBACK_LABEL`), emite o chunk de fallback ("Fable falhou (limite de uso da conta; o Opus 5.5 segue por 60 min)", o app
  mostra como os outros fallbacks) e fica no reserva por `LIMIT_HOLD_MS` (1 h) sem tentar o padrão a cada
  mensagem. No reserva, o system prompt diz ao modelo qual ele é. Se o reserva também bater limite, segue a
  corrente normal (agente → grok-4).
- Verificado na `agente-box` com o limite real ativo: resposta veio do Opus 5.5, o aviso de limite não apareceu,
  log "limite do modelo (…); refazendo com claude-opus-5-5".
- (19/10) Status line: o segmento do modelo mostra o nome do modelo que responde de fato (`/v1/meu-bot/status › model`: o reserva durante o limite, senão o `model` do ~/.claude/settings.json da máquina, em nome legível); grok-4 e backend antigo continuam com o modo.
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

- **`link-publico`, number 14, after 1, só em máquina por SSH (`needsXai`):** o link `https://<nome>.<domínio>/` que o
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
  recusar explicando. Segue a corrente do `agente` (Grok de reserva, que não tem ferramentas).
- **Quem chama:** o Hermes, com `model.default: whatsapp` no config.yaml, só quando o backend da máquina é 1.3.0+
  (`HERMES_WA_ENSURE_SH`; antes disso fica `agente`). O OpenClaw segue com a trava dele (`tools.toolsBySender`).
- **Limite:** no Hermes o nível vale para todas as conversas do WhatsApp dele (quem fala é a allowlist do Hermes); não há
  trava por remetente como no OpenClaw.
- **Backend como root:** o Claude Code recusa `--dangerously-skip-permissions` como root; na meu-root todo turno do
  agente caía no Grok. O backend passa `IS_SANDBOX=1` quando roda como uid 0 no modo sem permissões.
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
