/**
 * Inspector (meu-bot-inspector-staging): sobe sob demanda a interface oficial do MCP Inspector pelo `npx`, já apontada
 * para o controle externo (MCP) deste app, e a encerra quando o app fecha. Um processo por app, dividido pelas
 * janelas. O que é decisão (versão, linha de comando, ambiente, leitura da saída, mensagens) está em
 * inspector-core.ts; aqui só o processo, a porta e os arquivos.
 *
 * O controle externo precisa estar de pé para o Inspector ter com quem falar: abrir a página o liga (e grava
 * "ligado", com a chave gerada se ainda não havia), sem mexer no `pedidoOk`: loopback e Bearer continuam exigidos.
 */
import { app } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { InspectorAbrir } from "../../shared/ipc";
import { getControleRemoto, setControleRemoto } from "../app/settings";
import { broadcast } from "../app/windows";
import { estadoControleRemoto, portaControleRemoto, startControleRemoto } from "../controle-remoto/controle-remoto";
import { gerarToken } from "../controle-remoto/controle-remoto-core";
import { findNode } from "../maquina/localBackend";
import { log } from "../maquina/backend";
import { INSPECTOR_VERSAO, PARTICAO_INSPECTOR, PRAZO_SUBIDA_MS, acharNpx, ambienteNpx, argsNpx, erroDaSubida, erroNodeAntigo, lerSaida, nodeServe, sessaoJson, urlPagina } from "./inspector-core";

interface Vivo { child: ChildProcess; porta: number; tokenApi: string; portaMcp: number; tokenMcp: string }
let vivo: Vivo | null = null;
let subindo: Promise<InspectorAbrir> | null = null;

const pasta = (): string => path.join(app.getPath("userData"), "inspector");
const arquivoSessao = (): string => path.join(pasta(), "sessao.json");

/** Uma porta livre em 127.0.0.1 (o Inspector recusa a porta 0: pedimos uma ao sistema e a soltamos). */
function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const a = s.address(); const p = typeof a === "object" && a !== null ? a.port : 0; s.close(() => { if (p > 0) resolve(p); else reject(new Error("o sistema não deu uma porta livre")); }); });
  });
}

const versaoDoNode = (node: string): Promise<string> => new Promise((resolve) => { execFile(node, ["--version"], { timeout: 10_000 }, (_err, stdout) => resolve(String(stdout))); });

/** O npx sobe o node do Inspector como filho: o processo nasce líder de grupo e o grupo inteiro é encerrado. */
function matar(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try { process.kill(-pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* já saiu */ } }
}

/** Liga o controle externo se ainda não está de pé; devolve o erro em pt-BR quando ele não sobe (porta ocupada…). */
async function garantirControle(): Promise<string | null> {
  if (!estadoControleRemoto().rodando) {
    const c = getControleRemoto();
    if (!c.ligado || c.token === "") setControleRemoto({ ligado: true, ...(c.token === "" ? { token: gerarToken() } : {}) });
    await startControleRemoto();
    broadcast("controle-remoto:changed", estadoControleRemoto());
  }
  const e = estadoControleRemoto();
  return e.rodando ? null : `O controle externo (MCP) deste app não subiu: ${e.erro ?? "motivo desconhecido"}. Veja em Configurações › Controle externo (MCP).`;
}

