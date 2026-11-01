import { test } from "node:test";
import assert from "node:assert/strict";
import { describeProbe, hostLabel } from "../../dist/renderer/lib/probe-text.js";

const base = { host: "vm", reachable: true, user: "box", os: "Debian 13", arch: "x86_64", backendInstalled: false, backendForeign: false, backendListening: false, appPort: 8080, backendPort: null, portBusy: false, freePort: null, claudePath: "/usr/bin/claude", claudeLoggedIn: true, node: "v24", systemd: true, tailscaleCheck: false, statusLine: true, models: [], error: null };

test("estados da sondagem remota", () => {
  assert.deepEqual(pick(describeProbe({ ...base, reachable: false, error: "timeout" })), { kind: "bad", install: null, canOpen: false });
  assert.deepEqual(pick(describeProbe({ ...base, backendInstalled: true, backendListening: true, models: ["claudecode", "agente"] })), { kind: "ok", install: null, canOpen: true });
  assert.match(describeProbe({ ...base, backendInstalled: true, backendListening: true, models: ["claudecode", "agente"] }).text, /modelos: claudecode, agente/);
  assert.deepEqual(pick(describeProbe({ ...base, backendInstalled: true, backendListening: false })), { kind: "warn", install: "reinstall", canOpen: true });
  assert.deepEqual(pick(describeProbe({ ...base, claudePath: null })), { kind: "bad", install: "claude", canOpen: false });
  assert.match(describeProbe({ ...base, claudePath: null }).text, /Instalar Claude Code/);
  assert.deepEqual(pick(describeProbe({ ...base, claudeLoggedIn: false })), { kind: "bad", install: null, canOpen: false });
  assert.match(describeProbe({ ...base, claudeLoggedIn: false }).text, /Entrar no Claude Code/);
  assert.equal(describeProbe({ ...base, claudeLoggedIn: false }).login, true);
  // backend no ar mas Claude deslogado: dá para abrir (grok-4 responde), mas avisa e oferece o login
  const offLogged = describeProbe({ ...base, backendInstalled: true, backendListening: true, claudeLoggedIn: false });
  assert.deepEqual(pick(offLogged), { kind: "warn", install: null, canOpen: true });
  assert.equal(offLogged.login, true);
  assert.deepEqual(pick(describeProbe(base)), { kind: "warn", install: "install", canOpen: false });
});

test("estados do local", () => {
  const local = { ...base, host: "local" };
  assert.deepEqual(pick(describeProbe({ ...local, claudeLoggedIn: false })), { kind: "bad", install: null, canOpen: false });
  assert.deepEqual(pick(describeProbe({ ...local, backendInstalled: true })), { kind: "ok", install: null, canOpen: true });
  assert.equal(hostLabel("local"), "este Mac (sem SSH)");
  assert.equal(hostLabel("colima"), "colima");
});

test("status line do Claude: o seletor não oferece nem avisa (o tutorial 16 instala)", () => {
  const up = { ...base, backendInstalled: true, backendListening: true, models: ["claudecode"] };
  assert.deepEqual(pick(describeProbe(up)), { kind: "ok", install: null, canOpen: true });
  const sem = describeProbe({ ...up, statusLine: false });
  assert.deepEqual(pick(sem), { kind: "ok", install: null, canOpen: true });
  assert.doesNotMatch(sem.text, /status line/);
  // Sem backend, o que se oferece é o backend; a status line vem depois.
  assert.deepEqual(pick(describeProbe({ ...base, statusLine: false })), { kind: "warn", install: "install", canOpen: false });
  const local = { ...base, host: "local", backendInstalled: true };
  assert.deepEqual(pick(describeProbe({ ...local, statusLine: false })), { kind: "ok", install: null, canOpen: true });
  assert.deepEqual(pick(describeProbe(local)), { kind: "ok", install: null, canOpen: true });
});

test("transcrição de áudio: o seletor não oferece nem avisa (o tutorial 3 cuida do áudio)", () => {
  const up = { ...base, backendInstalled: true, backendListening: true, models: ["claudecode"], gateway: "openclaw" };
  const sem = describeProbe({ ...up, audioIn: false });
  assert.deepEqual(pick(sem), { kind: "ok", install: null, canOpen: true });
  assert.doesNotMatch(sem.text, /transcrição/);
  assert.deepEqual(pick(describeProbe({ ...up, audioIn: false, statusLine: false })).install, null);
  assert.deepEqual(pick(describeProbe({ ...up, audioIn: true })).install, null);
  assert.doesNotMatch(describeProbe({ ...up, audioIn: null }).text, /transcrição/);
});

