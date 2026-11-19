import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, cpSync, readFileSync, writeFileSync, existsSync, rmSync, appendFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// A skill do agente nos dois destinos (Claude Code e Hermes): a biblioteca backend-colima/skills-lib.sh e os seis
// instaladores que a carregam. Nada aqui toca systemd, apt, pip nem rede: crm, finance, navegador e voz (modo off)
// rodam inteiros numa máquina de mentira; a guarda e a tela fazem muito mais do que a skill, então delas roda só a
// linha `skill_semente …` tirada do próprio instalador, e o resto é conferido no texto.
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "backend-colima");
const bundle = createRequire(import.meta.url)("../../dist/main/maquina/backend-bundle-core.js");
const { SKILLS_LIB, CRM_FILES, FINANCE_FILES, GUARDA_FILES, TELA_FILES, NAVEGADOR_FILES, VOZ_FILES } = bundle;
const LIB = join(BACKEND, SKILLS_LIB);

/**
 * Uma máquina de mentira: HOME temporário, pasta de stage (o que o app mandaria por scp) e PATH só com node e o básico
 * do sistema. Sem `openclaw` no PATH os instaladores seguem o ramo da máquina sem OpenClaw (a do Hermes); `openclaw: true`
 * põe um de mentira que não faz nada (o install-voz.sh sai com 2 sem ele).
 */
function maquina({ hermes = false, openclaw = false } = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "skills-lib-"));
  const home = join(raiz, "home"); const stage = join(raiz, "stage"); const bin = join(raiz, "bin");
  mkdirSync(home); mkdirSync(stage); mkdirSync(bin);
  if (hermes) mkdirSync(join(home, ".hermes"));
  symlinkSync(process.execPath, join(bin, "node"));
  if (openclaw) writeFileSync(join(bin, "openclaw"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };
  const bash = (args) => spawnSync("bash", args, { env, encoding: "utf8" });
  const skill = (agente, nome) => join(home, agente === "Hermes" ? ".hermes" : ".claude", "skills", nome, "SKILL.md");
  const marca = (agente, nome) => join(dirname(skill(agente, nome)), ".semente.sha256");
  const copiar = (...arquivos) => { for (const f of arquivos) { mkdirSync(dirname(join(stage, f)), { recursive: true }); cpSync(join(BACKEND, f), join(stage, f), { recursive: true }); } };
  return { raiz, home, stage, bash, skill, marca, copiar, fim: () => rmSync(raiz, { recursive: true, force: true }) };
}
/** Chama a biblioteca direto: `skill_semente <args>` com o `set -euo pipefail` dos instaladores. */
const lib = (m, ...args) => m.bash(["-c", `set -euo pipefail; . "$0"; skill_semente "$@"`, LIB, ...args]);
const ok = (r) => { assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };

// ---------- a biblioteca ----------

test("skills-lib: sem ~/.hermes a skill vai só para o Claude (e ~/.hermes não é criada); com ~/.hermes, para os dois", () => {
  const sem = maquina();
  try {
    const semente = join(sem.raiz, "s.md"); writeFileSync(semente, "semente v1\n");
    const out = ok(lib(sem, "minha-skill", semente));
    assert.match(out, /skill minha-skill instalada no Claude/); assert.doesNotMatch(out, /Hermes/);
    assert.equal(readFileSync(sem.skill("Claude", "minha-skill"), "utf8"), "semente v1\n");
    assert.equal(existsSync(join(sem.home, ".hermes")), false);
    assert.equal(readFileSync(join(sem.home, ".local/share/meu-bot/skills-semente/minha-skill.md"), "utf8"), "semente v1\n", "a semente fica guardada num caminho estável");
  } finally { sem.fim(); }
  const com = maquina({ hermes: true });
  try {
    const semente = join(com.raiz, "s.md"); writeFileSync(semente, "semente v1\n");
    const out = ok(lib(com, "minha-skill", semente));
    for (const ag of ["Claude", "Hermes"]) {
      assert.match(out, new RegExp(`skill minha-skill instalada no ${ag}`));
      assert.equal(readFileSync(com.skill(ag, "minha-skill"), "utf8"), "semente v1\n");
      assert.match(readFileSync(com.marca(ag, "minha-skill"), "utf8"), /^[0-9a-f]{64}\n$/);
    }
    assert.match(ok(lib(com, "minha-skill", semente)), /skill minha-skill já existe no Hermes \(mantida\)/, "reinstalar igual não muda nada");
  } finally { com.fim(); }
});

