// O admin atribui uma máquina a uma conta pelo e-mail (POST|DELETE /admin/maquinas/:id/conta): ela aparece no console
// da pessoa como "licença do admin", sem vencer, sem ocupar vaga, e a gestão acha a conta pela máquina.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);

test("máquina atribuída pelo admin: só admin, conta certa, não vence, não ocupa vaga, some ao desfazer", async () => {
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
    const { privateKey } = generateKeyPairSync("ed25519");
    const HMAC = Buffer.from("k".repeat(32)).toString("base64");
    const env = { ...px.env, DB, ADMIN_BOOTSTRAP_EMAIL: "dona@exemplo.com", SESSAO_HMAC_KEY: HMAC, LICENCA_PRIVATE_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") };
    const agora = new Date().toISOString();
    const A = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", B = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22";
    for (const [id, email] of [[A, "ana@exemplo.com"], [B, "bia@exemplo.com"]]) {
      await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "fb-" + id, email, agora).run();
      await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, ?3, 1, '[]', ?2, 'system')").bind(id, agora, new Date(Date.now() + 20 * 86400000).toISOString()).run();
    }
    const s = Math.floor(Date.now() / 1000);
    const tok = (sub, adm = null) => assinarJwt({ sub, sid: "s", dev: null, adm, iat: s, exp: s + 3600 }, HMAC);
    const chamar = async (metodo, caminho, corpo, t) => {
      const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env, { waitUntil() {} });
      return { status: r.status, corpo: await r.json().catch(() => ({})) };
    };
    const ta = await tok(A), tb = await tok(B), tadm = await tok(A, "admin");
    const BOX = "5d2c1c0a-3f1b-4a52-8b8e-1f2a3b4c5d6e", OUTRA = "7e3d2d1b-4a2c-4b63-9c9f-2a3b4c5d6e7f";

    let r = await chamar("POST", `/admin/maquinas/${BOX}/conta`, { email: "bia@exemplo.com", apelido: "Diego" }, tb);
    assert.equal(r.status, 403, "conta comum não atribui");
    r = await chamar("POST", `/admin/maquinas/${BOX}/conta`, { email: "sem-arroba" }, tadm);
    assert.equal(r.status, 400, "e-mail fora do formato");
    r = await chamar("POST", `/admin/maquinas/${BOX}/conta`, { email: "ninguem@exemplo.com" }, tadm);
    assert.equal(r.status, 404); assert.equal(r.corpo.semConta, true);
    r = await chamar("GET", `/admin/conta?maquina=${BOX}`, undefined, tadm);
    assert.equal(r.status, 404, "antes de atribuir, a gestão não acha conta pela máquina");

    r = await chamar("POST", `/admin/maquinas/${BOX}/conta`, { email: " Bia@Exemplo.com ", apelido: "Diego" }, tadm);
    assert.equal(r.status, 200); assert.equal(r.corpo.conta.email, "bia@exemplo.com");
    r = await chamar("GET", "/conta", undefined, tb);
    assert.deepEqual(r.corpo.maquinasVistas.map((m) => [m.id, m.apelido, m.origem, m.atribuida]), [[BOX, "Diego", "admin", true]]);
    assert.equal(r.corpo.maquinas.length, 0); assert.equal(r.corpo.maquinaLimite, 1, "não ocupa vaga nem muda o limite");
    r = await chamar("GET", "/conta", undefined, ta);
    assert.equal(r.corpo.maquinasVistas.length, 0, "só na conta atribuída");
    r = await chamar("GET", `/admin/conta?maquina=${BOX}`, undefined, tadm);
    assert.equal(r.status, 200); assert.equal(r.corpo.conta.email, "bia@exemplo.com", "a gestão acha a conta pela máquina atribuída");
    assert.equal(r.corpo.atribuida, true);
    const aud = await DB.prepare("SELECT quem AS autor, conta_id FROM auditoria WHERE acao = 'maquina.atribuida'").first();
    assert.deepEqual([aud.autor, aud.conta_id], ["ana@exemplo.com", B]);

    // Não vence: 31 dias sem aviso do app e continua na lista.
    await DB.prepare("UPDATE maquinas_vistas SET vista_em = ?1 WHERE id = ?2").bind(new Date(Date.now() - 31 * 86400000).toISOString(), BOX).run();
    r = await chamar("GET", "/conta", undefined, tb);
    assert.equal(r.corpo.maquinasVistas.length, 1, "atribuída não vence em 30 dias");
    // O aviso do app da pessoa não apaga a atribuição.
    await chamar("POST", `/conta/maquinas/${BOX}/visto`, { origem: "admin" }, tb);
    r = await chamar("GET", "/conta", undefined, tb);
    assert.equal(r.corpo.maquinasVistas[0].atribuida, true);
    // Não prende a máquina nem a vaga: a própria conta leva a licença a outra máquina, e outra conta usa a licença nesta.
    r = await chamar("POST", "/conta/maquinas", { id: OUTRA }, tb); assert.equal(r.status, 200);
    r = await chamar("POST", "/conta/maquinas", { id: BOX }, ta); assert.equal(r.status, 200);
    r = await chamar("GET", `/admin/conta?maquina=${BOX}`, undefined, tadm);
    assert.equal(r.corpo.conta.email, "ana@exemplo.com", "vinculada de verdade vale antes da atribuída");
    assert.equal(r.corpo.atribuida, undefined);

    r = await chamar("DELETE", `/admin/maquinas/${BOX}/conta`, { email: "bia@exemplo.com" }, tb);
    assert.equal(r.status, 403);
    r = await chamar("DELETE", `/admin/maquinas/${BOX}/conta`, { email: "ana@exemplo.com" }, tadm);
    assert.equal(r.status, 404, "não estava atribuída a essa conta");
    r = await chamar("DELETE", `/admin/maquinas/${BOX}/conta`, { email: "bia@exemplo.com" }, tadm);
    assert.equal(r.status, 200);
    r = await chamar("GET", "/conta", undefined, tb);
    assert.equal(r.corpo.maquinasVistas.length, 0, "desfeita: sai da lista");
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'maquina.desatribuida'").first()).n, 1);
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
