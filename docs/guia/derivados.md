# Apps derivados

> Parte do diário técnico do meu-bot. Índice: [../GUIA.md](../GUIA.md).

## A regra

O repositório `meu-bot` é o **core**: o que está aqui serve a todo mundo. Um **derivado** é um meu-bot com nome, ícone,
dados e portas próprios, feito para uma pessoa ou um nicho. Ele mora no **repositório dele** e consome o core; não
acrescenta linha na tabela `PRODUTOS`, membro em `AppVariant` nem ícone em `assets/` (decisão do dono em 25 nov 2026).

- O derivado nunca altera o core por dentro. Se precisar de algo que o core não oferece, a melhoria entra no core
  primeiro, para todos.
- O que nascer num derivado e servir a todos sobe para o core, e o derivado passa a usar o do core.

O `meu-bot-diego-staging` já saiu do core (`github.com/diegofornalha/meu-bot-diego-app`). O `meu-bot-inspector-staging`
ainda está na tabela: ele tem uma página própria. O ponto de extensão para isso já existe
([Página própria](#página-própria-extensão)); falta reescrever o Inspector em cima dele e levar o código para o
repositório do derivado. Derivado novo nasce do modelo `github.com/diegofornalha/meu-bot-derivado-modelo`.

## O que o repositório de um derivado tem

```
produto.json        a ficha do app
assets/icon.icns    o ícone (com o .svg de origem ao lado)
codigo/main.ts      só se o app tem página própria: a parte do processo principal
codigo/pagina.ts    só se o app tem página própria: a parte da janela
codigo/…            os arquivos que esses dois importam (opcional)
```

## A ficha (`produto.json`)

| campo | obrigatório | o que é |
|---|---|---|
| `nome` | sim | `meu-bot-<nome>`: minúsculas, dígitos e hífen, até 6 pedaços e 30 caracteres depois de `meu-bot-`. É o nome do `.app`, a pasta de dados, o esquema do deep link e o nome no servidor de contas |
| `bundleId` | sim | `local.meu-bot-<nome>` (ou com `.staging`); não muda depois de alguém instalar |
| `canal` | sim | por enquanto só `"staging"` |
| `portaLocal`, `portaWsl`, `portaMcp` | sim | 1024 a 65535, diferentes das dos apps do core e das dos outros derivados instalados no mesmo Mac |
| `herdaDe` | não | `null`, `"meu-bot"` ou `"meu-bot-staging"`: de onde a primeira abertura copia configurações, conversas e memória, uma vez só |
| `abreEm` | não | a página que fica na frente ao abrir: `"modulos"`, ou `"extensao"` (a página própria; só com o campo `extensao`), ou `null` para as conversas |
| `extensao` | não | o app traz uma página própria: `{ "api": 1, "rotulo": "<texto do botão, até 30 caracteres>" }`, mais `"icone"` (um emoji ou símbolo, para o botão e a aba) e `"dica"` (o texto que aparece ao parar o mouse no botão, até 160 caracteres), os dois opcionais. Exige a pasta `codigo/` (e a pasta exige o campo). Ver [Página própria](#página-própria-extensão) |
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

## Página própria (extensão)

Um derivado pode trazer **uma** página dele: um botão na lateral, uma aba, e código que roda no processo principal e
na janela. É o ponto de extensão do core. O contrato tem versão (`DERIVADO_API`, hoje `1`, em
`src/main/app/variant-core.ts`): a ficha diz para qual foi escrita, e o core recusa a que pede outra ("este core fala a
API 1 de extensão; a ficha pede 2"), em vez de abrir um app com a página quebrada.

### Na ficha

```json
"extensao": { "api": 1, "rotulo": "Exemplo", "icone": "🧪", "dica": "Exemplo: o que a página faz, numa frase" },
"abreEm": "extensao"
```

| campo | obrigatório | o que é |
|---|---|---|
| `api` | sim | a versão do contrato para a qual o código foi escrito (hoje `1`) |
| `rotulo` | sim | o texto do botão da lateral: 1 a 30 caracteres, uma linha |
| `icone` | não | o glifo do botão e da aba: um emoji ou símbolo, até 8 caracteres, sem espaço, `<`, `>`, aspas nem barra invertida. Sem ele, o ✦ |
| `dica` | não | o texto que aparece ao parar o mouse no botão (o `title`): 1 a 160 caracteres, uma linha. Sem ela, o próprio rótulo |

O título da aba é o que o código passa ao `definePage`. O ícone e a dica entram na tela como texto (o `textContent` do
botão, a propriedade `title` e uma variável de CSS para a aba), nunca como HTML.

A página tem id fixo, `extensao`: é com ele que o alfinete (📌), o `abreEm` e a ferramenta `pagina_abrir` do controle
externo a abrem. Nas capacidades do app vira `caps.extensao = { rotulo, icone, dica }` (os dois últimos `null` quando a
ficha não os traz); em todo app da tabela `caps.extensao` é `null`.

### Os arquivos

Em `codigo/`, dois arquivos de entrada:

```ts
// codigo/main.ts: processo principal
import type { AtivarExtensao } from "meu-bot/extensao-main";
export const ativar: AtivarExtensao = (api) => {
  api.canal("eco", async (payload) => payload);
  return { encerrar: () => {} };
};
```

```ts
// codigo/pagina.ts: janela
import type { MontarExtensao } from "meu-bot/extensao-pagina";
export const montar: MontarExtensao = (api) => {
  const painel = document.createElement("section");
  painel.hidden = true;
  api.panelsEl.append(painel);
  const page = api.definePage("extensao", "Exemplo", painel, () => { /* pinta o painel */ });
  return { open: () => api.openPage(page) };
};
```

Um exemplo inteiro, que os testes do core compilam e carregam, está em `scripts/tests/fixtures/derivado-exemplo/`.

**Mais arquivos.** Os dois de entrada podem importar outros `.ts` da própria pasta `codigo/` (subpastas inclusive), por
caminho relativo, e esses podem importar outros:

```ts
// codigo/pagina.ts
import { zoomDaPagina } from "./zoom.js";
```

- **Escreva o import com `.js` no fim**, dos dois lados, mesmo o arquivo sendo `zoom.ts` (é como o core escreve os
  dele). Na janela é obrigatório: o compilado é um módulo ES carregado pelo navegador, que não adivinha a extensão, e
  o core recusa o import sem ela. No processo principal (CommonJS) funciona com e sem.
- **Cada lado leva só o que a entrada dele alcança.** Um arquivo importado pelos dois lados é compilado duas vezes,
  uma em cada formato, com os tipos de cada lado: só serve aos dois o que é puro (sem Node e sem DOM). Um arquivo que
  ninguém importa não é compilado e não vai para o app.
- **Ninguém sai de `codigo/`**: um import com `../` que aponte para fora da pasta é recusado.
- No processo principal, `codigo/index.ts` não pode existir e nenhum arquivo importa o `main.ts`: o `main.ts`
  compilado é o `index.js` que o app carrega.

É assim que a lógica pura de uma página ganha arquivo e teste próprios: o teste do derivado chama o `compilarCodigo`
de `scripts/derivado-codigo.mjs` para uma pasta temporária e importa o JavaScript de lá.

**O que `ativar` recebe** (`ExtensaoMainApi`, em `src/shared/ipc/derivado.ts`):

| o quê | para quê |
|---|---|
| `pastaDados` | pasta só da extensão, dentro dos dados do app (`<dados>/extensao`); o core não a cria |
| `log(linha)` | uma linha no log do app |
| `acharNode()` | o caminho do `node` deste computador, ou `null` |
| `controleRemoto.garantir()` | liga o controle externo (MCP) do app se ainda não está de pé; devolve `{ ok: true, porta, token, url }` ou `{ ok: false, erro }` |
| `canal(nome, handler)` | registra um canal que a página chama; nome `^[a-z][a-z0-9-]{0,40}$`, uma vez só, e só durante o `ativar` |
| `webview({ particao, urlPermitida })` | declara o único `<webview>` da página: partição `ext-<nome>` (sempre em memória) e a URL que ele pode carregar |

Devolve `{ encerrar() }`, chamado ao sair do app. O `ativar` não inicia nada (processo, timer, servidor) que o
`encerrar` devolvido não pare: se a ativação falhar depois de ele devolver, o core chama esse `encerrar` na hora; se ele
não devolver `{ encerrar }`, a extensão conta como não carregada e não há por onde parar o que ficou de pé. O que demora
ou pode falhar fica para um canal, chamado quando a página abre.

**O que `montar` recebe** (`ExtensaoPaginaApi`, em `src/renderer/extensao/api.ts`): `panelsEl`, `definePage` (só com o
id `"extensao"`, uma vez), `openPage`, `invocar(nome, payload)` (chama um canal do `ativar`), `zoomFactorNow()` e
`aoMudarZoom(ouvinte)`. Devolve `{ open() }`.

A página não traz CSS: ela usa as classes do app (`acervo-panel` no painel, `btn`, `hint`, as da página Computador
para um `<webview>` que ocupa o painel…). Essas classes não têm versão no contrato; quem muda uma delas no core confere
os derivados que têm página.

A página fala com o processo principal por um canal IPC só, `ext:invoke`, que leva `{ nome, payload }` e despacha para
o handler registrado. Sem extensão no app, ou com um nome que ela não registrou, o canal recusa. O payload chega cru
ao handler: validar é dele.

O `<webview>` declarado tem as proteções do Inspector: sem preload, em sandbox, sem `nodeIntegration`; só anexa na
partição declarada e com URL http(s) que `urlPermitida` aceita; depois de carregar, só navega dentro da origem em que
está; link `https` para fora abre no navegador do sistema.

### O que é proibido

- Importar qualquer coisa do core em tempo de execução. Só `import type` dos dois nomes do contrato
  (`meu-bot/extensao-main`, `meu-bot/extensao-pagina`); o resto chega por argumento. Fora os arquivos da própria
  `codigo/`, no processo principal entram só os módulos do Node, com o prefixo (`node:fs`, `node:child_process`…); na
  janela, mais nada. `import()` dinâmico não é aceito em nenhum dos dois.
- Dependências npm próprias: `package.json` e `node_modules` em `codigo/`, ou em qualquer subpasta dela, recusam o
  empacotamento.
- Preload, canal IPC com nome próprio e mais de uma página ou de um `<webview>`: não existem no contrato.
- Link simbólico em `codigo/` (a pasta, um arquivo ou uma subpasta) e import que sai dela: o que se compila é o que
  está no commit.
- `extensao` na ficha sem `codigo/`, ou `codigo/` sem `extensao`: recusa.

Se a página precisa de algo que a API não dá, a melhoria entra no core, para todos (a regra do começo deste guia).

Essas regras conferem o contrato; **não são uma caixa de areia**. O `codigo/main.ts` roda no processo principal, com
os poderes do app. O que protege quem instala é a leitura do código: **código de derivado só é empacotado para
release no commit que o dono do Mac da release leu e aprovou** (a regra do commit aprovado, `recusaCommitDoDerivado`
em `scripts/release-core.mjs`). Num checkout do core em que essa regra ainda não entrou, o `scripts/package.mjs`
recusa empacotar com `--versao` (uma release) um derivado que tem `codigo/`.

### Como o código chega ao app

Não há plugin solto: os fuses do app só deixam carregar código de dentro do asar, e a integridade do asar o cobre. Por
isso é o **core** que compila o código do derivado, no empacotamento (`scripts/derivado-codigo.mjs`, chamado pelo
`scripts/package.mjs` quando `--produto <pasta>` tem `codigo/`):

- os `.ts` de `codigo/` são copiados para uma pasta temporária e compilados com o `tsc` e o rigor do core, uma vez
  por lado; nada é escrito em `src/` nem no repositório do derivado;
- saem `dist/main/derivado/` (CommonJS; a entrada é `index.js`, o `main.ts` compilado) e `dist/renderer/derivado/`
  (módulos ES; a entrada é `pagina.js`), cada pasta com os arquivos que a entrada dela importa, e vão no asar;
- as duas pastas são apagadas antes de empacotar **qualquer** app e de novo ao terminar, como a ficha embutida: o
  código de um derivado nunca vai no pacote de outro.

Ao abrir, o app com `extensao` na ficha carrega o `index.js` e chama `ativar` (`src/main/extensao/extensao.ts`); a
janela importa o `pagina.js` e chama `montar` (`src/renderer/extensao/extensao.ts`). Código que falta, que lança ao
carregar ou ao ativar fica no log, e **o app abre sem a página**: a extensão não derruba o app.

Em desenvolvimento, depois do `npm run build` (que apaga `dist/`):

```bash
node scripts/derivado-codigo.mjs <pasta do derivado>
MEU_BOT_PRODUTO=<pasta do derivado> npm start
```

O teste do contrato é `scripts/tests/derivado-extensao.test.mjs`.

## Atualização

O atualizador de um derivado consulta as releases do repositório da ficha (`releases`), com as mesmas regras do core:
tag `vX.Y.Z-staging.N`, asset `<nome>-<versão>-<arch>.zip` com o `.sig` ao lado. A confiança não muda com o
repositório: o zip tem de passar pela assinatura Ed25519 do core (`UPDATE_PUBLIC_KEYS`), ter o mesmo bundle id do app
aberto e ser assinado com o Developer ID do time. Publicar num repositório não basta para um app aceitar o que está lá.

## Release

A release de um derivado é automática e roda no Mac que publica o core (a chave da release e o Developer ID estão no
Chaveiro dele). Depois de cada release staging do core, o agente (`scripts/release-auto.mjs`) chama
`scripts/release-derivados.mjs`, que para cada derivado da lista:

1. leva o clone ao ramo padrão do repositório do derivado e valida a ficha;
2. confere que a ficha manda procurar as releases no mesmo repositório onde vai publicar (`releases`);
3. empacota contra o core recém-publicado, com a **mesma versão** dele (`X.Y.Z-staging.N`), assina, notariza, zipa e
   assina o zip com a chave da release;
4. publica com `gh release create -R <repositório do derivado>`: `<nome>-<versão>-<arch>.zip` e o `.sig`.

A lista fica **fora do repositório do core**, em `~/Library/Application Support/meu-bot-release/derivados.json`:

```json
[ { "repo": "dono/meu-bot-x", "pasta": "/caminho/do/clone/do/derivado" } ]
```

- A pasta é um clone só do agente; mudança local nele é recusada.
- O que já foi publicado é pulado: rodar de novo não repete nada.
- A falha de um derivado não impede os outros nem desfaz a staging do core; o Mac avisa uma vez por versão.
- **Um derivado não fica para trás:** enquanto a versão dele não alcança a staging do core, o agente tenta de novo a
  cada rodada (10 min), sem esperar a próxima staging. Com tudo em dia a rodada só confere as tags: não empacota nem
  pede a chave. O aviso de falha diz a causa (a última linha de erro do script). A nova tentativa só roda com o
  worktree da release no commit da staging: se um merge novo entrou no `main`, quem refaz os derivados é a staging
  seguinte, que sai em 10 minutos.
- **Uma mudança no core não quebra a ficha de um derivado calada:** `scripts/tests/derivado-core.test.mjs` guarda as
  fichas já publicadas e falha na PR do core que as recusaria. Ao publicar um derivado novo com um campo que nenhuma
  ficha guardada usa, acrescente a ficha dele a esse teste.
- Uma mudança só na ficha do derivado sai na próxima staging do core, ou à mão:
  `node scripts/release-derivados.mjs --versao <versão staging já publicada do core>` não republica a mesma tag, então
  espere a próxima.
- `node scripts/release-derivados.mjs --conferir` diz o que publicaria, sem empacotar, sem pedir a chave e sem publicar.

### Commit aprovado

Quem tem permissão de escrita no repositório de um derivado listado faz o Mac publicar um app assinado com o que está
lá. Para um derivado **só de ficha e ícone** isso é pouco: a ficha escolhe nome, portas e páginas do core, não traz
código. Proteja o ramo padrão do repositório e pronto.

Um derivado que traz **código próprio** (a pasta `codigo/`) é outra coisa: esse código é compilado, assinado com o
Developer ID e distribuído por atualização automática. Por isso ele só sai do commit que o dono do Mac leu e aprovou,
escrito na lista:

```json
[ { "repo": "dono/meu-bot-x", "pasta": "/caminho/do/clone", "commit": "<o hash inteiro do commit aprovado>" } ]
```

- Com `commit`, o agente empacota exatamente esse commit, não o ramo padrão. Código novo no repositório fica esperando.
- Derivado com `codigo/` e sem `commit` na lista é recusado, e a mensagem já traz a linha a escrever.
- Aprovar uma versão nova do código é ler o diff no repositório do derivado e trocar o hash na lista.

## Conferir

- A ferramenta `app` do controle externo devolve o nome do derivado e `variante: "derivado"`.
- `npx asar list <App>.app/Contents/Resources/app.asar | grep produto-embutido.json` acha a ficha.
- Com página própria: o mesmo `asar list` com `grep /derivado/` mostra `dist/main/derivado/index.js` e
  `dist/renderer/derivado/pagina.js` (e os arquivos que eles importam), e o log do app traz
  `[extensão] ativa: canais …`.
