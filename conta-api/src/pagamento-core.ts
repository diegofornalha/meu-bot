/**
 * Regras da assinatura do Pro pela AbacatePay, sem I/O (testadas em tests/pagamento-core.test.mjs):
 * conferir o webhook (secret + assinatura HMAC), ler o evento campo a campo, decidir o que fazer com ele, calcular até
 * quando o Pro vale e montar a compra para o Measurement Protocol do GA4.
 *
 * Documentação: https://docs.abacatepay.com/pages/notificacoes/seguranca e /pages/webhooks/events/subscriptions.
 */

/**
 * Chave pública da AbacatePay para o HMAC-SHA256 do corpo (`X-Webhook-Signature`, base64). É a mesma para todas as
 * contas e está na documentação: prova só que o corpo chegou intacto. Quem prova a origem é o secret do webhook.
 */
export const CHAVE_HMAC_ABACATEPAY = "t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9";

/** Comparação em tempo constante (não sai mais cedo no primeiro caractere diferente). */
export function iguais(a: string, b: string): boolean {
  const A = new TextEncoder().encode(a), B = new TextEncoder().encode(b);
  let dif = A.length ^ B.length;
  for (let i = 0; i < Math.max(A.length, B.length); i++) dif |= (A[i] ?? 0) ^ (B[i] ?? 0);
  return dif === 0;
}

/** HMAC-SHA256 em base64 de `corpo` com `chave`. */
export async function hmacBase64(chave: string, corpo: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(corpo)));
  let bin = ""; for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * O webhook é da AbacatePay e chegou inteiro: o secret (header `X-Webhook-Secret` ou `?webhookSecret=`) é o nosso, com
 * pelo menos 32 caracteres, e a assinatura confere com o corpo bruto, antes de qualquer JSON.parse.
 */
export async function webhookConfere(corpo: string, secretRecebido: string, assinatura: string, secretNosso: string | undefined): Promise<boolean> {
  if (secretNosso === undefined || secretNosso.length < 32) return false;
  if (!iguais(secretRecebido, secretNosso)) return false;
  if (assinatura === "") return false;
  return iguais(await hmacBase64(CHAVE_HMAC_ABACATEPAY, corpo), assinatura);
}

/** O que importa de um webhook de assinatura, já validado. */
export interface EventoAssinatura {
  /** log_...: igual em todas as retentativas. */
  id: string;
  evento: string;
  devMode: boolean;
  assinatura: { id: string; status: string; metodo: string | null; valor: number | null } | null;
  /** O nosso externalId (mb_...) e o bill_... do checkout. */
  checkout: { id: string | null; ref: string | null; frequencia: string | null } | null;
  /** A cobrança deste evento: card_.../char_..., quanto entrou e se está paga. */
  pagamento: { id: string; pago: number | null; status: string; quando: string | null } | null;
}

const obj = (x: unknown): Record<string, unknown> | null => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const txt = (x: unknown, max = 200): string | null => (typeof x === "string" && x.length > 0 && x.length <= max ? x : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x < 1e9 ? x : null);

/** Lê o envelope `{id, event, apiVersion: 2, devMode, data}`; o que não tem a forma esperada vira `{erro}`. */
export function lerEvento(bruto: unknown): EventoAssinatura | { erro: string } {
  const e = obj(bruto);
  if (e === null) return { erro: "corpo não é um objeto" };
  const id = txt(e.id, 100), evento = txt(e.event, 60);
  if (id === null || evento === null) return { erro: "sem id ou event" };
  if (e.apiVersion !== 2) return { erro: "apiVersion diferente de 2" };
  const data = obj(e.data);
  if (data === null) return { erro: "sem data" };
  const s = obj(data.subscription), c = obj(data.checkout), p = obj(data.payment);
  const assinatura = s !== null && txt(s.id, 100) !== null ? { id: s.id as string, status: txt(s.status, 30) ?? "", metodo: txt(s.method, 20), valor: num(s.amount) } : null;
  const checkout = c !== null ? { id: txt(c.id, 100), ref: txt(c.externalId, 100), frequencia: txt(c.frequency, 30) } : null;
  const pagamento = p !== null && txt(p.id, 100) !== null ? { id: p.id as string, pago: num(p.paidAmount), status: txt(p.status, 30) ?? "", quando: txt(p.updatedAt, 40) } : null;
  return { id, evento, devMode: e.devMode === true, assinatura, checkout, pagamento };
}

/** O nosso externalId: mb_ + uuid. Outro formato não é de checkout criado pelo console. */
export const refValida = (ref: string | null): ref is string => ref !== null && /^mb_[0-9a-f-]{36}$/.test(ref);

export type Decisao =
  | { acao: "liberar"; ref: string; assinaturaId: string; pagamentoId: string; valor: number; primeira: boolean }
  | { acao: "cancelada"; ref: string | null; assinaturaId: string }
  | { acao: "falhou"; ref: string | null; assinaturaId: string | null }
  | { acao: "revisar"; ref: string | null; motivo: string }
  | { acao: "ignorar"; motivo: string };

