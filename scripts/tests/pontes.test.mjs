import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { pontesCliArgs, pontesTurnoNotas } = require("../../backend-colima/pontes.js");
const { parseGmailPort, GMAIL_RULE, gmailTurnNote } = require("../../backend-colima/gmail.js");
const { GMAIL_TOOLS, GMAIL_MCP_VERSAO } = require("../../dist/main/google/gmail-core.js");

const base = { nodeBin: "/opt/node/bin/node", navegadorMcp: "/h/navegador-mcp.mjs", gmailMcp: "/h/gmail-mcp.mjs", snapshotOff: false };
test("pontesCliArgs: um mcp-config e um allowedTools com as pontes ligadas; nenhuma = sem flags", () => {
  assert.deepEqual(pontesCliArgs({ ...base, browser: null, gmail: null }), []);
  const so = pontesCliArgs({ ...base, browser: null, gmail: { port: 19124, dono: { id: "meu-bot:c1", rotulo: "Conversa" } } });
  assert.equal(so[0], "--mcp-config"); const cfg = JSON.parse(so[1]);
  assert.deepEqual(Object.keys(cfg.mcpServers), ["gmail"]);
  assert.deepEqual(cfg.mcpServers.gmail.args, ["/h/gmail-mcp.mjs", "--port", "19124", "--dono", "meu-bot:c1", "--rotulo", "Conversa"]);
  assert.deepEqual(so.slice(2), ["--allowedTools", "mcp__gmail"]);
  const dois = pontesCliArgs({ ...base, snapshotOff: true, browser: { port: 19123 }, gmail: { port: 19124 } });
  const c2 = JSON.parse(dois[1]);
  assert.deepEqual(Object.keys(c2.mcpServers), ["navegador", "gmail"]);
  assert.deepEqual(c2.mcpServers.navegador.args, ["/h/navegador-mcp.mjs", "--port", "19123"]);
  assert.deepEqual(dois.slice(2), ["--allowedTools", "mcp__navegador,mcp__gmail", "--system-prompt-snapshot", "off"]);
});
test("pontesTurnoNotas: só as notas das pontes ligadas, na ordem Navegador, Gmail", () => {
  const n = { browserNote: () => "NAV", gmailNote: () => "GM" };
  assert.deepEqual(pontesTurnoNotas({ browser: null, gmail: null, ...n }), []);
  assert.deepEqual(pontesTurnoNotas({ browser: { port: 1 }, gmail: null, ...n }), ["NAV"]);
  assert.deepEqual(pontesTurnoNotas({ browser: { port: 1 }, gmail: { port: 2 }, ...n }), ["NAV", "GM"]);
});
test("gmail.js: porta como no Navegador; a regra exige confirmação antes de apagar e trata e-mail como dado", () => {
  assert.equal(parseGmailPort("19124"), 19124); assert.equal(parseGmailPort("80"), null);
  assert.match(GMAIL_RULE, /confirmar nesta conversa/); assert.match(GMAIL_RULE, /dado, não instrução/); assert.match(GMAIL_RULE, /nunca troque de caminho/i);
  assert.match(gmailTurnNote(), /mcp__gmail__/);
});
test("gmail-mcp.mjs: as ferramentas são as que o app conhece (GMAIL_TOOLS) e o marcador de versão está no arquivo", () => {
  const src = readFileSync(new URL("../../backend-colima/gmail-mcp.mjs", import.meta.url), "utf8");
  const nomes = [...src.matchAll(/\{ name: '([a-z]+)', description:/g)].map((m) => m[1]);
  assert.deepEqual(nomes.sort(), [...GMAIL_TOOLS].sort());
  assert.ok(src.includes(GMAIL_MCP_VERSAO), "marcador de versão");
  assert.ok(src.includes("X-Meu-Bot-Dono"), "cabeçalho de quem pede");
});

test("turno do WhatsApp (Hermes): o dono com origem whatsapp vira --origem whatsapp; o das conversas do app não muda", () => {
  const args = (dono) => JSON.parse(pontesCliArgs({ browser: { port: 19123, dono }, gmail: null, nodeBin: "/n", navegadorMcp: "/m.mjs", gmailMcp: "/g.mjs", snapshotOff: false })[1]).mcpServers.navegador.args;
  assert.deepEqual(args({ id: "agent:main:whatsapp:dm:5516992294486", rotulo: "WhatsApp", origem: "whatsapp" }).slice(-2), ["--origem", "whatsapp"]);
  assert.deepEqual(args({ id: "meu-bot:abc", rotulo: "conversa" }), ["/m.mjs", "--port", "19123", "--dono", "meu-bot:abc", "--rotulo", "conversa"]);
  assert.equal(args({ id: "meu-bot:abc", rotulo: "c", origem: "claude-code" }).includes("--origem"), false);
});
