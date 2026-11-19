### Primeiro mês do Pro por R$ 1 para quem terminou o teste
#### Novo
- Conta: quando o teste grátis acaba, a pessoa tem 3 dias para assinar o Pro pagando R$ 1 no primeiro mês; a partir do segundo mês, R$ 97. Vale uma vez por conta, só no cartão de crédito. Passado o prazo, ou para quem assina durante o teste, vale o preço normal desde o primeiro mês.
- Console › Plano: quem tem direito vê o aviso com o preço, até quando vale, o código do cupom (caso a página de pagamento o peça) e o link "Ver as regras". O botão vira "Assinar por R$ 1 no primeiro mês".
- As regras ficam em `/promocao`, página que só o console abre: não aparece na home, no menu nem no Google. Os termos de uso ganharam o item da promoção.
- A promoção liga por ambiente com o código do cupom (`PROMO_CUPOM`): ligada no staging, desligada em produção até o dono ligar.
- Em "Suas assinaturas" e na receita mensal do admin, a assinatura feita com a promoção aparece pelo valor do mês (R$ 97); o R$ 1 da primeira cobrança aparece na lista de pagamentos.
