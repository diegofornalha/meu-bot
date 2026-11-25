import { test } from "node:test";
import assert from "node:assert/strict";
import { parte, resumoDaConversa, semSegredos, ultimasMensagens } from "../../dist/main/controle-remoto/estado-core.js";

test("parte: o valor passa; erro e demora viram {erro}, sem derrubar o retrato", async () => {
  assert.equal(await parte(() => 7), 7);
  assert.deepEqual(await parte(async () => ({ ok: true })), { ok: true });
  assert.deepEqual(await parte(() => { throw new Error("sem túnel"); }), { erro: "sem túnel" });
  assert.deepEqual(await parte(() => Promise.reject(new Error("caiu"))), { erro: "caiu" });
  assert.match((await parte(() => new Promise(() => {}), 20)).erro, /não respondeu/);
});

test("semSegredos: campos com cara de segredo saem em qualquer profundidade; o resto fica", () => {
  const entrada = { tema: "dark", mcpToken: "abc", google: { perfil: { email: "a@b.c" }, refresh: "r", escopos: ["x"] }, lista: [{ senha: "1", nome: "n" }], apiKey: "k", chaveLicenca: "z" };
  assert.deepEqual(semSegredos(entrada), { tema: "dark", google: { perfil: { email: "a@b.c" }, escopos: ["x"] }, lista: [{ nome: "n" }] });
  assert.equal(semSegredos(null), null); assert.equal(semSegredos("texto"), "texto");
});

const conversa = { id: "c1", host: "local", model: "claude", updatedAt: "2026-11-25T10:00:00Z", archived: false, openAsTab: true, messages: [{ role: "user", content: "  qual   a previsão\nde hoje?  " }, { role: "assistant", content: "sol" }] };

test("resumoDaConversa: título dado ou a primeira mensagem da pessoa; conta e estado", () => {
  assert.deepEqual(resumoDaConversa(conversa, true), { id: "c1", titulo: "qual a previsão de hoje?", maquina: "local", modelo: "claude", mensagens: 2, atualizadaEm: "2026-11-25T10:00:00Z", arquivada: false, aberta: true, ocupada: true });
  assert.equal(resumoDaConversa({ ...conversa, title: "Previsão" }, false).titulo, "Previsão");
  assert.equal(resumoDaConversa({ ...conversa, messages: [] }, false).titulo, "(sem mensagens)");
});

test("ultimasMensagens: as últimas N com a posição, de quem é, e o corte marcado", () => {
  const ms = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` }));
  const u = ultimasMensagens(ms, 3);
  assert.deepEqual(u.map((x) => [x.indice, x.de, x.texto]), [[27, "agente", "m27"], [28, "pessoa", "m28"], [29, "agente", "m29"]]);
  assert.equal(ultimasMensagens(ms, undefined).length, 20);
  assert.equal(ultimasMensagens(ms, 9999).length, 30);
  const longa = ultimasMensagens([{ role: "assistant", content: "x".repeat(5000) }], 1)[0];
  assert.equal(longa.texto.length, 4000); assert.equal(longa.cortada, true);
});
