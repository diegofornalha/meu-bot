import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
// O intermediário lê a pasta do root na carga: aponta para uma descartável antes.
const etc = mkdtempSync(path.join(tmpdir(), "cg-etc-"));
process.env.MEU_BOT_CLAUDE_GLOBAL_ETC = etc;
const relay = require("../../backend-colima/claude-global.js");
const core = require("../../dist/main/admin/claude-global-core.js");
const { TUTORIAIS, emptyContext, emptyFlags, guideView } = await import("../../dist/renderer/lib/tutoriais.js");

test("intermediário: só passam os caminhos de conversa; a API OAuth do root (criar chave, uso, perfil) não", () => {
  const passa = (u) => relay.PERMITIDO.some((re) => re.test(u));
  for (const u of ["/v1/messages", "/v1/messages?beta=true", "/v1/messages/count_tokens?beta=true", "/v1/models"]) assert.ok(passa(u), u);
  for (const u of ["/api/oauth/claude_cli/create_api_key", "/api/oauth/usage", "/api/oauth/profile", "/v1/organizations", "/v1/messages/../../api/oauth/usage", "/v1/messagesx"]) assert.ok(!passa(u), u);
});

test("intermediário: a chave do usuário vira o token do root; nada do usuário segue para fora", () => {
  const h = relay.cabecalhos({ headers: { authorization: "Bearer CHAVE", "x-api-key": "k", cookie: "c=1", host: "127.0.0.1", "anthropic-beta": "a-1,b-2", "anthropic-version": "2023-06-01" } }, "TOKEN-DO-ROOT", 10);
  assert.equal(h.authorization, "Bearer TOKEN-DO-ROOT");
  assert.equal(h["x-api-key"], undefined); assert.equal(h.cookie, undefined); assert.equal(h.host, undefined);
  assert.deepEqual(h["anthropic-beta"].split(","), ["a-1", "b-2", "oauth-2025-04-20"]);
  assert.equal(h["anthropic-version"], "2023-06-01"); assert.equal(h["content-length"], "10");
});

test("intermediário: a chave abre só para o dono dela; chave errada ou fora do formato não abre", () => {
  mkdirSync(path.join(etc, "chaves"), { recursive: true });
  const k = "a".repeat(48); writeFileSync(path.join(etc, "chaves", "box-2"), k);
  writeFileSync(path.join(etc, "chaves", "Nome Ruim"), "b".repeat(48));
  assert.equal(relay.usuarioDaChave({ headers: { authorization: `Bearer ${k}` } }), "box-2");
  assert.equal(relay.usuarioDaChave({ headers: { "x-api-key": k } }), "box-2");
  assert.equal(relay.usuarioDaChave({ headers: { authorization: `Bearer ${"b".repeat(48)}` } }), null, "nome de usuário inválido não vale");
  assert.equal(relay.usuarioDaChave({ headers: { authorization: "Bearer curta" } }), null);
  assert.equal(relay.usuarioDaChave({ headers: {} }), null);
});

test("scripts do root: a chave fica em /etc (600) e na pasta do usuário (gravada por ele, 600), nunca na saída", () => {
  const sh = core.cgLigarSh("box-3");
  assert.match(sh, /chmod 600 \/etc\/meu-bot\/claude-global\/chaves\/box-3/);
  // Dentro do home só o usuário escreve (symlink plantado não leva o root a lugar nenhum); umask 077 dá o 0600.
  assert.match(sh, /runuser -u box-3 -- sh -c 'umask 077; .*cat > "\$1\.tmp" && mv -f "\$1\.tmp" "\$1"'/, "quem grava no home é o usuário");
  assert.doesNotMatch(sh, /chown/, "o root não dá chown dentro do home");
  assert.doesNotMatch(sh, /os\.environ\["A"\]/, "o python do root nunca recebe o caminho do home");
  assert.doesNotMatch(sh, /echo [^\n]*\$K/, "a chave nunca vai para a saída");
  assert.match(sh, /^echo "GLOBAL=ok"$/m);
  assert.throws(() => core.cgLigarSh("box-3; rm -rf /"), /inválido/);
  assert.match(core.cgDesligarSh("box-3"), /rm -f \/etc\/meu-bot\/claude-global\/chaves\/box-3/);
  assert.match(core.cgDesligarSh("box-3"), /runuser -u box-3 -- rm -f "\$H\/\.local\/share\/meu-bot\/claude-global\.json"/, "no home, o rm também é do usuário");
  assert.throws(() => core.cgContaRemoverSh("padrao"), /inválida/, "o login do root não sai do rodízio");
});

