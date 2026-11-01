# WhatsApp do agente

> Parte do diário técnico do meu-bot, dividido por assunto em 27 out 2026. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

## WhatsApp do Hermes: estado e pareamento por QR no app (15 out 2026)

- Motivo: o WhatsApp do gateway do Hermes na grokbot-1 estava deslogado ("❌ Logged out" no
  `~/.hermes/whatsapp/bridge.log`; o gateway tenta reconectar a cada 60/120/240 s e falha). Antes,
  parear era `hermes whatsapp` no terminal da máquina. Referência: `~/Desktop/qr-hermes-padrao`
  (painel Next.js que roda o bridge em `--pair-only --pair-json`).
- `src/main/whatsapp.ts`: tudo por ssh com `bash -s` (script no stdin, sem quoting). Estado:
  `~/.hermes/whatsapp` existe? + `GET 127.0.0.1:3000/health` do bridge (`status: "connected"` = conectado; não é o "open" do Baileys) +
  `me.id` do `session/creds.json` + "Logged out" nas últimas linhas do bridge.log. Pareamento:
  `pm2 stop hermes-gateway` (senão o bridge do gateway disputa a sessão), opcional `mv session
  session.loggedout-<ts>` (igual ao Hermes), `node bridge.js --pair-only --pair-json --session
  ~/.hermes/whatsapp/session --mode bot` (eventos JSON por linha: started/qr/connected/error), e
  `pm2 start hermes-gateway` no fim, inclusive em cancelamento (trap HUP/TERM/INT) e timeout de 5 min.
  O QR vira PNG no main com o pacote `qrcode` e vai como data URL.
- Renderer: linha `#wa-line` no topo da lista de conversas (só aparece onde há Hermes com WhatsApp),
  verde "conectado · +55 (16) 99229-4486" ou vermelha "desconectado · clique para parear"; modal
  `#wa-dialog` com QR, instrução, log curto, "Gerar QR" / "Reparear (apaga a sessão)" / Cancelar.
  Paleta: "WhatsApp do Hermes: estado e pareamento por QR". Depois do pareamento, re-consulta em 6 s.
