/**
 * Modo grátis no Mac (tutorial 16): o Ollama do meu-bot na máquina "local". O programa fica
 * numa pasta do meu-bot (~/.local/share/meu-bot/ollama, na versão fixa, conferida pelo sha256; nada em /Applications e
 * sem mexer num Ollama que a pessoa já tenha), o `ollama serve` é um processo filho do app numa porta própria
 * (ollamaPortaLocal) e o providers.json do backend local ganha a entrada "ollama-local" (mesclada, sem apagar as outras).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { InstallBackendResult, OllamaStatus } from "../../shared/ipc";
import { ensureLocalBackend, localBackendAlive, localBackendDir, localBackendPort, stopLocalBackend } from "../maquina/localBackend";
import { pidsDoLsof } from "../maquina/backend-local-orfao-core";
import { caps } from "../app/variant";
import {
  OLLAMA_PACOTE_BYTES, OLLAMA_SHA256_LOCAL, OLLAMA_URL_LOCAL, OLLAMA_VERSION_LOCAL, ehNossoOllamaOrfao, espacoNecessarioMb,
  linhaDoPull, modeloNoProviders, modeloParaMemoria, modoGratisDoMac, ollamaPortaLocal, ollamaUrlLocal, providersComOllama, providersSemOllama,
} from "./ollamaLocal-core";

const HOME = os.homedir();
const PREFIX = path.join(HOME, ".local", "share", "meu-bot", "ollama");
const DIR_VERSAO = path.join(PREFIX, `v${OLLAMA_VERSION_LOCAL}`);
const OLLAMA = path.join(DIR_VERSAO, "ollama");
const MODELOS = path.join(PREFIX, "models");

function log(line: string): void {
  try { fs.appendFileSync(path.join(app.getPath("userData"), "meu-bot.log"), `${new Date().toISOString()} [ollama-local] ${line}\n`); } catch { /* cortesia */ }
}

const porta = (): number => ollamaPortaLocal(localBackendPort());
const base = (): string => ollamaUrlLocal(porta());
const providersPath = (): string => path.join(localBackendDir(), "providers.json");
const lerProviders = (): string | null => { try { return fs.readFileSync(providersPath(), "utf8"); } catch { return null; } };
const instalado = (): boolean => { try { fs.accessSync(OLLAMA, fs.constants.X_OK); return true; } catch { return false; } };
const modeloAtual = (): string | null => modeloNoProviders(lerProviders(), porta());
/** O modo grátis está preparado neste app: o programa na pasta do meu-bot e o providers.json local apontando ele. */
const preparado = (): boolean => instalado() && modeloAtual() !== null;
/** Só no Mac com chip Apple: no Intel o modelo roda na CPU e fica lento demais para conversar. */
const possivel = (): boolean => process.platform === "darwin" && process.arch === "arm64";

/** Estado do modo grátis para o seletor (a sondagem de "este Mac"): sem falar com o Ollama, só o disco. */
export const modoGratisLocal = (): "instalado" | "possivel" | null =>
  modoGratisDoMac({ staging: caps().canal === "staging", plataforma: process.platform, arch: process.arch, preparado: preparado() });

const envOllama = (): NodeJS.ProcessEnv => ({ ...process.env, HOME, OLLAMA_HOST: `127.0.0.1:${porta()}`, OLLAMA_MODELS: MODELOS });

function portOpen(p: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port: p, host: "127.0.0.1" });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
    sock.setTimeout(800, () => { sock.destroy(); resolve(false); });
  });
}

