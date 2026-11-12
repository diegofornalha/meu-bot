/**
 * Configurações › Controle externo (MCP): a seção que liga o servidor MCP do app para um cliente deste Mac (Claude
 * Code, Cursor). Tudo vale na hora (sem Salvar): ligar gera a chave na primeira vez e desligar a mantém; "Gerar
 * outra" e trocar a porta reiniciam o servidor; o interruptor de execução libera terminal_digitar e nav_js. A visão
 * vem do main (ControleRemotoView) e chega também por `controle-remoto:changed` quando outra janela mexe.
 */
import type { ClienteMcp, ControleRemotoView, EstadoClienteMcp } from "../../shared/ipc";
import { byId as $ } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";

const ligadoInput = $<HTMLInputElement>("mcp-ligado");
const execucaoInput = $<HTMLInputElement>("mcp-execucao");
const statusEl = $<HTMLElement>("mcp-status");
const sumEl = $<HTMLElement>("mcp-sum");
const tokenInput = $<HTMLInputElement>("mcp-token");
const mostrarBtn = $<HTMLButtonElement>("mcp-mostrar");
const copiarTokenBtn = $<HTMLButtonElement>("mcp-copiar-token");
const regenerarBtn = $<HTMLButtonElement>("mcp-regenerar");
const portaInput = $<HTMLInputElement>("mcp-porta");
const portaHint = $<HTMLElement>("mcp-porta-hint");
const copiarClaudeBtn = $<HTMLButtonElement>("mcp-copiar-claude");
const copiarCursorBtn = $<HTMLButtonElement>("mcp-copiar-cursor");
const avisoEl = $<HTMLElement>("mcp-aviso");
const claudeEstadoEl = $<HTMLElement>("mcp-claude-estado");
const instalarClaudeBtn = $<HTMLButtonElement>("mcp-instalar-claude");
const removerClaudeBtn = $<HTMLButtonElement>("mcp-remover-claude");
const cursorEstadoEl = $<HTMLElement>("mcp-cursor-estado");
const instalarCursorBtn = $<HTMLButtonElement>("mcp-instalar-cursor");
const SUM_PADRAO = "o Claude Code ou o Cursor usando este app por você";

let view: ControleRemotoView | null = null;
let mostrando = false;
let avisoTimer: ReturnType<typeof setTimeout> | null = null;

/** Chave sem expor tudo: só o fim (o "Mostrar" revela). */
export const tokenMascarado = (token: string): string => (token === "" ? "" : `${"•".repeat(12)}${token.slice(-6)}`);

function pintar(v: ControleRemotoView): void {
  view = v;
  pintarClientes(v);
  ligadoInput.checked = v.ligado;
  execucaoInput.checked = v.execucao;
  const comToken = v.token !== "";
  tokenInput.value = comToken ? (mostrando ? v.token : tokenMascarado(v.token)) : "";
  mostrarBtn.textContent = mostrando ? "Ocultar" : "Mostrar";
  for (const b of [mostrarBtn, copiarTokenBtn, regenerarBtn, copiarClaudeBtn, copiarCursorBtn]) b.disabled = !comToken;
  if (document.activeElement !== portaInput) portaInput.value = String(v.porta);
  portaHint.textContent = v.porta === v.portaPadrao ? `padrão deste app: ${v.portaPadrao}` : `padrão deste app: ${v.portaPadrao} (em uso: ${v.porta})`;
  portaHint.className = "hint";
  if (!v.ligado) { statusEl.textContent = comToken ? "Desligado. A chave continua guardada para quando religar." : "Desligado."; statusEl.className = "hint"; sumEl.textContent = SUM_PADRAO; }
  else if (v.rodando) { statusEl.textContent = `Ligado em ${v.url} (servidor "${v.nome}")${v.execucao ? ", com comandos e código liberados" : ", só leitura e navegação"}.`; statusEl.className = "hint ok"; sumEl.textContent = `ligado em ${v.url}`; }
  else { statusEl.textContent = `Ligado, mas o servidor não subiu: ${v.erro ?? "motivo desconhecido"}.`; statusEl.className = "hint bad"; sumEl.textContent = "ligado, mas sem subir"; }
}
const TEXTO_ESTADO: Record<EstadoClienteMcp, string> = { ausente: "não instalado", instalado: "instalado", desatualizado: "desatualizado (outra chave ou porta)", ilegivel: "config ilegível" };
/** Uma linha por cliente: o estado e o botão certo (Instalar, Atualizar ou nada a fazer). */
function pintarCliente(estado: EstadoClienteMcp, estadoEl: HTMLElement, instalar: HTMLButtonElement, comToken: boolean, extra = ""): void {
  estadoEl.textContent = `${TEXTO_ESTADO[estado]}${extra}`;
  estadoEl.className = `hint ${estado === "instalado" ? "ok" : estado === "ausente" ? "" : "bad"}`.trim();
  instalar.textContent = estado === "desatualizado" ? "Atualizar" : "Instalar";
  instalar.hidden = estado === "instalado";
  instalar.disabled = !comToken || estado === "ilegivel";
}
function pintarClientes(v: ControleRemotoView): void {
  const comToken = v.token !== "";
  const cc = v.clientes.claudeCode;
  pintarCliente(cc.estado, claudeEstadoEl, instalarClaudeBtn, comToken && cc.cli, cc.cli ? "" : " · comando claude não encontrado: use Copiar comando");
  removerClaudeBtn.hidden = cc.estado === "ausente" || cc.estado === "ilegivel";
  removerClaudeBtn.disabled = !cc.cli;
  pintarCliente(v.clientes.cursor.estado, cursorEstadoEl, instalarCursorBtn, comToken);
}
function avisar(texto: string, ok = true): void {
  avisoEl.textContent = texto; avisoEl.className = `hint ${ok ? "ok" : "bad"}`; avisoEl.hidden = false;
  if (avisoTimer !== null) clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { avisoEl.hidden = true; }, 6000);
}
async function agir(fn: () => Promise<ControleRemotoView>, depois?: string): Promise<void> {
  try { pintar(await fn()); if (depois !== undefined) avisar(depois); }
  catch (err) { if (view !== null) pintar(view); avisar(ipcErrorText(err), false); }
}
function copiar(texto: string, oQue: string): void {
  void navigator.clipboard.writeText(texto).then(() => avisar(`${oQue} copiado. Cole no cliente e reconecte.`), () => avisar("Não consegui copiar.", false));
}

