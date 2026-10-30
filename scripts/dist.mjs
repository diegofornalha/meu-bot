// Empacota um produto da tabela (src/main/app/variant-core.ts) de ponta a ponta: build, extensões embutidas (se o
// produto tiver), package e fuses. Um produto novo na tabela já empacota sem entrada nova no package.json:
//   npm run dist -- --variant <id>      (sem --variant: o meu-bot)
// Os atalhos dist:staging, dist:finance-staging, dist:diego(-staging) e dist:admin só chamam este script com o id.
import { spawnSync } from "node:child_process";

const passo = (cmd, args) => {
  console.log(`\n▶ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) { console.error(`✗ falhou: ${cmd} ${args.join(" ")}`); process.exit(r.status ?? 1); }
};

passo("npm", ["run", "build"]);
// A tabela é lida do compilado: só depois do build.
const { produtoFromArgv } = await import("./produtos.mjs");
const produto = produtoFromArgv();
if (produto.extensoes.length > 0) passo("npm", ["run", "build:extensao"]);
passo("node", ["scripts/package.mjs", "--variant", produto.variant, ...(process.argv.includes("--sem-google") ? ["--sem-google"] : [])]);
passo("node", ["scripts/fuses.mjs", "--variant", produto.variant]);