async function subir(): Promise<InspectorAbrir> {
  const semControle = await garantirControle();
  if (semControle !== null) return { ok: false, erro: semControle };
  const portaMcp = portaControleRemoto(); const tokenMcp = getControleRemoto().token;
  // Já de pé e apontado para a porta e a chave de agora: a mesma interface serve a todas as janelas.
  if (vivo !== null && vivo.portaMcp === portaMcp && vivo.tokenMcp === tokenMcp) return { ok: true, url: urlPagina(vivo.porta, portaMcp, vivo.tokenApi), particao: PARTICAO_INSPECTOR, versao: INSPECTOR_VERSAO };
  pararInspector(); // a chave ou a porta mudaram em Configurações: sobe de novo com o arquivo de sessão novo

  const node = findNode();
  const achado = acharNpx(node, (p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }, process.env["MEU_BOT_INSPECTOR_NPX"]);
  if ("erro" in achado) { log(`[inspector] sem npx (node=${node ?? "não achado"})`); return { ok: false, erro: achado.erro }; }
  if (node !== null) { const v = await versaoDoNode(node); if (!nodeServe(v)) { log(`[inspector] node antigo: ${v.trim()}`); return { ok: false, erro: erroNodeAntigo(v) }; } }

  const porta = await portaLivre();
  const tokenApi = randomBytes(32).toString("hex");
  fs.mkdirSync(pasta(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(arquivoSessao(), sessaoJson(portaMcp, tokenMcp), { mode: 0o600 });
  fs.chmodSync(arquivoSessao(), 0o600); // o `mode` do writeFile só vale ao criar
  const PATH = [achado.pasta, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env["PATH"] ?? ""].join(":");
  const child = spawn(achado.npx, argsNpx(arquivoSessao()), { cwd: pasta(), detached: true, stdio: ["ignore", "pipe", "pipe"], env: ambienteNpx(process.env, { porta, tokenApi, pastaDados: pasta(), path: PATH }) });
  log(`[inspector] subindo o MCP Inspector ${INSPECTOR_VERSAO} em 127.0.0.1:${porta} (npx=${achado.npx}, pid ${child.pid ?? "?"})`);

  return new Promise<InspectorAbrir>((resolve) => {
    let saida = ""; let decidido = false;
    const fim = (r: InspectorAbrir): void => { if (decidido) return; decidido = true; clearTimeout(prazo); resolve(r); };
    const falhou = (codigo: number | null): void => { const erro = erroDaSubida(saida, codigo); log(`[inspector] não subiu: ${erro}`); fim({ ok: false, erro }); };
    const prazo = setTimeout(() => { matar(child); falhou(null); }, PRAZO_SUBIDA_MS);
    const ler = (ch: Buffer): void => {
      if (decidido) return;
      saida = (saida + ch.toString("utf8")).slice(-16_000);
      if (lerSaida(saida) === null) return;
      vivo = { child, porta, tokenApi, portaMcp, tokenMcp };
      log(`[inspector] no ar em 127.0.0.1:${porta}, ligado a 127.0.0.1:${portaMcp}/mcp`);
      fim({ ok: true, url: urlPagina(porta, portaMcp, tokenApi), particao: PARTICAO_INSPECTOR, versao: INSPECTOR_VERSAO });
    };
    child.stdout?.on("data", ler); child.stderr?.on("data", ler);
    child.on("error", (e) => { saida += `\n${e.message}`; falhou(null); });
    child.on("exit", (code) => {
      if (vivo?.child === child) { vivo = null; log(`[inspector] o processo saiu (${code ?? "sinal"})`); }
      falhou(code ?? 1);
    });
  });
}

/** Sobe (ou reaproveita) o Inspector e devolve o endereço da interface, ou o que falta, em pt-BR. Chamadas juntas dividem a mesma subida. */
export function abrirInspector(): Promise<InspectorAbrir> {
  if (subindo !== null) return subindo;
  const p = subir().catch((e: unknown): InspectorAbrir => ({ ok: false, erro: `O Inspector não subiu: ${e instanceof Error ? e.message : String(e)}` })).finally(() => { if (subindo === p) subindo = null; });
  subindo = p;
  return p;
}

/** Encerra o processo e apaga o arquivo de sessão (ele guarda a chave do controle externo). Chamado ao sair do app. */
export function pararInspector(): void {
  if (vivo !== null) { matar(vivo.child); vivo = null; log("[inspector] encerrado"); }
  try { fs.rmSync(arquivoSessao(), { force: true }); } catch { /* sem o arquivo */ }
}
