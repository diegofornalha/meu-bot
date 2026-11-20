/**
 * Normalização pura do settings.json: cada campo validado, defaults para arquivos antigos e a
 * migração `sshHost` (v2, host padrão global) → `lastHost` (v3, só pré-seleção do seletor).
 * Sem Electron: testável com node --test.
 */
import { repoValido } from "../modulos/modulos-fonte-core";
import type { AbaFixa, BackendModel, NavService, NavWorkspace, NavWorkspaces, Theme } from "../../shared/ipc";
import { parseAccelerator } from "./accelerator";
import { isZoomLevel } from "./zoom-core";
import { isPortaMcp, isToken } from "../controle-remoto/controle-remoto-core";

export const BACKEND_MODELS: readonly BackendModel[] = ["claudecode", "agente", "rene-dm", "rene", "grok-4"];
export const isBackendModel = (v: unknown): v is BackendModel =>
  typeof v === "string" && (BACKEND_MODELS as readonly string[]).includes(v);

const THEMES: readonly Theme[] = ["system", "light", "dark"];
export const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEMES as readonly string[]).includes(v);


export interface SettingsFile {
  version: 1;
  /** Última máquina aberta; pré-selecionada no seletor. */
  lastHost: string | null;
  /** Modelo padrão global para conversas novas. */
  backendModel: BackendModel;
  /** Modelo padrão por máquina; vence o global. */
  defaultModelByHost: Record<string, BackendModel>;
  /** Porta padrão do backend nas máquinas. */
  backendPort: number;
  /** Porta por máquina; vence a padrão (duas contas na mesma máquina não cabem na mesma porta). */
  backendPortByHost: Record<string, number>;
  /** Zoom da interface inteira (nível do Chromium, -8..8; 0 = 100%). Um só para todas as janelas. */
  zoomLevel: number;
  theme: Theme;
  notifications: boolean;
  contextBudgetTokens: number;
  memoryEveryTurns: number;
  quickEntryEnabled: boolean;
  /** Cópia diária do CRM e do financeiro das máquinas no Drive do dono. Só acontece com o Google conectado com Drive. */
  dadosNoDrive: boolean;
  quickEntryShortcut: string;
  /** Posição/tamanho da janela de cada máquina. */
  /** Máquinas que a sondagem reconheceu como computador do Grok Bot; vale mesmo quando inacessíveis. */
  podHosts: string[];
  /** Máquinas em que "🤖 agente pode usar" o Navegador ficou ligado (religa sozinho ao abrir a aba). */
  navAgentHosts: string[];
  /** 🤖 do Navegador desligado pela pessoa nestas máquinas: ligado é o padrão (5 nov); `navAgentHosts` (lista de ligados) ficou só por compatibilidade. */
  navAgentDesligados: string[];
  /**
   * Máquinas em que a pessoa **desligou** "o agente pode usar o Gmail". Ligado é o padrão (31 out): com a conta Google
   * conectada e o Pro na máquina, a ponte sobe sozinha quando o túnel fica pronto; só quem desligou fica fora.
   */
  gmailAgentDesligados: string[];
  /** Barra de favoritos do Navegador, por máquina (a pessoa ou o agente adicionam). */
  navFavoritos: Record<string, NavFavoritoItem[]>;
  /** Onboarding guiado da primeira vez: pendente até a pessoa concluir ou pular. */
  onboarding: Onboarding;
  /** Abrir a janela direto (padrão) ou com a abertura animada toda vez; caixinha no seletor. */
  openDirect: boolean;
  /** Apelido de cada máquina no app ("Renomear" no seletor); a chave SSH não muda. */
  hostNames: Record<string, string>;
  /** Notificações das páginas do Navegador → conversas (instrução, sites, modo). */
  /** Espaços de trabalho do Navegador, por máquina (tipo, ativo e a lista com os sites fixos). */
  navEspacos: Record<string, NavWorkspaces>;
  /** Reiniciar sozinho na versão nova com o Mac ocioso (como o Grok Bot; ligado por padrão). */
  atualizarOcioso: boolean;
  /** Corretor ortográfico enquanto se digita nos campos de texto do app. */
  corretorOrtografico: boolean;
  /** A notificação toca o som do sistema; desligado, ela só aparece (silent). */
  notificacaoSom: boolean;
  /** Aceleração por hardware do Chromium. Desligar ajuda em Mac com vídeo problemático; custa fluidez. */
  aceleracaoHardware: boolean;
  /** Modo de depuração: true/false gravado pela pessoa; null = o padrão da variante (ligado no staging). */
  depuracao: boolean | null;
  /** Modo instagramável: com a depuração ligada, cada log vira um cursor colorido com o nome de alguém da organização (o ✨ colado no Intro do seletor, e a paleta). */
  instagramavel: boolean;
  /** Aba fixada (📌) que fica na frente ao abrir; "padrao" até a pessoa escolher. */
  abaFixa: AbaFixa;
  /** Controle externo (MCP): servidor em 127.0.0.1 para um cliente MCP deste Mac controlar o app. Instalação nova nasce ligada (settings.ts loadSettings, 10 nov 2026); arquivo existente sem a chave fica desligado. */
  mcpLigado: boolean;
  /** As ferramentas que executam comando no terminal e código nas páginas (terminal_digitar, nav_js); desligadas por padrão. */
  mcpExecucao: boolean;
  /** Porta do controle externo; null = a padrão da variante (Produto.portaMcp). */
  mcpPorta: number | null;
  /** Bearer token do controle externo (64 hex); "" = nenhum (gerado ao ligar; fica gravado ao desligar, "Gerar outro" troca). */
  mcpToken: string;
  /** URL do repositório de módulos escolhida em Configurações; "" = a padrão do produto (modulos-fonte-core.ts). */
  modulosRepo: string;
}
export const ABAS_FIXAVEIS: readonly AbaFixa[] = ["padrao", "conversa", "tutoriais", "acervo", "conta-google", "gmail", "computador", "financas", "inspector", "modulos", "navegador", "usuarios"];
export const isAbaFixa = (v: unknown): v is AbaFixa => typeof v === "string" && (ABAS_FIXAVEIS as readonly string[]).includes(v);
export const MAX_ESPACOS = 20;
export const MAX_SERVICOS = 30;
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const emptyWorkspaces = (): NavWorkspaces => ({ ativo: null, lista: [] });
const cleanName = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** Um estado de espaços válido: ids únicos, nomes 1..40, urls http(s), ícone http(s)/data ou null, ativo existente. */
export function normalizeNavWorkspaces(v: unknown): NavWorkspaces {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return emptyWorkspaces();
  const p = v as Record<string, unknown>;
  const ids = new Set<string>(); const lista: NavWorkspace[] = [];
  for (const raw of Array.isArray(p["lista"]) ? (p["lista"] as unknown[]) : []) {
    if (raw === null || typeof raw !== "object") continue;
    const w = raw as Record<string, unknown>;
    const id = typeof w["id"] === "string" && ID_RE.test(w["id"]) && !ids.has(w["id"]) ? w["id"] : null;
    const nome = cleanName(w["nome"], 40);
    if (id === null || nome === "") continue;
    const sids = new Set<string>(); const servicos: NavService[] = [];
    for (const sr of Array.isArray(w["servicos"]) ? (w["servicos"] as unknown[]) : []) {
      if (sr === null || typeof sr !== "object") continue;
      const s = sr as Record<string, unknown>;
      const sid = typeof s["id"] === "string" && ID_RE.test(s["id"]) && !sids.has(s["id"]) ? s["id"] : null;
      const url = typeof s["url"] === "string" && /^https?:\/\/\S+$/i.test(s["url"]) && s["url"].length <= 2048 ? s["url"] : null;
      if (sid === null || url === null) continue;
      let snome = cleanName(s["nome"], 40); if (snome === "") { try { snome = new URL(url).hostname; } catch { snome = url.slice(0, 40); } }
      const icone = typeof s["icone"] === "string" && /^(https?:|data:image\/)/i.test(s["icone"]) && s["icone"].length <= 2048 ? s["icone"] : null;
      servicos.push({ id: sid, nome: snome, url, icone }); sids.add(sid);
      if (servicos.length >= MAX_SERVICOS) break;
    }
    lista.push({ id, nome, servicos, ...(w["oculto"] === true ? { oculto: true as const } : {}) }); ids.add(id);
    if (lista.length >= MAX_ESPACOS) break;
  }
  // O ativo nunca é um oculto: cai no primeiro visível (ou nenhum).
  const visivel = (id: string): boolean => lista.some((w) => w.id === id && w.oculto !== true);
  const ativo = typeof p["ativo"] === "string" && visivel(p["ativo"]) ? p["ativo"] : (lista.find((w) => w.oculto !== true)?.id ?? null);
  return { ativo, lista };
}
function normalizeNavEspacos(v: unknown): Record<string, NavWorkspaces> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, NavWorkspaces> = {};
  for (const [host, w] of Object.entries(v as Record<string, unknown>)) { if (!isValidHost(host)) continue; const n = normalizeNavWorkspaces(w); if (n.lista.length > 0) out[host] = n; }
  return out;
}

