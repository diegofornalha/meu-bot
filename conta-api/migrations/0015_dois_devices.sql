-- O plano passa a incluir 2 devices (o Mac do escritório e o notebook): quem estava no padrão antigo de 1 sobe para 2.
-- Limite que o admin já tinha subido (2 ou mais) fica como está. As linhas novas nascem com 2 pelo código
-- (DEVICES_INCLUSOS, src/licenca-core.ts); o DEFAULT 1 da coluna não é mais usado por nenhum INSERT.
UPDATE licencas SET device_limit = 2 WHERE device_limit = 1;
