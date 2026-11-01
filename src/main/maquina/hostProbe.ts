/**
 * Sondagem e instalação do backend num host SSH, pensadas para a tela de Configurações:
 * "este host está acessível? tem o backend? o Claude Code dele está logado?" e, se faltar o
 * backend mas o Claude estiver logado, instalar com o mesmo instalador usado no Colima.
 *
 * Usa ssh/scp avulsos (ControlMaster=no, sem o mux do túnel) para não interferir no túnel ativo.
 */
import { BUNDLE_FILES, CLAUDE_GLOBAL_FILES, CRM_FILES, CRM_PLUGIN_FILES, FINANCE_FILES, FINANCE_PLUGIN_FILES, GUARDA_FILES, GUARDA_PLUGIN_FILES, TELA_FILES, TELA_PLUGIN_FILES, TELA_SKILL_FILES } from "./backend-bundle-core";
import { NAV_MCP_VERSAO } from "../navegador/navegador-whatsapp-core";
import { GMAIL_MCP_VERSAO } from "../google/gmail-core";
import { isVozId } from "../whatsapp/vozes-core";
import { WA_ESCOLHA_SH } from "../whatsapp/whatsapp-capacidades";
import { hermesPausaPluginSh, lerPausaPlugin, versaoDoPluginYaml, type PausaPluginFonte } from "../whatsapp/whatsapp-hermes-pausa-core";
import { HERMES_PIPER_VOICE, HERMES_RESTART_SH, HERMES_VENV_PY_SH, HERMES_VOZ_LOCAL_SH, hermesAudioPatch, hermesConfigSetSh, hermesPmExtraSh, hermesSttLigarSh } from "../whatsapp/whatsapp-hermes-core";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, shell } from "electron";
import os from "node:os";
import type { AudioSetup, HostProbe, InstallBackendResult, MaquinaAlerta } from "../../shared/ipc";
import { claudeLoggedIn, findClaude, findNode, LOCAL_HOST, localBackendAlive } from "./localBackend";
import { isValidHost } from "../app/settings";

import { BACKEND_DIR_SH } from "./backend-dir-core";
const REMOTE_STAGE = "~/.meu-bot-install";
/**
 * Cada instalador vai para a própria subpasta (`~/.meu-bot-install/<componente>/`), junto com os arquivos que ele lê
 * da pasta dele: backend, audio, grok, navegador, crm, financeiro, guarda, statusline. Antes, tudo ia solto no mesmo
 * nível (36 arquivos misturados).
 */
const stageDe = (componente: string): string => `${REMOTE_STAGE}/${componente}`;
/** Recomeça a subpasta do componente e varre o jeito antigo (arquivos soltos e as pastas finance/ e skills/ do nível de cima). */
const limparStage = (componente: string): string => `find ${REMOTE_STAGE} -maxdepth 1 -type f -delete 2>/dev/null; rm -rf ${REMOTE_STAGE}/finance ${REMOTE_STAGE}/skills ${stageDe(componente)}`;

const sshBase = (host: string): string[] => [
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=12", "-o", "ControlMaster=no", "-o", "ControlPath=none",
  "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=2",
];

interface RunResult { code: number | null; stdout: string; stderr: string }

