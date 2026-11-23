import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const req = createRequire(import.meta.url);
const root = join(import.meta.dirname, "..", "..");
const GLOBAL_SH = join(root, "backend-colima/install-voz-global.sh");
const g = readFileSync(GLOBAL_SH, "utf8");
const conta = readFileSync(join(root, "backend-colima/install-voz.sh"), "utf8");
const semBash = process.platform === "win32";
const sha = (s) => createHash("sha256").update(s).digest("hex");

test("install-voz-global.sh: sintaxe, só root, sha256 conferido, download que retoma e a marca gravada por último", { skip: semBash }, () => {
  assert.equal(spawnSync("bash", ["-n", GLOBAL_SH], { encoding: "utf8" }).status, 0);
  assert.match(g, /\[ "\$\(id -u\)" = 0 \] \|\| \{ echo "ERRO=/);
  assert.match(g, /sha256sum -c/);
  assert.match(g, /curl -fsSL --retry 5 --retry-delay 5 -C - /, "o download retoma de onde parou");
  assert.match(g, /chown -R root:root "\$D"; chmod -R u=rwX,go=rX "\$D"/);
  assert.match(g, /runuser -u nobody -- "\$V\/bin\/python" -c "import kokoro_onnx, soundfile"/, "confere como usuário comum");
  assert.ok(g.lastIndexOf('> "$MARCA.tmp"') > g.indexOf("runuser -u nobody"), "a marca só existe com tudo pronto e conferido");
  // O pacote e a origem são os do instalador da conta: o ambiente global serve o falar.py que ela grava.
  for (const k of ["KOKORO_PKG", "KOKORO_URL"]) {
    const linha = new RegExp(`^${k}=.*$`, "m");
    assert.equal(linha.exec(g)[0], linha.exec(conta)[0], k);
  }
  const { VOZ_GLOBAL_DIR, VOZ_GLOBAL_MARCA, VG_ESTADO_SH } = req("../../dist/main/admin/voz-global-core.js");
  assert.ok(g.includes(`D=${VOZ_GLOBAL_DIR}; MARCA=$D/global.json`)); assert.equal(VOZ_GLOBAL_MARCA, `${VOZ_GLOBAL_DIR}/global.json`);
  assert.ok(conta.includes(`G=\${MEU_BOT_VOZ_GLOBAL:-${VOZ_GLOBAL_DIR}}`), "a conta lê a mesma pasta");
  assert.match(VG_ESTADO_SH, /echo "VG=\$VGM \$VGC"/);
  assert.deepEqual(req("../../dist/main/maquina/backend-bundle-core.js").VOZ_GLOBAL_FILES, ["install-voz-global.sh"]);
  // Como usuário comum: recusa antes de qualquer coisa.
  if (process.getuid && process.getuid() !== 0) assert.match(spawnSync("bash", [GLOBAL_SH], { encoding: "utf8" }).stdout, /^ERRO=a voz para todos precisa ser instalada como root/);
});

// O bloco que traz um arquivo, rodado de verdade numa pasta descartável (o "servidor" é um file://).
const bloco = /# --- arquivos: início ---\n([\s\S]*?)# --- arquivos: fim ---/.exec(g)[1];
function cena() {
  const d = mkdtempSync(join(tmpdir(), "voz-global-"));
  const dest = join(d, "opt"); const servidor = join(d, "servidor"); const conta1 = join(d, "home/box-1/kokoro"); const conta2 = join(d, "home/box-2/kokoro");
  for (const p of [dest, servidor, conta1, conta2]) mkdirSync(p, { recursive: true });
  const rodar = (nome, hash) => spawnSync("bash", ["-c", `set -u\nD='${dest}'; KOKORO_URL='file://${servidor}'; SEMENTES='${d}/home/*/kokoro'\n${bloco}\ntraz '${nome}' '${hash}' 1; echo "rc=$?"`], { encoding: "utf8" });
  return { dest, servidor, conta1, conta2, rodar };
}

test("voz para todos: aproveita a cópia de uma conta só se o sha256 conferir; a trocada é ignorada e o arquivo vem do download", { skip: semBash }, () => {
  const c = cena();
  const bom = "modelo de verdade"; const h = sha(bom);
  writeFileSync(join(c.conta1, "m.onnx"), "modelo trocado por uma conta");
  writeFileSync(join(c.conta2, "m.onnx"), bom);
  const a = c.rodar("m.onnx", h);
  assert.match(a.stdout, /aproveitado de uma conta desta máquina/); assert.match(a.stdout, /rc=0/);
  assert.equal(readFileSync(join(c.dest, "m.onnx"), "utf8"), bom);
  assert.ok(!existsSync(join(c.dest, "m.onnx.parcial")));
  assert.match(c.rodar("m.onnx", h).stdout, /já está em/, "rodar de novo não refaz");

  // Nenhuma conta tem a cópia certa: baixa, confere e só então dá o nome final.
  const d = cena();
  writeFileSync(join(d.conta1, "v.bin"), "lixo");
  writeFileSync(join(d.servidor, "v.bin"), bom);
  const b = d.rodar("v.bin", h);
  assert.match(b.stdout, /baixando v\.bin/); assert.match(b.stdout, /v\.bin conferido \(sha256\)/); assert.match(b.stdout, /rc=0/);
  assert.equal(readFileSync(join(d.dest, "v.bin"), "utf8"), bom);
});

test("voz para todos: download que não confere não vira arquivo; o cortado continua de onde parou", { skip: semBash }, () => {
  const c = cena();
  const bom = "0123456789".repeat(50); const h = sha(bom);
  writeFileSync(join(c.servidor, "m.onnx"), "outro conteúdo");
  const ruim = c.rodar("m.onnx", h);
  assert.match(ruim.stdout, /ERRO=m\.onnx não confere \(sha256\)/); assert.match(ruim.stdout, /rc=1/);
  assert.ok(!existsSync(join(c.dest, "m.onnx")) && !existsSync(join(c.dest, "m.onnx.parcial")));
  // Metade já baixada de uma tentativa anterior: o curl continua (-C -) e o resultado confere.
  writeFileSync(join(c.servidor, "m.onnx"), bom);
  writeFileSync(join(c.dest, "m.onnx.parcial"), bom.slice(0, 250));
  const ok = c.rodar("m.onnx", h);
  assert.match(ok.stdout, /rc=0/, ok.stdout + ok.stderr);
  assert.equal(readFileSync(join(c.dest, "m.onnx"), "utf8"), bom);
});

test("install-voz.sh com a voz para todos: a pasta da conta vira links para a máquina e a cópia própria sai", { skip: semBash }, () => {
  // O trecho que liga a conta ao global, rodado de verdade (o resto do instalador pede Linux x86_64 e ffmpeg).
  const trecho = /( {2}G=\$\{MEU_BOT_VOZ_GLOBAL:-[\s\S]*?\n {2}fi\n)/.exec(conta)[1];
  const d = mkdtempSync(join(tmpdir(), "voz-conta-"));
  const G = join(d, "opt"); const K = join(d, "home/kokoro");
  mkdirSync(join(G, "venv/bin"), { recursive: true }); mkdirSync(join(K, "venv/bin"), { recursive: true });
  writeFileSync(join(G, "venv/bin/python"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  for (const f of ["kokoro-v1.0.onnx", "voices-v1.0.bin"]) { writeFileSync(join(G, f), "global"); writeFileSync(join(K, f), "cópia da conta"); }
  const rodar = () => spawnSync("bash", ["-c", `set -euo pipefail\nK='${K}'\n${trecho}`], { encoding: "utf8", env: { ...process.env, MEU_BOT_VOZ_GLOBAL: G } });
  // Sem a marca (instalação do root pela metade): a conta não é tocada.
  assert.equal(rodar().stdout, "");
  assert.equal(readFileSync(join(K, "kokoro-v1.0.onnx"), "utf8"), "cópia da conta");
  writeFileSync(join(G, "global.json"), '{"pacote": "kokoro-onnx==0.4.9"}');
  const r = rodar();
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /nada para baixar/);
  for (const f of ["venv", "kokoro-v1.0.onnx", "voices-v1.0.bin"]) { assert.ok(lstatSync(join(K, f)).isSymbolicLink(), f); assert.equal(readlinkSync(join(K, f)), join(G, f)); }
  assert.equal(readFileSync(join(K, "kokoro-v1.0.onnx"), "utf8"), "global");
  assert.equal(rodar().status, 0, "rodar de novo não mexe nos links");
  // As conferências de tamanho seguem o link (o tamanho do link em si é o do caminho).
  assert.equal((conta.slice(conta.indexOf("# Kokoro (dora/alex)"), conta.indexOf('cat > "$K/falar.py"')).match(/stat -c %s "\$K\//g) ?? []).length, 0);
  assert.equal((conta.match(/stat -L -c %s "\$K\//g) ?? []).length, 4);
});
