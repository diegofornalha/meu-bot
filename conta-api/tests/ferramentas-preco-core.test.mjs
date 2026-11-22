// Preço das ferramentas (src/ferramentas-preco-core.ts): o que o super admin define e o que isso exige da AbacatePay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOTE_MAXIMO, decidirOferta, detalheDaMudanca, externalIdDoProduto, pedidoDoProduto, produtoDaResposta, reaisDaFerramenta, validaCentavos } from "../dist/ferramentas-preco-core.js";

test("validaCentavos: inteiro de centavos entre R$ 1 e R$ 10.000", () => {
  for (const ok of [100, 4790, 9700, 1_000_000]) assert.equal(validaCentavos(ok), ok);
  for (const ruim of [0, 99, -500, 1_000_001, 47.9, "4790", null, undefined, NaN, Infinity]) assert.equal(typeof validaCentavos(ruim).erro, "string", String(ruim));
  assert.match(validaCentavos(50).erro, /mínimo/);
  assert.match(validaCentavos(2_000_000).erro, /máximo/);
  assert.match(validaCentavos("47,90").erro, /inteiro/);
});

test("decidirOferta: nada, só a venda, reaproveitar um preço antigo, ou criar", () => {
  const atual = { produto: "prod_atual001", centavos: 4700, aVenda: true };
  const historico = [{ produto: "prod_velho001", centavos: 2900 }, { produto: "prod_atual001", centavos: 4700 }];
  assert.deepEqual(decidirOferta({ atual, centavos: 4700, aVenda: true, historico }), { acao: "nada" });
  assert.deepEqual(decidirOferta({ atual, centavos: 4700, aVenda: false, historico }), { acao: "so-venda" }, "tirar de venda não toca na AbacatePay");
  assert.deepEqual(decidirOferta({ atual, centavos: 2900, aVenda: true, historico }), { acao: "reusar", produto: "prod_velho001" }, "preço que já existiu: o externalId é único, não dá para criar de novo");
  assert.deepEqual(decidirOferta({ atual, centavos: 5900, aVenda: true, historico }), { acao: "criar" });
  assert.deepEqual(decidirOferta({ atual: null, centavos: 4700, aVenda: false, historico: [] }), { acao: "criar" }, "primeiro preço, mesmo fora de venda, já cria o produto");
  // Oferta apagada do banco mas o produto ficou no histórico: reaproveita.
  assert.deepEqual(decidirOferta({ atual: null, centavos: 4700, aVenda: true, historico }), { acao: "reusar", produto: "prod_atual001" });
});

test("produto na AbacatePay: assinatura mensal em reais, com identificador único por canal, ferramenta e preço", () => {
  const f = { slug: "google_search_console", nome: "Google Search Console", resumo: "Acompanha como o seu site aparece no Google." };
  assert.equal(externalIdDoProduto("producao", "gmail", 4700), "mb-ferramenta-gmail-4700");
  assert.equal(externalIdDoProduto("staging", "gmail", 4700), "mbs-ferramenta-gmail-4700", "o produto de teste nunca toma o identificador do de produção");
  assert.notEqual(externalIdDoProduto("producao", "gmail", 4700), externalIdDoProduto("producao", "gmail", 4790));
  assert.deepEqual(pedidoDoProduto("staging", f, 2900), { externalId: "mbs-ferramenta-google_search_console-2900", name: "meu-bot · Google Search Console", description: f.resumo, price: 2900, currency: "BRL", cycle: "MONTHLY" });
  assert.equal(produtoDaResposta({ success: true, error: null, data: { id: "prod_abc123XYZ", price: 2900 } }), "prod_abc123XYZ");
  for (const ruim of [null, {}, { data: null }, { data: { id: "subs_x" } }, { data: { id: 12 } }, { data: { id: "prod_" } }, "prod_abc123XYZ"]) assert.equal(produtoDaResposta(ruim), null);
  assert.equal(LOTE_MAXIMO, 20);
});

test("textos: o preço em reais e a linha da auditoria", () => {
  assert.equal(reaisDaFerramenta(4700), "R$ 47");
  assert.equal(reaisDaFerramenta(4790), "R$ 47,90");
  assert.equal(reaisDaFerramenta(105), "R$ 1,05");
  assert.equal(detalheDaMudanca("gmail", null, { centavos: 4700, aVenda: true }), "gmail: sem preço → R$ 47, à venda");
  assert.equal(detalheDaMudanca("gmail", { produto: "p", centavos: 4700, aVenda: true }, { centavos: 5900, aVenda: true }), "gmail: R$ 47, à venda → R$ 59, à venda");
  assert.equal(detalheDaMudanca("gmail", { produto: "p", centavos: 5900, aVenda: true }, { centavos: 5900, aVenda: false }), "gmail: R$ 59, à venda → R$ 59, fora de venda");
});
