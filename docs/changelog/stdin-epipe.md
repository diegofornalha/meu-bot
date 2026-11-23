### Sem a janela "A JavaScript error occurred" (write EPIPE)
#### Corrigido
- O app podia mostrar a janela de erro "Uncaught Exception: Error: write EPIPE" quando uma conexão SSH caía antes de receber o que o app mandava (por exemplo, a central de auditoria fora do ar). Agora o erro fica só no registro.
