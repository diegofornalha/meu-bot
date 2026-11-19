/**
 * Assinatura do Pro e dos add-ons (apps vendidos à parte, ABACATEPAY_ADDONS) pela AbacatePay:
 * - `POST /conta/assinatura` (logado): cria o checkout de assinatura e devolve a `url` da página de pagamento; com
 *   `{produto: "meu-bot-finance"}` no corpo o checkout é do add-on, sem ele é do Pro; conta com direito à promoção do
 *   primeiro mês (PROMO_CUPOM, direitoPromo) recebe o checkout do Pro só no cartão e com o cupom, a não ser que peça
 *   `{semPromo: true}` (quem prefere o Pix: preço cheio, métodos normais, sem cupom); com `{produto: "extra-maquina"}`
 *   o checkout é de UMA máquina extra (ABACATEPAY_EXTRAS): exige o Pro valendo e pode ser pedido mais de uma vez;
 * - `POST /conta/assinatura/cancelar` (logado, `{id: "subs_…"}`): cancela na AbacatePay a assinatura da própria conta;
 *   o acesso continua até o fim do período já pago;
 * - `DELETE /admin/vendas/assinaturas/:id` (super admin): cancela a cobrança na AbacatePay e apaga a assinatura daqui
 *   (sai da tela Assinaturas e da receita); os pagamentos dela ficam gravados, ocultos;
 * - `POST /pagamentos/abacatepay` (webhook, sem login): confere secret e assinatura, grava o evento uma vez só, libera o
 *   Pro na cobrança paga e manda a compra ao GA4 (Measurement Protocol) com o client_id guardado no checkout.
 * Liga só com ABACATEPAY_KEY, ABACATEPAY_WEBHOOK_SECRET e ABACATEPAY_PRODUTO; sem eles, as duas rotas respondem 503.
 */
import type { Env } from "../tipos.js";
import { addonsPagos, auditar, contaPorId, contarLimite, jaPagouPro, licencaDaConta, licencaGravada, limiteDeMaquinas, papelAdmin, promoDaConta, removerAssinatura } from "../db.js";
import { agoraIso, janelaMinuto, uuid } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";
import { gaIds } from "../analytics-core.js";
import { assinaturaIdValido, clientIdDeReserva, clientIdValido, compraGa4, decidir, lerAddons, lerEvento, lerExtras, lerPromo, metodosSemPix, pedidoDoCheckout, precoDaCobranca, refValida, resultadoCancelamento, sessionIdValido, validoAte, webhookConfere, tipoDoExtra, type Decisao, type OfertaAddon, type OfertaExtra, type Promo } from "../pagamento-core.js";
import { MAQUINA_LIMITE_MAX } from "../licenca-core.js";

const API = "https://api.abacatepay.com/v2";
export const pagamentosLigados = (env: Env): boolean => Boolean(env.ABACATEPAY_KEY && env.ABACATEPAY_WEBHOOK_SECRET && env.ABACATEPAY_PRODUTO);
const preco = (env: Env): number => { const n = Number(env.ABACATEPAY_PRECO_CENTAVOS ?? "9700"); return Number.isInteger(n) && n > 0 ? n : 9700; };
/** Os add-ons à venda neste ambiente; vazio com os pagamentos desligados. */
export const addonsAVenda = (env: Env): OfertaAddon[] => (pagamentosLigados(env) ? lerAddons(env.ABACATEPAY_ADDONS) : []);
/** As unidades extras à venda neste ambiente (máquina extra); vazio com os pagamentos desligados ou sem ABACATEPAY_EXTRAS. */
export const extrasAVenda = (env: Env): OfertaExtra[] => (pagamentosLigados(env) ? lerExtras(env.ABACATEPAY_EXTRAS) : []);
/** A promoção do primeiro mês do Pro neste ambiente; null sem cupom (PROMO_CUPOM vazio) ou com os pagamentos desligados. */
export const promoLigada = (env: Env): Promo | null => (pagamentosLigados(env) ? lerPromo(env.PROMO_CUPOM, env.PROMO_PRECO_CENTAVOS, env.PROMO_DIAS, preco(env)) : null);
const metodos = (env: Env): string[] => { const m = (env.ABACATEPAY_METODOS ?? "CARD").split(",").map((x) => x.trim().toUpperCase()).filter((x) => x === "CARD" || x === "PIX"); return m.length > 0 ? m : ["CARD"]; };

