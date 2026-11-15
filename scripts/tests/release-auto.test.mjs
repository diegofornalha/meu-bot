// Regras da release automática (scripts/release-auto.mjs): o que cada rodada do agente decide fazer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dataPorExtenso, decideRodada, decideSite, desfazDeploy, estavelMaisNova, faltasDoSite, fecharChangelog, plistDoAgente, proximaBase, QUIETUDE_MS, saudeStaging, SOAK_MS, stagingMaisNovo } from "../release-core.mjs";

const AGORA = Date.parse("2026-11-10T15:00:00Z");
const ok = { ok: true, motivo: "ok" };
const base = { base: "0.80.0", tagsTodas: ["v0.79.3"], tagsNoHead: [], commitEm: AGORA - QUIETUDE_MS - 1, stagingEm: null, saude: null, agora: AGORA };

test("release automática: staging só depois de 10 min sem merge novo", () => {
  assert.equal(decideRodada(base).acao, "staging");
  const r = decideRodada({ ...base, commitEm: AGORA - 60_000 });
  assert.equal(r.acao, "aguardar"); assert.match(r.motivo, /staging em 9 min/);
});

test("release automática: o PR da versão sozinho não solta staging novo", () => {
  assert.equal(decideRodada({ ...base, mudouDesdeRelease: ["package.json", "package-lock.json", "docs/CHANGELOG.md"] }).acao, "aguardar");
  assert.equal(decideRodada({ ...base, mudouDesdeRelease: ["package.json", "src/main/main.ts"] }).acao, "staging");
});

test("release automática: promove só com 24 h no ar e a saúde ok", () => {
  const st = { ...base, tagsTodas: ["v0.79.3", "v0.80.0-staging.1", "v0.80.0-staging.2"], tagsNoHead: ["v0.80.0-staging.2"], stagingEm: AGORA - SOAK_MS - 1, saude: ok };
  assert.equal(decideRodada(st).acao, "promover");
  const cedo = decideRodada({ ...st, stagingEm: AGORA - 3600_000 });
  assert.equal(cedo.acao, "aguardar"); assert.match(cedo.motivo, /em 23 h/);
  const doente = decideRodada({ ...st, saude: { ok: false, motivo: "ainda na 0.80.0-staging.1" } });
  assert.equal(doente.acao, "aguardar"); assert.equal(doente.abrirStaging, true);
  assert.equal(decideRodada({ ...st, stagingEm: null }).acao, "aguardar");
});

test("release automática: staging de um commit anterior não promove (o HEAD andou: sai staging novo)", () => {
  const r = decideRodada({ ...base, tagsTodas: ["v0.80.0-staging.1"], tagsNoHead: [], saude: ok });
  assert.equal(r.acao, "staging");
});

test("release automática: depois da estável, sobe a base", () => {
  assert.equal(decideRodada({ ...base, tagsTodas: ["v0.80.0-staging.2", "v0.80.0"], tagsNoHead: ["v0.80.0-staging.2", "v0.80.0"] }).acao, "subir-base");
  assert.equal(proximaBase("0.80.0"), "0.81.0");
  assert.equal(proximaBase("1.9.3"), "1.10.0");
});

test("staging mais novo da base, pelo número (não pela ordem das tags)", () => {
  assert.equal(stagingMaisNovo("0.80.0", ["v0.80.0-staging.10", "v0.80.0-staging.9", "v0.81.0-staging.1"]), "v0.80.0-staging.10");
  assert.equal(stagingMaisNovo("0.80.0", ["v0.79.3"]), null);
});

