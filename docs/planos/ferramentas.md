# Ferramentas: apps conectáveis, vendidos um a um no Marketplace

Plano aprovado pelo dono em 21 nov 2026. Este arquivo é o registro do desenho e do andamento; o que já está no código
aponta para cá.

## Módulo não é ferramenta

- **Módulo** é um produto com regras e fluxo próprios para o negócio (Finanças, os módulos do Diego). Vem de um
  repositório próprio, é liberado pela licença e mora na página Módulos do app.
- **Ferramenta** é a conexão do agente com um app (Gmail, Google Search Console, Notion…) por um conector (MCP) já
  integrado ao meu-bot. A pessoa compra, clica em Conectar e autoriza a conta. Não cria chave, não configura servidor.
  Mora na página Ferramentas do app.

Um módulo pode usar ferramentas por baixo; a ferramenta sozinha não traz regra de negócio nenhuma.

## Por quê

O agente já usava o Composio por fora, pela linha de comando da máquina, numa conta só. O Hostinger Agente mostra a
mesma coisa com uma casca: é o catálogo do Composio com as descrições em inglês, sem dizer o que dá para pedir e sem
separar o que já funciona do que falta conectar. O meu-bot faz em português, com curadoria para quem tem negócio, e
com a divisão visível.

## Decisões do dono

- A conta Composio é do meu-bot; cada cliente é um usuário dentro dela. O cliente não cria conta em lugar nenhum.
- O catálogo parte das ferramentas de login gerenciado e das sem login (as que exigem chave própria do cliente ficam
  fora). Só entra o que serve a um negócio: saíram as de lazer, de uso pessoal e as presas a outros países.
- Todas vão para o Marketplace, compradas separadamente, cada uma com o seu preço, inclusive as que não pedem login.
- Duas situações visíveis: "Pronta para uso" e "Conectar com um clique".
- Busca no app e no Marketplace (página pública e console).

## Desenho

- **Catálogo com um dono só:** `conta-api/src/ferramentas-catalogo.ts`. Por ferramenta: `slug` (o do toolkit no
  Composio), `nome`, `categoria`, `grupo` (`pronta` ou `conectar`), `resumo` (o que o agente faz) e `exemplo` (um
  pedido). O site, o console e o app leem daqui.
- **Venda:** `conta-api/src/ferramentas-ofertas.ts`, por ambiente: o produto da AbacatePay e o preço de cada
  ferramenta. Sem oferta no ambiente, a ferramenta não aparece à venda ali. Nome técnico `ferramenta-<slug>`.
- **A chave do projeto Composio nunca sai do servidor.** O endereço MCP que o Composio dá por usuário só funciona com
  a chave do projeto; por isso quem fala com o Composio é o `conta-api`, e a máquina fala com o `conta-api`.
- **Só o que comprou:** a sessão do Composio da conta é criada com a lista das ferramentas pagas
  (`toolkits.enable`). A trava é do servidor, não do app.
- **Dono das conexões:** a conta meu-bot. Conectou uma vez, vale nas máquinas da conta.
- **No app**, três blocos: Prontas para uso (compradas e funcionando), Falta conectar (compradas, esperando o
  Conectar) e No Marketplace (as demais, com preço).

## Fases

| Fase | O que entrega | Estado |
|---|---|---|
| 0 | Prova do caminho com o Composio (sessão por usuário, link de conexão, agente usando pelo servidor) | espera a chave do projeto Composio de staging |
| 1a | Catálogo em português, tipo "ferramenta" no Marketplace e a busca (site e console) | feito |
| 1b | Compra de uma ferramenta: checkout, `ferramentas_pagas`, cancelamento | a fazer |
| 2 | `conta-api` com o Composio: estado por conta, conectar, desconectar, token da máquina | depende da fase 0 |
| 3 | Página Ferramentas no app e o agente usando (conector por turno no backend) | depende da fase 2 |
| 4 | Produção: produtos e preços criados, textos revistos, aprovação do site | depois do staging provado |

O ponto de maior risco técnico é o da fase 0: o `conta-api` (Cloudflare Worker) como intermediário do conector. Se não
funcionar bem, a alternativa é o backend da máquina pedir ao `conta-api` a execução de cada ferramenta por HTTP comum.

## O que depende do dono

1. O projeto e a chave do Composio (staging primeiro).
2. O custo e os termos do Composio: quanto ele cobra por conta conectada ou por chamada, e se permite revender o
   acesso. Decide a margem de cada ferramenta.
3. O preço de cada ferramenta e os produtos na AbacatePay, em cada ambiente.

## Fora do escopo

- Os apps do Composio que exigem chave própria do cliente.
- Gatilhos (o agente reagir a um e-mail que chegou). Primeiro só ações pedidas no chat.
- Trocar o Gmail e o Navegador nativos do meu-bot pelos do Composio. Convivem.
- WhatsApp pelo Composio é a API oficial do WhatsApp Business, outro produto em relação ao WhatsApp do meu-bot.
