import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const nivel = require("../../backend-colima/nivel-ferramentas.js");

test("nível do WhatsApp (Hermes): o backend bloqueia ferramentas conforme o tutorial 8", () => {
  assert.deepEqual(nivel.ferramentasBloqueadas("age"), []);
  for (const t of ["Bash", "Write", "Edit", "Task"]) assert.ok(nivel.ferramentasBloqueadas("conversa").includes(t), `conversa sem ${t}`);
  assert.ok(nivel.ferramentasBloqueadas("consulta").includes("Bash"));
  assert.ok(!nivel.ferramentasBloqueadas("consulta").includes("Write"), "consulta ainda anota no workspace");
  assert.ok(!nivel.ferramentasBloqueadas("conversa").some((t) => t.startsWith("mcp__navegador")), "o Navegador fica, como no OpenClaw do dono");
  assert.equal(nivel.avisoDoNivel("age"), "");
  assert.match(nivel.avisoDoNivel("conversa"), /só conversa/);
});

test("nível do WhatsApp: lido do objetivo.json; sem arquivo ou inválido, 'age' (como antes)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "nivel-"));
  const f = path.join(d, "objetivo.json");
  assert.equal(nivel.nivelAtual(f), "age");
  fs.writeFileSync(f, JSON.stringify({ level: "conversa" })); assert.equal(nivel.nivelAtual(f), "conversa");
  fs.writeFileSync(f, JSON.stringify({ level: "qualquer" })); assert.equal(nivel.nivelAtual(f), "age");
  fs.writeFileSync(f, "{lixo"); assert.equal(nivel.nivelAtual(f), "age");
});

test("backend: o perfil whatsapp existe, passa --disallowedTools e segue a corrente do agente (Grok de reserva)", () => {
  const src = fs.readFileSync(new URL("../../backend-colima/server.js", import.meta.url), "utf8");
  assert.match(src, /whatsapp: \{[^}]*nivel: true/);
  assert.match(src, /'--disallowedTools', bloqueadas\.join\(','\)/);
  assert.match(src, /model === 'whatsapp' \? \['whatsapp', \.\.\.providers\.chain\(PROVIDERS, 'agente'\)\.slice\(1\)\]/);
  const { BACKEND_RUNTIME_FILES } = require("../../dist/main/maquina/backend-bundle-core.js");
  assert.ok(BACKEND_RUNTIME_FILES.includes("nivel-ferramentas.js"), "a lista única do pacote leva o módulo para a máquina");
});

test("Hermes: o WhatsApp usa o modelo 'whatsapp' só com backend 1.3.0+, e o tutorial 8 informa a trava pelo backend", () => {
  const h = require("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  assert.match(h.HERMES_WA_ENSURE_SH, /mod_wa = "whatsapp" if vtupla\(os\.environ\.get\("HV"\)\) >= \(1, 3, 0\) else "agente"/);
  const o = require("../../dist/main/agente/objetivo-core.js");
  const sh = o.saveObjectiveSh({ id: "outro", label: "Outro", text: "x" }, "conversa", "m", "2026-10-28T00:00:00Z");
  assert.match(sh, /if usa_hermes; then[\s\S]*LOCK=backend[\s\S]*elif \[ -n "\$N" \]/);
});

test("backend como root: o Claude Code roda sem pedir permissão com IS_SANDBOX=1 (senão todo turno caía no Grok)", () => {
  const src = fs.readFileSync(new URL("../../backend-colima/server.js", import.meta.url), "utf8");
  assert.match(src, /bypass && typeof process\.getuid === 'function' && process\.getuid\(\) === 0 \? \{ IS_SANDBOX: '1' \}/);
});
