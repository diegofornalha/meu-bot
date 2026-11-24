# Playbook: ligar uma nova máquina ao meu-bot

Roteiro técnico para repetir o que foi feito com a `grokbot-1`, a `agente-box` e o Colima quando
chegar outra máquina (outro computador do Grok Bot, outra VM, outro acesso). Cada passo tem o
comando, o que esperar e o que costuma dar errado. Quem executa é o Claude Code no Mac ou você.

---

## VPS nova pelo admin, com um clique (5 nov)

Para uma VPS recém-criada (Hostinger ou outro provedor), o caminho curto é o botão **Nova VPS** do seletor do
meu-bot-admin-gestao (ao lado de "Adicionar"): endereço, nome curto e "Entrar no fluxo". Ele grava `<nome>-root` no
`~/.ssh/config` deste Mac, põe a máquina na lista de pessoas, roda o Preparar máquina inteiro, cria `box-1` e sugere o
bloco para o `config/ssh-hosts.conf` (commitar é com você). Pré-requisito: **cadastre a chave pública deste Mac
(`~/.ssh/id_ed25519.pub`) no painel do provedor ao criar a VPS** (Hostinger: Configurações › Chaves SSH); se a VPS só
tiver senha, o job abre o Terminal para o `ssh-copy-id` e espera. O que fica para você: login do root no Claude Code
Global, a Cloudflare do link público e o QR do WhatsApp. O resto deste playbook continua valendo para o que o botão
não cobre (Mac novo, Grok Bot, Colima, caixa de entrada).

## Mac novo: do clone ao seletor

O que precisa existir num Mac novo antes de o seletor listar as máquinas, e como o Cursor entra nisso.
Não há "sincronização com o Cursor": o seletor e o Cursor (Remote SSH) leem o **mesmo**
`~/.ssh/config`. Quem põe as máquinas lá é o botão **⇅ sincronizar ssh** do seletor, a partir do
modelo versionado `config/ssh-hosts.conf`.

1. Node 24+ (`node -v`), `git clone` do projeto (fora da Mesa, por exemplo `~/dev/meu-bot`; o SSH
   não lê `~/Desktop` sem Acesso Total ao Disco) e `./instalar.sh --abrir`: instala dependências se
   faltam, fecha um meu-bot aberto, roda `npm run dist` e abre o seletor. O app fica em
   `~/Applications/meu-bot.app` e `~/Desktop/meu-bot.app`. (`npm test` confere o build e os testes.)
2. Chave SSH: copie `~/.ssh/id_ed25519` (e a `.pub`) do Mac antigo, `chmod 600`. Ou gere uma nova
   (`ssh-keygen -t ed25519`) e coloque a `.pub` no `authorized_keys` de cada máquina (seção 1).
   A chave nunca vai no repositório.
3. Tailscale: instalar o app, entrar na conta que vê os computadores do Grok Bot (`agentesgrok@`),
   conferir `tailscale status`. Sem isso a `grokbot-1` não resolve.
4. Abra o meu-bot. O seletor mostra só `local`. Clique em **⇅ sincronizar ssh** (rodapé): ele acrescenta ao `~/.ssh/config` os `Host` e `Include` do modelo que faltam,
   com backup `config.bak-<data>`, sem tocar em bloco que já existe. A caixa abaixo da lista diz o
   que entrou, o que já havia, o que existe só neste Mac e se falta a chave. A lista recarrega e as
   sondagens começam.
5. Cursor: instale a extensão Remote SSH; ela já lista os mesmos hosts. Se não listar, veja se a
   configuração `remote.SSH.configFile` aponta para outro arquivo; apague ou aponte para
   `~/.ssh/config`. A primeira conexão pergunta a plataforma (Linux).
6. Atalhos da mesa não vêm junto: crie de novo pelo seletor (botão "+" na linha). Numa
   máquina reconhecida como computador do Grok Bot, a caixa de baixo tem "🧯 Botão de alívio na
   mesa".
7. Opcional: copiar `~/Library/Application Support/meu-bot/{conversations.json,settings.json,memory.json}`
   do Mac antigo traz as conversas e preferências.

