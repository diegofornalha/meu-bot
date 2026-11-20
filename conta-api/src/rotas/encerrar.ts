/**
 * O admin encerra agora, com motivo, o que a pessoa paga (ou tem de cortesia), e a cobrança para na AbacatePay:
 * - `POST /admin/contas/:id/pro/encerrar {motivo, detalhe}`: o Pro (pago, gravado pelo admin ou de cortesia);
 * - `POST /admin/contas/:id/addons/:produto/encerrar {motivo, detalhe}`: um add-on pago;
 * - `POST /admin/contas/:id/extras/:assinatura/encerrar {motivo, detalhe}`: uma unidade extra paga (máquina, device ou
 *   usuário de organização).
 * Regra de falha igual à de remover uma venda (`deleteAdminAssinatura`): sem a AbacatePay confirmar que parou de
 * cobrar, nada muda aqui, para nunca tirar o acesso de quem continua sendo cobrado. O reembolso em dinheiro é feito no
 * painel da AbacatePay. Cada encerramento vai para o histórico da conta (`encerramentos`) e para a auditoria.
 */
import type { Env } from "../tipos.js";
import { auditar, contaPorId, cortesiasDaConta, encerrarAddonPago, encerrarCortesia, encerrarExtraPago, licencaGravada, registrarEncerramento } from "../db.js";
import { UUID_RE, agoraIso } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";
import { assinaturaIdValido } from "../pagamento-core.js";
import { cortesiaValida, validaEncerramento, type MotivoEncerramento } from "../cortesia-core.js";
import { cancelarNaAbacate, pagamentosLigados } from "./pagamentos.js";

/** O que a resposta e a tela dizem sobre o dinheiro: o reembolso não sai daqui. */
const REEMBOLSO = "o reembolso, se houver, é feito no painel da AbacatePay";

/**
 * Para a cobrança das assinaturas `ids` na AbacatePay e as marca CANCELLED aqui. Devolve o resumo para o histórico, ou
 * a resposta de erro quando alguma não pôde ser cancelada (as que já foram ficam canceladas; nada mais muda).
 */
async function pararCobrancas(env: Env, ids: readonly string[]): Promise<{ resumo: string } | { erro: Response }> {
  if (ids.length === 0) return { resumo: "sem assinatura ativa" };
  if (!pagamentosLigados(env)) return { erro: json({ erro: "este ambiente está sem a chave da AbacatePay: não dá para parar a cobrança, então nada foi encerrado" }, 503) };
  const partes: string[] = [];
  for (const id of ids) {
    const res = await cancelarNaAbacate(env, id);
    if (res === "fora") return { erro: json({ erro: "a AbacatePay não respondeu; nada foi encerrado, tente de novo" }, 502) };
    if (res === "sem-permissao") return { erro: json({ erro: "a chave da AbacatePay não pode cancelar (falta o escopo SUBSCRIPTION:DELETE); nada foi encerrado" }, 502) };
    if (res === "erro") return { erro: json({ erro: "a AbacatePay não cancelou a cobrança; nada foi encerrado, tente de novo" }, 502) };
    await env.DB.prepare("UPDATE assinaturas SET status = 'CANCELLED', atualizada_em = ?2 WHERE id = ?1").bind(id, agoraIso()).run();
    partes.push(`${id} ${res === "cancelada" ? "cancelada na AbacatePay" : "a AbacatePay já não cobrava"}`);
  }
  return { resumo: partes.join("; ") };
}
const ativas = async (env: Env, sql: string, ...binds: unknown[]): Promise<string[]> => (await env.DB.prepare(sql).bind(...binds).all<{ id: string }>()).results.map((x) => x.id);
const textoMotivo = (e: { motivo: MotivoEncerramento; detalhe: string | null }): string => `${e.motivo}${e.detalhe !== null ? `: ${e.detalhe}` : ""}`;

