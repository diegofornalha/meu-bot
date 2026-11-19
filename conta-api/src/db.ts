/** Acesso ao D1: consultas tipadas, uma função por intenção. O que sai do banco é dado; quem decide é a rota. */
import type { AdminAssinatura, AdminAuditoria, AdminContaResumo, AdminVendaOculta, TipoVenda, AdminListaEspera, ContaAssinatura, AdminOrg, MaquinaApi, MaquinaVistaApi, AdminPagamento, AdminVendas, AdminPedido, AdminPerfil, AdminVisao, CodigoLinha, ContaApi, ContaLinha, DeviceApi, DeviceLinha, License, LicencaLinha, MaquinaLinha, MembroApi, MembroLinha, OrgApi, OrgLinha, OrgResumo, PapelOrg, PerfilApi, PromoApi, SessaoLinha } from "./tipos.js";
import { podeCriarOrg, DEVICE_LIMITE_MAX, agoraIso, ehAdminInicial, nomeExibicao, parseProvedores, provedoresDoLogin, unirProvedores, uuid, type MetodoLogin, type PatchLicenca, type PatchOrg, type PatchPerfil } from "./sessao-core.js";
import type { UsuarioFirebase } from "./firebase.js";
import { direitoPromo, liberacoesPorAddon, licencaDoSuper, licencaEmVigor, tipoDoExtra, umaPorContaEProduto, type Liberacao, type Papel, type Promo } from "./pagamento-core.js";
import { DEVICES_INCLUSOS, LICENCA_VALIDADE_MS, limiteComExtras, valeAte } from "./licenca-core.js";

export async function contaPorUid(db: D1Database, uid: string): Promise<ContaLinha | null> {
  return (await db.prepare("SELECT * FROM contas WHERE firebase_uid = ?1 AND apagada_em IS NULL").bind(uid).first<ContaLinha>()) ?? null;
}
export async function contaPorId(db: D1Database, id: string): Promise<ContaLinha | null> {
  return (await db.prepare("SELECT * FROM contas WHERE id = ?1 AND apagada_em IS NULL").bind(id).first<ContaLinha>()) ?? null;
}
/**
 * Cria ou atualiza a conta a partir do que o Firebase diz (e-mail, nome, foto podem mudar) e acumula os provedores
 * deste login. O que a pessoa digitou no console (nome próprio, sobrenome) não é tocado.
 */
export async function upsertConta(db: D1Database, u: UsuarioFirebase, agora = agoraIso(), metodo: MetodoLogin | null = null): Promise<ContaLinha> {
  const atual = await contaPorUid(db, u.uid);
  const novos = provedoresDoLogin(u.provedores, metodo);
  if (atual === null) {
    const id = uuid();
    const provedores = unirProvedores("[]", novos);
    await db.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, nome, foto, criada_em, atualizada_em, provedores) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)")
      .bind(id, u.uid, u.email, u.emailVerificado ? 1 : 0, u.nome, u.foto, agora, provedores).run();
    return { id, firebase_uid: u.uid, email: u.email, email_verificado: u.emailVerificado ? 1 : 0, nome: u.nome, foto: u.foto, criada_em: agora, atualizada_em: agora, apagada_em: null, nome_proprio: null, sobrenome: null, provedores, dados_uso: 1 };
  }
  const provedores = unirProvedores(atual.provedores, novos);
  await db.prepare("UPDATE contas SET email = ?2, email_verificado = ?3, nome = ?4, foto = ?5, atualizada_em = ?6, provedores = ?7 WHERE id = ?1")
    .bind(atual.id, u.email, u.emailVerificado ? 1 : 0, u.nome, u.foto, agora, provedores).run();
  return { ...atual, email: u.email, email_verificado: u.emailVerificado ? 1 : 0, nome: u.nome, foto: u.foto, atualizada_em: agora, provedores };
}
/** O perfil editável como a API devolve. */
export const perfilDaLinha = (c: ContaLinha): PerfilApi => ({ nomeProprio: c.nome_proprio, sobrenome: c.sobrenome });
/** `PATCH /conta`: aplica o patch sobre a linha e grava; desligar dados de uso também limpa o que os devices já guardaram. */
export async function gravarPerfilConta(db: D1Database, conta: ContaLinha, patch: PatchPerfil, agora = agoraIso()): Promise<ContaLinha> {
  const nova: ContaLinha = {
    ...conta,
    nome_proprio: patch.nomeProprio !== undefined ? patch.nomeProprio : conta.nome_proprio,
    sobrenome: patch.sobrenome !== undefined ? patch.sobrenome : conta.sobrenome,
    dados_uso: patch.dadosUso !== undefined ? (patch.dadosUso ? 1 : 0) : conta.dados_uso,
    atualizada_em: agora,
  };
  await db.prepare("UPDATE contas SET nome_proprio = ?2, sobrenome = ?3, dados_uso = ?4, atualizada_em = ?5 WHERE id = ?1")
    .bind(conta.id, nova.nome_proprio, nova.sobrenome, nova.dados_uso, agora).run();
  if (conta.dados_uso === 1 && nova.dados_uso === 0) await limparDadosDeUso(db, conta.id);
  return nova;
}
/** Dados de uso desligados: os devices ficam só com id, alias, status e primeira vez; as sessões perdem app e versão. */
export async function limparDadosDeUso(db: D1Database, contaId: string): Promise<void> {
  await db.batch([
    db.prepare("UPDATE devices SET name = NULL, user = NULL, platform = NULL, apps = '{}', last_seen = first_seen WHERE conta_id = ?1").bind(contaId),
    db.prepare("UPDATE sessoes SET app = NULL, versao_app = NULL WHERE conta_id = ?1").bind(contaId),
  ]);
}
/**
 * Apaga a conta (soft): marca `apagada_em`, libera e-mail e uid (UNIQUE) com o prefixo "apagada:", zera o que
 * identifica a pessoa, revoga todas as sessões e limpa os devices. Licença, pedidos e auditoria ficam para o histórico
 * do admin. Entrar de novo com o mesmo Google cria uma conta nova.
 */
export async function apagarConta(db: D1Database, conta: ContaLinha, agora = agoraIso()): Promise<void> {
  await db.batch([
    db.prepare("UPDATE contas SET apagada_em = ?2, email = ?3, firebase_uid = ?4, nome = NULL, foto = NULL, nome_proprio = NULL, sobrenome = NULL, provedores = '[]', atualizada_em = ?2 WHERE id = ?1")
      .bind(conta.id, agora, `apagada:${conta.id}:${conta.email}`, `apagada:${conta.id}:${conta.firebase_uid}`),
    db.prepare("UPDATE sessoes SET revogada_em = ?2 WHERE conta_id = ?1 AND revogada_em IS NULL").bind(conta.id, agora),
    db.prepare("UPDATE devices SET name = NULL, user = NULL, platform = NULL, apps = '{}' WHERE conta_id = ?1").bind(conta.id),
    db.prepare("DELETE FROM membros WHERE conta_id = ?1").bind(conta.id),
  ]);
}
/** O e-mail que a conta tinha antes de `apagarConta` (que grava "apagada:<id>:<email>"); numa conta viva, o próprio. */
export function emailOriginal(c: { id: string; email: string }): string {
  const prefixo = `apagada:${c.id}:`;
  return c.email.startsWith(prefixo) ? c.email.slice(prefixo.length) : c.email;
}
/**
 * O que as telas escondem, para o super admin: as contas apagadas (com o e-mail original, quem apagou, a licença que
 * ficou gravada e o total pago), as vendas que ele ocultou da tela Assinaturas e as últimas ações da tabela `auditoria`.
 */
