/**
 * Atualização automática no molde do Sparkle (Brave) e do updater do Grok Bot, sem assinatura da Apple (o meu-bot é
 * assinado com o certificado próprio "meu-bot local", então o autoUpdater/Squirrel do Electron não serve):
 *
 * - Verifica: 10 s depois de abrir e a cada hora (com jitter), ao voltar a internet, ao acordar o Mac, por
 *   "Verificar agora" e quando o backend da máquina exige uma versão mínima. Consulta a release mais nova do
 *   repositório no GitHub (`escolherRelease`, puro). Uma release que existe e não dá para instalar vira erro
 *   com motivo, nunca "tudo em dia".
 * - Prepara: baixa o `.sig` e o `.zip` desta variante em fluxo, com retomada e progresso (update-download.ts), só
 *   segue se a assinatura Ed25519 confere com uma de UPDATE_PUBLIC_KEYS, extrai em `userData/update/app`, confere
 *   que o app baixado tem a MESMA identidade de assinatura do que está rodando (nunca reassina: o chaveiro amarra
 *   os cookies a ela) e grava `preparada.json`: a versão pronta sobrevive a fechar e abrir o app, sem baixar de novo.
 *   Nada disso trava a janela (processos filhos assíncronos, proc.ts).
 * - Troca: em "Reiniciar e atualizar" (só para a versão que o botão mostrou; reconfirma no GitHub se a última
 *   verificação é velha; espera uma resposta em andamento terminar), sozinha com o Mac ocioso (preferência
 *   "atualizarOcioso") ou, calada, ao sair do app. A versão anterior fica guardada (<app>.antigo) até a nova ficar
 *   30 s de pé; se a nova não passar das primeiras aberturas, volta sozinha; se reabrir na antiga, a troca não
 *   pegou e o app registra e prepara de novo. Só no app empacotado; MEU_BOT_NO_UPDATE=1 desliga.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, powerMonitor } from "electron";
import { log } from "../maquina/backend";
import { anyConversationBusy } from "../conversa/conversation";
import { liveTerminals } from "../terminal/terminal";
import { appTitle, caps, compilacao } from "../app/variant";
import { broadcast, getLastFocusedHost } from "../app/windows";
import { getAtualizarOcioso } from "../app/settings";
import { run, runText } from "../app/proc";
import { baixarComRetomada, DownloadError, semEspacoEmDisco, sha256De } from "./update-download";
import { noteNetworkError } from "../app/net";
import { evento } from "../app/depuracao";
import { offlineMessage } from "../app/net-core";
import {
  abaixoDaMinima, alvosParaTrocar, candidataDe, decideAplicacaoEscolhida, decideInstalarListada, deveVerificarSozinho, listarReleases, parseFixada, podeTrocarComFixada, decideIdentidade, requisitoDeveloperId, assetName, CHECK_EVERY_MS, classificarRespostaFeed, compareVersions, decideAlvoAplicacao, decideFimDaEspera, CONFIRMA_FEED_MS, decideDescarte, decideReaproveitar, decideReconfirmacao, decideReinicioOcioso, decideRollback, escolherRelease, motivoManterTexto, motivoReleaseTexto, OCIOSO_SEG, parsePendente, parsePreparada, parseVersaoMinima,
  destinoDaTroca, pastaSoLeitura, proximaVerificacaoMs, releasesUrl, repararTroca, TENTATIVAS_ATE_VOLTAR, TRAVA_VELHA_MS, travaAbandonada, verificaAssinatura,
  type EscolhaRelease, type EstadoSistema, type ReleaseListada, type UpdateFixada, type UpdateCandidate, type UpdateGatilho, type UpdatePendente, type UpdatePreparada,
} from "./updater-core";

import type { UpdateErrorKind, UpdatePhase, UpdateState, UpdateTrigger } from "../../shared/ipc";

/** Como no Rambox, a verificação aparece logo ao abrir ("verificando atualizações…"), sem concorrer com o túnel. */
const FIRST_CHECK_MS = 10_000;
/** Consulta ao GitHub e download do .sig: limite por pedido (o zip tem o próprio vigia de inatividade). */
const FEED_TIMEOUT_MS = 15_000;
/** Tempo de pé que confirma a versão nova (aí os .antigo saem). */
const CONFIRMA_MS = 30_000;
/** "Reiniciar e atualizar" com uma resposta em andamento: espera até isto por ela; depois reinicia mesmo assim. */
const ESPERA_OCUPADO_MS = 20_000;
/** De quanto em quanto o updater olha se o Mac está ocioso para reiniciar sozinho (só com uma versão pronta). */
const OCIOSO_POLL_MS = 60_000;

/** Falha com a causa para a tela (`errorKind`); as frases são as que a pessoa vê. */
class UpdateFalha extends Error { constructor(public readonly kind: UpdateErrorKind, msg: string) { super(msg); this.name = "UpdateFalha"; } }

const state: UpdateState = { current: app.getVersion(), available: null, ready: null, checking: false, error: null, errorKind: null, phase: "idle", checkedAt: null, progress: null, aguardando: false, ocupadoAoAplicar: false, minima: null, abaixoDaMinima: false, atualizarOcioso: true, fixada: null, buildLocal: false, commit: "", arch: process.arch === "arm64" ? "arm64" : "x64" };
/** A versão preparada em disco (preparada.json); null = nada pronto. */
let preparada: UpdatePreparada | null = null;
let timer: NodeJS.Timeout | null = null;
let ociosoTimer: NodeJS.Timeout | null = null;
/** Verificação em andamento (uma por vez; chamadas simultâneas esperam a mesma). */
let inflight: Promise<void> | null = null;
/** Cancela o download/preparação em curso ao sair. */
let abort: AbortController | null = null;
/** Versão mínima exigida pelo backend de cada máquina que esta sessão abriu; vale a maior. */
const minimaPorHost = new Map<string, string>();
let ligado = false;

export const updateState = (): UpdateState => ({ ...state, atualizarOcioso: getAtualizarOcioso(), fixada: fixada === null ? null : { versao: fixada.versao, por: fixada.por }, buildLocal: compilacao().origem === "local", commit: compilacao().commit, arch: arch() });
/** O que o menu do aplicativo precisa saber: a versão pronta e se dá para pedir uma verificação agora. */
export const updateMenuState = (): { pronta: string | null; podeVerificar: boolean; buildLocal: boolean } => ({
  buildLocal: compilacao().origem === "local",
  pronta: ativo() ? state.ready : null,
  podeVerificar: ativo() && state.phase !== "checking" && state.phase !== "downloading" && state.phase !== "verifying" && state.phase !== "applying",
});
/** A última verificação falhou por falta de internet (a faixa OFFLINE refaz quando a conexão voltar). */
export const lastUpdateErrorWasNetwork = (): boolean => state.phase === "error" && state.errorKind === "rede";
/** Quem mais quer saber que o estado mudou (hoje o menu do app, que precisa se refazer para mostrar o item). */
let aoMudar: (() => void) | null = null;
export const onUpdateState = (cb: () => void): void => { aoMudar = cb; };
function publish(): void { broadcast("update:state", updateState()); aoMudar?.(); }
function setPhase(phase: UpdatePhase): void { state.phase = phase; state.checking = phase === "checking"; if (phase !== "downloading") state.progress = null; if (phase !== "applying") state.aguardando = false; publish(); }

