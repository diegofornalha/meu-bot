import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// O STATUS_SCRIPT do OpenClaw, num HOME de mentira com um `openclaw` falso que anota cada chamada: no caminho normal só
// `channels status` sobe a CLI (cada chamada custa ~300 MB na VM; eram 7-8 por consulta, por janela, a cada minuto).
const { STATUS_SCRIPT } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp.js");

// Resposta real (agente-box, 1 nov, redigida): canal configurado e deslogado; o formato novo já traz channelAccounts.
const CHANNELS_STATUS = { status: null, channels: { whatsapp: { configured: true, statusState: "connected", linked: true, running: true, connected: true, lifecycle: "running", self: { e164: "+5511999999999", jid: null, lid: null }, lastDisconnect: null } }, channelAccounts: { whatsapp: [{ accountId: "default", enabled: true, healthState: "healthy", lifecycle: "running" }] }, channelDefaultAccountId: { whatsapp: "default" } };

function maquina({ config, extensao = true, packageJson = true, cacheVersao = null } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wa-status-"));
  const bin = path.join(home, "bin-falso"); fs.mkdirSync(bin);
  const w = (p, txt, mode) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); if (mode) fs.chmodSync(p, mode); };
  // `timeout` não existe no macOS: o falso só roda o comando.
  w(path.join(bin, "timeout"), "#!/bin/bash\nshift; exec \"$@\"\n", 0o755);
  w(path.join(bin, "openclaw"), `#!/bin/bash
echo "$*" >> "$HOME/openclaw-chamadas.log"
case "$*" in
  "--version") echo "OpenClaw 2026.9.9 (abc1234)";;
  "channels status --channel whatsapp --json") cat "$HOME/channels-status.json";;
  "plugins list --json") echo '{"plugins":[{"id":"whatsapp","enabled":true},{"id":"meu-bot-guarda","enabled":true}]}';;
  "config get agents.defaults.model") echo "unset";;
  "config get agents.defaults.model.fallbacks") echo "unset";;
  "config get models.providers.grok --json") echo '{"models":[{"id":"grok-4.7"}]}';;
  "config set "*) exit 0;;
  *) exit 0;;
esac
`, 0o755);
  if (packageJson) w(path.join(bin, "package.json"), JSON.stringify({ name: "openclaw", version: "2026.9.9" }));
  if (cacheVersao !== null) w(path.join(home, ".cache/meu-bot/openclaw-version"), `${cacheVersao}\n`);
  w(path.join(home, "channels-status.json"), JSON.stringify(CHANNELS_STATUS));
  w(path.join(home, ".local/share/meu-bot/whatsapp-agente"), "openclaw\n");
  w(path.join(home, ".openclaw/openclaw.json"), JSON.stringify(config));
  if (extensao) w(path.join(home, ".openclaw/extensions/whatsapp/package.json"), JSON.stringify({ name: "@openclaw/whatsapp", version: "2026.9.9" }));
  w(path.join(home, ".openclaw/credentials/whatsapp/default/creds.json"), JSON.stringify({ me: { id: "5511999999999:12@s.whatsapp.net" } }));
  // Com a credencial do Claude, o oc_model_ensure grava o modelo (como numa VM nova com o Claude logado).
  w(path.join(home, ".claude/.credentials.json"), "{}");
  return { home, bin };
}
function status(m) {
  const out = execFileSync("bash", ["-c", STATUS_SCRIPT], { env: { HOME: m.home, PATH: `${m.bin}:/usr/bin:/bin` }, encoding: "utf8" });
  const kv = new Map();
  for (const line of out.split("\n")) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1).trim()); }
  let chamadas = [];
  try { chamadas = fs.readFileSync(path.join(m.home, "openclaw-chamadas.log"), "utf8").trim().split("\n").filter(Boolean); } catch { /* nenhuma */ }
  return { kv, chamadas, out };
}
const CONFIG_PRONTA = {
  plugins: { entries: { whatsapp: { enabled: true } } },
  channels: { whatsapp: { dmPolicy: "open", allowFrom: ["*"], selfChatMode: true } },
  agents: { defaults: { model: { primary: "anthropic/claude-opus-5-5", fallbacks: ["grok/grok-4.7"] } } },
  tools: { media: { models: [{ type: "cli", command: "/x", capabilities: ["audio"] }] } },
  tts: { auto: "inbound", provider: "tts-local-cli" },
  models: { providers: { grok: { models: [{ id: "grok-4.7" }] } } },
};