Máquina nova no projeto: acrescente o bloco em `config/ssh-hosts.conf` (o sync nunca altera um
`Host` existente, então quem já tinha o bloco antigo precisa editar o `~/.ssh/config` na mão).
O que existe só no seu Mac e não está no modelo aparece como "só neste Mac" para você decidir.

---

## 0. Reconheça o tipo de máquina

Rode no host:

```bash
tr '\0' ' ' < /proc/1/cmdline; echo        # quem é o PID 1
cat /proc/1/cgroup | head -1               # cgroup
mount | grep ' / '                         # sistema de arquivos raiz
ip -br addr                                # endereços
id; sudo -n true && echo "sudo ok"         # usuário e sudo
command -v systemctl pm2 node claude       # o que existe
```

| Sinal | Significa |
|---|---|
| PID 1 = `/tini -- /pod-daemon …`, cgroup `pod-…`, raiz `overlay` em `/var/lib/isod/…`, IP `172.30.x.x` | **Computador do Grok Bot**: contêiner na infra deles. Sem systemd, sem sudo, NAT, o host pode pausar a máquina (`virtio_balloon`). Init de usuário = PM2. Porta 22 é o **Tailscale SSH** servido por um `tailscaled` que roda sob PM2. |
| PID 1 = `systemd`, IP público na interface, `sudo` funciona | **VM sua** (hospedagem). Tudo normal: systemd, root, firewall seu. |
| `~/.colima/ssh_config` incluído no `~/.ssh/config`, host `colima` em `127.0.0.1:<porta>` | **VM do Colima no Mac** (Lima). Usuário = seu usuário do Mac, home `/home/<user>.guest`, pouca memória (4 GB por padrão). |

Isso decide como o backend vai ficar vivo (systemd, PM2 ou nohup) e o que dá pra consertar quando
a máquina trava (num pod do Grok Bot, só o que é seu dentro dele; o resto é o botão de reiniciar
no app do Grok Bot).

---

## 1. Acesso SSH sem senha

1. Chave: a do Mac é `~/.ssh/id_ed25519.pub`. Cole em `~/.ssh/authorized_keys` do usuário remoto
   (`chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys`).
2. Num computador do Grok Bot o SSH chega pela rede Tailscale. Confira dos dois lados:
   ```bash
   tailscale status            # no Mac: a máquina aparece? "direct" ou "relay"?
   tailscale ping 100.x.y.z    # responde?
   ```
3. Bloco no `~/.ssh/config` do Mac (o meu-bot e o Cursor leem daqui; `Include` também vale). Coloque
   o mesmo bloco em `config/ssh-hosts.conf` do projeto: é o que o botão ⇅ do seletor replica num Mac novo.
   ```
   Host nome-curto
       HostName 100.x.y.z        # IP Tailscale ou público
       User box
       IdentityFile ~/.ssh/id_ed25519
       IdentitiesOnly yes
       ServerAliveInterval 60
       ServerAliveCountMax 3
   ```
4. Teste com paciência, porque um pod sob carga demora até 90 s para aceitar:
   ```bash
   ssh -o BatchMode=yes -o ConnectTimeout=90 nome-curto 'uptime; free -m | sed -n 2p'
   ```

Pegadinhas: `nc -z` com 5 s diz "fechada" enquanto o ssh com 40 s entra. Nunca conclua "fora do ar"
com timeout curto. `pkill -f claude` por SSH pode matar a própria sessão (o comando contém a
palavra). Em zsh, glob sem resultado aborta o script (`setopt nullglob` ou teste com `[ -e ]`).

---

## 2. Node e Claude Code no host

```bash
node -v                                   # precisa >= 18; sem node, o instalador baixa o 20 (.tar.gz; .tar.xz falha se não houver xz)
ls -l ~/.local/bin/claude || command -v claude
grep -c '"oauthAccount"' ~/.claude.json   # 1 = logado
```

- Instalar o Claude Code **nativo, no usuário** (não dependa de um global do root):
  `curl -fsSL https://claude.ai/install.sh | bash` → `~/.local/bin/claude`.
- Login é interativo e precisa de navegador: `ssh -t nome-curto claude` e dentro `/login`.
  Confira depois com o `grep` acima. Sem login o backend responde 401 `claude_auth`.
