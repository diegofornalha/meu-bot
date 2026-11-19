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
  | { acao: "liberar"; ref: string; assinaturaId: string; pagamentoId: string; valor: number; primeira: boolean; metodo: "CARD" | "PIX" | null }
  | { acao: "cancelada"; ref: string | null; assinaturaId: string }
  | { acao: "falhou"; ref: string | null; assinaturaId: string | null }
  | { acao: "revisar"; ref: string | null; motivo: string }
  | { acao: "ignorar"; motivo: string };

/** A forma de pagamento que a AbacatePay informa na assinatura (`subscription.method`); o que não for CARD ou PIX fica nulo. */
export function metodoPago(m: string | null): "CARD" | "PIX" | null {
  const x = (m ?? "").trim().toUpperCase();
  return x === "CARD" || x === "PIX" ? x : null;
}

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
    return { acao: "liberar", ref, assinaturaId: e.assinatura.id, pagamentoId: e.pagamento.id, valor, primeira: e.evento === "subscription.completed", metodo: metodoPago(e.assinatura.metodo) };
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
/**
 * client_id de reserva para a compra de quem pagou sem o Analytics no navegador (bloqueador, navegador que não carrega o
 * gtag): sem ele a receita não aparecia no GA4. Sai do id do pagamento (o mesmo pagamento dá sempre o mesmo número) e
 * não identifica ninguém. A compra entra sem campanha: não há visita para ligar.
 */
