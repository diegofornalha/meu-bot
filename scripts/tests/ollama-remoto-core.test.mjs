import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Modo grátis numa máquina por SSH (tutorial 16): a leitura do estado, o script que o lê (bash num HOME de mentira) e a
// mescla do providers.json que o install-ollama.sh faz na máquina.
const req = createRequire(import.meta.url);
const r = req("../../dist/main/agente/ollamaRemoto-core.js");
const o = req("../../dist/main/agente/ollamaLocal-core.js");
const INSTALADOR = readFileSync(resolve("backend-colima/install-ollama.sh"), "utf8");

const saida = (over = {}) => Object.entries({ os: "Linux", arch: "x86_64", sd: 1, bk: 1, mem: 15997, livre: 84000, inst: 0, modelo: "", run: 0, pronto: 0, ...over }).map(([k, v]) => `${k}=${v}`).join("\n");

test("lerStatusRemoto: máquina Linux x86_64 com backend aguenta; instalado, rodando e pronto seguem a máquina", () => {
  const novo = r.lerStatusRemoto(saida());
  assert.equal(novo.possivel, true);
  assert.equal(novo.instalado, false); assert.equal(novo.pronto, false); assert.equal(novo.modelo, null);
  assert.equal(novo.remoto, true);
  assert.equal(novo.recomendado.id, "qwen2.5:3b", "na CPU da VPS vai sempre o modelo leve");
  assert.equal(novo.memMb, 15997); assert.equal(novo.livreMb, 84000);
  assert.equal(novo.necessarioMb, r.espacoNecessarioRemotoMb());
  assert.ok(novo.necessarioMb > 7000 && novo.necessarioMb < 9000, "pacote + extraído + modelo + folga");
  assert.equal(novo.programaMb, Math.ceil(o.OLLAMA_PACOTE_BYTES_LINUX / 1_048_576));

  const pronto = r.lerStatusRemoto(saida({ inst: 1, modelo: "qwen2.5:3b", run: 1, pronto: 1 }));
  assert.deepEqual([pronto.instalado, pronto.rodando, pronto.pronto, pronto.modelo], [true, true, true, "qwen2.5:3b"]);
  const parado = r.lerStatusRemoto(saida({ inst: 1, modelo: "qwen2.5:3b", run: 0, pronto: 0 }));
  assert.deepEqual([parado.instalado, parado.rodando, parado.pronto], [true, false, false]);
  assert.equal(r.lerStatusRemoto(saida({ inst: 1, modelo: "", run: 1, pronto: 0 })).pronto, false, "sem a entrada no providers.json não está pronto");
});

test("lerStatusRemoto: onde o modo grátis não roda", () => {
  assert.equal(r.lerStatusRemoto(saida({ arch: "aarch64" })).possivel, false);
  assert.equal(r.lerStatusRemoto(saida({ os: "Darwin", arch: "arm64" })).possivel, false, "Mac por SSH: o modo grátis do Mac é o da janela 'este Mac'");
  assert.equal(r.lerStatusRemoto(saida({ sd: 0 })).possivel, false, "sem systemd de usuário o Ollama não fica no ar");
  assert.equal(r.lerStatusRemoto(saida({ bk: 0 })).possivel, false, "sem o backend do meu-bot (ou antigo, sem providers.js)");
  assert.equal(r.lerStatusRemoto(saida({ mem: 3900 })).possivel, false, "pouca memória");
  assert.equal(r.lerStatusRemoto(saida({ mem: "" })).possivel, true, "memória desconhecida não barra");
  assert.equal(r.lerStatusRemoto(""), null);
  assert.equal(r.lerStatusRemoto("Permission denied"), null);
});

test("envDoInstalador: versão, sha256, URL e modelo saem do ollamaLocal-core", () => {
  const e = r.envDoInstalador();
  assert.ok(e.includes(`OLLAMA_VERSION=${o.OLLAMA_VERSION_LOCAL}`));
  assert.ok(e.includes(`OLLAMA_SHA256=${o.OLLAMA_SHA256_LINUX}`));
  assert.ok(e.includes(`OLLAMA_URL='${o.OLLAMA_URL_LINUX}'`));
  assert.ok(o.OLLAMA_URL_LINUX.endsWith(`/v${o.OLLAMA_VERSION_LOCAL}/ollama-linux-amd64.tar.zst`));
  assert.ok(e.includes("OLLAMA_MODELO='qwen2.5:3b'"));
  assert.match(o.OLLAMA_SHA256_LINUX, /^[0-9a-f]{64}$/);
  for (const v of ["OLLAMA_VERSION", "OLLAMA_SHA256", "OLLAMA_URL", "OLLAMA_MODELO", "OLLAMA_PACOTE_MB"]) assert.ok(INSTALADOR.includes(`\${${v}:`), `o instalador lê ${v}`);
});

