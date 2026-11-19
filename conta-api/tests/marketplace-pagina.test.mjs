// As páginas públicas do Marketplace: o gerador (src/marketplace-pagina.ts) e as rotas no Worker, com os assets reais.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { varsDoWrangler } from "../../scripts/release-core.mjs";
import { itensDoMarketplace } from "../dist/marketplace-core.js";
import { LISTA, SITE_CANONICO, caminhoDeContratar, jsonLdDoItem, llmsDoMarketplace, paginaDoMarketplace, reais } from "../dist/marketplace-pagina.js";
import { lerAddons, lerExtras } from "../dist/pagamento-core.js";
import { sitemapXml } from "../dist/novidades-core.js";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const modelo = readFileSync(join(api, "public/site/marketplace.html"), "utf8");
const vars = varsDoWrangler(readFileSync(join(api, "wrangler.toml"), "utf8"));
const itensDe = (v) => itensDoMarketplace({ precoPro: Number(v.ABACATEPAY_PRECO_CENTAVOS), addons: lerAddons(v.ABACATEPAY_ADDONS), extras: lerExtras(v.ABACATEPAY_EXTRAS) });
const PROD = itensDe(vars.producao);
const jsonLd = (html) => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);

test("modelo: traz o título, a descrição e o canônico da lista, e os dois marcadores uma vez", () => {
  assert.ok(PROD.length >= 2, "a produção vende o Pro e mais alguma coisa");
  assert.ok(modelo.includes(`<title>${LISTA.titulo}</title>`));
  assert.ok(modelo.includes(`<meta name="description" content="${LISTA.descricao}">`));
  assert.ok(modelo.includes(`<link rel="canonical" href="${SITE_CANONICO}${LISTA.caminho}">`));
  for (const m of ["<!--JSONLD-->", "<!--CORPO-->"]) assert.equal(modelo.split(m).length, 2, m);
  assert.doesNotMatch(modelo, /<script(?![^>]*\bsrc=)[^>]*>/, "sem script inline (CSP do site)");
});

test("lista: um cartão por item à venda, com o preço do catálogo, e ItemList nos dados estruturados", () => {
  const html = paginaDoMarketplace(modelo, PROD, null);
  assert.ok(!html.includes("<!--"), "nenhum marcador sobra");
  for (const i of PROD) { assert.ok(html.includes(`href="/marketplace/${i.slug}"`), i.slug); assert.ok(html.includes(`<strong>${reais(i.centavos)}</strong> por mês`), `${i.id}: preço`); }
  assert.ok(html.includes("De <s>R$ 997</s> por <strong>R$ 97</strong> por mês"), "o Pro com o preço de tabela");
  const lista = jsonLd(html)["@graph"].find((x) => x["@type"] === "ItemList");
  assert.deepEqual(lista.itemListElement.map((x) => x.url), PROD.map((i) => `${SITE_CANONICO}/marketplace/${i.slug}`));
});

test("item: título, descrição e canônico próprios; Product com Offer em reais; o botão leva ao console", () => {
  const fin = PROD.find((i) => i.id === "meu-bot-finance");
  const html = paginaDoMarketplace(modelo, PROD, fin);
  assert.ok(html.includes("<title>Finanças · Marketplace do meu-bot</title>"));
  assert.ok(html.includes(`<link rel="canonical" href="${SITE_CANONICO}/marketplace/financas">`));
  assert.ok(html.includes(`<meta property="og:url" content="${SITE_CANONICO}/marketplace/financas">`));
  assert.ok(!html.includes(LISTA.titulo) && !html.includes(LISTA.descricao), "nada da lista sobra no cabeçalho");
  assert.ok(html.includes('href="/account/marketplace/financas" data-mk="contratar" data-item="meu-bot-finance" data-nome="Finanças" data-tipo="app" data-valor="997.00"'), "o botão leva à página do item no console e traz os dados do Analytics");
  assert.equal(caminhoDeContratar(fin), "/account/marketplace/financas");
  const produto = jsonLd(html)["@graph"].find((x) => x["@type"] === "Product");
  assert.deepEqual([produto.name, produto.offers.price, produto.offers.priceCurrency, produto.offers.priceSpecification.unitCode], ["Finanças", (fin.centavos / 100).toFixed(2), "BRL", "MON"]);
  assert.equal(caminhoDeContratar(PROD[0]), "/account/plan", "o Pro se assina no Plano");
  // Texto de ficha com caracteres de HTML não quebra a página nem o bloco de dados.
  const mau = { ...fin, nome: 'A <b>"x"</b> & y', resumo: "</script><script>alert(1)</script>" };
  const h2 = paginaDoMarketplace(modelo, [mau], mau);
  assert.ok(!h2.includes("<script>alert(1)") && !h2.includes('<b>"x"'));
  assert.equal(jsonLdDoItem(mau)["@graph"][2].name, mau.nome);
  assert.equal(jsonLd(h2)["@graph"][2].name, mau.nome, "o JSON-LD continua legível");
});

