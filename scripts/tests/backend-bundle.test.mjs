import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A lista única dos arquivos do backend (backend-bundle-core.ts) contra o que o server.js exige de verdade. Em 1/11 as
// três listas de antes (install.sh, BUNDLE_FILES e localBackend.ts) desviaram e as quatro VMs caíram em MODULE_NOT_FOUND.
const bundle = createRequire(import.meta.url)("../../dist/main/maquina/backend-bundle-core.js");
const { BACKEND_RUNTIME_FILES, BUNDLE_FILES, CLAUDE_GLOBAL_FILES, COMPONENTES, requiresLocais, fechoDeRequires, resumoDoInstalador } = bundle;
const DIR = join(import.meta.dirname, "..", "..", "backend-colima");
const ler = (nome) => (existsSync(join(DIR, nome)) ? readFileSync(join(DIR, nome), "utf8") : null);

test("requiresLocais: as formas require('./x'), require(\"./x\"), path.join(__dirname, 'x.js') e o .py por __dirname", () => {
  const src = `const a = require('./session-map');\nconst b = require("./tool-events");\nconst c = require( './gmail.js' );\n` +
    `const d = require(path.join(__dirname, 'contas-claude.js'));\nconst PY = path.join(__dirname, 'auditoria.py');\nconst x = require('node:fs'); const y = require('./session-map');`;
  assert.deepEqual(requiresLocais(src), ["session-map.js", "tool-events.js", "gmail.js", "contas-claude.js", "auditoria.py"]);
  assert.deepEqual(requiresLocais("const fs = require('fs');"), []);
});

test("fechoDeRequires: segue os requires dos módulos, sem repetir e sem abrir .py", () => {
  const fontes = { "a.js": "require('./b'); require('./c')", "b.js": "require('./c'); require(path.join(__dirname, 'd.js'))", "c.js": "const p = path.join(__dirname, 'x.py')", "d.js": "" };
  assert.deepEqual(fechoDeRequires(["a.js"], (n) => fontes[n] ?? null), ["a.js", "b.js", "c.js", "d.js", "x.py"]);
  assert.deepEqual(fechoDeRequires(["a.js", "a.js"], () => null), ["a.js"]);
});

test("BACKEND_RUNTIME_FILES cobre o fecho real dos requires do server.js e do porteiro, e todo arquivo existe", () => {
  const exigidos = fechoDeRequires(["server.js", "claude-porteiro.js"], ler);
  assert.ok(exigidos.includes("gmail.js") && exigidos.includes("pontes.js"), "o server.js de hoje exige gmail.js e pontes.js");
  const faltam = exigidos.filter((f) => !BACKEND_RUNTIME_FILES.includes(f));
  assert.deepEqual(faltam, [], `faltam na lista única: ${faltam.join(", ")}`);
  for (const f of BACKEND_RUNTIME_FILES) assert.ok(existsSync(join(DIR, f)), `${f} está na lista mas não em backend-colima/`);
  for (const f of BUNDLE_FILES) assert.ok(existsSync(join(DIR, f)), `${f} está no pacote mas não em backend-colima/`);
  assert.ok(BUNDLE_FILES.includes("install.sh") && BUNDLE_FILES.includes("VERSION"));
});

test("CLAUDE_GLOBAL_FILES cobre o fecho do claude-global.js", () => {
  const faltam = fechoDeRequires(["claude-global.js"], ler).filter((f) => !CLAUDE_GLOBAL_FILES.includes(f));
  assert.deepEqual(faltam, []);
});

test("COMPONENTES[backend] vigia os módulos novos (mudar gmail.js ou pontes.js exige subir o VERSION)", () => {
  const backend = COMPONENTES.find((c) => c.nome === "backend");
  assert.ok(backend.arquivos.includes("backend-colima/gmail.js") && backend.arquivos.includes("backend-colima/pontes.js"));
  assert.ok(!backend.arquivos.includes("backend-colima/VERSION"));
});

test("install.sh não tem mais lista própria: copia pelo copiar_backend, conferindo os requires antes", () => {
  const sh = readFileSync(join(DIR, "install.sh"), "utf8");
  assert.ok(!/cp "\$HERE\/server\.js" "\$HERE\/session-map\.js"/.test(sh), "a lista antiga do cp saiu");
  assert.match(sh, /copiar_backend\(\)/); assert.match(sh, /copiar_backend "\$HERE" "\$DEST"/);
  const local = readFileSync(join(import.meta.dirname, "..", "..", "dist", "main", "maquina", "localBackend.js"), "utf8");
  assert.match(local, /BACKEND_RUNTIME_FILES/, "o backend local copia da lista única");
});

test("resumoDoInstalador: as últimas linhas úteis numa frase (o 'cp: cannot stat' não se perde)", () => {
  assert.equal(resumoDoInstalador(["pasta do backend: /x", "", "cp: cannot stat '/stage/gmail.js': No such file or directory", "  ", "instalador saiu com código 1"]), "pasta do backend: /x | cp: cannot stat '/stage/gmail.js': No such file or directory | instalador saiu com código 1");
  assert.equal(resumoDoInstalador(["a", "b", "c", "d", "e", "f"], 2), "e | f");
  assert.equal(resumoDoInstalador([]), "?"); assert.equal(resumoDoInstalador(["", " "]), "?");
});