function run(cmd: string, args: string[], timeoutMs: number, onLine?: (line: string) => void): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let done = false; let pending = "";
    const feed = (d: Buffer): void => {
      const s = d.toString("utf8"); stdout += s;
      if (onLine === undefined) return;
      pending += s;
      let i: number;
      while ((i = pending.indexOf("\n")) >= 0) { onLine(pending.slice(0, i)); pending = pending.slice(i + 1); }
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    const timer = setTimeout(() => { if (!done) child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}\n${e.message}` }); } });
    child.on("close", (code) => { if (!done) { done = true; clearTimeout(timer); if (pending !== "" && onLine) onLine(pending); resolve({ code, stdout, stderr }); } });
  });
}

const lastLine = (s: string): string => s.trim().split("\n").filter((l) => l !== "" && !l.startsWith("Warning: Permanently added")).pop() ?? "";

/** Link de verificação do Tailscale SSH ("# To authenticate, visit: https://login.tailscale.com/a/…"). */
export const TAILSCALE_CHECK_RE = /https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9]+/;
export const tailscaleCheckUrl = (text: string): string | null => TAILSCALE_CHECK_RE.exec(text)?.[0] ?? null;

/**
 * Verificação do Tailscale SSH: o link só vale enquanto a sessão ssh que o pediu estiver viva, então
 * abrimos um ssh paciente, levamos o link ao navegador e esperamos a aprovação (até 4 min).
 */
export function approveTailscaleCheck(host: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=240", "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new", "--", host, "echo ok"], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; let stdout = ""; let opened = false; let done = false;
    const timer = setTimeout(() => { if (!done) child.kill("SIGKILL"); }, 250_000);
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
      const url = tailscaleCheckUrl(stderr);
      if (url !== null && !opened) { opened = true; void shell.openExternal(url); }
    });
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, detail: e.message }); } });
    child.on("close", (code) => {
      if (done) return; done = true; clearTimeout(timer);
      if (code === 0 && stdout.includes("ok")) resolve({ ok: true, detail: opened ? "verificação aprovada; o ssh entrou" : "o ssh entrou sem pedir verificação" });
      else resolve({ ok: false, detail: opened ? `o link foi aberto mas a sessão terminou sem aprovação (${lastLine(stderr) || `código ${code}`})` : (lastLine(stderr) || `ssh saiu com código ${code}`) });
    });
  });
}

/** Script remoto: imprime `chave=valor` por linha; cada checagem é tolerante a ferramenta ausente. */
function probeScript(port: number): string {
  return [
    `echo "user=$(id -un 2>/dev/null)"`,
    // Apelido da conta, gravado na própria máquina (campo de descrição do usuário; o admin o grava na aba Usuários).
    `echo "apelido=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f5 | cut -d, -f1 | sed -n 's/^meu-bot=//p' | tr -d '\\r\\n' | { python3 -c 'import sys; sys.stdout.write(sys.stdin.read()[:40])' 2>/dev/null || head -c 40; })"`,
    `echo "os=$(. /etc/os-release 2>/dev/null && printf '%s' "$PRETTY_NAME")"`,
    `echo "arch=$(uname -m 2>/dev/null)"`,
    // Pasta do backend do meu-bot (própria, ou a herdada quando o server.js lá é o nosso); outro backend na herdada = foreign.
    BACKEND_DIR_SH,
    `echo "backenddir=$BD"; echo "foreign=$FOREIGN"`,
    `[ -f "$BD/.env" ] && echo env=1 || echo env=0`,
    `[ -f "$BD/server.js" ] && echo server=1 || echo server=0`,
    // O serviço meu-bot-backend desta conta no ar sem os arquivos (pasta apagada; o node antigo roda de memória): o PID
    // principal da unidade (de usuário, ou de sistema quando o User dela sou eu) e a porta em que ele escuta. Sem isso a
    // sondagem lia "porta ocupada por outro programa" e o seletor instalava um segundo backend ao lado do zumbi.
    `UP=$(systemctl --user show -p MainPID --value meu-bot-backend.service 2>/dev/null | tr -dc 0-9); [ "\${UP:-0}" -gt 0 ] || { [ "$(systemctl show -p User --value meu-bot-backend.service 2>/dev/null)" = "$(id -un)" ] && UP=$(systemctl show -p MainPID --value meu-bot-backend.service 2>/dev/null | tr -dc 0-9); }; echo "unitpid=\${UP:-0}"`,
    `echo "unitport=$([ "\${UP:-0}" -gt 0 ] && (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E "pid=$UP,|[[:space:]]$UP/" | grep -oE ':[0-9]+ ' | head -1 | tr -dc 0-9)"`,
    // Versão do backend instalado (o install.sh grava VERSION só quando ele respondeu); sem arquivo = anterior ao versionamento.
    `echo "backendver=$(cat "$BD/VERSION" 2>/dev/null)"`,
    // A porta do backend é a do .env dele (o app pode estar com outra); sem backend, é a que o app usa.
    `EP=$(grep '^PORT=' "$BD/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -dc 0-9); echo "envport=$EP"`,
    `L=$( (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) ); BP=\${EP:-${port}}`,
    `echo "$L" | grep -q ":$BP " && echo port=1 || echo port=0`,
    // A porta do app está tomada nesta máquina? (sem backend nesta conta: outra conta ou outro programa)
    `echo "$L" | grep -q ':${port} ' && echo busy=1 || echo busy=0`,
    // Primeira porta livre acima da do app, para o seletor instalar sem conflito.
    `F=; q=$((${port}+1)); while [ $q -le $((${port}+30)) ]; do echo "$L" | grep -q ":$q " || { F=$q; break; }; q=$((q+1)); done; echo "freeport=$F"`,
    `C=$(command -v claude 2>/dev/null); [ -z "$C" ] && [ -x "$HOME/.local/bin/claude" ] && C="$HOME/.local/bin/claude"; echo "claude=$C"`,
    `{ grep -q '"oauthAccount"' "$HOME/.claude.json" 2>/dev/null || grep -q '"chave"' "$HOME/.local/share/meu-bot/claude-global.json" 2>/dev/null; } && echo login=1 || echo login=0`,
    // Status line nossa: o statusline.sh que grava o cache de limites lido em /v1/meu-bot/status.
    `grep -q ratelimits.json "$HOME/.claude/statusline.sh" 2>/dev/null && echo statusline=1 || echo statusline=0`,
    // Guarda do WhatsApp (plugin meu-bot-guarda do OpenClaw): a cópia que o install-guarda.sh registra por --link.
    `[ -f "$HOME/.local/share/meu-bot/guarda/index.js" ] && echo guarda=1 || echo guarda=0`,
    // Versão instalada com sucesso (o instalador grava .ok no fim); sem .ok = instalação antiga ou incompleta → atualiza.
    `echo "guardaver=$(cat "$HOME/.local/share/meu-bot/guarda/.ok" 2>/dev/null)"`,
    // Plugin de pausa por contato do Hermes (meu-bot-pausa): a versão que o instalador gravou no fim (.ok); vazio = sem plugin.
    `echo "hpausaver=$(cat "$HOME/.hermes/plugins/meu-bot-pausa/.ok" 2>/dev/null | tr -dc '0-9.')"`,
    // CRM do meu-bot (plugin meu-bot-crm + crm-job): instalado? e a versão (o seletor atualiza a que estiver atrás).
    `[ -f "$HOME/.local/share/meu-bot/crm/index.js" ] && echo crm=1 || echo crm=0`,
    `echo "crmver=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("version",""))' "$HOME/.local/share/meu-bot/crm/package.json" 2>/dev/null)"`,
    // Financeiro (produto meu-bot-finance: CLI finance.mjs + plugin meu-bot-finance): instalado? e a versão.
    `[ -f "$HOME/.local/share/meu-bot/finance/finance.mjs" ] && echo finance=1 || echo finance=0`,
    `echo "financever=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("version",""))' "$HOME/.local/share/meu-bot/finance/package.json" 2>/dev/null)"`,
    // Agente de chat: openclaw (CLI em ~/.openclaw/bin) tem preferência; senão hermes (~/.local/bin); senão
    // picoclaw (binário no PATH com ~/.picoclaw/config.json — o config é o que distingue de uma cópia solta).
    `G=; { command -v openclaw >/dev/null 2>&1 || [ -x "$HOME/.openclaw/bin/openclaw" ]; } && G=openclaw; [ -z "$G" ] && { command -v hermes >/dev/null 2>&1 || [ -x "$HOME/.local/bin/hermes" ] || [ -d "$HOME/.hermes/whatsapp" ]; } && G=hermes; [ -z "$G" ] && { command -v picoclaw >/dev/null 2>&1 || [ -x "$HOME/.local/bin/picoclaw" ]; } && [ -f "$HOME/.picoclaw/config.json" ] && G=picoclaw; echo "gateway=$G"`,
    // OpenClaw: o agente do WhatsApp entende áudio? (transcritor em tools.media.models; o openclaw.json é JSON puro)
    `[ "$G" = openclaw ] && echo "audioin=$(python3 -c 'import json,os;c=json.load(open(os.path.expanduser("~/.openclaw/openclaw.json")));m=(c.get("tools") or {}).get("media") or {};print(int(any("audio" in (x.get("capabilities") or []) for x in (m.get("models") or []) if isinstance(x,dict))))' 2>/dev/null)"`,
    `echo "node=$(command -v node >/dev/null 2>&1 && node -v 2>/dev/null)"`,
    // Disco da home e memória (kB): o whisper da transcrição baixa ~500 MB e o OpenClaw enche de transcripts.
    `echo "disk=$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $2" "$4}')"`,
    `echo "mem=$(free -k 2>/dev/null | awk '/^Mem:/{print $2" "$7}')"`,
    `echo "swap=$(free -k 2>/dev/null | awk '/^Swap:/{print $2" "$4}')"`,
    `echo "systemd=$(command -v systemctl >/dev/null 2>&1 && echo 1 || echo 0)"`,
    // Computador do Grok Bot: PID 1 é o pod-daemon (sob tini) ou o cgroup do init é pod-…
    `( tr '\\0' ' ' </proc/1/cmdline 2>/dev/null | grep -q pod-daemon || grep -q 'pod-' /proc/1/cgroup 2>/dev/null ) && echo grokpod=1 || echo grokpod=0`,
    // Chats em andamento no backend (/health, sem chave): o app só reinstala o backend, que reinicia o serviço, com zero.
    // O mesmo /health traz o alerta do vigia da máquina (memória/disco/travamento, saude-maquina.js); backend antigo: vazio.
    `BH=$(curl -s -m 4 http://127.0.0.1:$BP/health 2>/dev/null); echo "backendbusy=$(printf '%s' "$BH" | grep -o '"ativos":[0-9]*' | cut -d: -f2)"; echo "backendalerta=$(printf '%s' "$BH" | grep -o '"alerta":"[a-z]*"' | cut -d'"' -f4)"`,
    `K=$(grep '^OPENAI_COMPAT_KEY=' "$BD/.env" 2>/dev/null | head -1 | cut -d= -f2-); echo "models=$(curl -s -m 6 -H "Authorization: Bearer $K" http://127.0.0.1:$BP/v1/models 2>/dev/null | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | tr '\n' ,)"`,
  ].join("; ");
}

/** "total livre" em kB → MB (null quando a máquina não respondeu); mantém o mesmo nome de campo para disco e memória. */
function sizePair(v: string | undefined, kind: "disk" | "mem" | "swap"): { diskTotalMb: number | null; diskFreeMb: number | null } | { memTotalMb: number | null; memFreeMb: number | null } | { swapTotalMb: number | null; swapFreeMb: number | null } {
  const m = /^(\d+)\s+(\d+)$/.exec((v ?? "").trim());
  const total = m === null ? null : Math.round(Number(m[1]) / 1024), free = m === null ? null : Math.round(Number(m[2]) / 1024);
  return kind === "disk" ? { diskTotalMb: total, diskFreeMb: free } : kind === "mem" ? { memTotalMb: total, memFreeMb: free } : { swapTotalMb: total, swapFreeMb: free };
}
const ALERTAS_MAQUINA: readonly MaquinaAlerta[] = ["box", "memoria", "disco", "lag"];

/** Porta vinda da sondagem (só dígitos, 1 a 65535); vazio ou lixo = null. */
function parsePort(v: string | undefined): number | null {
  const n = /^\d{1,5}$/.test(v ?? "") ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

function parseKv(stdout: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) m.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return m;
}

export async function probeHost(host: string, port: number): Promise<HostProbe> {
  if (host === LOCAL_HOST) return probeLocal(port);
  const base: HostProbe = {
    host, reachable: false, user: null, apelido: null, os: null, arch: null, backendInstalled: false, backendForeign: false, backendListening: false, backendSumiu: false, backendUnitPort: null, backendVersion: null, backendBusy: null,
    appPort: port, backendPort: null, portBusy: false, freePort: null,
    claudePath: null, claudeLoggedIn: false, node: null, diskTotalMb: null, diskFreeMb: null, memTotalMb: null, memFreeMb: null, swapTotalMb: null, swapFreeMb: null, backendAlerta: null, systemd: false, grokPod: false, tailscaleCheck: false, statusLine: false, guarda: null, guardaVersion: null, crm: null, crmVersion: null, finance: null, financeVersion: null, audioIn: null, gateway: null, models: [], error: null,
  };
  const t0 = Date.now();
  // Falha rápida (o host respondeu "ainda não": sshd subindo, rota do Tailscale recém-negociada)
  // costuma passar na segunda tentativa, e repetir custa menos de um segundo. Já um timeout cheio
  // é host fora: repetir só faria o seletor, que sonda todos em paralelo, esperar o dobro à toa.
  let r = await run("ssh", [...sshBase(host), "--", host, probeScript(port)], 25_000);
  if (r.code !== 0 && Date.now() - t0 < 3_000 && /connection (refused|reset|closed)|broken pipe/i.test(r.stderr)) {
    await new Promise((res) => setTimeout(res, 500));
    r = await run("ssh", [...sshBase(host), "--", host, probeScript(port)], 25_000);
  }
  if (r.code !== 0) {
    // O Tailscale SSH pediu a verificação extra: não é máquina fora, é aprovação pendente no navegador.
    if (tailscaleCheckUrl(r.stderr) !== null) return { ...base, tailscaleCheck: true, error: "o Tailscale SSH pede uma verificação extra no navegador antes de deixar entrar" };
    return { ...base, error: lastLine(r.stderr) || (r.code === null ? "tempo esgotado" : `ssh saiu com código ${r.code}`) };
  }
  const kv = parseKv(r.stdout);
  return {
    ...base,
    reachable: true,
    user: kv.get("user") || null,
    apelido: (kv.get("apelido") ?? "").trim() || null,
    os: kv.get("os") || null,
    arch: kv.get("arch") || null,
    backendInstalled: kv.get("env") === "1" && kv.get("server") === "1",
    backendForeign: kv.get("foreign") === "1",
    backendListening: kv.get("port") === "1",
    backendSumiu: kv.get("server") !== "1" && Number(kv.get("unitpid") ?? 0) > 0,
    backendUnitPort: parsePort(kv.get("unitport")),
    backendVersion: kv.get("backendver") || null,
    backendBusy: /^\d+$/.test(kv.get("backendbusy") ?? "") ? Number(kv.get("backendbusy")) : null,
    backendPort: parsePort(kv.get("envport")),
    portBusy: kv.get("busy") === "1",
    freePort: parsePort(kv.get("freeport")),
    claudePath: kv.get("claude") || null,
    claudeLoggedIn: kv.get("login") === "1",
    node: kv.get("node") || null,
    ...sizePair(kv.get("disk"), "disk"), ...sizePair(kv.get("mem"), "mem"), ...sizePair(kv.get("swap"), "swap"),
    backendAlerta: ALERTAS_MAQUINA.find((a) => a === kv.get("backendalerta")) ?? null,
    systemd: kv.get("systemd") === "1",
    grokPod: kv.get("grokpod") === "1",
    statusLine: kv.get("statusline") === "1",
    guarda: kv.get("gateway") === "openclaw" ? kv.get("guarda") === "1" : null,
    guardaVersion: kv.get("guardaver") || null,
    hermesPausa: kv.get("gateway") === "hermes" ? (kv.get("hpausaver") ?? "") !== "" : null,
    hermesPausaVersion: kv.get("hpausaver") || null,
    crm: kv.get("crm") === "1",
    crmVersion: kv.get("crmver") || null,
    finance: kv.get("finance") === "1",
    financeVersion: kv.get("financever") || null,
    audioIn: kv.get("gateway") === "openclaw" ? kv.get("audioin") === "1" : null,
    gateway: kv.get("gateway") === "openclaw" ? "openclaw" : kv.get("gateway") === "hermes" ? "hermes" : kv.get("gateway") === "picoclaw" ? "picoclaw" : null,
    models: (kv.get("models") ?? "").split(",").map((m) => m.trim()).filter((m) => /^[a-z0-9-]+$/.test(m)),
  };
}

const fileHas = (file: string, needle: string): boolean => { try { return fs.readFileSync(file, "utf8").includes(needle); } catch { return false; } };

/**
 * A status line efetiva deste Mac grava o cache de limites? Settings gerenciadas ganham do settings.json
 * do usuário: se elas definem statusLine, só o script delas conta.
 */
function localStatusLine(): boolean {
  try {
    const managed = JSON.parse(fs.readFileSync("/Library/Application Support/ClaudeCode/managed-settings.json", "utf8")) as { statusLine?: { command?: string } };
    if (managed.statusLine !== undefined) {
      const m = /(\/[^'"]+statusline\.sh)/.exec(managed.statusLine.command ?? "");
      return m !== null && fileHas(m[1]!, "ratelimits.json");
    }
  } catch { /* sem settings gerenciadas */ }
  return fileHas(path.join(os.homedir(), ".claude", "statusline.sh"), "ratelimits.json");
}

/** "local": este Mac, sem SSH. O backend vai junto no app, então "instalado" é sempre verdade. */
function probeLocal(port: number): HostProbe {
  const node = findNode();
  const claude = findClaude();
  let nodeVersion: string | null = null;
  if (node !== null) { try { nodeVersion = spawnSync(node, ["-v"], { encoding: "utf8", timeout: 5000 }).stdout.trim() || null; } catch { /* sem versão */ } }
  return {
    host: LOCAL_HOST, reachable: true, user: os.userInfo().username, apelido: null, os: `macOS ${os.release()}`, arch: os.arch(),
    backendInstalled: true, backendForeign: false, backendListening: localBackendAlive(), backendSumiu: false, backendUnitPort: null, backendVersion: null, backendBusy: null, appPort: port, backendPort: null, portBusy: false, freePort: null, claudePath: claude, claudeLoggedIn: claude !== null && claudeLoggedIn(),
    node: nodeVersion, diskTotalMb: null, diskFreeMb: null, memTotalMb: null, memFreeMb: null, swapTotalMb: null, swapFreeMb: null, backendAlerta: null, systemd: false, grokPod: false, tailscaleCheck: false, statusLine: localStatusLine(), guarda: null, guardaVersion: null, crm: null, crmVersion: null, finance: null, financeVersion: null, audioIn: null, gateway: null, models: ["claudecode", "agente"], error: node === null ? "Node.js não encontrado neste Mac" : null,
  };
}

/** Pasta com server.js, session-map.js, a unidade systemd e install.sh (Resources/ no .app; raiz no dev). */
/**
 * Módulos de produto (src/main/modulos/modulos.ts): manda a pasta local de um módulo para o stage da máquina
 * (`~/.meu-bot-install/modulo-<id>/`) e roda `comando` lá dentro (o instalador ou o desinstalador), com o progresso
 * linha a linha. Mesmo molde de installFinance; o stage do módulo é limpo antes.
 */
export async function enviarModulo(host: string, id: string, pastaLocal: string, comando: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: false, log: ["os módulos moram numa máquina por SSH"] };
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(id)) return { ok: false, log: ["módulo inválido"] };
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const stage = stageDe(`modulo-${id}`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `rm -rf ${stage} && mkdir -p ${stage}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", "-r", ...sshBase(host), "--", `${pastaLocal}/.`, `${host}:${stage}/`], 120_000);
  if (scp.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp.stderr)}`] };
  const r = await run("ssh", [...sshBase(host), "--", host, `cd ${stage} && ${comando} 2>&1`], 15 * 60_000, say);
  if (r.code !== 0) return { ok: false, log: [...lines, r.code === null ? "o instalador do módulo não terminou em 15 min" : `o instalador do módulo saiu com código ${r.code}`] };
  return { ok: true, log: lines };
}

