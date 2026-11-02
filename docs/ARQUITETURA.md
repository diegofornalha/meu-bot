# Arquitetura do meu-bot (mapa para manutenção)

O app é organizado por **domínio**: cada pasta é dona de um assunto, com as regras puras (`*-core.ts`, testadas com
`node --test`) separadas do IO (SSH, Electron, rede). Ao mexer num assunto, comece pela pasta dele.

## Processo principal (`src/main/`)

| Pasta | Do que é dona |
|---|---|
| `main.ts` | Arranque: instância única, menu, seletor, túneis, registro dos IPC (raiz de composição) |
| `app/` | Janelas, menu, settings, variantes do produto, userData, zoom, atalhos, entrada rápida, internet, processos filhos |
| `maquina/` | Máquinas por SSH: túnel, backend (sondagem, instalação, pasta), backend local, seletor, ~/.ssh/config, Tailscale |
| `atualizacao/` | Atualização automática do app (release, download, troca) |
| `conversa/` | Conversas com o meu-bot: histórico, contexto, memória, exportação, ordem das abas, conversas vistas pelo admin |
| `terminal/` | Abas de terminal (PTY remoto via `pty-broker.py`) e controle externo do terminal |
| `navegador/` | Aba Navegador: webviews, permissões, abas por conversa, API do agente, Navegador do agente do WhatsApp |
| `whatsapp/` | WhatsApp do agente: a fachada `whatsapp.ts` monta os scripts por motor e despacha pelo contrato `MotorWhatsapp` (`whatsapp-motor.ts`); adaptadores `whatsapp-openclaw(-core)`, `whatsapp-hermes`, `whatsapp-picoclaw`; pareamento (`whatsapp-pair`), conversas, grupos, marcas, pausa, capacidades, áudio |
| `crm/` | CRM pelo WhatsApp e CRM próprio (pelo túnel), guardar conversa no CRM |
| `financeiro/` | Financeiro da máquina pelo túnel (inclui Curva ABC e importação de planilha) |
| `google/` | Conta Google por máquina (OAuth), Gmail/Agenda/Planilhas, Contatos do CRM, backup no Drive |
| `licenca/` | Licença da máquina e os portões dos módulos pagos |
| `agente/` | Contas e ferramentas do agente na máquina: login do Claude Code, CLIs, xAI, objetivo do WhatsApp, status line |
| `auditoria/` | Registro de quem fez o quê em cada máquina |
| `suporte/`, `client/`, `admin/` | Suporte: código de suporte; lado da pessoa; lado do meu-bot-admin |
| `ipc/` | Registro dos canais (shared/client/admin) e a política de variante de cada canal |
| `extensao-gmail/` | Extensões embutidas no Navegador (CRM no Gmail, autenticador) |

Regras:
- **Dependência de fora para dentro:** `ipc/` e `main.ts` chamam os domínios; um domínio não importa `ipc/`.
- **Regra pura em `*-core.ts`**, sem Electron: é ela que leva teste. O arquivo sem `-core` só faz IO.
- **Um dono por formato:** quem lê/grava um arquivo na máquina é um módulo só (ex.: `whatsapp/whatsapp-marks.ts` para
  `whatsapp-lista.json`); os outros usam as funções dele.
- Caminho de arquivo compilado: `path.join(__dirname, "..", "..", <preload|renderer>, …)` a partir de um domínio.

## Outras partes
- `src/preload/` — pontes de IPC por janela. `src/shared/ipc/` — contrato entre main e telas, só tipos, um arquivo por
  domínio (app, agente, maquina, whatsapp, crm, financeiro, google, navegador, conversa, suporte, licenca, atualizacao,
  seletor) e `api.ts` com a superfície `window.meuBot` e os eventos do main; `src/shared/ipc.ts` só reexporta.
- `src/renderer/` — telas (ES modules sem bundler). `renderer.ts` é a raiz de composição: elementos e estado da
  janela (abas de conversa, lateral, paleta, modo, zoom) e a ligação das páginas. Cada assunto tem sua pasta:

| Pasta | Do que é dona |
|---|---|
| `app/` | `ctx.ts` (ponte para o renderer), `paginas.ts` (páginas em aba própria e modo dividido), `rede.ts` (barra offline) |
| `depuracao/` | `faixa.ts`: a faixa do modo de depuração no topo (build, batimento do main, túnel, o fluxo do que chega de fora); regra pura em `lib/depuracao-core.ts`; no main, `app/depuracao.ts` (tique, marcas, `registrarAcao` chamado pelos `handle()` dos sockets) e `app/depuracao-core.ts` (resumos por rota); `POST /nota` e `/depuracao` no `term.sock` |
| `agente/` | Entrar no Claude Code, contas do Claude (rodízio), xAI (Grok) e o passo do fallback, oferta de skill depois de navegar; guias de domínio: `objetivo-guia.ts` (objetivo do WhatsApp, estado e passos), `contas-cli-guia.ts` (Cloudflare, GitHub), `link-publico-guia.ts` |
| `whatsapp/` | `agente-whatsapp.ts` (linha, pareamento, política, voz), `conversas.ts` (lista e marcas), `grupos.ts` (área Grupos e os passos do tutorial), `guarda-guia.ts`, `chat.ts` |
| `tutoriais/` | Só o motor: `tutoriais.ts` (guia ao vivo), `catalogo.ts` (página Tutoriais, os cartões), `passos.ts` (registro body → quem desenha o passo), `fontes.ts` (registro fonte → fatia do `GuideContext`; `montarGuideCtx()` junta), `guia-secoes.ts` (passos e fontes sem domínio: suporte, status line) |
| `crm/` | Passo do CRM no guia (instalação, chave, pipeline, teste) |
| `finance/`, `conta-google/`, `gmail/`, `admin/` | Finanças (e o passo dela no guia), Conta Google, Gmail (`gmail-page.ts` e `gmail-guia.ts`, o tutorial 16), páginas do meu-bot-admin |
| `navegador/`, `terminal/` | Aba Navegador (abas, espaços, favoritos, notificações, zoom; `navegador-guia.ts` = passos do tutorial e `abrirLinkDoChat`) e abas de terminal |
| `conversa/` | Envio e streaming (`envio.ts`), voltar ao chat (`ponte-chat.ts`), ferramentas em uso (`atividade.ts`) |
| `inicio/`, `acervo/`, `licenca/` | Abertura/onboarding/tour, Acervo de skills e objetivo, plano e licença |
| `configuracoes/`, `atualizacao/` | Diálogo de configurações, alertas e fallback (`entrada-rapida-guia.ts` = passos do atalho global); atualização do app |
| `lib/` | Regras puras com teste (`scripts/tests/`; ferramentas de desenvolvedor em `scripts/*.mjs`, como `devtools.mjs`, e hooks do Claude em `scripts/hooks/`): `tutoriais.ts` é só o motor dos tutoriais; o que é regra de domínio tem arquivo próprio (`whatsapp-resposta.ts`, `whatsapp-grupos.ts`, `fallback.ts`, `objetivo.ts`, `crm-modelos.ts`, `contas-claude.ts`…) |

Regras do renderer:
- **Página não importa `renderer.ts` em tempo de execução.** O que ela usa da raiz vem por `ctx.<nome>` (`app/ctx.ts`):
  o `renderer.ts` registra getters no bloco `ctx:inicio…ctx:fim`. Tipos podem vir por `import type`.
- **Nada de `ctx` no carregamento do módulo**: o `ctx` só vale depois que o `renderer.ts` começa a rodar. Eventos e
  estado inicial de cada página ficam numa função `ligar…()` que o `renderer.ts` chama.
- Uma variável que outro arquivo grava fica com quem grava (ou ganha uma função para mudar); import não se grava.
- **A tela de um passo de tutorial mora em `<domínio>/<x>-guia.ts`**, junto do estado e do `refresh…` que ela lê, e o
  módulo registra os seus bodies no próprio `ligar<X>Guia()` (`registrarPassos`, de `tutoriais/passos.ts`). Em
  `tutoriais/` fica só o motor; em `renderer.ts`, só a chamada `ligar<X>Guia()`.
- `backend-colima/` — o backend que roda em cada máquina (Node puro): `server.js` (rotas), `crm-*` e `finance-*`
  (modelo puro + API), pontes `finance-crm-sync.js` e `crm-finance-vendas.js`, plugins `crm/` e `finance/`.
- `scripts/tests/` — um teste por módulo puro, importando de `dist/`.
- `docs/guia/` — o diário técnico por assunto (índice em `docs/GUIA.md`). Mudança nova: uma seção datada no fim do guia
  do assunto dela; `docs/guia/historia.md` é o começo (REA do Grok Bot, 13–14 out) e não recebe coisa nova.

## Como criar um MVP (produto novo derivado do meu-bot)
Exemplo de referência: o financeiro (add-on `meu-bot-finance`, app `meu-bot-finance-staging`). Nome do exemplo
abaixo: `meu-bot-fit`.

1. **Registrar a ideia no meu-bot-admin** (janela Produtos: "◆ Produtos ↗" no seletor): pitch, público, módulos. O checklist dessa página é este
   mesmo roteiro (`src/main/admin/produtos-core.ts` › `checklist`).
