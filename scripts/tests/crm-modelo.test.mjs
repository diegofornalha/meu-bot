import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const m = createRequire(import.meta.url)("../../backend-colima/crm-modelo.js");

let n = 0;
const rnd = (k) => Buffer.from(String(++n).padStart(k * 2, "0").slice(0, k * 2), "hex");
const T = 1_760_000_000_000;
const pipe = () => m.novoPipeline({ name: "Parceiros", stages: ["Prospecção", "Qualificação", "Acordo"], fields: [{ name: "Origem", type: "DROPDOWN", options: ["Redes sociais", "Indicação"] }, { name: "Tags", type: "TAG", options: ["Quente", "Frio"] }, { name: "Valor", type: "NUMBER" }, { name: "Retorno", type: "DATE" }, { name: "Ativo", type: "CHECKBOX" }, { name: "Obs", type: "TEXT" }] }, T, rnd);

test("novoPipeline: etapas em ordem, campos com opções e chaves geradas; nomes repetidos recusados", () => {
  const p = pipe();
  assert.equal(p.name, "Parceiros"); assert.deepEqual(p.stages.map((s) => s.name), ["Prospecção", "Qualificação", "Acordo"]);
  assert.match(p.key, /^p_[A-Za-z0-9_-]{12}$/); assert.match(p.stages[0].key, /^s_/); assert.match(p.fields[0].options[0].key, /^o_/);
  assert.equal(m.novoPipeline({ name: "X" }, T, rnd).stages.length, 1, "sem etapas ganha uma");
  assert.throws(() => m.novoPipeline({ name: "X", stages: ["A", "a"] }, T, rnd), /etapa repetida/);
  assert.throws(() => m.novoPipeline({ name: "" }, T, rnd), /precisa de nome/);
  const imp = m.novoPipeline({ key: "agxzStreakKey", name: "Imp", stages: [{ key: "5001", name: "A" }], fields: [{ key: "1001", name: "F", type: "DROPDOWN", options: [{ key: "9001", name: "x" }] }] }, T, rnd);
  assert.equal(imp.key, "agxzStreakKey"); assert.equal(imp.stages[0].key, "5001"); assert.equal(imp.fields[0].options[0].key, "9001");
});

test("parseValue/formatValue: mesma semântica do streak.mjs (opção por nome, data dd/mm/aaaa, número pt-BR, checkbox)", () => {
  const p = pipe(); const f = (nome) => m.findField(p, nome);
  assert.equal(m.parseValue(f("Origem"), "redes"), p.fields[0].options[0].key, "prefixo sem acento");
  assert.equal(m.parseValue(f("Origem"), p.fields[0].options[1].key), p.fields[0].options[1].key, "chave da opção passa direto");
  assert.throws(() => m.parseValue(f("Origem"), "Outra"), /opção "Outra" não existe em "Origem"; opções: Redes sociais \| Indicação/);
  assert.deepEqual(m.parseValue(f("Tags"), "quente, frio"), [p.fields[1].options[0].key, p.fields[1].options[1].key]);
  assert.equal(m.parseValue(f("Retorno"), "25/12/2026"), Date.UTC(2026, 11, 25, 12));
  assert.throws(() => m.parseValue(f("Retorno"), "ontem"), /data inválida/);
  assert.equal(m.parseValue(f("Valor"), "1.234,50"), 1234.5); assert.equal(m.parseValue(f("Valor"), 7), 7);
  assert.throws(() => m.parseValue(f("Valor"), "abc"), /número inválido/);
  assert.equal(m.parseValue(f("Ativo"), "sim"), true); assert.equal(m.parseValue(f("Ativo"), false), false);
  assert.equal(m.parseValue(f("Obs"), "  texto  "), "texto"); assert.equal(m.parseValue(f("Obs"), ""), null);
  assert.equal(m.formatValue(f("Origem"), p.fields[0].options[1].key), "Indicação");
  assert.equal(m.formatValue(f("Retorno"), Date.UTC(2026, 11, 25, 12)), "25/12/2026");
  assert.equal(m.formatValue(f("Ativo"), true), "sim");
});

test("findStage/findField: por chave, nome exato, prefixo e trecho, sem acento", () => {
  const p = pipe();
  assert.equal(m.findStage(p, "qualificacao").name, "Qualificação");
  assert.equal(m.findStage(p, "acor").name, "Acordo");
  assert.equal(m.findStage(p, p.stages[2].key).name, "Acordo");
  assert.equal(m.findStage(p, "zzz"), null); assert.equal(m.findStage(p, ""), null);
  assert.equal(m.findField(p, "orig").name, "Origem");
});

