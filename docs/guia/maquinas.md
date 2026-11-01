# Máquinas, backend e seletor

> Parte do diário técnico do meu-bot, dividido por assunto em 27 out 2026. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

## Backend local no Colima (`backend-colima/`)

Quando a `grokbot-1` fica inacessível, o meu-bot usa a VM do Colima (host `colima` do
`~/.ssh/config`, incluído pelo Lima) com um backend próprio, sem dependências npm:

- `backend-colima/server.js`: `node:http` puro. Mesmo contrato do backend da grokbot-1
  (`/v1/models`, `/v1/chat/completions`, Bearer, SSE legado, `X-Stream-Mode: live`,
  `X-Conversation-Id`/`X-Conversation-Seen` → `X-Session-Resumed`). Modelos: `claudecode` (chat,
  8 turnos, `--permission-mode default`) e `agente` (30 turnos, `--dangerously-skip-permissions`,
  cwd `~/agent-workspace`: edita arquivos e roda comandos na VM do Colima sem perguntar).
  Spawna `~/.local/bin/claude -p --output-format stream-json --include-partial-messages` em
  `~/chat-workspace`; `res.on('close')` aborta a CLI.
- `backend-colima/session-map.js`: cópia do mapa de sessões da VM remota.
- `backend-colima/meu-bot-backend.service`: unidade systemd de usuário (linger já ativo na VM).
- `backend-colima/install.sh`: baixa Node 20 (`.tar.gz`; a VM não tem `xz`) em `~/.local/node`,
  copia os arquivos para `~/.hermes/agente-rene/backend-sdk-claude` (mesmo caminho que o app
  procura o `.env`), gera `OPENAI_COMPAT_KEY` se não existir e sobe o serviço.

Atualizar: `scp backend-colima/* colima:~/backend-colima/ && ssh colima bash ~/backend-colima/install.sh`.
Logs: `ssh colima journalctl --user -u meu-bot-backend -f`. A VM do Colima tem 4 GB; cada CLI do
Claude usa ~250 MB. Se faltar memória: `colima stop && colima start --cpu 4 --memory 8`.
O Claude Code dentro da VM precisa estar logado (`claude /login` lá) — o backend devolve 401
`claude_auth` quando a CLI responde "Not logged in".

## Máquinas (hosts) por conversa

- Cada conversa guarda `host` (alias do `~/.ssh/config`) desde a criação; o seletor de modelo troca
  só o modelo. "Máquina padrão" nas Configurações vale apenas para conversas novas. Para usar outra
  máquina, mude o padrão e abra uma aba nova; as antigas continuam na máquina em que nasceram.
- `src/main/tunnel.ts` mantém um túnel por host (`Map<host, HostTunnel>`: master, forward, estado,
  suspeita pós-sleep). `backend:status` leva `host`; o renderer guarda o último estado por host e
  mostra o da aba ativa. Com abas em máquinas diferentes, o badge da aba vira "máquina · modelo".
- Trocar a porta fecha todos os túneis (recusado com resposta em andamento). Trocar o host padrão
  não mexe em túnel nenhum.
- Host sem backend: `fetchBackendKey` lança `TunnelFatalError` (sem retry) com a instrução de
  instalar pelas Configurações.
- `src/main/hostProbe.ts`: `probeHost` roda um script por ssh avulso (ControlMaster=no) e devolve
  usuário, SO, arquitetura, backend instalado/ouvindo, caminho do `claude`, login (procura
  `oauthAccount` em `~/.claude.json`), Node e systemd. `installBackend` copia `backend-colima/`
  (em `Contents/Resources/backend-colima` no .app, via `extraResource`) para `~/.meu-bot-install`
  no host e roda `install.sh`, com progresso por `backend:install-progress`.
- `install.sh` é idempotente: usa Node existente (>= 18) ou baixa o 20 em `~/.local/node`; unidade
  systemd de usuário (com linger) ou, como root, unidade do sistema em `/etc/systemd/system`;
  grava `CLAUDE_BIN` no `.env`; termina com um GET em `/v1/models`.
- Estado das Configurações por host: "✓ backend instalado e ouvindo", "⚠ Claude logado, sem backend"
  (botão Instalar), "✗ Claude não logado" (instruções `ssh -t host claude` + `/login`), "✗ inacessível".

## Máquina "local" (este Mac, sem SSH)

- Host especial `local`, primeiro do seletor ("este Mac (sem SSH)"). `src/main/localBackend.ts` copia
  `server.js` e `session-map.js` do bundle para `userData/backend-local`, gera `.env` (chave própria,
  porta fixa 8790 porque o Lima do Colima costuma encaminhar a 8080 para o Mac) e sobe o Node como
  processo filho; log em `userData/backend-local.log`. Workspaces em `~/meu-bot-workspace/{chat,agente}`.
- Apps de GUI no macOS têm PATH mínimo: `findNode`/`findClaude` procuram em Homebrew, /usr/local,
  `~/.local/bin`, `~/.local/node`, nvm e, por fim, num `zsh -lc`. Login = `oauthAccount` em `~/.claude.json`.
- O managed settings deste Mac já põe `bypassPermissions` como padrão, então até o `claudecode` roda
  sem pedir permissão aqui; o `agente` é explícito com `--dangerously-skip-permissions`.
- O processo morre com o app (`will-quit` → `closeTunnel()` → `stopLocalBackend`); se morrer sozinho,
  o host fica `degraded` e a próxima mensagem sobe de novo.

## Modelo `agente` na grokbot-1

- `backend-vm/services/openai-compat.js` ganhou o modelo `agente` (bypassPermissions, 30 turnos, cwd
  `~/agent-workspace`, sem bridge-rene nem MCP dedicado). `backend-vm/deploy-agente.sh` faz backup,
  copia, roda os testes, `pm2 restart hermes-mythos-lucas` e um smoke que cria um arquivo.

## Mapa das máquinas (14 out 2026)

