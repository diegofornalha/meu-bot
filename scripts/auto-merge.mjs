#!/usr/bin/env node
// Liga (ou desliga) o auto-merge de uma PR. Só lê a PR e executa: o que fazer é do planoAutoMerge
// (auto-merge-core.mjs, testado). É o que o workflow .github/workflows/auto-merge.yml roda; também serve na mão.
//   node scripts/auto-merge.mjs <n>                       decide e executa
//   node scripts/auto-merge.mjs <n> --check               só mostra a decisão e os passos
//   node scripts/auto-merge.mjs <n> --revisao=<conclusão> a conclusão da Revisão Claude que acabou de terminar
// Repositório: GITHUB_REPOSITORY (no Actions) ou o do diretório atual. Precisa do gh logado (GH_TOKEN no Actions).
import { spawnSync } from "node:child_process";
import { avisoSemRevisao, planoAutoMerge } from "./auto-merge-core.mjs";

const args = process.argv.slice(2);
const numero = args.find((a) => /^\d+$/.test(a));
if (numero === undefined) { console.error("uso: node scripts/auto-merge.mjs <número da PR> [--check] [--revisao=<conclusão>]"); process.exit(2); }
const check = args.includes("--check");
const revisao = args.find((a) => a.startsWith("--revisao="))?.slice("--revisao=".length) || null;
const repo = process.env["GITHUB_REPOSITORY"] ? ["-R", process.env["GITHUB_REPOSITORY"]] : [];

/** Roda o gh; devolve a saída ou encerra com o erro dele (o workflow falha e o motivo fica no log). */
function gh(cmd) {
  const r = spawnSync("gh", cmd, { encoding: "utf8" });
  if (r.status !== 0) { console.error(`✗ gh ${cmd.join(" ")}\n${(r.stderr || r.stdout || "").trim()}`); process.exit(1); }
  return (r.stdout ?? "").trim();
}

const v = JSON.parse(gh(["pr", "view", numero, ...repo, "--json", "number,state,author,isDraft,isCrossRepository,labels,title,headRefOid,headRefName,autoMergeRequest"]));
const pr = { estado: v.state, autor: v.author.login, deFork: v.isCrossRepository, rascunho: v.isDraft, rotulos: v.labels.map((l) => l.name), titulo: v.title, sha: v.headRefOid, ligado: v.autoMergeRequest !== null };
const rodadas = JSON.parse(gh(["run", "list", ...repo, "--workflow", "revisao-pr.yml", "--branch", v.headRefName, "--limit", "20", "--json", "headSha,status"]));
const plano = planoAutoMerge({ pr, rodadas, revisao });
console.log(`PR #${v.number} · ${plano.acao}: ${plano.motivo}${pr.ligado ? " · auto-merge já ligado" : ""} · passos: ${plano.passos.join(", ") || "nenhum"}`);
if (check) process.exit(0);

for (const passo of plano.passos) {
  if (passo === "desligar") { gh(["pr", "merge", numero, ...repo, "--disable-auto"]); console.log("auto-merge desligado"); }
  else if (passo === "ligar") { gh(["pr", "merge", numero, ...repo, "--merge", "--auto", "--delete-branch"]); console.log("auto-merge ligado: entra com o check testes verde e as conversas da revisão resolvidas"); }
  else if (passo === "avisar") { gh(["pr", "comment", numero, ...repo, "--body", avisoSemRevisao(revisao)]); console.log(`aviso deixado na PR: a revisão terminou como ${revisao}`); }
}
