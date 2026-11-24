import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const sc = require("../../backend-colima/sem-claude.js");
const T0 = Date.parse("2026-11-23T05:06:00.000Z");
const pasta = () => mkdtempSync(join(tmpdir(), "sem-claude-"));

test("sem Claude: a marca começa uma vez, é renovada sem mudar o início e vence sozinha", () => {
  const arq = join(pasta(), "sub", "sem-claude.json");
  assert.equal(sc.estado(T0, arq), null);
  assert.deepEqual(sc.marcar("o Claude Code Global está no limite até 02:00", T0, arq), { novo: true, desde: "2026-11-23T05:06:00.000Z" });
  assert.equal(statSync(arq).mode & 0o777, 0o600);
  const m = sc.estado(T0 + 1000, arq);
  assert.deepEqual(m, { desde: "2026-11-23T05:06:00.000Z", ate: new Date(T0 + sc.VALE_MS).toISOString(), motivo: "o Claude Code Global está no limite até 02:00" });
  // A sonda falhou de novo: renova o prazo, e a queda continua contada do começo.
  assert.deepEqual(sc.marcar("ainda fora", T0 + sc.SONDA_MS, arq), { novo: false, desde: "2026-11-23T05:06:00.000Z" });
  assert.equal(sc.estado(T0 + sc.SONDA_MS + sc.VALE_MS - 1, arq).motivo, "ainda fora");
  // Sem renovação (backend parado): vence, e as mensagens voltam a passar.
  assert.equal(sc.estado(T0 + sc.SONDA_MS + sc.VALE_MS, arq), null);
  assert.equal(sc.marcar("de novo", T0 + 2 * sc.VALE_MS, arq).novo, true, "depois de vencida, é outra queda");
  assert.ok(sc.VALE_MS >= 3 * sc.SONDA_MS, "a marca aguenta sondas que demoram ou falham");
});

test("sem Claude: limpar devolve a marca que valia; arquivo ilegível ou incompleto não é marca", () => {
  const arq = join(pasta(), "sem-claude.json");
  assert.equal(sc.limpar(T0, arq), null);
  sc.marcar("x", T0, arq);
  assert.equal(sc.limpar(T0 + 5000, arq).desde, "2026-11-23T05:06:00.000Z");
  assert.ok(!existsSync(arq));
  for (const lixo of ["{lixo", "[]", JSON.stringify({ desde: "2026-11-23T05:06:00.000Z" }), JSON.stringify({ desde: "ontem", ate: new Date(T0 + 60000).toISOString() })]) {
    writeFileSync(arq, lixo);
    assert.equal(sc.estado(T0, arq), null, lixo);
  }
});

test("sem Claude: conta só as mensagens guardadas pela queda, desde o começo dela; os avisos ao dono dizem a hora e o que acontece", () => {
  const f = join(pasta(), "whatsapp-pausados.jsonl");
  assert.equal(sc.guardadasDesde("2026-11-23T05:06:00.000Z", f), 0);
  writeFileSync(f, [
    { numero: "1", texto: "antes", em: "2026-11-23T04:00:00Z", tipo: "text", motivo: "sem-claude" },
    { numero: "2", texto: "pausado de verdade", em: "2026-11-23T06:00:00Z", tipo: "text" },
    { numero: "3", texto: "na queda", em: "2026-11-23T06:10:00Z", tipo: "text", motivo: "sem-claude" },
    { numero: "3", texto: "cita sem-claude no texto", em: "2026-11-23T06:11:00Z", tipo: "text" },
    { numero: "4", texto: "[áudio]", em: "2026-11-23T07:00:00Z", tipo: "voice", motivo: "sem-claude" },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n{quebrada\n");
  assert.equal(sc.guardadasDesde("2026-11-23T05:06:00.000Z", f), 2);
  const m = { desde: "2026-11-23T05:06:00.000Z", motivo: "limite da assinatura" };
  assert.match(sc.avisoCaiu(m, "America/Sao_Paulo"), /parou de responder às 02:06 \(limite da assinatura\)/);
  assert.match(sc.avisoCaiu(m, "America/Sao_Paulo"), /não recebe resposta nem mensagem de erro/);
  const volta = Date.parse("2026-11-24T01:58:00.000Z");
  assert.match(sc.avisoVoltou(m, 2, volta, "America/Sao_Paulo"), /voltou às 22:58 \(estava fora desde 02:06\)\. 2 mensagens chegaram/);
  assert.match(sc.avisoVoltou(m, 1, volta, "America/Sao_Paulo"), /1 mensagem chegou/);
  assert.match(sc.avisoVoltou(m, 0, volta, "America/Sao_Paulo"), /Nenhuma mensagem chegou/);
});

test("sem Claude: o servidor marca na falha definitiva do WhatsApp, tira a marca quando responde, sonda sozinho, e o módulo vai no pacote", () => {
  const src = readFileSync(new URL("../../backend-colima/server.js", import.meta.url), "utf8");
  assert.match(src, /if \(model === 'whatsapp'\) semClaudeCaiu\(e\.message\);/);
  assert.ok(src.indexOf("if (model === 'whatsapp') semClaudeCaiu") > src.indexOf("if (e.code === 'aborted') { log(`abortado pelo cliente"), "pedido cancelado pelo cliente não é queda");
  assert.match(src, /if \(model === 'whatsapp'\) semClaudeVoltou\(\);/);
  assert.match(src, /iaTexto\('Responda apenas: ok'\)/, "a sonda é do backend: nenhuma mensagem de cliente serve de teste");
  assert.match(src, /if \(semClaude\.estado\(\)\) ligarSondaSemClaude\(\);/, "reinício no meio da queda continua sondando");
  const { BACKEND_RUNTIME_FILES } = require("../../dist/main/maquina/backend-bundle-core.js");
  assert.ok(BACKEND_RUNTIME_FILES.includes("sem-claude.js"));
  // O plugin lê o mesmo arquivo e grava o mesmo motivo.
  const plugin = readFileSync(new URL("../../backend-colima/hermes-plugins/meu-bot-pausa/__init__.py", import.meta.url), "utf8");
  assert.ok(plugin.includes('SEM_CLAUDE = "sem-claude.json"') && sc.ARQUIVO.endsWith("/.local/share/meu-bot/sem-claude.json"));
  assert.ok(plugin.includes(`SEM_CLAUDE_MOTIVO = "${sc.MOTIVO_LINHA}"`));
});
