// Tabela de produtos para os scripts de empacotamento (package, fuses, dmg, release, icons). A fonte é
// src/main/app/variant-core.ts (PRODUTOS); aqui só se lê o compilado em dist/ — por isso rode `npm run build:main`
// antes. `--variant <id>` escolhe o produto; `--admin` continua valendo como alias de `--variant admin`.
// `--produto <pasta>` empacota um app derivado, com a ficha do repositório dele (docs/guia/derivados.md).
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST = new URL("../dist/main/app/variant-core.js", import.meta.url);
if (!existsSync(DIST)) { console.error("✗ falta dist/main/app/variant-core.js: rode `npm run build:main` antes"); process.exit(1); }
const { PRODUTOS, esquemaDe, parseFichaExterna, FICHA_EMBUTIDA } = createRequire(import.meta.url)("../dist/main/app/variant-core.js");
export { PRODUTOS, esquemaDe, FICHA_EMBUTIDA };

/**
 * `--produto <pasta>`: um app derivado, cuja ficha (`produto.json`) e ícone (`assets/icon.icns`) moram no repositório
 * dele, fora deste. Devolve o Produto com o ícone em caminho absoluto, a `ficha` crua (o package.mjs a embute no
 * asar) e a `pasta`; null sem a opção. Ficha ilegível ou recusada sai com 64 dizendo o motivo.
 */
export function derivadoFromArgv(argv = process.argv) {
  const i = argv.indexOf("--produto");
  if (i < 0) return null;
  const pasta = resolve(argv[i + 1] ?? "");
  const arquivo = join(pasta, "produto.json");
  let ficha;
  try { ficha = JSON.parse(readFileSync(arquivo, "utf8")); } catch (e) { console.error(`✗ não li a ficha do derivado em ${arquivo}: ${e instanceof Error ? e.message : String(e)}`); process.exit(64); }
  const r = parseFichaExterna(ficha);
  if (!r.ok) { console.error(`✗ ficha recusada (${arquivo}): ${r.erro}`); process.exit(64); }
  const icone = join(pasta, r.produto.icone);
  if (!existsSync(icone)) { console.error(`✗ falta o ícone do derivado: ${icone}`); process.exit(64); }
  return { ...r.produto, icone, ficha, pasta };
}
/** Os argumentos que levam o mesmo produto a outro script (package, fuses): `--produto <pasta>` ou `--variant <id>`. */
export const alvoDe = (p) => (p.variant === "derivado" ? ["--produto", p.pasta] : ["--variant", p.variant]);

/** Produto pedido na linha de comando; desconhecido sai com 64 listando os ids. */
export function produtoFromArgv(argv = process.argv) {
  const derivado = derivadoFromArgv(argv);
  if (derivado !== null) return derivado;
  const i = argv.indexOf("--variant");
  const id = i >= 0 ? argv[i + 1] : argv.includes("--admin") ? "admin" : "client";
  const p = PRODUTOS.find((x) => x.variant === id);
  if (p === undefined) { console.error(`✗ produto desconhecido "${id}". Opções: ${PRODUTOS.map((x) => x.variant).join(", ")}`); process.exit(64); }
  return p;
}
export const archOf = () => (process.arch === "arm64" ? "arm64" : "x64");
/** `--plataforma win32` empacota para Windows a partir deste Mac; sem ela, macOS. */
export function plataformaFromArgv(argv = process.argv) {
  const i = argv.indexOf("--plataforma");
  const p = i >= 0 ? argv[i + 1] : "darwin";
  if (p !== "darwin" && p !== "win32") { console.error(`✗ plataforma desconhecida "${p}". Opções: darwin, win32`); process.exit(64); }
  return p;
}
/** Arquitetura do pacote: no Windows sempre x64 (roda também nos ARM, emulado); no macOS, a deste Mac. */
export const archDe = (plataforma) => (plataforma === "win32" ? "x64" : archOf());
/**
 * Onde o @electron/packager deixa o produto: `pasta` (a de saída), `app` (o que os fuses e a assinatura recebem: o
 * .app no macOS, o .exe no Windows) e `recursos` (variant.json, config/, extensões).
 */
export function empacotado(p, plataforma) {
  const pasta = join("out", `${p.nome}-${plataforma}-${archDe(plataforma)}`);
  if (plataforma === "win32") return { pasta, app: join(pasta, `${p.nome}.exe`), recursos: join(pasta, "resources") };
  const app = join(pasta, `${p.nome}.app`);
  return { pasta, app, recursos: join(app, "Contents", "Resources") };
}
/** Produto pedido para Windows sem estar marcado `windows` na tabela sai com 64: falta ícone .ico e prova na tela. */
export function exigeWindows(p, plataforma) {
  if (plataforma !== "win32" || p.windows) return;
  console.error(`✗ ${p.nome} não sai para Windows (campo \`windows\` em src/main/app/variant-core.ts). Saem: ${PRODUTOS.filter((x) => x.windows).map((x) => x.variant).join(", ")}`);
  process.exit(64);
}
/** `--versao <x>` (o release staging passa "0.2.0-staging.3"); sem ela, a do package.json. */
export function versaoFromArgv(argv = process.argv) {
  const i = argv.indexOf("--versao");
  if (i < 0) return null;
  const v = argv[i + 1] ?? "";
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v)) { console.error(`✗ versão inválida "${v}" (ex.: 0.2.0 ou 0.2.0-staging.3)`); process.exit(64); }
  return v;
}
/** Ícone .svg de origem do produto (mesmo nome do .icns). */
export const svgOf = (p) => p.icone.replace(/\.icns$/, ".svg");
/** Ícone .ico do produto no Windows (mesmo nome do .icns). */
export const icoOf = (p) => p.icone.replace(/\.icns$/, ".ico");
