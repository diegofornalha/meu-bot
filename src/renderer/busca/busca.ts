/**
 * Busca na página (Cmd+F) e folha de atalhos (Cmd+/).
 *
 * Quem procura depende do foco, porque ⌘F já tinha dono antes: com o terminal em foco ele busca no terminal
 * (terminal.ts trata e nem chega aqui); com o Navegador em foco, busca dentro do `<webview>`, que é a página que
 * a pessoa está olhando; no resto, busca no conteúdo da janela pelo `findInPage` do main.
 */
import { byId as $ } from "../lib/dom.js";
import { textoResultado, ATALHOS } from "../lib/busca-core.js";
import { rotuloTeclas } from "../lib/teclas-core.js";

/** O `<webview>` do Navegador quando ele é quem está em foco; null = a busca é da janela. */
export type AlvoWebview = {
  findInPage(t: string, o?: { forward?: boolean; findNext?: boolean }): void;
  stopFindInPage(a: string): void;
  addEventListener(t: string, f: (e: unknown) => void): void;
  removeEventListener(t: string, f: (e: unknown) => void): void;
} | null;

const barra = $<HTMLElement>("find-bar");
const campo = $<HTMLInputElement>("find-input");
const contador = $<HTMLElement>("find-count");
const anterior = $<HTMLButtonElement>("find-prev");
const proximo = $<HTMLButtonElement>("find-next");
const fechar = $<HTMLButtonElement>("find-close");
const folha = $<HTMLDialogElement>("atalhos-folha");
const folhaCorpo = $<HTMLElement>("atalhos-folha-corpo");
const folhaFechar = $<HTMLButtonElement>("atalhos-folha-fechar");

let resultado: { atual: number; total: number } | null = null;
/** Onde a busca aberta está procurando; fixado ao abrir, para o foco mudar sem a busca pular de alvo. */
let alvo: AlvoWebview = null;
let ouvindoWebview: ((e: unknown) => void) | null = null;
/** Quem diz, na hora de abrir, se o Navegador está em foco (injetado pelo renderer.ts, que conhece as páginas). */
let webviewEmFoco: () => AlvoWebview = () => null;
export const ligarAlvoWebview = (f: () => AlvoWebview): void => { webviewEmFoco = f; };

const pintar = (): void => { contador.textContent = textoResultado(resultado, campo.value); };

function procurar(proximoResultado: boolean, adiante = true): void {
  const texto = campo.value;
  if (!proximoResultado) resultado = null;
  pintar();
  if (alvo !== null) {
    if (texto === "") alvo.stopFindInPage("clearSelection");
    else alvo.findInPage(texto, { forward: adiante, findNext: proximoResultado });
    return;
  }
  void window.meuBot.findInPage(texto, { adiante, proximo: proximoResultado });
}

/** Abre a barra. Com texto selecionado na página, ele já entra no campo, como no Safari. */
export function abrirBusca(selecionado = ""): void {
  const novoAlvo = webviewEmFoco();
  if (novoAlvo !== alvo) { pararBusca(false); alvo = novoAlvo; }
  if (alvo !== null && ouvindoWebview === null) {
    ouvindoWebview = (e: unknown) => {
      const r = (e as { result?: { activeMatchOrdinal?: number; matches?: number } }).result;
      resultado = { atual: r?.activeMatchOrdinal ?? 0, total: r?.matches ?? 0 };
      pintar();
    };
    alvo.addEventListener("found-in-page", ouvindoWebview);
  }
  barra.hidden = false;
  if (selecionado !== "" && !selecionado.includes("\n")) campo.value = selecionado.slice(0, 200);
  campo.focus(); campo.select();
  if (campo.value !== "") procurar(false);
}

/** Fecha a barra e tira o realce. `esconder` = false serve para trocar de alvo sem piscar a barra. */
export function pararBusca(esconder = true): void {
  if (alvo !== null) {
    alvo.stopFindInPage("clearSelection");
    if (ouvindoWebview !== null) { alvo.removeEventListener("found-in-page", ouvindoWebview); ouvindoWebview = null; }
  } else {
    void window.meuBot.stopFindInPage();
  }
  resultado = null;
  if (esconder) { barra.hidden = true; alvo = null; }
  pintar();
}

export const buscaAberta = (): boolean => !barra.hidden;

/** A tecla dos atalhos nesta plataforma (caps.teclaCmd, que o renderer informa ao receber a janela): a folha escreve ⌘ ou Ctrl. */
let teclaCmd = true;
export const usarTeclaCmd = (cmd: boolean): void => { teclaCmd = cmd; };

/** A folha de atalhos (Cmd+/). Desenhada uma vez: a lista é fixa. */
export function abrirAtalhos(): void {
  if (folha.open) { folha.close(); return; }
  if (folhaCorpo.childElementCount === 0) {
    for (const g of ATALHOS) {
      const sec = document.createElement("section"); sec.className = "atalhos-grupo";
      const h = document.createElement("h3"); h.textContent = g.titulo; sec.append(h);
      const dl = document.createElement("dl");
      for (const a of g.atalhos) {
        const dt = document.createElement("dt"); dt.textContent = rotuloTeclas(a.teclas, teclaCmd);
        const dd = document.createElement("dd"); dd.textContent = a.o_que;
        dl.append(dt, dd);
      }
      sec.append(dl); folhaCorpo.append(sec);
    }
  }
  folha.showModal();
}

export function ligarBusca(): void {
  campo.addEventListener("input", () => procurar(false));
  campo.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); procurar(true, !ev.shiftKey); return; }
    if (ev.key === "Escape") { ev.preventDefault(); pararBusca(); }
  });
  proximo.addEventListener("click", () => procurar(true, true));
  anterior.addEventListener("click", () => procurar(true, false));
  fechar.addEventListener("click", () => pararBusca());
  folhaFechar.addEventListener("click", () => folha.close());
  window.meuBot.on("find:result", (r) => { if (alvo === null) { resultado = r; pintar(); } });
  window.meuBot.on("ui:abrir", (p) => {
    if (p.oQue === "busca") abrirBusca(String(window.getSelection() ?? ""));
    else abrirAtalhos();
  });
}
