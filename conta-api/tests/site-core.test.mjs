// http → https: o Worker atende os dois esquemas, então o redirecionamento é dele (e o HSTS, em SEGURANCA).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { varsDoWrangler } from "../../scripts/release-core.mjs";
import { llmsPorPagamentos, paginaDaPromoDesligada, caminhoCanonico, ehAliasDoSite, paraHttps, redirecionamentoInicial, semBarraFinal, paginaForaDoAr, PAGINAS_FORA_DO_AR } from "../dist/site-core.js";

test("paraHttps: http vira https com caminho e query; https e lixo ficam null", () => {
  assert.equal(paraHttps("http://agentesgrok.com/"), "https://agentesgrok.com/");
  assert.equal(paraHttps("http://agentesgrok.com/obrigado?ver=1#x"), "https://agentesgrok.com/obrigado?ver=1#x");
  assert.equal(paraHttps("http://console.agentesgrok.com:80/account/plan"), "https://console.agentesgrok.com/account/plan");
  assert.equal(paraHttps("https://agentesgrok.com/"), null);
  assert.equal(paraHttps("nada"), null);
});

test("semBarraFinal: /baixar/ vira /baixar; a raiz e caminhos sem barra ficam null", () => {
  assert.equal(semBarraFinal("/baixar/"), "/baixar");
  assert.equal(semBarraFinal("/guias/ia-que-le-seu-gmail//"), "/guias/ia-que-le-seu-gmail");
  assert.equal(semBarraFinal("/grok-no-whatsapp"), null);
  assert.equal(semBarraFinal("/"), null);
  assert.equal(semBarraFinal("//"), null);
});

test("ehAliasDoSite: www e .com.br (com e sem www) são aliases; o principal, subdomínios e lixo não", () => {
  const s = "https://agentesgrok.com";
  for (const h of ["www.agentesgrok.com", "agentesgrok.com.br", "www.agentesgrok.com.br", "AgentesGrok.com.br"]) assert.equal(ehAliasDoSite(h, s), true, h);
  for (const h of ["agentesgrok.com", "auth.agentesgrok.com", "console.agentesgrok.com.br", "agentesgrok.com.br.evil.com"]) assert.equal(ehAliasDoSite(h, s), false, h);
  assert.equal(ehAliasDoSite("www.site-staging.agentesgrok.com", "https://site-staging.agentesgrok.com"), true);
  assert.equal(ehAliasDoSite("x", "lixo"), false);
});

test("redirecionamentoInicial: alias vai direto ao site principal em um salto (http ou https); o resto em http vira https", () => {
  const s = "https://agentesgrok.com";
  assert.equal(redirecionamentoInicial("http://www.agentesgrok.com/baixar?utm_source=x", s), "https://agentesgrok.com/baixar?utm_source=x");
  assert.equal(redirecionamentoInicial("https://www.agentesgrok.com/", s), "https://agentesgrok.com/");
  assert.equal(redirecionamentoInicial("http://agentesgrok.com.br/perguntas", s), "https://agentesgrok.com/perguntas");
  assert.equal(redirecionamentoInicial("http://www.agentesgrok.com.br/?gclid=1", s), "https://agentesgrok.com/?gclid=1");
  assert.equal(redirecionamentoInicial("http://agentesgrok.com/termos?a=1", s), "https://agentesgrok.com/termos?a=1");
  assert.equal(redirecionamentoInicial("http://console.agentesgrok.com/account/plan", s), "https://console.agentesgrok.com/account/plan");
  assert.equal(redirecionamentoInicial("https://agentesgrok.com/", s), null);
  assert.equal(redirecionamentoInicial("https://console.agentesgrok.com/", s), null);
  assert.equal(redirecionamentoInicial("nada", s), null);
});

test("caminhoCanonico: /index.html vira /, barra final sai; o canônico fica null", () => {
  assert.equal(caminhoCanonico("/index.html"), "/");
  assert.equal(caminhoCanonico("/baixar/"), "/baixar");
  assert.equal(caminhoCanonico("/"), null);
  assert.equal(caminhoCanonico("/perguntas"), null);
  assert.equal(caminhoCanonico("/guias/index.html"), null);
});

test("llmsPorPagamentos: a linha marcada sai sem a marca com pagamentos ligados e some com eles desligados", () => {
  const t = "- Plano: R$ 97.\n  Assine no console. <!--se-pagamentos-->\n- Outro";
  assert.equal(llmsPorPagamentos(t, true), "- Plano: R$ 97.\n  Assine no console.\n- Outro");
  assert.equal(llmsPorPagamentos(t, false), "- Plano: R$ 97.\n- Outro");
});

