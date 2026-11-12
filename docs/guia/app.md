# App: variantes, canais, atualização, produtos, onboarding e tutoriais

> Parte do diário técnico do meu-bot, dividido por assunto em 27 out 2026. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

## Controle externo (MCP) embutido no app (6 nov 2026)

Desenho do Remote Control do Rambox (lido do `app.asar` dele; os textos da tela são nossos): um servidor MCP
**dentro do processo principal**, para um cliente MCP deste Mac (Claude Code, Cursor) usar o app sem precisar do
repositório clonado nem de `node` instalado. O `scripts/app-mcp.mjs` continua como caminho stdio (Claude Desktop,
ou quando o app está fechado: `apps`/`app_abrir`) e tem as mesmas ferramentas. A configuração ainda é feita no
cliente (um `claude mcp add` ou um trecho de `mcp.json`); o app só gera o texto certo, com variante, porta e chave.

- **Rotas do app no `term.sock`** (`term-api.ts`): `GET /app`, `POST /janela`, `/pagina` (evento novo `ui:abrir-pagina`),
  `/tema`, `/print` (`capturePage`, ≤ 1280 px); e `POST /fechar {id}` encerra um terminal (`terminal_fechar`, destrutiva).
  `/nota` devolve `visivel: false` com o modo de depuração desligado (foi só ao log). Servem ao `app-mcp.mjs` e ao servidor embutido, que repassa **tudo**
  pelos sockets (`term.sock`, `nav-<máquina>.sock`) com `X-Meu-Bot-Dono`; o cliente diz o nome em `X-Meu-Bot-Cliente`
  e o selo fica "Cursor (MCP) · digitou". Posse de abas e registro de depuração continuam os mesmos.
- **Servidor** (`src/main/controle-remoto/controle-remoto.ts`): HTTP em `127.0.0.1:<porta>`, só `POST /mcp` (GET,
  DELETE e OPTIONS → 405: sem SSE, sem sessão, sem CORS), `Authorization: Bearer <token>`, `Host` e `Origin` só no
  loopback (anti DNS rebinding), corpo ≤ 1 MB. **Nenhum cabeçalho CORS**: o `corsHeaders` do CRM fica fora de
  propósito (de nada adiantaria checar Origin e depois liberar `*`). Porta ocupada vira `erro` no estado.
- **Protocolo** (`controle-remoto-core.ts`, puro e testado): revisão 2025-06-18 do MCP; anuncia a do cliente se a
  conhece (2024-11-05, 2025-03-26, 2025-06-18), senão a nossa mais nova. Sem lote JSON-RPC (saiu do MCP nessa
  revisão: array → -32600). Sem `structuredContent` (não declaramos `outputSchema`; o resultado é texto JSON, e
  `png_base64` vira `content` de imagem). `initialize`, `ping`, `tools/list`, `tools/call`, notificações → 202.
- **Dois interruptores**: ligar/desligar o servidor, e "Executar comandos e código", que libera `terminal_digitar` e
  `nav_js` (execução arbitrária em sessões já logadas; o Rambox deixa o equivalente fora do build de produção).
  Desligado, elas nem aparecem em `tools/list` e a chamada volta `isError`. A chave **fica guardada ao desligar**
  (religar não obriga a reconfigurar os clientes); "Gerar outra" é o que invalida.
- **Configuração** (`settings.json`: `mcpLigado`, `mcpExecucao`, `mcpPorta` null = padrão da variante, `mcpToken`) e
  porta por produto (`Produto.portaMcp`: 7830 meu-bot, 7831 staging, 7832 finance-staging, 7833 admin, 7834 admin-mac;
  fora da 7822 do Rambox). IPC `controle-remoto:status|ligar|execucao|porta|regenerar` (shared);
  `controle-remoto:changed` repinta as outras janelas.
- **Tela** (`renderer/configuracoes/controle-remoto.ts`, grupo `#mcp-group`): os dois interruptores, status, chave
  mascarada (Mostrar/Copiar/Gerar outra), porta (aplica no change) e os botões que copiam o `claude mcp add
  --transport http …` e o trecho do `mcp.json` do Cursor. Claude Desktop ficou de fora (o conector remoto dele não
  aceita cabeçalho fixo; para ele é o `app-mcp.mjs`).
- **Botão Instalar** (`controle-remoto/clientes-mcp.ts`, 12 nov 2026; desenho do "Install" do Perssua, lido com o REA):
  no Claude Code roda o próprio CLI, `claude mcp add-json --scope user <nome> {type:"http",url,headers}` (o CLI é o
  dono do `~/.claude.json`; o app não o escreve), e no Cursor abre `cursor://anysphere.cursor-deeplink/mcp/install`
  (a pessoa confirma lá; o app não escreve o `mcp.json` dele). O estado vem de `estadoCliente` (puro), que compara url
  e chave, e não só o nome: "Gerar outra" ou trocar a porta vira **desatualizado**, e Atualizar faz `remove` + `add-json`
  (o `add-json` recusa nome existente). A entrada leva `X-Meu-Bot-Cliente`, então o selo diz "Claude Code (MCP)". O
  `claude` vem do `findClaude` (achado fica em cache; "não achei" vale 1 min) e roda com a pasta dele no PATH (o
  instalado pelo npm é `#!/usr/bin/env node`). Sem `claude`, o "Copiar comando" (agora com `--scope user`) é o plano B.
- **Fumaça com cliente real** (`scripts/mcp-fumaca.sh [app]`): com o app aberto e o controle ligado, lê porta e chave
  do `settings.json`, confere por `curl` (initialize anuncia 2025-06-18, `tools/list` com ≥ 20 ferramentas, GET → 405,
  sem chave → 401), registra `<app>-fumaca` no Claude Code em escopo local e exige `✔ Connected`; remove o registro ao
  sair, mesmo em falha. É o que roda quem mexer no protocolo ou no `term.sock`; o teste unitário cobre só o núcleo puro.

## Modo de depuração: selo ao lado do PRO, ferramenta `nota` e a skill (1 nov 2026, fase 3)

- **Selo "DEPURAÇÃO"** ao lado do PRO nas duas barras (`#dep-badge`, `#mini-dep`): apagado em cinza com o modo
  desligado, aceso com ele ligado; o clique alterna para todas as janelas (o mesmo `depuracaoLigar` da paleta) e um
  toast curto diz o que a faixa mostra. No staging nasce aceso. Some em janela estreita junto com o PRO.
- **app-mcp**: ferramentas `nota {texto}` (→ `POST /nota`) e `depuracao {on}` (→ `POST /depuracao`): o Claude Code
  anuncia na faixa o que vai fazer e liga o modo de fora.
- **Skill `testar-no-app`**: passo 0, ligar o modo e anunciar cada passo com `nota`; faixa vermelha = main preso.

## Modo de depuração: o fluxo de ações e a `nota` (1 nov 2026, fase 2)

- **O que entra no fluxo:** cada pedido que chega pelos sockets de controle, com sucesso ou erro, no `handle()` de
  `nav-api.ts`, `gmail-api.ts` e `term-api.ts`: `registrarAcao({ origem, dono, rota, corpo, t0, resultado | erro })`
  (`app/depuracao.ts`). O resumo por rota é puro (`app/depuracao-core.ts`, testado): "`https://… → aba 5 (nova)`",
  "`fechou a aba 5 → recarregou [4]`", "`busca "from:ana" → 3 mensagens`", "`digitou 6 caracteres no t1 + Enter`". O
  detalhe (JSON na faixa) é o pedido com textos cortados em 200 caracteres e sem payload de `/ler` e `/print`.
  Sondas (`/abas`, `/terminais`, `/status`, `/diag`) entram uma vez a cada 30 s por rota; as outras só no log. As
  linhas dos instaladores (`navegador:progress`, `crm:progress`…, `client.ts`) entram como origem `hook`.
- **Rotas novas no `term.sock`:** `POST /nota {texto}` (quem dirige o app de fora anuncia o que vai fazer; aparece
  destacada na faixa) e `POST /depuracao {on: true|false|null}` (liga/desliga; sem `on`, só consulta).
- **Na faixa:** o centro mostra a última ação; clicar abre a lista das últimas 6 (mais nova primeiro), cada uma com o
  JSON do pedido; erro em vermelho, nota em destaque. `--depuracao-travar` passou a valer só no canal staging:
  produção não tem botão de travar.

## Modo de depuração: faixa no topo com build, batimento do main e túnel (1 nov 2026, fase 1)

- **Por quê:** em 31 out, depurando o app de fora, fiquei cego duas vezes: o build instalado não era o meu, e o
  processo principal travou num diálogo do Chaveiro ("meu-bot Safe Storage") sem que a tela dissesse nada. A
  informação existia no app e não estava visível.
- **O que é:** `#depuracao-bar` (`src/renderer/depuracao/faixa.ts`, molde da faixa OFFLINE): esquerda o build
  ("v0.4.0 · branch · commit", de `Resources/build.json`, que o `package.mjs` grava com `git rev-parse`/`branch`;
  em dev, "dev"); centro a última ação que chegou de fora (a fase 2 traz o fluxo inteiro); direita a saúde: "main ok"
  ou, em vermelho, "main sem responder há N s · última marca: …", mais o túnel e os reversos (`nav :porta ·
  gmail :porta`). Regra pura e testada em `lib/depuracao-core.ts`.
- **Batimento:** `src/main/app/depuracao.ts` faz `broadcast("depuracao:batimento")` a cada 1 s. Uma chamada síncrona
  (safeStorage com o diálogo do Chaveiro na tela, spawn do ssh) prende o fio de JS do main e o tique para junto; a
  janela acusa com mais de 3 s sem tique. `marcar(texto)` anuncia a próxima chamada síncrona (antes de
  `safeStorage.decryptString` em conta-google, senha-backup e secrets; antes dos `spawn` do ssh em tunnel.ts), então a
  última marca já está na janela quando o main trava. `--depuracao-travar=<ms>` (só com o modo ligado) prende o
  main de propósito 10 s depois de subir, para conferir que a faixa acusa e volta.
- **Ligado onde:** `--depuracao` força neste processo; senão o gravado (`settings.depuracao: true|false|null`,
  paleta "Modo de depuração: ligar/desligar", vale para todas as janelas); senão o padrão da variante: ligado no
  staging (`caps().canal === "staging"`). IPC: `window:info` traz `depuracao` e `compilacao`; canais
  `depuracao:estado`/`depuracao:ligar`; eventos `depuracao:batimento`, `depuracao:estado`, `depuracao:evento`.
