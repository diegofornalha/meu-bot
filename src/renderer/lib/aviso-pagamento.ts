/**
 * Bloco de pagamento dos avisos de plano (Navegador, Conta Google, CRM, Finanças, Computador e erro no chat).
 * - O admin gravou um "Como pagar" na licença da máquina (acordo à parte): as instruções dele, com Copiar, o link e
 *   "Já paguei, avisar o admin".
 * - Sem nada gravado (o caminho padrão), a pessoa resolve sozinha: "Assinar pelo site" e, com o plano já na conta,
 *   "Usar o meu Pro nesta máquina", que leva a licença da conta à máquina desta janela sem passar pelo admin.
 * Quem decide se o bloco aparece é `pagamentoDoBloqueio` (lib/pro.ts) e qual caminho é `caminhoDoPlano`; aqui se
 * desenha. A janela diz quem é a conta e a máquina com `ligarAvisoPlano`, uma vez.
 */
import type { ContaView, Pagamento, PlanoDaContaResultado } from "../../shared/ipc";
import { el } from "./dom.js";
import { ipcErrorText } from "./ipc-error.js";
import { CAMINHO_ASSINATURA, caminhoDoPlano, planoLiberaPro } from "./pro.js";

/** O que o bloco precisa saber da janela; sem `ligarAvisoPlano` (testes, seletor) vale o caminho "assinar". */
export interface ContextoPlano {
  /** A conta meu-bot deste Mac, como o main a mandou por último. */
  conta: () => ContaView | null;
  /** A janela é de uma máquina por SSH (em Este Mac o plano já é o da conta). */
  remoto: () => boolean;
  /** De onde vem o plano em vigor nesta máquina (`LicenseView.origem`). */
  origem: () => "admin" | "conta" | undefined;
  /** A licença mudou (aplicada, ou a conta foi relida em Este Mac): a janela relê e repinta as telas de bloqueio. */
  aoLiberar: () => Promise<void>;
}
let contexto: ContextoPlano | null = null;
export function ligarAvisoPlano(c: ContextoPlano): void { contexto = c; }

/** Relê a licença da janela e repinta os bloqueios (para quem muda o plano fora deste bloco: Configurações › Sua conta). */
export const relerPlano = (): Promise<void> => contexto?.aoLiberar() ?? Promise.resolve();

let avisouPagamento = false;
const DEVICES = "/account/devices";

export function blocoPagamento(p: Pagamento): HTMLElement {
  const box = el("div", "plano-pagamento");
  const row = el("div", "actions");
  const nota = el("p", "hint"); nota.hidden = true;
  const dizer = (t: string): void => { nota.hidden = false; nota.textContent = t; };
  const botao = (texto: string, classe: string, run: (b: HTMLButtonElement) => void): HTMLButtonElement => {
    const b = el("button", `btn ${classe} btn-small`, texto); b.type = "button";
    b.addEventListener("click", () => run(b));
    row.append(b);
    return b;
  };
  if (p.padrao === true) pintarPadrao(p, box, row, botao, dizer);
  else pintarDoAdmin(p, box, botao, dizer);
  box.append(row, nota);
  return box;
}

type Botao = (texto: string, classe: string, run: (b: HTMLButtonElement) => void) => HTMLButtonElement;

/** O admin gravou as instruções: nada muda aqui, quem libera é ele. */
function pintarDoAdmin(p: Pagamento, box: HTMLElement, botao: Botao, dizer: (t: string) => void): void {
  box.append(el("strong", "", "Como pagar"));
  if (p.instrucoes !== "") box.append(el("p", "plano-pagamento-texto", p.instrucoes));
  if (p.instrucoes !== "") botao("Copiar", "btn-ghost", (b) => { void navigator.clipboard.writeText(p.instrucoes).then(() => { b.textContent = "Copiado ✓"; }, () => { b.textContent = "Não consegui copiar"; }); });
  if (p.link !== null) { const link = p.link; botao("Abrir o link de pagamento", "btn-ghost", () => { void window.meuBot.openExternal(link); }); }
  avisarAdmin(botao, dizer);
}
function avisarAdmin(botao: Botao, dizer: (t: string) => void): void {
  const pago = botao(avisouPagamento ? "Admin avisado ✓" : "Já paguei, avisar o admin", "btn-primary", (b) => {
    b.disabled = true;
    void window.meuBot.planoAvisarPagamento().then(() => {
      avisouPagamento = true; b.textContent = "Admin avisado ✓";
      dizer("Assim que o admin confirmar o pagamento, isto libera sozinho.");
    }, () => { b.disabled = false; dizer("Não consegui avisar o admin agora. Tente de novo em instantes."); });
  });
  pago.disabled = avisouPagamento;
}

