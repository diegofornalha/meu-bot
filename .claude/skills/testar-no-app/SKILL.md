---
name: testar-no-app
description: Ciclo fecha → rebuilda → abre → testa de um app do meu-bot (meu-bot-admin, meu-bot, staging) neste Mac, conferindo na tela que a mudança funcionou. Use quando o usuário disser "rebuilda e testa", "abre e vê se deu certo", "testa no app", "simula se deu certo", "kill, rebuilda e abre", "dá kill e abre com o ajuste", "quero ver essa PR no staging", ou depois de uma mudança visual que precisa ser vista no app instalado.
---

# Testar no app: fecha, rebuilda, abre e confere

> **Os passos 1 a 4 já rodam sozinhos**: o hook `Stop` do projeto (`scripts/hooks/rebuild-auto.sh`, ver skill
> `rebuildar`) faz testes → fecha → empacota → reabre → confere o log, em segundo plano, sempre que algo do app mudou.
> Esta skill continua valendo para o passo 5 (ver na tela) e para quando a pessoa pedir o ciclo agora, numa variante
> específica. Atenção: `System Events` (clicar, digitar) só funciona se o Terminal tiver Acessibilidade, o que neste
> Mac é negado (erro -25211): o caminho que funciona é o **DevTools remoto** (passo 5, item 2), com `scripts/devtools.mjs`.

O app instalado é empacotado e só mostra a mudança depois de rebuildar. Pedir esta skill já autoriza fechar e
reabrir o app sem perguntar de novo.

| Variante | Processo / app | Empacotar |
|---|---|---|
| admin | `meu-bot-admin` | `npm run dist:admin` |
| meu-bot | `meu-bot` | `npm run dist` |
| staging | `meu-bot-staging` | não instale por cima: veja "Ver um ramo no meu-bot-staging", abaixo |

Log de cada app: `~/Library/Application Support/<app>/meu-bot.log`. Capturas: sempre no scratchpad da sessão.

## 1. Testes

`npm test` (já roda o build). Com teste quebrado, pare e mostre a falha: não empacote.

## 2. Fechar (kill se não fechar)

```bash
osascript -e 'quit app "<app>"'
for i in 1 2 3 4 5; do pgrep -f "<app>.app/Contents/MacOS" >/dev/null || break; sleep 1; done
pgrep -f "<app>.app/Contents/MacOS" >/dev/null && pkill -f "<app>.app/Contents/MacOS"
```

## 3. Rebuildar

`npm run dist…` da tabela, com timeout de 10 min. Confira na saída "Assinatura ad-hoc aplicada" e "Instalado em".

## 4. Abrir e ver se ficou de pé

```bash
L=~/Library/Application\ Support/<app>/meu-bot.log; N=$(wc -l < "$L")
open ~/Applications/<app>.app; sleep 8
pgrep -f "<app>.app/Contents/MacOS" >/dev/null && echo "de pé"
tail -n +$((N+1)) "$L" | grep -iE "erro|error|falh|exception|uncaught"
```

O app caiu ou há erro novo no log: pare e mostre o trecho do log.

## 5. Testar na tela

