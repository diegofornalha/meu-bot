/**
 * Login do Claude Code numa máquina, de dentro do app: roda `claude auth login` por SSH (ou local),
 * que sem terminal imprime o link de autorização e espera o código no stdin ("Paste code here").
 * O app abre o link no navegador do Mac, a pessoa cola o código no modal, e o app o entrega ao
 * processo. No fim confere com `claude auth status`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { shell } from "electron";
import type { ClaudeAuthInfo, ClaudeLoginEvent } from "../../shared/ipc";
import { log } from "../maquina/backend";
import { findClaude, LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";

const SSH_OPTS = [
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3",
  "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new",
];
const REMOTE_PATH = "export PATH=$HOME/.local/bin:$HOME/bin:$PATH";
const URL_RE = /https:\/\/claude\.com\/[^\s"']+/;

let current: { host: string; child: ChildProcess } | null = null;

const strip = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "\n");
/** Pasta de uma conta isolada (CLAUDE_CONFIG_DIR): absoluta e só com caracteres seguros para ir num comando por SSH. */
const CONFIG_DIR_RE = /^\/[A-Za-z0-9._\/-]{1,300}$/;
/**
 * `configDir` = conta isolada (contas-claude.js): o `claude` roda com CLAUDE_CONFIG_DIR nessa pasta, local ou por SSH.
 * Sem ele, a conta padrão (~/.claude), como sempre.
 */
