// Regras da release automática (scripts/release-auto.mjs): o que cada rodada do agente decide fazer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { commitNoAr, dataPorExtenso, decideRodada, decideSite, decideSiteStaging, desfazDeploy, dirDoEstado, estavelMaisNova, faltasDeConteudo, faltasDoSite, fecharChangelog, lerConfigJs, ordemDosAmbientes, plistDoAgente, podeAprovar, podePublicarProducao, podePublicarStaging, proximaBase, QUIETUDE_MS, saudeStaging, SOAK_MS, stagingMaisNovo, varsDoWrangler } from "../release-core.mjs";

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

test("site: estável nova com conta-api diferente só avisa (a produção não sai sozinha); a primeira rodada só anota", () => {
  const b = { ultimaEstavel: "v0.84.0", siteDe: "v0.83.0", mudouSite: true };
  assert.equal(decideSite(b).acao, "avisar");
  assert.equal(decideSite({ ...b, siteDe: "v0.84.0" }).acao, "nada", "esta estável já foi anotada: o aviso não se repete");
  assert.equal(decideSite({ ...b, siteDe: null }).acao, "marcar", "agente recém-instalado não avisa do que não viu sair");
  assert.equal(decideSite({ ...b, mudouSite: false }).acao, "marcar", "conta-api igual: só anota a estável");
  assert.equal(decideSite({ ...b, ultimaEstavel: null }).acao, "nada");
  for (const caso of [b, { ...b, siteDe: null }, { ...b, mudouSite: false }]) assert.notEqual(decideSite(caso).acao, "publicar", "nenhum caminho publica a produção");
});

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);

test("site: o staging acompanha a main quando conta-api mudou desde o commit que está lá", () => {
  const b = { main: B, stagingDe: A, mudouSite: true, falhouEm: null, agora: 10_000_000, esperaMs: 3_600_000 };
  assert.equal(decideSiteStaging(b).acao, "publicar");
  assert.equal(decideSiteStaging({ ...b, stagingDe: B }).acao, "nada", "staging já está na main");
  assert.equal(decideSiteStaging({ ...b, mudouSite: false }).acao, "nada", "a main andou sem mexer em conta-api");
  assert.equal(decideSiteStaging({ ...b, stagingDe: null, mudouSite: null }).acao, "publicar", "commit desconhecido (deploy antigo ou à mão): publica a main");
  assert.equal(decideSiteStaging({ ...b, mudouSite: null }).acao, "publicar", "não deu para comparar: não há prova de que o staging tem a main");
  assert.equal(decideSiteStaging({ ...b, falhouEm: b.agora - 60_000 }).acao, "nada", "falhou há 1 min: espera");
  assert.equal(decideSiteStaging({ ...b, stagingDe: null, falhouEm: b.agora - 60_000 }).acao, "nada", "a espera vale também com o commit desconhecido");
  assert.equal(decideSiteStaging({ ...b, falhouEm: b.agora - 3_600_000 }).acao, "publicar", "passou a espera: tenta de novo");
});

test("site: o commit no ar vem do /health; sem sha completo é desconhecido, não erro", () => {
  assert.equal(commitNoAr({ ok: true, canal: "staging", commit: A }), A);
  assert.equal(commitNoAr({ ok: true, canal: "producao", commit: null }), null, "deploy antigo ou à mão");
  assert.equal(commitNoAr({ ok: true, canal: "producao" }), null, "Worker de antes do portão");
  assert.equal(commitNoAr({ commit: "abc123" }), null, "sha curto não identifica o commit");
  assert.equal(commitNoAr(null), null, "sem resposta");
});

test("site: o staging só recebe o origin/main, nunca um ramo", () => {
  assert.deepEqual(podePublicarStaging({ head: A, main: A }), { ok: true });
  assert.match(podePublicarStaging({ head: B, main: A }).erro, new RegExp(`está no commit ${B}, e o origin/main é ${A}`), "diz os dois commits");
  assert.match(podePublicarStaging({ head: B, main: A }).erro, /abra a PR e mescle/, "diz o caminho certo");
  assert.match(podePublicarStaging({ head: A, main: null }).erro, /não sei qual commit é o origin\/main/, "main desconhecida não prova nada");
  assert.match(podePublicarStaging({ head: A, main: "lixo" }).erro, /não sei qual commit é o origin\/main/);
  assert.match(podePublicarStaging({ head: null, main: A }).erro, /não consegui ler o commit deste worktree/);
  assert.match(podePublicarStaging({ head: A, main: A, atualizada: false }).erro, /git fetch origin falhou/, "sem fetch, o origin/main local pode ser velho");
  for (const caso of [{ head: B, main: A }, { head: A, main: null }, { head: null, main: A }, { head: null, main: null }, { head: A, main: A, atualizada: false }]) assert.equal(podePublicarStaging(caso).ok, undefined);
});

