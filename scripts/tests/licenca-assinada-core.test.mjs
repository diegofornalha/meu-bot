// Licença da conta assinada: o app (dist) e o backend da máquina (backend-colima/licenca.js) verificam igual, com as
// mesmas chaves públicas; a assinatura cobre os bytes exatos do payload; o que não confere, venceu ou é de outra
// máquina não passa em nenhum dos dois.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateKeyPairSync } from "node:crypto";

const req = createRequire(import.meta.url);
const app = req("../../dist/main/conta/licenca-assinada-core.js");
const be = req("../../backend-colima/licenca.js");
const { assinarLicenca, verificaLicencaAssinada, parsePayloadLicenca, viewDaAssinada, maisNova, licencaJsonV2, deBase64url, base64url, LICENCA_PUBLIC_KEYS, LICENCA_VALIDADE_MS, DEVICE_ID_RE, UUID_RE } = app;

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const CHAVES = [{ id: "teste", chave: publicKey.export({ type: "spki", format: "der" }).toString("base64") }];
const AGORA = Date.parse("2026-11-06T12:00:00Z");
const CONTA = "11111111-1111-4111-8111-111111111111", MAQ = "22222222-2222-4222-8222-222222222222";
const DEV = "33333333-3333-4333-8333-333333333333", ALIAS = "0123456789ab";
const payload = (extra = {}) => ({
  v: 2, conta: { id: CONTA, email: "ana@exemplo.com" }, maquina: MAQ,
  emitidaEm: new Date(AGORA - 1000).toISOString(), exp: new Date(AGORA - 1000 + LICENCA_VALIDADE_MS).toISOString(),
  licenca: { plan: "pro", status: "active", interval: "month", memberSince: "2026-10-01T00:00:00.000Z", trialEnd: null, expiresAt: null, deviceLimit: 2, produtos: ["meu-bot-finance"], pagamento: null, updatedAt: "2026-11-01T00:00:00.000Z", updatedBy: "admin" },
  devices: [{ id: DEV, status: "active" }, { id: ALIAS, status: "pending" }],
  ...extra,
});
const ambos = (raw, opts) => [app.verificaLicencaAssinada(raw, opts), be.verificaLicencaAssinada(raw, opts)];

test("as chaves públicas embutidas são as mesmas no app e no backend, e são SPKI de Ed25519", () => {
  assert.deepEqual(be.LICENCA_PUBLIC_KEYS, LICENCA_PUBLIC_KEYS);
  assert.ok(LICENCA_PUBLIC_KEYS.length >= 1);
  for (const k of LICENCA_PUBLIC_KEYS) assert.match(k.chave, /^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/, `${k.id}: SPKI de uma chave Ed25519`);
  assert.equal(String(be.DEVICE_ID_RE), String(DEVICE_ID_RE)); assert.equal(String(be.UUID_RE), String(UUID_RE));
});

test("assina e verifica: o payload volta inteiro, com a licença normalizada e os devices", () => {
  const p = payload();
  const assinada = assinarLicenca(p, privateKey, "teste");
  assert.equal(JSON.parse(deBase64url(assinada.payload).toString("utf8")).conta.email, "ana@exemplo.com");
  for (const r of ambos({ assinada }, { chaves: CHAVES, now: AGORA })) {
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.kid, "teste");
    assert.equal(r.payload.licenca.plan, "pro"); assert.deepEqual(r.payload.licenca.produtos, ["meu-bot-finance"]);
    assert.deepEqual(r.payload.devices, p.devices); assert.equal(r.payload.maquina, MAQ);
  }
  // O bloco sozinho e o licenca.json inteiro (v2) valem igual.
  for (const r of ambos(assinada, { chaves: CHAVES, now: AGORA })) assert.equal(r.ok, true);
  for (const r of ambos(licencaJsonV2(p, assinada), { chaves: CHAVES, now: AGORA, maquina: MAQ })) assert.equal(r.ok, true);
});

test("o que não passa: sem bloco, formato, assinatura adulterada ou de outra chave, vencida, outra máquina", () => {
  const p = payload();
  const assinada = assinarLicenca(p, privateKey, "teste");
  const motivo = (raw, opts) => ambos(raw, { chaves: CHAVES, now: AGORA, ...opts }).map((r) => (r.ok ? "ok" : r.motivo));
  assert.deepEqual(motivo({ plan: "pro" }), ["sem-assinatura", "sem-assinatura"], "licenca.json v1 (legado) não tem bloco");
  assert.deepEqual(motivo(null), ["sem-assinatura", "sem-assinatura"]);
  assert.deepEqual(motivo({ assinada: { kid: "teste", payload: assinada.payload } }), ["formato", "formato"], "sem sig");
  assert.deepEqual(motivo({ assinada: { ...assinada, payload: `${assinada.payload}AA` } }), ["assinatura", "assinatura"], "payload mexido");
  const outra = generateKeyPairSync("ed25519").privateKey;
  assert.deepEqual(motivo({ assinada: assinarLicenca(p, outra, "teste") }), ["assinatura", "assinatura"], "outra chave");
  assert.deepEqual(motivo({ assinada }, { chaves: LICENCA_PUBLIC_KEYS }), ["assinatura", "assinatura"], "a chave de teste não é a embutida");
  assert.deepEqual(motivo({ assinada }, { now: AGORA + LICENCA_VALIDADE_MS + 1 }), ["expirada", "expirada"]);
  assert.deepEqual(motivo({ assinada }, { maquina: DEV }), ["formato", "formato"], "licença de outra máquina");
  // Payload assinado mas fora do formato da API: assinatura ok, conteúdo não.
  const ruim = assinarLicenca({ ...p, devices: [{ id: "zz", status: "active" }] }, privateKey, "teste");
  assert.deepEqual(motivo({ assinada: ruim }), ["formato", "formato"]);
  const semV = assinarLicenca({ ...p, v: 1 }, privateKey, "teste");
  assert.deepEqual(motivo({ assinada: semV }), ["formato", "formato"]);
});

