/**
 * Sessões de terminal (aba "Terminal"). O PTY nasce onde o shell roda, pelo pty-broker.py (Python, só
 * stdlib): na máquina da janela via ssh (pelo ControlMaster do túnel, sem autenticar de novo) ou neste Mac
 * via /usr/bin/python3. O app e o broker falam frames binários (pty-frames.ts); o xterm no renderer recebe
 * os bytes crus e decodifica UTF-8 sozinho. Nenhum módulo nativo.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";
import { sshMuxArgs } from "../maquina/tunnel";
import { log } from "../maquina/backend";
import { encodeFrame, FrameDecoder, RingBuffer } from "./pty-frames";

interface TermSession {
  id: string;
  host: string;
  winId: number;
  child: ChildProcess;
  ring: RingBuffer;
  exited: number | null;
}

const sessions = new Map<string, TermSession>();
let counter = 0;
/** Por janela: terminais demais é sinal de laço no renderer, não de uso real. */
const MAX_PER_WINDOW = 8;
const RING_BYTES = 256 * 1024;
const LOCAL_PYTHON = "/usr/bin/python3";

let brokerB64: string | null = null;
function brokerSource(): string {
  if (brokerB64 === null) brokerB64 = fs.readFileSync(path.join(__dirname, "pty-broker.py"), "utf8");
  return brokerB64;
}
/** O broker inteiro vai no argv do python3 (base64: sem aspas, sem arquivo remoto). */
const brokerArg = (): string => `import base64;exec(base64.b64decode('${Buffer.from(brokerSource(), "utf8").toString("base64")}'))`;

const SSH_FALLBACK = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3", "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new"];

async function spawnBroker(host: string): Promise<ChildProcess> {
  if (host === LOCAL_HOST) {
    if (!fs.existsSync(LOCAL_PYTHON)) throw new Error("o terminal neste Mac precisa das Ferramentas de Linha de Comando (no Terminal do macOS: xcode-select --install)");
    const shell = process.env["SHELL"] ?? "/bin/zsh";
    return spawn(LOCAL_PYTHON, ["-c", brokerArg(), shell, "-l"], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, SHELL: shell } });
  }
  if (!isValidHost(host)) throw new Error("máquina inválida");
  // Pelo master do túnel quando ele responde (instantâneo); senão, uma conexão própria.
  let args: string[];
  try { args = await sshMuxArgs(host); } catch { args = [...SSH_FALLBACK, "--", host]; }
  return spawn("ssh", [...args, `python3 -c "${brokerArg()}"`], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
}

const sendTo = (winId: number, channel: string, payload: unknown): void => {
  const win = BrowserWindow.fromId(winId);
  if (win !== null && !win.isDestroyed()) win.webContents.send(channel, payload);
};

/** Abre um terminal na máquina `host` para a janela `win`; a saída chega por `term:data`, o fim por `term:exit`. */
export async function openTerminal(win: BrowserWindow, host: string, cols: number, rows: number): Promise<string> {
  const mine = [...sessions.values()].filter((s) => s.winId === win.id && s.exited === null);
  if (mine.length >= MAX_PER_WINDOW) throw new Error(`já há ${MAX_PER_WINDOW} terminais abertos nesta janela`);
  const child = await spawnBroker(host);
  const id = `t${++counter}-${Date.now().toString(36)}`;
  const s: TermSession = { id, host, winId: win.id, child, ring: new RingBuffer(RING_BYTES), exited: null };
  sessions.set(id, s);
  const dec = new FrameDecoder();
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    let frames;
    try { frames = dec.push(chunk); } catch (e) { log(`[term] ${host}: ${e instanceof Error ? e.message : String(e)}`); child.kill("SIGKILL"); return; }
    for (const f of frames) {
      if (f.kind === "o") { s.ring.push(Buffer.from(f.payload)); sendTo(s.winId, "term:data", { id, data: new Uint8Array(f.payload) }); }
      else if (f.kind === "x") { s.exited = Number(f.payload.toString()) || 0; }
    }
  });
  child.stderr?.on("data", (d: Buffer) => { stderr = `${stderr}${d.toString("utf8")}`.slice(-2000); });
  child.stdin?.on("error", () => { /* broker já saiu */ });
  child.on("error", (e) => { log(`[term] ${host}: não iniciou: ${e.message}`); });
  child.on("close", (code) => {
    const exit = s.exited ?? (code ?? 0);
    s.exited = exit;
    const why = stderr.trim().split("\n").filter((l) => l !== "").pop();
    sendTo(s.winId, "term:exit", { id, code: exit, detail: s.exited !== null && why !== undefined && exit !== 0 ? why : null });
    log(`[term] ${host}: sessão ${id} encerrada (código ${exit})`);
  });
  child.stdin?.write(encodeFrame("r", `${Math.max(2, cols)} ${Math.max(2, rows)}`));
  log(`[term] ${host}: sessão ${id} aberta (${cols}x${rows})`);
  return id;
}

