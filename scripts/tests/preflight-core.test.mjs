import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMANDO_LOG_BACKEND, classificarPreflight, detalheTentativa, dicaDoLog, erroFinal, podeDiagnosticar, textoPreflight } from "../../dist/main/maquina/preflight-core.js";

test("classificarPreflight: cortada (reset/hang up/EPIPE), recusada, timeout (local, AbortError) e HTTP 5xx", () => {
  assert.deepEqual(classificarPreflight({ code: "ECONNRESET" }, null), { tipo: "cortada", codigo: "ECONNRESET", status: null });
  assert.equal(classificarPreflight({ message: "socket hang up" }, null).tipo, "cortada");
  assert.equal(classificarPreflight({ code: "EPIPE" }, null).tipo, "cortada");
  assert.deepEqual(classificarPreflight({ code: "ECONNREFUSED" }, null), { tipo: "recusada", codigo: "ECONNREFUSED", status: null });
  assert.equal(classificarPreflight({ code: "ETIMEDOUT_LOCAL" }, null).tipo, "timeout");
  assert.equal(classificarPreflight({ name: "AbortError", message: "aborted" }, null).tipo, "timeout");
  assert.deepEqual(classificarPreflight(null, 502), { tipo: "http", codigo: "HTTP 502", status: 502 });
  assert.equal(classificarPreflight({ message: "coisa estranha" }, null).codigo, "coisa estranha");
});

test("textoPreflight: diz backend e porta, não 'VM pausada', quando o túnel entrou e ninguém escuta", () => {
  assert.equal(textoPreflight({ tipo: "cortada", codigo: "ECONNRESET", status: null }, 8083), "o backend desta máquina não está respondendo na porta 8083 (ECONNRESET: o túnel entrou, mas ninguém escuta nessa porta)");
  assert.equal(textoPreflight({ tipo: "recusada", codigo: "ECONNREFUSED", status: null }, 8083), "o túnel SSH não está escutando na porta local (ECONNREFUSED)");
  assert.equal(textoPreflight({ tipo: "timeout", codigo: "ETIMEDOUT_LOCAL", status: null }, 8080), "o backend desta máquina não respondeu na porta 8080 em 8 s (travado, ou a VM pausada)");
  assert.equal(textoPreflight({ tipo: "http", codigo: "HTTP 502", status: 502 }, 8080, true), "o backend deste Mac respondeu HTTP 502 na porta 8080");
});

test("detalheTentativa: preflight leva o texto; erro de SSH mantém 'VM sem resposta' com o motivo curto", () => {
  assert.equal(detalheTentativa({ tipo: "cortada", codigo: "ECONNRESET", status: null }, null, 8083, 5, 2), "o backend desta máquina não está respondendo na porta 8083 (ECONNRESET: o túnel entrou, mas ninguém escuta nessa porta); tentando de novo em 5 s (2ª vez)…");
  assert.equal(detalheTentativa(null, "VM inacessível pelo SSH após 3 tentativas. SSH não conectou (255)", 8080, 3, 1), "VM sem resposta (VM inacessível pelo SSH após 3 tentativas. SSH não conectou (255)); tentando de novo em 3 s (1ª vez)…");
  assert.equal(detalheTentativa(null, null, 8080, 3, 1), "VM sem resposta; tentando de novo em 3 s (1ª vez)…");
});

test("erroFinal: backend parado aponta o serviço e a dica; timeout admite a VM pausada; SSH mantém o texto de sempre", () => {
  const cortada = { tipo: "cortada", codigo: "ECONNRESET", status: null };
  assert.equal(erroFinal({ falha: cortada, sshErr: null, porta: 8083, segundos: 75, interativo: true, dica: "MODULE_NOT_FOUND ./gmail" }),
    "O backend desta máquina não respondeu na porta 8083 em 75 s (ECONNRESET). O serviço meu-bot-backend pode ter caído: \"Reinstalar backend\" no seletor sobe o serviço de novo. Último erro do backend: MODULE_NOT_FOUND ./gmail.");
  assert.equal(erroFinal({ falha: cortada, sshErr: null, porta: 8083, segundos: 75, interativo: true, dica: null }),
    "O backend desta máquina não respondeu na porta 8083 em 75 s (ECONNRESET). O serviço meu-bot-backend pode ter caído: \"Reinstalar backend\" no seletor sobe o serviço de novo.");
  assert.match(erroFinal({ falha: cortada, sshErr: null, porta: 8790, segundos: 75, interativo: true, dica: null, local: true }), /^O backend deste Mac .* Feche e abra a janela desta máquina/);
  assert.equal(erroFinal({ falha: { tipo: "timeout", codigo: "ETIMEDOUT_LOCAL", status: null }, sshErr: null, porta: 8080, segundos: 75, interativo: true, dica: null }),
    "O backend desta máquina não respondeu na porta 8080 em 75 s (timeout): ele pode estar travado, ou a VM pausada pelo host. Tente de novo daqui a pouco.");
  assert.equal(erroFinal({ falha: null, sshErr: "SSH não conectou (255)", porta: 8080, segundos: 75, interativo: true, dica: null }),
    "A VM não respondeu pelo túnel em 75 s, mesmo reabrindo. Ela pode estar pausada pelo host; tente de novo daqui a pouco. (SSH não conectou (255))");
  assert.equal(erroFinal({ falha: null, sshErr: null, porta: 8080, segundos: 75, interativo: false, dica: null }), "A VM não respondeu pelo túnel, mesmo depois de reabrir.");
});

