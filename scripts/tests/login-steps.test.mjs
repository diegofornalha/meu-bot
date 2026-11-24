import { test } from "node:test";
import assert from "node:assert/strict";
import { loginView, LOGIN_STEPS } from "../../dist/renderer/lib/login-steps.js";

const ctx = { machine: "agente-box", running: true };
const states = (v) => v.steps.map((s) => s.state);

test("Claude: parado mostra a intro com a máquina; começando, o primeiro passo fica em andamento", () => {
  const parado = loginView("claude", [], { machine: "agente-box", running: false });
  assert.match(parado.headline, /^Abre o link de autorização/); assert.match(parado.headline, /agente-box/);
  assert.deepEqual(states(parado), ["pending", "pending", "pending", "pending"]);
  assert.deepEqual(states(loginView("claude", [], ctx)), ["active", "pending", "pending", "pending"]);
});

test("Claude: falha marca o passo em andamento como falhou; o ruído do SSH some e a linha desconhecida fica nos detalhes", () => {
  const v = loginView("claude", [
    { kind: "log", text: "conectando a colima e iniciando claude auth login" },
    { kind: "log", text: "claude: command not found" },
    { kind: "log", text: "Connection to 187.127.41.175 closed." },
    { kind: "done", ok: false, text: "o login não concluiu (código 127)." },
  ], { machine: "colima", running: false });
  assert.deepEqual(states(v), ["done", "bad", "pending", "pending"]); assert.equal(v.result, "fail"); assert.match(v.headline, /^✗ o login não concluiu/);
  assert.deepEqual(v.details, ["claude: command not found"]);
});

test("código do dispositivo, quando o login traz um: fica em destaque e some depois de concluir", () => {
  const evs = [{ kind: "log", text: "código do dispositivo: VTSE-5Q48 (a página já vem com ele; confira e aprove)" }];
  assert.equal(loginView("claude", evs, ctx).code, "VTSE-5Q48");
  assert.deepEqual(loginView("claude", evs, ctx).details, [], "a linha do código não vira detalhe cru");
  assert.equal(loginView("claude", [...evs, { kind: "done", ok: true, text: "logado" }], { ...ctx, running: false }).code, null);
});

test("Claude: link → código → enviado → conferindo → logado", () => {
  const evs = [{ kind: "log", text: "conectando a colima e iniciando claude auth login" }, { kind: "url", url: "https://claude.ai/oauth/authorize?x" }];
  let v = loginView("claude", evs, { machine: "colima", running: true });
  assert.deepEqual(states(v), ["done", "done", "active", "pending"]); assert.match(v.headline, /cole aqui o código/);
  evs.push({ kind: "waiting-code" }); v = loginView("claude", evs, { machine: "colima", running: true });
  assert.equal(v.steps[2].detail, "Cole o código abaixo e envie.");
  v = loginView("claude", evs, { machine: "colima", running: true, codeSent: true });
  assert.deepEqual(states(v), ["done", "done", "done", "active"]); assert.equal(v.headline, "Código enviado; conferindo o login…");
  evs.push({ kind: "done", ok: true, text: "Claude Code logado nesta máquina." });
  v = loginView("claude", evs, { machine: "colima", running: false, codeSent: true });
  assert.deepEqual(states(v), ["done", "done", "done", "done"]);
  assert.equal(LOGIN_STEPS.claude.length, 4);
  assert.deepEqual(Object.keys(LOGIN_STEPS), ["claude"], "o login da xAI saiu do app com o Grok");
});
