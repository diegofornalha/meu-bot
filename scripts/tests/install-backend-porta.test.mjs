import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// O trecho `liberar_porta_propria` do install.sh, rodado sozinho em bash com systemctl/ss/sudo de mentira: a porta
// ocupada pelo meu-bot-backend desta conta rodando sem arquivos (pasta apagada) é liberada parando o serviço, e a
// reinstalação segue na mesma porta; porta de outro processo continua sendo "ocupada" (código 4 no instalador).
const SH = readFileSync(resolve("backend-colima/install.sh"), "utf8");
const trecho = SH.slice(SH.indexOf("# --- porta: início"), SH.indexOf("# --- porta: fim"));
assert.ok(trecho.includes("liberar_porta_propria()"), "o install.sh tem o trecho marcado");
assert.match(SH, /if ! liberar_porta_propria "\$PORT"; then\n\s+echo "ERRO: a porta \$PORT já está ocupada/);

function maquina({ userPid = 0, sysPid = 0, sysUser = "", ss = "" }) {
  const home = mkdtempSync(join(tmpdir(), "mb-porta-")); const bin = join(home, "bin"); mkdirSync(bin);
  const fake = (nome, corpo) => { writeFileSync(join(bin, nome), `#!/bin/bash\n${corpo}`); chmodSync(join(bin, nome), 0o755); };
  fake("systemctl", `echo "systemctl $*" >> "${home}/chamadas"\ncase "$*" in\n  "--user show -p MainPID --value meu-bot-backend.service") echo ${userPid};;\n  "show -p User --value meu-bot-backend.service") echo "${sysUser}";;\n  "show -p MainPID --value meu-bot-backend.service") echo ${sysPid};;\nesac\n`);
  fake("ss", `printf '%s\\n' "State Recv-Q Send-Q Local Address:Port Peer Address:Port Process" ${JSON.stringify(ss)}\n`);
  fake("sudo", `echo "sudo $*" >> "${home}/chamadas"\n`);
  return { home, bin };
}
function liberar(m, porta) {
  const r = spawnSync("bash", ["-c", `set -euo pipefail\n${trecho}\nif liberar_porta_propria "$1"; then echo LIBEROU; else echo OCUPADA; fi`, "porta", String(porta)],
    { encoding: "utf8", env: { ...process.env, PATH: `${m.bin}:${process.env.PATH}` } });
  const chamadas = existsSync(join(m.home, "chamadas")) ? readFileSync(join(m.home, "chamadas"), "utf8") : "";
  return { ...r, chamadas };
}

test("unidade de usuário desta conta escutando na porta: para o serviço e libera", () => {
  const m = maquina({ userPid: 4242, ss: 'LISTEN 0 511 127.0.0.1:8080 0.0.0.0:* users:(("node",pid=4242,fd=20))' });
  const r = liberar(m, 8080);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /a porta 8080 é do meu-bot-backend antigo desta conta[^\n]*parando o serviço para reinstalar na mesma porta\nLIBEROU/);
  assert.match(r.chamadas, /^systemctl --user stop meu-bot-backend\.service$/m);
});

test("porta de outro processo (ou sem unidade): continua ocupada, nada é parado", () => {
  const outro = liberar(maquina({ userPid: 4242, ss: 'LISTEN 0 511 127.0.0.1:8080 0.0.0.0:* users:(("python3",pid=99,fd=3))' }), 8080);
  assert.match(outro.stdout, /^OCUPADA$/m); assert.doesNotMatch(outro.chamadas, /stop/);
  const sem = liberar(maquina({ ss: 'LISTEN 0 511 127.0.0.1:8080 0.0.0.0:* users:(("node",pid=4242,fd=20))' }), 8080);
  assert.match(sem.stdout, /^OCUPADA$/m); assert.doesNotMatch(sem.chamadas, /stop/);
});

test("unidade de sistema desta conta (User = eu, sem unidade de usuário): para pelo sudo -n", () => {
  const eu = spawnSync("id", ["-un"], { encoding: "utf8" }).stdout.trim();
  const m = maquina({ sysPid: 777, sysUser: eu, ss: 'LISTEN 0 511 127.0.0.1:8083 0.0.0.0:* users:(("node",pid=777,fd=20))' });
  const r = liberar(m, 8083);
  assert.match(r.stdout, /LIBEROU/);
  assert.match(r.chamadas, /^sudo -n systemctl stop meu-bot-backend\.service$/m);
  // Unidade de sistema de OUTRA conta: não é minha.
  const alheia = liberar(maquina({ sysPid: 777, sysUser: "root", ss: 'LISTEN 0 511 127.0.0.1:8083 0.0.0.0:* users:(("node",pid=777,fd=20))' }), 8083);
  assert.match(alheia.stdout, /^OCUPADA$/m);
});
