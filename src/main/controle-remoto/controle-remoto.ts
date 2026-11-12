/**
 * Controle externo (MCP): o servidor que deixa um cliente MCP deste Mac (Claude Code, Cursor…) controlar o app, no
 * molde do Remote Control do Rambox. HTTP em 127.0.0.1:<porta>, só `POST /mcp`, `Authorization: Bearer <token>`,
 * sem sessão (cada pedido é um JSON-RPC completo com resposta JSON), sem CORS. Toda ferramenta é repassada aos
 * sockets que o app já publica (term-api.ts, com as rotas do terminal e do app; nav-api.ts), exatamente como o
 * scripts/app-mcp.mjs faz de fora: o selo de quem mexeu, a posse das abas e o registro de depuração são os mesmos.
 * Desligado até a pessoa ligar em Configurações; o token fica gravado ao desligar (religar não obriga a reconfigurar
 * os clientes; "Gerar outro" é o que invalida).
 */
import { app, type BrowserWindow } from "electron";
import fs from "node:fs";
import http from "node:http";
import type { ControleRemotoView } from "../../shared/ipc";
import { registrarAcao } from "../app/depuracao";
import { getControleRemoto, setControleRemoto } from "../app/settings";
import { appTitle, produto } from "../app/variant";
import { allMainWindows, hostOfWindow, sendWhenLoaded } from "../app/windows";
import { log } from "../maquina/backend";
import { navSocketPath } from "../navegador/nav-api";
import { termSocketPath } from "../terminal/term-api";
import { estadoClientes } from "./clientes-mcp";
import { MAX_CORPO, configClaudeCode, configCursor, decidirNavegador, donoDe, erroRpc, gerarToken, pedidoOk, responderJsonRpc, roteador, urlMcp } from "./controle-remoto-core";

let servidor: http.Server | null = null;
let portaAtiva = 0;
let erroAtual: string | null = null;

/** Porta em uso (ou a que vai ser usada): a gravada, senão a padrão da variante. */
export const portaControleRemoto = (): number => getControleRemoto().porta ?? produto().portaMcp;

export function estadoControleRemoto(): ControleRemotoView {
  const c = getControleRemoto();
  const porta = portaControleRemoto();
  const nome = appTitle().replace(/\s.*$/, ""); // "meu-bot-staging 0.80.0" → "meu-bot-staging"
  return {
    ligado: c.ligado, execucao: c.execucao, porta, portaPadrao: produto().portaMcp, token: c.token, rodando: servidor !== null, erro: erroAtual, url: urlMcp(porta), nome,
    configClaudeCode: c.token === "" ? "" : configClaudeCode(nome, porta, c.token),
    configCursor: c.token === "" ? "" : configCursor(nome, porta, c.token),
    clientes: estadoClientes(nome, porta, c.token),
  };
}