export function backendBundleDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "backend-colima") : path.join(app.getAppPath(), "backend-colima");
}


/** Copia o bundle para o host e roda o instalador; `onLine` recebe o progresso linha a linha. */
export async function installBackend(host: string, port: number, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: true, log: ["o backend deste Mac vai dentro do app; nada a instalar"] };
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const dir = backendBundleDir();
  say(`enviando ${BUNDLE_FILES.length} arquivos para ${host}:${stageDe("backend")}…`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `${limparStage("backend")}; mkdir -p ${stageDe("backend")}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", ...sshBase(host), "--", ...BUNDLE_FILES.map((f) => path.join(dir, f)), `${host}:${stageDe("backend")}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp.stderr)}`] };
  say("rodando o instalador…");
  const inst = await run("ssh", [...sshBase(host), "--", host, `PORT=${port} bash ${stageDe("backend")}/install.sh 2>&1`], 10 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}


/**
 * Claude Code na conta do alias (outro usuário da mesma máquina, por exemplo): o instalador oficial
 * (claude.ai/install.sh) põe o binário em ~/.local/bin sem precisar de Node nem de root; idempotente (se já
 * existe, só confere a versão). O login e o backend vêm depois, pelos botões de sempre do seletor.
 */
export async function installClaudeCode(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: false, log: ["neste Mac, instale o Claude Code pelo site: https://claude.ai/code"] };
  const lines: string[] = [];
  const say = (l: string): void => { if (l.trim() !== "") { lines.push(l); onLine?.(l); } };
  const script = [
    `export PATH="$HOME/.local/bin:$PATH"`,
    `if command -v claude >/dev/null 2>&1; then echo "Claude Code já instalado: $(claude --version 2>/dev/null | head -1)"; exit 0; fi`,
    `command -v curl >/dev/null 2>&1 || { echo "esta máquina não tem curl; instale com: sudo apt install curl"; exit 2; }`,
    `echo "baixando o instalador oficial do Claude Code…"`,
    `curl -fsSL https://claude.ai/install.sh | bash 2>&1`,
    `command -v claude >/dev/null 2>&1 || [ -x "$HOME/.local/bin/claude" ] || { echo "o instalador terminou, mas não achei o claude em ~/.local/bin"; exit 3; }`,
    `echo "pronto: Claude Code instalado em ~/.local/bin; agora é Entrar no Claude Code"`,
  ].join("; ");
  say(`instalando o Claude Code em ${host} (conta do alias)…`);
  const r = await run("ssh", [...sshBase(host), "--", host, `bash -c ${JSON.stringify(script)}`], 5 * 60_000, say);
  if (r.code !== 0) return { ok: false, log: [...lines, r.code === null ? "o instalador não terminou em 5 min" : lastLine(r.stderr) || `instalador saiu com código ${r.code}`] };
  return { ok: true, log: lines };
}

