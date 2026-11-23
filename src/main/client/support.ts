/**
 * Variante: cliente. Suporte, lado da pessoa (meu-bot normal com o pacote de suporte no .dmg: `scripts/dmg.mjs --suporte`).
 * "Permitir suporte" põe a chave pública do admin no authorized_keys da máquina dela e instala lá um timer
 * que entrega o código de suporte na caixa de entrada do admin a cada 30 min (máquina com máquina, por SSH,
 * com a chave só de entrega). Desligar tira a chave, entrega "desligado" e remove o timer. Tudo que o
 * suporte faz na máquina fica em ~/.local/share/meu-bot/suporte.log, que a pessoa vê nas Configurações.
 */
import { checkNow as netCheckNow } from "../app/net";
import { offlineMessage } from "../app/net-core";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { SupportInfo, SupportShare } from "../../shared/ipc";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";
import { log } from "../maquina/backend";
import { ADMIN_KEY_LINE_RE, DEFAULT_SHARE, SHARE_FILE, SUPPORT_BLOCK_FILE, SUPPORT_DIR, authorizedKeysScript, removeDeliverySh, encodeSupportCode, machineId, parseSupportProgress, parseSupportShare, publicKeyBody, type SupportAdmin, type SupportCode } from "../suporte/support-code";
import { entregar, lerRegistro, registroSh } from "../auditoria/auditoria";
import { textoDaLinha } from "../auditoria/auditoria-core";
import { runSsh } from "../whatsapp/whatsapp";

/** O que o .dmg da pessoa leva (Resources/config): os admins (nome + pública de cada um) e onde fica a caixa. */
interface SupportBundle {
  admins: SupportAdmin[];
  inbox: { hostname: string; user: string; port: number; hostKey: string };
  /** Chave só de entrega (privada) e o known_hosts da caixa. */
  keyPath: string;
  knownHostsPath: string;
}

const configDir = (): string => (app.isPackaged ? path.join(process.resourcesPath, "config") : path.join(app.getAppPath(), "build", "suporte"));

/** O pacote de suporte deste app; null = .dmg sem suporte (a seção não aparece). */
export function supportBundle(): SupportBundle | null {
  const dir = configDir();
  const keyPath = path.join(dir, app.isPackaged ? "suporte-entrega" : "entrega");
  const knownHostsPath = path.join(dir, app.isPackaged ? "suporte-known_hosts" : "known_hosts");
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "suporte.json"), "utf8")) as Partial<SupportBundle> & { admin?: unknown; adminKey?: unknown };
    const inbox = raw.inbox;
    // Pacote antigo (um admin só: admin + adminKey) continua valendo como uma lista de um.
    const lista = Array.isArray(raw.admins) ? raw.admins : typeof raw.admin === "string" && typeof raw.adminKey === "string" ? [{ nome: raw.admin, chave: raw.adminKey }] : [];
    const admins = lista.filter((a): a is SupportAdmin => typeof a?.nome === "string" && typeof a.chave === "string" && publicKeyBody(a.chave) !== null).map((a) => ({ nome: a.nome.slice(0, 40), chave: a.chave }));
    if (admins.length === 0) return null;
    if (inbox === undefined || typeof inbox.hostname !== "string" || typeof inbox.user !== "string" || typeof inbox.port !== "number" || typeof inbox.hostKey !== "string") return null;
    if (!fs.existsSync(keyPath) || !fs.existsSync(knownHostsPath)) return null;
    return { admins, inbox, keyPath, knownHostsPath };
  } catch {
    return null;
  }
}

/**
 * ssh para a central de auditoria com a chave de entrega (lá presa a um comando forçado que só grava); null num
 * meu-bot sem suporte.
 */
export function clienteAuditoriaSsh(): string[] | null {
  const b = supportBundle();
  if (b === null) return null;
  return ["-i", chaveEntrega(b), "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20",
    "-o", "HostKeyAlias=meu-bot-caixa", "-o", `UserKnownHostsFile=${b.knownHostsPath}`, "-o", "StrictHostKeyChecking=yes",
    "-p", String(b.inbox.port), `auditoria@${b.inbox.hostname}`];
}

