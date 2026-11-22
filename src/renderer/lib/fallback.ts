/** Fallback entre provedores do agente (Claude, Grok e o Ollama do modo grátis): quem é a reserva de um primário e a frase que explica a corrente. Puro, com teste. */

export interface FallbackProvider { name: string; available: boolean }
/** Modelos que entram na corrente de fallback (os outros respondem sozinhos, sem reserva). */
export const FALLBACK_PRIMARIES: readonly string[] = ["agente", "grok-4", "ollama-local"];

/** Uma opção do seletor "Primário nesta máquina" (tutorial 5): o modelo padrão que ela grava e o texto da linha. */
export interface OpcaoPrimario { modelo: string; texto: string }
/**
 * As opções do seletor: Claude e xAI sempre; o Ollama só onde o modo grátis está instalado, ou seja, quando o backend
 * desta máquina traz o ollama-local na corrente (ou ele já é o primário, para a escolha atual não sumir da lista).
 */
export function opcoesDePrimario(chain: readonly FallbackProvider[] | null, atual: string): OpcaoPrimario[] {
  const opcoes: OpcaoPrimario[] = [{ modelo: "agente", texto: "Claude (agente)" }, { modelo: "grok-4", texto: "xAI (grok-4)" }];
  if (atual === "ollama-local" || (chain ?? []).some((p) => p.name === "ollama-local")) opcoes.push({ modelo: "ollama-local", texto: "Ollama, modo grátis (ollama-local)" });
  return opcoes;
}
/** A reserva de um primário: quem mais está disponível na corrente, em ordem (vazio = sem reserva). */
export const fallbackReserve = (primary: string, chain: readonly FallbackProvider[]): string[] => chain.filter((p) => p.available && p.name !== primary).map((p) => p.name);
/** A linha "Primário: … Reserva: …" das Configurações e do tutorial 5, a partir do que o backend informa. */
export function fallbackOrderText(primary: string, chain: readonly FallbackProvider[] | null): string {
  if (chain === null || chain.length === 0) return "O backend desta máquina ainda não informa a corrente de provedores.";
  if (!chain.some((p) => p.name === primary)) return `${primary} fica fora da corrente: sem reserva. Com agente, grok-4 ou ollama-local como primário a reserva é automática.`;
  const reserve = fallbackReserve(primary, chain);
  return reserve.length === 0 ? `Primário: ${primary}. Sem reserva disponível nesta máquina.` : `Primário: ${primary}. Reserva: ${reserve.join(" → ")}, só se o primário falhar antes de responder. A reserva não gasta nada até ser acionada.`;
}