/**
 * Áudio do agente do WhatsApp. OpenClaw: "in" = transcrição local (install-transcricao.sh), "out" = voz local
 * com o modo (install-voz.sh off|inbound|always), mesmo molde da status line. Hermes: grava `stt` e
 * `voice.auto_tts` no config.yaml dele (a transcrição e a voz são do próprio Hermes) e reinicia o gateway.
 */
/**
 * Claude Code Global (root): envia o intermediário (claude-global.js e o que ele lê) e roda o instalador como root.
 * `host` é o alias do root. Devolve a porta e se o root já entrou no Claude Code.
 */
export async function installClaudeGlobal(host: string): Promise<{ ok: boolean; porta: number | null; login: boolean; email: string | null; erro: string | null }> {
  const falha = (erro: string): { ok: false; porta: null; login: false; email: null; erro: string } => ({ ok: false, porta: null, login: false, email: null, erro });
  const mk = await run("ssh", [...sshBase(host), "--", host, `${limparStage("claude-global")}; mkdir -p ${stageDe("claude-global")}`], 20_000);
  if (mk.code !== 0) return falha(`falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`);
  const arquivos = CLAUDE_GLOBAL_FILES.map((f) => path.join(backendBundleDir(), f));
  const scp = await run("scp", ["-q", ...sshBase(host), "--", ...arquivos, `${host}:${stageDe("claude-global")}/`], 60_000);
  if (scp.code !== 0) return falha(`scp falhou: ${lastLine(scp.stderr)}`);
  const r = await run("ssh", [...sshBase(host), "--", host, `bash ${stageDe("claude-global")}/install-claude-global.sh 2>&1`], 5 * 60_000);
  const erro = /^ERRO=(.*)$/m.exec(r.stdout)?.[1];
  if (erro !== undefined) return falha(erro);
  const ok = /^CLAUDE_GLOBAL=ok (\d+)$/m.exec(r.stdout);
  if (ok === null) return falha(lastLine(r.stdout) || lastLine(r.stderr) || "o instalador não respondeu");
  const email = /^EMAIL=(\S+@\S+)$/m.exec(r.stdout)?.[1] ?? null;
  return { ok: true, porta: Number(ok[1]), login: /^LOGIN=1$/m.test(r.stdout), email, erro: null };
}

