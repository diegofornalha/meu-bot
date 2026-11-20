// Checkout preenchido: o aviso de pagamento aceito guarda o cliente da AbacatePay (cust_...) na conta, e as próximas
// compras mandam `customerId`. Cliente que não existe mais é esquecido e a página abre em branco, sem erro.
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

test("lerEvento lê o cliente de data.customer.id ou de checkout.customerId; formato estranho vira null", async () => {
  const { lerEvento, clienteNaoExiste, pedidoComCliente } = await import("../dist/pagamento-core.js");
  const ev = (data) => lerEvento({ id: "log_1", event: "checkout.completed", apiVersion: 2, devMode: true, data });
  assert.equal(ev({ checkout: { id: "bill_1" }, customer: { id: "cust_aB3dE5" } }).cliente, "cust_aB3dE5");
  assert.equal(ev({ checkout: { id: "bill_1", customerId: "cust_Xy9" } }).cliente, "cust_Xy9");
  assert.equal(ev({ checkout: { id: "bill_1" }, customer: { id: "cust_a b" } }).cliente, null);
  assert.equal(ev({ checkout: { id: "bill_1" }, customer: { id: "maria@exemplo.com" } }).cliente, null);
  assert.equal(ev({ checkout: { id: "bill_1" } }).cliente, null);

  assert.equal(clienteNaoExiste(404, { error: "Customer not found" }), true);
  assert.equal(clienteNaoExiste(400, { error: "Cliente não encontrado." }), true);
  assert.equal(clienteNaoExiste(401, { error: "Insufficient permissions" }), false);
  assert.equal(clienteNaoExiste(500, { error: "Customer not found" }), false, "AbacatePay fora não é cliente apagado");
  assert.equal(clienteNaoExiste(200, null), false);

  assert.deepEqual(pedidoComCliente({ a: 1 }, null), { a: 1 });
  assert.deepEqual(pedidoComCliente({ a: 1 }, "cust_1"), { a: 1, customerId: "cust_1" });
});

