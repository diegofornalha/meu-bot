// Código por visita: a parte pura (lead-core) e as rotas no handler do Worker, contra um D1 local (miniflare) com as
// migrações do repositório. O GA4 não é chamado: GA_ID vazio (o caminho "desligado") e lead sem visita.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import vm from "node:vm";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALFABETO_LEAD, codigoLead, origemLead, qualificaGa4, segredoConfere, utmValido } from "../dist/lead-core.js";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);

test("lead-core: o código, a origem, o segredo e o evento do GA4", () => {
  assert.equal(codigoLead(" abc234 "), "ABC234");
  for (const x of ["ABC23", "ABC2345", "ABCI23", "ABCO23", "ABC023", "ABC123", "ABC-23", 123456, null, undefined]) assert.equal(codigoLead(x), null, String(x));
  // O site gera o código com o mesmo alfabeto: tudo o que ele gera o servidor aceita.
  const window = {};
  vm.runInNewContext(readFileSync(new URL("../public/site/celular.js", import.meta.url), "utf8"), { window, URL, URLSearchParams });
  assert.equal(ALFABETO_LEAD.length, 32);
  for (let b = 0; b < 256; b++) assert.equal(codigoLead(window.MEU_BOT_CELULAR.codigoVisita(new Uint8Array(6).fill(b))), ALFABETO_LEAD[b & 31].repeat(6));
  assert.equal(origemLead("flutuante"), "flutuante");
  assert.equal(origemLead("<script>"), "site");
  assert.equal(utmValido("grok-mac-teste"), "grok-mac-teste");
  assert.equal(utmValido("a b"), null);
  const T = "t".repeat(40);
  assert.equal(segredoConfere(T, T), true);
  assert.equal(segredoConfere("t".repeat(39) + "x", T), false);
  assert.equal(segredoConfere("", undefined), false);
  assert.equal(segredoConfere("curto", "curto"), false, "segredo nosso com menos de 32 caracteres não vale");
  assert.deepEqual(qualificaGa4({ clientId: "1.1700000000", sessionId: "1700000001", codigo: "ABC234", ambiente: "staging" }), { client_id: "1.1700000000", events: [{ name: "qualify_lead", params: { lead_ref: "ABC234", ambiente: "staging", engagement_time_msec: 1, session_id: "1700000001", debug_mode: true } }] });
  assert.deepEqual(qualificaGa4({ clientId: "1.1700000000", sessionId: null, codigo: "ABC234", ambiente: "producao" }).events[0].params, { lead_ref: "ABC234", ambiente: "producao", engagement_time_msec: 1 });
});