0. **Ligue o modo de depuração** (no staging já vem ligado): selo DEPURAÇÃO ao lado do PRO, item na paleta, ou a
   ferramenta `depuracao` do app-mcp. A faixa no topo mostra o build que está rodando (confira se é o seu), o batimento
   do processo principal (vermelha = main preso: leia a última marca), o túnel e cada ação que chega pelos sockets.
   Antes de cada passo seu, anuncie com `nota` (app-mcp) ou `POST /nota` no `term.sock`: a pessoa acompanha de fora.
   Com o controle externo ligado (Configurações › Controle externo (MCP)), as mesmas ferramentas valem por HTTP:
   `claude mcp add --transport http <app> http://127.0.0.1:<porta>/mcp --header "Authorization: Bearer <token>"`
   (o botão "Claude Code" da seção copia o comando pronto; `terminal_digitar` e `nav_js` só com "Executar comandos
   e código" ligado). Mexeu no protocolo ou no `term.sock`? `scripts/mcp-fumaca.sh` prova que o Claude Code ainda
   conecta (registra em escopo local e remove ao sair).
1. **Ver**: `osascript -e 'tell application "<app>" to activate'`, `screencapture -x <scratchpad>/tela.png`,
   `sips -Z 1600` para reduzir e Read na imagem. A captura funciona sem permissão extra.
2. **Navegar até a mudança: primeiro pelo próprio controle externo (desde 25 nov).** Com o app aberto e "Executar
   comandos e código" ligado, as ferramentas do app-mcp fazem o que antes pedia o DevTools, sem reabrir o app com
   porta de depuração: `ui_ler` (o texto e os botões numerados da janela), `ui_clicar` (por `n`, `texto` ou `seletor`;
   `direito: true` abre o menu da aba ou do WhatsApp, que se lê com `menu_ler`), `ui_digitar`, `ui_tecla`,
   `comando_rodar` (qualquer ação da paleta, ex.: `a:settings`), `conversa_enviar` + `conversa_ler`, `estado`,
   e `print_janela marcas=true` para ver os números na imagem. Guarde a hora antes de agir e leia depois
   `erros_ler {desde}` e `log_ler {desde}`: é como se acha o erro que a tela não mostra. Se a sessão não lista essas
   ferramentas (o cliente carregou a lista antes do build novo), chame por HTTP como o `scripts/mcp-fumaca.sh` faz.
   O DevTools remoto, abaixo, fica para o que elas não alcançam (`import()` de módulo, o console ao recarregar).
   **Sem Acessibilidade e sem as ferramentas acima: DevTools remoto.** Antes, confirme que o app
   instalado é o seu build (`grep -a -c <símbolo novo> ~/Applications/<app>.app/Contents/Resources/app.asar`; o hook de
   outra sessão pode ter reinstalado outro branch). Feche o app e lance o binário com a porta (`open -a` não passa
   argumentos; os fuses não bloqueiam esta flag):
   `~/Applications/<app>.app/Contents/MacOS/<app> --remote-debugging-port=9334 &`. Depois, com `scripts/devtools.mjs`:
   - `node scripts/devtools.mjs paginas` lista as janelas do app (`--todos` inclui as webviews do Navegador, que são os
     sites da pessoa: não recarregue uma delas); o admin abre no seletor e **não tem máquina em "Este Mac"**: para a
     janela do Mac local use o cliente `meu-bot`.
   - `node scripts/devtools.mjs eval "<título>" "<JS>"` avalia no renderer e imprime o valor. Ninguém clica: navegue
     pelo DOM. Seletor: `document.querySelector("button[data-tipo=mac]").click()` → a `.row` visível → `#pk-open`.
     Janela: `#tutoriais-line`, cartões `#tutoriais-list .tut-card` (botão "Começar"/"Continuar"), guia
     `.guide-panel li.current .tut-step`; paleta: clique em `#btn-palette`, valor em `#palette-input` + evento
     `input`, clique no `li` (os itens só existem depois de abrir a paleta de verdade).
   - `node scripts/devtools.mjs console "<título>"` recarrega a página e junta por 12 s erros e avisos do console do
     renderer (é como se vê "passos de tutorial sem tela" e "fontes do guia sem registro").
   Limites: `import()` dinâmico de módulos do asar falha (só DOM); ao terminar, feche e reabra o app sem a porta.
   Com Acessibilidade liberada (Ajustes do Sistema › Privacidade e Segurança › Acessibilidade), `osascript` com
   `System Events` (`keystroke`, `click at {x, y}`) também serve; sem ela o `keystroke` não falha, mas o texto não
   chega ao app, então confira com uma captura depois de cada passo.
3. **Conferir o resultado esperado** na captura (o botão novo, a tabela no lugar, a mensagem de sucesso) e no log.
4. Não conseguiu navegar até lá: diga ao usuário onde clicar e o que ele deve ver, e confira pela captura depois que
   ele clicar.

Ações de verdade (apagar, criar usuário, instalar) só com o pedido do usuário: o teste é ver, não mexer em máquina.

## Ver um ramo no meu-bot-staging (sem trocar o instalado)

O `meu-bot-staging` instalado (`~/Applications` ou `/Applications`) é o da release, notarizado, e é ele que a release
automática confere para promover a estável (`scripts/release-saude.mjs`). `npm run dist:staging` instala um build local
em `~/Applications`, por cima: a prova de saúde passa a dizer "build local" e a estável não sai. Para ver um ramo ou
uma PR no staging, o build roda **de fora**, sem instalar:

1. **Worktree próprio no commit**, não o da sessão que está mexendo no ramo (ela pode estar no meio de uma edição):
   `git worktree add --detach ../meu-bot-ver-<n> origin/<branch>`, com os links e as cópias da skill `contribuir`
   (`node_modules`, `extensao-crm/node_modules`, `build/extensao-autenticador`, os dois `config/google-*.json`).
2. **Empacotar sem instalar**, de dentro do worktree:
   ```bash
   npm run build && npm run build:extensao
   node scripts/package.mjs --variant client-staging --plataforma darwin
   node scripts/fuses.mjs --variant client-staging --plataforma darwin --no-install
   ```
   O app sai em `out/meu-bot-staging-darwin-arm64/meu-bot-staging.app`. Confira que é o seu:
   `grep -a -c <símbolo novo> <app>/Contents/Resources/app.asar` e o commit em `Contents/Resources/build.json`.
3. **Fechar o instalado** (passo 2, acima) e **lançar o binário direto**:
   `(nohup "<worktree>/out/meu-bot-staging-darwin-arm64/meu-bot-staging.app/Contents/MacOS/meu-bot-staging" >/dev/null 2>&1 &)`.
   `open <caminho do .app>` não serve: em 25 nov 2026 ele abriu a cópia de `/Applications`, que tem o mesmo bundle id.
4. **Conferir que é o build do ramo**: a ferramenta `app` do app-mcp devolve a versão sem `-staging.<n>` (ex.: `1.2.3`)
   e a faixa de depuração mostra o commit; `print_janela` captura a tela. `ps` mostra o caminho do binário.
5. **Voltar ao da release** quando a pessoa terminar de ver: fechar, `open /Applications/meu-bot-staging.app` (ou o de
   `~/Applications`) e `git worktree remove --force ../meu-bot-ver-<n>`. Com o app aberto a partir do worktree, não o
   apague. Diga à pessoa que o build aberto é local e não notarizado, e que o instalado não mudou.

## 6. Avisar

Em pt-BR, em poucas linhas: o que foi rebuildado, se abriu sem erro, o que a tela mostrou (com o resultado esperado
ao lado) e o que não deu para conferir.
