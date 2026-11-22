// Regra do auto-merge das PRs, pura (testada em scripts/tests/auto-merge-core.test.mjs): dada uma PR, ligar o
// auto-merge, desligá-lo ou não tocar nela. O auto-merge.mjs só lê a PR e executa; o workflow
// .github/workflows/auto-merge.yml o chama quando a Revisão Claude termina e quando a PR muda de rótulo, título ou vira
// rascunho. Quem segura o merge de verdade continua sendo a proteção da main: o check `testes` e as conversas da
// revisão resolvidas.

/** Só as PRs de quem é do repositório; as mesmas contas que acionam a Revisão Claude (revisao-pr.yml). */
export const AUTORES = ["diegofornalha", "box-grok"];
/** Rótulo que tira a PR do auto-merge (PR de prova, mudança que o dono quer ver antes). */
export const ROTULO_NAO_MESCLAR = "nao-mesclar";
/** O mesmo aviso no título: a convenção que a skill `contribuir` já usa para PR de prova. */
const TITULO_NAO_MESCLAR = /n[aã]o\s+mesclar/i;
/** Conclusões da Revisão Claude em que ela não chegou a revisar: a PR entra mesmo assim, com um aviso nela. */
const REVISAO_NAO_RODOU = new Set(["failure", "cancelled", "timed_out", "startup_failure"]);

/**
 * `acao`: "ligar" o auto-merge, "desligar" (a PR é nossa mas está marcada para não entrar) ou "nada" (PR fechada, de
 * fork ou de outra pessoa: o workflow nunca mexe nela). `motivo` é a frase que vai para o log do workflow.
 */
export function decidirAutoMerge({ estado, autor, deFork, rascunho, rotulos, titulo }) {
  if (estado !== "OPEN") return { acao: "nada", motivo: "a PR não está aberta" };
  if (deFork) return { acao: "nada", motivo: "PR de fork: o auto-merge é só para branches deste repositório" };
  if (!AUTORES.includes(autor)) return { acao: "nada", motivo: `autor ${autor} fora da lista (${AUTORES.join(", ")})` };
  if (rascunho) return { acao: "desligar", motivo: "PR em rascunho" };
  if (rotulos.includes(ROTULO_NAO_MESCLAR)) return { acao: "desligar", motivo: `rótulo ${ROTULO_NAO_MESCLAR}` };
  if (TITULO_NAO_MESCLAR.test(titulo)) return { acao: "desligar", motivo: "título diz NÃO MESCLAR" };
  return { acao: "ligar", motivo: "PR do repositório, fora de rascunho e sem marca de não mesclar" };
}

/** A Revisão Claude terminou sem revisar (token, limite, cancelada)? `null`/"success"/"skipped" = não há o que avisar. */
export const revisaoNaoRodou = (conclusao) => typeof conclusao === "string" && REVISAO_NAO_RODOU.has(conclusao);

/** Há uma Revisão Claude ainda rodando para este commit? Ligar o auto-merge agora deixaria a PR entrar antes dos comentários. */
export function revisaoEmAndamento(rodadas, sha) {
  return rodadas.some((r) => r.headSha === sha && r.status !== "completed");
}

/** Aviso na PR quando ela vai entrar sem ter sido revisada. */
export const avisoSemRevisao = (conclusao) =>
  `A Revisão Claude não chegou a revisar esta PR (terminou como \`${conclusao}\`). O auto-merge foi ligado mesmo assim: ela entra quando o check \`testes\` passar. Para revisar antes, ponha o rótulo \`${ROTULO_NAO_MESCLAR}\` e comente \`@claude revise\`.`;

/**
 * O que fazer com a PR agora, em passos que o auto-merge.mjs executa na ordem: "desligar", "ligar", "avisar" (o
 * comentário de que entrou sem revisão). `pr` = { estado, autor, deFork, rascunho, rotulos, titulo, sha, ligado };
 * `rodadas` = as da Revisão Claude no branch ({ headSha, status }); `revisao` = a conclusão da rodada que acabou de
 * terminar, ou null quando o gatilho foi rótulo, título ou rascunho.
 * Com uma revisão ainda rodando no commit atual, nada é ligado nem avisado, venha o gatilho de onde vier: uma rodada
 * cancelada por outra mais nova também termina ("cancelled"), e ligar ali deixaria a PR entrar antes dos comentários
 * da que ainda roda. O fim dela chama isto de novo.
 */
export function planoAutoMerge({ pr, rodadas, revisao }) {
  const d = decidirAutoMerge(pr);
  if (d.acao === "nada") return { ...d, passos: [] };
  if (d.acao === "desligar") return { ...d, passos: pr.ligado ? ["desligar"] : [] };
  if (revisaoEmAndamento(rodadas, pr.sha)) return { acao: "esperar", motivo: "a Revisão Claude ainda está rodando neste commit: o auto-merge fica para o fim dela", passos: [] };
  return { ...d, passos: [...(pr.ligado ? [] : ["ligar"]), ...(revisaoNaoRodou(revisao) ? ["avisar"] : [])] };
}
