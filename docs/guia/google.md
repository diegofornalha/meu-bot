# Conta Google, Drive e backups

> Parte do diário técnico do meu-bot, dividido por assunto em 27 out 2026. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

## Backup completo e mudança de máquina (20 out)

O admin faz o backup de tudo o que é da pessoa numa VM e restaura numa outra.
- **Permissão:** só com a pessoa ligando "Permitir backup completo pelo admin" em Configurações › Suporte
  (`SupportShare.backup`, padrão desligado).
- **Na VM** (`backend-colima/meu-bot-backup.sh`, vai pela linha de comando do SSH em base64):
  - **criar:** para o gateway e o backend por ~1 min, empacota `.openclaw`, `.local/share/meu-bot`, `.hermes`,
    `.claude`, `.local/bin` e o crontab. Ficam fora os modelos de transcrição e voz, os caches, `npm`, `tmp` e
    `stage`. Grava um manifesto com o sha256 de cada arquivo e religa o que estava ligado.
  - **restaurar:** confere os sha256, guarda o que havia em `~/.meu-bot-antes-da-restauracao-<ts>/`, troca o `$HOME`
    antigo pelo novo nos arquivos conhecidos e deixa o gateway DESATIVADO.
  - **ativar-whatsapp** e **desativar-whatsapp:** fazem a troca. Nunca há `channels logout`, porque ele mataria a
    sessão nas duas máquinas.
- **No Mac** (`src/main/admin/backup-admin.ts`, regras em `backup-core.ts`):
  - o stdout do ssh passa pela cifra **age** para o destinatário de backup e vai direto para
    `userData/backups/*.mbbak`. Na volta, o arquivo é decifrado em stream direto no stdin do ssh. Não há texto claro
    em disco;
  - o par é criado pelo `suporte-setup.mjs`: a identidade fica em `~/.ssh/meu-bot-backup.age`, só no Mac do super
    admin (**guarde uma cópia offline**: sem ela os backups não abrem). A pública vai no app de todos os admins
    (`backupDestinatario`);
  - qualquer admin gera um backup; só o super admin restaura.
- **Mudança:**
  1. a pessoa instala o meu-bot na VM nova e liga o suporte;
  2. no admin, a página Suporte da máquina nova mostra "Restaurar um backup aqui", com o pré-voo (espaço, OpenClaw,
     WhatsApp já pareado, usuário);
  3. o app restaura e reinstala Claude Code, backend, guarda, CRM, transcrição e status line;
  4. "Trocar o WhatsApp para esta máquina" desliga o gateway na antiga, se ela ainda estiver no suporte, e liga na nova.
- **Auditoria:** registra `backup.criar`, `backup.restaurar` (com a máquina e o último hash da origem),
  `backup.desativar-origem` e `backup.ativar-whatsapp`.
- **Fora do pacote:** o hermes-agent instalado por npm em `~/.local/lib` e a voz das respostas (religar no tutorial).

## Cópia dos dados da VM no Drive do dono (23 out)

Para ninguém ficar preso a uma VM: uma vez por dia o app manda os dados de cada máquina para o Google Drive **do
dono**. Nada de bucket do fornecedor; cada cliente guarda no Drive dele.

**Cinco conjuntos, cada um em pasta e nome próprios** (`meu-bot / <máquina> / <pasta> / <prefixo>-<máquina>-AAAA-MM-DD.tar.gz`),
para serem restaurados de forma independente. Tamanhos medidos na `agente-box-lv`:

| Conjunto | O que entra | Tamanho |
|---|---|---|
| CRM 🔒 | `crm/db` com anexos | 36 KB |
| Financeiro | `finance/db` com comprovantes | 3 KB |
| Agente 🔒 | `.claude/projects` e `.claude/skills` | 37 MB |
| Trabalho | painel Kommo, catálogo de sites, workspaces, `.hermes`, estado do meu-bot | 195 KB |
| Credenciais 🔒 | `.openclaw`, tokens de Kommo/Cloudflare/GitHub, `authorized_keys`, units systemd | 8 MB |

Os pacotes são feitos com `tar -C $HOME` e caminhos relativos, então **restaurar é extrair sobre o `$HOME`**.

