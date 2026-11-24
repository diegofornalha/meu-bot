# Suporte, meu-bot-admin, auditoria e licença

> Parte do diário técnico do meu-bot, dividido por assunto em 27 out 2026. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

## Suporte: meu-bot-admin (16 out 2026)

Para dar suporte a 2–3 pessoas sem servidor. Um projeto, dois apps: o **meu-bot** (de cada pessoa) e o
**meu-bot-admin** (só no Mac do admin; ícone âmbar com escudo). Cada pessoa tem a própria máquina do agente.

- Variante: `scripts/package.mjs --admin` (nome, bundle id `local.meu-bot-admin`, ícone, `variant.json` em
  Resources) e `scripts/fuses.mjs --admin` (instala
  `~/Applications/meu-bot-admin-gestao.app` + atalho na mesa). `src/main/variant-core.ts` decide (puro, testado:
  `resolveVariant`, `capsFor`) e `src/main/variant.ts` só lê o arquivo (`appVariant`, `caps`, `isAdmin`,
  `appTitle`; dev: `MEU_BOT_VARIANT=admin`). Ver "Mapa de variantes" abaixo. Ícones: `npm run icons`
  (`scripts/icon.mjs`: qlmanage → sips → iconutil).
- Preparo, uma vez: `node scripts/suporte-setup.mjs [--caixa agente-box] [--nome Lucas]`. Cria
  `~/.ssh/meu-bot-admin` (a chave do suporte), `build/suporte/entrega` (chave SÓ de entrega, gitignored),
  instala a caixa de entrada na máquina do admin (`backend-colima/meu-bot-suporte-inbox` em
  `~/.local/bin`) com `restrict,command="…inbox" <entrega> meu-bot-entrega` no authorized_keys de lá, e
  grava `build/suporte/suporte.json` + `known_hosts`. Testado: com a chave de entrega, pedir comando é
  ignorado (roda a caixa), túnel dá "administratively prohibited", terminal é recusado.
- Pacotes: `npm run dmg -- --suporte` (pessoas: pública do admin, chave de entrega e a chave do servidor da
  caixa; nenhuma máquina do admin) e `npm run dmg:admin` (admin; leva só o `suporte.json` público).
- Código de suporte (`src/main/support-code.ts`, testado): `MBS1.<base64url(JSON)>` com nome, endereço
  (`ssh -G` do Mac da pessoa), usuário, porta, chave pública do servidor dela, estado on/off, data e (desde
  16 out) `machine`, o apelido que ela usa para a máquina no `~/.ssh/config` dela ("colima"; opcional, código
  antigo vale). Sem segredo. Alias no admin: `suporte-<nome>-<4 hex do hash da chave do servidor>`; a página
  Suporte e o seletor de pessoas mostram o `machine` em vez do alias.
- Pessoa (`src/main/client/support.ts`; só no tutorial "Ligar o suporte", vale na hora): ligar = nome + chave do admin no
  authorized_keys (`no-agent-forwarding,no-X11-forwarding … meu-bot-admin`) + entregador na máquina dela
  (`~/.local/share/meu-bot/suporte/`, timer systemd --user de 30 min ou cron) que manda o código para a
  caixa por SSH (máquina com máquina; se a máquina não sai, o Mac entrega). Desligar = tira a chave, entrega
  "off", remove timer e arquivos. "Copiar código de suporte" é o plano B. Tudo vai para
  `~/.local/share/meu-bot/suporte.log`, mostrado como "O que o suporte fez nesta máquina".
