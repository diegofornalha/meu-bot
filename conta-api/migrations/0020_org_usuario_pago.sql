-- Usuário pago da organização: uma unidade extra ("assento") cuja vaga é da ORGANIZAÇÃO, não de quem pagou.
-- `org_id` no checkout diz para qual organização a compra é; em extras_pagos, de qual organização é a vaga (`conta_id`
-- continua sendo quem paga). Nas outras unidades (máquina, device) fica NULL.
ALTER TABLE pagamento_checkouts ADD COLUMN org_id TEXT;
ALTER TABLE extras_pagos ADD COLUMN org_id TEXT;
CREATE INDEX extras_pagos_org ON extras_pagos (org_id, tipo);
-- A organização passa a incluir 1 usuário, a dona (antes nascia com 5). Quem estava no padrão antigo fica com o que já
-- usa: 1, ou o número de pessoas que já estão nela (ativas e convidadas), para ninguém ficar acima do limite. Número
-- diferente de 5 foi posto pelo super admin e fica como está. As novas nascem com 1 pelo código (ASSENTOS_INCLUSOS).
UPDATE organizacoes SET assentos = MAX(1, (SELECT COUNT(*) FROM membros m WHERE m.org_id = organizacoes.id)) WHERE assentos = 5;
