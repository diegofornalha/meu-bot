// Gera o .icns de cada produto a partir do .svg (scripts/icon.mjs) e, dos que saem para Windows, também o .ico.
// Uso: `npm run icons` (depois de build:main).
import { execFileSync } from "node:child_process";
import { PRODUTOS, icoOf, svgOf } from "./produtos.mjs";
for (const p of PRODUTOS) {
  console.log(`▸ ${p.nome}: ${svgOf(p)} → ${p.icone}${p.windows ? ` e ${icoOf(p)}` : ""}`);
  execFileSync("node", ["scripts/icon.mjs", svgOf(p), p.icone, ...(p.windows ? [icoOf(p)] : [])], { stdio: "inherit" });
}
