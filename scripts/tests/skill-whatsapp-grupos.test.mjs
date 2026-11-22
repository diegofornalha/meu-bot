import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const D = join(import.meta.dirname, "..", "..", "backend-colima", "skills", "whatsapp-grupos");

test("skill whatsapp-grupos no pacote: genérica (sem conta, porta ou caminho de outra máquina) e scripts válidos", () => {
  const sk = readFileSync(join(D, "SKILL.md"), "utf8");
  assert.match(sk, /^---\nname: whatsapp-grupos\n/);
  // Números só o de exemplo (5511999998888); nada de conta real, caminho ou porta de outra máquina.
  for (const n of sk.match(/\+?55\d{10,11}\b/g) ?? []) assert.equal(n.replace("+", ""), "5511999998888", `número real no SKILL.md: ${n}`);
  for (const proibido of [/\/home\/[a-z]/, /mythos/, /box-lv/, /18791/]) assert.doesNotMatch(sk, proibido);
  assert.match(sk, /--remetentes/, "avisa para limitar quem dispara em grupo");
  const scripts = readdirSync(join(D, "scripts")).sort();
  assert.deepEqual(scripts, ["habilitar.py", "listar.sh", "monitor.py", "wa-admin.sh", "wa-grupos.js"]);
  for (const f of scripts) assert.doesNotMatch(readFileSync(join(D, "scripts", f), "utf8"), /\/home\/[a-z]/, `${f} sem caminho fixo de conta`);
  execFileSync("bash", ["-n", join(D, "scripts", "wa-admin.sh")]); execFileSync("bash", ["-n", join(D, "scripts", "listar.sh")]);
  execFileSync(process.execPath, ["--check", join(D, "scripts", "wa-grupos.js")]);
  execFileSync("python3", ["-c", "import ast,sys; ast.parse(open(sys.argv[1]).read())", join(D, "scripts", "habilitar.py")]);
  execFileSync("python3", ["-c", "import ast,sys; ast.parse(open(sys.argv[1]).read())", join(D, "scripts", "monitor.py")]);
  // A guarda leva a skill e nunca toca no cache da conta.
  const inst = readFileSync(join(D, "..", "..", "install-guarda.sh"), "utf8");
  assert.match(inst, /skills\/whatsapp-grupos/); assert.doesNotMatch(inst, /rm -rf "\$K/);
});

// wa-admin.sh acha o Node fora do PATH de um SSH sem login: pelo atalho `openclaw` (exec <node> …), senão pelos lugares
// em que o meu-bot instala Node (/opt/node*, /opt/openclaw/node, ~/.local/node*). Era "node não encontrado" no host em que
// o Node de todos está em /opt/node24 e o da conta em ~/.local/node.
test("wa-admin.sh: achar_node vê o node do atalho openclaw e o de ~/.local/node*, não só /opt/node e o PATH", () => {
  const fn = execFileSync("sed", ["-n", "/^achar_node()/,/^}/p", join(D, "scripts", "wa-admin.sh")], { encoding: "utf8" });
  assert.match(fn, /achar_node\(\)/);
  const t = mkdtempSync(join(tmpdir(), "wa-admin-node-"));
  try {
    const home = join(t, "home"); const bin = join(t, "bin");
    mkdirSync(join(home, ".local/node24/bin"), { recursive: true }); mkdirSync(bin, { recursive: true });
    const meu = join(home, ".local/node24/bin/node");
    writeFileSync(meu, "#!/bin/sh\necho fake\n", { mode: 0o755 });
    const acha = () => execFileSync("bash", ["-c", `${fn}\nachar_node`], { encoding: "utf8", env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } }).trim();
    // Sem atalho: o de ~/.local/node24.
    assert.equal(acha(), meu);
    // Atalho de todos apontando para um node de verdade (o que roda o gateway): esse ganha.
    const outro = join(t, "opt/node24/bin/node"); mkdirSync(join(t, "opt/node24/bin"), { recursive: true }); writeFileSync(outro, "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(bin, "openclaw"), `#!/bin/sh\nexec ${outro} /x/openclaw.mjs "$@"\n`, { mode: 0o755 });
    assert.equal(acha(), outro);
    // Atalho apontando para um node que não existe mais: ignora e segue para o da conta.
    writeFileSync(join(bin, "openclaw"), "#!/bin/sh\nexec /nao/existe/bin/node /x \"$@\"\n", { mode: 0o755 });
    assert.equal(acha(), meu);
    // Sem atalho, sem ~/.local/node* e sem node no PATH: só sobram os lugares fixos da máquina (/opt/node*, /usr/local/bin).
    // Vazio quando esta máquina não tem nenhum (o script então avisa e sai sem parar o gateway); o runner do GitHub
    // tem /usr/local/bin/node, e aí é esse que tem de sair.
    const fixo = execFileSync("bash", ["-c", 'for n in /opt/node/bin/node /opt/openclaw/node/bin/node /opt/node*/bin/node /usr/local/bin/node; do [[ -x "$n" ]] && { echo "$n"; break; }; done; true'], { encoding: "utf8" }).trim();
    assert.equal(execFileSync("bash", ["-c", `${fn}\nachar_node; true`], { encoding: "utf8", env: { HOME: join(t, "vazio"), PATH: "/usr/bin:/bin" } }).trim(), fixo);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

// Máquina com o gateway num perfil próprio (OPENCLAW_STATE_DIR=~/.openclaw-<perfil>): o plugin existe, mas fora do
// ~/.openclaw. O "checar" dizia "reinstale o plugin"; agora diz onde ele está e que o meu-bot só lê o perfil padrão.
test("wa-grupos.js checar: plugin em outro perfil do OpenClaw é dito como tal; sem plugin nenhum, manda reinstalar", () => {
  const home = mkdtempSync(join(tmpdir(), "wa-perfil-"));
  try {
    const checar = () => spawnSync(process.execPath, [join(D, "scripts", "wa-grupos.js"), "checar"], { env: { ...process.env, HOME: home }, encoding: "utf8" });
    let r = checar();
    assert.equal(r.status, 1); assert.match(r.stderr, /reinstale o plugin/);
    mkdirSync(join(home, ".openclaw-meu-perfil", "extensions", "whatsapp", "node_modules", "baileys"), { recursive: true });
    r = checar();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /outro perfil \(~\/\.openclaw-meu-perfil\)/); assert.doesNotMatch(r.stderr, /reinstale/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
