// Modo instagramável, a parte pura: cor por nome, rodízio dos nomes e a borda de onde cada cursor entra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CURSORES, NOME_PADRAO, corDoNome, pontoDeEntrada, pontoNaPagina, proximoNome } from "../../dist/renderer/lib/instagramavel-core.js";

test("corDoNome: estável (sem diferenciar maiúsculas) e diferente entre nomes de uma org", () => {
  assert.equal(corDoNome("Ana"), corDoNome("ana"));
  assert.match(corDoNome("Ana"), /^hsl\(\d{1,3} 85% 55%\)$/);
  const cores = new Set(["Ana", "Bruno", "Carla", "Diego", "Eva", "Fábio"].map(corDoNome));
  assert.equal(cores.size, 6);
});

test("proximoNome: rodízio que volta ao começo; sem nomes, o nome do app", () => {
  const nomes = ["Ana", "Bruno", "Carla"];
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => proximoNome(nomes, i)), ["Ana", "Bruno", "Carla", "Ana", "Bruno"]);
  assert.equal(proximoNome([], 7), NOME_PADRAO);
  assert.equal(proximoNome(nomes, -1), "Carla");
});

test("pontoDeEntrada: sempre fora da janela, numa das quatro bordas; o mesmo sorteio dá o mesmo ponto", () => {
  const L = 1200, A = 800;
  assert.deepEqual(pontoDeEntrada(L, A, 0.1), { x: 480, y: -40 });
  assert.deepEqual(pontoDeEntrada(L, A, 0.3), { x: L + 40, y: 160 });
  assert.deepEqual(pontoDeEntrada(L, A, 0.6), { x: 480, y: A + 40 });
  assert.deepEqual(pontoDeEntrada(L, A, 0.85), { x: -40, y: 320 });
  for (let i = 0; i < 200; i++) {
    const p = pontoDeEntrada(L, A, i / 200);
    assert.ok(p.x < 0 || p.x > L || p.y < 0 || p.y > A, `ponto dentro da janela: ${JSON.stringify(p)}`);
  }
  assert.deepEqual(pontoDeEntrada(L, A, 1), pontoDeEntrada(L, A, 0.999999));
  assert.ok(MAX_CURSORES > 0);
});

test("pontoNaPagina: sempre dentro da página, com margem das bordas (a etiqueta do nome não sai dela)", () => {
  const r = { left: 100, top: 50, width: 1000, height: 600 };
  assert.deepEqual(pontoNaPagina(r, 0, 0), { x: 220, y: 122 });
  assert.deepEqual(pontoNaPagina(r, 1, 1), { x: 980, y: 578 });
  assert.deepEqual(pontoNaPagina(r, 0.5, 0.5), { x: 600, y: 350 });
  assert.deepEqual(pontoNaPagina(r, -3, 9), pontoNaPagina(r, 0, 1));
});
