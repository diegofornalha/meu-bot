// Contas de teste do staging (scripts/staging-contas.mjs): as travas do endereço, os patches de cada estado e o plano.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AJUDA, API_STAGING, DIAS_PRO_PAGO, ESTADOS, VAR_TOKEN, diasDoStaging, emailsDeTeste, lerArgumentos, noEstado, patchesDosEstados, planejar, saudeDeStaging, validarApi } from "../staging-contas.mjs";

const AGORA = Date.parse("2026-11-19T12:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;
const dias = { trialDias: 3, promoDias: 3 };
const patches = patchesDosEstados({ agoraMs: AGORA, ...dias });
const SCRIPT = fileURLToPath(new URL("../staging-contas.mjs", import.meta.url));

test("staging-contas: só o endereço da API de staging passa", () => {
  assert.deepEqual(validarApi(API_STAGING), { ok: true, origem: API_STAGING });
  assert.equal(validarApi(`${API_STAGING}/`).ok, true);
  for (const ruim of ["https://conta.agentesgrok.com", "http://conta-staging.agentesgrok.com", "https://conta-staging.agentesgrok.com:8443", "https://conta-staging.agentesgrok.com.evil.com", "https://x@conta-staging.agentesgrok.com", "https://conta-staging.agentesgrok.com@conta.agentesgrok.com", "https://conta-staging.agentesgrok.com/admin", "https://conta-staging.agentesgrok.com/?x=1", "https://console-staging.agentesgrok.com", "http://localhost:8787", "conta-staging.agentesgrok.com", "", null, undefined]) {
    assert.match(validarApi(ruim).erro ?? "", /staging|endereço/, String(ruim));
  }
});

test("staging-contas: o /health tem de dizer canal staging", () => {
  assert.deepEqual(saudeDeStaging({ ok: true, canal: "staging", commit: null }), { ok: true });
  assert.match(saudeDeStaging({ ok: true, canal: "producao" }).erro, /canal "producao"/);
  assert.match(saudeDeStaging({ ok: true }).erro, /canal "undefined"/);
  assert.ok(saudeDeStaging({ ok: false, canal: "staging" }).erro);
  assert.ok(saudeDeStaging(null).erro);
});

test("staging-contas: os e-mails de teste saem do e-mail-base, um por estado", () => {
  const r = emailsDeTeste(" Voce@Gmail.com ");
  assert.deepEqual(r.emails, { teste: "voce+mb-staging-teste@gmail.com", "teste-vencido": "voce+mb-staging-teste-vencido@gmail.com", "promo-vencida": "voce+mb-staging-promo-vencida@gmail.com", "pro-pago": "voce+mb-staging-pro-pago@gmail.com" });
  assert.deepEqual(Object.keys(r.emails), ESTADOS);
  for (const ruim of ["voce+outro@gmail.com", "sem-arroba", "a@b", "", null]) assert.ok(emailsDeTeste(ruim).erro, String(ruim));
});

test("staging-contas: os dias vêm do staging no wrangler.toml de verdade", () => {
  const toml = readFileSync(new URL("../../conta-api/wrangler.toml", import.meta.url), "utf8");
  const d = diasDoStaging(toml);
  assert.equal(d.ok, true);
  assert.ok(d.trialDias >= 1 && d.promoDias >= 1);
  assert.match(diasDoStaging('[env.staging.vars]\nTRIAL_DIAS = "0"\nPROMO_DIAS = "3"\n').erro, /TRIAL_DIAS/);
  assert.match(diasDoStaging('[env.staging.vars]\nTRIAL_DIAS = "3"\n').erro, /PROMO_DIAS/);
  // Só o staging conta: os dias da produção não entram.
  assert.match(diasDoStaging('[vars]\nTRIAL_DIAS = "3"\nPROMO_DIAS = "3"\n').erro, /TRIAL_DIAS/);
});

test("staging-contas: os patches de cada estado, a partir de agora", () => {
  assert.deepEqual(patches.teste, { plan: "pro", status: "trialing", interval: null, trialEnd: "2026-11-22T12:00:00.000Z", expiresAt: "2026-11-22T12:00:00.000Z" });
  assert.equal(patches["teste-vencido"].trialEnd, "2026-11-18T12:00:00.000Z");
  assert.equal(patches["teste-vencido"].expiresAt, patches["teste-vencido"].trialEnd);
  assert.equal(patches["promo-vencida"].trialEnd, "2026-11-15T12:00:00.000Z");
  assert.deepEqual(patches["pro-pago"], { plan: "pro", status: "active", interval: "month", trialEnd: null, expiresAt: new Date(AGORA + DIAS_PRO_PAGO * DIA).toISOString() });
  assert.equal(patchesDosEstados({ agoraMs: AGORA, trialDias: 14, promoDias: 7 })["promo-vencida"].trialEnd, "2026-11-11T12:00:00.000Z");
});

test("staging-contas: noEstado confere pelo sentido, e o estado aplicado continua valendo horas depois", () => {
  const ctx = { agoraMs: AGORA + 6 * 60 * 60 * 1000, promoDias: dias.promoDias };
  for (const estado of ESTADOS) for (const outro of ESTADOS) assert.equal(noEstado(patches[outro], estado, ctx), estado === outro, `${outro} visto como ${estado}`);
  // O teste vencido ontem deixa de ser "teste-vencido" quando o prazo da promoção passa: precisa aplicar de novo.
  assert.equal(noEstado(patches["teste-vencido"], "teste-vencido", { agoraMs: AGORA + 3 * DIA, promoDias: 3 }), false);
  assert.equal(noEstado(patches["teste-vencido"], "promo-vencida", { agoraMs: AGORA + 3 * DIA, promoDias: 3 }), true);
  for (const lixo of [null, undefined, {}, { plan: "free", status: "free", trialEnd: null, expiresAt: null }]) for (const estado of ESTADOS) assert.equal(noEstado(lixo, estado, ctx), false);
});

test("staging-contas: o plano só toca o e-mail exato, e nunca uma conta com perfil de acesso", () => {
  const { emails } = emailsDeTeste("voce@gmail.com");
  const id = (n) => `5d5c0bcd-a92c-441a-854d-27bf7cae1f1${n}`;
  const contas = [
    { id: id(1), email: emails.teste, admin: null, licenca: patches["pro-pago"] },
    { id: id(2), email: emails["teste-vencido"], admin: "admin", licenca: patches.teste },
    { id: id(3), email: `x${emails["promo-vencida"]}`, admin: null, licenca: patches.teste },
    { id: id(4), email: "voce@gmail.com", admin: "super", licenca: patches.teste },
    { id: "nao-e-uuid", email: emails["pro-pago"], admin: null, licenca: patches["pro-pago"] },
  ];
  const plano = planejar({ contas, emails, patches, agoraMs: AGORA, promoDias: 3 });
  assert.deepEqual(plano.map((p) => [p.estado, p.situacao]), [["teste", "existe"], ["teste-vencido", "pulada"], ["promo-vencida", "falta"], ["pro-pago", "pulada"]]);
  assert.deepEqual({ id: plano[0].id, noEstado: plano[0].noEstado, patch: plano[0].patch }, { id: id(1), noEstado: false, patch: patches.teste });
  assert.deepEqual(planejar({ contas: null, emails, patches, agoraMs: AGORA, promoDias: 3 }).map((p) => p.situacao), ["falta", "falta", "falta", "falta"]);
});

test("staging-contas: argumentos: um modo só, e nada que pareça token por argumento", () => {
  assert.deepEqual(lerArgumentos(["--api", API_STAGING, "--base", "a@b.co", "--listar"]), { modo: "listar", api: API_STAGING, base: "a@b.co" });
  assert.equal(lerArgumentos(["--aplicar", "--api", API_STAGING, "--base", "a@b.co"]).modo, "aplicar");
  assert.match(lerArgumentos(["--listar", "--aplicar"]).erro, /escolha um/);
  assert.match(lerArgumentos(["--api", API_STAGING]).erro, /escolha um/);
  assert.match(lerArgumentos(["--listar", "--token", "abc"]).erro, /desconhecido.*nunca por argumento/);
  assert.match(lerArgumentos(["--listar", "solto"]).erro, /valor solto/);
  assert.equal(lerArgumentos(["--listar", "--api"]).api, null);
  assert.deepEqual(lerArgumentos(["--help"]), { ajuda: true });
});

test("staging-contas: o --help diz o passo humano e de onde vem o token", () => {
  for (const pedaco of [VAR_TOKEN, "link por e-mail", "meu-bot-console-sessao", "+mb-staging-teste-vencido@", API_STAGING]) assert.ok(AJUDA.includes(pedaco), pedaco);
});

test("staging-contas: rodando de verdade, recusa outro endereço e a falta do token antes de qualquer pedido à rede", () => {
  const rodar = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
  const segredo = "tokendeteste.aaaaaaaaaaaaaaaaaaaa.bbbbbbbb";
  const producao = rodar(["--api", "https://conta.agentesgrok.com", "--base", "voce@gmail.com", "--aplicar"], { [VAR_TOKEN]: segredo });
  assert.equal(producao.status, 1);
  assert.match(producao.stderr, /conta\.agentesgrok\.com não é o staging/);
  assert.ok(!`${producao.stdout}${producao.stderr}`.includes(segredo), "o token não aparece na saída");
  const semToken = rodar(["--api", API_STAGING, "--base", "voce@gmail.com", "--listar"]);
  assert.equal(semToken.status, 1);
  assert.match(semToken.stderr, new RegExp(`falta o token.*${VAR_TOKEN}`));
  const porArgumento = rodar(["--api", API_STAGING, "--base", "voce@gmail.com", "--listar", "--token", segredo]);
  assert.equal(porArgumento.status, 1);
  assert.ok(!`${porArgumento.stdout}${porArgumento.stderr}`.includes(segredo));
  assert.equal(rodar(["--help"]).status, 0);
});
