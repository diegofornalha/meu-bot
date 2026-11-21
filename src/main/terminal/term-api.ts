/**
 * Terminal do app controlado de fora (Claude Code neste Mac): o mesmo molde do Navegador (nav-api.ts), mas o
 * socket fica SÓ neste Mac (/tmp/<app>-<uid>/term.sock, 0600) e nunca vai pelo túnel para as máquinas: lá
 * quem pede seria o agente, e o terminal é o shell da pessoa. Tudo que é digitado aparece no xterm da aba, na
 * hora, para a pessoa ver.
 *
 * API (JSON): GET /terminais · POST /abrir {maquina?} (aba nova na janela da máquina) · POST /ler {id, linhas?}
 * · POST /digitar {id, texto, enter?} | {id, tecla} · POST /fechar {id}: encerra a sessão e a aba (como o × da aba)
 * · POST /dividir {id} | {pagina: "navegador"|"tutoriais"|"acervo"|"vazia", maquina?}: mais uma coluna à direita (quantas a
 *   largura da janela comportar) · POST /juntar {id?|pagina?, maquina?}: tira essa coluna, ou todas
 * · POST /nota {texto}: uma linha de quem está dirigindo o app de fora, para a faixa de depuração ("vou pedir ao agente…");
 *   devolve `visivel: false` quando o modo está desligado (a nota foi só ao log, ninguém viu)
 * · POST /depuracao {on: true|false|null}: liga/desliga o modo de depuração (null = padrão da variante)
 * Rotas do app em si (6 nov; o scripts/app-mcp.mjs e o controle externo por MCP usam as duas famílias):
 * · GET /app: nome, versão, tema, janelas abertas (qual em foco) e máquinas conhecidas
 * · POST /janela {maquina}: abre (ou traz) a janela de uma máquina do ~/.ssh/config, ou "local"
 * · POST /pagina {pagina, maquina?}: põe uma página na frente (tutoriais, acervo, inspector, modulos, conta-google, gmail, computador, navegador)
 * · POST /tema {tema: system|light|dark} · POST /print {maquina?}: a janela inteira como PNG (png_base64, ≤ 1280 px)
 * Quem pede vem no cabeçalho `X-Meu-Bot-Dono` (o mesmo do Navegador, nav-donos-core.ts) e aparece como selo no
 * terminal ("✳️ Claude Code (Mac) · digitou"), para a pessoa saber quem está mexendo.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, nativeTheme } from "electron";
import type { Theme } from "../../shared/ipc";
import { controlDir } from "../app/control-dir";
import { allMainWindows, broadcast, hostOfWindow, lastFocusedWindow, openMainWindow, sendWhenLoaded, windowForHost } from "../app/windows";
import { setLastHost, settingsView, updateSettings } from "../app/settings";
import { isTheme } from "../app/settings-normalize";
import { appTitle, produto } from "../app/variant";
import { LOCAL_HOST } from "../maquina/localBackend";
import { listSshHosts } from "../maquina/sshConfig";
import { PAGINAS_APP } from "../controle-remoto/controle-remoto-core";
import { closeTerminal, liveTerminals, replayTerminal, terminalById, waitNewTerminal, writeTerminal } from "./terminal";
import { entradaDigitar, textoDoTerminal } from "./term-api-core";
import { parseDono, type Dono } from "../navegador/nav-donos-core";
import { log } from "../maquina/backend";
import { estado as estadoDepuracao, evento as eventoDepuracao, modoDepuracao, registrarAcao, setDepuracao } from "../app/depuracao";

export const termSocketPath = (): string => path.join(controlDir(), "term.sock");

interface Req { id?: unknown; maquina?: unknown; linhas?: unknown; texto?: unknown; enter?: unknown; tecla?: unknown; pagina?: unknown; on?: unknown; tema?: unknown }
const PAGINAS = ["navegador", "tutoriais", "acervo", "vazia"] as const;

/** Janela da máquina pedida (ou a última focada que tenha máquina). */
function janela(maquina: unknown): BrowserWindow {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && hostOfWindow(w) !== undefined);
  if (typeof maquina === "string" && maquina !== "") {
    const w = wins.find((x) => hostOfWindow(x) === maquina);
    if (w === undefined) throw new Error(`nenhuma janela aberta da máquina "${maquina}": abertas: ${wins.map((x) => hostOfWindow(x)).join(", ") || "nenhuma"}`);
    return w;
  }
  const f = lastFocusedWindow();
  const w = f !== null && wins.includes(f) ? f : wins[0];
  if (w === undefined) throw new Error("nenhuma janela de máquina aberta no app");
  return w;
}
const sessao = (id: unknown) => {
  const s = typeof id === "string" ? terminalById(id) : null;
  if (s === null) throw new Error("terminal não existe ou foi encerrado: veja /terminais");
  return s;
};
const info = (t: { id: string; host: string; n: number }) => ({ id: t.id, maquina: t.host, terminal: t.n });

