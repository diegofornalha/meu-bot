/**
 * Modo de fumaça, a parte do Electron (a decisão é pura, em fumaca-core.ts). `ligarFumaca()` é chamado no começo do
 * main.ts: sem `MEU_BOT_FUMACA` no ambiente não faz nada. Com ela, desliga o atualizador, passa a anotar os erros do
 * processo e das janelas e, quando a primeira janela à vista termina de carregar (ou o prazo vence), grava o
 * relatório no arquivo pedido e sai com 0 ou 1 por `app.exit` (sem `will-quit`: nada de aplicar atualização na saída;
 * a limpeza de sempre, túneis e afins, roda antes pelo `aoConcluirFumaca`).
 *
 * A fumaça não mexe em nada fora do app: não abre o navegador do sistema (o seletor sem conta abre a página de login
 * sozinho, e um navegador já logado devolve o deep link e abre o app de verdade da pessoa) e o seletor não atualiza
 * backend, guarda nem CRM das máquinas do ~/.ssh/config (`fumacaLigada()` em maquina/picker.ts): sair no meio de uma
 * instalação deixaria a máquina pela metade. O controle local (term.sock) e o MCP também não sobem (main.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { app, shell, type BrowserWindow } from "electron";
import { appVariant, caps } from "./variant";
import { arquivoDaFumaca, ASSENTAR_FUMACA_MS, codigoDeSaida, fumacaPronta, montarRelatorio, PRAZO_FUMACA_MS, textoDoErro, type JanelaVista } from "./fumaca-core";

const erros: string[] = [];
const avisos: string[] = [];
const janelas: { win: BrowserWindow; carregou: boolean }[] = [];
let destino: string | null = null;
let inicio = 0;
let concluida = false;
let assentar: NodeJS.Timeout | null = null;
let limpar: (() => void) | null = null;

/** O que o `will-quit` faria (fechar túneis, parar servidores): o main.ts registra, a fumaça chama antes de sair. */
export function aoConcluirFumaca(cb: () => void): void { limpar = cb; }

export const fumacaLigada = (): boolean => destino !== null;

function logar(linha: string): void {
  try { fs.appendFileSync(path.join(app.getPath("userData"), "meu-bot.log"), `${new Date().toISOString()} [fumaca] ${linha}\n`); } catch { /* log é cortesia */ }
}

function vistas(): JanelaVista[] {
  return janelas.map(({ win, carregou }) => {
    if (win.isDestroyed()) return { arquivo: "", titulo: "", carregou, visivel: false };
    let arquivo = "";
    try { arquivo = path.posix.basename(new URL(win.webContents.getURL()).pathname); } catch { /* ainda sem URL */ }
    return { arquivo, titulo: win.getTitle(), carregou, visivel: win.isVisible() };
  });
}

function concluir(prazoVencido: boolean): void {
  if (concluida || destino === null) return;
  concluida = true;
  let capsDoApp: Record<string, unknown> = {};
  try { capsDoApp = { ...caps() }; } catch (e) { erros.push(textoDoErro("caps()", e)); }
  const r = montarRelatorio({
    versao: app.getVersion(), plataforma: process.platform, arch: process.arch, variante: appVariant(), empacotado: app.isPackaged,
    caps: capsDoApp, janelas: vistas(), erros, avisos, prazoVencido, duracaoMs: Date.now() - inicio, em: new Date().toISOString(),
  });
  let codigo = codigoDeSaida(r);
  try {
    fs.mkdirSync(path.dirname(path.resolve(destino)), { recursive: true });
    fs.writeFileSync(destino, `${JSON.stringify(r, null, 2)}\n`);
  } catch (e) {
    codigo = 1;
    console.error(`[fumaca] não gravei o relatório em ${destino}: ${e instanceof Error ? e.message : String(e)}`);
  }
  logar(`${r.ok ? "ok" : "FALHOU"}: ${r.versao} ${r.plataforma}/${r.arch} ${r.variante}, janela ${r.janela.arquivo || "(nenhuma)"} ${r.janela.carregou ? "carregou" : "não carregou"}, ${r.erros.length} erro(s); relatório em ${destino}`);
  for (const e of r.erros) logar(`erro: ${e}`);
  try { limpar?.(); } catch (e) { logar(`limpeza antes de sair: ${e instanceof Error ? e.message : String(e)}`); }
  app.exit(codigo);
}

/** Uma janela à vista carregou: espera assentar (erro logo depois do load ainda entra) e conclui. */
function talvezConcluir(): void {
  if (concluida || assentar !== null || !fumacaPronta(vistas())) return;
  assentar = setTimeout(() => concluir(false), ASSENTAR_FUMACA_MS);
}

function vigiar(win: BrowserWindow): void {
  const item = { win, carregou: false };
  janelas.push(item);
  const wc = win.webContents;
  wc.on("did-finish-load", () => { item.carregou = true; talvezConcluir(); });
  wc.on("did-fail-load", (_e, codigo, descricao, url, mainFrame) => { if (mainFrame) erros.push(`a página não carregou (${codigo} ${descricao}): ${url}`); });
  wc.on("render-process-gone", (_e, d) => { erros.push(`o processo da página caiu (${d.reason}, código ${d.exitCode})`); });
  wc.on("preload-error", (_e, preload, erro) => { erros.push(textoDoErro(`preload ${path.basename(preload)}`, erro)); });
  wc.on("console-message", (e) => { if (e.level === "error") avisos.push(`console (${path.posix.basename(e.sourceId)}:${e.lineNumber}): ${e.message}`); });
  // A janela nasce escondida e aparece depois (ready-to-show): confere de novo quando aparecer.
  win.on("show", talvezConcluir);
}

/** Liga o modo de fumaça se `MEU_BOT_FUMACA` está no ambiente. Antes da trava de instância e do `ready`. */
export function ligarFumaca(): void {
  destino = arquivoDaFumaca(process.env);
  if (destino === null) return;
  inicio = Date.now();
  // O atualizador não roda na fumaça (o mesmo interruptor de sempre, src/main/atualizacao/updater.ts).
  process.env.MEU_BOT_NO_UPDATE = "1";
  delete process.env.MEU_BOT_NO_UPDATE_MOTIVO;
  // Relatório de uma rodada anterior não pode passar por resultado desta.
  try { fs.rmSync(destino, { force: true }); } catch { /* o concluir() diz se não consegue gravar */ }
  // Nada de abrir o navegador do sistema: o pedido fica só no log.
  (shell as { openExternal: typeof shell.openExternal }).openExternal = (url) => { let onde = url; try { onde = new URL(url).origin; } catch { /* fica como veio */ } logar(`não abri ${onde} no navegador do sistema (modo de fumaça)`); return Promise.resolve(); };
  process.on("uncaughtException", (e) => { erros.push(textoDoErro("exceção não tratada", e)); });
  process.on("unhandledRejection", (e) => { erros.push(textoDoErro("promessa rejeitada sem tratamento", e)); });
  app.on("browser-window-created", (_e, win) => vigiar(win));
  app.on("child-process-gone", (_e, d) => { if (d.reason !== "clean-exit" && d.reason !== "killed") erros.push(`processo ${d.type} caiu (${d.reason}, código ${d.exitCode})`); });
  setTimeout(() => concluir(true), PRAZO_FUMACA_MS);
  void app.whenReady().then(() => logar(`começou: relatório em ${destino}`));
}

/** Falha que impede o app de subir (outra instância já aberta): grava o relatório com o motivo e sai com 1. */
export function falharFumaca(motivo: string): void {
  erros.push(motivo);
  concluir(false);
}