export async function auditoriaAdmin(db: D1Database): Promise<AdminAuditoria> {
  const [apagadas, registro, assOcultas, pgsOcultos] = await Promise.all([
    db.prepare("SELECT c.id, c.email, c.criada_em, c.apagada_em, l.plan, l.status, l.expires_at, (SELECT a.quem FROM auditoria a WHERE a.conta_id = c.id AND a.acao = 'conta.apagada' ORDER BY a.id DESC LIMIT 1) AS quem, (SELECT COALESCE(SUM(p.valor_centavos), 0) FROM pagamentos p WHERE p.conta_id = c.id) AS pago FROM contas c LEFT JOIN licencas l ON l.conta_id = c.id WHERE c.apagada_em IS NOT NULL ORDER BY c.apagada_em DESC LIMIT 200")
      .all<{ id: string; email: string; criada_em: string; apagada_em: string; plan: string | null; status: string | null; expires_at: string | null; quem: string | null; pago: number }>(),
    db.prepare("SELECT a.id, a.quando, a.quem, a.acao, a.conta_id, a.detalhe, c.email, c.apagada_em FROM auditoria a LEFT JOIN contas c ON c.id = a.conta_id ORDER BY a.id DESC LIMIT 500")
      .all<{ id: number; quando: string; quem: string; acao: string; conta_id: string | null; detalhe: string | null; email: string | null; apagada_em: string | null }>(),
    db.prepare("SELECT a.id, a.conta_id, a.produto, a.valor_centavos, a.criada_em AS quando, a.oculta_em, a.oculta_por, c.email FROM assinaturas a JOIN contas c ON c.id = a.conta_id WHERE a.oculta_em IS NOT NULL ORDER BY a.oculta_em DESC LIMIT 500").all<VendaOcultaLinha>(),
    db.prepare("SELECT p.id, p.conta_id, p.produto, p.valor_centavos, p.pago_em AS quando, p.oculta_em, p.oculta_por, c.email FROM pagamentos p JOIN contas c ON c.id = p.conta_id WHERE p.oculta_em IS NOT NULL ORDER BY p.oculta_em DESC LIMIT 500").all<VendaOcultaLinha>(),
  ]);
  const oculta = (tipo: TipoVenda) => (v: VendaOcultaLinha): AdminVendaOculta => ({ tipo, id: v.id, produto: v.produto, valorCentavos: v.valor_centavos, quando: v.quando, ocultaEm: v.oculta_em, ocultaPor: v.oculta_por, conta: { id: v.conta_id, email: emailOriginal({ id: v.conta_id, email: v.email }) } });
  return {
    ocultas: [...assOcultas.results.map(oculta("assinaturas")), ...pgsOcultos.results.map(oculta("pagamentos"))].sort((a, b) => b.ocultaEm.localeCompare(a.ocultaEm)),
    apagadas: apagadas.results.map((c) => ({ id: c.id, email: emailOriginal(c), criadaEm: c.criada_em, apagadaEm: c.apagada_em, apagadaPor: c.quem, plan: c.plan, status: c.status, expiresAt: c.expires_at, pagoCentavos: c.pago })),
    registro: registro.results.map((a) => ({ id: a.id, quando: a.quando, quem: a.quem, acao: a.acao, detalhe: a.detalhe, conta: a.conta_id === null ? null : { id: a.conta_id, email: a.email === null ? null : emailOriginal({ id: a.conta_id, email: a.email }), apagada: a.apagada_em !== null } })),
  };
}
interface VendaOcultaLinha { id: string; conta_id: string; produto: string | null; valor_centavos: number | null; quando: string; oculta_em: string; oculta_por: string | null; email: string }
/**
 * Oculta (`quem` = e-mail do super admin) ou volta a mostrar (`quem` null) uma linha da tela Assinaturas. Só marca a
 * linha: assinatura, licença e cobrança seguem como estão. Devolve a conta da linha, ou null se o id não existe ou a
 * linha já está no estado pedido.
 */
export async function marcarVendaOculta(db: D1Database, tipo: TipoVenda, id: string, quem: string | null, agora = agoraIso()): Promise<{ contaId: string } | null> {
  const tabela = tipo === "assinaturas" ? "assinaturas" : "pagamentos";
  const r = await db.prepare(`UPDATE ${tabela} SET oculta_em = ?2, oculta_por = ?3 WHERE id = ?1 AND oculta_em IS ${quem === null ? "NOT NULL" : "NULL"} RETURNING conta_id`).bind(id, quem === null ? null : agora, quem).first<{ conta_id: string }>();
  return r === null ? null : { contaId: r.conta_id };
}
/** Tabelas com linhas de uma conta, fora assinaturas e pagamentos, na ordem em que saem antes da linha de `contas`. */
const TABELAS_DA_CONTA = ["sessoes", "codigos_login", "pagamento_checkouts", "addons_pagos", "extras_pagos", "pedidos", "devices", "maquinas", "maquinas_vistas", "membros", "licencas"] as const;
/** As assinaturas que a tela Auditoria mostra como ocultas: o que `zerarAuditoria` tem de cancelar antes de apagar. */
export async function assinaturasOcultas(db: D1Database): Promise<{ id: string; status: string }[]> {
  return (await db.prepare("SELECT id, status FROM assinaturas WHERE oculta_em IS NOT NULL").all<{ id: string; status: string }>()).results;
}
/**
 * Zera o que a tela Auditoria mostra (só o staging chama: são dados de teste). Numa transação:
 * - apaga as assinaturas ocultas em `semCobranca` (quem chama garantiu que a AbacatePay não cobra mais) e os extras delas;
 * - apaga os pagamentos ocultos, menos os de uma assinatura oculta que ficou (a que não deu para cancelar);
 * - apaga de vez as contas já apagadas que não têm mais assinatura nem pagamento, com tudo o que era delas;
 * - apaga o registro de ações inteiro.
 * Devolve quantas linhas saíram de cada lugar.
 */
export async function zerarAuditoria(db: D1Database, semCobranca: readonly string[]): Promise<{ assinaturas: number; pagamentos: number; contas: number; registro: number }> {
  const marcas = semCobranca.map((_, i) => `?${i + 1}`).join(", ");
  const ids = marcas === "" ? "(NULL)" : `(${marcas})`;
  const livres = "SELECT id FROM contas WHERE apagada_em IS NOT NULL AND id NOT IN (SELECT conta_id FROM assinaturas) AND id NOT IN (SELECT conta_id FROM pagamentos) AND id NOT IN (SELECT dona_conta_id FROM organizacoes)";
  const r = await db.batch([
    db.prepare(`DELETE FROM extras_pagos WHERE assinatura_id IN ${ids}`).bind(...semCobranca),
    db.prepare(`DELETE FROM assinaturas WHERE oculta_em IS NOT NULL AND id IN ${ids}`).bind(...semCobranca),
    db.prepare("DELETE FROM pagamentos WHERE oculta_em IS NOT NULL AND (assinatura_id IS NULL OR assinatura_id NOT IN (SELECT id FROM assinaturas WHERE oculta_em IS NOT NULL))"),
    ...TABELAS_DA_CONTA.map((t) => db.prepare(`DELETE FROM ${t} WHERE conta_id IN (${livres})`)),
    db.prepare(`DELETE FROM contas WHERE id IN (${livres})`),
    db.prepare("DELETE FROM auditoria"),
  ]);
  const n = (i: number): number => r[i]?.meta.changes ?? 0;
  return { assinaturas: n(1), pagamentos: n(2), contas: n(3 + TABELAS_DA_CONTA.length), registro: n(4 + TABELAS_DA_CONTA.length) };
}
/**
 * Apaga a assinatura `id` (quem chama já garantiu que a AbacatePay não cobra mais) e oculta os pagamentos dela em nome
 * de `quem`. Os pagamentos não são apagados: a linha de cada um é o que impede liberar o acesso de novo se o mesmo
 * pagamento chegar outra vez, e é o que diz que a conta já pagou o Pro (a promoção do primeiro mês não volta).
 * Devolve quantos pagamentos ocultou, ou null se a assinatura não existe.
 */
export async function removerAssinatura(db: D1Database, id: string, quem: string, agora = agoraIso()): Promise<number | null> {
  const [pgs, ass] = await db.batch([
    db.prepare("UPDATE pagamentos SET oculta_em = ?2, oculta_por = ?3 WHERE assinatura_id = ?1 AND oculta_em IS NULL AND EXISTS (SELECT 1 FROM assinaturas WHERE id = ?1)").bind(id, agora, quem),
    db.prepare("DELETE FROM assinaturas WHERE id = ?1").bind(id),
  ]);
  return (ass?.meta.changes ?? 0) === 0 ? null : pgs?.meta.changes ?? 0;
}
/** Todas as sessões (apps) da conta saem; os tokens de acesso de 1 h ainda valem até vencer. */
export async function revogarSessoesDaConta(db: D1Database, contaId: string, agora = agoraIso()): Promise<void> {
  await db.prepare("UPDATE sessoes SET revogada_em = ?2 WHERE conta_id = ?1 AND revogada_em IS NULL").bind(contaId, agora).run();
}
/** Marca um provedor de login como usado (o super admin acabou de definir a senha, por exemplo). */
export async function gravarProvedor(db: D1Database, conta: ContaLinha, provedor: string): Promise<void> {
  await db.prepare("UPDATE contas SET provedores = ?2 WHERE id = ?1").bind(conta.id, unirProvedores(conta.provedores, [provedor])).run();
}
/** Houve uma conta apagada com este e-mail? (quem apaga e volta não ganha trial de novo). */
export async function houveContaApagada(db: D1Database, email: string): Promise<boolean> {
  const r = await db.prepare("SELECT 1 AS um FROM contas WHERE apagada_em IS NOT NULL AND email LIKE 'apagada:%:' || ?1 LIMIT 1").bind(email).first<{ um: number }>();
  return r !== null && r !== undefined;
}

/** O papel de admin deste e-mail; o primeiro login do ADMIN_BOOTSTRAP_EMAIL entra como super se a tabela está vazia. */
export async function papelAdmin(db: D1Database, email: string, bootstrap: string, agora = agoraIso()): Promise<"super" | "admin" | null> {
  const r = await db.prepare("SELECT papel FROM admins WHERE email = ?1").bind(email).first<{ papel: string }>();
  if (r !== null && r !== undefined) return r.papel === "super" ? "super" : "admin";
  if (ehAdminInicial(email, bootstrap)) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM admins").first<{ n: number }>();
    if ((n?.n ?? 0) === 0) { await db.prepare("INSERT INTO admins (email, papel, criado_em) VALUES (?1, 'super', ?2)").bind(email, agora).run(); return "super"; }
  }
  return null;
}