- Admin (`src/main/admin/support-admin.ts`): o seletor lê a caixa (`~/suporte-inbox/<id>.code`; o id tem de bater
  com a chave do servidor do código) e lista as pessoas com "visto há"; "Adicionar pessoa" cola o código.
  As pessoas viram `~/.ssh/meu-bot-suporte.conf` (gerado; `Include` no topo do `~/.ssh/config`, backup em
  `config.antes-do-meu-bot-admin`) com `IdentityFile ~/.ssh/meu-bot-admin` e known_hosts próprio
  (`StrictHostKeyChecking yes`). Janela da pessoa: página "Suporte" (saúde = sondagem + WhatsApp; ações com
  confirmação de 2 cliques: reiniciar gateway, reiniciar backend, ativar transcrição; registros do
  journalctl) e o espelho do WhatsApp na lateral (menu "…" só Exportar/Arquivar). Sem compositor, sem túnel;
  o build admin nem registra os canais de cliente (`src/main/ipc/client.ts`: chat, pareamento, política,
  logins, instalar, suporte lado da pessoa), só stubs que recusam ("o meu-bot-admin só lê; use as ações de
  suporte"); ver `src/main/ipc-policy.ts` e o teste `ipc-policy`.
- Máquina de endereço local (VM do Colima: `127.0.0.1:<porta>`) pode ligar o suporte: só um admin no mesmo
  Mac a alcança, e o admin mostra "só alcançável deste Mac" (`SupportPerson.local`). Serve para testar o
  admin sem outra máquina. Limite geral: o aviso periódico reenvia o código gerado ao ligar; se o endereço
  da máquina mudar (porta do Colima após reiniciar, IP novo), é preciso desligar e ligar de novo.
- Progresso nos tutoriais: com o suporte ligado, o meu-bot da pessoa grava `~/.local/share/meu-bot/
  progresso.json` (tour feito/pulado, cada tutorial com passos feitos, total e onde parou; validado por
  `parseSupportProgress`) 3 s depois de cada mudança do guia, só quando algo mudou. O admin mostra o quadro
  "Progresso nos tutoriais" (✓ concluído, "3 de 5 · parou em …"). Desligar o suporte apaga o arquivo.
- Código de suporte na tela da pessoa: "Mostrar código de suporte" revela o código numa caixa selecionável
  com Copiar (plano B da entrega automática). Registros no admin: recolhidos por padrão; só leem o journal
  quando abertos.
- Tutorial "Ligar o suporte" (3 passos, depois do WhatsApp; `requires: "support"`, só aparece com o pacote
  de suporte, em máquina por SSH e fora do admin): dizer o nome → permitir → "O que o admin recebe". Os
  passos leem o estado real pelo `GuideContext` (`guideView(t, status, flags, ctx)`, `visibleTutorials`). No
  app da pessoa nunca aparece o nome de quem dá o suporte: os textos dizem "o admin" (pedido do usuário), e o
  registro da máquina anota as ações como "admin". Conclui sozinho: o `entregar.sh` grava
  `~/.local/share/meu-bot/suporte/ultima-entrega` quando a entrega na caixa dá certo (a entrega pelo Mac
  também grava) e `supportInfo` devolve `deliveredAt`. Enquanto o aviso não chega, a tela confere a cada
  10 s e oferece "Tentar de novo" (`support:deliver`); o código visível fica recolhido em "Não chegou?
  Mostrar código de suporte". As peças (nome, interruptor, escolha, aviso/código, registro) estão em
  `renderSupportParts`; o modal de Configurações não tem mais seção Suporte (16 out: o tutorial é o único
  lugar). O progresso dele vai para o admin como os outros.
- Tutorial do suporte, ajustes de 16 out (pedidos do usuário): o nome fica sempre editável (ligado, "Salvar
  nome" regrava o aviso com o nome novo); o interruptor "Permitir o acesso do admin" já vem marcado
  (`supportWantOn`) e "Salvar nome" liga o suporte no mesmo clique (ainda é a pessoa quem confirma; desmarcar
  antes salva só o nome); o passo "O que o admin recebe" tem a escolha do que o app do admin pode ver
  (`SupportShare`: progresso nos tutoriais, WhatsApp, registros; `support:share` grava
  `~/.local/share/meu-bot/compartilha.json` na máquina dela, fora da pasta do suporte para sobreviver a
  desligar/ligar; tirar o progresso apaga o `progresso.json`) e mostra o registro "O que o suporte fez nesta
  máquina". O app do admin respeita a escolha (`adminHealth` devolve `share` e nem consulta o WhatsApp/
  progresso não compartilhados; `adminLogs` recusa; a lateral do admin só mostra o WhatsApp se a saúde o
  trouxer). Limite dito na tela: enquanto o suporte está ligado, o admin ainda entra por SSH; desligar o
  interruptor corta tudo.
- CRUD do admin sobre o que está na máquina dela (16 out): no espelho do WhatsApp o menu "…" do admin ganha
  "Pausar o agente para esta pessoa"/"Retomar" (`whatsapp:pause` comum, registrado no admin; a nota na conversa
  diz "pelo suporte") e
  "Limpar histórico…" (mesma confirmação inline do cliente; `whatsapp:clear-plan`/`whatsapp:clear` viram
  canais comuns e, no admin, a limpeza entra no registro que ela vê: "admin limpou o histórico do WhatsApp de
  <número>"). No espelho das conversas com o meu-bot, "Apagar esta conversa" (dois cliques; `admin:bot-delete`
  apaga o .jsonl da sessão na máquina e registra "apagou uma conversa dela com o meu-bot"; o backend abre
  outra sessão no próximo turno). Para a pessoa, o meu-bot já tinha "Limpar histórico" e "Excluir conversa".
- Excluir pelo admin some também no app dela (26 out): no espelho das conversas com o meu-bot, o "…" ganhou
  "Excluir conversa" (direto, sem confirmar, pedido do usuário; o "Apagar esta conversa" do cabeçalho também); os dois chamam
  `admin:bot-delete`, que apaga o .jsonl e anota o id em `~/.local/share/meu-bot/conversas-apagadas.json`
  (`{ids: {<id>: ISO}}`, 500 mais recentes, tmp+mv 0600; `src/main/conversa/apagadas-core.ts`, puro, testado). O
  meu-bot dela lê o arquivo ao abrir a janela e ao voltar o foco (no máximo 1×/min, canal `chat:apagadas`) e tira
  as conversas daquela máquina cujo `claude.sessionId` (ou o próprio id, no diário de provedor externo) está lá,
  sem confirmar; conversa mexida depois da exclusão fica. Limite: conversa que nunca guardou a sessão (sem turno
  lido do backend) ou que trocou de sessão depois do TTL do mapa só some se a exclusão for da sessão guardada.
- Excluir conversa apaga também na máquina (16 out): `chat:delete` chama `DELETE /v1/meu-bot/session?conv=<id>`
  no backend da máquina (`deleteBackendSession`, pelo túnel), que apaga o .jsonl da sessão do Claude Code nos
  dois perfis e esquece o mapa; o admin deixa de ver a conversa. Backend antigo (sem a rota) é ignorado:
  atualizar com `scp backend-colima/* <host>:~/backend-colima/ && ssh <host> bash ~/backend-colima/install.sh`
  (ou "Instalar backend" no seletor).
- Renomear pessoa no admin (16 out): "Renomear" no seletor, com pessoa selecionada, guarda um apelido do admin
  (`nickname` em pessoas.json, `picker:support-rename`) que vence o nome do código na lista, no título da
  janela e na página Suporte; vazio volta ao nome dela. O alias SSH não muda (ele vem do nome do código).
- Identidade por conta na máquina (16 out): `machineId` passou a ser hash de chave do servidor + usuário + porta
  (antes só a chave: duas contas na mesma VM, root e box, se sobrescreviam na caixa, no pessoas.json e no
  alias). O admin aceita avisos com o id antigo (`legacyMachineId`) e guarda sob o novo; o `pessoas.json`
  antigo é re-chaveado ao carregar; o meu-bot da pessoa vê pelo `SupportInfo.staleId` que o código gravado na
  máquina é antigo e regrava sozinho (liga de novo). Aliases mudam de sufixo uma vez.
- Escolha do que o admin vê, oculta por ora (16 out, pedido do usuário: poluía): `SHOW_SUPPORT_SHARE = false` no
  renderer; o código e o `support:share` ficam, tudo compartilhado por padrão.
- Suporte ligado por padrão e seção nas Configurações (16 out): numa janela de máquina por SSH com o pacote, o
  app liga o suporte sozinho na primeira consulta (`refreshSupportState`, uma vez por janela, com o nome
  guardado ou o sugerido), a não ser que o admin tenha desligado: "Desligar o suporte desta pessoa" deixa
  `~/.local/share/meu-bot/suporte-desligado-pelo-admin` na máquina (`SupportInfo.blockedByAdmin`), e aí a
  pessoa vê "Desligado pelo admin" e só religa clicando em "Ligar o suporte" (ligar apaga a marca). A seção
  "Suporte" voltou às Configurações com: nome (Salvar nome / Ligar o suporte), "Avisar o admin agora" (entrega
  forçada, `support:deliver`, sempre visível), "Mostrar código de suporte" (copiar e mandar à mão), o que o
  admin vê e o registro. O tutorial "Ligar o suporte" continua, concluindo sozinho.
- Só o admin desliga (16 out, pedido do usuário): o interruptor "Permitir o acesso do admin" saiu do tutorial da
  pessoa; "Salvar nome" liga o suporte (o passo "Dizer seu nome" conclui com o nome gravado e o suporte ligado) e
  não há como ela desligar pelo app (nem "Refazer do zero" nesse tutorial). Quem desliga é o admin, pela ação
  "Desligar o suporte desta pessoa" (`AdminAction "support-off"`, `turnSupportOff`): roda na máquina dela o
  mesmo script do antigo desligar (tira a chave, entrega "off" na caixa, apaga timer e pasta;
  `removeDeliverySh` agora é puro em support-code.ts), marca a pessoa "off" e a tira do conf. Caso de uso:
  deixou de pagar. Ela volta se salvar o nome de novo; aí o admin arquiva ou desliga outra vez.
- Login como passo a passo (16 out): `src/renderer/lib/login-steps.ts` (puro, testado com a sequência
  real) transforma os eventos url/log/done em passos com estado, código do dispositivo em destaque e o que sobrar em
  "detalhes técnicos" recolhido; o main já não repassa "Connection to … closed". Nasceu para o login da xAI, que saiu
  do app em 24 nov (#518; virou o `entrar.sh` do módulo do Grok,
  [meu-bot-diego.md](meu-bot-diego.md#motor-de-ia-trazido-por-módulo-24-nov-2026)). O arquivo ficou só com o Claude
  (`LoginProvider = "claude"`) e hoje nenhuma tela o usa: só o teste `login-steps.test.mjs` o importa.
- xAI na saúde do admin (16 out): a linha `AdminHealth.xai` saiu em 24 nov (#518), com o `xaiLogin.ts`. O estado do
  Grok numa máquina é o do módulo: página Módulos, "Testar conexão".
- Versão e atividade dela no admin (16 out): o progresso que o meu-bot dela grava leva `app: { version,
  openedAt }` (versão do app e quando a sessão abriu; `WindowInfo.version`). A saúde mostra "meu-bot X no Mac
  dela · aberto há N" e acusa em vermelho quando está atrás da versão do admin (`compareVersions`): ela ainda
  não abriu o app com internet, então não atualizou. Depende de ela compartilhar o progresso. Saiu em 26 out: o
  progresso só é gravado com o suporte ligado do lado dela e envelhecia (agente-box-lv mostrava 0.1.0 de 21/10 com
  0.3.0 aberto); versão e "visto há" de cada app ficam só nos devices da licença, que cada app atualiza ao abrir.
  `parseSupportProgress` ignora o `app` de arquivo antigo.
- Transcrição de áudio por padrão (16 out): o app não instala o OpenClaw (a pessoa instala; o app só pareia),
  então o gancho é o pareamento: concluído numa máquina com OpenClaw sem transcritor, `ensureTranscription`
  (`ipc/client.ts`) roda `install-transcricao.sh` em seguida, contando os passos no mesmo fluxo do QR
  (baixa ~500 MB uma vez). `install-transcricao.sh off` desliga (`AudioSetup { kind: "in", off: true }`). No
  admin a ação é Ativar ou Desativar conforme `audioIn`, e some com uma nota quando a máquina não tem OpenClaw
  (`transcriptionNote`): era o caso de "esta máquina não tem OpenClaw: a transcrição é para o agente do
  WhatsApp dele", que aparecia porque a máquina ainda não tinha o OpenClaw.
- Conversas dela com o meu-bot no admin (16 out): além do WhatsApp, a lateral do admin tem o modo "meu-bot" com as
  conversas da pessoa, só leitura, para ver onde ela trava. Não vêm do Mac dela: o backend roda cada turno pelo
  Claude Code com `--resume`, e a transcrição fica em `~/.claude/projects/<cwd>/<sessão>.jsonl` na máquina
  (pastas `*chat-workspace` e `*agent-workspace`). `admin:bot-chats` lista as sessões (uma linha por arquivo:
  id, mtime, pasta, nº de respostas, 1ª linha `user`) e `admin:bot-thread` lê uma (só as linhas
  `user`/`assistant`, 30 KB cada; o arquivo tem muito ruído: pedidos à API, anexos, filas). Parser puro em
  `src/main/bot-chats.ts` (o "User: " que o backend põe sai; `tool_use` vira uma linha "ferramenta"), testado
  com o formato real do colima. UI em `src/renderer/admin/bot-mirror.ts` (lista por data e página com as
  bolhas do WhatsApp, atualiza a cada 8 s aberta e a lista a cada 30 s). Entra em `SupportShare.chat`
  ("Minhas conversas com o meu-bot"), ligado por padrão. Limite: sessões sem `--resume` (fallback do backend)
  aparecem como conversas novas com a história repetida no primeiro turno.
- Arquivar pessoa no seletor do admin (16 out): "Arquivar" na pessoa selecionada tira da lista sem mexer no
  suporte dela (`archived` em pessoas.json, `picker:support-archive`); o interruptor "mostrar arquivadas"
  aparece quando há alguém arquivado. Mesmo modelo das conversas.
- "Excluir conversa" no menu "…" do WhatsApp (17 out, os dois apps; sem confirmação, a pedido): limpa o histórico na
  máquina (o mesmo `whatsapp:clear`, sem o aviso da sessão principal: zera ela junto) e marca a conversa como
  excluída na máquina. Como o `sessions.list` continua listando a sessão depois do reset, a conversa só volta se
  `updatedAt` ficar maior que a hora da exclusão, ou seja, se o contato mandar outra mensagem. Sem histórico na
  máquina, excluir só marca. No admin a limpeza e a exclusão ficam no registro da pessoa.
  Desde 20 out (pedido de Lucas), excluir **não** limpa mais: só marca como excluída. O agente continua de onde
  parou; zerar o contexto é só o "Limpar histórico".
  Exclusão lógica: no meu-bot-admin o interruptor "arquivadas e excluídas" mostra também as excluídas (chip
  "excluída"), com menu Exportar / Copiar ID / Restaurar (`restore` → marca `deleted: false`; vai para o registro
  da pessoa como "restaurou a conversa…"). A pessoa nunca vê as excluídas.
- Nome do contato em cache na máquina + "Renomear" (17 out): o pushname só vinha ao abrir a conversa (`threadFor` →
  `chatNames` em memória do main) e sumia ao fechar o app; agora `whatsapp-lista.json` guarda `names` por número
  (`name` = pushname em cache, `alias` = apelido do "Renomear", `at`). `whatsappChats` semeia `namesOf(host)` com o
  arquivo (a memória, mais fresca, vence) e `applyWaMarks` preenche `WhatsappChat.alias`; `whatsappThread` regrava o
  cache quando o pushname muda. Contatos sem nome: `whatsapp:names` (compartilhado, ≤ 20) → `whatsappLearnNames` lê
  o `chat.history` (limite 40) da sessão própria de cada um (sem ela, a principal) numa chamada só, tira o nome com
  `threadFor` e grava; a tela chama em segundo plano depois de cada lista, uma vez por contato por abertura
  (`waNamesTried`). "Renomear" no "…" (os dois apps): caixa inline abaixo do contato, `markWhatsapp([{number,
  alias}])` (vazio tira); o apelido vence na lateral e no título (`waChatTitle`), e o cabeçalho da conversa mostra o
  nome original ao lado do número; no admin entra no registro da pessoa ("renomeou a conversa … para «X»"); cache de
  nome não registra.
- Sensação de instantâneo (17 out): regra única "pinta o último estado conhecido, lê a máquina por baixo, troca sem
  piscar" (stale-while-revalidate), com `src/renderer/lib/cache.ts` (puro, testado: envelope `{at, v}` em
  `localStorage`, chave `cache:<host>:<nome>`, try/catch em tudo, `clearCache(host)`). Entram: lista do WhatsApp
  (`waChats`, antes da primeira leitura), cada conversa (`waThread:<número>`, últimas 200, dica "atualizando…" até a
  leitura real), estado do WhatsApp (`waStatus`: o modo WhatsApp aparece antes do SSH responder), e no admin a lista
  e as conversas dela com o meu-bot (`botChats`, `botThread:<sessão>`) e a saúde (`health`, rótulo "como estava há X
  min" quando passou de 90 s ou está consultando). Limpar/excluir/apagar conversa tira o cache dela. Nada que dispara
  ação é cacheado. Desde 26 out o envelope é `{at, b, v}`: `b` é o `WindowInfo.build` (versão + data do renderer.js)
  e só o mesmo build lê; o valor sai sem validação como o tipo do build que gravou, e a saúde gravada antes de
  `capacidades` derrubava a janela do admin antes de abrir a aba Suporte (e deixava o botão Suporte sem ação).
- Arquivado/excluído do WhatsApp sincronizados pela máquina (17 out): as marcações moram em
  `~/.local/share/meu-bot/whatsapp-lista.json` na VM (`{archived: {número: ISO}, deleted: {número: ISO da
  exclusão}}`), então o meu-bot da pessoa e o meu-bot-admin veem a mesma lista, como já acontece com a pausa (que
  mora no OpenClaw). Leitura: `whatsappChats` lê o arquivo na mesma chamada SSH do `sessions.list` e
  `applyWaMarks` (`src/main/whatsapp-marks.ts`, puro, testado) preenche `WhatsappChat.archived/deleted`
  (excluída = há marca e `updatedAt <= deletedAt`). Escrita: canal compartilhado `whatsapp:mark`
  (`{marks: [{number, archived?, deleted?, at?}]}`, até 200) → `whatsappSetMarks` roda `waMarkSh`: um python3 na
  máquina lê o arquivo atual (corrompido = `{}`), aplica só os ajustes e grava tmp+mv com 0600, então o admin e a
  pessoa não se sobrescrevem. A tela aplica otimista e, em erro, relê a lista e avisa. O outro app vê em até 20 s
  (ciclo de `refreshWaChats`). Migração: na primeira lista que carrega, o que o app guardava no localStorage
  (`waHidden:<host>` arquivadas, `waDeleted:<host>` excluídas) vai para a máquina com a hora de então (`at`) e as
  chaves locais somem; se falhar, ficam e tenta na próxima. No admin, um ajuste da tela fica no registro da pessoa
  ("arquivou/desarquivou/excluiu a conversa do WhatsApp de +55…"); a migração não registra. Sem python3 na VM, a
  marcação falha com aviso claro (o app já depende dele para ler o número próprio). Testado na agente-box: arquivo
  corrompido + ajuste, merge de dois ajustes, `at` respeitado.
- REA do Rambox: o que veio e o que ficou de fora (17 out). Analisado o Rambox 3.1.1 (`/Applications/Rambox.app`:
  fuses, main.js, canais IPC e strings pt-BR). Veio: (A) verificação de atualização visível, como lá: `UpdateState`
  ganhou `phase` (idle/checking/up-to-date/available/ready/error) e `checkedAt`, o `updater.ts` emite `update:state`
  em cada fase (primeira consulta aos 3 s; sem release no GitHub a fase é up-to-date), `update:check` é o "Verificar
  agora"; na tela, o ponto "verificando atualizações…" na barra de cima enquanto `checking` e o grupo "Sobre e
  atualização" nas Configurações (versão, frase da fase por `lib/update-text.ts`, Verificar agora, Notas de lançamento,
  Reiniciar e atualizar). (B) Notificação de teste (`ui:notify-test`; o botão "Enviar uma notificação de teste" das
  Configurações saiu em 30 out 2026), e a primeira notificação desta instalação disparada no momento certo
  (quando a pessoa marca "Testei, funcionou" no tutorial do WhatsApp, `maybeAskNotificationsOnce`): o macOS pede a
  permissão junto. Sem `node-mac-permissions`: para notificações não há API de estado, e o Rambox também usa o teste.
  (C) "Abrir ao entrar no Mac" (grupo Inicialização): `app.setLoginItemSettings` no `settings:set`, estado lido do
  sistema em `settings:get` (`openAtLogin`/`openAtLoginAvailable`, só empacotado). (D) Disco e memória da máquina na
  saúde do admin (`df -Pk $HOME`, `free -k` na sondagem → `HostProbe.disk*/mem*Mb`; `healthLines` avisa abaixo de
  2 GB de disco e 512 MB de memória). (E) Aviso de "Mac novo usou o meu-bot desta máquina", como o e-mail de login
  numa máquina nova do Rambox: o app se apresenta ao backend a cada abertura (`POST /v1/meu-bot/hello`, id =
  sha256(hostname+usuário)[:12], `announceMachine` em `backend.ts`, uma vez por máquina por abertura); o backend guarda
  `~/.local/share/meu-bot/maquinas.json`, e um Mac desconhecido (o primeiro de todos é a instalação, sem aviso) gera
  linha no `suporte.log` ("sistema|um Mac novo usou o meu-bot: nome (usuário, sistema)"), mensagem no WhatsApp da
  própria pessoa (`openclaw message send --channel whatsapp --target +<número dela>`, ou `hermes send` no Hermes).
  O e-mail pela Resend saiu por completo em 30 out (ninguém configurava a chave): `alertas.json` só tem `whatsapp`
  (`GET/PUT /v1/meu-bot/alerts`), editado no grupo "Segurança" das Configurações (só no meu-bot, máquina por SSH).
  Ficou de fora: bandeja, hibernação, workspaces, telemetria/Firebase, licença e permissões de câmera/microfone/tela/
  localização/Bluetooth (sem uso; pedir assusta). Os fuses do Rambox (RunAsNode off, NodeOptions off, Inspect off,
  cookie encryption, ASAR integrity, OnlyLoadAppFromAsar) são idênticos aos nossos (`scripts/fuses.mjs`).
- Quem respondeu, sempre visível e rastreável (17 out): (A) `BackendMessage`/`ChatMessage` ganham `provider`
  (X-Provider do backend) e `fallback` (o aviso "agente falhou (…); respondendo com <reserva>", antes só um aviso que
  sumia); `runBackendTurn` grava os dois na resposta, `chat:done` os leva à tela, e a bolha do assistente mostra o
  rótulo `.msg-provider` (`lib/provider-label.ts`, puro: o nome do provedor, ou "respondeu <provedor> (fallback de agente) ⚠" em
  cor de aviso, com o motivo no title); vale ao reabrir (restauração do disco) e no export .md ("Assistente
  (<provedor>)"). (B) Conversas fora do Claude Code (provedor `openai`, Hermes) não tinham arquivo na máquina: o backend passa a
  gravar um diário `~/.local/share/meu-bot/conversas/<id da conversa>.jsonl` (uma linha JSON por mensagem
  `{at, role, model, provider, text}`, 0600) só quando o provedor usado não é um perfil Claude (o `.jsonl` do
  Claude Code segue sendo a transcrição deles, sem duplicar). `GET /v1/meu-bot/session` devolve `{profile: "app",
  file}` quando o diário existe (então "Copiar ID" traz caminho real) e `DELETE` o apaga junto. O admin lista as
  duas fontes no mesmo script (`adminBotChats`: linhas `F` do Claude e `A` do diário; `BotChat.source`
  `"claude"|"app"` e `provider`), lê (`parseAppTranscript`, puro, testado) e apaga por fonte; no espelho a conversa
  de um provedor `openai` leva a etiqueta dele na lista e na bolha ("<provedor> · 00:42"); `botReferenceText` aponta para o diário.
  (C) O modelo sabe quem é: `providers.openaiCompletion` antepõe ao system "Você responde dentro do meu-bot como o
  modelo <model>, da <fornecedor>…" (o fornecedor é o host do `base_url`, ou "xAI" quando o modelo é um `grok…`), e
  os perfis Claude recebem o mesmo pelo `--append-system-prompt` ("pelo Claude Code, perfil agente"), inclusive no refazer sem resume. Backend reinstalado no colima e na agente-box (17 out); provado com
  um turno de provedor `openai`: diário com 2 linhas, GET traz o arquivo, DELETE apaga, e o modelo diz quem é.
- "Copiar ID" nos três pontinhos (17 out, os dois apps): uma linha para colar numa IA dizendo onde a
  conversa mora. Três formas (`src/renderer/lib/reference.ts`, puro, testado): espelho do meu-bot no admin →
  `meu-bot · <máquina> · ~/.claude/projects/<pasta>/<uuid>.jsonl` (botão "…" na linha via `ui:bot-menu`, canal
  admin, e botão no cabeçalho da conversa); aba do meu-bot → o mesmo caminho, vindo do backend
  (`GET /v1/meu-bot/session?conv=` em `backend-colima/server.js`, lista `{profile, sessionId, cwd, file}` do
  session-map), guardado em `StoredConversation.claude` ao fim de cada turno (`rememberClaudeSession` em
  `ipc/client.ts`) para valer depois do TTL de 6 h do mapa; sem sessão ainda (conversa nova, backend antigo ou
  sem túnel) o plano B é `meu-bot · <máquina> · conversa <id do app> (ainda sem transcrição…)`; WhatsApp →
  `whatsapp · <máquina> · +55… · <chave da sessão> · sessão <uuid>`, uma linha por sessão (a principal inclusive),
  porque a chave é estável e o UUID (`WhatsappChat.sessionIds`, do `sessions.list`) troca a cada "Limpar". A cópia
  é só do que a lista já tem (sem SSH); aviso "✓ ID copiado" por 1,5 s na lateral (`sidebar-notice`).
  Canais novos: `chat:reference` (cliente), `ui:bot-menu` (admin). Backend atualizado no colima em 17 out.
- Tutorial 8 · O que você quer resolver pelo WhatsApp? (17 out): deixou de ser "Em breve". Tudo mora na máquina, como a
  pausa: `~/.local/share/meu-bot/objetivo.json` (`{objective: {id, label, text}, level, savedAt}`) e uma skill de
  verdade em `<workspace do OpenClaw>/skills/objetivo-whatsapp/SKILL.md` (o OpenClaw a lista como
  `openclaw-workspace`, confirmado na agente-box). Passo 1 *Escolher o objetivo* (corpo `objective-choice`: cartões
  Atender clientes / Vender / Marcar horários / Dar suporte / Outro + frase; "Outro" exige a frase; "Salvar objetivo"
  → `objective:set`). Passo 2 *Dizer quanta liberdade* (`objective-level`: Só conversa / Consulta e organiza / Age
  por mim, grava no clique). Passo 3 *Salvar como skill no Acervo* (`objective-skill` → `objective:save`: escreve o
  SKILL.md com o objetivo e as regras do nível em português e aplica `tools.toolsBySender`: o dono conforme o nível
  (conversa = sem write/edit/exec/…, consulta = sem exec/process/cron/gateway, age = tudo) e `*` sempre sem as
  ferramentas que mudam a máquina; sem número pareado a trava fica para depois). Conclui quando `savedAt` existe e o
  SKILL.md está na máquina. "Refazer do zero" (`objective:reset`) apaga a skill e o objetivo.json e devolve a
  liberdade total ao dono. O Acervo passa a listar as skills do workspace da máquina (a do objetivo primeiro, com
  "Ajustar no tutorial 8") além da biblioteca estática; o contador da lateral soma as duas. Puro e testado em
  `src/main/objetivo-core.ts`; SSH em `src/main/objetivo.ts`; opções da tela em `lib/tutoriais.ts`
  (`OBJECTIVE_OPTIONS`, `LEVEL_OPTIONS`); `GuideContext.objective`.
- Excluir máquina no seletor do admin (17 out): "Excluir máquina" (um clique, sem confirmação; é máquina, não pessoa: cada
  linha é uma VM) na pessoa selecionada faz tudo de uma
  vez: na máquina dela limpa todo o histórico do WhatsApp (todas as `sessionKeys` de `whatsappChats`, via
  `whatsappClearSessions`, o mesmo "Limpar histórico" de cada conversa) e desliga o suporte (mesmo script do
  `support-off`: tira a chave do admin, entrega "off", apaga timer/pasta, marca o bloqueio), e aqui ela sai de
  pessoas.json, do ~/.ssh/meu-bot-suporte.conf e do arquivo dela na caixa de entrada (senão a próxima leitura a
  traria de volta). A janela dela, se aberta, fecha. Máquina fora do ar: nada é limpo, ela fica na lista e o botão
  vira "Excluir máquina mesmo assim (só tira da lista)" por 10 s (`force`). `removePerson` em `admin/support-admin.ts`,
  `picker:support-remove`. Ela volta ao suporte só se salvar o nome de novo no tutorial (o bloqueio do admin
  impede o religar automático).
- "Renomear" (seletor, máquina selecionada; não "este Mac" nem no admin): apelido guardado em
  `settings.hostNames` (host → nome, 1–40 caracteres, `normalizeHostNames`). A chave SSH não muda; o apelido
  entra em `hostLabel` (`lib/probe-text.ts`, com `setHostNicknames`), então seletor, título da janela e
  textos mostram o apelido. Janelas abertas retitulam pelo `settings:changed`. Vazio tira o apelido.
- "Remover do seletor" (botão na máquina selecionada, dois cliques; nunca "este Mac" nem no admin): tira o
  Host do ~/.ssh/config com `removeSshHost` (`src/main/ssh-sync.ts`, testado: bloco só dele sai inteiro; em
  `Host a b` sai só o nome; o resto do arquivo fica igual) e backup em `config.antes-de-remover-<host>`.
  Host que vem de um Include (Colima, suporte) não é mexido e o erro diz isso. Recusa com a janela da
  máquina aberta; os atalhos da mesa dela saem junto. Ela volta se estiver no modelo do projeto e alguém
  usar "sincronizar ssh".
- Status line, personalizar (16 out): preferência por máquina em `~/.claude/statusline-segments.json`
  (`{model, ctx, account, session, weekly}`; ausente = todos; o app exige pelo menos um ligado), lida pelo
  `statusline.sh` (`seg_on`, com `if has($k) then .[$k] else true end`: o `// true` do jq trocaria false por
  true) e pelo backend (`account-status.js` → `segments` no `/v1/meu-bot/status`), então barra do terminal e
  rodapé do app (`buildSegments` filtra model/ctx/account/session/weekly; `turn` e `age` ficam) combinam.
  Gravação pela janela: `src/main/statusLine.ts` (`statusline:segments` / `statusline:set-segments`, ssh ou
  fs local, atômico 0600). Correções no script: `stat -c %Y` antes de `stat -f %m` (no Linux o `-f` devolvia
  lixo e o cache de perfil nunca valia: uma chamada à API da Anthropic por atualização; agente-box e colima
  estavam assim), segmento **Semanal** (magenta) na barra, e sem o segmento Conta o script nem vai à API.
  Teste real do script em `scripts/tests/statusline-sh.test.mjs` (bash + jq, HOME temporário, `curl` falso
  que acusa chamada). Tutorial com 4 passos: Instalar → **Escolher o que aparece** (interruptores + prévia
  `previewLine`) → **Conferir no terminal** (digita `SL_TEST_COMMAND` num terminal do app; "Apareceu certo"
  marca `GuideFlags.statusTested`) → **Ver os limites na conversa** (alvo `chat`: botão "Ir para a conversa"
  volta à aba de conversa com uma mensagem pronta no compositor e um aviso de onde olhar; o botão Enviar faz
  uma contagem "Enviando em 3 → 2 → 1" e manda sozinho, para a pessoa ver o fluxo acontecer (`startAutoSend`;
  digitar ou Esc cancela, clicar em Enviar manda na hora, trocar de aba ou esvaziar o compositor cancela;
  `syncComposer` não repinta o botão durante a contagem); o passo se conclui sozinho quando a conta traz os limites). `GuideTarget` ganhou `chat`
  (`goToChatForStatusLine`, `backToChat` compartilhado com "Perguntar ao agente" do terminal); o painel de
  gerência do tutorial concluído repete o botão em "Onde aparece". `backend-vm/services/account-status.js` é cópia.
  O rótulo da barra no terminal passou de "Sessão diaria" (herdado do script original; a janela é de 5 h, não
  diária) para "Sessão:", o mesmo do rodapé do app e da prévia do passo 2.
- Trilha numerada e tutorial 1 · Entrar no Claude Code (16 out): cada tutorial tem `number` fixo (1 Claude,
  2 WhatsApp, 3 Status line, 4 xAI/Grok, 5 Fallback, 6 Suporte, 7 Objetivo): selo "TUTORIAL 3 · 4 PASSOS · 3 MIN",
  aba "3 · Status line 2/4", paleta "Tutorial 16: …", admin "3 · Status line do Claude: 2 de 4" (`tutorialNumber`
  pelo id; o payload do progresso não mudou). `Tutorial.after` (id) esconde o tutorial até o anterior ser
  concluído — `visibleTutorials(ctx, finished)` — e `needsSupport` substitui `requires: "support"`: 3 e 4 só
  depois do 1, 5 só depois do 4 (4 e 5 continuam "Em breve"; o cartão Fallback sumiu de quem não chegou lá).
  Tutorial 1 (3 passos): *Entrar na conta* (corpo `claude-login`: os controles do login vivem dentro do guia,
  `clGuide`, criados uma vez e reanexados a cada repintura para o campo do código sobreviver; o modal
  `#cl-dialog` usa o mesmo `clState`/`paintClaudeLogin` e fica para trocar de conta depois de concluído;
  `enterClaude()` é a porta única: paleta, aviso de deslogado, boas-vindas, botão da lateral e `ui:claude-login`),
  *Conferir quem está logado* (e-mail de `claudeAuth`; "Vi minha conta" = `GuideFlags.claudeSeen` se o e-mail
  não vier), *Primeira resposta do agente* (alvo `chat` com 3-2-1; conclui quando o `index` desta máquina tem
  uma mensagem `assistant` — checado em `chat:done`). `refreshClaudeLine` repinta o guia; `logoutClaude(relogin)`
  serve ao botão "sair", ao painel de gerência ("Sair e entrar com outra conta") e ao "Refazer do zero". O guia
  só espera o WhatsApp (`st === null`) em tutoriais com alvo `wa-*`.
- Guarda do WhatsApp (18 out, `backend-colima/guarda/` + `install-guarda.sh`): plugin local do OpenClaw
  (`meu-bot-guarda`, JS puro, hooks `message_received`/`message_sending`/`session_start`; registrado por
  `openclaw plugins install --link ~/.local/share/meu-bot/guarda --force`, que o gateway aplica na hora, sem
  reiniciar; `plugins reload` depois de editar). Motivo: na conversa com +595981003050 (bot da DLS Technology) o
  OpenClaw entregou ao contato "↪️ Model Fallback: grok/grok-4.7 (selected anthropic/claude-opus-5-5; empty
  response)" e a conversa entrou em loop de despedidas (9 ciclos em 8 min). O OpenClaw 2026.9.9 não tem chave
  para calar a nota em conversas diretas (só poupa grupos/canais) e o `botLoopProtection` nativo não vale para
  WhatsApp (não classifica autor como bot). Regras em `guarda/regras.mjs` (puro; `scripts/tests/guarda-regras.test.mjs`
  roda direto, sem dist): (1) `isOperationalNotice` — texto começando por "↪️ Model Fallback"/"↪️ Retried on" →
  `{ cancel: true }` em `message_sending` (o estado de fallback do OpenClaw segue; só a linha não sai); (2)
  `LoopTracker` — por sessão direta, pares recebida→enviada; loop = 3 ciclos seguidos, mensagens ≤ 200 chars,
  ≤ 3 min entre ciclos, e os 3 textos do contato (ou do agente) são despedidas/cortesias (lista pt/es/en,
  ≤ 12 palavras) ou quase iguais (Jaccard de palavras ≥ 0,6). Ao detectar, na 3ª resposta: cancela o envio,
  `api.runtime.agent.session.patchSessionEntry({ sendPolicy: "deny" })` (a mesma pausa manual: a lista do app
  mostra "pausado"; retomar é o menu "…" › Retomar) e injeta a nota ao agente por `openclaw agent --message-file`
  (molde de whatsapp-pause.ts). Humanos não batem: três "ok" com 5 min de intervalo estouram a janela; conversa
  com conteúdo não passa. Logs em `/tmp/openclaw/openclaw-<data>.log` ("meu-bot-guarda: …"). No app: sonda
  `guarda` (null sem OpenClaw), `guarda:status|install|uninstall`, botão "Ativar guarda do WhatsApp" no seletor
  (depois de status line e transcrição) e **tutorial 9 · Guarda do WhatsApp** (após o 2: ativar + "Entendi").
  Instalada na agente-box em 18 out (geração 5 do gateway); confirmação ao vivo pendente do próximo loop.
- Módulo Pro "Navegador" (18 out), como o quick view do Rambox: aba `navegador` (renderer, `openNavTab`) com
  abas internas que são `<webview>` (`webviewTag: true` na janela; `windows.ts`) na partição
  `persist:navegador-<host>` (cookies/logins por máquina, separados do app). O main (`src/main/browser.ts`)
  prepara a sessão (permissões fechadas, User-Agent sem "Electron" — senão o login do Google recusa — e a
  Chrome Web Store ligada pelo `electron-chrome-web-store`, MIT, como no Rambox: a pessoa abre a loja na aba e
  "Usar no Chrome" instala em `userData/Navegador/<host>/Extensions`, com atualização automática; menu 🧩 lista
  e remove). Popups viram aba interna; Cmd+K/J/N/B/W/T/L/[/] dentro do webview voltam ao app
  (`before-input-event` → `browser:key`). `electron-chrome-extensions` (GPL-3) NÃO entrou: sem a licença
  patron do autor; extensões rodam com as APIs nativas do Electron (content scripts, storage, scripting;
  sem popup de botão nem declarativeNetRequest). **Gate Pro**: `lib/pro.ts` (`browserAccess`: ok/free/
  expired/unknown; testado) com cache `license` no renderer; free vê a aba bloqueada com "Pedir o Pro ao admin"
  (`browser:request-pro` → linha no suporte.log); o main recusa `browser:open` sem Pro (PRO_REQUIRED); o
  backend ignora o navegador sem licença Pro. Só no meu-bot da pessoa (`caps.chat`; escondido no admin).
  **Agente navega** (o desenho simples, em vez de emular o CDP para o puppeteer): `src/main/nav-api.ts` serve
  ações JSON num socket Unix 0700 (`/tmp/<app>-<uid>/nav-<host>.sock`: abas, abrir, ler — texto + elementos
  numerados —, clicar, digitar com `insertText`, tecla, print, voltar/avancar/recarregar, js); o interruptor
  "🤖 agente: pode usar" na barra (`browserAgent`) sobe o socket e pede ao túnel um `-R 127.0.0.1:<porta>:<socket>`
  (`tunnel.ts`: `setReverseWanted`/`reconcileReverse`, porta livre por python3 na máquina, prontidão por curl
  ao `/abas`, reinício com orçamento, `-O cancel -R` ao desligar). Com o agente ligado e o -R de pé,
  `runBackendTurn` manda `X-Meu-Bot-Browser-Port`; o backend (`navegador.js`, puro/testado) confere Pro e o
  arquivo `~/.local/share/meu-bot/navegador-mcp.mjs` (servidor MCP stdio de um arquivo, sem npm, instalado por
  `install-navegador-mcp.sh` junto com a regra de conduta no CLAUDE.md dos workspaces) e roda a CLI com
  `--mcp-config` + `--allowedTools mcp__navegador` (+ `--system-prompt-snapshot off` em CLI ≥ 2.1.257), a
  regra no system (depois do sysHash, como a identity) e uma nota no prompt do turno. `tool-events.js` resume
  como "🌐 abriu …", "🌐 digitou em …" (nunca o texto). Tutoriais 9 "Navegador do agente (Pro)" e 10
  "Extensões no Navegador" (exemplo: Streak CRM for Gmail; o passo "Usar" exige login no Google dentro da
  aba). Verificado: backend novo na agente-box (requer `licenca.js` ao lado: copiar todos os .js), MCP responde
  `tools/list`.
- Service worker das extensões segurado (18 out): o Chromium encerra o service worker MV3 após ~30 s ocioso e
  o Electron **não** o acorda quando o content script chama `runtime.connect`/`sendMessage` (o Chrome acorda).
  Sintoma no Streak: minutos depois de abrir, "failure to send getExtensions message", `BackgroundPageCommunicator`
  undefined e "Faça login para usar o Streak" a cada recarga (a ponte com o background morreu, não a sessão).
  Correção em `browser.ts`: `workerHold` acorda com `startWorkerForScope` e chama `w.startTask()` sem nunca
  encerrar (o worker não entra em ociosidade); `running-status-changed` → `stopped` religa (1 s; 30 s depois de
  3 quedas); `browserOpen` espera os workers subirem (até 4 s) antes de o webview carregar; `extension-unloaded`
  solta a tarefa. Diagnóstico: `/diag` do nav-api lista `service_workers` (o da extensão tem de aparecer).
- Recortes do Navegador (18 out): partes de um site que a pessoa oculta para sobrar tela (`lib/recortes.ts`,
  tabela `RECORTES` por host). No Gmail: painel lateral (`.bkL > .aqn`: pastas do Gmail e painel do Streak, 256 px),
  menu Mail/Streak/Chat/Meet (`.aeN.WR`, 68 px) e barra superior (`header#gb`, 64 px); os três **ocultos por
  padrão** (pedido do usuário), botões ◧ ⋮ ⬒ na barra do Navegador (apagado = oculto). Implementação:
  `insertCSS` no webview por documento (`NavTab.cssKeys`, zerado no `did-navigate`, aplicado em `did-navigate` e
  `dom-ready`), depois `dispatchEvent(new Event("resize"))` porque o Gmail mede a tela por JS (sem isso o
  conteúdo não cresce). Preferência em `localStorage.navRecortes` (por recorte, vale para todas as máquinas).
- Polyfill nos content scripts (18 out): o Electron não dá `chrome.extension` ao mundo isolado dos content
  scripts; o Streak testa `chrome.extension` para criar a ponte com o background e, sem ela, `_bridge` fica
  undefined ("reading 'getLocalStorageItem'", "failure to send getExtensions") e ele pede login a cada carga.
  `patchExtensionFiles` agora prepõe o polyfill (marca v3) a todo `content_scripts[].js` com `world !== "MAIN"`;
  o polyfill detecta o contexto por `chrome.runtime.id` e só cria `chrome.extension`. Depois da recarga da
  extensão o `extension-ready` não repete: `workerHold` é chamado direto após `loadExtension`. Verificado: zero
  erros no console do Gmail, Streak sem pedir login.
- Barra de favoritos do Navegador (18 out): lista **por máquina** em `settings.navFavoritos` (normalizada:
  url http(s), título ≤ 60, url repetida só atualiza título, 50 no máximo); IPC `browser:favorite-add/remove`
  e evento `browser:favorites` para todas as janelas da máquina; o agente usa `/favoritos`, `/favoritar
  {url, titulo?}` (sem título: o da aba nessa url, senão o host) e `/desfavoritar {id|url}` → ferramentas MCP
  `favoritos/favoritar/desfavoritar` (resumo ⭐ em tool-events). UI: linha `.nav-favs` sob a barra (clique abre
  na aba atual, Cmd+clique em aba nova, × tira), ☆/★ na barra guarda/tira a página aberta, **Cmd+Shift+F**
  mostra/esconde a barra (também vindo do webview; preferência `localStorage.navFavsShown`), paleta "barra de
  favoritos". Verificado na agente-box: `favoritar` pelo socket e `favoritos` pelo MCP na VM.
- Skills aprendidas do Navegador (18 out): o agente registra o que descobriu num site para não repetir
  tentativas. Regra v3 do bloco `meu-bot:navegador` (install-navegador-mcp.sh): antes de operar um site, ler
  `~/.claude/skills/<site>-navegador/SKILL.md`; ao terminar uma tarefa que exigiu descobrir o caminho, gravar
  ou atualizar essa skill (frontmatter + o que funcionou e o que não). Sementes `backend-colima/skill-*.md`
  (hoje `skill-streak-crm-navegador.md`, escrita a partir da sessão c8d553bf na agente-box: "+" da barra cria
  box, célula inline não salva, selects aceitam digitar+Enter, checkbox do cabeçalho só por eventos de mouse,
  confirmação "N caixas", hash `#pipeline` volta a `#inbox` em Gmail recém-carregado, popup da extensão não é
  aba, conversa do WhatsApp no sqlite do OpenClaw) são copiadas para `~/.claude/skills/<nome>/SKILL.md` só se
  a máquina ainda não tiver a sua (o agente edita a dele). nav-api: popup da extensão fora de `abas`, erro
  claro quando a aba morre no meio (`alive`), `ler` tenta duas vezes e toda falha vai ao meu-bot.log.
- Guarda com versão e rollout automático (18 out, noite): `guarda/package.json` leva a versão (1.1.0); a sonda
  do seletor imprime `guardaver=`; `ensureGuarda` (picker.ts) instala quando falta **ou quando a versão da máquina
  difere da que vem no app** (`bundledGuardaVersion()`). Assim toda máquina com OpenClaw da conta recebe regras
  novas (encerramento, bloqueio de erros, agent_end) na próxima abertura do seletor, sem clicar em nada. Subir a
  versão no package.json a cada mudança no plugin.
- `agent_end` chega (18 out, noite): ao contrário de `message_received`, o hook `agent_end` é entregue ao plugin
  com `event.messages` (a conversa inteira, role/content/timestamp) e `ctx.sessionKey/channelId`. A guarda usa
  isso para (1) reavaliar o loop com os dois lados (`loopVerdict`: replay dos últimos 8 pares na `LoopTracker`,
  3 ciclos) e (2) **pausar a conversa encerrada** (`closureVerdict`: o agente se despediu e ficou em silêncio,
  NO_REPLY ou sem resposta, em 2 turnos seguidos do contato) com a mesma pausa de verdade (sendPolicy deny +
  nota), que o app mostra como "pausado", como o usuário pediu ("como se estivesse clicando lá"). Silêncio
  depois de resposta com conteúdo (falha transitória) não encerra. Retomar é manual, e a nota diz ao agente para
  responder ao pendente quando voltar.
- Vazamento de erro em inglês (18 out): quando o primário e os fallbacks falham, o OpenClaw entrega ao chat o
  texto do erro ("claude-cli/claude-opus-5-5 request failed", "The model returned an empty response. Please try
  again.", "This turn ended before a reply: …"). A Sofía recebeu um desses e respondeu "parece uma mensagem de
  erro do sistema". `isOperationalNotice` agora cobre prefixos (↪️, ⚠️, "This turn ended…", "LLM request
  failed", "The model returned…", "The provider session expired", "NO_REPLY") e padrões
  (`<provedor>/<modelo> request failed`, "request failed … provider/model/status NNN", "empty response … try
  again"), só em textos de até 400 caracteres; a fala normal do agente, mesmo em inglês, passa (teste). Regra de
  encerramento (`meu-bot:encerramento v1` no AGENTS.md, gravada pelo install-guarda.sh): depois da despedida, o
  próprio agente responde NO_REPLY a cortesias; a conversa da Sofía mostrou NO_REPLY em 16:38 e 16:40.
- Loop só pelas saídas e pausa silenciosa (18 out, mais tarde): **confirmado ao vivo** que o OpenClaw 2026.9.9
  não chama `message_received` de plugins de fora, mesmo com `allowConversationAccess` (log de depuração na
  primeira linha do handler nunca apareceu enquanto o agente processava as entradas); `message_sending` chega.
  A `LoopTracker` passou a aceitar `sending` sem `received`: ciclo "só de saída", e nesse modo exige 4
  respostas de despedida/quase iguais em sequência (3 quando há entrada), para a despedida educada de um
  humano não pausar a conversa dele; simulado com a transcrição da Sofía, pausaria na 10ª resposta. Notas de
  pausa (manual e automática) e o bloco `meu-bot:pausa v2` do AGENTS.md agora mandam o agente responder
  **NO_REPLY** a tudo enquanto pausado e nunca mencionar a pausa ao contato: antes a nota pedia "registre com
  uma palavra" e o agente soltava um "Valeu." que aparecia no espelho como se tivesse respondido.
- Guarda por padrão na conta (18 out): o anti-loop não disparava porque o OpenClaw **não entrega
  `message_received` a plugins de fora do catálogo** sem `plugins.entries.<id>.hooks.allowConversationAccess:
  true`; a guarda via só as saídas (`message_sending`, que bloqueava as notas de fallback) e nunca fechava um
  ciclo. Caso real: Sofía (+595995661756), 40 trocas de despedida em 8 min; as regras já detectariam no 3º ciclo
  (simulado com a transcrição). Correções: `install-guarda.sh` grava a permissão; `FAREWELLS` ganha chau, dale,
  listo, nos vemos, que andes bien, cuidate, hasta la próxima, quedamos así, vos también, abraço; log
  "observando <contato> (entrada recebida)" na 1ª entrada por sessão para confirmar ao vivo; e o seletor
  (`picker.ts: ensureGuarda`) instala a guarda sozinho em toda máquina com OpenClaw que a sonda achar sem ela
  (uma tentativa por máquina por sessão do app). Tutorial 9 vira conferência. Depois de editar o plugin, o
  `--link --force` pode dizer "replacement not applied": rodar `openclaw plugins reload meu-bot-guarda`.
- CRM pelo WhatsApp, tutorial 14 (11 na época; 18 out, módulo Pro): o agente da máquina anota no Streak **pela API**, sem
  navegador, 24 h. Lado da VM em `backend-colima/crm/`: `streak.mjs` (CLI node puro: diag, pipelines,
  pipeline, box-find, box-create, box-update, field-set, comment, contact-upsert, telefone-set; chave em
  `~/.local/share/meu-bot/crm.json` 0600, nunca impressa), `crm-job.mjs` (lê a conversa com `gateway call
  chat.history` desde a marca d'água em `crm/estado.json`, pede um turno ao backend local — `model: agente`,
  `X-Conversation-Id: crm:+N` — com o prompt de `regras.buildPrompt`, espera o bloco ```crm-json``` {aplicado,
  propostas, resumo}, avisa o dono por `openclaw message send`; `--aplicar [n]`/`--descartar` respondem à última
  proposta sem LLM; `--dono --comando` para pedidos sem contato explícito; `transcricao +N` para o agente ler uma
  conversa), plugin OpenClaw `meu-bot-crm` (`message_received`/`message_sending` alimentam `SilenceTracker`
  persistido em `crm/tracker.json`; timer de 30 s dispara o job após `silencioMin` (config do plugin, 10); no chat
  do dono consigo mesmo: "anota no CRM: …"/"crm: …" → job, "ok"/"ok 2"/"não" → aplicar/descartar). Regras puras
  em `crm/regras.mjs` (testes crm-regras). `install-crm.sh`: copia, `plugins install --link`, grava
  `plugins.entries.meu-bot-crm.hooks.allowConversationAccess=true` (docs exigem para plugins de fora), semeia a
  skill `streak-crm-api`. Limites conhecidos: a transcrição do OpenClaw tem só contato + Rene (respostas manuais
  do dono pelo celular não aparecem) e `chat.history` devolve só a janela desde o último reset; por isso o comando
  do dono no chat consigo mesmo é o caminho garantido. Sem box e sem pedido do dono, o job não cria nada (só
  marca `semBox`). App: `crm-core.ts` (puro: `parseCrmPatch`, `setCrmSh` em base64, `crmInfoSh`, `streakSh`
  diag/pipelines) + `crm.ts` (gate Pro via `fetchLicense`), IPC `crm:info|install|set|test|reset` + evento
  `crm:progress`, `hostProbe.installCrm/uninstallCrm`, tutorial 14 `crm-whatsapp` (after `navegador`; o tutorial de extensões, 10 na época, foi removido em 19 out 2026,
  bodies crm-pro/crm-install/crm-config/crm-test, flag `crmSeen`), `proBlockText(a, view, "crm")`. Também
  corrigido: `licenca.js` faltava no `install.sh` e em `BUNDLE_FILES` (backend novo quebrava no require).
- Modo dividido (18 out): conversa à esquerda e uma página fixada à direita (Navegador, Terminal, Atividade,
  Tutoriais, Acervo, guia, chat do WhatsApp), como o terminal dividido do Cursor. `.content` vira grid de 3
  colunas (`--split`, mínimos de 320 px; `< 760 px` recolhe a direita com `split-collapsed`); os painéis de
  página já são absolutos, então `splitOn(page)` só **move o elemento** para `#split-panel` e `splitOff` devolve
  ao `#panels`. Regras: com a divisão ligada, páginas sempre vão para a direita (`activatePage` → `splitOn`) e
  conversas para a esquerda; arrastar a aba da página para a metade direita do conteúdo (camada `.split-drop`,
  por cima do webview; soltar à esquerda volta a tela inteira), Cmd+\ (também vindo do webview) e a paleta ("Dividir a tela
  com …"); fechar a página desfaz. `pageShown(page)` substitui `pageActive === page` nas repinturas (guia,
  Tutoriais, Acervo, polling do WhatsApp, pedidos do agente ao Navegador); `activeGuide()` considera a página
  fixada, então o guia pulsa os alvos ao lado da conversa. Divisor com pointer capture e `body.dragging`
  (webview/xterm perdem o mouse no arrasto). Lembrado em `localStorage split:<host>` (`lib/split.ts`, testado:
  `clampSplitRatio`, `splitLayout`, `parseSplitPref`); `restoreSplit()` no boot reabre a página (Navegador só
  com Pro; terminal sempre novo).
- Extensões MV3 no Navegador (18 out): o Streak não desenhava porque o service worker dele morria na primeira
  linha (`chrome.permissions.onAdded`: o Electron não tem `chrome.permissions`, `declarativeNetRequest`,
  `windows`, `alarms`…). `registerPreloadScript({type:"service-worker"})` NÃO alcança o contexto da extensão
  (testado: o marcador nunca apareceu). O que funciona: `patchExtensionFiles` (browser.ts) grava
  `src/preload/ext-polyfill.ts` (como script puro: o tsc emite cabeçalho CommonJS e `exports` não existe no
  worker; `polyfillSource` tira essas linhas) no começo do service worker e, por `<script src="/meu-bot-
  polyfill.js">`, nas páginas (popup/opções), com marcadores de início/fim versionados; depois recarrega a
  extensão uma vez (`removeExtension` + `loadExtension`). Versão sem marcador de fim → `reinstallExtension`
  (baixa de novo da Web Store). Resultado: o service worker do Streak roda, o pipeline aparece no Gmail dentro
  da aba (print em 18 out); sobram erros de `BackgroundPageCommunicator` (local storage/pixel tracker via
  background) sem efeito visível. Popups `window.open` com tamanho (OAuth do Google) viram janela de verdade
  (`action: "allow"`), senão `window.opener`/postMessage quebram; `_blank` comum vira aba interna. Diagnóstico:
  `POST /diag` no socket de ações (extensões, service workers, console da aba) e o log `sw chrome-extension://…`.
  Incidente: sem as ferramentas (interruptor desligado), o agente em modo bypass rodou `sudo npx playwright
  install` na agente-box; a regra v2 (navegador.js + CLAUDE.md) proíbe instalar navegador por conta própria.
  O interruptor "agente pode usar" agora é lembrado por máquina (`navAgentHosts` em settings) e religa ao
  abrir a aba; fechar a janela derruba socket e -R sem esquecer a escolha.
- Resposta em voz no espelho do WhatsApp (18 out): quando o agente responde em áudio, a mensagem do
  assistente no `chat.history` é uma chamada à ferramenta `mcp__openclaw__tts` (`stopReason: "tool_use"`,
  importada do claude-cli sem `runId`) com o `tool_result` "(spoken) …" — o filtro de rascunho descartava e o
  balão de "digitando" ficava preso para sempre. `spokenText` em whatsapp-chats.ts reconhece o par toolcall
  tts + "(spoken)" e mostra a fala como "🎙️ <texto>" (sem o "(spoken)", a chamada falhou e continua rascunho).
- "Instalar Claude Code" no seletor (17 out): uma conta sem Claude Code (outro usuário da mesma VPS, como
  `agente-openclaw` ao lado de `agente-box`: o Claude e o backend são por home) dava "✗ sem backend e sem Claude
  Code. Instale antes" sem botão. Agora `describeProbe` devolve `install: "claude"` e o seletor instala pelo
  instalador oficial (`curl -fsSL https://claude.ai/install.sh | bash`, binário em `~/.local/bin`, sem Node nem
  root; `installClaudeCode` em hostProbe.ts, canal `picker:install-claude`, 5 min de teto, idempotente). A
  sonda seguinte vê o `claude` e oferece "Entrar no Claude Code" e depois "Instalar backend", como sempre.
- Faixa OFFLINE (17 out): como no Rambox, para a pessoa saber que **o problema é na conexão dela, não no
  app**. `src/main/net.ts` sonda a internet (HEAD em `captive.apple.com/hotspot-detect.html` e
  `gstatic.com/generate_204`, 5 s; offline só se as duas falharem com erro de rede; qualquer resposta HTTP
  prova saída), ao abrir, por `net:check` (botão "Verificar agora", eventos `online`/`offline` do renderer),
  ao acordar o Mac e em qualquer erro de conexão do túnel/backend/GitHub/caixa do suporte
  (`noteNetworkError`); offline, resonda a cada 10 s; online, sem timer. `broadcast("net:state")` chega a
  todas as janelas (admin incluído). `src/main/net-core.ts` (puro, testado): `looksLikeOffline` (ENOTFOUND,
  EAI_AGAIN, ENETUNREACH… e o texto do ssh "Could not resolve hostname"/"Network is unreachable"),
  `isConnectionCode`, `isLocalAddr`, `offlineMessage`. Consequências: `readyTunnel` sai na hora com "Você está
  sem internet…" em vez de insistir 75 s culpando a VM; o erro da conversa e o `backend:status` dizem "sem
  internet"; o updater mostra "Sem internet; verifico de novo quando a conexão voltar" e refaz a checagem na
  volta (`onBackOnline`), que também revalida/reabre os túneis das janelas abertas. Renderer: `#offline-bar`
  (mesmo estilo da update-bar, fundo `--warn`, sem animação) com texto de `lib/offline-text.ts` (remoto; colima
  = "a máquina local responde, mas o Claude não", via `host:local-addr` = `ssh -G` + `isLocalAddr`; "há N min";
  "ainda sem internet (verificado agora)" depois do botão); pill "sem internet" e barra mini vermelha enquanto
  offline; aviso "✓ internet de volta" na conversa ativa. O grid do `body` ganhou linhas fixas por elemento
  (`grid-row`): antes, com a barra recolhida e a update-bar visível, o `1fr` caía na update-bar.
- Tutorial "Entrar na xAI (Grok)" (16 out): preparava o Grok na máquina (`install-grok-oauth.sh`), fazia o login da
  xAI pelo app e conferia a resposta do `grok-4`. Saiu em 24 nov (#518) com os canais `xai-login:*` e o instalador; o
  número 4 ficou vago, sem renumerar os outros. Os primeiros passos do módulo fazem esse papel (ligar, entrar pelo
  `entrar.sh`, testar a conexão):
  [meu-bot-diego.md › Motor de IA trazido por módulo](meu-bot-diego.md#motor-de-ia-trazido-por-módulo-24-nov-2026).
- Selo da lateral com duas notificações (16 out): o **número** são as pendências (interruptor "avisar na
  lateral" desliga); o **pulso** é novidade — tutorial visível, pendente e nunca visto (`localStorage
  tutVisto:<host>`, só cresce; abrir Tutoriais marca tudo que está à vista). A novidade não obedece ao
  interruptor: desligado, o selo mostra só as novidades, pulsando, até a pessoa abrir Tutoriais (`sidebarBadge`
  em tutoriais.ts, testado). Cartão de novidade ganha "NOVO ·" no selo durante aquela visita. Reaparecer (Refazer
  do 1 esconde 3/4; relogar mostra de novo) não é novidade. Resumo do topo: "Você fez 2 de 6 · próximo: 3 ·
  Status line · 1 novo · 2 em breve".
- Limites sem Claude Code interativo (16 out): o backend roda `claude -p`, e nesse modo a status line não
  executa, então mandar mensagem pelo meu-bot nunca gravava `ratelimits.json` (o passo "Ver os limites na
  conversa" não concluía). `account-status.js` ganhou `refreshRateLimits`: em `GET /v1/meu-bot/status`, se o
  cache tem mais de 60 s, busca `GET https://api.anthropic.com/api/oauth/usage` com o token OAuth do Claude
  Code da máquina (`~/.claude/.credentials.json`; Keychain no macOS; vencido = não chama) e grava o mesmo
  formato do statusline.sh (atômico, 0600; falha mantém o cache). O app consulta o status a cada resposta
  (`chat:account`), então o rodapé e o passo 4 atualizam logo depois da resposta. Motivo de não renovar vai
  ao log do backend quando muda ("limites da conta: no-token"). Testes em `scripts/tests/account-status.test.mjs`.
- Aviso de tutoriais na lateral (16 out): o "N tutoriais" ao lado de "Tutoriais" virou um selo com o número
  do que **falta fazer** (tour pendente + tutoriais não concluídos; arquivados e "Em breve" não contam;
  `tutCounts`). Some com zero. Em Tutoriais há o interruptor "avisar na lateral" (`localStorage tutBadge`,
  ligado por padrão) que desliga o selo, e o resumo "N para fazer · M arquivados · K em breve" no topo.
- "Refazer do zero" (16 out): tutorial concluído ganha, no cartão arquivado, um botão de dois cliques que
  desfaz na máquina o que o tutorial fez e esquece as marcações (`localStorage guia:<id>:<host>`), voltando
  ao passo 1: é o "excluir" do CRUD dos tutoriais. `Tutorial.reset.what` descreve o que é desfeito; a ação
  fica em `resetTutorial` (renderer). Status line → `backend-colima/uninstall-statusline.sh` (tira o nosso
  statusline.sh restaurando o `.antes-do-meu-bot`, volta o settings.json do backup ou tira só a chave
  `statusLine`, apaga `statusline-segments.json`; o cache de limites fica) via `uninstallStatusLine`
  (`statusline:uninstall`); suporte → `resetSupport` (desliga se ligado e esquece o nome, `support:reset`);
  WhatsApp → `whatsappLogout`. O tour já tinha "Rever". Nada disso no admin.
- Tutorial "Status line do Claude" (antes 2 passos, depois do "Ligar o suporte"; em toda janela, nunca no admin):
  instalar (o mesmo `installStatusLine` do seletor, agora também pela janela: IPC `statusline:status` com a
  checagem da sondagem e `statusline:install` com progresso em `statusline:progress`) e ver os limites no
  rodapé (conclui quando a conta da máquina traz `sessionPct`/`weeklyPct`, que só nascem depois que o
  Claude Code roda uma vez lá). `GuideContext.statusLine`. O seletor continua oferecendo instalar.
- Verificado de ponta a ponta (16 out, Electron rodando as funções do app): ligar → timer ativo e código na
  caixa → admin vê a pessoa, saúde, WhatsApp e 200 linhas de registro → desligar → a chave do admin passa a
  ser recusada e o timer/arquivos somem.

## Auditoria: quem fez o quê (20 out)

Cada máquina tem um registro de auditoria em `~/.local/share/meu-bot/auditoria.jsonl`, e só o
`backend-colima/auditoria.py` escreve nele. Cada linha registra `{ em, maquina, quem:{tipo,nome}, app, acao, alvo,
detalhe, prev, hash }`.
- **Quem pode aparecer:** `dono`, `admin` (pelo nome do app daquele admin), `agente` (pausa automática da guarda),
  `sistema` (backend: Mac novo, pedido de device) e `legado` (o antigo `suporte.log`, importado na 1ª gravação).
- **Corrente:** `hash = sha256(prev + JSON canônico sem hash)`. Se alguém apagar ou mudar uma linha, a corrente
  quebra dali em diante. `src/main/auditoria-core.ts` confere, e o teste prova que Python e TS calculam o selo igual.
- **Ações:** formam um catálogo fechado (`ACOES`), e o texto mostrado na tela sai dele.
- **Como o app grava:** manda o `auditoria.py` pela entrada padrão do SSH (`auditoriaSh`). O backend e a guarda usam a
  cópia em `~/.local/share/meu-bot/auditoria.py`, que o backend copia na subida.
- **O que entra:** limpar, excluir, restaurar, arquivar, renomear, pausar e retomar (do dono e do admin), guardar no
  CRM, parear e desconectar o WhatsApp, quem o agente responde, instalar e desinstalar o CRM, pedir plano, além das
  ações de suporte do admin (licença, device, reiniciar serviço, áudio, terminal, desligar suporte, excluir máquina).

**Cópia central**
- Fica no usuário Linux `auditoria` da caixa (agente-box), em `/home/auditoria/registro/<maquina>.jsonl`, com corrente
  própria e a hora do servidor.
- Quem entregou vem da chave SSH, não do que o app diz. O `/usr/local/bin/meu-bot-auditoria` é o comando forçado de
  cada chave, e o `authorized_keys` de lá é do root:
  - admin: só grava;
  - chave de entrega das pessoas: só grava;
  - super admin: grava e lê.
- Não há fila separada: a máquina é a fila. O app guarda até onde já entregou (`userData/auditoria-entregue.json`)
  e manda o resto depois de cada gravação. Linhas repetidas são ignoradas.
- Antes de desligar o suporte, o admin entrega o registro, porque depois perde o acesso à máquina.

**Admins**
- Cada admin tem um app e uma chave. O `scripts/suporte-setup.mjs` mantém `build/suporte/admins.json` e gera:
  - o `suporte.json` das pessoas (`admins:[{nome,chave}]`, uma linha `meu-bot-admin:<nome>` por admin no
    `authorized_keys` delas);
  - o `admins/<nome>.json` de cada admin (`admin`, `superAdmin`, caixa);
  - o `authorized_keys` da central.
- Comandos:
  - incluir ou trocar a chave de um admin: `--admin "Fulano" --chave "ssh-ed25519 …"`;
  - tirar um admin: `--remover "Fulano"` (ele perde o acesso quando a pessoa atualiza o app ou religa o suporte);
  - gerar o app de um admin: `./instalar.sh --admin --como "Fulano"`. Sem `--como`, sai o do super admin.

**Telas**
- **Pessoa:** Configurações › Suporte mostra "O que o suporte fez nesta máquina" e o botão "ver tudo" (50 últimas).
- **Super admin:** "🛡 Auditoria" na lateral da janela de cada pessoa, logo abaixo de Suporte, abre a aba
  "Auditoria · <pessoa>" (`src/renderer/admin/auditoria-page.ts`). Mostra:
  - a história da máquina desta janela, com filtros por tipo e texto;
  - os selos "central íntegra" e "cópia da máquina íntegra", e as linhas "apagadas da máquina";
  - **Exportar prova**: JSON com os hashes e um CSV legível.
  O main acha a máquina pelo alias da janela (`pessoasPorMaquina`); canais `admin:auditoria-visivel|auditoria|
  auditoria-exportar`. Até 26 out ficava no seletor, com a lista das máquinas da central; saiu para limpar a
  primeira tela (o `maquinas` da central continua, sem uso no app).
- Os outros admins não veem a linha, e a central recusa a leitura deles.

## Licença lida por SSH quando o backend não tem a rota (24 out)

Sintoma: o admin liberou o Pro da `grokbot-1` (gravou `licenca.json` lá, e o próprio admin passou a mostrar "pro"),
mas o meu-bot da pessoa continuou free. Causa: o app lia a licença só por `GET /v1/meu-bot/license`, rota do
backend-colima; a `grokbot-1` roda o backend original do Hermes, sem ela, e `fetchLicense` devolvia null ("backend
antigo"). Correção: `src/main/licenca-maquina.ts` (`lerLicenca`): backend primeiro; sem resposta e fora de `local`,
lê `licenca.json` + `maquinas.json` por SSH (`readLicenseViewSsh`, que era o `readLicenseView` do admin e saiu de
`admin/support-admin.ts` para cá; o admin importa daqui). `license:get`, `browser:open` e os gates de
`acesso.ts` (Pro, CRM próprio, financeiro) usam `lerLicenca`.

## Aba "Usuários" da máquina (27-28 out)

Linha "Usuários" na lateral, abaixo de Auditoria, só quando o admin entra na máquina como root
(`src/renderer/admin/usuarios-page.ts`, `src/main/admin/usuarios-admin.ts`, puro em `usuarios-core.ts`). Lista os
usuários de login (sudo, meu-bot, chave deste Mac, disco, RAM e tetos) e:
- **Cria** usuários comuns (sem sudo, `useradd -m`, a chave deste Mac no authorized_keys). Nasce com os tetos padrão
  `RECURSOS_PADRAO` (2 GB de RAM desde 5 nov; foi 1,25 GB de 30 out a 5 nov; 200% = dois núcleos): 14 boxes em 32 GB. O uso próprio é
  ~0,3-0,4 GB, mas o transcritor de áudio roda dentro da box (~0,6 GB por áudio): perto do MemoryHigh (1152 MB) a box
  fica apertada durante um áudio, e a coluna Pressão mostra. As boxes de antes seguem com o teto que tinham até o
  admin mudar na linha. Um agente travado não derruba a máquina.
- **Disco em %:** limite por cota de usuário no disco principal, em % do tamanho dele (uma fatia que se redistribui).
  A primeira vez liga a cota (com backup do fstab). Baixar abaixo do que o usuário já ocupa é recusado; a aba mostra
  as maiores pastas dele para o admin escolher o que apagar.
- **Tetos de RAM e CPU:** systemd, na fatia `user-<uid>.slice` (drop-in em `user-<uid>.slice.d`); apagar o usuário
  limpa o drop-in.
- **Sempre ligado (linger):** o Hermes de cada usuário roda com `systemctl --user`; sem linger ele morre quando a
  última sessão SSH do usuário fecha e não volta ao reiniciar. Criar já liga (`lingerSh`), apagar desliga antes do
  `userdel`; quem estiver sem mostra o botão "Manter ligado" (`admin:usuario-ligado`, auditado `usuarios.ligado`).
- **Aviso de disco:** "Usado" fica amarelo a partir de 80% do limite macio (quando a pessoa recebe o 1º aviso no
  WhatsApp) e vermelho em 100% (`nivelUso`), com uma linha contando quantos estão apertados.
- **Cota macia e dura (30 out):** `limiteSh` grava macio = o limite (o que a pessoa vê e o "Limite" da tabela) e duro
  = macio + max(10%, 300 MB) (`hardKbDe`), com carência de 7 dias (`setquota -t`). Entre os dois a conta ainda grava:
  é o que deixa o aviso de "acabou" sair pelo WhatsApp e o Hermes seguir por uns dias. Conta de antes da folga mostra
  "sem folga" ao lado do limite; Salvar o mesmo % aplica. `LISTAR_SH` lê `$2 $3 $4` da `quota -wu` e o duro vai na
  coluna 16 (as antigas não mudam de lugar). O limite de 1% por box é decisão de produto (a pessoa sente e faz upgrade);
  o que o backend dela faz com isso está em `guia/whatsapp.md` (vigia da cota) e `guia/agente.md` (Configurações › Espaço).
- **Governança de RAM/CPU (30 out):** além dos tetos, toda box leva isolamento no `recursosSh`: `MemorySwapMax=256M`
  (sem teto de RAM, `infinity`), `MemoryLow=640M` (o conjunto de trabalho medido: Hermes 240 + ponte 120 + backend 70)
  e `CPUWeight=100` (parte justa sob disputa; a cota continua sendo o teto). A reserva para o sistema é um teto no
  `user.slice` (todos os usuários juntos): total − max(3 GB, 10%), `MemoryLow` pela metade (com `memory_recursiveprot`
  o piso de cada box só vale até o do pai) e `CPUWeight=100` (`reservaHostSh`, com guarda em `anon` do user.slice: o
  `memory.current` do root é cache). O botão "Aplicar governança de RAM/CPU" aparece só quando falta a reserva ou há
  box sem isolamento (`governancaDe`: box sem `MemorySwapMax`); "Criar usuário" aplica a reserva antes se faltar.
  Tudo por `systemctl set-property` (persiste em `/etc/systemd/system.control`, vale na hora, nada reinicia).
- **Capacidade:** "boxes: N de M (2048 MB de RAM cada, teto dos usuários X)": M = teto do user.slice ÷ teto padrão
  por box (`capacidadeDe`); 32 GB → 28,9 GB → 14 boxes a 2 GB (eram 22 a 1,25 GB até 5 nov). CPU prometida acima dos núcleos é normal (as boxes
  ficam ociosas; o peso divide quando disputam). Criar além de M avisa, não bloqueia.
- **Pressão (coluna nova) e RAM:** `LISTAR_SH` lê o cgroup de cada fatia (`memory.current`, `anon` do `memory.stat`,
  `memory.peak`, `memory.swap.current`, `memory.events`, PSI de memória e CPU, `cpu.stat`). A coluna RAM mostra a
  memória própria (`anon`; o `memory.current` é ~70% cache descartável) com RSS, cache, pico e swap no título.
  Pressão = `pressaoDe`: estrangulada (OOM matou alguém, PSI mem ≥ 25%, PSI CPU ≥ 50%, ou teto batido e PSI ≥ 10%),
  apertada (PSI mem ≥ 10%, PSI CPU ≥ 25%, teto batido, ou anon ≥ 85% do MemoryHigh), senão folgada; o título diz o
  motivo e a dica. `events high` não conta (box saudável tem centenas: cache recolhido no MemoryHigh). `max`/`oom_kill`
  são cumulativos até recriar a fatia ou reiniciar.
- **Vigia da box:** o backend de cada usuário lê o próprio cgroup (`/proc/self/cgroup` → `/sys/fs/cgroup/user.slice/
  user-<uid>.slice`) e avisa a pessoa no WhatsApp (`box`, antes dos outros tipos) quando a box dela está no limite em 3
  leituras seguidas (OOM: na hora); a saúde do admin mostra "vigia: a box dela está no limite de RAM/CPU".
- **Swap:** liga 8 GB quando a máquina não tem nenhuma.
- **Apelido:** nome de exibição (GECOS); login e pasta não mudam.
- **Apagar:** usuário e pasta; nunca quem tem sudo, os do meu-bot (`PROTEGIDOS`) nem os do sistema (`RESERVADOS`).

## Usuários de login entram sozinhos nos seletores (28 out)

Na aba "Usuários" (máquina em que o admin entra como root), criar um usuário já o põe nos dois seletores, e apagar o
tira dos dois; ninguém instala nada na conta (Claude Code, login e backend ficam para quando ele for aberto no meu-bot).
- **Seletor do meu-bot e do staging:** um `Host <máquina>-<usuário>` no `~/.ssh/config` deste Mac (`blocoSshUsuario`,
  com o comentário-marca `# meu-bot-admin: usuário …`, backup `config.bak-…`). Apagar tira só o bloco com a marca
  (`removerBlocoUsuario`, `usuarios-core.ts`), com backup `config.antes-de-remover-<alias>`; o `removeSshHost` não serve
  porque corta até o próximo Host e leva o comentário do bloco seguinte.
- **Seletor do admin:** `adicionarUsuario` (support-admin.ts) reaproveita `adoptSshHost` pelo alias do meu-bot (põe a
  chave `meu-bot-admin` no authorized_keys) e guarda a pessoa com `usuarioDe: <id da raiz>`, sem `adotada`, então o
  "Atualizar pessoas" não a prepara. `esquecerUsuario` acha a pessoa pela identidade (`machineId` da raiz com
  `user = nome`) e a tira sem SSH na conta apagada; o fim do `removePerson` virou `esquecer(id)`, comum aos dois.
- **Os que já existem:** ao abrir a aba, `admin:usuarios-sincronizar` pega todo usuário comum (`candidatosAoSeletor`
  = `podeIrAoSeletor`: sem sudo, fora dos protegidos e do sistema) que falta em algum seletor, autoriza a chave deste
  Mac na conta como root (`chaveDesteMacNaConta`) e o põe nos dois; quem já está nos dois não custa SSH. É assim que a
  box criada pelo admin de outro Mac aparece aqui sem clique (23 nov: antes o filtro exigia `!meuBot`, que é "tem
  ~/.local/share/meu-bot" e deixava de fora toda box preparada, e `chave`, que só diz que o authorized_keys não está
  vazio). A aba diz em quais a chave entrou. O botão "Nos seletores" da linha (`admin:usuario-seletores`) refaz isso
  para um usuário e serve de nova tentativa. Auditoria: `usuarios.chave` (só quando a chave entrou) e
  `usuarios.seletor`.
- **O seletor vê na hora:** o do admin é atualizado depois de cada entrada/saída (`refreshPickerIfOpen`); o do meu-bot
  (outro processo) relê a lista ao ganhar foco, e só reenvia (e sonda de novo) se ela mudou (`lastHostsKey`), mantendo
  a máquina selecionada (`PickerInit.manterSelecao`).
- **Gravações no `pessoas.json` releem depois do SSH (28 out):** o `supportPeople` (ao abrir o seletor) lia o arquivo,
  passava segundos lendo a caixa e os planos por SSH e gravava a cópia velha: o `box-1`, que a sincronização gravou
  nesse meio tempo, sumiu. Agora a caixa é lida para uma lista (`pullInbox`) e juntada (`juntarCaixa`) ao arquivo
  relido no fim; `adicionarUsuario`, `esquecer` e `turnSupportOff` também releem depois do SSH e mudam só a pessoa deles.

## Preparar máquina: o checklist do root (30 out)

- **Problema:** o que uma máquina precisa antes da primeira box era feito em pedaços e em lugares diferentes: a
  reserva de RAM na criação do usuário, a status line na criação, o `gh` por conta em `~/.local/bin` (ou à mão em
  `/usr/local/bin`), os pacotes da tela do bot que `install-tela.sh` não consegue instalar sem sudo (sai com 3,
  "precisa-admin"), o Hermes e o transcritor pelo botão da aba Usuários, o Claude Code Global e o Link Público
  cada um na sua aba. Não havia uma lista "o que esta máquina ainda precisa".
- **Agora:** aba **Preparar máquina**, acima de Usuários, só quando o admin entra como root (a mesma conferência
  das outras três). Uma viagem SSH (`PREPARAR_ESTADO_SH`, `src/main/admin/preparar-core.ts`) imprime fatos
  `KEY=value` e `lerPreparar` decide, em TypeScript testado, o estado de cada item:
  - **ok** (✓), **falta** (✗, o botão aplica) ou **humano** (•, com o botão "Abrir …" da aba onde se resolve).
  - Itens, na ordem de dependência (`ORDEM_PREPARAR`): swap de 8 GB → cota de usuário → governança de RAM/CPU
    (reserva no `user.slice` e isolamento das boxes, só o que falta) → pacotes do sistema (`jq` da status line,
    `ffmpeg` da voz, e os da tela: `xvfb x11-utils openbox x11vnc novnc python3-websockify xdotool scrot`, lidos
    por `dpkg-query`, não por `command -v`: o novnc não tem binário) → `gh` em `/usr/local/bin` (binário oficial,
    versão pela URL final de `releases/latest`, sem a API) → Hermes em `/opt/hermes` → transcritor em
    `/opt/transcriber` (desde 3 nov vale para OpenClaw e Hermes, `bin/transcrever` e `bin/transcrever-texto`, e não
    depende do Hermes global; é o que liga a transcrição de todo mundo sem ffmpeg) → Claude Code Global (instalar é automático; o login do root é humano) → Chromium
    (opcional, marcado por padrão: o "gostinho" do Pro na box compartilhada inclui navegar na tela; no Ubuntu vira
    humano porque o apt entrega só o atalho do snap).
  - Link Público Global é sempre humano (domínio e login na Cloudflare): a lista só aponta para a aba.
- **Aplicar o que falta (N):** um `runSsh` por passo, com o prazo e a auditoria do instalador que já existia
  (`maquina.swap`, `maquina.cota`, `maquina.reserva`, `maquina.isolamento`, `maquina.pacotes`, `maquina.gh`,
  `maquina.hermes-global`, `maquina.transcritor`, `maquina.claude-global`) e `maquina.preparar` no fim com o que
  entrou. Falhar num passo não para os outros (os dependentes já imprimem o próprio `ERRO=`); a resposta traz
  `falhas` e a tela lista. Uma rodada por máquina de cada vez; o log do job vai pelo mesmo canal do "Criar usuário".
  Todo passo nasce com o guard de root, inclusive os instaladores antigos que confiavam em quem os chamava.
  Pacotes: `DEBIAN_FRONTEND=noninteractive`, `dpkg --configure -a` antes (conserta uma rodada interrompida) e
  `-o DPkg::Lock::Timeout=120` (o unattended-upgrades segura o lock); o log fica em `/tmp/meu-bot-pacotes.log`.
- **Criar usuário** chama `prepararMaquinaSuave` logo depois da reserva: aplica o que falta sem nunca falhar a
  criação (só o log avisa). Uma box nova não nasce numa máquina sem preparo.
- Os três botões da aba Usuários (governança, swap, Hermes) continuam: chamam as mesmas funções e aparecem só
  quando falta; a aba nova é o "tudo de uma vez".
- Canais `admin:preparar-estado` e `admin:preparar-aplicar` (ids opcionais; sem lista = tudo que falta, sem os
  opcionais). Testes: `scripts/tests/preparar-core.test.mjs`.

## Backend por box e "Atualizar todas" (30 out)

- **Problema:** nenhuma tela mostrava a versão do backend de cada box; a atualização dependia da sondagem ociosa do
  app de cada pessoa (`ensureBackendAtual`), uma por sessão. Na `meu`, a box-1 ficou no 1.8 enquanto a box-2 já
  tinha o 1.9. E o botão "Instalar o backend do meu-bot" da aba Suporte dava "ação inválida": `ADMIN_ACTIONS`
  oferecia `install-backend`, mas o guard do `admin:action` não o aceitava.
- **Agora:** `LISTAR_SH` imprime, por box com o backend na pasta própria (`~/.local/share/meu-bot/backend` com
  `.env` e `server.js`), uma linha `B\t<nome>\t<versão>` (linha separada, não coluna: a do cgroup é variável e
  deslocaria as seguintes). A tabela ganha a coluna **Backend** (`1.9.0`; `1.8.2 · desatualizado`; `sem versão ·
  desatualizado` para quem foi instalado antes do VERSION) e, quando alguma está atrás do que o app traz
  (`bundledBackendVersion()`), o botão **Atualizar todas (N)**: `atualizarBackends` reinstala uma por vez pelo
  alias de cada box neste Mac (a que não tem alias ganha a chave deste Mac e entra nos seletores antes), pulando quem
  está com chat em andamento (`/health.ativos`, a mesma regra da atualização ociosa); auditoria `backend.instalar` por box; a
  mensagem final lista puladas e falhas. O guard do `admin:action` aceita `install-backend`, e um teste em
  `admin-view.test.mjs` confere todo id de `ADMIN_ACTIONS` contra o main.

## Faixa de depuração ligada por padrão no admin (3 nov 2026)

- `padraoDaVariante()` (`src/main/app/depuracao.ts`) passa a valer para o meu-bot-admin além do staging: a janela de
  cada pessoa já abre com a faixa (build · branch · commit, batimento do main, túnel, o que chega de fora). Quem dá
  suporte precisa ver o build e o que falhou sem ter de ligar nada antes. Continua desligável pela paleta (Cmd+K,
  "Modo de depuração: desligar"), e a escolha gravada vence o padrão.

## Adotar um alias de máquina que já é pessoa (3 nov 2026)

- A identidade de uma pessoa é "chave do host + usuário@porta" (`machineId`). "ssh <host>" de um alias que resolve
  para a mesma identidade de alguém que já está na lista (`meu-root-hermes` e `meu-root`, por exemplo) **mantém a
  entrada que existe**, com apelido, plano e histórico; só o "visto" avança. Antes `addSupportCode` sobrescrevia a
  entrada, e o ⇅ do admin (que adota todo alias do `~/.ssh/config`) trocaria o nome da pessoa pelo alias e apagaria
  o plano Pro. Código colado (`MBS1.…`) continua substituindo: é a própria pessoa mandando de novo. O seletor relata
  esses aliases como "já estavam (mesma máquina e usuário)".
- **Alias renomeado no `~/.ssh/config`** (`machine` da entrada ≠ alias adotado): o nome e a máquina da pessoa seguem o
  alias novo, a menos que o admin tenha dado um apelido próprio (apelido igual ao nome antigo não conta e sai). O
  alias de suporte muda com o nome (o sufixo de 4 hex é da identidade e fica), então `meu-bot-suporte.conf` é
  reescrito e a janela aberta dela precisa reabrir. O seletor relata "renomeadas pelo alias novo: meu-root → meu-root-hermes".
- **Máquina reinstalada** (mesmo endereço, usuário e porta, chave do servidor diferente): a identidade muda, então
  seria outra pessoa, e a velha ficava na lista com a chave antiga (o admin recusa entrar: `StrictHostKeyChecking`).
  Ao adotar por "ssh <host>", a entrada velha é substituída pela nova, levando apelido (se não era só o nome antigo),
  plano e usuário de login; o conf de suporte é reescrito sem ela.
- **Sem caixa de entrada não é erro** (3 nov): `pullInbox` deixa de devolver o aviso "sem caixa de entrada configurada
  (rode scripts/suporte-setup.mjs…)" a cada leitura (60 s), que no seletor cobria a nota do ⇅. O admin funciona igual
  sem caixa: pessoas entram por "Adicionar pessoa" (código ou `ssh <host>`) e pelo ⇅. Fica uma linha no log, uma
  vez, e a dica no texto da lista vazia. O aviso de caixa que não respondeu continua, mas não cobre a nota durante
  um sync. E `picker:sync-ssh` passou do `registerIpc` do seletor de cliente para o bloco comum de `initPicker`:
  o admin não roda aquele bloco, e o clique dava "No handler registered for 'picker:sync-ssh'".

## "Nova VPS" com um clique no seletor (5 nov)

- **Problema:** ligar uma VPS nova ao meu-bot era um caminho manual e espalhado: alias no `~/.ssh/config` (só pela skill
  `vps-hostinger`, fora do app), "Adicionar pessoa ssh <alias>" (que disparava a preparação silenciosa de Claude Code e
  backend no root e cobrava login no Terminal), abrir a janela do root e "Aplicar o que falta" no Preparar máquina,
  "Criar usuário" na aba Usuários. Em 4 nov a VM do agente mudou de IP e o caminho inteiro teve de ser refeito à mão.
- **Agora:** botão **Nova VPS** ao lado de "Adicionar" no seletor de pessoas (`src/renderer/admin/picker-chrome.ts`).
  Premissa: a VPS nasce com a chave pública deste Mac (`~/.ssh/id_ed25519.pub`) cadastrada no painel do provedor
  (Hostinger: Configurações › Chaves SSH); senha nunca entra no app. O formulário pede endereço, nome curto, porta,
  domínio do link público (opcional) e três caixinhas (Chromium, primeiro usuário `box-1`, VPS reinstalada). O job
  (`src/main/admin/vps-nova-admin.ts`, canal `picker:vps-nova`, progresso em `picker:vps-nova-progresso`) encadeia:
  1. entra como root pela chave (`motivoAcesso` classifica o stderr do ssh: só chave → cadastre a pública; senha →
     idem ou `ssh-copy-id` uma vez; chave do servidor mudou → marque "reinstalada"; rede);
  2. grava `Host <nome>-root` no `~/.ssh/config` deste Mac (`acrescentarBlocoSshConfig`, backup ao lado; se já existe,
     pula) e confere que o alias entra;
  3. põe a máquina na lista de pessoas com `addSupportCode(alias, { preparar: false })` (sem Claude Code nem backend no
     root) e dá a ela o nome curto (os usuários nascem `<nome>-box-1`);
  4. `aplicarPreparar` com tudo que falta (mais o Chromium se pedido) e, com domínio, `instalarLinkPublico`;
  5. `criarUsuario("box-1")` ou, se já existe, `prepararUsuarioDeNovo`;
  6. o bloco para o modelo `config/ssh-hosts.conf` é só **sugerido** (botão "Copiar"): o arquivo é do repositório e vai
     dentro do .app.
  Termina com o recado do que fica para o admin: entrar no Claude Code do root (Claude Code Global), Link Público
  (Cloudflare e túnel) e o QR do WhatsApp no meu-bot de `box-1`. Auditoria: `maquina.vps-nova`. Rodar de novo na mesma
  VPS pula o que já está feito (cada passo relê antes de escrever). A parte pura está em `vps-nova-core.ts`
  (`parseVpsNova`, `motivoAcesso`, `blocoModeloDe`, `planoVpsNova`, `textoFinal`; teste `vps-nova-core.test.mjs`).
- **VPS que aceita senha (a chave deste Mac ainda não está lá):** o job abre o Terminal com `ssh-copy-id -i
  ~/.ssh/id_ed25519.pub -p <porta> root@<endereço>` (a senha nunca passa pelo app, como no login do Claude) e espera até
  15 min a chave entrar, conferindo a cada 10 s com BatchMode; depois segue sozinho. "VPS reinstalada" faz
  `ssh-keygen -R` antes de entrar.
- **Fora do clique, de propósito:** a caixa de entrada do suporte e a central de auditoria (hoje em
  `agente-box@187.127.41.175`, fora do ar). O recado final do job diz onde a caixa está (ou que não há) e o comando
  para recriá-la nesta VPS: `node scripts/suporte-setup.mjs --caixa <nome>-box-1 --root <nome>-root --nome <admin>` e
  uma release nova (os .dmg das pessoas levam o `suporte.json`).
