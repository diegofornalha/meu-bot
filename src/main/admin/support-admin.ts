/**
 * Variante: admin. Suporte, lado do admin (meu-bot-admin). Sem servidor: as pessoas aparecem pela caixa de entrada na máquina
 * do admin (entregue máquina com máquina) ou colando o código. Cada pessoa vira um `Host suporte-…` num
 * arquivo só do suporte (~/.ssh/meu-bot-suporte.conf, incluído no topo do ~/.ssh/config) com known_hosts
 * próprio: o admin entra pela chave ~/.ssh/meu-bot-admin, que só funciona enquanto a pessoa deixar.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { AdminAction, AdminHealth, BotChat, BotMessage, LicensePatch, LicenseView, Pagamento, SupportPerson, SupportProgress, SupportShare, PlanName } from "../../shared/ipc";
import { applyLicensePatch, parseLicense, parsePagamento } from "../licenca/licenca";
import { LICENSE_PATH, MACHINES_PATH, readLicenseViewSsh as readLicenseView } from "../licenca/licenca-maquina";
import { BACKEND_DIR_SH } from "../maquina/backend-dir-core";
import { WA_ESCOLHA_SH } from "../whatsapp/whatsapp-capacidades";
import { HERMES_RESTART_SH } from "../whatsapp/whatsapp-hermes-core";
import { APP_CONVERSAS_DIR, APP_CONV_ID_RE, PROJECT_DIR_RE, SESSION_ID_RE, isBotChatId, parseAppTranscript, parseBotChatList, parseClaudeTranscript } from "../conversa/bot-chats";
import { anotarApagadaSh } from "../conversa/apagadas-core";
import { SHARE_FILE, SUPPORT_BLOCK_FILE, adminSshBlock, adoptScript, authorizedKeysScript, decodeSupportCode, knownHostsLine, legacyMachineId, machineId, parseAdoptHostKey, parseSshAddTarget, parseSshG, parseSupportProgress, parseSupportShare, removeDeliverySh, supportAlias, type SupportCode } from "../suporte/support-code";
import { entregar, registrar, registroSh } from "../auditoria/auditoria";
import type { Acao } from "../auditoria/auditoria-core";
import { runSsh, whatsappChats, whatsappClearSessions, whatsappStatus } from "../whatsapp/whatsapp";
import { apelidoSh, apelidoLimpo } from "./usuarios-core";
import { installAudio, installBackend, installClaudeCode, probeHost } from "../maquina/hostProbe";
import { portaParaInstalar } from "../maquina/porta-backend-core";
import { claudeAuthStatus } from "../agente/claudeLogin";
import { closeTunnel } from "../maquina/tunnel";
import { broadcast } from "../app/windows";
import { xaiAuthInfo } from "../agente/xaiLogin";
import { getBackendPort, isValidHost, setBackendPortForHost, settingsView } from "../app/settings";
import { log } from "../maquina/backend";

/** `superAdmin`: este app lê a central de auditoria (página Auditoria). `backupDestinatario`: chave age pública do super admin (backups). */
/** `pagamentoPadrao`: orientação de pagamento (Pix, link) gravada em toda licença que ainda não tem uma, ao mexer nela. */
interface AdminConfig { admin: string; superAdmin: boolean; backupDestinatario: string; inbox: { alias: string }; pagamentoPadrao: Pagamento | null }
interface Stored { code: SupportCode; seenAt: string; source: "caixa" | "colado"; archived: boolean; /** Apelido que o admin deu (vence o nome do código; vazio = nenhum). */ nickname: string; /** Último plano visto da conta (cache para o selo do seletor, sem SSH); ausente = desconhecido. */ plan?: PlanName; /** Entrou por "ssh <host>" (conta do admin, sem o meu-bot dela): o admin prepara Claude Code, login e backend. */ adotada?: true; /** Usuário de login criado/visto na aba "Usuários" da máquina com este id (a raiz): só aparece, ninguém o prepara. */ usuarioDe?: string }

const configPath = (): string => (app.isPackaged ? path.join(process.resourcesPath, "config", "suporte.json") : path.join(app.getAppPath(), "build", "suporte", "suporte.json"));
function adminConfig(): AdminConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8")) as { admin?: unknown; superAdmin?: unknown; backupDestinatario?: unknown; inbox?: { alias?: unknown }; pagamentoPadrao?: unknown };
    const alias = raw.inbox?.alias;
    const dest = typeof raw.backupDestinatario === "string" && /^age1[0-9a-z]{58}$/.test(raw.backupDestinatario) ? raw.backupDestinatario : "";
    return { admin: typeof raw.admin === "string" ? raw.admin : "suporte", superAdmin: raw.superAdmin === true, backupDestinatario: dest, inbox: { alias: typeof alias === "string" && isValidHost(alias) ? alias : "" }, pagamentoPadrao: parsePagamento(raw.pagamentoPadrao) };
  } catch {
    return { admin: "suporte", superAdmin: false, backupDestinatario: "", inbox: { alias: "" }, pagamentoPadrao: null };
  }
}
export const adminName = (): string => adminConfig().admin;
export const isSuperAdmin = (): boolean => adminConfig().superAdmin;
export const backupDestinatario = (): string => adminConfig().backupDestinatario;
/**
 * ssh para a central de auditoria (usuário "auditoria" na caixa, pelo alias do admin): a chave deste admin, que
 * lá é presa a um comando forçado. null sem caixa configurada.
 */
