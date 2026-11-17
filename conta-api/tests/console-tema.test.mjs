// Tema do console (public/console/tema.js): claro por padrão, a escolha guardada vale, valor estranho vira claro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const fonte = readFileSync(new URL("../public/console/tema.js", import.meta.url), "utf8");
/** Roda o tema.js com um document e um localStorage de mentira; `guardado` é o valor inicial (ou "quebra" para lançar). */
function rodar(guardado) {
  const mem = new Map(guardado === undefined || guardado === "quebra" ? [] : [["meu-bot.console.tema", guardado]]);
  const quebra = guardado === "quebra";
  const localStorage = {
    getItem(k) { if (quebra) throw new Error("bloqueado"); return mem.has(k) ? mem.get(k) : null; },
    setItem(k, v) { if (quebra) throw new Error("bloqueado"); mem.set(k, String(v)); },
    removeItem(k) { if (quebra) throw new Error("bloqueado"); mem.delete(k); },
  };
  const document = { documentElement: { dataset: {} } };
  const window = {};
  vm.runInNewContext(fonte, { window, document, localStorage });
  return { tema: () => document.documentElement.dataset.tema, api: window.MEU_BOT_TEMA, mem };
}

test("tema do console: claro por padrão e quando o valor guardado é estranho ou o armazenamento falha", () => {
  assert.equal(rodar(undefined).tema(), "claro");
  assert.equal(rodar("roxo").tema(), "claro");
  assert.equal(rodar("quebra").tema(), "claro");
});

test("tema do console: a escolha guardada vale na abertura e definir() troca na hora e guarda", () => {
  assert.equal(rodar("escuro").tema(), "escuro");
  assert.equal(rodar("sistema").tema(), "sistema");
  const r = rodar(undefined);
  r.api.definir("escuro");
  assert.equal(r.tema(), "escuro"); assert.equal(r.mem.get("meu-bot.console.tema"), "escuro"); assert.equal(r.api.atual(), "escuro");
  r.api.definir("claro");
  assert.equal(r.tema(), "claro"); assert.equal(r.mem.has("meu-bot.console.tema"), false, "o padrão não ocupa o armazenamento");
  r.api.definir("qualquer");
  assert.equal(r.tema(), "claro");
  const q = rodar("quebra"); q.api.definir("escuro");
  assert.equal(q.tema(), "escuro", "sem armazenamento, vale nesta página");
});
