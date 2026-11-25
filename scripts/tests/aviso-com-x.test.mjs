// Cada aviso da lista do modo instagramável tem um × que o tira da tela; o palco continua sem receber clique.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ler = (arquivo) => readFileSync(new URL(`../../src/renderer/${arquivo}`, import.meta.url), "utf8");

test("o aviso nasce com o × e o clique nele remove o aviso", () => {
  const listar = /function listar\(e: EventoDepuracao\): void \{([\s\S]*?)\n\}/.exec(ler("depuracao/instagramavel.ts"));
  assert.ok(listar, "listar existe");
  assert.match(listar[1], /className: "insta-fechar"/);
  assert.match(listar[1], /fechar\.addEventListener\("click", \(\) => item\.remove\(\)\)/);
  assert.match(listar[1], /item\.append\(nome, texto, fechar\)/);
});

test("só o × recebe clique: o palco segue transparente para a página", () => {
  const css = ler("style.css");
  assert.match(css, /\.insta-palco \{[^}]*pointer-events: none;/);
  assert.match(css, /\.insta-fechar \{[^}]*pointer-events: auto;/);
});

test("embaixo dos avisos, limpar tudo e desativar; a linha fica por último e some sem aviso", () => {
  const ts = ler("depuracao/instagramavel.ts"), css = ler("style.css");
  assert.match(ts, /botaoDeAcao\("limpar tudo", [^\n]*\(\) => limparLista\(\)\)/);
  assert.match(ts, /botaoDeAcao\("desativar", [^\n]*alternarInstagramavel\(\)/);
  assert.match(ts, /listaEl\.insertBefore\(item, acoesEl\)/, "aviso novo entra antes da linha das ações");
  const limpar = /function limparLista\(\): void \{([\s\S]*?)\n\}/.exec(ts);
  assert.ok(limpar && !/replaceChildren/.test(limpar[1]), "limpar tira os avisos, não a linha das ações");
  assert.match(css, /\.insta-lista:not\(:has\(\.insta-item\)\) \.insta-acoes \{ display: none; \}/);
  assert.match(css, /\.insta-acao \{[^}]*pointer-events: auto;/);
});
