import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { INSPECTOR_VERSAO, INSPECTOR_PACOTE, SERVIDOR_ID, PARTICAO_INSPECTOR, ERRO_SEM_NPX, argsNpx, ambienteNpx, sessaoJson, urlPagina, urlInspectorPermitida, mesmaOrigem, lerSaida, nodeServe, acharNpx, erroNodeAntigo, erroDaSubida } = req("../../dist/main/inspector/inspector-core.js");
const { pedidoOk, urlMcp } = req("../../dist/main/controle-remoto/controle-remoto-core.js");
const { PRODUTOS, produtoDe, capsFor, PAGINAS_INICIAIS, nomesReservados } = req("../../dist/main/app/variant-core.js");
const { produtosDoCanal, produtosComInstalador } = await import("../release-core.mjs");

const TOKEN = "b".repeat(64);

test("versão fixa: o npx roda um pacote com versão exata, nunca latest nem faixa", () => {
  assert.match(INSPECTOR_VERSAO, /^\d+\.\d+\.\d+$/);
  assert.equal(INSPECTOR_PACOTE, `@modelcontextprotocol/inspector@${INSPECTOR_VERSAO}`);
  assert.deepEqual(argsNpx("/dados/inspector/sessao.json"), ["-y", INSPECTOR_PACOTE, "--web", "--config", "/dados/inspector/sessao.json"]);
});

test("linha de comando e ambiente: a chave do controle externo não aparece em nenhum dos dois", () => {
  const env = ambienteNpx({ HOME: "/Users/x", PATH: "/bin", VAZIA: undefined, MCP_PROXY_AUTH_TOKEN: "velho", DANGEROUSLY_OMIT_AUTH: "true", ALLOWED_ORIGINS: "http://fora" }, { porta: 51234, tokenApi: "api123", pastaDados: "/dados/inspector", path: "/opt/homebrew/bin:/bin" });
  assert.deepEqual([env.HOST, env.CLIENT_PORT, env.MCP_SANDBOX_PORT, env.MCP_APP_ORIGIN_PORT], ["127.0.0.1", "51234", "0", "0"], "só loopback; portas auxiliares pelo sistema");
  assert.equal(env.MCP_AUTO_OPEN_ENABLED, "false", "não abre o navegador do sistema");
  assert.equal(env.MCP_INSPECTOR_API_TOKEN, "api123");
  assert.equal(env.MCP_INSPECTOR_SECRET_STORE, "memory", "nada no Chaveiro");
  assert.equal(env.MCP_STORAGE_DIR, "/dados/inspector", "não toca no ~/.mcp-inspector da pessoa");
  assert.equal(env.PATH, "/opt/homebrew/bin:/bin");
  assert.equal(env.HOME, "/Users/x");
  for (const k of ["VAZIA", "MCP_PROXY_AUTH_TOKEN", "DANGEROUSLY_OMIT_AUTH", "ALLOWED_ORIGINS"]) assert.equal(k in env, false, `${k} não é herdada`);
  assert.equal([...argsNpx("/a/sessao.json"), ...Object.values(env)].some((v) => v.includes(TOKEN)), false);
});

test("arquivo de sessão: a linha do deep link, streamable-http, com o Bearer e o nome do cliente; passa no pedidoOk do app", () => {
  const j = JSON.parse(sessaoJson(7835, TOKEN));
  assert.deepEqual(Object.keys(j.mcpServers), [SERVIDOR_ID]);
  const s = j.mcpServers[SERVIDOR_ID];
  assert.deepEqual([s.type, s.url], ["streamable-http", "http://127.0.0.1:7835/mcp"]);
  assert.deepEqual(s.headers, { Authorization: `Bearer ${TOKEN}`, "X-Meu-Bot-Cliente": "Inspector" });
  // O pedido que o backend do Inspector faz (Node: sem Origin, Host de loopback) entra sem afrouxar nada; sem a chave, 401.
  const pedido = (headers) => ({ method: "POST", url: "/mcp", headers: { host: "127.0.0.1:7835", "content-type": "application/json", ...headers } });
  assert.deepEqual(pedidoOk(pedido({ authorization: s.headers.Authorization }), 7835, TOKEN), { ok: true });
  assert.equal(pedidoOk(pedido({}), 7835, TOKEN).status, 401);
  // O GET (SSE) que o transporte tenta depois do initialize continua recusado: o Inspector segue só com POST.
  assert.equal(pedidoOk({ ...pedido({ authorization: s.headers.Authorization }), method: "GET" }, 7835, TOKEN).status, 405);
});