test("skills-lib: semente nova atualiza a cópia intocada e mantém a editada, dizendo onde está o texto novo", () => {
  const m = maquina({ hermes: true });
  try {
    const semente = join(m.raiz, "s.md"); writeFileSync(semente, "semente v1\n");
    const guardada = join(m.home, "um lugar com espaço", "guardada.md");
    ok(lib(m, "minha-skill", semente, guardada));
    appendFileSync(m.skill("Claude", "minha-skill"), "anotação do agente\n");
    writeFileSync(semente, "semente v2\n");
    const out = ok(lib(m, "minha-skill", semente, guardada));
    assert.match(out, /skill minha-skill atualizada no Hermes/);
    assert.equal(readFileSync(m.skill("Hermes", "minha-skill"), "utf8"), "semente v2\n");
    assert.ok(out.includes(`skill minha-skill no Claude foi editada pelo agente (mantida); o texto novo está em ${guardada}`), out);
    assert.equal(readFileSync(m.skill("Claude", "minha-skill"), "utf8"), "semente v1\nanotação do agente\n");
    assert.equal(readFileSync(guardada, "utf8"), "semente v2\n");
    // A atualizada continua sendo cópia intocada: a próxima semente também entra; a editada continua editada.
    writeFileSync(semente, "semente v3\n");
    const out3 = ok(lib(m, "minha-skill", semente, guardada));
    assert.match(out3, /atualizada no Hermes/); assert.match(out3, /no Claude foi editada pelo agente/);
    // O Hermes chega depois numa máquina que só tinha o Claude: a skill entra nele na instalação seguinte.
    rmSync(join(m.home, ".hermes"), { recursive: true }); mkdirSync(join(m.home, ".hermes"));
    assert.match(ok(lib(m, "minha-skill", semente, guardada)), /skill minha-skill instalada no Hermes/);
  } finally { m.fim(); }
});

test("skills-lib: cópia de antes do hash: mantida por padrão; atualizada quando o instalador diz que era dele (\"*\" ou marcador)", () => {
  const m = maquina();
  try {
    const semente = join(m.raiz, "s.md"); writeFileSync(semente, "<!-- marcador v2 -->\nsemente nova\n");
    const antiga = (nome, texto) => { mkdirSync(dirname(m.skill("Claude", nome)), { recursive: true }); writeFileSync(m.skill("Claude", nome), texto); };
    antiga("a", "skill de antes do hash\n");
    const out = ok(lib(m, "a", semente));
    assert.match(out, /skill a já existe no Claude e não sei se foi editada \(mantida\); o texto novo está em .*skills-semente\/a\.md/);
    assert.equal(readFileSync(m.skill("Claude", "a"), "utf8"), "skill de antes do hash\n");
    assert.equal(existsSync(m.marca("Claude", "a")), false, "sem saber, não grava hash");
    antiga("b", "skill de antes do hash\n");
    assert.match(ok(lib(m, "b", semente, "", "*")), /skill b atualizada no Claude/);
    assert.equal(readFileSync(m.skill("Claude", "b"), "utf8"), readFileSync(semente, "utf8"));
    antiga("c", "<!-- marcador v1 -->\ntexto antigo do app\n");
    assert.match(ok(lib(m, "c", semente, "", "marcador v")), /skill c atualizada no Claude/);
    antiga("d", "o dono apagou o marcador\n");
    assert.match(ok(lib(m, "d", semente, "", "marcador v")), /skill d já existe no Claude e não sei se foi editada \(mantida\)/);
    assert.equal(readFileSync(m.skill("Claude", "d"), "utf8"), "o dono apagou o marcador\n");
    // Depois do hash, quem manda é ele: a cópia editada fica mesmo com "*" ou com o marcador ainda no texto.
    appendFileSync(m.skill("Claude", "b"), "anotação\n"); appendFileSync(m.skill("Claude", "c"), "anotação\n");
    appendFileSync(semente, "mais uma regra\n");
    assert.match(ok(lib(m, "b", semente, "", "*")), /skill b no Claude foi editada pelo agente \(mantida\)/);
    assert.match(ok(lib(m, "c", semente, "", "marcador v")), /skill c no Claude foi editada pelo agente \(mantida\)/);
  } finally { m.fim(); }
});

