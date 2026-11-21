// Modo instagramável, a parte pura: as marcas de uma leitura na tela, o rótulo e a cor delas, e o texto dos balões.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CURSORES, corDaMarca, marcasNaTela, rotuloDaMarca } from "../../dist/renderer/lib/instagramavel-core.js";





test("textoDoBalao: o que o log fez, sem e-mail, URL só com o domínio, Gmail só a ação, erro com ✗, cortado", async () => {
  const { textoDoBalao, limparParaTela, BALAO_MAX } = await import("../../dist/renderer/lib/instagramavel-core.js");
  assert.equal(textoDoBalao({ origem: "navegador", rota: "/abrir", ok: true, resumo: "https://analytics.google.com/analytics/web/?requestAccessEmail=box%40agentesgrok.com#/a1p2 → aba 5 (nova)" }), "analytics.google.com → aba 5 (nova)");
  assert.equal(limparParaTela("aba 3: Inbox (2) - ana.souza@empresa.com.br - Gmail"), "aba 3: Inbox (2) - •••@••• - Gmail");
  assert.equal(textoDoBalao({ origem: "gmail", rota: "/ler", ok: true, resumo: "leu 18c2: Proposta para ana@x.com" }), "Gmail: leu um e-mail");
  assert.equal(textoDoBalao({ origem: "navegador", rota: "/clicar", ok: false, resumo: "nada com o seletor" }), "✗ nada com o seletor");
  assert.equal(textoDoBalao({ origem: "nota", rota: "/nota", ok: true, resumo: "Claude: vou ler o Analytics" }), "Claude: vou ler o Analytics");
  assert.equal(textoDoBalao({ origem: "hook", rota: "x", ok: true, resumo: "ok" }), "");
  const longo = textoDoBalao({ origem: "nota", rota: "/nota", ok: true, resumo: "a".repeat(200) });
  assert.equal(longo.length, BALAO_MAX); assert.ok(longo.endsWith("…"));
  assert.ok(!/@[a-z]/i.test(textoDoBalao({ origem: "navegador", rota: "/ler", ok: true, resumo: "aba 2: box@agentesgrok.com - Google" })));
});

test("pontoNaTela: converte o ponto da página para a janela com o zoom da aba; fora do webview é null", async () => {
  const { pontoNaTela, rotuloDoDono } = await import("../../dist/renderer/lib/instagramavel-core.js");
  const wv = { left: 300, top: 120, width: 830, height: 600 };
  // Zoom 83%: a página tem 1000 × 723 px visíveis num webview de 830 × 600.
  assert.deepEqual(pontoNaTela({ x: 500, y: 361, vw: 1000, vh: 723 }, wv), { x: 715, y: 420 });
  assert.deepEqual(pontoNaTela({ x: 0, y: 0, vw: 830, vh: 600 }, wv), { x: 300, y: 120 });
  assert.equal(pontoNaTela({ x: 10, y: 10, vw: 0, vh: 600 }, wv), null);
  assert.equal(pontoNaTela({ x: 2000, y: 10, vw: 1000, vh: 723 }, wv), null);
  assert.equal(rotuloDoDono("Claude Code (MCP) (claude-code)"), "Claude Code (MCP)");
  assert.equal(rotuloDoDono("WhatsApp (whatsapp)"), "WhatsApp");
  assert.equal(rotuloDoDono(null), "agente");
});


test("textoDoBalao: /js e sondas não entram no palco (vazio)", async () => {
  const { textoDoBalao } = await import("../../dist/renderer/lib/instagramavel-core.js");
  assert.equal(textoDoBalao({ origem: "navegador", rota: "/js", ok: true, resumo: "js: 505 caracteres" }), "");
  assert.equal(textoDoBalao({ origem: "navegador", rota: "/abas", ok: true, resumo: "sonda: 3 aba(s)" }), "");
});

test("corDaMarca: uma cor por número, estável, com vizinhos longe na roda", () => {
  assert.match(corDaMarca(1), /^hsl\(\d{1,3} 85% 55%\)$/);
  assert.equal(corDaMarca(7), corDaMarca(7));
  const hues = Array.from({ length: 20 }, (_, i) => Number(/hsl\((\d+)/.exec(corDaMarca(i + 1))[1]));
  assert.equal(new Set(hues).size, 20, "20 marcas na tela, 20 cores");
  for (let i = 1; i < hues.length; i++) { const d = Math.abs(hues[i] - hues[i - 1]) % 360; assert.ok(Math.min(d, 360 - d) >= 60, `marcas ${i} e ${i + 1} parecidas`); }
});

test("rotuloDaMarca: número e texto do elemento, sem e-mail, URL só com o domínio, cortado; sem texto fica só o número", () => {
  assert.equal(rotuloDaMarca(7, "Vendas"), "7 Vendas");
  assert.equal(rotuloDaMarca(3, ""), "3");
  assert.equal(rotuloDaMarca(4, "Conta de ana@acme.com"), "4 Conta de •••@•••");
  assert.equal(rotuloDaMarca(5, "https://www.exemplo.com/a/b?c=1"), "5 exemplo.com");
  const longo = rotuloDaMarca(12, "x".repeat(80));
  assert.ok(longo.endsWith("…") && longo.length === "12 ".length + 28, longo);
});

test("marcasNaTela: converte com o zoom da aba, tira o que cai fora do webview, corta no teto e conta a sobra", () => {
  const r = { left: 100, top: 50, width: 600, height: 400 };
  const m = { vw: 1200, vh: 800, itens: [{ n: 1, x: 0, y: 0, rotulo: "A" }, { n: 2, x: 600, y: 400, rotulo: "B" }, { n: 3, x: 1300, y: 10, rotulo: "fora" }, { n: 4, x: 1200, y: 800, rotulo: "D" }] };
  assert.deepEqual(marcasNaTela(m, r), { itens: [{ n: 1, x: 100, y: 50, rotulo: "1 A" }, { n: 2, x: 400, y: 250, rotulo: "2 B" }, { n: 4, x: 700, y: 450, rotulo: "4 D" }], fora: 0 });
  const muitas = { vw: 1000, vh: 1000, itens: Array.from({ length: 33 }, (_, i) => ({ n: i + 1, x: i * 10, y: i * 10, rotulo: "" })) };
  const t = marcasNaTela(muitas, r);
  assert.equal(MAX_CURSORES, 20);
  assert.equal(t.itens.length, 20); assert.equal(t.fora, 13); assert.equal(t.itens[19].n, 20);
  assert.deepEqual(marcasNaTela(muitas, r, 2).itens.map((i) => i.n), [1, 2]);
  assert.deepEqual(marcasNaTela({ vw: 0, vh: 0, itens: m.itens }, r), { itens: [], fora: 0 });
});