test("endereço da página: deep link com a url do MCP do app, transporte http e o token da API (não o do app)", () => {
  const u = new URL(urlPagina(51234, 7835, "api123"));
  assert.equal(u.origin, "http://127.0.0.1:51234");
  assert.equal(u.pathname, "/");
  assert.deepEqual([u.searchParams.get("serverUrl"), u.searchParams.get("transport"), u.searchParams.get("autoConnect")], [urlMcp(7835), "http", "api123"]);
  // A linha do arquivo de sessão tem de casar com o que o deep link pede (mesmo tipo e mesma url), senão o Inspector tenta regravar a linha.
  assert.equal(JSON.parse(sessaoJson(7835, TOKEN)).mcpServers[SERVIDOR_ID].url, new URL(u.searchParams.get("serverUrl")).href);
  assert.equal(urlInspectorPermitida(u.href), true);
});

test("<webview>: só a interface em 127.0.0.1, e as navegações ficam na mesma origem", () => {
  assert.equal(PARTICAO_INSPECTOR, "inspector");
  for (const ok of ["http://127.0.0.1:51234/", "http://127.0.0.1:51234/?serverUrl=x", "http://127.0.0.1:6274/#tools"]) assert.equal(urlInspectorPermitida(ok), true, ok);
  for (const nao of ["https://127.0.0.1:51234/", "http://localhost:51234/", "http://127.0.0.1.evil.com:51234/", "http://evil.com/?http://127.0.0.1:51234/", "file:///etc/passwd", "http://127.0.0.1/", "http://127.0.0.1:51234/vnc.html"]) assert.equal(urlInspectorPermitida(nao), false, nao);
  assert.equal(mesmaOrigem("http://127.0.0.1:51234/oauth/callback?x=1", "http://127.0.0.1:51234/"), true);
  assert.equal(mesmaOrigem("http://127.0.0.1:7835/mcp", "http://127.0.0.1:51234/"), false, "outra porta é outra origem");
  assert.equal(mesmaOrigem("https://modelcontextprotocol.io/", "http://127.0.0.1:51234/"), false);
  assert.equal(mesmaOrigem("lixo", "http://127.0.0.1:51234/"), false);
});

test("lerSaida: a interface só conta como no ar depois do aviso com o endereço (a saída chega aos pedaços)", () => {
  // Saída de verdade do 2.13.0 (15 nov 2026).
  const banner = "Starting MCP inspector...\n[mcp-inspector] Secrets are not written anywhere and are lost on exit.\n\nMCP Inspector Web is up and running at:\n   http://127.0.0.1:16274?MCP_INSPECTOR_API_TOKEN=abc123tok\n\n   Sandbox (MCP Apps): http://127.0.0.1:50682/sandbox\n\n   Auth token: abc123tok\n";
  assert.deepEqual(lerSaida(banner), { porta: 16274 });
  assert.equal(lerSaida("Starting MCP inspector...\n"), null);
  assert.equal(lerSaida("MCP Inspector Web is up and running at:\n"), null, "o endereço ainda não veio");
  assert.equal(lerSaida("   Sandbox (MCP Apps): http://127.0.0.1:50682/sandbox\n"), null, "a porta do sandbox não é a da interface");
  assert.equal(lerSaida(""), null);
});

test("node: o Inspector v2 pede 22.19 ou mais novo", () => {
  for (const v of ["v22.19.0", "v22.19.1\n", "v22.20.0", "v24.0.0", "26.8.1"]) assert.equal(nodeServe(v), true, v);
  for (const v of ["v22.18.9", "v20.19.0", "v18.20.4", "", "node: command not found"]) assert.equal(nodeServe(v), false, v);
  assert.match(erroNodeAntigo("v20.11.0\n"), /^O Node\.js deste Mac é o v20\.11\.0, e o MCP Inspector .* pede o 22\.19\.0 ou mais novo\./);
});

