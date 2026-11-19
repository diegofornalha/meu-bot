// Publica o site (Worker conta-api: agentesgrok.com, login, console e API da conta). A regra: main → staging →
// produção, sempre nessa ordem e no mesmo histórico. O staging recebe a main sozinho (o agente da release chama este
// script com --so-staging); a PRODUÇÃO só recebe o commit que está no staging e que o dono aprovou.
//
//   node scripts/site-publicar.mjs                  o mesmo que --so-staging. NÃO publica a produção.
//   node scripts/site-publicar.mjs --so-staging     testes → staging → confere; diz como aprovar
//   node scripts/site-publicar.mjs --aprovar <sha> [--roteiro <arquivo>]
//                                                   grava a aprovação do commit que está no staging (não publica nada)
//   node scripts/site-publicar.mjs --producao       testes → produção → confere; só com o commit aprovado
//   node scripts/site-publicar.mjs --conferir       só confere os dois ambientes no ar e relata, sem publicar
//
// O commit de cada ambiente está no /health dele (`commit`): este script o passa no deploy (--var COMMIT:<sha>).
// `commit: null` é "desconhecido" (deploy antigo ou à mão), não erro; só que não serve para aprovar.
// --producao recusa (saída 1, nada publicado) sem aprovação, se o commit aprovado não é o HEAD deste worktree, ou se o
// staging não está mais nesse commit. A aprovação fica na pasta de estado do agente (site-aprovado.json).
//
// Conferência reprovada depois do deploy desfaz o deploy (wrangler rollback) e sai com 1: o site volta ao que estava.
// Conferência sem resposta (este Mac sem rede, GitHub fora) não desfaz nada: sai com 1 e o agente tenta de novo.
// As migrações do banco (D1) são aplicadas antes de cada deploy; `wrangler` precisa estar logado neste Mac
// (npx wrangler login, uma vez).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARQUIVO_APROVACAO, commitNoAr, desfazDeploy, dirDoEstado, faltasDeConteudo, faltasDoSite, ordemDosAmbientes, PAGINAS_DO_SITE, podeAprovar, podePublicarProducao, SITE_NO_AR, varsDoWrangler } from "./release-core.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(RAIZ, "conta-api");
const APROVACAO = join(dirDoEstado({ env: process.env, home: homedir() }), ARQUIVO_APROVACAO);
const AMBIENTES = {
  staging: { ...SITE_NO_AR.staging, env: ["--env", "staging"], migrar: "migrar:staging" },
  producao: { ...SITE_NO_AR.producao, env: [], migrar: "migrar" },
};
const step = (s) => console.log(`\n▸ ${s}`);
const rodar = (cmd, args) => spawnSync(cmd, args, { cwd: DIR, stdio: "inherit", env: { ...process.env, CI: "1" } }).status === 0;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
/** git na raiz deste worktree: { status, saida }. */
const git = (...args) => { const r = spawnSync("git", args, { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); return { status: r.status, saida: (r.stdout ?? "").trim() }; };
const head = () => { const r = git("rev-parse", "HEAD"); return r.status === 0 ? r.saida : null; };
/** conta-api/ deste worktree é exatamente o do commit (nada modificado nem novo fora dele)? */
const contaApiLimpo = () => { const r = git("status", "--porcelain", "--", "conta-api"); return r.status === 0 && r.saida === ""; };

async function ler(url) {
  try { const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) }); return { status: r.status, texto: await r.text() }; } catch { return { status: 0, texto: "" }; }
}
const json = (t) => { try { return JSON.parse(t); } catch { return null; } };
/** O commit que o ambiente diz ter no ar (null = desconhecido ou sem resposta). */
const commitDe = async (canal) => commitNoAr(json((await ler(`${AMBIENTES[canal].conta}/health`)).texto));
/** TRIAL_DIAS e GA_ID do ambiente, do wrangler.toml deste worktree. */
const esperadoDe = (canal) => { const v = varsDoWrangler(readFileSync(join(DIR, "wrangler.toml"), "utf8"))[canal]; return { trialDias: v.TRIAL_DIAS, ga: v.GA_ID ?? "" }; };

/** Uma leitura do ambiente no ar: o básico (faltasDoSite) e o conteúdo (faltasDeConteudo). */
async function olhar(canal, commit) {
  const a = AMBIENTES[canal];
  const paginas = {};
  let home = { status: 0, texto: "" };
  for (const c of PAGINAS_DO_SITE[canal]) { const r = await ler(`${a.site}${c}`); paginas[c] = r.status; if (c === "/") home = r; }
  const h = await ler(`${a.conta}/health`), health = json(h.texto);
  const basico = faltasDoSite({ canal, health, download: json((await ler(`${a.site}/download/mac.json`)).texto), paginas });
  const conteudo = faltasDeConteudo({ canal, home, configJs: await ler(`${a.site}/config.js`), health, esperado: { ...esperadoDe(canal), commit } });
  return { basico, conteudo, health, desfazer: desfazDeploy({ canal, health, statusHealth: h.status, paginas }) || conteudo.desfazer };
}

