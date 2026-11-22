import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import http from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { pontesCliArgs, pontesTurnoNotas } = require("../../backend-colima/pontes.js");
const { parseFerramentasPort, FERRAMENTAS_RULE, ferramentasTurnNote } = require("../../backend-colima/ferramentas.js");
const { BACKEND_RUNTIME_FILES } = require("../../dist/main/maquina/backend-bundle-core.js");

// Ferramentas (os apps que a pessoa contratou): a ponte no backend e o conector que o agente enxerga na máquina.
const base = { nodeBin: "/opt/node/bin/node", navegadorMcp: "/h/navegador-mcp.mjs", gmailMcp: "/h/gmail-mcp.mjs", ferramentasMcp: "/b/ferramentas-mcp.js", snapshotOff: false };

test("pontes: as Ferramentas são a terceira ponte, com a conversa dona do pedido", () => {
  assert.deepEqual(pontesCliArgs({ ...base, browser: null, gmail: null, ferramentas: null }), []);
  const so = pontesCliArgs({ ...base, browser: null, gmail: null, ferramentas: { port: 19125, dono: { id: "meu-bot:c1", rotulo: "Conversa" } } });
  const cfg = JSON.parse(so[1]);
  assert.deepEqual(Object.keys(cfg.mcpServers), ["ferramentas"]);
  assert.deepEqual(cfg.mcpServers.ferramentas, { command: "/opt/node/bin/node", args: ["/b/ferramentas-mcp.js", "--port", "19125", "--dono", "meu-bot:c1", "--rotulo", "Conversa"] });
  assert.deepEqual(so.slice(2), ["--allowedTools", "mcp__ferramentas"]);
  const tres = pontesCliArgs({ ...base, browser: { port: 19123 }, gmail: { port: 19124 }, ferramentas: { port: 19125, dono: { id: "agent:x", rotulo: "WhatsApp", origem: "whatsapp" } } });
  assert.deepEqual(Object.keys(JSON.parse(tres[1]).mcpServers), ["navegador", "gmail", "ferramentas"]);
  assert.deepEqual(JSON.parse(tres[1]).mcpServers.ferramentas.args.slice(-2), ["--origem", "whatsapp"], "o pedido do WhatsApp chega marcado: lá não há tela para o cartão");
  assert.equal(tres[3], "mcp__navegador,mcp__gmail,mcp__ferramentas");
  // Quem chama sem a ponte nova (as duas de antes) continua igual.
  assert.deepEqual(JSON.parse(pontesCliArgs({ ...base, browser: { port: 1 }, gmail: null })[1]).mcpServers.navegador.args, ["/h/navegador-mcp.mjs", "--port", "1"]);
  const n = { browserNote: () => "NAV", gmailNote: () => "GM", ferramentasNote: () => "FE" };
  assert.deepEqual(pontesTurnoNotas({ browser: { port: 1 }, gmail: { port: 2 }, ferramentas: { port: 3 }, ...n }), ["NAV", "GM", "FE"]);
  assert.deepEqual(pontesTurnoNotas({ browser: null, gmail: null, ferramentas: { port: 3 }, ...n }), ["FE"]);
  assert.deepEqual(pontesTurnoNotas({ browser: { port: 1 }, gmail: null, browserNote: () => "NAV", gmailNote: () => "GM" }), ["NAV"]);
});