export function adminAuditoriaSsh(): string[] | null {
  const alias = adminConfig().inbox.alias;
  if (alias === "" || !fs.existsSync(ADMIN_KEY)) return null;
  return ["-i", ADMIN_KEY, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-l", "auditoria", alias];
}

const storePath = (): string => path.join(app.getPath("userData"), "pessoas.json");
/** Pessoas conhecidas por id da máquina (o mesmo id do registro de auditoria): nome, alias e se o suporte está ligado. */
export function pessoasPorMaquina(): Map<string, { nome: string; alias: string; on: boolean }> {
  return new Map([...load()].map(([id, s]) => [id, { nome: s.nickname || s.code.name, alias: supportAlias(s.code), on: s.code.state === "on" }]));
}
function load(): Map<string, Stored> {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8")) as Record<string, { code?: unknown; seenAt?: unknown; source?: unknown; archived?: unknown; nickname?: unknown; plan?: unknown; adotada?: unknown; usuarioDe?: unknown }>;
    const m = new Map<string, Stored>();
    for (const [id, v] of Object.entries(raw)) {
      const d = typeof v.code === "string" ? decodeSupportCode(v.code) : null;
      if (d?.ok !== true || !/^[0-9a-f]{12}$/.test(id)) continue;
      // Entradas gravadas com o id antigo (só a chave) passam para o id novo (chave + usuário + porta).
      const key = machineId(d.code);
      const prev = m.get(key);
      if (prev !== undefined && prev.seenAt >= (typeof v.seenAt === "string" ? v.seenAt : "")) continue;
      m.set(key, { code: d.code, seenAt: typeof v.seenAt === "string" ? v.seenAt : "", source: v.source === "colado" ? "colado" : "caixa", archived: v.archived === true, nickname: typeof v.nickname === "string" ? v.nickname.slice(0, 40) : "", ...(v.plan === "pro" || v.plan === "free" ? { plan: v.plan } : {}), ...(v.adotada === true ? { adotada: true as const } : {}), ...(typeof v.usuarioDe === "string" && /^[0-9a-f]{12}$/.test(v.usuarioDe) ? { usuarioDe: v.usuarioDe } : {}) });
    }
    return m;
  } catch {
    return new Map();
  }
}
function save(m: Map<string, Stored>): void {
  const out: Record<string, { code: string; seenAt: string; source: string; archived: boolean; nickname: string; plan?: PlanName; adotada?: true; usuarioDe?: string }> = {};
  for (const [id, s] of m) out[id] = { code: encode(s.code), seenAt: s.seenAt, source: s.source, archived: s.archived, nickname: s.nickname, ...(s.plan === undefined ? {} : { plan: s.plan }), ...(s.adotada === true ? { adotada: true as const } : {}), ...(s.usuarioDe === undefined ? {} : { usuarioDe: s.usuarioDe }) };
  fs.writeFileSync(storePath(), JSON.stringify(out, null, 2), { mode: 0o600 });
}
const encode = (c: SupportCode): string => `MBS1.${Buffer.from(JSON.stringify(c), "utf8").toString("base64url")}`;

const SSH_DIR = path.join(os.homedir(), ".ssh");
const SUPPORT_CONF = path.join(SSH_DIR, "meu-bot-suporte.conf");
const SUPPORT_KNOWN = path.join(SSH_DIR, "meu-bot-suporte_known_hosts");
const ADMIN_KEY = path.join(SSH_DIR, "meu-bot-admin");
const INCLUDE = "Include ~/.ssh/meu-bot-suporte.conf";

/**
 * Regrava o arquivo do suporte e o known_hosts dele a partir das pessoas com suporte ligado, e garante o
 * Include no topo do ~/.ssh/config (antes de qualquer Host, senão vale só dentro do bloco anterior).
 */
function writeSshFiles(m: Map<string, Stored>): void {
  // Sem ninguém conhecido e sem caixa de entrada configurada (um admin ainda não preparado, ou um dev de teste com
  // userData novo), não há o que escrever: apagar o conf de um admin de verdade neste mesmo Mac derrubaria as pessoas dele.
  if (m.size === 0 && adminConfig().inbox.alias === "") return;
  fs.mkdirSync(SSH_DIR, { recursive: true, mode: 0o700 });
  const on = [...m.values()].filter((s) => s.code.state === "on");
  const blocks = on.map((s) => adminSshBlock(s.code, "~/.ssh/meu-bot-admin").replace(/\n$/, `\n    UserKnownHostsFile ~/.ssh/meu-bot-suporte_known_hosts\n    StrictHostKeyChecking yes\n`));
  fs.writeFileSync(SUPPORT_CONF, `# Gerado pelo meu-bot-admin: pessoas com suporte ligado. Não edite à mão.\n\n${blocks.join("\n")}`, { mode: 0o600 });
  fs.writeFileSync(SUPPORT_KNOWN, on.map((s) => knownHostsLine(s.code)).join("\n") + (on.length > 0 ? "\n" : ""), { mode: 0o600 });
  const cfg = path.join(SSH_DIR, "config");
  let cur = "";
  try { cur = fs.readFileSync(cfg, "utf8"); } catch { /* sem config ainda */ }
  if (!cur.split("\n").some((l) => l.trim() === INCLUDE)) {
    if (cur !== "") fs.copyFileSync(cfg, `${cfg}.antes-do-meu-bot-admin`);
    fs.writeFileSync(cfg, `${INCLUDE}\n\n${cur}`, { mode: 0o600 });
  }
}

/** Lê a caixa de entrada (na máquina do admin): os códigos válidos, por id. Quem junta ao salvo é `juntarCaixa`. */
async function pullInbox(): Promise<{ lidos: { key: string; code: SupportCode; seenAt: string }[]; warning: string | null }> {
  const lidos: { key: string; code: SupportCode; seenAt: string }[] = [];
  const alias = adminConfig().inbox.alias;
  if (alias === "") return { lidos, warning: "sem caixa de entrada configurada (rode scripts/suporte-setup.mjs e reempacote o admin)" };
  const r = await runSsh(alias, `for f in "$HOME"/suporte-inbox/*.code; do [ -f "$f" ] || continue; printf 'F\\t%s\\t%s\\t' "$(basename "$f" .code)" "$(stat -c %Y "$f")"; head -c 4096 "$f" | tr -d '\\n'; echo; done\n`, 20_000);
  if (r.code !== 0) return { lidos, warning: `não consegui ler a caixa de entrada em ${alias}` };
  for (const line of r.stdout.split("\n")) {
    const [tag, id, mtime, text] = line.split("\t");
    if (tag !== "F" || id === undefined || text === undefined || !/^[0-9a-f]{12}$/.test(id)) continue;
    const d = decodeSupportCode(text);
    // O id do arquivo tem de bater com o código: o novo (chave + usuário + porta) ou o antigo (só a chave, de meu-bots
    // que ainda não regravaram); guarda sempre sob o novo.
    if (!d.ok || (machineId(d.code) !== id && legacyMachineId(d.code.hostKey) !== id)) continue;
    lidos.push({ key: machineId(d.code), code: d.code, seenAt: new Date(Number(mtime) * 1000).toISOString() });
  }
  return { lidos, warning: null };
}
/** Junta o que a caixa trouxe ao salvo: aviso mais novo vence; o arquivamento, o apelido e a marca de usuário ficam. */
function juntarCaixa(m: Map<string, Stored>, lidos: { key: string; code: SupportCode; seenAt: string }[]): void {
  for (const { key, code, seenAt } of lidos) {
    const prev = m.get(key);
    if (prev === undefined || seenAt >= prev.seenAt) m.set(key, { code, seenAt, source: "caixa", archived: prev?.archived === true, nickname: prev?.nickname ?? "", ...(prev?.usuarioDe === undefined ? {} : { usuarioDe: prev.usuarioDe }) });
  }
}

