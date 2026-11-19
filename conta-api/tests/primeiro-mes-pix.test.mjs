// "Tenho um cupom" › Pix de ponta a ponta: a rota cria o checkout avulso só com Pix, o webhook (checkout.completed)
// libera um mês de Pro sem assinatura, uma vez por conta, e a assinatura continua intacta.
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

test("primeiro mês por Pix com cupom: checkout avulso só Pix, o aviso libera um mês sem assinatura, uma vez por conta", async () => {
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
  // GA_ID vazio: a compra não tenta falar com o Analytics.
  const env = { ...px.env, DB, GA_ID: "", SESSAO_HMAC_KEY: HMAC, LICENCA_PRIVATE_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), ABACATEPAY_KEY: "abc_dev_x", ABACATEPAY_WEBHOOK_SECRET: SEGREDO, ABACATEPAY_PRODUTO: "prod_pro", ABACATEPAY_PRECO_CENTAVOS: "9700", ABACATEPAY_METODOS: "CARD,PIX", ABACATEPAY_PRODUTO_PRIMEIRO_MES: "prod_primeiromes", PROMO_CUPOM: "PRIMEIROMES1", PROMO_PRECO_CENTAVOS: "100", PROMO_DIAS: "3", CONSOLE_ORIGIN: "https://console.local" };
  const agora = new Date().toISOString();
  const A = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", B = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22";
  for (const [id, email] of [[A, "ana@exemplo.com"], [B, "bia@exemplo.com"]]) {
    await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
    await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, trial_end, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'trialing', NULL, ?2, ?3, ?3, 1, '[]', ?2, 'system')").bind(id, agora, new Date(Date.now() + 2 * 86400000).toISOString()).run();
  }
  const s = Math.floor(Date.now() / 1000);
  const tok = (sub) => assinarJwt({ sub, sid: "s", dev: null, adm: null, iat: s, exp: s + 3600 }, HMAC);
  const ta = await tok(A), tb = await tok(B);
  // O limite de checkouts por minuto não é o assunto deste teste: zera antes de cada chamada.
  const chamar = async (metodo, caminho, corpo, t, e = env) => { await DB.prepare("DELETE FROM limites").run(); const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), e, { waitUntil() {} }); return { status: r.status, corpo: await r.json().catch(() => ({})) }; };
  let n = 0;
  // O aviso de um checkout comum pago, como a documentação o descreve: sem bloco payment, valor e situação no checkout.
  const avisoAvulso = async ({ ref, bill, pago = 100, status = "PAID", evento = "checkout.completed", devMode = true }) => {
    n++;
    const corpo = JSON.stringify({ id: `log_${n}`, event: evento, apiVersion: 2, devMode, data: { checkout: { id: bill, externalId: ref, amount: 100, paidAmount: pago, status, methods: ["PIX"], frequency: "ONE_TIME" }, customer: { id: "cust_1" }, payerInformation: { method: "PIX" } } });
    const r = await worker.fetch(new Request("https://api.local/pagamentos/abacatepay", { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": SEGREDO, "x-webhook-signature": await hmacBase64(CHAVE_HMAC_ABACATEPAY, corpo) }, body: corpo }), env, { waitUntil() {} });
    return { status: r.status, resultado: (await DB.prepare("SELECT resultado FROM webhook_eventos WHERE id = ?1").bind(`log_${n}`).first())?.resultado ?? null };
  };
  const criados = []; let total = 100;
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith("https://api.abacatepay.com/")) return fetchReal(url, init);
    if (u.includes("/coupons/list")) return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
    criados.push([u.replace("https://api.abacatepay.com/v2", ""), JSON.parse(init.body)]);
    return new Response(JSON.stringify({ data: { id: `bill_${criados.length}`, url: "https://app.abacatepay.com/pay/bill_x", amount: total } }), { status: 200 });
  };
  try {
    // Recusas antes de falar com a AbacatePay.
    let r = await chamar("POST", "/conta/assinatura", { cupom: true, pix: true, codigo: "ERRADO" }, ta);
    assert.equal(r.status, 400); assert.match(r.corpo.erro, /não achei este cupom/);
    r = await chamar("POST", "/conta/assinatura", { cupom: true, pix: true }, ta);
    assert.equal(r.status, 400, "sem código");
    r = await chamar("POST", "/conta/assinatura", { cupom: true, pix: true, codigo: "PRIMEIROMES1", produto: "extra-maquina" }, ta);
    assert.notEqual(r.status, 200, "só para o Pro");
    r = await chamar("POST", "/conta/assinatura", { cupom: true, pix: true, codigo: "PRIMEIROMES1" }, ta, { ...env, ABACATEPAY_PRODUTO_PRIMEIRO_MES: "" });
    assert.equal(r.status, 409, "produto avulso não configurado: caminho desligado");
    assert.equal(criados.length, 0);
    // O console fica sabendo se o caminho existe.
    const cfg = async (e) => await (await worker.fetch(new Request("https://console.local/config.js", { headers: { host: "console.local" } }), e, { waitUntil() {} })).text();

    // Produto cadastrado com outro preço na AbacatePay: não abre o pagamento.
    total = 500;
    r = await chamar("POST", "/conta/assinatura", { cupom: true, pix: true, codigo: "PRIMEIROMES1" }, ta);
    assert.equal(r.status, 502); total = 100;

    // O checkout: avulso, só Pix, o produto do primeiro mês, o código aceito sem diferenciar maiúsculas.
    r = await chamar("POST", "/conta/assinatura", { cupom: true, pix: true, codigo: " primeiromes1 " }, ta);
    assert.equal(r.status, 200, JSON.stringify(r.corpo)); assert.equal(r.corpo.pix, true);
    const [rota, pedido] = criados.at(-1);
    assert.equal(rota, "/checkouts/create");
    assert.deepEqual([pedido.items, pedido.methods, pedido.coupons], [[{ id: "prod_primeiromes", quantity: 1 }], ["PIX"], undefined]);
    const ck = await DB.prepare("SELECT ref, checkout_id, avulso, cupom, cupom_centavos, produto FROM pagamento_checkouts WHERE conta_id = ?1 AND checkout_id IS NOT NULL ORDER BY criado_em DESC LIMIT 1").bind(A).first();
    assert.deepEqual([ck.avulso, ck.cupom, ck.cupom_centavos, ck.produto, pedido.externalId], [1, "PRIMEIROMES1", 100, null, ck.ref]);

    // Aviso com valor diferente, ou ainda não pago: não libera.
    let w = await avisoAvulso({ ref: ck.ref, bill: ck.checkout_id, pago: 50 });
    assert.match(w.resultado, /^revisar: compra avulsa: pago 50/);
    w = await avisoAvulso({ ref: ck.ref, bill: ck.checkout_id, status: "PENDING" });
    assert.match(w.resultado, /^ignorado: checkout PENDING/);
    // Evento real no staging: ignorado.
    w = await avisoAvulso({ ref: ck.ref, bill: ck.checkout_id, devMode: false });
    assert.match(w.resultado, /^ignorado: evento real no staging/);
    assert.equal((await DB.prepare("SELECT status FROM licencas WHERE conta_id = ?1").bind(A).first()).status, "trialing", "nada liberado até aqui");

    // Pago certo: Pro ativo por um mês, pagamento sem assinatura, nenhuma linha em assinaturas.
    w = await avisoAvulso({ ref: ck.ref, bill: ck.checkout_id });
    assert.match(w.resultado, /^Pro liberado até .* \(primeiro mês por Pix\)$/);
    const lic = await DB.prepare("SELECT plan, status, interval, expires_at FROM licencas WHERE conta_id = ?1").bind(A).first();
    assert.deepEqual([lic.plan, lic.status, lic.interval], ["pro", "active", null]);
    const dias = (Date.parse(lic.expires_at) - Date.now()) / 86400000;
    assert.ok(dias > 30 && dias < 35, `um mês mais a folga, deu ${dias.toFixed(1)} dias`);
    const pg = await DB.prepare("SELECT id, assinatura_id, valor_centavos, produto, evento FROM pagamentos WHERE conta_id = ?1").bind(A).first();
    assert.deepEqual([pg.id, pg.assinatura_id, pg.valor_centavos, pg.produto, pg.evento], [ck.checkout_id, null, 100, null, "checkout.completed"]);
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM assinaturas WHERE conta_id = ?1").bind(A).first()).n, 0);
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE conta_id = ?1 AND tipo = 'pagamento.liberar'").bind(A).first()).n, 1);
    const conta = (await chamar("GET", "/conta", undefined, ta)).corpo;
    assert.deepEqual([conta.licenca.plan, conta.licenca.status, conta.assinaturas.length], ["pro", "active", 0]);

    // Aviso repetido (outro log, mesmo checkout): não libera de novo nem estende.
    w = await avisoAvulso({ ref: ck.ref, bill: ck.checkout_id });
    assert.equal(w.resultado, "pagamento já processado");
    assert.equal((await DB.prepare("SELECT expires_at FROM licencas WHERE conta_id = ?1").bind(A).first()).expires_at, lic.expires_at);

    // Depois do Pix a conta já pagou o Pro: nenhum cupom vale mais, nem por Pix nem no cartão.
    r = await chamar("POST", "/conta/assinatura", { cupom: true, pix: true, codigo: "PRIMEIROMES1" }, ta);
    assert.equal(r.status, 409); assert.match(r.corpo.erro, /primeira assinatura/);
    r = await chamar("POST", "/conta/assinatura", { cupom: true }, ta);
    assert.equal(r.status, 409);
    // E a assinatura normal sai sem cupom, pelos métodos do ambiente.
    r = await chamar("POST", "/conta/assinatura", {}, ta);
    assert.equal(r.status, 200); assert.equal(criados.at(-1)[0], "/subscriptions/create"); assert.equal(criados.at(-1)[1].coupons, undefined);

    // Dois checkouts de Pix abertos na mesma conta e os dois pagos: o segundo vai para a revisão, não soma outro mês.
    r = await chamar("POST", "/conta/assinatura", { cupom: true, pix: true, codigo: "PRIMEIROMES1" }, tb); assert.equal(r.status, 200);
    r = await chamar("POST", "/conta/assinatura", { cupom: true, pix: true, codigo: "PRIMEIROMES1" }, tb); assert.equal(r.status, 200);
    const [c1, c2] = (await DB.prepare("SELECT ref, checkout_id FROM pagamento_checkouts WHERE conta_id = ?1 AND avulso = 1 ORDER BY checkout_id").bind(B).all()).results;
    w = await avisoAvulso({ ref: c1.ref, bill: c1.checkout_id }); assert.match(w.resultado, /^Pro liberado/);
    w = await avisoAvulso({ ref: c2.ref, bill: c2.checkout_id }); assert.match(w.resultado, /^revisar: compra avulsa do primeiro mês numa conta que já tinha pago/);
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM pagamentos WHERE conta_id = ?1").bind(B).first()).n, 1);

    // O checkout.completed de um checkout de ASSINATURA continua ignorado (duplicaria o subscription.completed).
    await DB.prepare("INSERT INTO pagamento_checkouts (ref, conta_id, checkout_id, ga_client_id, ga_session_id, criado_em, produto, promo) VALUES ('mb_11111111-1111-4111-8111-111111111111', ?1, 'bill_assin', NULL, NULL, ?2, NULL, 0)").bind(A, agora).run();
    w = await avisoAvulso({ ref: "mb_11111111-1111-4111-8111-111111111111", bill: "bill_assin", pago: 9700 });
    assert.match(w.resultado, /^ignorado: evento checkout\.completed não é tratado/);

    assert.match(await cfg(env), /"cupomPix":"1"/);
    assert.match(await cfg({ ...env, ABACATEPAY_PRODUTO_PRIMEIRO_MES: "" }), /"cupomPix":""/);
  } finally { globalThis.fetch = fetchReal; }
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
