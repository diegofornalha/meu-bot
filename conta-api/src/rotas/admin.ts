/**
 * Rotas do admin (Bearer com `adm`): `GET /admin/visao?busca=` (todas as contas, com licença, devices e máquinas; os
 * pedidos abertos; os totais), `PATCH /admin/contas/:id/licenca` (plano, status, prazo, limite de devices, add-ons,
 * pagamento) e `POST /admin/pedidos/:id/atender`. Liberar device e vincular máquina entram na rodada da licença
 * assinada (PR 5/6 do plano). Tudo fica na auditoria.
 */
import type { Env } from "../tipos.js";
import { atenderPedido, auditar, contaPorId, contarSupers, gravarLicenca, gravarPerfil, gravarProvedor, removerPerfil, revogarSessoesDaConta, visaoAdmin } from "../db.js";
import { consultarFirebase, definirSenhaFirebase } from "../firebase-admin.js";
import { UUID_RE, validaBusca, validaEmail, validaPapel, validaPatchLicenca, validaSenhaNova } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";
import { enviarEmailSenha } from "./conta.js";

export async function getAdminVisao(auth: Autenticado, env: Env, url: URL): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  return json(await visaoAdmin(env.DB, validaBusca(url.searchParams.get("busca"))));
}
export async function postAtenderPedido(auth: Autenticado, env: Env, id: string): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id)) return json({ erro: "id do pedido fora do formato" }, 400);
  if (!(await atenderPedido(env.DB, id, auth.conta.email))) return json({ erro: "pedido não existe ou já foi atendido" }, 404);
  await auditar(env.DB, auth.conta.email, "pedido.atendido", auth.conta.id, id);
  return json({ ok: true });
}
export async function patchLicenca(auth: Autenticado, env: Env, id: string, req: Request): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id)) return json({ erro: "id da conta fora do formato" }, 400);
  const patch = validaPatchLicenca(await lerJson(req));
  if ("erro" in patch) return json({ erro: patch.erro }, 400);
  const conta = await contaPorId(env.DB, id);
  if (conta === null) return json({ erro: "conta não existe" }, 404);
  const licenca = await gravarLicenca(env.DB, conta, patch);
  await auditar(env.DB, auth.conta.email, "licenca.alterada", conta.id, JSON.stringify(patch).slice(0, 500));
  return json({ ok: true, licenca });
}
/** `POST /admin/contas/:id/senha`: manda à pessoa o e-mail de criar/redefinir senha (o mesmo de "Esqueci a senha"). */
export async function postAdminSenha(auth: Autenticado, env: Env, id: string): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id)) return json({ erro: "id da conta fora do formato" }, 400);
  const conta = await contaPorId(env.DB, id);
  if (conta === null) return json({ erro: "conta não existe" }, 404);
  return enviarEmailSenha(env, conta, auth.conta.email);
}
/**
 * `PUT /admin/contas/:id/senha {senha}`: o super admin define a senha de uma conta na hora (Firebase, pela conta
 * de serviço). A pessoa sai de todos os Macs (sessões revogadas) e passa a entrar com e-mail e senha.
 */
