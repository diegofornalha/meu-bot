import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
const providers = createRequire(import.meta.url)("../../backend-colima/providers.js");

const tmp = () => mkdtempSync(join(tmpdir(), "meu-bot-providers-"));

test("sem providers.json usa o padrão: agente → grok-4; grok-4 só com XAI_API_KEY", () => {
  const dir = tmp();
  const semChave = providers.load(join(dir, "providers.json"), {});
  assert.deepEqual(semChave.map((p) => [p.name, p.available]), [["agente", true], ["grok-4", false]]);
  const comChave = providers.load(join(dir, "providers.json"), { XAI_API_KEY: "k" });
  assert.deepEqual(comChave.map((p) => [p.name, p.available]), [["agente", true], ["grok-4", true]]);
  assert.deepEqual(providers.chain(semChave, "agente"), ["agente"]);
  assert.deepEqual(providers.chain(comChave, "agente"), ["agente", "grok-4"]);
  assert.deepEqual(providers.chain(comChave, "grok-4"), ["grok-4", "agente"]);
  assert.deepEqual(providers.chain(comChave, "rene-dm"), []);
});

test("providers.json: ordena por prioridade, ignora inválidos e duplicados, endpoint local dispensa chave", () => {
  const dir = tmp();
  const file = join(dir, "providers.json");
  const avisos = [];
  writeFileSync(file, JSON.stringify([
    { name: "grok-4", type: "openai", priority: 1, base_url: "http://127.0.0.1:8645/v1/", model: "grok-4" },
    { name: "agente", type: "claude", priority: 0 },
    { name: "ruim", type: "openai", priority: 2 },
    { name: "Nome Inválido", type: "claude" },
    { name: "agente", type: "claude", priority: 5 },
  ]));
  const list = providers.load(file, {}, (m) => avisos.push(m));
  assert.deepEqual(list.map((p) => p.name), ["agente", "grok-4"]);
  assert.equal(list[1].base_url, "http://127.0.0.1:8645/v1");
  assert.equal(list[1].available, true);
  assert.equal(avisos.length, 2);
  assert.deepEqual(providers.openaiModels(list).map((p) => p.name), ["grok-4"]);
});

test("providers.json malformado cai no padrão com aviso", () => {
  const dir = tmp();
  const file = join(dir, "providers.json");
  writeFileSync(file, "{ isso não é json");
  const avisos = [];
  const list = providers.load(file, {}, (m) => avisos.push(m));
  assert.deepEqual(list.map((p) => p.name), ["agente", "grok-4"]);
  assert.equal(avisos.length, 1);
});

test("fallbackChunk leva o aviso em x_meu_bot e delta vazio", () => {
  const c = providers.fallbackChunk("id1", 1, "grok-4", "agente", "grok-4", "x".repeat(400));
  assert.equal(c.choices[0].delta.content, "");
  assert.equal(c.x_meu_bot.fallback.from, "agente");
  assert.equal(c.x_meu_bot.fallback.reason.length, 300);
});

test("openaiCompletion: stream SSE vira texto + deltas; erro HTTP vira upstream_<status>", async () => {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const j = JSON.parse(body);
      // A primeira mensagem é a identidade ("você é o grok-4, da xAI"), para a pergunta "qual modelo?" não depender do modelo.
      assert.equal(j.messages[0].role, "system");
      assert.match(j.messages[0].content, /modelo grok-4, da xAI/);
      const lastUser = [...j.messages].reverse().find((m) => m.role === "user");
      if (lastUser.content === "falha") { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "sem credencial" } })); return; }
      assert.equal(req.headers.authorization, "Bearer local");
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "" } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ol" } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "á" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const provider = { name: "grok-4", type: "openai", base_url: `http://127.0.0.1:${server.address().port}/v1`, model: "grok-4", timeout_ms: 5000 };
  const deltas = [];
  const out = await providers.openaiCompletion({ provider, env: {}, messages: [{ role: "user", content: "oi" }], onDelta: (t) => deltas.push(t) });
  assert.equal(out.text, "olá");
  assert.deepEqual(deltas, ["ol", "á"]);
  assert.deepEqual(out.usage, { input_tokens: 3, output_tokens: 2 });
  await assert.rejects(providers.openaiCompletion({ provider, env: {}, messages: [{ role: "user", content: "falha" }] }), (e) => e.code === "upstream_401" && /sem credencial/.test(e.message));
  server.close();
});

test("provedores de módulos: entram depois dos da máquina, não substituem um nome que ela já tem e só viram reserva se pedirem", () => {
  const dir = tmp();
  const file = join(dir, "providers.json");
  writeFileSync(file, JSON.stringify([
    { name: "agente", type: "claude", priority: 0 },
    { name: "local", type: "openai", priority: 9, base_url: "http://127.0.0.1:7884/v1", model: "qwen2.5:3b" },
  ]));
  const avisos = [];
  const extras = [
    { name: "motor-x", type: "openai", priority: 1, base_url: "http://127.0.0.1:8646/v1", model: "x-1", rotulo: "Motor X", modulo: "motor-x" },
    { name: "motor-y", type: "openai", priority: 2, base_url: "http://127.0.0.1:8650/v1", model: "y-1", reserva: true, modulo: "motor-y" },
    { name: "local", type: "openai", base_url: "http://127.0.0.1:1/v1", modulo: "intruso" },
    { name: "Nome Ruim", type: "openai", base_url: "http://127.0.0.1:1/v1" },
  ];
  const ps = providers.load(file, {}, (m) => avisos.push(m), extras);
  assert.deepEqual(ps.map((p) => [p.name, p.reserva, p.modulo ?? ""]), [["agente", true, ""], ["motor-x", false, "motor-x"], ["motor-y", true, "motor-y"], ["local", true, ""]]);
  assert.equal(providers.byName(ps, "local").base_url, "http://127.0.0.1:7884/v1", "o da máquina fica");
  assert.equal(providers.byName(ps, "motor-x").rotulo, "Motor X");
  assert.equal(avisos.length, 2);
  // O Claude falhou: desce só para quem aceita ser reserva. Escolhido de propósito, o motor do módulo responde.
  assert.deepEqual(providers.chain(ps, "agente"), ["agente", "motor-y", "local"]);
  assert.deepEqual(providers.chain(ps, "motor-x"), ["motor-x", "agente", "motor-y", "local"]);
  // Sem extras, nada muda para quem já usava o providers.json.
  assert.deepEqual(providers.load(file, {}).map((p) => p.name), ["agente", "local"]);
  assert.deepEqual(providers.chain(providers.load(file, {}), "agente"), ["agente", "local"]);
  // Do próprio providers.json também dá para tirar um provedor da corrente.
  writeFileSync(file, JSON.stringify([{ name: "agente", type: "claude", priority: 0 }, { name: "local", type: "openai", priority: 9, base_url: "http://127.0.0.1:7884/v1", reserva: false }]));
  assert.deepEqual(providers.chain(providers.load(file, {}), "agente"), ["agente"]);
});

test("providers.js: a cópia do backend-vm é idêntica à do backend-colima", () => {
  assert.equal(readFileSync(new URL("../../backend-vm/services/providers.js", import.meta.url), "utf8"), readFileSync(new URL("../../backend-colima/providers.js", import.meta.url), "utf8"));
});
