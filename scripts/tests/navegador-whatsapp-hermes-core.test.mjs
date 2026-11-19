import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const req = createRequire(import.meta.url);
const core = req("../../dist/main/navegador/navegador-whatsapp-hermes-core.js");
const nav = req("../../dist/main/navegador/navegador-whatsapp-core.js");
const pausa = req("../../dist/main/whatsapp/whatsapp-hermes-pausa-core.js");
const bundle = req("../../dist/main/maquina/backend-bundle-core.js");
const nw = req("../../backend-colima/navegador-whatsapp.js");
const RAIZ = join(import.meta.dirname, "..", "..");
const PLUGIN = join(RAIZ, "backend-colima", "hermes-plugins", "meu-bot-navegador");

const rodar = (home, script, path = process.env.PATH) => spawnSync("bash", ["-c", `set -e\n${script}`], { env: { ...process.env, HOME: home, PATH: path }, encoding: "utf8" });
const kvDe = (out) => { const kv = new Map(); for (const l of out.split("\n")) { const i = l.indexOf("="); if (i > 0) kv.set(l.slice(0, i), l.slice(i + 1)); } return kv; };
const casa = () => mkdtempSync(join(tmpdir(), "nav-hermes-"));

test("numerosOk: só dígitos, 8 a 15, sem repetição, na ordem; versaoAnterior compara por número", () => {
  assert.deepEqual(core.numerosOk(["+55 (16) 99229-4486", "5516992294486", "123", 5, null, "5521985276123"]), ["5516992294486", "5521985276123"]);
  assert.deepEqual(core.numerosOk("5516992294486"), []);
  assert.equal(core.numerosOk(Array.from({ length: 40 }, (_, i) => `55119${String(10000000 + i)}`)).length, core.NAV_WA_MAX_NUMEROS);
  assert.equal(core.versaoAnterior("1.12.1", "1.13.0"), true);
  assert.equal(core.versaoAnterior("1.13.0", "1.13.0"), false);
  assert.equal(core.versaoAnterior("1.100.0", "1.13.0"), false);
  assert.equal(core.versaoAnterior("2.0.0", "1.13.0"), false);
  assert.equal(core.versaoAnterior("", "1.13.0"), true, "sem VERSION = backend antigo");
});

test("o backend mínimo é o deste pacote: é a primeira versão que entende o passe", () => {
  const v = readFileSync(join(RAIZ, "backend-colima", "VERSION"), "utf8").trim();
  assert.equal(core.versaoAnterior(v, core.BACKEND_MINIMO), false, `VERSION ${v} tem de ser >= ${core.BACKEND_MINIMO}`);
  assert.ok(bundle.BACKEND_RUNTIME_FILES.includes("navegador-whatsapp.js"), "o módulo vai junto do server.js");
});

test("gravar e ler de volta numa máquina de mentira: estado 0600, lido igual pelo app e pelo backend", () => {
  const home = casa();
  const r = rodar(home, core.navHermesGravarSh(true, ["5516992294486", "55 21 98527-6123", "x"]));
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^estado=ok$/m);
  const f = join(home, ".local/share/meu-bot/navegador-whatsapp.json");
  assert.equal(statSync(f).mode & 0o777, 0o600);
  const l = core.lerNavHermes(kvDe(rodar(home, core.NAV_HERMES_LER_SH).stdout));
  assert.deepEqual({ on: l.on, numeros: l.numeros, gravado: l.gravado, plugin: l.plugin, mcpfile: l.mcpfile, backend: l.backend }, { on: true, numeros: ["5516992294486", "5521985276123"], gravado: true, plugin: "", mcpfile: false, backend: "" });
  assert.deepEqual(nw.lerEstado(join(home, ".local/share/meu-bot")), { on: true, numeros: ["5516992294486", "5521985276123"] });
});

test("máquina nunca configurada: desligado, ninguém, `gravado` falso (é o que faz a primeira vez começar pelo dono)", () => {
  const l = core.lerNavHermes(kvDe(rodar(casa(), core.NAV_HERMES_LER_SH).stdout));
  assert.deepEqual([l.on, l.numeros, l.gravado], [false, [], false]);
  assert.deepEqual([core.lerNavHermes(new Map([["estado", "{quebrado"]])).on, core.lerNavHermes(new Map([["estado", "[1]"]])).numeros], [false, []]);
});

test("a leitura vê o servidor do Navegador na versão certa, o plugin instalado e a versão do backend", () => {
  const home = casa();
  const m = join(home, ".local/share/meu-bot"); mkdirSync(join(m, "backend"), { recursive: true }); mkdirSync(join(home, ".hermes/plugins/meu-bot-navegador"), { recursive: true });
  writeFileSync(join(m, "navegador-mcp.mjs"), `// ${nav.NAV_MCP_VERSAO}\n`);
  writeFileSync(join(m, "backend/server.js"), ""); writeFileSync(join(m, "backend/VERSION"), "1.13.0\n");
  writeFileSync(join(home, ".hermes/plugins/meu-bot-navegador/.ok"), "1.0.0");
  const l = core.lerNavHermes(kvDe(rodar(home, core.NAV_HERMES_LER_SH).stdout));
  assert.deepEqual([l.mcpfile, l.plugin, l.backend], [true, "1.0.0", "1.13.0"]);
  writeFileSync(join(m, "navegador-mcp.mjs"), "// meu-bot-navegador v4\n");
  assert.equal(core.lerNavHermes(kvDe(rodar(home, core.NAV_HERMES_LER_SH).stdout)).mcpfile, false, "servidor antigo conta como faltando");
  assert.match(readFileSync(join(RAIZ, "backend-colima", "navegador-mcp.mjs"), "utf8"), new RegExp(nav.NAV_MCP_VERSAO), "o marcador do core é o do arquivo do bundle");
});

