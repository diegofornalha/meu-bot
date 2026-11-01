import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// O hook de rebuild (issue #57) numa máquina de mentira: um `origin` bare, um checkout com o hook, `npm`/`open`/
// `osascript`/`pgrep` falsos que só anotam, HOME próprio com um app "instalado". O que se prova: só o origin/main é
// empacotado (num worktree fixo ao lado do checkout principal), um branch ganha só os testes, e o estado é global.
const HOOK = resolve("scripts/hooks/rebuild-auto.sh");
const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

function maquina() {
  const d = mkdtempSync(join(tmpdir(), "mb-rebuild-"));
  const home = join(d, "home"); mkdirSync(join(home, "Applications", "meu-bot-admin.app"), { recursive: true });
  const bin = join(d, "bin"); mkdirSync(bin);
  const calls = join(d, "calls");
  const sh = (nome, corpo) => { writeFileSync(join(bin, nome), `#!/bin/sh\n${corpo}\n`); chmodSync(join(bin, nome), 0o755); };
  // npm: anota a chamada; `npm test` falha se existir o arquivo "falhar" na pasta de estado
  sh("npm", `echo "npm $* em $(basename "$PWD")" >> "${calls}"\n[ "$1" = test ] && [ -f "${d}/falhar" ] && exit 1\nexit 0`);
  sh("open", `echo "open $*" >> "${calls}"`); sh("osascript", `exit 0`); sh("pgrep", `exit 1`); sh("pkill", `exit 0`); sh("curl", `exit 0`);
  // origin bare + checkout "principal" (o dono do .git), como ~/Desktop/meu-bot
  const origin = join(d, "origin.git"); execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const seed = join(d, "seed"); execFileSync("git", ["init", "-q", "-b", "main", seed]);
  mkdirSync(join(seed, "scripts", "hooks"), { recursive: true }); mkdirSync(join(seed, "src"));
  writeFileSync(join(seed, "scripts", "hooks", "rebuild-auto.sh"), readFileSync(HOOK)); writeFileSync(join(seed, "src", "a.ts"), "1"); writeFileSync(join(seed, "package.json"), "{}");
  git(seed, "add", "."); git(seed, "commit", "-qm", "um"); git(seed, "remote", "add", "origin", origin); git(seed, "push", "-q", "origin", "main");
  const principal = join(d, "meu-bot"); execFileSync("git", ["clone", "-q", origin, principal]);
  mkdirSync(join(principal, "node_modules")); mkdirSync(join(principal, "build", "extensao-autenticador"), { recursive: true }); mkdirSync(join(principal, "config")); writeFileSync(join(principal, "config", "google-oauth.json"), "{}");
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin:/usr/local/bin`, MEU_BOT_REBUILD_DIR: join(d, "estado"), MEU_BOT_REBUILD_LOG: join(d, "rebuild.log") };
  const hook = (dir, ...args) => spawnSync("bash", [join(dir, "scripts", "hooks", "rebuild-auto.sh"), ...args], { encoding: "utf8", env, input: "{}", cwd: dir });
  const chamadas = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);
  const instalado = () => (existsSync(join(d, "estado", "instalado")) ? readFileSync(join(d, "estado", "instalado"), "utf8").trim() : null);
  return { d, home, seed, origin, principal, build: join(d, "meu-bot-build-main"), hook, chamadas, instalado, env };
}
const sha = (dir, ref) => git(dir, "rev-parse", "--short=12", ref);

test("--run: empacota o origin/main num worktree fixo ao lado do checkout principal e grava o commit instalado", () => {
  const m = maquina();
  const r = m.hook(m.principal, "--run");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(m.build, ".git")), "worktree de build criado em ../meu-bot-build-main");
  assert.equal(sha(m.build, "HEAD"), sha(m.origin, "main"));
  assert.equal(git(m.build, "branch", "--show-current"), "", "detached, não num branch");
  assert.ok(existsSync(join(m.build, "node_modules")) && existsSync(join(m.build, "config", "google-oauth.json")), "dependências e client do Google vieram do principal");
  const c = m.chamadas();
  assert.ok(c.includes("npm test em meu-bot-build-main") && c.includes("npm run dist:admin em meu-bot-build-main"), `testou e empacotou no worktree de build: ${c.join(" | ")}`);
  assert.equal(m.instalado(), `${sha(m.origin, "main")} ok`);
  // nada a fazer: o hook fica calado e não dispara outro ciclo
  const h = m.hook(m.principal); assert.equal(h.stdout.trim(), ""); assert.equal(m.chamadas().length, c.length);
});

test("hook: origin/main mudou → avisa e instala em segundo plano; o main local com commit fora do origin não conta", async () => {
  const m = maquina();
  m.hook(m.principal, "--run");
  const antes = m.instalado();
  // commit local no main do principal, sem push: não é instalado
  writeFileSync(join(m.principal, "src", "a.ts"), "local"); git(m.principal, "commit", "-qam", "local");
  assert.equal(m.hook(m.principal).stdout.trim(), "", "commit local no main não dispara nada");
  // outra pessoa empurrou para o origin/main
  writeFileSync(join(m.seed, "src", "a.ts"), "2"); git(m.seed, "commit", "-qam", "dois"); git(m.seed, "push", "-q", "origin", "main");
  const h = m.hook(m.principal);
  const novo = sha(m.origin, "main");
  assert.match(h.stdout, new RegExp(`origin/main mudou \\(${novo}\\)`));
  for (let i = 0; i < 40 && m.instalado() === antes; i++) await new Promise((r) => setTimeout(r, 250));
  assert.equal(m.instalado(), `${novo} ok`);
  assert.equal(sha(m.build, "HEAD"), novo, "o worktree de build seguiu o origin/main");
  assert.notEqual(sha(m.principal, "HEAD"), novo, "o checkout principal não foi tocado");
});

test("hook num branch: mudança no código roda só os testes, não empacota, e diz como ver o branch na tela", async () => {
  const m = maquina();
  m.hook(m.principal, "--run");
  const n = m.chamadas().length;
  const wt = join(m.d, "meu-bot-feature"); git(m.principal, "worktree", "add", "-q", "-b", "feature", wt, "origin/main");
  assert.equal(m.hook(wt).stdout.trim(), "", "a primeira resposta no worktree só marca o ponto de partida");
  writeFileSync(join(wt, "src", "a.ts"), "feature");
  const h = m.hook(wt);
  assert.match(h.stdout, /Branch feature: 1 arquivo\(s\) do app mudaram\. O hook não empacota branches/);
  assert.match(h.stdout, /npm run dist… neste worktree/);
  for (let i = 0; i < 40 && m.chamadas().length === n; i++) await new Promise((r) => setTimeout(r, 250));
  const novas = m.chamadas().slice(n);
  assert.deepEqual(novas, ["npm test em meu-bot-feature"], "só os testes, no próprio worktree");
  assert.equal(m.hook(wt).stdout.trim(), "", "carimbado: não repete a cada resposta");
});

test("--run com testes quebrados no origin/main: nada empacotado, e o hook não insiste até o main mudar", () => {
  const m = maquina();
  writeFileSync(join(m.d, "falhar"), "");
  m.hook(m.principal, "--run");
  assert.equal(m.instalado(), `${sha(m.origin, "main")} falhou`);
  assert.ok(!m.chamadas().some((c) => c.startsWith("npm run dist")), "sem empacotar");
  assert.equal(m.hook(m.principal).stdout.trim(), "", "o mesmo commit não é tentado de novo");
});

test("--check mostra branch, origin/main × instalado e o plano", () => {
  const m = maquina();
  const out = m.hook(m.principal, "--check").stdout;
  assert.match(out, /^branch: main · checkout principal: .*meu-bot · worktree de build: .*meu-bot-build-main$/m);
  assert.match(out, /^origin\/main: [0-9a-f]{12} · instalado: nenhum$/m);
  assert.match(out, /admin\|meu-bot-admin\|dist:admin\|so-build/);
});
