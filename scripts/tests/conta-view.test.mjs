// A conta na página Suporte do admin-gestao usa a mesma régua do console: este teste roda o porte do app e o
// plano-core.js do console sobre a mesma tabela de casos e exige o mesmo resultado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as app from "../../dist/renderer/lib/conta-view.js";
import * as web from "../../conta-api/public/console/plano-core.js";

const { parseContaDoAdmin, rotaDaContaAdmin, parseAtribuicao, emailDeConta } = createRequire(import.meta.url)("../../dist/main/conta/conta-core.js");
const AGORA = Date.parse("2026-11-19T12:00:00Z");
const em = (dias, horas = 0) => new Date(AGORA + dias * 864e5 + horas * 36e5).toISOString();
const lic = (o) => ({ plan: "free", status: "free", trialEnd: null, expiresAt: null, ...o });

test("paridade com o console: fase, contagem regressiva, fim do plano e dias", () => {
  const casos = [
    lic({}), lic({ status: "expired" }), lic({ plan: "pro", status: "expired", expiresAt: em(-3) }),
    lic({ plan: "pro", status: "active" }), lic({ plan: "pro", status: "active", semPrazo: true }), lic({ plan: "pro", status: "active", semPrazo: true, expiresAt: em(-9) }),
    ...[-40, -2, -1, 0, 1, 2, 3, 29, 30, 400].flatMap((d) => [lic({ plan: "pro", status: "active", expiresAt: em(d) }), lic({ plan: "pro", status: "trialing", trialEnd: em(d) }), lic({ plan: "pro", status: "trialing", trialEnd: em(d + 5), expiresAt: em(d) })]),
    ...[-30, -1, 0.5, 1, 1.5, 23, 24, 25].flatMap((h) => [lic({ plan: "pro", status: "active", expiresAt: em(0, h) }), lic({ plan: "pro", status: "trialing", trialEnd: em(0, h) })]),
    lic({ plan: "pro", status: "trialing" }), lic({ plan: "pro", status: "active", expiresAt: "lixo" }), lic({ plan: "free", status: "active", expiresAt: em(5) }),
  ];
  for (const l of casos) {
    const d = JSON.stringify(l);
    assert.deepEqual(app.fase(l, AGORA), web.fase(l, AGORA), `fase ${d}`);
    assert.deepEqual(app.contagemRegressiva(l, AGORA), web.contagemRegressiva(l, AGORA), `contagem ${d}`);
    assert.equal(app.fimDoPlano(l), web.fimDoPlano(l), `fim ${d}`);
    assert.equal(app.diasAteOFim(l, AGORA), web.diasAteOFim(l, AGORA), `dias ${d}`);
    assert.equal(app.semPrazo(l), web.semPrazo(l), `semPrazo ${d}`);
  }
  assert.deepEqual(app.contagemRegressiva(null, AGORA), web.contagemRegressiva(null, AGORA));
  for (const k of ["INFINITO", "SEM_PRAZO", "TODOS_ADDONS", "SEM_LIMITE"]) assert.equal(app[k], web[k], k);
});

test("paridade com o console: vagas de máquina", () => {
  for (const limite of [undefined, null, 0, 1, 2, 3, 50, 1.5, "2"]) for (const extras of [undefined, null, -1, 0, 1, 2, 3, 99, 0.5]) {
    assert.deepEqual(app.vagasDeMaquina(limite, extras), web.vagasDeMaquina(limite, extras), `limite=${limite} extras=${extras}`);
  }
});

const ID = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", MAQ = "5d2c1c0a-3f1b-4a52-8b8e-1f2a3b4c5d6e";
const corpoApi = (o = {}, conta = {}) => ({ achadaPor: "maquina", ...o, conta: {
  id: ID, email: "Ana@Exemplo.com", nome: "Ana", admin: null, pedidos: 2, maquinaLimite: 3, maquinaExtras: 2,
  licenca: { plan: "pro", status: "active", interval: "month", memberSince: em(-60), trialEnd: null, expiresAt: em(20), deviceLimit: 2, produtos: ["meu-bot-finance", "meu-bot-diego"], pagamento: null, updatedAt: em(-1), updatedBy: "system" },
  devices: [{ id: "a1b2c3d4e5f6", name: "Mac da Ana", status: "active", firstSeen: em(-9), lastSeen: em(0) }, { id: "b1b2c3d4e5f6", name: "Outro", status: "pending", firstSeen: em(-1), lastSeen: em(0) }],
  maquinas: [{ id: MAQ, apelido: "Karen", vinculadaPor: "ana@exemplo.com", proAte: em(20), desvinculadaEm: null }, { id: ID, apelido: "Velha", vinculadaPor: "ana@exemplo.com", proAte: em(2), desvinculadaEm: em(-1) }],
  assinaturas: [{ id: "s1", produto: null, status: "ACTIVE", valeAte: em(20) }, { id: "s2", produto: "meu-bot-finance", status: "ACTIVE", valeAte: em(12) }, { id: "s3", produto: "extra-maquina", status: "ACTIVE", valeAte: em(12) }, { id: "s4", produto: "meu-bot-diego", status: "CANCELLED", valeAte: em(1) }],
  ...conta } });