- **A trava do Chaveiro, corrigida na raiz:** `conta-google.ts` decifra cada arquivo de token uma vez e lembra em
  memória (`decifrados`; gravar/apagar invalida; falha ao decifrar não entra no cache). Antes, `contaStatus(host)`
  decifrava a cada sonda do socket do Gmail e a cada religamento, e cada build ad-hoc novo reabria o pedido de senha.
  **Preparar máquina de desenvolvimento:** rodar uma vez `node scripts/assinatura.mjs --criar` (certificado local
  "meu-bot local"); sem ele a assinatura muda a cada build e o macOS pede a senha de novo.

## Fluxo: worktree por PR, conferência pelo DevTools remoto, rebuild enxuto e lembrete de PR (31 out 2026)

- **O que aconteceu nas PRs #48 a #54:** duas sessões (Claude e Cursor) no mesmo checkout trocavam de branch uma
  debaixo da outra, e o hook de rebuild de qualquer uma reempacotava os quatro apps a partir do branch em que o checkout
  estivesse, sobrescrevendo o build da outra em `~/Applications`. Uma conferência na tela foi feita contra o build
  errado. A skill `testar-no-app` não conseguia clicar (Acessibilidade negada ao `osascript`, erro -25211). E cada fase
  de refatoração empacotava quatro variantes para ser sobrescrita minutos depois.
- **Worktree por PR** (`CLAUDE.md`, skill `contribuir`): mudança que vira PR nasce em `../meu-bot-<nome>` a partir de
  `origin/main`; o checkout principal não troca de branch. O que o worktree precisa para empacotar: symlink de
  `node_modules` e `extensao-crm/node_modules`, cópia de `build/suporte` (o `suporte.json` do admin) e de `build/extensao-autenticador` (o `build:extensao` recusa
  symlink) e dos `config/google-*oauth.json`.
- **Conferência pelo DevTools remoto** (skill `testar-no-app`, `scripts/devtools.mjs`): lançar o binário instalado com
  `--remote-debugging-port` e dirigir o renderer (`paginas`, `eval`, `console`); antes, `grep -a` no `app.asar` para ter
  certeza de que o instalado é o seu build. Seletores úteis estão na skill.
- **Rebuild enxuto** (skill `rebuildar`): mudança sem efeito visível empacota só a variante que vai ser conferida.
- **Lembrete de PR** (`scripts/hooks/pr-lembrete.sh`, segundo hook `Stop` em `.claude/settings.json`): ao fim de cada
  resposta, varre o checkout e os worktrees; branch ≠ `main`, árvore limpa, commits à frente de `origin/main`, último
  commit com menos de 1 h e sem PR aberta → devolve `decision: block` com a razão, e a sessão abre a PR pela skill
  `contribuir`, com o corpo certo. Não publica nada por conta própria; lembra uma vez por (branch, commit)
  (`.claude/.pr-check-*`, fora do git); `stop_hook_active` evita o loop; `--check` mostra o que faria. Ficam de fora os
  branches de `.claude/pr-lembrete-ignorar` (ex.: `local-teste`) e os que terminam num merge (integração local).
- **Fora desta mudança, em issue para o Diego:** fazer o hook de rebuild empacotar só a partir do `main` atualizado,
  num worktree fixo, em vez do branch em que o checkout estiver.

## Tutorial 16 "Gmail (Pro)" pela receita nova (31 out 2026, fase 5 da reorganização)

- **O que é:** o primeiro tutorial feito pela receita "Como adicionar um tutorial" do `ARQUITETURA.md`: três arquivos
  (`lib/tutoriais.ts`, `gmail/gmail-guia.ts`, uma linha no `renderer.ts`) e o teste. Cinco passos: ter o Pro (pela
  licença, com "Pedir o Pro ao admin"), conectar a Conta Google (abre a página dela), ler uma mensagem, buscar na
  sintaxe do Gmail, mandar para a lixeira e desfazer. Os três últimos são fatos que a própria página Gmail conta ao
  guia (`GmailDeps.aoUsar` → `gmailGuiaFato`) e ficam lembrados (`lembrar`); cada um tem também o botão manual dos outros
  tutoriais ("Li uma mensagem", "Fiz uma busca", "Testei, funcionou": flags `gmailLido`, `gmailBuscou`, `gmailLixeira`),
  para quem fez no Gmail de fora ou quando o fato não chega ao guia (5 nov 2026). Conta de antes da lixeira
  (`gmailEscreve === false`) vê no passo 5 o aviso para reconectar uma vez.
- **Renumeração:** o Gmail entra como **16**, depois de 15 Entrada rápida (trilha: `after: "claude-login"`); os
  ocultos passam a 17 (status line) e 18 (CRM, nas duas versões); em 3 nov, com o "Ouvir áudios" fora (o Gmail
  virou 15), o 16 "Digitando… no WhatsApp" entrou depois do 3 e os ocultos foram para 17 e 18 (docs/guia/whatsapp.md). O mapa antigo → novo da seção de 31 out continua
  valendo para os 15 primeiros.
- **Fonte `google`:** `known` = a Conta Google da máquina já respondeu (`googleContaStatus`, mais o evento
  `google-conta:changed`); `access` pela licença como o Navegador. `refreshGmailGuia` roda no boot e ao abrir o guia.
- O passo do tutorial 18 (CRM no Gmail) que abre o Gmail web no Navegador foi renomeado para não confundir com a
  página Gmail: "Abrir o Gmail web no Navegador (com a barra do CRM)".

## Guia: `GuideContext` fatiado por fonte (31 out 2026, fase 4 da reorganização)

- **Problema:** `guideCtx()` em `guia-secoes.ts` montava o contexto inteiro do guia (15 fontes) lendo estado de três
  donos diferentes, e era remontado várias vezes por pintura (uma por guia aberto, mais uma em `lembrarFeitos`).
  Adicionar uma fonte exigia mexer lá, além do módulo dono.
- **Agora:** `tutoriais/fontes.ts` é um registro fonte → fatia (`registrarFonte`, `montarGuideCtx`,
  `conferirFontes`), sem import de domínio. Cada módulo registra a própria fatia no `ligar…()` dele, ao lado do
  `refresh…` que a preenche: `{ known, dados }`, com a condição de "conhecida" que antes estava em `guideCtx`.
  `CAMPOS_POR_FONTE` diz que campos cada fonte preenche (teste puro: cada campo tem exatamente uma dona; `produto`
  ficou com o CRM). `ehRemoto()` em `app/ctx.ts` substitui o `remote` que oito fontes recalculavam.
- **Onde cada fatia mora:** claude, xai e fallback em `agente/contas-agente.ts` (com `firstReplyOnHost`, que saiu do
  guia-secoes); whatsapp em `agente-whatsapp.ts` (só `known`: o status vai ao guia por fora); objective, guarda,
  navegador, crm (+ produto), grupos, contas, linkpublico, quickentry e finance nos `*-guia.ts` e módulos de domínio
  respectivos; statusline e support ficam em `guia-secoes.ts` (269 linhas agora).
- **Pintura:** `paintGuide()` monta o contexto uma vez e passa para `lembrarFeitos` e para o título de cada guia aberto.
- **Guarda:** no fim do `renderer.ts`, `conferirFontes()` acusa no console fonte sem registro, como `conferirPassos`.
  Receita completa de "Como adicionar um tutorial" entrou no `ARQUITETURA.md`.

## Guia: um dono por peça (31 out 2026, fase 3 da reorganização)

- **Problema:** `tutoriais/guia-secoes.ts` tinha 790 linhas com os passos de sete assuntos diferentes (objetivo,
  fallback, Navegador, link público, contas CLI, guarda, entrada rápida), o estado do objetivo e o catálogo da página
  Tutoriais moravam no `renderer.ts`, e `refreshObjective` estava no Acervo. Não havia critério de onde pôr uma peça.
- **Critério (agora no `ARQUITETURA.md`):** a tela de um passo mora em `<domínio>/<x>-guia.ts`, junto do estado e do
  `refresh…` que ela lê, e o módulo registra os seus bodies no próprio `ligar<X>Guia()`. Em `tutoriais/` fica só o
  motor; em `renderer.ts`, só a chamada `ligar<X>Guia()`.
- **Movimentos:** `navegador/navegador-guia.ts` (Navegador ×3, `navInstState`, `refreshNavInst`, `abrirLinkDoChat`,
  evento `navegador:progress`), `agente/objetivo-guia.ts` (objetivo ×3 + `objectiveState/Msg/Draft` com setters +
  `refreshObjective`/`objectiveDo`, antes no renderer e no Acervo), `agente/link-publico-guia.ts`,
  `agente/contas-cli-guia.ts` (contas + evento `contas:evento` + "Entrar no Cloudflare"), `whatsapp/guarda-guia.ts`
  (+ `guardaMsg`, antes no renderer), `configuracoes/entrada-rapida-guia.ts`, `fallback-order` para
  `agente/contas-agente.ts`, e o catálogo da página Tutoriais (`tutoriaisPage`, `tutNext`) para
  `tutoriais/catalogo.ts` com `ligarCatalogo()`. `guia-secoes.ts` ficou com `guideCtx()`, suporte e status line
  (319 linhas) e importa dos donos o estado que o contexto lê (`navInstState`, `guardaState`, `contasState`,
  `linkPublico*`). O `crm-guia` importa `renderNavOpen`/`navInstState` direto do Navegador, sem passar pelo `ctx`.
- **Regra do ARQUITETURA respeitada:** estado que outro arquivo grava ganhou função (`setObjectiveState`,
  `setGuardaMsg`, `setTutNext`); os getters/setters do `ctx` apontam para elas, então `ctx.objectiveState = …`
  continua valendo onde já era usado. Nada novo entrou no `ctx`; saíram `renderNavOpen` e `navInstState`.
- Comportamento igual na tela; `npm test` segue verde (841).

## Guia: registro de passos no lugar da cadeia de `if/else` (31 out 2026, fase 2 da reorganização)

- **Problema:** `tutoriais/tutoriais.ts` desenhava o corpo de cada passo com 44 ramos `else if (step.body === …)`,
  quase todos chamando um `ctx.renderXxx` definido em outro módulo e exposto no `ctx` só para fugir do import
  circular. Para entender o passo do CRM eram quatro arquivos (definição, cadeia, `crm-guia.ts`, `ctx`).
- **Agora:** `tutoriais/passos.ts` é um registro `body → renderizador` (`registrarPassos`, `renderPasso`,
  `conferirPassos`), sem import de módulo de domínio (não há ciclo). Cada módulo registra os seus bodies dentro do
  próprio `ligar…()`: `contas-agente` (login do Claude, xAI, contas), `agente-whatsapp` (agente, quem responde, áudio),
  `grupos` (novo `ligarGrupos`), `crm-guia`, `financeiro-guia` (novo `ligarFinanceiroGuia`) e `guia-secoes` (o resto).
  Os ramos que eram código solto na cadeia viraram funções nomeadas no módulo dono (`renderClaudeLoginPasso`,
  `renderReplyChoicePasso`, `renderCloudflareEntrar`).
