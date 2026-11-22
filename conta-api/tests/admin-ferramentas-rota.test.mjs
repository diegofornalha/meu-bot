// Preços das ferramentas de ponta a ponta: o handler do Worker chamado direto, contra um D1 local (miniflare) com as
// migrações do repositório e a AbacatePay simulada. O super admin define preço e venda; a ferramenta aparece no
// Marketplace; mudar o preço cria outro produto e guarda o antigo; a falha da AbacatePay não grava nada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);

test("super admin define os preços das ferramentas, e o Marketplace passa a vendê-las", async () => {
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
    const { esquecerOfertasEmMemoria } = await import("../dist/ferramentas-ofertas-db.js");
    const { marketplaceDoEnv } = await import("../dist/rotas/pagamentos.js");
    const HMAC = Buffer.from("k".repeat(32)).toString("base64");
    const env = { ...px.env, DB, CANAL: "staging", SESSAO_HMAC_KEY: HMAC, ADMIN_BOOTSTRAP_EMAIL: "ninguem@exemplo.com", ABACATEPAY_KEY: "abc_dev_x", ABACATEPAY_WEBHOOK_SECRET: "s".repeat(32), ABACATEPAY_PRODUTO: "prod_x" };
    const agora = new Date().toISOString();
    const S = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", A = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22";
    for (const [id, email] of [[S, "super@exemplo.com"], [A, "admin@exemplo.com"]]) await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
    await DB.prepare("INSERT INTO admins (email, papel, criado_em) VALUES ('super@exemplo.com', 'super', ?1), ('admin@exemplo.com', 'admin', ?1)").bind(agora).run();
    const s = Math.floor(Date.now() / 1000);
    const tok = async (sub, adm = null) => assinarJwt({ sub, sid: "s", dev: null, adm, iat: s, exp: s + 3600 }, HMAC);
    const chamar = async (metodo, caminho, corpo, t, e = env) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }) }), e, { waitUntil() {} }); return { status: r.status, corpo: await r.json().catch(() => null) }; };
    const ts = await tok(S, "super"), ta = await tok(A, "admin"), tc = await tok(A, null);
    const ofertas = async () => (await DB.prepare("SELECT slug, produto, centavos, a_venda FROM ferramentas_ofertas ORDER BY slug").all()).results;
    const produtos = async () => (await DB.prepare("SELECT produto, slug, centavos FROM ferramentas_produtos ORDER BY criado_em, produto").all()).results;
    const aVenda = async () => { esquecerOfertasEmMemoria(); return (await marketplaceDoEnv(env)).filter((i) => i.tipo === "ferramenta").map((i) => [i.id, i.centavos]); };
    const auditoria = async () => (await DB.prepare("SELECT quem, acao, detalhe FROM auditoria WHERE acao = 'ferramenta.preco' ORDER BY rowid").all()).results.map((l) => l.detalhe);

    // A AbacatePay simulada: guarda cada produto pedido e responde o que o caso mandar.
    const pedidos = []; let n = 0;
    let resposta = (corpo) => new Response(JSON.stringify({ success: true, error: null, data: { id: `prod_teste${String(++n).padStart(4, "0")}`, price: corpo.price } }), { status: 200 });
    globalThis.fetch = async (url, init) => { if (!String(url).startsWith("https://api.abacatepay.com/")) return fetchReal(url, init); const corpo = JSON.parse(init.body); pedidos.push([String(url).replace("https://api.abacatepay.com/v2/", ""), corpo]); return resposta(corpo); };

    // Só o super admin vê e muda; o admin comum e a conta sem papel recebem 403, e nada é pedido à AbacatePay.
    for (const t of [ta, tc]) {
      assert.equal((await chamar("GET", "/admin/ferramentas", undefined, t)).status, 403);
      assert.equal((await chamar("PUT", "/admin/ferramentas/gmail", { centavos: 4700, aVenda: true }, t)).status, 403);
      assert.equal((await chamar("POST", "/admin/ferramentas/lote", { slugs: ["gmail"], centavos: 4700, aVenda: true }, t)).status, 403);
    }
    assert.deepEqual(pedidos, []);

    // O catálogo inteiro, tudo sem preço e fora de venda.
    const inicio = (await chamar("GET", "/admin/ferramentas", undefined, ts)).corpo;
    assert.equal(inicio.pagamentos, true);
    assert.ok(inicio.ferramentas.length >= 100);
    assert.ok(inicio.ferramentas.every((f) => f.centavos === null && f.aVenda === false));
    assert.deepEqual(Object.keys(inicio.ferramentas[0]).sort(), ["aVenda", "atualizadoEm", "atualizadoPor", "categoria", "centavos", "grupo", "nome", "resumo", "slug"]);
    assert.deepEqual(await aVenda(), []);

    // Pedidos fora da forma não chegam à AbacatePay nem ao banco.
    assert.equal((await chamar("PUT", "/admin/ferramentas/nao_existe", { centavos: 4700, aVenda: true }, ts)).status, 404);
    for (const corpo of [{ centavos: 47.9, aVenda: true }, { centavos: 50, aVenda: true }, { centavos: 4700 }, { aVenda: true }, {}, { centavos: "4700", aVenda: true }]) assert.equal((await chamar("PUT", "/admin/ferramentas/gmail", corpo, ts)).status, 400, JSON.stringify(corpo));
    assert.deepEqual(pedidos, []); assert.deepEqual(await ofertas(), []);

    // Define o preço do Gmail: cria o produto mensal certo, grava a oferta e o histórico, e ele aparece no Marketplace.
    const r1 = await chamar("PUT", "/admin/ferramentas/gmail", { centavos: 4700, aVenda: true }, ts);
    assert.deepEqual([r1.status, r1.corpo], [200, { slug: "gmail", centavos: 4700, aVenda: true, mudou: true }]);
    assert.equal(pedidos.length, 1);
    assert.equal(pedidos[0][0], "products/create");
    assert.deepEqual({ ...pedidos[0][1], description: "x" }, { externalId: "mbs-ferramenta-gmail-4700", name: "meu-bot · Gmail", description: "x", price: 4700, currency: "BRL", cycle: "MONTHLY" });
    assert.deepEqual(await ofertas(), [{ slug: "gmail", produto: "prod_teste0001", centavos: 4700, a_venda: 1 }]);
    assert.deepEqual(await produtos(), [{ produto: "prod_teste0001", slug: "gmail", centavos: 4700 }]);
    assert.deepEqual(await aVenda(), [["ferramenta-gmail", 4700]]);
    const visto = (await chamar("GET", "/admin/ferramentas", undefined, ts)).corpo.ferramentas.find((f) => f.slug === "gmail");
    assert.deepEqual([visto.centavos, visto.aVenda, visto.atualizadoPor], [4700, true, "super@exemplo.com"]);

    // O mesmo pedido de novo não muda nada nem chama a AbacatePay.
    assert.deepEqual((await chamar("PUT", "/admin/ferramentas/gmail", { centavos: 4700, aVenda: true }, ts)).corpo.mudou, false);
    assert.equal(pedidos.length, 1);

    // Tirar de venda: some do Marketplace, sem tocar na AbacatePay; o preço fica guardado.
    assert.equal((await chamar("PUT", "/admin/ferramentas/gmail", { centavos: 4700, aVenda: false }, ts)).corpo.mudou, true);
    assert.equal(pedidos.length, 1);
    assert.deepEqual(await aVenda(), []);
    assert.deepEqual((await ofertas())[0], { slug: "gmail", produto: "prod_teste0001", centavos: 4700, a_venda: 0 });

    // Mudar o preço: produto novo; o antigo fica no histórico, para quem já assina.
    await chamar("PUT", "/admin/ferramentas/gmail", { centavos: 5900, aVenda: true }, ts);
    assert.equal(pedidos.length, 2); assert.equal(pedidos[1][1].externalId, "mbs-ferramenta-gmail-5900");
    assert.deepEqual((await ofertas())[0], { slug: "gmail", produto: "prod_teste0002", centavos: 5900, a_venda: 1 });
    assert.deepEqual((await produtos()).map((p) => [p.produto, p.centavos]), [["prod_teste0001", 4700], ["prod_teste0002", 5900]]);
    assert.deepEqual(await aVenda(), [["ferramenta-gmail", 5900]]);
    // Voltar ao preço antigo reaproveita o produto dele: nada é criado.
    await chamar("PUT", "/admin/ferramentas/gmail", { centavos: 4700, aVenda: true }, ts);
    assert.equal(pedidos.length, 2);
    assert.deepEqual((await ofertas())[0], { slug: "gmail", produto: "prod_teste0001", centavos: 4700, a_venda: 1 });

    // A AbacatePay fora, recusando ou respondendo sem produto: nada é gravado, e a frase diz o motivo.
    for (const [r, parte] of [[() => { throw new Error("rede"); }, /não respondeu/], [() => new Response(JSON.stringify({ success: false, error: "Product with externalId already exists." }), { status: 400 }), /already exists/], [() => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }), /não criou o produto de Notion/]]) {
      const antes = resposta; resposta = r;
      const f = await chamar("PUT", "/admin/ferramentas/notion", { centavos: 3900, aVenda: true }, ts);
      resposta = antes;
      assert.equal(f.status, 502); assert.match(f.corpo.erro, parte); assert.match(f.corpo.erro, /nada foi alterado/);
    }
    assert.deepEqual((await ofertas()).map((o) => o.slug), ["gmail"]);
    assert.deepEqual((await produtos()).length, 2);

    // Em lote: uma por vez; a que falha não desfaz as outras, e a resposta separa acertos de falhas.
    const antesDoLote = pedidos.length;
    const base = resposta; resposta = (corpo) => (corpo.externalId.includes("-notion-") ? new Response(JSON.stringify({ success: false, error: "boom" }), { status: 500 }) : base(corpo));
    const lote = await chamar("POST", "/admin/ferramentas/lote", { slugs: ["googlesheets", "notion", "googlecalendar", "nao_existe", "googlesheets", "gmail"], centavos: 4700, aVenda: true }, ts);
    resposta = base;
    assert.equal(lote.status, 200);
    assert.deepEqual(lote.corpo.feitas, [{ slug: "googlesheets", mudou: true }, { slug: "googlecalendar", mudou: true }, { slug: "gmail", mudou: false }], "repetida conta uma vez; a que já estava assim não muda");
    assert.deepEqual(lote.corpo.falhas.map((f) => f.slug), ["notion", "nao_existe"]);
    assert.equal(pedidos.length - antesDoLote, 3, "sheets, notion (falhou) e calendar; o gmail já tinha esse preço");
    assert.deepEqual((await aVenda()).map((x) => x[0]).sort(), ["ferramenta-gmail", "ferramenta-googlecalendar", "ferramenta-googlesheets"]);
    // Lote fora da forma, ou grande demais.
    for (const corpo of [{ slugs: [], centavos: 4700, aVenda: true }, { slugs: "gmail", centavos: 4700, aVenda: true }, { slugs: ["gmail"], centavos: 10, aVenda: true }, { slugs: [1], centavos: 4700, aVenda: true }]) assert.equal((await chamar("POST", "/admin/ferramentas/lote", corpo, ts)).status, 400, JSON.stringify(corpo));
    const grande = await chamar("POST", "/admin/ferramentas/lote", { slugs: Array.from({ length: 21 }, (_, i) => `x${i}`), centavos: 4700, aVenda: true }, ts);
    assert.equal(grande.status, 400); assert.match(grande.corpo.erro, /no máximo 20/);

    // Toda mudança que valeu está na auditoria, com quem fez; o que não mudou e o que falhou, não.
    assert.deepEqual(await auditoria(), [
      "gmail: sem preço → R$ 47, à venda",
      "gmail: R$ 47, à venda → R$ 47, fora de venda",
      "gmail: R$ 47, fora de venda → R$ 59, à venda",
      "gmail: R$ 59, à venda → R$ 47, à venda",
      "googlesheets: sem preço → R$ 47, à venda",
      "googlecalendar: sem preço → R$ 47, à venda",
    ]);

    // O banco falha na gravação depois de a AbacatePay criar o produto: a pessoa recebe a frase (não um 500), e a nova
    // tentativa não cria outro produto se o histórico ficou gravado.
    const comFalha = (falhaEm) => ({ ...env, DB: { prepare: (sql) => { if (falhaEm.test(sql)) return { bind: () => ({ run: async () => { throw new Error("D1_ERROR"); }, first: async () => { throw new Error("D1_ERROR"); }, all: async () => { throw new Error("D1_ERROR"); } }), all: async () => { throw new Error("D1_ERROR"); } }; return DB.prepare(sql); } } });
    const antesDaFalha = pedidos.length;
    const semGravar = await chamar("PUT", "/admin/ferramentas/canva", { centavos: 4700, aVenda: true }, ts, comFalha(/INSERT INTO ferramentas_ofertas/));
    assert.equal(semGravar.status, 502); assert.match(semGravar.corpo.erro, /foi criado na AbacatePay \(prod_teste\d+\), mas não consegui gravar o preço/);
    assert.equal(pedidos.length, antesDaFalha + 1);
    assert.equal((await chamar("PUT", "/admin/ferramentas/canva", { centavos: 4700, aVenda: true }, ts)).status, 200);
    assert.equal(pedidos.length, antesDaFalha + 1, "a segunda tentativa reaproveitou o produto do histórico");
    // Não dá para ler o banco: frase, nada pedido à AbacatePay; e a lista responde 503 com o motivo.
    const semLer = await chamar("PUT", "/admin/ferramentas/figma", { centavos: 4700, aVenda: true }, ts, comFalha(/SELECT produto, centavos, a_venda/));
    assert.equal(semLer.status, 502); assert.match(semLer.corpo.erro, /não consegui ler o preço de Figma/);
    assert.equal(pedidos.length, antesDaFalha + 1);
    const semLista = await chamar("GET", "/admin/ferramentas", undefined, ts, comFalha(/FROM ferramentas_ofertas$/));
    assert.equal(semLista.status, 503); assert.match(semLista.corpo.erro, /não consegui ler os preços/);
    // No lote, a ferramenta que falha no banco entra em "falhas" e as outras seguem.
    const loteFalho = await chamar("POST", "/admin/ferramentas/lote", { slugs: ["trello", "asana"], centavos: 3900, aVenda: true }, ts, comFalha(/INSERT INTO ferramentas_ofertas/));
    assert.equal(loteFalho.status, 200); assert.deepEqual(loteFalho.corpo.feitas, []); assert.deepEqual(loteFalho.corpo.falhas.map((f) => f.slug), ["trello", "asana"]);

    // Pagamentos desligados no ambiente: a tela diz isso, nada muda, e o Marketplace não vende nada.
    const semKey = { ...env, ABACATEPAY_KEY: "" };
    assert.equal((await chamar("GET", "/admin/ferramentas", undefined, ts, semKey)).corpo.pagamentos, false);
    const desl = await chamar("PUT", "/admin/ferramentas/canva", { centavos: 4700, aVenda: true }, ts, semKey);
    assert.equal(desl.status, 503); assert.match(desl.corpo.erro, /pagamentos estão desligados/);
    esquecerOfertasEmMemoria();
    assert.deepEqual(await marketplaceDoEnv(semKey), []);
  } finally { globalThis.fetch = fetchReal; await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});