2. **Linha na tabela** `PRODUTOS` (`src/main/app/variant-core.ts`) e o id em `AppVariant` (`src/shared/ipc/app.ts`). Um app
   de teste sai de `staging(CLIENT, "<id>", <porta livre>)`; declare `addon` (a razão do app) e `abreEm` (página na
   frente, de `PAGINAS_INICIAIS`; página nova lá precisa de um `caps.abreEm === "<página>"` no `renderer.ts`).
3. **Add-on no catálogo**: `ADDONS` em `variant-core.ts` (nome, rótulo, descrição) e a cópia `ADDONS` em
   `backend-colima/licenca.js`, com a regra `<x>Ok` (molde `financeOk`). Rótulo, candidatos no admin e nomes
   reservados saem do catálogo sozinhos.
4. **Ícone**: `assets/icon-<id>.svg` e `npm run icons`. **Auditoria**: o nome do app em `APPS`
   (`src/main/auditoria/auditoria-core.ts`).
5. **Módulo, no molde do financeiro**:
   - máquina: `backend-colima/<x>-modelo.js` (regra pura, com teste) e `<x>-api.js` (rotas `/v1/<x>/*`, montadas no
     `server.js` atrás do portão da licença); skill para o agente usar as rotas;
   - main: `src/main/<domínio>/<x>-local.ts` (pelo túnel, como `financeiro/finance-local.ts`) e os canais em
     `ipc/client.ts`, `ipc/ipc-policy.ts`, `preload/preload.ts` e `shared/ipc.ts`;
   - telas: `src/renderer/<domínio>/<x>-page.ts` com `mount<X>Page(deps)` (molde `finance/finance-page.ts`) e, se
     fizer sentido, um tutorial (seção "Como adicionar um tutorial", abaixo).
6. **Conferir**: `npm test`. O `produtos-alinhados.test.mjs` diz o que faltou (ícone, add-on fora do catálogo,
   auditoria, backend desalinhado, tipo `AppVariant`, atalho de build).
7. **Empacotar**: `npm run dist -- --variant <id>` (sem entrada nova no `package.json`; um atalho `dist:<id>` é
   opcional e precisa chamar `scripts/dist.mjs`).
8. **Liberar**: no meu-bot-admin, Suporte › Conta e licença › `＋ <rótulo>` na máquina da pessoa.

## Como adicionar um tutorial

Um tutorial toca três arquivos (quatro com o teste). Molde: `finance/financeiro-guia.ts` + a entrada `financeiro` em
`lib/tutoriais.ts`.

1. **`src/renderer/lib/tutoriais.ts`** (puro): a entrada em `TUTORIAIS` (número = o próximo da trilha; os `oculto`
   ficam no fim da numeração), os bodies novos no union de `GuideStep.body`, o campo novo em `GuideContext` e em
   `emptyContext()`, e a fonte nova em `GuideSource`, `GUIDE_SOURCES` e `noneKnown`. Cada passo diz como se conclui
   pelo estado real (`done`), e `lembrar: true` quando o fato não se desfaz.
2. **`src/renderer/<domínio>/<x>-guia.ts`**: o estado lido da máquina, o `refresh<X>…()` que o preenche (termina em
   `ctx.paintGuide()`), um renderizador por body e `ligar<X>Guia()`, que chama `registrarPassos({...})`
   (`tutoriais/passos.ts`) e `registrarFonte("<fonte>", () => ({ known, dados }))` (`tutoriais/fontes.ts`); a fonte
   entra também em `CAMPOS_POR_FONTE`. Estado que outro arquivo grava ganha função (`set<X>…`).
3. **`src/renderer/renderer.ts`**: uma linha `ligar<X>Guia();` junto das outras; se o guia precisa ler a máquina ao
   abrir, o `refresh` entra em `openGuide` (`tutoriais/tutoriais.ts`).
4. **Testes**: os passos e a conclusão em `scripts/tests/tutoriais.test.mjs` (o teste "trilha numerada" trava a ordem
   e `fontes.test.mjs` confere o mapa de campos); seção datada no guia do assunto em `docs/guia/`.

O `renderer.ts` acusa no console, ao abrir a janela, body sem renderizador ("passos de tutorial sem tela") e fonte sem
registro ("fontes do guia sem registro").

## Próximas fases da organização
1. ~~Processo principal por domínio~~ (26/10).
2. ~~Telas por domínio~~ (26/10): `renderer.ts` de 7,5 mil para 2 mil linhas. Falta: o núcleo da janela que ficou
   nele (abas de conversa, lateral, paleta) e trazer para as páginas o estado que ainda mora no renderer (`ctx` com setter).
3. ~~Contrato por domínio~~ (27/10): `src/shared/ipc/`. Falta dividir por domínio os métodos de `api.ts`
   (`MeuBotClientApi` como `extends` das interfaces de cada domínio).
4. ~~Guia por assunto~~ (27/10): `docs/guia/<assunto>.md`, com `docs/GUIA.md` como índice.
