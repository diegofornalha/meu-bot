// Regra do painel "Assinar o Pro" no console › Plano. Puro (sem DOM): o console.js importa, o teste também.
// A API (postAssinatura, src/rotas/pagamentos.ts) só recusa quando há assinatura ACTIVE do Pro E o Pro está ativo;
// a tela segue a mesma regra.

/**
 * `pagoAtivo`: a conta tem a assinatura do Pro em andamento e o Pro valendo (o painel some).
 * `proSemAssinatura`: Pro valendo sem assinatura ativa (liberado pelo admin, ou cancelado com o mês ainda pago):
 * o painel aparece com o aviso de que o prazo atual não é encurtado.
 */
export function estadoAssinaturaPro(licenca, assinaturas) {
  const proAtivo = licenca?.plan === "pro" && licenca?.status === "active";
  const assina = (Array.isArray(assinaturas) ? assinaturas : []).some((a) => a?.status === "ACTIVE" && (a.produto === null || a.produto === undefined));
  return { pagoAtivo: proAtivo && assina, proSemAssinatura: proAtivo && !assina };
}

/**
 * A promoção do primeiro mês que a API mandou em `conta.promo` ({precoCentavos, ate, cupom}), conferida campo a campo;
 * null quando não veio, veio fora da forma ou o prazo já passou (a tela fica aberta e o prazo acaba).
 */
export function promoNaTela(promo, agoraMs = Date.now()) {
  if (promo === null || typeof promo !== "object") return null;
  const { precoCentavos, ate, cupom } = promo;
  if (!Number.isInteger(precoCentavos) || precoCentavos <= 0 || typeof cupom !== "string" || cupom === "" || typeof ate !== "string") return null;
  const fim = Date.parse(ate);
  if (Number.isNaN(fim) || fim < agoraMs) return null;
  return { precoCentavos, ate, cupom };
}

/** "R$ 1" para valor redondo, "R$ 1,50" para o resto: o preço como o site o escreve. */
export const reaisCurto = (centavos) => `R$ ${centavos % 100 === 0 ? String(centavos / 100) : (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
