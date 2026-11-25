### Atualização: o app esbarra menos no limite de consultas do GitHub
#### Corrigido
- "Não consegui verificar atualizações: o GitHub limitou as consultas deste IP" aparecia quando vários apps eram abertos e reabertos na mesma rede. Agora reabrir o app pouco depois de uma verificação não consulta de novo, e, se o limite for atingido numa verificação automática, o app usa a lista da última consulta em vez de mostrar o erro. Quem clica em verificar continua vendo o aviso do limite.