test("rotaDaContaAdmin: só as pistas que valem; sem nenhuma, não há o que perguntar", () => {
  assert.equal(rotaDaContaAdmin({ maquina: null, id: null, email: null }), null);
  assert.equal(rotaDaContaAdmin({ maquina: "x; rm -rf", id: "nao", email: "sem-arroba" }), null);
  assert.equal(rotaDaContaAdmin({ maquina: MAQ, id: ID, email: " Ana@Exemplo.com " }), `/admin/conta?maquina=${MAQ}&id=${ID}&email=ana%40exemplo.com`);
  assert.equal(rotaDaContaAdmin({ maquina: null, id: null, email: "a+b@x.io" }), "/admin/conta?email=a%2Bb%40x.io");
});

test("parseContaDoAdmin: a resposta da API vira o estado da tela", () => {
  const ok = parseContaDoAdmin(200, corpoApi(), AGORA);
  assert.equal(ok.estado, "ok");
  assert.equal(ok.conta.email, "ana@exemplo.com");
  assert.equal(ok.maquinaExtras, 2);
  assert.deepEqual(ok.addonsPagos, [{ produto: "meu-bot-finance", valeAte: em(12) }], "só add-on em andamento: nem o Pro, nem a máquina extra, nem o cancelado");
  assert.equal(ok.lidaEm, new Date(AGORA).toISOString());
  assert.deepEqual(parseContaDoAdmin(404, { erro: "nenhuma conta com essas pistas", semConta: true }), { estado: "nao-achada" });
  assert.equal(parseContaDoAdmin(404, { erro: "rota desconhecida" }).estado, "sem-resposta", "API sem a rota não é conta que falta");
  assert.deepEqual(parseContaDoAdmin(0, { erro: "sem resposta da API da conta (tempo esgotado)" }), { estado: "sem-resposta", motivo: "sem resposta da API da conta (tempo esgotado)" });
  assert.equal(parseContaDoAdmin(403, { erro: "só admin" }).motivo, "só admin");
  assert.equal(parseContaDoAdmin(200, { achadaPor: "maquina", conta: { id: "x" } }).estado, "sem-resposta", "conta fora do formato não vira tela");
  assert.equal(parseContaDoAdmin(200, corpoApi({ achadaPor: "palpite" })).estado, "sem-resposta");
});

test("contaLinhas e diferencasDaConta: o que o admin lê na página Suporte", () => {
  const c = parseContaDoAdmin(200, corpoApi(), AGORA);
  const t = app.contaLinhas(c, AGORA, [{ nome: "meu-bot-finance", rotulo: "Finanças" }]).map((l) => l.text);
  assert.equal(t[0], "Conta: ana@exemplo.com (Ana) · esta máquina está vinculada a ela");
  assert.equal(t[1], `Plano: Pro · ${web.fase(c.conta.licenca, AGORA).texto} · ${web.contagemRegressiva(c.conta.licenca, AGORA).texto}`);
  assert.equal(t[3], "Devices: 1/2 ativos · 1 pendente");
  assert.equal(t[4], "Máquinas com a licença: 1 de 3 (1 inclusa + 2 extras)");
  assert.match(t[5], /^Add-ons: meu-bot-diego \(concedido\), Finanças \(pago até .+\)$/);
  assert.equal(t[6], "Pedidos abertos: 2");

  const sup = parseContaDoAdmin(200, corpoApi({ achadaPor: "id" }, { admin: "super", pedidos: 0, licenca: { ...corpoApi().conta.licenca, semPrazo: true } }), AGORA);
  const ts = app.contaLinhas(sup, AGORA).map((l) => l.text);
  assert.match(ts[0], /super admin · pela licença da conta guardada nesta máquina$/);
  assert.equal(ts[1], "Plano: Pro · Pro · ∞");
  assert.equal(ts[2], "Até: ∞ sem prazo (super admin)");
  assert.equal(ts[3], "Devices: 1/∞ ativos · 1 pendente");
  assert.equal(ts[4], "Máquinas com a licença: 1 de ∞");
  assert.equal(ts.length, 6);

  const provavel = parseContaDoAdmin(200, corpoApi({ achadaPor: "email" }), AGORA);
  assert.match(app.contaLinhas(provavel, AGORA)[0].text, /conta provável/);
  assert.equal(app.contaLinhas(provavel, AGORA)[0].ok, null, "pista fraca não ganha o selo verde");

  const maquina = (o) => ({ license: { ...c.conta.licenca, ...o } });
  assert.deepEqual(app.diferencasDaConta(c, maquina({})), [], "iguais: nada a marcar");
  const dif = app.diferencasDaConta(c, maquina({ plan: "free", status: "expired", expiresAt: em(-2) })).map((l) => l.text);
  assert.equal(dif[0], "Diferença no plano: na máquina está Free, na conta Pro");
  assert.equal(dif[1], "Diferença no status: na máquina está Expirado, na conta Ativo");
  assert.match(dif[2], /^Diferença na validade: na máquina vai até .+, na conta até .+$/);
  assert.deepEqual(app.diferencasDaConta(provavel, maquina({ plan: "free" })), [], "conta só provável não acusa diferença");
  assert.deepEqual(app.diferencasDaConta(c, null), []);
  assert.match(app.contaSemDadosTexto({ estado: "sem-ligacao" }, "Ana"), /ainda não está ligada a uma conta/);
  assert.match(app.contaSemDadosTexto({ estado: "sem-resposta", motivo: "tempo esgotado" }, "Ana"), /tempo esgotado/);
});

