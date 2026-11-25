### Controle externo (MCP): o estado do app sem depender da tela
#### Novo
- `estado` devolve um retrato da máquina da janela: configurações, WhatsApp, Claude Code, Ollama, Conta Google, backup, licença e módulos. Chaves e senhas nunca entram no retrato.
- `conversas_listar` e `conversa_ler` mostram as conversas com o agente e as últimas mensagens de cada uma, e dizem se o agente ainda está respondendo.
