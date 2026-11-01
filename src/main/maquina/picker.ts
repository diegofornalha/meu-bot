/**
 * Seletor de máquinas: a janela que abre o app ("abrir o meu-bot em…"). Sonda todos os hosts em paralelo
 * (com cache curto para reabrir instantâneo) e abre a janela principal do escolhido. O que muda por variante
 * vem de uma PickerSource: no meu-bot normal (clientPickerSource, aqui) a lista é `local` + hosts do
 * ~/.ssh/config, com instalar o backend, sincronizar o ~/.ssh/config, renomear e remover; no meu-bot-admin
 * (admin/picker-source.ts) a lista são as pessoas do suporte. Os handlers comuns ficam em initPicker.
 */
import { caps } from "../app/variant";
import { parseLicense } from "../licenca/licenca";
import { deveAtualizar, precisaAtualizarBackend } from "../atualizacao/updater-core";
import { app, BrowserWindow, screen, shell } from "electron";
import path from "node:path";
import type { HostProbe, InstallBackendResult, PickerInit, PlanName } from "../../shared/ipc";
import { approveTailscaleCheck, bundledBackendVersion, bundledCrmVersion, bundledFinanceVersion, bundledGuardaVersion, bundledHermesPausaVersion, installAudio, installHermesPausa, installBackend, installClaudeCode, installCrm, installFinance, installGuarda, installStatusLine, probeHost } from "./hostProbe";
import { portaParaInstalar } from "./porta-backend-core";
import { isSupportAlias } from "../suporte/support-code";
import { LOCAL_HOST } from "./localBackend";
import { runSsh } from "../whatsapp/whatsapp";
import { showRelief } from "../app/relief";
import { openGrokbotReset } from "../app/grokbot";
import { clearTailscaleCredential, saveTailscaleCredential, tailscaleCredentialState } from "../app/secrets";
import { disableSshCheck } from "./tailscale";
import { handleClient, handleShared, onShared } from "../ipc/registry";
import { log } from "./backend";
import { resumoDoInstalador } from "./backend-bundle-core";
import { evento } from "../app/depuracao";
import { atualizarModulos } from "../modulos/modulos";
import { settingsView, getBackendPort, getHostNames, getLastHost, getOpenDirect, isOnboardingDone, isPodHost, isValidHost, setBackendPortForHost, setHostName, setLastHost, setOnboardingDone, setOpenDirect, setPodHost, setApelidoMaquina } from "../app/settings";
import { isPort } from "../app/settings-normalize";
import { closeTunnel } from "./tunnel";
import { listSshHosts } from "./sshConfig";
import { removeHostFromSshConfig, syncSshConfig } from "./sshSync";
import {
  createReliefShortcut, createShortcut, hasReliefShortcut, hasShortcut, removeReliefShortcut, removeShortcut, shortcutEmoji,
} from "../app/shortcuts";
import { backgroundColor, broadcast, MIN_WINDOW_WIDTH, openMainWindow, sendWhenLoaded, windowForHost } from "../app/windows";
import { posicaoNoCanto } from "../app/janela-core";
import { seletorPodeAbrir, seletorRecemAberto, suprimirSeletorAte } from "./seletor-notificacao-core";
import { hostIsLocalAddr } from "../app/net";

/** URLs que o seletor pode pedir para abrir: lista fechada, nunca URL livre do renderer. */
const KNOWN_URLS: Record<string, string> = { "tailscale-keys": "https://login.tailscale.com/admin/settings/keys" };

