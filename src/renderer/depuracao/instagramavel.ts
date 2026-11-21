/**
 * Modo instagramável: com a depuração ligada, mostra na janela o que o agente está vendo no Navegador.
 *  - Marcas: quando o agente lê uma página (/ler), cada elemento numerado que está à vista ganha uma seta colorida com
 *    o número e o texto dele, o mesmo número do clicar/digitar. Valem até a página mudar: outro log do Navegador que
 *    mexe nela, a aba sair da vista, a área dela mudar de tamanho, ou SILENCIO_MS sem log.
 *  - Lista: os logs sem lugar na página (nota, abrir aba, terminal) ficam numa coluna fixa no canto de baixo, à direita, com quem
 *    agiu e o que fez; saem aos poucos depois de SILENCIO_MS.
 * O cursor do agente (cursor-agente.ts, o modo "real") tem a cena: enquanto ele está nela, marcas e lista saem.
 * Nada aqui se mexe sozinho. Liga no seletor (o ✨ colado no Intro) ou na paleta; gravado em `instagramavel`.
 */
import type { EventoDepuracao, MarcasDepuracao, SettingsView } from "../../shared/ipc";
import { byId as $ } from "../lib/dom.js";
import { LISTA_MAX, MAX_CURSORES, SAIDA_MS, SILENCIO_MS, corDaMarca, marcasNaTela, rotuloDoDono, textoDoBalao } from "../lib/instagramavel-core.js";
import { faixaLigada } from "./faixa.js";
import { aoMudarCena, pontoReal, realEmCena, retanguloDaAba } from "./cursor-agente.js";
import { ctx } from "../app/ctx.js";

const palco = $<HTMLElement>("insta-palco");
const SETA = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 2l16 11.5-7 1.2 4.2 7.3-3 1.7-4.2-7.3L5 21z" fill="currentColor" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
/** Logs do Navegador que não mudam a página: as marcas continuam valendo depois deles. */
const NAO_MEXE = new Set(["/ler", "/print", "/js", "/abas", "/diag"]);
let ligado = false;
const marcasEl = Object.assign(document.createElement("div"), { className: "insta-marcas" });
const listaEl = Object.assign(document.createElement("div"), { className: "insta-lista" });
/** As marcas na tela: de que aba são e o retângulo dela quando foram postas (mudou → já não valem). */
let marcadas: { aba: number; chave: string } | null = null;
let vigia: ReturnType<typeof setInterval> | null = null;
let silencio: ReturnType<typeof setTimeout> | null = null;
/** A saída gradual da lista em curso (um balão por SAIDA_MS); null = parada. */
let saindo: ReturnType<typeof setInterval> | null = null;

export const instagramavelLigado = (): boolean => ligado;
const chaveDe = (r: { left: number; top: number; width: number; height: number }): string => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;

function limparMarcas(): void {
  marcasEl.replaceChildren(); marcadas = null;
  if (vigia !== null) { clearInterval(vigia); vigia = null; }
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
  limparMarcas(); limparLista();
  if (silencio !== null) { clearTimeout(silencio); silencio = null; }
}
/** Põe uma marca em cada elemento que a leitura numerou e que está à vista na janela; devolve se pôs alguma. */
function marcar(m: MarcasDepuracao): boolean {
  const r = retanguloDaAba(m.aba);
  if (r === null) return false;
  const { itens, fora } = marcasNaTela(m, r, MAX_CURSORES);
  if (itens.length === 0) return false;
  limparMarcas();
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
  marcadas = { aba: m.aba, chave: chaveDe(r) };
  // A aba saiu da vista ou a área dela mudou (outra aba, painel aberto, janela redimensionada): as marcas já não batem.
  vigia = setInterval(() => {
    const agora = marcadas === null ? null : retanguloDaAba(marcadas.aba);
    if (marcadas === null || agora === null || chaveDe(agora) !== marcadas.chave) limparMarcas();
  }, 500);
  return true;
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
  item.append(nome, texto);
  posicionarLista();
  listaEl.append(item);
  while (listaEl.children.length > LISTA_MAX) listaEl.firstElementChild?.remove();
}
/** Depois de SILENCIO_MS sem log, as marcas saem e a lista esvazia aos poucos: o mais antigo a cada SAIDA_MS. */
function armarSilencio(): void {
  if (silencio !== null) clearTimeout(silencio);
  if (saindo !== null) { clearInterval(saindo); saindo = null; } // chegou log: a saída para
  silencio = setTimeout(() => {
    limparMarcas();
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
  if (realEmCena() || pontoReal(e.ponto) !== null) return;
  armarSilencio();
  if (e.origem === "navegador") {
    if (e.rota === "/ler" && e.ok && e.marcas !== undefined && marcar(e.marcas)) return;
    if (!NAO_MEXE.has(e.rota)) limparMarcas(); // a página mudou: os números de antes já não valem
  }
  listar(e);
}
/** Liga eventos e o estado inicial; o renderer.ts chama uma vez, depois de ligarFaixaDepuracao. */
export function ligarInstagramavel(): void {
  void window.meuBot.getSettings().then((s) => aplicar(s.instagramavel)).catch(() => undefined);
  window.meuBot.on("settings:changed", (s: SettingsView) => aplicar(s.instagramavel));
  window.meuBot.on("depuracao:evento", mostrar);
  window.meuBot.on("depuracao:estado", (s: { ligado: boolean }) => { if (!s.ligado) { limparMarcas(); limparLista(); } });
  aoMudarCena((emCena) => { if (emCena) { limparMarcas(); limparLista(); } });
}
/** Paleta: liga ou desliga (vale para todas as janelas e para o interruptor do seletor). */
export async function alternarInstagramavel(): Promise<void> {
  const ligar = !ligado;
  aplicar((await window.meuBot.setSettings({ instagramavel: ligar })).instagramavel);
  ctx.showTextToast(ligar ? "Modo instagramável ligado" : "Modo instagramável desligado",
    !ligar ? "As marcas e a lista saem; a faixa de depuração continua como estava."
      : faixaLigada() ? "Cada elemento que o agente ler numa página ganha uma marca com o número dele." : "As marcas aparecem quando a depuração estiver ligada (selo DEPURAÇÃO ao lado do PRO).");
}
