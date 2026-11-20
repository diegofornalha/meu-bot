/**
 * Organizações (molde Rambox Enterprise: console › /organizations/<slug>/members). Todas as rotas exigem Bearer.
 * Quem não é membro recebe 404 (a organização não existe para quem está fora), salvo o super admin, que vê todas.
 * Papéis: dona (tudo, inclusive apagar e promover), admin (convida, remove e muda papel entre admin↔membro), membro (vê).
 * Convite = o e-mail cadastrado; não há envio de e-mail: o console dá o link para a pessoa mandar. Quando aquele
 * e-mail entra, `aceitarConvites` (no POST /sessao) liga a conta. Assentos: ativos + convidados cabem até `assentos`.
 */
import type { Env, OrgLinha, PapelOrg } from "../tipos.js";
import { apagarOrg, assentosDaOrg, auditar, contarDonas, contarLimite, contarMembros, criarOrg, licencaPropria, orgsParaCriar, papelAdmin, gravarAssentos, gravarConvite, gravarOrg, membroPor, montarOrgApi, mudarPapel, orgPorSlug, orgsDaConta, removerMembro } from "../db.js";
import { assentosLivres, emailNoDominio, janelaMinuto, podeCriarOrg, validaAssentos, validaConvite, validaEmail, validaNovaOrg, validaPapelOrg, validaPatchOrg, validaSlug } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";

type Papel = PapelOrg | "super";
/** A organização e o papel de quem chama; null = 404 (não existe ou a pessoa está fora). */
async function orgDe(auth: Autenticado, env: Env, slugRaw: string): Promise<{ org: OrgLinha; papel: Papel } | null> {
  const slug = validaSlug(slugRaw);
  if (slug === null) return null;
  const org = await orgPorSlug(env.DB, slug);
  if (org === null) return null;
  const m = await membroPor(env.DB, org.id, auth.conta.email);
  if (m !== null && m.conta_id === auth.conta.id) return { org, papel: m.papel === "dona" || m.papel === "admin" ? m.papel : "membro" };
  return auth.claims.adm === "super" ? { org, papel: "super" } : null;
}
const semOrg = (): Response => json({ erro: "organização não encontrada" }, 404);

/** `GET /orgs/:slug/publico`, sem Bearer: só nome e endereço, para a página de login desenhar "Entrar na <nome>". */
export async function getOrgPublico(env: Env, slugRaw: string): Promise<Response> {
  const slug = validaSlug(slugRaw);
  const org = slug === null ? null : await orgPorSlug(env.DB, slug);
  if (org === null) return semOrg();
  return json({ slug: org.slug, nome: org.nome });
}
const gerencia = (p: Papel): boolean => p === "dona" || p === "admin" || p === "super";

