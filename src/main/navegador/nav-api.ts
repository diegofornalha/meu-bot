/**
 * Ações do agente no Navegador (módulo Pro). Em vez de expor o protocolo do Chrome (que exigiria emular o
 * puppeteer inteiro), o app serve meia dúzia de ações diretas nas abas do Navegador, num socket Unix 0700 só
 * nosso; o túnel SSH reverso leva esse socket até 127.0.0.1:<porta> da máquina, onde o `navegador-mcp.mjs`
 * (um arquivo, sem npm) apresenta as ações ao Claude como ferramentas e repassa para cá. Só as abas do
 * Navegador existem para o agente; a interface do app nunca.
 *
 * API (JSON): GET /abas · POST /abrir {url, nova?} · POST /ler {aba?} · POST /clicar {aba?, n?|texto?|seletor?}
 * · POST /digitar {aba?, n?|seletor?, texto, enter?} · POST /tecla {aba?, tecla} · POST /print {aba?, marcas?}
 * · POST /voltar|/avancar|/recarregar {aba?} · POST /js {aba?, codigo}
 * · /favoritos · POST /favoritar {url, titulo?} · POST /desfavoritar {id?|url?}  (barra de favoritos da máquina)
 * · POST /fechar {aba?}  (só aba da própria conversa; as abas da pessoa no mesmo site recarregam sem cache)
 * Quem pede vem no cabeçalho `X-Meu-Bot-Dono` (nav-donos-core.ts): cada conversa trabalha nas próprias abas.
 */
import { controlDir } from "../app/control-dir";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { WebContents } from "electron";
import { DONO_SEM_IDENTIDADE, abasParaRecarregar, decidirAbrir, donoTexto, escolherAba, limpar, literalJs, parseDono, podeFechar, tomar, abasDe, type Dono, type Posse, type Tipo } from "./nav-donos-core";
import { browserActiveWcId, browserAsk, browserDonos, browserConsole, browserExtensions, browserFavoriteAdd, browserFavoriteRemove, browserFavorites, browserServiceWorkers, browserWebContents } from "./browser";
import { log } from "../maquina/tunnel";
import { registrarAcao } from "../app/depuracao";

const sanit = (h: string): string => h.replace(/[^A-Za-z0-9_-]/g, "_");
export const navSocketPath = (host: string): string => path.join(controlDir(), `nav-${sanit(host)}.sock`);

const servers = new Map<string, http.Server>();
/** Sobe o serviço desta máquina (uma vez); devolve o caminho do socket que o -R vai encaminhar. */
export async function startNavApi(host: string): Promise<string> {
  const sock = navSocketPath(host);
  if (servers.has(host)) return sock;
  try { fs.unlinkSync(sock); } catch { /* não existia */ }
  const server = http.createServer((req, res) => { void handle(host, req, res); });
  // Pedido malformado (o Node recusa antes do handler): fica no log e volta com o motivo, nunca um 400 mudo.
  server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
    log(`[navegador ${host}] pedido malformado: ${err.code ?? err.message}`);
    const body = JSON.stringify({ erro: `pedido malformado (${err.code ?? "erro"}); tente de novo` });
    if (socket.writable) socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(sock, () => { server.off("error", reject); resolve(); }); });
  fs.chmodSync(sock, 0o600);
  servers.set(host, server);
  log(`[navegador ${host}] ações do agente em ${sock}`);
  return sock;
}
export function stopNavApi(host: string): void {
  const s = servers.get(host); if (s === undefined) return;
  servers.delete(host); s.close();
  try { fs.unlinkSync(navSocketPath(host)); } catch { /* ok */ }
}

