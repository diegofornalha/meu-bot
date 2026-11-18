import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const { parseCrmPatch, parseCrmInfo, parseStreakOut, setCrmSh, crmInfoSh, streakSh, motorEfetivo } = createRequire(import.meta.url)("../../dist/main/crm/crm-core.js");

test("parseCrmPatch: chave válida, pipeline, silêncio 1–240, flag; recusa o resto", () => {
  assert.deepEqual(parseCrmPatch({ apiKey: "  abcdefghij1234567890  " }), { apiKey: "abcdefghij1234567890" });
  assert.throws(() => parseCrmPatch({ apiKey: "curta" }), /inválida/);
  assert.throws(() => parseCrmPatch({ apiKey: "tem espaco dentro 1234567890" }), /inválida/);
  assert.deepEqual(parseCrmPatch({ pipelineKey: "agxzfm1haWxmb29nYWVy", pipelineName: "  Parceiros   Grok " }), { pipelineKey: "agxzfm1haWxmb29nYWVy", pipelineName: "Parceiros Grok" });
  assert.deepEqual(parseCrmPatch({ pipelineKey: null }), { pipelineKey: null });
  assert.throws(() => parseCrmPatch({ pipelineKey: "x;rm" }), /pipeline inválido/);
  assert.deepEqual(parseCrmPatch({ silencioMin: 15, criarSemPerguntar: true }), { silencioMin: 15, criarSemPerguntar: true });
  assert.throws(() => parseCrmPatch({ silencioMin: 0 }), /1 a 240/);
  assert.throws(() => parseCrmPatch({}), /nada/);
});

test("setCrmSh: patch em base64 pelo stdin (a chave não aparece em claro), 0600, marcador; silêncio vai ao plugin", () => {
  const sh = setCrmSh({ apiKey: "segredo1234567890abc", silencioMin: 20 });
  assert.ok(!sh.includes("segredo1234567890abc"), "chave em claro no comando");
  assert.match(sh, /base64 -d \| python3/); assert.match(sh, /0o600/); assert.match(sh, /CRM=1/);
  assert.match(sh, /plugins\.entries\.meu-bot-crm\.config\.silencioMin 20/);
  assert.ok(!setCrmSh({ apiKey: "segredo1234567890abc" }).includes("openclaw config set"));
});

test("crmInfoSh/parseCrmInfo: configured sem a chave, instalado por I=", () => {
  assert.match(crmInfoSh(), /crm\.json/); assert.match(crmInfoSh(), /crm-job\.mjs/);
  const info = parseCrmInfo('C={"configured": true, "pipelineKey": "k1", "pipelineName": "P", "silencioMin": 7, "criarSemPerguntar": false, "savedAt": "2026-10-18T00:00:00Z"}\nI=1\n');
  assert.deepEqual(info, { installed: true, configured: true, streakKey: false, motor: null, pipelineKey: "k1", pipelineName: "P", silencioMin: 7, criarSemPerguntar: false, savedAt: "2026-10-18T00:00:00Z" });
  assert.deepEqual(parseCrmInfo("lixo"), { installed: false, configured: false, streakKey: false, motor: null, pipelineKey: null, pipelineName: null, silencioMin: 10, criarSemPerguntar: false, savedAt: null });
});

test("streakSh/parseStreakOut: só diag/pipelines; JSON ou erro claro", () => {
  assert.match(streakSh("diag"), /"\$CLI" diag/);
  assert.match(streakSh("diag"), /crm\.mjs/, "plano Pro usa o crm.mjs"); assert.match(streakSh("pipelines"), /streak\.mjs/, "senão o streak.mjs");
  assert.deepEqual(parseStreakOut('S={"ok":true,"pipelines":[]}'), { ok: true, pipelines: [] });
  assert.match(String(parseStreakOut("S=").erro), /não respondeu/);
});

test("motor do CRM: patch aceita proprio/streak/null; a regra sem motor gravado segue a chave do Streak, depois a licença", () => {
  assert.deepEqual(parseCrmPatch({ motor: "proprio" }), { motor: "proprio" });
  assert.deepEqual(parseCrmPatch({ motor: null }), { motor: null });
  assert.throws(() => parseCrmPatch({ motor: "outro" }), /motor inválido/);
  assert.equal(motorEfetivo("streak", false, true), "streak", "gravado vence");
  assert.equal(motorEfetivo(null, true, true), "streak", "quem já tem a chave do Streak não muda em silêncio");
  assert.equal(motorEfetivo(null, false, true), "proprio");
  assert.equal(motorEfetivo(null, false, false), "streak");
  const info = parseCrmInfo('C={"motor":"proprio","streakKey":false,"configured":true}\nI=1');
  assert.equal(info.motor, "proprio"); assert.equal(info.streakKey, false);
  assert.match(streakSh("diag"), /c\.get\("motor"\)/, "a escolha do CLI na máquina olha o motor gravado");
});

test("streakSh: personalizado cru em vigor usa o CRM próprio; expiresAt no passado não", () => {
  const py = streakSh("diag").match(/python3 -c '([\s\S]*)' 2>\/dev\/null/)?.[1];
  assert.equal(typeof py, "string");
  const decide = (lic, crm = {}, vigor = null) => {
    const home = mkdtempSync(join(tmpdir(), "crm-sh-"));
    const base = join(home, ".local", "share", "meu-bot");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "licenca.json"), JSON.stringify(lic));
    if (vigor !== null) writeFileSync(join(base, "licenca-vigor.json"), JSON.stringify(vigor));
    writeFileSync(join(base, "crm.json"), JSON.stringify(crm));
    try {
      execFileSync("python3", ["-c", py], { env: { ...process.env, HOME: home }, stdio: "pipe" });
      return "proprio";
    } catch (e) {
      assert.equal(e.status, 1, String(e.stderr ?? e.message));
      return "streak";
    } finally { rmSync(home, { recursive: true, force: true }); }
  };
  const chave = { apiKey: "abcdefghij1234567890" };
  assert.equal(decide({ plan: "personalizado", status: "active" }, chave), "proprio");
  // Pro que vem da conta da pessoa: o backend deixa a licença em vigor em licenca-vigor.json, e ela decide.
  assert.equal(decide({ plan: "free", status: "free" }, {}, { plan: "pro", status: "active", expiresAt: "2099-01-01T00:00:00.000Z" }), "proprio");
  assert.equal(decide({ plan: "free", status: "free" }, {}, { plan: "pro", status: "active", expiresAt: "2020-01-01T00:00:00.000Z" }), "streak", "espelho vencido não libera");
  assert.equal(decide({ plan: "pro", status: "active", produtos: ["meu-bot-crm"] }, chave), "proprio");
  assert.equal(decide({ plan: "personalizado", status: "active", expiresAt: "2020-01-01T00:00:00.000Z" }, chave), "streak");
  assert.equal(decide({ plan: "personalizado", status: "expired" }), "streak");
  assert.equal(decide({ plan: "pro", status: "active" }), "proprio");
  assert.equal(decide({ plan: "pro", status: "active" }, chave), "streak");
  assert.equal(decide({ plan: "pro", status: "active", expiresAt: "2020-01-01T00:00:00.000Z" }), "streak");
  assert.equal(decide({ plan: "free", status: "active", produtos: ["meu-bot-crm"] }), "streak");
  assert.equal(decide({ plan: "pro", status: "active" }, { ...chave, motor: "streak" }), "streak");
});