export async function installAudio(host: string, setup: AudioSetup, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  if (host === LOCAL_HOST) return { ok: false, log: ["este Mac não tem agente com WhatsApp"] };
  const gw = await run("ssh", [...sshBase(host), "--", host, `${WA_ESCOLHA_SH}; usa_hermes && echo hermes || echo outro`], 30_000);
  if (/^hermes$/m.test(gw.stdout)) {
    const ligarStt = setup.kind === "in" && setup.off !== true;
    const ligarVoz = setup.kind === "out" && setup.mode !== "off";
    say(setup.kind === "in" ? (ligarStt ? "ligando a transcrição no Hermes…" : "desligando a transcrição no Hermes…") : ligarVoz ? "instalando a voz local (Piper pt-BR) no Hermes (só na primeira vez, 1–3 min)…" : "ajustando quando o Hermes responde em áudio…");
    // Voz = extra piper + a voz pt-BR já baixada (senão a 1ª resposta demora ~30 s) + ffmpeg (sem ele o áudio não vira
    // Ogg/Opus e não chega como mensagem de voz; instala pelo apt quando dá). Os extras são do ambiente do gateway
    // (hermes pm) e são idempotentes: já instalados, levam segundos.
    // Transcrição: com o transcritor compartilhado da máquina (/opt/transcriber, do root), só aponta o Hermes para ele;
    // sem ele (máquina de antes do padrão), instala o extra no ambiente deste usuário, como antes.
    const stt = `${hermesSttLigarSh()}\n`;
    const extra = ligarStt ? ""
      : ligarVoz ? `${hermesPmExtraSh("piper")}\n${HERMES_VENV_PY_SH}\ncommand -v ffmpeg >/dev/null 2>&1 || { if [ "$(id -u)" = 0 ]; then DEBIAN_FRONTEND=noninteractive apt-get install -y -q ffmpeg; elif sudo -n true 2>/dev/null; then sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -q ffmpeg; fi; } >/dev/null 2>&1; command -v ffmpeg >/dev/null 2>&1 || echo "ffmpeg=falta"\nmkdir -p "$HOME/.hermes/cache/piper-voices"; [ -s "$HOME/.hermes/cache/piper-voices/${HERMES_PIPER_VOICE}.onnx" ] || { [ -n "$HPY" ] && timeout 600 "$HPY" -m piper.download_voices ${HERMES_PIPER_VOICE} --download-dir "$HOME/.hermes/cache/piper-voices" >/dev/null 2>&1 || echo "voz=nao-baixou"; }\n` : "";
    // O script vai em base64 no próprio comando: tem aspas e quebras de linha que o argv do ssh não carrega intactas.
    // Ligar a voz: depois do config, o provedor voz-local (script + tts.provider); hermesConfigSetSh já deixou $PY definido.
    const b64 = Buffer.from(`set -e\n${extra}${ligarStt ? stt : `${hermesConfigSetSh(hermesAudioPatch(setup))}\n`}${ligarVoz ? `${HERMES_VOZ_LOCAL_SH}\n` : ""}${HERMES_RESTART_SH}\n`, "utf8").toString("base64");
    const r = await run("ssh", [...sshBase(host), "--", host, `echo ${b64} | base64 -d | bash`], 25 * 60_000);
    if (/extra=falhou/.test(r.stdout)) return { ok: false, log: [...lines, ligarStt ? "não consegui instalar o faster-whisper no Hermes (hermes pm install --extra stt-whisper); veja a máquina" : "não consegui instalar a voz Piper no Hermes (hermes pm install --extra piper); veja a máquina"] };
    if (r.code !== 0 || !r.stdout.includes("cfgset=ok") || (ligarVoz && !r.stdout.includes("voz=ok"))) return { ok: false, log: [...lines, `não consegui gravar o config.yaml do Hermes: ${lastLine(r.stderr) || lastLine(r.stdout) || "ssh falhou"}`] };
    if (/restart=falhou/.test(r.stdout)) return { ok: false, log: [...lines, "gravei, mas não consegui reiniciar o gateway do Hermes; reinicie-o na máquina para valer"] };
    say(setup.kind === "in"
      ? (ligarStt ? (/stt=compartilhado/.test(r.stdout) ? "✓ Transcrição ligada: o agente entende áudios em português, com o transcritor compartilhado da máquina" : "✓ Transcrição ligada: o agente entende áudios em português (o modelo, ~150 MB, baixa no primeiro áudio)") : "✓ Transcrição desligada")
      : setup.mode === "off" ? "✓ O agente responde só em texto" : `✓ O agente responde em áudio quando recebe áudio, com a voz local em português${/voz=nao-baixou/.test(r.stdout) ? " (a voz baixa na primeira resposta; ela demora um pouco mais)" : ""}${/ffmpeg=falta/.test(r.stdout) ? ". Falta o ffmpeg na máquina (apt-get install ffmpeg): sem ele o áudio chega como arquivo, não como mensagem de voz" : ""}`);
    return { ok: true, log: lines };
  }
  const file = setup.kind === "in" ? "install-transcricao.sh" : "install-voz.sh";
  const arg = setup.kind === "out" ? ` ${setup.mode}${setup.voz !== undefined && isVozId(setup.voz) ? ` ${setup.voz}` : ""}` : setup.off === true ? " off" : "";
  const mk = await run("ssh", [...sshBase(host), "--", host, `${limparStage("audio")}; mkdir -p ${stageDe("audio")}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", ...sshBase(host), "--", path.join(backendBundleDir(), file), `${host}:${stageDe("audio")}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp.stderr)}`] };
  // A transcrição baixa ~500 MB na primeira vez (faster-whisper + modelo): tempo de sobra.
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${stageDe("audio")}/${file}${arg} 2>&1`], 20 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, lines.at(-1) ?? `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}

/** A status line nossa está instalada no host (a mesma checagem da sondagem; neste Mac, com as settings gerenciadas)? */
export async function statusLineInstalled(host: string): Promise<boolean> {
  if (host === LOCAL_HOST) return localStatusLine();
  const r = await run("ssh", [...sshBase(host), "--", host, `grep -q ratelimits.json "$HOME/.claude/statusline.sh" 2>/dev/null && echo statusline=1 || echo statusline=0`], 25_000);
  if (r.code !== 0) throw new Error(lastLine(r.stderr) || "não consegui entrar na máquina");
  return r.stdout.includes("statusline=1");
}

/** Grok por OAuth (Hermes + proxy local + providers.json): manda install-grok-oauth.sh e roda no host. */
export async function prepareGrokOauth(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  if (host === LOCAL_HOST) return { ok: false, log: ["o Grok por OAuth vale para máquinas por SSH"] };
  const mk = await run("ssh", [...sshBase(host), "--", host, `${limparStage("grok")}; mkdir -p ${stageDe("grok")}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", ...sshBase(host), "--", path.join(backendBundleDir(), "install-grok-oauth.sh"), `${host}:${stageDe("grok")}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp.stderr)}`] };
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${stageDe("grok")}/install-grok-oauth.sh 2>&1`], 10 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, lines.at(-1) ?? `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}

