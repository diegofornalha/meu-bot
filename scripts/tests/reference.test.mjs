import { test } from "node:test";
import assert from "node:assert/strict";
import { botReferenceText, conversationReferenceText, waReferenceText } from "../../dist/renderer/lib/reference.js";

test("espelho do meu-bot: caminho do .jsonl pela pasta do projeto", () => {
  assert.equal(botReferenceText({ project: "-home-box-chat-workspace", sessionId: "1b016dff-349c-41f0-90ee-ef1fae699c42" }, "colima"),
    "meu-bot · colima · ~/.claude/projects/-home-box-chat-workspace/1b016dff-349c-41f0-90ee-ef1fae699c42.jsonl");
  // Diário do backend (Grok/Hermes): o arquivo em ~/.local/share/meu-bot/conversas.
  assert.equal(botReferenceText({ project: "conversas", sessionId: "2026-10-17T03-41-42-337Z-1", source: "app" }, "agente-box"),
    "meu-bot · agente-box · ~/.local/share/meu-bot/conversas/2026-10-17T03-41-42-337Z-1.jsonl");
});

test("aba do meu-bot: caminho vindo do backend com ~; sem sessão, plano B com o id do app", () => {
  assert.equal(conversationReferenceText("2026-10-17T00-01-02-000Z-3", "colima", { sessionId: "abc", profile: "claudecode", file: "/home/box/.claude/projects/-home-box-chat-workspace/abc.jsonl" }),
    "meu-bot · colima · ~/.claude/projects/-home-box-chat-workspace/abc.jsonl");
  assert.equal(conversationReferenceText("x", "colima", { sessionId: "abc", profile: "agente", file: "/root/.claude/projects/-root-agent-workspace/abc.jsonl" }),
    "meu-bot · colima · ~/.claude/projects/-root-agent-workspace/abc.jsonl");
  assert.match(conversationReferenceText("conv-1", "colima", null), /^meu-bot · colima · conversa conv-1 \(ainda sem transcrição/);
  assert.match(conversationReferenceText("conv-1", "colima", null, "claudecode"), /ainda sem transcrição/);
  // Grok e Hermes não passam pelo Claude Code: nunca haverá .jsonl; o texto diz isso em vez de mandar tentar de novo.
  assert.equal(conversationReferenceText("conv-1", "agente-box", null, "outro-motor"), "meu-bot · agente-box · conversa conv-1 · outro-motor (o histórico fica só neste app, não há transcrição na máquina)");
});

test("whatsapp: número, chave e sessão; uma linha por sessão; sem UUID omite; sem sessão avisa", () => {
  const k1 = "agent:main:whatsapp:direct:+5516992294486";
  assert.equal(waReferenceText({ number: "5516992294486", sessionKeys: [k1], sessionIds: { [k1]: "5e6c65a1-1385-42a6-ac5c-065d3366f3e2" } }, "colima"),
    `whatsapp · colima · +5516992294486 · ${k1} · sessão 5e6c65a1-1385-42a6-ac5c-065d3366f3e2`);
  const two = waReferenceText({ number: "5516992294486", sessionKeys: [k1, "agent:main:main"], sessionIds: { "agent:main:main": "m-1" } }, "colima").split("\n");
  assert.equal(two.length, 2);
  assert.equal(two[0], `whatsapp · colima · +5516992294486 · ${k1}`);
  assert.equal(two[1], "whatsapp · colima · +5516992294486 · agent:main:main · sessão m-1");
  assert.match(waReferenceText({ number: "5516992294486", sessionKeys: [], sessionIds: {} }, "colima"), /sem sessão/);
});

test("ID do grupo: nome, jid, chave e sessão do OpenClaw e o .jsonl do Claude Code na segunda linha", async () => {
  const { grupoReferenceText } = await import("../../dist/renderer/lib/reference.js");
  const g = { jid: "120363000000000001@g.us", nome: "Time", sessionKey: "agent:main:whatsapp:group:120363000000000001@g.us", sessionId: "22bb9aae-56c4", transcript: "~/.claude/projects/-home-x--openclaw-workspace/e23e862d.jsonl" };
  assert.equal(grupoReferenceText(g, "box-lv"), 'whatsapp · box-lv · grupo "Time" · 120363000000000001@g.us · agent:main:whatsapp:group:120363000000000001@g.us · sessão 22bb9aae-56c4\nwhatsapp · box-lv · ~/.claude/projects/-home-x--openclaw-workspace/e23e862d.jsonl');
  assert.match(grupoReferenceText({ ...g, transcript: null }, "m"), /sessão 22bb9aae-56c4$/);
  assert.match(grupoReferenceText({ ...g, sessionKey: null }, "m"), /sem sessão do agente ainda/);
});
