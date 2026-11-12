/**
 * Página /novidades (as releases do GitHub como conteúdo do próprio site) e o sitemap com data: regras puras,
 * testadas em tests/novidades-core.test.mjs. O Worker busca as releases com cache e só monta o HTML aqui.
 */

export interface ReleaseResumo { versao: string; nome: string; publicadoEm: string; corpo: string; url: string; preRelease: boolean }

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Lê a resposta de /releases do GitHub: só as estáveis (pre-release fica fora), mais nova primeiro, no máximo `max`. */
export function lerReleases(json: unknown, max = 20): ReleaseResumo[] {
  if (!Array.isArray(json)) return [];
  const out: ReleaseResumo[] = [];
  for (const r of json) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (o["draft"] === true || o["prerelease"] === true) continue;
    const tag = typeof o["tag_name"] === "string" ? o["tag_name"] : "";
    const m = /^v?(\d+\.\d+\.\d+)$/.exec(tag);
    if (m === null) continue;
    const publicadoEm = typeof o["published_at"] === "string" ? o["published_at"] : "";
    out.push({ versao: m[1]!, nome: typeof o["name"] === "string" && o["name"] !== "" ? o["name"] : `meu-bot ${m[1]}`, publicadoEm, corpo: typeof o["body"] === "string" ? o["body"] : "", url: typeof o["html_url"] === "string" ? o["html_url"] : "", preRelease: false });
  }
  return out.sort((a, b) => (a.publicadoEm < b.publicadoEm ? 1 : a.publicadoEm > b.publicadoEm ? -1 : 0)).slice(0, max);
}

/** Markdown das notas de release (títulos, listas, negrito, código, links) em HTML escapado; o resto vira parágrafo. */
export function mdParaHtml(md: string): string {
  const linha = (t: string): string => esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  const out: string[] = [];
  let lista: string[] = []; let par: string[] = [];
  const fechar = (): void => {
    if (lista.length > 0) { out.push(`<ul>${lista.map((l) => `<li>${l}</li>`).join("")}</ul>`); lista = []; }
    if (par.length > 0) { out.push(`<p>${par.join(" ")}</p>`); par = []; }
  };
  for (const bruta of md.replace(/\r\n?/g, "\n").split("\n")) {
    const l = bruta.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h !== null) { fechar(); const n = Math.min(6, h[1]!.length + 2); out.push(`<h${n}>${linha(h[2]!)}</h${n}>`); continue; }
    const li = /^\s*[-*]\s+(.*)$/.exec(l);
    if (li !== null) { if (par.length > 0) fechar(); lista.push(linha(li[1]!)); continue; }
    if (l.trim() === "" || /^-{3,}$/.test(l.trim())) { fechar(); continue; }
    if (lista.length > 0) { lista[lista.length - 1] += ` ${linha(l.trim())}`; continue; }
    par.push(linha(l.trim()));
  }
  fechar();
  return out.join("\n");
}

const dataBr = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });
};

/** O miolo da página /novidades: um artigo por release, com data e link para a release no GitHub. */
export function novidadesHtml(releases: readonly ReleaseResumo[]): string {
  if (releases.length === 0) return '<p class="sub">As notas de cada versão estão no <a href="https://github.com/diegofornalha/meu-bot/releases" rel="noopener">GitHub</a>.</p>';
  return releases.map((r) => `<article class="release" id="v${esc(r.versao)}">
  <h2>${esc(r.nome)}</h2>
  <p class="meta"><time datetime="${esc(r.publicadoEm)}">${esc(dataBr(r.publicadoEm))}</time> · versão ${esc(r.versao)}${r.url !== "" ? ` · <a href="${esc(r.url)}" rel="noopener">no GitHub</a>` : ""}</p>
  ${mdParaHtml(r.corpo)}
</article>`).join("\n");
}

/** Sitemap com lastmod: a home e /novidades mudam a cada release; privacidade e termos têm a data da última revisão. */
export function sitemapXml(origem: string, ultimaRelease: string | null, revisaoLegal: string): string {
  const data = (iso: string | null): string => { const t = iso === null ? NaN : Date.parse(iso); return Number.isNaN(t) ? "" : `\n    <lastmod>${new Date(t).toISOString().slice(0, 10)}</lastmod>`; };
  const url = (caminho: string, lastmod: string | null, changefreq: string, priority: string, alternates = false): string => `  <url>
    <loc>${origem}${caminho}</loc>${alternates ? `\n    <xhtml:link rel="alternate" hreflang="pt-BR" href="${origem}${caminho}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${origem}${caminho}"/>` : ""}${data(lastmod)}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${url("/", ultimaRelease, "weekly", "1.0", true)}
${url("/novidades", ultimaRelease, "weekly", "0.7")}
${url("/grok-no-whatsapp", revisaoLegal, "monthly", "0.8")}
${url("/parceria-xai", revisaoLegal, "monthly", "0.8")}
${url("/privacidade", revisaoLegal, "yearly", "0.3")}
${url("/termos", revisaoLegal, "yearly", "0.3")}
</urlset>
`;
}