async function getJson(p: string, timeoutMs = 3000): Promise<unknown> {
  const r = await fetch(`${base()}${p}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<unknown>;
}
const responde = async (): Promise<boolean> => { try { await getJson("/api/version", 1500); return true; } catch { return false; } };
async function modelosBaixados(): Promise<string[]> {
  try {
    const j = await getJson("/api/tags") as { models?: { name?: unknown }[] };
    return (j.models ?? []).map((m) => (typeof m.name === "string" ? m.name : "")).filter((n) => n !== "");
  } catch { return []; }
}

function memoriaMb(): number | null { const m = os.totalmem(); return Number.isFinite(m) && m > 0 ? Math.round(m / 1_048_576) : null; }
function livreMb(): number | null {
  try { fs.mkdirSync(path.dirname(PREFIX), { recursive: true }); const s = fs.statfsSync(path.dirname(PREFIX)); return Math.round((s.bavail * s.bsize) / 1_048_576); } catch { return null; }
}

// --- serve: processo filho, volta se cair ---
let serve: ChildProcess | null = null;
let serveQuer = false;
let serveRetry: NodeJS.Timeout | null = null;

/** PIDs ouvindo na porta deste app que são o nosso `ollama serve` (de uma abertura anterior). */
function servesNaPorta(p: number): number[] {
  const l = spawnSync("lsof", ["-nP", `-iTCP:${p}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8", timeout: 5000 });
  return pidsDoLsof(l.stdout ?? "", process.pid).filter((pid) => {
    const ps = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 5000 });
    return ehNossoOllamaOrfao(ps.stdout ?? "", PREFIX);
  });
}
async function liberarOrfao(p: number): Promise<void> {
  const nossos = servesNaPorta(p);
  if (nossos.length === 0) return;
  for (const pid of nossos) { try { process.kill(pid, "SIGTERM"); } catch { /* já saiu */ } }
  log(`ollama serve órfão de uma abertura anterior (pid ${nossos.join(", ")}) segurava a porta ${p}: encerrado`);
  for (let i = 0; i < 25 && servesNaPorta(p).length > 0; i++) await new Promise((r) => setTimeout(r, 200));
  for (const pid of servesNaPorta(p)) { try { process.kill(pid, "SIGKILL"); } catch { /* já saiu */ } }
}

let subindo = false;
function subirServe(): void {
  if (!serveQuer || serve !== null || subindo) return;
  subindo = true;
  void liberarOrfao(porta()).catch(() => undefined).finally(() => { subindo = false; iniciarServe(); });
}
function iniciarServe(): void {
  if (!serveQuer || serve !== null) return;
  const fd = fs.openSync(path.join(app.getPath("userData"), "ollama.log"), "a");
  // Grupo próprio (detached): o stop encerra o serve e os runners que ele sobe.
  const child = spawn(OLLAMA, ["serve"], { stdio: ["ignore", fd, fd], env: envOllama(), detached: true });
  fs.closeSync(fd);
  serve = child;
  const ini = Date.now();
  child.on("error", (e) => log(`ollama serve não iniciou: ${e.message}`));
  child.on("exit", (code, signal) => {
    if (serve !== child) return;
    serve = null;
    if (!serveQuer) return;
    log(`ollama serve saiu após ${Date.now() - ini} ms (code=${code} signal=${signal}); de novo em 15 s`);
    if (serveRetry !== null) return;
    serveRetry = setTimeout(() => { serveRetry = null; subirServe(); }, 15_000);
    serveRetry.unref();
  });
}

/** Sobe o `ollama serve` se o modo grátis está preparado (o túnel chama ao subir o backend local; "ligar" na lateral). */
export function ensureLocalOllama(): void {
  if (!preparado()) return;
  serveQuer = true;
  subirServe();
}
export function stopLocalOllama(): void {
  serveQuer = false;
  if (serveRetry !== null) { clearTimeout(serveRetry); serveRetry = null; }
  const p = serve; serve = null;
  if (p === null) return;
  try { if (p.pid !== undefined) process.kill(-p.pid, "SIGTERM"); else p.kill("SIGTERM"); } catch { try { p.kill("SIGTERM"); } catch { /* já morto */ } }
}
/** "ligar"/"parar" da linha do Ollama na lateral. */
export async function setOllamaLigadoLocal(ligado: boolean): Promise<OllamaStatus> {
  if (ligado) { ensureLocalOllama(); await esperarServe(15_000); } else stopLocalOllama();
  return ollamaStatusLocal();
}

async function esperarServe(ms: number): Promise<boolean> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await responde()) return true; await new Promise((r) => setTimeout(r, 300)); }
  return false;
}

