/**
 * SSH da máquina da pessoa: `bash -s` com o script no stdin (sem quoting pelo caminho) e cópia de arquivo por scp.
 * É o executor de todo o IO do WhatsApp (os adaptadores de motor recebem um `Exec` com esta assinatura, para o teste
 * trocá-lo por um falso) e de boa parte do app (admin, licença, objetivo, CRM…), que o importa pela fachada whatsapp.ts.
 */
import { spawn } from "node:child_process";

export const SSH_OPTS = [
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3",
  "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new",
];

export function runSsh(host: string, script: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("ssh", [...SSH_OPTS, "--", host, "bash -s"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let done = false;
    const timer = setTimeout(() => { if (!done) child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: null, stdout, stderr: e.message }); } });
    child.on("close", (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, stdout, stderr }); } });
    child.stdin.on("error", () => { /* ssh caiu antes de ler */ });
    child.stdin.end(script);
  });
}

/**
 * Copia um arquivo deste Mac para a máquina, pelo mesmo alias e opções do runSsh (como root no admin, como a pessoa no
 * meu-bot). `remoto` é um caminho na máquina (relativo ao home do alias quando não começa com /). Só o stderr volta:
 * quem chama decide a frase. Binário seguro e sem inflar em base64: é o scp que o instalador do backend já usa.
 */
export function scpPara(host: string, local: string, remoto: string, timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("scp", ["-q", ...SSH_OPTS, "--", local, `${host}:${remoto}`], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = ""; let done = false;
    const timer = setTimeout(() => { if (!done) child.kill("SIGKILL"); }, timeoutMs);
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: null, stderr: e.message }); } });
    child.on("close", (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, stderr }); } });
  });
}
