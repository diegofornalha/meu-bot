import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// O plugin do Hermes é Python puro (stdlib): roda de verdade com o python3 do sistema, isolado (-I), num HOME falso.
const PLUGIN = join(import.meta.dirname, "..", "..", "backend-colima", "hermes-plugins", "meu-bot-pausa");
const semPython = spawnSync("python3", ["--version"]).status !== 0 ? "sem python3" : false;

const DRIVER = `
import asyncio, datetime, importlib.util, json, sys, types
spec = importlib.util.spec_from_file_location("meu_bot_pausa", sys.argv[1] + "/__init__.py"); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class Ctx:
    def __init__(s): s.hooks = {}; s.tools = {}
    def register_hook(s, n, f, **k): s.hooks[n] = f
    def register_tool(s, name=None, handler=None, **k): s.tools[name] = handler
class Adapter:
    def __init__(s, gw): s.gw = gw
    async def send(s, chat_id, content, **k): s.gw.enviadas.append([chat_id, content])
class Plat:
    value = "whatsapp"
class GW:
    def __init__(s, com_adapter): s.enviadas = []; s.adapters = {Plat(): Adapter(s)} if com_adapter else {}; s.voz = []
    def _delivery_adapter_for(s, src): return "adapter"
    def _voice_key_for_source(s, src): return "whatsapp:" + str(src.chat_id)
    def _apply_voice_mode(s, adapter, chave, chat_id, modo): s.voz.append([adapter, chave, chat_id, modo])
ctx = Ctx(); m.register(ctx)
cen = json.load(sys.stdin); gw = GW(cen.get("adapter", True))
out = {"hooks": list(ctx.hooks), "tools": list(ctx.tools), "versao": m.VERSAO, "passos": []}
for p in cen["passos"]:
    if "agora" in p: m._agora = (lambda t=p["agora"]: datetime.datetime.fromisoformat(t.replace("Z", "+00:00")))
    if p["t"] == "evento":
        src = types.SimpleNamespace(platform=Plat(), chat_type=p.get("chat_type", "dm"), chat_id=p.get("chat_id"), user_id=p.get("user_id"), user_id_alt=p.get("user_id_alt"), user_name=p.get("nome"))
        ev = types.SimpleNamespace(text=p.get("text", ""), message_type=p.get("tipo", "text"), user_id=p.get("user_id"), user_name=p.get("nome"), source=src, media_urls=[])
        out["passos"].append(asyncio.run(ctx.hooks["pre_gateway_dispatch"](event=ev, gateway=gw)))
    elif p["t"] == "tool":
        # "pos" = como o Hermes chama de verdade: os argumentos num dicionário, na primeira posição, e o contexto por nome.
        h = ctx.tools[p.get("tool", "pausar_conversa")]
        out["passos"].append(json.loads(h(p["pos"], **p.get("args", {})) if "pos" in p else h(**p["args"])))
out["enviadas"] = gw.enviadas; out["voz"] = gw.voz
print(json.dumps(out, ensure_ascii=False))
`;

const DONO = "595986120831", DIEGO = "5521923670743", OUTRO = "5511988887777", LID = "140029540204660";
const jid = (n) => `${n}@s.whatsapp.net`;
const T0 = "2026-10-29T13:00:00+00:00";

