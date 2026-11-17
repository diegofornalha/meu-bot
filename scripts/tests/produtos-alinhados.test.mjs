// Produtos e add-ons alinhados em todas as cópias: a tabela (src/main/app/variant-core.ts) é a fonte; o tipo
// AppVariant, a auditoria, o backend da máquina, a regra das telas, os ícones e os atalhos de build têm de bater com
// ela. Um MVP novo que esqueça um desses lugares quebra aqui, não no app da pessoa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const req = createRequire(import.meta.url);
const root = join(import.meta.dirname, "..", "..");
const V = req("../../dist/main/app/variant-core.js");
const { PRODUTOS, ADDONS, NAO_ADDON, ADDONS_DO_PERSONALIZADO, PAGINAS_INICIAIS, nomesReservados, capsFor, esquemaDe, ESQUEMA_RE } = V;
const fonte = (rel) => readFileSync(join(root, rel), "utf8");
const unicos = (xs) => new Set(xs).size === xs.length;

test("produtos: nome, bundle id e pasta de dados únicos; portas únicas entre os apps da pessoa", () => {
  assert.ok(unicos(PRODUTOS.map((p) => p.variant)), "variant repetido");
  assert.ok(unicos(PRODUTOS.map((p) => p.nome)), "nome repetido");
  assert.ok(unicos(PRODUTOS.map((p) => p.bundleId)), "bundle id repetido");
  assert.ok(unicos(PRODUTOS.map((p) => p.userData ?? "(padrão)")), "pasta de dados repetida");
  // Só os apps com chat sobem backend local (o admin e o admin-mac não); abertos juntos, não podem dividir a porta.
  const daPessoa = PRODUTOS.filter((p) => p.caps.chat);
  assert.ok(unicos(daPessoa.map((p) => p.portaLocal)), "porta local repetida entre apps da pessoa");
});

test("produtos: cada app tem um esquema de URL (deep link do login) próprio e válido como scheme", () => {
  const esquemas = PRODUTOS.map(esquemaDe);
  assert.ok(unicos(esquemas), "esquema repetido: o staging roubaria o retorno do login do estável");
  for (const e of esquemas) assert.match(e, ESQUEMA_RE, `${e}: scheme inválido (RFC 3986: letra, depois letras, dígitos e hífen)`);
});

test("produtos: ícone .icns e o .svg de origem existem; staging herda de um app da tabela", () => {
  for (const p of PRODUTOS) {
    assert.ok(existsSync(join(root, p.icone)), `${p.nome}: falta ${p.icone}`);
    assert.ok(existsSync(join(root, p.icone.replace(/\.icns$/, ".svg"))), `${p.nome}: falta o .svg de ${p.icone}`);
    if (p.canal === "staging") assert.ok(PRODUTOS.some((o) => o.nome === p.herdaDe), `${p.nome}: herdaDe "${p.herdaDe}" não é um app da tabela`);
  }
});

test("produtos que saem para Windows têm o .ico ao lado do .icns, com os tamanhos que o Windows pede", () => {
  const doWindows = PRODUTOS.filter((p) => p.windows);
  assert.ok(doWindows.length > 0, "nenhum produto marcado windows");
  for (const p of doWindows) {
    const ico = join(root, p.icone.replace(/\.icns$/, ".ico"));
    assert.ok(existsSync(ico), `${p.nome}: falta o .ico (rode npm run icons)`);
    const b = readFileSync(ico);
    assert.equal(b.readUInt16LE(2), 1, `${p.nome}: não é um .ico`);
    const tamanhos = Array.from({ length: b.readUInt16LE(4) }, (_, i) => b.readUInt8(6 + 16 * i) || 256);
    for (const t of [16, 32, 48, 256]) assert.ok(tamanhos.includes(t), `${p.nome}: .ico sem ${t}px`);
  }
});

test("produtos: addon está no catálogo e abreEm é uma página que as telas sabem abrir", () => {
  const nomes = ADDONS.map((a) => a.nome);
  assert.ok(unicos(nomes), "add-on repetido");
  for (const a of ADDONS) assert.ok(a.rotulo !== "" && a.descricao !== "", `${a.nome}: rótulo e descrição`);
  const renderer = fonte("src/renderer/renderer.ts");
  for (const p of PRODUTOS) {
    if (p.addon !== null) assert.ok(nomes.includes(p.addon), `${p.nome}: add-on ${p.addon} fora de ADDONS`);
    if (p.abreEm !== null) assert.ok(PAGINAS_INICIAIS.includes(p.abreEm), `${p.nome}: abreEm ${p.abreEm} fora de PAGINAS_INICIAIS`);
  }
  for (const pg of PAGINAS_INICIAIS) assert.ok(renderer.includes(`fixa === "${pg}"`), `renderer.ts não abre a página inicial "${pg}"`);
  for (const n of ADDONS_DO_PERSONALIZADO) assert.ok(nomes.includes(n), `${n} (plano personalizado antigo) fora de ADDONS`);
});

test("a janela recebe o catálogo: caps leva addon, abreEm e os rótulos dos add-ons", () => {
  for (const p of PRODUTOS) {
    const c = capsFor(p.variant, "1.0.0");
    assert.equal(c.addon, p.addon); assert.equal(c.abreEm, p.abreEm);
    assert.deepEqual(c.addons, ADDONS.map((a) => ({ nome: a.nome, rotulo: a.rotulo, modulos: a.modulos, semLicenca: a.semLicenca })));
  }
});

