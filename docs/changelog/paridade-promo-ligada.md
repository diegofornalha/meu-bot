### Testes do servidor no CI
#### Corrigido
- Os testes do servidor da conta passam a rodar em toda PR. Antes só rodavam na hora de publicar o site, e uma PR foi mesclada com um deles quebrado.
- A conferência de paridade entre staging e produção exige a promoção do primeiro mês igual nos dois ambientes.
