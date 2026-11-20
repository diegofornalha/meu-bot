/**
 * Modo instagramável (19 nov): com a depuração ligada, cada log que chega de fora (depuracao:evento) vira um cursor
 * colorido com o nome de alguém da organização da conta. Ele entra por uma borda, voa até a página do Navegador (ação
 * do navegador) ou até a faixa de depuração (o resto) e "clica", com uma explosão de partículas; log com erro treme e explode em vermelho. Liga no seletor
 * (o ✨ colado no Intro) ou na paleta; fica gravado em `instagramavel` nas configurações.
 */
import type { ContaView, EventoDepuracao, SettingsView } from "../../shared/ipc";
import { byId as $ } from "../lib/dom.js";
import { MAX_CURSORES, corDoCursor, pontoDeEntrada, pontoNaPagina, proximoNome } from "../lib/instagramavel-core.js";
import { faixaLigada } from "./faixa.js";
import { ctx } from "../app/ctx.js";

const palco = $<HTMLElement>("insta-palco");
const SETA = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 2l16 11.5-7 1.2 4.2 7.3-3 1.7-4.2-7.3L5 21z" fill="currentColor" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const ERRO = "hsl(0 85% 55%)";
let ligado = false;
let nomes: string[] = [];
let vez = 0;
let vivos = 0;

export const instagramavelLigado = (): boolean => ligado;
const calmo = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function carregarNomes(): Promise<void> {
  try { nomes = await window.meuBot.contaMembros(); } catch { nomes = []; }
}
function aplicar(on: boolean): void {
  if (on === ligado) return;
  ligado = on;
  palco.hidden = !on;
  if (on) void carregarNomes(); else palco.replaceChildren();
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
function mostrar(e: EventoDepuracao): void {
  if (!ligado || !faixaLigada() || vivos >= MAX_CURSORES) return;
  const fim = alvo(e);
  if (fim === null) return;
  const i = vez++;
  const nome = proximoNome(nomes, i);
  const cor = corDoCursor(nome, i);
  const el = document.createElement("div"); el.className = `insta-cursor${e.ok ? "" : " insta-erro"}`; el.style.color = cor;
  el.innerHTML = SETA;
  const etiqueta = document.createElement("span"); etiqueta.className = "insta-nome"; etiqueta.textContent = nome; etiqueta.style.background = cor;
  el.append(etiqueta); palco.append(el); vivos++;
  const sair = (): void => {
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: "ease-in" }).onfinish = () => { el.remove(); vivos--; };
  };
  if (calmo()) {
    el.style.transform = `translate(${fim.x}px, ${fim.y + 14}px)`;
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 }).onfinish = () => setTimeout(sair, 700);
    return;
  }
  const ini = pontoDeEntrada(window.innerWidth, window.innerHeight, Math.random());
  // Um ponto no meio do caminho desviado para o lado: o voo faz uma curva em vez de uma reta.
  const meio = { x: (ini.x + fim.x) / 2 + (Math.random() - 0.5) * 220, y: (ini.y + fim.y) / 2 + (Math.random() - 0.5) * 160 };
  const voo = el.animate([
    { transform: `translate(${ini.x}px, ${ini.y}px)` },
    { transform: `translate(${meio.x}px, ${meio.y}px)`, offset: 0.55 },
    { transform: `translate(${fim.x}px, ${fim.y}px)` },
  ], { duration: 850 + Math.random() * 250, easing: "cubic-bezier(.45,.05,.25,1)", fill: "forwards" });
  voo.onfinish = () => {
    // O clique: o cursor afunda um pouco e volta; com erro, treme.
    const quadros = e.ok
      ? [{ transform: `translate(${fim.x}px, ${fim.y}px) scale(1)` }, { transform: `translate(${fim.x}px, ${fim.y}px) scale(.82)` }, { transform: `translate(${fim.x}px, ${fim.y}px) scale(1)` }]
      : [-6, 6, -4, 4, 0].map((d) => ({ transform: `translate(${fim.x + d}px, ${fim.y}px)` }));
    explodir(fim.x, fim.y, e.ok ? cor : ERRO);
    el.animate(quadros, { duration: e.ok ? 220 : 320, fill: "forwards" }).onfinish = () => setTimeout(sair, 350);
  };
}
/** Liga eventos e o estado inicial; o renderer.ts chama uma vez, depois de ligarFaixaDepuracao. */
export function ligarInstagramavel(): void {
  void window.meuBot.getSettings().then((s) => aplicar(s.instagramavel)).catch(() => undefined);
  window.meuBot.on("settings:changed", (s: SettingsView) => aplicar(s.instagramavel));
  window.meuBot.on("conta:changed", (_c: ContaView) => { if (ligado) void carregarNomes(); });
  window.meuBot.on("depuracao:evento", mostrar);
}
/** Paleta: liga ou desliga (vale para todas as janelas e para o interruptor do seletor). */
export async function alternarInstagramavel(): Promise<void> {
  const ligar = !ligado;
  aplicar((await window.meuBot.setSettings({ instagramavel: ligar })).instagramavel);
  ctx.showTextToast(ligar ? "Modo instagramável ligado" : "Modo instagramável desligado",
    !ligar ? "Os cursores param; a faixa de depuração continua como estava."
      : faixaLigada() ? "Cada log que chega vira um cursor com o nome de alguém da sua organização." : "O show começa quando a depuração estiver ligada (selo DEPURAÇÃO ao lado do PRO).");
}
