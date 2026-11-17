/**
 * Estado da internet deste Mac, para a faixa OFFLINE (como no Rambox): a pessoa vê que o problema é na
 * conexão dela, não no app. Sondagem real (duas páginas de teste de conectividade; offline só se as duas
 * falharem com erro de rede), disparada ao abrir, por "Verificar agora", pelos eventos online/offline do
 * renderer, ao acordar o Mac e por qualquer erro de conexão do túnel ou do backend. Enquanto offline,
 * sonda de novo a cada 10 s; online, nenhum timer. Mesmo molde do updater: estado no módulo + broadcast.
 */
import { execFile } from "node:child_process";
import { log } from "../maquina/tunnel";
import { broadcast } from "./windows";
import { isConnectionCode, isLocalAddr, looksLikeOffline } from "./net-core";

import type { NetState } from "../../shared/ipc";

/** Páginas de teste de conectividade: a do próprio macOS e a do Chrome. Não dependem de login nem de serviço nosso. */
const PROBE_URLS = ["https://captive.apple.com/hotspot-detect.html", "https://www.gstatic.com/generate_204"];
const PROBE_TIMEOUT_MS = 5_000;
const OFFLINE_RECHECK_MS = 10_000;
/** Resultado com menos que isto de idade serve de resposta para uma consulta sem `force`. */
const FRESH_MS = 5_000;

const state: NetState = { online: null, checking: false, since: null, checkedAt: null };
let inflight: Promise<boolean> | null = null;
let timer: NodeJS.Timeout | null = null;
const backOnline: (() => void)[] = [];

export const netState = (): NetState => ({ ...state });
function publish(): void { broadcast("net:state", { ...state }); }

/** Uma requisição HEAD: qualquer resposta HTTP (até 4xx) prova que há saída; só erro de rede conta como falha. */
async function reach(url: string): Promise<boolean> {
  try { await fetch(url, { method: "HEAD", cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }); return true; }
  catch { return false; }
}

/** Sonda (uma por vez; chamadas simultâneas esperam a mesma). Devolve `online`. */
export function probe(): Promise<boolean> {
  if (inflight !== null) return inflight;
  inflight = (async () => {
    state.checking = true; publish();
    const results = await Promise.all(PROBE_URLS.map(reach));
    const online = results.some(Boolean);
    const was = state.online;
    state.checking = false; state.checkedAt = Date.now(); state.online = online;
    if (!online && was !== false) state.since = Date.now();
    if (online) state.since = null;
    publish();
    if (was !== online) log(`[rede] ${online ? (was === null ? "internet ok" : "internet de volta") : "sem internet"}`);
    if (!online) schedule();
    else if (timer !== null) { clearTimeout(timer); timer = null; }
    if (was === false && online) for (const cb of backOnline) { try { cb(); } catch (e) { log(`[rede] onBackOnline: ${e instanceof Error ? e.message : String(e)}`); } }
    return online;
  })().finally(() => { inflight = null; });
  return inflight;
}
function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void probe(); }, OFFLINE_RECHECK_MS);
}

/** "Verificar agora" e a consulta de uma janela ao abrir: com `force`, sonda mesmo com resultado fresco. */
export async function checkNow(force = false): Promise<NetState> {
  const fresh = state.checkedAt !== null && Date.now() - state.checkedAt < FRESH_MS;
  if (force || !fresh) await probe();
  return netState();
}

/**
 * Um caminho de rede falhou (túnel, backend, GitHub, caixa do suporte). Se o erro é de conexão, sonda agora e
 * diz se este Mac está sem internet: quem chamou troca a mensagem antes de culpar a máquina.
 */
export async function noteNetworkError(err: unknown): Promise<boolean> {
  const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code ?? null;
  const text = err instanceof Error ? err.message : String(err);
  if (state.online === false) { void probe(); return true; }
  if (!isConnectionCode(code) && !looksLikeOffline({ code, text }) && !/fetch failed/i.test(text)) return false;
  return !(await probe());
}

/** Quem quer agir quando a internet volta (revalidar túneis, checar atualização). */
export function onBackOnline(cb: () => void): void { backOnline.push(cb); }

export function initNet(): void { void probe(); }
export function disposeNet(): void { if (timer !== null) { clearTimeout(timer); timer = null; } }

/** O alias SSH aponta para este próprio Mac (colima)? `ssh -G` resolve o HostName; cacheado por alias. */
const localAddrCache = new Map<string, Promise<boolean>>();
export function hostIsLocalAddr(host: string): Promise<boolean> {
  if (host === "local") return Promise.resolve(true);
  let p = localAddrCache.get(host);
  if (p === undefined) {
    p = new Promise<boolean>((resolve) => {
      execFile("ssh", ["-G", host], { timeout: 5_000, windowsHide: true }, (err, stdout) => {
        if (err) { resolve(false); return; }
        const m = /^hostname (.+?)\r?$/m.exec(stdout);
        resolve(m !== null && isLocalAddr(m[1] ?? ""));
      });
    });
    localAddrCache.set(host, p);
  }
  return p;
}
