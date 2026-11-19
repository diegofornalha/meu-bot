// Assinatura do Pro pela AbacatePay: conferência do webhook, leitura do evento, decisão, prazo e a compra do GA4.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assinaturaIdValido, resultadoCancelamento, CHAVE_HMAC_ABACATEPAY, clientIdDeReserva, clientIdValido, compraGa4, decidir, hmacBase64, iguais, lerAddons, lerEvento, licencaComAddons, licencaDoSuper, limiteDoPapel, licencaEmVigor, metodosSemPix, precoExigido, precoDaCobranca, pedidoDoCheckout, direitoPromo, lerPromo, refValida, sessionIdValido, validoAte, webhookConfere, umaPorContaEProduto, lerExtras, tipoDoExtra } from "../dist/pagamento-core.js";

const SECRET = "s".repeat(40);
const REF = "mb_123e4567-e89b-12d3-a456-426614174000";
const evento = (over = {}, data = {}) => ({
  id: "log_abc", event: "subscription.completed", apiVersion: 2, devMode: false,
  data: {
    subscription: { id: "subs_1", amount: 9700, currency: "BRL", method: "CARD", status: "ACTIVE" },
    checkout: { id: "bill_1", externalId: REF, frequency: "SUBSCRIPTION" },
    payment: { id: "card_1", amount: 9700, paidAmount: 9700, status: "APPROVED", updatedAt: "2026-11-12T12:00:00.000Z" },
    ...data,
  },
  ...over,
});

test("iguais: compara inteiro, inclusive tamanhos diferentes", () => {
  assert.equal(iguais("abc", "abc"), true);
  assert.equal(iguais("abc", "abd"), false);
  assert.equal(iguais("abc", "abcd"), false);
  assert.equal(iguais("", ""), true);
});

test("webhookConfere: exige o nosso secret (32+) e a assinatura HMAC do corpo bruto", async () => {
  const corpo = JSON.stringify(evento());
  const sig = await hmacBase64(CHAVE_HMAC_ABACATEPAY, corpo);
  assert.equal(await webhookConfere(corpo, SECRET, sig, SECRET), true);
  assert.equal(await webhookConfere(corpo, "outro".repeat(8), sig, SECRET), false, "secret errado");
  assert.equal(await webhookConfere(corpo + " ", SECRET, sig, SECRET), false, "corpo alterado");
  assert.equal(await webhookConfere(corpo, SECRET, "", SECRET), false, "sem assinatura");
  assert.equal(await webhookConfere(corpo, "curto", sig, "curto"), false, "secret nosso curto demais");
  assert.equal(await webhookConfere(corpo, SECRET, sig, undefined), false, "sem secret configurado");
});

test("hmacBase64: confere com o HMAC-SHA256 do node", async () => {
  const { createHmac } = await import("node:crypto");
  const corpo = '{"a":1}';
  assert.equal(await hmacBase64(CHAVE_HMAC_ABACATEPAY, corpo), createHmac("sha256", CHAVE_HMAC_ABACATEPAY).update(corpo).digest("base64"));
});

test("lerEvento: lê o envelope v2 e recusa o resto", () => {
  const e = lerEvento(evento());
  assert.equal(e.id, "log_abc");
  assert.deepEqual(e.pagamento, { id: "card_1", pago: 9700, status: "APPROVED", quando: "2026-11-12T12:00:00.000Z" });
  assert.equal(e.checkout.ref, REF);
  assert.ok("erro" in lerEvento(null));
  assert.ok("erro" in lerEvento({ ...evento(), apiVersion: 1 }));
  assert.ok("erro" in lerEvento({ ...evento(), data: null }));
  assert.ok("erro" in lerEvento({ event: "x", apiVersion: 2, data: {} }));
});

test("decidir: libera na primeira cobrança e em cada renovação paga", () => {
  const d = decidir(lerEvento(evento()), "producao", 9700);
  assert.deepEqual(d, { acao: "liberar", ref: REF, assinaturaId: "subs_1", pagamentoId: "card_1", valor: 9700, primeira: true, metodo: "CARD" });
  const r = decidir(lerEvento(evento({ event: "subscription.renewed" }, { payment: { id: "char_2", paidAmount: 9700, status: "PAID" } })), "producao", 9700);
  assert.equal(r.acao, "liberar"); assert.equal(r.primeira, false); assert.equal(r.pagamentoId, "char_2");
});

test("decidir: leva a forma de pagamento da assinatura (CARD ou PIX); valor estranho ou ausente fica nulo", () => {
  const com = (subscription) => decidir(lerEvento(evento({}, { subscription })), "producao", 9700);
  assert.equal(com({ id: "subs_1", amount: 9700, method: "PIX", status: "ACTIVE" }).metodo, "PIX");
  assert.equal(com({ id: "subs_1", amount: 9700, method: "pix", status: "ACTIVE" }).metodo, "PIX");
  assert.equal(com({ id: "subs_1", amount: 9700, method: "BOLETO", status: "ACTIVE" }).metodo, null);
  assert.equal(com({ id: "subs_1", amount: 9700, status: "ACTIVE" }).metodo, null);
});

