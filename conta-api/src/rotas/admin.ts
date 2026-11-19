/**
 * Rotas do admin (Bearer com `adm`): `GET /admin/visao?busca=` (todas as contas, com licença, devices e máquinas; os
 * pedidos abertos; os totais), `PATCH /admin/contas/:id/licenca` (plano, status, prazo, limite de devices, add-ons,
 * pagamento, limite de máquinas), `DELETE /admin/contas/:id` (só super) e `POST /admin/pedidos/:id/atender`. Vincular máquina é da própria pessoa
 * (rotas/maquinas.ts); o admin só ATRIBUI uma máquina a uma conta (`POST|DELETE /admin/maquinas/:id/conta {email}`),
 * para ela aparecer no console da pessoa como "licença do admin": não emite licença nem ocupa vaga. Tudo fica na auditoria.
 */
import type { Env, TipoVenda } from "../tipos.js";
import { apagarConta, atribuirMaquina, desatribuirMaquina, contaAtribuidaDaMaquina, limiteDeDevicesComExtras, contaPorEmail, maquinaPorId, montarContaApi, assinaturasOcultas, ativarDevice, atenderPedido, auditoriaAdmin, zerarAuditoria, marcarVendaOculta, papelAdmin, encerrarAddonPago, encerrarExtraPago, auditar, contaPorId, contarSupers, devicesDaConta, gravarLicenca, licencaGravada, removerDevice, gravarPerfil, gravarProvedor, removerPerfil, revogarSessoesDaConta, visaoAdmin } from "../db.js";
import { consultarFirebase, definirSenhaFirebase } from "../firebase-admin.js";
import { DEVICE_ID_RE, UUID_RE, decidirLiberarDevice, ehAdminInicial, validaBusca, validaEmail, validaPapel, validaPatchLicenca, validaSenhaNova } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";
import { assinaturaIdValido } from "../pagamento-core.js";
import { validaApelido } from "../licenca-core.js";
import { enviarEmailSenha, impedimentosDeApagar } from "./conta.js";
import { cancelarNaAbacate, catalogoAddons, pagamentosLigados } from "./pagamentos.js";
import { limiteDoPapel } from "../pagamento-core.js";

export async function getAdminVisao(auth: Autenticado, env: Env, url: URL): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  return json(await visaoAdmin(env.DB, validaBusca(url.searchParams.get("busca")), env.ADMIN_BOOTSTRAP_EMAIL, catalogoAddons(env), auth.claims.adm === "super"));
}
/**
 * `GET /admin/conta?maquina=<uuid>&id=<conta>&email=<e-mail>`: UMA conta, como o console a mostra à própria pessoa
 * (`montarContaApi`: licença em vigor, devices, máquinas, limites com extras, pedidos). É o que o meu-bot-admin-gestao
 * lê para a página Suporte de uma pessoa. As pistas valem nesta ordem de confiança, e `achadaPor` diz qual achou:
 * a máquina vinculada (o uuid do maquina.json dela), o id da conta, o e-mail exato. Pista fora do formato é ignorada;
 * sem nenhuma válida, 400; nenhuma achou, 404 com `semConta` (para o app não confundir com a rota ainda não publicada).
 */
