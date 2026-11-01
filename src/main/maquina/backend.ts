import { LOCAL_HOST } from "./localBackend";
import os from "node:os";
import { createHash } from "node:crypto";
import { appTitle } from "../app/variant";
import { app } from "electron";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { lerCotaJson } from "../agente/espaco-core";
import type { AlertPrefs, AccountStatus, ClaudeSessionRef, BackendModel, ContaClaude, ContasClaudeView, LicenseView, LimiaresClaude, ToolEvent } from "../../shared/ipc";
import type { MainEventChannel, MainEvents } from "../../shared/ipc";
import { persistConversations, saveTranscript, type BackendMessage, type Conversation } from "../conversa/conversation";
import { alreadySeenPrefix, buildSummaryRequest, estimateTokens, planContext, toWire, validateSummary, type OutgoingMessage } from "../conversa/context";
import { applyOps, buildMemoryRequest, getMemory, memorySystemMessage, NOTAS_MAX, parseOps, PERFIL_MAX, setMemory } from "../conversa/memory";
import { getBackendPort, getContextBudget, getMemoryEveryTurns } from "../app/settings";
import { ensureTunnel, execNaMaquina, markDegraded, TunnelFatalError } from "./tunnel";
import { COMANDO_LOG_BACKEND, classificarPreflight, detalheTentativa, dicaDoLog, erroFinal, podeDiagnosticar, textoPreflight, type FalhaPreflight } from "./preflight-core";
import { evento } from "../app/depuracao";
import { netState, noteNetworkError } from "../app/net";
import { browserAgentPort } from "../navegador/browser";
import { gmailAgentePort } from "../google/gmail-api";
import { looksLikeOffline, offlineMessage } from "../app/net-core";
import { broadcast, sendToHost } from "../app/windows";

/** Entrega eventos à janela da máquina, resolvida a cada envio: a janela pode fechar no meio do turno. */
class Sender {
  constructor(private readonly host: string) {}
  send<K extends MainEventChannel>(channel: K, payload: MainEvents[K]): void {
    sendToHost(this.host, channel, payload);
  }
}

const MODEL_LABEL: Record<BackendModel, string> = {
  claudecode: "claudecode (Claude Code, chat)", agente: "agente (Claude Code com ferramentas, bypass)",
  "rene-dm": "rene-dm (agente René, Claude Code)", rene: "rene (agente René, Claude Code)", "grok-4": "grok-4 (Grok da xAI)",
};
/** Nota invisível na tela, enviada junto da próxima mensagem depois de trocar o modelo. */
const switchNote = (from: BackendModel, to: BackendModel): string =>
  `[Nota do app meu-bot, não é fala do usuário: o usuário acabou de trocar o modelo desta conversa de ${MODEL_LABEL[from]} para ${MODEL_LABEL[to]}. As respostas anteriores foram do modelo anterior, não suas. Daqui em diante quem responde é ${to}; não atribua a si o que foi dito antes, e se perguntarem qual modelo é você, responda ${to}.]`;

/** agente/rene/rene-dm rodam ferramentas e podem levar minutos; claudecode é chat puro. */
const timeoutFor = (model: BackendModel): number => (model === "claudecode" || model === "grok-4" ? 120_000 : 600_000);

interface ChatCompletion {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  error?: { message?: string; type?: string; code?: string };
}

const CONNECT_PHASE_MS = 3000;

/** Log simples em userData/meu-bot.log para diagnosticar falhas de rede. */
export function log(line: string): void {
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "meu-bot.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* log é cortesia */
  }
}

const errCode = (err: unknown): string =>
  (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code ?? "";

/** Explica o erro de rede com a causa por trás e o código, para diagnóstico. */
function describeFetchError(err: unknown, model: BackendModel): string {
  const code = errCode(err);
  if (looksLikeOffline({ code, text: err instanceof Error ? err.message : null })) return offlineMessage("chat");
  if (code === "ETIMEDOUT_LOCAL" || (err instanceof Error && err.name === "AbortError")) return `O backend não respondeu em ${timeoutFor(model) / 1000}s.`;
  if (code === "ECONNREFUSED") return "A conexão na porta local foi recusada (ECONNREFUSED): o túnel SSH caiu. Vou reabrir na próxima mensagem.";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET" || code === "EPIPE") {
    return `A conexão com o backend foi cortada no meio da resposta (${code}). Causa provável: o backend da máquina caiu ou reiniciou, a VM pausou, ou o túnel SSH fechou o canal. Tente de novo.`;
  }
  if (code === "ETIMEDOUT" || code === "EHOSTUNREACH") return "A VM não respondeu pela rede (Tailscale oscilando).";
  const msg = err instanceof Error ? err.message : String(err);
  return code ? `${msg} (${code})` : msg;
}

const isConnectionError = (err: unknown): boolean =>
  ["ECONNREFUSED", "ECONNRESET", "UND_ERR_SOCKET", "EPIPE", "ETIMEDOUT", "EHOSTUNREACH"].includes(errCode(err));

