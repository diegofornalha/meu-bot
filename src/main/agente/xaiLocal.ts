/**
 * Grok (xAI) por OAuth na máquina "local" (este Mac). O par do install-grok-oauth.sh + xaiLogin.ts das máquinas por
 * SSH, sem systemd: o Hermes fica numa pasta do meu-bot (~/.local/share/meu-bot/hermes, na versão fixa, sem mexer
 * num `hermes` que a pessoa já tenha), o proxy da xAI é um processo filho do app, ao lado do backend local, e o
 * providers.json do backend local aponta o grok-4 para ele. A credencial fica em ~/.hermes, como em qualquer Hermes.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { app, shell } from "electron";
import type { ClaudeAuthInfo, ClaudeLoginEvent, InstallBackendResult } from "../../shared/ipc";
import { ensureLocalBackend, findNode, localBackendAlive, localBackendDir, localBackendPort, stopLocalBackend } from "../maquina/localBackend";
import { pidsDoLsof } from "../maquina/backend-local-orfao-core";
import { HERMES_VERSION_LOCAL, ehNossoProxyOrfao, hermesNaVersao, providersApontaProxy, providersComGrokLocal, proxyPortaLocal, rotuloCredencialXai, statusXaiLogado } from "./xaiLocal-core";

const HOME = os.homedir();
const PREFIX = path.join(HOME, ".local", "share", "meu-bot", "hermes");
const HERMES = path.join(PREFIX, "bin", "hermes");
const URL_RE = /https:\/\/accounts\.x\.ai\/[^\s"']+/;
const CODE_RE = /user_code=([A-Z0-9-]+)/;

function log(line: string): void {
  try { fs.appendFileSync(path.join(app.getPath("userData"), "meu-bot.log"), `${new Date().toISOString()} [xai-local] ${line}\n`); } catch { /* cortesia */ }
}

const porta = (): number => proxyPortaLocal(localBackendPort());
const providersPath = (): string => path.join(localBackendDir(), "providers.json");
const lerProviders = (): string | null => { try { return fs.readFileSync(providersPath(), "utf8"); } catch { return null; } };
const hermesInstalado = (): boolean => { try { fs.accessSync(HERMES, fs.constants.X_OK); return true; } catch { return false; } };
/** O Grok está preparado neste app: Hermes na pasta do meu-bot e o providers.json local apontando o proxy. */
const preparado = (): boolean => hermesInstalado() && providersApontaProxy(lerProviders(), porta());

/** O hermes é um script Node: o node precisa estar no PATH (app de GUI tem PATH mínimo). */
function envHermes(): NodeJS.ProcessEnv {
  const node = findNode();
  const extra = [path.dirname(HERMES), ...(node === null ? [] : [path.dirname(node)]), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");
  return { ...process.env, HOME, PATH: `${extra}:${process.env["PATH"] ?? ""}` };
}

function run(cmd: string, args: string[], timeoutMs: number, onLine?: (l: string) => void): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: envHermes() });
    let out = ""; let buf = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const on = (d: Buffer): void => {
      const s = d.toString("utf8"); out += s;
      if (onLine === undefined) return;
      buf += s; const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const l of lines) { const t = l.trim(); if (t !== "" && !/PIPEBOARD|Config ref/.test(t)) onLine(t); }
    };
    child.stdout.on("data", on); child.stderr.on("data", on);
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out: out + e.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}
const hermes = (args: string[], timeoutMs = 40_000): Promise<{ code: number | null; out: string }> => run(HERMES, args, timeoutMs);

function portOpen(p: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port: p, host: "127.0.0.1" });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
    sock.setTimeout(800, () => { sock.destroy(); resolve(false); });
  });
}

// --- proxy: processo filho, volta se cair (antes do login ele sai na hora com "Not logged in") ---
let proxy: ChildProcess | null = null;
let proxyQuer = false;
let proxyRetry: NodeJS.Timeout | null = null;

