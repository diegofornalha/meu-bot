/**
 * Aba "Navegador" (módulo Pro), feita como no Rambox: cada aba interna é um `<webview>` no DOM da janela
 * (nada de view nativa por cima: modais, paleta e lateral cobrem e empurram como qualquer elemento), todas na
 * mesma sessão da máquina (`persist:navegador-<host>`: cookies e extensões separados do app e de outras máquinas).
 * Aqui no main fica o que o DOM não faz: preparar a sessão (permissões fechadas, User-Agent sem a assinatura do
 * Electron, Chrome Web Store ligada pelo electron-chrome-web-store, como no Rambox), listar/remover extensões, e
 * tratar os webviews dessa sessão quando nascem (`web-contents-created`): janelas novas viram abas internas,
 * Cmd+… volta para o app. Os webviews não têm preload do app: o conteúdo web não fala IPC com o meu-bot.
 */
import { BrowserWindow, app, session, shell, type Session, type WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";
import { installChromeWebStore, installExtension, uninstallExtension } from "electron-chrome-web-store";
import { log, onReverseState, reversePort, setReverseWanted } from "../maquina/tunnel";
import { navSocketPath, startNavApi, stopNavApi } from "./nav-api";
import { addNavFavorito, isNavAgentHost, navEspacos, navFavoritos, removeNavFavorito, setNavAgentHost, setNavEspacos } from "../app/settings";
import type { BrowserAgentState, DonoInfo } from "../../shared/ipc";
import { esquecerAba, pedirPermissao, permissaoJaDada } from "./nav-permissoes";
import { origemDe, tiposDe } from "./nav-permissoes-core";
import type { BrowserExtensionInfo, BrowserOpenInfo, NavFavorito, NavWorkspaces } from "../../shared/ipc";
import { carregarExtensoes, extensaoEmbutida, sincronizarExtensaoCrm } from "../extensao-gmail/extensao";
import { crmDaMaquinaOk, crmProprioOk, type LicencaDaMaquina } from "../licenca/licenca";
import { stopExtensaoApi } from "../extensao-gmail/extensao-api";
import { pararSincronizacaoGoogle } from "../google/google";
import { gravarPortaNavegador } from "./navegador-whatsapp";
import { spawn } from "node:child_process";
import { sshMuxArgs } from "../maquina/tunnel";
import { LOCAL_HOST } from "../maquina/localBackend";
import { caps } from "../app/variant";

const PART_PREFIX = "persist:navegador-";
const sanit = (host: string): string => host.replace(/[^A-Za-z0-9_-]/g, "_");
export const partitionOf = (host: string): string => `${PART_PREFIX}${sanit(host)}`;
const extensionsDir = (host: string): string => path.join(app.getPath("userData"), "Navegador", sanit(host), "Extensions");
const hostOfPartition = (part: string): string | null => (part.startsWith(PART_PREFIX) ? part.slice(PART_PREFIX.length) : null);

const readySessions = new Map<string, Promise<void>>();
/**
 * Login do Google: mesmo sem "Electron" no User-Agent, o Google vê o app embutido pelas client hints (Sec-CH-UA traz
 * "Chromium" sem "Google Chrome") e recusa ("Esse navegador ou app pode não ser seguro"). Só em accounts.google.com
 * o Navegador se apresenta como Firefox (que não manda client hints), no cabeçalho e no navigator.userAgent; fora
 * dele, nada muda. É o que o Ferdium e o Rambox fazem. Versão do Firefox ≈ a do Chromium embutido + 1 (mesma época).
 */
const GOOGLE_LOGIN = /^https:\/\/accounts\.google\.com\//;
const FIREFOX_UA = (() => { const v = Number.parseInt(process.versions.chrome ?? "130", 10) + 1; return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`; })();
/**
 * Retorno de login de CLI (wrangler login, gh auth, claude…): a página manda o navegador para http://localhost:<porta>/…,
 * onde a CLI espera. A CLI roda NA MÁQUINA (terminal por SSH), mas o Navegador está no Mac: o retorno caía no Mac e o
 * login nunca terminava. Na janela de uma máquina por SSH, esse retorno é entregue lá (curl pela conexão SSH) e a aba
 * segue para a página que a CLI devolver (ou mostra o resultado).
 */
const RETORNO_LOCAL = /^http:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}\/\S*$/;
const pareceRetorno = (url: string): boolean => RETORNO_LOCAL.test(url) && /[?&](code|token|state|oauth_token)=|callback|oauth|auth/i.test(url);
/**
 * Portas de loopback que são do PRÓPRIO app neste Mac (o OAuth do Google: contatos do CRM e a Conta Google, que
 * sobem um http.Server em 127.0.0.1 na main). O retorno delas tem de chegar nesse servidor local, não ser entregue
 * por SSH na máquina remota (isso é só para login de CLI que roda lá). Cada fluxo reserva a sua porta enquanto o
 * servidor escuta e libera ao fechar.
 */
const portasLocaisDoApp = new Set<number>();
export function reservarRetornoLocal(port: number): () => void { portasLocaisDoApp.add(port); return () => { portasLocaisDoApp.delete(port); }; }
const portaDe = (url: string): number => { try { return Number(new URL(url).port) || 0; } catch { return 0; } }
function entregarNaMaquina(host: string, url: string): Promise<{ code: number; location: string | null; erro: string | null }> {
  return sshMuxArgs(host).then((args) => new Promise((resolve) => {
    const b64 = Buffer.from(url, "utf8").toString("base64");
    const child = spawn("ssh", [...args, "bash -s"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; const t = setTimeout(() => child.kill("SIGKILL"), 40_000);
    child.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.on("close", () => { clearTimeout(t); const m = /^(\d{3})\s(.*)$/m.exec(out.trim()); resolve(m ? { code: Number(m[1]), location: m[2]!.trim() || null, erro: null } : { code: 0, location: null, erro: "a máquina não respondeu (a CLI ainda está esperando o login?)" }); });
    child.on("error", (e) => { clearTimeout(t); resolve({ code: 0, location: null, erro: e.message }); });
    child.stdin.on("error", () => { /* o ssh saiu antes de ler (EPIPE) */ });
    child.stdin.end(`U=$(printf '%s' '${b64}' | base64 -d); curl -s -m 30 -o /dev/null -w '%{http_code} %{redirect_url}\\n' -- "$U"\n`);
  }));
}
const paginaRetorno = (host: string, ok: boolean, texto: string): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>${ok ? "Login concluído" : "Login não concluído"}</title><body style="font:16px system-ui;display:grid;place-items:center;min-height:90vh;color:#333"><div style="max-width:30rem;text-align:center"><h2>${ok ? "✓ Login concluído" : "✗ Login não concluído"}</h2><p>${texto.replace(/[<>&]/g, "")}</p><p style="color:#888">Retorno entregue na máquina ${host.replace(/[<>&]/g, "")}. Pode voltar ao terminal.</p></div>`)}`;
function retornoParaMaquina(wc: WebContents, host: string): void {
  if (host === LOCAL_HOST) return;
  const tratar = (ev: Electron.Event, arg?: unknown): void => {
    const url = typeof arg === "string" ? arg : (ev as unknown as { url?: string }).url ?? "";
    if (!pareceRetorno(url)) return;
    if (portasLocaisDoApp.has(portaDe(url))) return; // loopback do próprio app (OAuth do Google): deixa chegar no servidor local do Mac
    ev.preventDefault();
    log(`[navegador ${host}] retorno de login para ${url.split("?")[0]}: entregando na máquina`);
    void entregarNaMaquina(host, url).then((r) => {
      if (wc.isDestroyed()) return;
      log(`[navegador ${host}] retorno de login: HTTP ${r.code}${r.erro ? ` (${r.erro})` : ""}`);
      if (r.location !== null && /^https:\/\//.test(r.location)) void wc.loadURL(r.location);
      else void wc.loadURL(paginaRetorno(host, r.code >= 200 && r.code < 400, r.erro ?? `A ferramenta na máquina respondeu (HTTP ${r.code}).`));
    });
  };
  wc.on("will-navigate", tratar);
  wc.on("will-redirect", tratar);
  wc.on("did-create-window", (child) => retornoParaMaquina(child.webContents, host));
}
/** Troca o navigator.userAgent da aba (ou do popup de login) ao entrar e ao sair do login do Google. */
function googleLoginUa(wc: WebContents): void {
  const normal = wc.session.getUserAgent();
  wc.on("did-start-navigation", (ev) => {
    const d = ev as unknown as { url?: string; isMainFrame?: boolean };
    if (d.isMainFrame !== true || typeof d.url !== "string") return;
    const want = GOOGLE_LOGIN.test(d.url) ? FIREFOX_UA : normal;
    if (wc.getUserAgent() !== want) wc.setUserAgent(want);
  });
  wc.on("did-create-window", (child) => googleLoginUa(child.webContents));
}
const POLYFILL_MARK = "/*meu-bot-polyfill v3*/";
const POLYFILL_END = "/*meu-bot-polyfill:fim*/";
/** O polyfill como script puro: o tsc emite cabeçalho CommonJS (`exports`), que não existe num service worker. */
const polyfillSource = (): string => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "..", "preload", "ext-polyfill.js"), "utf8");
    const body = raw.split("\n").filter((l) => !/^Object\.defineProperty\(exports,/.test(l) && !/^exports\./.test(l) && !/^module\.exports/.test(l)).join("\n");
    return `${POLYFILL_MARK}\n${body}\n${POLYFILL_END}\n`;
  } catch { return ""; }
};
/** Tira um polyfill antigo (com marcador de fim) ou um da versão 1 (sem fim: o texto era o atual menos o cabeçalho). */
function stripOldPolyfill(cur: string): string | null {
  if (cur.startsWith(POLYFILL_MARK)) return null; // já é a versão atual
  const end = cur.indexOf(POLYFILL_END);
  if (cur.startsWith("/*meu-bot-polyfill") && end >= 0) return cur.slice(end + POLYFILL_END.length).replace(/^\n/, "");
  return cur.startsWith("/*meu-bot-polyfill") ? "" : cur; // v1 sem fim: não dá para separar; pede reinstalação
}
/**
 * Prepara os arquivos de uma extensão para rodar no Electron: o polyfill entra no começo do service worker e, por
 * um <script> próprio, nas páginas (popup, opções). Devolve true se mudou algo (então a extensão precisa recarregar).
 */
export function patchExtensionFiles(host: string, ext: Pick<Electron.Extension, "id" | "path" | "name" | "version" | "manifest">): boolean {
  const src = polyfillSource(); if (src === "") return false;
  const m = ext.manifest as { background?: { service_worker?: string; scripts?: string[] }; action?: { default_popup?: string }; options_page?: string; options_ui?: { page?: string }; content_scripts?: { js?: string[]; world?: string }[] };
  let changed = false;
  const inDir = (rel: string): string | null => { const f = path.resolve(ext.path, rel.replace(/^\//, "")); return f.startsWith(path.resolve(ext.path) + path.sep) ? f : null; };
  const sw = typeof m.background?.service_worker === "string" ? inDir(m.background.service_worker) : null;
  if (sw !== null && fs.existsSync(sw)) {
    const cur = fs.readFileSync(sw, "utf8");
    const base = stripOldPolyfill(cur);
    if (base === "") { log(`[navegador ${host}] ${ext.name}: polyfill antigo sem marcador de fim; reinstalando a extensão`); void reinstallExtension(host, ext.id); return false; }
    if (base !== null) { fs.writeFileSync(sw, `${src}${base}`); changed = true; }
  }
  // Content scripts do mundo isolado (não MAIN): o Electron não lhes dá chrome.extension; o polyfill entra na frente.
  for (const cs of m.content_scripts ?? []) {
    if (cs.world === "MAIN") continue;
    for (const rel of cs.js ?? []) {
      const f = inDir(rel); if (f === null || !fs.existsSync(f)) continue;
      const base = stripOldPolyfill(fs.readFileSync(f, "utf8"));
      if (base !== null && base !== "") { fs.writeFileSync(f, `${src}${base}`); changed = true; }
    }
  }
  const pages = [m.action?.default_popup, m.options_page, m.options_ui?.page].filter((p): p is string => typeof p === "string" && p !== "");
  if (pages.length > 0) {
    const jsFile = path.join(ext.path, "meu-bot-polyfill.js");
    if (!fs.existsSync(jsFile) || !fs.readFileSync(jsFile, "utf8").startsWith(POLYFILL_MARK)) { fs.writeFileSync(jsFile, src); changed = true; }
    for (const p of pages) {
      const f = inDir(p); if (f === null || !fs.existsSync(f)) continue;
      const html = fs.readFileSync(f, "utf8");
      if (html.includes("meu-bot-polyfill.js")) continue;
      const tag = `<script src="/meu-bot-polyfill.js"></script>`;
      const next = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => `${h}${tag}`) : `${tag}${html}`;
      fs.writeFileSync(f, next); changed = true;
    }
  }
  if (changed) log(`[navegador ${host}] polyfill gravado na extensão ${ext.name} ${ext.version}`);
  return changed;
}
/**
 * Service workers de extensões MV3. O Chromium os encerra após ~30 s ociosos e o Electron não os acorda quando um
 * content script chama `runtime.connect`/`sendMessage` (o Chrome acorda). Sem isto, o Streak perde a ponte com o
 * background minutos depois de abrir e passa a pedir login a cada recarga. Solução: acordar o worker ao carregar a
 * extensão e segurá-lo vivo com `startTask()` (a tarefa nunca termina); se mesmo assim parar, religar.
 */
interface HeldWorker { host: string; extId: string; versionId: number; up: Promise<void>; task: { end: () => void } | null; stopping: boolean; restarts: number }
const workers = new Map<string, HeldWorker>();
const workerKey = (host: string, extId: string): string => `${host}|${extId}`;
function workerHold(ses: Session, host: string, ext: Electron.Extension): void {
  const bg = (ext.manifest as { background?: { service_worker?: string } }).background?.service_worker;
  if (typeof bg !== "string") return;
  const key = workerKey(host, ext.id);
  const prev = workers.get(key);
  const held: HeldWorker = { host, extId: ext.id, versionId: -1, up: Promise.resolve(), task: null, stopping: false, restarts: (prev?.restarts ?? -1) + 1 };
  held.up = ses.serviceWorkers.startWorkerForScope(ext.url).then((w) => {
    if (workers.get(key) !== held) return;
    held.versionId = w.versionId;
    try { held.task = w.startTask(); } catch (e) { log(`[navegador ${host}] startTask falhou: ${e instanceof Error ? e.message : String(e)}`); }
    log(`[navegador ${host}] service worker da extensão ${ext.name} de pé e segurado (v${w.versionId}${held.restarts > 0 ? `, religado ${held.restarts}×` : ""})`);
  }).catch((e: unknown) => { log(`[navegador ${host}] service worker da extensão ${ext.name} não subiu: ${e instanceof Error ? e.message : String(e)}`); });
  workers.set(key, held);
}
function workerForget(host: string, extId: string): void {
  const held = workers.get(workerKey(host, extId));
  if (held === undefined) return;
  held.stopping = true;
  try { held.task?.end(); } catch { /* worker já foi */ }
  workers.delete(workerKey(host, extId));
}
/** Sessão da máquina pronta (uma vez por sessão): permissões, UA e Web Store. */
function prepareSession(host: string): { ses: Session; ready: Promise<void> } {
  const part = partitionOf(host);
  const ses = session.fromPartition(part);
  let ready = readySessions.get(part);
  if (ready === undefined) {
    const allowed = new Set(["fullscreen", "pointerLock", "clipboard-sanitized-write"]);
    // Câmera e microfone: como no Brave, a página pede e a janela pergunta (permitir sempre neste site, desta vez ou não).
    const janelaDe = (wc: WebContents | null): BrowserWindow | null => { const v = wc ? views.get(wc.id) : undefined; const w = v ? BrowserWindow.fromId(v.winId) : null; return w ?? BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && windowHosts.get(x.id) === host) ?? null; };
    ses.setPermissionRequestHandler((wc, permission, cb, details) => {
      if (allowed.has(permission)) return cb(true);
      const origem = origemDe(details.requestingUrl ?? wc.getURL());
      if (permission !== "media" || origem === null) return cb(false);
      void pedirPermissao(host, janelaDe(wc), wc.id, origem, tiposDe((details as { mediaTypes?: string[] }).mediaTypes)).then(cb, () => cb(false));
    });
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      if (allowed.has(permission)) return true;
      if (permission !== "media") return false;
      const origem = origemDe(requestingOrigin); if (origem === null) return false;
      const mt = (details as { mediaType?: string }).mediaType;
      return permissaoJaDada(host, wc?.id ?? -1, origem, mt === "video" ? ["camera"] : mt === "audio" ? ["microfone"] : ["camera", "microfone"]);
    });
    ses.on("will-download", (_e, item) => { log(`[navegador ${host}] download: ${item.getFilename()}`); });
    // Sem a assinatura do Electron no User-Agent: o login do Google e outros tratam app embutido como inseguro.
    ses.setUserAgent(ses.getUserAgent().replace(/ Electron\/\S+/, "").replace(/ meu-bot[^ ]*\/\S+/, ""));
    ses.webRequest.onBeforeSendHeaders({ urls: ["https://accounts.google.com/*"] }, (d, cb) => {
      const h: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(d.requestHeaders)) if (!/^sec-ch-ua/i.test(k) && k.toLowerCase() !== "user-agent") h[k] = v;
      h["User-Agent"] = FIREFOX_UA;
      cb({ requestHeaders: h });
    });
    // Polyfill das APIs chrome.* que o Electron não tem, no service worker e nas páginas das extensões (ver ext-polyfill.ts).
    const polyfill = path.join(__dirname, "..", "..", "preload", "ext-polyfill.js");
    try { ses.registerPreloadScript({ type: "service-worker", filePath: polyfill }); ses.registerPreloadScript({ type: "frame", filePath: polyfill }); }
    catch (e) { log(`[navegador ${host}] polyfill de extensões não registrado: ${e instanceof Error ? e.message : String(e)}`); }
    ready = installChromeWebStore({
      session: ses,
      extensionsPath: extensionsDir(host),
      autoUpdate: true,
      minimumManifestVersion: 3,
      beforeInstall: async (d) => { log(`[navegador ${host}] instalando extensão ${d.localizedName} (${d.id})`); return { action: "allow" }; },
    }).then(() => { log(`[navegador ${host}] sessão pronta (${ses.getAllExtensions().length} extensões)`); })
      .catch((e: unknown) => { log(`[navegador ${host}] web store não ligou: ${e instanceof Error ? e.message : String(e)}`); })
      // Extensões embutidas (Autenticador; a do CRM entra depois, pela licença): descompactadas, com o proxy local da API do CRM.
      .then(async () => { try { await carregarExtensoes(ses, host, patchExtensionFiles, () => capturarAbaAtiva(host)); } catch (e) { log(`[navegador ${host}] extensões embutidas não carregaram: ${e instanceof Error ? e.message : String(e)}`); } });
    readySessions.set(part, ready);
    ses.on("extension-loaded", (_e, ext) => {
      log(`[navegador ${host}] extensão carregada: ${ext.name} ${ext.version} (${ext.id}); manifest v${(ext.manifest as { manifest_version?: number }).manifest_version ?? "?"}`);
      publishExtensions(host);
      // Polyfill gravado nos arquivos da extensão (service worker e páginas): o preload de service worker não alcança o
      // contexto da extensão. Idempotente (marcador); depois de corrigir, recarrega a extensão uma vez.
      if (patchExtensionFiles(host, ext)) {
        void (async () => { try { await ses.removeExtension(ext.id); const again = await ses.loadExtension(ext.path, { allowFileAccess: false }); log(`[navegador ${host}] extensão ${ext.name} recarregada com o polyfill`); workerHold(ses, host, again); /* o extension-ready não repete após a recarga */ } catch (e) { log(`[navegador ${host}] recarga da extensão falhou: ${e instanceof Error ? e.message : String(e)}`); } })();
      }
    });
    ses.on("extension-unloaded", (_e, ext) => { log(`[navegador ${host}] extensão descarregada: ${ext.id}`); workerForget(host, ext.id); publishExtensions(host); });
    ses.on("extension-ready", (_e, ext) => { log(`[navegador ${host}] extensão pronta: ${ext.id}`); workerHold(ses, host, ext); });
    // Se o worker parar mesmo assim (travou, recarga da extensão), religa com um respiro, sem laço se ele cair na largada.
    ses.serviceWorkers.on("running-status-changed", (ev) => {
      if (ev.runningStatus !== "stopped") return;
      const held = [...workers.values()].find((w) => w.host === host && w.versionId === ev.versionId);
      if (held === undefined || held.stopping) return;
      const ext = ses.getExtension(held.extId);
      log(`[navegador ${host}] service worker da extensão ${held.extId} parou; religando`);
      if (ext !== null) setTimeout(() => { if (workers.get(workerKey(host, held.extId)) === held) workerHold(ses, host, ext); }, held.restarts > 3 ? 30_000 : 1_000);
    });
    // Erros dos service workers das extensões vão para o log (é onde um "declarativeNetRequest is undefined" apareceria).
    ses.serviceWorkers.on("console-message", (_ev, d) => { if (d.level >= 2 && /^chrome-extension:/.test(d.sourceUrl)) log(`[navegador ${host}] sw ${d.sourceUrl.slice(0, 70)}:${d.lineNumber}: ${d.message.slice(0, 300)}`); });
  }
  return { ses, ready };
}

/** Ícone (16–48 px) e popup da ação da extensão, lidos do manifesto; o ícone vai como data URL (a página do app não enxerga chrome-extension://). */
function extensionInfo(e: Electron.Extension): BrowserExtensionInfo {
  const m = e.manifest as { action?: { default_icon?: string | Record<string, string>; default_popup?: string }; icons?: Record<string, string> };
  const pick = (icons: string | Record<string, string> | undefined): string | null => {
    if (typeof icons === "string") return icons;
    if (icons === undefined) return null;
    const sizes = Object.keys(icons).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
    const best = sizes.find((n) => n >= 32) ?? sizes.at(-1);
    return best === undefined ? null : icons[String(best)] ?? null;
  };
  const rel = pick(m.action?.default_icon) ?? pick(m.icons);
  let icon: string | null = null;
  if (rel !== null) { try { const file = path.join(e.path, rel); const ext = path.extname(file).toLowerCase(); const mime = ext === ".svg" ? "image/svg+xml" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png"; icon = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`; } catch { icon = null; } }
  const popup = typeof m.action?.default_popup === "string" && m.action.default_popup !== "" ? `${e.url}${m.action.default_popup.replace(/^\//, "")}` : null;
  return { id: e.id, name: e.name, version: e.version, icon, popup };
}
const extensionsOf = (ses: Session, host: string): BrowserExtensionInfo[] => ses.getAllExtensions().map((e) => { const info = extensionInfo(e); return extensaoEmbutida(host, e.path) ? { ...info, embutida: true as const } : info; });
/** Janelas desta máquina recebem a lista nova de extensões (instalou pela Web Store, removeu…). */
function publishExtensions(host: string): void {
  const list = extensionsOf(session.fromPartition(partitionOf(host)), host);
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && windowHosts.get(win.id) === host) win.webContents.send("browser:extensions", list);
}
/** Host de cada janela que abriu o navegador (para os eventos dos webviews voltarem à janela certa). */
const windowHosts = new Map<number, string>();

