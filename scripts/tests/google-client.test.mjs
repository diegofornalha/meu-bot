import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoSemGoogle, decideGoogleConta } from "../google-client.mjs";

const base = { admin: false, existe: false, semGoogle: false, release: false };

test("com o arquivo, ou no admin, não há o que avisar", () => {
  assert.equal(decideGoogleConta({ ...base, existe: true, release: true }), "ok");
  assert.equal(decideGoogleConta({ ...base, admin: true, release: true }), "ok");
});
test("cliente sem o arquivo: aviso no build local, falha no release", () => {
  assert.equal(decideGoogleConta(base), "aviso");
  assert.equal(decideGoogleConta({ ...base, release: true }), "falha");
});
test("--sem-google permite, até no release", () => {
  assert.equal(decideGoogleConta({ ...base, semGoogle: true, release: true }), "permitido");
});
test("o aviso cita o app e o arquivo que falta", () => {
  const a = avisoSemGoogle("meu-bot-staging");
  assert.match(a, /meu-bot-staging vai ficar SEM Conta Google/);
  assert.match(a, /config\/google-conta-oauth\.json/);
});