test("máquina pronta: uma chamada só da CLI (channels status) e o resto vem do openclaw.json", () => {
  const m = maquina({ config: CONFIG_PRONTA });
  const { kv, chamadas } = status(m);
  fs.rmSync(m.home, { recursive: true, force: true });
  assert.deepEqual(chamadas, ["channels status --channel whatsapp --json"]);
  assert.equal(kv.get("gateway"), "openclaw"); assert.equal(kv.get("present"), "1"); assert.equal(kv.get("cfg"), "1");
  assert.equal(kv.get("ver"), "2026.9.9", "a versão vem do package.json ao lado do binário");
  assert.equal(kv.get("plugin"), "1"); assert.equal(kv.get("dmpolicy"), "open");
  assert.deepEqual(JSON.parse(kv.get("channel")), CONFIG_PRONTA.channels.whatsapp);
  assert.equal(kv.get("audioin"), "1"); assert.equal(kv.get("voz"), "inbound");
  assert.equal(kv.get("me"), "5511999999999:12@s.whatsapp.net");
  assert.deepEqual(JSON.parse(kv.get("oc")), { linked: true, connected: true, state: "connected", lifecycle: "running", loggedOut: null, e164: "+5511999999999", starting: false, conta: true });
  assert.equal(kv.get("ocmodel"), "0"); assert.equal(kv.get("ocfallback"), "0"); // modelo e reserva já existem: nada a gravar (e nenhum config set nas chamadas)
});

test("sem package.json ao lado do binário: `openclaw --version` uma vez, depois o cache enquanto o binário não muda", () => {
  const m = maquina({ config: CONFIG_PRONTA, packageJson: false });
  const a = status(m);
  assert.equal(a.kv.get("ver"), "OpenClaw 2026.9.9 (abc1234)");
  assert.deepEqual(a.chamadas, ["--version", "channels status --channel whatsapp --json"]);
  assert.equal(fs.readFileSync(path.join(m.home, ".cache/meu-bot/openclaw-version"), "utf8").trim(), "OpenClaw 2026.9.9 (abc1234)");
  fs.rmSync(path.join(m.home, "openclaw-chamadas.log"));
  const b = status(m);
  fs.rmSync(m.home, { recursive: true, force: true });
  assert.deepEqual(b.chamadas, ["channels status --channel whatsapp --json"], "segunda consulta: a versão vem do cache");
  assert.equal(b.kv.get("ver"), "OpenClaw 2026.9.9 (abc1234)");
});

test("VM nova: sem modelo e sem reserva o script grava os dois (só então chama a CLI); plugin não achado pelos arquivos confirma pela CLI", () => {
  const m = maquina({ config: { plugins: { entries: {} }, channels: {}, models: { providers: { grok: { models: [{ id: "grok-4.7" }] } } } }, extensao: false });
  const { kv, chamadas } = status(m);
  fs.rmSync(m.home, { recursive: true, force: true });
  assert.equal(kv.get("plugin"), "1", "a CLI disse que o plugin está lá");
  assert.ok(chamadas.includes("plugins list --json"));
  assert.ok(chamadas.some((c) => c.startsWith("config set agents.defaults.models ")), "modelo gravado");
  // A reserva vai como JSON válido: antes o shell recebia "["grok/…"]" (aspas internas perdidas) e o OpenClaw recusava em silêncio.
  assert.ok(chamadas.includes('config set agents.defaults.model.fallbacks ["grok/grok-4.7"] --strict-json'), `reserva gravada como JSON: ${chamadas.join(" | ")}`);
  assert.equal(kv.get("ocmodel"), "set"); assert.equal(kv.get("ocfallback"), "set");
  assert.equal(kv.get("dmpolicy"), "", "sem política autorada");
});

test("plugin desligado na config (ou fora do plugins.allow) não conta como instalado, mesmo com a pasta", () => {
  const m = maquina({ config: { ...CONFIG_PRONTA, plugins: { entries: { whatsapp: { enabled: false } } } } });
  const a = status(m); fs.rmSync(m.home, { recursive: true, force: true });
  assert.equal(a.kv.get("plugin"), "1", "a CLI é consultada e responde que está ligado (plugins list é a palavra final)");
  assert.ok(a.chamadas.includes("plugins list --json"));
  const n = maquina({ config: { ...CONFIG_PRONTA, plugins: { entries: { whatsapp: { enabled: true } }, allow: ["anthropic"] } } });
  const b = status(n); fs.rmSync(n.home, { recursive: true, force: true });
  assert.ok(b.chamadas.includes("plugins list --json"), "fora do allow: confirma pela CLI");
});