interface HttpReply {
  status: number;
  /** Corpo JSON completo (resposta não-stream ou erro). Vazio quando veio SSE. */
  body: string;
  /** Tokens informados pelo backend no chunk de usage (SSE ao vivo). */
  usage?: { prompt: number; completion: number } | undefined;
  /** Texto acumulado dos deltas quando veio SSE. */
  streamed: string;
  finishReason: string | null;
  headers: http.IncomingHttpHeaders;
}

interface PostOptions {
  overallMs: number;
  idleMs: number;
  signal?: AbortSignal | undefined;
  onDelta?: ((text: string) => void) | undefined;
  /** Aviso do backend no meio do stream (fallback de provedor). */
  /** `tipo` "conta" = outra conta do Claude assumiu a mesma conversa (não é degradação). */
  onNotice?: ((text: string, tipo?: string) => void) | undefined;
  /** Atividade do agente (ferramenta usada / resultado), chunk x_meu_bot.tool. */
  onTool?: ((tool: ToolEvent) => void) | undefined;
  extraHeaders?: Record<string, string> | undefined;
}

/**
 * POST pelo túnel usando node:http. Pede SSE ao vivo; se o backend responder JSON (backend antigo,
 * 401, 503) cai no caminho normal. Sem o limite oculto de 300 s do fetch, e o erro traz o código.
 */
function httpPostStream(port: number, pathName: string, apiKey: string, body: string, opts: PostOptions): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathName, method: "POST",
        headers: {
          "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${apiKey}`,
          Accept: "text/event-stream, application/json", "X-Stream-Mode": "live", ...(opts.extraHeaders ?? {}),
        } },
      (res) => {
        const isSse = (res.headers["content-type"] ?? "").includes("text/event-stream");
        const chunks: Buffer[] = [];
        let buffer = "";
        let streamed = "";
        let finishReason: string | null = null;
        let usage: { prompt: number; completion: number } | undefined;
        let streamError: Error | null = null;
        let idle: NodeJS.Timeout | null = null;
        const bumpIdle = (): void => {
          if (idle !== null) clearTimeout(idle);
          idle = setTimeout(() => req.destroy(Object.assign(new Error("sem dados"), { code: "ETIMEDOUT_LOCAL" })), opts.idleMs);
        };
        const handleEvent = (block: string): void => {
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") return;
            let chunk: { choices?: { delta?: { content?: string }; finish_reason?: string | null }[]; error?: { message?: string }; x_meu_bot?: { fallback?: { from: string; to: string; reason: string; tipo?: string }; tool?: ToolEvent }; usage?: { prompt_tokens?: number; completion_tokens?: number } };
            try { chunk = JSON.parse(data) as typeof chunk; } catch { continue; }
            const fb = chunk.x_meu_bot?.fallback;
            if (fb !== undefined) {
              if (fb.tipo === "conta") opts.onNotice?.(`conta "${fb.from}" no limite de uso; a conversa continua na conta "${fb.to}"`, "conta");
              else opts.onNotice?.(`${fb.from} falhou (${fb.reason}); respondendo com ${fb.to}`);
            }
            const tool = chunk.x_meu_bot?.tool;
            if (tool !== undefined && (tool.kind === "use" || tool.kind === "result")) opts.onTool?.(tool);
            const choice = chunk.choices?.[0];
            if (typeof choice?.delta?.content === "string" && choice.delta.content !== "") {
              streamed += choice.delta.content;
              opts.onDelta?.(choice.delta.content);
            }
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            if (chunk.usage !== undefined) usage = { prompt: chunk.usage.prompt_tokens ?? 0, completion: chunk.usage.completion_tokens ?? 0 };
            if (chunk.error?.message) streamError = new Error(chunk.error.message);
          }
        };
        res.on("data", (c: Buffer) => {
          bumpIdle();
          if (!isSse) { chunks.push(c); return; }
          buffer += c.toString("utf8");
          let sep = buffer.indexOf("\n\n");
          while (sep !== -1) {
            handleEvent(buffer.slice(0, sep));
            buffer = buffer.slice(sep + 2);
            sep = buffer.indexOf("\n\n");
          }
        });
        res.on("end", () => {
          if (idle !== null) clearTimeout(idle);
          if (isSse && buffer.trim() !== "") handleEvent(buffer);
          if (streamError !== null && streamed === "") { reject(streamError); return; }
          resolve({ status: res.statusCode ?? 0, body: isSse ? "" : Buffer.concat(chunks).toString("utf8"), streamed, finishReason, headers: res.headers, usage });
        });
        res.on("error", reject);
        bumpIdle();
      },
    );
    req.setTimeout(opts.overallMs, () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT_LOCAL" })));
    req.on("error", reject);
    if (opts.signal !== undefined) {
      if (opts.signal.aborted) { req.destroy(Object.assign(new Error("cancelado"), { code: "ABORTED" })); return; }
      opts.signal.addEventListener("abort", () => req.destroy(Object.assign(new Error("cancelado"), { code: "ABORTED" })), { once: true });
    }
    req.end(body);
  });
}

const IDLE_MS = 60_000;

