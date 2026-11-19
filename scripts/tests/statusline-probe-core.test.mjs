// A sondagem da status line por SSH, rodada de verdade em sh, bash e zsh (o shell de login de um Mac é o zsh).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const { MANAGED_SETTINGS, STATUSLINE_SH, statuslineSh } = createRequire(import.meta.url)("../../dist/main/maquina/statusline-probe-core.js");

const SHELLS = ["/bin/sh", "/bin/bash", "/bin/zsh"].filter((s) => existsSync(s));
const NOSSA = "#!/bin/bash\n# grava ~/.claude/ratelimits.json\n", ALHEIA = "#!/bin/bash\necho oi\n";

/** Um HOME e uma pasta de settings gerenciadas (com espaço no caminho, como a do macOS) só deste caso. */
function caso({ doUsuario = null, gerenciada = null, managedJson = undefined }) {
  const raiz = mkdtempSync(join(tmpdir(), "sl-probe-"));
  const home = join(raiz, "home"), pasta = join(raiz, "Application Support", "ClaudeCode");
  mkdirSync(join(home, ".claude"), { recursive: true }); mkdirSync(pasta, { recursive: true });
  if (doUsuario !== null) writeFileSync(join(home, ".claude", "statusline.sh"), doUsuario);
  const script = join(pasta, "statusline.sh");
  if (gerenciada !== null) writeFileSync(script, gerenciada);
  const managed = join(pasta, "managed-settings.json");
  if (managedJson !== undefined) writeFileSync(managed, typeof managedJson === "function" ? managedJson(script) : managedJson);
  const saidas = SHELLS.map((sh) => spawnSync(sh, ["-c", statuslineSh(managed)], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: home } }).stdout.trim());
  rmSync(raiz, { recursive: true, force: true });
  return saidas;
}
const todos = (v) => SHELLS.map(() => `statusline=${v}`);
const comStatusLine = (script) => JSON.stringify({ statusLine: { type: "command", command: `bash '${script}'` } }, null, 2);

test("sondagem da status line: sem settings gerenciadas vale o script do usuário", () => {
  assert.ok(SHELLS.length > 0);
  assert.deepEqual(caso({ doUsuario: NOSSA }), todos(1));
  assert.deepEqual(caso({ doUsuario: ALHEIA }), todos("outra"), "status line de outra origem: existe, mas não grava o cache");
  assert.deepEqual(caso({}), todos(0));
  assert.deepEqual(caso({ doUsuario: NOSSA, managedJson: JSON.stringify({ env: {} }) }), todos(1), "gerenciadas sem statusLine não mandam");
});

test("sondagem da status line: settings gerenciadas com statusLine ganham do script do usuário", () => {
  assert.deepEqual(caso({ gerenciada: NOSSA, managedJson: comStatusLine }), todos(1), "a global instalada conta, mesmo sem nada no ~/.claude");
  assert.deepEqual(caso({ doUsuario: NOSSA, gerenciada: ALHEIA, managedJson: comStatusLine }), todos("outra"), "a do usuário não vale quando a gerenciada manda (o caso da status line global de um Mac)");
  assert.deepEqual(caso({ doUsuario: NOSSA, managedJson: comStatusLine }), todos(0), "gerenciada aponta para um script que não existe");
  assert.deepEqual(caso({ doUsuario: NOSSA, managedJson: JSON.stringify({ statusLine: { type: "command", command: "echo fixo" } }) }), todos(0), "statusLine gerenciada sem statusline.sh");
});

test("sondagem da status line: o trecho padrão olha o caminho do macOS", () => {
  assert.equal(MANAGED_SETTINGS, "/Library/Application Support/ClaudeCode/managed-settings.json");
  assert.ok(STATUSLINE_SH.includes(`MG="${MANAGED_SETTINGS}"`));
});
