// Empacota um produto da tabela (src/main/app/variant-core.ts) de ponta a ponta: build, extensões embutidas (se o
// produto tiver), package e fuses. Um produto novo na tabela já empacota sem entrada nova no package.json:
//   npm run dist -- --variant <id>      (sem --variant: o meu-bot)
//   npm run dist -- --produto <pasta>   (um app derivado: a ficha e o ícone vêm do repositório dele)
// `--plataforma win32` (só os produtos marcados `windows` na tabela) troca o fim: em vez de assinar e instalar neste
// Mac, sai o instalador out/<nome>-<versão>-x64-setup.exe (scripts/instalador-win.mjs), para levar a um Windows.
// Os atalhos dist:staging, dist:inspector-staging e dist:admin só chamam este script com o id.
import { spawnSync } from "node:child_process";

const passo = (cmd, args) => {
  console.log(`\n▶ ${cmd} ${args.join(" ")}`);
  // No Windows (workflow "Windows", .github/workflows/windows.yml) o npm é um .cmd: só abre por um shell.
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error(`✗ falhou: ${cmd} ${args.join(" ")}`); process.exit(r.status ?? 1); }
};

passo("npm", ["run", "build"]);
// A tabela é lida do compilado: só depois do build.
const { alvoDe, exigeWindows, plataformaFromArgv, produtoFromArgv } = await import("./produtos.mjs");
const produto = produtoFromArgv();
const plataforma = plataformaFromArgv();
exigeWindows(produto, plataforma);
const alvo = [...alvoDe(produto), "--plataforma", plataforma];
if (produto.extensoes.length > 0) passo("npm", ["run", "build:extensao"]);
passo("node", ["scripts/package.mjs", ...alvo, ...(process.argv.includes("--sem-google") ? ["--sem-google"] : [])]);
passo("node", ["scripts/fuses.mjs", ...alvo]);
if (plataforma === "win32") { passo("node", ["scripts/instalador-win.mjs", "--variant", produto.variant]); process.exit(0); }
// Notarização (Developer ID) fica para a release (scripts/release.mjs, no .app e no .dmg) e para o `npm run dmg`:
// o build local instala neste Mac, sem quarentena, e não precisa esperar a Apple.
const { ehDeveloperId } = await import("./assinatura.mjs");
if (ehDeveloperId()) console.log("\n(assinado com Developer ID; a notarização acontece no npm run dmg e na release)");