async function postWithReconnect(host: string, localPort: number, apiKey: string, model: BackendModel, messages: OutgoingMessage[], out: Sender | null, signal?: AbortSignal, onDelta?: (text: string) => void, extraHeaders?: Record<string, string>, onNotice?: (text: string, tipo?: string) => void, onTool?: (tool: ToolEvent) => void): Promise<HttpReply> {
  const body = JSON.stringify({ model, messages: toWire(messages), stream: true });
  const opts: PostOptions = { overallMs: timeoutFor(model), idleMs: IDLE_MS, signal, onDelta, onNotice, onTool, extraHeaders };
  const started = Date.now();
  try {
    return await httpPostStream(localPort, "/v1/chat/completions", apiKey, body, opts);
  } catch (err) {
    log(`POST falhou após ${Date.now() - started} ms: ${errCode(err)} ${err instanceof Error ? err.message : String(err)}`);
    const early = Date.now() - started < CONNECT_PHASE_MS;
    if (!isConnectionError(err) || !early) throw err;
    out?.send("backend:status", { host, state: "connecting", detail: "túnel caiu; reabrindo…" });
    markDegraded(host, errCode(err));
    // A mensagem ainda não chegou ao backend (fase de conexão): reabrir e mandar de novo é seguro.
    const fresh = await readyTunnel(host, out, signal);
    out?.send("backend:status", { host, state: "ready", detail: `túnel reaberto · ${model}` });
    return httpPostStream(fresh.localPort, "/v1/chat/completions", fresh.apiKey, body, opts);
  }
}

const PREFLIGHT_MS = 8000;

/**
 * GET /v1/models pelo túnel: barato e detecta um túnel meio morto depois de uma pausa da VM. null = respondeu; senão a
 * falha classificada (preflight-core.ts), para o log e a pessoa saberem se foi o backend, o túnel ou um timeout.
 */
function preflight(localPort: number, apiKey: string): Promise<FalhaPreflight | null> {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: localPort, path: "/v1/models", method: "GET", headers: { Authorization: `Bearer ${apiKey}` } }, (res) => {
      res.resume();
      const status = res.statusCode ?? 0;
      resolve(status < 500 ? null : classificarPreflight(null, status));
    });
    req.setTimeout(PREFLIGHT_MS, () => { req.destroy(); resolve(classificarPreflight({ code: "ETIMEDOUT_LOCAL" }, null)); });
    req.on("error", (e) => resolve(classificarPreflight(e as { code?: string; message?: string; name?: string }, null)));
    req.end();
  });
}

/** Quando foi o último diagnóstico por máquina (um por episódio; preflight ok zera). */
const diagnosticoEm = new Map<string, number>();

/**
 * O backend não respondeu na porta com o túnel de pé: lê na máquina o estado do serviço e as últimas linhas do log
 * (journalctl ou backend.log; no Mac, backend-local.log), grava tudo no meu-bot.log, manda o resumo à faixa de depuração
 * e devolve a dica ("MODULE_NOT_FOUND ./gmail") para a mensagem de erro. Nunca lança.
 */
async function diagnosticarBackend(host: string, porta: number): Promise<string | null> {
  const t0 = Date.now();
  let linhas: string[];
  try {
    if (host === LOCAL_HOST) {
      const p = path.join(app.getPath("userData"), "backend-local.log");
      linhas = fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").slice(-40) : ["(sem backend-local.log)"];
    } else {
      const r = await execNaMaquina(host, COMANDO_LOG_BACKEND, 10_000);
      linhas = `${r.stdout}\n${r.stderr}`.split("\n");
    }
  } catch (e) {
    linhas = [`(não consegui ler o log do backend: ${e instanceof Error ? e.message : String(e)})`];
  }
  linhas = linhas.map((l) => l.trimEnd()).filter((l) => l !== "");
  const dica = dicaDoLog(linhas);
  log(`[${host}] log do backend (porta ${porta}, ${linhas.length} linhas): ${dica ?? "sem erro reconhecido"}`);
  for (const l of linhas.slice(-40)) log(`[${host}]   ${l}`);
  evento({ origem: "main", dono: null, rota: `backend/log ${host}`, ok: false, ms: Date.now() - t0, resumo: dica ?? "backend parado: sem erro reconhecido nas últimas linhas do log", detalhe: { porta, linhas: linhas.slice(-15) } });
  return dica;
}

/** Num turno interativo, por quanto tempo insistir em reabrir o túnel antes de devolver erro. */
const RECONNECT_WINDOW_MS = 75_000;
/** Espera entre tentativas (o último valor repete). Um blip do Tailscale costuma durar 10–40 s. */
const RECONNECT_DELAYS_MS = [3_000, 5_000, 8_000, 12_000, 15_000];

const sleepAbortable = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(Object.assign(new Error("cancelado"), { code: "ABORTED" })); return; }
  const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  function onAbort(): void { clearTimeout(t); reject(Object.assign(new Error("cancelado"), { code: "ABORTED" })); }
  signal?.addEventListener("abort", onAbort, { once: true });
});

/**
 * Garante um túnel que responde. Num turno interativo (há janela ouvindo) insiste por até
 * RECONNECT_WINDOW_MS com recuo progressivo — um blip do Tailscale derrubava a pergunta e pedia para a
 * pessoa tentar "em um minuto", quando a conexão seguinte entrava sozinha em segundos. Tarefas de fundo
 * (resumo, memória) ficam com uma reabertura só, como antes. Parar cancela a espera.
 */
