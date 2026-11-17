-- O admin encerra um add-on pago (reembolso ou disputa). A marca fica guardada: a assinatura continua viva na
-- AbacatePay até ser cancelada lá, e uma cobrança seguinte não pode devolver o add-on sozinha.
ALTER TABLE addons_pagos ADD COLUMN encerrado_em TEXT;