| Alias ssh | Endereço | Usuário | O que é | Backend do meu-bot | Modelos |
|---|---|---|---|---|---|
| `local` | este Mac, sem SSH | box | macOS, Node 26 (Homebrew), Claude Code 2.1.300 logado (m6), bypass global por managed settings | processo filho do app, porta 8790 | claudecode, agente |
| `colima` | 127.0.0.1:53314 (VM Lima) | box (home `/home/box.guest`) | Ubuntu 24.04 arm64, 3 CPU / 4 GB, Node 20 em `~/.local/node`, Claude Code 2.1.299 logado (m5) | systemd user `meu-bot-backend`, 8080 | claudecode, agente |
| `agente-box` | 187.127.41.175 (público, sem NAT) · Tailscale 100.65.117.27 · IPv6 2a02:4780:6e:8383::1 | box (uid 1002, sudo sem senha) | Debian 13 x86_64, 2 CPU / 8 GB, hostname `agente`, Node 24 em `/opt/node`, Claude Code 2.1.300 nativo em `~/.local/bin`, logado | systemd user `meu-bot-backend` com linger, 8080 | claudecode, agente |
| `agente-root` | mesma máquina acima | root | Claude Code global 2.1.296 (`/usr/local/bin/claude` → `/opt/node`), não logado; root não roda bypass | nenhum | — |
| `grokbot-1` | Tailscale 100.69.163.93 (hostname grok-bot-vm-153046289) | box | Linux x86_64, 8 vCPU / 16 GB, sem systemd; Tailscale SSH servido por `tailscaled` sob PM2; daemon do Grok Bot, Hermes do WhatsApp, backend original (`hermes-mythos-lucas`) | pm2 `hermes-mythos-lucas`, 8080 | claudecode, rene, rene-dm, rene-buffer (+ agente após o deploy) |

Outros nós do Tailscale: `agente-br` (= agente-box/root), `grokbot-2` (este Mac), `grokbot` (antigo, offline).
O sshd da `agente-br` aceita senha (`PasswordAuthentication yes` em `/etc/ssh/sshd_config.d/50-cloud-init.conf`); vale desligar.

## v3: uma janela por máquina

- Abertura: `showPicker()` (`src/main/picker.ts`) sempre; Enter abre a última máquina (`lastHost` nas
  settings). Segunda instância (`requestSingleInstanceLock` + `second-instance`), clique no Dock sem
  janelas, Cmd+Shift+N (`src/main/menu.ts`), e a ação da paleta abrem o mesmo seletor.
- `src/main/windows.ts`: registro `host → BrowserWindow` (uma por host), última focada, `sendToHost` /
  `broadcast` / `sendWhenLoaded`, bounds por máquina, pré-aquecimento do túnel ao abrir e carência de
  5 min antes de derrubar o túnel de uma máquina sem janela (adiada se houver turno/resumo).
- O renderer descobre a máquina por `window:info`; todo handler resolve o host pela janela remetente
  (`hostFromEvent`) e a propriedade da conversa é `conv.host === host`. `windowId` sumiu.
- `Sender` do backend é por host e resolve a janela a cada evento: fechar a janela no meio da resposta
  não perde a resposta. `memory:changed` e `settings:changed` são broadcast.
- Entrada rápida vai para a última janela focada (ou abre a do último host); o ack é validado pelo
  id do webContents que recebeu o pedido.
- Settings v3: `sshHost` → `lastHost` (migração em `settings-normalize.ts`), `defaultModelByHost`,
  `windowBounds`. "Modelo padrão nesta máquina" grava por host.
- Seletor: lista imediata, sondagens em paralelo com cache de 60 s (`picker.ts`), `describeProbe`
  (`src/renderer/lib/probe-text.ts`) decide texto/botão, `hostAccent` (`lib/host-color.ts`) dá a cor
  da faixa e da bolinha. Instalação do backend acontece ali, com progresso.
- Menu próprio: inclui `editMenu` (senão Cmd+C/V somem) e `windowMenu` (lista as janelas por título).
- Testes novos: `order`, `host-color`, `probe-text`, `settings-normalize`.

## Atalhos na área de trabalho (`src/main/shortcuts.ts`)

- "meu-bot <host>.app" é um applet AppleScript (`osacompile`) que roda o binário do app com
  `--host=<host>`. Com o app aberto, isso vira
  `second-instance` na instância principal, que abre a janela da máquina direto (`openFromArgs`).
  `open -a` não serviria: num app em execução o macOS descarta os `--args`.
- Ícone: janela offscreen do Electron renderiza um quadrado arredondado com cor e emoji sorteados
  (`randomLook`), `capturePage` → PNG 1024² → `iconutil` monta o `.icns`. O applet traz um
  `Assets.car` com o ícone padrão, que o Finder prefere: é removido junto com `CFBundleIconName`.
- Marcador `Contents/Resources/meu-bot-host.txt` (linha 1 `meu-bot-shortcut-v1 <host>`, linha 2 o
  emoji): só o que tem marcador é removido pelo botão; o emoji aparece no botão do seletor.
- `LSUIElement` no applet evita o ícone piscar no Dock. Se o Finder mostrar o ícone antigo, `touch`
  no bundle resolve (o Finder cacheia por data).

## Botão "aliviar grokbot-1" (`scripts/alivio/`)

- `alivio-pod.sh` vive no pod em `~/bin/` (cópia versionada aqui): encerra CLIs do Claude do backend
  presas há mais de 30 min (`LIMITE_S`), Chrome headless, e com `--tailscale` agenda `pm2 restart
  tailscaled` em 2 s via nohup (a sessão ssh cai e volta). Log em `~/alivio.log` no pod.
- `aliviar-grokbot1.sh` roda no Mac num Terminal: ssh com ConnectTimeout 90 s, mostra antes/depois e
  oferece abrir `~/Desktop/grokbot-1.app` (atalho do meu-bot) 8 s depois. Se o ssh não entrar, diz que
  o pod está congelado pelo host e que o caminho é reiniciar pelo app do Grok Bot.
- `~/Desktop/aliviar grokbot-1.app`: applet osacompile que faz `open -a Terminal aliviar-grokbot1.command`
  (cópia executável do .sh). Não usar `tell application "Terminal"`: isso pede permissão de Automação na
  primeira vez e, sem resposta, o clique não faz nada. Ícone 🧯 sobre vermelho pelo mesmo método dos
  atalhos (Assets.car removido, LSUIElement).
- A `grokbot-1` é um contêiner (pod) da infraestrutura do Grok Bot: PID 1 `tini`/`pod-daemon`, overlay em
  `/var/lib/isod`, IP 172.30.0.2 atrás de NAT, sem systemd nem sudo, `virtio_balloon` do host pausa a
  máquina. O alívio só alcança processos nossos e o PM2.

## Sincronizar SSH e alívio pelo seletor (14 out 2026)

- `config/ssh-hosts.conf` é o modelo versionado das máquinas (formato do `~/.ssh/config`, sem segredo).
  Botão ⇅ "sincronizar ssh" no rodapé do seletor → `picker:sync-ssh` → `sshSync.ts`: lê o modelo
  (`Resources/config/` no .app), planeja com `ssh-sync.ts` (puro, testado: Include normalizado com `~`,
  Host existente nunca alterado, "só neste Mac" relatado), faz backup `config.bak-<data>` e **acrescenta**
  no fim. Pergunta de origem: "num Mac novo, como sincronizar com o Cursor?" Resposta: não há sync; os
  dois leem o mesmo arquivo, o botão só preenche o arquivo.
