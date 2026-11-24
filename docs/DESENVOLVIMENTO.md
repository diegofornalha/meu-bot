# meu-bot: desenvolvimento

Bot de mesa pessoal para macOS: uma janela de chat que conversa com o backend do Hermes na
sua VM. O backend (`claude-chat-backend`, porta 8080 na VM) roda o Claude Code por baixo,
com a assinatura já logada lá. Não há chave de API no app.

Inspirado na arquitetura do Grok Bot (cliente fino + "computador do bot"), mas com código
próprio e a VM sob seu controle.

> Para ligar outra máquina (outro computador do Grok Bot, VM ou o Colima): `docs/PLAYBOOK-nova-maquina.md`.
> Detalhes de implementação e pegadinhas: `docs/GUIA.md` (índice) e `docs/guia/<assunto>.md`. Mapa do código: `docs/ARQUITETURA.md`.

Três produtos saem deste código (tabela em `src/main/variant-core.ts`): **meu-bot** (a pessoa), **meu-bot-admin**
(suporte). O CRM próprio dentro do Gmail vem no meu-bot e abre pela licença da máquina (Pro ou superior); a
extensão do Gmail e o Autenticador moram em `extensao-crm/` e o CRM em `backend-colima/crm-*.js`. O antigo
meu-bot-crm saiu: o meu-bot funde a pasta dele na primeira abertura. `npm run dist`, `dist:admin`; `./instalar.sh [--admin]`.

## Requisitos

- macOS, Node.js 24+ e npm.
- Uma janela por máquina, como o Cursor com SSH: o app abre no seletor de máquinas (`local` = este
  Mac sem SSH, `colima`, `agente-box`, `grokbot-1`…), cada janela mostra só as conversas da sua
  máquina e Cmd+Shift+N abre outra. Fechar a última janela deixa o app no Dock. Configurações mostram o estado de cada host
  e instalam o backend (`backend-colima/`) com um clique.
- Acesso SSH sem senha à VM, com um alias no `~/.ssh/config` (padrão: `colima`, a VM local do Colima; `grokbot-1` para a VM remota).
  Num Mac novo, o botão ⇅ "sincronizar ssh" do seletor preenche o `~/.ssh/config` a partir de `config/ssh-hosts.conf`;
  o Cursor lê o mesmo arquivo.
- Na VM, o backend `~/.hermes/agente-rene/backend-sdk-claude` rodando na porta 8080 e com
  `OPENAI_COMPAT_KEY` no `.env`. O app lê essa chave pela própria conexão SSH, em memória.

## Rodar em desenvolvimento

```bash
npm install
npm run dev
```

Na primeira mensagem o app busca a chave na VM e abre um túnel SSH para a porta do backend.
O selo no topo mostra o estado: "buscando chave…", "abrindo túnel…", "túnel ativo · modelo".

## Funcionalidades (v2)

- **Markdown** nas respostas, com blocos de código realçados e botão Copiar; links abrem no navegador.
- **Modelo por conversa** no seletor ao lado da caixa de texto: os perfis do Claude (`claudecode`, `agente`, `rene-dm`,
  `rene`) e os provedores que a máquina informa (o modo grátis, o motor de um módulo). O backend tem uma corrente de
  fallback (`providers.json`; no produto base, só o `agente`) e avisa na conversa quando troca: `docs/guia/agente.md`.
  A status line no rodapé mostra modelo, contexto,
  conta e limites de 5 h e 7 dias do Claude, com aviso ao passar de 80, 90 e 95%. Se a máquina não tem o
  `statusline.sh` que grava esses limites, o seletor avisa "sem status line do Claude" e oferece **Instalar status
  line** (o `claude-statusline`, com o cache que o app lê); a máquina abre normalmente enquanto isso.
- **WhatsApp do Hermes**: estado no topo da lista de conversas e pareamento por QR dentro do app (bridge oficial do Hermes por SSH).
- **Tailscale SSH sem pedir aprovação**: o seletor detecta o "check" do Tailscale, abre o link, e pode desligar
  de vez editando a política do tailnet pela API (OAuth client no Keychain, backup antes, desfazer pela paleta).
- **Lista lateral** (☰ ou Cmd+B) com todas as conversas agrupadas por data, busca sem acento, arquivar.
- **Exportar** (.md/.json) e **ramificar** a partir de qualquer mensagem (ícones no hover da mensagem: copiar e ramificar, com tooltip).
- **Menu de contexto** nas abas (botão direito) e **notificações** quando a resposta termina em segundo plano.
- **Paleta de comandos** (⌘K): conversas, ações e configurações.
- **Fonte e tema** nas Configurações.
- **Resumo contínuo**: acima do orçamento de contexto, o meio da conversa vira um resumo gerado pelo
  `claudecode` em background; **memória** local (perfil e notas) injetada em toda mensagem e
  preenchida automaticamente a cada N turnos.
