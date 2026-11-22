// Vigia do Grok Bot: numeração alinhada, impressão do pacote e o relatório do que mudou entre duas versões.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agrupar, compararVersao, diferenca, lerVersao, mudou, opcoesDe, proximaEstavel, relatorio, semHash, textosDe } from "../grokbot-core.mjs";

test("versões: leitura e comparação", () => {
  assert.deepEqual(lerVersao("1.2.3"), [1, 2, 3]);
  for (const x of ["1.2", "1.2.3-staging.1", "v1.2.3", "", null]) assert.equal(lerVersao(x), null, String(x));
  assert.equal(compararVersao("1.2.3", "1.2.10"), -1); assert.equal(compararVersao("1.10.0", "1.9.9"), 1); assert.equal(compararVersao("1.2.3", "1.2.3"), 0);
  assert.equal(compararVersao("lixo", "0.0.1"), -1);
});

test("proximaEstavel: segue o Grok Bot quando ele está à frente; senão, o nosso patch seguinte", () => {
  assert.equal(proximaEstavel("1.2.3", "1.2.0"), "1.2.3", "Grok Bot à frente: mesmo número");
  assert.equal(proximaEstavel("1.2.3", "1.2.3"), "1.2.4", "já usamos o número: patch seguinte, sem repetir");
  assert.equal(proximaEstavel("1.2.3", "1.2.5"), "1.2.6", "nunca anda para trás");
  assert.equal(proximaEstavel("1.3.0", "1.2.6"), "1.3.0", "volta a igualar quando o Grok Bot sobe");
  assert.equal(proximaEstavel(null, "1.2.0"), "1.2.1", "sem o Grok Bot instalado");
  assert.equal(proximaEstavel("1.2.3", null), "1.2.3");
  assert.equal(proximaEstavel(null, null), null);
});

test("semHash tira o hash do empacotador e deixa o resto", () => {
  assert.equal(semHash("dist/renderer/assets/chunk-file-Ab3_x9Zq.js"), "dist/renderer/assets/chunk-file.js");
  assert.equal(semHash("dist/renderer/assets/outlook.svg"), "dist/renderer/assets/outlook.svg");
  assert.equal(semHash("dist/deps/node-gyp-build/index.js"), "dist/deps/node-gyp-build/index.js");
});

test("opcoesDe e textosDe leem o pacote do renderer", () => {
  const js = 'x={"update-status":{label:{id:`U+dVHJ`},description:{id:`ao3`}},theme:{label:{id:`a1`}},"update-status":{label:{id:`dup`}}};' +
    'y=["Your Bot only answers texts from these phones","Je eigen connectors worden ook door deze Bot gebruikt",`This skill changed. Check it and try again.`,"ok","Tamanho"]';
  assert.deepEqual(opcoesDe(js), ["update-status", "theme"]);
  assert.deepEqual(textosDe(js).sort(), ["This skill changed. Check it and try again.", "Your Bot only answers texts from these phones"]);
});

test("diferenca, agrupar, mudou e relatorio", () => {
  assert.deepEqual(diferenca(["a", "b"], ["b", "c"]), { novos: ["c"], removidos: ["a"] });
  const antes = { versao: "1.1.0", arquivos: ["dist/a-AAAAAAAA.js", "dist/telegram.png"], textos: ["Link your phone to get your Bot's number"], opcoes: ["theme"] };
  const depois = { versao: "1.2.3", arquivos: ["dist/a-BBBBBBBB.js", "dist/outlook.svg"], textos: ["Scan to link another phone", "Sign in with SSO", "This skill changed. Check it and try again."], opcoes: ["theme", "passkeys"] };
  assert.equal(mudou(antes, depois), true);
  assert.equal(mudou(antes, { ...antes, versao: "1.1.1", arquivos: ["dist/a-CCCCCCCC.js", "dist/telegram.png"] }), false, "só o hash mudou");
  const g = Object.fromEntries(agrupar(depois.textos));
  assert.deepEqual(g["Mensagens e telefone"], ["Scan to link another phone"]); assert.deepEqual(g["Conectores e login"], ["Sign in with SSO"]); assert.deepEqual(g["Skills e arquivos"], ["This skill changed. Check it and try again."]);
  const md = relatorio(antes, depois, { nossa: "1.2.0", proxima: "1.2.3" });
  assert.match(md, /^# Grok Bot 1\.2\.3: o que mudou desde a 1\.1\.0/);
  assert.match(md, /a próxima sai como \*\*1\.2\.3\*\*/);
  assert.match(md, /Opções novas \(1\):\n- passkeys/);
  assert.match(md, /Novos \(1\):\n- dist\/outlook\.svg/); assert.match(md, /Removidos \(1\):\n- dist\/telegram\.png/);
  assert.ok(!md.includes("dist/a.js"), "arquivo que só trocou de hash não aparece");
});
