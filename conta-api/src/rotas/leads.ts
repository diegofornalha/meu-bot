/**
 * Código por visita.
 * - `POST /lead-ref` (host do site, sem login, limite por IP): o site grava o código quando a pessoa clica num botão de
 *   WhatsApp. O primeiro registro de um código vale; repetido responde ok igual.
 * - `GET /leads/:codigo` e `POST /leads/:codigo/qualificar` (API, `Authorization: Bearer <LEADS_TOKEN>`): quem atende
 *   (o agente de marketing) lê de qual campanha veio a conversa e marca o lead como qualificado, o que manda
 *   `qualify_lead` ao GA4 uma vez. Sem o secret LEADS_TOKEN as duas respondem 503.
 */
import type { Env } from "../tipos.js";
import { contarLimite } from "../db.js";
import { agoraIso, janelaMinuto } from "../sessao-core.js";
import { json } from "../http.js";
import { clientIdValido, sessionIdValido } from "../pagamento-core.js";
import { cliqueValido } from "../lista-core.js";
import { gaIds } from "../analytics-core.js";
import { codigoLead, origemLead, qualificaGa4, segredoConfere, utmValido } from "../lead-core.js";

const LIMITE_POR_MIN = 6, LIMITE_LEITURA_POR_MIN = 60;

export async function postLeadRef(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("cf-connecting-ip") ?? "sem-ip";
  if (await contarLimite(env.DB, `lead:${ip}`, janelaMinuto()) > LIMITE_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const texto = await req.text();
  if (texto.length > 2000) return json({ erro: "corpo grande demais" }, 413);
  let c: Record<string, unknown> | null = null;
  try { const j: unknown = JSON.parse(texto); if (j !== null && typeof j === "object") c = j as Record<string, unknown>; } catch { c = null; }
  const codigo = codigoLead(c?.codigo);
  if (codigo === null) return json({ erro: "código fora da forma" }, 400);
  const clientId = clientIdValido(c?.gaClientId);
  await env.DB.prepare("INSERT OR IGNORE INTO lead_ref (codigo, origem, ga_client_id, ga_session_id, gclid, utm_source, utm_medium, utm_campaign, utm_content, criado_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
    .bind(codigo, origemLead(c?.origem), clientId, clientId === null ? null : sessionIdValido(c?.gaSessionId), cliqueValido(c?.gclid), utmValido(c?.utmSource), utmValido(c?.utmMedium), utmValido(c?.utmCampaign), utmValido(c?.utmContent), agoraIso()).run();
  return json({ ok: true });
}

interface LeadLinha { codigo: string; origem: string; ga_client_id: string | null; ga_session_id: string | null; gclid: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; criado_em: string; qualificado_em: string | null; ga_enviado_em: string | null }
const leadApi = (l: LeadLinha): Record<string, unknown> => ({ codigo: l.codigo, origem: l.origem, criadoEm: l.criado_em, qualificadoEm: l.qualificado_em, campanha: { fonte: l.utm_source, meio: l.utm_medium, campanha: l.utm_campaign, conteudo: l.utm_content }, veioDeAnuncio: l.gclid !== null, temVisita: l.ga_client_id !== null });

/** `rota` = "GET /leads/ABC234" ou "POST /leads/ABC234/qualificar"; null quando o caminho não é destas rotas. */
export async function rotaLeads(rota: string, req: Request, env: Env): Promise<Response | null> {
  const m = /^(GET|POST) \/leads\/([A-Za-z0-9]{1,12})(\/qualificar)?$/.exec(rota);
  if (m === null || (m[1] === "GET") === (m[3] !== undefined)) return null;
  if (!env.LEADS_TOKEN) return json({ erro: "leads desligados neste ambiente (sem LEADS_TOKEN)" }, 503);
  const ip = req.headers.get("cf-connecting-ip") ?? "sem-ip";
  if (await contarLimite(env.DB, `leads:${ip}`, janelaMinuto()) > LIMITE_LEITURA_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const b = /^Bearer\s+(\S+)$/.exec(req.headers.get("authorization") ?? "");
  if (b === null || !segredoConfere(b[1]!, env.LEADS_TOKEN)) return json({ erro: "token inválido" }, 401);
  const codigo = codigoLead(m[2]);
  const l = codigo === null ? null : await env.DB.prepare("SELECT * FROM lead_ref WHERE codigo = ?1").bind(codigo).first<LeadLinha>();
  if (l === null) return json({ erro: "código desconhecido" }, 404);
  if (m[1] === "GET") return json(leadApi(l));
  // A data é de quem marcou primeiro. O envio ao GA4 pode ser tentado de novo enquanto não tiver dado certo: chamar
  // outra vez depois de um "recusado" reenvia, e depois de um "enviado" não conta duas vezes.
  const repetido = l.qualificado_em !== null;
  let quando = l.qualificado_em;
  if (quando === null) {
    quando = agoraIso();
    const marcou = await env.DB.prepare("UPDATE lead_ref SET qualificado_em = ?2 WHERE codigo = ?1 AND qualificado_em IS NULL").bind(l.codigo, quando).run();
    if ((marcou.meta.changes ?? 0) === 0) quando = (await env.DB.prepare("SELECT qualificado_em FROM lead_ref WHERE codigo = ?1").bind(l.codigo).first<{ qualificado_em: string | null }>())?.qualificado_em ?? quando;
  }
  return json({ ...leadApi({ ...l, qualificado_em: quando }), repetido, analytics: await enviarQualificado(env, l) });
}

/**
 * Manda `qualify_lead` ao GA4 uma vez por código; devolve o que aconteceu, para quem chamou não achar que contou quando
 * não contou. `ga_enviado_em` é reservado antes do envio (duas chamadas ao mesmo tempo: só uma envia) e devolvido se o
 * GA4 recusar ou estiver fora, para a próxima chamada tentar de novo.
 */
async function enviarQualificado(env: Env, l: LeadLinha): Promise<"enviado" | "sem-visita" | "desligado" | "recusado"> {
  if (l.ga_client_id === null) return "sem-visita";
  const id = gaIds(env.GA_ID)[0];
  if (id === undefined || !env.GA_MP_SECRET) return "desligado";
  const reservou = await env.DB.prepare("UPDATE lead_ref SET ga_enviado_em = ?2 WHERE codigo = ?1 AND ga_enviado_em IS NULL").bind(l.codigo, agoraIso()).run();
  if ((reservou.meta.changes ?? 0) === 0) return "enviado";
  const soltar = async (): Promise<"recusado"> => { await env.DB.prepare("UPDATE lead_ref SET ga_enviado_em = NULL WHERE codigo = ?1").bind(l.codigo).run(); return "recusado"; };
  const body = qualificaGa4({ clientId: l.ga_client_id, sessionId: l.ga_session_id, codigo: l.codigo, ambiente: env.CANAL === "staging" ? "staging" : "producao" });
  try {
    const r = await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(env.GA_MP_SECRET)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { console.log(`[lead] GA4 recusou o lead ${l.codigo}: HTTP ${r.status}`); return await soltar(); }
    return "enviado";
  } catch (e) { console.log(`[lead] GA4 fora: ${e instanceof Error ? e.message : String(e)}`); return await soltar(); }
}
