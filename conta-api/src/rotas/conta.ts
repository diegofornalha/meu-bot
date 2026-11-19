/**
 * A conta desta sessão: `GET /conta` (como o app a mostra: licença, devices com "este", máquinas, pedidos, papel),
 * `PATCH /conta` (o perfil editável do console e o toggle de dados de uso), `DELETE /conta` (apagar a própria conta)
 * e `POST /conta/senha` (e-mail do Firebase para criar ou redefinir a senha).
 */
import type { ContaLinha, Env } from "../tipos.js";
import { apagarConta, auditar, contarLimite, gravarPerfilConta, montarContaApi, orgsDaConta, papelAdmin } from "../db.js";
import { janelaMinuto, validaPatchPerfil } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";
import { catalogoAddons, promoLigada } from "./pagamentos.js";

export async function getConta(auth: Autenticado, env: Env): Promise<Response> {
  const adm = await papelAdmin(env.DB, auth.conta.email, env.ADMIN_BOOTSTRAP_EMAIL);
  return json(await montarContaApi(env.DB, auth.conta, adm, catalogoAddons(env), auth.claims.dev, promoLigada(env)));
}

/** O que a pessoa muda no console › Perfil; devolve a conta inteira para a tela repintar. */
export async function patchConta(auth: Autenticado, env: Env, req: Request): Promise<Response> {
  const patch = validaPatchPerfil(await lerJson(req));
  if ("erro" in patch) return json({ erro: patch.erro }, 400);
  const nova = await gravarPerfilConta(env.DB, auth.conta, patch);
  const { dadosUso, ...perfil } = patch;
  if (Object.keys(perfil).length > 0) await auditar(env.DB, auth.conta.email, "perfil.alterado", auth.conta.id, Object.keys(perfil).join(", "));
  if (dadosUso !== undefined && (auth.conta.dados_uso !== 0) !== dadosUso) await auditar(env.DB, auth.conta.email, "dados-uso.alterado", auth.conta.id, dadosUso ? "ligado" : "desligado");
  const adm = await papelAdmin(env.DB, nova.email, env.ADMIN_BOOTSTRAP_EMAIL);
  return json(await montarContaApi(env.DB, nova, adm, catalogoAddons(env), auth.claims.dev, promoLigada(env)));
}

/**
 * O que impede apagar uma conta, pela própria pessoa (`DELETE /conta`) ou pelo super admin (`DELETE /admin/contas/:id`):
 * ter perfil de acesso (admin), ou ser dona de organização (os nomes).
 */
export async function impedimentosDeApagar(env: Env, conta: ContaLinha): Promise<{ admin: boolean; donaDe: string[] }> {
  const admin = (await papelAdmin(env.DB, conta.email, env.ADMIN_BOOTSTRAP_EMAIL)) !== null;
  const donaDe = (await orgsDaConta(env.DB, conta.id)).filter((o) => o.papel === "dona").map((o) => o.nome);
  return { admin, donaDe };
}
/** Apagar a própria conta. Admin não apaga a sua (o super admin tira o perfil de acesso antes): evita um super órfão. */
export async function deleteConta(auth: Autenticado, env: Env): Promise<Response> {
  const { admin, donaDe } = await impedimentosDeApagar(env, auth.conta);
  if (admin) return json({ erro: "um admin não apaga a própria conta; peça ao super admin para remover seu perfil de acesso antes" }, 403);
  if (donaDe.length > 0) return json({ erro: `você é dona de ${donaDe.join(", ")}: promova outra dona ou apague a organização antes` }, 403);
  await apagarConta(env.DB, auth.conta);
  await auditar(env.DB, auth.conta.email, "conta.apagada", auth.conta.id, null);
  return json({ ok: true });
}

/** Quantos e-mails de senha por conta por minuto. */
const LIMITE_SENHA_POR_MIN = 2;
/**
 * Pede ao Firebase o e-mail de redefinição de senha (que, numa conta só-Google, também cria a senha). Vai pela REST do
 * Identity Toolkit com a chave Web do projeto; a chave é restrita por referer (README), então o pedido leva o Referer
 * da página de login. Sem o provedor E-mail/senha ativado no projeto, o Firebase responde OPERATION_NOT_ALLOWED.
 */
export async function postSenha(auth: Autenticado, env: Env): Promise<Response> {
  return enviarEmailSenha(env, auth.conta, auth.conta.email);
}
/** O e-mail de senha para `conta`, pedido por `quem` (a própria pessoa ou um admin); rate limit por conta destino. */
export async function enviarEmailSenha(env: Env, conta: ContaLinha, quem: string): Promise<Response> {
  if (await contarLimite(env.DB, `senha:${conta.id}`, janelaMinuto()) > LIMITE_SENHA_POR_MIN) return json({ erro: "já mandamos o e-mail; espere um minuto antes de pedir outro" }, 429);
  let r: Response;
  try {
    r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
      method: "POST",
      headers: { "content-type": "application/json", referer: `https://${env.FIREBASE_AUTH_DOMAIN}/`, "x-firebase-locale": "pt-BR" },
      body: JSON.stringify({ requestType: "PASSWORD_RESET", email: conta.email }),
    });
  } catch (e) { console.log(`[senha] firebase indisponível: ${e instanceof Error ? e.message : String(e)}`); return json({ erro: "o Firebase não respondeu; tente de novo" }, 502); }
  if (!r.ok) {
    const corpo = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    const msg = corpo?.error?.message ?? `HTTP ${r.status}`;
    console.log(`[senha] sendOobCode recusado: ${msg}`);
    if (msg.startsWith("OPERATION_NOT_ALLOWED")) return json({ erro: "entrar com senha ainda não está ativado neste projeto; fale com o admin" }, 400);
    if (msg.startsWith("EMAIL_NOT_FOUND")) return json({ erro: "o Firebase não conhece este e-mail; entre de novo com o Google antes" }, 400);
    return json({ erro: "o Firebase recusou o pedido; tente de novo mais tarde" }, 502);
  }
  await auditar(env.DB, quem, "senha.email", conta.id, quem === conta.email ? null : "pelo admin");
  return json({ ok: true });
}