- **Três conjuntos saem cifrados (🔒)**, com `age` e uma senha que o dono define na aba Conta Google (guardada no
  Keychain): Credenciais, e desde 24/10 também **CRM e Agente**, porque o pente fino achou 9 JWTs nos transcripts e
  1 nas conversas arquivadas (token colado no WhatsApp). **Sem senha definida eles são pulados**, com aviso na tela:
  segredo nunca sobe em texto claro, nem "só desta vez". O arquivo termina em `.tar.gz.age` e abre com
  `scripts/abrir-backup.mjs` ou `age -d` e a mesma senha. Perder a senha torna o pacote inabrível; o CRM e o
  Agente continuam com as 7 cópias locais na VM, e as credenciais são reemissíveis.
- **Os dois que sobem sem cifra (Financeiro e Trabalho) passam por varredura antes**, decisão do dono em 24/10:
  `achaSegredo` em `google-core.ts` procura JWT, token do GitHub, chave `sk-` e chave da AWS no pacote
  descomprimido. Achou, o conjunto não sobe e a tela diz o tipo. "Verificado limpo hoje" vira "verificado limpo a
  cada envio".
- **Os segredos do `.hermes`** (`auth.json` e os `.env`) são excluídos do conjunto Trabalho e entram no cifrado:
  o pacote sem cifra nunca carrega credencial.
- **Fica de fora porque se refaz sozinho:** modelos de voz e transcrição (1,6 GB), o clone `skills-cloudflare`
  (um `git clone` traz de volta), `.openclaw/{cache,tmp,extensions,logs}` (183 dos 208 MB), `.npm`, `.cache` e os
  plugins do Claude. E os `db/backup/` de cada store, que são cópia dentro de cópia.
- **Os `autenticador.*` do CRM** também saem: os segredos TOTP são cifrados por uma chave que mora **fora** do
  `db/` justamente para o backup não levá-la, então fora da máquina não abrem.
- Os padrões de exclusão são relativos ao `$HOME` e **sem `./`** na frente; com `./` eles não casam e o que
  deveria sair entra no pacote em silêncio. Há teste travando isso.
- **Quem envia:** o Mac, com a Conta Google do dono e escopo `drive.file` (o app só enxerga o que ele mesmo criou).
  **A VM não ganha credencial nenhuma.** Roda 2 min depois de a extensão do CRM subir e a cada 24 h.
- **Uma cópia por conjunto:** ao subir a nova, as anteriores daquela pasta são apagadas. A ordem é sempre subir
  primeiro e apagar depois. Só são apagados arquivos do padrão daquele conjunto **e daquela máquina**.
- **Cópia local também:** antes de subir, o pacote é gravado em `~/Documents/meu-bot/backup/<máquina>/`. Se o Drive
  falhar, ainda sobra um pacote fora da VM. O botão **Abrir a pasta no Mac** abre isso no Finder.
- **Desligar:** `dadosNoDrive: false` no `settings.json`, ou o botão na tela.
- **Auditoria:** registra `backup.dados-drive` com os conjuntos que subiram.

**Restaurar numa VM nova:** `tar -xzf <pacote>.tar.gz -C ~` para os quatro sem cifra. Em seguida
`POST /v1/crm/reindex`.

**Abrir o pacote cifrado:** o `age` de linha de comando não vem instalado, e um backup que não se abre não é
backup. Use o script do repositório, que usa a mesma biblioteca do app e só precisa do Node:

```sh
node scripts/abrir-backup.mjs ~/Downloads/credenciais-<máquina>-AAAA-MM-DD.tar.gz.age
```

Ele pede a senha no terminal **sem eco** (senha em argumento ficaria no histórico do shell e no `ps`), escreve o
`.tar.gz` ao lado com permissão 600 e mostra os comandos para conferir e restaurar. Senha errada dá erro claro, não
lixo. `--saida <pasta>` escolhe onde gravar. O arquivo decifrado tem credenciais em texto claro: apague depois.

Não confundir com o **backup completo e mudança de máquina** (acima): aquele é manual, cobre a máquina inteira e
depende da chave `~/.ssh/meu-bot-backup.age`. Este é automático, por conjunto, e a cifra é por senha do dono.
**Religar o WhatsApp numa VM nova continua sendo o fluxo `ativar-whatsapp`/`desativar-whatsapp`** do
`meu-bot-backup.sh`, que nunca faz `channels logout`: restaurar o arquivo não substitui esse passo.