test("skills-lib: semente que não existe sai com 1 e não cria nada", () => {
  const m = maquina({ hermes: true });
  try {
    const r = lib(m, "x", join(m.raiz, "nao-existe.md"));
    assert.equal(r.status, 1); assert.match(r.stdout, /a semente da skill x não está em /);
    assert.equal(existsSync(join(m.home, ".claude")), false); assert.deepEqual(readdirSync(join(m.home, ".hermes")), []);
  } finally { m.fim(); }
});

// ---------- os seis instaladores ----------

/**
 * Como exercitar a skill de cada instalador. `preparar` monta o stage; `rodar` instala (o instalador inteiro, ou só a
 * linha skill_semente dele quando o resto mexe no sistema); `semente` é o arquivo do stage que o teste altera para
 * simular uma versão nova; `guardada` é onde a semente fica na máquina; `legado` diz o que a cópia sem hash vira.
 */
const linhaDaSkill = (script, nome) => {
  const l = readFileSync(join(BACKEND, script), "utf8").split("\n").map((x) => x.trim()).filter((x) => x.startsWith(`skill_semente ${nome} `));
  assert.equal(l.length, 1, `${script} chama skill_semente ${nome} uma vez`);
  return l[0];
};
const soALinha = (script, nome) => (m) => m.bash(["-c", `set -euo pipefail; HERE="$1"; . "$0"; ${linhaDaSkill(script, nome)}`, LIB, m.stage]);
const INSTALADORES = [
  { script: "install-crm.sh", lista: CRM_FILES, skills: { "crm-api": "skill-crm-api.md", "streak-crm-api": "skill-streak-crm-api.md" }, legado: "mantida",
    preparar: (m) => m.copiar("crm", ...CRM_FILES), rodar: (m) => m.bash([join(m.stage, "install-crm.sh")]), guardada: ".local/share/meu-bot/crm/skill-crm-api.md" },
  { script: "install-finance.sh", lista: FINANCE_FILES, skills: { "finance-api": "skill-finance-api.md" }, legado: "marcador",
    preparar: (m) => m.copiar("finance", ...FINANCE_FILES), rodar: (m) => m.bash([join(m.stage, "install-finance.sh")]), guardada: ".local/share/meu-bot/skills-semente/finance-api.md" },
  { script: "install-navegador-mcp.sh", lista: NAVEGADOR_FILES, legado: "mantida",
    skills: Object.fromEntries(NAVEGADOR_FILES.filter((f) => /^skill-.*\.md$/.test(f)).map((f) => [f.replace(/^skill-|\.md$/g, ""), f])),
    preparar: (m) => m.copiar(...NAVEGADOR_FILES), rodar: (m) => m.bash([join(m.stage, "install-navegador-mcp.sh")]), guardada: ".local/share/meu-bot/skills-semente/streak-crm-navegador.md" },
  { script: "install-guarda.sh", lista: GUARDA_FILES, skills: { "whatsapp-grupos": "skills/whatsapp-grupos/SKILL.md" }, legado: "atualizada", soLinha: true,
    preparar: (m) => m.copiar("skills/whatsapp-grupos/SKILL.md"), rodar: soALinha("install-guarda.sh", "whatsapp-grupos"), guardada: ".local/share/meu-bot/skills-semente/whatsapp-grupos.md" },
  { script: "install-tela.sh", lista: TELA_FILES, skills: { "computador-do-bot": "tela/skill/SKILL.md" }, legado: "atualizada", soLinha: true,
    preparar: (m) => m.copiar("tela/skill/SKILL.md"), rodar: soALinha("install-tela.sh", "computador-do-bot"), guardada: ".local/share/meu-bot/skills-semente/computador-do-bot.md" },
  // A semente da voz vai dentro do script (heredoc): a "versão nova" é o script com uma linha a mais na skill.
  { script: "install-voz.sh", lista: VOZ_FILES, skills: { "voz-das-respostas": null }, legado: "atualizada", openclaw: true,
    preparar: (m) => m.copiar(...VOZ_FILES), rodar: (m) => m.bash([join(m.stage, "install-voz.sh"), "off"]), guardada: ".local/share/meu-bot/voz/skill-voz-das-respostas.md",
    mudar: (m) => { const f = join(m.stage, "install-voz.sh"); const s = readFileSync(f, "utf8"); const alvo = "- Só o dono pede isto."; assert.ok(s.includes(alvo)); writeFileSync(f, s.replace(alvo, `- Regra nova.\n${alvo}`)); } },
];