/** Prepara a sessão e devolve o que o renderer precisa para criar os `<webview>`. */
export async function browserOpen(win: BrowserWindow, host: string, lic: LicencaDaMaquina | null = null): Promise<BrowserOpenInfo> {
  const { ses, ready } = prepareSession(host);
  await ready;
  // A extensão do CRM segue a licença desta máquina (quem abre já a leu; sem licença = fechado), nunca a variante.
  await browserSincronizarCrm(host, lic);
  // Os service workers das extensões precisam estar de pé antes de a página carregar (o content script do Streak
  // conecta no primeiro instante); espera um pouco por eles, sem travar a abertura se algum não subir.
  await Promise.race([Promise.all([...workers.values()].filter((w) => w.host === host).map((w) => w.up)), new Promise((r) => setTimeout(r, 4_000))]);
  windowHosts.set(win.id, host);
  log(`[navegador ${host}] aberto na janela ${win.id}`);
  // O interruptor do agente vem ligado por padrão e desligar é lembrado por máquina: ao abrir, liga (o -R sobe com o túnel).
  if (caps().agenteNavegador && isNavAgentHost(host) && !agentOn.has(host)) browserAgent(host, true);
  return { partition: partitionOf(host), extensions: extensionsOf(ses, host), agent: browserAgentInfo(host), favoritos: navFavoritos(host), espacos: navEspacos(host) };
}
/**
 * Carrega ou tira a extensão do CRM conforme a licença da máquina (Pro) E o nosso backend nela (a API do CRM mora
 * nele; crmDaMaquinaOk). Chamado ao abrir o Navegador e quando a licença é relida (`license:get`); sem o Navegador
 * desta máquina aberto, não faz nada. Pro sem o backend: a extensão fica de fora e o log diz por quê.
 */
