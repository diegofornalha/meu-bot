# meu-bot-diego: produtos de módulos (whitelabel)

> Parte do diário técnico do meu-bot. Índice: [../GUIA.md](../GUIA.md).

## A ideia

Um **produto** é um meu-bot para uma pessoa ou um nicho (`meu-bot-<nome>`, o add-on na licença). Cada produto tem um
**repositório de módulos** (`https://github.com/diegofornalha/<produto>.git`, ou a URL de Configurações). Cada módulo traz
o que liga o serviço no agente da máquina (MCP, regras do turno) e a **ficha** que a página Módulos mostra. O app não leva
módulo nenhum dentro: baixa o repositório com git. Um nicho novo é um repositório de módulos novo e, se tiver app
próprio, um app derivado no repositório dele ([derivados.md](derivados.md)); nada disso entra na tabela do core.

Hoje há um produto, o `meu-bot-diego`, e um app, o `meu-bot-diego-staging`. O app é um **derivado**: a ficha e o ícone
moram em `github.com/diegofornalha/meu-bot-diego-app` (público), as releases saem lá, automáticas, a cada staging do
core, e o app instalado se atualiza de lá. Os módulos continuam no `meu-bot-diego` (privado).

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
- **Motor de IA de um módulo (24 nov):** um módulo pode trazer um modelo a mais para o agente. O contrato, a regra
  da reserva, a chave e o exemplo do Grok estão na seção "Motor de IA trazido por módulo", abaixo.

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
| `pagina` | página própria (opcional): `{ rotulo, porta, caminho }`. O instalador sobe um serviço web **só em `127.0.0.1:<porta>`** (1024–65535); o app abre um forward SSH até ela e mostra `<caminho>?token=<token>` num `<webview>` isolado (sem preload, sem IPC, só a origem do forward). Ao ligar, o app cria o token uma vez (0600) e passa o caminho do arquivo em `MODULO_PAGINA_TOKEN`; **o serviço recusa pedido sem o token** (pode guardá-lo num cookie `HttpOnly` depois do primeiro) |
| ação da página | a página não fala com o app (sem preload nem IPC), exceto por `window.open("/__meu-bot/acao?acao=chat&texto=…")` na própria origem: o app só **preenche** a caixa do chat (até 500 caracteres) e quem envia é a pessoa. Também `acao=planilha&link=…&aba=…&tipo=<a-z>`: o app mostra um cartão acima da página e **só com o clique da pessoa** lê a planilha com a Conta Google e entrega as células ao módulo em `POST /__meu-bot/planilha` (`Authorization: Bearer <token>`, corpo `{valores, fonte, tipo, simular}`); o módulo responde `{mensagem, linhas?, podeImportar}` (prévia com `simular`, e importa sem). Lista fechada (`lerAcao`, `modulos-pagina-core.ts`); outra ação é recusada |

Tudo da ficha é texto puro, cortado nos limites: o repositório é de fora, então a página nunca o trata como HTML.

## Motor de IA trazido por módulo (24 nov 2026)