/** Pedido sem identidade: ainda é alguém neste Mac (o socket é 0600), só sem nome. */
const SEM_ID: Dono = { id: "local:sem-id", rotulo: "controle local (sem identificação)", origem: "claude-code" };
/** Selo no terminal: quem usou por último e o quê. */
function marcar(s: { id: string; winId: number }, dono: Dono, acao: "abriu" | "leu" | "digitou" | "dividiu"): void {
  const w = BrowserWindow.fromId(s.winId);
  if (w !== null && !w.isDestroyed()) w.webContents.send("term:dono", { id: s.id, dono: { ...dono, acao, em: Date.now() } });
}

async function act(route: string, b: Req, dono: Dono): Promise<unknown> {
  switch (route) {
    case "/terminais": return { terminais: liveTerminals().map(info) };
    case "/abrir": {
      const w = janela(b.maquina);
      const antes = new Set(liveTerminals().map((t) => t.id));
      w.webContents.send("term:ask", { kind: "new" });
      const id = await waitNewTerminal(w.id, antes);
      if (id === null) throw new Error("a aba nova do terminal não abriu a tempo (veja a janela do app)");
      const t = liveTerminals().find((x) => x.id === id)!;
      marcar(t, dono, "abriu");
      await new Promise((r) => setTimeout(r, 800)); // o prompt chegar
      return { ...info(t), tela: textoDoTerminal(replayTerminal(terminalById(id)!), 20) };
    }
    case "/ler": {
      const s = sessao(b.id);
      marcar(s, dono, "leu");
      return { id: s.id, maquina: s.host, tela: textoDoTerminal(replayTerminal(s), typeof b.linhas === "number" ? b.linhas : 60) };
    }
    case "/digitar": {
      const s = sessao(b.id);
      const e = entradaDigitar(b);
      if ("erro" in e) throw new Error(e.erro);
      writeTerminal(s, e.dados);
      marcar(s, dono, "digitou");
      return { ok: true };
    }
    case "/dividir": {
      if (typeof b.id === "string") {
        const s = sessao(b.id);
        const w = BrowserWindow.fromId(s.winId);
        if (w === null || w.isDestroyed()) throw new Error("a janela desse terminal fechou");
        w.webContents.send("ui:split", { alvo: "terminal", id: s.id });
        marcar(s, dono, "dividiu");
        return { ok: true, direita: `terminal ${s.id}` };
      }
      const pagina = PAGINAS.find((x) => x === b.pagina);
      if (pagina === undefined) throw new Error(`diga o terminal (id) ou a página: ${PAGINAS.join(", ")}`);
      janela(b.maquina).webContents.send("ui:split", { alvo: pagina });
      return { ok: true, direita: pagina };
    }
    case "/juntar": {
      if (typeof b.id === "string") {
        const s = sessao(b.id); const w = BrowserWindow.fromId(s.winId);
        if (w !== null && !w.isDestroyed()) w.webContents.send("ui:split", { alvo: "juntar", id: s.id });
        return { ok: true };
      }
      const pagina = PAGINAS.find((x) => x === b.pagina);
      janela(b.maquina).webContents.send("ui:split", pagina === undefined || pagina === "vazia" ? { alvo: "juntar" } : { alvo: "juntar", pagina });
      return { ok: true };
    }
    case "/nota": {
      const texto = typeof b.texto === "string" ? b.texto.trim().slice(0, 500) : "";
      if (texto === "") throw new Error("falta texto");
      eventoDepuracao({ origem: "nota", dono: `${dono.rotulo} (${dono.origem})`, rota: "/nota", ok: true, ms: null, resumo: texto });
      // Com o modo desligado a nota vai só ao log: quem anunciou precisa saber que ninguém viu na tela.
      return { ok: true, visivel: modoDepuracao() };
    }
    case "/fechar": {
      const s = sessao(b.id);
      closeTerminal(s);
      return { ok: true, id: s.id };
    }
    case "/depuracao": {
      const e = b.on === true ? setDepuracao(true) : b.on === false ? setDepuracao(false) : b.on === null ? setDepuracao(null) : estadoDepuracao();
      return { ligado: e.ligado, gravado: e.gravado, padraoDaVariante: e.padraoDaVariante, forcado: e.forcado };
    }
    // O app em si (as mesmas ações do Remote Control do Rambox: estado, janela, página, tema, print).
    case "/app": {
      const foco = lastFocusedWindow();
      return { app: appTitle().replace(/\s.*$/, ""), variante: produto().variant, versao: app.getVersion(), tema: settingsView().theme, janelas: allMainWindows().map((w) => ({ maquina: hostOfWindow(w), foco: w === foco })), maquinas: [LOCAL_HOST, ...listSshHosts()] };
    }
    case "/janela": {
      const host = typeof b.maquina === "string" ? b.maquina : "";
      if (host !== LOCAL_HOST && !listSshHosts().includes(host)) throw new Error(`a máquina "${host}" não está no ~/.ssh/config (use "local" para este Mac); veja /app`);
      setLastHost(host);
      const existia = windowForHost(host) !== undefined;
      openMainWindow(host, "menu");
      return { ok: true, maquina: host, nova: !existia };
    }
    case "/pagina": {
      const pagina = PAGINAS_APP.find((p) => p === b.pagina);
      if (pagina === undefined) throw new Error(`página desconhecida; use uma de: ${PAGINAS_APP.join(", ")}`);
      const w = janela(b.maquina);
      sendWhenLoaded(w, "ui:abrir-pagina", { pagina });
      return { ok: true, pagina, maquina: hostOfWindow(w) };
    }
    case "/tema": {
      if (!isTheme(b.tema)) throw new Error("tema inválido: system, light ou dark");
      const view = updateSettings({ theme: b.tema as Theme });
      nativeTheme.themeSource = view.theme;
      broadcast("settings:changed", settingsView());
      return { ok: true, tema: view.theme };
    }
    case "/print": {
      const img = await janela(b.maquina).webContents.capturePage();
      return { png_base64: (img.getSize().width > 1280 ? img.resize({ width: 1280 }) : img).toPNG().toString("base64") };
    }
    default: throw Object.assign(new Error(`rota desconhecida: ${route}`), { status: 404 });
  }
}