export async function ollamaStatusLocal(): Promise<OllamaStatus> {
  const mem = memoriaMb();
  const rec = modeloParaMemoria(mem);
  const modelo = modeloAtual();
  const rodando = instalado() && (await portOpen(porta())) && (await responde());
  const pronto = rodando && modelo !== null && (await modelosBaixados()).includes(modelo);
  return { possivel: possivel(), instalado: instalado(), rodando, pronto, modelo, recomendado: rec, memMb: mem, livreMb: livreMb(), necessarioMb: espacoNecessarioMb(rec), versao: OLLAMA_VERSION_LOCAL };
}

/** Baixa o ollama-darwin.tgz da versão fixa, confere o sha256 e extrai em DIR_VERSAO (troca atômica no fim). */
async function baixarPrograma(say: (l: string) => void): Promise<void> {
  fs.mkdirSync(PREFIX, { recursive: true });
  const tgz = path.join(PREFIX, `ollama-${OLLAMA_VERSION_LOCAL}.tgz.parcial`);
  const tmp = path.join(PREFIX, `v${OLLAMA_VERSION_LOCAL}.extraindo`);
  say(`baixando o Ollama ${OLLAMA_VERSION_LOCAL} (${Math.round(OLLAMA_PACOTE_BYTES / 1_048_576)} MB)…`);
  const r = await fetch(OLLAMA_URL_LOCAL, { signal: AbortSignal.timeout(20 * 60_000) });
  if (!r.ok || r.body === null) throw new Error(`o download do Ollama falhou (HTTP ${r.status})`);
  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(tgz);
  let feito = 0; let ultima = 0;
  try {
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk); feito += chunk.byteLength;
      if (!out.write(chunk)) await new Promise<void>((res) => { out.once("drain", () => res()); });
      const pct = Math.floor((feito / OLLAMA_PACOTE_BYTES) * 100);
      if (pct >= ultima + 20 && pct < 100) { ultima = pct; say(`baixando o Ollama: ${pct}%`); }
    }
  } finally { await new Promise<void>((res) => { out.end(() => res()); }); }
  const digest = hash.digest("hex");
  if (digest !== OLLAMA_SHA256_LOCAL) { fs.rmSync(tgz, { force: true }); throw new Error(`o pacote do Ollama não confere (sha256 ${digest.slice(0, 12)}…); nada foi instalado`); }
  say("pacote conferido (sha256); extraindo…");
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  const x = spawnSync("tar", ["xzf", tgz, "-C", tmp], { encoding: "utf8", timeout: 5 * 60_000 });
  fs.rmSync(tgz, { force: true });
  if (x.status !== 0 || !fs.existsSync(path.join(tmp, "ollama"))) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error(`não deu para extrair o Ollama (${(x.stderr ?? "").trim().slice(0, 200)})`); }
  fs.rmSync(DIR_VERSAO, { recursive: true, force: true });
  fs.renameSync(tmp, DIR_VERSAO);
}

/** POST /api/pull com stream: cada evento vira uma linha (de 5 em 5% no blob grande). */
async function baixarModelo(modelo: string, say: (l: string) => void): Promise<void> {
  const r = await fetch(`${base()}/api/pull`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: modelo, stream: true }), signal: AbortSignal.timeout(2 * 60 * 60_000) });
  if (!r.ok || r.body === null) throw new Error(`o Ollama recusou baixar ${modelo} (HTTP ${r.status})`);
  const dec = new TextDecoder(); let buf = ""; let pct = -5; let ok = false; let erro: string | null = null;
  const linha = (l: string): void => {
    if (l.trim() === "") return;
    let ev: unknown; try { ev = JSON.parse(l); } catch { return; }
    if (typeof ev === "object" && ev !== null) {
      const e = ev as { status?: unknown; error?: unknown };
      if (e.status === "success") ok = true;
      if (typeof e.error === "string") erro = e.error;
    }
    const s = linhaDoPull(ev, pct);
    if (s !== null) { pct = s.pct; say(s.texto); }
  };
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    const ls = buf.split("\n"); buf = ls.pop() ?? "";
    for (const l of ls) linha(l);
  }
  linha(buf);
  if (erro !== null) throw new Error(`o Ollama não baixou ${modelo}: ${erro}`);
  if (!ok) throw new Error(`o download de ${modelo} parou antes do fim`);
}

