import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// A unidade do proxy da xAI se chama meu-bot-xai-proxy.service, como as outras unidades meu-bot-* (a máquina é
// agnóstica: Hermes, OpenClaw ou os dois). Quem migra a hermes-xai-proxy.service de antes de 1/11 é o install.sh do
// backend (1.9.2), na atualização automática: o trecho `migrar_unidade_xai_proxy`, rodado sozinho em bash com um
// systemctl de mentira. A antiga sai do systemd e do disco; a nova nasce com o mesmo ExecStart (mesma porta).
const SH = readFileSync(resolve("backend-colima/install.sh"), "utf8");
const trecho = SH.slice(SH.indexOf("# --- migrar xai-proxy: início"), SH.indexOf("# --- migrar xai-proxy: fim"));
assert.ok(trecho.includes("migrar_unidade_xai_proxy()"), "o install.sh tem o trecho marcado");
const GROK = readFileSync(resolve("backend-colima/install-grok-oauth.sh"), "utf8");

const unidade = (porta) => `[Unit]\nDescription=Hermes: proxy da xAI (Grok por OAuth) para o meu-bot\nAfter=network.target\n\n[Service]\nExecStart=/x/hermes proxy start --provider xai --host 127.0.0.1 --port ${porta}\nRestart=always\n`;
function maquina({ antiga = null, nova = null } = {}) {
  const home = mkdtempSync(join(tmpdir(), "mb-xai-"));
  const u = join(home, ".config/systemd/user"); mkdirSync(join(u, "default.target.wants"), { recursive: true });
  if (antiga !== null) { writeFileSync(join(u, "hermes-xai-proxy.service"), unidade(antiga)); symlinkSync(join(u, "hermes-xai-proxy.service"), join(u, "default.target.wants/hermes-xai-proxy.service")); }
  if (nova !== null) writeFileSync(join(u, "meu-bot-xai-proxy.service"), unidade(nova));
  const bin = join(home, "bin"); mkdirSync(bin);
  writeFileSync(join(bin, "systemctl"), `#!/bin/bash\necho "systemctl $*" >> "${home}/chamadas"\n`); chmodSync(join(bin, "systemctl"), 0o755);
  return { home, u, bin };
}
function migrar(m) {
  const r = spawnSync("bash", ["-c", `set -euo pipefail\n${trecho}\nmigrar_unidade_xai_proxy "$1"\necho FIM`, "migrar", m.u],
    { encoding: "utf8", env: { ...process.env, PATH: `${m.bin}:${process.env.PATH}` } });
  const chamadas = existsSync(join(m.home, "chamadas")) ? readFileSync(join(m.home, "chamadas"), "utf8").trim().split("\n") : [];
  return { ...r, chamadas };
}

test("unidade antiga: nasce a nova com o mesmo ExecStart (mesma porta) e Description meu-bot; a antiga sai do systemd e do disco", () => {
  const m = maquina({ antiga: 8647 });
  const r = migrar(m);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.chamadas, [
    "systemctl --user disable --now hermes-xai-proxy.service",
    "systemctl --user daemon-reload",
    "systemctl --user enable --now meu-bot-xai-proxy.service",
  ]);
  const nova = readFileSync(join(m.u, "meu-bot-xai-proxy.service"), "utf8");
  assert.match(nova, /^ExecStart=\/x\/hermes proxy start --provider xai --host 127\.0\.0\.1 --port 8647$/m);
  assert.match(nova, /^Description=meu-bot: proxy da xAI \(Grok por OAuth, pelo Hermes\)$/m);
  assert.ok(!existsSync(join(m.u, "hermes-xai-proxy.service")), "arquivo antigo apagado");
  assert.ok(!existsSync(join(m.u, "default.target.wants/hermes-xai-proxy.service")), "link do wants apagado");
  assert.match(r.stdout, /unidade antiga hermes-xai-proxy\.service removida; o proxy passa a ser meu-bot-xai-proxy\.service \(porta 8647\)\nFIM/);
});

test("sem unidade antiga: não mexe em nada e não chama o systemctl", () => {
  const m = maquina({ nova: 8645 });
  const r = migrar(m);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.chamadas, []);
  assert.equal(r.stdout, "FIM\n");
  assert.equal(readFileSync(join(m.u, "meu-bot-xai-proxy.service"), "utf8"), unidade(8645), "a unidade nova continua igual");
});

test("as duas existem (migração interrompida no meio): a antiga sai, a nova fica como está e é ligada", () => {
  const m = maquina({ antiga: 8647, nova: 8645 });
  const r = migrar(m);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(m.u, "hermes-xai-proxy.service")));
  assert.equal(readFileSync(join(m.u, "meu-bot-xai-proxy.service"), "utf8"), unidade(8645));
  assert.ok(r.chamadas.includes("systemctl --user enable --now meu-bot-xai-proxy.service"));
});

test("o install.sh só migra com gerenciador de usuário; o install-grok-oauth.sh cria e liga meu-bot-xai-proxy.service e recusa a antiga", () => {
  assert.match(SH, /^user_manager && migrar_unidade_xai_proxy "\$HOME\/\.config\/systemd\/user"$/m);
  assert.match(GROK, /^UNIT=meu-bot-xai-proxy\.service$/m);
  assert.match(GROK, /cat > "\$U\/\$UNIT" <<EOF/);
  assert.match(GROK, /systemctl --user enable --now "\$UNIT"/);
  assert.match(GROK, /Description=meu-bot: proxy da xAI/);
  assert.match(GROK, /\[ -f "\$U\/hermes-xai-proxy\.service" \] && \{ echo "o backend desta máquina é anterior à 1\.9\.2[^}]*exit 3; \}/);
  assert.ok(!/migrar_unidade/.test(GROK), "a migração tem um dono só: o install.sh");
});
