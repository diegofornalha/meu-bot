// O estado do pedido "Liberar na máquina" de um add-on, como o console o lê em GET /conta (`liberacoes`): o handler do
// Worker chamado direto, contra um D1 local (miniflare) com as migrações do repositório. O webhook da AbacatePay paga o
// add-on (abre o pedido), o admin atende (fecha) e o campo acompanha. O Pro e a máquina extra não entram.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addonDoDetalheLiberar, detalheLiberar, liberacoesPorAddon } from "../dist/pagamento-core.js";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);

test("pedido de liberação: quem escreve o detalhe e quem o lê usam o mesmo par, e o resumo é por add-on", () => {
  assert.equal(detalheLiberar("meu-bot-finance"), "liberar na máquina: meu-bot-finance");
  assert.equal(detalheLiberar(null), "liberar na máquina: Pro");
  assert.equal(addonDoDetalheLiberar(detalheLiberar("meu-bot-finance")), "meu-bot-finance");
  for (const d of [detalheLiberar(null), null, "", "liberar na máquina: ", "pago abaixo do preço · meu-bot-finance"]) assert.equal(addonDoDetalheLiberar(d), null, String(d));
  const p = (produto, atendido_em) => ({ detalhe: detalheLiberar(produto), atendido_em });
  assert.deepEqual(liberacoesPorAddon([]), []);
  assert.deepEqual(liberacoesPorAddon([p(null, null)]), [], "o pedido do Pro não entra");
  // Um aberto basta para o add-on estar esperando, venha antes ou depois de um atendido (recompra depois de cancelar).
  assert.deepEqual(liberacoesPorAddon([p("a", "2026-11-01T00:00:00.000Z"), p("a", null), p("b", "2026-11-02T00:00:00.000Z")]), [{ produto: "a", aberta: true }, { produto: "b", aberta: false }]);
  assert.deepEqual(liberacoesPorAddon([p("a", null), p("a", "2026-11-01T00:00:00.000Z")]), [{ produto: "a", aberta: true }]);
});

