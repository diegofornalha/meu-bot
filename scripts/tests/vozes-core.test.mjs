import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const { VOZES, isVozId } = createRequire(import.meta.url)("../../dist/main/whatsapp/vozes-core.js");
const root = join(import.meta.dirname, "..", "..");

test("vozes: catálogo do main, cópia do renderer e install-voz.sh conhecem os mesmos ids", () => {
  assert.deepEqual(VOZES.map((v) => v.id), ["faber", "dora", "alex"]);
  assert.equal(VOZES.filter((v) => v.padrao).map((v) => v.id).join(), "faber");
  assert.ok(isVozId("dora") && !isVozId("francisca") && !isVozId(undefined));
  const ui = readFileSync(join(root, "src/renderer/whatsapp/agente-whatsapp.ts"), "utf8");
  const bloco = /const VOZES_UI[\s\S]*?\];/.exec(ui)[0];
  assert.deepEqual([...bloco.matchAll(/id: "(\w+)", rotulo: "([^"]+)"/g)].map((m) => [m[1], m[2]]), VOZES.map((v) => [v.id, v.rotulo]));
  const sh = readFileSync(join(root, "backend-colima/install-voz.sh"), "utf8");
  assert.match(sh, /case "\$VOZ" in faber\|dora\|alex\)/);
  assert.match(sh, /pf_dora/); assert.match(sh, /pm_alex/);
});

test("ffmpeg que falta aponta o admin (Preparar máquina), não um apt que a box não consegue rodar", () => {
  for (const f of ["backend-colima/install-voz.sh", "backend-colima/install-transcricao.sh", "src/main/maquina/hostProbe.ts"]) {
    const s = readFileSync(join(root, f), "utf8");
    assert.match(s, /Preparar máquina › /, f);
    assert.doesNotMatch(s, /\(apt(-get)? install ffmpeg\)/, f);
  }
  for (const f of ["backend-colima/install-voz.sh", "backend-colima/install-transcricao.sh"]) {
    const s = readFileSync(join(root, f), "utf8");
    assert.match(s, /apt-get install -y -q ffmpeg/, f);
    assert.ok(s.indexOf("ffmpeg_ou_avisa()") < s.indexOf('ffmpeg_ou_avisa "'), `${f}: a função vem antes do uso`);
  }
});

test("voz Kokoro: o cache de arquivos inativo conta como livre no teto de RAM (download grande não recusa a voz)", () => {
  const sh = readFileSync(join(root, "backend-colima/install-voz.sh"), "utf8");
  const linha = sh.split("\n").find((l) => l.trim().startsWith("LIVRE=$(("));
  assert.ok(linha, "a conta do LIVRE existe");
  const cg = mkdtempSync(join(tmpdir(), "voz-cg-"));
  const mb = 1048576;
  // box-4 do meu-root-hermes em 23 nov: teto 3072, current 2628, cache inativo 1598 → 2041 livres (antes, 443).
  writeFileSync(join(cg, "memory.max"), `${3072 * mb}\n`);
  writeFileSync(join(cg, "memory.current"), `${2628 * mb}\n`);
  writeFileSync(join(cg, "memory.stat"), `anon ${429 * mb}\nfile ${2053 * mb}\nactive_file ${455 * mb}\ninactive_file ${1598 * mb}\n`);
  const livre = (dir) => execFileSync("bash", ["-c", `CG="$1"\n${linha.trim()}\necho "$LIVRE"`, "_", dir], { encoding: "utf8" }).trim();
  assert.equal(livre(cg), "2042");
  // Sem memory.stat (kernel antigo): cai na conta de antes, sem quebrar.
  const sem = mkdtempSync(join(tmpdir(), "voz-cg-"));
  writeFileSync(join(sem, "memory.max"), `${3072 * mb}\n`);
  writeFileSync(join(sem, "memory.current"), `${2628 * mb}\n`);
  assert.equal(livre(sem), "444");
});
