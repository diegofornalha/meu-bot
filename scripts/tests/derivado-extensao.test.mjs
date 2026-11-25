// Página própria de um app derivado (a "extensão", docs/guia/derivados.md): a ficha, a compilação do código do
// derivado pelo core, o canal IPC único e as regras do <webview>. A prova é o derivado de exemplo em
// fixtures/derivado-exemplo: ficha, ícone e o código (os dois arquivos de entrada e um que os dois importam),
// compilados aqui para uma pasta temporária.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const req = createRequire(import.meta.url);
const { parseFichaExterna, fichaEmbutida, registrarDerivado, capsFor, DERIVADO_API, PAGINAS_INICIAIS, PRODUTOS } = req("../../dist/main/app/variant-core.js");
const { NOME_DE_CANAL_RE, PARTICAO_DE_EXTENSAO_RE, ERRO_SEM_EXTENSAO, ERRO_EXTENSAO_NAO_CARREGOU, encerrarDoRetorno, criarRegistro, despacharExtInvoke, navegacaoDeExtensaoPermitida, urlDeExtensaoPermitida, ativarDoModulo } = req("../../dist/main/extensao/extensao-core.js");
const { CLIENT_CHANNELS, SHARED_CHANNELS, ADMIN_CHANNELS } = req("../../dist/main/ipc/ipc-policy.js");
const { PAGINAS_APP } = req("../../dist/main/controle-remoto/controle-remoto-core.js");
const { ABAS_FIXAVEIS } = req("../../dist/main/app/settings-normalize.js");
const { compilarCodigo, conferirCodigo, destinosDoCodigo, importProibido, limparCodigo, LADOS } = await import("../derivado-codigo.mjs");
const { derivadoFromArgv } = await import("../produtos.mjs");

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/derivado-exemplo", import.meta.url));
const FICHA = JSON.parse(readFileSync(join(FIXTURE, "produto.json"), "utf8"));
/** O que a ficha de exemplo vira em `caps.extensao`: o rótulo, o ícone e a dica do botão. */
const EXT = { rotulo: "Exemplo", icone: "🧪", dica: "Exemplo: a página própria do derivado de teste do core" };
const erro = (f) => { const r = parseFichaExterna(f); assert.equal(r.ok, false, JSON.stringify(f)); return r.erro; };
const temp = (prefixo) => mkdtempSync(join(tmpdir(), prefixo));
/** Uma cópia da fixture para estragar à vontade. */
function copia(mexer = () => {}) { const d = temp("meu-bot-ext-fixture-"); cpSync(FIXTURE, d, { recursive: true }); mexer(d); return d; }
const lanca = async (f, frase) => { await assert.rejects(f, (e) => { assert.match(e.message, frase); return true; }); };

test("ficha: `extensao` válida vira caps.extensao com o rótulo, o ícone e a dica; sem o campo, null (como em todo app da tabela)", () => {
  assert.equal(DERIVADO_API, 1);
  const r = parseFichaExterna(FICHA);
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(r.produto.caps.extensao, EXT);
  assert.deepEqual(FICHA.extensao, { api: 1, ...EXT });
  // Ícone e dica são opcionais: sem eles (ou com null) o botão fica com o ✦ e a dica é o próprio rótulo.
  for (const e of [{ api: 1, rotulo: "Exemplo" }, { api: 1, rotulo: "Exemplo", icone: null, dica: null }]) assert.deepEqual(parseFichaExterna({ ...FICHA, extensao: e }).produto.caps.extensao, { rotulo: "Exemplo", icone: null, dica: null });
  assert.equal(r.produto.abreEm, "extensao");
  assert.deepEqual([r.produto.nome, r.produto.portaLocal, r.produto.portaWsl, r.produto.portaMcp], ["meu-bot-exemplo-staging", 8840, 2340, 7840]);
  try {
    registrarDerivado(fichaEmbutida(FICHA));
    const c = capsFor("derivado", "1.2.3-staging.4", "darwin");
    assert.deepEqual([c.extensao, c.abreEm, c.inspector], [EXT, "extensao", false]);
    // Fora o que a ficha escolhe, é um meu-bot-staging: a página própria não muda nenhuma outra capacidade.
    const base = capsFor("client-staging", "1.2.3-staging.4", "darwin");
    for (const k of Object.keys(base)) if (!["variant", "nome", "titulo", "abreEm", "extensao"].includes(k)) assert.deepEqual(c[k], base[k], k);
  } finally { registrarDerivado(null); }
  const { extensao: _e, abreEm: _a, ...semExtensao } = FICHA;
  for (const f of [semExtensao, { ...semExtensao, extensao: null }]) assert.equal(parseFichaExterna(f).produto.caps.extensao, null);
  // Nenhum app da tabela tem página de extensão, em nenhuma plataforma.
  for (const p of PRODUTOS) for (const plataforma of ["darwin", "win32"]) assert.equal(capsFor(p.variant, "1.0.0", plataforma).extensao, null, p.nome);
  assert.ok(PAGINAS_INICIAIS.includes("extensao"));
});

