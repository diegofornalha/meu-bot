import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { FERRAMENTAS, FERRAMENTAS_EXECUCAO, PAGINAS_APP, VERSAO_PROTOCOLO, ferramenta, ferramentasVisiveis, negociarVersao, roteador, donoDe, pedidoOk, responderJsonRpc, gerarToken, isToken, isPortaMcp, configClaudeCode, configCursor, urlMcp, erroRpc, entradaMcp, deeplinkCursor, estadoCliente, isClienteMcp } = req("../../dist/main/controle-remoto/controle-remoto-core.js");
const { PRODUTOS } = req("../../dist/main/app/variant-core.js");
const { normalizeSettings, defaultSettings } = req("../../dist/main/app/settings-normalize.js");

const TOKEN = "a".repeat(64);
const okReq = (extra = {}) => ({ method: "POST", url: "/mcp", headers: { host: "127.0.0.1:7830", authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...extra } });
const INFO = { nome: "meu-bot", versao: "1.2.3", execucao: true };

test("catálogo: as ferramentas do app-mcp (menos apps/app_abrir) mais as do app; cada uma com schema e anotações", () => {
  const nomes = FERRAMENTAS.map((f) => f.name);
  for (const n of ["terminais", "terminal_abrir", "terminal_ler", "terminal_digitar", "terminal_fechar", "tela_dividir", "tela_juntar", "nav_abas", "nav_abrir", "nav_ler", "nav_clicar", "nav_digitar", "nav_tecla", "nav_print", "nav_recarregar", "nav_voltar", "nav_js", "nav_fechar", "nota", "depuracao", "app", "janela_abrir", "pagina_abrir", "tema", "print_janela"]) assert.ok(nomes.includes(n), `falta ${n}`);
  assert.ok(!nomes.includes("apps") && !nomes.includes("app_abrir"), "de dentro do app não se abre outro app");
  assert.equal(new Set(nomes).size, nomes.length, "nome repetido");
  for (const f of FERRAMENTAS) { assert.equal(f.inputSchema.type, "object"); assert.equal(typeof f.annotations.readOnlyHint, "boolean"); assert.ok(f.description.length > 10); assert.equal("outputSchema" in f, false, "sem outputSchema o resultado vai só como texto"); }
  assert.equal(ferramenta("nav_fechar").annotations.destructiveHint, true);
  assert.equal(ferramenta("terminal_digitar").annotations.destructiveHint, true, "rodar um comando no shell da pessoa é destrutivo para o cliente pedir confirmação");
  assert.equal(ferramenta("nav_js").annotations.destructiveHint, true);
  assert.equal(ferramenta("nav_clicar").annotations.destructiveHint, false);
  assert.equal(ferramenta("terminais").annotations.readOnlyHint, true);
  assert.deepEqual(ferramenta("pagina_abrir").inputSchema.properties.pagina.enum, [...PAGINAS_APP]);
});

test("execução arbitrária (terminal_digitar, nav_js) só aparece com o interruptor ligado", () => {
  assert.deepEqual([...FERRAMENTAS_EXECUCAO], ["terminal_digitar", "nav_js"]);
  const sem = ferramentasVisiveis(false).map((f) => f.name);
  assert.ok(!sem.includes("terminal_digitar") && !sem.includes("nav_js"));
  assert.ok(sem.includes("terminal_ler") && sem.includes("nav_clicar") && sem.includes("nav_digitar"), "ler, clicar e digitar em campos continuam");
  assert.equal(ferramentasVisiveis(true).length, FERRAMENTAS.length);
});