export async function putAdminSenha(auth: Autenticado, env: Env, id: string, req: Request): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só o super admin define a senha de alguém; admin manda o e-mail" }, 403);
  if (!UUID_RE.test(id)) return json({ erro: "id da conta fora do formato" }, 400);
  if (typeof env.FIREBASE_ADMIN_SA !== "string" || env.FIREBASE_ADMIN_SA === "") return json({ erro: "o Worker não tem a conta de serviço do Firebase (secret FIREBASE_ADMIN_SA); use o e-mail de senha" }, 501);
  const corpo = await lerJson(req);
  const senha = validaSenhaNova(corpo !== null && typeof corpo === "object" ? (corpo as { senha?: unknown }).senha : undefined);
  if (senha === null) return json({ erro: "senha: de 8 a 128 caracteres" }, 400);
  const conta = await contaPorId(env.DB, id);
  if (conta === null) return json({ erro: "conta não existe" }, 404);
  const r = await definirSenhaFirebase(env.FIREBASE_ADMIN_SA, env.FIREBASE_PROJECT_ID, conta.firebase_uid, senha);
  if (!r.ok) { console.log(`[senha] accounts:update recusado para ${conta.email}: ${r.erro}`); return json({ erro: r.erro.startsWith("USER_NOT_FOUND") ? `o Firebase não conhece a conta ${conta.email} (uid ${conta.firebase_uid.slice(0, 8)}…): ela nunca entrou pelo login, só existe no banco` : `o Firebase recusou: ${r.erro.slice(0, 120)}` }, 502); }
  await gravarProvedor(env.DB, conta, "password");
  await revogarSessoesDaConta(env.DB, conta.id);
  await auditar(env.DB, auth.conta.email, "senha.definida", conta.id, "pelo super admin; sessões revogadas");
  return json({ ok: true });
}
/** `GET /admin/contas/:id/firebase`: o que o Firebase sabe desta conta (uid e e-mail), para o super admin diagnosticar. */
export async function getAdminFirebase(auth: Autenticado, env: Env, id: string): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só o super admin" }, 403);
  if (!UUID_RE.test(id)) return json({ erro: "id da conta fora do formato" }, 400);
  if (typeof env.FIREBASE_ADMIN_SA !== "string" || env.FIREBASE_ADMIN_SA === "") return json({ erro: "sem FIREBASE_ADMIN_SA" }, 501);
  const conta = await contaPorId(env.DB, id);
  if (conta === null) return json({ erro: "conta não existe" }, 404);
  const r = await consultarFirebase(env.FIREBASE_ADMIN_SA, env.FIREBASE_PROJECT_ID, conta.firebase_uid, conta.email);
  if (!r.ok) return json({ erro: r.erro }, 502);
  return json({ uid: conta.firebase_uid, email: conta.email, projeto: env.FIREBASE_PROJECT_ID, porUid: r.porUid, porEmail: r.porEmail });
}
/** Perfis de acesso: só o super admin. `PUT /admin/perfis/:email {papel}` cria ou muda; `DELETE /admin/perfis/:email` remove. */
export async function putPerfil(auth: Autenticado, env: Env, emailRaw: string, req: Request): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só o super admin muda perfis de acesso" }, 403);
  const email = validaEmail(decodeURIComponent(emailRaw));
  if (email === null) return json({ erro: "e-mail fora do formato" }, 400);
  const corpo = await lerJson(req);
  const papel = validaPapel(corpo !== null && typeof corpo === "object" ? (corpo as { papel?: unknown }).papel : undefined);
  if (papel === null) return json({ erro: "papel: super ou admin" }, 400);
  if (email === auth.conta.email && papel !== "super") return json({ erro: "você não pode se rebaixar; peça a outro super admin" }, 400);
  await gravarPerfil(env.DB, email, papel);
  await auditar(env.DB, auth.conta.email, "perfil.gravado", auth.conta.id, `${email} = ${papel}`);
  return json({ ok: true });
}
export async function deletePerfil(auth: Autenticado, env: Env, emailRaw: string): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só o super admin muda perfis de acesso" }, 403);
  const email = validaEmail(decodeURIComponent(emailRaw));
  if (email === null) return json({ erro: "e-mail fora do formato" }, 400);
  if (email === auth.conta.email) return json({ erro: "você não pode remover o próprio acesso" }, 400);
  if (!(await removerPerfil(env.DB, email))) return json({ erro: "esse e-mail não é admin" }, 404);
  if ((await contarSupers(env.DB)) === 0) { await gravarPerfil(env.DB, email, "super"); return json({ erro: "era o último super admin; não removido" }, 400); }
  await auditar(env.DB, auth.conta.email, "perfil.removido", auth.conta.id, email);
  return json({ ok: true });
}