- **O que não mudou:** um renderizador pode devolver `false` ("não desenhei") e o guia cai para o botão de ação do
  alvo, como a cadeia fazia quando o `reply-choice` ainda não tinha o status do WhatsApp; o QR inline do pareamento
  e o botão de ação continuam em `renderGuide`. O painel do tutorial concluído (cadeia por `t.id`) fica para depois.
- **Guarda:** no fim do `renderer.ts`, depois do último `ligar…()`, `conferirPassos(TUTORIAIS)` acusa no console
  qualquer body sem renderizador; um body sem registro mostra "Este passo ainda não tem tela nesta versão do app".
  Saíram 27 getters `render*`/`clGuide`/`xaiGuide`/`paintXaiLogin`… do `ctx` que só a cadeia usava.
- Teste: `tutoriais.test.mjs` registra stubs para todos os bodies e confere `conferirPassos`, o erro ao repetir e o
  `false`.

## `lib/tutoriais.ts` fica só com o motor dos tutoriais (31 out 2026, fase 1 da reorganização)

- **Problema:** o arquivo puro dos tutoriais carregava 20 exports que não são tutorial, só porque o guia foi o
  primeiro a precisar deles: política de resposta do WhatsApp (cartões, `replyChoiceOf`, `listedNumbers`,
  `parseWaNumbers`), grupos (`grupoAlvo`, `quemResumo`…), fallback de modelos (`FALLBACK_PRIMARIES`,
  `fallbackOrderText`) e objetivo (`OBJECTIVE_OPTIONS`, `LEVEL_OPTIONS`). Quem mexia na regra do WhatsApp abria o
  arquivo dos tutoriais.
- **Agora:** cada regra tem o próprio arquivo puro em `src/renderer/lib/`: `whatsapp-resposta.ts`,
  `whatsapp-grupos.ts`, `fallback.ts` e `objetivo.ts`, com teste próprio em `scripts/tests/` (`whatsapp-resposta`,
  `whatsapp-grupos`, `fallback`, `objetivo`). `lib/tutoriais.ts` importa de volta só o que os passos usam
  (`grupoAlvo`/`nomeDoGrupo`/`quemResumo`/`quemEscolhido`, `FALLBACK_PRIMARIES`, o tipo `FallbackProvider`) e não
  reexporta nada: quem precisa da regra importa do arquivo dela. Comportamento igual; só mudou o endereço.
- **Plano completo da reorganização** (fases 2 a 5: registro de passos no lugar da cadeia de `if/else`, um dono por
  peça de guia, `GuideContext` fatiado por fonte, tutorial do Gmail pela receita nova): seção "Como adicionar um
  tutorial" do `ARQUITETURA.md` quando as fases entrarem; até lá, o critério está nas PRs de cada fase.

## Tutoriais renumerados na ordem da trilha (31 out 2026)

- **Problema:** a lista de Tutoriais sai na ordem do array `TUTORIAIS`, mas os números eram fixos de quando cada um
  nasceu (os desmembrados ganharam 15 e 16 e ficaram logo depois do 1 e do 2). Na tela saía 1, 15, 2, 16, 5, 7, 9,
  12…, e os dois tutoriais de CRM dividiam o 10 sem haver 11. Confuso, principalmente nos arquivados do root.
- **Agora:** número = posição na trilha. Os que podem aparecer na lista são 1..15 sem buraco (o que some numa máquina
  é só o que ela não oferece: Grok, suporte, guarda, financeiro, link público). Os `oculto` por decisão de produto foram
  para o fim do array e da numeração: 16 (status line) e 17 (CRM, nas duas versões excludentes, Gmail e Streak).
  O teste "trilha numerada" trava a ordem, a contiguidade dos visíveis e o array ordenado.
- **Mapa antigo → novo** (o diário abaixo desta seção já usa os números novos; commits, issues e PRs anteriores a
  31 out usam os antigos): 1→1 Entrar no Claude · 15→2 Mais contas do Claude · 2→3 WhatsApp · 16→4 Ouvir áudios ·
  4→5 xAI · 5→6 Fallback · 6→7 Suporte · 7→8 Objetivo do WhatsApp · 8→9 Guarda · 9→10 Navegador · 12→11 Grupos ·
  13→12 Contas na máquina · 14→13 Financeiro · 17→14 Link público · 18→15 Entrada rápida · 3→16 Status line (oculto) ·
  10→17 CRM no Gmail e CRM pelo WhatsApp (ocultos). O 11 antigo ("Extensões no Navegador") já tinha sido removido.
- Toda menção "tutorial N" em `src/`, `scripts/`, `docs/` e nos textos da tela foi trocada pelo mapa; o `number` é
  usado só como rótulo (`tutorialBadge`, `guideTabTitle`, `tutorialNumber`), o progresso para o admin vai por id.

## Tutorial 4 "Ouvir áudios" sai: o áudio é da máquina (3 nov 2026)

- **Problema:** clicar em "Responder em áudio" numa box sem ffmpeg dava "ffmpeg não encontrado … (apt install
  ffmpeg)", um apt que a pessoa não consegue rodar (sem root), e o painel mandava para o "Tutorial 4 · 0 de 2", que
  pararia no mesmo ffmpeg. O `ensureTranscription` já ligava a transcrição sozinho depois de parear, mas no OpenClaw
  ele criava um venv por usuário (~500 MB) que exige ffmpeg; a falha ficava numa linha de log que ninguém via.
- **Agora, a máquina:** o transcritor compartilhado do root (`/opt/transcriber`, `transcritorSh`) ganha o
  `bin/transcrever-texto` (imprime o texto; é o `cli` de `tools.media.models` do OpenClaw) ao lado do `bin/transcrever`
  do Hermes; decodifica pelo PyAV, sem ffmpeg. O item "Transcritor de áudio" de Preparar máquina deixa de depender do
  Hermes global (`TRANSCRITOR_ESTADO_SH`; máquina preparada antes acusa "aplicar de novo"). O
  `install-transcricao.sh` prefere o compartilhado (nada baixado; o venv antigo do usuário sai) e só cai no caminho por
  usuário quando ele não existe; sem ffmpeg e sem sudo sai com **3** (como o `install-tela.sh`), e o `install-voz.sh` idem.
- **Agora, o app:** o status do WhatsApp traz `audioMaquina` (a máquina tem o transcritor do root ou o ffmpeg;
  `transcritor-core.ts`, sonda nos dois motores), `audioDesligado` (marca `~/.local/share/meu-bot/audio-desligado`,
  criada ao desligar e apagada ao ligar: o app não religa o que alguém desligou de propósito), `audioLigando` e
  `audioErro`. O cliente registra um observador do `whatsapp:status` (`setObservadorStatus` em `ipc/shared.ts`): a
  cada leitura, se conectado, com a capacidade `audio`, `audioIn` false, a máquina pronta e sem a marca, chama o
  mesmo `ensureTranscription` (uma vez por máquina por sessão quando falha). Quando o admin prepara a máquina, a leitura
  seguinte liga sozinha. O admin não registra observador: ele lê a máquina da pessoa, não instala nela.
- **Tela:** a linha "Ouvir áudios" mora no painel de gerência do tutorial 3, antes de "Responder em áudio", e decide por
  `estadoOuvir` (`lib/audio-ouvir-core.ts`, molde do Computador): ✓ ativo · ligando sozinho · "A transcrição precisa do
  admin para ligar" (com "Conferir de novo") · o botão "Ativar transcrição" de reserva, com o motivo da falha
  automática. No admin, "Ativar transcrição" some quando a máquina não tem o necessário e a nota aponta Preparar máquina.
- **Tutorial 4 sai e a trilha é renumerada** (número = posição; nada persiste por número, tudo por id):
  1→1 Claude · 2→2 Mais contas · 3→3 WhatsApp · 4 (Ouvir áudios) sai · 5→4 xAI · 6→5 Fallback · 7→6 Suporte ·
  8→7 Objetivo · 9→8 Guarda · 10→9 Navegador · 11→10 Grupos · 12→11 Contas na máquina · 13→12 Financeiro ·
  14→13 Link público · 15→14 Entrada rápida · 16→15 Gmail · 17→16 Status line (oculto) · 18→17 CRM (ocultos).
  Toda menção "tutorial N" em `src/`, `backend-colima/` e `scripts/tests/` foi trocada pelo mapa (e as que já
  estavam desatualizadas, acertadas); o diário abaixo mantém os números da época.

## Configurações enxutas e tutorial 15 "Entrada rápida" (30 out 2026)

- **Saíram das Configurações** (pedido do produto: a pessoa leiga não deve mexer nisso): Conexão (modelo padrão e porta
  do backend), Aparência e avisos (tema, zoom, notificações), Entrada rápida (interruptor e atalho) e Inicialização
  (abrir ao entrar no Mac). Ficaram só Segurança, Sobre e atualização, Suporte e Sua conta. O `Salvar` manda um
  `setSettings({})` e fecha; os campos removidos continuam no `settings.json` e nos tipos (`SettingsView`/`SettingsUpdate`),
  só a tela não os oferece mais.
- **Onde cada coisa ficou:** o modelo de cada conversa continua no seletor da caixa de texto; a porta do backend é
  ajustada pelo seletor de máquinas; a paleta (Cmd+K) ganhou "Backend desta máquina" (modelo padrão · porta), que mostra
  um toast com a informação, acessível pelo chat; o zoom segue no menu Visualizar, na paleta e no segmento do rodapé;
  o tema fica no valor gravado (`system` por padrão). O tutorial 6 (fallback) lia o `<select>` do modelo das
  Configurações e agora lê `ctx.settings.backendModelForHost`.
- **Entrada rápida sempre ativa:** `getQuickEntry()` devolve `enabled: true` ignorando um `false` gravado por versões
  antigas. O gravador de atalho virou o tutorial 15 (`entrada-rapida`, after 1, fonte `quickentry` = as configurações
  chegaram): passo 1 "Escolher o atalho" (`quick-atalho`: o campo salva a combinação na hora e mostra ativo / em uso /
  inválido; concluído com `quickEntryStatus === "registered"`), passo 2 "Mandar uma mensagem pela janela flutuante"
  (`quick-testar`: botão "Mostrar a janela flutuante"; a flag `quickUsado` é gravada quando `ui:quick-submit` chega,
  com "Funcionou" de fallback; `lembrar`).