test("kid desconhecido: tenta todas as chaves aceitas (troca de chave sem reinstalar)", () => {
  const assinada = assinarLicenca(payload(), privateKey, "futura");
  for (const r of ambos({ assinada }, { chaves: CHAVES, now: AGORA })) assert.equal(r.ok, true);
});

test("parsePayloadLicenca: campos obrigatórios e exp antes de emitidaEm", () => {
  for (const parse of [parsePayloadLicenca, be.parsePayloadLicenca]) {
    assert.ok(parse(payload()));
    assert.equal(parse(payload({ conta: { id: "x", email: "a@b" } })), null);
    assert.equal(parse(payload({ maquina: "abc" })), null);
    assert.equal(parse(payload({ exp: "2020-01-01T00:00:00Z" })), null, "exp antes de emitidaEm");
    assert.equal(parse(payload({ devices: "nenhum" })), null);
    assert.equal(parse(payload({ licenca: null })), null);
  }
});

test("viewDaAssinada: status dos devices vem do payload; nome e apps da telemetria da máquina", () => {
  const p = payload();
  const tele = [{ id: DEV, name: "Mac da Ana", user: "ana", platform: "darwin", app: "meu-bot", firstSeen: "2026-10-01T00:00:00.000Z", lastSeen: "2026-11-05T00:00:00.000Z", status: "pending", requestedAt: "2026-11-05T00:00:00.000Z", apps: { "meu-bot": { version: "0.79.0", lastSeen: "2026-11-05T00:00:00.000Z" } } }];
  const v = viewDaAssinada(p, tele, AGORA);
  assert.equal(v.license.plan, "pro"); assert.equal(v.deviceLimit, 2);
  assert.equal(v.activeCount, 1); assert.equal(v.pendingCount, 1);
  const d = v.devices.find((x) => x.id === DEV);
  assert.equal(d.status, "active", "a API manda: ativo mesmo com a telemetria dizendo pendente");
  assert.equal(d.name, "Mac da Ana"); assert.equal(d.apps["meu-bot"].version, "0.79.0"); assert.equal(d.requestedAt, null);
  const a = v.devices.find((x) => x.id === ALIAS);
  assert.equal(a.status, "pending"); assert.equal(a.name, "", "device que só a API conhece entra sem nome");
});

test("maisNova e base64url", () => {
  const velha = payload(), nova = payload({ emitidaEm: new Date(AGORA).toISOString() });
  assert.equal(maisNova(nova, velha), true); assert.equal(maisNova(velha, nova), false); assert.equal(maisNova(velha, velha), false);
  const b = Buffer.from([251, 255, 191, 0, 1]);
  assert.equal(deBase64url(base64url(b)).equals(b), true);
  assert.equal(deBase64url("a+b"), null, "base64 comum não é base64url");
});

// ---- A licença em vigor na máquina: a do admin (licenca.json) somada à da conta (licenca-conta.json assinado).
const DIA = 24 * 60 * 60 * 1000;
const FREE = { plan: "free", status: "free", interval: null, memberSince: "2026-10-01T00:00:00.000Z", trialEnd: null, expiresAt: null, deviceLimit: 3, produtos: [], pagamento: { instrucoes: "Pix do admin", link: null }, updatedAt: "2026-11-01T00:00:00.000Z", updatedBy: "admin" };
const lic = (extra = {}) => ({ ...payload().licenca, ...extra });
const arquivo = (extra = {}) => { const p = payload(extra); return licencaJsonV2(p, assinarLicenca(p, privateKey, "teste")); };
/** A regra nos dois lados, exigindo a mesma resposta. */
const emVigor = (admin, conta, maquina = MAQ, now = AGORA) => {
  const a = app.licencaEmVigor(admin, conta, maquina, { chaves: CHAVES, now });
  assert.deepEqual(be.licencaEmVigor(admin, conta, maquina, { chaves: CHAVES, now }), a, "o backend decide igual ao app");
  return a;
};