export async function postEncerrarPro(auth: Autenticado, env: Env, id: string, req: Request): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id)) return json({ erro: "id da conta fora do formato" }, 400);
  const e = validaEncerramento(await lerJson(req));
  if ("erro" in e) return json({ erro: e.erro }, 400);
  const conta = await contaPorId(env.DB, id);
  if (conta === null) return json({ erro: "conta não existe" }, 404);
  const agora = agoraIso(), agoraMs = Date.parse(agora);
  const [l, cs] = await Promise.all([licencaGravada(env.DB, conta), cortesiasDaConta(env.DB, conta.id)]);
  // O Pro da própria conta: o gravado (pago ou pelo admin) valendo, e as cortesias de Pro. Teste grátis não é "plano"
  // a encerrar, e o Pro pela organização se tira removendo a pessoa da organização.
  const gravadoValendo = l.plan === "pro" && l.status === "active" && (l.expiresAt === null || Date.parse(l.expiresAt) > agoraMs);
  const cortesiasPro = cs.filter((c) => c.tipo === "pro" && cortesiaValida(c, agoraMs));
  const assinaturas = await ativas(env, "SELECT id FROM assinaturas WHERE conta_id = ?1 AND produto IS NULL AND status = 'ACTIVE'", conta.id);
  if (!gravadoValendo && cortesiasPro.length === 0 && assinaturas.length === 0) return json({ erro: "esta conta não tem Pro pago nem de cortesia valendo" }, 404);
  const parou = await pararCobrancas(env, assinaturas);
  if ("erro" in parou) return parou.erro;
  if (gravadoValendo) await env.DB.prepare("UPDATE licencas SET status = 'expired', expires_at = ?2, updated_at = ?2, updated_by = 'admin' WHERE conta_id = ?1").bind(conta.id, agora).run();
  for (const c of cortesiasPro) await encerrarCortesia(env.DB, conta.id, c.id, auth.conta.email, textoMotivo(e), agora);
  await registrarEncerramento(env.DB, { contaId: conta.id, alvo: "pro", ref: assinaturas[0] ?? "pro", motivo: e.motivo, detalhe: e.detalhe, cobranca: parou.resumo, por: auth.conta.email }, agora);
  await auditar(env.DB, auth.conta.email, "pro.encerrado", conta.id, `${textoMotivo(e)} · ${parou.resumo}${cortesiasPro.length > 0 ? ` · ${cortesiasPro.length} cortesia(s) encerrada(s)` : ""}`.slice(0, 500));
  return json({ ok: true, cobranca: parou.resumo, aviso: REEMBOLSO });
}

export async function postEncerrarAddon(auth: Autenticado, env: Env, id: string, produto: string, req: Request): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id) || !/^meu-bot-[a-z0-9-]{1,30}$/.test(produto)) return json({ erro: "id da conta ou nome do add-on fora do formato" }, 400);
  const e = validaEncerramento(await lerJson(req));
  if ("erro" in e) return json({ erro: e.erro }, 400);
  const agora = agoraIso();
  const emDia = await env.DB.prepare("SELECT 1 AS x FROM addons_pagos WHERE conta_id = ?1 AND produto = ?2 AND expires_at > ?3").bind(id, produto, agora).first();
  if (emDia === null) return json({ erro: "esta conta não tem esse add-on pago em dia" }, 404);
  const parou = await pararCobrancas(env, await ativas(env, "SELECT id FROM assinaturas WHERE conta_id = ?1 AND produto = ?2 AND status = 'ACTIVE'", id, produto));
  if ("erro" in parou) return parou.erro;
  if (!(await encerrarAddonPago(env.DB, id, produto, agora))) return json({ erro: "esta conta não tem esse add-on pago em dia" }, 404);
  await registrarEncerramento(env.DB, { contaId: id, alvo: "addon", ref: produto, motivo: e.motivo, detalhe: e.detalhe, cobranca: parou.resumo, por: auth.conta.email }, agora);
  await auditar(env.DB, auth.conta.email, "addon.encerrado", id, `${produto} · ${textoMotivo(e)} · ${parou.resumo}`.slice(0, 500));
  return json({ ok: true, cobranca: parou.resumo, aviso: REEMBOLSO });
}

export async function postEncerrarExtra(auth: Autenticado, env: Env, id: string, assinatura: string, req: Request): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id) || !assinaturaIdValido(assinatura)) return json({ erro: "id da conta ou da assinatura fora do formato" }, 400);
  const e = validaEncerramento(await lerJson(req));
  if ("erro" in e) return json({ erro: e.erro }, 400);
  const agora = agoraIso();
  const emDia = await env.DB.prepare("SELECT 1 AS x FROM extras_pagos WHERE conta_id = ?1 AND assinatura_id = ?2 AND expires_at > ?3").bind(id, assinatura, agora).first();
  if (emDia === null) return json({ erro: "esta conta não tem esse extra pago em dia" }, 404);
  const parou = await pararCobrancas(env, await ativas(env, "SELECT id FROM assinaturas WHERE conta_id = ?1 AND id = ?2 AND status = 'ACTIVE'", id, assinatura));
  if ("erro" in parou) return parou.erro;
  if (!(await encerrarExtraPago(env.DB, id, assinatura, agora))) return json({ erro: "esta conta não tem esse extra pago em dia" }, 404);
  await registrarEncerramento(env.DB, { contaId: id, alvo: "extra", ref: assinatura, motivo: e.motivo, detalhe: e.detalhe, cobranca: parou.resumo, por: auth.conta.email }, agora);
  await auditar(env.DB, auth.conta.email, "extra.encerrado", id, `${assinatura} · ${textoMotivo(e)} · ${parou.resumo}`.slice(0, 500));
  return json({ ok: true, cobranca: parou.resumo, aviso: REEMBOLSO });
}
