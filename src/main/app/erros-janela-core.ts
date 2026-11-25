/**
 * O que o controle externo lê para depurar (25 nov): os erros da interface de cada janela, guardados num anel em memória,
 * e as últimas linhas do meu-bot.log. Puro e testado; quem liga nos eventos do Electron e lê o arquivo é o erros-janela.ts.
 */
export type NivelDoErro = "erro" | "aviso" | "queda" | "travou";
export interface ErroDaJanela { em: number; nivel: NivelDoErro; texto: string; origem: string }

const corta = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Anel de tamanho fixo: o que passa do teto empurra o mais velho para fora. */
export function criarAnel(max = 200): { por(e: ErroDaJanela): void; desde(desde?: unknown, limite?: unknown): ErroDaJanela[] } {
  const itens: ErroDaJanela[] = [];
  return {
    por(e) { itens.push({ ...e, texto: corta(e.texto, 2000), origem: corta(e.origem, 200) }); if (itens.length > max) itens.splice(0, itens.length - max); },
    desde(desde, limite) {
      const t = instante(desde);
      const n = typeof limite === "number" && Number.isInteger(limite) && limite > 0 ? Math.min(limite, max) : 50;
      return itens.filter((e) => t === null || e.em >= t).slice(-n);
    },
  };
}

/** "desde" do pedido: milissegundos ou data ISO; o que não der para ler vira null (sem filtro). */
export function instante(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  return null;
}

/**
 * As últimas linhas do log que interessam: depois de `desde` (toda linha do meu-bot.log começa com a data ISO), que contêm
 * `filtro` (sem diferenciar maiúsculas), no máximo `linhas` (padrão 100, teto 500). Linha comprida demais é cortada.
 */
export function filtrarLog(texto: string, o: { linhas?: unknown; filtro?: unknown; desde?: unknown }): { linhas: string[]; total: number } {
  const t = instante(o.desde);
  const f = typeof o.filtro === "string" && o.filtro.trim() !== "" ? o.filtro.trim().toLowerCase() : null;
  const n = typeof o.linhas === "number" && Number.isInteger(o.linhas) && o.linhas > 0 ? Math.min(o.linhas, 500) : 100;
  const boas = texto.split("\n").filter((l) => {
    if (l.trim() === "") return false;
    if (f !== null && !l.toLowerCase().includes(f)) return false;
    if (t !== null) { const em = Date.parse(l.slice(0, 24)); if (Number.isNaN(em) || em < t) return false; }
    return true;
  });
  return { linhas: boas.slice(-n).map((l) => corta(l, 500)), total: boas.length };
}
