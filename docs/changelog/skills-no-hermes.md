### Skills do meu-bot também no Hermes
#### Corrigido
- Numa máquina com Hermes, as skills que o meu-bot instala para o agente (financeiro, sites do Navegador, grupos do WhatsApp, computador do bot e voz das respostas) iam só para a pasta do Claude Code, e o Hermes não as via. Agora vão também para `~/.hermes/skills`, como a do CRM já ia.
#### Mudou
- Ao reinstalar ou atualizar, a skill que o agente não editou recebe o texto novo; a que ele editou fica como está, e a saída do instalador diz onde está o texto novo para comparar. Antes, as skills dos grupos do WhatsApp, do computador do bot e da voz eram regravadas por cima a cada instalação, e as dos sites do Navegador nunca eram atualizadas.
