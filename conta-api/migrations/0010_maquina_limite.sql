-- A própria pessoa aplica o Pro da conta numa máquina (VM por SSH): a API vincula a máquina e emite a licença assinada.
-- `maquina_limit` é quantas máquinas a conta pode ter com a licença dela ao mesmo tempo (o admin sobe pelo console);
-- é outro número, não o `device_limit` (os Macs onde o app abre).
ALTER TABLE licencas ADD COLUMN maquina_limit INTEGER NOT NULL DEFAULT 1;
-- Desvinculada sem o app ter apagado a licença da máquina (pelo console): a vaga só abre quando a última emissão vence.
ALTER TABLE maquinas ADD COLUMN desvinculada_em TEXT;