- Sondagem ganhou `grokPod` (PID 1 `pod-daemon` ou cgroup `pod-`), lembrado em `settings.podHosts`
  (só uma sondagem que entrou atualiza; inacessível não apaga). Linha do pod: botão 🧯 "aliviar agora"
  (`picker:relieve` → `showRelief`, fecha o seletor). Caixa de baixo: "🧯 Botão de alívio na mesa"
  (`picker:relief-shortcut` → `createReliefShortcut`, applet `aliviar <host>.app`, `RELIEF_LOOK` fixo).
- `shortcuts.ts` virou genérico: `createApplet(nome, arg, look)` + marcador `meu-bot-shortcut-v1 <nome>`.
  O `aliviar grokbot-1.app` feito à mão ganhou o marcador para o app reconhecer e poder substituir.
- `relief.ts` não depende mais de `~/bin/alivio-pod.sh` existir: manda o script pelo stdin do ssh
  (`cat > ~/bin/alivio-pod.sh && bash …`). Empacotado em `Resources/alivio/` (extraResource).
- Testes: 33 (novo `ssh-sync.test.mjs`).
- "seletor na mesa" (`seletor.app`, `--picker`) foi removido: o próprio `meu-bot.app` e o Dock já abrem o
  seletor. `--picker` em argv ainda cai no padrão (`showPicker`) por não ser `--host`/`--alivio`.
- Ajustes de interface (14 out, noite): botão "Nova conversa" virou "Novo" (dica com Cmd+T); lista de
  conversas oculta por padrão (`localStorage.sidebarShown`, ☰/Cmd+B); rolagem do chat só acompanha o fim
  da resposta se a pessoa já estava perto do fim (`followBottom`, 48 px; evento scroll decide). Antes,
  cada tick de render puxava para baixo e quem rolava para cima para ler era arrastado de volta.
- Paleta ⌘K: mover o mouse sobre a lista rolada fazia a lista "pular para cima". Causa: `mousemove`
  chamava `paintPalette()`, que reconstrói a lista com `replaceChildren` (zera a rolagem) e dava
  `scrollIntoView`. Agora `selectPalette(i, scroll)` só troca `aria-selected`; a lista é reconstruída só
  ao abrir e ao digitar, e o `scrollIntoView` fica para o teclado.
- Configurações em seções recolhíveis (`<details class="group">`): Conexão, Aparência e avisos, Entrada rápida
  (Memória e contexto existiu até 30 out 2026; ver [navegador.md](navegador.md)). Acordeão: abrir uma recolhe as
  outras; nada é lembrado: toda vez que as Configurações abrem, todas começam recolhidas.

## Grok Bot: Atualizar vs Redefinir, deep link e verificação do Tailscale SSH (15 out 2026)

- `grokbot://app/v1/settings?id=<id>` (esquemas `grokbot` e `sand` no Info.plist do app) abre as
  Configurações do Grok Bot no card pedido; `reset-computer` e `update-computer` estão na seção
  "computer". É navegação: o card "Redefinir" tem o botão vermelho, e só o clique lá redefine.
  Lido do `app.asar` (lista de ids, rota `/v1/settings`, estado `resetComputer`/`recoverComputer`).
- "Atualizar o computador do Bot" = troca a base, "arquivos e logins ficam, aplicativos e pacotes
  instalados são removidos". Não é socorro. Testado em 15 out 02:20: tudo nosso sobreviveu (home
  inteira: Node em ~/.local, PM2 com 16 processos, backend 8080, proxy xAI, gateway, alivio-pod.sh).
  "Redefinir" = "comece do zero se travar", reconstrói do último snapshot; é o socorro para pod congelado.
- App: janela de alívio, quando o ssh não entra, faz contagem de 6 s e abre o Grok Bot no card Reset
  (`src/main/grokbot.ts`, `shell.openExternal`); "Abrir agora" antecipa, Fechar cancela. Seletor: pod
  inacessível ganha o botão "Abrir o reset no app do Grok Bot".
- Pegadinha nova: depois da atualização o Tailscale SSH passou a exigir "check" (aprovação de um link
  `https://login.tailscale.com/a/…` no navegador). Sintoma: `Connection … port 22 timed out` com
  `# Tailscale SSH requires an additional check` no stderr. O link só vale para a sessão ssh que o
  pediu. O app agora detecta (`tailscaleCheckUrl`), e: no seletor mostra "Aprovar verificação do
  Tailscale" (ssh paciente de 4 min + link no navegador + re-sonda); na janela de alívio abre o link e
  espera até 5 min, sem contagem para o reset. O usuário notou: "não era reset, só faltava logar".

## Tailscale SSH: de check para accept pela API, dentro do app (15 out 2026)

- Problema: o "check" do Tailscale SSH pede aprovação de um link no navegador a cada 12 h e depois
  de troca de chave do nó (ex.: "Atualizar o computador" do Grok Bot). O app já abria o link; agora
  resolve de vez editando a política do tailnet: `"ssh"[].action: "check" → "accept"`.
- Módulos (main): `tailscale-policy.ts` (puro: tokenizer + parser mínimo de HuJSON com spans;
  `applySshAction(text, "accept"|"check")` edita por índice, preserva comentários e formatação,
  remove `checkPeriod` ao ir para accept, insere a regra padrão se não há bloco ssh; `stripHujson`
  para os testes), `tailscale-api.ts` (node:https, `baseUrl` injetável: `oauthToken`, `getPolicy`
  com `Accept: application/hujson` + ETag, `validatePolicy`, `setPolicy` com `If-Match`; erros
  tipados auth/conflict/invalid/network/timeout em pt-BR), `secrets.ts` (OAuth client cifrado pelo
  `safeStorage` em `userData/tailscale-oauth.bin`, 0600; renderer só vê `{configured,
  encryptionAvailable}`), `tailscale.ts` (`disableSshCheck`: credencial → token → GET → backup em
  `userData/tailscale-policy-backups/` (10 últimos) → edição → validate → POST If-Match;
  `restoreLastPolicy` desfaz).
- Seletor: com verificação detectada, botão "Desligar a verificação de vez". Sem credencial, abre o
  formulário inline (Client ID + secret, link para Settings › Keys); com credencial, roda e re-sonda
  após 8 s (o tailscaled recarrega e a porta 22 recusa por segundos). Option+clique no botão mostra
  "Esquecer credencial". Enter/setas não vazam do formulário para a lista. Paleta: "Tailscale:
  desligar verificação do SSH" e "…restaurar política do último backup" (guarda `hostFromEvent`).
