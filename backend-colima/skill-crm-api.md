---
name: crm-api
description: "Mexer no CRM próprio do meu-bot-crm (desta máquina, sem navegador) com o crm.mjs: achar/criar/atualizar boxes, campos, comentários, contatos e conversas do Gmail do pipeline configurado. Use quando o pedido envolver o CRM e a máquina tiver ~/.local/share/meu-bot/crm/crm.mjs."
---

# CRM do meu-bot-crm pela CLI (meu-bot · CRM próprio)

Ferramenta: `node ~/.local/share/meu-bot/crm/crm.mjs <subcomando>` (devolve JSON numa linha; erro = `{"erro":…}`).
O CRM mora nesta máquina (backend do meu-bot, `/v1/crm/*`); não há chave de API nem serviço de terceiros.
O pipeline padrão fica em `~/.local/share/meu-bot/crm.json`; `--pipeline <key>` escolhe outro.

## Subcomandos
- **Apagar pede, não apaga.** `box-delete`, `pipeline-delete`, `arquivo-delete`, `contato-delete` e `org-delete` vindos de
  você voltam 403 `exclusao_requer_dono` e deixam o pedido registrado (comentário no box, quando há box). Diga ao dono o
  que você pediu para apagar e que ele confirma no app. Não tente contornar com outra rota, chave ou cabeçalho.
- `diag` · `pipelines` · `pipeline [key]` (etapas e campos, com as opções das listas, e a marca `agenteAutonomo`)
- `box-find --phone +595…` | `--name "Junior"` | `--query "kommo"` | `--email fulano@x.com` | `--email @dominio` | `--thread <threadGmailId>`
  (procura em **todos os pipelines**; a caixa pode estar em "Aluguel de Carro" etc.; `--pipeline <key>` restringe)
  → boxes (com os últimos comentários quando acha um só)
- `box-get <boxKey>` (ficha completa: campos, contatos, conversas vinculadas, comentários)
- `box-create --name "Fulano" [--stage "Prospecção"] [--notes "…"] [--phone +N] [--email e]`
- `box-update <boxKey> [--name "…"] [--notes "…"] [--stage "Etapa"]` · `box-delete <boxKey>` (vai para a lixeira)
- `field-set <boxKey> "Origem" "Redes sociais"` (listas pelo nome da opção; datas dd/mm/aaaa; números; sim/não)
- `comment <boxKey> "16/10: pediu os links; fecha depois do fim de semana"`
- `contact-upsert --phone +N --name "Nome Sobrenome" [--email e] --box <boxKey>` (cria/acha o contato e vincula)
- `telefone-set +N <boxKey>` (o telefone passa a ser de um contato do box)
- `threads <boxKey>` · `thread-add <boxKey> <threadGmailId>` · `thread-remove <boxKey> <threadGmailId>`
  (uma conversa do Gmail só pode estar em um box; o id é o hexadecimal da conversa)
- Pipelines, etapas e campos (os mesmos que o menu ⋯ do CRM no Gmail faz) — **só a pedido explícito do dono**:
  - `pipeline-create --name "x" --stages "A|B|C" [--autonomo true|false]` · `pipeline-rename <pipeline> "Nome"` · `pipeline-delete <pipeline>` (só vazio)
  - `pipeline-set <pipeline> --autonomo true|false` (liga ou desliga a marca `agenteAutonomo`: com ela você mexe nas
    caixas desse pipeline sem perguntar; quem decide ligar é o dono, nunca você por conta própria)
  - `stage-add <pipeline> "Nome"` · `stage-rename <pipeline> "Atual" "Novo"` · `stage-remove <pipeline> "Etapa" [--mover "Outra"]`
    (etapa com caixas só sai com `--mover`)
  - `field-add <pipeline> "Nome" TIPO [--options "a|b"]` (TIPO: TEXT | NUMBER | DATE | DROPDOWN | TAG | CHECKBOX)
- `config [--pipeline <key>] [--silencio N] [--criar-sem-perguntar true|false]`
- Responsáveis da caixa: `responsaveis <boxKey>` (mostra) · `responsaveis <boxKey> "a@x.com|b@y.com"` (substitui a lista)
- Anexos da caixa (📎 no Gmail): `arquivos <boxKey>` · `arquivo-get <boxKey> <arquivoKey> [--saida caminho]` (salva o arquivo; padrão /tmp)
  · `arquivo-add <boxKey> <caminho>` (até 15 MB) · `arquivo-delete <boxKey> <arquivoKey>` (vai para a lixeira; só a pedido do dono)
- O agente que responde no WhatsApp recebe, antes de cada resposta a um contato com caixa, só o essencial do CRM
  (caixa, etapa, próximo passo e visão geral do resumo com IA). Para desligar: `config --contexto-whatsapp false`.
