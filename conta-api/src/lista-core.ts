/**
 * Lista de espera do site (parte pura): lê o que a pessoa digitou no campo "e-mail ou WhatsApp" e as listas fechadas
 * de plataforma e de origem. Nada aqui toca o banco; a rota é `src/rotas/lista.ts`.
 */

export interface ContatoLista { tipo: "email" | "whatsapp"; contato: string }

/**
 * E-mail (minúsculo, até 120 caracteres) ou WhatsApp (só dígitos, com o 55 na frente). Aceita o número como a pessoa
 * escreve no Brasil: com ou sem +55, parênteses, espaço e hífen; 10 ou 11 dígitos com DDD. Qualquer outra coisa é null.
 */
export function lerContato(bruto: unknown): ContatoLista | null {
  if (typeof bruto !== "string") return null;
  const t = bruto.trim();
  if (t === "" || t.length > 120) return null;
  if (t.includes("@")) {
    const e = t.toLowerCase();
    return /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(e) && !e.includes("..") ? { tipo: "email", contato: e } : null;
  }
  if (!/^[+\d\s().-]+$/.test(t)) return null;
  let d = t.replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  d = d.replace(/^0+/, "");
  // DDD de 11 a 99 e, no celular, o 9 na frente.
  if (!/^[1-9][1-9](9\d{8}|[2-8]\d{7})$/.test(d)) return null;
  return { tipo: "whatsapp", contato: `55${d}` };
}

/** Plataformas com lista aberta. */
export const PLATAFORMAS_LISTA = ["windows"] as const;
export const plataformaValida = (x: unknown): x is (typeof PLATAFORMAS_LISTA)[number] => typeof x === "string" && (PLATAFORMAS_LISTA as readonly string[]).includes(x);

/** De onde o formulário foi enviado (as mesmas origens do evento lista_windows). */
const ORIGENS = ["hero", "final", "fixo", "obrigado", "baixar", "perguntas"] as const;
export const origemLista = (x: unknown): string => (typeof x === "string" && (ORIGENS as readonly string[]).includes(x) ? x : "site");

/** gclid/gbraid/wbraid como o Google os emite: letras, dígitos, _ e -, até 200. */
export const cliqueValido = (x: unknown): string | null => (typeof x === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(x) ? x : null);
