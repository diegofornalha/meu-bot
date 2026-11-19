import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELOS_PIPELINE, validarPipeline, etapasDoTexto, extrasDoModelo } from "../../dist/renderer/lib/crm-modelos.js";

test("modelos prontos são válidos; o livre começa vazio", () => {
  for (const m of MODELOS_PIPELINE.filter((x) => x.id !== "livre")) assert.equal(validarPipeline(m.nome, m.etapas).ok, true, m.id);
  const livre = MODELOS_PIPELINE.find((x) => x.id === "livre");
  assert.equal(livre.nome, ""); assert.deepEqual(livre.etapas, []);
});

test("validação: nome obrigatório, 2 a 12 etapas, sem repetir, espaços limpos", () => {
  assert.match(validarPipeline("  ", ["A", "B"]).erro, /nome/);
  assert.match(validarPipeline("X", ["A"]).erro, /pelo menos 2/);
  assert.match(validarPipeline("X", Array.from({ length: 13 }, (_, i) => `E${i}`)).erro, /máximo 12/);
  assert.match(validarPipeline("X", ["Novo", "novo"]).erro, /repetida/);
  assert.deepEqual(validarPipeline("  Vendas  LV ", [" Novo  contato ", "", "Fechado"]), { ok: true, name: "Vendas LV", stages: ["Novo contato", "Fechado"] });
  assert.deepEqual(etapasDoTexto("Novo\n Conversando ,Fechado\n\n"), ["Novo", "Conversando", "Fechado"]);
});

test("modelo Leads do site: etapas, campos com as opções das listas, e nasce com o agente autônomo", () => {
  const m = MODELOS_PIPELINE.find((x) => x.id === "leads-site");
  assert.equal(m.titulo, "Leads do site"); assert.equal(m.nome, "Leads do site");
  assert.deepEqual(m.etapas, ["Novo", "Respondido", "Link enviado", "Baixou", "Assinou", "Perdido"]);
  assert.deepEqual(extrasDoModelo("leads-site"), {
    fields: [
      { name: "Origem", type: "DROPDOWN", options: ["Anúncio", "Site", "Indicação", "Outro"] },
      { name: "Ref do anúncio", type: "TEXT", options: [] },
      { name: "Produto de interesse", type: "DROPDOWN", options: ["Pro", "Financeiro", "Módulos do Diego"] },
      { name: "Sistema", type: "DROPDOWN", options: ["Mac", "Windows", "Não sei"] },
    ],
    agenteAutonomo: true,
  });
  // Os outros modelos continuam nascendo só com as etapas, sem autonomia.
  for (const id of ["midia-paga", "testes", "livre", "nao-existe"]) assert.deepEqual(extrasDoModelo(id), {}, id);
});
