import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { STATUS, aplicarPatch, checklist, definicao, nomeValido, parseProdutoPatch, parseProdutos, vazio } = createRequire(import.meta.url)("../../dist/main/admin/produtos-core.js");
const T = Date.parse("2026-10-19T12:00:00.000Z");

test("nomeValido: meu-bot-<slug> em minúsculas; os três produtos existentes são reservados", () => {
  assert.equal(nomeValido("meu-bot-fit"), true); assert.equal(nomeValido("meu-bot-imobiliaria-sp"), true);
  assert.equal(nomeValido("meu-bot"), false); assert.equal(nomeValido("meu-bot-crm"), false); assert.equal(nomeValido("meu-bot-Fit"), false); assert.equal(nomeValido("fit"), false); assert.equal(nomeValido("meu-bot--x"), false);
  // Reservados saem da tabela de produtos (variant-core.ts): o inspector-staging escapava da lista escrita à mão.
  for (const n of ["meu-bot-finance", "meu-bot-grok", "meu-bot-inspector-staging", "meu-bot-staging", "meu-bot-admin", "meu-bot-crm-staging"]) assert.equal(nomeValido(n), false, n);
});
test("parseProdutoPatch: nome obrigatório; só o que veio entra; campos e etapas saneados", () => {
  assert.throws(() => parseProdutoPatch({ nome: "fit" }), /meu-bot-<algo>/);
  const p = parseProdutoPatch({ nome: " MEU-BOT-FIT ", pitch: "  gestão  de academia ", pipeline: { etapas: ["Lead", "", "Matrícula"], campos: [{ nome: "Plano", tipo: "DROPDOWN" }, { nome: "x", tipo: "LIXO" }, { nome: "" }] }, status: "mvp", bogus: 1 });
  assert.equal(p.nome, "meu-bot-fit"); assert.equal(p.pitch, "gestão de academia"); assert.deepEqual(p.pipeline, { etapas: ["Lead", "Matrícula"], campos: [{ nome: "Plano", tipo: "DROPDOWN" }, { nome: "x", tipo: "TEXT" }] }); assert.equal(p.status, "mvp");
  assert.equal("vertical" in p, false, "campo que não veio não entra no patch"); assert.equal("bogus" in p, false);
  assert.equal(parseProdutoPatch({ nome: "meu-bot-fit", status: "zzz" }).status, "ideia", "status inválido vira ideia");
});
test("aplicarPatch e parseProdutos: cria com defaults, edita preservando createdAt, lê o arquivo sem repetidos e ordenado", () => {
  const a = aplicarPatch(null, { nome: "meu-bot-fit", vertical: "academias" }, T);
  assert.equal(a.createdAt, "2026-10-19T12:00:00.000Z"); assert.equal(a.modulos.crm, true); assert.deepEqual(a.pipeline, { etapas: [], campos: [] });
  const b = aplicarPatch(a, { nome: "meu-bot-fit", status: "beta", modulos: { ...a.modulos, crm: false } }, T + 1000);
  assert.equal(b.createdAt, a.createdAt); assert.equal(b.updatedAt, "2026-10-19T12:00:01.000Z"); assert.equal(b.vertical, "academias"); assert.equal(b.modulos.crm, false);
  const lidos = parseProdutos({ produtos: [b, { nome: "meu-bot-vendas" }, { nome: "meu-bot-fit", pitch: "repetido" }, { nome: "lixo" }, null] }, T);
  assert.deepEqual(lidos.map((p) => p.nome), ["meu-bot-fit", "meu-bot-vendas"]); assert.equal(lidos[0].status, "beta", "o primeiro vence");
  assert.deepEqual(parseProdutos("lixo"), []); assert.deepEqual(STATUS, ["ideia", "mvp", "beta", "lancado"]);
});
test("definicao e checklist: o insumo da implementação como variante", () => {
  const p = vazio("meu-bot-fit", T);
  const d = definicao({ ...p, modulos: { ...p.modulos, whatsapp: false } });
  assert.equal(d.variant, "fit"); assert.equal(d.bundleId, "local.meu-bot-fit"); assert.equal(d.icone, "assets/icon-fit.icns"); assert.equal(d.planoExigido, "free"); assert.equal(d.addon, "meu-bot-fit"); assert.equal(d.caps.pair, false); assert.equal(d.caps.crm, true);
  const c = checklist(p);
  assert.ok(c[0].startsWith("Escrever a ideia")); assert.ok(!c.some((x) => x.includes("público")), "público saiu do formulário e do checklist"); assert.ok(c.some((x) => x.includes("variant-core.ts"))); assert.ok(c.some((x) => x.includes("icon-fit.svg"))); assert.ok(c.some((x) => x.includes("--variant fit"))); assert.ok(c.some((x) => x.includes("ADDONS") && x.includes("backend-colima/licenca.js")));
  const pronto = checklist({ ...p, pitch: "x", publico: "y", pipeline: { etapas: ["A"], campos: [] } });
  assert.ok(!pronto.some((x) => x.startsWith("Escrever") || x.startsWith("Dizer") || x.startsWith("Definir")));
});