/** O que o seletor usa de dentro, oferecido aos handlers de cada variante. */
export interface PickerIpcContext {
  /** O pedido veio da janela do seletor? */
  fromPicker(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean;
  /** `payload.host` validado. */
  hostArg(payload: unknown): string;
  /** A próxima sondagem desse host precisa ser nova. */
  forgetProbe(host: string): void;
  /** Linha de progresso de uma instalação, para a lista do seletor. */
  progress(host: string, line: string): void;
  closePicker(): void;
}

/** O que muda no seletor por variante. */
export interface PickerSource {
  title: string;
  /** Os hosts da lista. */
  hosts(): string[];
  /** meu-bot-admin: as pessoas; null no meu-bot normal. */
  support(): PickerInit["support"];
  /** Handlers só desta variante (os comuns ficam em initPicker). */
  registerIpc(ctx: PickerIpcContext): void;
}

let source: PickerSource | null = null;
let pickerWin: BrowserWindow | null = null;
let lastError: string | null = null;
let preselectOverride: string | null = null;
/** Quando o seletor foi mostrado pela última vez e até quando o `activate` não deve abri-lo (clique em notificação). */
let pickerMostradoEm = 0;
let seletorSuprimidoAte = 0;

/**
 * Clique numa notificação: no macOS ele também "reabre" o app e dispara `activate`, que abriria o seletor por cima da
 * conversa. Por 1,5 s o `activate` é ignorado, e se o seletor acabou de abrir por isso (a ordem dos eventos não é
 * garantida), ele é fechado. Um seletor que a pessoa abriu antes fica.
 */
export function notificacaoClicada(): void {
  const agora = Date.now();
  seletorSuprimidoAte = suprimirSeletorAte(agora);
  if (pickerWin !== null && !pickerWin.isDestroyed() && seletorRecemAberto(pickerMostradoEm, agora)) pickerWin.close();
}
/** O `activate` (Dock, Finder) pode abrir o seletor agora? Não logo depois de um clique em notificação. */
export const seletorPodeAbrirAgora = (): boolean => seletorPodeAbrir(seletorSuprimidoAte, Date.now());

/** Última sondagem por host; serve `window:info` (modelos) e reabre o seletor sem esperar o ssh. */
const probes = new Map<string, { probe: HostProbe; at: number }>();
const PROBE_TTL_MS = 60_000;
const inflight = new Map<string, Promise<HostProbe>>();

export const knownModels = (host: string): string[] => probes.get(host)?.probe.models ?? [];

function probeCached(host: string): Promise<HostProbe> {
  const hit = probes.get(host);
  if (hit !== undefined && Date.now() - hit.at < PROBE_TTL_MS) return Promise.resolve(hit.probe);
  const running = inflight.get(host);
  if (running !== undefined) return running;
  const p = probeHost(host, getBackendPort(host)).then((probe) => {
    probes.set(host, { probe, at: Date.now() });
    // Só uma sondagem que entrou sabe dizer; inacessível não apaga o que já se sabia.
    if (probe.reachable) { setPodHost(host, probe.grokPod); if (setApelidoMaquina(host, probe.apelido)) broadcast("settings:changed", settingsView()); }
    // Backend antes dos plugins: o plugin do financeiro (e o do CRM) chamam a API dele.
    void ensureBackendAtual(host, probe).finally(() => {
      ensureGuarda(host, probe);
      ensureHermesPausa(host, probe);
      ensureCrmAtual(host, probe);
      ensureFinanceAtual(host, probe);
      ensureModulosAtuais(host, probe);
    });
    return probe;
  }).finally(() => inflight.delete(host));
  inflight.set(host, p);
  return p;
}

/**
 * Anti-loop é padrão da conta: toda máquina com OpenClaw recebe a guarda do WhatsApp sozinha (notas técnicas
 * não vão ao contato; despedidas bot-com-bot em 3 ciclos pausam a conversa). Uma tentativa por máquina por
 * sessão do app, em segundo plano; o tutorial 9 só confere e explica. Uma máquina sem SSH ou cujo agente não aceita a guarda fica fora.
 */
/**
 * Padrão do app: máquina com Hermes ganha a pausa por contato com prazo (plugin meu-bot-pausa) sozinha, como a guarda
 * no OpenClaw. Uma tentativa por máquina por sessão, em segundo plano; só sobe de versão. Com pausa nativa, nada.
 */
const pausaTried = new Set<string>();
function ensureHermesPausa(host: string, probe: HostProbe): void {
  if (!probe.reachable || probe.gateway !== "hermes" || probe.hermesPausa === null || probe.hermesPausa === undefined || host === LOCAL_HOST || pausaTried.has(host)) return;
  const want = bundledHermesPausaVersion();
  if (want === null) return;
  const missing = probe.hermesPausa === false;
  const outdated = probe.hermesPausa === true && deveAtualizar(probe.hermesPausaVersion ?? null, want);
  if (!missing && !outdated) return;
  pausaTried.add(host);
  log(`[pausa] ${host}: ${missing ? "Hermes sem o plugin de pausa" : `plugin ${probe.hermesPausaVersion ?? "sem versão"} → ${want}`}; instalando em segundo plano`);
  void installHermesPausa(host).then((r) => {
    log(`[pausa] ${host}: ${r.ok ? "plugin instalado sozinho" : `instalação automática falhou: ${resumoDoInstalador(r.log)}`}`);
    const hit = probes.get(host); if (r.ok && hit !== undefined) probes.set(host, { probe: { ...hit.probe, hermesPausa: true, hermesPausaVersion: want }, at: hit.at });
  }).catch((e: unknown) => { log(`[pausa] ${host}: instalação automática falhou: ${e instanceof Error ? e.message : String(e)}`); });
}

const guardaTried = new Set<string>();
function ensureGuarda(host: string, probe: HostProbe): void {
  // `guarda === null` = a sondagem não encontrou agente que aceite a guarda (hostProbe.ts só a preenche onde ela cabe).
  if (!probe.reachable || probe.guarda === null || host === LOCAL_HOST || guardaTried.has(host)) return;
  const want = bundledGuardaVersion();
  const missing = probe.guarda === false;
  // Só sobe de versão (o estável e o staging dividem a máquina: um não rebaixa a guarda do outro).
  const outdated = probe.guarda === true && deveAtualizar(probe.guardaVersion ?? null, want);
  if (!missing && !outdated) return;
  guardaTried.add(host);
  log(`[guarda] ${host}: ${missing ? "máquina com OpenClaw sem a guarda" : `guarda ${probe.guardaVersion ?? "sem versão"} → ${want}`}; instalando em segundo plano`);
  void installGuarda(host).then((r) => {
    log(`[guarda] ${host}: ${r.ok ? "instalada sozinha" : `instalação automática falhou: ${resumoDoInstalador(r.log)}`}`);
    const hit = probes.get(host); if (r.ok && hit !== undefined) probes.set(host, { probe: { ...hit.probe, guarda: true, guardaVersion: bundledGuardaVersion() }, at: hit.at });
  }).catch((e: unknown) => { log(`[guarda] ${host}: instalação automática falhou: ${e instanceof Error ? e.message : String(e)}`); });
}

/**
 * Plugin do CRM numa versão anterior à deste app: atualiza em segundo plano (só sobe de versão, e só onde o CRM já está
 * instalado; nunca instala do zero). Uma tentativa por máquina por sessão do app.
 */
const crmTried = new Set<string>();
function ensureCrmAtual(host: string, probe: HostProbe): void {
  if (!probe.reachable || probe.crm !== true || host === LOCAL_HOST || crmTried.has(host)) return;
  const want = bundledCrmVersion();
  if (!deveAtualizar(probe.crmVersion ?? null, want)) return;
  crmTried.add(host);
  log(`[crm] ${host}: plugin do CRM ${probe.crmVersion ?? "sem versão"} → ${want}; atualizando em segundo plano`);
  void installCrm(host).then((r) => { log(`[crm] ${host}: ${r.ok ? "atualizado sozinho" : `atualização automática falhou: ${resumoDoInstalador(r.log)}`}`); })
    .catch((e: unknown) => { log(`[crm] ${host}: atualização automática falhou: ${e instanceof Error ? e.message : String(e)}`); });
}

/**
 * Backend da máquina numa versão anterior à deste app (a API do financeiro e do CRM, a licença): reinstala em segundo
 * plano, só para cima e só ocioso (o install.sh reinicia o serviço). Ocupado = tenta na próxima sondagem; instalação
 * feita ou falha = uma tentativa por máquina por sessão do app. A porta é a do backend instalado (o .env fica).
 */
const backendTried = new Set<string>();
async function ensureBackendAtual(host: string, probe: HostProbe): Promise<void> {
  if (!probe.reachable || host === LOCAL_HOST || backendTried.has(host)) return;
  const want = bundledBackendVersion();
  const decisao = precisaAtualizarBackend(probe, want);
  if (decisao === "nao") return;
  if (decisao === "ocupado") { log(`[backend] ${host}: ${probe.backendVersion ?? "sem versão"} → ${want ?? "?"}, mas há ${probe.backendBusy} chat(s) em andamento; tenta na próxima sondagem`); return; }
  backendTried.add(host);
  log(`[backend] ${host}: backend ${probe.backendVersion ?? "sem versão"} → ${want ?? "?"}; atualizando em segundo plano`);
  try {
    const r = await installBackend(host, portaParaInstalar(probe, getBackendPort(host)));
    log(`[backend] ${host}: ${r.ok ? "atualizado sozinho" : `atualização automática falhou: ${resumoDoInstalador(r.log)}`}`);
    // A faixa de depuração mostra o erro de verdade (um "cp: cannot stat" do instalador, por exemplo), não só "código 1".
    if (!r.ok) evento({ origem: "main", dono: null, rota: `backend/atualizar ${host}`, ok: false, ms: null, resumo: resumoDoInstalador(r.log).slice(0, 200), detalhe: { host, versao: want, log: r.log.slice(-15) } });
    const hit = probes.get(host); if (r.ok && hit !== undefined) probes.set(host, { probe: { ...hit.probe, backendVersion: want }, at: hit.at });
  } catch (e) { log(`[backend] ${host}: atualização automática falhou: ${e instanceof Error ? e.message : String(e)}`); }
}

/** Mesmo trato para o financeiro: só sobe de versão onde ele já está instalado (instalar é o tutorial 13). */
const financeTried = new Set<string>();
function ensureFinanceAtual(host: string, probe: HostProbe): void {
  if (!probe.reachable || probe.finance !== true || host === LOCAL_HOST || financeTried.has(host)) return;
  const want = bundledFinanceVersion();
  if (!deveAtualizar(probe.financeVersion ?? null, want)) return;
  financeTried.add(host);
  log(`[finance] ${host}: financeiro ${probe.financeVersion ?? "sem versão"} → ${want}; atualizando em segundo plano`);
  void installFinance(host).then((r) => { log(`[finance] ${host}: ${r.ok ? "atualizado sozinho" : `atualização automática falhou: ${resumoDoInstalador(r.log)}`}`); })
    .catch((e: unknown) => { log(`[finance] ${host}: atualização automática falhou: ${e instanceof Error ? e.message : String(e)}`); });
}

/** Módulos de produto (apps com caps().modulos): os ligados numa versão anterior à deste app sobem sozinhos. */
const modulosTried = new Set<string>();
function ensureModulosAtuais(host: string, probe: HostProbe): void {
  if (caps().modulos === null || !probe.reachable || host === LOCAL_HOST || modulosTried.has(host)) return;
  modulosTried.add(host);
  void atualizarModulos(host, log).catch((e: unknown) => { log(`[modulos] ${host}: atualização automática falhou: ${e instanceof Error ? e.message : String(e)}`); });
}

const current = (): PickerSource => { if (source === null) throw new Error("seletor sem fonte: initPicker não rodou"); return source; };

/** A chegada animada do seletor toca uma vez por sessão do app; depois a lista aparece seca. */
let arrivalShown = false;

/** A lista de máquinas do último init enviado: o foco só reenvia (e o seletor só sonda de novo) se ela mudou. */
let lastHostsKey = "";
function initPayload(): PickerInit {
  const arrival = !arrivalShown; arrivalShown = true;
  const hosts = current().hosts();
  lastHostsKey = JSON.stringify(hosts);
  const wanted = preselectOverride ?? getLastHost() ?? LOCAL_HOST;
  return {
    hosts,
    support: current().support(),
    preselect: hosts.includes(wanted) ? wanted : (hosts[0] ?? LOCAL_HOST),
    open: hosts.filter((h) => windowForHost(h) !== undefined),
    shortcuts: hosts.filter(hasShortcut).map((h) => ({ host: h, emoji: shortcutEmoji(h) })),
    pods: hosts.filter(isPodHost),
    reliefShortcuts: hosts.filter(hasReliefShortcut),
    openDirect: getOpenDirect(),
    names: getHostNames(),
    onboardingDone: isOnboardingDone(),
    error: lastError,
    arrival,
    version: app.getVersion(),
  };
}

/**
 * Instala (ou reinstala) o backend do meu-bot na máquina, do seletor ou da própria janela dela. A porta é a que a
 * sondagem decidiu: a do backend já instalado (reinstalar não muda o .env), a primeira livre quando a do app está
 * tomada nesta máquina, senão a do app. Instalou em outra: fica gravada só para ela. No fim o túnel recomeça do zero
 * (um "sem backend" anterior é erro fatal e não se refaz sozinho).
 */
export async function instalarBackendDaMaquina(host: string, onLine: (line: string) => void): Promise<InstallBackendResult> {
  const probe = await probeCached(host);
  const configured = getBackendPort(host);
  const port = portaParaInstalar(probe, configured);
  if (port !== configured) onLine(`porta ${configured} ${probe.backendInstalled ? "não é a do backend desta máquina" : "já ocupada nesta máquina"}: usando ${port} para ${host}`);
  const r = await installBackend(host, port, onLine);
  if (r.ok && port !== configured) { setBackendPortForHost(host, port); broadcast("settings:changed", settingsView()); }
  if (r.ok) closeTunnel(host);
  probes.delete(host);
  return r;
}

/**
 * O backend do meu-bot está instalado na máquina? (sondagem do seletor, com cache curto). `null` quando a máquina
 * não respondeu (desligada, Tailscale fora): a sonda devolve `backendInstalled=false` nesse caso, e isso não é
 * "sem backend" — a janela fica com o que sabia em vez de oferecer o instalar.
 */
export async function backendPresente(host: string): Promise<boolean | null> {
  const p = await probeCached(host);
  return p.reachable ? p.backendInstalled : null;
}

const ctx: PickerIpcContext = {
  fromPicker: (event) => pickerWin !== null && !pickerWin.isDestroyed() && event.sender === pickerWin.webContents,
  hostArg: (payload) => {
    const host = String((payload as { host?: unknown } | null)?.host ?? "").trim();
    if (!isValidHost(host)) throw new Error(`Host SSH inválido: ${JSON.stringify(host)}`);
    return host;
  },
  forgetProbe: (host) => { probes.delete(host); },
  progress: (host, line) => { if (pickerWin !== null && !pickerWin.isDestroyed()) pickerWin.webContents.send("picker:install-progress", { host, line }); },
  closePicker: () => { pickerWin?.close(); },
};
const { fromPicker, hostArg } = ctx;

/**
 * Variante: cliente. `local` + hosts do ~/.ssh/config, menos os aliases `suporte-*` (do meu-bot-admin, via
 * Include no ~/.ssh/config): são as máquinas das pessoas que o admin atende, não máquinas desta pessoa.
 */
export const clientPickerSource: PickerSource = {
  // Nome do app (meu-bot-staging inclusive, com a versão): diz qual build está aberto.
  get title() { return `${caps().titulo} · escolher máquina`; },
  hosts: () => [LOCAL_HOST, ...listSshHosts().filter((h) => !isSupportAlias(h))],
  support: () => null,
  registerIpc: ({ fromPicker, hostArg, forgetProbe, progress, closePicker }) => {
    handleClient("picker:install", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      return instalarBackendDaMaquina(host, (line) => progress(host, line));
    });
    handleClient("picker:install-statusline", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      const r = await installStatusLine(host, (line) => progress(host, line));
      forgetProbe(host);
      return r;
    });
    handleClient("picker:install-claude", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      const r = await installClaudeCode(host, (line) => progress(host, line));
      forgetProbe(host);
      return r;
    });
    handleClient("picker:install-guarda", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      const r = await installGuarda(host, (line) => progress(host, line));
      forgetProbe(host);
      return r;
    });
    handleClient("picker:install-transcricao", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      const r = await installAudio(host, { kind: "in" }, (line) => progress(host, line));
      forgetProbe(host);
      return r;
    });
    handleClient("picker:sync-ssh", (event) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      return syncSshConfig();
    });
    // "Remover do seletor": sai do ~/.ssh/config (com backup) e os atalhos da mesa dela vão junto.
    handleClient("picker:remove-host", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      if (host === LOCAL_HOST) throw new Error("este Mac não sai da lista");
      if (windowForHost(host) !== undefined) throw new Error(`feche a janela de ${host} antes de remover`);
      const r = removeHostFromSshConfig(host);
      if (hasShortcut(host)) removeShortcut(host);
      if (hasReliefShortcut(host)) removeReliefShortcut(host);
      forgetProbe(host);
      if (getLastHost() === host) setLastHost(LOCAL_HOST);
      return { backup: r.backup };
    });
    handleClient("picker:rename-host", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      setHostName(host, String((payload as { name?: unknown } | null)?.name ?? ""));
      // As janelas abertas trocam o título na hora (settings:changed já leva hostNames).
      broadcast("settings:changed", settingsView());
    });
    handleClient("picker:open-direct", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      setOpenDirect((payload as { value?: unknown } | null)?.value === true);
    });
    handleClient("picker:onboarding-done", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      setOnboardingDone((payload as { value?: unknown } | null)?.value === true);
    });
    handleClient("picker:approve-tailscale", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      const r = await approveTailscaleCheck(host);
      forgetProbe(host);
      return r;
    });
    handleClient("picker:tailscale-credential-save", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const p = payload as { clientId?: unknown; clientSecret?: unknown } | null;
      return saveTailscaleCredential(String(p?.clientId ?? ""), String(p?.clientSecret ?? ""));
    });
    handleClient("picker:tailscale-credential-forget", (event) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      return clearTailscaleCredential();
    });
    handleClient("picker:tailscale-disable-check", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const host = hostArg(payload);
      const r = await disableSshCheck();
      forgetProbe(host);
      return r;
    });
    handleClient("picker:claude-login", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const raw = String((payload as { host?: unknown } | null)?.host ?? "").trim();
      const host = raw === LOCAL_HOST ? LOCAL_HOST : hostArg(payload);
      setLastHost(host);
      const win = openMainWindow(host, "picker");
      sendWhenLoaded(win, "ui:claude-login", {});
      forgetProbe(host);
      closePicker();
    });
  },
};

