// http → https: o Worker atende os dois esquemas, então o redirecionamento é dele (e o HSTS, em SEGURANCA).
import { test } from "node:test";
import assert from "node:assert/strict";
import { paraHttps, semBarraFinal } from "../dist/site-core.js";

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
