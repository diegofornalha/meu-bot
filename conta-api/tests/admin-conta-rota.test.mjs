// GET /admin/conta: uma conta só, achada pela máquina, pelo id ou pelo e-mail, na forma que o console mostra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const req = createRequire(import.meta.url);
const api = join(dirname(fileURLToPath(import.meta.url)), "..");

test("GET /admin/conta: pistas em ordem de confiança, só admin, na forma do console", async () => {
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
    const env = { ...px.env, DB, ADMIN_BOOTSTRAP_EMAIL: "dona@exemplo.com", SESSAO_HMAC_KEY: HMAC };
    const agora = new Date().toISOString();
    const A = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", B = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22", NINGUEM = "2d2f8e3f-8f3f-4d9f-9e77-2f8c5f3e4f33";
    const M1 = "5d2c1c0a-3f1b-4a52-8b8e-1f2a3b4c5d6e", SOLTA = "7e3d2d1b-4a2c-4b63-9c9f-2a3b4c5d6e7f";
    for (const [id, email] of [[A, "ana@exemplo.com"], [B, "bia@exemplo.com"]]) await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
    const ate = new Date(Date.now() + 20 * 864e5).toISOString();
    await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, ?3, 2, '[]', ?2, 'system')").bind(A, agora, ate).run();
    await DB.prepare("INSERT INTO extras_pagos (assinatura_id, conta_id, tipo, expires_at, atualizado_em) VALUES ('subs_extra1', ?1, 'maquina', ?2, ?3)").bind(A, ate, agora).run();
    const s = Math.floor(Date.now() / 1000);
    const tok = async (sub, adm = null) => assinarJwt({ sub, sid: "s", dev: null, adm, iat: s, exp: s + 3600 }, HMAC);
    const chamar = async (metodo, caminho, corpo, t) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env, { waitUntil() {} }); return { status: r.status, corpo: await r.json().catch(() => ({})) }; };
    const ta = await tok(A), adm = await tok(B, "admin");
    // A própria Ana vincula a máquina pela rota de verdade seria preciso a chave da licença; aqui basta a linha.
    await DB.prepare("INSERT INTO maquinas (id, conta_id, apelido, vinculada_por, criada_em, ultima_emissao_em) VALUES (?1, ?2, 'Karen', 'ana@exemplo.com', ?3, ?3)").bind(M1, A, agora).run();

    let r = await chamar("GET", `/admin/conta?maquina=${M1}`, undefined, ta);
    assert.equal(r.status, 403, "quem não é admin não lê conta de ninguém");
    r = await chamar("GET", "/admin/conta", undefined, adm);
    assert.equal(r.status, 400, "sem pista");
    r = await chamar("GET", "/admin/conta?maquina=nao-e-uuid&id=x&email=sem-arroba", undefined, adm);
    assert.equal(r.status, 400, "pista fora do formato não conta como pista");

    r = await chamar("GET", `/admin/conta?maquina=${M1}`, undefined, adm);
    assert.equal(r.status, 200);
    assert.equal(r.corpo.achadaPor, "maquina");
    assert.equal(r.corpo.conta.email, "ana@exemplo.com");
    assert.equal(r.corpo.conta.licenca.plan, "pro");
    assert.equal(r.corpo.conta.licenca.deviceLimit, 2);
    assert.deepEqual(r.corpo.conta.maquinas.map((m) => m.apelido), ["Karen"]);
    assert.equal(r.corpo.conta.maquinaLimite, 2, "1 inclusa + 1 extra paga, como o console soma");
    assert.equal(r.corpo.conta.maquinaExtras, 1);
    const console_ = await chamar("GET", "/conta", undefined, ta);
    for (const k of ["licenca", "maquinas", "maquinaLimite", "maquinaExtras", "pedidos", "assinaturas"]) assert.deepEqual(r.corpo.conta[k], console_.corpo[k], `"${k}" igual ao que a própria pessoa vê no console`);

    r = await chamar("GET", `/admin/conta?maquina=${SOLTA}&id=${A}`, undefined, adm);
    assert.equal(r.corpo.achadaPor, "id", "máquina desconhecida: cai na pista seguinte");
    r = await chamar("GET", `/admin/conta?id=${NINGUEM}&email=${encodeURIComponent(" Ana@Exemplo.com ")}`, undefined, adm);
    assert.equal(r.status, 200); assert.equal(r.corpo.achadaPor, "email"); assert.equal(r.corpo.conta.id, A);
    r = await chamar("GET", `/admin/conta?maquina=${M1}&email=bia@exemplo.com`, undefined, adm);
    assert.equal(r.corpo.conta.id, A, "a máquina vinculada ganha do e-mail declarado");
    r = await chamar("GET", `/admin/conta?maquina=${SOLTA}&email=ninguem@exemplo.com`, undefined, adm);
    assert.equal(r.status, 404); assert.equal(r.corpo.semConta, true);
    await DB.prepare("UPDATE contas SET apagada_em = ?1 WHERE id = ?2").bind(agora, A).run();
    r = await chamar("GET", `/admin/conta?maquina=${M1}`, undefined, adm);
    assert.equal(r.status, 404, "conta apagada não aparece");
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
