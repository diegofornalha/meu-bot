// Regras da release dos apps derivados (scripts/release-core.mjs; o scripts/release-derivados.mjs só executa): a lista
// deste Mac, a conferência entre a ficha e o repositório onde se publica, a versão e os argumentos do gh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PASTA_DE_CODIGO, recusaCommitDoDerivado, argsReleaseDerivado, decideAvisoDerivado, motivoDaFalhaDerivados, notasDoDerivado, parseDerivados, precisaDaChave, recusaDerivado, versaoDasTags, versaoStagingValida } from "../release-core.mjs";

test("lista de derivados: ausente é vazia; cada item tem repositório e pasta absoluta, sem repetição", () => {
  assert.deepEqual(parseDerivados(undefined), { itens: [] });
  assert.deepEqual(parseDerivados(null), { itens: [] });
  assert.deepEqual(parseDerivados([]), { itens: [] });
  const ok = [{ repo: "diegofornalha/meu-bot-vendas-app", pasta: "/Users/x/derivados/vendas" }, { repo: "outro/meu-bot-y", pasta: "/Users/x/derivados/y" }];
  const comNull = ok.map((x) => ({ ...x, commit: null }));
  assert.deepEqual(parseDerivados(ok), { itens: comNull }, "sem commit aprovado: segue o ramo padrão");
  // Campo a mais (uma anotação) não entra no item.
  assert.deepEqual(parseDerivados([{ ...ok[0], nota: "x" }]).itens, [comNull[0]]);
  // Commit aprovado: o hash inteiro; ramo, tag ou prefixo não servem (tem de ser exatamente o que foi lido).
  const hash = "e370fa82f45e89ba87189f267fe659f76abc50ea";
  assert.deepEqual(parseDerivados([{ ...ok[0], commit: hash }]).itens, [{ ...ok[0], commit: hash }]);
  for (const commit of ["main", "e370fa8", hash.toUpperCase(), `${hash}0`, "", 7]) assert.match(parseDerivados([{ ...ok[0], commit }]).erro, /commit tem de ser o hash inteiro/, String(commit));
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

test("derivado atrasado: avisa uma vez por versão, tenta calado nas rodadas seguintes e registra quando volta a ficar em dia", () => {
  const v = "1.2.3-staging.10";
  assert.equal(decideAvisoDerivado({ versao: v, falhouAntes: null, ok: true }), "nada");
  assert.equal(decideAvisoDerivado({ versao: v, falhouAntes: undefined, ok: true }), "nada", "estado antigo, sem o campo");
  assert.equal(decideAvisoDerivado({ versao: v, falhouAntes: null, ok: false }), "avisar", "primeira falha na versão");
  assert.equal(decideAvisoDerivado({ versao: v, falhouAntes: v, ok: false }), "calar", "mesma versão: sem repetir o aviso a cada 10 min");
  assert.equal(decideAvisoDerivado({ versao: v, falhouAntes: "1.2.3-staging.9", ok: false }), "avisar", "versão nova que também falha avisa de novo");
  assert.equal(decideAvisoDerivado({ versao: v, falhouAntes: v, ok: true }), "limpar");
  assert.equal(decideAvisoDerivado({ versao: v, falhouAntes: "1.2.3-staging.9", ok: true }), "limpar");
});

test("o aviso diz por que falhou: a última linha de erro do script, sem o resumo", () => {
  const saida = ["▶ diegofornalha/meu-bot-a", "  falta publicar meu-bot-a 1.2.3-staging.10", "▶ lendo a chave da release no Chaveiro", "✗ diegofornalha/meu-bot-a: meu-bot-a.app não saiu notarizado", "", "✗ 1 de 2 derivado(s) não foram publicados"].join("\n");
  assert.equal(motivoDaFalhaDerivados(saida), "diegofornalha/meu-bot-a: meu-bot-a.app não saiu notarizado");
  assert.equal(motivoDaFalhaDerivados("✗ a chave da release não está no Chaveiro (ou o acesso foi negado): nada foi publicado\n"), "a chave da release não está no Chaveiro (ou o acesso foi negado): nada foi publicado");
  assert.equal(motivoDaFalhaDerivados("✗ primeiro\n✗ segundo\n✗ 2 de 2 derivado(s) não foram publicados"), "segundo");
  for (const vazio of ["", "nada de erro aqui", null, undefined, "✗ 1 de 1 derivado(s) não passaram na conferência"]) assert.equal(motivoDaFalhaDerivados(vazio), null);
  const longo = motivoDaFalhaDerivados(`✗ ${"x".repeat(400)}`);
  assert.equal(longo.length, 180); assert.ok(longo.endsWith("…"), "cabe na notificação");
});

test("a chave da release só é pedida quando há o que publicar: conferência e tudo em dia não tocam o Chaveiro", () => {
  assert.equal(precisaDaChave({ conferir: false, faltam: 2 }), true);
  assert.equal(precisaDaChave({ conferir: false, faltam: 0 }), false, "tudo em dia: é o caso de toda rodada do agente");
  assert.equal(precisaDaChave({ conferir: true, faltam: 2 }), false);
  assert.equal(precisaDaChave({ conferir: true, faltam: 0 }), false);
});

test("derivado com código só sai do commit aprovado na lista deste Mac; só de ficha e ícone segue o ramo padrão", () => {
  const a = "e370fa82f45e89ba87189f267fe659f76abc50ea", b = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(PASTA_DE_CODIGO, "codigo");
  // Só ficha e ícone: sem commit aprovado pode (a ficha não traz código); com commit aprovado, é ele.
  assert.equal(recusaCommitDoDerivado({ repo: "a/b", temCodigo: false, commitAprovado: null, commitAtual: a }), null);
  assert.equal(recusaCommitDoDerivado({ repo: "a/b", temCodigo: false, commitAprovado: undefined, commitAtual: a }), null);
  assert.equal(recusaCommitDoDerivado({ repo: "a/b", temCodigo: false, commitAprovado: a, commitAtual: a }), null);
  // Com código e sem aprovação: recusa, e a frase já traz a linha a escrever na lista.
  const semAprovar = recusaCommitDoDerivado({ repo: "a/b", temCodigo: true, commitAprovado: null, commitAtual: a });
  assert.match(semAprovar, /traz código próprio \(pasta codigo\/\)/);
  assert.ok(semAprovar.includes(`"commit": "${a}"`));
  // Com código e aprovado: só aquele commit. Código novo no repositório não é assinado sozinho.
  assert.equal(recusaCommitDoDerivado({ repo: "a/b", temCodigo: true, commitAprovado: a, commitAtual: a }), null);
  assert.match(recusaCommitDoDerivado({ repo: "a/b", temCodigo: true, commitAprovado: a, commitAtual: b }), /está em 0123456789ab, e o commit aprovado é e370fa82f45e/);
  assert.match(recusaCommitDoDerivado({ repo: "a/b", temCodigo: false, commitAprovado: a, commitAtual: b }), /commit aprovado/);
});
