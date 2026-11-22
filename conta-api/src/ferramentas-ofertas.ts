/**
 * As ferramentas à venda em cada ambiente: `{ "<slug do catálogo>": { produto, centavos } }`, com o produto de
 * assinatura mensal da AbacatePay daquele ambiente e o preço cobrado. Cada ferramenta tem o seu produto e o seu preço.
 * Ficam aqui, e não no wrangler.toml como os apps e os extras, porque são mais de cem: não cabem numa variável.
 * Ferramenta fora desta lista não aparece no Marketplace do ambiente. VAZIO = nenhuma ferramenta à venda ali.
 */
export const OFERTAS_DE_FERRAMENTAS: Readonly<Record<"producao" | "staging", Readonly<Record<string, { produto: string; centavos: number }>>>> = {
  producao: {},
  staging: {},
};
