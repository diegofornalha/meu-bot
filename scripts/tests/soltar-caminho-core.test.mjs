// Arrastar do Finder para a caixa da conversa: o texto dos endereços e onde ele entra.
import { test } from "node:test";
import assert from "node:assert/strict";
const { textoDosCaminhos, inserirNoCursor } = await import("../../dist/renderer/lib/soltar-caminho-core.js");

test("um endereço sem espaço entra como está; com espaço, entre aspas; vários, lado a lado", () => {
  assert.equal(textoDosCaminhos(["/Users/a/Desktop/video-mkt"]), "/Users/a/Desktop/video-mkt");
  assert.equal(textoDosCaminhos(["/Users/a/Captura de Tela.png"]), '"/Users/a/Captura de Tela.png"');
  assert.equal(textoDosCaminhos(["/a", "/b c", "/d"]), '/a "/b c" /d');
});

test("item sem endereço (não veio do disco) fica de fora", () => {
  assert.equal(textoDosCaminhos([""]), "");
  assert.equal(textoDosCaminhos(["", "/a"]), "/a");
});

test("caixa vazia: o endereço e um espaço, cursor no fim", () => {
  assert.deepEqual(inserirNoCursor("", 0, 0, "/a"), { valor: "/a ", cursor: 3 });
});

test("no meio de uma frase: separa do que veio antes e não dobra o espaço de depois", () => {
  assert.deepEqual(inserirNoCursor("olhe", 4, 4, "/a"), { valor: "olhe /a ", cursor: 8 });
  assert.deepEqual(inserirNoCursor("olhe  e diga", 5, 5, "/a"), { valor: "olhe /a e diga", cursor: 7 });
});

test("com texto selecionado, o endereço toma o lugar da seleção", () => {
  assert.deepEqual(inserirNoCursor("abra AQUI agora", 5, 9, "/a"), { valor: "abra /a agora", cursor: 7 });
});

test("sem endereço nenhum, nada muda", () => {
  assert.deepEqual(inserirNoCursor("oi", 1, 2, ""), { valor: "oi", cursor: 2 });
});