test("saúde do staging: versão, origem, confirmação do atualizador e nenhuma volta", () => {
  const v = "0.80.0-staging.2";
  const bom = { versao: v, plistVersao: v, origem: "release", log: `[atualização] ${v} confirmada (ficou de pé; ocioso)`, pendente: null };
  assert.equal(saudeStaging(bom).ok, true);
  assert.match(saudeStaging({ ...bom, plistVersao: null }).motivo, /não está instalado/);
  assert.match(saudeStaging({ ...bom, plistVersao: "0.80.0-staging.1" }).motivo, /ainda está na 0.80.0-staging.1/);
  assert.match(saudeStaging({ ...bom, origem: "local" }).motivo, /build local/);
  assert.match(saudeStaging({ ...bom, pendente: { para: v } }).motivo, /não confirmada/);
  assert.match(saudeStaging({ ...bom, log: "" }).motivo, /ainda não confirmou/);
  const voltou = saudeStaging({ ...bom, plistVersao: "0.80.0-staging.1", log: `${bom.log}\n[atualização] ${v} não passou das primeiras aberturas: voltando para 0.80.0-staging.1` });
  assert.equal(voltou.ok, false); assert.equal(voltou.falhou, true);
  // a confirmação de outra versão (staging.20 contém "staging.2") não conta
  assert.equal(saudeStaging({ ...bom, log: "[atualização] 0.80.0-staging.20 confirmada" }).ok, false);
});

test("CHANGELOG depois da estável: a seção ganha a data e um 'Ainda não lançado' novo e vazio", () => {
  const t = "# Changelog\n\n---\n\n## Ainda não lançado\n\n### Coisa\n- item\n\n---\n\n## 9 de novembro de 2026 · v0.79.3\n";
  const novo = fecharChangelog(t, "0.80.0", "10 de novembro de 2026");
  assert.equal(novo, "# Changelog\n\n---\n\n## Ainda não lançado\n\n---\n\n## 10 de novembro de 2026 · v0.80.0\n\n### Coisa\n- item\n\n---\n\n## 9 de novembro de 2026 · v0.79.3\n");
  assert.equal(fecharChangelog("# nada", "0.80.0", "x"), null);
  assert.equal(dataPorExtenso(new Date("2026-11-10T02:00:00Z")), "9 de novembro de 2026");
});

test("CHANGELOG depois da estável: os itens de docs/changelog/ entram no topo da seção datada", () => {
  const t = "# C\n\n## Ainda não lançado\n\n### Direto\n- d\n\n---\n\n## 9 de novembro de 2026 · v0.79.3\n";
  assert.equal(fecharChangelog(t, "0.80.0", "10 de novembro de 2026", "### Do arquivo\n- f\n"),
    "# C\n\n## Ainda não lançado\n\n---\n\n## 10 de novembro de 2026 · v0.80.0\n\n### Do arquivo\n- f\n\n### Direto\n- d\n\n---\n\n## 9 de novembro de 2026 · v0.79.3\n");
  // Seção vazia (o normal com a pasta): a seção datada fica só com os arquivos.
  assert.equal(fecharChangelog("## Ainda não lançado\n\n---\n\n## 9 de novembro\n", "0.80.0", "10 de novembro", "### A\n- a"),
    "## Ainda não lançado\n\n---\n\n## 10 de novembro · v0.80.0\n\n### A\n- a\n\n---\n\n## 9 de novembro\n");
  // "$&" num item não vira a seção casada (replace com função).
  assert.match(fecharChangelog("## Ainda não lançado\n", "1.0.0", "d", "- custa $& 10"), /- custa \$& 10/);
});

test("site: a estável mais nova ignora staging e ordena por número, não por texto", () => {
  assert.equal(estavelMaisNova(["v0.9.0", "v0.83.0", "v0.84.0-staging.2", "v0.10.1", "lixo", ""]), "v0.83.0");
  assert.equal(estavelMaisNova(["v0.84.0-staging.1"]), null);
});

test("site: publica quando sai estável nova com conta-api diferente; a primeira rodada só anota", () => {
  const b = { ultimaEstavel: "v0.84.0", siteDe: "v0.83.0", mudouSite: true, falhouEm: null, agora: 10_000_000, esperaMs: 3_600_000 };
  assert.equal(decideSite(b).acao, "publicar");
  assert.equal(decideSite({ ...b, siteDe: "v0.84.0" }).acao, "nada", "site já acompanhou esta estável");
  assert.equal(decideSite({ ...b, siteDe: null }).acao, "marcar", "agente recém-instalado não publica o que não viu sair");
  assert.equal(decideSite({ ...b, mudouSite: false }).acao, "marcar", "conta-api igual: só anota a estável");
  assert.equal(decideSite({ ...b, falhouEm: b.agora - 60_000 }).acao, "nada", "falhou há 1 min: espera");
  assert.equal(decideSite({ ...b, falhouEm: b.agora - 3_600_000 }).acao, "publicar", "passou a espera: tenta de novo");
  assert.equal(decideSite({ ...b, ultimaEstavel: null }).acao, "nada");
});

