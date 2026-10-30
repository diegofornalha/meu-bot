// Publica uma release no GitHub com os produtos de um canal zipados (tabela em src/main/app/variant-core.ts): é daí que a
// atualização automática (src/main/atualizacao/updater.ts) baixa. Dois modos (regras em release-core.mjs):
//   npm run release:staging  → pre-release v<versão>-staging.N com os apps staging (meu-bot-staging, meu-bot-finance-staging);
//                              N = próximo pelas tags que já existem. Os staging instalados atualizam sozinhos.
//   npm run release          → promoção: release v<versão> com os estáveis (meu-bot, meu-bot-admin), SÓ
//                              num commit que já tem a tag v<versão>-staging.N (o staging aprovado); senão sai com 64.
// <versão> é a do package.json (a próxima estável; "meu-bot 2.0" = `npm version 2.0.0 --no-git-tag-version`). Exige
// `gh` logado (`gh auth login`) e a árvore limpa. Gera out/<app>-<v>-<arch>.zip com `ditto -c -k --keepParent`
// (preserva symlinks e a assinatura). O .dmg continua sendo o instalador da primeira vez; a release só precisa dos .zip.
// Cada zip sai assinado com a chave Ed25519 principal (no Chaveiro: o macOS pede a aprovação do dono) num <zip>.sig, e
// cada .sig é conferido com UPDATE_PUBLIC_KEYS do build antes do upload: o app só instala o que confere com uma delas,
// como o SUPublicEDKey do Sparkle no Brave. Emergência (principal perdida ou vazada, troca de chave):
// `-- --emergencia --chave-arquivo <arquivo>` assina com a reserva (scripts/chave-release.mjs, skill publicar).
// Antes de empacotar, recusa publicar um componente da máquina (backend, financeiro, CRM, guarda) que mudou desde a
// última release sem subir a versão: o seletor só atualiza para cima, então a mudança nunca chegaria às máquinas.
import { sign } from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { CHAVE_RELEASE_ANTIGA, lerChaveArquivo, lerChavePrincipal } from "./chave-release.mjs";
import { componentesSemVersao, lerVersao, produtosDoCanal, proximaStaging, recusaPromocao } from "./release-core.mjs";