test("porta: backend da máquina em outra porta → 'Usar porta N' com um clique; só essa máquina muda", () => {
  const other = describeProbe({ ...base, backendInstalled: true, backendListening: true, backendPort: 8081, models: ["claudecode"] });
  assert.deepEqual(pick(other), { kind: "warn", install: "porta", canOpen: false });
  assert.equal(other.port, 8081);
  assert.match(other.text, /porta 8081, mas o app usa a 8080/);
  assert.match(other.text, /Usar porta 8081/);
  // Backend parado mas em outra porta: a porta vem antes de "reinstalar" (reinstalar na porta errada não resolveria).
  assert.deepEqual(pick(describeProbe({ ...base, backendInstalled: true, backendListening: false, backendPort: 8081 })), { kind: "warn", install: "porta", canOpen: false });
  // Mesma porta ou .env sem PORT: nada muda.
  assert.deepEqual(pick(describeProbe({ ...base, backendInstalled: true, backendListening: true, backendPort: 8080, models: ["claudecode"] })), { kind: "ok", install: null, canOpen: true });
  assert.equal(describeProbe({ ...base, backendInstalled: true, backendListening: true, backendPort: null, models: ["claudecode"] }).port, undefined);
});

test("porta ocupada sem backend nesta conta: instala na primeira livre e avisa; sem livre, manda trocar nas Configurações", () => {
  const busy = describeProbe({ ...base, portBusy: true, freePort: 8081 });
  assert.deepEqual(pick(busy), { kind: "warn", install: "install", canOpen: false });
  assert.equal(busy.port, 8081);
  assert.match(busy.text, /porta 8080 já está ocupada/);
  assert.match(busy.text, /instala na 8081/);
  const none = describeProbe({ ...base, portBusy: true, freePort: null });
  assert.deepEqual(pick(none), { kind: "bad", install: null, canOpen: false });
  assert.match(none.text, /Configurações/);
  // Porta ocupada mas pelo backend desta conta (instalado e na mesma porta): é o estado normal, sem aviso.
  assert.deepEqual(pick(describeProbe({ ...base, backendInstalled: true, backendListening: true, backendPort: 8080, portBusy: true, models: ["claudecode"] })), { kind: "ok", install: null, canOpen: true });
  // Sem login, o login vem antes da porta.
  assert.deepEqual(pick(describeProbe({ ...base, portBusy: true, freePort: 8081, claudeLoggedIn: false })), { kind: "bad", install: null, canOpen: false });
});

function pick(t) { return { kind: t.kind, install: t.install, canOpen: t.canOpen }; }

test("serviço meu-bot-backend no ar sem os arquivos no disco: explica e reinstala na porta do serviço, nunca instala outro ao lado", () => {
  const t = describeProbe({ ...base, backendSumiu: true, backendUnitPort: 8083, appPort: 8083, portBusy: true, freePort: 8084 });
  assert.deepEqual(pick(t), { kind: "warn", install: "reinstall", canOpen: false });
  assert.equal(t.port, 8083);
  assert.match(t.text, /arquivos do backend sumiram do disco/);
  assert.match(t.text, /responde na porta 8083/);
  assert.doesNotMatch(t.text, /8084/);
  // Sem a porta do processo, a do app.
  assert.equal(describeProbe({ ...base, backendSumiu: true, backendUnitPort: null }).port, 8080);
  // Vem antes do login: reinstalar não depende do Claude logado.
  assert.equal(describeProbe({ ...base, backendSumiu: true, backendUnitPort: 8083, claudeLoggedIn: false }).install, "reinstall");
});

test("backend de outro agente na pasta herdada: não é instalado; instalar vai para a porta livre e explica de quem é a 8080", () => {
  const t = describeProbe({ ...base, backendForeign: true, portBusy: true, freePort: 8081 });
  assert.equal(t.install, "install"); assert.equal(t.port, 8081); assert.match(t.text, /outro agente desta máquina/);
});

test("guarda do WhatsApp: o seletor não oferece nem avisa (o tutorial 9 cuida)", () => {
  const up = { ...base, backendInstalled: true, backendListening: true, models: ["claudecode"], gateway: "openclaw" };
  const sem = describeProbe({ ...up, guarda: false });
  assert.deepEqual(pick(sem), { kind: "ok", install: null, canOpen: true });
  assert.doesNotMatch(sem.text, /guarda/);
});

test("nome da máquina: o deste Mac vence o apelido gravado na máquina, que vence o nome SSH", async () => {
  const { hostLabel, setHostNicknames, setApelidoMaquina } = await import("../../dist/renderer/lib/probe-text.js");
  setHostNicknames({});
  assert.equal(hostLabel("meu-box-3"), "meu-box-3");
  assert.equal(setApelidoMaquina("meu-box-3", "Maria"), true, "mudou o nome mostrado");
  assert.equal(hostLabel("meu-box-3"), "Maria");
  assert.equal(setApelidoMaquina("meu-box-3", "Maria"), false, "o mesmo apelido não repinta");
  setHostNicknames({ "meu-box-3": "Mãe" });
  assert.equal(hostLabel("meu-box-3"), "Mãe", "o Renomear deste Mac vence");
  setHostNicknames({});
  setApelidoMaquina("meu-box-3", null);
  assert.equal(hostLabel("meu-box-3"), "meu-box-3");
});
