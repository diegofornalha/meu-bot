import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { agenteEscolhido, WA_MOTOR_SH } = req("../../dist/main/whatsapp/whatsapp-capacidades.js");
const { hermesAudioPatch, hermesConfigSetSh, HERMES_WA_ENSURE_SH, HERMES_VOZ_LOCAL_SH } = req("../../dist/main/whatsapp/whatsapp-hermes-core.js");

test("escolha do motor: openclaw, hermes ou picoclaw; o resto é \"não escolheu\"", () => {
  assert.equal(agenteEscolhido("hermes\n"), "hermes");
  assert.equal(agenteEscolhido(" OpenClaw "), "openclaw");
  assert.equal(agenteEscolhido("picoclaw"), "picoclaw");
  for (const v of [undefined, "", "hermes2", "claw"]) assert.equal(agenteEscolhido(v), null);
});

/** Roda `usa_hermes` num HOME de mentira: o mesmo critério do status, do pareamento, da lista e do logout. */
function usaHermes({ escolha, hermesWa }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wa-agente-"));
  if (escolha !== undefined) { fs.mkdirSync(path.join(home, ".local/share/meu-bot"), { recursive: true }); fs.writeFileSync(path.join(home, ".local/share/meu-bot/whatsapp-agente"), `${escolha}\n`); }
  if (hermesWa) fs.mkdirSync(path.join(home, ".hermes/whatsapp"), { recursive: true });
  // PATH vazio: a regra olha binários no PATH, e o deste Mac (hermes? openclaw?) não pode decidir o teste.
  const out = execFileSync("bash", ["-c", `${WA_MOTOR_SH}; usa_hermes && echo sim || echo nao; echo "esc=$ESC"`], { env: { HOME: home, PATH: "/usr/bin:/bin" }, encoding: "utf8" });
  fs.rmSync(home, { recursive: true, force: true });
  return out;
}
test("quem atende: a escolha gravada manda; sem escolha, o Hermes só com o WhatsApp dele configurado (como antes)", () => {
  assert.match(usaHermes({ escolha: "hermes", hermesWa: false }), /^sim\nesc=hermes$/m);
  assert.match(usaHermes({ escolha: "openclaw", hermesWa: true }), /^nao\nesc=openclaw$/m, "escolher OpenClaw passa por cima do Hermes já configurado");
  assert.match(usaHermes({ hermesWa: true }), /^sim\nesc=$/m);
  assert.match(usaHermes({ hermesWa: false }), /^nao\nesc=$/m);
});

test("áudio do Hermes: ouvir = stt local em português; responder em áudio = voice.auto_tts (sem \"sempre\")", () => {
  // O Whisper sai da memória depois de 5 min sem áudio (era a maior parte dos ~530 MB de cada gateway).
  assert.deepEqual(hermesAudioPatch({ kind: "in" }), { "stt.enabled": true, "stt.provider": "local", "stt.language": "pt", "stt.local.model": "small", "stt.local.unload_after_idle_seconds": 300 });
  assert.deepEqual(hermesAudioPatch({ kind: "in", off: true }), { "stt.enabled": false });
  // Com o transcritor compartilhado da máquina (/opt/transcriber), o Hermes só aponta para ele: nada de modelo próprio.
  assert.deepEqual(hermesAudioPatch({ kind: "in", compartilhado: true }), { "stt.enabled": true, "stt.provider": "local_command", "stt.language": "pt" });
  assert.deepEqual(hermesAudioPatch({ kind: "in", off: true, compartilhado: true }), { "stt.enabled": false });
  // Sem `tts:` o Hermes fala inglês pela Edge: a voz pt-BR local vai junto, e a Edge fica em pt-BR de reserva.
  // O provedor padrão (voz-local, command → WAV → Opus) entra por HERMES_VOZ_LOCAL_SH; o "piper" embutido grava Vorbis.
  const voz = { "voice.auto_tts": true, "tts.piper.voice": "pt_BR-faber-medium", "tts.edge.voice": "pt-BR-FranciscaNeural" };
  assert.deepEqual(hermesAudioPatch({ kind: "out", mode: "inbound" }), voz);
  assert.deepEqual(hermesAudioPatch({ kind: "out", mode: "always" }), voz);
  assert.deepEqual(hermesAudioPatch({ kind: "out", mode: "off" }), { "voice.auto_tts": false }, "desligar não mexe na voz escolhida");
});

test("scripts do Hermes: o patch vai em base64 (sem aspas soltas no shell) e a chave do backend nunca vai por argv", () => {
  const sh = hermesConfigSetSh({ "stt.enabled": true });
  const b64 = Buffer.from(JSON.stringify({ "stt.enabled": true })).toString("base64");
  assert.ok(sh.endsWith(`' '${b64}'`));
  assert.match(sh, /cfgset=ok/);
  // A chave e a versão do backend vão por variável de ambiente, nunca por argv.
  assert.match(HERMES_WA_ENSURE_SH, /HK="\$HK" HP="\$HP" HV="\$HV" "\$PY" -c/);
  // A única troca de modelo: o nosso "agente" no backend local vira "whatsapp" (backend 1.3.0+); o da pessoa, nunca.
  assert.match(HERMES_WA_ENSURE_SH, /prov == "custom" and str\(m\.get\("base_url"\) or ""\)\.startswith\("http:\/\/127\.0\.0\.1:"\) and m\.get\("default"\) == "agente"/);
  assert.match(HERMES_WA_ENSURE_SH, /prov == "auto"/, "modelo já escolhido nunca é trocado");
  // Os dois scripts são bash válido (o Python vai entre aspas simples, sem aspas simples dentro).
  for (const s of [sh, HERMES_WA_ENSURE_SH, HERMES_VOZ_LOCAL_SH]) execFileSync("bash", ["-n", "-c", s]);
  assert.match(HERMES_VOZ_LOCAL_SH, /"provider"\] = "voz-local"/);
  assert.match(HERMES_VOZ_LOCAL_SH, /\{input_path\} \{output_path\}/);
});
