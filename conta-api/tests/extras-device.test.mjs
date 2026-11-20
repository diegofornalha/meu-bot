// O device extra de ponta a ponta, no mesmo harness da máquina extra (extras-rotas.test.mjs): D1 local com as migrações,
// o webhook da AbacatePay chamado no handler do Worker, até o limite de devices da conta e a fila de Macs pendentes.
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

test("device extra: o webhook soma uma vaga, o Mac pendente mais antigo entra, o admin libera pelo limite em vigor e o extra vencido sai da conta", async () => {
  const persist = mkdtempSync(join(tmpdir(), "conta-d1-"));
  const { getPlatformProxy } = req("wrangler");
  const px = await getPlatformProxy({ configPath: api + "/wrangler.toml", environment: "staging", persist: { path: persist } });
  const canceladas = [], fetchReal = globalThis.fetch;
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
  const CATALOGO = '{"maquina":{"produto":"prod_maquinaextra1","centavos":9700,"rotulo":"Máquina extra"},"device":{"produto":"prod_deviceextra1","centavos":4700,"rotulo":"Device extra"}}';
  // GA_ID vazio: a compra não tenta falar com o Analytics.
  const env = { ...px.env, DB, GA_ID: "", SESSAO_HMAC_KEY: HMAC, LICENCA_PRIVATE_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), ABACATEPAY_KEY: "abc_dev_x", ABACATEPAY_WEBHOOK_SECRET: SEGREDO, ABACATEPAY_EXTRAS: CATALOGO };
  const agora = new Date().toISOString();
  const A = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", B = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22";
  for (const [id, email] of [[A, "ana@exemplo.com"], [B, "bia@exemplo.com"]]) await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
  await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, ?3, 1, '[]', ?2, 'system')").bind(A, agora, new Date(Date.now() + 20 * 86400000).toISOString()).run();
  const s = Math.floor(Date.now() / 1000);
  const ta = await assinarJwt({ sub: A, sid: "s", dev: null, adm: null, iat: s, exp: s + 3600 }, HMAC);
  const tb = await assinarJwt({ sub: B, sid: "s", dev: null, adm: null, iat: s, exp: s + 3600 }, HMAC);
  const chamar = async (metodo, caminho, corpo, t, e = env) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), e, { waitUntil() {} }); return { status: r.status, corpo: await r.json() }; };
  // O webhook como a AbacatePay o manda no Modo Teste (o staging só aceita devMode): secret no cabeçalho e o corpo assinado.
  let n = 0;
  const webhook = async ({ evento = "subscription.completed", ref, subs, pago = 4700 }) => {
    n++;
    const corpo = JSON.stringify({ id: `log_${n}`, event: evento, apiVersion: 2, devMode: true, data: { subscription: { id: subs, amount: 4700, currency: "BRL", method: "CARD", status: "ACTIVE" }, checkout: { id: `bill_${n}`, externalId: ref, frequency: "SUBSCRIPTION" }, payment: { id: `card_${n}`, amount: pago, paidAmount: pago, status: "APPROVED", updatedAt: new Date().toISOString() } } });
    const r = await worker.fetch(new Request("https://api.local/pagamentos/abacatepay", { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": SEGREDO, "x-webhook-signature": await hmacBase64(CHAVE_HMAC_ABACATEPAY, corpo) }, body: corpo }), env, { waitUntil() {} });
    return { status: r.status, resultado: (await DB.prepare("SELECT resultado FROM webhook_eventos WHERE id = ?1").bind(`log_${n}`).first())?.resultado ?? null };
  };
  const tadm = await assinarJwt({ sub: B, sid: "s", dev: null, adm: "admin", iat: s, exp: s + 3600 }, HMAC);
  // A AbacatePay de mentira: o encerramento pede o cancelamento da assinatura antes de tirar o acesso.
  globalThis.fetch = async (url, init) => { if (!String(url).startsWith("https://api.abacatepay.com/")) return fetchReal(url, init); canceladas.push(JSON.parse(init.body).id); return new Response(JSON.stringify({ success: true, data: { status: "CANCELLED" } }), { status: 200, headers: { "content-type": "application/json" } }); };
  const checkout = async (ref, conta = A) => { await DB.prepare("INSERT INTO pagamento_checkouts (ref, conta_id, checkout_id, ga_client_id, ga_session_id, criado_em, produto, promo) VALUES (?1, ?2, NULL, NULL, NULL, ?3, 'extra-device', 0)").bind(ref, conta, agora).run(); return ref; };
  const conta = async () => (await chamar("GET", "/conta", undefined, ta)).corpo;
  const status = async () => Object.fromEntries((await conta()).devices.map((d) => [d.name, d.status]));
  const R1 = "mb_11111111-1111-4111-8111-111111111111", R2 = "mb_22222222-2222-4222-8222-222222222222";
  // Três Macs na conta de limite 1: o primeiro ativo, os outros dois na fila (o "segundo" pediu antes do "terceiro").
  const dia = (n) => new Date(Date.now() - n * 86400000).toISOString();
  for (const [id, nome, st, pediu, visto] of [["a1b2c3d4e5f6", "primeiro", "active", null, dia(9)], ["b1b2c3d4e5f6", "segundo", "pending", dia(3), dia(3)], ["c1b2c3d4e5f6", "terceiro", "pending", dia(1), dia(1)]])
    await DB.prepare("INSERT INTO devices (conta_id, id, name, status, requested_at, first_seen, last_seen, apps) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, '{}')").bind(A, id, nome, st, pediu, visto).run();

  let c = await conta();
  assert.deepEqual([c.licenca.deviceLimit, c.deviceExtras], [1, 0]);
  // O checkout recusa antes de falar com a AbacatePay: sem o Pro, e fora do catálogo.
  let r = await chamar("POST", "/conta/assinatura", { produto: "extra-device" }, tb);
  assert.equal(r.status, 409, r.corpo.erro); assert.match(r.corpo.erro, /o device extra vale junto com o Pro/);
  r = await chamar("POST", "/conta/assinatura", { produto: "extra-device" }, ta, { ...env, ABACATEPAY_EXTRAS: '{"maquina":{"produto":"prod_maquinaextra1","centavos":9700,"rotulo":"Máquina extra"}}' });
  assert.equal(r.status, 400, "sem o device no catálogo, não está à venda");

  // Pago abaixo do preço: não abre vaga nem promove ninguém.
  let w = await webhook({ ref: await checkout(R2), subs: "subs_barato", pago: 100 });
  assert.match(w.resultado, /^revisar/);
  assert.deepEqual(await status(), { primeiro: "active", segundo: "pending", terceiro: "pending" });

  // Pago: o limite sobe 1 e entra quem pediu primeiro; o limite de máquinas não muda.
  w = await webhook({ ref: await checkout(R1), subs: "subs_d1" });
  assert.match(w.resultado, /^extra-device liberado até /);
  c = await conta();
  assert.deepEqual([c.licenca.deviceLimit, c.deviceExtras, c.maquinaLimite, c.maquinaExtras], [2, 1, 1, 0]);
  assert.deepEqual(await status(), { primeiro: "active", segundo: "active", terceiro: "pending" });
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'device.liberado' AND detalhe LIKE 'b1b2c3d4e5f6%subs_d1'").first()).n, 1, "a promoção fica na auditoria");
  assert.equal(c.assinaturas.find((a) => a.id === "subs_d1").produto, "extra-device");
  // O formulário do admin é preenchido pela visão, que traz o limite GRAVADO (a base), não o somado: salvar a conta sem
  // mexer no campo "Devices" regrava a mesma base e o extra não conta duas vezes.
  const naVisao = (await chamar("GET", "/admin/visao", undefined, tadm)).corpo.contas.find((x) => x.id === A);
  assert.equal(naVisao.licenca.deviceLimit, 1, "a visão do admin mostra a base");
  assert.deepEqual(naVisao.extrasPagos.map((x) => x.tipo), ["device"]);
  r = await chamar("PATCH", `/admin/contas/${A}/licenca`, { plan: naVisao.licenca.plan, status: naVisao.licenca.status, deviceLimit: naVisao.licenca.deviceLimit, maquinaLimit: naVisao.maquinaLimite }, tadm);
  assert.equal(r.status, 200, r.corpo.erro);
  assert.equal((await conta()).licenca.deviceLimit, 2, "salvar sem alterar não soma o extra de novo");
  // A renovação estende a mesma vaga, não soma outra.
  w = await webhook({ evento: "subscription.renewed", ref: R1, subs: "subs_d1" });
  assert.match(w.resultado, /^extra-device liberado até /);
  assert.equal((await conta()).licenca.deviceLimit, 2);

  // O admin libera o terceiro: o limite que vale é o em vigor (2); ao subir, grava só a parte dele (3 em vigor - 1 extra).
  r = await chamar("POST", `/admin/contas/${A}/devices/c1b2c3d4e5f6/liberar`, {}, tadm);
  assert.equal(r.status, 409); assert.equal(r.corpo.noLimite, true); assert.match(r.corpo.erro, /2 de 2 devices/);
  r = await chamar("POST", `/admin/contas/${A}/devices/c1b2c3d4e5f6/liberar`, { subirLimite: true }, tadm);
  assert.equal(r.status, 200); assert.equal(r.corpo.deviceLimit, 3);
  assert.equal((await DB.prepare("SELECT device_limit FROM licencas WHERE conta_id = ?1").bind(A).first()).device_limit, 2);
  c = await conta();
  assert.deepEqual([c.licenca.deviceLimit, c.deviceExtras], [3, 1]);

  // O admin encerra o extra (reembolso): a vaga paga sai do limite na hora.
  r = await chamar("POST", `/admin/contas/${A}/extras/subs_d1/encerrar`, { motivo: "reembolso" }, tadm);
  assert.equal(r.status, 200);
  c = await conta();
  assert.deepEqual([c.licenca.deviceLimit, c.deviceExtras], [2, 0]);
  } finally { globalThis.fetch = fetchReal; await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
