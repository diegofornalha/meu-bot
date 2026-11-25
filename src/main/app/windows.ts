/**
 * Registro de janelas principais: uma por máquina (host). Guarda a última em foco, cria janelas
 * presas a um host, roteia eventos por host e desmonta o túnel de uma máquina com carência quando
 * a última janela dela fecha.
 */
import { molduraDaJanela } from "./moldura-core";
import { BrowserWindow, Menu, nativeTheme, screen, session, shell } from "electron";
import path from "node:path";
import type { MainEventChannel, MainEvents } from "../../shared/ipc";
import { hostBusy } from "../conversa/conversation";
import { getBackendPort, getCorretorOrtografico, getZoomLevel } from "./settings";
import { posicaoNoCanto } from "./janela-core";
import { zoomFactor, zoomState } from "./zoom-core";
import { closeTunnel, ensureTunnel, log } from "../maquina/tunnel";
import { caps } from "./variant";
import { closeTerminalsOfWindow } from "../terminal/terminal";
import { browserForget } from "../navegador/browser";
import { PARTICAO_COMPUTADOR, particaoComputador, urlTelaPermitida } from "../maquina/tela-core";
import { PARTICAO_INSPECTOR, mesmaOrigem, urlInspectorPermitida } from "../inspector/inspector-core";
import { PREFIXO_PARTICAO_DE_EXTENSAO, navegacaoDeExtensaoPermitida } from "../extensao/extensao-core";
import { webviewDaExtensao } from "../extensao/registro";
import { PARTICAO_MODULO, lerAcao, urlNaOrigem } from "../modulos/modulos-pagina-core";
import { paginaRegistrada, particoesDaMaquina } from "../modulos/modulos";

export type OpenOrigin = "startup" | "picker" | "notify" | "quick" | "menu" | "shortcut";

const byId = new Map<number, { win: BrowserWindow; host: string }>();
let lastFocusedId: number | null = null;
let lastFocusedHost: string | null = null;
const graceTimers = new Map<string, NodeJS.Timeout>();

/** Carência antes de derrubar o túnel de uma máquina sem janela. */
const GRACE_MS = 5 * 60_000;
/** Largura mínima da janela de uma máquina (lateral + conteúdo); o seletor abre nela, para as duas baterem. */
export const MIN_WINDOW_WIDTH = 640;

/** Cor de fundo igual ao --bg do CSS, para não piscar branco antes do primeiro paint. */
export const backgroundColor = (): string => (nativeTheme.shouldUseDarkColors ? "#111317" : "#f5f6f8");

export const windowForHost = (host: string): BrowserWindow | undefined => {
  for (const e of byId.values()) if (e.host === host && !e.win.isDestroyed()) return e.win;
  return undefined;
};
export const hostOfWindow = (win: BrowserWindow): string | undefined => byId.get(win.id)?.host;
export const allMainWindows = (): BrowserWindow[] => [...byId.values()].filter((e) => !e.win.isDestroyed()).map((e) => e.win);
export const getLastFocusedHost = (): string | null => lastFocusedHost;

/** Última janela em foco ainda viva; senão qualquer janela principal viva. */
export function lastFocusedWindow(): BrowserWindow | null {
  if (lastFocusedId !== null) {
    const e = byId.get(lastFocusedId);
    if (e !== undefined && !e.win.isDestroyed()) return e.win;
  }
  return allMainWindows()[0] ?? null;
}

export function sendToHost<K extends MainEventChannel>(host: string, channel: K, payload: MainEvents[K]): void {
  for (const e of byId.values()) if (e.host === host && !e.win.isDestroyed()) e.win.webContents.send(channel, payload);
}

export function broadcast<K extends MainEventChannel>(channel: K, payload: MainEvents[K]): void {
  for (const e of byId.values()) if (!e.win.isDestroyed()) e.win.webContents.send(channel, payload);
}

/** Envia quando a página terminar de carregar (janela recém-criada ainda não tem listeners). */
export function sendWhenLoaded<K extends MainEventChannel>(win: BrowserWindow, channel: K, payload: MainEvents[K]): void {
  if (win.isDestroyed()) return;
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", () => { if (!win.isDestroyed()) win.webContents.send(channel, payload); });
  else win.webContents.send(channel, payload);
}

function cancelHostTeardown(host: string): void {
  const t = graceTimers.get(host);
  if (t !== undefined) { clearTimeout(t); graceTimers.delete(host); }
}

/** Sem janela da máquina: derruba o túnel depois da carência, a menos que haja turno/resumo em curso. */
function scheduleHostTeardown(host: string): void {
  cancelHostTeardown(host);
  graceTimers.set(host, setTimeout(() => {
    graceTimers.delete(host);
    if (windowForHost(host) !== undefined) return;
    if (hostBusy(host)) { log(`[${host}] carência: ainda ocupado; adiando o desmonte`); scheduleHostTeardown(host); return; }
    log(`[${host}] carência vencida sem janela; fechando o túnel`);
    closeTunnel(host);
  }, GRACE_MS));
}

