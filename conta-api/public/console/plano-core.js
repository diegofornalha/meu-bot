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

const HORA = 60 * 60 * 1000, DIA = 24 * HORA;
/**
 * A contagem regressiva do plano, para o cabeçalho da página Plano: quanto falta para o teste ou o Pro acabar.
 * Conta dias cheios que ainda faltam (arredonda para cima); no último dia conta as horas; vencido, diz há quanto tempo.
 * Sem prazo (free, ou Pro sem data) devolve null. `tom`: "mau" vencido ou nas últimas 24 h, "ok" no resto.
 */
export function contagemRegressiva(licenca, agoraMs) {
  const fim = Date.parse(licenca?.expiresAt ?? licenca?.trialEnd ?? "");
  if (Number.isNaN(fim)) return null;
  const teste = licenca?.status === "trialing";
  if (!teste && !(licenca?.plan === "pro" && licenca?.status === "active")) return null;
  const de = teste ? "de teste" : "do Pro";
  const falta = fim - agoraMs;
  if (falta <= 0) { const d = Math.floor(-falta / DIA); return { texto: d === 0 ? `${teste ? "teste" : "Pro"} venceu hoje` : `${teste ? "teste" : "Pro"} venceu há ${d} dia${d === 1 ? "" : "s"}`, tom: "mau" }; }
  if (falta <= DIA) { const h = Math.ceil(falta / HORA); return { texto: h <= 1 ? `falta menos de 1 hora ${de}` : `faltam ${h} horas ${de}`, tom: "mau" }; }
  const d = Math.ceil(falta / DIA);
  return { texto: `faltam ${d} dias ${de}`, tom: "ok" };
}
