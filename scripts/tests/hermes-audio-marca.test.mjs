import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// "Sempre" e "Só o áudio" do WhatsApp no Hermes (CONTORNO #7): a marca que o app grava, o que o plugin meu-bot-pausa
// faz com ela num gateway de mentira (os mesmos nomes do Hermes: _voice_mode, _apply_voice_mode, send_voice,
// _play_tts_file, _send_final_text) e a leitura do estado para a tela.
const PLUGIN = join(import.meta.dirname, "..", "..", "backend-colima", "hermes-plugins", "meu-bot-pausa");
const semPython = spawnSync("python3", ["--version"]).status !== 0 ? "sem python3" : false;
const core = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-core.js");

const DRIVER = `
import asyncio, importlib.util, json, sys, types
spec = importlib.util.spec_from_file_location("meu_bot_pausa", sys.argv[1] + "/__init__.py"); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class Ctx:
    def __init__(s): s.hooks = {}
    def register_hook(s, n, f, **k): s.hooks[n] = f
    def register_tool(s, **k): pass
class Plat:
    value = "whatsapp"
class Adapter:
    def __init__(s): s.log = []; s.voz_ok = True; s._auto_tts_enabled_chats = set()
    async def send_voice(s, chat_id=None, audio_path=None, **k):
        s.log.append(["voz", chat_id, s.voz_ok]); return types.SimpleNamespace(success=s.voz_ok)
    async def _play_tts_file(s, event, text, path, first, metadata, registrar):
        r = await s.send_voice(chat_id=event.source.chat_id, audio_path=path); registrar(r); return False
    async def _send_final_text(s, event, session_key, text, metadata, efemera, ttl, registrar):
        s.log.append(["texto", event.source.chat_id, text]); registrar(types.SimpleNamespace(success=True))
class GW:
    def __init__(s): s.a = Adapter(); s._voice_mode = {}; s.salvou = 0
    def _delivery_adapter_for(s, src): return s.a
    def _voice_key_for_source(s, src): return "whatsapp:" + str(src.chat_id)
    def _apply_voice_mode(s, adapter, chave, chat_id, modo): s._voice_mode[chave] = modo; adapter._auto_tts_enabled_chats.add(chat_id)
    def _save_voice_modes(s): s.salvou += 1
    def _toggle_adapter_auto_tts_set(s, adapter, chat_id, on, *, enable): adapter._auto_tts_enabled_chats.discard(chat_id)
ctx = Ctx(); m.register(ctx); gw = GW(); entregas = []
def ev(chat): return types.SimpleNamespace(text="oi", message_type="text", user_id=chat, user_name=None, media_urls=[], source=types.SimpleNamespace(platform=Plat(), chat_type="dm", chat_id=chat, user_id=chat, user_id_alt=None, user_name=None))
async def passo(p):
    if "marca" in p:
        import os, time
        f = os.path.expanduser("~/.local/share/meu-bot/whatsapp-lista.json"); json.dump(p["marca"], open(f, "w")); os.utime(f, (time.time() + p.get("seq", 1), time.time() + p.get("seq", 1)))
    if "modo" in p: gw._voice_mode["whatsapp:" + p["chat"]] = p["modo"]
    if "voz_ok" in p: gw.a.voz_ok = p["voz_ok"]
    if "relogio" in p: m.time = types.SimpleNamespace(monotonic=lambda t=p["relogio"]: t)
    e = ev(p["chat"])
    if p["t"] == "evento": await ctx.hooks["pre_gateway_dispatch"](event=e, gateway=gw)
    elif p["t"] == "resposta_a_audio":   # caminho do adapter (base.py): toca o TTS; o texto só sai se não "foi junto"
        junto = await gw.a._play_tts_file(e, "texto", "/tmp/a.ogg", True, {}, entregas.append)
        if not junto: await gw.a._send_final_text(e, "k", "texto", {}, p.get("efemera", False), 0, entregas.append)
    elif p["t"] == "resposta_a_texto":   # caminho do runner no modo "all": a voz e depois o texto final
        await gw.a.send_voice(chat_id=p["chat"], audio_path="/tmp/a.ogg")
        await gw.a._send_final_text(e, "k", "texto", {}, p.get("efemera", False), 0, entregas.append)
    elif p["t"] == "so_texto":
        await gw.a._send_final_text(e, "k", "texto", {}, False, 0, entregas.append)
for p in json.load(sys.stdin): asyncio.run(passo(p))
print(json.dumps({"log": gw.a.log, "modos": gw._voice_mode, "entregas": len(entregas), "ligados": sorted(gw.a._auto_tts_enabled_chats)}))
`;
function homeFalso() {
  const home = mkdtempSync(join(tmpdir(), "mb-audio-marca-"));
  mkdirSync(join(home, ".local", "share", "meu-bot"), { recursive: true });
  return home;
}
const rodar = (home, passos) => JSON.parse(execFileSync("python3", ["-I", "-c", DRIVER, PLUGIN], { input: JSON.stringify(passos), env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }));
const A = "5511988887777@s.whatsapp.net", B = "5521923670743@s.whatsapp.net";

