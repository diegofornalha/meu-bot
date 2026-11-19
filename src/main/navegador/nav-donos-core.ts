/**
 * Abas do Navegador com dono por conversa (parte pura, testada). Várias conversas usam o mesmo Navegador ao mesmo
 * tempo (as do meu-bot, a DM e cada grupo do WhatsApp): cada uma trabalha nas próprias abas, nenhuma mexe na aba de
 * outra, e sem aba indicada ninguém mexe na aba que a pessoa está olhando. Ler e tirar print de qualquer aba continua
 * livre ("veja o que eu estou vendo"). Pedido sem identidade (servidor antigo) segue a regra de antes: aba da frente.
 */
import type { OrigemDono } from "../../shared/ipc";
export type Origem = OrigemDono;
export interface Dono { id: string; rotulo: string; origem: Origem }
export interface Posse extends Dono { em: number }
/** Posse sem uso por mais que isso some: a aba volta a ser "da pessoa". */
export const POSSE_TTL_MS = 10 * 60_000;
/** Abas por conversa: a partir daí, "abrir nova" reaproveita a mais antiga dela. */
export const MAX_ABAS = 3;
export type Tipo = "leitura" | "mexe";

const ID_RE = /^[\w:+.@=-]{1,200}$/;
/** Cabeçalho `X-Meu-Bot-Dono`: base64 de `{ id, rotulo, origem }`; inválido ou ausente = null (regra antiga). */
export function parseDono(header: unknown): Dono | null {
  if (typeof header !== "string" || header === "" || header.length > 2000) return null;
  try {
    const j = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Record<string, unknown>;
    if (typeof j.id !== "string" || !ID_RE.test(j.id)) return null;
    const origem: Origem = j.origem === "whatsapp" || j.origem === "claude-code" ? j.origem : "meu-bot";
    const rotulo = typeof j.rotulo === "string" ? j.rotulo.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80) : "";
    return { id: j.id, rotulo: rotulo || (origem === "whatsapp" ? "WhatsApp" : origem === "claude-code" ? "Claude Code" : "meu-bot"), origem };
  } catch { return null; }
}

/**
 * Pedido sem identidade (sem o cabeçalho `X-Meu-Bot-Dono`: um servidor antigo do Navegador na máquina, ou alguém
 * chamando o canal direto): conta como uma conversa só, para também ter as próprias abas e respeitar as dos outros
 * (o WhatsApp, principalmente). O selo diz "sem identificação"; antes dizia "legado", que sugeria um backend velho
 * rodando quando quase sempre é só um chamador que não se apresentou. O id é lido em `navDonoView` (renderer).
 */
export const DONO_SEM_IDENTIDADE: Dono = { id: "meu-bot:sem-identificacao", rotulo: "sem identificação", origem: "meu-bot" };

/** Tira do mapa as abas fechadas e as posses vencidas. */
export function limpar(posses: Map<number, Posse>, vivas: readonly number[], agora: number): void {
  const v = new Set(vivas);
  for (const [aba, p] of posses) if (!v.has(aba) || agora - p.em > POSSE_TTL_MS) posses.delete(aba);
}

/** Abas desta conversa, da mais recente para a mais antiga. */
export function abasDe(posses: ReadonlyMap<number, Posse>, dono: Dono): number[] {
  return [...posses.entries()].filter(([, p]) => p.id === dono.id).sort((a, b) => b[1].em - a[1].em).map(([aba]) => aba);
}

const ocupada = (posses: ReadonlyMap<number, Posse>, aba: number, dono: Dono | null): Posse | null => {
  const p = posses.get(aba);
  return p !== undefined && (dono === null || p.id !== dono.id) ? p : null;
};
const recusa = (p: Posse): string => `essa aba está em uso por outra conversa (${p.rotulo}); use abrir com nova=true e siga numa aba sua`;

/**
 * Em que aba fazer uma ação (`abrir` tem regra própria em `decidirAbrir`). `vivas` em ordem; `ativa` = a da frente.
 * Leitura vale em qualquer aba; mexer na aba de outra conversa é recusado.
 */
