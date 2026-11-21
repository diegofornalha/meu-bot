/**
 * Modo instagramável, a parte pura: onde cai na tela cada marca de uma leitura, o rótulo e a cor dela, e o texto dos
 * balões da lista. A tela é depuracao/instagramavel.ts; as marcas vêm do main (EventoDepuracao.marcas, do /ler).
 */

/** Quantas marcas ficam na página de uma vez: mais que isso vira o aviso "+N". */
export const MAX_CURSORES = 20;
/** Quantos balões cabem na lista de logs sem lugar na página; o mais antigo sai quando chega outro. */
export const LISTA_MAX = 6;
/** Sem log nenhum por este tempo, as marcas saem e a lista começa a esvaziar, para a tela não ficar cheia à toa. */
export const SILENCIO_MS = 20_000;
/** Na saída por silêncio, sai o balão mais antigo a cada SAIDA_MS; um log novo interrompe. */
export const SAIDA_MS = 2_500;

/**
 * A cor da marca do elemento n: a roda gira pelo ângulo áureo (~137,5°) a cada número, então vizinhos nunca se
 * parecem. É a mesma conta do número desenhado no print (MARCAR_SCRIPT em nav-api.ts): a mesma cor nos dois lugares.
 */
export function corDaMarca(n: number): string {
  return `hsl(${Math.round((n * 137.508) % 360)} 85% 55%)`;
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
 * O balão da lista (e do cursor do agente): o que aquele log fez, em uma linha curta e sem dado pessoal. A nota é o recado de quem dirige o
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

/** Quanto do rótulo do elemento cabe ao lado do número. */
export const ROTULO_MAX = 28;
/** O que a marca diz: o número que o agente usa em clicar/digitar e o texto do elemento, limpo para a tela. */
export function rotuloDaMarca(n: number, rotulo: string): string {
  const t = limparParaTela(rotulo);
  return t === "" ? String(n) : `${n} ${t.length > ROTULO_MAX ? `${t.slice(0, ROTULO_MAX - 1).trimEnd()}…` : t}`;
}
/**
 * As marcas de uma leitura na tela da janela, dado o retângulo do webview da aba: cada item convertido como o ponto
 * (zoom da aba), o que cai fora do webview sai, e ficam no máximo `max`; `fora` = quantas não couberam nesse teto.
 */
export function marcasNaTela(m: { vw: number; vh: number; itens: readonly { n: number; x: number; y: number; rotulo: string }[] }, r: { left: number; top: number; width: number; height: number }, max: number = MAX_CURSORES): { itens: { n: number; x: number; y: number; rotulo: string }[]; fora: number } {
  const itens: { n: number; x: number; y: number; rotulo: string }[] = [];
  let fora = 0;
  for (const i of m.itens) {
    const p = pontoNaTela({ x: i.x, y: i.y, vw: m.vw, vh: m.vh }, r);
    if (p === null) continue;
    if (itens.length >= max) { fora++; continue; }
    itens.push({ n: i.n, x: p.x, y: p.y, rotulo: rotuloDaMarca(i.n, i.rotulo) });
  }
  return { itens, fora };
}
