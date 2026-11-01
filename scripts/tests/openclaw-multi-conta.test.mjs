import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const core = req("../../dist/main/whatsapp/whatsapp-openclaw-core.js");
const { sessoesDoAgente } = req("../../dist/main/whatsapp/whatsapp-chats.js");
const { envolverPatch, aplicarPatch } = req("../../dist/main/whatsapp/whatsapp-grupos-core.js");
const { pausedNumbersOfPolicy, pauseRulePrefixes, withPauseRule } = req("../../dist/main/whatsapp/whatsapp-pause.js");
const { STATUS_SCRIPT } = req("../../dist/main/whatsapp/whatsapp.js");

// Várias contas num gateway só (o root da VM agente): a conta `box` do usuário box vive em channels.whatsapp.accounts.box,
// o agente `box` em agents.entries.box, as credenciais em credentials/whatsapp/box, e todo comando leva --account.
const BOX = { accountId: "box", agentId: "box", gatewayUser: "root", gatewayHost: "agente-root", proprio: false };

test("caminhos por conta e agente; o padrão continua o de sempre", () => {
  assert.equal(core.cfgDe(core.ALVO_PADRAO), "channels.whatsapp");
  assert.equal(core.cfgDe(BOX), "channels.whatsapp.accounts.box");
  assert.equal(core.credsDe(BOX), "$HOME/.openclaw/credentials/whatsapp/box/creds.json");
  assert.equal(core.credsDe(core.ALVO_PADRAO), "$HOME/.openclaw/credentials/whatsapp/default/creds.json");
  assert.equal(core.sqliteDe(BOX), "~/.openclaw/agents/box/agent/openclaw-agent.sqlite");
  assert.equal(core.sqliteDe(core.ALVO_PADRAO), "~/.openclaw/agents/main/agent/openclaw-agent.sqlite");
  assert.deepEqual(envolverPatch({ channels: { whatsapp: { groups: { "1@g.us": { requireMention: false } } } } }, "box"), { channels: { whatsapp: { accounts: { box: { groups: { "1@g.us": { requireMention: false } } } } } } });
  const p = { channels: { whatsapp: { groupPolicy: "open" } } };
  assert.equal(envolverPatch(p, "default"), p);
});

test("sessões só do agente: o sessions.list do gateway traz as de todos os usuários", () => {
  const list = { sessions: [{ key: "agent:box:whatsapp:box:direct:+5521000000001" }, { key: "agent:box-lv:whatsapp:box-lv:direct:+5522000000002" }, { key: "agent:box:main" }, { key: "agent:main:whatsapp:direct:+5521000000003" }] };
  assert.deepEqual(sessoesDoAgente(list, "box").sessions.map((s) => s.key), ["agent:box:whatsapp:box:direct:+5521000000001", "agent:box:main"]);
  assert.deepEqual(sessoesDoAgente(list, "box-lv").sessions.map((s) => s.key), ["agent:box-lv:whatsapp:box-lv:direct:+5522000000002"]);
  assert.equal(sessoesDoAgente("x", "box"), "x");
});

