import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { parseSshConfig, planSshSync, renderSshAppend, normalizeInclude, identityFiles } = createRequire(import.meta.url)("../../dist/main/maquina/ssh-sync.js");

const HOME = "/Users/alguem";
const template = `# comentário
Include ~/.colima/ssh_config

Host grokbot-1
    HostName 100.69.163.93
    User box
    IdentityFile ~/.ssh/id_ed25519

Host agente-box
    HostName 187.127.41.175
    User box
    IdentityFile ~/.ssh/id_ed25519
`;

test("parseSshConfig separa Include e blocos Host com o texto original", () => {
  const p = parseSshConfig(template);
  assert.deepEqual(p.includes, ["~/.colima/ssh_config"]);
  assert.deepEqual(p.blocks.map((b) => b.aliases), [["grokbot-1"], ["agente-box"]]);
  assert.equal(p.blocks[0].text, "Host grokbot-1\n    HostName 100.69.163.93\n    User box\n    IdentityFile ~/.ssh/id_ed25519");
});

test("arquivo vazio: entra tudo, sem hosts mantidos", () => {
  const plan = planSshSync(template, "", HOME);
  assert.deepEqual(plan.includesToAdd, ["~/.colima/ssh_config"]);
  assert.deepEqual(plan.hostsToAdd.map((b) => b.aliases[0]), ["grokbot-1", "agente-box"]);
  assert.deepEqual(plan.kept, []);
  assert.deepEqual(plan.onlyLocal, []);
  const out = renderSshAppend(plan, "2026-10-14 10:00:00");
  assert.match(out, /^\n# meu-bot: máquinas sincronizadas em 2026-10-14 10:00:00\nInclude ~\/.colima\/ssh_config\n\nHost grokbot-1\n/);
  assert.ok(out.endsWith("IdentityFile ~/.ssh/id_ed25519\n"));
});

test("host existente é mantido intacto; Include com caminho absoluto equivalente não repete", () => {
  const current = `Include ${HOME}/.colima/ssh_config\n\nHost grokbot-1\n    HostName 1.2.3.4\n    User outro\n\nHost rota\n    HostName 5.6.7.8\n\nHost *\n    ServerAliveInterval 30\n`;
  const plan = planSshSync(template, current, HOME);
  assert.deepEqual(plan.includesToAdd, []);
  assert.deepEqual(plan.hostsToAdd.map((b) => b.aliases[0]), ["agente-box"]);
  assert.deepEqual(plan.kept, ["grokbot-1"]);
  assert.deepEqual(plan.onlyLocal, ["rota"]);
});

test("nada a fazer rende texto vazio", () => {
  const plan = planSshSync(template, template, HOME);
  assert.equal(renderSshAppend(plan, "x"), "");
  assert.deepEqual(plan.kept, ["grokbot-1", "agente-box"]);
});

test("normalizeInclude: ~, relativo a ~/.ssh e absoluto", () => {
  assert.equal(normalizeInclude("~/.colima/ssh_config", HOME), `${HOME}/.colima/ssh_config`);
  assert.equal(normalizeInclude("config.d/*", HOME), `${HOME}/.ssh/config.d/*`);
  assert.equal(normalizeInclude("/etc/ssh/x", HOME), "/etc/ssh/x");
});

test("identityFiles lista as chaves do modelo sem repetir, com ~ expandido", () => {
  assert.deepEqual(identityFiles(template, HOME), [`${HOME}/.ssh/id_ed25519`]);
});

test("remover do seletor: bloco inteiro, só o alias, ou nada (Include não é mexido)", () => {
  const { removeSshHost } = createRequire(import.meta.url)("../../dist/main/maquina/ssh-sync.js");
  const cfg = ["Include ~/.colima/ssh_config", "", "# minhas máquinas", "Host vm-a", "    HostName 1.2.3.4", "    User eu", "", "Host vm-b vm-b2", "    HostName 5.6.7.8", "", "Host *", "    ServerAliveInterval 30", ""].join("\n");
  const a = removeSshHost(cfg, "vm-a");
  assert.equal(a.removed, "block");
  assert.ok(!a.text.includes("Host vm-a") && !a.text.includes("1.2.3.4"));
  assert.ok(a.text.endsWith("\n# meu-bot: não sincronizar vm-a\n"), "fica a marca para o sync não trazer de volta");
  assert.equal(removeSshHost(a.text, "vm-b2").text.match(/não sincronizar vm-a/g).length, 1, "marca não repete");
  assert.ok(a.text.includes("Include ~/.colima/ssh_config") && a.text.includes("Host vm-b vm-b2") && a.text.includes("ServerAliveInterval 30"));
  const b = removeSshHost(cfg, "vm-b2");
  assert.equal(b.removed, "alias");
  assert.ok(b.text.includes("Host vm-b\n    HostName 5.6.7.8"));
  assert.deepEqual(removeSshHost(cfg, "colima"), { text: cfg, removed: null });
  assert.equal(removeSshHost("Host=vm-c\n  HostName x\n", "vm-c").removed, "block");
});

test("sync: máquina num Include conta como existente", () => {
  const plan = planSshSync(template, "Include ~/.ssh/cursor_config\n", HOME, ["Host agente-box\n    HostName 187.127.41.175\n    User box\n"]);
  assert.deepEqual(plan.hostsToAdd.map((b) => b.aliases[0]), ["grokbot-1"]);
  assert.deepEqual(plan.kept, ["agente-box"]);
  assert.deepEqual(plan.onlyLocal, [], "o que vem de Include não é 'só neste Mac'");
});

test("sync: mesma máquina com outro nome (renomeada) não entra de novo", () => {
  const current = "Host agente-box-openclaw\n    HostName 187.127.41.175\n    User box\n    Port 22\n";
  const plan = planSshSync(template, current, HOME);
  assert.deepEqual(plan.hostsToAdd.map((b) => b.aliases[0]), ["grokbot-1"]);
  assert.deepEqual(plan.sameTarget, [{ alias: "agente-box", as: "agente-box-openclaw" }]);
  // Mesmo HostName com outro usuário é outra máquina para o ssh: entra.
  const outra = planSshSync(template, "Host x\n    HostName 187.127.41.175\n    User root\n", HOME);
  assert.deepEqual(outra.hostsToAdd.map((b) => b.aliases[0]), ["grokbot-1", "agente-box"]);
});

test("sync: alias removido pelo seletor (marca) não volta", () => {
  const { removeSshHost } = createRequire(import.meta.url)("../../dist/main/maquina/ssh-sync.js");
  const depois = removeSshHost(template, "grokbot-1").text;
  const plan = planSshSync(template, depois, HOME);
  assert.deepEqual(plan.skipped, ["grokbot-1"]);
  assert.deepEqual(plan.hostsToAdd, []);
  assert.equal(renderSshAppend(plan, "x"), "");
  const varios = planSshSync(template, "# meu-bot: não sincronizar grokbot-1 agente-box\n", HOME);
  assert.deepEqual(varios.skipped, ["grokbot-1", "agente-box"]);
});

test("remover o último bloco não leva a marca de quem foi removido antes", () => {
  const { removeSshHost, skippedAliases } = createRequire(import.meta.url)("../../dist/main/maquina/ssh-sync.js");
  const a = removeSshHost(template, "grokbot-1").text; // marca fica no fim, dentro do bloco agente-box
  const b = removeSshHost(a, "agente-box");
  assert.equal(b.removed, "block");
  assert.deepEqual(skippedAliases(b.text).sort(), ["agente-box", "grokbot-1"]);
  assert.ok(!b.text.includes("Host agente-box") && !b.text.includes("Host grokbot-1"));
  assert.deepEqual(planSshSync(template, b.text, HOME).hostsToAdd, []);
});

test("includedTexts: Include aninhado, arquivo ilegível e ciclo", () => {
  const { includedTexts } = createRequire(import.meta.url)("../../dist/main/maquina/ssh-sync.js");
  const arquivos = {
    "/h/.ssh/a.conf": "Include b.conf\nHost a\n    HostName 1.1.1.1\n",
    "/h/.ssh/b.conf": "Include a.conf\nInclude sumiu.conf\nHost b\n    HostName 2.2.2.2\n",
  };
  const expand = (p) => [p.startsWith("/") ? p : `/h/.ssh/${p}`];
  const read = (f) => arquivos[f] ?? null;
  const textos = includedTexts("Include a.conf\n", expand, read);
  assert.deepEqual(textos, [arquivos["/h/.ssh/a.conf"], arquivos["/h/.ssh/b.conf"]], "cada arquivo uma vez, mesmo com ciclo; o ilegível é pulado");
  assert.deepEqual(includedTexts("Host x\n", expand, read), []);
});
