import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoLimiteNoChat, avisoSemConta, estadoTexto, nomeConta, usoTexto } from "../../dist/renderer/lib/contas-claude.js";

const NOW = 1_800_000_000_000;
const conta = (over = {}) => ({ id: "c-00000001", rotulo: "Conta 2", email: "b@x.y", padrao: false, home: "/h", ordem: 1, ativa: true, logada: true, uso: { sessao: { pct: 42, resets: NOW / 1000 + 4800 }, semanal: { pct: 10, resets: NOW / 1000 + 3 * 86400 + 7200 }, estado: "ok", motivo: null, ate: null, vistoEm: null }, ...over });

test("estadoTexto: desligada, não logada, bloqueada, no limite com volta, aviso, em uso, pronta", () => {
  assert.deepEqual(estadoTexto(conta({ ativa: false }), null, NOW), { text: "desligada", tone: "muted" });
  assert.deepEqual(estadoTexto(conta({ logada: false }), null, NOW), { text: "não logada", tone: "err" });
  assert.deepEqual(estadoTexto(conta({ uso: { ...conta().uso, estado: "bloqueada", motivo: "login vencido" } }), null, NOW), { text: "bloqueada: login vencido", tone: "err" });
  assert.deepEqual(estadoTexto(conta({ uso: { ...conta().uso, estado: "esgotada", ate: NOW / 1000 + 600 } }), null, NOW), { text: "no limite · volta em 10min", tone: "err" });
  assert.deepEqual(estadoTexto(conta({ uso: { ...conta().uso, estado: "aviso" } }), "c-00000001", NOW), { text: "acima do limiar", tone: "warn" });
  assert.deepEqual(estadoTexto(conta(), "c-00000001", NOW), { text: "em uso", tone: "ok" });
  assert.deepEqual(estadoTexto(conta(), "padrao", NOW), { text: "pronta", tone: "ok" });
});

test("usoTexto e nomeConta", () => {
  assert.equal(usoTexto(conta(), NOW), "Sessão 42% · 1h20m · Semanal 10% · 3d2h");
  assert.equal(usoTexto(conta({ uso: { ...conta().uso, sessao: null, semanal: { pct: 7, resets: null } } }), NOW), "Semanal 7%");
  assert.equal(usoTexto(conta({ uso: { ...conta().uso, sessao: null, semanal: null } }), NOW), "");
  assert.equal(nomeConta(conta()), "Conta 2 · b@x.y");
  assert.equal(nomeConta(conta({ rotulo: "Claude · b@x.y" })), "Claude · b@x.y");
  assert.equal(nomeConta(conta({ email: null })), "Conta 2");
});

test("avisoSemConta: só quando nenhuma serve; diz a hora da volta", () => {
  assert.equal(avisoSemConta({ contas: [conta()], limiares: { sessao: 90, semanal: 95, estrategia: "ordem" }, atual: "c-00000001", proximaEm: null }), null);
  assert.match(avisoSemConta({ contas: [conta({ logada: false })], limiares: { sessao: 90, semanal: 95, estrategia: "ordem" }, atual: null, proximaEm: null }), /Nenhuma conta logada/);
  const noLimite = { contas: [conta()], limiares: { sessao: 90, semanal: 95, estrategia: "ordem" }, atual: null, proximaEm: NOW / 1000 + 600 };
  assert.match(avisoSemConta(noLimite), /no limite de uso\. A próxima volta às \d\d:\d\d; até lá o agente não responde\./);
  // só promete o grok-4 com a xAI logada nesta máquina
  assert.match(avisoSemConta(noLimite, true), /até lá o grok-4 responde\./);
  assert.match(avisoSemConta(noLimite, false), /até lá o agente não responde\./);
});

test("eventoTexto: quando · origem · de → para (motivo); sem conta livre e origens traduzidas", async () => {
  const { eventoTexto } = await import("../../dist/renderer/lib/contas-claude.js");
  const t = eventoTexto({ em: NOW / 1000, origem: "whatsapp", de: "Segunda", para: "Login padrão", motivo: "limite de uso", resets: null });
  assert.match(t, /^\d\d\/\d\d \d\d:\d\d · WhatsApp · Segunda → Login padrão \(limite de uso\)$/);
  assert.match(eventoTexto({ em: NOW / 1000, origem: "terminal", de: "A", para: null, motivo: "", resets: null }), /Terminal · A → nenhuma conta livre$/);
});

test("avisoLimiteNoChat: limite de uso vira o motivo em português; outros erros ficam como estão", () => {
  for (const code of ["model_limit", "conta_limite"]) {
    const a = avisoLimiteNoChat(code);
    assert.match(a.title, /limite de uso/); assert.match(a.text, /Não é falha do meu-bot/);
  }
  for (const code of [undefined, "auth", "cli_failed", "device_pending"]) assert.equal(avisoLimiteNoChat(code), null, String(code));
});