test("decidir: não libera por checkout.completed (duplicaria), valor baixo, externalId alheio ou canal errado", () => {
  assert.equal(decidir(lerEvento(evento({ event: "checkout.completed" })), "producao", 9700).acao, "ignorar");
  assert.equal(decidir(lerEvento(evento({}, { payment: { id: "card_1", paidAmount: 100, status: "APPROVED" } })), "producao", 9700).acao, "revisar");
  assert.equal(decidir(lerEvento(evento({}, { checkout: { id: "bill_1", externalId: "pedido-42" } })), "producao", 9700).acao, "revisar");
  assert.equal(decidir(lerEvento(evento({ devMode: true })), "producao", 9700).acao, "ignorar", "Modo Teste em produção");
  assert.equal(decidir(lerEvento(evento()), "staging", 9700).acao, "ignorar", "evento real no staging");
  assert.equal(decidir(lerEvento(evento({ devMode: true })), "staging", 9700).acao, "liberar");
  assert.equal(decidir(lerEvento(evento({}, { payment: { id: "card_1", paidAmount: 9700, status: "PENDING" } })), "producao", 9700).acao, "ignorar");
});

test("decidir: cancelamento, falha, reembolso e disputa", () => {
  assert.equal(decidir(lerEvento(evento({ event: "subscription.cancelled" })), "producao", 9700).acao, "cancelada");
  assert.equal(decidir(lerEvento(evento({ event: "subscription.payment_failed" })), "producao", 9700).acao, "falhou");
  assert.equal(decidir(lerEvento(evento({ event: "checkout.refunded" })), "producao", 9700).acao, "revisar");
  assert.equal(decidir(lerEvento(evento({ event: "checkout.disputed" })), "producao", 9700).acao, "revisar");
  assert.equal(decidir(lerEvento(evento({ event: "payout.completed" })), "producao", 9700).acao, "ignorar");
});

test("validoAte: um mês de calendário mais 3 dias, sem encurtar prazo maior", () => {
  assert.equal(validoAte("2026-11-12T12:00:00.000Z", null), "2026-12-15T12:00:00.000Z");
  assert.equal(validoAte("2027-01-31T10:00:00.000Z", null), "2027-03-03T10:00:00.000Z", "31/jan → 28/fev + 3");
  assert.equal(validoAte("2026-11-12T12:00:00.000Z", "2027-02-01T00:00:00.000Z"), "2027-02-01T00:00:00.000Z");
  assert.equal(validoAte("2026-11-12T12:00:00.000Z", "2026-11-20T00:00:00.000Z"), "2026-12-15T12:00:00.000Z");
});

test("refValida, clientIdValido e sessionIdValido", () => {
  assert.equal(refValida(REF), true);
  assert.equal(refValida("mb_x"), false);
  assert.equal(refValida(null), false);
  assert.equal(clientIdValido("123456789.1731400000"), "123456789.1731400000");
  assert.equal(clientIdValido("abc"), null);
  assert.equal(clientIdValido(42), null);
  assert.equal(sessionIdValido("1731400000"), "1731400000");
  assert.equal(sessionIdValido("1731400000; drop"), null);
});

test("compraGa4: purchase na primeira, assinatura_renovada depois; staging com debug_mode", () => {
  const c = compraGa4({ clientId: "1.1731400000", sessionId: "1731400000", pagamentoId: "card_1", valorCentavos: 9700, primeira: true, ambiente: "producao" });
  assert.equal(c.client_id, "1.1731400000");
  assert.equal(c.events[0].name, "purchase");
  assert.equal(c.events[0].params.value, 97);
  assert.equal(c.events[0].params.currency, "BRL");
  assert.equal(c.events[0].params.transaction_id, "card_1");
  assert.equal(c.events[0].params.session_id, "1731400000");
  assert.equal(c.events[0].params.debug_mode, undefined);
  const r = compraGa4({ clientId: "1.1731400000", sessionId: null, pagamentoId: "char_2", valorCentavos: 9700, primeira: false, ambiente: "staging" });
  assert.equal(r.events[0].name, "assinatura_renovada");
  assert.equal(r.events[0].params.session_id, undefined);
  assert.equal(r.events[0].params.debug_mode, true);
});

