import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// A regra única de qual motor atende o WhatsApp, em shell (WA_MOTOR_SH, usada pelo status, pareamento, sondagem do
// seletor, módulos, admin e objetivo) e em JS (backend-colima/motor-whatsapp.js, usada pelo backend para mandar mensagem):
// os dois rodam no mesmo HOME de mentira e têm de dizer o mesmo. Antes eram quatro regras que divergiam.
const req = createRequire(import.meta.url);
const { WA_MOTOR_SH } = req("../../dist/main/whatsapp/whatsapp-capacidades.js");
const { motorWhatsapp } = req("../../backend-colima/motor-whatsapp.js");

/** Monta um HOME com a escolha, o WhatsApp do Hermes, binários (no PATH falso ou nas pastas do home) e o config do PicoClaw. */
function cenario({ escolha, hermesWa = false, path: noPath = [], home: noHome = [], picoCfg = false }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "motor-wa-"));
  const bin = path.join(home, "bin-falso"); fs.mkdirSync(bin);
  const exe = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, "#!/bin/sh\nexit 0\n"); fs.chmodSync(p, 0o755); };
  if (escolha !== undefined) { fs.mkdirSync(path.join(home, ".local/share/meu-bot"), { recursive: true }); fs.writeFileSync(path.join(home, ".local/share/meu-bot/whatsapp-agente"), escolha); }
  if (hermesWa) fs.mkdirSync(path.join(home, ".hermes/whatsapp"), { recursive: true });
  for (const b of noPath) exe(path.join(bin, b));
  for (const p of noHome) exe(path.join(home, p));
  if (picoCfg) { fs.mkdirSync(path.join(home, ".picoclaw"), { recursive: true }); fs.writeFileSync(path.join(home, ".picoclaw/config.json"), "{}"); }
  const PATH = `${bin}:/usr/bin:/bin`;
  const sh = execFileSync("bash", ["-c", `${WA_MOTOR_SH}; echo "motor=$MOTOR"; echo "esc=$ESC"; usa_hermes && echo hermes=sim || echo hermes=nao`], { env: { HOME: home, PATH }, encoding: "utf8" });
  const js = motorWhatsapp({ home, PATH });
  fs.rmSync(home, { recursive: true, force: true });
  const m = /^motor=(.*)$/m.exec(sh)[1];
  return { shell: m === "" ? null : m, esc: /^esc=(.*)$/m.exec(sh)[1], usaHermes: /^hermes=sim$/m.test(sh), js: js.motor, jsEscolha: js.escolha };
}

test("precedência: escolha gravada > Hermes configurado > openclaw > hermes > picoclaw com config; shell e JS iguais", () => {
  const casos = [
    [{ escolha: "hermes\n", path: ["openclaw"] }, "hermes"],
    [{ escolha: "openclaw", hermesWa: true }, "openclaw"],
    [{ escolha: "picoclaw", hermesWa: true, path: ["openclaw"] }, "picoclaw"],
    [{ escolha: "OpenClaw", hermesWa: true }, "hermes", "escolha ilegível não vale (o shell compara exato)"],
    [{ hermesWa: true, path: ["openclaw", "hermes"] }, "hermes", "Hermes já com WhatsApp vence o binário do OpenClaw (como antes da escolha existir)"],
    [{ path: ["openclaw", "hermes", "picoclaw"], picoCfg: true }, "openclaw"],
    [{ home: [".openclaw/bin/openclaw"] }, "openclaw", "OpenClaw fora do PATH, na pasta dele"],
    [{ path: ["hermes"] }, "hermes"],
    [{ home: [".local/bin/hermes"] }, "hermes"],
    [{ path: ["picoclaw"], picoCfg: true }, "picoclaw"],
    [{ home: [".local/bin/picoclaw"], picoCfg: true }, "picoclaw"],
    [{ path: ["picoclaw"] }, null, "picoclaw sem config.json é uma cópia solta"],
    [{}, null],
  ];
  for (const [c, esperado, nota] of casos) {
    const r = cenario(c);
    assert.equal(r.shell, esperado, `shell: ${JSON.stringify(c)} ${nota ?? ""}`);
    assert.equal(r.js, esperado, `js: ${JSON.stringify(c)} ${nota ?? ""}`);
    assert.equal(r.usaHermes, esperado === "hermes");
    assert.equal(r.jsEscolha, r.esc, "a escolha lida é a mesma nos dois");
  }
});

test("matriz completa: shell e JS concordam em toda combinação", () => {
  let n = 0;
  for (const escolha of [undefined, "hermes", "openclaw", "picoclaw", "x"]) for (const hermesWa of [false, true]) for (const bins of [[], ["openclaw"], ["hermes"], ["picoclaw"], ["openclaw", "hermes", "picoclaw"]]) for (const picoCfg of [false, true]) {
    const r = cenario({ escolha, hermesWa, path: bins, picoCfg });
    assert.equal(r.js, r.shell, JSON.stringify({ escolha, hermesWa, bins, picoCfg }));
    n++;
  }
  assert.equal(n, 100);
});

test("WA_MOTOR_SH é uma linha só sem comentários (o probeScript junta por '; ') e não derruba um script com set -e", () => {
  assert.ok(!WA_MOTOR_SH.includes("#"), "sem comentários");
  assert.equal(WA_MOTOR_SH.replace(/'[^']*'/g, "").split("\n").length, 1, "uma linha (fora o \\n dentro das aspas do tr)");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "motor-wa-"));
  const out = execFileSync("bash", ["-c", `set -e; ${WA_MOTOR_SH}; echo "chegou=$MOTOR"`], { env: { HOME: home, PATH: "/usr/bin:/bin" }, encoding: "utf8" });
  fs.rmSync(home, { recursive: true, force: true });
  assert.match(out, /^chegou=$/m);
});