const isLocalAddr = (h: string): boolean => /^(localhost|127\.|::1$)/.test(h);
const toPerson = (s: Stored): SupportPerson => ({ alias: supportAlias(s.code), name: s.nickname !== "" ? s.nickname : s.code.name, machine: s.code.machine ?? null, hostname: s.code.hostname, port: s.code.port, local: isLocalAddr(s.code.hostname), on: s.code.state === "on", seenAt: s.seenAt, source: s.source, archived: s.archived, plan: s.plan ?? null });

/** Guarda o último plano visto da pessoa (pelo alias) para o selo do seletor; só grava se mudou. */
function rememberPlan(alias: string, plan: PlanName): void {
  const m = load();
  let changed = false;
  for (const s of m.values()) if (supportAlias(s.code) === alias && s.plan !== plan) { s.plan = plan; changed = true; }
  if (changed) save(m);
}

/** Pessoas do suporte (atualiza pela caixa de entrada); `warning` explica se a caixa não respondeu. */
export async function supportPeople(): Promise<{ people: SupportPerson[]; warning: string | null }> {
  // As leituras (caixa e planos, por SSH) levam segundos: o salvo é relido depois delas e só recebe o que mudou, senão
  // uma pessoa gravada nesse meio tempo (ex.: usuário da aba Usuários) seria apagada pela cópia velha.
  const pull = await pullInbox().catch((e: unknown) => ({ lidos: [], warning: e instanceof Error ? e.message : String(e) }));
  const warning = pull.warning;
  const ligados = new Map<string, string>();
  { const antes = load(); juntarCaixa(antes, pull.lidos); for (const [id, s] of antes) if (s.code.state === "on") ligados.set(id, supportAlias(s.code)); }
  // Atualiza o plano em cache de cada pessoa ligada (melhor esforço, para o selo "PRO" do seletor refletir a conta).
  const planos = new Map<string, PlanName>();
  await Promise.all([...ligados].map(async ([id, alias]) => { const plan = await readPlan(alias); if (plan !== null) planos.set(id, plan); }));
  const m = load();
  juntarCaixa(m, pull.lidos);
  for (const [id, plan] of planos) { const s = m.get(id); if (s !== undefined) s.plan = plan; }
  save(m);
  writeSshFiles(m);
  // Contas adotadas que ainda não ficaram prontas retomam sozinhas, uma vez por sessão (sem adicionar de novo).
  for (const s of m.values()) if (s.adotada === true && s.code.state === "on" && !prepareTried.has(supportAlias(s.code))) startPrepare(supportAlias(s.code));
  return { people: [...m.values()].map(toPerson).sort((a, b) => a.name.localeCompare(b.name)), warning };
}

/** Lê só o plano da licença da máquina (SSH curto, melhor esforço); null = fora do ar, ausente ou inválido. */
async function readPlan(host: string): Promise<PlanName | null> {
  const r = await runSsh(host, `cat "${LICENSE_PATH}" 2>/dev/null; echo\n`, 10_000).catch(() => null);
  if (r === null || r.code !== 0) return null;
  try { const v: unknown = JSON.parse(r.stdout.trim() || "null"); return v !== null && typeof v === "object" && !Array.isArray(v) ? parseLicense(v).plan : null; } catch { return null; }
}

/** Pessoas já conhecidas (sem ler a caixa): a lista do seletor abre na hora. */
export const knownPeople = (): SupportPerson[] => [...load().values()].map(toPerson).sort((a, b) => a.name.localeCompare(b.name));

/**
 * "Adicionar pessoa" colando o código (plano B da entrega automática) ou um host do ~/.ssh/config do admin
 * ("ssh agente-box-lv"): aí o admin entra com o acesso que já tem e monta o código sozinho (adoptSshHost).
 */
export async function addSupportCode(text: string): Promise<SupportPerson> {
  const host = text.trim().startsWith("MBS1.") ? null : parseSshAddTarget(text);
  const code = host !== null ? await adoptSshHost(host) : (() => { const d = decodeSupportCode(text); if (!d.ok) throw new Error(d.reason); return d.code; })();
  const m = load();
  const s: Stored = { code, seenAt: new Date().toISOString(), source: "colado", archived: false, nickname: "", ...(host !== null ? { adotada: true as const } : {}) };
  m.set(machineId(code), s);
  save(m);
  writeSshFiles(m);
  if (host !== null) {
    // Confere que a chave do admin entra mesmo pelo alias novo (known_hosts e authorized_keys certos).
    const r = await runSsh(supportAlias(code), "true\n", 20_000);
    if (r.code !== 0) throw new Error(`adicionada, mas a chave do admin não entrou: ${lastLine(r)}`);
    startPrepare(supportAlias(code));
  }
  return toPerson(s);
}

/** Preparações rodando agora (uma por conta) e as já tentadas nesta sessão do app pelo "Atualizar pessoas". */
const preparing = new Set<string>();
const prepareTried = new Set<string>();
function startPrepare(alias: string): void {
  if (preparing.has(alias)) return;
  preparing.add(alias); prepareTried.add(alias);
  void prepareAdopted(alias).catch((e: unknown) => { log(`[adotar] ${alias}: ${e instanceof Error ? e.message : String(e)}`); }).finally(() => preparing.delete(alias));
}

