#!/usr/bin/env node
// Vigia do Grok Bot: a cada versão nova do Grok Bot instalada neste Mac, guarda a "impressão" dela (nomes de arquivos,
// textos de tela e opções das Configurações), compara com a da versão anterior e abre uma issue com o que mudou, para a
// melhoria ser avaliada e trazida ao meu-bot. Também diz o número que a próxima estável do meu-bot deve levar.
//   node scripts/grokbot-vigia.mjs --check         versão instalada, impressões guardadas, se há versão nova
//   node scripts/grokbot-vigia.mjs --run           tira a impressão da versão instalada; se é nova, relata e abre a issue
//   node scripts/grokbot-vigia.mjs --impressao <app.asar|pasta extraída> <versão>   guarda a impressão de um pacote à mão
//   node scripts/grokbot-vigia.mjs --relatorio <de> <para>   escreve o relatório entre duas impressões guardadas
//   node scripts/grokbot-vigia.mjs --instalar | --desinstalar   agente do launchd (a cada hora)
// Estado em ~/Library/Application Support/meu-bot-grokbot/ (MEU_BOT_GROKBOT_DIR para testar). O pacote extraído é
// apagado depois da impressão: só ficam as listas.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compararVersao, lerVersao, mudou, opcoesDe, proximaEstavel, relatorio, textosDe } from "./grokbot-core.mjs";

