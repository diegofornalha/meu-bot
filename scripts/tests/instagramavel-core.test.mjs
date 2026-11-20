// Modo instagramável, a parte pura: cor por nome, rodízio dos nomes e a borda de onde cada cursor entra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CURSORES, NOME_PADRAO, corDoCursor, pontoDeEntrada, pontoNaPagina, proximoNome } from "../../dist/renderer/lib/instagramavel-core.js";

test("corDoCursor: cada cursor de uma cor, mesmo com o mesmo nome; estável para o mesmo (nome, i)", () => {
  assert.match(corDoCursor("Ana", 0), /^hsl\(\d{1,3} 85% 55%\)$/);
  assert.equal(corDoCursor("Ana", 3), corDoCursor("ana", 3));
  const hues = Array.from({ length: 24 }, (_, i) => Number(/hsl\((\d+)/.exec(corDoCursor("meu-bot", i))[1]));
  assert.equal(new Set(hues).size, 24, "24 cursores na tela, 24 cores");
  // Vizinhos (os que entram em sequência) ficam longe na roda: pelo menos 60° de diferença.
  for (let i = 1; i < hues.length; i++) { const d = Math.abs(hues[i] - hues[i - 1]) % 360; assert.ok(Math.min(d, 360 - d) >= 60, `cursores ${i - 1} e ${i} parecidos`); }
});

test("proximoNome: rodízio que volta ao começo; sem nomes, o nome do app", () => {
  const nomes = ["Ana", "Bruno", "Carla"];
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => proximoNome(nomes, i)), ["Ana", "Bruno", "Carla", "Ana", "Bruno"]);
  assert.equal(proximoNome([], 7), NOME_PADRAO);
  assert.equal(proximoNome(nomes, -1), "Carla");
});

test("pontoDeEntrada: sempre fora da janela, numa das quatro bordas; o mesmo sorteio dá o mesmo ponto", () => {
  const L = 1200, A = 800;
  assert.deepEqual(pontoDeEntrada(L, A, 0.1), { x: 480, y: -40 });
  assert.deepEqual(pontoDeEntrada(L, A, 0.3), { x: L + 40, y: 160 });
  assert.deepEqual(pontoDeEntrada(L, A, 0.6), { x: 480, y: A + 40 });
  assert.deepEqual(pontoDeEntrada(L, A, 0.85), { x: -40, y: 320 });
  for (let i = 0; i < 200; i++) {
    const p = pontoDeEntrada(L, A, i / 200);
    assert.ok(p.x < 0 || p.x > L || p.y < 0 || p.y > A, `ponto dentro da janela: ${JSON.stringify(p)}`);
  }
  assert.deepEqual(pontoDeEntrada(L, A, 1), pontoDeEntrada(L, A, 0.999999));
  assert.ok(MAX_CURSORES > 0);
});

test("pontoNaPagina: sempre dentro da página, com margem das bordas (a etiqueta do nome não sai dela)", () => {
  const r = { left: 100, top: 50, width: 1000, height: 600 };
  assert.deepEqual(pontoNaPagina(r, 0, 0), { x: 220, y: 122 });
  assert.deepEqual(pontoNaPagina(r, 1, 1), { x: 980, y: 578 });
  assert.deepEqual(pontoNaPagina(r, 0.5, 0.5), { x: 600, y: 350 });
  assert.deepEqual(pontoNaPagina(r, -3, 9), pontoNaPagina(r, 0, 1));
});

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

test("vagaDoCursor: 20 vagas diferentes dentro da área; o 21º volta à vaga do 1º (o novo toma a do mais antigo)", async () => {
  const { vagaDoCursor, MAX_CURSORES } = await import("../../dist/renderer/lib/instagramavel-core.js");
  assert.equal(MAX_CURSORES, 20);
  const area = { left: 200, top: 100, width: 1200, height: 700 };
  const vagas = Array.from({ length: 20 }, (_, i) => vagaDoCursor(i, area));
  assert.equal(new Set(vagas.map((v) => `${v.x},${v.y}`)).size, 20);
  for (const v of vagas) assert.ok(v.x >= area.left && v.x <= area.left + area.width - 280 && v.y >= area.top && v.y <= area.top + area.height, JSON.stringify(v));
  assert.deepEqual(vagaDoCursor(20, area), vagaDoCursor(0, area));
  // Janela estreita: uma coluna só, ainda 20 vagas distintas.
  assert.equal(new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(vagaDoCursor(i, { left: 0, top: 0, width: 400, height: 900 })))).size, 20);
});

test("textoDoBalao: /js e sondas não entram no palco (vazio)", async () => {
  const { textoDoBalao } = await import("../../dist/renderer/lib/instagramavel-core.js");
  assert.equal(textoDoBalao({ origem: "navegador", rota: "/js", ok: true, resumo: "js: 505 caracteres" }), "");
  assert.equal(textoDoBalao({ origem: "navegador", rota: "/abas", ok: true, resumo: "sonda: 3 aba(s)" }), "");
});