test("dicaDoLog: MODULE_NOT_FOUND vence (o loop de 1/11), depois EADDRINUSE, SyntaxError, start-limit, result, Error:", () => {
  const loop = [
    "2026-11-01T06:10:04+00:00 agente node[2245314]: Error: Cannot find module './gmail'",
    "2026-11-01T06:10:04+00:00 agente node[2245314]: Require stack:",
    "2026-11-01T06:10:04+00:00 agente node[2245314]:   code: 'MODULE_NOT_FOUND',",
    "2026-11-01T06:10:04+00:00 agente systemd[1]: meu-bot-backend.service: Main process exited, code=exited, status=1/FAILURE",
    "2026-11-01T06:10:04+00:00 agente systemd[1]: meu-bot-backend.service: Failed with result 'exit-code'.",
    "2026-11-01T06:10:07+00:00 agente systemd[1]: meu-bot-backend.service: Scheduled restart job, restart counter is at 176.",
  ];
  assert.equal(dicaDoLog(loop), "MODULE_NOT_FOUND ./gmail");
  assert.equal(dicaDoLog(["Error: listen EADDRINUSE: address already in use 127.0.0.1:8080", "Failed with result 'exit-code'."]), "EADDRINUSE: porta já em uso");
  assert.equal(dicaDoLog(["/x/server.js:12", "SyntaxError: Unexpected token '}'", "    at wrapSafe"]), "SyntaxError: Unexpected token '}'");
  assert.equal(dicaDoLog(["meu-bot-backend.service: Start request repeated too quickly.".replace("Start", "start")]), "systemd desistiu de reiniciar (start-limit)");
  assert.equal(dicaDoLog(["meu-bot-backend.service: Failed with result 'signal'."]), "serviço falhou (signal)");
  assert.equal(dicaDoLog(["TypeError: x is not a function", "2026-11-01 [backend] ouvindo em http://127.0.0.1:8080"]), "TypeError: x is not a function");
  assert.equal(dicaDoLog(["[backend] ouvindo em http://127.0.0.1:8080", "limites da conta: no-token"]), null);
  assert.equal(dicaDoLog([]), null);
});

test("podeDiagnosticar: um por episódio, com piso de 2 min", () => {
  assert.equal(podeDiagnosticar(null, 1000), true);
  assert.equal(podeDiagnosticar(1000, 60_000), false);
  assert.equal(podeDiagnosticar(1000, 121_000), true);
});

/** Máquina falsa: journalctl/systemctl que dizem como foram chamados, `id` que escolhe root ou usuário. */
function maquina(uid, { unidadeSistema = false, backendLog = true } = {}) {
  const h = mkdtempSync(join(tmpdir(), "mb-pf-")); mkdirSync(join(h, "bin"));
  const sh = (nome, corpo) => { writeFileSync(join(h, "bin", nome), `#!/bin/sh\n${corpo}\n`); chmodSync(join(h, "bin", nome), 0o755); };
  sh("journalctl", `echo "J $*"`); sh("systemctl", `echo "ActiveState=failed"; echo "NRestarts=176"`); sh("id", `echo ${uid}`);
  const bd = join(h, ".local", "share", "meu-bot", "backend"); mkdirSync(bd, { recursive: true });
  writeFileSync(join(bd, "server.js"), "// meu-bot/hello");
  if (backendLog) writeFileSync(join(bd, "backend.log"), "linha 1\nError: Cannot find module './pontes'\n");
  if (unidadeSistema) { mkdirSync(join(h, "etc", "systemd", "system"), { recursive: true }); writeFileSync(join(h, "etc", "systemd", "system", "meu-bot-backend.service"), "[Unit]\n"); }
  return h;
}
const rodar = (h) => spawnSync("bash", ["-c", COMANDO_LOG_BACKEND.replaceAll("/etc/systemd/system/meu-bot-backend.service", `${h}/etc/systemd/system/meu-bot-backend.service`)], { encoding: "utf8", env: { HOME: h, PATH: `${h}/bin:/usr/bin:/bin` } }).stdout;

test("COMANDO_LOG_BACKEND: usuário lê a unidade --user (e a de sistema se existir) e o backend.log; root lê só a de sistema", () => {
  const u = rodar(maquina(1000));
  assert.match(u, /unidade=usuario ActiveState=failed NRestarts=176/); assert.match(u, /^J --user -u meu-bot-backend -n 40/m); assert.ok(!/unidade=sistema/.test(u));
  assert.match(u, /--- backend\.log\nlinha 1\nError: Cannot find module '\.\/pontes'/);
  assert.equal(dicaDoLog(u.split("\n")), "MODULE_NOT_FOUND ./pontes");
  const u2 = rodar(maquina(1000, { unidadeSistema: true }));
  assert.match(u2, /unidade=usuario/); assert.match(u2, /unidade=sistema/); assert.match(u2, /^J -u meu-bot-backend/m);
  const r = rodar(maquina(0, { backendLog: false }));
  assert.match(r, /^unidade=sistema ActiveState=failed NRestarts=176/); assert.match(r, /^J -u meu-bot-backend -n 40/m); assert.ok(!/--user|backend\.log/.test(r));
});