export async function browserSincronizarCrm(host: string, lic: LicencaDaMaquina | null): Promise<void> {
  const part = partitionOf(host);
  if (!readySessions.has(part)) return;
  const ok = crmDaMaquinaOk(lic, host);
  if (!ok && lic !== null && crmProprioOk(lic.view, host)) log(`[navegador ${host}] extensão do CRM fica de fora: a licença libera o Pro, mas o backend do meu-bot não responde nesta máquina (instale-o pelo seletor)`);
  try { await sincronizarExtensaoCrm(session.fromPartition(part), host, ok, patchExtensionFiles, () => capturarAbaAtiva(host)); }
  catch (e) { log(`[navegador ${host}] extensão do CRM: ${e instanceof Error ? e.message : String(e)}`); }
}
/** Barra de favoritos (por máquina): a pessoa e o agente mexem; toda janela da máquina recebe a lista nova. */
function publishFavorites(host: string, list: NavFavorito[]): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && windowHosts.get(win.id) === host) win.webContents.send("browser:favorites", list);
}
export const browserFavorites = (host: string): NavFavorito[] => navFavoritos(host);
/** Espaços de trabalho: grava o estado inteiro desta máquina e avisa as outras janelas dela. */
export function browserWorkspacesSet(host: string, w: unknown, from?: BrowserWindow): NavWorkspaces {
  const n = setNavEspacos(host, w);
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && windowHosts.get(win.id) === host && win !== from) win.webContents.send("browser:workspaces", n);
  return n;
}
export function browserFavoriteAdd(host: string, f: { titulo: string; url: string }): NavFavorito[] {
  if (!/^https?:\/\/\S+$/i.test(f.url) || f.url.length > 2048) throw new Error("url do favorito precisa começar com http:// ou https://");
  const list = addNavFavorito(host, f); publishFavorites(host, list); log(`[navegador ${host}] favorito: ${f.url.slice(0, 80)}`); return list;
}
export function browserFavoriteRemove(host: string, idOrUrl: string): NavFavorito[] {
  const list = removeNavFavorito(host, idOrUrl); publishFavorites(host, list); return list;
}
/** Tira do Navegador desta máquina os cookies de um site (e subdomínios): a próxima página dele pede o login de novo. */
export async function sairDoSite(host: string, dominio: string): Promise<number> {
  const ses = session.fromPartition(partitionOf(host));
  const cookies = await ses.cookies.get({ domain: dominio });
  for (const c of cookies) {
    const url = `https://${(c.domain ?? dominio).replace(/^\./, "")}${c.path ?? "/"}`;
    try { await ses.cookies.remove(url, c.name); } catch { /* já saiu */ }
  }
  return cookies.length;
}
export const browserExtensions = (host: string): BrowserExtensionInfo[] => {
  const ses = session.fromPartition(partitionOf(host));
  // Diagnóstico no log: os service workers das extensões (MV3) estão rodando?
  try { const running = ses.serviceWorkers.getAllRunning(); const sw = Object.values(running).map((w) => `${w.scope} (${w.scriptUrl})`); log(`[navegador ${host}] extensões: ${ses.getAllExtensions().map((e) => `${e.name}@${e.version}`).join(", ") || "nenhuma"}; service workers: ${sw.join(" | ") || "nenhum"}`); } catch (e) { log(`[navegador ${host}] diagnóstico de extensões falhou: ${e instanceof Error ? e.message : String(e)}`); }
  return extensionsOf(ses, host);
};
export async function browserRemoveExtension(host: string, extId: string): Promise<BrowserExtensionInfo[]> {
  const ses = session.fromPartition(partitionOf(host));
  const ext = ses.getExtension(extId);
  if (ext !== null && extensaoEmbutida(host, ext.path)) throw new Error("a extensão do CRM vem com o app e não se remove");
  await uninstallExtension(extId, { session: ses, extensionsPath: extensionsDir(host) });
  log(`[navegador ${host}] extensão removida: ${extId}`);
  return extensionsOf(ses, host);
}
/** Baixa de novo a extensão da Web Store (arquivos limpos) e carrega; o `extension-loaded` aplica o polyfill. */
async function reinstallExtension(host: string, extId: string): Promise<void> {
  const ses = session.fromPartition(partitionOf(host));
  try { await uninstallExtension(extId, { session: ses, extensionsPath: extensionsDir(host) }); } catch { /* pode já não estar carregada */ }
  try { await installExtension(extId, { session: ses, extensionsPath: extensionsDir(host) }); log(`[navegador ${host}] extensão ${extId} reinstalada`); }
  catch (e) { log(`[navegador ${host}] reinstalação da extensão ${extId} falhou: ${e instanceof Error ? e.message : String(e)}`); }
}
export function browserForget(winId: number): void {
  const host = windowHosts.get(winId);
  windowHosts.delete(winId);
  // Última janela do host fechou: socket e -R caem, mas a escolha "agente pode usar" fica lembrada para a próxima abertura.
  if (host !== undefined && ![...windowHosts.values()].includes(host)) { agentStop(host); stopExtensaoApi(host); pararSincronizacaoGoogle(host); }
}
function agentStop(host: string): void {
  if (!agentOn.has(host)) return;
  agentOn.delete(host);
  setReverseWanted(host, null);
  stopNavApi(host);
  tellAgent(host, { on: false, state: "down", port: null });
}

