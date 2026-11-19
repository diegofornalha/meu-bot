/**
 * SSH da máquina da pessoa: `bash -s` com o script no stdin (sem quoting pelo caminho) e cópia de arquivo por scp.
 * É o executor de todo o IO do WhatsApp (os adaptadores de motor recebem um `Exec` com esta assinatura, para o teste
 * trocá-lo por um falso) e de boa parte do app (admin, licença, objetivo, CRM…), que o importa pela fachada whatsapp.ts.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOCAL_WA_HOST, scriptLocal, scriptRemoto } from "./whatsapp-local-core";

export const SSH_OPTS = [
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3",
  "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new",
];

/**
 * `bash -s` na máquina: por SSH, ou neste Mac quando o host é "local" (no home, com o prelúdio do macOS). O script vai
 * pelo stdin de quem chama, com `scriptDe(host, …)`, que também leva os ajustes do macOS a uma máquina por SSH que seja um Mac.
 */
export function spawnBash(host: string): ChildProcessWithoutNullStreams {
  if (host === LOCAL_WA_HOST) return spawn("/bin/bash", ["-s"], { cwd: os.homedir(), env: { ...process.env, HOME: os.homedir() }, stdio: ["pipe", "pipe", "pipe"] });
  return spawn("ssh", [...SSH_OPTS, "--", host, "bash -s"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
}
export const scriptDe = (host: string, script: string): string => (host === LOCAL_WA_HOST ? scriptLocal(script) : scriptRemoto(script));

export function runSsh(host: string, script: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawnBash(host);
    let stdout = ""; let stderr = ""; let done = false;
    const timer = setTimeout(() => { if (!done) child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: null, stdout, stderr: e.message }); } });
    child.on("close", (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, stdout, stderr }); } });
    child.stdin.on("error", () => { /* ssh caiu antes de ler */ });
    child.stdin.end(scriptDe(host, script));
  });
}

/**
 * Copia um arquivo deste Mac para a máquina, pelo mesmo alias e opções do runSsh (como root no admin, como a pessoa no
 * meu-bot). `remoto` é um caminho na máquina (relativo ao home do alias quando não começa com /). Só o stderr volta:
 * quem chama decide a frase. Binário seguro e sem inflar em base64: é o scp que o instalador do backend já usa.
 */
export function scpPara(host: string, local: string, remoto: string, timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  if (host === LOCAL_WA_HOST) {
    try { const dest = path.isAbsolute(remoto) ? remoto : path.join(os.homedir(), remoto); fs.copyFileSync(local, remoto.endsWith("/") ? path.join(dest, path.basename(local)) : dest); return Promise.resolve({ code: 0, stderr: "" }); }
    catch (e) { return Promise.resolve({ code: 1, stderr: e instanceof Error ? e.message : String(e) }); }
  }
  return new Promise((resolve) => {
    const child = spawn("scp", ["-q", ...SSH_OPTS, "--", local, `${host}:${remoto}`], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = ""; let done = false;
    const timer = setTimeout(() => { if (!done) child.kill("SIGKILL"); }, timeoutMs);
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: null, stderr: e.message }); } });
    child.on("close", (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, stderr }); } });
  });
}