/** Quantos checkouts por conta por minuto (cada clique em "Assinar" cria um). */
const LIMITE_POR_MIN = 5;

export async function postAssinatura(auth: Autenticado, env: Env, req: Request): Promise<Response> {
  if (!pagamentosLigados(env)) return json({ erro: "a assinatura pelo site ainda não está ligada; fale com o suporte" }, 503);
  if (await contarLimite(env.DB, `assinar:${auth.conta.id}`, janelaMinuto()) > LIMITE_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const corpo = (await lerJson(req)) as Record<string, unknown> | null;
  // Sem `produto` é o Pro; com ele, um add-on ou uma unidade extra (máquina extra) do catálogo deste ambiente.
  const pedido = corpo?.produto;
  const extra = extrasAVenda(env).find((x) => x.nome === pedido) ?? null;
  const addon = extra !== null || pedido === undefined || pedido === null ? null : addonsAVenda(env).find((a) => a.nome === pedido) ?? undefined;
  if (addon === undefined) return json({ erro: "este produto não está à venda aqui" }, 400);
  // O que vai no checkout além do Pro: o add-on ou o extra (null = Pro).
  const item = extra ?? addon;
  const agoraMs = Date.now();
  // O papel só pesa no Pro e na máquina extra, que vale junto com ele (add-on o super admin assina como qualquer
  // conta); lido da tabela, não do token de 1 h.
  const papel = addon === null ? await papelAdmin(env.DB, auth.conta.email, env.ADMIN_BOOTSTRAP_EMAIL) : null;
  if (extra !== null) {
    // Máquina extra só serve a quem tem o Pro valendo (a licença que a máquina recebe é a do Pro). Não há "já tem":
    // cada assinatura é uma máquina a mais, até o teto.
    const l = await licencaDaConta(env.DB, auth.conta, papel);
    const valendo = l.plan === "pro" && (l.status === "active" || l.status === "trialing") && (l.expiresAt === null || Date.parse(l.expiresAt) > agoraMs);
    if (!valendo) return json({ erro: "a máquina extra vale junto com o Pro; assine o Pro primeiro" }, 409);
    if (await limiteDeMaquinas(env.DB, auth.conta.id, agoraMs) >= MAQUINA_LIMITE_MAX) return json({ erro: `a conta já está no máximo de ${MAQUINA_LIMITE_MAX} máquinas; fale com o suporte` }, 409);
  } else if (addon === null) {
    if (papel === "super") return json({ erro: "sua conta de super admin já tem o Pro sem prazo" }, 409);
    const l = await licencaDaConta(env.DB, auth.conta, papel);
    const ativa = await env.DB.prepare("SELECT id FROM assinaturas WHERE conta_id = ?1 AND status = 'ACTIVE' AND produto IS NULL LIMIT 1").bind(auth.conta.id).first<{ id: string }>();
    if (ativa !== null && l.plan === "pro" && l.status === "active") return json({ erro: "você já tem uma assinatura ativa" }, 409);
  } else {
    const ativa = await env.DB.prepare("SELECT id FROM assinaturas WHERE conta_id = ?1 AND status = 'ACTIVE' AND produto = ?2 LIMIT 1").bind(auth.conta.id, addon.nome).first<{ id: string }>();
    const emDia = (await addonsPagos(env.DB, auth.conta.id)).some((p) => p.produto === addon.nome && Date.parse(p.expiresAt) > agoraMs);
    if (ativa !== null && emDia) return json({ erro: `você já tem uma assinatura ativa do ${addon.rotulo}` }, 409);
  }
  // Promoção do primeiro mês: só o Pro, nunca um add-on. Quem decide o direito é este servidor (a AbacatePay não
  // limita cupom por cliente). Se a tela mostrou a promoção (`promo: true`) e o direito acabou nesse meio-tempo, o
  // checkout não abre pelo preço cheio sem a pessoa saber.
  // `semPromo: true`: a pessoa abriu mão do desconto para pagar por Pix (o cupom só vale no cartão). O checkout sai sem
  // a marca da promoção, então o webhook exige o preço cheio.
  const promo = item === null && corpo?.semPromo !== true ? await promoDaConta(env.DB, auth.conta, promoLigada(env), papel, agoraMs) : null;
  if (item === null && corpo?.promo === true && promo === null) return json({ erro: "o primeiro mês com desconto não vale mais para esta conta; o Pro sai pelo preço normal. Toque em Assinar de novo para continuar", promoAcabou: true }, 409);
  const ref = `mb_${uuid()}`;
  const agora = agoraIso();
  await env.DB.prepare("INSERT INTO pagamento_checkouts (ref, conta_id, checkout_id, ga_client_id, ga_session_id, criado_em, produto, promo) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7)")
    .bind(ref, auth.conta.id, clientIdValido(corpo?.gaClientId), sessionIdValido(corpo?.gaSessionId), agora, item?.nome ?? null, promo === null ? 0 : 1).run();
  const envio = pedidoDoCheckout(promo, metodos(env));
  // Uma tentativa por lista de métodos: com Pix pedido e o Pix Automático ainda não liberado na loja, a AbacatePay
  // recusa a assinatura inteira; aí vale tentar de novo só com cartão, em vez de deixar o "Assinar" quebrado.
  const criar = (methods: string[]): Promise<Response> => fetch(`${API}/subscriptions/create`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.ABACATEPAY_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      items: [{ id: item?.produto ?? env.ABACATEPAY_PRODUTO, quantity: 1 }],
      methods,
      externalId: ref,
      completionUrl: `${env.CONSOLE_ORIGIN}/account/plan?assinatura=paga${item === null ? "" : `&produto=${item.nome}`}`,
      returnUrl: `${env.CONSOLE_ORIGIN}/account/plan`,
      metadata: { conta: auth.conta.id, produto: item?.nome ?? "pro" },
      // Com a promoção: o cupom (o desconto vale na primeira cobrança; as renovações cobram o preço cheio).
      ...(envio.coupons === undefined ? {} : { coupons: envio.coupons }),
    }),
  });
  type Resposta = { data?: { id?: unknown; url?: unknown }; error?: unknown } | null;
  let r: Response; let resp: Resposta;
  try {
    // Com a promoção, só cartão e uma tentativa só (pedidoDoCheckout).
    r = await criar(envio.methods);
    resp = (await r.json().catch(() => null)) as Resposta;
    const semPix = envio.tentarSemPix ? metodosSemPix(envio.methods, r.ok, resp?.error) : null;
    if (semPix !== null) {
      console.log("[pagamento] Pix Automático não liberado na loja: assinatura criada só com cartão");
      r = await criar(semPix);
      resp = (await r.json().catch(() => null)) as Resposta;
    }
  } catch (e) { console.log(`[pagamento] AbacatePay fora: ${e instanceof Error ? e.message : String(e)}`); return json({ erro: "o pagamento não respondeu; tente de novo" }, 502); }
  const url = typeof resp?.data?.url === "string" && /^https:\/\/([a-z0-9-]+\.)*abacatepay\.com\//.test(resp.data.url) ? resp.data.url : null;
  const bill = typeof resp?.data?.id === "string" && resp.data.id.length <= 100 ? resp.data.id : null;
  if (!r.ok || url === null) {
    console.log(`[pagamento] criar assinatura${promo === null ? "" : " com o cupom da promoção"} recusado: HTTP ${r.status} ${JSON.stringify(resp?.error ?? null).slice(0, 200)}`);
    // Com a promoção, a recusa não vira um checkout pelo preço cheio: a pessoa veio pelo primeiro mês com desconto.
    return json({ erro: promo === null ? "não deu para abrir o pagamento agora; tente de novo" : "a promoção não pôde ser aplicada agora; tente de novo ou fale com a gente" }, 502);
  }
  await env.DB.prepare("UPDATE pagamento_checkouts SET checkout_id = ?1 WHERE ref = ?2").bind(bill, ref).run();
  await auditar(env.DB, auth.conta.email, "assinatura.checkout", auth.conta.id, item === null ? `${bill ?? "-"}${promo === null ? "" : " · promoção do primeiro mês"}` : `${item.nome} · ${bill ?? "-"}`);
  return json({ url, promo: promo !== null });
}