test("desligar apaga os passes pendentes; ligar tira do ~/.hermes/AGENTS.md o bloco de conduta do OpenClaw e deixa o resto", () => {
  const home = casa();
  const m = join(home, ".local/share/meu-bot"); mkdirSync(join(m, "navegador-passes"), { recursive: true }); mkdirSync(join(home, ".hermes"));
  writeFileSync(join(m, "navegador-passes", `${"a".repeat(32)}.json`), "{}");
  writeFileSync(join(home, ".hermes/AGENTS.md"), `# Minhas regras\n\n- uma\n\n${nav.NAV_RULE}\n`);
  assert.equal(rodar(home, core.navHermesGravarSh(true, ["5516992294486"])).status, 0);
  assert.equal(readFileSync(join(home, ".hermes/AGENTS.md"), "utf8"), "# Minhas regras\n\n- uma\n");
  assert.equal(existsSync(join(m, "navegador-passes", `${"a".repeat(32)}.json`)), true, "ligado: passes ficam");
  assert.equal(rodar(home, core.navHermesGravarSh(false, ["5516992294486"])).status, 0);
  assert.equal(existsSync(join(m, "navegador-passes", `${"a".repeat(32)}.json`)), false);
  assert.deepEqual(nw.lerEstado(m), { on: false, numeros: ["5516992294486"] }, "desligado guarda a lista para a próxima vez");
});

test("o plugin é componente versionado e instala pelo mesmo instalador do de pausa (máquina de mentira)", () => {
  const init = readFileSync(join(PLUGIN, "__init__.py"), "utf8"), yaml = readFileSync(join(PLUGIN, "plugin.yaml"), "utf8");
  const fonte = { init, yaml, versao: pausa.versaoDoPluginYaml(yaml) };
  assert.ok(init.split("\n").some((l) => l.startsWith(`VERSAO = "${fonte.versao}"`)), "VERSAO do módulo igual à do plugin.yaml");
  const comp = bundle.COMPONENTES.find((c) => c.nome === "hermes-navegador");
  assert.equal(comp.versao, "backend-colima/hermes-plugins/meu-bot-navegador/plugin.yaml");
  for (const a of comp.arquivos) assert.ok(existsSync(join(RAIZ, a)), `${a} existe`);
  assert.throws(() => pausa.hermesPluginSh("outro", fonte), /inválido/);
  assert.throws(() => pausa.hermesPluginSh(core.HERMES_NAV_PLUGIN, { ...fonte, versao: "9.9.9" }), /não bate/);

  const d = casa();
  mkdirSync(join(d, ".hermes")); mkdirSync(join(d, "bin")); mkdirSync(join(d, "rt/venv/bin"), { recursive: true });
  writeFileSync(join(d, "bin/hermes"), `#!/bin/sh\necho "$*" >> "${d}/chamadas"\n[ "$1" = --version ] && echo "Install directory: ${d}/rt"\nexit 0\n`);
  writeFileSync(join(d, "rt/venv/bin/python"), `#!/bin/sh\nfor a; do ultimo=$a; done\nprintf '%s\\n' "$ultimo" >> "${d}/patches"\necho cfgset=ok\necho enabled=sim\n`);
  writeFileSync(join(d, "bin/timeout"), `#!/bin/sh\nshift\nexec "$@"\n`);
  writeFileSync(join(d, "bin/pgrep"), "#!/bin/sh\nexit 1\n"); writeFileSync(join(d, "bin/systemctl"), "#!/bin/sh\nexit 1\n");
  for (const f of ["bin/hermes", "rt/venv/bin/python", "bin/timeout", "bin/pgrep", "bin/systemctl"]) chmodSync(join(d, f), 0o755);
  const r = rodar(d, pausa.hermesPluginSh(core.HERMES_NAV_PLUGIN, fonte), `${join(d, "bin")}:${process.env.PATH}`);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(pausa.lerPausaPlugin(r.stdout), { plugin: "instalado", enabled: "sim", restart: "sem-servico", ok: true });
  assert.equal(readFileSync(join(d, ".hermes/plugins/meu-bot-navegador/__init__.py"), "utf8"), init);
  assert.equal(readFileSync(join(d, ".hermes/plugins/meu-bot-navegador/.ok"), "utf8"), fonte.versao);
  assert.match(readFileSync(join(d, "patches"), "utf8"), /meu-bot-navegador/, "o patch do config.yaml liga este plugin, não o de pausa");
});
