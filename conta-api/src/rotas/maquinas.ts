/**
 * A licença da conta numa máquina (VM por SSH), pedida pelo app da própria pessoa:
 * - `POST /conta/maquinas {id, apelido}`: vincula a máquina à conta (ou só renova, se já é dela) e devolve o
 *   `licenca-conta.json` assinado para o app gravar lá. Sem vaga responde 409 com `noLimite` e as máquinas ocupadas;
 * - `POST /conta/maquinas/:id/licenca`: emite de novo para uma máquina já vinculada (a renovação do app);
 * - `DELETE /conta/maquinas/:id {apagada}`: tira a licença. `apagada: true` (o app já apagou o arquivo da máquina)
 *   abre a vaga na hora, até TROCAS_NA_HORA vezes em 30 dias; senão a vaga abre quando a última emissão vencer.
 * `id` é o uuid do `maquina.json` da máquina. Liga só com o secret LICENCA_PRIVATE_KEY; sem ele as rotas respondem 503.
 */
import type { Env, MaquinaLinha } from "../tipos.js";
import { auditar, contarLimite, desvincularMaquina, devicesDaConta, fecharPedidosDeLiberar, licencaDaConta, limiteDeMaquinas, maquinaApi, maquinaPorId, maquinasDaConta, trocasDeMaquina, vincularMaquina } from "../db.js";
import { UUID_RE, agoraIso, janelaMinuto } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";
import { LICENCA_VALIDADE_MS, abreVagaNaHora, admitirMaquina, assinarLicenca, licencaJsonV2, montarPayload, ocupaVaga, validaApelido, type Vinculo } from "../licenca-core.js";

export const licencaLigada = (env: Env): boolean => typeof env.LICENCA_PRIVATE_KEY === "string" && env.LICENCA_PRIVATE_KEY.trim() !== "";
const DESLIGADA = "a licença da conta na máquina ainda não está ligada; fale com o suporte";
/** Emissões e trocas por conta por minuto. */
const LIMITE_POR_MIN = 10;
const vinculo = (m: MaquinaLinha): Vinculo => ({ id: m.id, ultimaEmissaoEm: m.ultima_emissao_em, desvinculadaEm: m.desvinculada_em });

/** Assina a licença em vigor da conta para a máquina e devolve o arquivo, com as máquinas da conta como ficaram. */
async function emitir(auth: Autenticado, env: Env, maquina: string, agoraMs: number): Promise<Response> {
  const [licenca, devices] = await Promise.all([licencaDaConta(env.DB, auth.conta, agoraIso(agoraMs)), devicesDaConta(env.DB, auth.conta.id)]);
  const p = montarPayload(auth.conta, maquina, licenca, devices, agoraMs);
  let arquivo: Record<string, unknown>;
  try { arquivo = licencaJsonV2(p, await assinarLicenca(p, env.LICENCA_PRIVATE_KEY ?? "")); }
  catch (e) { console.log(`[licenca] não deu para assinar: ${e instanceof Error ? e.message : String(e)}`); return json({ erro: DESLIGADA }, 503); }
  return json({ licenca: arquivo, maquinas: (await maquinasDaConta(env.DB, auth.conta.id)).map(maquinaApi) });
}

export async function postMaquina(auth: Autenticado, env: Env, req: Request): Promise<Response> {
  if (!licencaLigada(env)) return json({ erro: DESLIGADA }, 503);
  if (await contarLimite(env.DB, `maquina:${auth.conta.id}`, janelaMinuto()) > LIMITE_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const corpo = (await lerJson(req)) as Record<string, unknown> | null;
  const id = corpo?.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return json({ erro: "id da máquina fora do formato" }, 400);
  const agoraMs = Date.now(), agora = agoraIso(agoraMs);
  const [daConta, existente, limite] = await Promise.all([maquinasDaConta(env.DB, auth.conta.id), maquinaPorId(env.DB, id), limiteDeMaquinas(env.DB, auth.conta.id)]);
  // Máquina que ainda segura a vaga de outra conta não troca de dono: senão as duas contas a usariam ao mesmo tempo.
  if (existente !== null && existente.conta_id !== null && existente.conta_id !== auth.conta.id && ocupaVaga(vinculo(existente), agoraMs)) return json({ erro: "esta máquina já usa a licença de outra conta; tire por lá antes de usar a sua" }, 409);
  const d = admitirMaquina(daConta.map(vinculo), id, limite, agoraMs);
  if ("erro" in d) return json({ erro: d.erro, noLimite: true, ocupadas: daConta.filter((m) => d.ocupadas.includes(m.id)).map(maquinaApi) }, 409);
  await vincularMaquina(env.DB, auth.conta.id, id, validaApelido(corpo?.apelido), agora);
  if (d.acao === "vincular") {
    await fecharPedidosDeLiberar(env.DB, auth.conta.id, agora);
    await auditar(env.DB, auth.conta.email, "maquina.vinculada", auth.conta.id, `${id} · ${validaApelido(corpo?.apelido) ?? "-"}`, agora);
  }
  return emitir(auth, env, id, agoraMs);
}

export async function postRenovarLicenca(auth: Autenticado, env: Env, id: string): Promise<Response> {
  if (!licencaLigada(env)) return json({ erro: DESLIGADA }, 503);
  if (!UUID_RE.test(id)) return json({ erro: "id da máquina fora do formato" }, 400);
  if (await contarLimite(env.DB, `maquina:${auth.conta.id}`, janelaMinuto()) > LIMITE_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const m = await maquinaPorId(env.DB, id);
  if (m === null || m.conta_id !== auth.conta.id || m.desvinculada_em !== null) return json({ erro: "esta máquina não usa a licença da sua conta" }, 404);
  const agoraMs = Date.now();
  await vincularMaquina(env.DB, auth.conta.id, id, null, agoraIso(agoraMs));
  return emitir(auth, env, id, agoraMs);
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
