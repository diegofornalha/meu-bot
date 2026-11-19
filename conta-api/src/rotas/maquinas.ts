/**
 * A licença da conta numa máquina (VM por SSH), pedida pelo app da própria pessoa:
 * - `POST /conta/maquinas {id, apelido}`: vincula a máquina à conta (ou só renova, se já é dela) e devolve o
 *   `licenca-conta.json` assinado para o app gravar lá. Sem vaga responde 409 com `noLimite` e as máquinas ocupadas;
 * - `POST /conta/maquinas/:id/licenca`: emite de novo para uma máquina já vinculada (a renovação do app). Se as
 *   vinculadas passam do limite em vigor (uma máquina extra venceu), só as mais antigas renovam: 409 com `semExtra`;
 * - `DELETE /conta/maquinas/:id {apagada}`: tira a licença. `apagada: true` (o app já apagou o arquivo da máquina)
 *   abre a vaga na hora, até TROCAS_NA_HORA vezes em 30 dias; senão a vaga abre quando a última emissão vencer.
 * - `POST /conta/maquinas/:id/visto {apelido, origem}`: o app avisa que a pessoa usa esta máquina e de onde vem o plano
 *   em vigor nela ("admin" ou "conta"). É só para o console listar as máquinas em uso: não emite, não ocupa vaga e não
 *   depende da chave de assinatura. `DELETE /conta/maquinas/:id/visto` tira a máquina dessa lista.
 * `id` é o uuid do `maquina.json` da máquina. Liga só com o secret LICENCA_PRIVATE_KEY; sem ele as rotas respondem 503.
 */
import type { Env, MaquinaLinha } from "../tipos.js";
import { auditar, contarLimite, desvincularMaquina, esquecerMaquinaVista, marcarMaquinaVista, devicesDaConta, fecharPedidosDeLiberar, licencaDaConta, limiteDeMaquinas, maquinaApi, maquinaPorId, maquinasDaConta, papelAdmin, trocasDeMaquina, vincularMaquina } from "../db.js";
import { UUID_RE, agoraIso, janelaMinuto } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";
import { catalogoAddons, extrasAVenda } from "./pagamentos.js";
import { limiteDoPapel } from "../pagamento-core.js";
import { LICENCA_VALIDADE_MS, abreVagaNaHora, admitirMaquina, assinarLicenca, cabeNoLimite, licencaJsonV2, montarPayload, ocupaVaga, validaApelido, type Vinculo } from "../licenca-core.js";

export const licencaLigada = (env: Env): boolean => typeof env.LICENCA_PRIVATE_KEY === "string" && env.LICENCA_PRIVATE_KEY.trim() !== "";
const DESLIGADA = "a licença da conta na máquina ainda não está ligada; fale com o suporte";
/** Emissões e trocas por conta por minuto. */
const LIMITE_POR_MIN = 10;
const vinculo = (m: MaquinaLinha): Vinculo => ({ id: m.id, ultimaEmissaoEm: m.ultima_emissao_em, desvinculadaEm: m.desvinculada_em });
const posicao = (m: MaquinaLinha): { id: string; criadaEm: string; desvinculadaEm: string | null } => ({ id: m.id, criadaEm: m.criada_em, desvinculadaEm: m.desvinculada_em });
/**
 * O que a máquina além do limite ouve ao renovar (cabeNoLimite): o que aconteceu e a saída. Adicionar uma máquina só é
 * sugerido onde a máquina extra está à venda.
 */
const semExtra = (env: Env, limite: number): string => `a sua conta usa a licença em mais máquinas do que o plano cobre agora (${limite}): uma máquina extra venceu ou o limite mudou. Tire a licença de outra máquina${extrasAVenda(env).some((x) => x.tipo === "maquina") ? ", ou adicione uma máquina no console, em Plano" : ""}`;

