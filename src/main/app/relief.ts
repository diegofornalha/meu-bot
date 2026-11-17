/**
 * Janela "aliviar <host>": envia o alivio-pod.sh por SSH (fica em ~/bin do host) e o roda, mostra
 * etapas e números de antes/depois, e no fim abre a janela principal da máquina e se fecha. É o que
 * o botão "aliviar grokbot-1.app" da mesa chama, via `--alivio=<host>` (second-instance).
 */
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ReliefEvent } from "../../shared/ipc";
import { isValidHost } from "./settings";
import { backgroundColor, openMainWindow } from "./windows";
import { openGrokbotReset } from "./grokbot";
import { tailscaleCheckUrl } from "../maquina/hostProbe";

let reliefWin: BrowserWindow | null = null;
let running = false;
/** A pessoa clicou "Abrir agora" antes da contagem acabar: a contagem para. */
let resetOpenedByHand = false;

const SSH_OPTS = [
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=90", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3",
  "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new",
];

/** scripts/alivio/alivio-pod.sh: Resources/alivio no .app; pasta do projeto no dev. */
function reliefScript(): string {
  const p = app.isPackaged ? path.join(process.resourcesPath, "alivio", "alivio-pod.sh") : path.join(app.getAppPath(), "scripts", "alivio", "alivio-pod.sh");
  return fs.readFileSync(p, "utf8");
}

function send(ev: ReliefEvent): void {
  if (reliefWin !== null && !reliefWin.isDestroyed()) reliefWin.webContents.send("relief:event", ev);
}

/** "carga 0.94, 1.39, 10.35 | memória disponível 7017 MB | em disco (D): 0" → números. */
function parseStats(line: string): { load: string; memMb: number | null } | null {
  const m = /carga ([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(line);
  if (m === null) return null;
  const mem = /memória disponível (\d+) MB/.exec(line);
  return { load: `${m[1]} · ${m[2]} · ${m[3]}`, memMb: mem === null ? null : Number(mem[1]) };
}

async function runRelief(host: string): Promise<void> {
  running = true;
  const t0 = Date.now();
  send({ kind: "step", step: "connect", state: "doing", text: `conectando a ${host} por SSH (até 90 s se o pod estiver no limite)` });
  // O script vai junto pelo stdin e é gravado em ~/bin do pod antes de rodar: serve para qualquer
  // computador do Grok Bot sem instalação prévia, e a cópia de lá fica sempre igual à do app.
  const child = spawn("ssh", [...SSH_OPTS, "--", host, "mkdir -p ~/bin && cat > ~/bin/alivio-pod.sh && bash ~/bin/alivio-pod.sh --tailscale"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => { /* o ssh caiu antes de ler o script; o close abaixo reporta */ });
  child.stdin.end(reliefScript());
  let stderr = ""; let buf = ""; let connected = false; let before: ReturnType<typeof parseStats> = null; let after: ReturnType<typeof parseStats> = null;
  let timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ok */ } }, 150_000);
  let checkOpened = false;
  child.stderr.on("data", (d: Buffer) => {
    stderr += d.toString("utf8");
    // O Tailscale SSH pediu verificação: o link vale só para esta sessão, então abrimos já e esperamos.
    const url = tailscaleCheckUrl(stderr);
    if (url !== null && !checkOpened) {
      checkOpened = true;
      void shell.openExternal(url);
      clearTimeout(timer);
      timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ok */ } }, 300_000); // tempo para a pessoa aprovar
      send({ kind: "step", step: "connect", state: "doing", text: "o Tailscale SSH pede verificação: abri o link no navegador, aprove lá (espero até 5 min)" });
    }
  });
  child.stdout.on("data", (d: Buffer) => {
    buf += d.toString("utf8");
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line === "") continue;
      if (!connected) { connected = true; send({ kind: "step", step: "connect", state: "done", text: `conectado em ${((Date.now() - t0) / 1000).toFixed(1)} s` }); send({ kind: "step", step: "clean", state: "doing", text: "limpando processos presos" }); }
      send({ kind: "log", text: line });
      if (line.startsWith("antes:")) { before = parseStats(line); if (before !== null) send({ kind: "stats", which: "before", ...before }); }
      if (line.startsWith("encerrados:")) send({ kind: "step", step: "clean", state: "done", text: line.replace(/^encerrados:\s*/, "") });
      if (line.startsWith("tailscaled:")) send({ kind: "step", step: "tailscale", state: /não achei/.test(line) ? "fail" : "doing", text: line.replace(/^tailscaled:\s*/, "") });
      if (line.startsWith("depois:")) { after = parseStats(line); if (after !== null) send({ kind: "stats", which: "after", ...after }); }
    }
  });
  const code: number | null = await new Promise((resolve) => { child.on("error", () => resolve(null)); child.on("close", (c) => resolve(c)); });
  clearTimeout(timer);
  if (!connected || code !== 0) {
    const why = stderr.trim().split("\n").pop() ?? "";
    if (checkOpened && !connected) {
      // Não é pod congelado: faltou aprovar a verificação do Tailscale. Sem contagem para o reset.
      send({ kind: "step", step: "connect", state: "fail", text: "a verificação do Tailscale não foi aprovada a tempo" });
      send({ kind: "done", ok: false, text: "Aprove o link do Tailscale no navegador e rode o alívio de novo. Isso não é caso de reset." });
      running = false;
      return;
    }
    send({ kind: "step", step: "connect", state: "fail", text: connected ? `o alívio terminou com erro (${code ?? "sem código"})` : `o ssh não entrou: ${why || "tempo esgotado"}` });
    send({ kind: "done", ok: false, text: "O pod pode estar congelado pelo host. Aí o que resolve é reiniciar o computador pelo app do Grok Bot." });
    running = false;
    // Contagem e abre o app do Grok Bot no card Reset sozinho; fechar a janela cancela. O reset em si
    // continua sendo o clique da pessoa no botão vermelho de lá.
    const win = reliefWin;
    for (let s = 6; s >= 1; s--) {
      if (win === null || win.isDestroyed() || resetOpenedByHand) return;
      send({ kind: "reset-countdown", seconds: s });
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (win === null || win.isDestroyed() || resetOpenedByHand) return;
    send({ kind: "reset-opened", ok: await openGrokbotReset() });
    return;
  }
  send({ kind: "step", step: "tailscale", state: "done", text: "tailscaled reiniciando em segundo plano" });
  send({ kind: "step", step: "open", state: "doing", text: "esperando o Tailscale voltar" });
  for (let s = 8; s >= 1; s--) { send({ kind: "countdown", seconds: s }); await new Promise((r) => setTimeout(r, 1000)); }
  send({ kind: "step", step: "open", state: "done", text: `abrindo o meu-bot na ${host}` });
  send({ kind: "done", ok: true, text: "pronto" });
  openMainWindow(host, "shortcut");
  running = false;
  setTimeout(() => { if (reliefWin !== null && !reliefWin.isDestroyed()) reliefWin.close(); }, 900);
}

