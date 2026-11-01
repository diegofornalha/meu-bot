import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chatsFromHermes, threadFromHermes, hermesPeerOfKey, isHermesKey, HERMES_LIST_PY, HERMES_THREAD_PY, HERMES_SELF_SH, HERMES_END_SH, HERMES_GROUPS_PY, hermesGroupSessions, hermesGroupOfKey } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");

test("chaves do Hermes: contato pela chave dm; grupo e OpenClaw ficam de fora", () => {
  assert.equal(hermesPeerOfKey("agent:main:whatsapp:dm:5522925501274"), "5522925501274");
  assert.equal(hermesPeerOfKey("agent:buffer:whatsapp:dm:+5521923670743"), "5521923670743");
  assert.equal(hermesPeerOfKey("agent:main:whatsapp:group:120363410341886851@g.us:5521923670743"), null);
  assert.equal(hermesPeerOfKey("agent:main:whatsapp:direct:+5521923670743"), null, "chave do OpenClaw");
  assert.equal(isHermesKey("agent:main:whatsapp:dm:5522925501274"), true);
  assert.equal(isHermesKey("agent:main:whatsapp:group:1203@g.us:55"), true);
  assert.equal(isHermesKey("agent:main:main"), false);
});

test("chatsFromHermes: uma conversa por contato, nome do display_name, próprio aparelho marcado, escondidas fora", () => {
  const list = { sessions: [
    { id: "20261024_175234_c37905b9", key: "agent:main:whatsapp:dm:5522925501274", name: "LV Lingerie", count: 21, started: 1792875154.8, last: 1792875611.9, archived: 0, hidden: 0 },
    { id: "20260908_061142_f8ec422a", key: "agent:main:whatsapp:dm:5516992294486", name: "L Santos", count: 217, started: 1789274383.7, last: 1789282125.5, archived: 0, hidden: 0 },
    { id: "20261013_135847_960a2e85", key: "agent:main:whatsapp:group:120363410341886851@g.us:5521923670743", name: "120363410341886851", started: 1791910727.4, last: null, hidden: 0 },
    { id: "20260101_000000_deadbeef", key: "agent:main:whatsapp:dm:5521983985713", name: "140029540204660@lid", started: 1791891091.3, last: null, hidden: 0 },
    { id: "20260102_000000_cafebabe", key: "agent:main:whatsapp:dm:5521936182339", name: "René", started: 1788850344.5, last: 1789260110.6, hidden: 1 },
    "lixo", { id: 3, key: "agent:main:whatsapp:dm:5500000000" },
  ] };
  const chats = chatsFromHermes(list, "5516992294486:36@s.whatsapp.net", new Map([["5521983985713", "Daniel"]]));
  assert.deepEqual(chats.map((c) => c.number), ["5522925501274", "5521983985713", "5516992294486"], "mais recente primeiro; grupo e escondida fora");
  const lv = chats[0];
  assert.equal(lv.name, "LV Lingerie"); assert.equal(lv.isSelf, false); assert.equal(lv.ownSession, true); assert.equal(lv.paused, false);
  assert.deepEqual(lv.sessionKeys, ["agent:main:whatsapp:dm:5522925501274"]); assert.deepEqual(lv.sessionIds, { "agent:main:whatsapp:dm:5522925501274": "20261024_175234_c37905b9" });
  assert.equal(lv.updatedAt, new Date(1792875611.9 * 1000).toISOString());
  assert.equal(chats[1].name, "Daniel", "id @lid não é nome: vale o cache do main");
  assert.equal(chats[2].isSelf, true);
  assert.deepEqual(chatsFromHermes(null, null), []);
});

test("threadFromHermes: contato e agente em ordem; ferramentas, vazias, NO_REPLY e hidden ficam de fora", () => {
  const t = threadFromHermes({ messages: [
    { sid: "a", role: "user", content: "Oi", ts: 1788847765.4, kind: null },
    { sid: "a", role: "assistant", content: "Oi, Diego! Como posso ajudar?", ts: 1788847779.6, kind: null },
    { sid: "a", role: "session_meta", content: null, ts: 1788847779.7, kind: null },
    { sid: "a", role: "assistant", content: "", ts: 1788847780, kind: null },
    { sid: "a", role: "assistant", content: "NO_REPLY", ts: 1788847781, kind: null },
    { sid: "a", role: "assistant", content: "aviso interno", ts: 1788847782, kind: "internal_notification" },
    { sid: "a", role: "user", content: "escondida", ts: 1788847783, kind: "hidden" },
    { sid: "a", role: "assistant", content: ".", ts: 1788847790, kind: null },
    { sid: "a", role: "user", content: "Oi", ts: 1788847765.4, kind: null },
  ] });
  assert.deepEqual(t.map((m) => [m.role, m.text]), [["contact", "Oi"], ["agent", "Oi, Diego! Como posso ajudar?"], ["agent", "."]]);
  assert.equal(t[0].at, new Date(1788847765.4 * 1000).toISOString());
  assert.deepEqual(threadFromHermes({}), []);
});

test("os programas remotos leem o state.db só em leitura e saem em uma linha", () => {
  for (const py of [HERMES_LIST_PY, HERMES_THREAD_PY]) { assert.match(py, /mode=ro/); assert.match(py, /json\.dumps/); assert.match(py, /~\/\.hermes\/state\.db/); }
  assert.match(HERMES_THREAD_PY, /role in \(\?, \?\)/); assert.match(HERMES_LIST_PY, /source = \? and chat_type = \?/);
  assert.match(HERMES_SELF_SH, /\.hermes\/whatsapp\/session\/creds\.json/);
});