export async function criarCodigo(db: D1Database, c: Omit<CodigoLinha, "usado_em">): Promise<void> {
  await db.prepare("INSERT INTO codigos_login (code, conta_id, state, challenge, esquema, app, versao_app, criado_em, expira_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
    .bind(c.code, c.conta_id, c.state, c.challenge, c.esquema, c.app, c.versao_app, c.criado_em, c.expira_em).run();
}
export async function codigoPor(db: D1Database, code: string): Promise<CodigoLinha | null> {
  return (await db.prepare("SELECT * FROM codigos_login WHERE code = ?1").bind(code).first<CodigoLinha>()) ?? null;
}
/** Marca o código como usado; devolve false se outro pedido já o usou (corrida). */
export async function usarCodigo(db: D1Database, code: string, agora = agoraIso()): Promise<boolean> {
  const r = await db.prepare("UPDATE codigos_login SET usado_em = ?2 WHERE code = ?1 AND usado_em IS NULL").bind(code, agora).run();
  return (r.meta.changes ?? 0) === 1;
}

const defaultLicense = (memberSince: string): License => ({ plan: "free", status: "free", interval: null, memberSince, trialEnd: null, expiresAt: null, deviceLimit: DEVICES_INCLUSOS, produtos: [], pagamento: null, updatedAt: memberSince, updatedBy: "system" });
function licencaDaLinha(l: LicencaLinha | null, memberSince: string): License {
  if (l === null) return defaultLicense(memberSince);
  let produtos: string[] = []; let pagamento: License["pagamento"] = null;
  try { const p: unknown = JSON.parse(l.produtos); if (Array.isArray(p)) produtos = p.filter((x): x is string => typeof x === "string"); } catch { /* vazio */ }
  try { if (l.pagamento !== null) { const p: unknown = JSON.parse(l.pagamento); if (p !== null && typeof p === "object" && typeof (p as { instrucoes?: unknown }).instrucoes === "string") pagamento = { instrucoes: (p as { instrucoes: string }).instrucoes, link: typeof (p as { link?: unknown }).link === "string" ? (p as { link: string }).link : null }; } } catch { /* null */ }
  return {
    plan: l.plan === "pro" ? "pro" : "free",
    status: l.status === "trialing" || l.status === "active" || l.status === "expired" ? l.status : "free",
    interval: l.interval === "month" || l.interval === "year" ? l.interval : null,
    memberSince: l.member_since, trialEnd: l.trial_end, expiresAt: l.expires_at,
    deviceLimit: Number.isInteger(l.device_limit) && l.device_limit >= 1 ? l.device_limit : DEVICES_INCLUSOS,
    produtos, pagamento, updatedAt: l.updated_at, updatedBy: l.updated_by === "admin" ? "admin" : "system",
  };
}
/** A licença como está gravada (o que o admin definiu e o Pro pago), sem os add-ons pagos: é a base de toda gravação. */
export async function licencaGravada(db: D1Database, conta: ContaLinha): Promise<License> {
  const l = (await db.prepare("SELECT * FROM licencas WHERE conta_id = ?1").bind(conta.id).first<LicencaLinha>()) ?? null;
  return licencaDaLinha(l, conta.criada_em);
}
/** Os add-ons pagos da conta (addons_pagos), vencidos ou não. */
export async function addonsPagos(db: D1Database, contaId: string): Promise<{ produto: string; expiresAt: string }[]> {
  return (await db.prepare("SELECT produto, expires_at FROM addons_pagos WHERE conta_id = ?1").bind(contaId).all<{ produto: string; expires_at: string }>()).results.map((r) => ({ produto: r.produto, expiresAt: r.expires_at }));
}
/**
 * A licença em vigor, que o app, o console e a máquina recebem (licencaEmVigor): a gravada, com o Pro sem prazo do
 * super admin e os add-ons pagos em dia. `papel` é o de `papelAdmin` para esta conta, lido uma vez pela rota: é
 * obrigatório para nenhum leitor decidir acesso pela licença gravada de um super admin. `catalogo` são os add-ons do
 * ambiente (`catalogoAddons`), que o super admin tem todos.
 */
export async function licencaDaConta(db: D1Database, conta: ContaLinha, papel: Papel, catalogo: readonly string[], agora = agoraIso()): Promise<License> {
  const [l, pagos, devices] = await Promise.all([licencaGravada(db, conta), addonsPagos(db, conta.id), extrasPagos(db, conta.id, "device")]);
  const vigor = licencaEmVigor(l, pagos, papel, catalogo, agora);
  return { ...vigor, deviceLimit: limiteComExtras(vigor.deviceLimit, devices, Date.parse(agora), DEVICE_LIMITE_MAX).limite };
}
/**
 * Quantos devices a conta pode ter ativos agora: o que o admin gravou (licencas.device_limit) mais os devices extras
 * pagos em dia. `extras` é quantas vagas são pagas. É o limite que `licencaDaConta` e `montarContaApi` entregam.
 */
export async function limiteDeDevicesComExtras(db: D1Database, conta: ContaLinha, agoraMs = Date.now()): Promise<{ limite: number; extras: number }> {
  const [l, pagos] = await Promise.all([licencaGravada(db, conta), extrasPagos(db, conta.id, "device")]);
  return limiteComExtras(l.deviceLimit, pagos, agoraMs, DEVICE_LIMITE_MAX);
}
/**
 * Promove a ativos os devices pendentes que cabem em `limite`, do pedido mais antigo para o mais novo (um device extra
 * acabou de ser pago, ou o limite subiu). Devolve os ids promovidos.
 */
export async function promoverDevicesPendentes(db: D1Database, contaId: string, limite: number): Promise<string[]> {
  const todos = await devicesDaConta(db, contaId);
  let ativos = todos.filter((d) => d.status !== "pending").length;
  const fila = todos.filter((d) => d.status === "pending").sort((a, b) => (a.requested_at ?? a.first_seen).localeCompare(b.requested_at ?? b.first_seen) || a.id.localeCompare(b.id));
  const promovidos: string[] = [];
  for (const d of fila) {
    if (ativos >= limite) break;
    if (await ativarDevice(db, contaId, d.id)) { promovidos.push(d.id); ativos++; }
  }
  return promovidos;
}

export async function devicesDaConta(db: D1Database, contaId: string): Promise<DeviceLinha[]> {
  return (await db.prepare("SELECT * FROM devices WHERE conta_id = ?1 ORDER BY last_seen DESC").bind(contaId).all<DeviceLinha>()).results;
}
export async function devicePor(db: D1Database, contaId: string, id: string, alias: string | null): Promise<DeviceLinha | null> {
  const r = await db.prepare("SELECT * FROM devices WHERE conta_id = ?1 AND (id = ?2 OR (?3 IS NOT NULL AND alias_legado = ?3)) ORDER BY CASE WHEN id = ?2 THEN 0 ELSE 1 END LIMIT 1").bind(contaId, id, alias).first<DeviceLinha>();
  return r ?? null;
}
export interface DeviceGravar { id: string; alias: string | null; name: string; user: string; platform: string; app: string; versao: string; status: "active" | "pending" }
/**
 * Grava o device (novo ou visto de novo); `apps[app]` recebe versão e hora. Device achado pelo alias antigo ganha o id
 * novo. Com `dadosUso` false (console › Dados de uso), a conta guarda só id, alias, status e a primeira vez: nome,
 * usuário, plataforma e apps ficam vazios, mesmo que um app antigo os mande.
 */
export async function gravarDevice(db: D1Database, contaId: string, d: DeviceGravar, atual: DeviceLinha | null, agora = agoraIso(), dadosUso = true): Promise<void> {
  let apps: Record<string, { version: string; lastSeen: string }> = {};
  if (dadosUso) {
    if (atual !== null) { try { const a: unknown = JSON.parse(atual.apps); if (a !== null && typeof a === "object") apps = a as typeof apps; } catch { apps = {}; } }
    apps[d.app] = { version: d.versao, lastSeen: agora };
  }
  const name = dadosUso ? d.name : null, user = dadosUso ? d.user : null, platform = dadosUso ? d.platform : null;
  const requested = d.status === "pending" ? (atual?.requested_at ?? agora) : null;
  if (atual === null) {
    await db.prepare("INSERT INTO devices (conta_id, id, alias_legado, name, user, platform, status, requested_at, first_seen, last_seen, apps) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10)")
      .bind(contaId, d.id, d.alias, name, user, platform, d.status, requested, agora, JSON.stringify(apps)).run();
    return;
  }
  await db.prepare("UPDATE devices SET id = ?3, alias_legado = COALESCE(?4, alias_legado), name = ?5, user = ?6, platform = ?7, status = ?8, requested_at = ?9, last_seen = ?10, apps = ?11 WHERE conta_id = ?1 AND id = ?2")
    .bind(contaId, atual.id, d.id, d.alias, name, user, platform, d.status, requested, dadosUso ? agora : atual.last_seen, JSON.stringify(apps)).run();
}

export async function maquinasDaConta(db: D1Database, contaId: string): Promise<MaquinaLinha[]> {
  return (await db.prepare("SELECT * FROM maquinas WHERE conta_id = ?1 ORDER BY criada_em").bind(contaId).all<MaquinaLinha>()).results;
}
export const maquinaApi = (m: MaquinaLinha): MaquinaApi => ({ id: m.id, apelido: m.apelido, vinculadaPor: m.vinculada_por, proAte: valeAte(m.ultima_emissao_em), desvinculadaEm: m.desvinculada_em });
/** A máquina pelo id, de qualquer conta (o id é o uuid do maquina.json dela). */
export async function maquinaPorId(db: D1Database, id: string): Promise<MaquinaLinha | null> {
  return (await db.prepare("SELECT * FROM maquinas WHERE id = ?1").bind(id).first<MaquinaLinha>()) ?? null;
}
/** O app avisou que a pessoa usa esta máquina (`origem`: de onde vem o plano em vigor nela). Só exibição: não mexe em vaga. */
export async function marcarMaquinaVista(db: D1Database, contaId: string, id: string, apelido: string | null, origem: "admin" | "conta", agora = agoraIso()): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO maquinas_vistas (conta_id, id, apelido, origem, vista_em) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(conta_id, id) DO UPDATE SET apelido = COALESCE(excluded.apelido, maquinas_vistas.apelido), origem = excluded.origem, vista_em = excluded.vista_em").bind(contaId, id, apelido, origem, agora),
    db.prepare("UPDATE maquinas SET ultimo_hello_em = ?3 WHERE id = ?1 AND conta_id = ?2").bind(id, contaId, agora),
  ]);
}
export async function esquecerMaquinaVista(db: D1Database, contaId: string, id: string): Promise<boolean> {
  return ((await db.prepare("DELETE FROM maquinas_vistas WHERE conta_id = ?1 AND id = ?2").bind(contaId, id).run()).meta.changes ?? 0) > 0;
}
/**
 * O admin atribuiu a máquina à conta (gestão): entra na lista da conta como "licença do admin" e fica até alguém
 * desfazer. Se o app da pessoa já a tinha avisado, a linha só ganha o carimbo do admin.
 */
