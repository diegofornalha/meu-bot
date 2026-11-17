/**
 * Lista de espera do site: `POST /lista-espera` no próprio host do site (mesma origem, sem CORS e sem login). Guarda um
 * e-mail ou WhatsApp de quem chegou por uma plataforma ainda não atendida (Windows), para avisar no lançamento.
 * Repetido responde ok igual ao novo (não diz se o contato já estava na lista); limite por IP por minuto.
 */
import type { Env } from "../tipos.js";
import { contarLimite } from "../db.js";
import { agoraIso, janelaMinuto, uuid } from "../sessao-core.js";
import { json } from "../http.js";
import { clientIdValido } from "../pagamento-core.js";
import { cliqueValido, lerContato, origemLista, plataformaValida } from "../lista-core.js";

const LIMITE_POR_MIN = 6;

export async function postListaEspera(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("cf-connecting-ip") ?? "sem-ip";
  if (await contarLimite(env.DB, `lista:${ip}`, janelaMinuto()) > LIMITE_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const texto = await req.text();
  if (texto.length > 2000) return json({ erro: "corpo grande demais" }, 413);
  let corpo: Record<string, unknown> | null = null;
  try { const j: unknown = JSON.parse(texto); if (j !== null && typeof j === "object") corpo = j as Record<string, unknown>; } catch { corpo = null; }
  const c = lerContato(corpo?.contato);
  if (c === null) return json({ erro: "escreva um e-mail ou um WhatsApp com DDD" }, 400);
  const plataforma = corpo?.plataforma ?? "windows";
  if (!plataformaValida(plataforma)) return json({ erro: "lista desconhecida" }, 400);
  await env.DB.prepare("INSERT OR IGNORE INTO lista_espera (id, contato, tipo, plataforma, origem, ga_client_id, gclid, criado_em, avisado_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)")
    .bind(uuid(), c.contato, c.tipo, plataforma, origemLista(corpo?.origem), clientIdValido(corpo?.gaClientId), cliqueValido(corpo?.gclid), agoraIso()).run();
  return json({ ok: true });
}
