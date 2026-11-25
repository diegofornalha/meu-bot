/**
 * Arrastar um arquivo ou pasta do Finder para a caixa da conversa escreve o endereço dele no texto, como no terminal.
 * Aqui fica só a conta do texto (o que escrever e onde); o endereço vem do preload (webUtils.getPathForFile).
 * Puro: testável com node --test.
 */

/**
 * Um endereço como texto. Sem espaço nem aspa, entra como está; com espaço, entre aspas. Com aspa no nome, entre aspas
 * e com a aspa e a barra invertida de dentro escapadas (as duas, senão `\"` ficaria ambíguo). Sem aspa no nome a barra
 * fica como está: é o separador dos endereços do Windows, onde nome de arquivo não tem aspa.
 */
function textoDoCaminho(c: string): string {
  if (c.includes('"')) return `"${c.replace(/(["\\])/g, "\\$1")}"`;
  return /\s/.test(c) ? `"${c}"` : c;
}

/** O texto dos endereços soltos: um ao lado do outro, separados por espaço. */
export function textoDosCaminhos(caminhos: readonly string[]): string {
  return caminhos.filter((c) => c !== "").map(textoDoCaminho).join(" ");
}

/**
 * Põe `texto` no lugar da seleção (`inicio`..`fim`) de `valor`. Separa do que veio antes com um espaço e termina com
 * outro, para a pessoa continuar a frase; devolve o valor novo e onde o cursor fica.
 */
export function inserirNoCursor(valor: string, inicio: number, fim: number, texto: string): { valor: string; cursor: number } {
  if (texto === "") return { valor, cursor: fim };
  const antes = valor.slice(0, inicio);
  const depois = valor.slice(fim);
  const meio = (antes !== "" && !/\s$/.test(antes) ? " " : "") + texto + (/^\s/.test(depois) ? "" : " ");
  return { valor: antes + meio + depois, cursor: antes.length + meio.length };
}
