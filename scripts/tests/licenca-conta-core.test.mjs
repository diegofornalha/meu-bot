// A licença da conta numa máquina, o lado do app: quando pedir outra emissão, e o que a conta diz das máquinas dela.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const { deveRenovarLicenca, RENOVAR_APOS_MS } = req("../../dist/main/licenca/licenca-conta-core.js");
const { parseContaInfo } = req("../../dist/main/conta/conta-core.js");

const AGORA = Date.parse("2026-11-18T12:00:00Z"), DIA = 24 * 60 * 60 * 1000;
const CONTA = "11111111-1111-4111-8111-111111111111", OUTRA = "55555555-5555-4555-8555-555555555555";
const ok = (dias, conta = CONTA) => ({ ok: true, kid: "k", payload: { conta: { id: conta, email: "a@b.c" }, emitidaEm: new Date(AGORA - dias * DIA).toISOString() } });

test("renovação: a licença desta conta com mais de 7 dias pede outra; nova, de outra conta ou mexida, não", () => {
  assert.equal(RENOVAR_APOS_MS, 7 * DIA);
  assert.equal(deveRenovarLicenca(ok(1), CONTA, AGORA), false, "acabou de ser emitida");
  assert.equal(deveRenovarLicenca(ok(7), CONTA, AGORA), false, "no limite ainda não");
  assert.equal(deveRenovarLicenca(ok(8), CONTA, AGORA), true);
  assert.equal(deveRenovarLicenca(ok(20, OUTRA), CONTA, AGORA), false, "a máquina usa a licença de outra pessoa: não é este app que renova");
  assert.equal(deveRenovarLicenca({ ok: false, motivo: "expirada" }, CONTA, AGORA), true, "venceu: tenta (a API responde 404 se a máquina não é desta conta)");
  for (const motivo of ["sem-assinatura", "formato", "assinatura"]) assert.equal(deveRenovarLicenca({ ok: false, motivo }, CONTA, AGORA), false, motivo);
});

test("conta: as máquinas trazem até quando a licença vale, e o limite diz se a API leva a licença a máquinas", () => {
  const base = { id: CONTA, email: "Ana@Exemplo.com", licenca: {}, devices: [], orgs: [] };
  const M = "22222222-2222-4222-8222-222222222222";
  const c = parseContaInfo({ ...base, maquinaLimite: 2, maquinas: [{ id: M, apelido: "Karen", vinculadaPor: "app", proAte: "2026-12-18T12:00:00.000Z", desvinculadaEm: null }, { id: "nao-e-uuid" }, { id: OUTRA, apelido: null, vinculadaPor: "app", proAte: "ontem", desvinculadaEm: "2026-11-17T00:00:00.000Z" }] });
  assert.equal(c.maquinaLimite, 2);
  assert.deepEqual(c.maquinas, [{ id: M, apelido: "Karen", vinculadaPor: "app", proAte: "2026-12-18T12:00:00.000Z", desvinculadaEm: null }, { id: OUTRA, apelido: null, vinculadaPor: "app", proAte: null, desvinculadaEm: "2026-11-17T00:00:00.000Z" }]);
  // API de antes: sem o limite e sem os prazos. O app não oferece "usar o meu Pro" (maquinaLimite null).
  const antiga = parseContaInfo({ ...base, maquinas: [{ id: M, apelido: "Karen", vinculadaPor: "app" }] });
  assert.equal(antiga.maquinaLimite, null);
  assert.deepEqual(antiga.maquinas, [{ id: M, apelido: "Karen", vinculadaPor: "app", proAte: null, desvinculadaEm: null }]);
  for (const ruim of [0, -1, 1.5, "2", null]) assert.equal(parseContaInfo({ ...base, maquinaLimite: ruim }).maquinaLimite, null, String(ruim));
});