/** Em quantas máquinas esta conta pode usar a licença agora: o limite gravado mais as extras pagas, e sem limite para o super admin (papel lido da tabela, não do token). */
const limiteDaConta = async (auth: Autenticado, env: Env, agoraMs: number): Promise<number> => {
  const [limite, papel] = await Promise.all([limiteDeMaquinas(env.DB, auth.conta.id, agoraMs), papelAdmin(env.DB, auth.conta.email, env.ADMIN_BOOTSTRAP_EMAIL)]);
  return limiteDoPapel(limite, papel);
};
/**
 * Assina a licença em vigor da conta para a máquina e devolve o arquivo; null se a chave do Worker não presta. Vem
 * ANTES de qualquer gravação: se não dá para assinar, a máquina não ocupa vaga nem fecha pedido.
 */
async function assinar(auth: Autenticado, env: Env, maquina: string, agoraMs: number): Promise<Record<string, unknown> | null> {
  // O papel é lido da tabela agora, não do token (que vale 1 h): esta emissão vale 30 dias na máquina.
  const papel = await papelAdmin(env.DB, auth.conta.email, env.ADMIN_BOOTSTRAP_EMAIL);
  const [licenca, devices] = await Promise.all([licencaDaConta(env.DB, auth.conta, papel, catalogoAddons(env), agoraIso(agoraMs)), devicesDaConta(env.DB, auth.conta.id)]);
  const p = montarPayload(auth.conta, maquina, licenca, devices, agoraMs);
  try { return licencaJsonV2(p, await assinarLicenca(p, env.LICENCA_PRIVATE_KEY ?? "")); }
  catch (e) { console.log(`[licenca] não deu para assinar: ${e instanceof Error ? e.message : String(e)}`); return null; }
}
const emitida = async (auth: Autenticado, env: Env, arquivo: Record<string, unknown>): Promise<Response> => json({ licenca: arquivo, maquinas: (await maquinasDaConta(env.DB, auth.conta.id)).map(maquinaApi) });