test("ofertas na memória: um minuto, por banco, e a mudança de preço a esquece", async () => {
  const { ofertasAVendaNoBanco, esquecerOfertasEmMemoria, MEMORIA_DAS_OFERTAS_MS } = await import("../dist/ferramentas-ofertas-db.js");
  let consultas = 0; let linhas = [{ slug: "gmail", produto: "prod_abc123XYZ", centavos: 4700 }];
  const banco = () => ({ prepare: () => ({ all: async () => { consultas++; return { results: linhas }; } }) });
  const db = banco();
  esquecerOfertasEmMemoria();
  assert.deepEqual((await ofertasAVendaNoBanco(db, 1000)).map((o) => [o.ferramenta.slug, o.centavos]), [["gmail", 4700]]);
  linhas = [{ slug: "gmail", produto: "prod_abc123XYZ", centavos: 5900 }];
  assert.equal((await ofertasAVendaNoBanco(db, 1000 + MEMORIA_DAS_OFERTAS_MS - 1))[0].centavos, 4700, "dentro de um minuto, a resposta guardada");
  assert.equal(consultas, 1);
  assert.equal((await ofertasAVendaNoBanco(db, 1000 + MEMORIA_DAS_OFERTAS_MS))[0].centavos, 5900, "passou um minuto: lê de novo");
  linhas = [{ slug: "gmail", produto: "prod_abc123XYZ", centavos: 6900 }];
  esquecerOfertasEmMemoria();
  assert.equal((await ofertasAVendaNoBanco(db, 2000 + MEMORIA_DAS_OFERTAS_MS))[0].centavos, 6900, "a mudança de preço esquece a memória na hora");
  assert.equal((await ofertasAVendaNoBanco(banco(), 2000 + MEMORIA_DAS_OFERTAS_MS)).length, 1, "outro banco não aproveita a memória do primeiro");
  // Banco fora do ar: vale a última resposta boa, mesmo vencida, e nada novo é guardado (a consulta seguinte tenta de novo).
  esquecerOfertasEmMemoria();
  let cai = false; let vezes = 0;
  const instavel = { prepare: () => ({ all: async () => { vezes++; if (cai) throw new Error("D1_ERROR: network connection lost"); return { results: [{ slug: "gmail", produto: "prod_abc123XYZ", centavos: 4700 }] }; } }) };
  const calado = console.error; console.error = () => {};
  try {
    assert.equal((await ofertasAVendaNoBanco(instavel, 1)).length, 1);
    cai = true;
    assert.equal((await ofertasAVendaNoBanco(instavel, 1 + MEMORIA_DAS_OFERTAS_MS)).length, 1, "o Marketplace não esvazia numa falha passageira");
    assert.equal((await ofertasAVendaNoBanco(instavel, 2 + MEMORIA_DAS_OFERTAS_MS)).length, 1);
    assert.equal(vezes, 3, "a falha não fica na memória: cada consulta tenta de novo");
    esquecerOfertasEmMemoria();
    assert.deepEqual(await ofertasAVendaNoBanco(instavel, 9), [], "sem resposta boa guardada, nada à venda");
  } finally { console.error = calado; }
  // Tabela ausente (migração ainda não aplicada) e linha fora do catálogo ou da forma: nada à venda, sem erro.
  esquecerOfertasEmMemoria();
  assert.deepEqual(await ofertasAVendaNoBanco({ prepare: () => ({ all: async () => { throw new Error("no such table: ferramentas_ofertas"); } }) }, 1), []);
  esquecerOfertasEmMemoria();
  linhas = [{ slug: "nao_existe", produto: "prod_abc123XYZ", centavos: 4700 }, { slug: "notion", produto: "ruim", centavos: 4700 }];
  assert.deepEqual(await ofertasAVendaNoBanco(banco(), 1), []);
  esquecerOfertasEmMemoria();
});
