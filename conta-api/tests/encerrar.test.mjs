// O admin encerra com motivo o Pro, um add-on pago ou uma cortesia: a cobrança para na AbacatePay antes de o acesso
// sair, e sem essa confirmação nada muda. D1 local (miniflare) com as migrações do repositório e a AbacatePay simulada.
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
const DIA = 86400000;

test("encerrar com motivo: Pro pago, add-on pago e Pro de cortesia; a AbacatePay recusando não muda nada", async () => {
  const persist = mkdtempSync(join(tmpdir(), "conta-d1-"));
  const { getPlatformProxy } = req("wrangler");
  const px = await getPlatformProxy({ configPath: api + "/wrangler.toml", environment: "staging", persist: { path: persist } });
  const fetchReal = globalThis.fetch;
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
    const env = { ...px.env, DB, GA_ID: "", SESSAO_HMAC_KEY: HMAC, LICENCA_PRIVATE_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), ABACATEPAY_KEY: "abc_dev_x", ABACATEPAY_WEBHOOK_SECRET: "s".repeat(40), ABACATEPAY_ADDONS: '{"meu-bot-finance":{"produto":"prod_financas1","centavos":99700,"rotulo":"Finanças"}}' };
    const agora = new Date().toISOString(), daqui = (d) => new Date(Date.now() + d * DIA).toISOString();
    const ADM = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a", A = "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a", C = "3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c", N = "4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d";
    for (const [id, email] of [[ADM, "adm@exemplo.com"], [A, "ana@exemplo.com"], [C, "cris@exemplo.com"], [N, "nina@exemplo.com"]]) await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
    await DB.prepare("INSERT INTO admins (email, papel, criado_em) VALUES ('adm@exemplo.com', 'admin', ?1)").bind(agora).run();
    // Ana: Pro pago por assinatura e Finanças pago, os dois em dia.
    await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, ?3, 2, '[]', ?2, 'system')").bind(A, agora, daqui(20)).run();
    await DB.prepare("INSERT INTO assinaturas (id, conta_id, ref, status, metodo, valor_centavos, criada_em, atualizada_em, produto) VALUES ('subs_pro1', ?1, 'mb_x', 'ACTIVE', 'CARD', 9700, ?2, ?2, NULL), ('subs_fin1', ?1, 'mb_y', 'ACTIVE', 'CARD', 99700, ?2, ?2, 'meu-bot-finance')").bind(A, agora).run();
    await DB.prepare("INSERT INTO addons_pagos (conta_id, produto, expires_at, atualizado_em) VALUES (?1, 'meu-bot-finance', ?2, ?3)").bind(A, daqui(20), agora).run();
    const s = Math.floor(Date.now() / 1000);
    const tok = (sub, adm = null) => assinarJwt({ sub, sid: "s", dev: null, adm, iat: s, exp: s + 3600 }, HMAC);
    const [tadm, ta, tc] = await Promise.all([tok(ADM, "admin"), tok(A), tok(C)]);
    const chamar = async (metodo, caminho, corpo, t) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env, { waitUntil() {} }); return { status: r.status, corpo: await r.json() }; };
    let respostaAbacate = { status: 500, corpo: { success: false, error: "falhou" } };
    const pedidos = [];
    globalThis.fetch = async (url, init) => { if (!String(url).startsWith("https://api.abacatepay.com/")) return fetchReal(url, init); pedidos.push(JSON.parse(init.body).id); return new Response(JSON.stringify(respostaAbacate.corpo), { status: respostaAbacate.status, headers: { "content-type": "application/json" } }); };

    // Só admin; motivo da lista obrigatório ("outro" pede o detalhe).
    assert.equal((await chamar("POST", `/admin/contas/${A}/pro/encerrar`, { motivo: "reembolso" }, ta)).status, 403);
    assert.equal((await chamar("POST", `/admin/contas/${A}/pro/encerrar`, {}, tadm)).status, 400);
    assert.equal((await chamar("POST", `/admin/contas/${A}/pro/encerrar`, { motivo: "outro" }, tadm)).status, 400);

    // A AbacatePay não cancela: nada muda, e o admin vê o motivo.
    let r = await chamar("POST", `/admin/contas/${A}/pro/encerrar`, { motivo: "reembolso", detalhe: "pediu no WhatsApp" }, tadm);
    assert.equal(r.status, 502); assert.match(r.corpo.erro, /nada foi encerrado/);
    assert.equal((await chamar("GET", "/conta", undefined, ta)).corpo.licenca.status, "active");
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM encerramentos").first()).n, 0);

    // Com a AbacatePay cancelando: a cobrança para, a licença vence agora, e o histórico guarda o motivo.
    respostaAbacate = { status: 200, corpo: { success: true, data: { status: "CANCELLED" } } };
    r = await chamar("POST", `/admin/contas/${A}/pro/encerrar`, { motivo: "reembolso", detalhe: "pediu no WhatsApp" }, tadm);
    assert.equal(r.status, 200, r.corpo.erro); assert.match(r.corpo.aviso, /painel da AbacatePay/);
    assert.equal(pedidos.at(-1), "subs_pro1");
    let c = (await chamar("GET", "/conta", undefined, ta)).corpo;
    // Com o Finanças ainda pago, a licença em vigor vira o plano grátis com o add-on (licencaComAddons); a gravada venceu.
    assert.equal(c.licenca.plan, "free"); assert.equal(c.origemDoPro, null);
    assert.equal((await DB.prepare("SELECT status FROM licencas WHERE conta_id = ?1").bind(A).first()).status, "expired");
    assert.equal((await DB.prepare("SELECT status FROM assinaturas WHERE id = 'subs_pro1'").first()).status, "CANCELLED");
    let h = await DB.prepare("SELECT alvo, ref, motivo, detalhe, cobranca, por FROM encerramentos WHERE conta_id = ?1").bind(A).all();
    assert.deepEqual(h.results, [{ alvo: "pro", ref: "subs_pro1", motivo: "reembolso", detalhe: "pediu no WhatsApp", cobranca: "subs_pro1 cancelada na AbacatePay", por: "adm@exemplo.com" }]);
    assert.equal((await chamar("POST", `/admin/contas/${A}/pro/encerrar`, { motivo: "reembolso" }, tadm)).status, 404, "já não tem Pro valendo");

    // Add-on pago: a assinatura dele é a que para.
    r = await chamar("POST", `/admin/contas/${A}/addons/meu-bot-finance/encerrar`, { motivo: "disputa" }, tadm);
    assert.equal(r.status, 200, r.corpo.erro);
    assert.equal(pedidos.at(-1), "subs_fin1");
    assert.equal((await DB.prepare("SELECT status FROM assinaturas WHERE id = 'subs_fin1'").first()).status, "CANCELLED");
    assert.ok(!(await chamar("GET", "/conta", undefined, ta)).corpo.licenca.produtos.includes("meu-bot-finance"));

    // Pro só de cortesia: encerra a cortesia, sem falar com a AbacatePay.
    const antes = pedidos.length;
    assert.equal((await chamar("POST", `/admin/contas/${C}/cortesias`, { tipo: "pro", fim: daqui(30), motivo: "parceiro" }, tadm)).status, 200);
    assert.equal((await chamar("GET", "/conta", undefined, tc)).corpo.origemDoPro, "cortesia");
    r = await chamar("POST", `/admin/contas/${C}/pro/encerrar`, { motivo: "erro-ou-teste" }, tadm);
    assert.equal(r.status, 200, r.corpo.erro); assert.equal(r.corpo.cobranca, "sem assinatura ativa");
    assert.equal(pedidos.length, antes);
    c = (await chamar("GET", "/conta", undefined, tc)).corpo;
    assert.equal(c.licenca.plan, "free"); assert.ok(c.cortesias[0].encerradaEm);

    // Conta sem Pro: nada a encerrar.
    assert.equal((await chamar("POST", `/admin/contas/${N}/pro/encerrar`, { motivo: "reembolso" }, tadm)).status, 404);
  } finally {
    globalThis.fetch = fetchReal;
    await px.dispose();
    rmSync(persist, { recursive: true, force: true });
  }
});