export async function atribuirMaquina(db: D1Database, contaId: string, id: string, apelido: string | null, admin: string, agora = agoraIso()): Promise<void> {
  await db.prepare("INSERT INTO maquinas_vistas (conta_id, id, apelido, origem, vista_em, atribuida_por) VALUES (?1, ?2, ?3, 'admin', ?4, ?5) ON CONFLICT(conta_id, id) DO UPDATE SET apelido = COALESCE(excluded.apelido, maquinas_vistas.apelido), vista_em = excluded.vista_em, atribuida_por = excluded.atribuida_por").bind(contaId, id, apelido, agora, admin).run();
}
/** Desfaz a atribuição do admin; false se a máquina não estava atribuída a esta conta. A linha sai da lista da conta. */
export async function desatribuirMaquina(db: D1Database, contaId: string, id: string): Promise<boolean> {
  return ((await db.prepare("DELETE FROM maquinas_vistas WHERE conta_id = ?1 AND id = ?2 AND atribuida_por IS NOT NULL").bind(contaId, id).run()).meta.changes ?? 0) > 0;
}
/** A conta a que o admin atribuiu a máquina por último; null se nenhuma. */
export async function contaAtribuidaDaMaquina(db: D1Database, id: string): Promise<string | null> {
  return (await db.prepare("SELECT conta_id FROM maquinas_vistas WHERE id = ?1 AND atribuida_por IS NOT NULL ORDER BY vista_em DESC LIMIT 1").bind(id).first<{ conta_id: string }>())?.conta_id ?? null;
}
/**
 * As máquinas em uso que não estão em `maquinas` desta conta (essas já saem em `maquinasDaConta`): as que o app avisou
 * desde `desde` e as que o admin atribuiu (estas não vencem).
 */
export async function maquinasVistasDaConta(db: D1Database, contaId: string, desde: string): Promise<MaquinaVistaApi[]> {
  const r = await db.prepare("SELECT v.id, v.apelido, v.origem, v.vista_em, v.atribuida_por FROM maquinas_vistas v WHERE v.conta_id = ?1 AND (v.vista_em > ?2 OR v.atribuida_por IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM maquinas m WHERE m.id = v.id AND m.conta_id = v.conta_id) ORDER BY v.vista_em DESC LIMIT 50").bind(contaId, desde).all<{ id: string; apelido: string | null; origem: string; vista_em: string; atribuida_por: string | null }>();
  return r.results.map((x) => ({ id: x.id, apelido: x.apelido, origem: x.origem === "conta" ? "conta" : "admin", vistaEm: x.vista_em, atribuida: x.atribuida_por !== null }));
}
const limiteValido = (n: unknown): number => (typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : 1);
/** As unidades extras pagas da conta (extras_pagos), vencidas ou não; `tipo` filtra (ex.: "maquina"). */
export async function extrasPagos(db: D1Database, contaId: string, tipo?: string): Promise<{ assinaturaId: string; tipo: string; expiresAt: string }[]> {
  const r = await db.prepare("SELECT assinatura_id, tipo, expires_at FROM extras_pagos WHERE conta_id = ?1").bind(contaId).all<{ assinatura_id: string; tipo: string; expires_at: string }>();
  return r.results.filter((x) => tipo === undefined || x.tipo === tipo).map((x) => ({ assinaturaId: x.assinatura_id, tipo: x.tipo, expiresAt: x.expires_at }));
}
/**
 * Em quantas máquinas a conta pode usar a licença agora: o que o admin gravou (licencas.maquina_limit; sem linha, 1)
 * mais as máquinas extras pagas em dia (limiteComExtras). `extras` é quantas vagas são pagas.
 */
export async function limiteDeMaquinasComExtras(db: D1Database, contaId: string, agoraMs = Date.now()): Promise<{ limite: number; extras: number }> {
  const [base, pagos] = await Promise.all([db.prepare("SELECT maquina_limit FROM licencas WHERE conta_id = ?1").bind(contaId).first<{ maquina_limit: number }>(), extrasPagos(db, contaId, "maquina")]);
  return limiteComExtras(limiteValido(base?.maquina_limit), pagos, agoraMs);
}
/**
 * Organizações da conta para a regra de criação (podeCriarOrg): `limite` é o que o admin gravou (licencas.org_limit;
 * sem linha, 1) e `donaDe` quantas organizações ativas ela criou e ainda é a dona.
 */
export async function orgsParaCriar(db: D1Database, contaId: string): Promise<{ limite: number; donaDe: number }> {
  const [base, n] = await Promise.all([db.prepare("SELECT org_limit FROM licencas WHERE conta_id = ?1").bind(contaId).first<{ org_limit: number }>(), db.prepare("SELECT COUNT(*) AS n FROM organizacoes WHERE dona_conta_id = ?1 AND apagada_em IS NULL").bind(contaId).first<{ n: number }>()]);
  return { limite: limiteValido(base?.org_limit), donaDe: n?.n ?? 0 };
}
export async function limiteDeMaquinas(db: D1Database, contaId: string, agoraMs = Date.now()): Promise<number> {
  return (await limiteDeMaquinasComExtras(db, contaId, agoraMs)).limite;
}
/** Vincula a máquina à conta (ou a traz de volta) e carimba a emissão de agora. */
export async function vincularMaquina(db: D1Database, contaId: string, id: string, apelido: string | null, agora = agoraIso()): Promise<void> {
  await db.prepare("INSERT INTO maquinas (id, conta_id, apelido, vinculada_por, criada_em, ultima_emissao_em, desvinculada_em) VALUES (?1, ?2, ?3, 'app', ?4, ?4, NULL) ON CONFLICT(id) DO UPDATE SET conta_id = excluded.conta_id, apelido = COALESCE(excluded.apelido, apelido), vinculada_por = 'app', ultima_emissao_em = excluded.ultima_emissao_em, desvinculada_em = NULL")
    .bind(id, contaId, apelido, agora).run();
}
/** A vaga abre na hora (a linha sai) ou fica presa até a emissão vencer (`desvinculada_em`); false se não era desta conta. */
export async function desvincularMaquina(db: D1Database, contaId: string, id: string, naHora: boolean, agora = agoraIso()): Promise<boolean> {
  const r = naHora
    ? await db.prepare("DELETE FROM maquinas WHERE id = ?1 AND conta_id = ?2").bind(id, contaId).run()
    : await db.prepare("UPDATE maquinas SET desvinculada_em = ?3 WHERE id = ?1 AND conta_id = ?2 AND desvinculada_em IS NULL").bind(id, contaId, agora).run();
  return (r.meta.changes ?? 0) > 0;
}
/** Quantas vezes a conta abriu a vaga na hora desde `desde` (auditoria `maquina.desvinculada`, detalhe "na hora …"). */
export async function trocasDeMaquina(db: D1Database, contaId: string, desde: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE conta_id = ?1 AND acao = 'maquina.desvinculada' AND detalhe LIKE 'na hora%' AND quando > ?2").bind(contaId, desde).first<{ n: number }>())?.n ?? 0;
}
/** A pessoa aplicou a licença sozinha: os pedidos "liberar na máquina" abertos desta conta deixam de esperar o admin. */
export async function fecharPedidosDeLiberar(db: D1Database, contaId: string, agora = agoraIso()): Promise<void> {
  await db.prepare("UPDATE pedidos SET atendido_em = ?2, atendido_por = 'system' WHERE conta_id = ?1 AND tipo = 'pagamento.liberar' AND atendido_em IS NULL").bind(contaId, agora).run();
}
/** Os pedidos "Liberar na máquina" da conta, abertos e atendidos, resumidos por add-on (`liberacoesPorAddon`). */
export async function liberacoesDaConta(db: D1Database, contaId: string): Promise<Liberacao[]> {
  const r = await db.prepare("SELECT detalhe, atendido_em FROM pedidos WHERE conta_id = ?1 AND tipo = 'pagamento.liberar' ORDER BY criado_em DESC LIMIT 200").bind(contaId).all<{ detalhe: string | null; atendido_em: string | null }>();
  return liberacoesPorAddon(r.results);
}
export async function pedidosAbertos(db: D1Database, contaId: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE conta_id = ?1 AND atendido_em IS NULL").bind(contaId).first<{ n: number }>())?.n ?? 0;
}