No produto base só o Claude responde: a corrente de provedores da máquina (`providers.json`, ao lado do backend) nasce
só com o `agente` (#514, backend 1.18.8). Outro motor de IA entra por um módulo, que a pessoa liga e desliga na página Módulos. É o
lugar único desta regra; o mecanismo da corrente e do fallback está em [agente.md](agente.md).

### Como o motor chega ao agente

1. O instalador do módulo grava `provedores.json` na pasta do módulo na máquina
   (`~/.local/share/meu-bot/modulos/<id>/`), ao lado do `turno.json`.
2. Na subida do backend, `modulos.provedores` (`backend-colima/modulos.js`, backend 1.18.6 em diante) lê o
   `provedores.json` de cada módulo que tem a marca `ligado` e cujo `produto` (do `turno.json`) a licença da máquina
   libera (`licenca.moduloOk`). Até 8 entradas por módulo; cada uma ganha `modulo: <id>`.
3. `providers.load` junta essas entradas às do `providers.json` (parâmetro `extras`). O provedor de módulo não
   substitui um nome que a máquina já tem: o repetido é ignorado, com uma linha no log.
4. O `GET /v1/meu-bot/status` informa a corrente em `providers` (`name`, `type`, `available`, `reserva` e, quando há,
   `rotulo` e `modulo`). O app monta a lista de modelos a partir daí (`src/shared/modelos.ts`, #515): o motor aparece
   no menu de modos e na paleta com o `rotulo` que o módulo deu. Nenhum nome de provedor está escrito no app.
5. O backend lê os provedores só na subida. Por isso o instalador reinicia o backend, e marca `ligado` ele mesmo
   antes disso: o app só marca `ligado` depois que o instalador termina, tarde demais para essa reinicialização.
6. Módulo desligado: o modelo some do status. Uma conversa que ainda o pede recebe `model_not_found` e o app refaz o
   turno no modelo padrão da máquina (`recuoDoTurno`).

### Contrato do `provedores.json`

Uma lista no formato do `providers.json` do backend. Cada entrada:

| campo | o que é |
|---|---|
| `name` | nome do modelo na máquina (`a-z`, `0-9` e hífen, até 41 caracteres); é o que a conversa pede e o que volta no `X-Provider` |
| `type` | só `"openai"` (endpoint compatível com OpenAI). Entrada de outro tipo é ignorada: um módulo não redefine os perfis do Claude |
| `base_url` | `http://` ou `https://`. Sem chave, o provedor só fica disponível se o endereço é local (`127.0.0.1`, `localhost`) |
| `model` | id do modelo no endpoint (padrão: o `name`) |
| `priority` | ordem na corrente (menor primeiro; padrão 100). O `agente` é 0 |
| `rotulo` | nome que a pessoa lê, até 60 caracteres (opcional; sem ele vale o `name`) |
| `reserva` | `true` = entra na corrente quando outro modelo falha. Ausente ou `false` = só responde quando escolhido |
| `key_env` | nome de uma credencial do próprio módulo (opcional; ver "De onde vem a chave") |
| `timeout_ms`, `description` | tempo sem resposta até desistir (padrão 120000) e texto livre |

O `turno.json` do módulo precisa existir com o `produto`; `perfis: []` serve para um módulo que só traz o motor e não
mexe no turno do agente.

### A regra da `reserva`

- Escolhido de propósito numa conversa, o motor do módulo responde sempre que está disponível.
- Ele só responde no lugar de OUTRO modelo (o Claude que falhou antes de produzir texto) se a entrada diz
  `reserva: true`. `providers.chain` monta a corrente com o modelo pedido e depois os disponíveis que aceitam ser
  reserva, por prioridade.
- A diferença para o `providers.json` da máquina: uma entrada de lá (o `ollama-local` do modo grátis, por exemplo)
  vale como reserva por padrão, como sempre foi; a de módulo, não.
- Reserva do tipo `openai` não tem as ferramentas do agente: o turno que cai nela é só texto.
- Sem reserva na corrente, uma falha do Claude vai ao cliente como erro. No WhatsApp pelo Hermes o contato não recebe
  o aviso de erro: o backend grava a marca `sem-claude.json`, avisa o dono e o plugin `meu-bot-pausa` (1.4.0) guarda
  as mensagens até o Claude voltar (#512, contorno #8 em [contornos.md](contornos.md)).

### De onde vem a chave

- A chave de um provedor de módulo só vem das credenciais do próprio módulo: `key_env` nomeia uma linha do
  `~/.config/meu-bot/modulos/<id>.env` (0600, gravado pelo app a partir das `credenciais` do `modulos.json`).
- Chave literal (`key`) no `provedores.json` é descartada, e `key_env` nunca é procurado no ambiente da máquina nem no
  `.env` do backend. Motivo: um módulo poderia nomear a variável de outro serviço e mandá-la no `Authorization` para o
  endereço dele (#513).
- Endpoint local dispensa chave. É o caso do Grok.

### O exemplo: o módulo do Grok (xAI)

Complemento `meu-bot-grok` (com licença; em `ADDONS`, `src/main/app/variant-core.ts`, com `modulos: true`, #516),
repositório privado `diegofornalha/meu-bot-grok`, módulo `grok`. No meu-bot-admin o complemento é liberado por máquina
em Suporte › Conta e licença. Com ele na licença, a página Módulos aparece no app e a pessoa liga o "Grok (xAI)".

O `instalar.sh` do módulo:

- confere a máquina: backend do meu-bot que lê `provedores.json`, systemd de usuário e python3. Faltando algo, sai
  com código diferente de zero e uma frase dizendo o quê;
- instala o Hermes 0.22.2 em `~/.local` se a máquina não o tem nessa versão;
- escreve `~/.config/systemd/user/meu-bot-xai-proxy.service` (`hermes proxy start --provider xai`, só em 127.0.0.1),
  na porta que o serviço já usa ou na primeira livre a partir de 8645, e liga o linger da conta;
- só habilita e inicia o serviço **com a xAI já logada** (módulo 1.0.1). Sem login o proxy sai na hora e o
  `Restart=always` viraria um laço de reinícios; o serviço fica parado e fora do boot até o login;
- grava na pasta do módulo o `provedores.json` (uma entrada: `grok-4`, `type: "openai"`, `priority: 1`, `base_url`
  no proxy local, `rotulo: "Grok (xAI)"`, `reserva` conforme a opção), o `turno.json`
  (`{ "produto": "meu-bot-grok", "perfis": [] }`) e uma cópia do `entrar.sh`;
- não reescreve o `providers.json` da máquina. Se houver nele um `grok-4` antigo (do instalador que vinha dentro do
  meu-bot), tira só essa entrada, com cópia em `providers.json.antes-do-modulo-grok`; as outras ficam;
- marca `ligado` e reinicia o backend.

**Login na xAI:** o contrato dos módulos não tem passo interativo, então o login é um comando que a pessoa roda no
terminal do app, na máquina: `bash ~/.local/share/meu-bot/modulos/grok/entrar.sh`. Ele mostra o link da xAI (código de
dispositivo), espera a aprovação no navegador, remove as credenciais antigas da xAI no Hermes (uma vencida na frente
derruba o proxy), anota a nova em `xai-credencial`, habilita o serviço e o liga. Nos primeiros passos do módulo, "Entrar
na sua conta da xAI" é marcado à mão ("Já entrei") e "Testar a conexão" (`testar.sh`) é o que confere: xAI logada e
proxy respondendo em `/v1/models`.

**Reserva do Claude:** a opção `reserva` do módulo ("Usar o Grok como reserva do Claude"), desligada de início. Salvar
a opção com o módulo ligado roda o instalador de novo, que regrava o `provedores.json` com `"reserva": true` e
reinicia o backend. Sem ela, o Grok só responde na conversa em que foi escolhido.

**O que o módulo deixa na máquina:**

| onde | o quê |
|---|---|
| `~/.local/share/meu-bot/modulos/grok/` | `ligado`, `provedores.json`, `turno.json`, `entrar.sh`, `opcoes.json` e, depois do login, `xai-credencial` |
| `~/.config/systemd/user/meu-bot-xai-proxy.service` | o proxy local da xAI (porta 8645 ou a primeira livre) |
| `~/.local` | o Hermes 0.22.2, se não havia |
| ao lado do `providers.json` do backend | `providers.json.antes-do-modulo-grok`, só se havia um `grok-4` antigo |
| `~/.meu-bot-install/modulo-grok/` | o stage: a cópia dos scripts que o app mandou |

**Desinstalar:** desligar o módulo na página Módulos roda o `desinstalar.sh`, que para e remove o serviço do proxy,
apaga `provedores.json`, `turno.json`, `xai-credencial`, `entrar.sh` e o stage, e reinicia o backend (o `grok-4` sai da
lista de modelos). Ficam: o Hermes (pode ser o motor do WhatsApp da conta), as opções do módulo e o `providers.json` da
máquina. O login da xAI só sai quando foi o `entrar.sh` do módulo que o fez; outro login fica, e o script diz como sair
(`hermes auth logout xai-oauth`).

**Máquina que tinha o Grok de antes, sem o módulo (#514, backend 1.18.8):** a cada instalação ou atualização do backend, o
`install.sh` (`tirar_grok_sem_modulo`) tira a entrada `grok-4` do `providers.json` (cópia em
`providers.json.antes-de-tirar-o-grok`, as outras entradas ficam) e para e remove `meu-bot-xai-proxy.service` e a
legada `hermes-xai-proxy.service`. Com `modulos/grok/ligado` na máquina, não toca em nada. O Hermes e a credencial da
xAI não saem. A reserva `grok/<id>` que o app gravou no `openclaw.json` de uma máquina também não é desfeita.

**Este Mac:** o módulo não cobre a máquina "Este Mac" (o `instalar.sh` exige systemd de usuário, numa máquina por
SSH), e o app não sobe mais o proxy da xAI no Mac. O que o app antigo deixou no `providers.json` local sai na subida
do backend local (`limparGrokHerdado`; detalhe em [agente.md](agente.md) › "Grok (xAI): virou módulo").

## A página Módulos

Lista em cartões (inicial, nome, categoria, situação) e, ao abrir um, a ficha: cabeçalho com a situação e **Testar
conexão**; **O que dá para pedir**; abas **Visão geral** (configurar e ligar, a conexão e o guia em resumo),
**Ferramentas** (do último teste), **Guia** e **Primeiros passos** (concluídos pelo estado ou à mão, por máquina); e a
coluna **Detalhes** (situação, categoria, versão, acesso, onde roda, identificador e origem).