const LOGIN_WAIT_MS = 15 * 60_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Conta adotada por SSH (do próprio admin, sem o meu-bot dela para preparar): em segundo plano instala o Claude
 * Code se faltar, abre o login no Terminal se estiver deslogado (aprovar no navegador é o único passo à mão) e,
 * logado, instala o backend, numa porta livre se a do app já tiver dono nesta máquina (outra conta da mesma VM).
 */
async function prepareAdopted(alias: string): Promise<void> {
  const step = (line: string): void => log(`[adotar] ${alias}: ${line}`);
  let p = await probeHost(alias, getBackendPort(alias));
  if (!p.reachable) throw new Error(`inacessível: ${p.error ?? "sem detalhes"}`);
  if (p.backendInstalled && p.backendListening) { step("backend já no ar"); return; }
  if (p.claudePath === null) {
    step("instalando o Claude Code");
    const r = await installClaudeCode(alias, step);
    if (!r.ok) throw new Error(`Claude Code não instalou: ${r.log.at(-1) ?? "?"}`);
    p = await probeHost(alias, getBackendPort(alias));
  }
  if (!p.claudeLoggedIn) {
    step("Claude Code deslogado: abrindo o login no Terminal");
    spawn("osascript", ["-e", `tell application "Terminal" to do script "ssh -t ${alias} 'export PATH=$HOME/.local/bin:$PATH; claude auth login'"`, "-e", 'tell application "Terminal" to activate'], { stdio: "ignore" }).on("error", () => { /* sem Terminal: a sondagem segue mostrando o login */ });
    const until = Date.now() + LOGIN_WAIT_MS;
    while ((await claudeAuthStatus(alias))?.loggedIn !== true) {
      if (Date.now() > until) throw new Error("o login do Claude Code não terminou em 15 min; adicione de novo para retomar");
      await sleep(10_000);
    }
    p = await probeHost(alias, getBackendPort(alias));
  }
  const configured = getBackendPort(alias);
  const port = portaParaInstalar(p, configured);
  step(`instalando o backend na porta ${port}`);
  const r = await installBackend(alias, port, step);
  if (!r.ok) throw new Error(`backend não instalou: ${r.log.at(-1) ?? "?"}`);
  if (port !== configured) { setBackendPortForHost(alias, port); closeTunnel(alias); broadcast("settings:changed", settingsView()); }
  step("pronto: Claude Code logado e backend no ar");
}

/** Resolve o host pelo ~/.ssh/config, instala a chave do admin lá (pelo acesso que já existe) e monta o código. */
async function adoptSshHost(host: string): Promise<SupportCode> {
  if (!fs.existsSync(`${ADMIN_KEY}.pub`)) throw new Error("falta a chave ~/.ssh/meu-bot-admin.pub deste admin");
  const g = spawnSync("ssh", ["-G", "--", host], { encoding: "utf8", timeout: 10_000 });
  const target = g.status === 0 ? parseSshG(g.stdout) : null;
  if (target === null) throw new Error(`não consegui resolver "${host}" no ~/.ssh/config`);
  const r = await runSsh(host, adoptScript({ nome: adminName(), chave: fs.readFileSync(`${ADMIN_KEY}.pub`, "utf8") }), 30_000);
  if (r.code !== 0) throw new Error(`não consegui entrar em ${host}: ${lastLine(r)}`);
  const hostKey = parseAdoptHostKey(r.stdout);
  if (hostKey === null) throw new Error(`${host} não tem chave ed25519 do servidor`);
  return { v: 1, name: host.slice(0, 40), ...target, hostKey, state: "on", at: new Date().toISOString(), ...(/^[A-Za-z0-9._-]{1,64}$/.test(host) ? { machine: host } : {}) };
}

/** Apelido do admin para a pessoa (vence o nome que veio no código; vazio tira). O alias não muda. */
export async function renamePerson(alias: string, nickname: string): Promise<SupportPerson[]> {
  const m = load();
  // O mesmo apelido vai para a máquina (GECOS): o que ela não aceita (dois-pontos, vírgula) sai antes de guardar aqui,
  // senão o admin ficava com um nome e a máquina com outro.
  const nick = apelidoLimpo(nickname);
  let usuario: { nome: string; raiz: string } | null = null;
  for (const s of m.values()) if (supportAlias(s.code) === alias) {
    s.nickname = nick;
    // Usuário criado na aba Usuários: o apelido vai também para a máquina (o admin é root lá), e o meu-bot de qualquer
    // Mac passa a mostrá-lo. Sem a raiz conhecida, fica só aqui.
    const raiz = s.usuarioDe === undefined ? undefined : m.get(s.usuarioDe);
    if (raiz !== undefined) usuario = { nome: s.code.user, raiz: supportAlias(raiz.code) };
  }
  save(m);
  if (usuario !== null) {
    const r = await runSsh(usuario.raiz, `${apelidoSh(usuario.nome, nick)}\n`, 30_000).catch(() => null);
    if (r === null || !/^APELIDO=ok$/m.test(r.stdout)) log(`[usuarios] ${usuario.raiz}: apelido de ${usuario.nome} ficou só neste admin (não gravou na máquina)`);
  }
  return knownPeople();
}

/** O apelido que a aba Usuários gravou na máquina vale também para o nome desse usuário no seletor do admin. */
export function apelidoDoUsuarioNoSeletor(rootAlias: string, nome: string, apelido: string): void {
  let raiz: { id: string; code: SupportCode };
  try { raiz = raizDe(rootAlias); } catch { return; }
  const m = load();
  const s = m.get(idDoUsuario(raiz.code, nome));
  if (s === undefined || s.nickname === apelido) return;
  s.nickname = apelido;
  save(m);
}

/** Arquiva/desarquiva uma pessoa na lista do seletor (o acesso dela não muda). Devolve as pessoas. */
export function archivePerson(alias: string, archived: boolean): SupportPerson[] {
  const m = load();
  for (const s of m.values()) if (supportAlias(s.code) === alias) s.archived = archived;
  save(m);
  return knownPeople();
}

