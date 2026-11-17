import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { CONEXOES, conexao, entradaConexao, estadoConexao } = req("../../dist/main/conexoes/conexoes-core.js");
const { lerConfig, entradasLocais } = req("../../dist/main/claude-code/config-core.js");

const salvy = conexao("salvy");
const certa = { type: "http", url: "https://mcp.salvy.com.br/mcp" };
const cfg = (user, projetos) => JSON.stringify({ outra: 1, ...(user === undefined ? {} : { mcpServers: user }), ...(projetos === undefined ? {} : { projects: projetos }) });

test("conexões: catálogo com ids únicos, MCP em https e guia em https", () => {
  assert.equal(new Set(CONEXOES.map((c) => c.id)).size, CONEXOES.length);
  for (const c of CONEXOES) {
    assert.match(c.id, /^[a-z0-9-]+$/, "o id vira nome no claude mcp e prefixo mcp__<id>__");
    assert.equal(new URL(c.url).protocol, "https:"); assert.equal(new URL(c.guia).protocol, "https:");
  }
  assert.equal(salvy.url, "https://mcp.salvy.com.br/mcp");
  assert.equal(conexao("nada"), undefined); assert.equal(conexao(undefined), undefined); assert.equal(conexao({ id: "salvy" }), undefined);
});

test("conexões: Conectar grava só type http + url (o login OAuth é no /mcp do Claude Code)", () => {
  assert.deepEqual(entradaConexao(salvy), certa);
});

test("conexões: estado lido do ~/.claude.json", () => {
  assert.deepEqual(estadoConexao(null, salvy), { estado: "ausente" });
  assert.deepEqual(estadoConexao(cfg(undefined), salvy), { estado: "ausente" });
  assert.deepEqual(estadoConexao(cfg({ outro: certa }), salvy), { estado: "ausente" });
  assert.deepEqual(estadoConexao(cfg({ salvy: certa }), salvy), { estado: "registrado", locais: [] });
  // Feita à mão com outra url ou como stdio: não é nossa, e o botão vira Substituir.
  assert.deepEqual(estadoConexao(cfg({ salvy: { type: "http", url: "https://outro/mcp" } }), salvy), { estado: "outra-config", atual: "https://outro/mcp", user: true, locais: [] });
  assert.deepEqual(estadoConexao(cfg({ salvy: { command: "npx", args: ["mcp-remote"] } }), salvy), { estado: "outra-config", atual: "comando npx", user: true, locais: [] });
  // Local com outra config vence a user naquela pasta.
  assert.deepEqual(estadoConexao(cfg({ salvy: certa }, { "/p": { mcpServers: { salvy: { type: "sse", url: "https://velho" } } } }), salvy), { estado: "outra-config", atual: "https://velho", user: true, locais: ["/p"] });
  // Local igual à do catálogo: registrado, mas Conectar a tira (fica só a user).
  assert.deepEqual(estadoConexao(cfg(undefined, { "/p": { mcpServers: { salvy: certa } } }), salvy), { estado: "registrado", locais: ["/p"] });
  // Pasta apagada não conta.
  assert.deepEqual(estadoConexao(cfg({ salvy: certa }, { "/sumiu": { mcpServers: { salvy: { url: "x" } } } }), salvy, (p) => p !== "/sumiu"), { estado: "registrado", locais: [] });
  assert.deepEqual(estadoConexao("{ quebrado", salvy), { estado: "ilegivel" });
  assert.deepEqual(estadoConexao("[]", salvy), { estado: "ilegivel" });
  assert.deepEqual(estadoConexao(JSON.stringify({ mcpServers: [] }), salvy), { estado: "ilegivel" });
});

test("claude-code/config-core: lerConfig e entradasLocais", () => {
  assert.equal(lerConfig(null), null); assert.equal(lerConfig("x"), "ilegivel"); assert.equal(lerConfig("1"), "ilegivel");
  const j = lerConfig(cfg({}, { "/a": { mcpServers: { salvy: certa } }, "/b": { allowedTools: [] }, "/c": { mcpServers: { outro: certa } } }));
  assert.deepEqual(entradasLocais(j, "salvy", () => true), [{ pasta: "/a", entrada: certa }]);
});
