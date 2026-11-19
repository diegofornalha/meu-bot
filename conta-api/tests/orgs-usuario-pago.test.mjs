// Usuário pago da organização (extra "assento"), no handler do Worker contra um D1 local: a vaga é da organização do
// checkout, só quem gerencia compra, o convite passa a caber e a vaga some quando vence ou é encerrada.
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

test("usuário pago: a organização nasce com 1 (a dona); cada assinatura soma 1 à organização certa; vencido ou encerrado, o convite volta a ser recusado", async () => {
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
    const { CHAVE_HMAC_ABACATEPAY, hmacBase64, voltaDoCheckout } = await import("../dist/pagamento-core.js");
    const { privateKey } = generateKeyPairSync("ed25519");
    const HMAC = Buffer.from("k".repeat(32)).toString("base64"), SEGREDO = "s".repeat(40);
    const CATALOGO = '{"assento":{"produto":"prod_assentoorg01","centavos":4700,"deCentavos":9700,"rotulo":"Usuário de organização"}}';
    const env = { ...px.env, DB, GA_ID: "", SESSAO_HMAC_KEY: HMAC, ADMIN_BOOTSTRAP_EMAIL: "ninguem@exemplo.com", LICENCA_PRIVATE_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), ABACATEPAY_KEY: "abc_dev_x", ABACATEPAY_WEBHOOK_SECRET: SEGREDO, ABACATEPAY_EXTRAS: CATALOGO };
    const agora = new Date().toISOString(), em = (d) => new Date(Date.now() + d * 86400000).toISOString();
    const D = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", O = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22", X = "2d2f8e3f-8f3f-4d9f-9e77-2f8c5f3e4f33", S = "3e3f9f4f-9a4f-4e0f-8f88-3a9d6f4f5a44";
    for (const [id, email] of [[D, "dona@exemplo.com"], [O, "outra@exemplo.com"], [X, "de-fora@exemplo.com"], [S, "super@exemplo.com"]]) await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
    for (const id of [D, O]) await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, ?3, 2, '[]', ?2, 'system')").bind(id, agora, em(20)).run();
    await DB.prepare("INSERT INTO admins (email, papel, criado_em) VALUES ('super@exemplo.com', 'super', ?1)").bind(agora).run();
    const s = Math.floor(Date.now() / 1000);
    const tok = (id, adm = null) => assinarJwt({ sub: id, sid: "s", dev: null, adm, iat: s, exp: s + 3600 }, HMAC);
    const td = await tok(D), to = await tok(O), tx = await tok(X), ts = await tok(S, "super");
    const chamar = async (metodo, caminho, corpo, t) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env, { waitUntil() {} }); return { status: r.status, corpo: await r.json().catch(() => null) }; };
    let n = 0;
    const webhook = async ({ evento = "subscription.completed", ref, subs, pago = 4700 }) => {
      n++;
      const corpo = JSON.stringify({ id: `log_${n}`, event: evento, apiVersion: 2, devMode: true, data: { subscription: { id: subs, amount: 4700, currency: "BRL", method: "CARD", status: "ACTIVE" }, checkout: { id: `bill_${n}`, externalId: ref, frequency: "SUBSCRIPTION" }, payment: { id: `pay_${n}`, amount: pago, paidAmount: pago, status: "PAID" } } });
      const r = await worker.fetch(new Request("https://api.local/pagamentos/abacatepay", { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": SEGREDO, "x-webhook-signature": await hmacBase64(CHAVE_HMAC_ABACATEPAY, corpo) }, body: corpo }), env, { waitUntil() {} });
      return { status: r.status, resultado: (await DB.prepare("SELECT resultado FROM webhook_eventos WHERE id = ?1").bind(`log_${n}`).first())?.resultado ?? null };
    };
    // O checkout como postAssinatura o grava (a chamada real fala com a AbacatePay): produto e a organização dona da vaga.
    const checkout = async (ref, conta, orgId) => { await DB.prepare("INSERT INTO pagamento_checkouts (ref, conta_id, checkout_id, ga_client_id, ga_session_id, criado_em, produto, promo, org_id) VALUES (?1, ?2, NULL, NULL, NULL, ?3, 'extra-assento', 0, ?4)").bind(ref, conta, agora, orgId).run(); };

    // Duas organizações: a da dona e a da outra.
    const a = (await chamar("POST", "/orgs", { nome: "Acme", slug: "acme" }, td)).corpo, b = (await chamar("POST", "/orgs", { nome: "Beta", slug: "beta" }, to)).corpo;
    assert.deepEqual([a.assentos, a.assentosInclusos, a.assentosPagos, a.ocupados], [1, 1, 0, 1], "nasce com 1 usuário, a dona");
    const org = async (slug, t = td) => { const o = (await chamar("GET", `/orgs/${slug}`, undefined, t)).corpo; return [o.assentos, o.assentosInclusos, o.assentosPagos, o.ocupados]; };

    // Sem vaga, o convite é recusado com o caminho.
    let r = await chamar("POST", "/orgs/acme/membros", { email: "ana@exemplo.com" }, td);
    assert.equal(r.status, 409); assert.equal(r.corpo.semVaga, true); assert.match(r.corpo.erro, /Adicione um usuário/);

    // As recusas do checkout que acontecem antes de falar com a AbacatePay.
    assert.equal((await chamar("POST", "/conta/assinatura", { produto: "extra-assento" }, td)).status, 400, "sem dizer a organização");
    assert.equal((await chamar("POST", "/conta/assinatura", { produto: "extra-assento", org: "nao-existe" }, td)).status, 400);
    assert.equal((await chamar("POST", "/conta/assinatura", { produto: "extra-assento", org: "acme" }, tx)).status, 403, "quem não é da organização não compra");
    assert.equal((await chamar("POST", "/conta/assinatura", { produto: "extra-assento", org: "acme" }, to)).status, 403, "dona de outra organização também não");
    await DB.prepare("UPDATE licencas SET expires_at = ?2 WHERE conta_id = ?1").bind(D, em(-1)).run();
    r = await chamar("POST", "/conta/assinatura", { produto: "extra-assento", org: "acme" }, td);
    assert.equal(r.status, 409); assert.match(r.corpo.erro, /Pro de quem é a dona/);
    await DB.prepare("UPDATE licencas SET expires_at = ?2 WHERE conta_id = ?1").bind(D, em(20)).run();

    // Pago abaixo do preço: revisão, sem vaga.
    const R1 = "mb_11111111-1111-4111-8111-111111111111", R2 = "mb_22222222-2222-4222-8222-222222222222", R3 = "mb_33333333-3333-4333-8333-333333333333";
    await checkout(R1, D, a.id);
    assert.match((await webhook({ ref: R1, subs: "subs_a1", pago: 100 })).resultado, /^revisar/);
    assert.deepEqual(await org("acme"), [1, 1, 0, 1]);

    // Pago: soma 1 usuário à Acme, e só a ela. O convite passa.
    assert.match((await webhook({ ref: R1, subs: "subs_a1" })).resultado, /extra-assento liberado/);
    assert.deepEqual(await org("acme"), [2, 1, 1, 1]);
    assert.deepEqual(await org("beta", to), [1, 1, 0, 1], "a vaga de uma organização não aparece em outra");
    const linha = await DB.prepare("SELECT conta_id, org_id, tipo FROM extras_pagos WHERE assinatura_id = 'subs_a1'").first();
    assert.deepEqual(linha, { conta_id: D, org_id: a.id, tipo: "assento" }, "quem paga é a conta; a vaga é da organização");
    assert.equal((await chamar("POST", "/orgs/acme/membros", { email: "ana@exemplo.com" }, td)).status, 200);
    assert.equal((await chamar("POST", "/orgs/acme/membros", { email: "bia@exemplo.com" }, td)).status, 409, "a vaga paga já foi usada");
    // A unidade da organização não mexe nos limites da conta de quem pagou.
    const c = (await chamar("GET", "/conta", undefined, td)).corpo;
    assert.deepEqual([c.maquinaExtras, c.deviceExtras], [0, 0]);
    assert.ok(c.assinaturas.some((x) => x.produto === "extra-assento" && x.status === "ACTIVE"), "a assinatura aparece para quem paga, e dá para cancelar");

    // Renovação não soma de novo; uma segunda assinatura soma mais 1.
    assert.match((await webhook({ evento: "subscription.renewed", ref: R1, subs: "subs_a1" })).resultado, /liberado/);
    assert.deepEqual(await org("acme"), [2, 1, 1, 2]);
    await checkout(R2, D, a.id);
    await webhook({ ref: R2, subs: "subs_a2" });
    assert.deepEqual(await org("acme"), [3, 1, 2, 2]);

    // A cortesia do super admin é a parte "inclusos": soma com os pagos, sem contar em dobro.
    assert.equal((await chamar("PATCH", "/admin/orgs/acme", { assentos: 2 }, ts)).status, 200);
    assert.deepEqual(await org("acme"), [4, 2, 2, 2]);
    assert.equal((await chamar("PATCH", "/admin/orgs/acme", { assentos: 1 }, ts)).status, 200);

    // Vencido: a vaga sai. Ninguém é removido, mas o convite novo é recusado.
    await DB.prepare("UPDATE extras_pagos SET expires_at = ?1 WHERE assinatura_id IN ('subs_a1', 'subs_a2')").bind(em(-1)).run();
    assert.deepEqual(await org("acme"), [1, 1, 0, 2], "os dois membros continuam; as vagas pagas venceram");
    assert.equal((await chamar("POST", "/orgs/acme/membros", { email: "bia@exemplo.com" }, td)).status, 409);

    // Checkout de usuário sem organização (não deveria existir): não dá vaga a ninguém.
    await checkout(R3, D, null);
    assert.match((await webhook({ ref: R3, subs: "subs_a3" })).resultado, /^revisar/);
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM extras_pagos WHERE assinatura_id = 'subs_a3'").first()).n, 0);

    // Depois de pagar, a pessoa volta para a página de membros da organização.
    assert.deepEqual(voltaDoCheckout("https://c.local", "extra-assento", "acme"), { concluiu: "https://c.local/organizations/acme/members?assinatura=paga&produto=extra-assento", desistiu: "https://c.local/organizations/acme/members" });
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
