// Cortesias do admin: o núcleo puro (cortesia-core) e as rotas de ponta a ponta contra um D1 local (miniflare) com as
// migrações do repositório: dar, ver no GET /conta (de onde vem o Pro, as vagas), renovar, encerrar com motivo, e o
// usuário de cortesia de uma organização.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addonsDeCortesia, fimDoProDeCortesia, origemDoPro, unidadesDeCortesia, validaCortesia, validaEncerramento, validaFimCortesia } from "../dist/cortesia-core.js";
import { limiteComExtras } from "../dist/licenca-core.js";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);
const DIA = 86400000;
const agoraMs = Date.parse("2026-11-20T12:00:00.000Z");
const em = (dias) => new Date(agoraMs + dias * DIA).toISOString();

test("validaCortesia: prazo obrigatório até 365 dias, motivo, add-on do catálogo, quantidade e organização", () => {
  const ok = validaCortesia({ tipo: "maquina", quantidade: 2, fim: em(30), motivo: "parceiro de lançamento" }, agoraMs, []);
  assert.deepEqual(ok, { tipo: "maquina", produto: null, org: null, quantidade: 2, fim: em(30), motivo: "parceiro de lançamento" });
  assert.match(validaCortesia({ tipo: "pro", motivo: "teste" }, agoraMs, []).erro, /^fim/, "sem prazo é recusado");
  assert.match(validaCortesia({ tipo: "pro", fim: em(366), motivo: "teste" }, agoraMs, []).erro, /^fim/, "mais de 365 dias é recusado");
  assert.match(validaCortesia({ tipo: "pro", fim: em(-1), motivo: "teste" }, agoraMs, []).erro, /^fim/, "prazo no passado é recusado");
  assert.match(validaCortesia({ tipo: "pro", fim: em(30) }, agoraMs, []).erro, /^motivo/, "sem motivo é recusado");
  assert.match(validaCortesia({ tipo: "addon", produto: "meu-bot-x", fim: em(30), motivo: "teste" }, agoraMs, ["meu-bot-finance"]).erro, /^produto/);
  assert.equal(validaCortesia({ tipo: "addon", produto: "meu-bot-finance", fim: em(30), motivo: "teste" }, agoraMs, ["meu-bot-finance"]).produto, "meu-bot-finance");
  assert.match(validaCortesia({ tipo: "device", quantidade: 51, fim: em(30), motivo: "teste" }, agoraMs, []).erro, /^quantidade/);
  assert.match(validaCortesia({ tipo: "assento", fim: em(30), motivo: "teste" }, agoraMs, []).erro, /^org/);
  assert.equal(validaCortesia({ tipo: "pro", quantidade: 9, fim: em(30), motivo: "teste" }, agoraMs, []).quantidade, 1, "Pro é sempre uma unidade");
  assert.match(validaCortesia({ tipo: "ouro", fim: em(30), motivo: "teste" }, agoraMs, []).erro, /^tipo/);
  assert.equal(validaFimCortesia("2026-12-01", agoraMs), "2026-12-01T00:00:00.000Z");
});

test("cortesias viram vagas, add-ons e prazo do Pro; encerradas e vencidas não contam", () => {
  const c = (x) => ({ id: "c", produto: null, orgId: null, quantidade: 1, inicio: em(-1), motivo: "m", por: "a@x", encerradaEm: null, ...x });
  const cs = [c({ tipo: "maquina", quantidade: 2, fim: em(10) }), c({ tipo: "maquina", fim: em(-1) }), c({ tipo: "maquina", fim: em(10), encerradaEm: em(-1) }), c({ tipo: "addon", produto: "meu-bot-finance", fim: em(5) }), c({ tipo: "pro", fim: em(5) }), c({ tipo: "pro", fim: em(20) }), c({ tipo: "pro", fim: em(40), encerradaEm: em(-1) }), c({ tipo: "assento", orgId: "o1", fim: em(5) })];
  assert.equal(unidadesDeCortesia(cs, "maquina").length, 3, "a encerrada não entra; a vencida entra e o prazo a descarta");
  assert.deepEqual(limiteComExtras(1, [{ expiresAt: em(3) }], agoraMs, 50, unidadesDeCortesia(cs, "maquina")), { limite: 4, extras: 1, cortesias: 2 });
  assert.deepEqual(limiteComExtras(1, [{ expiresAt: em(3) }], agoraMs, 2, unidadesDeCortesia(cs, "maquina")), { limite: 2, extras: 1, cortesias: 0 }, "no teto, a paga conta primeiro");
  assert.deepEqual(addonsDeCortesia(cs), [{ produto: "meu-bot-finance", expiresAt: em(5) }]);
  assert.equal(fimDoProDeCortesia(cs, agoraMs), em(20), "o prazo mais longo entre as válidas");
  assert.equal(unidadesDeCortesia(cs, "assento", "o1").length, 1);
  assert.equal(unidadesDeCortesia(cs, "assento", "o2").length, 0);
});