test("novoBox/patchBox: etapa por nome, campos por nome ou chave, limites; nada para mudar lança", () => {
  const p = pipe();
  const b = m.novoBox(p, { name: " Junior ", stage: "qualif", notes: "nota", fields: { Origem: "indicação", valor: "10" } }, T, rnd);
  assert.equal(b.name, "Junior"); assert.equal(b.stageKey, p.stages[1].key); assert.equal(b.fields[p.fields[0].key], p.fields[0].options[1].key); assert.equal(b.fields[p.fields[2].key], 10);
  assert.equal(m.novoBox(p, { name: "X" }, T, rnd).stageKey, p.stages[0].key, "sem etapa vai para a primeira");
  assert.throws(() => m.novoBox(p, { name: "X", stage: "Nada" }, T, rnd), /etapa "Nada" não existe; etapas: Prospecção \| Qualificação \| Acordo/);
  assert.throws(() => m.novoBox(p, { name: "X", fields: { Inexistente: 1 } }, T, rnd), /campo "Inexistente" não existe/);
  const b2 = m.patchBox(p, b, { stage: "Acordo", fields: { [p.fields[2].key]: "", Obs: "ok" } }, T + 1);
  assert.equal(b2.stageKey, p.stages[2].key); assert.equal(b2.fields[p.fields[2].key], undefined, "valor vazio apaga o campo"); assert.equal(b2.fields[p.fields[5].key], "ok"); assert.equal(b2.updatedAt, T + 1);
  assert.throws(() => m.patchBox(p, b, {}, T), /nada para mudar/);
});

test("patchPipeline: renomear/reordenar etapas, remover etapa com box exige moverPara; campo removido some dos boxes", () => {
  const p = pipe(); const b = m.novoBox(p, { name: "A", stage: "Acordo" }, T, rnd);
  const r = m.patchPipeline(p, { stages: [p.stages[2], p.stages[0], { name: "Nova" }] }, [b], T, rnd);
  assert.deepEqual(r.pipeline.stages.map((s) => s.name), ["Acordo", "Prospecção", "Nova"]);
  assert.equal(r.pipeline.stages[0].key, p.stages[2].key, "chave preservada");
  assert.deepEqual(r.moverEtapas, {}, "Qualificação removida sem boxes: nada a mover");
  assert.throws(() => m.patchPipeline(p, { stages: [p.stages[0]] }, [b], T, rnd), /tem 1 box\(es\); informe moverPara/);
  const r2 = m.patchPipeline(p, { stages: [p.stages[0]], moverPara: "Prospecção" }, [b], T, rnd);
  assert.deepEqual(r2.moverEtapas, { [p.stages[2].key]: p.stages[0].key });
  const r3 = m.patchPipeline(p, { fields: p.fields.slice(1) }, [b], T, rnd);
  assert.deepEqual(r3.removerCampos, [p.fields[0].key]);
  assert.throws(() => m.patchPipeline(p, { stages: [] }, [], T, rnd), /ao menos uma etapa/);
});

test("comentários, threads e contatos", () => {
  const p = pipe(); let b = m.novoBox(p, { name: "A" }, T, rnd);
  const { box, comentario } = m.addComment(b, " 16/10: pediu os links ", "agente", T + 5, rnd);
  assert.equal(box.comentarios.length, 1); assert.equal(comentario.texto, "16/10: pediu os links"); assert.equal(comentario.autor, "agente");
  assert.throws(() => m.addComment(b, "  ", "x", T, rnd), /comentário vazio/);
  b = m.addThread(box, { threadGmailId: "1A1544925ACE5958", assunto: "Oi", emails: ["A@B.com"] }, T + 6);
  assert.equal(b.threads[0].gid, "1a1544925ace5958"); assert.deepEqual(b.threads[0].emails, ["a@b.com"]);
  assert.equal(m.addThread(b, { threadGmailId: "1a1544925ace5958" }, T + 7).threads.length, 1, "mesma thread não duplica");
  assert.throws(() => m.addThread(b, { threadGmailId: "xyz" }, T), /threadGmailId deve ser/);
  assert.equal(m.removeThread(b, "1a1544925ace5958", T).threads.length, 0);
  const c1 = m.upsertContato([], { name: "Junior Silva", phone: "+595 994 402 904" }, T, rnd);
  assert.equal(c1.novo, true); assert.deepEqual(c1.contato.telefones, ["+595994402904"]); assert.equal(c1.contato.nome, "Junior Silva");
  const c2 = m.upsertContato([c1.contato], { phone: "595994402904", email: "j@x.com" }, T + 1, rnd);
  assert.equal(c2.novo, false); assert.equal(c2.contato.key, c1.contato.key); assert.deepEqual(c2.contato.emails, ["j@x.com"]); assert.equal(c2.contato.nome, "Junior Silva", "nome não some");
  const c3 = m.upsertContato([c2.contato], { email: "J@X.COM", name: "Novo Nome" }, T + 2, rnd);
  assert.equal(c3.novo, false, "acha pelo e-mail"); assert.equal(c3.contato.nome, "Novo Nome");
  assert.throws(() => m.upsertContato([], { name: "" }, T, rnd), /precisa de nome, e-mail ou telefone/);
});

