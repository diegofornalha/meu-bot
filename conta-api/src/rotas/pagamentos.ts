/**
 * Assinatura do Pro pela AbacatePay:
 * - `POST /conta/assinatura` (logado): cria o checkout de assinatura e devolve a `url` da página de pagamento;
 * - `POST /pagamentos/abacatepay` (webhook, sem login): confere secret e assinatura, grava o evento uma vez só, libera o
 *   Pro na cobrança paga e manda a compra ao GA4 (Measurement Protocol) com o client_id guardado no checkout.
 * Liga só com ABACATEPAY_KEY, ABACATEPAY_WEBHOOK_SECRET e ABACATEPAY_PRODUTO; sem eles, as duas rotas respondem 503.
 */
import type { Env } from "../tipos.js";
import { auditar, contaPorId, contarLimite, licencaDaConta } from "../db.js";
import { agoraIso, janelaMinuto, uuid } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";
import { gaIds } from "../analytics-core.js";
import { clientIdValido, compraGa4, decidir, lerEvento, sessionIdValido, validoAte, webhookConfere, type Decisao } from "../pagamento-core.js";

const API = "https://api.abacatepay.com/v2";
export const pagamentosLigados = (env: Env): boolean => Boolean(env.ABACATEPAY_KEY && env.ABACATEPAY_WEBHOOK_SECRET && env.ABACATEPAY_PRODUTO);
const preco = (env: Env): number => { const n = Number(env.ABACATEPAY_PRECO_CENTAVOS ?? "9700"); return Number.isInteger(n) && n > 0 ? n : 9700; };
const metodos = (env: Env): string[] => { const m = (env.ABACATEPAY_METODOS ?? "CARD").split(",").map((x) => x.trim().toUpperCase()).filter((x) => x === "CARD" || x === "PIX"); return m.length > 0 ? m : ["CARD"]; };

/** Quantos checkouts por conta por minuto (cada clique em "Assinar" cria um). */
const LIMITE_POR_MIN = 5;

export async function postAssinatura(auth: Autenticado, env: Env, req: Request): Promise<Response> {
  if (!pagamentosLigados(env)) return json({ erro: "a assinatura pelo site ainda não está ligada; fale com o suporte" }, 503);
  if (await contarLimite(env.DB, `assinar:${auth.conta.id}`, janelaMinuto()) > LIMITE_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const l = await licencaDaConta(env.DB, auth.conta);
  const ativa = await env.DB.prepare("SELECT id FROM assinaturas WHERE conta_id = ?1 AND status = 'ACTIVE' LIMIT 1").bind(auth.conta.id).first<{ id: string }>();
  if (ativa !== null && l.plan === "pro" && l.status === "active") return json({ erro: "você já tem uma assinatura ativa" }, 409);
  const corpo = (await lerJson(req)) as Record<string, unknown> | null;
  const ref = `mb_${uuid()}`;
  const agora = agoraIso();
  await env.DB.prepare("INSERT INTO pagamento_checkouts (ref, conta_id, checkout_id, ga_client_id, ga_session_id, criado_em) VALUES (?1, ?2, NULL, ?3, ?4, ?5)")
    .bind(ref, auth.conta.id, clientIdValido(corpo?.gaClientId), sessionIdValido(corpo?.gaSessionId), agora).run();
  let r: Response;
  try {
    r = await fetch(`${API}/subscriptions/create`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.ABACATEPAY_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        items: [{ id: env.ABACATEPAY_PRODUTO, quantity: 1 }],
        methods: metodos(env),
        externalId: ref,
        completionUrl: `${env.CONSOLE_ORIGIN}/account/plan?assinatura=paga`,
        returnUrl: `${env.CONSOLE_ORIGIN}/account/plan`,
        metadata: { conta: auth.conta.id },
      }),
    });
  } catch (e) { console.log(`[pagamento] AbacatePay fora: ${e instanceof Error ? e.message : String(e)}`); return json({ erro: "o pagamento não respondeu; tente de novo" }, 502); }
  const resp = (await r.json().catch(() => null)) as { data?: { id?: unknown; url?: unknown }; error?: unknown } | null;
  const url = typeof resp?.data?.url === "string" && /^https:\/\/([a-z0-9-]+\.)*abacatepay\.com\//.test(resp.data.url) ? resp.data.url : null;
  const bill = typeof resp?.data?.id === "string" && resp.data.id.length <= 100 ? resp.data.id : null;
  if (!r.ok || url === null) { console.log(`[pagamento] criar assinatura recusado: HTTP ${r.status} ${JSON.stringify(resp?.error ?? null).slice(0, 200)}`); return json({ erro: "não deu para abrir o pagamento agora; tente de novo" }, 502); }
  await env.DB.prepare("UPDATE pagamento_checkouts SET checkout_id = ?1 WHERE ref = ?2").bind(bill, ref).run();
  await auditar(env.DB, auth.conta.email, "assinatura.checkout", auth.conta.id, bill);
  return json({ url });
}

