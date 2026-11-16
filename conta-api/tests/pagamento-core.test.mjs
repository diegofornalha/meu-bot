// Assinatura do Pro pela AbacatePay: conferência do webhook, leitura do evento, decisão, prazo e a compra do GA4.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAVE_HMAC_ABACATEPAY, clientIdValido, compraGa4, decidir, hmacBase64, iguais, lerAddons, lerEvento, licencaComAddons, refValida, sessionIdValido, validoAte, webhookConfere } from "../dist/pagamento-core.js";

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
  assert.deepEqual(d, { acao: "liberar", ref: REF, assinaturaId: "subs_1", pagamentoId: "card_1", valor: 9700, primeira: true });
  const r = decidir(lerEvento(evento({ event: "subscription.renewed" }, { payment: { id: "char_2", paidAmount: 9700, status: "PAID" } })), "producao", 9700);
  assert.equal(r.acao, "liberar"); assert.equal(r.primeira, false); assert.equal(r.pagamentoId, "char_2");
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