- **Interruptores travados por enquanto:** "Avisar pelo meu WhatsApp" (Segurança) e "Atualizar sozinho quando o Mac
  estiver ocioso" (Sobre) aparecem ligados e desabilitados. O main devolve `atualizarOcioso: true` sempre
  (`getAtualizarOcioso`); ao abrir as Configurações, uma máquina com o aviso desligado é religada (`setAlertPrefs`).

## Onboarding guiado (15 out 2026)

- Quando a janela abre sem nenhuma conversa na máquina e `settings.onboarding === "pending"`, em vez
  de criar a conversa automática aparece um cartão flutuante no alto da área de conversa
  (`#onboard`). Cinco passos, cada um é uma ação da pessoa que o renderer detecta: abrir a lista (☰/Cmd+B),
  abrir e fechar a paleta (⌘K, Esc), abrir e fechar as Configurações, criar a conversa (Novo/Cmd+T) e
  enviar a mensagem de exemplo, que já nasce na caixa de texto (`EXAMPLE_MESSAGE`).
- "Pular" em qualquer passo marca `skipped` e cria a conversa normal. Enviar a mensagem marca `done`.
  A flag vive em `settings.json` (`settings-normalize.ts`, `settings:set` só aceita done/skipped), nunca
  em `conversations.json`, porque não é dado de conversa.
- Feedback de cada passo é sorteado em `lib/onboarding.ts` (`pickFeedback`): 40 % frase curta, 30 % ícone,
  30 % nada; nunca repete o anterior e dois "nada" seguidos viram ícone. Máquina de estados pura
  (`advanceOnboard`), testada em `onboarding.test.mjs`.
- Para ver de novo: `"onboarding": "pending"` no `settings.json` e abrir uma máquina sem conversas.
- Abertura (`#intro`, `playIntro`): só na primeira vez (`localStorage.introSeen`; respeita
  prefers-reduced-motion). "meu-bot" discreto no centro → pill da máquina se materializa abaixo →
  backend e túnel lado a lado, mais rápido → o túnel acende verde com um pulso curto e segura. Espera o
  túnel real ficar pronto por no máximo 500 ms; se não, mostra o estado real (amarelo) e some. ~1,5 s,
  2 s no pior caso. Roda antes do onboarding, cobrindo a janela enquanto as abas voltam.
- Onboarding reduzido a 4 passos: criar a conversa pelo botão Novo já envia a primeira mensagem sozinho
  (`sendText(tab, EXAMPLE_MESSAGE)`) e o cartão vira a transição final (`FINAL_MESSAGE`, 3,2 s).
  Cmd+K agora fecha a paleta também (o `stopPropagation` do input engolia o atalho global); Cmd+, abre e
  fecha as Configurações (`openSettings`, `dialog.open`).
- Paleta: "Rever onboarding e abertura" limpa `introSeen`, grava `onboarding: pending` (o `settings:set`
  passou a aceitar "pending") e inicia o onboarding na janela atual, mesmo com conversas. A abertura
  toca na próxima janela que abrir.
- Cmd+, saiu do keydown do renderer (não funcionou para o usuário) e virou item de menu nativo
  "meu-bot › Configurações…" (`menu.ts`, acelerador tratado pelo Electron) → `ui:toggle-settings` na
  janela de máquina focada → abre ou fecha o `<dialog>`. Seletor e alívio ignoram.
- Onboarding, passo "Primeira conversa": o botão Novo recebe `.attention` (pulso na cor de destaque)
  até ser clicado; sem movimento, vira um anel fixo.
- Atalho de conversa nova: Cmd+T virou Cmd+N (Cmd+Shift+N continua sendo a janela nova, pelo menu).
- Abertura animada virou opção: caixinha "abrir direto" no rodapé do seletor (`settings.openDirect`,
  padrão true = sem abertura). Desmarcada, a abertura toca toda vez que uma janela abre. O `introSeen`
  do localStorage saiu; a ação da paleta virou só "Rever onboarding".
- Caixinha "onboarding feito" no rodapé do seletor (`settings.onboarding`): marcada = done, respeita;
  desmarcada = pending, força o onboarding na próxima janela de máquina, mesmo com conversas (as abas
  voltam por baixo do cartão). O renderer começa o onboarding sempre que a flag está pendente.
- "onboarding sempre" foi removido no mesmo dia (o usuário não gostou). Rodapé do seletor ficou com
  três controles curtos: ⇅ sincronizar ssh e dois interruptores (15 out, mesmo `.switch` da lista):
  "Intro" (ligado = abertura animada; grava `openDirect` invertido) e "Onboarding" (ligado = guia na
  próxima janela; grava `onboarding` pending/done invertido). Ligado = tem. O `label.switch` precisa de
  `-webkit-app-region: no-drag`: o seletor inteiro é região de arrasto e o clique no rótulo virava arrasto.
- Onboarding: "pular" virou texto pequeno em cinza (não se clica por reflexo); pular mostra o cartão
  "Onboarding pulado" por 4,5 s com o caminho para refazer (`SKIPPED_MESSAGE`). A lista de conversas
  entra deslizando com um brilho azul (`.sidebar.reveal`), para quem aperta Cmd+B olhando o teclado.

## Mapa de variantes: meu-bot e meu-bot-admin (16 out 2026)

Um código, dois apps. O que muda por variante mora em lugares conhecidos; o resto é comum. Pergunta que o
mapa responde ao abrir um arquivo: isto é admin, cliente ou dos dois?

| Onde | Variante | O quê |
|---|---|---|
| `src/main/variant-core.ts` | comum (puro) | `resolveVariant` (variant.json / `MEU_BOT_VARIANT`) e `capsFor` → `Capabilities` (`chat`, `pair`, `login`, `manageWa`, `tunnel`, `install`, `supportClient`, `supportAdmin`). Testado. |
| `src/main/variant.ts` | comum | `appVariant()`, `caps()`, `isAdmin()`, `appTitle()`: só a leitura do arquivo e o cache. `isAdmin()` não aparece em mais nenhum lugar do main. |
| `src/main/ipc-policy.ts` | comum (puro) | `SHARED_CHANNELS`, `CLIENT_CHANNELS`, `ADMIN_CHANNELS`: todo canal IPC está em exatamente uma lista. Testado contra os quatro preloads. |
| `src/main/ipc/registry.ts` | comum | `handleShared` / `handleClient` / `handleAdmin` / `onShared`, tipados pelas listas: canal sem lista não compila. No admin, canal de cliente vira stub que recusa; no cliente, canal de admin recusa. Registro duplicado acusa na subida. |
| `src/main/ipc/{context,shared,client,index}.ts` | comum e cliente | helpers de origem (`hostFromEvent`, `ownedConversation`); handlers comuns (leituras, configurações, memória, menu do WhatsApp, terminal); handlers só do cliente (chat, parear, logins, instalar, suporte lado da pessoa). `registerIpc(deps)` registra os três grupos. |
| `src/main/admin/` | admin | `ipc.ts` (`admin:*`), `picker-source.ts` (seletor de pessoas), `support-admin.ts`, `user-data.ts` (userData próprio: `~/Library/Application Support/meu-bot-admin`; o Electron nomearia a pasta pelo productName, "meu-bot" nos dois apps, e aí os dois dividiriam configurações, conversas e a trava de instância única: abrir um fechava o outro calado. Corrigido em 16 out, com migração do `pessoas.json`). Só `main.ts`, `ipc/index.ts` e `picker.ts` importam daqui. |
| `src/main/client/support.ts` | cliente | suporte do lado da pessoa. |
| `src/main/picker.ts` | comum | `initPicker(source: PickerSource)`; `clientPickerSource` mora aqui; os canais comuns do seletor também. |
| `src/main/wa-menu.ts` | comum (puro) | itens do menu "…" do WhatsApp por capacidade. Testado. |
| `src/main/updater-core.ts`, `src/main/update-download.ts`, `src/main/proc.ts`, `src/main/updater.ts` | comum | atualização automática do próprio app pelo GitHub Releases (ver as seções abaixo; a de 24 out é a vigente). Núcleo puro, download com retomada e processo filho testados. |
| `src/renderer/renderer.ts` | comum | `caps` (de `window:info`) no lugar de "é admin?": `caps.chat`, `caps.login`, `caps.install`, `caps.supportClient`; o arranque do admin chama `mountSuportePage`. |
| `src/renderer/admin/` | admin | `suporte-page.ts` (fábrica com dependências explícitas, como `snake.ts`), `picker-chrome.ts` (seletor de pessoas). |
| `src/renderer/lib/admin-view.ts` | admin (puro) | textos e linhas da página Suporte e do seletor. Testado. |
| `src/renderer/admin.css` | admin | `body.admin-mode`, `body.admin`, `.admin-*`; linkado em `index.html` e `picker.html`, copiado no `build:renderer`. |
| `src/shared/ipc.ts` | tipos | `MeuBotApi = MeuBotSharedApi & MeuBotClientApi & MeuBotAdminApi` (idem `PickerApi`); os preloads expõem `sharedApi`, `clientApi` e `adminApi` num só objeto. |

Regras:

- Arquivo exclusivo de uma variante começa o cabeçalho com `Variante: admin` ou `Variante: cliente`.
- Canal IPC novo: entra numa lista de `ipc-policy.ts`, no grupo certo do preload (`sharedApi`/`clientApi`/
  `adminApi`) e na interface `*Api` correspondente. O teste `scripts/tests/ipc-policy.test.mjs` confere que
  todo canal dos preloads tem política, que cada grupo do preload só usa canais da própria lista e que o que
  escreve na máquina da pessoa é só do cliente.
- `src/shared/` fica só com tipos: o `build:renderer` sobrescreve `dist/shared/ipc.js` com ESM, e o main
  (CJS) quebraria se houvesse valor lá. Lógica pura comum vive em `src/main/*-core.ts` ou
  `src/renderer/lib/`.
- `admin/` pode importar do resto; o resto não importa de `admin/` (só os pontos de composição acima).
- No renderer, decidir por capacidade (`caps.x`), nunca por variante: uma terceira variante um dia não exige
  novos `if`.
- Dev: `npm run dev` (cliente) e `MEU_BOT_VARIANT=admin npm run dev` (admin). Com o app instalado aberto, a
  trava de instância única (pelo userData) faz um dev sair calado; para testar ao lado dele:
  `./node_modules/.bin/electron . --user-data-dir=<pasta> --remote-debugging-port=9333` e
  `node scripts/devtools.mjs --porta=9333 paginas` lista as janelas (o mesmo script dirige o app instalado; ver a
  skill `testar-no-app`).

## Atualização automática do app (16 out 2026)

Como no Grok Bot (que usa a infra do Cursor com app assinado pela Anysphere), mas sem assinatura da Apple: o
meu-bot é assinado ad-hoc, então o `autoUpdater` do Electron (Squirrel) não serve e o app se atualiza sozinho.