/**
 * O que fazer com um evento. Libera o Pro só por `subscription.completed` (primeira cobrança sem teste) ou
 * `subscription.renewed` (cada ciclo pago): o `checkout.completed` de assinatura é o mesmo pagamento e seria duplicado.
 * Pagamento abaixo do preço vai para revisão do admin, não libera. Reembolso e disputa também: quem tira o Pro é o admin.
 * O canal de produção recusa eventos do Modo Teste e o de staging recusa eventos reais.
 */
export function decidir(e: EventoAssinatura, canal: "producao" | "staging", precoCentavos: number): Decisao {
  if (canal === "producao" && e.devMode) return { acao: "ignorar", motivo: "evento do Modo Teste em produção" };
  if (canal === "staging" && !e.devMode) return { acao: "ignorar", motivo: "evento real no staging" };
  const ref = e.checkout?.ref ?? null;
  if (e.evento === "subscription.completed" || e.evento === "subscription.renewed") {
    if (!refValida(ref)) return { acao: "revisar", ref, motivo: "assinatura sem o nosso externalId" };
    if (e.assinatura === null || e.pagamento === null) return { acao: "revisar", ref, motivo: "evento sem assinatura ou pagamento" };
    if (e.pagamento.status !== "PAID" && e.pagamento.status !== "APPROVED") return { acao: "ignorar", motivo: `pagamento ${e.pagamento.status || "sem status"}` };
    const valor = e.pagamento.pago ?? 0;
    if (valor < precoCentavos) return { acao: "revisar", ref, motivo: `pago ${valor} centavos, abaixo de ${precoCentavos}` };
    return { acao: "liberar", ref, assinaturaId: e.assinatura.id, pagamentoId: e.pagamento.id, valor, primeira: e.evento === "subscription.completed" };
  }
  if (e.evento === "subscription.cancelled") return e.assinatura === null ? { acao: "revisar", ref, motivo: "cancelamento sem assinatura" } : { acao: "cancelada", ref, assinaturaId: e.assinatura.id };
  if (e.evento === "subscription.payment_failed") return { acao: "falhou", ref, assinaturaId: e.assinatura?.id ?? null };
  if (e.evento === "checkout.refunded" || e.evento === "checkout.disputed" || e.evento === "checkout.lost") return { acao: "revisar", ref, motivo: e.evento };
  return { acao: "ignorar", motivo: `evento ${e.evento} não é tratado` };
}

/**
 * Até quando o Pro vale depois de um pagamento: um mês de calendário mais 3 dias de folga (a renovação seguinte pode
 * atrasar um pouco, e a AbacatePay tenta de novo antes de cancelar). Nunca encurta um prazo que já era maior.
 */
export function validoAte(pagoEm: string, atual: string | null): string {
  const d = new Date(Date.parse(pagoEm));
  const dia = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  if (d.getUTCDate() !== dia) d.setUTCDate(0); // 31/jan + 1 mês = 28 ou 29/fev, não 3/mar
  d.setUTCDate(d.getUTCDate() + 3);
  const novo = d.toISOString();
  return atual !== null && Date.parse(atual) > Date.parse(novo) ? atual : novo;
}

/** client_id do GA4 (o do cookie _ga: "123456789.1700000000") e session_id (só dígitos); o resto vira null. */
export const clientIdValido = (x: unknown): string | null => (typeof x === "string" && /^\d{1,12}\.\d{9,11}$/.test(x) ? x : null);
export const sessionIdValido = (x: unknown): string | null => (typeof x === "string" && /^\d{6,12}$/.test(x) ? x : null);

/**
 * O corpo do Measurement Protocol (POST /mp/collect) para um pagamento. A primeira cobrança é `purchase` (o evento que
 * o Google Ads importa); as renovações são `assinatura_renovada`, para a receita aparecer sem contar de novo como
 * conversão do anúncio. `transaction_id` é o id do pagamento: o GA4 descarta compra repetida com o mesmo id.
 */
export function compraGa4(p: { clientId: string; sessionId: string | null; pagamentoId: string; valorCentavos: number; primeira: boolean; ambiente: "producao" | "staging" }): Record<string, unknown> {
  const valor = Math.round(p.valorCentavos) / 100;
  const params: Record<string, unknown> = {
    transaction_id: p.pagamentoId, value: valor, currency: "BRL", ambiente: p.ambiente, engagement_time_msec: 1,
    items: [{ item_id: "pro-mensal", item_name: "meu-bot Pro mensal", price: valor, quantity: 1 }],
  };
  if (p.sessionId !== null) params.session_id = p.sessionId;
  if (p.ambiente === "staging") params.debug_mode = true;
  return { client_id: p.clientId, events: [{ name: p.primeira ? "purchase" : "assinatura_renovada", params }] };
}
