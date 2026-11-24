/**
 * Dono único do providers.json do backend local (este Mac). Quem prepara um provedor (o Ollama do modo
 * grátis) mescla a sua entrada aqui, sem apagar as dos outros. Puro: lê e devolve texto, testável com
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

/**
 * Herança de quando o Grok vinha no app: ele gravava aqui um `grok-4` apontado para um proxy que o próprio app subia
 * neste Mac, 100 portas abaixo do backend local. O app não sobe mais esse proxy, e a entrada que ficou seria um modelo
 * que aparece na lista e nunca responde. Devolve o arquivo sem ela, ou null quando não há o que tirar. Só sai a
 * entrada que o app escreveu (nome e endereço exatos): um grok-4 que a pessoa configurou de outro jeito fica.
 */
export function semProviderDoProxyAntigo(raw: string | null, portaBackend: number): string | null {
  if (raw === null) return null;
  const antigo = `http://127.0.0.1:${portaBackend - 100}/v1`;
  const list = lerProvidersLocal(raw);
  const resto = list.filter((p) => !(ehEntrada(p) && p.name === "grok-4" && p["base_url"] === antigo));
  return resto.length === list.length ? null : escrever(resto);
}

/** A entrada é o `grok-4` que vinha no providers.json padrão do backend (xAI por chave de API, sem chave literal)? */
const ehGrokDoPadraoAntigo = (p: unknown): boolean =>
  ehEntrada(p) && p.name === "grok-4" && p["base_url"] === "https://api.x.ai/v1" && p["key_env"] === "XAI_API_KEY" && p["key"] === undefined;

/** O providers.json local ainda traz o `grok-4` do padrão antigo? (para dizer no log por que ele ficou). */
export const temGrokDoPadraoAntigo = (raw: string | null): boolean => {
  if (raw === null) return false;
  try { const list = JSON.parse(raw) as unknown; return Array.isArray(list) && list.some(ehGrokDoPadraoAntigo); } catch { return false; }
};

/**
 * O providers.json local nasceu como cópia do padrão do backend, que trazia um `grok-4` pela API da xAI à espera de
 * uma XAI_API_KEY. Sem a chave, é um modelo que aparece na lista e nunca responde; o padrão novo não o traz, mas a
 * cópia deste Mac só é feita uma vez. Devolve o arquivo sem essa entrada, ou null quando não há o que tirar. Só sai a
 * entrada exata do padrão antigo e só sem chave: com `temChave` (a pessoa pôs a XAI_API_KEY de propósito) fica tudo
 * como está. Outro nome, outro endereço ou chave literal na entrada também ficam; arquivo ilegível não é tocado.
 */
export function semProviderDoPadraoAntigo(raw: string | null, temChave: boolean): string | null {
  if (temChave || !temGrokDoPadraoAntigo(raw)) return null;
  return escrever((JSON.parse(raw as string) as unknown[]).filter((p) => !ehGrokDoPadraoAntigo(p)));
}

/** Há XAI_API_KEY com valor no .env do backend local ou no ambiente em que ele sobe? */
export function temChaveXai(envTexto: string | null, env: Readonly<Record<string, string | undefined>>): boolean {
  if ((env["XAI_API_KEY"] ?? "").trim() !== "") return true;
  return /^\s*(?:export\s+)?XAI_API_KEY\s*=\s*["']?[^\s"'#]/m.test(envTexto ?? "");
}
