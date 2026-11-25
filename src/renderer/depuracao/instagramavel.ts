/**
 * Modo instagramável: com a depuração ligada, mostra na janela o que o agente está vendo no Navegador.
 *  - Marcas: quando o agente lê uma página (/ler), cada elemento numerado que está à vista ganha uma seta colorida com
 *    o número e o texto dele, o mesmo número do clicar/digitar. Cada aba guarda as marcas da sua última leitura e a
 *    janela mostra as da aba que está à vista: trocou de aba, trocam as marcas; outra tela (terminal), somem; voltou,
 *    voltam. As de uma aba valem até a página dela mudar (log do Navegador que mexe nela, endereço diferente) ou
 *    MARCAS_MS depois da leitura.
 *  - Lista: os logs sem lugar na página (nota, abrir aba, terminal) ficam numa coluna fixa no canto de baixo, à direita, com quem
 *    agiu e o que fez; saem aos poucos depois de SILENCIO_MS, ou na hora, um a um, pelo × de cada aviso.
 * O cursor do agente (cursor-agente.ts, o modo "real") tem a cena: enquanto ele está nela, marcas e lista saem.
 * Nada aqui se mexe sozinho. Liga no seletor (o ✨ colado no Intro) ou na paleta; gravado em `instagramavel`.
 */
import type { EventoDepuracao, MarcasDepuracao, SettingsView } from "../../shared/ipc";
import { byId as $ } from "../lib/dom.js";
import { LISTA_MAX, MARCAS_MS, MAX_CURSORES, SAIDA_MS, SILENCIO_MS, corDaMarca, marcasNaTela, rotuloDoDono, textoDoBalao } from "../lib/instagramavel-core.js";
import { faixaLigada } from "./faixa.js";
import { aoMudarCena, pontoReal, realEmCena, retanguloDaAba, urlDaAba } from "./cursor-agente.js";
import { ctx } from "../app/ctx.js";

const palco = $<HTMLElement>("insta-palco");
const SETA = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 2l16 11.5-7 1.2 4.2 7.3-3 1.7-4.2-7.3L5 21z" fill="currentColor" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
/** Logs do Navegador que não mudam a página: as marcas continuam valendo depois deles. */
const NAO_MEXE = new Set(["/ler", "/print", "/js", "/abas", "/diag"]);
let ligado = false;
const marcasEl = Object.assign(document.createElement("div"), { className: "insta-marcas" });
const listaEl = Object.assign(document.createElement("div"), { className: "insta-lista" });
/** A última leitura de cada aba (id do webContents): as marcas, o endereço da página naquela hora e até quando valem. */
const guardadas = new Map<number, { m: MarcasDepuracao; url: string; ate: number }>();
/** O que está desenhado agora: de que aba, de que leitura e com que retângulo (mudou qualquer um → redesenha). */
let desenhadas: { aba: number; m: MarcasDepuracao; chave: string } | null = null;
let vigia: ReturnType<typeof setInterval> | null = null;
let silencio: ReturnType<typeof setTimeout> | null = null;
/** A saída gradual da lista em curso (um balão por SAIDA_MS); null = parada. */
let saindo: ReturnType<typeof setInterval> | null = null;

export const instagramavelLigado = (): boolean => ligado;
const chaveDe = (r: { left: number; top: number; width: number; height: number }): string => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;

