/**
 * `POST /sessao` (a página de login, depois do Firebase): troca o ID token por um código de uso único (120 s) preso
 * ao `state` e ao PKCE que o app pôs na URL de login. A página manda a pessoa de volta com `<esquema>://auth?code&state`.
 * `POST /sessao/sair` (o app): revoga a família de refresh desta sessão.
 */
import type { ContaLinha, Env, OrgLinha } from "../tipos.js";
import { aceitarConvites, auditar, contarLimite, criarCodigo, houveContaApagada, iniciarTrialSeNovo, membroPor, orgPorSlug, papelAdmin, revogarFamilia, sessaoPorId, upsertConta } from "../db.js";
import { buscaJwksGoogle, verificarIdToken } from "../firebase.js";
import { agoraIso, CHALLENGE_RE, CODE_TTL_S, ESQUEMA_WEB, janelaMinuto, LIMITE_SESSAO_POR_MIN, maisSegundos, segredo, TOKEN_RE, validaPedidoSessao } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";

export async function postSessao(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("cf-connecting-ip") ?? "sem-ip";
  if (await contarLimite(env.DB, `sessao:${ip}`, janelaMinuto()) > LIMITE_SESSAO_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const pedido = validaPedidoSessao(await lerJson(req));
  if ("erro" in pedido) return json({ erro: pedido.erro }, 400);
  const u = await verificarIdToken(pedido.idToken, env.FIREBASE_PROJECT_ID, buscaJwksGoogle);
  if ("erro" in u) { console.log(`[sessao] id token recusado: ${u.erro}`); return json({ erro: "login não reconhecido; entre de novo" }, 401); }
  if (!u.emailVerificado) return json({ erro: "confirme o e-mail antes de entrar" }, 403);
  // Login pela página da organização (auth/org/<slug>): a organização precisa existir, e isso se confere antes de criar conta.
  const org = pedido.org === null ? null : await orgPorSlug(env.DB, pedido.org);
  if (pedido.org !== null && org === null) return json({ erro: "organização não encontrada; confira o endereço" }, 404);
  const agora = agoraIso();
  const conta = await upsertConta(env.DB, u, agora, pedido.metodo);
  await papelAdmin(env.DB, conta.email, env.ADMIN_BOOTSTRAP_EMAIL, agora);
  // Convites de organização para este e-mail viram membros ativos agora.
  const aceitos = await aceitarConvites(env.DB, conta, agora);
  if (aceitos > 0) await auditar(env.DB, conta.email, "org.convite-aceito", conta.id, `${aceitos} convite${aceitos === 1 ? "" : "s"}`, agora);
  const recusa = await entrarNaOrg(env, conta, org, agora);
  if (recusa !== null) return recusa;
  // Primeira entrada: trial do Pro (TRIAL_DIAS), como no Rambox; o admin muda depois pelo console.
  const dias = Number.parseInt(env.TRIAL_DIAS ?? "3", 10);
  // Quem apagou a conta e voltou com o mesmo e-mail não ganha outro trial.
  if (conta.criada_em === agora && await houveContaApagada(env.DB, conta.email)) await auditar(env.DB, conta.email, "licenca.trial-negado", conta.id, "conta apagada antes com este e-mail", agora);
  else if (await iniciarTrialSeNovo(env.DB, conta, Number.isFinite(dias) ? dias : 3, agora)) await auditar(env.DB, conta.email, "licenca.trial", conta.id, `${dias} dias`, agora);
  return codigoDoLogin(env, conta, pedido, agora);
}

/**
 * No login pela página de uma organização só membro entra (o convite, se havia, já foi aceito por quem chama).
 * Devolve a recusa (403) ou null. Vale para o login do Firebase e para o da passkey.
 */
export async function entrarNaOrg(env: Env, conta: ContaLinha, org: OrgLinha | null, agora: string): Promise<Response | null> {
  if (org === null) return null;
  const m = await membroPor(env.DB, org.id, conta.email);
  if (m === null || m.conta_id !== conta.id) { await auditar(env.DB, conta.email, "login.org-recusado", conta.id, org.slug, agora); return json({ erro: `${conta.email} não faz parte da organização ${org.nome}; peça o convite a quem a administra` }, 403); }
  await auditar(env.DB, conta.email, "login.org", conta.id, org.slug, agora);
  return null;
}
/** O fim de todo login pela página: o código de uso único (120 s) preso ao `state` e ao PKCE do app. `como` vai para a auditoria. */
export async function codigoDoLogin(env: Env, conta: ContaLinha, pedido: { state: string; challenge: string; esquema: string; app: string | null; versao: string | null }, agora: string, como = ""): Promise<Response> {
  const code = segredo(32);
  await criarCodigo(env.DB, { code, conta_id: conta.id, state: pedido.state, challenge: pedido.challenge, esquema: pedido.esquema, app: pedido.app, versao_app: pedido.versao, criado_em: agora, expira_em: maisSegundos(CODE_TTL_S) });
  await auditar(env.DB, conta.email, "login.codigo", conta.id, `${`${pedido.esquema}${pedido.app === null ? "" : ` · ${pedido.app} ${pedido.versao ?? ""}`}`.trim()}${como === "" ? "" : ` · ${como}`}`, agora);
  return json({ code, expiraEm: CODE_TTL_S });
}

export async function postSair(auth: Autenticado, env: Env): Promise<Response> {
  const s = await sessaoPorId(env.DB, auth.claims.sid);
  if (s !== null) await revogarFamilia(env.DB, s.familia);
  await auditar(env.DB, auth.conta.email, "login.sair", auth.conta.id, null);
  return json({ ok: true });
}

/** Quanto vale o código que leva do app ao console: o app abre o navegador na hora. */
export const CODE_CONSOLE_TTL_S = 60;
/**
 * `POST /sessao/console` (o app, com o Bearer dele): um código de uso único, esquema "web", preso ao challenge que o
 * app gerou. O app abre o console com `#code&verifier`, e o console o troca no `POST /token {grant:"web"}`: quem já
 * entrou no app não entra de novo no site.
 */
export async function postSessaoConsole(auth: Autenticado, env: Env, req: Request): Promise<Response> {
  const raw = await lerJson(req);
  const o = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const challenge = typeof o.challenge === "string" && CHALLENGE_RE.test(o.challenge) ? o.challenge : null;
  const state = typeof o.state === "string" && TOKEN_RE.test(o.state) ? o.state : segredo(32);
  if (challenge === null) return json({ erro: "challenge (PKCE) ausente ou fora do formato" }, 400);
  const agora = agoraIso();
  const code = segredo(32);
  await criarCodigo(env.DB, { code, conta_id: auth.conta.id, state, challenge, esquema: ESQUEMA_WEB, app: null, versao_app: null, criado_em: agora, expira_em: maisSegundos(CODE_CONSOLE_TTL_S) });
  await auditar(env.DB, auth.conta.email, "login.console", auth.conta.id, "do app", agora);
  return json({ code, expiraEm: CODE_CONSOLE_TTL_S });
}