export async function getAdminConta(auth: Autenticado, env: Env, url: URL): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  const p = url.searchParams;
  const maquina = UUID_RE.test(p.get("maquina") ?? "") ? p.get("maquina")! : null;
  const id = UUID_RE.test(p.get("id") ?? "") ? p.get("id")! : null;
  const email = validaEmail(p.get("email"));
  if (maquina === null && id === null && email === null) return json({ erro: "informe maquina, id ou email" }, 400);
  let achada: { conta: NonNullable<Awaited<ReturnType<typeof contaPorId>>>; por: "maquina" | "id" | "email" } | null = null;
  let atribuida = false;
  if (maquina !== null) {
    const m = await maquinaPorId(env.DB, maquina);
    // Vinculada (usa a licença da conta) vale primeiro; senão, a conta a que o admin atribuiu a máquina.
    const dona = m !== null && m.conta_id !== null ? m.conta_id : await contaAtribuidaDaMaquina(env.DB, maquina);
    const c = dona === null ? null : await contaPorId(env.DB, dona);
    if (c !== null) { achada = { conta: c, por: "maquina" }; atribuida = !(m !== null && m.conta_id !== null); }
  }
  if (achada === null && id !== null) { const c = await contaPorId(env.DB, id); if (c !== null) achada = { conta: c, por: "id" }; }
  if (achada === null && email !== null) { const c = await contaPorEmail(env.DB, email); if (c !== null) achada = { conta: c, por: "email" }; }
  if (achada === null) return json({ erro: "nenhuma conta com essas pistas", semConta: true }, 404);
  const papel = await papelAdmin(env.DB, achada.conta.email, env.ADMIN_BOOTSTRAP_EMAIL);
  return json({ achadaPor: achada.por, ...(atribuida ? { atribuida: true } : {}), conta: await montarContaApi(env.DB, achada.conta, papel, catalogoAddons(env), null) });
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
/**
 * `POST /admin/contas/:id/devices/:device/liberar`: ativa um device pendente. Conta no limite responde 409 com
 * `noLimite`; com `{subirLimite: true}` o limite sobe o bastante para caber este device, na mesma ação.
 */
export async function postLiberarDevice(auth: Autenticado, env: Env, id: string, deviceId: string, req: Request): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id) || !DEVICE_ID_RE.test(deviceId)) return json({ erro: "id da conta ou do device fora do formato" }, 400);
  const conta = await contaPorId(env.DB, id);
  if (conta === null) return json({ erro: "conta não existe" }, 404);
  const corpo = (await lerJson(req)) as Record<string, unknown> | null;
  const [devices, vigor, papel] = await Promise.all([devicesDaConta(env.DB, conta.id), limiteDeDevicesComExtras(env.DB, conta), papelAdmin(env.DB, conta.email, env.ADMIN_BOOTSTRAP_EMAIL)]);
  const device = devices.find((d) => d.id === deviceId);
  if (device === undefined) return json({ erro: "device não existe nesta conta" }, 404);
  // O limite que vale é o gravado mais os devices extras pagos em dia; ao subir, grava-se só a parte do admin.
  const d = decidirLiberarDevice(device.status, devices.filter((x) => x.status !== "pending").length, limiteDoPapel(vigor.limite, papel), corpo?.subirLimite === true);
  if ("erro" in d) return json({ erro: d.erro, noLimite: true }, 409);
  if (d.acao === "ja-ativo") return json({ ok: true, deviceLimit: vigor.limite });
  // Ativa antes de subir o limite: se o device sumiu no meio (removido por outro admin), o limite não muda à toa.
  if (!(await ativarDevice(env.DB, conta.id, deviceId))) return json({ erro: "device não existe nesta conta" }, 404);
  if (d.novoLimite !== null) await gravarLicenca(env.DB, conta, { deviceLimit: d.novoLimite - vigor.extras });
  await auditar(env.DB, auth.conta.email, "device.liberado", conta.id, `${deviceId}${d.novoLimite !== null ? ` · limite ${vigor.limite} → ${d.novoLimite}` : ""}`);
  return json({ ok: true, deviceLimit: d.novoLimite ?? vigor.limite });
}
/** `POST /admin/contas/:id/addons/:produto/encerrar`: encerra agora um add-on pago (reembolso ou disputa). */
export async function postEncerrarAddon(auth: Autenticado, env: Env, id: string, produto: string): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id) || !/^meu-bot-[a-z0-9-]{1,30}$/.test(produto)) return json({ erro: "id da conta ou nome do add-on fora do formato" }, 400);
  if (!(await encerrarAddonPago(env.DB, id, produto))) return json({ erro: "esta conta não tem esse add-on pago em dia" }, 404);
  await auditar(env.DB, auth.conta.email, "addon.encerrado", id, produto);
  return json({ ok: true });
}
/** `POST /admin/contas/:id/extras/:assinatura/encerrar`: encerra agora uma unidade extra paga, máquina ou device (reembolso ou disputa); a vaga sai do limite da conta. */
export async function postEncerrarExtra(auth: Autenticado, env: Env, id: string, assinatura: string): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id) || !assinaturaIdValido(assinatura)) return json({ erro: "id da conta ou da assinatura fora do formato" }, 400);
  if (!(await encerrarExtraPago(env.DB, id, assinatura))) return json({ erro: "esta conta não tem esse extra pago em dia" }, 404);
  await auditar(env.DB, auth.conta.email, "extra.encerrado", id, assinatura);
  return json({ ok: true });
}
/** `DELETE /admin/contas/:id/devices/:device`: tira o device da conta (abre a vaga) e encerra as sessões dele. */
export async function deleteDevice(auth: Autenticado, env: Env, id: string, deviceId: string): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id) || !DEVICE_ID_RE.test(deviceId)) return json({ erro: "id da conta ou do device fora do formato" }, 400);
  if (!(await removerDevice(env.DB, id, deviceId))) return json({ erro: "device não existe nesta conta" }, 404);
  await auditar(env.DB, auth.conta.email, "device.removido", id, deviceId);
  return json({ ok: true });
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
/**
 * `DELETE /admin/contas/:id`: o super admin apaga a conta de qualquer pessoa. É o mesmo "Apagar conta" do perfil
 * (`apagarConta`: a conta some das telas e a pessoa sai de todos os Macs; licença, pagamentos, pedidos e auditoria
 * ficam), com os mesmos impedimentos: quem tem perfil de acesso perde o perfil antes, e dona de organização passa a
 * organização antes. O e-mail de quem foi apagado vai no detalhe da auditoria.
 */