test("tipo AppVariant (src/shared/ipc/app.ts) tem exatamente os produtos da tabela", () => {
  const m = /export type AppVariant = ([^;]+);/.exec(fonte("src/shared/ipc/app.ts"));
  assert.ok(m, "AppVariant não encontrado");
  const tipo = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(tipo, PRODUTOS.map((p) => p.variant).sort());
});

test("auditoria conhece todos os apps; nenhum nome da tabela pode virar MVP", () => {
  const { APPS } = req("../../dist/main/auditoria/auditoria-core.js");
  for (const p of PRODUTOS) assert.ok(APPS.includes(p.nome), `auditoria-core APPS sem ${p.nome}`);
  const { nomeValido } = req("../../dist/main/admin/produtos-core.js");
  const reservados = nomesReservados();
  for (const n of [...PRODUTOS.map((p) => p.nome), ...ADDONS.map((a) => a.nome), ...NAO_ADDON]) {
    if (n === "meu-bot") continue; // não é meu-bot-<algo>: já cai na forma
    assert.ok(reservados.has(n), `${n} fora de nomesReservados()`); assert.equal(nomeValido(n), false, `${n} aceito como MVP`);
  }
});

test("backend da máquina (backend-colima/licenca.js) tem as mesmas listas de add-on que o app", () => {
  const b = req("../../backend-colima/licenca.js");
  assert.deepEqual([...b.ADDONS].sort(), ADDONS.map((a) => a.nome).sort(), "ADDONS");
  assert.deepEqual([...b.ADDONS_DO_PERSONALIZADO].sort(), [...ADDONS_DO_PERSONALIZADO].sort(), "ADDONS_DO_PERSONALIZADO");
  assert.deepEqual([...b.NAO_ADDON].sort(), [...NAO_ADDON].sort(), "NAO_ADDON");
  assert.deepEqual([...b.MODULOS_SEM_LICENCA].sort(), ADDONS.filter((a) => a.semLicenca).map((a) => a.nome).sort(), "MODULOS_SEM_LICENCA");
});

test("financeiro liberado: main, telas e backend da máquina decidem igual", async () => {
  const main = req("../../dist/main/licenca/licenca.js");
  const tela = await import("../../dist/renderer/lib/pro.js");
  const back = req("../../backend-colima/licenca.js");
  const now = Date.parse("2026-10-27T12:00:00Z");
  const base = { plan: "free", status: "free", interval: null, memberSince: "2026-10-01T00:00:00Z", trialEnd: null, expiresAt: null, deviceLimit: 1, produtos: [], updatedAt: "2026-10-01T00:00:00Z", updatedBy: "admin" };
  const casos = [
    { ...base },
    { ...base, produtos: ["meu-bot-finance"] },
    { ...base, plan: "pro", status: "active", produtos: [] },
    { ...base, plan: "pro", status: "active", produtos: ["meu-bot-finance"] },
    { ...base, status: "expired", produtos: ["meu-bot-finance"] },
    { ...base, produtos: ["meu-bot-finance"], expiresAt: "2026-10-01T00:00:00Z" },
  ];
  for (const lic of casos) {
    const view = { license: lic, devices: [], activeCount: 1, pendingCount: 0, deviceLimit: 1 };
    const b = back.financeOk(lic, now);
    assert.equal(main.financeOk(view, "agente-box", now), b, `main × backend: ${JSON.stringify(lic)}`);
    assert.equal(tela.financeOk(view, "agente-box", now), b, `telas × backend: ${JSON.stringify(lic)}`);
  }
});

test("atalhos de build do package.json só apontam para produtos da tabela", () => {
  const scripts = JSON.parse(fonte("package.json")).scripts;
  for (const [nome, cmd] of Object.entries(scripts)) {
    if (!nome.startsWith("dist")) continue;
    assert.match(cmd, /^node scripts\/dist\.mjs( --variant [\w-]+)?( --plataforma win32)?$/, `${nome} não usa scripts/dist.mjs`);
    const v = / --variant ([\w-]+)/.exec(cmd)?.[1] ?? "client";
    const produto = PRODUTOS.find((p) => p.variant === v);
    assert.ok(produto !== undefined, `${nome}: variant ${v} fora da tabela`);
    if (cmd.includes("--plataforma win32")) assert.ok(produto.windows, `${nome}: ${v} não está marcado windows na tabela`);
  }
});

test("janela Produtos: todo app da tabela tem descrição; o catálogo dela é a tabela", () => {
  for (const p of PRODUTOS) assert.ok(typeof p.descricao === "string" && p.descricao.length >= 20, `${p.nome}: descrição`);
});

test("toda tela .html do renderer é copiada no build (senão só quebra no app empacotado)", async () => {
  const { readdirSync } = await import("node:fs");
  const build = JSON.parse(fonte("package.json")).scripts["build:renderer"];
  for (const f of readdirSync(join(root, "src/renderer")).filter((x) => x.endsWith(".html"))) assert.ok(build.includes(`src/renderer/${f}`), `build:renderer não copia ${f}`);
});
