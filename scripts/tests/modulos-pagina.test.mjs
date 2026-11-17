import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const P = require("../../dist/main/modulos/modulos-pagina-core.js");
const core = require("../../dist/main/modulos/modulos-core.js");

const base = (pagina) => ({ produto: "meu-bot-finance", modulos: [{ id: "financas", versao: "1.0.0", pagina }] });

test("pagina no manifesto: opcional, validada, e uma página ruim derruba o manifesto com a frase", () => {
  assert.equal(core.parseManifesto(base(undefined)).modulos[0].pagina, null);
  assert.deepEqual(core.parseManifesto(base({ rotulo: "Finanças", porta: 8795 })).modulos[0].pagina, { rotulo: "Finanças", porta: 8795, caminho: "/" });
  assert.deepEqual(core.parseManifesto(base({ rotulo: "Finanças", porta: 8795, caminho: "/app/" })).modulos[0].pagina.caminho, "/app/");
  for (const ruim of [{ porta: 8795 }, { rotulo: "x", porta: 80 }, { rotulo: "x", porta: 70000 }, { rotulo: "x", porta: "8795" }, { rotulo: "x", porta: 8795, caminho: "app" }, { rotulo: "x", porta: 8795, caminho: "/../etc" }, { rotulo: "x", porta: 8795, caminho: "/a?b=1" }, { rotulo: "x", porta: 8795, caminho: "//evil.com" }, "x", []]) {
    assert.throws(() => core.parseManifesto(base(ruim)), /pagina/, JSON.stringify(ruim));
  }
});

test("partição e origem: uma partição por módulo e máquina; só a origem do forward passa", () => {
  assert.equal(P.particaoModulo("financas", "agente box"), "modulo-financas-agente_box");
  assert.notEqual(P.particaoModulo("financas", "a"), P.particaoModulo("financas", "b"));
  const o = P.origemForward(51234);
  assert.equal(P.urlPagina(51234, "/app/", "abc"), "http://127.0.0.1:51234/app/?token=abc");
  assert.equal(P.urlNaOrigem("http://127.0.0.1:51234/qualquer?x=1", o), true);
  for (const u of ["http://127.0.0.1:51235/", "https://127.0.0.1:51234/", "http://localhost:51234/", "http://127.0.0.1:51234@evil.com/", "javascript:alert(1)", "file:///etc/passwd", "lixo"]) assert.equal(P.urlNaOrigem(u, o), false, u);
});

test("status da página: lê token e se o serviço responde; token fora do formato vira null", () => {
  const t = "a".repeat(48);
  assert.deepEqual(P.parsePaginaStatus(`motd\npagina token=${t} rodando=1\n`), { token: t, rodando: true });
  assert.deepEqual(P.parsePaginaStatus("pagina token=- rodando=0"), { token: null, rodando: false });
  assert.deepEqual(P.parsePaginaStatus("pagina token=curto rodando=1"), { token: null, rodando: true });
  assert.equal(P.parsePaginaStatus("nada"), null);
  assert.throws(() => P.paginaStatusSh("../x", 8795));
  assert.throws(() => P.paginaStatusSh("financas", 80));
  assert.throws(() => P.tokenSh("Fin"));
});

test("token na máquina: criado uma vez, 0600, exportado ao instalador; o status o lê e vê a porta no ar", async () => {
  const HOME = mkdtempSync(join(tmpdir(), "pagina-"));
  const env = { ...process.env, HOME };
  const run = (sh) => spawnSync("bash", ["-c", sh], { env, encoding: "utf8" });
  const a = run(`${P.tokenSh("financas")} && echo "arq=$MODULO_PAGINA_TOKEN"`);
  assert.equal(a.status, 0, a.stderr);
  const arq = join(HOME, ".local/share/meu-bot/modulos/financas/pagina.token");
  assert.equal(a.stdout.trim(), `arq=${arq}`);
  const tok = readFileSync(arq, "utf8");
  assert.match(tok, /^[A-Za-z0-9]{48}$/);
  assert.equal(statSync(arq).mode & 0o777, 0o600);
  run(P.tokenSh("financas"));
  assert.equal(readFileSync(arq, "utf8"), tok, "religar não troca o token");
  const srv = createServer().listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const porta = srv.address().port;
  try {
    const st = P.parsePaginaStatus(run(P.paginaStatusSh("financas", porta < 1024 ? 1024 : porta)).stdout);
    assert.deepEqual(st, { token: tok, rodando: true });
  } finally { srv.close(); }
  const parado = P.parsePaginaStatus(run(P.paginaStatusSh("financas", porta)).stdout);
  assert.equal(parado.rodando, false);
});

