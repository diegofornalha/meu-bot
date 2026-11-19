/**
 * Gmail para o agente (31 out, Pro): as mesmas ações da página Gmail num socket Unix 0600 deste Mac, que o túnel
 * reverso leva a 127.0.0.1:<porta> da máquina, onde `gmail-mcp.mjs` as apresenta ao Claude. O token nunca sai do Mac:
 * a máquina só pede "liste", "leia", "lixeira" e recebe o conteúdo. Mesmo molde de nav-api.ts e do "agente pode usar"
 * de browser.ts, com uma diferença: não depende de janela aberta. A chave é **ligada por padrão** (31 out): com a conta
 * conectada e o Pro na máquina, sobe sozinha quando o túnel fica pronto, e para quando a conta é desconectada; o app
 * lembra só as máquinas em que a pessoa desligou (`gmailAgentDesligados`).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { controlDir } from "../app/control-dir";
import { isGmailAgentHost, setGmailAgentHost } from "../app/settings";
import { registrarAcao } from "../app/depuracao";
import { sendToHost } from "../app/windows";
import { assertAcesso } from "../licenca/acesso";
import { caps } from "../app/variant";
import { log, onReverseState, onTunnelState, reversePort, setReverseWanted } from "../maquina/tunnel";
import { DONO_SEM_IDENTIDADE, parseDono, type Dono } from "../navegador/nav-donos-core";
import type { GmailAgenteState } from "../../shared/ipc";
import { gmailApagar, gmailLer, gmailListar, gmailRestaurar } from "./apis";
import { contaStatus } from "./conta-google";
import { validaBusca, validaId, validaMax, validaPagina } from "./gmail-core";

const CHAVE = "gmail";
/** Rota barata que prova o caminho inteiro (o túnel sonda por ela antes de dizer "pronto"). */
const SONDA = "/status";
const sanit = (h: string): string => h.replace(/[^A-Za-z0-9_-]/g, "_");
export const gmailSocketPath = (host: string): string => path.join(controlDir(), `gmail-${sanit(host)}.sock`);

const servers = new Map<string, http.Server>();
/** Sobe o serviço desta máquina (uma vez); devolve o caminho do socket que o -R vai encaminhar. */
export async function startGmailApi(host: string): Promise<string> {
  const sock = gmailSocketPath(host);
  if (servers.has(host)) return sock;
  try { fs.unlinkSync(sock); } catch { /* não existia */ }
  const server = http.createServer((req, res) => { void handle(host, req, res); });
  server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
    log(`[gmail ${host}] pedido malformado: ${err.code ?? err.message}`);
    const body = JSON.stringify({ erro: `pedido malformado (${err.code ?? "erro"}); tente de novo` });
    if (socket.writable) socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(sock, () => { server.off("error", reject); resolve(); }); });
  fs.chmodSync(sock, 0o600);
  servers.set(host, server);
  log(`[gmail ${host}] ações do agente em ${sock}`);
  return sock;
}
export function stopGmailApi(host: string): void {
  const s = servers.get(host); if (s === undefined) return;
  servers.delete(host); s.close();
  try { fs.unlinkSync(gmailSocketPath(host)); } catch { /* ok */ }
}