let server: http.Server | null = null;
export async function startTermApi(): Promise<void> {
  if (server !== null) return;
  const sock = termSocketPath();
  try { fs.unlinkSync(sock); } catch { /* não existia */ }
  const s = http.createServer((req, res) => { void handle(req, res); });
  await new Promise<void>((resolve, reject) => { s.once("error", reject); s.listen(sock, () => { s.off("error", reject); resolve(); }); });
  fs.chmodSync(sock, 0o600);
  server = s;
  log(`[terminal] controle local em ${sock}`);
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const route = (req.url ?? "/").split("?")[0] ?? "/";
  const send = (code: number, body: unknown): void => { const s = JSON.stringify(body); res.writeHead(code, { "Content-Type": "application/json; charset=UTF-8", "Content-Length": Buffer.byteLength(s) }); res.end(s); };
  let body: Req = {};
  if (req.method === "POST") {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Req; } catch { return send(400, { erro: "JSON inválido" }); }
  }
  const dono = parseDono(req.headers["x-meu-bot-dono"]) ?? SEM_ID;
  const t0 = Date.now();
  try {
    const r = await act(route, body, dono);
    send(200, r);
    if (route !== "/terminais" && route !== "/ler") log(`[terminal] controle (${dono.origem}: ${dono.id}): ${route}${typeof body.id === "string" ? ` ${body.id}` : ""}`);
    // /nota já entrou no fluxo como "nota" dentro do act(); as outras rotas entram como ações do terminal (o /print sem o PNG).
    if (route !== "/nota") registrarAcao({ origem: "terminal", dono, rota: route, corpo: body as Record<string, unknown>, t0, resultado: route === "/print" ? { png: true } : r });
  } catch (e) {
    const st = (e as { status?: number }).status ?? 400;
    const msg = e instanceof Error ? e.message : String(e);
    registrarAcao({ origem: "terminal", dono, rota: route, corpo: body as Record<string, unknown>, t0, erro: msg });
    send(st, { erro: msg });
  }
}