/** A chave de entrega numa cópia 0600 no userData (a do pacote pode estar legível por outros, e o ssh recusa). */
function chaveEntrega(b: SupportBundle): string {
  const tmp = path.join(app.getPath("userData"), "suporte-entrega");
  fs.writeFileSync(tmp, `${fs.readFileSync(b.keyPath, "utf8").trim()}\n`, { mode: 0o600 });
  return tmp;
}

/** Sugestão de nome quando ela ainda não disse (git user.name ou o nome do usuário do Mac): salvar liga com um clique. */
let suggested: string | null = null;
export function suggestedName(): string {
  if (suggested !== null) return suggested;
  const tryCmd = (cmd: string, args: string[]): string => { try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 3000 }).trim(); } catch { return ""; } };
  const git = tryCmd("git", ["config", "--global", "user.name"]);
  const full = git !== "" ? git : tryCmd("id", ["-F"]);
  suggested = full.replace(/\s+/g, " ").trim().slice(0, 40);
  return suggested;
}

/** Nome que a pessoa deu para si (aparece para o admin); fica no userData deste Mac. */
const namePath = (): string => path.join(app.getPath("userData"), "suporte.json");
export function supportName(): string {
  try { const v = JSON.parse(fs.readFileSync(namePath(), "utf8")) as { name?: unknown }; if (typeof v.name === "string") return v.name; } catch { /* ainda não deu nome */ }
  return "";
}
/** "Refazer do zero" do tutorial de suporte: desliga (se ligado) e esquece o nome guardado neste Mac. */
export async function resetSupport(host: string): Promise<SupportInfo> {
  const cur = await supportInfo(host).catch(() => null);
  if (cur?.on === true) await setSupport(host, false, cur.name);
  try { fs.unlinkSync(namePath()); } catch { /* já não havia */ }
  return supportInfo(host);
}
function saveSupportName(name: string): void {
  try { fs.writeFileSync(namePath(), JSON.stringify({ name }), { mode: 0o600 }); } catch { /* cortesia */ }
}

const D = SUPPORT_DIR;

/** Como o Mac dela chega na máquina (o que o ssh dela resolve para o alias), para o admin chegar igual. */
function resolveSsh(host: string): Promise<{ hostname: string; user: string; port: number }> {
  return new Promise((resolve, reject) => {
    execFile("ssh", ["-G", "--", host], { timeout: 10_000, windowsHide: true }, (err, stdout) => {
      if (err) { reject(new Error(`não consegui ler o endereço de ${host}`)); return; }
      const kv = new Map(stdout.split(/\r?\n/).map((l) => { const i = l.indexOf(" "); return [l.slice(0, i), l.slice(i + 1).trim()] as const; }));
      // Endereço local (VM do Colima, por exemplo) vale: só um admin neste mesmo Mac a alcança, e o admin
      // vê isso ao lado do endereço. Serve para testar o suporte sem outra máquina.
      const hostname = kv.get("hostname") ?? "";
      resolve({ hostname, user: kv.get("user") ?? "", port: Number(kv.get("port") ?? "22") });
    });
  });
}

async function buildCode(host: string, name: string, state: "on" | "off"): Promise<{ id: string; code: SupportCode; text: string }> {
  const addr = await resolveSsh(host);
  const r = await runSsh(host, "cat /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null || cat /etc/ssh/ssh_host_ecdsa_key.pub\n", 20_000);
  const hostKey = r.stdout.trim().split(" ").slice(0, 2).join(" ");
  if (r.code !== 0 || hostKey === "") throw new Error("não consegui ler a chave do servidor desta máquina");
  // `machine` é o apelido dela para a máquina (o host desta janela): o admin mostra "colima", não o alias dele.
  const code: SupportCode = { v: 1, name, hostname: addr.hostname, user: addr.user, port: addr.port, hostKey, state, at: new Date().toISOString(), machine: host };
  return { id: machineId(code), code, text: encodeSupportCode(code) };
}

