import { test } from "node:test";
import assert from "node:assert/strict";
import { xaiVaiAoGuia } from "../../dist/renderer/lib/xai-entrar.js";

const base = { podeInstalar: true, tutorialFeito: true, conferida: true, preparado: true };

test("Entrar na xAI: guia para quem não fez o tutorial ou está sem o preparo; login direto para quem tem o Grok pronto", () => {
  assert.equal(xaiVaiAoGuia(base), false, "tutorial feito e Grok preparado: direto ao login");
  assert.equal(xaiVaiAoGuia({ ...base, tutorialFeito: false }), true);
  assert.equal(xaiVaiAoGuia({ ...base, preparado: false }), true, "consulta concluída e vazia: máquina sem o preparo (antes dava código 127)");
});

test("Entrar na xAI: consulta ainda não feita ou que falhou não manda ao guia quem já concluiu o tutorial", () => {
  assert.equal(xaiVaiAoGuia({ ...base, conferida: false, preparado: false }), false, "antes do primeiro carregamento, ou SSH falhando por um instante");
  assert.equal(xaiVaiAoGuia({ ...base, conferida: false, preparado: false, tutorialFeito: false }), true, "sem o tutorial, o guia continua");
  assert.equal(xaiVaiAoGuia({ ...base, podeInstalar: false, tutorialFeito: false, preparado: false }), false, "app que não prepara o Grok nunca abre o guia");
});
