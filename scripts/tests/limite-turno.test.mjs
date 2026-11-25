import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const lt = require("../../backend-colima/limite-turno.js");
const { BACKEND_RUNTIME_FILES } = await import("../../dist/main/maquina/backend-bundle-core.js");

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test("limites do turno: 15 min de silêncio e 2 h no total; o .env da máquina manda", () => {
  assert.deepEqual(lt.limitesDoTurno({}), { ociosoMs: 15 * 60_000, totalMs: 120 * 60_000 });
  assert.deepEqual(lt.limitesDoTurno(undefined), { ociosoMs: 15 * 60_000, totalMs: 120 * 60_000 });
  assert.deepEqual(lt.limitesDoTurno({ TURN_IDLE_MS: "60000", TURN_TIMEOUT_MS: "600000" }), { ociosoMs: 60_000, totalMs: 600_000 });
  for (const ruim of ["", "0", "-5", "abc"]) assert.deepEqual(lt.limitesDoTurno({ TURN_IDLE_MS: ruim, TURN_TIMEOUT_MS: ruim }), { ociosoMs: 15 * 60_000, totalMs: 120 * 60_000 }, `"${ruim}" vira o padrão`);
  assert.ok(lt.OCIOSO_PADRAO_MS > 10 * 60_000, "o silêncio tolera um Bash da CLI no limite dele (10 min)");
});

test("turno longo que continua produzindo não é cortado pelo relógio do silêncio", async () => {
  const estouros = [];
  const v = lt.vigiarTurno({ ociosoMs: 60, totalMs: 5000 }, (q) => estouros.push(q));
  for (let i = 0; i < 8; i++) { await espera(25); v.sinal(); } // 200 ms de trabalho, mais de três vezes o limite de silêncio
  assert.deepEqual(estouros, []);
  v.parar();
  await espera(120);
  assert.deepEqual(estouros, [], "depois de parar, nada dispara");
});

test("CLI calada estoura o silêncio, uma vez só", async () => {
  const estouros = [];
  const v = lt.vigiarTurno({ ociosoMs: 40, totalMs: 5000 }, (q) => estouros.push(q));
  await espera(120);
  v.sinal();
  await espera(80);
  assert.deepEqual(estouros, ["ocioso"]);
  v.parar();
});

test("o teto total vale mesmo com a CLI produzindo", async () => {
  const estouros = [];
  const v = lt.vigiarTurno({ ociosoMs: 1000, totalMs: 80 }, (q) => estouros.push(q));
  for (let i = 0; i < 6; i++) { await espera(25); v.sinal(); }
  assert.deepEqual(estouros, ["total"]);
  v.parar();
});

test("a mensagem do limite é para a pessoa: diz o tempo em minutos ou horas e como seguir", () => {
  const limites = lt.limitesDoTurno({});
  assert.match(lt.mensagemDoLimite("ocioso", limites), /15 min sem dar sinal/);
  assert.match(lt.mensagemDoLimite("total", limites), /passou de 2 h/);
  for (const q of ["ocioso", "total"]) { assert.match(lt.mensagemDoLimite(q, limites), /"continua"/); assert.doesNotMatch(lt.mensagemDoLimite(q, limites), /\d ms\b/); }
  assert.equal(lt.duracao(45_000), "45 s");
  assert.equal(lt.duracao(90 * 60_000), "1 h 30 min");
});

test("o servidor usa o vigia (sem o relógio fixo de 10 min) e o módulo vai no pacote da máquina", () => {
  const server = fs.readFileSync(new URL("../../backend-colima/server.js", import.meta.url), "utf8");
  assert.match(server, /limiteTurno\.vigiarTurno\(LIMITES_TURNO/);
  assert.match(server, /vigia\.sinal\(\)/);
  assert.doesNotMatch(server, /CLI excedeu/);
  assert.ok(BACKEND_RUNTIME_FILES.includes("limite-turno.js"));
});