test("sessão encerrada (Limpar histórico): o contato fica na lista, mas só a sessão viva mais recente vale para ler e limpar", () => {
  const list = { sessions: [
    { id: "20261001_000000_aaaaaaaa", key: "agent:main:whatsapp:dm:5521923670743", name: "Diego", started: 1790000000, last: 1790000100, hidden: 0, ended: 1790000200 },
    { id: "20261010_000000_bbbbbbbb", key: "agent:main:whatsapp:dm:5521923670743", name: "Diego", started: 1790500000, last: 1790500100, hidden: 0, ended: null },
    { id: "20261005_000000_cccccccc", key: "agent:main:whatsapp:dm:5521923670743", name: "Diego", started: 1790200000, last: 1790200100, hidden: 0, ended: null },
    { id: "20261020_000000_dddddddd", key: "agent:main:whatsapp:dm:5522925501274", name: "LV", started: 1792000000, last: 1792000100, hidden: 0, ended: 1792000200 },
  ] };
  const chats = chatsFromHermes(list, null);
  const diego = chats.find((c) => c.number === "5521923670743");
  assert.deepEqual(diego.sessionIds, { "agent:main:whatsapp:dm:5521923670743": "20261010_000000_bbbbbbbb" }, "a viva mais recente, não a encerrada nem a antiga");
  const lv = chats.find((c) => c.number === "5522925501274");
  assert.ok(lv !== undefined, "contato só com sessão encerrada continua na lista");
  assert.deepEqual(lv.sessionIds, {}, "sem sessão viva: conversa vazia até ele escrever de novo");
  assert.equal(lv.updatedAt, new Date(1792000100 * 1000).toISOString());
});

test("HERMES_END_SH encerra pelo Python do próprio Hermes com end_reason session_reset", () => {
  assert.match(HERMES_END_SH, /hermes --version/); assert.match(HERMES_END_SH, /venv\/bin\/python3/);
  assert.match(HERMES_END_SH, /end_session\(sid, "session_reset"\)/); assert.match(HERMES_END_SH, /print\("ok"\)/);
  assert.match(HERMES_LIST_PY, /ended_at/);
});

test("grupos do Hermes: uma sessão por remetente; só as do jid pedido; thread com o autor de cada fala", () => {
  assert.deepEqual(hermesGroupOfKey("agent:main:whatsapp:group:120363411106490634@g.us:5521923670743"), { jid: "120363411106490634@g.us", sender: "5521923670743" });
  assert.equal(hermesGroupOfKey("agent:main:whatsapp:dm:5521923670743"), null);
  const data = { sessions: [
    { id: "20261003_000000_aaaaaaaa", key: "agent:main:whatsapp:group:120363411106490634@g.us:5521923670743", name: "120363411106490634", user: "Diego", started: 1791030952, last: 1791031000, hidden: 0, ended: null },
    { id: "20261004_000000_bbbbbbbb", key: "agent:main:whatsapp:group:120363411106490634@g.us:554599710377", name: "120363411106490634", user: "", started: 1791136751, last: null, hidden: 0, ended: 1791200000 },
    { id: "20261005_000000_cccccccc", key: "agent:main:whatsapp:group:120363430573515865@g.us:5521923670743", name: "x", user: "Diego", started: 1791030390, last: null, hidden: 0, ended: null },
  ] };
  const s = hermesGroupSessions(data, "120363411106490634@g.us");
  assert.deepEqual(s.map((x) => [x.id, x.sender, x.nome, x.ended]), [["20261003_000000_aaaaaaaa", "5521923670743", "Diego", false], ["20261004_000000_bbbbbbbb", "554599710377", null, true]]);
  assert.deepEqual(hermesGroupSessions(null, "120363411106490634@g.us"), []);
  const autores = new Map(s.map((x) => [x.id, x.nome ?? `+${x.sender}`]));
  const t = threadFromHermes({ messages: [
    { sid: "20261003_000000_aaaaaaaa", role: "user", content: "Oi", ts: 1791030960, kind: null },
    { sid: "20261003_000000_aaaaaaaa", role: "assistant", content: "Oi, René.", ts: 1791030970, kind: null },
    { sid: "20261004_000000_bbbbbbbb", role: "user", content: "Status?", ts: 1791136760, kind: null },
  ] }, autores);
  assert.deepEqual(t.map((m) => [m.role, m.text, m.autor]), [["contact", "Oi", "Diego"], ["agent", "Oi, René.", undefined], ["contact", "Status?", "+554599710377"]]);
  assert.match(HERMES_GROUPS_PY, /chat_type = \?/); assert.match(HERMES_GROUPS_PY, /user_name/);
});

test("política do Hermes (.env → contrato do app): self-chat, open só com opt-in, '*' na lista, allowlist e pairing", () => {
  const { politicaHermes, hermesEnvOf } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const env = (o) => ({ mode: "", dm: "", allow: "", all: "", ...o });
  assert.deepEqual(politicaHermes(env({}), "5516900000001"), { dmPolicy: "allowlist", allowFrom: ["+5516900000001"] }, "sem nada = self-chat = só você");
  assert.deepEqual(politicaHermes(env({ mode: "bot", allow: "5516900000001,5521900000002" }), "5516900000001"), { dmPolicy: "allowlist", allowFrom: ["+5516900000001", "+5521900000002"] }, "bot + lista (pairing implícito) = lista");
  assert.deepEqual(politicaHermes(env({ mode: "bot", dm: "open", all: "true" }), null), { dmPolicy: "open", allowFrom: ["*"] });
  assert.deepEqual(politicaHermes(env({ mode: "bot", dm: "open" }), null).dmPolicy, "disabled", "open sem opt-in: o gateway nem sobe");
  assert.deepEqual(politicaHermes(env({ mode: "bot", dm: "allowlist", allow: "*" }), null).dmPolicy, "open");
  assert.deepEqual(politicaHermes(env({ mode: "bot" }), null), { dmPolicy: "pairing", allowFrom: [] });
  assert.deepEqual(politicaHermes(env({ mode: "bot", dm: "disabled", allow: "+5516900000001" }), null), { dmPolicy: "disabled", allowFrom: ["+5516900000001"] });
  const kv = new Map([["wamode", "bot"], ["wadm", "allowlist"], ["waallow", "1,2"], ["waall", ""]]);
  assert.deepEqual(hermesEnvOf(kv), { mode: "bot", dm: "allowlist", allow: "1,2", all: "" });
});