test("leads: o site grava o código no clique, quem atende lê a campanha e qualifica uma vez só", async () => {
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
    const TOKEN = "L".repeat(40);
    const env = { ...px.env, DB, GA_ID: "", SESSAO_HMAC_KEY: Buffer.from("k".repeat(32)).toString("base64"), LEADS_TOKEN: TOKEN };
    const ctx = { waitUntil() {}, passThroughOnException() {} };
    const SITE = env.SITE_ORIGIN, API = env.API_ORIGIN;
    const site = (corpo, metodo = "POST") => worker.fetch(new Request(`${SITE}/lead-ref`, { method: metodo, ...(metodo === "POST" ? { body: JSON.stringify(corpo), headers: { "content-type": "application/json" } } : {}) }), env, ctx);
    const leads = (metodo, caminho, token = TOKEN, e = env) => worker.fetch(new Request(`${API}${caminho}`, { method: metodo, headers: token === null ? {} : { authorization: `Bearer ${token}` } }), e, ctx);

    assert.equal((await site({}, "GET")).status, 405);
    assert.equal((await site({ codigo: "curto" })).status, 400);
    // Sem visita do Analytics (bloqueador): o código vale mesmo assim, com a campanha.
    assert.equal((await site({ codigo: "ABC234", origem: "celular", gaClientId: null, gclid: "AbCdEf1234567890", utmSource: "google", utmMedium: "cpc", utmCampaign: "grok-mac-teste", utmContent: "empresario" })).status, 200);
    // O mesmo código de novo responde ok e não troca o que já estava gravado.
    assert.equal((await site({ codigo: "ABC234", origem: "final", utmCampaign: "outra" })).status, 200);
    // Valor fora da forma é descartado, não gravado.
    assert.equal((await site({ codigo: "XYZ789", origem: "<b>", gaClientId: "lixo", gaSessionId: "1700000001", utmSource: "a b" })).status, 200);
    const x = await DB.prepare("SELECT * FROM lead_ref WHERE codigo = 'XYZ789'").first();
    assert.deepEqual([x.origem, x.ga_client_id, x.ga_session_id, x.utm_source], ["site", null, null, null], "sessão sem client_id não entra");

    assert.equal((await leads("GET", "/leads/ABC234", null)).status, 401);
    assert.equal((await leads("GET", "/leads/ABC234", "x".repeat(40))).status, 401);
    assert.equal((await leads("GET", "/leads/ABC234", TOKEN, { ...env, LEADS_TOKEN: undefined })).status, 503, "sem o secret, a rota fica desligada");
    assert.equal((await leads("GET", "/leads/QQQ222")).status, 404);
    assert.equal((await leads("POST", "/leads/ABC234")).status, 404, "POST só em /qualificar");
    assert.equal((await leads("GET", "/leads/ABC234/qualificar")).status, 404);
    const lido = await (await leads("GET", "/leads/abc234")).json();
    assert.deepEqual({ ...lido, criadoEm: null }, { codigo: "ABC234", origem: "celular", criadoEm: null, qualificadoEm: null, campanha: { fonte: "google", meio: "cpc", campanha: "grok-mac-teste", conteudo: "empresario" }, veioDeAnuncio: true, temVisita: false });

    const q1 = await (await leads("POST", "/leads/ABC234/qualificar")).json();
    assert.equal(q1.repetido, false); assert.equal(q1.analytics, "sem-visita"); assert.ok(q1.qualificadoEm);
    const q2 = await (await leads("POST", "/leads/ABC234/qualificar")).json();
    assert.equal(q2.repetido, true); assert.equal(q2.qualificadoEm, q1.qualificadoEm, "a segunda chamada não troca a data");
    // Com visita mas sem Analytics configurado: marca e diz que não contou.
    await site({ codigo: "DEF567", gaClientId: "123.1700000000", gaSessionId: "1700000001" });
    const q3 = await (await leads("POST", "/leads/DEF567/qualificar")).json();
    assert.equal(q3.analytics, "desligado"); assert.equal(q3.temVisita, true);
    // GA4 recusa (500) e depois aceita: a segunda chamada reenvia, a terceira não conta de novo.
    const real = globalThis.fetch; const idas = []; let status = 500;
    globalThis.fetch = async (u, o) => { idas.push([String(u), JSON.parse(o.body)]); return new Response(null, { status }); };
    try {
      const ga = { ...env, GA_ID: "G-TESTE12345", GA_MP_SECRET: "segredo-mp" };
      await site({ codigo: "GHJ234", gaClientId: "123.1700000000", gaSessionId: "1700000001" });
      const r1 = await (await leads("POST", "/leads/GHJ234/qualificar", TOKEN, ga)).json();
      assert.deepEqual([r1.repetido, r1.analytics], [false, "recusado"]);
      status = 204;
      const r2 = await (await leads("POST", "/leads/GHJ234/qualificar", TOKEN, ga)).json();
      assert.deepEqual([r2.repetido, r2.analytics, r2.qualificadoEm], [true, "enviado", r1.qualificadoEm]);
      const r3 = await (await leads("POST", "/leads/GHJ234/qualificar", TOKEN, ga)).json();
      assert.equal(r3.analytics, "enviado");
      assert.equal(idas.length, 2, "uma recusada e uma aceita; a terceira chamada não envia");
      assert.match(idas[1][0], /measurement_id=G-TESTE12345&api_secret=segredo-mp$/);
      assert.equal(idas[1][1].events[0].name, "qualify_lead"); assert.equal(idas[1][1].client_id, "123.1700000000");
    } finally { globalThis.fetch = real; }
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
