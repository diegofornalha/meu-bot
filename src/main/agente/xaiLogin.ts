/**
 * Login OAuth da xAI no Hermes da máquina (credencial `xai-oauth`, usada pelo hermes proxy e, por
 * ele, pelo modelo grok-4 do backend). `hermes auth add xai-oauth --type oauth --no-browser` imprime
 * um link de código de dispositivo e fica esperando a aprovação; o app abre o link no navegador do
 * Mac e espera. No fim remove credenciais antigas do mesmo provedor (uma vencida com prioridade 0
 * faz o proxy falhar com invalid_grant) e confere com `hermes auth status`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { shell } from "electron";
import type { ClaudeAuthInfo, ClaudeLoginEvent } from "../../shared/ipc";
import { log } from "../maquina/backend";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";

const SSH_OPTS = [
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3",
  "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new",
];
// O hermes é um script Node: o node pode estar só no ~/.local/node/bin (instalação do backend), em /opt/node ou no PATH do login.
const REMOTE_PATH = "export PATH=$HOME/.local/bin:$HOME/bin:$HOME/.local/node/bin:/opt/node/bin:/usr/local/bin:$PATH";
const URL_RE = /https:\/\/accounts\.x\.ai\/[^\s"']+/;
const CODE_RE = /user_code=([A-Z0-9-]+)/;

let current: { host: string; child: ChildProcess } | null = null;

function ssh(host: string, cmd: string, timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("ssh", [...SSH_OPTS, "--", host, `${REMOTE_PATH}; ${cmd}`], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); resolve({ code: null, out }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

/** null = máquina sem Hermes (ou inacessível). `email` leva o rótulo da credencial ativa. */
export async function xaiAuthInfo(host: string): Promise<ClaudeAuthInfo | null> {
  if (host === LOCAL_HOST || !isValidHost(host)) return null;
  const r = await ssh(host, "command -v hermes >/dev/null 2>&1 || { echo present=0; exit 0; }; echo present=1; echo \"status=$(hermes auth status xai-oauth 2>&1 | head -1)\"; hermes auth list 2>/dev/null | sed -n '/^xai-oauth/,/^$/p' | grep '←' | head -1", 40_000);
  if (r.code !== 0 || !r.out.includes("present=1")) return null;
  const status = /status=(.*)/.exec(r.out)?.[1] ?? "";
  const label = /#\d+\s+(\S+)/.exec(r.out.split("\n").find((l) => l.includes("←")) ?? "")?.[1] ?? null;
  // "not logged in" também casa com /logged in/: a negação vem primeiro.
  return { loggedIn: /logged in/i.test(status) && !/not logged in/i.test(status), email: label };
}

export function startXaiLogin(host: string, send: (ev: ClaudeLoginEvent) => void): Promise<void> {
  if (host === LOCAL_HOST || !isValidHost(host)) { send({ kind: "done", ok: false, text: "esta máquina não tem o Hermes" }); return Promise.resolve(); }
  if (current !== null) { send({ kind: "done", ok: false, text: `já há um login da xAI em andamento em ${current.host}` }); return Promise.resolve(); }
  return new Promise((resolve) => {
    // `-tt`: sem pseudo-terminal o `hermes auth add` não imprime o link e fica parado. O stdin fica
    // aberto (o pty precisa dele) e é fechado quando o processo termina ou a pessoa cancela.
    const child = spawn("ssh", ["-tt", ...SSH_OPTS, "--", host, `${REMOTE_PATH}; hermes auth add xai-oauth --type oauth --no-browser 2>&1`], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.on("error", () => { /* pty fechou */ });
    current = { host, child };
    let buf = ""; let all = ""; let urlSent = false;
    send({ kind: "log", text: `conectando a ${host} e pedindo o login da xAI ao Hermes` });
    const onData = (d: Buffer): void => {
      const s = d.toString("utf8").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "\n"); buf += s; all += s;
      if (!urlSent) {
        const m = URL_RE.exec(buf);
        if (m !== null) {
          urlSent = true;
          send({ kind: "url", url: m[0] });
          const code = CODE_RE.exec(m[0])?.[1];
          if (code !== undefined) send({ kind: "log", text: `código do dispositivo: ${code} (a página já vem com ele; confira e aprove)` });
          void shell.openExternal(m[0]);
        }
      }
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) { const t = line.trim(); if (t !== "" && !URL_RE.test(t) && !/^\d\.\s|To continue:|If prompted|^Connection to .+ closed/i.test(t)) send({ kind: "log", text: t }); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => { send({ kind: "log", text: "tempo esgotado (10 min)" }); child.kill("SIGTERM"); }, 600_000);
    child.on("error", (e) => { send({ kind: "done", ok: false, text: `não consegui iniciar: ${e.message}` }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      current = null;
      try { child.stdin.end(); } catch { /* ok */ }
      void (async () => {
        const added = /Added xai-oauth OAuth credential #\d+:\s*"([^"]+)"/.exec(all)?.[1] ?? null;
        let ok = false;
        if (added !== null) {
          // Uma chamada só: remove as credenciais antigas do provedor (uma vencida na frente derruba o
          // proxy com invalid_grant) e confere o status. Cada `hermes` leva segundos para iniciar.
          const script = `L=$(hermes auth list 2>/dev/null | sed -n '/^xai-oauth/,/^$/p'); for id in $(echo "$L" | grep -v '${added}' | sed -n 's/.*oauth *id=\\([0-9a-f]*\\).*/\\1/p'); do hermes auth remove xai-oauth $id >/dev/null 2>&1 && echo "removed=$id"; done; echo "status=$(hermes auth status xai-oauth 2>&1 | head -1)"`;
          const r = await ssh(host, script, 60_000);
          for (const m of r.out.matchAll(/removed=([0-9a-f]+)/g)) send({ kind: "log", text: `credencial antiga removida (${m[1]})` });
          ok = /status=.*logged in/i.test(r.out);
        }
        log(`[xai-login] ${host}: processo saiu com ${code}; logado=${ok}`);
        send({ kind: "done", ok, text: ok ? `xAI logada no Hermes desta máquina (${added ?? "credencial nova"}); o grok-4 já usa a conta nova.` : `o login da xAI não concluiu (código ${code ?? "?"}).` });
        resolve();
      })();
    });
  });
}

export function cancelXaiLogin(): void {
  if (current === null) return;
  try { current.child.kill("SIGTERM"); } catch { /* ok */ }
}

export async function xaiLogout(host: string): Promise<ClaudeAuthInfo | null> {
  if (host === LOCAL_HOST || !isValidHost(host)) return null;
  await ssh(host, "hermes auth logout xai-oauth 2>&1 | tail -2", 40_000);
  log(`[xai-login] ${host}: logout pedido`);
  return xaiAuthInfo(host);
}