test("o cliente de quem pagou vai nas próximas compras; cliente apagado na AbacatePay é esquecido", async () => {
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
  const { CHAVE_HMAC_ABACATEPAY, hmacBase64 } = await import("../dist/pagamento-core.js");
  const { privateKey } = generateKeyPairSync("ed25519");
  const HMAC = Buffer.from("k".repeat(32)).toString("base64"), SEGREDO = "s".repeat(40);
  const env = { ...px.env, DB, GA_ID: "", SESSAO_HMAC_KEY: HMAC, LICENCA_PRIVATE_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), ABACATEPAY_KEY: "abc_dev_x", ABACATEPAY_WEBHOOK_SECRET: SEGREDO, ABACATEPAY_PRODUTO: "prod_pro", ABACATEPAY_PRECO_CENTAVOS: "9700", ABACATEPAY_METODOS: "CARD", ABACATEPAY_PRODUTO_PRIMEIRO_MES: "prod_primeiromes", PROMO_CUPOM: "PRIMEIROMES1", PROMO_PRECO_CENTAVOS: "100", PROMO_DIAS: "3", CONSOLE_ORIGIN: "https://console.local" };
  const agora = new Date().toISOString();
  const A = "2d2f8e3a-8f3a-4d9a-9e77-2f8c5a3e4a33", B = "3e3a9f4b-9a4b-4eab-8f88-3a9d6b4f5b44";
  for (const [id, email] of [[A, "ana@exemplo.com"], [B, "bia@exemplo.com"]]) {
    await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
    await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, trial_end, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'trialing', NULL, ?2, ?3, ?3, 1, '[]', ?2, 'system')").bind(id, agora, new Date(Date.now() + 2 * 86400000).toISOString()).run();
  }
  const s = Math.floor(Date.now() / 1000);
  const tok = (sub) => assinarJwt({ sub, sid: "s", dev: null, adm: null, iat: s, exp: s + 3600 }, HMAC);
  const ta = await tok(A), tb = await tok(B);
  const chamar = async (corpo, t) => { await DB.prepare("DELETE FROM limites").run(); const r = await worker.fetch(new Request("https://api.local/conta/assinatura", { method: "POST", headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: JSON.stringify(corpo) }), env, { waitUntil() {} }); return { status: r.status, corpo: await r.json().catch(() => ({})) }; };
  let n = 0;
  const aviso = async (payload) => {
    n++;
    const corpo = JSON.stringify({ id: `log_${n}`, apiVersion: 2, devMode: true, ...payload });
    await worker.fetch(new Request("https://api.local/pagamentos/abacatepay", { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": SEGREDO, "x-webhook-signature": await hmacBase64(CHAVE_HMAC_ABACATEPAY, corpo) }, body: corpo }), env, { waitUntil() {} });
    return (await DB.prepare("SELECT resultado FROM webhook_eventos WHERE id = ?1").bind(`log_${n}`).first())?.resultado ?? null;
  };
  const clienteDe = async (id) => (await DB.prepare("SELECT abacatepay_cliente AS c FROM contas WHERE id = ?1").bind(id).first()).c;
  const ultimoCheckout = (id) => DB.prepare("SELECT ref, checkout_id FROM pagamento_checkouts WHERE conta_id = ?1 AND checkout_id IS NOT NULL ORDER BY rowid DESC LIMIT 1").bind(id).first();

  const criados = []; const apagados = new Set();
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith("https://api.abacatepay.com/")) return fetchReal(url, init);
    if (u.includes("/coupons/list")) return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
    const corpo = JSON.parse(init.body);
    criados.push([u.replace("https://api.abacatepay.com/v2", ""), corpo]);
    if (corpo.customerId !== undefined && apagados.has(corpo.customerId)) return new Response(JSON.stringify({ data: null, error: "Customer not found", success: false }), { status: 404 });
    return new Response(JSON.stringify({ data: { id: `bill_${criados.length}`, url: "https://app.abacatepay.com/pay/bill_x", amount: 100 } }), { status: 200 });
  };
  try {
    // Primeira compra: conta sem cliente, o pedido sai como antes.
    let r = await chamar({ cupom: true, pix: true, codigo: "PRIMEIROMES1" }, ta);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal("customerId" in criados.at(-1)[1], false);
    const ck = await ultimoCheckout(A);
    const avulso = (pago, status = "PAID") => aviso({ event: "checkout.completed", data: { checkout: { id: ck.checkout_id, externalId: ck.ref, amount: 100, paidAmount: pago, status }, customer: { id: "cust_Ana1", name: "Ana", email: "ana@exemplo.com", taxId: "529.***.247-**" } } });

    // Aviso que não libera (valor errado, ainda não pago): o cliente não é guardado.
    assert.match(await avulso(50), /^revisar/);
    assert.match(await avulso(100, "PENDING"), /^ignorado/);
    assert.equal(await clienteDe(A), null);

    // Pago: guarda só o id do cliente.
    assert.match(await avulso(100), /^Pro liberado/);
    assert.equal(await clienteDe(A), "cust_Ana1");

    // Próxima compra (assinatura do Pro, e add-on/extra pelo mesmo caminho): vai com o customerId.
    r = await chamar({}, ta);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual([criados.at(-1)[0], criados.at(-1)[1].customerId], ["/subscriptions/create", "cust_Ana1"]);

    // O cliente foi apagado na AbacatePay: a rota esquece o id, tenta sem ele e abre a página mesmo assim.
    apagados.add("cust_Ana1");
    const antes = criados.length;
    r = await chamar({}, ta);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(criados.length, antes + 2);
    assert.equal(criados.at(-2)[1].customerId, "cust_Ana1");
    assert.equal("customerId" in criados.at(-1)[1], false);
    assert.equal(await clienteDe(A), null);

    // Assinatura no cartão paga (subscription.completed): também guarda, de data.customer.
    r = await chamar({}, tb);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const cb = await ultimoCheckout(B);
    const res = await aviso({ event: "subscription.completed", data: { subscription: { id: "subs_bia", status: "ACTIVE", method: "CARD", amount: 9700, frequency: "MONTHLY" }, checkout: { id: cb.checkout_id, externalId: cb.ref, customerId: "cust_Bia1", frequency: "MONTHLY" }, payment: { id: "char_bia1", paidAmount: 9700, status: "PAID", updatedAt: agora }, customer: { id: "cust_Bia1" } } });
    assert.match(res, /liberad/i, res);
    assert.equal(await clienteDe(B), "cust_Bia1");
    // E um cancelamento não troca nem apaga o cliente.
    await aviso({ event: "subscription.cancelled", data: { subscription: { id: "subs_bia", status: "CANCELLED" }, checkout: { id: cb.checkout_id, externalId: cb.ref }, customer: { id: "cust_Outro" } } });
    assert.equal(await clienteDe(B), "cust_Bia1");
  } finally { globalThis.fetch = fetchReal; }
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