- Pegadinhas: sessão deslogada precisa ser movida antes do QR (senão o bridge só repete "Logged
  out"); nunca rodar dois bridges na mesma sessão (conflito 440 derruba a sessão nova); o script
  remoto sempre sobe o gateway de volta.

## WhatsApp: "Só alguns contatos" (18 out 2026)

- Terceiro cartão em "Quem o agente responde": você + os números listados. É `dmPolicy allowlist` com `allowFrom`
  explícito (o dono entra sempre, `selfChatMode true`, grupos desativados, trava de ferramentas só para o dono).
  Os dois primeiros cartões continuam iguais. "Ajustar pelo chat" segue para o resto.
- `replyChoiceOf(dmPolicy, allowFrom, self)`: allowlist com alguém além do dono marca "list"; só o dono (ou vazio,
  ou "*") marca "self". `listedNumbers` e `parseWaNumbers` (puros, testados): um número por linha/vírgula; sem
  "+" e com 10/11 dígitos ganha o 55. O estado traz `allowFrom` lido do `channels.whatsapp` da máquina.
- Clicar no cartão abre o campo logo abaixo (fora do botão); grava só em "Salvar lista"
  (`whatsapp:dm-policy` com `numbers`); o main valida 8 a 15 dígitos.

## Voz das respostas em áudio e o modelo do agente (20 out)

**Voz das respostas.** `install-voz.sh <modo> [voz]` oferece três vozes, todas locais e grátis:
- `faber`: masculina, Piper (~70 MB);
- `dora`: feminina, Kokoro (`kokoro-onnx` 0.4.9 num venv, mais ~350 MB);
- `alex`: masculina natural, Kokoro.

Como funciona:
- O provedor no OpenClaw é sempre o `tts-local-cli`; só o `meu-bot-falar` muda de motor. A voz atual fica em
  `voz/voz-atual`.
- Se o teste do OpenClaw falhar, a voz volta para a anterior.
- A Microsoft "grátis" foi descartada: o serviço devolve 403 e 429.
- **Pela tela:** no tutorial de áudio, uma seção "Voz" com três cartões.
- **Pelo chat** (e pelo dono no WhatsApp): o instalador deixa uma cópia de si em `voz/install-voz.sh` e a skill
  `~/.claude/skills/voz-das-respostas`. No `~/.claude/settings.json` libera só esses comandos.
- O backup guarda a voz (`versoes.vozid`), e a restauração reinstala a mesma.

**Modelo do agente.** Um OpenClaw recém-instalado fica sem `agents.defaults.model` e cai num padrão sem chave
(`openai/gpt-6-astra`): o WhatsApp conecta, mas o agente não responde. O status do WhatsApp e o "Gerar QR"
(`oc_model_ensure`) configuram, com o Claude Code logado, o Claude pelo runtime `claude-cli`: Opus 5.5 como principal,
mais Sonnet e Haiku. Um modelo já escolhido nunca é trocado.

**"Todo mundo" no WhatsApp.** O app grava `allowFrom: ["*"]` antes do `dmPolicy: open`, porque `open` sem `*`
descarta tudo. Depois relê o que ficou gravado (`politicaNaoBate`).

## Skill whatsapp-grupos (21 out)

Grupos do WhatsApp do agente: listar (`wa-admin.sh listar` para o gateway por ~30 s, com backup das credenciais),
habilitar e desabilitar (`habilitar.py`: diagnóstico primeiro, depois `--aplicar --remetentes +55…`) e criar grupo.
Ela foi adaptada da skill da máquina agente-openclaw e fica em `backend-colima/skills/whatsapp-grupos`, com o
`SKILL.md` genérico (descobre conta e modelo na hora).

O `install-guarda.sh` a instala em `~/.claude/skills/whatsapp-grupos` junto da guarda. A guarda subiu para a 1.2.0,
então as máquinas que já a têm recebem a skill na próxima abertura do app. O cache `data/` da conta nunca é tocado.

Com `allowFrom: ["*"]`, habilitar um grupo sem `--remetentes` deixaria qualquer membro acionar o agente: a skill
manda sempre usar `--remetentes`.

## Pausar contato no Hermes (25 out)

> Superada em 30 out pelo plugin `meu-bot-pausa` (seção no fim deste guia); este jeito continua valendo só em máquina
> sem o plugin. Está na tabela de contornos como #1 (`docs/guia/contornos.md`).

O Hermes não tem pausa por contato (o OpenClaw tem `sendPolicy` por sessão). Pausar lá é **tirar o número da lista de
quem o agente responde** (WHATSAPP_ALLOWED_USERS, relida ao vivo) enquanto a pausa durar, e retomar é devolvê-lo.
Diferença dita na tela: o agente nem vê as mensagens da pessoa nesse período.

- Marca `paused: { número: ISO }` em `whatsapp-lista.json` (dona: `whatsapp-marks.ts`); só o main grava. A lista do
  app e o status leem a marca; o cartão "Quem o agente responde" continua mostrando o número (união com os pausados)
  e, ao gravar, deixa os pausados fora (`setDmPolicyHermes`).
- `hermesPausaPlano` (puro, testado): lista efetiva = lista de hoje ± o número, sempre com o próprio, sem os outros
  pausados; fixa `WHATSAPP_MODE=bot` e `WHATSAPP_DM_POLICY=allowlist` (em pairing um número fora da lista receberia
  pedido de pareamento); reinicia só se modo/política mudaram. Recusa "só você", desligado e "todo mundo".
- `pauseHermes` (whatsapp.ts): grava o .env com backup, reinicia se preciso, relê e confere a lista e só então grava
  a marca. Capacidade `pausar` do Hermes ligada.

## Hermes: "todo mundo" precisa de `WHATSAPP_ALLOWED_USERS=*` (30 out)

- O bridge.js (Node) do Hermes filtra as conversas diretas pela `WHATSAPP_ALLOWED_USERS` antes de o gateway Python
  ver a mensagem, e só conhece `*` como "qualquer um" (`allowlist.js`, `matchesAllowedUser`). `WHATSAPP_DM_POLICY=open`
  e `WHATSAPP_ALLOW_ALL_USERS=true` valem só no Python (`authz_mixin`). Com `open` e a lista com números, quem não
  está nela morre no bridge com `allowlist_mismatch` em `~/.hermes/whatsapp/bridge.log` e o agente nem vê a mensagem.
- Caso que motivou: box-1, 30 out. "Todo mundo" gravava `open` + opt-in e mantinha a lista antiga (o próprio número
  e o dono): o bot mandava mensagem (o `/send` não passa pela lista) mas não respondia ninguém além do dono.
- Agora `hermesEnvPara("open")` grava a lista como `*`; "só você" e "você e a lista" continuam reconstruindo a lista
  a partir do próprio número e dos números da tela. Numa máquina gravada pela versão antiga, basta escolher
  "todo mundo" de novo no cartão (a lista muda, o app reinicia o gateway).

## Hermes: o agente da máquina manda mensagem com `wa-enviar` (30 out)

- Caso que motivou: no box-1, o agente da máquina (Claude Code em `~/agent-workspace`) mandou uma mensagem à Kathy
  por `curl localhost:3100/send`. Chegou no celular, mas não entrou na sessão dela no Hermes: a conversa do app não
  mostrava a mensagem e a Karen não sabia o que tinha perguntado.
- Nativo: `hermes send --to whatsapp:<chat>` usa a mesma `send_message_tool` do agente, que espelha o texto na sessão
  do contato (`gateway/mirror.py`, `mirrored: true` no `--json`). Só espelha quando o alvo é o chat como o Hermes o
  conhece, o LID (`hermes send --list whatsapp`); com o JID de telefone a entrega sai mas o espelho avisa "no session
  found". Pela ponte nunca espelha.
- `backend-colima/wa-enviar` (vai no bundle do backend; `install-porteiro.sh` o grava em `~/.local/share/meu-bot/bin/`):
  `wa-enviar <número com DDI> "<texto>"` resolve número → LID pelo `lid-mapping-<número>.json` da sessão e chama o
  `hermes send`; diz "ENVIADA E REGISTRADA" ou avisa "SEM registro" (contato ainda sem sessão). Nas máquinas com
  `~/.hermes`, o instalador põe a regra no `~/agent-workspace/CLAUDE.md` (bloco `meu-bot:wa-enviar v1`): usar o
  comando, nunca a ponte, e confirmar o texto com quem pediu antes de enviar. `uninstall-porteiro.sh` desfaz os dois.
- Mensagem já enviada pela ponte pode ser espelhada depois com `gateway.mirror.mirror_to_session(...)` da venv do
  Hermes, passando `session_id` (foi o que se fez com a da Kathy em 30 out).

## Grupos no Hermes: ligar/desligar e "quando chamado" (25 out)

Na máquina com Hermes a política de grupos mora em `~/.hermes/config.yaml` (`platforms.whatsapp`): `group_policy`
(`allowlist` + `group_allow_from` com os jids; `open` = todos, exige WHATSAPP_ALLOW_ALL_USERS; `disabled`/`pairing` =
nenhum), `require_mention` (global) e `free_response_chats` (jids que respondem sempre). Quem fala dentro de um grupo
admitido passa pela MESMA lista das conversas diretas (WHATSAPP_ALLOWED_USERS): não há "quem aciona" por grupo. O yaml
tem precedência sobre o .env e os dois são lidos na subida do gateway (`pm2 restart hermes-gateway --update-env`).

- **Tradução** (`whatsapp-hermes-core.ts`, puro, testado): `desligado` = fora da lista; `sempre` = admitido e (sem
  menção obrigatória ou nas exceções); `mencao` = admitido com menção obrigatória. `hermesGroupCfgPara` faz a config
  nova: ligar entra na lista (`allowlist`), desligar sai (o último volta a `disabled`); o primeiro "quando chamado" numa
  máquina que respondia a tudo liga `require_mention` e põe os outros ligados em `free_response_chats`, para ninguém
  mudar sem querer. "Quem pode conversar" é recusado com a explicação (mude em "Quem o agente responde"); com `open`/"*"
  não dá para desligar um grupo só (explica, em vez de chutar).
- **Leitura** (`HERMES_GROUP_CFG_SH`, python da venv do Hermes com PyYAML): yaml, chaves soltas ou em `extra`, senão
  o .env. `gruposHermes` junta a lista admitida com as sessões de grupo do state.db (uma por remetente; a mais
  recente dá hora, chave e id) e `quemAciona` = lista das conversas diretas, nunca "herdado".
- **Escrita** (`hermesGroupCfgSetSh`): ruamel round-trip (comentários e prompts por grupo ficam; indentação do
  arquivo), backup `config.yaml.bak-meu-bot-<ts>`, tmp + rename, as mesmas chaves saem de `extra:`; depois
  `HERMES_RESTART_SH` e releitura conferida (`setGroupHermes` em whatsapp.ts). Capacidade `grupos` do Hermes ligada.
- Caso que motivou: "liberar para todo mundo" num grupo da `grokbot-1` dava "não consegui ler a configuração do
  WhatsApp (~/.openclaw/openclaw.json)".

## Excluir grupo da lista (25 out)

"Excluir da lista" no menu "…" de um grupo é só tirar da vista, como na conversa: a marca mora na máquina
(`whatsapp-lista.json`, chave `groupsDeleted: { "<jid>@g.us": ISO }`, dona do formato `whatsapp-marks.ts`), os dois apps veem a
mesma lista e o `openclaw.json` não muda. Volta sozinho quando o agente recebe mensagem nova do grupo (`updatedAt` da
sessão > hora da exclusão; sem sessão, continua excluído até a primeira). Aparece sempre, nos dois gateways e com o
agente ligado ou não (decisão do dono em 25/10: "deve ter no grupo e na conversa normal"); um grupo ligado excluído some da
lista, mas o agente continua respondendo nele, porque a marca não mexe na configuração. Excluído vira "Restaurar na lista" no menu;
o admin, com o interruptor de arquivadas, vê os excluídos para restaurar. Auditoria: `whatsapp.grupo.excluir`/`restaurar`.
Caso que motivou: grupo "zohomail" na `grokbot-1`, sem sessão, que não tinha como sair da lista.

## Grupos no app, tutorial 11 e monitor (21 out)

**Área "Grupos" na lista do WhatsApp.** Fica no fim da lista e pode ser recolhida. Junta três fontes:
- as sessões de grupo do `sessions.list`;
- o `channels.whatsapp` do openclaw.json;
- o cache da skill (`data/grupos-live.json`).

Cada grupo leva um selo: "quando chamado", "sempre" ou "desligado". A página do grupo mostra a conversa só para
leitura, com o autor de cada mensagem, e o resumo de quem aciona o agente. O menu "…" oferece:
- Ligar/Desligar;
- Quem pode conversar…;
- Copiar ID;
- Atualizar lista (pede confirmação, porque para o gateway ~30 s).

O dono das regras é `src/main/whatsapp-grupos-core.ts`, com as mesmas regras do `habilitar.py`:
- ligar usa `allowlist` mais `groups[jid]`;
- desligar o último grupo volta para `groupPolicy: disabled` e apaga `groups`, porque vazio admitiria todos;
- `groupAllowFrom` nunca fica vazio com o agente ligado, porque herdaria o `allowFrom ["*"]` das diretas;
- "todos do grupo" é `groupPolicy: open`, nunca um `*` na lista, e na tela fica atrás de um aviso vermelho com
  confirmação dupla.

A gravação usa `openclaw config patch --stdin`; depois o app relê o openclaw.json e confere. Os canais IPC são
`whatsapp:groups`, `whatsapp:group-thread`, `whatsapp:group-set`, `whatsapp:groups-refresh` e `ui:wa-group-menu`,
compartilhados pela pessoa e pelo admin. Na auditoria entram `whatsapp.grupo-ligar`, `grupo-desligar` e
`grupo-quem`.

**Tutorial 11 · O agente nos grupos do WhatsApp** (after 3, o do WhatsApp). Os passos são:
1. escolher o grupo, com o aviso fixo "nunca grupo com clientes";
2. quem pode conversar: só você por padrão, mais os membros ou números digitados;
3. como responde: só quando chamado (padrão) ou sempre;
4. testar: o passo se conclui quando aparece uma resposta do agente no grupo.

O passo "quem" do tutorial 3 aponta para este tutorial quando a máquina tem grupos.

**Monitor.** `skills/whatsapp-grupos/scripts/monitor.py` lê o SQLite do OpenClaw (`session_nodes` →
`transcript_events`, `event_zstd` quando houver) em modo só leitura e segue o `/new` sozinho. Também junta os alertas
do journal e esconde tokens. Vai com a guarda 1.3.0.

## Vigia do gateway e wa-admin.sh fora do gateway (21 out)

**O que aconteceu na box-lv.** O agente chamou o `wa-admin.sh listar` de dentro da conversa do WhatsApp. O
`systemctl stop` ficou esperando a própria execução que o chamou (`draining … rootRequests=1`), e depois de ~5 min o
systemd matou tudo junto, inclusive o "religar". O WhatsApp só voltou porque o processo pendurado ainda religou no
fim. O número continuou vinculado: parar o gateway nunca pede QR de novo; só um logout pede.

**Consertos (guarda 1.4.0):**
- O `wa-admin.sh` detecta que está no cgroup do `openclaw-gateway.service` e se relança fora, com `systemd-run --user`,
  devolvendo na hora (o log fica em `data/wa-admin-ultimo.log`). Ele também recusa argumentos de exemplo
  (`<trecho do nome>`) e grava a trava `~/.cache/meu-bot/wa-admin.lock`.
- `guarda/vigia-gateway.sh` roda pelo timer de usuário `meu-bot-vigia-gateway.timer`, a cada minuto, instalado pelo
  `install-guarda.sh` e removido pelo uninstall. Ele religa o gateway habilitado que está `inactive` ou `failed`,
  desde que a trava esteja livre (ou tenha mais de 15 min). A cada 5 min reinicia o gateway se o WhatsApp está
  "linked but disconnected" há 3 checagens seguidas. Nunca desloga e nunca mexe em credenciais. O
  `disable --now` da migração de máquina é respeitado: serviço desabilitado não é tocado. Cada ação vai para
  `~/.cache/meu-bot/vigia-gateway.log` e para a auditoria (`servico.religar-gateway`, quem: sistema).
- O "Atualizar lista" do app dá até 7 min para o `wa-admin.sh`, porque o gateway pode demorar para drenar.

## Espelho do WhatsApp em máquina com Hermes (24 out)

Até aqui a lista de conversas do WhatsApp (modo "WhatsApp" da lista lateral) só existia com o OpenClaw: `whatsappChats`
chamava `openclaw gateway call sessions.list` e `whatsappThread` o `chat.history`. Na `grokbot-1` (Hermes Agent
v0.21.1) a linha de cima mostrava "conectado", o pareamento por QR funcionava, mas nenhuma conversa aparecia.

- **Onde o Hermes guarda:** `~/.hermes/state.db` (SQLite, WAL). `sessions`: uma por contato, `source = "whatsapp"`,
  `chat_type = "dm"`, `session_key = "agent:<perfil>:whatsapp:dm:<número>"`, `display_name` = o nome do contato,
  `started_at`/`last_activity_at` em segundos, `hidden`/`archived`; grupos são `…:whatsapp:group:<jid>:<quem falou>`
  (uma sessão por grupo e por remetente). `messages`: `role` user/assistant/tool/session_meta, `content`, `timestamp`
  em segundos, `display_kind` hidden/internal_notification para o que não foi ao WhatsApp; `assistant` vazio = turno
  só de ferramenta. O próprio número vem de `~/.hermes/whatsapp/session/creds.json` (`me.id`).
- **`whatsapp-hermes-core.ts` (puro, testado):** `HERMES_LIST_PY` e `HERMES_THREAD_PY` (Python com `sqlite3`, banco
  aberto com `mode=ro`, JSON numa linha; o pod não tem o `sqlite3` de linha de comando), `chatsFromHermes` (uma conversa
  por contato, nome do `display_name` quando não é só dígitos nem `…@lid`, escondidas fora, `ownSession` sempre,
  `paused` nunca) e `threadFromHermes` (user = contato, assistant = agente; fora ferramentas, metadados, vazias,
  `NO_REPLY` e hidden/internal_notification).
- **`whatsapp.ts`:** o script de `whatsappChats` escolhe na máquina: com `~/.hermes/whatsapp` lê o state.db e devolve
  `gateway=hermes`; senão o OpenClaw como antes. `whatsappThread` vai pelo `hermesThread` quando as chaves são do Hermes
  (`isHermesKey`). `whatsappLearnNames` não faz nada no Hermes (o nome já vem na lista). `whatsappGatewayOf(host)`
  guarda o gateway da última consulta para o menu.
- **Menu "…" (`wa-menu.ts`):** `waMenuTemplate(state, caps, gateway)`; no Hermes saem "Pausar" e "Limpar histórico" (são
  `sessions.patch`/`sessions.reset` do OpenClaw). Ficam Conversar, Exportar, Copiar ID, Renomear, Arquivar e Excluir
  (as marcas moram em `~/.local/share/meu-bot/whatsapp-lista.json`, iguais nos dois gateways).
- **Tela:** `waMirrorAvailable` aceita `hermes`; a política de DM, os grupos e a guarda continuam só do OpenClaw
  (já eram condicionados a `gateway === "openclaw"`). Fica de fora por ora: grupos do Hermes (as sessões existem no
  banco, por remetente) e o PicoClaw.

## Hermes com vários usuários na mesma máquina e RAM (28 out)

- **Porta do bridge por usuário:** o Hermes usa a 3000 quando ninguém diz outra; com dois usuários com WhatsApp na mesma
  máquina, o segundo gateway não subia. O root fica na 3000 e os outros ganham **3100 + (uid − 1000)**, gravada como
  `platforms.whatsapp.bridge_port` no config.yaml por `HERMES_WA_ENSURE_SH`. O app lê a porta de cada um por
  `HERMES_BRIDGE_PORT_SH` (config, depois o registro do Hermes, depois a regra) em vez de olhar a 3000 fixa.
- **Whisper ocioso:** o ajuste de transcrição grava `stt.local.unload_after_idle_seconds: 300`. O modelo carrega no
  primeiro áudio e sai da memória 5 min depois do último: na meu-root o gateway caiu de 526 MB para 208 MB parado.
- **Lista de grupos pelo WhatsApp:** `hermes-grupos-listar.ts` para o gateway, lista com o Baileys do bridge do Hermes
  (`groupFetchAllParticipating`) e grava o cache que `gruposHermes` lê; "Atualizar lista" no tutorial 11.
- **Objetivo (tutorial 8):** a skill `objetivo-whatsapp` vai para a pasta do agente escolhido (Hermes:
  `~/.hermes/skills/`; OpenClaw: o workspace) e uma cópia antiga no lugar errado é movida na leitura.
- **Nível de liberdade no Hermes:** quem executa é o Claude Code do backend, então a trava fica lá (ver agente.md,
  "Nível de liberdade no backend").

## Ideias trazidas do agente-rene: voz limpa, freio em grupo, memória do dono e vigia da máquina (28 out)

Comparação com o agente-rene (`~/.hermes/agente-rene`). O meu-bot já pausava loops em conversas diretas melhor que
ele (a guarda). As automações de vendas dele ficaram de fora a pedido. O resto entrou assim:

**Voz sem markdown nem números crus (backend 1.5.0).**
- `backend-colima/fala-texto.py` (Python puro) prepara o texto antes do Piper/Kokoro:
  - números por extenso do jeito falado ("mil duzentos e trinta e quatro");
  - R$, %, hora, data e ordinal;
  - concordância antes de horas/pessoas/vezes ("vinte e uma horas");
  - telefone, CPF e CEP dígito a dígito;
  - link e bloco de código viram "o link que mandei por escrito";
  - tira markdown e emoji.
- O `install.sh` copia o script para `~/.local/share/meu-bot/fala-texto.py`.
- **OpenClaw:** o `meu-bot-falar` virou a porta de entrada. Ele limpa o texto e chama o `meu-bot-falar-motor`, que é o
  Piper ou o Kokoro gravado pelo `install-voz.sh`.
- **Hermes:** o `hermes-voz.sh` ganha a linha `HERMES_VOZ_FILTRO`. O Piper lê o texto limpo pelo fd 3 (o arquivo
  temporário já foi apagado).
- Máquinas com voz de antes são ajustadas pelo `install.sh`, sem reinstalar a voz.
- Sem python3, ou com falha, a voz fala o texto original.

**Freio de loop em grupos (guarda 1.6.0, só OpenClaw).**
- O `GroupBrake` (`guarda/regras.mjs`) segura as respostas de um grupo por 5 min em dois casos:
  - o agente passa de 8 respostas em 5 min;
  - ele repete despedidas ou textos quase iguais (o `LoopTracker` no modo "só saída").
- Solta sozinho, sem `sendPolicy deny`. Registra uma vez no log e na auditoria (`whatsapp.grupo.freio`).
- O teto é ajustável pelo `pluginConfig` (`grupoMaxRespostas`, `grupoJanelaMin`).
- **Hermes fica sem esse freio:**
  - o grupo só aparece no texto do prompt dele ("**Source:** WhatsApp (group …)", `gateway/session.py`), sem
    cabeçalho nem id. Ler essa linha quebraria a cada versão do Hermes;
  - lá o freio é o `require_mention`.
- **API oficial (`wa-cloud`):** não tem grupos. O freio de conversa direta (`LoopTracker`) está no backlog dela.

**Memória do dono pelo WhatsApp (guarda 1.6.0, só OpenClaw).**
- No chat do dono consigo mesmo, três atalhos (`guarda/memoria.mjs`):
  - "lembre que …", "lembra que …", "anota que …" ou "anota: …" grava;
  - "esquece que …" apaga as linhas com o trecho;
  - "o que você lembra (sobre …)?" lista.
- "apaga/remova X" e "me lembre que …" seguem para o agente como pedido normal.
- O arquivo é `~/.local/share/meu-bot/memoria-dono.md` (0600, até 4.000 caracteres).
- No `before_prompt_build`, a guarda põe a memória nos turnos do dono e, no turno do atalho, uma nota para o agente só
  confirmar. O turno ainda acontece, porque o plugin não responde no lugar do agente.
- **Contatos não chegam aqui:** o remetente é conferido com o `me.id` do `creds.json`.
- **Hermes fica de fora:** o backend não sabe quem mandou.

**Vigia da máquina e faxina (backend 1.5.0).**
- **Vigia:** o `saude-maquina.js` lê, a cada 30 s, a memória, o swap (`/proc/meminfo`), o disco do HOME e o atraso do
  event loop. O resultado vai no `/health` (`maquina`).
  - Avisa o dono pelo `alertas.json` (WhatsApp e e-mail) quando a memória fica abaixo de 10% por 3 leituras, o disco
    abaixo de 5% ou o backend trava por 3 leituras.
  - No máximo 1 aviso por tipo a cada 6 h; `saude-avisos.json` guarda os horários.
  - Também grava na auditoria (`maquina.memoria`, `.disco`, `.lag`).
  - Teste: `MEU_BOT_VIGIA_MEM_PCT=100` no `.env`.
- **No admin:** a linha de memória mostra o swap ("sem swap") e usa a mesma régua de 10%. O alerta do vigia aparece
  como "vigia: …" (a sondagem lê `maquina.alerta` do `/health`).
- **Faxina** (`faxina.js`, uma vez por dia):
  - `contas-claude-eventos.jsonl` fica com as últimas 2.000 linhas;
  - `backend.log` (modo nohup) e `vigia-gateway.log` passam para `.1` acima de 5 MB.
- **Ficam de fora de propósito:**
  - `auditoria.jsonl` (é a corrente com selo);
  - as conversas;
  - o journald.

## Tutorial 4: ouvir áudios, separado do tutorial 3 (29 out)

- **Por quê:** a transcrição era o passo "Áudio no WhatsApp" do tutorial 3, com "Pular: sem áudio por enquanto". Quem
  pulava terminava o 2 e o agente seguia respondendo "não consigo ouvir seu áudio", sem nada pendente na lista. Caso
  real: o Daniel, no meu-box-2 (Hermes), mandou um áudio e o gateway registrou `No STT provider available`.
- **Agora:** o tutorial 3 tem 5 passos (escolher, preparar, QR, quem responde, testar com texto). O tutorial 4, "Ouvir
  áudios do WhatsApp" (`audio-whatsapp`, depois do 2), tem dois passos: ativar a transcrição (concluído pelo
  `audioIn` da máquina) e testar com um áudio ("Ele entendeu meu áudio"). `renderAudioControls(…, "ouvir")` desenha
  só a linha da transcrição; o painel de gerência do 2 usa `"responder"` (resposta em áudio e voz).