test("sitemap e llms.txt: o Marketplace entra com os itens do ambiente; sem itens, nada muda", () => {
  const base = sitemapXml("https://agentesgrok.com", null);
  const com = sitemapXml("https://agentesgrok.com", null, undefined, { slugs: PROD.map((i) => i.slug), revisao: "2026-11-19" });
  assert.equal((com.match(/<url>/g) || []).length, (base.match(/<url>/g) || []).length + 1 + PROD.length);
  assert.match(com, /<loc>https:\/\/agentesgrok\.com\/marketplace<\/loc>\s*<lastmod>2026-11-19<\/lastmod>/);
  assert.match(com, /<loc>https:\/\/agentesgrok\.com\/marketplace\/financas<\/loc>/);
  assert.equal(sitemapXml("https://agentesgrok.com", null, undefined, { slugs: [], revisao: "2026-11-19" }), base);
  assert.equal(llmsDoMarketplace([]), "");
  const llms = llmsDoMarketplace(PROD);
  assert.match(llms, /^\n## Marketplace\n/);
  assert.ok(llms.includes(`- [Finanças](${SITE_CANONICO}/marketplace/financas): `) && llms.includes("R$ 997 por mês."));
});

test("no Worker: /marketplace e cada item respondem 200; slug fora do catálogo e pagamentos desligados dão a 404 do site; staging é noindex", async () => {
  // O Worker de verdade com os arquivos de public/ no lugar dos static assets (como em site-core.test.mjs).
  const worker = (await import("../dist/index.js")).default;
  const ASSETS = { fetch: async (r) => { try { return new Response(readFileSync(join(api, "public", new URL(r.url).pathname)), { headers: { "content-type": "text/html; charset=utf-8" } }); } catch { return new Response(null, { status: 404 }); } } };
  const CHAVES = { ABACATEPAY_KEY: "abc_dev_x", ABACATEPAY_WEBHOOK_SECRET: "s".repeat(40) };
  const pedir = (canal, caminho, mais = CHAVES) => { const env = { ...vars[canal], ASSETS, ...mais }; return worker.fetch(new Request(env.SITE_ORIGIN + caminho), env, { waitUntil() {} }); };
  const lista = await pedir("producao", "/marketplace");
  assert.equal(lista.status, 200);
  assert.equal(lista.headers.get("x-robots-tag"), null, "produção é indexável");
  assert.match(lista.headers.get("content-security-policy") ?? "", /script-src 'self'/);
  const corpo = await lista.text();
  for (const i of PROD) assert.ok(corpo.includes(`/marketplace/${i.slug}`), i.slug);
  for (const i of PROD) assert.equal((await pedir("producao", `/marketplace/${i.slug}`)).status, 200, i.slug);
  // Ficha que a produção não vende (ou slug inventado): a 404 do site.
  for (const fora of ["modulos-do-diego", "mac-extra", "nao-existe"]) if (!PROD.some((i) => i.slug === fora)) assert.equal((await pedir("producao", `/marketplace/${fora}`)).status, 404, fora);
  assert.equal((await pedir("producao", "/marketplace", {})).status, 404, "pagamentos desligados: sem Marketplace");
  const stg = await pedir("staging", "/marketplace");
  assert.equal(stg.status, 200);
  assert.equal(stg.headers.get("x-robots-tag"), "noindex, nofollow");
  const llms = await (await pedir("producao", "/llms.txt")).text();
  assert.match(llms, /## Marketplace/);
  assert.doesNotMatch(await (await pedir("producao", "/llms.txt", {})).text(), /## Marketplace/);
});
