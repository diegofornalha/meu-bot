/**
 * Cortesias do admin (cortesia-core.ts): `POST /admin/contas/:id/cortesias` dá uma cortesia com prazo e motivo;
 * `POST /admin/contas/:id/cortesias/:c/renovar {fim}` estende o prazo; `POST /admin/contas/:id/cortesias/:c/encerrar
 * {motivo, detalhe}` encerra agora. Qualquer admin. Tudo vai para a auditoria; o encerramento, também para o histórico
 * da conta (`encerramentos`).
 */
import type { Env } from "../tipos.js";
import { auditar, contaPorId, encerrarCortesia, gravarCortesia, limiteDeDevicesComExtras, orgPorSlug, promoverDevicesPendentes, registrarEncerramento, renovarCortesia } from "../db.js";
import { UUID_RE } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";
import { validaCortesia, validaEncerramento, validaFimCortesia, CORTESIA_DIAS_MAX } from "../cortesia-core.js";
import { catalogoAddons } from "./pagamentos.js";

const resumo = (c: { tipo: string; produto: string | null; quantidade: number; fim: string }): string => `${c.tipo}${c.produto !== null ? ` ${c.produto}` : ""}${c.quantidade > 1 ? ` ×${c.quantidade}` : ""} até ${c.fim.slice(0, 10)}`;

export async function postCortesia(auth: Autenticado, env: Env, id: string, req: Request): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id)) return json({ erro: "id da conta fora do formato" }, 400);
  const agoraMs = Date.now();
  const p = validaCortesia(await lerJson(req), agoraMs, catalogoAddons(env));
  if ("erro" in p) return json({ erro: p.erro }, 400);
  const conta = await contaPorId(env.DB, id);
  if (conta === null) return json({ erro: "conta não existe" }, 404);
  // O usuário de cortesia é uma vaga da organização: só numa organização ativa de que esta conta é a dona.
  let orgId: string | null = null;
  if (p.tipo === "assento") {
    const org = p.org === null ? null : await orgPorSlug(env.DB, p.org);
    if (org === null || org.dona_conta_id !== conta.id) return json({ erro: "essa organização não existe ou não é desta conta" }, 404);
    orgId = org.id;
  }
  const c = await gravarCortesia(env.DB, conta.id, { tipo: p.tipo, produto: p.produto, orgId, quantidade: p.quantidade, fim: p.fim, motivo: p.motivo }, auth.conta.email);
  // Device de cortesia abre vaga na hora: quem esperava aprovação entra, como no device extra pago.
  if (p.tipo === "device") await promoverDevicesPendentes(env.DB, conta.id, (await limiteDeDevicesComExtras(env.DB, conta)).limite);
  await auditar(env.DB, auth.conta.email, "cortesia.dada", conta.id, `${resumo(c)}${p.org !== null ? ` · ${p.org}` : ""} · ${p.motivo}`.slice(0, 500));
  return json({ ok: true, cortesia: c });
}

export async function postRenovarCortesia(auth: Autenticado, env: Env, id: string, cortesia: string, req: Request): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id) || !UUID_RE.test(cortesia)) return json({ erro: "id da conta ou da cortesia fora do formato" }, 400);
  const corpo = (await lerJson(req)) as Record<string, unknown> | null;
  const fim = validaFimCortesia(corpo?.fim, Date.now());
  if (fim === null) return json({ erro: `fim: uma data no futuro, até ${CORTESIA_DIAS_MAX} dias a partir de hoje` }, 400);
  const c = await renovarCortesia(env.DB, id, cortesia, fim);
  if (c === null) return json({ erro: "essa cortesia não existe nesta conta ou já foi encerrada" }, 404);
  if (c.tipo === "device") { const conta = await contaPorId(env.DB, id); if (conta !== null) await promoverDevicesPendentes(env.DB, conta.id, (await limiteDeDevicesComExtras(env.DB, conta)).limite); }
  await auditar(env.DB, auth.conta.email, "cortesia.renovada", id, resumo(c));
  return json({ ok: true, cortesia: c });
}

export async function postEncerrarCortesia(auth: Autenticado, env: Env, id: string, cortesia: string, req: Request): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id) || !UUID_RE.test(cortesia)) return json({ erro: "id da conta ou da cortesia fora do formato" }, 400);
  const e = validaEncerramento(await lerJson(req));
  if ("erro" in e) return json({ erro: e.erro }, 400);
  const c = await encerrarCortesia(env.DB, id, cortesia, auth.conta.email, e.detalhe === null ? e.motivo : `${e.motivo}: ${e.detalhe}`);
  if (c === null) return json({ erro: "essa cortesia não existe nesta conta ou já não vale" }, 404);
  await registrarEncerramento(env.DB, { contaId: id, alvo: "cortesia", ref: c.id, motivo: e.motivo, detalhe: e.detalhe, cobranca: null, por: auth.conta.email });
  await auditar(env.DB, auth.conta.email, "cortesia.encerrada", id, `${resumo(c)} · ${e.motivo}${e.detalhe !== null ? `: ${e.detalhe}` : ""}`.slice(0, 500));
  return json({ ok: true });
}