/**
 * Confere o ambiente recém-publicado; tenta de novo por até ~1 min (o deploy leva alguns segundos para chegar ao edge).
 * `commit` = o sha que o deploy levou (o /health tem de mostrá-lo). Devolve { ok, desfazer }: `desfazer` só quando o
 * próprio Worker respondeu errado (desfazDeploy e faltasDeConteudo, release-core.mjs).
 */
async function conferirDeploy(canal, commit) {
  let faltas = [], desfazer = false;
  for (let i = 0; i < 6; i++) {
    if (i > 0) await dormir(10000);
    const o = await olhar(canal, commit);
    faltas = [...o.basico, ...o.conteudo.faltas];
    if (faltas.length === 0) { console.log(`✓ ${canal} conferido no ar (${AMBIENTES[canal].site}), commit ${commit}`); return { ok: true, desfazer: false }; }
    desfazer = o.desfazer;
  }
  for (const f of faltas) console.error(`✗ ${canal}: ${f}`);
  return { ok: false, desfazer };
}

/**
 * --conferir: o que está no ar agora, sem publicar nem desfazer nada. O básico que falha reprova (saída 1); as
 * diferenças de conteúdo só são relatadas (⚠): o ambiente pode estar num commit mais antigo que este worktree.
 */
async function conferirNoAr() {
  const commits = {};
  let ok = true;
  console.log(`comparando com o conta-api/wrangler.toml deste worktree (commit ${head() ?? "desconhecido"})`);
  for (const canal of ["staging", "producao"]) {
    const o = await olhar(canal, undefined);
    commits[canal] = commitNoAr(o.health);
    console.log(`\n${canal} (${AMBIENTES[canal].site}): commit ${commits[canal] ?? "desconhecido (publicado antes do portão ou à mão)"}`);
    if (o.basico.length === 0) console.log("✓ /health, download e páginas respondem"); else ok = false;
    for (const f of o.basico) console.error(`✗ ${f}`);
    if (o.conteudo.faltas.length === 0) console.log("✓ conteúdo: teste grátis, canal e medição batem com a configuração");
    for (const f of o.conteudo.faltas) console.log(`⚠ ${f}`);
  }
  let ancestral = null;
  if (commits.staging !== null && commits.producao !== null && commits.staging !== commits.producao) {
    const st = git("merge-base", "--is-ancestor", commits.producao, commits.staging).status;
    ancestral = st === 0 ? true : st === 1 ? false : null;
  }
  const ordem = ordemDosAmbientes({ staging: commits.staging, producao: commits.producao, ancestral });
  console.log(`\n${ordem.ok === true ? "✓" : "⚠"} ordem: ${ordem.texto}`);
  return ok ? 0 : 1;
}

async function publicar(canal, commit) {
  const a = AMBIENTES[canal];
  step(`migrações do banco (${canal})`);
  if (!rodar("npm", ["run", a.migrar])) { console.error(`✗ migrações de ${canal} falharam: nada foi publicado nele`); return false; }
  step(`deploy (${canal}), commit ${commit}`);
  // O deploy é só daqui (o `npm run deploy` do conta-api recusa): é este --var que põe o commit no /health.
  if (!rodar("npx", ["wrangler", "deploy", ...a.env, "--var", `COMMIT:${commit}`])) { console.error(`✗ deploy de ${canal} falhou`); return false; }
  const c = await conferirDeploy(canal, commit);
  if (c.ok) return true;
  // Sem rede neste Mac, só o download (GitHub) fora, ou só o commit ainda não aparecendo: nada prova que o deploy é ruim.
  if (!c.desfazer) { console.error(`✗ ${canal}: a conferência não fechou, mas o site não respondeu errado (rede deste Mac ou GitHub fora?). O deploy NÃO foi desfeito; rode de novo.`); return false; }
  step(`desfazendo o deploy de ${canal}`);
  if (!rodar("npx", ["wrangler", "rollback", ...a.env, "--message", "site-publicar: a conferência no ar falhou", "--yes"])) console.error(`✗ não consegui desfazer: rode \`npx wrangler rollback${a.env.length ? " --env staging" : ""}\` em conta-api`);
  return false;
}

