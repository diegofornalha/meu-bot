/**
 * Dono único do providers.json do backend local (este Mac). Quem prepara um provedor (o Grok pelo proxy do Hermes, o
 * Ollama do modo grátis) mescla a sua entrada aqui, sem apagar as dos outros. Puro: lê e devolve texto, testável com
 * node --test. O formato é o de backend-colima/providers.js ({ name, type, priority, ... }).
 */

export interface ProviderEntry { name: string; type: "claude" | "openai"; priority: number; [k: string]: unknown }

/** O agente (Claude Code) que todo providers.json local tem; base quando o arquivo falta ou não é uma lista. */
export const AGENTE_LOCAL: ProviderEntry = { name: "agente", type: "claude", priority: 0, description: "Claude Code com ferramentas, sem pedir permissão (bypass)" };

const ehEntrada = (v: unknown): v is ProviderEntry => typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string";

/** Lista atual do arquivo; ausente, ilegível ou fora do formato = só o agente. Entradas estranhas na lista ficam como estão. */
export function lerProvidersLocal(raw: string | null): unknown[] {
  if (raw === null) return [AGENTE_LOCAL];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list : [AGENTE_LOCAL];
  } catch { return [AGENTE_LOCAL]; }
}

const escrever = (list: readonly unknown[]): string => `${JSON.stringify(list, null, 2)}\n`;

/** Põe (ou troca, pelo nome) a entrada de um provedor e preserva as outras na ordem em que estavam. */
export function mesclarProvider(raw: string | null, entry: ProviderEntry): string {
  const list = lerProvidersLocal(raw);
  const i = list.findIndex((p) => ehEntrada(p) && p.name === entry.name);
  const next = i === -1 ? [...list, entry] : list.map((p, j) => (j === i ? entry : p));
  return escrever(next);
}

/** Tira a entrada de um provedor (remover o Ollama); sem ela, devolve o arquivo reescrito igual. */
export function semProvider(raw: string | null, name: string): string {
  return escrever(lerProvidersLocal(raw).filter((p) => !(ehEntrada(p) && p.name === name)));
}

/** A entrada de um provedor pelo nome, ou null. */
export function providerPorNome(raw: string | null, name: string): ProviderEntry | null {
  if (raw === null) return null;
  const p = lerProvidersLocal(raw).find((x) => ehEntrada(x) && x.name === name);
  return p === undefined ? null : (p as ProviderEntry);
}
