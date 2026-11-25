// Regras da release dos apps derivados (scripts/release-core.mjs; o scripts/release-derivados.mjs só executa): a lista
// deste Mac, a conferência entre a ficha e o repositório onde se publica, a versão e os argumentos do gh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { argsReleaseDerivado, notasDoDerivado, parseDerivados, recusaDerivado, versaoDasTags, versaoStagingValida } from "../release-core.mjs";

test("lista de derivados: ausente é vazia; cada item tem repositório e pasta absoluta, sem repetição", () => {
  assert.deepEqual(parseDerivados(undefined), { itens: [] });
  assert.deepEqual(parseDerivados(null), { itens: [] });
  assert.deepEqual(parseDerivados([]), { itens: [] });
  const ok = [{ repo: "diegofornalha/meu-bot-vendas-app", pasta: "/Users/x/derivados/vendas" }, { repo: "outro/meu-bot-y", pasta: "/Users/x/derivados/y" }];
  assert.deepEqual(parseDerivados(ok), { itens: ok });
  // Campo a mais (um commit fixado, uma anotação) não entra no item.
  assert.deepEqual(parseDerivados([{ ...ok[0], nota: "x" }]).itens, [ok[0]]);
  assert.match(parseDerivados({}).erro, /array/);
  assert.match(parseDerivados(["x"]).erro, /item 1/);
  for (const repo of ["meu-bot-x", "a/b/c", "https://github.com/a/b", "a/..", "a/b c", 7]) assert.match(parseDerivados([{ repo, pasta: "/x" }]).erro, /item 1: repo/, String(repo));
  for (const pasta of ["derivados/x", "~/x", "", 7]) assert.match(parseDerivados([{ repo: "a/b", pasta }]).erro, /pasta tem de ser o caminho absoluto/, String(pasta));
  assert.match(parseDerivados([ok[0], { repo: "DiegoFornalha/meu-bot-vendas-app", pasta: "/outra" }]).erro, /aparece duas vezes/, "o GitHub não distingue maiúsculas");
  assert.match(parseDerivados([ok[0], { repo: "a/b", pasta: ok[0].pasta }]).erro, /a pasta .* aparece duas vezes/);
});

test("só publica onde a ficha manda procurar: sem `releases`, com outro repositório ou fora do staging, recusa", () => {
  const p = { nome: "meu-bot-vendas-staging", canal: "staging", repoReleases: "diegofornalha/meu-bot-vendas-app" };
  assert.equal(recusaDerivado(p, "diegofornalha/meu-bot-vendas-app"), null);
  assert.equal(recusaDerivado(p, "DiegoFornalha/meu-bot-vendas-app"), null);
  // Sem `releases` o app procuraria no core e nunca acharia: os instalados ficariam "em dia" para sempre.
  assert.match(recusaDerivado({ ...p, repoReleases: null }, "a/b"), /não diz onde saem as releases.*"releases": "a\/b"/);
  assert.match(recusaDerivado(p, "outro/repo"), /manda procurar as releases em diegofornalha\/meu-bot-vendas-app.*publica em outro\/repo/);
  assert.match(recusaDerivado({ ...p, canal: "estavel" }, p.repoReleases), /canal staging/);
});

test("a versão do derivado é a staging do core: sai da tag do commit, ou é recusada", () => {
  assert.equal(versaoDasTags(["v1.2.3-staging.9"]), "1.2.3-staging.9");
  assert.equal(versaoDasTags(["v1.2.3", "v1.2.3-staging.8", "v1.2.3-staging.10", "lixo", ""]), "1.2.3-staging.10");
  assert.equal(versaoDasTags(["v1.2.3"]), null, "tag estável não serve");
  assert.equal(versaoDasTags([]), null);
  assert.equal(versaoStagingValida("1.2.3-staging.9"), true);
  for (const v of ["1.2.3", "v1.2.3-staging.9", "1.2.3-staging", "1.2-staging.1", "", undefined, null]) assert.equal(versaoStagingValida(v), false, String(v));
});

test("gh release create do derivado: sempre com -R do repositório dele, pre-release e o commit do derivado como alvo", () => {
  const a = argsReleaseDerivado({ tag: "v1.2.3-staging.9", repo: "diegofornalha/meu-bot-vendas-app", arquivos: ["out/a.zip", "out/a.zip.sig"], titulo: "meu-bot-vendas-staging 1.2.3-staging.9", notasArquivo: "out/notas.md", commitDerivado: "abc123" });
  assert.deepEqual(a, ["release", "create", "v1.2.3-staging.9", "out/a.zip", "out/a.zip.sig", "-R", "diegofornalha/meu-bot-vendas-app", "--title", "meu-bot-vendas-staging 1.2.3-staging.9", "--notes-file", "out/notas.md", "--prerelease", "--target", "abc123"]);
  const n = notasDoDerivado({ nome: "meu-bot-vendas-staging", versao: "1.2.3-staging.9", commitCore: "78653b01", commitDerivado: "abc123" });
  for (const pedaco of ["meu-bot-vendas-staging 1.2.3-staging.9", "core 78653b01", "abc123", "releases/tag/v1.2.3-staging.9"]) assert.ok(n.includes(pedaco), pedaco);
});
