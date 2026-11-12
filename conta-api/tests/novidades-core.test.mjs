// /novidades e sitemap: releases do GitHub viram artigos (só as estáveis), markdown vira HTML escapado, sitemap com lastmod.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerReleases, mdParaHtml, novidadesHtml, sitemapXml } from "../dist/novidades-core.js";

test("lerReleases: só estáveis com tag vX.Y.Z, mais nova primeiro, limitadas", () => {
  const json = [
    { tag_name: "v0.78.4", name: "meu-bot 0.78.4", published_at: "2026-11-01T10:00:00Z", body: "- a", html_url: "https://g/1" },
    { tag_name: "v0.79.0-staging.1", name: "staging", published_at: "2026-11-05T10:00:00Z", body: "x", prerelease: true },
    { tag_name: "v0.79.3", name: "", published_at: "2026-11-09T10:00:00Z", body: "## Novo\n- b", html_url: "https://g/3" },
    { tag_name: "lixo", published_at: "2026-11-09T10:00:00Z" },
    { tag_name: "v0.4.0", published_at: "2026-10-01T10:00:00Z", draft: true },
  ];
  const r = lerReleases(json, 10);
  assert.deepEqual(r.map((x) => x.versao), ["0.79.3", "0.78.4"]);
  assert.equal(r[0].nome, "meu-bot 0.79.3", "sem name, o nome vem da versão");
  assert.deepEqual(lerReleases(json, 1).map((x) => x.versao), ["0.79.3"]);
  assert.deepEqual(lerReleases("nada"), []);
});

test("mdParaHtml: títulos descem dois níveis, listas, negrito, código e links; HTML da nota é escapado", () => {
  const html = mdParaHtml("## Corrigido\n- **Login** com `senha` ([doc](https://x.y/z))\n  continua\n\nTexto <b>solto</b>\n---\n# Topo");
  assert.match(html, /<h4>Corrigido<\/h4>/);
  assert.match(html, /<ul><li><strong>Login<\/strong> com <code>senha<\/code> \(<a href="https:\/\/x\.y\/z" rel="noopener">doc<\/a>\) continua<\/li><\/ul>/);
  assert.match(html, /<p>Texto &lt;b&gt;solto&lt;\/b&gt;<\/p>/);
  assert.match(html, /<h3>Topo<\/h3>/);
  assert.equal(mdParaHtml(""), "");
});

test("novidadesHtml: um artigo por release com data em pt-BR; sem releases, o link do GitHub", () => {
  const html = novidadesHtml([{ versao: "0.79.3", nome: "meu-bot 0.79.3", publicadoEm: "2026-11-09T10:00:00Z", corpo: "- b", url: "https://g/3", preRelease: false }]);
  assert.match(html, /<article class="release" id="v0\.79\.3">/);
  assert.match(html, /9 de novembro de 2026/);
  assert.match(html, /<li>b<\/li>/);
  assert.match(novidadesHtml([]), /github\.com\/diegofornalha\/meu-bot\/releases/);
});

test("sitemapXml: oito URLs, lastmod da release na home e em /novidades, data legal nas duas páginas, sem lastmod quando falta", () => {
  const xml = sitemapXml("https://agentesgrok.com", "2026-11-09T10:00:00Z", "2026-11-09");
  assert.equal((xml.match(/<url>/g) || []).length, 8);
  assert.match(xml, /<loc>https:\/\/agentesgrok\.com\/grok-no-whatsapp<\/loc>\s*<lastmod>2026-11-09<\/lastmod>\s*<changefreq>monthly<\/changefreq>\s*<priority>0\.8<\/priority>/);
  assert.match(xml, /<loc>https:\/\/agentesgrok\.com\/parceria-xai<\/loc>/);
  assert.match(xml, /<loc>https:\/\/agentesgrok\.com\/baixar<\/loc>\s*<lastmod>2026-11-09<\/lastmod>\s*<changefreq>weekly<\/changefreq>\s*<priority>0\.9<\/priority>/);
  assert.match(xml, /<loc>https:\/\/agentesgrok\.com\/perguntas<\/loc>\s*<lastmod>2026-11-09<\/lastmod>\s*<changefreq>monthly<\/changefreq>/);
  assert.match(xml, /<loc>https:\/\/agentesgrok\.com\/novidades<\/loc>\s*<lastmod>2026-11-09<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/agentesgrok\.com\/privacidade<\/loc>\s*<lastmod>2026-11-09<\/lastmod>/);
  assert.match(xml, /hreflang="pt-BR" href="https:\/\/agentesgrok\.com\/"/);
  const sem = sitemapXml("https://agentesgrok.com", null, "2026-11-09");
  assert.match(sem, /<loc>https:\/\/agentesgrok\.com\/<\/loc>\s*<xhtml:link[^>]*\/>\s*<xhtml:link[^>]*\/>\s*<changefreq>/);
});