/** Ao abrir as Configurações: lê o estado atual (o main é a fonte da verdade). */
export function carregarControleRemoto(): void {
  void window.meuBot.controleRemotoStatus().then(pintar).catch((err: unknown) => { statusEl.textContent = `Não consegui ler: ${ipcErrorText(err)}`; statusEl.className = "hint bad"; });
}

/** Liga eventos uma vez; o renderer chama junto das outras partes das Configurações. */
export function ligarControleRemoto(): void {
  ligadoInput.addEventListener("change", () => { const ligar = ligadoInput.checked; void agir(() => window.meuBot.controleRemotoLigar(ligar), ligar ? "Ligado. Clique em Instalar no cliente que vai usar o app." : "Desligado. A chave fica guardada; religar não pede configuração nova."); });
  execucaoInput.addEventListener("change", () => { const ligar = execucaoInput.checked; void agir(() => window.meuBot.controleRemotoExecucao(ligar), ligar ? "Comandos e código liberados para o cliente." : "Comandos e código bloqueados; o cliente continua lendo e navegando."); });
  mostrarBtn.addEventListener("click", () => { mostrando = !mostrando; if (view !== null) pintar(view); });
  copiarTokenBtn.addEventListener("click", () => { if (view !== null && view.token !== "") copiar(view.token, "Chave"); });
  regenerarBtn.addEventListener("click", () => { void agir(() => window.meuBot.controleRemotoRegenerar(), "Nova chave gerada; a anterior parou de valer. Clique em Atualizar nos clientes instalados."); });
  const aplicarPorta = (): void => {
    const porta = Number(portaInput.value);
    if (view !== null && porta === view.porta) return;
    if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) { portaHint.textContent = "use um número de 1024 a 65535"; portaHint.className = "hint bad"; return; }
    void agir(() => window.meuBot.controleRemotoPorta(porta), `Porta ${porta} em uso; clique em Atualizar nos clientes instalados.`);
  };
  portaInput.addEventListener("change", aplicarPorta);
  portaInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); aplicarPorta(); } });
  copiarClaudeBtn.addEventListener("click", () => { if (view !== null && view.configClaudeCode !== "") copiar(view.configClaudeCode, "Comando do Claude Code"); });
  copiarCursorBtn.addEventListener("click", () => { if (view !== null && view.configCursor !== "") copiar(view.configCursor, "Trecho do mcp.json do Cursor"); });
  const instalar = (cliente: ClienteMcp, botao: HTMLButtonElement): void => {
    const atualizar = botao.textContent === "Atualizar";
    const depois = cliente === "cursor" ? "Abri o Cursor: confirme a instalação lá. O estado aqui atualiza quando você voltar." : `Claude Code ${atualizar ? "atualizado" : "instalado"}. Numa sessão já aberta, rode /mcp para reconectar.`;
    botao.disabled = true;
    void agir(() => window.meuBot.controleRemotoInstalar(cliente), depois);
  };
  instalarClaudeBtn.addEventListener("click", () => instalar("claude-code", instalarClaudeBtn));
  instalarCursorBtn.addEventListener("click", () => instalar("cursor", instalarCursorBtn));
  removerClaudeBtn.addEventListener("click", () => { removerClaudeBtn.disabled = true; void agir(() => window.meuBot.controleRemotoRemover("claude-code"), "Removido do Claude Code."); });
  // Instalar no Cursor termina lá (a pessoa confirma): ao voltar para o app, relê o estado das configs.
  window.addEventListener("focus", () => { if (view !== null) carregarControleRemoto(); });
  window.meuBot.on("controle-remoto:changed", pintar);
}