test("clientIdDeReserva: forma de client_id do GA4, o mesmo pagamento dá o mesmo número", () => {
  const a = clientIdDeReserva("pix_char_abc", 1731400000123);
  assert.equal(clientIdValido(a), a);
  assert.equal(a, clientIdDeReserva("pix_char_abc", 1731400000999));
  assert.notEqual(a.split(".")[0], clientIdDeReserva("card_xyz", 1731400000123).split(".")[0]);
  assert.equal(a.split(".")[1], "1731400000");
});

test("lerAddons: só entra add-on com nome, produto, preço e rótulo na forma certa", () => {
  const ok = { produto: "prod_12Das4f2bcXQtaR0bs4hrXms", centavos: 99700, rotulo: "Finanças" };
  assert.deepEqual(lerAddons(JSON.stringify({ "meu-bot-finance": ok })), [{ nome: "meu-bot-finance", ...ok }]);
  assert.deepEqual(lerAddons(undefined), []);
  assert.deepEqual(lerAddons("não é json"), []);
  assert.deepEqual(lerAddons("[1]"), []);
  const ruins = { "outro-app": ok, "meu-bot-a": { ...ok, produto: "bill_123456" }, "meu-bot-b": { ...ok, centavos: 0 }, "meu-bot-c": { ...ok, centavos: 9.5 }, "meu-bot-d": { produto: ok.produto, centavos: 100 }, "meu-bot-e": "x" };
  assert.deepEqual(lerAddons(JSON.stringify(ruins)), []);
  assert.deepEqual(lerAddons(JSON.stringify({ "meu-bot-fit": ok, "meu-bot-finance": ok })).map((a) => a.nome), ["meu-bot-finance", "meu-bot-fit"], "ordenado");
});

test("licencaComAddons: junta os pagos em dia e não entrega licença vencida a quem pagou um add-on", () => {
  const agora = "2026-11-16T12:00:00.000Z";
  const base = { plan: "pro", status: "active", interval: "month", expiresAt: "2026-12-01T00:00:00.000Z", produtos: ["meu-bot-fit"], deviceLimit: 2 };
  const pago = { produto: "meu-bot-finance", expiresAt: "2026-12-19T00:00:00.000Z" };
  assert.equal(licencaComAddons(base, [], agora), base, "sem pagos, a mesma licença");
  assert.equal(licencaComAddons(base, [{ ...pago, expiresAt: "2026-11-01T00:00:00.000Z" }], agora), base, "add-on vencido não entra");
  assert.deepEqual(licencaComAddons(base, [pago], agora), { ...base, produtos: ["meu-bot-finance", "meu-bot-fit"] });
  assert.deepEqual(licencaComAddons({ ...base, produtos: ["meu-bot-finance"] }, [pago], agora).produtos, ["meu-bot-finance"], "sem repetir");
  // Teste do Pro vencido + Finanças pago: plano grátis sem prazo, só com o que foi pago (o app não libera add-on de licença vencida).
  const vencida = { ...base, status: "trialing", interval: null, expiresAt: "2026-11-10T00:00:00.000Z" };
  assert.deepEqual(licencaComAddons(vencida, [pago], agora), { ...vencida, plan: "free", status: "free", interval: null, expiresAt: null, produtos: ["meu-bot-finance"] });
  assert.equal(licencaComAddons({ ...base, status: "expired", expiresAt: null }, [pago], agora).status, "free");
  // Plano grátis sem prazo não está vencido: mantém os concedidos.
  assert.deepEqual(licencaComAddons({ ...base, plan: "free", status: "free", expiresAt: null }, [pago], agora).produtos, ["meu-bot-finance", "meu-bot-fit"]);
});

test("decidir: o preço exigido é o do produto (add-on pago pelo preço do Pro vai para revisão)", () => {
  const finance = (pago) => evento({}, { subscription: { id: "subs_2", amount: 99700, method: "CARD", status: "ACTIVE" }, payment: { id: "card_2", paidAmount: pago, status: "APPROVED" } });
  assert.equal(decidir(lerEvento(finance(99700)), "producao", 99700).acao, "liberar");
  assert.equal(decidir(lerEvento(finance(9700)), "producao", 99700).acao, "revisar");
  assert.equal(decidir(lerEvento(finance(99700)), "producao", Number.MAX_SAFE_INTEGER).acao, "revisar", "produto fora do catálogo");
});

test("compraGa4: o item é o do produto pago; sem item, o Pro", () => {
  const p = { clientId: "123.1700000000", sessionId: null, pagamentoId: "card_2", valorCentavos: 99700, primeira: true, ambiente: "producao" };
  assert.deepEqual(compraGa4(p).events[0].params.items, [{ item_id: "pro-mensal", item_name: "meu-bot Pro mensal", price: 997, quantity: 1 }]);
  assert.deepEqual(compraGa4({ ...p, item: { id: "meu-bot-finance-mensal", nome: "Finanças mensal" } }).events[0].params.items, [{ item_id: "meu-bot-finance-mensal", item_name: "Finanças mensal", price: 997, quantity: 1 }]);
});