// ---- "Agente pode usar": o serviço de ações sobe num socket 0700 e o túnel reverso o leva à máquina. O backend
// recebe a porta no cabeçalho de cada turno (X-Meu-Bot-Browser-Port) enquanto estiver ligado e de pé.
const agentOn = new Set<string>();
const agentState = new Map<string, BrowserAgentState>();
const tellAgent = (host: string, st: BrowserAgentState): void => {
  agentState.set(host, st);
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && windowHosts.get(win.id) === host) win.webContents.send("browser:agent", st);
};
onReverseState((host, chave, state, port) => {
  if (chave !== "nav") return; // o -R do Gmail (gmail-api.ts) tem o próprio aviso
  if (agentOn.has(host)) tellAgent(host, { on: true, state, port });
  // O agente do WhatsApp (OpenClaw, 24 h) acha o túnel por este arquivo na máquina (navegador-mcp.mjs --port-file).
  if (state !== "connecting") void gravarPortaNavegador(host, state === "up" ? port : null);
});
export function browserAgent(host: string, on: boolean): void {
  setNavAgentHost(host, on);
  if (on) {
    agentOn.add(host);
    tellAgent(host, { on: true, state: "connecting", port: null });
    void startNavApi(host).then((sock) => setReverseWanted(host, sock)).catch((e: unknown) => { log(`[navegador ${host}] serviço do agente não subiu: ${e instanceof Error ? e.message : String(e)}`); tellAgent(host, { on: true, state: "down", port: null }); });
  } else agentStop(host);
}
export const browserAgentInfo = (host: string): BrowserAgentState => agentState.get(host) ?? { on: false, state: "down", port: null };
/** Porta remota a mandar ao backend neste turno (só com o agente ligado e o -R de pé). */
export const browserAgentPort = (host: string): number | null => (agentOn.has(host) ? reversePort(host) : null);
export const browserSocketPath = navSocketPath;

