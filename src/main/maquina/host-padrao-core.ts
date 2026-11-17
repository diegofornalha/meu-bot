/**
 * Máquina de quem ainda não escolheu nenhuma (primeira abertura, a última saiu da lista, entrada rápida sem janela).
 * Puro: testável com node --test. Onde o host "local" é oferecido (caps().hostLocal) é ele, como sempre; onde não é
 * (Windows: o app é só cliente de máquinas por SSH), a primeira da lista; sem nenhuma, null, e quem chama abre o
 * seletor vazio em vez de inventar uma máquina.
 */
export function hostPadrao(local: string | null, listados: readonly string[]): string | null {
  return local ?? listados[0] ?? null;
}
