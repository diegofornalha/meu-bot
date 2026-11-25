#!/usr/bin/env node
// Código de um app derivado (docs/guia/derivados.md › Página própria): a pasta `codigo/` do repositório dele, com
// `main.ts` (processo principal) e `pagina.ts` (janela). O core compila os dois com o tsc DELE, direto para
// dist/main/derivado/index.js (CommonJS) e dist/renderer/derivado/pagina.js (módulo ES), e é de lá que o asar os leva:
// os fuses do app só deixam carregar código de dentro do asar, então não existe plugin solto em tempo de execução.
//
//   node scripts/derivado-codigo.mjs <pasta do derivado>   compila para dist/ (em dev, depois do `npm run build`:
//                                                          MEU_BOT_PRODUTO=<pasta> npm start)
//
// No empacotamento quem chama é o scripts/package.mjs (`--produto <pasta>`). Nada é escrito em src/ nem no
// repositório do derivado: a compilação acontece numa pasta temporária, com um tsconfig gerado lá.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// A pasta do código no repositório do derivado. É a mesma PASTA_DE_CODIGO de scripts/release-core.mjs (a regra do
// commit aprovado); escrita aqui para este arquivo não depender de aquela regra já ter entrado no checkout.
const CODIGO = "codigo";
/** Os dois arquivos do derivado e o nome com que cada um importa (só `import type`) o contrato do core. */
export const LADOS = {
  main: { fonte: "main.ts", alias: "meu-bot/extensao-main", contrato: join("src", "shared", "ipc", "derivado.ts"), exporta: "ativar", tipo: "AtivarExtensao", saida: "index.js" },
  renderer: { fonte: "pagina.ts", alias: "meu-bot/extensao-pagina", contrato: join("src", "renderer", "extensao", "api.ts"), exporta: "montar", tipo: "MontarExtensao", saida: "pagina.js" },
};

/** Onde o código compilado de um derivado fica em dist/ (e, dali, no asar): uma pasta por lado, só dele. */
export const destinosDoCodigo = (dist = join(RAIZ, "dist")) => ({ main: join(dist, "main", "derivado"), renderer: join(dist, "renderer", "derivado") });

/**
 * Tira de dist/ o código de derivado. O package.mjs chama antes de empacotar QUALQUER app e de novo ao sair: o asar
 * leva dist/ inteiro, e o código de um derivado empacotado antes não pode ir no pacote de outro app.
 */
export function limparCodigo(dist = join(RAIZ, "dist")) {
  for (const d of Object.values(destinosDoCodigo(dist))) rmSync(d, { recursive: true, force: true });
}

const ehLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

/**
 * A pasta `codigo/` bate com a ficha? Devolve `{ tem }` (true = há código a compilar) ou `{ erro }` com o motivo.
 * `temExtensao` = a ficha tem o campo `extensao`. Um sem o outro é recusa: página anunciada sem código não abre, e
 * código sem página anunciada iria assinado no app sem ninguém ter pedido.
 */
export function conferirCodigo(pasta, temExtensao) {
  const dir = join(pasta, CODIGO);
  if (!existsSync(dir) && !ehLink(dir)) return temExtensao ? { erro: `a ficha tem "extensao", mas falta a pasta ${CODIGO}/ (com ${LADOS.main.fonte} e ${LADOS.renderer.fonte})` } : { tem: false };
  if (!temExtensao) return { erro: `há uma pasta ${CODIGO}/, mas a ficha não tem "extensao": tire a pasta ou declare a página na ficha` };
  // Link simbólico apontaria para fora do repositório: o que se compila tem de ser o que está no commit.
  for (const p of [dir, ...Object.values(LADOS).map((l) => join(dir, l.fonte))]) if (ehLink(p)) return { erro: `${relative(pasta, p)} é um link simbólico: o código do derivado tem de estar no próprio repositório` };
  if (!lstatSync(dir).isDirectory()) return { erro: `${CODIGO} tem de ser uma pasta` };
  // Sem dependências próprias: o asar leva só o node_modules do core, e um pacote a mais não passaria por ninguém.
  for (const proibido of ["package.json", "node_modules"]) if (existsSync(join(dir, proibido)) || ehLink(join(dir, proibido))) return { erro: `${CODIGO}/${proibido} não é aceito: o código de um derivado não tem dependências npm próprias (o que faltar entra no core)` };
  for (const l of Object.values(LADOS)) if (!existsSync(join(dir, l.fonte))) return { erro: `falta ${CODIGO}/${l.fonte}` };
  return { tem: true };
}

/**
 * O que o compilado não pode importar, ou null. O contrato: o código do derivado recebe tudo por argumento. No
 * processo principal só entram os módulos do próprio Node (`node:fs`, `node:child_process`…); na janela, nada. Os
 * `import type` somem na compilação, então o que sobra aqui é import de verdade. É uma conferência do contrato, não
 * uma caixa de areia: quem aprova o commit do derivado lê o código.
 */