- Escopo mínimo do OAuth client: Policy File leitura+escrita (`policy_file`). Docs verificados em
  15 out: token `POST /api/v2/oauth/token` (form), `-` = tailnet da credencial, 412 em `If-Match`
  errado, validate não salva, `checkPeriod` 1 min a 168 h, padrão 12 h.
- Testes: `tailscale-policy.test.mjs` (política real do usuário como fixture, iscas em comentários e
  grants, várias regras, inserção) e `tailscale-api.test.mjs` (servidor falso: token, ETag, 412, 400).

## Porta do backend por máquina (18 out 2026)

- **Problema:** a porta era uma só no app (`backendPort`, 8080). Duas contas na mesma máquina (`agente-box` e
  `agente-openclaw` na mesma VPS) não cabem na mesma porta: a segunda conta instalava e o seletor dizia "sem
  backend" ou abria o túnel para o backend da outra conta (401). A porta é propriedade do backend de cada
  máquina (o `PORT=` do `.env` dele), não do app.
- **Settings:** `backendPortByHost` (vence a padrão; igual à padrão tira a exceção), `getBackendPort(host)`,
  `setBackendPortForHost`. Todo `ensureTunnel`/`probeHost` passa a porta da máquina. Na janela de uma máquina o
  campo "Porta do backend" edita só a dela (`backendPortForHost`); na janela deste Mac edita a padrão das demais.
  Trocar derruba só o túnel afetado (todos, se a padrão mudou), com a mesma recusa de resposta em andamento.
- **Sondagem** (`hostProbe.ts`): lê `PORT=` do `.env` do backend (`backendPort`), checa "ouvindo" e `/v1/models`
  **nessa** porta, diz se a porta do app está tomada (`portBusy`) e a primeira livre acima dela até +30
  (`freePort`). `appPort` é a porta com que a sondagem foi feita, para o texto do seletor.
- **Seletor** (`probe-text.ts`, puro e testado): backend instalado em outra porta → "⚠ … está na porta 8081, mas
  o app usa a 8080" e botão **"Usar porta 8081"** (`picker:use-port`, canal compartilhado: grava só para a
  máquina, derruba o túnel dela, invalida a sondagem). É configuração deste Mac, nada escrito na máquina da
  pessoa, por isso o meu-bot-admin também mostra o botão (os outros botões de instalar continuam só no cliente). Sem backend e porta do app ocupada → "⚠ … a porta 8080 já está ocupada nesta
  máquina (outra conta ou outro programa)" e botão **"Instalar backend na porta 8081"**; `picker:install` usa a
  porta que a sondagem decidiu (a do `.env` ao reinstalar, a livre quando ocupada, senão a do app) e, se não
  for a configurada, grava para a máquina ao terminar. Sem porta livre, manda trocar nas Configurações.
- **install.sh:** com `.env`, o `PORT=` dele manda (um `PORT=` diferente pedido só fazia a checagem do fim
  falhar); instalação nova em porta ocupada sai com código 4 e explica, antes de escrever qualquer coisa.
- Verificado na VPS `agente`: sondagem em `agente-openclaw` → `envport=8081 port=1 busy=1 freeport=8082
  models=claudecode,agente`; reinstalar com `PORT=8080` mantém 8081 e responde OK.

## Gateway do OpenClaw em porta própria (18 out 2026)

- **Sintoma:** ao gerar o QR (ou na consulta de estado) em `agente-openclaw`: `gateway connect failed:
  GatewayClientRequestError: unauthorized: gateway token mismatch`. Causa: a segunda conta da mesma VPS não tem
  `gateway.port` autorado; a CLI cai no padrão 18789, que é o gateway da conta `box` (token diferente), e o
  serviço dela, preso à mesma porta, falha com exit 78 ("Another process is listening on this port").
- **Conserto automático** (`whatsapp.ts`, `GATEWAY_FIX_SH`, nos dois scripts remotos): "token mismatch" no
  `channels status` → `gw_fix`: primeira porta livre a partir da configurada (até +30) vira `gateway.port`,
  `openclaw gateway install --force --port N` regrava a unidade systemd de usuário (backup `.bak` do OpenClaw),
  `reset-failed`, e espera o `channels status --json` responder (até ~36 s). Só gateway `mode=local` sob
  systemd; sob supervisord (computador do Grok Bot) ou remoto, não mexe.
  - Estado do WhatsApp: a consulta já conserta e devolve `repaired` ("✓ Consertado sozinho: …" no painel);
    se não deu, `detail` explica com os dois comandos.
  - Pareamento: antes do `channels login`, conserta e emite o passo "ganhou a porta própria N"; se não deu,
    erro claro em vez do texto cru da CLI.
- Verificado na VPS `agente` (conta `openclaw`): porta livre 18790, serviço ativo, `channels status` ok,
  gerenciador de usuário voltou de "degraded" para "running".
- **Bug antigo corrigido junto:** os dois `echo` do evento `connected` no PAIR_SCRIPT tinham `\"` no template
  literal do TS, que vira `"` antes de chegar ao shell; o shell então imprimia `{event:connected,user:{id:…}}`
  (sem aspas), o `JSON.parse` falhava e o app nunca recebia "connected" pelo evento (só pelo refresh do
  estado depois do `done`, com "terminou sem conectar"). Agora é `\\"` (o shell recebe `\"`), como o evento
  `gateway-port`. Conferido avaliando o template do `dist/` e rodando no bash: JSON válido.

## Backend e proxy do Grok em conta secundária da mesma máquina (18 out 2026)

- **Sintoma:** "Preparar o Grok" em `agente-openclaw`: `Failed to restart meu-bot-backend.service: Unit
  meu-bot-backend.service not found.` Causa dupla, a mesma família das portas: (1) o `install.sh` decidia
  "serviço de usuário" pelo código de saída de `systemctl --user is-system-running`, que é ≠ 0 também em
  `degraded` (o openclaw-gateway dessa conta estava falho), e mandou o backend para `/etc/systemd/system`;
  todo script que faz `systemctl --user restart meu-bot-backend` quebrava. (2) O proxy do Hermes era fixo na
  8645, que já é da conta `box`: o da conta `openclaw` saía com status 2 e o grok-4 apontava para o proxy (e a
  conta xAI) do vizinho.
- **install.sh:** `user_manager()` aceita running/degraded/starting/maintenance. Conta com serviço de sistema
  antigo (`User=` desta conta) é migrada: `sudo -n systemctl disable --now` + remove a unidade + daemon-reload e
  nasce a de usuário; sem sudo, mantém o de sistema e avisa.