function apagarDesenho(): void { marcasEl.replaceChildren(); desenhadas = null; }
/** Esquece as marcas de uma aba (a página dela mudou) ou de todas (não se sabe qual mudou, ou o modo desligou). */
function esquecer(aba: number | null): void {
  if (aba === null) guardadas.clear(); else guardadas.delete(aba);
  atualizar();
}
function limparLista(): void {
  listaEl.replaceChildren();
  if (saindo !== null) { clearInterval(saindo); saindo = null; }
}
function aplicar(on: boolean): void {
  if (on === ligado) return;
  ligado = on;
  palco.hidden = !on;
  if (on) { palco.replaceChildren(marcasEl, listaEl); return; }
  esquecer(null); limparLista();
  if (silencio !== null) { clearTimeout(silencio); silencio = null; }
}
/** Desenha as marcas de uma leitura sobre o retângulo da aba dela; devolve se pôs alguma. */
function desenhar(m: MarcasDepuracao, r: DOMRect): boolean {
  const { itens, fora } = marcasNaTela(m, r, MAX_CURSORES);
  marcasEl.replaceChildren();
  for (const i of itens) {
    const cor = corDaMarca(i.n);
    const el = document.createElement("div"); el.className = "insta-marca"; el.style.color = cor; el.style.transform = `translate(${i.x}px, ${i.y}px)`;
    el.innerHTML = SETA;
    const rotulo = document.createElement("span"); rotulo.className = "insta-rotulo"; rotulo.textContent = i.rotulo; rotulo.style.background = cor;
    el.append(rotulo); marcasEl.append(el);
  }
  if (fora > 0) {
    const mais = document.createElement("span"); mais.className = "insta-mais"; mais.textContent = `+${fora} elementos à vista`;
    mais.style.left = `${Math.round(r.left + 12)}px`; mais.style.top = `${Math.round(r.top + 8)}px`;
    marcasEl.append(mais);
  }
  return itens.length > 0;
}
/**
 * Põe na tela as marcas da aba que está à vista (e só dela): joga fora as vencidas e as de página que já mudou de
 * endereço, e redesenha quando a aba, a leitura ou o retângulo dela mudam. Com o real em cena, nenhuma. O vigia chama
 * a cada 400 ms enquanto há marca guardada: é ele que vê a troca de aba e de tela.
 */
function atualizar(): void {
  const agora = Date.now();
  let visivel: { aba: number; m: MarcasDepuracao; r: DOMRect } | null = null;
  for (const [aba, g] of guardadas) {
    if (agora > g.ate || urlDaAba(aba) !== g.url) { guardadas.delete(aba); continue; }
    const r = retanguloDaAba(aba);
    if (r !== null) visivel = { aba, m: g.m, r };
  }
  if (guardadas.size === 0 && vigia !== null) { clearInterval(vigia); vigia = null; }
  if (guardadas.size > 0) vigia ??= setInterval(atualizar, 400);
  if (visivel === null || realEmCena() || !ligado) { if (desenhadas !== null) apagarDesenho(); return; }
  const chave = chaveDe(visivel.r);
  if (desenhadas !== null && desenhadas.aba === visivel.aba && desenhadas.m === visivel.m && desenhadas.chave === chave) return;
  desenhadas = desenhar(visivel.m, visivel.r) ? { aba: visivel.aba, m: visivel.m, chave } : null;
}
/** Guarda a leitura da aba e atualiza a tela; devolve se as marcas dela estão desenhadas agora (aba à vista). */
function marcar(m: MarcasDepuracao): boolean {
  guardadas.set(m.aba, { m, url: urlDaAba(m.aba), ate: Date.now() + MARCAS_MS });
  atualizar();
  return desenhadas?.m === m;
}
/**
 * A lista fica no canto de baixo, à direita, da página do Navegador à vista (o menu e a maioria das marcas ficam à
 * esquerda); sem página, no canto de baixo da janela.
 */
