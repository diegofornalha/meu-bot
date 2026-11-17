import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const F = req("../../dist/main/modulos/modulos-fonte-core.js");

test("fonte dos módulos: URLs aceitas e recusadas (nada que o git leia como opção ou transporte que executa)", () => {
  for (const u of ["https://github.com/diegofornalha/meu-bot-diego.git", "ssh://git@github.com/x/y.git", "git@github.com:x/y.git"]) assert.equal(F.repoValido(u), true, u);
  for (const u of ["-u", "ext::sh -c x", "file:///etc", "/Users/x/repo", "https://github.com/../x", "http://github.com/x/y", "", null]) assert.equal(F.repoValido(u), false, String(u));
  assert.equal(F.repoEfetivo("", "meu-bot-diego"), "https://github.com/diegofornalha/meu-bot-diego.git");
  assert.equal(F.repoEfetivo("ext::sh", "meu-bot-diego"), "https://github.com/diegofornalha/meu-bot-diego.git", "inválida volta à padrão");
  assert.equal(F.mesmoRepo("https://github.com/A/B.git", "https://github.com/a/b/"), true);
  assert.equal(F.rotuloRepo("https://user:senha@github.com/a/b.git"), "a/b", "nunca mostra usuário e senha");
  assert.equal(F.rotuloRepo("git@gitlab.com:a/b.git"), "gitlab.com/a/b");
  assert.deepEqual(F.cloneArgs("https://x/y", "/d").slice(-3), ["--", "https://x/y", "/d"]);
});

test("fonte dos módulos: resultado do git (rede antes de acesso) e estados", () => {
  assert.equal(F.lerResultado({ code: 0, stdout: "", stderr: "" }), "ok");
  assert.equal(F.lerResultado({ code: 1, stdout: "", stderr: "", naoAchou: true }), "sem-git");
  assert.equal(F.lerResultado({ code: null, stdout: "", stderr: "" }), "sem-rede");
  assert.equal(F.lerResultado({ code: 128, stdout: "", stderr: "ssh: Could not resolve hostname github.com\nfatal: Could not read from remote repository." }), "sem-rede");
  assert.equal(F.lerResultado({ code: 128, stdout: "", stderr: "remote: Repository not found." }), "sem-acesso");
  assert.equal(F.lerResultado({ code: 1, stdout: "", stderr: "fatal: refusing" }), "erro");
  assert.equal(F.estadoDepois("ok", "abc1", "abc1"), "em-dia");
  assert.equal(F.estadoDepois("ok", null, "abc1"), "atualizado");
  assert.equal(F.mostraModulos("sem-acesso", true), false);
  assert.equal(F.mostraModulos("sem-rede", true), true);
});

test("fonte dos módulos: a cópia só vale para a URL de onde veio; linha de origem", () => {
  const gravada = F.parseFonteGravada(JSON.stringify({ url: "https://github.com/a/b.git", commit: "abc1234", em: "2026-11-17T10:00:00Z" }));
  const f = F.montarFonte({ url: "https://github.com/a/b", gravada, temManifesto: true, estado: "em-dia", agora: Date.parse("2026-11-17T10:05:00Z") });
  assert.equal(f.baixados, true); assert.equal(f.linha, "Módulos de a/b · commit abc1234 · atualizado há 5 min");
  const outra = F.montarFonte({ url: "https://github.com/a/c", gravada, temManifesto: true, estado: "nunca", agora: Date.now() });
  assert.equal(outra.baixados, false); assert.equal(outra.visiveis, false);
  assert.equal(F.parseFonteGravada("{lixo"), null); assert.equal(F.parseFonteGravada(JSON.stringify({ url: "ext::x", em: "2026" })), null);
});