test("precoExigido: checkout sem produto é o Pro; add-on usa o preço do catálogo; fora do catálogo não libera", () => {
  const addons = [{ nome: "meu-bot-finance", produto: "prod_12Das4f2bcXQtaR0bs4hrXms", centavos: 99700, rotulo: "Finanças" }];
  assert.equal(precoExigido(null, 9700, addons), 9700);
  assert.equal(precoExigido(undefined, 9700, addons), 9700, "linha lida sem a coluna não pode virar add-on desconhecido");
  assert.equal(precoExigido("meu-bot-finance", 9700, addons), 99700);
  assert.equal(precoExigido("meu-bot-fit", 9700, addons), Number.MAX_SAFE_INTEGER);
});

test("metodosSemPix: só tenta de novo sem o Pix quando a loja ainda não tem o Pix Automático", () => {
  const erro = "PIX Automático is not available for this store";
  assert.deepEqual(metodosSemPix(["CARD", "PIX"], false, erro), ["CARD"]);
  assert.deepEqual(metodosSemPix(["CARD", "PIX"], false, { message: erro }), ["CARD"], "erro como objeto");
  assert.equal(metodosSemPix(["CARD", "PIX"], true, null), null, "deu certo");
  assert.equal(metodosSemPix(["CARD"], false, erro), null, "não havia Pix");
  assert.equal(metodosSemPix(["PIX"], false, erro), null, "sem o Pix não sobra método");
  assert.equal(metodosSemPix(["CARD", "PIX"], false, "Subscription is not available for this store"), null, "outro erro");
});

test("umaPorContaEProduto: duas assinaturas ativas do mesmo produto na mesma conta contam uma vez, a mais nova", () => {
  const a = (id, conta, produto, criadaEm, valor) => ({ id, conta: { id: conta }, produto, criadaEm, valorCentavos: valor });
  const lista = [a("s1", "c1", null, "2026-11-01T00:00:00Z", 9700), a("s2", "c1", null, "2026-11-16T00:00:00Z", 9700), a("s3", "c1", "meu-bot-finance", "2026-11-16T00:00:00Z", 99700), a("s4", "c2", null, "2026-11-10T00:00:00Z", 9700)];
  const r = umaPorContaEProduto(lista).map((x) => x.id).sort();
  assert.deepEqual(r, ["s2", "s3", "s4"]);
  assert.deepEqual(umaPorContaEProduto([]), []);
});

test("resultadoCancelamento: confirmado, já cancelada lá, chave sem escopo e erro qualquer", () => {
  assert.equal(resultadoCancelamento(200, { success: true, error: null, data: { id: "subs_1", status: "CANCELLED" } }), "cancelada");
  // 200 sem o status CANCELLED não conta como cancelada: nada muda aqui.
  assert.equal(resultadoCancelamento(200, { success: true, data: { status: "ACTIVE" } }), "erro");
  assert.equal(resultadoCancelamento(404, { success: false, error: "Subscription not found" }), "ja-cancelada");
  assert.equal(resultadoCancelamento(400, { success: false, error: "Subscription doesn't exists or not active." }), "ja-cancelada");
  assert.equal(resultadoCancelamento(401, { error: "Unauthorized" }), "sem-permissao");
  assert.equal(resultadoCancelamento(403, null), "sem-permissao");
  assert.equal(resultadoCancelamento(500, null), "erro");
  assert.equal(resultadoCancelamento(400, { error: { message: "outro" } }), "erro");
});

test("assinaturaIdValido: só subs_… curto, sem espaço nem barra", () => {
  assert.equal(assinaturaIdValido("subs_abc123XYZ"), true);
  for (const x of ["", "bill_1", "subs_", "subs_a b", "subs_a/b", `subs_${"a".repeat(91)}`, 5, null, undefined]) assert.equal(assinaturaIdValido(x), false, String(x));
});

// ---- Promoção do primeiro mês (PROMO_CUPOM): quem tem direito e quanto a cobrança precisa atingir.
const DIA = 24 * 60 * 60 * 1000;
const FIM = Date.parse("2026-11-10T12:00:00.000Z");
const vencido = { plan: "pro", status: "trialing", trialEnd: new Date(FIM).toISOString(), expiresAt: new Date(FIM).toISOString() };
const direito = (over = {}) => direitoPromo({ licenca: vencido, jaPagouPro: false, agoraMs: FIM + DIA, promoDias: 3, cupom: "PRIMEIROMES", ...over });

