/**
 * Backend rodando neste Mac, sem SSH: o app sobe `server.js` (o mesmo de backend-colima/) como
 * processo filho, em userData/backend-local, com a CLI do Claude Code do próprio Mac. É o host
 * especial "local" do seletor de máquinas.
 */
import { app } from "electron";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { backendBundleDir } from "./hostProbe";
import { BACKEND_RUNTIME_FILES } from "./backend-bundle-core";
import { produto } from "../app/variant";

export const LOCAL_HOST = "local";
/**
 * Porta fixa por app (Produto.portaLocal), fora da 8080 que o Lima do Colima costuma encaminhar para o Mac: o
 * estável e o staging abertos juntos não podem dividir (meu-bot 8790, meu-bot-staging 8791, crm-staging 8792).
 */
const localPort = (): number => produto().portaLocal;

const HOME = os.homedir();

function log(line: string): void {
  try { fs.appendFileSync(path.join(app.getPath("userData"), "meu-bot.log"), `${new Date().toISOString()} [local] ${line}\n`); } catch { /* cortesia */ }
}

/** Apps de GUI no macOS têm PATH mínimo: procura em lugares conhecidos e, por fim, num zsh de login. */
function findBinary(name: string, candidates: string[]): string | null {
  for (const c of candidates) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* próximo */ } }
  try {
    const r = spawnSync("/bin/zsh", ["-lc", `command -v ${name}`], { encoding: "utf8", timeout: 8000 });
    const p = r.stdout.trim().split("\n").pop() ?? "";
    if (r.status === 0 && p.startsWith("/")) { fs.accessSync(p, fs.constants.X_OK); return p; }
  } catch { /* sem zsh ou sem PATH */ }
  return null;
}

function nvmNodes(): string[] {
  const base = path.join(HOME, ".nvm", "versions", "node");
  try { return fs.readdirSync(base).sort().reverse().map((v) => path.join(base, v, "bin", "node")); } catch { return []; }
}

export const findNode = (): string | null => findBinary("node", [
  "/opt/homebrew/bin/node", "/usr/local/bin/node", path.join(HOME, ".local", "bin", "node"), path.join(HOME, ".local", "node", "bin", "node"), ...nvmNodes(),
]);
export const findClaude = (): string | null => findBinary("claude", [
  path.join(HOME, ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude",
]);
export function claudeLoggedIn(): boolean {
  try { return fs.readFileSync(path.join(HOME, ".claude.json"), "utf8").includes("\"oauthAccount\""); } catch { return false; }
}

const dir = (): string => path.join(app.getPath("userData"), "backend-local");

interface LocalState { child: ChildProcess; apiKey: string; startedAt: number }
let state: LocalState | undefined;
let starting: Promise<{ localPort: number; apiKey: string }> | undefined;
let onExit: ((reason: string) => void) | undefined;

/** Avisado quando o processo morre sozinho (o túnel marca o host como degradado). */
export function onLocalBackendExit(cb: (reason: string) => void): void { onExit = cb; }

function readOrCreateEnv(d: string, claude: string): string {
  const envPath = path.join(d, ".env");
  let key = "";
  try {
    const m = /^OPENAI_COMPAT_KEY=(.+)$/m.exec(fs.readFileSync(envPath, "utf8"));
    if (m !== null) key = m[1]!.trim();
  } catch { /* cria abaixo */ }
  if (key === "") key = crypto.randomBytes(32).toString("hex");
  const ws = path.join(HOME, "meu-bot-workspace");
  fs.mkdirSync(path.join(ws, "chat"), { recursive: true });
  fs.mkdirSync(path.join(ws, "agente"), { recursive: true });
  const body = [
    `OPENAI_COMPAT_KEY=${key}`, `PORT=${localPort()}`, "HOST=127.0.0.1", `CLAUDE_BIN=${claude}`,
    `WORKSPACE=${path.join(ws, "chat")}`, `AGENT_WORKSPACE=${path.join(ws, "agente")}`, "",
  ].join("\n");
  fs.writeFileSync(envPath, body, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
  return key;
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1" });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
    sock.setTimeout(800, () => { sock.destroy(); resolve(false); });
  });
}