test("roteador: tudo vai para um socket do app (terminal, com as rotas do app, ou Navegador); desconhecida lança", () => {
  assert.deepEqual(roteador("terminais", {}), { alvo: "terminal", rota: "terminais" });
  assert.deepEqual(roteador("terminal_abrir", { maquina: "colima" }), { alvo: "terminal", rota: "abrir", corpo: { maquina: "colima" } });
  assert.deepEqual(roteador("terminal_abrir", {}), { alvo: "terminal", rota: "abrir", corpo: {} });
  assert.deepEqual(roteador("terminal_ler", { id: "t1", linhas: 20 }), { alvo: "terminal", rota: "ler", corpo: { id: "t1", linhas: 20 } });
  assert.deepEqual(roteador("terminal_fechar", { id: "t1", maquina: "x" }), { alvo: "terminal", rota: "fechar", corpo: { id: "t1" } });
  assert.equal(ferramenta("terminal_fechar").annotations.destructiveHint, true);
  assert.deepEqual(roteador("tela_dividir", { pagina: "navegador", maquina: "colima" }), { alvo: "terminal", rota: "dividir", corpo: { pagina: "navegador", maquina: "colima" } });
  assert.deepEqual(roteador("nota", { texto: "oi", maquina: "x" }), { alvo: "terminal", rota: "nota", corpo: { texto: "oi" } });
  assert.deepEqual(roteador("depuracao", { on: null }), { alvo: "terminal", rota: "depuracao", corpo: { on: null } });
  assert.deepEqual(roteador("depuracao", {}), { alvo: "terminal", rota: "depuracao", corpo: {} });
  // as do app: rotas /app, /janela, /pagina, /tema, /print do term.sock (as mesmas do scripts/app-mcp.mjs)
  assert.deepEqual(roteador("app", {}), { alvo: "terminal", rota: "app", corpo: {} });
  assert.deepEqual(roteador("janela_abrir", { maquina: "colima" }), { alvo: "terminal", rota: "janela", corpo: { maquina: "colima" } });
  assert.deepEqual(roteador("pagina_abrir", { pagina: "gmail", maquina: "colima" }), { alvo: "terminal", rota: "pagina", corpo: { pagina: "gmail", maquina: "colima" } });
  assert.deepEqual(roteador("tema", { tema: "dark" }), { alvo: "terminal", rota: "tema", corpo: { tema: "dark" } });
  assert.deepEqual(roteador("print_janela", {}), { alvo: "terminal", rota: "print", corpo: {} });
  assert.deepEqual(roteador("nav_abas", {}), { alvo: "navegador", rota: "abas" });
  assert.deepEqual(roteador("nav_abas", { maquina: "colima" }), { alvo: "navegador", rota: "abas", maquina: "colima" });
  assert.deepEqual(roteador("nav_abrir", { url: "https://x", nova: true, maquina: "colima" }), { alvo: "navegador", rota: "abrir", corpo: { url: "https://x", nova: true }, maquina: "colima" });
  assert.deepEqual(roteador("nav_print", { aba: 5 }), { alvo: "navegador", rota: "print", corpo: { aba: 5 } });
  assert.throws(() => roteador("inexistente", {}), /desconhecida/);
});

test("donoDe: sem nome vira Cliente MCP; com nome, o nome limpo vira selo", () => {
  assert.deepEqual(donoDe(undefined), { id: "mcp:cliente", rotulo: "Cliente MCP (Mac)", origem: "claude-code" });
  assert.deepEqual(donoDe("Cursor"), { id: "mcp:cursor", rotulo: "Cursor (MCP)", origem: "claude-code" });
  assert.deepEqual(donoDe(["Claude Code", "x"]), { id: "mcp:claude-code", rotulo: "Claude Code (MCP)", origem: "claude-code" });
  assert.equal(donoDe("<script>alert(1)</script>").rotulo, "scriptalert1script (MCP)");
  assert.equal(donoDe("a".repeat(80)).rotulo.length, 30 + " (MCP)".length);
});

