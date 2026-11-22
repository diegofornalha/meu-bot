/**
 * Ferramentas do meu-bot (parte pura): o que é uma ferramenta, como ela vira item do Marketplace e a busca.
 * Ferramenta é a conexão do agente com um app (Gmail, Google Search Console, Notion…), por um conector já integrado:
 * a pessoa compra, clica em Conectar e autoriza; não configura chave nem servidor. Não é módulo: módulo é um produto
 * com regras e fluxo próprios para o negócio (página Módulos do app). Cada ferramenta é vendida à parte, com o seu
 * preço; a que não tem produto no ambiente não está à venda ali (a mesma regra dos apps e dos extras).
 */

/** "pronta": não pede login, funciona assim que comprada. "conectar": pede um clique em Conectar e a autorização da conta. */
export type GrupoFerramenta = "pronta" | "conectar";
export const GRUPOS_FERRAMENTA: readonly GrupoFerramenta[] = ["pronta", "conectar"];
export interface Ferramenta {
  /** O slug do toolkit em quem faz a conexão por baixo (Composio): minúsculas, dígitos e "_". */
  slug: string;
  nome: string;
  categoria: string;
  grupo: GrupoFerramenta;
  /** Uma linha, em português: o que o agente faz com o app. */
  resumo: string;
  /** Um pedido que a pessoa pode fazer ao agente. */
  exemplo: string;
}
/** O que o Marketplace diz de cada grupo, no cartão e na página do item. */
export const ROTULO_GRUPO: Readonly<Record<GrupoFerramenta, string>> = { pronta: "Pronta para uso", conectar: "Conectar com um clique" };

/** O nome técnico da ferramenta na venda (`pagamento_checkouts.produto`) e o slug público dela (/marketplace/<isto>). */
export const PREFIXO_FERRAMENTA = "ferramenta-";
export const idDaFerramenta = (slug: string): string => `${PREFIXO_FERRAMENTA}${slug.replace(/_/g, "-")}`;
/** É o nome técnico de uma ferramenta? (o Pro é "pro", os apps "meu-bot-*", os extras "extra-*"). */
export const ehFerramenta = (produto: string | null | undefined): boolean => typeof produto === "string" && produto.startsWith(PREFIXO_FERRAMENTA);

/** Uma ferramenta à venda num ambiente: o produto de assinatura mensal na AbacatePay e o preço dela. */
export interface OfertaFerramenta { ferramenta: Ferramenta; produto: string; centavos: number }
/**
 * Lê as ofertas de um ambiente (`{ "<slug>": { produto, centavos } }`, do ferramentas-ofertas.ts) contra o catálogo.
 * Entrada fora da forma, ou de ferramenta que não está no catálogo, é descartada: a ferramenta some da venda em vez
 * de abrir um checkout com produto ou preço errados. Sai na ordem do catálogo.
 */
export function lerOfertasDeFerramentas(bruto: unknown, catalogo: readonly Ferramenta[]): OfertaFerramenta[] {
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return [];
  const o = bruto as Record<string, unknown>;
  const out: OfertaFerramenta[] = [];
  for (const ferramenta of catalogo) {
    const v = o[ferramenta.slug];
    if (typeof v !== "object" || v === null) continue;
    const { produto, centavos } = v as { produto?: unknown; centavos?: unknown };
    if (typeof produto !== "string" || !/^prod_[A-Za-z0-9]{6,70}$/.test(produto)) continue;
    if (typeof centavos !== "number" || !Number.isInteger(centavos) || centavos <= 0) continue;
    out.push({ ferramenta, produto, centavos });
  }
  return out;
}

/** O catálogo está bem formado? Devolve os defeitos (vazio = tudo certo); o teste roda isto no catálogo de verdade. */
export function defeitosDoCatalogo(catalogo: readonly Ferramenta[]): string[] {
  const d: string[] = [];
  const vistos = new Set<string>();
  for (const f of catalogo) {
    const quem = f.slug || f.nome || "(sem slug)";
    if (!/^[a-z0-9_]{2,60}$/.test(f.slug)) d.push(`${quem}: slug fora da forma`);
    if (vistos.has(f.slug)) d.push(`${quem}: slug repetido`);
    vistos.add(f.slug);
    if (f.nome.trim().length < 2 || f.nome.length > 40) d.push(`${quem}: nome vazio ou longo demais`);
    if (f.categoria.trim() === "") d.push(`${quem}: sem categoria`);
    if (!GRUPOS_FERRAMENTA.includes(f.grupo)) d.push(`${quem}: grupo desconhecido`);
    if (f.resumo.trim().length < 20 || f.resumo.length > 160 || !f.resumo.endsWith(".")) d.push(`${quem}: resumo deve ser uma frase de 20 a 160 caracteres, com ponto final`);
    if (f.exemplo.trim().length < 10 || f.exemplo.length > 120) d.push(`${quem}: exemplo de pedido vazio ou longo demais`);
  }
  return d;
}

/** Texto sem acento e em minúsculas, para a busca achar "calendario" em "Calendário". */
export const semAcento = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** O texto em que a busca procura: nome, resumo, categoria e, nas ferramentas, o exemplo de pedido. */
export const textoDeBusca = (i: { nome: string; resumo: string; categoria?: string | undefined; exemplo?: string | undefined }): string => [i.nome, i.resumo, i.categoria ?? "", i.exemplo ?? ""].join(" ");
/** O item combina com a busca? Todas as palavras digitadas têm de aparecer no texto, em qualquer ordem. Busca vazia = tudo. */
export function combinaComABusca(texto: string, termo: string): boolean {
  const alvo = semAcento(texto);
  return semAcento(termo).split(/\s+/).filter((p) => p !== "").every((p) => alvo.includes(p));
}
