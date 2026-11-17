// Publica uma release no GitHub com os produtos de um canal zipados (tabela em src/main/app/variant-core.ts): é daí que a
// atualização automática (src/main/atualizacao/updater.ts) baixa. Dois modos (regras em release-core.mjs):
//   npm run release:staging  → pre-release v<versão>-staging.N com os apps staging (meu-bot-staging, meu-bot-finance-staging, meu-bot-inspector-staging);
//                              N = próximo pelas tags que já existem. Os staging instalados atualizam sozinhos.
//   npm run release -- --conferir (ou release:staging -- --conferir) → só confere tudo, sem empacotar nem publicar.
//   npm run release          → promoção: release v<versão> com os estáveis (meu-bot, meu-bot-admin), SÓ
//                              num commit que já tem a tag v<versão>-staging.N (o staging aprovado); senão sai com 64.
// <versão> é a do package.json (a próxima estável; "meu-bot 2.0" = `npm version 2.0.0 --no-git-tag-version`). Exige
// `gh` logado (`gh auth login`) e a árvore limpa. As notas da release saem da seção "Ainda não lançado" do
// docs/CHANGELOG.md (linguagem de quem usa); sem ela, caem na lista de commits do GitHub, com aviso.
// Gera out/<app>-<v>-<arch>.zip com `ditto -c -k --keepParent`
// (preserva symlinks e a assinatura). O .dmg continua sendo o instalador da primeira vez; a release só precisa dos .zip.
// Cada zip sai assinado com a chave Ed25519 principal (no Chaveiro: o macOS pede a aprovação do dono) num <zip>.sig, e
// cada .sig é conferido com UPDATE_PUBLIC_KEYS do build antes do upload: o app só instala o que confere com uma delas,
// como o SUPublicEDKey do Sparkle no Brave. Emergência (principal perdida ou vazada, troca de chave):
// `-- --emergencia --chave-arquivo <arquivo>` assina com a reserva (scripts/chave-release.mjs, skill publicar).
// Antes de empacotar, recusa publicar um componente da máquina (backend, financeiro, CRM, guarda) que mudou desde a
// última release sem subir a versão: o seletor só atualiza para cima, então a mudança nunca chegaria às máquinas.
import { sign } from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { CHAVE_RELEASE_ANTIGA, lerChaveArquivo, lerChavePrincipal } from "./chave-release.mjs";
import { componentesPendentes } from "./release-checar.mjs";
import { lerFragmentos } from "./changelog-fragmentos.mjs";
import { clientesGoogleParaPublicar, dependenciasDesalinhadas, faltasParaPublicar, notasDaRelease, produtosComInstalador, produtosDoCanal, proximaStaging, recusaPromocao } from "./release-core.mjs";
import { notarizar } from "./notarizar.mjs";

const staging = process.argv.includes("--staging");
// `--conferir`: roda todas as recusas e conferências e sai antes de empacotar, sem tag nem release (skill aprovar-estavel).
const conferir = process.argv.includes("--conferir");
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
step("conferindo o node_modules contra o package-lock");
{
  const versaoInstalada = (nome) => { try { return JSON.parse(readFileSync(join("node_modules", nome, "package.json"), "utf8")).version; } catch { return null; } };
  const erradas = dependenciasDesalinhadas(JSON.parse(readFileSync("package-lock.json", "utf8")), versaoInstalada);
  if (erradas.length > 0) { console.error(`✗ o node_modules não é o do package-lock (rode npm ci aqui):\n  ${erradas.join("\n  ")}\nnada foi publicado`); process.exit(1); }
}
step("compilando para ler a tabela de produtos");
execSync("npm run build:main", { stdio: "inherit" });