async function readyTunnel(host: string, out: Sender | null, signal?: AbortSignal): Promise<{ localPort: number; apiKey: string }> {
  const status = (detail: string): void => out?.send("backend:status", { host, state: "connecting", detail });
  const interactive = out !== null;
  const deadline = Date.now() + RECONNECT_WINDOW_MS;
  const porta = getBackendPort(host); const local = host === LOCAL_HOST;
  let attempt = 0; let lastErr: unknown = null;
  // Duas causas com cara diferente: o SSH não entrou (sshErr) ou entrou e o backend não respondeu na porta (falha).
  let sshErr: string | null = null; let falha: FalhaPreflight | null = null; let dica: Promise<string | null> | null = null;
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error("cancelado"), { code: "ABORTED" });
    sshErr = null; falha = null; lastErr = null;
    try {
      const tunnel = await ensureTunnel(host, porta, status);
      falha = await preflight(tunnel.localPort, tunnel.apiKey);
      if (falha === null) { diagnosticoEm.delete(host); if (host !== LOCAL_HOST && !announced.has(host)) setTimeout(() => announceMachine(host), 0); return tunnel; }
    } catch (err) {
      if (err instanceof TunnelFatalError) throw err;
      lastErr = err; sshErr = err instanceof Error ? err.message : String(err);
    }
    attempt += 1;
    const texto = falha !== null ? textoPreflight(falha, porta, local) : sshErr ?? "preflight";
    markDegraded(host, texto);
    // Sem internet não adianta insistir 75 s culpando a VM: a faixa OFFLINE explica, e a volta da rede reabre.
    if (lastErr !== null && (await noteNetworkError(lastErr))) throw Object.assign(new Error(offlineMessage("tunnel")), { code: "OFFLINE" });
    if (netState().online === false) throw Object.assign(new Error(offlineMessage("tunnel")), { code: "OFFLINE" });
    // Backend parado com o túnel de pé: busca o erro real do serviço uma vez por episódio, sem segurar o laço.
    if (falha !== null && dica === null && podeDiagnosticar(diagnosticoEm.get(host) ?? null, Date.now())) { diagnosticoEm.set(host, Date.now()); dica = diagnosticarBackend(host, porta); }
    const left = deadline - Date.now();
    if (!interactive ? attempt >= 2 : left <= 0) break;
    const wait = Math.min(RECONNECT_DELAYS_MS[Math.min(attempt - 1, RECONNECT_DELAYS_MS.length - 1)]!, Math.max(left, 1_000));
    status(detalheTentativa(falha, sshErr, porta, Math.round(wait / 1000), attempt, local));
    log(`[${host}] ${falha !== null ? "preflight falhou" : "túnel sem resposta"} (${attempt}ª vez): ${texto}; nova tentativa em ${wait} ms`);
    await sleepAbortable(wait, signal);
  }
  const d = dica !== null ? await Promise.race([dica, new Promise<null>((r) => setTimeout(() => r(null), 3_000))]) : null;
  throw Object.assign(new Error(erroFinal({ falha, sshErr, porta, segundos: Math.round(RECONNECT_WINDOW_MS / 1000), interativo: interactive, dica: d, local })), { code: falha !== null ? "BACKEND_PARADO" : "TUNEL" });
}

/** Uma chamada completa ao backend (túnel pronto + POST + parse). Reutilizada pelo chat e pelas tarefas de fundo. */
export async function chatCompletion(host: string, model: BackendModel, messages: OutgoingMessage[], out: Sender | null, signal?: AbortSignal, onDelta?: (text: string) => void, extraHeaders?: Record<string, string>, onNotice?: (text: string, tipo?: string) => void, onTool?: (tool: ToolEvent) => void): Promise<{ text: string; finishReason: string; streamed: boolean; resumed: boolean; provider: string; usage?: { prompt: number; completion: number } | undefined }> {
  const tunnel = await readyTunnel(host, out, signal);
  out?.send("backend:status", { host, state: "ready", detail: `túnel ativo · ${model}` });
  const t0 = Date.now();
  const res = await postWithReconnect(host, tunnel.localPort, tunnel.apiKey, model, messages, out, signal, onDelta, extraHeaders, onNotice, onTool);
  const streamed = res.body === "";
  const resumed = String(res.headers["x-session-resumed"] ?? "") === "true";
  // Quem respondeu de fato (X-Provider do backend): a prova é o cabeçalho, não o que o modelo diz de si.
  const providerHdr = res.headers["x-provider"];
  const provider = typeof providerHdr === "string" && providerHdr !== "" ? providerHdr : model;
  log(`POST ${model} ${res.status} em ${Date.now() - t0} ms (${messages.length} msgs, ${streamed ? `sse ${res.streamed.length} chars` : `${res.body.length} bytes`}${resumed ? ", sessão retomada" : ""})`);
  if (streamed) return { text: res.streamed, finishReason: res.finishReason ?? "stop", streamed: true, resumed, provider, usage: res.usage };
  let data: ChatCompletion = {};
  try { data = JSON.parse(res.body) as ChatCompletion; } catch { data = {}; }
  if (res.status < 200 || res.status >= 300) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    // O `code` do backend (model_limit, conta_limite, auth…) segue junto: a tela explica o motivo em vez do texto cru.
    const comCodigo = (e: Error): Error => Object.assign(e, { backendCode: typeof data.error?.code === "string" ? data.error.code : undefined });
    if (res.status === 401) throw comCodigo(new Error(`Backend recusou a chave: ${msg}`));
    if (res.status === 503) throw comCodigo(new Error(`Backend indisponível: ${msg}`));
    throw comCodigo(new Error(`Backend respondeu ${res.status}: ${msg}`));
  }
  return { text: data.choices?.[0]?.message?.content ?? "", finishReason: data.choices?.[0]?.finish_reason ?? "stop", streamed: false, resumed, provider };
}