- **Hermes global, usuário novo:** `hermes pm install --extra stt-whisper` recusava com "tools not on PATH before venv
  sync: ffmpeg: …; ripgrep: …", porque as ferramentas do pm são por `HERMES_HOME`, e o app só via "extra=falhou".
  `hermesPmExtraSh` lê essa lista, instala só aquelas ferramentas (`hermes pm install ffmpeg ripgrep`) e tenta o extra
  de novo. Não usa `--tools-only`, que traria também o Chromium.
- **Hermes global, reinício do gateway:** o serviço do usuário chama `<código>/.hermes/bin/hermes`, que antes passava
  pelo lançador Node do pacote npm; ele não repassa SIGTERM ao Python e o `KillMode=mixed` do systemd dava SIGKILL no
  gateway ("exited UNCLEANLY" no `gateway.log` a cada reinício). Agora o atalho dá `exec` direto em `venv/bin/hermes`
  (CONTORNO #6 em `contornos.md`), o Python vira o PID principal e o desligamento limpo roda. Vale depois de rodar o
  instalador de novo na máquina.
- **Transcritor compartilhado (padrão da máquina):** o root instala uma vez, junto com o Hermes global
  ("Instalar Hermes para todos" no admin), o `/opt/transcriber`: dono root, `755` como o `/opt/hermes`, com um
  ambiente Python próprio (`faster-whisper==1.2.1`, `av==18.1.0`; o av 19 quebra o `decode_audio`), o modelo
  `whisper-small` (copiado de `/opt/hermes/modelos` quando já está lá) e o `bin/transcrever`. Sem grupo: todos leem e
  executam, só o root grava. Cada Hermes chama o binário como o próprio usuário, pelo provedor `local_command`
  (`HERMES_LOCAL_STT_COMMAND` no `~/.hermes/.env`, que é o único lugar onde o Hermes lê esse comando). Com isso, o
  "Ativar transcrição" do tutorial 4 só confere `[ -x /opt/transcriber/bin/transcrever ]`, aponta e reinicia, em
  segundos. Sem o binário (máquina de antes do padrão), instala o extra por usuário como antes. A leitura da máquina
  no admin mostra `HERMES=sem-transcritor` e oferece "Instalar o transcritor para todos".

## Pausa com prazo e o plugin meu-bot-pausa do Hermes (30 out)

O que aconteceu no box-2: o Daniel pausou o Diego pela interface e o Hermes respondeu ao Diego 20 s depois. Pausar no
Hermes era tirar o número da `WHATSAPP_ALLOWED_USERS`, e o Hermes 0.22.x **não relê** a lista (o adapter guarda
`_allow_from` no `__init__`, `adapter.py:450`; o bridge lê `process.env` ao subir, `bridge.js:126`): só mudança de
modo/política reiniciava o gateway, e a pausa ficava só no arquivo. O mesmo mecanismo tinha trancado o Daniel fora
do próprio bot depois de um Retomar. Em "todo mundo" não havia lista de onde tirar; em "só você" ninguém aparecia
pausado e Retomar dava erro. Issue aberta: NousResearch/hermes-agent#146672. A PR #16 fechou o imediato (qualquer
mudança na lista reinicia; retomar em "só você" vira "você + ele"; fora da lista aparece pausado). Esta leva fez a
pausa de verdade.