type Req = Record<string, unknown>;
const erro = (msg: string, status: number): Error => Object.assign(new Error(msg), { status });
/** Uma ação. `/status` responde sempre; as outras exigem a conta conectada e autorizada. */
async function act(host: string, route: string, b: Req, dono: Dono): Promise<unknown> {
  const st = contaStatus(host);
  const conectada = st.conectado && !st.precisaReconectar;
  if (route === "/status") return { conta: st.perfil?.email ?? null, conectada, gmailEscreve: st.gmailEscreve };
  if (!conectada) throw erro(st.conectado ? "a Conta Google desta máquina precisa reautorizar: peça à pessoa que clique em Reconectar na página Conta Google" : "a Conta Google não está conectada neste Mac: peça à pessoa que entre na página Conta Google do app", 409);
  const id = (): string => { const v = validaId(b["id"]); if (v === null) throw erro("id de mensagem inválido (use o id que veio em listar)", 400); return v; };
  const quem = `pedido pela ${dono.rotulo}`;
  switch (route) {
    case "/listar": return gmailListar(host, { busca: validaBusca(b["busca"]), max: validaMax(b["max"]), pagina: validaPagina(b["pagina"]) });
    case "/ler": return gmailLer(host, id());
    case "/apagar": return gmailApagar(host, id(), quem);
    case "/restaurar": return gmailRestaurar(host, id(), quem);
    default: throw erro(`rota desconhecida: ${route}`, 404);
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
  if (!vistos.has(dono.id)) { vistos.add(dono.id); log(`[gmail ${host}] conversa nova usando o Gmail: ${dono.origem} · ${dono.id} · ${dono.rotulo}`); }
  const t0 = Date.now();
  try {
    // Recurso Pro: a mesma trava da página. Sem o plano, a máquina recebe 403 e o agente avisa a pessoa.
    if (route !== "/status") await assertAcesso(host).catch((e: unknown) => { throw erro(e instanceof Error ? e.message : String(e), 403); });
    const r = await act(host, route, body, dono);
    send(200, r);
    registrarAcao({ origem: "gmail", dono, rota: route, corpo: body as Record<string, unknown>, t0, resultado: r });
  } catch (e) {
    const st = (e as { status?: number }).status ?? 400;
    const msg = (e instanceof Error ? e.message : String(e)).replace(/^GMAIL_SEM_PERMISSAO$/, "a autorização desta conta é de antes da lixeira: peça à pessoa que reconecte a Conta Google uma vez").replace(/^GOOGLE_CONTA_DESCONECTADA$/, "a conta Google desconectou; peça à pessoa que entre de novo na página Conta Google") || "a ação falhou sem mensagem";
    log(`[gmail ${host}] ${route} (${dono.origem}: ${dono.id}) → ${st}: ${msg.slice(0, 200)}`);
    registrarAcao({ origem: "gmail", dono, rota: route, corpo: body as Record<string, unknown>, t0, erro: msg });
    send(st, { erro: msg });
  }
}

// ---- "O agente pode ler seus e-mails" (página E-mail): socket + -R (chave "gmail"); o backend recebe a porta em X-Meu-Bot-Gmail-Port.
const agentOn = new Set<string>();
const agentState = new Map<string, GmailAgenteState>();
const tell = (host: string, st: GmailAgenteState): void => { agentState.set(host, st); sendToHost(host, "gmail:agent", st); };
onReverseState((host, chave, state, port) => { if (chave === CHAVE && agentOn.has(host)) tell(host, { on: true, state, port }); });
function ligar(host: string): void {
  if (agentOn.has(host)) return;
  agentOn.add(host);
  tell(host, { on: true, state: "connecting", port: null });
  void startGmailApi(host).then((sock) => setReverseWanted(host, sock, { chave: CHAVE, sonda: SONDA })).catch((e: unknown) => { log(`[gmail ${host}] serviço do agente não subiu: ${e instanceof Error ? e.message : String(e)}`); tell(host, { on: true, state: "down", port: null }); });
}
/** Desliga o socket e o -R sem mexer na escolha lembrada (a conta desconectou, a máquina saiu). */
export function gmailAgenteParar(host: string): void {
  if (!agentOn.has(host)) return;
  agentOn.delete(host);
  setReverseWanted(host, null, { chave: CHAVE });
  stopGmailApi(host);
  tell(host, { on: false, state: "down", port: null });
}
/** A chave da página: liga (e lembra) ou desliga (e esquece). */
export function gmailAgente(host: string, on: boolean): GmailAgenteState {
  setGmailAgentHost(host, on);
  if (on) ligar(host); else gmailAgenteParar(host);
  return gmailAgenteInfo(host);
}
export const gmailAgenteInfo = (host: string): GmailAgenteState => agentState.get(host) ?? { on: isGmailAgentHost(host), state: "down", port: null };
/** Porta remota a mandar ao backend neste turno (só com a chave ligada e o -R de pé). */
export const gmailAgentePort = (host: string): number | null => (agentOn.has(host) ? reversePort(host, CHAVE) : null);
/** Religa sozinho: chave lembrada + conta conectada. A página chama ao abrir; o túnel chama ao ficar pronto. */
export async function gmailAgenteReligar(host: string): Promise<void> {
  if (!caps().agenteNavegador || !isGmailAgentHost(host) || agentOn.has(host) || !contaStatus(host).conectado) return;
  // Mesmo portão do botão: sem o Pro na máquina a ponte não sobe sozinha (o botão explica, a página mostra o bloqueio).
  try { await assertAcesso(host); } catch { return; }
  if (agentOn.has(host)) return;
  log(`[gmail ${host}] agente do chat ligado sozinho (conta conectada, Pro em vigor)`);
  ligar(host);
}
onTunnelState((host, state) => { if (state === "ready") void gmailAgenteReligar(host); });
