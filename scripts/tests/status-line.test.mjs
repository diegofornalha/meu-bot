import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSegments, fmtK, timeUntil, ageText, thresholdToWarn, previewLine, ESPACO_THRESHOLDS } from "../../dist/renderer/lib/status-line.js";

const NOW = 1_792_037_681_000; // 2026-10-15 ~01:14 BRT em ms
const account = { email: "m6@databutton.com.br", assento: "Premium", sessionPct: 37, weeklyPct: 37, sessionResets: 1_792_043_400, weeklyResets: 1_792_472_400, updated: 1_792_037_681, providers: [] };

test("fmtK, timeUntil e ageText seguem o statusline.sh", () => {
  assert.equal(fmtK(950), "950"); assert.equal(fmtK(3200), "3.2k"); assert.equal(fmtK(2_500_000), "2.5M");
  assert.equal(timeUntil(1_792_043_400, NOW), "1h35m");
  assert.equal(timeUntil(1_792_472_400, NOW), "5d0h");
  assert.equal(timeUntil(NOW / 1000 - 10, NOW), "now");
  assert.equal(ageText(1_792_037_681, NOW), "agora");
  assert.equal(ageText(1_792_037_681 - 720, NOW), "há 12 min");
  assert.equal(ageText(null, NOW), "");
});

test("segmentos para modelo Claude: modelo, ctx, turno, conta, sessão, semanal, idade", () => {
  const segs = buildSegments({ model: "agente", ctx: { tokens: 3200, budget: 24000 }, turn: { ms: 6300, completion: 258 }, account, nowMs: NOW });
  assert.deepEqual(segs.map((s) => s.kind), ["model", "ctx", "turn", "account", "session", "weekly", "age"]);
  assert.equal(segs[1].text, "Ctx: 13% · 3.2k/24.0k");
  assert.equal(segs[2].text, "6.3 s · 258 tok · 41 t/s");
  assert.equal(segs[3].text, "m6@databutton.com.br (Premium)");
  assert.equal(segs[4].text, "Sessão: 37% · 1h35m");
  assert.equal(segs[5].text, "Semanal: 37% · 5d0h");
});

test("outro-motor não mostra conta nem limites do Claude; sem dados, só o modelo", () => {
  const segs = buildSegments({ model: "outro-motor", ctx: null, turn: null, account, nowMs: NOW });
  assert.deepEqual(segs.map((s) => s.kind), ["model"]);
  assert.deepEqual(buildSegments({ model: "agente", ctx: null, turn: null, account: null }).map((s) => s.kind), ["model"]);
});

test("thresholdToWarn avisa 80, 90 e 95 uma vez cada, na ordem", () => {
  assert.equal(thresholdToWarn(79, 0), null);
  assert.equal(thresholdToWarn(82, 0), 80);
  assert.equal(thresholdToWarn(82, 80), null);
  assert.equal(thresholdToWarn(96, 80), 95);
  assert.equal(thresholdToWarn(null, 0), null);
});

test("segmentos escolhidos filtram o rodapé (turno e idade ficam); prévia acompanha", () => {
  const base = { model: "agente", ctx: { tokens: 1000, budget: 24000 }, turn: { ms: 1500, completion: 300 }, account, nowMs: NOW };
  const all = buildSegments(base).map((s) => s.kind);
  assert.deepEqual(all, ["model", "ctx", "turn", "account", "session", "weekly", "age"]);
  const some = buildSegments({ ...base, segments: { model: true, ctx: false, account: false, session: true, weekly: false } }).map((s) => s.kind);
  assert.deepEqual(some, ["model", "turn", "session", "age"]);
  assert.equal(previewLine(null), "Opus 4.8 | Ctx: 12% · 24.0k/200.0k | você@exemplo.com (Premium) | Sessão: 57% · 1h4m | Semanal: 12% · 3d | Espaço: 72%");
  assert.equal(previewLine({ model: true, ctx: false, account: false, session: false, weekly: true, espaco: false }), "Opus 4.8 | Semanal: 12% · 3d");
});

test("modelo: o nome que o backend informa vence o modo (Opus 5.5 durante o limite); grok e backend antigo mostram o modo", () => {
  const base = { email: null, assento: null, sessionPct: null, weeklyPct: null, sessionResets: null, weeklyResets: null, updated: null, providers: [] };
  assert.equal(buildSegments({ model: "agente", ctx: null, turn: null, account: { ...base, modelName: "Opus 5.5" } })[0].text, "Opus 5.5");
  assert.equal(buildSegments({ model: "agente", ctx: null, turn: null, account: { ...base, modelName: null } })[0].text, "agente");
  assert.equal(buildSegments({ model: "outro-motor", ctx: null, turn: null, account: { ...base, modelName: "Opus 5.5" } })[0].text, "outro-motor");
});

test("espaço da conta (cota de disco): segmento de qualquer modelo, amarelo a 80 e vermelho a 95; desligável; aviso em 80/95", () => {
  const cota = { usadoKb: 3_383_566, limiteKb: 4_126_300, hardKb: 4_538_930, pct: 82, nivel: "perto", grace: null, itens: [], em: "2026-10-30T20:00:00Z" };
  const segs = buildSegments({ model: "agente", ctx: null, turn: null, account: { ...account, cota }, nowMs: NOW });
  const e = segs.find((s) => s.kind === "espaco");
  assert.deepEqual([e.text, e.tone], ["Espaço: 82%", "warn"]); assert.match(e.title, /3,2 GB de 3,9 GB/);
  assert.equal(buildSegments({ model: "outro-motor", ctx: null, turn: null, account: { ...account, cota }, nowMs: NOW }).map((s) => s.kind).join(), "model,espaco", "é da máquina, não do Claude");
  assert.equal(buildSegments({ model: "agente", ctx: null, turn: null, account: { ...account, cota: { ...cota, pct: 96 } }, nowMs: NOW }).find((s) => s.kind === "espaco").tone, "bad");
  assert.equal(buildSegments({ model: "agente", ctx: null, turn: null, account: { ...account, cota: { ...cota, pct: 40 } }, nowMs: NOW }).find((s) => s.kind === "espaco").tone, undefined);
  assert.equal(buildSegments({ model: "agente", ctx: null, turn: null, account: { ...account, cota }, nowMs: NOW, segments: { model: true, ctx: true, account: true, session: true, weekly: true, espaco: false } }).some((s) => s.kind === "espaco"), false);
  assert.equal(buildSegments({ model: "agente", ctx: null, turn: null, account: { ...account, cota: null }, nowMs: NOW }).some((s) => s.kind === "espaco"), false, "sem cota, sem segmento");
  assert.deepEqual([...ESPACO_THRESHOLDS], [80, 95]);
  assert.equal(thresholdToWarn(82, 0, ESPACO_THRESHOLDS), 80); assert.equal(thresholdToWarn(96, 80, ESPACO_THRESHOLDS), 95); assert.equal(thresholdToWarn(90, 80, ESPACO_THRESHOLDS), null);
});