const caminho = (): "usar-da-conta" | "assinar" => {
  const c = contexto?.conta()?.conta ?? null;
  return caminhoDoPlano({ remoto: contexto?.remoto() ?? false, conta: c?.licenca ?? null, maquinaLimite: c?.maquinaLimite ?? null, origem: contexto?.origem() });
};
const abrirConsole = (rota: string): void => { void window.meuBot.contaAbrirConsole(rota).catch(() => undefined); };

/** Leva a licença da conta à máquina desta janela e diz o que houve; com sucesso a janela relê e este bloco some. */
async function usarDaConta(b: HTMLButtonElement, row: HTMLElement, dizer: (t: string) => void): Promise<void> {
  const antes = b.textContent;
  b.disabled = true; b.textContent = "Aplicando nesta máquina…";
  let r: PlanoDaContaResultado;
  try { r = await window.meuBot.planoUsarDaConta(); } catch (err) { r = { ok: false, erro: ipcErrorText(err) }; }
  if (r.ok) { b.textContent = "Aplicado ✓"; dizer("Pronto: esta máquina passou a usar a licença da sua conta."); await contexto?.aoLiberar(); return; }
  b.disabled = false; b.textContent = antes;
  if (r.semVaga !== undefined && r.semVaga.length > 0) {
    dizer(`A sua conta já usa a licença em ${r.semVaga.join(", ")}. Tire de lá para usar aqui: abra aquela máquina no meu-bot e, em Configurações › Sua conta, toque em "Tirar o Pro desta máquina".`);
    if (row.querySelector("[data-maquinas]") === null) { const v = el("button", "btn btn-ghost btn-small", "Ver minhas máquinas"); v.type = "button"; v.dataset.maquinas = "1"; v.addEventListener("click", () => abrirConsole(DEVICES)); row.append(v); }
    return;
  }
  dizer(`Não consegui aplicar: ${r.erro}`);
}

/** O caminho padrão: a própria pessoa assina pelo site e aplica o plano da conta, sem o admin. */
function pintarPadrao(p: Pagamento, box: HTMLElement, row: HTMLElement, botao: Botao, dizer: (t: string) => void): void {
  const c = contexto?.conta() ?? null;
  const pro = c?.conta !== null && c?.conta !== undefined && planoLiberaPro(c.conta.licenca.plan);
  if (caminho() === "usar-da-conta") {
    box.append(el("strong", "", pro ? "A sua conta já tem o Pro" : "A sua conta já tem esta assinatura"));
    box.append(el("p", "plano-pagamento-texto", "Falta só usá-la nesta máquina. A licença da conta vale em uma máquina por vez, e você pode trocar quando quiser."));
    botao(pro ? "Usar o meu Pro nesta máquina" : "Usar a minha assinatura nesta máquina", "btn-primary", (b) => { void usarDaConta(b, row, dizer); });
    botao("Plano e pagamento", "btn-ghost", () => abrirConsole(CAMINHO_ASSINATURA));
    return;
  }
  box.append(el("strong", "", "Como assinar"));
  if (p.instrucoes !== "") box.append(el("p", "plano-pagamento-texto", p.instrucoes));
  botao("Assinar pelo site", "btn-primary", () => abrirConsole(CAMINHO_ASSINATURA));
  if (contexto === null) return;
  const ctx = contexto;
  botao("Já assinei", "btn-ghost", (b) => {
    const v = ctx.conta();
    if (v === null || v.situacao !== "dentro") { dizer("Entre na sua conta meu-bot (o avatar no topo) com o mesmo e-mail da assinatura e toque de novo."); return; }
    b.disabled = true; b.textContent = "Conferindo a sua conta…";
    // Relê a conta na API (o pagamento confirma em segundos) e segue pelo caminho que ela abrir.
    void window.meuBot.contaGet(true).then(async () => {
      b.disabled = false; b.textContent = "Já assinei";
      if (caminho() === "usar-da-conta") { await usarDaConta(b, row, dizer); return; }
      if (!ctx.remoto()) { await ctx.aoLiberar(); dizer("Conta relida. Se o pagamento já foi confirmado, isto abre sozinho; senão espere alguns segundos e toque de novo."); return; }
      const conta = ctx.conta()?.conta ?? null;
      // A API da conta ainda não leva a licença a máquinas: quem libera continua sendo o admin, e ele é avisado.
      if (conta !== null && conta.maquinaLimite === null) { await window.meuBot.planoAvisarPagamento().then(() => dizer("Avisei o admin: assim que ele liberar nesta máquina, isto abre sozinho."), () => dizer("Não consegui avisar o admin agora. Tente de novo em instantes.")); return; }
      dizer(ctx.origem() === "conta" ? "Esta máquina já usa a licença da sua conta, e ela ainda não tem este plano. Se acabou de pagar, espere alguns segundos e toque de novo." : "A sua conta ainda não mostra o pagamento. Costuma levar alguns segundos; toque de novo.");
    }, (err: unknown) => { b.disabled = false; b.textContent = "Já assinei"; dizer(`Não consegui ler a sua conta: ${ipcErrorText(err)}`); });
  });
}