/** O webhook: 401 sem secret e assinatura válidos (a AbacatePay não tenta de novo um 401); 200 para tudo que foi gravado. */
export async function postWebhookAbacate(req: Request, env: Env, url: URL, espera: (p: Promise<unknown>) => void): Promise<Response> {
  if (!pagamentosLigados(env)) return json({ erro: "pagamentos desligados" }, 503);
  const corpo = await req.text();
  if (corpo.length > 262144) return json({ erro: "corpo grande demais" }, 413);
  const secret = req.headers.get("x-webhook-secret") ?? url.searchParams.get("webhookSecret") ?? "";
  if (!(await webhookConfere(corpo, secret, req.headers.get("x-webhook-signature") ?? "", env.ABACATEPAY_WEBHOOK_SECRET))) {
    console.log("[pagamento] webhook recusado: secret ou assinatura não conferem");
    return json({ erro: "não autorizado" }, 401);
  }
  let bruto: unknown; try { bruto = JSON.parse(corpo); } catch { return json({ erro: "JSON inválido" }, 400); }
  const e = lerEvento(bruto);
  if ("erro" in e) { console.log(`[pagamento] webhook ilegível: ${e.erro}`); return json({ ok: true, ignorado: e.erro }); }
  const agora = agoraIso();
  const novo = await env.DB.prepare("INSERT OR IGNORE INTO webhook_eventos (id, evento, recebido_em, resultado) VALUES (?1, ?2, ?3, NULL)").bind(e.id, e.evento, agora).run();
  if ((novo.meta.changes ?? 0) === 0) return json({ ok: true, repetido: true });
  const d = decidir(e, env.CANAL === "staging" ? "staging" : "producao", preco(env));
  const resultado = await aplicar(env, d, e.devMode, agora, espera);
  await env.DB.prepare("UPDATE webhook_eventos SET resultado = ?1 WHERE id = ?2").bind(resultado.slice(0, 300), e.id).run();
  return json({ ok: true });
}

interface CheckoutLinha { ref: string; conta_id: string; ga_client_id: string | null; ga_session_id: string | null }
const checkoutPor = (env: Env, ref: string | null): Promise<CheckoutLinha | null> =>
  ref === null ? Promise.resolve(null) : env.DB.prepare("SELECT ref, conta_id, ga_client_id, ga_session_id FROM pagamento_checkouts WHERE ref = ?1").bind(ref).first<CheckoutLinha>();

