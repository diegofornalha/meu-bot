// Regra do painel "Assinar o Pro" no console › Plano. Puro (sem DOM): o console.js importa, o teste também.
// A API (postAssinatura, src/rotas/pagamentos.ts) só recusa quando há assinatura ACTIVE do Pro E o Pro está ativo;
// a tela segue a mesma regra.

/** O símbolo que entra no lugar da data e da contagem para quem tem o Pro sem prazo, e o texto que o explica. */
export const INFINITO = "∞", SEM_PRAZO = "sem prazo (super admin)";
/** O "∞" nos add-ons do super admin: a API já entrega todos os do catálogo (licencaDoSuper), os de hoje e os que entrarem. */
export const TODOS_ADDONS = "todos os add-ons, os de hoje e os que vierem (super admin)";
/** O "∞" nos limites de devices e de máquinas do super admin: a API não aplica limite a ele (limiteDoPapel). */
export const SEM_LIMITE = "sem limite (super admin)";
/** A licença entregue é a de um super admin (`semPrazo: true`, licencaDoSuper na API): Pro que nunca vence. */
export const semPrazo = (licenca) => licenca?.semPrazo === true;

/**
 * `pagoAtivo`: a conta tem a assinatura do Pro em andamento e o Pro valendo (o painel some).
 * `proSemAssinatura`: Pro valendo sem assinatura ativa (liberado pelo admin, ou cancelado com o mês ainda pago):
 * o painel aparece com o aviso de que o prazo atual não é encurtado.
 * `semPrazo` (só vem quando é true): conta de super admin, com o Pro sem prazo; o painel some e não há aviso, porque
 * não há o que assinar (a API recusa com 409).
 */
export function estadoAssinaturaPro(licenca, assinaturas) {
  if (semPrazo(licenca)) return { pagoAtivo: false, proSemAssinatura: false, semPrazo: true };
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
 * Super admin (`semPrazo`): "∞ sem prazo", sejam quais forem as datas.
 */
export function contagemRegressiva(licenca, agoraMs) {
  if (semPrazo(licenca)) return { texto: `${INFINITO} sem prazo`, tom: "ok" };
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

/**
 * A fase da conta, para o admin acompanhar na lista: trial (dias restantes), trial vencido, Pro ativo, expirado, free.
 * Conta de super admin (`semPrazo`): "Pro · ∞".
 */
export function fase(l, agora = Date.now()) {
  if (semPrazo(l)) return { texto: `Pro · ${INFINITO}`, tom: "ok" };
  const dias = diasAteOFim(l, agora); // a mesma conta da contagem regressiva da página Plano
  if (l.status === "trialing") return dias === null ? { texto: "Trial", tom: "ok" } : dias >= 0 ? { texto: `Trial · ${dias === 0 ? "último dia" : `${dias} dia${dias === 1 ? "" : "s"}`}`, tom: "ok" } : { texto: `Trial venceu há ${-dias} dia${dias === -1 ? "" : "s"}`, tom: "mau" };
  if (l.status === "active" && l.plan === "pro") return dias !== null && dias < 0 ? { texto: `Pro venceu há ${-dias} dia${dias === -1 ? "" : "s"}`, tom: "mau" } : { texto: dias === null ? "Pro ativo" : `Pro · ${dias} dia${dias === 1 ? "" : "s"}`, tom: "ok" };
  if (l.status === "expired") return { texto: "Expirado", tom: "mau" };
  return { texto: "Free", tom: "" };
}

/**
 * O que o "Assinar" manda à API além dos ids do GA4. Add-on: só o `produto`. Pro com a promoção na tela: `promo: true`
 * (se o prazo acabou, a API recusa em vez de abrir o preço cheio sem avisar), ou `semPromo: true` quando a pessoa
 * escolheu pagar por Pix, sem o desconto (o cupom só vale no cartão).
 */
export function pedidoAssinar(produto, promoMostrada, semPromo = false) {
  if (produto !== null && produto !== undefined) return { produto };
  if (promoMostrada === null || promoMostrada === undefined) return {};
  return semPromo ? { semPromo: true } : { promo: true };
}

/**
 * As vagas de máquina da conta, para a tela explicar a conta: `limite` é o total em vigor e `extras` quantas delas
 * são máquinas extras pagas; o resto é o que o plano inclui. Valores fora da forma (API antiga) viram 1 e 0.
 */
export function vagasDeMaquina(limite, extras) {
  const total = Number.isInteger(limite) && limite >= 1 ? limite : 1;
  const pagas = Number.isInteger(extras) && extras >= 0 ? Math.min(extras, total - 1) : 0;
  const inclusas = total - pagas;
  const detalhe = pagas === 0 ? "" : `${inclusas} inclusa${inclusas === 1 ? "" : "s"} + ${pagas} extra${pagas === 1 ? "" : "s"}`;
  return { total, inclusas, extras: pagas, detalhe };
}

/** A máquina extra vale junto com o Pro: só quem tem o Pro valendo (pago ou em teste, sem ter vencido) pode adicionar. O super admin não: já não tem limite. */
export function podeAdicionarMaquina(licenca, agoraMs = Date.now()) {
  if (semPrazo(licenca)) return false; // super admin: máquinas sem limite, nada a comprar
  if (licenca?.plan !== "pro" || (licenca.status !== "active" && licenca.status !== "trialing")) return false;
  const fim = fimDoPlano(licenca);
  return fim === null || fim > agoraMs;
}