test("o que gravar por cartão e quando o gateway precisa reiniciar", () => {
  const { hermesEnvPara, hermesPrecisaReiniciar, HERMES_ENV_VALUE_RE } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  assert.deepEqual(hermesEnvPara("open", "5516900000001"), { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "open", WHATSAPP_ALLOWED_USERS: "*", WHATSAPP_ALLOW_ALL_USERS: "true" }, "todo mundo = lista \"*\": o bridge filtra as DMs pela lista e ignora open/ALLOW_ALL (box-1, 30 out)");
  assert.deepEqual(hermesEnvPara("self", "5516900000001"), { WHATSAPP_MODE: "self-chat", WHATSAPP_DM_POLICY: "allowlist", WHATSAPP_ALLOWED_USERS: "5516900000001", WHATSAPP_ALLOW_ALL_USERS: "false" });
  assert.deepEqual(hermesEnvPara("list", "5516900000001", ["5521900000002", "+55 21 90000-0002", "5516900000001"]).WHATSAPP_ALLOWED_USERS, "5516900000001,5521900000002", "sem repetidos, dono sempre, só dígitos");
  for (const v of Object.values(hermesEnvPara("list", "1", ["2"]))) assert.match(v, HERMES_ENV_VALUE_RE);
  const antes = { mode: "bot", dm: "", allow: "1,2", all: "" };
  assert.equal(hermesPrecisaReiniciar(antes, { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "pairing", WHATSAPP_ALLOWED_USERS: "1,2,3", WHATSAPP_ALLOW_ALL_USERS: "false" }), true, "só a lista mudou: o Hermes não a relê, reinicia");
  assert.equal(hermesPrecisaReiniciar(antes, { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "pairing", WHATSAPP_ALLOWED_USERS: "2,1", WHATSAPP_ALLOW_ALL_USERS: "false" }), false, "mesma lista em outra ordem: nada mudou");
  assert.equal(hermesPrecisaReiniciar(antes, hermesEnvPara("open", "1")), true, "política mudou");
  assert.equal(hermesPrecisaReiniciar(antes, hermesEnvPara("self", "1")), true, "modo mudou");
});

