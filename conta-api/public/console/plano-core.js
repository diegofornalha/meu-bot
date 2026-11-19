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
/** Quando o plano acaba, em ms: o `expiresAt` e, sem ele, o `trialEnd`; null sem data válida. */
export function fimDoPlano(licenca) { const fim = Date.parse(licenca?.expiresAt ?? licenca?.trialEnd ?? ""); return Number.isNaN(fim) ? null : fim; }
/**
 * Quantos dias faltam para o plano acabar, arredondando para cima (negativo depois de vencido); null sem data.
 * É a conta única de "dias que faltam" do console: a página Plano e a lista do admin (`fase`) usam esta.
 */
export function diasAteOFim(licenca, agoraMs) { const fim = fimDoPlano(licenca); return fim === null ? null : Math.ceil((fim - agoraMs) / DIA); }
/**
 * A contagem regressiva do plano, para o cabeçalho da página Plano: quanto falta para o teste ou o Pro acabar.
 * Conta dias cheios que ainda faltam (arredonda para cima); no último dia conta as horas; vencido, diz há quanto tempo.
 * Sem prazo (free, ou Pro sem data) devolve null. `tom`: "mau" vencido ou nas últimas 24 h, "ok" no resto.
 */
export function contagemRegressiva(licenca, agoraMs) {
  const fim = fimDoPlano(licenca);
  if (fim === null) return null;
  const teste = licenca?.status === "trialing";
  if (!teste && !(licenca?.plan === "pro" && licenca?.status === "active")) return null;
  const de = teste ? "de teste" : "do Pro";
  const falta = fim - agoraMs;
  if (falta <= 0) { const d = Math.floor(-falta / DIA); return { texto: d === 0 ? `${teste ? "teste" : "Pro"} venceu hoje` : `${teste ? "teste" : "Pro"} venceu há ${d} dia${d === 1 ? "" : "s"}`, tom: "mau" }; }
  if (falta <= DIA) { const h = Math.ceil(falta / HORA); return { texto: h <= 1 ? `falta menos de 1 hora ${de}` : `faltam ${h} horas ${de}`, tom: "mau" }; }
  return { texto: `faltam ${diasAteOFim(licenca, agoraMs)} dias ${de}`, tom: "ok" };
}