test("paginaForaDoAr: o rascunho dos planos não sai em nenhum ambiente, em nenhuma forma do caminho do arquivo", () => {
  for (const c of ["/site/suporte.html", "/site/suporte", "/site/suporte/"]) assert.equal(paginaForaDoAr(c), true, c);
  // A página do Windows (versão de teste) e as outras saem nos dois ambientes.
  for (const c of ["/site/baixar-windows.html", "/site/perguntas.html", "/site/index.html", "/site/suporte.css"]) assert.equal(paginaForaDoAr(c), false, c);
  // /suporte não está no mapa de páginas: o caminho segue cru, não é um arquivo do site e cai na 404.
  assert.equal(paginaForaDoAr("/suporte"), false);
  for (const a of PAGINAS_FORA_DO_AR) assert.ok(readFileSync(new URL(`../public${a}`, import.meta.url), "utf8").includes("NÃO É SERVIDA"), `${a} diz no topo que não é servida`);
});

// O staging mostra o que o cliente vai ver na produção: nenhuma página troca conteúdo por ambiente. O que identifica
// o staging (faixa, selo e título) vem do site.js; noindex, /config.js, /health e a medição são do Worker.
const arquivosDoSite = (dir = new URL("../public/site/", import.meta.url)) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? arquivosDoSite(new URL(`${e.name}/`, dir)) : /\.(html|js|css|txt)$/.test(e.name) ? [new URL(e.name, dir)] : []);

test("site: nenhum arquivo marca conteúdo por canal (data-canal), e o Worker não reescreve a home por ambiente", () => {
  const arquivos = arquivosDoSite();
  assert.ok(arquivos.length > 10, "achou os arquivos do site");
  for (const a of arquivos) assert.ok(!/data-canal|dataset\.canal/.test(readFileSync(a, "utf8")), `${a.pathname} tem conteúdo por canal`);
  const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.ok(!/HTMLRewriter|porCanal/.test(worker), "o Worker entrega o HTML do site como está no repositório, igual nos dois canais");
});

test("site: no site.js o canal só identifica o ambiente (faixa, selo e título), e só um bloco depende dele", () => {
  const js = readFileSync(new URL("../public/site/site.js", import.meta.url), "utf8");
  assert.equal(js.match(/cfg\.canal/g)?.length, 1, "um uso só de cfg.canal");
  const bloco = /if \(cfg\.canal === "staging"\) \{([\s\S]*?)\n  \}/.exec(js)?.[1] ?? "";
  for (const marca of ['"rasc"', '"selo-canal"', 'document.title += " · staging"']) assert.ok(bloco.includes(marca), marca);
  assert.equal(bloco.trim().split("\n").length, 3, "faixa, selo e título; nada mais");
});

