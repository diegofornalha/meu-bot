/**
 * Peças das páginas "resumo em uma linha → clique abre o detalhe" (25 nov): o cabeçalho único (h2 + uma frase, sem a
 * etiqueta verde que repetia o título) e a seção que abre. Antes cada página copiava `guide-head` + `tut-badge` à mão e
 * empilhava cartões com tudo à vista. Estilo em style.css (`.pagina-cab`, `.pagina-secao`); a decisão de abrir é pura,
 * em secao-core.ts. Precisa de `document`.
 */
import { el } from "./dom.js";
import { resolverSecao } from "./secao-core.js";
import type { SecaoGuardada } from "./secao-core.js";

/** Cabeçalho padrão de página: o título e uma frase. O resto da explicação vai para dentro das seções. */
export function cabecalho(titulo: string, descricao: string): HTMLElement {
  const c = el("header", "pagina-cab");
  c.append(el("h2", "", titulo), el("p", "", descricao));
  return c;
}

export interface SecaoOpcoes {
  /** Identifica a seção entre repinturas (ex.: "conta-google:backup"): é por ela que o aberto/fechado é lembrado. */
  chave: string;
  titulo: string;
  /** O estado em uma linha, em texto apagado, à vista com a seção fechada. */
  resumo: string;
  /** Como nasce enquanto a pessoa não clicou. Padrão: fechada. */
  aberta?: boolean;
  /** Motivo para abrir sozinha (erro, algo faltando, trabalho em curso); "" ou ausente = nenhum. Veja secao-core.ts. */
  atencao?: string;
  /** A única ação à vista na linha, mesmo com a seção fechada. As demais ficam no corpo. */
  acao?: HTMLButtonElement;
}
export interface Secao {
  /** O que a página põe no painel. */
  raiz: HTMLElement;
  /** Onde a página põe o detalhe; some com a seção fechada. */
  corpo: HTMLElement;
}

// Em memória, por janela: as páginas fazem `replaceChildren()` a cada ação, e sem isto a seção fecharia na cara da pessoa.
const guardadas = new Map<string, SecaoGuardada>();

/**
 * Seção que abre: um `<details>` (teclado e leitor de tela de graça) cujo `<summary>` é a linha título · resumo · ›.
 * A ação e o corpo são IRMÃOS do `<details>`, não filhos: botão dentro de `<summary>` alternaria a seção ao clicar, e
 * fora dele o `<details>` não deixa pôr nada na mesma linha. O CSS esconde o corpo enquanto o `<details>` está fechado.
 */
export function secao(o: SecaoOpcoes): Secao {
  const atencao = o.atencao ?? "";
  const r = resolverSecao(guardadas.get(o.chave), o.aberta ?? false, atencao);
  if (r.guardar === undefined) guardadas.delete(o.chave); else guardadas.set(o.chave, r.guardar);
  const raiz = el("div", "pagina-secao");
  const d = el("details"); d.open = r.aberta;
  const s = el("summary");
  s.append(el("span", "pagina-secao-titulo", o.titulo), el("span", "sum-hint", o.resumo));
  d.append(s);
  // `toggle` também dispara para o `open` posto acima (assíncrono): só conta quando muda em relação ao que se pintou.
  let pintada = r.aberta;
  d.addEventListener("toggle", () => { if (d.open === pintada) return; pintada = d.open; guardadas.set(o.chave, { aberta: d.open, atencao }); });
  const corpo = el("div", "pagina-secao-corpo"); corpo.setAttribute("role", "group"); corpo.setAttribute("aria-label", o.titulo);
  raiz.append(d);
  if (o.acao !== undefined) { o.acao.classList.add("pagina-secao-acao"); raiz.append(o.acao); }
  raiz.append(corpo);
  return { raiz, corpo };
}