/** GET /v1/meu-bot/status pelo túnel: conta e limites do Claude na máquina. null se o backend não tem o endpoint. */
/**
 * A pessoa excluiu a conversa: pede ao backend da máquina para apagar a transcrição do Claude Code dela (os
 * dois perfis) e esquecer a sessão. Backend antigo (sem a rota) ou sem túnel: null, e nada mais acontece.
 */
export async function deleteBackendSession(host: string, conversationId: string): Promise<number | null> {
  let tunnel: { localPort: number; apiKey: string };
  try { tunnel = await readyTunnel(host, null); } catch { return null; }
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: tunnel.localPort, path: `/v1/meu-bot/session?conv=${encodeURIComponent(conversationId)}`, method: "DELETE", headers: { Authorization: `Bearer ${tunnel.apiKey}` }, timeout: 8000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) { resolve(null); return; }
        try { const j = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { removed?: unknown }; resolve(typeof j.removed === "number" ? j.removed : 0); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/** Pedido JSON ao backend desta máquina pelo túnel; null se não há túnel, a rota não existe ou falhou. */
export async function backendJson<T>(host: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", pathname: string, body?: unknown): Promise<T | null> {
  let tunnel: { localPort: number; apiKey: string };
  try { tunnel = await readyTunnel(host, null); } catch { return null; }
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: tunnel.localPort, path: pathname, method, headers: { Authorization: `Bearer ${tunnel.apiKey}`, ...(payload === null ? {} : { "Content-Type": "application/json", "Content-Length": String(payload.length) }) }, timeout: 8000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) { resolve(null); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

/** Identidade deste Mac para o backend (12 hex de sha256(nome\nusuário)); igual ao id enviado no hello. */
export function deviceId(): string {
  const name = os.hostname().replace(/\.local$/, "");
  const user = os.userInfo().username;
  return createHash("sha256").update(`${name}\n${user}`).digest("hex").slice(0, 12);
}

/** Licença e devices desta conta (plano, status, membro desde, máquinas); null = backend antigo/fora do ar. */
export const fetchLicense = (host: string): Promise<LicenseView | null> => backendJson<LicenseView>(host, "GET", "/v1/meu-bot/license");

// Contas do Claude na máquina (rotas /v1/meu-bot/contas-claude do backend). null = backend antigo ou fora do ar.
const CONTA_ID_RE = /^(padrao|c-[a-f0-9]{8})$/;
const contaPath = (id: string, acao = ""): string => { if (!CONTA_ID_RE.test(id)) throw new Error("conta inválida"); return `/v1/meu-bot/contas-claude/${id}${acao}`; };
export const fetchContasClaude = (host: string): Promise<ContasClaudeView | null> => backendJson<ContasClaudeView>(host, "GET", "/v1/meu-bot/contas-claude");
export const criarContaClaude = (host: string, rotulo: string): Promise<(ContasClaudeView & { conta: ContaClaude }) | null> => backendJson(host, "POST", "/v1/meu-bot/contas-claude", { rotulo });
export const atualizarContaClaude = (host: string, id: string, patch: { rotulo?: string; ativa?: boolean }): Promise<ContasClaudeView | null> => backendJson(host, "PATCH", contaPath(id), patch);
export const reordenarContasClaude = (host: string, ids: string[]): Promise<ContasClaudeView | null> => backendJson(host, "PUT", "/v1/meu-bot/contas-claude/ordem", { ids });
export const removerContaClaude = (host: string, id: string): Promise<ContasClaudeView | null> => backendJson(host, "DELETE", contaPath(id));
export const usarAgoraContaClaude = (host: string, id: string): Promise<ContasClaudeView | null> => backendJson(host, "POST", contaPath(id, "/usar-agora"), {});
export const conferirContaClaude = (host: string, id: string): Promise<ContasClaudeView | null> => backendJson(host, "POST", contaPath(id, "/conferir"), {});
export const limiaresContasClaude = (host: string, limiares: Partial<LimiaresClaude>): Promise<ContasClaudeView | null> => backendJson(host, "PUT", "/v1/meu-bot/contas-claude/limiares", limiares);

/** Avisos de segurança gravados na máquina (alertas.json): null = backend antigo/fora do ar. */
export const fetchAlertPrefs = (host: string): Promise<AlertPrefs | null> => backendJson<AlertPrefs>(host, "GET", "/v1/meu-bot/alerts");
export async function saveAlertPrefs(host: string, prefs: AlertPrefs): Promise<void> {
  const r = await backendJson<{ ok?: boolean }>(host, "PUT", "/v1/meu-bot/alerts", prefs);
  if (r === null) throw new Error("não consegui gravar na máquina (backend fora do ar ou sem a rota; reinstale o backend)");
}

/**
 * "Este Mac usou o meu-bot desta máquina": o app se apresenta ao backend uma vez por abertura e por máquina
 * (POST /v1/meu-bot/hello). Um Mac que o backend nunca viu vira aviso para a pessoa (WhatsApp dela, e e-mail se
 * ela quiser) e uma linha no registro que ela e o admin veem. Como o aviso de "login numa máquina nova" do Rambox.
 * Host "local" fica de fora: é este Mac com o próprio backend, sem máquina remota para avisar. readyTunnel não
 * agenda o hello nesse caso; um chamado direto só marca `announced` e volta. Falha de túnel sobe no catch de
 * readyTunnel, antes desta função.
 */
const announced = new Set<string>();
/** Quem quer saber a versão mínima do app que o backend de uma máquina exige (vem na resposta do hello): o updater. */
let versaoMinimaListener: ((host: string, minima: unknown) => void) | null = null;
export const onVersaoMinima = (cb: (host: string, minima: unknown) => void): void => { versaoMinimaListener = cb; };
export function announceMachine(host: string): void {
  if (announced.has(host)) return;
  if (host === LOCAL_HOST) { announced.add(host); return; }
  announced.add(host);
  const name = os.hostname().replace(/\.local$/, "");
  const user = os.userInfo().username;
  const id = deviceId();
  // `produto` diz qual app se apresentou (meu-bot, meu-bot-crm…): um Mac pode ter os dois; backend antigo ignora o campo.
  void backendJson<{ fresh?: boolean; status?: string; appMinima?: unknown }>(host, "POST", "/v1/meu-bot/hello", { id, name, user, platform: `macOS ${os.release()}`, app: app.getVersion(), produto: appTitle() })
    .then((r) => {
      if (r?.fresh === true) log(`[${host}] este Mac (${name}) é novo para o backend (status=${r.status ?? "?"}): a pessoa foi avisada`);
      // Backend novo diz a versão mínima do app que ele atende; backend antigo não traz o campo (undefined = sem exigência).
      if (r !== null) versaoMinimaListener?.(host, r.appMinima);
    });
}

/**
 * Sessão do Claude Code por trás de uma conversa (GET /v1/meu-bot/session?conv=): o .jsonl na máquina, para
 * "Copiar ID". null = sem túnel, backend antigo (sem a rota) ou conversa ainda sem turno.
 */
export async function fetchBackendSession(host: string, conversationId: string): Promise<ClaudeSessionRef | null> {
  let tunnel: { localPort: number; apiKey: string };
  try { tunnel = await readyTunnel(host, null); } catch { return null; }
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: tunnel.localPort, path: `/v1/meu-bot/session?conv=${encodeURIComponent(conversationId)}`, method: "GET", headers: { Authorization: `Bearer ${tunnel.apiKey}` }, timeout: 8000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) { resolve(null); return; }
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { sessions?: unknown };
          const list = Array.isArray(j.sessions) ? j.sessions as Array<{ profile?: unknown; sessionId?: unknown; file?: unknown }> : [];
          const s = list.find((x) => typeof x.sessionId === "string" && typeof x.file === "string" && typeof x.profile === "string");
          resolve(s === undefined ? null : { sessionId: s.sessionId as string, file: s.file as string, profile: s.profile as string });
        } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

export async function fetchAccountStatus(host: string): Promise<AccountStatus | null> {
  let tunnel: { localPort: number; apiKey: string };
  try { tunnel = await readyTunnel(host, null); } catch { return null; }
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: tunnel.localPort, path: "/v1/meu-bot/status", method: "GET", headers: { Authorization: `Bearer ${tunnel.apiKey}` }, timeout: 8000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) { resolve(null); return; }
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { claude?: Partial<AccountStatus>; providers?: AccountStatus["providers"]; model?: unknown; contas?: { atual?: unknown; rotulo?: unknown; total?: unknown; esgotadas?: unknown; proximaEm?: unknown } | null; cota?: unknown };
          const c = j.claude ?? {};
          const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
          const str = (v: unknown): string | null => (typeof v === "string" && v.length <= 80 ? v : null);
          const ct = j.contas;
          resolve({
            email: typeof c.email === "string" ? c.email : null, assento: typeof c.assento === "string" ? c.assento : null,
            sessionPct: num(c.sessionPct), weeklyPct: num(c.weeklyPct), sessionResets: num(c.sessionResets), weeklyResets: num(c.weeklyResets), updated: num(c.updated),
            modelName: typeof j.model === "string" && j.model.length <= 40 ? j.model : null,
            contas: ct && typeof ct === "object" ? { atual: str(ct.atual), rotulo: str(ct.rotulo), total: num(ct.total) ?? 1, esgotadas: num(ct.esgotadas) ?? 0, proximaEm: num(ct.proximaEm) } : null,
            providers: Array.isArray(j.providers) ? j.providers.filter((p) => p && typeof p.name === "string").map((p) => ({ name: p.name, type: p.type === "openai" ? "openai" : "claude", available: p.available === true })) : [],
            // Backend 1.9+: a cota de disco dela (null = sem cota); antes disso o campo não vem (a tela diz "backend antigo").
            ...("cota" in j ? { cota: lerCotaJson(j.cota) } : {}),
          });
        } catch { resolve(null); }
      });
      res.on("error", () => resolve(null));
    });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
    req.end();
  });
}

