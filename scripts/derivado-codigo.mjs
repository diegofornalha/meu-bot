#!/usr/bin/env node
// Código de um app derivado (docs/guia/derivados.md › Página própria): a pasta `codigo/` do repositório dele, com
// `main.ts` (processo principal), `pagina.ts` (janela) e os arquivos da própria pasta que cada um importa. O core
// compila os dois lados com o tsc DELE, direto para dist/main/derivado/ (CommonJS, entrada index.js) e
// dist/renderer/derivado/ (módulos ES, entrada pagina.js), e é de lá que o asar os leva: os fuses do app só deixam
// carregar código de dentro do asar, então não existe plugin solto em tempo de execução.
//
//   node scripts/derivado-codigo.mjs <pasta do derivado>   compila para dist/ (em dev, depois do `npm run build`:
//                                                          MEU_BOT_PRODUTO=<pasta> npm start)
//
// No empacotamento quem chama é o scripts/package.mjs (`--produto <pasta>`). Nada é escrito em src/ nem no
// repositório do derivado: a compilação acontece numa pasta temporária, com um tsconfig gerado lá.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// A pasta do código no repositório do derivado. É a mesma PASTA_DE_CODIGO de scripts/release-core.mjs (a regra do
// commit aprovado); escrita aqui para este arquivo não depender de aquela regra já ter entrado no checkout.
const CODIGO = "codigo";
/** Os dois arquivos de entrada do derivado e o nome com que cada um importa (só `import type`) o contrato do core. */
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
  if (ehLink(dir)) return { erro: `${CODIGO} é um link simbólico: o código do derivado tem de estar no próprio repositório` };
  if (!lstatSync(dir).isDirectory()) return { erro: `${CODIGO} tem de ser uma pasta` };
  // A pasta inteira, subpastas inclusive: um arquivo importado por outro é código do app tanto quanto os dois de entrada.
  const dentro = (d) => {
    for (const nome of readdirSync(d).sort()) {
      const p = join(d, nome);
      if (ehLink(p)) return `${relative(pasta, p)} é um link simbólico: o código do derivado tem de estar no próprio repositório`;
      // Sem dependências próprias: o asar leva só o node_modules do core, e um pacote a mais não passaria por ninguém.
      if (nome === "package.json" || nome === "node_modules") return `${relative(pasta, p)} não é aceito: o código de um derivado não tem dependências npm próprias (o que faltar entra no core)`;
      if (lstatSync(p).isDirectory()) { const e = dentro(p); if (e !== null) return e; }
    }
    return null;
  };
  const recusa = dentro(dir);
  if (recusa !== null) return { erro: recusa };
  for (const l of Object.values(LADOS)) if (!existsSync(join(dir, l.fonte))) return { erro: `falta ${CODIGO}/${l.fonte}` };
  return { tem: true };
}

/**
 * Os módulos que um compilado ES importa (`import … from "x"`, `import "x"`, `export … from "x"`), inclusive quando a
 * declaração vem quebrada em várias linhas. É uma leitura do texto que o tsc emitiu, não uma análise da linguagem (o
 * tsc do core não tem API para isso): entre o `import` e o `from` não passa aspas nem ponto e vírgula, então uma
 * declaração não emenda na seguinte. Um texto de várias linhas que tenha uma linha começando por `import … from "x"`
 * conta como import e recusa a compilação: erra para o lado seguro.
 */
