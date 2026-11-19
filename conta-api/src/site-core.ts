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

/**
 * O 301 que o Worker dá antes de qualquer rota, num salto só: alias do site (www., .com.br), em http ou https, vai
 * direto para o site principal com o caminho e a query (utm, gclid); o resto em http vira https. null quando não há
 * o que redirecionar. Ex.: http://www.agentesgrok.com/baixar?x=1 → https://agentesgrok.com/baixar?x=1, sem passar
 * por https://www.agentesgrok.com.
 */
export function redirecionamentoInicial(url: string, siteOrigin: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (ehAliasDoSite(u.host, siteOrigin)) return `${siteOrigin}${u.pathname}${u.search}`;
  return paraHttps(url);
}

/** O caminho canônico do site, para o 301: "/index.html" vira "/" e "/baixar/" vira "/baixar"; null quando já é o canônico. */
export function caminhoCanonico(caminho: string): string | null {
  if (caminho === "/index.html") return "/";
  return semBarraFinal(caminho);
}

/**
 * O llms.txt tem linhas que só valem com a assinatura ligada (marcadas com <!--se-pagamentos-->): com ela ligada, sai só
 * a marca; desligada, sai a linha inteira. Assim uma IA que lê o arquivo não manda ninguém a um botão que não existe.
 */
export function llmsPorPagamentos(texto: string, ligados: boolean): string {
  return texto.split("\n").filter((l) => ligados || !l.includes("<!--se-pagamentos-->")).map((l) => l.replace(/\s*<!--se-pagamentos-->/, "")).join("\n");
}

/**
 * Arquivos do site que só saem com a promoção do primeiro mês ligada (PROMO_CUPOM); desligada, respondem a 404 do site.
 * A página não é divulgada: noindex, fora do sitemap e do llms.txt, e só o console (Plano) a linka.
 */
export const SO_COM_PROMO: readonly string[] = ["/site/promocao.html"];
/** O arquivo pedido é da promoção e ela está desligada? Vale para /promocao e para o caminho direto do arquivo. */
export const paginaDaPromoDesligada = (arquivo: string, promoLigada: boolean): boolean => !promoLigada && SO_COM_PROMO.includes(arquivo);

/** Arquivos do site que só o staging serve (rascunhos em revisão); em produção respondem a 404 do site. */
export const SO_NO_STAGING: readonly string[] = ["/site/suporte.html"];
/** O arquivo pedido é um rascunho que este canal não serve? (produção + rascunho = true) */
export const rascunhoForaDoCanal = (arquivo: string, canal: string | undefined): boolean => canal !== "staging" && SO_NO_STAGING.includes(arquivo);
