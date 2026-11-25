import { test } from "node:test";
import assert from "node:assert/strict";
import { MARCAR_SCRIPT, READ_SCRIPT, alvoDeClique, alvoDeDigitacao, codigoDaTecla, digitarValorScript, readScript } from "../../dist/main/navegador/nav-scripts.js";

test("leitura: a do Navegador lê a página inteira; a da interface do app pula webviews e terminais", () => {
  assert.equal(READ_SCRIPT, readScript());
  assert.ok(!READ_SCRIPT.includes("closest("), "o Navegador não pula nada");
  const ui = readScript("webview, .xterm");
  assert.ok(ui.includes('if (e.closest("webview, .xterm")) continue;'));
  // O resto do script é o mesmo: uma cópia só para os dois serviços.
  assert.equal(ui.replace('\n    if (e.closest("webview, .xterm")) continue;', ""), READ_SCRIPT);
  // Os dois são expressões JavaScript válidas (uma aspa errada no seletor quebraria só em uso).
  for (const s of [READ_SCRIPT, ui]) assert.doesNotThrow(() => new Function(`return ${s}`));
});

test("alvo do clique: número, seletor ou texto; sem nenhum, recusa", () => {
  assert.match(alvoDeClique({ n: 4 }), /__meuBotEls \|\| \[\]\)\[3\]/);
  assert.match(alvoDeClique({ seletor: "#btn-settings" }), /querySelector\("#btn-settings"\)/);
  // O texto entra como string JSON: aspas no rótulo não fecham o script.
  assert.ok(alvoDeClique({ texto: 'diz "oi"' }).includes(JSON.stringify('diz "oi"')));
  assert.throws(() => alvoDeClique({}), /diga n/);
});

test("alvo da digitação: sem n nem seletor, o campo em foco", () => {
  assert.equal(alvoDeDigitacao({}), "document.activeElement");
  assert.match(alvoDeDigitacao({ n: 1 }), /\[0\]/);
});

test("teclas: nomes conhecidos, um caractere, e recusa do resto", () => {
  assert.equal(codigoDaTecla("enter"), "Return");
  assert.equal(codigoDaTecla("ESC"), "Escape");
  assert.equal(codigoDaTecla("k"), "k");
  assert.throws(() => codigoDaTecla("ctrl+c"), /tecla:/);
  assert.throws(() => codigoDaTecla(undefined), /tecla:/);
});

test("digitar na interface do app: o valor entra como JSON e o campo avisa com input e change", () => {
  const s = digitarValorScript("document.activeElement", 'senha "com" aspas\n');
  assert.ok(s.includes(JSON.stringify('senha "com" aspas\n')), "aspas e quebra de linha não fecham o script");
  assert.match(s, /new Event\("input"/); assert.match(s, /new Event\("change"/);
  assert.doesNotThrow(() => new Function(`return ${s}`));
});

test("marcas: com um <dialog> aberto vão dentro dele (a camada de cima cobre qualquer z-index)", () => {
  assert.match(MARCAR_SCRIPT, /dialog\[open\]/);
  assert.doesNotThrow(() => new Function(`return ${MARCAR_SCRIPT}`));
});
