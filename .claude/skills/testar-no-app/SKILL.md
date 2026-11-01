---
name: testar-no-app
description: Ciclo fecha → rebuilda → abre → testa de um app do meu-bot (meu-bot-admin, meu-bot, staging) neste Mac, conferindo na tela que a mudança funcionou. Use quando o usuário disser "rebuilda e testa", "abre e vê se deu certo", "testa no app", "simula se deu certo", "kill, rebuilda e abre", ou depois de uma mudança visual que precisa ser vista no app instalado.
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
| staging | `meu-bot-staging` | `npm run dist:staging` |

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
1. **Ver**: `osascript -e 'tell application "<app>" to activate'`, `screencapture -x <scratchpad>/tela.png`,
   `sips -Z 1600` para reduzir e Read na imagem. A captura funciona sem permissão extra.
2. **Navegar até a mudança sem Acessibilidade (o normal neste Mac): DevTools remoto.** Antes, confirme que o app
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

## 6. Avisar

Em pt-BR, em poucas linhas: o que foi rebuildado, se abriu sem erro, o que a tela mostrou (com o resultado esperado
ao lado) e o que não deu para conferir.