- **Plugin `meu-bot-pausa`** (`backend-colima/hermes-plugins/meu-bot-pausa/`, Python só com a biblioteca padrão):
  hook `pre_gateway_dispatch` do Hermes, que roda em cada mensagem **antes** da autorização e pode descartá-la
  (`{"action": "skip"}`) ou reescrevê-la (`rewrite`). Lê a marca do app (`whatsapp-lista.json › paused`, agora
  `{ desde, ate, por }`; o formato antigo, string ISO, ainda é lido), descarta a mensagem de quem está pausado e a
  guarda em `whatsapp-pausados.jsonl`; pausas com prazo vencem sozinhas (é o plugin que apaga a marca; o app só a
  ignora). Na primeira mensagem de texto do contato depois da retomada, reescreve o texto com **uma nota** listando o
  que chegou na pausa ("responda numa resposta só, sem mencionar a pausa") e limpa o jsonl daquele número. Comandos no
  próprio hook (é o único lugar que sabe quem mandou): contato só `/pausar 2h|24h` (pausado ele não consegue pedir
  para voltar, por isso o prazo é obrigatório); dono `/pausar <número> [prazo]`, `/retomar <número>`, `/pausados`.
  A resposta sai pelo `adapters[whatsapp].send`; sem adapter, vai por `rewrite` para o agente entregar. O dono
  (`me.id`/`me.lid` do `creds.json`) nunca é descartado nem pausado; grupos passam reto; qualquer erro deixa a
  mensagem seguir. Uma ferramenta `pausar_conversa(horas)` para o agente só pausa a conversa da sessão atual (número
  tirado de `…:whatsapp:dm:<n>` no contexto; sem contexto, orienta o `/pausar`). Teste roda o plugin de verdade com
  `python3 -I` num HOME falso (`hermes-pausa-plugin.test.mjs`).
