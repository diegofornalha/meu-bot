import { test } from "node:test";
import assert from "node:assert/strict";
import { ehAcaoDoNavegador } from "../../dist/renderer/lib/navegador-ferramenta.js";

test("ehAcaoDoNavegador: o MCP da máquina por SSH e o controle do próprio app em Este Mac", () => {
  assert.equal(ehAcaoDoNavegador("mcp__navegador__abrir"), true, "máquina por SSH");
  assert.equal(ehAcaoDoNavegador("mcp__meu-bot__nav_abrir"), true, "Este Mac, app estável");
  assert.equal(ehAcaoDoNavegador("mcp__meu-bot-staging__nav_abrir"), true, "Este Mac, staging (o caso de 18 nov)");
  assert.equal(ehAcaoDoNavegador("mcp__meu-bot-inspector-staging__nav_ler"), true);
});

test("ehAcaoDoNavegador: o resto do controle do app e outras ferramentas não contam", () => {
  assert.equal(ehAcaoDoNavegador("mcp__meu-bot-staging__nota"), false, "a nota não é navegar");
  assert.equal(ehAcaoDoNavegador("mcp__meu-bot-staging__terminal_digitar"), false);
  assert.equal(ehAcaoDoNavegador("mcp__gmail__nav_abrir"), false, "outro servidor");
  assert.equal(ehAcaoDoNavegador("mcp__meu-botx__nav_abrir"), false);
  assert.equal(ehAcaoDoNavegador("Bash"), false);
});
