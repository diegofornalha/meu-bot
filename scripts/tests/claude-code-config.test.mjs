import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { lerConfig, entradasLocais, objeto } = req("../../dist/main/claude-code/config-core.js");

test("claude-code/config-core: lerConfig distingue ausente, ilegível e objeto", () => {
  assert.equal(lerConfig(null), null);
  assert.equal(lerConfig("x"), "ilegivel"); assert.equal(lerConfig("1"), "ilegivel"); assert.equal(lerConfig("[]"), "ilegivel");
  assert.deepEqual(lerConfig("{\"a\":1}"), { a: 1 });
  assert.equal(objeto({}), true); assert.equal(objeto([]), false); assert.equal(objeto(null), false);
});

test("claude-code/config-core: entradasLocais só das pastas com o servidor e que existem", () => {
  const e = { type: "http", url: "http://127.0.0.1:7830/mcp" };
  const j = lerConfig(JSON.stringify({ projects: { "/a": { mcpServers: { "meu-bot": e } }, "/b": { allowedTools: [] }, "/c": { mcpServers: { outro: e } }, "/sumiu": { mcpServers: { "meu-bot": e } } } }));
  assert.deepEqual(entradasLocais(j, "meu-bot", (p) => p !== "/sumiu"), [{ pasta: "/a", entrada: e }]);
  assert.deepEqual(entradasLocais({}, "meu-bot", () => true), []);
});