test("site: só se aprova o commit que está no staging", () => {
  assert.deepEqual(podeAprovar({ sha: A, commitStaging: A }), { ok: true });
  assert.match(podeAprovar({ sha: A, commitStaging: B }).erro, new RegExp(`staging está no commit ${B}`), "diz qual está lá");
  assert.match(podeAprovar({ sha: A, commitStaging: null }).erro, /não diz qual commit/);
  assert.match(podeAprovar({ sha: A.slice(0, 12), commitStaging: A }).erro, /commit inteiro/);
  assert.match(podeAprovar({ sha: null, commitStaging: A }).erro, /commit inteiro/);
});

test("site: a produção só recebe o commit aprovado, que é o do staging e o do worktree", () => {
  const b = { aprovado: A, head: A, commitStaging: A, limpo: true, naMain: true };
  assert.deepEqual(podePublicarProducao(b), { ok: true });
  assert.match(podePublicarProducao({ ...b, aprovado: null }).erro, /não há aprovação/);
  assert.match(podePublicarProducao({ ...b, aprovado: "lixo" }).erro, /não há aprovação/, "aprovação ilegível não vale");
  assert.match(podePublicarProducao({ ...b, head: B }).erro, new RegExp(`aprovado é ${A}, e este worktree está em ${B}`));
  assert.match(podePublicarProducao({ ...b, head: null }).erro, /este worktree está em/);
  assert.match(podePublicarProducao({ ...b, commitStaging: C }).erro, new RegExp(`staging andou: está no commit ${C}`));
  assert.match(podePublicarProducao({ ...b, commitStaging: null }).erro, /não diz qual commit/, "staging desconhecido não prova nada");
  assert.match(podePublicarProducao({ ...b, limpo: false }).erro, /mudanças fora do commit/);
  assert.match(podePublicarProducao({ ...b, naMain: false }).erro, /não está no origin\/main/);
  for (const caso of [{ ...b, aprovado: null }, { ...b, head: B }, { ...b, commitStaging: C }, { ...b, commitStaging: null }, { ...b, limpo: false }, { ...b, naMain: false }]) assert.equal(podePublicarProducao(caso).ok, undefined);
});

test("site: a produção tem de ser um ancestral do staging; commit desconhecido não é erro", () => {
  assert.equal(ordemDosAmbientes({ staging: B, producao: A, ancestral: true }).ok, true);
  assert.equal(ordemDosAmbientes({ staging: A, producao: A }).ok, true, "mesmo commit");
  const fora = ordemDosAmbientes({ staging: B, producao: A, ancestral: false });
  assert.equal(fora.ok, false); assert.match(fora.texto, /NÃO é um ancestral/);
  assert.equal(ordemDosAmbientes({ staging: B, producao: null }).ok, null, "produção de antes do portão");
  assert.equal(ordemDosAmbientes({ staging: null, producao: A }).ok, null);
  assert.equal(ordemDosAmbientes({ staging: B, producao: A, ancestral: null }).ok, null, "o git não conhece um dos commits");
});

test("site: a pasta de estado é uma só para o agente e para a aprovação", () => {
  assert.equal(dirDoEstado({ env: {}, home: "/Users/a" }), "/Users/a/Library/Application Support/meu-bot-release");
  assert.equal(dirDoEstado({ env: { MEU_BOT_RELEASE_DIR: "/tmp/x" }, home: "/Users/a" }), "/tmp/x");
});

test("site: as vars de cada ambiente saem do wrangler.toml (produção em [vars], staging em [env.staging.vars])", () => {
  const v = varsDoWrangler('name = "x"\n[vars]\nCANAL = "producao"\n# comentário\nJ = \'{"a":{"b":1}}\'\nN = 3 # resto\n[[routes]]\npattern = "p"\n[env.staging]\nname = "y"\n[env.staging.vars]\nCANAL = "staging"\nASPAS = "a \\"b\\" # c"\n');
  assert.deepEqual(v, { producao: { CANAL: "producao", J: '{"a":{"b":1}}', N: "3" }, staging: { CANAL: "staging", ASPAS: 'a "b" # c' } });
  const real = varsDoWrangler(readFileSync(new URL("../../conta-api/wrangler.toml", import.meta.url), "utf8"));
  assert.equal(real.producao.CANAL, "producao"); assert.equal(real.staging.CANAL, "staging");
  assert.equal(real.producao.COMMIT, undefined, "o commit entra no deploy, não fica no wrangler.toml");
  assert.equal(real.staging.COMMIT, undefined);
});

