import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { parseBotChatList, parseClaudeTranscript, parseAppTranscript, botChatTitle, APP_CONV_ID_RE } = createRequire(import.meta.url)("../../dist/main/conversa/bot-chats.js");

const userLine = (text, ts = "2026-10-16T18:17:56.276Z") => JSON.stringify({ type: "user", message: { role: "user", content: text }, timestamp: ts });
const asst = (content, ts = "2026-10-16T18:18:01.000Z") => JSON.stringify({ type: "assistant", message: { role: "assistant", content }, timestamp: ts });

test("parseBotChatList: uma linha por sessão, título da 1ª fala sem o 'User: ', mais recente primeiro; ruído fora", () => {
  const out = parseBotChatList([
    `F\t4d2f86f4-2bc4-4e23-82a3-5442c26b36b6\t1792170000\t-home-box-guest-agent-workspace\t3\t${userLine("User: Oi! Me responde em uma linha, só para eu ver a status line aqui embaixo.")}`,
    `F\taaaaaaaa-0000-1111-2222-333333333333\t1792180000\t-home-box-guest-chat-workspace\t1\t${userLine("User: " + "x".repeat(100))}`,
    `F\tbbbbbbbb-0000-1111-2222-333333333333\t1792190000\t-home-box-guest-chat-workspace\t0\t`,
    "lixo sem tab", `F\t../../etc\t1\tdir\t0\t${userLine("User: oi")}`, `F\tcccccccc-0000-1111-2222-333333333333\tNaN\tdir\t0\t${userLine("User: oi")}`,
  ].join("\n"));
  assert.equal(out.length, 2);
  assert.equal(out[0].sessionId, "aaaaaaaa-0000-1111-2222-333333333333"); assert.equal(out[0].title.length, 90); assert.ok(out[0].title.endsWith("…"));
  assert.equal(out[1].title, "Oi! Me responde em uma linha, só para eu ver a status line aqui embaixo."); assert.equal(out[1].replies, 3); assert.equal(out[1].project, "-home-box-guest-agent-workspace");
  assert.equal(out[1].updatedAt, new Date(1792170000 * 1000).toISOString());
  assert.equal(botChatTitle("  User:   "), "(sem texto)");
});

test("parseClaudeTranscript: user/assistant em ordem, ferramentas como linhas próprias, resto ignorado", () => {
  const text = [
    JSON.stringify({ type: "queue-operation", operation: "enqueue", content: "User: nada" }),
    userLine("User: Oi! Me responde em uma linha."),
    JSON.stringify({ type: "attachment", attachment: { type: "environment" } }),
    asst([{ type: "text", text: "Oi! Tudo certo por aqui." }]),
    userLine("User: lista os arquivos", "2026-10-16T18:19:00.000Z"),
    asst([{ type: "tool_use", name: "Bash", input: { command: "ls" } }], "2026-10-16T18:19:02.000Z"),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "a.txt" }] }, timestamp: "2026-10-16T18:19:03.000Z" }),
    asst([{ type: "text", text: "Tem um arquivo: a.txt" }], "2026-10-16T18:19:04.000Z"),
    "linha quebrada {",
  ].join("\n");
  const msgs = parseClaudeTranscript(text);
  assert.deepEqual(msgs.map((m) => [m.role, m.text]), [
    ["person", "Oi! Me responde em uma linha."], ["agent", "Oi! Tudo certo por aqui."],
    ["person", "lista os arquivos"], ["tool", "Bash"], ["agent", "Tem um arquivo: a.txt"],
  ]);
  assert.equal(msgs[0].at, "2026-10-16T18:17:56.276Z");
});

test("lista: linhas A (diário do backend, provedores fora do Claude Code) entram com source app e provedor; F continua claude", () => {
  const first = JSON.stringify({ at: "2026-10-17T03:42:10.000Z", role: "user", model: "nuvem", provider: "nuvem", text: "Oi! Qual modelo está respondendo agora?" });
  const out = parseBotChatList([
    `A\t2026-10-17T03-41-42-337Z-1\t1760672530\tnuvem\t1\t${first}`,
    `A\tid curto\t1760672530\tnuvem\t1\t${first}`,
    `F\t1b016dff-349c-41f0-90ee-ef1fae699c42\t1760672000\t-home-box-chat-workspace\t2\t${JSON.stringify({ type: "user", message: { role: "user", content: "User: oi" } })}`,
  ].join("\n"));
  assert.deepEqual(out.map((c) => [c.sessionId, c.source, c.provider ?? null, c.project, c.title]), [
    ["2026-10-17T03-41-42-337Z-1", "app", "nuvem", "conversas", "Oi! Qual modelo está respondendo agora?"],
    ["1b016dff-349c-41f0-90ee-ef1fae699c42", "claude", null, "-home-box-chat-workspace", "oi"],
  ]);
  assert.ok(APP_CONV_ID_RE.test("2026-10-17T03-41-42-337Z-1") && !APP_CONV_ID_RE.test("a b"));
});

test("parseAppTranscript: user/assistant em ordem com o provedor na resposta; lixo ignorado", () => {
  const msgs = parseAppTranscript([
    JSON.stringify({ at: "2026-10-17T03:42:10.000Z", role: "user", model: "nuvem", provider: "nuvem", text: "Qual modelo?" }),
    JSON.stringify({ at: "2026-10-17T03:42:13.000Z", role: "assistant", model: "nuvem", provider: "nuvem", text: "Sou o modelo nuvem." }),
    "{quebrado",
    JSON.stringify({ role: "assistant", text: "" }),
  ].join("\n"));
  assert.deepEqual(msgs, [
    { role: "person", text: "Qual modelo?", at: "2026-10-17T03:42:10.000Z" },
    { role: "agent", text: "Sou o modelo nuvem.", at: "2026-10-17T03:42:13.000Z", provider: "nuvem" },
  ]);
});
