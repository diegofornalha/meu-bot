/** Janela flutuante de entrada rápida, aberta por atalho global (ideia do Hermes Desktop). */
import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, screen } from "electron";
import path from "node:path";
import { parseAccelerator } from "./accelerator";
import type { QuickEntryStatus } from "../../shared/ipc";

let quickWin: BrowserWindow | null = null;
let registered: string | null = null;
let status: QuickEntryStatus = "disabled";
let getMainWindow: (() => BrowserWindow | null) | null = null;
const pendingAcks = new Map<string, { resolve: (r: { ok: boolean; message?: string }) => void; timer: NodeJS.Timeout; senderId: number }>();
let getHostLabel: ((win: BrowserWindow) => string) | null = null;
let counter = 0;

export const quickEntryStatus = (): QuickEntryStatus => status;

export function initQuickEntry(deps: { mainWindow: () => BrowserWindow | null; hostLabel?: (win: BrowserWindow) => string }): void {
  getMainWindow = deps.mainWindow;
  getHostLabel = deps.hostLabel ?? null;
  ipcMain.handle("quick:submit", async (event, payload: unknown) => {
    if (quickWin === null || event.sender !== quickWin.webContents) return { ok: false, message: "origem inválida" };
    const text = typeof (payload as { text?: unknown })?.text === "string" ? (payload as { text: string }).text.trim() : "";
    if (text === "") return { ok: false, message: "mensagem vazia" };
    return relayToMain(text);
  });
  ipcMain.on("quick:hide", (event) => { if (quickWin !== null && event.sender === quickWin.webContents) quickWin.hide(); });
  ipcMain.on("quick:ack", (event, payload: unknown) => {
    const p = payload as { correlationId?: unknown; ok?: unknown; message?: unknown };
    if (typeof p?.correlationId !== "string") return;
    const pending = pendingAcks.get(p.correlationId);
    // Só a janela que recebeu o pedido confirma; o foco pode ter mudado de janela nesse meio-tempo.
    if (pending === undefined || event.sender.id !== pending.senderId) return;
    clearTimeout(pending.timer);
    pendingAcks.delete(p.correlationId);
    pending.resolve({ ok: p.ok === true, ...(typeof p.message === "string" ? { message: p.message } : {}) });
  });
}

/** Manda o texto para a janela principal e espera a confirmação dela (8 s). */
async function relayToMain(text: string): Promise<{ ok: boolean; message?: string }> {
  const main = getMainWindow?.();
  if (main === undefined || main === null) return { ok: false, message: "janela principal indisponível" };
  if (main.webContents.isLoading()) await new Promise<void>((r) => main.webContents.once("did-finish-load", () => r()));
  const correlationId = `q${Date.now()}-${++counter}`;
  const result = new Promise<{ ok: boolean; message?: string }>((resolve) => {
    const timer = setTimeout(() => { pendingAcks.delete(correlationId); resolve({ ok: false, message: "A janela principal não confirmou." }); }, 8000);
    pendingAcks.set(correlationId, { resolve, timer, senderId: main.webContents.id });
  });
  main.webContents.send("ui:quick-submit", { correlationId, text });
  const r = await result;
  if (r.ok) {
    quickWin?.hide();
    main.show();
    main.focus();
    app.focus({ steal: true });
  }
  return r;
}

function createQuickWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 560, height: 132, show: false, frame: false, resizable: false, movable: true, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, hiddenInMissionControl: true, type: "panel",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1a1d23" : "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "quick-entry-preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false,
    },
  });
  win.setAlwaysOnTop(true, "floating");
  // Zoom isolado em 100%: o zoom da janela principal (Cmd+=) não vaza para esta janela de tamanho fixo.
  win.webContents.setZoomMode("isolated"); win.webContents.setZoomLevel(0);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.on("blur", () => { if (!win.isDestroyed()) win.hide(); });
  win.on("closed", () => { if (quickWin === win) quickWin = null; });
  void win.loadFile(path.join(__dirname, "..", "..", "renderer", "quick-entry.html"));
  return win;
}

export function toggleQuickEntry(): void {
  if (quickWin === null || quickWin.isDestroyed()) quickWin = createQuickWindow();
  if (quickWin.isVisible()) { quickWin.hide(); return; }
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const [w, h] = quickWin.getSize();
  const x = Math.round(workArea.x + (workArea.width - (w ?? 560)) / 2);
  const y = Math.round(workArea.y + workArea.height * 0.22);
  quickWin.setPosition(Math.max(workArea.x, x), Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - (h ?? 132))));
  quickWin.show();
  quickWin.focus();
  quickWin.webContents.send("quick:shown", {});
  const target = getMainWindow?.();
  quickWin.webContents.send("quick:appearance", target !== undefined && target !== null && getHostLabel !== null ? { host: getHostLabel(target) } : {});
}

/** (Re)registra o atalho conforme as configurações; devolve o status para a UI. */
export function applyQuickEntryShortcut(enabled: boolean, shortcut: string): QuickEntryStatus {
  if (registered !== null) { globalShortcut.unregister(registered); registered = null; }
  if (!enabled) { status = "disabled"; return status; }
  const acc = parseAccelerator(shortcut);
  if (acc === null) { status = "invalid"; return status; }
  if (globalShortcut.isRegistered(acc)) { status = "taken"; return status; }
  const ok = globalShortcut.register(acc, () => toggleQuickEntry());
  if (!ok) { status = "taken"; return status; }
  registered = acc;
  status = "registered";
  return status;
}

export function disposeQuickEntry(): void {
  globalShortcut.unregisterAll();
  registered = null;
  if (quickWin !== null && !quickWin.isDestroyed()) quickWin.destroy();
  quickWin = null;
}
