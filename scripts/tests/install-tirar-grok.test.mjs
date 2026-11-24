import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// O produto base só tem o Claude na corrente; outro motor de IA é um módulo à parte. O install.sh do backend (1.18.8),
// a cada instalação/atualização, tira da máquina SEM o módulo ligado a entrada `grok-4` do providers.json e o proxy
// local dela: o trecho `tirar_grok_sem_modulo`, rodado sozinho em bash num HOME de mentira com um systemctl de mentira.
const SH = readFileSync(resolve("backend-colima/install.sh"), "utf8");
const trecho = SH.slice(SH.indexOf("# --- tirar o grok: início"), SH.indexOf("# --- tirar o grok: fim"));
assert.ok(trecho.includes("tirar_grok_sem_modulo()"), "o install.sh tem o trecho marcado");

const AGENTE = { name: "agente", type: "claude", priority: 0, description: "Claude Code com ferramentas, sem pedir permissão (bypass)" };
const GROK = { name: "grok-4", type: "openai", priority: 1, base_url: "http://127.0.0.1:8645/v1", model: "grok-4", description: "Grok da xAI pelo proxy local do Hermes (login OAuth: hermes auth add xai-oauth)" };
const OLLAMA = { name: "ollama-local", type: "openai", priority: 9, base_url: "http://127.0.0.1:7884/v1", model: "qwen2.5:3b", reserva: false, rotulo: "Grátis (local)" };
const unidade = (porta) => `[Unit]\nDescription=meu-bot: proxy da xAI (Grok por OAuth, pelo Hermes)\n\n[Service]\nExecStart=/x/hermes proxy start --provider xai --host 127.0.0.1 --port ${porta}\nRestart=always\n`;

function maquina({ providers = null, unidades = [], modulo = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "mb-tirar-grok-"));
  const dest = join(home, ".local/share/meu-bot/backend"); mkdirSync(dest, { recursive: true });
  const u = join(home, ".config/systemd/user"); mkdirSync(join(u, "default.target.wants"), { recursive: true });
  const p = join(dest, "providers.json");
  if (providers !== null) writeFileSync(p, typeof providers === "string" ? providers : `${JSON.stringify(providers, null, 2)}\n`);
  for (const n of unidades) { writeFileSync(join(u, n), unidade(8645)); symlinkSync(join(u, n), join(u, "default.target.wants", n)); }
  if (modulo) { const d = join(home, ".local/share/meu-bot/modulos/grok"); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "ligado"), ""); }
  // O que NÃO pode sumir: a credencial da xAI no Hermes e o próprio Hermes (pode ser o motor do WhatsApp da conta).
  mkdirSync(join(home, ".hermes")); writeFileSync(join(home, ".hermes/auth.json"), '{"xai-oauth":{"token":"t"}}');
  const bin = join(home, "bin"); mkdirSync(bin);
  writeFileSync(join(bin, "systemctl"), `#!/bin/bash\necho "systemctl $*" >> "${home}/chamadas"\n`); chmodSync(join(bin, "systemctl"), 0o755);
  writeFileSync(join(bin, "hermes"), "#!/bin/bash\nexit 0\n"); chmodSync(join(bin, "hermes"), 0o755);
  return { home, dest, u, p, bin };
}
function rodar(m) {
  // O trecho vai para um arquivo e os caminhos entram como argumentos: nada é montado dentro de uma linha de shell.
  const script = join(m.home, "rodar.sh");
  writeFileSync(script, `set -euo pipefail\nNODE=$1\n${trecho}\ntirar_grok_sem_modulo "$2" "$3"\necho FIM\n`);
  const r = spawnSync("bash", [script, process.execPath, m.p, m.u],
    { encoding: "utf8", env: { ...process.env, HOME: m.home, PATH: `${m.bin}:${process.env.PATH}` } });
  const chamadas = existsSync(join(m.home, "chamadas")) ? readFileSync(join(m.home, "chamadas"), "utf8").trim().split("\n") : [];
  return { ...r, chamadas };
}
const lista = (m) => JSON.parse(readFileSync(m.p, "utf8"));
const COPIA = "providers.json.antes-de-tirar-o-grok";

