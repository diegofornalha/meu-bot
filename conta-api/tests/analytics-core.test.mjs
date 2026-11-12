// Analytics, a parte pura: lista de IDs, URL sem query/fragmento, caminho sem o slug da organização.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAVES_CAMPANHA, campanhaDaQuery, caminhoAnonimo, gaIds, paginaLimpa } from "../dist/analytics-core.js";
import { readFileSync } from "node:fs";

test("gaIds: lista separada por vírgula, aparada, sem lixo nem repetição; vazio dá []", () => {
  assert.deepEqual(gaIds("G-FCKW62SB1K"), ["G-FCKW62SB1K"]);
  assert.deepEqual(gaIds(" G-FCKW62SB1K , lixo,G-12CJ787RGJ,G-FCKW62SB1K"), ["G-FCKW62SB1K", "G-12CJ787RGJ"]);
  assert.deepEqual(gaIds("g-minusculo"), []);
  assert.deepEqual(gaIds(""), []); assert.deepEqual(gaIds(null), []); assert.deepEqual(gaIds(undefined), []);
});

test("paginaLimpa: tira query e fragmento (code, state, verifier nunca vão ao Google); URL ilegível dá null", () => {
  assert.equal(paginaLimpa("https://console-staging.agentesgrok.com/account/plan#code=abc&verifier=def"), "https://console-staging.agentesgrok.com/account/plan");
  assert.equal(paginaLimpa("https://auth-staging.agentesgrok.com/entrar?esquema=web&state=x&challenge=y"), "https://auth-staging.agentesgrok.com/entrar");
  assert.equal(paginaLimpa("https://agentesgrok.com/"), "https://agentesgrok.com/");
  assert.equal(paginaLimpa("lixo"), null);
});

test("caminhoAnonimo: o slug da organização vira _; /organizations/new e os caminhos da conta não mudam", () => {
  assert.equal(caminhoAnonimo("/organizations/coflow/members"), "/organizations/_/members");
  assert.equal(caminhoAnonimo("/organizations/coflow/settings"), "/organizations/_/settings");
  assert.equal(caminhoAnonimo("/organizations/coflow"), "/organizations/_");
  assert.equal(caminhoAnonimo("/organizations/new"), "/organizations/new");
  assert.equal(caminhoAnonimo("/enterprise/coflow"), "/enterprise/_");
  assert.equal(caminhoAnonimo("/account/plan"), "/account/plan");
});

test("campanhaDaQuery: só UTM e gclid/gbraid/wbraid passam; state, code e o resto do login ficam fora", () => {
  assert.equal(campanhaDaQuery("?utm_source=google&utm_medium=cpc&gclid=abc&state=x&code=y&challenge=z"), "?utm_source=google&utm_medium=cpc&gclid=abc");
  assert.equal(campanhaDaQuery("?esquema=web&state=x&challenge=y"), "");
  assert.equal(campanhaDaQuery(""), "");
  assert.equal(campanhaDaQuery("?gbraid=g&wbraid=w&utm_campaign=base"), "?utm_campaign=base&gbraid=g&wbraid=w");
  assert.equal(campanhaDaQuery(`?utm_term=${"a".repeat(300)}`).length, "?utm_term=".length + 200);
});

test("public/analytics.js copia a mesma lista de chaves de campanha", () => {
  const js = readFileSync(new URL("../public/analytics.js", import.meta.url), "utf8");
  const lista = /const CAMPANHA = (\[[^\]]*\]);/.exec(js);
  assert.ok(lista, "CAMPANHA não encontrada em analytics.js");
  assert.deepEqual(JSON.parse(lista[1]), [...CHAVES_CAMPANHA]);
});
