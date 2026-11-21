/**
 * Modo instagramável (19 nov): com a depuração ligada, cada log que chega de fora (depuracao:evento) vira um cursor
 * colorido com o nome de alguém da organização da conta e um balão que diz o que aquele log fez. Ele entra por uma
 * borda, voa até onde a ação aconteceu (o ponto real, a página do Navegador ou a faixa de depuração) e "clica", com uma
 * explosão de partículas (erro treme e explode em vermelho). Depois entra na esteira: o mais novo na primeira vaga, os
 * outros deslizam uma vaga adiante, todos flutuando devagar para dar para ler; a cada FORMACAO_MS o palco inteiro
 * troca de formação (grade, onda, roda, colunas, diagonal), para ninguém ficar muito tempo parado no mesmo lugar. Entram um a um (ENTRADA_MS), acumulam
 * até MAX_CURSORES e, sem logs, saem aos poucos (SAIDA_MS). Liga no seletor (o ✨ colado no Intro) ou na paleta; fica
 * gravado em `instagramavel` nas configurações.
 *
 * Dois modos (20 nov): o REAL (cursor-agente.ts, o cursor único que anda até onde a ação aconteceu) e o SHOW (este
 * arquivo). O show só entra quando o real não está em cena: log com ponto real, ou que chega com o real à vista, fica
 * com o real; quando o real entra, quem está no palco sai, e o show só volta depois de um tempo sem ação na página
 * (CENA_MS em cursor-agente.ts), para os dois modos não se intercalarem.
 */
import type { ContaView, EventoDepuracao, SettingsView } from "../../shared/ipc";
import { byId as $ } from "../lib/dom.js";
import { ENTRADA_MS, FORMACAO_MS, FORMACOES, MAX_CURSORES, SAIDA_MS, SILENCIO_MS, corDoCursor, pontoDeEntrada, pontoNaPagina, posicaoNaFormacao, proximoNome, textoDoBalao } from "../lib/instagramavel-core.js";
import { faixaLigada } from "./faixa.js";
import { aoMudarCena, pontoReal, realEmCena } from "./cursor-agente.js";
import { ctx } from "../app/ctx.js";

const palco = $<HTMLElement>("insta-palco");
const SETA = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 2l16 11.5-7 1.2 4.2 7.3-3 1.7-4.2-7.3L5 21z" fill="currentColor" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const ERRO = "hsl(0 85% 55%)";
let ligado = false;
let nomes: string[] = [];
let vez = 0;
/** Os cursores parados na tela, do mais antigo ao mais novo (no máximo MAX_CURSORES). */
const parados: HTMLElement[] = [];
/** Logs esperando a vez de entrar (rajada entra aos poucos); só os MAX_CURSORES mais novos esperam. */
const fila: EventoDepuracao[] = [];
let entrando: ReturnType<typeof setTimeout> | null = null;
let silencio: ReturnType<typeof setTimeout> | null = null;
/** A saída gradual em curso (um por SAIDA_MS); null = parada. */
let saindo: ReturnType<typeof setInterval> | null = null;
/** A formação atual da coreografia e o relógio que a troca (só anda com gente parada no palco). */
let formacao = 0;
let coreografia: ReturnType<typeof setInterval> | null = null;

export const instagramavelLigado = (): boolean => ligado;
const calmo = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function carregarNomes(): Promise<void> {
  try { nomes = await window.meuBot.contaMembros(); } catch { nomes = []; }
}
function aplicar(on: boolean): void {
  if (on === ligado) return;
  ligado = on;
  palco.hidden = !on;
  if (on) { void carregarNomes(); armarCoreografia(); } else {
    if (coreografia !== null) { clearInterval(coreografia); coreografia = null; } palco.replaceChildren(); parados.length = 0; fila.length = 0; if (saindo !== null) { clearInterval(saindo); saindo = null; } }
}
/**
 * Para onde o cursor voa. Ação do Navegador (onde o show passa mais tempo, com o agente navegando): um ponto dentro da
 * página visível, como se alguém clicasse nela. O resto: o fluxo da faixa de depuração, onde o log aparece.
 */
