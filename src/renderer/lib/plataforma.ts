/**
 * Em que computador o app está, para os textos que aparecem também no Windows ("neste Mac" vira "neste Windows").
 * Puro: testável com node --test (passe a plataforma). As frases que só existem no caminho do Mac ficam como estão.
 */

/** O navegador da janela diz a plataforma: "Win32" no Windows (x64 ou ARM), "MacIntel" no Mac. */
export const ehWindows = (plataforma: string = typeof navigator === "undefined" ? "" : navigator.platform): boolean => /^win/i.test(plataforma);

/** "este Mac" ou "este Windows" (minúsculo: vai no meio da frase). */
export const nomeDesteComputador = (windows: boolean = ehWindows()): "este Mac" | "este Windows" => (windows ? "este Windows" : "este Mac");
/** "neste Mac" ou "neste Windows". */
export const nesteComputador = (windows: boolean = ehWindows()): "neste Mac" | "neste Windows" => (windows ? "neste Windows" : "neste Mac");

/** O aviso do "sincronizar ssh" quando falta uma chave do modelo: no Windows não há "outro Mac" de onde copiar. */
export function avisoChaveFaltando(chaves: readonly string[], windows: boolean = ehWindows()): string {
  const lista = chaves.join(", ");
  return windows
    ? `⚠ falta a chave ${lista} ${nesteComputador(true)}: copie do computador onde ela está, ou gere uma nova e coloque a .pub no authorized_keys de cada máquina (PLAYBOOK, seção 1).`
    : `⚠ falta a chave ${lista} ${nesteComputador(false)}: copie do outro Mac, ou gere uma nova e coloque a .pub no authorized_keys de cada máquina (PLAYBOOK, seção 1).`;
}