/** Aba ativa de cada host (o renderer avisa): as ações do agente sem `aba` caem nela. */
const activeByHost = new Map<string, number>();
export const browserSetActive = (host: string, wcId: number): void => { activeByHost.set(host, wcId); };
export const browserActiveWcId = (host: string): number | null => activeByHost.get(host) ?? null;
/** Os webContents vivos dos webviews do navegador, por host (as ações do agente só alcançam estes). */
const views = new Map<number, { wc: WebContents; host: string; winId: number }>();
/** Últimas mensagens de console (avisos/erros) de cada webview: diagnóstico de extensões que não desenham. */
const consoleLog = new Map<number, string[]>();
export const browserConsole = (wcId: number): string[] => consoleLog.get(wcId) ?? [];
/** Service workers rodando na sessão (os das extensões MV3 aparecem aqui). */
export const browserServiceWorkers = (host: string): string[] => { try { return Object.values(session.fromPartition(partitionOf(host)).serviceWorkers.getAllRunning()).map((w) => `${w.scope} ← ${w.scriptUrl}`); } catch { return []; } };
/** Foto da aba de página ativa (não o popup de extensão, que também é webview desta sessão): o Autenticador lê o QR dela. */
async function capturarAbaAtiva(host: string): Promise<Electron.NativeImage> {
  const ativa = browserActiveWcId(host);
  const wc = browserWebContents(host).find((w) => w.id === ativa && !w.getURL().startsWith("chrome-extension:"));
  if (wc === undefined) throw new Error("nenhuma aba aberta no Navegador");
  return wc.capturePage();
}
export const browserWebContents = (host: string): WebContents[] => [...views.values()].filter((v) => v.host === host && !v.wc.isDestroyed()).map((v) => v.wc);
/** Pede ao renderer da janela do host uma ação de aba (o DOM é dele): nova aba, ativar ou fechar pelo id do webContents. */
/** Avisa a janela desta máquina (a do app, não o Navegador); false se ela não está aberta. */
export function avisarJanela<K extends "whatsapp:abrir">(host: string, canal: K, msg: { number: string }): boolean {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && windowHosts.get(win.id) === host) { win.webContents.send(canal, msg); if (win.isMinimized()) win.restore(); win.focus(); return true; }
  return false;
}
/**
 * Janela que deve receber um pedido para o Navegador desta máquina: a que está em foco, senão a visível mais recente,
 * senão a mais recente. Mandar para a primeira registrada abria a aba numa janela antiga e escondida (login do Google
 * na agente-box-lv "não acontecia nada", 26/10).
 */
