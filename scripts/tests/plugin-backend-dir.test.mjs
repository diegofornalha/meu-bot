import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** ENV_FILE que o módulo resolve num HOME de mentira (o módulo lê os.homedir() na carga; por isso um processo por caso). */
const resolve = (mod, home) => execFileSync(process.execPath, ["-e", `import("${mod}").then((m) => console.log(m.ENV_FILE))`], { env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" }).trim();

for (const mod of ["backend-colima/crm/backend.mjs"]) {
  test(`${mod}: acha o backend do meu-bot pela mesma regra do app (própria, herdada só se é o nosso server.js)`, () => {
    const abs = join(process.cwd(), mod);
    const home = mkdtempSync(join(tmpdir(), "meu-bot-plugin-dir-"));
    try {
      const propria = join(home, ".local", "share", "meu-bot", "backend");
      const herdada = join(home, ".hermes", "agente-rene", "backend-sdk-claude");
      // nada instalado: a própria (onde o backend vai ser instalado)
      assert.equal(resolve(abs, home), join(propria, ".env"));
      // herdada com o backend do Hermes (sem a rota meu-bot/hello): nunca
      mkdirSync(herdada, { recursive: true }); writeFileSync(join(herdada, "server.js"), "const express = require('express');\n");
      assert.equal(resolve(abs, home), join(propria, ".env"), "o backend do Hermes na herdada não conta");
      // herdada com o nosso server.js: vale (instalações antigas)
      writeFileSync(join(herdada, "server.js"), "// meu-bot/hello\n");
      assert.equal(resolve(abs, home), join(herdada, ".env"));
      // a própria existindo vence
      mkdirSync(propria, { recursive: true }); writeFileSync(join(propria, "server.js"), "// meu-bot/hello\n");
      assert.equal(resolve(abs, home), join(propria, ".env"));
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}
