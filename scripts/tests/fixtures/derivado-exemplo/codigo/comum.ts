/**
 * Derivado de exemplo (testes do core): um arquivo da pasta `codigo/` usado pelos DOIS lados. O core o compila uma vez
 * para cada um (CommonJS no processo principal, módulo ES na janela). Só serve aos dois o que é puro: aqui não há
 * Node nem DOM.
 */

/** O nome do canal, escrito num lugar só: o processo principal registra, a página chama. */
export const CANAL_ECO = "eco";

/** O texto que a página mostra com o que o canal devolveu. */
export const textoDoEco = (resposta: unknown): string => `eco: ${JSON.stringify(resposta)}`;