test("sempre: liga o modo all só na conversa sem modo escolhido; quem pediu só texto fica; desligar desfaz só o que o plugin ligou", { skip: semPython }, () => {
  const home = homeFalso();
  const r = rodar(home, [
    { t: "evento", chat: A }, // sem marca: nada muda
    { t: "evento", chat: A, marca: { audio: { sempre: true } }, seq: 1 },
    { t: "evento", chat: B, modo: "off" }, // B pediu só texto: respeitado
  ]);
  assert.deepEqual(r.modos, { [`whatsapp:${A}`]: "all", [`whatsapp:${B}`]: "off" });
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".local/share/meu-bot/whatsapp-audio-sempre.json"), "utf8")), { [`whatsapp:${A}`]: A });
  // Gateway reiniciado (outro processo): a lista do que o plugin ligou vem do disco. C escolheu "all" por conta própria.
  const C = "5531977776666@s.whatsapp.net";
  const d = rodar(home, [
    { t: "evento", chat: A, modo: "all", marca: { audio: { sempre: false } }, seq: 2 },
    { t: "evento", chat: C, modo: "all" },
  ]);
  assert.deepEqual(d.modos, { [`whatsapp:${C}`]: "all" }, "A volta ao padrão; a escolha de C fica");
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".local/share/meu-bot/whatsapp-audio-sempre.json"), "utf8")), {});
});

test("só o áudio: o texto é pulado quando o áudio saiu (resposta a áudio e modo sempre); áudio que falha deixa o texto sair", { skip: semPython }, () => {
  const home = homeFalso();
  const so = { audio: { soAudio: true } };
  const r = rodar(home, [
    { t: "evento", chat: A, marca: so },            // o hook embrulha o adapter
    { t: "resposta_a_audio", chat: A },             // áudio ok → sem texto
    { t: "resposta_a_texto", chat: A },             // modo sempre: voz ok → sem texto
    { t: "so_texto", chat: A },                     // turno sem áudio: o texto sai (a marca do áudio já foi consumida)
    { t: "resposta_a_audio", chat: A, voz_ok: false }, // o áudio falhou → o texto sai
    { t: "resposta_a_texto", chat: A, voz_ok: true, efemera: true }, // resposta efêmera nunca é pulada
  ]);
  assert.deepEqual(r.log.map((l) => l[0]), ["voz", "voz", "texto", "voz", "texto", "voz", "texto"]);
  // Todo turno registra uma entrega, mesmo com o texto pulado (o áudio vale como a entrega): 1 + 1 + 1 + 2 + 1.
  assert.equal(r.entregas, 6);
});

test("só o áudio desligado (padrão) e áudio velho: o gateway segue como sempre", { skip: semPython }, () => {
  const home = homeFalso();
  const r = rodar(home, [
    { t: "evento", chat: A, marca: { audio: { soAudio: false } } },
    { t: "resposta_a_audio", chat: A },
    { t: "resposta_a_texto", chat: A },
  ]);
  assert.deepEqual(r.log.map((l) => l[0]), ["voz", "texto", "voz", "texto"]);
  // Um áudio que saiu há mais de 90 s (outra coisa mandou voz) não engole o texto de um turno posterior.
  const v = rodar(homeFalso(), [
    { t: "evento", chat: A, marca: { audio: { soAudio: true } }, relogio: 1000 },
    { t: "resposta_a_texto", chat: B, relogio: 1000 }, // B: voz + texto pulado (conversa diferente não interfere)
    { t: "so_texto", chat: A, relogio: 1000 },
  ]);
  assert.deepEqual(v.log.map((l) => [l[0], l[1]]), [["voz", B], ["texto", A]]);
});

test("hermesAudioMarcaSh: mescla só sempre/soAudio na marca, sem perder as outras chaves", { skip: semPython }, () => {
  const home = homeFalso();
  const f = join(home, ".local/share/meu-bot/whatsapp-lista.json");
  writeFileSync(f, JSON.stringify({ paused: { "5511": { desde: "x", ate: null } }, dono: { numero: "55", desde: "y" }, audio: { soAudio: true } }));
  const sh = (a) => spawnSync("bash", ["-c", core.hermesAudioMarcaSh(a)], { encoding: "utf8", env: { HOME: home, PATH: process.env.PATH } });
  const r = sh({ sempre: true });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /audiomarca=ok/);
  const j = JSON.parse(readFileSync(f, "utf8"));
  assert.deepEqual(j.audio, { soAudio: true, sempre: true });
  assert.deepEqual(Object.keys(j.paused), ["5511"]); assert.equal(j.dono.numero, "55");
  sh({ sempre: false, soAudio: false });
  assert.deepEqual(JSON.parse(readFileSync(f, "utf8")).audio, { soAudio: false, sempre: false });
  // Sem o arquivo: cria só com a chave do áudio.
  const novo = homeFalso();
  spawnSync("bash", ["-c", core.hermesAudioMarcaSh({ soAudio: true })], { env: { HOME: novo, PATH: process.env.PATH } });
  assert.ok(existsSync(join(novo, ".local/share/meu-bot/whatsapp-lista.json")));
});

test("lerHermesAudio: sempre e só áudio vêm da marca; sem a chave (leitura antiga) nada muda", () => {
  const base = "stt=1\nprov=local_command\ncmd=1\nwhisper=0\n";
  assert.equal(core.lerHermesAudio(`${base}tts=inbound\nsempre=1\nsoaudio=1\n`).audioOut, "always");
  assert.equal(core.lerHermesAudio(`${base}tts=inbound\nsempre=1\nsoaudio=1\n`).audioSoAudio, true);
  assert.equal(core.lerHermesAudio(`${base}tts=inbound\nsempre=0\nsoaudio=0\n`).audioOut, "inbound");
  assert.equal(core.lerHermesAudio(`${base}tts=off\nsempre=1\nsoaudio=0\n`).audioOut, "off", "com o áudio desligado, o sempre da marca não vale");
  const antiga = core.lerHermesAudio(`${base}tts=inbound\n`);
  assert.equal(antiga.audioOut, "inbound"); assert.equal(antiga.audioSoAudio, undefined);
});
