/**
 * Preço das ferramentas (parte pura, testada): o que o super admin define no console e o que isso exige da AbacatePay.
 * Cada ferramenta tem o seu preço. A AbacatePay não edita o preço de um produto, então preço novo é produto novo: o
 * que já foi criado fica no histórico, para reaproveitar quando o preço volta a um valor que já existiu e para conferir
 * a cobrança de quem assinou antes. Mudar o preço não mexe em quem já assina; tirar de venda não cancela nada.
 */

/** Limites do preço mensal de uma ferramenta, em centavos: de R$ 1 a R$ 10.000. Fora disso é quase certo erro de digitação. */
export const PRECO_MINIMO_CENTAVOS = 100;
export const PRECO_MAXIMO_CENTAVOS = 1_000_000;
/** Quantas ferramentas um pedido em lote aceita: cada produto novo é uma chamada à AbacatePay, e o Worker tem limite por pedido. */
export const LOTE_MAXIMO = 20;

/** O preço que veio no pedido é um inteiro de centavos dentro dos limites? Devolve o valor, ou o motivo da recusa. */
export function validaCentavos(v: unknown): number | { erro: string } {
  if (typeof v !== "number" || !Number.isInteger(v)) return { erro: "centavos: um número inteiro (R$ 47,90 = 4790)" };
  if (v < PRECO_MINIMO_CENTAVOS) return { erro: "o preço mínimo de uma ferramenta é R$ 1,00" };
  if (v > PRECO_MAXIMO_CENTAVOS) return { erro: "o preço máximo de uma ferramenta é R$ 10.000,00" };
  return v;
}

/** A oferta que está valendo para uma ferramenta (uma linha de `ferramentas_ofertas`). */
export interface OfertaGuardada { produto: string; centavos: number; aVenda: boolean }
/** Um produto já criado para a ferramenta (uma linha de `ferramentas_produtos`). */
export interface ProdutoCriado { produto: string; centavos: number }
export type DecisaoDeOferta =
  | { acao: "nada" }
  | { acao: "so-venda" }
  | { acao: "reusar"; produto: string }
  | { acao: "criar" };

/**
 * O que fazer com o que o admin pediu. Mesmo preço e mesma venda: nada. Mesmo preço, só ligou ou desligou a venda: não
 * toca na AbacatePay. Preço que já teve produto: reaproveita. Senão, cria.
 */
export function decidirOferta(p: { atual: OfertaGuardada | null; centavos: number; aVenda: boolean; historico: readonly ProdutoCriado[] }): DecisaoDeOferta {
  if (p.atual !== null && p.atual.centavos === p.centavos) return p.atual.aVenda === p.aVenda ? { acao: "nada" } : { acao: "so-venda" };
  const antigo = p.historico.find((h) => h.centavos === p.centavos);
  return antigo !== undefined ? { acao: "reusar", produto: antigo.produto } : { acao: "criar" };
}

/**
 * O identificador do produto na AbacatePay, único na loja: ferramenta e preço, e o canal na frente (o staging usa a
 * loja em modo de teste; um produto de teste nunca pode tomar o identificador do de produção).
 */
export const externalIdDoProduto = (canal: "producao" | "staging", slug: string, centavos: number): string => `${canal === "staging" ? "mbs" : "mb"}-ferramenta-${slug}-${centavos}`;
/** O corpo de `POST products/create`: assinatura mensal, em reais, com o nome da ferramenta e o resumo do catálogo. */
export function pedidoDoProduto(canal: "producao" | "staging", f: { slug: string; nome: string; resumo: string }, centavos: number): Record<string, unknown> {
  return { externalId: externalIdDoProduto(canal, f.slug, centavos), name: `meu-bot · ${f.nome}`, description: f.resumo, price: centavos, currency: "BRL", cycle: "MONTHLY" };
}
/** O `prod_…` da resposta de `products/create`, ou null se ela não trouxe um. */
export function produtoDaResposta(resp: unknown): string | null {
  const d = typeof resp === "object" && resp !== null ? (resp as { data?: unknown }).data : null;
  const id = typeof d === "object" && d !== null ? (d as { id?: unknown }).id : null;
  return typeof id === "string" && /^prod_[A-Za-z0-9]{6,70}$/.test(id) ? id : null;
}

/** "R$ 47" para valor redondo, "R$ 47,90" para o resto (o mesmo formato das páginas do Marketplace). */
export const reaisDaFerramenta = (centavos: number): string => `R$ ${centavos % 100 === 0 ? String(centavos / 100) : (centavos / 100).toFixed(2).replace(".", ",")}`;
/** A linha da auditoria de uma mudança de preço ou de venda. */
export function detalheDaMudanca(slug: string, antes: OfertaGuardada | null, depois: { centavos: number; aVenda: boolean }): string {
  const de = antes === null ? "sem preço" : `${reaisDaFerramenta(antes.centavos)}${antes.aVenda ? ", à venda" : ", fora de venda"}`;
  return `${slug}: ${de} → ${reaisDaFerramenta(depois.centavos)}${depois.aVenda ? ", à venda" : ", fora de venda"}`;
}
