import type { LicenseView } from "../../shared/ipc";
import { byId as $ } from "../lib/dom.js";
import { browserAccess, crmProprioOk, planoLiberaPro, financeOk } from "../lib/pro.js";
import { ctx } from "../app/ctx.js";

export let license: LicenseView | null = null;
/** CRM próprio nesta máquina, pela licença (Pro ou superior, ou o produto meu-bot-crm); fechado enquanto a licença não chegou. */
export const crmProprio = (): boolean => crmProprioOk(license, ctx.windowHost);
/** Motor do CRM em uso: o gravado em crm.json; sem ele, CRM contratado → próprio, chave do Streak → Streak, senão licença (regra do crm-core.ts). */
export const motorCrm = (): "proprio" | "streak" => ctx.crmState?.motor ?? (ctx.crmState?.streakKey === true ? "streak" : crmProprio() ? "proprio" : "streak");
/** Licença da máquina (cache; a aba Navegador e as Configurações leem daqui). */
/** Selo "PRO" no canto superior direito: mostra quando a conta desta janela é Pro (barra cheia e recolhida). */
const planBadge = $<HTMLElement>("plan-badge");
const miniPlan = $<HTMLElement>("mini-plan");
export function setPlanBadge(pro: boolean): void { const show = pro && ctx.caps.planoExigido === "free"; planBadge.hidden = !show; miniPlan.hidden = !show; }
/** Linha "Computador" na lateral: só para quem tem o Pro em dia; sem o plano (ou antes da licença chegar) fica escondida. */
const computadorLine = $<HTMLElement>("computador-line");
function paintComputadorLine(): void { computadorLine.hidden = !ctx.caps.telaComputador || browserAccess(license, ctx.windowHost, ctx.caps.planoExigido, ctx.caps.produto) !== "ok"; }
export let navLicenseAsked = false;
export async function refreshLicense(): Promise<LicenseView | null> {
  if (!ctx.caps.chat) { license = null; navLicenseAsked = true; setPlanBadge(false); return null; }
  try { license = await window.meuBot.getLicense(); } catch { /* backend antigo/fora do ar: fica o que havia */ }
  navLicenseAsked = true;
  setPlanBadge(license !== null && planoLiberaPro(license.license.plan));
  ctx.paintFinanceLine();
  ctx.paintModulosLine();
  paintComputadorLine();
  // Financeiro liberado agora (ou na abertura): lê o estado para a lateral e o tutorial 12.
  if (ctx.financePage !== null && ((financeOk(license, ctx.windowHost) && ctx.financeState === null) || ctx.caps.addon === "meu-bot-finance")) void ctx.financePage.refresh();
  return license;
}
