// Release automática depois do merge (skill publicar): um agente do launchd neste Mac roda isto a cada 10 min.
// GitHub Actions não serve: a chave da release está no Chaveiro deste Mac, e build/suporte e config/google-*.json
// ficam fora do git. Cada rodada olha só para o origin/main e faz no máximo uma coisa (regras em decideRodada,
// release-core.mjs):
//   staging     → 10 min depois do último merge: npm test + npm run release:staging (o macOS pede a chave: um clique)
//   promover    → staging no ar há 24 h e confirmado no meu-bot-staging deste Mac (release-saude.mjs): npm run release,
//                 e o deploy do site se conta-api/ mudou desde a estável anterior
//   subir-base  → depois da estável: PR "Versão: base sobe" (package.json + CHANGELOG datado), mergeado sozinho
//   aguardar    → nada; se o staging ainda não foi confirmado, abre o meu-bot-staging escondido para ele se atualizar
// Tudo roda no worktree fixo ../meu-bot-release (detached no commit da vez); o log fica em
// ~/Library/Logs/meu-bot-release.log e o Mac avisa por notificação.
//
//   node scripts/release-auto.mjs --check        mostra a decisão da rodada, sem fazer nada
//   node scripts/release-auto.mjs --run          uma rodada (o que o launchd chama)
//   node scripts/release-auto.mjs --instalar     instala o agente do launchd e troca os staging locais pelos da release
//   node scripts/release-auto.mjs --desinstalar  tira o agente
//   node scripts/release-auto.mjs --segurar "motivo"  o agente não promove a estável (staging e base seguem) até --soltar
//   node scripts/release-auto.mjs --soltar       tira a trava; a promoção volta na rodada seguinte, se ainda couber
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dataPorExtenso, decideRodada, fecharChangelog, proximaBase, stagingMaisNovo, travaOrfa } from "./release-core.mjs";
import { bundleDoStaging, saudeDesteMac } from "./release-saude.mjs";
import { arquivosDeFragmento, lerFragmentos } from "./changelog-fragmentos.mjs";

const AQUI = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = homedir();
const ESTADO = process.env.MEU_BOT_RELEASE_DIR ?? join(HOME, "Library", "Application Support", "meu-bot-release");
/** Trava da promoção (ex.: esperando o certificado Developer ID para a estável sair notarizada): o arquivo guarda o motivo. */
const SEGURAR = join(ESTADO, "segurar-estavel");
const motivoSegurar = () => { try { return readFileSync(SEGURAR, "utf8").trim() || "sem motivo escrito"; } catch { return null; } };
const LOG = process.env.MEU_BOT_RELEASE_LOG ?? join(HOME, "Library", "Logs", "meu-bot-release.log");
const ROTULO = "com.meu-bot.release-auto";
const PLIST = join(HOME, "Library", "LaunchAgents", `${ROTULO}.plist`);
const STAGING_APPS = ["meu-bot-staging", "meu-bot-finance-staging"];
/** Uma ação que falhou (testes, chave negada…) só é tentada de novo no mesmo commit depois disto. */
const ESPERA_FALHA_MS = 60 * 60 * 1000;