function homeFalso({ paused = {}, fuso = "America/Sao_Paulo", dono = null } = {}) {
  const home = mkdtempSync(join(tmpdir(), "pausa-"));
  mkdirSync(join(home, ".hermes", "whatsapp", "session"), { recursive: true });
  writeFileSync(join(home, ".hermes", "whatsapp", "session", "creds.json"), JSON.stringify({ me: { id: `${DONO}:8@s.whatsapp.net`, lid: "35503055339687:8@lid", name: "Daniel" } }));
  const d = join(home, ".local", "share", "meu-bot");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "whatsapp-lista.json"), JSON.stringify({ archived: { [OUTRO]: "2026-10-01T00:00:00Z" }, deleted: {}, names: { [DIEGO]: { name: "Diego", alias: null, at: "2026-10-01T00:00:00Z" } }, groupsDeleted: {}, groupNames: { "1@g.us": { alias: "Família", at: "2026-10-01T00:00:00Z" } }, paused, ...(dono === null ? {} : { dono: { numero: dono, desde: "2026-10-30T01:00:00Z" } }), extra: { fica: true } }, null, 1));
  writeFileSync(join(d, "fuso"), fuso);
  return home;
}
const rodar = (home, passos, adapter = true) => JSON.parse(execFileSync("python3", ["-I", "-c", DRIVER, PLUGIN, home], { input: JSON.stringify({ passos, adapter }), env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" }));
const lista = (home) => JSON.parse(readFileSync(join(home, ".local", "share", "meu-bot", "whatsapp-lista.json"), "utf8"));
const jsonl = (home) => { const p = join(home, ".local", "share", "meu-bot", "whatsapp-pausados.jsonl"); return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; };
const evento = (de, text, extra = {}) => ({ t: "evento", user_id: jid(de), chat_id: jid(de), nome: de === DIEGO ? "Diego" : null, text, ...extra });

test("register: só o hook pre_gateway_dispatch e a ferramenta; a versão do módulo é a do plugin.yaml; grava o marcador de carregado", { skip: semPython }, () => {
  const home = homeFalso();
  const r = rodar(home, []);
  assert.deepEqual(r.hooks, ["pre_gateway_dispatch"]);
  assert.deepEqual(r.tools, ["pausar_conversa", "audio_da_conversa"]);
  const yaml = readFileSync(join(PLUGIN, "plugin.yaml"), "utf8");
  assert.equal(r.versao, /^version:\s*"?([\w.-]+)"?/m.exec(yaml)[1]);
  const carregado = JSON.parse(readFileSync(join(home, ".local", "share", "meu-bot", "whatsapp-pausa.carregado"), "utf8"));
  assert.equal(carregado.versao, r.versao);
});

test("dono nunca é descartado (mesmo marcado como pausado) e não pode ser pausado; grupos passam reto", { skip: semPython }, () => {
  const home = homeFalso({ paused: { [DONO]: "2026-10-29T12:00:00Z", [DIEGO]: { desde: "2026-10-29T12:00:00Z", ate: null, por: "app" } } });
  const r = rodar(home, [
    { agora: T0, ...evento(DONO, "oi eu mesmo") },
    evento(DONO, `/pausar ${DONO} 2h`),
    { t: "evento", user_id: jid(DIEGO), chat_id: "123@g.us", chat_type: "group", text: "/pausar 2h" },
  ]);
  assert.equal(r.passos[0], null, "dono passa");
  assert.equal(r.passos[1].action, "skip"); assert.match(r.enviadas[0][1], /Você é o dono/);
  assert.equal(r.passos[2], null, "grupo não é tratado");
  assert.equal(lista(home).paused[DONO], undefined, "a marca do dono foi apagada ao normalizar");
  assert.equal(jsonl(home).length, 0);
});

test("contato pausado (formato antigo, string ISO): mensagem descartada e guardada; mídia vira [áudio]; /retomar dele é silêncio", { skip: semPython }, () => {
  const home = homeFalso({ paused: { [DIEGO]: "2026-10-29T12:00:00Z" } });
  const r = rodar(home, [
    { agora: T0, ...evento(DIEGO, "tá aí?") },
    evento(DIEGO, "", { tipo: "voice" }),
    evento(DIEGO, "/retomar"),
  ]);
  for (const p of r.passos) { assert.equal(p.action, "skip"); assert.match(p.reason, /pausado até retomar/); }
  const l = jsonl(home);
  assert.equal(l.length, 3);
  assert.deepEqual(l[0], { numero: DIEGO, nome: "Diego", texto: "tá aí?", em: "2026-10-29T13:00:00Z", tipo: "text" });
  assert.equal(l[1].texto, "[áudio]"); assert.equal(l[1].tipo, "voice");
  assert.deepEqual(r.enviadas, [], "pausado não recebe resposta nenhuma");
  const p = lista(home).paused[DIEGO];
  assert.deepEqual(p, { desde: "2026-10-29T12:00:00Z", ate: null, por: "app" }, "string antiga virou objeto ao regravar");
});

test("expiração: pausa vencida some sem mexer nas outras chaves; a primeira mensagem de texto depois traz a nota única e limpa o jsonl só daquele número", { skip: semPython }, () => {
  const home = homeFalso({ paused: { [DIEGO]: { desde: "2026-10-29T10:00:00Z", ate: "2026-10-29T12:00:00Z", por: "contato" } } });
  const antes = lista(home);
  const r = rodar(home, [
    { agora: "2026-10-29T10:12:00+00:00", ...evento(DIEGO, "oi, tá aí?") },
    { agora: "2026-10-29T11:05:00+00:00", ...evento(DIEGO, "preciso do orçamento") },
    { agora: "2026-10-29T11:06:00+00:00", ...evento(OUTRO, "outra pessoa escreveu") },
    { agora: T0, ...evento(DIEGO, "", { tipo: "voice" }) },
    { agora: "2026-10-29T13:01:00+00:00", ...evento(DIEGO, "e aí?") },
    { agora: "2026-10-29T13:02:00+00:00", ...evento(DIEGO, "de novo") },
  ]);
  assert.equal(r.passos[0].action, "skip"); assert.equal(r.passos[1].action, "skip");
  assert.equal(r.passos[2], null, "quem não está pausado passa");
  assert.equal(r.passos[3], null, "vencida: áudio passa normal e a nota espera um texto");
  assert.equal(r.passos[4].action, "rewrite");
  const nota = r.passos[4].text;
  assert.match(nota, /^\[Nota do meu-bot\] Diego \(\+5521923670743\) esteve pausado/);
  assert.ok(nota.indexOf("07:12 — oi, tá aí?") < nota.indexOf("08:05 — preciso do orçamento"), "em ordem e no fuso de São Paulo");
  assert.match(nota, /sem responder uma a uma/);
  assert.match(nota, /\n\nMensagem atual: e aí\?$/);
  assert.equal(r.passos[5], null, "a nota vai uma vez só");
  const depois = lista(home);
  assert.equal(depois.paused[DIEGO], undefined);
  assert.deepEqual(depois.archived, antes.archived); assert.deepEqual(depois.names, antes.names); assert.deepEqual(depois.groupNames, antes.groupNames); assert.deepEqual(depois.extra, antes.extra);
  assert.deepEqual(jsonl(home), [], "nada de outro número ficou guardado (OUTRO não estava pausado)");
  assert.ok(!readdirSync(join(home, ".local", "share", "meu-bot")).some((f) => f.includes(".tmp")), "sem arquivo temporário sobrando");
});

test("comandos do contato: só a própria conversa, só 2h ou 24h; resposta pelo adapter e marca com prazo", { skip: semPython }, () => {
  const home = homeFalso();
  const r = rodar(home, [
    { agora: T0, ...evento(DIEGO, "/pausar") },
    evento(DIEGO, `/pausar ${OUTRO} 2h`),
    evento(DIEGO, "/retomar"),
    evento(DIEGO, "/pausar 2 horas"),
    evento(DIEGO, "agora estou pausado?"),
  ]);
  assert.deepEqual(r.passos.slice(0, 4).map((p) => p.action), ["skip", "skip", "skip", "skip"]);
  assert.deepEqual(r.enviadas.map((e) => e[1]), [
    "Diga o prazo: /pausar 2h ou /pausar 24h.",
    "Só consigo pausar esta conversa: /pausar 2h ou /pausar 24h.",
    "Não estou pausado aqui.",
    "Ok, pausei por 2 horas. Volto a responder às 12:00.",
  ]);
  assert.ok(r.enviadas.every((e) => e[0] === jid(DIEGO)), "responde no chat de quem mandou");
  assert.deepEqual(lista(home).paused[DIEGO], { desde: "2026-10-29T13:00:00Z", ate: "2026-10-29T15:00:00Z", por: "contato" });
  assert.equal(r.passos[4].action, "skip", "já pausado"); assert.equal(jsonl(home).length, 1);
});

test("comandos do dono: pausa qualquer número com ou sem prazo, lista e retoma; sem adapter a resposta vai pelo agente (rewrite)", { skip: semPython }, () => {
  const home = homeFalso();
  const r = rodar(home, [
    { agora: T0, ...evento(DONO, `/pausar ${DIEGO} 24h`) },
    evento(DONO, `/pausar +55 11 98888-7777`),
    evento(DONO, "/pausar 999"),
    evento(DIEGO, "mensagem guardada"),
    evento(DONO, "/pausados"),
    evento(DONO, `/retomar ${DIEGO}`),
    evento(DONO, `/retomar ${DIEGO}`),
  ]);
  const textos = r.enviadas.map((e) => e[1]);
  assert.equal(textos[0], "Pausei +5521923670743 por 1 dia (até 30/10 10:00).");
  assert.equal(textos[1], "Pausei +5511988887777 até você retomar (/retomar 5511988887777).");
  assert.equal(textos[2], "Não entendi o número. Use /pausar <número com DDI> [2h|24h].");
  assert.equal(r.passos[3].action, "skip");
  assert.equal(textos[3], "Pausados: +5511988887777 até retomar (0 msgs); +5521923670743 até 30/10 10:00 (1 msgs).");
  assert.equal(textos[4], "Retomei +5521923670743. 1 mensagem guardada vai para o agente na próxima dele.");
  assert.equal(textos[5], "+5521923670743 não estava pausado.");
  assert.deepEqual(lista(home).paused[DIEGO], undefined);
  assert.deepEqual(lista(home).paused[OUTRO], { desde: "2026-10-29T13:00:00Z", ate: null, por: "dono" });
  assert.equal(jsonl(home).length, 1, "retomar não apaga o guardado: a nota é que limpa");
  const semAdapter = rodar(homeFalso(), [{ agora: T0, ...evento(DONO, `/pausar ${DIEGO} 2h`) }], false);
  assert.equal(semAdapter.passos[0].action, "rewrite");
  assert.match(semAdapter.passos[0].text, /Responda ao contato exatamente com: «Pausei \+5521923670743 por 2 horas \(até 12:00\)\.»/);
});

test("LID: aprende o par quando o evento traz número e LID; depois reconhece o pausado só pelo LID; LID desconhecido passa (fail-open)", { skip: semPython }, () => {
  const home = homeFalso({ paused: { [DIEGO]: { desde: "2026-10-29T12:00:00Z", ate: null, por: "app" } } });
  const r = rodar(home, [
    { agora: T0, t: "evento", user_id: jid(DIEGO), chat_id: `${LID}@lid`, nome: "Diego", text: "oi" },
    { t: "evento", user_id: `${LID}@lid`, chat_id: `${LID}@lid`, nome: "Diego", text: "de novo" },
    { t: "evento", user_id: "999999999999999@lid", chat_id: "999999999999999@lid", text: "quem sou eu" },
  ]);
  assert.equal(r.passos[0].action, "skip"); assert.equal(r.passos[1].action, "skip", "casou pelo LID aprendido");
  assert.equal(r.passos[2], null, "LID sem mapa não é descartado");
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".local", "share", "meu-bot", "whatsapp-lid.json"), "utf8")), { [LID]: DIEGO });
});