## Backup: tar 1 ("file changed as we read it") não é erro (25 out)

Na `grokbot-1` o conjunto "trabalho" passou a falhar com `tar: .hermes: file changed as we read it`: o Hermes grava
sessões o tempo todo e o GNU tar sai com 1 quando um arquivo mudou durante a leitura, com o pacote inteiro mesmo assim.
`comandoPacoteSh` (google-core.ts, puro, testado com um `tar` falso) é agora o dono do comando remoto: lista só o que
existe, sai com 3 sem nada, trata 1 como aviso (stderr + linha no log) e sucesso, e mantém 2 (fatal) como erro.
Medido depois: 218 MB para "trabalho" na grokbot-1, abaixo dos 512 MB.

## Conversas no Google Drive ao limpar (21 out)

No meu-bot-crm, "Limpar histórico" guarda a conversa no CRM da máquina e também no Google Drive da conta ligada
neste Mac (`guardarNoDrive`, em `google.ts`). O caminho é `meu-bot / <alias SSH da máquina> / WhatsApp /
<contato (+número)> / conversa-whatsapp-AAAA-MM-DD-HHMM.md`: cada máquina tem a própria pasta, então projetos não
se misturam. O alias SSH é estável; o apelido da tela pode mudar.

- **Permissão:** só `drive.file`, em que o app enxerga apenas o que ele mesmo cria. Contas conectadas antes pedem
  "Reconectar o Google (Contatos e Drive)" na aba Pessoas da extensão (`precisaReconectar`).
- **Regras:** se falhar o CRM ou o Drive, nada é limpo. Tentar de novo não duplica no CRM (o `sha256` é o mesmo).
  Com o Google nunca conectado neste Mac, o Drive é pulado e a nota avisa "só no CRM".
- **Leitura da conversa:** sessão que o gateway não devolve a tempo é erro, nunca conversa vazia, para não limpar
  sem guardar.
- **Requisito:** a Drive API precisa estar ativada no projeto do Google Cloud do client OAuth do app.

## Conta Google por máquina (26 out)

Como o WhatsApp, cada máquina (VM) tem a sua Conta Google: o refresh token fica cifrado no Keychain em
`userData/google-conta/<máquina>.bin`, e Gmail, Agenda, Planilhas, a importação do financeiro e o backup no Drive usam
a conta da máquina da janela (`acessoValido(host)`, `contaStatus(host)`). Motivo: com um token por app, a VM da LV
mostrava a conta do dono e desconectar numa máquina desconectava todas (agente-box caiu junto).
- Desconectar apaga só o token daquela máquina; a revogação no Google (que derruba a autorização da CONTA inteira) só
  acontece quando nenhuma outra máquina, nem o token antigo do Mac, usa a mesma conta (`contaEmUsoEmOutra`, por `sub`).
- O token antigo, único do Mac (`userData/google-conta.bin`), não vale sozinho em nenhuma máquina: a tela mostra
  "Usar <e-mail> nesta máquina" (`google-conta:adotar-do-mac`), cópia explícita para a máquina da janela.
- O login abre no Navegador da própria máquina (partição `persist:navegador-<host>`), então os cookies também são dela.
- Fica de fora: o token de Contatos do CRM (`google-contatos.bin`, usado em "guardar conversa no Drive") ainda é um
  por app.

## O client OAuth do Google viaja na release e o app busca sozinho (30 out)

- **Problema:** `config/google-oauth.json` (CRM, Contatos) e `config/google-conta-oauth.json` (Conta Google geral:
  login, Gmail, Agenda, Planilhas, Drive) ficam fora do git, e `scripts/package.mjs` só os copia para o pacote se
  existirem no Mac que empacota. Um Mac sem os arquivos gera apps em que a página Conta Google diz "Google não
  configurado neste app" e a única saída era reinstalar outra versão. Em 30 out a release 0.3.0 publicada também
  não os trazia: nenhum build tinha o Google ligado.
