/**
 * `POST /token`: o app troca o código do deep link (mais o verifier do PKCE e o device deste Mac) por um refresh
 * token rotativo e um token de acesso de 1 h; ou renova com `grant: "refresh"` (o refresh antigo morre; reusar um
 * já trocado derruba a família inteira). `grant: "web"` é o console: o código (esquema "web") vira só um token de
 * acesso de 1 h, sem device nem refresh (vencido, o console entra de novo pelo Firebase). Todas devolvem a conta (ContaApi).
 */
import type { Env, SessaoLinha } from "../tipos.js";
import { auditar, codigoPor, contaPorId, criarSessao, devicePor, devicesDaConta, gravarDevice, licencaDaConta, montarContaApi, papelAdmin, revogarFamilia, revogarSessao, sessaoPorHash, usarCodigo } from "../db.js";
import { ACESSO_TTL_S, ESQUEMA_WEB, admitirDevice, agoraIso, assinarJwt, maisSegundos, pkceConfere, refreshTtlS, segredo, sha256Hex, uuid, validaPedidoToken } from "../sessao-core.js";
import { json, lerJson } from "../http.js";
import { catalogoAddons, promoLigada } from "./pagamentos.js";
import { limiteDoPapel, type Papel } from "../pagamento-core.js";

async function emitir(env: Env, conta: { id: string; email: string }, s: Omit<SessaoLinha, "refresh_hash" | "revogada_em">, refresh: string, papel?: Papel): Promise<Response> {
  const hash = await sha256Hex(refresh);
  await criarSessao(env.DB, { ...s, refresh_hash: hash });
  const linha = await contaPorId(env.DB, conta.id);
  if (linha === null) return json({ erro: "conta não existe mais" }, 401);
  // `papel` já lido pelo chamador (login por código) não é lido de novo; na renovação, lê aqui.
  const adm = papel !== undefined ? papel : await papelAdmin(env.DB, linha.email, env.ADMIN_BOOTSTRAP_EMAIL);
  const agoraS = Math.floor(Date.now() / 1000);
  const acesso = await assinarJwt({ sub: conta.id, sid: s.id, dev: s.device_id, adm, iat: agoraS, exp: agoraS + ACESSO_TTL_S }, env.SESSAO_HMAC_KEY);
  return json({ refresh, acesso, expiraEm: maisSegundos(ACESSO_TTL_S), conta: await montarContaApi(env.DB, linha, adm, catalogoAddons(env), s.device_id) });
}

export async function postToken(req: Request, env: Env): Promise<Response> {
  const pedido = validaPedidoToken(await lerJson(req));
  if ("erro" in pedido) return json({ erro: pedido.erro }, 400);
  const agora = agoraIso();

  if (pedido.grant === "code" || pedido.grant === "web") {
    const c = await codigoPor(env.DB, pedido.code);
    if (c === null || c.usado_em !== null || Date.parse(c.expira_em) < Date.now()) return json({ erro: "código inválido, usado ou vencido; entre de novo" }, 401);
    if ((c.esquema === ESQUEMA_WEB) !== (pedido.grant === "web")) return json({ erro: "o código não é deste tipo de login" }, 401);
    if (!(await pkceConfere(pedido.verifier, c.challenge))) return json({ erro: "o código não é deste app (PKCE)" }, 401);
    if (!(await usarCodigo(env.DB, pedido.code, agora))) return json({ erro: "código já usado" }, 401);
    const conta = await contaPorId(env.DB, c.conta_id);
    if (conta === null) return json({ erro: "conta não existe mais" }, 401);
    if (pedido.grant === "web") {
      const adm = await papelAdmin(env.DB, conta.email, env.ADMIN_BOOTSTRAP_EMAIL);
      const agoraS = Math.floor(Date.now() / 1000);
      const acesso = await assinarJwt({ sub: conta.id, sid: `web:${uuid()}`, dev: null, adm, iat: agoraS, exp: agoraS + ACESSO_TTL_S }, env.SESSAO_HMAC_KEY);
      await auditar(env.DB, conta.email, "login.entrou", conta.id, "console web", agora);
      return json({ acesso, expiraEm: maisSegundos(ACESSO_TTL_S), conta: await montarContaApi(env.DB, conta, adm, catalogoAddons(env), null, promoLigada(env)) });
    }
    // O device deste Mac: o ativo (conhecido pelo uuid ou pelo alias antigo) continua ativo; o novo e o pendente entram se cabem no limite da licença.
    const d = pedido.device;
    const atual = await devicePor(env.DB, conta.id, d.id, d.alias);
    const papel = await papelAdmin(env.DB, conta.email, env.ADMIN_BOOTSTRAP_EMAIL);
    const [licenca, todos] = await Promise.all([licencaDaConta(env.DB, conta, papel, catalogoAddons(env)), devicesDaConta(env.DB, conta.id)]);
    const ativos = todos.filter((x) => x.status !== "pending" && x.id !== atual?.id).length;
    // Para o device já ativo: quantos ativos entraram na conta antes dele (os mais antigos ficam quando o limite cai).
    const maisAntigos = atual === null ? 0 : todos.filter((x) => x.status !== "pending" && x.id !== atual.id && (x.first_seen < atual.first_seen || (x.first_seen === atual.first_seen && x.id < atual.id))).length;
    const status = admitirDevice(atual, ativos, limiteDoPapel(licenca.deviceLimit, papel), maisAntigos);
    if (atual !== null && atual.status !== "pending" && status === "pending") await auditar(env.DB, conta.email, "device.pedido", conta.id, `${d.name || d.id} · voltou a esperar vaga: o limite caiu para ${licenca.deviceLimit}`, agora);
    await gravarDevice(env.DB, conta.id, { ...d, status }, atual, agora, conta.dados_uso !== 0);
    if (atual === null) await auditar(env.DB, conta.email, status === "pending" ? "device.pedido" : "device.novo", conta.id, `${d.name || d.id} · ${d.app} ${d.versao}`, agora);
    const familia = uuid();
    await auditar(env.DB, conta.email, "login.entrou", conta.id, `${c.esquema} · ${d.app} ${d.versao}`, agora);
    return emitir(env, conta, { id: uuid(), conta_id: conta.id, familia, device_id: d.id, app: d.app, versao_app: d.versao, criada_em: agora, usada_em: agora, expira_em: maisSegundos(refreshTtlS(env.CANAL)) }, segredo(32), papel);
  }

  const s = await sessaoPorHash(env.DB, await sha256Hex(pedido.refresh));
  if (s === null) return json({ erro: "sessão desconhecida; entre de novo" }, 401);
  if (s.revogada_em !== null) {
    // Um refresh já trocado voltou: alguém está com uma cópia. Derruba a cadeia toda.
    await revogarFamilia(env.DB, s.familia, agora);
    await auditar(env.DB, s.conta_id, "login.refresh-reusado", s.conta_id, s.familia, agora);
    return json({ erro: "sessão encerrada por segurança; entre de novo" }, 401);
  }
  if (Date.parse(s.expira_em) < Date.now()) return json({ erro: "sessão vencida; entre de novo" }, 401);
  const conta = await contaPorId(env.DB, s.conta_id);
  if (conta === null) return json({ erro: "conta não existe mais" }, 401);
  await revogarSessao(env.DB, s.id, agora);
  return emitir(env, conta, { id: uuid(), conta_id: conta.id, familia: s.familia, device_id: s.device_id, app: s.app, versao_app: s.versao_app, criada_em: agora, usada_em: agora, expira_em: maisSegundos(refreshTtlS(env.CANAL)) }, segredo(32));
}