test("ferramenta do agente: só a conversa da sessão atual, só 2 ou 24 h; sem sessão conhecida orienta o /pausar", { skip: semPython }, () => {
  const home = homeFalso();
  const r = rodar(home, [
    { agora: T0, t: "tool", args: { horas: 2, session_key: `agent:main:whatsapp:dm:${DIEGO}` } },
    { t: "tool", args: { horas: 3, session_key: `agent:main:whatsapp:dm:${OUTRO}` } },
    { t: "tool", args: { horas: 2 } },
    { t: "tool", args: { horas: 24, session_key: `agent:main:whatsapp:dm:${DONO}` } },
  ]);
  assert.equal(r.passos[0].ok, true); assert.match(r.passos[0].mensagem, /volta às 12:00/);
  assert.equal(r.passos[1].ok, false); assert.match(r.passos[1].mensagem, /2 ou 24/);
  assert.equal(r.passos[2].ok, false); assert.match(r.passos[2].mensagem, /\/pausar 2h/);
  assert.equal(r.passos[3].ok, false); assert.match(r.passos[3].mensagem, /dono/);
  assert.equal(lista(home).paused[DIEGO].ate, "2026-10-29T15:00:00Z"); assert.equal(lista(home).paused[OUTRO], undefined);
});

test("áudio da conversa: a ferramenta liga o modo de voz do gateway só para a conversa da sessão; sem mensagem vista, orienta o /voice off", { skip: semPython }, () => {
  const home = homeFalso();
  const sess = (n) => ({ session_key: `agent:main:whatsapp:dm:${n}` });
  const r = rodar(home, [
    { agora: T0, t: "tool", tool: "audio_da_conversa", args: { responder_em_audio: false, ...sess(DIEGO) } },
    { t: "evento", chat_id: `${LID}@lid`, user_id: jid(DIEGO), user_id_alt: `${LID}@lid`, text: "pode parar de me responder em áudio?" },
    { t: "tool", tool: "audio_da_conversa", args: { responder_em_audio: false, ...sess(DIEGO) } },
    { t: "tool", tool: "audio_da_conversa", args: { responder_em_audio: true, ...sess(DIEGO) } },
    { t: "tool", tool: "audio_da_conversa", args: { responder_em_audio: false, ...sess(OUTRO) } },
    { t: "tool", tool: "audio_da_conversa", args: { responder_em_audio: "não", ...sess(DIEGO) } },
  ]);
  assert.equal(r.passos[0].ok, false); assert.match(r.passos[0].mensagem, /\/voice off/, "gateway recém-reiniciado: ainda não viu a conversa");
  assert.equal(r.passos[1], null, "a mensagem segue normal para o agente");
  assert.equal(r.passos[2].ok, true); assert.match(r.passos[2].mensagem, /só texto/);
  assert.equal(r.passos[3].ok, true);
  assert.equal(r.passos[4].ok, false, "outra conversa não é mexida");
  assert.equal(r.passos[5].ok, false);
  // A chave e o chat são os do evento (aqui, o LID), como o /voice do Hermes faria.
  assert.deepEqual(r.voz, [["adapter", `whatsapp:${LID}@lid`, `${LID}@lid`, "off"], ["adapter", `whatsapp:${LID}@lid`, `${LID}@lid`, "voice_only"]]);
});