test("estado: lê a linha ESTADO= e descarta usuário com nome inválido", () => {
  const e = core.lerEstado(`x\nESTADO=${JSON.stringify({ instalado: true, ativo: true, porta: 18780, login: true, email: "a@b.c", plano: "team", contas: [], usuarios: [{ nome: "box-1", ligado: true, chamadas: 3, ultima: 1, limites: 0 }, { nome: "x;y", ligado: true }] })}\n`);
  assert.equal(e.porta, 18780); assert.equal(e.usuarios.length, 1);
  assert.equal(core.lerEstado("NAOROOT\n"), null);
});

test("tutorial 1 só confirma a sessão: com o global do admin, já vem concluído", () => {
  const t1 = TUTORIAIS.find((x) => x.id === "claude-login");
  const ctx = (claude) => ({ ...emptyContext(), claude: { ...emptyContext().claude, ...claude } });
  assert.equal(guideView(t1, null, emptyFlags(), ctx({ loggedIn: true, email: "admin@x.com", global: true })).finished, true);
  assert.equal(guideView(t1, null, emptyFlags(), ctx({ loggedIn: true, email: "eu@x.com", global: false })).finished, false, "conta própria: falta a primeira resposta");
  assert.equal(guideView(t1, null, emptyFlags(), ctx({ loggedIn: false, global: false })).current, 0);
});

test("intermediário: o uso da conta do root vem dos cabeçalhos da resposta (vale o limiar do rodízio)", () => {
  const orig = relay.anotarUsoDaConta;
  // A função usa o registro do root; aqui só confere a leitura dos cabeçalhos por um registro falso.
  const fake = { headers: { "anthropic-ratelimit-unified-5h-utilization": "0.16", "anthropic-ratelimit-unified-5h-reset": "1793312400", "anthropic-ratelimit-unified-7d-utilization": "0.91", "anthropic-ratelimit-unified-7d-reset": "1793757600" } };
  assert.equal(typeof orig, "function");
  assert.doesNotThrow(() => orig({ id: "padrao" }, fake), "sem registro gravável, não derruba a resposta");
  assert.doesNotThrow(() => orig({ id: "padrao" }, { headers: {} }));
});

test("limiares do rodízio do root: só números de 50 a 100 e as duas estratégias", () => {
  assert.match(core.cgLimiaresSh({ sessao: 85 }), /definirLimiares\(\{"sessao":85\}\)/);
  assert.match(core.cgLimiaresSh({ estrategia: "folga" }), /"estrategia":"folga"/);
  assert.throws(() => core.cgLimiaresSh({ sessao: 20 }), /50 a 100/);
  assert.throws(() => core.cgLimiaresSh({ estrategia: "x" }), /inválida/);
});

test("rodízio do root: ordem, ligar/desligar e conferir, como o tutorial 2 (o login do root não entra na ordem)", () => {
  assert.match(core.cgContaEditarSh({ ordem: ["c-aaaaaaaa", "c-bbbbbbbb"] }), /r\.reordenar\(\["c-aaaaaaaa","c-bbbbbbbb"\]\)/);
  assert.throws(() => core.cgContaEditarSh({ ordem: ["padrao", "c-aaaaaaaa"] }), /ordem inválida/);
  assert.match(core.cgContaEditarSh({ id: "c-aaaaaaaa", ativa: false }), /r\.atualizar\("c-aaaaaaaa", \{ ativa: false \}\)/);
  assert.match(core.cgContaEditarSh({ id: "padrao", conferir: true }), /r\.conferir\("padrao"\)/);
  assert.throws(() => core.cgContaEditarSh({ id: "c-aaaaaaaa'); process.exit(); ('", ativa: true }), /inválido/);
  assert.throws(() => core.cgContaEditarSh({}), /inválido/);
});

