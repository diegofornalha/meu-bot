-- "Tenho um cupom" › Pix: o primeiro mês do Pro por R$ 1 vendido como compra AVULSA (checkout comum da AbacatePay, só
-- Pix), porque a AbacatePay não aceita cupom em assinatura paga por Pix. `avulso = 1` marca o checkout criado por esse
-- caminho: só nele o webhook trata `checkout.completed` (num checkout de assinatura esse evento duplica o pagamento).
ALTER TABLE pagamento_checkouts ADD COLUMN avulso INTEGER NOT NULL DEFAULT 0;
