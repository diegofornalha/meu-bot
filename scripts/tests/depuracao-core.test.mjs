import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoBatimento, linhaEvento, rotuloBuild, rotuloReversos, rotuloTunel, textoSaude } from "../../dist/renderer/lib/depuracao-core.js";

test("batimento: ok até 3 s sem tique; depois conta os segundos; sem tique nenhum é 'não ok' com 0 s", () => {
  assert.deepEqual(estadoBatimento(10_000, 12_999), { ok: true, segundos: 2 });
  assert.deepEqual(estadoBatimento(10_000, 13_000), { ok: false, segundos: 3 });
  assert.deepEqual(estadoBatimento(10_000, 22_500), { ok: false, segundos: 12 });
  assert.deepEqual(estadoBatimento(null, 5), { ok: false, segundos: 0 });
  assert.deepEqual(estadoBatimento(10_000, 9_000), { ok: true, segundos: 0 }, "relógio atrasado não vira travamento");
  assert.equal(estadoBatimento(10_000, 14_000, 5000).ok, true, "limiar configurável");
  assert.equal(textoSaude({ ok: true, segundos: 0 }, "x"), "main ok");
  assert.equal(textoSaude({ ok: false, segundos: 12 }, "contaStatus(meu-root-root)"), "main sem responder há 12 s · última marca: contaStatus(meu-root-root)");
  assert.equal(textoSaude({ ok: false, segundos: 4 }, null), "main sem responder há 4 s");
});

test("rótulos: build com branch e commit, só versão sem build.json, 'dev' em dev; túnel; reversos", () => {
  assert.equal(rotuloBuild("0.4.0", { commit: "18fb6f9", branch: "navegador-recarrega-aba-ao-fechar" }), "v0.4.0 · navegador-recarrega-aba-ao-fechar · 18fb6f9");
  assert.equal(rotuloBuild("0.4.0", { commit: "", branch: "" }), "v0.4.0", "empacotado antes do build.json");
  assert.equal(rotuloBuild("0.4.0", null), "v0.4.0");
  assert.equal(rotuloBuild("0.4.0", { commit: "dev", branch: "dev" }), "v0.4.0 · dev");
  assert.equal(rotuloBuild("", null), "v?");
  assert.equal(rotuloTunel("ready"), "túnel ativo"); assert.equal(rotuloTunel("connecting"), "túnel conectando…"); assert.equal(rotuloTunel(null), "túnel: ?");
  // fora do "ativo" o motivo vai junto, cortado em 70 caracteres (o que a pill também mostra)
  assert.equal(rotuloTunel("degraded", "o backend desta máquina não está respondendo na porta 8083 (ECONNRESET: o túnel entrou, mas ninguém escuta nessa porta)"), "túnel instável: o backend desta máquina não está respondendo na porta 8083 (ECONNRESET");
  assert.equal(rotuloTunel("degraded", ""), "túnel instável"); assert.equal(rotuloTunel("ready", "qualquer"), "túnel ativo");
  assert.equal(rotuloTunel("connecting", "VM sem resposta; tentando de novo em 3 s (1ª vez)…"), "túnel conectando: VM sem resposta; tentando de novo em 3 s (1ª vez)…");
  assert.equal(rotuloReversos(38547, 50029), "nav :38547 · gmail :50029"); assert.equal(rotuloReversos(null, 50029), "gmail :50029"); assert.equal(rotuloReversos(null, null), "");
});

test("linha do fluxo: hora, origem, dono, rota, ✗ no erro e o resumo", () => {
  const hora = () => "15:40:02";
  assert.equal(linhaEvento({ em: 0, origem: "navegador", dono: "agente (meu-bot)", rota: "/fechar", ok: true, resumo: "fechou aba 5 → recarregou [4]" }, hora), "15:40:02 navegador (agente (meu-bot)) /fechar: fechou aba 5 → recarregou [4]");
  assert.equal(linhaEvento({ em: 0, origem: "nota", dono: null, rota: "/nota", ok: false, resumo: "x" }, hora), "15:40:02 nota /nota ✗: x");
});