function janelaDoHost(host: string): BrowserWindow | null {
  const ws = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && windowHosts.get(w.id) === host).sort((a, b) => b.id - a.id);
  return ws.find((w) => w.isFocused()) ?? ws.find((w) => w.isVisible()) ?? ws[0] ?? null;
}
export function browserAsk(host: string, msg: { kind: "new-tab"; url: string; fundo?: boolean } | { kind: "activate" | "close"; wcId: number }): boolean {
  const win = janelaDoHost(host); if (win === null) return false;
  if (msg.kind === "new-tab" && msg.fundo !== true) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  win.webContents.send("browser:ask", msg); return true;
}
/** Quem está usando cada aba (wcId → conversa), para o selo e o ID na faixa de abas da janela desta máquina. */
export function browserDonos(host: string, donos: Record<number, DonoInfo>): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && windowHosts.get(win.id) === host) win.webContents.send("browser:donos", { donos });
}

/**
 * "Quando uma aba desta máquina chegar numa página, roda este script nela" (o código do GitHub no tutorial 11: o gh
 * imprime o código, a página abre no Navegador e o app cola o código e autoriza sozinho). A cada carga que case com
 * `pagina`, roda o script: false = nada a fazer ainda; outro valor vai a `feito` e, quando `fim` o reconhece, encerra.
 * Devolve o cancelamento.
 */