/** Script remoto: grava chave de entrega, known_hosts, código e o entregador; liga o timer; entrega já. */
function installDeliverySh(b: SupportBundle, id: string, codeText: string): string {
  const key = fs.readFileSync(b.keyPath, "utf8").trim();
  const kh = fs.readFileSync(b.knownHostsPath, "utf8").trim();
  return `set -e
umask 077
mkdir -p "${D}"
cat > "${D}/entrega" <<'MEUBOT_KEY'
${key}
MEUBOT_KEY
chmod 600 "${D}/entrega"
printf '%s\\n' '${kh}' > "${D}/known_hosts"
printf '%s\\n%s\\n' '${id}' '${codeText}' > "${D}/codigo"
cat > "${D}/entregar.sh" <<'MEUBOT_SH'
#!/bin/sh
# Entrega o código de suporte na caixa de entrada do admin (só isso: a chave não abre terminal lá). Deu certo:
# grava a hora em ultima-entrega (o tutorial "Ligar o suporte" se marca por ela).
D="$HOME/.local/share/meu-bot/suporte"
ssh -i "$D/entrega" -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o ConnectTimeout=20 -o HostKeyAlias=meu-bot-caixa -o UserKnownHostsFile="$D/known_hosts" -o StrictHostKeyChecking=yes -p ${b.inbox.port} ${b.inbox.user}@${b.inbox.hostname} < "$D/codigo" || exit 1
date -u +%Y-%m-%dT%H:%M:%SZ > "$D/ultima-entrega"
MEUBOT_SH
chmod 700 "${D}/entregar.sh"
if systemctl --user show-environment >/dev/null 2>&1; then
  U="$HOME/.config/systemd/user"; mkdir -p "$U"
  printf '[Unit]\\nDescription=meu-bot: avisa o suporte que esta máquina está no ar\\n[Service]\\nType=oneshot\\nExecStart=%%h/.local/share/meu-bot/suporte/entregar.sh\\n' > "$U/meu-bot-suporte.service"
  printf '[Unit]\\nDescription=meu-bot: aviso ao suporte a cada 30 min\\n[Timer]\\nOnBootSec=2min\\nOnUnitActiveSec=30min\\n[Install]\\nWantedBy=timers.target\\n' > "$U/meu-bot-suporte.timer"
  { systemctl --user daemon-reload && systemctl --user enable --now meu-bot-suporte.timer; } >/dev/null 2>&1 || echo TIMER=0
else
  ( crontab -l 2>/dev/null | grep -v meu-bot-suporte; echo "*/30 * * * * \\$HOME/.local/share/meu-bot/suporte/entregar.sh >/dev/null 2>&1 # meu-bot-suporte" ) | crontab - || echo TIMER=0
fi
"${D}/entregar.sh" >/dev/null 2>&1 && echo ENTREGUE=1 || echo ENTREGUE=0
`;
}

/** Suporte ligado por máquina (da última consulta): o progresso só é gravado com o suporte ligado. */
const supportOn = new Map<string, boolean>();
/** O que ela compartilha, por máquina (da última consulta): o progresso só é gravado se ela deixa. */
const shareOf = new Map<string, SupportShare>();
const PROGRESS = "$HOME/.local/share/meu-bot/progresso.json";
const lastProgress = new Map<string, string>();

/**
 * Grava na máquina o progresso da pessoa nos tutoriais (para o admin ver onde ela trava). Só com o suporte
 * ligado: foi o que ela autorizou. Sem mudança desde a última gravação, não faz nada.
 */
export async function reportSupportProgress(host: string, raw: unknown): Promise<void> {
  if (supportBundle() === null || host === LOCAL_HOST || !isValidHost(host)) return;
  const p = parseSupportProgress(raw);
  if (p === null) return;
  const body = JSON.stringify(p);
  if (lastProgress.get(host) === JSON.stringify({ ...p, at: "" })) return;
  if (!supportOn.has(host)) await supportInfo(host).catch(() => undefined);
  if (supportOn.get(host) !== true || shareOf.get(host)?.progress === false) return;
  const b64 = Buffer.from(body, "utf8").toString("base64");
  const r = await runSsh(host, `mkdir -p "$HOME/.local/share/meu-bot" && printf '%s' '${b64}' | base64 -d > "${PROGRESS}.tmp" && mv "${PROGRESS}.tmp" "${PROGRESS}"\n`, 20_000);
  if (r.code === 0) lastProgress.set(host, JSON.stringify({ ...p, at: "" }));
}