- **install-grok-oauth.sh:** `backend_restart()` reinicia o que existe (usuário → sistema via `sudo -n` →
  aviso para "Reinstalar backend"); o node vem da unidade de usuário ou da de sistema. Porta do proxy: a que a
  unidade desta conta já usa, se ninguém de fora a ocupou (`ss -ltnp` só mostra processo dos sockets desta
  conta); senão a primeira livre a partir de 8645. `providers.json` aponta para essa porta.

## Backend do meu-bot agnóstico de agente (25 out)

Princípio: o app não depende de qual agente roda o WhatsApp na máquina (Hermes, OpenClaw, PicoClaw). O backend do
meu-bot (`backend-colima`) é serviço nosso e tem pasta própria. Até aqui ele vivia numa pasta herdada do Hermes
(`~/.hermes/agente-rene/backend-sdk-claude`, porta 8080) e a sondagem chamava de "backend instalado" qualquer
`server.js` que estivesse lá; na grokbot-1 esse `server.js` é o do Hermes, e daí vinham o "Reinstalar backend" perigoso
(o `install.sh` já recusava, mas o seletor oferecia) e "o backend desta máquina é anterior ao financeiro".

- **`src/main/backend-dir-core.ts`** (puro, testado com bash num HOME de mentira): `BACKEND_DIR_CANONICAL` =
  `~/.local/share/meu-bot/backend` (ao lado da licença e do CRM), `BACKEND_DIR_LEGACY` = a herdada, e `BACKEND_DIR_SH`,
  trecho de shell que deixa em `$BD` a pasta do nosso backend (a própria se existe; a herdada só quando o `server.js` de
  lá tem a rota `meu-bot/hello`, que só o nosso tem) e `$FOREIGN=1` quando a herdada tem outro backend.
- **Quem usa:** a sondagem (`hostProbe.ts`: `env`, `server`, `VERSION`, porta do `.env`, modelos; `backendInstalled`
  agora só para o nosso; campo novo `backendForeign`), o túnel (`tunnel.ts` lê a chave de `$BD/.env`), a chave xAI
  (`xaiKey.ts`), o log do backend no admin (`support-admin.ts`), o `install.sh` (mesma regra em bash; `MEU_BOT_BACKEND_DIR`
  força), o `install-grok-oauth.sh` e o backup (os dois `.env` na lista de caminhos).
- **Instalações existentes não mudam:** colima e as `agente-*` têm o nosso `server.js` na herdada e continuam lá.
  Instalação nova (ou máquina com outro backend na herdada) vai para a pasta própria; com a 8080 ocupada, o seletor já
  escolhe a primeira porta livre e grava só para a máquina (`portaParaInstalar`), e o texto diz de quem é a 8080.
- **Auto-update do backend:** a trava deixou de ser "gateway é Hermes" e passou a ser estrutural: `backendInstalled`
  falso para backend que não é nosso → `precisaAtualizarBackend` devolve "nao".
