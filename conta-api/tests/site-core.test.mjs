// http → https: o Worker atende os dois esquemas, então o redirecionamento é dele (e o HSTS, em SEGURANCA).
import { test } from "node:test";
import assert from "node:assert/strict";
import { caminhoCanonico, ehAliasDoSite, paraHttps, redirecionamentoInicial, semBarraFinal } from "../dist/site-core.js";

test("paraHttps: http vira https com caminho e query; https e lixo ficam null", () => {
  assert.equal(paraHttps("http://agentesgrok.com/"), "https://agentesgrok.com/");
  assert.equal(paraHttps("http://agentesgrok.com/obrigado?ver=1#x"), "https://agentesgrok.com/obrigado?ver=1#x");
  assert.equal(paraHttps("http://console.agentesgrok.com:80/account/plan"), "https://console.agentesgrok.com/account/plan");
  assert.equal(paraHttps("https://agentesgrok.com/"), null);
  assert.equal(paraHttps("nada"), null);
});

test("semBarraFinal: /baixar/ vira /baixar; a raiz e caminhos sem barra ficam null", () => {
  assert.equal(semBarraFinal("/baixar/"), "/baixar");
  assert.equal(semBarraFinal("/guias/ia-que-le-seu-gmail//"), "/guias/ia-que-le-seu-gmail");
  assert.equal(semBarraFinal("/grok-no-whatsapp"), null);
  assert.equal(semBarraFinal("/"), null);
  assert.equal(semBarraFinal("//"), null);
});

test("ehAliasDoSite: www e .com.br (com e sem www) são aliases; o principal, subdomínios e lixo não", () => {
  const s = "https://agentesgrok.com";
  for (const h of ["www.agentesgrok.com", "agentesgrok.com.br", "www.agentesgrok.com.br", "AgentesGrok.com.br"]) assert.equal(ehAliasDoSite(h, s), true, h);
  for (const h of ["agentesgrok.com", "auth.agentesgrok.com", "console.agentesgrok.com.br", "agentesgrok.com.br.evil.com"]) assert.equal(ehAliasDoSite(h, s), false, h);
  assert.equal(ehAliasDoSite("www.site-staging.agentesgrok.com", "https://site-staging.agentesgrok.com"), true);
  assert.equal(ehAliasDoSite("x", "lixo"), false);
});

test("redirecionamentoInicial: alias vai direto ao site principal em um salto (http ou https); o resto em http vira https", () => {
  const s = "https://agentesgrok.com";
  assert.equal(redirecionamentoInicial("http://www.agentesgrok.com/baixar?utm_source=x", s), "https://agentesgrok.com/baixar?utm_source=x");
  assert.equal(redirecionamentoInicial("https://www.agentesgrok.com/", s), "https://agentesgrok.com/");
  assert.equal(redirecionamentoInicial("http://agentesgrok.com.br/perguntas", s), "https://agentesgrok.com/perguntas");
  assert.equal(redirecionamentoInicial("http://www.agentesgrok.com.br/?gclid=1", s), "https://agentesgrok.com/?gclid=1");
  assert.equal(redirecionamentoInicial("http://agentesgrok.com/termos?a=1", s), "https://agentesgrok.com/termos?a=1");
  assert.equal(redirecionamentoInicial("http://console.agentesgrok.com/account/plan", s), "https://console.agentesgrok.com/account/plan");
  assert.equal(redirecionamentoInicial("https://agentesgrok.com/", s), null);
  assert.equal(redirecionamentoInicial("https://console.agentesgrok.com/", s), null);
  assert.equal(redirecionamentoInicial("nada", s), null);
});

test("caminhoCanonico: /index.html vira /, barra final sai; o canônico fica null", () => {
  assert.equal(caminhoCanonico("/index.html"), "/");
  assert.equal(caminhoCanonico("/baixar/"), "/baixar");
  assert.equal(caminhoCanonico("/"), null);
  assert.equal(caminhoCanonico("/perguntas"), null);
  assert.equal(caminhoCanonico("/guias/index.html"), null);
});
