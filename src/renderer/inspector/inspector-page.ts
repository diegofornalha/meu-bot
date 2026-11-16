/**
 * Página "Inspector" (meu-bot-inspector-staging): a interface oficial do MCP Inspector num <webview>, já conectada ao
 * controle externo (MCP) deste app. O main sobe o Inspector pelo npx ao abrir a página (`inspector:abrir`) e devolve o
 * endereço e a partição; ele também recusa qualquer outra coisa no <webview>. Três estados: subindo, no ar e erro
 * (com o que falta, em pt-BR, e "Tentar de novo"). Fábrica com dependências explícitas, como computador-page.ts.
 */
import type { MeuBotApi } from "../../shared/ipc";
import { carregando } from "../lib/carregando.js";
import { el } from "../lib/dom.js";
import { zoomDoInspector } from "../lib/inspector-zoom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import type { PageTab } from "../lib/pages-types.js";

export interface InspectorDeps {
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  api: Pick<MeuBotApi, "inspectorAbrir">;
}

/** O pouco do <webview> que a página usa (o renderer não tem os tipos do Electron). */
interface InspectorWebview extends HTMLElement { src: string; reload(): void; setZoomFactor(fator: number): void }

type Fase = { kind: "parado" } | { kind: "subindo" } | { kind: "no-ar"; versao: string } | { kind: "erro"; texto: string };

export function mountInspector(deps: InspectorDeps): { open: () => void } {
  // As classes do Computador servem: cabeçalho de estado em cima, o <webview> ocupando o resto do painel.
  const panel = el("section", "acervo-panel computador-panel inspector-panel"); panel.hidden = true;
  deps.panelsEl.append(panel);
  const estadoBox = el("div", "computador-estado");
  const telaBox = el("div", "computador-tela");
  panel.append(estadoBox, telaBox);

  let fase: Fase = { kind: "parado" };
  let wv: InspectorWebview | null = null;
  let geracao = 0;

  const btn = (label: string, cls: string, run: () => void): HTMLButtonElement => { const b = el("button", `btn ${cls}`, label); b.type = "button"; b.addEventListener("click", run); return b; };
  function fechar(): void { geracao += 1; wv?.remove(); wv = null; pronto = false; }
  /** O <webview> só aceita zoom depois do dom-ready; a largura muda com a janela, a barra lateral e a tela dividida. */
  let pronto = false;
  function ajustarZoom(): void {
    if (wv === null || !pronto || telaBox.clientWidth === 0) return;
    try { wv.setZoomFactor(zoomDoInspector(telaBox.clientWidth)); } catch { /* webview saindo: o próximo dom-ready ajusta */ }
  }
  new ResizeObserver(ajustarZoom).observe(telaBox);

  async function subir(): Promise<void> {
    fechar();
    const minha = geracao;
    fase = { kind: "subindo" }; render();
    let r: Awaited<ReturnType<typeof deps.api.inspectorAbrir>>;
    try { r = await deps.api.inspectorAbrir(); } catch (e) { r = { ok: false, erro: ipcErrorText(e) }; }
    if (minha !== geracao) return;
    if (!r.ok) { fase = { kind: "erro", texto: r.erro }; render(); return; }
    const v = document.createElement("webview") as InspectorWebview;
    v.setAttribute("partition", r.particao);
    v.setAttribute("webpreferences", "contextIsolation=yes,sandbox=yes,nodeIntegration=no");
    v.className = "computador-webview";
    v.src = r.url;
    // O processo do Inspector caiu (ou a página não carregou): volta ao cartão de erro, com o botão de subir de novo.
    v.addEventListener("did-fail-load", (ev) => {
      const e = ev as Event & { errorCode?: number; isMainFrame?: boolean };
      if (minha !== geracao || e.isMainFrame === false || e.errorCode === -3) return; // -3 = navegação trocada no meio, não é falha
      fechar(); fase = { kind: "erro", texto: "A interface do Inspector parou de responder (o processo dele saiu). Clique em Tentar de novo para subir outra vez." }; render();
    });
    v.addEventListener("render-process-gone", () => { if (minha !== geracao) return; fechar(); fase = { kind: "erro", texto: "A página do Inspector fechou sozinha. Clique em Tentar de novo." }; render(); });
    // A interface do Inspector não encolhe abaixo de 1280 px: o zoom acompanha a largura do painel (ver inspector-zoom.ts).
    v.addEventListener("dom-ready", () => { if (minha !== geracao) return; pronto = true; ajustarZoom(); });
    pronto = false; wv = v; telaBox.replaceChildren(v);
    fase = { kind: "no-ar", versao: r.versao }; render();
  }

  function render(): void {
    if (panel.hidden) return;
    telaBox.hidden = fase.kind !== "no-ar";
    const head = el("div", "computador-head");
    head.append(el("span", "tut-badge", "inspector"));
    if (fase.kind === "no-ar") {
      head.append(el("span", "hint", `MCP Inspector ${fase.versao} · ligado ao controle externo (MCP) deste app`), btn("Reiniciar", "btn-ghost btn-small", () => { void subir(); }));
      estadoBox.replaceChildren(head);
      return;
    }
    if (fase.kind === "subindo" || fase.kind === "parado") {
      estadoBox.replaceChildren(head, carregando("Subindo o MCP Inspector…", "inspector-subindo", "Na primeira vez o npx baixa o pacote do Inspector; pode levar um minuto."));
      return;
    }
    const c = el("div", "admin-card computador-card");
    c.append(el("strong", "", "O Inspector não subiu"), el("p", "", fase.texto), btn("Tentar de novo", "btn-primary", () => { void subir(); }));
    estadoBox.replaceChildren(head, c);
  }

  const page = deps.definePage("inspector", "Inspector", panel, () => { render(); if (fase.kind === "parado") void subir(); });
  return { open: () => deps.openPage(page) };
}