/** Sobe o servidor com o que está gravado (gera o token se ainda não há). Porta ocupada vira `erro` no estado, não exceção. */
export async function startControleRemoto(): Promise<void> {
  if (servidor !== null) return;
  const c = getControleRemoto();
  if (c.token === "") setControleRemoto({ token: gerarToken() });
  const porta = portaControleRemoto();
  const s = http.createServer((req, res) => { void handle(req, res); });
  s.on("clientError", (err: NodeJS.ErrnoException, socket) => {
    const body = JSON.stringify(erroRpc(null, -32000, `pedido malformado (${err.code ?? "erro"})`));
    if (socket.writable) socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  });
  try {
    await new Promise<void>((resolve, reject) => { s.once("error", reject); s.listen(porta, "127.0.0.1", () => { s.off("error", reject); resolve(); }); });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    erroAtual = code === "EADDRINUSE" ? `a porta ${porta} já está em uso neste Mac; escolha outra` : `não subiu: ${e instanceof Error ? e.message : String(e)}`;
    log(`[mcp] controle externo não subiu em 127.0.0.1:${porta}: ${erroAtual}`);
    return;
  }
  servidor = s; portaAtiva = porta; erroAtual = null;
  log(`[mcp] controle externo em ${urlMcp(porta)}`);
}
export function stopControleRemoto(): void {
  const s = servidor; if (s === null) return;
  servidor = null; portaAtiva = 0;
  s.close();
  log("[mcp] controle externo desligado");
}
/** Porta ou token novos: derruba e sobe de novo (só se está ligado). */
export async function reiniciarControleRemoto(): Promise<void> {
  stopControleRemoto();
  erroAtual = null;
  if (getControleRemoto().ligado) await startControleRemoto();
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Só estes cabeçalhos: nada de CORS. Uma página no navegador não deve conseguir falar com o servidor.
  const send = (code: number, body: unknown): void => { const s = JSON.stringify(body); res.writeHead(code, { "Content-Type": "application/json; charset=UTF-8", "Content-Length": Buffer.byteLength(s) }); res.end(s); };
  const c = getControleRemoto();
  const ok = pedidoOk(req, portaAtiva, c.token);
  if (!ok.ok) {
    if (ok.status === 405) res.setHeader("Allow", "POST");
    send(ok.status, erroRpc(null, -32000, ok.erro));
    if (ok.status === 401 || ok.status === 403 || ok.status === 421) registrarAcao({ origem: "mcp", dono: null, rota: req.url ?? "/", corpo: {}, t0: Date.now(), erro: `${ok.status}: ${ok.erro}` });
    return;
  }
  const chunks: Buffer[] = []; let tamanho = 0;
  for await (const ch of req) { tamanho += (ch as Buffer).length; if (tamanho > MAX_CORPO) { send(413, erroRpc(null, -32000, "pedido grande demais")); req.destroy(); return; } chunks.push(ch as Buffer); }
  let msg: unknown;
  try { msg = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"); } catch { send(400, erroRpc(null, -32700, "JSON inválido")); return; }
  const dono = donoDe(req.headers["x-meu-bot-cliente"]);
  const r = await responderJsonRpc(msg, (nome, args) => chamar(nome, args, dono), { nome: estadoControleRemoto().nome, versao: app.getVersion(), execucao: c.execucao });
  if (r === null) { res.writeHead(202); res.end(); return; }
  send(200, r);
}

/* ---------- As ferramentas: tudo pelos sockets do próprio app ---------- */
type Dono = ReturnType<typeof donoDe>;
async function chamar(nome: string, args: Record<string, unknown>, dono: Dono): Promise<unknown> {
  const d = roteador(nome, args);
  return pedir(d.alvo === "terminal" ? termSocketPath() : await socketNavegador(d.maquina), d.rota, d.corpo, dono);
}

/** Quanto tempo esperar o socket do Navegador subir depois de pedir à janela que abra a aba. */
const NAV_ABRIR_PRAZO_MS = 15_000;
/**
 * O Navegador da máquina pedida (ou da única aberta). O socket só existe com a aba Navegador aberta e o 🤖 ligado;
 * com a aba fechada mas a janela da máquina aberta, pede ao renderer que abra a aba (em segundo plano) e espera o
 * socket. Sem socket no prazo, o 🤖 "agente pode usar" está desligado nessa máquina: só a pessoa religa.
 */
async function socketNavegador(maquina: string | undefined): Promise<string> {
  const janelas = allMainWindows().map((w) => ({ win: w, host: hostOfWindow(w) })).filter((x): x is { win: BrowserWindow; host: string } => x.host !== undefined);
  const abertos = janelas.map((x) => x.host).filter((h) => fs.existsSync(navSocketPath(h)));
  const d = decidirNavegador(maquina, abertos, janelas.map((x) => x.host));
  if (d.acao === "erro") throw new Error(d.erro);
  const caminho = navSocketPath(d.host);
  if (d.acao === "socket") return caminho;
  const win = janelas.find((x) => x.host === d.host)!.win;
  log(`[controle remoto] Navegador de ${d.host} fechado: pedindo à janela que abra a aba`);
  sendWhenLoaded(win, "browser:ask", { kind: "open" });
  const fim = Date.now() + NAV_ABRIR_PRAZO_MS;
  while (Date.now() < fim) {
    await new Promise((r) => setTimeout(r, 300));
    if (fs.existsSync(caminho)) return caminho;
  }
  throw new Error(`o Navegador de "${d.host}" não subiu em ${NAV_ABRIR_PRAZO_MS / 1000} s: o 🤖 "agente pode usar" deve estar desligado nessa máquina; ligue na aba Navegador`);
}

/** Pedido a um socket do próprio app, com a identidade de quem pede (o selo "✳️ Cursor (MCP) · digitou"). */
function pedir(socketPath: string, rota: string, corpo: Record<string, unknown> | undefined, dono: Dono): Promise<unknown> {
  const get = corpo === undefined; const data = get ? "" : JSON.stringify(corpo);
  const donoHdr = Buffer.from(JSON.stringify(dono), "utf8").toString("base64");
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: `/${rota}`, method: get ? "GET" : "POST", agent: false, headers: { "X-Meu-Bot-Dono": donoHdr, ...(get ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }) }, timeout: 90_000 }, (res) => {
      const chunks: Buffer[] = []; res.on("data", (ch: Buffer) => chunks.push(ch));
      res.on("end", () => {
        let j: { erro?: string };
        try { j = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { erro?: string }; } catch { reject(new Error(`resposta inválida do app (${res.statusCode})`)); return; }
        if (res.statusCode !== 200) { reject(new Error(j.erro ?? `HTTP ${res.statusCode}`)); return; }
        resolve(j);
      });
    });
    req.on("timeout", () => { req.destroy(new Error("o app não respondeu em 90 s")); });
    req.on("error", (e: NodeJS.ErrnoException) => reject(new Error(e.code === "ENOENT" || e.code === "ECONNREFUSED" ? "esse serviço do app não está de pé (abra a aba correspondente)" : e.message)));
    if (!get) req.write(data);
    req.end();
  });
}