test("sem node ou sem npx: a página recebe o que falta, em pt-BR", () => {
  const tem = (...ps) => (p) => ps.includes(p);
  assert.deepEqual(acharNpx("/opt/homebrew/bin/node", tem("/opt/homebrew/bin/npx")), { npx: "/opt/homebrew/bin/npx", pasta: "/opt/homebrew/bin" });
  assert.deepEqual(acharNpx(null, tem("/opt/homebrew/bin/npx")), { erro: ERRO_SEM_NPX }, "sem node no Mac");
  assert.deepEqual(acharNpx("/opt/homebrew/bin/node", tem()), { erro: ERRO_SEM_NPX }, "node sem o npx ao lado");
  // MEU_BOT_INSPECTOR_NPX: vale o caminho dado; se ele não existe, a mesma mensagem (não cai no npx do node).
  assert.deepEqual(acharNpx("/opt/homebrew/bin/node", tem("/opt/homebrew/bin/npx", "/x/bin/npx"), "/x/bin/npx"), { npx: "/x/bin/npx", pasta: "/x/bin" });
  assert.deepEqual(acharNpx("/opt/homebrew/bin/node", tem("/opt/homebrew/bin/npx"), "/nao/existe/npx"), { erro: ERRO_SEM_NPX });
  assert.deepEqual(acharNpx("/opt/homebrew/bin/node", tem("/opt/homebrew/bin/npx"), ""), { npx: "/opt/homebrew/bin/npx", pasta: "/opt/homebrew/bin" }, "variável vazia não conta");
  assert.match(ERRO_SEM_NPX, /^Não achei o Node\.js \(comandos node e npx\) neste Mac/);
  assert.match(ERRO_SEM_NPX, /instale o Node 22\.19\.0 ou mais novo/);
  assert.match(ERRO_SEM_NPX, /Tentar de novo/);
});