- Publicar: `npm run release` (`scripts/release.mjs`): exige árvore limpa e `gh auth login`; empacota as duas
  variantes (`fuses.mjs --no-install`, sem tocar nos apps deste Mac), zipa cada `.app` com `ditto -c -k
  --keepParent` em `out/<app>-<versão>-<arch>.zip`, cria a tag `v<versão>` e a release no GitHub
  (`diegofornalha/meu-bot`, público) com os dois .zip. O .dmg continua sendo o instalador da primeira vez.
- No app (`src/main/updater.ts`, só empacotado; `MEU_BOT_NO_UPDATE=1` desliga): 20 s depois de abrir e a cada
  6 h consulta `/releases/latest` (sem token; 404 = ainda sem release), escolhe o asset desta variante e
  arquitetura (`escolherRelease`, puro, testado), baixa para `userData/update`, extrai, confere a versão e o bundle
  id do Info.plist e tira a quarentena (assinatura e identidade: ver a revisão de 22 out abaixo). Pronta, avisa as janelas (`update:ready`): faixa
  "meu-bot X pronto para instalar · Reiniciar e atualizar" (`update:apply` troca o .app que está rodando e as
  cópias em `~/Applications` e na mesa com o mesmo bundle id, e reabre). Sem clique, a troca acontece calada ao
  sair do app (`will-quit`): a próxima abertura já é a nova. Canais comuns (`update:state`, `update:apply`).
- A versão do meu-bot de cada pessoa aparece para o admin na saúde da máquina (abaixo).

### Release automática depois do merge (10 nov 2026)

`scripts/release-auto.mjs`, um agente do launchd neste Mac (a chave da release está no Chaveiro daqui, e `build/suporte`
e os clients do Google ficam fora do git: GitHub Actions não serve). A cada 10 min ele olha o `origin/main` e decide
uma coisa (`decideRodada`, `scripts/release-core.mjs`): staging 10 min depois do último merge; estável 24 h depois, se
o `meu-bot-staging` deste Mac recebeu a versão pelo atualizador e a confirmou (`saudeStaging`); e o PR da base nova
depois da estável. Os dois staging deste Mac deixaram de ser builds locais (`rebuild-auto.sh` não os empacota mais),
porque um build local sai com a versão sem sufixo e nunca recebe a `-staging.N`. O CI (`scripts/release-checar.mjs`)
recusa já no PR o componente da máquina que mudou sem subir a versão. Detalhes na skill `publicar`.

### Revisão no molde do Brave/Sparkle (22 out 2026)

REA do Brave 155→156 (Sparkle: `SUPublicEDKey`, delta baixado em `~/Library/Caches/…/PersistentDownloads`) e do
Cursor 3.26.16 (Squirrel + trilhas `dogfood/candidate/stable`, `update.mode` com `silentlyApplyOnQuit`). O que
mudou no meu-bot (o texto acima segue valendo onde não é contradito):

- **Assinatura Ed25519 das releases:** `npm run chave-release` (uma vez) cria a privada em
  `~/.config/meu-bot/release-ed25519.pem` (fora do repo; guarde um backup) e mostra a pública, embutida em
  `UPDATE_PUBLIC_KEY` (`updater-core.ts`). O `release.mjs` publica `<zip>.sig` ao lado de cada zip; `escolherRelease`
  ignora release sem `.sig` e o `stage()` só extrai se `verificaAssinatura` conferir.
- **Nada é reassinado:** o zip do `ditto` preserva a assinatura "meu-bot local" (conferido); o `stage()` exige
  `codesign --verify --deep --strict` e o mesmo designated requirement do app em execução. Assim o chaveiro
  ("Safe Storage", cookies do Navegador) não pede senha a cada atualização.
- **Volta sozinho:** a troca guarda cada anterior como `<app>.antigo` e grava `userData/update-pendente.json`.
  A versão nova que fica 30 s de pé é confirmada (os `.antigo` saem); na 3ª abertura sem confirmar
  (`decideRollback`), os `.antigo` voltam ao lugar e o app reabre na anterior.
- **Staging calado:** os apps do canal staging não mostram a faixa "pronto para instalar"; a versão entra ao
  fechar o app (Configurações › Sobre e atualização continua mostrando e oferecendo o botão). O estável mantém a
  faixa e nunca reinicia sozinho.
- **Backend da máquina se atualiza sozinho:** `backend-colima/VERSION` vai no app; o `install.sh` grava
  `$DEST/VERSION` só depois de o backend responder. A sondagem lê `backendver` e `backendbusy` (`/health` agora
  traz `ativos`, os chats em andamento) e `ensureBackendAtual` (`picker.ts`) reinstala para cima, só ocioso, antes
  dos plugins (o do financeiro chama a API). Decisão pura em `precisaAtualizarBackend`.
- **O release barra versão esquecida:** `componentesSemVersao` (`release-core.mjs`) compara com a última tag `v*`
  cada componente de `COMPONENTES` (`src/main/backend-bundle-core.ts`, a mesma lista que o `hostProbe.ts` instala):
  backend → `VERSION`; financeiro, CRM e guarda → o `package.json` do plugin. Mudou sem subir, sai com 64.

**Fluxo de trabalho:** desenvolver e testar com `dist:staging`/`dist:finance-staging` (build local, versão do
`package.json` sem sufixo, que vence o staging publicado) → `npm run release:staging` (os staging instalados se
atualizam) → testar → `npm run release` no mesmo commit (os meu-bot dos usuários baixam, verificam e aplicam; na
abertura seguinte o seletor atualiza backend e plugins das máquinas) → subir a versão base no `package.json`.

## Tutoriais: "ainda não consultei" não é "não feito" (19 out 2026)

- **Sintoma:** ao abrir a janela, a lista de Tutoriais e o selo da lateral nasciam com tudo "pendente" e mudavam
  conforme as consultas à máquina chegavam (o selo "3" aparecia tarde; cartões concluídos iam para arquivados
  depois). Causa: cada `done()` de passo devolve `false` para fonte `null`, e a lista tratava isso como pendente.
- **Modelo:** cada tutorial declara `needs` (fontes do contexto: whatsapp, claude, statusline, xai, fallback,
  support, objective, guarda, navegador, crm) e o contexto traz `known` por fonte (consulta respondeu, ou não se
  aplica aqui: este Mac, sem o pacote, máquina sem OpenClaw; consulta que falhou continua desconhecida).
  `tutorialState` é tri-valente: `done` / `todo` pelo estado real quando as fontes chegaram; antes, a lembrança
  por máquina (`tutLembrado:<host>`, gravada sempre que as fontes estão completas); sem lembrança, `unknown`.
- **UI:** `unknown` vira cartão "verificando a máquina…" (sem Começar, fora do selo e do "próximo"); o resumo
  diz "verificando N na máquina…". Com lembrança, a lista nasce como ficou da última vez e só muda se a máquina
  mudou. As consultas que a lista precisa (guarda, licença, Navegador, CRM) agora rodam na abertura, em
  paralelo, e não só ao abrir cada guia. Puro e testado: `tutorialKnown`, `tutorialState`, `parseTutMemory`.

## Produtos: meu-bot, meu-bot-admin e meu-bot-crm (19 out 2026)

Um código, três apps, e a porta aberta para mais (meu-bot-vendas, meu-bot-imobiliaria…). O "Mapa de variantes"
acima continua valendo para admin × cliente; o que mudou é que a variante deixou de ser um `if` e virou uma
linha numa tabela:

| Onde | O quê |
|---|---|
| `src/main/variant-core.ts` | `PRODUTOS`: por produto, `variant`, `nome` (bundle, título, userData, asset da atualização), `bundleId`, `icone`, `userData` (null = pasta padrão), `extensoes` (pastas de build das extensões embutidas), `licenca`, `herdaDe`, `fundeDe`, `portaLocal`, `caps`. O que depende da licença (CRM próprio) não está nas caps: é por máquina (22 out). |
| `scripts/produtos.mjs` | a mesma tabela lida de `dist/main/variant-core.js` para `package.mjs`, `fuses.mjs`, `dmg.mjs`, `release.mjs` e `icons.mjs` (`--variant <id>`; `--admin` segue como alias). `release.mjs` publica um zip por produto. |
| `src/main/user-data.ts` | `useVariantUserData(nome, migrate?)`: userData próprio de qualquer produto que não o meu-bot (o admin só traz o `pessoas.json`). |
| `src/main/acesso.ts` | `assertAcesso(host)`: um só gate no main. Produto free → módulo Pro exige pro/personalizado (`PRO_REQUIRED`); produto por assinatura → plano exigido em vigor (`ASSINATURA_REQUIRED`). |
| `src/main/licenca.ts`, `backend-colima/licenca.js` | três planos: `free | pro | personalizado`. `proOk` (pro ou personalizado), `crmOk` (Pro ou superior em vigor, ou o produto meu-bot-crm contratado), `isActive`, `mergeApps` (apps por device). |
| `src/renderer/lib/pro.ts` | `browserAccess(view, host, exige)`: no produto por assinatura devolve `ok` ou `assinatura` (uma tela só, sem etiqueta Pro); `planoLiberaPro`, `acessoProduto`. |
| `src/main/extensao-gmail/` | `extensao.ts` (copia `Resources/<pasta>` para `userData/Navegador/<host>/<pasta>/` por extensão, refeito pelo carimbo `.origem`; grava `config.json` 0600 com porta+token, aplica o polyfill e carrega descompactada), `extensao-api.ts` (proxy 127.0.0.1:<porta aleatória> → túnel `-L` → `/v1/crm/*` do backend com a chave do backend; CORS só para a extensão e o Gmail; `Host` conferido), `extensao-api-core.ts` (puro, testado). Ligado em `browser.ts`: o Autenticador na cadeia `ready` da sessão; a extensão do CRM em `browserOpen`/`license:get` por `sincronizarExtensaoCrm`, pela licença da máquina (22 out). |
| `extensao-crm/` | a extensão do Gmail (InboxSDK `@inboxsdk/core` 2.2.31 fixo, esbuild, DOM vanilla, pt-BR). `npm run build:extensao` → `build/extensao-crm/` (o app em dev carrega daí); o `package.mjs` copia para `Resources/extensao-crm/`. Id estável pelo `key` do manifesto (`scripts/id-da-extensao.mjs`). Dev: `npm run build:extensao && MEU_BOT_VARIANT=crm npm run dev` (ou `MEU_BOT_EXTENSAO_CRM_DIR=<pasta>` para outra cópia). |
| `backend-colima/crm-modelo.js`, `crm-store.js`, `crm-api.js` | o CRM próprio no host: domínio puro, store em `~/.local/share/meu-bot/crm/db/` (JSON por pipeline, escritor único, feed `mudancas.jsonl`, lixeira, backup diário), rotas `/v1/crm/*` montadas no `server.js` (exige `personalizado`). |
| `backend-colima/crm/crm.mjs`, `backend.mjs`, `importar-streak.mjs` | CLI do agente (mesmos subcomandos do `streak.mjs`, falando HTTP com o backend), helper do `.env`, importador do Streak (preserva as chaves; idempotente). `crm-job.mjs` escolhe a CLI pela licença: personalizado → `crm.mjs`; pro → `streak.mjs`. |
| `src/renderer/lib/tutoriais.ts` | `GuideContext.produto`; tutorial 18 em duas versões excludentes: `crm-gmail` (`needsExtensaoGmail`) e `crm-whatsapp` (`needsCrmStreak`). |
| `src/main/backend.ts`, `backend-colima/server.js` | o `hello` leva `produto`; o backend guarda `apps[produto] = {version, lastSeen}` por device (um Mac pode ter o meu-bot e o meu-bot-crm: mesmo `deviceId`, não gasta `deviceLimit`); o admin vê em `appsText`. |