test("site: conferência de conteúdo (teste grátis, canal e medição do ambiente, commit do deploy)", () => {
  const home = { status: 200, texto: "<p>3 dias grátis, sem cartão</p><p>teste: 3 dias grátis</p>" };
  const cfg = (o) => ({ status: 200, texto: `window.MEU_BOT_CONTA = ${JSON.stringify(o)};\n` });
  const b = { canal: "staging", home, configJs: cfg({ console: "https://c", canal: "staging", ga: "G-STAGING01" }), health: { ok: true, canal: "staging", commit: A }, esperado: { trialDias: "3", ga: "G-STAGING01", commit: A } };
  assert.deepEqual(faltasDeConteudo(b), { faltas: [], desfazer: false });
  const dias = faltasDeConteudo({ ...b, home: { status: 200, texto: "14 dias grátis" } });
  assert.match(dias.faltas[0], /diz 14 dias grátis; o TRIAL_DIAS deste ambiente é 3/); assert.equal(dias.desfazer, true);
  assert.match(faltasDeConteudo({ ...b, home: { status: 200, texto: "sem menção" } }).faltas[0], /não cita o teste grátis/);
  assert.deepEqual(faltasDeConteudo({ ...b, home: { status: 0, texto: "" } }), { faltas: [], desfazer: false }, "home sem resposta já é falta do básico (faltasDoSite)");
  const canal = faltasDeConteudo({ ...b, configJs: cfg({ canal: "producao", ga: "G-STAGING01" }) });
  assert.match(canal.faltas[0], /canal "producao", esperado "staging"/); assert.equal(canal.desfazer, true);
  const ga = faltasDeConteudo({ ...b, configJs: cfg({ canal: "staging", ga: "G-PRODUCAO01" }) });
  assert.match(ga.faltas[0], /medição "G-PRODUCAO01", esperado "G-STAGING01"/); assert.equal(ga.desfazer, true);
  assert.deepEqual(faltasDeConteudo({ ...b, configJs: cfg({ canal: "staging", ga: "" }), esperado: { ...b.esperado, ga: "" } }).faltas, [], "ambiente sem medição");
  assert.deepEqual(faltasDeConteudo({ ...b, configJs: { status: 0, texto: "" } }), { faltas: ["/config.js do site respondeu nada"], desfazer: false }, "sem rede não desfaz");
  assert.equal(faltasDeConteudo({ ...b, configJs: { status: 500, texto: "" } }).desfazer, true);
  assert.equal(faltasDeConteudo({ ...b, configJs: { status: 200, texto: "<html>" } }).desfazer, true);
  const semCommit = faltasDeConteudo({ ...b, health: { ok: true, canal: "staging", commit: null } });
  assert.match(semCommit.faltas[0], new RegExp(`commit desconhecido, esperado ${A}`)); assert.equal(semCommit.desfazer, false, "só o commit faltando não desfaz o deploy");
  assert.match(faltasDeConteudo({ ...b, health: { ok: true, canal: "staging", commit: B } }).faltas[0], new RegExp(`commit ${B}, esperado ${A}`));
  // --conferir avulso: sem commit esperado, a produção de antes do portão (commit null) não é falta.
  assert.deepEqual(faltasDeConteudo({ ...b, health: { ok: true, canal: "staging" }, esperado: { trialDias: "3", ga: "G-STAGING01" } }).faltas, []);
  assert.equal(lerConfigJs("window.MEU_BOT_CONTA = {\"canal\":\"staging\"};\n").canal, "staging");
  assert.equal(lerConfigJs("alert(1)"), null);
});

test("site: a home deste commit passa na conferência de conteúdo com o TRIAL_DIAS dos dois ambientes", () => {
  const vars = varsDoWrangler(readFileSync(new URL("../../conta-api/wrangler.toml", import.meta.url), "utf8"));
  const home = { status: 200, texto: readFileSync(new URL("../../conta-api/public/site/index.html", import.meta.url), "utf8") };
  for (const canal of ["staging", "producao"]) {
    const r = faltasDeConteudo({ canal, home, configJs: { status: 200, texto: `window.MEU_BOT_CONTA = ${JSON.stringify({ canal, ga: vars[canal].GA_ID })};` }, health: null, esperado: { trialDias: vars[canal].TRIAL_DIAS, ga: vars[canal].GA_ID } });
    assert.deepEqual(r.faltas, [], canal);
  }
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