/** Estado do suporte na máquina desta janela: chave do admin presente + últimas linhas do registro. */
export async function supportInfo(host: string): Promise<SupportInfo> {
  const b = supportBundle();
  if (b === null || host === LOCAL_HOST || !isValidHost(host)) return { available: false, admin: "", on: false, name: supportName(), suggestedName: suggestedName(), log: [], deliveredAt: null, share: DEFAULT_SHARE, blockedByAdmin: false, staleId: false };
  const r = await runSsh(host, `grep -Eq '${ADMIN_KEY_LINE_RE}' "$HOME/.ssh/authorized_keys" 2>/dev/null && echo ON=1 || echo ON=0\necho "E=$(cat "${D}/ultima-entrega" 2>/dev/null)"\necho "S=$(cat "${SHARE_FILE}" 2>/dev/null | tr -d '\\n')"\necho "B=$([ -f "${SUPPORT_BLOCK_FILE}" ] && echo 1 || echo 0)"\necho "I=$(head -n 1 "${D}/codigo" 2>/dev/null)"\necho "K=$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null || cut -d' ' -f1,2 /etc/ssh/ssh_host_ecdsa_key.pub 2>/dev/null)"\n`, 20_000);
  if (r.code !== 0) throw new Error("não consegui ler o estado do suporte nesta máquina");
  const lines = r.stdout.split("\n");
  // Registro de auditoria da máquina: as 50 últimas linhas, a mais nova primeiro (a tela filtra o que é do admin).
  const entries = (await lerRegistro(host, 50).catch(() => [])).map((l) => ({ at: l.em, who: l.quem.tipo === "admin" || l.quem.tipo === "legado" ? l.quem.nome : `${l.quem.nome || l.quem.tipo} (${l.quem.tipo})`, what: textoDaLinha(l), tipo: l.quem.tipo })).reverse();
  supportOn.set(host, lines.includes("ON=1"));
  const e = (lines.find((l) => l.startsWith("E=")) ?? "E=").slice(2).trim();
  const deliveredAt = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(e) ? e : null;
  let share = DEFAULT_SHARE;
  try { share = parseSupportShare(JSON.parse((lines.find((l) => l.startsWith("S=")) ?? "S=").slice(2))); } catch { /* sem escolha gravada: tudo compartilhado */ }
  shareOf.set(host, share);
  // O código gravado na máquina ainda tem o id antigo (só a chave)? Então o app regrava (ligar de novo), senão duas
  // contas na mesma máquina continuam se sobrescrevendo na caixa do admin.
  const storedId = (lines.find((l) => l.startsWith("I=")) ?? "I=").slice(2).trim();
  const hostKey = (lines.find((l) => l.startsWith("K=")) ?? "K=").slice(2).trim();
  let staleId = false;
  if (storedId !== "" && hostKey !== "") { try { const addr = await resolveSsh(host); staleId = storedId !== machineId({ hostKey, user: addr.user, port: addr.port }); } catch { staleId = false; } }
  return { available: true, admin: b.admins.map((a) => a.nome).join(", "), on: lines.includes("ON=1"), name: supportName(), suggestedName: suggestedName(), log: entries, deliveredAt, share, blockedByAdmin: lines.includes("B=1"), staleId };
}

/** Liga/desliga o suporte nesta máquina. Ligar exige o nome da pessoa (o admin vê esse nome). */
export async function setSupport(host: string, on: boolean, name: string): Promise<SupportInfo> {
  const b = supportBundle();
  if (b === null) throw new Error("este meu-bot não veio com suporte");
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("o suporte vale para máquinas por SSH, não para este Mac");
  const who = name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (on && who === "") throw new Error("diga seu nome para o suporte saber quem é");
  if (who !== "") saveSupportName(who);
  const built = await buildCode(host, who || "pessoa", on ? "on" : "off");
  const script = on
    ? `rm -f "${SUPPORT_BLOCK_FILE}"\n${authorizedKeysScript(b.admins)}\n${registroSh("suporte.ligar")}\n${installDeliverySh(b, built.id, built.text)}`
    : `${authorizedKeysScript([])}\n${registroSh("suporte.desligar")}\n${removeDeliverySh(built.id, built.text)}\nrm -f "${PROGRESS}"`;
  lastProgress.delete(host);
  const r = await runSsh(host, script, 60_000);
  if (r.code !== 0) throw new Error(`não consegui ${on ? "ligar" : "desligar"} o suporte: ${(r.stderr.trim() || r.stdout.trim()).split("\n").pop() ?? "ssh falhou"}`);
  // Se a máquina dela não alcança a caixa (saída bloqueada), o Mac entrega no lugar dela.
  if (!r.stdout.includes("ENTREGUE=1")) await deliverFromMacAndMark(host, b, built.id, built.text, on);
  log(`[suporte] ${host}: ${on ? "ligado" : "desligado"} (${who})`);
  void entregar(host);
  return supportInfo(host);
}