/** Nome da pessoa e o apelido dela para a máquina, pelo alias (títulos e a página Suporte). */
export function personInfo(alias: string): { name: string; machine: string | null } | null {
  for (const s of load().values()) if (supportAlias(s.code) === alias) return { name: s.nickname !== "" ? s.nickname : s.code.name, machine: s.code.machine ?? null };
  return null;
}
export const adminKeyExists = (): boolean => fs.existsSync(ADMIN_KEY);

/** O que ela deixa este app ver (compartilha.json na máquina dela); sem arquivo, tudo. */
export async function readShare(host: string): Promise<SupportShare> {
  const r = await runSsh(host, `cat "${SHARE_FILE}" 2>/dev/null\n`, 15_000).catch(() => null);
  try { return parseSupportShare(JSON.parse(r?.stdout ?? "")); } catch { return parseSupportShare({}); }
}

/** Saúde da máquina da pessoa: a sondagem do seletor + (se ela deixa) o WhatsApp e o progresso nos tutoriais. */
export async function adminHealth(host: string): Promise<AdminHealth> {
  const share = await readShare(host);
  const [probe, wa, progress, xai, license] = await Promise.all([
    probeHost(host, getBackendPort(host)),
    share.whatsapp ? whatsappStatus(host).catch(() => null) : Promise.resolve(null),
    share.progress ? readProgress(host) : Promise.resolve(null),
    xaiAuthInfo(host).catch(() => null),
    readLicenseView(host).catch(() => null),
  ]);
  if (license !== null) rememberPlan(host, license.license.plan);
  return { probe, whatsapp: wa, progress, share, xai, license };
}

/** Licença (billing/plano) não é conteúdo pessoal: é a administração da conta, então não passa pelo compartilha.json. */

/** Licença + devices da conta, como o admin vê. null = máquina fora do ar; arquivos ausentes viram defaults. */

/** Lê um JSON cru (preservando todos os campos, ex.: ips) para alterar e regravar; lança se a máquina não responde. */
async function fetchJson(host: string, remotePath: string): Promise<Record<string, unknown>> {
  const r = await runSsh(host, `cat "${remotePath}" 2>/dev/null; echo\n`, 15_000);
  if (r.code !== 0) throw new Error(`máquina fora do ar: ${lastLine(r)}`);
  try { const v = JSON.parse(r.stdout.trim() || "null"); return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; } catch { return {}; }
}

/** Grava um JSON na máquina da pessoa de forma atômica (base64 pela stdin do bash, 700/600 como o backend). */
async function writeJson(host: string, remotePath: string, value: unknown): Promise<void> {
  const b64 = Buffer.from(JSON.stringify(value, null, 1), "utf8").toString("base64");
  const script = `set -e\numask 077\nmkdir -p "$HOME/.local/share/meu-bot"\nprintf '%s' '${b64}' | base64 -d > "${remotePath}.tmp"\nchmod 600 "${remotePath}.tmp"\nmv "${remotePath}.tmp" "${remotePath}"\n`;
  const r = await runSsh(host, script, 20_000);
  if (r.code !== 0) throw new Error(`não consegui gravar na máquina: ${lastLine(r)}`);
}

/** meu-bot-admin: muda a licença da pessoa (plano, status, validade, limite). Grava licenca.json por SSH. */
export async function setLicense(host: string, patch: LicensePatch): Promise<LicenseView> {
  const current = await fetchJson(host, LICENSE_PATH);
  // Conta sem orientação de pagamento herda a padrão do admin (suporte.json) na primeira mudança.
  const padrao = adminConfig().pagamentoPadrao;
  const comPadrao: LicensePatch = patch.pagamento === undefined && padrao !== null && parsePagamento(current.pagamento) === null ? { ...patch, pagamento: padrao } : patch;
  const next = applyLicensePatch(Object.keys(current).length ? current : null, comPadrao);
  await writeJson(host, LICENSE_PATH, next);
  await registrar(host, "licenca.atualizar", "", JSON.stringify(patch).slice(0, 300));
  const view = await readLicenseView(host);
  if (view === null) throw new Error("gravei, mas a máquina não respondeu ao reler");
  rememberPlan(host, view.license.plan);
  return view;
}

/** meu-bot-admin: libera um device pendente (marca ativo no maquinas.json e sobe o limite se preciso). */
export async function approveDevice(host: string, deviceId: string): Promise<LicenseView> {
  if (!/^[a-f0-9]{12}$/.test(deviceId)) throw new Error("device inválido");
  const machines = await fetchJson(host, MACHINES_PATH);
  const entry = machines[deviceId] as Record<string, unknown> | undefined;
  if (entry === undefined) throw new Error("device não encontrado na máquina");
  entry.status = "active";
  delete entry.requestedAt;
  await writeJson(host, MACHINES_PATH, machines);
  const activeNow = Object.values(machines).filter((e) => e !== null && typeof e === "object" && (e as { status?: unknown }).status !== "pending").length;
  const curLic = await fetchJson(host, LICENSE_PATH);
  const curLimit = Number.isInteger((curLic as { deviceLimit?: unknown }).deviceLimit) ? (curLic.deviceLimit as number) : 1;
  const nextLic = applyLicensePatch(Object.keys(curLic).length ? curLic : null, { deviceLimit: Math.max(activeNow, curLimit) });
  await writeJson(host, LICENSE_PATH, nextLic);
  await registrar(host, "device.liberar", String(entry.name ?? deviceId));
  const view = await readLicenseView(host);
  if (view === null) throw new Error("liberei, mas a máquina não respondeu ao reler");
  rememberPlan(host, view.license.plan);
  return view;
}

/** meu-bot-admin: revoga um device (tira do maquinas.json). Revogar ≠ banir: ele volta no próximo hello se couber. */
export async function removeDevice(host: string, deviceId: string): Promise<LicenseView> {
  if (!/^[a-f0-9]{12}$/.test(deviceId)) throw new Error("device inválido");
  const machines = await fetchJson(host, MACHINES_PATH);
  if (machines[deviceId] === undefined) throw new Error("device não encontrado na máquina");
  const nome = String((machines[deviceId] as { name?: unknown } | undefined)?.name ?? deviceId);
  delete machines[deviceId];
  await writeJson(host, MACHINES_PATH, machines);
  await registrar(host, "device.revogar", nome);
  const view = await readLicenseView(host);
  if (view === null) throw new Error("revoguei, mas a máquina não respondeu ao reler");
  rememberPlan(host, view.license.plan);
  return view;
}

