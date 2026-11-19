// Contas de teste do staging (scripts/staging-contas.mjs) contra as regras do servidor: o que o script manda ao
// PATCH /admin/contas/:id/licenca passa pela validação de verdade, e cada estado tem a promoção que o servidor daria.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ESTADOS, noEstado, patchesDosEstados } from "../../scripts/staging-contas.mjs";
import { direitoPromo } from "../dist/pagamento-core.js";
import { validaPatchLicenca } from "../dist/sessao-core.js";

const AGORA = Date.parse("2026-11-19T12:00:00.000Z");
const PROMO_DIAS = 3;
const patches = patchesDosEstados({ agoraMs: AGORA, trialDias: 3, promoDias: PROMO_DIAS });

test("contas de teste do staging: a API de admin aceita cada patch como está", () => {
  for (const estado of ESTADOS) assert.deepEqual(validaPatchLicenca(patches[estado]), patches[estado], estado);
});

test("contas de teste do staging: só o teste vencido ontem tem direito à promoção", () => {
  const direito = (estado, agoraMs = AGORA) => direitoPromo({ licenca: patches[estado], jaPagouPro: false, agoraMs, promoDias: PROMO_DIAS, cupom: "PRIMEIROMES1" });
  assert.equal(direito("teste"), null, "teste em vigor: preço cheio");
  assert.deepEqual(direito("teste-vencido"), { ate: "2026-11-21T12:00:00.000Z" }, "promoção por mais 2 dias");
  assert.equal(direito("promo-vencida"), null, "prazo da promoção vencido");
  assert.equal(direito("pro-pago"), null, "Pro ativo: nada a oferecer");
  // Quem já pagou o Pro não vê a promoção, mesmo no estado certo: o script não apaga pagamentos.
  assert.equal(direitoPromo({ licenca: patches["teste-vencido"], jaPagouPro: true, agoraMs: AGORA, promoDias: PROMO_DIAS, cupom: "PRIMEIROMES1" }), null);
});

test("contas de teste do staging: noEstado e o direito à promoção concordam ao longo do tempo", () => {
  const DIA = 24 * 60 * 60 * 1000;
  for (const horas of [0, 1, 24, 47, 48, 49, 72]) {
    const agoraMs = AGORA + horas * 60 * 60 * 1000;
    const tem = direitoPromo({ licenca: patches["teste-vencido"], jaPagouPro: false, agoraMs, promoDias: PROMO_DIAS, cupom: "X" }) !== null;
    assert.equal(noEstado(patches["teste-vencido"], "teste-vencido", { agoraMs, promoDias: PROMO_DIAS }), tem, `${horas} h depois`);
  }
  assert.equal(noEstado(patches["teste-vencido"], "promo-vencida", { agoraMs: AGORA + 3 * DIA, promoDias: PROMO_DIAS }), true);
});