export async function deleteAdminConta(auth: Autenticado, env: Env, id: string): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só o super admin apaga a conta de alguém" }, 403);
  if (!UUID_RE.test(id)) return json({ erro: "id da conta fora do formato" }, 400);
  const conta = await contaPorId(env.DB, id);
  if (conta === null) return json({ erro: "conta não existe" }, 404);
  const { admin, donaDe } = await impedimentosDeApagar(env, conta);
  if (admin) return json({ erro: `${conta.email} tem perfil de acesso: remova o perfil (Perfis de acesso) antes de apagar a conta` }, 403);
  if (donaDe.length > 0) return json({ erro: `${conta.email} é dona de ${donaDe.join(", ")}: promova outra dona ou apague a organização antes` }, 403);
  await apagarConta(env.DB, conta);
  await auditar(env.DB, auth.conta.email, "conta.apagada", conta.id, `pelo super admin; era ${conta.email}`);
  return json({ ok: true });
}
/** `GET /admin/auditoria`: as contas apagadas e as últimas ações registradas, só para o super admin (console › Auditoria). */
export async function getAdminAuditoria(auth: Autenticado, env: Env): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só o super admin" }, 403);
  return json(await auditoriaAdmin(env.DB));
}
/**
 * `POST /admin/auditoria/zerar` (super admin, só no staging): zera a tela Auditoria para recomeçar do zero depois de
 * uma rodada de testes. Cancela na AbacatePay a cobrança de cada assinatura oculta ainda ativa e apaga o que a tela
 * mostra (`zerarAuditoria`). A assinatura que a AbacatePay não confirmou que parou de cobrar fica, com os pagamentos
 * dela, e a resposta diz quantas foram. Sobra uma linha no registro: quem zerou e o que saiu.
 * Em produção responde 403: lá o registro é o rastro das vendas e das contas de verdade.
 */
export async function postZerarAuditoria(auth: Autenticado, env: Env): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só o super admin" }, 403);
  if (env.CANAL !== "staging") return json({ erro: "zerar a auditoria só existe no staging" }, 403);
  const semCobranca: string[] = []; let naoCanceladas = 0;
  for (const a of await assinaturasOcultas(env.DB)) {
    if (a.status === "CANCELLED") { semCobranca.push(a.id); continue; }
    const res = pagamentosLigados(env) ? await cancelarNaAbacate(env, a.id) : "erro";
    if (res === "cancelada" || res === "ja-cancelada") semCobranca.push(a.id); else naoCanceladas++;
  }
  const z = await zerarAuditoria(env.DB, semCobranca);
  await auditar(env.DB, auth.conta.email, "auditoria.zerada", auth.conta.id, `${z.registro} ação(ões), ${z.assinaturas} assinatura(s), ${z.pagamentos} pagamento(s) e ${z.contas} conta(s) apagada(s) saíram${naoCanceladas > 0 ? `; ${naoCanceladas} assinatura(s) ficaram: a AbacatePay não confirmou o cancelamento` : ""}`);
  return json({ ok: true, ...z, naoCanceladas });
}
/**
 * `POST /admin/vendas/(assinaturas|pagamentos)/:id/(ocultar|mostrar)`: o super admin tira uma linha da tela
 * Assinaturas ou a traz de volta. Só visualização (`marcarVendaOculta`); as duas ações ficam na auditoria.
 */
