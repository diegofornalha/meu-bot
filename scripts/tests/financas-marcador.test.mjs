import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RAIZ = new URL("../../backend-colima/", import.meta.url).pathname;

test("instalador antigo do financeiro: com o módulo Finanças ligado (marcador MODULO) sai com 4 e não toca em nada", () => {
  const HOME = mkdtempSync(join(tmpdir(), "fin-mod-"));
  const src = join(HOME, ".local/share/meu-bot/finance");
  mkdirSync(join(src, "db"), { recursive: true });
  writeFileSync(join(src, "MODULO"), "financas\n");
  writeFileSync(join(src, "index.js"), "// do módulo\n");
  const r = spawnSync("bash", [join(RAIZ, "install-finance.sh")], { env: { ...process.env, HOME }, encoding: "utf8" });
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stdout, /módulo Finanças/);
  assert.equal(readFileSync(join(src, "index.js"), "utf8"), "// do módulo\n", "o plugin do módulo fica");
  assert.equal(existsSync(join(HOME, ".claude/skills/finance-api/SKILL.md")), false, "a skill antiga não é instalada");
});

test("backend: com o marcador, /v1/finance responde 409 finance_modulo antes de abrir o db, e as pontes com o CRM param", () => {
  const s = readFileSync(join(RAIZ, "server.js"), "utf8");
  const rota = s.indexOf("financeEhModulo()) return json(res, 409");
  const api = s.indexOf("financeApi().handle(req, res, url)");
  assert.ok(rota > 0 && rota < api, "a recusa vem antes da API do financeiro");
  assert.equal((s.match(/!licenca\.crmOk\(lic\) \|\| financeEhModulo\(\)\) return;/g) ?? []).length, 2, "as duas pontes com o CRM conferem o marcador");
});
