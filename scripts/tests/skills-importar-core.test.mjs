import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Importar skill pelo link (docs/planos/marketplace-skills.md, fase 1): o link, o SKILL.md, e os scripts rodados de
// verdade num HOME temporário, contra um repositório git local.
const c = createRequire(import.meta.url)("../../dist/main/agente/skills-importar-core.js");

test("linkDaSkill: dono/repo, a página do GitHub e as URLs de git; o resto é recusado", () => {
  assert.equal(c.linkDaSkill("fulano/minha-skill"), "https://github.com/fulano/minha-skill.git");
  assert.equal(c.linkDaSkill("  https://github.com/fulano/minha-skill  "), "https://github.com/fulano/minha-skill.git");
  assert.equal(c.linkDaSkill("https://github.com/fulano/minha-skill.git"), "https://github.com/fulano/minha-skill.git");
  assert.equal(c.linkDaSkill("https://github.com/fulano/minha-skill/tree/main/scripts?x=1#y"), "https://github.com/fulano/minha-skill.git");
  assert.equal(c.linkDaSkill("git@github.com:fulano/minha-skill.git"), "git@github.com:fulano/minha-skill.git");
  for (const jeito of ["http://github.com/fulano/minha-skill", "github.com/fulano/minha-skill", "www.github.com/fulano/minha-skill/", "HTTPS://GitHub.com/fulano/minha-skill", "http://www.github.com/fulano/minha-skill.git"]) assert.equal(c.linkDaSkill(jeito), "https://github.com/fulano/minha-skill.git", jeito);
  for (const perfil of ["http://github.com/fulano", "github.com/fulano", "github.com"]) assert.equal(c.linkDaSkill(perfil), null, perfil);
  for (const ruim of ["", "minha skill", "ext::sh -c id", "file:///etc", "/tmp/repo", "--upload-pack=x", "https://github.com/fulano", "fulano/../x", null, 3]) assert.equal(c.linkDaSkill(ruim), null, String(ruim));
});

test("parseSkillMd: exige cabeçalho, nome que sirva de pasta e descrição; recusa nome de skill do app", () => {
  assert.deepEqual(c.parseSkillMd("---\nname: minha-skill\ndescription: \"Faz X quando pedem Y\"\n---\n# corpo\n"), { nome: "minha-skill", descricao: "Faz X quando pedem Y" });
  assert.deepEqual(c.parseSkillMd("---\r\nname: 'a1'\r\ndescription: d\r\n---\r\n"), { nome: "a1", descricao: "d" });
  assert.match(c.parseSkillMd("# sem cabeçalho").erro, /não começa com o cabeçalho/);
  assert.match(c.parseSkillMd("---\nname: x\n").erro, /não fecha/);
  assert.match(c.parseSkillMd("---\ndescription: d\n---\n").erro, /não tem "name:"/);
  assert.match(c.parseSkillMd("---\nname: Minha Skill\ndescription: d\n---\n").erro, /minúsculas, números e hífen/);
  assert.match(c.parseSkillMd("---\nname: ../x\ndescription: d\n---\n").erro, /minúsculas/);
  assert.match(c.parseSkillMd("---\nname: ok-nome\n---\n").erro, /description/);
  for (const n of ["whatsapp-grupos", "objetivo-whatsapp", "cloudflare-token"]) assert.match(c.parseSkillMd(`---\nname: ${n}\ndescription: d\n---\n`).erro, /skill do próprio meu-bot/);
});

test("scripts: pedido inválido nem vira shell", () => {
  assert.throws(() => c.previaSh("ext::sh -c id"));
  const sha = "a".repeat(40);
  assert.throws(() => c.instalarSh("https://github.com/a/b.git", "abc", "nome", "2026-11-22T00:00:00Z"));
  assert.throws(() => c.instalarSh("https://github.com/a/b.git", sha, "../x", "2026-11-22T00:00:00Z"));
  assert.throws(() => c.instalarSh("https://github.com/a/b.git", sha, "nome", "x'; rm -rf ~"));
  assert.throws(() => c.removerSh("a/b"));
});

test("parsePrevia e parseInstalar: as falhas viram frases para a pessoa", () => {
  const u = "https://github.com/a/b.git";
  assert.match(c.parsePrevia("ERRO=sem-git\n", u).erro, /não tem o git/);
  assert.match(c.parsePrevia("GIT_RC=128\nGIT_ERR=remote: Repository not found. fatal: repository 'x' not found\n", u).erro, /não tem acesso.*conecte o GitHub/);
  assert.match(c.parsePrevia("GIT_RC=128\nGIT_ERR=fatal: unable to access: Could not resolve host: github.com\n", u).erro, /não alcançou/);
  assert.match(c.parsePrevia(`COMMIT=${"b".repeat(40)}\nMD=\nLINKS=0\nN=1\nBYTES=10\nFIM=1\n`, u).erro, /não tem um SKILL.md na raiz/);
  assert.match(c.parsePrevia("", u).erro, /não consegui ler/);
  assert.match(c.parseInstalar("ERRO=ocupado:Claude\n").erro, /já existe uma skill com esse nome no Claude.*nada foi alterado/);
  assert.match(c.parseInstalar("ERRO=nome\n").erro, /mudou desde a prévia/);
  assert.deepEqual(c.parseInstalar("DEST=ok:Claude\nDEST=editada:Hermes\nOK=1\n"), { ok: true, destinos: [{ agente: "Claude", editada: false }, { agente: "Hermes", editada: true }], atualizou: false });
  assert.equal(c.parseInstalar("DEST=ok:Claude\nERA=1\nOK=1\n").atualizou, true, "a skill já estava importada: é atualização");
});

