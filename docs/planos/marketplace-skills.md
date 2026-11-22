# Marketplace de skills e módulos: um repositório por item

Plano aprovado pelo dono em 22 nov 2026. Este arquivo é o registro do desenho e do andamento; o que entrar no código
aponta para cá. As ferramentas (MCP) têm o plano delas em `ferramentas.md`.

## Três tipos no Marketplace

- **Módulo** é um produto completo, com regras e fluxo próprios (Finanças, os módulos do Diego). Mora na página Módulos.
- **Ferramenta** é a conexão do agente com um app por um conector (MCP) já integrado ao meu-bot. Mora na página
  Ferramentas.
- **Skill** é uma pasta com um `SKILL.md` (e, se precisar, scripts) que ensina o agente a fazer uma tarefa. Mora no
  Acervo.

Skill e módulo ficam cada um num repositório próprio do GitHub.

## Por quê

Hoje uma skill só chega à máquina dentro de uma release do app, levada pelo instalador de um componente (a
`whatsapp-grupos` vai com a guarda). Corrigir uma skill exige release e reinstalação, e ninguém de fora consegue trazer
a sua. Os módulos já vêm por git, mas num repositório por produto e sem commit fixado. Com um repositório por item, cada
skill e cada módulo tem versão, histórico e acesso próprios, e a pessoa usa o que ela mesma fez.

## Decisões do dono

- Três tipos no Marketplace: módulo, ferramenta e skill. Skill e módulo: um repositório GitHub por item.
- Importar a própria skill pelo link do repositório é de graça. Paga quem compra a skill de outra pessoa.
- A skill importada pode ser colocada à venda pelo próprio criador.
- Item de criador de fora é assinatura mensal, o fluxo que a AbacatePay já tem aqui.
- Repasse ao criador manual no começo: o site registra cada venda e o fechamento do mês sai por Pix.
- Revisão: o Claude revisa e o dono aprova antes de publicar. Atualização passa pela revisão de novo.
- Criador de fora vende skills e módulos. Ferramentas continuam com a curadoria do dono.

## Desenho

### O repositório

- **Skill:** `SKILL.md` na raiz, com `name` e `description` no cabeçalho (como a `backend-colima/skills/whatsapp-grupos`),
  e, opcional, a pasta `scripts/`. Nada além disso é exigido para importar; a ficha de venda é preenchida no app.
- **Módulo:** o `modulos.json` de hoje (`parseManifesto`, `src/main/modulos/modulos-core.ts`), com um módulo só.

### Importar pelo link (app)

- O download roda na máquina da janela, com o GitHub que a pessoa conectou nela (passo `conta-github` do tutorial), e
  por isso repositório privado funciona. Reaproveita de `src/main/modulos/modulos-fonte-core.ts`: `repoValido`,
  `cloneArgs`, `ambienteGit`, `lerResultado` e `commitArgs`. Falta, e entra aqui: baixar um commit específico.
- Antes de instalar, a tela mostra nome, descrição, arquivos e commit. A skill roda com as permissões do agente e, por
  este caminho, não passa por revisão: a pessoa instala por conta própria e vê o que está aceitando. Repositório sem
  `SKILL.md` válido é recusado, com a mensagem dizendo o que falta.
- A instalação usa a biblioteca que já existe, `skill_semente` (`backend-colima/skills-lib.sh`): põe em
  `~/.claude/skills` e `~/.hermes/skills` e preserva o que o agente editou. Falta o destino do OpenClaw
  (`<workspace>/skills`, como em `objetivo-core.ts`), que entra na biblioteca.
- Registro na máquina: `~/.local/share/meu-bot/skills/<nome>/origem.json`, com `url`, `commit`, `em` e `origem` (link ou
  marketplace). Atualizar é um clique da pessoa; nada muda sozinho quando o repositório muda.
- Tela: o Acervo, que hoje lista skills só para leitura, ganha "Importar pelo link" e as seções "Minhas skills" e "Do
  Marketplace", com Atualizar, Remover e "Colocar à venda".

### Vender (site, `conta-api`)

- `TipoItem` ganha `skill` (`marketplace-core.ts`). Junto mudam `itensDoMarketplace`, o mapa `TIPO` e
  `caminhoDeContratar` (`marketplace-pagina.ts`) e o estado do item no console (`public/console/plano-core.js`).
- O catálogo de skills e de módulos de criadores fica em tabela, não em arquivo, porque precisa aceitar envios. Nome
  técnico `skill-<slug>`.
- Cobrança pelo checkout de assinatura que já existe (`postAssinatura`, `rotas/pagamentos.ts`), com o mesmo webhook e o
  mesmo cancelamento. É o trabalho da fase 1b das Ferramentas (`ferramentas_pagas`): uma tabela só de itens pagos serve
  aos dois.
- Entrega: na aprovação, o site guarda o pacote do commit aprovado, e a máquina com a skill na licença baixa do site. O
  comprador não precisa de acesso ao repositório, e o criador não muda o que já foi aprovado.
- Licença: a skill comprada entra no `licenca-conta.json` assinado. Hoje só passam nomes `meu-bot-*`
  (`PRODUTO_NOME_RE`, `backend-colima/licenca.js`); as skills ganham um campo próprio, com slug e commit.

### Criadores de fora

- "Colocar à venda" envia repositório, commit, ficha e preço. O app do criador manda o pacote do commit que ele já
  testou na própria máquina. O item fica "em revisão" até a revisão do Claude e a aprovação do dono no console.
- Cada venda grava quanto cabe ao criador. O console mostra o fechamento do mês para o repasse por Pix.

## Fases

| Fase | O que entrega | Estado |
|---|---|---|
| 0 | Este plano | feito |
| 1 | Importar skill pelo link, de graça: baixar com commit fixado, prévia, instalar nos três agentes, atualizar e remover; Acervo com "Minhas skills" | a fazer |
| 2 | Skills do dono à venda: tipo `skill`, catálogo em tabela, checkout, webhook, cancelamento, licença e entrega do pacote aprovado; uma skill oficial como piloto | depende da fase 1 e da fase 1b das Ferramentas |
| 3 | Criadores de fora: "Colocar à venda", revisão do Claude com aprovação no console, registro de vendas e fechamento mensal | depende da fase 2 e da comissão definida |
| 4 | Módulos como itens individuais: um repositório por módulo e a lista de add-ons vinda do catálogo (hoje `ADDONS` é fixa em `variant-core.ts`, com cópia em `licenca.js`) | depende da fase 2 |

## O que depende do dono

1. A comissão do Marketplace por venda. Trava só a fase 3.
2. Onde ficam os repositórios das skills oficiais: na conta `diegofornalha` ou numa organização.
3. Se importar pelo link exige o Pro ou vale no plano gratuito.

## Fora do escopo

- Ferramenta (MCP) de terceiro.
- Compra única e divisão automática de pagamento. Ficam para depois do repasse manual.
- Tirar a `whatsapp-grupos` do app: a guarda e o app dependem dela no caminho atual. À parte, há um furo a corrigir: os
  arquivos dela não estão em `COMPONENTES`, então mudar só a skill não obriga a subir a versão da guarda.
