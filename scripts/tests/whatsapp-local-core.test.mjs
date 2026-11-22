import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

// WhatsApp na máquina "local": os scripts das máquinas rodam em `bash -s` neste Mac com o prelúdio, que dá ao bash 3.2 e
// às ferramentas BSD o `timeout` e o `stat -c %Y` que os scripts esperam do Linux.
const c = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-local-core.js");
const noMac = process.platform === "darwin";
const bash = (script) => spawnSync("/bin/bash", ["-s"], { input: c.scriptLocal(script), encoding: "utf8", timeout: 30_000 });

test("scriptLocal: o prelúdio vem antes do script e põe ~/.local e o Homebrew no PATH", () => {
  const s = c.scriptLocal("echo oi\n");
  assert.ok(s.startsWith(c.LOCAL_SH_PRELUDE) && s.endsWith("echo oi\n"));
  assert.match(c.LOCAL_SH_PRELUDE, /\$HOME\/\.local\/bin/);
  assert.match(c.LOCAL_SH_PRELUDE, /\/opt\/homebrew\/bin/);
});

test("timeout: estoura com 124, devolve o código do comando e passa a saída", { skip: !noMac && "só no macOS" }, () => {
  const r = bash("timeout 1 sleep 5; echo a=$?; timeout 5 sh -c 'exit 3'; echo b=$?; timeout 5 echo saida");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^a=124$/m);
  assert.match(r.stdout, /^b=3$/m);
  assert.match(r.stdout, /^saida$/m);
});

test("stat -c %Y: o mtime em segundos (o pareamento compara o do creds.json)", { skip: !noMac && "só no macOS" }, () => {
  const f = join(mkdtempSync(join(tmpdir(), "mb-wa-local-")), "creds.json");
  writeFileSync(f, "{}");
  utimesSync(f, 1_700_000_000, 1_700_000_000);
  const r = bash(`stat -c %Y '${f}'`);
  assert.equal(r.stdout.trim(), "1700000000", r.stderr);
});

test("sem escolha gravada, o prelúdio grava o OpenClaw; uma escolha existente fica", () => {
  const home = mkdtempSync(join(tmpdir(), "mb-wa-home-"));
  const r1 = spawnSync("/bin/bash", ["-s"], { input: c.scriptLocal("cat \"$HOME/.local/share/meu-bot/whatsapp-agente\""), encoding: "utf8", env: { ...process.env, HOME: home } });
  assert.equal(r1.stdout.trim(), "openclaw", r1.stderr);
  writeFileSync(join(home, ".local/share/meu-bot/whatsapp-agente"), "picoclaw\n");
  const r2 = spawnSync("/bin/bash", ["-s"], { input: c.scriptLocal("cat \"$HOME/.local/share/meu-bot/whatsapp-agente\""), encoding: "utf8", env: { ...process.env, HOME: home } });
  assert.equal(r2.stdout.trim(), "picoclaw");
});

test("tail -F --pid: segue o arquivo e para quando o processo sai (o pareamento lê o QR assim)", { skip: !noMac && "só no macOS" }, () => {
  const d = mkdtempSync(join(tmpdir(), "mb-wa-tail-"));
  const r = bash(`L='${d}/log'; : > "$L"; ( echo linha1 >> "$L"; sleep 1; echo "linha 2" >> "$L"; sleep 1 ) & P=$!; tail -n +1 -F --pid=$P "$L" 2>/dev/null & T=$!; wait $P; wait $T; echo fim`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /linha1\nlinha 2\n[\s\S]*fim/);
  const s = bash(`printf 'a\\nb\\nc\\n' > '${d}/x'; tail -n 2 '${d}/x'`);
  assert.equal(s.stdout, "b\nc\n", "sem --pid é o tail de sempre");
});

test("as funções do prelúdio valem num bash filho (os instaladores rodam como `bash arquivo.sh`)", { skip: !noMac && "só no macOS" }, () => {
  const r = bash("bash -c 'type -t timeout; type -t stat; type -t tail; timeout 1 sleep 3; echo rc=$?'");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^function\nfunction\nfunction\nrc=124$/m);
});

test("sed -i sem sufixo (GNU): troca no próprio arquivo, sem deixar backup; sem -i, o sed de sempre; vale num bash filho", { skip: !noMac && "só no macOS" }, () => {
  const d = mkdtempSync(join(tmpdir(), "mb-sed-"));
  const f = join(d, "env");
  writeFileSync(f, "A=1\nHERMES_LOCAL_STT_COMMAND=velho\nB=2\n");
  // A mesma forma do HERMES_STT_COMPARTILHADO_SH (whatsapp-hermes-core.ts), que o sed do BSD recusa sem o prelúdio.
  const r = bash(`sed -i '/^HERMES_LOCAL_STT_COMMAND=/d' "${f}"; cat "${f}"; ls "${d}" | wc -l | tr -d ' '; echo x | sed 's/x/y/'; bash -c 'type -t sed'`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "A=1\nB=2\n1\ny\nfunction\n");
});

// Máquina por SSH: os ajustes do macOS só entram num Mac, e sem a escolha de agente (que é do host "local").
const remoto = (script, antes = "") => spawnSync("/bin/bash", ["-s"], { input: antes + c.scriptRemoto(script), encoding: "utf8", timeout: 30_000, env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME } });

test("scriptRemoto: num Mac leva o PATH do Homebrew e o timeout; o script da pessoa vem depois, inteiro", () => {
  const s = c.scriptRemoto("echo oi\n");
  assert.ok(s.startsWith('if [ "$(uname -s 2>/dev/null)" = Darwin ]; then\n') && s.endsWith("\nfi\necho oi\n"));
  assert.doesNotMatch(s, /whatsapp-agente/, "a escolha de agente não vai para a máquina dos outros");
  const mac = remoto('echo "t=$(type -t timeout)"; case "$PATH" in */opt/homebrew/bin*) echo brew=1 ;; *) echo brew=0 ;; esac; timeout 1 sleep 5; echo "rc=$?"\n', "uname() { echo Darwin; }\n");
  assert.match(mac.stdout, /brew=1/);
  assert.match(mac.stdout, /rc=124/, "o comando que passa do prazo é morto, como no GNU timeout");
});

test("scriptRemoto: em Linux o bloco não roda e nada muda", () => {
  const linux = remoto('echo "t=[$(type -t timeout)]"; echo "p=$PATH"; type -t stat; echo fim\n', "uname() { echo Linux; }\n");
  assert.doesNotMatch(linux.stdout, /t=\[function\]/, "nenhuma função nossa definida");
  assert.match(linux.stdout, /p=\/usr\/bin:\/bin\n/, "PATH intocado");
  assert.match(linux.stdout, /fim/);
});

