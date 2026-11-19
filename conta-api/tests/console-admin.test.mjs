// Painel do admin no console (public/console/admin-core.js): quando a lista é relida e o que o aviso diz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { VISAO_VELHA_MS, avisoDepoisDo404, pedeReleitura, visaoVelha } from "../public/console/admin-core.js";

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