function importsEs(js) {
  const nomes = [];
  for (const m of js.matchAll(/(?:^|[;}\n])\s*(?:import|export)\b[^"'`;]*?\bfrom\s*(["'])([^"'\n]+)\1/g)) nomes.push(m[2]);
  for (const m of js.matchAll(/(?:^|[;}\n])\s*import\s*(["'])([^"'\n]+)\1/g)) nomes.push(m[2]);
  return nomes;
}

/**
 * Para onde aponta um import relativo, a partir da pasta `onde` (o caminho da pasta do arquivo dentro de `codigo/`,
 * com `/`; "" = a própria `codigo/`): o caminho dentro de `codigo/`, ou null quando ele sai dela.
 */
function alvoRelativo(nome, onde) {
  const alvo = posix.normalize(posix.join(onde, nome));
  return alvo === ".." || alvo.startsWith("../") || alvo.startsWith("/") ? null : alvo;
}
const ehRelativo = (nome) => nome === "." || nome === ".." || nome.startsWith("./") || nome.startsWith("../");

/**
 * O que o compilado não pode importar, ou null. O contrato: o código do derivado recebe tudo por argumento, e fora
 * disso só importa arquivos da própria pasta `codigo/` (caminho relativo, sem sair dela). No processo principal entram
 * também os módulos do próprio Node (`node:fs`, `node:child_process`…); na janela, mais nada, e o import relativo
 * termina em `.js`: lá o arquivo é carregado como módulo ES pelo navegador, que não adivinha a extensão. `onde` é a
 * pasta do arquivo dentro de `codigo/` (com `/`; "" = a raiz dela). Os `import type` somem na compilação, então o que
 * sobra aqui é import de verdade. É uma conferência do contrato, não uma caixa de areia: quem aprova o commit do
 * derivado lê o código.
 */
export function importProibido(js, lado, onde = "") {
  if (/\bimport\s*\(/.test(js)) return "import() dinâmico não é aceito";
  if (lado === "main") {
    for (const m of js.matchAll(/\brequire\s*\(\s*(?:(["'])([^"']*)\1\s*\))?/g)) {
      const nome = m[2];
      if (nome === undefined) return "require() só com o nome do módulo escrito por extenso";
      if (nome.startsWith("node:")) continue;
      if (!ehRelativo(nome)) return `import de "${nome}": no processo principal só os módulos do Node, escritos com o prefixo node: (node:fs, node:child_process…), e os arquivos da própria pasta ${CODIGO}/`;
      const alvo = alvoRelativo(nome, onde);
      if (alvo === null) return `import de "${nome}": o código do derivado não sai da pasta ${CODIGO}/`;
      // O main.ts compilado muda de nome (index.js, o que o app carrega): quem o importasse pelo nome antigo não o acharia.
      if (alvo.replace(/\.js$/, "") === LADOS.main.fonte.replace(/\.ts$/, "")) return `import de "${nome}": o ${LADOS.main.fonte} é a entrada, nenhum outro arquivo o importa`;
    }
    return null;
  }
  if (/\brequire\s*\(/.test(js)) return "require() não existe na janela";
  for (const nome of importsEs(js)) {
    if (!ehRelativo(nome)) return `import de "${nome}": a página só importa arquivos da própria pasta ${CODIGO}/ (fora o \`import type\` do contrato)`;
    if (alvoRelativo(nome, onde) === null) return `import de "${nome}": o código do derivado não sai da pasta ${CODIGO}/`;
    if (!nome.endsWith(".js")) return `import de "${nome}": na janela o import relativo termina em .js (escreva "${nome}.js"; o navegador não adivinha a extensão)`;
  }
  return null;
}

/** Os arquivos de `dir` (subpastas inclusive) cujo nome termina em `sufixo`, como caminhos a partir de `dir`. */
function arquivosDe(dir, sufixo, base = dir) {
  const achados = [];
  for (const nome of readdirSync(dir).sort()) {
    const p = join(dir, nome);
    if (lstatSync(p).isDirectory()) achados.push(...arquivosDe(p, sufixo, base));
    else if (nome.endsWith(sufixo)) achados.push(relative(base, p));
  }
  return achados;
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
 * Como: os `.ts` de `codigo/` são COPIADOS para uma pasta temporária e compilados lá, uma vez por lado, com as mesmas
 * opções de rigor do core (tsconfig.base.json). Cada lado parte do seu arquivo de entrada (`main.ts`, `pagina.ts`) e
 * leva junto só o que ele importa: um arquivo usado pelos dois lados é compilado duas vezes, uma em cada formato, e um
 * que ninguém importa não vai para o app. Na pasta temporária não há package.json nem node_modules por perto, então
 * nada do repositório do derivado muda o formato do módulo nem resolve um pacote. O nome do contrato
 * (`meu-bot/extensao-main`, `meu-bot/extensao-pagina`) resolve, por `paths`, para o arquivo de tipos do core. Um
 * arquivo de conferência ao lado amarra o `ativar`/`montar` exportado à assinatura do contrato.
 */
export function compilarCodigo({ pasta, destinos = destinosDoCodigo(), raiz = RAIZ }) {
  const c = conferirCodigo(pasta, true);
  if (c.erro !== undefined) throw new Error(c.erro);
  const fontes = arquivosDe(join(pasta, CODIGO), ".ts");
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "meu-bot-derivado-codigo-")));
  try {
    for (const [lado, l] of Object.entries(LADOS)) {
      const base = join(tmp, lado);
      const copia = join(base, CODIGO);
      for (const f of fontes) { mkdirSync(dirname(join(copia, f)), { recursive: true }); copyFileSync(join(pasta, CODIGO, f), join(copia, f)); }
      const fonte = join(copia, l.fonte);
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
      const compilados = join(saida, relative(raizFontes, copia));
      const entrada = l.fonte.replace(/\.ts$/, ".js");
      if (!existsSync(join(compilados, entrada))) throw new Error(`${CODIGO}/${l.fonte}: o tsc não deixou o compilado onde eu esperava (${join(compilados, entrada)})`);
      // O tsc só emite o que a entrada alcança: é esta a lista do que vai para o app, deste lado.
      const emitidos = arquivosDe(compilados, ".js");
      for (const js of emitidos) {
        const rel = js.split(sep).join("/");
        const proibido = importProibido(readFileSync(join(compilados, js), "utf8"), lado, posix.dirname(rel) === "." ? "" : posix.dirname(rel));
        if (proibido !== null) throw new Error(`${CODIGO}/${rel.replace(/\.js$/, ".ts")}: ${proibido}`);
      }
      // A entrada sai com o nome que o app carrega (`saida`); um arquivo do derivado com esse nome ficaria por baixo dela.
      if (entrada !== l.saida && emitidos.includes(l.saida)) throw new Error(`${CODIGO}/${l.saida.replace(/\.js$/, ".ts")}: este nome é o do ${l.fonte} compilado (${l.saida}); dê outro nome ao arquivo`);
      rmSync(destinos[lado], { recursive: true, force: true });
      for (const js of emitidos) {
        const destino = join(destinos[lado], js === entrada ? l.saida : js);
        mkdirSync(dirname(destino), { recursive: true });
        copyFileSync(join(compilados, js), destino);
      }
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
