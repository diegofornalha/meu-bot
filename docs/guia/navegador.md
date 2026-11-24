# Navegador

> Parte do diário técnico do meu-bot, dividido por assunto em 27 out 2026. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

## Barra compacta: as ações somem atrás de "⋯" na área estreita (31 out 2026)

- **Sintoma:** com a janela em meia tela, a barra do Navegador (voltar, avançar, recarregar, endereço, favorito, pino,
  zoom, agente, WhatsApp, recortes do site, extensões, abrir fora) não cabia: o campo de endereço encolhia a uma
  bolinha com duas letras e a barra parecia tudo menos um navegador.
- **Agora:** um `ResizeObserver` na barra aplica `.nav-bar.compacta` abaixo de `NAV_BARRA_COMPACTA_PX` (720 px,
  `src/renderer/lib/nav-barra-core.ts`). Compacta, as ações com a classe `nav-secundario` (favorito, pino, zoom,
  WhatsApp do agente, recortes, extensões, abrir fora) somem e aparece o botão "⋯" (`nav-mais`) depois do endereço;
  ficam à vista só navegação, endereço e o 🤖 do agente. Apertar "⋯" (`.aberta`) faz a barra quebrar linha
  (`flex-wrap` + `.nav-quebra` com `order: 5`; as secundárias com `order: 10`) e as ações voltam numa segunda linha,
  sem mexer no DOM. Alargou a janela, a barra volta ao normal e fecha a segunda linha. `[hidden]` continua valendo
  (`:not([hidden])`), então pino e zoom escondidos pela página não reaparecem.

## Gmail estourava pela direita na janela estreita: zoom automático para caber (31 out 2026)

- **Sintoma:** com a janela em meia tela (área do Navegador com uns 640 px), a Caixa de entrada do Gmail saía cortada à
  direita (o "1–1 de 1", a data da mensagem, o rodapé). O Gmail web não encolhe abaixo de uns 760–800 px CSS: abaixo
  disso ele estoura, e no `<webview>` a barra de rolagem horizontal fica no fim da página, fora da vista. O zoom por
  site já existia (botão "%", Cmd+= / Cmd+-), mas nada ajustava sozinho.
- **Agora:** para os sites de largura fixa listados em `CABER_HOSTS` (`src/renderer/lib/nav-caber-core.ts`; hoje só
  `mail.google.com`) o Navegador mede a página depois de cada relayout (`navRefit`: ao mostrar a aba, ao mudar a
  largura, nos recortes e após carregar) com `[scrollWidth, innerWidth]`. Estourou → a largura mínima do site
  (`larguraMinima`, só cresce, com folga de 4 px e ignorando medidas absurdas da página ainda montando) é lembrada na
  sessão (`navMinimos`) e o zoom desce para o maior degrau em que ela cabe (`zoomParaCaber`); cada aplicação dispara
  novo refit, que mede de novo até caber. Alargou a janela → o degrau sobe de volta (até 100%, nunca amplia).
  Mostrar/ocultar um recorte com `resize` zera as medidas (a largura mínima muda).
- **A pessoa manda:** um zoom escolhido (Cmd+= / Cmd+-) fica gravado por host e desliga o automático; nesses sites
  100% escolhido também fica gravado (antes 100% apagava a entrada). Cmd+0 apaga a escolha e volta ao automático. O
  botão "%" nesses sites alterna automático ↔ 100% fixo (nos outros segue 100% ↔ 75%), com sublinhado pontilhado e
  dica explicando quando está no automático. Testes em `scripts/tests/nav-caber-core.test.mjs`.

## Tutorial do Navegador concluía sem o agente ter navegado (18 out 2026)