/** O que o meu-bot dela gravou (~/.local/share/meu-bot/progresso.json); dado de fora, validado. */
async function readProgress(host: string): Promise<SupportProgress | null> {
  const r = await runSsh(host, `head -c 16384 "$HOME/.local/share/meu-bot/progresso.json" 2>/dev/null\n`, 20_000).catch(() => null);
  if (r === null || r.stdout.trim() === "") return null;
  try { return parseSupportProgress(JSON.parse(r.stdout)); } catch { return null; }
}

/** Últimos registros do gateway e do backend (só leitura). */
export async function adminLogs(host: string): Promise<string> {
  if (!(await readShare(host)).logs) throw new Error("a pessoa preferiu não compartilhar os registros");
  // Com journal de usuário (VM, OpenClaw): as unidades. Sem ele (Termux/PicoClaw sob runit, backend por nohup):
  // o log do serviço picoclaw, sem as linhas do QR em blocos, e o backend.log do instalador.
  const r = await runSsh(host, `if journalctl --user -n 1 >/dev/null 2>&1; then journalctl --user -u openclaw-gateway -u picoclaw-gateway -u meu-bot-backend -n 200 --no-pager -o short-iso 2>&1 | tail -n 200; else { [ -n "$PREFIX" ] && tail -n 150 "$PREFIX/var/log/sv/picoclaw/current" 2>/dev/null | grep -vE '[▄▀█]'; ${BACKEND_DIR_SH}; tail -n 80 "$BD/backend.log" 2>/dev/null; } | tail -n 200; fi\n`, 30_000);
  return r.stdout.trim() || r.stderr.trim() || "sem registros";
}

/**
 * Conversas dela com o meu-bot: as sessões do Claude Code que o backend abre (pastas *chat-workspace e
 * *agent-workspace em ~/.claude/projects). Só se ela compartilha. Uma linha por sessão; o parse é puro.
 */
export async function adminBotChats(host: string): Promise<BotChat[]> {
  if (!(await readShare(host)).chat) throw new Error("a pessoa preferiu não compartilhar as conversas com o meu-bot");
  const r = await runSsh(host, `for d in "$HOME/.claude/projects/"*chat-workspace "$HOME/.claude/projects/"*agent-workspace; do
  [ -d "$d" ] || continue
  for f in "$d"/*.jsonl; do
    [ -f "$f" ] || continue
    printf 'F\t%s\t%s\t%s\t%s\t' "$(basename "$f" .jsonl)" "$(stat -c %Y "$f")" "$(basename "$d")" "$(grep -c '"type":"assistant"' "$f")"
    grep -m1 '"type":"user"' "$f" | head -c 2000 | tr -d '\n\t'
    echo
  done
done
# Diário do backend para provedores fora do Claude Code (Grok, Hermes): uma conversa por arquivo.
for f in "${APP_CONVERSAS_DIR}"/*.jsonl; do
  [ -f "$f" ] || continue
  printf 'A\t%s\t%s\t%s\t%s\t' "$(basename "$f" .jsonl)" "$(stat -c %Y "$f")" "$(grep -o '"provider":"[^"]*"' "$f" | tail -n1 | cut -d'"' -f4)" "$(grep -c '"role":"assistant"' "$f")"
  grep -m1 '"role":"user"' "$f" | head -c 2000 | tr -d '\n\t'
  echo
done
`, 30_000);
  if (r.code !== 0 && r.stdout.trim() === "") throw new Error(r.stderr.trim() || "não consegui ler as conversas na máquina");
  return parseBotChatList(r.stdout);
}

/** Uma conversa: só as linhas user/assistant do jsonl (o resto é ruído), cada uma cortada em 30 KB. */
export async function adminBotThread(host: string, sessionId: string): Promise<BotMessage[]> {
  if (!isBotChatId(sessionId)) throw new Error("conversa inválida");
  if (!(await readShare(host)).chat) throw new Error("a pessoa preferiu não compartilhar as conversas com o meu-bot");
  const chat = (await adminBotChats(host)).find((c) => c.sessionId === sessionId);
  if (chat === undefined) return [];
  if (chat.source === "app") {
    if (!APP_CONV_ID_RE.test(sessionId)) return [];
    const r = await runSsh(host, `cut -c1-30000 "${APP_CONVERSAS_DIR}/${sessionId}.jsonl"\n`, 30_000);
    return parseAppTranscript(r.stdout);
  }
  if (!PROJECT_DIR_RE.test(chat.project) || !SESSION_ID_RE.test(sessionId)) return [];
  const r = await runSsh(host, `grep -E '"type":"(user|assistant)"' "$HOME/.claude/projects/${chat.project}/${sessionId}.jsonl" | cut -c1-30000\n`, 30_000);
  return parseClaudeTranscript(r.stdout);
}

/** Apaga a transcrição de uma conversa na máquina dela (o backend abre outra sessão no próximo turno). Registrado. */
export async function adminBotDelete(host: string, sessionId: string): Promise<void> {
  if (!isBotChatId(sessionId)) throw new Error("conversa inválida");
  const chat = (await adminBotChats(host)).find((c) => c.sessionId === sessionId);
  if (chat === undefined || (chat.source === "claude" && (!PROJECT_DIR_RE.test(chat.project) || !SESSION_ID_RE.test(sessionId))) || (chat.source === "app" && !APP_CONV_ID_RE.test(sessionId))) throw new Error("conversa não encontrada");
  const file = chat.source === "app" ? `${APP_CONVERSAS_DIR}/${sessionId}.jsonl` : `$HOME/.claude/projects/${chat.project}/${sessionId}.jsonl`;
  // Anota a exclusão na máquina: o meu-bot dela tira a conversa da lista também (conversas-apagadas.json).
  const r = await runSsh(host, `rm -f "${file}"\n${anotarApagadaSh(sessionId, new Date().toISOString())}\n${registroSh("meu-bot.apagar-conversa", "", sessionId)}\n`, 20_000);
  void entregar(host);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "não consegui apagar na máquina");
  log(`[suporte] ${host}: conversa ${sessionId} apagada pelo admin`);
}