- **Agora:**
  - `scripts/release.mjs` publica os dois JSONs que existirem em `config/` como assets avulsos da release, cada um
    com o `.sig` (Ed25519, a mesma chave dos zips, conferida com `UPDATE_PUBLIC_KEYS` antes do upload). Sem os
    arquivos no Mac da release, avisa e segue (`clientesGoogleParaPublicar` em `release-core.mjs`).
  - No app, `src/main/google/cliente-release.ts` (`garantirClientesGoogle`): quando `contaStatus` diz "não
    configurado", o handler de `google-conta:status` consulta a release estável, baixa `<nome>` e `<nome>.sig`
    (até 64 KB), confere a assinatura com `verificaAssinatura`, valida com `parseClienteOAuth` e grava em
    `userData/google-cliente-baixado/<nome>` (0600). Sem o arquivo na release, repete só depois de 6 h ou quando a
    pessoa clica "Buscar de novo agora" (`googleContaStatus(true)`). Nunca lança: sem internet vira o texto da tela.
  - Ordem de origem do client (`comum.ts`): arquivo manual em userData → pacote do app → **baixado da release**. O
    baixado fica por último de propósito: um build que passe a trazer o arquivo vence o baixado, e o problema do
    "arquivo velho em userData que vence para sempre" (comentário de `clienteContaOrigem`) não se repete. A tela
    mostra "client vindo da release".
  - Texto da página quando ainda falta: diz o nome certo do arquivo (`google-conta-oauth.json`), que o app vai
    buscar sozinho quando a release trouxer, e a última tentativa ("a release v0.3.0 não traz …", "sem internet").
- **Criar o client (uma vez, pelo dono):** receita em `crm.md › Configuração única` (projeto no Google Cloud, tela
  de consentimento, credencial "App para computador", baixar o JSON). Para a Conta Google geral, um projeto
  separado, salvo como `config/google-conta-oauth.json`. Depois, uma release: todos os apps instalados se resolvem
  ao abrir a página.
- Testes: `scripts/tests/cliente-release-core.test.mjs` (asset + .sig, só https, tamanho, draft; assinatura
  roundtrip; rebusca; motivo; lista da release igual à do app).


## Empacotamento barulhento sem o client OAuth (30 out, issue #36)

- **Problema:** `scripts/package.mjs` copiava `config/google-conta-oauth.json` para o pacote só se existisse e seguia em
  silêncio quando não: quem empacota num Mac sem o arquivo gera um app sem Google e só descobre abrindo a página. A
  busca pela release (seção acima) também não salva, porque uma release feita nesse Mac sai sem o asset.
- **Agora** (`scripts/google-client.mjs`, puro; quem imprime e sai é o `package.mjs`): app cliente (não admin) sem o
  arquivo imprime um aviso destacado; com `--versao` (release, como faz o `release.mjs`) o build **falha**.
  `--sem-google` permite de propósito (`npm run dist:staging -- --sem-google`; o `dist.mjs` e o `release.mjs` repassam).
- Testes: `scripts/tests/google-client.test.mjs` (ok com o arquivo ou no admin; aviso no build local; falha no release;
  `--sem-google` permite; o aviso cita o app e o arquivo).
## Token preso ao client e tela de consentimento em Teste (31 out)

- **O que aconteceu:** a conta foi conectada no meu-bot num build sem `google-conta-oauth.json`, e `clienteConta()`
  (comum.ts) caiu no client do CRM. Um minuto depois entrou o app rebuildado, com o client de outro projeto. Um refresh
  token só vale para o client que o emitiu: o Google passou a responder `unauthorized_client` (descrição só
  "Unauthorized") a toda renovação, "Guardar agora" mostrava "Unauthorized" e a tela seguia "conectada", porque
  `acessoValido` só apagava o token em `invalid_grant`/revoked/expired.
- **Agora:** `refreshRecusadoDeVez` (google-core.ts, puro) decide quando o refresh foi recusado de vez: revogado,
  vencido ou de outro client (`unauthorized`). `acessoValido` (conta-google.ts) apaga o token e lança
  `GOOGLE_CONTA_DESCONECTADA`, que a página já traduz em "a conta Google desconectou; entre de novo" e volta a mostrar
  Conectar. Erro de rede ou 5xx não apaga: a conta continua válida, foi a tentativa que falhou. Teste em
  `scripts/tests/google-core.test.mjs`.