test("máquina com grok-4 e ollama-local, sem o módulo: some só o grok (ordem e campos do resto iguais), o proxy para e sai do disco; Hermes e credencial ficam", () => {
  const m = maquina({ providers: [AGENTE, GROK, OLLAMA], unidades: ["meu-bot-xai-proxy.service"] });
  const antes = readFileSync(m.p, "utf8");
  const r = rodar(m);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lista(m), [AGENTE, OLLAMA]);
  assert.equal(readFileSync(join(m.dest, COPIA), "utf8"), antes, "a cópia é o arquivo como estava");
  assert.deepEqual(readdirSync(m.dest).sort(), ["providers.json", COPIA], "nenhum temporário sobrando");
  assert.deepEqual(r.chamadas, ["systemctl --user disable --now meu-bot-xai-proxy.service", "systemctl --user daemon-reload"]);
  assert.ok(!existsSync(join(m.u, "meu-bot-xai-proxy.service")), "unidade apagada");
  assert.deepEqual(readdirSync(join(m.u, "default.target.wants")), [], "link do wants apagado");
  assert.equal(r.stdout, [
    `Grok: saiu do providers.json desta máquina (agora ele é um módulo à parte); o arquivo anterior ficou em ${m.p}.antes-de-tirar-o-grok`,
    "Grok: proxy local parado e removido dos serviços desta conta (meu-bot-xai-proxy.service)",
    "FIM", "",
  ].join("\n"));
  assert.equal(readFileSync(join(m.home, ".hermes/auth.json"), "utf8"), '{"xai-oauth":{"token":"t"}}', "a credencial da xAI não é apagada");
  assert.ok(existsSync(join(m.bin, "hermes")), "o Hermes não é desinstalado");
  assert.ok(!/\bhermes (auth|uninstall)|npm (un|r)|rm -rf/.test(trecho), "o trecho não desinstala o Hermes nem mexe em credencial");
});

test("segunda rodada: nada a fazer, nada impresso, nenhuma chamada, e a cópia da primeira vez não é sobrescrita", () => {
  const m = maquina({ providers: [AGENTE, GROK, OLLAMA], unidades: ["meu-bot-xai-proxy.service"] });
  const antes = readFileSync(m.p, "utf8");
  assert.equal(rodar(m).status, 0);
  const depoisDaPrimeira = readFileSync(m.p, "utf8");
  const chamadasDaPrimeira = rodar(m);
  assert.equal(chamadasDaPrimeira.status, 0, chamadasDaPrimeira.stderr);
  assert.equal(chamadasDaPrimeira.stdout, "FIM\n");
  assert.equal(chamadasDaPrimeira.chamadas.length, 2, "só as duas chamadas da primeira rodada");
  assert.equal(readFileSync(m.p, "utf8"), depoisDaPrimeira);
  // O grok volta ao arquivo (alguém preparou de novo por um app antigo): sai outra vez, e a cópia continua a primeira.
  writeFileSync(m.p, JSON.stringify([GROK, AGENTE]));
  const r = rodar(m);
  assert.deepEqual(lista(m), [AGENTE]);
  assert.match(r.stdout, /^Grok: saiu do providers\.json/);
  assert.equal(readFileSync(join(m.dest, COPIA), "utf8"), antes, "a cópia é sempre a da primeira vez");
});

test("máquina com o módulo ligado: nada muda (providers.json, unidade e systemctl intocados) e nada é impresso", () => {
  const m = maquina({ providers: [AGENTE, GROK, OLLAMA], unidades: ["meu-bot-xai-proxy.service", "hermes-xai-proxy.service"], modulo: true });
  const antes = readFileSync(m.p, "utf8");
  const r = rodar(m);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "FIM\n");
  assert.deepEqual(r.chamadas, []);
  assert.equal(readFileSync(m.p, "utf8"), antes);
  assert.ok(!existsSync(join(m.dest, COPIA)));
  assert.equal(readFileSync(join(m.u, "meu-bot-xai-proxy.service"), "utf8"), unidade(8645));
  assert.ok(existsSync(join(m.u, "default.target.wants/meu-bot-xai-proxy.service")));
});

