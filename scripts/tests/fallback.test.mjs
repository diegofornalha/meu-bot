import assert from "node:assert/strict";
import { test } from "node:test";
import { FALLBACK_PRIMARIES, fallbackOrderText, fallbackReserve, opcoesDePrimario } from "../../dist/renderer/lib/fallback.js";

test("fallback: a reserva é quem mais está disponível na corrente; a frase explica primário, reserva e corrente ausente", () => {
  const chain = [{ name: "agente", available: true }, { name: "grok-4", available: true }];
  assert.deepEqual(FALLBACK_PRIMARIES, ["agente", "grok-4", "ollama-local"]);
  assert.deepEqual(fallbackReserve("agente", chain), ["grok-4"]);
  assert.deepEqual(fallbackReserve("agente", [{ name: "agente", available: true }, { name: "grok-4", available: false }]), []);
  assert.match(fallbackOrderText("agente", null), /ainda não informa/);
  assert.match(fallbackOrderText("claudecode", chain), /fora da corrente/);
  assert.match(fallbackOrderText("agente", [{ name: "agente", available: true }]), /Sem reserva/);
  assert.equal(fallbackOrderText("agente", chain), "Primário: agente. Reserva: grok-4, só se o primário falhar antes de responder. A reserva não gasta nada até ser acionada.");
});

test("primário nesta máquina: o Ollama do modo grátis é opção onde está instalado, e entra na corrente como os outros", () => {
  const sem = [{ name: "agente", available: true }, { name: "grok-4", available: true }];
  const com = [...sem, { name: "ollama-local", available: true }];
  const modelos = (chain, atual) => opcoesDePrimario(chain, atual).map((o) => o.modelo);
  assert.deepEqual(modelos(sem, "agente"), ["agente", "grok-4"], "sem o modo grátis instalado, a lista é a de antes");
  assert.deepEqual(modelos(null, "agente"), ["agente", "grok-4"], "backend que não informa a corrente");
  assert.deepEqual(modelos(com, "agente"), ["agente", "grok-4", "ollama-local"]);
  assert.deepEqual(modelos([...sem, { name: "ollama-local", available: false }], "grok-4"), ["agente", "grok-4", "ollama-local"], "instalado e parado continua na lista (a frase da corrente diz o resto)");
  assert.deepEqual(modelos(sem, "ollama-local"), ["agente", "grok-4", "ollama-local"], "a escolha atual não some da lista");
  assert.match(opcoesDePrimario(com, "agente").at(-1).texto, /Ollama.*modo grátis.*ollama-local/);

  // Ollama de primário: Claude e Grok viram a reserva. De reserva: ele é o último da fila.
  assert.deepEqual(fallbackReserve("ollama-local", com), ["agente", "grok-4"]);
  assert.equal(fallbackOrderText("ollama-local", com), "Primário: ollama-local. Reserva: agente → grok-4, só se o primário falhar antes de responder. A reserva não gasta nada até ser acionada.");
  assert.equal(fallbackOrderText("agente", com), "Primário: agente. Reserva: grok-4 → ollama-local, só se o primário falhar antes de responder. A reserva não gasta nada até ser acionada.");
  assert.match(fallbackOrderText("ollama-local", sem), /fora da corrente/, "escolhido mas o backend não o tem: sem reserva");
  assert.match(fallbackOrderText("claudecode", com), /agente, grok-4 ou ollama-local/);
});
