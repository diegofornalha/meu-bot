#!/usr/bin/env node
// Liga (ou desliga) o auto-merge de uma PR pela regra do auto-merge-core.mjs. É o que o workflow
// .github/workflows/auto-merge.yml roda; também serve na mão.
//   node scripts/auto-merge.mjs <n>                      decide e executa
//   node scripts/auto-merge.mjs <n> --check              só mostra a decisão
//   node scripts/auto-merge.mjs <n> --revisao=<conclusão> a conclusão da Revisão Claude que acabou de terminar
//   node scripts/auto-merge.mjs <n> --esperar-revisao    não liga se a Revisão Claude ainda está rodando neste commit
// Repositório: GITHUB_REPOSITORY (no Actions) ou o do diretório atual. Precisa do gh logado (GH_TOKEN no Actions).
import { spawnSync } from "node:child_process";
import { avisoSemRevisao, decidirAutoMerge, revisaoEmAndamento, revisaoNaoRodou } from "./auto-merge-core.mjs";

const args = process.argv.slice(2);
const numero = args.find((a) => /^\d+$/.test(a));
if (numero === undefined) { console.error("uso: node scripts/auto-merge.mjs <número da PR> [--check] [--revisao=<conclusão>] [--esperar-revisao]"); process.exit(2); }
const check = args.includes("--check");
const esperarRevisao = args.includes("--esperar-revisao");
const revisao = args.find((a) => a.startsWith("--revisao="))?.slice("--revisao=".length) ?? null;
const repo = process.env["GITHUB_REPOSITORY"] ? ["-R", process.env["GITHUB_REPOSITORY"]] : [];

/** Roda o gh; devolve a saída ou encerra com o erro dele (o workflow falha e o motivo fica no log). */
function gh(cmd, { tolerar = false } = {}) {
  const r = spawnSync("gh", cmd, { encoding: "utf8" });
  if (r.status !== 0 && !tolerar) { console.error(`✗ gh ${cmd.join(" ")}\n${(r.stderr || r.stdout).trim()}`); process.exit(1); }
  return { ok: r.status === 0, saida: (r.stdout ?? "").trim(), erro: (r.stderr ?? "").trim() };
}

const pr = JSON.parse(gh(["pr", "view", numero, ...repo, "--json", "number,state,author,isDraft,isCrossRepository,labels,title,headRefOid,headRefName,autoMergeRequest"]).saida);
const d = decidirAutoMerge({ estado: pr.state, autor: pr.author.login, deFork: pr.isCrossRepository, rascunho: pr.isDraft, rotulos: pr.labels.map((l) => l.name), titulo: pr.title });
const ligado = pr.autoMergeRequest !== null;
console.log(`PR #${pr.number} · ${d.acao}: ${d.motivo}${ligado ? " · auto-merge já ligado" : ""}`);
if (check) process.exit(0);

if (d.acao === "desligar") {
  if (ligado) { gh(["pr", "merge", numero, ...repo, "--disable-auto"]); console.log("auto-merge desligado"); }
  process.exit(0);
}
if (d.acao !== "ligar") process.exit(0);

// Rótulo ou título mudou no meio da revisão: quem liga é o fim dela (este script roda de novo ali).
if (esperarRevisao) {
  const rodadas = JSON.parse(gh(["run", "list", ...repo, "--workflow", "revisao-pr.yml", "--branch", pr.headRefName, "--limit", "20", "--json", "headSha,status"]).saida);
  if (revisaoEmAndamento(rodadas, pr.headRefOid)) { console.log("a Revisão Claude ainda está rodando neste commit: o auto-merge fica para o fim dela"); process.exit(0); }
}
if (!ligado) {
  const r = gh(["pr", "merge", numero, ...repo, "--merge", "--auto", "--delete-branch"], { tolerar: true });
  // "clean status": tudo já passou e não há o que esperar; o próprio comando mescla nesse caso em versões novas do gh.
  if (!r.ok) { console.error(`✗ não consegui ligar o auto-merge: ${r.erro || r.saida}`); process.exit(1); }
  console.log("auto-merge ligado: entra com o check testes verde e as conversas da revisão resolvidas");
}
if (revisaoNaoRodou(revisao)) { gh(["pr", "comment", numero, ...repo, "--body", avisoSemRevisao(revisao)]); console.log(`aviso deixado na PR: a revisão terminou como ${revisao}`); }
