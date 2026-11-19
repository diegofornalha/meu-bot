-- O admin atribui uma máquina a uma conta pelo e-mail (gestão, `POST /admin/maquinas/:id/conta`): ela aparece no
-- console dessa conta como "Em uso · licença do admin". `atribuida_por` é o e-mail do admin que atribuiu; NULL = a
-- linha veio do aviso do app da própria pessoa. Linha atribuída não vence em 30 dias sem aviso.
ALTER TABLE maquinas_vistas ADD COLUMN atribuida_por TEXT;
