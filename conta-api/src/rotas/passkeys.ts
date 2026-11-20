/**
 * Passkey (WebAuthn) da conta, sem Firebase (ele não tem passkey): o Worker guarda a chave pública e confere a assinatura.
 * - Console, com o Bearer: `GET /conta/passkeys` (lista), `POST /conta/passkeys/opcoes` (o desafio e as opções do
 *   `navigator.credentials.create()`), `POST /conta/passkeys` (guarda a credencial) e `DELETE /conta/passkeys/:id`.
 * - Página de login, sem login: `POST /sessao/passkey/opcoes` (o desafio do `get()`) e `POST /sessao/passkey`, que
 *   confere a assinatura e devolve o mesmo código de uso único do `POST /sessao`.
 * Sem PASSKEY_RP_ID, tudo responde 503 e as páginas não mostram os botões.
 */
import type { Env } from "../tipos.js";
import { aceitarConvites, auditar, contaPorId, contarLimite, criarDesafio, criarPasskey, gastarDesafio, orgPorSlug, passkeyPorId, passkeysDaConta, removerPasskey, usarPasskey, type PasskeyLinha } from "../db.js";
import { ALGS, conferirCadastro, conferirLogin, DESAFIO_TTL_S, LIMITE_PASSKEYS, validaCadastro, validaLogin, type Rp } from "../passkey-core.js";
import { agoraIso, b64url, janelaMinuto, LIMITE_SESSAO_POR_MIN, maisSegundos, segredo } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";
import { codigoDoLogin, entrarNaOrg } from "./sessao.js";

/** O RP desta instalação, ou null com a passkey desligada. As origens são as duas páginas que falam com a API. */
export function rpDoEnv(env: Env): Rp | null {
  const rpId = (env.PASSKEY_RP_ID ?? "").trim();
  return rpId === "" ? null : { rpId, origens: [env.AUTH_ORIGIN, env.CONSOLE_ORIGIN] };
}
export const passkeyLigada = (env: Env): boolean => rpDoEnv(env) !== null;
const desligada = (): Response => json({ erro: "entrar com passkey não está ligado neste ambiente" }, 503);

const paraTela = (p: PasskeyLinha): { id: string; nome: string; criadaEm: string; usadaEm: string | null; sincronizada: boolean } => ({ id: p.id, nome: p.nome, criadaEm: p.criada_em, usadaEm: p.usada_em, sincronizada: p.sincronizada !== 0 });

export async function getPasskeys(auth: Autenticado, env: Env): Promise<Response> {
  if (!passkeyLigada(env)) return desligada();
  return json({ passkeys: (await passkeysDaConta(env.DB, auth.conta.id)).map(paraTela), limite: LIMITE_PASSKEYS });
}

