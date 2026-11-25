### Atualização: o app para de esbarrar no limite de consultas do GitHub
#### Corrigido
- "Não consegui verificar atualizações: o GitHub limitou as consultas deste IP" aparecia quando vários apps eram abertos e reabertos na mesma rede. Agora o app só gasta uma consulta quando há versão nova para ler, e, se o limite ainda assim for atingido, usa a lista da última consulta em vez de mostrar o erro.