export async function criarSessao(db: D1Database, s: Omit<SessaoLinha, "revogada_em">): Promise<void> {
  await db.prepare("INSERT INTO sessoes (id, conta_id, refresh_hash, familia, device_id, app, versao_app, criada_em, usada_em, expira_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
    .bind(s.id, s.conta_id, s.refresh_hash, s.familia, s.device_id, s.app, s.versao_app, s.criada_em, s.usada_em, s.expira_em).run();
}
export async function sessaoPorHash(db: D1Database, hash: string): Promise<SessaoLinha | null> {
  return (await db.prepare("SELECT * FROM sessoes WHERE refresh_hash = ?1").bind(hash).first<SessaoLinha>()) ?? null;
}
export async function sessaoPorId(db: D1Database, id: string): Promise<SessaoLinha | null> {
  return (await db.prepare("SELECT * FROM sessoes WHERE id = ?1").bind(id).first<SessaoLinha>()) ?? null;
}
export async function revogarSessao(db: D1Database, id: string, agora = agoraIso()): Promise<void> {
  await db.prepare("UPDATE sessoes SET revogada_em = ?2 WHERE id = ?1 AND revogada_em IS NULL").bind(id, agora).run();
}
export async function revogarFamilia(db: D1Database, familia: string, agora = agoraIso()): Promise<void> {
  await db.prepare("UPDATE sessoes SET revogada_em = ?2 WHERE familia = ?1 AND revogada_em IS NULL").bind(familia, agora).run();
}

/** Contador por chave e janela; devolve quantos já houve nesta janela (inclusive este). */
export async function contarLimite(db: D1Database, chave: string, janela: string): Promise<number> {
  await db.prepare("INSERT INTO limites (chave, janela, n) VALUES (?1, ?2, 1) ON CONFLICT(chave) DO UPDATE SET n = CASE WHEN janela = ?2 THEN n + 1 ELSE 1 END, janela = ?2").bind(chave, janela).run();
  return (await db.prepare("SELECT n FROM limites WHERE chave = ?1").bind(chave).first<{ n: number }>())?.n ?? 1;
}

export async function auditar(db: D1Database, quem: string, acao: string, contaId: string | null, detalhe: string | null, agora = agoraIso()): Promise<void> {
  await db.prepare("INSERT INTO auditoria (quando, quem, acao, conta_id, detalhe) VALUES (?1, ?2, ?3, ?4, ?5)").bind(agora, quem, acao, contaId, detalhe).run();
}

/**
 * A conta já pagou o Pro alguma vez? Vale qualquer cobrança paga do Pro (`pagamentos`, produto NULL: uma linha por
 * cobrança que o webhook liberou) ou assinatura do Pro já criada (`assinaturas`, produto NULL). `fora` tira da conta a
 * cobrança e a assinatura do próprio evento em processamento, para a nova tentativa de um webhook não se contar.
 * Pro pago por fora da AbacatePay (liberado à mão pelo admin) não deixa registro aqui.
 */
export async function jaPagouPro(db: D1Database, contaId: string, fora: { pagamentoId: string; assinaturaId: string } | null = null): Promise<boolean> {
  const r = await db.prepare("SELECT 1 AS x FROM pagamentos WHERE conta_id = ?1 AND produto IS NULL AND id != ?2 UNION ALL SELECT 1 AS x FROM assinaturas WHERE conta_id = ?1 AND produto IS NULL AND id != ?3 LIMIT 1")
    .bind(contaId, fora?.pagamentoId ?? "", fora?.assinaturaId ?? "").first<{ x: number }>();
  return r !== null && r !== undefined;
}
/**
 * A promoção do primeiro mês para esta conta agora (direitoPromo), ou null. `promo` é a configuração do ambiente
 * (null = desligada). A consulta de "já pagou" só roda para quem passaria nas outras regras. Super admin (`papel`) não
 * tem oferta: a conta dele já tem o Pro sem prazo, mesmo com um teste vencido gravado.
 */
export async function promoDaConta(db: D1Database, conta: ContaLinha, promo: Promo | null, papel: Papel, agoraMs = Date.now(), gravada?: License): Promise<PromoApi | null> {
  if (promo === null || papel === "super") return null;
  const licenca = gravada ?? await licencaGravada(db, conta);
  const base = { licenca, agoraMs, promoDias: promo.dias, cupom: promo.cupom };
  if (direitoPromo({ ...base, jaPagouPro: false }) === null) return null;
  const d = direitoPromo({ ...base, jaPagouPro: await jaPagouPro(db, conta.id) });
  return d === null ? null : { precoCentavos: promo.precoCentavos, ate: d.ate, cupom: promo.cupom };
}
/** A conta como o app a vê: licença, devices (com "este"), máquinas, pedidos e o papel de admin. `promo`: a configuração da promoção do primeiro mês no ambiente; só o console (`GET|PATCH /conta`) a passa. */
export async function montarContaApi(db: D1Database, conta: ContaLinha, admin: Papel, catalogo: readonly string[], deviceAtual: string | null, promo: Promo | null = null): Promise<ContaApi> {
  const [criar, gravada, pagos, devices, maquinas, vistas, pedidos, liberacoes, orgs, limiteMaq, extras, ass] = await Promise.all([orgsParaCriar(db, conta.id), licencaGravada(db, conta), addonsPagos(db, conta.id), devicesDaConta(db, conta.id), maquinasDaConta(db, conta.id), maquinasVistasDaConta(db, conta.id, agoraIso(Date.now() - LICENCA_VALIDADE_MS)), pedidosAbertos(db, conta.id), liberacoesDaConta(db, conta.id), orgsDaConta(db, conta.id), limiteDeMaquinasComExtras(db, conta.id), extrasPagos(db, conta.id),
    db.prepare("SELECT id, produto, status, valor_centavos FROM assinaturas WHERE conta_id = ?1 ORDER BY criada_em DESC LIMIT 50").bind(conta.id).all<{ id: string; produto: string | null; status: string; valor_centavos: number | null }>()]);
  const limiteDev = limiteComExtras(gravada.deviceLimit, extras.filter((x) => x.tipo === "device"), Date.now(), DEVICE_LIMITE_MAX);
  const licenca = { ...licencaEmVigor(gravada, pagos, admin, catalogo, agoraIso()), deviceLimit: limiteDev.limite };
  const assinaturas: ContaAssinatura[] = ass.results.map((a) => ({ id: a.id, produto: a.produto, status: a.status === "CANCELLED" ? "CANCELLED" : "ACTIVE", valorCentavos: a.valor_centavos, valeAte: a.produto === null ? gravada.expiresAt : tipoDoExtra(a.produto) !== null ? extras.find((x) => x.assinaturaId === a.id)?.expiresAt ?? null : pagos.find((p) => p.produto === a.produto)?.expiresAt ?? null }));
  const ds: DeviceApi[] = devices.map((d) => {
    let apps: DeviceApi["apps"] = {};
    try { const a: unknown = JSON.parse(d.apps); if (a !== null && typeof a === "object") apps = a as DeviceApi["apps"]; } catch { apps = {}; }
    return { id: d.id, alias: d.alias_legado, name: d.name ?? "", user: d.user ?? "", platform: d.platform ?? "", status: d.status === "pending" ? "pending" : "active", requestedAt: d.requested_at, firstSeen: d.first_seen, lastSeen: d.last_seen, apps, este: deviceAtual !== null && (d.id === deviceAtual || d.alias_legado === deviceAtual) };
  });
  return { id: conta.id, email: conta.email, nome: nomeExibicao(conta), nomeLogin: conta.nome, foto: conta.foto, perfil: perfilDaLinha(conta), provedores: parseProvedores(conta.provedores), dadosUso: conta.dados_uso !== 0, admin, licenca, devices: ds, maquinas: maquinas.map(maquinaApi), maquinasVistas: vistas, maquinaLimite: limiteMaq.limite, maquinaExtras: limiteMaq.extras, deviceExtras: limiteDev.extras, pedidos, liberacoes, assinaturas, orgs, orgCriar: { limite: criar.limite, donaDe: criar.donaDe, motivo: podeCriarOrg({ licenca: gravada, papel: admin, donaDe: criar.donaDe, limite: criar.limite, agoraMs: Date.now() })?.motivo ?? null }, promo: await promoDaConta(db, conta, promo, admin, Date.now(), gravada) };
}

// ---- Admin: a visão de todas as contas. `busca` filtra por e-mail ou nome (LIKE, escapado); até 500 contas.
const deviceApi = (d: DeviceLinha): DeviceApi => {
  let apps: DeviceApi["apps"] = {};
  try { const a: unknown = JSON.parse(d.apps); if (a !== null && typeof a === "object") apps = a as DeviceApi["apps"]; } catch { apps = {}; }
  return { id: d.id, alias: d.alias_legado, name: d.name ?? "", user: d.user ?? "", platform: d.platform ?? "", status: d.status === "pending" ? "pending" : "active", requestedAt: d.requested_at, firstSeen: d.first_seen, lastSeen: d.last_seen, apps, este: false };
};
interface PedidoLinha { id: string; conta_id: string; tipo: string; detalhe: string | null; maquina_id: string | null; criado_em: string; atendido_em: string | null; atendido_por: string | null; email: string; nome: string | null }
export async function visaoAdmin(db: D1Database, busca: string, adminInicial: string, catalogo: readonly string[], comVendas = false, agora = agoraIso()): Promise<AdminVisao> {
  const like = `%${busca.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const contas = (await db.prepare("SELECT * FROM contas WHERE apagada_em IS NULL AND (?1 = '' OR email LIKE ?2 ESCAPE '\\' OR nome LIKE ?2 ESCAPE '\\' OR nome_proprio LIKE ?2 ESCAPE '\\' OR sobrenome LIKE ?2 ESCAPE '\\') ORDER BY criada_em DESC LIMIT 500").bind(busca, like).all<ContaLinha>()).results;
  const [licencas, devices, maquinas, pedidosN, admins, pedidos, orgsLinhas] = await Promise.all([
    db.prepare("SELECT * FROM licencas").all<LicencaLinha>(),
    db.prepare("SELECT * FROM devices ORDER BY last_seen DESC").all<DeviceLinha>(),
    db.prepare("SELECT conta_id, COUNT(*) AS n FROM maquinas WHERE conta_id IS NOT NULL GROUP BY conta_id").all<{ conta_id: string; n: number }>(),
    db.prepare("SELECT conta_id, COUNT(*) AS n FROM pedidos WHERE atendido_em IS NULL GROUP BY conta_id").all<{ conta_id: string; n: number }>(),
    db.prepare("SELECT email, papel, criado_em FROM admins ORDER BY criado_em").all<{ email: string; papel: string; criado_em: string }>(),
    db.prepare("SELECT p.*, c.email, c.nome FROM pedidos p JOIN contas c ON c.id = p.conta_id WHERE p.atendido_em IS NULL ORDER BY p.criado_em DESC LIMIT 500").all<PedidoLinha>(),
    db.prepare("SELECT o.id, o.slug, o.nome, o.assentos, o.criada_em, c.email AS dona, (SELECT COUNT(*) FROM membros m WHERE m.org_id = o.id) AS membros FROM organizacoes o JOIN contas c ON c.id = o.dona_conta_id WHERE o.apagada_em IS NULL ORDER BY o.criada_em DESC LIMIT 500").all<{ id: string; slug: string; nome: string; assentos: number; criada_em: string; dona: string; membros: number }>(),
  ]);
  const orgs: AdminOrg[] = orgsLinhas.results.map((o) => ({ id: o.id, slug: o.slug, nome: o.nome, dona: o.dona, membros: o.membros, assentos: o.assentos, criadaEm: o.criada_em }));
  const lic = new Map(licencas.results.map((l) => [l.conta_id, l]));
  const pagosLinhas = (await db.prepare("SELECT conta_id, produto, expires_at FROM addons_pagos").all<{ conta_id: string; produto: string; expires_at: string }>()).results;
  const pagos = new Map<string, { produto: string; expiresAt: string }[]>();
  for (const a of pagosLinhas) { const lista = pagos.get(a.conta_id) ?? []; lista.push({ produto: a.produto, expiresAt: a.expires_at }); pagos.set(a.conta_id, lista); }
  const extrasDe = new Map<string, { assinaturaId: string; tipo: string; expiresAt: string }[]>();
  for (const x of (await db.prepare("SELECT conta_id, assinatura_id, tipo, expires_at FROM extras_pagos ORDER BY expires_at").all<{ conta_id: string; assinatura_id: string; tipo: string; expires_at: string }>()).results) { const lista = extrasDe.get(x.conta_id) ?? []; lista.push({ assinaturaId: x.assinatura_id, tipo: x.tipo, expiresAt: x.expires_at }); extrasDe.set(x.conta_id, lista); }
  const devs = new Map<string, DeviceApi[]>();
  for (const d of devices.results) { const lista = devs.get(d.conta_id) ?? []; lista.push(deviceApi(d)); devs.set(d.conta_id, lista); }
  const maq = new Map(maquinas.results.map((m) => [m.conta_id, m.n]));
  const ped = new Map(pedidosN.results.map((m) => [m.conta_id, m.n]));
  const adm = new Map(admins.results.map((a) => [a.email, a.papel === "super" ? "super" as const : "admin" as const]));
  // A licença de cada conta com a regra do super admin (licencaDoSuper), a mesma do app e do console; os add-ons pagos
  // seguem à parte em `addonsPagos`. De um super admin vai também a gravada, que é o que o editor de licença muda.
  const licencasDe = (c: { id: string; email: string; criada_em: string }): { licenca: License; licencaGravada?: License } => {
    const gravada = licencaDaLinha(lic.get(c.id) ?? null, c.criada_em);
    return adm.get(c.email) === "super" ? { licenca: licencaDoSuper(gravada, catalogo), licencaGravada: gravada } : { licenca: gravada };
  };
  const resumo: AdminContaResumo[] = contas.map((c) => ({ id: c.id, email: c.email, nome: nomeExibicao(c), foto: c.foto, admin: adm.get(c.email) ?? null, criadaEm: c.criada_em, ...licencasDe(c), addonsPagos: pagos.get(c.id) ?? [], extrasPagos: extrasDe.get(c.id) ?? [], devices: devs.get(c.id) ?? [], maquinas: maq.get(c.id) ?? 0, maquinaLimite: limiteValido(lic.get(c.id)?.maquina_limit), orgLimite: limiteValido(lic.get(c.id)?.org_limit), pedidos: ped.get(c.id) ?? 0 }));
  const todas = busca === "" ? resumo : (await db.prepare("SELECT id, email, criada_em FROM contas WHERE apagada_em IS NULL").all<{ id: string; email: string; criada_em: string }>()).results.map((c) => ({ id: c.id, licenca: licencasDe(c).licenca, devices: devs.get(c.id) ?? [] }));
  const totais = { contas: todas.length, pro: todas.filter((c) => c.licenca.plan === "pro").length, devicesPendentes: devices.results.filter((d) => d.status === "pending").length, pedidosAbertos: pedidos.results.length, orgs: orgs.length };
  const emails = new Set((await db.prepare("SELECT email FROM contas WHERE apagada_em IS NULL").all<{ email: string }>()).results.map((c) => c.email));
  const perfis: AdminPerfil[] = admins.results.map((a) => ({ email: a.email, papel: a.papel === "super" ? "super" : "admin", criadoEm: a.criado_em, entrou: emails.has(a.email), fixo: ehAdminInicial(a.email, adminInicial) }));
  return { contas: resumo, perfis, pedidos: pedidos.results.map((p): AdminPedido => ({ id: p.id, tipo: p.tipo, detalhe: p.detalhe, maquinaId: p.maquina_id, criadoEm: p.criado_em, atendidoEm: p.atendido_em, atendidoPor: p.atendido_por, conta: { id: p.conta_id, email: p.email, nome: p.nome } })), orgs, totais, vendas: comVendas ? await vendasAdmin(db, lic, pagos, pedidos.results.filter((p) => p.tipo === "pagamento.revisar").length, agora) : null, listaEspera: comVendas ? await listaEsperaAdmin(db) : null };
}
/** Quem paga o quê (super admin): as assinaturas com o prazo que sustentam, os últimos pagamentos e os totais em dia. */
/** A lista de espera para o super admin: totais e os 200 contatos mais novos. */
async function listaEsperaAdmin(db: D1Database): Promise<AdminListaEspera> {
  const [tot, linhas] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN avisado_em IS NULL THEN 1 ELSE 0 END) AS s FROM lista_espera").first<{ n: number; s: number | null }>(),
    db.prepare("SELECT contato, tipo, plataforma, origem, gclid, criado_em, avisado_em FROM lista_espera ORDER BY criado_em DESC LIMIT 200").all<{ contato: string; tipo: string; plataforma: string; origem: string; gclid: string | null; criado_em: string; avisado_em: string | null }>(),
  ]);
  return { total: tot?.n ?? 0, semAviso: tot?.s ?? 0, contatos: linhas.results.map((l) => ({ contato: l.contato, tipo: l.tipo === "whatsapp" ? "whatsapp" : "email", plataforma: l.plataforma, origem: l.origem, viaAnuncio: l.gclid !== null, criadoEm: l.criado_em, avisadoEm: l.avisado_em })) };
}

/** Quem paga o quê, sem as linhas que o super admin ocultou (`marcarVendaOculta`): elas saem das listas e dos totais e ficam na Auditoria. */
async function vendasAdmin(db: D1Database, lic: Map<string, LicencaLinha>, pagos: Map<string, { produto: string; expiresAt: string }[]>, aRevisar: number, agora: string): Promise<AdminVendas> {
  const [ass, pgs] = await Promise.all([
    db.prepare("SELECT a.id, a.conta_id, a.produto, a.status, a.valor_centavos, a.criada_em, a.atualizada_em, c.email, c.nome, (SELECT MAX(p.pago_em) FROM pagamentos p WHERE p.assinatura_id = a.id) AS ultimo FROM assinaturas a JOIN contas c ON c.id = a.conta_id WHERE a.oculta_em IS NULL ORDER BY a.criada_em DESC LIMIT 500").all<{ id: string; conta_id: string; produto: string | null; status: string; valor_centavos: number | null; criada_em: string; atualizada_em: string; email: string; nome: string | null; ultimo: string | null }>(),
    db.prepare("SELECT p.id, p.conta_id, p.produto, p.valor_centavos, p.evento, p.pago_em, p.ga_enviado_em, c.email, c.nome FROM pagamentos p JOIN contas c ON c.id = p.conta_id WHERE p.oculta_em IS NULL ORDER BY p.pago_em DESC LIMIT 100").all<{ id: string; conta_id: string; produto: string | null; valor_centavos: number; evento: string; pago_em: string; ga_enviado_em: string | null; email: string; nome: string | null }>(),
  ]);
  // Os extras (máquina extra) têm o prazo por assinatura, não por conta e produto.
  const extras = new Map((await db.prepare("SELECT assinatura_id, expires_at FROM extras_pagos").all<{ assinatura_id: string; expires_at: string }>()).results.map((x) => [x.assinatura_id, x.expires_at]));
  const assinaturas: AdminAssinatura[] = ass.results.map((a) => ({
    id: a.id, produto: a.produto, status: a.status === "CANCELLED" ? "CANCELLED" : "ACTIVE", valorCentavos: a.valor_centavos, criadaEm: a.criada_em, atualizadaEm: a.atualizada_em,
    valeAte: a.produto === null ? lic.get(a.conta_id)?.expires_at ?? null : tipoDoExtra(a.produto) !== null ? extras.get(a.id) ?? null : pagos.get(a.conta_id)?.find((p) => p.produto === a.produto)?.expiresAt ?? null,
    ultimoPagamentoEm: a.ultimo, conta: { id: a.conta_id, email: a.email, nome: a.nome },
  }));
  // Em dia = ativa e com prazo no futuro: assinatura que parou de renovar sem avisar não conta como receita.
  const emDia = umaPorContaEProduto(assinaturas.filter((a) => a.status === "ACTIVE" && a.valeAte !== null && Date.parse(a.valeAte) > Date.parse(agora)));
  const addons: Record<string, number> = {};
  for (const a of emDia) if (a.produto !== null) addons[a.produto] = (addons[a.produto] ?? 0) + 1;
  return {
    assinaturas,
    pagamentos: pgs.results.map((p): AdminPagamento => ({ id: p.id, produto: p.produto, valorCentavos: p.valor_centavos, primeira: p.evento === "subscription.completed", pagoEm: p.pago_em, noAnalytics: p.ga_enviado_em !== null, conta: { id: p.conta_id, email: p.email, nome: p.nome } })),
    totais: { proPago: emDia.filter((a) => a.produto === null).length, addons, mensalCentavos: emDia.reduce((s, a) => s + (a.valorCentavos ?? 0), 0), aRevisar },
  };
}
/**
 * O admin encerra agora um add-on pago (reembolso ou disputa): o prazo vira o momento atual e o add-on sai da licença
 * em vigor. A assinatura na AbacatePay não é cancelada aqui: a marca `encerrado_em` faz a cobrança seguinte ir para
 * revisão em vez de devolver o add-on. false se a conta não tem esse add-on em dia.
 */
export async function encerrarAddonPago(db: D1Database, contaId: string, produto: string, agora = agoraIso()): Promise<boolean> {
  const r = await db.prepare("UPDATE addons_pagos SET expires_at = ?3, atualizado_em = ?3, encerrado_em = ?3 WHERE conta_id = ?1 AND produto = ?2 AND expires_at > ?3").bind(contaId, produto, agora).run();
  return (r.meta.changes ?? 0) > 0;
}
/**
 * O admin encerra agora uma unidade extra paga (máquina extra), por reembolso ou disputa: o prazo vira o momento atual
 * e a vaga sai do limite em vigor. Como em `encerrarAddonPago`, a assinatura na AbacatePay não é cancelada aqui: a
 * marca `encerrado_em` faz a cobrança seguinte ir para revisão. false se a conta não tem essa assinatura em dia.
 */
export async function encerrarExtraPago(db: D1Database, contaId: string, assinaturaId: string, agora = agoraIso()): Promise<boolean> {
  const r = await db.prepare("UPDATE extras_pagos SET expires_at = ?3, atualizado_em = ?3, encerrado_em = ?3 WHERE conta_id = ?1 AND assinatura_id = ?2 AND expires_at > ?3").bind(contaId, assinaturaId, agora).run();
  return (r.meta.changes ?? 0) > 0;
}
/** O admin ativa um device pendente; false se o device não existe nessa conta. */
export async function ativarDevice(db: D1Database, contaId: string, deviceId: string): Promise<boolean> {
  const r = await db.prepare("UPDATE devices SET status = 'active' WHERE conta_id = ?1 AND id = ?2").bind(contaId, deviceId).run();
  return (r.meta.changes ?? 0) > 0;
}
/** O admin tira um device da conta e encerra as sessões dele (o app daquele Mac precisa entrar de novo); false se não existe. */
export async function removerDevice(db: D1Database, contaId: string, deviceId: string, agora = agoraIso()): Promise<boolean> {
  // Numa transação só: device removido com sessão ainda válida deixaria o Mac "removido" com acesso.
  const [del] = await db.batch([
    db.prepare("DELETE FROM devices WHERE conta_id = ?1 AND id = ?2").bind(contaId, deviceId),
    db.prepare("UPDATE sessoes SET revogada_em = ?3 WHERE conta_id = ?1 AND device_id = ?2 AND revogada_em IS NULL").bind(contaId, deviceId, agora),
  ]);
  return (del?.meta.changes ?? 0) > 0;
}
/** Marca um pedido como atendido; false se não existe ou já estava atendido. */
export async function atenderPedido(db: D1Database, id: string, quem: string, agora = agoraIso()): Promise<boolean> {
  const r = await db.prepare("UPDATE pedidos SET atendido_em = ?2, atendido_por = ?3 WHERE id = ?1 AND atendido_em IS NULL").bind(id, agora, quem).run();
  return (r.meta.changes ?? 0) > 0;
}
/** O admin muda a licença de uma conta: lê a atual (ou a default), aplica o patch e grava (upsert). Devolve a nova. */
export async function gravarLicenca(db: D1Database, conta: ContaLinha, patch: PatchLicenca, agora = agoraIso()): Promise<License> {
  // Parte da gravada: o formulário do admin mostra a licença em vigor, e um add-on pago que viesse de volta na lista
  // viraria concessão sem prazo. Só fica na lista o que já era concessão ou não está pago em dia.
  const [atual, pagos] = await Promise.all([licencaGravada(db, conta), addonsPagos(db, conta.id)]);
  const emDia = new Set(pagos.filter((p) => Date.parse(p.expiresAt) > Date.parse(agora)).map((p) => p.produto));
  const { maquinaLimit, orgLimit, ...daLicenca } = patch;
  const nova: License = { ...atual, ...daLicenca, updatedAt: agora, updatedBy: "admin" } as License;
  if (patch.produtos !== undefined) nova.produtos = patch.produtos.filter((x) => atual.produtos.includes(x) || !emDia.has(x));
  if (patch.plan === "pro" && patch.status === undefined && atual.status === "free") nova.status = "active";
  if (patch.plan === "free" && patch.status === undefined) nova.status = "free";
  await db.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, trial_end, expires_at, device_limit, produtos, pagamento, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'admin') ON CONFLICT(conta_id) DO UPDATE SET plan = excluded.plan, status = excluded.status, interval = excluded.interval, trial_end = excluded.trial_end, expires_at = excluded.expires_at, device_limit = excluded.device_limit, produtos = excluded.produtos, pagamento = excluded.pagamento, updated_at = excluded.updated_at, updated_by = 'admin'")
    .bind(conta.id, nova.plan, nova.status, nova.interval, nova.memberSince, nova.trialEnd, nova.expiresAt, nova.deviceLimit, JSON.stringify(nova.produtos), nova.pagamento === null ? null : JSON.stringify(nova.pagamento), agora).run();
  // Fora de License (o app e o backend não o leem): é só da conta, como quantas máquinas levam a licença dela.
  if (maquinaLimit !== undefined) await db.prepare("UPDATE licencas SET maquina_limit = ?2 WHERE conta_id = ?1").bind(conta.id, maquinaLimit).run();
  if (orgLimit !== undefined) await db.prepare("UPDATE licencas SET org_limit = ?2 WHERE conta_id = ?1").bind(conta.id, orgLimit).run();
  return nova;
}
/** Conta sem linha de licença (acabou de entrar pela primeira vez) ganha o trial do Pro por `dias`; 0 = fica free. */
export async function iniciarTrialSeNovo(db: D1Database, conta: ContaLinha, dias: number, agora = agoraIso()): Promise<boolean> {
  if (!(dias > 0)) return false;
  const tem = await db.prepare("SELECT conta_id FROM licencas WHERE conta_id = ?1").bind(conta.id).first();
  if (tem !== null && tem !== undefined) return false;
  const fim = new Date(Date.parse(agora) + dias * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("INSERT OR IGNORE INTO licencas (conta_id, plan, status, interval, member_since, trial_end, expires_at, device_limit, produtos, pagamento, updated_at, updated_by) VALUES (?1, 'pro', 'trialing', NULL, ?2, ?3, ?3, ?4, '[]', NULL, ?2, 'system')").bind(conta.id, agora, fim, DEVICES_INCLUSOS).run();
  return true;
}
/** Perfis de acesso (só o super admin mexe): grava/atualiza um admin; remove. Regras de "último super" ficam na rota. */
export async function gravarPerfil(db: D1Database, email: string, papel: "super" | "admin", agora = agoraIso()): Promise<void> {
  await db.prepare("INSERT INTO admins (email, papel, criado_em) VALUES (?1, ?2, ?3) ON CONFLICT(email) DO UPDATE SET papel = excluded.papel").bind(email, papel, agora).run();
}
export async function removerPerfil(db: D1Database, email: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM admins WHERE email = ?1").bind(email).run();
  return (r.meta.changes ?? 0) > 0;
}
export async function contarSupers(db: D1Database): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM admins WHERE papel = 'super'").first<{ n: number }>())?.n ?? 0;
}

// ---- Organizações (molde Rambox Enterprise). Membro = (org, e-mail); o convite é a linha sem conta_id.
const papelOrg = (p: string): PapelOrg => (p === "dona" || p === "admin" ? p : "membro");
export async function orgPorSlug(db: D1Database, slug: string): Promise<OrgLinha | null> {
  return (await db.prepare("SELECT * FROM organizacoes WHERE slug = ?1 AND apagada_em IS NULL").bind(slug).first<OrgLinha>()) ?? null;
}
/** Cria a organização com a criadora como dona (membro ativo). false = slug já em uso. */
export async function criarOrg(db: D1Database, conta: ContaLinha, nova: { nome: string; slug: string }, agora = agoraIso()): Promise<OrgLinha | null> {
  const id = uuid();
  try {
    await db.batch([
      db.prepare("INSERT INTO organizacoes (id, slug, nome, dona_conta_id, dominio_email, assentos, criada_em, atualizada_em) VALUES (?1, ?2, ?3, ?4, NULL, 5, ?5, ?5)").bind(id, nova.slug, nova.nome, conta.id, agora),
      db.prepare("INSERT INTO membros (org_id, email, conta_id, papel, status, convidado_por, convidado_em, entrou_em) VALUES (?1, ?2, ?3, 'dona', 'ativo', NULL, ?4, ?4)").bind(id, conta.email, conta.id, agora),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(e instanceof Error ? e.message : String(e))) return null;
    throw e;
  }
  return orgPorSlug(db, nova.slug);
}
/** As organizações de que a conta é membro, com o papel dela e a ocupação. */
export async function orgsDaConta(db: D1Database, contaId: string): Promise<OrgResumo[]> {
  const r = await db.prepare("SELECT o.id, o.slug, o.nome, o.assentos, m.papel, (SELECT COUNT(*) FROM membros x WHERE x.org_id = o.id) AS membros FROM membros m JOIN organizacoes o ON o.id = m.org_id WHERE m.conta_id = ?1 AND o.apagada_em IS NULL ORDER BY o.criada_em").bind(contaId).all<{ id: string; slug: string; nome: string; assentos: number; papel: string; membros: number }>();
  return r.results.map((o) => ({ id: o.id, slug: o.slug, nome: o.nome, papel: papelOrg(o.papel), membros: o.membros, assentos: o.assentos }));
}
export async function membroPor(db: D1Database, orgId: string, email: string): Promise<MembroLinha | null> {
  return (await db.prepare("SELECT * FROM membros WHERE org_id = ?1 AND email = ?2").bind(orgId, email).first<MembroLinha>()) ?? null;
}
export async function contarMembros(db: D1Database, orgId: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM membros WHERE org_id = ?1").bind(orgId).first<{ n: number }>())?.n ?? 0;
}
export async function contarDonas(db: D1Database, orgId: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM membros WHERE org_id = ?1 AND papel = 'dona'").bind(orgId).first<{ n: number }>())?.n ?? 0;
}
/** A organização inteira como o console a mostra: membros (com nome e foto de quem já tem conta), dona, ocupação. */
export async function montarOrgApi(db: D1Database, org: OrgLinha, meuEmail: string, meuPapel: PapelOrg | "super", consoleOrigin: string): Promise<OrgApi> {
  const [membros, dona] = await Promise.all([
    db.prepare("SELECT m.*, c.nome, c.nome_proprio, c.sobrenome, c.foto FROM membros m LEFT JOIN contas c ON c.id = m.conta_id WHERE m.org_id = ?1 ORDER BY CASE m.papel WHEN 'dona' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.convidado_em").bind(org.id).all<MembroLinha & { nome: string | null; nome_proprio: string | null; sobrenome: string | null; foto: string | null }>(),
    db.prepare("SELECT email, nome, nome_proprio, sobrenome FROM contas WHERE id = ?1").bind(org.dona_conta_id).first<{ email: string; nome: string | null; nome_proprio: string | null; sobrenome: string | null }>(),
  ]);
  const lista: MembroApi[] = membros.results.map((m) => ({ email: m.email, nome: m.conta_id === null ? null : nomeExibicao(m), foto: m.foto, papel: papelOrg(m.papel), status: m.status === "ativo" ? "ativo" : "convidado", convidadoPor: m.convidado_por, convidadoEm: m.convidado_em, entrouEm: m.entrou_em, eu: m.email === meuEmail }));
  return { id: org.id, slug: org.slug, nome: org.nome, dominioEmail: org.dominio_email, assentos: org.assentos, ocupados: lista.length, criadaEm: org.criada_em, dona: { email: dona?.email ?? "", nome: dona ? nomeExibicao(dona) : null }, meuPapel, membros: lista, url: `${consoleOrigin}/organizations/${org.slug}/members` };
}
/** A conta pelo e-mail exato (já normalizado: minúsculo, sem espaços). */
export async function contaPorEmail(db: D1Database, email: string): Promise<ContaLinha | null> {
  return (await db.prepare("SELECT * FROM contas WHERE email = ?1 AND apagada_em IS NULL").bind(email).first<ContaLinha>()) ?? null;
}
/** Convida (linha sem conta) ou já ativa, se o e-mail tem conta. */
export async function gravarConvite(db: D1Database, org: OrgLinha, email: string, papel: "admin" | "membro", quem: string, agora = agoraIso()): Promise<"convidado" | "ativo"> {
  const conta = await contaPorEmail(db, email);
  const status = conta === null ? "convidado" : "ativo";
  await db.prepare("INSERT INTO membros (org_id, email, conta_id, papel, status, convidado_por, convidado_em, entrou_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").bind(org.id, email, conta?.id ?? null, papel, status, quem, agora, conta === null ? null : agora).run();
  return status;
}
export async function mudarPapel(db: D1Database, orgId: string, email: string, papel: PapelOrg): Promise<void> {
  await db.prepare("UPDATE membros SET papel = ?3 WHERE org_id = ?1 AND email = ?2").bind(orgId, email, papel).run();
}
export async function removerMembro(db: D1Database, orgId: string, email: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM membros WHERE org_id = ?1 AND email = ?2").bind(orgId, email).run();
  return (r.meta.changes ?? 0) > 0;
}
/** No login: os convites para este e-mail viram membros ativos desta conta. */
export async function aceitarConvites(db: D1Database, conta: ContaLinha, agora = agoraIso()): Promise<number> {
  const r = await db.prepare("UPDATE membros SET conta_id = ?2, status = 'ativo', entrou_em = ?3 WHERE email = ?1 AND conta_id IS NULL").bind(conta.email, conta.id, agora).run();
  return r.meta.changes ?? 0;
}
export async function gravarOrg(db: D1Database, org: OrgLinha, patch: PatchOrg, agora = agoraIso()): Promise<OrgLinha> {
  const nome = patch.nome ?? org.nome, dominio = patch.dominioEmail === undefined ? org.dominio_email : patch.dominioEmail;
  await db.prepare("UPDATE organizacoes SET nome = ?2, dominio_email = ?3, atualizada_em = ?4 WHERE id = ?1").bind(org.id, nome, dominio, agora).run();
  return { ...org, nome, dominio_email: dominio, atualizada_em: agora };
}
export async function gravarAssentos(db: D1Database, org: OrgLinha, assentos: number, agora = agoraIso()): Promise<void> {
  await db.prepare("UPDATE organizacoes SET assentos = ?2, atualizada_em = ?3 WHERE id = ?1").bind(org.id, assentos, agora).run();
}
/** Soft delete: o slug fica reservado (renomeado para continuar único) e os membros saem. */
export async function apagarOrg(db: D1Database, org: OrgLinha, agora = agoraIso()): Promise<void> {
  await db.batch([
    db.prepare("UPDATE organizacoes SET apagada_em = ?2, slug = ?3, atualizada_em = ?2 WHERE id = ?1").bind(org.id, agora, `apagada:${org.id}:${org.slug}`),
    db.prepare("DELETE FROM membros WHERE org_id = ?1").bind(org.id),
  ]);
}