- **Root não roda bypass** (`--dangerously-skip-permissions` é recusado como root). Crie um usuário
  comum (`useradd -m -s /bin/bash box`, `usermod -aG sudo box`, `echo 'box ALL=(ALL) NOPASSWD:ALL' >
  /etc/sudoers.d/box`) e faça tudo nele.
- `~/.claude/settings.json` mínimo para bypass por padrão:
  `{"permissions":{"defaultMode":"bypassPermissions"},"skipDangerousModePermissionPrompt":true}`.
  O `/login` pode reescrever esse arquivo e o `.bashrc`; confira depois do login.

---

## 3. Backend do meu-bot

O app espera, no host, o backend do meu-bot em `~/.local/share/meu-bot/backend` (`.env` com `OPENAI_COMPAT_KEY`; a pasta
herdada `~/.hermes/agente-rene/backend-sdk-claude` ainda vale onde o nosso `server.js` já foi instalado nela) e um
servidor OpenAI-compatível na porta 8080 (configurável) em `127.0.0.1`. Máquina com outro agente na 8080 (Hermes):
o backend do meu-bot vai na pasta própria, em porta livre.

### 3a. Backend genérico (`backend-colima/`), para qualquer máquina com Claude logado

Pelo app: seletor → máquina → "Instalar backend". Ou à mão:

```bash
scp backend-colima/{server.js,session-map.js,meu-bot-backend.service,install.sh} nome-curto:~/.meu-bot-install/
ssh nome-curto 'PORT=8080 bash ~/.meu-bot-install/install.sh'
```

O que o `install.sh` faz: usa Node existente (>= 18) ou baixa; cria o diretório, `.env` com chave
aleatória (0600) e `CLAUDE_BIN`; serviço **systemd de usuário** com linger (ou de sistema quando
root; ou `nohup` sem systemd); termina com `GET /v1/models`. Modelos: `claudecode` (chat, 8 turnos,
permissão padrão) e `agente` (30 turnos, `--dangerously-skip-permissions`, cwd `~/agent-workspace`).

**Num computador do Grok Bot** não há systemd: o fallback `nohup` não sobrevive a reinício. Prefira
PM2, que já é o init de usuário lá:
```bash
cd ~/.hermes/agente-rene/backend-sdk-claude && pm2 start server.js --name meu-bot-backend && pm2 save
```

### 3b. Backend do Hermes/René (o original da `grokbot-1`)

Fica em `~/.hermes/agente-rene/backend-sdk-claude` (Express, pm2 `hermes-mythos-lucas`, `claude-query.js`
spawnando a CLI). Modelos `claudecode`, `rene`, `rene-dm`, `rene-buffer`, `agente`. Mudanças lá são
sempre **opt-in por cabeçalho** e com backup:
```bash
TS=$(date +%Y%m%d%H%M%S); cp services/openai-compat.js services/openai-compat.js.bak-$TS
# editar; node --check; bash scripts/run-tests.sh; pm2 restart hermes-mythos-lucas
```
Rollback: restaurar o `.bak-<TS>` e `pm2 restart`. O deploy versionado está em
`backend-vm/` com `deploy-agente.sh`. Em scripts de deploy use `set -o pipefail` ou grave a saída
em arquivo: `cmd | tail` devolve o status do `tail` e mascara falha.

### 3b½. Provedores e fallback (`providers.json`, vale para os dois)

Lista ordenada ao lado do backend. Padrão: só o `agente` (Claude, prioridade 0). O backend tenta o modelo
pedido; se ele falhar antes de responder, desce para o próximo que aceita ser reserva e avisa o app (aviso amarelo na
conversa). Com a corrente só no `agente` não há para onde descer. Outro motor de IA chega por dois caminhos:
- modo grátis: o `install-ollama.sh` mescla a entrada `ollama-local` no `providers.json`; ou
- módulo: o instalador grava `~/.local/share/meu-bot/modulos/<id>/provedores.json` e o backend o lê na subida. O Grok
  (xAI) é o módulo `grok` do complemento `meu-bot-grok`, com login pelo `entrar.sh` dele
  (`docs/guia/meu-bot-diego.md` › "Motor de IA trazido por módulo").
