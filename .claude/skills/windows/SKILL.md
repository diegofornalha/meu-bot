---
name: windows
description: Prova o meu-bot num Windows x64 de verdade pelo workflow "Windows" do GitHub Actions (instala, abre no modo de fumaça, confere o relatório e as capacidades, sobe log e print da tela). Use quando uma mudança pode afetar o Windows (empacotamento, instalador, arranque, seletor, `capsFor`, túnel/SSH, atualizador), quando alguém que usa o Windows relatar um problema ou abrir uma issue ("no Windows não abre", "no meu PC dá erro"), ou quando o usuário pedir "testa no Windows", "confere no Windows", "reproduz no Windows".
---

# Windows: provar no runner do GitHub

Não há Windows neste Mac. A prova é o workflow **Windows** (`.github/workflows/windows.yml`, `windows-latest`, x64,
grátis, sem segredos): instala o `meu-bot-staging` (fica em `%LOCALAPPDATA%\Programs\meu-bot\meu-bot-staging.exe`), abre no **modo de fumaça** (`MEU_BOT_FUMACA=<arquivo>`,
`src/main/app/fumaca-core.ts`), confere o relatório (`scripts/fumaca-conferir.mjs`) e sobe o artefato
`windows-fumaca`. Roda sozinho em todo PR e push na `main`; o check é informativo (não segura o merge).

Prefixe os comandos com `export PATH="$HOME/.local/bin:$PATH"`; `R=diegofornalha/meu-bot`.

## Quando e qual modo

| Situação | Modo | Comando |
|---|---|---|
| Mudança sua que pode afetar o Windows | **do código** (empacota o ref) | já roda no PR; à mão: `gh workflow run windows.yml -R $R --ref <branch>` |
| Relato de quem usa o Windows | **de uma release** (o instalador que a pessoa recebeu) | `gh workflow run windows.yml -R $R -f release=<tag>` (ex.: `v1.2.0-staging.8`) |

No relato, a versão exata é a da pessoa (está no título da janela do staging e em Configurações → Sobre): a tag é
`v<versão>`. Só as releases staging têm instalador Windows (`gh release view <tag> -R $R --json assets --jq '.assets[].name'`
mostra o `…-x64-setup.exe`). Depois de reproduzir e corrigir, a prova da correção é o modo do código no PR.

## Disparar, esperar, baixar

```bash
gh workflow run windows.yml -R $R -f release=v1.2.0-staging.8        # ou: --ref <branch>, sem -f
sleep 5; ID=$(gh run list -R $R --workflow windows.yml -L 1 --json databaseId --jq '.[0].databaseId')
gh run watch $ID -R $R --exit-status                                  # uns 2 min (release) a 8 min (código)
gh run view $ID -R $R --log-failed                                    # se ficou vermelho: o passo e a mensagem
gh run download $ID -R $R -n windows-fumaca -D <scratchpad>/win-$ID   # o artefato sobe mesmo quando falha
```

O resumo legível está na página da rodada (`gh run view $ID -R $R --web`, ou
`gh api repos/$R/actions/runs/$ID/jobs --jq '.jobs[].steps[]|"\(.conclusion) \(.name)"'` para os passos).

## Ler o que voltou

- **`relatorio.json`** (o app escreveu): `ok`, `versao`, `plataforma` (`win32`), `variante`, `caps` (o que o app
  calculou), `janela` (`arquivo: picker.html`, `carregou`), `erros` (exceção não tratada no main, promessa rejeitada,
  página ou preload que não carregou, prazo de 60 s) e `avisos` (erros do console das páginas; não reprovam).
- **A conferência** (passo "Conferir o relatório"): uma frase por coisa que não bateu. `capacidade "x": o app diz
  true, o contrato (capsFor) diz false` é o contrato do Windows: capacidade religada muda `capsFor`
  (`src/main/app/variant-core.ts`), o teste `scripts/tests/fumaca-core.test.mjs` e a prova, no mesmo PR.
- **`meu-bot.log`**: o log do app no Windows (`%APPDATA%\meu-bot-staging\meu-bot.log`), com as linhas `[fumaca]`,
  `[conta]`, `[tunnel]`, `[atualização]`. É onde aparece o motivo de verdade.
- **`tela.png`**: print da tela do runner com o app aberto por 20 s (abertura normal, sem fumaça e sem atualizador).
  Abra com o Read e diga o que mostra: o seletor no cartão de login é o esperado numa máquina sem conta.
- **`janelas.txt`** e **`pasta-de-dados.txt`**: os processos e títulos de janela na hora do print, e o que o app
  criou na pasta de dados.

**Release anterior ao modo de fumaça** (até a `v1.2.0-staging.8`): o resumo diz isso, não há `relatorio.json` nem
conferência; valem a instalação, o app de pé por 20 s com janela, o print e o log.

## Responder a um relato

Diga o que foi provado e o que não foi: "instalei a versão X num Windows x64 limpo, o app abriu e mostrou o seletor
(print), sem erro no log" não é "não há problema na máquina da pessoa". Se não reproduziu, peça o `meu-bot.log` dela
(`%APPDATA%\meu-bot-staging\meu-bot.log`) e o que ela fez antes do erro.

## Limites

- Sem tela interativa: ninguém clica. A fumaça prova instalar, abrir e carregar o seletor; não prova login, túnel com
  uma máquina, chat nem atualização.
- Máquina limpa a cada rodada: sem conta, sem `~/.ssh/config`, sem dados antigos. Problema que depende do estado da
  máquina da pessoa não aparece aqui.
- Só x64 e só o `meu-bot-staging` (o único produto marcado `windows`).
- O que precisa de olho (cliques, o túnel, o Navegador) fica para a VM local com Windows, que é outra etapa do plano.
- O modo de fumaça também existe no Mac (`MEU_BOT_FUMACA=<arquivo> <app>/Contents/MacOS/<app>`), mas a janela aparece
  e toma o foco: não rode com o usuário trabalhando, e nunca com `--user-data-dir` ao lado do mesmo app aberto sem
  necessidade. Nele o app não abre o navegador do sistema, não atualiza as máquinas e não sobe o controle local.
