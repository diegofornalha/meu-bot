import { packager } from "@electron/packager";
import { copyFileSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { archOf, produtoFromArgv, versaoFromArgv } from "./produtos.mjs";
import { avisoSemGoogle, decideGoogleConta } from "./google-client.mjs";

// `--variant <id>` (ou `--admin`) empacota outro produto da tabela (src/main/app/variant-core.ts): mesmo código, outro
// nome, bundle id e ícone. O app sabe qual é pelo Resources/variant.json e usa userData próprio
// (src/main/app/user-data.ts; o Electron nomearia a pasta pelo productName do package.json, igual em todos), então os
// apps convivem abertos ao mesmo tempo. Produto com extensões embutidas leva build/<extensao> em Resources/.
const produto = produtoFromArgv();
// `--versao <x>`: a versão do build (o release staging passa "0.2.0-staging.N"). Vai no Info.plist (appVersion) e no
// package.json de dentro do app (hook antes do asar), que é o que app.getVersion() lê: os dois batem.
const versao = versaoFromArgv();
const admin = produto.variant === "admin";
const name = produto.nome;
const arch = archOf();
for (const e of produto.extensoes) if (!existsSync(join("build", e, "manifest.json"))) {
  console.error(`✗ falta build/${e}/manifest.json: rode \`npm run build:extensao\` antes de empacotar o ${name}`);
  process.exit(1);
}
// Produto com módulos (meu-bot-diego): o repositório dele é um submódulo em produtos/<nome>; o manifesto precisa estar
// lá e válido antes de empacotar (só este app o leva em Resources/<nome>/; os outros não levam nada dele).
const modulos = produto.caps.modulos;
if (modulos !== null) {
  const manifesto = join("produtos", modulos, "modulos.json");
  if (!existsSync(manifesto)) {
    console.error(`✗ falta ${manifesto}: o ${name} leva o repositório ${modulos} (submódulo). Rode \`git submodule update --init produtos/${modulos}\` e tente de novo.`);
    process.exit(1);
  }
  const { parseManifesto } = createRequire(import.meta.url)("../dist/main/modulos/modulos-core.js");
  try { const m = parseManifesto(JSON.parse(readFileSync(manifesto, "utf8"))); console.log(`módulos de ${m.produto}: ${m.modulos.map((x) => `${x.id} ${x.versao}`).join(", ")}`); }
  catch (e) { console.error(`✗ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); }
}
// Client OAuth da Conta Google (config/google-conta-oauth.json, fora do git): sem ele o app sai sem Google. Aviso
// destacado sempre; num release (`--versao`) o build falha, a menos que `--sem-google` permita de propósito.
const googleConta = decideGoogleConta({ admin, existe: existsSync(join("config", "google-conta-oauth.json")), semGoogle: process.argv.includes("--sem-google"), release: versao !== null });
if (googleConta === "falha") { console.error(avisoSemGoogle(name)); console.error("✗ release sem o client OAuth do Google: coloque o arquivo em config/ ou use --sem-google"); process.exit(1); }
if (googleConta === "aviso") console.warn(avisoSemGoogle(name));
if (googleConta === "permitido") console.warn(`⚠ ${name} sai sem Conta Google (--sem-google)`);
// Só a pasta desta variante: empacotar uma não apaga a outra (nem os .dmg em out/).
rmSync(join("out", `${name}-darwin-${arch}`), { recursive: true, force: true });
const paths = await packager({
  dir: ".",
  name,
  out: "out",
  platform: "darwin",
  arch,
  asar: true,
  overwrite: true,
  appBundleId: produto.bundleId,
  icon: produto.icone,
  appCategoryType: "public.app-category.productivity",
  // Textos do aviso do macOS quando um site do Navegador pede câmera/microfone (Google, Meet…): em pt-BR.
  extendInfo: { NSCameraUsageDescription: "O Navegador do meu-bot usa a câmera quando um site pede e você permite (ex.: verificação do Google, videochamadas).", NSMicrophoneUsageDescription: "O Navegador do meu-bot usa o microfone quando um site pede e você permite (ex.: videochamadas, áudio)." },
  ...(versao !== null ? {
    appVersion: versao,
    afterCopy: [async ({ buildPath }) => { const f = join(buildPath, "package.json"); const pkg = JSON.parse(readFileSync(f, "utf8")); pkg.version = versao; writeFileSync(f, `${JSON.stringify(pkg, null, 2)}\n`); }],
  } : {}),
  prune: true,
  // config/ (modelo de hosts ssh) e scripts/alivio/ (script enviado ao pod) vão em Resources/.
  extraResource: ["backend-colima", "config", "scripts/alivio"],
  ignore: [/^\/hermes-agent($|\/)/, /^\/backend-colima($|\/)/, /^\/backend-vm($|\/)/, /^\/docs($|\/)/, /^\/assets($|\/)/, /^\/build($|\/)/, /^\/src($|\/)/, /^\/scripts($|\/)/, /^\/config($|\/)/, /^\/tsconfig/, /^\/\.gitignore$/, /^\/\.gitmodules$/, /^\/out($|\/)/, /^\/extensao-crm($|\/)/, /^\/produtos($|\/)/],
});
for (const p of paths) {
  const res = join(p, `${name}.app`, "Contents", "Resources");
  writeFileSync(join(res, "variant.json"), `${JSON.stringify({ variant: produto.variant })}\n`);
  // Extensões embutidas (meu-bot-crm): Resources/<pasta da extensão>/ (manifest.json, content.js, popup.js, …).
  for (const e of produto.extensoes) cpSync(join("build", e), join(res, e), { recursive: true });
  // Módulos do produto: a pasta do submódulo sem o .git (src/main/modulos/modulos.ts lê Resources/<nome>/).
  if (modulos !== null) cpSync(join("produtos", modulos), join(res, modulos), { recursive: true, filter: (f) => !/(^|\/)\.git(\/|$)/.test(f) && !/(^|\/)node_modules(\/|$)/.test(f) });
  // Client OAuth do Google (Google Contatos → CRM): config/google-oauth.json local, fora do git; sem ele o app só
  // mostra "configure o Google". Vai junto só nos produtos com extensão do Gmail.
  if (produto.extensoes.includes("extensao-crm") && existsSync(join("config", "google-oauth.json"))) copyFileSync(join("config", "google-oauth.json"), join(res, "google-oauth.json"));
  // Client OAuth da "Conta Google" geral (login + Gmail/Agenda/Sheets; projeto próprio, separado do CRM):
  // config/google-conta-oauth.json local, fora do git. Vai nos apps cliente (não no admin); sem ele a página
  // "Conta Google" cai no client do CRM (fallback de clienteConta()).
  if (!admin && existsSync(join("config", "google-conta-oauth.json"))) copyFileSync(join("config", "google-conta-oauth.json"), join(res, "google-conta-oauth.json"));
  // O app de cada admin leva o suporte.json DELE (build/suporte/admins/<nome>.json: nome, superAdmin, caixa; só
  // dados públicos). MEU_BOT_ADMIN_COMO escolhe o admin; sem ele, o super admin. Setup antigo: o suporte.json geral.
  if (admin) {
    const como = process.env.MEU_BOT_ADMIN_COMO ?? "";
    let lista = [];
    try { lista = JSON.parse(readFileSync(join("build", "suporte", "admins.json"), "utf8")); } catch { /* setup antigo */ }
    const quem = como !== "" ? lista.find((a) => a.nome === como) : lista.find((a) => a.super === true);
    if (como !== "" && quem === undefined) throw new Error(`admin "${como}" não está em build/suporte/admins.json (rode scripts/suporte-setup.mjs --admin)`);
    const origem = quem !== undefined ? join("build", "suporte", "admins", `${quem.nome}.json`) : join("build", "suporte", "suporte.json");
    if (existsSync(origem)) copyFileSync(origem, join(res, "config", "suporte.json"));
    if (quem !== undefined) console.log(`meu-bot-admin de ${quem.nome}${quem.super === true ? " (super admin)" : ""}`);
  }
}
console.log("Empacotado em:", paths.join(", "), versao !== null ? `(versão ${versao})` : "");
