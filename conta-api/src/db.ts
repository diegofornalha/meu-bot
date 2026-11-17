/** Acesso ao D1: consultas tipadas, uma função por intenção. O que sai do banco é dado; quem decide é a rota. */
import type { AdminAssinatura, AdminContaResumo, ContaAssinatura, AdminOrg, AdminPagamento, AdminVendas, AdminPedido, AdminPerfil, AdminVisao, CodigoLinha, ContaApi, ContaLinha, DeviceApi, DeviceLinha, License, LicencaLinha, MaquinaLinha, MembroApi, MembroLinha, OrgApi, OrgLinha, OrgResumo, PapelOrg, PerfilApi, SessaoLinha } from "./tipos.js";
import { agoraIso, nomeExibicao, parseProvedores, provedoresDoLogin, unirProvedores, uuid, type MetodoLogin, type PatchLicenca, type PatchOrg, type PatchPerfil } from "./sessao-core.js";
import type { UsuarioFirebase } from "./firebase.js";
import { licencaComAddons, umaPorContaEProduto } from "./pagamento-core.js";

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
  if (email === bootstrap.trim().toLowerCase()) {
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

const defaultLicense = (memberSince: string): License => ({ plan: "free", status: "free", interval: null, memberSince, trialEnd: null, expiresAt: null, deviceLimit: 1, produtos: [], pagamento: null, updatedAt: memberSince, updatedBy: "system" });
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
    deviceLimit: Number.isInteger(l.device_limit) && l.device_limit >= 1 ? l.device_limit : 1,
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
/** A licença em vigor, que o app e o console recebem: a gravada mais os add-ons pagos em dia (licencaComAddons). */
export async function licencaDaConta(db: D1Database, conta: ContaLinha, agora = agoraIso()): Promise<License> {
  const [l, pagos] = await Promise.all([licencaGravada(db, conta), addonsPagos(db, conta.id)]);
  return licencaComAddons(l, pagos, agora);
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

/** A conta como o app a vê: licença, devices (com "este"), máquinas, pedidos e o papel de admin. */
export async function montarContaApi(db: D1Database, conta: ContaLinha, admin: "super" | "admin" | null, deviceAtual: string | null): Promise<ContaApi> {
  const [gravada, pagos, devices, maquinas, pedidos, orgs, ass] = await Promise.all([licencaGravada(db, conta), addonsPagos(db, conta.id), devicesDaConta(db, conta.id), maquinasDaConta(db, conta.id), pedidosAbertos(db, conta.id), orgsDaConta(db, conta.id),
    db.prepare("SELECT id, produto, status, valor_centavos FROM assinaturas WHERE conta_id = ?1 ORDER BY criada_em DESC LIMIT 50").bind(conta.id).all<{ id: string; produto: string | null; status: string; valor_centavos: number | null }>()]);
  const licenca = licencaComAddons(gravada, pagos, agoraIso());
  const assinaturas: ContaAssinatura[] = ass.results.map((a) => ({ id: a.id, produto: a.produto, status: a.status === "CANCELLED" ? "CANCELLED" : "ACTIVE", valorCentavos: a.valor_centavos, valeAte: a.produto === null ? gravada.expiresAt : pagos.find((p) => p.produto === a.produto)?.expiresAt ?? null }));
  const ds: DeviceApi[] = devices.map((d) => {
    let apps: DeviceApi["apps"] = {};
    try { const a: unknown = JSON.parse(d.apps); if (a !== null && typeof a === "object") apps = a as DeviceApi["apps"]; } catch { apps = {}; }
    return { id: d.id, alias: d.alias_legado, name: d.name ?? "", user: d.user ?? "", platform: d.platform ?? "", status: d.status === "pending" ? "pending" : "active", requestedAt: d.requested_at, firstSeen: d.first_seen, lastSeen: d.last_seen, apps, este: deviceAtual !== null && (d.id === deviceAtual || d.alias_legado === deviceAtual) };
  });
  return { id: conta.id, email: conta.email, nome: nomeExibicao(conta), nomeLogin: conta.nome, foto: conta.foto, perfil: perfilDaLinha(conta), provedores: parseProvedores(conta.provedores), dadosUso: conta.dados_uso !== 0, admin, licenca, devices: ds, maquinas: maquinas.map((m) => ({ id: m.id, apelido: m.apelido, vinculadaPor: m.vinculada_por })), pedidos, assinaturas, orgs };
}

// ---- Admin: a visão de todas as contas. `busca` filtra por e-mail ou nome (LIKE, escapado); até 500 contas.
const deviceApi = (d: DeviceLinha): DeviceApi => {
  let apps: DeviceApi["apps"] = {};
  try { const a: unknown = JSON.parse(d.apps); if (a !== null && typeof a === "object") apps = a as DeviceApi["apps"]; } catch { apps = {}; }
  return { id: d.id, alias: d.alias_legado, name: d.name ?? "", user: d.user ?? "", platform: d.platform ?? "", status: d.status === "pending" ? "pending" : "active", requestedAt: d.requested_at, firstSeen: d.first_seen, lastSeen: d.last_seen, apps, este: false };
};
interface PedidoLinha { id: string; conta_id: string; tipo: string; detalhe: string | null; maquina_id: string | null; criado_em: string; atendido_em: string | null; atendido_por: string | null; email: string; nome: string | null }
export async function visaoAdmin(db: D1Database, busca: string, comVendas = false, agora = agoraIso()): Promise<AdminVisao> {
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
  const devs = new Map<string, DeviceApi[]>();
  for (const d of devices.results) { const lista = devs.get(d.conta_id) ?? []; lista.push(deviceApi(d)); devs.set(d.conta_id, lista); }
  const maq = new Map(maquinas.results.map((m) => [m.conta_id, m.n]));
  const ped = new Map(pedidosN.results.map((m) => [m.conta_id, m.n]));
  const adm = new Map(admins.results.map((a) => [a.email, a.papel === "super" ? "super" as const : "admin" as const]));
  const resumo: AdminContaResumo[] = contas.map((c) => ({ id: c.id, email: c.email, nome: nomeExibicao(c), foto: c.foto, admin: adm.get(c.email) ?? null, criadaEm: c.criada_em, licenca: licencaDaLinha(lic.get(c.id) ?? null, c.criada_em), addonsPagos: pagos.get(c.id) ?? [], devices: devs.get(c.id) ?? [], maquinas: maq.get(c.id) ?? 0, pedidos: ped.get(c.id) ?? 0 }));
  const todas = busca === "" ? resumo : (await db.prepare("SELECT id, criada_em FROM contas WHERE apagada_em IS NULL").all<{ id: string; criada_em: string }>()).results.map((c) => ({ id: c.id, licenca: licencaDaLinha(lic.get(c.id) ?? null, c.criada_em), devices: devs.get(c.id) ?? [] }));
  const totais = { contas: todas.length, pro: todas.filter((c) => c.licenca.plan === "pro").length, devicesPendentes: devices.results.filter((d) => d.status === "pending").length, pedidosAbertos: pedidos.results.length, orgs: orgs.length };
  const emails = new Set((await db.prepare("SELECT email FROM contas WHERE apagada_em IS NULL").all<{ email: string }>()).results.map((c) => c.email));
  const perfis: AdminPerfil[] = admins.results.map((a) => ({ email: a.email, papel: a.papel === "super" ? "super" : "admin", criadoEm: a.criado_em, entrou: emails.has(a.email) }));
  return { contas: resumo, perfis, pedidos: pedidos.results.map((p): AdminPedido => ({ id: p.id, tipo: p.tipo, detalhe: p.detalhe, maquinaId: p.maquina_id, criadoEm: p.criado_em, atendidoEm: p.atendido_em, atendidoPor: p.atendido_por, conta: { id: p.conta_id, email: p.email, nome: p.nome } })), orgs, totais, vendas: comVendas ? await vendasAdmin(db, lic, pagos, pedidos.results.filter((p) => p.tipo === "pagamento.revisar").length, agora) : null };
}
/** Quem paga o quê (super admin): as assinaturas com o prazo que sustentam, os últimos pagamentos e os totais em dia. */
async function vendasAdmin(db: D1Database, lic: Map<string, LicencaLinha>, pagos: Map<string, { produto: string; expiresAt: string }[]>, aRevisar: number, agora: string): Promise<AdminVendas> {
  const [ass, pgs] = await Promise.all([
    db.prepare("SELECT a.id, a.conta_id, a.produto, a.status, a.valor_centavos, a.criada_em, a.atualizada_em, c.email, c.nome, (SELECT MAX(p.pago_em) FROM pagamentos p WHERE p.assinatura_id = a.id) AS ultimo FROM assinaturas a JOIN contas c ON c.id = a.conta_id ORDER BY a.criada_em DESC LIMIT 500").all<{ id: string; conta_id: string; produto: string | null; status: string; valor_centavos: number | null; criada_em: string; atualizada_em: string; email: string; nome: string | null; ultimo: string | null }>(),
    db.prepare("SELECT p.id, p.conta_id, p.produto, p.valor_centavos, p.evento, p.pago_em, p.ga_enviado_em, c.email, c.nome FROM pagamentos p JOIN contas c ON c.id = p.conta_id ORDER BY p.pago_em DESC LIMIT 100").all<{ id: string; conta_id: string; produto: string | null; valor_centavos: number; evento: string; pago_em: string; ga_enviado_em: string | null; email: string; nome: string | null }>(),
  ]);
  const assinaturas: AdminAssinatura[] = ass.results.map((a) => ({
    id: a.id, produto: a.produto, status: a.status === "CANCELLED" ? "CANCELLED" : "ACTIVE", valorCentavos: a.valor_centavos, criadaEm: a.criada_em, atualizadaEm: a.atualizada_em,
    valeAte: a.produto === null ? lic.get(a.conta_id)?.expires_at ?? null : pagos.get(a.conta_id)?.find((p) => p.produto === a.produto)?.expiresAt ?? null,
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
  const nova: License = { ...atual, ...patch, updatedAt: agora, updatedBy: "admin" } as License;
  if (patch.produtos !== undefined) nova.produtos = patch.produtos.filter((x) => atual.produtos.includes(x) || !emDia.has(x));
  if (patch.plan === "pro" && patch.status === undefined && atual.status === "free") nova.status = "active";
  if (patch.plan === "free" && patch.status === undefined) nova.status = "free";
  await db.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, trial_end, expires_at, device_limit, produtos, pagamento, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'admin') ON CONFLICT(conta_id) DO UPDATE SET plan = excluded.plan, status = excluded.status, interval = excluded.interval, trial_end = excluded.trial_end, expires_at = excluded.expires_at, device_limit = excluded.device_limit, produtos = excluded.produtos, pagamento = excluded.pagamento, updated_at = excluded.updated_at, updated_by = 'admin'")
    .bind(conta.id, nova.plan, nova.status, nova.interval, nova.memberSince, nova.trialEnd, nova.expiresAt, nova.deviceLimit, JSON.stringify(nova.produtos), nova.pagamento === null ? null : JSON.stringify(nova.pagamento), agora).run();
  return nova;
}
/** Conta sem linha de licença (acabou de entrar pela primeira vez) ganha o trial do Pro por `dias`; 0 = fica free. */
export async function iniciarTrialSeNovo(db: D1Database, conta: ContaLinha, dias: number, agora = agoraIso()): Promise<boolean> {
  if (!(dias > 0)) return false;
  const tem = await db.prepare("SELECT conta_id FROM licencas WHERE conta_id = ?1").bind(conta.id).first();
  if (tem !== null && tem !== undefined) return false;
  const fim = new Date(Date.parse(agora) + dias * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("INSERT OR IGNORE INTO licencas (conta_id, plan, status, interval, member_since, trial_end, expires_at, device_limit, produtos, pagamento, updated_at, updated_by) VALUES (?1, 'pro', 'trialing', NULL, ?2, ?3, ?3, 1, '[]', NULL, ?2, 'system')").bind(conta.id, agora, fim).run();
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
/** Convida (linha sem conta) ou já ativa, se o e-mail tem conta. */
export async function gravarConvite(db: D1Database, org: OrgLinha, email: string, papel: "admin" | "membro", quem: string, agora = agoraIso()): Promise<"convidado" | "ativo"> {
  const conta = (await db.prepare("SELECT id FROM contas WHERE email = ?1 AND apagada_em IS NULL").bind(email).first<{ id: string }>()) ?? null;
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
