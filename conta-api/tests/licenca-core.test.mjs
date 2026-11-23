// Licença da conta assinada para uma máquina, a parte pura: payload, assinatura Ed25519 e a conta das vagas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { createRequire } from "node:module";
import { DEVICE_LIMITE_NA_MAQUINA, LICENCA_KID, LICENCA_VALIDADE_MS, TROCAS_NA_HORA, MAQUINA_LIMITE_MAX, abreVagaNaHora, admitirMaquina, cabeNoLimite, limiteComExtras, assinarLicenca, licencaJsonV2, licencaParaMaquina, montarPayload, ocupaVaga, valeAte, validaApelido } from "../dist/licenca-core.js";
import { validaPatchLicenca } from "../dist/sessao-core.js";

const AGORA = Date.parse("2026-11-18T12:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;
const CONTA = { id: "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", email: "ana@exemplo.com", nome: "não entra no payload" };
const MAQ = "5d2c1c0a-3f1b-4a52-8b8e-1f2a3b4c5d6e";
const OUTRA = "7e3d2d1b-4a2c-4b63-9c9f-2a3b4c5d6e7f";
const PRO = { plan: "pro", status: "active", interval: "month", memberSince: "2026-10-01T00:00:00.000Z", trialEnd: null, expiresAt: "2026-12-18T12:00:00.000Z", deviceLimit: 1, produtos: ["meu-bot-finance"], pagamento: null, updatedAt: "2026-11-18T00:00:00.000Z", updatedBy: "system" };
const chaves = () => { const { publicKey, privateKey } = generateKeyPairSync("ed25519"); return { publica: publicKey, privada: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") }; };
const deB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

test("payload: a licença da conta para UMA máquina, com 30 dias de validade e só id e status dos devices", () => {
  const p = montarPayload(CONTA, MAQ, PRO, [{ id: "a1b2c3d4e5f6", status: "active", name: "Mac da Ana" }, { id: OUTRA, status: "pending" }, { id: "0123456789ab", status: "qualquer" }], AGORA);
  assert.deepEqual(p.conta, { id: CONTA.id, email: CONTA.email });
  assert.equal(p.v, 2); assert.equal(p.maquina, MAQ);
  assert.equal(p.emitidaEm, "2026-11-18T12:00:00.000Z");
  assert.equal(Date.parse(p.exp) - Date.parse(p.emitidaEm), LICENCA_VALIDADE_MS);
  assert.deepEqual(p.devices, [{ id: "a1b2c3d4e5f6", status: "active" }, { id: OUTRA, status: "pending" }, { id: "0123456789ab", status: "active" }]);
  assert.deepEqual(p.licenca, PRO);
});

test("assinatura: Ed25519 sobre os bytes exatos do payload, no formato que o app e o backend conferem", async () => {
  const k = chaves();
  const p = montarPayload(CONTA, MAQ, PRO, [], AGORA);
  const a = await assinarLicenca(p, k.privada);
  assert.equal(a.kid, LICENCA_KID);
  assert.match(a.payload, /^[A-Za-z0-9_-]+$/);
  assert.match(a.sig, /^[A-Za-z0-9+/]{86}==$/, "64 bytes em base64, como parseLicencaAssinada do app exige");
  const bytes = deB64url(a.payload);
  assert.deepEqual(JSON.parse(bytes.toString("utf8")), p);
  assert.equal(verify(null, bytes, k.publica, Buffer.from(a.sig, "base64")), true);
  assert.equal(verify(null, Buffer.from(bytes.toString("utf8").replace('"pro"', '"PRO"')), k.publica, Buffer.from(a.sig, "base64")), false, "payload mexido não confere");
  assert.equal(verify(null, bytes, chaves().publica, Buffer.from(a.sig, "base64")), false, "outra chave não confere");
  await assert.rejects(assinarLicenca(p, "bm9wZQ=="), "chave que não é PKCS#8 Ed25519 lança (a rota responde 503)");
});

test("arquivo: a cópia legível no topo e o bloco assinado", async () => {
  const p = montarPayload(CONTA, MAQ, PRO, [], AGORA);
  const a = await assinarLicenca(p, chaves().privada);
  const f = licencaJsonV2(p, a);
  assert.equal(f.plan, "pro"); assert.equal(f.v, 2); assert.equal(f.maquina, MAQ); assert.equal(f.exp, p.exp);
  assert.deepEqual(f.assinada, a);
});

test("vaga: vinculada ocupa; desvinculada pelo console ocupa até a última emissão vencer", () => {
  const emitida = new Date(AGORA - 10 * DIA).toISOString();
  assert.equal(valeAte(emitida), new Date(AGORA + 20 * DIA).toISOString());
  assert.equal(valeAte(null), null);
  assert.equal(ocupaVaga({ id: MAQ, ultimaEmissaoEm: emitida, desvinculadaEm: null }, AGORA), true);
  assert.equal(ocupaVaga({ id: MAQ, ultimaEmissaoEm: emitida, desvinculadaEm: new Date(AGORA - DIA).toISOString() }, AGORA), true, "a licença ainda vale lá por 20 dias");
  assert.equal(ocupaVaga({ id: MAQ, ultimaEmissaoEm: new Date(AGORA - 31 * DIA).toISOString(), desvinculadaEm: new Date(AGORA - 5 * DIA).toISOString() }, AGORA), false, "venceu: a vaga abriu");
  assert.equal(ocupaVaga({ id: MAQ, ultimaEmissaoEm: null, desvinculadaEm: new Date(AGORA).toISOString() }, AGORA), false);
});

test("admissão: a mesma máquina renova, nova entra com vaga, sem vaga diz quem ocupa", () => {
  const viva = { id: MAQ, ultimaEmissaoEm: new Date(AGORA - DIA).toISOString(), desvinculadaEm: null };
  assert.deepEqual(admitirMaquina([], MAQ, 1, AGORA), { acao: "vincular" });
  assert.deepEqual(admitirMaquina([viva], MAQ, 1, AGORA), { acao: "renovar" });
  const cheio = admitirMaquina([viva], OUTRA, 1, AGORA);
  assert.equal(cheio.noLimite, true); assert.deepEqual(cheio.ocupadas, [MAQ]); assert.match(cheio.erro, /outra máquina/);
  assert.deepEqual(admitirMaquina([viva], OUTRA, 2, AGORA), { acao: "vincular" }, "o admin subiu o limite");
  // Tirada pelo console ontem: segura a vaga, então outra máquina não entra, mas ela mesma volta sem gastar outra.
  const presa = { ...viva, desvinculadaEm: new Date(AGORA - 60_000).toISOString() };
  assert.equal(admitirMaquina([presa], OUTRA, 1, AGORA).noLimite, true, "alternar o vínculo não dá duas máquinas");
  assert.deepEqual(admitirMaquina([presa], MAQ, 1, AGORA), { acao: "vincular" });
  const vencida = { id: MAQ, ultimaEmissaoEm: new Date(AGORA - 40 * DIA).toISOString(), desvinculadaEm: new Date(AGORA - 35 * DIA).toISOString() };
  assert.deepEqual(admitirMaquina([vencida], OUTRA, 1, AGORA), { acao: "vincular" });
});

test("tirar: a vaga abre na hora só se o app apagou o arquivo e a conta ainda tem trocas no período", () => {
  assert.equal(abreVagaNaHora(true, 0), true);
  assert.equal(abreVagaNaHora(true, TROCAS_NA_HORA - 1), true);
  assert.equal(abreVagaNaHora(true, TROCAS_NA_HORA), false, "trocas esgotadas: espera a emissão vencer");
  assert.equal(abreVagaNaHora(false, 0), false, "pelo console ninguém apagou o arquivo da máquina");
});

test("apelido e limite: o que o app e o admin mandam", () => {
  assert.equal(validaApelido("  Karen "), "Karen");
  assert.equal(validaApelido(""), null); assert.equal(validaApelido(7), null); assert.equal(validaApelido("a\u0000b"), null); assert.equal(validaApelido("x".repeat(81)), null);
  assert.deepEqual(validaPatchLicenca({ maquinaLimit: 3 }), { maquinaLimit: 3 });
  assert.ok("erro" in validaPatchLicenca({ maquinaLimit: 0 })); assert.ok("erro" in validaPatchLicenca({ maquinaLimit: 51 })); assert.ok("erro" in validaPatchLicenca({ maquinaLimit: "2" })); assert.ok("erro" in validaPatchLicenca({ maquinaLimit: 1.5 }));
});

test("limite de máquinas: o que o admin deu mais uma vaga por máquina extra em dia; vencida não conta; respeita o teto", () => {
  const agora = Date.parse("2026-11-19T12:00:00Z");
  const emDia = { expiresAt: "2026-12-19T12:00:00Z" }, vencida = { expiresAt: "2026-11-19T11:59:59Z" };
  assert.deepEqual(limiteComExtras(1, [], agora), { limite: 1, extras: 0, cortesias: 0 });
  assert.deepEqual(limiteComExtras(1, [emDia], agora), { limite: 2, extras: 1, cortesias: 0 });
  assert.deepEqual(limiteComExtras(1, [emDia, emDia, vencida], agora), { limite: 3, extras: 2, cortesias: 0 });
  assert.deepEqual(limiteComExtras(2, [vencida], agora), { limite: 2, extras: 0, cortesias: 0 });
  assert.deepEqual(limiteComExtras(0, [emDia], agora), { limite: 2, extras: 1, cortesias: 0 }, "base fora da forma vale 1");
  assert.deepEqual(limiteComExtras(1, [{ expiresAt: "lixo" }], agora), { limite: 1, extras: 0, cortesias: 0 });
  assert.equal(limiteComExtras(1, Array.from({ length: 80 }, () => emDia), agora).limite, MAQUINA_LIMITE_MAX);
});

test("renovação no limite: com mais máquinas vinculadas do que o plano cobre, renovam as mais antigas", () => {
  const m = (id, criadaEm, desvinculadaEm = null) => ({ id, criadaEm, desvinculadaEm });
  const tres = [m("b", "2026-11-02T00:00:00Z"), m("a", "2026-11-01T00:00:00Z"), m("c", "2026-11-03T00:00:00Z")];
  assert.equal(cabeNoLimite(tres, "c", 3), true, "dentro do limite todas renovam");
  assert.equal(cabeNoLimite(tres, "a", 2), true);
  assert.equal(cabeNoLimite(tres, "b", 2), true);
  assert.equal(cabeNoLimite(tres, "c", 2), false, "a máquina extra venceu: a que entrou por último não renova");
  assert.equal(cabeNoLimite(tres, "a", 1), true);
  assert.equal(cabeNoLimite(tres, "b", 1), false);
  // Máquina tirada pelo console não disputa a renovação, mesmo sendo a mais antiga.
  const comTirada = [m("a", "2026-11-01T00:00:00Z", "2026-11-10T00:00:00Z"), m("b", "2026-11-02T00:00:00Z"), m("c", "2026-11-03T00:00:00Z")];
  assert.equal(cabeNoLimite(comTirada, "c", 2), true);
  assert.equal(cabeNoLimite(comTirada, "a", 2), false, "desvinculada não renova");
  assert.equal(cabeNoLimite(tres, "z", 3), false, "máquina que não é da conta");
});

test("todo plano inclui 2 devices", async () => {
  const { DEVICES_INCLUSOS } = await import("../dist/licenca-core.js");
  assert.equal(DEVICES_INCLUSOS, 2);
});

test("super admin: a licença assinada leva o teto de devices que a máquina aceita; o resto leva o número gravado", () => {
  const be = createRequire(import.meta.url)("../../backend-colima/licenca.js");
  const gravada = { ...PRO, deviceLimit: 2 };
  const doSuper = licencaParaMaquina(gravada, "super");
  assert.equal(doSuper.deviceLimit, DEVICE_LIMITE_NA_MAQUINA);
  assert.equal(gravada.deviceLimit, 2, "a licença gravada não muda");
  assert.equal(licencaParaMaquina(gravada, "admin").deviceLimit, 2);
  assert.equal(licencaParaMaquina(gravada, null).deviceLimit, 2);
  // O teto é o da máquina: um a mais e ela ignoraria o número e voltaria a 1.
  assert.equal(be.parseLicense(doSuper).deviceLimit, DEVICE_LIMITE_NA_MAQUINA);
  assert.equal(be.parseLicense({ ...gravada, deviceLimit: DEVICE_LIMITE_NA_MAQUINA + 1 }).deviceLimit, 1);
  // O 3º computador do super entra na máquina; com o número gravado ficaria esperando vaga.
  const dois = { "a1b2c3d4e5f6": { status: "active", firstSeen: "2026-11-01T00:00:00.000Z" }, "0123456789ab": { status: "active", firstSeen: "2026-11-02T00:00:00.000Z" }, "fedcba987654": { status: "pending", firstSeen: "2026-11-03T00:00:00.000Z" } };
  assert.equal(be.admitDevice(doSuper, dois, "fedcba987654"), "active");
  assert.equal(be.admitDevice(gravada, dois, "fedcba987654"), "pending");
});