test("origemDoPro e validaEncerramento", () => {
  const pro = { plan: "pro", status: "active", expiresAt: em(5) };
  const base = { papel: null, licenca: pro, pelaOrg: false, porCortesia: false, pagou: false, agoraMs };
  assert.equal(origemDoPro({ ...base, papel: "super" }), "super");
  assert.equal(origemDoPro({ ...base, licenca: { ...pro, status: "trialing" } }), "teste");
  assert.equal(origemDoPro({ ...base, pelaOrg: true, porCortesia: true }), "organizacao");
  assert.equal(origemDoPro({ ...base, porCortesia: true, pagou: true }), "cortesia");
  assert.equal(origemDoPro({ ...base, pagou: true }), "pago");
  assert.equal(origemDoPro(base), "admin");
  assert.equal(origemDoPro({ ...base, licenca: { ...pro, expiresAt: em(-1) } }), null);
  assert.equal(origemDoPro({ ...base, licenca: { plan: "free", status: "free", expiresAt: null } }), null);
  assert.deepEqual(validaEncerramento({ motivo: "reembolso" }), { motivo: "reembolso", detalhe: null });
  assert.deepEqual(validaEncerramento({ motivo: "reembolso", detalhe: " pediu por e-mail " }), { motivo: "reembolso", detalhe: "pediu por e-mail" });
  assert.match(validaEncerramento({ motivo: "outro" }).erro, /^detalhe/);
  assert.match(validaEncerramento({ motivo: "porque sim" }).erro, /^motivo/);
});

