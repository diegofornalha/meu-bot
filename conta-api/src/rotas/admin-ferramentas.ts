/**
 * Preços das ferramentas, pelo super admin (console › Preços das ferramentas). As regras são do
 * ferramentas-preco-core.ts; aqui ficam o banco e a AbacatePay.
 *   GET  /admin/ferramentas            o catálogo inteiro com a oferta de cada ferramenta
 *   PUT  /admin/ferramentas/<slug>     { centavos, aVenda }: define o preço e se está à venda
 *   POST /admin/ferramentas/lote       { slugs, centavos, aVenda }: o mesmo para várias (até LOTE_MAXIMO)
 * Preço novo cria um produto mensal na AbacatePay (ela não edita o preço de um produto); quem já assina continua no
 * produto antigo. Tirar de venda só tira do Marketplace. Toda mudança vai para a auditoria.
 */
import type { Env } from "../tipos.js";
import { json, lerJson, type Autenticado } from "../http.js";
import { auditar } from "../db.js";
import { agoraIso } from "../sessao-core.js";
import { CATALOGO } from "../ferramentas-catalogo.js";
import type { Ferramenta } from "../ferramentas-core.js";
import { LOTE_MAXIMO, decidirOferta, detalheDaMudanca, pedidoDoProduto, produtoDaResposta, validaCentavos, type OfertaGuardada, type ProdutoCriado } from "../ferramentas-preco-core.js";
import { esquecerOfertasEmMemoria } from "../ferramentas-ofertas-db.js";
import { API_ABACATE, pagamentosLigados } from "./pagamentos.js";

const SO_SUPER = "só o super admin define os preços das ferramentas";
const DESLIGADOS = "os pagamentos estão desligados neste ambiente: sem a AbacatePay não há como criar o produto de uma ferramenta";
const doCatalogo = (slug: string): Ferramenta | null => CATALOGO.find((f) => f.slug === slug) ?? null;

interface LinhaOferta { slug: string; produto: string; centavos: number; a_venda: number; atualizado_em: string; atualizado_por: string }

export async function getAdminFerramentas(auth: Autenticado, env: Env): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: SO_SUPER }, 403);
  const linhas = (await env.DB.prepare("SELECT slug, produto, centavos, a_venda, atualizado_em, atualizado_por FROM ferramentas_ofertas").all<LinhaOferta>()).results;
  const por = new Map(linhas.map((l) => [l.slug, l]));
  return json({
    pagamentos: pagamentosLigados(env),
    ferramentas: CATALOGO.map((f) => {
      const o = por.get(f.slug);
      return { slug: f.slug, nome: f.nome, categoria: f.categoria, grupo: f.grupo, resumo: f.resumo, centavos: o?.centavos ?? null, aVenda: o?.a_venda === 1, atualizadoEm: o?.atualizado_em ?? null, atualizadoPor: o?.atualizado_por ?? null };
    }),
  });
}

/** Cria o produto mensal na AbacatePay. Devolve o `prod_…`, ou a frase do que deu errado (nada é gravado nesse caso). */
async function criarProduto(env: Env, f: Ferramenta, centavos: number): Promise<{ produto: string } | { erro: string }> {
  let r: Response; let resp: unknown;
  try {
    r = await fetch(`${API_ABACATE}/products/create`, { method: "POST", headers: { authorization: `Bearer ${env.ABACATEPAY_KEY}`, "content-type": "application/json" }, body: JSON.stringify(pedidoDoProduto(env.CANAL, f, centavos)) });
    resp = await r.json().catch(() => null);
  } catch { return { erro: "a AbacatePay não respondeu; nada foi alterado. Tente de novo." }; }
  const produto = r.ok ? produtoDaResposta(resp) : null;
  if (produto !== null) return { produto };
  const motivo = typeof resp === "object" && resp !== null && typeof (resp as { error?: unknown }).error === "string" ? (resp as { error: string }).error : `HTTP ${r.status}`;
  return { erro: `a AbacatePay não criou o produto de ${f.nome} (${motivo.slice(0, 160)}); nada foi alterado.` };
}

