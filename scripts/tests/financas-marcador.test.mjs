import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, symlinkSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
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

test("backend de verdade: com o marcador, /v1/finance responde 409 finance_modulo sem abrir o db; sem ele, volta ao normal", async () => {
  // O server.js lê o .env da própria pasta: uma pasta temporária com links para os fontes e um .env com porta livre.
  const dir = mkdtempSync(join(tmpdir(), "fin-srv-"));
  for (const f of readdirSync(RAIZ)) if (/\.(js|mjs|json|py)$/.test(f)) symlinkSync(join(RAIZ, f), join(dir, f));
  const porta = await new Promise((r) => { const s = createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
  writeFileSync(join(dir, ".env"), `PORT=${porta}\nHOST=127.0.0.1\nOPENAI_COMPAT_KEY=chave-teste\n`);
  const HOME = mkdtempSync(join(tmpdir(), "fin-home-"));
  const fin = join(HOME, ".local/share/meu-bot/finance");
  mkdirSync(fin, { recursive: true });
  writeFileSync(join(fin, "MODULO"), "financas\n");
  const srv = spawn(process.execPath, ["--preserve-symlinks", "--preserve-symlinks-main", join(dir, "server.js")], { env: { ...process.env, HOME }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((ok, falha) => { const t = setTimeout(() => falha(new Error("o server.js não subiu")), 15_000); srv.stdout.on("data", (d) => { if (String(d).includes("ouvindo em")) { clearTimeout(t); ok(); } }); });
    const get = async () => { const r = await fetch(`http://127.0.0.1:${porta}/v1/finance/estado`, { headers: { authorization: "Bearer chave-teste" } }); return { status: r.status, j: await r.json() }; };
    const com = await get();
    assert.equal(com.status, 409);
    assert.equal(com.j.error.code, "finance_modulo");
    assert.match(com.j.error.message, /módulo Finanças/);
    assert.equal(existsSync(join(fin, "db")), false, "a API antiga não abriu o db");
    unlinkSync(join(fin, "MODULO"));
    const sem = await get();
    assert.notEqual(sem.status, 409, "sem o marcador, a API antiga volta (aqui sem licença: 403)");
    assert.equal(sem.j.error.code, "finance_license");
  } finally { srv.kill(); }
});