export function initPicker(src: PickerSource): void {
  source = src;
  handleShared("picker:list", (event) => { if (!fromPicker(event)) throw new Error("origem inválida"); return initPayload(); });
  // Plano de cada host (licenca.json por SSH, melhor esforço) para o selo "PRO"; local e máquinas fora do ar ficam de fora.
  // Um pod do Grok Bot demora até 90 s para aceitar o ssh: com 10 s a grokbot-1 nunca ganhava o selo.
  // Quais máquinas são este próprio Mac por SSH (Colima): `ssh -G` local, sem rede, cacheado por alias.
  handleShared("picker:locais", async (event) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const hosts = current().hosts().filter((h) => h !== LOCAL_HOST && isValidHost(h));
    const sim = await Promise.all(hosts.map(async (h) => ((await hostIsLocalAddr(h)) ? h : null)));
    return sim.filter((h): h is string => h !== null);
  });
  handleShared("picker:plans", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const so = (payload as { host?: unknown } | null)?.host;
    const hosts = current().hosts().filter((h) => h !== LOCAL_HOST && isValidHost(h) && (typeof so !== "string" || h === so));
    const out: Record<string, PlanName> = {};
    await Promise.all(hosts.map(async (h) => {
      try {
        const r = await runSsh(h, `cat "$HOME/.local/share/meu-bot/licenca.json" 2>/dev/null; echo\n`, 90_000);
        if (r.code !== 0) return;
        const v: unknown = JSON.parse(r.stdout.trim() || "null");
        if (v !== null && typeof v === "object" && !Array.isArray(v)) out[h] = parseLicense(v).plan;
      } catch { /* fora do ar, ausente ou JSON inválido: sem selo */ }
    }));
    return out;
  });
  handleShared("picker:probe", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    return probeCached(hostArg(payload));
  });
  // "Usar porta N": o backend da máquina está em outra porta; o app passa a usar essa só para ela. É configuração
  // deste Mac (nada escrito na máquina), então o meu-bot-admin também ajusta a sua.
  handleShared("picker:use-port", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    const port = (payload as { port?: unknown } | null)?.port;
    if (!isPort(port)) throw new Error("Porta do backend inválida (1 a 65535).");
    setBackendPortForHost(host, port);
    closeTunnel(host);
    broadcast("settings:changed", settingsView());
    probes.delete(host);
  });
  handleShared("picker:choose", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    setLastHost(host);
    lastError = null;
    preselectOverride = null;
    openMainWindow(host, "picker");
    // Abrir antes de fechar: fora do macOS, fechar a última janela encerraria o app.
    pickerWin?.close();
  });
  handleShared("picker:shortcut", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    const create = (payload as { create?: unknown } | null)?.create === true;
    if (create) await createShortcut(host); else removeShortcut(host);
    return { has: hasShortcut(host), emoji: shortcutEmoji(host) };
  });
  handleShared("picker:relieve", (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    if (!isPodHost(host)) throw new Error(`${host} não foi reconhecida como computador do Grok Bot.`);
    showRelief(host);
    pickerWin?.close();
  });
  handleShared("picker:relief-shortcut", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const host = hostArg(payload);
    const create = (payload as { create?: unknown } | null)?.create === true;
    if (create) await createReliefShortcut(host); else removeReliefShortcut(host);
    return { has: hasReliefShortcut(host) };
  });
  handleShared("picker:tailscale-credential", (event) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    return tailscaleCredentialState();
  });
  handleShared("picker:open-url", async (event, payload: unknown) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    const which = String((payload as { which?: unknown } | null)?.which ?? "");
    const url = KNOWN_URLS[which];
    if (url === undefined) throw new Error("página desconhecida");
    await shell.openExternal(url);
  });
  handleShared("picker:open-grokbot-reset", (event) => {
    if (!fromPicker(event)) throw new Error("origem inválida");
    return openGrokbotReset();
  });
  onShared("picker:cancel", (event) => { if (fromPicker(event)) pickerWin?.close(); });
  src.registerIpc(ctx);
}

