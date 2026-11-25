#!/usr/bin/env node
// Release dos apps DERIVADOS (docs/guia/derivados.md): cada um mora no repositório dele e é empacotado contra o core
// deste checkout. Para cada derivado da lista deste Mac: atualiza o clone, valida a ficha, empacota com a versão staging
// do core, assina com o Developer ID, notariza, zipa, assina o zip com a chave da release e publica com
// `gh release create -R <repositório do derivado>`. O atualizador do derivado procura lá (ficha › releases).
//
//   node scripts/release-derivados.mjs                 a versão é a da tag staging que aponta para o HEAD
//   node scripts/release-derivados.mjs --versao 1.2.3-staging.9
//   node scripts/release-derivados.mjs --conferir      diz o que publicaria; não empacota, não pede a chave, não publica
//   node scripts/release-derivados.mjs --so dono/repo  só um da lista
//
// A lista fica FORA do repositório do core (o core não sabe de derivado nenhum):
//   ~/Library/Application Support/meu-bot-release/derivados.json   (ou MEU_BOT_DERIVADOS)
//   [ { "repo": "dono/meu-bot-x", "pasta": "/caminho/do/clone", "commit": "<hash inteiro, opcional>" } ]
// `commit` fixa o commit do derivado que se empacota. É OBRIGATÓRIO quando o derivado traz código próprio (pasta
// codigo/): esse código é assinado com o Developer ID e vai por atualização automática, então só sai do commit que o
// dono deste Mac leu e aprovou. Derivado só de ficha e ícone pode seguir o ramo padrão.
// A pasta é um clone só do agente: a cada rodada ele vai para o origin/main do derivado (mudança local é recusada).
// Já publicada (a tag existe no repositório do derivado) = pulada: rodar de novo não repete nada, e sem nada a publicar
// o script nem pede a chave. É assim que o agente o chama a cada rodada para um derivado não ficar para trás. A falha
// de um derivado não impede os outros; o script sai com 1 se algum falhou.
import { execFileSync, spawnSync } from "node:child_process";
import { sign } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { identidadeDeveloperId } from "./assinatura.mjs";
import { lerChavePrincipal } from "./chave-release.mjs";
import { notarizar } from "./notarizar.mjs";
import { argsReleaseDerivado, notasDoDerivado, parseDerivados, PASTA_DE_CODIGO, precisaDaChave, recusaCommitDoDerivado, recusaDerivado, recusaSemDeveloperId, versaoDasTags, versaoStagingValida } from "./release-core.mjs";

const arg = (nome) => { const i = process.argv.indexOf(nome); return i >= 0 ? process.argv[i + 1] : undefined; };
const conferir = process.argv.includes("--conferir");
const so = arg("--so");
const LISTA = process.env.MEU_BOT_DERIVADOS ?? join(homedir(), "Library", "Application Support", "meu-bot-release", "derivados.json");
const step = (t) => console.log(`\n▶ ${t}`);
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const shOu = (cmd, args, cwd) => { try { return sh(cmd, args, cwd); } catch { return null; } };
const rodar = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit" }).status === 0;

let crua = null;
if (existsSync(LISTA)) { try { crua = JSON.parse(readFileSync(LISTA, "utf8")); } catch (e) { console.error(`✗ não li ${LISTA}: ${e.message}`); process.exit(64); } }
const lista = parseDerivados(crua);
if (lista.erro !== undefined) { console.error(`✗ ${LISTA}: ${lista.erro}`); process.exit(64); }
const itens = lista.itens.filter((d) => so === undefined || d.repo.toLowerCase() === so.toLowerCase());
if (itens.length === 0) { console.log(so === undefined ? `sem derivados em ${LISTA}: nada a publicar` : `${so} não está em ${LISTA}`); process.exit(so === undefined ? 0 : 64); }

const versao = arg("--versao") ?? versaoDasTags((shOu("git", ["tag", "--points-at", "HEAD"]) ?? "").split("\n"));
if (!versaoStagingValida(versao)) { console.error("✗ sem versão staging: o HEAD não tem tag vX.Y.Z-staging.N (rode depois da release staging do core) nem veio --versao"); process.exit(64); }
const tag = `v${versao}`;
const commitCore = shOu("git", ["rev-parse", "--short", "HEAD"]) ?? "?";
const arch = process.arch === "arm64" ? "arm64" : "x64";