test("ferramentas como o Hermes chama: argumentos num dicionário e só o id curto da sessão; o número vem do state.db", { skip: semPython }, () => {
  const home = homeFalso();
  execFileSync("python3", ["-I", "-c", `import sqlite3, sys
c = sqlite3.connect(sys.argv[1]); c.execute("create table sessions (id text primary key, session_key text)")
c.execute("insert into sessions values (?, ?)", ("20261118_225127_be7d4a8a", "agent:main:whatsapp:dm:${DIEGO}")); c.commit()`, join(home, ".hermes", "state.db")]);
  const ctxHermes = { task_id: "t1", session_id: "20261118_225127_be7d4a8a", user_task: "x" };
  const r = rodar(home, [
    { agora: T0, t: "evento", chat_id: `${LID}@lid`, user_id: jid(DIEGO), user_id_alt: `${LID}@lid`, text: "para de mandar áudio" },
    { t: "tool", tool: "audio_da_conversa", pos: { responder_em_audio: false }, args: ctxHermes },
    { t: "tool", tool: "pausar_conversa", pos: { horas: 2 }, args: ctxHermes },
    { t: "tool", tool: "audio_da_conversa", pos: { responder_em_audio: false }, args: { ...ctxHermes, session_id: "desconhecida" } },
  ]);
  assert.equal(r.passos[1].ok, true, JSON.stringify(r.passos[1]));
  assert.deepEqual(r.voz, [["adapter", `whatsapp:${LID}@lid`, `${LID}@lid`, "off"]]);
  assert.equal(r.passos[2].ok, true, JSON.stringify(r.passos[2])); assert.equal(lista(home).paused[DIEGO].ate, "2026-10-29T15:00:00Z");
  assert.equal(r.passos[3].ok, false, "sessão que não está no banco: não mexe em conversa nenhuma");
});