- **Trocar o client exige reconectar.** O client da Conta Google pode ser o mesmo do CRM (`clienteConta` cai nele
  quando não há `google-conta-oauth.json`), e foi o que se fez em 31 out neste Mac: o JSON do projeto meu-bot-crm
  salvo também como `config/google-conta-oauth.json`.
- **"Erro 403: access_denied" no login** ("o app não concluiu o processo de verificação do Google"): a tela de
  consentimento do projeto está em modo Teste e o e-mail não está na lista de testadores. A página já explica
  (mensagem em `fluxo`, conta-google.ts). Só o dono do projeto resolve, e há dois jeitos de sair do modo Teste:
  - **Interno** (console → Tela de consentimento OAuth → Público): para domínio Google Workspace. Todo e-mail do
    domínio entra, sem lista de testadores e sem verificação do Google. É o caminho de uma ferramenta de empresa.
  - **Externo, publicado**: para qualquer conta Gmail. O Google exige verificação do app; escopos sensíveis (Agenda,
    Planilhas) pedem formulário com vídeo e política de privacidade, escopos restritos (Gmail leitura, Drive além do
    `drive.file`) pedem ainda a auditoria de segurança CASA. Sem verificação: "app não verificado" no login e teto de
    100 usuários. O backup no Drive só precisa de `drive.file`, que não exige verificação; o Gmail é o escopo caro.
- **Issue #36, correção de registro:** o arquivo existia neste Mac, em
  `/Users/box/Applications/*.app/Contents/Resources/config/` (0600 do usuário `box`); a busca da issue falhou por
  permissão, não por ausência. Ao procurar credencial "em todo o Mac", conferir as pastas dos outros usuários com
  `sudo` antes de concluir que não existe.
- **O client OAuth de app instalado não é segredo** (o Google documenta isso: o app precisa dele em claro, e quem
  protege o login é o PKCE). O que é segredo já vai cifrado: o refresh token no Keychain (`google-conta/<máquina>.bin`)
  e os pacotes do backup, só com a senha de backup. Se o JSON vazar, "Redefinir secret" no console e reempacotar.

## A página Gmail vira "E-mail"; o corpo da mensagem fica legível (31 out, fim do dia)

- **Nome.** Havia dois "Gmail" na tela: a página própria do app e o site mail.google.com numa aba do Navegador. Agora
  a página própria chama-se **E-mail** (lateral `#gmail-line` com ícone `@`, aba, paleta `a:gmail`, badge `e-mail`,
  botão "Abrir o E-mail" na Conta Google) e **Gmail** é só o site/serviço do Google: a aba do Navegador em
  `mail.google.com` recebe o rótulo fixo "Gmail" em `tabLabel` (antes herdava "Caixa de entrada - … - Gmail", que
  variava e se confundia com a caixa de entrada do app), "Abrir no Gmail" continua abrindo o site, e os tutoriais do
  CRM "no Gmail" não mudam. Os ids não mudaram (`gmail` em `definePage`/`FIXAVEIS`/`PAGE_ID`, `gmail-line`,
  `gmail-count`, canais `gmail:*`): aba fixada e divisão gravadas continuam valendo. O cartão do agente fala em "ler
  seus e-mails" em vez de "usar o Gmail".
- **Corpo.** O `text/plain` vinha cru num `<pre>`: quebras duras a ~70 colunas, URLs de rastreamento partidas em
  quatro linhas, asteriscos como separador. `src/renderer/lib/email-texto-core.ts` (puro, testado em
  `scripts/tests/email-texto-core.test.mjs`) transforma em blocos: parágrafos corridos (`juntarLinhas`: a quebra depois
  de uma linha com 50+ caracteres vira espaço; linha curta, item de lista e separador ficam na própria linha; URL
  aberta no fim da linha + linha seguinte só com caracteres de URL juntam sem espaço), separadores (`hr`), citações
  (`>` → `blockquote`) e links (`trechosDe`: pontuação final fora do link; rótulo = host + caminho até 40 caracteres).
  O renderer (`corpoEl` em `gmail-page.ts`) monta `p`/`blockquote`/`hr`/`a.gmail-link`; o link abre no navegador do Mac
  por `openExternal`, com a URL inteira na dica.

## Lixeira sem confirmação na página E-mail (31 out, fim do dia)