```bash
cat ~/.local/share/meu-bot/backend/providers.json   # conferir (na pasta herdada: ~/.hermes/agente-rene/backend-sdk-claude)
curl -s -H "Authorization: Bearer $K" localhost:8080/v1/meu-bot/status | grep -o '"providers":\[[^]]*\]'   # a corrente, com reserva e módulo
```
**Nunca rode o `install.sh` genérico onde já existe o backend do Hermes** (grokbot-1): ele recusa agora
(`app.js`/`services/` presentes), e o caminho certo lá é `backend-vm/deploy-agente.sh`.

### 3c. Verificação (vale para os dois)

```bash
K=$(grep ^OPENAI_COMPAT_KEY= .env | cut -d= -f2-); H="Authorization: Bearer $K"; J="Content-Type: application/json"
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/v1/models                       # 401 sem chave
curl -s -H "$H" localhost:8080/v1/models                                               # lista modelos
curl -s -H "$H" -H "$J" localhost:8080/v1/chat/completions -d '{"model":"claudecode","messages":[{"role":"user","content":"responda só: ok"}]}'
curl -sN -H "$H" -H "$J" -H 'X-Stream-Mode: live' localhost:8080/v1/chat/completions -d '{"model":"claudecode","stream":true,"messages":[{"role":"user","content":"conte de 1 a 12"}]}' | head -8
# retomada: duas chamadas com X-Conversation-Id: t1 e X-Conversation-Seen: 0 / 2 → a segunda vem com X-Session-Resumed: true
# bypass: pedir ao modelo "agente" para criar um arquivo e ler de volta
# motor de módulo ou modo grátis, se houver: model <nome do provedor> → cabeçalho X-Provider: <nome>
# status line: GET /v1/meu-bot/status → {claude:{email,assento,sessionPct,…}, providers:[…]}; campos null se o
#   ~/.cache/claude-statusline/ratelimits.json não existe. Quem grava é o statusline.sh de backend-colima/ (o do
#   claude-statusline mais o cache de limites); o seletor oferece "Instalar status line" onde falta, ou na mão:
#   bash ~/.meu-bot-install/install-statusline.sh. O cache só nasce depois de um Claude Code interativo na máquina.
```

Do Mac, pelo mesmo caminho do app:
```bash
K=$(ssh nome-curto 'grep ^OPENAI_COMPAT_KEY= ~/.hermes/agente-rene/backend-sdk-claude/.env | cut -d= -f2-')
ssh -f -N -o ExitOnForwardFailure=yes -L 127.0.0.1:18080:127.0.0.1:8080 nome-curto
curl -s -H "Authorization: Bearer $K" -H 'Content-Type: application/json' 127.0.0.1:18080/v1/chat/completions -d '{"model":"claudecode","messages":[{"role":"user","content":"túnel ok?"}]}'
```

---

## 4. A máquina no meu-bot

- Ela aparece sozinha no seletor (hosts do `~/.ssh/config` + `local`). A sondagem roda por ssh avulso
  e devolve: acessível, usuário/SO, backend instalado (há `.env` e `server.js`), ouvindo (porta),
  `claude` presente, logado (`oauthAccount`), Node, modelos anunciados.
- Estados e o que fazer: **inacessível** → rede/pod (seção 6); **Claude não logado** → passo 2;
  **sem backend** → botão Instalar (3a); **instalado mas parado** → Reinstalar sobe o serviço.
- Cada conversa guarda o `host`; o túnel é um por máquina (ControlMaster em `/tmp/<app>-<uid>/`,
  forward `-N -L`, chave lida por ssh, nunca persistida). Log: `~/Library/Application Support/meu-bot/meu-bot.log`,
  linhas `[tunnel] [host]`.
- A sondagem também detecta **computador do Grok Bot** (PID 1 `pod-daemon` ou cgroup `pod-…`) e o
  app lembra isso em `settings.json` (`podHosts`), para os botões de alívio existirem mesmo quando a
  máquina está inacessível, que é justamente quando se precisa deles. Na linha aparece 🧯 (aliviar
  agora: abre a janela de alívio e fecha o seletor); na caixa de baixo, "🧯 Botão de alívio na mesa".
