import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AVISO_DEMORA, CONSULTANDO, textoEspera, textoFalhaConsulta } from "../../dist/renderer/lib/carregando.js";

test("espera: só o rótulo no começo; o tempo a partir de 3 s; o aviso de demora a partir de 10 s", () => {
  assert.deepEqual(textoEspera("Lendo os grupos…", 0), { linha: "Lendo os grupos…", aviso: null });
  assert.deepEqual(textoEspera("Lendo os grupos…", 2.9), { linha: "Lendo os grupos…", aviso: null });
  assert.deepEqual(textoEspera("Lendo os grupos…", 3), { linha: "Lendo os grupos… 3 s", aviso: null });
  const lenta = textoEspera("Lendo os grupos…", 12.7);
  assert.equal(lenta.linha, "Lendo os grupos… 12 s");
  assert.match(lenta.aviso ?? "", /continuo buscando\. Não precisa clicar de novo\.$/);
  assert.equal(textoEspera("x", -5).linha, "x", "relógio adiantado não vira tempo negativo");
});

test("textoEspera: o aviso de demora pode ser trocado quando a espera não é uma busca", () => {
  assert.equal(textoEspera("Guardando…", 12).aviso, AVISO_DEMORA);
  assert.equal(textoEspera("Guardando…", 12, "Leva perto de um minuto.").aviso, "Leva perto de um minuto.");
  assert.equal(textoEspera("Guardando…", 9, "Leva perto de um minuto.").aviso, null);
});

test("textoFalhaConsulta: diz o motivo, sem ponto dobrado; sem motivo, só a frase", () => {
  assert.equal(textoFalhaConsulta("não consegui entrar na máquina"), "Não consegui consultar a máquina: não consegui entrar na máquina.");
  assert.equal(textoFalhaConsulta("Connection timed out. "), "Não consegui consultar a máquina: Connection timed out.");
  assert.equal(textoFalhaConsulta("  "), "Não consegui consultar a máquina.");
});

// O mesmo defeito voltou quatro vezes (contas, link público, guarda, navegador): um passo de tutorial em
// "Consultando a máquina…" para sempre, porque a consulta falhou ou nem foi feita. Quem consulta a máquina num passo
// usa esperaOuFalha (que mostra o erro e "Tentar de novo"), nunca o indicador solto.
test("nenhuma tela chama carregando(\"Consultando a máquina…\") direto: a espera de consulta passa por esperaOuFalha", () => {
  const raiz = fileURLToPath(new URL("../../src/renderer", import.meta.url));
  const arquivos = readdirSync(raiz, { recursive: true }).filter((f) => String(f).endsWith(".ts")).map(String);
  assert.ok(arquivos.length > 50, "a varredura achou o renderer");
  const soltos = arquivos.filter((f) => f !== join("lib", "carregando.ts") && new RegExp(`carregando\\(\\s*(["'\`]${CONSULTANDO}["'\`]|CONSULTANDO)`).test(readFileSync(join(raiz, f), "utf8")));
  assert.deepEqual(soltos, []);
});
