### Release: staging do site não espera 1 h depois do conserto
#### Corrigido
- Quando a publicação do staging do site falha, o agente espera 1 h só para tentar de novo o mesmo commit. Se a main andar (o conserto entrou), ele tenta na rodada seguinte.
- `conta-api/README.md`: a propriedade do Analytics de cada ambiente vem com o número dela.