/**
 * Pede à AbacatePay que pare de cobrar a assinatura `id` e lê a resposta (`resultadoCancelamento`); `fora` quando ela
 * não respondeu. Só `cancelada` e `ja-cancelada` garantem que não há mais cobrança.
 */
export async function cancelarNaAbacate(env: Env, id: string): Promise<ReturnType<typeof resultadoCancelamento> | "fora"> {
  let r: Response; let resp: unknown;
  try {
    r = await fetch(`${API}/subscriptions/cancel`, { method: "POST", headers: { authorization: `Bearer ${env.ABACATEPAY_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ id }) });
    resp = await r.json().catch(() => null);
  } catch (e) { console.log(`[pagamento] AbacatePay fora (cancelar): ${e instanceof Error ? e.message : String(e)}`); return "fora"; }
  const res = resultadoCancelamento(r.status, resp);
  if (res === "sem-permissao") console.log(`[pagamento] cancelar recusado: HTTP ${r.status} (a chave precisa do escopo SUBSCRIPTION:DELETE)`);
  if (res === "erro") console.log(`[pagamento] cancelar recusado: HTTP ${r.status} ${JSON.stringify((resp as { error?: unknown } | null)?.error ?? null).slice(0, 200)}`);
  return res;
}

/**
 * O super admin remove uma assinatura (console › Assinaturas › Remover): a cobrança para na AbacatePay e a linha é
 * apagada daqui, então sai da lista e da receita mensal de vez. Serve para compra de teste e para venda desfeita por
 * fora (reembolso combinado direto com a pessoa). Sem a confirmação de que a AbacatePay não cobra mais, nada é apagado.
 * Os pagamentos dela não são apagados, só ocultos (`removerAssinatura`). O acesso já pago (licença, add-on, máquina
 * extra) não muda aqui: quem tira é o admin, pelas ações de sempre.
 */
export async function deleteAdminAssinatura(auth: Autenticado, env: Env, id: string): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só o super admin" }, 403);
  if (!assinaturaIdValido(id)) return json({ erro: "assinatura inválida" }, 400);
  const linha = await env.DB.prepare("SELECT conta_id, produto, status, valor_centavos FROM assinaturas WHERE id = ?1").bind(id).first<{ conta_id: string; produto: string | null; status: string; valor_centavos: number | null }>();
  if (linha === null) return json({ erro: "essa assinatura não existe (ou já foi removida)" }, 404);
  let cobranca = "já estava cancelada aqui";
  if (linha.status !== "CANCELLED") {
    if (!pagamentosLigados(env)) return json({ erro: "este ambiente está sem a chave da AbacatePay: não dá para cancelar a cobrança, então nada foi removido" }, 503);
    const res = await cancelarNaAbacate(env, id);
    if (res === "fora") return json({ erro: "a AbacatePay não respondeu; nada foi removido, tente de novo" }, 502);
    if (res === "sem-permissao") return json({ erro: "a chave da AbacatePay não pode cancelar (falta o escopo SUBSCRIPTION:DELETE); nada foi removido" }, 502);
    if (res === "erro") return json({ erro: "a AbacatePay não cancelou a cobrança; nada foi removido, tente de novo" }, 502);
    cobranca = res === "cancelada" ? "cancelada na AbacatePay" : "a AbacatePay já não cobrava";
  }
  const pagamentos = await removerAssinatura(env.DB, id, auth.conta.email);
  if (pagamentos === null) return json({ erro: "essa assinatura não existe (ou já foi removida)" }, 404);
  await auditar(env.DB, auth.conta.email, "assinatura.removida", linha.conta_id, `${id} · ${linha.produto ?? "Pro"} · ${linha.valor_centavos ?? 0} centavos/mês · ${cobranca} · ${pagamentos} pagamento(s) oculto(s)`);
  return json({ ok: true, pagamentosOcultos: pagamentos });
}

/**
 * Cancelar pela própria pessoa (console › Suas assinaturas). Só a assinatura ACTIVE desta conta; a AbacatePay para de
 * cobrar e aqui só a assinatura muda: o Pro (ou o add-on) continua até o `expires_at` já pago, como no webhook
 * `subscription.cancelled`, que pode chegar depois e não muda mais nada.
 */
export async function postCancelarAssinatura(auth: Autenticado, env: Env, req: Request): Promise<Response> {
  if (!pagamentosLigados(env)) return json({ erro: "a assinatura pelo site ainda não está ligada; fale com o suporte" }, 503);
  if (await contarLimite(env.DB, `cancelar:${auth.conta.id}`, janelaMinuto()) > LIMITE_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const corpo = (await lerJson(req)) as Record<string, unknown> | null;
  const id = corpo?.id;
  if (!assinaturaIdValido(id)) return json({ erro: "assinatura inválida" }, 400);
  const linha = await env.DB.prepare("SELECT id, produto FROM assinaturas WHERE id = ?1 AND conta_id = ?2 AND status = 'ACTIVE'").bind(id, auth.conta.id).first<{ id: string; produto: string | null }>();
  if (linha === null) return json({ erro: "não achei essa assinatura ativa na sua conta" }, 404);
  const res = await cancelarNaAbacate(env, id);
  if (res === "fora") return json({ erro: "o pagamento não respondeu; tente de novo" }, 502);
  if (res === "sem-permissao") return json({ erro: "o cancelamento por aqui ainda não está ligado; fale com o suporte, que cancela para você" }, 502);
  if (res === "erro") return json({ erro: "não deu para cancelar agora; tente de novo" }, 502);
  const mudou = await env.DB.prepare("UPDATE assinaturas SET status = 'CANCELLED', atualizada_em = ?1 WHERE id = ?2 AND conta_id = ?3 AND status = 'ACTIVE'").bind(agoraIso(), id, auth.conta.id).run();
  if ((mudou.meta.changes ?? 0) > 0) await auditar(env.DB, auth.conta.email, "assinatura.cancelada", auth.conta.id, `${id} · ${linha.produto ?? "Pro"} · pelo console${res === "ja-cancelada" ? " (já estava cancelada na AbacatePay)" : ""}`);
  return json({ ok: true });
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
  // O preço exigido é o do produto do checkout: o do Pro, ou o do add-on. Add-on que saiu do catálogo não libera
  // sozinho (preço impossível de atingir): vai para a revisão do admin.
  const refEv = e.checkout?.ref ?? null;
  const doEvento = refValida(refEv) ? await checkoutPor(env, refEv) : null;
  // Checkout criado com a promoção: a PRIMEIRA cobrança exige o preço da promoção, se a conta nunca pagou o Pro; as
  // renovações e todo o resto, o preço cheio (precoDaCobranca). A consulta de "já pagou" só roda nesse caso.
  const daPromo = doEvento !== null && doEvento.promo === 1 && doEvento.produto === null && e.evento === "subscription.completed";
  const pagouAntes = daPromo ? await jaPagouPro(env.DB, doEvento.conta_id, { pagamentoId: e.pagamento?.id ?? "", assinaturaId: e.assinatura?.id ?? "" }) : false;
  const exigido = precoDaCobranca({ evento: e.evento, checkout: doEvento === null ? null : { produto: doEvento.produto, promo: doEvento.promo === 1 }, precoPro: preco(env), addons: lerAddons(env.ABACATEPAY_ADDONS), extras: lerExtras(env.ABACATEPAY_EXTRAS), promoCentavos: promoLigada(env)?.precoCentavos ?? null, jaPagouPro: pagouAntes });
  const d = decidir(e, env.CANAL === "staging" ? "staging" : "producao", exigido);
  // Se aplicar falhar no meio, o registro do evento sai: assim a nova tentativa da AbacatePay é processada, em vez
  // de cair em "repetido" e o pagamento nunca ser aplicado.
  let resultado: string;
  try { resultado = await aplicar(env, d, e.devMode, agora, espera); }
  catch (erro) {
    console.log(`[pagamento] evento ${e.id} falhou ao aplicar: ${erro instanceof Error ? erro.message : String(erro)}`);
    // Se o próprio banco é a causa, este DELETE também pode falhar: o log acima já saiu e o registro fica para o admin ver.
    await env.DB.prepare("DELETE FROM webhook_eventos WHERE id = ?1 AND resultado IS NULL").bind(e.id).run()
      .catch((e2: unknown) => { console.log(`[pagamento] evento ${e.id} ficou marcado como recebido sem ser aplicado: ${e2 instanceof Error ? e2.message : String(e2)}`); });
    return json({ erro: "falha ao aplicar o evento; tente de novo" }, 500);
  }
  await env.DB.prepare("UPDATE webhook_eventos SET resultado = ?1 WHERE id = ?2").bind(resultado.slice(0, 300), e.id).run();
  return json({ ok: true });
}

interface CheckoutLinha { ref: string; conta_id: string; ga_client_id: string | null; ga_session_id: string | null; produto: string | null; /** 1 = criado com o cupom da promoção do primeiro mês. */ promo: number }
const checkoutPor = (env: Env, ref: string | null): Promise<CheckoutLinha | null> =>
  ref === null ? Promise.resolve(null) : env.DB.prepare("SELECT ref, conta_id, ga_client_id, ga_session_id, produto, promo FROM pagamento_checkouts WHERE ref = ?1").bind(ref).first<CheckoutLinha>();

/** Executa a decisão e devolve uma linha curta para `webhook_eventos.resultado` (e o log). */
async function aplicar(env: Env, d: Decisao, devMode: boolean, agora: string, espera: (p: Promise<unknown>) => void): Promise<string> {
  const quem = devMode ? "abacatepay (teste)" : "abacatepay";
  if (d.acao === "ignorar") return `ignorado: ${d.motivo}`;
  const ck = await checkoutPor(env, d.ref);
  if (d.acao === "revisar") {
    // Vira um pedido aberto para o admin (aparece em console › Suporte): reembolso, disputa ou valor estranho.
    if (ck !== null) await env.DB.prepare("INSERT INTO pedidos (id, conta_id, tipo, detalhe, maquina_id, criado_em) VALUES (?1, ?2, 'pagamento.revisar', ?3, NULL, ?4)").bind(uuid(), ck.conta_id, `${d.motivo} · ${ck.produto ?? "Pro"}`.slice(0, 200), agora).run();
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
  const pg = await env.DB.prepare("INSERT OR IGNORE INTO pagamentos (id, conta_id, assinatura_id, valor_centavos, evento, pago_em, ga_enviado_em, produto) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)")
    .bind(d.pagamentoId, ck.conta_id, d.assinaturaId, d.valor, d.primeira ? "subscription.completed" : "subscription.renewed", agora, ck.produto).run();
  if ((pg.meta.changes ?? 0) === 0) return "pagamento já processado";
  const conta = await contaPorId(env.DB, ck.conta_id);
  if (conta === null) { await auditar(env.DB, quem, "pagamento.sem-conta", ck.conta_id, d.pagamentoId); return "conta apagada"; }
  // A primeira cobrança avisa o admin (console › Suporte); o pedido fecha sozinho se a pessoa aplicar a licença na
  // máquina pelo app (rotas/maquinas.ts). A máquina extra não avisa: ela só abre uma vaga, que a própria conta usa, e
  // não há o que o admin liberar.
  if (d.primeira && tipoDoExtra(ck.produto) === null) await env.DB.prepare("INSERT INTO pedidos (id, conta_id, tipo, detalhe, maquina_id, criado_em) VALUES (?1, ?2, 'pagamento.liberar', ?3, NULL, ?4)").bind(uuid(), ck.conta_id, `liberar na máquina: ${ck.produto ?? "Pro"}`, agora).run();
  if (ck.produto !== null) return tipoDoExtra(ck.produto) !== null ? liberarExtra(env, ck, ck.produto, d, quem, agora, espera) : liberarAddon(env, ck, ck.produto, d, quem, agora, espera);
  // Base gravada, não a em vigor: os add-ons pagos têm tabela própria e não entram em licencas.produtos.
  const atual = await licencaGravada(env.DB, conta);
  const ate = validoAte(agora, atual.plan === "pro" && atual.status === "active" ? atual.expiresAt : null);
  await env.DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, trial_end, expires_at, device_limit, produtos, pagamento, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, ?3, ?4, ?5, ?6, NULL, ?7, 'system') ON CONFLICT(conta_id) DO UPDATE SET plan = 'pro', status = 'active', interval = 'month', expires_at = excluded.expires_at, pagamento = NULL, updated_at = excluded.updated_at, updated_by = 'system'")
    .bind(conta.id, atual.memberSince, atual.trialEnd, ate, atual.deviceLimit, JSON.stringify(atual.produtos), agora).run();
  // `assinaturas.valor_centavos` é o valor do mês (a tela "Suas assinaturas" e a receita mensal do admin leem dali): na
  // promoção, a primeira cobrança sai com desconto mas a assinatura vale o preço cheio. O que entrou de fato está em `pagamentos`.
  const comDesconto = ck.promo === 1 && d.primeira && d.valor < preco(env);
  await env.DB.prepare("INSERT INTO assinaturas (id, conta_id, ref, status, metodo, valor_centavos, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 'ACTIVE', ?6, ?4, ?5, ?5) ON CONFLICT(id) DO UPDATE SET status = 'ACTIVE', metodo = COALESCE(excluded.metodo, assinaturas.metodo), atualizada_em = excluded.atualizada_em")
    .bind(d.assinaturaId, conta.id, ck.ref, comDesconto ? preco(env) : d.valor, agora, d.metodo).run();
  await auditar(env.DB, quem, d.primeira ? "assinatura.paga" : "assinatura.renovada", conta.id, `${d.pagamentoId} · ${d.valor} centavos${comDesconto ? " (promoção do primeiro mês)" : ""} · até ${ate}`);
  espera(enviarCompraGa(env, ck, d.pagamentoId, d.valor, d.primeira));
  return `Pro liberado até ${ate}`;
}

/** Cobrança paga de um add-on: renova o prazo dele (um mês mais a folga) sem tocar no plano da conta. */
async function liberarAddon(env: Env, ck: CheckoutLinha, produto: string, d: Extract<Decisao, { acao: "liberar" }>, quem: string, agora: string, espera: (p: Promise<unknown>) => void): Promise<string> {
  // Add-on que o admin encerrou (reembolso ou disputa): a renovação da assinatura antiga não o devolve sozinha. Vira
  // pedido de revisão; quem decide religar é o admin, e a assinatura precisa ser cancelada na AbacatePay. Uma compra
  // nova (primeira cobrança de outra assinatura) é pagamento legítimo: libera e limpa a marca.
  const encerrado = await env.DB.prepare("SELECT encerrado_em FROM addons_pagos WHERE conta_id = ?1 AND produto = ?2").bind(ck.conta_id, produto).first<{ encerrado_em: string | null }>();
  if (encerrado !== null && encerrado.encerrado_em !== null && !d.primeira) {
    const motivo = `cobrança de ${produto} encerrado pelo admin em ${encerrado.encerrado_em.slice(0, 10)}: ${d.valor} centavos`;
    await env.DB.prepare("INSERT INTO pedidos (id, conta_id, tipo, detalhe, maquina_id, criado_em) VALUES (?1, ?2, 'pagamento.revisar', ?3, NULL, ?4)").bind(uuid(), ck.conta_id, motivo.slice(0, 200), agora).run();
    await auditar(env.DB, quem, "pagamento.revisar", ck.conta_id, motivo);
    return `revisar: ${motivo}`;
  }
  const atual = (await addonsPagos(env.DB, ck.conta_id)).find((p) => p.produto === produto) ?? null;
  const ate = validoAte(agora, atual !== null && Date.parse(atual.expiresAt) > Date.parse(agora) ? atual.expiresAt : null);
  await env.DB.prepare("INSERT INTO addons_pagos (conta_id, produto, assinatura_id, expires_at, atualizado_em) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(conta_id, produto) DO UPDATE SET assinatura_id = excluded.assinatura_id, expires_at = excluded.expires_at, atualizado_em = excluded.atualizado_em, encerrado_em = NULL")
    .bind(ck.conta_id, produto, d.assinaturaId, ate, agora).run();
  await env.DB.prepare("INSERT INTO assinaturas (id, conta_id, ref, status, metodo, valor_centavos, criada_em, atualizada_em, produto) VALUES (?1, ?2, ?3, 'ACTIVE', ?7, ?4, ?5, ?5, ?6) ON CONFLICT(id) DO UPDATE SET status = 'ACTIVE', metodo = COALESCE(excluded.metodo, assinaturas.metodo), atualizada_em = excluded.atualizada_em")
    .bind(d.assinaturaId, ck.conta_id, ck.ref, d.valor, agora, produto, d.metodo).run();
  await auditar(env.DB, quem, d.primeira ? "addon.pago" : "addon.renovado", ck.conta_id, `${produto} · ${d.pagamentoId} · ${d.valor} centavos · até ${ate}`);
  const rotulo = lerAddons(env.ABACATEPAY_ADDONS).find((a) => a.nome === produto)?.rotulo ?? produto;
  espera(enviarCompraGa(env, ck, d.pagamentoId, d.valor, d.primeira, { id: `${produto}-mensal`, nome: `${rotulo} mensal` }));
  return `${produto} liberado até ${ate}`;
}

/**
 * Cobrança paga de uma unidade extra (máquina extra): a assinatura vira, ou renova, UMA linha de extras_pagos, que soma
 * 1 ao limite da conta enquanto vale (limiteComExtras). Não toca no plano nem em licencas.maquina_limit, que é do admin.
 */
async function liberarExtra(env: Env, ck: CheckoutLinha, produto: string, d: Extract<Decisao, { acao: "liberar" }>, quem: string, agora: string, espera: (p: Promise<unknown>) => void): Promise<string> {
  const tipo = tipoDoExtra(produto);
  if (tipo === null) return `ignorado: ${produto} não é um extra`;
  const atual = await env.DB.prepare("SELECT expires_at, encerrado_em FROM extras_pagos WHERE assinatura_id = ?1").bind(d.assinaturaId).first<{ expires_at: string; encerrado_em: string | null }>();
  // Extra encerrado pelo admin (reembolso ou disputa): a renovação não o devolve sozinha, como nos add-ons.
  if (atual !== null && atual.encerrado_em !== null) {
    const motivo = `cobrança de ${produto} encerrado pelo admin em ${atual.encerrado_em.slice(0, 10)}: ${d.valor} centavos`;
    await env.DB.prepare("INSERT INTO pedidos (id, conta_id, tipo, detalhe, maquina_id, criado_em) VALUES (?1, ?2, 'pagamento.revisar', ?3, NULL, ?4)").bind(uuid(), ck.conta_id, motivo.slice(0, 200), agora).run();
    await auditar(env.DB, quem, "pagamento.revisar", ck.conta_id, motivo);
    return `revisar: ${motivo}`;
  }
  const ate = validoAte(agora, atual !== null && Date.parse(atual.expires_at) > Date.parse(agora) ? atual.expires_at : null);
  await env.DB.prepare("INSERT INTO extras_pagos (assinatura_id, conta_id, tipo, expires_at, atualizado_em) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(assinatura_id) DO UPDATE SET expires_at = excluded.expires_at, atualizado_em = excluded.atualizado_em")
    .bind(d.assinaturaId, ck.conta_id, tipo, ate, agora).run();
  await env.DB.prepare("INSERT INTO assinaturas (id, conta_id, ref, status, metodo, valor_centavos, criada_em, atualizada_em, produto) VALUES (?1, ?2, ?3, 'ACTIVE', ?7, ?4, ?5, ?5, ?6) ON CONFLICT(id) DO UPDATE SET status = 'ACTIVE', metodo = COALESCE(excluded.metodo, assinaturas.metodo), atualizada_em = excluded.atualizada_em")
    .bind(d.assinaturaId, ck.conta_id, ck.ref, d.valor, agora, produto, d.metodo).run();
  await auditar(env.DB, quem, d.primeira ? "extra.pago" : "extra.renovado", ck.conta_id, `${produto} · ${d.assinaturaId} · ${d.pagamentoId} · ${d.valor} centavos · até ${ate}`);
  const rotulo = lerExtras(env.ABACATEPAY_EXTRAS).find((x) => x.nome === produto)?.rotulo ?? produto;
  espera(enviarCompraGa(env, ck, d.pagamentoId, d.valor, d.primeira, { id: `${produto}-mensal`, nome: `${rotulo} mensal` }));
  return `${produto} liberado até ${ate}`;
}

/** A compra no GA4 pelo Measurement Protocol, no mesmo client_id/session_id do console (a campanha do anúncio vem junto); sem eles, com um id de reserva. */
async function enviarCompraGa(env: Env, ck: CheckoutLinha, pagamentoId: string, valor: number, primeira: boolean, item?: { id: string; nome: string }): Promise<void> {
  const id = gaIds(env.GA_ID)[0];
  if (id === undefined || !env.GA_MP_SECRET) { console.log(`[pagamento] compra ${pagamentoId} fora do GA4: ${id === undefined ? "sem GA_ID" : "sem GA_MP_SECRET"}`); return; }
  // Checkout sem client_id (o navegador de quem pagou não carregou o Analytics): a compra vai com um id de reserva, sem campanha.
  const clientId = ck.ga_client_id ?? clientIdDeReserva(pagamentoId, Date.now());
  if (ck.ga_client_id === null) console.log(`[pagamento] compra ${pagamentoId} vai ao GA4 sem visita (checkout sem client_id)`);
  const body = compraGa4({ clientId, sessionId: ck.ga_client_id === null ? null : ck.ga_session_id, pagamentoId, valorCentavos: valor, primeira, ambiente: env.CANAL === "staging" ? "staging" : "producao", ...(item === undefined ? {} : { item }) });
  try {
    const r = await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(env.GA_MP_SECRET)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) await env.DB.prepare("UPDATE pagamentos SET ga_enviado_em = ?1 WHERE id = ?2").bind(agoraIso(), pagamentoId).run();
    else console.log(`[pagamento] GA4 recusou a compra ${pagamentoId}: HTTP ${r.status}`);
  } catch (e) { console.log(`[pagamento] GA4 fora: ${e instanceof Error ? e.message : String(e)}`); }
}