test("rotas: o admin dá, renova e encerra cortesias; a pessoa vê de onde vem cada coisa", async () => {
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
    const env = { ...px.env, DB, GA_ID: "", SESSAO_HMAC_KEY: HMAC, LICENCA_PRIVATE_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), ABACATEPAY_ADDONS: '{"meu-bot-finance":{"produto":"prod_financas1","centavos":99700,"rotulo":"Finanças"}}' };
    const agora = new Date().toISOString();
    const ADM = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a", B = "1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b", D = "2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2d2d";
    for (const [id, email] of [[ADM, "adm@exemplo.com"], [B, "bia@exemplo.com"], [D, "dona@exemplo.com"]]) await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
    await DB.prepare("INSERT INTO admins (email, papel, criado_em) VALUES ('adm@exemplo.com', 'admin', ?1)").bind(agora).run();
    await DB.prepare("INSERT INTO organizacoes (id, slug, nome, dona_conta_id, assentos, criada_em, atualizada_em) VALUES ('o1', 'acme', 'Acme', ?1, 1, ?2, ?2)").bind(D, agora).run();
    await DB.prepare("INSERT INTO membros (org_id, email, conta_id, papel, status, convidado_em, entrou_em) VALUES ('o1', 'dona@exemplo.com', ?1, 'dona', 'ativo', ?2, ?2)").bind(D, agora).run();
    const s = Math.floor(Date.now() / 1000);
    const tok = (sub, adm = null) => assinarJwt({ sub, sid: "s", dev: null, adm, iat: s, exp: s + 3600 }, HMAC);
    const [ta, tb, td] = await Promise.all([tok(ADM, "admin"), tok(B), tok(D)]);
    const chamar = async (metodo, caminho, corpo, t) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env, { waitUntil() {} }); return { status: r.status, corpo: await r.json() }; };
    const fim = (dias) => new Date(Date.now() + dias * DIA).toISOString();
    const dar = (conta, corpo, t = ta) => chamar("POST", `/admin/contas/${conta}/cortesias`, corpo, t);
    const contaB = async () => (await chamar("GET", "/conta", undefined, tb)).corpo;

    // Antes: B não tem Pro nem cortesia.
    let c = await contaB();
    assert.equal(c.licenca.plan, "free"); assert.equal(c.origemDoPro, null); assert.deepEqual(c.cortesias, []);

    // Só admin dá cortesia; prazo e motivo são obrigatórios.
    assert.equal((await dar(B, { tipo: "pro", fim: fim(30), motivo: "parceiro" }, tb)).status, 403);
    assert.equal((await dar(B, { tipo: "pro", motivo: "parceiro" })).status, 400);
    assert.equal((await dar(B, { tipo: "pro", fim: fim(30) })).status, 400);

    // Pro de cortesia: a pessoa vê o Pro até o prazo, de onde vem, e a cortesia sem quem liberou nem o motivo.
    let r = await dar(B, { tipo: "pro", fim: fim(30), motivo: "parceiro de lançamento" });
    assert.equal(r.status, 200, r.corpo.erro);
    const pro = r.corpo.cortesia;
    c = await contaB();
    assert.equal(c.licenca.plan, "pro"); assert.equal(c.licenca.status, "active"); assert.equal(c.licenca.expiresAt, pro.fim);
    assert.equal(c.origemDoPro, "cortesia");
    assert.equal(c.cortesias.length, 1); assert.equal(c.cortesias[0].tipo, "pro"); assert.equal(c.cortesias[0].motivo, undefined); assert.equal(c.cortesias[0].por, undefined);
    assert.equal(c.orgCriar.motivo, null, "Pro de cortesia cria organização, como o pago");

    // Máquinas, devices e add-on de cortesia entram nas vagas e na licença.
    assert.equal((await dar(B, { tipo: "maquina", quantidade: 2, fim: fim(10), motivo: "teste de agência" })).status, 200);
    assert.equal((await dar(B, { tipo: "device", fim: fim(10), motivo: "teste de agência" })).status, 200);
    assert.equal((await dar(B, { tipo: "addon", produto: "meu-bot-finance", fim: fim(10), motivo: "demonstração" })).status, 200);
    assert.equal((await dar(B, { tipo: "addon", produto: "meu-bot-nada", fim: fim(10), motivo: "demonstração" })).status, 400);
    c = await contaB();
    assert.equal(c.maquinaLimite, 3); assert.equal(c.maquinaCortesias, 2); assert.equal(c.maquinaExtras, 0);
    assert.equal(c.licenca.deviceLimit, 3); assert.equal(c.deviceCortesias, 1); assert.equal(c.deviceExtras, 0);
    assert.ok(c.licenca.produtos.includes("meu-bot-finance"));

    // A visão do admin mostra a licença com a cortesia e as cortesias com quem e por quê.
    const visao = (await chamar("GET", "/admin/visao?busca=bia", undefined, ta)).corpo;
    const vb = visao.contas.find((x) => x.id === B);
    assert.equal(vb.licenca.plan, "pro"); assert.equal(vb.cortesias.length, 4); assert.equal(vb.cortesias.find((x) => x.tipo === "pro").motivo, "parceiro de lançamento"); assert.equal(vb.cortesias[0].por, "adm@exemplo.com");

    // Renovar estende o prazo; encerrar pede motivo e tira na hora.
    r = await chamar("POST", `/admin/contas/${B}/cortesias/${pro.id}/renovar`, { fim: fim(60) }, ta);
    assert.equal(r.status, 200, r.corpo.erro);
    assert.equal((await contaB()).licenca.expiresAt, r.corpo.cortesia.fim);
    assert.equal((await chamar("POST", `/admin/contas/${B}/cortesias/${pro.id}/encerrar`, {}, ta)).status, 400);
    r = await chamar("POST", `/admin/contas/${B}/cortesias/${pro.id}/encerrar`, { motivo: "pedido-da-pessoa", detalhe: "não vai usar" }, ta);
    assert.equal(r.status, 200, r.corpo.erro);
    c = await contaB();
    assert.equal(c.licenca.plan, "free"); assert.equal(c.origemDoPro, null);
    assert.ok(c.cortesias.find((x) => x.id === pro.id).encerradaEm, "a encerrada continua na lista da pessoa, com a data");
    assert.equal((await chamar("POST", `/admin/contas/${B}/cortesias/${pro.id}/encerrar`, { motivo: "reembolso" }, ta)).status, 404, "já encerrada");
    assert.equal((await chamar("POST", `/admin/contas/${B}/cortesias/${pro.id}/renovar`, { fim: fim(5) }, ta)).status, 404, "encerrada não renova");
    const hist = await DB.prepare("SELECT alvo, motivo, detalhe, por FROM encerramentos WHERE conta_id = ?1").bind(B).all();
    assert.deepEqual(hist.results, [{ alvo: "cortesia", motivo: "pedido-da-pessoa", detalhe: "não vai usar", por: "adm@exemplo.com" }]);

    // Vencida não conta: as máquinas de cortesia saem quando o prazo passa.
    await DB.prepare("UPDATE cortesias SET fim = ?2 WHERE conta_id = ?1 AND tipo = 'maquina'").bind(B, fim(-1)).run();
    assert.equal((await contaB()).maquinaLimite, 1);

    // Usuário de cortesia: só numa organização de que a conta é dona; soma às vagas da organização.
    assert.equal((await dar(B, { tipo: "assento", org: "acme", fim: fim(30), motivo: "equipe piloto" })).status, 404, "B não é dona da acme");
    assert.equal((await dar(D, { tipo: "assento", org: "acme", quantidade: 2, fim: fim(30), motivo: "equipe piloto" })).status, 200);
    const org = (await chamar("GET", "/orgs/acme", undefined, td)).corpo;
    assert.equal(org.assentos, 3); assert.equal(org.assentosCortesia, 2); assert.equal(org.assentosInclusos, 1); assert.equal(org.assentosPagos, 0);
  } finally {
    await px.dispose();
    rmSync(persist, { recursive: true, force: true });
  }
});