- **Instalação** (`whatsapp-hermes-pausa-core.ts › hermesPausaPluginSh`): os dois arquivos vão inline por SSH
  (base64, como o `auditoria.py`), gravados só se mudaram; `plugins.enabled` do `config.yaml` ganha o plugin por
  união com o editor ruamel do Hermes (`HERMES_YAML_PY`); `.ok` com a versão por último; reinicia o gateway só se
  algo mudou e ele está de pé (usuário novo sem gateway: sobe junto). Roda no preparo do usuário (admin,
  `hermesSemearSh`), ao abrir a janela da máquina (`picker.ts › ensureHermesPausa`, só sobe de versão, como a guarda),
  depois de parear (`client.ts`) e pelo botão "Ativar pausa com prazo" no painel do WhatsApp. O plugin é um componente
  versionado (`COMPONENTES › hermes-pausa`, versão no `plugin.yaml`; `release.mjs` lê `version:` de yaml).
- **Detecção por capacidade:** `HERMES_PAUSA_SH` imprime `pausaplugin` (versão no `.ok`), `pausavivo` (versão que o
  `register()` gravou em `whatsapp-pausa.carregado`) e `pausanativa`; `hermesPausaModo` dá `nativa > plugin >
  allowlist`, e plugin só conta instalado **e** carregado na mesma versão. `capacidadesDe(…, { pausaModo })` liga
  `pausaPrazo` e `pausaNativa`.
