// Todo processo filho em que o app escreve no stdin precisa de um ouvinte de "error" nesse stdin: sem ele, um EPIPE (o
// ssh saiu antes de ler: host fora, rede caída) vira exceção não tratada no processo principal e o macOS mostra "A
// JavaScript error occurred in the main process" (o Diego viu duas vezes no admin, 23 nov 2026). O erro de verdade
// chega pelo callback/close de cada um; o ouvinte só impede a exceção. Esta conferência é estática: para cada escrita
// com dado (`stdin.end(x)`, `stdin.write(x)`), as 15 linhas anteriores precisam registrar o ouvinte.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "main");
const arquivos = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? arquivos(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []));
// Escritas cujo ouvinte é registrado longe dali, na criação do mesmo filho (conferido à mão).
const OUVINTE_NA_CRIACAO = new Set(["terminal/terminal.ts", "agente/claudeLogin.ts"]);
const ESCRITA = /\.stdin\??\.(end|write)\((?!\))/;
const OUVINTE = /\.stdin\??\.on\("error"/;

test("stdin de processo filho: toda escrita com dado tem ouvinte de error (EPIPE não derruba o processo principal)", () => {
  const faltam = [];
  for (const f of arquivos(raiz)) {
    const rel = path.relative(raiz, f).split(path.sep).join("/");
    if (OUVINTE_NA_CRIACAO.has(rel)) { assert.match(fs.readFileSync(f, "utf8"), OUVINTE, `${rel} perdeu o ouvinte da criação`); continue; }
    const linhas = fs.readFileSync(f, "utf8").split("\n");
    linhas.forEach((l, i) => {
      if (!ESCRITA.test(l) || l.trim().startsWith("//") || l.trim().startsWith("*")) return;
      if (!linhas.slice(Math.max(0, i - 15), i + 1).some((x) => OUVINTE.test(x))) faltam.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(faltam, [], `escrita no stdin sem ouvinte de "error": ${faltam.join(", ")}`);
});