/** Fila serial de tarefas de fundo (resumo, memória): nunca duas ao mesmo tempo no túnel. */
let background: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>): void {
  background = background.then(task).catch((err) => log(`background: ${err instanceof Error ? err.message : String(err)}`));
}

function sendContext(out: Sender, conv: Conversation, sent: number, mode: "full" | "summary" | "truncated", tokens?: number): void {
  out.send("chat:context", {
    conversationId: conv.id, sent, total: conv.backendMessages.length, mode, summarizing: conv.summarizing,
    ...(tokens === undefined ? {} : { tokens, budget: getContextBudget() }),
    ...(conv.summary === undefined ? {} : { summaryUpdatedAt: conv.summary.updatedAt }),
  });
}

const today = (): string => new Date().toLocaleDateString("pt-BR");

/** Resume em background a faixa do meio; falha mantém o resumo anterior. */
function scheduleSummary(out: Sender, conv: Conversation, range: [number, number], lastMode: "full" | "summary" | "truncated"): void {
  if (conv.summarizing || range[1] <= range[0]) return;
  conv.summarizing = true;
  sendContext(out, conv, 0, lastMode);
  enqueue(async () => {
    try {
      const turns = conv.backendMessages.slice(range[0], range[1]);
      const req = buildSummaryRequest(conv.summary?.text, turns, today());
      const { text } = await chatCompletion(conv.host, "claudecode", req, null);
      const valid = validateSummary(text);
      if (valid === null) { log(`resumo inválido para ${conv.id}; mantendo o anterior`); return; }
      if (conv.closed) return;
      conv.summary = { text: valid, coveredUntil: range[1], updatedAt: new Date().toISOString() };
      persistConversations();
      log(`resumo atualizado para ${conv.id}: cobre até ${range[1]} (${valid.length} chars)`);
    } finally {
      conv.summarizing = false;
      if (!conv.closed) sendContext(out, conv, 0, conv.summary === undefined ? lastMode : "summary");
    }
  });
}

