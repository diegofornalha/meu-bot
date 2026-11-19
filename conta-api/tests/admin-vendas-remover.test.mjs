// Remover uma assinatura da tela Assinaturas, de ponta a ponta: o handler do Worker chamado direto, contra um D1 local
// (miniflare) com as migrações do repositório e a AbacatePay simulada. O super admin remove: a cobrança é cancelada lá,
// a assinatura é apagada daqui (sai da lista e da receita) e os pagamentos dela ficam gravados, ocultos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);

test("remover uma assinatura: cancela na AbacatePay, apaga daqui, tira da receita e oculta os pagamentos", async () => {
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
    const env = { ...px.env, DB, SESSAO_HMAC_KEY: HMAC, ADMIN_BOOTSTRAP_EMAIL: "ninguem@exemplo.com", ABACATEPAY_KEY: "abc_dev_x", ABACATEPAY_WEBHOOK_SECRET: "s".repeat(32), ABACATEPAY_PRODUTO: "prod_x" };
    const agora = new Date().toISOString();
    const S = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", A = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22", C = "2d2f8e3f-8f3f-4d9f-9e77-2f8c5f3e4f33", T = "3e3f9f4f-9a4f-4e0f-8f88-3a9d6f4f5a44";
    for (const [id, email] of [[S, "super@exemplo.com"], [A, "admin@exemplo.com"], [C, "cliente@exemplo.com"], [T, "teste@exemplo.com"]]) {
      await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
      await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, '2099-01-01T00:00:00.000Z', 2, '[]', ?2, 'system')").bind(id, agora).run();
    }
    await DB.prepare("INSERT INTO admins (email, papel, criado_em) VALUES ('super@exemplo.com', 'super', ?1), ('admin@exemplo.com', 'admin', ?1)").bind(agora).run();
    // Duas assinaturas do Pro em dia, de 97 reais: a do cliente e a de uma compra de teste; cada uma com um pagamento.
    for (const [conta, n] of [[C, "cliente"], [T, "teste"]]) {
      await DB.prepare("INSERT INTO assinaturas (id, conta_id, ref, status, metodo, valor_centavos, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 'ACTIVE', 'PIX', 9700, ?4, ?4)").bind("subs_" + n, conta, "ref-" + n, agora).run();
      await DB.prepare("INSERT INTO pagamentos (id, conta_id, assinatura_id, valor_centavos, evento, pago_em) VALUES (?1, ?2, ?3, 9700, 'subscription.completed', ?4)").bind("char_" + n, conta, "subs_" + n, agora).run();
    }
    const s = Math.floor(Date.now() / 1000);
    const tok = async (sub, adm = null) => assinarJwt({ sub, sid: "s", dev: null, adm, iat: s, exp: s + 3600 }, HMAC);
    const chamar = async (metodo, caminho, corpo, t, e = env) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), e, { waitUntil() {} }); return { status: r.status, corpo: await r.json() }; };
    const ts = await tok(S, "super"), ta = await tok(A, "admin");
    const vendas = async () => { const v = (await chamar("GET", "/admin/visao", undefined, ts)).corpo.vendas; return [v.assinaturas.map((a) => a.id).sort(), v.pagamentos.map((p) => p.id).sort(), v.totais.proPago, v.totais.mensalCentavos]; };
    const ocultas = async () => (await chamar("GET", "/admin/auditoria", undefined, ts)).corpo.ocultas;

    // A AbacatePay simulada: guarda o que foi pedido e responde o que o caso mandar.
    const pedidos = []; let resposta = () => new Response(JSON.stringify({ success: true, data: { status: "CANCELLED" } }), { status: 200 });
    const fetchReal = globalThis.fetch;
    globalThis.fetch = async (url, init) => { if (!String(url).startsWith("https://api.abacatepay.com/")) return fetchReal(url, init); pedidos.push([String(url), JSON.parse(init.body).id]); return resposta(); };
    try {
      assert.deepEqual(await vendas(), [["subs_cliente", "subs_teste"], ["char_cliente", "char_teste"], 2, 19400]);

      // Só o super admin remove; id fora do formato ou que não existe não muda nada nem chama a AbacatePay.
      assert.equal((await chamar("DELETE", "/admin/vendas/assinaturas/subs_teste", undefined, ta)).status, 403);
      assert.equal((await chamar("DELETE", "/admin/vendas/assinaturas/char_teste", undefined, ts)).status, 400);
      assert.equal((await chamar("DELETE", "/admin/vendas/assinaturas/subs_nao_existe", undefined, ts)).status, 404);
      assert.deepEqual(pedidos, []);

      // A AbacatePay fora, sem permissão ou recusando: nada é apagado (senão a pessoa seguiria sendo cobrada sem a linha aqui).
      for (const [r, st] of [[() => { throw new Error("rede"); }, 502], [() => new Response("{}", { status: 403 }), 502], [() => new Response(JSON.stringify({ success: false, error: "boom" }), { status: 500 }), 502]]) {
        resposta = r;
        assert.equal((await chamar("DELETE", "/admin/vendas/assinaturas/subs_teste", undefined, ts)).status, st);
      }
      assert.equal((await chamar("DELETE", "/admin/vendas/assinaturas/subs_teste", undefined, ts, { ...env, ABACATEPAY_KEY: "" })).status, 503, "sem a chave não há como cancelar");
      assert.deepEqual(await vendas(), [["subs_cliente", "subs_teste"], ["char_cliente", "char_teste"], 2, 19400]);

      // Cancelada lá: a assinatura some do banco, da lista e da receita; o pagamento dela fica gravado, oculto.
      resposta = () => new Response(JSON.stringify({ success: true, data: { status: "CANCELLED" } }), { status: 200 });
      pedidos.length = 0;
      const r = await chamar("DELETE", "/admin/vendas/assinaturas/subs_teste", undefined, ts);
      assert.deepEqual([r.status, r.corpo], [200, { ok: true, pagamentosOcultos: 1 }]);
      assert.deepEqual(pedidos, [["https://api.abacatepay.com/v2/subscriptions/cancel", "subs_teste"]]);
      assert.deepEqual(await vendas(), [["subs_cliente"], ["char_cliente"], 1, 9700]);
      assert.equal(await DB.prepare("SELECT id FROM assinaturas WHERE id = 'subs_teste'").first(), null);
      assert.deepEqual(await DB.prepare("SELECT assinatura_id, oculta_por FROM pagamentos WHERE id = 'char_teste'").first(), { assinatura_id: "subs_teste", oculta_por: "super@exemplo.com" });
      assert.equal((await DB.prepare("SELECT oculta_em FROM pagamentos WHERE id = 'char_cliente'").first()).oculta_em, null, "o pagamento de outra assinatura não é tocado");
      assert.equal((await chamar("DELETE", "/admin/vendas/assinaturas/subs_teste", undefined, ts)).status, 404, "já foi removida");

      // O acesso já pago não muda, a pessoa deixa de ver a assinatura, e a auditoria guarda quem removeu e o quê.
      const conta = (await chamar("GET", "/conta", undefined, await tok(T))).corpo;
      assert.deepEqual([conta.licenca.plan, conta.licenca.status, conta.assinaturas], ["pro", "active", []]);
      const aud = (await chamar("GET", "/admin/auditoria", undefined, ts)).corpo;
      assert.deepEqual(aud.registro.filter((a) => a.acao === "assinatura.removida").map((a) => [a.quem, a.detalhe, a.conta.email]), [["super@exemplo.com", "subs_teste · Pro · 9700 centavos/mês · cancelada na AbacatePay · 1 pagamento(s) oculto(s)", "teste@exemplo.com"]]);
      assert.deepEqual(aud.ocultas.map((v) => [v.tipo, v.id]), [["pagamentos", "char_teste"]]);

      // Assinatura que a AbacatePay já não conhece (404): não há o que cancelar lá, e é removida do mesmo jeito.
      resposta = () => new Response(JSON.stringify({ success: false, error: "Subscription not found" }), { status: 404 });
      assert.equal((await chamar("DELETE", "/admin/vendas/assinaturas/subs_cliente", undefined, ts)).status, 200);
      assert.deepEqual(await vendas(), [[], [], 0, 0]);

      // Já cancelada aqui: remove sem chamar a AbacatePay, mesmo sem a chave.
      await DB.prepare("INSERT INTO assinaturas (id, conta_id, ref, status, metodo, valor_centavos, criada_em, atualizada_em) VALUES ('subs_velha', ?1, 'ref-velha', 'CANCELLED', 'PIX', 9700, ?2, ?2)").bind(C, agora).run();
      pedidos.length = 0;
      assert.equal((await chamar("DELETE", "/admin/vendas/assinaturas/subs_velha", undefined, ts, { ...env, ABACATEPAY_KEY: "" })).status, 200);
      assert.deepEqual(pedidos, []);
    } finally { globalThis.fetch = fetchReal; }
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