/**
 * Toda janela de máquina nasce igual ao seletor: bem colada à direita da tela onde está o cursor, de cima até o Dock,
 * na largura mínima (27 out). Com o canto já ocupado por outra janela de máquina, cola à esquerda dela. Não lembra
 * mais onde ficou: abrir é sempre no padrão; durante o uso dá para mover e redimensionar.
 */
function initialBounds(): Electron.Rectangle {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return posicaoNoCanto(area, MIN_WINDOW_WIDTH, allMainWindows().map((x) => x.getBounds()));
}

/** Abre (ou foca) a janela principal da máquina. Pré-aquece o túnel em background. */
export function openMainWindow(host: string, origin: OpenOrigin): BrowserWindow {
  const existing = windowForHost(host);
  if (existing !== undefined) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }
  cancelHostTeardown(host);
  const win = new BrowserWindow({
    ...initialBounds(),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: 480,
    title: `${caps().titulo} · ${host}`,
    ...molduraDaJanela(caps().semaforoNaBarra),
    backgroundColor: backgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Corretor ortográfico enquanto se digita, como no Grok Bot. Os campos que não querem (endereço, código
      // colado, chave) continuam marcados com spellcheck="false" no próprio HTML, que vence esta preferência.
      spellcheck: getCorretorOrtografico(),
      // Aba Navegador: as abas internas são <webview> (como no Rambox), na partição da máquina.
      webviewTag: true,
      // Zoom da interface (Cmd+= / Cmd+-): já nasce no nível guardado, como o Cursor faz com window.zoomLevel.
      zoomFactor: zoomFactor(getZoomLevel()),
    },
  });
  byId.set(win.id, { win, host });
  ligarMenuDeTexto(win);
  // Busca na página: o Chromium responde a cada findInPage por aqui, e a barra do renderer mostra "n de N".
  win.webContents.on("found-in-page", (_e, r) => {
    if (win.isDestroyed()) return;
    win.webContents.send("find:result", { atual: r.activeMatchOrdinal, total: r.matches });
  });
  // Reforça assim que o DOM existe: o Electron guarda níveis por página em <userData>/Preferences e o zoomFactor inicial é
  // só o padrão quando não há entrada; o settings.json é que manda. Os scripts (type=module) já rodaram: o renderer ouve.
  win.webContents.once("dom-ready", () => {
    if (win.isDestroyed()) return;
    win.webContents.setZoomLevel(getZoomLevel());
    win.webContents.send("window:zoom-changed", zoomState(getZoomLevel()));
  });
  lastFocusedId = win.id;
  lastFocusedHost = host;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  // Computador: o <webview> da tela do bot só carrega o noVNC do forward local, sem preload, e não navega para fora.
  win.webContents.on("will-attach-webview", (event, prefs, params) => {
    // Inspector: o <webview> só existe no produto com a capacidade e só carrega a interface em 127.0.0.1, sem preload.
    if (params.partition === PARTICAO_INSPECTOR) {
      if (!caps().inspector || params.src === undefined || !urlInspectorPermitida(params.src)) { event.preventDefault(); return; }
      delete prefs.preload;
      prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true; prefs.webSecurity = true;
      return;
    }
    // Página própria de um derivado: só a partição que a extensão declarou no `ativar` (sempre `ext-…`, em memória) e
    // só a URL que o predicado dela aceita (http/https, conferido no core); sem preload, como o Inspector. Partição
    // `ext-…` sem extensão que a tenha declarado não anexa.
    if (params.partition?.startsWith(PREFIXO_PARTICAO_DE_EXTENSAO) === true) {
      const ext = webviewDaExtensao();
      if (ext === null || params.partition !== ext.particao || params.src === undefined || !ext.urlPermitida(params.src)) { event.preventDefault(); return; }
      delete prefs.preload;
      prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true; prefs.webSecurity = true;
      return;
    }
    // Página de módulo: só a partição que o app abriu para esta máquina (abrirPaginaModulo) e só a origem do forward dela.
    if (params.partition?.startsWith(PARTICAO_MODULO) === true) {
      const reg = paginaRegistrada(params.partition);
      if (reg === null || reg.host !== host || params.src === undefined || !urlNaOrigem(params.src, reg.origem)) { event.preventDefault(); return; }
      delete prefs.preload;
      prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true; prefs.webSecurity = true;
      return;
    }
    if (params.partition?.startsWith(PARTICAO_COMPUTADOR) !== true) return;
    if (params.partition !== particaoComputador(host) || params.src === undefined || !urlTelaPermitida(params.src)) { event.preventDefault(); return; }
    delete prefs.preload;
    prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true; prefs.webSecurity = true;
  });
  win.webContents.on("did-attach-webview", (_event, guest) => {
    // Inspector: a interface não sai da própria origem; links de fora (documentação) abrem no navegador do sistema.
    if (caps().inspector && guest.session === session.fromPartition(PARTICAO_INSPECTOR)) {
      const dentro = (url: string): boolean => { const atual = guest.getURL(); return atual === "" ? urlInspectorPermitida(url) : mesmaOrigem(url, atual); };
      guest.on("will-navigate", (e, url) => { if (!dentro(url)) e.preventDefault(); });
      guest.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: "deny" }; });
      return;
    }
    // Página própria de um derivado: as mesmas regras do Inspector. Não sai da origem em que está; links https de fora
    // abrem no navegador do sistema.
    const ext = webviewDaExtensao();
    if (ext !== null && guest.session === session.fromPartition(ext.particao)) {
      guest.on("will-navigate", (e, url) => { if (!navegacaoDeExtensaoPermitida(url, guest.getURL(), ext.urlPermitida)) e.preventDefault(); });
      guest.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: "deny" }; });
      return;
    }
    // Página de módulo: não sai da origem do forward; links https de fora abrem no navegador do sistema.
    const pag = particoesDaMaquina(host).find((p) => guest.session === session.fromPartition(p));
    if (pag !== undefined) {
      guest.on("will-navigate", (e, url) => { const reg = paginaRegistrada(pag); if (reg === null || !urlNaOrigem(url, reg.origem)) e.preventDefault(); });
      // A única ponte da página com o app: `/__meu-bot/acao?…` na própria origem (lista fechada em lerAcao).
      guest.setWindowOpenHandler(({ url }) => {
        const reg = paginaRegistrada(pag);
        const a = reg === null ? null : lerAcao(url, reg.origem);
        if (a !== null && reg !== null) { if (!win.isDestroyed()) win.webContents.send("modulos:acao", { id: reg.id, rotulo: reg.rotulo, ...a }); }
        else if (/^https:\/\//.test(url)) void shell.openExternal(url);
        return { action: "deny" };
      });
      return;
    }
    if (guest.session !== session.fromPartition(particaoComputador(host))) return;
    guest.on("will-navigate", (e, url) => { if (!urlTelaPermitida(url)) e.preventDefault(); });
    guest.setWindowOpenHandler(() => ({ action: "deny" }));
  });
  win.on("focus", () => { lastFocusedId = win.id; lastFocusedHost = host; });
  win.on("closed", () => {
    closeTerminalsOfWindow(win.id);
    browserForget(win.id);
    byId.delete(win.id);
    if (lastFocusedId === win.id) lastFocusedId = null;
    if (windowForHost(host) === undefined) scheduleHostTeardown(host);
  });
  void win.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
  log(`[${host}] janela aberta (${origin})`);
  // Pré-aquecimento: a primeira mensagem não espera o SSH. Erro aqui só pinta o pill; o envio tenta de novo.
  // O admin só lê e roda ações por SSH: nada de túnel para o backend da pessoa.
  if (caps().tunnel) void ensureTunnel(host, getBackendPort(host)).catch((e) => log(`[${host}] pré-aquecimento falhou: ${e instanceof Error ? e.message : String(e)}`));
  return win;
}

