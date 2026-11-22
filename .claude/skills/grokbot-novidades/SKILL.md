---
name: grokbot-novidades
description: Traz para o meu-bot o que há de novo no Grok Bot e mantém a numeração alinhada — lê o relatório do vigia (scripts/grokbot-vigia.mjs), tria cada novidade (o meu-bot já tem? vale trazer? não é para nós?) e abre uma issue pequena por melhoria aprovada. Use quando o usuário disser "o que tem de novo no Grok Bot", "o Grok Bot atualizou", "alinha com o Grok Bot", "traz as novidades", "estamos atrás do Grok Bot?", "qual número a próxima estável leva", ou quando existir uma issue "Grok Bot X: o que mudou desde a Y" sem triagem.
---

# Novidades do Grok Bot → meu-bot

O meu-bot nasceu do Grok Bot e acompanha as versões dele (`docs/guia/app.md`, "Vigia do Grok Bot"). O vigia
**identifica** o que mudou; esta skill é a **triagem** e o encaminhamento. Nada do código, dos textos ou das marcas do
Grok Bot é copiado: a impressão serve de pauta, e cada melhoria é reescrita para quem usa o meu-bot.

## 1. Ver o estado

No checkout do meu-bot (qualquer worktree no `origin/main`):

```
node scripts/grokbot-vigia.mjs --check
```

Mostra a versão do Grok Bot instalada neste Mac, as impressões guardadas, a última estável do meu-bot e **o número
que a próxima estável deve levar** (`proximaEstavel`: o do Grok Bot quando ele está à frente; senão o nosso patch
seguinte). Decisão "versão nova" ou "ainda não foi relatada": rode `--run` (tira a impressão, escreve o relatório e
abre a issue "Grok Bot X: o que mudou desde a Y", com `sem-claude`). O agente do launchd faz isso sozinho a cada hora
quando instalado (`--instalar`; confira com `launchctl list | grep grokbot-vigia`).

Falta a impressão da versão anterior (Mac novo, pasta apagada)? `--impressao <app.asar|pasta> <versão>` guarda a de
um instalador antigo; `--relatorio <de> <para>` reescreve o relatório.

## 2. Triar o relatório

Abra a issue do relatório (`gh issue list -R diegofornalha/meu-bot --search "Grok Bot in:title" --state open`) ou o
arquivo em `~/Library/Application Support/meu-bot-grokbot/relatorio-<de>-para-<para>.md`. Para **cada grupo** de textos
novos e cada opção nova das Configurações:

1. **O meu-bot já tem?** Procure pelo comportamento, em português, não pela frase em inglês:
   `git grep -il "<termo em pt-BR>" origin/main -- src conta-api/src`. O meu-bot costuma ter o recurso com outro nome.
2. **Vale para quem usa o meu-bot?** O público é o dono de pequeno negócio que atende pelo WhatsApp. Planos, cobrança,
   marcas e integrações de equipe do Grok Bot (Slack, Teams, SSO) quase nunca valem.
3. **Classifique:** `já tem` · `vale trazer` · `não é para nós` · `ver depois` (precisa de decisão de produto).

Responda ao usuário com uma tabela curta (novidade, classificação, por quê) e **peça o ok** para as de `vale trazer`.
Não abra issue de implementação sem esse ok: toda issue sem `sem-claude` aberta por `diegofornalha` é implementada
sozinha pelo "Claude automático".

## 3. Encaminhar o que foi aprovado

- Uma issue por melhoria, pequena, **sem** `sem-claude`: o que acontece hoje no meu-bot, o comportamento esperado em
  linguagem de quem usa, onde mora no código (arquivo e função) e como conferir. Cite a issue do relatório
  (`Vem de #N`). Ponha no quadro (skill `quadro`).
- O que ficou em `ver depois` vira cartão rascunho em "Esperando você", com a pergunta exata.
- Comente na issue do relatório a tabela final e feche-a: a pauta daquela versão está triada.

## 4. Numeração

A base do `main` (`package.json`) deve ser o número que o `--check` indica. Se o agente da release subiu a base para
outro número (ele ainda sobe o minor depois de cada estável), corrija por PR **antes** de sair a primeira staging dessa
base: depois que uma `-staging.N` de número maior foi publicada, descer a base rebaixa quem a instalou. Pause o agente
só pelo tempo do PR (`launchctl bootout gui/$(id -u)/com.meu-bot.release-auto`), avise as outras sessões e religue
(`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.meu-bot.release-auto.plist`); confira com
`launchctl list | grep release-auto` (em 17/11 o agente ficou cinco dias fora sem ninguém notar, issue #460).

## Regras

- O relatório é pauta, não especificação: nunca copie frases, nomes de produto ou ícones do Grok Bot para o meu-bot.
- Só as listas da impressão ficam no disco; não guarde nem commite o pacote extraído do Grok Bot.
- Ao terminar, diga em pt-BR: a versão do Grok Bot, o que já temos, o que vai ser trazido (com os números das issues)
  e o número da próxima estável.