test("ações da página: só /__meu-bot/acao na origem do forward, só chat com texto; o resto é recusado", () => {
  const o = P.origemForward(51234);
  assert.deepEqual(P.lerAcao(`${o}/__meu-bot/acao?acao=chat&texto=quanto%20gastei%3F`, o), { acao: "chat", texto: "quanto gastei?" });
  assert.equal(P.lerAcao(`${o}/__meu-bot/acao?acao=chat&texto=${"a".repeat(900)}`, o).texto.length, 500, "corta em 500");
  assert.equal(P.lerAcao(`${o}/__meu-bot/acao?acao=chat&texto=a%0Ab`, o).texto, "a b", "sem quebra de linha nem controle");
  for (const u of [`${o}/__meu-bot/acao?acao=chat&texto=`, `${o}/__meu-bot/acao?acao=enviar&texto=x`, `${o}/__meu-bot/acao?acao=planilha&link=x`, `${o}/outra?acao=chat&texto=x`, `http://127.0.0.1:9/__meu-bot/acao?acao=chat&texto=x`, `https://evil.com/__meu-bot/acao?acao=chat&texto=x`, "lixo"]) assert.equal(P.lerAcao(u, o), null, u);
});

test("ação planilha: link, aba e tipo validados; a resposta do módulo vira texto puro cortado", () => {
  const o = P.origemForward(51234);
  const L = encodeURIComponent("https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz123/edit");
  assert.deepEqual(P.lerAcao(`${o}/__meu-bot/acao?acao=planilha&link=${L}&aba=Vendas&tipo=venda`, o), { acao: "planilha", link: decodeURIComponent(L), aba: "Vendas", tipo: "venda" });
  assert.equal(P.lerAcao(`${o}/__meu-bot/acao?acao=planilha&link=${L}&tipo=VENDA`, o), null, "tipo fora do formato");
  assert.equal(P.lerAcao(`${o}/__meu-bot/acao?acao=planilha&link=&tipo=venda`, o), null, "sem link");
  assert.equal(P.lerAcao(`http://127.0.0.1:9/__meu-bot/acao?acao=planilha&link=${L}&tipo=venda`, o), null, "outra origem");
  assert.deepEqual(P.lerRespostaPlanilha({ mensagem: " ok ", linhas: ["a", 3, "b"], podeImportar: true }), { mensagem: "ok", linhas: ["a", "b"], podeImportar: true });
  assert.equal(P.lerRespostaPlanilha({ mensagem: "x".repeat(900) }).mensagem.length, 600);
  assert.equal(P.lerRespostaPlanilha({ mensagem: "x", podeImportar: "sim" }).podeImportar, false);
  for (const ruim of [null, "texto", {}, { mensagem: "" }, { mensagem: 3 }]) assert.equal(P.lerRespostaPlanilha(ruim), null, JSON.stringify(ruim));
});

test("idDaPlanilha: o link do Google Sheets ou o id colado; o resto não é planilha", () => {
  const { idDaPlanilha } = require("../../dist/main/google/planilha-core.js");
  const id = "1AbC_dEf-GhIjKlMnOpQrStUvWxYz0123456789";
  assert.equal(idDaPlanilha(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id);
  assert.equal(idDaPlanilha(`  https://docs.google.com/spreadsheets/d/${id}  `), id, "espaços em volta saem");
  assert.equal(idDaPlanilha(id), id, "o id colado puro vale");
  for (const ruim of ["", "planilha de vendas", "https://docs.google.com/document/d/abc", "https://docs.google.com/spreadsheets/d/curto/edit", "https://exemplo.com/planilha", "id com espaço 1234567890123456789012345"]) assert.equal(idDaPlanilha(ruim), null, ruim);
});

test("auditoria: a prévia da planilha e a importação têm cada uma o seu texto", () => {
  const { textoDaLinha } = require("../../dist/main/auditoria/auditoria-core.js");
  assert.equal(textoDaLinha({ acao: "modulo.planilha-previa", alvo: "financas", detalhe: "" }), "leu uma planilha do Google para a prévia do módulo financas");
  assert.equal(textoDaLinha({ acao: "modulo.planilha", alvo: "financas", detalhe: "" }), "importou uma planilha do Google no módulo financas");
});

test("fraseSemRespostaDoModulo: tempo esgotado, redirecionamento barrado e sem conexão dizem coisas diferentes (com o fetch de verdade)", async () => {
  const http = require("node:http");
  const srv = http.createServer((req, res) => { if (req.url === "/redir") { res.writeHead(302, { location: "http://127.0.0.1:1/x" }); res.end(); } /* /lento nunca responde */ });
  const porta = await new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv.address().port)));
  const erroDe = async (url, ms) => { try { await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(ms) }); return null; } catch (e) { return e; } };
  try {
    assert.match(P.fraseSemRespostaDoModulo(await erroDe(`http://127.0.0.1:${porta}/redir`, 2000)), /tentou redirecionar/);
    assert.match(P.fraseSemRespostaDoModulo(await erroDe(`http://127.0.0.1:${porta}/lento`, 200)), /demorou mais de 60 s/);
  } finally { srv.closeAllConnections(); await new Promise((ok) => srv.close(ok)); }
  // Porta fechada (o servidor acabou de sair): sem conexão.
  assert.match(P.fraseSemRespostaDoModulo(await erroDe(`http://127.0.0.1:${porta}/x`, 2000)), /não respondeu \(o serviço parou ou o túnel caiu\)/);
  assert.match(P.fraseSemRespostaDoModulo("qualquer coisa"), /não respondeu/);
});

