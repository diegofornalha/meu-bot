import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTORES, ROTULO_NAO_MESCLAR, avisoSemRevisao, decidirAutoMerge, revisaoEmAndamento, revisaoNaoRodou } from "../auto-merge-core.mjs";

// Auto-merge das PRs (.github/workflows/auto-merge.yml): a regra que decide ligar, desligar ou não tocar.
const pr = (over = {}) => ({ estado: "OPEN", autor: "diegofornalha", deFork: false, rascunho: false, rotulos: [], titulo: "Seletor: algo muda", ...over });
const acao = (over) => decidirAutoMerge(pr(over)).acao;

test("PR do repositório, fora de rascunho e sem marca: liga", () => {
  assert.equal(acao(), "ligar");
  assert.equal(acao({ autor: "box-grok" }), "ligar");
  assert.deepEqual(AUTORES, ["diegofornalha", "box-grok"], "as mesmas contas da Revisão Claude");
  // Sem revisão (rótulo sem-claude) e outros rótulos não mudam nada: quem segura é o check testes.
  assert.equal(acao({ rotulos: ["sem-claude", "bug"] }), "ligar");
});

test("rascunho, rótulo nao-mesclar e NÃO MESCLAR no título: desliga", () => {
  assert.equal(acao({ rascunho: true }), "desligar");
  assert.equal(ROTULO_NAO_MESCLAR, "nao-mesclar");
  assert.equal(acao({ rotulos: ["bug", "nao-mesclar"] }), "desligar");
  for (const titulo of ["Prova (NÃO MESCLAR)", "prova: não mesclar ainda", "X (NAO MESCLAR: instalação não provada)", "nao  mesclar"]) assert.equal(acao({ titulo }), "desligar", titulo);
  assert.equal(acao({ titulo: "Mesclar providers.json sem apagar as outras entradas" }), "ligar", "'mesclar' sozinho não é marca");
  assert.match(decidirAutoMerge(pr({ rascunho: true })).motivo, /rascunho/);
});

test("PR de fork, de outra pessoa ou fechada: o workflow nunca mexe", () => {
  assert.equal(acao({ deFork: true }), "nada");
  assert.equal(acao({ autor: "dependabot[bot]" }), "nada");
  assert.equal(acao({ autor: "alguem-de-fora" }), "nada");
  assert.equal(acao({ estado: "MERGED" }), "nada");
  assert.equal(acao({ estado: "CLOSED" }), "nada");
  // Nem desliga: uma PR de fora em rascunho ou com o rótulo continua intocada.
  assert.equal(acao({ deFork: true, rascunho: true }), "nada");
  assert.equal(acao({ autor: "alguem-de-fora", rotulos: ["nao-mesclar"] }), "nada");
});

test("revisão que não chegou a revisar vira aviso na PR; revisão pulada ou concluída, não", () => {
  for (const c of ["failure", "cancelled", "timed_out", "startup_failure"]) assert.equal(revisaoNaoRodou(c), true, c);
  for (const c of ["success", "skipped", "neutral", null, undefined, ""]) assert.equal(revisaoNaoRodou(c), false, String(c));
  const aviso = avisoSemRevisao("cancelled");
  assert.match(aviso, /`cancelled`/);
  assert.match(aviso, /nao-mesclar/);
  assert.match(aviso, /@claude revise/);
});

test("revisão ainda rodando neste commit: o auto-merge espera o fim dela", () => {
  const rodadas = [{ headSha: "aaa", status: "completed" }, { headSha: "bbb", status: "in_progress" }];
  assert.equal(revisaoEmAndamento(rodadas, "bbb"), true);
  assert.equal(revisaoEmAndamento([{ headSha: "bbb", status: "queued" }], "bbb"), true);
  assert.equal(revisaoEmAndamento(rodadas, "aaa"), false, "a deste commit já terminou");
  assert.equal(revisaoEmAndamento(rodadas, "ccc"), false, "commit novo: a revisão não roda de novo a cada push");
  assert.equal(revisaoEmAndamento([], "aaa"), false);
});