test("gestão, atribuir máquina: o bloco mostra a atribuída, sugere o e-mail e some para quem usa a licença da conta", () => {
  const ok = (por, atribuida) => ({ estado: "ok", conta: { email: "diego@exemplo.com" }, achadaPor: por, ...(atribuida ? { atribuida: true } : {}) });
  assert.deepEqual(app.atribuicaoDaTela(ok("maquina", true), null), { modo: "atribuida", email: "diego@exemplo.com" });
  assert.deepEqual(app.atribuicaoDaTela(ok("maquina", false), null), { modo: "ligada", email: "diego@exemplo.com" });
  assert.deepEqual(app.atribuicaoDaTela(ok("email", false), null), { modo: "atribuir", sugestao: "diego@exemplo.com" }, "conta provável: vira a sugestão");
  assert.deepEqual(app.atribuicaoDaTela({ estado: "sem-ligacao" }, [{ conta: "" }, { conta: "ana@exemplo.com" }]), { modo: "atribuir", sugestao: "ana@exemplo.com" });
  assert.deepEqual(app.atribuicaoDaTela(undefined, null), { modo: "atribuir", sugestao: "" });
});

test("gestão, atribuir máquina: e-mail digitado e resposta da API", () => {
  assert.equal(emailDeConta("  Diego@Exemplo.COM "), "diego@exemplo.com");
  assert.equal(emailDeConta("sem arroba"), null);
  assert.deepEqual(parseAtribuicao(200, { ok: true, conta: { id: "x", email: "d@e.com", nome: "Diego" } }), { ok: true, conta: { email: "d@e.com", nome: "Diego" } });
  assert.deepEqual(parseAtribuicao(200, { ok: true }), { ok: true, conta: null }, "desfazer não traz a conta");
  assert.deepEqual(parseAtribuicao(404, { erro: "nenhuma conta com o e-mail x@y.com", semConta: true }), { ok: false, erro: "nenhuma conta com o e-mail x@y.com" });
  assert.match(parseAtribuicao(404, null).erro, /aguarda publicação/, "API publicada antes da rota");
  assert.equal(parseAtribuicao(403, { erro: "só admin" }).erro, "só admin");
  assert.equal(parseContaDoAdmin(200, { achadaPor: "maquina", atribuida: true, conta: null }).estado, "sem-resposta");
});

test("gestão: máquina atribuída não acusa diferença, e teste antigo não vira validade de plano ativo", () => {
  const conta = (o) => ({ estado: "ok", achadaPor: "maquina", conta: { email: "d@e.com", licenca: lic({ plan: "pro", status: "trialing", trialEnd: em(2) }) }, ...o });
  const maquina = { license: lic({ plan: "pro", status: "active", trialEnd: em(-9), expiresAt: null }) };
  const atribuida = app.diferencasDaConta(conta({ atribuida: true }), maquina);
  assert.equal(atribuida.length, 1); assert.equal(atribuida[0].ok, true); assert.match(atribuida[0].text, /atribuída a esta conta pelo admin/);
  const ligada = app.diferencasDaConta(conta({}), maquina).map((l) => l.text);
  assert.ok(ligada.some((t) => /Diferença no status/.test(t)));
  assert.ok(ligada.some((t) => /na máquina vai até sem vencimento/.test(t)), ligada.join(" | "));
  assert.match(parseAtribuicao(404, { erro: "rota desconhecida" }).erro, /aguarda publicação/);
});
