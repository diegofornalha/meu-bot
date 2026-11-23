import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const m = createRequire(import.meta.url)("../../dist/main/suporte/support-code.js");

const HOSTKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOv9yqYd0Lr3Qk0eQ0g7cJm0kq4b8w3XHnS1fY0aZ1bC";
const ADMIN = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAdminAdminAdminAdminAdminAdminAdminAdminAd lucas@mac";
const code = { v: 1, name: "Bianca Alcântara", hostname: "203.0.113.7", user: "box", port: 22, hostKey: HOSTKEY, state: "on", at: "2026-10-16T12:00:00.000Z" };

test("código de suporte: ida e volta; alias estável pela máquina", () => {
  const txt = m.encodeSupportCode(code);
  assert.match(txt, /^MBS1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(m.decodeSupportCode(`  ${txt}\n`), { ok: true, code });
  assert.match(m.supportAlias(code), /^suporte-bianca-alcantara-[0-9a-f]{4}$/);
  assert.equal(m.supportAlias({ ...code, name: "Bia" }).slice(-4), m.supportAlias(code).slice(-4));
  assert.equal(m.machineId(code).length, 12);
  // Duas contas na mesma máquina (mesma chave do servidor, usuários diferentes): ids e aliases diferentes.
  const root = { ...code, user: "root" };
  assert.notEqual(m.machineId(root), m.machineId(code));
  assert.notEqual(m.supportAlias(root), m.supportAlias(code));
  assert.equal(m.legacyMachineId(HOSTKEY).length, 12);
  assert.notEqual(m.legacyMachineId(HOSTKEY), m.machineId(code));
});

test("código de suporte: recusa o que não é do formato (vem de fora)", () => {
  const enc = (o) => `MBS1.${Buffer.from(JSON.stringify(o)).toString("base64url")}`;
  for (const [bad, why] of [
    ["oi", /MBS1/], ["MBS1.@@@", /corrompido/], [enc([1]), /corrompido/],
    [enc({ ...code, v: 2 }), /versão/], [enc({ ...code, name: "" }), /nome/],
    [enc({ ...code, hostname: "-oProxyCommand=x" }), /endereço/], [enc({ ...code, hostname: "a b" }), /endereço/],
    [enc({ ...code, user: "root;rm" }), /usuário/], [enc({ ...code, port: 70000 }), /porta/],
    [enc({ ...code, hostKey: "ssh-ed25519 AAA\nHost x" }), /chave/], [enc({ ...code, state: "talvez" }), /estado/],
    [`MBS1.${"A".repeat(5000)}`, /grande/],
  ]) {
    const r = m.decodeSupportCode(bad);
    assert.equal(r.ok, false, bad.slice(0, 40)); assert.match(r.reason, why);
  }
});

test("authorized_keys: um por admin, religa sem duplicar, tira quem saiu e o formato antigo, desliga sem tocar nas outras", () => {
  const home = mkdtempSync(join(tmpdir(), "mb-ak-"));
  mkdirSync(join(home, ".ssh"));
  const ak = join(home, ".ssh", "authorized_keys");
  const b = ADMIN.split(" ").slice(0, 2).join(" ");
  // Linha do formato antigo (um admin só, comentário "meu-bot-admin") tem de sair.
  writeFileSync(ak, `ssh-ed25519 AAAAdela bianca@mac\nno-agent-forwarding,no-X11-forwarding ${b} meu-bot-admin\n`);
  const run = (admins) => execFileSync("bash", ["-c", m.authorizedKeysScript(admins)], { env: { HOME: home, PATH: process.env.PATH } });
  const OUTRA = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB outro";
  run([{ nome: "Lucas", chave: ADMIN }, { nome: "João Silva", chave: OUTRA }]); run([{ nome: "Lucas", chave: ADMIN }, { nome: "João Silva", chave: OUTRA }]);
  const on = readFileSync(ak, "utf8").trim().split("\n");
  assert.deepEqual(on, ["ssh-ed25519 AAAAdela bianca@mac", `no-agent-forwarding,no-X11-forwarding ${b} meu-bot-admin:Lucas`, `no-agent-forwarding,no-X11-forwarding ${OUTRA.split(" ").slice(0, 2).join(" ")} meu-bot-admin:Joao-Silva`]);
  assert.equal((statSync(ak).mode & 0o777).toString(8), "600");
  run([{ nome: "Lucas", chave: ADMIN }]);
  assert.equal(readFileSync(ak, "utf8").trim().split("\n").length, 2, "quem saiu da lista perde o acesso");
  run([]);
  assert.equal(readFileSync(ak, "utf8"), "ssh-ed25519 AAAAdela bianca@mac\n");
  assert.throws(() => m.authorizedKeysScript([{ nome: "x", chave: "não é chave" }]), /inválida/);
});

test("bloco do ~/.ssh/config e known_hosts do admin usam o alias", () => {
  const b = m.adminSshBlock(code, "~/.ssh/meu-bot-admin");
  assert.match(b, /^Host suporte-bianca-alcantara-[0-9a-f]{4}\n    HostName 203\.0\.113\.7\n    User box\n    Port 22\n    IdentityFile ~\/\.ssh\/meu-bot-admin\n    IdentitiesOnly yes\n    HostKeyAlias suporte-/);
  assert.equal(m.knownHostsLine(code), `${m.supportAlias(code)} ${HOSTKEY}`);
});

test("caixa de entrada: grava por máquina, substitui na reentrega, recusa lixo e enchente", () => {
  const home = mkdtempSync(join(tmpdir(), "mb-inbox-"));
  const inbox = resolve("backend-colima/meu-bot-suporte-inbox");
  const send = (input) => spawnSync("sh", [inbox], { input, env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" });
  const id = m.machineId(code);
  const txt = m.encodeSupportCode(code);
  assert.equal(send(`${id}\n${txt}\n`).status, 0);
  assert.equal(send(`${id}\n${m.encodeSupportCode({ ...code, state: "off" })}\n`).status, 0);
  const files = readdirSync(join(home, "suporte-inbox"));
  assert.deepEqual(files, [`${id}.code`]);
  assert.equal(m.decodeSupportCode(readFileSync(join(home, "suporte-inbox", files[0]), "utf8")).code.state, "off");
  assert.notEqual(send(`../../x\n${txt}\n`).status, 0, "id fora do formato");
  assert.notEqual(send(`${id}\nrm -rf /\n`).status, 0, "não é código");
  assert.notEqual(send(`${id}\nMBS1.${"A".repeat(5000)}\n`).status, 0, "grande demais");
  for (let i = 0; i < 25; i++) send(`${String(i).padStart(12, "0")}\n${txt}\n`);
  assert.equal(readdirSync(join(home, "suporte-inbox")).filter((f) => f.endsWith(".code")).length, 20, "caixa cheia em 20");
});

test("progresso nos tutoriais: aceita o formato e recusa o que não é", () => {
  const ok = { at: "2026-10-16T12:00:00.000Z", tour: "done", tutorials: [
    { id: "whatsapp-openclaw", title: "Conectar o WhatsApp ao agente", done: 3, total: 5, current: "Fazer o agente entender áudios", finished: false, comingSoon: false },
    { id: "whatsapp-objetivo", title: "O que você quer resolver pelo WhatsApp?", done: 0, total: 3, current: null, finished: false, comingSoon: true },
  ] };
  assert.deepEqual(m.parseSupportProgress(ok), ok);
  for (const bad of [null, [], { ...ok, at: "ontem" }, { ...ok, tour: "talvez" }, { ...ok, tutorials: "x" },
    { ...ok, tutorials: [{ ...ok.tutorials[0], done: 9 }] }, { ...ok, tutorials: [{ ...ok.tutorials[0], title: "x".repeat(500) }] },
    { ...ok, tutorials: Array(30).fill(ok.tutorials[0]) }]) assert.equal(m.parseSupportProgress(bad), null);
});

test("código com o apelido da máquina (machine): vai e volta; inválido cai fora; antigo sem ele vale", () => {
  const d = m.decodeSupportCode(m.encodeSupportCode({ ...code, machine: "colima" }));
  assert.ok(d.ok); assert.equal(d.code.machine, "colima");
  const old = m.decodeSupportCode(m.encodeSupportCode(code));
  assert.ok(old.ok); assert.equal("machine" in old.code, false);
  const bad = m.decodeSupportCode(m.encodeSupportCode({ ...code, machine: "tem espaço; e ponto-e-vírgula" }));
  assert.ok(bad.ok); assert.equal("machine" in bad.code, false, "apelido inválido é ignorado, não derruba o código");
});

test("parseSupportShare: tudo compartilhado por padrão, só false desliga; o backup completo só com true", () => {
  assert.deepEqual(m.parseSupportShare(undefined), { progress: true, whatsapp: true, logs: true, chat: true, backup: false });
  assert.deepEqual(m.parseSupportShare({ whatsapp: false, chat: false }), { progress: true, whatsapp: false, logs: true, chat: false, backup: false });
  assert.deepEqual(m.parseSupportShare({ progress: "não", logs: 0, backup: "sim" }), { progress: true, whatsapp: true, logs: true, chat: true, backup: false });
  assert.equal(m.parseSupportShare({ backup: true }).backup, true);
  assert.deepEqual(m.DEFAULT_SHARE, { progress: true, whatsapp: true, logs: true, chat: true, backup: false });
});

test("parseSupportProgress: `app` de arquivo antigo é ignorado; o resto vale", () => {
  const base = { at: "2026-10-16T12:00:00Z", tour: "done", tutorials: [] };
  const velho = m.parseSupportProgress({ ...base, app: { version: "0.1.0", openedAt: "2026-10-16T11:00:00Z" } });
  assert.equal("app" in velho, false);
  assert.deepEqual(velho, base);
});

test("removeDeliverySh: entrega o off uma última vez, derruba timer e cron, apaga a pasta", () => {
  const sh = m.removeDeliverySh("116367d39cee", "MBS1.abc");
  assert.ok(sh.includes("printf '%s\\n%s\\n' '116367d39cee' 'MBS1.abc'"), sh);
  assert.ok(sh.includes("systemctl --user disable --now meu-bot-suporte.timer") && sh.includes("grep -v meu-bot-suporte") && sh.includes(`rm -rf "${m.SUPPORT_DIR}"`));
});

test("adicionar por host do ~/.ssh/config: alvo, ssh -G, script e chave do servidor", () => {
  assert.equal(m.parseSshAddTarget("ssh agente-box-lv\n"), "agente-box-lv");
  assert.equal(m.parseSshAddTarget("agente-box-lv"), "agente-box-lv");
  assert.equal(m.parseSshAddTarget("ssh -o ProxyCommand=x h"), null);
  assert.equal(m.parseSshAddTarget("ssh a; rm -rf /"), null);
  assert.equal(m.parseSshAddTarget("-oProxyCommand=x"), null);
  assert.deepEqual(m.parseSshG("host agente-box-lv\nuser box-lv\nhostname 187.127.41.175\nport 22\n"), { hostname: "187.127.41.175", user: "box-lv", port: 22 });
  assert.equal(m.parseSshG("user box-lv\nhostname -oProxy\nport 22\n"), null);
  assert.equal(m.parseAdoptHostKey(`lixo\nHOSTKEY ${HOSTKEY}\n`), HOSTKEY);
  assert.equal(m.parseAdoptHostKey("HOSTKEY \n"), null);

  // O script põe a linha do admin uma vez só e não tira as dos outros admins.
  const home = mkdtempSync(join(tmpdir(), "adopt-"));
  mkdirSync(join(home, ".ssh"));
  const outro = `no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAAOutro meu-bot-admin:Outro`;
  writeFileSync(join(home, ".ssh", "authorized_keys"), `${outro}\n`);
  const sh = m.adoptScript({ nome: "Lucas", chave: ADMIN });
  for (let i = 0; i < 2; i++) execFileSync("bash", ["-c", sh], { env: { ...process.env, HOME: home } });
  const ak = readFileSync(join(home, ".ssh", "authorized_keys"), "utf8").trim().split("\n");
  assert.equal(ak.length, 2);
  assert.equal(ak[0], outro);
  assert.match(ak[1], / meu-bot-admin:Lucas$/);
  assert.equal(statSync(join(home, ".ssh", "authorized_keys")).mode & 0o777, 0o600);
  // Termux (Android): o sshd mora no prefixo, não em /etc/ssh.
  assert.match(sh, /\$\{PREFIX:-\/usr\}\/etc\/ssh\/ssh_host_ed25519_key\.pub/);
  // A chave sai de /etc/ssh quando a máquina tem sshd (Linux da CI); sem ele (Mac sem Login Remoto) o script cai no
  // PREFIX, que aqui aponta para uma chave de mentira: o teste não depende do sshd de quem o roda.
  const prefix = mkdtempSync(join(tmpdir(), "adopt-prefix-"));
  mkdirSync(join(prefix, "etc", "ssh"), { recursive: true });
  writeFileSync(join(prefix, "etc", "ssh", "ssh_host_ed25519_key.pub"), `${HOSTKEY} root@termux\n`);
  const hk = execFileSync("bash", ["-c", sh], { env: { ...process.env, HOME: home, PREFIX: prefix }, encoding: "utf8" });
  assert.match(hk, /^HOSTKEY ssh-ed25519 AAAA/m);
});