export function initRelief(): void {
  ipcMain.on("relief:close", (event) => { if (reliefWin !== null && event.sender === reliefWin.webContents) reliefWin.close(); });
  ipcMain.handle("relief:open-reset", (event) => {
    if (reliefWin === null || event.sender !== reliefWin.webContents) throw new Error("origem inválida");
    resetOpenedByHand = true;
    return openGrokbotReset();
  });
}

/** Abre a janela de alívio e dispara o processo (uma por vez). */
export function showRelief(host: string): void {
  if (!isValidHost(host)) return;
  if (reliefWin !== null && !reliefWin.isDestroyed()) { reliefWin.show(); reliefWin.focus(); return; }
  const win = new BrowserWindow({
    width: 560, height: 520, resizable: false, minimizable: true, title: `aliviar ${host}`,
    titleBarStyle: "hiddenInset", backgroundColor: backgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "relief-preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false,
    },
  });
  // Zoom isolado em 100%: o zoom da janela principal (Cmd+=) não vaza para esta janela de tamanho fixo.
  win.webContents.setZoomMode("isolated"); win.webContents.setZoomLevel(0);
  reliefWin = win;
  resetOpenedByHand = false;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.on("closed", () => { if (reliefWin === win) reliefWin = null; });
  win.webContents.once("did-finish-load", () => {
    if (win.isDestroyed()) return;
    win.webContents.send("relief:event", { kind: "init", host } satisfies ReliefEvent);
    if (!running) void runRelief(host);
  });
  void win.loadFile(path.join(__dirname, "..", "..", "renderer", "relief.html"));
}
