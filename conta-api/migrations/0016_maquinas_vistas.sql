-- As máquinas (VMs por SSH) que a pessoa abre pelo app, logada, e que NÃO usam a licença da conta (rodam com a que o
-- admin gravou nelas). O app avisa (`POST /conta/maquinas/:id/visto`) e o console as lista ao lado das de `maquinas`.
-- É só exibição: não dá licença, não ocupa vaga e não entra em nenhuma conta de limite; por isso fica fora de
-- `maquinas`, que as regras de vaga leem. A mesma máquina pode ser vista por mais de uma conta.
CREATE TABLE maquinas_vistas (
  conta_id TEXT NOT NULL,
  id TEXT NOT NULL,
  apelido TEXT,
  origem TEXT NOT NULL,
  vista_em TEXT NOT NULL,
  PRIMARY KEY (conta_id, id)
);