export async function getOrgs(auth: Autenticado, env: Env): Promise<Response> {
  return json({ orgs: await orgsDaConta(env.DB, auth.conta.id) });
}
/** Quantas criações de organização uma conta tenta por minuto. */
const CRIAR_POR_MIN = 6;
export async function postOrg(auth: Autenticado, env: Env, req: Request): Promise<Response> {
  if (await contarLimite(env.DB, `org:${auth.conta.id}`, janelaMinuto()) > CRIAR_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const nova = validaNovaOrg(await lerJson(req));
  if ("erro" in nova) return json({ erro: nova.erro }, 400);
  // Criar organização é do Pro assinado e tem limite por conta (podeCriarOrg): quem decide é este servidor.
  const papel = await papelAdmin(env.DB, auth.conta.email, env.ADMIN_BOOTSTRAP_EMAIL);
  const [propria, criar] = await Promise.all([licencaPropria(env.DB, auth.conta), orgsParaCriar(env.DB, auth.conta.id)]);
  const nao = podeCriarOrg({ licenca: propria, papel, donaDe: criar.donaDe, limite: criar.limite, agoraMs: Date.now() });
  if (nao !== null) return json({ erro: nao.erro, motivo: nao.motivo }, 403);
  const org = await criarOrg(env.DB, auth.conta, nova);
  if (org === null) return json({ erro: "esse endereço já está em uso; escolha outro" }, 409);
  await auditar(env.DB, auth.conta.email, "org.criada", auth.conta.id, `${org.slug} · ${org.nome}`);
  return json(await montarOrgApi(env.DB, org, auth.conta.email, "dona", env.CONSOLE_ORIGIN));
}
export async function getOrg(auth: Autenticado, env: Env, slug: string): Promise<Response> {
  const x = await orgDe(auth, env, slug);
  if (x === null) return semOrg();
  return json(await montarOrgApi(env.DB, x.org, auth.conta.email, x.papel, env.CONSOLE_ORIGIN));
}
export async function patchOrg(auth: Autenticado, env: Env, slug: string, req: Request): Promise<Response> {
  const x = await orgDe(auth, env, slug);
  if (x === null) return semOrg();
  if (!gerencia(x.papel)) return json({ erro: "só dona ou admin da organização" }, 403);
  const patch = validaPatchOrg(await lerJson(req));
  if ("erro" in patch) return json({ erro: patch.erro }, 400);
  const org = await gravarOrg(env.DB, x.org, patch);
  await auditar(env.DB, auth.conta.email, "org.alterada", auth.conta.id, `${org.slug}: ${Object.keys(patch).join(", ")}`);
  return json(await montarOrgApi(env.DB, org, auth.conta.email, x.papel, env.CONSOLE_ORIGIN));
}
export async function deleteOrg(auth: Autenticado, env: Env, slug: string): Promise<Response> {
  const x = await orgDe(auth, env, slug);
  if (x === null) return semOrg();
  if (x.papel !== "dona" && x.papel !== "super") return json({ erro: "só a dona apaga a organização" }, 403);
  await apagarOrg(env.DB, x.org);
  await auditar(env.DB, auth.conta.email, "org.apagada", auth.conta.id, `${x.org.slug} · ${x.org.nome}`);
  return json({ ok: true });
}
export async function postMembro(auth: Autenticado, env: Env, slug: string, req: Request): Promise<Response> {
  const x = await orgDe(auth, env, slug);
  if (x === null) return semOrg();
  if (!gerencia(x.papel)) return json({ erro: "só dona ou admin convida" }, 403);
  const c = validaConvite(await lerJson(req));
  if ("erro" in c) return json({ erro: c.erro }, 400);
  if (!emailNoDominio(c.email, x.org.dominio_email)) return json({ erro: `esta organização só aceita e-mails @${x.org.dominio_email}` }, 400);
  if (await membroPor(env.DB, x.org.id, c.email) !== null) return json({ erro: "esse e-mail já está na organização" }, 409);
  // As vagas em vigor: a dona, as cortesias e os usuários pagos em dia (assentosDaOrg). Convite pendente ocupa vaga.
  const vagas = (await assentosDaOrg(env.DB, x.org)).limite;
  if (assentosLivres(vagas, await contarMembros(env.DB, x.org.id)) === 0) return json({ erro: `sem usuário livre: a organização tem ${vagas} e todos estão em uso. Adicione um usuário (página Membros) e convide de novo`, semVaga: true }, 409);
  const status = await gravarConvite(env.DB, x.org, c.email, c.papel, auth.conta.email);
  await auditar(env.DB, auth.conta.email, "org.convite", auth.conta.id, `${x.org.slug}: ${c.email} = ${c.papel} (${status})`);
  return json(await montarOrgApi(env.DB, x.org, auth.conta.email, x.papel, env.CONSOLE_ORIGIN));
}
export async function patchMembro(auth: Autenticado, env: Env, slug: string, emailRaw: string, req: Request): Promise<Response> {
  const x = await orgDe(auth, env, slug);
  if (x === null) return semOrg();
  if (!gerencia(x.papel)) return json({ erro: "só dona ou admin muda papéis" }, 403);
  const email = validaEmail(decodeURIComponent(emailRaw));
  if (email === null) return json({ erro: "e-mail fora do formato" }, 400);
  const corpo = await lerJson(req);
  const papel = validaPapelOrg(corpo !== null && typeof corpo === "object" ? (corpo as { papel?: unknown }).papel : undefined);
  if (papel === null) return json({ erro: "papel: dona, admin ou membro" }, 400);
  const m = await membroPor(env.DB, x.org.id, email);
  if (m === null) return json({ erro: "esse e-mail não está na organização" }, 404);
  if (x.papel === "admin" && (m.papel === "dona" || papel === "dona")) return json({ erro: "só a dona promove ou rebaixa uma dona" }, 403);
  if (papel === "dona" && m.status !== "ativo") return json({ erro: "só quem já entrou pode ser dona" }, 400);
  if (m.papel === "dona" && papel !== "dona" && await contarDonas(env.DB, x.org.id) <= 1) return json({ erro: "a organização precisa de pelo menos uma dona; promova outra pessoa antes" }, 400);
  await mudarPapel(env.DB, x.org.id, email, papel);
  await auditar(env.DB, auth.conta.email, "org.papel", auth.conta.id, `${x.org.slug}: ${email} = ${papel}`);
  return json(await montarOrgApi(env.DB, x.org, auth.conta.email, x.papel, env.CONSOLE_ORIGIN));
}
export async function deleteMembro(auth: Autenticado, env: Env, slug: string, emailRaw: string): Promise<Response> {
  const x = await orgDe(auth, env, slug);
  if (x === null) return semOrg();
  const email = validaEmail(decodeURIComponent(emailRaw));
  if (email === null) return json({ erro: "e-mail fora do formato" }, 400);
  const eu = email === auth.conta.email;
  if (!eu && !gerencia(x.papel)) return json({ erro: "só dona ou admin remove membros" }, 403);
  const m = await membroPor(env.DB, x.org.id, email);
  if (m === null) return json({ erro: "esse e-mail não está na organização" }, 404);
  if (m.papel === "dona" && x.papel === "admin") return json({ erro: "um admin não remove a dona" }, 403);
  if (m.papel === "dona" && await contarDonas(env.DB, x.org.id) <= 1) return json({ erro: eu ? "você é a única dona: promova outra pessoa ou apague a organização" : "a organização precisa de pelo menos uma dona" }, 400);
  await removerMembro(env.DB, x.org.id, email);
  await auditar(env.DB, auth.conta.email, eu ? "org.saiu" : "org.membro-removido", auth.conta.id, `${x.org.slug}: ${email}`);
  return eu ? json({ ok: true }) : json(await montarOrgApi(env.DB, x.org, auth.conta.email, x.papel, env.CONSOLE_ORIGIN));
}
/** `PATCH /admin/orgs/:slug` {assentos}: só o super admin. */
export async function patchAdminOrg(auth: Autenticado, env: Env, slugRaw: string, req: Request): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só o super admin muda assentos" }, 403);
  const slug = validaSlug(slugRaw);
  const org = slug === null ? null : await orgPorSlug(env.DB, slug);
  if (org === null) return semOrg();
  const corpo = await lerJson(req);
  const assentos = validaAssentos(corpo !== null && typeof corpo === "object" ? (corpo as { assentos?: unknown }).assentos : undefined);
  if (assentos === null) return json({ erro: "assentos: inteiro de 1 a 1000" }, 400);
  await gravarAssentos(env.DB, org, assentos);
  await auditar(env.DB, auth.conta.email, "org.assentos", auth.conta.id, `${org.slug}: ${assentos}`);
  return json({ ok: true, assentos });
}