const ACTIONS: Record<AdminAction, { acao: Acao; sh: string }> = {
  "install-backend": { acao: "backend.instalar", sh: "" },
  // O gateway é o que atende o WhatsApp: Hermes (escolhido ou já configurado), PicoClaw (runit no Termux, com força
  // porque fechar o WhatsApp pode travar o TERM; systemd de usuário fora dele) ou OpenClaw.
  "restart-gateway": { acao: "servico.reiniciar-gateway", sh: `${WA_ESCOLHA_SH}
if usa_hermes; then
${HERMES_RESTART_SH}
elif command -v picoclaw >/dev/null 2>&1 && [ -f "$HOME/.picoclaw/config.json" ]; then { [ -n "$PREFIX" ] && SVDIR=$PREFIX/var/service sv -w 30 force-restart picoclaw 2>&1; } || systemctl --user restart picoclaw-gateway 2>&1; else systemctl --user restart openclaw-gateway 2>&1 || openclaw gateway restart 2>&1; fi` },
  "restart-backend": { acao: "servico.reiniciar-backend", sh: "systemctl --user restart meu-bot-backend 2>&1" },
  transcription: { acao: "audio.ativar", sh: "" },
  "transcription-off": { acao: "audio.desativar", sh: "" },
  "support-off": { acao: "suporte.desligar-pelo-admin", sh: "" },
};

/**
 * Só o admin desliga o suporte (a pessoa não tem interruptor): na máquina dela, o mesmo script do antigo
 * "desligar" (tira a chave do admin do authorized_keys, entrega "off" na caixa, apaga timer e pasta) e, aqui,
 * a pessoa fica "off" (sai do ~/.ssh/meu-bot-suporte.conf). Ela volta se salvar o nome de novo no tutorial.
 */
/**
 * Desliga o suporte na máquina dela: grava a ação e entrega o registro à central ANTES (depois a chave do admin
 * sai e ele não lê mais a máquina), depois tira as chaves dos admins, entrega "off" na caixa, apaga timer/pasta e
 * marca o bloqueio.
 */
async function supportOff(host: string, off: SupportCode, acao: Acao, alvo = ""): Promise<{ code: number | null; stdout: string; stderr: string }> {
  await registrar(host, acao, alvo);
  await entregar(host);
  return runSsh(host, `${authorizedKeysScript([])}\n${removeDeliverySh(machineId(off), encode(off))}\nrm -f "$HOME/.local/share/meu-bot/progresso.json"\nmkdir -p "$HOME/.local/share/meu-bot" && touch "${SUPPORT_BLOCK_FILE}"\n`, 60_000);
}
const lastLine = (r: { stdout: string; stderr: string }): string => (r.stderr.trim() || r.stdout.trim()).split("\n").pop() ?? "ssh falhou";

async function turnSupportOff(host: string): Promise<{ ok: boolean; detail: string }> {
  const entry = [...load().values()].find((s) => supportAlias(s.code) === host);
  if (entry === undefined) return { ok: false, detail: "pessoa desconhecida" };
  const off: SupportCode = { ...entry.code, state: "off", at: new Date().toISOString() };
  const r = await supportOff(host, off, "suporte.desligar-pelo-admin");
  if (r.code !== 0) return { ok: false, detail: lastLine(r) };
  // Relido depois do SSH: muda só esta pessoa, sem desfazer o que outro fluxo gravou enquanto isso.
  const m = load();
  const atual = m.get(machineId(entry.code));
  if (atual !== undefined) { atual.code = off; save(m); writeSshFiles(m); }
  log(`[suporte] ${host}: suporte desligado pelo admin`);
  return { ok: true, detail: "o acesso a esta máquina acabou; a janela pode ser fechada" };
}

/**
 * "Excluir máquina" no seletor do admin: na máquina dela, limpa todo o histórico do WhatsApp (todas as sessões do
 * OpenClaw, o mesmo "Limpar histórico" de cada conversa, de uma vez) e desliga o suporte (o mesmo do `support-off`);
 * aqui ela sai de pessoas.json, do ~/.ssh/meu-bot-suporte.conf e do arquivo dela na caixa de entrada. Com a máquina
 * fora do ar nada é limpo e ela fica na lista; `force` é o "excluir mesmo assim", que só tira da lista.
 */
export async function removePerson(alias: string, force: boolean): Promise<{ people: SupportPerson[]; cleared: number; detail: string }> {
  const m = load();
  const found = [...m.entries()].find(([, s]) => supportAlias(s.code) === alias);
  if (found === undefined) throw new Error("pessoa desconhecida");
  const [id, entry] = found;
  let cleared = 0;
  let detail = "";
  if (entry.code.state === "on") {
    try {
      const keys = [...new Set((await whatsappChats(alias)).flatMap((c) => c.sessionKeys))];
      if (keys.length > 0) { await whatsappClearSessions(alias, keys); cleared = keys.length; }
      const off: SupportCode = { ...entry.code, state: "off", at: new Date().toISOString() };
      const r = await supportOff(alias, off, "suporte.excluir-maquina", `${cleared} ${cleared === 1 ? "conversa" : "conversas"}`);
      if (r.code !== 0) throw new Error(lastLine(r));
      detail = cleared === 0 ? "não havia histórico do WhatsApp para limpar; o suporte foi desligado" : `histórico do WhatsApp limpo (${cleared} ${cleared === 1 ? "conversa" : "conversas"}) e suporte desligado`;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (!force) throw new Error(`a máquina não respondeu (${why}); nada foi limpo e ela continua na lista`);
      detail = `a máquina não respondeu (${why}); só saiu da lista`;
    }
  } else {
    detail = "o suporte já estava desligado; a máquina só saiu da lista";
  }
  await esquecer(id);
  log(`[suporte] ${alias}: excluída pelo admin (${detail})`);
  return { people: knownPeople(), cleared, detail };
}