/** PIDs ouvindo na porta deste app que são o nosso proxy (de uma abertura anterior). */
function proxiesNaPorta(p: number): number[] {
  const l = spawnSync("lsof", ["-nP", `-iTCP:${p}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8", timeout: 5000 });
  return pidsDoLsof(l.stdout ?? "", process.pid).filter((pid) => {
    const ps = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 5000 });
    return ehNossoProxyOrfao(ps.stdout ?? "", PREFIX, p);
  });
}

/** Encerra o proxy órfão que segura a porta (SIGTERM, até 5 s, depois SIGKILL). */
async function liberarProxyOrfao(p: number): Promise<void> {
  const nossos = proxiesNaPorta(p);
  if (nossos.length === 0) return;
  for (const pid of nossos) { try { process.kill(pid, "SIGTERM"); } catch { /* já saiu */ } }
  log(`proxy órfão de uma abertura anterior (pid ${nossos.join(", ")}) segurava a porta ${p}: encerrado`);
  for (let i = 0; i < 25 && proxiesNaPorta(p).length > 0; i++) await new Promise((r) => setTimeout(r, 200));
  for (const pid of proxiesNaPorta(p)) { try { process.kill(pid, "SIGKILL"); } catch { /* já saiu */ } }
}

let subindo = false;
function subirProxy(): void {
  if (!proxyQuer || proxy !== null || subindo) return;
  subindo = true;
  void liberarProxyOrfao(porta()).catch(() => undefined).finally(() => { subindo = false; iniciarProxy(); });
}

function iniciarProxy(): void {
  if (!proxyQuer || proxy !== null) return;
  const fd = fs.openSync(path.join(app.getPath("userData"), "xai-proxy.log"), "a");
  // Grupo de processos próprio (detached): o stop encerra o wrapper node E o python que ele sobe.
  const child = spawn(HERMES, ["proxy", "start", "--provider", "xai", "--host", "127.0.0.1", "--port", String(porta())], { stdio: ["ignore", fd, fd], env: envHermes(), detached: true });
  fs.closeSync(fd);
  proxy = child;
  const ini = Date.now();
  child.on("error", (e) => log(`proxy não iniciou: ${e.message}`));
  child.on("exit", (code, signal) => {
    // Um filho que já foi substituído (stop + ensure) não agenda nada: senão ficavam dois ciclos de retry.
    if (proxy !== child) return;
    proxy = null;
    if (!proxyQuer) return;
    log(`proxy saiu após ${Date.now() - ini} ms (code=${code} signal=${signal}); de novo em 15 s`);
    if (proxyRetry !== null) return; // um ciclo só
    proxyRetry = setTimeout(() => { proxyRetry = null; subirProxy(); }, 15_000);
    proxyRetry.unref();
  });
}

/** Sobe o proxy da xAI se o Grok está preparado neste app (o túnel chama ao subir o backend local). */
export function ensureLocalXaiProxy(): void {
  if (!preparado()) return;
  proxyQuer = true;
  subirProxy();
}

export function stopLocalXaiProxy(): void {
  proxyQuer = false;
  if (proxyRetry !== null) { clearTimeout(proxyRetry); proxyRetry = null; }
  const p = proxy; proxy = null;
  if (p === null) return;
  // O grupo inteiro (wrapper + python); se o grupo já não existe, ao menos o filho direto.
  try { if (p.pid !== undefined) process.kill(-p.pid, "SIGTERM"); else p.kill("SIGTERM"); } catch { try { p.kill("SIGTERM"); } catch { /* já morto */ } }
}

/** Reinicia o proxy na hora (depois do login, para não esperar os 15 s do retry). */
function reiniciarProxy(): void { stopLocalXaiProxy(); ensureLocalXaiProxy(); }

// --- estado, preparo, login e logout (as mesmas respostas do xaiLogin.ts) ---

/** Nunca null no Mac: sem Hermes ainda é "não preparado, não logado" (o tutorial mostra o passo 1). */
export async function xaiAuthInfoLocal(): Promise<ClaudeAuthInfo> {
  if (!hermesInstalado()) return { loggedIn: false, email: null, proxy: false };
  const [st, ls] = await Promise.all([hermes(["auth", "status", "xai-oauth"]), hermes(["auth", "list"])]);
  const status = st.out.split("\n").find((l) => l.startsWith("xai-oauth")) ?? "";
  return { loggedIn: statusXaiLogado(status), email: rotuloCredencialXai(ls.out), proxy: preparado() };
}

/** Passo 1 do tutorial 4 no Mac: instala o Hermes (se preciso), aponta o grok-4 para o proxy e reinicia o backend local. */
export async function prepareGrokOauthLocal(onLine?: (line: string) => void): Promise<InstallBackendResult> {
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const fail = (l: string): InstallBackendResult => { say(l); return { ok: false, log: lines }; };
  const v = hermesInstalado() ? await hermes(["--version"]) : { code: null, out: "" };
  if (!hermesNaVersao(v.out)) {
    const node = findNode();
    if (node === null) return fail("Node.js não encontrado neste Mac (preciso dele para instalar o Hermes)");
    const npm = path.join(path.dirname(node), "npm");
    if (!fs.existsSync(npm)) return fail(`npm não encontrado ao lado do node (${node})`);
    say(`instalando o Hermes ${HERMES_VERSION_LOCAL} em ${PREFIX} (só na primeira vez demora)…`);
    fs.mkdirSync(PREFIX, { recursive: true });
    const inst = await run(npm, ["install", "-g", "--prefix", PREFIX, `hermes-agent@${HERMES_VERSION_LOCAL}`], 10 * 60_000);
    if (inst.code !== 0 || !hermesInstalado()) { log(`npm install falhou: ${inst.out.slice(-800)}`); return fail("a instalação do Hermes falhou (detalhes em meu-bot.log)"); }
  }
  const ver = await hermes(["--version"]);
  say(`Hermes: ${ver.out.split("\n").find((l) => l.startsWith("Hermes")) ?? HERMES_VERSION_LOCAL}`);
  const prov = await hermes(["proxy", "providers"]);
  if (!/xai/i.test(prov.out)) return fail("este Hermes não tem o proxy da xAI");

  const p = porta();
  if (proxy === null && await portOpen(p)) return fail(`a porta ${p} do proxy já está em uso neste Mac por outro programa`);
  fs.mkdirSync(localBackendDir(), { recursive: true });
  const antes = lerProviders();
  if (antes !== null && !providersApontaProxy(antes, p)) { fs.writeFileSync(`${providersPath()}.antes-do-grok-oauth`, antes); say("providers.json anterior guardado em providers.json.antes-do-grok-oauth"); }
  fs.writeFileSync(providersPath(), providersComGrokLocal(p, antes));
  say(`grok-4 apontado para o proxy local (porta ${p})`);

  reiniciarProxy();
  // O server.js lê o providers.json ao subir: reinicia o backend local, se está no ar, para o grok-4 entrar.
  if (localBackendAlive()) {
    stopLocalBackend();
    try { await ensureLocalBackend(); say("backend local reiniciado"); }
    catch (err) { say(`aviso: o backend local não voltou (${err instanceof Error ? err.message : String(err)}); feche e abra a janela deste Mac`); }
  }
  const st = await xaiAuthInfoLocal();
  say(st.loggedIn ? "pronto: xAI já logada; o grok-4 responde pelo proxy" : "pronto: falta entrar na xAI (o app abre o link de login agora)");
  return { ok: true, log: lines };
}

let current: ChildProcess | null = null;

/**
 * `hermes auth add xai-oauth` num pseudo-terminal (`script`: sem pty o Hermes não imprime o link e fica parado). A entrada
 * fica em /dev/null: o `script` do macOS chama tcgetattr na entrada, e o pipe do Node (um socket) o faz sair na hora
 * com código 1 ("Operation not supported on socket"). O Hermes só espera a aprovação; não lê nada da entrada.
 */
export function startXaiLoginLocal(send: (ev: ClaudeLoginEvent) => void): Promise<void> {
  if (!hermesInstalado()) { send({ kind: "done", ok: false, text: "o Grok ainda não foi preparado neste Mac (passo 1)" }); return Promise.resolve(); }
  if (current !== null) { send({ kind: "done", ok: false, text: "já há um login da xAI em andamento neste Mac" }); return Promise.resolve(); }
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/script", ["-q", "/dev/null", HERMES, "auth", "add", "xai-oauth", "--type", "oauth", "--no-browser"], { stdio: ["ignore", "pipe", "pipe"], env: envHermes() });
    current = child;
    let buf = ""; let all = ""; let urlSent = false;
    send({ kind: "log", text: "pedindo o login da xAI neste Mac" });
    const onData = (d: Buffer): void => {
      const s = d.toString("utf8").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "\n"); buf += s; all += s;
      if (!urlSent) {
        const m = URL_RE.exec(buf);
        if (m !== null) {
          urlSent = true;
          send({ kind: "url", url: m[0] });
          const code = CODE_RE.exec(m[0])?.[1];
          if (code !== undefined) send({ kind: "log", text: `código do dispositivo: ${code} (a página já vem com ele; confira e aprove)` });
          void shell.openExternal(m[0]);
        }
      }
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) { const t = line.trim(); if (t !== "" && !URL_RE.test(t) && !/^\d\.\s|To continue:|If prompted|PIPEBOARD|Config ref|^\^D/i.test(t)) send({ kind: "log", text: t }); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => { send({ kind: "log", text: "tempo esgotado (10 min)" }); child.kill("SIGTERM"); }, 600_000);
    child.on("error", (e) => { send({ kind: "done", ok: false, text: `não consegui iniciar: ${e.message}` }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      current = null;
      void (async () => {
        const added = /Added xai-oauth OAuth credential #\d+:\s*"([^"]+)"/.exec(all)?.[1] ?? null;
        let ok = false;
        if (added !== null) {
          // Remove as credenciais antigas do provedor (uma vencida na frente derruba o proxy com invalid_grant).
          const ls = await hermes(["auth", "list"]);
          const bloco = ls.out.slice(Math.max(0, ls.out.indexOf("xai-oauth"))).split("\n\n")[0] ?? "";
          for (const l of bloco.split("\n")) {
            const id = /oauth\s+id=([0-9a-f]+)/.exec(l)?.[1];
            if (id !== undefined && !l.includes(added) && (await hermes(["auth", "remove", "xai-oauth", id])).code === 0) send({ kind: "log", text: `credencial antiga removida (${id})` });
          }
          ok = (await xaiAuthInfoLocal()).loggedIn;
          if (ok) reiniciarProxy();
        }
        log(`login: processo saiu com ${code}; logado=${ok}`);
        send({ kind: "done", ok, text: ok ? `xAI logada neste Mac (${added ?? "credencial nova"}); ${preparado() ? "o grok-4 já usa a conta nova." : "falta preparar o Grok (passo 1) para o grok-4 responder."}` : `o login da xAI não concluiu (código ${code ?? "?"}).` });
        resolve();
      })();
    });
  });
}

export function cancelXaiLoginLocal(): boolean {
  if (current === null) return false;
  try { current.kill("SIGTERM"); } catch { /* ok */ }
  return true;
}

export async function xaiLogoutLocal(): Promise<ClaudeAuthInfo> {
  if (hermesInstalado()) await hermes(["auth", "logout", "xai-oauth"]);
  log("logout pedido");
  return xaiAuthInfoLocal();
}