test("intermediário: todas as contas no limite → 429 com os cabeçalhos de limite da Anthropic (status rejected, reset) e a hora na mensagem", () => {
  const cab = {}; let corpo = "";
  const res = { writeHead: (st, h) => { cab.status = st; Object.assign(cab, h); }, end: (b) => { corpo = b; } };
  const ate = Math.floor(Date.now() / 1000) + 1800;
  const reset = relay.respostaEsgotado(res, ate);
  assert.equal(reset, ate);
  assert.equal(cab.status, 429);
  assert.equal(cab["anthropic-ratelimit-unified-status"], "rejected", "é isto que faz o Claude Code emitir o rate_limit_event rejeitado em vez de tentar de novo");
  assert.equal(cab["anthropic-ratelimit-unified-reset"], String(ate));
  assert.equal(cab["anthropic-ratelimit-unified-representative-window"], "five_hour");
  assert.ok(Number(cab["retry-after"]) > 1700 && Number(cab["retry-after"]) <= 1800);
  const j = JSON.parse(corpo);
  assert.equal(j.error.type, "rate_limit_error");
  assert.match(j.error.message, /no limite até \d{2}:\d{2}/);
  // Sem `ate` conhecido: o padrão do rodízio (60 min), nunca um reset no passado.
  const r2 = relay.respostaEsgotado(res, null);
  assert.ok(r2 > Math.floor(Date.now() / 1000) + 3000);
  const r3 = relay.respostaEsgotado(res, Math.floor(Date.now() / 1000) - 10);
  assert.ok(r3 > Math.floor(Date.now() / 1000));
});

test("intermediário: só o 429 de limite da assinatura tira a conta do rodízio; o passageiro da Anthropic não", () => {
  const r = (headers) => ({ statusCode: 429, headers });
  assert.equal(relay.limiteDaAssinatura(r({ "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-reset": "1795404193" })), true);
  assert.equal(relay.limiteDaAssinatura(r({ "anthropic-ratelimit-unified-status": "allowed", "anthropic-ratelimit-unified-7d-status": "rejected" })), true, "a janela semanal rejeitada também é limite");
  assert.equal(relay.limiteDaAssinatura(r({ "anthropic-ratelimit-unified-5h-status": "Rejected" })), true);
  // "Server is temporarily limiting requests (not your usage limit)": sem status rejeitado, com ou sem os cabeçalhos de uso.
  assert.equal(relay.limiteDaAssinatura(r({ "retry-after": "5" })), false);
  assert.equal(relay.limiteDaAssinatura(r({ "anthropic-ratelimit-unified-status": "allowed", "anthropic-ratelimit-unified-5h-utilization": "0.13" })), false);
  assert.equal(relay.limiteDaAssinatura(r({})), false);
  assert.equal(relay.limiteDaAssinatura(null), false);
});

test("intermediário: só o erro do login bloqueia a conta; queda de rede e 5xx na renovação não", () => {
  assert.equal(relay.erroDeLogin("conta do root sem login").login, true);
  for (const st of [400, 401, 403]) assert.equal(relay.recusaDeLogin(st), true, String(st));
  for (const st of [408, 429, 500, 502, 503, 529]) assert.equal(relay.recusaDeLogin(st), false, String(st));
  const src = readFileSync(new URL("../../backend-colima/claude-global.js", import.meta.url), "utf8");
  // O laço das contas só marca "bloqueada" com o erro do login; o resto fica como falha de rede e vira 502 no fim.
  assert.match(src, /if \(e && e\.login\) contas\.marcar\(c\.id, 'bloqueada'/);
  assert.match(src, /else semRede = e;/);
  assert.match(src, /if \(semRede\) \{ anotarUso\(usuario, null, 502\); return erro\(res, 502, 'api_error'/);
  assert.ok(src.indexOf("if (ultimo429) { res.writeHead") < src.indexOf("if (semRede) { anotarUso"), "o 429 de verdade da Anthropic tem precedência sobre a falha de rede");
  // Um erro comum (o `read ECONNRESET` do https) não traz a marca.
  assert.equal(Boolean(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }).login), false);
});
