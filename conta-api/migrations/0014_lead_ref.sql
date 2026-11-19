-- Código por visita: quem clica num botão de WhatsApp do site manda na mensagem pronta um código curto ("cód: ABC234").
-- A linha liga esse código à visita no Analytics (`ga_client_id`, `ga_session_id`), ao clique do anúncio (`gclid`) e à
-- campanha, para quem atende saber de onde veio a conversa e marcar o lead como qualificado (`qualificado_em`; o evento
-- `qualify_lead` vai ao GA4 pelo servidor, `ga_enviado_em`). Não guarda nome, telefone nem a conversa.
CREATE TABLE lead_ref (
  codigo TEXT PRIMARY KEY,
  origem TEXT NOT NULL,
  ga_client_id TEXT,
  ga_session_id TEXT,
  gclid TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  criado_em TEXT NOT NULL,
  qualificado_em TEXT,
  ga_enviado_em TEXT
);
CREATE INDEX lead_ref_criado ON lead_ref (criado_em);
