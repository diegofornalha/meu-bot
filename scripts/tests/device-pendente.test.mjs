import { test } from "node:test";
import assert from "node:assert/strict";
import { CAMINHO_DEVICE, DEVICE_PENDENTE_TEXTO, DEVICE_PENDENTE_TITULO, ehDevicePendente, resultadoDaConferencia } from "../../dist/renderer/lib/device-pendente.js";
import { readFileSync } from "node:fs";

test("device pendente: só o código do backend vira o aviso; o resto segue o erro de sempre", () => {
  assert.equal(ehDevicePendente("device_pending"), true);
  for (const c of [undefined, "", "model_limit", "forbidden", "device_pending "]) assert.equal(ehDevicePendente(c), false);
  // O código é o que o backend manda de verdade (backend-colima/server.js), não uma cópia que pode divergir.
  assert.match(readFileSync(new URL("../../backend-colima/server.js", import.meta.url), "utf8"), /code: 'device_pending'/);
});

test("device pendente: o aviso diz o que houve e os dois caminhos, sem preço (o preço é do console)", () => {
  assert.match(DEVICE_PENDENTE_TITULO, /limite de devices/);
  assert.match(DEVICE_PENDENTE_TEXTO, /Adicione um device no console/);
  assert.match(DEVICE_PENDENTE_TEXTO, /Já adicionei: conferir/);
  assert.doesNotMatch(`${DEVICE_PENDENTE_TITULO} ${DEVICE_PENDENTE_TEXTO}`, /R\$/);
  assert.match(CAMINHO_DEVICE, /^\/[A-Za-z0-9/_-]{0,80}$/, "caminho que o abrirConsole aceita");
});

test("device pendente: o resultado da conferência conforme o que o backend respondeu", () => {
  assert.deepEqual(resultadoDaConferencia("active"), { texto: "Pronto: este Mac entrou. Pode mandar a mensagem de novo.", ok: true });
  assert.equal(resultadoDaConferencia("pending").ok, false); assert.match(resultadoDaConferencia("pending").texto, /Ainda não há vaga/);
  assert.equal(resultadoDaConferencia(null).ok, false); assert.match(resultadoDaConferencia(null).texto, /não respondeu/);
});