const AQUI = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ESTADO = process.env.MEU_BOT_GROKBOT_DIR ?? join(homedir(), "Library", "Application Support", "meu-bot-grokbot");
const APP = process.env.MEU_BOT_GROKBOT_APP ?? "/Applications/Grok Bot.app";
const LOG = join(homedir(), "Library", "Logs", "meu-bot-grokbot.log");
const ROTULO = "com.meu-bot.grokbot-vigia";
const PLIST = join(homedir(), "Library", "LaunchAgents", `${ROTULO}.plist`);
const REPO = "diegofornalha/meu-bot";
mkdirSync(ESTADO, { recursive: true });
const log = (s) => { try { mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`); } catch { /* sem log */ } console.log(s); };
const shOu = (cmd, args, cwd = AQUI) => { try { return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { return null; } };

const versaoInstalada = () => { const v = shOu("/usr/libexec/PlistBuddy", ["-c", "Print CFBundleShortVersionString", join(APP, "Contents", "Info.plist")]); return lerVersao(v) === null ? null : v; };
const arquivoDe = (v) => join(ESTADO, `impressao-${v}.json`);
const guardadas = () => readdirSync(ESTADO).map((f) => /^impressao-(\d+\.\d+\.\d+)\.json$/.exec(f)?.[1]).filter(Boolean).sort(compararVersao);
const ler = (v) => JSON.parse(readFileSync(arquivoDe(v), "utf8"));

function arvore(dir) {
  const out = [];
  const anda = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) anda(p); else out.push(relative(dir, p)); } };
  anda(dir); return out.sort();
}
/** A impressão de uma pasta extraída do app.asar. */
function impressaoDaPasta(dir, versao) {
  const arquivos = arvore(dir);
  const textos = new Set(); let opcoes = [];
  for (const a of arquivos) {
    if (!/^dist\/renderer\/assets\/.*\.js$/.test(a)) continue;
    const js = readFileSync(join(dir, a), "utf8");
    for (const t of textosDe(js)) textos.add(t);
    const o = opcoesDe(js); if (o.length > opcoes.length) opcoes = o;
  }
  return { versao, tiradaEm: new Date().toISOString(), arquivos, textos: [...textos].sort(), opcoes };
}
function impressaoDoPacote(origem, versao) {
  if (statSync(origem).isDirectory()) return impressaoDaPasta(origem, versao);
  const tmp = mkdtempSync(join(tmpdir(), "grokbot-"));
  try {
    const asar = join(AQUI, "node_modules", "@electron", "asar", "bin", "asar.mjs");
    const r = spawnSync(process.execPath, [existsSync(asar) ? asar : join(AQUI, "node_modules", "@electron", "asar", "bin", "asar.js"), "extract", origem, tmp], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`não extraí ${origem}: ${(r.stderr || "").trim().split("\n").pop()}`);
    return impressaoDaPasta(tmp, versao);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const ultimaEstavelNossa = () => {
  const tags = (shOu("git", ["tag", "-l", "v*"]) ?? "").split("\n").map((t) => t.replace(/^v/, "")).filter((t) => lerVersao(t) !== null).sort(compararVersao);
  return tags.at(-1) ?? null;
};
function escreverRelatorio(de, para) {
  const nossa = ultimaEstavelNossa();
  const md = relatorio(ler(de), ler(para), { nossa, proxima: proximaEstavel(para, nossa) });
  const arq = join(ESTADO, `relatorio-${de}-para-${para}.md`);
  writeFileSync(arq, md); return { arq, md };
}

function check() {
  const v = versaoInstalada(), g = guardadas(), nossa = ultimaEstavelNossa();
  console.log(`Grok Bot instalado: ${v ?? "não achei em " + APP}`);
  console.log(`impressões guardadas: ${g.join(", ") || "nenhuma"}`);
  console.log(`meu-bot, última estável: ${nossa ?? "?"} · próxima pela regra: ${proximaEstavel(v, nossa) ?? "?"}`);
  console.log(v === null ? "decisão: nada a fazer" : g.includes(v) ? "decisão: nada novo" : `decisão: versão nova (${v}); --run tira a impressão e relata`);
}
function run() {
  const v = versaoInstalada();
  if (v === null) { log(`Grok Bot não está em ${APP}; nada a fazer`); return; }
  const antes = guardadas();
  if (antes.includes(v)) { log(`Grok Bot ${v}: impressão já guardada`); return; }
  writeFileSync(arquivoDe(v), `${JSON.stringify(impressaoDoPacote(join(APP, "Contents", "Resources", "app.asar"), v))}\n`);
  log(`Grok Bot ${v}: impressão guardada`);
  const anterior = antes.filter((x) => compararVersao(x, v) < 0).at(-1);
  if (anterior === undefined) { log("primeira impressão: sem versão anterior para comparar"); return; }
  if (!mudou(ler(anterior), ler(v))) { log(`Grok Bot ${v}: nada mudou no que a impressão vê desde a ${anterior}`); return; }
  const { arq, md } = escreverRelatorio(anterior, v);
  log(`relatório em ${arq}`);
  // Rótulo sem-claude: a issue é pauta para triagem; cada melhoria escolhida vira issue própria (essa, sim, implementada sozinha).
  const titulo = `Grok Bot ${v}: o que mudou desde a ${anterior}`;
  const ja = shOu("gh", ["issue", "list", "-R", REPO, "--state", "all", "--search", `"${titulo}" in:title`, "--json", "number", "-q", ".[0].number"]);
  if (ja) { log(`issue #${ja} já existe para a ${v}`); return; }
  const corpo = join(ESTADO, `issue-${v}.md`); writeFileSync(corpo, md.length > 60000 ? `${md.slice(0, 60000)}\n\n(cortado; o relatório inteiro está no Mac da release)\n` : md);
  const url = shOu("gh", ["issue", "create", "-R", REPO, "--title", titulo, "--label", "sem-claude", "--body-file", corpo]);
  log(url ? `issue aberta: ${url}` : "não consegui abrir a issue (gh); o relatório ficou no disco");
  try { execFileSync("osascript", ["-e", `display notification ${JSON.stringify(`Grok Bot ${v}: relatório do que mudou pronto`)} with title "meu-bot · Grok Bot"`], { stdio: "ignore" }); } catch { /* sem GUI */ }
}
function instalar() {
  const uid = process.getuid();
  const path = ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local", "bin"), dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
  const x = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  mkdirSync(dirname(PLIST), { recursive: true });
  writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${ROTULO}</string>
  <key>ProgramArguments</key><array><string>${x(process.execPath)}</string><string>${x(join(AQUI, "scripts", "grokbot-vigia.mjs"))}</string><string>--run</string></array>
  <key>WorkingDirectory</key><string>${x(AQUI)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${x(path)}</string></dict>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${x(LOG)}</string><key>StandardErrorPath</key><string>${x(LOG)}</string>
</dict></plist>
`);
  spawnSync("launchctl", ["bootout", `gui/${uid}/${ROTULO}`], { stdio: "ignore" });
  let ok = false; for (let i = 0; i < 10 && !ok; i++) { if (i > 0) spawnSync("sleep", ["1"]); ok = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, PLIST]).status === 0; }
  console.log(ok ? `✓ agente ${ROTULO} instalado (a cada hora; log em ${LOG})` : `✗ o launchd não carregou ${PLIST}`); if (!ok) process.exit(1);
}

const [modo, a1, a2] = process.argv.slice(2);
if (modo === "--check") check();
else if (modo === "--run") run();
else if (modo === "--impressao" && a1 && lerVersao(a2) !== null) { writeFileSync(arquivoDe(a2), `${JSON.stringify(impressaoDoPacote(resolve(a1), a2))}\n`); console.log(`✓ impressão da ${a2} guardada em ${arquivoDe(a2)}`); }
else if (modo === "--relatorio" && existsSync(arquivoDe(a1 ?? "")) && existsSync(arquivoDe(a2 ?? ""))) { const r = escreverRelatorio(a1, a2); console.log(r.md); console.error(`\n(gravado em ${r.arq})`); }
else if (modo === "--instalar") instalar();
else if (modo === "--desinstalar") { spawnSync("launchctl", ["bootout", `gui/${process.getuid()}/${ROTULO}`], { stdio: "ignore" }); rmSync(PLIST, { force: true }); console.log(`✓ agente ${ROTULO} removido`); }
else { console.error("uso: node scripts/grokbot-vigia.mjs --check | --run | --impressao <app.asar|pasta> <versão> | --relatorio <de> <para> | --instalar | --desinstalar"); process.exit(64); }
