import { test } from "node:test";
import assert from "node:assert/strict";
import { hermesBloqueado, HERMES_FALTA_NO_MAC } from "../../dist/renderer/lib/agente-hermes.js";
import { createRequire } from "node:module";
const { STATUS_SCRIPT } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp.js");

test("cartão Hermes do tutorial 3: nas máquinas sempre; em Este Mac só com o comando hermes instalado", () => {
  assert.equal(hermesBloqueado("meu-root-hermes", null), null);
  assert.equal(hermesBloqueado("meu-root-openclaw", { hermesCli: false }), null, "na máquina por SSH o passo Preparar instala o que faltar");
  assert.equal(hermesBloqueado("local", { hermesCli: true }), null, "Este Mac com o hermes: clicável (o gateway sobe pelo launchd)");
  assert.equal(hermesBloqueado("local", { hermesCli: false }), HERMES_FALTA_NO_MAC);
  assert.equal(hermesBloqueado("local", {}), HERMES_FALTA_NO_MAC, "status sem o campo: não oferece o que não confirmou");
  assert.equal(hermesBloqueado("local", null), HERMES_FALTA_NO_MAC, "status ainda não lido");
  assert.match(HERMES_FALTA_NO_MAC, /Instale o Hermes/);
});

test("o status de qualquer máquina diz se o comando hermes existe (hermescli)", () => {
  assert.match(STATUS_SCRIPT, /echo "hermescli=\$\(command -v hermes >\/dev\/null 2>&1 && echo 1 \|\| echo 0\)"/);
  assert.ok(STATUS_SCRIPT.indexOf("hermescli=") < STATUS_SCRIPT.indexOf("present=0"), "antes do fim: sai mesmo sem WhatsApp na máquina");
});
