### Modelos: o menu de modos mostra o que a máquina oferece
#### Mudou
- O menu "Modos do agente" e a paleta de comandos passam a listar os modelos que a máquina informa, inclusive os que um módulo traz, com o nome que o módulo dá a eles. Quem já usa o Grok continua com ele na lista.
- A escolha de primário e reserva (Configurações › Fallback) lista os provedores da máquina; um modelo que só responde quando escolhido não aparece como reserva dos outros.
#### Corrigido
- Se o modelo de uma conversa deixa de existir na máquina (um módulo desligado, por exemplo), a conversa volta para o modelo padrão, avisa uma vez e responde a mesma mensagem, em vez de parar com erro.
