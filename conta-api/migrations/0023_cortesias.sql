-- Cortesias: o que o admin libera de graça, separado do que a pessoa paga. Cada linha é uma liberação com prazo (`fim`,
-- obrigatório), quem liberou (`por`) e por quê (`motivo`). Vale enquanto `fim` está no futuro e `encerrada_em` é NULL.
-- `tipo`: pro | addon (com `produto`) | maquina | device | assento (com `org_id`, a organização de que a conta é dona).
-- `quantidade`: quantas unidades (máquina, device, usuário); 1 para pro e addon.
-- Aplique esta migração ANTES de publicar o Worker que lê as tabelas.
CREATE TABLE cortesias (
  id TEXT PRIMARY KEY,
  conta_id TEXT NOT NULL REFERENCES contas(id),
  tipo TEXT NOT NULL,
  produto TEXT,
  org_id TEXT,
  quantidade INTEGER NOT NULL DEFAULT 1,
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL,
  motivo TEXT NOT NULL,
  por TEXT NOT NULL,
  encerrada_em TEXT,
  encerrada_por TEXT,
  motivo_encerramento TEXT
);
CREATE INDEX cortesias_conta ON cortesias (conta_id, tipo);
CREATE INDEX cortesias_org ON cortesias (org_id, tipo);
-- Encerramentos feitos pelo admin (Pro, add-on, unidade extra ou cortesia), com o motivo e o que a AbacatePay respondeu
-- ao pedido de parar a cobrança (`cobranca`). É o histórico da conta que o admin vê; a pessoa vê só a data.
CREATE TABLE encerramentos (
  id TEXT PRIMARY KEY,
  conta_id TEXT NOT NULL,
  alvo TEXT NOT NULL,
  ref TEXT NOT NULL,
  motivo TEXT NOT NULL,
  detalhe TEXT,
  cobranca TEXT,
  por TEXT NOT NULL,
  quando TEXT NOT NULL
);
CREATE INDEX encerramentos_conta ON encerramentos (conta_id, quando);
