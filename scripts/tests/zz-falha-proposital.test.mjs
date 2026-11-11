// Teste quebrado DE PROPÓSITO (issue #239): prova que o job chamar-claude do testes.yml dispara o Claude automático
// quando um teste falha num PR deste repo. Este PR não é para mesclar; ele é fechado depois da prova.
import { test } from "node:test";
import assert from "node:assert/strict";

test("falha proposital para a issue #239 (não mesclar)", () => {
  assert.equal(1 + 1, 3, "falha de propósito: o chamar-claude deve acordar o Claude automático");
});