- **Licença e CRM numa máquina só com Hermes:** a extensão do CRM, a importação do Google e "Guardar no CRM" exigem a
  licença lida pelo NOSSO backend (`crmDaMaquinaOk`, `lerLicencaDaMaquina` → `{view, viaBackend}`): Pro lido por SSH
  numa máquina sem o nosso backend não carrega nada, para não haver 404 (`assertCrmProprio` explica "instale o
  backend"). O `install.sh` sobe por PM2 onde não há systemd (grokbot-1) e "reinstalar" vira `pm2 restart --update-env`.
- **grokbot-1:** backend do meu-bot instalado em `~/.local/share/meu-bot/backend` na porta 8081, sob PM2
  (`meu-bot-backend`, `pm2 save`); o do Hermes segue na 8080 com o WhatsApp. No app, o chat dessa máquina passa a usar
  `claudecode`/`agente` (os modelos `rene*` são do backend do Hermes); financeiro e licença pela API nossa.
- **Limpar histórico no Hermes (25 out):** `whatsappClearPlan` devolve o id da sessão viva do contato (`sessionIds`; sem
  "principal" compartilhada) e `whatsappClearSessions` encerra pelo `HERMES_END_SH`: `SessionDB.end_session(id,
  "session_reset")` com o Python do runtime do Hermes, exatamente o que o `/reset` do gateway faz; na próxima mensagem o
  gateway vê a rota encerrada e abre sessão nova (auto-cura dele). A lista mantém o contato (sessões encerradas contam
  para presença, não para ler); o fluxo da tela é o mesmo do OpenClaw: guardar no CRM (agora pelo nosso backend na
  8081) e depois limpar. "Pausar" segue fora: o `hermes pause` é parada geral, não por contato.
- **Grupos numa máquina sem OpenClaw (25 out):** a área "Grupos" aparecia na grokbot-1 (a skill whatsapp-grupos da
  época do Hermes ainda lista os grupos) e, sem `openclaw.json`, `gruposDaMaquina` julgava a política com uma
  configuração vazia e acusava "A configuração admite TODOS os grupos": alarme falso. Agora `todosAdmitidos` só é
  calculado com o `channels.whatsapp` em mãos, e o menu "…" de grupo no Hermes tem só "Copiar ID" e "Atualizar lista"
  (`waGroupMenuTemplate(agente, gateway)`).
- **Backup do Drive numa máquina com Hermes (25 out):** o pacote "trabalho" (sem cifra) levava o `.hermes` inteiro:
  na grokbot-1 são 2,5 GB (node_modules do backend do Hermes 1,2 GB, venv do Whisper 433 MB, caches) e o envio parava
  em "passou de 512 MB"; pior, `.hermes/.env` (tokens) e `.hermes/whatsapp/session` (sessão do WhatsApp) iam no pacote
  sem cifra, porque os padrões `.hermes/*/.env` não casam na raiz. Agora `CONJUNTOS_DADOS.trabalho.excluir` tira
  `node_modules`, `venv-whisper`, `cache`, `tmp`, `logs`, `sandboxes`, `audio_cache`, `bin`, `.env*`, `whatsapp/session*`
  e `whatsapp/backups`; `credenciais` (cifrado) ganha `.hermes/.env` e `.hermes/whatsapp/session`. Sem senha de backup
  definida em Conta Google, credenciais continuam não subindo: regra de sempre (credencial nunca vai sem cifra).
- **Grupos no Hermes: Limpar histórico e Excluir (25 out):** pedido do dono: "Limpar" e "Excluir" nos dois menus, grupo e
  conversa, nos dois gateways. No OpenClaw "Excluir da lista" passou a aparecer sempre (não só com o agente desligado).
  No Hermes: `HERMES_GROUPS_PY` lista as sessões de grupo (uma por grupo e por remetente, nome de quem falou no
  `origin_json.user_name`), `hermesGroupSessions`/`hermesGroupOfKey` (puros), `whatsappGroupThread` monta a conversa
  com `autor` por sessão, `whatsappGroupClearPlan` conta as sessões vivas e `whatsappGroupClear` encerra todas pelo
  `HERMES_END_SH`. `hostIsHermes` decide pelo gateway da última consulta ou por `~/.hermes/whatsapp` por SSH.
- **Ouvir áudios e voz no Hermes (25 out):** "Ativar transcrição" na grokbot-1 rodava o `install-transcricao.sh`, que é
  do OpenClaw, e parava em "esta máquina não tem OpenClaw". No Hermes a transcrição já existe (config.yaml: `stt.enabled`,
  provedor `mac-whisper` com faster-whisper local de reserva) e a voz é `voice.auto_tts`. `src/main/hermes-audio.ts`
  lê isso com o Python do runtime do Hermes; o handler `whatsapp:status` completa `audioIn`/`audioOut` quando o
  gateway é Hermes; `installAudio` recusa com a explicação; a tela mostra "✓ ativo: o Hermes transcreve" e a voz só
  como leitura, sem botões de instalar.

## Claude Code Global: a assinatura do root para todos os usuários (29 out)

- **O que é:** o login de assinatura do root (`/root/.claude/.credentials.json`) responde pelos usuários da máquina.
  A gestão é só do admin (aba "Claude Code Global", abaixo de Usuários). Cada usuário vê no meu-bot dele
  "Claude Code · global (e-mail)", sem botão de sair. A fila tem duas fontes: o global primeiro e as contas próprias
  do usuário (tutorial 2) como reserva. Sem nenhuma das duas, o Grok assume, como antes.
- **Intermediário do root** (`backend-colima/claude-global.js`, serviço `meu-bot-claude-global`, `127.0.0.1:18780`):
  - O `claude` do usuário fala com ele no modo assinatura: `CLAUDE_CODE_OAUTH_TOKEN=<chave do usuário>` e
    `ANTHROPIC_BASE_URL`. Ele confere a chave e troca a autorização pelo token de uma conta do root. O streaming e os
    `rate_limit_event` voltam intactos. Com `ANTHROPIC_AUTH_TOKEN` o CLI não manda os eventos de limite; com
    `CLAUDE_CODE_OAUTH_TOKEN` manda.
  - Só ele renova o token, contra `https://platform.claude.com/v1/oauth/token` com o client do Claude Code, gravando
    de volta no mesmo arquivo de forma atômica. O `refreshToken` gira a cada renovação: cópias do arquivo por usuário
    quebrariam as outras.
  - Rodízio do root: o mesmo `contas-claude.js`, na pasta do root. Uma conta do root no limite (429) passa para a
    próxima antes de responder ao usuário.
  - Só passam `/v1/messages` e `/v1/models`. A API OAuth aceita criar chave de API com o mesmo token; com isso
    bloqueado, um usuário não consegue tirar uma credencial da conta do root pelo intermediário.
- **Arquivos:**
  - `/opt/meu-bot-claude-global`: código, `755`, sem segredo.
  - `/etc/meu-bot/claude-global`: só o root (700/600). Guarda `config.json` (porta), `chaves/<usuario>` e `uso.json`.
  - No usuário: `~/.local/share/meu-bot/claude-global.json` (dono ele, 0600), com `{url, chave, email}`. A conta
    `global` do `contas-claude.js` existe enquanto esse arquivo existe. O token do root nunca chega ao usuário.
- **Onboarding:** com o global instalado, "Criar usuário" já liga o global para a conta nova
  (`prepararUsuario` → `ligarClaudeGlobalPara`). O tutorial 1 só confirma a sessão e, com o global, vem concluído.
- **Conferido no servidor (29 out):**
  - O box-2 respondeu pelo intermediário (`apiKeySource: none`, `rate_limit_event` chegando, `--resume` ok).
  - A chave dele não abriu `/api/oauth/claude_cli/create_api_key` nem `/api/oauth/usage` (403).
  - O box-2 não lê `/etc/meu-bot` nem `/root/.claude`.
  - A renovação feita pelo intermediário manteve o `claude` do root funcionando.
- **Uso compartilhado:** experimental. Antes de levar o global a clientes ou à produção, confirme que o acordo com a
  Anthropic cobre o uso; as contas próprias de cada usuário continuam como alternativa.

## Link Público Global: um link por usuário, atrás de um túnel da Cloudflare do root (30 out)

- **O que é:** cada usuário da máquina ganha `https://<nome>.<domínio>/` (hoje `agentesgrok.com`), servido pela pasta
  `~/publico` dele. A gestão é do admin (aba "Link Público Global", abaixo do Claude Code Global): instalar, entrar na
  Cloudflare, subir o túnel e ligar ou desligar o link por usuário. O agente de cada um dá links com o comando
  `publicar` (skill do Hermes `meu-bot-link-publico` e bloco no CLAUDE.md do workspace); o nome do link a pessoa troca
  no meu-bot dela (tutorial 14). Motivo: a Karen da box-2 respondeu "não tenho como gerar um link público" quando o
  Daniel pediu o arquivo do fluxo por link.
- **Por que túnel:** o domínio está na Cloudflare e as portas 80/443 da VM são filtradas. O `cloudflared` do root
  (serviço `cloudflared`, `/etc/cloudflared/config.yml`) leva `*.<domínio>` a um nginx só em `127.0.0.1:8099`; a máquina
  não abre porta e o TLS é da Cloudflare. O login do root (`cloudflared tunnel login`, cert em `/root/.cloudflared`) é
  uma vez; a aba abre o link no navegador do Mac e confirma sozinha quando o cert chega. O túnel `meu-bot-publico` é
  criado uma vez (no `tunnel list -o json` os vivos têm `deleted_at` "0001-01-01", não vazio) e a rota é um CNAME
  curinga, então nome novo de usuário não mexe em DNS.
- **Arquivos:**
  - `/etc/meu-bot-link-publico` (755, à parte do `/etc/meu-bot`, que é 700): `config.json` (domínio, porta), `SKILL.md`
    e `claude.md` (modelos que o ligar copia para o usuário) e `md2html.py` (markdown → página, com o `python3-markdown`
    do Debian que o instalar põe).
  - `/var/www/publico` (root, 1733, sticky): `<nome>/` é a pasta do usuário (dona ele, 755). Ninguém lista as outras; o
    nginx só atravessa. `disable_symlinks if_not_owner`: symlink dentro da pasta só para arquivo do mesmo dono.
  - No usuário: `~/publico` → `/var/www/publico/<nome>`; `~/.local/share/meu-bot/link-publico.json` (`{url, nome, dominio}`,
    o que a tela dele lê); `~/.hermes/skills/meu-bot-link-publico/SKILL.md`; bloco `meu-bot:link-publico v1` no
    `~/agent-workspace/CLAUDE.md`. Tudo isso gravado por ele (`runuser`), nunca pelo root.
  - `/usr/local/bin/publicar <arquivo|pasta> [nome]` (também `--lista`, `--remover`) e `/usr/local/bin/link-publico-nome
    <novo>`: como a pasta é dele numa pasta sticky, trocar o nome é um `mv` sem root. Nomes reservados (www, admin…)
    e nomes de outros usuários são recusados.
  - **Publicar pelo admin** (30 out): "Publicar arquivo…" na linha do usuário abre o diálogo do Mac (no main: o renderer
    nunca manda caminho), faz `scp` para `/tmp/meu-bot-publicar-<token>` (700 do root), `chown root:<usuário>` 750/640 só
    ali, e roda `runuser -u <usuário> -- /usr/local/bin/publicar` (caminho absoluto: o runuser sem `-l` reseta o PATH).
    O arquivo nasce dono do usuário, na cota dele, e a passagem some deu certo ou não (`lpPublicarSh`). Limite de 100 MB
    (o que a Cloudflare entrega por resposta). "Tirar do ar" é sempre `publicar --remover` como ele (`lpRemoverSh`),
    nunca `rm` do root. Canais `admin:link-publico-publicar` / `-remover`; auditoria `usuarios.link-publico-publicar` / `-remover`.
  - **No ar e Agente** (30 out): o `ESTADO=` traz por usuário até 50 itens do primeiro nível (`os.lstat`, sem dotfile, só
    nomes `[A-Za-z0-9][A-Za-z0-9._-]*`; `pagina` = pasta com index.html) e o estado do agente dele (`skill` e `claudeMd`:
    ok / antiga / faltando / sem-hermes ou sem-workspace), comparando com os modelos de `/etc/meu-bot-link-publico`, só
    leitura (`O_NOFOLLOW`, teto 256 KB). A tabela ganhou as colunas Agente e "No ar" (abre a lista com Abrir e "Tirar do
    ar" em dois cliques). Itens com nome fora do padrão contam mas não aparecem (só pelo terminal).
  - **Atualizar alcança os agentes** (30 out): "Atualizar a instalação" roda `lpAtualizarAgentesSh` depois de regravar os
    modelos: para cada usuário com `~/publico` apontando para a pasta dele, refaz skill, bloco do CLAUDE.md e json como
    ele (`LP_AGENTE_SH`, o mesmo corpo do ligar). Antes, quem já estava ligado ficava com a skill velha.
  - **Ligar avisa o que pulou** (30 out): `LINK=ok <nome> [sem-hermes] [sem-workspace]`: a conta sem `~/.hermes` não
    recebe a skill e sem `~/agent-workspace` não recebe o bloco; a aba e o onboarding mostram "ligado, mas … prepare a
    conta na aba Usuários e ligue de novo" em vez de um ok que não gravou nada.
  - **`publicar` endurecido** (30 out): `--remover ..`/`.x`/vazio é recusado e item inexistente dá "não está no ar"; `cp`
    falhando (cota cheia) vira `ERRO: não consegui copiar…` em vez de imprimir uma URL que não existe.
  - **A pessoa também publica pela tela** (tutorial 14, `guia/agente.md`): `link-publico:lista|remover|publicar`, scp para
    `~/.local/share/meu-bot/publicar-tmp/<id>/` (restos de mais de 2 h são varridos a cada uso) e o `publicar` dela.
  - **`.md` vira página** (30 out): `publicar fluxo-atendimento.md` grava `fluxo-atendimento/index.html` (título do 1º
    `#`, CSS claro/escuro, tabelas e código) e o `.md` original ao lado, e imprime `https://<nome>.<domínio>/fluxo-atendimento/`.
    Motivo: o primeiro link do Daniel era o `.md` cru, que o nginx mandava como `application/octet-stream` (com nosniff,
    o navegador baixava em vez de mostrar). O nginx agora também serve `.md` como `text/markdown; charset=utf-8`.
- **Desligar** guarda a pasta em `/var/www/publico/.desligado-<usuário>` (o nginx não serve nome com ponto) e ligar de
  novo a devolve, com o nome que a pessoa tinha escolhido.
- **Onboarding:** com o global instalado, "Criar usuário" já liga o link da conta nova (`prepararUsuario` →
  `ligarLinkPublicoPara`). Desde 30 out o mesmo fluxo instala a status line do Claude (`installStatusLine`, como a
  pessoa, idempotente; o tutorial 16 saiu da lista), também no "Preparar" de uma conta que já tinha backend.
- **Domínio próprio:** fora do alcance deste túnel (um hostname só passa por um túnel da mesma conta Cloudflare). Quem
  quer domínio próprio usa a conta Cloudflare dela (tutorial 12) e pede ao agente para subir a pasta no Pages.
- **Conferido no servidor (30 out):** `https://box-2.agentesgrok.com/teste.html` respondeu 200 pela internet; raiz
  vazia 403; host desconhecido 404; `hermes skills list` da box-2 lista `meu-bot-link-publico` como local/enabled.
  Código: `admin/link-publico-core.ts` (scripts), `admin/link-publico-admin.ts`, `renderer/admin/link-publico-page.ts`,
  `agente/link-publico.ts` (lado da pessoa).

## Capacidade e governança de RAM/CPU (30 out)

- **Linha de base medida na `meu` (8 vCPU, 32 GB, 8 GB de swap com swappiness 10, 2 boxes):** cada box tem ~0,3-0,4 GB
  de memória própria (`anon`: Hermes 240-340 MB, que cresce com as sessões; ponte do WhatsApp 120 MB; backend 70 MB) e
  ~1,3 GB de `memory.current`, 70% disso cache descartável. O transcritor de áudio (`/opt/transcriber`) roda **dentro
  da box** de quem mandou o áudio e chega a 607 MB de pico por áudio: o pior caso de uma box é ~1,15 GB próprios. O
  `user.slice` tinha 21,6 GB, 18,7 GB deles cache das sessões do root. As duas boxes já registravam `events high`
  (393/78, recolhimento de cache no MemoryHigh, não é pressão) e `cpu.stat nr_throttled` (o transcritor usa 4 threads
  numa cota de 2 núcleos: ~3% do tempo segurado; follow-up: ler `cpu.max` do próprio cgroup e usar
  `cpu_threads = min(4, cota)`; `nice` não ajuda com cota).
- **Valores:** `user.slice` MemoryMax = total − max(3 GB, 10%) (28,8 GB aqui), MemoryLow pela metade, CPUWeight 100;
  cada `user-<uid>.slice` mantém MemoryHigh/Max (90% do teto) e CPUQuota (200%) e ganha MemorySwapMax 256M, MemoryLow
  640M e CPUWeight 100. Teto padrão por box: **1,25 GB** (decisão de produto de 30 out: 22 boxes em 32 GB; com 1,5 GB
  seriam 19 e com 2 GB, 14). A ressalva: o aperto (MemoryHigh 1152 MB) começa na hora do áudio, porque o transcritor
  roda dentro da box; a coluna Pressão mostra e a medição com 10 boxes decide se muda. As duas boxes de antes
  receberam o teto novo à mão em 30 out. O teto é `RECURSOS_PADRAO` (uma constante) e a capacidade acompanha.
- **Como ler:** aba Usuários do admin, linha "boxes: N de M", coluna Pressão (folgada/apertada/estrangulada; título com
  PSI, teto batido, mortes e CPU segurada) e RAM = memória própria. Comandos de conferência:
  `systemctl show user.slice -p MemoryMax -p MemoryLow -p CPUWeight`; `systemctl show user-1001.slice -p MemorySwapMax
  -p MemoryLow -p CPUWeight`; `cat /sys/fs/cgroup/user.slice/user-1001.slice/{memory.current,memory.events,memory.pressure,
  cpu.pressure,cpu.stat}`; `awk '$1=="anon"' .../memory.stat`.
- **Pressão controlada (dentro da fatia; `runuser` do SSH do root cai no `user-0.slice`):**
  `systemd-run --machine=box-2@ --user --collect -u teste-pressao python3 -c 'import time; x=b"\x01"*(1400*1024*1024); time.sleep(600)'`
  → "apertada" e, em 90 s, o aviso `box` no WhatsApp dela; 1900 MB → OOM → "estrangulada"; 4 × `yes` por 2 min → PSI de
  CPU > 50% → "estrangulada" (texto de processador). Limpar: `systemctl --machine=box-2@ --user stop teste-pressao`.
  `max`/`oom_kill` só zeram recriando a fatia (parar `user@1001.service`) ou no reboot; `saude-avisos.json` guarda o
  intervalo de 6 h (apague a chave `box` para repetir).
- **Regra de crescimento:** mais máquinas, não uma maior (o admin já é multi-máquina); vertical só como ponte. Próxima
  medição com 10 boxes (RAM por box com o tempo, swap, CPU de áudio, cota) decide se o teto padrão baixa.

## Padrão de uma máquina nova (30 out)

O que o checklist **Preparar máquina** do meu-bot-admin garante numa máquina em que o admin entra como root (a
ordem é a de dependência; tudo idempotente; nada reinicia o que está no ar). É também o que o implantador roda
numa infraestrutura prioritária nova antes de migrar uma pessoa para lá.

| Item | Onde fica | Conferir |
|---|---|---|
| Swap 8 GB | `/swapfile`, `/etc/fstab`, `/etc/sysctl.d/90-meu-bot-swap.conf` (swappiness 10) | `swapon --show` |
| Cota por usuário | `usrquota` no `/` em `/etc/fstab`, `quotaon` | `quotaon -pu /` |
| Governança | `user.slice` (`MemoryMax` = total − max(3 GB, 10%), `MemoryLow` metade, `CPUWeight=100`); por box `MemorySwapMax=256M MemoryLow=640M CPUWeight=100` | `systemctl show user.slice -p MemoryMax -p MemoryLow -p CPUWeight`; `systemctl show user-<uid>.slice -p MemorySwapMax` |
| Pacotes | `jq`, `ffmpeg`, `xvfb x11-utils openbox x11vnc novnc python3-websockify xdotool scrot`; opcional `chromium` | `dpkg-query -W jq ffmpeg xvfb novnc chromium` |
| gh | `/usr/local/bin/gh` (root 755) | `/usr/local/bin/gh --version` |
| Hermes | `/opt/hermes` + `/usr/local/bin/hermes` | `hermes --version` como qualquer usuário |
| Transcritor | `/opt/transcriber` (venv, modelo, `bin/transcrever`) | `grep meu-bot-transcritor /opt/transcriber/bin/transcrever` |
| Claude Code Global | `/opt/meu-bot-claude-global`, `/etc/meu-bot/claude-global`, unit `meu-bot-claude-global`; login do root em `/root/.claude` (humano) | `systemctl is-active meu-bot-claude-global` |
| Link Público | nginx + cloudflared, `/etc/meu-bot-link-publico/config.json`, `/var/www/publico` (1733), `/root/.cloudflared/cert.pem` (humano), túnel em `/etc/cloudflared/config.yml` | `systemctl is-active nginx cloudflared` |

O script de estado (`PREPARAR_ESTADO_SH`) lê exatamente isso e imprime `KEY=value`; `lerPreparar` decide ok / falta /
humano. "Criar usuário" aplica o que falta antes de criar. Ver `docs/guia/suporte-admin.md › Preparar máquina`.

**Aviso sobre a janela root:** o chat do root (meu-bot comum aberto no host root) é bancada de teste do dono, só em
staging; o agente ali roda como root e hoje tem login do GitHub, da Cloudflare e a tela do bot. Em produção, cada
pessoa conversa pela box dela; o root fica para as abas de admin.

## Backend no ar sem os arquivos no disco (1 nov 2026)

- No root da VM a pasta `/root/.hermes` sumiu inteira (com o backend herdado, `.env`, `providers.json`, sessões e a
  credencial xAI do Hermes) e o `meu-bot-backend` continuou "active" rodando de memória. A sondagem lia `server=0` com a
  porta ocupada e o seletor oferecia instalar na porta seguinte: dois backends na mesma conta.
- Agora a sondagem traz `unitpid`/`unitport` (PID principal da unidade desta conta e a porta dele): `backendSumiu` →
  o seletor explica e "Reinstalar backend" vai para a mesma porta (`portaParaInstalar`, `porta-backend-core.ts`); o
  `install.sh` (1.9.3) para o serviço próprio antes de reclamar de porta ocupada (`liberar_porta_propria`). Sessões e
  `providers.json` não voltam: o Grok precisa de "preparar" e login de novo.