test("pedidoOk: só POST /mcp do loopback com Bearer e JSON; cada recusa com o status certo; OPTIONS (CORS) nunca passa", () => {
  assert.deepEqual(pedidoOk(okReq(), 7830, TOKEN), { ok: true });
  assert.deepEqual(pedidoOk(okReq({ origin: "http://127.0.0.1:7830" }), 7830, TOKEN), { ok: true });
  assert.deepEqual(pedidoOk(okReq({ origin: "http://localhost:7830" }), 7830, TOKEN), { ok: true });
  assert.deepEqual(pedidoOk(okReq({ host: "localhost:7830", "content-type": "application/json; charset=utf-8" }), 7830, TOKEN), { ok: true });
  assert.equal(pedidoOk({ ...okReq(), url: "/x" }, 7830, TOKEN).status, 404);
  assert.equal(pedidoOk({ ...okReq(), url: "/mcp?x=1" }, 7830, TOKEN).ok, true, "query não atrapalha");
  assert.equal(pedidoOk({ ...okReq(), method: "GET" }, 7830, TOKEN).status, 405, "sem SSE: GET recusa");
  assert.equal(pedidoOk({ ...okReq(), method: "DELETE" }, 7830, TOKEN).status, 405, "sem sessão: nada para encerrar");
  assert.equal(pedidoOk({ ...okReq(), method: "OPTIONS" }, 7830, TOKEN).status, 405, "preflight de CORS não existe aqui");
  assert.equal(pedidoOk(okReq({ host: "evil.com:7830" }), 7830, TOKEN).status, 421, "DNS rebinding");
  assert.equal(pedidoOk(okReq({ host: "127.0.0.1:7831" }), 7830, TOKEN).status, 421, "porta errada");
  assert.equal(pedidoOk(okReq({ origin: "https://evil.com" }), 7830, TOKEN).status, 403, "página de fora");
  assert.equal(pedidoOk(okReq({ origin: "http://127.0.0.1:9999" }), 7830, TOKEN).status, 403);
  assert.equal(pedidoOk(okReq({ authorization: "Bearer " + "b".repeat(64) }), 7830, TOKEN).status, 401);
  assert.equal(pedidoOk(okReq({ authorization: undefined }), 7830, TOKEN).status, 401);
  assert.equal(pedidoOk(okReq(), 7830, "").status, 401, "sem token gravado ninguém entra");
  assert.equal(pedidoOk(okReq({ "content-type": "text/plain" }), 7830, TOKEN).status, 415);
});

test("versão do protocolo: anuncia 2025-06-18; ecoa a do cliente só se a conhece", () => {
  assert.equal(VERSAO_PROTOCOLO, "2025-06-18");
  assert.equal(negociarVersao("2024-11-05"), "2024-11-05");
  assert.equal(negociarVersao("2025-03-26"), "2025-03-26");
  assert.equal(negociarVersao("2026-01-01"), "2025-06-18", "revisão que não conhecemos: a nossa mais nova");
  assert.equal(negociarVersao(undefined), "2025-06-18");
});

