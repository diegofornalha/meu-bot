import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTORES, ROTULO_NAO_MESCLAR, avisoSemRevisao, decidirAutoMerge, planoAutoMerge, revisaoEmAndamento, revisaoNaoRodou } from "../auto-merge-core.mjs";

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

// O plano inteiro: é o que o auto-merge.mjs executa, passo a passo, com o gh.
const plano = ({ over = {}, rodadas = [], revisao = null } = {}) => planoAutoMerge({ pr: { ...pr(), sha: "bbb", ligado: false, ...over }, rodadas, revisao });

test("plano: a revisão terminou e a PR é nossa → liga uma vez só", () => {
  assert.deepEqual(plano({ revisao: "success", rodadas: [{ headSha: "bbb", status: "completed" }] }).passos, ["ligar"]);
  assert.deepEqual(plano({ revisao: "skipped" }).passos, ["ligar"], "rótulo sem-claude: a revisão é pulada e a PR entra só com os testes");
  assert.deepEqual(plano({ over: { ligado: true }, revisao: "success" }).passos, [], "já ligado: nada a repetir");
  assert.deepEqual(plano({ revisao: null }).passos, ["ligar"], "tirou o rótulo com a revisão já terminada");
});

test("plano: revisão que não revisou liga e avisa; se outra ainda roda neste commit, espera", () => {
  assert.deepEqual(plano({ revisao: "failure" }).passos, ["ligar", "avisar"]);
  assert.deepEqual(plano({ over: { ligado: true }, revisao: "timed_out" }).passos, ["avisar"]);
  // A rodada antiga foi cancelada por uma nova do mesmo commit: nada de ligar nem de avisar "não revisou".
  const cancelada = plano({ revisao: "cancelled", rodadas: [{ headSha: "bbb", status: "completed" }, { headSha: "bbb", status: "in_progress" }] });
  assert.equal(cancelada.acao, "esperar");
  assert.deepEqual(cancelada.passos, []);
  // O mesmo pelo outro gatilho (tirar o rótulo no meio da revisão).
  assert.deepEqual(plano({ revisao: null, rodadas: [{ headSha: "bbb", status: "queued" }] }).passos, []);
  // Rodada em andamento de outro commit (a PR já andou) não segura.
  assert.deepEqual(plano({ revisao: "success", rodadas: [{ headSha: "aaa", status: "in_progress" }] }).passos, ["ligar"]);
});

test("plano: marcada para não entrar → desliga só se estava ligado; de fora → nunca mexe", () => {
  assert.deepEqual(plano({ over: { rotulos: ["nao-mesclar"], ligado: true } }).passos, ["desligar"]);
  assert.deepEqual(plano({ over: { rotulos: ["nao-mesclar"], ligado: false } }).passos, []);
  assert.deepEqual(plano({ over: { rascunho: true, ligado: true }, revisao: "skipped" }).passos, ["desligar"]);
  // Desligar não espera a revisão: a marca vale na hora.
  assert.deepEqual(plano({ over: { titulo: "Prova (NÃO MESCLAR)", ligado: true }, rodadas: [{ headSha: "bbb", status: "in_progress" }] }).passos, ["desligar"]);
  assert.deepEqual(plano({ over: { deFork: true, ligado: true }, revisao: "failure" }).passos, []);
  assert.deepEqual(plano({ over: { autor: "alguem-de-fora", rotulos: ["nao-mesclar"], ligado: true } }).passos, []);
  assert.deepEqual(plano({ over: { estado: "MERGED" }, revisao: "success" }).passos, []);
});