test("buscar: telefone (contato, mapa legado, dígitos nas notas), nome, texto, e-mail (@dominio, thread), thread", () => {
  const p = pipe(); const c = m.upsertContato([], { name: "Junior", phone: "+595994402904", email: "junior@empresa.com" }, T, rnd).contato;
  const b1 = { ...m.novoBox(p, { name: "Junior Rezende", notes: "fala +55 11 99999-0000" }, T, rnd), contatos: [c.key] };
  const b2 = m.addThread(m.novoBox(p, { name: "Kommo deal" }, T, rnd), { threadGmailId: "1a1544925ace5958", emails: ["x@kommo.com"] }, T);
  const b3 = m.novoBox(p, { name: "Outro" }, T, rnd);
  const ctx = { boxes: [b1, b2, b3], contatos: [c], legacyPhones: { "+5511888887777": b3.key } };
  assert.deepEqual(m.buscar(ctx, { phone: "595994402904" }).boxes.map((b) => b.key), [b1.key], "pelo contato");
  assert.deepEqual(m.buscar(ctx, { phone: "+55 11 99999 0000" }).boxes.map((b) => b.key), [b1.key], "dígitos nas notas");
  assert.deepEqual(m.buscar(ctx, { phone: "+5511888887777" }).boxes.map((b) => b.key), [b3.key], "mapa legado do crm.json");
  assert.deepEqual(m.buscar(ctx, { name: "rezende" }).boxes.map((b) => b.key), [b1.key]);
  assert.deepEqual(m.buscar(ctx, { query: "kommo" }).boxes.map((b) => b.key), [b2.key]);
  assert.deepEqual(m.buscar(ctx, { email: "@kommo.com" }).boxes.map((b) => b.key), [b2.key], "e-mail da thread");
  assert.deepEqual(m.buscar(ctx, { email: "junior@empresa.com" }).boxes.map((b) => b.key), [b1.key], "e-mail do contato");
  assert.deepEqual(m.buscar(ctx, { thread: "1A1544925ACE5958" }).boxes.map((b) => b.key), [b2.key]);
  assert.equal(m.buscar(ctx, { query: "" }).total, 3, "texto vazio lista tudo");
  assert.equal(m.buscar(ctx, { name: "x" }, 1).total, 0);
  assert.throws(() => m.buscar(ctx, {}), /use phone, name, query, email ou thread/);
  const v = m.boxView(b1, p, [c]);
  assert.equal(v.stage, "Prospecção"); assert.equal(v.contatos[0].telefones[0], "+595994402904"); assert.equal(v.threads, 0); assert.deepEqual(v.fields, {});
});

test("promptConsolidacao leva o resumo anterior e corta transcrição longa no início; parseConsolidacao limpa", () => {
  const p = m.promptConsolidacao({ nome: "Ana", telefone: "+5511999990000", resumoAnterior: "Quer orçamento.", transcricao: `${"a".repeat(70000)}FIM` });
  assert.match(p, /Quer orçamento\./); assert.match(p, /início cortado/); assert.match(p, /FIM/); assert.ok(p.length < 62000);
  assert.equal(m.parseConsolidacao("```\nResumo novo\n```"), "Resumo novo");
  assert.throws(() => m.parseConsolidacao("  "));
});

test("agenteAutonomo: ausente = false; criar e editar com true; valor não booleano é recusado", () => {
  const p = pipe();
  assert.equal(p.agenteAutonomo, false, "sem a marca na criação");
  assert.equal(m.pipelineView(p).agenteAutonomo, false);
  const { agenteAutonomo: _, ...antigo } = p;
  assert.equal(m.pipelineView(antigo).agenteAutonomo, false, "pipeline gravado antes da marca");
  const a = m.novoPipeline({ name: "Leads", agenteAutonomo: true }, T, rnd);
  assert.equal(a.agenteAutonomo, true); assert.equal(m.pipelineView(a).agenteAutonomo, true);
  const ligado = m.patchPipeline(p, { agenteAutonomo: true }, [], T + 1, rnd).pipeline;
  assert.equal(ligado.agenteAutonomo, true); assert.deepEqual(ligado.stages, p.stages, "o resto não muda");
  assert.equal(m.patchPipeline(ligado, { name: "Outro nome" }, [], T + 2, rnd).pipeline.agenteAutonomo, true, "patch sem a marca não a apaga");
  assert.equal(m.patchPipeline(ligado, { agenteAutonomo: false }, [], T + 2, rnd).pipeline.agenteAutonomo, false);
  for (const ruim of ["true", 1, null, "sim"]) {
    assert.throws(() => m.novoPipeline({ name: "X", agenteAutonomo: ruim }, T, rnd), (e) => e.code === "invalido" && /agenteAutonomo/.test(e.message), String(ruim));
    assert.throws(() => m.patchPipeline(p, { agenteAutonomo: ruim }, [], T, rnd), (e) => e.code === "invalido", String(ruim));
  }
});