- **Túnel SSH com ControlMaster** (uma autenticação, clientes leves), revalidação ao acordar o Mac,
  botão **Parar** para cancelar uma resposta.
- **Streaming real** e **retomada de sessão** no backend da VM (opt-in por cabeçalho; código em
  `backend-vm/`). O texto chega token a token e o Claude Code lembra da conversa sem reler tudo.
- **Entrada rápida**: Cmd+Shift+Espaço de qualquer app abre uma janelinha; Enter manda pra conversa ativa.

## Abas

"Novo" (Cmd+N) abre uma aba nova e mantém as anteriores vivas, cada uma com o próprio
histórico. Feche com o × ou Cmd+W. Uma aba em segundo plano mostra um ponto azul quando chega resposta.
As conversas ficam salvas em `conversations.json` no userData e voltam quando o app reabre;
fechar uma aba apaga aquela conversa. Dois cliques no título da aba renomeiam; o nome fica salvo. Arraste as abas pra reordenar; a ordem também fica salva.

## Configurações

- **Host SSH da VM**: lista com os hosts do seu `~/.ssh/config`; também aceita digitar.
- **Máquina**: escolhida no seletor que abre com o app (`local` = este Mac sem SSH, mais os hosts do
  `~/.ssh/config`). Cada máquina é uma janela; Cmd+Shift+N abre outra. O seletor sonda todas em
  paralelo, mostra o estado e instala o backend onde falta.
- **Modelo padrão nesta máquina**: `agente` (bypass: ferramentas com `--dangerously-skip-permissions`
  em `~/agent-workspace`, pode levar minutos), `claudecode` (chat puro, rápido), `rene-dm` ou `rene`,
  estes dois só na `grokbot-1`. Modelos que a máquina não tem ficam desabilitados.
- **Porta do backend na VM**: padrão 8080.

Configuração em `~/Library/Application Support/meu-bot/settings.json`. Transcripts em
`~/Library/Application Support/meu-bot/transcripts/`.

## Gerar o app

```bash
npm run dist
```

Produz `out/meu-bot-darwin-arm64/meu-bot.app` com os fuses do Electron travados
(RunAsNode e inspeção por linha de comando desligados, integridade do ASAR ligada)
e assinatura ad-hoc para uso local.

### Canais: estável e staging

Como o VS Code e o VS Code Insiders: o `meu-bot-staging` fica ao lado do estável, com
ícone de faixa laranja, dados e porta próprios, e recebem o que está em teste. A release estável só sai de um commit
já publicado como staging.

```bash
./instalar.sh --staging            # meu-bot-staging
npm run chave-release              # uma vez: chave Ed25519 das releases (~/.config/meu-bot, fora do repo)
npm run release:staging            # pre-release v<versão>-staging.N
npm run release                    # promoção para v<versão> (exige a tag staging no commit)
```

Sequência completa (subir a versão dos componentes da máquina, staging, aprovação, estável, versão base) na skill
`.claude/skills/publicar` e em `docs/guia/app.md` › "Revisão no molde do Brave/Sparkle" e "Atualização no molde do Grok
Bot". Cada zip sai com um `.sig`: o app só instala o que a chave da release assinou, não reassina, e volta sozinho
para a versão anterior se a nova não abrir. O app baixa em segundo plano com retomada e progresso, guarda a versão
preparada entre aberturas, só troca a versão que o botão mostrou, troca sozinho com o Mac ocioso (ou ao fechar) e
bloqueia a janela quando o backend da máquina exige uma versão mais nova. O backend e os plugins da máquina se
atualizam na abertura do app, só para cima (o release recusa um componente que mudou sem subir a versão).

Limitações: o backend da máquina remota é um só para os dois canais (o que se instala testando no staging vale
também para o estável; como só sobe de versão, o estável nunca rebaixa o que o staging instalou).

## Como funciona

- `src/main/tunnel.ts`: lê a chave do backend na VM via `ssh`, abre `ssh -N -L` para a porta
  do backend numa porta local livre, com retentativas porque a VM oscila no Tailscale.
- `src/main/backend.ts`: envia o histórico recente (últimas 12 mensagens) para
  `/v1/chat/completions` pelo túnel, sem stream, com timeout de 2 min (chat) ou 10 min (agente).
  O backend achata o histórico num prompt e abre uma sessão nova do Claude Code a cada turno,
  por isso o histórico é limitado.
- `src/preload/preload.ts`: a única ponte entre a interface e o processo principal.
- `src/renderer/`: interface em HTML/CSS/TS puro, com CSP estrita.
