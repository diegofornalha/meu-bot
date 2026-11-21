/**
 * Modo de depuração (31 out): o main conta à janela o que está acontecendo, para quem depura de fora (o agente da
 * máquina pelos sockets, o Claude Code pelo app-mcp, os hooks) ver na faixa do topo em vez de ler o log.
 * - `batimento`: tique de 1 s por broadcast. Uma chamada síncrona (safeStorage com o diálogo do Chaveiro na tela,
 *   spawn do ssh) prende o fio de JS do main e o tique para junto; a janela acusa "main sem responder há N s".
 * - `marcar`: a última coisa síncrona que o main anunciou antes de fazer; vai no tique (e num tique imediato), então
 *   já está na janela quando ele trava.
 * - `evento`: uma ação de fora (rota, dono, resultado). Sempre vai para o log; para a janela só com o modo ligado.
 * Ligado = `--depuracao` neste processo, senão o gravado nas configurações, senão o padrão da variante (staging).
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { BatimentoDepuracao, EstadoDepuracao, EventoDepuracao } from "../../shared/ipc";
import { caps } from "./variant";
import { SONDAS, detalheSeguro, deveEmitirSonda, marcasDoResultado, podar as podarAnel, pontoDoResultado, resumoAcao, type Corpo } from "./depuracao-core";
import { getDepuracaoGravado, updateSettings } from "./settings";
import type { broadcast as Broadcast } from "./windows";

/**
 * Quem manda para as janelas, injetado por `ligarDepuracao` (main.ts): importar windows.ts aqui fecharia um ciclo
 * (tunnel.ts → depuracao → windows → … → gmail-api → tunnel) e quebrava a subida. Antes de ligar, nada é enviado.
 */
let broadcast: typeof Broadcast = () => undefined;

const eventos: EventoDepuracao[] = [];
/** Última sonda emitida por (origem, rota): as outras no intervalo ficam de fora do fluxo (vão só ao log). */
const sondas = new Map<string, number>();
let marca: string | null = null;
let marcaEm: number | null = null;
let tique: NodeJS.Timeout | null = null;

const forcado = (): boolean => app.commandLine.hasSwitch("depuracao");
/**
 * No staging a faixa vem ligada: é o app de teste, e quem o usa está sempre conferindo alguma coisa. No meu-bot-admin
 * também (3 nov): quem dá suporte precisa ver o build e o que falhou sem ter de ligar nada antes.
 */
export const padraoDaVariante = (): boolean => caps().canal === "staging" || caps().supportAdmin;
export function modoDepuracao(): boolean {
  if (forcado()) return true;
  return getDepuracaoGravado() ?? padraoDaVariante();
}
/** Mesmo arquivo do log do app; tag própria para filtrar. */
function logLinha(linha: string): void {
  try { fs.appendFileSync(path.join(app.getPath("userData"), "meu-bot.log"), `${new Date().toISOString()} [depuracao] ${linha}\n`); } catch { /* sem log não se cai */ }
}
const batimento = (): BatimentoDepuracao => ({ em: Date.now(), marca, marcaEm });
const podar = (): void => { podarAnel(eventos, Date.now()); };
export function estado(): EstadoDepuracao {
  podar();
  return { ligado: modoDepuracao(), gravado: getDepuracaoGravado(), padraoDaVariante: padraoDaVariante(), forcado: forcado(), eventos: [...eventos], batimento: batimento() };
}
/** Liga/desliga para todas as janelas (gravado nas configurações; null = volta ao padrão da variante). */
export function setDepuracao(v: boolean | null): EstadoDepuracao {
  updateSettings({ depuracao: v });
  logLinha(`modo ${modoDepuracao() ? "ligado" : "desligado"} (gravado: ${String(v)})`);
  const e = estado();
  broadcast("depuracao:estado", e);
  return e;
}
/** Anuncia a próxima chamada síncrona (Chaveiro, ssh): se o main travar nela, a faixa diz onde. */
export function marcar(texto: string): void {
  marca = texto; marcaEm = Date.now();
  if (modoDepuracao()) broadcast("depuracao:batimento", batimento());
}
/** Uma ação de fora: log sempre (resumo curto), salvo `semLog`; janela só com o modo ligado. */
export function evento(e: Omit<EventoDepuracao, "em">, semLog = false): void {
  const ev: EventoDepuracao = { ...e, em: Date.now() };
  if (!semLog) logLinha(`${ev.origem}${ev.dono !== null ? ` (${ev.dono})` : ""} ${ev.rota} ${ev.ok ? "ok" : "ERRO"}${ev.ms !== null ? ` ${ev.ms} ms` : ""}: ${ev.resumo.slice(0, 200)}`);
  if (!modoDepuracao()) return;
  eventos.push(ev); podar();
  broadcast("depuracao:evento", ev);
}
/**
 * O `handle()` de cada socket (Navegador, Gmail, terminal) chama no fim de cada pedido, com sucesso ou erro: o resumo
 * sai da rota + pedido + resposta (depuracao-core.ts); o detalhe é o pedido sem payload pesado. Sondas (/abas,
 * /status…) entram no fluxo uma vez a cada 30 s por rota; as outras vão só ao log.
 */