/** Mostra o seletor (foca se já existe). `error` aparece no topo; `preselect` vence a última máquina. */
export function showPicker(opts: { error?: string; preselect?: string } = {}): void {
  if (opts.error !== undefined) lastError = opts.error;
  if (opts.preselect !== undefined) preselectOverride = opts.preselect;
  pickerMostradoEm = Date.now();
  if (pickerWin !== null && !pickerWin.isDestroyed()) {
    pickerWin.show();
    pickerWin.focus();
    if (!pickerWin.webContents.isLoading()) pickerWin.webContents.send("picker:init", initPayload());
    return;
  }
  // Colado à direita da área útil da tela onde está o cursor, de cima até o Dock, na largura mínima da janela de
  // uma máquina: o seletor e a janela que ele abre têm a mesma largura.
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const win = new BrowserWindow({
    ...posicaoNoCanto(area, MIN_WINDOW_WIDTH),
    minWidth: 460, minHeight: 420, resizable: true,
    title: current().title,
    titleBarStyle: "hiddenInset",
    backgroundColor: backgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "picker-preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false,
    },
  });
  // Zoom isolado em 100%: o zoom da janela principal (Cmd+=) não vaza para esta janela de tamanho fixo.
  win.webContents.setZoomMode("isolated"); win.webContents.setZoomLevel(0);
  pickerWin = win;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  // O título é o do main (nome do app, staging com a versão), não o <title> fixo do picker.html.
  win.on("page-title-updated", (e) => e.preventDefault());
  win.webContents.once("did-finish-load", () => { if (!win.isDestroyed()) win.webContents.send("picker:init", initPayload()); });
  // Ao voltar o foco, se a lista mudou (~/.ssh/config, pessoas: outro app gravou enquanto isso), reenvia; igual, nada.
  win.on("focus", () => { if (JSON.stringify(current().hosts()) !== lastHostsKey) refreshPickerIfOpen(); });
  win.on("closed", () => { if (pickerWin === win) pickerWin = null; });
  void win.loadFile(path.join(__dirname, "..", "..", "renderer", "picker.html"));
}

export const isPickerOpen = (): boolean => pickerWin !== null && !pickerWin.isDestroyed();

/** Reenvia a lista ao seletor aberto (sem focar nem trazer para a frente); fechado, não faz nada. */
export function refreshPickerIfOpen(): void {
  if (pickerWin !== null && !pickerWin.isDestroyed() && !pickerWin.webContents.isLoading()) pickerWin.webContents.send("picker:init", { ...initPayload(), manterSelecao: true });
}
/** Onde o seletor está agora (null = fechado): a janela Produtos do admin se cola à esquerda dele. */
export const pickerBounds = (): Electron.Rectangle | null => (pickerWin !== null && !pickerWin.isDestroyed() ? pickerWin.getBounds() : null);