test("em vigor: sem licença da conta (ou sem id da máquina) vale só a do admin", () => {
  for (const conta of [null, undefined, {}, "x", { assinada: null }]) assert.deepEqual(emVigor(FREE, conta), { license: FREE, origem: "admin", exp: null });
  assert.equal(emVigor(FREE, arquivo(), null).origem, "admin", "máquina sem maquina.json não tem a quem a licença pertencer");
  assert.equal(emVigor(FREE, arquivo(), "nao-e-uuid").origem, "admin");
});

test("em vigor: o Pro da conta entra numa máquina que o admin deixou free, com o limite e o pagamento do admin", () => {
  const r = emVigor(FREE, arquivo());
  assert.equal(r.origem, "conta"); assert.equal(r.license.plan, "pro"); assert.equal(r.license.status, "active");
  assert.equal(r.license.deviceLimit, 3, "o limite de devices é desta máquina: segue o do admin");
  assert.deepEqual(r.license.pagamento, FREE.pagamento);
  assert.deepEqual(r.license.produtos, ["meu-bot-finance"]);
  assert.equal(r.exp, payload().exp);
  assert.equal(be.proOk(r.license, AGORA), true); assert.equal(be.crmOk(r.license, AGORA), true); assert.equal(be.financeOk(r.license, AGORA), true);
});

test("em vigor: o que não confere não dá Pro (assinatura mexida, outra máquina, emissão vencida, outra chave)", () => {
  const bom = arquivo();
  const mexido = { ...bom, assinada: { ...bom.assinada, payload: base64url(Buffer.from(JSON.stringify({ ...payload(), licenca: lic({ produtos: ["meu-bot-finance", "meu-bot-diego"] }) }))) } };
  assert.equal(emVigor(FREE, mexido).origem, "admin");
  assert.equal(emVigor(FREE, { ...bom, plan: "pro" , assinada: undefined }).license.plan, "free", "a cópia legível no topo não vale nada sem o bloco");
  assert.equal(emVigor(FREE, bom, "44444444-4444-4444-8444-444444444444").origem, "admin", "copiada para outra máquina");
  assert.equal(emVigor(FREE, bom, MAQ, AGORA + LICENCA_VALIDADE_MS + DIA).origem, "admin", "30 dias sem renovar");
  const outra = generateKeyPairSync("ed25519").privateKey;
  const p = payload(); assert.equal(emVigor(FREE, licencaJsonV2(p, assinarLicenca(p, outra, "teste"))).origem, "admin");
});

test("em vigor: Pro do admin continua valendo, e os add-ons se somam", () => {
  const adminPro = { ...FREE, plan: "pro", status: "active", produtos: ["meu-bot-diego"] };
  const r = emVigor(adminPro, arquivo());
  assert.equal(r.origem, "admin"); assert.equal(r.license.plan, "pro"); assert.equal(r.exp, null);
  assert.deepEqual(r.license.produtos, ["meu-bot-diego", "meu-bot-finance"]);
  // A conta ficou free (cancelou): a máquina segue com o que o admin deu, sem perder nada.
  const semPro = emVigor(adminPro, arquivo({ licenca: lic({ plan: "free", status: "free", produtos: [] }) }));
  assert.equal(semPro.origem, "admin"); assert.equal(be.proOk(semPro.license, AGORA), true);
  assert.deepEqual(semPro.license.produtos, ["meu-bot-diego"]);
});

test("em vigor: Pro vencido na conta não libera, e licença vencida não empresta add-on", () => {
  const venceu = arquivo({ licenca: lic({ expiresAt: new Date(AGORA - DIA).toISOString() }) });
  const r = emVigor(FREE, venceu);
  assert.equal(r.origem, "admin"); assert.equal(be.proOk(r.license, AGORA), false);
  assert.deepEqual(r.license.produtos, [], "o add-on de uma licença vencida não passa para a outra");
  // Admin deixou vencer; a conta está em dia: vale a da conta.
  const adminVencido = { ...FREE, plan: "pro", status: "expired", produtos: ["meu-bot-diego"] };
  const s = emVigor(adminVencido, arquivo());
  assert.equal(s.origem, "conta"); assert.equal(be.proOk(s.license, AGORA), true); assert.deepEqual(s.license.produtos, ["meu-bot-finance"]);
  // Conta free com um add-on pago, admin vencido: o add-on vale.
  const soAddon = emVigor(adminVencido, arquivo({ licenca: lic({ plan: "free", status: "free" }) }));
  assert.equal(soAddon.origem, "conta"); assert.equal(be.proOk(soAddon.license, AGORA), false); assert.equal(be.financeOk(soAddon.license, AGORA), true);
  // Conta free com add-on, admin free em dia: o add-on se soma e o plano segue o do admin.
  const soma = emVigor(FREE, arquivo({ licenca: lic({ plan: "free", status: "free" }) }));
  assert.equal(soma.origem, "admin"); assert.deepEqual(soma.license.produtos, ["meu-bot-finance"]); assert.equal(be.financeOk(soma.license, AGORA), true);
});