/** Sai do app sem deixar timers de carência pendurados. */
export function disposeWindows(): void {
  for (const t of graceTimers.values()) clearTimeout(t);
  graceTimers.clear();
}

/** No macOS o app vive sem janelas; o Dock reabre pelo seletor. */
export const hasMainWindows = (): boolean => allMainWindows().length > 0;

/**
 * Menu do botão direito num campo de texto: as sugestões do corretor, "Adicionar ao dicionário" e os comandos de
 * edição. Sem isto o corretor só sublinharia o erro, sem dar o que fazer com ele. Só em campo editável: em cima do
 * resto da interface o menu nativo do Chromium (copiar, inspecionar) continua valendo.
 */
function ligarMenuDeTexto(win: BrowserWindow): void {
  win.webContents.on("context-menu", (_e, params) => {
    if (!params.isEditable) return;
    const sessao = win.webContents.session;
    const itens: Electron.MenuItemConstructorOptions[] = [
      ...params.dictionarySuggestions.map((sugestao) => ({ label: sugestao, click: () => win.webContents.replaceMisspelling(sugestao) })),
      ...(params.dictionarySuggestions.length > 0 ? [{ type: "separator" as const }] : []),
      ...(params.misspelledWord === "" ? [] : [
        { label: params.dictionarySuggestions.length === 0 ? "Nenhuma sugestão" : "Adicionar ao dicionário", enabled: params.dictionarySuggestions.length > 0 || params.misspelledWord !== "", click: () => { void sessao.addWordToSpellCheckerDictionary(params.misspelledWord); } },
        { type: "separator" as const },
      ]),
      { role: "undo", label: "Desfazer" },
      { role: "redo", label: "Refazer" },
      { type: "separator" },
      { role: "cut", label: "Recortar" },
      { role: "copy", label: "Copiar" },
      { role: "paste", label: "Colar" },
      { role: "selectAll", label: "Selecionar tudo" },
    ];
    Menu.buildFromTemplate(itens).popup({ window: win });
  });
}