/** Define o preço e a venda de uma ferramenta. Usado pela rota de uma e pela de lote. */
async function aplicar(env: Env, quem: string, f: Ferramenta, centavos: number, aVenda: boolean): Promise<{ ok: true; centavos: number; aVenda: boolean; mudou: boolean } | { ok: false; erro: string }> {
  const linha = await env.DB.prepare("SELECT produto, centavos, a_venda FROM ferramentas_ofertas WHERE slug = ?1").bind(f.slug).first<{ produto: string; centavos: number; a_venda: number }>();
  const atual: OfertaGuardada | null = linha === null ? null : { produto: linha.produto, centavos: linha.centavos, aVenda: linha.a_venda === 1 };
  const historico = (await env.DB.prepare("SELECT produto, centavos FROM ferramentas_produtos WHERE slug = ?1").bind(f.slug).all<ProdutoCriado>()).results;
  const d = decidirOferta({ atual, centavos, aVenda, historico });
  if (d.acao === "nada") return { ok: true, centavos, aVenda, mudou: false };
  const agora = agoraIso();
  let produto: string;
  if (d.acao === "so-venda") produto = atual!.produto;
  else if (d.acao === "reusar") produto = d.produto;
  else {
    const novo = await criarProduto(env, f, centavos);
    if ("erro" in novo) return { ok: false, erro: novo.erro };
    produto = novo.produto;
    await env.DB.prepare("INSERT OR IGNORE INTO ferramentas_produtos (produto, slug, centavos, criado_em, criado_por) VALUES (?1, ?2, ?3, ?4, ?5)").bind(produto, f.slug, centavos, agora, quem).run();
  }
  await env.DB.prepare("INSERT INTO ferramentas_ofertas (slug, produto, centavos, a_venda, atualizado_em, atualizado_por) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(slug) DO UPDATE SET produto = excluded.produto, centavos = excluded.centavos, a_venda = excluded.a_venda, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por")
    .bind(f.slug, produto, centavos, aVenda ? 1 : 0, agora, quem).run();
  await auditar(env.DB, quem, "ferramenta.preco", null, detalheDaMudanca(f.slug, atual, { centavos, aVenda }), agora);
  esquecerOfertasEmMemoria();
  return { ok: true, centavos, aVenda, mudou: true };
}

/** O corpo `{ centavos, aVenda }`, validado; ou o motivo da recusa. */
function lerPedido(corpo: unknown): { centavos: number; aVenda: boolean } | { erro: string } {
  const o = typeof corpo === "object" && corpo !== null ? (corpo as { centavos?: unknown; aVenda?: unknown }) : {};
  const centavos = validaCentavos(o.centavos);
  if (typeof centavos !== "number") return centavos;
  if (typeof o.aVenda !== "boolean") return { erro: "aVenda: true ou false" };
  return { centavos, aVenda: o.aVenda };
}

export async function putAdminFerramenta(auth: Autenticado, env: Env, slug: string, req: Request): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: SO_SUPER }, 403);
  if (!pagamentosLigados(env)) return json({ erro: DESLIGADOS }, 503);
  const f = doCatalogo(slug);
  if (f === null) return json({ erro: "ferramenta fora do catálogo" }, 404);
  const p = lerPedido(await lerJson(req));
  if ("erro" in p) return json({ erro: p.erro }, 400);
  const r = await aplicar(env, auth.conta.email, f, p.centavos, p.aVenda);
  return r.ok ? json({ slug, centavos: r.centavos, aVenda: r.aVenda, mudou: r.mudou }) : json({ erro: r.erro }, 502);
}

export async function postAdminFerramentasLote(auth: Autenticado, env: Env, req: Request): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: SO_SUPER }, 403);
  if (!pagamentosLigados(env)) return json({ erro: DESLIGADOS }, 503);
  const corpo = await lerJson(req);
  const p = lerPedido(corpo);
  if ("erro" in p) return json({ erro: p.erro }, 400);
  const bruto = typeof corpo === "object" && corpo !== null ? (corpo as { slugs?: unknown }).slugs : null;
  if (!Array.isArray(bruto) || bruto.length === 0 || bruto.some((s) => typeof s !== "string")) return json({ erro: "slugs: a lista das ferramentas" }, 400);
  const slugs = [...new Set(bruto as string[])];
  if (slugs.length > LOTE_MAXIMO) return json({ erro: `no máximo ${LOTE_MAXIMO} ferramentas por pedido` }, 400);
  // Uma por vez, na ordem: a falha de uma não desfaz as que já entraram, e a resposta diz qual foi qual.
  const feitas: { slug: string; mudou: boolean }[] = []; const falhas: { slug: string; erro: string }[] = [];
  for (const slug of slugs) {
    const f = doCatalogo(slug);
    if (f === null) { falhas.push({ slug, erro: "ferramenta fora do catálogo" }); continue; }
    const r = await aplicar(env, auth.conta.email, f, p.centavos, p.aVenda);
    if (r.ok) feitas.push({ slug, mudou: r.mudou }); else falhas.push({ slug, erro: r.erro });
  }
  return json({ centavos: p.centavos, aVenda: p.aVenda, feitas, falhas });
}