- Conversa do WhatsApp limpa ("Limpar histórico") no app meu-bot-crm é guardada antes (`POST /v1/crm/whatsapp/arquivar`): a
  transcrição `conversa-whatsapp-AAAA-MM-DD.md` vira anexo da caixa mais recente do contato (com registro "📦 Conversa
  do WhatsApp arquivada…"), ou fica no contato sem caixa; o resumo das conversas arquivadas fica no contato
  (`whatsapp.arquivo.resumo`, separado do resumo da conversa atual). Para reler o que foi dito antes, baixe esse anexo.
- Contatos (página "Contatos" no Gmail): `contatos [--q texto] [--org <org>]` · `contato <contatoKey>` (dados, organização, caixas, conversas)
  · `contato-editar <contatoKey> [--name "…"] [--emails "a|b"] [--phones "a|b"] [--cargo "…"] [--notas "…"] [--org <orgKey>|none]`
  (listas substituem as atuais) · `contato-delete <contatoKey>` (sai das caixas; vai para a lixeira) — apagar só a pedido do dono
- Organizações (página "Organizações"): `orgs [--q texto]` · `org <orgKey>` · `org-create --name "Empresa" [--dominio empresa.com.br] [--setor "…"]`
  · `org-editar <orgKey> [--name] [--dominios "a|b"] [--setor] [--site] [--notas]` · `org-delete <orgKey>` (só a pedido do dono)
  · `box-org-add <boxKey> <orgKey>` · `box-org-remove <boxKey> <orgKey>`
  (contatos com e-mail do domínio da organização entram nela sozinhos; gmail, hotmail, uol etc. não contam; mesmo domínio = mesma organização)

## Como agir
1. Sempre comece por `box-find --phone` (telefone do WhatsApp); sem resultado, `--name`; e-mail do Gmail, `--email`.
2. Antes de anotar, leia os `comentarios` do box para não repetir.
3. Anotações de conversa vão em `comment` (data + fato + próximo passo), não em `notes` (notes é a ficha fixa).
4. Criar box, mudar etapa e campos de lista depende do pipeline (veja `agenteAutonomo` em `pipeline <key>`):
   - `agenteAutonomo: true`: crie a caixa, preencha os campos e mude a etapa sem perguntar.
   - nos outros: só com o dono confirmando (no fluxo automático, proponha no bloco `crm-json`; se o dono pediu
     explicitamente, faça).
   Apagar continua voltando 403 em qualquer pipeline, autônomo ou não.
5. Nunca invente valores; o que a conversa não disse fica em branco.
6. Assunto que não cabe no pipeline configurado: não encaixe. Liste os `pipelines`, proponha 2 ou 3 saídas e
   espere. Pipeline, etapa e campo novos só com o dono confirmando.
7. Este crm.mjs é do meu-bot: não o edite. Se faltar uma ação, diga à pessoa o que falta para ela pedir no app.
8. Dados do Streak: `node ~/.local/share/meu-bot/crm/importar-streak.mjs --chave <chave> --pipeline <key>` traz um
   pipeline uma vez (a chave não é gravada); nunca mostre a chave na resposta.

## Lead que chega pelo WhatsApp
Vale para o funil de leads (modelo "Leads do site": Novo › Respondido › Link enviado › Baixou › Assinou › Perdido).
1. Comece por `box-find --phone +N`. Achou a caixa: use essa, não crie outra.
2. Sem caixa: `box-create --pipeline <funil de leads> --name "Nome" --phone +N --stage "Novo"`.
3. Primeira mensagem terminando com `(ref: x)`: `field-set <boxKey> "Ref do anúncio" "x"` e
   `field-set <boxKey> "Origem" "Anúncio"`.
4. A cada conversa, um `comment` com data + fato + próximo passo, e a etapa acompanhando o que aconteceu.
5. Não copie o conteúdo da conversa para a caixa: fica só o fato resumido.
6. Nunca invente valor: campo que a conversa não esclareceu fica em branco.

## Fluxo automático (plugin meu-bot-crm)
O job `crm-job.mjs` chama você com a conversa nova e espera no fim um bloco:
```crm-json
{"aplicado":["…"],"propostas":[{"acao":"box-update","args":["<boxKey>","--stage","Qualificação do perfil"],"texto":"mover Junior para Qualificação do perfil"}],"resumo":"…"}
```
`acao` ∈ box-create | box-update | field-set | comment | contact-upsert; `args` são os argumentos exatos do subcomando.

## Programa de Indicação (padrão de todo cliente)

Cada cliente indica até **3 pessoas**; cada indicado ganha **1 mês de chip grátis** para experimentar o agente.
Pipeline "Programa de Indicação": Indicado › Contato feito › Chip ativado (mês grátis) › Em experimentação ›
Virou cliente › Não seguiu. Quando o dono indicar alguém ("indico a Maria, 11 9…"), crie a caixa com o nome e o
telefone, `Indicado por` = o dono e `Indicação nº` = a próxima livre (1 a 3; se já houver 3, avise que o limite foi
atingido). Ao ativar o chip, preencha `Início do mês grátis` e `Fim do mês grátis` (30 dias depois).


## Vendas (alimentam o financeiro)
O pipeline **Vendas** tem os campos Cliente, Produto, Quantidade, Valor e Data da venda, e as etapas Negociando,
Vendido e Perdido. Ao registrar uma venda, crie um box por produto vendido com esses campos preenchidos (Valor com o
símbolo da moeda: "US$ 40", "₲ 300.000", "R$ 180,00"; Produto sempre com o mesmo nome) e mova para **Vendido** quando o
pagamento estiver certo. O box em Vendido vira sozinho uma entrada no financeiro (categoria Vendas) e entra na Curva ABC
por produto; se sair de Vendido, a entrada sai. Não lance a mesma venda também no financeiro: ela duplicaria.
