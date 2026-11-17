// A tecla dos atalhos do app por plataforma (⌘ no macOS, Ctrl fora dele) e a moldura das janelas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { temTeclaDoApp, ehDoShell, rotuloTeclas, dicaTeclas } = await import("../../dist/renderer/lib/teclas-core.js");
const { ATALHOS } = await import("../../dist/renderer/lib/busca-core.js");
const { molduraDaJanela } = createRequire(import.meta.url)("../../dist/main/app/moldura-core.js");

const ev = (o = {}) => ({ metaKey: false, ctrlKey: false, shiftKey: false, ...o });

test("com a ⌘ (macOS): só a ⌘ é do app, dentro e fora do terminal; no terminal a Ctrl é do shell", () => {
  for (const noTerminal of [false, true]) {
    assert.equal(temTeclaDoApp(ev({ metaKey: true }), true, noTerminal), true);
    assert.equal(temTeclaDoApp(ev({ ctrlKey: true }), true, noTerminal), false);
    assert.equal(temTeclaDoApp(ev({ ctrlKey: true, shiftKey: true }), true, noTerminal), false);
  }
  assert.equal(ehDoShell(ev({ ctrlKey: true }), true), true);
  assert.equal(ehDoShell(ev({ ctrlKey: true, metaKey: true }), true), false);
  assert.equal(ehDoShell(ev({ metaKey: true }), true), false);
});

test("sem a ⌘ (Windows): fora do terminal a Ctrl é do app; no terminal só Ctrl+Shift, e a Ctrl sozinha é do shell", () => {
  assert.equal(temTeclaDoApp(ev({ ctrlKey: true }), false, false), true);
  assert.equal(temTeclaDoApp(ev({ ctrlKey: true }), false, true), false, "Ctrl+C no terminal é do shell");
  assert.equal(temTeclaDoApp(ev({ ctrlKey: true, shiftKey: true }), false, true), true);
  assert.equal(temTeclaDoApp(ev({ metaKey: true }), false, false), false, "a tecla Windows não é atalho do app");
  assert.equal(ehDoShell(ev({ ctrlKey: true }), false), true);
  assert.equal(ehDoShell(ev({ ctrlKey: true, shiftKey: true }), false), false);
});

test("rótulos: com a ⌘ ficam como estão; sem ela, toda a folha de atalhos sai sem símbolo do Mac", () => {
  assert.equal(rotuloTeclas("⌘⇧B", true), "⌘⇧B");
  assert.equal(rotuloTeclas("⌘⇧B", false), "Ctrl+Shift+B");
  assert.equal(rotuloTeclas("⌘K", false), "Ctrl+K");
  for (const g of ATALHOS) for (const a of g.atalhos) assert.doesNotMatch(rotuloTeclas(a.teclas, false), /[⌘⇧⌥]/, a.teclas);
  assert.equal(dicaTeclas("Paleta de comandos (Cmd+K)", true), "Paleta de comandos (Cmd+K)");
  assert.equal(dicaTeclas("Terminal (Cmd+J; Option+clique ou Cmd+Shift+J abre mais um)", false), "Terminal (Ctrl+J; Alt+clique ou Ctrl+Shift+J abre mais um)");
});

test("moldura: semáforos por cima da barra no macOS; fora dele, a moldura do sistema com o menu recolhido", () => {
  assert.deepEqual(molduraDaJanela(true), { titleBarStyle: "hiddenInset" });
  assert.deepEqual(molduraDaJanela(false), { autoHideMenuBar: true });
});