for (const inst of INSTALADORES) {
  const nomes = Object.keys(inst.skills); const nome = nomes[0]; const arquivo = inst.skills[nome];
  const nova = (opts) => { const m = maquina({ ...opts, openclaw: inst.openclaw === true }); inst.preparar(m); return m; };
  const mudar = (m) => (inst.mudar ? inst.mudar(m) : appendFileSync(join(m.stage, arquivo), "\n## Regra nova\n"));
  const guardada = (m) => readFileSync(join(m.home, inst.guardada), "utf8");
  const como = inst.soLinha ? " (só a linha skill_semente do instalador)" : "";

  test(`${inst.script}: carrega a skills-lib.sh, chama skill_semente com a skill e a semente do repo, e a lista de envio leva a biblioteca`, () => {
    const sh = readFileSync(join(BACKEND, inst.script), "utf8");
    assert.ok(sh.includes('[ -f "$HERE/skills-lib.sh" ] || {') && sh.includes('\n. "$HERE/skills-lib.sh"\n'), "carrega a biblioteca de ao lado dele, com a recusa clara");
    assert.match(sh, /HERE=\$\(cd "\$\(dirname "\$0"\)" && pwd\)/);
    assert.ok(inst.lista.includes(SKILLS_LIB), "a lista que o app envia leva a biblioteca");
    assert.ok(inst.lista.includes(inst.script));
    assert.doesNotMatch(sh, /\.semente\.sha256|sha256sum/, "a lógica da semente mora só na biblioteca");
    assert.doesNotMatch(sh, /(cp|cat >)[^\n]*skills\/[^\n]*SKILL\.md/, "nenhuma cópia direta de SKILL.md para uma pasta de skills");
    for (const [n, f] of Object.entries(inst.skills)) {
      if (f !== null) assert.ok(existsSync(join(BACKEND, f)), `${f} existe no repo`);
      if (inst.script === "install-crm.sh") assert.ok(sh.includes(`"${f}:${n}"`) && sh.includes('skill_semente "$nome" "$src" "$SRC/${par%%:*}"'));
      else if (inst.script === "install-navegador-mcp.sh") assert.ok(sh.includes('for SEED in "$HERE"/skill-*.md') && sh.includes('skill_semente "$NAME" "$SEED"'));
      else if (f === null) assert.ok(sh.includes(`skill_semente ${n} "$SEMENTE" "$SEMENTE" "*"`) && sh.includes(`\nname: ${n}\n`));
      else assert.ok(sh.includes(`skill_semente ${n} "$HERE/${f}" `), `chama skill_semente ${n} com $HERE/${f}`);
    }
  });

  test(`${inst.script}${como}: sem ~/.hermes a skill vai só para o Claude; com ~/.hermes, para os dois`, () => {
    const sem = nova({ hermes: false });
    try {
      const out = ok(inst.rodar(sem));
      for (const n of nomes) assert.match(out, new RegExp(`skill ${n} instalada no Claude`));
      assert.doesNotMatch(out, /Hermes/);
      assert.equal(readFileSync(sem.skill("Claude", nome), "utf8"), guardada(sem));
      assert.equal(existsSync(join(sem.home, ".hermes")), false, "o instalador não cria ~/.hermes");
    } finally { sem.fim(); }
    const com = nova({ hermes: true });
    try {
      const out = ok(inst.rodar(com));
      for (const n of nomes) for (const ag of ["Claude", "Hermes"]) {
        assert.match(out, new RegExp(`skill ${n} instalada no ${ag}`));
        assert.ok(existsSync(com.skill(ag, n)), `${n} no ${ag}`);
      }
      assert.equal(readFileSync(com.skill("Hermes", nome), "utf8"), guardada(com));
      if (arquivo !== null) assert.equal(guardada(com), readFileSync(join(BACKEND, arquivo), "utf8"), "é a semente do repo");
      assert.match(ok(inst.rodar(com)), new RegExp(`skill ${nome} já existe no Hermes \\(mantida\\)`), "reinstalar igual não muda nada");
    } finally { com.fim(); }
  });

  test(`${inst.script}${como}: semente nova atualiza a cópia intocada e mantém a que o agente editou`, () => {
    const m = nova({ hermes: true });
    try {
      ok(inst.rodar(m));
      // O agente edita a do Claude; a do Hermes fica como veio. Depois chega uma versão nova da semente.
      appendFileSync(m.skill("Claude", nome), "\n## Anotação do agente\n");
      const editada = readFileSync(m.skill("Claude", nome), "utf8"); const antes = guardada(m);
      mudar(m);
      const out = ok(inst.rodar(m));
      assert.notEqual(guardada(m), antes, "a semente guardada na máquina é a nova");
      assert.match(out, new RegExp(`skill ${nome} atualizada no Hermes`));
      assert.equal(readFileSync(m.skill("Hermes", nome), "utf8"), guardada(m));
      assert.ok(out.includes(`skill ${nome} no Claude foi editada pelo agente (mantida); o texto novo está em ${join(m.home, inst.guardada)}`), out);
      assert.equal(readFileSync(m.skill("Claude", nome), "utf8"), editada);
    } finally { m.fim(); }
  });

  test(`${inst.script}${como}: cópia instalada antes do hash da semente (${inst.legado})`, () => {
    const m = nova({ hermes: false });
    try {
      mkdirSync(dirname(m.skill("Claude", nome)), { recursive: true });
      const antiga = inst.legado === "marcador" ? "<!-- meu-bot-finance skill v4 (texto antigo) -->\nskill antiga\n" : "skill de antes do hash\n";
      writeFileSync(m.skill("Claude", nome), antiga);
      const out = ok(inst.rodar(m));
      if (inst.legado === "mantida") {
        assert.match(out, new RegExp(`skill ${nome} já existe no Claude e não sei se foi editada \\(mantida\\); o texto novo está em `));
        assert.equal(readFileSync(m.skill("Claude", nome), "utf8"), antiga);
        assert.equal(existsSync(m.marca("Claude", nome)), false, "sem saber, não grava hash");
      } else {
        // Estes instaladores sempre regravaram a skill (a do financeiro, enquanto tivesse o marcador): a cópia antiga é do app.
        assert.match(out, new RegExp(`skill ${nome} atualizada no Claude`));
        assert.equal(readFileSync(m.skill("Claude", nome), "utf8"), guardada(m));
      }
      if (inst.legado === "marcador") {
        // Sem o marcador (o dono o apagou para manter a versão dele, como a skill antiga ensinava): fica.
        rmSync(dirname(m.skill("Claude", nome)), { recursive: true }); mkdirSync(dirname(m.skill("Claude", nome)));
        writeFileSync(m.skill("Claude", nome), "a minha versão\n");
        assert.match(ok(inst.rodar(m)), new RegExp(`skill ${nome} já existe no Claude e não sei se foi editada \\(mantida\\)`));
        assert.equal(readFileSync(m.skill("Claude", nome), "utf8"), "a minha versão\n");
      }
    } finally { m.fim(); }
  });

  test(`${inst.script}: sem a skills-lib.sh ao lado (app antigo ou envio incompleto) sai com 1, diz o porquê e não altera a máquina`, () => {
    // openclaw de mentira para todos: a guarda e a voz saem com 2 sem ele, antes de chegar à biblioteca.
    const m = maquina({ hermes: true, openclaw: true });
    try {
      m.copiar(inst.script, ...{ "install-crm.sh": ["crm"], "install-finance.sh": ["finance"], "install-navegador-mcp.sh": ["navegador-mcp.mjs"], "install-guarda.sh": ["guarda"], "install-tela.sh": ["tela"], "install-voz.sh": [] }[inst.script]);
      const r = m.bash([join(m.stage, inst.script), ...(inst.script === "install-voz.sh" ? ["off"] : [])]);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout, /skills-lib\.sh não está ao lado deste script.*nada foi alterado nesta máquina/);
      assert.deepEqual(readdirSync(m.home), [".hermes"], "nada foi criado no HOME");
      assert.deepEqual(readdirSync(join(m.home, ".hermes")), []);
    } finally { m.fim(); }
  });
}

