-- O cliente da AbacatePay (cust_...) que pagou a última compra desta conta. Vai como `customerId` nas próximas
-- compras, e a página de pagamento abre já preenchida. Só o id: nome, CPF e telefone ficam na AbacatePay.
ALTER TABLE contas ADD COLUMN abacatepay_cliente TEXT;