test("lerPromo: sem cupom a promoção está desligada; preço e prazo ausentes valem R$ 1 e 3 dias; fora da forma desligam", () => {
  assert.equal(lerPromo("", "100", "3", 9700), null);
  assert.equal(lerPromo(undefined, undefined, undefined, 9700), null);
  assert.deepEqual(lerPromo(" PRIMEIROMES ", "100", "3", 9700), { cupom: "PRIMEIROMES", precoCentavos: 100, dias: 3 });
  assert.deepEqual(lerPromo("PRIMEIROMES", undefined, "", 9700), { cupom: "PRIMEIROMES", precoCentavos: 100, dias: 3 });
  assert.equal(lerPromo("PRIMEIROMES", "97", "3", 9700), null, "abaixo de R$ 1,00 a AbacatePay recusa");
  assert.equal(lerPromo("PRIMEIROMES", "9700", "3", 9700), null, "o preço da promoção fica abaixo do cheio");
  assert.equal(lerPromo("PRIMEIROMES", "1.5", "3", 9700), null);
  assert.equal(lerPromo("PRIMEIROMES", "100", "0", 9700), null);
  assert.equal(lerPromo("PRIMEIROMES", "100", "x", 9700), null);
  assert.equal(lerPromo("com espaço", "100", "3", 9700), null);
});

test("direitoPromo: vale do fim do teste até promoDias depois, para quem nunca pagou o Pro", () => {
  assert.deepEqual(direito(), { ate: new Date(FIM + 3 * DIA).toISOString() });
  assert.deepEqual(direito({ agoraMs: FIM }), { ate: new Date(FIM + 3 * DIA).toISOString() }, "no instante em que o teste acaba");
  assert.deepEqual(direito({ agoraMs: FIM + 3 * DIA }), { ate: new Date(FIM + 3 * DIA).toISOString() }, "o último instante do prazo ainda vale");
  assert.equal(direito({ agoraMs: FIM + 3 * DIA + 1 }), null, "passado o prazo, perde o direito");
  assert.equal(direito({ agoraMs: FIM - 1 }), null, "teste ainda em vigor");
});

test("direitoPromo: sem cupom, quem já pagou, quem nunca teve teste e quem está com o Pro ativo não têm", () => {
  assert.equal(direito({ cupom: "" }), null, "promoção desligada");
  assert.equal(direito({ cupom: "  " }), null);
  assert.equal(direito({ jaPagouPro: true }), null, "uma vez por conta");
  assert.equal(direito({ promoDias: 0 }), null);
  assert.equal(direito({ licenca: { plan: "free", status: "free", trialEnd: null, expiresAt: null } }), null, "nunca teve teste, ou teste negado");
  assert.equal(direito({ licenca: { ...vencido, trialEnd: "lixo" } }), null);
  assert.equal(direito({ licenca: { plan: "pro", status: "active", trialEnd: vencido.trialEnd, expiresAt: null } }), null, "Pro ativo sem prazo (dado pelo admin)");
  assert.equal(direito({ licenca: { plan: "pro", status: "active", trialEnd: vencido.trialEnd, expiresAt: new Date(FIM + 30 * DIA).toISOString() } }), null, "Pro ativo valendo");
  assert.notEqual(direito({ licenca: { plan: "pro", status: "active", trialEnd: vencido.trialEnd, expiresAt: new Date(FIM + DIA / 2).toISOString() } }), null, "Pro que já venceu não tira o direito");
  assert.notEqual(direito({ licenca: { plan: "free", status: "expired", trialEnd: vencido.trialEnd, expiresAt: null } }), null);
});

test("direitoPromo: teste estendido pelo admin (+30 dias) conta a janela a partir do trialEnd novo", () => {
  const novoFim = FIM + 30 * DIA;
  const estendido = { plan: "pro", status: "trialing", trialEnd: new Date(novoFim).toISOString(), expiresAt: new Date(novoFim).toISOString() };
  assert.equal(direito({ licenca: estendido, agoraMs: FIM + DIA }), null, "durante os 30 dias a mais, ainda é teste");
  assert.deepEqual(direito({ licenca: estendido, agoraMs: novoFim + 2 * DIA }), { ate: new Date(novoFim + 3 * DIA).toISOString() });
  assert.equal(direito({ licenca: estendido, agoraMs: novoFim + 4 * DIA }), null);
});

// Os quatro casos do webhook: o preço exigido sai de precoDaCobranca e vai para decidir.
const cobranca = (ev, pago, promo, over = {}) => {
  const e = lerEvento(evento({ event: ev }, { payment: { id: "card_1", amount: pago, paidAmount: pago, status: "APPROVED" } }));
  return decidir(e, "producao", precoDaCobranca({ evento: e.evento, checkout: { produto: null, promo }, precoPro: 9700, addons: [], promoCentavos: 100, jaPagouPro: false, ...over }));
};

