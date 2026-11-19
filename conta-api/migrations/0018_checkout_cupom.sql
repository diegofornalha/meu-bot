-- "Tenho um cupom" no console: o checkout do Pro criado com um cupom que a pessoa digitou guarda o código e quanto a
-- PRIMEIRA cobrança sai com ele (calculado ao criar, a partir do cupom lido na AbacatePay). O webhook exige esse valor
-- na primeira cobrança de uma conta que nunca pagou o Pro; renovação e conta que já pagou continuam no preço cheio.
ALTER TABLE pagamento_checkouts ADD COLUMN cupom TEXT;
ALTER TABLE pagamento_checkouts ADD COLUMN cupom_centavos INTEGER;