test("site: nenhuma página publicada aponta para o rascunho /suporte", () => {
  const fora = PAGINAS_FORA_DO_AR.map((a) => a.replace("/site/", ""));
  for (const a of arquivosDoSite()) {
    if (fora.some((f) => a.pathname.endsWith(`/public/site/${f}`))) continue;
    assert.ok(!/href="\/suporte\b/.test(readFileSync(a, "utf8")), `${a.pathname} linka /suporte`);
  }
});

test("home: o preço do Finanças escrito na página é o do catálogo de produção (wrangler.toml)", () => {
  const { producao } = varsDoWrangler(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"));
  assert.ok(producao.ABACATEPAY_ADDONS, "catálogo de produção no wrangler.toml");
  const centavos = JSON.parse(producao.ABACATEPAY_ADDONS)["meu-bot-finance"].centavos;
  const home = readFileSync(new URL("../public/site/index.html", import.meta.url), "utf8");
  assert.ok(home.includes(`R$ ${(centavos / 100).toLocaleString("pt-BR")} por mês, à parte do plano do agente.`), `a home deve mostrar R$ ${centavos / 100}`);
});

test("home: o preço por dia é o do plano de R$ 97 dividido por 30", () => {
  const centavos = Number(varsDoWrangler(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")).producao.ABACATEPAY_PRECO_CENTAVOS);
  assert.ok(centavos > 0, "preço do plano no wrangler.toml");
  const porDia = (centavos / 100 / 30).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const home = readFileSync(new URL("../public/site/index.html", import.meta.url), "utf8");
  assert.ok(home.includes(`R$ ${porDia} por dia`), `a home deve dizer R$ ${porDia} por dia`);
  assert.ok(home.includes(`São R$ ${centavos / 100} por mês`), "e o valor do mês ao lado");
});

test("carrossel da home: o próximo quadro dá a volta nas pontas e o quadro à vista sai da rolagem", () => {
  const window = {};
  vm.runInNewContext(readFileSync(new URL("../public/site/carrossel.js", import.meta.url), "utf8"), { window });
  const { proximo, maisPerto } = window.MEU_BOT_CARROSSEL;
  assert.equal(proximo(0, 5, 1), 1);
  assert.equal(proximo(4, 5, 1), 0, "do último volta ao primeiro");
  assert.equal(proximo(0, 5, -1), 4, "do primeiro vai ao último");
  assert.equal(proximo(2, 0, 1), 0, "sem quadros");
  assert.equal(maisPerto(0, 400, 5), 0);
  assert.equal(maisPerto(790, 400, 5), 2);
  assert.equal(maisPerto(99999, 400, 5), 4, "não passa do último");
  assert.equal(maisPerto(100, 0, 5), 0, "largura ainda desconhecida");
});

test("celular da home: iPad conta como celular, o link para o Mac leva a campanha e a conversa leva o anúncio", () => {
  const window = {};
  vm.runInNewContext(readFileSync(new URL("../public/site/celular.js", import.meta.url), "utf8"), { window, URL, URLSearchParams });
  const { ehCelular, linkParaMac, refDoAnuncio, zapComRef } = window.MEU_BOT_CELULAR;
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
  assert.equal(ehCelular("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5), true);
  assert.equal(ehCelular("Mozilla/5.0 (Linux; Android 15)", 5), true);
  assert.equal(ehCelular(mac, 0), false, "Mac de verdade");
  assert.equal(ehCelular(mac, 5), true, "o iPad se apresenta como Mac, mas tem tela de toque");
  assert.equal(ehCelular("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 10), false, "notebook Windows com toque não é celular");

  const anuncio = "?utm_source=google&utm_medium=cpc&utm_campaign=grok-mac-teste&utm_content=empresario&gclid=AbCdEf1234567890";
  assert.equal(linkParaMac(anuncio, "celular"), "https://agentesgrok.com/?utm_source=google&utm_medium=cpc&utm_campaign=grok-mac-teste&utm_content=empresario-celular", "a campanha segue, o clique não");
  assert.equal(linkParaMac("?utm_source=google&utm_campaign=x", "windows"), "https://agentesgrok.com/?utm_source=google&utm_campaign=x&utm_content=windows", "sem utm_content, o sufixo é o conteúdo");
  assert.equal(linkParaMac("", "celular"), "https://agentesgrok.com/?utm_source=celular", "sem campanha, como era");
  assert.equal(linkParaMac("?gclid=AbCdEf1234567890", "celular"), "https://agentesgrok.com/?utm_source=celular");
  assert.equal(linkParaMac("?utm_source=a%20b&utm_campaign=x", "celular"), "https://agentesgrok.com/?utm_source=celular", "valor fora do formato não segue");

  assert.equal(refDoAnuncio(anuncio), "empresario");
  assert.equal(refDoAnuncio("?utm_source=google&utm_campaign=grok-mac-teste"), "grok-mac-teste");
  assert.equal(refDoAnuncio(""), null);
  const zap = "https://wa.me/5521923670743?text=Ol%C3%A1!%20Quero%20saber%20mais.";
  assert.equal(new URL(zapComRef(zap, "empresario")).searchParams.get("text"), "Olá! Quero saber mais. (ref: empresario)");
  assert.equal(zapComRef(zap, null), zap, "sem anúncio, o link fica como está");
});

test("home: no celular a conversa no WhatsApp vem antes de mandar o link, e o celular.js carrega antes do site.js", () => {
  const home = readFileSync(new URL("../public/site/index.html", import.meta.url), "utf8");
  assert.ok(home.indexOf('id="cta-cel-zap"') > 0 && home.indexOf('id="cta-cel-zap"') < home.indexOf('id="cta-cel-wa"'));
  assert.match(home, /id="cta-cel-zap"[^>]*data-ev="falar_whatsapp"[^>]*data-origem="celular"[^>]*href="https:\/\/wa\.me\/5521923670743\?/);
  assert.ok(home.indexOf("/site/celular.js") > 0 && home.indexOf("/site/celular.js") < home.indexOf("/site/site.js"));
});

test("teste grátis: os dias escritos no site, no login e no app são os do TRIAL_DIAS dos dois ambientes", () => {
  // Que os dois ambientes têm o mesmo TRIAL_DIAS é regra da paridade (tests/paridade-ambientes.test.mjs); aqui só os textos.
  const dias = [varsDoWrangler(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")).producao.TRIAL_DIAS];
  assert.match(dias[0] ?? "", /^\d+$/, "TRIAL_DIAS de produção no wrangler.toml");
  const pub = new URL("../public/", import.meta.url);
  const arquivos = readdirSync(pub, { recursive: true }).filter((f) => /\.(html|txt)$/.test(String(f))).map((f) => new URL(String(f), pub));
  arquivos.push(new URL("../../src/renderer/picker.html", import.meta.url), new URL("../../README.md", import.meta.url));
  // Frases que falam do teste grátis: "N dias grátis", "grátis por N dias", "teste de N dias", "N dias de teste", "fim dos N dias", "testa N dias", "por N dias".
  const frases = [/(\d+) dias grátis/g, /grátis (?:por|de) (\d+) dias/g, /teste (?:de|por) (\d+) dias/g, /(\d+) dias de teste/g, /fim dos (\d+) dias/g, /testa (\d+) dias/g, /teste (?:o [^.<]{0,40} )?por (\d+) dias/g, /<small>por (\d+) dias<\/small>/g];
  let achados = 0;
  for (const u of arquivos) {
    const t = readFileSync(u, "utf8");
    for (const re of frases) for (const m of t.matchAll(re)) { achados++; assert.equal(m[1], dias[0], `${u.pathname.split("/conta-api/").pop()}: "${m[0]}" não bate com TRIAL_DIAS=${dias[0]}`); }
  }
  assert.ok(achados >= 40, `esperava dezenas de menções ao teste grátis, achei ${achados}`);
});

test("promoção: a página só sai com a promoção ligada, também pelo caminho do arquivo; as outras não mudam", () => {
  assert.equal(paginaDaPromoDesligada("/site/promocao.html", false), true);
  assert.equal(paginaDaPromoDesligada("/site/promocao.html", true), false);
  assert.equal(paginaDaPromoDesligada("/site/perguntas.html", false), false);
  // Desligada, /promocao não está no mapa de páginas: o caminho segue cru, não é um arquivo e cai na 404 do site.
  assert.equal(paginaDaPromoDesligada("/promocao", false), false);
});

test("promoção: o prazo e o preço escritos no site são os do PROMO_DIAS e do PROMO_PRECO_CENTAVOS dos dois ambientes", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const dias = [...toml.matchAll(/^PROMO_DIAS = "(\d+)"$/gm)].map((m) => m[1]);
  const centavos = [...toml.matchAll(/^PROMO_PRECO_CENTAVOS = "(\d+)"$/gm)].map((m) => Number(m[1]));
  assert.equal(dias.length, 2, "PROMO_DIAS em produção e no staging");
  assert.equal(centavos.length, 2, "PROMO_PRECO_CENTAVOS em produção e no staging");
  assert.equal(dias[0], dias[1]); assert.equal(centavos[0], centavos[1]);
  assert.equal([...toml.matchAll(/^PROMO_CUPOM = "([^"]*)"$/gm)].length, 2, "PROMO_CUPOM em produção e no staging");
  const preco = centavos[0] % 100 === 0 ? String(centavos[0] / 100) : (centavos[0] / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  const pub = new URL("../public/", import.meta.url);
  const arquivos = readdirSync(pub, { recursive: true }).filter((f) => /\.(html|txt|js)$/.test(String(f))).map((f) => String(f));
  // O prazo da promoção ("N dias para assinar") é outra frase que não a do teste grátis; o preço vem sempre depois de "primeiro mês".
  const prazo = /(\d+) dias para assinar/g, valor = /primeiro mês(?: do Pro)?(?: sai)? por R\$ (\d+(?:,\d{2})?)/gi;
  const achados = {};
  for (const f of arquivos) {
    const t = readFileSync(new URL(f, pub), "utf8");
    let n = 0;
    for (const m of t.matchAll(prazo)) { n++; assert.equal(m[1], dias[0], `${f}: "${m[0]}" não bate com PROMO_DIAS=${dias[0]}`); }
    for (const m of t.matchAll(valor)) { n++; assert.equal(m[1], preco, `${f}: "${m[0]}" não bate com PROMO_PRECO_CENTAVOS=${centavos[0]}`); }
    if (n > 0) achados[f] = n;
  }
  assert.ok((achados["site/promocao.html"] ?? 0) >= 5, `a página da promoção diz o prazo e o preço (achei ${achados["site/promocao.html"] ?? 0})`);
  assert.ok(achados["site/termos.html"] > 0, "os termos citam a promoção");
});

test("promoção: a página é noindex, para quem já testou, e nada no site a divulga (só o console a linka)", () => {
  const dir = new URL("../public/site/", import.meta.url);
  const p = readFileSync(new URL("promocao.html", dir), "utf8");
  assert.match(p, /<h1>Primeiro mês do Pro por R\$ 1<\/h1>/);
  assert.match(p, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(p, /rel="canonical"/);
  assert.match(p, /Seu teste grátis acabou\? Você tem \d+ dias para assinar com o primeiro mês por R\$ 1\. Depois, R\$ 97 por mês\./);
  assert.match(p, /class="btn btn-primary" href="\/console" data-ev="plano_interesse" data-plano="promo-primeiro-mes">Assinar no console</);
  assert.equal([...p.matchAll(/class="btn/g)].length, 1, "um botão só: o do console");
  assert.match(p, /href="\/obrigado" data-ev="baixar_mac" data-origem="promocao">Teste grátis por \d+ dias</);
  assert.match(p, /Quem assina durante o teste paga o preço normal desde o primeiro mês\./);
  // Nenhuma outra página, o llms.txt ou o robots.txt leva a /promocao; a home e as perguntas nem citam a promoção.
  for (const f of readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.(html|txt|js)$/.test(f) && f !== "promocao.html")) {
    const t = readFileSync(new URL(f, dir), "utf8");
    assert.doesNotMatch(t, /\/promocao/, `${f} não pode linkar a página da promoção`);
    if (f !== "termos.html") assert.doesNotMatch(t, /primeiro mês(?: do Pro)?(?: sai)? por R\$|dias para assinar|data-promo/i, `${f} não pode citar a promoção`);
  }
  const worker = readFileSync(new URL("../src/novidades-core.ts", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /promocao/, "fora do sitemap");
  // O console linka as regras a partir do cartão da promoção.
  assert.match(readFileSync(new URL("../public/console/console.js", import.meta.url), "utf8"), /a\.href = `\$\{cfg\.site\}\/promocao`/);
});

// O Worker de verdade (dist/index.js) com as vars de cada ambiente do wrangler.toml e os arquivos de public/ no lugar
// dos static assets: o que cada site responde.
const siteDosDoisCanais = async () => {
  const worker = (await import("../dist/index.js")).default;
  const vars = varsDoWrangler(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"));
  const ASSETS = { fetch: async (r) => { try { return new Response(readFileSync(new URL(`../public${new URL(r.url).pathname}`, import.meta.url)), { headers: { "content-type": "text/html; charset=utf-8" } }); } catch { return new Response(null, { status: 404 }); } } };
  const pedir = async (canal, caminho) => {
    const env = { ...vars[canal], ASSETS };
    const r = await worker.fetch(new Request(env.SITE_ORIGIN + caminho), env, { waitUntil() {} });
    return { status: r.status, corpo: await r.text(), cabecalhos: Object.fromEntries(r.headers) };
  };
  return { pedir };
};

test("site: a home servida pelo Worker é a mesma nos dois canais; só o noindex difere", async () => {
  const { pedir } = await siteDosDoisCanais();
  const p = await pedir("producao", "/"), s = await pedir("staging", "/");
  assert.deepEqual([p.status, s.status], [200, 200]);
  assert.ok(p.corpo.includes('id="precos"') && p.corpo.includes("R$ 97"), "a home tem os planos");
  assert.equal(s.corpo, p.corpo, "o HTML da home do staging é o da produção, byte a byte");
  assert.equal(p.corpo, readFileSync(new URL("../public/site/index.html", import.meta.url), "utf8"), "e é o arquivo do repositório, sem reescrita");
  const diferentes = [...new Set([...Object.keys(p.cabecalhos), ...Object.keys(s.cabecalhos)])].filter((k) => p.cabecalhos[k] !== s.cabecalhos[k]).sort();
  assert.deepEqual(diferentes, ["x-robots-tag"]);
  assert.deepEqual([p.cabecalhos["x-robots-tag"], s.cabecalhos["x-robots-tag"]], [undefined, "noindex, nofollow"]);
  // O que identifica o ambiente: o canal no /config.js.
  for (const canal of ["producao", "staging"]) assert.ok((await pedir(canal, "/config.js")).corpo.includes(`"canal":"${canal}"`), canal);
});

test("site: o rascunho /suporte responde a 404 do site nos dois canais, também pelo caminho do arquivo", async () => {
  const { pedir } = await siteDosDoisCanais();
  const pagina404 = readFileSync(new URL("../public/site/404.html", import.meta.url), "utf8");
  for (const canal of ["producao", "staging"]) for (const caminho of ["/suporte", "/site/suporte.html", "/site/suporte"]) {
    const r = await pedir(canal, caminho);
    assert.deepEqual([r.status, r.corpo === pagina404], [404, true], `${canal} ${caminho}`);
  }
});