export function clientIdDeReserva(pagamentoId: string, agoraMs: number): string {
  let h = 2166136261;
  for (let i = 0; i < pagamentoId.length; i++) { h ^= pagamentoId.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${h % 1_000_000_000 + 1}.${Math.floor(agoraMs / 1000)}`;
}
export const sessionIdValido = (x: unknown): string | null => (typeof x === "string" && /^\d{6,12}$/.test(x) ? x : null);

/**
 * O corpo do Measurement Protocol (POST /mp/collect) para um pagamento. A primeira cobrança é `purchase` (o evento que
 * o Google Ads importa); as renovações são `assinatura_renovada`, para a receita aparecer sem contar de novo como
 * conversão do anúncio. `transaction_id` é o id do pagamento: o GA4 descarta compra repetida com o mesmo id.
 */
export function compraGa4(p: { clientId: string; sessionId: string | null; pagamentoId: string; valorCentavos: number; primeira: boolean; ambiente: "producao" | "staging"; item?: { id: string; nome: string } }): Record<string, unknown> {
  const valor = Math.round(p.valorCentavos) / 100;
  const params: Record<string, unknown> = {
    transaction_id: p.pagamentoId, value: valor, currency: "BRL", ambiente: p.ambiente, engagement_time_msec: 1,
    items: [{ item_id: p.item?.id ?? "pro-mensal", item_name: p.item?.nome ?? "meu-bot Pro mensal", price: valor, quantity: 1 }],
  };
  if (p.sessionId !== null) params.session_id = p.sessionId;
  if (p.ambiente === "staging") params.debug_mode = true;
  return { client_id: p.clientId, events: [{ name: p.primeira ? "purchase" : "assinatura_renovada", params }] };
}

/** Um app vendido à parte (add-on da licença): o produto de assinatura mensal na AbacatePay, o preço e o nome na tela. */
export interface OfertaAddon { nome: string; produto: string; centavos: number; rotulo: string }

/**
 * Lê `ABACATEPAY_ADDONS` (`{"meu-bot-finance":{"produto":"prod_...","centavos":99700,"rotulo":"Finanças"}}`). Entrada
 * fora da forma é descartada: o add-on some da tela em vez de abrir um checkout com produto ou preço errados.
 */
export function lerAddons(bruto: string | undefined): OfertaAddon[] {
  let o: Record<string, unknown> | null = null;
  try { o = obj(JSON.parse(bruto ?? "")); } catch { return []; }
  if (o === null) return [];
  const out: OfertaAddon[] = [];
  for (const [nome, v] of Object.entries(o)) {
    const a = obj(v);
    if (a === null || !/^meu-bot-[a-z0-9-]{1,30}$/.test(nome)) continue;
    const produto = txt(a.produto, 80), centavos = num(a.centavos), rotulo = txt(a.rotulo, 40);
    if (produto === null || !/^prod_[A-Za-z0-9]{6,70}$/.test(produto) || centavos === null || centavos <= 0 || rotulo === null) continue;
    out.push({ nome, produto, centavos, rotulo });
  }
  return out.sort((x, y) => x.nome.localeCompare(y.nome));
}

/** O que se vende por unidade, além do que o Pro inclui. Só o que o servidor sabe aplicar entra aqui: hoje a máquina. */
export const TIPOS_EXTRA = ["maquina"] as const;
export type TipoExtra = (typeof TIPOS_EXTRA)[number];
/**
 * Uma unidade extra vendida à parte: cada assinatura paga soma 1 ao limite da conta enquanto vale (extras_pagos).
 * `nome` é o que vai em `pagamento_checkouts.produto` e `assinaturas.produto` ("extra-maquina"): fora do padrão
 * `meu-bot-*` dos add-ons, para nunca cair em `licenca.produtos`.
 */
export interface OfertaExtra { tipo: TipoExtra; nome: string; produto: string; centavos: number; rotulo: string }
export const nomeDoExtra = (tipo: TipoExtra): string => `extra-${tipo}`;
/** O tipo de um produto de extra ("extra-maquina" → "maquina"); null para o Pro, add-on ou nome desconhecido. */
export function tipoDoExtra(produto: string | null | undefined): TipoExtra | null {
  return TIPOS_EXTRA.find((t) => nomeDoExtra(t) === produto) ?? null;
}
/**
 * Lê `ABACATEPAY_EXTRAS` (`{"maquina":{"produto":"prod_...","centavos":9700,"rotulo":"Máquina extra"}}`). Vazio ou
 * fora da forma: nada à venda. Tipo desconhecido é descartado, como add-on fora da forma em `lerAddons`.
 */
export function lerExtras(bruto: string | undefined): OfertaExtra[] {
  let o: Record<string, unknown> | null = null;
  try { o = obj(JSON.parse(bruto ?? "")); } catch { return []; }
  if (o === null) return [];
  const out: OfertaExtra[] = [];
  for (const tipo of TIPOS_EXTRA) {
    const a = obj(o[tipo]);
    if (a === null) continue;
    const produto = txt(a.produto, 80), centavos = num(a.centavos), rotulo = txt(a.rotulo, 40);
    if (produto === null || !/^prod_[A-Za-z0-9]{6,70}$/.test(produto) || centavos === null || centavos <= 0 || rotulo === null) continue;
    out.push({ tipo, nome: nomeDoExtra(tipo), produto, centavos, rotulo });
  }
  return out;
}

/**
 * O preço que uma cobrança precisa atingir para liberar: sem produto no checkout (null ou ausente) é o do Pro; com
 * produto, o do add-on ou do extra no catálogo. Produto que saiu do catálogo não libera sozinho: o preço fica
 * inatingível e o pagamento vai para a revisão do admin.
 */
export function precoExigido(produto: string | null | undefined, precoPro: number, addons: readonly OfertaAddon[], extras: readonly OfertaExtra[] = []): number {
  if (produto === null || produto === undefined || produto === "") return precoPro;
  return addons.find((a) => a.nome === produto)?.centavos ?? extras.find((x) => x.nome === produto)?.centavos ?? Number.MAX_SAFE_INTEGER;
}

/** A promoção do primeiro mês do Pro neste ambiente: o código do cupom na AbacatePay, quanto a primeira cobrança sai e por quantos dias depois do teste ela vale. */
export interface Promo { cupom: string; precoCentavos: number; dias: number }

/**
 * Lê `PROMO_CUPOM`, `PROMO_PRECO_CENTAVOS` e `PROMO_DIAS`. Sem cupom a promoção está desligada (null). Preço ou prazo
 * escritos fora da forma também desligam, em vez de valer um número que não é o do cupom: o preço é inteiro, de
 * R$ 1,00 para cima (a AbacatePay recusa total entre R$ 0,01 e R$ 0,99) e abaixo do preço cheio; o prazo, de 1 a 30 dias.
 */
export function lerPromo(cupom: string | undefined, preco: string | undefined, dias: string | undefined, precoPro: number): Promo | null {
  const c = (cupom ?? "").trim();
  if (!/^[A-Za-z0-9_.-]{1,60}$/.test(c)) return null;
  const p = (preco ?? "").trim() === "" ? 100 : Number(preco), d = (dias ?? "").trim() === "" ? 3 : Number(dias);
  if (!Number.isInteger(p) || p < 100 || p >= precoPro) return null;
  if (!Number.isInteger(d) || d < 1 || d > 30) return null;
  return { cupom: c, precoCentavos: p, dias: d };
}

const DIA_MS = 24 * 60 * 60 * 1000;
/**
 * A conta tem direito ao primeiro mês do Pro pelo preço da promoção? Devolve até quando (`ate`), ou null. Tem quando:
 * há cupom configurado; o teste grátis já acabou (`trialEnd` no passado) e a conta não está com o Pro ativo; ainda não
 * passaram `promoDias` desde o fim do teste; e a conta nunca pagou o Pro (uma vez por conta).
 * - Conta sem `trialEnd` (nunca teve teste, ou teve o teste negado por já ter apagado uma conta com o mesmo e-mail) não tem.
 * - Teste estendido à mão pelo admin ("+30 dias de teste" muda o `trialEnd`): a janela conta a partir do `trialEnd`
 *   em vigor, então quem ganhou mais 30 dias tem os `promoDias` depois deles. Se o admin troca o status para outro que
 *   não Trial, o formulário apaga o `trialEnd` e a conta deixa de ter direito.
 */
export function direitoPromo(p: { licenca: { plan: string; status: string; trialEnd: string | null; expiresAt: string | null }; jaPagouPro: boolean; agoraMs: number; promoDias: number; cupom: string }): { ate: string } | null {
  if (p.cupom.trim() === "" || p.jaPagouPro || !(p.promoDias > 0)) return null;
  const l = p.licenca;
  const fim = Date.parse(l.trialEnd ?? "");
  if (Number.isNaN(fim) || fim > p.agoraMs) return null;
  if (l.plan === "pro" && l.status === "active") {
    const vale = l.expiresAt === null ? NaN : Date.parse(l.expiresAt);
    if (Number.isNaN(vale) || vale > p.agoraMs) return null;
  }
  const ate = fim + p.promoDias * DIA_MS;
  return p.agoraMs <= ate ? { ate: new Date(ate).toISOString() } : null;
}

/**
 * O que muda no `subscriptions/create` conforme a promoção. Sem direito (`promo` null: teste ainda em vigor, prazo
 * vencido, já pagou, add-on): as formas de pagamento do ambiente, sem cupom, e com a segunda tentativa sem Pix
 * (`metodosSemPix`). Com direito: só cartão (a AbacatePay só aceita cupom em assinatura no cartão), o cupom em
 * `coupons` e uma tentativa só.
 */
export function pedidoDoCheckout(promo: { cupom: string } | null, metodos: readonly string[]): { methods: string[]; coupons?: string[]; tentarSemPix: boolean } {
  return promo === null ? { methods: [...metodos], tentarSemPix: true } : { methods: ["CARD"], coupons: [promo.cupom], tentarSemPix: false };
}

/**
 * O preço que ESTA cobrança precisa atingir. É o `precoExigido` do produto, com uma exceção: a primeira cobrança
 * (`subscription.completed`) de um checkout do Pro criado com a promoção, numa conta que nunca tinha pago o Pro, exige
 * o preço da promoção. Renovação, add-on, checkout sem a marca da promoção e conta que já pagou antes (dois checkouts
 * da promoção abertos na mesma janela) continuam no preço cheio: pagos com menos, vão para a revisão do admin.
 */
export function precoDaCobranca(p: { evento: string; checkout: { produto: string | null; promo: boolean } | null; precoPro: number; addons: readonly OfertaAddon[]; extras?: readonly OfertaExtra[]; promoCentavos: number | null; jaPagouPro: boolean }): number {
  const cheio = precoExigido(p.checkout?.produto, p.precoPro, p.addons, p.extras ?? []);
  const naPromo = p.checkout !== null && p.checkout.promo && (p.checkout.produto === null || p.checkout.produto === "") && p.evento === "subscription.completed" && !p.jaPagouPro && p.promoCentavos !== null && p.promoCentavos > 0;
  return naPromo ? Math.min(p.promoCentavos as number, cheio) : cheio;
}

/**
 * A AbacatePay recusa a assinatura inteira quando `methods` traz PIX e o Pix Automático não está liberado na loja
 * (a liberação é pedida ao suporte deles). Devolve a lista sem o PIX para uma segunda tentativa; null quando não é
 * esse o caso (deu certo, o erro é outro, não havia PIX, ou sem o PIX não sobraria método).
 */
export function metodosSemPix(metodos: readonly string[], ok: boolean, erro: unknown): string[] | null {
  if (ok || !metodos.includes("PIX")) return null;
  const texto = typeof erro === "string" ? erro : JSON.stringify(erro ?? "");
  if (!/pix autom[aá]tico is not available/i.test(texto)) return null;
  const resto = metodos.filter((m) => m !== "PIX");
  return resto.length > 0 ? resto : null;
}

/** Id de assinatura da AbacatePay (`subs_…`), como chega do console. */
export const assinaturaIdValido = (x: unknown): x is string => typeof x === "string" && /^subs_[A-Za-z0-9_-]{1,90}$/.test(x);

/**
 * Lê a resposta de `POST /subscriptions/cancel`:
 * - `cancelada`: a AbacatePay confirmou (`success` e `data.status` CANCELLED);
 * - `ja-cancelada`: 404, ou o erro "doesn't exists or not active": lá ela já não cobra, basta marcar aqui;
 * - `sem-permissao`: 401/403, a chave não tem o escopo SUBSCRIPTION:DELETE;
 * - `erro`: qualquer outra coisa (nada muda aqui; a pessoa tenta de novo).
 */
export function resultadoCancelamento(status: number, corpo: unknown): "cancelada" | "ja-cancelada" | "sem-permissao" | "erro" {
  const c = corpo !== null && typeof corpo === "object" ? (corpo as { success?: unknown; error?: unknown; data?: { status?: unknown } | null }) : null;
  if (status >= 200 && status < 300 && c?.success === true && c.data?.status === "CANCELLED") return "cancelada";
  if (status === 401 || status === 403) return "sem-permissao";
  const erro = typeof c?.error === "string" ? c.error : JSON.stringify(c?.error ?? "");
  if (status === 404 || /not found|doesn'?t exists? or not active/i.test(erro)) return "ja-cancelada";
  return "erro";
}

/**
 * Para os totais do admin: uma assinatura por conta e produto, a mais nova. Uma conta com duas assinaturas ativas do
 * mesmo produto (a antiga nunca cancelada na AbacatePay e uma nova) contaria duas vezes na receita. A exceção são os
 * extras (máquina extra): ali cada assinatura é uma unidade paga, e todas contam.
 */
export function umaPorContaEProduto<A extends { id: string; produto: string | null; criadaEm: string; conta: { id: string } }>(assinaturas: readonly A[]): A[] {
  const mais = new Map<string, A>();
  for (const a of assinaturas) {
    const chave = tipoDoExtra(a.produto) !== null ? `extra|${a.id}` : `${a.conta.id}|${a.produto ?? ""}`;
    const atual = mais.get(chave);
    if (atual === undefined || Date.parse(a.criadaEm) > Date.parse(atual.criadaEm)) mais.set(chave, a);
  }
  return [...mais.values()];
}

/** A licença como o admin a gravou; estrutural para não depender de tipos.ts (este arquivo é puro). */
interface LicencaBase { plan: "free" | "pro"; status: "free" | "trialing" | "active" | "expired"; interval: "month" | "year" | null; expiresAt: string | null; produtos: string[] }

/**
 * A licença que o app e o console recebem: a gravada mais os add-ons pagos que ainda não venceram. O app só libera um
 * add-on se a licença não estiver vencida; por isso, quem paga um add-on com o Pro ou o teste já vencidos recebe o
 * plano grátis (sem prazo) com os add-ons pagos, e não uma licença vencida que bloquearia o que foi pago. Nesse caso os
 * add-ons concedidos pelo admin, que valiam junto com a licença vencida, não voltam.
 */
export function licencaComAddons<L extends LicencaBase>(l: L, pagos: readonly { produto: string; expiresAt: string }[], agora: string): L {
  const t = Date.parse(agora);
  const vivos = pagos.filter((p) => Date.parse(p.expiresAt) > t).map((p) => p.produto);
  if (vivos.length === 0) return l;
  const vencida = l.status === "expired" || (l.expiresAt !== null && !Number.isNaN(Date.parse(l.expiresAt)) && Date.parse(l.expiresAt) < t);
  if (vencida) return { ...l, plan: "free", status: "free", interval: null, expiresAt: null, produtos: [...new Set(vivos)].sort() };
  return { ...l, produtos: [...new Set([...l.produtos, ...vivos])].sort() };
}