const STATUSLINE_FILES = ["statusline.sh", "install-statusline.sh", "uninstall-statusline.sh"];
const WA_GRUPOS_SCRIPTS = ["habilitar.py", "listar.sh", "monitor.py", "wa-admin.sh", "wa-grupos.js"];
/** Versão do plugin do CRM que vem neste app (crm/package.json); o seletor atualiza máquinas com o CRM numa versão anterior. */
/** Versão do backend que vem neste app (backend-colima/VERSION); o seletor atualiza máquinas com o backend numa versão anterior. */
export function bundledBackendVersion(): string | null {
  try { return fs.readFileSync(path.join(backendBundleDir(), "VERSION"), "utf8").trim() || null; } catch { return null; }
}
/** Versão do plugin do financeiro que vem neste app; o seletor atualiza máquinas que já o têm numa versão anterior. */
export function bundledFinanceVersion(): string | null {
  try { const j = JSON.parse(fs.readFileSync(path.join(backendBundleDir(), "finance", "package.json"), "utf8")) as { version?: unknown }; return typeof j.version === "string" ? j.version : null; } catch { return null; }
}
export function bundledCrmVersion(): string | null {
  try { const j = JSON.parse(fs.readFileSync(path.join(backendBundleDir(), "crm", "package.json"), "utf8")) as { version?: unknown }; return typeof j.version === "string" ? j.version : null; } catch { return null; }
}
/** Versão da guarda que vem neste app (package.json do plugin); o seletor atualiza máquinas com versão diferente. */
/** O plugin de pausa do Hermes como está no bundle (backend-colima/hermes-plugins/meu-bot-pausa); null se o pacote veio sem ele. */
export function pausaPluginFonte(): PausaPluginFonte | null {
  try {
    const d = path.join(backendBundleDir(), "hermes-plugins", "meu-bot-pausa");
    const init = fs.readFileSync(path.join(d, "__init__.py"), "utf8"), yaml = fs.readFileSync(path.join(d, "plugin.yaml"), "utf8");
    const versao = versaoDoPluginYaml(yaml);
    return versao === null ? null : { init, yaml, versao };
  } catch { return null; }
}
export const bundledHermesPausaVersion = (): string | null => pausaPluginFonte()?.versao ?? null;
/** Fuso deste Mac, para os textos do plugin ("volto às 14:30") saírem na hora da pessoa. */
export const fusoDesteMac = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo"; } catch { return "America/Sao_Paulo"; } };
/**
 * Instala ou atualiza o plugin de pausa por contato no Hermes do usuário da máquina (idempotente; reinicia o gateway
 * só se mudou algo). O script leva os dois arquivos inline, como o preparo do usuário no admin.
 */
export async function installHermesPausa(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: false, log: ["a pausa por contato é do agente do WhatsApp (Hermes) de uma máquina por SSH"] };
  const fonte = pausaPluginFonte();
  if (fonte === null) return { ok: false, log: ["este pacote do app veio sem o plugin de pausa"] };
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  say(`instalando a pausa por contato (plugin ${fonte.versao}) no Hermes de ${host}…`);
  const r = await run("ssh", [...sshBase(host), "--", host, hermesPausaPluginSh(fonte, fusoDesteMac())], 3 * 60_000, say);
  const s = lerPausaPlugin(r.stdout);
  if (r.code !== 0 || !s.ok) return { ok: false, log: [...lines, `plugin=${s.plugin} enabled=${s.enabled}${r.stderr.trim() !== "" ? `: ${lastLine(r.stderr)}` : ""}`] };
  say(s.plugin === "nada" ? "plugin já estava no lugar" : `plugin ${s.plugin}; gateway: ${s.restart}`);
  return { ok: true, log: lines };
}

export function bundledGuardaVersion(): string | null {
  try { const j = JSON.parse(fs.readFileSync(path.join(backendBundleDir(), "guarda", "package.json"), "utf8")) as { version?: unknown }; return typeof j.version === "string" ? j.version : null; } catch { return null; }
}
/** Navegador do agente (módulo Pro): o servidor MCP (um arquivo) e o instalador. */
const NAVEGADOR_FILES = ["navegador-mcp.mjs", "install-navegador-mcp.sh", "skill-streak-crm-navegador.md", "skill-cloudflare-token.md", "skill-subir-site-cloudflare.md", "skill-google-2fa-autenticador.md"];