/** Entrega pelo Mac e, ligado, marca a entrega na máquina (para o tutorial ver que chegou). */
async function deliverFromMacAndMark(host: string, b: SupportBundle, id: string, codeText: string, on: boolean): Promise<boolean> {
  try {
    await deliverFromMac(b, id, codeText);
    if (on) await runSsh(host, `mkdir -p "${D}" && date -u +%Y-%m-%dT%H:%M:%SZ > "${D}/ultima-entrega"\n`, 15_000);
    return true;
  } catch (e) {
    log(`[suporte] entrega pelo Mac falhou: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** Salva só o nome (passo 1 do tutorial "Ligar o suporte"). */
export function setSupportNameOnly(host: string, name: string): Promise<SupportInfo> {
  const who = name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (who === "") throw new Error("escreva seu nome");
  saveSupportName(who);
  return supportInfo(host);
}

/** O que o app do admin pode ver: grava a escolha na máquina; tirar o progresso apaga o que já estava lá. */
export async function setSupportShare(host: string, raw: unknown): Promise<SupportInfo> {
  if (supportBundle() === null) throw new Error("este meu-bot não veio com suporte");
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("o suporte vale para máquinas por SSH, não para este Mac");
  const share = parseSupportShare(raw);
  const b64 = Buffer.from(JSON.stringify(share), "utf8").toString("base64");
  const r = await runSsh(host, `mkdir -p "$HOME/.local/share/meu-bot" && printf '%s' '${b64}' | base64 -d > "${SHARE_FILE}.tmp" && mv "${SHARE_FILE}.tmp" "${SHARE_FILE}"${share.progress ? "" : ` && rm -f "${PROGRESS}"`}\n`, 20_000);
  if (r.code !== 0) throw new Error("não consegui gravar a escolha nesta máquina");
  shareOf.set(host, share);
  if (!share.progress) lastProgress.delete(host);
  log(`[suporte] ${host}: compartilha progresso=${share.progress} whatsapp=${share.whatsapp} registros=${share.logs} backup=${share.backup}`);
  return supportInfo(host);
}

/** "Tentar de novo": entrega o aviso agora, pela máquina; se ela não alcança a caixa, pelo Mac. */
export async function deliverNow(host: string): Promise<SupportInfo> {
  const b = supportBundle();
  if (b === null) throw new Error("este meu-bot não veio com suporte");
  const r = await runSsh(host, `[ -x "${D}/entregar.sh" ] && "${D}/entregar.sh" >/dev/null 2>&1 && echo ENTREGUE=1 || echo ENTREGUE=0\n`, 60_000);
  if (!r.stdout.includes("ENTREGUE=1")) {
    const built = await buildCode(host, supportName() || "pessoa", "on");
    if (!(await deliverFromMacAndMark(host, b, built.id, built.text, true))) throw new Error((await netCheckNow()).online === false ? offlineMessage("support") : "não consegui avisar o admin: nem a máquina nem este Mac alcançaram a caixa de entrada dele");
  }
  return supportInfo(host);
}

/** Código para copiar (plano B: mandar pelo WhatsApp). */
export async function supportCodeText(host: string): Promise<string> {
  const name = supportName();
  if (name === "") throw new Error("ligue o suporte antes (é lá que vai o seu nome)");
  return (await buildCode(host, name, "on")).text;
}

/** Entrega pelo próprio Mac (quando a máquina dela não consegue sair por SSH). A chave vai num arquivo 600. */
function deliverFromMac(b: SupportBundle, id: string, codeText: string): Promise<void> {
  const tmp = chaveEntrega(b);
  return new Promise((resolve, reject) => {
    const child = execFile("ssh", ["-i", tmp, "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20",
      "-o", "HostKeyAlias=meu-bot-caixa", "-o", `UserKnownHostsFile=${b.knownHostsPath}`, "-o", "StrictHostKeyChecking=yes",
      "-p", String(b.inbox.port), `${b.inbox.user}@${b.inbox.hostname}`], { timeout: 30_000, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
    child.stdin?.on("error", () => { /* o ssh saiu antes de ler (EPIPE); o callback diz o erro */ });
    child.stdin?.end(`${id}\n${codeText}\n`);
  });
}
