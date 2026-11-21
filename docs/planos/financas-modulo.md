# Finanças vira módulo; o repo do meu-bot fica só com o meu-bot

O acompanhamento é pela issue #312 (quadro, Project #6). O plano foi aprovado em 17/11/2026.

## Por quê
O padrão passa a ser um só. O repo `meu-bot` gera só o app meu-bot (e o inspector, por enquanto), e cada add-on vira
**módulo em repo próprio**, como o `meu-bot-diego` (sendfy-mcp, salvy-mcp). O Finanças é o primeiro, porque é o add-on
pago (`ABACATEPAY_ADDONS` no `conta-api`). Variante em branch longa está fora: foi assim que a `app-diego-staging` se
perdeu. O inspector fica na main até terminarem os testes dele.

## Decisões de 17/11
- O repo `meu-bot-finance` é **público**. O código do Finanças já é público aqui e quem trava o uso é a licença. O
  `meu-bot-diego` continua privado.
- O campo `dados` no `modulos.json` (backup) saiu: o backup no Drive já leva `finance/db` (`CONJUNTOS_DADOS`,
  `src/main/google/google-core.ts`), e o módulo grava os dados na mesma pasta.
- O `produto` por módulo saiu: o repositório do Finanças tem o `produto` dele no topo.

## Etapas
### 0. Âncora
Issue #312, cartão no quadro e este arquivo.

### 1. O sistema de módulos aprende o que falta
- **1A, módulos pela licença (`modulos-pagina-e-licenca`):** `Addon.modulos` em `ADDONS`. A página Módulos aparece em
  qualquer app de cliente quando um add-on com `modulos` está na licença da máquina, e o app mostra uma lista por
  produto (`produtosDeModulos`, `modulos-fonte-core.ts`). O `produto` do `modulos.json` precisa ser o do repositório.
- **1B, página do módulo:** o campo `pagina` no `modulos.json` traz `{rotulo, porta, caminho}`.
  - O `instalar.sh` sobe um serviço web na máquina, só em `127.0.0.1:<porta>`.
  - O app abre um túnel SSH com `ensureForwardExtra`, no molde do Computador.
  - A página aparece num `<webview>` com partição `modulo-<id>-<host>`, sem preload, com sandbox e sem IPC, no molde do Inspector.
  - Um ramo novo em `will-attach-webview` (`windows.ts`) recusa o que não for permitido; hoje uma partição desconhecida passa sem conferência.
  - Um token por instalação vai na URL, para que outro processo do Mac não use a porta.

### 2. Repo `meu-bot-finance`, módulo `financas`
- **Serviço próprio na máquina**, com a API `/v1/finance/*` (vinda de `finance-api.js`, `finance-modelo.js` e
  `finance-store.js`) e a página web (a `finance-page.ts` refeita com `fetch`). A licença é conferida no serviço, com a
  licença assinada.
- **Mudam-se para o módulo:** o plugin OpenClaw, a skill e as pontes com o CRM (que passam a usar a API do CRM).
- **Dados:** ficam em `~/.local/share/meu-bot/finance/db`, sem migração. O `desinstalar.sh` nunca apaga `db/`.
- **Ficha:** categoria, exemplos, o guia (vindo do tutorial 12), os passos e o `testar.sh`.

### 3. Os dois lado a lado (teste real)
- Ligar o módulo numa máquina de teste e conferir os dados antigos, o WhatsApp, o fechamento do mês, a planilha, a Curva ABC e o backup.
- O `instalar.sh` desliga o plugin antigo, para não haver duas escritas, e o `desinstalar.sh` o religa.
- Só segue com o OK do usuário. Aqui o `modulos: true` do `meu-bot-finance` é ligado.

### 4. O meu-bot tira o Finanças antigo (`financas-sai-do-app`)
> **Feita em 21/11**, com o OK do usuário ("finanças tem que sair do app, ficar só via módulo"). Diferenças para a lista
> abaixo: os rótulos de auditoria `finance.*` ficaram (o registro das máquinas guarda linhas antigas com eles) e o
> backend responde `409 finance_modulo` em `/v1/finance/*`, para um plugin antigo ainda instalado dizer onde o
> Financeiro está.
- **Sai:**
  - a página, os 21 canais `finance:*` e o preload;
  - `finance-local.ts`, `assertFinance`, `installFinance` e `ensureFinanceAtual`;
  - `finance-*` e as pontes no `backend-colima`, e `install-finance.sh`;
  - o tutorial 12, os rótulos de auditoria e o CSS;
  - a variante `finance-staging`: `PRODUTOS`, `dist:finance-staging`, `STAGING_APPS`, `release*.mjs`, `rebuild-auto.sh`, `mcp-fumaca.sh`, `auditoria.py`, o ícone e os testes;
  - nos docs e skills, o que cita o app.
- **Fica:** `meu-bot-finance` em `ADDONS` (app e backend) e no `conta-api`, porque é o que se compra e agora libera o módulo.

### 5. Arrumação
- Remover o `meu-bot-finance-staging.app` instalado, com o OK do usuário.
- Fechar a #312.

## Verificação
- **Etapas 1 e 4:** `npm test` e `npm run typecheck` sem falhas, e CI verde.
- **Etapa 2:** os testes do repo do módulo (servidor falso; token errado recusado).
- **Etapa 3:** na tela, com o usuário, numa máquina de verdade.