test("ficha: api de outra versão, rótulo, ícone ou dica inválidos, campo a mais e `abreEm: extensao` sem extensão são recusados, dizendo o motivo", () => {
  assert.match(erro({ ...FICHA, extensao: { api: 2, rotulo: "Exemplo" } }), /^extensao\.api: este core fala a API 1 de extensão; a ficha pede 2$/);
  for (const api of ["1", 0, undefined, null, 1.5, {}]) assert.match(erro({ ...FICHA, extensao: { api, rotulo: "Exemplo" } }), /^extensao\.api: este core fala a API 1 de extensão; a ficha pede /, String(api));
  for (const rotulo of ["", "x".repeat(31), "duas\nlinhas", " com espaço na ponta", "tab\taqui", 7, undefined, null]) assert.match(erro({ ...FICHA, extensao: { api: 1, rotulo } }), /^extensao\.rotulo:/, JSON.stringify(rotulo));
  assert.equal(parseFichaExterna({ ...FICHA, extensao: { api: 1, rotulo: "x".repeat(30) } }).ok, true, "30 caracteres cabem");
  assert.match(erro({ ...FICHA, extensao: { api: 1, rotulo: "Exemplo", preload: "x.js" } }), /^extensao: campo desconhecido "preload" \(aceitos: api, rotulo, icone, dica\)$/);
  // Ícone: um emoji ou símbolo curto. É texto em toda parte, mas o que tentaria sair do botão (HTML) ou da cadeia de
  // CSS da aba (aspas, barra invertida) nem entra; espaço e quebra de linha também não.
  const com = (extra) => parseFichaExterna({ ...FICHA, extensao: { api: 1, rotulo: "Exemplo", ...extra } });
  for (const icone of ["🔎", "✦", "G", ">_".replace(">", "»"), "🧑‍💻", "🇧🇷", "1️⃣", "x".repeat(8)]) assert.deepEqual(com({ icone }).produto?.caps.extensao.icone, icone, icone);
  for (const icone of ["", "x".repeat(9), "<b>", "a>", '"', "'", "`", "\\", "a b", " ", "a\nb", "\t", "\u0000", "\u007f", 7, true, {}, []]) assert.match(erro({ ...FICHA, extensao: { api: 1, rotulo: "Exemplo", icone } }), /^extensao\.icone: null ou um emoji ou símbolo/, JSON.stringify(icone));
  // Dica: o `title` do botão, uma linha de até 160 caracteres.
  assert.equal(com({ dica: "x".repeat(160) }).ok, true, "160 caracteres cabem");
  assert.equal(com({ dica: 'Com "aspas" e <sinais>: é texto de um atributo, posto por propriedade' }).ok, true);
  for (const dica of ["", "x".repeat(161), "duas\nlinhas", " ponta", "ponta ", "tab\taqui", 7, true, {}]) assert.match(erro({ ...FICHA, extensao: { api: 1, rotulo: "Exemplo", dica } }), /^extensao\.dica: null ou a dica do botão, de 1 a 160 caracteres, numa linha só$/, JSON.stringify(dica));
  for (const ruim of ["sim", true, 1, []]) assert.match(erro({ ...FICHA, extensao: ruim }), /^extensao: null ou um objeto/);
  const { extensao: _e, ...semExtensao } = FICHA;
  assert.match(erro(semExtensao), /^abreEm: "extensao" só vale numa ficha que tem o campo extensao$/);
  assert.equal(fichaEmbutida({ ...FICHA, extensao: { api: 2, rotulo: "Exemplo" } }), null, "pacote com ficha de outra API não abre como derivado");
});

