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

/** Os guias publicados em /guias/<slug> (arquivo em public/site/guias/<slug>.html): a rota e o sitemap leem esta lista. */
export const GUIAS = ["ia-para-pequena-empresa", "responder-clientes-whatsapp-fora-do-horario", "ia-que-le-seu-gmail", "whatsapp-bloqueia-numero-com-ia", "automatizar-whatsapp-com-ia", "api-oficial-do-whatsapp-ou-numero-proprio"] as const;

/**
 * Data da última mudança de cada página de texto, para o lastmod do sitemap: o Google ignora lastmod que muda junto em
 * todas as URLs. Vem de `git log -1 --format=%cs -- conta-api/public/site/<arquivo>.html`; quem mexer no conteúdo de uma
 * página atualiza a data dela aqui. A home, /baixar e /novidades não estão no mapa: levam a data da release mais nova.
 */
export const REVISAO_PAGINAS: Readonly<Record<string, string>> = {
  "/grok-no-whatsapp": "2026-11-12",
  "/parceria-xai": "2026-11-12",
  "/perguntas": "2026-11-12",
  "/grok-bot-e-meu-bot": "2026-11-12",
  "/guias": "2026-11-13",
  "/guias/ia-para-pequena-empresa": "2026-11-12",
  "/guias/responder-clientes-whatsapp-fora-do-horario": "2026-11-12",
  "/guias/ia-que-le-seu-gmail": "2026-11-12",
  "/guias/whatsapp-bloqueia-numero-com-ia": "2026-11-12",
  "/guias/automatizar-whatsapp-com-ia": "2026-11-12",
  "/guias/api-oficial-do-whatsapp-ou-numero-proprio": "2026-11-13",
  "/privacidade": "2026-11-12",
  "/termos": "2026-11-12",
};

/** Sitemap com lastmod por URL: a home, /baixar e /novidades mudam a cada release; as outras têm a data de `revisoes`. */
export function sitemapXml(origem: string, ultimaRelease: string | null, revisoes: Readonly<Record<string, string>> = REVISAO_PAGINAS): string {
  const data = (iso: string | null | undefined): string => { const t = iso == null ? NaN : Date.parse(iso); return Number.isNaN(t) ? "" : `\n    <lastmod>${new Date(t).toISOString().slice(0, 10)}</lastmod>`; };
  const url = (caminho: string, lastmod: string | null | undefined): string => `  <url>
    <loc>${origem}${caminho}</loc>${data(lastmod)}
  </url>`;
  const pagina = (caminho: string): string => url(caminho, revisoes[caminho]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${url("/", ultimaRelease)}
${url("/baixar", ultimaRelease)}
${url("/novidades", ultimaRelease)}
${pagina("/grok-no-whatsapp")}
${pagina("/parceria-xai")}
${pagina("/perguntas")}
${pagina("/grok-bot-e-meu-bot")}
${pagina("/guias")}
${GUIAS.map((g) => pagina(`/guias/${g}`)).join("\n")}
${pagina("/privacidade")}
${pagina("/termos")}
</urlset>
`;
}