function spawnFor(host: string, remoteCmd: string, localArgs: string[], configDir?: string): ChildProcess | null {
  if (configDir !== undefined && !CONFIG_DIR_RE.test(configDir)) return null;
  if (host === LOCAL_HOST) {
    const claude = findClaude();
    if (claude === null) return null;
    return spawn(claude, localArgs, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...(configDir === undefined ? {} : { CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" }) } });
  }
  const exporta = configDir === undefined ? "" : `export CLAUDE_CONFIG_DIR='${configDir}'; `;
  return spawn("ssh", [...SSH_OPTS, "--", host, `${REMOTE_PATH}; ${exporta}${remoteCmd}`], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
}

/** `claude auth status` → logado? (null se não deu para consultar) */
export function claudeAuthStatus(host: string, configDir?: string): Promise<{ loggedIn: boolean; raw: string } | null> {
  return new Promise((resolve) => {
    const child = spawnFor(host, "claude auth status 2>/dev/null", ["auth", "status"], configDir);
    if (child === null) { resolve(null); return; }
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout?.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", () => {
      clearTimeout(timer);
      try { resolve({ loggedIn: (JSON.parse(out) as { loggedIn?: unknown }).loggedIn === true, raw: out }); } catch { resolve(null); }
    });
  });
}

/**
 * Claude Code Global do admin para este usuário: `GLOBAL=1 <e-mail da conta do root>` quando o arquivo que o admin
 * deixa está válido (o mesmo que contas-claude.js lê); nada sem ele. A chave nunca é impressa.
 */
const GLOBAL_CMD = `python3 -c 'import json,os,re
try:
    g=json.load(open(os.path.expanduser("~/.local/share/meu-bot/claude-global.json")))
    ok=re.match(r"^http://127\\.0\\.0\\.1:\\d{2,5}$",str(g.get("url"))) and re.match(r"^[A-Za-z0-9]{32,128}$",str(g.get("chave")))
    print("GLOBAL=1 "+(g.get("email") or "") if ok else "")
except Exception: pass' 2>/dev/null`;
/** Conta logada (e-mail do oauthAccount em ~/.claude.json) e estado do `claude auth status`. null se não deu para consultar. */
export function claudeAuthInfo(host: string): Promise<ClaudeAuthInfo | null> {
  const emailCmd = "python3 -c 'import json,os;print(json.load(open(os.path.expanduser(\"~/.claude.json\"))).get(\"oauthAccount\",{}).get(\"emailAddress\",\"\"))' 2>/dev/null";
  return new Promise((resolve) => {
    const child = host === LOCAL_HOST
      ? spawn("bash", ["-c", `${findClaude() === null ? "echo '{}'" : `'${findClaude()}' auth status 2>/dev/null`}; echo __EMAIL__; ${emailCmd}`], { stdio: ["ignore", "pipe", "pipe"] })
      : spawn("ssh", [...SSH_OPTS, "--", host, `${REMOTE_PATH}; claude auth status 2>/dev/null; echo __EMAIL__; ${emailCmd}; echo __GLOBAL__; ${GLOBAL_CMD}`], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", () => {
      clearTimeout(timer);
      const [statusPart, resto] = out.split("__EMAIL__");
      const [emailPart, globalPart] = (resto ?? "").split("__GLOBAL__");
      let loggedIn = false;
      try { loggedIn = (JSON.parse(statusPart ?? "") as { loggedIn?: unknown }).loggedIn === true; } catch { if (statusPart === undefined) { resolve(null); return; } }
      const email = (emailPart ?? "").trim();
      // Global do admin: a máquina responde pela conta do root mesmo sem login próprio; a linha mostra o e-mail dela.
      const g = /^GLOBAL=1 ?(\S*)$/m.exec(globalPart ?? "");
      if (g !== null) { resolve({ loggedIn: true, email: /^[^@\s]+@[^@\s]+$/.test(g[1] ?? "") ? g[1]! : null, global: true }); return; }
      resolve({ loggedIn, email: /^[^@\s]+@[^@\s]+$/.test(email) ? email : null });
    });
  });
}

/** `claude auth logout` na máquina; devolve o estado depois. */
export async function claudeLogout(host: string): Promise<ClaudeAuthInfo | null> {
  await new Promise<void>((resolve) => {
    const child = spawnFor(host, "claude auth logout 2>&1", ["auth", "logout"]);
    if (child === null) { resolve(); return; }
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdin?.end();
    child.on("error", () => { clearTimeout(timer); resolve(); });
    child.on("close", () => { clearTimeout(timer); resolve(); });
  });
  log(`[claude-login] ${host}: logout pedido`);
  return claudeAuthInfo(host);
}

export const loginInProgress = (): string | null => current?.host ?? null;

/**
 * Inicia o login; eventos por `send`. Resolve quando o processo termina (ok = `auth status` logado).
 * `configDir` = pasta de uma conta isolada; sem ele, a conta padrão da máquina.
 */
export function startClaudeLogin(host: string, send: (ev: ClaudeLoginEvent) => void, configDir?: string): Promise<void> {
  if (host !== LOCAL_HOST && !isValidHost(host)) { send({ kind: "done", ok: false, text: "máquina inválida" }); return Promise.resolve(); }
  if (configDir !== undefined && !CONFIG_DIR_RE.test(configDir)) { send({ kind: "done", ok: false, text: "pasta da conta inválida" }); return Promise.resolve(); }
  if (current !== null) { send({ kind: "done", ok: false, text: `já há um login em andamento em ${current.host}` }); return Promise.resolve(); }
  return new Promise((resolve) => {
    const child = spawnFor(host, "claude auth login 2>&1", ["auth", "login"], configDir);
    if (child === null) { send({ kind: "done", ok: false, text: "Claude Code não encontrado neste Mac" }); resolve(); return; }
    current = { host, child };
    let buf = ""; let urlSent = false;
    send({ kind: "log", text: host === LOCAL_HOST ? "iniciando claude auth login neste Mac" : `conectando a ${host} e iniciando claude auth login` });
    const onData = (d: Buffer): void => {
      buf += strip(d.toString("utf8"));
      if (!urlSent) {
        const m = URL_RE.exec(buf);
        if (m !== null) {
          urlSent = true;
          send({ kind: "url", url: m[0] });
          void shell.openExternal(m[0]);
        }
      }
      if (/paste code here/i.test(buf) && urlSent) { send({ kind: "waiting-code" }); buf = buf.replace(/paste code here[^\n]*/gi, ""); }
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) { const t = line.trim(); if (t !== "" && !URL_RE.test(t) && !/opening browser|if the browser didn't open|^Connection to .+ closed/i.test(t)) send({ kind: "log", text: t }); }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.stdin?.on("error", () => { /* processo já saiu */ });
    const timer = setTimeout(() => { send({ kind: "log", text: "tempo esgotado (10 min)" }); child.kill("SIGTERM"); }, 600_000);
    child.on("error", (e) => { send({ kind: "done", ok: false, text: `não consegui iniciar: ${e.message}` }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      current = null;
      void claudeAuthStatus(host, configDir).then((st) => {
        const ok = st?.loggedIn === true;
        log(`[claude-login] ${host}${configDir === undefined ? "" : ` (${configDir})`}: processo saiu com ${code}; logado=${ok}`);
        send({ kind: "done", ok, text: ok ? (configDir === undefined ? "Claude Code logado nesta máquina." : "Conta logada. O rodízio já pode usá-la.") : `o login não concluiu (código ${code ?? "?"}). Confira se o código foi colado inteiro e tente de novo.` });
        resolve();
      });
    });
  });
}

/** Entrega o código colado pela pessoa ao processo de login. */
export function submitClaudeLoginCode(code: string): boolean {
  if (current === null || current.child.stdin === null) return false;
  const clean = code.trim();
  if (clean === "" || clean.length > 400) return false;
  current.child.stdin.write(`${clean}\n`);
  return true;
}

export function cancelClaudeLogin(): void {
  if (current === null) return;
  try { current.child.kill("SIGTERM"); } catch { /* ok */ }
}
