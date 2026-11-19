import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, cpSync, readFileSync, writeFileSync, existsSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "backend-colima");

/**
 * Uma máquina de mentira: HOME temporário, cópia do instalador com a pasta crm/ e as skills ao lado (para o teste
 * poder trocar a semente), e PATH só com node e o básico do sistema: sem `openclaw`, o instalador segue o ramo da
 * máquina sem OpenClaw (a do Hermes), que não registra plugin nenhum.
 */
function maquina({ hermes }) {
  const raiz = mkdtempSync(join(tmpdir(), "install-crm-"));
  const home = join(raiz, "home"); const stage = join(raiz, "stage"); const bin = join(raiz, "bin");
  mkdirSync(home); mkdirSync(stage); mkdirSync(bin);
  if (hermes) mkdirSync(join(home, ".hermes"));
  symlinkSync(process.execPath, join(bin, "node"));
  cpSync(join(BACKEND, "crm"), join(stage, "crm"), { recursive: true });
  for (const f of ["install-crm.sh", "skill-crm-api.md", "skill-streak-crm-api.md"]) cpSync(join(BACKEND, f), join(stage, f));
  const instalar = () => {
    const r = spawnSync("bash", [join(stage, "install-crm.sh")], { env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return r.stdout;
  };
  const skill = (agente, nome = "crm-api") => join(home, agente === "Hermes" ? ".hermes" : ".claude", "skills", nome, "SKILL.md");
  return { home, stage, instalar, skill, semente: join(stage, "skill-crm-api.md"), fim: () => rmSync(raiz, { recursive: true, force: true }) };
}

test("install-crm.sh: sem ~/.hermes a skill vai só para o Claude; com ~/.hermes, para os dois", () => {
  const sem = maquina({ hermes: false });
  try {
    const out = sem.instalar();
    assert.match(out, /skill crm-api instalada no Claude/); assert.doesNotMatch(out, /Hermes/);
    assert.equal(readFileSync(sem.skill("Claude"), "utf8"), readFileSync(sem.semente, "utf8"));
    assert.equal(existsSync(join(sem.home, ".hermes")), false, "o instalador não cria ~/.hermes");
  } finally { sem.fim(); }
  const com = maquina({ hermes: true });
  try {
    const out = com.instalar();
    for (const nome of ["crm-api", "streak-crm-api"]) for (const ag of ["Claude", "Hermes"]) {
      assert.match(out, new RegExp(`skill ${nome} instalada no ${ag}`));
      assert.ok(existsSync(com.skill(ag, nome)), `${nome} no ${ag}`);
    }
    assert.equal(readFileSync(com.skill("Hermes"), "utf8"), readFileSync(com.semente, "utf8"));
    assert.match(com.instalar(), /skill crm-api já existe no Hermes \(mantida\)/, "reinstalar igual não muda nada");
  } finally { com.fim(); }
});

test("install-crm.sh: semente nova atualiza a cópia intocada e mantém a que o agente editou", () => {
  const m = maquina({ hermes: true });
  try {
    m.instalar();
    // O agente edita a do Claude; a do Hermes fica como veio. Depois chega uma versão nova da semente.
    appendFileSync(m.skill("Claude"), "\n## Anotação do agente\n");
    const editada = readFileSync(m.skill("Claude"), "utf8");
    appendFileSync(m.semente, "\n## Regra nova\n");
    const nova = readFileSync(m.semente, "utf8");
    const out = m.instalar();
    assert.match(out, /skill crm-api atualizada no Hermes/);
    assert.equal(readFileSync(m.skill("Hermes"), "utf8"), nova);
    assert.match(out, /skill crm-api no Claude foi editada pelo agente \(mantida\); o texto novo está em .*skill-crm-api\.md/);
    assert.equal(readFileSync(m.skill("Claude"), "utf8"), editada);
    assert.equal(readFileSync(join(m.home, ".local/share/meu-bot/crm/skill-crm-api.md"), "utf8"), nova, "a semente fica guardada na máquina");
    // A atualizada continua sendo cópia intocada: a próxima semente também entra.
    appendFileSync(m.semente, "\n## Outra regra\n");
    assert.match(m.instalar(), /skill crm-api atualizada no Hermes/);
    assert.equal(readFileSync(m.skill("Hermes"), "utf8"), readFileSync(m.semente, "utf8"));
  } finally { m.fim(); }
});

test("install-crm.sh: instalação antiga, sem o hash da semente, não é sobrescrita e a saída diz onde está o texto novo", () => {
  const m = maquina({ hermes: false });
  try {
    mkdirSync(dirname(m.skill("Claude")), { recursive: true });
    writeFileSync(m.skill("Claude"), "skill de antes do hash\n");
    const out = m.instalar();
    assert.match(out, /skill crm-api já existe no Claude e não sei se foi editada \(mantida\); o texto novo está em /);
    assert.equal(readFileSync(m.skill("Claude"), "utf8"), "skill de antes do hash\n");
    assert.equal(existsSync(join(dirname(m.skill("Claude")), ".semente.sha256")), false, "sem saber, não grava hash");
  } finally { m.fim(); }
});
