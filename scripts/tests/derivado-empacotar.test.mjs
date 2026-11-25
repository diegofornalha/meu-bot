// O caminho de empacotamento de um app derivado (scripts/produtos.mjs): `--produto <pasta>` lê a ficha e o ícone do
// repositório dele. Cada recusa sai com 64 e uma frase que diz o que falta; aqui o process.exit vira um throw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { derivadoFromArgv, produtoFromArgv, alvoDe, PRODUTOS } = await import("../produtos.mjs");

const FICHA = { nome: "meu-bot-vendas-staging", bundleId: "local.meu-bot-vendas.staging", canal: "staging", portaLocal: 8840, portaWsl: 2340, portaMcp: 7840 };
/** Roda `f` com process.exit e console.error trocados: devolve o código de saída e o que foi dito (ou o valor, se não saiu). */
function semSair(f) {
  const exit = process.exit, error = console.error; const dito = [];
  process.exit = (c) => { throw Object.assign(new Error("saiu"), { codigo: c }); };
  console.error = (...a) => { dito.push(a.join(" ")); };
  try { return { valor: f(), dito }; } catch (e) { if (e?.message !== "saiu") throw e; return { codigo: e.codigo, dito: dito.join("\n") }; } finally { process.exit = exit; console.error = error; }
}
function pasta({ ficha = FICHA, icone = true } = {}) {
  const d = mkdtempSync(join(tmpdir(), "meu-bot-derivado-"));
  if (ficha !== null) writeFileSync(join(d, "produto.json"), typeof ficha === "string" ? ficha : JSON.stringify(ficha));
  if (icone) { mkdirSync(join(d, "assets")); writeFileSync(join(d, "assets", "icon.icns"), "icns"); }
  return d;
}

test("--produto <pasta>: devolve o produto da ficha, com o ícone e a pasta do derivado, e leva o mesmo alvo aos outros scripts", () => {
  const d = pasta();
  try {
    const r = semSair(() => derivadoFromArgv(["node", "x", "--produto", d]));
    assert.equal(r.codigo, undefined, r.dito);
    const p = r.valor;
    assert.deepEqual([p.variant, p.nome, p.bundleId, p.portaMcp], ["derivado", "meu-bot-vendas-staging", "local.meu-bot-vendas.staging", 7840]);
    assert.equal(p.icone, join(p.pasta, "assets", "icon.icns"), "ícone em caminho absoluto, dentro da pasta do derivado");
    assert.deepEqual(p.ficha, FICHA, "a ficha crua vai para o asar");
    assert.deepEqual(alvoDe(p), ["--produto", p.pasta]);
    // produtoFromArgv dá preferência ao derivado; sem --produto, a tabela continua como era.
    assert.equal(semSair(() => produtoFromArgv(["node", "x", "--produto", d])).valor.nome, "meu-bot-vendas-staging");
  } finally { rmSync(d, { recursive: true, force: true }); }
  assert.equal(derivadoFromArgv(["node", "x", "--variant", "admin"]), null);
  const admin = produtoFromArgv(["node", "x", "--variant", "admin"]);
  assert.equal(admin, PRODUTOS.find((x) => x.variant === "admin"));
  assert.deepEqual(alvoDe(admin), ["--variant", "admin"]);
});

test("--produto: cada recusa sai com 64 e diz o que falta", () => {
  for (const argv of [["node", "x", "--produto"], ["node", "x", "--produto", ""], ["node", "x", "--produto", "--plataforma", "darwin"]]) {
    const r = semSair(() => derivadoFromArgv(argv));
    assert.equal(r.codigo, 64); assert.match(r.dito, /falta a pasta depois de --produto/);
  }
  const casos = [
    [{ ficha: null }, /não li a ficha do derivado em .*produto\.json/],
    [{ ficha: "{ isto não é json" }, /não li a ficha do derivado/],
    [{ ficha: { ...FICHA, portaMcp: 7830 } }, /ficha recusada .*portaMcp: 7830 já é de um app do core/],
    [{ ficha: { ...FICHA, nome: "vendas" } }, /ficha recusada .*nome:/],
    [{ icone: false }, /falta o ícone do derivado: .*assets\/icon\.icns/],
  ];
  for (const [opcoes, frase] of casos) {
    const d = pasta(opcoes);
    try { const r = semSair(() => derivadoFromArgv(["node", "x", "--produto", d])); assert.equal(r.codigo, 64, JSON.stringify(opcoes)); assert.match(r.dito, frase); } finally { rmSync(d, { recursive: true, force: true }); }
  }
});
