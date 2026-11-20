-- Passkeys (WebAuthn) da conta: a pessoa cria no console (Perfil › Login e segurança) e entra com ela na página de
-- login, sem Firebase. `id` é o id da credencial (base64url), `chave_publica` a chave pública em SPKI DER (base64url),
-- `alg` o algoritmo COSE (-7 = ES256, -257 = RS256) e `contador` o último contador de assinaturas que o autenticador
-- mandou (0 nas passkeys sincronizadas). `sincronizada` = 1 quando o autenticador diz que a chave tem cópia (iCloud,
-- Google); `transportes` é a lista que o navegador informou (JSON), só para a tela.
-- Aplique esta migração ANTES de publicar o Worker que lê as tabelas.
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  conta_id TEXT NOT NULL REFERENCES contas(id),
  chave_publica TEXT NOT NULL,
  alg INTEGER NOT NULL,
  contador INTEGER NOT NULL DEFAULT 0,
  sincronizada INTEGER NOT NULL DEFAULT 0,
  transportes TEXT NOT NULL DEFAULT '[]',
  nome TEXT NOT NULL,
  criada_em TEXT NOT NULL,
  usada_em TEXT
);
CREATE INDEX passkeys_conta ON passkeys (conta_id);
-- Desafios de uso único (5 min): `tipo` cadastro (preso à conta que pediu) ou login (sem conta: a credencial diz quem é).
CREATE TABLE passkey_desafios (
  desafio TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  conta_id TEXT,
  expira_em TEXT NOT NULL
);
