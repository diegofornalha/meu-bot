# Produto: para quem é cada máquina do meu-bot

> Decisão de produto (28 out 2026). O diário técnico fica em [GUIA.md](GUIA.md) e o mapa do código em
> [ARQUITETURA.md](ARQUITETURA.md). Este arquivo diz **para quem** é cada coisa e **por quê**; quando o código e este
> texto discordarem, atualize os dois.

## O meu-bot é agnóstico

O meu-bot é **um app e um instalador só**, que não se prende a um agente nem a um gateway de WhatsApp. Ele detecta o
que cada máquina roda e se adapta pelo que ela sabe fazer (a tabela `capacidadesDe`, em
`src/main/whatsapp/whatsapp-capacidades.ts`), nunca pelo nome do framework:
- **Gateways de WhatsApp intercambiáveis:** OpenClaw, Hermes e PicoClaw hoje; a API oficial da Meta (`cloud-api`)
  planejada como quarta opção. A pessoa escolhe em "Escolha o agente" e pode trocar depois.
- **Modelos intercambiáveis:** no produto base, só o Claude Code, com rodízio de contas, configurado no backend do
  meu-bot. Outro motor de IA entra pelo modo grátis (`ollama-local`) ou por um módulo com licença (o Grok, da xAI, é o
  complemento `meu-bot-grok`), e o de módulo só serve de reserva do Claude se a opção do módulo estiver ligada
  (`docs/guia/meu-bot-diego.md` › "Motor de IA trazido por módulo").
- **Máquinas intercambiáveis:** VPS, VM local (Colima), TV box Android (FlowBox/Termux com PicoClaw) ou este Mac.

As camadas abaixo são **escolhas de produto** (que gateway e que máquina oferecer a que público), não limites do código:
o mesmo meu-bot instala e opera as duas. Regra para o código: recurso novo entra pela tabela de capacidades, e a tela
explica o que um gateway não tem, em vez de supor um framework.

## As duas camadas

| | **Essencial** (máquina Hermes) | **Evolução** (máquinas OpenClaw) |
|---|---|---|
| Para quem | Leigos, menos exigentes: querem o agente respondendo no WhatsApp e pouca configuração | Quem paga para evoluir o agente: grupos, CRM, voz, automações, ajustes finos |
| Gateway do WhatsApp | Hermes (Python + bridge Baileys), agente pelo backend do meu-bot (modelo `whatsapp`) | OpenClaw (runtime próprio chamando o Claude Code) |
| Máquina hoje | `meu-root` (32 GB de RAM, 8 núcleos), um usuário de login por cliente | `agente-root` e outras (2 GB+ por número) |
| Custo por número (medido) | ~0,8 GB (Hermes 0,32 + bridge 0,12 + backend 0,05 + Claude 0,3 quando roda) | ~1,5 a 1,8 GB (OpenClaw com o Claude dentro) |
| O que só ela tem hoje | Desenho mais limpo: política, fallback, rodízio de contas e registro num lugar só (o backend) | Trava por remetente (`toolsBySender`), guarda (anti-loop entre bots), CRM ligado às conversas, voz "sempre" com escolha de voz, grupos completos |

Medição de 28 out, foto de um momento (o Claude sobe e desce a cada mensagem): na mesma memória cabem uns 2 a 3
números Hermes para cada OpenClaw.

## O que falta para abrir a camada Essencial a clientes

Na ordem de prioridade. Sem os dois primeiros, a `meu-root` não deve atender desconhecidos.

1. **Trava por remetente no backend.** O perfil `whatsapp` roda sem pedir permissão e só tem o nível global do tutorial
   7: um desconhecido pode pedir para ler arquivos ou rodar comandos na conta. Fazer o perfil `whatsapp-cliente`
   (dono livre; os outros sem comandos, arquivos e navegador, como o `toolsBySender` do OpenClaw). Serve também à API
   oficial.
2. **Anti-loop no backend.** Sem a guarda, um número que cair em conversa com outro robô fica respondendo sem parar
   (gasta Claude e é o comportamento que leva a ban). Mínimo: pausar o contato depois de N trocas rápidas.
3. **Conferir se o Hermes manda o id da conversa** (`X-Conversation-Id`) ao backend; sem ele, cada mensagem chega com o
   histórico achatado em vez de retomar a sessão.

## Risco de ban: quem carrega e o que fazer

- Hermes, OpenClaw e PicoClaw usam o protocolo do WhatsApp Web (**não oficial**). Na camada Essencial, o cliente é quem
  menos sabe se proteger e quem mais sofre ao perder o número.
- **Caminho oficial:** gateway `cloud-api` (WhatsApp Business Platform da Meta), planejado como quarta opção em
  "Escolha o agente", parte do Pro. Primeiro corte: cada cliente usa a própria conta da Meta; mensagens chegam por
  Cloudflare Tunnel na máquina. Depois, para leigos, o "Conectar com o Facebook" (Tech Provider / Embedded Signup),
  porque configurar a Meta sozinho é difícil para eles.
- **IP:** dezenas de números no mesmo IP aumentam a desconfiança, mas o comportamento pesa mais (falar com quem não salvou
  o número, volume, repetição, número novo). Para a camada Essencial: espalhar os números entre mais de uma VPS. O "IP
  pelo computador" (WhatsApp saindo pela internet do Mac da pessoa) só serve a quem deixa o Mac ligado: não é para leigos.
- Crescer aos poucos (10, depois 20…) e registrar quais números caem e quando.

## Como cada máquina é operada

- Clientes da camada Essencial são **usuários de login** na `meu-root`, criados na aba "Usuários" do meu-bot-admin: já
  entram nos seletores do meu-bot e do admin e nascem com tetos (2 GB de RAM, 200% de CPU), então um cliente não derruba
  os vizinhos. Ver [guia/suporte-admin.md](guia/suporte-admin.md).
- Máquinas OpenClaw: menos números por máquina e folga de memória; com 8 GB e sem swap a `agente-root` já está no limite
  com três (ligar a swap pela aba Usuários é a proteção imediata).