test("JSON-RPC: initialize, ping, tools/list, tools/call (texto, imagem, erro), notificação sem resposta, lote recusado, método desconhecido", async () => {
  const chamadas = [];
  const chamar = async (nome, args) => {
    chamadas.push([nome, args]);
    if (nome === "nav_print") return { png_base64: "AAAA" };
    if (nome === "nota") throw new Error("falta texto");
    if (nome === "terminais") return { terminais: [] };
    return undefined;
  };
  const init = await responderJsonRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }, chamar, INFO);
  assert.equal(init.result.protocolVersion, "2024-11-05"); assert.deepEqual(init.result.serverInfo, { name: "meu-bot", version: "1.2.3" }); assert.deepEqual(init.result.capabilities, { tools: {} }); assert.match(init.result.instructions, /nota/);
  const semVersao = await responderJsonRpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} }, chamar, INFO);
  assert.equal(semVersao.result.protocolVersion, "2025-06-18");
  assert.deepEqual(await responderJsonRpc({ jsonrpc: "2.0", id: 3, method: "ping" }, chamar, INFO), { jsonrpc: "2.0", id: 3, result: {} });
  const lista = await responderJsonRpc({ jsonrpc: "2.0", id: 4, method: "tools/list" }, chamar, INFO);
  assert.equal(lista.result.tools.length, FERRAMENTAS.length);
  assert.equal(await responderJsonRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, chamar, INFO), null);
  const t = await responderJsonRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "terminais", arguments: {} } }, chamar, INFO);
  assert.deepEqual(t.result, { content: [{ type: "text", text: JSON.stringify({ terminais: [] }) }], isError: false }, "só texto: sem structuredContent (não há outputSchema)");
  const ok = await responderJsonRpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "tema", arguments: { tema: "dark" } } }, chamar, INFO);
  assert.equal(ok.result.content[0].text, JSON.stringify({ ok: true }), "sem retorno vira {ok:true}");
  const img = await responderJsonRpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "nav_print", arguments: {} } }, chamar, INFO);
  assert.deepEqual(img.result, { content: [{ type: "image", data: "AAAA", mimeType: "image/png" }], isError: false });
  const erro = await responderJsonRpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "nota", arguments: {} } }, chamar, INFO);
  assert.deepEqual(erro.result, { content: [{ type: "text", text: "Erro: falta texto" }], isError: true });
  const desconhecida = await responderJsonRpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "sumir", arguments: {} } }, chamar, INFO);
  assert.equal(desconhecida.error.code, -32602);
  const metodo = await responderJsonRpc({ jsonrpc: "2.0", id: 10, method: "resources/list" }, chamar, INFO);
  assert.equal(metodo.error.code, -32601);
  assert.equal((await responderJsonRpc("texto", chamar, INFO)).error.code, -32600);
  assert.equal((await responderJsonRpc({ jsonrpc: "2.0", id: 11 }, chamar, INFO)).error.code, -32600);
  const lote = await responderJsonRpc([{ jsonrpc: "2.0", id: 12, method: "ping" }], chamar, INFO);
  assert.equal(lote.error.code, -32600, "lote saiu do MCP em 2025-06-18"); assert.match(lote.error.message, /lote/);
  assert.deepEqual(chamadas.map((c) => c[0]), ["terminais", "tema", "nav_print", "nota"], "a desconhecida nunca chega ao app");
  assert.deepEqual(erroRpc(null, -32000, "x"), { jsonrpc: "2.0", id: null, error: { code: -32000, message: "x" } });
});

test("execução desligada: tools/list esconde terminal_digitar e nav_js, e chamar dá isError sem tocar o app", async () => {
  const chamadas = [];
  const chamar = async (nome) => { chamadas.push(nome); return { ok: true }; };
  const info = { ...INFO, execucao: false };
  const lista = await responderJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, chamar, info);
  assert.equal(lista.result.tools.length, FERRAMENTAS.length - 2);
  const r = await responderJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "terminal_digitar", arguments: { id: "t1", texto: "rm -rf /", enter: true } } }, chamar, info);
  assert.equal(r.result.isError, true); assert.match(r.result.content[0].text, /desligada/);
  const js = await responderJsonRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nav_js", arguments: { codigo: "1" } } }, chamar, info);
  assert.equal(js.result.isError, true);
  const ler = await responderJsonRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "terminal_ler", arguments: { id: "t1" } } }, chamar, info);
  assert.equal(ler.result.isError, false);
  assert.deepEqual(chamadas, ["terminal_ler"]);
});

