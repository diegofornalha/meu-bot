// Vigia da release automática, para rodar FORA do Mac que publica (GitHub Actions, de 2 em 2 horas): acusa quando a
// `main` fica sem release staging além do prazo. A regra é `releaseParada` (release-core.mjs), a mesma decisão do
// agente. Sai 1 com a frase do alerta (o workflow falha e o GitHub avisa o dono); 0 quando está em dia.
//
//   node scripts/release-vigia.mjs
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { releaseParada } from "./release-core.mjs";

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const shOu = (cmd, args) => { try { return sh(cmd, args); } catch { return null; } };

const ref = shOu("git", ["rev-parse", "--verify", "-q", "origin/main"]) !== null ? "origin/main" : "HEAD";
const sha = sh("git", ["rev-parse", ref]);
const base = JSON.parse(sh("git", ["show", `${ref}:package.json`])).version;
const tagsTodas = sh("git", ["tag", "-l", "v*"]).split("\n").filter(Boolean);
const tagsNoHead = sh("git", ["tag", "--points-at", sha]).split("\n").filter(Boolean);
const commitEm = Date.parse(sh("git", ["log", "-1", "--format=%cI", sha]));
const ultima = shOu("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", sha]);
const mudouDesdeRelease = ultima ? (shOu("git", ["diff", "--name-only", `${ultima}..${sha}`]) ?? "").split("\n").filter(Boolean) : null;

const alerta = releaseParada({ base, tagsTodas, tagsNoHead, commitEm, agora: Date.now(), mudouDesdeRelease });
const resumo = alerta === null
  ? `✓ release em dia: main ${sha.slice(0, 12)} · base ${base} · última release ${ultima ?? "nenhuma"}`
  : `✗ ${alerta}\n\nmain ${sha.slice(0, 12)} · base ${base} · última release ${ultima ?? "nenhuma"} · ${mudouDesdeRelease?.length ?? "?"} arquivo(s) mudados desde ela`;
console.log(resumo);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${resumo}\n`);
process.exit(alerta === null ? 0 : 1);
