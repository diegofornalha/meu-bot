// O nome da máquina da janela mora ao lado da seta dos atalhos; a barra de cima só o mostra sem a lista.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ler = (arquivo) => readFileSync(new URL(`../../src/renderer/${arquivo}`, import.meta.url), "utf8");

test("o nome da máquina fica dentro do botão da seta dos atalhos", () => {
  const botao = /<button[^>]*id="atalhos-toggle"[^>]*>([\s\S]*?)<\/button>/.exec(ler("index.html"));
  assert.ok(botao, "o #atalhos-toggle existe");
  const seta = botao[1].indexOf('class="atalhos-seta"');
  const nome = botao[1].indexOf('id="atalhos-host"');
  assert.ok(seta >= 0 && nome > seta, "o #atalhos-host vem logo depois da seta, no mesmo botão");
});

test("o mesmo nome é pintado na barra de cima e ao lado da seta", () => {
  const pintar = /function paintTopbarHost\(\): void \{([\s\S]*?)\n\}/.exec(ler("renderer.ts"));
  assert.ok(pintar, "paintTopbarHost existe");
  assert.match(pintar[1], /topbarHost\.textContent = nome;/);
  assert.match(pintar[1], /atalhosHost\.textContent = nome;/);
});

test("com a lista à mostra, a barra de cima não repete o nome", () => {
  assert.match(ler("style.css"), /body:has\(#sidebar:not\(\[hidden\]\)\) \.topbar \.topbar-host \{ display: none; \}/);
});
