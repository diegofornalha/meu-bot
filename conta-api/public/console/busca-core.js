// Busca do Marketplace no console (parte pura, testada em scripts/tests): o mesmo critério da página pública
// (ferramentas-core.ts no Worker). Com mais de cem ferramentas à venda, a busca é o caminho até um item.

/** Texto sem acento e em minúsculas: "calendario" acha "Calendário". */
export const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** O texto em que a busca procura num item: nome, resumo, categoria e, nas ferramentas, o exemplo de pedido. */
export const textoDeBusca = (i) => [i?.nome, i?.resumo, i?.categoria, i?.exemplo].filter((x) => typeof x === "string").join(" ");
/** O item combina com a busca? Todas as palavras digitadas têm de aparecer, em qualquer ordem. Busca vazia = tudo. */
export function combinaComABusca(texto, termo) {
  const alvo = semAcento(texto);
  return semAcento(termo).split(/\s+/).filter((p) => p !== "").every((p) => alvo.includes(p));
}
/** Os itens que combinam com a busca, na ordem em que vieram. */
export const filtrarItens = (itens, termo) => itens.filter((i) => combinaComABusca(textoDeBusca(i), termo));
