// Menu da conta: o selo e a linha de prazo a partir da licença da conta (trial com dias, Pro, Free, vencidos).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { resumoPlano } = createRequire(import.meta.url)("../../dist/renderer/lib/conta-resumo.js");
const AGORA = Date.parse("2026-11-07T12:00:00Z");
const lic = (x) => ({ licenca: { plan: "free", status: "free", interval: null, memberSince: "2026-11-01T00:00:00.000Z", trialEnd: null, expiresAt: null, deviceLimit: 1, produtos: [], pagamento: null, updatedAt: "2026-11-01T00:00:00.000Z", updatedBy: "system", ...x } });

test("resumoPlano: trial conta os dias; no último dia e vencido avisa", () => {
  assert.deepEqual(resumoPlano(lic({ plan: "pro", status: "trialing", trialEnd: "2026-11-21T12:00:00Z", expiresAt: "2026-11-21T12:00:00Z" }), AGORA), { selo: "trial", rotulo: "Trial", prazo: "14 dias de teste restantes", vencido: false });
  assert.equal(resumoPlano(lic({ plan: "pro", status: "trialing", trialEnd: "2026-11-08T11:00:00Z" }), AGORA).prazo, "1 dia de teste restante");
  assert.equal(resumoPlano(lic({ plan: "pro", status: "trialing", trialEnd: "2026-11-07T12:00:00Z" }), AGORA).prazo, "Último dia de teste");
  const v = resumoPlano(lic({ plan: "pro", status: "trialing", trialEnd: "2026-11-04T12:00:00Z" }), AGORA);
  assert.equal(v.vencido, true); assert.equal(v.selo, "free"); assert.match(v.prazo, /venceu há 3 dias/);
});
test("resumoPlano: Pro ativo com ou sem prazo; Pro vencido; expirado; free", () => {
  assert.deepEqual(resumoPlano(lic({ plan: "pro", status: "active" }), AGORA), { selo: "pro", rotulo: "Pro", prazo: null, vencido: false });
  assert.match(resumoPlano(lic({ plan: "pro", status: "active", expiresAt: "2027-01-31T00:00:00Z" }), AGORA).prazo, /^Pro até /);
  assert.equal(resumoPlano(lic({ plan: "pro", status: "active", expiresAt: "2026-11-01T00:00:00Z" }), AGORA).vencido, true);
  assert.deepEqual(resumoPlano(lic({ plan: "pro", status: "expired" }), AGORA), { selo: "free", rotulo: "Free", prazo: "Plano expirado", vencido: true });
  assert.deepEqual(resumoPlano(lic({}), AGORA), { selo: "free", rotulo: "Free", prazo: null, vencido: false });
});
test("resumoPlano: super admin (semPrazo) é Pro com \"∞ sem prazo\" e nunca vence", () => {
  const esperado = { selo: "pro", rotulo: "Pro", prazo: "∞ sem prazo", vencido: false };
  assert.deepEqual(resumoPlano(lic({ plan: "pro", status: "active", semPrazo: true }), AGORA), esperado);
  assert.deepEqual(resumoPlano(lic({ plan: "pro", status: "active", expiresAt: "2026-11-01T00:00:00Z", semPrazo: true }), AGORA), esperado, "nem uma data vencida muda");
  assert.equal(resumoPlano(lic({ plan: "pro", status: "expired", semPrazo: false }), AGORA).vencido, true, "só o true vale");
});
