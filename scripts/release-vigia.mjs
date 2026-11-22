// Vigia da release automática, para rodar FORA do Mac que publica (GitHub Actions, de 2 em 2 horas): acusa quando a
// `main` fica sem release staging além do prazo, ou com a base por subir depois da estável. A regra é `releaseParada`
// (release-core.mjs), a mesma decisão do agente. Sai 1 com a frase do alerta (o workflow falha e o GitHub avisa o
// dono); 0 quando está em dia. Falha ao ler o git também sai 1, com a frase do motivo no resumo (nunca só o stack).
//
//   node scripts/release-vigia.mjs
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { releaseParada } from "./release-core.mjs";

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const shOu = (cmd, args) => { try { return sh(cmd, args); } catch { return null; } };
const dizer = (texto) => { console.log(texto); if (process.env.GITHUB_STEP_SUMMARY) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${texto}\n`); } catch { /* resumo é cortesia */ } } };

let alerta, onde;
try {
  const ref = shOu("git", ["rev-parse", "--verify", "-q", "origin/main"]) !== null ? "origin/main" : "HEAD";
  const sha = sh("git", ["rev-parse", ref]);
  const base = JSON.parse(sh("git", ["show", `${ref}:package.json`])).version;
  const tagsTodas = sh("git", ["tag", "-l", "v*"]).split("\n").filter(Boolean);
  const tagsNoHead = sh("git", ["tag", "--points-at", sha]).split("\n").filter(Boolean);
  const commitEm = Date.parse(sh("git", ["log", "-1", "--format=%cI", sha]));
  const ultima = shOu("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", sha]);
  const mudouDesdeRelease = ultima ? (shOu("git", ["diff", "--name-only", `${ultima}..${sha}`]) ?? "").split("\n").filter(Boolean) : null;
  // Quando a estável da base saiu (tag anotada: a data dela; tag leve: a do commit).
  const estavel = shOu("git", ["for-each-ref", "--format=%(creatordate:iso-strict)", `refs/tags/v${base}`]);
  const estavelEm = estavel ? Date.parse(estavel) : null;
  if (!Number.isFinite(commitEm)) throw new Error(`data do commit ${sha.slice(0, 12)} ilegível`);
  alerta = releaseParada({ base, tagsTodas, tagsNoHead, commitEm, agora: Date.now(), mudouDesdeRelease, estavelEm: Number.isFinite(estavelEm) ? estavelEm : null });
  onde = `main ${sha.slice(0, 12)} · base ${base} · última release ${ultima ?? "nenhuma"}`;
} catch (e) {
  const msg = (e instanceof Error ? (e.stderr ? String(e.stderr).trim() : "") || e.message : String(e)).split("\n").pop();
  dizer(`✗ vigia não conseguiu ler o git: ${msg}`);
  process.exit(1);
}
dizer(alerta === null ? `✓ release em dia: ${onde}` : `✗ ${alerta}\n\n${onde}`);
process.exit(alerta === null ? 0 : 1);
