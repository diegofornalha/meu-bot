// O vigia do Grok Bot de ponta a ponta, com um app de mentira, a pasta de estado num temporário e um `gh` falso no
// PATH: primeira impressão, versão nova que abre a issue, issue que já existe (não duplica) e `gh` fora do ar (não
// marca como relatada: a rodada seguinte tenta de novo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const VIGIA = resolve("scripts/grokbot-vigia.mjs");
const temPlistBuddy = existsSync("/usr/libexec/PlistBuddy");

function cenario() {
  const raiz = mkdtempSync(join(tmpdir(), "grokbot-vigia-"));
  const app = join(raiz, "Grok Bot.app"); const estado = join(raiz, "estado"); const bin = join(raiz, "bin");
  mkdirSync(join(app, "Contents", "Resources", "app", "dist", "renderer", "assets"), { recursive: true }); mkdirSync(estado); mkdirSync(bin);
  const instalar = (versao, textos) => {
    writeFileSync(join(app, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${versao}</string></dict></plist>\n`);
    writeFileSync(join(app, "Contents", "Resources", "app", "dist", "renderer", "assets", "index-AbCdEfGh.js"), `x={theme:{label:{id:\`a\`}}};y=[${textos.map((t) => JSON.stringify(t)).join(",")}]`);
  };
  // gh falso: registra a chamada; "issue list" devolve o que estiver em lista.json; GH_FALHA=1 faz tudo sair com erro.
  writeFileSync(join(bin, "gh"), `#!/bin/bash\necho "$*" >> "${raiz}/gh-chamadas"\nif [ -f "${raiz}/gh-falha" ]; then echo "gh: sem rede" >&2; exit 1; fi\ncase "$1 $2" in\n  "issue list") cat "${raiz}/lista.json" 2>/dev/null || echo "[]";;\n  "issue create") echo "https://github.com/diegofornalha/meu-bot/issues/999";;\nesac\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const rodar = (...args) => spawnSync(process.execPath, [VIGIA, ...args], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MEU_BOT_GROKBOT_DIR: estado, MEU_BOT_GROKBOT_APP: app } });
  const chamadas = () => (existsSync(join(raiz, "gh-chamadas")) ? readFileSync(join(raiz, "gh-chamadas"), "utf8") : "");
  return { raiz, estado, instalar, rodar, chamadas };
}

test("vigia: primeira impressão não abre issue; versão nova abre uma, com o rótulo sem-claude, e não repete", { skip: !temPlistBuddy }, () => {
  const c = cenario();
  c.instalar("1.1.0", ["Link your phone to get your Bot's number"]);
  let r = c.rodar("--run");
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /primeira impressão/);
  assert.ok(existsSync(join(c.estado, "impressao-1.1.0.json"))); assert.ok(existsSync(join(c.estado, "relatada-1.1.0.txt")));
  assert.doesNotMatch(c.chamadas(), /issue create/);

  c.instalar("1.2.3", ["Scan to link another phone", "Sign in with SSO"]);
  assert.match(c.rodar("--check").stdout, /decisão: versão nova \(1\.2\.3\)/);
  r = c.rodar("--run");
  assert.equal(r.status, 0, r.stderr);
  assert.match(c.chamadas(), /issue create -R diegofornalha\/meu-bot --title Grok Bot 1\.2\.3: o que mudou desde a 1\.1\.0 --label sem-claude --body-file/);
  assert.match(readFileSync(join(c.estado, "relatada-1.2.3.txt"), "utf8"), /issues\/999/);
  const md = readFileSync(join(c.estado, "relatorio-1.1.0-para-1.2.3.md"), "utf8");
  assert.match(md, /Scan to link another phone/); assert.match(md, /Link your phone to get your Bot's number/);
  // Outra rodada na mesma versão: nada de novo, nenhuma chamada a mais.
  const antes = c.chamadas();
  assert.match(c.rodar("--run").stdout, /já relatada/); assert.equal(c.chamadas(), antes);
  assert.match(c.rodar("--check").stdout, /decisão: nada novo/);
});

test("vigia: issue com o título exato já existe → não cria outra; título parecido de outra versão não conta", { skip: !temPlistBuddy }, () => {
  const c = cenario();
  c.instalar("1.1.0", ["Texting is off"]); c.rodar("--run");
  c.instalar("1.2.3", ["Your Bot only answers texts from these phones"]);
  writeFileSync(join(c.raiz, "lista.json"), JSON.stringify([{ number: 7, title: "Grok Bot 1.2.30: o que mudou desde a 1.1.0" }, { number: 484, title: "Grok Bot 1.2.3: o que mudou desde a 1.1.0" }]));
  const r = c.rodar("--run");
  assert.equal(r.status, 0, r.stderr); assert.doesNotMatch(c.chamadas(), /issue create/);
  assert.match(readFileSync(join(c.estado, "relatada-1.2.3.txt"), "utf8"), /#484 \(já existia\)/);
});

test("vigia: gh fora do ar → sai com erro, não marca como relatada, e a rodada seguinte abre a issue", { skip: !temPlistBuddy }, () => {
  const c = cenario();
  c.instalar("1.1.0", ["Texting is off"]); c.rodar("--run");
  c.instalar("1.2.3", ["This skill changed. Check it and try again."]);
  writeFileSync(join(c.raiz, "gh-falha"), "1");
  let r = c.rodar("--run");
  assert.equal(r.status, 1); assert.match(r.stdout, /não consultei as issues \(gh: sem rede\)/);
  assert.ok(existsSync(join(c.estado, "impressao-1.2.3.json")), "a impressão fica"); assert.ok(!existsSync(join(c.estado, "relatada-1.2.3.txt")), "mas não está relatada");
  assert.doesNotMatch(c.chamadas(), /issue create/, "sem saber se a issue existe, não cria");
  assert.match(c.rodar("--check").stdout, /ainda não foi relatada; --run retoma/);
  spawnSync("rm", [join(c.raiz, "gh-falha")]);
  r = c.rodar("--run");
  assert.equal(r.status, 0, r.stderr); assert.match(c.chamadas(), /issue create/); assert.ok(existsSync(join(c.estado, "relatada-1.2.3.txt")));
});