const temGit = spawnSync("git", ["--version"]).status === 0;
test("de ponta a ponta num HOME temporário: prévia, instalar, pasta alheia intocada, atualizar mantendo o que o agente editou, remover", { skip: !temGit }, () => {
  const raiz = mkdtempSync(join(tmpdir(), "skills-imp-"));
  const home = join(raiz, "home"); const repo = join(raiz, "repo");
  mkdirSync(home); mkdirSync(join(repo, "scripts"), { recursive: true });
  const env = { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  const git = (...a) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { env, encoding: "utf8" }).trim();
  const sh = (script) => spawnSync("/bin/bash", ["-s"], { input: script, env, encoding: "utf8" }).stdout;
  // O link de teste é um caminho local: os scripts só aceitam URL (repoValido), então o teste troca a URL depois de gerar.
  const URL = "https://github.com/teste/minha-skill.git";
  const local = (script) => script.split(URL).join(repo);
  try {
    writeFileSync(join(repo, "SKILL.md"), "---\nname: minha-skill\ndescription: Faz X\n---\nv1\n");
    writeFileSync(join(repo, "scripts", "rodar.sh"), "#!/bin/sh\necho oi\n", { mode: 0o755 });
    git("init", "-q", "-b", "main"); git("add", "."); git("commit", "-q", "-m", "v1");
    const c1 = git("rev-parse", "HEAD");
    mkdirSync(join(home, ".hermes"));

    const p = c.parsePrevia(sh(local(c.previaSh(URL))), URL);
    assert.equal(p.ok, true, JSON.stringify(p));
    assert.deepEqual([p.previa.nome, p.previa.descricao, p.previa.commit, p.previa.total], ["minha-skill", "Faz X", c1, 2]);
    assert.deepEqual(p.previa.arquivos, ["SKILL.md", "scripts/rodar.sh"]);
    assert.ok(!existsSync(join(home, ".claude", "skills", "minha-skill")), "a prévia não instala");

    const i = c.parseInstalar(sh(local(c.instalarSh(URL, c1, "minha-skill", "2026-11-22T05:00:00.000Z"))));
    assert.equal(i.ok, true, JSON.stringify(i));
    assert.equal(i.atualizou, false, "primeira vez: é importação");
    const claude = join(home, ".claude", "skills", "minha-skill");
    assert.match(readFileSync(join(claude, "SKILL.md"), "utf8"), /v1/);
    assert.ok(existsSync(join(claude, "scripts", "rodar.sh")) && !existsSync(join(claude, ".git")));
    assert.equal(readFileSync(join(claude, ".meu-bot-importada"), "utf8").trim(), c1);
    const origem = JSON.parse(readFileSync(join(home, ".local/share/meu-bot/skills/minha-skill/origem.json"), "utf8"));
    assert.equal(origem.commit, c1); assert.equal(origem.origem, "link");

    // O agente edita a cópia dele; o repositório ganha a v2; atualizar troca os arquivos e mantém o SKILL.md editado.
    writeFileSync(join(claude, "SKILL.md"), "---\nname: minha-skill\ndescription: Faz X\n---\neditada pelo agente\n");
    writeFileSync(join(repo, "SKILL.md"), "---\nname: minha-skill\ndescription: Faz X melhor\n---\nv2\n");
    writeFileSync(join(repo, "novo.txt"), "novo\n"); git("add", "."); git("commit", "-q", "-m", "v2");
    const c2 = git("rev-parse", "HEAD");
    const p2 = c.parsePrevia(sh(local(c.previaSh(URL))), URL);
    assert.equal(p2.previa.commit, c2);
    assert.deepEqual((({ ok, atualizou }) => [ok, atualizou])(c.parseInstalar(sh(local(c.instalarSh(URL, c2, "minha-skill", "2026-11-22T06:00:00.000Z"))))), [true, true], "já estava importada: é atualização");
    assert.match(readFileSync(join(claude, "SKILL.md"), "utf8"), /editada pelo agente/);
    assert.ok(existsSync(join(claude, "novo.txt")));
    const lista = c.parseLista(sh(c.listarSh()).split(repo).join(URL));
    assert.deepEqual(lista.map((s) => [s.nome, s.commit, s.descricao, s.rotulo]), [["minha-skill", c2, "Faz X melhor", "teste/minha-skill"]]);

    // Commit fixado: sem a pasta de prévia, instalar o commit antigo vai buscá-lo.
    assert.equal(c.parseInstalar(sh(local(c.instalarSh(URL, c1, "minha-skill", "2026-11-22T07:00:00.000Z")))).ok, true);
    assert.equal(readFileSync(join(claude, ".meu-bot-importada"), "utf8").trim(), c1);
    assert.ok(!existsSync(join(claude, "novo.txt")));

    // Remover tira só o que o app importou.
    assert.match(sh(c.removerSh("minha-skill")), /OK=1/);
    assert.ok(!existsSync(claude) && !existsSync(join(home, ".local/share/meu-bot/skills/minha-skill")));

    // Pasta com o mesmo nome que não foi importada pelo app: a instalação para e nada muda.
    mkdirSync(claude, { recursive: true }); writeFileSync(join(claude, "SKILL.md"), "do agente\n");
    const oc = c.parseInstalar(sh(local(c.instalarSh(URL, c2, "minha-skill", "2026-11-22T08:00:00.000Z"))));
    assert.equal(oc.ok, false); assert.match(oc.erro, /no Claude/);
    assert.equal(readFileSync(join(claude, "SKILL.md"), "utf8"), "do agente\n");

    // Repositório com symlink é recusado na prévia.
    symlinkSync("/etc/hosts", join(repo, "atalho")); git("add", "."); git("commit", "-q", "-m", "link");
    assert.match(c.parsePrevia(sh(local(c.previaSh(URL))), URL).erro, /symlinks/);
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});
