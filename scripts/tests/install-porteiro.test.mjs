import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

/** HOME de mentira com .bashrc guardado, backend com o porteiro e um `systemctl` falso que anota o que foi chamado. */
function maquina() {
  const home = mkdtempSync(path.join(tmpdir(), "meu-bot-instport-"));
  const dest = path.join(home, ".local/share/meu-bot/backend"); mkdirSync(dest, { recursive: true });
  copyFileSync(path.join(RAIZ, "backend-colima/claude-porteiro.js"), path.join(dest, "claude-porteiro.js"));
  writeFileSync(path.join(dest, ".env"), "CLAUDE_BIN=/usr/local/bin/claude\n");
  writeFileSync(path.join(home, ".bashrc"), "[ -z \"$PS1\" ] && return\nalias ll='ls -l'\n");
  mkdirSync(path.join(home, ".hermes")); // máquina com Hermes: o wa-enviar ganha a regra no CLAUDE.md do agente
  mkdirSync(path.join(home, "agent-workspace")); writeFileSync(path.join(home, "agent-workspace/CLAUDE.md"), "# regras da máquina\n");
  const fakebin = path.join(home, "fakebin"); mkdirSync(fakebin);
  const chamadas = path.join(home, "systemctl.log");
  writeFileSync(path.join(fakebin, "systemctl"), `#!/usr/bin/env bash\necho "$*" >> "${chamadas}"\ncase "$*" in *"show -p Environment"*) echo "PATH=/usr/bin:/bin HOME=${home}";; esac\nexit 0\n`);
  chmodSync(path.join(fakebin, "systemctl"), 0o755);
  const env = { HOME: home, PATH: `${fakebin}:/usr/bin:/bin`, MEU_BOT_NODE: process.execPath, MEU_BOT_BACKEND_DIR: dest };
  const rodar = (script) => spawnSync("bash", [path.join(RAIZ, "backend-colima", script)], { env, encoding: "utf8" });
  return { home, env, rodar, chamadas: () => (existsSync(chamadas) ? readFileSync(chamadas, "utf8").trim().split("\n") : []), limpar: () => rmSync(home, { recursive: true, force: true }) };
}

test("install-porteiro: shim, bloco de PATH no topo dos perfis e drop-in do gateway; rodar de novo não repete nada; desinstalar limpa", () => {
  const m = maquina();
  const r = m.rodar("install-porteiro.sh");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const shim = path.join(m.home, ".local/share/meu-bot/bin/claude");
  assert.ok(existsSync(shim)); assert.match(readFileSync(shim, "utf8"), new RegExp(`NODE="\\$\\{MEU_BOT_NODE:-${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}"`));
  const bashrc = readFileSync(path.join(m.home, ".bashrc"), "utf8");
  assert.ok(bashrc.trimEnd().endsWith("# meu-bot:porteiro fim"), "bloco no fim: depois de qualquer linha que ponha ~/.local/bin na frente");
  assert.ok(bashrc.startsWith("[ -z \"$PS1\" ] && return"), "o começo do .bashrc fica como era");
  assert.equal((bashrc.match(/meu-bot:porteiro inicio/g) || []).length, 1);
  assert.match(bashrc, /alias ll='ls -l'/, "o resto do .bashrc fica");
  assert.ok(readFileSync(path.join(m.home, ".profile"), "utf8").includes("meu-bot:porteiro inicio"), ".profile criado com o bloco");
  assert.ok(!existsSync(path.join(m.home, ".zshrc")), "arquivos opcionais não são criados");
  const dropin = readFileSync(path.join(m.home, ".config/systemd/user/openclaw-gateway.service.d/meu-bot.conf"), "utf8");
  assert.match(dropin, new RegExp(`^Environment=PATH=${m.home}/.local/share/meu-bot/bin:/usr/bin:/bin$`, "m"));
  assert.match(dropin, /^Environment=MEU_BOT_ORIGEM=whatsapp$/m);
  assert.equal(m.chamadas().filter((c) => c.includes("restart")).length, 1);
  const waEnviar = path.join(m.home, ".local/share/meu-bot/bin/wa-enviar");
  assert.ok(existsSync(waEnviar), "wa-enviar instalado ao lado do shim");
  const claudeMd = readFileSync(path.join(m.home, "agent-workspace/CLAUDE.md"), "utf8");
  assert.ok(claudeMd.startsWith("# regras da máquina\n"), "o que já havia no CLAUDE.md fica");
  assert.equal((claudeMd.match(/meu-bot:wa-enviar v1 inicio/g) || []).length, 1);
  assert.match(claudeMd, /wa-enviar <número com DDI>/);
  // Segunda vez: nada muda, nenhum restart.
  const r2 = m.rodar("install-porteiro.sh");
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.equal((readFileSync(path.join(m.home, ".bashrc"), "utf8").match(/meu-bot:porteiro inicio/g) || []).length, 1);
  assert.equal((readFileSync(path.join(m.home, "agent-workspace/CLAUDE.md"), "utf8").match(/meu-bot:wa-enviar v1 inicio/g) || []).length, 1, "regra do wa-enviar não repete");
  assert.equal(m.chamadas().filter((c) => c.includes("restart")).length, 1, "drop-in igual: sem segundo restart");
  // Desinstala: shim, blocos e drop-in somem; o .bashrc volta ao que era.
  const u = m.rodar("uninstall-porteiro.sh");
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.ok(!existsSync(shim));
  assert.ok(!existsSync(waEnviar), "wa-enviar some");
  assert.equal(readFileSync(path.join(m.home, "agent-workspace/CLAUDE.md"), "utf8"), "# regras da máquina\n", "só o bloco do wa-enviar sai do CLAUDE.md");
  assert.equal(readFileSync(path.join(m.home, ".bashrc"), "utf8"), "[ -z \"$PS1\" ] && return\nalias ll='ls -l'\n");
  assert.ok(!existsSync(path.join(m.home, ".config/systemd/user/openclaw-gateway.service.d/meu-bot.conf")));
  m.limpar();
});

