// O Pro pela organização: a regra pura (licencaComProDaOrg, melhorCobertura) e, no Worker contra um D1 local, quem
// recebe o Pro, até quando, e quando perde.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { licencaComProDaOrg, melhorCobertura } from "../dist/pagamento-core.js";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);

test("licencaComProDaOrg: o usuário coberto recebe o Pro até o prazo da dona; quem tem o próprio Pro por mais tempo fica como está", () => {
  const AGORA = Date.parse("2026-11-19T12:00:00Z"), em = (d) => new Date(AGORA + d * 86400000).toISOString();
  const free = { plan: "free", status: "free", interval: null, expiresAt: null, produtos: ["meu-bot-x"] };
  const org = (ate) => ({ ate, slug: "acme", nome: "Acme" });
  assert.equal(licencaComProDaOrg(free, null, AGORA), free, "sem cobertura, a mesma licença");
  assert.deepEqual(licencaComProDaOrg(free, org(em(20)), AGORA), { plan: "pro", status: "active", interval: "month", expiresAt: em(20), produtos: ["meu-bot-x"] }, "só o plano muda; os add-ons são os da própria conta");
  assert.equal(licencaComProDaOrg(free, org(null), AGORA).expiresAt, null, "dona sem prazo: usuário sem prazo");
  assert.equal(licencaComProDaOrg(free, org(em(-1)), AGORA), free, "cobertura vencida não conta");
  const vencida = { ...free, plan: "pro", status: "expired", expiresAt: em(-5) }, teste = { ...free, plan: "pro", status: "trialing", expiresAt: em(2) };
  assert.equal(licencaComProDaOrg(vencida, org(em(20)), AGORA).status, "active");
  assert.deepEqual([licencaComProDaOrg(teste, org(em(20)), AGORA).status, licencaComProDaOrg(teste, org(em(20)), AGORA).expiresAt], ["active", em(20)], "quem estava em teste passa ao Pro da organização");
  const proprio = { ...free, plan: "pro", status: "active", interval: "year", expiresAt: em(60) };
  assert.equal(licencaComProDaOrg(proprio, org(em(20)), AGORA), proprio, "o próprio Pro vai mais longe: fica");
  assert.equal(licencaComProDaOrg(proprio, org(em(90)), AGORA).expiresAt, em(90), "a organização vai mais longe: vale o prazo dela");
  assert.equal(licencaComProDaOrg(proprio, org(em(90)), AGORA).interval, "year");
  assert.equal(licencaComProDaOrg({ ...proprio, expiresAt: null }, org(em(90)), AGORA).expiresAt, null, "Pro próprio sem prazo nunca encurta");
  assert.equal(melhorCobertura([]), null);
  assert.equal(melhorCobertura([org(em(5)), { ...org(em(30)), slug: "beta" }, org(em(10))]).slug, "beta");
  assert.equal(melhorCobertura([org(em(30)), { ...org(null), slug: "sem-prazo" }]).slug, "sem-prazo");
});

