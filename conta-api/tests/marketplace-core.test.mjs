// Marketplace: as fichas dos itens e a lista do que está à venda em cada ambiente (src/marketplace-core.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { varsDoWrangler } from "../../scripts/release-core.mjs";
import { FICHAS, ITEM_PRO, PRO_DE_CENTAVOS, itemPorSlug, itensDoMarketplace } from "../dist/marketplace-core.js";
import { lerAddons, lerExtras, TIPOS_EXTRA, nomeDoExtra } from "../dist/pagamento-core.js";

const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const AMBIENTES = varsDoWrangler(toml);
// Guarda contra teste vazio: os dois ambientes têm de trazer o catálogo.
for (const [amb, vars] of Object.entries(AMBIENTES)) assert.ok(lerAddons(vars.ABACATEPAY_ADDONS).length > 0 && Number(vars.ABACATEPAY_PRECO_CENTAVOS) > 0, `${amb}: catálogo não lido do wrangler.toml`);

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

// Ferramentas: a conexão do agente com um app, vendida uma a uma (ferramentas-core.ts e ferramentas-catalogo.ts).
import { CATALOGO } from "../dist/ferramentas-catalogo.js";
import { OFERTAS_DE_FERRAMENTAS } from "../dist/ferramentas-ofertas.js";
import { combinaComABusca, defeitosDoCatalogo, ehFerramenta, idDaFerramenta, lerOfertasDeFerramentas, semAcento, textoDeBusca } from "../dist/ferramentas-core.js";
import { fichaDaFerramenta, rotuloDoGrupo } from "../dist/marketplace-core.js";

test("catálogo de ferramentas: bem formado, em português e sem slug repetido", () => {
  assert.deepEqual(defeitosDoCatalogo(CATALOGO), []);
  assert.ok(CATALOGO.length >= 100, "o catálogo tem as ferramentas da lista");
  const slugs = CATALOGO.map((f) => f.slug);
  for (const s of ["gmail", "google_search_console", "googlecalendar", "googlesheets", "notion", "canva"]) assert.ok(slugs.includes(s), `${s} está no catálogo`);
  assert.ok(CATALOGO.some((f) => f.grupo === "pronta") && CATALOGO.some((f) => f.grupo === "conectar"), "os dois grupos existem");
  // Fora do público do meu-bot (lazer, uso pessoal, outros países): não entram.
  for (const s of ["aiwyn_tax_mcp", "alltrails_mcp", "viator_mcp", "ziprecruiter_mcp", "dice_mcp", "taskrabbit_mcp", "resortlife_travel_mcp"]) assert.ok(!slugs.includes(s), `${s} ficou de fora`);
  // O validador pega os defeitos que importam.
  const ruim = [{ slug: "Gmail!", nome: "G", categoria: "", grupo: "x", resumo: "curto", exemplo: "" }, { ...CATALOGO[0] }, { ...CATALOGO[0] }];
  const d = defeitosDoCatalogo(ruim).join("\n");
  for (const parte of ["slug fora da forma", "nome vazio", "sem categoria", "grupo desconhecido", "resumo deve ser", "exemplo de pedido", "slug repetido"]) assert.match(d, new RegExp(parte));
});

test("ofertas de ferramentas: só entra o que está no catálogo e na forma; os dois ambientes são lidos sem erro", () => {
  const ofertas = lerOfertasDeFerramentas({
    gmail: { produto: "prod_abc123XYZ", centavos: 4700 },
    notion: { produto: "sem-prefixo", centavos: 4700 },
    canva: { produto: "prod_abc123XYZ", centavos: 0 },
    slack: { produto: "prod_abc123XYZ", centavos: 19.5 },
    nao_existe: { produto: "prod_abc123XYZ", centavos: 4700 },
    google_search_console: { produto: "prod_def456UVW", centavos: 2900 },
  }, CATALOGO);
  assert.deepEqual(ofertas.map((o) => [o.ferramenta.slug, o.centavos]), [["google_search_console", 2900], ["gmail", 4700]], "na ordem do catálogo, sem as entradas fora da forma");
  for (const lixo of [null, undefined, [], "x", 3]) assert.deepEqual(lerOfertasDeFerramentas(lixo, CATALOGO), []);
  for (const amb of ["producao", "staging"]) {
    const lidas = lerOfertasDeFerramentas(OFERTAS_DE_FERRAMENTAS[amb], CATALOGO);
    assert.equal(lidas.length, Object.keys(OFERTAS_DE_FERRAMENTAS[amb]).length, `${amb}: toda oferta escrita é válida e de ferramenta do catálogo`);
  }
});