const staging = process.argv.includes("--staging");
const base = JSON.parse(readFileSync("package.json", "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(base)) { console.error(`✗ a versão do package.json (${base}) precisa ser x.y.z: ela é a próxima estável`); process.exit(64); }
const tags = execSync("git tag -l", { encoding: "utf8" }).split("\n");
const version = staging ? `${base}-staging.${proximaStaging(base, tags)}` : base;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const tag = `v${version}`;
const step = (s) => console.log(`\n▸ ${s}`);

if (execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "") { console.error("✗ árvore com mudanças: commite antes de publicar"); process.exit(64); }
try { execFileSync("gh", ["auth", "status"], { stdio: "ignore" }); } catch { console.error("✗ gh não está logado: rode `gh auth login`"); process.exit(64); }
if (execSync(`git tag -l ${tag}`, { encoding: "utf8" }).trim() !== "") { console.error(`✗ a tag ${tag} já existe: suba a versão no package.json`); process.exit(64); }
if (!staging) {
  const recusa = recusaPromocao(base, execSync("git tag --points-at HEAD", { encoding: "utf8" }).split("\n").filter(Boolean));
  if (recusa !== null) { console.error(`✗ ${recusa}`); process.exit(64); }
}

// A chave vem do Chaveiro (o macOS pede aprovação) antes de qualquer trabalho: negou, nada é publicado.
const iArq = process.argv.indexOf("--chave-arquivo");
let chave;
if (iArq >= 0) {
  if (!process.argv.includes("--emergencia")) { console.error("✗ --chave-arquivo é o caminho de emergência (troca de chave): confirme com --emergencia"); process.exit(64); }
  try { chave = lerChaveArquivo(process.argv[iArq + 1] ?? ""); } catch (e) { console.error(`✗ não li a chave do arquivo: ${e.message}`); process.exit(64); }
  console.log("⚠ emergência: assinando com a chave do arquivo, não com a principal do Chaveiro");
} else {
  step("lendo a chave da release no Chaveiro (aprove na janela do macOS)");
  chave = lerChavePrincipal();
  if (chave === null) {
    console.error(existsSync(CHAVE_RELEASE_ANTIGA)
      ? `✗ a chave ainda está no arquivo antigo (${CHAVE_RELEASE_ANTIGA}): rode \`npm run chave-release -- --migrar\``
      : "✗ não li a chave principal no Chaveiro (acesso negado, ou ela não está lá). Perdida? Veja \"Chave perdida ou vazada\" na skill publicar");
    process.exit(64);
  }
}

// A tabela de produtos e os componentes da máquina vêm do build (dist/main): compila o main antes de os ler.
step("compilando para ler a tabela de produtos");
execSync("npm run build:main", { stdio: "inherit" });

step("conferindo as versões dos componentes da máquina");
let ultima = null;
try { ultima = execSync('git describe --tags --abbrev=0 --match "v*"', { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; } catch { /* primeira release: nada a comparar */ }
if (ultima === null) console.log("  primeira release: sem tag anterior para comparar");
else {
  const { COMPONENTES } = createRequire(import.meta.url)("../dist/main/maquina/backend-bundle-core.js");
  const mudancas = execSync(`git diff --name-only ${ultima}..HEAD`, { encoding: "utf8" }).split("\n");
  const naTag = (f) => { try { return execFileSync("git", ["show", `${ultima}:${f}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
  const versoes = Object.fromEntries(COMPONENTES.map((c) => [c.nome, { antes: lerVersao(c.versao, naTag(c.versao)), agora: lerVersao(c.versao, existsSync(c.versao) ? readFileSync(c.versao, "utf8") : null) }]));
  const falta = componentesSemVersao(COMPONENTES, mudancas, versoes);
  if (falta.length > 0) { console.error(`✗ desde ${ultima}:\n  ${falta.join("\n  ")}`); process.exit(64); }
  console.log(`  ok desde ${ultima}`);
}
const { PRODUTOS } = await import("./produtos.mjs");
const zips = [];
for (const p of produtosDoCanal(PRODUTOS, staging ? "staging" : "estavel")) {
  const name = p.nome;
  step(`empacotando ${name}`);
  const extensao = p.extensoes.length === 0 ? "" : " && npm run build:extensao";
  execSync(`npm run build${extensao} && node scripts/package.mjs --variant ${p.variant} --versao ${version}${process.argv.includes("--sem-google") ? " --sem-google" : ""} && node scripts/fuses.mjs --variant ${p.variant} --no-install`, { stdio: "inherit" });
  const app = join("out", `${name}-darwin-${arch}`, `${name}.app`);
  if (!existsSync(app)) { console.error(`✗ não achei ${app}`); process.exit(1); }
  const zip = join("out", `${name}-${version}-${arch}.zip`);
  rmSync(zip, { force: true });
  execFileSync("ditto", ["-c", "-k", "--keepParent", app, zip]);
  const sig = sign(null, readFileSync(zip), chave).toString("base64");
  // Nunca publicar o que os apps recusariam: a assinatura precisa conferir com UPDATE_PUBLIC_KEYS deste build.
  const { verificaAssinatura } = createRequire(import.meta.url)("../dist/main/atualizacao/updater-core.js");
  if (!verificaAssinatura(readFileSync(zip), sig)) { console.error("✗ a assinatura não confere com nenhuma chave de UPDATE_PUBLIC_KEYS: nada foi publicado"); process.exit(1); }
  writeFileSync(`${zip}.sig`, `${sig}\n`);
  zips.push(zip, `${zip}.sig`);
}
step(`criando a release ${tag}`);
execFileSync("git", ["tag", tag]); execFileSync("git", ["push", "origin", tag], { stdio: "inherit" });
execFileSync("gh", ["release", "create", tag, ...zips, "--title", `meu-bot ${version}`, "--generate-notes", ...(staging ? ["--prerelease"] : [])], { stdio: "inherit" });
console.log(`\n✓ ${tag} publicada com ${zips.join(", ")}. Os apps instalados atualizam sozinhos na próxima verificação (até 6 h) ou ao reabrir.`);
if (!staging) console.log(`\n▸ próximo passo: suba a versão base para a próxima estável (ex.: npm version minor --no-git-tag-version) e commite; os builds locais e os staging seguintes saem dela.`);