/** Desfecho legível por máquina, no mesmo barramento das outras ações do main: "por que a atualização não pegou". */
const registrar = (rota: string, ok: boolean, resumo: string, detalhe?: unknown): void => { evento({ origem: "atualizacao", dono: null, rota, ok, ms: null, resumo, detalhe }); };
const erroTexto = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const arch = (): "arm64" | "x64" => (process.arch === "arm64" ? "arm64" : "x64");
const updateDir = (): string => path.join(app.getPath("userData"), "update");
const preparadaFile = (): string => path.join(updateDir(), "preparada.json");
/** Fora de updateDir (a troca apaga a pasta): o registro da troca que ainda precisa provar que abre. */
const pendenteFile = (): string => path.join(app.getPath("userData"), "update-pendente.json");
const gravarJson = (f: string, v: unknown): void => { const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 }); fs.renameSync(tmp, f); };
/** O .app que está rodando: …/X.app/Contents/MacOS/x → …/X.app. null fora de um bundle (dev). */
function runningBundle(): string | null {
  const b = path.resolve(process.execPath, "..", "..", "..");
  return b.endsWith(".app") && fs.existsSync(path.join(b, "Contents", "Info.plist")) ? b : null;
}
const plistSync = (bundle: string, key: string): string | null => {
  try { return execFileSync("plutil", ["-extract", key, "raw", "-o", "-", path.join(bundle, "Contents", "Info.plist")], { encoding: "utf8" }).trim(); } catch { return null; }
};
const plist = async (bundle: string, key: string): Promise<string | null> => { try { return await runText("plutil", ["-extract", key, "raw", "-o", "-", path.join(bundle, "Contents", "Info.plist")], { timeoutMs: 10_000 }); } catch { return null; } };
/** Designated requirement da assinatura de um .app (`codesign -d -r-`): a identidade que o chaveiro reconhece. */
const requisito = async (bundle: string): Promise<string | null> => {
  try { const r = await run("codesign", ["-d", "-r-", bundle], { timeoutMs: 60_000 }); return /designated => (.+)/.exec(`${r.stdout}\n${r.stderr}`)?.[1]?.trim() ?? null; } catch { return null; }
};
/**
 * `MEU_BOT_NO_UPDATE=1` desliga o atualizador. A troca para uma versão fixada pelo super admin reinicia com ele e com
 * `MEU_BOT_NO_UPDATE_MOTIVO=fixada`: uma versão anterior a este recurso só entende o primeiro e fica parada na
 * sessão; esta entende os dois e segue ligada (a fixação dela vem do arquivo).
 */
const desligadoPorAmbiente = (): boolean => process.env.MEU_BOT_NO_UPDATE === "1" && process.env.MEU_BOT_NO_UPDATE_MOTIVO !== "fixada";
const ativo = (): boolean => app.isPackaged && !desligadoPorAmbiente() && runningBundle() !== null;

/* ---------- versão fixada (super admin) ---------- */

const fixadaFile = (): string => path.join(app.getPath("userData"), "update-fixada.json");
let fixada: UpdateFixada | null = null;
const versaoFixada = (): string | null => fixada?.versao ?? null;
function lerFixada(): void {
  try { fixada = parseFixada(JSON.parse(fs.readFileSync(fixadaFile(), "utf8"))); } catch { fixada = null; }
  // Aberto noutra versão que não a fixada: a anterior a este recurso se atualizou sozinha ao ser reaberta, ou a troca
  // não pegou. A fixação não segurou; mantê-la deixaria o app parado numa versão que ninguém escolheu.
  if (fixada !== null && fixada.versao !== state.current) {
    log(`[atualização] a versão fixada era a ${fixada.versao}, mas abriu a ${state.current}: soltei a fixação`);
    registrar("fixar", false, "a fixação não segurou", { fixada: fixada.versao, aberta: state.current });
    soltarArquivoFixada();
  }
}
function soltarArquivoFixada(): void { fixada = null; try { fs.rmSync(fixadaFile(), { force: true }); } catch { /* ok */ } }

/* ---------- ciclo de vida ---------- */

/** Liga as verificações (só empacotado) e, antes, confirma ou desfaz a troca da abertura anterior e reaproveita a versão preparada. */
export function initUpdater(): void {
  if (!app.isPackaged || runningBundle() === null) return;
  conferirPendente();
  if (desligadoPorAmbiente()) return;
  // Vieram da troca para a versão fixada: não passam adiante para os próximos reinícios.
  if (process.env.MEU_BOT_NO_UPDATE_MOTIVO === "fixada") { delete process.env.MEU_BOT_NO_UPDATE; delete process.env.MEU_BOT_NO_UPDATE_MOTIVO; }
  lerFixada();
  ligado = true;
  void reaproveitarPreparada().finally(() => { agendar(FIRST_CHECK_MS, "inicio"); });
  ociosoTimer = setInterval(() => { void tentarReinicioOcioso(); }, OCIOSO_POLL_MS);
  ociosoTimer.unref();
  // A tela bloqueou: boa hora para trocar, se há versão pronta e nada em andamento.
  powerMonitor.on("lock-screen", () => { void tentarReinicioOcioso(); });
}
export function disposeUpdater(): void {
  ligado = false;
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (ociosoTimer !== null) { clearInterval(ociosoTimer); ociosoTimer = null; }
  abort?.abort();
}
function agendar(ms: number, trigger: UpdateTrigger): void {
  if (timer !== null) clearTimeout(timer);
  if (!ligado) return;
  timer = setTimeout(() => { timer = null; void check(trigger); }, ms);
  timer.unref();
}

/* ---------- verificar ---------- */

/** "Verificar agora" e os gatilhos de fora do ciclo: devolve o estado ao fim (ou o atual, se já está verificando). */
export async function checkNow(trigger: UpdateTrigger = "explicito"): Promise<UpdateState> {
  if (!ativo()) return updateState();
  await check(trigger);
  return updateState();
}
/**
 * "Atualizar agora" (Configurações › Sobre e atualização): verifica, baixa e reinicia num clique, para quem não quer
 * esperar o ciclo (no staging a faixa de cima não aparece). Só vai para a mais nova da release, nunca para trás; com
 * uma resposta em andamento, cai no mesmo "Parar e atualizar" do botão de aplicar. Devolve o estado quando não reinicia.
 */
export async function atualizarAgora(): Promise<UpdateState> {
  if (!ativo()) return updateState();
  if (state.phase === "applying") return updateState();
  // Pedir a mais nova é a intenção explícita de sair da versão fixada.
  if (fixada !== null) { log(`[atualização] "Atualizar agora" solta a fixação na ${fixada.versao}`); soltarArquivoFixada(); publish(); }
  await check("atualizar-agora");
  if (state.phase !== "ready" || state.ready === null) {
    registrar("atualizar-agora", state.phase === "up-to-date", state.phase === "up-to-date" ? "já na mais recente" : (state.error ?? state.phase));
    return updateState();
  }
  log(`[atualização] "Atualizar agora": reiniciando na ${state.ready}`);
  await applyUpdate(state.ready, "clique");
  return updateState();
}
/* ---------- versões publicadas (super admin) ---------- */