- "Mover para a lixeira" apagava em dois cliques (`armConfirm`: "Confirmar? vai para a lixeira"). A pedido, agora é um
  clique: a lixeira do Gmail é reversível por 30 dias e o "Desfazer" aparece logo abaixo da lista, então a confirmação
  só atrasava. `mountGmail` deixou de receber `armConfirm`. O agente do chat continua pedindo confirmação antes de
  apagar (é outra pessoa agindo, não um clique da própria).

## Gmail: página própria, busca, leitura e lixeira (31 out)

- **Antes:** o Gmail era um cartão de teste escondido atrás de "Mostrar Gmail e Agenda" na Conta Google: 8 linhas,
  sem abrir nem apagar. **Agora** é a página **Gmail** (lateral, paleta "Gmail", fixável com 📌 e aceita no modo
  dividido): caixa de entrada com "Mais mensagens", busca na sintaxe do próprio Gmail (`from:ana is:unread
  has:attachment`), leitura (cabeçalhos, corpo em texto, nomes dos anexos, "Abrir no Gmail") e **"Mover para a
  lixeira"** com clique duplo e **"Desfazer"**. Recurso Pro, com a mesma trava da Conta Google (`assertAcesso` nos
  handlers; bloqueio e "Pedir o Pro ao admin" na tela). Sem conta conectada, a página manda para a Conta Google.
- **Escopo sem quebrar quem já está conectado:** a lixeira pede `gmail.modify`. Ele entra no pedido de login
  (`ESCOPOS_PEDIDOS`, google-core.ts), mas **não** em `ESCOPOS_CONTA`, que é o que `precisaReconectar` confere: incluir
  ali marcaria toda conta já conectada como "precisa reconectar" e pararia a cópia diária no Drive. Quem conectou antes
  lê e busca normalmente; só o botão da lixeira vira "Reconectar para poder apagar" (`gmailEscreve` em
  `GoogleContaStatus`; o main lança `GMAIL_SEM_PERMISSAO`). Apagar de vez exigiria o escopo total do Gmail: fica de
  fora; a lixeira é reversível por 30 dias. No console do projeto do client, listar `gmail.modify` na tela de
  consentimento (em modo Teste os testadores já conseguem conceder).
- **Código:** `src/main/google/gmail-core.ts` (puro, testado): corpo em texto a partir do `payload` em `format=full`
  (`text/plain` ganha; só HTML vira texto, com entidades decodificadas), anexos por nome, limites de busca/max/id/página,
  link `#all/<id>`. `apis.ts`: `gmailListar` (metadados de 5 em 5 em paralelo), `gmailLer`, `gmailApagar` (trash) e
  `gmailRestaurar` (untrash), os dois últimos com auditoria `gmail.apagar`/`gmail.restaurar`. IPC `gmail:listar`,
  `gmail:ler`, `gmail:apagar`, `gmail:restaurar` (shared.ts); saiu o `google-conta:gmail` do cartão de teste.
  Página: `src/renderer/gmail/gmail-page.ts`, fábrica `mountGmail` no molde da Conta Google.
- **Modo dividido:** `PAGE_ID` (split.ts) não aceitava `conta-google` nem `computador`, então o ramo deles em
  `restoreSplit` nunca rodava; entraram junto com `gmail`.
- **Próximo passo (PR separada):** o agente do chat lê e manda para a lixeira pela mesma API, pela ponte do Navegador
  (socket no Mac, túnel reverso, MCP na máquina), com confirmação antes de apagar.
- Testes: `scripts/tests/gmail-core.test.mjs`; casos novos em `google-core.test.mjs` (escopo) e `split.test.mjs`.

## O agente do chat no Gmail: a ponte (31 out)

- **O que é:** com a chave "Deixar o agente usar o Gmail" ligada na página Gmail (recurso Pro), o agente da máquina
  ganha as ferramentas `mcp__gmail__listar/ler/apagar/restaurar` nas conversas do app. "Detalha o segundo e-mail",
  "apaga esse": ele lista, lê e move para a lixeira pela **mesma API da página**; antes de apagar diz qual mensagem é e
  espera a confirmação na conversa; `restaurar` desfaz. O token do Google **nunca sai do Mac**: a máquina recebe o
  conteúdo, não a credencial. Só nas conversas do app; o WhatsApp (OpenClaw) fica para depois.
