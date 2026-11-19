-- Quantas organizações a conta pode criar (ser dona): 1 por padrão, e só com o Pro valendo (podeCriarOrg). O admin
-- sobe o número no editor de licença, como faz com devices e máquinas; o super admin não tem limite.
ALTER TABLE licencas ADD COLUMN org_limit INTEGER NOT NULL DEFAULT 1;
