/**
 * Página "Computador" (módulo Pro): a tela da máquina do bot ao vivo, via noVNC num <webview> pelo túnel SSH.
 * O estado (texto e ação) vem de lib/computador-core.ts; a url e a partição vêm do main (computador:url), que também
 * recusa qualquer outra coisa no <webview>. Sem consulta periódica: relê ao abrir, ao voltar o foco e ao tentar de novo.
 * Fábrica com dependências explícitas, como conta-google-page.ts.
 */
import type { LicenseView, MeuBotApi, PlanName, TelaStatus } from "../../shared/ipc";
import { browserAccess, pagamentoDoBloqueio, proBlockText } from "../lib/pro.js";
import { blocoPagamento } from "../lib/aviso-pagamento.js";
import { PINTOU_INTERVALO_MS, PINTOU_TENTATIVAS, estadoComputador, registrarQueda, type AcaoComputador, type FaseComputador } from "../lib/computador-core.js";
import { el } from "../lib/dom.js";
import { carregando } from "../lib/carregando.js";
import type { PageTab } from "../lib/pages-types.js";
import { ipcErrorText } from "../lib/ipc-error.js";

export interface ComputadorDeps {
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  host: () => string;
  local: () => boolean;
  license: () => LicenseView | null;
  licenseKnown: () => boolean;
  planoExigido: PlanName;
  produto: string;
  api: Pick<MeuBotApi, "browserRequestPro" | "computadorStatus" | "computadorAcordar" | "computadorInstalar" | "computadorUrl" | "openPicker">;
}

/** O pouco do <webview> que a tela usa (o renderer não tem os tipos do Electron). */
interface TelaWebview extends HTMLElement { src: string; reload(): void; executeJavaScript(code: string): Promise<unknown> }

/** Quanto esperar o noVNC conectar (classe noVNC_connected) antes de dizer que não veio imagem. */
const PRAZO_CONEXAO_MS = 20_000;

