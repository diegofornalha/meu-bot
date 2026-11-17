/**
 * Bloco "Como pagar" dos avisos de plano (Navegador, Conta Google, CRM, Finanças, Computador e erro no chat): as
 * instruções que o admin gravou na licença, com Copiar, o link e "Já paguei, avisar o admin"; sem nada gravado, o
 * caminho padrão ("Como assinar", botão "Assinar pelo site"). Quem decide se aparece
 * é `pagamentoDoBloqueio` (lib/pro.ts); aqui só se desenha.
 */
import type { Pagamento } from "../../shared/ipc";
import { el } from "./dom.js";

let avisouPagamento = false;

export function blocoPagamento(p: Pagamento): HTMLElement {
  const box = el("div", "plano-pagamento");
  const padrao = p.padrao === true; // ninguém gravou instruções: o caminho é assinar pelo site
  box.append(el("strong", "", padrao ? "Como assinar" : "Como pagar"));
  if (p.instrucoes !== "") box.append(el("p", "plano-pagamento-texto", p.instrucoes));
  const row = el("div", "actions");
  const botao = (texto: string, classe: string, run: (b: HTMLButtonElement) => void): HTMLButtonElement => {
    const b = el("button", `btn ${classe} btn-small`, texto); b.type = "button";
    b.addEventListener("click", () => run(b));
    row.append(b);
    return b;
  };
  if (p.instrucoes !== "" && !padrao) botao("Copiar", "btn-ghost", (b) => { void navigator.clipboard.writeText(p.instrucoes).then(() => { b.textContent = "Copiado ✓"; }, () => { b.textContent = "Não consegui copiar"; }); });
  if (p.link !== null) { const link = p.link; botao(padrao ? "Assinar pelo site" : "Abrir o link de pagamento", "btn-ghost", () => { void window.meuBot.openExternal(link); }); }
  const nota = el("p", "hint");
  nota.hidden = true;
  const pago = botao(avisouPagamento ? "Admin avisado ✓" : "Já paguei, avisar o admin", "btn-primary", (b) => {
    b.disabled = true;
    void window.meuBot.planoAvisarPagamento().then(() => {
      avisouPagamento = true; b.textContent = "Admin avisado ✓";
      nota.hidden = false; nota.textContent = "Assim que o admin confirmar o pagamento, isto libera sozinho.";
    }, () => { b.disabled = false; nota.hidden = false; nota.textContent = "Não consegui avisar o admin agora. Tente de novo em instantes."; });
  });
  pago.disabled = avisouPagamento;
  box.append(row, nota);
  return box;
}