function alvo(e: EventoDepuracao): { x: number; y: number } | null {
  if (e.origem === "navegador") {
    const pagina = [...document.querySelectorAll("webview")].map((w) => w.getBoundingClientRect()).find((r) => r.width > 80 && r.height > 80);
    if (pagina !== undefined) return pontoNaPagina(pagina, Math.random(), Math.random());
  }
  const r = document.getElementById("dep-feed")?.getBoundingClientRect();
  if (r === undefined || r.width === 0) return null;
  return { x: r.left + Math.min(r.width / 2, 160), y: r.top + r.height / 2 };
}
function explodir(x: number, y: number, cor: string): void {
  const n = 10;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("span"); p.className = "insta-particula"; p.style.background = cor; p.style.left = `${x}px`; p.style.top = `${y}px`;
    const ang = (i / n) * Math.PI * 2, dist = 28 + Math.random() * 22;
    palco.append(p);
    p.animate([{ transform: "translate(-50%, -50%) scale(1)", opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(.3)`, opacity: 0 }], { duration: 520, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = () => p.remove();
  }
  const anel = document.createElement("span"); anel.className = "insta-anel"; anel.style.borderColor = cor; anel.style.left = `${x}px`; anel.style.top = `${y}px`;
  palco.append(anel);
  anel.animate([{ transform: "translate(-50%, -50%) scale(.2)", opacity: 1 }, { transform: "translate(-50%, -50%) scale(1.6)", opacity: 0 }], { duration: 480, easing: "ease-out" }).onfinish = () => anel.remove();
}
/** A área onde os cursores ficam parados: a página do Navegador à vista, senão a janela abaixo das barras. */
function areaDoPalco(): { left: number; top: number; width: number; height: number } {
  const pagina = [...document.querySelectorAll("webview")].map((w) => w.getBoundingClientRect()).find((r) => r.width > 300 && r.height > 200);
  if (pagina !== undefined) return pagina;
  const topo = document.getElementById("depuracao-bar")?.getBoundingClientRect().bottom ?? 80;
  return { left: 0, top: topo + 40, width: window.innerWidth, height: window.innerHeight - topo - 120 };
}
/** O mais antigo sai (esmaece e sobe um pouco); a vaga dele fica para quem está chegando. */
function tirar(el: HTMLElement, devagar = false): void {
  el.animate([{ opacity: 1 }, { opacity: 0, translate: "0 -12px" }], { duration: devagar ? 1200 : 500, easing: "ease-in", fill: "forwards" }).onfinish = () => el.remove();
}
/**
 * O palco se reorganiza: cada cursor parado vai para a vaga da sua idade (o mais novo na primeira), deslizando de onde
 * está. Chamado quando alguém chega e quando alguém sai: a esteira anda e a tela nunca fica parada.
 */
function reorganizar(): void {
  const area = areaDoPalco();
  const prontos = parados.filter((el) => el.dataset["parado"] === "1");
  prontos.forEach((el, k) => {
    const vaga = posicaoNaFormacao(FORMACOES[formacao % FORMACOES.length]!, prontos.length - 1 - k, prontos.length, area);
    const de = { x: Number(el.dataset["x"]), y: Number(el.dataset["y"]) };
    if (de.x === vaga.x && de.y === vaga.y) return;
    // As animações anteriores viram estilo fixo e saem: sem acumular uma por reorganização.
    for (const an of el.getAnimations()) { an.commitStyles(); an.cancel(); }
    el.dataset["x"] = String(vaga.x); el.dataset["y"] = String(vaga.y);
    el.animate([{ transform: `translate(${de.x}px, ${de.y}px)` }, { transform: `translate(${vaga.x}px, ${vaga.y}px)` }], { duration: calmo() ? 0 : 800 + k * 25, easing: "cubic-bezier(.3,.1,.2,1)", fill: "forwards" });
  });
}
/** A cada FORMACAO_MS, todos deslizam juntos para a próxima formação (grade, onda, roda, colunas, diagonal). */
function armarCoreografia(): void {
  if (coreografia !== null) return;
  coreografia = setInterval(() => {
    if (parados.filter((el) => el.dataset["parado"] === "1").length < 2 || calmo()) return;
    formacao++; reorganizar();
  }, FORMACAO_MS);
}
/** Depois de SILENCIO_MS sem log, os parados saem aos poucos: o mais antigo a cada SAIDA_MS, esmaecendo devagar. */
function armarSilencio(): void {
  if (silencio !== null) clearTimeout(silencio);
  if (saindo !== null) { clearInterval(saindo); saindo = null; } // chegou log: a saída para, o palco volta a encher
  silencio = setTimeout(() => {
    saindo = setInterval(() => {
      const el = parados.shift();
      if (el === undefined) { if (saindo !== null) clearInterval(saindo); saindo = null; return; }
      tirar(el, true); reorganizar();
    }, SAIDA_MS);
  }, SILENCIO_MS);
}
/** O real entrou em cena: a fila esvazia e quem está no palco sai de uma vez (esmaecendo), para o real ficar sozinho. */
function sairDeCena(): void {
  fila.length = 0;
  if (silencio !== null) { clearTimeout(silencio); silencio = null; }
  if (saindo !== null) { clearInterval(saindo); saindo = null; }
  for (const el of parados.splice(0)) tirar(el);
}
function mostrar(e: EventoDepuracao): void {
  if (!ligado || !faixaLigada()) return;
  if (realEmCena() || pontoReal(e.ponto) !== null) return; // é do real: o show só entra com o real fora de cena
  if (textoDoBalao(e) === "") return; // sem nada a dizer (js, sonda): fica só na faixa
  fila.push(e);
  if (fila.length > MAX_CURSORES) fila.splice(0, fila.length - MAX_CURSORES);
  armarSilencio();
  if (entrando === null) proximo();
}
/** Tira o próximo da fila e agenda o seguinte: um cursor a cada ENTRADA_MS. */
function proximo(): void {
  const e = fila.shift();
  if (e === undefined) { entrando = null; return; }
  entrar(e);
  entrando = setTimeout(proximo, ENTRADA_MS);
}
function entrar(e: EventoDepuracao): void {
  if (realEmCena()) return; // o real chegou enquanto este esperava na fila
  const fim = alvo(e);
  if (fim === null) return;
  const i = vez++;
  const nome = proximoNome(nomes, i);
  const cor = corDoCursor(nome, i);
  const el = document.createElement("div"); el.className = `insta-cursor${e.ok ? "" : " insta-erro"}`; el.style.color = cor;
  // O corpo flutua em volta da vaga (CSS, ritmo próprio): parado na tela, mas nunca imóvel.
  const corpo = document.createElement("div"); corpo.className = "insta-corpo"; corpo.innerHTML = SETA;
  corpo.style.animationDuration = `${5 + Math.random() * 3}s`; corpo.style.animationDelay = `-${Math.random() * 5}s`;
  el.append(corpo);
  const etiqueta = document.createElement("span"); etiqueta.className = "insta-nome"; etiqueta.textContent = nome; etiqueta.style.background = cor;
  corpo.append(etiqueta);
  // O balão: o que este log fez (limpo para a tela). Aparece no clique e fica, para dar para ler.
  const fala = textoDoBalao(e);
  const balao = fala === "" ? null : Object.assign(document.createElement("span"), { className: "insta-balao", textContent: fala });
  if (balao !== null) { balao.style.borderColor = e.ok ? cor : ERRO; corpo.append(balao); }
  palco.append(el);
  // Cheio: o mais antigo sai enquanto este entra (o novo toma a cena).
  parados.push(el);
  while (parados.length > MAX_CURSORES) tirar(parados.shift()!);
  // Depois do clique, entra na esteira: ocupa a primeira vaga e empurra os outros uma vaga adiante.
  const ficar = (): void => { el.dataset["x"] = String(fim.x); el.dataset["y"] = String(fim.y); el.dataset["parado"] = "1"; reorganizar(); };
  if (calmo()) {
    el.style.transform = `translate(${fim.x}px, ${fim.y}px)`;
    ficar();
    balao?.classList.add("on");
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    return;
  }
  const ini = pontoDeEntrada(window.innerWidth, window.innerHeight, Math.random());
  // Um ponto no meio do caminho desviado para o lado: o voo faz uma curva em vez de uma reta.
  const meio = { x: (ini.x + fim.x) / 2 + (Math.random() - 0.5) * 220, y: (ini.y + fim.y) / 2 + (Math.random() - 0.5) * 160 };
  el.animate([
    { transform: `translate(${ini.x}px, ${ini.y}px)` },
    { transform: `translate(${meio.x}px, ${meio.y}px)`, offset: 0.55 },
    { transform: `translate(${fim.x}px, ${fim.y}px)` },
  ], { duration: 850 + Math.random() * 250, easing: "cubic-bezier(.45,.05,.25,1)", fill: "forwards" }).onfinish = () => {
    // O clique: o cursor afunda um pouco e volta; com erro, treme. Depois desliza para a vaga e fica.
    const quadros = e.ok
      ? [{ transform: `translate(${fim.x}px, ${fim.y}px) scale(1)` }, { transform: `translate(${fim.x}px, ${fim.y}px) scale(.82)` }, { transform: `translate(${fim.x}px, ${fim.y}px) scale(1)` }]
      : [-6, 6, -4, 4, 0].map((d) => ({ transform: `translate(${fim.x + d}px, ${fim.y}px)` }));
    explodir(fim.x, fim.y, e.ok ? cor : ERRO);
    balao?.classList.add("on");
    el.animate(quadros, { duration: e.ok ? 220 : 320, fill: "forwards" }).onfinish = () => setTimeout(ficar, 500);
  };
}
/** Liga eventos e o estado inicial; o renderer.ts chama uma vez, depois de ligarFaixaDepuracao. */
export function ligarInstagramavel(): void {
  void window.meuBot.getSettings().then((s) => aplicar(s.instagramavel)).catch(() => undefined);
  window.meuBot.on("settings:changed", (s: SettingsView) => aplicar(s.instagramavel));
  window.meuBot.on("conta:changed", (_c: ContaView) => { if (ligado) void carregarNomes(); });
  window.meuBot.on("depuracao:evento", mostrar);
  aoMudarCena((emCena) => { if (emCena) sairDeCena(); });
}
/** Paleta: liga ou desliga (vale para todas as janelas e para o interruptor do seletor). */
export async function alternarInstagramavel(): Promise<void> {
  const ligar = !ligado;
  aplicar((await window.meuBot.setSettings({ instagramavel: ligar })).instagramavel);
  ctx.showTextToast(ligar ? "Modo instagramável ligado" : "Modo instagramável desligado",
    !ligar ? "Os cursores param; a faixa de depuração continua como estava."
      : faixaLigada() ? "Cada log que chega vira um cursor com o nome de alguém da sua organização." : "O show começa quando a depuração estiver ligada (selo DEPURAÇÃO ao lado do PRO).");
}