/** A ficha do derivado, lida num processo à parte: uma ficha recusada sai com 64 lá, sem derrubar os outros. */
function lerFicha(pasta) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const { derivadoFromArgv } = await import(${JSON.stringify(new URL("./produtos.mjs", import.meta.url).href)}); process.stdout.write(JSON.stringify(derivadoFromArgv(["", "", "--produto", ${JSON.stringify(pasta)}])));`], { encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || "ficha ilegível").trim().replace(/^✗ /, ""));
  return JSON.parse(r.stdout);
}

/**
 * Primeira passada, barata e sem chave: leva o clone ao ramo padrão, valida a ficha e vê se a versão já está no
 * repositório do derivado. Devolve o que falta publicar; o que já está lá é pulado. É o que deixa o agente chamar este
 * script a cada rodada para recuperar um derivado que ficou para trás, sem pedir a chave quando não há o que fazer.
 */
function preparar({ repo, pasta, commit }) {
  if (!existsSync(join(pasta, ".git"))) throw new Error(`${pasta} não é um clone do git (clone ${repo} lá)`);
  if (sh("git", ["status", "--porcelain"], pasta) !== "") throw new Error(`o clone ${pasta} tem mudanças locais: ele é só do agente, desfaça-as`);
  sh("git", ["fetch", "-q", "origin"], pasta);
  // Com commit aprovado na lista, é ele; sem, o ramo padrão do derivado (origin/HEAD quando o clone o conhece, senão origin/main).
  sh("git", ["checkout", "-q", "--detach", commit ?? (shOu("git", ["rev-parse", "--verify", "-q", "origin/HEAD"], pasta) !== null ? "origin/HEAD" : "origin/main")], pasta);
  const commitDerivado = sh("git", ["rev-parse", "HEAD"], pasta);
  // Derivado com código próprio só sai do commit que o dono deste Mac aprovou (recusaCommitDoDerivado).
  const semAprovacao = recusaCommitDoDerivado({ repo, temCodigo: existsSync(join(pasta, PASTA_DE_CODIGO)), commitAprovado: commit, commitAtual: commitDerivado });
  if (semAprovacao !== null) throw new Error(semAprovacao);
  const produto = lerFicha(pasta);
  const recusa = recusaDerivado(produto, repo);
  if (recusa !== null) throw new Error(recusa);
  if (shOu("gh", ["release", "view", tag, "-R", repo, "--json", "tagName", "-q", ".tagName"]) === tag) { console.log(`  ${produto.nome} ${versao} já está em ${repo}: em dia`); return null; }
  console.log(`  ${conferir ? "publicaria" : "falta publicar"} ${produto.nome} ${versao} em ${repo} (ficha do commit ${commitDerivado.slice(0, 12)}, core ${commitCore})`);
  return { repo, pasta, produto, commitDerivado };
}

function publicar({ repo, pasta, produto, commitDerivado }, chave) {
  step(`empacotando ${produto.nome} ${versao}`);
  if (!rodar("npm", ["run", "build"]) || !rodar("npm", ["run", "build:extensao"])) throw new Error("o build do core falhou");
  if (!rodar("node", ["scripts/package.mjs", "--produto", pasta, "--versao", versao]) || !rodar("node", ["scripts/fuses.mjs", "--produto", pasta, "--no-install"])) throw new Error("o empacotamento falhou");
  const app = join("out", `${produto.nome}-darwin-${arch}`, `${produto.nome}.app`);
  if (!existsSync(app)) throw new Error(`não achei ${app}`);
  step(`notarizando ${produto.nome}`);
  if (!notarizar(app)) throw new Error(`${produto.nome}.app não saiu notarizado`);
  const zip = join("out", `${produto.nome}-${versao}-${arch}.zip`);
  rmSync(zip, { force: true });
  execFileSync("ditto", ["-c", "-k", "--keepParent", app, zip]);
  const sig = sign(null, readFileSync(zip), chave).toString("base64");
  // Nunca publicar o que o app recusaria: a assinatura tem de conferir com UPDATE_PUBLIC_KEYS deste build do core.
  const { verificaAssinatura } = createRequire(import.meta.url)("../dist/main/atualizacao/updater-core.js");
  if (!verificaAssinatura(readFileSync(zip), sig)) throw new Error("a assinatura do zip não confere com nenhuma chave de UPDATE_PUBLIC_KEYS");
  writeFileSync(`${zip}.sig`, `${sig}\n`);
  const notasArquivo = join("out", `notas-${produto.nome}-${tag}.md`);
  writeFileSync(notasArquivo, notasDoDerivado({ nome: produto.nome, versao, commitCore, commitDerivado: commitDerivado.slice(0, 12) }));
  step(`publicando ${tag} em ${repo}`);
  execFileSync("gh", argsReleaseDerivado({ tag, repo, arquivos: [zip, `${zip}.sig`], titulo: `${produto.nome} ${versao}`, notasArquivo, commitDerivado }), { stdio: "inherit" });
  console.log(`✓ ${produto.nome} ${versao} publicado em ${repo}`);
}

// A ficha é validada pelo core compilado: sem dist/ (worktree recém-criado ou trocado de commit), compila antes.
if (!existsSync(new URL("../dist/main/app/variant-core.js", import.meta.url)) && !rodar("npm", ["run", "build"])) { console.error("✗ o build do core falhou: sem ele não dá para validar as fichas"); process.exit(1); }

let falhas = 0;
const faltam = [];
for (const d of itens) {
  step(`${d.repo}`);
  try { const p = preparar(d); if (p !== null) faltam.push(p); } catch (e) { falhas++; console.error(`✗ ${d.repo}: ${e instanceof Error ? e.message : String(e)}`); }
}
if (precisaDaChave({ conferir, faltam: faltam.length })) {
  // As mesmas travas da release do core, só quando há o que publicar: Developer ID no chaveiro e a chave da release.
  const recusa = recusaSemDeveloperId(identidadeDeveloperId());
  if (recusa !== null) { console.error(`✗ ${recusa}\nnada foi publicado`); process.exit(64); }
  step("lendo a chave da release no Chaveiro");
  const chave = lerChavePrincipal();
  if (chave === null) { console.error("✗ a chave da release não está no Chaveiro (ou o acesso foi negado): nada foi publicado"); process.exit(1); }
  for (const p of faltam) {
    try { publicar(p, chave); } catch (e) { falhas++; console.error(`✗ ${p.repo}: ${e instanceof Error ? e.message : String(e)}`); }
  }
}
if (falhas > 0) { console.error(`\n✗ ${falhas} de ${itens.length} derivado(s) não ${conferir ? "passaram na conferência" : "foram publicados"}`); process.exit(1); }
console.log(`\n✓ ${itens.length} derivado(s) ${conferir ? "conferido(s); nada foi publicado" : "em dia"}`);