test("instaladores: nenhum install-*.sh instala skill fora da biblioteca, e todo o que a usa está numa lista de envio com ela", () => {
  const usam = readdirSync(BACKEND).filter((f) => /^install-.*\.sh$/.test(f) && readFileSync(join(BACKEND, f), "utf8").includes("skill_semente"));
  assert.deepEqual(usam.sort(), INSTALADORES.map((i) => i.script).sort());
  for (const f of readdirSync(BACKEND).filter((x) => /^install-.*\.sh$/.test(x) && !usam.includes(x))) {
    assert.doesNotMatch(readFileSync(join(BACKEND, f), "utf8"), /\/skills\/[^\n]*SKILL\.md/, `${f} mexe em SKILL.md sem a biblioteca`);
  }
  // Toda lista exportada que leva um instalador com skill leva a biblioteca (é o que o hostProbe.ts manda por scp).
  for (const [k, v] of Object.entries(bundle)) {
    if (!/_FILES$/.test(k) || !Array.isArray(v) || !v.some((f) => usam.includes(f))) continue;
    assert.ok(v.includes(SKILLS_LIB), `${k} leva um instalador de skill sem a ${SKILLS_LIB}`);
  }
  // O hostProbe.ts não manda nenhum desses instaladores solto: só pelas listas.
  const probe = readFileSync(join(BACKEND, "..", "src", "main", "maquina", "hostProbe.ts"), "utf8");
  for (const s of usam) assert.doesNotMatch(probe, new RegExp(`backendBundleDir\\(\\), "${s.replace(/\./g, "\\.")}"\\)`), `${s} é enviado sem a biblioteca`);
  for (const l of ["CRM_FILES", "FINANCE_FILES", "GUARDA_FILES", "TELA_FILES", "NAVEGADOR_FILES", "VOZ_FILES"]) assert.match(probe, new RegExp(`\\b${l}\\b[^\\n]*\\.map\\(`), `o hostProbe.ts envia a ${l}`);
});