test("token e porta: 64 hex; porta 1024–65535; a configuração pronta leva nome, porta e token", () => {
  const t = gerarToken();
  assert.ok(isToken(t)); assert.notEqual(t, gerarToken());
  assert.equal(isToken("abc"), false); assert.equal(isToken("G".repeat(64)), false);
  assert.equal(isPortaMcp(1024), true); assert.equal(isPortaMcp(1023), false); assert.equal(isPortaMcp(65535), true); assert.equal(isPortaMcp(65536), false); assert.equal(isPortaMcp("7830"), false); assert.equal(isPortaMcp(7830.5), false);
  assert.equal(urlMcp(7830), "http://127.0.0.1:7830/mcp");
  assert.equal(configClaudeCode("meu-bot-staging", 7831, TOKEN), `claude mcp add --scope user --transport http meu-bot-staging http://127.0.0.1:7831/mcp --header "Authorization: Bearer ${TOKEN}" --header "X-Meu-Bot-Cliente: Claude Code"`);
  assert.deepEqual(JSON.parse(configCursor("meu-bot", 7830, TOKEN)), { mcpServers: { "meu-bot": { url: "http://127.0.0.1:7830/mcp", headers: { Authorization: `Bearer ${TOKEN}`, "X-Meu-Bot-Cliente": "Cursor" } } } });
});

test("instalar: a entrada de cada cliente leva url, chave e o nome do cliente (o selo do app)", () => {
  assert.deepEqual(entradaMcp(7830, TOKEN, "claude-code"), { type: "http", url: "http://127.0.0.1:7830/mcp", headers: { Authorization: `Bearer ${TOKEN}`, "X-Meu-Bot-Cliente": "Claude Code" } });
  assert.deepEqual(entradaMcp(7830, TOKEN, "cursor"), { url: "http://127.0.0.1:7830/mcp", headers: { Authorization: `Bearer ${TOKEN}`, "X-Meu-Bot-Cliente": "Cursor" } });
  assert.equal(donoDe(entradaMcp(7830, TOKEN, "claude-code").headers["X-Meu-Bot-Cliente"]).rotulo, "Claude Code (MCP)");
  assert.equal(isClienteMcp("cursor"), true); assert.equal(isClienteMcp("claude"), false); assert.equal(isClienteMcp(undefined), false);
});

test("instalar: o deeplink do Cursor traz o nome e a config em base64", () => {
  const u = new URL(deeplinkCursor("meu-bot-staging", 7831, TOKEN));
  assert.equal(`${u.protocol}//${u.host}${u.pathname}`, "cursor://anysphere.cursor-deeplink/mcp/install");
  assert.equal(u.searchParams.get("name"), "meu-bot-staging");
  assert.deepEqual(JSON.parse(Buffer.from(u.searchParams.get("config"), "base64").toString("utf8")), entradaMcp(7831, TOKEN, "cursor"));
});

test("instalar: o estado do cliente compara url e chave, não só o nome", () => {
  const cfg = (servidores) => JSON.stringify({ outra: 1, mcpServers: servidores });
  const certo = { type: "http", url: "http://127.0.0.1:7830/mcp", headers: { Authorization: `Bearer ${TOKEN}` } };
  assert.equal(estadoCliente(null, "meu-bot", 7830, TOKEN), "ausente");
  assert.equal(estadoCliente("{}", "meu-bot", 7830, TOKEN), "ausente");
  assert.equal(estadoCliente(cfg({ outro: certo }), "meu-bot", 7830, TOKEN), "ausente");
  assert.equal(estadoCliente(cfg({ "meu-bot": certo }), "meu-bot", 7830, TOKEN), "instalado");
  assert.equal(estadoCliente(cfg({ "meu-bot": certo }), "meu-bot", 7830, "b".repeat(64)), "desatualizado", "chave nova");
  assert.equal(estadoCliente(cfg({ "meu-bot": certo }), "meu-bot", 7840, TOKEN), "desatualizado", "porta nova");
  assert.equal(estadoCliente(cfg({ "meu-bot": certo }), "meu-bot", 7830, ""), "desatualizado", "sem chave nunca é instalado");
  assert.equal(estadoCliente(cfg({ "meu-bot": { command: "node", args: ["app-mcp.mjs"] } }), "meu-bot", 7830, TOKEN), "desatualizado", "outra forma de servidor com o mesmo nome");
  assert.equal(estadoCliente("{ quebrado", "meu-bot", 7830, TOKEN), "ilegivel");
  assert.equal(estadoCliente("[]", "meu-bot", 7830, TOKEN), "ilegivel");
  assert.equal(estadoCliente(JSON.stringify({ mcpServers: [] }), "meu-bot", 7830, TOKEN), "ilegivel");
});