Regras novas:

- Produto novo = um membro em `AppVariant`, uma linha em `PRODUTOS`, um `assets/icon-<x>.svg` (`npm run icons`)
  e, se tiver extensão do Gmail, a pasta de build. Nada mais; nenhum `if (variant === …)`.
- Planos: `pro` e `personalizado` liberam os módulos Pro (Navegador, CRM pelo WhatsApp) e, desde 22 out, o CRM
  próprio no Gmail (`crmProprioOk`); o produto `meu-bot-crm` contratado por cima do plano gratuito também libera o
  CRM. O admin muda o plano em Suporte › Conta e licença.
- Empacotar o meu-bot: `npm run dist`
  (encadeia `build:extensao`). `./instalar.sh`.
- O `localBackend.ts` passou a copiar todos os módulos que o `server.js` exige (antes só `server.js` e
  `session-map.js`: o backend local quebrava no require).

### meu-bot-crm: o CRM próprio no host

- Escritor único: só o `server.js` toca em `crm/db/`. Extensão (pelo proxy do app), agente (`crm.mjs`), job do
  WhatsApp e importador falam HTTP. A fila em memória serializa; cada mutação grava só os arquivos tocados
  (tmp+rename, 0600), avança `meta.seq` e acrescenta uma linha em `mudancas.jsonl`; `GET /v1/crm/changes?since=`
  (com `wait=` para long-poll) é o que a extensão consulta (5 s com visão CRM aberta, 30 s de resto).
- Formas: pipeline `{key, name, stages[{key,name}], fields[{key,name,type,options[{key,name}]}]}`; box
  `{key, pipelineKey, name, stageKey, notes, fields{fieldKey: valor}, contatos[key], threads[{gid,…}],
  comentarios[{key,at,autor,texto}]}`; contato `{key, nome, emails[], telefones[]}`. Tipos: TEXT, NUMBER, DATE
  (ms UTC), DROPDOWN (chave da opção), TAG (lista de chaves), CHECKBOX. Chaves opacas; as do Streak são
  preservadas na importação (idempotência e `crm/estado.json` continuam válidos).
- Extensão: só o service worker conhece o token (config.json fora dos web-acessíveis); o content script manda
  `{tipo:"crm:fetch"}` por `chrome.runtime.sendMessage`; se o fetch do worker falhar (CORS/rede local), o content
  script cai no fetch direto por 60 s com a config pedida ao worker. Painel por conversa
  (`threadView.addSidebarContentPanel`), rotas `meu-bot-crm/home`, `meu-bot-crm/pipeline/:key` e `meu-bot-crm/caixa/:key` (os antigos `crm/…` redirecionam), rótulos nas linhas
  (`threads/lookup` em lote), botões "Adicionar ao pipeline" e "CRM" na toolbar (sobrevivem aos recortes que
  escondem o menu esquerdo), item no menu, atalho ctrl+shift+c. Tema pelo `Global.gmailTheme` do SDK.
- Pendente de verificação real no Navegador (spike da Fase 0 do plano): `host_permissions` do service worker
  para 127.0.0.1 no Electron, `sendMessage` content ⇄ worker com resposta assíncrona, `key` honrado no
  `loadExtension`. O desenho tem os dois transportes e o CORS no proxy para cobrir os "se não".

### Produtos no meu-bot-admin (MVPs de bots verticais)

Pedido de 19 out: o admin é o lugar de registrar e dar o pontapé inicial em novos bots personalizados
(meu-bot-fit para academias e estúdios, por exemplo). Vista "Produtos" (`src/renderer/admin/produtos-page.ts`,
botão "Novo MVP / Produtos" do seletor; a lateral da janela da pessoa tinha `#produtos-line` até 26 out, quando o
lugar passou a ser do `#suporte-line`, que reabre a aba Suporte): lista os três produtos fixos e os MVPs do admin, com
formulário (nome `meu-bot-<slug>`, vertical, pitch, público, módulos, pipeline modelo, status ideia/mvp/beta/
lançado, notas, próximos passos). "Pontapé inicial (exportar)" mostra a definição (`produto.json`) e o checklist do
que falta para virar variante (linha em `PRODUTOS`, ícone, templates, licença das pessoas, `--variant`). Dados em
`userData/produtos.json` do admin (0600, atômico); o admin não altera o repositório. Main: `src/main/admin/
produtos-core.ts` (puro, testado) e `produtos.ts`; canais `picker:produtos-list|save|remove|export` no seletor e
só `admin:produtos-list` na janela (`adminProdutos`: os nomes para os botões "＋ produto" da licença).
Pendente: anotar em `pessoas.json` qual produto cada pessoa contratou no plano personalizado.

## Assinatura dos apps e o chaveiro do macOS

Os cookies do Navegador (login do Gmail) são cifrados com a chave "<app> Safe Storage" do chaveiro, que o macOS
libera só para a assinatura que a criou. Assinatura ad-hoc muda a cada build, então cada reinstalação pedia a senha
do Mac e, se negada, o Gmail caía deslogado. `npm run assinatura` cria uma vez o certificado autoassinado
"meu-bot local" no chaveiro de login; `fuses.mjs` e `dmg.mjs` passam a assinar com ele (sem ele, continuam ad-hoc).
Na primeira abertura depois da troca o macOS pergunta mais uma vez: clique em **Permitir Sempre**. Daí em diante
os builds seguintes (feitos neste Mac) não perguntam mais.

## Canal staging (20 out), como VS Code e VS Code Insiders

O meu-bot e o meu-bot-crm têm uma cópia **staging** ao lado do estável: `meu-bot-staging` e `meu-bot-crm-staging`.
O meu-bot-admin é só estável.

**Como a cópia staging é definida** (`staging()` em `src/main/variant-core.ts`): ela sai da linha estável. Recebe:
- nome `<app>-staging` e bundle `local.<app>.staging`;
- ícone com a faixa laranja (`assets/icon*-staging.svg`);
- userData próprio, herdado do estável uma vez só;
- porta local própria: meu-bot 8790, meu-bot-staging 8791, crm-staging 8792. O meu-bot-crm ainda divide a 8790 com o
  meu-bot (pendência).

**Licença e título**
- `caps.produto` é a **licença**, a mesma do estável. É por ela que a licença meu-bot-crm libera o crm-staging.
- `caps.nome` é o app. `caps.titulo` mostra a versão no staging ("meu-bot-staging 0.2.0-staging.3").

**Isolamento**
- Pasta de controle por app (`/tmp/<app>-<uid>`): mestre do SSH e socket do Navegador do agente. Os dois apps abertos
  juntos não fecham os túneis um do outro nem trocam o Navegador do agente.
- A cópia inicial não leva o que o chaveiro cifra com o nome do app (`google-contatos.bin`, `tailscale-oauth.bin`).
  O staging pede de novo o login do Google Contatos; o Gmail do Navegador provavelmente também.

**Versões**
- O `package.json` guarda a próxima estável (0.2.0). Os builds staging são `0.2.0-staging.N`.
- `compareVersions` segue o semver: `0.2.0-staging.3 < 0.2.0-staging.10 < 0.2.0`.
- O staging se atualiza pela maior pre-release `v*-staging.*` que tenha o `.zip` dele. O estável continua com
  `/releases/latest`.

**Publicar**
- `npm run release:staging` publica a pre-release `v<versão>-staging.N` com os dois apps staging.
- `npm run release` é a promoção: só roda num commit com a tag `v<versão>-staging.N`; sem ela, sai com 64. A regra
  fica em `scripts/release-core.mjs`.
- Instalar localmente: `./instalar.sh --staging` e `./instalar.sh --crm --staging`.

**Máquina compartilhada**
- O estável e o staging falam com a mesma máquina, e a guarda só sobe de versão (`deveAtualizar`): um app não rebaixa
  a do outro.
- O backend da máquina (server.js, crm-api, auditoria.py, plugins) é um só para os dois canais. O que se instala
  testando no staging vale também para o estável.
- O navegador-mcp da máquina atende um app por vez.

**Auditoria:** o campo `app` grava o nome real, então o registro mostra quando a ação veio de um app staging.

## Um app só: o CRM próprio vira capacidade por licença (22 out)

O meu-bot-crm era o meu-bot com três chaves ligadas na tabela de produtos (`extensaoGmail`, `crmStreak: false`,
`planoExigido: "personalizado"`), mas isso virava binário, ícone, pasta de dados, porta dividida e 5 builds. Agora:

- **Uma regra, por máquina:** `crmProprioOk(view, host)` (`src/main/licenca.ts`, `src/renderer/lib/pro.ts`;
  `crmOk` em `backend-colima/licenca.js`) = Pro ou superior em vigor, **ou** o produto `meu-bot-crm` contratado;
  nunca neste Mac nem sem licença lida (fail closed). `Capabilities` perdeu `extensaoGmail`/`crmStreak`; o renderer
  usa `crmProprio()` (do `license` da janela) onde olhava `caps.extensaoGmail` (limpar histórico guarda no CRM,
  `navHome`, `refreshCrm`, textos); o main usa `assertCrmProprio(host)` (`acesso.ts`, erro `CRM_REQUIRED`) no
  `whatsapp:archive-crm`.
- **Motor explícito na máquina:** `crm.json.motor: "proprio" | "streak"`; sem ele, quem tem a chave do Streak fica no
  Streak (nada muda em silêncio para quem já o usava com Pro), senão a licença decide (`motorCrm` em `crm-job.mjs`,
  `motorEfetivo` em `crm-core.ts`, `CrmInfo.motor`/`streakKey`). O tutorial 18 é `crm-gmail` quando
  `crmProprio && motor === "proprio"`, senão `crm-whatsapp` (Streak); `ctx.produto = { planoExigido, crmProprio, crmStreak }`.
