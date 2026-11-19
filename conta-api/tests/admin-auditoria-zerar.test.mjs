// Zerar a tela Auditoria (só no staging), de ponta a ponta: o handler do Worker chamado direto, contra um D1 local
// (miniflare) com as migrações do repositório e a AbacatePay simulada. O super admin zera: as assinaturas ocultas são
// canceladas lá e apagadas daqui com os pagamentos ocultos, as contas apagadas saem de vez e o registro recomeça.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);

test("zerar a auditoria: só no staging, cancela e apaga o que estava oculto, tira as contas apagadas e recomeça o registro", async () => {
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
    const env = { ...px.env, DB, CANAL: "staging", SESSAO_HMAC_KEY: HMAC, ADMIN_BOOTSTRAP_EMAIL: "ninguem@exemplo.com", ABACATEPAY_KEY: "abc_dev_x", ABACATEPAY_WEBHOOK_SECRET: "s".repeat(32), ABACATEPAY_PRODUTO: "prod_x" };
    const agora = new Date().toISOString();
    const S = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", A = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22", C = "2d2f8e3f-8f3f-4d9f-9e77-2f8c5f3e4f33", T = "3e3f9f4f-9a4f-4e0f-8f88-3a9d6f4f5a44", X = "4f4f0a5f-0b5f-4f1f-9a99-4b0e7f5a6b55";
    for (const [id, email] of [[S, "super@exemplo.com"], [A, "admin@exemplo.com"], [C, "cliente@exemplo.com"], [T, "teste@exemplo.com"], [X, "apagada:" + X + ":foi@exemplo.com"]]) {
      await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em, apagada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4, ?5)").bind(id, "uid-" + id, email, agora, id === X ? agora : null).run();
      await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, '2099-01-01T00:00:00.000Z', 2, '[]', ?2, 'system')").bind(id, agora).run();
    }
    await DB.prepare("INSERT INTO admins (email, papel, criado_em) VALUES ('super@exemplo.com', 'super', ?1), ('admin@exemplo.com', 'admin', ?1)").bind(agora).run();
    await DB.prepare("INSERT INTO devices (conta_id, id, status, first_seen, last_seen) VALUES (?1, 'dev-da-apagada', 'active', ?2, ?2)").bind(X, agora).run();
    // [assinatura, conta, status, oculta]: a do cliente à vista; duas de teste ocultas (uma ativa, uma já cancelada);
    // a da conta apagada, oculta; e uma oculta que a AbacatePay vai se recusar a cancelar. Cada uma com um pagamento.
    for (const [n, conta, status, oculta] of [["cliente", C, "ACTIVE", false], ["teste", T, "ACTIVE", true], ["velha", T, "CANCELLED", true], ["apagada", X, "ACTIVE", true], ["falha", C, "ACTIVE", true]]) {
      await DB.prepare("INSERT INTO assinaturas (id, conta_id, ref, status, metodo, valor_centavos, criada_em, atualizada_em, oculta_em, oculta_por) VALUES (?1, ?2, ?3, ?4, 'PIX', 9700, ?5, ?5, ?6, ?7)").bind("subs_" + n, conta, "ref-" + n, status, agora, oculta ? agora : null, oculta ? "super@exemplo.com" : null).run();
      await DB.prepare("INSERT INTO pagamentos (id, conta_id, assinatura_id, valor_centavos, evento, pago_em, oculta_em, oculta_por) VALUES (?1, ?2, ?3, 9700, 'subscription.completed', ?4, ?5, ?6)").bind("char_" + n, conta, "subs_" + n, agora, oculta ? agora : null, oculta ? "super@exemplo.com" : null).run();
    }
    for (const [quem, acao, conta] of [["super@exemplo.com", "login.entrou", S], ["foi@exemplo.com", "conta.apagada", X], ["abacatepay (teste)", "assinatura.paga", T]]) await DB.prepare("INSERT INTO auditoria (quando, quem, acao, conta_id, detalhe) VALUES (?1, ?2, ?3, ?4, '-')").bind(agora, quem, acao, conta).run();
    const s = Math.floor(Date.now() / 1000);
    const tok = async (sub, adm = null) => assinarJwt({ sub, sid: "s", dev: null, adm, iat: s, exp: s + 3600 }, HMAC);
    const chamar = async (metodo, caminho, corpo, t, e = env) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), e, { waitUntil() {} }); return { status: r.status, corpo: await r.json().catch(() => null) }; };
    const ts = await tok(S, "super"), ta = await tok(A, "admin");
    const tela = async () => { const a = (await chamar("GET", "/admin/auditoria", undefined, ts)).corpo; return [a.apagadas.map((c) => c.email), a.ocultas.map((v) => v.id).sort(), a.registro.map((r) => r.acao).sort()]; };
    const ids = async (tabela) => (await DB.prepare(`SELECT id FROM ${tabela} ORDER BY id`).all()).results.map((x) => x.id);

    // A AbacatePay simulada: cancela tudo, menos a assinatura "falha".
    const pedidos = [];
    const fetchReal = globalThis.fetch;
    globalThis.fetch = async (url, init) => { if (!String(url).startsWith("https://api.abacatepay.com/")) return fetchReal(url, init); const id = JSON.parse(init.body).id; pedidos.push(id); return id === "subs_falha" ? new Response(JSON.stringify({ success: false, error: "boom" }), { status: 500 }) : new Response(JSON.stringify({ success: true, data: { status: "CANCELLED" } }), { status: 200 }); };
    try {
      assert.deepEqual(await tela(), [["foi@exemplo.com"], ["char_apagada", "char_falha", "char_teste", "char_velha", "subs_apagada", "subs_falha", "subs_teste", "subs_velha"], ["assinatura.paga", "conta.apagada", "login.entrou"]]);

      // Só o super admin, e só no staging: em produção nada é tocado nem cancelado.
      assert.equal((await chamar("POST", "/admin/auditoria/zerar", {}, ta)).status, 403);
      const prod = await chamar("POST", "/admin/auditoria/zerar", {}, ts, { ...env, CANAL: "producao" });
      assert.deepEqual([prod.status, prod.corpo.erro], [403, "zerar a auditoria só existe no staging"]);
      assert.deepEqual(pedidos, []);
      assert.equal((await ids("assinaturas")).length, 5);

      const r = await chamar("POST", "/admin/auditoria/zerar", {}, ts);
      assert.deepEqual([r.status, r.corpo], [200, { ok: true, assinaturas: 3, pagamentos: 3, contas: 1, registro: 3, naoCanceladas: 1 }]);
      // Cancelou lá só as ocultas ainda ativas; a já cancelada e a que está à vista não geram pedido.
      assert.deepEqual(pedidos.sort(), ["subs_apagada", "subs_falha", "subs_teste"]);
      // Ficam a assinatura à vista do cliente e a que não deu para cancelar, cada uma com o seu pagamento.
      assert.deepEqual(await ids("assinaturas"), ["subs_cliente", "subs_falha"]);
      assert.deepEqual(await ids("pagamentos"), ["char_cliente", "char_falha"]);
      // A conta apagada saiu de vez, com a licença e o device; as outras contas não mudam.
      assert.deepEqual((await ids("contas")).sort(), [S, A, C, T].sort());
      assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM licencas WHERE conta_id = ?1").bind(X).first()).n, 0);
      assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM devices WHERE conta_id = ?1").bind(X).first()).n, 0);
      assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM licencas").first()).n, 4);
      // A tela: nenhuma conta apagada, só o que não deu para cancelar, e uma linha dizendo quem zerou e o que saiu.
      assert.deepEqual(await tela(), [[], ["char_falha", "subs_falha"], ["auditoria.zerada"]]);
      const marca = await DB.prepare("SELECT quem, detalhe FROM auditoria").first();
      assert.deepEqual(marca, { quem: "super@exemplo.com", detalhe: "3 ação(ões), 3 assinatura(s), 3 pagamento(s) e 1 conta(s) apagada(s) saíram; 1 assinatura(s) ficaram: a AbacatePay não confirmou o cancelamento" });
      const visao = (await chamar("GET", "/admin/visao", undefined, ts)).corpo.vendas;
      assert.deepEqual([visao.assinaturas.map((a) => a.id), visao.totais.mensalCentavos], [["subs_cliente"], 9700], "a receita à vista não muda");
    } finally { globalThis.fetch = fetchReal; }
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
