/**
 * Processo filho sem travar o main: `execFile` com limite de tempo, saída em texto e erro com a mensagem do
 * comando (stderr). O updater troca `execFileSync` (que congelava a janela durante o ditto e o codesign) por
 * isto; outros módulos com cópias próprias (hostProbe.run, whatsapp.runSsh) ficam como estão até precisarem mudar.
 */
import { execFile } from "node:child_process";

export interface ProcResult { code: number; stdout: string; stderr: string }

/** Erro de um comando que saiu com código ≠ 0 ou passou do tempo; `code` = o código de saída (null = sinal/tempo). */
export class ProcError extends Error {
  constructor(public readonly cmd: string, public readonly code: number | null, public readonly stderr: string) {
    super(`${cmd} ${code === null ? "não terminou a tempo" : `saiu com ${code}`}${stderr.trim() === "" ? "" : `: ${stderr.trim().split("\n").slice(-1)[0]}`}`);
    this.name = "ProcError";
  }
}

/** Roda `cmd args` e resolve com a saída; rejeita com ProcError se sair ≠ 0 ou passar de `timeoutMs`. */
export function run(cmd: string, args: readonly string[], opts: { timeoutMs?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv } = {}): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    execFile(cmd, [...args], { timeout: opts.timeoutMs ?? 60_000, maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024, killSignal: "SIGKILL", ...(opts.env === undefined ? {} : { env: opts.env }) }, (err, stdout, stderr) => {
      const out = String(stdout), errOut = String(stderr);
      if (err === null) { resolve({ code: 0, stdout: out, stderr: errOut }); return; }
      const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
      if (typeof e.code === "string") { reject(new Error(`${cmd}: ${e.message}`)); return; } // ENOENT etc.
      reject(new ProcError(cmd, e.killed === true ? null : (typeof e.code === "number" ? e.code : null), errOut));
    });
  });
}

/** Como `run`, mas devolve só o stdout sem espaços nas pontas. */
export const runText = async (cmd: string, args: readonly string[], opts?: { timeoutMs?: number }): Promise<string> => (await run(cmd, args, opts)).stdout.trim();
