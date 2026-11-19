### Console › Assinaturas: remover uma assinatura
#### Novo
- Cada assinatura da tela Assinaturas tem "Remover" no lugar de "Ocultar" (só o super admin, com confirmação): a cobrança é cancelada na AbacatePay e a assinatura é apagada, então sai da lista e da receita mensal de vez. Serve para compra de teste e para venda desfeita por fora. Se a AbacatePay não confirmar o cancelamento, nada é apagado.
- Os pagamentos da assinatura removida não são apagados: ficam ocultos e aparecem na Auditoria. O acesso que a pessoa já pagou não muda; quem tira é o admin, pelas ações de sempre.
- No staging, a tela Auditoria ganhou "Zerar", ao lado de "Recarregar" (só o super admin, com confirmação): cancela na AbacatePay as assinaturas ocultas, apaga elas, os pagamentos ocultos, as contas apagadas e o registro de ações, para recomeçar depois de uma rodada de testes. Fica uma linha dizendo quem zerou. Em produção o botão não aparece e a API recusa.
