/**
 * Navegador do agente no guia (tutorial 9): o lado da máquina (MCP + regra), o plano Pro e abrir a aba. Também
 * `abrirLinkDoChat`, que outras telas usam para abrir um link numa aba do Navegador.
 */
import { el } from "../lib/dom.js";
import { esperaOuFalha, SEM_RESPOSTA } from "../lib/carregando.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { browserAccess, proBlockText, pagamentoDoBloqueio } from "../lib/pro.js";
import { blocoPagamento } from "../lib/aviso-pagamento.js";
import { hostLabel } from "../lib/probe-text.js";
import { ctx, ehRemoto } from "../app/ctx.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { registrarPassos } from "../tutoriais/passos.js";

/** Lado da máquina do Navegador (tutorial 9): instalado? null = ainda não consultado. */
export let navInstState: boolean | null = null;
/** Por que a última consulta falhou; só aparece enquanto não há resposta nenhuma (`navInstState === null`). */
let navInstErro: string | null = null;
let navInstBusy = false;
let navInstLog: string[] = [];
let navInstMsg: { text: string; bad: boolean } | null = null;

export async function refreshNavInst(): Promise<void> {
  if (!ctx.caps.install || ctx.windowHost === "" || ctx.windowHost === "local") return;
  // Falhou: fica o estado que havia, e o passo diz o motivo em vez de esperar para sempre.
  try { const r = await window.meuBot.navegadorInstalled(); if (r === null) navInstErro = SEM_RESPOSTA; else { navInstState = r; navInstErro = null; } } catch (err) { navInstErro = ipcErrorText(err); }
  ctx.paintGuide();
}
/** Tutorial 9, passo 2: instalar o lado da máquina (MCP + regra). */
export function renderNavInstall(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  // Este Mac: o lado da máquina (MCP + regra) só existe nas máquinas por SSH, e a consulta não tem o que responder.
  // Sem isto o passo ficava em "Consultando a máquina…" para sempre, com o Preparar desligado.
  if (!ehRemoto()) { box.append(el("p", "audio-ok", "✓ Neste Mac não há o que preparar: esta etapa é só das máquinas por SSH.")); container.append(box); return; }
  const row = el("div", "audio-row");
  if (navInstState === true && !navInstBusy) row.append(el("span", "audio-ok", "✓ pronto nesta máquina"));
  const b = el("button", `btn ${navInstState === true ? "btn-ghost" : "btn-primary"} btn-small`, navInstBusy ? "Preparando…" : navInstState === true ? "Reinstalar" : "Preparar");
  b.type = "button"; b.disabled = navInstBusy || navInstState === null;
  b.addEventListener("click", () => {
    navInstBusy = true; navInstLog = []; navInstMsg = null; ctx.paintGuide();
    void window.meuBot.installNavegador()
      .then((r) => { navInstMsg = r.ok ? { text: "Máquina pronta: o agente já tem as ações do navegador.", bad: false } : { text: r.log.at(-1) ?? "a instalação falhou", bad: true }; })
      .catch((err: unknown) => { navInstMsg = { text: ipcErrorText(err), bad: true }; })
      .finally(() => { navInstBusy = false; void refreshNavInst(); });
  });
  row.append(b);
  box.append(row);
  if (navInstState === null) box.append(esperaOuFalha({ erro: navInstErro, chave: "guia-navegador", tentar: () => { navInstErro = null; ctx.paintGuide(); void refreshNavInst(); } }));
  if (navInstBusy && navInstLog.length > 0) box.append(el("pre", "admin-logs", navInstLog.join("\n")));
  if (navInstMsg !== null) box.append(el("p", `hint ${navInstMsg.bad ? "guide-pair-note" : "audio-ok"}`, navInstMsg.text));
  container.append(box);
}
/** Tutorial 9, passo 1: o plano desta máquina e o pedido ao admin. */
export function renderNavPro(container: HTMLElement): void {
  const box = el("div", "audio-controls");
  const a = browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto);
  if (a === "ok") { box.append(el("p", "audio-ok", ctx.caps.planoExigido === "free" ? `✓ plano Pro ativo em ${hostLabel(ctx.windowHost)}` : `✓ assinatura do ${ctx.caps.produto} ativa em ${hostLabel(ctx.windowHost)}`)); container.append(box); return; }
  const t = proBlockText(a, ctx.license, "navegador", ctx.caps.produto);
  box.append(el("p", "hint", t.text));
  const pg = pagamentoDoBloqueio(a, ctx.license);
  if (pg !== null) box.append(blocoPagamento(pg));
  const row = el("div", "audio-row");
  if (t.askAdmin) {
    const b = el("button", "btn btn-primary btn-small", ctx.navAskedPro ? "Pedido enviado ao admin ✓" : a === "assinatura" ? "Avisar o admin" : "Pedir o Pro ao admin"); b.type = "button"; b.disabled = ctx.navAskedPro;
    b.addEventListener("click", () => { b.disabled = true; void window.meuBot.browserRequestPro().then(() => { ctx.navAskedPro = true; ctx.paintGuide(); }).catch(() => { b.disabled = false; }); });
    row.append(b);
  }
  const again = el("button", "btn btn-ghost btn-small", "Conferir de novo"); again.type = "button";
  again.addEventListener("click", () => { void ctx.refreshLicense().then(() => ctx.paintGuide()); });
  row.append(again);
  box.append(row);
  container.append(box);
}
/**
 * Link de uma mensagem: site (http/https) abre numa aba do Navegador do próprio app, onde o agente também enxerga;
 * Cmd+clique, outros esquemas (mailto:…) ou Navegador indisponível (sem módulo/assinatura) → navegador do Mac.
 */