test("GET /conta: o add-on pago aparece com a liberação aberta, e fechada depois que o admin atende", async () => {
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
    const HMAC = Buffer.from("k".repeat(32)).toString("base64"), SEGREDO = "s".repeat(40);
    const ADDONS = '{"meu-bot-finance":{"produto":"prod_financas1","centavos":99700,"rotulo":"Finanças"},"meu-bot-diego":{"produto":"prod_diego1","centavos":99700,"rotulo":"Módulos do Diego"}}';
    // GA_ID vazio: a compra não tenta falar com o Analytics.
    const env = { ...px.env, DB, GA_ID: "", SESSAO_HMAC_KEY: HMAC, ADMIN_BOOTSTRAP_EMAIL: "ninguem@exemplo.com", ABACATEPAY_KEY: "abc_dev_x", ABACATEPAY_WEBHOOK_SECRET: SEGREDO, ABACATEPAY_ADDONS: ADDONS, ABACATEPAY_EXTRAS: "" };
    const agora = new Date().toISOString();
    const C = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", S = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22", O = "2d2f8e3f-8f3f-4d9f-9e77-2f8c5f3e4f33";
    for (const [id, email] of [[C, "cliente@exemplo.com"], [S, "super@exemplo.com"], [O, "outra@exemplo.com"]]) await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
    await DB.prepare("INSERT INTO admins (email, papel, criado_em) VALUES ('super@exemplo.com', 'super', ?1)").bind(agora).run();
    const s = Math.floor(Date.now() / 1000);
    const tok = (sub, adm = null) => assinarJwt({ sub, sid: "s", dev: null, adm, iat: s, exp: s + 3600 }, HMAC);
    const tc = await tok(C), ts = await tok(S, "super"), to = await tok(O);
    const chamar = async (metodo, caminho, corpo, t) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env, { waitUntil() {} }); return { status: r.status, corpo: await r.json() }; };
    // O webhook como a AbacatePay o manda no Modo Teste (o staging só aceita devMode): secret no cabeçalho e o corpo assinado.
    let n = 0;
    const pagar = async (produto, ref, subs, valor) => {
      n++;
      await DB.prepare("INSERT INTO pagamento_checkouts (ref, conta_id, checkout_id, ga_client_id, ga_session_id, criado_em, produto, promo) VALUES (?1, ?2, NULL, NULL, NULL, ?3, ?4, 0)").bind(ref, C, agora, produto).run();
      const corpo = JSON.stringify({ id: `log_${n}`, event: "subscription.completed", apiVersion: 2, devMode: true, data: { subscription: { id: subs, amount: valor, currency: "BRL", method: "CARD", status: "ACTIVE" }, checkout: { id: `bill_${n}`, externalId: ref, frequency: "SUBSCRIPTION" }, payment: { id: `card_${n}`, amount: valor, paidAmount: valor, status: "APPROVED", updatedAt: new Date().toISOString() } } });
      const r = await worker.fetch(new Request("https://api.local/pagamentos/abacatepay", { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": SEGREDO, "x-webhook-signature": await hmacBase64(CHAVE_HMAC_ABACATEPAY, corpo) }, body: corpo }), env, { waitUntil() {} });
      assert.equal(r.status, 200);
      return (await DB.prepare("SELECT resultado FROM webhook_eventos WHERE id = ?1").bind(`log_${n}`).first())?.resultado ?? null;
    };
    const conta = async (t = tc) => (await chamar("GET", "/conta", undefined, t)).corpo;

    // Antes de pagar: nada a liberar.
    assert.deepEqual((await conta()).liberacoes, []);

    // Pagou o Finanças: vale na conta na hora, e o pedido de liberação na máquina está aberto.
    assert.match(await pagar("meu-bot-finance", "mb_11111111-1111-4111-8111-111111111111", "subs_fin", 99700), /^meu-bot-finance liberado até /);
    let c = await conta();
    assert.ok(c.licenca.produtos.includes("meu-bot-finance"), "ativo na conta");
    assert.deepEqual(c.liberacoes, [{ produto: "meu-bot-finance", aberta: true }]);
    assert.equal(c.pedidos, 1);
    assert.deepEqual((await conta(to)).liberacoes, [], "o pedido é desta conta, não de outra");

    // Pagou também o Pro: o pedido do Pro existe para o admin, mas não entra em `liberacoes` (o Pro não tem esse passo na tela).
    assert.match(await pagar(null, "mb_22222222-2222-4222-8222-222222222222", "subs_pro", Number(env.ABACATEPAY_PRECO_CENTAVOS ?? 9700)), /liberado|ativo|Pro/i);
    c = await conta();
    assert.equal(c.pedidos, 2);
    assert.deepEqual(c.liberacoes, [{ produto: "meu-bot-finance", aberta: true }]);

    // O admin atende o pedido do Finanças (console › Suporte › "Atender"): a liberação fecha; o add-on continua na conta.
    const visao = (await chamar("GET", "/admin/visao", undefined, ts)).corpo;
    const pedido = visao.pedidos.find((p) => p.tipo === "pagamento.liberar" && p.conta.id === C && p.detalhe === "liberar na máquina: meu-bot-finance");
    assert.ok(pedido, "o admin vê o pedido Liberar na máquina do add-on");
    assert.equal((await chamar("POST", `/admin/pedidos/${pedido.id}/atender`, {}, ts)).status, 200);
    c = await conta();
    assert.deepEqual(c.liberacoes, [{ produto: "meu-bot-finance", aberta: false }]);
    assert.ok(c.licenca.produtos.includes("meu-bot-finance"));
    assert.equal(c.pedidos, 1, "ficou só o do Pro");

    // Um segundo add-on pago abre a própria liberação, sem reabrir a do primeiro.
    assert.match(await pagar("meu-bot-diego", "mb_33333333-3333-4333-8333-333333333333", "subs_diego", 99700), /^meu-bot-diego liberado até /);
    assert.deepEqual((await conta()).liberacoes.sort((a, b) => a.produto.localeCompare(b.produto)), [{ produto: "meu-bot-diego", aberta: true }, { produto: "meu-bot-finance", aberta: false }]);
  } finally {
    await px.dispose();
    rmSync(persist, { recursive: true, force: true });
  }
});
