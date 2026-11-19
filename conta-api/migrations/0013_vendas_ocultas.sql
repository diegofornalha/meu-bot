-- O super admin tira uma assinatura ou um pagamento da tela Assinaturas (console › /account/sales) sem apagar nada: a
-- linha fica aqui, marcada, e aparece em console › Auditoria, de onde volta. É só visualização: a assinatura continua
-- valendo, a licença não muda e a cobrança na AbacatePay segue. `oculta_por` é o e-mail de quem ocultou.
-- Aplique esta migração ANTES de publicar o Worker que lê as colunas.
ALTER TABLE assinaturas ADD COLUMN oculta_em TEXT;
ALTER TABLE assinaturas ADD COLUMN oculta_por TEXT;
ALTER TABLE pagamentos ADD COLUMN oculta_em TEXT;
ALTER TABLE pagamentos ADD COLUMN oculta_por TEXT;