export type Onboarding = "pending" | "done" | "skipped";
export interface NavFavoritoItem { id: string; titulo: string; url: string }
export const MAX_FAVORITOS = 50;
/** Favoritos válidos de uma máquina: url http(s), título curto, ids únicos, url repetida fica com a primeira. */
function normalizeNavFavoritos(v: unknown): Record<string, NavFavoritoItem[]> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, NavFavoritoItem[]> = {};
  for (const [host, list] of Object.entries(v as Record<string, unknown>)) { if (!isValidHost(host)) continue; const n = normalizeFavoritos(list); if (n.length > 0) out[host] = n; }
  return out;
}
export function normalizeFavoritos(v: unknown): NavFavoritoItem[] {
  if (!Array.isArray(v)) return [];
  const out: NavFavoritoItem[] = []; const urls = new Set<string>(); const ids = new Set<string>();
  for (const it of v as unknown[]) {
    if (it === null || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    if (typeof o["url"] !== "string" || !/^https?:\/\/\S+$/i.test(o["url"]) || o["url"].length > 2048) continue;
    const url = o["url"]; if (urls.has(url)) continue;
    const id = typeof o["id"] === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(o["id"]) && !ids.has(o["id"]) ? o["id"] : `f${out.length + 1}-${Math.random().toString(36).slice(2, 8)}`;
    const titulo = (typeof o["titulo"] === "string" ? o["titulo"] : "").replace(/\s+/g, " ").trim().slice(0, 60);
    out.push({ id, titulo, url }); urls.add(url); ids.add(id);
    if (out.length >= MAX_FAVORITOS) break;
  }
  return out;
}
const ONBOARDINGS: readonly Onboarding[] = ["pending", "done", "skipped"];
export const isOnboarding = (v: unknown): v is Onboarding => typeof v === "string" && (ONBOARDINGS as readonly string[]).includes(v);

export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";
export const DEFAULT_MODEL: BackendModel = "agente";
export const DEFAULT_PORT = 8080;
export const DEFAULT_BUDGET = 24000;
export const DEFAULT_MEMORY_EVERY = 10;

export const isPort = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535;
export const isBudget = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 4000 && v <= 200000;
export const isEvery = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;

const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const isValidHost = (host: string): boolean => HOST_RE.test(host) && host.length <= 253;
const validHost = (v: unknown): string | null => (typeof v === "string" && isValidHost(v) ? v : null);

export const defaultSettings = (): SettingsFile => ({
  version: 1, lastHost: null, backendModel: DEFAULT_MODEL, defaultModelByHost: {}, backendPort: DEFAULT_PORT, backendPortByHost: {}, zoomLevel: 0,
  theme: "system", notifications: true, contextBudgetTokens: DEFAULT_BUDGET, memoryEveryTurns: DEFAULT_MEMORY_EVERY,
  quickEntryEnabled: true, dadosNoDrive: true, quickEntryShortcut: DEFAULT_SHORTCUT, podHosts: [], navAgentHosts: [], navAgentDesligados: [], gmailAgentDesligados: [], navFavoritos: {}, onboarding: "pending", openDirect: true, hostNames: {}, navEspacos: {}, atualizarOcioso: true, corretorOrtografico: true, notificacaoSom: true, aceleracaoHardware: true, depuracao: null, instagramavel: false, abaFixa: "padrao",
  // "Executar comandos e código" vem ligado (7 nov): o controle externo só existe com mcpLigado, e quem o liga quer o cliente agindo.
  mcpLigado: false, mcpExecucao: true, mcpPorta: null, mcpToken: "", modulosRepo: "",
});

/** Aceita qualquer JSON (inclusive o formato v2 com `sshHost`) e devolve um SettingsFile válido. */
export function normalizeSettings(input: unknown): SettingsFile {
  const p = (input !== null && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const byHost: Record<string, BackendModel> = {};
  const rawByHost = p["defaultModelByHost"];
  if (rawByHost !== null && typeof rawByHost === "object") {
    for (const [h, m] of Object.entries(rawByHost as Record<string, unknown>)) if (isValidHost(h) && isBackendModel(m)) byHost[h] = m;
  }
  const portByHost: Record<string, number> = {};
  const rawPortByHost = p["backendPortByHost"];
  if (rawPortByHost !== null && typeof rawPortByHost === "object") {
    for (const [h, n] of Object.entries(rawPortByHost as Record<string, unknown>)) if (isValidHost(h) && isPort(n)) portByHost[h] = n;
  }
  return {
    version: 1,
    // v2 guardava o host padrão em sshHost; vira só a pré-seleção do seletor.
    lastHost: validHost(p["lastHost"]) ?? validHost(p["sshHost"]),
    backendModel: isBackendModel(p["backendModel"]) ? p["backendModel"] : DEFAULT_MODEL,
    defaultModelByHost: byHost,
    backendPort: isPort(p["backendPort"]) ? p["backendPort"] : DEFAULT_PORT,
    backendPortByHost: portByHost,
    zoomLevel: isZoomLevel(p["zoomLevel"]) ? p["zoomLevel"] : 0,
    theme: isTheme(p["theme"]) ? p["theme"] : "system",
    notifications: typeof p["notifications"] === "boolean" ? p["notifications"] : true,
    contextBudgetTokens: isBudget(p["contextBudgetTokens"]) ? p["contextBudgetTokens"] : DEFAULT_BUDGET,
    memoryEveryTurns: isEvery(p["memoryEveryTurns"]) ? p["memoryEveryTurns"] : DEFAULT_MEMORY_EVERY,
    quickEntryEnabled: typeof p["quickEntryEnabled"] === "boolean" ? p["quickEntryEnabled"] : true,
    dadosNoDrive: typeof p["dadosNoDrive"] === "boolean" ? p["dadosNoDrive"] : true,
    quickEntryShortcut: typeof p["quickEntryShortcut"] === "string" && parseAccelerator(p["quickEntryShortcut"]) !== null ? p["quickEntryShortcut"] : DEFAULT_SHORTCUT,
    onboarding: isOnboarding(p["onboarding"]) ? p["onboarding"] : "pending",
    openDirect: typeof p["openDirect"] === "boolean" ? p["openDirect"] : true,
    podHosts: Array.isArray(p["podHosts"]) ? [...new Set((p["podHosts"] as unknown[]).filter((h): h is string => typeof h === "string" && isValidHost(h)))] : [],
    navAgentHosts: Array.isArray(p["navAgentHosts"]) ? [...new Set((p["navAgentHosts"] as unknown[]).filter((h): h is string => typeof h === "string" && isValidHost(h)))] : [],
    navAgentDesligados: Array.isArray(p["navAgentDesligados"]) ? [...new Set((p["navAgentDesligados"] as unknown[]).filter((h): h is string => typeof h === "string" && isValidHost(h)))] : [],
    // `gmailAgentHosts` (lista de ligados, até 31 out) deixou de existir: ligado virou o padrão; o arquivo antigo é só ignorado.
    gmailAgentDesligados: Array.isArray(p["gmailAgentDesligados"]) ? [...new Set((p["gmailAgentDesligados"] as unknown[]).filter((h): h is string => typeof h === "string" && isValidHost(h)))] : [],
    hostNames: normalizeHostNames(p["hostNames"]),
    navFavoritos: normalizeNavFavoritos(p["navFavoritos"]),
    navEspacos: normalizeNavEspacos(p["navEspacos"]),
    atualizarOcioso: typeof p["atualizarOcioso"] === "boolean" ? p["atualizarOcioso"] : true,
    corretorOrtografico: typeof p["corretorOrtografico"] === "boolean" ? p["corretorOrtografico"] : true,
    notificacaoSom: typeof p["notificacaoSom"] === "boolean" ? p["notificacaoSom"] : true,
    aceleracaoHardware: typeof p["aceleracaoHardware"] === "boolean" ? p["aceleracaoHardware"] : true,
    depuracao: p["depuracao"] === true ? true : p["depuracao"] === false ? false : null,
    instagramavel: p["instagramavel"] === true,
    abaFixa: isAbaFixa(p["abaFixa"]) ? p["abaFixa"] : "padrao",
    mcpLigado: p["mcpLigado"] === true,
    mcpExecucao: typeof p["mcpExecucao"] === "boolean" ? p["mcpExecucao"] : true,
    mcpPorta: isPortaMcp(p["mcpPorta"]) ? p["mcpPorta"] : null,
    mcpToken: isToken(p["mcpToken"]) ? p["mcpToken"] : "",
    modulosRepo: repoValido(p["modulosRepo"]) ? p["modulosRepo"] : "",
  };
}

/** Apelidos válidos: chave = host SSH válido; valor = texto de 1 a 40 caracteres, sem quebras. */
export function normalizeHostNames(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v === null || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [host, name] of Object.entries(v as Record<string, unknown>)) {
    if (!isValidHost(host) || typeof name !== "string") continue;
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
    if (clean !== "") out[host] = clean;
  }
  return out;
}

/**
 * Configurações que uma versão mais velha apagou: ela regrava o settings.json só com os campos que conhece. O backup
 * feito antes de o super admin voltar de versão traz o resto; aqui volta só o que FALTA (o que existe agora ganha,
 * porque foi mudado depois). Raso de propósito: cada campo do arquivo é uma preferência inteira.
 */
export function mesclarCamposPerdidos(atual: unknown, backup: unknown): Record<string, unknown> {
  const a = atual !== null && typeof atual === "object" && !Array.isArray(atual) ? (atual as Record<string, unknown>) : {};
  const b = backup !== null && typeof backup === "object" && !Array.isArray(backup) ? (backup as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) if (!(k in out)) out[k] = v;
  return out;
}