export function registrarAcao(p: { origem: EventoDepuracao["origem"]; dono: { rotulo: string; origem: string } | null; rota: string; corpo: Corpo; t0: number; resultado?: unknown; erro?: string | null }): void {
  const erro = p.erro ?? null;
  const resumo = resumoAcao(p.origem, p.rota, p.corpo, p.resultado, erro);
  const ev: Omit<EventoDepuracao, "em"> = { origem: p.origem, dono: p.dono === null ? null : `${p.dono.rotulo} (${p.dono.origem})`, rota: p.rota, ok: erro === null, ms: Date.now() - p.t0, resumo, detalhe: detalheSeguro(p.rota, p.corpo) ?? undefined };
  // Onde a ação aconteceu na página (clicar, digitar): o cursor do agente vai até lá.
  const ponto = erro === null ? pontoDoResultado(p.resultado) : null;
  if (ponto !== null) ev.ponto = ponto;
  // Onde está cada elemento que a leitura numerou: o modo instagramável põe uma marca em cada um.
  const marcas = erro === null && p.rota === "/ler" && p.origem === "navegador" ? marcasDoResultado(p.resultado) : null;
  if (marcas !== null) ev.marcas = marcas;
  if (SONDAS.has(p.rota) && erro === null) {
    const k = `${p.origem}${p.rota}`; const agora = Date.now();
    if (!deveEmitirSonda(sondas.get(k) ?? null, agora)) { logLinha(`${ev.origem} ${ev.rota} ok (sonda)`); return; }
    sondas.set(k, agora);
    ev.resumo = `sonda: ${resumo}`;
  }
  evento(ev);
}
/** Linha de um instalador na máquina (navegador:progress, crm:progress…): já vai ao log pelo instalador; aqui só o fluxo. */
export function eventoHook(canal: string, linha: string): void {
  evento({ origem: "hook", dono: null, rota: canal, ok: !/erro|error|falh|✗/i.test(linha), ms: null, resumo: linha.slice(0, 200) }, true);
}
/** Sobe o tique; o main.ts chama uma vez, depois de abrir a primeira janela, passando o `broadcast` das janelas. */
export function ligarDepuracao(enviar: typeof Broadcast): void {
  broadcast = enviar;
  if (tique !== null) return;
  tique = setInterval(() => { if (modoDepuracao()) broadcast("depuracao:batimento", batimento()); }, 1000);
  logLinha(`modo ${modoDepuracao() ? "ligado" : "desligado"} na subida (variante ${caps().variant}, canal ${caps().canal}${forcado() ? ", --depuracao" : ""})`);
  // `--depuracao-travar=<ms>` (só no staging, com o modo ligado): prende o fio do main por esse tempo, 10 s depois de
  // subir, para conferir que a faixa acusa e volta. Fora do canal staging a flag é ignorada: produção não tem botão de travar.
  const travar = Number(app.commandLine.getSwitchValue("depuracao-travar") || 0);
  if (padraoDaVariante() && modoDepuracao() && Number.isFinite(travar) && travar > 0) {
    setTimeout(() => {
      marcar(`teste: travar o main por ${travar} ms (--depuracao-travar)`);
      logLinha(`travando o main por ${travar} ms (--depuracao-travar)`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(travar, 60_000));
      logLinha("main solto");
    }, 10_000);
  }
}
