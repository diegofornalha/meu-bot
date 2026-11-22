import { test } from "node:test";
import assert from "node:assert/strict";
import { modoOllama, rotuloDoModelo } from "../../dist/renderer/lib/modo-ollama.js";

test("rótulo do modelo: o id do Ollama vira o nome que a pessoa lê", () => {
  assert.equal(rotuloDoModelo("qwen2.5:7b"), "Qwen 2.5 7B");
  assert.equal(rotuloDoModelo("qwen2.5:3b"), "Qwen 2.5 3B");
  assert.equal(rotuloDoModelo("qwen2.5"), "Qwen 2.5");
  assert.equal(rotuloDoModelo("llama3.2:3b"), "llama3.2:3b");
  assert.equal(rotuloDoModelo(null), "Qwen 2.5");
});

test("ollama-local no menu de modos: aparece onde é oferecido e só se escolhe depois de instalado", () => {
  const instalado = modoOllama({ oferecido: true, instalado: true, modelo: "qwen2.5:7b", emUso: false });
  assert.deepEqual(instalado, { mostrar: true, disponivel: true, texto: "ollama-local · Qwen 2.5 7B no Ollama deste Mac, grátis e sem internet" });

  // Oferecido e ainda não instalado: a linha aparece apagada.
  const semInstalar = modoOllama({ oferecido: true, instalado: false, modelo: null, emUso: false });
  assert.equal(semInstalar.mostrar, true);
  assert.equal(semInstalar.disponivel, false);
  assert.equal(modoOllama({ oferecido: true, instalado: true, modelo: null, emUso: false }).disponivel, false);

  // Máquina por SSH, estável ou Mac Intel: a linha não aparece.
  assert.equal(modoOllama({ oferecido: false, instalado: false, modelo: null, emUso: false }).mostrar, false);
  // A conversa já está no ollama-local: a linha fica, para o menu mostrar o modo atual, mas não é escolhível.
  const emUso = modoOllama({ oferecido: false, instalado: false, modelo: null, emUso: true });
  assert.equal(emUso.mostrar, true);
  assert.equal(emUso.disponivel, false);
});

test("ollama-local na janela de uma máquina por SSH: a linha diz que o modelo é da máquina", () => {
  const remota = modoOllama({ oferecido: true, instalado: true, modelo: "qwen2.5:3b", emUso: false, remoto: true });
  assert.deepEqual(remota, { mostrar: true, disponivel: true, texto: "ollama-local · Qwen 2.5 3B no Ollama desta máquina, grátis" });
  // Máquina que não aguenta (ou canal que não oferece): a linha some, como antes.
  assert.equal(modoOllama({ oferecido: false, instalado: false, modelo: null, emUso: false, remoto: true }).mostrar, false);
});
