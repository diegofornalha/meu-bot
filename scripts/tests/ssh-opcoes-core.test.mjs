// Opções do ssh do túnel por plataforma: com master (macOS, Linux) ou cada ssh com a sua conexão (Windows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { compartilhaConexao, opcoesDoTunel } = createRequire(import.meta.url)("../../dist/main/maquina/ssh-opcoes-core.js");

test("só o Windows fica sem conexão compartilhada", () => {
  assert.equal(compartilhaConexao("darwin"), true);
  assert.equal(compartilhaConexao("linux"), true);
  assert.equal(compartilhaConexao("win32"), false);
});

test("com master: o ControlPath é o socket; as demais opções e o `-- host` no fim", () => {
  const o = opcoesDoTunel("vps", "/tmp/meu-bot-501/cm-%C");
  assert.deepEqual(o.slice(0, 2), ["-o", "ControlPath=/tmp/meu-bot-501/cm-%C"]);
  assert.deepEqual(o.slice(-2), ["--", "vps"]);
  for (const op of ["BatchMode=yes", "ConnectTimeout=15", "StrictHostKeyChecking=accept-new", "ServerAliveInterval=15", "ServerAliveCountMax=3", "TCPKeepAlive=yes"]) assert.ok(o.includes(op), op);
});

test("sem master: ControlPath=none e nada mais muda", () => {
  const com = opcoesDoTunel("vps", "/x/cm-%C"), sem = opcoesDoTunel("vps", null);
  assert.equal(sem[1], "ControlPath=none");
  assert.deepEqual(sem.slice(2), com.slice(2));
});
