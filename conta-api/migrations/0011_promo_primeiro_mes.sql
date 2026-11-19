-- Promoção do primeiro mês do Pro (PROMO_CUPOM): o checkout criado com o cupom leva a marca. É por ela que o webhook
-- aceita a primeira cobrança pelo preço da promoção; checkout sem a marca pago abaixo do preço cheio continua indo para
-- a revisão do admin. Aplique esta migração ANTES de publicar o Worker que lê a coluna.
ALTER TABLE pagamento_checkouts ADD COLUMN promo INTEGER NOT NULL DEFAULT 0;
