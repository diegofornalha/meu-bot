// Painel "Assinar o Pro" do console (public/console/plano-core.js): quando some e quando avisa do prazo atual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contagemRegressiva, estadoAssinaturaPro } from "../public/console/plano-core.js";

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

test("contagem regressiva: dias que faltam do teste e do Pro, horas no último dia, e há quanto tempo venceu", () => {
  const agora = Date.parse("2026-11-19T02:00:00Z"), H = 3600000, D = 24 * H;
  const teste = (fim) => ({ plan: "pro", status: "trialing", trialEnd: new Date(fim).toISOString(), expiresAt: new Date(fim).toISOString() });
  assert.deepEqual(contagemRegressiva(teste(agora + 12 * D - H), agora), { texto: "faltam 12 dias de teste", tom: "ok" });
  assert.deepEqual(contagemRegressiva(teste(agora + 3 * D), agora), { texto: "faltam 3 dias de teste", tom: "ok" });
  assert.deepEqual(contagemRegressiva(teste(agora + D + 1), agora), { texto: "faltam 2 dias de teste", tom: "ok" });
  assert.deepEqual(contagemRegressiva(teste(agora + 5 * H - 1), agora), { texto: "faltam 5 horas de teste", tom: "mau" });
  assert.deepEqual(contagemRegressiva(teste(agora + 20 * 60000), agora), { texto: "falta menos de 1 hora de teste", tom: "mau" });
  assert.deepEqual(contagemRegressiva(teste(agora - H), agora), { texto: "teste venceu hoje", tom: "mau" });
  assert.deepEqual(contagemRegressiva(teste(agora - 2 * D - H), agora), { texto: "teste venceu há 2 dias", tom: "mau" });
  assert.deepEqual(contagemRegressiva({ plan: "pro", status: "active", trialEnd: null, expiresAt: new Date(agora + 20 * D).toISOString() }, agora), { texto: "faltam 20 dias do Pro", tom: "ok" });
});

test("contagem regressiva: sem prazo não aparece (free, expirado, Pro sem data, data inválida)", () => {
  const agora = Date.parse("2026-11-19T02:00:00Z");
  assert.equal(contagemRegressiva({ plan: "free", status: "free", trialEnd: null, expiresAt: null }, agora), null);
  assert.equal(contagemRegressiva({ plan: "pro", status: "active", trialEnd: null, expiresAt: null }, agora), null);
  assert.equal(contagemRegressiva({ plan: "pro", status: "expired", trialEnd: "2026-11-01T00:00:00Z", expiresAt: "2026-11-01T00:00:00Z" }, agora), null);
  assert.equal(contagemRegressiva({ plan: "pro", status: "trialing", trialEnd: "lixo", expiresAt: null }, agora), null);
  assert.equal(contagemRegressiva(undefined, agora), null);
});
