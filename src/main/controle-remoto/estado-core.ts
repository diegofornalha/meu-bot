/**
 * O retrato da máquina e a leitura das conversas para o controle externo (25 nov), nas partes que não dependem do
 * Electron. Puro, testado; quem chama as funções do app é o estado.ts.
 */
/** Uma parte do retrato que demora ou falha não derruba as outras: vira `{ erro }`. */
export async function parte<T>(f: () => T | Promise<T>, ms = 8000): Promise<T | { erro: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(f),
      new Promise<never>((_r, rej) => { timer = setTimeout(() => rej(new Error(`não respondeu em ${Math.round(ms / 1000)} s`)), ms); }),
    ]);
  } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

const SEGREDO = /token|secret|senha|password|chave|apikey|api_key|refresh/i;
/** Tira do retrato qualquer campo com cara de segredo, em qualquer profundidade: o estado é para ler, não para autenticar. */
export function semSegredos(v: unknown, fundo = 0): unknown {
  if (v === null || typeof v !== "object" || fundo > 8) return v;
  if (Array.isArray(v)) return v.map((x) => semSegredos(x, fundo + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !SEGREDO.test(k)).map(([k, x]) => [k, semSegredos(x, fundo + 1)]));
}

interface Mensagem { role: string; content: string }
interface Guardada { id: string; title?: string; host: string; model: string; messages: readonly Mensagem[]; updatedAt: string; archived: boolean; openAsTab: boolean }

/** Uma linha por conversa: o bastante para escolher qual ler. */
export function resumoDaConversa(c: Guardada, ocupada: boolean): Record<string, unknown> {
  const primeira = c.messages.find((m) => m.role === "user")?.content ?? "";
  return { id: c.id, titulo: c.title ?? (primeira.replace(/\s+/g, " ").trim().slice(0, 60) || "(sem mensagens)"), maquina: c.host, modelo: c.model, mensagens: c.messages.length, atualizadaEm: c.updatedAt, arquivada: c.archived, aberta: c.openAsTab, ocupada };
}

/** As últimas mensagens (padrão 20, teto 100), cada uma cortada em 4000 caracteres, com a posição dela na conversa. */
export function ultimasMensagens(messages: readonly Mensagem[], ultimas: unknown): { indice: number; de: string; texto: string; cortada: boolean }[] {
  const n = typeof ultimas === "number" && Number.isInteger(ultimas) && ultimas > 0 ? Math.min(ultimas, 100) : 20;
  const ini = Math.max(0, messages.length - n);
  return messages.slice(ini).map((m, i) => ({ indice: ini + i, de: m.role === "user" ? "pessoa" : "agente", texto: m.content.slice(0, 4000), cortada: m.content.length > 4000 }));
}