function posicionarLista(): void {
  const pagina = [...document.querySelectorAll("webview")].map((w) => w.getBoundingClientRect()).find((r) => r.width > 300 && r.height > 200);
  const dir = pagina?.right ?? window.innerWidth, base = pagina?.bottom ?? window.innerHeight - 120;
  listaEl.style.right = `${Math.round(window.innerWidth - dir + 12)}px`; listaEl.style.bottom = `${Math.round(window.innerHeight - base + 12)}px`;
}
function listar(e: EventoDepuracao): void {
  const fala = textoDoBalao(e);
  if (fala === "") return; // sem nada a dizer (js, sonda): fica só na faixa
  const item = document.createElement("div"); item.className = `insta-item${e.ok ? "" : " insta-erro"}`;
  const nome = Object.assign(document.createElement("span"), { className: "insta-nome", textContent: rotuloDoDono(e.dono) });
  const texto = Object.assign(document.createElement("span"), { className: "insta-fala", textContent: fala });
  // O × tira este aviso na hora, sem esperar o silêncio. O palco não recebe clique (não pode tapar a página): só o × recebe.
  const fechar = Object.assign(document.createElement("button"), { type: "button", className: "insta-fechar", textContent: "×", title: "Tirar este aviso da tela" });
  fechar.setAttribute("aria-label", "Tirar este aviso da tela");
  fechar.addEventListener("click", () => item.remove());
  item.append(nome, texto, fechar);
  posicionarLista();
  listaEl.append(item);
  while (listaEl.children.length > LISTA_MAX) listaEl.firstElementChild?.remove();
}
/** Depois de SILENCIO_MS sem log, a lista esvazia aos poucos: o mais antigo a cada SAIDA_MS. */
function armarSilencio(): void {
  if (silencio !== null) clearTimeout(silencio);
  if (saindo !== null) { clearInterval(saindo); saindo = null; } // chegou log: a saída para
  silencio = setTimeout(() => {
    saindo = setInterval(() => {
      const el = listaEl.querySelector<HTMLElement>(".insta-item:not(.sai)");
      if (el === null) { if (saindo !== null) clearInterval(saindo); saindo = null; return; }
      el.classList.add("sai"); setTimeout(() => el.remove(), 600);
    }, SAIDA_MS);
  }, SILENCIO_MS);
}
function mostrar(e: EventoDepuracao): void {
  if (!ligado || !faixaLigada()) return;
  // É do real (ação com lugar na página, ou qualquer log com ele em cena): marcas e lista só com o real fora de cena.
  // A ação do real mexe na página: as marcas daquela aba deixam de valer, mesmo sem aparecer agora.
  if (realEmCena() || pontoReal(e.ponto) !== null) { if (e.origem === "navegador" && !NAO_MEXE.has(e.rota)) esquecer(e.aba ?? null); else if (e.rota === "/ler" && e.ok && e.marcas !== undefined) marcar(e.marcas); return; }
  armarSilencio();
  if (e.origem === "navegador") {
    if (e.rota === "/ler" && e.ok && e.marcas !== undefined && marcar(e.marcas)) return;
    // A ação mexeu na página: os números de antes já não valem naquela aba (sem saber qual, em nenhuma).
    if (!NAO_MEXE.has(e.rota)) esquecer(e.aba ?? null);
  }
  listar(e);
}
/** Liga eventos e o estado inicial; o renderer.ts chama uma vez, depois de ligarFaixaDepuracao. */
export function ligarInstagramavel(): void {
  void window.meuBot.getSettings().then((s) => aplicar(s.instagramavel)).catch(() => undefined);
  window.meuBot.on("settings:changed", (s: SettingsView) => aplicar(s.instagramavel));
  window.meuBot.on("depuracao:evento", mostrar);
  window.meuBot.on("depuracao:estado", (s: { ligado: boolean }) => { if (!s.ligado) { esquecer(null); limparLista(); } });
  // O real entrou: marcas e lista saem. Saiu: as marcas guardadas da aba à vista voltam.
  aoMudarCena((emCena) => { if (emCena) limparLista(); atualizar(); });
}
/** Paleta: liga ou desliga (vale para todas as janelas e para o interruptor do seletor). */
export async function alternarInstagramavel(): Promise<void> {
  const ligar = !ligado;
  aplicar((await window.meuBot.setSettings({ instagramavel: ligar })).instagramavel);
  ctx.showTextToast(ligar ? "Modo instagramável ligado" : "Modo instagramável desligado",
    !ligar ? "As marcas e a lista saem; a faixa de depuração continua como estava."
      : faixaLigada() ? "Cada elemento que o agente ler numa página ganha uma marca com o número dele." : "As marcas aparecem quando a depuração estiver ligada (selo DEPURAÇÃO ao lado do PRO).");
}