export function escolherAba(p: { posses: ReadonlyMap<number, Posse>; vivas: readonly number[]; ativa: number | null; dono: Dono | null; aba?: number | undefined; tipo: Tipo }): { aba: number } | { erro: string } {
  if (p.vivas.length === 0) return { erro: "a aba Navegador está sem abas: use 'abrir' com uma url" };
  if (typeof p.aba === "number") {
    if (!p.vivas.includes(p.aba)) return { erro: `aba ${p.aba} não existe: veja 'abas'` };
    const outra = p.tipo === "mexe" && p.dono !== null ? ocupada(p.posses, p.aba, p.dono) : null;
    return outra !== null ? { erro: recusa(outra) } : { aba: p.aba };
  }
  const frente = p.ativa !== null && p.vivas.includes(p.ativa) ? p.ativa : p.vivas[0]!;
  if (p.dono === null) return { aba: frente };
  const minha = abasDe(p.posses, p.dono)[0];
  if (minha !== undefined) return { aba: minha };
  if (p.tipo === "leitura") return { aba: frente };
  const outra = ocupada(p.posses, frente, p.dono);
  return outra !== null ? { erro: `a aba da frente está em uso por outra conversa (${outra.rotulo}); use abrir com uma url para ter uma aba sua` } : { aba: frente };
}

/** `abrir`: navegar numa aba (dela, ou a indicada) ou abrir uma nova. Nunca a aba da frente da pessoa sem pedir. */
export function decidirAbrir(p: { posses: ReadonlyMap<number, Posse>; vivas: readonly number[]; ativa: number | null; dono: Dono | null; aba?: number | undefined; nova: boolean }): { modo: "nova" } | { modo: "navegar"; aba: number } | { erro: string } {
  if (typeof p.aba === "number") {
    const r = escolherAba({ ...p, tipo: "mexe" });
    return "erro" in r ? r : { modo: "navegar", aba: r.aba };
  }
  if (p.dono === null) {
    // Regra antiga (servidor sem identidade): nova se pedida ou sem abas; senão a da frente.
    if (p.nova || p.vivas.length === 0) return { modo: "nova" };
    const frente = p.ativa !== null && p.vivas.includes(p.ativa) ? p.ativa : p.vivas[0]!;
    return { modo: "navegar", aba: frente };
  }
  const minhas = abasDe(p.posses, p.dono);
  if (p.nova) return minhas.length >= MAX_ABAS ? { modo: "navegar", aba: minhas[minhas.length - 1]! } : { modo: "nova" };
  return minhas.length > 0 ? { modo: "navegar", aba: minhas[0]! } : { modo: "nova" };
}

/** A aba passa a ser desta conversa (ou só renova o uso). */
export function tomar(posses: Map<number, Posse>, aba: number, dono: Dono | null, agora: number): void {
  if (dono !== null) posses.set(aba, { ...dono, em: agora });
}

/** Como a aba aparece para quem pergunta (`/abas`). */
export function donoTexto(posses: ReadonlyMap<number, Posse>, aba: number, dono: Dono | null): string {
  const p = posses.get(aba);
  if (p === undefined) return "da pessoa";
  return dono !== null && p.id === dono.id ? "esta conversa" : `outra conversa: ${p.rotulo}`;
}

/** Fechar: só aba da própria conversa. */
export function podeFechar(posses: ReadonlyMap<number, Posse>, aba: number, dono: Dono | null): string | null {
  if (dono === null) return "fechar abas exige a versão nova do servidor do Navegador";
  const p = posses.get(aba);
  if (p === undefined) return "essa aba não é desta conversa (é da pessoa): não feche";
  return p.id === dono.id ? null : recusa(p);
}

/**
 * O agente fechou a aba dele depois de mexer num site: as abas **da pessoa** (sem posse) que estão no mesmo site ficam
 * velhas, mostrando a versão de antes, e ela tinha de atualizar na mão. Devolve as abas a recarregar: mesma origem
 * (esquema + host + porta) da aba fechada, fora a própria e fora as de qualquer conversa (recarregar a aba de outro
 * agente no meio de uma ação dele seria pior). URL inválida ou sem origem (about:blank) não conta.
 */
export function abasParaRecarregar(urlFechada: string, abas: readonly { id: number; url: string }[], fechada: number, posses: ReadonlyMap<number, Posse>): number[] {
  const origem = (u: string): string | null => { try { const o = new URL(u).origin; return o === "null" ? null : o; } catch { return null; } };
  const alvo = origem(urlFechada);
  if (alvo === null) return [];
  return abas.filter((a) => a.id !== fechada && !posses.has(a.id) && origem(a.url) === alvo).map((a) => a.id);
}
