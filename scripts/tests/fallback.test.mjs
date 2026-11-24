import assert from "node:assert/strict";
import { test } from "node:test";
import { fallbackOrderText, fallbackReserve, opcoesDePrimario, primarioNaCorrente } from "../../dist/renderer/lib/fallback.js";

test("fallback: a reserva é quem mais está disponível na corrente; a frase explica primário, reserva e corrente ausente", () => {
  const chain = [{ name: "agente", available: true }, { name: "outro-motor", available: true }];
  assert.equal(primarioNaCorrente("outro-motor", chain), true, "quem diz o que entra na corrente é a máquina");
  assert.equal(primarioNaCorrente("claudecode", chain), false);
  assert.equal(primarioNaCorrente("agente", null), true, "sem a corrente, só o agente é certo");
  assert.equal(primarioNaCorrente("outro-motor", null), false);
  assert.deepEqual(fallbackReserve("agente", chain), ["outro-motor"]);
  assert.deepEqual(fallbackReserve("agente", [{ name: "agente", available: true }, { name: "outro-motor", available: false }]), []);
  assert.match(fallbackOrderText("agente", null), /ainda não informa/);
  assert.match(fallbackOrderText("claudecode", chain), /fora da corrente/);
  assert.match(fallbackOrderText("agente", [{ name: "agente", available: true }]), /Sem reserva/);
  assert.equal(fallbackOrderText("agente", chain), "Primário: agente. Reserva: outro-motor, só se o primário falhar antes de responder. A reserva não gasta nada até ser acionada.");
});

test("primário nesta máquina: o Ollama do modo grátis é opção onde está instalado, e entra na corrente como os outros", () => {
  const sem = [{ name: "agente", available: true }, { name: "outro-motor", available: true }];
  const com = [...sem, { name: "ollama-local", available: true }];
  const modelos = (chain, atual) => opcoesDePrimario(chain, atual).map((o) => o.modelo);
  assert.deepEqual(modelos(sem, "agente"), ["agente", "outro-motor"], "sem o modo grátis instalado, a lista é a de antes");
  assert.deepEqual(modelos(null, "agente"), ["agente"], "backend que não informa a corrente: só o Claude é certo");
  assert.deepEqual(modelos([{ name: "agente", available: true }], "outro-motor"), ["agente"], "provedor que a máquina não tem não é oferecido");
  assert.deepEqual(modelos(com, "agente"), ["agente", "outro-motor", "ollama-local"]);
  assert.deepEqual(modelos([...sem, { name: "ollama-local", available: false }], "outro-motor"), ["agente", "outro-motor", "ollama-local"], "instalado e parado continua na lista (a frase da corrente diz o resto)");
  assert.deepEqual(modelos(sem, "ollama-local"), ["agente", "outro-motor", "ollama-local"], "a escolha atual não some da lista");
  assert.match(opcoesDePrimario(com, "agente").at(-1).texto, /Ollama.*modo grátis.*ollama-local/);

  // Ollama de primário: o Claude e o outro provedor viram a reserva. De reserva: ele é o último da fila.
  assert.deepEqual(fallbackReserve("ollama-local", com), ["agente", "outro-motor"]);
  assert.equal(fallbackOrderText("ollama-local", com), "Primário: ollama-local. Reserva: agente → outro-motor, só se o primário falhar antes de responder. A reserva não gasta nada até ser acionada.");
  assert.equal(fallbackOrderText("agente", com), "Primário: agente. Reserva: outro-motor → ollama-local, só se o primário falhar antes de responder. A reserva não gasta nada até ser acionada.");
  assert.match(fallbackOrderText("ollama-local", sem), /fora da corrente/, "escolhido mas o backend não o tem: sem reserva");
  assert.match(fallbackOrderText("claudecode", com), /agente, outro-motor ou ollama-local/);
});

test("provedor de módulo: aparece com o rótulo; com reserva false pode ser primário mas não é reserva de ninguém", () => {
  const chain = [{ name: "agente", available: true, reserva: true }, { name: "motor-x", available: true, reserva: false, rotulo: "Motor X" }, { name: "outro-motor", available: true, reserva: true }];
  assert.deepEqual(opcoesDePrimario(chain, "agente").map((o) => o.texto), ["Claude (agente)", "Motor X (motor-x)", "outro-motor"]);
  assert.deepEqual(fallbackReserve("agente", chain), ["outro-motor"]);
  assert.equal(fallbackOrderText("agente", chain), "Primário: agente. Reserva: outro-motor, só se o primário falhar antes de responder. A reserva não gasta nada até ser acionada.");
  assert.deepEqual(fallbackReserve("motor-x", chain), ["agente", "outro-motor"], "escolhido de primário, os outros o cobrem");
  // Backend antigo: sem o campo `reserva`, todo provedor disponível é reserva, como sempre foi.
  assert.deepEqual(fallbackReserve("agente", [{ name: "agente", available: true }, { name: "motor-x", available: true }]), ["motor-x"]);
});