/** HOME de mentira com o backend do meu-bot; `curl`, `systemctl`, `uname` e `df` falsos no PATH. */
function maquina({ porta = 8083, providers = null, instalado = false, modelo = null, responde = false, tags = "" } = {}) {
  const home = mkdtempSync(join(tmpdir(), "mb-ollama-"));
  const bd = join(home, ".local/share/meu-bot/backend"); mkdirSync(bd, { recursive: true });
  writeFileSync(join(bd, "server.js"), "// meu-bot/hello\n"); writeFileSync(join(bd, "providers.js"), "");
  writeFileSync(join(bd, ".env"), `OPENAI_COMPAT_KEY=x\nPORT=${porta}\n`);
  if (providers !== null) writeFileSync(join(bd, "providers.json"), providers);
  const px = join(home, ".local/share/meu-bot/ollama");
  if (instalado) { const b = join(px, `v${o.OLLAMA_VERSION_LOCAL}/bin`); mkdirSync(b, { recursive: true }); writeFileSync(join(b, "ollama"), "#!/bin/sh\n"); chmodSync(join(b, "ollama"), 0o755); }
  if (modelo !== null) { mkdirSync(px, { recursive: true }); writeFileSync(join(px, "modelo"), `${modelo}\n`); }
  const bin = join(home, "bin"); mkdirSync(bin);
  const falso = (nome, corpo) => { writeFileSync(join(bin, nome), `#!/bin/bash\n${corpo}\n`); chmodSync(join(bin, nome), 0o755); };
  falso("uname", 'if [ "$1" = -s ]; then echo Linux; else echo x86_64; fi');
  falso("systemctl", "exit 0");
  falso("df", 'echo "Filesystem 1048576-blocks Used Available Capacity Mounted"; echo "/dev/sda1 200000 100000 84000 55% /"');
  falso("curl", `echo "$*" >> "${home}/curl.log"; ${responde ? `case "$*" in *api/tags*) echo '${tags}';; esac; exit 0` : "exit 7"}`);
  return { home, bd, bin };
}
const rodar = (m, script) => spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, HOME: m.home, PATH: `${m.bin}:${process.env.PATH}` } });

test("OLLAMA_STATUS_SH: lê o estado num HOME de mentira e fala com a porta do backend - 200", () => {
  const vazia = maquina();
  const s0 = r.lerStatusRemoto(rodar(vazia, r.OLLAMA_STATUS_SH).stdout);
  assert.deepEqual([s0.possivel, s0.instalado, s0.rodando, s0.pronto, s0.modelo, s0.livreMb], [true, false, false, false, null, 84000]);

  const prov = JSON.stringify([{ name: "agente", type: "claude", priority: 0 }, { name: "ollama-local", type: "openai", priority: 9 }]);
  const pronta = maquina({ providers: prov, instalado: true, modelo: "qwen2.5:3b", responde: true, tags: '{"models":[{"name":"qwen2.5:3b"}]}' });
  const s1 = r.lerStatusRemoto(rodar(pronta, r.OLLAMA_STATUS_SH).stdout);
  assert.deepEqual([s1.instalado, s1.rodando, s1.pronto, s1.modelo], [true, true, true, "qwen2.5:3b"]);
  assert.match(readFileSync(join(pronta.home, "curl.log"), "utf8"), /127\.0\.0\.1:7883\/api\/version/, "porta 8083 - 200");

  // O arquivo `modelo` sobrou mas o providers.json não aponta mais o ollama-local: não está preparado.
  const orfa = maquina({ providers: JSON.stringify([{ name: "agente", type: "claude", priority: 0 }]), instalado: true, modelo: "qwen2.5:3b", responde: true, tags: '{"models":[{"name":"qwen2.5:3b"}]}' });
  const s2 = r.lerStatusRemoto(rodar(orfa, r.OLLAMA_STATUS_SH).stdout);
  assert.deepEqual([s2.instalado, s2.modelo, s2.pronto], [true, null, false]);
});

test("install-ollama.sh: sintaxe, e a mescla do providers.json preserva as outras entradas", () => {
  assert.equal(spawnSync("bash", ["-n", resolve("backend-colima/install-ollama.sh")], { encoding: "utf8" }).status, 0);
  const trecho = INSTALADOR.slice(INSTALADOR.indexOf("# --- providers.json: início ---"), INSTALADOR.indexOf("# --- providers.json: fim ---"));
  assert.ok(trecho.includes("providers_ollama()"), "o instalador tem o trecho marcado");
  const m = maquina({ providers: JSON.stringify([{ name: "agente", type: "claude", priority: 0 }, { name: "grok-4", type: "openai", priority: 1, base_url: "http://127.0.0.1:8645/v1", model: "grok-4" }]) });
  const p = join(m.bd, "providers.json");
  const chamar = (args) => spawnSync("bash", ["-c", `set -euo pipefail\nNODE=${JSON.stringify(process.execPath)}\n${trecho}\nproviders_ollama ${args}`], { encoding: "utf8" });
  assert.equal(chamar(`"${p}" por 7883 qwen2.5:3b`).status, 0);
  assert.equal(chamar(`"${p}" por 7883 qwen2.5:3b`).status, 0, "idempotente");
  const l = JSON.parse(readFileSync(p, "utf8"));
  assert.deepEqual(l.map((e) => e.name), ["agente", "grok-4", "ollama-local"], "o grok-4 fica; o ollama-local não duplica");
  assert.deepEqual(l[2], { ...o.entradaOllama(7883, "qwen2.5:3b"), description: "Modo grátis: Ollama nesta máquina (tutorial 16)" }, "a mesma entrada do Mac, só com a descrição da máquina");
  assert.equal(o.modeloNoProviders(readFileSync(p, "utf8"), 7883), "qwen2.5:3b", "o app lê o que a máquina gravou");
  assert.equal(chamar(`"${p}" tirar`).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(p, "utf8")).map((e) => e.name), ["agente", "grok-4"]);
  // Arquivo ilegível: recomeça do agente, como no Mac.
  writeFileSync(p, "{lixo");
  assert.equal(chamar(`"${p}" por 7883 qwen2.5:3b`).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(p, "utf8")).map((e) => e.name), ["agente", "ollama-local"]);
});
