/**
 * Código por visita (parte pura): o código curto que vai na mensagem pronta do WhatsApp, a campanha que o site manda
 * junto e o evento `qualify_lead` do GA4. Nada aqui toca o banco; as rotas são `src/rotas/leads.ts`.
 */

/** O alfabeto do código: 32 símbolos, sem I, O, 0 e 1 (quem atende lê e digita sem confundir). O celular.js usa o mesmo. */
export const ALFABETO_LEAD = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Seis símbolos de ALFABETO_LEAD, em maiúsculas (aceita minúsculas e espaços em volta); o resto é null. */
export function codigoLead(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const c = x.trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{6}$/.test(c) ? c : null;
}

/** Um valor de UTM como o site o aceita em `limpo` (celular.js): letras, dígitos, ponto, _ e -, até 60. */
export const utmValido = (x: unknown): string | null => (typeof x === "string" && /^[A-Za-z0-9._-]{1,60}$/.test(x) ? x : null);

/** De qual botão a conversa saiu (o `data-origem` do botão de WhatsApp: "celular", "final", "flutuante"…); fora da forma vira "site". */
export const origemLead = (x: unknown): string => (typeof x === "string" && /^[a-z0-9-]{1,30}$/.test(x) ? x : "site");

/** Comparação de segredos sem sair no primeiro caractere diferente. */
export function segredoConfere(recebido: string, nosso: string | undefined): boolean {
  if (nosso === undefined || nosso.length < 32 || recebido.length !== nosso.length) return false;
  let d = 0;
  for (let i = 0; i < nosso.length; i++) d |= recebido.charCodeAt(i) ^ nosso.charCodeAt(i);
  return d === 0;
}

/**
 * O corpo do Measurement Protocol para um lead qualificado: `qualify_lead` (evento recomendado do GA4) no client_id da
 * visita em que a pessoa clicou no WhatsApp, para a campanha daquela visita levar o crédito. O código vai como
 * parâmetro (`lead_ref`): não identifica ninguém fora da nossa tabela.
 */
export function qualificaGa4(p: { clientId: string; sessionId: string | null; codigo: string; ambiente: "producao" | "staging" }): Record<string, unknown> {
  const params: Record<string, unknown> = { lead_ref: p.codigo, ambiente: p.ambiente, engagement_time_msec: 1 };
  if (p.sessionId !== null) params.session_id = p.sessionId;
  if (p.ambiente === "staging") params.debug_mode = true;
  return { client_id: p.clientId, events: [{ name: "qualify_lead", params }] };
}
