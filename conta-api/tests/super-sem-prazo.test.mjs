// O Pro sem prazo do super admin de ponta a ponta: o handler do Worker chamado direto, contra um D1 local (miniflare)
// com as migrações do repositório. A mesma licença gravada (teste vencido, status expirado) em três contas: super
// admin, admin comum e conta sem papel. Só a do super admin vira Pro ativo sem prazo, e em todo lugar que a lê.
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

test("super admin com a licença gravada expirada: Pro ativo sem prazo no console, na máquina e na lista do admin", async () => {
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
    const be = req("../../backend-colima/licenca.js");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const chaves = [{ id: "licenca-2026-11", chave: publicKey.export({ format: "der", type: "spki" }).toString("base64") }];
    const HMAC = Buffer.from("k".repeat(32)).toString("base64");
    // Pagamentos e promoção ligados (chaves de mentira: nenhuma chamada sai, as recusas vêm antes), e um bootstrap que
    // não é nenhuma destas contas, para o papel vir só da tabela `admins`.
    const env = { ...px.env, DB, SESSAO_HMAC_KEY: HMAC, LICENCA_PRIVATE_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), ADMIN_BOOTSTRAP_EMAIL: "ninguem@exemplo.com", ABACATEPAY_KEY: "chave-de-teste", ABACATEPAY_WEBHOOK_SECRET: "s".repeat(32), ABACATEPAY_PRODUTO: "prod_teste", ABACATEPAY_PRECO_CENTAVOS: "9700", PROMO_CUPOM: "PRIMEIROMES1", PROMO_PRECO_CENTAVOS: "100", PROMO_DIAS: "3" };
    const agora = new Date().toISOString(), ontem = new Date(Date.now() - 864e5).toISOString();
    const S = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", A = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22", C = "2d2f8e3f-8f3f-4d9f-9e77-2f8c5f3e4f33";
    const contas = [[S, "super@exemplo.com"], [A, "admin@exemplo.com"], [C, "comum@exemplo.com"]];
    for (const [id, email] of contas) {
      await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
      // O teste grátis acabou ontem e a licença ficou expirada: dentro da janela da promoção do primeiro mês.
      await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, trial_end, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'expired', NULL, ?2, ?3, ?3, 2, '[\"meu-bot-fit\"]', ?2, 'system')").bind(id, agora, ontem).run();
    }
    await DB.prepare("INSERT INTO admins (email, papel, criado_em) VALUES ('super@exemplo.com', 'super', ?1), ('admin@exemplo.com', 'admin', ?1)").bind(agora).run();
    const s = Math.floor(Date.now() / 1000);
    const tok = async (sub, adm = null) => assinarJwt({ sub, sid: "s", dev: null, adm, iat: s, exp: s + 3600 }, HMAC);
    const chamar = async (metodo, caminho, corpo, t) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env, { waitUntil() {} }); return { status: r.status, corpo: await r.json() }; };
    const ts = await tok(S, "super"), ta = await tok(A, "admin"), tc = await tok(C);
    const gravadaAntes = await DB.prepare("SELECT * FROM licencas WHERE conta_id = ?1").bind(S).first();

    // GET /conta (console e app): só o super admin tem o Pro sem prazo e todos os add-ons do catálogo do ambiente, além
    // do que já estava gravado; os limites não mudam.
    const catalogo = Object.keys(JSON.parse(env.ABACATEPAY_ADDONS));
    assert.equal(catalogo.length > 0, true, "o ambiente de teste tem add-ons no catálogo");
    let r = await chamar("GET", "/conta", undefined, ts);
    const l = r.corpo.licenca;
    assert.equal(r.status, 200);
    assert.deepEqual([r.corpo.admin, l.plan, l.status, l.trialEnd, l.expiresAt, l.interval, l.semPrazo], ["super", "pro", "active", null, null, null, true]);
    assert.deepEqual([l.deviceLimit, l.produtos, r.corpo.maquinaLimite], [2, [...catalogo, "meu-bot-fit"].sort(), 1], "limites de devices e de máquinas ficam como estão; os add-ons são o gravado mais o catálogo inteiro");
    assert.equal(r.corpo.promo, null, "super admin não recebe a oferta do primeiro mês");
    for (const [t, papel] of [[ta, "admin"], [tc, null]]) {
      r = await chamar("GET", "/conta", undefined, t);
      assert.deepEqual([r.corpo.admin, r.corpo.licenca.plan, r.corpo.licenca.status, r.corpo.licenca.expiresAt, "semPrazo" in r.corpo.licenca], [papel, "pro", "expired", ontem, false], `papel ${papel}: a licença gravada, expirada`);
      assert.deepEqual(r.corpo.licenca.produtos, ["meu-bot-fit"], `papel ${papel}: só o add-on gravado, sem o catálogo`);
      assert.equal(r.corpo.promo?.cupom, "PRIMEIROMES1", `papel ${papel}: a promoção continua valendo`);
    }

    // O papel vem da tabela, não do token: um token sem `adm` de uma conta super recebe a mesma licença.
    r = await chamar("GET", "/conta", undefined, await tok(S));
    assert.equal(r.corpo.licenca.semPrazo, true);

    // Assinar o Pro: 409 com a mensagem do super admin, com ou sem `promo`; add-on fora do catálogo segue a regra de sempre.
    for (const corpo of [{}, { promo: true }, { semPromo: true }]) {
      r = await chamar("POST", "/conta/assinatura", corpo, ts);
      assert.deepEqual([r.status, r.corpo.erro], [409, "sua conta de super admin já tem o Pro sem prazo"]);
    }
    // Assinar um add-on do catálogo: o super admin já tem todos, então também é 409 e nenhum checkout nasce.
    for (const produto of catalogo) {
      r = await chamar("POST", "/conta/assinatura", { produto }, ts);
      assert.equal(r.status, 409); assert.match(r.corpo.erro, /^sua conta de super admin já tem o /);
    }
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM pagamento_checkouts").first()).n, 0, "nenhum checkout foi criado");

    // A licença por máquina: a mesma regra, e o backend da máquina a aceita como Pro em vigor.
    const M1 = "5d2c1c0a-3f1b-4a52-8b8e-1f2a3b4c5d6e", M2 = "7e3d2d1b-4a2c-4b63-9c9f-2a3b4c5d6e7f", M3 = "8b4e3e2c-5b3d-4c74-8d0a-3b4c5d6e7f8a";
    r = await chamar("POST", "/conta/maquinas", { id: M1, apelido: "Karen" }, ts);
    const v = be.verificaLicencaAssinada(r.corpo.licenca, { chaves, maquina: M1 });
    assert.equal(r.status, 200); assert.equal(v.ok, true);
    assert.deepEqual([v.payload.licenca.plan, v.payload.licenca.status, v.payload.licenca.expiresAt, v.payload.licenca.trialEnd], ["pro", "active", null, null]);
    assert.deepEqual(v.payload.licenca.produtos, [...catalogo, "meu-bot-fit"].sort(), "a máquina do super admin libera todos os add-ons");
    r = await chamar("POST", "/conta/maquinas", { id: M2 }, ts);
    assert.deepEqual([r.status, r.corpo.noLimite], [409, true], "o limite de máquinas do super admin não muda");
    r = await chamar("POST", "/conta/maquinas", { id: M3 }, tc);
    assert.equal(be.verificaLicencaAssinada(r.corpo.licenca, { chaves, maquina: M3 }).payload.licenca.status, "expired", "conta comum: a máquina recebe a licença expirada");

    // A lista do admin: a licença em vigor do super (Pro sem prazo) e, à parte, a gravada, que o editor mostra e muda.
    r = await chamar("GET", "/admin/visao", undefined, ts);
    const [vs, va, vc] = [S, A, C].map((id) => r.corpo.contas.find((c) => c.id === id));
    assert.deepEqual([vs.licenca.plan, vs.licenca.status, vs.licenca.expiresAt, vs.licenca.semPrazo, vs.licenca.deviceLimit], ["pro", "active", null, true, 2]);
    assert.deepEqual([vs.licenca.produtos, vs.licencaGravada.produtos], [[...catalogo, "meu-bot-fit"].sort(), ["meu-bot-fit"]], "em vigor: todos; gravada: só o que o admin gravou");
    assert.deepEqual([vs.licencaGravada.status, vs.licencaGravada.expiresAt, vs.licencaGravada.trialEnd, "semPrazo" in vs.licencaGravada], ["expired", ontem, ontem, false]);
    for (const x of [va, vc]) assert.deepEqual([x.licenca.status, x.licenca.expiresAt, "semPrazo" in x.licenca, "licencaGravada" in x], ["expired", ontem, false, false]);

    // O editor do admin continua mudando o que está gravado, e isso não mexe na licença em vigor do super admin.
    r = await chamar("PATCH", `/admin/contas/${S}/licenca`, { plan: "free", status: "free", expiresAt: null, trialEnd: null }, ts);
    assert.deepEqual([r.status, r.corpo.licenca.plan, "semPrazo" in r.corpo.licenca], [200, "free", false], "o PATCH devolve a gravada");
    r = await chamar("GET", "/conta", undefined, ts);
    assert.deepEqual([r.corpo.licenca.plan, r.corpo.licenca.status, r.corpo.licenca.semPrazo], ["pro", "active", true]);
    await chamar("PATCH", `/admin/contas/${S}/licenca`, { plan: "pro", status: "expired", expiresAt: ontem, trialEnd: ontem }, ts);

    // Nada foi gravado pela regra: deixando de ser super admin, volta a valer o que estava gravado (e a promoção).
    const gravadaDepois = await DB.prepare("SELECT plan, status, trial_end, expires_at, device_limit, produtos FROM licencas WHERE conta_id = ?1").bind(S).first();
    assert.deepEqual(gravadaDepois, { plan: gravadaAntes.plan, status: gravadaAntes.status, trial_end: gravadaAntes.trial_end, expires_at: gravadaAntes.expires_at, device_limit: gravadaAntes.device_limit, produtos: gravadaAntes.produtos });
    await DB.prepare("UPDATE admins SET papel = 'admin' WHERE email = 'super@exemplo.com'").run();
    r = await chamar("GET", "/conta", undefined, ts);
    assert.deepEqual([r.corpo.admin, r.corpo.licenca.status, r.corpo.licenca.expiresAt, "semPrazo" in r.corpo.licenca, r.corpo.licenca.produtos], ["admin", "expired", ontem, false, ["meu-bot-fit"]]);
    assert.equal(r.corpo.promo?.cupom, "PRIMEIROMES1");
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