- **App:** com `pausaPrazo`, o menu "…" vira "Pausar o agente › Por 2 horas / Por 24 horas / Até eu retomar" e
  "Retomar (pausado até 14:30)"; `whatsapp:pause` leva `horas` e a máquina calcula o fim com o relógio dela
  (`waMarkSh`, o mesmo relógio do plugin). `pauseHermes` grava só a marca nesse modo (sem mexer na allowlist, sem
  reinício; retomar quem a política não responde também o põe na lista); sem o plugin, o caminho antigo ficou em
  `aplicarPlanoAllowlist`. A conversa mostra o que chegou na pausa (bolha tracejada, "na pausa · 14:32",
  `whatsapp-pausados.ts`) e quem só escreveu na pausa aparece na lista mesmo sem sessão no `state.db`.
- **Por que plugin e não PR no Hermes:** o hook existe para isso ("plugins can handle unauthorized senders"), vale hoje
  em qualquer versão 0.22, e não depende de revisão nem de atualizar o Hermes nas máquinas. A issue #146672 pede o
  mínimo (relê a lista); se o Hermes trouxer pausa por contato, a tabela de contornos diz como tirar o plugin.

## Dono do agente: quem manda nele (30 out)

Até aqui o app tratava o **número pareado** como a pessoa que manda no agente. Isso só vale quando o agente roda no
próprio número dela (modo `self-chat` do Hermes, cartão "Desativado: só eu falo com o agente"). O Hermes recomenda
**número dedicado** (modo `bot`): a pessoa fala com o agente do celular dela, como contato da lista. E em modo `bot`
o bridge **descarta tudo que vem do próprio aparelho** (`bridge.js`, fromMe): "Lista" e "Todo mundo" nunca atendem o
chat da pessoa consigo mesma — não há modo que atenda os dois. Daí o conceito **Dono**, explícito e pré-preenchido.

