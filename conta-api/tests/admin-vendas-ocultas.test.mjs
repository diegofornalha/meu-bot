// Ocultar linhas da tela Assinaturas, de ponta a ponta: o handler do Worker chamado direto, contra um D1 local
// (miniflare) com as migrações do repositório. O super admin oculta uma assinatura e um pagamento: saem das listas e
// dos totais de /admin/visao, aparecem em /admin/auditoria e voltam por "mostrar". Nada é apagado nem cancelado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);

test("ocultar e mostrar uma assinatura e um pagamento: some da tela e dos totais, fica na auditoria, e volta", async () => {
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
    const env = { ...px.env, DB, SESSAO_HMAC_KEY: HMAC, ADMIN_BOOTSTRAP_EMAIL: "ninguem@exemplo.com" };
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
    const chamar = async (metodo, caminho, corpo, t) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env, { waitUntil() {} }); return { status: r.status, corpo: await r.json() }; };
    const ts = await tok(S, "super"), ta = await tok(A, "admin");
    const vendas = async () => { const v = (await chamar("GET", "/admin/visao", undefined, ts)).corpo.vendas; return [v.assinaturas.map((a) => a.id).sort(), v.pagamentos.map((p) => p.id).sort(), v.totais.proPago, v.totais.mensalCentavos]; };
    const ocultas = async () => (await chamar("GET", "/admin/auditoria", undefined, ts)).corpo.ocultas;

    assert.deepEqual(await vendas(), [["subs_cliente", "subs_teste"], ["char_cliente", "char_teste"], 2, 19400]);
    assert.deepEqual(await ocultas(), []);

    // Só o super admin oculta; id que não existe e ação fora do contrato não mudam nada.
    assert.equal((await chamar("POST", "/admin/vendas/assinaturas/subs_teste/ocultar", {}, ta)).status, 403);
    assert.equal((await chamar("POST", "/admin/vendas/assinaturas/subs_nao_existe/ocultar", {}, ts)).status, 404);
    assert.equal((await chamar("POST", "/admin/vendas/contas/subs_teste/ocultar", {}, ts)).status, 404);
    assert.equal((await chamar("POST", "/admin/vendas/assinaturas/subs_teste/mostrar", {}, ts)).status, 404, "o que não está oculto não tem o que mostrar");
    assert.deepEqual(await vendas(), [["subs_cliente", "subs_teste"], ["char_cliente", "char_teste"], 2, 19400]);

    // A compra de teste sai da tela e dos totais; a do cliente fica.
    assert.equal((await chamar("POST", "/admin/vendas/assinaturas/subs_teste/ocultar", {}, ts)).status, 200);
    assert.equal((await chamar("POST", "/admin/vendas/pagamentos/char_teste/ocultar", {}, ts)).status, 200);
    assert.equal((await chamar("POST", "/admin/vendas/assinaturas/subs_teste/ocultar", {}, ts)).status, 404, "já estava oculta");
    assert.deepEqual(await vendas(), [["subs_cliente"], ["char_cliente"], 1, 9700]);

    // Nada foi apagado nem cancelado: as linhas seguem no banco, a assinatura ativa, e a licença da conta é a mesma.
    const linha = await DB.prepare("SELECT status, valor_centavos, oculta_por FROM assinaturas WHERE id = 'subs_teste'").first();
    assert.deepEqual(linha, { status: "ACTIVE", valor_centavos: 9700, oculta_por: "super@exemplo.com" });
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM pagamentos").first()).n, 2);
    const conta = (await chamar("GET", "/conta", undefined, await tok(T))).corpo;
    assert.deepEqual([conta.licenca.plan, conta.licenca.status], ["pro", "active"]);
    assert.deepEqual(conta.assinaturas.map((a) => a.id), ["subs_teste"], "a pessoa continua vendo a própria assinatura");

    // A Auditoria mostra as duas, com a conta e quem ocultou, e o registro guarda a ação.
    const oc = await ocultas();
    assert.deepEqual(oc.map((v) => [v.tipo, v.id, v.produto, v.valorCentavos, v.ocultaPor, v.conta]).sort(), [
      ["assinaturas", "subs_teste", null, 9700, "super@exemplo.com", { id: T, email: "teste@exemplo.com" }],
      ["pagamentos", "char_teste", null, 9700, "super@exemplo.com", { id: T, email: "teste@exemplo.com" }],
    ]);
    const reg = (await chamar("GET", "/admin/auditoria", undefined, ts)).corpo.registro.filter((a) => a.acao === "venda.ocultada");
    assert.deepEqual(reg.map((a) => [a.quem, a.detalhe, a.conta.email]).sort(), [["super@exemplo.com", "assinaturas subs_teste", "teste@exemplo.com"], ["super@exemplo.com", "pagamentos char_teste", "teste@exemplo.com"]]);

    // "Mostrar de novo" devolve as duas à tela e aos totais.
    assert.equal((await chamar("POST", "/admin/vendas/assinaturas/subs_teste/mostrar", {}, ta)).status, 403);
    assert.equal((await chamar("POST", "/admin/vendas/assinaturas/subs_teste/mostrar", {}, ts)).status, 200);
    assert.equal((await chamar("POST", "/admin/vendas/pagamentos/char_teste/mostrar", {}, ts)).status, 200);
    assert.deepEqual(await vendas(), [["subs_cliente", "subs_teste"], ["char_cliente", "char_teste"], 2, 19400]);
    assert.deepEqual(await ocultas(), []);
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