/** Quantos pedidos de opções por conta por minuto (cada um guarda um desafio). */
const LIMITE_OPCOES_POR_MIN = 10;
export async function postPasskeyOpcoes(auth: Autenticado, env: Env): Promise<Response> {
  const rp = rpDoEnv(env);
  if (rp === null) return desligada();
  if (await contarLimite(env.DB, `passkey-opcoes:${auth.conta.id}`, janelaMinuto()) > LIMITE_OPCOES_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const atuais = await passkeysDaConta(env.DB, auth.conta.id);
  if (atuais.length >= LIMITE_PASSKEYS) return json({ erro: `esta conta já tem ${LIMITE_PASSKEYS} passkeys; remova uma antes de criar outra` }, 409);
  const desafio = segredo(32), agora = agoraIso();
  await criarDesafio(env.DB, desafio, "cadastro", auth.conta.id, maisSegundos(DESAFIO_TTL_S), agora);
  const nome = env.CANAL === "staging" ? `${auth.conta.email} (staging)` : auth.conta.email;
  return json({
    challenge: desafio,
    rp: { id: rp.rpId, name: env.CANAL === "staging" ? "meu-bot (staging)" : "meu-bot" },
    // O id da pessoa para o autenticador é o id da conta (nunca o e-mail): volta como userHandle no login.
    user: { id: b64url(new TextEncoder().encode(auth.conta.id)), name: nome, displayName: auth.conta.nome ?? auth.conta.email },
    pubKeyCredParams: ALGS.map((alg) => ({ type: "public-key", alg })),
    // Um autenticador que já tem passkey desta conta não cria outra.
    excludeCredentials: atuais.map((p) => ({ type: "public-key", id: p.id })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    attestation: "none",
    timeout: DESAFIO_TTL_S * 1000,
  });
}

export async function postPasskey(auth: Autenticado, env: Env, req: Request): Promise<Response> {
  const rp = rpDoEnv(env);
  if (rp === null) return desligada();
  const bruto = validaCadastro(await lerJson(req));
  if ("erro" in bruto) return json({ erro: bruto.erro }, 400);
  const c = await conferirCadastro(bruto, rp);
  if ("erro" in c) { console.log(`[passkey] cadastro recusado: ${c.erro}`); return json({ erro: c.erro }, 400); }
  const agora = agoraIso();
  if (!(await gastarDesafio(env.DB, c.desafio, "cadastro", auth.conta.id, agora))) return json({ erro: "o pedido venceu ou já foi usado; tente de novo" }, 400);
  if ((await passkeysDaConta(env.DB, auth.conta.id)).length >= LIMITE_PASSKEYS) return json({ erro: `esta conta já tem ${LIMITE_PASSKEYS} passkeys; remova uma antes de criar outra` }, 409);
  const nome = bruto.nome ?? "Passkey";
  if (!(await criarPasskey(env.DB, { id: c.id, conta_id: auth.conta.id, chave_publica: c.chave, alg: c.alg, contador: c.contador, sincronizada: c.sincronizada ? 1 : 0, transportes: JSON.stringify(bruto.transportes), nome, criada_em: agora }))) return json({ erro: "esta passkey já está cadastrada" }, 409);
  await auditar(env.DB, auth.conta.email, "passkey.criada", auth.conta.id, nome, agora);
  return json({ passkeys: (await passkeysDaConta(env.DB, auth.conta.id)).map(paraTela), limite: LIMITE_PASSKEYS });
}

export async function deletePasskey(auth: Autenticado, env: Env, id: string): Promise<Response> {
  if (!passkeyLigada(env)) return desligada();
  const p = await passkeyPorId(env.DB, id);
  if (p === null || p.conta_id !== auth.conta.id || !(await removerPasskey(env.DB, auth.conta.id, id))) return json({ erro: "passkey não encontrada nesta conta" }, 404);
  await auditar(env.DB, auth.conta.email, "passkey.removida", auth.conta.id, p.nome);
  return json({ passkeys: (await passkeysDaConta(env.DB, auth.conta.id)).map(paraTela), limite: LIMITE_PASSKEYS });
}

const ip = (req: Request): string => req.headers.get("cf-connecting-ip") ?? "sem-ip";
/** O desafio do login: sem lista de credenciais (a passkey é "descobrível": o aparelho mostra as que tem deste site). */
export async function postLoginOpcoes(req: Request, env: Env): Promise<Response> {
  const rp = rpDoEnv(env);
  if (rp === null) return desligada();
  if (await contarLimite(env.DB, `passkey-login:${ip(req)}`, janelaMinuto()) > LIMITE_SESSAO_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const desafio = segredo(32);
  await criarDesafio(env.DB, desafio, "login", null, maisSegundos(DESAFIO_TTL_S));
  return json({ challenge: desafio, rpId: rp.rpId, userVerification: "required", timeout: DESAFIO_TTL_S * 1000 });
}

/** A mesma resposta para credencial desconhecida, conta apagada e assinatura errada: quem tenta não aprende qual foi. */
const naoReconhecida = (): Response => json({ erro: "passkey não reconhecida; entre de outro jeito e confira as passkeys no console" }, 401);
export async function postLoginPasskey(req: Request, env: Env): Promise<Response> {
  const rp = rpDoEnv(env);
  if (rp === null) return desligada();
  if (await contarLimite(env.DB, `sessao:${ip(req)}`, janelaMinuto()) > LIMITE_SESSAO_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const pedido = validaLogin(await lerJson(req));
  if ("erro" in pedido) return json({ erro: pedido.erro }, 400);
  const p = await passkeyPorId(env.DB, pedido.id);
  if (p === null) { console.log("[passkey] login recusado: credencial desconhecida"); return naoReconhecida(); }
  const r = await conferirLogin(pedido, { chave: p.chave_publica, alg: p.alg, contador: p.contador }, rp);
  if ("erro" in r) { console.log(`[passkey] login recusado: ${r.erro}`); return naoReconhecida(); }
  // O aparelho devolve o id da pessoa que guardou no cadastro; se veio, tem de ser o da conta dona da credencial.
  if (pedido.userHandle !== null && pedido.userHandle !== b64url(new TextEncoder().encode(p.conta_id))) { console.log("[passkey] login recusado: userHandle de outra conta"); return naoReconhecida(); }
  const agora = agoraIso();
  if (!(await gastarDesafio(env.DB, r.desafio, "login", null, agora))) return json({ erro: "o pedido venceu ou já foi usado; tente de novo" }, 401);
  const conta = await contaPorId(env.DB, p.conta_id);
  if (conta === null) return naoReconhecida();
  const org = pedido.org === null ? null : await orgPorSlug(env.DB, pedido.org);
  if (pedido.org !== null && org === null) return json({ erro: "organização não encontrada; confira o endereço" }, 404);
  if (!(await usarPasskey(env.DB, p.id, p.contador, r.contador, agora))) return naoReconhecida();
  // Como no login do Firebase: convites para este e-mail viram membros ativos, e pela página da organização só membro entra.
  const aceitos = await aceitarConvites(env.DB, conta, agora);
  if (aceitos > 0) await auditar(env.DB, conta.email, "org.convite-aceito", conta.id, `${aceitos} convite${aceitos === 1 ? "" : "s"}`, agora);
  const recusa = await entrarNaOrg(env, conta, org, agora);
  if (recusa !== null) return recusa;
  return codigoDoLogin(env, conta, pedido, agora, "passkey");
}