/** Lista do GitHub em cache por 1 min: abrir e fechar a seção não gasta as 60 consultas/hora sem token. */
let listaCache: { em: number; itens: ReleaseListada[] } | null = null;
const LISTA_CACHE_MS = 60_000;
/** Quem pode usar: conferido no main, com o papel relido do servidor (GET /conta) na hora. */
let exigeSuper: () => Promise<string> = () => Promise.reject(new Error("só um super admin pode escolher a versão"));
export const onExigeSuper = (fn: () => Promise<string>): void => { exigeSuper = fn; };
/** Antes de voltar para uma versão mais velha: guarda as configurações que ela apagaria (settings.ts restaura na volta). */
let antesDeVoltar: (de: string) => void = () => undefined;
export const onAntesDeVoltar = (fn: (de: string) => void): void => { antesDeVoltar = fn; };

export async function releasesPublicadas(forcar = false): Promise<ReleaseListada[]> {
  await exigeSuper();
  if (!ativo()) throw new Error("a escolha de versão só funciona no app instalado");
  if (!forcar && listaCache !== null && Date.now() - listaCache.em < LISTA_CACHE_MS) return listaCache.itens;
  const res = await fetch("https://api.github.com/repos/diegofornalha/meu-bot/releases?per_page=30", { headers: { "User-Agent": `${appTitle()}/${state.current}`, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
  const r = classificarRespostaFeed(res.status, res.headers.get("x-ratelimit-remaining"), res.headers.get("x-ratelimit-reset"));
  if (r.tipo === "falha") throw new Error(r.msg);
  const corpo: unknown = r.tipo === "sem-release" ? [] : await res.json();
  const itens = listarReleases(corpo, { app: appTitle(), arch: arch(), current: state.current, canal: caps().canal, minima: state.minima });
  listaCache = { em: Date.now(), itens };
  return itens;
}

/**
 * "Instalar esta" (super admin): fixa a versão escolhida, baixa e confere como qualquer atualização (assinatura,
 * bundle id, codesign) e troca. Mais velha inclusive: é o único caminho para trás, e as configurações que ela não
 * conhece ficam guardadas para voltar. Com uma resposta em andamento, cai no "Parar e atualizar" de sempre.
 */
export async function instalarVersao(versao: string): Promise<UpdateState> {
  const email = await exigeSuper();
  if (!ativo()) throw new Error("a escolha de versão só funciona no app instalado");
  if (state.phase === "applying") throw new Error("já há uma troca em andamento");
  const d = decideInstalarListada((await releasesPublicadas(true)).find((l) => l.versao === versao));
  if (d.tipo === "recusar") { registrar("escolher-versao", false, d.motivo, { versao }); throw new Error(d.motivo); }
  if (inflight !== null) await inflight;
  abort?.abort();
  const anterior = fixada;
  fixada = { versao, por: email, em: new Date().toISOString() };
  gravarJson(fixadaFile(), fixada);
  log(`[atualização] ${email} escolheu a ${versao} (instalada: ${state.current}): versão fixada`);
  registrar("escolher-versao", true, `fixada na ${versao}`, { de: state.current, por: email });
  const ac = new AbortController(); abort = ac;
  try {
    state.error = null; state.errorKind = null; state.available = versao;
    if (preparada !== null && preparada.para !== versao) limparPreparada();
    if (preparada === null) { setPhase("available"); await preparar(d.candidata, ac.signal); }
    setPhase("ready");
  } catch (e) {
    // Não deu para preparar: a fixação volta a ser a de antes (ou nenhuma) para o app não ficar parado à toa.
    fixada = anterior; if (anterior === null) soltarArquivoFixada(); else gravarJson(fixadaFile(), anterior);
    const f = await classificar(e); state.error = f.msg; state.errorKind = f.kind; setPhase("error");
    registrar("escolher-versao", false, f.msg, { versao });
    throw new Error(f.msg);
  } finally { if (abort === ac) abort = null; }
  if (compareVersions(versao, state.current) < 0) {
    try { antesDeVoltar(state.current); } catch (e) { log(`[atualização] não guardei as configurações antes de voltar: ${erroTexto(e)}`); }
  }
  // Uma versão anterior a este recurso não lê update-fixada.json: sem isto ela se atualizaria sozinha ao abrir.
  process.env.MEU_BOT_NO_UPDATE = "1"; process.env.MEU_BOT_NO_UPDATE_MOTIVO = "fixada";
  await applyUpdate(versao, "clique");
  return updateState();
}

/** "Voltar a atualizar sozinho": solta a versão fixada e verifica na hora. */
export async function soltarFixada(): Promise<UpdateState> {
  if (fixada === null) return updateState();
  log(`[atualização] fixação na ${fixada.versao} solta`);
  registrar("fixar", true, "solta", { versao: fixada.versao });
  soltarArquivoFixada(); publish();
  return checkNow("explicito");
}

/** Ao acordar o Mac ou voltar a internet: só se a última verificação ficou velha (o ciclo normal cobre o resto). */
export function checkIfStale(trigger: UpdateTrigger): void {
  if (!ativo() || !ligado) return;
  const idade = state.checkedAt === null ? Number.POSITIVE_INFINITY : Date.now() - Date.parse(state.checkedAt);
  if (idade >= CHECK_EVERY_MS) void check(trigger);
}

function check(trigger: UpdateTrigger): Promise<void> {
  if (inflight !== null) return inflight;
  // Versão fixada pelo super admin: o ciclo não consulta; o pedido explícito consulta e só mostra (não prepara).
  if (!deveVerificarSozinho(versaoFixada(), trigger)) { agendar(proximaVerificacaoMs(), "periodico"); return Promise.resolve(); }
  inflight = (async () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    state.error = null; state.errorKind = null; setPhase("checking");
    log(`[atualização] verificando (${trigger})`);
    const ac = new AbortController(); abort = ac;
    try {
      const escolha = await consultarFeed(ac.signal);
      state.checkedAt = new Date().toISOString();
      if (escolha.tipo === "inutilizavel") {
        // Achamos uma release e não dá para instalar. Nunca anunciar "tudo em dia" por causa disso: era assim que o
        // app parava de atualizar calado. Uma preparada já conferida continua valendo e segue oferecida.
        state.error = motivoReleaseTexto(escolha.versao, escolha.motivo); state.errorKind = "release";
        state.available = escolha.versao;
        log(`[atualização] ${state.error}`);
        registrar("verificar", false, state.error, { motivo: escolha.motivo, versao: escolha.versao, trigger });
        setPhase(preparada !== null ? "ready" : "error");
        return;
      }
      const cand = candidataDe(escolha);
      if (cand === null) {
        // Nada mais novo que a instalada: uma preparada que sobrou foi retirada do ar (ou é a própria versão de agora).
        if (preparada !== null) { log(`[atualização] a ${preparada.para} não está mais na release: descartada`); limparPreparada(); }
        state.available = null; registrar("verificar", true, "nada mais novo", { trigger }); setPhase("up-to-date"); return;
      }
      state.available = cand.version;
      if (fixada !== null) { registrar("verificar", true, `há a ${cand.version}, mas a versão está fixada na ${fixada.versao}`, { trigger }); setPhase("up-to-date"); return; }
      if (preparada !== null && preparada.para === cand.version) { setPhase("ready"); return; }
      if (preparada !== null) { log(`[atualização] ${preparada.para} preparada, mas a release oferece ${cand.version}: preparando a nova`); limparPreparada(); }
      setPhase("available");
      await preparar(cand, ac.signal);
      setPhase("ready");
    } catch (e) {
      if (ac.signal.aborted) { setPhase(preparada !== null ? "ready" : "idle"); return; }
      const f = await classificar(e);
      // Disco cheio: o que já baixou e extraiu tem que sair, senão a tentativa seguinte encontra menos espaço ainda.
      if (f.kind === "disco") { limparPreparada(); log("[atualização] apaguei o que já tinha baixado para liberar espaço"); }
      state.error = f.msg; state.errorKind = f.kind;
      log(`[atualização] ${f.msg}`);
      registrar("verificar", false, f.msg, { kind: f.kind, trigger });
      setPhase("error");
    } finally {
      if (abort === ac) abort = null;
      agendar(proximaVerificacaoMs(), "periodico");
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

async function consultarFeed(signal: AbortSignal): Promise<EscolhaRelease> {
  const res = await fetch(releasesUrl(caps().canal), { headers: { "User-Agent": `${appTitle()}/${state.current}`, Accept: "application/vnd.github+json" }, signal: AbortSignal.any([signal, AbortSignal.timeout(FEED_TIMEOUT_MS)]) });
  const r = classificarRespostaFeed(res.status, res.headers.get("x-ratelimit-remaining"), res.headers.get("x-ratelimit-reset"));
  if (r.tipo === "sem-release") return { tipo: "nada-novo" }; // o repositório ainda não publicou: a instalada é a mais recente
  if (r.tipo === "falha") throw new UpdateFalha("github", r.msg);
  let corpo: unknown;
  // Corpo que não é JSON (portal de rede cativa, página de erro do proxy) não é falha de conexão: dizer o que é.
  try { corpo = await res.json(); } catch { throw new UpdateFalha("release", "o servidor de atualização respondeu algo que não consegui entender"); }
  return escolherRelease(corpo, { app: appTitle(), arch: arch(), current: state.current, canal: caps().canal });
}

/** Sem internet, a culpa não é do GitHub nem do app: a frase diz isso (e a volta da rede refaz a checagem). */
async function classificar(e: unknown): Promise<{ kind: UpdateErrorKind; msg: string }> {
  if (e instanceof UpdateFalha) return { kind: e.kind, msg: e.message };
  // Antes da rede: um disco cheio não é queda de conexão, e dizer "sem internet" manda a pessoa para o lugar errado.
  if (semEspacoEmDisco(e)) return { kind: "disco", msg: `não há espaço em disco para a atualização${espacoLivreTexto()}` };
  if (e instanceof DownloadError) return { kind: "download", msg: e.message };
  if (await noteNetworkError(e)) return { kind: "rede", msg: offlineMessage("update") };
  const msg = erroTexto(e);
  return { kind: /download|conexão/i.test(msg) ? "download" : "outro", msg };
}

/** Quanto sobra no disco do userData, para a frase do disco cheio dizer algo útil; vazio se não der para ler. */
function espacoLivreTexto(): string {
  try {
    const st = fs.statfsSync(app.getPath("userData"));
    return `; restam ${(Number(st.bavail) * Number(st.bsize) / 1e9).toFixed(1)} GB livres`;
  } catch { return ""; }
}

/* ---------- preparar ---------- */

const baixarTexto = async (url: string, signal: AbortSignal): Promise<string> => {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": `${appTitle()}/${state.current}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(FEED_TIMEOUT_MS)]) });
  if (!res.ok) throw new DownloadError(`download falhou (${res.status})`);
  return await res.text();
};

/**
 * Baixa o .sig e o .zip, só extrai se a assinatura Ed25519 conferir, e só dá por pronto se o app extraído for desta
 * variante, desta versão e com a mesma identidade de assinatura do app em execução (fail-closed: nada é reassinado).
 * Um download interrompido da mesma versão retoma do `.partial`.
 */
async function preparar(cand: UpdateCandidate, signal: AbortSignal): Promise<void> {
  const dir = updateDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Sobras de outra versão saem; o .partial/.resume desta versão fica para retomar.
  for (const f of fs.readdirSync(dir)) if (!f.startsWith(cand.asset.name)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  const zip = path.join(dir, cand.asset.name);
  // O .sig primeiro: pequeno, e sem ele não há o que baixar.
  const sig = await baixarTexto(cand.sig.url, signal);
  log(`[atualização] baixando ${cand.asset.name}`);
  state.progress = null; setPhase("downloading");
  let ultimo = -1;
  const { sha256, retomadas } = await baixarComRetomada({
    url: cand.asset.url, destino: zip, tamanho: cand.asset.size, signal, headers: { "User-Agent": `${appTitle()}/${state.current}` },
    onProgress: (recebido, total) => {
      if (total === null || total <= 0) return;
      const p = Math.min(1, recebido / total);
      if (p - ultimo >= 0.01) { ultimo = p; state.progress = p; publish(); }
    },
  });
  if (retomadas > 0) log(`[atualização] download retomado ${retomadas}x`);
  setPhase("verifying");
  const stageDir = path.join(dir, "app");
  const bundle = path.join(stageDir, `${appTitle()}.app`);
  try {
    // Ed25519 do Node não é por hash: o zip entra em memória uma vez, aqui, e é liberado em seguida.
    if (!verificaAssinatura(fs.readFileSync(zip), sig)) throw new UpdateFalha("assinatura", "a assinatura da atualização não confere: descartada");
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir);
    await run("ditto", ["-x", "-k", zip, stageDir], { timeoutMs: 300_000 });
    if (!fs.existsSync(path.join(bundle, "Contents", "Info.plist"))) throw new UpdateFalha("assinatura", "o .zip não traz o app esperado");
    const v = await plist(bundle, "CFBundleShortVersionString");
    if (v !== cand.version) throw new UpdateFalha("assinatura", `o app baixado diz ${v ?? "?"}, a release diz ${cand.version}`);
    await conferirBundle(bundle);
  } catch (e) {
    // Zip ou app inválidos: não adianta insistir no mesmo arquivo; a próxima verificação baixa de novo.
    if (e instanceof UpdateFalha) fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  const em = new Date().toISOString();
  gravarJson(preparadaFile(), { versao: 1, para: cand.version, bundle, sha256, em } satisfies UpdatePreparada);
  // O zip FICA. Ele é a única prova de que o .app extraído veio da release que a assinatura Ed25519 conferiu: entre
  // uma sessão e outra o bundle fica em userData, e sem o zip a reabertura só teria a plist e o codesign para
  // conferir. A pasta inteira some na troca (ou em limparPreparada), então isto ocupa disco só enquanto há
  // atualização pendente de instalar.
  preparada = { versao: 1, para: cand.version, bundle, sha256, em };
  state.ready = cand.version;
  log(`[atualização] ${cand.version} pronta em ${bundle}`);
  registrar("preparar", true, `${cand.version} pronta`, { sha256, retomadas });
}

/** O .app extraído é desta variante, íntegro e assinado pela mesma identidade do app em execução (senão lança). */
async function conferirBundle(bundle: string): Promise<void> {
  const mine = runningBundle();
  if (mine !== null && (await plist(bundle, "CFBundleIdentifier")) !== (await plist(mine, "CFBundleIdentifier"))) throw new UpdateFalha("assinatura", "o app baixado é de outra variante");
  // A quarentena sai: o zip já passou pela assinatura Ed25519, e um app sem Developer ID (as releases até a troca) o
  // Gatekeeper bloquearia. A assinatura de código fica como veio do release.
  await run("xattr", ["-dr", "com.apple.quarantine", bundle], { timeoutMs: 60_000 }).catch(() => undefined);
  try { await run("codesign", ["--verify", "--deep", "--strict", bundle], { timeoutMs: 300_000 }); } catch { throw new UpdateFalha("assinatura", "o app baixado não tem uma assinatura de código íntegra"); }
  const dele = await requisito(bundle), meu = mine === null ? null : await requisito(mine);
  const ehDeveloperId = dele !== null && dele !== meu && await run("codesign", ["--verify", `-R=${requisitoDeveloperId()}`, bundle], { timeoutMs: 300_000 }).then(() => true, () => false);
  const decisao = decideIdentidade(dele, meu, ehDeveloperId);
  if (decisao === "recusa") throw new UpdateFalha("assinatura", "o app baixado é assinado por outra identidade: descartado");
  if (decisao === "developer-id") log("[updater] o app baixado é assinado com Developer ID da Apple: troca de identidade aceita (uma vez)");
}

/** Na abertura: a versão preparada da sessão anterior ainda vale? Reconfere a integridade e já fica "pronta", sem baixar. */
async function reaproveitarPreparada(): Promise<void> {
  let lido: unknown;
  try { lido = JSON.parse(fs.readFileSync(preparadaFile(), "utf8")); } catch { return; } // nada preparado: o normal
  const uso = decideReaproveitar(parsePreparada(lido), state.current, (b) => fs.existsSync(path.join(b, "Contents", "Info.plist")), versaoFixada());
  if (uso.tipo === "descartar") { log(`[atualização] descartei o que estava preparado: ${motivoPreparadaTexto(uso.motivo)}`); limparPreparada(); return; }
  const p = uso.preparada;
  try {
    await conferirConteudo(p);
    await conferirBundle(p.bundle);
    preparada = p; state.ready = p.para; state.available = p.para;
    log(`[atualização] ${p.para} já estava preparada: pronta para instalar`);
    registrar("reaproveitar", true, `${p.para} preparada e reconferida`);
    setPhase("ready");
  } catch (e) {
    log(`[atualização] a ${p.para} preparada não passou na conferência (${erroTexto(e)}): descartada`);
    registrar("reaproveitar", false, erroTexto(e), { versao: p.para });
    limparPreparada();
  }
}

/**
 * O .app preparado veio mesmo da release que a assinatura conferiu? Refaz o sha256 do zip guardado e compara com o
 * manifesto. O zip some junto com a pasta na troca, então "sumiu" quer dizer que alguém mexeu ali: baixar de novo.
 */
async function conferirConteudo(p: UpdatePreparada): Promise<void> {
  const zip = path.join(updateDir(), assetName(appTitle(), p.para, arch()));
  if (!fs.existsSync(zip)) throw new UpdateFalha("assinatura", "o arquivo de onde o app foi extraído não está mais lá");
  const { sha256 } = await sha256De(zip);
  if (sha256 !== p.sha256) throw new UpdateFalha("assinatura", "o arquivo baixado não bate com o que foi conferido na hora do download");
}
const motivoPreparadaTexto = (m: "ilegivel" | "nao-e-mais-nova" | "sumiu"): string =>
  m === "ilegivel" ? "o registro não está íntegro" : m === "nao-e-mais-nova" ? "não é mais nova que a instalada" : "a pasta do app preparado sumiu";
function limparPreparada(): void {
  preparada = null; state.ready = null;
  try { fs.rmSync(updateDir(), { recursive: true, force: true }); } catch { /* cortesia */ }
}

/* ---------- trocar ---------- */

/**
 * "Reiniciar e atualizar" (gatilho "clique") e o reinício ocioso: só para a versão que a tela mostrou; se a última
 * verificação é velha, reconfirma no GitHub antes (release retirada = nada muda); espera uma resposta em andamento
 * terminar (até 20 s no clique; o ocioso já exige nada em andamento). Troca os .app e reabre na mesma máquina.
 */
export async function applyUpdate(expectedVersion: string, gatilho: Exclude<UpdateGatilho, "saida">, forcar = false): Promise<void> {
  if (inflight !== null) await inflight; // uma verificação no meio pode ter trocado a versão pronta
  if (preparada === null || state.ready === null) throw new Error("não há atualização pronta");
  // A versão que o super admin escolheu (fixada) pode ser mais velha: só precisa ser exatamente a pedida, e a release
  // não é reconsultada (para trás ela nunca "ofereceria" esta). A assinatura e o codesign já foram conferidos.
  const escolhida = fixada !== null && state.ready === fixada.versao;
  // Se ficou pronta uma versão MAIS NOVA entre o clique e agora, o diálogo acompanha em vez de recusar: é a mesma
  // intenção, e a nova já passou pela assinatura e pelo codesign. Para trás, não.
  const alvo = escolhida ? decideAplicacaoEscolhida(expectedVersion, state.ready) : decideAlvoAplicacao(expectedVersion, state.ready);
  if (alvo.tipo === "recusar") { registrar("aplicar", false, alvo.motivo, { pedida: expectedVersion, pronta: state.ready }); throw new Error(alvo.motivo); }
  if (alvo.trocou) log(`[atualização] você pediu a ${expectedVersion} e a ${alvo.versao} ficou pronta no meio: sigo na mais nova`);
  const expectedVersao = alvo.versao;
  if (state.phase === "applying") return;
  const idade = state.checkedAt === null ? Number.POSITIVE_INFINITY : Date.now() - Date.parse(state.checkedAt);
  if (!escolhida && idade > CONFIRMA_FEED_MS) {
    // Reconfirma só a release (sem preparar outra): retirada do ar, nada muda; sem internet, a preparada já conferida vale.
    let escolha: EscolhaRelease | null = null;
    try { escolha = await consultarFeed(new AbortController().signal); state.checkedAt = new Date().toISOString(); } catch (e) { log(`[atualização] não deu para reconfirmar no GitHub (${erroTexto(e)}); sigo com a ${expectedVersion} já conferida`); }
    // Só uma resposta conclusiva retira a preparada do ar: um feed que não deu para ler não descarta o que já conferimos.
    const r = decideReconfirmacao(escolha, expectedVersion);
    if (r.tipo === "ilegivel") log(`[atualização] a reconfirmação não deu para ler (${r.motivo}); sigo com a ${expectedVersion} já conferida`);
    if (r.tipo === "retirada") { log(`[atualização] a ${expectedVersion} foi retirada da release: descartada`); limparPreparada(); state.available = r.agora; setPhase("up-to-date"); throw new Error("A atualização foi retirada do ar; nada foi mudado."); }
  }
  setPhase("applying");
  state.ocupadoAoAplicar = false;
  if (gatilho === "clique" && anyConversationBusy()) {
    state.aguardando = true; publish();
    const fim = Date.now() + ESPERA_OCUPADO_MS;
    while (anyConversationBusy() && Date.now() < fim) await new Promise((r) => setTimeout(r, 500));
    state.aguardando = false;
    // Esgotou a espera e o bot continua respondendo. Antes o app reiniciava por cima da conversa sem avisar; agora
    // a escolha de interromper é de quem está usando, e só o clique dela ("Parar e atualizar") chega aqui forçando.
    if (decideFimDaEspera(anyConversationBusy(), forcar) === "perguntar") {
      state.ocupadoAoAplicar = true;
      setPhase("ready");
      log(`[atualização] a ${expectedVersao} está pronta, mas há resposta em andamento: deixei a escolha com a pessoa`);
      registrar("aplicar", false, "resposta em andamento: esperando a pessoa decidir", { versao: expectedVersao });
      return;
    }
    if (forcar) log("[atualização] a pessoa escolheu parar o trabalho em andamento para atualizar");
    publish();
  }
  let mine: string;
  try { mine = swapBundles(gatilho); } catch (e) {
    const ro = pastaSoLeitura(e); setPhase(ro ? "needs-move" : "ready");
    registrar("trocar", false, ro ? "pasta só de leitura" : erroTexto(e), { versao: expectedVersao, gatilho });
    throw ro ? new Error("Esta conta do Mac não tem permissão para trocar o app: ele está numa pasta protegida e a pasta Aplicativos também não aceita a cópia. Atualize por uma conta de administrador do Mac.") : e;
  }
  registrar("trocar", true, `trocado para a ${expectedVersao}`, { gatilho, forcado: forcar });
  relancar(mine);
}

/**
 * Item do botão "Mover para Aplicativos" quando o app está numa pasta sem escrita (a imagem do instalador, Downloads
 * de outro usuário): copia o bundle para /Applications e reabre de lá. A cópia de origem fica onde está — numa imagem
 * montada não dá para apagá-la, e numa pasta qualquer apagar o arquivo de alguém não é decisão do app.
 */
export async function moverParaAplicativos(): Promise<void> {
  const mine = runningBundle();
  if (mine === null) throw new Error("fora de um .app");
  const destino = path.join("/Applications", path.basename(mine));
  if (path.resolve(mine) === destino) throw new Error("o app já está na pasta Aplicativos");
  if (fs.existsSync(destino)) throw new Error(`Já existe um ${path.basename(mine)} na pasta Aplicativos. Abra aquele, ou apague-o antes de mover este.`);
  log(`[atualização] movendo ${mine} para ${destino}`);
  try {
    await run("ditto", [mine, destino], { timeoutMs: 300_000 });
    // Sem Developer ID, a quarentena faria o Gatekeeper barrar o app na primeira abertura a partir de /Applications.
    await run("xattr", ["-dr", "com.apple.quarantine", destino], { timeoutMs: 60_000 }).catch(() => undefined);
  } catch (e) {
    fs.rmSync(destino, { recursive: true, force: true });
    registrar("mover", false, erroTexto(e), { destino });
    throw new Error(`Não consegui copiar o app para a pasta Aplicativos: ${erroTexto(e)}`);
  }
  registrar("mover", true, `copiado para ${destino}`, { de: mine });
  log(`[atualização] cópia pronta em ${destino}; a de ${path.dirname(mine)} continua lá`);
  relancar(destino);
}
/** Reabre o app já na versão nova, na mesma máquina que a pessoa estava (sem `--host`, o seletor abre). */
/**
 * O que o `will-quit` faz e precisa acontecer antes da troca também: `app.exit` sai SEM emitir `will-quit`, e o
 * backend local (filho do app) sobrevivia segurando a porta, com o app reaberto dizendo "a porta já está em uso".
 * O main.ts registra (fechar túnel, backend local e proxy); aqui não se importa o túnel para não fechar um ciclo.
 */
let antesDeRelancar: (() => void) | null = null;
export const onAntesDeRelancar = (cb: () => void): void => { antesDeRelancar = cb; };
function relancar(mine: string): void {
  try { antesDeRelancar?.(); } catch (e) { log(`[atualização] limpeza antes de reiniciar falhou: ${erroTexto(e)}`); }
  const host = getLastFocusedHost();
  app.relaunch({ execPath: path.join(mine, "Contents", "MacOS", path.basename(process.execPath)), args: host === null ? [] : [`--host=${host}`] });
  app.exit(0);
}

/**
 * Troca os .app instalados pelo preparado: o que está rodando e as cópias em ~/Applications e na mesa (mesmo bundle
 * id). Cada anterior fica como <app>.antigo e o registro em update-pendente.json ("pedida" antes de mexer, "trocada"
 * depois), até a nova provar que abre. Síncrono de propósito: acontece imediatamente antes de o app sair.
 */
function swapBundles(gatilho: UpdateGatilho): string {
  if (preparada === null) throw new Error("não há atualização pronta");
  const rodando = runningBundle();
  if (rodando === null) throw new Error("fora de um .app");
  // Pré-voo: a troca renomeia o .app, então basta escrita na PASTA dele (um .app de outra conta de administrador em
  // /Applications troca normalmente). Sem ela (imagem do instalador, pasta de outro usuário), vai para /Applications.
  const naAplicativos = path.join("/Applications", path.basename(rodando));
  const destino = destinoDaTroca({
    pastaGravavel: gravavel(path.dirname(rodando)),
    emAplicativos: path.resolve(rodando) === naAplicativos,
    aplicativosGravavel: gravavel("/Applications"),
    copiaEmAplicativos: fs.existsSync(naAplicativos),
  });
  if (destino === "sem-permissao") { const e = new Error("sem escrita na pasta do app nem em /Applications") as Error & { code: string }; e.code = "EACCES"; throw e; }
  if (destino === "instalar") return instalarEmAplicativos(rodando, naAplicativos, gatilho);
  const mine = destino === "aplicativos" ? naAplicativos : rodando;
  if (destino === "aplicativos") log(`[atualização] ${rodando} está numa pasta protegida: atualizo a cópia de ${naAplicativos} e reabro por ela`);
  // A trava de instância única do Electron é por userData, ou seja, por usuário do Mac. Com troca rápida de
  // usuário, duas sessões chegam aqui para a MESMA pasta Aplicativos. Esta trava é entre processos e mora ao lado
  // do alvo, no único lugar que as duas sessões enxergam e onde já sabemos que dá para escrever.
  const soltar = pegarTrava(mine);
  if (soltar === null) throw new Error("outra sessão deste Mac está trocando o app agora; tente de novo em instantes.");
  try { return trocarAlvos(mine, gatilho); } finally { soltar(); }
}

const gravavel = (p: string): boolean => { try { fs.accessSync(p, fs.constants.W_OK); return true; } catch { return false; } };

/**
 * O app roda de uma pasta protegida (imagem do instalador, Downloads de outro usuário) e não há cópia em /Applications:
 * a versão nova, já conferida, vai direto para lá e o app reabre de lá. A cópia de origem fica onde está (numa imagem
 * montada não dá para apagar). Sem `.antigo`: não há versão anterior em /Applications para voltar.
 */
function instalarEmAplicativos(origem: string, destino: string, gatilho: UpdateGatilho): string {
  if (preparada === null) throw new Error("não há atualização pronta");
  const fresh = `${destino}.novo`;
  fs.rmSync(fresh, { recursive: true, force: true });
  try {
    execFileSync("ditto", [preparada.bundle, fresh]);
    try { execFileSync("xattr", ["-dr", "com.apple.quarantine", fresh]); } catch { /* sem quarentena: nada a tirar */ }
    fs.renameSync(fresh, destino);
  } catch (e) { fs.rmSync(fresh, { recursive: true, force: true }); throw e; }
  log(`[atualização] ${origem} estava numa pasta protegida: instalei a ${preparada.para} em ${destino} e reabro por lá (${gatilho})`);
  fs.rmSync(updateDir(), { recursive: true, force: true });
  preparada = null; state.ready = null;
  return destino;
}

/**
 * Trava entre processos para mexer nos .app, ao lado do .app em execução. `mkdir` é atômico: quem criar o diretório
 * ganha. Não usa o temporário do sistema porque no macOS ele é privado por usuário, que é exatamente o caso a cobrir.
 * Vale para a troca e também para o descarte e a volta atrás, que mexem nos mesmos `<app>.antigo`.
 * Devolve como soltar, ou null se outra sessão está com ela.
 */
function pegarTrava(bundle: string): (() => void) | null {
  const trava = path.join(path.dirname(bundle), `.${path.basename(bundle)}.troca`);
  try { fs.mkdirSync(trava); } catch (e) {
    if ((e as { code?: string }).code !== "EEXIST") throw e;
    let idade = Number.NaN;
    try { idade = Date.now() - fs.statSync(trava).mtimeMs; } catch { /* sumiu entre o mkdir e o stat: tenta pegar */ }
    if (!travaAbandonada(idade)) return null;
    log(`[atualização] trava de troca parada há ${Number.isFinite(idade) ? `${Math.round(idade / 60_000)} min` : "não sei quanto tempo"} (limite ${TRAVA_VELHA_MS / 60_000} min): assumindo que a sessão dona morreu`);
    try { fs.rmSync(trava, { recursive: true, force: true }); fs.mkdirSync(trava); } catch { return null; }
  }
  try { fs.writeFileSync(path.join(trava, "quem"), `${process.pid} ${new Date().toISOString()}\n`, { mode: 0o600 }); } catch { /* cortesia */ }
  return () => { try { fs.rmSync(trava, { recursive: true, force: true }); } catch { /* cortesia */ } };
}

/** Roda `f` com a trava dos .app na mão; devolve false sem fazer nada se outra sessão está mexendo agora. */
function comTrava(bundle: string, oQue: string, f: () => void): boolean {
  let soltar: (() => void) | null = null;
  try { soltar = pegarTrava(bundle); } catch (e) { log(`[atualização] não consegui a trava para ${oQue}: ${erroTexto(e)}`); return false; }
  if (soltar === null) { log(`[atualização] outra sessão está mexendo nos .app agora: deixei ${oQue} para depois`); return false; }
  try { f(); return true; } finally { soltar(); }
}

/** A troca em si, já com a trava na mão. */
function trocarAlvos(mine: string, gatilho: UpdateGatilho): string {
  if (preparada === null) throw new Error("não há atualização pronta");
  const id = plistSync(mine, "CFBundleIdentifier");
  const targets = new Set<string>([mine]);
  for (const p of [path.join(os.homedir(), "Applications", `${appTitle()}.app`), path.join(os.homedir(), "Desktop", `${appTitle()}.app`)]) {
    if (fs.existsSync(p) && plistSync(p, "CFBundleIdentifier") === id) targets.add(path.resolve(p));
  }
  // Outra sessão pode ter trocado uma cópia enquanto esperávamos a trava. Filtrar ANTES de gravar o registro é o
  // que impede esta sessão de reivindicar (e depois apagar) o .antigo que é a volta atrás daquela.
  const { trocar: aTrocar, jaNaVersao } = alvosParaTrocar([...targets].map((caminho) => ({ caminho, versao: plistSync(caminho, "CFBundleShortVersionString") })), preparada.para);
  for (const t of jaNaVersao) log(`[atualização] ${t} já está na ${preparada.para}: não mexi`);
  const pend: UpdatePendente = { de: state.current, para: preparada.para, antigos: aTrocar.map((t) => `${t}.antigo`), tentativas: 0, gatilho, pedidoEm: new Date().toISOString(), fase: "pedida" };
  gravarJson(pendenteFile(), pend);
  const antigos: string[] = [];
  try {
    for (const t of aTrocar) {
      const fresh = `${t}.novo`, old = `${t}.antigo`;
      fs.rmSync(fresh, { recursive: true, force: true }); fs.rmSync(old, { recursive: true, force: true });
      try {
        execFileSync("ditto", [preparada.bundle, fresh]);
        fs.renameSync(t, old); fs.renameSync(fresh, t);
      } catch (e) {
        // Uma cópia sem escrita (mesa de outro usuário) é pulada; o .app em execução precisa trocar.
        if (t === mine) throw e;
        log(`[atualização] não troquei a cópia ${t}: ${erroTexto(e)}`); fs.rmSync(fresh, { recursive: true, force: true }); continue;
      }
      antigos.push(old);
      log(`[atualização] ${t} → ${preparada.para} (${gatilho})`);
    }
  } catch (e) {
    // A troca parou e o app NÃO vai reiniciar: desfazer é melhor que deixar um registro "pedida" no disco dizendo
    // que a troca começou. Assim "pedida" só sobra quando o processo morreu de verdade no meio.
    desfazerTroca(antigos);
    fs.rmSync(pendenteFile(), { force: true });
    throw e;
  }
  gravarJson(pendenteFile(), { ...pend, antigos, fase: "trocada" } satisfies UpdatePendente);
  fs.rmSync(updateDir(), { recursive: true, force: true });
  preparada = null; state.ready = null;
  return mine;
}

/** Desfaz uma troca que parou no meio com o app ainda de pé: cada `<app>.antigo` volta para o lugar do `<app>`. */
function desfazerTroca(antigos: readonly string[]): void {
  for (const old of antigos) {
    const t = old.replace(/\.antigo$/, "");
    try { fs.rmSync(t, { recursive: true, force: true }); fs.renameSync(old, t); log(`[atualização] desfiz a troca de ${t}`); }
    catch (e) { log(`[atualização] não consegui desfazer a troca de ${t}: ${erroTexto(e)}`); }
  }
}

/** Ao sair do app com uma atualização pronta, troca calado: a próxima abertura já é a nova. */
export function applyStagedOnQuit(): void {
  if (preparada === null || !podeTrocarComFixada(versaoFixada(), preparada.para)) return;
  try { swapBundles("saida"); } catch (e) { log(`[atualização] ao sair: ${erroTexto(e)}`); }
}

/* ---------- reinício ocioso ---------- */

async function tentarReinicioOcioso(): Promise<void> {
  if (!ligado || state.phase !== "ready" || !podeTrocarComFixada(versaoFixada(), state.ready)) return;
  let sistema: EstadoSistema = "unknown";
  try { sistema = powerMonitor.getSystemIdleState(OCIOSO_SEG); } catch { /* fica unknown */ }
  if (!decideReinicioOcioso({ ligado: getAtualizarOcioso(), pronta: true, sistema, ocupado: anyConversationBusy(), terminais: liveTerminals().length })) return;
  log(`[atualização] Mac ${sistema === "locked" ? "bloqueado" : "ocioso"} e nada em andamento: reiniciando na ${state.ready}`);
  try { await applyUpdate(state.ready as string, "ocioso"); } catch (e) { log(`[atualização] reinício ocioso não aconteceu: ${erroTexto(e)}`); }
}

/* ---------- versão mínima ---------- */

/** O backend de `host` respondeu ao hello com a versão mínima do app que ele atende (undefined = backend antigo). */
export function noteVersaoMinima(host: string, raw: unknown): void {
  const v = parseVersaoMinima(raw);
  if (v === null) minimaPorHost.delete(host); else minimaPorHost.set(host, v);
  let maior: string | null = null;
  for (const m of minimaPorHost.values()) if (maior === null || compareVersions(m, maior) > 0) maior = m;
  const abaixo = abaixoDaMinima(state.current, maior);
  if (maior === state.minima && abaixo === state.abaixoDaMinima) return;
  state.minima = maior; state.abaixoDaMinima = abaixo;
  if (abaixo) log(`[atualização] o backend de ${host} exige o app ${maior ?? "?"} ou mais novo (este é ${state.current})`);
  publish();
  if (abaixo && ativo() && (state.phase === "idle" || state.phase === "up-to-date" || state.phase === "error")) void check("versao-minima");
}

/* ---------- a abertura depois de uma troca ---------- */

/**
 * Conta a tentativa e, se o app ficar de pé CONFIRMA_MS, apaga os .antigo; na terceira abertura sem confirmar,
 * volta os .antigo para o lugar e reabre a versão anterior; reaberto na versão de antes da troca, a troca não pegou
 * (repõe um .app que tenha ficado faltando) e a próxima verificação prepara de novo.
 */
function conferirPendente(): void {
  let p: UpdatePendente | null = null;
  try { p = parsePendente(JSON.parse(fs.readFileSync(pendenteFile(), "utf8"))); } catch { return; }
  if (p === null) { fs.rmSync(pendenteFile(), { force: true }); return; }
  const pend = p;
  const mine = runningBundle();
  if (mine === null) return;
  // Tudo o que mexe nos .app e nos .antigo vai sob a MESMA trava que a troca usa: com troca rápida de usuário, a
  // outra sessão pode estar trocando agora, e o .antigo que ela acabou de criar é a volta atrás dela. Sem a trava,
  // esta sessão o apagaria. Quando a trava está com a outra, o registro fica no disco para a próxima abertura.
  let voltar = false;
  const feito = comTrava(mine, "a conferência da troca pendente", () => {
    // Repor o que ficou faltando vem ANTES de decidir, e vale para toda decisão. O registro em "pedida" quer dizer
    // que a troca morreu em algum ponto entre gravar o pedido e terminar as renomeações, então pode haver um .app
    // ausente mesmo quando esta abertura já é a versão nova. Antes isto só rodava no caminho "nao-pegou", e uma cópia
    // perdida nos outros caminhos tinha o .antigo apagado 30 s depois, sumindo de vez.
    reporFaltantes(pend);
    const decisao = decideRollback(pend, state.current);
    if (decisao === "voltar") { registrar("abertura", false, `a ${pend.para} não ficou de pé em ${TENTATIVAS_ATE_VOLTAR} aberturas: voltando para a ${pend.de}`, { gatilho: pend.gatilho, fase: pend.fase }); voltarParaAnterior(pend); voltar = true; return; }
    if (decisao === "nao-pegou") {
      log(`[atualização] reabriu na ${pend.de} depois de pedir a ${pend.para} (${pend.gatilho ?? "?"}, registro em "${pend.fase}"): a troca não pegou; vou preparar de novo`);
      registrar("abertura", false, `a troca para a ${pend.para} não pegou: reabriu na ${pend.de}`, { gatilho: pend.gatilho, fase: pend.fase });
      descartarAntigos(pend);
      fs.rmSync(pendenteFile(), { force: true });
      return;
    }
    if (decisao === "descartar") { registrar("abertura", true, `abriu na ${state.current}, fora da troca pedida (${pend.de} → ${pend.para}): só limpei o registro`); descartarAntigos(pend); fs.rmSync(pendenteFile(), { force: true }); return; }
    gravarJson(pendenteFile(), { ...pend, tentativas: pend.tentativas + 1 } satisfies UpdatePendente);
    setTimeout(() => confirmarTroca(mine, pend), CONFIRMA_MS).unref();
  });
  // Reabrir fica FORA da trava: `app.exit` não roda o finally, e a sessão nova encontraria a trava de pé.
  if (voltar) { relancar(mine); return; }
  if (!feito) log("[atualização] a conferência da troca fica para a próxima abertura");
}

/** O app ficou de pé: a versão nova está confirmada e as cópias anteriores saem (sob a trava, como tudo que as toca). */
function confirmarTroca(mine: string, pend: UpdatePendente): void {
  const feito = comTrava(mine, "o descarte da versão anterior", () => {
    descartarAntigos(pend);
    fs.rmSync(pendenteFile(), { force: true });
    const demorou = pend.pedidoEm !== null && Date.now() - Date.parse(pend.pedidoEm) > 10 * 60_000;
    log(`[atualização] ${pend.para} confirmada (ficou de pé${demorou ? ", bem depois do pedido" : ""}; ${pend.gatilho ?? "?"}); versão anterior apagada`);
    registrar("abertura", true, `${pend.para} confirmada`, { gatilho: pend.gatilho, demorou, tentativas: pend.tentativas });
  });
  if (!feito) log(`[atualização] ${pend.para} confirmada, mas o descarte da anterior fica para a próxima abertura`);
}

/** Repõe todo `<app>.antigo` cujo `<app>` sumiu: uma troca que morreu entre tirar o velho e pôr o novo. */
function reporFaltantes(p: UpdatePendente): void {
  for (const r of repararTroca(p.antigos, fs.existsSync)) {
    try { fs.renameSync(r.de, r.para); log(`[atualização] repus ${r.para} (a troca tinha parado no meio)`); }
    catch (e) { log(`[atualização] não consegui repor ${r.para}: ${erroTexto(e)}`); }
  }
}
/** Apaga as cópias anteriores que esta sessão criou e sabe que não fazem mais falta (decideDescarte decide). */
function descartarAntigos(p: UpdatePendente): void {
  const { apagar, manter } = decideDescarte(p.fase, p.antigos, fs.existsSync);
  for (const m of manter) log(`[atualização] mantive ${m.caminho}: ${motivoManterTexto(m.motivo)}`);
  // Um .antigo de outra conta do Mac pode ter arquivos que esta não apaga: fica lá, e a versão nova segue valendo.
  for (const a of apagar) { try { fs.rmSync(a, { recursive: true, force: true }); } catch (e) { log(`[atualização] não consegui apagar ${a}: ${erroTexto(e)}`); } }
}

/** Restaura cada <app>.antigo no lugar do <app>. Quem reabre é `conferirPendente`, já sem a trava na mão. */
function voltarParaAnterior(p: UpdatePendente): void {
  log(`[atualização] ${p.para} não passou das primeiras aberturas: voltando para ${p.de}`);
  for (const old of p.antigos) {
    const t = old.replace(/\.antigo$/, "");
    if (!fs.existsSync(old)) continue;
    try {
      const quebrado = `${t}.quebrado`;
      fs.rmSync(quebrado, { recursive: true, force: true });
      if (fs.existsSync(t)) fs.renameSync(t, quebrado);
      fs.renameSync(old, t);
      fs.rmSync(quebrado, { recursive: true, force: true });
      log(`[atualização] ${t} → ${p.de}`);
    } catch (e) { log(`[atualização] não consegui voltar ${t}: ${erroTexto(e)}`); }
  }
  fs.rmSync(pendenteFile(), { force: true });
}
