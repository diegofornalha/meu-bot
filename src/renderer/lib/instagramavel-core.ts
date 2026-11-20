/**
 * Modo instagramável, a parte pura: a cor de cada nome, o rodízio dos nomes e de onde cada cursor entra. A tela é
 * depuracao/instagramavel.ts; os nomes vêm do main (conta:membros, primeiro nome dos membros ativos da organização).
 */
import { hashHue } from "./host-color.js";

/** Quantos cursores podem estar na tela ao mesmo tempo: além disso o log fica só na faixa (limite de DOM e animação). */
export const MAX_CURSORES = 24;
/** Sem organização (ou sem nome nenhum): os cursores levam o nome do app. */
export const NOME_PADRAO = "meu-bot";

/** Cor estável por nome (mesmo hash das máquinas no seletor): saturada e clara o bastante nos dois temas. */
export function corDoNome(nome: string): string {
  return `hsl(${hashHue(nome.toLowerCase())} 85% 55%)`;
}
/** O i-ésimo nome do rodízio; lista vazia → o nome do app. */
export function proximoNome(nomes: readonly string[], i: number): string {
  if (nomes.length === 0) return NOME_PADRAO;
  return nomes[((i % nomes.length) + nomes.length) % nomes.length]!;
}
/**
 * Um ponto numa das quatro bordas da janela, um pouco para fora, de onde o cursor entra voando. `sorteio` em [0, 1)
 * escolhe a borda (o quarto) e a posição nela; o mesmo sorteio dá o mesmo ponto (testável).
 */
export function pontoDeEntrada(largura: number, altura: number, sorteio: number): { x: number; y: number } {
  const s = Math.min(Math.max(sorteio, 0), 0.999999) * 4;
  const borda = Math.floor(s), t = s - borda, fora = 40;
  if (borda === 0) return { x: Math.round(t * largura), y: -fora };
  if (borda === 1) return { x: largura + fora, y: Math.round(t * altura) };
  if (borda === 2) return { x: Math.round(t * largura), y: altura + fora };
  return { x: -fora, y: Math.round(t * altura) };
}
/**
 * Um ponto dentro da página do Navegador onde o cursor "clica": longe das bordas (margem de 12% de cada lado), para a
 * etiqueta do nome não sair da página. `sx` e `sy` em [0, 1); o mesmo sorteio dá o mesmo ponto.
 */
export function pontoNaPagina(r: { left: number; top: number; width: number; height: number }, sx: number, sy: number): { x: number; y: number } {
  const f = (s: number): number => 0.12 + Math.min(Math.max(s, 0), 1) * 0.76;
  return { x: Math.round(r.left + r.width * f(sx)), y: Math.round(r.top + r.height * f(sy)) };
}