/** Login no Cloudflare, dependências e testes: o que vem antes de qualquer deploy. */
function preparar() {
  if (!existsSync(join(DIR, "package.json"))) { console.error(`✗ não achei ${DIR}`); return false; }
  step("login no Cloudflare");
  if (!rodar("npx", ["wrangler", "whoami"])) { console.error("✗ wrangler sem login neste Mac: rode `npx wrangler login` em conta-api (uma vez)"); return false; }
  step("dependências e testes do conta-api");
  if (!rodar("npm", ["ci"]) || !rodar("npm", ["test"])) { console.error("✗ testes do conta-api falharam: nada foi publicado"); return false; }
  return true;
}

const lerAprovacao = () => { try { return JSON.parse(readFileSync(APROVACAO, "utf8")); } catch { return null; } };
const gravarAprovacao = (a) => { mkdirSync(dirname(APROVACAO), { recursive: true }); writeFileSync(APROVACAO, `${JSON.stringify(a, null, 2)}\n`); };
const argumento = (nome) => { const i = process.argv.indexOf(nome); return i >= 0 ? (process.argv[i + 1] ?? null) : null; };

async function aprovar() {
  const sha = argumento("--aprovar"), arquivo = argumento("--roteiro");
  let roteiro = null;
  if (process.argv.includes("--roteiro")) {
    try { roteiro = readFileSync(resolve(arquivo ?? ""), "utf8"); } catch { console.error(`✗ não li o roteiro ${arquivo ?? "(faltou o caminho)"}: nada foi aprovado`); return 1; }
  }
  const r = podeAprovar({ sha, commitStaging: await commitDe("staging") });
  if (r.erro) { console.error(`✗ não aprovado: ${r.erro}`); return 1; }
  gravarAprovacao({ sha, aprovadoEm: new Date().toISOString(), roteiro });
  console.log(`✓ commit ${sha} aprovado para a produção (${APROVACAO}). Nada foi publicado.`);
  console.log("  Para publicar, de um worktree nesse commit: node scripts/site-publicar.mjs --producao");
  return 0;
}

async function producao() {
  const aprovacao = lerAprovacao(), aprovado = aprovacao?.sha ?? null;
  // A main local pode estar atrasada: tenta atualizar antes de perguntar se o commit está nela (sem rede, vale a que há).
  if (aprovado !== null) git("fetch", "-q", "origin", "main");
  const naMain = aprovado !== null && git("merge-base", "--is-ancestor", aprovado, "origin/main").status === 0;
  const r = podePublicarProducao({ aprovado, head: head(), commitStaging: await commitDe("staging"), limpo: contaApiLimpo(), naMain });
  if (r.erro) { console.error(`✗ produção NÃO publicada: ${r.erro}`); return 1; }
  if (!preparar()) return 1;
  if (!(await publicar("producao", aprovado))) return 1;
  gravarAprovacao({ ...aprovacao, publicadoEm: new Date().toISOString() });
  console.log(`\n✓ produção publicada e conferida no ar, no commit ${aprovado} (o mesmo do staging)`);
  return 0;
}

async function staging() {
  const commit = head();
  if (commit === null) { console.error("✗ não consegui ler o commit deste worktree (git rev-parse HEAD): nada foi publicado"); return 1; }
  if (!contaApiLimpo()) { console.error("✗ conta-api/ tem mudanças fora do commit: o /health diria um commit que não é o que subiu. Faça o commit (ou desfaça) e rode de novo"); return 1; }
  if (!preparar()) return 1;
  if (!(await publicar("staging", commit))) return 1;
  console.log(`\n✓ staging publicado e conferido no ar, no commit ${commit}. A produção NÃO foi publicada.`);
  console.log("  Confira o staging (https://site-staging.agentesgrok.com) e, com o \"aprovado\" do dono:");
  console.log(`    node scripts/site-publicar.mjs --aprovar ${commit}`);
  console.log("    node scripts/site-publicar.mjs --producao");
  return 0;
}

const MODOS = ["--so-staging", "--aprovar", "--producao", "--conferir"];
async function main() {
  const pedidos = MODOS.filter((m) => process.argv.includes(m));
  const desconhecidos = process.argv.slice(2).filter((a) => a.startsWith("--") && !MODOS.includes(a) && a !== "--roteiro");
  if (pedidos.length > 1 || desconhecidos.length > 0) { console.error(`uso: node scripts/site-publicar.mjs [--so-staging | --aprovar <sha> [--roteiro <arquivo>] | --producao | --conferir]`); return 64; }
  if (pedidos[0] === "--conferir") return conferirNoAr();
  if (pedidos[0] === "--aprovar") return aprovar();
  if (pedidos[0] === "--producao") return producao();
  return staging();
}

process.exit(await main());