test("a página `extensao` está em toda lista de páginas, e o canal `ext:invoke` em uma lista só, a do app da pessoa", () => {
  assert.ok(PAGINAS_APP.includes("extensao"));
  assert.ok(ABAS_FIXAVEIS.includes("extensao"));
  assert.equal(CLIENT_CHANNELS.filter((c) => c === "ext:invoke").length, 1);
  assert.equal([...SHARED_CHANNELS, ...ADMIN_CHANNELS].includes("ext:invoke"), false);
  const ler = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
  assert.match(ler("src", "preload", "preload.ts"), /extInvocar: \(nome: string, payload: unknown\) => ipcRenderer\.invoke\("ext:invoke", \{ nome, payload \}\)/);
  // O botão da lateral nasce escondido, sem texto, sem dica e com o ✦: o rótulo, a dica e o ícone vêm da ficha
  // (caps.extensao), pelo renderer.
  assert.match(ler("src", "renderer", "index.html"), /<button type="button" id="extensao-line" class="wa-line acervo-line" hidden><span id="extensao-icone" class="acervo-icon">✦<\/span><span id="extensao-rotulo" class="grow"><\/span>/);
  const renderer = ler("src", "renderer", "renderer.ts");
  for (const trecho of ['pagina === "extensao"', 'fixa === "extensao"', "caps.extensao !== null", "caps.extensao.rotulo", "linha.title = caps.extensao.dica ?? caps.extensao.rotulo", '$<HTMLElement>("extensao-icone").textContent = caps.extensao.icone', 'style.setProperty("--extensao-icone", JSON.stringify(`${caps.extensao.icone} `))']) assert.ok(renderer.includes(trecho), `renderer.ts sem ${trecho}`);
  // Nada da ficha vira HTML: o valor entra por textContent, por propriedade e por uma variável de CSS.
  for (const linha of renderer.split("\n")) if (linha.includes("caps.extensao")) assert.doesNotMatch(linha, /innerHTML|insertAdjacentHTML|setAttribute\("style"/, linha.trim());
  // A aba leva o mesmo glifo do botão: o da ficha, ou o ✦.
  assert.ok(ler("src", "renderer", "style.css").includes('.tab-page.tab-extensao .tab-title::before { content: var(--extensao-icone, "✦ "); }'));
  // O servidor MCP de fora (scripts/app-mcp.mjs) escreve a lista à mão: tem de oferecer as mesmas páginas do app.
  const enumMcp = /name: 'pagina_abrir'.*?enum: \[([^\]]+)\]/.exec(ler("scripts", "app-mcp.mjs"));
  assert.deepEqual(enumMcp[1].split(",").map((s) => s.trim().replace(/'/g, "")), [...PAGINAS_APP]);
});

test("registro da extensão: nome de canal e partição do <webview> têm formato fechado, uma vez só, e só durante o ativar", () => {
  for (const ok of ["eco", "a", "abrir-pagina", "x1", `a${"b".repeat(40)}`]) assert.match(ok, NOME_DE_CANAL_RE);
  for (const nao of ["", "Eco", "1eco", "-eco", "eco:abrir", "eco/abrir", "eco abrir", "__proto__", "inspector:abrir", `a${"b".repeat(41)}`]) assert.doesNotMatch(nao, NOME_DE_CANAL_RE);
  const r = criarRegistro();
  r.canal("eco", async (p) => p);
  assert.throws(() => r.canal("eco", async () => 1), /registrado duas vezes/);
  for (const nao of ["Eco", "", "chat:send", 7, undefined]) assert.throws(() => r.canal(nao, async () => 1), /nome de canal inválido/);
  assert.throws(() => r.canal("sem-handler"), /falta o handler/);
  assert.deepEqual(r.nomes(), ["eco"]);
  assert.equal(r.handler("constructor"), undefined, "nada herdado vira canal");
  assert.equal(r.handler("toString"), undefined);

  // Partição: sempre `ext-…`, nunca uma do core (Navegador, Computador, módulos, Inspector) nem persistente.
  for (const ok of ["ext-exemplo", "ext-inspector", "ext-a1"]) assert.match(ok, PARTICAO_DE_EXTENSAO_RE);
  for (const nao of ["inspector", "persist:navegador-local", "persist:ext-x", "computador-local", "modulo-x", "ext-", "ext-A", "ext-a b", "", `ext-${"a".repeat(41)}`]) {
    assert.doesNotMatch(nao, PARTICAO_DE_EXTENSAO_RE);
    assert.throws(() => criarRegistro().webview({ particao: nao, urlPermitida: () => true }), /partição de <webview> inválida/, nao);
  }
  assert.equal(r.webviewDeclarado(), null);
  assert.throws(() => r.webview({ particao: "ext-exemplo" }), /falta urlPermitida/);
  r.webview({ particao: "ext-exemplo", urlPermitida: (u) => u.startsWith("http://127.0.0.1:5000/") });
  assert.throws(() => r.webview({ particao: "ext-outra", urlPermitida: () => true }), /um <webview> só/);
  assert.equal(r.webviewDeclarado().particao, "ext-exemplo");
  assert.equal(r.webviewDeclarado().urlPermitida("http://127.0.0.1:5000/"), true);
  assert.equal(r.webviewDeclarado().urlPermitida("http://127.0.0.1:5001/"), false);

  r.fechar();
  assert.throws(() => r.canal("tarde", async () => 1), /só pode ser chamado durante o ativar/);
  assert.throws(() => criarRegistroFechado().webview({ particao: "ext-x", urlPermitida: () => true }), /só pode ser chamado durante o ativar/);
  assert.deepEqual(r.nomes(), ["eco"], "o que foi registrado continua valendo");
});
function criarRegistroFechado() { const r = criarRegistro(); r.fechar(); return r; }

test("<webview> da extensão: o core só deixa http(s), predicado que lança conta como não, e a navegação fica na origem", () => {
  const tudo = () => true;
  for (const nao of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "chrome://gpu", "devtools://devtools/x", "about:blank", "", "nao é url"]) assert.equal(urlDeExtensaoPermitida(nao, tudo), false, nao);
  assert.equal(urlDeExtensaoPermitida("http://127.0.0.1:5000/", tudo), true);
  assert.equal(urlDeExtensaoPermitida("https://exemplo.com/", tudo), true);
  assert.equal(urlDeExtensaoPermitida("http://127.0.0.1:5000/", () => { throw new Error("quebrou"); }), false);
  for (const quaseSim of [1, "sim", {}, undefined]) assert.equal(urlDeExtensaoPermitida("http://127.0.0.1:5000/", () => quaseSim), false, "só `true` libera");

  const so5000 = (u) => urlDeExtensaoPermitida(u, (x) => /^http:\/\/127\.0\.0\.1:5000\/(\?|#|$)/.test(x));
  // Antes da primeira página: só o que o predicado aceita.
  assert.equal(navegacaoDeExtensaoPermitida("http://127.0.0.1:5000/?a=1", "", so5000), true);
  assert.equal(navegacaoDeExtensaoPermitida("http://127.0.0.1:5000/outra", "", so5000), false);
  assert.equal(navegacaoDeExtensaoPermitida("https://fora.com/", "", so5000), false);
  // Depois: dentro da mesma origem, como o Inspector; fora dela não navega.
  const atual = "http://127.0.0.1:5000/?a=1";
  assert.equal(navegacaoDeExtensaoPermitida("http://127.0.0.1:5000/outra#x", atual, so5000), true);
  for (const nao of ["http://127.0.0.1:5001/", "https://127.0.0.1:5000/", "http://localhost:5000/", "http://127.0.0.1.evil.com:5000/", "https://fora.com/", "file:///etc/passwd", "javascript:alert(1)", "nao é url"]) assert.equal(navegacaoDeExtensaoPermitida(nao, atual, so5000), false, nao);
  assert.equal(navegacaoDeExtensaoPermitida("file:///b", "file:///a", so5000), false, "mesmo com a página num esquema estranho, só http(s) navega");
});

test("ext:invoke: recusa sem extensão, com extensão que não carregou, payload torto, nome inválido e nome desconhecido", async () => {
  // A mensagem inteira, como texto: escapa tudo o que a expressão regular trataria como especial (a barra invertida também).
  const exata = (texto) => new RegExp(`^${texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  await lanca(() => despacharExtInvoke({ kind: "sem" }, { nome: "eco", payload: 1 }), exata(ERRO_SEM_EXTENSAO));
  await lanca(() => despacharExtInvoke({ kind: "falhou" }, { nome: "eco", payload: 1 }), exata(ERRO_EXTENSAO_NAO_CARREGOU));
  const registro = criarRegistro();
  const visto = [];
  registro.canal("eco", async (p) => { visto.push(p); return p; });
  registro.canal("quebra", async () => { throw new Error("o handler recusou"); });
  registro.fechar();
  const estado = { kind: "ativa", registro };
  for (const torto of [undefined, null, "eco", 7, [], ["eco"]]) await lanca(() => despacharExtInvoke(estado, torto), /payload inválido/);
  for (const nome of [undefined, 7, "", "Eco", "eco:x", "../eco", "__proto__", "a".repeat(42), { toString: () => "eco" }]) await lanca(() => despacharExtInvoke(estado, { nome, payload: 1 }), /nome de canal inválido/);
  for (const nome of ["outro", "constructor", "tostring", "ec"]) await lanca(() => despacharExtInvoke(estado, { nome, payload: 1 }), new RegExp(`a extensão não tem o canal "${nome}"`));
  assert.deepEqual(visto, [], "nenhuma recusa chegou a um handler");
  // O payload vai cru ao handler (validar é dele) e a resposta volta como veio; a falha do handler também.
  assert.deepEqual(await despacharExtInvoke(estado, { nome: "eco", payload: { a: [1, 2] } }), { a: [1, 2] });
  assert.equal(await despacharExtInvoke(estado, { nome: "eco" }), undefined);
  await lanca(() => despacharExtInvoke(estado, { nome: "quebra", payload: 1 }), /^o handler recusou$/);
  assert.deepEqual(visto, [{ a: [1, 2] }, undefined]);
});

test("codigo/: bate com a ficha (os dois ou nenhum), sem package.json, sem node_modules e sem link simbólico, em nenhuma subpasta", () => {
  assert.deepEqual(conferirCodigo(FIXTURE, true), { tem: true });
  assert.match(conferirCodigo(FIXTURE, false).erro, /há uma pasta codigo\/, mas a ficha não tem "extensao"/);
  const casos = [
    [(d) => rmSync(join(d, "codigo"), { recursive: true }), true, /a ficha tem "extensao", mas falta a pasta codigo\//],
    [(d) => writeFileSync(join(d, "codigo", "package.json"), "{}"), true, /codigo\/package\.json não é aceito: .* não tem dependências npm próprias/],
    [(d) => mkdirSync(join(d, "codigo", "node_modules")), true, /codigo\/node_modules não é aceito/],
    [(d) => rmSync(join(d, "codigo", "pagina.ts")), true, /falta codigo\/pagina\.ts/],
    [(d) => rmSync(join(d, "codigo", "main.ts")), true, /falta codigo\/main\.ts/],
    [(d) => { writeFileSync(join(d, "fora.ts"), "export {};"); rmSync(join(d, "codigo", "main.ts")); symlinkSync("../fora.ts", join(d, "codigo", "main.ts")); }, true, /codigo\/main\.ts é um link simbólico/],
    [(d) => { rmSync(join(d, "codigo"), { recursive: true }); symlinkSync(tmpdir(), join(d, "codigo")); }, true, /codigo é um link simbólico/],
    // Os arquivos que os dois de entrada importam são código do app tanto quanto eles: as mesmas recusas, pasta adentro.
    [(d) => { writeFileSync(join(d, "fora.ts"), "export {};"); rmSync(join(d, "codigo", "comum.ts")); symlinkSync("../fora.ts", join(d, "codigo", "comum.ts")); }, true, /codigo\/comum\.ts é um link simbólico/],
    [(d) => { mkdirSync(join(d, "codigo", "lib")); writeFileSync(join(d, "fora.ts"), "export {};"); symlinkSync("../../fora.ts", join(d, "codigo", "lib", "util.ts")); }, true, /codigo\/lib\/util\.ts é um link simbólico/],
    [(d) => symlinkSync(tmpdir(), join(d, "codigo", "lib")), true, /codigo\/lib é um link simbólico/],
    [(d) => { mkdirSync(join(d, "codigo", "lib")); writeFileSync(join(d, "codigo", "lib", "package.json"), "{}"); }, true, /codigo\/lib\/package\.json não é aceito/],
    [(d) => mkdirSync(join(d, "codigo", "lib", "node_modules"), { recursive: true }), true, /codigo\/lib\/node_modules não é aceito/],
    [(d) => { rmSync(join(d, "codigo"), { recursive: true }); writeFileSync(join(d, "codigo"), "x"); }, true, /codigo tem de ser uma pasta/],
  ];
  for (const [mexer, temExtensao, frase] of casos) {
    const d = copia(mexer);
    try { assert.match(conferirCodigo(d, temExtensao).erro ?? "(aceitou)", frase); } finally { rmSync(d, { recursive: true, force: true }); }
  }
  const sem = copia((d) => rmSync(join(d, "codigo"), { recursive: true }));
  try { assert.deepEqual(conferirCodigo(sem, false), { tem: false }, "derivado só de ficha e ícone: nada a compilar"); } finally { rmSync(sem, { recursive: true, force: true }); }
});

/** Como em derivado-empacotar.test.mjs: o process.exit do script vira um throw. */
function semSair(f) {
  const exit = process.exit, error = console.error; const dito = [];
  process.exit = (c) => { throw Object.assign(new Error("saiu"), { codigo: c }); };
  console.error = (...a) => { dito.push(a.join(" ")); };
  try { return { valor: f(), dito }; } catch (e) { if (e?.message !== "saiu") throw e; return { codigo: e.codigo, dito: dito.join("\n") }; } finally { process.exit = exit; console.error = error; }
}

test("--produto <pasta>: o derivado de exemplo passa com `temCodigo`; extensão sem codigo/ (ou o contrário) recusa o empacotamento com 64", () => {
  const r = semSair(() => derivadoFromArgv(["node", "x", "--produto", FIXTURE]));
  assert.equal(r.codigo, undefined, r.dito);
  assert.deepEqual([r.valor.nome, r.valor.temCodigo, r.valor.caps.extensao], ["meu-bot-exemplo-staging", true, EXT]);
  const { extensao: _e, abreEm: _a, ...semExtensao } = FICHA;
  const casos = [
    [(d) => rmSync(join(d, "codigo"), { recursive: true }), /derivado recusado .*a ficha tem "extensao", mas falta a pasta codigo\//],
    [(d) => writeFileSync(join(d, "produto.json"), JSON.stringify(semExtensao)), /derivado recusado .*há uma pasta codigo\/, mas a ficha não tem "extensao"/],
    [(d) => writeFileSync(join(d, "codigo", "package.json"), "{}"), /derivado recusado .*codigo\/package\.json não é aceito/],
  ];
  for (const [mexer, frase] of casos) {
    const d = copia(mexer);
    try { const x = semSair(() => derivadoFromArgv(["node", "x", "--produto", d])); assert.equal(x.codigo, 64); assert.match(x.dito, frase); } finally { rmSync(d, { recursive: true, force: true }); }
  }
  const so = copia((d) => { rmSync(join(d, "codigo"), { recursive: true }); writeFileSync(join(d, "produto.json"), JSON.stringify(semExtensao)); });
  try { assert.equal(semSair(() => derivadoFromArgv(["node", "x", "--produto", so])).valor.temCodigo, false); } finally { rmSync(so, { recursive: true, force: true }); }
});

test("compilado do derivado: fora os arquivos da própria codigo/, no main só módulos node: e na janela nenhum import", () => {
  assert.equal(importProibido('"use strict";\nconst fs = __importDefault(require("node:fs"));\nconst cp = require(\'node:child_process\');', "main"), null);
  assert.match(importProibido('const q = require("qrcode");', "main"), /import de "qrcode"/);
  assert.match(importProibido('const e = require("electron");', "main"), /import de "electron"/);
  assert.match(importProibido('const fs = require("fs");', "main"), /import de "fs": .*prefixo node:/);
  assert.match(importProibido('const u = require("/abs/x.js");', "main"), /import de "\/abs\/x\.js": no processo principal só/);
  assert.match(importProibido("const m = require(nome);", "main"), /require\(\) só com o nome do módulo escrito por extenso/);
  assert.match(importProibido('const m = await import("node:fs");', "main"), /import\(\) dinâmico/);
  // Arquivos da própria pasta: relativo, com ou sem .js (CommonJS acha os dois), em subpasta, e voltando sem sair dela.
  for (const [js, onde] of [['require("./nucleo");', ""], ['require("./nucleo.js");', ""], ['require("./lib/util.js");', ""], ['require("../nucleo.js");', "lib"], ['require("../../a.js");', "lib/b"], ['require("./lib/../nucleo.js");', ""]]) assert.equal(importProibido(js, "main", onde), null, `${js} em ${onde || "codigo/"}`);
  for (const [js, onde] of [['require("../app/settings");', ""], ['require("../../fora.js");', "lib"], ['require("./lib/../../fora.js");', ""], ['require("..");', ""]]) assert.match(importProibido(js, "main", onde), /o código do derivado não sai da pasta codigo\//, `${js} em ${onde || "codigo/"}`);
  // O main.ts compilado vira index.js: ninguém o importa pelo nome.
  for (const [js, onde] of [['require("./main");', ""], ['require("./main.js");', ""], ['require("../main.js");', "lib"]]) assert.match(importProibido(js, "main", onde), /o main\.ts é a entrada, nenhum outro arquivo o importa/, js);
  assert.equal(importProibido('require("./main.js");', "main", "lib"), null, "codigo/lib/main.ts é outro arquivo");

  assert.equal(importProibido("export const montar = (api) => ({ open() {} });\n", "renderer"), null);
  assert.equal(importProibido('import { zoom } from "./zoom.js";\nimport "./efeito.js";\nexport { x } from "./lib/x.js";\nexport const montar = 1;', "renderer"), null);
  assert.equal(importProibido('import { a } from "../comum.js";', "renderer", "lib"), null);
  assert.match(importProibido('import { el } from "../lib/dom.js";\nexport const montar = 1;', "renderer"), /import de "\.\.\/lib\/dom\.js": o código do derivado não sai da pasta codigo\//);
  assert.match(importProibido('export { x } from "../../x.js";', "renderer", "lib"), /import de "\.\.\/\.\.\/x\.js": o código do derivado não sai/);
  // Na janela o arquivo é um módulo ES carregado pelo navegador: sem a extensão ele não acha.
  assert.match(importProibido('import { zoom } from "./zoom";', "renderer"), /import de "\.\/zoom": na janela o import relativo termina em \.js \(escreva "\.\/zoom\.js"/);
  assert.match(importProibido('import {\n  a,\n  b,\n} from "./zoom";', "renderer"), /import de "\.\/zoom": na janela/, "import quebrado em várias linhas também é visto");
  for (const nome of ["qrcode", "node:fs", "/abs/x.js", "https://fora.com/x.js", "meu-bot/extensao-pagina"]) assert.match(importProibido(`import x from "${nome}";`, "renderer"), /a página só importa arquivos da própria pasta codigo\//, nome);
  assert.match(importProibido('import "electron";', "renderer"), /import de "electron"/);
  assert.equal(importProibido('export const texto = \'importe assim: import x from "qrcode"\';\n// import y from "electron";\n', "renderer"), null, "texto e comentário não são import");
  assert.match(importProibido('const m = await import("./x.js");', "renderer"), /import\(\) dinâmico/);
  assert.match(importProibido('const fs = require("node:fs");', "renderer"), /require\(\) não existe na janela/);
});

test("derivado de exemplo: o core compila os dois lados, cada um com o arquivo que importa; o index.js registra o canal `eco` e a página monta com a API da janela", async () => {
  const saida = temp("meu-bot-ext-saida-");
  const destinos = { main: join(saida, "main", "derivado"), renderer: join(saida, "renderer", "derivado") };
  try {
    assert.deepEqual(compilarCodigo({ pasta: FIXTURE, destinos }), destinos);
    // O comum.ts é usado pelos dois lados: sai duas vezes, uma em cada formato (CommonJS no main, módulo ES na janela).
    assert.deepEqual(readdirSync(destinos.main).sort(), ["comum.js", "index.js"]);
    assert.deepEqual(readdirSync(destinos.renderer).sort(), ["comum.js", "pagina.js"]);
    assert.match(readFileSync(join(destinos.main, "comum.js"), "utf8"), /exports\.CANAL_ECO = "eco"/);
    assert.match(readFileSync(join(destinos.main, "index.js"), "utf8"), /require\("\.\/comum\.js"\)/);
    assert.match(readFileSync(join(destinos.renderer, "comum.js"), "utf8"), /^export const CANAL_ECO = "eco";$/m);
    assert.match(readFileSync(join(destinos.renderer, "pagina.js"), "utf8"), /^import \{ CANAL_ECO, textoDoEco \} from "\.\/comum\.js";$/m);
    // Nada foi escrito no repositório do derivado nem em src/.
    assert.deepEqual(readdirSync(join(FIXTURE, "codigo")).sort(), ["comum.ts", "main.ts", "pagina.ts"]);
    assert.deepEqual(readdirSync(FIXTURE).sort(), ["assets", "codigo", "produto.json"]);

    // Processo principal: o que o carregador faz (extensao.ts), com uma API falsa por cima do registro de verdade.
    const ativar = ativarDoModulo(req(join(destinos.main, "index.js")));
    assert.equal(typeof ativar, "function");
    const registro = criarRegistro(); const linhas = [];
    const ext = ativar({ pastaDados: "/dados/extensao", log: (l) => linhas.push(l), acharNode: () => null, controleRemoto: { garantir: async () => ({ ok: false, erro: "teste" }) }, canal: (n, h) => registro.canal(n, h), webview: (w) => registro.webview(w) });
    registro.fechar();
    assert.deepEqual(registro.nomes(), ["eco"]);
    assert.equal(registro.webviewDeclarado(), null, "o exemplo não usa <webview>");
    const estado = { kind: "ativa", registro };
    assert.deepEqual(await despacharExtInvoke(estado, { nome: "eco", payload: { oi: 1 } }), { oi: 1 });
    ext.encerrar();
    assert.deepEqual(linhas, ["[exemplo] extensão ativada", "[exemplo] extensão encerrada"]);

    // Janela: o montarExtensao de verdade (dist/renderer), importando o compilado da pasta temporária, com um DOM mínimo.
    writeFileSync(join(saida, "renderer", "package.json"), JSON.stringify({ type: "module" })); // como dist/renderer (scripts/vendor.mjs)
    const { montarExtensao } = await import("../../dist/renderer/extensao/extensao.js");
    const no = () => ({ filhos: [], className: "", hidden: false, textContent: "", append(...f) { this.filhos.push(...f); } });
    const paginas = []; const abertas = []; const falhas = []; const ouvintes = [];
    const deps = {
      panelsEl: no(),
      definePage: (id, title, panel, render) => { const p = { id, title, panel, render, tabEl: null }; paginas.push(p); return p; },
      openPage: (p) => { abertas.push(p.id); p.render(); },
      api: { extInvocar: (nome, payload) => despacharExtInvoke(estado, { nome, payload }), zoomFactorNow: () => 1.2, on: (canal, f) => { ouvintes.push([canal, f]); } },
      registrar: (l) => falhas.push(l),
    };
    globalThis.document = { createElement: no };
    try {
      const pagina = await montarExtensao(deps, () => import(pathToFileURL(join(destinos.renderer, "pagina.js")).href));
      assert.deepEqual(falhas, []);
      assert.notEqual(pagina, null);
      assert.deepEqual(paginas.map((p) => [p.id, p.title]), [["extensao", "Exemplo"]]);
      assert.equal(deps.panelsEl.filhos.length, 1, "o painel entrou em panelsEl");
      assert.equal(paginas[0].panel.filhos[0].textContent, "Página de exemplo de um app derivado.");
      pagina.open();
      assert.deepEqual(abertas, ["extensao"]);
      await new Promise((r) => setImmediate(r));
      assert.equal(paginas[0].panel.filhos[1].textContent, 'eco: {"zoom":1.2}', "a página falou com o main pelo canal eco");
    } finally { delete globalThis.document; }
  } finally { rmSync(saida, { recursive: true, force: true }); }
});

test("janela: código que falta, que lança, que não exporta `montar` ou que usa outro id não derruba nada; o app segue sem a página", async () => {
  const { montarExtensao, ID_DA_PAGINA_DE_EXTENSAO } = await import("../../dist/renderer/extensao/extensao.js");
  assert.equal(ID_DA_PAGINA_DE_EXTENSAO, "extensao");
  const novo = () => { const falhas = []; const zoom = []; return { falhas, zoom, deps: { panelsEl: {}, definePage: (id) => ({ id }), openPage: () => {}, api: { extInvocar: async () => null, zoomFactorNow: () => 1, on: (canal, f) => { zoom.push([canal, f]); } }, registrar: (l) => falhas.push(l) } }; };
  const casos = [
    [() => Promise.reject(new Error("Cannot find module pagina.js")), /a página não carregou, o app segue sem ela: Cannot find module/],
    [async () => ({}), /não exporta a função montar/],
    [async () => null, /não exporta a função montar/],
    [async () => ({ montar: () => { throw new Error("quebrou ao montar"); } }), /quebrou ao montar/],
    [async () => ({ montar: () => ({}) }), /o montar não devolveu \{ open \}/],
    [async () => ({ montar: (api) => { api.definePage("inspector", "x", {}, () => {}); return { open() {} }; } }), /a página de uma extensão tem o id "extensao"/],
    [async () => ({ montar: (api) => { api.definePage("extensao", "x", {}, () => {}); api.definePage("extensao", "y", {}, () => {}); return { open() {} }; } }), /uma extensão tem uma página só/],
  ];
  for (const [importar, frase] of casos) {
    const t = novo();
    assert.equal(await montarExtensao(t.deps, importar), null);
    assert.equal(t.falhas.length, 1); assert.match(t.falhas[0], frase);
  }
  // `open` que lança fica registrado; o zoom chega à página só como o fator.
  const t = novo(); const fatores = [];
  const pagina = await montarExtensao(t.deps, async () => ({ montar: (api) => { api.aoMudarZoom((f) => fatores.push(f)); return { open() { throw new Error("não abriu"); } }; } }));
  pagina.open();
  assert.match(t.falhas[0], /a página não abriu: não abriu/);
  assert.equal(t.zoom[0][0], "window:zoom-changed");
  t.zoom[0][1]({ level: 1, factor: 1.2, percent: 120 });
  assert.deepEqual(fatores, [1.2]);
  // Sem o arquivo no pacote (todo app da tabela, se alguém chamasse): o import de verdade falha e vira null.
  const sem = novo();
  assert.equal(existsSync(join(RAIZ, "dist", "renderer", "derivado")), false, "dist/ deste checkout não tem código de derivado");
  assert.equal(await montarExtensao(sem.deps), null);
  assert.equal(sem.falhas.length, 1);
});

test("compilação: erro de tipo, import fora do contrato e assinatura errada recusam, e nada fica pela metade", () => {
  const casos = [
    [(d) => writeFileSync(join(d, "codigo", "main.ts"), `${readFileSync(join(d, "codigo", "main.ts"), "utf8")}\nexport const n: number = "texto";\n`), /codigo\/main\.ts não compila:\ncodigo\/main\.ts\(\d+,\d+\): error TS2322/],
    [(d) => writeFileSync(join(d, "codigo", "main.ts"), `import { app } from "electron";\n${readFileSync(join(d, "codigo", "main.ts"), "utf8")}\nconsole.log(app);\n`), /codigo\/main\.ts não compila:[\s\S]*Cannot find module 'electron'/],
    [(d) => writeFileSync(join(d, "codigo", "main.ts"), `import cp from "child_process";\n${readFileSync(join(d, "codigo", "main.ts"), "utf8")}\nconsole.log(cp);\n`), /codigo\/main\.ts: import de "child_process"/],
    [(d) => writeFileSync(join(d, "codigo", "main.ts"), "export const ativar = (api: string): number => api.length;\n"), /codigo\/main\.ts não compila:[\s\S]*conferir\.ts.*not assignable to type 'AtivarExtensao'/],
    [(d) => writeFileSync(join(d, "codigo", "pagina.ts"), "export const outra = 1;\n"), /codigo\/pagina\.ts não compila:[\s\S]*montar/],
    // Import relativo: o arquivo tem de existir em codigo/, a janela escreve o .js, e ninguém sai da pasta (o
    // `../conferir` existe na pasta temporária da compilação: compila, e é a conferência do compilado que recusa).
    [(d) => writeFileSync(join(d, "codigo", "pagina.ts"), `import { x } from "./nao-existe.js";\n${readFileSync(join(d, "codigo", "pagina.ts"), "utf8")}\nconsole.log(x);\n`), /codigo\/pagina\.ts não compila:[\s\S]*Cannot find module '\.\/nao-existe\.js'/],
    [(d) => { writeFileSync(join(d, "fora.ts"), "export const x = 1;\n"); writeFileSync(join(d, "codigo", "main.ts"), `import { x } from "../fora.js";\n${readFileSync(join(d, "codigo", "main.ts"), "utf8")}\nconsole.log(x);\n`); }, /codigo\/main\.ts não compila:[\s\S]*Cannot find module '\.\.\/fora\.js'/],
    [(d) => writeFileSync(join(d, "codigo", "main.ts"), `import { conferido } from "../conferir.js";\n${readFileSync(join(d, "codigo", "main.ts"), "utf8")}\nconsole.log(conferido);\n`), /codigo\/main\.ts: import de "\.\.\/conferir\.js": o código do derivado não sai da pasta codigo\//],
    [(d) => writeFileSync(join(d, "codigo", "pagina.ts"), readFileSync(join(d, "codigo", "pagina.ts"), "utf8").replace('"./comum.js"', '"./comum"')), /codigo\/pagina\.ts: import de "\.\/comum": na janela o import relativo termina em \.js/],
    [(d) => { mkdirSync(join(d, "codigo", "lib")); writeFileSync(join(d, "codigo", "lib", "util.ts"), 'import { CANAL_ECO } from "../comum";\nexport const nome = CANAL_ECO;\n'); writeFileSync(join(d, "codigo", "pagina.ts"), `import { nome } from "./lib/util.js";\n${readFileSync(join(d, "codigo", "pagina.ts"), "utf8")}\nconsole.log(nome);\n`); }, /codigo\/lib\/util\.ts: import de "\.\.\/comum": na janela o import relativo termina em \.js/],
    // O main.ts compilado chama-se index.js: um codigo/index.ts ficaria por baixo dele, e ninguém importa a entrada.
    [(d) => { writeFileSync(join(d, "codigo", "index.ts"), "export const x = 1;\n"); writeFileSync(join(d, "codigo", "main.ts"), `import { x } from "./index.js";\n${readFileSync(join(d, "codigo", "main.ts"), "utf8")}\nconsole.log(x);\n`); }, /codigo\/index\.ts: este nome é o do main\.ts compilado \(index\.js\)/],
    [(d) => { writeFileSync(join(d, "codigo", "volta.ts"), 'import { ativar } from "./main.js";\nexport const f = ativar;\n'); writeFileSync(join(d, "codigo", "main.ts"), `import { f } from "./volta.js";\n${readFileSync(join(d, "codigo", "main.ts"), "utf8")}\nconsole.log(f);\n`); }, /codigo\/volta\.ts: import de "\.\/main\.js": o main\.ts é a entrada/],
    // O que é do Node não serve à janela, e o que é da janela não serve ao main: cada lado compila com os tipos dele.
    [(d) => writeFileSync(join(d, "codigo", "comum.ts"), `${readFileSync(join(d, "codigo", "comum.ts"), "utf8")}\nexport const largura = (): number => document.body.clientWidth;\n`), /codigo\/main\.ts não compila:[\s\S]*comum\.ts.*Cannot find name 'document'/],
  ];
  for (const [mexer, frase] of casos) {
    const d = copia(mexer); const saida = temp("meu-bot-ext-saida-");
    const destinos = { main: join(saida, "main"), renderer: join(saida, "renderer") };
    try {
      assert.throws(() => compilarCodigo({ pasta: d, destinos }), (e) => { assert.match(e.message, frase); return true; });
      assert.deepEqual(readdirSync(saida), [], "nem o lado que compilou fica");
    } finally { rmSync(d, { recursive: true, force: true }); rmSync(saida, { recursive: true, force: true }); }
  }
  // O main do derivado pode usar o Node (é como o Inspector sobe um processo): módulo node: passa. E o código pode
  // ter subpastas: cada lado leva só o que a entrada dele alcança, na mesma árvore; o que ninguém importa não vai, e o
  // que estava no destino de uma compilação anterior sai.
  const d = copia((x) => {
    writeFileSync(join(x, "codigo", "main.ts"), `import fs from "node:fs";\nimport { dobro } from "./lib/conta.js";\n${readFileSync(join(x, "codigo", "main.ts"), "utf8")}\nexport const existe = (p: string): boolean => fs.existsSync(p);\nexport const quatro = dobro(2);\n`);
    mkdirSync(join(x, "codigo", "lib"));
    writeFileSync(join(x, "codigo", "lib", "conta.ts"), 'import { CANAL_ECO } from "../comum.js";\nexport const dobro = (n: number): number => n * 2;\nexport const canal = CANAL_ECO;\n');
    writeFileSync(join(x, "codigo", "solto.ts"), "export const ninguemImporta: number = 'nem compila';\n");
    writeFileSync(join(x, "codigo", "LEIAME.txt"), "não é código");
  });
  const saida = temp("meu-bot-ext-saida-");
  try {
    mkdirSync(join(saida, "main")); writeFileSync(join(saida, "main", "velho.js"), "");
    compilarCodigo({ pasta: d, destinos: { main: join(saida, "main"), renderer: join(saida, "renderer") } });
    assert.match(readFileSync(join(saida, "main", "index.js"), "utf8"), /require\("node:fs"\)/);
    assert.deepEqual(readdirSync(join(saida, "main"), { recursive: true }).sort(), ["comum.js", "index.js", "lib", join("lib", "conta.js")]);
    assert.deepEqual(readdirSync(join(saida, "renderer"), { recursive: true }).sort(), ["comum.js", "pagina.js"], "a janela não importa lib/conta: não leva");
    const m = req(join(saida, "main", "index.js"));
    assert.deepEqual([m.quatro, typeof m.ativar], [4, "function"], "o index.js acha lib/conta.js e o comum.js ao lado");
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(saida, { recursive: true, force: true }); }
});

test("limpeza: o código de um derivado sai de dist/ antes de empacotar qualquer app e ao sair, e a fixture não entra em pacote nenhum", () => {
  const dist = temp("meu-bot-ext-dist-");
  try {
    const d = destinosDoCodigo(dist);
    assert.deepEqual(d, { main: join(dist, "main", "derivado"), renderer: join(dist, "renderer", "derivado") });
    for (const p of [d.main, d.renderer, join(dist, "main", "extensao"), join(dist, "renderer", "extensao")]) { mkdirSync(p, { recursive: true }); writeFileSync(join(p, "x.js"), ""); }
    limparCodigo(dist);
    assert.equal(existsSync(d.main), false); assert.equal(existsSync(d.renderer), false);
    // O carregador do core (src/main/extensao, src/renderer/extensao) mora em OUTRA pasta: a limpeza não o leva.
    assert.equal(existsSync(join(dist, "main", "extensao", "x.js")), true); assert.equal(existsSync(join(dist, "renderer", "extensao", "x.js")), true);
    limparCodigo(dist); // de novo, sem nada: não lança
  } finally { rmSync(dist, { recursive: true, force: true }); }
  // O padrão é o dist/ deste checkout, e é lá que o carregador procura (ao lado da pasta dele, dentro do asar).
  assert.deepEqual(destinosDoCodigo(), { main: join(RAIZ, "dist", "main", "derivado"), renderer: join(RAIZ, "dist", "renderer", "derivado") });
  assert.match(readFileSync(join(RAIZ, "src", "main", "extensao", "extensao.ts"), "utf8"), /path\.join\(__dirname, "\.\.", "derivado", "index\.js"\)/);
  assert.match(readFileSync(join(RAIZ, "src", "renderer", "extensao", "extensao.ts"), "utf8"), /new URL\("\.\.\/derivado\/pagina\.js", import\.meta\.url\)/);
  assert.deepEqual([LADOS.main.saida, LADOS.renderer.saida], ["index.js", "pagina.js"]);
  // package.mjs: limpa antes de decidir o que empacota (vale para --variant), registra a limpeza do `exit` antes de
  // compilar, e só então chama o packager.
  const pkg = readFileSync(join(RAIZ, "scripts", "package.mjs"), "utf8");
  const [antes, noExit, compila, empacota] = [pkg.indexOf("\nlimparCodigo();"), pkg.indexOf("try { limparCodigo(); }"), pkg.indexOf("compilarCodigo({ pasta: produto.pasta })"), pkg.indexOf("await packager(")];
  assert.ok(antes > 0 && noExit > antes && compila > noExit && empacota > compila, `ordem em package.mjs: ${[antes, noExit, compila, empacota].join(" < ")}`);
  assert.ok(pkg.indexOf("if (produto.ficha !== undefined) {") > antes, "a primeira limpeza não depende de ser um derivado");
  assert.match(pkg.slice(pkg.lastIndexOf('process.on("exit"', noExit), noExit + 40), /process\.on\("exit", \(\) => \{[\s\S]*limparCodigo\(\)/);
  // scripts/ (onde mora a fixture) e src/ não vão para o pacote: só dist/.
  assert.match(pkg, /ignore: \[.*\/\^\\\/src\(\$\|\\\/\)\/.*\/\^\\\/scripts\(\$\|\\\/\)\//);
});

test("encerrarDoRetorno: acha o encerrar do que o ativar devolveu (ligado ao objeto), ou null; é por ele que o core para a extensão, na saída e depois de uma falha", () => {
  let parou = 0;
  const r = { n: 2, encerrar() { parou += this.n; } };
  const f = encerrarDoRetorno(r);
  assert.equal(typeof f, "function");
  f(); assert.equal(parou, 2, "chamado com o this do objeto devolvido");
  for (const sem of [undefined, null, 7, "x", {}, { encerrar: "não é função" }, []]) assert.equal(encerrarDoRetorno(sem), null);
});