- Rodapé: ⇅ sincroniza o `~/.ssh/config` com `config/ssh-hosts.conf` (seção "Mac novo"). Não há atalho
  do seletor na mesa: o próprio `meu-bot.app` (e o Dock) sempre abre nele.
- Atalho na mesa pelo seletor: `<host>.app` chama o binário com `--host=<host>`; `aliviar <host>.app`
  com `--alivio=<host>` abre a janela de alívio. Com o app aberto, isso chega por `second-instance`
  (lock de instância única). `open -a App --args` **não** funciona com o app já aberto: o macOS
  descarta os argumentos. Todo applet nosso tem `Contents/Resources/meu-bot-host.txt`
  (`meu-bot-shortcut-v1 <nome>`); sem o marcador o app se recusa a remover a pasta.

---

## 5. Alívio de um computador do Grok Bot

Nada a instalar no pod: a janela de alívio manda `scripts/alivio/alivio-pod.sh` pelo stdin do ssh,
grava em `~/bin/alivio-pod.sh` do host e roda com `--tailscale`. A cópia do pod fica sempre igual à do
app (`Contents/Resources/alivio/` no .app). Pela mão:
```bash
ssh -o ConnectTimeout=90 nome-curto 'mkdir -p ~/bin && cat > ~/bin/alivio-pod.sh && bash ~/bin/alivio-pod.sh --tailscale' < scripts/alivio/alivio-pod.sh
```
O que ele faz: encerra CLIs do Claude do backend com mais de 30 min (`LIMITE_S`), Chrome headless; com
`--tailscale`, agenda `pm2 restart tailscaled` em 2 s por `nohup` (a sessão cai e volta; estado e IP
preservados). Log em `~/alivio.log`. Não toca em serviços do Grok Bot nem no PM2 inteiro.

Os botões: no seletor, a máquina reconhecida como pod ganha 🧯 na linha (aliviar agora) e, na caixa
de baixo, "🧯 Botão de alívio na mesa", que cria `aliviar <host>.app` (applet que chama o binário com
`--alivio=<host>`, ícone 🧯 sobre vermelho fixo). Se quiser fazer o applet na mão:
```bash
osacompile -o "$HOME/Desktop/aliviar nome-curto.app" -e "do shell script \"'$HOME/Desktop/meu-bot.app/Contents/MacOS/meu-bot' --alivio=nome-curto >/dev/null 2>&1 &\""
rm -f "$HOME/Desktop/aliviar nome-curto.app/Contents/Resources/Assets.car"   # senão o Finder mostra o ícone de script
defaults write "$HOME/Desktop/aliviar nome-curto.app/Contents/Info.plist" LSUIElement -bool true
printf 'meu-bot-shortcut-v1 aliviar nome-curto\n🧯\n' > "$HOME/Desktop/aliviar nome-curto.app/Contents/Resources/meu-bot-host.txt"
```
Não use `tell application "Terminal"` no applet: pede permissão de Automação e, sem resposta, o
clique não faz nada.

---

## 5b. WhatsApp do Hermes (só em máquina com o gateway do Hermes Agent)

No topo da lista de conversas (☰) o app mostra "WhatsApp do Hermes · número · conectado/
desconectado". Desconectado: clique → "Gerar QR" (ou "Reparear" se a sessão foi deslogada pelo
WhatsApp) → leia com o celular do número do bot (WhatsApp › Aparelhos conectados › Conectar
aparelho). O app pausa o gateway, roda o bridge oficial em modo pareamento e sobe o gateway de
volta. Pela mão, na máquina: `hermes whatsapp`. Diagnóstico: `tail ~/.hermes/whatsapp/bridge.log`
("Logged out" = sessão morta), `curl 127.0.0.1:3000/health` (`connected` = conectado).

## 6. Quando a máquina não responde

Ordem de diagnóstico:
1. `tailscale status` no Mac: a máquina está "active"? Isso é só o cadastro; não prova nada.
2. `ssh -o ConnectTimeout=90 host uptime`: entrou? Carga alta (> nº de vCPUs) = sobrecarga; muitos
   processos em estado `D` = disco/pausa do host.
