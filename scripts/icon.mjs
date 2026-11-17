// Gera o .icns a partir do SVG (o caminho que antes era feito à mão): qlmanage → PNG 1024 → sips nos 10
// tamanhos do iconset → iconutil. Com um terceiro argumento, gera também o .ico do Windows dos mesmos PNGs.
// Uso: node scripts/icon.mjs assets/icon.svg assets/icon.icns [assets/icon.ico]
// Só ferramentas do macOS; a pasta de trabalho é temporária.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

/** Tamanhos que o Windows pede (barra de tarefas, Explorer, atalhos); 256 é o maior que o formato .ico aceita. */
const TAMANHOS_ICO = [16, 24, 32, 48, 64, 128, 256];

/** Um .ico com um PNG por tamanho: cabeçalho de 6 bytes, uma entrada de 16 bytes por imagem e os PNGs em seguida. */
export function montarIco(imagens) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(1, 2); // tipo 1 = ícone
  cabecalho.writeUInt16LE(imagens.length, 4);
  let offset = 6 + 16 * imagens.length;
  const entradas = imagens.map(({ tamanho, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(tamanho === 256 ? 0 : tamanho, 0); // largura (0 = 256)
    e.writeUInt8(tamanho === 256 ? 0 : tamanho, 1); // altura
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([cabecalho, ...entradas, ...imagens.map((i) => i.png)]);
}

if (import.meta.filename === resolve(process.argv[1] ?? "")) {
  const [svg, icns, ico] = process.argv.slice(2).map((p) => resolve(p));
  if (!svg || !icns) { console.error("uso: node scripts/icon.mjs <entrada.svg> <saida.icns> [saida.ico]"); process.exit(64); }
  const work = mkdtempSync(join(tmpdir(), "meu-bot-icon-"));
  try {
    execFileSync("qlmanage", ["-t", "-s", "1024", "-o", work, svg], { stdio: "ignore" });
    const png = join(work, `${basename(svg)}.png`);
    const set = join(work, "icon.iconset");
    mkdirSync(set);
    const reduzir = (tamanho, destino) => execFileSync("sips", ["-z", String(tamanho), String(tamanho), png, "--out", destino], { stdio: "ignore" });
    for (const size of [16, 32, 128, 256, 512]) {
      reduzir(size, join(set, `icon_${size}x${size}.png`));
      reduzir(size * 2, join(set, `icon_${size}x${size}@2x.png`));
    }
    execFileSync("iconutil", ["-c", "icns", set, "-o", icns]);
    console.log(`✓ ${icns}`);
    if (ico) {
      const imagens = TAMANHOS_ICO.map((tamanho) => { const f = join(work, `ico-${tamanho}.png`); reduzir(tamanho, f); return { tamanho, png: readFileSync(f) }; });
      writeFileSync(ico, montarIco(imagens));
      console.log(`✓ ${ico}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