/**
 * O server.js lê o providers.json ao subir: reinicia o backend local para o ollama-local entrar. `subir` = também liga
 * um backend que não estava no ar (sem o Claude ele nem subia antes do modo grátis).
 */
async function reiniciarBackend(say: (l: string) => void, subir: boolean): Promise<void> {
  if (localBackendAlive()) stopLocalBackend();
  else if (!subir) return;
  try { await ensureLocalBackend(); say("backend local reiniciado"); }
  catch (err) { say(`aviso: o backend local não voltou (${err instanceof Error ? err.message : String(err)}); feche e abra a janela deste Mac`); }
}

let ocupado = false;
/** Passo 2 do tutorial 16: baixa o programa (se preciso), sobe o serve, baixa o modelo e aponta o backend para ele. */
export async function prepareOllamaLocal(onLine?: (line: string) => void): Promise<InstallBackendResult> {
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const fail = (l: string): InstallBackendResult => { say(l); log(l); return { ok: false, log: lines }; };
  if (!possivel()) return fail("o modo grátis precisa de um Mac com chip Apple (M1 ou mais novo)");
  if (ocupado) return fail("já estou preparando o modo grátis; espere terminar");
  ocupado = true;
  try {
    const rec = modeloParaMemoria(memoriaMb());
    const livre = livreMb();
    const precisa = espacoNecessarioMb(rec) - (instalado() ? Math.ceil((OLLAMA_PACOTE_BYTES * 3) / 1_048_576) : 0);
    if (livre !== null && livre < precisa) return fail(`falta espaço: preciso de ~${Math.ceil(precisa / 1024)} GB livres e há ${Math.floor(livre / 1024)} GB`);
    if (!instalado()) await baixarPrograma(say);
    say(`Ollama ${OLLAMA_VERSION_LOCAL} em ${DIR_VERSAO}`);
    // Sobe o serve já (o preparado() ainda é falso: o providers.json só muda depois do modelo baixado).
    if (serve === null && await portOpen(porta())) await liberarOrfao(porta());
    if (serve === null && await portOpen(porta())) return fail(`a porta ${porta()} já está em uso neste Mac por outro programa`);
    serveQuer = true; subirServe();
    if (!(await esperarServe(20_000))) return fail("o Ollama não respondeu em 20 s (detalhes em ollama.log)");
    if ((await modelosBaixados()).includes(rec.id)) say(`modelo ${rec.id} já baixado`);
    else { say(`baixando o modelo ${rec.rotulo} (~${(rec.downloadMb / 1024).toFixed(1).replace(".", ",")} GB; pode levar alguns minutos)…`); await baixarModelo(rec.id, say); }
    fs.mkdirSync(localBackendDir(), { recursive: true });
    fs.writeFileSync(providersPath(), providersComOllama(lerProviders(), porta(), rec.id));
    say(`ollama-local apontado para o Ollama deste app (porta ${porta()}, modelo ${rec.id})`);
    await reiniciarBackend(say, true);
    say("pronto: o modo grátis responde neste Mac");
    return { ok: true, log: lines };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  } finally { ocupado = false; }
}

/** "Remover…" da lateral: para o serve, tira o ollama-local do providers.json e apaga a pasta (programa e modelos). */
export async function removerOllamaLocal(onLine?: (line: string) => void): Promise<InstallBackendResult> {
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  if (ocupado) { say("o modo grátis está sendo preparado; espere terminar"); return { ok: false, log: lines }; }
  stopLocalOllama();
  await liberarOrfao(porta()).catch(() => undefined);
  const antes = lerProviders();
  if (antes !== null) { fs.writeFileSync(providersPath(), providersSemOllama(antes)); say("ollama-local tirado do providers.json"); }
  fs.rmSync(PREFIX, { recursive: true, force: true });
  say(`pasta ${PREFIX} apagada (programa e modelos)`);
  await reiniciarBackend(say, false);
  return { ok: true, log: lines };
}