step("conferindo as versões dos componentes da máquina");
{
  const { ultima, falta } = componentesPendentes();
  if (ultima === null) console.log("  primeira release: sem tag anterior para comparar");
  else if (falta.length > 0) { console.error(`✗ desde ${ultima}:\n  ${falta.join("\n  ")}`); process.exit(64); }
  else console.log(`  ok desde ${ultima}`);
}
const { PRODUTOS } = await import("./produtos.mjs");
if (conferir) {
  const produtos = produtosDoCanal(PRODUTOS, staging ? "staging" : "estavel");
  const notasConferidas = notasDaRelease(existsSync("docs/CHANGELOG.md") ? readFileSync("docs/CHANGELOG.md", "utf8") : null, lerFragmentos());
  const { erros, avisos } = faltasParaPublicar({ produtos, existe: existsSync, notas: notasConferidas });
  const commit = execSync("git log -1 --format=%h", { encoding: "utf8" }).trim();
  for (const e of erros) console.error(`✗ ${e}`);
  for (const a of avisos) console.log(`⚠ ${a}`);
  if (erros.length > 0) process.exit(64);
  const itens = notasConferidas === null ? 0 : notasConferidas.split("\n").filter((l) => l.startsWith("- ")).length;
  console.log(`\n✓ conferido: ${tag} pode sair do commit ${commit} com ${produtos.map((p) => p.nome).join(", ")} (${itens} itens nas notas). Nada foi publicado.`);
  process.exit(0);
}
const zips = [];
for (const p of produtosDoCanal(PRODUTOS, staging ? "staging" : "estavel")) {
  const name = p.nome;
  step(`empacotando ${name}`);
  const extensao = p.extensoes.length === 0 ? "" : " && npm run build:extensao";
  execSync(`npm run build${extensao} && node scripts/package.mjs --variant ${p.variant} --versao ${version}${process.argv.includes("--sem-google") ? " --sem-google" : ""} && node scripts/fuses.mjs --variant ${p.variant} --no-install`, { stdio: "inherit" });
  const app = join("out", `${name}-darwin-${arch}`, `${name}.app`);
  if (!existsSync(app)) { console.error(`✗ não achei ${app}`); process.exit(1); }
  // Developer ID: o .app vai notarizado e grampeado dentro do .zip (o atualizador troca o app sem passar pelo .dmg).
  // Sem Developer ID, notarizar() só avisa: a release sai assinada com "meu-bot local", como antes.
  step(`notarizando ${name}`);
  notarizar(app);
  const zip = join("out", `${name}-${version}-${arch}.zip`);
  rmSync(zip, { force: true });
  execFileSync("ditto", ["-c", "-k", "--keepParent", app, zip]);
  const sig = sign(null, readFileSync(zip), chave).toString("base64");
  // Nunca publicar o que os apps recusariam: a assinatura precisa conferir com UPDATE_PUBLIC_KEYS deste build.
  const { verificaAssinatura } = createRequire(import.meta.url)("../dist/main/atualizacao/updater-core.js");
  if (!verificaAssinatura(readFileSync(zip), sig)) { console.error("✗ a assinatura não confere com nenhuma chave de UPDATE_PUBLIC_KEYS: nada foi publicado"); process.exit(1); }
  writeFileSync(`${zip}.sig`, `${sig}\n`);
  zips.push(zip, `${zip}.sig`);
  // O instalador (janela de arrastar para Aplicativos) é o que o site entrega; o atualizador segue no .zip + .sig.
  if (produtosComInstalador([p], p.canal).length > 0) {
    step(`instalador de ${name}`);
    execFileSync("node", ["scripts/dmg.mjs", "--variant", p.variant, "--versao", version], { stdio: "inherit" });
    const dmg = join("out", `${name}-${version}-${arch}.dmg`);
    if (!existsSync(dmg)) { console.error(`✗ não achei ${dmg}: nada foi publicado`); process.exit(1); }
    zips.push(dmg);
  }
  // Windows (produtos marcados `windows` na tabela): o instalador sai na mesma release, com a mesma versão e a mesma
  // chave. Uma falha aqui para tudo antes da tag: Mac e Windows nunca saem em versões diferentes.
  if (p.windows) {
    step(`instalador Windows de ${name}`);
    execSync(`node scripts/package.mjs --variant ${p.variant} --versao ${version} --plataforma win32${process.argv.includes("--sem-google") ? " --sem-google" : ""} && node scripts/fuses.mjs --variant ${p.variant} --plataforma win32 && node scripts/instalador-win.mjs --variant ${p.variant} --versao ${version}`, { stdio: "inherit" });
    const { assetName, verificaAssinatura } = createRequire(import.meta.url)("../dist/main/atualizacao/updater-core.js");
    // O nome é o que o atualizador do Windows procura (assetName): se o instalador sair com outro, não publica.
    const exe = join("out", assetName(name, version, "x64", "win32"));
    if (!existsSync(exe)) { console.error(`✗ não achei ${exe}: nada foi publicado`); process.exit(1); }
    const sigExe = sign(null, readFileSync(exe), chave).toString("base64");
    if (!verificaAssinatura(readFileSync(exe), sigExe)) { console.error("✗ a assinatura do instalador Windows não confere com nenhuma chave de UPDATE_PUBLIC_KEYS: nada foi publicado"); process.exit(1); }
    writeFileSync(`${exe}.sig`, `${sigExe}\n`);
    zips.push(exe, `${exe}.sig`);
  }
}
// Client OAuth do Google como asset avulso e assinado: o app que veio sem (Mac que empacotou sem config/) baixa daqui
// sozinho e confere com UPDATE_PUBLIC_KEYS (src/main/google/cliente-release.ts). Sem os arquivos neste Mac, avisa.
const clientes = clientesGoogleParaPublicar(existsSync);
if (clientes.length === 0) console.log("\n(sem config/google-oauth.json nem config/google-conta-oauth.json neste Mac: a release sai sem o client do Google e os apps mostram \"não configurado\")");
for (const n of clientes) {
  step(`assinando ${n} (client OAuth do Google, para os apps que vieram sem)`);
  const dst = join("out", n); copyFileSync(join("config", n), dst);
  const s = sign(null, readFileSync(dst), chave).toString("base64");
  const { verificaAssinatura } = createRequire(import.meta.url)("../dist/main/atualizacao/updater-core.js");
  if (!verificaAssinatura(readFileSync(dst), s)) { console.error(`✗ a assinatura de ${n} não confere com UPDATE_PUBLIC_KEYS: nada foi publicado`); process.exit(1); }
  writeFileSync(`${dst}.sig`, `${s}\n`);
  zips.push(dst, `${dst}.sig`);
}
// As notas são o que a pessoa lê na página da release: vêm do CHANGELOG, não do histórico de commits.
step("montando as notas da release");
const notas = notasDaRelease(existsSync("docs/CHANGELOG.md") ? readFileSync("docs/CHANGELOG.md", "utf8") : null, lerFragmentos());
let comoNotas = ["--generate-notes"];
if (notas === null) {
  console.log('  ⚠ docs/CHANGELOG.md não tem uma seção "Ainda não lançado" com conteúdo: a release vai sair com a');
  console.log("    lista de commits do GitHub, que descreve o diff e não a mudança. Escreva a seção e publique de novo.");
} else {
  const arquivo = join("out", `notas-${tag}.md`);
  writeFileSync(arquivo, `${notas}\n\n---\n\nChangelog completo: https://github.com/diegofornalha/meu-bot/blob/${tag}/docs/CHANGELOG.md\n`);
  comoNotas = ["--notes-file", arquivo];
  console.log(`  ${notas.split("\n").filter((l) => l.startsWith("- ")).length} itens, de "Ainda não lançado" (${arquivo})`);
}

step(`criando a release ${tag}`);
execFileSync("git", ["tag", tag]); execFileSync("git", ["push", "origin", tag], { stdio: "inherit" });
execFileSync("gh", ["release", "create", tag, ...zips, "--title", `meu-bot ${version}`, ...comoNotas, ...(staging ? ["--prerelease"] : [])], { stdio: "inherit" });
console.log(`\n✓ ${tag} publicada com ${zips.join(", ")}. Os apps instalados atualizam sozinhos na próxima verificação (até 6 h) ou ao reabrir.`);
if (!staging) console.log(`\n▸ próximo passo: suba a versão base para a próxima estável (ex.: npm version minor --no-git-tag-version) e commite; os builds locais e os staging seguintes saem dela.`);