export function mountComputador(deps: ComputadorDeps): { open: () => void; repintar: () => void } {
  const panel = el("section", "acervo-panel computador-panel"); panel.hidden = true;
  deps.panelsEl.append(panel);
  const estadoBox = el("div", "computador-estado");
  const telaBox = el("div", "computador-tela");
  panel.append(estadoBox, telaBox);

  let status: TelaStatus | null = null;
  let fase: FaseComputador = "parado";
  let precisaAdmin = false;
  let quedas: number[] = []; let caiuDemais = false;
  let semImagem = false;
  let proPedido = false;
  let nota: { text: string; bad: boolean } | null = null;
  let wv: TelaWebview | null = null;
  let geracao = 0;

  const acesso = (): ReturnType<typeof browserAccess> => browserAccess(deps.license(), deps.host(), deps.planoExigido, deps.produto);
  const btn = (label: string, cls: string, run: () => void): HTMLButtonElement => { const b = el("button", `btn ${cls}`, label); b.type = "button"; b.addEventListener("click", run); return b; };

  function fecharTela(): void { geracao += 1; wv?.remove(); wv = null; }

  async function lerStatus(): Promise<void> {
    if (deps.local()) { render(); return; }
    try { status = await deps.api.computadorStatus(); } catch (e) { status = { instalada: false, rodando: false, erro: ipcErrorText(e) }; }
    render();
    if (status.rodando && wv === null && fase !== "acordando") void abrirTela();
  }

  async function abrirTela(): Promise<void> {
    fecharTela();
    const minha = geracao;
    semImagem = false; fase = "conectando"; render();
    let end: { url: string; particao: string };
    try { end = await deps.api.computadorUrl(); } catch (e) { fase = "parado"; nota = { text: ipcErrorText(e), bad: true }; await lerStatus(); return; }
    if (minha !== geracao) return;
    const v = document.createElement("webview") as TelaWebview;
    v.setAttribute("partition", end.particao);
    v.setAttribute("webpreferences", "contextIsolation=yes,sandbox=yes,nodeIntegration=no");
    v.className = "computador-webview";
    v.src = end.url;
    v.addEventListener("render-process-gone", () => {
      const q = registrarQueda(quedas, Date.now()); quedas = q.quedas; caiuDemais = q.caiuDemais;
      if (caiuDemais) { fecharTela(); fase = "parado"; render(); } else v.reload();
    });
    v.addEventListener("did-finish-load", () => { void esperarImagem(v, minha); });
    wv = v; telaBox.replaceChildren(v);
    render();
  }

  /** Conectou (classe noVNC_connected) e o canvas já tem pixel: a mesma prova do Grok Bot, com prazo. */
  async function esperarImagem(v: TelaWebview, minha: number): Promise<void> {
    const inicio = Date.now();
    const vivo = (): boolean => minha === geracao && wv === v;
    while (vivo() && Date.now() - inicio < PRAZO_CONEXAO_MS) {
      const ok = await v.executeJavaScript('document.documentElement.classList.contains("noVNC_connected")').catch(() => false) as boolean;
      if (ok) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    for (let i = 0; vivo() && i < PINTOU_TENTATIVAS; i++) {
      const pintou = await v.executeJavaScript(`(() => { const cs = [...document.querySelectorAll("canvas")]; const c = cs.sort((a, b) => b.width * b.height - a.width * a.height)[0]; if (!c || !c.width) return false; const g = c.getContext("2d"); if (!g) return true; const pts = [[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]]; return pts.some(([x, y]) => g.getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data[3] > 0); })()`).catch(() => false) as boolean;
      if (pintou) { fase = "ao-vivo"; render(); return; }
      await new Promise((r) => setTimeout(r, PINTOU_INTERVALO_MS));
    }
    if (vivo()) { semImagem = true; render(); }
  }

  async function agir(acao: AcaoComputador): Promise<void> {
    nota = null;
    if (acao === "maquina") { void deps.api.openPicker(); return; } // o seletor, como "Nova janela em outra máquina" da paleta
    if (acao === "status") { status = null; render(); await lerStatus(); return; }
    if (acao === "reconectar") { quedas = []; caiuDemais = false; await abrirTela(); return; }
    if (acao === "instalar") {
      fase = "instalando"; render();
      try {
        const r = await deps.api.computadorInstalar();
        precisaAdmin = !r.ok && r.codigo === 3;
        if (!r.ok && !precisaAdmin) nota = { text: `A instalação parou: ${r.log.at(-1) ?? `código ${r.codigo ?? "?"}`}`, bad: true };
      } catch (e) { nota = { text: ipcErrorText(e), bad: true }; }
      fase = "parado"; status = null; render(); await lerStatus();
      const depois = status as TelaStatus | null;
      if (depois !== null && depois.erro === null && depois.instalada && !depois.rodando) await agir("acordar");
      return;
    }
    fase = "acordando"; render();
    try { status = await deps.api.computadorAcordar(); } catch (e) { status = { instalada: true, rodando: false, erro: ipcErrorText(e) }; }
    fase = "parado"; render();
    if (status.rodando) await abrirTela();
    else if (status.erro === null) nota = { text: "A máquina não ligou a tela a tempo. Tente acordar de novo em instantes.", bad: true };
    render();
  }

  function render(): void {
    if (panel.hidden) return;
    if (!deps.local() && !deps.licenseKnown()) { estadoBox.replaceChildren(carregando("Consultando a licença desta máquina…")); return; }
    const a = acesso();
    const est = estadoComputador({ local: deps.local(), acesso: a, status, fase, instalacaoPrecisaAdmin: precisaAdmin, caiuDemais, semImagem });
    telaBox.hidden = !est.mostrarTela;
    if (!est.mostrarTela && wv !== null && est.kind !== "caiu") fecharTela();
    // Título no lugar da etiqueta verde; com a tela à mostra ele encolhe, para a tela ficar com a altura.
    const head = el("div", est.mostrarTela ? "computador-head com-tela" : "computador-head");
    head.append(el("h2", "", "Computador"));
    if (est.kind === "sem-plano" && a !== "ok") {
      const t = proBlockText(a, deps.license(), "computador", deps.produto);
      const c = el("div", "admin-card"); c.append(el("strong", "", t.title), el("p", "", t.text));
      const pg = pagamentoDoBloqueio(a, deps.license());
      if (pg !== null) c.append(blocoPagamento(pg));
      if (t.askAdmin) {
        const b = btn(proPedido ? "Pedido enviado ao admin ✓" : a === "expired" ? "Pedir a renovação ao admin" : a === "assinatura" ? "Avisar o admin" : "Pedir o Pro ao admin", pg !== null ? "btn-ghost" : "btn-primary", () => { b.disabled = true; void deps.api.browserRequestPro().then(() => { proPedido = true; render(); }, () => { b.disabled = false; }); });
        b.disabled = proPedido; c.append(b);
      }
      estadoBox.replaceChildren(head, c);
      return;
    }
    if (est.kind === "ao-vivo") {
      head.append(el("span", "hint", "ao vivo · o que o agente vê na máquina"), btn("Reconectar", "btn-ghost btn-small", () => { void agir("reconectar"); }));
      estadoBox.replaceChildren(head);
      return;
    }
    const c = el("div", "admin-card computador-card");
    c.append(el("strong", "", est.titulo));
    if (est.texto !== "") c.append(el("p", "", est.texto));
    if (est.acao !== null && est.botao !== null) { const acao = est.acao; const pa = el("div", "admin-actions"); pa.append(btn(est.botao, "btn-primary", () => { void agir(acao); })); c.append(pa); }
    if (nota !== null) c.append(el("p", `hint ${nota.bad ? "bad-hint" : ""}`, nota.text));
    estadoBox.replaceChildren(head, c);
  }

  window.addEventListener("focus", () => { if (!panel.hidden && fase === "parado" && wv === null) void lerStatus(); });
  const page = deps.definePage("computador", "Computador", panel, () => { render(); if (status === null || wv === null) void lerStatus(); });
  return { open: () => deps.openPage(page), repintar: () => { if (!panel.hidden) render(); } };
}
