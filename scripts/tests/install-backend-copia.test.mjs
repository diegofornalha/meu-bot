import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// O trecho `copiar_backend` do install.sh, rodado sozinho em bash: o pacote só entra em $DEST inteiro, e um pacote
// incompleto não toca em nada (o server.js velho fica igual). É a proteção contra o acidente de 1/11.
const SH = readFileSync(resolve("backend-colima/install.sh"), "utf8");
const trecho = SH.slice(SH.indexOf("# --- copiar: início"), SH.indexOf("# --- copiar: fim"));
assert.ok(trecho.includes("copiar_backend()"), "o install.sh tem o trecho marcado");

function stage(arquivos) {
  const d = mkdtempSync(join(tmpdir(), "mb-stage-"));
  for (const [nome, texto] of Object.entries(arquivos)) writeFileSync(join(d, nome), texto);
  return d;
}
const SERVER = "const a = require('./session-map');\nconst g = require(\"./gmail\");\nconst p = require('./pontes');\n";
const run = (origem, destino) => spawnSync("bash", ["-c", `set -euo pipefail\n${trecho}\ncopiar_backend "$1" "$2"`, "copiar", origem, destino], { encoding: "utf8" });

test("pacote completo: tudo (.js e .py) vai para o destino, sem pasta temporária sobrando", () => {
  const origem = stage({ "server.js": SERVER, "session-map.js": "s", "gmail.js": "g", "pontes.js": "p", "auditoria.py": "py", "install.sh": "não vai", "VERSION": "1.9.1" });
  const destino = mkdtempSync(join(tmpdir(), "mb-dest-")); mkdirSync(join(destino, "data"));
  const r = run(origem, destino);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(destino).sort(), ["auditoria.py", "data", "gmail.js", "pontes.js", "server.js", "session-map.js"]);
  assert.equal(readFileSync(join(destino, "server.js"), "utf8"), SERVER);
  assert.ok(!readdirSync(destino).some((n) => n.startsWith(".novo")), "a pasta .novo sumiu");
});

test("pacote sem gmail.js: sai com 5, diz o que falta e não toca no destino (server.js velho fica byte a byte)", () => {
  const origem = stage({ "server.js": SERVER, "session-map.js": "s", "pontes.js": "p", "auditoria.py": "py" });
  const destino = mkdtempSync(join(tmpdir(), "mb-dest-"));
  const velho = "const velho = require('./session-map');\n";
  writeFileSync(join(destino, "server.js"), velho); writeFileSync(join(destino, "session-map.js"), "velho");
  const r = run(origem, destino);
  assert.equal(r.status, 5);
  assert.match(r.stderr, /pacote incompleto, o server\.js exige: gmail\.js/);
  assert.equal(readFileSync(join(destino, "server.js"), "utf8"), velho, "o server.js antigo continua");
  assert.equal(readFileSync(join(destino, "session-map.js"), "utf8"), "velho");
  assert.ok(!existsSync(join(destino, "pontes.js")), "nada novo entrou");
});

test("a conferência olha o server.js do pacote, não o do destino", () => {
  const origem = stage({ "server.js": "const x = require('./novo-modulo');\n", "auditoria.py": "py" });
  const destino = mkdtempSync(join(tmpdir(), "mb-dest-"));
  const r = run(origem, destino);
  assert.equal(r.status, 5); assert.match(r.stderr, /novo-modulo\.js/);
});