mkdirSync(ESTADO, { recursive: true }); mkdirSync(dirname(LOG), { recursive: true });
const log = (s) => appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`);
const avisar = (sub, msg) => { try { execFileSync("osascript", ["-e", `display notification ${JSON.stringify(msg)} with title "meu-bot · release" subtitle ${JSON.stringify(sub)}`], { stdio: "ignore" }); } catch { /* sem GUI */ } };
const sh = (cmd, args, cwd = PRINCIPAL) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const shOu = (cmd, args, cwd) => { try { return sh(cmd, args, cwd); } catch { return null; } };
/** Roda com a saída no log; true = saiu 0. */
const rodar = (cmd, args, cwd) => {
  log(`$ ${cmd} ${args.join(" ")}  (em ${cwd})`);
  const r = spawnSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  appendFileSync(LOG, `${r.stdout ?? ""}${r.stderr ?? ""}`);
  return r.status === 0;
};

// Checkout principal (dono do .git) e, ao lado dele, o worktree fixo da release.
const PRINCIPAL = resolve(sh("git", ["rev-parse", "--git-common-dir"], AQUI).replace(/^(?!\/)/, `${AQUI}/`), "..");
const WT = process.env.MEU_BOT_RELEASE_WT ?? join(dirname(PRINCIPAL), "meu-bot-release");

const lerEstado = () => { try { return JSON.parse(readFileSync(join(ESTADO, "estado.json"), "utf8")); } catch { return {}; } };
const gravarEstado = (e) => writeFileSync(join(ESTADO, "estado.json"), `${JSON.stringify(e, null, 2)}\n`);

/** O que a rodada vê no origin/main, e a decisão. */
function olhar() {
  shOu("git", ["fetch", "-q", "--tags", "--force", "origin", "main"]);
  const sha = sh("git", ["rev-parse", "origin/main"]);
  const base = JSON.parse(sh("git", ["show", "origin/main:package.json"])).version;
  const tagsTodas = sh("git", ["tag", "-l", "v*"]).split("\n").filter(Boolean);
  const tagsNoHead = sh("git", ["tag", "--points-at", sha]).split("\n").filter(Boolean);
  const commitEm = Date.parse(sh("git", ["log", "-1", "--format=%cI", sha]));
  const tag = stagingMaisNovo(base, tagsNoHead);
  let stagingEm = null, saude = null;
  if (tag !== null) {
    const pub = shOu("gh", ["release", "view", tag, "--json", "publishedAt", "-q", ".publishedAt"]);
    stagingEm = pub ? Date.parse(pub) : null;
    saude = saudeDesteMac(tag.slice(1));
  }
  const ultima = shOu("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", sha]);
  const mudouDesdeRelease = ultima ? (shOu("git", ["diff", "--name-only", `${ultima}..${sha}`]) ?? "").split("\n").filter(Boolean) : null;
  return { sha, base, tag, decisao: decideRodada({ base, tagsTodas, tagsNoHead, commitEm, stagingEm, saude, agora: Date.now(), mudouDesdeRelease }) };
}

/** O worktree da release no commit da vez, com o que o git não guarda (como o meu-bot-build-main do hook de rebuild). */
/** `npm ci` no worktree quando o package-lock mudou desde a última instalação (marca em node_modules/.lock-da-release). */
function depsDoLock(dir) {
  const nm = join(dir, "node_modules");
  try { if (lstatSync(nm).isSymbolicLink()) rmSync(nm); } catch { /* não existe */ }
  const lock = readFileSync(join(dir, "package-lock.json"), "utf8");
  const hash = createHash("sha256").update(lock).digest("hex");
  const marca = join(nm, ".lock-da-release");
  if (existsSync(marca) && readFileSync(marca, "utf8").trim() === hash) return true;
  log(`package-lock mudou: npm ci em ${dir}`);
  if (!rodar("npm", ["ci", "--no-audit", "--no-fund"], dir)) return false;
  // O Electron 44 não baixa o binário no npm ci (sem postinstall): baixa no primeiro require("electron"). Com os testes
  // em paralelo, dois arquivos baixavam juntos e um caía em "File exists (os error 17)"; a staging.6 falhou assim.
  if (!rodar("node", [join(nm, "electron", "install.js")], dir)) return false;
  writeFileSync(marca, `${hash}\n`);
  return true;
}
function prepararWorktree(sha) {
  if (existsSync(join(WT, ".git"))) { if (!rodar("git", ["checkout", "-q", "--detach", "-f", sha], WT)) return false; }
  else if (!rodar("git", ["worktree", "add", "-q", "--detach", WT, sha], PRINCIPAL)) return false;
  // node_modules próprio, instalado pelo package-lock do commit da release (npm ci só quando o lock muda). Antes era um
  // symlink para o do checkout principal, que fica no branch dele: a 0.83.0-staging.2 saiu com o Electron velho.
  if (!depsDoLock(WT)) return false;
  for (const nm of ["extensao-crm/node_modules"]) if (!existsSync(join(WT, nm)) && existsSync(join(PRINCIPAL, nm))) symlinkSync(join(PRINCIPAL, nm), join(WT, nm));
  // build/ inteiro (extensão do autenticador, suporte do admin, venv do .dmg…) e os clients do Google: fora do git.
  // Apaga a cópia da rodada anterior antes: o cpSync por cima de um venv já copiado quebra com EEXIST.
  rmSync(join(WT, "build"), { recursive: true, force: true });
  if (existsSync(join(PRINCIPAL, "build"))) cpSync(join(PRINCIPAL, "build"), join(WT, "build"), { recursive: true, force: true, verbatimSymlinks: true });
  for (const f of ["google-oauth.json", "google-conta-oauth.json"]) if (existsSync(join(PRINCIPAL, "config", f))) cpSync(join(PRINCIPAL, "config", f), join(WT, "config", f));
  const sujo = shOu("git", ["status", "--porcelain"], WT);
  if (sujo) { log(`worktree ${WT} com mudanças depois de preparar:\n${sujo}`); return false; }
  return true;
}

function fazerStaging(sha) {
  if (!prepararWorktree(sha)) return "não preparei o worktree da release";
  if (!rodar("npm", ["test"], WT)) return "testes falharam no origin/main";
  avisar("aprove a chave", "Publicando o staging: o macOS vai pedir a chave da release no Chaveiro.");
  if (!rodar("npm", ["run", "release:staging"], WT)) return "release:staging falhou (chave negada? veja o log)";
  return null;
}

function promover(sha, base) {
  if (!prepararWorktree(sha)) return "não preparei o worktree da release";
  avisar("aprove a chave", `Promovendo a v${base} para estável: o macOS vai pedir a chave da release.`);
  if (!rodar("npm", ["run", "release"], WT)) return "npm run release falhou (veja o log)";
  // O site (conta-api) acompanha a estável quando mudou desde a anterior (o que a skill publicar-site faz à mão).
  const anteriores = sh("git", ["tag", "-l", "v*", "--sort=-v:refname"]).split("\n").filter((t) => /^v\d+\.\d+\.\d+$/.test(t) && t !== `v${base}`);
  const mudouSite = anteriores.length === 0 || (shOu("git", ["diff", "--name-only", `${anteriores[0]}..${sha}`, "--", "conta-api"]) ?? "") !== "";
  if (mudouSite) {
    const site = join(WT, "conta-api");
    if (!rodar("npm", ["ci"], site) || !rodar("npm", ["run", "deploy"], site)) return `v${base} publicada, mas o deploy do site falhou (skill publicar-site)`;
    log("site publicado junto com a estável");
  }
  return null;
}

function subirBase(sha, base) {
  const nova = proximaBase(base), branch = `versao-${nova}`;
  if (shOu("gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "number", "-q", ".[0].number"])) return tentarMerge(branch, nova);
  if (!prepararWorktree(sha)) return "não preparei o worktree da release";
  if (!rodar("git", ["checkout", "-q", "-B", branch, sha], WT)) return "não criei o branch da versão";
  if (!rodar("npm", ["version", nova, "--no-git-tag-version"], WT)) return "npm version falhou";
  const cl = join(WT, "docs", "CHANGELOG.md");
  // Os itens de docs/changelog/ (um por PR) entram na seção datada e saem da pasta no mesmo commit.
  const fragmentos = arquivosDeFragmento(WT);
  if (existsSync(cl)) { const novo = fecharChangelog(readFileSync(cl, "utf8"), base, dataPorExtenso(new Date()), lerFragmentos(WT)); if (novo !== null) writeFileSync(cl, novo); }
  if (fragmentos.length > 0 && !rodar("git", ["rm", "-q", ...fragmentos], WT)) return "não tirei os itens de docs/changelog/";
  const msg = `Versão: base sobe para ${nova} depois da estável ${base}\n\nFeito pela release automática (scripts/release-auto.mjs): "Ainda não lançado" do CHANGELOG vira a seção da v${base}.`;
  const ok = rodar("git", ["add", "package.json", "package-lock.json", "docs/CHANGELOG.md"], WT) && rodar("git", ["commit", "-q", "-m", msg], WT)
    && rodar("git", ["push", "-q", "-f", "-u", "origin", branch], WT)
    && rodar("gh", ["pr", "create", "--head", branch, "--base", "main", "--title", `Versão: base sobe para ${nova}`, "--body", `A v${base} saiu como estável. A base do main sobe para ${nova} (os próximos staging saem dela) e "Ainda não lançado" vira a seção datada da v${base}.\n\nAberto e mergeado pela release automática (\`scripts/release-auto.mjs\`).`], WT);
  rodar("git", ["checkout", "-q", "--detach", sha], WT);
  return ok ? tentarMerge(branch, nova) : "não abri o PR da versão";
}
function tentarMerge(branch, nova) {
  if (rodar("gh", ["pr", "merge", branch, "--merge", "--delete-branch"], WT) || rodar("gh", ["pr", "merge", branch, "--merge", "--auto"], WT)) { log(`base ${nova} no main`); return null; }
  return `PR ${branch} aberto, mas não consegui mergear`;
}

