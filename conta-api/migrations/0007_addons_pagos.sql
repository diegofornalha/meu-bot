-- Add-ons pagos pela AbacatePay (console › Plano): cada app vendido à parte (meu-bot-finance…) é uma assinatura
-- própria, com produto, preço e prazo próprios, independente do Pro.

-- De qual produto é o checkout, a assinatura e cada cobrança: NULL = o Pro; senão o nome do add-on (meu-bot-finance).
ALTER TABLE pagamento_checkouts ADD COLUMN produto TEXT;
ALTER TABLE assinaturas ADD COLUMN produto TEXT;
ALTER TABLE pagamentos ADD COLUMN produto TEXT;

-- Até quando cada add-on pago vale em cada conta. Os add-ons que o admin concede continuam em licencas.produtos, sem
-- prazo próprio; a licença que o app recebe junta os dois (os pagos, só enquanto o prazo não venceu).
CREATE TABLE addons_pagos (
  conta_id TEXT NOT NULL REFERENCES contas(id),
  produto TEXT NOT NULL,          -- meu-bot-finance…
  assinatura_id TEXT,             -- subs_... da última cobrança paga
  expires_at TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (conta_id, produto)
);