/** Texto e elementos interativos da página, numerados; o número é o que o agente usa em clicar/digitar. */
const READ_SCRIPT = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const items = []; const marcas = []; window.__meuBotEls = [];
  const sel = "a[href], button, input, textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=textbox], [contenteditable=true], summary";
  for (const e of document.querySelectorAll(sel)) {
    if (!vis(e) || items.length >= 400) continue;
    const tag = e.tagName.toLowerCase();
    const type = e.getAttribute("type") || "";
    const label = (e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.getAttribute("title") || e.getAttribute("alt") || (e.labels && e.labels[0] && e.labels[0].innerText) || e.innerText || e.value || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    const kind = tag === "a" ? "link" : tag === "input" ? (type === "checkbox" || type === "radio" ? type : type === "submit" || type === "button" ? "botão" : "campo") : tag === "textarea" || e.getAttribute("contenteditable") === "true" || e.getAttribute("role") === "textbox" ? "campo" : tag === "select" ? "seleção" : "botão";
    const n = window.__meuBotEls.push(e);
    const r = e.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (marcas.length < 60 && cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight) marcas.push({ n, x: cx, y: cy, rotulo: label.slice(0, 40) });
    items.push(n + ". [" + kind + "] " + label + (tag === "a" && e.href ? "  → " + e.href.slice(0, 100) : "") + (kind === "campo" && e.value ? "  (valor: " + String(e.value).slice(0, 40) + ")" : ""));
  }
  const text = (document.body ? document.body.innerText : "").replace(/\\n{3,}/g, "\\n\\n").trim();
  return { title: document.title, url: location.href, text: text.slice(0, 12000), truncated: text.length > 12000, elements: items, marcas: { vw: innerWidth, vh: innerHeight, itens: marcas } };
})()`;
/**
 * `/print` com `marcas`: desenha por um instante, na própria página, o número de cada elemento da última leitura que
 * está à vista (o mesmo número do clicar/digitar), para ele sair na imagem. Shadow DOM fechado e sem eventos: a página
 * não o estiliza nem o recebe em clique. Devolve quantos desenhou; DESMARCAR tira.
 */
const MARCAR_SCRIPT = `(() => {
  const velho = document.getElementById("__meu-bot-marcas"); if (velho) velho.remove();
  const host = document.createElement("div"); host.id = "__meu-bot-marcas"; host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const sombra = host.attachShadow({ mode: "closed" }); let k = 0;
  (window.__meuBotEls || []).forEach((e, i) => {
    if (!e.isConnected) return;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return;
    const m = document.createElement("span"); m.textContent = String(i + 1);
    m.style.cssText = "position:absolute;left:" + Math.max(0, r.left) + "px;top:" + Math.max(0, r.top) + "px;font:700 11px/1.2 -apple-system,system-ui,sans-serif;padding:1px 4px;border-radius:4px;color:#fff;outline:1px solid #fff;background:hsl(" + Math.round(((i + 1) * 137.508) % 360) + " 85% 38%)";
    sombra.append(m); k++;
  });
  document.documentElement.append(host);
  return k;
})()`;
const DESMARCAR_SCRIPT = `(() => { const m = document.getElementById("__meu-bot-marcas"); if (m) m.remove(); })()`;
/** O ponto medido na página ganha o id da aba (a janela acha o webview por ele); o resto da conferência é do depuracao-core. */
const comAba = (p: unknown, aba: number): unknown => (p !== null && typeof p === "object" ? { ...(p as object), aba } : null);
/** O que é só da faixa de depuração (`ponto` do clicar/digitar, `marcas` do ler) não vai na resposta ao agente. */
const semDepuracao = (r: unknown): unknown => { if (r === null || typeof r !== "object" || !("ponto" in r || "marcas" in r)) return r; const { ponto: _p, marcas: _m, ...resto } = r as Record<string, unknown>; return resto; };
const pick = (n: number): string => `(() => { const e = (window.__meuBotEls || [])[${n - 1}]; if (!e) throw new Error("elemento ${n} não existe: use 'ler' de novo"); return e; })()`;

interface Req { aba?: unknown; url?: unknown; nova?: unknown; n?: unknown; texto?: unknown; seletor?: unknown; enter?: unknown; tecla?: unknown; codigo?: unknown; titulo?: unknown; id?: unknown; marcas?: unknown }

/** Abas de página do Navegador: o popup de uma extensão (chrome-extension://…/popup.html) também é um webview da sessão, mas não é aba. */
function tabsOf(host: string): WebContents[] { return browserWebContents(host).filter((w) => { try { return !w.getURL().startsWith("chrome-extension:"); } catch { return false; } }); }
const alive = (wc: WebContents): WebContents => { if (wc.isDestroyed()) throw new Error("essa aba foi fechada no meio da ação: chame 'abas' e siga na aba nova"); return wc; };
function tabInfo(wc: WebContents, activeId: number | null): { aba: number; url: string; titulo: string; ativa: boolean; carregando: boolean } {
  return { aba: wc.id, url: wc.getURL(), titulo: wc.getTitle(), ativa: wc.id === activeId, carregando: wc.isLoading() };
}
const waitLoad = (wc: WebContents, ms = 20_000): Promise<void> => new Promise((resolve) => {
  if (!wc.isLoading()) { resolve(); return; }
  const done = (): void => { clearTimeout(t); wc.off("did-stop-loading", done); resolve(); };
  const t = setTimeout(done, ms);
  wc.once("did-stop-loading", done);
});
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Posse das abas por máquina (wcId → conversa) e a fila por aba: ações que mexem na mesma aba esperam a anterior. */
const posses = new Map<string, Map<number, Posse>>();
const possesDe = (host: string): Map<number, Posse> => { let m = posses.get(host); if (m === undefined) { m = new Map(); posses.set(host, m); } return m; };
const filas = new Map<string, Promise<void>>();
async function naFila<T>(host: string, wcId: number, fn: () => Promise<T>): Promise<T> {
  const k = `${host}|${wcId}`;
  const antes = filas.get(k) ?? Promise.resolve();
  let soltar: () => void = () => undefined;
  const minha = new Promise<void>((r) => { soltar = r; });
  const fim = antes.then(() => minha);
  filas.set(k, fim);
  await antes;
  try { return await fn(); } finally { soltar(); if (filas.get(k) === fim) filas.delete(k); }
}
/** Publica para a janela quem está usando cada aba (selo e ID na faixa de abas). */
function publicar(host: string): void {
  browserDonos(host, Object.fromEntries([...possesDe(host)].map(([aba, p]) => [aba, { id: p.id, rotulo: p.rotulo, origem: p.origem }])));
}
/** Aba para uma ação, pelas regras de posse; mexer toma a aba para a conversa (e renova o uso). */
function alvo(host: string, dono: Dono | null, aba: unknown, tipo: Tipo): WebContents {
  const list = tabsOf(host);
  const m = possesDe(host);
  const antes = m.size;
  limpar(m, list.map((w) => w.id), Date.now());
  const r = escolherAba({ posses: m, vivas: list.map((w) => w.id), ativa: browserActiveWcId(host), dono, aba: typeof aba === "number" ? aba : undefined, tipo });
  if ("erro" in r) { if (m.size !== antes) publicar(host); throw new Error(r.erro); }
  const wc = list.find((w) => w.id === r.aba)!;
  const minha = dono !== null && m.get(wc.id)?.id === dono.id;
  if (tipo === "mexe" || minha) { tomar(m, wc.id, dono, Date.now()); }
  if (m.size !== antes || tipo === "mexe") publicar(host);
  return wc;
}

async function act(host: string, route: string, b: Req, dono: Dono | null): Promise<unknown> {
  const active = browserActiveWcId(host);
  const ler = (): WebContents => alvo(host, dono, b.aba, "leitura");
  const mexer = <T>(fn: (wc: WebContents) => Promise<T>): Promise<T> => { const wc = alvo(host, dono, b.aba, "mexe"); return naFila(host, wc.id, () => fn(wc)); };
  switch (route) {
    case "/abas": { const m = possesDe(host); limpar(m, tabsOf(host).map((w) => w.id), Date.now()); return { abas: tabsOf(host).map((w) => ({ ...tabInfo(w, active), dono: donoTexto(m, w.id, dono) })) }; }
    case "/diag": {
      const wc = tabsOf(host).length === 0 ? null : ler();
      return { extensoes: browserExtensions(host).map((e) => ({ id: e.id, nome: e.name, versao: e.version, popup: e.popup })), service_workers: browserServiceWorkers(host), console: wc === null ? [] : browserConsole(wc.id), aba: wc === null ? null : tabInfo(wc, active) };
    }
    case "/abrir": {
      if (typeof b.url !== "string" || !/^https?:\/\//i.test(b.url)) throw new Error("url precisa começar com http:// ou https://");
      const url = b.url;
      const list = tabsOf(host);
      const m = possesDe(host);
      limpar(m, list.map((w) => w.id), Date.now());
      const d = decidirAbrir({ posses: m, vivas: list.map((w) => w.id), ativa: active, dono, aba: typeof b.aba === "number" ? b.aba : undefined, nova: b.nova === true });
      if ("erro" in d) throw new Error(d.erro);
      // Pedido do WhatsApp não rouba a tela da pessoa: a aba nasce e trabalha em segundo plano.
      const fundo = dono?.origem === "whatsapp";
      let wc: WebContents;
      if (d.modo === "nova") {
        const before = new Set(list.map((w) => w.id));
        if (!browserAsk(host, { kind: "new-tab", url, fundo })) throw new Error("a aba Navegador não está aberta no app");
        wc = await new Promise<WebContents>((resolve, reject) => { const t0 = Date.now(); const tick = (): void => { const n = tabsOf(host).find((w) => !before.has(w.id)); if (n !== undefined) resolve(n); else if (Date.now() - t0 > 25_000) reject(new Error("a aba nova não apareceu: o Navegador do app pode estar sem acesso (plano) ou travado; chame 'abas' e tente de novo")); else setTimeout(tick, 100); }; tick(); });
        tomar(m, wc.id, dono, Date.now()); publicar(host);
      } else {
        wc = list.find((w) => w.id === d.aba)!;
        tomar(m, wc.id, dono, Date.now()); publicar(host);
        await naFila(host, wc.id, async () => { if (!fundo) browserAsk(host, { kind: "activate", wcId: wc.id }); await wc.loadURL(url).catch(() => { /* erro de carga aparece no título/url */ }); });
      }
      await waitLoad(wc); await settle(300);
      return { ...tabInfo(alive(wc), browserActiveWcId(host)), dono: donoTexto(m, wc.id, dono) };
    }
    case "/fechar": {
      const m = possesDe(host);
      limpar(m, tabsOf(host).map((w) => w.id), Date.now());
      const aba = typeof b.aba === "number" ? b.aba : dono === null ? undefined : abasDe(m, dono)[0];
      if (aba === undefined) throw new Error("esta conversa não tem aba aberta para fechar");
      const motivo = podeFechar(m, aba, dono);
      if (motivo !== null) throw new Error(motivo);
      // O agente costuma abrir uma aba só para conferir o que publicou e fechá-la: a aba da pessoa no mesmo site ainda
      // mostra a versão de antes e parecia que "voltou". Ela recarrega (sem cache) junto com o fechamento.
      const vivas = tabsOf(host);
      const fechadaUrl = vivas.find((w) => w.id === aba)?.getURL() ?? "";
      const recarregar = abasParaRecarregar(fechadaUrl, vivas.map((w) => ({ id: w.id, url: w.getURL() })), aba, m);
      browserAsk(host, { kind: "close", wcId: aba });
      m.delete(aba); publicar(host);
      for (const id of recarregar) { const w = vivas.find((x) => x.id === id); if (w !== undefined && !w.isDestroyed()) { try { w.reloadIgnoringCache(); } catch { /* aba fechou no meio */ } } }
      if (recarregar.length > 0) log(`[navegador ${host}] /fechar recarregou ${recarregar.length} aba(s) da pessoa no mesmo site (${fechadaUrl.slice(0, 80)})`);
      return { ok: true, fechada: aba, recarregadas: recarregar };
    }
    case "/ler": {
      const wc = ler(); await waitLoad(wc);
      // Páginas pesadas (Gmail + extensões) às vezes falham na primeira leitura logo após navegar; uma segunda tentativa resolve.
      // As marcas (onde está cada elemento à vista) ganham o id da aba: a janela acha o webview por ele.
      const lido = async (): Promise<unknown> => { const r = await alive(wc).executeJavaScript(READ_SCRIPT, true) as Record<string, unknown>; return { ...r, marcas: comAba(r["marcas"], wc.id) }; };
      try { return await lido(); }
      catch (e) { log(`[navegador ${host}] ler falhou (1ª): ${e instanceof Error ? e.message : String(e)}`); await settle(600); return await lido(); }
    }
    case "/clicar": return mexer(async (wc) => {
      const target = typeof b.n === "number" ? pick(b.n)
        : typeof b.seletor === "string" ? `(() => { const e = document.querySelector(${literalJs(b.seletor)}); if (!e) throw new Error("nada com o seletor"); return e; })()`
          : typeof b.texto === "string" ? `(() => { const q = ${literalJs(b.texto)}.toLowerCase(); const all = [...document.querySelectorAll("a, button, [role=button], [role=link], [role=tab], [role=menuitem], input[type=submit], input[type=button], summary, label")]; const e = all.find((x) => (x.innerText || x.value || x.getAttribute("aria-label") || "").toLowerCase().trim() === q) || all.find((x) => (x.innerText || x.value || x.getAttribute("aria-label") || "").toLowerCase().includes(q)); if (!e) throw new Error("nenhum botão/link com esse texto"); return e; })()`
            : null;
      if (target === null) throw new Error("diga n (número do 'ler'), texto ou seletor");
      const ponto = await wc.executeJavaScript(`(() => { const e = ${target}; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); const ponto = { x: r.left + r.width / 2, y: r.top + r.height / 2, vw: innerWidth, vh: innerHeight }; e.focus && e.focus(); e.click(); return ponto; })()`, true) as unknown;
      await settle(500); await waitLoad(wc, 8_000);
      return { ok: true, ...tabInfo(wc, browserActiveWcId(host)), ponto: comAba(ponto, wc.id) };
    });
    case "/digitar": return mexer(async (wc) => {
      if (typeof b.texto !== "string") throw new Error("falta texto");
      const target = typeof b.n === "number" ? pick(b.n) : typeof b.seletor === "string" ? `(() => { const e = document.querySelector(${literalJs(b.seletor)}); if (!e) throw new Error("nada com o seletor"); return e; })()` : "document.activeElement";
      // Foca e limpa; o texto entra como digitação de verdade (insertText), que apps como o Gmail entendem.
      const ponto = await wc.executeJavaScript(`(() => { const e = ${target}; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); const ponto = { x: r.left + r.width / 2, y: r.top + r.height / 2, vw: innerWidth, vh: innerHeight }; e.focus(); if ("value" in e && typeof e.value === "string") { e.select && e.select(); } else if (e.isContentEditable) { const r = document.createRange(); r.selectNodeContents(e); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } return ponto; })()`, true) as unknown;
      await wc.insertText(b.texto);
      if (b.enter === true) { wc.sendInputEvent({ type: "keyDown", keyCode: "Return" }); wc.sendInputEvent({ type: "char", keyCode: "Return" }); wc.sendInputEvent({ type: "keyUp", keyCode: "Return" }); await settle(500); await waitLoad(wc, 8_000); }
      return { ok: true, ponto: comAba(ponto, wc.id) };
    });
    case "/tecla": return mexer(async (wc) => {
      const k = typeof b.tecla === "string" ? b.tecla : "";
      const map: Record<string, string> = { enter: "Return", tab: "Tab", esc: "Escape", escape: "Escape", backspace: "Backspace", space: "Space", up: "Up", down: "Down", left: "Left", right: "Right", pagedown: "PageDown", pageup: "PageUp" };
      const code = map[k.toLowerCase()] ?? (k.length === 1 ? k : null);
      if (code === null) throw new Error("tecla: enter, tab, esc, backspace, space, up, down, left, right, pageup, pagedown ou um caractere");
      wc.sendInputEvent({ type: "keyDown", keyCode: code }); if (code.length === 1 || code === "Return") wc.sendInputEvent({ type: "char", keyCode: code }); wc.sendInputEvent({ type: "keyUp", keyCode: code });
      await settle(300);
      return { ok: true };
    });
    case "/print": {
      const wc = ler(); const marcar = b.marcas === true;
      if (marcar) {
        const n = await wc.executeJavaScript(MARCAR_SCRIPT, true) as unknown;
        if (n === 0) { await wc.executeJavaScript(DESMARCAR_SCRIPT, true); throw new Error("sem elementos numerados à vista: leia a página antes (nav_ler)"); }
        await settle(120); // um quadro para as marcas serem pintadas
      }
      try { const img = await wc.capturePage(); return { png_base64: img.resize({ width: Math.min(1280, img.getSize().width) }).toPNG().toString("base64") }; }
      finally { if (marcar) await wc.executeJavaScript(DESMARCAR_SCRIPT, true).catch(() => undefined); }
    }
    case "/voltar": return mexer(async (wc) => { if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); await settle(300); await waitLoad(wc); return tabInfo(wc, active); });
    case "/avancar": return mexer(async (wc) => { if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); await settle(300); await waitLoad(wc); return tabInfo(wc, active); });
    case "/recarregar": return mexer(async (wc) => { wc.reload(); await settle(300); await waitLoad(wc); return tabInfo(wc, active); });
    case "/js": return mexer(async (wc) => { if (typeof b.codigo !== "string") throw new Error("falta codigo"); const r: unknown = await wc.executeJavaScript(b.codigo, true); return { resultado: typeof r === "string" ? r.slice(0, 8000) : JSON.stringify(r)?.slice(0, 8000) ?? null }; });
    case "/favoritos": return { favoritos: browserFavorites(host) };
    case "/favoritar": {
      if (typeof b.url !== "string" || !/^https?:\/\//i.test(b.url)) throw new Error("url precisa começar com http:// ou https://");
      // Sem título: o da aba que está nessa url, senão o host.
      let titulo = typeof b.titulo === "string" ? b.titulo : "";
      if (titulo.trim() === "") { const t = tabsOf(host).find((w) => w.getURL() === b.url); titulo = t?.getTitle() ?? ""; if (titulo === "") { try { titulo = new URL(b.url).hostname; } catch { /* fica vazio */ } } }
      return { favoritos: browserFavoriteAdd(host, { titulo, url: b.url }) };
    }
    case "/desfavoritar": {
      const key = typeof b.id === "string" ? b.id : typeof b.url === "string" ? b.url : "";
      if (key === "") throw new Error("informe id ou url do favorito (veja 'favoritos')");
      return { favoritos: browserFavoriteRemove(host, key) };
    }
    default: throw Object.assign(new Error(`rota desconhecida: ${route}`), { status: 404 });
  }
}

const vistos = new Set<string>();
async function handle(host: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const route = (req.url ?? "/").split("?")[0] ?? "/";
  const send = (code: number, body: unknown): void => { const s = JSON.stringify(body); res.writeHead(code, { "Content-Type": "application/json; charset=UTF-8", "Content-Length": Buffer.byteLength(s) }); res.end(s); };
  let body: Req = {};
  if (req.method === "POST") {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Req; } catch { return send(400, { erro: "JSON inválido" }); }
  }
  const dono = parseDono(req.headers["x-meu-bot-dono"]) ?? DONO_SEM_IDENTIDADE;
  // Primeira vez de cada conversa: registra quem é (no WhatsApp mostra se veio a chave da sessão ou um id por processo).
  if (dono !== null && !vistos.has(dono.id)) { vistos.add(dono.id); log(`[navegador ${host}] conversa nova usando o Navegador: ${dono.origem} · ${dono.id} · ${dono.rotulo}`); }
  const t0 = Date.now();
  // O `ponto` (onde a ação aconteceu) e as `marcas` (onde está cada elemento lido) são só para a faixa de depuração.
  try { const r = await act(host, route, body, dono); send(200, semDepuracao(r)); registrarAcao({ origem: "navegador", dono, rota: route, corpo: body as Record<string, unknown>, t0, resultado: r }); }
  catch (e) {
    const st = (e as { status?: number }).status ?? 400;
    const msg = (e instanceof Error ? e.message : String(e)) || "a ação falhou sem mensagem (a aba pode ter mudado); chame 'abas' e tente de novo";
    log(`[navegador ${host}] ${route}${dono !== null ? ` (${dono.origem}: ${dono.id})` : ""} → ${st}: ${msg.slice(0, 200)}`);
    registrarAcao({ origem: "navegador", dono, rota: route, corpo: body as Record<string, unknown>, t0, erro: msg });
    send(st, { erro: msg });
  }
}
