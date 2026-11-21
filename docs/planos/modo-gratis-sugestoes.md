# Modo grátis no Mac, etapa 2: o agente sugere e você aprova

Cartão "Modo grátis no Mac (Ollama): sugere e você aprova" (quadro, Project #6). A etapa 1 já está na main (#443 e
#445, só no staging): a pergunta "Você já tem assinatura de IA?" e o tutorial 17, que instala o Ollama neste Mac e
deixa o chat do app responder por ele.

## Por quê
Um modelo pequeno rodando no Mac (qwen2.5 de 3 ou 7 bilhões de parâmetros) erra mais que o Claude ou o Grok. No chat
do app isso é aceitável: a pessoa lê a resposta. No WhatsApp não: a resposta iria direto para um cliente. Por isso, no
modo grátis, o agente do WhatsApp **só sugere**; a pessoa lê, corrige se quiser e aprova o envio.

## O que falta, em fatias
1. **A fila na guarda (esta PR).** O plugin `meu-bot-guarda` do OpenClaw ganha o modo sugestão
   (`backend-colima/guarda/sugestoes.mjs`):
   - com o modo ligado, o gancho `message_sending` cancela o envio e guarda a resposta em
     `~/.local/share/meu-bot/whatsapp-sugestoes.jsonl`;
   - só passam a conversa do dono consigo mesmo e o que a pessoa aprovou (passe de uso único, 2 min);
   - destino ilegível ou fila indisponível com o modo ligado: o envio é cancelado. Na dúvida, nada sai sozinho;
   - a CLI `sugestoes.mjs` (`estado`, `ligar`, `desligar`, `listar`, `aprovar <id> [--texto-b64]`, `descartar`) é o
     que o app vai chamar na máquina. Nesta fatia nada liga o modo: a guarda se comporta como antes.
2. **A tela (PR seguinte, em cima desta).** No topo da lista do WhatsApp: o estado do modo com **Ligar/Desligar**, as
   sugestões pendentes (para quem, o texto, há quanto tempo) com **Aprovar**, **Editar** e **Descartar**, e o contador
   no botão "WhatsApp" da lateral. Canais IPC `whatsapp:sugestoes` (ler; os dois apps) e `whatsapp:sugestao` (agir; só
   o meu-bot), que chamam a CLI da guarda na máquina (`src/main/whatsapp/whatsapp-sugestoes*.ts`). O meu-bot-admin vê a
   fila, sem os botões. **Falta nesta fatia:** a bolha tracejada da sugestão dentro da conversa aberta.
3. **O Ollama como modelo do agente do WhatsApp neste Mac.** Hoje `oc_model_ensure` só grava modelo com o Claude
   logado. Sem Claude e com o `ollama-local` preparado, o OpenClaw aponta para o Ollama (provedor compatível com
   OpenAI em `127.0.0.1`), e o modo sugestão liga junto. Com Claude ou Grok, nada muda e o modo fica desligado (a
   pessoa pode ligar à mão).
4. **Medição no probe.** `hostProbe.probeLocal` passa a devolver RAM e disco (hoje `null`); o `ollamaLocal.ts` já mede
   para o tutorial.
5. **Sair do staging.** Tudo acima nasce só no canal staging, como a etapa 1. Vira estável com o OK do dono, depois de
   um teste real com WhatsApp pareado.

## O que ainda não foi provado
- Se o envio feito pela linha de comando (`openclaw message send`, usado na aprovação) passa pelo mesmo gancho
  `message_sending` do gateway. O desenho funciona nos dois casos: se passa, o passe o libera; se não passa, o passe
  vence sozinho. Falta um gateway com WhatsApp pareado para ver (nenhuma box de teste tem hoje).
- Mensagem com mídia: a sugestão guarda só o texto.

## Verificação
- Fatia 1: `scripts/tests/guarda-sugestoes.test.mjs` (o que passa, o que vira sugestão, aprovação, passe, CLI).
- Fatia 2: `scripts/tests/whatsapp-sugestoes-core.test.mjs` roda o roteiro de shell de verdade contra a CLI da guarda,
  com um `openclaw` de mentira (o texto editado chega inteiro ao envio e o shell não o interpreta). A lista foi dirigida
  num Chrome com o CSS do app (aprovar, editar, descartar, falha no envio, admin sem botões). Falta ver no app
  instalado, com um WhatsApp pareado.
- Fatia 3: na tela, no meu-bot-staging, com um WhatsApp pareado no OpenClaw deste Mac.
