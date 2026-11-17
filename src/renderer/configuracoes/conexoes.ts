/**
 * Configurações › Conexões: os MCPs de terceiros do catálogo (Salvy…) no Claude Code deste Mac. Uma linha por item,
 * montada da visão do main (ConexoesView), sem HTML por conector. Conectar registra no escopo user pelo `claude` CLI;
 * o login é no /mcp do Claude Code. Ao voltar o foco para a janela relê (a pessoa pode ter mexido pelo terminal).
 */
import type { ConexaoView, ConexoesView } from "../../shared/ipc";
import { byId as $, el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";

const listaEl = $<HTMLElement>("conexoes-lista");
const sumEl = $<HTMLElement>("conexoes-sum");
const avisoEl = $<HTMLElement>("conexoes-aviso");
const SUM_PADRAO = "ferramentas de outros serviços no seu Claude Code";

let view: ConexoesView | null = null;
let ocupado: string | null = null;
let avisoTimer: ReturnType<typeof setTimeout> | null = null;

function avisar(texto: string, ok = true): void {
  avisoEl.textContent = texto; avisoEl.className = `hint ${ok ? "ok" : "bad"}`; avisoEl.hidden = false;
  if (avisoTimer !== null) clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { avisoEl.hidden = true; }, 10000);
}

/** O texto do estado e o botão principal de uma linha. */
export function textoDaLinha(c: ConexaoView): { estado: string; classe: "ok" | "bad" | ""; botao: "Conectar" | "Substituir" | null } {
  switch (c.estado) {
    case "ausente": return { estado: "não conectado", classe: "", botao: "Conectar" };
    case "registrado": return { estado: "conectado no Claude Code (o login é no /mcp)", classe: "ok", botao: null };
    case "outra-config": return { estado: `já existe um "${c.id}" com outra configuração (${c.atual})`, classe: "bad", botao: "Substituir" };
    case "ilegivel": return { estado: "o ~/.claude.json não é um JSON válido; não mexo nele", classe: "bad", botao: null };
  }
}

function pintar(v: ConexoesView): void {
  view = v;
  listaEl.replaceChildren();
  for (const c of v.itens) {
    const t = textoDaLinha(c);
    const linha = el("div", "conexao");
    const topo = el("div", "row");
    topo.append(el("strong", "", c.nome), el("span", `hint ${t.classe}`.trim(), t.estado));
    if (t.botao !== null) {
      const b = el("button", "btn btn-primary btn-small", ocupado === c.id ? "…" : t.botao); b.type = "button";
      b.disabled = ocupado !== null || !v.cli;
      if (t.botao === "Substituir") b.title = `Troca a entrada "${c.id}" atual pela do catálogo (${c.url})`;
      b.addEventListener("click", () => { void agir(c.id, () => window.meuBot.conexoesConectar(c.id), `${c.nome} conectado. No Claude Code, rode /mcp, escolha "${c.id}" e clique em Authenticate para entrar.`); });
      topo.append(b);
    }
    if (c.estado === "registrado" || c.estado === "outra-config") {
      const d = el("button", "btn btn-ghost btn-small", "Desconectar"); d.type = "button"; d.disabled = ocupado !== null || !v.cli;
      d.addEventListener("click", () => { void agir(c.id, () => window.meuBot.conexoesDesconectar(c.id), `${c.nome} saiu do Claude Code.`); });
      topo.append(d);
    }
    const g = el("button", "btn btn-ghost btn-small", "Guia"); g.type = "button"; g.title = c.guia;
    g.addEventListener("click", () => { void window.meuBot.conexoesAbrirGuia(c.id).catch((err: unknown) => avisar(ipcErrorText(err), false)); });
    topo.append(g);
    linha.append(topo, el("p", "hint", `${c.descricao} ${c.aviso}`));
    if (!v.cli) linha.append(el("p", "hint bad", `Não achei o comando claude neste Mac. No terminal: claude mcp add --scope user --transport http ${c.id} ${c.url}`));
    listaEl.append(linha);
  }
  const conectados = v.itens.filter((c) => c.estado === "registrado").length;
  sumEl.textContent = conectados === 0 ? SUM_PADRAO : `${conectados} conectad${conectados === 1 ? "a" : "as"} no Claude Code`;
}

async function agir(id: string, fn: () => Promise<ConexoesView>, depois: string): Promise<void> {
  ocupado = id; if (view !== null) pintar(view);
  try { const v = await fn(); ocupado = null; pintar(v); avisar(depois); }
  catch (err) { ocupado = null; if (view !== null) pintar(view); avisar(ipcErrorText(err), false); }
}

/** Ao abrir as Configurações: lê o estado atual. */
export function carregarConexoes(): void {
  void window.meuBot.conexoesStatus().then(pintar).catch((err: unknown) => avisar(`Não consegui ler as conexões: ${ipcErrorText(err)}`, false));
}

/** Liga eventos uma vez. */
export function ligarConexoes(): void {
  window.addEventListener("focus", () => { if (view !== null && ocupado === null) carregarConexoes(); });
}
