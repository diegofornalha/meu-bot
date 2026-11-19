// A máquina extra de ponta a ponta: o webhook da AbacatePay chamado no handler do Worker, contra um D1 local
// (miniflare) com as migrações do repositório, até o limite de máquinas e a renovação da licença. O checkout em si
// (POST /conta/assinatura) fala com a AbacatePay; aqui entram só as recusas dele que acontecem antes disso.
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

test("máquina extra: o webhook abre a vaga, a renovação estende, cada assinatura soma, encerrada vai para revisão e vencida deixa de renovar", async () => {
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
  const CATALOGO = '{"maquina":{"produto":"prod_maquinaextra1","centavos":9700,"rotulo":"Máquina extra"}}';
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
  const webhook = async ({ evento = "subscription.completed", ref, subs, pago = 9700 }) => {
    n++;
    const corpo = JSON.stringify({ id: `log_${n}`, event: evento, apiVersion: 2, devMode: true, data: { subscription: { id: subs, amount: 9700, currency: "BRL", method: "CARD", status: "ACTIVE" }, checkout: { id: `bill_${n}`, externalId: ref, frequency: "SUBSCRIPTION" }, payment: { id: `card_${n}`, amount: pago, paidAmount: pago, status: "APPROVED", updatedAt: new Date().toISOString() } } });
    const r = await worker.fetch(new Request("https://api.local/pagamentos/abacatepay", { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": SEGREDO, "x-webhook-signature": await hmacBase64(CHAVE_HMAC_ABACATEPAY, corpo) }, body: corpo }), env, { waitUntil() {} });
    return { status: r.status, resultado: (await DB.prepare("SELECT resultado FROM webhook_eventos WHERE id = ?1").bind(`log_${n}`).first())?.resultado ?? null };
  };
  const checkout = async (ref, conta = A) => { await DB.prepare("INSERT INTO pagamento_checkouts (ref, conta_id, checkout_id, ga_client_id, ga_session_id, criado_em, produto, promo) VALUES (?1, ?2, NULL, NULL, NULL, ?3, 'extra-maquina', 0)").bind(ref, conta, agora).run(); return ref; };
  const conta = async () => (await chamar("GET", "/conta", undefined, ta)).corpo;
  const extra = (subs) => DB.prepare("SELECT expires_at, encerrado_em FROM extras_pagos WHERE assinatura_id = ?1").bind(subs).first();
  const R1 = "mb_11111111-1111-4111-8111-111111111111", R2 = "mb_22222222-2222-4222-8222-222222222222", R3 = "mb_33333333-3333-4333-8333-333333333333";
  const M1 = "5d2c1c0a-3f1b-4a52-8b8e-1f2a3b4c5d6e", M2 = "7e3d2d1b-4a2c-4b63-9c9f-2a3b4c5d6e7f", M3 = "8b4e3e2c-5b3d-4c74-8d0a-3b4c5d6e7f8a";

  // O checkout recusa antes de falar com a AbacatePay: sem o Pro, e produto fora do catálogo.
  let r = await chamar("POST", "/conta/assinatura", { produto: "extra-maquina" }, tb);
  assert.equal(r.status, 409, r.corpo.erro); assert.match(r.corpo.erro, /assine o Pro primeiro/);
  r = await chamar("POST", "/conta/assinatura", { produto: "extra-maquina" }, ta, { ...env, ABACATEPAY_EXTRAS: "" });
  assert.equal(r.status, 400, "catálogo vazio: a máquina extra não está à venda");

  // Sem extra: uma máquina.
  assert.equal((await chamar("POST", "/conta/maquinas", { id: M1, apelido: "primeira" }, ta)).status, 200);
  assert.equal((await chamar("POST", "/conta/maquinas", { id: M2, apelido: "segunda" }, ta)).status, 409);

  // Pago abaixo do preço: não abre vaga, vai para a revisão do admin.
  let w = await webhook({ ref: await checkout(R3), subs: "subs_barata", pago: 100 });
  assert.equal(w.status, 200); assert.match(w.resultado, /^revisar/);
  assert.equal(await extra("subs_barata"), null);

  // A primeira cobrança abre a vaga, sem pedido de "liberar" para o admin.
  w = await webhook({ ref: await checkout(R1), subs: "subs_m1" });
  assert.match(w.resultado, /^extra-maquina liberado até /);
  let c = await conta();
  assert.deepEqual([c.maquinaLimite, c.maquinaExtras], [2, 1]);
  const ass = c.assinaturas.find((a) => a.id === "subs_m1");
  assert.equal(ass.produto, "extra-maquina"); assert.equal(ass.valeAte, (await extra("subs_m1")).expires_at);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE conta_id = ?1 AND tipo = 'pagamento.liberar'").bind(A).first()).n, 0);
  assert.equal((await chamar("POST", "/conta/maquinas", { id: M2, apelido: "segunda" }, ta)).status, 200);
  assert.equal((await chamar("POST", "/conta/maquinas", { id: M3, apelido: "terceira" }, ta)).status, 409);

  // A renovação estende o prazo da MESMA linha (não soma outra vaga). O prazo é posto perto do fim para a conta aparecer.
  const perto = new Date(Date.now() + 2 * 86400000).toISOString();
  await DB.prepare("UPDATE extras_pagos SET expires_at = ?1 WHERE assinatura_id = 'subs_m1'").bind(perto).run();
  w = await webhook({ evento: "subscription.renewed", ref: R1, subs: "subs_m1" });
  assert.match(w.resultado, /^extra-maquina liberado até /);
  assert.ok(Date.parse((await extra("subs_m1")).expires_at) > Date.parse(perto) + 20 * 86400000, "a renovação estendeu o prazo");
  assert.equal((await conta()).maquinaLimite, 2);

  // Outra assinatura é outra máquina.
  w = await webhook({ ref: await checkout(R2), subs: "subs_m2" });
  c = await conta();
  assert.deepEqual([c.maquinaLimite, c.maquinaExtras], [3, 2]);
  assert.equal((await chamar("POST", "/conta/maquinas", { id: M3, apelido: "terceira" }, ta)).status, 200);

  // Encerrada pelo admin (reembolso): a cobrança seguinte não a devolve, vira pedido de revisão.
  const tadm = await assinarJwt({ sub: A, sid: "s", dev: null, adm: "super", iat: s, exp: s + 3600 }, HMAC);
  assert.equal((await chamar("POST", `/admin/contas/${A}/extras/subs_m2/encerrar`, {}, ta)).status, 403, "só admin encerra");
  assert.equal((await chamar("POST", `/admin/contas/${A}/extras/subs_naoexiste/encerrar`, {}, tadm)).status, 404);
  assert.equal((await chamar("POST", `/admin/contas/${B}/extras/subs_m2/encerrar`, {}, tadm)).status, 404, "a assinatura é de outra conta");
  r = await chamar("GET", "/admin/visao", undefined, tadm);
  assert.deepEqual(r.corpo.contas.find((x) => x.id === A).extrasPagos.map((x) => [x.assinaturaId, x.tipo]).sort(), [["subs_m1", "maquina"], ["subs_m2", "maquina"]]);
  assert.equal((await chamar("POST", `/admin/contas/${A}/extras/subs_m2/encerrar`, {}, tadm)).status, 200);
  assert.notEqual((await extra("subs_m2")).encerrado_em, null);
  assert.equal((await chamar("POST", `/admin/contas/${A}/extras/subs_m2/encerrar`, {}, tadm)).status, 404, "já encerrada");
  await new Promise((ok) => setTimeout(ok, 5));
  w = await webhook({ evento: "subscription.renewed", ref: R2, subs: "subs_m2" });
  assert.match(w.resultado, /^revisar: cobrança de extra-maquina encerrado pelo admin/);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE conta_id = ?1 AND tipo = 'pagamento.revisar'").bind(A).first()).n, 2, "o pagamento abaixo do preço e esta cobrança");
  assert.equal((await conta()).maquinaLimite, 2);

  // Três máquinas vinculadas, limite 2: a que entrou por último não renova; as duas mais antigas, sim.
  r = await chamar("POST", `/conta/maquinas/${M3}/licenca`, undefined, ta);
  assert.equal(r.status, 409); assert.equal(r.corpo.semExtra, true); assert.equal(r.corpo.limite, 2); assert.match(r.corpo.erro, /adicione uma máquina no console/);
  assert.equal((await chamar("POST", `/conta/maquinas/${M2}/licenca`, undefined, ta)).status, 200);
  assert.equal((await chamar("POST", `/conta/maquinas/${M1}/licenca`, undefined, ta)).status, 200);
  // Pelo vincular também não renova, e sem a máquina extra à venda a mensagem não manda comprar.
  r = await chamar("POST", "/conta/maquinas", { id: M3 }, ta, { ...env, ABACATEPAY_EXTRAS: "" });
  assert.equal(r.status, 409); assert.equal(r.corpo.semExtra, true); assert.doesNotMatch(r.corpo.erro, /adicione uma máquina/);

  // Cancelada na AbacatePay: a vaga continua até o fim do mês pago.
  w = await webhook({ evento: "subscription.cancelled", ref: R1, subs: "subs_m1" });
  c = await conta();
  assert.equal(c.assinaturas.find((a) => a.id === "subs_m1").status, "CANCELLED");
  assert.equal(c.maquinaLimite, 2);
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
