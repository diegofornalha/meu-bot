// A própria pessoa tira um Mac da conta (DELETE /conta/devices/:id), no handler do Worker contra um D1 local com as
// migrações do repositório: a vaga abre, as sessões daquele Mac caem e o Mac pendente mais antigo entra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);

test("remover um Mac pela própria conta: some da lista, derruba a sessão dele, promove o pendente; o Mac de outra conta não", async () => {
  const persist = mkdtempSync(join(tmpdir(), "conta-d1-"));
  const { getPlatformProxy } = req("wrangler");
  const px = await getPlatformProxy({ configPath: api + "/wrangler.toml", environment: "staging", persist: { path: persist } });
  try {
    const DB = px.env.DB;
    for (const f of readdirSync(api + "/migrations").sort()) {
      const sql = readFileSync(api + "/migrations/" + f, "utf8").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
      for (const st of sql.split(";").map((x) => x.trim()).filter(Boolean)) await DB.prepare(st).run();
    }
    const worker = (await import("../dist/index.js")).default;
    const { assinarJwt } = await import("../dist/sessao-core.js");
    const HMAC = Buffer.from("k".repeat(32)).toString("base64");
    const env = { ...px.env, DB, GA_ID: "", SESSAO_HMAC_KEY: HMAC };
    const agora = new Date().toISOString(), dia = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const A = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", B = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22";
    for (const [id, email] of [[A, "ana@exemplo.com"], [B, "bia@exemplo.com"]]) await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
    await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, ?3, 2, '[]', ?2, 'system')").bind(A, agora, new Date(Date.now() + 20 * 86400000).toISOString()).run();
    // A Ana tem o limite de 2 cheio e um terceiro Mac na fila; a Bia tem um Mac dela.
    for (const [conta, id, nome, st, pediu, visto] of [[A, "a1b2c3d4e5f6", "escritorio", "active", null, dia(9)], [A, "b1b2c3d4e5f6", "notebook", "active", null, dia(5)], [A, "c1b2c3d4e5f6", "novo", "pending", dia(1), dia(1)], [B, "d1b2c3d4e5f6", "da-bia", "active", null, dia(2)]])
      await DB.prepare("INSERT INTO devices (conta_id, id, name, status, requested_at, first_seen, last_seen, apps) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, '{}')").bind(conta, id, nome, st, pediu, visto).run();
    await DB.prepare("INSERT INTO sessoes (id, conta_id, refresh_hash, familia, device_id, app, versao_app, criada_em, usada_em, expira_em) VALUES ('s-note', ?1, 'h1', 'f1', 'b1b2c3d4e5f6', 'meu-bot', '1.2.0', ?2, ?2, ?3)").bind(A, agora, dia(-30)).run();
    await DB.prepare("INSERT INTO sessoes (id, conta_id, refresh_hash, familia, device_id, app, versao_app, criada_em, usada_em, expira_em) VALUES ('s-escr', ?1, 'h2', 'f2', 'a1b2c3d4e5f6', 'meu-bot', '1.2.0', ?2, ?2, ?3)").bind(A, agora, dia(-30)).run();
    const s = Math.floor(Date.now() / 1000);
    const ta = await assinarJwt({ sub: A, sid: "s", dev: null, adm: null, iat: s, exp: s + 3600 }, HMAC);
    const chamar = async (metodo, caminho, t = ta) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t } }), env, { waitUntil() {} }); return { status: r.status, corpo: await r.json().catch(() => null) }; };
    const status = async () => Object.fromEntries((await chamar("GET", "/conta")).corpo.devices.map((d) => [d.name, d.status]));

    assert.deepEqual(await status(), { escritorio: "active", notebook: "active", novo: "pending" });
    assert.equal((await chamar("DELETE", "/conta/devices/nao-e-id")).status, 404, "caminho fora da forma não é rota");
    assert.equal((await chamar("DELETE", "/conta/devices/d1b2c3d4e5f6")).status, 404, "o Mac da Bia não sai pela conta da Ana");
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM devices WHERE conta_id = ?1").bind(B).first()).n, 1);
    assert.equal((await worker.fetch(new Request("https://api.local/conta/devices/b1b2c3d4e5f6", { method: "DELETE" }), env, { waitUntil() {} })).status, 401, "sem login");

    const r = await chamar("DELETE", "/conta/devices/b1b2c3d4e5f6");
    assert.deepEqual([r.status, r.corpo], [200, { ok: true, promovidos: 1 }]);
    assert.deepEqual(await status(), { escritorio: "active", novo: "active" }, "o notebook saiu e o pendente entrou na vaga");
    assert.ok((await DB.prepare("SELECT revogada_em FROM sessoes WHERE id = 's-note'").first()).revogada_em, "a sessão do Mac removido foi revogada");
    assert.equal((await DB.prepare("SELECT revogada_em FROM sessoes WHERE id = 's-escr'").first()).revogada_em, null, "a sessão do outro Mac continua");
    const audit = (await DB.prepare("SELECT quem, acao FROM auditoria WHERE conta_id = ?1 ORDER BY id").bind(A).all()).results;
    assert.deepEqual(audit.map((x) => `${x.quem} ${x.acao}`), ["ana@exemplo.com device.removido", "system device.liberado"]);
    assert.equal((await chamar("DELETE", "/conta/devices/b1b2c3d4e5f6")).status, 404, "de novo: já não está na conta");
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
