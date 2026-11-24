import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
const providers = createRequire(import.meta.url)("../../backend-colima/providers.js");

const tmp = () => mkdtempSync(join(tmpdir(), "meu-bot-providers-"));

test("sem providers.json usa o padrão: só o agente (Claude), e nenhuma chave do ambiente acrescenta outro motor", () => {
  const dir = tmp();
  assert.deepEqual(providers.DEFAULT_PROVIDERS.map((p) => [p.name, p.type]), [["agente", "claude"]]);
  assert.deepEqual(JSON.parse(readFileSync(new URL("../../backend-colima/providers.json", import.meta.url), "utf8")).map((p) => [p.name, p.type]), [["agente", "claude"]], "o providers.json que vai para a máquina nova é o mesmo padrão");
  for (const env of [{}, { XAI_API_KEY: "k" }]) {
    const ps = providers.load(join(dir, "providers.json"), env);
    assert.deepEqual(ps.map((p) => [p.name, p.available]), [["agente", true]]);
    assert.deepEqual(providers.chain(ps, "agente"), ["agente"]);
    assert.deepEqual(providers.openaiModels(ps), []);
    assert.deepEqual(providers.chain(ps, "rene-dm"), []);
  }
});

test("providers.json com um motor a mais e chave no ambiente: ele só fica disponível com a chave e entra na corrente dos dois lados", () => {
  const dir = tmp();
  const file = join(dir, "providers.json");
  writeFileSync(file, JSON.stringify([
    { name: "agente", type: "claude", priority: 0 },
    { name: "motor-x", type: "openai", priority: 1, base_url: "https://api.exemplo.invalid/v1", model: "x-1", key_env: "MOTOR_X_KEY" },
  ]));
  const semChave = providers.load(file, {});
  assert.deepEqual(semChave.map((p) => [p.name, p.available]), [["agente", true], ["motor-x", false]]);
  const comChave = providers.load(file, { MOTOR_X_KEY: "k" });
  assert.deepEqual(comChave.map((p) => [p.name, p.available]), [["agente", true], ["motor-x", true]]);
  assert.deepEqual(providers.chain(semChave, "agente"), ["agente"]);
  assert.deepEqual(providers.chain(comChave, "agente"), ["agente", "motor-x"]);
  assert.deepEqual(providers.chain(comChave, "motor-x"), ["motor-x", "agente"]);
});

test("providers.json: ordena por prioridade, ignora inválidos e duplicados, endpoint local dispensa chave", () => {
  const dir = tmp();
  const file = join(dir, "providers.json");
  const avisos = [];
  writeFileSync(file, JSON.stringify([
    { name: "motor-x", type: "openai", priority: 1, base_url: "http://127.0.0.1:8645/v1/", model: "x-1" },
    { name: "agente", type: "claude", priority: 0 },
    { name: "ruim", type: "openai", priority: 2 },
    { name: "Nome Inválido", type: "claude" },
    { name: "agente", type: "claude", priority: 5 },
  ]));
  const list = providers.load(file, {}, (m) => avisos.push(m));
  assert.deepEqual(list.map((p) => p.name), ["agente", "motor-x"]);
  assert.equal(list[1].base_url, "http://127.0.0.1:8645/v1");
  assert.equal(list[1].available, true);
  assert.equal(avisos.length, 2);
  assert.deepEqual(providers.openaiModels(list).map((p) => p.name), ["motor-x"]);
});

test("providers.json malformado cai no padrão com aviso", () => {
  const dir = tmp();
  const file = join(dir, "providers.json");
  writeFileSync(file, "{ isso não é json");
  const avisos = [];
  const list = providers.load(file, {}, (m) => avisos.push(m));
  assert.deepEqual(list.map((p) => p.name), ["agente"]);
  assert.equal(avisos.length, 1);
});

test("fallbackChunk leva o aviso em x_meu_bot e delta vazio", () => {
  const c = providers.fallbackChunk("id1", 1, "motor-x", "agente", "motor-x", "x".repeat(400));
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
      // A primeira mensagem é a identidade ("você é o x-1, da <endereço do provedor>"), para a pergunta "qual modelo?" não depender do modelo.
      assert.equal(j.messages[0].role, "system");
      assert.match(j.messages[0].content, /modelo x-1, da 127\.0\.0\.1:\d+\./);
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
  const provider = { name: "motor-x", type: "openai", base_url: `http://127.0.0.1:${server.address().port}/v1`, model: "x-1", timeout_ms: 5000 };
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
  // Um módulo não alcança as chaves da máquina: `key_env` de um extra é descartado (a chave dele vem resolvida em `key`).
  const env = { XAI_API_KEY: "segredo-da-maquina" };
  const fora = providers.load(file, env, () => {}, [
    { name: "espiao", type: "openai", base_url: "https://exemplo.invalid/v1", key_env: "XAI_API_KEY", modulo: "espiao" },
    { name: "com-chave", type: "openai", base_url: "https://api.exemplo.invalid/v1", key: "chave-do-modulo", key_env: "XAI_API_KEY", modulo: "ok" },
  ]);
  assert.equal(providers.byName(fora, "espiao").key_env, undefined);
  assert.equal(providers.resolveKey(providers.byName(fora, "espiao"), env), "");
  assert.equal(providers.byName(fora, "espiao").available, false, "endereço externo sem chave própria não fica disponível");
  assert.equal(providers.resolveKey(providers.byName(fora, "com-chave"), env), "chave-do-modulo");
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