test("pausa por agente: regras com rawKeyPrefix e o agente dentro; a pausa de outro agente não é desta conta", () => {
  assert.deepEqual(pauseRulePrefixes("5521000000001", [], "box"), ["agent:box:whatsapp:direct:+5521000000001"]);
  assert.deepEqual(pauseRulePrefixes("5521000000001", ["agent:box:whatsapp:box:direct:+5521000000001", "agent:box-lv:whatsapp:box-lv:direct:+5521000000001"], "box"), ["agent:box:whatsapp:box:direct:+5521000000001"]);
  assert.deepEqual(pauseRulePrefixes("5521000000001", ["agent:main:whatsapp:direct:+5521000000001"]), ["whatsapp:direct:+5521000000001"], "sem agente: como antes");
  const pol = withPauseRule({ rules: [{ action: "deny", match: { rawKeyPrefix: "agent:box-lv:whatsapp:box-lv:direct:+5521000000001" } }] }, "5521000000001", true, ["agent:box:whatsapp:box:direct:+5521000000001"], "box");
  assert.deepEqual(pol.rules, [
    { action: "deny", match: { rawKeyPrefix: "agent:box:whatsapp:box:direct:+5521000000001" } },
    { action: "deny", match: { rawKeyPrefix: "agent:box-lv:whatsapp:box-lv:direct:+5521000000001" } },
  ], "a regra da box-lv para o mesmo número fica");
  assert.deepEqual([...pausedNumbersOfPolicy(pol, "box")], ["5521000000001"]);
  assert.deepEqual([...pausedNumbersOfPolicy(pol, "openclaw")], []);
  assert.deepEqual([...pausedNumbersOfPolicy(pol)], ["5521000000001"], "sem agente conta tudo (como antes)");
  const retomado = withPauseRule(pol, "5521000000001", false, [], "box");
  assert.deepEqual(retomado.rules.map((r) => r.match.rawKeyPrefix), ["agent:box-lv:whatsapp:box-lv:direct:+5521000000001"]);
});

test("trava do dono por união no gateway compartilhado; a de sempre no gateway próprio", () => {
  assert.match(core.ownerLockSh("5521000000001"), /case "\$cur" in \*unset\*\|\*apply_patch\*/);
  const u = core.ownerLockSh("5521000000001", BOX);
  assert.match(u, /cur\["e164:" \+ n\]/); assert.match(u, /cur\["\*"\] = \{"deny": deny\}/); assert.match(u, /tools\.toolsBySender "\$NOVO"/);
});

