### Controle externo (MCP): ver e agir em qualquer tela do app
#### Novo
- O controle externo ganhou quatro ferramentas para a interface do próprio app, além das que já existiam para o Navegador e os terminais: `ui_ler` (o texto e os botões da janela), `ui_clicar`, `ui_digitar` e `ui_tecla`. Com elas dá para conferir e operar Configurações, Conta Google, Tutoriais, conversa e WhatsApp sem reabrir o app em modo de teste.
- `print_janela` aceita `marcas`, que desenha na imagem o número de cada botão da última leitura.
#### Segurança
- Clicar, digitar e teclar na interface só ficam disponíveis com "Executar comandos e código" ligado, em Configurações › Controle externo (MCP). Ler a tela continua liberado. Essas ferramentas valem só neste Mac: o agente da máquina não alcança a interface do app.
