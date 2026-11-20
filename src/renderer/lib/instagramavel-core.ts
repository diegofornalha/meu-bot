/**
 * Modo instagramável, a parte pura: a cor de cada nome, o rodízio dos nomes e de onde cada cursor entra. A tela é
 * depuracao/instagramavel.ts; os nomes vêm do main (conta:membros, primeiro nome dos membros ativos da organização).
 */
import { hashHue } from "./host-color.js";

/** Quantos cursores ficam na tela, parados com o balão para dar para ler: o 21º toma a vaga do mais antigo. */
export const MAX_CURSORES = 20;
/** Intervalo mínimo entre dois cursores entrando: uma rajada de logs entra aos poucos, um de cada vez. */
export const ENTRADA_MS = 450;
/** Sem log nenhum por este tempo, os cursores parados começam a sair, para a tela não ficar cheia à toa. */
export const SILENCIO_MS = 45_000;
/** Na saída por silêncio, sai o mais antigo a cada SAIDA_MS (gradual, não todos de uma vez); um log novo interrompe. */
export const SAIDA_MS = 2_500;
/** Sem organização (ou sem nome nenhum): os cursores levam o nome do app. */
export const NOME_PADRAO = "meu-bot";

/**
 * A cor do i-ésimo cursor: cada um de uma cor. A roda gira pelo ângulo áureo (~137,5°) a cada cursor, então os que
 * estão na tela juntos nunca se parecem, mesmo com o mesmo nome (org pequena, ou "meu-bot" sem org); o nome só muda
 * o ponto de partida. Saturada e clara o bastante nos dois temas.
 */
export function corDoCursor(nome: string, i: number): string {
  const hue = Math.round(hashHue(nome.toLowerCase()) + i * 137.508) % 360;
  return `hsl(${hue} 85% 55%)`;
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

/** Quanto texto cabe no balão de cada cursor. */
export const BALAO_MAX = 70;
const EMAIL_RE = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi;
const URL_RE = /\bhttps?:\/\/([^\s/?#]+)[^\s]*/gi;
/** O que vai para a tela (e para o vídeo): e-mail nunca; URL só o domínio, sem caminho, query nem fragmento. */
export function limparParaTela(s: string): string {
  return s.replace(URL_RE, (_m, host: string) => host.replace(/^www\./, "")).replace(EMAIL_RE, "•••@•••").replace(/\s+/g, " ").trim();
}
const VERBO_GMAIL: Record<string, string> = { "/status": "conferiu a conta", "/listar": "listou a caixa de entrada", "/ler": "leu um e-mail", "/apagar": "mandou um e-mail para a lixeira", "/restaurar": "restaurou um e-mail" };
/**
 * O balão do cursor: o que aquele log fez, em uma linha curta e sem dado pessoal. A nota é o recado de quem dirige o
 * app (vai inteira, limpa); no Gmail só a ação (o resumo tem assunto e conta); erro leva ✗. Vazio = o log não entra no
 * palco (fica só na faixa): /js e sondas não dizem nada a quem assiste.
 */
export function textoDoBalao(e: { origem: string; rota: string; ok: boolean; resumo: string }): string {
  // Sem informação para quem assiste (código rodando na página, sondas automáticas): não entra no palco.
  if (e.rota === "/js" || e.resumo.startsWith("sonda:")) return "";
  const base = e.origem === "gmail" ? `Gmail: ${VERBO_GMAIL[e.rota] ?? e.rota.replace(/^\//, "")}` : limparParaTela(e.resumo);
  if (base === "" || base === "ok") return "";
  const t = `${e.ok ? "" : "✗ "}${base}`;
  return t.length > BALAO_MAX ? `${t.slice(0, BALAO_MAX - 1).trimEnd()}…` : t;
}

/**
 * O ponto real de uma ação (px da página da aba, com a área visível vw × vh) na tela da janela, dado o retângulo do
 * webview: a escala é a razão entre os dois tamanhos (o zoom da aba). Fora do webview → null.
 */
export function pontoNaTela(p: { x: number; y: number; vw: number; vh: number }, r: { left: number; top: number; width: number; height: number }): { x: number; y: number } | null {
  if (p.vw <= 0 || p.vh <= 0 || r.width <= 0 || r.height <= 0) return null;
  const x = r.left + (p.x * r.width) / p.vw, y = r.top + (p.y * r.height) / p.vh;
  if (x < r.left || x > r.left + r.width || y < r.top || y > r.top + r.height) return null;
  return { x: Math.round(x), y: Math.round(y) };
}
/** Quem age, para a etiqueta do cursor do agente: "Claude Code (MCP) (claude-code)" → "Claude Code (MCP)". */
export function rotuloDoDono(dono: string | null): string {
  if (dono === null || dono.trim() === "") return "agente";
  return dono.replace(/\s*\([^()]*\)\s*$/, "").trim().slice(0, 32) || "agente";
}

/**
 * A vaga do i-ésimo cursor, onde ele fica parado com o balão. São `max` vagas numa grade sobre a área de conteúdo
 * (colunas de ~300 px, conforme a largura); o cursor i ocupa a vaga i % max, então o novo toma a vaga do mais antigo.
 * Linhas alternadas andam meia coluna, para os balões não formarem uma tabela dura.
 */
export function vagaDoCursor(i: number, area: { left: number; top: number; width: number; height: number }, max: number = MAX_CURSORES): { x: number; y: number } {
  const cols = Math.max(1, Math.min(max, Math.floor(area.width / 300)));
  const linhas = Math.ceil(max / cols);
  const k = ((i % max) + max) % max, col = k % cols, lin = Math.floor(k / cols);
  const larg = area.width / cols, alt = area.height / linhas;
  const desloc = lin % 2 === 1 ? larg * 0.35 : 0;
  return { x: Math.round(area.left + Math.min(col * larg + 16 + desloc, area.width - 280)), y: Math.round(area.top + lin * alt + Math.min(alt * 0.5, 40) + 26) };
}
