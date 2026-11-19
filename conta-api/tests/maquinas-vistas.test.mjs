// "Máquinas em uso" (POST|DELETE /conta/maquinas/:id/visto): o app avisa que a pessoa usa uma máquina com a licença do
// admin e o console a lista. É só exibição: não ocupa vaga nem atrapalha o vínculo de outra conta.
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

test("máquina vista: aparece em maquinasVistas, não ocupa vaga, some ao ser vinculada, tirada ou velha", async () => {
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
    const tok = (sub) => assinarJwt({ sub, sid: "s", dev: null, adm: null, iat: s, exp: s + 3600 }, HMAC);
    const chamar = async (metodo, caminho, corpo, t) => {
      const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env, { waitUntil() {} });
      return { status: r.status, corpo: await r.json().catch(() => ({})) };
    };
    const ta = await tok(A), tb = await tok(B);
    const BOX = "5d2c1c0a-3f1b-4a52-8b8e-1f2a3b4c5d6e", OUTRA = "7e3d2d1b-4a2c-4b63-9c9f-2a3b4c5d6e7f";

    let r = await chamar("POST", "/conta/maquinas/nao-e-uuid/visto", { origem: "admin" }, ta);
    assert.notEqual(r.status, 200, "uuid fora do formato não é aceito");
    r = await chamar("POST", `/conta/maquinas/${BOX}/visto`, { apelido: "Diego", origem: "root" }, ta);
    assert.equal(r.status, 400, "origem inválida: 400");
    r = await chamar("POST", `/conta/maquinas/${BOX}/visto`, { apelido: "Diego", origem: "admin" }, ta);
    assert.equal(r.status, 200);

    r = await chamar("GET", "/conta", undefined, ta);
    assert.equal(r.corpo.maquinasVistas.length, 1);
    assert.deepEqual({ id: r.corpo.maquinasVistas[0].id, apelido: r.corpo.maquinasVistas[0].apelido, origem: r.corpo.maquinasVistas[0].origem }, { id: BOX, apelido: "Diego", origem: "admin" });
    assert.equal(r.corpo.maquinas.length, 0, "vista não entra em maquinas");
    assert.equal(r.corpo.maquinaLimite, 1, "o limite não muda");
    r = await chamar("GET", "/conta", undefined, tb);
    assert.equal(r.corpo.maquinasVistas.length, 0, "a lista é de cada conta");

    // Não ocupa vaga: a única vaga da conta A continua livre para outra máquina.
    r = await chamar("POST", "/conta/maquinas", { id: OUTRA, apelido: "Outra" }, ta);
    assert.equal(r.status, 200, "a vaga continua livre com uma máquina vista");
    // Nem prende a máquina: outra conta leva a licença dela para a mesma box.
    r = await chamar("POST", "/conta/maquinas", { id: BOX, apelido: "Diego" }, tb);
    assert.equal(r.status, 200, "ser vista por A não impede B de usar a licença na mesma máquina");

    // Vinculada à conta, deixa de sair em maquinasVistas (já sai em maquinas) e o aviso carimba o último contato.
    await chamar("POST", `/conta/maquinas/${OUTRA}/visto`, { apelido: "Outra", origem: "conta" }, ta);
    r = await chamar("GET", "/conta", undefined, ta);
    assert.deepEqual(r.corpo.maquinasVistas.map((m) => m.id), [BOX], "a vinculada não sai duplicada");
    assert.equal(typeof (await DB.prepare("SELECT ultimo_hello_em FROM maquinas WHERE id = ?1").bind(OUTRA).first()).ultimo_hello_em, "string");

    // Sem novo aviso em 30 dias, some da lista.
    await DB.prepare("UPDATE maquinas_vistas SET vista_em = ?1 WHERE conta_id = ?2 AND id = ?3").bind(new Date(Date.now() - 31 * 86400000).toISOString(), A, BOX).run();
    r = await chamar("GET", "/conta", undefined, ta);
    assert.equal(r.corpo.maquinasVistas.length, 0, "vista há mais de 30 dias some");
    // Novo aviso traz de volta, e o apelido antigo fica quando o novo vem vazio.
    await chamar("POST", `/conta/maquinas/${BOX}/visto`, { origem: "admin" }, ta);
    r = await chamar("GET", "/conta", undefined, ta);
    assert.equal(r.corpo.maquinasVistas[0]?.apelido, "Diego");

    r = await chamar("DELETE", `/conta/maquinas/${BOX}/visto`, undefined, tb);
    assert.equal(r.status, 404, "outra conta não tira a minha");
    r = await chamar("DELETE", `/conta/maquinas/${BOX}/visto`, undefined, ta);
    assert.equal(r.status, 200);
    r = await chamar("GET", "/conta", undefined, ta);
    assert.equal(r.corpo.maquinasVistas.length, 0, "tirada da lista");
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
