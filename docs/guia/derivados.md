# Apps derivados

> Parte do diário técnico do meu-bot. Índice: [../GUIA.md](../GUIA.md).

## A regra

O repositório `meu-bot` é o **core**: o que está aqui serve a todo mundo. Um **derivado** é um meu-bot com nome, ícone,
dados e portas próprios, feito para uma pessoa ou um nicho. Ele mora no **repositório dele** e consome o core; não
acrescenta linha na tabela `PRODUTOS`, membro em `AppVariant` nem ícone em `assets/` (decisão do dono em 25 nov 2026).

- O derivado nunca altera o core por dentro. Se precisar de algo que o core não oferece, a melhoria entra no core
  primeiro, para todos.
- O que nascer num derivado e servir a todos sobe para o core, e o derivado passa a usar o do core.

Este guia cresce a cada etapa da saída dos derivados antigos (`meu-bot-diego-staging` e `meu-bot-inspector-staging`,
ainda na tabela). Por enquanto ele cobre a **ficha** e o **empacotamento**; a release automática, a atualização pelo
repositório do derivado e as páginas próprias vêm nas etapas seguintes.

## O que o repositório de um derivado tem

```
produto.json        a ficha do app
assets/icon.icns    o ícone (com o .svg de origem ao lado)
```

## A ficha (`produto.json`)

| campo | obrigatório | o que é |
|---|---|---|
| `nome` | sim | `meu-bot-<nome>`: minúsculas, dígitos e hífen, até 6 pedaços e 30 caracteres depois de `meu-bot-`. É o nome do `.app`, a pasta de dados, o esquema do deep link e o nome no servidor de contas |
| `bundleId` | sim | `local.meu-bot-<nome>` (ou com `.staging`); não muda depois de alguém instalar |
| `canal` | sim | por enquanto só `"staging"` |
| `portaLocal`, `portaWsl`, `portaMcp` | sim | 1024 a 65535, diferentes das dos apps do core e das dos outros derivados instalados no mesmo Mac |
| `herdaDe` | não | `null`, `"meu-bot"` ou `"meu-bot-staging"`: de onde a primeira abertura copia configurações, conversas e memória, uma vez só |
| `abreEm` | não | a página que fica na frente ao abrir: `"modulos"` (ou `null` para as conversas) |
| `modulos` | não | o produto de módulos fixo do app (`meu-bot-<nome>`): a página Módulos baixa o repositório dele |
| `addon` | não | o add-on do catálogo que é a razão do app |
| `releases` | não | `"dono/repositório"` do GitHub, público, onde saem as releases do app; é lá que o atualizador dele procura. Sem o campo, procura no repositório do core |
| `descricao` | não | uma frase, até 300 caracteres |

Campo que não está na tabela é recusado, para um nome trocado não passar calado. Um derivado é sempre um app da pessoa:
as capacidades são as do meu-bot, e a ficha não liga nada de administração. A validação é `parseFichaExterna`
(`src/main/app/variant-core.ts`); o teste do contrato é `scripts/tests/derivado-core.test.mjs`.

## Empacotar

De dentro de um checkout do core:

```bash
npm run dist -- --produto <pasta do repositório do derivado>
```

Faz o build, valida a ficha, empacota com o nome, o bundle id e o ícone dela, assina e instala em `~/Applications`.
Ficha recusada sai com o motivo e não empacota.

A ficha vai **dentro do asar** (`dist/main/app/produto-embutido.json`), não num arquivo solto em `Resources/`: a
integridade do asar a cobre. Ao abrir, o app a lê, registra o produto e passa a ser a variante `"derivado"`
(`src/main/app/variant.ts`); o `variant.json` de um derivado só diz `{"variant":"derivado"}`.

Em desenvolvimento: `MEU_BOT_PRODUTO=<pasta do derivado> npm start`.

## Atualização

O atualizador de um derivado consulta as releases do repositório da ficha (`releases`), com as mesmas regras do core:
tag `vX.Y.Z-staging.N`, asset `<nome>-<versão>-<arch>.zip` com o `.sig` ao lado. A confiança não muda com o
repositório: o zip tem de passar pela assinatura Ed25519 do core (`UPDATE_PUBLIC_KEYS`), ter o mesmo bundle id do app
aberto e ser assinado com o Developer ID do time. Publicar num repositório não basta para um app aceitar o que está lá.

## Conferir

- A ferramenta `app` do controle externo devolve o nome do derivado e `variante: "derivado"`.
- `npx asar list <App>.app/Contents/Resources/app.asar | grep produto-embutido.json` acha a ficha.
