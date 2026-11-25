import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoComputador, registrarQueda } from "../../dist/renderer/lib/computador-core.js";

const base = { local: false, acesso: "ok", status: { instalada: true, rodando: true, erro: null }, fase: "parado", instalacaoPrecisaAdmin: false, caiuDemais: false, semImagem: false };
const est = (over) => estadoComputador({ ...base, ...over });

test("plano vem antes de tudo e nunca vira erro técnico", () => {
  for (const acesso of ["free", "expired", "assinatura"]) assert.equal(est({ acesso, status: { instalada: false, rodando: false, erro: "timeout" } }).kind, "sem-plano");
  const u = est({ acesso: "unknown" });
  assert.equal(u.kind, "plano-desconhecido"); assert.equal(u.acao, "status");
  assert.match(u.texto, /Não é cobrança/);
});

test("cada motivo técnico tem o seu estado e a sua ação", () => {
  assert.equal(est({ local: true }).kind, "local");
  // Este Mac não tem tela, mas a página não é beco sem saída: o botão leva ao seletor de máquinas.
  assert.equal(est({ local: true }).acao, "maquina");
  assert.equal(est({ local: true }).botao, "Abrir uma máquina");
  assert.equal(est({ status: null }).kind, "carregando");
  const fora = est({ status: { instalada: false, rodando: false, erro: "a máquina não respondeu a tempo" } });
  assert.equal(fora.kind, "maquina-fora"); assert.equal(fora.acao, "status"); assert.match(fora.texto, /não respondeu/);
  assert.deepEqual([est({ status: { instalada: false, rodando: false, erro: null } }).kind, est({ status: { instalada: false, rodando: false, erro: null } }).acao], ["sem-tela", "instalar"]);
  assert.equal(est({ status: { instalada: false, rodando: false, erro: null }, instalacaoPrecisaAdmin: true }).kind, "precisa-admin");
  assert.equal(est({ fase: "instalando", status: null }).kind, "instalando");
  assert.deepEqual([est({ status: { instalada: true, rodando: false, erro: null } }).kind, est({ status: { instalada: true, rodando: false, erro: null } }).acao], ["dormindo", "acordar"]);
  assert.equal(est({ fase: "acordando", status: { instalada: true, rodando: false, erro: null } }).kind, "acordando");
  assert.deepEqual([est({ caiuDemais: true }).kind, est({ caiuDemais: true }).acao], ["caiu", "reconectar"]);
  const semImg = est({ semImagem: true });
  assert.equal(semImg.kind, "sem-imagem"); assert.equal(semImg.mostrarTela, true);
});

test("tela: conectando mostra a tela por baixo; ao vivo não tem ação", () => {
  const c = est({ fase: "conectando" });
  assert.equal(c.kind, "conectando"); assert.equal(c.mostrarTela, true);
  const v = est({ fase: "ao-vivo" });
  assert.equal(v.kind, "ao-vivo"); assert.equal(v.acao, null); assert.equal(v.mostrarTela, true);
});

test("quedas: mais de 3 em 60 s param o religar automático; quedas antigas saem da conta", () => {
  let q = [];
  for (const t of [0, 1000, 2000]) { const r = registrarQueda(q, t); q = r.quedas; assert.equal(r.caiuDemais, false); }
  assert.equal(registrarQueda(q, 3000).caiuDemais, true);
  assert.equal(registrarQueda(q, 61_500).caiuDemais, false, "as de 0 e 1000 já passaram de 60 s");
});
