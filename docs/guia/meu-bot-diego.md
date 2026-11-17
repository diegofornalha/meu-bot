# meu-bot-diego: produtos de módulos (whitelabel)

> Parte do diário técnico do meu-bot. Índice: [../GUIA.md](../GUIA.md).

## A ideia

Um **produto** é um meu-bot para uma pessoa ou um nicho (`meu-bot-<nome>`, o add-on na licença). Cada produto tem um
**repositório de módulos** (`https://github.com/diegofornalha/<produto>.git`, ou a URL de Configurações). Cada módulo traz
o que liga o serviço no agente da máquina (MCP, regras do turno) e a **ficha** que a página Módulos mostra. O app não leva
módulo nenhum dentro: baixa o repositório com git. Um nicho novo é um repositório novo e uma linha em `variant-core.ts`.

Hoje há um produto, o `meu-bot-diego`, e um app, o `meu-bot-diego-staging` (`npm run dist:diego-staging`; fora da
release automática: `release-core.mjs` deixa de fora os produtos com `caps.modulos`).

## Como o app pega os módulos (`src/main/modulos/`)

- `modulos-fonte-core.ts` (puro): URL válida (só https, ssh:// e git@; nunca opção nem `ext::`/`file://`), `git clone
  --depth 1` na primeira vez e `git pull --ff-only` depois, com as credenciais do usuário e sem prompt
  (`ambienteGit`). Sem acesso, a página só diz "sem acesso aos módulos"; sem rede, mostra os já baixados.
- `modulos.ts` (IO): a cópia fica em `<userData>/modulos-fonte/<produto>` e a origem em `<produto>.json`. Liga, desliga,
  grava credenciais e opções na máquina por SSH (contrato abaixo), testa a conexão e guarda o último teste no Mac
  (`<userData>/modulos-testes.json`, 0600). O seletor confere o repositório e reinstala os módulos ligados que
  subiram de versão.
- `backend-colima/modulos.js` (na máquina): monta os MCPs e as regras de cada turno a partir do `turno.json` de cada
  módulo ligado, trocando `${VAR}` pelas credenciais só no arquivo do turno (0600).

## Contrato do `modulos.json`

`{ produto: "meu-bot-<nome>", modulos: [ … ] }`. Cada módulo:

| campo | o que é |
|---|---|
| `id`, `rotulo`, `descricao`, `versao` (x.y.z) | identidade; subir a versão faz o seletor reinstalar onde está ligado |
| `pasta`, `instalar`, `desinstalar` | scripts na pasta (padrão `instalar.sh`/`desinstalar.sh`), rodados na máquina com `MODULO_ID`, `MODULO_DIR`, `MODULO_ENV`, `MODULO_OPCOES`, `MODULO_PRODUTO`, `MODULO_VERSAO` |
| `credenciais` | `{chave, rotulo, ajuda}`: coladas no app, gravadas em `~/.config/meu-bot/modulos/<id>.env` (0600), nunca voltam |
| `opcoes` | `{chave, rotulo, tipo: texto|numero|booleano, padrao, ajuda}`: salvar com o módulo ligado roda o instalador de novo |
| `gateways`, `requisitos` | só nesses motores do WhatsApp; avisos do que a máquina precisa |
| `categoria`, `exemplos` | a ficha: categoria e os pedidos de "O que dá para pedir" (vão ao chat do agente) |
| `guia` | `{ paraQue, cuidados: [], texto: [], completo }`: o link do guia completo só vale https |
| `testar` | script de teste (`testar.sh`): imprime `ferramenta\t<nome>\t<descrição>` por ferramenta e termina com `teste=ok` ou `teste=erro <motivo>` |
| `passos` | primeiros passos: `{ id, titulo, texto, conclui, botao, pergunta }`; `conclui` = `credenciais`, `ligado`, `testado`, `opcao:<chave>` ou `manual` |

Tudo da ficha é texto puro, cortado nos limites: o repositório é de fora, então a página nunca o trata como HTML.

## A página Módulos

Lista em cartões (inicial, nome, categoria, situação) e, ao abrir um, a ficha: cabeçalho com a situação e **Testar
conexão**; **O que dá para pedir**; abas **Visão geral** (configurar e ligar, a conexão e o guia em resumo),
**Ferramentas** (do último teste), **Guia** e **Primeiros passos** (concluídos pelo estado ou à mão, por máquina); e a
coluna **Detalhes** (situação, categoria, versão, acesso, onde roda, identificador e origem).
