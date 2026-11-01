import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarProgresso, fmtBytes, rotuloEtapa, terminou, textoAndamento } from "../../dist/renderer/conta-google/backup-andamento.js";

const p = (conjunto, indice, etapa, extra = {}) => ({ conjunto, nome: conjunto.toUpperCase(), etapa, indice, total: 3, bytes: null, detalhe: null, ...extra });

test("fmtBytes: KB abaixo de 1 MB, MB com uma casa acima", () => {
  assert.equal(fmtBytes(1182), "1 KB");
  assert.equal(fmtBytes(6282615), "6.0 MB");
});

test("aplicarProgresso: guarda o mais novo de cada conjunto; o primeiro 'enviando' zera a lista", () => {
  let l = aplicarProgresso([], p("crm", 1, "enviando"));
  l = aplicarProgresso(l, p("crm", 1, "enviado", { bytes: 1182 }));
  l = aplicarProgresso(l, p("agente", 2, "enviando"));
  assert.deepEqual(l.map((x) => `${x.conjunto}:${x.etapa}`), ["crm:enviado", "agente:enviando"]);
  const nova = aplicarProgresso(l, p("crm", 1, "enviando"));
  assert.deepEqual(nova.map((x) => x.conjunto), ["crm"]);
});

test("rotuloEtapa: cada etapa tem a sua cara", () => {
  assert.equal(rotuloEtapa(p("crm", 1, "enviando")), "enviando…");
  assert.equal(rotuloEtapa(p("crm", 1, "enviado", { bytes: 1182 })), "✓ 1 KB");
  assert.equal(rotuloEtapa(p("crm", 1, "enviado")), "✓");
  assert.equal(rotuloEtapa(p("credenciais", 3, "pulado", { detalhe: "sem senha de backup" })), "pulado (sem senha de backup)");
  assert.equal(rotuloEtapa(p("financeiro", 2, "ausente")), "não há nesta máquina");
  assert.equal(rotuloEtapa(p("trabalho", 2, "erro", { detalhe: "token" })), "✗ erro");
});

test("textoAndamento: vazio sem etapa; depois 'n de total' e os conjuntos na ordem", () => {
  assert.equal(textoAndamento([]), "");
  const l = [p("crm", 1, "enviado", { bytes: 1182 }), p("agente", 2, "enviando")];
  assert.equal(textoAndamento(l), "2 de 3 · CRM ✓ 1 KB · AGENTE enviando…");
});

test("terminou: só quando o último conjunto saiu do 'enviando'", () => {
  assert.equal(terminou([]), false);
  assert.equal(terminou([p("crm", 1, "enviado")]), false);
  assert.equal(terminou([p("crm", 1, "enviado"), p("x", 3, "enviando")]), false);
  assert.equal(terminou([p("crm", 1, "enviado"), p("x", 3, "erro")]), true);
  assert.equal(terminou([p("x", 3, "ausente")]), true);
});
