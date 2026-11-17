-- Lista de espera do site: quem chega por uma plataforma que o meu-bot ainda não atende (hoje, Windows) deixa um
-- e-mail ou WhatsApp para ser avisado no lançamento. Sem conta: é o único contato guardado antes do cadastro.
-- `ga_client_id` e `gclid` ligam o contato à visita e ao anúncio de onde veio; `avisado_em` marca quem já recebeu o aviso.
CREATE TABLE lista_espera (
  id TEXT PRIMARY KEY,
  contato TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('email', 'whatsapp')),
  plataforma TEXT NOT NULL,
  origem TEXT NOT NULL,
  ga_client_id TEXT,
  gclid TEXT,
  criado_em TEXT NOT NULL,
  avisado_em TEXT,
  UNIQUE (contato, plataforma)
);
CREATE INDEX lista_espera_criado ON lista_espera (criado_em);