test("pareamento e logout por conta: --account, GW_PROPRIO=0, sem reiniciar o gateway dos outros, creds da conta", () => {
  const p = core.openclawPairSh(BOX);
  assert.match(p, /^GW_PROPRIO=0/m);
  assert.match(p, /openclaw channels login --channel whatsapp --account box >/);
  assert.match(p, /pkill -u "\$\(id -u\)" -f "openclaw channels login --channel whatsapp --account box\$"/);
  assert.match(p, /CREDS=\$HOME\/\.openclaw\/credentials\/whatsapp\/box\/creds\.json/);
  assert.match(p, /channels\.whatsapp\.accounts\.box\.dmPolicy/);
  assert.doesNotMatch(p, /restart\(\) \{ if \[ -n "\$GW" \]/, "sem reiniciar o gateway inteiro");
  assert.doesNotMatch(p, /oc_model_ensure 2>\/dev\/null\)" = set/, "modelo é do agente, já configurado");
  const proprio = core.openclawPairSh({ ...core.ALVO_PADRAO, proprio: true });
  assert.match(proprio, /^GW_PROPRIO=1/m); assert.match(proprio, /restart\(\) \{ if \[ -n "\$GW" \]/); assert.match(proprio, /openclaw channels login --channel whatsapp >/);
  assert.match(core.openclawLogoutSh(BOX), /channels logout --channel whatsapp --account box/);
  assert.match(core.openclawLogoutSh(core.ALVO_PADRAO), /channels logout --channel whatsapp >/);
});

// ---- scripts de verdade num HOME de mentira com um `openclaw` falso que anota as chamadas
const CONFIG_GATEWAY = {
  plugins: { entries: { whatsapp: { enabled: true } } },
  channels: { whatsapp: {
    dmPolicy: "open", allowFrom: ["*"], selfChatMode: true, groupAllowFrom: ["+5516000000000"], responsePrefix: "",
    accounts: { default: { enabled: false }, box: { enabled: true, name: "Diego", authDir: "/root/.openclaw/credentials/whatsapp/box", dmPolicy: "allowlist", allowFrom: ["+5521000000001"], groups: { "120363428911337329@g.us": { requireMention: false } } } },
  } },
  agents: { defaults: { model: { primary: "anthropic/claude-opus-5-5" } }, entries: { box: { workspace: "/home/box/.openclaw/workspace", model: { primary: "anthropic/claude-opus-5-5", fallbacks: ["grok/grok-4.7"] } }, main: {} } },
  models: { providers: { grok: { models: [{ id: "grok-4.7" }] } } },
  tools: { media: { models: [{ type: "cli", command: "/x", capabilities: ["audio"] }] } },
  tts: { auto: "off", provider: "tts-local-cli" },
};
const STATUS_GATEWAY = { status: null, channels: { whatsapp: { configured: true, statusState: "disabled", linked: false, running: false, connected: false, self: { e164: null } } }, channelAccounts: { whatsapp: [{ accountId: "default", enabled: false, healthState: "disabled", lifecycle: "stopped" }, { accountId: "box", enabled: true, healthState: "healthy", lifecycle: "running", lastDisconnect: null }] }, channelDefaultAccountId: { whatsapp: "box" } };

function maquina({ config = CONFIG_GATEWAY, alvo = null, status = STATUS_GATEWAY } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wa-multi-"));
  const bin = path.join(home, "bin-falso"); fs.mkdirSync(bin);
  const w = (p, txt, mode) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); if (mode) fs.chmodSync(p, mode); };
  w(path.join(bin, "timeout"), "#!/bin/bash\nshift; exec \"$@\"\n", 0o755);
  w(path.join(bin, "openclaw"), `#!/bin/bash
echo "$*" >> "$HOME/openclaw-chamadas.log"
case "$*" in
  "channels status --channel whatsapp --json") cat "$HOME/channels-status.json";;
  "gateway call sessions.list --json --params {\\"limit\\":200}") echo '{"sessions":[{"key":"agent:box:whatsapp:box:direct:+5521000000001","updatedAt":1700000000000},{"key":"agent:box-lv:whatsapp:box-lv:direct:+5522000000002","updatedAt":1700000000000}]}';;
  *) exit 0;;
esac
`, 0o755);
  w(path.join(bin, "package.json"), JSON.stringify({ name: "openclaw", version: "2026.9.9" }));
  w(path.join(home, "channels-status.json"), JSON.stringify(status));
  w(path.join(home, ".local/share/meu-bot/whatsapp-agente"), "openclaw\n");
  if (alvo !== null) w(path.join(home, ".local/share/meu-bot/whatsapp-alvo.json"), JSON.stringify(alvo));
  w(path.join(home, ".openclaw/openclaw.json"), JSON.stringify(config));
  w(path.join(home, ".openclaw/extensions/whatsapp/package.json"), JSON.stringify({ version: "2026.9.9" }));
  w(path.join(home, ".openclaw/credentials/whatsapp/box/creds.json"), JSON.stringify({ me: { id: "5521000000001:7@s.whatsapp.net" } }));
  w(path.join(home, ".openclaw/credentials/whatsapp/default/creds.json"), JSON.stringify({ me: { id: "5599999999999:1@s.whatsapp.net" } }));
  return { home, bin };
}
function roda(m, script) {
  const out = execFileSync("bash", ["-c", script], { env: { HOME: m.home, PATH: `${m.bin}:/usr/bin:/bin` }, encoding: "utf8" });
  const kv = new Map();
  for (const line of out.split("\n")) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1).trim()); }
  let chamadas = [];
  try { chamadas = fs.readFileSync(path.join(m.home, "openclaw-chamadas.log"), "utf8").trim().split("\n").filter(Boolean); } catch { /* nenhuma */ }
  return { kv, chamadas, out };
}

