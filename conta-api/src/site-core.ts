/** Regras puras do site e dos hosts do Worker (testadas em tests/site-core.test.mjs). */

/** A mesma URL em https quando veio por http (caminho e query intactos); null quando já é https ou não dá para ler. */
export function paraHttps(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "http:") return null;
  u.protocol = "https:";
  u.port = "";
  return u.toString();
}

/** O caminho sem a barra final ("/baixar/" → "/baixar"), para o site redirecionar com 301; null quando não há o que tirar (a raiz "/" fica). */
export function semBarraFinal(caminho: string): string | null {
  if (caminho.length <= 1 || !caminho.endsWith("/")) return null;
  const limpo = caminho.replace(/\/+$/, "");
  return limpo === "" ? null : limpo;
}

/**
 * Os outros endereços do site, que só redirecionam (301) para o principal: www.<site> e o .com.br (com e sem www).
 * true quando `host` é um deles. Ex.: site "https://agentesgrok.com" → www.agentesgrok.com, agentesgrok.com.br e
 * www.agentesgrok.com.br.
 */
export function ehAliasDoSite(host: string, siteOrigin: string): boolean {
  let base: string;
  try { base = new URL(siteOrigin).host; } catch { return false; }
  const h = host.toLowerCase();
  return h === `www.${base}` || h === `${base}.br` || h === `www.${base}.br`;
}