/** A sessão existe e é da janela que pediu (nada de uma janela mexer no terminal de outra). */
export function ownedTerminal(id: string, winId: number): TermSession | null {
  const s = sessions.get(id);
  return s !== undefined && s.winId === winId ? s : null;
}

export const writeTerminal = (s: TermSession, data: string | Uint8Array): void => {
  if (s.exited !== null) return;
  s.child.stdin?.write(encodeFrame("i", typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data)));
};
export const resizeTerminal = (s: TermSession, cols: number, rows: number): void => {
  if (s.exited !== null || !Number.isInteger(cols) || !Number.isInteger(rows)) return;
  s.child.stdin?.write(encodeFrame("r", `${Math.min(Math.max(2, cols), 1000)} ${Math.min(Math.max(2, rows), 1000)}`));
};
/** Saída guardada (últimos 256 KiB), para repintar a aba. */
export const replayTerminal = (s: TermSession): Uint8Array => new Uint8Array(s.ring.read());

export function closeTerminal(s: TermSession): void {
  sessions.delete(s.id);
  if (s.exited !== null) return;
  try { s.child.stdin?.write(encodeFrame("k")); s.child.stdin?.end(); } catch { /* já fechado */ }
  const t = setTimeout(() => { if (s.child.exitCode === null) s.child.kill("SIGKILL"); }, 3000);
  s.child.once("close", () => clearTimeout(t));
}

/** Janela fechou: todos os terminais dela vão junto. */
export function closeTerminalsOfWindow(winId: number): void {
  for (const s of [...sessions.values()]) if (s.winId === winId) closeTerminal(s);
}
/** Terminais vivos (para a Terminal API): id, máquina, janela e posição entre os da janela (1 = o mais antigo). */
export function liveTerminals(): { id: string; host: string; winId: number; n: number }[] {
  const out: { id: string; host: string; winId: number; n: number }[] = [];
  const porJanela = new Map<number, number>();
  for (const s of sessions.values()) {
    if (s.exited !== null) continue;
    const n = (porJanela.get(s.winId) ?? 0) + 1; porJanela.set(s.winId, n);
    out.push({ id: s.id, host: s.host, winId: s.winId, n });
  }
  return out;
}
export const terminalById = (id: string): TermSession | null => { const s = sessions.get(id); return s !== undefined && s.exited === null ? s : null; };
/** Espera a janela abrir uma sessão que não está em `antes` (a aba nova pedida pela API). */
export async function waitNewTerminal(winId: number, antes: ReadonlySet<string>, ms = 20_000): Promise<string | null> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    for (const s of sessions.values()) if (s.winId === winId && !antes.has(s.id) && s.exited === null) return s.id;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}
export const terminalsOfWindow = (winId: number): number => [...sessions.values()].filter((s) => s.winId === winId && s.exited === null).length;
