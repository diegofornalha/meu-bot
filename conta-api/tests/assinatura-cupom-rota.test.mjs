// "Tenho um cupom" na rota (POST /conta/assinatura {cupom: true}): o checkout sai no cartão com os cupons ativos da
// loja, guarda o menor preço para o webhook, e é recusado para add-on, para quem já pagou e sem cupom nenhum.
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

test("tenho um cupom na rota: checkout no cartão com os cupons da loja; recusas", async () => {
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
    const { privateKey } = generateKeyPairSync("ed25519");
    const HMAC = Buffer.from("k".repeat(32)).toString("base64");
    const env = { ...px.env, DB, ABACATEPAY_KEY: "k", ABACATEPAY_WEBHOOK_SECRET: "s", ABACATEPAY_PRODUTO: "prod_pro", ABACATEPAY_PRECO_CENTAVOS: "9700", ABACATEPAY_METODOS: "CARD,PIX", PROMO_CUPOM: "PRIMEIROMES1", PROMO_PRECO_CENTAVOS: "100", PROMO_DIAS: "3", CONSOLE_ORIGIN: "https://console.local", ADMIN_BOOTSTRAP_EMAIL: "dona@exemplo.com", SESSAO_HMAC_KEY: HMAC, LICENCA_PRIVATE_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") };
    const agora = new Date().toISOString();
    const A = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", B = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22";
    for (const [id, email] of [[A, "ana@exemplo.com"], [B, "bia@exemplo.com"]]) {
      await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "fb-" + id, email, agora).run();
      await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'trialing', NULL, ?2, ?3, 1, '[]', ?2, 'system')").bind(id, agora, new Date(Date.now() + 20 * 86400000).toISOString()).run();
    }
    const s = Math.floor(Date.now() / 1000);
    const tok = (sub) => assinarJwt({ sub, sid: "s", dev: null, adm: null, iat: s, exp: s + 3600 }, HMAC);
    const chamar = async (metodo, caminho, corpo, t) => {
      const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env, { waitUntil() {} });
      return { status: r.status, corpo: await r.json().catch(() => ({})) };
    };
    const ta = await tok(A), tb = await tok(B);
    const criados = []; let cupons = [{ id: "DEZ", status: "ACTIVE", discountKind: "PERCENTAGE", discount: 1000, maxRedeems: -1, redeemsCount: 0 }]; let listaStatus = 200;
    const fetchReal = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (!u.startsWith("https://api.abacatepay.com/")) return fetchReal(url, init);
      if (u.includes("/coupons/list")) return new Response(JSON.stringify({ success: listaStatus === 200, data: cupons }), { status: listaStatus });
      if (u.includes("/subscriptions/create")) { criados.push(JSON.parse(init.body)); return new Response(JSON.stringify({ data: { id: `bill_${criados.length}`, url: "https://app.abacatepay.com/pay/bill_x" } }), { status: 200 }); }
      return new Response("{}", { status: 404 });
    };
    try {
      let r = await chamar("POST", "/conta/assinatura", { cupom: true, produto: "extra-maquina" }, ta);
      assert.notEqual(r.status, 200, "cupom não abre checkout de add-on ou extra"); assert.equal(criados.length, 0);

      r = await chamar("POST", "/conta/assinatura", { cupom: true }, ta);
      assert.equal(r.status, 200, JSON.stringify(r.corpo)); assert.match(r.corpo.url, /abacatepay\.com/);
      assert.deepEqual(criados[0].methods, ["CARD"], "com cupom, só cartão (a AbacatePay recusa cupom com Pix)");
      assert.deepEqual(criados[0].coupons, ["PRIMEIROMES1", "DEZ"], "os da loja, do menor preço para o maior");
      let ck = await DB.prepare("SELECT cupom, cupom_centavos, promo, produto FROM pagamento_checkouts WHERE conta_id = ?1 ORDER BY criado_em DESC LIMIT 1").bind(A).first();
      assert.deepEqual([ck.cupom, ck.cupom_centavos, ck.promo, ck.produto], ["PRIMEIROMES1 +1", 100, 0, null]);

      // A lista da AbacatePay falhou (chave sem o escopo): o checkout sai só com o cupom da promoção, da configuração.
      listaStatus = 403;
      r = await chamar("POST", "/conta/assinatura", { cupom: true }, ta);
      assert.equal(r.status, 200); assert.deepEqual(criados[1].coupons, ["PRIMEIROMES1"]);
      // Sem promoção configurada e sem lista: não há cupom, e nada é criado.
      const semPromo = { ...env, PROMO_CUPOM: "" };
      const antes = criados.length;
      const resp = await worker.fetch(new Request("https://api.local/conta/assinatura", { method: "POST", headers: { authorization: "Bearer " + ta, "content-type": "application/json" }, body: JSON.stringify({ cupom: true }) }), semPromo, { waitUntil() {} });
      assert.equal(resp.status, 409); assert.equal(criados.length, antes);

      // Quem já pagou o Pro não usa cupom.
      listaStatus = 200;
      await DB.prepare("INSERT INTO assinaturas (id, conta_id, ref, status, criada_em, atualizada_em) VALUES ('subs_antiga', ?1, 'mb_antiga', 'CANCELLED', ?2, ?2)").bind(B, agora).run();
      r = await chamar("POST", "/conta/assinatura", { cupom: true }, tb);
      assert.equal(r.status, 409); assert.match(r.corpo.erro, /primeira assinatura/); assert.equal(criados.length, antes);
      // Sem `cupom`, o checkout normal continua com os métodos do ambiente e sem cupons.
      r = await chamar("POST", "/conta/assinatura", {}, tb);
      assert.equal(r.status, 200); assert.deepEqual(criados.at(-1).methods, ["CARD", "PIX"]); assert.equal(criados.at(-1).coupons, undefined);
    } finally { globalThis.fetch = fetchReal; }
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