test("install-voz.sh: a cópia que fica na máquina para o agente chamar leva a biblioteca ao lado", () => {
  const m = maquina({ openclaw: true });
  try {
    m.copiar(...VOZ_FILES);
    ok(m.bash([join(m.stage, "install-voz.sh"), "off"]));
    const d = join(m.home, ".local/share/meu-bot/voz");
    assert.equal(readFileSync(join(d, "skills-lib.sh"), "utf8"), readFileSync(LIB, "utf8"));
    // É essa cópia que a skill voz-das-respostas manda o agente rodar.
    if (existsSync(join(d, "install-voz.sh"))) assert.match(ok(m.bash([join(d, "install-voz.sh"), "off"])), /skill voz-das-respostas já existe no Claude \(mantida\)/);
  } finally { m.fim(); }
});

test("uninstall-guarda.sh: não remove a skill (pode ter sido editada; data/ é o cache da conta) e limpa a semente guardada", () => {
  const sh = readFileSync(join(BACKEND, "uninstall-guarda.sh"), "utf8");
  assert.doesNotMatch(sh, /rm[^\n]*\/skills\/whatsapp-grupos/);
  assert.match(sh, /rm -f "\$HOME\/\.local\/share\/meu-bot\/skills-semente\/whatsapp-grupos\.md"/);
  // O uninstall-crm.sh já apaga a semente guardada (skill-*.md em crm/) e também não remove a skill dos agentes.
  const crm = readFileSync(join(BACKEND, "uninstall-crm.sh"), "utf8");
  assert.match(crm, /-name 'skill-\*\.md'/); assert.doesNotMatch(crm, /\.claude\/skills|\.hermes\/skills/);
});