const aberto = (app) => spawnSync("pgrep", ["-f", `/${app}.app/Contents/MacOS/`]).status === 0;

const processoVivo = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e?.code === "EPERM"; } };

/** Pega a trava da rodada (pasta com o PID dentro); assume a de um processo que já morreu. */
function pegarTrava(lock) {
  try { mkdirSync(lock); } catch {
    let pid = null; try { pid = Number(readFileSync(join(lock, "pid"), "utf8").trim()); } catch { /* sem PID: versão antiga */ }
    let idadeMs = 0; try { idadeMs = Date.now() - statSync(lock).mtimeMs; } catch { /* sumiu agora */ }
    if (!travaOrfa({ pid, idadeMs, vivo: processoVivo })) return false;
    log(`trava órfã (o processo ${pid || "sem PID"} não existe mais): assumindo a rodada`);
    rmSync(lock, { recursive: true, force: true });
    try { mkdirSync(lock); } catch { return false; }
  }
  writeFileSync(join(lock, "pid"), String(process.pid));
  return true;
}

function rodada() {
  const lock = join(ESTADO, "lock");
  if (!pegarTrava(lock)) { log("já há uma rodada em andamento; esta sai"); return; }
  try {
    const { sha, base, tag, decisao } = olhar();
    // O agente roda deste worktree: mantê-lo no origin/main é o que atualiza o próprio agente na rodada seguinte.
    if (existsSync(join(WT, ".git")) && shOu("git", ["rev-parse", "HEAD"], WT) !== sha) rodar("git", ["checkout", "-q", "--detach", "-f", sha], WT);
    const estado = lerEstado();
    const chave = `${decisao.acao}@${sha}`;
    if (decisao.acao === "aguardar") {
      if (estado.ultimoMotivo !== decisao.motivo) { log(`aguardando: ${decisao.motivo}`); gravarEstado({ ...estado, ultimoMotivo: decisao.motivo }); }
      // O staging só se atualiza aberto: abre escondido (ele troca sozinho com o Mac ocioso e confirma em 30 s).
      if (decisao.abrirStaging && existsSync(bundleDoStaging(HOME)) && !aberto("meu-bot-staging") && !/voltou para a anterior/.test(decisao.motivo)) {
        log(`abrindo o meu-bot-staging escondido para ele receber a ${tag}`);
        spawnSync("open", ["-g", "-j", bundleDoStaging(HOME)]);
      }
      if (/voltou para a anterior/.test(decisao.motivo) && estado.avisadoVolta !== tag) { avisar("staging não ficou de pé", decisao.motivo); gravarEstado({ ...lerEstado(), avisadoVolta: tag }); }
      return;
    }
    const segurada = decisao.acao === "promover" ? motivoSegurar() : null;
    if (segurada !== null) {
      const motivo = `estável segurada (${segurada}); solte com --soltar`;
      if (estado.ultimoMotivo !== motivo) { log(`aguardando: ${motivo}`); gravarEstado({ ...estado, ultimoMotivo: motivo }); }
      return;
    }
    if (estado.falhou?.chave === chave && Date.now() - estado.falhou.em < ESPERA_FALHA_MS) return;
    log(`=== ${decisao.acao} (${decisao.motivo}) no origin/main ${sha.slice(0, 12)}`);
    const erro = decisao.acao === "staging" ? fazerStaging(sha) : decisao.acao === "promover" ? promover(sha, base) : subirBase(sha, base);
    if (erro === null) {
      log(`=== ${decisao.acao} ok`);
      gravarEstado({ ...lerEstado(), falhou: null, ultimoMotivo: null });
      avisar(decisao.acao === "staging" ? "staging publicado" : decisao.acao === "promover" ? `v${base} estável` : "base do main subiu", decisao.acao === "staging" ? "Os staging deste Mac se atualizam sozinhos; vira estável em 24 h se ficar de pé." : decisao.acao === "promover" ? "Os apps das pessoas baixam a versão nova sozinhos." : `main agora em ${proximaBase(base)}.`);
    } else {
      log(`=== ${decisao.acao} FALHOU: ${erro}`);
      gravarEstado({ ...lerEstado(), falhou: { chave, em: Date.now(), erro } });
      avisar(`${decisao.acao} falhou`, `${erro}. Tento de novo em 1 h (log: ~/Library/Logs/meu-bot-release.log)`);
    }
  } catch (e) {
    log(`rodada quebrou: ${e?.stack ?? e}`);
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

/** Troca os apps staging locais (build do main, versão sem sufixo) pelos da última release staging: daí em diante, eles se atualizam pelo atualizador. */
function instalarStagingDaRelease() {
  const tag = sh("gh", ["release", "list", "--limit", "30", "--json", "tagName,isPrerelease", "-q", '[.[] | select(.isPrerelease) | .tagName][0]']);
  if (!tag) { console.log("sem release staging no GitHub: nada a instalar"); return; }
  const tmp = mkdtempSync(join(tmpdir(), "meu-bot-staging-"));
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  for (const app of STAGING_APPS) {
    const zip = `${app}-${tag.slice(1)}-${arch}.zip`;
    if (spawnSync("gh", ["release", "download", tag, "-p", zip, "-D", tmp], { cwd: PRINCIPAL, stdio: "inherit" }).status !== 0) { console.log(`✗ não baixei ${zip}`); continue; }
    if (aberto(app)) { spawnSync("osascript", ["-e", `quit app "${app}"`]); for (let i = 0; i < 10 && aberto(app); i++) spawnSync("sleep", ["1"]); }
    const destino = join(HOME, "Applications", `${app}.app`);
    rmSync(destino, { recursive: true, force: true });
    execFileSync("ditto", ["-x", "-k", join(tmp, zip), join(HOME, "Applications")]);
    console.log(`✓ ${app} ${tag} da release em ${destino}`);
  }
  rmSync(tmp, { recursive: true, force: true });
}

function instalar() {
  const uid = process.getuid();
  // O launchd roda o agente do worktree da release (no origin/main a cada rodada), não do checkout principal, que
  // outras sessões usam e pode estar em outro branch.
  shOu("git", ["fetch", "-q", "--tags", "origin", "main"]);
  if (!prepararWorktree(sh("git", ["rev-parse", "origin/main"]))) { console.error(`✗ não preparei o worktree ${WT} (log: ${LOG})`); process.exit(1); }
  if (!existsSync(join(WT, "scripts", "release-auto.mjs"))) { console.error("✗ o origin/main ainda não tem scripts/release-auto.mjs: instale depois do merge"); process.exit(1); }
  // ~/.local/bin: o uv, que acha o Python 3.10+ do instalador .dmg (scripts/dmg.mjs); o do macOS é 3.9.
  const path = ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local", "bin"), dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
  // Conta nova no macOS não tem ~/Library/LaunchAgents até alguém criar um agente.
  mkdirSync(dirname(PLIST), { recursive: true });
  writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${ROTULO}</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${join(WT, "scripts", "release-auto.mjs")}</string><string>--run</string></array>
  <key>WorkingDirectory</key><string>${WT}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${path}</string></dict>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict></plist>
`);
  spawnSync("launchctl", ["bootout", `gui/${uid}/${ROTULO}`], { stdio: "ignore" });
  execFileSync("launchctl", ["bootstrap", `gui/${uid}`, PLIST]);
  console.log(`✓ agente ${ROTULO} instalado (a cada 10 min; log em ${LOG})`);
  instalarStagingDaRelease();
}

const modo = process.argv[2] ?? "--check";
if (modo === "--run") rodada();
else if (modo === "--instalar") instalar();
else if (modo === "--desinstalar") { spawnSync("launchctl", ["bootout", `gui/${process.getuid()}/${ROTULO}`], { stdio: "ignore" }); rmSync(PLIST, { force: true }); console.log(`✓ agente ${ROTULO} removido`); }
else if (modo === "--segurar") { mkdirSync(ESTADO, { recursive: true }); writeFileSync(SEGURAR, `${process.argv.slice(3).join(" ") || "sem motivo escrito"}\n`); log(`estável segurada: ${motivoSegurar()}`); console.log(`✓ o agente não promove a estável até --soltar (${motivoSegurar()})`); }
else if (modo === "--soltar") { rmSync(SEGURAR, { force: true }); log("trava da estável solta"); console.log("✓ trava solta: a promoção volta na rodada seguinte, se couber"); }
else if (modo === "--check") {
  const { sha, base, tag, decisao } = olhar();
  const e = lerEstado();
  console.log(`origin/main ${sha.slice(0, 12)} · base ${base} · staging no HEAD: ${tag ?? "nenhum"}`);
  console.log(`decisão: ${decisao.acao} — ${decisao.motivo}`);
  if (motivoSegurar() !== null) console.log(`estável segurada: ${motivoSegurar()} (solte com --soltar)`);
  if (e.falhou) console.log(`última falha: ${e.falhou.chave} em ${new Date(e.falhou.em).toLocaleString("pt-BR")}: ${e.falhou.erro}`);
  console.log(`agente: ${existsSync(PLIST) ? "instalado" : "não instalado"} · worktree: ${WT}${existsSync(WT) ? "" : " (ainda não criado)"} · log: ${LOG}`);
} else { console.error("uso: node scripts/release-auto.mjs --check | --run | --instalar | --desinstalar | --segurar \"motivo\" | --soltar"); process.exit(64); }
