import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAnel, filtrarLog, instante } from "../../dist/main/app/erros-janela-core.js";

const e = (em, texto = "x") => ({ em, nivel: "erro", texto, origem: "renderer.js:1" });

test("anel: guarda no máximo o teto, o mais velho sai; devolve do mais velho ao mais novo", () => {
  const a = criarAnel(3);
  for (const t of [1, 2, 3, 4, 5]) a.por(e(t));
  assert.deepEqual(a.desde().map((x) => x.em), [3, 4, 5]);
  assert.deepEqual(a.desde(4).map((x) => x.em), [4, 5]);
  assert.deepEqual(a.desde(undefined, 1).map((x) => x.em), [5]);
  // limite torto não derruba: vale o padrão, preso ao teto.
  assert.equal(a.desde(undefined, -2).length, 3);
});

test("anel: texto e origem compridos são cortados", () => {
  const a = criarAnel();
  a.por({ em: 1, nivel: "erro", texto: "a".repeat(5000), origem: "b".repeat(500) });
  const [x] = a.desde();
  assert.ok(x.texto.length <= 2001 && x.origem.length <= 201);
});

test("instante: milissegundos, data ISO, e o que não dá para ler vira null", () => {
  assert.equal(instante(1000), 1000);
  assert.equal(instante("2026-11-25T10:00:00.000Z"), Date.parse("2026-11-25T10:00:00.000Z"));
  assert.equal(instante("ontem"), null);
  assert.equal(instante(undefined), null);
});

const LOG = [
  "2026-11-25T10:00:00.000Z [tunnel] [local] janela aberta",
  "2026-11-25T10:00:05.000Z [atualização] verificando (inicio)",
  "",
  "2026-11-25T10:01:00.000Z [atualização] o GitHub limitou as consultas deste IP",
  "linha sem data",
  "2026-11-25T10:02:00.000Z [depuracao] nota",
].join("\n");

test("log: as últimas linhas, com filtro sem diferenciar maiúsculas e a partir de um instante", () => {
  assert.equal(filtrarLog(LOG, {}).linhas.length, 5, "linha vazia sai");
  assert.deepEqual(filtrarLog(LOG, { linhas: 2 }).linhas, ["linha sem data", "2026-11-25T10:02:00.000Z [depuracao] nota"]);
  const at = filtrarLog(LOG, { filtro: "ATUALIZAÇÃO" });
  assert.equal(at.total, 2); assert.match(at.linhas[1], /limitou/);
  // desde: só linhas com data e posteriores (a linha sem data não tem como provar que é nova).
  const depois = filtrarLog(LOG, { desde: "2026-11-25T10:00:30.000Z" });
  assert.deepEqual(depois.linhas.map((l) => l.slice(11, 19)), ["10:01:00", "10:02:00"]);
  assert.equal(filtrarLog(LOG, { linhas: 9999 }).linhas.length, 5, "teto de 500 não inventa linha");
  assert.equal(filtrarLog("", {}).total, 0);
});

test("log: linha comprida demais é cortada", () => {
  const r = filtrarLog(`2026-11-25T10:00:00.000Z ${"x".repeat(2000)}`, {});
  assert.ok(r.linhas[0].length <= 501);
});