/** O lado da máquina do Navegador está instalado? (null para este Mac) */
export async function navegadorInstalled(host: string): Promise<boolean | null> {
  if (host === LOCAL_HOST || !isValidHost(host)) return null;
  const r = await run("ssh", [...sshBase(host), "--", host, `[ -f "$HOME/.local/share/meu-bot/navegador-mcp.mjs" ] && grep -q "meu-bot:navegador" "$HOME/agent-workspace/CLAUDE.md" 2>/dev/null && echo nav=1 || echo nav=0; grep -qs "${NAV_MCP_VERSAO}" "$HOME/.local/share/meu-bot/navegador-mcp.mjs" && echo ver=ok || echo ver=velha`], 25_000);
  // Instalado, mas com o servidor antigo (abas sem dono por conversa): atualiza em segundo plano.
  if (r.stdout.includes("nav=1") && r.stdout.includes("ver=velha")) void installNavegador(host).catch(() => undefined);
  return r.stdout.includes("nav=1");
}
/** Instala o lado da máquina do Navegador (MCP + regra no CLAUDE.md). Mesmo molde da status line. */
export async function installNavegador(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: false, log: ["o Navegador do agente é para máquinas por SSH"] };
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const dir = backendBundleDir();
  say(`enviando o Navegador do agente para ${host}:${stageDe("navegador")}…`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `${limparStage("navegador")}; mkdir -p ${stageDe("navegador")}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", ...sshBase(host), "--", ...NAVEGADOR_FILES.map((f) => path.join(dir, f)), `${host}:${stageDe("navegador")}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp.stderr)}`] };
  say("rodando o instalador…");
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${stageDe("navegador")}/install-navegador-mcp.sh 2>&1`], 2 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}
/** Gmail do agente (Pro, 31 out): o servidor MCP (um arquivo) e o instalador, no molde do Navegador. */
const GMAIL_FILES = ["gmail-mcp.mjs", "install-gmail-mcp.sh"];
/** O lado da máquina do Gmail está instalado? (null para este Mac) */
export async function gmailInstalled(host: string): Promise<boolean | null> {
  if (host === LOCAL_HOST || !isValidHost(host)) return null;
  const r = await run("ssh", [...sshBase(host), "--", host, `[ -f "$HOME/.local/share/meu-bot/gmail-mcp.mjs" ] && grep -q "meu-bot:gmail" "$HOME/agent-workspace/CLAUDE.md" 2>/dev/null && echo gm=1 || echo gm=0; grep -qs "${GMAIL_MCP_VERSAO}" "$HOME/.local/share/meu-bot/gmail-mcp.mjs" && echo ver=ok || echo ver=velha`], 25_000);
  if (r.stdout.includes("gm=1") && r.stdout.includes("ver=velha")) void installGmail(host).catch(() => undefined);
  return r.stdout.includes("gm=1");
}
export async function installGmail(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: false, log: ["o Gmail do agente é para máquinas por SSH"] };
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const dir = backendBundleDir();
  say(`enviando o Gmail do agente para ${host}:${stageDe("gmail")}…`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `${limparStage("gmail")}; mkdir -p ${stageDe("gmail")}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", ...sshBase(host), "--", ...GMAIL_FILES.map((f) => path.join(dir, f)), `${host}:${stageDe("gmail")}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp.stderr)}`] };
  say("rodando o instalador…");
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${stageDe("gmail")}/install-gmail-mcp.sh 2>&1`], 2 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}
/** Tutorial 17: instala o plugin meu-bot-crm + as CLIs (crm.mjs do CRM próprio, streak.mjs do Pro) + skills na máquina (molde da guarda). */
export async function installCrm(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: false, log: ["o CRM pelo WhatsApp é do agente do WhatsApp (OpenClaw) de uma máquina por SSH"] };
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const dir = backendBundleDir();
  say(`enviando o CRM para ${host}:${stageDe("crm")}…`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `${limparStage("crm")}; mkdir -p ${stageDe("crm")}/crm`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp1 = await run("scp", ["-q", ...sshBase(host), "--", ...CRM_FILES.map((f) => path.join(dir, f)), `${host}:${stageDe("crm")}/`], 60_000);
  if (scp1.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp1.stderr)}`] };
  const scp2 = await run("scp", ["-q", ...sshBase(host), "--", ...CRM_PLUGIN_FILES.map((f) => path.join(dir, "crm", f)), `${host}:${stageDe("crm")}/crm/`], 60_000);
  if (scp2.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp2.stderr)}`] };
  say("rodando o instalador…");
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${stageDe("crm")}/install-crm.sh 2>&1`], 4 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}
/**
 * Financeiro (produto meu-bot-finance): instala a CLI finance.mjs do agente, a skill finance-api e o plugin
 * meu-bot-finance do WhatsApp na máquina. Os dados (finance/db) ficam no backend; o instalador nunca os apaga.
 */
export async function installFinance(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: false, log: ["o financeiro mora numa máquina por SSH (é onde ficam o agente do WhatsApp e os dados)"] };
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const dir = backendBundleDir();
  say(`enviando o financeiro para ${host}:${stageDe("financeiro")}…`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `${limparStage("financeiro")}; mkdir -p ${stageDe("financeiro")}/finance`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp1 = await run("scp", ["-q", ...sshBase(host), "--", ...FINANCE_FILES.map((f) => path.join(dir, f)), `${host}:${stageDe("financeiro")}/`], 60_000);
  if (scp1.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp1.stderr)}`] };
  const scp2 = await run("scp", ["-q", ...sshBase(host), "--", ...FINANCE_PLUGIN_FILES.map((f) => path.join(dir, "finance", f)), `${host}:${stageDe("financeiro")}/finance/`], 60_000);
  if (scp2.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp2.stderr)}`] };
  say("rodando o instalador…");
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${stageDe("financeiro")}/install-finance.sh 2>&1`], 4 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}
export async function uninstallCrm(host: string): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: true, log: ["nada a desfazer neste Mac"] };
  const r = await run("ssh", [...sshBase(host), "--", host, `bash ${stageDe("crm")}/uninstall-crm.sh 2>&1 || bash ${REMOTE_STAGE}/uninstall-crm.sh 2>&1 || bash "$HOME/.local/share/meu-bot/crm/../uninstall-crm.sh" 2>&1 || { export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:$PATH"; openclaw plugins uninstall meu-bot-crm >/dev/null 2>&1; rm -rf "$HOME/.local/share/meu-bot/crm"; echo removido; }`], 2 * 60_000);
  return { ok: r.code === 0, log: r.stdout.trim().split("\n").filter(Boolean) };
}

/** A guarda do WhatsApp está nesta máquina? (a cópia registrada no OpenClaw; null para este Mac) */
export async function guardaInstalled(host: string): Promise<boolean | null> {
  if (host === LOCAL_HOST || !isValidHost(host)) return null;
  const r = await run("ssh", [...sshBase(host), "--", host, `command -v openclaw >/dev/null 2>&1 || [ -x "$HOME/.openclaw/bin/openclaw" ] || { echo guarda=none; exit 0; }; [ -f "$HOME/.local/share/meu-bot/guarda/index.js" ] && echo guarda=1 || echo guarda=0`], 25_000);
  if (r.stdout.includes("guarda=none")) return null;
  return r.stdout.includes("guarda=1");
}

/**
 * Instala a guarda do WhatsApp (plugin meu-bot-guarda) no OpenClaw da máquina: manda a pasta guarda/ e os scripts
 * e roda o instalador, que registra o plugin por --link (o gateway aplica na hora). Mesmo molde da status line.
 */