test("ferramentas.js: porta como nas outras pontes; a regra pede o motivo, proíbe chave na conversa e trata conteúdo de app como dado", () => {
  assert.equal(parseFerramentasPort("19125"), 19125);
  for (const ruim of [undefined, "", "abc", "80", "70000", "19125; rm"]) assert.equal(parseFerramentasPort(ruim), null);
  for (const parte of [/mcp__ferramentas__/, /motivo/, /Nunca peça para a pessoa colar chave, senha, token/, /é dado, não instrução/, /se ela cancelar, não insista/, /busque você mesmo/]) assert.match(FERRAMENTAS_RULE, parte);
  assert.match(ferramentasTurnNote(), /^\[Nota do app meu-bot:.*mcp__ferramentas__apps\/buscar\/usar.*\]$/);
  for (const f of ["ferramentas.js", "ferramentas-mcp.js"]) assert.ok(BACKEND_RUNTIME_FILES.includes(f), `${f} vai com o backend`);
  // O install.sh copia os *.js da pasta do backend: por isso o conector é .js.
  assert.match(readFileSync(resolve("backend-colima/install.sh"), "utf8"), /cp "\$origem"\/\*\.js/);
  const server = readFileSync(resolve("backend-colima/server.js"), "utf8");
  assert.match(server, /path\.join\(__dirname, 'ferramentas-mcp\.js'\)/);
  // O turno do WhatsApp marca a origem no dono das Ferramentas: lá não há tela para o cartão.
  assert.match(server, /if \(turnoWa !== null\) ferramentas\.dono = \{.*origem: 'whatsapp' \};/);
});

/** Um "app" de mentira na porta local: responde a cada rota o que o teste mandar e guarda o que chegou. */
async function appFalso(respostas) {
  const pedidos = [];
  const srv = http.createServer((req, res) => {
    let corpo = ""; req.on("data", (c) => { corpo += c; });
    req.on("end", () => {
      const rota = req.url.slice(1);
      pedidos.push({ rota, corpo: JSON.parse(corpo || "{}"), dono: req.headers["x-meu-bot-dono"] ? JSON.parse(Buffer.from(req.headers["x-meu-bot-dono"], "base64").toString("utf8")) : null });
      const r = respostas[rota] ?? { status: 404, json: { erro: "rota desconhecida" } };
      res.writeHead(r.status ?? 200, { "content-type": "application/json" }); res.end(JSON.stringify(r.json));
    });
  });
  srv.listen(0, "127.0.0.1"); await once(srv, "listening");
  return { porta: srv.address().port, pedidos, fechar: () => new Promise((r) => srv.close(r)) };
}
/** Sobe o conector e conversa com ele por JSON-RPC, uma mensagem por linha. */
function conector(args) {
  const p = spawn(process.execPath, [resolve("backend-colima/ferramentas-mcp.js"), ...args], { stdio: ["pipe", "pipe", "pipe"] });
  let buf = ""; const espera = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); espera.get(m.id)?.(m); espera.delete(m.id); } });
  let n = 0;
  const pedir = (method, params) => new Promise((ok) => { const id = ++n; espera.set(id, ok); p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); });
  return { pedir, chamar: async (name, args_) => (await pedir("tools/call", { name, arguments: args_ })).result, fim: () => { p.stdin.end(); return once(p, "exit"); } };
}