test("no Worker: usuário coberto tem o Pro pela organização; sai e perde; a dona sem Pro leva junto; além das vagas não cobre; add-ons não são herdados", async () => {
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
    const env = { ...px.env, DB, GA_ID: "", SESSAO_HMAC_KEY: HMAC, ADMIN_BOOTSTRAP_EMAIL: "ninguem@exemplo.com" };
    const agora = new Date().toISOString(), em = (d) => new Date(Date.now() + d * 86400000).toISOString();
    const D = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", A = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22", B = "2d2f8e3f-8f3f-4d9f-9e77-2f8c5f3e4f33", P = "3e3f9f4f-9a4f-4e0f-8f88-3a9d6f4f5a44";
    for (const [id, email] of [[D, "dona@exemplo.com"], [A, "ana@exemplo.com"], [B, "bia@exemplo.com"], [P, "pri@exemplo.com"]]) await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
    const FIM_DONA = em(20), FIM_PRI = em(60);
    // A dona tem o Pro e um add-on concedido; a Pri tem o próprio Pro, mais longo; Ana e Bia não têm plano.
    await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, ?3, 2, '[\"meu-bot-finance\"]', ?2, 'system')").bind(D, agora, FIM_DONA).run();
    await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'year', ?2, ?3, 2, '[]', ?2, 'system')").bind(P, agora, FIM_PRI).run();
    const s = Math.floor(Date.now() / 1000);
    const tok = (id) => assinarJwt({ sub: id, sid: "s", dev: null, adm: null, iat: s, exp: s + 3600 }, HMAC);
    const td = await tok(D), ta = await tok(A), tb = await tok(B), tp = await tok(P);
    const chamar = async (metodo, caminho, corpo, t) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env, { waitUntil() {} }); return { status: r.status, corpo: await r.json().catch(() => null) }; };
    const plano = async (t) => { const c = (await chamar("GET", "/conta", undefined, t)).corpo; return [c.licenca.plan, c.licenca.status, c.licenca.expiresAt, c.proPelaOrg?.slug ?? null]; };

    const org = (await chamar("POST", "/orgs", { nome: "Acme", slug: "acme" }, td)).corpo;
    // Três vagas (a dona e duas de cortesia): Ana e Pri entram; a Bia fica de fora por enquanto.
    await DB.prepare("UPDATE organizacoes SET assentos = 3 WHERE id = ?1").bind(org.id).run();
    assert.deepEqual(await plano(ta), ["free", "free", null, null], "antes de entrar");
    assert.equal((await chamar("POST", "/orgs/acme/membros", { email: "ana@exemplo.com" }, td)).status, 200);
    assert.equal((await chamar("POST", "/orgs/acme/membros", { email: "pri@exemplo.com" }, td)).status, 200);

    assert.deepEqual(await plano(ta), ["pro", "active", FIM_DONA, "acme"], "a Ana recebe o Pro até o prazo da dona");
    const ca = (await chamar("GET", "/conta", undefined, ta)).corpo;
    assert.deepEqual(ca.licenca.produtos, [], "o add-on da dona não é herdado");
    assert.deepEqual(await plano(tp), ["pro", "active", FIM_PRI, null], "a Pri segue com o próprio Pro, que vai mais longe");
    assert.deepEqual(await plano(td), ["pro", "active", FIM_DONA, null], "a dona usa o próprio Pro");

    // Além das vagas: a quarta pessoa não cabe e não é coberta.
    assert.equal((await chamar("POST", "/orgs/acme/membros", { email: "bia@exemplo.com" }, td)).status, 409);
    // Uma vaga vence (a organização volta a 2): a Ana, que entrou antes, continua; a Pri seria a de fora, mas tem o dela.
    await DB.prepare("UPDATE organizacoes SET assentos = 2 WHERE id = ?1").bind(org.id).run();
    assert.deepEqual(await plano(ta), ["pro", "active", FIM_DONA, "acme"]);
    // Com 1 vaga só a dona cabe: a Ana perde o Pro pela organização, sem ser removida.
    await DB.prepare("UPDATE organizacoes SET assentos = 1 WHERE id = ?1").bind(org.id).run();
    assert.deepEqual(await plano(ta), ["free", "free", null, null]);
    assert.equal((await chamar("GET", "/orgs/acme", undefined, ta)).status, 200, "continua na organização");
    await DB.prepare("UPDATE organizacoes SET assentos = 3 WHERE id = ?1").bind(org.id).run();

    // A dona perde o Pro: os usuários perdem junto.
    await DB.prepare("UPDATE licencas SET expires_at = ?2 WHERE conta_id = ?1").bind(D, em(-1)).run();
    assert.deepEqual(await plano(ta), ["free", "free", null, null]);
    await DB.prepare("UPDATE licencas SET expires_at = ?2 WHERE conta_id = ?1").bind(D, FIM_DONA).run();
    assert.deepEqual(await plano(ta), ["pro", "active", FIM_DONA, "acme"]);

    // Sai da organização: volta ao que tinha.
    assert.equal((await chamar("DELETE", "/orgs/acme/membros/ana%40exemplo.com", undefined, ta)).status, 200);
    assert.deepEqual(await plano(ta), ["free", "free", null, null]);
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
