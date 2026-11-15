// Publica o site (Worker conta-api: agentesgrok.com, login, console e API da conta) sem esperar ninguém: é o que a
// skill publicar-site fazia à mão. Roda de um worktree no origin/main (o agente da release chama do dele).
//
//   node scripts/site-publicar.mjs               testes → staging → confere → produção → confere
//   node scripts/site-publicar.mjs --so-staging  para depois de conferir o staging
//   node scripts/site-publicar.mjs --conferir    só confere os dois ambientes no ar, sem publicar
//
// Conferência que falha depois do deploy desfaz o deploy (wrangler rollback) e sai com 1: o site volta ao que estava.
// As migrações do banco (D1) são aplicadas antes de cada deploy; `wrangler` precisa estar logado neste Mac
// (npx wrangler login, uma vez).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { faltasDoSite, PAGINAS_DO_SITE } from "./release-core.mjs";

const DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "conta-api");
const AMBIENTES = {
  staging: { site: "https://site-staging.agentesgrok.com", conta: "https://conta-staging.agentesgrok.com", env: ["--env", "staging"], migrar: "migrar:staging", deploy: "deploy:staging" },
  producao: { site: "https://agentesgrok.com", conta: "https://conta.agentesgrok.com", env: [], migrar: "migrar", deploy: "deploy" },
};
const step = (s) => console.log(`\n▸ ${s}`);
const rodar = (cmd, args) => spawnSync(cmd, args, { cwd: DIR, stdio: "inherit", env: { ...process.env, CI: "1" } }).status === 0;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function ler(url) {
  try { const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) }); return { status: r.status, texto: await r.text() }; } catch { return { status: 0, texto: "" }; }
}
const json = (t) => { try { return JSON.parse(t); } catch { return null; } };

/** Confere o ambiente no ar; tenta de novo por até ~1 min (o deploy leva alguns segundos para chegar ao edge). */
async function conferir(canal) {
  const a = AMBIENTES[canal];
  let faltas = [];
  for (let i = 0; i < 6; i++) {
    if (i > 0) await dormir(10000);
    const paginas = {};
    for (const c of PAGINAS_DO_SITE[canal]) paginas[c] = (await ler(`${a.site}${c}`)).status;
    faltas = faltasDoSite({ canal, health: json((await ler(`${a.conta}/health`)).texto), download: json((await ler(`${a.site}/download/mac.json`)).texto), paginas });
    if (faltas.length === 0) { console.log(`✓ ${canal} conferido no ar (${a.site})`); return true; }
  }
  for (const f of faltas) console.error(`✗ ${canal}: ${f}`);
  return false;
}

async function publicar(canal) {
  const a = AMBIENTES[canal];
  step(`migrações do banco (${canal})`);
  if (!rodar("npm", ["run", a.migrar])) { console.error(`✗ migrações de ${canal} falharam: nada foi publicado nele`); return false; }
  step(`deploy (${canal})`);
  if (!rodar("npm", ["run", a.deploy])) { console.error(`✗ deploy de ${canal} falhou`); return false; }
  if (await conferir(canal)) return true;
  step(`desfazendo o deploy de ${canal}`);
  if (!rodar("npx", ["wrangler", "rollback", ...a.env, "--message", "site-publicar: a conferência no ar falhou", "--yes"])) console.error(`✗ não consegui desfazer: rode \`npx wrangler rollback${a.env.length ? " --env staging" : ""}\` em conta-api`);
  return false;
}

async function main() {
  if (process.argv.includes("--conferir")) { const s = await conferir("staging"), p = await conferir("producao"); return s && p ? 0 : 1; }
  if (!existsSync(join(DIR, "package.json"))) { console.error(`✗ não achei ${DIR}`); return 1; }
  step("login no Cloudflare");
  if (!rodar("npx", ["wrangler", "whoami"])) { console.error("✗ wrangler sem login neste Mac: rode `npx wrangler login` em conta-api (uma vez)"); return 1; }
  step("dependências e testes do conta-api");
  if (!rodar("npm", ["ci"]) || !rodar("npm", ["test"])) { console.error("✗ testes do conta-api falharam: nada foi publicado"); return 1; }
  if (!(await publicar("staging"))) return 1;
  if (process.argv.includes("--so-staging")) return 0;
  if (!(await publicar("producao"))) return 1;
  console.log("\n✓ site publicado: staging e produção conferidos no ar");
  return 0;
}

process.exit(await main());
