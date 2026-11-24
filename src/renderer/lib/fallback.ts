/** Fallback entre provedores do agente (o Claude e os que a máquina informa): quem é a reserva de um primário e a frase que explica a corrente. Puro, com teste. */
import { MODELO_PADRAO, ehPerfilClaude, serveDeReserva } from "../../shared/modelos.js";

/** Um provedor da corrente, como o /status o informa. Backend antigo não manda `reserva` nem `rotulo`. */
export interface FallbackProvider { name: string; available: boolean; reserva?: boolean; rotulo?: string }

/** O primário entra na corrente de fallback? Quem diz é a corrente da máquina; sem ela, só o agente é certo. */
export const primarioNaCorrente = (primary: string, chain: readonly FallbackProvider[] | null): boolean =>
  chain === null || chain.length === 0 ? primary === MODELO_PADRAO : chain.some((p) => p.name === primary);

/** A máquina tem outro modelo além do Claude (o modo grátis, o de um módulo)? Sem a corrente lida, não se sabe: false. */
export const temOutroModelo = (chain: readonly FallbackProvider[] | null): boolean => (chain ?? []).some((p) => !ehPerfilClaude(p.name));
/** Esse outro modelo já responde (instalado e com o que precisa)? É o que o passo 1 do tutorial 5 pede. */
export const outroModeloPronto = (chain: readonly FallbackProvider[] | null): boolean => (chain ?? []).some((p) => !ehPerfilClaude(p.name) && p.available);

/** Uma opção do seletor "Primário nesta máquina" (tutorial 5): o modelo padrão que ela grava e o texto da linha. */
export interface OpcaoPrimario { modelo: string; texto: string }
const textoDaOpcao = (p: FallbackProvider): string =>
  p.name === "ollama-local" ? "Ollama, modo grátis (ollama-local)" : p.rotulo !== undefined && p.rotulo !== p.name ? `${p.rotulo} (${p.name})` : p.name;
/**
 * As opções do seletor: o Claude sempre, e depois cada provedor que o backend desta máquina traz na corrente (o
 * Ollama do modo grátis, o que um módulo trouxer). O modo grátis já escolhido de primário não some da lista, mesmo
 * que a corrente ainda não o traga (ele acabou de ser instalado).
 */
export function opcoesDePrimario(chain: readonly FallbackProvider[] | null, atual: string): OpcaoPrimario[] {
  const opcoes: OpcaoPrimario[] = [{ modelo: MODELO_PADRAO, texto: "Claude (agente)" }];
  for (const p of chain ?? []) if (!opcoes.some((o) => o.modelo === p.name)) opcoes.push({ modelo: p.name, texto: textoDaOpcao(p) });
  if (atual === "ollama-local" && !opcoes.some((o) => o.modelo === atual)) opcoes.push({ modelo: atual, texto: textoDaOpcao({ name: atual, available: false }) });
  return opcoes;
}
/** A reserva de um primário: quem mais está disponível na corrente e aceita ser reserva, em ordem (vazio = sem reserva). */
export const fallbackReserve = (primary: string, chain: readonly FallbackProvider[]): string[] => chain.filter((p) => p.available && p.name !== primary && serveDeReserva(p)).map((p) => p.name);
/** "a, b ou c". */
const lista = (nomes: readonly string[]): string => (nomes.length <= 1 ? nomes.join("") : `${nomes.slice(0, -1).join(", ")} ou ${nomes.at(-1)}`);
/** A linha "Primário: … Reserva: …" das Configurações e do tutorial 5, a partir do que o backend informa. */
export function fallbackOrderText(primary: string, chain: readonly FallbackProvider[] | null): string {
  if (chain === null || chain.length === 0) return "O backend desta máquina ainda não informa a corrente de provedores.";
  if (!chain.some((p) => p.name === primary)) return `${primary} fica fora da corrente: sem reserva. Com ${lista(chain.map((p) => p.name))} como primário a reserva é automática.`;
  const reserve = fallbackReserve(primary, chain);
  return reserve.length === 0 ? `Primário: ${primary}. Sem reserva disponível nesta máquina.` : `Primário: ${primary}. Reserva: ${reserve.join(" → ")}, só se o primário falhar antes de responder. A reserva não gasta nada até ser acionada.`;
}
