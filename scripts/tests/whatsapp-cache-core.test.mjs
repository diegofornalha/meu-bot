import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { TtlCache } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-cache-core.js");

test("dentro da validade a leitura não vai à máquina; vencida ou forçada, vai; esquecer zera", async () => {
  let t = 1000; let n = 0;
  const c = new TtlCache(() => t);
  const ler = async () => { n++; return `v${n}`; };
  assert.equal(await c.get("h", 45_000, ler), "v1");
  t += 10_000; assert.equal(await c.get("h", 45_000, ler), "v1", "guardado");
  assert.equal(await c.get("h", 45_000, ler, true), "v2", "forçado vai à máquina");
  t += 46_000; assert.equal(await c.get("h", 45_000, ler), "v3", "vencido");
  assert.equal(c.vigente("h", 45_000), "v3"); t += 50_000; assert.equal(c.vigente("h", 45_000), null);
  c.esquecer("h"); assert.equal(await c.get("h", 45_000, ler), "v4");
  assert.equal(n, 4);
});

test("várias janelas perguntando ao mesmo tempo viram uma consulta só (coalescência), inclusive com force", async () => {
  let n = 0; let solta;
  const c = new TtlCache(() => 0);
  const ler = () => { n++; return new Promise((r) => { solta = r; }); };
  const a = c.get("h", 1000, ler); const b = c.get("h", 1000, ler); const f = c.get("h", 1000, ler, true);
  solta("x");
  assert.deepEqual(await Promise.all([a, b, f]), ["x", "x", "x"]);
  assert.equal(n, 1);
});

test("leitura que falha não fica guardada e não trava as seguintes", async () => {
  let n = 0;
  const c = new TtlCache(() => 0);
  await assert.rejects(c.get("h", 1000, async () => { n++; throw new Error("ssh caiu"); }), /ssh caiu/);
  assert.equal(await c.get("h", 1000, async () => { n++; return "ok"; }), "ok");
  assert.equal(n, 2);
});

test("chaves (máquinas) não se misturam", async () => {
  const c = new TtlCache(() => 0);
  assert.equal(await c.get("a", 1000, async () => "A"), "A");
  assert.equal(await c.get("b", 1000, async () => "B"), "B");
  c.esquecer("a");
  assert.equal(await c.get("b", 1000, async () => "B2"), "B", "esquecer a não mexe em b");
});