test("promoção no webhook: checkout com promo, primeira cobrança de R$ 1 libera, com o valor realmente pago", () => {
  const d = cobranca("subscription.completed", 100, true);
  assert.equal(d.acao, "liberar"); assert.equal(d.valor, 100); assert.equal(d.primeira, true);
  // O purchase do GA4 leva o que entrou (R$ 1), não o preço cheio.
  const ev = compraGa4({ clientId: "1.1700000000", sessionId: null, pagamentoId: d.pagamentoId, valorCentavos: d.valor, primeira: d.primeira, ambiente: "producao" }).events[0];
  assert.equal(ev.name, "purchase"); assert.equal(ev.params.value, 1); assert.equal(ev.params.items[0].price, 1);
});

test("promoção no webhook: checkout com promo, renovação de R$ 1 vai para revisão (renovação é preço cheio)", () => {
  const d = cobranca("subscription.renewed", 100, true);
  assert.equal(d.acao, "revisar"); assert.match(d.motivo, /abaixo de 9700/);
  assert.equal(cobranca("subscription.renewed", 9700, true).acao, "liberar");
});

test("promoção no webhook: checkout SEM promo pago com R$ 1 continua indo para revisão", () => {
  const d = cobranca("subscription.completed", 100, false);
  assert.equal(d.acao, "revisar"); assert.match(d.motivo, /pago 100 centavos, abaixo de 9700/);
});

test("promoção no webhook: checkout com promo pago pelo preço cheio na primeira cobrança libera", () => {
  const d = cobranca("subscription.completed", 9700, true);
  assert.equal(d.acao, "liberar"); assert.equal(d.valor, 9700);
});

test("precoDaCobranca: a promoção não vale para add-on, conta que já pagou, promoção desligada nem evento sem checkout", () => {
  const addons = lerAddons('{"meu-bot-finance":{"produto":"prod_abcdef12","centavos":99700,"rotulo":"Finanças"}}');
  const base = { evento: "subscription.completed", checkout: { produto: null, promo: true }, precoPro: 9700, addons, promoCentavos: 100, jaPagouPro: false };
  assert.equal(precoDaCobranca(base), 100);
  assert.equal(precoDaCobranca({ ...base, checkout: { produto: "meu-bot-finance", promo: true } }), 99700, "add-on nunca entra na promoção");
  assert.equal(precoDaCobranca({ ...base, jaPagouPro: true }), 9700, "segundo checkout da promoção na mesma conta");
  assert.equal(precoDaCobranca({ ...base, promoCentavos: null }), 9700, "cupom tirado da configuração");
  assert.equal(precoDaCobranca({ ...base, checkout: null }), 9700);
  assert.equal(precoDaCobranca({ ...base, promoCentavos: 20000 }), 9700, "nunca acima do preço cheio");
  assert.equal(cobranca("subscription.completed", 100, true, { jaPagouPro: true }).acao, "revisar");
});

test("checkout: com o teste EM VIGOR não há promoção (preço cheio, métodos normais, sem cupom); só depois do trialEnd, por PROMO_DIAS", () => {
  const promo = lerPromo("PRIMEIROMES1", "100", "3", 9700);
  const METODOS = ["CARD", "PIX"];
  // O mesmo caminho de postAssinatura: direitoPromo decide, pedidoDoCheckout monta o que vai à AbacatePay.
  const pedido = (agoraMs, over = {}) => {
    const d = direitoPromo({ licenca: vencido, jaPagouPro: false, agoraMs, promoDias: promo.dias, cupom: promo.cupom, ...over });
    return pedidoDoCheckout(d === null ? null : promo, METODOS);
  };
  const normal = { methods: ["CARD", "PIX"], tentarSemPix: true };
  const comCupom = { methods: ["CARD"], coupons: ["PRIMEIROMES1"], tentarSemPix: false };
  for (const [quando, t] of [["primeiro dia do teste", FIM - 3 * DIA], ["último segundo do teste", FIM - 1000]]) {
    const p = pedido(t);
    assert.deepEqual(p, normal, quando);
    assert.equal("coupons" in p, false, `${quando}: sem a chave coupons no corpo`);
  }
  assert.deepEqual(pedido(FIM), comCupom, "o teste acabou agora");
  assert.deepEqual(pedido(FIM + 3 * DIA), comCupom, "último instante do prazo");
  assert.deepEqual(pedido(FIM + 3 * DIA + 1000), normal, "passado o prazo, preço normal");
  assert.deepEqual(pedido(FIM + DIA, { jaPagouPro: true }), normal, "quem já pagou o Pro");
  // Quem assina durante o teste paga o preço cheio: o checkout nasce sem a marca e R$ 1 não libera.
  assert.equal(cobranca("subscription.completed", 100, false).acao, "revisar");
  assert.equal(cobranca("subscription.completed", 9700, false).acao, "liberar");
});