test("STATUS_SCRIPT na conta com alvo gravado: para cedo (poralvo=1) sem subir a CLI; a fachada consulta o gateway", () => {
  const m = maquina({ alvo: { accountId: "box", agentId: "box", gatewayUser: "root" } });
  const r = roda(m, STATUS_SCRIPT);
  fs.rmSync(m.home, { recursive: true, force: true });
  assert.equal(r.kv.get("gateway"), "openclaw"); assert.equal(r.kv.get("present"), "1"); assert.equal(r.kv.get("poralvo"), "1");
  assert.deepEqual(JSON.parse(r.kv.get("alvo")), { accountId: "box", agentId: "box", gatewayUser: "root" });
  assert.deepEqual(r.chamadas, [], "nenhuma chamada da CLI no alias da conta");
});

test("fragmento do status no gateway, por conta: creds da conta, config efetiva herdada, estado pela entrada em channelAccounts, uma chamada só, sem gw_fix", () => {
  const m = maquina();
  const r = roda(m, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${core.openclawStatusSh(BOX)}\necho present=1`);
  fs.rmSync(m.home, { recursive: true, force: true });
  assert.deepEqual(r.chamadas, ["channels status --channel whatsapp --json"]);
  assert.equal(r.kv.get("me"), "5521000000001:7@s.whatsapp.net", "o número é o da conta box, não o da default");
  const ch = JSON.parse(r.kv.get("channel"));
  assert.equal(ch.dmPolicy, "allowlist"); assert.deepEqual(ch.allowFrom, ["+5521000000001"]);
  assert.deepEqual(ch.groupAllowFrom, ["+5516000000000"], "herdado da raiz");
  assert.equal(ch.selfChatMode, undefined, "selfChatMode não é herdado");
  assert.equal(ch.accounts, undefined);
  assert.equal(r.kv.get("dmpolicy"), "allowlist");
  assert.equal(r.kv.get("ocmodel"), "0", "o agente box tem modelo"); assert.equal(r.kv.get("ocfallback"), "0");
  const oc = JSON.parse(r.kv.get("oc"));
  assert.equal(oc.connected, true); assert.equal(oc.linked, true); assert.equal(oc.state, "healthy"); assert.equal(oc.conta, true);
  const st = core.openclawStatus(r.kv);
  assert.equal(st.connected, true); assert.equal(st.number, "5521000000001"); assert.equal(st.dmPolicy, "allowlist");
});

test("conta que ainda não existe no gateway: o status explica, sem inventar", () => {
  const m = maquina();
  const r = roda(m, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${core.openclawStatusSh({ ...BOX, accountId: "nova", agentId: "nova" })}`);
  fs.rmSync(m.home, { recursive: true, force: true });
  const st = core.openclawStatus(r.kv);
  assert.equal(st.ready, false); assert.match(st.missing, /ainda não existe no gateway/);
});

test("lista e grupos no gateway, por conta: self da conta e a vista efetiva; o parse filtra as sessões do agente", () => {
  const m = maquina();
  const r = roda(m, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${core.openclawChatsSh(BOX)}`);
  const g = roda(m, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${core.openclawGroupsSh(BOX)}`);
  fs.rmSync(m.home, { recursive: true, force: true });
  assert.equal(r.kv.get("self"), "5521000000001:7@s.whatsapp.net");
  assert.equal(JSON.parse(r.kv.get("list")).sessions.length, 2, "o gateway devolve as sessões de todos");
  assert.equal(sessoesDoAgente(JSON.parse(r.kv.get("list")), "box").sessions.length, 1);
  const wa = JSON.parse(g.kv.get("wa"));
  assert.deepEqual(wa.groups, { "120363428911337329@g.us": { requireMention: false } }); assert.deepEqual(wa.groupAllowFrom, ["+5516000000000"]);
  assert.equal(g.kv.get("skill"), "0");
  // Conferência de um patch de grupo pela vista efetiva (o patch em si vai em accounts.box).
  assert.deepEqual(aplicarPatch(wa, { channels: { whatsapp: { groupPolicy: "allowlist" } } }).groupPolicy, "allowlist");
});