export async function postVendaOculta(auth: Autenticado, env: Env, tipo: TipoVenda, id: string, ocultar: boolean): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só o super admin" }, 403);
  const r = await marcarVendaOculta(env.DB, tipo, id, ocultar ? auth.conta.email : null);
  if (r === null) return json({ erro: ocultar ? "não existe ou já está oculta" : "não existe ou não está oculta" }, 404);
  await auditar(env.DB, auth.conta.email, ocultar ? "venda.ocultada" : "venda.mostrada", r.contaId, `${tipo} ${id}`);
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
  if (ehAdminInicial(email, env.ADMIN_BOOTSTRAP_EMAIL) && papel !== "super") return json({ erro: "o admin inicial é sempre super admin; não dá para rebaixar" }, 403);
  await gravarPerfil(env.DB, email, papel);
  await auditar(env.DB, auth.conta.email, "perfil.gravado", auth.conta.id, `${email} = ${papel}`);
  return json({ ok: true });
}
export async function deletePerfil(auth: Autenticado, env: Env, emailRaw: string): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só o super admin muda perfis de acesso" }, 403);
  const email = validaEmail(decodeURIComponent(emailRaw));
  if (email === null) return json({ erro: "e-mail fora do formato" }, 400);
  if (email === auth.conta.email) return json({ erro: "você não pode remover o próprio acesso" }, 400);
  if (ehAdminInicial(email, env.ADMIN_BOOTSTRAP_EMAIL)) return json({ erro: "o admin inicial não pode ser removido" }, 403);
  if (!(await removerPerfil(env.DB, email))) return json({ erro: "esse e-mail não é admin" }, 404);
  if ((await contarSupers(env.DB)) === 0) { await gravarPerfil(env.DB, email, "super"); return json({ erro: "era o último super admin; não removido" }, 400); }
  await auditar(env.DB, auth.conta.email, "perfil.removido", auth.conta.id, email);
  return json({ ok: true });
}

/** `POST /admin/maquinas/:id/conta {email, apelido}`: a máquina passa a aparecer no console da conta desse e-mail. */
export async function postAtribuirMaquina(auth: Autenticado, env: Env, id: string, req: Request): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id)) return json({ erro: "id da máquina fora do formato" }, 400);
  const corpo = (await lerJson(req)) as Record<string, unknown> | null;
  const email = validaEmail(corpo?.email);
  if (email === null) return json({ erro: "informe o e-mail da conta" }, 400);
  const conta = await contaPorEmail(env.DB, email);
  if (conta === null) return json({ erro: `nenhuma conta com o e-mail ${email}`, semConta: true }, 404);
  const apelido = validaApelido(corpo?.apelido);
  await atribuirMaquina(env.DB, conta.id, id, apelido, auth.conta.email);
  await auditar(env.DB, auth.conta.email, "maquina.atribuida", conta.id, `${id} · ${apelido ?? "-"}`);
  return json({ ok: true, conta: { id: conta.id, email: conta.email, nome: conta.nome } });
}
/** `DELETE /admin/maquinas/:id/conta {email}`: desfaz a atribuição; a máquina sai da lista da conta. */
export async function deleteAtribuirMaquina(auth: Autenticado, env: Env, id: string, req: Request): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id)) return json({ erro: "id da máquina fora do formato" }, 400);
  const corpo = (await lerJson(req)) as Record<string, unknown> | null;
  const email = validaEmail(corpo?.email);
  if (email === null) return json({ erro: "informe o e-mail da conta" }, 400);
  const conta = await contaPorEmail(env.DB, email);
  if (conta === null || !(await desatribuirMaquina(env.DB, conta.id, id))) return json({ erro: "esta máquina não está atribuída a essa conta" }, 404);
  await auditar(env.DB, auth.conta.email, "maquina.desatribuida", conta.id, id);
  return json({ ok: true });
}
