import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { hostPadrao } = createRequire(import.meta.url)("../../dist/main/maquina/host-padrao-core.js");

test("hostPadrao: com o host local oferecido é ele, tenha a lista o que tiver", () => {
  assert.equal(hostPadrao("local", ["local", "vps-1"]), "local");
  assert.equal(hostPadrao("local", []), "local");
});

test("hostPadrao: sem o host local (Windows) é a primeira máquina da lista", () => {
  assert.equal(hostPadrao(null, ["vps-1", "vps-2"]), "vps-1");
});

test("hostPadrao: sem o host local e sem máquina nenhuma não há padrão (o seletor abre vazio)", () => {
  assert.equal(hostPadrao(null, []), null);
});