export const localBackendAlive = (): boolean => state !== undefined && state.child.exitCode === null;

/** Garante o backend local no ar e devolve porta + chave. Reinicia se o processo morreu. */
export function ensureLocalBackend(onStatus?: (detail: string) => void): Promise<{ localPort: number; apiKey: string }> {
  if (starting !== undefined) return starting;
  starting = (async () => {
    try {
      if (localBackendAlive() && (await portOpen(localPort()))) return { localPort: localPort(), apiKey: state!.apiKey };
      const node = findNode();
      if (node === null) throw new Error("Node.js não encontrado neste Mac (procurei em Homebrew, /usr/local, ~/.local e nvm). Instale o Node 18+ para usar a máquina \"local\".");
      const claude = findClaude();
      if (claude === null) throw new Error("Claude Code não encontrado neste Mac (~/.local/bin/claude). Instale e faça login para usar a máquina \"local\".");
      if (!claudeLoggedIn()) throw new Error("O Claude Code deste Mac não está logado: rode `claude` no Terminal e use /login.");
      const d = dir();
      fs.mkdirSync(path.join(d, "data"), { recursive: true });
      const bundle = backendBundleDir();
      // Tudo que o server.js exige ao lado (a lista única de backend-bundle-core.ts): sem um deles o require falha na
      // subida. providers.json é configuração: só na primeira vez.
      for (const f of BACKEND_RUNTIME_FILES) if (f !== "providers.json") fs.copyFileSync(path.join(bundle, f), path.join(d, f));
      if (!fs.existsSync(path.join(d, "providers.json"))) fs.copyFileSync(path.join(bundle, "providers.json"), path.join(d, "providers.json"));
      const apiKey = readOrCreateEnv(d, claude);
      if (state !== undefined) { try { state.child.kill("SIGTERM"); } catch { /* já morto */ } state = undefined; }
      if (await portOpen(localPort())) throw new Error(`A porta ${localPort()} já está em uso neste Mac por outro programa.`);
      onStatus?.("subindo o backend neste Mac…");
      const logFd = fs.openSync(path.join(app.getPath("userData"), "backend-local.log"), "a");
      const extraPath = [path.dirname(node), path.dirname(claude), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");
      const child = spawn(node, [path.join(d, "server.js")], {
        cwd: d, stdio: ["ignore", logFd, logFd],
        env: { ...process.env, HOME, PATH: `${extraPath}:${process.env["PATH"] ?? ""}`, OPENAI_COMPAT_SESSIONS_PATH: path.join(d, "data", "openai-compat-sessions.json") },
      });
      fs.closeSync(logFd);
      const mine: LocalState = { child, apiKey, startedAt: Date.now() };
      state = mine;
      child.on("exit", (code, signal) => {
        log(`backend local pid ${child.pid ?? "?"} saiu após ${Date.now() - mine.startedAt} ms: code=${code} signal=${signal}`);
        if (state === mine) { state = undefined; onExit?.(`backend local saiu (${code ?? signal ?? "?"})`); }
      });
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`O backend local morreu ao iniciar (código ${child.exitCode}). Veja backend-local.log em ${app.getPath("userData")}.`);
        if (await portOpen(localPort())) { log(`backend local pid ${child.pid ?? "?"} pronto em ${Date.now() - mine.startedAt} ms (node=${node} claude=${claude})`); return { localPort: localPort(), apiKey }; }
        await new Promise((r) => setTimeout(r, 200));
      }
      try { child.kill("SIGKILL"); } catch { /* ok */ }
      throw new Error("O backend local não abriu a porta em 12 s.");
    } finally {
      starting = undefined;
    }
  })();
  return starting;
}

export function stopLocalBackend(): void {
  const prev = state;
  state = undefined;
  if (prev === undefined) return;
  try { prev.child.kill("SIGTERM"); } catch { /* já morto */ }
  setTimeout(() => { try { prev.child.kill("SIGKILL"); } catch { /* ok */ } }, 3000).unref();
  log("backend local encerrado");
}

export async function checkLocalBackend(): Promise<boolean> {
  return localBackendAlive() && portOpen(localPort());
}