test("erroDaSubida: sem rede, node antigo, porta ocupada, prazo e saída qualquer, sempre em pt-BR com o motivo cru", () => {
  assert.match(erroDaSubida("npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/@modelcontextprotocol%2finspector failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org\n", 1), /^Sem internet para baixar o MCP Inspector: .*Confira a rede e clique em Tentar de novo\. \(npm error network request/);
  assert.match(erroDaSubida("npm warn EBADENGINE Unsupported engine {\n", 1), /^O Node\.js deste Mac é antigo/);
  assert.match(erroDaSubida("Error: listen EADDRINUSE: address already in use 127.0.0.1:51234\n", 1), /^A porta escolhida para o Inspector foi ocupada/);
  assert.match(erroDaSubida("npm error code ETARGET\nnpm error notarget No matching version found for @modelcontextprotocol/inspector@9.9.9.\n", 1), /^O registro do npm não tem o pacote/);
  assert.match(erroDaSubida("Starting MCP inspector...\n", null), /^O MCP Inspector não subiu em 180 s/);
  assert.equal(erroDaSubida("", 7), "O MCP Inspector parou ao subir (npx saiu com 7).");
  assert.equal(erroDaSubida("Error: algo novo\n\n", 2), "O MCP Inspector parou ao subir (npx saiu com 2). (Error: algo novo)");
});

test("meu-bot-inspector-staging: produto do canal staging, fora do estável e do instalador, abrindo na página Inspector", () => {
  const p = produtoDe("inspector-staging");
  assert.deepEqual([p.nome, p.bundleId, p.icone, p.userData, p.herdaDe, p.canal, p.licenca, p.fundeDe, p.addon, p.instalador, p.abreEm], ["meu-bot-inspector-staging", "local.meu-bot-inspector.staging", "assets/icon-inspector-staging.icns", "meu-bot-inspector-staging", "meu-bot-staging", "staging", "meu-bot", null, null, false, "inspector"]);
  assert.ok(PAGINAS_INICIAIS.includes(p.abreEm));
  const nomes = (ps) => ps.map((x) => x.nome);
  assert.ok(nomes(produtosDoCanal(PRODUTOS, "staging")).includes(p.nome), "sai na release staging");
  assert.equal(nomes(produtosDoCanal(PRODUTOS, "estavel")).includes(p.nome), false, "não sai na estável");
  assert.equal(PRODUTOS.some((x) => x.canal === "estavel" && /inspector/.test(`${x.nome} ${x.variant} ${x.bundleId}`)), false, "nenhuma linha estável do Inspector");
  assert.equal(nomes(produtosComInstalador(PRODUTOS, "staging")).includes(p.nome), false, "sem .dmg");
  assert.ok(nomesReservados().has(p.nome));
});

test("a capacidade inspector é só deste produto; o resto das capacidades é o do meu-bot", () => {
  for (const x of PRODUTOS) assert.equal(capsFor(x.variant).inspector, x.variant === "inspector-staging", x.nome);
  assert.deepEqual({ ...produtoDe("inspector-staging").caps, inspector: false }, produtoDe("client").caps);
  assert.equal(capsFor("inspector-staging", "0.84.0").titulo, "meu-bot-inspector-staging 0.84.0");
});

test("nada colide com os outros produtos: nome, bundleId, ícone, pasta de dados, esquema e portas", () => {
  const p = produtoDe("inspector-staging");
  const outros = PRODUTOS.filter((x) => x !== p);
  const unico = (campo, valor, de = outros.map((x) => x[campo])) => assert.equal(de.includes(valor), false, `${campo} ${valor} já é de outro produto`);
  unico("nome", p.nome); unico("bundleId", p.bundleId); unico("icone", p.icone); unico("portaMcp", p.portaMcp);
  // userData null = a pasta padrão "meu-bot": compara pelo nome efetivo da pasta.
  unico("userData", p.userData, outros.map((x) => x.userData ?? "meu-bot"));
  // Porta do backend local e a do proxy da xAI (100 abaixo): só entre os apps da pessoa, que abrem juntos (o admin não sobe backend local).
  const pessoa = outros.filter((x) => x.caps.chat);
  unico("portaLocal", p.portaLocal, pessoa.map((x) => x.portaLocal));
  unico("portaLocal", p.portaLocal - 100, pessoa.flatMap((x) => [x.portaLocal, x.portaLocal - 100, x.portaMcp]));
  assert.deepEqual([p.portaLocal, p.portaMcp], [8793, 7835]);
  // E a tabela inteira continua sem repetição (a regra vale para o próximo produto também).
  for (const campo of ["nome", "bundleId", "icone", "portaMcp", "variant"]) { const vs = PRODUTOS.map((x) => x[campo]); assert.equal(new Set(vs).size, vs.length, `${campo} repetido na tabela`); }
  const pastas = PRODUTOS.map((x) => x.userData ?? "meu-bot"); assert.equal(new Set(pastas).size, pastas.length, "pasta de dados repetida");
});

test("zoom da interface: cabe inteira em painel estreito, nunca abaixo de 0.5 nem acima de 1", async () => {
  const { zoomDoInspector, INSPECTOR_LARGURA_MIN, INSPECTOR_ZOOM_MIN } = await import("../../dist/renderer/lib/inspector-zoom.js");
  assert.equal(zoomDoInspector(INSPECTOR_LARGURA_MIN), 1);
  assert.equal(zoomDoInspector(1600), 1, "painel folgado não amplia");
  assert.equal(zoomDoInspector(960), 0.75);
  assert.equal(zoomDoInspector(590), INSPECTOR_ZOOM_MIN, "o painel da captura de 15 nov (≈590 px) cai no piso");
  assert.equal(zoomDoInspector(300), INSPECTOR_ZOOM_MIN);
  for (const ruim of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(zoomDoInspector(ruim), 1);
  assert.ok(zoomDoInspector(900) * INSPECTOR_LARGURA_MIN <= 900 + INSPECTOR_LARGURA_MIN * 0.005, "a interface escalada cabe na largura");
});
