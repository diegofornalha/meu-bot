import { test } from "node:test";
import assert from "node:assert/strict";
import { resolverSecao } from "../../dist/renderer/lib/secao-core.js";

test("sem clique guardado: vale o padrão, e motivo de atenção abre sozinho", () => {
  assert.deepEqual(resolverSecao(undefined, false, ""), { aberta: false, guardar: undefined });
  assert.deepEqual(resolverSecao(undefined, true, ""), { aberta: true, guardar: undefined });
  assert.deepEqual(resolverSecao(undefined, false, "erro"), { aberta: true, guardar: undefined });
});

test("o clique da pessoa sobrevive ao repintar, aberto ou fechado", () => {
  const abriu = { aberta: true, atencao: "" };
  assert.deepEqual(resolverSecao(abriu, false, ""), { aberta: true, guardar: abriu });
  const fechou = { aberta: false, atencao: "sem-senha" };
  // Fechou vendo o aviso: o mesmo aviso não reabre a seção a cada repintar.
  assert.deepEqual(resolverSecao(fechou, false, "sem-senha"), { aberta: false, guardar: fechou });
});

test("motivo novo abre sem apagar o clique; passado ele, volta ao que a pessoa escolheu", () => {
  const fechou = { aberta: false, atencao: "sem-senha" };
  const durante = resolverSecao(fechou, false, "sem-senha+guardando");
  assert.deepEqual(durante, { aberta: true, guardar: fechou });
  assert.equal(resolverSecao(durante.guardar, false, "sem-senha").aberta, false);
});

test("motivo que some é esquecido: se voltar, a seção abre de novo", () => {
  const fechou = { aberta: false, atencao: "erro" };
  const sem = resolverSecao(fechou, false, "");
  assert.deepEqual(sem, { aberta: false, guardar: { aberta: false, atencao: "" } });
  assert.equal(resolverSecao(sem.guardar, false, "erro").aberta, true);
});
