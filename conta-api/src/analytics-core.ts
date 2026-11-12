/**
 * Google Analytics 4 das páginas (site, login, console), a parte pura. O Worker lê GA_ID (lista de IDs "G-…" separados
 * por vírgula), manda a lista no /config.js de cada host e libera na CSP os domínios da tag só quando há ID.
 * `paginaLimpa` e `caminhoAnonimo` são a regra que o front copia (public/analytics.js): o Analytics nunca recebe query,
 * fragmento (#code&verifier do console, ?state&challenge do login) nem o slug de uma organização. Da query, só passam
 * as chaves de campanha de `CHAVES_CAMPANHA` (`campanhaDaQuery`): sem elas, o clique de um anúncio vira tráfego direto.
 */
export const GA_ID_RE = /^G-[A-Z0-9]{6,12}$/;

/** Os IDs válidos de GA_ID, sem repetição e na ordem; [] quando não há nenhum. */
export function gaIds(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? "").split(",").map((x) => x.trim()).filter((x) => GA_ID_RE.test(x)))];
}

/** Domínios que a CSP precisa liberar para a tag do Google (gtag.js e os destinos dos dados). */
export const CSP_GA = {
  script: "https://www.googletagmanager.com",
  connect: "https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
  img: "https://*.google-analytics.com https://*.googletagmanager.com",
} as const;

/** Origem + caminho de uma URL, sem query nem fragmento ("https://console…/account/plan"); null se a URL não é legível. */
export function paginaLimpa(url: string): string | null {
  try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return null; }
}

/** O caminho sem identificar a organização: /organizations/<slug>/members → /organizations/_/members (new fica). */
export function caminhoAnonimo(caminho: string): string {
  return caminho.replace(/^\/organizations\/(?!new(?:\/|$))[^/]+/, "/organizations/_").replace(/^\/enterprise\/[^/]+/, "/enterprise/_");
}

/** As únicas chaves da query que vão ao Analytics: as de campanha (UTM) e os identificadores de clique do Google Ads. */
export const CHAVES_CAMPANHA = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "gclid", "gbraid", "wbraid"] as const;

/** A query só com as chaves de campanha, na ordem de CHAVES_CAMPANHA, cada valor com até 200 caracteres ("?utm_source=x&gclid=y"); "" quando não há nenhuma. */
export function campanhaDaQuery(search: string): string {
  const p = new URLSearchParams(search);
  const q = new URLSearchParams();
  for (const k of CHAVES_CAMPANHA) { const v = p.get(k); if (v) q.set(k, v.slice(0, 200)); }
  const s = q.toString();
  return s ? `?${s}` : "";
}