export function importProibido(js, lado) {
  if (/\bimport\s*\(/.test(js)) return "import() dinâmico não é aceito";
  if (lado === "main") {
    for (const m of js.matchAll(/\brequire\s*\(\s*(?:(["'])([^"']*)\1\s*\))?/g)) {
      if (m[2] === undefined) return "require() só com o nome do módulo escrito por extenso";
      if (!m[2].startsWith("node:")) return `import de "${m[2]}": no processo principal só os módulos do Node, escritos com o prefixo node: (node:fs, node:child_process…)`;
    }
    return null;
  }
  const m = /^\s*(?:import|export)\b[^;\n]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/m.exec(js);
  if (m !== null) return `import de "${m[1] ?? m[2]}": a página não importa módulo nenhum (só \`import type\` do contrato)`;
  if (/\brequire\s*\(/.test(js)) return "require() não existe na janela";
  return null;
}

/** Roda o tsc do core com o tsconfig dado, de dentro da pasta dele (os erros saem com o caminho a partir dela); devolve a saída quando falha, null quando passa. */
function tsc(raiz, projeto) {
  const r = spawnSync(join(raiz, "node_modules", ".bin", "tsc"), ["-p", projeto], { cwd: dirname(projeto), encoding: "utf8", shell: process.platform === "win32" });
  if (r.status === 0) return null;
  return `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? r.error.message : ""}`.trim() || `tsc saiu com ${r.status}`;
}

/**
 * Compila o código do derivado em `pasta` para `destinos` ({ main, renderer }; o padrão é dist/ deste checkout).
 * Lança um Error com o motivo (erro de tipo, import fora do contrato, `ativar`/`montar` com outra assinatura).
 *
 * Como: os dois arquivos são COPIADOS para uma pasta temporária e compilados lá, um por lado, com as mesmas opções de
 * rigor do core (tsconfig.base.json). Lá não há package.json nem node_modules por perto, então nada do repositório do
 * derivado muda o formato do módulo nem resolve um pacote. O nome do contrato (`meu-bot/extensao-main`,
 * `meu-bot/extensao-pagina`) resolve, por `paths`, para o arquivo de tipos do core. Um arquivo de conferência ao lado
 * amarra o `ativar`/`montar` exportado à assinatura do contrato.
 */
export function compilarCodigo({ pasta, destinos = destinosDoCodigo(), raiz = RAIZ }) {
  const c = conferirCodigo(pasta, true);
  if (c.erro !== undefined) throw new Error(c.erro);
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "meu-bot-derivado-codigo-")));
  try {
    for (const [lado, l] of Object.entries(LADOS)) {
      const base = join(tmp, lado);
      const fonte = join(base, CODIGO, l.fonte);
      mkdirSync(dirname(fonte), { recursive: true });
      copyFileSync(join(pasta, CODIGO, l.fonte), fonte);
      const conferencia = join(base, "conferir.ts");
      writeFileSync(conferencia, `import type { ${l.tipo} } from "${l.alias}";\nimport { ${l.exporta} } from "./${CODIGO}/${l.fonte.replace(/\.ts$/, lado === "main" ? "" : ".js")}";\nexport const conferido: ${l.tipo} = ${l.exporta};\n`);
      // O contrato é um .ts do core, fora da pasta temporária: a raiz dos fontes tem de cobrir os dois, e o compilado
      // do derivado sai em <saida>/<caminho da cópia desde a raiz>. Só ele é levado; o resto fica na pasta temporária.
      const raizFontes = parse(tmp).root;
      const saida = join(base, "saida");
      const opcoes = lado === "main"
        ? { module: "nodenext", moduleResolution: "nodenext", lib: ["ES2022"], types: ["node"], typeRoots: [join(raiz, "node_modules", "@types")] }
        : { module: "ES2022", moduleResolution: "bundler", lib: ["ES2022", "DOM", "DOM.Iterable"], types: [], verbatimModuleSyntax: true };
      const projeto = join(base, "tsconfig.json");
      writeFileSync(projeto, JSON.stringify({
        extends: join(raiz, "tsconfig.base.json"),
        compilerOptions: { ...opcoes, rootDir: raizFontes, outDir: saida, sourceMap: false, noEmitOnError: true, paths: { [l.alias]: [join(raiz, l.contrato)] } },
        files: [fonte, conferencia],
      }, null, 2));
      const falha = tsc(raiz, projeto);
      if (falha !== null) throw new Error(`${CODIGO}/${l.fonte} não compila:\n${falha}`);
      const js = join(saida, relative(raizFontes, fonte)).replace(/\.ts$/, ".js");
      if (!existsSync(js)) throw new Error(`${CODIGO}/${l.fonte}: o tsc não deixou o compilado onde eu esperava (${js})`);
      const proibido = importProibido(readFileSync(js, "utf8"), lado);
      if (proibido !== null) throw new Error(`${CODIGO}/${l.fonte}: ${proibido}`);
      rmSync(destinos[lado], { recursive: true, force: true });
      mkdirSync(destinos[lado], { recursive: true });
      copyFileSync(js, join(destinos[lado], l.saida));
    }
  } catch (e) {
    // Metade compilada não fica para trás: ou os dois lados, ou nenhum.
    for (const d of Object.values(destinos)) rmSync(d, { recursive: true, force: true });
    throw e;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return destinos;
}

// Linha de comando (dev): compila o código do derivado para o dist/ deste checkout.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dita = process.argv[2];
  if (dita === undefined || dita === "" || dita.startsWith("--")) { console.error("uso: node scripts/derivado-codigo.mjs <pasta do repositório do derivado>"); process.exit(64); }
  if (!existsSync(join(RAIZ, "dist", "main"))) { console.error("✗ falta dist/: rode `npm run build` antes (ele apaga dist/, então o código do derivado é compilado depois)"); process.exit(1); }
  try { const d = compilarCodigo({ pasta: resolve(dita) }); console.log(`✓ código do derivado em ${relative(RAIZ, d.main)} e ${relative(RAIZ, d.renderer)}`); } catch (e) { console.error(`✗ ${e instanceof Error ? e.message : String(e)}`); process.exit(64); }
}