interface AoChegar { host: string; pagina: (url: string) => boolean; js: string; feito: (r: unknown) => void; fim: (r: unknown) => boolean }
const aoChegar = new Set<AoChegar>();
export function browserAoChegar(host: string, pagina: (url: string) => boolean, js: string, ttlMs: number, feito: (r: unknown) => void, fim: (r: unknown) => boolean): () => void {
  const p: AoChegar = { host, pagina, js, feito, fim };
  aoChegar.add(p);
  const t = setTimeout(() => aoChegar.delete(p), ttlMs);
  // A aba pode já estar na página (o link abriu antes do registro): tenta nas abertas agora.
  for (const v of views.values()) if (v.host === host && !v.wc.isDestroyed()) void rodarAoChegar(v.wc, host);
  return () => { clearTimeout(t); aoChegar.delete(p); };
}
async function rodarAoChegar(wc: WebContents, host: string): Promise<void> {
  for (const p of [...aoChegar]) {
    if (p.host !== host || !aoChegar.has(p) || wc.isDestroyed()) continue;
    const url = wc.getURL();
    if (!p.pagina(url)) continue;
    try {
      const r: unknown = await wc.executeJavaScript(p.js, true);
      if (r === false || r === null || r === undefined) continue;
      if (p.fim(r)) aoChegar.delete(p);
      p.feito(r);
    } catch (e) { log(`[navegador ${host}] script ao chegar em ${url.slice(0, 80)} falhou: ${e instanceof Error ? e.message : String(e)}`); }
  }
}