3. Entrou mas lento → botão de alívio. Não entrou em 90 s: antes de concluir "pod congelado", olhe o
   stderr do ssh. Se tiver `Tailscale SSH requires an additional check` com um link
   `login.tailscale.com/a/…`, é só aprovar o link no navegador (o seletor e a janela de alívio do app
   fazem isso sozinhos). Para não pedir mais: no seletor, "Desligar a verificação de vez" edita a
   política do tailnet (regra ssh: check → accept) pela API; precisa de um OAuth client do Tailscale
   com escopo Policy File, criado em Settings › Keys e guardado no Keychain deste Mac (uma vez por
   Mac). Backups da política ficam em `~/Library/Application Support/meu-bot/tailscale-policy-backups/`;
   a paleta tem "Tailscale: restaurar política do último backup". Sem esse aviso e sem resposta → pod congelado pelo host: **Redefinir** o
   computador pelo app do Grok Bot (o app abre o card certo). Não use "Atualizar": troca a base e
   remove pacotes instalados; não é socorro.
4. Depois que voltar: `pm2 status` (tudo online?), `pm2 logs tailscaled --lines 20` (por que
   reiniciou?), `tail ~/alivio.log`.

Causas vistas na `grokbot-1`: `tailscaled` reiniciado pelo PM2 sob carga (derruba a porta 22 por
segundos), CLIs do `rene` presas por 30 a 60 min, Chrome headless, 15 zumbis, `virtio_balloon`
pausando o pod centenas de vezes por dia. Alívio trata o sintoma; a causa é a VM pequena para o que
roda nela e turnos sem limite de tempo no backend do René.

---

## 7. Checklist resumido para uma máquina nova

- [ ] Mac novo? Seção "Mac novo": clone, chave, Tailscale, botão ⇅ do seletor.
- [ ] Reconhecer o tipo (seção 0) e anotar IPs/usuário no mapa de máquinas de `guia/maquinas.md`.
- [ ] Chave no `authorized_keys`; bloco no `~/.ssh/config` **e** em `config/ssh-hosts.conf`; `ssh host uptime` com 90 s.
- [ ] Usuário comum (não root); Claude Code nativo em `~/.local/bin`; `/login` via `ssh -t`.
- [ ] Backend: Instalar pelo seletor (ou `install.sh`); num pod do Grok Bot, subir por PM2 + `pm2 save`.
- [ ] Verificação 3c: 401, modelos, chat, stream live, retomada, bypass.
- [ ] No meu-bot: abrir a janela da máquina, mandar uma mensagem; criar o atalho na mesa.
- [ ] Se for pod do Grok Bot: conferir que o seletor mostra 🧯 na linha; criar o botão de alívio na mesa pela caixa de baixo.
- [ ] Segurança: se tiver IP público, `PasswordAuthentication no` no sshd depois que a chave funcionar.

## Suporte para outra pessoa (meu-bot-admin)

1. Uma vez, no Mac do admin: `node scripts/suporte-setup.mjs --caixa agente-box --nome Lucas`.
2. Para a pessoa: `npm run dmg -- --suporte` → `out/meu-bot-<versão>-<arch>-suporte.dmg`.
3. Para o admin: `npm run dmg:admin` (ou `npm run dist:admin`, que já instala).
4. A pessoa abre a máquina dela no meu-bot › tutorial "Ligar o suporte" › escreve o nome e salva (o
   interruptor "Permitir o acesso do admin" já vem marcado, então salvar liga). Ela aparece
   sozinha no meu-bot-admin (ou ela manda o código e o admin usa "Adicionar pessoa").
5. Para cortar: a pessoa desliga o interruptor (ou apaga a linha `meu-bot-admin` do authorized_keys).
6. Versão nova para todo mundo: suba a versão no `package.json`, commite e rode `npm run release` (precisa do
   `gh` logado). Os apps instalados baixam sozinhos e trocam ao reabrir (ou em "Reiniciar e atualizar"). O
   admin vê na saúde de cada pessoa a versão em que ela está.

## Terminal na aba

- Nas máquinas por SSH não precisa de nada além do `python3` (já exigido pelo app). Em "este Mac", o shell
  local usa `/usr/bin/python3`, que vem com as Ferramentas de Linha de Comando (`xcode-select --install`).
- A "Atividade do agente" (o que o modo agente roda) depende do backend com `tool-events.js`: "Reinstalar
  backend" no seletor atualiza.