- **Desenho (o mesmo do Navegador do agente):** `src/main/google/gmail-api.ts` sobe um socket Unix 0600
  (`/tmp/<app>-<uid>/gmail-<máquina>.sock`) com as rotas `/status` (sonda), `/listar`, `/ler`, `/apagar`,
  `/restaurar`, cada uma chamando `apis.ts` e exigindo `assertAcesso` (Pro; sem o plano, 403). O túnel reverso leva o
  socket a `127.0.0.1:<porta>` na máquina; `backend.ts` manda `X-Meu-Bot-Gmail-Port` (e o rótulo da conversa) em
  cada turno; `server.js` confere Pro e o `.mjs` e liga o MCP `gmail` (`gmail-mcp.mjs`, um arquivo, sem npm) com
  `--dono meu-bot:<conversa>`, que vai para a auditoria do `gmail.apagar` ("pedido pela conversa X"). A regra de
  conduta (`backend-colima/gmail.js › GMAIL_RULE`) entra no system prompt e no CLAUDE.md dos workspaces
  (`install-gmail-mcp.sh`, bloco `meu-bot:gmail v1`).
- **Túnel reverso com mais de um encaminhamento:** `tunnel.ts` tinha um `-R` só por máquina, com a sonda fixa em
  `/abas`. Agora é um mapa por chave (`"nav"`, `"gmail"`), cada um com o próprio socket, porta, sonda e reinícios;
  `setReverseWanted(host, socket, { chave, sonda })` e `reversePort(host, chave)`. A chamada antiga do Navegador
  continua igual (chave `"nav"` por padrão).
- **Chave lembrada por máquina** (`gmailAgentHosts`): com ela ligada e a conta conectada, a ponte religa quando o
  túnel fica pronto ou quando a página pergunta; desconectar a Conta Google derruba o socket sem apagar a escolha.
- **"Os dois caminhos":** a API é o principal. A regra diz ao agente que, se a ferramenta responder "não conectada",
  "sem permissão" ou "fechado", ele avisa a pessoa; para **ler** pode usar o Navegador na aba do Gmail; para
  **apagar** nunca troca de caminho sozinho. Fallback automático ficou de fora de propósito: os dois caminhos
  identificam a mensagem de jeitos diferentes (id na API, tela no Navegador) e um "apaga" repetido apagaria errado.
- **Instalar na máquina:** o cartão "Agente do chat" da página mostra "Instalar na máquina" quando falta o MCP
  (`hostProbe.ts › gmailInstalled/installGmail`, como o Navegador). Uma CLI só: `pontes.js` monta um `--mcp-config`
  com os servidores ligados no turno (Navegador e/ou Gmail) e um `--allowedTools`.
- **Fora desta versão:** WhatsApp/OpenClaw (`mcp.servers.gmail` com `--port-file`, trava por remetente), marcar como
  lida/etiquetar, enviar e-mail.
- Testes: `scripts/tests/pontes.test.mjs` (args da CLI com uma, duas ou nenhuma ponte; notas do turno; regra; as
  ferramentas do `.mjs` iguais a `GMAIL_TOOLS`), `tool-events.test.mjs` (resumos `✉️`).

## Backup do trabalho: as ferramentas do Hermes ficam de fora (31 out)

- **O que aconteceu:** na meu-root-root o cartão "Backup no Drive" dizia `trabalho: o pacote de trabalho passou de
  512 MB`. O `.hermes` tinha 3,5 GB, e 2,4 GB eram coisa que se reinstala: `.hermes/tools` (ffmpeg, Python, Node e uv
  que o Hermes baixa, 1,6 GB) e `.hermes/installs` (os ambientes montados a partir deles, 728 MB). Nenhum dos dois
  estava na lista de exclusão do conjunto Trabalho (`CONJUNTOS_DADOS`, google-core.ts); o `cache` (1 GB) já estava.
- **Agora:** os dois entram no `excluir`. Medido na mesma máquina, o pacote cai para 1,4 MB. Teste em
  `scripts/tests/google-core.test.mjs`.