// Cada <webview> anexado a uma janela que abriu o navegador: popups viram aba interna; Cmd+… volta ao app.
// Registrado pelo main.ts no boot (não no import: os testes puros carregam módulos do main sem Electron).
export function installBrowserHooks(): void { app.on("browser-window-created", onWindowCreated); }
function onWindowCreated(_e: Electron.Event, win: BrowserWindow): void {
  win.webContents.on("did-attach-webview", (_ev, wc) => {
    const host = windowHosts.get(win.id);
    if (host === undefined) return;
    views.set(wc.id, { wc, host, winId: win.id });
    googleLoginUa(wc);
    retornoParaMaquina(wc, host);
    wc.on("did-finish-load", () => { void rodarAoChegar(wc, host); });
    wc.on("destroyed", () => { views.delete(wc.id); consoleLog.delete(wc.id); esquecerAba(wc.id); });
    wc.on("console-message", (ev) => {
      if (ev.level !== "warning" && ev.level !== "error") return;
      const list = consoleLog.get(wc.id) ?? [];
      list.push(`[${ev.level}] ${ev.message.slice(0, 400)}${ev.sourceId ? ` (${ev.sourceId.slice(-80)}:${ev.lineNumber})` : ""}`);
      consoleLog.set(wc.id, list.slice(-60));
    });
    wc.setWindowOpenHandler(({ url, disposition }) => {
      // window.open com tamanho (login do Google, OAuth, "entrar com…") precisa de janela de verdade: window.opener e
      // postMessage de volta ao site. Link comum em _blank vira aba interna.
      if (disposition === "new-window" && /^(https?:|about:blank)/.test(url)) return { action: "allow", overrideBrowserWindowOptions: { width: 540, height: 720, autoHideMenuBar: true, title: "Navegador · meu-bot" } };
      if (/^https?:\/\//.test(url)) { if (!win.isDestroyed()) win.webContents.send("browser:open-url", { url }); }
      else if (/^(mailto|tel):/.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || !input.meta) return;
      const k = input.key.toLowerCase();
      // Cmd+= / Cmd+- / Cmd+0: zoom da aba (o renderer guarda por site).
      if (["k", "j", "n", "b", "w", "t", "l", "[", "]", "\\", "=", "+", "-", "0"].includes(k) || (input.shift && (k === "b" || k === "n" || k === "f"))) {
        event.preventDefault();
        if (!win.isDestroyed()) { win.webContents.focus(); win.webContents.send("browser:key", { key: k, shift: input.shift }); }
      }
    });
  });
}