test("ferramenta no Marketplace: ficha escrita do catálogo, depois dos apps e extras, com nome técnico próprio", () => {
  const gmail = CATALOGO.find((f) => f.slug === "gmail"), console_ = CATALOGO.find((f) => f.slug === "google_search_console"), pronta = CATALOGO.find((f) => f.grupo === "pronta");
  assert.equal(idDaFerramenta("google_search_console"), "ferramenta-google-search-console");
  assert.equal(ehFerramenta("ferramenta-gmail"), true);
  for (const p of ["pro", "meu-bot-finance", "extra-maquina", null, undefined]) assert.equal(ehFerramenta(p), false);

  const f = fichaDaFerramenta(gmail);
  assert.equal(f.slug, "ferramenta-gmail"); assert.equal(f.tipo, "ferramenta"); assert.equal(f.nome, "Gmail");
  assert.equal(f.resumo, gmail.resumo); assert.equal(f.exemplo, gmail.exemplo); assert.equal(f.categoria, "Google");
  assert.match(f.descricao, /clique em Conectar e autorize/);
  assert.match(f.exige, /Pro/);
  assert.equal(rotuloDoGrupo(f), "Conectar com um clique");
  const fp = fichaDaFerramenta(pronta);
  assert.match(fp.descricao, /Não pede login/);
  assert.equal(rotuloDoGrupo(fp), "Pronta para uso");
  assert.equal(rotuloDoGrupo(FICHAS[ITEM_PRO]), null, "o Pro não tem grupo");

  const itens = itensDoMarketplace({ precoPro: 9700, addons: [], extras: [], ferramentas: lerOfertasDeFerramentas({ gmail: { produto: "prod_abc123XYZ", centavos: 4700 }, google_search_console: { produto: "prod_def456UVW", centavos: 2900 } }, CATALOGO) });
  assert.deepEqual(itens.map((i) => [i.id, i.tipo, i.centavos]), [["pro", "plano", 9700], ["ferramenta-google-search-console", "ferramenta", 2900], ["ferramenta-gmail", "ferramenta", 4700]]);
  assert.equal(itemPorSlug(itens, "ferramenta-gmail").nome, "Gmail");
  assert.equal(itensDoMarketplace({ precoPro: null, addons: [], extras: [], ferramentas: lerOfertasDeFerramentas({ gmail: { produto: "prod_abc123XYZ", centavos: 4700 } }, CATALOGO) }).length, 0, "pagamentos desligados: nada à venda");
  assert.equal(itensDoMarketplace({ precoPro: 9700, addons: [], extras: [] }).length, 1, "sem ferramentas, a lista é a de antes");
  // Nenhum slug público de ferramenta bate com o de um item que já existe.
  const publicos = new Set(Object.values(FICHAS).map((x) => x.slug));
  for (const c of CATALOGO) assert.ok(!publicos.has(idDaFerramenta(c.slug)));
  assert.ok(console_ !== undefined);
});

test("busca do Marketplace: sem acento, todas as palavras, em nome, resumo, categoria e exemplo", () => {
  assert.equal(semAcento("Calendário e AÇÃO"), "calendario e acao");
  const sheets = fichaDaFerramenta(CATALOGO.find((f) => f.slug === "googlesheets"));
  const t = textoDeBusca(sheets);
  for (const termo of ["", "  ", "planilha", "PLANILHAS google", "google planilha", "faturamento"]) assert.equal(combinaComABusca(t, termo), true, termo);
  for (const termo of ["gmail", "planilha zebra"]) assert.equal(combinaComABusca(t, termo), false, termo);
  // "planilha" acha o Google Sheets e o Excel; "e-mail" acha o Gmail e o Outlook.
  const acha = (termo) => CATALOGO.filter((f) => combinaComABusca(textoDeBusca(fichaDaFerramenta(f)), termo)).map((f) => f.slug);
  for (const s of ["googlesheets", "excel"]) assert.ok(acha("planilha").includes(s), s);
  for (const s of ["gmail", "outlook"]) assert.ok(acha("e-mail").includes(s), s);
  assert.ok(acha("agenda").includes("googlecalendar"));
  assert.deepEqual(acha("xyzzy-nao-existe"), []);
  assert.equal(combinaComABusca(textoDeBusca(FICHAS[ITEM_PRO]), "whatsapp"), true, "os itens de antes também são achados");
});
