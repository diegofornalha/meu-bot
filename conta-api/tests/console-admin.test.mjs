// Painel do admin no console (public/console/admin-core.js): quando a lista é relida e o que o aviso diz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { VISAO_VELHA_MS, avisoDepoisDo404, cortesiasDaFicha, diaDaqui, estadoCortesia, fimDoDia, oQueACortesiaDa, pedeReleitura, rotuloMotivo, seloDoPlano, visaoVelha } from "../public/console/admin-core.js";

test("só o 404 de uma ação do admin pede a releitura da lista", () => {
  assert.equal(pedeReleitura(404), true);
  for (const s of [400, 401, 403, 409, 500, 501, 502]) assert.equal(pedeReleitura(s), false, String(s));
});

test("conta que saiu da lista relida: o aviso diz que foi removida, sem repetir o erro cru da API", () => {
  const aviso = avisoDepoisDo404("conta não existe", "a", [{ id: "b" }]);
  assert.match(aviso, /não existe mais/);
  assert.match(aviso, /lista foi atualizada/);
});

test("404 de outra coisa (um device) com a conta ainda na lista: mantém o erro da API", () => {
  assert.equal(avisoDepoisDo404("device não existe nesta conta", "a", [{ id: "a" }]), "device não existe nesta conta. A lista foi atualizada.");
});

test("releitura falhou: não afirma que a conta foi removida", () => {
  const aviso = avisoDepoisDo404("conta não existe", "a", null);
  assert.doesNotMatch(aviso, /foi removida/);
  assert.match(aviso, /recarregue/);
});

test("a lista fica velha depois de um minuto; sem leitura não há o que reler", () => {
  assert.equal(visaoVelha(null, 10 * VISAO_VELHA_MS), false);
  assert.equal(visaoVelha(1000, 1000 + VISAO_VELHA_MS), false);
  assert.equal(visaoVelha(1000, 1001 + VISAO_VELHA_MS), true);
});

test("ficha da conta: selo do plano pela origem, o que a cortesia dá, situação e ordem das cortesias", () => {
  assert.deepEqual(seloDoPlano({ origemDoPro: "pago", licenca: { plan: "pro" } }), { texto: "Pro pago", tom: "ok" });
  assert.deepEqual(seloDoPlano({ origemDoPro: "cortesia", licenca: { plan: "pro" } }), { texto: "Pro cortesia", tom: "aviso" });
  assert.equal(seloDoPlano({ origemDoPro: "teste", licenca: { plan: "pro" } }).texto, "Pro em teste");
  assert.deepEqual(seloDoPlano({ origemDoPro: null, licenca: { plan: "free" } }), { texto: "Free", tom: "" });
  const rot = (p) => ({ "meu-bot-finance": "Finanças" })[p] ?? p, org = (id) => ({ o1: "acme" })[id];
  assert.equal(oQueACortesiaDa({ tipo: "pro" }), "Pro");
  assert.equal(oQueACortesiaDa({ tipo: "addon", produto: "meu-bot-finance" }, rot), "Finanças");
  assert.equal(oQueACortesiaDa({ tipo: "maquina", quantidade: 1 }), "1 máquina");
  assert.equal(oQueACortesiaDa({ tipo: "device", quantidade: 2 }), "2 devices");
  assert.equal(oQueACortesiaDa({ tipo: "assento", quantidade: 3, orgId: "o1" }, rot, org), "3 usuários na acme");
  const agora = Date.parse("2026-11-20T12:00:00Z"), d = (n) => new Date(agora + n * 86400000).toISOString();
  assert.equal(estadoCortesia({ fim: d(1), encerradaEm: null }, agora), "vale");
  assert.equal(estadoCortesia({ fim: d(-1), encerradaEm: null }, agora), "venceu");
  assert.equal(estadoCortesia({ fim: d(5), encerradaEm: d(-1) }, agora), "encerrada");
  const cs = [{ id: "a", fim: d(20), encerradaEm: null }, { id: "b", fim: d(3), encerradaEm: null }, { id: "c", fim: d(-2), encerradaEm: null }, { id: "e", fim: d(9), encerradaEm: d(-1) }, { id: "v", fim: d(-200), encerradaEm: null }];
  const f = cortesiasDaFicha(cs, agora);
  assert.deepEqual(f.vale.map((x) => x.id), ["b", "a"], "a que acaba antes no topo");
  assert.deepEqual(f.antigas.map((x) => x.id), ["e", "c"], "as dos últimos 90 dias, a mais recente primeiro");
  assert.equal(fimDoDia("2026-12-01"), "2026-12-01T23:59:59.000Z"); assert.equal(fimDoDia(""), null);
  assert.equal(diaDaqui(30, agora), "2026-12-20");
  assert.equal(rotuloMotivo("reembolso"), "Reembolso pedido pela pessoa"); assert.equal(rotuloMotivo("x"), "x");
});
