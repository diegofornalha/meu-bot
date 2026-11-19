import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { openStore } = require("../../backend-colima/crm-store.js");
const m = require("../../backend-colima/crm-modelo.js");

let n = 0;
const rnd = (k) => Buffer.from(String(++n).padStart(k * 2, "0").slice(0, k * 2), "hex");
const T0 = Date.parse("2026-10-19T10:00:00.000Z");
const fresh = () => { const dir = mkdtempSync(join(tmpdir(), "crm-store-")); return { dir, db: join(dir, "db") }; };

test("mutate: grava atômico, avança seq, feed em mudancas.jsonl, recarrega igual", async () => {
  const { dir, db } = fresh(); let clock = T0;
  const s = openStore(db, { now: () => clock, rnd });
  assert.equal(s.meta().seq, 0);
  const p = await s.mutate("teste", (tx) => { const pl = m.novoPipeline({ name: "P", stages: ["A", "B"] }, tx.now, tx.rnd); tx.setPipeline(pl); tx.mudar("pipeline.create", { pipeline: pl.key }); return pl; });
  clock += 1000;
  const b = await s.mutate("agente", (tx) => { const bx = m.novoBox(p, { name: "Box 1" }, tx.now, tx.rnd); tx.setBox(bx); tx.mudar("box.create", { pipeline: p.key, box: bx.key }); return bx; });
  assert.equal(s.meta().seq, 2);
  assert.ok(existsSync(join(db, "pipelines", `${p.key}.json`))); assert.ok(existsSync(join(db, "boxes", `${p.key}.json`)));
  assert.ok(!readdirSync(join(db, "boxes")).some((f) => f.endsWith(".tmp")), "sem .tmp sobrando");
  const feed = readFileSync(join(db, "mudancas.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(feed.map((l) => [l.seq, l.tipo, l.por]), [[1, "pipeline.create", "teste"], [2, "box.create", "agente"]]);
  assert.equal(feed[1].at, T0 + 1000);
  const s2 = openStore(db, { now: () => clock, rnd });
  assert.equal(s2.meta().seq, 2); assert.deepEqual(s2.getBox(b.key), b); assert.equal(s2.listPipelines()[0].name, "P");
  rmSync(dir, { recursive: true, force: true });
});

test("mutate: erro dentro da transação não grava nada nem avança seq; a fila serializa", async () => {
  const { dir, db } = fresh();
  const s = openStore(db, { now: () => T0, rnd });
  await assert.rejects(s.mutate("t", (tx) => { tx.setPipeline(m.novoPipeline({ name: "X" }, tx.now, tx.rnd)); tx.mudar("pipeline.create"); throw new Error("boom"); }), /boom/);
  assert.equal(s.meta().seq, 0); assert.equal(s.listPipelines().length, 0, "memória restaurada");
  const seqs = await Promise.all([1, 2, 3].map((i) => s.mutate("t", async (tx) => { await new Promise((r) => setTimeout(r, 5 * (4 - i))); const pl = m.novoPipeline({ name: `P${i}` }, tx.now, tx.rnd); tx.setPipeline(pl); return tx.mudar("pipeline.create", { pipeline: pl.key }); })));
  assert.deepEqual(seqs, [1, 2, 3], "um de cada vez, na ordem");
  rmSync(dir, { recursive: true, force: true });
});

test("changes: since, limit/more e reset quando o feed foi rotacionado; onChange avisa", async () => {
  const { dir, db } = fresh();
  const s = openStore(db, { now: () => T0, rnd });
  let avisos = 0; const off = s.onChange(() => { avisos++; });
  for (let i = 0; i < 5; i++) await s.mutate("t", (tx) => { const pl = m.novoPipeline({ name: `P${i}` }, tx.now, tx.rnd); tx.setPipeline(pl); tx.mudar("pipeline.create", { pipeline: pl.key }); });
  off();
  assert.equal(avisos, 5);
  assert.deepEqual(s.changes(3).mudancas.map((l) => l.seq), [4, 5]);
  assert.deepEqual(s.changes(5), { seq: 5, mudancas: [] });
  const r = s.changes(0, 2); assert.deepEqual(r.mudancas.map((l) => l.seq), [1, 2]); assert.equal(r.more, true);
  // Feed "rotacionado": simula apagando as primeiras linhas.
  const feed = join(db, "mudancas.jsonl"); const linhas = readFileSync(feed, "utf8").trim().split("\n");
  const { writeFileSync } = await import("node:fs"); writeFileSync(feed, `${linhas.slice(3).join("\n")}\n`);
  assert.equal(s.changes(1).reset, true, "since anterior à janela → reset");
  assert.deepEqual(s.changes(3).mudancas.map((l) => l.seq), [4, 5], "dentro da janela segue normal");
  rmSync(dir, { recursive: true, force: true });
});

test("backup diário: na 1ª escrita do dia copia o db para backup/<dia>; mantém só 7; lixeira guarda box apagado", async () => {
  const { dir, db } = fresh(); let clock = T0;
  const s = openStore(db, { now: () => clock, rnd });
  const p = await s.mutate("t", (tx) => { const pl = m.novoPipeline({ name: "P" }, tx.now, tx.rnd); tx.setPipeline(pl); tx.mudar("pipeline.create", { pipeline: pl.key }); return pl; });
  assert.deepEqual(readdirSync(join(db, "backup")), ["2026-10-19"], "backup do dia (antes da 1ª escrita: pasta vazia copiada)");
  for (let d = 1; d <= 8; d++) { clock = T0 + d * 86_400_000; await s.mutate("t", (tx) => { const bx = m.novoBox(p, { name: `B${d}` }, tx.now, tx.rnd); tx.setBox(bx); tx.mudar("box.create", { pipeline: p.key, box: bx.key }); }); }
  const dias = readdirSync(join(db, "backup")).sort();
  assert.equal(dias.length, 7); assert.equal(dias[0], "2026-10-21"); assert.equal(dias.at(-1), "2026-10-27");
  const bx = s.allBoxes()[0];
  await s.mutate("t", (tx) => { tx.trashBox(bx); tx.mudar("box.delete", { pipeline: p.key, box: bx.key }); });
  assert.equal(s.getBox(bx.key), null); assert.ok(existsSync(join(db, "lixeira", p.key, `${bx.key}.json`)));
  assert.equal(JSON.parse(readFileSync(join(db, "lixeira", p.key, `${bx.key}.json`), "utf8")).apagadoEm, clock);
  rmSync(dir, { recursive: true, force: true });
});

test("arquivo corrompido: abrir falha com a mensagem do caminho (não sobrescreve)", async () => {
  const { dir, db } = fresh();
  const s = openStore(db, { now: () => T0, rnd });
  await s.mutate("t", (tx) => { const pl = m.novoPipeline({ name: "P" }, tx.now, tx.rnd); tx.setPipeline(pl); tx.mudar("pipeline.create"); });
  const { writeFileSync } = await import("node:fs"); writeFileSync(join(db, "meta.json"), "{lixo");
  assert.throws(() => openStore(db), /corrompido.*meta\.json/);
  assert.equal(readFileSync(join(db, "meta.json"), "utf8"), "{lixo", "ficou como estava");
  rmSync(dir, { recursive: true, force: true });
});

test("agenteAutonomo: a marca sobrevive a reabrir; arquivo antigo sem ela volta false", async () => {
  const { dir, db } = fresh();
  const s = openStore(db, { now: () => T0, rnd });
  const [com, sem] = await s.mutate("t", (tx) => { const a = m.novoPipeline({ name: "Leads", agenteAutonomo: true }, tx.now, tx.rnd); const b = m.novoPipeline({ name: "Antigo" }, tx.now, tx.rnd); tx.setPipeline(a); tx.setPipeline(b); tx.mudar("pipeline.create"); return [a, b]; });
  // Pipeline gravado por uma versão anterior: o arquivo não tem o campo.
  const { writeFileSync } = await import("node:fs"); const arq = join(db, "pipelines", `${sem.key}.json`);
  const { agenteAutonomo: _, ...antigo } = JSON.parse(readFileSync(arq, "utf8")); writeFileSync(arq, JSON.stringify(antigo));
  const s2 = openStore(db, { now: () => T0, rnd });
  assert.equal(s2.getPipeline(com.key).agenteAutonomo, true);
  assert.equal(s2.getPipeline(sem.key).agenteAutonomo, false);
  rmSync(dir, { recursive: true, force: true });
});