- **O que é:** o número da pessoa que manda no agente. Padrão = o pareado (nada a decidir). Troca só para quem tem um
  chip dedicado para o agente e fala com ele do celular. Mora em `whatsapp-lista.json › dono: { numero, desde }` (o
  mesmo arquivo das marcas: os dois apps e o plugin leem; ausente = pareado). `quemDe(marks, self)` → `WaQuem { self,
  dono }` é o único lugar que decide; `souEu` = dono é o próprio aparelho; `donosDe` = os que nunca saem da lista nem
  são pausados. `waMarkSh` passou a devolver o arquivo inteiro (preserva chaves de fora) e aceita `{ dono }`.
- **Efeitos:** o dono e o pareado entram sempre na lista (`hermesEnvPara`); **"só eu" com dono de fora vira `bot` +
  allowlist [pareado, dono]** (contorno #5 em `docs/guia/contornos.md`) — assim o cartão funciona também no chip
  dedicado; com dono == pareado continua `self-chat`. O home channel do Hermes (avisos e cron: `.env`
  `WHATSAPP_HOME_CHANNEL`/`_NAME` e `platforms.whatsapp.home_channel` no config.yaml, iguais, jid em
  `@s.whatsapp.net`) aponta para o dono ao trocar; o preparo depois do QR o deixa no próprio número quando não há
  nenhum (nunca sobrescreve um existente). O dono nunca é pausado (`whatsappPause` recusa; o menu não oferece). No
  OpenClaw a trava de ferramentas (`toolsBySender`) e o `allowFrom` de "só eu" seguem o dono.
- **Plugin meu-bot-pausa 1.1.0:** `_dono()` soma o `dono.numero` do arquivo ao `me.id`/`me.lid` (cache por mtime de
  cada fonte): do celular dele, `/pausar <número>` e `/pausados` funcionam.
- **UI, sem tela nova:** no bloco "Quem o agente responde" (modal e tutorial 3), acima dos cartões, a linha
  `Dono +55 … · você (este número)` (ou `· você, do seu celular (o agente atende em …)`) com **Trocar** → campo inline
  com Salvar / Cancelar / Voltar para este número e o hint "O dono fala com o agente de qualquer modo, nunca é pausado
  e recebe os avisos. Troque só se o agente roda num número dedicado e você fala com ele do seu celular." O cartão
  "só eu" diz "só responde ao dono (+55 …)" quando o dono é de fora; Lista e Todo mundo (Hermes, agente no próprio
  número) avisam que o próprio chat não é respondido nesses modos. Linha de estado: "só você" / "só o dono" / "a
  lista". Lista de conversas: etiqueta `dono`, "Você (dono)" sem nome; o admin vê a linha sem o botão. Trocar o dono
  reaplica a política e reinicia o gateway (a conexão fica "segurada", como no áudio). Auditoria: `whatsapp.dono`.
- **Issue upstream a abrir:** *WhatsApp bot mode: opt-in to also answer the owner's self-chat (fromMe). Today
  `WHATSAPP_MODE=bot` drops every fromMe message, so a user running the agent on their own number can't both talk to
  it and serve other contacts; `self-chat` serves only themselves. Proposal: `WHATSAPP_SELF_CHAT=true` honoured in bot
  mode when the paired number is in `WHATSAPP_ALLOWED_USERS`.*

**Vigia da box e vigia da cota (backend 1.9.0).** O vigia da máquina ganhou o tipo `box`: o backend de cada usuário lê o
próprio cgroup (`/proc/self/cgroup` → `/sys/fs/cgroup/user.slice/user-<uid>.slice`: `memory.current`, `anon`,
`memory.high/max`, `memory.events`, PSI de memória e CPU, `cpu.stat`; `saude-maquina.js › caminhoDaBox/lerBox`) e avisa
a pessoa quando a memória própria passa de 95% do MemoryHigh, a PSI de memória de 10%, a de CPU de 50% ou o teto foi
batido desde a leitura anterior, em 3 leituras seguidas (OOM avisa na hora), com texto de memória ou de processador e
"avise o admin em Configurações › Suporte"; `MEU_BOT_VIGIA_BOX_PCT=1` para testar. O vigia da cota (`cota.js`) lê a
cota de disco da conta (`quota -wu`, como a pessoa) e o que ocupa (`du -sk` de uma lista fixa: imagens, áudios,
WhatsApp, conversas, publicações, arquivos do agente, programas do agente) a cada 10 min, nunca com resposta em
andamento; avisa no WhatsApp ao cruzar 80, 95 e 100% uma vez por cruzamento (rearma 5 pontos abaixo; um salto de 70 a
97 manda só o texto de 95), com o que ocupa, como liberar (Configurações › Espaço › Liberar espaço) e como ter mais (o
`pagamento.link` da licença, senão "fale com o admin"); `cota.aviso` na auditoria. Os níveis avisados ficam em
`saude-avisos.json › cota`. O resultado vai em `/health.cota`, `/v1/meu-bot/status.cota` e `GET /v1/meu-bot/cota?fresco=1`.
A cota macia é o limite que a pessoa vê; a dura (folga de 10%/300 MB, 7 dias) é o que deixa o aviso de 100% ainda sair.
Os avisos (Mac novo, vigia, cota) vão só pelo WhatsApp da pessoa: o e-mail pela Resend saiu em 30 out.

## Regra única do motor do WhatsApp (1 nov)

- Motivo: havia quatro regras para decidir se a máquina atende pelo Hermes, OpenClaw ou PicoClaw, e elas divergiam: o
  status da janela (`WA_ESCOLHA_SH`: Hermes vence sem escolha), a sondagem do seletor (`hostProbe.ts`: OpenClaw vence e
  o arquivo de escolha era ignorado), os módulos (`modulos.ts`: sem PicoClaw) e o backend (`server.js`, cópia em JS).
  Numa máquina com os dois motores, o seletor dizia OpenClaw e a janela, Hermes.
- `WA_MOTOR_SH` (`src/main/whatsapp/whatsapp-capacidades.ts`) é a regra: deixa `$ESC` (a escolha gravada em
  `~/.local/share/meu-bot/whatsapp-agente`, que agora aceita `picoclaw`), `$MOTOR` e `usa_hermes`. Precedência: escolha
  gravada > Hermes já com o WhatsApp configurado > binário `openclaw` (PATH ou `~/.openclaw/bin`) > binário `hermes`
  (PATH ou `~/.local/bin`) > `picoclaw` com `~/.picoclaw/config.json`. Uma linha, sem comentários (o `probeScript` junta
  por `; `) e só com `if` (segura sob `set -e`). Todos os consumidores passaram a usá-la: status, pareamento, lista,
  logout (`MOTOR=<qual>` quando a tela manda desconectar o outro motor), grupos, sondagem, módulos, reinício no admin
  (`case "$MOTOR"`) e a pasta de skills do objetivo.
- `backend-colima/motor-whatsapp.js` é o espelho em JS (entra no pacote do backend; VERSION 1.10.0); o `server.js` decide
  por ele por onde mandar mensagem. `scripts/tests/motor-whatsapp.test.mjs` roda o shell e o JS no mesmo HOME de mentira
  em 100 combinações e exige o mesmo resultado.
- Mudança de comportamento: na sondagem do seletor, uma máquina com Hermes configurado e OpenClaw instalado passa a
  aparecer como Hermes (como a janela já dizia); uma máquina com o binário do Hermes mas sem o WhatsApp dele e sem OpenClaw
  aparece como "Hermes sem bridge" em vez de "sem agente".

## Status do OpenClaw com uma chamada só, cache no main e consulta mais espaçada (1 nov)

- Motivo: cada chamada da CLI `openclaw` sobe um Node de ~300 MB na máquina. A consulta de estado fazia 7 ou 8 por vez
  (`--version`, `plugins list`, dois `config get`, `channels status`, mais modelo e reserva), por janela aberta, a cada
  60 s. Na VM agente (8 GB, quatro gateways de ~1,4 GB) isso somava ao OOM.
- `STATUS_SCRIPT` (`whatsapp.ts`): uma passada de Python no `openclaw.json` (`OC_CONFIG_PY`) responde dmPolicy, o bloco do
  canal, se o plugin do WhatsApp está ligado e instalado (`plugins.entries`, `plugins.allow`, pasta em
  `~/.openclaw/extensions/whatsapp` ou `~/.openclaw/npm/projects/openclaw-whatsapp-*`), se faltam modelo e reserva,
  áudio e voz. A versão vem do `package.json` ao lado do binário resolvido (`oc_versao`), senão de `openclaw --version`
  guardado em `~/.cache/meu-bot/openclaw-version` enquanto o binário não muda. A CLI só é chamada para `channels status`
  (sempre), `plugins list` (só quando os arquivos não acham o plugin) e `config set` (só quando falta modelo ou reserva).
  `GW_PROPRIO` (hoje sempre 1) condiciona `gw_fix`/`gw_ensure`: com gateway compartilhado o app não vai instalar nem
  religar gateway nenhum.
- Main: `TtlCache` (`whatsapp-cache-core.ts`) guarda status (45 s), lista de conversas (15 s) e grupos (30 s) por máquina,
  com coalescência (várias janelas = uma consulta). Toda mudança feita pelo app (parear, política, dono, pausa, marcas,
  limpar, grupos, logout, escolha do agente) chama `esquecerWhatsapp(host)`. O botão Atualizar manda `force`
  (`whatsapp:status` aceita `{ force }`).
- Tela: conectado, consulta a cada 2 min (antes 1); desconectado, 10 s; pareando, 8 s. Lista de conversas a cada 30 s
  (antes 20). Com a janela escondida, só reagenda; o `focus` consulta na volta.
- Testes: `whatsapp-status-sh.test.mjs` roda o `STATUS_SCRIPT` num HOME de mentira com um `openclaw` falso que anota as
  chamadas (máquina pronta = 1 chamada; VM nova = modelo e reserva gravados; versão por cache); `whatsapp-cache-core.test.mjs`.