test("wa-enviar: sem espelho do hermes send, reabre a conversa pelo Python do Hermes e diz o que aconteceu", () => {
  const home = mkdtempSync(path.join(tmpdir(), "wa-enviar-"));
  const fakebin = path.join(home, "fakebin"), R = path.join(home, "hermes-agent");
  mkdirSync(fakebin); mkdirSync(path.join(R, "venv/bin"), { recursive: true });
  // hermes falso: diz onde está instalado e "envia" com o espelho que o teste pedir.
  writeFileSync(path.join(fakebin, "hermes"), `#!/usr/bin/env bash\ncase "$1" in --version) echo "Install directory: ${R}";; send) echo "$*" >> "${home}/send.log"; echo "{ \\"mirrored\\": $ESPELHO }";; esac\n`);
  // Python falso do Hermes: guarda o alvo e o texto e responde o que o teste pedir.
  writeFileSync(path.join(R, "venv/bin/python3"), `#!/usr/bin/env bash\ncat > /dev/null\nprintf '%s|%s\\n' "$2" "$3" >> "${home}/py.log"\nprintf '%b' "$RESPOSTA"\n`);
  // timeout falso: o macOS não tem o do coreutils, e o teste não precisa do prazo.
  writeFileSync(path.join(fakebin, "timeout"), `#!/usr/bin/env bash\nshift\nexec "$@"\n`);
  for (const f of [path.join(fakebin, "hermes"), path.join(fakebin, "timeout"), path.join(R, "venv/bin/python3")]) chmodSync(f, 0o755);
  const rodar = (alvo, ESPELHO, RESPOSTA) => spawnSync("bash", [path.join(RAIZ, "backend-colima/wa-enviar"), alvo, "oi, tudo bem?"], { env: { HOME: home, PATH: `${fakebin}:/usr/bin:/bin`, ESPELHO, RESPOSTA }, encoding: "utf8" });
  const py = () => (existsSync(path.join(home, "py.log")) ? readFileSync(path.join(home, "py.log"), "utf8").trim().split("\n") : []);
  // Espelho nativo deu certo: nem chama o Python.
  let r = rodar("123@lid", "true", "");
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /ENVIADA E REGISTRADA na conversa \(123@lid\)\.$/m); assert.equal(py().length, 0);
  // Conversa encerrada: reabre e registra o mesmo texto no mesmo chat.
  r = rodar("123@lid", "false", "reaberta\\nregistrada\\n");
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /ENVIADA E REGISTRADA.*estava encerrada e foi reaberta/); assert.deepEqual(py(), ["123@lid|oi, tudo bem?"]);
  // Contato que nunca teve conversa: avisa, sem fingir registro.
  r = rodar("123@lid", "false", "sem-sessao\\n");
  assert.equal(r.status, 0); assert.match(r.stderr, /SEM registro.*nunca teve conversa/); assert.doesNotMatch(r.stdout, /REGISTRADA/);
  // Python do Hermes falhou: avisa.
  r = rodar("123@lid", "false", "");
  assert.match(r.stderr, /SEM registro.*não deu para reabrir/);
  // Grupo: não tenta reabrir (a sessão de grupo é por remetente).
  const antes = py().length; r = rodar("999-1@g.us", "false", "registrada\\n");
  assert.match(r.stderr, /SEM registro/); assert.equal(py().length, antes);
  rmSync(home, { recursive: true, force: true });
});