export async function abrirLinkDoChat(url: string, externo: boolean, rotulo?: string): Promise<void> {
  if (externo || !ctx.caps.navegador || !/^https?:\/\//i.test(url)) { void window.meuBot.openExternal(url); return; }
  await ctx.openNavTab(url, true, rotulo);
  if (ctx.navAccess !== "ok" || ctx.navPartition === null) void window.meuBot.openExternal(url);
}
/** Tutorial 9, passo 3: abrir a aba do Navegador. */
export function renderNavOpen(container: HTMLElement, url?: string): void {
  const row = el("div", "audio-row");
  const b = el("button", "btn btn-primary btn-small", url !== undefined ? "Abrir o Gmail no Navegador" : ctx.navTabs.length > 0 ? "Ir para o Navegador" : "Abrir o Navegador"); b.type = "button";
  b.addEventListener("click", () => { void ctx.openNavTab(url); });
  row.append(b);
  container.append(row);
}

/** Liga os passos do Navegador ao guia e o progresso do instalador; o renderer.ts chama uma vez. */
export function ligarNavegadorGuia(): void {
  registrarFonte("navegador", () => ({
    known: ctx.navLicenseAsked && (navInstState !== null || !ehRemoto()),
    dados: { navegador: { access: !ctx.navLicenseAsked ? null : browserAccess(ctx.license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto), installed: ehRemoto() ? navInstState : true, tabs: ctx.navTabs.filter((t) => t.url !== "" && !t.url.startsWith("about:")).length, extensions: ctx.navExtensions.length, agentOn: ctx.navAgent.on && ctx.navAgent.state === "up", servicos: ctx.navServicosCount(), extensaoEmbutida: ctx.navExtensions.some((x) => x.embutida === true) } },
  }));
  registrarPassos({
    "navegador-pro": (txt) => renderNavPro(txt),
    "navegador-install": (txt) => renderNavInstall(txt),
    "navegador-open": (txt) => renderNavOpen(txt),
  });
  window.meuBot.on("navegador:progress", ({ line }) => { navInstLog = [...navInstLog, line].slice(-6); if (navInstBusy) ctx.paintGuide(); });
}
