import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// O plugin do Hermes é Python puro (stdlib): roda de verdade com o python3 do sistema, isolado (-I), num HOME falso, com
// um `gateway.session_context` de mentira no lugar do Hermes. O que ele grava é conferido pelo backend de verdade.
const PLUGIN = join(import.meta.dirname, "..", "..", "backend-colima", "hermes-plugins", "meu-bot-navegador");
const nw = createRequire(import.meta.url)("../../backend-colima/navegador-whatsapp.js");
const semPython = spawnSync("python3", ["--version"]).status !== 0 ? "sem python3" : false;

const DRIVER = `
import importlib.util, json, sys, types
cen = json.load(sys.stdin)
gw = types.ModuleType("gateway"); sc = types.ModuleType("gateway.session_context")
sessao = {}
sc.get_session_env = lambda nome, padrao="": sessao.get(nome, padrao)
if not cen.get("sem_hermes"): sys.modules["gateway"] = gw; sys.modules["gateway.session_context"] = sc
spec = importlib.util.spec_from_file_location("meu_bot_navegador", sys.argv[1] + "/__init__.py"); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class Ctx:
    def __init__(s): s.hooks = {}
    def register_hook(s, n, f, **k): s.hooks[n] = f
ctx = Ctx(); m.register(ctx)
m._agora = lambda: cen.get("agora", 1800000000)
out = {"hooks": list(ctx.hooks), "versao": m.VERSAO, "passos": []}
for p in cen["passos"]:
    sessao.clear(); sessao.update(p.get("sessao", {}))
    out["passos"].append(ctx.hooks["pre_llm_call"](**p.get("kwargs", {})))
print(json.dumps(out))
`;
const DONO = "5516992294486", OUTRO = "5511988887777", LID = "108263945310425";
function maquina({ on = true, numeros = [DONO], lids = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), "hermes-nav-"));
  const d = join(home, ".local/share/meu-bot"); mkdirSync(d, { recursive: true });
  if (on !== null) writeFileSync(join(d, "navegador-whatsapp.json"), JSON.stringify({ v: 1, on, numeros }));
  writeFileSync(join(d, "whatsapp-lid.json"), JSON.stringify(lids));
  writeFileSync(join(d, "navegador-porta"), "19123");
  return { home, d };
}
function rodar(home, cen) {
  const r = spawnSync("python3", ["-I", "-c", DRIVER, PLUGIN], { input: JSON.stringify(cen), env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const dm = (numero, mais = {}) => ({ kwargs: { platform: "whatsapp", sender_id: `${numero}@s.whatsapp.net`, session_id: "s1" }, sessao: { HERMES_SESSION_PLATFORM: "whatsapp", HERMES_SESSION_CHAT_TYPE: "dm", HERMES_SESSION_KEY: `agent:main:whatsapp:dm:${numero}`, HERMES_SESSION_USER_ID: `${numero}@s.whatsapp.net`, ...mais } });
const passes = (d) => { try { return readdirSync(join(d, "navegador-passes")); } catch { return []; } };

test("a versão do módulo é a do plugin.yaml e o hook registrado é o pre_llm_call", { skip: semPython }, () => {
  const { home } = maquina();
  const o = rodar(home, { passos: [] });
  assert.deepEqual(o.hooks, ["pre_llm_call"]);
  assert.match(readFileSync(join(PLUGIN, "plugin.yaml"), "utf8"), new RegExp(`^version: "${o.versao.replace(/\./g, "\\.")}"$`, "m"));
  assert.equal(JSON.parse(readFileSync(join(home, ".local/share/meu-bot/navegador-whatsapp.carregado"), "utf8")).versao, o.versao);
});

test("número marcado, conversa direta: emite o passe (pasta 0700, arquivo 0600) e o backend de verdade o aceita uma vez só", { skip: semPython }, () => {
  const { home, d } = maquina();
  const o = rodar(home, { passos: [dm(DONO)] });
  const m = /^\[meu-bot-nav:([0-9a-f]{32})\]$/.exec(o.passos[0].context);
  assert.ok(m, JSON.stringify(o.passos));
  assert.deepEqual(passes(d), [`${m[1]}.json`]);
  assert.equal(statSync(join(d, "navegador-passes")).mode & 0o777, 0o700);
  assert.equal(statSync(join(d, "navegador-passes", `${m[1]}.json`)).mode & 0o777, 0o600);
  const msgs = [{ role: "user", content: `está vendo o navegador aí?\n\n${o.passos[0].context}` }];
  const r = nw.resolverTurno({ messages: msgs, dir: d, agoraMs: 1_800_000_000_000 + 5000 });
  assert.deepEqual(r.browser, { port: 19123, dono: { id: `agent:main:whatsapp:dm:${DONO}`, rotulo: "WhatsApp", origem: "whatsapp" } });
  assert.equal(r.messages[0].content, "está vendo o navegador aí?");
  assert.equal(nw.resolverTurno({ messages: msgs, dir: d, agoraMs: 1_800_000_000_000 + 6000 }).browser, null, "o mesmo passe não vale de novo");
  assert.equal(nw.resolverTurno({ messages: msgs, dir: maquina().d, agoraMs: 1_800_000_000_000 + 181_000 }).browser, null);
});

test("quem não está na lista, grupo, outra plataforma, desligado, lista vazia e sem estado: nenhum passe", { skip: semPython }, () => {
  const casos = [
    ["fora da lista", {}, dm(OUTRO)],
    ["grupo", {}, dm(DONO, { HERMES_SESSION_CHAT_TYPE: "group", HERMES_SESSION_KEY: "agent:main:whatsapp:group:1203@g.us" })],
    ["chave de grupo com tipo dm", {}, dm(DONO, { HERMES_SESSION_KEY: "agent:main:whatsapp:group:1203@g.us" })],
    ["sem tipo de conversa", {}, dm(DONO, { HERMES_SESSION_CHAT_TYPE: "" })],
    ["telegram", {}, { ...dm(DONO), kwargs: { platform: "telegram", sender_id: DONO } }],
    ["desligado", { on: false }, dm(DONO)],
    ["lista vazia", { numeros: [] }, dm(DONO)],
    ["sem estado", { on: null }, dm(DONO)],
    ["sem remetente", {}, { kwargs: { platform: "whatsapp" }, sessao: { HERMES_SESSION_CHAT_TYPE: "dm" } }],
  ];
  for (const [nome, cfg, passo] of casos) {
    const { home, d } = maquina(cfg);
    assert.deepEqual(rodar(home, { passos: [passo] }).passos, [null], nome);
    assert.deepEqual(passes(d), [], nome);
  }
});

test("remetente só com LID: vale pelo mapa do app; sem mapa, ou com dois números diferentes no mesmo turno, não vale", { skip: semPython }, () => {
  const lid = { kwargs: { platform: "whatsapp", sender_id: `${LID}@lid` }, sessao: { HERMES_SESSION_CHAT_TYPE: "dm", HERMES_SESSION_KEY: `agent:main:whatsapp:dm:${LID}`, HERMES_SESSION_USER_ID: `${LID}@lid` } };
  const com = maquina({ lids: { [LID]: DONO } });
  assert.match(rodar(com.home, { passos: [lid] }).passos[0].context, /^\[meu-bot-nav:/);
  const sem = maquina();
  assert.deepEqual(rodar(sem.home, { passos: [lid] }).passos, [null]);
  // O LID só no sender_id e o número em user_id_alt (o caso comum no WhatsApp): vale o número.
  const alt = maquina();
  assert.match(rodar(alt.home, { passos: [{ ...lid, sessao: { ...lid.sessao, HERMES_SESSION_USER_ID_ALT: `${DONO}@s.whatsapp.net` } }] }).passos[0].context, /^\[meu-bot-nav:/);
  const dois = maquina({ numeros: [DONO, OUTRO] });
  assert.deepEqual(rodar(dois.home, { passos: [dm(DONO, { HERMES_SESSION_USER_ID_ALT: `${OUTRO}@s.whatsapp.net` })] }).passos, [null], "dois números para o mesmo turno = dúvida");
});

test("fora do Hermes (sem gateway.session_context): não sabe o tipo da conversa, não emite", { skip: semPython }, () => {
  const { home, d } = maquina();
  assert.deepEqual(rodar(home, { sem_hermes: true, passos: [dm(DONO)] }).passos, [null]);
  assert.deepEqual(passes(d), []);
});