export async function installGuarda(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: false, log: ["a guarda é do agente do WhatsApp (OpenClaw) de uma máquina por SSH"] };
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const dir = backendBundleDir();
  say(`enviando a guarda para ${host}:${stageDe("guarda")}…`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `${limparStage("guarda")}; mkdir -p ${stageDe("guarda")}/guarda`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp1 = await run("scp", ["-q", ...sshBase(host), "--", ...GUARDA_FILES.map((f) => path.join(dir, f)), `${host}:${stageDe("guarda")}/`], 60_000);
  if (scp1.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp1.stderr)}`] };
  const scp2 = await run("scp", ["-q", ...sshBase(host), "--", ...GUARDA_PLUGIN_FILES.map((f) => path.join(dir, "guarda", f)), `${host}:${stageDe("guarda")}/guarda/`], 60_000);
  if (scp2.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp2.stderr)}`] };
  // Skill whatsapp-grupos vai junto (o install-guarda.sh a põe em ~/.claude/skills).
  const sk = path.join(dir, "skills", "whatsapp-grupos");
  const mk2 = await run("ssh", [...sshBase(host), "--", host, `mkdir -p ${stageDe("guarda")}/skills/whatsapp-grupos/scripts`], 20_000);
  const scp3 = mk2.code !== 0 ? mk2 : await run("scp", ["-q", ...sshBase(host), "--", path.join(sk, "SKILL.md"), `${host}:${stageDe("guarda")}/skills/whatsapp-grupos/`], 60_000);
  const scp4 = scp3.code !== 0 ? scp3 : await run("scp", ["-q", ...sshBase(host), "--", ...WA_GRUPOS_SCRIPTS.map((f) => path.join(sk, "scripts", f)), `${host}:${stageDe("guarda")}/skills/whatsapp-grupos/scripts/`], 60_000);
  if (scp4.code !== 0) say(`aviso: a skill whatsapp-grupos não foi enviada (${lastLine(scp4.stderr)}); a guarda segue`);
  say("rodando o instalador…");
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${stageDe("guarda")}/install-guarda.sh 2>&1`], 4 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}
/**
 * Instala a tela do bot (painel Computador): manda install-tela.sh e tela/ e roda o instalador (pacotes por sudo sem
 * senha, serviço de usuário sem iniciar). `codigo` 3 = faltam pacotes e não há sudo: quem resolve é o admin.
 */
export async function installTela(host: string, onLine?: (line: string) => void): Promise<{ ok: boolean; codigo: number | null; log: string[] }> {
  if (host === LOCAL_HOST) return { ok: false, codigo: null, log: ["a tela do bot mora numa máquina por SSH"] };
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const dir = backendBundleDir();
  say(`enviando a tela para ${host}:${stageDe("tela")}…`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `${limparStage("tela")}; mkdir -p ${stageDe("tela")}/tela/skill`], 20_000);
  if (mk.code !== 0) return { ok: false, codigo: mk.code, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp1 = await run("scp", ["-q", ...sshBase(host), "--", ...TELA_FILES.map((f) => path.join(dir, f)), `${host}:${stageDe("tela")}/`], 60_000);
  const scp2 = scp1.code !== 0 ? scp1 : await run("scp", ["-q", ...sshBase(host), "--", ...TELA_PLUGIN_FILES.map((f) => path.join(dir, "tela", f)), `${host}:${stageDe("tela")}/tela/`], 60_000);
  const scp3 = scp2.code !== 0 ? scp2 : await run("scp", ["-q", ...sshBase(host), "--", ...TELA_SKILL_FILES.map((f) => path.join(dir, "tela", "skill", f)), `${host}:${stageDe("tela")}/tela/skill/`], 60_000);
  if (scp3.code !== 0) return { ok: false, codigo: scp3.code, log: [...lines, `scp falhou: ${lastLine(scp3.stderr)}`] };
  say("rodando o instalador…");
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${stageDe("tela")}/install-tela.sh 2>&1`], 10 * 60_000, say);
  return { ok: inst.code === 0, codigo: inst.code, log: lines };
}
/** "Refazer do zero" do tutorial da guarda: tira o plugin do OpenClaw e apaga a cópia. */
export async function uninstallGuarda(host: string): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: true, log: ["nada a desfazer neste Mac"] };
  const dir = backendBundleDir();
  // A subpasta pode não existir numa máquina que ainda tem o jeito antigo (tudo solto).
  const mk = await run("ssh", [...sshBase(host), "--", host, `mkdir -p ${stageDe("guarda")}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [`falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", ...sshBase(host), "--", path.join(dir, "uninstall-guarda.sh"), `${host}:${stageDe("guarda")}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [`scp falhou: ${lastLine(scp.stderr)}`] };
  const r = await run("ssh", [...sshBase(host), "--", host, `bash ${stageDe("guarda")}/uninstall-guarda.sh 2>&1`], 2 * 60_000);
  if (r.code !== 0) return { ok: false, log: [lastLine(r.stdout) || lastLine(r.stderr) || `código ${r.code ?? "timeout"}`] };
  return { ok: true, log: r.stdout.trim().split("\n") };
}

/** "Refazer do zero" da status line: desfaz o install-statusline.sh na máquina (ou neste Mac). */
export async function uninstallStatusLine(host: string): Promise<InstallBackendResult> {
  const dir = backendBundleDir();
  if (host === LOCAL_HOST) {
    const r = await run("bash", [path.join(dir, "uninstall-statusline.sh")], 60_000);
    return r.code === 0 ? { ok: true, log: r.stdout.trim().split("\n") } : { ok: false, log: [lastLine(r.stderr) || `saiu com código ${r.code ?? "timeout"}`] };
  }
  // A subpasta pode não existir numa máquina que ainda tem o jeito antigo (tudo solto).
  const mk = await run("ssh", [...sshBase(host), "--", host, `mkdir -p ${stageDe("statusline")}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [`falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", ...sshBase(host), "--", path.join(dir, "uninstall-statusline.sh"), `${host}:${stageDe("statusline")}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [`scp falhou: ${lastLine(scp.stderr)}`] };
  const r = await run("ssh", [...sshBase(host), "--", host, `bash ${stageDe("statusline")}/uninstall-statusline.sh 2>&1`], 60_000);
  return r.code === 0 ? { ok: true, log: r.stdout.trim().split("\n") } : { ok: false, log: [lastLine(r.stdout) || `saiu com código ${r.code ?? "timeout"}`] };
}

/** Instala a status line do Claude Code no host (ou neste Mac): manda os dois arquivos e roda o instalador. */
export async function installStatusLine(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const dir = backendBundleDir();
  if (host === LOCAL_HOST) {
    say("instalando a status line neste Mac…");
    const r = await run("bash", [path.join(dir, "install-statusline.sh")], 60_000, say);
    if (r.code !== 0) return { ok: false, log: [...lines, lastLine(r.stderr) || `instalador saiu com código ${r.code ?? "timeout"}`] };
    return { ok: true, log: lines };
  }
  say(`enviando ${STATUSLINE_FILES.length} arquivos para ${host}:${stageDe("statusline")}…`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `${limparStage("statusline")}; mkdir -p ${stageDe("statusline")}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", ...sshBase(host), "--", ...STATUSLINE_FILES.map((f) => path.join(dir, f)), `${host}:${stageDe("statusline")}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp.stderr)}`] };
  say("rodando o instalador…");
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${stageDe("statusline")}/install-statusline.sh 2>&1`], 2 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}
