// Marketplace: as fichas dos itens e a lista do que está à venda em cada ambiente (src/marketplace-core.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { varsDoWrangler } from "../../scripts/release-core.mjs";
import { FICHAS, ITEM_PRO, PRO_DE_CENTAVOS, itemPorSlug, itensDoMarketplace } from "../dist/marketplace-core.js";
import { lerAddons, lerExtras, TIPOS_EXTRA, nomeDoExtra } from "../dist/pagamento-core.js";

const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const AMBIENTES = { producao: varsDoWrangler(toml, "producao"), staging: varsDoWrangler(toml, "staging") };

test("fichas: slug único e na forma de caminho, textos preenchidos", () => {
  const slugs = Object.values(FICHAS).map((f) => f.slug);
  assert.equal(new Set(slugs).size, slugs.length, "dois itens com o mesmo slug");
  for (const [id, f] of Object.entries(FICHAS)) {
    assert.match(f.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, id);
    for (const campo of ["nome", "resumo", "descricao"]) assert.ok(f[campo].length >= 3, `${id}.${campo}`);
    assert.ok(["plano", "app", "unidade"].includes(f.tipo), id);
    assert.ok(!/[—–]/.test(JSON.stringify(f)), `${id}: sem travessão no texto`);
  }
});

test("todo item vendável tem ficha: os add-ons e extras dos dois ambientes e cada tipo de extra que o servidor aplica", () => {
  for (const [amb, vars] of Object.entries(AMBIENTES)) {
    for (const a of lerAddons(vars.ABACATEPAY_ADDONS)) assert.ok(FICHAS[a.nome], `${amb}: add-on ${a.nome} sem ficha`);
    for (const x of lerExtras(vars.ABACATEPAY_EXTRAS)) assert.ok(FICHAS[x.nome], `${amb}: extra ${x.nome} sem ficha`);
  }
  for (const t of TIPOS_EXTRA) assert.ok(FICHAS[nomeDoExtra(t)], `extra ${t} sem ficha`);
  assert.ok(FICHAS[ITEM_PRO]);
});

test("itensDoMarketplace: o Pro primeiro, só o que o ambiente vende, com o preço do catálogo", () => {
  const fin = { nome: "meu-bot-finance", produto: "prod_abc12345", centavos: 99700, rotulo: "Finanças" };
  const maq = { tipo: "maquina", nome: "extra-maquina", produto: "prod_abc12345", centavos: 9700, rotulo: "Máquina extra" };
  const dev = { tipo: "device", nome: "extra-device", produto: "prod_abc12345", centavos: 4700, rotulo: "Device extra", deCentavos: 9700 };
  const itens = itensDoMarketplace({ precoPro: 9700, addons: [fin], extras: [maq, dev] });
  assert.deepEqual(itens.map((i) => [i.id, i.slug, i.centavos, i.deCentavos]), [["pro", "pro", 9700, PRO_DE_CENTAVOS], ["meu-bot-finance", "financas", 99700, null], ["extra-maquina", "maquina-extra", 9700, null], ["extra-device", "mac-extra", 4700, 9700]]);
  assert.equal(itens[2].nome, "Mais uma máquina para o agente");
  // Fora do catálogo do ambiente: fora da lista e do caminho público.
  const so = itensDoMarketplace({ precoPro: 9700, addons: [], extras: [] });
  assert.deepEqual(so.map((i) => i.id), ["pro"]);
  assert.equal(itemPorSlug(so, "financas"), null);
  assert.equal(itemPorSlug(itens, "financas").id, "meu-bot-finance");
  assert.deepEqual(itensDoMarketplace({ precoPro: null, addons: [fin], extras: [maq] }), [], "pagamentos desligados: nada à venda");
  // Preço de tabela menor ou igual ao cobrado não vira "de/por".
  assert.equal(itensDoMarketplace({ precoPro: 99700, addons: [], extras: [] })[0].deCentavos, null);
  // Item do catálogo ainda sem ficha aparece pelo rótulo, em vez de sumir.
  const novo = itensDoMarketplace({ precoPro: 9700, addons: [{ nome: "meu-bot-novo", produto: "prod_abc12345", centavos: 1000, rotulo: "Novo" }], extras: [] })[1];
  assert.deepEqual([novo.slug, novo.nome, novo.tipo], ["novo", "Novo", "app"]);
});

test("os dois ambientes de hoje: produção vende menos itens que o staging, e os que vende têm o mesmo texto", () => {
  const de = (vars) => itensDoMarketplace({ precoPro: Number(vars.ABACATEPAY_PRECO_CENTAVOS), addons: lerAddons(vars.ABACATEPAY_ADDONS), extras: lerExtras(vars.ABACATEPAY_EXTRAS) });
  const prod = de(AMBIENTES.producao), stg = de(AMBIENTES.staging);
  for (const i of prod) { const s = stg.find((x) => x.id === i.id); assert.ok(s, `${i.id} vendido em produção e não no staging`); assert.deepEqual({ ...i }, { ...s }); }
});

test("marketplaceDoEnv: sem as chaves de pagamento nada está à venda; com elas, o Pro primeiro e o catálogo do ambiente", async () => {
  const { marketplaceDoEnv } = await import("../dist/rotas/pagamentos.js");
  const vars = AMBIENTES.producao;
  assert.deepEqual(marketplaceDoEnv({ ...vars }), [], "sem ABACATEPAY_KEY e sem o secret do webhook");
  const ligado = marketplaceDoEnv({ ...vars, ABACATEPAY_KEY: "abc_dev_x", ABACATEPAY_WEBHOOK_SECRET: "s".repeat(40) });
  assert.deepEqual(ligado.map((i) => i.id), ["pro", ...lerAddons(vars.ABACATEPAY_ADDONS).map((a) => a.nome), ...lerExtras(vars.ABACATEPAY_EXTRAS).map((x) => x.nome)]);
  assert.equal(ligado[0].centavos, Number(vars.ABACATEPAY_PRECO_CENTAVOS));
});
