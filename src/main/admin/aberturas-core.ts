/**
 * Histórico de aberturas do app numa máquina (aberturas.jsonl, que o backend anota a cada hello): quando, qual app,
 * versão e Mac. O admin lê por SSH para saber o que a pessoa usa (produção ou staging, e em que versão). Puro: só
 * parse; o arquivo vem da máquina da pessoa, então é dado, nunca comando.
 */
import type { Abertura } from "../../shared/ipc";

const PRODUTO_RE = /^meu-bot(-[a-z0-9-]{1,30})?$/;
const VERSAO_RE = /^[0-9A-Za-z.+-]{1,40}$/;
const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** Onde o backend anota as aberturas, na máquina da pessoa. */
export const ABERTURAS_ARQUIVO_SH = '"$HOME/.local/share/meu-bot/aberturas.jsonl"';
/**
 * Zera o histórico de aberturas na máquina: esvazia o arquivo (não apaga, para o backend seguir anotando no mesmo
 * lugar, com a mesma permissão) e imprime "zerado". Sem o arquivo, nada a fazer: imprime "vazio".
 */
export const ZERAR_ABERTURAS_SH = `f=${ABERTURAS_ARQUIVO_SH}\nif [ -f "$f" ]; then : > "$f" && echo zerado; else echo vazio; fi\n`;

/** Linhas JSONL → aberturas válidas, da mais nova para a mais antiga; linha estragada é pulada. */
export function parseAberturas(raw: string, max = 30): Abertura[] {
  const out: Abertura[] = [];
  for (const linha of raw.split("\n")) {
    if (linha.trim() === "") continue;
    let o: unknown;
    try { o = JSON.parse(linha); } catch { continue; }
    if (o === null || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    const em = texto(r["em"], 40);
    const produto = texto(r["produto"], 40);
    const versao = texto(r["versao"], 40);
    if (Number.isNaN(Date.parse(em)) || !PRODUTO_RE.test(produto) || !VERSAO_RE.test(versao)) continue;
    const conta = texto(r["conta"], 190);
    out.push({ em, produto, versao, mac: texto(r["mac"], 80), user: texto(r["user"], 40), conta: /^[^@\s]+@[^@\s]+$/.test(conta) ? conta : "" });
  }
  return out.reverse().slice(0, max);
}