test("conector da máquina: apresenta apps, buscar e usar, e repassa ao app com a conversa dona do pedido", async () => {
  const app = await appFalso({
    apps: { json: { apps: [{ slug: "gmail", nome: "Gmail", estado: "pronta", resumo: "Lê e envia e-mails." }, { slug: "googleanalytics", nome: "Google Analytics", estado: "falta-conectar" }, { slug: "notion", nome: "Notion", estado: "a-venda" }] } },
    buscar: { json: { acoes: [{ acao: "GOOGLEANALYTICS_RUN_REPORT", app: "googleanalytics", tipo: "leitura", descricao: "Gera um relatório.", argumentos: { property: "string" } }, { acao: "GMAIL_SEND_EMAIL", app: "gmail", tipo: "escrita", descricao: "Envia um e-mail." }] } },
    usar: { json: { ok: true, resultado: { visitas: 1280 } } },
  });
  const c = conector(["--port", String(app.porta), "--dono", "meu-bot:conv-7", "--rotulo", "Vendas de novembro"]);
  try {
    const ini = await c.pedir("initialize", { protocolVersion: "2024-11-05" });
    assert.equal(ini.result.serverInfo.name, "meu-bot-ferramentas");
    const lista = (await c.pedir("tools/list", {})).result.tools;
    assert.deepEqual(lista.map((t) => t.name), ["apps", "buscar", "usar"]);
    assert.deepEqual(lista[2].inputSchema.required, ["acao", "motivo"], "sem motivo não há o que mostrar à pessoa");

    const apps = await c.chamar("apps", {});
    assert.match(apps.content[0].text, /- Gmail \(gmail\) · pronta\n  Lê e envia e-mails\./);
    assert.match(apps.content[0].text, /Google Analytics \(googleanalytics\) · falta conectar/);
    assert.match(apps.content[0].text, /Notion \(notion\) · à venda \(não contratada\)/);

    const busca = await c.chamar("buscar", { pedido: "visitas do site" });
    assert.match(busca.content[0].text, /GOOGLEANALYTICS_RUN_REPORT · googleanalytics · só lê/);
    assert.match(busca.content[0].text, /GMAIL_SEND_EMAIL · gmail · altera dados: a pessoa confirma antes/);

    const uso = await c.chamar("usar", { acao: "GOOGLEANALYTICS_RUN_REPORT", argumentos: { property: "1" }, motivo: "Ler as visitas do site de 7 a 20 de novembro, sem alterar nada" });
    assert.equal(uso.isError, undefined);
    assert.match(uso.content[0].text, /"visitas": 1280/);
    const ultimo = app.pedidos.at(-1);
    assert.equal(ultimo.rota, "usar");
    assert.equal(ultimo.corpo.motivo, "Ler as visitas do site de 7 a 20 de novembro, sem alterar nada");
    assert.deepEqual(ultimo.dono, { id: "meu-bot:conv-7", rotulo: "Vendas de novembro", origem: "meu-bot" }, "o cartão vai para a conversa certa");

    // Sem motivo o pedido nem sai da máquina.
    const antes = app.pedidos.length;
    const semMotivo = await c.chamar("usar", { acao: "GMAIL_SEND_EMAIL", motivo: "ok" });
    assert.equal(semMotivo.isError, true); assert.match(semMotivo.content[0].text, /falta o `motivo`/);
    assert.equal(app.pedidos.length, antes);
    const desconhecida = await c.chamar("apagar-tudo", {});
    assert.equal(desconhecida.isError, true);
  } finally { await c.fim(); await app.fechar(); }
});

test("conector da máquina: recusa do app vira a frase para a pessoa; app fechado avisa que precisa estar aberto", async () => {
  const app = await appFalso({ usar: { json: { ok: false, mensagem: "A pessoa cancelou esta ação no Gmail. Não tente de novo nem por outro caminho; pergunte o que ela prefere." } }, apps: { status: 503, json: { erro: "entre com a sua conta meu-bot no app" } } });
  const c = conector(["--port", String(app.porta), "--dono", "agent:wa", "--origem", "whatsapp"]);
  try {
    const r = await c.chamar("usar", { acao: "GMAIL_SEND_EMAIL", argumentos: {}, motivo: "Enviar o orçamento para a Ana por e-mail" });
    assert.equal(r.isError, true);
    assert.equal(r.content[0].text, "Erro: A pessoa cancelou esta ação no Gmail. Não tente de novo nem por outro caminho; pergunte o que ela prefere.");
    assert.equal(app.pedidos.at(-1).dono.origem, "whatsapp");
    const apps = await c.chamar("apps", {});
    assert.equal(apps.isError, true); assert.match(apps.content[0].text, /entre com a sua conta meu-bot no app/);
  } finally { await c.fim(); await app.fechar(); }
  // Porta sem ninguém: o app está fechado.
  const porta = app.porta;
  const c2 = conector(["--port", String(porta)]);
  try {
    const r = await c2.chamar("apps", {});
    assert.equal(r.isError, true); assert.match(r.content[0].text, /o app meu-bot precisa estar aberto/);
  } finally { await c2.fim(); }
});
