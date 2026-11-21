// O Financeiro saiu do backend (issue #312): é o módulo Finanças, em repositório próprio. O backend sobe sem os arquivos
// dele, responde 409 em /v1/finance (a frase que um plugin antigo ainda instalado repassa) e o resto segue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(AQUI, "..", "..", "backend-colima");
const { BUNDLE_FILES, COMPONENTES } = createRequire(import.meta.url)("../../dist/main/maquina/backend-bundle-core.js");
const portaLivre = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });

test("nada do Financeiro antigo vai para a máquina: nem arquivo no backend, nem componente", () => {
  assert.deepEqual(readdirSync(BACKEND).filter((f) => /financ/i.test(f)), []);
  assert.deepEqual(BUNDLE_FILES.filter((f) => /financ/i.test(f)), []);
  assert.deepEqual(COMPONENTES.map((c) => c.nome).filter((n) => /financ/i.test(n)), []);
  for (const f of BUNDLE_FILES) assert.ok(existsSync(path.join(BACKEND, f)), `${f} está na lista de envio e não existe`);
});

test("backend só com os arquivos que o app envia: sobe, /v1/finance diz que é módulo e o CRM continua", async () => {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "meu-bot-semfin-")));
  const root = path.join(home, "backend");
  // Só o que vai para a máquina (BUNDLE_FILES): um require esquecido de um arquivo apagado derrubaria a subida aqui.
  for (const f of BUNDLE_FILES) cpSync(path.join(BACKEND, f), path.join(root, f), { recursive: true });
  const port = await portaLivre();
  writeFileSync(path.join(root, ".env"), `OPENAI_COMPAT_KEY=k\nPORT=${port}\nHOST=127.0.0.1\nWORKSPACE=${path.join(home, "ws")}\nAGENT_WORKSPACE=${path.join(home, "ws-agente")}\n`);
  const child = spawn(process.execPath, [path.join(root, "server.js")], { cwd: root, env: { ...process.env, HOME: home, OPENAI_COMPAT_SESSIONS_PATH: path.join(root, "data", "sessions.json") }, stdio: ["ignore", "pipe", "pipe"] });
  let saida = "";
  child.stdout.on("data", (d) => { saida += d.toString(); }); child.stderr.on("data", (d) => { saida += d.toString(); });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`backend não subiu:\n${saida}`)), 15_000);
      const tick = () => { if (/ouvindo em/.test(saida)) { clearTimeout(t); resolve(); } else if (child.exitCode !== null) { clearTimeout(t); reject(new Error(`backend saiu:\n${saida}`)); } else setTimeout(tick, 50); };
      tick();
    });
    const pedir = async (method, p) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { Authorization: "Bearer k" } }); return { status: r.status, json: await r.json().catch(() => null) }; };
    for (const [m, p] of [["GET", "/v1/finance/info"], ["POST", "/v1/finance/lancamentos"], ["GET", "/v1/finance"]]) {
      const r = await pedir(m, p);
      assert.equal(r.status, 409, `${m} ${p}`);
      assert.equal(r.json.error.code, "finance_modulo");
      assert.match(r.json.error.message, /módulo Finanças.*página Módulos/);
    }
    assert.equal((await pedir("GET", "/v1/meu-bot/license")).status, 200, "a licença (que o módulo consulta) continua no backend");
    assert.notEqual((await pedir("GET", "/v1/crm/pipelines")).status, 500, "o CRM não depende mais das pontes do financeiro");
    assert.equal(existsSync(path.join(home, ".local", "share", "meu-bot", "finance")), false, "o backend não cria nem abre finance/db");
    assert.doesNotMatch(saida, /Cannot find module|financeiro/);
  } finally {
    const saiu = new Promise((resolve) => { child.once("exit", resolve); setTimeout(resolve, 6000).unref(); });
    child.kill("SIGTERM"); await saiu;
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