- **"financeiro: a máquina não empacotou financeiro: nada de financeiro nesta maquina" deixou de ser erro.** O
  comando remoto sai com 3 quando nenhuma pasta do conjunto existe (máquina sem o financeiro, por exemplo), e
  `empacotar` (dados-drive.ts) tratava qualquer saída diferente de 0 como falha, então o cartão mostrava um erro em
  toda máquina sem financeiro. Saída 3 agora é "ausente": vai só para o log e a tela fica com o que subiu.

## Tutorial 16 "Gmail (Pro)" (31 out)

- Tutorial da página Gmail, em `src/renderer/gmail/gmail-guia.ts` (passos e a fonte `google` do guia) e a entrada
  `gmail` em `lib/tutoriais.ts`: Pro → Conta Google conectada → ler uma mensagem → buscar → lixeira + desfazer. A
  página conta ao guia o que a pessoa fez por `GmailDeps.aoUsar` (`"lido" | "buscou" | "lixeira" | "desfez"`), e o guia
  grava como fato lembrado. Detalhes da reorganização dos tutoriais em `docs/guia/app.md` (fases 1 a 5).

## Agente do chat no Gmail ligado por padrão (31 out)

- **Pedido:** o cartão "Agente do chat" da página Gmail exigia clicar em "Deixar o agente ler os e-mails" em cada
  máquina; a pessoa quis isso ligado sozinho.
- **Agora:** ligado é o padrão. `gmailAgentHosts` (lista de ligados) virou `gmailAgentDesligados` (lista de quem
  desligou de propósito; `settings-normalize.ts`, `settings.ts`): `isGmailAgentHost` é "não está na lista de
  desligados". `gmailAgenteReligar` (gmail-api.ts) sobe a ponte quando o túnel fica pronto, com a conta conectada **e**
  passando pelo mesmo `assertAcesso` do botão (sem Pro, nada sobe; a página mostra o bloqueio). O arquivo antigo com
  `gmailAgentHosts` é só ignorado: quem tinha ligado continua ligado, quem nunca ligou passa a ter. "Desligar para o
  agente" continua valendo e fica lembrado. Teste em `settings-normalize.test.mjs`.


## Varredura do backup: diz o arquivo e ignora placeholder (1 nov)

- **O que acontecia:** o conjunto Trabalho da meu-root-root não subia desde 31 out: "encontrei o que parece um token
  do GitHub no pacote; não sobe sem cifra", sem dizer onde. Era `.hermes/skills/autonomous-ai-agents/hermes-agent/
  references/native-mcp.md`, um documento de referência de skill com `ghp_xxxx…` de exemplo.
- **Agora:** `achaSegredo` ignora valores claramente de exemplo (`ehPlaceholder`: `ghp_xxxx…`, `sk-XXXX…`, um
  caractere repetido; o exemplo oficial da AWS continua contando) e `achaSegredoNoTar` percorre o pacote entrada por
  entrada e devolve o arquivo: a mensagem passa a ser "…token do GitHub em chat-workspace/.env.exemplo…; confira
  esse arquivo (apague a linha, ou tire-o do conjunto) ou mova o conjunto para cifrado". Testes em
  `google-core.test.mjs` com um tar montado à mão.

## "Guardar agora" mostra o andamento, conjunto a conjunto (1 nov)

- **O que acontecia:** clicar em "Guardar agora" só apagava os botões por uns 40 s (cinco conjuntos, cada um
  empacotado por SSH e subido ao Drive) sem dizer que estava rodando nem em que ponto; parecia que o clique não pegou.
- **Agora:** o main manda `backup-dados:progress` (uma etapa por conjunto: `enviando`, `enviado` com o tamanho,
  `pulado` sem senha, `ausente`, `erro` com a mensagem) só para as janelas da máquina que está copiando
  (`dados-drive.ts`, `enviarDadosAoDrive`). O cartão "Backup no Drive" troca a última cópia pelo indicador de espera
  "Guardando no Drive…" e a linha "2 de 5 · CRM ✓ 1 KB · Agente enviando…"; o botão vira "Guardando…"; o erro da
  tentativa anterior sai da tela enquanto a nova roda. A cópia diária (sem clique) aparece do mesmo jeito e, ao
  acabar, a página relê o estado. Cada etapa também entra na faixa de depuração como origem `hook`. Puro em
  `src/renderer/conta-google/backup-andamento.ts` (`backup-andamento.test.mjs`).
