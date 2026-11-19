// Painel "Assinar o Pro" do console (public/console/plano-core.js): quando some e quando avisa do prazo atual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoAssinaturaPro, promoNaTela, reaisCurto } from "../public/console/plano-core.js";

const pro = { plan: "pro", status: "active" };
const ativa = { status: "ACTIVE", produto: null };

test("assinar o Pro: some só com a assinatura do Pro em andamento e o Pro valendo", () => {
  assert.deepEqual(estadoAssinaturaPro(pro, [ativa]), { pagoAtivo: true, proSemAssinatura: false });
});

test("assinar o Pro: Pro liberado sem assinatura, ou cancelado com o mês pago, pode assinar e vê o aviso do prazo", () => {
  assert.deepEqual(estadoAssinaturaPro(pro, []), { pagoAtivo: false, proSemAssinatura: true });
  assert.deepEqual(estadoAssinaturaPro(pro, undefined), { pagoAtivo: false, proSemAssinatura: true });
  assert.deepEqual(estadoAssinaturaPro(pro, [{ status: "CANCELLED", produto: null }]), { pagoAtivo: false, proSemAssinatura: true });
});

test("assinar o Pro: assinatura de add-on não conta como assinatura do Pro", () => {
  assert.deepEqual(estadoAssinaturaPro(pro, [{ status: "ACTIVE", produto: "meu-bot-finance" }]), { pagoAtivo: false, proSemAssinatura: true });
});

test("assinar o Pro: sem Pro valendo o painel aparece sem aviso, mesmo com assinatura ACTIVE (a API também aceita)", () => {
  for (const l of [{ plan: "free", status: "free" }, { plan: "pro", status: "expired" }, { plan: "pro", status: "trialing" }]) {
    assert.deepEqual(estadoAssinaturaPro(l, [ativa]), { pagoAtivo: false, proSemAssinatura: false });
    assert.deepEqual(estadoAssinaturaPro(l, []), { pagoAtivo: false, proSemAssinatura: false });
  }
});

test("promoção do primeiro mês: a tela só mostra o que veio inteiro da API e ainda está no prazo", () => {
  const agora = Date.parse("2026-11-18T12:00:00Z");
  const promo = { precoCentavos: 100, ate: "2026-11-20T12:00:00.000Z", cupom: "PRIMEIROMES" };
  assert.deepEqual(promoNaTela(promo, agora), promo);
  assert.equal(promoNaTela(null, agora), null);
  assert.equal(promoNaTela(undefined, agora), null, "API antiga, sem o campo");
  assert.equal(promoNaTela({ ...promo, ate: "2026-11-18T11:59:59.000Z" }, agora), null, "prazo acabou com a tela aberta");
  assert.equal(promoNaTela({ ...promo, cupom: "" }, agora), null);
  assert.equal(promoNaTela({ ...promo, precoCentavos: "100" }, agora), null);
  assert.equal(promoNaTela({ ...promo, ate: "lixo" }, agora), null);
});

test("reaisCurto: valor redondo sem centavos, como o site escreve", () => {
  assert.equal(reaisCurto(100), "R$ 1");
  assert.equal(reaisCurto(9700), "R$ 97");
  assert.equal(reaisCurto(150), "R$ 1,50");
});
