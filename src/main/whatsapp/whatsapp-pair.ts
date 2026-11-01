/**
 * Pareamento por QR, agnóstico de motor: o script remoto é `case "$MOTOR"` com o ramo de cada motor (whatsapp-motor.ts),
 * cada ramo emite os mesmos eventos JSON por linha (started, qr, connected, disconnected, error, e os passos "meu-bot"),
 * e o texto solto do `openclaw channels login` (blocos do QR, pistas) vira imagem e passos aqui (qr-blocks.ts).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { toDataURL } from "qrcode";
import type { WhatsappEvent } from "../../shared/ipc";
import { BlockQrCollector, blocksToSvgDataUrl, stripAnsi } from "./qr-blocks";
import { WA_MOTOR_SH } from "./whatsapp-capacidades";
import { SSH_OPTS } from "./whatsapp-ssh";
import { esquecerWhatsapp } from "./whatsapp-estado";
import { MOTORES } from "./whatsapp-motor";
import { phoneOf } from "./whatsapp-kv";
import { log } from "../maquina/backend";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";

export const PAIR_SCRIPT = `
set -u
export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$HOME/bin:$PATH
${WA_MOTOR_SH}
case "$MOTOR" in
hermes)
${MOTORES.hermes.pairSh}
;;
openclaw)
${MOTORES.openclaw.pairSh}
;;
picoclaw)
${MOTORES.picoclaw.pairSh}
;;
esac
echo '{"event":"error","error":"esta máquina não tem Hermes nem OpenClaw com WhatsApp"}'; exit 2
`;

const OC_FAIL_RE = /failed|error|timeout/i;

let current: { host: string; child: ChildProcess } | null = null;

export const pairingInProgress = (): string | null => current?.host ?? null;

/** Inicia o pareamento; os eventos vão por `send`. Resolve quando o processo remoto termina. */
export function startPairing(host: string, reset: boolean, send: (ev: WhatsappEvent) => void): Promise<void> {
  if (host === LOCAL_HOST || !isValidHost(host)) { send({ kind: "error", text: "este Mac não tem agente com WhatsApp" }); return Promise.resolve(); }
  if (current !== null) { send({ kind: "error", text: `já há um pareamento em andamento em ${current.host}` }); return Promise.resolve(); }
  return new Promise((resolve) => {
    const child = spawn("ssh", [...SSH_OPTS, "--", host, "bash -s"], { stdio: ["pipe", "pipe", "pipe"] });
    current = { host, child };
    let buf = ""; let connected = false; let stderr = ""; let openclaw = false; let qrRounds = 0;
    const qr = new BlockQrCollector();
    send({ kind: "step", text: `conectando a ${host} por SSH` });
    // Linha de texto do `openclaw channels login`: blocos do QR, pistas de vinculado/falha, ou log.
    const handleText = (raw: string): void => {
      const line = stripAnsi(raw).trimEnd();
      const done = qr.feed(line);
      if (done !== null) send({ kind: "qr", dataUrl: blocksToSvgDataUrl(done) });
      const clean = line.trim();
      if (clean === "") return;
      if (/[█▀▄]/.test(clean)) return;
      // Linhas conhecidas do CLI viram passos em pt-BR; o convite se repete a cada QR novo (~20 s) e vira contador.
      if (/^Waiting for WhatsApp connection/i.test(clean)) { send({ kind: "step", text: "aguardando o WhatsApp" }); return; }
      if (/scan this QR/i.test(clean)) {
        qrRounds += 1;
        send({ kind: qrRounds === 1 ? "step" : "log", text: qrRounds === 1 ? "QR pronto: escaneie no celular" : `↻ QR renovado (${qrRounds}º)` });
        return;
      }
      if (/timed out before login|fresh socket/i.test(clean)) { send({ kind: "log", text: "↻ conexão com o WhatsApp renovada" }); return; }
      if (/^OpenClaw \d|^│$|^◇\s*$/.test(clean) || /^[A-Z][^.]*—/.test(clean)) return; // banner, moldura e frase de efeito do CLI
      send({ kind: "log", text: clean });
      // Conectado só vem do vigia do script (creds.json com número), em JSON; o texto do CLI só vai para o log.
      if (!connected && OC_FAIL_RE.test(clean)) send({ kind: "error", text: clean });
    };
    const handle = async (line: string): Promise<void> => {
      let ev: { event?: string; qr?: string; step?: string; port?: unknown; user?: { id?: string }; error?: string; reason?: unknown; session?: string };
      try { ev = JSON.parse(line) as typeof ev; } catch { if (openclaw) handleText(line); else send({ kind: "log", text: line }); return; }
      switch (ev.event) {
        case "meu-bot":
          log(`[whatsapp] pareamento em ${host}: passo ${ev.step ?? "?"}`);
          if (ev.step === "openclaw") { openclaw = true; send({ kind: "step", text: "OpenClaw nesta máquina; usando `openclaw channels login`" }); }
          else if (ev.step === "gateway-stopped") send({ kind: "step", text: "gateway do Hermes pausado durante o pareamento" });
          else if (ev.step === "gateway-repair") send({ kind: "step", text: "o Hermes desta máquina estava sem as dependências do gateway; consertando (hermes pm repair, alguns minutos)" });
          else if (ev.step === "gateway-down") send({ kind: "log", text: "o gateway do Hermes não voltou depois do conserto; veja `journalctl --user -u hermes-gateway` na máquina" });
          else if (ev.step === "bridge-deps") send({ kind: "step", text: "instalando as dependências do WhatsApp do Hermes (só na primeira vez, 1–2 min)" });
          else if (ev.step === "ensure") send({ kind: "step", text: "WhatsApp ligado no Hermes; sem modelo escolhido, ele responde pelo Claude do meu-bot desta máquina" });
          else if (ev.step === "session-moved") send({ kind: "step", text: "sessão deslogada guardada como session.loggedout-…" });
          else if (ev.step === "logged-out") send({ kind: "step", text: "sessão anterior desfeita (channels logout)" });
          else if (ev.step === "model-set") send({ kind: "step", text: "o agente desta conta não tinha modelo; passou a usar o Claude (pelo Claude Code logado aqui)" });
          else if (ev.step === "fallback-set") send({ kind: "step", text: "reserva do agente: esgotadas as contas do Claude, o Grok desta máquina responde" });
          else if (ev.step === "gateway-installed") send({ kind: "step", text: `esta conta não tinha o gateway do OpenClaw; instalado na porta ${String(ev.port ?? "?")}` });
          else if (ev.step === "plugin-installing") send({ kind: "step", text: "esta máquina não tinha o plugin do WhatsApp do OpenClaw; instalando (até 1–2 min)" });
          else if (ev.step === "plugin-installed") send({ kind: "step", text: "plugin do WhatsApp instalado" });
          else if (ev.step === "silent") send({ kind: "step", text: "padrão: só você fala com o agente; ninguém mais recebe resposta nem código" });
          else if (ev.step === "gateway-started") send({ kind: "step", text: "gateway de volta no ar" });
          else if (ev.step === "gateway-port") send({ kind: "step", text: `o gateway desta conta apontava para o gateway de outra conta da máquina; ganhou a porta própria ${String(ev.port ?? "?")}` });
          break;
        case "started": send({ kind: "step", text: openclaw ? "gerando o QR…" : "bridge do Hermes iniciado; gerando o QR…" }); break;
        case "qr":
          log(`[whatsapp] pareamento em ${host}: QR`);
          if (typeof ev.qr === "string" && ev.qr !== "") {
            try { send({ kind: "qr", dataUrl: await toDataURL(ev.qr, { margin: 1, width: 360 }) }); } catch (e) { send({ kind: "error", text: `não consegui desenhar o QR: ${e instanceof Error ? e.message : String(e)}` }); }
          }
          break;
        case "disconnected": send({ kind: "log", text: `desconectado (${String(ev.reason ?? "?")}); tentando de novo…` }); break;
        case "connected": if (!connected) log(`[whatsapp] pareamento em ${host}: vinculado (${ev.user?.id ?? "?"})`); connected = true; send({ kind: "connected", number: phoneOf(ev.user?.id ?? "") }); break;
        case "error": send({ kind: "error", text: ev.error === "logged_out" ? "o WhatsApp recusou a sessão (logged out). Use \"Desconectar\" e depois conecte de novo para gerar um QR novo." : (ev.error ?? "erro no bridge") }); break;
        default: send({ kind: "log", text: line });
      }
    };
    let chain = Promise.resolve();
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line !== "") chain = chain.then(() => handle(line)); }
    });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.stdin.on("error", () => { /* ssh caiu */ });
    child.stdin.end(`RESET=${reset ? "1" : "0"}\n${PAIR_SCRIPT}`);
    child.on("error", (e) => { send({ kind: "error", text: `não consegui iniciar o ssh: ${e.message}` }); });
    child.on("close", (code) => {
      void chain.then(() => {
        const pending = qr.flush();
        if (pending !== null) send({ kind: "qr", dataUrl: blocksToSvgDataUrl(pending) });
        if (!connected && code !== 0 && code !== null) send({ kind: "error", text: `o pareamento terminou sem conectar (código ${code})${stderr.trim() ? `: ${stderr.trim().split("\n").pop()}` : ""}` });
        send({ kind: "done", ok: connected });
        log(`[whatsapp] pareamento em ${host}: ${connected ? "conectado" : `não conectou (código ${code})`}`);
        esquecerWhatsapp(host);
        current = null;
        resolve();
      });
    });
  });
}

/** Cancela o pareamento em andamento; o script remoto sobe o gateway de novo (trap). */
export function cancelPairing(): void {
  if (current === null) return;
  try { current.child.kill("SIGTERM"); } catch { /* ok */ }
}
