-- Unidades extras vendidas à parte (ABACATEPAY_EXTRAS): hoje a máquina extra. Cada assinatura paga é UMA linha e soma
-- 1 ao limite da conta enquanto o prazo dela vale (addons_pagos não serve: lá é uma linha por conta e produto, que só
-- estende o mesmo prazo). O limite em vigor é calculado na leitura: o que o admin gravou em licencas mais as linhas em
-- dia daqui. `encerrado_em`: reservado para o admin encerrar por reembolso ou disputa, como em addons_pagos.
-- Aplique esta migração ANTES de publicar o Worker que lê a tabela.
CREATE TABLE extras_pagos (
  assinatura_id TEXT PRIMARY KEY,
  conta_id TEXT NOT NULL REFERENCES contas(id),
  tipo TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  encerrado_em TEXT
);
CREATE INDEX extras_pagos_conta ON extras_pagos (conta_id, tipo);
