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

## Client OAuth da Conta Google (30 out)

A Conta Google (login, Gmail, Agenda, Planilhas, importação do financeiro, backup no Drive) precisa do client OAuth do
app, `google-conta-oauth.json`. É credencial: fica **fora do git** (`.gitignore`) e `scripts/package.mjs` só o copia
para `Resources/` se existir em `config/`. Sem ele o build sai sem Google e a página mostra "Google não configurado".

- **Empacotamento barulhento:** em app cliente (não admin) sem `config/google-conta-oauth.json`, o `package.mjs` imprime
  um aviso destacado; num release (`--versao`, como faz o `release.mjs`) o build **falha**. `--sem-google` permite
  empacotar sem Google de propósito (`npm run dist:staging -- --sem-google`).
- **Criar o client** (igual ao do CRM, em [crm.md](crm.md)): console.cloud.google.com → projeto → tela de consentimento
  OAuth com os escopos da Conta Google (`openid`, `email`, Gmail, Agenda, Planilhas, `drive.file`) → Credenciais → ID do
  cliente OAuth → **App para computador** → baixar o JSON → salvar como `config/google-conta-oauth.json`.
- **Onde o arquivo mora fora do git:** no cofre da equipe (ex.: 1Password) ou na cópia do Mac que já empacotou. Quem
  vai empacotar numa máquina nova copia para `config/` antes do `npm run dist*`. O mesmo vale para
  `config/google-oauth.json` (Contatos do CRM).
- **Testar sem reempacotar:** copiar o JSON para `~/Library/Application Support/<app>/google-conta-oauth.json` e reabrir
  (é o primeiro lugar que `clienteContaOrigem()` procura). Cuidado: o arquivo ali sobrevive às atualizações e vence o do
  pacote; a tela mostra a origem.
