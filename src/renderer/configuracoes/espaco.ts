/**
 * Seção "Espaço" das Configurações: quanto a pessoa usa da cota da máquina, o que ocupa, Liberar espaço (apaga caches
 * do agente, pastas de trabalho e sessões antigas do WhatsApp, com confirmação em dois cliques) e Aumentar espaço
 * (como pagar + pedir ao admin). Quem decide quando repintar é o renderer, por `paintEspaco` e `ctx.atualizarCota`.
 */
import type { CotaInfo, Pagamento } from "../../shared/ipc";
import { byId as $, el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { caminhoRelativo, tam, textoEspaco, toneEspaco } from "../lib/espaco.js";
import { ctx } from "../app/ctx.js";

type Maiores = { home: string | null; itens: { kb: number; pasta: boolean; caminho: string }[] };
type CtxCota = { atualizarCota?: (c: CotaInfo | null) => void; refreshLicense?: () => Promise<unknown> };

let pediuMais = false;

const botao = (texto: string, classe: string, run: (b: HTMLButtonElement) => void): HTMLButtonElement => {
  const b = el("button", `btn ${classe} btn-small`, texto); b.type = "button";
  b.addEventListener("click", () => run(b));
  return b;
};
const avisarCota = (c: CotaInfo | null): void => { (ctx as unknown as CtxCota).atualizarCota?.(c); };

/** Pinta a seção; `undefined` = backend antigo (sem a rota), `null` = conta sem limite. */
export function paintEspaco(c: CotaInfo | null | undefined): void {
  const grupo = $<HTMLElement>("espaco-group");
  const body = $<HTMLElement>("espaco-body");
  const sum = document.getElementById("espaco-sum");
  grupo.hidden = !ctx.caps.chat || ctx.windowHost === "local";
  body.replaceChildren();
  if (c === undefined) {
    if (sum !== null) sum.textContent = "";
    body.append(el("p", "hint", "A máquina ainda não tem o backend novo (1.9): ele atualiza sozinho quando a máquina estiver livre."));
    return;
  }
  if (c === null) {
    if (sum !== null) sum.textContent = "";
    body.append(el("p", "hint", "Esta conta não tem limite de espaço."));
    return;
  }
  const pct = Math.round(c.pct);
  if (sum !== null) sum.textContent = `${pct}% de ${tam(c.limiteKb)}`;
  const tom = toneEspaco(c.pct);
  const barra = el("div", `espaco-barra${tom === null ? "" : ` ${tom}`}`);
  const fill = el("i"); fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  barra.append(fill);
  let linha = textoEspaco(c);
  if (c.nivel === "cheio" && c.hardKb !== null && c.grace !== null) linha += ` · passou do limite, folga até ${tam(c.hardKb)} por ${c.grace}`;
  body.append(barra, el("p", "", linha));
  if (c.itens.length > 0) {
    body.append(el("strong", "", "O que ocupa"));
    const ul = el("ul", "espaco-itens");
    for (const i of [...c.itens].sort((a, b) => b.kb - a.kb)) ul.append(el("li", "", `${i.rotulo} · ${tam(i.kb)}`));
    body.append(ul);
  }
  body.append(el("p", "hint", "Para apagar conversas, exclua-as na lista do meu-bot. Publicações saem do ar em Tutoriais › Seu link público."));
  const row = el("div", "actions");
  const extra = el("div", "espaco-extra");
  row.append(
    botao("Liberar espaço", "btn-ghost", (b) => { b.disabled = true; void mostrarLiberar(extra).finally(() => { b.disabled = false; }); }),
    botao("Aumentar espaço", c.nivel !== "ok" ? "btn-primary" : "btn-ghost", (b) => { b.disabled = true; void mostrarAumentar(extra, pct).finally(() => { b.disabled = false; }); }),
  );
  body.append(row, extra);
}

async function mostrarLiberar(alvo: HTMLElement): Promise<void> {
  alvo.replaceChildren(el("p", "hint", "Vendo o que ocupa…"));
  try { pintarMaiores(alvo, await window.meuBot.cotaMaiores()); } catch (err) { alvo.replaceChildren(el("p", "hint", `Não consegui ver o que ocupa: ${ipcErrorText(err)}`)); }
}

function pintarMaiores(alvo: HTMLElement, lista: Maiores): void {
  alvo.replaceChildren();
  if (lista.itens.length === 0) { alvo.append(el("p", "hint", "Nada que dê para apagar por aqui: o que sobra são programas do agente e a sessão do WhatsApp.")); return; }
  const box = el("div", "espaco-liberar");
  box.append(el("strong", "", "Dá para apagar"));
  const erro = el("p", "hint"); erro.hidden = true;
  for (const i of lista.itens) {
    const linha = el("div", "espaco-linha");
    linha.append(el("span", "espaco-tam", tam(i.kb)), el("span", "espaco-caminho", caminhoRelativo(lista.home, i.caminho) + (i.pasta ? "/" : "")));
    let armado: ReturnType<typeof setTimeout> | null = null;
    const b = botao("Apagar", "btn-ghost", () => {
      if (armado === null) {
        b.textContent = "Confirmar? apaga de vez"; b.classList.add("btn-bad");
        armado = setTimeout(() => { armado = null; b.textContent = "Apagar"; b.classList.remove("btn-bad"); }, 5000);
        return;
      }
      clearTimeout(armado); armado = null;
      b.disabled = true; b.textContent = "Apagando…"; erro.hidden = true;
      void window.meuBot.cotaApagarItem(i.caminho).then(async (nova: Maiores) => {
        pintarMaiores(alvo, nova);
        try { avisarCota(await window.meuBot.cotaStatus()); } catch { /* a barra atualiza na próxima leitura */ }
      }, (err: unknown) => {
        b.disabled = false; b.textContent = "Apagar"; b.classList.remove("btn-bad");
        erro.hidden = false; erro.textContent = `Não consegui apagar: ${ipcErrorText(err)}`;
      });
    });
    linha.append(b);
    box.append(linha);
  }
  box.append(erro);
  alvo.append(box);
}

/** Como pagar, da licença já lida (a mesma fonte de `pagamentoDoBloqueio`); lida em função para o TS não congelar o getter. */
const pagamentoAtual = (): Pagamento | null => ctx.license?.license.pagamento ?? null;

async function mostrarAumentar(alvo: HTMLElement, pct: number): Promise<void> {
  if (ctx.license === null) {
    const refresh = (ctx as unknown as CtxCota).refreshLicense;
    if (refresh !== undefined) { try { await refresh(); } catch { /* sem licença: só o pedido ao admin */ } }
  }
  alvo.replaceChildren(blocoAumentarEspaco(pagamentoAtual(), pct));
}

/** Como pagar (se o admin gravou instruções/link) e "Pedir mais espaço ao admin". */
export function blocoAumentarEspaco(p: { instrucoes?: string; link?: string | null } | null, pct: number): HTMLElement {
  const box = el("div", "plano-pagamento espaco-aumentar");
  box.append(el("strong", "", "Aumentar espaço"));
  const instrucoes = p?.instrucoes ?? "";
  if (instrucoes !== "") box.append(el("p", "plano-pagamento-texto", instrucoes));
  const row = el("div", "actions");
  if (instrucoes !== "") row.append(botao("Copiar", "btn-ghost", (b) => { void navigator.clipboard.writeText(instrucoes).then(() => { b.textContent = "Copiado ✓"; }, () => { b.textContent = "Não consegui copiar"; }); }));
  const link = p?.link ?? null;
  if (link !== null && link !== "") row.append(botao("Abrir o link de pagamento", "btn-ghost", () => { void window.meuBot.openExternal(link); }));
  const nota = el("p", "hint"); nota.hidden = true;
  const pedir = botao(pediuMais ? "Admin avisado ✓" : "Pedir mais espaço ao admin", "btn-primary", (b) => {
    b.disabled = true;
    void window.meuBot.cotaPedirMais(pct).then(() => {
      pediuMais = true; b.textContent = "Admin avisado ✓";
      nota.hidden = false; nota.textContent = "Admin avisado ✓ · quando ele aumentar, a barra atualiza sozinha";
    }, (err: unknown) => { b.disabled = false; nota.hidden = false; nota.textContent = `Não consegui avisar o admin agora: ${ipcErrorText(err)}`; });
  });
  pedir.disabled = pediuMais;
  row.append(pedir);
  box.append(row, nota);
  return box;
}