test("lerExtras: só máquina e device na forma certa entram; vazio, tipo desconhecido e campo fora da forma não vendem nada", () => {
  const ok = '{"maquina":{"produto":"prod_abc12345","centavos":9700,"rotulo":"Máquina extra"}}';
  assert.deepEqual(lerExtras(ok), [{ tipo: "maquina", nome: "extra-maquina", produto: "prod_abc12345", centavos: 9700, rotulo: "Máquina extra" }]);
  assert.deepEqual(lerExtras(""), []);
  assert.deepEqual(lerExtras(undefined), []);
  assert.deepEqual(lerExtras("lixo"), []);
  assert.deepEqual(lerExtras('{"device":{"produto":"prod_abc12345","centavos":4700,"rotulo":"Device extra"}}'), [{ tipo: "device", nome: "extra-device", produto: "prod_abc12345", centavos: 4700, rotulo: "Device extra" }]);
  assert.deepEqual(lerExtras('{"chip":{"produto":"prod_abc12345","centavos":4700,"rotulo":"Chip extra"}}'), [], "tipo que o servidor não sabe aplicar não se vende");
  assert.equal(tipoDoExtra("extra-device"), "device");
  assert.deepEqual(lerExtras('{"maquina":{"produto":"errado","centavos":9700,"rotulo":"Máquina extra"}}'), []);
  assert.deepEqual(lerExtras('{"maquina":{"produto":"prod_abc12345","centavos":0,"rotulo":"Máquina extra"}}'), []);
  assert.equal(tipoDoExtra("extra-maquina"), "maquina");
  assert.equal(tipoDoExtra("meu-bot-finance"), null);
  assert.equal(tipoDoExtra(null), null);
});

test("preço do extra: a máquina extra exige o preço do catálogo; fora do catálogo não libera; a promoção não vale para ela", () => {
  const extras = lerExtras('{"maquina":{"produto":"prod_abc12345","centavos":9700,"rotulo":"Máquina extra"}}');
  assert.equal(precoExigido("extra-maquina", 9700, [], extras), 9700);
  assert.equal(precoExigido("extra-maquina", 9700, [], []), Number.MAX_SAFE_INTEGER, "catálogo vazio: vai para a revisão do admin");
  assert.equal(precoExigido(null, 9700, [], extras), 9700);
  const base = { evento: "subscription.completed", precoPro: 9700, addons: [], extras, promoCentavos: 100, jaPagouPro: false };
  assert.equal(precoDaCobranca({ ...base, checkout: { produto: "extra-maquina", promo: true } }), 9700);
  assert.equal(decidir(lerEvento(evento()), "producao", precoDaCobranca({ ...base, checkout: { produto: "extra-maquina", promo: false } })).acao, "liberar");
  assert.equal(decidir(lerEvento(evento()), "producao", precoExigido("extra-maquina", 9700, [], [])).acao, "revisar", "extra fora do catálogo não libera sozinho");
});

test("umaPorContaEProduto: cada assinatura de máquina extra é uma unidade e todas contam", () => {
  const c = { id: "c1" };
  const lista = [
    { id: "subs_m1", produto: "extra-maquina", criadaEm: "2026-11-01T00:00:00Z", conta: c },
    { id: "subs_m2", produto: "extra-maquina", criadaEm: "2026-11-02T00:00:00Z", conta: c },
    { id: "subs_p1", produto: null, criadaEm: "2026-11-01T00:00:00Z", conta: c },
    { id: "subs_p2", produto: null, criadaEm: "2026-11-03T00:00:00Z", conta: c },
  ];
  assert.deepEqual(umaPorContaEProduto(lista).map((x) => x.id).sort(), ["subs_m1", "subs_m2", "subs_p2"]);
});

test("licencaDoSuper: Pro ativo sem prazo e todos os add-ons do catálogo, seja o que for que esteja gravado; limites e o resto não mudam", () => {
  const gravada = { plan: "pro", status: "expired", interval: "month", memberSince: "2026-01-01T00:00:00.000Z", trialEnd: "2026-11-01T00:00:00.000Z", expiresAt: "2026-11-01T00:00:00.000Z", deviceLimit: 3, produtos: ["meu-bot-fit"], pagamento: { instrucoes: "Pix", link: null }, updatedAt: "2026-11-02T00:00:00.000Z", updatedBy: "admin" };
  const copia = structuredClone(gravada);
  assert.deepEqual(licencaDoSuper(gravada, []), { ...gravada, plan: "pro", status: "active", interval: null, trialEnd: null, expiresAt: null, semPrazo: true });
  // O catálogo entra inteiro, somado ao gravado, sem repetir e em ordem; add-on novo no catálogo já vale, sem gravar nada.
  assert.deepEqual(licencaDoSuper(gravada, ["meu-bot-novo", "meu-bot-fit", "meu-bot-finance"]).produtos, ["meu-bot-finance", "meu-bot-fit", "meu-bot-novo"]);
  assert.deepEqual(licencaDoSuper({ ...gravada, produtos: [] }, ["meu-bot-finance"]).produtos, ["meu-bot-finance"]);
  assert.deepEqual(gravada, copia, "a gravada não é mexida: é regra de leitura");
  for (const l of [{ ...gravada, plan: "free", status: "free", trialEnd: null, expiresAt: null }, { ...gravada, status: "trialing", expiresAt: "2026-12-01T00:00:00.000Z" }]) {
    const s = licencaDoSuper(l, []);
    assert.deepEqual([s.plan, s.status, s.trialEnd, s.expiresAt, s.interval, s.semPrazo], ["pro", "active", null, null, null, true]);
    assert.deepEqual([s.deviceLimit, s.produtos, s.memberSince, s.pagamento], [l.deviceLimit, l.produtos, l.memberSince, l.pagamento]);
  }
});

