### Agente: trabalho longo não é mais cortado aos 10 minutos
#### Corrigido
- Um pedido demorado ao agente (vários vídeos, várias tarefas em paralelo) parava no meio com "[erro agente: CLI excedeu 600000 ms]", e o que estava em andamento se perdia. Agora o agente segue enquanto estiver trabalhando: só é encerrado se ficar 15 minutos sem dar sinal ou se uma única mensagem passar de 2 horas, e o aviso diz isso em português e como continuar.