test("máquina sem nada (só o agente, ou o modo grátis, ou sem providers.json): nada impresso, nada gravado, systemctl não é chamado", () => {
  for (const providers of [[AGENTE], [AGENTE, OLLAMA], null]) {
    const m = maquina({ providers });
    const antes = providers === null ? null : readFileSync(m.p, "utf8");
    const r = rodar(m);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "FIM\n");
    assert.deepEqual(r.chamadas, []);
    if (antes === null) assert.deepEqual(readdirSync(m.dest), []);
    else { assert.equal(readFileSync(m.p, "utf8"), antes, "byte a byte"); assert.deepEqual(readdirSync(m.dest), ["providers.json"]); }
  }
});

test("unidade legada (hermes-xai-proxy.service) e proxy sem grok no providers.json: as duas unidades saem; o arquivo fica como está", () => {
  const m = maquina({ providers: [AGENTE, OLLAMA], unidades: ["meu-bot-xai-proxy.service", "hermes-xai-proxy.service"] });
  const antes = readFileSync(m.p, "utf8");
  const r = rodar(m);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.chamadas, [
    "systemctl --user disable --now meu-bot-xai-proxy.service",
    "systemctl --user disable --now hermes-xai-proxy.service",
    "systemctl --user daemon-reload",
  ]);
  assert.deepEqual(readdirSync(m.u), ["default.target.wants"]);
  assert.equal(r.stdout, "Grok: proxy local parado e removido dos serviços desta conta (meu-bot-xai-proxy.service, hermes-xai-proxy.service)\nFIM\n");
  assert.equal(readFileSync(m.p, "utf8"), antes);
  assert.ok(!existsSync(join(m.dest, COPIA)));
});

test("providers.json que não dá para ler como lista (quebrado, ou 'grok-4' só num texto): fica byte a byte, sem cópia e sem aviso", () => {
  for (const texto of ["{ isso não é json, grok-4", JSON.stringify({ name: "grok-4" }), JSON.stringify([AGENTE, { ...OLLAMA, description: "não é o grok-4" }])]) {
    const m = maquina({ providers: texto });
    const r = rodar(m);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "FIM\n");
    assert.equal(readFileSync(m.p, "utf8"), texto);
    assert.deepEqual(readdirSync(m.dest), ["providers.json"]);
  }
});

test("providers.json que não dá para regravar (pasta só de leitura): avisa, deixa o arquivo como está e a instalação segue", { skip: process.getuid?.() === 0 }, () => {
  const m = maquina({ providers: [AGENTE, GROK], unidades: ["meu-bot-xai-proxy.service"] });
  const antes = readFileSync(m.p, "utf8");
  chmodSync(m.dest, 0o555);
  const r = rodar(m);
  chmodSync(m.dest, 0o755);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(m.p, "utf8"), antes);
  assert.deepEqual(readdirSync(m.dest), ["providers.json"], "nem cópia nem temporário pela metade");
  assert.match(r.stdout, /^aviso: não consegui tirar o grok-4 de .*providers\.json \(sem permissão ou sem espaço para gravar\); tire a entrada à mão, senão o backend ainda tenta o Grok quando o Claude falha\nGrok: proxy local parado/);
  assert.match(r.stdout, /FIM\n$/);
});

test("o install.sh chama a migração antes de reiniciar o backend, em qualquer gerenciador; a migração antiga da unidade saiu", () => {
  const chamada = SH.indexOf('\ntirar_grok_sem_modulo "$DEST/providers.json" "$HOME/.config/systemd/user"\n');
  assert.ok(chamada > 0, "a chamada existe, sem condição na frente");
  for (const reinicio of ["systemctl --user restart meu-bot-backend.service", "$SUDO systemctl restart meu-bot-backend.service", "supervisorctl restart meu-bot-backend", '"$PM2" restart meu-bot-backend', 'nohup "$NODE" server.js']) {
    const i = SH.indexOf(reinicio, SH.indexOf("SYS_UNIT=/etc/systemd/system/meu-bot-backend.service"));
    assert.ok(i > chamada, `a migração vem antes de: ${reinicio}`);
  }
  assert.ok(!/migrar_unidade_xai_proxy/.test(SH));
});
