import { el } from "../lib/dom.js";
import { financeOk } from "../lib/pro.js";
import { ctx, ehRemoto } from "../app/ctx.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { registrarPassos } from "../tutoriais/passos.js";

/** Botão "Finanças" da lateral: só com a licença do financeiro; o número são as pendências e, sem nenhuma, a etiqueta "Custom" (pacote sob medida, ao lado dos "Pro"). */
export function paintFinanceLine(): void {
  const b = document.getElementById("financas-line"); if (b === null) return;
  // No app cujo add-on é o financeiro (meu-bot-finance-staging) o botão fica sempre (sem licença, a página diz como liberar).
  b.hidden = !ctx.caps.chat || (!financeOk(ctx.license, ctx.windowHost) && ctx.caps.addon !== "meu-bot-finance");
  const n = ctx.financeState?.estado?.pendencias ?? 0;
  const c = document.getElementById("financas-count"); if (c !== null) c.textContent = n > 0 ? `${n} para confirmar` : ctx.caps.planoExigido === "free" ? "Custom" : "";
}
/** Corpo dos passos do tutorial 12: atalhos para a página, para o chat e a instalação na máquina. */
export function renderFinanceStep(txt: HTMLElement, body: string): void {
  const row = el("div", "admin-actions");
  const abrir = el("button", "btn btn-ghost btn-small", "Abrir Finanças"); abrir.type = "button"; abrir.addEventListener("click", () => ctx.financePage?.open());
  const chat = (label: string, msg: string, hint: string): HTMLButtonElement => { const b = el("button", "btn btn-primary btn-small", label); b.type = "button"; b.addEventListener("click", () => { void ctx.goToChatFromGuide(msg, hint, "agente"); }); return b; };
  if (body === "finance-install") {
    const b = el("button", "btn btn-primary btn-small", ctx.financeState?.modulo === true ? "Ativado" : "Ativar agora"); b.type = "button"; b.disabled = ctx.financeState?.modulo === true;
    b.addEventListener("click", () => { ctx.financePage?.open(); });
    row.append(b);
    txt.append(el("p", "hint", "A ativação mostra o progresso na página Finanças. Sem o agente do WhatsApp (OpenClaw) nesta máquina, o financeiro funciona pelo chat do app."));
  } else if (body === "finance-contas") row.append(chat("Contar ao agente", "Quero cadastrar minhas contas no financeiro: ", "Complete com o seu banco, o cartão e se usa dinheiro vivo (ex.: Nubank, cartão Nubank e carteira). O agente cria cada conta."), abrir);
  else if (body === "finance-renda") row.append(chat("Contar ao agente", "Meu orçamento para gastar este mês é ", "Complete com o valor (ex.: 3.000). O agente grava e passa a acompanhar os gastos contra ele."), abrir);
  else if (body === "finance-testar") row.append(chat("Testar no chat", "gastei 48 no mercado", "O agente lança no financeiro desta máquina e responde. No WhatsApp é igual: mande para você mesmo."));
  else if (body === "finance-foto") txt.append(el("p", "hint", "Funciona no WhatsApp: mande a foto para você mesmo. O lançamento fica pendente até você confirmar o valor e a categoria."));
  else if (body === "finance-pendencias") { row.append(abrir); const n = ctx.financeState?.estado?.pendencias ?? 0; if (n > 0) txt.append(el("p", "hint", `${n} ${n === 1 ? "lançamento espera" : "lançamentos esperam"} você.`)); }
  if (row.childElementCount > 0) txt.append(row);
}
/** Liga os seis passos do tutorial 12 ao guia (todos passam por `renderFinanceStep`, que escolhe pelo body). */
export function ligarFinanceiroGuia(): void {
  registrarFonte("finance", () => ({ known: ctx.navLicenseAsked && (!ehRemoto() || !financeOk(ctx.license, ctx.windowHost) || ctx.financeState !== null), dados: { finance: { access: ctx.navLicenseAsked ? financeOk(ctx.license, ctx.windowHost) : null, info: ctx.financeState } } }));
  const passo = (txt: HTMLElement, step: { body?: string }): void => renderFinanceStep(txt, step.body ?? "");
  registrarPassos({ "finance-install": passo, "finance-contas": passo, "finance-renda": passo, "finance-testar": passo, "finance-foto": passo, "finance-pendencias": passo });
}
