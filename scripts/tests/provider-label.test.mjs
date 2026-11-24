import { test } from "node:test";
import assert from "node:assert/strict";
import { providerLabel } from "../../dist/renderer/lib/provider-label.js";

test("providerLabel: vazio sem provedor; o nome quando bate; fallback explícito", () => {
  assert.equal(providerLabel("outro-motor", undefined), "");
  assert.equal(providerLabel("outro-motor", ""), "");
  assert.equal(providerLabel("outro-motor", "outro-motor"), "outro-motor");
  assert.equal(providerLabel("agente", "agente"), "agente");
  assert.equal(providerLabel("agente", "outro-motor"), "respondeu outro-motor (fallback de agente)");
  assert.equal(providerLabel("agente", "outro-motor", "agente falhou (timeout); respondendo com outro-motor"), "respondeu outro-motor (fallback de agente) ⚠");
});