test("site: conferência no ar por canal", () => {
  const ok = { "/": 200, "/obrigado": 200, "/robots.txt": 200, "/sitemap.xml": 200, "/llms.txt": 200 };
  const dl = { versao: "0.83.0", nome: "meu-bot-0.83.0-arm64.dmg", url: "https://x/y.dmg" };
  assert.deepEqual(faltasDoSite({ canal: "producao", health: { ok: true, canal: "producao" }, download: dl, paginas: ok }), []);
  assert.deepEqual(faltasDoSite({ canal: "staging", health: { ok: true, canal: "staging" }, download: { ...dl, versao: "0.84.0-staging.1" }, paginas: { "/": 200, "/obrigado": 200 } }), [], "staging não precisa de sitemap");
  assert.equal(faltasDoSite({ canal: "producao", health: { ok: true, canal: "staging" }, download: dl, paginas: ok }).length, 1, "canal trocado");
  assert.equal(faltasDoSite({ canal: "producao", health: { ok: true, canal: "producao" }, download: { ...dl, versao: "0.84.0-staging.1" }, paginas: ok }).length, 1, "produção nunca entrega staging");
  assert.equal(faltasDoSite({ canal: "producao", health: null, download: null, paginas: { ...ok, "/obrigado": 500 } }).length, 3);
});

test("site: só desfaz o deploy quando o próprio Worker respondeu errado", () => {
  const ok = { "/": 200, "/obrigado": 200, "/robots.txt": 200, "/sitemap.xml": 200, "/llms.txt": 200 };
  const semRede = { "/": 0, "/obrigado": 0, "/robots.txt": 0, "/sitemap.xml": 0, "/llms.txt": 0 };
  assert.equal(desfazDeploy({ canal: "producao", health: null, statusHealth: 0, paginas: semRede }), false, "Mac sem rede: não desfaz");
  assert.equal(desfazDeploy({ canal: "producao", health: { ok: true, canal: "producao" }, statusHealth: 200, paginas: ok }), false, "só o download (GitHub) falhou");
  assert.equal(desfazDeploy({ canal: "producao", health: { ok: true, canal: "staging" }, statusHealth: 200, paginas: ok }), true, "canal trocado");
  assert.equal(desfazDeploy({ canal: "producao", health: null, statusHealth: 500, paginas: ok }), true, "/health com erro");
  assert.equal(desfazDeploy({ canal: "staging", health: { ok: true, canal: "staging" }, statusHealth: 200, paginas: { "/": 200, "/obrigado": 500 } }), true, "página com erro");
  assert.equal(desfazDeploy({ canal: "staging", health: { ok: true, canal: "staging" }, statusHealth: 200, paginas: { "/": 200, "/obrigado": 0 } }), false);
});

test("plist do agente: parte do checkout principal, pelo node, e recria o worktree da release que sumiu", () => {
  const p = plistDoAgente({ rotulo: "com.x.agente", node: "/opt/n&d/bin/node", principal: "/Users/a/Desktop/meu-bot", wt: "/Users/a/Desktop/meu-bot-release", path: "/usr/bin:/bin", log: "/tmp/x.log" });
  assert.match(p, /<key>WorkingDirectory<\/key><string>\/Users\/a\/Desktop\/meu-bot<\/string>/, "nunca o worktree: se ele some, o launchd sai com 78");
  assert.match(p, /<array><string>\/opt\/n&amp;d\/bin\/node<\/string><string>-e<\/string>/, "node, não sh (permissão da Mesa); & escapado no XML");
  assert.doesNotMatch(p, /\/bin\/sh/);
  assert.match(p, /\["worktree", "add", "-q", "--detach", wt, "origin\/main"\]/);
  assert.match(p, /wt = "\/Users\/a\/Desktop\/meu-bot-release"/);
  // A partida é JavaScript válido depois de desfazer o XML.
  const js = /<string>-e<\/string><string>([\s\S]*?)<\/string><\/array>/.exec(p)[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  assert.doesNotThrow(() => new Function("require", "process", js));
});