- **Extensões:** o meu-bot traz as duas (`CLIENT.extensoes`). O Autenticador carrega na cadeia `ready` da sessão; a do
  CRM entra por `sincronizarExtensaoCrm` (idempotente: carrega/`removeExtension`) em `browserOpen` (que recebe a
  licença de quem abre) e sempre que `license:get` relê a licença (`browserSincronizarCrm`). No servidor, as rotas
  `/v1/crm/autenticador/*` passam sem `licenseOk` (`crm-api.js handle`): o Autenticador não é CRM.
- **Fusão de dados** (`Produto.fundeDe`; `fundirDe` em `user-data.ts`, regras puras em `user-data-core.ts`,
  testadas): o meu-bot adota `appData/meu-bot-crm` (o staging, `meu-bot-crm-staging`) uma vez (carimbo
  `.fundido-de-<origem>`), sem tocar na origem: conversas unem por id (empate → `updatedAt` maior, transcrições
  junto); `settings.json` mescla (origem prevalece; mapas por máquina e listas unem; favoritos por url; `onboarding`
  done se qualquer); `memory.json` fica a mais recente; `google-whatsapp.json` une `criados`; o resto só se faltar
  (`COPIAR_SE_FALTAR`, `POR_MAQUINA`). Nunca os `.bin` do chaveiro nem o leveldb da sessão. Aviso único na abertura
  (`relatorioFusao`).
- **App removido (22 out):** o produto `crm` saiu da tabela, com o `encerrado.ts` e o campo `encerrado` (nenhuma
  release chegou a ser publicada, então ninguém o recebeu pelo updater). `crm-staging` também saiu. O meu-bot segue
  com `fundeDe: "meu-bot-crm"`: a pasta antiga ainda é fundida na primeira abertura.
  `mergeApps` apaga `meu-bot-crm` quando o `meu-bot` se apresenta (sem fantasma no admin).
- **Build:** `dist` e `dist:staging` encadeiam `build:extensao`; `package.mjs` copia `google-oauth.json` quando o
  produto traz `extensao-crm`. Somem `dist:crm`, `dist:crm-staging`, `dmg:crm`, `instalar.sh --crm`.
- Fica como está: o projeto `extensao-crm/` gera as duas extensões (um build); separar o Autenticador num projeto
  próprio é só organização de pasta, sem efeito na licença.

## Atualização no molde do Grok Bot (24 out)

REA do updater do Grok Bot 0.71.2→0.75.5 (Cursor/Anysphere; `sand-update-service`: feed próprio, download com
retomada, zip retido em `sand-update-kept/`, marcador `sand-update-apply-marker.json`, reinício ocioso e gate de
versão mínima do Statsig que vira a tela "Atualização pronta · Reiniciar para atualizar"). O que mudou no meu-bot (o
texto das seções de 16 e 22 out segue valendo onde não é contradito; a assinatura Ed25519, o mesmo designated
requirement e o rollback pelos `.antigo` ficam, que o Grok Bot não tem):

- **Módulos:** `updater-core.ts` (puro: feed, versões, assinatura, os registros em disco, cadência, reinício ocioso,
  versão mínima), `update-download.ts` (download em fluxo com retomada; testado com servidor `node:http` falso),
  `proc.ts` (`run`/`runText`: processo filho assíncrono com limite de tempo; o updater não usa mais `execFileSync`
  durante a preparação, que congelava a janela no `ditto` e no `codesign`), `updater.ts` (o orquestrador).
- **Verificação:** 10 s depois de abrir, depois a cada hora com até 5 min de jitter (`proximaVerificacaoMs`); também
  ao voltar a internet, ao acordar/desbloquear o Mac se a última ficou velha (`checkIfStale`), em "Verificar agora" e
  quando o backend exige versão mínima. Cada verificação loga o gatilho (`UpdateTrigger`).
- **Download:** `baixarComRetomada` grava em `<zip>.partial` com `<zip>.resume` (URL + ETag/Last-Modified), retoma com
  `Range`/`If-Range`, insiste até 15 vezes com espera dobrando (1 s → 60 s), vigia de 30 s sem bytes, progresso em
  passos de 1 % (`UpdateState.progress`, fase `downloading`), confere o tamanho declarado na release e calcula o sha256.
  Cancelado ao sair, o `.partial` fica e a próxima abertura retoma. O `.sig` é baixado antes do zip (falha barata).
- **Preparada em disco:** `userData/update/app/<app>.app` + `preparada.json` (`parsePreparada`: versão, bundle,
  sha256 do zip, quando). Na abertura seguinte `reaproveitarPreparada` reconfere (`codesign --verify`, mesmo
  requisito) e já fica "pronta", sem baixar. A release deixou de oferecer a versão (ou oferece outra) → descarta.
- **Troca só da versão mostrada:** `update:apply` leva `expectedVersion`; o main recusa se a pronta mudou. Se a última
  verificação tem mais de 60 s (`CONFIRMA_FEED_MS`), reconsulta só a release (`feedAindaOferece`): retirada do ar, nada
  muda; sem internet, a preparada já conferida vale. Com uma resposta em andamento (`anyConversationBusy`), espera até
  20 s (fase `applying`, `aguardando`). Pré-voo de escrita no .app e na pasta: `EROFS`/`EACCES`/`EPERM` vira a fase
  `needs-move` ("arraste para Aplicativos"). Reabre na mesma máquina (`--host=` no `app.relaunch`).
- **Registro da troca** (`update-pendente.json`, `parsePendente` lê o formato antigo): ganha `gatilho` (clique, ocioso,
  saída), `pedidoEm` e `fase` ("pedida" antes de mexer nos .app, "trocada" depois). Na abertura, `decideRollback`:
  `aguardar` (30 s de pé confirma), `voltar` (3.ª abertura sem confirmar), **`nao-pegou`** (reabriu na versão de antes:
  `repararTroca` repõe um .app que tenha ficado faltando entre os dois renames, registra e a próxima verificação
  prepara de novo) ou `descartar` (outra versão).
- **Reinício ocioso** (preferência `atualizarOcioso`, ligada por padrão; chave em Configurações › Sobre e
  atualização): a cada minuto e ao bloquear a tela, com versão pronta, `powerMonitor.getSystemIdleState(600)` em
  `idle`/`locked`, nenhuma resposta em andamento e nenhum terminal aberto (`decideReinicioOcioso`) → troca e reabre.
- **Versão mínima:** o backend responde `appMinima` no hello (`APP_MINIMA` em `server.js`, acompanha o backend; o
  admin força uma maior gravando `~/.local/share/meu-bot/app-minima.json` `{"versao":"x.y.z"}`; também vai no
  `/health`). `backend.ts` entrega a `noteVersaoMinima` (vale a maior entre as máquinas abertas); abaixo dela
  (`abaixoDaMinima`) o `UpdateState` marca e a janela mostra o bloqueador `#update-blocker` ("Atualização necessária",
  progresso, "Reiniciar e atualizar" quando pronta, "Baixar a versão mais recente" se o download não vier), até
  reiniciar na versão nova. Backend antigo não manda o campo = sem exigência. `backend-colima/VERSION` 1.0.3.
- **Tela:** `UpdateState` ganhou `phase` novas (`downloading`, `verifying`, `applying`, `needs-move`), `progress`,
  `errorKind`, `aguardando`, `minima`/`abaixoDaMinima`, `atualizarOcioso`; `update:ready` saiu (o `update:state`
  cobre). O ponto da barra mostra `short` ("baixando 42%"). Corrigidos: a linha "Sobre" usava um `name` inexistente
  (vinha vazio) e o primeiro estado era pintado antes de `window:info` (um staging podia mostrar a faixa).
- Fica igual: faixa só no estável; staging troca calado ao fechar (e agora também ocioso); troca ao sair (`will-quit`)
  é o único caminho ainda síncrono, de propósito (não dá para esperar Promise ali).
- **Trava do Hermes (24 out, ao religar a `grokbot-1`):** `precisaAtualizarBackend` devolve "nao" quando a sondagem
  diz `gateway: "hermes"`: lá o backend é o original do Hermes (`hermes-mythos-lucas`, sem `VERSION`, na mesma pasta
  que o backend-colima usaria), e a atualização automática o reinstalaria por cima na primeira sondagem.



## Espera que não parece erro (26 out)
As telas mostravam "Consultando…" cinza e parado enquanto a máquina respondia por SSH/túnel; com 10–20 s de demora
parecia travado e a pessoa clicava de novo. Agora toda espera de dado da máquina usa `lib/carregando.ts`: ponto
pulsando, o tempo a partir de 3 s ("Lendo os grupos… 7 s") e, a partir de 10 s, "A máquina está respondendo devagar;
continuo buscando. Não precisa clicar de novo." O relógio é por rótulo e não zera quando a tela se redesenha. Vale para
Conta Google, Finanças e Curva ABC, grupos e conversas do WhatsApp, passos do guia, CRM, Navegador e as páginas do
meu-bot-admin. Tela nova que espera a máquina: use `carregando("…")` no lugar de um `<p class="hint">`.

## Produtos em janela própria (27 out)
O registro de MVPs saiu do seletor do meu-bot-admin: o seletor virou uma faixa estreita à direita da tela e o formulário
(pitch, módulos, pipeline, checklist) ficava apertado, misturando "escolher uma pessoa" com "planejar um MVP". Agora o
botão "◆ Produtos ↗" do seletor abre a janela Produtos (`main/admin/produtos-janela.ts`, `renderer/produtos.html`):
uma só, altura toda, largura da janela de uma máquina, colada à esquerda do seletor (ou à direita da tela, sem ele).
- Canais só dela: `produtos:listar|salvar|remover|exportar|catalogo` (origem conferida); o seletor só tem
  `picker:produtos-abrir`. Os antigos `picker:produtos-*` saíram.
- "Já sai deste código" vem do catálogo (`PRODUTOS` com `descricao` e `ADDONS` em `app/variant-core.ts`), não mais de
  uma lista escrita à mão; o teste `produtos-alinhados` cobra a descrição de cada app e que todo `.html` entre no build.


## Janelas nascem no canto, igual ao seletor (27 out)
Toda janela do app (a de cada máquina, o seletor e a Produtos do admin) nasce bem colada à direita da tela onde está o
cursor, de cima até o Dock, na largura mínima confortável (`MIN_WINDOW_WIDTH`, 640). A regra é uma só, pura e testada:
`posicaoNoCanto` em `src/main/app/janela-core.ts`. Com o canto já ocupado por outra janela de máquina, a nova cola à
esquerda dela; a Produtos cola à esquerda do seletor. A memória de posição por máquina (`windowBounds` no
`settings.json`) saiu: cada máquina guardava um tamanho diferente e as janelas abriam cada uma num lugar.