/** A cada N turnos do usuário, extrai fatos duráveis para a memória local. */
function maybeExtractMemory(out: Sender, conv: Conversation): void {
  const every = getMemoryEveryTurns();
  if (every <= 0) return;
  conv.userTurnsSinceMemory += 1;
  if (conv.userTurnsSinceMemory < every) return;
  conv.userTurnsSinceMemory = 0;
  persistConversations();
  const turns = conv.backendMessages.slice(-every * 2);
  enqueue(async () => {
    const before = getMemory();
    const { text } = await chatCompletion(conv.host, "claudecode", buildMemoryRequest(before, turns), null);
    const ops = parseOps(text);
    if (ops.length === 0) { log(`memória: nada a guardar para ${conv.id}`); return; }
    const next = applyOps(before, ops, { notas: NOTAS_MAX, perfil: PERFIL_MAX });
    if (next.applied === 0) return;
    const saved = setMemory({ notas: next.notas, perfil: next.perfil });
    log(`memória: ${next.applied} operação(ões) aplicada(s)`);
    broadcast("memory:changed", { ...saved, limits: { notas: NOTAS_MAX, perfil: PERFIL_MAX } });
  });
}

export async function runBackendTurn(conv: Conversation, userText: string): Promise<void> {
  const out = new Sender(conv.host);
  const host = conv.host;
  const model = conv.model;
  const conversationId = conv.id;
  const cancelled = (): boolean => conv.closed;
  const abort = new AbortController();
  conv.abort = abort;
  let partial = "";

  // Trocou de modelo no meio da conversa: o novo modelo recebe uma nota dizendo quem respondeu antes.
  // Trecho trazido do WhatsApp entra na primeira mensagem; só sai de pendente se a mensagem ficar no histórico.
  const notes = [conv.pendingNote, conv.pendingSwitch === undefined ? undefined : switchNote(conv.pendingSwitch.from, conv.pendingSwitch.to)]
    .filter((n): n is string => n !== undefined && n !== "");
  const note = notes.length === 0 ? undefined : notes.join("\n\n");
  delete conv.pendingSwitch;
  const userMsg: BackendMessage = { role: "user", content: userText, ...(note === undefined ? {} : { note }) };
  conv.backendMessages.push(userMsg);
  out.send("chat:assistant-start", { conversationId });
  try {
    out.send("backend:status", { host, state: "connecting", detail: "verificando a VM…" });
    const plan = planContext(conv.backendMessages, conv.summary, getContextBudget());
    const memory = memorySystemMessage();
    const outgoing = memory === undefined ? plan.outgoing : [memory, ...plan.outgoing];
    sendContext(out, conv, plan.sentCount, plan.mode, outgoing.reduce((n, m) => n + estimateTokens(m.content), 0));
    const t0 = Date.now();
    // Retomada de sessão no backend: diz quantas mensagens do começo ele já conhece.
    const seen = alreadySeenPrefix(plan.outgoing, conv.serverSeen);
    const browserPort = browserAgentPort(host);
    const gmailPort = gmailAgentePort(host);
    // O rótulo da conversa (selo das abas do Navegador, auditoria do Gmail) vai com qualquer ponte ligada.
    const rotulo = browserPort === null && gmailPort === null ? {} : { "X-Meu-Bot-Browser-Rotulo": Buffer.from((conv.title ?? "conversa do meu-bot").slice(0, 80), "utf8").toString("base64") };
    const headers = { "X-Conversation-Id": conversationId, "X-Conversation-Seen": String(seen), "X-Device-Id": deviceId(), ...rotulo, ...(browserPort === null ? {} : { "X-Meu-Bot-Browser-Port": String(browserPort) }), ...(gmailPort === null ? {} : { "X-Meu-Bot-Gmail-Port": String(gmailPort) }) };
    log(`contexto ${conversationId}: modo=${plan.mode} enviadas=${plan.sentCount}/${conv.backendMessages.length}${memory === undefined ? "" : " +memória"} seen=${seen}`);
    let fallbackNote: string | undefined;
    const { text, finishReason, streamed, resumed, provider, usage } = await chatCompletion(host, model, outgoing, out, abort.signal, (delta) => {
      partial += delta;
      if (!cancelled()) out.send("chat:delta", { conversationId, text: delta });
    }, headers, (notice, tipo) => {
      // Fallback de provedor no backend: aviso na conversa e no pill, sem interromper a resposta; fica gravado na mensagem.
      // Troca de conta do Claude (tipo "conta"): só o aviso na conversa; o serviço não está degradado.
      log(`fallback ${conversationId}: ${notice}`);
      fallbackNote = notice;
      if (cancelled()) return;
      out.send("chat:notice", { conversationId, text: `⚠ ${notice}` });
      if (tipo !== "conta") out.send("backend:status", { host, state: "degraded", detail: notice });
    }, (tool) => { if (!cancelled()) out.send("chat:tool", { conversationId, tool }); });
    if (cancelled()) return;
    // Quem respondeu fica na mensagem (a bolha mostra, o export leva, e sobrevive ao fechar/abrir).
    conv.backendMessages.push({ role: "assistant", content: text, provider, ...(fallbackNote === undefined ? {} : { fallback: fallbackNote }) });
    conv.serverSeen = conv.backendMessages.length;
    conv.lastResumed = resumed;
    if (!streamed) out.send("chat:delta", { conversationId, text });
    out.send("chat:done", { conversationId, stopReason: finishReason, resumed, ms: Date.now() - t0, provider, ...(fallbackNote === undefined ? {} : { fallback: fallbackNote }), ...(usage === undefined ? {} : { usage }) });
    // Status line: conta e limites do Claude, atualizados depois de cada turno.
    void fetchAccountStatus(host).then((status) => { if (!cancelled()) out.send("chat:account", { host, status }); });
    if (provider !== model) log(`provedor ${conversationId}: pedido ${model}, respondeu ${provider}`);
    out.send("backend:status", { host, state: provider === model ? "ready" : "degraded", detail: `túnel ativo · ${model}${provider !== model ? ` · respondeu ${provider}` : ""}${resumed ? " · sessão retomada ↻" : " · sessão nova"}` });
    // Com a sessão retomada o servidor já tem todo o contexto; resumir no cliente seria desperdício.
    if (plan.needsSummary && !resumed) scheduleSummary(out, conv, plan.summarizeRange, plan.mode);
    maybeExtractMemory(out, conv);
  } catch (err) {
    if (errCode(err) === "ABORTED") {
      // Cancelado pelo usuário: guarda o que já veio, ou desfaz a pergunta.
      if (partial.trim() !== "") conv.backendMessages.push({ role: "assistant", content: `${partial}\n\n[interrompido]` });
      else if (conv.backendMessages.at(-1)?.role === "user") conv.backendMessages.pop();
      if (!cancelled()) out.send("chat:done", { conversationId, stopReason: "cancelled" });
      return;
    }
    if (partial.trim() !== "") {
      // Resposta parcial vale mais que nada; marca o corte.
      conv.backendMessages.push({ role: "assistant", content: `${partial}\n\n[resposta interrompida]` });
    } else if (conv.backendMessages.at(-1)?.role === "user") {
      conv.backendMessages.pop();
    }
    const offline = errCode(err) === "OFFLINE" || (isConnectionError(err) && (await noteNetworkError(err)));
    const message = offline ? offlineMessage("chat") : describeFetchError(err, model);
    if (isConnectionError(err)) markDegraded(host, errCode(err));
    out.send("backend:status", { host, state: "error", detail: offline ? "sem internet" : message });
    const backendCode = (err as { backendCode?: unknown } | null)?.backendCode;
    if (!cancelled()) out.send("chat:error", { conversationId, kind: "backend", message, ...(typeof backendCode === "string" ? { code: backendCode } : {}) });
  } finally {
    delete conv.abort;
    if (conv.pendingNote !== undefined && conv.backendMessages.includes(userMsg)) { delete conv.pendingNote; persistConversations(); }
    saveTranscript(conv);
  }
}
