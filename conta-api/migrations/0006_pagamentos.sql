-- Assinatura do Pro pela AbacatePay (console › Plano › Assinar). A cobrança e o cartão ficam na AbacatePay; aqui fica
-- só o vínculo com a conta, o que já foi processado (os webhooks repetem) e o que o Analytics precisa para creditar a
-- compra à visita certa. Nada de cartão, CPF ou endereço.

-- Cada "Assinar" do console cria um checkout de assinatura (bill_...). `ref` é o externalId que mandamos à AbacatePay e
-- volta em todo webhook: é por ele que a compra acha a conta.
CREATE TABLE pagamento_checkouts (
  ref TEXT PRIMARY KEY,           -- mb_<uuid>, o externalId do checkout
  conta_id TEXT NOT NULL REFERENCES contas(id),
  checkout_id TEXT,               -- bill_... que a AbacatePay devolveu
  ga_client_id TEXT,              -- o client_id do GA4 no console (cookie _ga), para a compra ir à mesma pessoa
  ga_session_id TEXT,             -- e à mesma sessão (de onde vem a campanha do anúncio)
  criado_em TEXT NOT NULL
);
CREATE INDEX pagamento_checkouts_conta ON pagamento_checkouts (conta_id, criado_em);
CREATE INDEX pagamento_checkouts_bill ON pagamento_checkouts (checkout_id);

-- A assinatura viva de cada conta (subs_...), como o último webhook a deixou.
CREATE TABLE assinaturas (
  id TEXT PRIMARY KEY,            -- subs_...
  conta_id TEXT NOT NULL REFERENCES contas(id),
  ref TEXT NOT NULL,              -- o checkout que a criou
  status TEXT NOT NULL,           -- ACTIVE | CANCELLED
  metodo TEXT,                    -- CARD | PIX
  valor_centavos INTEGER,
  criada_em TEXT NOT NULL,
  atualizada_em TEXT NOT NULL
);
CREATE INDEX assinaturas_conta ON assinaturas (conta_id);

-- Cada cobrança paga (card_... ou char_...): uma linha, uma vez. É o que impede liberar o Pro ou mandar a compra ao
-- Analytics duas vezes quando o mesmo pagamento chega por eventos diferentes ou por reenvio manual.
CREATE TABLE pagamentos (
  id TEXT PRIMARY KEY,
  conta_id TEXT NOT NULL REFERENCES contas(id),
  assinatura_id TEXT,
  valor_centavos INTEGER NOT NULL,
  evento TEXT NOT NULL,           -- subscription.completed | subscription.renewed
  pago_em TEXT NOT NULL,
  ga_enviado_em TEXT              -- quando a compra foi ao GA4 (null = não foi: sem client_id ou sem secret)
);
CREATE INDEX pagamentos_conta ON pagamentos (conta_id, pago_em);

-- Entregas de webhook já recebidas (o id log_... se repete nas retentativas): a segunda vez responde 200 sem processar.
CREATE TABLE webhook_eventos (
  id TEXT PRIMARY KEY,
  evento TEXT NOT NULL,
  recebido_em TEXT NOT NULL,
  resultado TEXT
);
