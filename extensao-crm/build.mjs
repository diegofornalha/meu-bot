// Build das extensões embutidas do meu-bot-crm (esbuild), cada uma na pasta que o app usa em dev e que o
// package.mjs copia para Resources/: ../build/extensao-crm/ (Gmail: content.ts e background.ts em IIFE, mais o
// pageWorld.js do InboxSDK pré-compilado e static/) e ../build/extensao-autenticador/ (popup.ts e
// static-autenticador/). A versão dos manifestos acompanha o package.json. `--watch` recompila ao salvar e NUNCA apaga config.json (o app grava
// lá a porta e o token do proxy antes de carregar a extensão).
import { build, context } from "esbuild";
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, não `.pathname`: no Windows (workflow "Windows") o pathname é "/D:/a/…", que não é um caminho.
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "build", "extensao-crm");
const distAut = join(here, "..", "build", "extensao-autenticador");
const watch = process.argv.includes("--watch");
const dev = watch || process.argv.includes("--dev");
mkdirSync(dist, { recursive: true });
mkdirSync(distAut, { recursive: true });
const require = createRequire(import.meta.url);
const sdkDir = dirname(require.resolve("@inboxsdk/core/package.json"));

function copiarManifesto(origem, destino) {
  const manifest = JSON.parse(readFileSync(join(origem, "manifest.json"), "utf8"));
  manifest.version = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version;
  writeFileSync(join(destino, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
function copiarEstaticos() {
  cpSync(join(here, "static"), dist, { recursive: true });
  for (const f of ["pageWorld.js", "pageWorld.js.map"]) if (existsSync(join(sdkDir, f))) copyFileSync(join(sdkDir, f), join(dist, f));
  copiarManifesto(join(here, "static"), dist);
  cpSync(join(here, "static-autenticador"), distAut, { recursive: true });
  copiarManifesto(join(here, "static-autenticador"), distAut);
}
const comum = {
  bundle: true, format: "iife", target: "es2022", sourcemap: true, minify: !dev, logLevel: "info", legalComments: "none",
  define: { "process.env.NODE_ENV": dev ? '"development"' : '"production"' },
};
const builds = [
  { ...comum, entryPoints: { content: join(here, "src/content.ts"), background: join(here, "src/background.ts") }, outdir: dist },
  { ...comum, entryPoints: { popup: join(here, "src/autenticador/popup.ts") }, outdir: distAut },
];
copiarEstaticos();
if (watch) {
  for (const b of builds) await (await context(b)).watch();
  const { watch: fsWatch } = await import("node:fs");
  for (const pasta of ["static", "static-autenticador"]) fsWatch(join(here, pasta), { recursive: true }, () => { try { copiarEstaticos(); console.log(`${pasta}/ copiado`); } catch (e) { console.error(e); } });
  console.log("▸ extensões em modo watch (build/)");
} else {
  for (const b of builds) await build(b);
  console.log(`✓ extensões em ${dist} e ${distAut}`);
}