test("fail-open: lista corrompida = ninguém pausado; pasta sem escrita não derruba o hook", { skip: semPython }, () => {
  const home = homeFalso();
  const d = join(home, ".local", "share", "meu-bot");
  writeFileSync(join(d, "whatsapp-lista.json"), "{garbage");
  let r = rodar(home, [{ agora: T0, ...evento(DIEGO, "oi") }]);
  assert.equal(r.passos[0], null);
  chmodSync(d, 0o500);
  try {
    r = rodar(home, [{ agora: T0, ...evento(DIEGO, "/pausar 2h") }, evento(DIEGO, "oi")]);
    assert.ok(r.passos[0] === null || r.passos[0].action === "skip", "comando com disco travado não quebra");
    assert.equal(r.passos[1], null);
  } finally { chmodSync(d, 0o700); }
});

test("dono gravado pelo app (chip dedicado): do celular dele manda como dono, nunca é descartado, a marca nele some; o pareado continua dono; trocar o arquivo vale na hora", { skip: semPython }, () => {
  const home = homeFalso({ dono: DIEGO, paused: { [DIEGO]: "2026-10-29T12:00:00Z" } });
  const r = rodar(home, [
    { agora: T0, ...evento(DIEGO, "oi, sou o dono agora") },
    evento(DIEGO, `/pausar ${OUTRO} 2h`),
    evento(DIEGO, "/pausados"),
    evento(DONO, `/pausar ${DIEGO}`),
  ]);
  assert.equal(r.passos[0], null, "o dono gravado passa mesmo com marca de pausa nele");
  assert.equal(lista(home).paused[DIEGO], undefined, "a marca no dono foi apagada");
  assert.equal(r.passos[1].action, "skip"); assert.match(r.enviadas[0][1], /^Pausei \+5511988887777 por 2 horas/);
  assert.match(r.enviadas[1][1], /^Pausados: \+5511988887777/);
  assert.match(r.enviadas[2][1], /Você é o dono/, "o pareado também é dono e não pausa o outro dono");
  // Trocar o dono no arquivo (mtime novo) vale na próxima mensagem, sem reiniciar.
  const f = JSON.parse(readFileSync(join(home, ".local", "share", "meu-bot", "whatsapp-lista.json"), "utf8"));
  delete f.dono; writeFileSync(join(home, ".local", "share", "meu-bot", "whatsapp-lista.json"), JSON.stringify(f));
  const r2 = rodar(home, [{ agora: "2026-10-29T13:05:00+00:00", ...evento(DIEGO, `/pausar ${OUTRO} 2h`) }]);
  assert.match(r2.enviadas[0][1], /Só consigo pausar esta conversa/, "sem a marca, o Diego volta a ser contato comum");
});