test("licencaEmVigor: licença expirada gravada + papel super = Pro ativo sem prazo; admin comum e conta sem papel não mudam", () => {
  const agora = "2026-11-16T12:00:00.000Z";
  const expirada = { plan: "pro", status: "expired", interval: null, memberSince: "2026-01-01T00:00:00.000Z", trialEnd: "2026-11-01T00:00:00.000Z", expiresAt: "2026-11-01T00:00:00.000Z", deviceLimit: 1, produtos: ["meu-bot-fit"] };
  const s = licencaEmVigor(expirada, [], "super", [], agora);
  assert.deepEqual(licencaEmVigor(expirada, [], "super", ["meu-bot-finance"], agora).produtos, ["meu-bot-finance", "meu-bot-fit"], "o catálogo é do super admin");
  assert.deepEqual([s.plan, s.status, s.trialEnd, s.expiresAt, s.semPrazo, s.deviceLimit], ["pro", "active", null, null, true, 1]);
  for (const papel of ["admin", null]) {
    assert.equal(licencaEmVigor(expirada, [], papel, ["meu-bot-finance"], agora), expirada, `papel ${papel}: a mesma licença gravada, sem o catálogo`);
    assert.equal("semPrazo" in licencaEmVigor(expirada, [], papel, [], agora), false);
  }
  // Com add-on pago: a conta comum vencida cai no grátis com o pago (licencaComAddons) e perde o concedido; o super
  // admin, que nunca está vencido, fica com o concedido e o pago.
  const pago = { produto: "meu-bot-finance", expiresAt: "2026-12-19T00:00:00.000Z" };
  assert.deepEqual(licencaEmVigor(expirada, [pago], null, [], agora), licencaComAddons(expirada, [pago], agora));
  assert.equal(licencaEmVigor(expirada, [pago], "admin", [], agora).plan, "free");
  const sp = licencaEmVigor(expirada, [pago], "super", [], agora);
  assert.deepEqual([sp.plan, sp.status, sp.semPrazo, sp.produtos], ["pro", "active", true, ["meu-bot-finance", "meu-bot-fit"]]);
});

test("limiteDoPapel: o super admin não tem limite de devices nem de máquinas; admin comum e conta sem papel seguem o gravado", async () => {
  const { admitirDevice } = await import("../dist/sessao-core.js");
  const { admitirMaquina, cabeNoLimite } = await import("../dist/licenca-core.js");
  assert.deepEqual([limiteDoPapel(1, "super"), limiteDoPapel(1, "admin"), limiteDoPapel(3, null)], [Infinity, 1, 3]);
  // Device novo com 50 ativos: pendente para a conta comum, ativo para o super admin; o conhecido pendente segue pendente.
  assert.equal(admitirDevice(null, 50, limiteDoPapel(1, null)), "pending");
  assert.equal(admitirDevice(null, 50, limiteDoPapel(1, "super")), "active");
  // Máquina nova com outra já vinculada: sem vaga no limite 1, e entra sem limite; a vinculada mais nova renova.
  const agoraMs = Date.parse("2026-11-19T00:00:00.000Z");
  const daConta = [{ id: "a", ultimaEmissaoEm: "2026-11-18T00:00:00.000Z", desvinculadaEm: null }];
  assert.equal("erro" in admitirMaquina(daConta, "b", limiteDoPapel(1, null), agoraMs), true);
  assert.deepEqual(admitirMaquina(daConta, "b", limiteDoPapel(1, "super"), agoraMs), { acao: "vincular" });
  const posicoes = [{ id: "a", criadaEm: "2026-11-01", desvinculadaEm: null }, { id: "b", criadaEm: "2026-11-02", desvinculadaEm: null }];
  assert.deepEqual([cabeNoLimite(posicoes, "b", limiteDoPapel(1, null)), cabeNoLimite(posicoes, "b", limiteDoPapel(1, "super"))], [false, true]);
});