test("produtos: cada app tem a própria porta do MCP, nenhuma é a 7822 do Rambox nem colide com a porta local", () => {
  const portas = PRODUTOS.map((p) => p.portaMcp);
  assert.equal(new Set(portas).size, portas.length, "porta do MCP repetida entre apps");
  for (const p of PRODUTOS) { assert.ok(isPortaMcp(p.portaMcp), p.nome); assert.notEqual(p.portaMcp, 7822, "o Rambox pode estar aberto no mesmo Mac"); assert.notEqual(p.portaMcp, p.portaLocal); }
  assert.equal(PRODUTOS.find((p) => p.variant === "client").portaMcp, 7830);
  assert.equal(PRODUTOS.find((p) => p.variant === "client-staging").portaMcp, 7831);
});

test("settings: desligado, sem execução e sem token por padrão; token inválido cai para vazio; porta fora da faixa vira padrão (null)", () => {
  const d = defaultSettings();
  assert.deepEqual([d.mcpLigado, d.mcpExecucao, d.mcpPorta, d.mcpToken], [false, true, null, ""], "execução vem ligada por padrão (7 nov); o controle externo em si vem desligado");
  const s = normalizeSettings({ mcpLigado: true, mcpExecucao: true, mcpPorta: 7900, mcpToken: TOKEN });
  assert.deepEqual([s.mcpLigado, s.mcpExecucao, s.mcpPorta, s.mcpToken], [true, true, 7900, TOKEN]);
  const ruim = normalizeSettings({ mcpLigado: "sim", mcpExecucao: 1, mcpPorta: 80, mcpToken: "curto" });
  assert.deepEqual([ruim.mcpLigado, ruim.mcpExecucao, ruim.mcpPorta, ruim.mcpToken], [false, true, null, ""], "execução fora do formato cai no padrão (ligada); só `false` explícito desliga");
  assert.equal(normalizeSettings({ mcpExecucao: false }).mcpExecucao, false);
});

test("decidirNavegador: socket quando a aba está aberta; abrir quando só a janela está; erro quando nem a janela, ou quando há várias e ninguém disse qual", () => {
  const { decidirNavegador } = createRequire(import.meta.url)("../../dist/main/controle-remoto/controle-remoto-core.js");
  assert.deepEqual(decidirNavegador(undefined, ["box-2"], ["box-2"]), { acao: "socket", host: "box-2" });
  assert.deepEqual(decidirNavegador(undefined, [], ["box-2"]), { acao: "abrir", host: "box-2" }, "aba fechada, janela aberta: o app abre a aba");
  assert.deepEqual(decidirNavegador("box-2", [], ["box-2", "vps"]), { acao: "abrir", host: "box-2" });
  assert.deepEqual(decidirNavegador("vps", ["box-2"], ["box-2", "vps"]), { acao: "abrir", host: "vps" });
  assert.equal(decidirNavegador(undefined, [], []).acao, "erro");
  assert.match(decidirNavegador(undefined, [], []).erro, /nenhuma janela de máquina/);
  assert.match(decidirNavegador(undefined, ["a", "b"], ["a", "b"]).erro, /várias máquinas.*maquina/);
  assert.match(decidirNavegador(undefined, [], ["a", "b"]).erro, /várias máquinas abertas/);
  assert.match(decidirNavegador("outra", ["a"], ["a"]).erro, /"outra" não está aberta.*abertas: a/);
});