/** Executa a decisão e devolve uma linha curta para `webhook_eventos.resultado` (e o log). */
async function aplicar(env: Env, d: Decisao, devMode: boolean, agora: string, espera: (p: Promise<unknown>) => void): Promise<string> {
  const quem = devMode ? "abacatepay (teste)" : "abacatepay";
  if (d.acao === "ignorar") return `ignorado: ${d.motivo}`;
  const ck = await checkoutPor(env, d.ref);
  if (d.acao === "revisar") {
    // Vira um pedido aberto para o admin (aparece em console › Suporte): reembolso, disputa ou valor estranho.
    if (ck !== null) await env.DB.prepare("INSERT INTO pedidos (id, conta_id, tipo, detalhe, maquina_id, criado_em) VALUES (?1, ?2, 'pagamento.revisar', ?3, NULL, ?4)").bind(uuid(), ck.conta_id, d.motivo.slice(0, 200), agora).run();
    await auditar(env.DB, quem, "pagamento.revisar", ck?.conta_id ?? null, d.motivo);
    console.log(`[pagamento] revisar: ${d.motivo} (ref ${d.ref ?? "-"})`);
    return `revisar: ${d.motivo}`;
  }
  if (ck === null) { await auditar(env.DB, quem, "pagamento.sem-conta", null, `${d.acao} ref ${d.ref ?? "-"}`); return `sem conta para ref ${d.ref ?? "-"}`; }
  if (d.acao === "falhou") { await auditar(env.DB, quem, "assinatura.falhou", ck.conta_id, d.assinaturaId); return "cobrança falhou"; }
  if (d.acao === "cancelada") {
    // O Pro continua até o fim do ciclo já pago (expires_at); só a assinatura muda.
    await env.DB.prepare("UPDATE assinaturas SET status = 'CANCELLED', atualizada_em = ?1 WHERE id = ?2").bind(agora, d.assinaturaId).run();
    await auditar(env.DB, quem, "assinatura.cancelada", ck.conta_id, d.assinaturaId);
    return "assinatura cancelada";
  }
  // liberar: uma vez por pagamento.
  const pg = await env.DB.prepare("INSERT OR IGNORE INTO pagamentos (id, conta_id, assinatura_id, valor_centavos, evento, pago_em, ga_enviado_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)")
    .bind(d.pagamentoId, ck.conta_id, d.assinaturaId, d.valor, d.primeira ? "subscription.completed" : "subscription.renewed", agora).run();
  if ((pg.meta.changes ?? 0) === 0) return "pagamento já processado";
  const conta = await contaPorId(env.DB, ck.conta_id);
  if (conta === null) { await auditar(env.DB, quem, "pagamento.sem-conta", ck.conta_id, d.pagamentoId); return "conta apagada"; }
  const atual = await licencaDaConta(env.DB, conta);
  const ate = validoAte(agora, atual.plan === "pro" && atual.status === "active" ? atual.expiresAt : null);
  await env.DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, trial_end, expires_at, device_limit, produtos, pagamento, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, ?3, ?4, ?5, ?6, NULL, ?7, 'system') ON CONFLICT(conta_id) DO UPDATE SET plan = 'pro', status = 'active', interval = 'month', expires_at = excluded.expires_at, pagamento = NULL, updated_at = excluded.updated_at, updated_by = 'system'")
    .bind(conta.id, atual.memberSince, atual.trialEnd, ate, atual.deviceLimit, JSON.stringify(atual.produtos), agora).run();
  await env.DB.prepare("INSERT INTO assinaturas (id, conta_id, ref, status, metodo, valor_centavos, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 'ACTIVE', NULL, ?4, ?5, ?5) ON CONFLICT(id) DO UPDATE SET status = 'ACTIVE', atualizada_em = excluded.atualizada_em")
    .bind(d.assinaturaId, conta.id, ck.ref, d.valor, agora).run();
  await auditar(env.DB, quem, d.primeira ? "assinatura.paga" : "assinatura.renovada", conta.id, `${d.pagamentoId} · ${d.valor} centavos · até ${ate}`);
  espera(enviarCompraGa(env, ck, d.pagamentoId, d.valor, d.primeira));
  return `Pro liberado até ${ate}`;
}

/** A compra no GA4 pelo Measurement Protocol, no mesmo client_id/session_id do console (a campanha do anúncio vem junto). */
async function enviarCompraGa(env: Env, ck: CheckoutLinha, pagamentoId: string, valor: number, primeira: boolean): Promise<void> {
  const id = gaIds(env.GA_ID)[0];
  if (id === undefined || !env.GA_MP_SECRET || ck.ga_client_id === null) { console.log(`[pagamento] compra ${pagamentoId} fora do GA4: ${id === undefined ? "sem GA_ID" : !env.GA_MP_SECRET ? "sem GA_MP_SECRET" : "checkout sem client_id"}`); return; }
  const body = compraGa4({ clientId: ck.ga_client_id, sessionId: ck.ga_session_id, pagamentoId, valorCentavos: valor, primeira, ambiente: env.CANAL === "staging" ? "staging" : "producao" });
  try {
    const r = await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(env.GA_MP_SECRET)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) await env.DB.prepare("UPDATE pagamentos SET ga_enviado_em = ?1 WHERE id = ?2").bind(agoraIso(), pagamentoId).run();
    else console.log(`[pagamento] GA4 recusou a compra ${pagamentoId}: HTTP ${r.status}`);
  } catch (e) { console.log(`[pagamento] GA4 fora: ${e instanceof Error ? e.message : String(e)}`); }
}