/** Tira a pessoa da lista sem falar com a máquina dela: sai da caixa de entrada (senão a próxima leitura a traz de volta) e dos arquivos SSH. */
async function esquecer(id: string): Promise<void> {
  const entry = load().get(id);
  if (entry === undefined) return;
  const inbox = adminConfig().inbox.alias;
  if (inbox !== "") await runSsh(inbox, `rm -f "$HOME/suporte-inbox/${id}.code" "$HOME/suporte-inbox/${legacyMachineId(entry.code.hostKey)}.code"\n`, 20_000).catch(() => null);
  // Relido depois do SSH: grava só a saída desta pessoa, sem desfazer o que outro fluxo gravou enquanto isso.
  const m = load(); m.delete(id); save(m); writeSshFiles(m);
}

/** O código da máquina-raiz (a da janela de "Usuários") pelo alias de suporte dela. */
function raizDe(rootAlias: string): { id: string; code: SupportCode } {
  for (const [id, s] of load()) if (supportAlias(s.code) === rootAlias) return { id, code: s.code };
  throw new Error("esta janela não é de uma pessoa conhecida do suporte");
}
/** Id que o usuário `nome` da máquina-raiz tem (ou terá) no suporte: a mesma chave do servidor e porta, outro usuário. */
const idDoUsuario = (raiz: SupportCode, nome: string): string => machineId({ ...raiz, user: nome });

/**
 * Usuário de login da aba "Usuários" entra no seletor do admin: o admin entra pelo `meuBotAlias` (o acesso deste Mac
 * que já está na conta), põe a chave dele no authorized_keys e guarda a pessoa marcada com `usuarioDe`, SEM preparar
 * nada na conta (nem Claude Code, nem login, nem backend). Já conhecido: não faz nada. Devolve o alias de suporte.
 */
export async function adicionarUsuario(rootAlias: string, meuBotAlias: string, nome: string): Promise<{ alias: string; novo: boolean }> {
  const raiz = raizDe(rootAlias);
  const conhecido = load().get(idDoUsuario(raiz.code, nome));
  if (conhecido !== undefined) return { alias: supportAlias(conhecido.code), novo: false };
  const code = await adoptSshHost(meuBotAlias);
  if (code.user !== nome || code.hostKey !== raiz.code.hostKey) throw new Error(`${meuBotAlias} não leva ao usuário ${nome} desta máquina`);
  // Relido depois do SSH (segundos): grava só esta pessoa, sem desfazer o que outro fluxo gravou enquanto isso.
  const m = load();
  m.set(machineId(code), { code, seenAt: new Date().toISOString(), source: "colado", archived: false, nickname: "", usuarioDe: raiz.id });
  save(m); writeSshFiles(m);
  const r = await runSsh(supportAlias(code), "true\n", 20_000);
  if (r.code !== 0) throw new Error(`entrou na lista, mas a chave do admin não entrou: ${lastLine(r)}`);
  log(`[usuarios] ${rootAlias}: ${nome} entrou no seletor do admin como ${supportAlias(code)}`);
  return { alias: supportAlias(code), novo: true };
}

/** O usuário apagado sai do seletor do admin (pela identidade: chave do servidor + usuário + porta), sem SSH na conta que não existe mais. */
export async function esquecerUsuario(rootAlias: string, nome: string): Promise<boolean> {
  const raiz = raizDe(rootAlias);
  const id = idDoUsuario(raiz.code, nome);
  if (!load().has(id)) return false;
  await esquecer(id);
  log(`[usuarios] ${rootAlias}: ${nome} saiu do seletor do admin`);
  return true;
}

/** Os usuários da máquina-raiz que já estão no seletor do admin (pelo nome de login). */
export function usuariosNoSeletor(rootAlias: string): Set<string> {
  const raiz = raizDe(rootAlias);
  return new Set([...load().values()].filter((s) => s.code.hostKey === raiz.code.hostKey && s.code.port === raiz.code.port && s.code.hostname === raiz.code.hostname).map((s) => s.code.user));
}

/**
 * "Instalar o backend do meu-bot" pelo admin: mesma porta que o seletor da pessoa escolheria (portaParaInstalar:
 * a do backend existente, senão a primeira livre, porque contas da mesma máquina não dividem porta), o mesmo
 * instalador, e a porta fica gravada para esta pessoa (o túnel do admin passa a usá-la). O app dela lê a porta do
 * .env na sondagem. Claude deslogado não impede (o backend responde 401 até o login, que é dela).
 */
async function instalarBackend(host: string): Promise<{ ok: boolean; detail: string }> {
  const configurada = getBackendPort(host);
  const probe = await probeHost(host, configurada);
  if (!probe.reachable) return { ok: false, detail: "a máquina não respondeu" };
  const porta = portaParaInstalar(probe, configurada);
  const r = await installBackend(host, porta);
  if (r.ok) {
    if (porta !== configurada) { setBackendPortForHost(host, porta); closeTunnel(host); broadcast("settings:changed", settingsView()); }
    await registrar(host, "backend.instalar", `porta ${porta}`);
  }
  log(`[suporte] ${host}: backend ${r.ok ? "instalado" : "falhou"} na porta ${porta}`);
  return { ok: r.ok, detail: r.ok ? `backend instalado na porta ${porta}${probe.claudeLoggedIn ? "" : "; falta ela entrar no Claude Code"}` : (r.log.at(-1) ?? "falhou") };
}

/** Ação de suporte: roda na máquina da pessoa e fica no registro que ela vê. */
export async function adminAction(host: string, action: AdminAction): Promise<{ ok: boolean; detail: string }> {
  const a = ACTIONS[action];
  if (action === "support-off") return turnSupportOff(host);
  if (action === "install-backend") return instalarBackend(host);
  // No registro (a pessoa vê; o super admin audita), quem fez é este admin, pelo nome do app dele.
  if (action === "transcription" || action === "transcription-off") {
    const r = await installAudio(host, { kind: "in", ...(action === "transcription-off" ? { off: true } : {}) });
    await registrar(host, a.acao);
    return { ok: r.ok, detail: r.log.at(-1) ?? "" };
  }
  const r = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${registroSh(a.acao)}\n${a.sh}\n`, 60_000);
  void entregar(host);
  log(`[suporte] ${host}: ${a.acao} (código ${r.code})`);
  return { ok: r.code === 0, detail: (r.stdout.trim() || r.stderr.trim()).split("\n").pop() ?? "" };
}
