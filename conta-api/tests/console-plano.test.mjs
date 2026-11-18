// Painel "Assinar o Pro" do console (public/console/plano-core.js): quando some e quando avisa do prazo atual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoAssinaturaPro } from "../public/console/plano-core.js";

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