export async function postMaquina(auth: Autenticado, env: Env, req: Request): Promise<Response> {
  if (!licencaLigada(env)) return json({ erro: DESLIGADA }, 503);
  if (await contarLimite(env.DB, `maquina:${auth.conta.id}`, janelaMinuto()) > LIMITE_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const corpo = (await lerJson(req)) as Record<string, unknown> | null;
  const id = corpo?.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return json({ erro: "id da máquina fora do formato" }, 400);
  const agoraMs = Date.now(), agora = agoraIso(agoraMs);
  const [daConta, existente, limite] = await Promise.all([maquinasDaConta(env.DB, auth.conta.id), maquinaPorId(env.DB, id), limiteDaConta(auth, env, agoraMs)]);
  // Máquina que ainda segura a vaga de outra conta não troca de dono: senão as duas contas a usariam ao mesmo tempo.
  if (existente !== null && existente.conta_id !== null && existente.conta_id !== auth.conta.id && ocupaVaga(vinculo(existente), agoraMs)) return json({ erro: "esta máquina já usa a licença de outra conta; tire por lá antes de usar a sua" }, 409);
  const d = admitirMaquina(daConta.map(vinculo), id, limite, agoraMs);
  if ("erro" in d) return json({ erro: d.erro, noLimite: true, ocupadas: daConta.filter((m) => d.ocupadas.includes(m.id)).map(maquinaApi) }, 409);
  // Já vinculada só renova, e a renovação respeita o limite em vigor (o mesmo de postRenovarLicenca).
  if (d.acao === "renovar" && !cabeNoLimite(daConta.map(posicao), id, limite)) return json({ erro: semExtra(env, limite), semExtra: true, limite }, 409);
  const arquivo = await assinar(auth, env, id, agoraMs);
  if (arquivo === null) return json({ erro: DESLIGADA }, 503);
  // A conferência da vaga e esta gravação não são uma transação: dois pedidos no mesmo instante, com máquinas
  // diferentes, podem passar do limite. O limite por minuto segura o abuso, e o excesso aparece no console.
  await vincularMaquina(env.DB, auth.conta.id, id, validaApelido(corpo?.apelido), agora);
  if (d.acao === "vincular") {
    await fecharPedidosDeLiberar(env.DB, auth.conta.id, agora);
    await auditar(env.DB, auth.conta.email, "maquina.vinculada", auth.conta.id, `${id} · ${validaApelido(corpo?.apelido) ?? "-"}`, agora);
  }
  return emitida(auth, env, arquivo);
}

export async function postRenovarLicenca(auth: Autenticado, env: Env, id: string): Promise<Response> {
  if (!licencaLigada(env)) return json({ erro: DESLIGADA }, 503);
  if (!UUID_RE.test(id)) return json({ erro: "id da máquina fora do formato" }, 400);
  if (await contarLimite(env.DB, `maquina:${auth.conta.id}`, janelaMinuto()) > LIMITE_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const m = await maquinaPorId(env.DB, id);
  if (m === null || m.conta_id !== auth.conta.id || m.desvinculada_em !== null) return json({ erro: "esta máquina não usa a licença da sua conta" }, 404);
  const agoraMs = Date.now();
  // O limite pode ter caído depois do vínculo (máquina extra vencida ou cancelada): as mais novas além dele não renovam.
  const [daConta, limite] = await Promise.all([maquinasDaConta(env.DB, auth.conta.id), limiteDaConta(auth, env, agoraMs)]);
  if (!cabeNoLimite(daConta.map(posicao), id, limite)) return json({ erro: semExtra(env, limite), semExtra: true, limite }, 409);
  const arquivo = await assinar(auth, env, id, agoraMs);
  if (arquivo === null) return json({ erro: DESLIGADA }, 503);
  await vincularMaquina(env.DB, auth.conta.id, id, null, agoraIso(agoraMs));
  return emitida(auth, env, arquivo);
}

export async function deleteMaquina(auth: Autenticado, env: Env, id: string, req: Request): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ erro: "id da máquina fora do formato" }, 400);
  if (await contarLimite(env.DB, `maquina:${auth.conta.id}`, janelaMinuto()) > LIMITE_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const corpo = (await lerJson(req)) as Record<string, unknown> | null;
  const agoraMs = Date.now(), agora = agoraIso(agoraMs);
  const m = await maquinaPorId(env.DB, id);
  if (m === null || m.conta_id !== auth.conta.id) return json({ erro: "esta máquina não usa a licença da sua conta" }, 404);
  const naHora = abreVagaNaHora(corpo?.apagada === true, await trocasDeMaquina(env.DB, auth.conta.id, agoraIso(agoraMs - LICENCA_VALIDADE_MS)));
  // Já desvinculada pelo console e agora o app apagou o arquivo: a linha sai e a vaga abre.
  if (!(await desvincularMaquina(env.DB, auth.conta.id, id, naHora, agora)) && !naHora) return json({ ok: true, naHora: false, maquinas: (await maquinasDaConta(env.DB, auth.conta.id)).map(maquinaApi) });
  await auditar(env.DB, auth.conta.email, "maquina.desvinculada", auth.conta.id, `${naHora ? "na hora" : "a vaga abre quando a emissão vencer"} · ${id}`, agora);
  return json({ ok: true, naHora, maquinas: (await maquinasDaConta(env.DB, auth.conta.id)).map(maquinaApi) });
}

/** Avisos de "máquina em uso" por conta por minuto: o app manda um por máquina a cada poucas horas. */
const VISTOS_POR_MIN = 30;
export async function postMaquinaVista(auth: Autenticado, env: Env, id: string, req: Request): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ erro: "id da máquina fora do formato" }, 400);
  if (await contarLimite(env.DB, `maquina-vista:${auth.conta.id}`, janelaMinuto()) > VISTOS_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const corpo = (await lerJson(req)) as Record<string, unknown> | null;
  const origem = corpo?.origem;
  if (origem !== "admin" && origem !== "conta") return json({ erro: "origem: admin ou conta" }, 400);
  await marcarMaquinaVista(env.DB, auth.conta.id, id, validaApelido(corpo?.apelido), origem);
  return json({ ok: true });
}
export async function deleteMaquinaVista(auth: Autenticado, env: Env, id: string): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ erro: "id da máquina fora do formato" }, 400);
  if (!(await esquecerMaquinaVista(env.DB, auth.conta.id, id))) return json({ erro: "esta máquina não está na sua lista" }, 404);
  return json({ ok: true });
}