## Pasta de instalação por componente (28 out)
O app manda os instaladores para a máquina por scp antes de rodar. Antes ia tudo solto em `~/.meu-bot-install/` (36
arquivos misturados); agora cada um vai para a própria subpasta, com os arquivos que ele lê da pasta dele:
`backend/` (o install.sh encadeia status line e porteiro), `audio/`, `grok/`, `navegador/`, `crm/` (+ `crm/` do
plugin), `financeiro/` (+ `finance/`), `guarda/` (+ `guarda/` e `skills/whatsapp-grupos/`) e `statusline/`. A cada
envio a subpasta do componente recomeça do zero e o jeito antigo é varrido (`stageDe`/`limparStage` em
src/main/maquina/hostProbe.ts). As desinstalações criam a subpasta se faltar; a do CRM ainda tenta o caminho antigo.

## Atualização: quatro falhas caladas (4 nov)
Vieram de uma leitura do atualizador ao lado do Grok Bot 0.78.4 (REA do `app.asar` dele mais o changelog público).
Nenhuma aparecia em teste: todas falhavam em silêncio.

- **O app podia parar de atualizar anunciando "tudo em dia".** O `pickUpdate` devolvia `null` em nove situações
  diferentes e quem chamava traduzia todas como `up-to-date`. Uma release publicada com o zip faltando, sem o `.sig`
  ou sem o arquivo desta arquitetura deixava o app parado para sempre, dizendo que estava atualizado. Virou
  `escolherRelease`, que devolve `{tipo:"candidata"|"nada-novo"|"inutilizavel"}` com o motivo; o `errorKind` ganhou
  `release` e a tela diz "há uma versão nova publicada e não consegui instalá-la: …". A distinção entre os canais é
  de propósito: no staging publica-se um produto de cada vez, então pre-release sem o arquivo deste app é normal e
  se pula; no estável a `/releases/latest` tem que trazer todos.
- **Disco cheio não existia.** Caía no balde `outro` e, pior, a limpeza era condicionada a `e instanceof UpdateFalha`,
  então a pasta de preparação e o `.partial` ficavam ocupando o disco que já faltava. O download agora para na
  primeira falha de espaço em vez de insistir quinze vezes (`semEspacoEmDisco`, dono da leitura em
  `update-download.ts`), o `errorKind` ganhou `disco` e o `check` apaga o que baixou. A frase diz quantos GB sobram.
- **Duas sessões do mesmo Mac se atropelavam.** A trava de instância única do Electron é por `userData`, ou seja, por
  usuário: com troca rápida de usuário, duas sessões trocavam a mesma pasta Aplicativos. Agora há uma trava entre
  processos ao lado do `.app` (um `mkdir`, que é atômico; o temporário do sistema não serve porque no macOS é privado
  por usuário), e cada alvo já na versão de destino é filtrado **antes** de gravar o registro pendente, para uma
  sessão nunca reivindicar o `.antigo` que é a volta atrás da outra.
- **Troca interrompida nem sempre era reparada.** O `repararTroca` só rodava no caminho `nao-pegou`. Se o app reabria
  já na versão nova e uma das outras cópias tinha ficado para trás, ninguém repunha e o `.antigo` órfão era apagado
  30 s depois, sumindo com aquela instalação. Agora o reparo roda antes de qualquer decisão, e o descarte usa
  `antigosDescartaveis` (puro, testado): uma cópia anterior só sai quando o `.app` dela voltou ao lugar.

Junto, duas coisas que o Grok Bot tem e faltavam: a preferência "atualizar sozinho com o Mac ocioso" estava
`disabled` no HTML com "por enquanto, sempre ligado" (o resto do caminho já existia), e o menu do aplicativo não
tinha atualização nenhuma. Agora tem "Verificar atualizações" e, com versão pronta, "Reiniciar para atualizar";
como o Electron não tem item de menu reativo, o `refreshAppMenu` refaz o menu a cada mudança de estado.

## Atualização: a fase passa a decidir, e a escolha volta para a pessoa (4 nov)

Duas levas depois das quatro falhas caladas. A primeira fechou dívida de desenho; a segunda é produto.

**O `fase` do `update-pendente.json` era estado morto.** Gravado em dois momentos, validado na leitura, nunca lido
por decisão nenhuma. Ele agora carrega a diferença que importa: `"pedida"` quer dizer que o registro foi gravado e
o processo morreu antes de terminar as renomeações, então `antigos` é o **plano**, não o que foi criado — e um
`<app>.antigo` que esteja lá pode ser de outra sessão deste Mac. Em `"pedida"` o `decideDescarte` não apaga nada;
em `"trocada"` apaga tudo menos a cópia cujo `<app>` não existe.

Para `"pedida"` só sobrar quando o processo morreu mesmo, uma troca que para com o app ainda de pé agora se desfaz
(`desfazerTroca`) e tira o registro do disco, em vez de deixar lá uma afirmação falsa.

**Tudo o que mexe nos `.app` foi para dentro da mesma trava entre processos** que a troca já usava: o reparo, o
descarte dos 30 s e a volta atrás. Era o buraco que sobrou do item "duas sessões se atropelam": a trava cobria a
troca, não a limpeza. Reabrir ficou **fora** da trava, porque `app.exit` não roda o `finally` e a sessão nova
encontraria a trava de pé por cinco minutos.

**As decisões presas ao Electron viraram funções puras** em `updater-core.ts`, cada uma com teste:
`classificarRespostaFeed` (404 sem release, 403/429 de limite com a hora em que libera, e qualquer outro status),
`decideReconfirmacao`, `alvosParaTrocar`, `decideReaproveitar`, `travaAbandonada`, `pastaSoLeitura`,
`decideAlvoAplicacao` e `decideFimDaEspera`.

**A escolha de interromper uma resposta é de quem está usando.** A espera de 20 s continua igual; o que muda é o
fim dela. Antes o app reiniciava por cima da conversa sem avisar. Agora ele volta para `ready` com
`ocupadoAoAplicar`, a tela troca o botão para "Parar e atualizar", e só esse clique (`forcar` no IPC) interrompe o
trabalho. O reinício ocioso nunca chega aqui ocupado, porque `decideReinicioOcioso` já exige nada em andamento.

**Pasta sem escrita agora tem saída.** `moverParaAplicativos` copia o bundle para `/Applications` com `ditto`, tira
a quarentena e reabre de lá. A cópia de origem fica onde está: numa imagem montada não dá para apagá-la, e numa
pasta qualquer apagar o arquivo de alguém não é decisão do app. O botão aparece também no bloqueador de versão
mínima, onde mover é o único caminho para destravar.

**O diálogo acompanha uma versão mais nova.** `decideAlvoAplicacao` segue na pronta quando ela é mais nova que a
pedida (mesma intenção, e a nova já passou pela assinatura e pelo codesign) e só recusa quando andaria para trás.

**O zip da versão preparada deixou de ser apagado.** Ele é a única prova de que o `.app` extraído veio da release
que a assinatura Ed25519 conferiu: entre uma sessão e outra o bundle fica em `userData`, e sem o zip a reabertura
só teria a plist e o `codesign`. `conferirConteudo` refaz o sha256 e compara com o manifesto antes de reaproveitar.
A pasta inteira some na troca, então isto ocupa disco só enquanto há atualização pendente.

**O desfecho virou legível por máquina.** O atualizador passou a usar o barramento `evento()` de `depuracao.ts`,
com as rotas `verificar`, `preparar`, `reaproveitar`, `trocar`, `mover` e `abertura`, cada uma com o motivo.

## A casca do app: localizar, atalhos, corretor e aceleração (4 nov)

Os cinco itens que faltavam fora do atualizador, conferidos contra o changelog público do Grok Bot.

**Localizar na página (⌘F).** Não havia `findInPage` em lugar nenhum. ⌘F já tinha dono, porém: o terminal usa para
a busca dele (`terminal.ts`, no `customKeyEventHandler` do xterm). Então o atalho é resolvido por foco, no `keydown`
da janela: terminal em foco → sai da frente e o terminal trata; Navegador em foco → `findInPage` do `<webview>`
ativo, que é a página que a pessoa está olhando; qualquer outro lugar → `find:start` no `webContents` da janela, com
o resultado voltando por `found-in-page`, ligado uma vez em `windows.ts`.

O item "Localizar…" entrou no menu Editar **sem acelerador no macOS**, pelo mesmo motivo que os itens de zoom: com
acelerador, o menu capturaria ⌘F antes do renderer e o terminal perderia a busca dele. Isso obrigou a trocar
`{ role: "editMenu" }` por um submenu escrito à mão, com os papéis padrão (senão ⌘C/⌘V param de funcionar).

**Folha de atalhos (⌘/).** `ATALHOS` em `busca-core.ts`, escrita à mão de propósito: o app registra atalhos em
quatro lugares que não sabem uns dos outros (menu do aplicativo, `keydown` da janela, terminal, Navegador), então
uma lista "gerada" mentiria por omissão. O teste garante que não há tecla repetida dentro de um grupo e que o ⌘F,
que aparece em três grupos, explica o foco em cada um.

**Corretor ortográfico.** `spellcheck` saiu de `false` fixo para a preferência. No macOS o Electron usa o corretor
do sistema, então não há lista de idiomas para configurar: vale o do Mac. Sem menu de contexto o sublinhado seria
inútil, então entrou um `context-menu` em campo editável com `dictionarySuggestions`, `replaceMisspelling`,
`addWordToSpellCheckerDictionary` e os comandos de edição. Os campos que não querem corretor (endereço, código
colado, chave) continuam com `spellcheck="false"` no HTML, que vence a preferência.

**Aceleração por hardware.** `app.disableHardwareAcceleration()` só vale antes do `ready`, e `loadSettings()` rodava
dentro do `whenReady`. A leitura das configurações subiu para o topo do `main.ts`, logo depois de a pasta de dados
estar decidida; `loadSettings` é idempotente, então a chamada do `whenReady` continua onde estava.

**Ditado.** Não há API no Electron para começar o ditado do macOS: ele é um serviço do sistema, acionado pelo atalho
do próprio Mac. O que dava para fazer foi garantir que o menu Editar existe com os papéis padrão, que é onde o
sistema põe o item dele. Não foi verificado em app empacotado se o macOS de fato acrescenta "Iniciar ditado" a este
menu.

**Defeito achado no caminho.** `getAtualizarOcioso()` devolvia `true` fixo e `settingsView` também, de quando o
interruptor era travado. Como a PR anterior destravou o interruptor na tela, ele salvava e a tela remarcava a caixa
no primeiro repinte. Agora os dois leem o arquivo.