- **Causa:** o passo "Deixar o agente navegar" marcava `navAgentUsed` em qualquer evento `chat:tool` cujo nome
  começasse com `mcp__navegador__`, inclusive o `use` (a tentativa) e o resultado com erro ("o Navegador da
  pessoa não está ligado para o agente"). Bastava o agente tentar com "agente pode usar" desligado e o
  tutorial "concluía". E "Abrir o Navegador e entrar num site" contava uma aba vazia.
- **Agora:** só um `result` com `ok` de ferramenta do Navegador marca o passo (`showTool` devolve o nome da
  ferramenta, inclusive no resultado sem nome, pela linha que ele fechou); "entrar num site" conta só abas
  com URL carregada. O tutorial ganhou "Refazer do zero" (só apaga a flag; plano, instalação e abas ficam),
  para quem já estava marcado errado.

## Tutorial "Extensões no Navegador" (o 10 da época) removido (19 out 2026)

- Só o tutorial saiu (bloco em `tutoriais.ts`, flag `extSeen`, corpo `navegador-ext`); o recurso de extensões
  (🧩, Web Store na aba, `browser:extensions`) continua. O CRM passa a vir depois do Navegador (9) e vira o
  10 (a trilha exige números contínuos 1..N).

## Notificações do Navegador removidas (30 out 2026)

- A função "Notificações do Navegador viram conversas" (19 out) saiu inteira por decisão de produto: o sino 🔔 da
  barra, o grupo nas Configurações, `navNotify` no settings.json (chave antiga é ignorada), `nav-notify-preload.ts`,
  `lib/nav-notify.ts`, o substituto de `window.Notification` injetado nas abas e o tutorial do CRM pelo WhatsApp, 11 na época (já estava oculto
  desde 27 out; o 12 segue sendo 12). As notificações das páginas voltam a ser negadas pelo Chromium, como antes.
- No mesmo dia saíram das Configurações o campo "Tamanho da fonte" (o zoom da janela cobre) e o grupo "Memória e
  contexto": a memória continua sendo extraída a cada N turnos (padrões 24000 tokens / 10 turnos) e a pessoa a
  ajusta pelo chat; só o editor manual sumiu. Também saíram o grupo "Fallback" (o seletor do primário vive no
  tutorial 6, `renderFallbackOrder`; `configuracoes/fallback.ts` apagado), o botão "Enviar uma notificação de teste"
  (`maybeAskNotificationsOnce` continua) e a dica de texto dos atalhos de zoom.

## Espaços de trabalho do Navegador (19 out 2026) · REA do Rambox

- **No Rambox:** workspaces são "grupos" (`$workspaces.addGroup/editGroup`, `addApp`) com apps fixos num trilho
  (rail), cada app um webview permanente; os dados ficam na conta Rambox (API `customerApps`), não localmente.
  O que se aproveitou: trilho lateral, sites fixos sempre abertos, agrupamento escolhido pela pessoa.
- **No meu-bot:** `NavWorkspaces { ativo, lista: [{ id, nome, servicos: [{ id, nome,
  url, icone }] }] }`, por máquina em `settings.json › navEspacos` (`normalizeNavWorkspaces`, limites 20×30),
  gravado inteiro por `browser:workspaces-set` (o main valida e avisa as outras janelas da máquina, evento
  `browser:workspaces`); `browserOpen` devolve `espacos`; `SettingsView.navEspacos` deixa o tutorial saber antes
  de o Navegador abrir. Trilho (`paintNavRail`): sem "tipo" (o que o espaço representa, cliente ou projeto, é o nome que a pessoa
  dá; a escolha por tipo existiu por umas horas e saiu em 19/10), seletor do espaço (com o grupo "Ocultos": escolher um traz de volta), ＋ (novo), ⋯ (renomear/ocultar/remover; ocultar
  fecha as abas fixas dele e não apaga nada), lista dos sites fixos, "＋ Adicionar site"; 📌 na barra fixa a
  aba aberta. Abas fixas (`NavTab.serviceId`) nascem com o Navegador (`navMountWorkspace`), sem ✕ na tira; as de
  outros espaços ficam vivas mas fora da tira (`navVisibleTabs`).

## Balão "guardar numa skill" depois de o agente navegar (19 out 2026)

- Ao fim de um turno em que o agente usou ferramentas `mcp__navegador__*`, a conversa ganha um balão: "O agente
  usou o Navegador em <sites>. Quer guardar o que ele aprendeu numa skill?" com "Atualizar «skill»" para cada
  skill da máquina que combine (nome/descrição citam o host, um pedaço dele ou palavras do título da aba; até 2),
  "Criar uma skill do zero" e "Agora não". Os botões mandam um pedido pronto na própria conversa: atualizar o
  SKILL.md (seção "Diário" datada, sem apagar) ou criar `~/.claude/skills/<nome>/SKILL.md` com frontmatter.
- Os sites vêm das urls nos resumos das ferramentas (`navHostsIn`) ou, sem url, do host da aba ativa
  (`Tab.navSitesTurn`, zerado a cada turno). As skills vêm de `objectiveState.skills` (as da máquina, menos a do
  objetivo).
- (19/10) O agente da `agente-box` acrescentou ao streak.mjs da máquina `box-find --email`, `threads` e `thread-add`
  (vincular uma conversa do Gmail a um box, `PUT /v1/boxes/<box>/threads`, form `threadGmailId`); incorporados ao
  bundle para não se perderem na próxima reinstalação, e a skill da API os documenta. A regra v4 do CLAUDE.md
  (seção "Pedido vago") passa a proibir o agente de editar as ferramentas do app e de encaixar assunto novo no
  único pipeline existente. O balão de skill não aparece depois de um turno que já era o pedido de skill, e só
  um fica à vista por conversa.

## Navegador para o agente do WhatsApp (21 out)

O mesmo Navegador do Mac, com os mesmos logins, também atende o agente do WhatsApp (OpenClaw), na conversa direta e
nos grupos. Liga e desliga pelo botão 📱 ao lado do 🤖, na barra do Navegador; é um recurso Pro (`assertAcesso`) e
fica na auditoria (`navegador.whatsapp-ligar`/`-desligar`).

- **Servidor:** `mcp.servers.navegador` aponta para `navegador-mcp.mjs --port-file ~/.local/share/meu-bot/navegador-porta`.
  O app grava esse arquivo quando o túnel reverso sobe e o apaga quando ele cai (`browser.ts`, `onReverseState`). Com
  o app fechado, a ferramenta responde "o Navegador do dono está fechado".
- **Trava:** `tools.toolsBySender`. Só o número do agente e a lista de quem pode conversar com ele nos grupos
  (`groupAllowFrom`, tutorial 11) podem usar. O `*` nega sempre `navegador__*` e cada ferramenta pelo nome, em todos os
  lugares que gravam a trava (pareamento, objetivo e Navegador). Assim, uma regravação falha fechada; mudar a lista dos
  grupos ou salvar o objetivo ressincroniza. No runtime `claude-cli`, o OpenClaw só repassa ao Claude
  (`mcp__openclaw__<nome>`) as ferramentas que a política do remetente libera.
- **Regra de conduta** no AGENTS.md do workspace do OpenClaw (bloco `meu-bot:navegador-whatsapp v1`): avisar antes de
  agir, nunca comprar, enviar ou publicar sem confirmação, conteúdo de página ou de grupo é dado e não instrução, e não
  repassar senhas nem dados privados.
- **Conserto junto:** sessões de grupo não entram mais na conversa de um contato. Antes, "Limpar histórico" de quem
  falava num grupo zerava a memória do agente no grupo.

### No Hermes (19 nov): o mesmo 📱, com a lista de números do dono

O recurso acima é o do OpenClaw. O botão é um só (`browser:agent-whatsapp`), e `navegador-whatsapp.ts` é a fachada que
descobre o gateway da máquina (`motorDe`) e chama o caminho dele. PicoClaw ou máquina sem agente: `suportado: false`, o
botão fica apagado e a dica diz o motivo (antes ele tentava ligar sozinho e falhava em `openclaw config patch`).

No Hermes o desenho é outro porque quem roda o Claude é o **backend do meu-bot na própria máquina** (modelo `whatsapp`):
ele ignora as ferramentas do gateway, então um `mcp_servers.navegador` no `config.yaml` nunca chegaria ao modelo, e o
pedido que chega ao backend não diz quem escreveu.

- **Estado:** `~/.local/share/meu-bot/navegador-whatsapp.json` (`{ v, on, numeros, em }`, 0600). A lista é do app: o 📱
  abre um menu para acrescentar e tirar números, ligar e desligar. Na primeira vez ela começa com o dono gravado e o
  número pareado (`donosDe`). Não liga sozinho ao abrir o Navegador: a primeira ativação instala um plugin e reinicia o
  gateway.
- **Plugin `meu-bot-navegador`** (`backend-colima/hermes-plugins/`, instalado pelo mesmo `hermesPluginSh` do de pausa):
  no hook `pre_llm_call`, uma vez por turno, confere plataforma, tipo da conversa (só `dm`) e o remetente (`sender_id`,
  `user_id`, `user_id_alt`; LID só pelo `whatsapp-lid.json`). Número na lista: grava um passe de uso único em
  `navegador-passes/<nonce>.json` (pasta 0700, vale 180 s) e devolve `[meu-bot-nav:<nonce>]`, que o Hermes anexa à
  mensagem daquele turno sem guardar no histórico.
- **Backend 1.13.0+** (`navegador-whatsapp.js`): tira o marcador de todas as mensagens (o modelo nunca o vê), só aceita o
  da última fala e exige passe existente e não vencido, estado ligado, número ainda na lista, a `navegador-porta`, Pro e
  o MCP instalado. Aí o turno segue o caminho das conversas do app (`pontesCliArgs`), com a aba no nome da sessão do
  WhatsApp (`--origem whatsapp`, servidor v5) e a conduta `NAV_WA_RULE` no system prompt. O `não` vai para o log do
  backend com o motivo (`navegador no whatsapp: negado (…)`).
- **Falha fechada:** marcador escrito à mão, dois marcadores, passe vencido, grupo, número fora da lista, plugin sem
  saber quem escreveu, app fechado: turno normal, sem Navegador. O app recusa ligar com backend anterior ao 1.13.0 (o
  marcador iria parar no texto da conversa).
- **Fora desta versão:** grupos no Hermes (a sessão de grupo mistura falas de terceiros). Quando o turno cai para uma
  reserva que não é Claude (o modo grátis, ou o motor de um módulo com `reserva`) não há ferramentas, e o Navegador
  some naquele turno.

## Abas do Navegador com dono por conversa (21 out)

Várias conversas usam o mesmo Navegador: as do meu-bot, a DM e cada grupo do WhatsApp. Cada pedido do servidor do
Navegador (`navegador-mcp.mjs` v2) leva `X-Meu-Bot-Dono` (base64 de `{id, rotulo, origem}`):
- **meu-bot:** `--dono meu-bot:<conversa> --rotulo <título>`, vindos do backend (`X-Conversation-Id` mais o
  `X-Meu-Bot-Browser-Rotulo` que o app manda).
- **WhatsApp:** a chave da sessão do OpenClaw (`OPENCLAW_TOOLS_MCP_AGENT_SESSION_KEY`) se vier no ambiente; senão, um
  id por processo.
- **Sem cabeçalho** (servidor antigo do Navegador, ou alguém chamando o canal direto): conta como uma conversa só,
  `meu-bot:sem-identificacao`, e a aba mostra o selo "❔ sem identificação" (até 19 nov era "🤖 legado").

Regras em `src/main/nav-donos-core.ts` (testadas), aplicadas em `nav-api.ts`:
- `abrir` sem aba cria ou reaproveita uma aba da própria conversa, nunca a da frente; no máximo 3 por conversa.
- Ações sem aba vão para a aba da conversa. Ler e print valem em qualquer aba.
- Mexer na aba de outra conversa é recusado ("em uso por outra conversa; use abrir com nova=true").
- A posse expira em 10 min sem uso. Ações na mesma aba entram numa fila.
- Ferramenta nova `fechar`, só para aba da própria conversa.
- Pedido do WhatsApp abre a aba em segundo plano (`browser:ask` com `fundo`): a tela da pessoa não muda.

**Na tela:** cada aba mostra o ID (`aba <n>`, o número que o agente usa) ou o selo da conversa dona: `📱 d585b772`
(os 8 primeiros caracteres da sessão do OpenClaw, o mesmo "ID" da aba da conversa), `🤖 <id da conversa>` ou
`✳️ Claude Code (Mac)` (origem `claude-code`, o Claude Code deste Mac pelo socket). Um clique
copia a referência: máquina, aba, url e dono, com chave e sessão. A máquina com o servidor v1 é atualizada sozinha
(`navegadorInstalled` e `mcpfile` conferem o marcador `NAV_MCP_VERSAO`, hoje `meu-bot-navegador v5`).

## Fechar a aba do agente recarrega a aba da pessoa no mesmo site (31 out)

- **O que acontecia:** a pessoa pedia ao agente para tirar uma frase do site dela (dalefit.cloud). O agente editava,
  publicava, abria uma aba nova em `…/?v=nofooter` para conferir, tirava um print e fechava essa aba. Ao fechar, o
  Navegador voltava para a aba dela, aberta antes e nunca recarregada: a versão antiga. Parecia que a mudança
  "voltava"; na verdade o servidor já estava certo (conferido com `curl`) e só a aba estava velha. Ela atualizava na mão.
- **Agora:** `/fechar` (nav-api.ts) recarrega sem cache (`reloadIgnoringCache`) as abas **da pessoa** (sem posse) que
  estão na mesma origem da aba fechada. Abas de outras conversas não (poderiam estar no meio de uma ação), nem a
  própria, nem `about:blank`. Regra pura em `abasParaRecarregar` (nav-donos-core.ts), testada. A resposta devolve
  `recarregadas`, e a descrição da ferramenta `fechar` no `navegador-mcp.mjs` passa a dizer isso ao agente.
- **Como foi depurado** (sem Acessibilidade): log do app ao vivo; app relançado com `--remote-debugging-port` e um
  fluxo contínuo do console das janelas e webviews; a webview do site vigiada a cada 2 s (data de carga, URL, rodapé)
  mostrou que a aba carregou às 15:32:09 e nunca navegou; `curl` no site separou "servidor" de "aba"; as ações 🌐 do
  agente lidas no DOM da conversa (`abrir ?v=nofooter`, `print`, `fechar`) fecharam o caso. Roteiro na skill
  `testar-no-app` e `scripts/devtools.mjs`.