test("HERMES_ENV_SET_PY: troca a linha existente (com export/aspas), acrescenta a que falta e guarda backup", async () => {
  const { HERMES_ENV_SET_PY, HERMES_POLICY_PY } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { execSync } = await import("node:child_process");
  const path = await import("node:path");
  const home = mkdtempSync(path.join((await import("node:os")).tmpdir(), "meu-bot-hermes-env-"));
  try {
    mkdirSync(path.join(home, ".hermes"));
    writeFileSync(path.join(home, ".hermes", ".env"), 'export WHATSAPP_MODE="bot"\nWHATSAPP_ALLOWED_USERS=1,2\nOUTRA=x\n');
    const out = execSync(`${HERMES_ENV_SET_PY} 'WHATSAPP_MODE=self-chat' 'WHATSAPP_DM_POLICY=allowlist'`, { env: { ...process.env, HOME: home }, encoding: "utf8" });
    assert.match(out, /envset=ok/);
    assert.equal(readFileSync(path.join(home, ".hermes", ".env"), "utf8"), "WHATSAPP_MODE=self-chat\nWHATSAPP_ALLOWED_USERS=1,2\nOUTRA=x\nWHATSAPP_DM_POLICY=allowlist\n");
    assert.ok(readdirSync(path.join(home, ".hermes")).some((f) => f.startsWith(".env.bak-meu-bot-")), "backup ao lado");
    const lido = execSync(HERMES_POLICY_PY, { env: { ...process.env, HOME: home }, encoding: "utf8" });
    assert.equal(lido, "wamode=self-chat\nwadm=allowlist\nwaallow=1,2\nwaall=\n");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("grupos no Hermes: config.yaml/.env → contrato; política pairing/disabled não admite; open e '*' admitem tudo", () => {
  const { parseHermesGroupCfg, hermesEstadoDoGrupo, hermesTodosAdmitidos, HERMES_GROUP_CFG_SH } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const A = "120363410837573543@g.us", B = "120363428149657663@g.us", C = "120363427290582156@g.us";
  const cfg = parseHermesGroupCfg({ group_policy: "allowlist", group_allow_from: [A, B, "lixo", "5511999990000"], require_mention: "true", free_response_chats: `${B},x` });
  assert.deepEqual(cfg, { policy: "allowlist", allow: [A, B], requireMention: true, free: [B] });
  assert.equal(hermesEstadoDoGrupo(cfg, A), "mencao");
  assert.equal(hermesEstadoDoGrupo(cfg, B), "sempre", "exceção responde sempre");
  assert.equal(hermesEstadoDoGrupo(cfg, C), "desligado");
  assert.equal(hermesEstadoDoGrupo(null, A), "desligado", "sem config legível nada está ligado");
  assert.equal(parseHermesGroupCfg({ group_policy: "xyz" }).policy, "pairing");
  assert.equal(hermesEstadoDoGrupo(parseHermesGroupCfg({ group_policy: "pairing", group_allow_from: [A] }), A), "desligado", "pairing não admite grupo");
  assert.equal(hermesEstadoDoGrupo(parseHermesGroupCfg({ group_policy: "open" }), C), "sempre");
  assert.ok(hermesTodosAdmitidos(parseHermesGroupCfg({ group_policy: "allowlist", group_allow_from: "*" })) && !hermesTodosAdmitidos(cfg));
  assert.equal(parseHermesGroupCfg("x"), null);
  assert.ok(HERMES_GROUP_CFG_SH.includes("config.yaml") && HERMES_GROUP_CFG_SH.includes("WHATSAPP_GROUP_POLICY") && HERMES_GROUP_CFG_SH.includes("gcfg="));
});

test("config nova por pedido: ligar/desligar entra e sai da lista; 'quando chamado' liga a menção preservando os outros; último desliga tudo", () => {
  const { parseHermesGroupCfg, hermesGroupCfgPara, hermesEstadoDoGrupo, hermesGroupCfgSetSh } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const A = "120363410837573543@g.us", B = "120363428149657663@g.us", C = "120363427290582156@g.us";
  const base = parseHermesGroupCfg({ group_policy: "allowlist", group_allow_from: [A, B] }); // sem menção: A e B respondem sempre
  // ligar C "sempre": só entra na lista
  assert.deepEqual(hermesGroupCfgPara(base, C, { agente: "sempre" }), { policy: "allowlist", allow: [A, B, C], requireMention: false, free: [] });
  // ligar C "quando chamado": menção passa a valer; A e B viram exceção para não mudarem
  const m = hermesGroupCfgPara(base, C, { agente: "mencao" });
  assert.deepEqual(m, { policy: "allowlist", allow: [A, B, C], requireMention: true, free: [A, B] });
  assert.deepEqual([hermesEstadoDoGrupo(m, A), hermesEstadoDoGrupo(m, B), hermesEstadoDoGrupo(m, C)], ["sempre", "sempre", "mencao"]);
  // com menção ligada, "sempre" num grupo é entrar nas exceções; "quando chamado" é sair delas
  assert.deepEqual(hermesGroupCfgPara(m, C, { agente: "sempre" }).free, [A, B, C]);
  assert.deepEqual(hermesGroupCfgPara(m, A, { agente: "mencao" }).free, [B]);
  // sem mudança = null; desligar tira da lista e das exceções; desligar o último volta a disabled
  assert.equal(hermesGroupCfgPara(base, A, { agente: "sempre" }), null);
  assert.deepEqual(hermesGroupCfgPara(m, A, { agente: "desligado" }), { policy: "allowlist", allow: [B, C], requireMention: true, free: [B] });
  assert.deepEqual(hermesGroupCfgPara(parseHermesGroupCfg({ group_policy: "allowlist", group_allow_from: [A] }), A, { agente: "desligado" }), { policy: "disabled", allow: [], requireMention: false, free: [] });
  // sem config legível: ligar cria a lista
  assert.deepEqual(hermesGroupCfgPara(null, C, { agente: "sempre" }), { policy: "allowlist", allow: [C], requireMention: false, free: [] });
  // quem aciona é a lista única das conversas diretas: recusa com a explicação
  assert.throws(() => hermesGroupCfgPara(base, A, { quemAciona: "todos" }), /Quem o agente responde/);
  // todos admitidos: não dá para desligar um só
  assert.throws(() => hermesGroupCfgPara(parseHermesGroupCfg({ group_policy: "open" }), A, { agente: "desligado" }), /TODOS os grupos/);
  const sh = hermesGroupCfgSetSh(m);
  assert.ok(sh.includes("cfgset=ok") && sh.includes("bak-meu-bot") && sh.includes("ruamel") && /'[A-Za-z0-9+/=]+'$/.test(sh.trim()), "grava com backup e leva a config em base64");
});

test("gruposHermes: lista admitida + sessões do state.db; a sessão mais recente dá hora, chave e id; quem aciona é a lista das conversas diretas", () => {
  const { gruposHermes, parseHermesGroupCfg } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const A = "120363410837573543@g.us", C = "120363427290582156@g.us";
  const cfg = parseHermesGroupCfg({ group_policy: "allowlist", group_allow_from: [A], require_mention: true });
  const data = { sessions: [
    { id: "20261020_100000_aaaaaaaa", key: `agent:main:whatsapp:group:${A}:5511999990000`, name: "Buffer", user: "Diego", count: 3, started: 1760954400, last: 1760958000, hidden: 0, ended: null },
    { id: "20261024_100000_bbbbbbbb", key: `agent:main:whatsapp:group:${A}:5521988880000`, name: "Buffer", user: "Lucas", count: 1, started: 1761300000, last: 1761303600, hidden: 0, ended: null },
    { id: "20261001_100000_cccccccc", key: `agent:main:whatsapp:group:${C}:5521988880000`, name: "zohomail", user: "Lucas", count: 0, started: 1759312800, last: 1759312800, hidden: 0, ended: null },
    { id: "20261001_100000_dddddddd", key: "agent:main:whatsapp:dm:5521988880000", name: "Lucas", count: 2, started: 1, last: 1 },
  ] };
  const g = gruposHermes(cfg, data, "5521900000000:1@s.whatsapp.net", ["5521988880000"]);
  assert.deepEqual(g.grupos.map((x) => [x.jid, x.nome, x.agente, x.sessionId, x.updatedAt, x.agenteRespondeu, x.deleted]), [
    [A, "Buffer", "mencao", "20261024_100000_bbbbbbbb", new Date(1761303600 * 1000).toISOString(), true, false],
    [C, "zohomail", "desligado", "20261001_100000_cccccccc", new Date(1759312800 * 1000).toISOString(), false, false],
  ]);
  assert.deepEqual([g.quemAciona, g.quemAcionaHerdado, g.todosAdmitidos, g.skill, g.cacheEm, g.self], [["5521988880000"], false, false, false, null, "5521900000000"]);
  assert.deepEqual(gruposHermes(null, null, null, "todos").grupos, []);
  // O Hermes guarda a sessão de grupo com o id como nome ("120363…"): o nome vem do cache da skill quando ele existe.
  const semNome = { sessions: [{ id: "20260928_094822_2f280d1d", key: `agent:main:whatsapp:group:${C}:5521923670743`, name: C.split("@")[0], user: "Lucas", count: 283, started: 1759045702, last: 1761300000, hidden: 0, ended: null }] };
  const cache = { atualizadoEm: "2026-10-25T04:26:25.376Z", grupos: [{ jid: C, nome: "(Diego) MPT - Produção de Conteúdo", membros: 2, participantes: [{ jid: "5521923670743@s.whatsapp.net", phone: "5521923670743" }] }] };
  const h = gruposHermes(cfg, semNome, null, "todos", cache);
  const hc = h.grupos.find((x) => x.jid === C);
  assert.deepEqual([hc.nome, hc.membros, hc.participantes, hc.sessionId], ["(Diego) MPT - Produção de Conteúdo", 2, ["5521923670743"], "20260928_094822_2f280d1d"]);
  assert.equal(h.cacheEm, "2026-10-25T04:26:25.376Z");
  assert.equal(gruposHermes(cfg, semNome, null, "todos").grupos.find((x) => x.jid === C).nome, null, "sem cache, sem nome (o id não vira nome)");
});

test("pausa no Hermes: tira da lista (e devolve ao retomar), mantém o próprio número e os outros pausados fora; fixa allowlist; recusa pausar em só-você/todo-mundo/desligado", () => {
  const { hermesPausaPlano } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const env = { mode: "bot", dm: "", allow: "5516992294486,5522925501274,5521923670743", all: "" }; // dm vazio = pairing de fábrica
  const p = hermesPausaPlano(env, "5516992294486", "5522925501274", true, []);
  assert.deepEqual(p.patch, { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "allowlist", WHATSAPP_ALLOWED_USERS: "5516992294486,5521923670743", WHATSAPP_ALLOW_ALL_USERS: "false" });
  assert.equal(p.reinicia, true, "pairing → allowlist muda a política: reinicia");
  // já em allowlist: retomar devolve; outro pausado continua fora; a lista mudou → reinicia (o gateway não a relê)
  const env2 = { mode: "bot", dm: "allowlist", allow: "5516992294486,5521923670743", all: "false" };
  const r = hermesPausaPlano(env2, "5516992294486", "5522925501274", false, ["5522925501274", "5521923670743"]);
  assert.deepEqual(r.patch.WHATSAPP_ALLOWED_USERS, "5516992294486,5522925501274"); assert.equal(r.reinicia, true, "lista mudou: reinicia (box-2: sem isso o pausado seguiu respondido)");
  assert.throws(() => hermesPausaPlano({ mode: "self-chat", dm: "", allow: "", all: "" }, "1", "5522925501274", true, []), /só você/);
  assert.throws(() => hermesPausaPlano({ mode: "bot", dm: "open", allow: "", all: "true" }, "1", "5522925501274", true, []), /todo mundo/);
  assert.throws(() => hermesPausaPlano({ mode: "bot", dm: "allowlist", allow: "*", all: "" }, "1", "5522925501274", true, []), /todo mundo/);
  assert.throws(() => hermesPausaPlano({ mode: "bot", dm: "disabled", allow: "", all: "" }, "1", "5522925501274", true, []), /desligado/);
  assert.throws(() => hermesPausaPlano({ mode: "bot", dm: "open", allow: "", all: "true" }, "1", "5522925501274", false, []), /não há o que retomar/);
});

test("retomar no Hermes em \"só você\" ou desligado: a conversa clicada vira \"você e ele\" (lista), sem passar por Quem o agente responde", () => {
  const { hermesPausaPlano } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  // "só você" com lista velha de antes: a retomada parte do zero (só o próprio + o clicado), não ressuscita os outros
  const r = hermesPausaPlano({ mode: "self-chat", dm: "allowlist", allow: "595986120831,5521999999999", all: "false" }, "595986120831", "5521923670743", false, []);
  assert.deepEqual(r.patch, { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "allowlist", WHATSAPP_ALLOWED_USERS: "5521923670743,595986120831", WHATSAPP_ALLOW_ALL_USERS: "false" });
  assert.equal(r.reinicia, true, "self-chat → bot muda o modo: reinicia");
  const d = hermesPausaPlano({ mode: "bot", dm: "disabled", allow: "", all: "" }, "595986120831", "5521923670743", false, []);
  assert.equal(d.patch.WHATSAPP_DM_POLICY, "allowlist"); assert.equal(d.patch.WHATSAPP_ALLOWED_USERS, "5521923670743,595986120831"); assert.equal(d.reinicia, true);
});

test("hermesNaoResponde: quem a política de hoje deixa sem resposta aparece como pausado (o próprio nunca)", () => {
  const { hermesNaoResponde: n } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const self = "595986120831", outro = "5521923670743";
  assert.equal(n({ mode: "self-chat", dm: "allowlist", allow: "595986120831", all: "false" }, self, outro), true, "só você: todo mundo pausado");
  assert.equal(n({ mode: "self-chat", dm: "allowlist", allow: "595986120831", all: "false" }, self, self), false, "…menos o próprio");
  assert.equal(n({ mode: "bot", dm: "allowlist", allow: "595986120831", all: "false" }, self, outro), true, "fora da lista");
  assert.equal(n({ mode: "bot", dm: "allowlist", allow: "595986120831,5521923670743", all: "false" }, self, outro), false, "na lista");
  assert.equal(n({ mode: "bot", dm: "open", allow: "595986120831", all: "true" }, self, outro), false, "todo mundo");
  assert.equal(n({ mode: "bot", dm: "allowlist", allow: "*", all: "" }, self, outro), false, "* = todo mundo");
  assert.equal(n({ mode: "bot", dm: "open", allow: "", all: "" }, self, outro), true, "open sem opt-in = desligado");
  assert.equal(n({ mode: "bot", dm: "disabled", allow: "5521923670743", all: "" }, self, outro), true, "desligado: ninguém");
  assert.equal(n({ mode: "bot", dm: "pairing", allow: "", all: "" }, self, outro), false, "pairing manda código, não é pausa");
});

test("hermesPrecisaReiniciar: a lista também pede reinício (o Hermes 0.22.2 não a relê); igual em outra ordem, não", () => {
  const { hermesPrecisaReiniciar: p } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const antes = { mode: "bot", dm: "allowlist", allow: "1,2", all: "false" };
  assert.equal(p(antes, { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "allowlist", WHATSAPP_ALLOWED_USERS: "2,1", WHATSAPP_ALLOW_ALL_USERS: "false" }), false);
  assert.equal(p(antes, { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "allowlist", WHATSAPP_ALLOWED_USERS: "1", WHATSAPP_ALLOW_ALL_USERS: "false" }), true);
  assert.equal(p(antes, { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "open", WHATSAPP_ALLOW_ALL_USERS: "true" }), true, "sem a chave da lista no patch = lista mantida; muda a política");
  assert.equal(p({ mode: "bot", dm: "open", allow: "1,2", all: "true" }, { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "open", WHATSAPP_ALLOWED_USERS: "*", WHATSAPP_ALLOW_ALL_USERS: "true" }), true, "todo mundo gravado sem o \"*\" (versão antiga): a lista muda, reinicia");
});

test("hermesPausaModo: nativa > plugin (instalado E carregado na mesma versão) > allowlist; HERMES_PAUSA_SH olha o .ok e o marcador do register()", () => {
  const { hermesPausaModo, HERMES_PAUSA_SH } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const kv = (o) => new Map(Object.entries(o));
  assert.equal(hermesPausaModo(kv({})), "allowlist");
  assert.equal(hermesPausaModo(kv({ pausaplugin: "1.0.0", pausavivo: "1.0.0", pausanativa: "0" })), "plugin");
  assert.equal(hermesPausaModo(kv({ pausaplugin: "1.0.0", pausavivo: "", pausanativa: "0" })), "allowlist", "instalado mas o gateway de agora não o carregou: ainda é pela lista");
  assert.equal(hermesPausaModo(kv({ pausaplugin: "1.1.0", pausavivo: "1.0.0" })), "allowlist", "versões diferentes = reinício pendente");
  assert.equal(hermesPausaModo(kv({ pausaplugin: "lixo", pausavivo: "lixo" })), "allowlist");
  assert.equal(hermesPausaModo(kv({ pausaplugin: "", pausavivo: "", pausanativa: "1" })), "nativa");
  assert.ok(HERMES_PAUSA_SH.includes("meu-bot-pausa/.ok") && HERMES_PAUSA_SH.includes("whatsapp-pausa.carregado") && HERMES_PAUSA_SH.includes("pausanativa="));
});

test("dono ≠ pareado (agente num chip dedicado): os dois ficam na lista, \"só eu\" vira bot+allowlist, nenhum dos dois é \"não respondido\" nem pausado; na lista de conversas o dono ganha isDono", () => {
  const { politicaHermes, hermesEnvPara, hermesNaoResponde, hermesPausaPlano, chatsFromHermes, quemOf } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const self = "595986120831", dono = "5521923670743";
  const q = { self, dono };
  assert.deepEqual(quemOf(self), { self, dono: self }, "string = jeito antigo: o pareado é o dono");
  assert.deepEqual(hermesEnvPara("self", q), { WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "allowlist", WHATSAPP_ALLOWED_USERS: `${self},${dono}`, WHATSAPP_ALLOW_ALL_USERS: "false" }, "só eu com dono de fora: bot, não self-chat");
  assert.equal(hermesEnvPara("self", self).WHATSAPP_MODE, "self-chat", "dono == pareado: self-chat como sempre");
  assert.equal(hermesEnvPara("list", q, ["5511999990000"]).WHATSAPP_ALLOWED_USERS, `${self},${dono},5511999990000`);
  assert.deepEqual(politicaHermes({ mode: "self-chat", dm: "", allow: "", all: "" }, q).allowFrom, [`+${self}`, `+${dono}`]);
  const envBot = { mode: "bot", dm: "allowlist", allow: `${self},${dono}`, all: "false" };
  assert.equal(hermesNaoResponde(envBot, q, dono), false); assert.equal(hermesNaoResponde(envBot, q, self), false); assert.equal(hermesNaoResponde(envBot, q, "5511999990000"), true);
  const plano = hermesPausaPlano(envBot, q, "5511999990000", true, []);
  assert.equal(plano.patch.WHATSAPP_ALLOWED_USERS, `${self},${dono}`, "pausar um terceiro mantém os dois donos");
  const list = { sessions: [{ key: `agent:main:whatsapp:dm:${dono}`, id: "20261029_1", started: 1, last: 2, name: "Diego" }, { key: `agent:main:whatsapp:dm:${self}`, id: "20261029_2", started: 1, last: 3 }] };
  const chats = chatsFromHermes(list, q);
  assert.equal(chats.find((c) => c.number === dono).isDono, true); assert.equal(chats.find((c) => c.number === dono).isSelf, false);
  assert.equal(chats.find((c) => c.number === self).isSelf, true); assert.equal(chats.find((c) => c.number === self).isDono, false, "o pareado é self, não dono, quando há dono de fora");
  assert.equal(chatsFromHermes(list, self).find((c) => c.number === self).isDono, false, "dono == pareado: só isSelf");
});

test("Hermes: uma porta de bridge por usuário (root na 3000, os outros 3100 + uid − 1000) e o app lê a porta de cada um", async () => {
  const c = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  assert.deepEqual([0, 1000, 1001, 1042].map(c.portaBridgeHermes), [3000, 3100, 3101, 3142]);
  assert.match(c.HERMES_WA_ENSURE_SH, /bridge_port/);
  assert.match(c.HERMES_BRIDGE_PORT_SH, /platforms\/whatsapp\/bridge_port/);
  const { readFileSync } = await import("node:fs");
  // O status do Hermes mora no adaptador (whatsapp-hermes.js); a fachada (whatsapp.js) só monta o case por motor.
  for (const f of ["whatsapp.js", "whatsapp-hermes.js"]) assert.doesNotMatch(readFileSync(new URL(`../../dist/main/whatsapp/${f}`, import.meta.url), "utf8"), /127\.0\.0\.1:3000\/health/, `nada de porta 3000 fixa na consulta do bridge (${f})`);
});

test("hermesPmExtraSh: sem as ferramentas do pm, instala só as que ele listou e tenta o extra de novo", async () => {
  const { hermesPmExtraSh } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const { mkdtempSync, writeFileSync, readFileSync, chmodSync } = await import("node:fs");
  const { join } = await import("node:path"); const { tmpdir } = await import("node:os"); const { spawnSync } = await import("node:child_process");
  const roda = (faltam) => {
    const d = mkdtempSync(join(tmpdir(), "pm-extra-"));
    // hermes falso: o extra falha como o pm de verdade enquanto a marca das ferramentas não existe; grava cada chamada.
    writeFileSync(join(d, "hermes"), `#!/bin/sh\necho "$*" >> "${d}/chamadas"\nif [ "$1 $2 $3" = "pm install --extra" ]; then [ -f "${d}/ferramentas" ] && exit 0; ${faltam ? `echo "✗ tools not on PATH before venv sync: ffmpeg: not installed or outdated; ripgrep: not installed or outdated"` : `echo "erro de rede"`}; exit 1; fi\ntouch "${d}/ferramentas"\n`);
    // O macOS não tem timeout (a máquina é Linux): um que só repassa o comando.
    writeFileSync(join(d, "timeout"), `#!/bin/sh\nshift\nexec "$@"\n`);
    chmodSync(join(d, "hermes"), 0o755); chmodSync(join(d, "timeout"), 0o755);
    const r = spawnSync("bash", ["-c", `set -e\n${hermesPmExtraSh("stt-whisper")}`], { env: { ...process.env, HOME: d, PATH: `${d}:${process.env.PATH}` }, encoding: "utf8" });
    return { r, chamadas: readFileSync(join(d, "chamadas"), "utf8").trim().split("\n") };
  };
  const ok = roda(true);
  assert.equal(ok.r.status, 0); assert.match(ok.r.stdout, /extra=ok/);
  assert.deepEqual(ok.chamadas, ["pm install --extra stt-whisper", "pm install ffmpeg ripgrep", "pm install --extra stt-whisper"]);
  const ruim = roda(false);
  assert.equal(ruim.r.status, 3, "outro erro: não inventa ferramenta, falha"); assert.match(ruim.r.stdout, /extra=falhou/);
  assert.deepEqual(ruim.chamadas, ["pm install --extra stt-whisper"]);
});

test("transcritor compartilhado: o .env do usuário ganha (ou troca) só a linha do comando; o resto fica", async () => {
  const { HERMES_STT_COMPARTILHADO_SH, HERMES_STT_COMANDO } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const { mkdtempSync, writeFileSync, readFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path"); const { tmpdir } = await import("node:os"); const { spawnSync } = await import("node:child_process");
  assert.equal(HERMES_STT_COMANDO, "/opt/transcriber/bin/transcrever {input_path} {output_dir} {language}");
  const d = mkdtempSync(join(tmpdir(), "stt-env-")); mkdirSync(join(d, ".hermes"));
  writeFileSync(join(d, ".hermes/.env"), "WHATSAPP_MODE=bot\nHERMES_LOCAL_STT_COMMAND=velho\nX=1\n");
  // sed -i do Linux; no macOS (onde os testes rodam) o sed -i pede sufixo: o teste usa o gsed se houver, senão um shim.
  const r = spawnSync("bash", ["-c", `sed() { if [ "$1" = -i ]; then shift; command sed -i "" "$@"; else command sed "$@"; fi; }\n${HERMES_STT_COMPARTILHADO_SH}\n${HERMES_STT_COMPARTILHADO_SH}`], { env: { ...process.env, HOME: d }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(d, ".hermes/.env"), "utf8"), `WHATSAPP_MODE=bot\nX=1\nHERMES_LOCAL_STT_COMMAND="${HERMES_STT_COMANDO}"\n`, "duas vezes = uma linha só");
});

// Máquina falsa para os scripts do Hermes: HOME próprio, um `hermes` que grava cada chamada e aponta o "Python do
// Hermes" para um falso, que grava o patch do config (o último argumento, em base64) e responde cfgset=ok como o de
// verdade; e o sed -i do Linux (no macOS ele pede sufixo).
async function maquinaFalsa() {
  const { mkdtempSync, writeFileSync, mkdirSync, chmodSync } = await import("node:fs");
  const { join } = await import("node:path"); const { tmpdir } = await import("node:os");
  const d = mkdtempSync(join(tmpdir(), "hermes-falso-"));
  mkdirSync(join(d, ".hermes")); mkdirSync(join(d, "bin")); mkdirSync(join(d, "rt/venv/bin"), { recursive: true });
  writeFileSync(join(d, "bin/hermes"), `#!/bin/sh\necho "$*" >> "${d}/chamadas"\n[ "$1" = --version ] && echo "Install directory: ${d}/rt"\nexit 0\n`);
  writeFileSync(join(d, "rt/venv/bin/python"), `#!/bin/sh\nfor a; do ultimo=$a; done\necho "$ultimo" >> "${d}/patches"\necho cfgset=ok\n`);
  writeFileSync(join(d, "bin/timeout"), `#!/bin/sh\nshift\nexec "$@"\n`);
  for (const f of ["bin/hermes", "rt/venv/bin/python", "bin/timeout"]) chmodSync(join(d, f), 0o755);
  return d;
}
async function rodar(d, script) {
  const { spawnSync } = await import("node:child_process"); const { join } = await import("node:path");
  const sedLinux = `sed() { if [ "$1" = -i ]; then shift; command sed -i "" "$@"; else command sed "$@"; fi; }`;
  return spawnSync("bash", ["-c", `set -e\n${sedLinux}\n${script}`], { env: { ...process.env, HOME: d, PATH: `${join(d, "bin")}:${process.env.PATH}` }, encoding: "utf8" });
}
async function ler(d, f) {
  const { readFileSync, existsSync } = await import("node:fs"); const { join } = await import("node:path");
  return existsSync(join(d, f)) ? readFileSync(join(d, f), "utf8") : "";
}
const patchesDe = (txt) => txt.trim().split("\n").filter(Boolean).map((b) => JSON.parse(Buffer.from(b, "base64").toString("utf8")));

test("ativar transcrição: com o transcritor compartilhado da máquina, só aponta o Hermes; sem ele, instala o próprio", async () => {
  const { hermesSttLigarSh, HERMES_STT_COMANDO } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const { writeFileSync, chmodSync } = await import("node:fs"); const { join } = await import("node:path");

  // Máquina no padrão: o binário compartilhado existe.
  const a = await maquinaFalsa();
  const bin = join(a, "transcrever"); writeFileSync(bin, "#!/bin/sh\n"); chmodSync(bin, 0o755);
  writeFileSync(join(a, ".hermes/.env"), "WHATSAPP_MODE=bot\n");
  const ra = await rodar(a, hermesSttLigarSh(bin));
  assert.equal(ra.status, 0, ra.stderr);
  assert.match(ra.stdout, /^cfgset=ok$/m); assert.match(ra.stdout, /^stt=compartilhado$/m);
  assert.deepEqual(patchesDe(await ler(a, "patches")), [{ "stt.enabled": true, "stt.provider": "local_command", "stt.language": "pt" }]);
  assert.equal(await ler(a, ".hermes/.env"), `WHATSAPP_MODE=bot\nHERMES_LOCAL_STT_COMMAND="${HERMES_STT_COMANDO}"\n`);
  assert.doesNotMatch(await ler(a, "chamadas"), /pm install/, "nada de instalar por usuário: é só apontar");

  // Máquina de antes do padrão: sem o binário, instala o extra no ambiente deste usuário, como antes.
  const b = await maquinaFalsa();
  writeFileSync(join(b, ".hermes/.env"), "WHATSAPP_MODE=bot\n");
  const rb = await rodar(b, hermesSttLigarSh(join(b, "nao-existe")));
  assert.equal(rb.status, 0, rb.stderr);
  assert.match(rb.stdout, /^extra=ok$/m); assert.match(rb.stdout, /^cfgset=ok$/m); assert.match(rb.stdout, /^stt=proprio$/m);
  assert.match(await ler(b, "chamadas"), /^pm install --extra stt-whisper$/m);
  assert.deepEqual(patchesDe(await ler(b, "patches")), [{ "stt.enabled": true, "stt.provider": "local", "stt.language": "pt", "stt.local.model": "small", "stt.local.unload_after_idle_seconds": 300 }]);
  assert.equal(await ler(b, ".hermes/.env"), "WHATSAPP_MODE=bot\n", "o .env não ganha o comando compartilhado");
});

test("leitura do áudio do Hermes: local_command só conta como ouvindo com o comando no .env e o binário na máquina", async () => {
  const { hermesSttCmdSh, lerHermesAudio, HERMES_STT_COMPARTILHADO_SH } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");
  const { writeFileSync, chmodSync, rmSync } = await import("node:fs"); const { join } = await import("node:path");

  // A linha cmd= de verdade: sem .env, com o comando e o binário, e com o binário tirado pelo root.
  const d = await maquinaFalsa();
  const bin = join(d, "transcrever");
  const cmd = async () => /^cmd=([01])$/m.exec((await rodar(d, hermesSttCmdSh(bin))).stdout)?.[1];
  assert.equal(await cmd(), "0", "sem .env");
  writeFileSync(join(d, ".hermes/.env"), `HERMES_LOCAL_STT_COMMAND="${bin} {input_path} {output_dir} {language}"\n`);
  writeFileSync(bin, "#!/bin/sh\n"); chmodSync(bin, 0o755);
  assert.equal(await cmd(), "1", "comando no .env e binário executável");
  rmSync(bin);
  assert.equal(await cmd(), "0", "o root tirou o /opt/transcriber: não finge que ouve");
  writeFileSync(join(d, ".hermes/.env"), "HERMES_LOCAL_STT_COMMAND=\"whisper {input_path}\"\n");
  assert.equal(await cmd(), "1", "comando de outro transcritor: confia no que a pessoa pôs");
  assert.match(HERMES_STT_COMPARTILHADO_SH, /\/opt\/transcriber\/bin\/transcrever/);

  // O que a tela mostra, linha a linha.
  const base = "stt=1\ntts=inbound\n";
  assert.deepEqual(lerHermesAudio(`${base}prov=local_command\ncmd=1\nwhisper=0\n`), { audioIn: true, audioOut: "inbound" }, "box-2 hoje");
  assert.equal(lerHermesAudio(`${base}prov=local_command\ncmd=0\nwhisper=1\n`).audioIn, false, "o whisper próprio não vale para local_command");
  assert.equal(lerHermesAudio(`${base}prov=local\ncmd=1\nwhisper=0\n`).audioIn, false, "local sem faster-whisper não ouve");
  assert.equal(lerHermesAudio(`${base}prov=\nwhisper=1\n`).audioIn, true, "sem provedor o Hermes usa o local");
  assert.equal(lerHermesAudio(`${base}prov=groq\n`).audioIn, true, "provedor na nuvem: confia no config");
  assert.equal(lerHermesAudio("stt=0\ntts=off\nprov=local_command\ncmd=1\n").audioIn, false, "desligado");
  assert.equal(lerHermesAudio("prov=local_command\ncmd=1\n"), null, "sem stt= e tts= não inventa");
});
