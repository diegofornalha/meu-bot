// Painel "Assinar o Pro" do console (public/console/plano-core.js): quando some e quando avisa do prazo atual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addonsNaVisaoGeral, buscaDaVolta, cortesiasNaTela, usuariosDaOrg, assinaturasDoItem, estadoDoItem, itemGa, resumoDeUso, semDevices, assinaturasAtivasDe, oQueAContaTem, pagoChegou, deParaDoExtra, avisoAddonPago, contagemRegressiva, diasAteOFim, estadoAssinaturaPro, fase, linhasDeMaquinas, ofertaDoProAparece, pedidoAssinar, promoNaTela, reaisCurto, semPrazo, podeAdicionarMaquina, vagaDoAssinar, voltaDoPagamento, vagasDeDevice, vagasDeMaquina } from "../public/console/plano-core.js";

const pro = { plan: "pro", status: "active" };
const ativa = { status: "ACTIVE", produto: null };

test("assinar o Pro: some só com a assinatura do Pro em andamento e o Pro valendo", () => {
  assert.deepEqual(estadoAssinaturaPro(pro, [ativa]), { pagoAtivo: true, proSemAssinatura: false });
});

test("assinar o Pro: Pro liberado sem assinatura, ou cancelado com o mês pago, pode assinar e vê o aviso do prazo", () => {
  assert.deepEqual(estadoAssinaturaPro(pro, []), { pagoAtivo: false, proSemAssinatura: true });
  assert.deepEqual(estadoAssinaturaPro(pro, undefined), { pagoAtivo: false, proSemAssinatura: true });
  assert.deepEqual(estadoAssinaturaPro(pro, [{ status: "CANCELLED", produto: null }]), { pagoAtivo: false, proSemAssinatura: true });
});

test("assinar o Pro: assinatura de add-on não conta como assinatura do Pro", () => {
  assert.deepEqual(estadoAssinaturaPro(pro, [{ status: "ACTIVE", produto: "meu-bot-finance" }]), { pagoAtivo: false, proSemAssinatura: true });
});

test("assinar o Pro: sem Pro valendo o painel aparece sem aviso, mesmo com assinatura ACTIVE (a API também aceita)", () => {
  for (const l of [{ plan: "free", status: "free" }, { plan: "pro", status: "expired" }, { plan: "pro", status: "trialing" }]) {
    assert.deepEqual(estadoAssinaturaPro(l, [ativa]), { pagoAtivo: false, proSemAssinatura: false });
    assert.deepEqual(estadoAssinaturaPro(l, []), { pagoAtivo: false, proSemAssinatura: false });
  }
});

test("promoção do primeiro mês: a tela só mostra o que veio inteiro da API e ainda está no prazo", () => {
  const agora = Date.parse("2026-11-18T12:00:00Z");
  const promo = { precoCentavos: 100, ate: "2026-11-20T12:00:00.000Z", cupom: "PRIMEIROMES" };
  assert.deepEqual(promoNaTela(promo, agora), promo);
  assert.equal(promoNaTela(null, agora), null);
  assert.equal(promoNaTela(undefined, agora), null, "API antiga, sem o campo");
  assert.equal(promoNaTela({ ...promo, ate: "2026-11-18T11:59:59.000Z" }, agora), null, "prazo acabou com a tela aberta");
  assert.equal(promoNaTela({ ...promo, cupom: "" }, agora), null);
  assert.equal(promoNaTela({ ...promo, precoCentavos: "100" }, agora), null);
  assert.equal(promoNaTela({ ...promo, ate: "lixo" }, agora), null);
});

test("reaisCurto: valor redondo sem centavos, como o site escreve", () => {
  assert.equal(reaisCurto(100), "R$ 1");
  assert.equal(reaisCurto(9700), "R$ 97");
  assert.equal(reaisCurto(150), "R$ 1,50");
});

test("contagem regressiva: dias que faltam do teste e do Pro, horas no último dia, e há quanto tempo venceu", () => {
  const agora = Date.parse("2026-11-19T02:00:00Z"), H = 3600000, D = 24 * H;
  const teste = (fim) => ({ plan: "pro", status: "trialing", trialEnd: new Date(fim).toISOString(), expiresAt: new Date(fim).toISOString() });
  assert.deepEqual(contagemRegressiva(teste(agora + 12 * D - H), agora), { texto: "faltam 12 dias de teste", tom: "ok" });
  assert.deepEqual(contagemRegressiva(teste(agora + 3 * D), agora), { texto: "faltam 3 dias de teste", tom: "ok" });
  assert.deepEqual(contagemRegressiva(teste(agora + D + 1), agora), { texto: "faltam 2 dias de teste", tom: "ok" });
  assert.deepEqual(contagemRegressiva(teste(agora + 5 * H - 1), agora), { texto: "faltam 5 horas de teste", tom: "mau" });
  assert.deepEqual(contagemRegressiva(teste(agora + 20 * 60000), agora), { texto: "falta menos de 1 hora de teste", tom: "mau" });
  assert.deepEqual(contagemRegressiva(teste(agora - H), agora), { texto: "teste venceu hoje", tom: "mau" });
  assert.deepEqual(contagemRegressiva(teste(agora - 2 * D - H), agora), { texto: "teste venceu há 2 dias", tom: "mau" });
  assert.deepEqual(contagemRegressiva({ plan: "pro", status: "active", trialEnd: null, expiresAt: new Date(agora + 20 * D).toISOString() }, agora), { texto: "faltam 20 dias do Pro", tom: "ok" });
});

test("contagem regressiva: sem prazo não aparece (free, expirado, Pro sem data, data inválida)", () => {
  const agora = Date.parse("2026-11-19T02:00:00Z");
  assert.equal(contagemRegressiva({ plan: "free", status: "free", trialEnd: null, expiresAt: null }, agora), null);
  assert.equal(contagemRegressiva({ plan: "pro", status: "active", trialEnd: null, expiresAt: null }, agora), null);
  assert.equal(contagemRegressiva({ plan: "pro", status: "expired", trialEnd: "2026-11-01T00:00:00Z", expiresAt: "2026-11-01T00:00:00Z" }, agora), null);
  assert.equal(contagemRegressiva({ plan: "pro", status: "trialing", trialEnd: "lixo", expiresAt: null }, agora), null);
  assert.equal(contagemRegressiva(undefined, agora), null);
});

test("dias até o fim: a lista do admin e a página Plano contam os mesmos dias", () => {
  const agora = Date.parse("2026-11-19T02:00:00Z"), D = 24 * 3600000;
  for (const n of [2, 3, 12, 30]) {
    const l = { plan: "pro", status: "trialing", trialEnd: new Date(agora + n * D - 60000).toISOString(), expiresAt: null };
    assert.equal(diasAteOFim(l, agora), n);
    assert.equal(contagemRegressiva(l, agora).texto, `faltam ${n} dias de teste`);
  }
  assert.equal(diasAteOFim({ expiresAt: null, trialEnd: null }, agora), null);
  assert.equal(diasAteOFim({ expiresAt: new Date(agora - 2 * D - 1).toISOString() }, agora), -2);
});

test("pedido do Assinar: a promoção na tela manda promo; \"Prefiro Pix\" manda semPromo; add-on e preço normal não mandam nenhum", () => {
  const promo = { precoCentavos: 100, ate: "2026-11-20T12:00:00.000Z", cupom: "PRIMEIROMES" };
  assert.deepEqual(pedidoAssinar(null, promo), { promo: true });
  assert.deepEqual(pedidoAssinar(null, promo, true), { semPromo: true });
  assert.deepEqual(pedidoAssinar(null, null), {});
  assert.deepEqual(pedidoAssinar(null, null, true), {}, "sem promoção na tela não há do que abrir mão");
  assert.deepEqual(pedidoAssinar("meu-bot-finance", promo), { produto: "meu-bot-finance" }, "a promoção é só do Pro");
});

test("vagas de máquina: a tela separa o que o plano inclui do que é máquina extra", () => {
  assert.deepEqual(vagasDeMaquina(1, 0), { total: 1, inclusas: 1, extras: 0, cortesias: 0, detalhe: "" });
  assert.deepEqual(vagasDeMaquina(2, 1), { total: 2, inclusas: 1, extras: 1, cortesias: 0, detalhe: "1 inclusa + 1 extra" });
  assert.deepEqual(vagasDeMaquina(5, 3), { total: 5, inclusas: 2, extras: 3, cortesias: 0, detalhe: "2 inclusas + 3 extras" });
  assert.deepEqual(vagasDeMaquina(undefined, undefined), { total: 1, inclusas: 1, extras: 0, cortesias: 0, detalhe: "" }, "API antiga, sem os campos");
  assert.equal(vagasDeMaquina(2, 9).inclusas, 1, "nunca menos de uma inclusa");
  assert.deepEqual(pedidoAssinar("extra-maquina", null), { produto: "extra-maquina" });
});

test("adicionar máquina: só com o Pro valendo (pago ou em teste, sem ter vencido)", () => {
  const agora = Date.parse("2026-11-19T12:00:00Z");
  assert.equal(podeAdicionarMaquina({ plan: "pro", status: "active", expiresAt: "2026-12-01T00:00:00Z", trialEnd: null }, agora), true);
  assert.equal(podeAdicionarMaquina({ plan: "pro", status: "trialing", expiresAt: "2026-11-20T00:00:00Z", trialEnd: "2026-11-20T00:00:00Z" }, agora), true);
  assert.equal(podeAdicionarMaquina({ plan: "pro", status: "active", expiresAt: null, trialEnd: null }, agora), true, "Pro sem prazo");
  assert.equal(podeAdicionarMaquina({ plan: "pro", status: "trialing", expiresAt: "2026-11-19T11:00:00Z", trialEnd: "2026-11-19T11:00:00Z" }, agora), false, "teste vencido");
  assert.equal(podeAdicionarMaquina({ plan: "pro", status: "expired", expiresAt: "2026-11-01T00:00:00Z", trialEnd: null }, agora), false);
  assert.equal(podeAdicionarMaquina({ plan: "free", status: "free", expiresAt: null, trialEnd: null }, agora), false);
  assert.equal(podeAdicionarMaquina(undefined, agora), false);
});

// O Pro sem prazo do super admin: a API entrega `semPrazo: true` (licencaDoSuper) e as telas mostram "∞".
const doSuper = { plan: "pro", status: "active", interval: null, trialEnd: null, expiresAt: null, semPrazo: true };

test("super admin: a contagem regressiva vira \"∞ sem prazo\", sejam quais forem as datas", () => {
  const agora = Date.parse("2026-11-19T02:00:00Z");
  assert.deepEqual(contagemRegressiva(doSuper, agora), { texto: "∞ sem prazo", tom: "ok" });
  assert.deepEqual(contagemRegressiva({ ...doSuper, expiresAt: "2026-11-01T00:00:00Z" }, agora), { texto: "∞ sem prazo", tom: "ok" }, "nem uma data vencida muda");
  assert.equal(contagemRegressiva({ ...doSuper, semPrazo: undefined }, agora), null, "Pro sem data de conta comum continua sem selo");
  assert.equal(semPrazo({ ...doSuper, semPrazo: "true" }), false, "só o true da API vale");
  assert.equal(semPrazo(undefined), false);
});

test("super admin: na lista do admin a fase é \"Pro · ∞\" e conta como Pro ativo; as outras contas não mudam", () => {
  const agora = Date.parse("2026-11-19T02:00:00Z"), D = 24 * 3600000;
  assert.deepEqual(fase(doSuper, agora), { texto: "Pro · ∞", tom: "ok" });
  assert.match(fase(doSuper, agora).texto, /^Pro ativo|^Pro ·/, "entra no total \"Pro ativo\" do painel");
  assert.deepEqual(fase({ plan: "pro", status: "active", trialEnd: null, expiresAt: null }, agora), { texto: "Pro ativo", tom: "ok" });
  assert.deepEqual(fase({ plan: "pro", status: "active", trialEnd: null, expiresAt: new Date(agora + 5 * D - 1).toISOString() }, agora), { texto: "Pro · 5 dias", tom: "ok" });
  assert.deepEqual(fase({ plan: "pro", status: "trialing", trialEnd: new Date(agora - 2 * D - 1).toISOString(), expiresAt: null }, agora), { texto: "Trial venceu há 2 dias", tom: "mau" });
  assert.deepEqual(fase({ plan: "pro", status: "expired", trialEnd: null, expiresAt: null }, agora), { texto: "Expirado", tom: "mau" });
  assert.deepEqual(fase({ plan: "free", status: "free", trialEnd: null, expiresAt: null }, agora), { texto: "Free", tom: "" });
});

test("super admin: o painel \"Assinar o Pro\" some, sem aviso de prazo, com ou sem assinatura", () => {
  for (const ass of [[], [ativa], undefined]) assert.deepEqual(estadoAssinaturaPro(doSuper, ass), { pagoAtivo: false, proSemAssinatura: false, semPrazo: true });
});

test("add-on pago: a tela diz os dois passos (ativo na conta; liberado ou não na máquina) pelo estado do pedido de liberação", () => {
  const PAGO = "Pagamento confirmado: o Finanças está ativo nesta conta.";
  const aberta = [{ produto: "meu-bot-finance", aberta: true }], fechada = [{ produto: "meu-bot-finance", aberta: false }];
  const falta = { estado: "falta-maquina", texto: `${PAGO} Falta um passo para ele aparecer no app: a liberação na sua máquina. O pedido já está com o suporte. Quando for liberado, ele aparece na página Módulos do app.` };
  // Pedido aberto: aparece na volta do pagamento e continua aparecendo depois, enquanto o admin não atende.
  assert.deepEqual(avisoAddonPago("Finanças", "meu-bot-finance", aberta, true), falta);
  assert.deepEqual(avisoAddonPago("Finanças", "meu-bot-finance", aberta, false), falta);
  // Pedido atendido: na volta do pagamento diz que o suporte marcou a liberação como feita; fora dela, o painel some.
  assert.deepEqual(avisoAddonPago("Finanças", "meu-bot-finance", fechada, true), { estado: "liberado", texto: `${PAGO} O suporte já marcou a liberação na sua máquina como feita: ele deve aparecer na página Módulos do app. Se não aparecer, fale com o suporte.` });
  assert.equal(avisoAddonPago("Finanças", "meu-bot-finance", fechada, false), null);
  // Sem pedido conhecido (API antiga sem o campo, add-on concedido pelo admin): não afirma em que pé está a máquina.
  const semPedido = { estado: "sem-pedido", texto: `${PAGO} Ele aparece no app depois de liberado na sua máquina; se não aparecer, fale com o suporte.` };
  for (const l of [undefined, null, [], "lixo", [null], [{ produto: "meu-bot-diego", aberta: true }]]) {
    assert.deepEqual(avisoAddonPago("Finanças", "meu-bot-finance", l, true), semPedido);
    assert.equal(avisoAddonPago("Finanças", "meu-bot-finance", l, false), null);
  }
  // O pedido de um add-on não fala pelo outro, e `aberta` fora da forma não vira "falta" nem "liberado".
  assert.equal(avisoAddonPago("Módulos do Diego", "meu-bot-diego", aberta, false), null);
  assert.equal(avisoAddonPago("Finanças", "meu-bot-finance", [{ produto: "meu-bot-finance", aberta: "sim" }], true).estado, "sem-pedido");
  // Nenhum texto promete prazo, aviso (não há envio automático) nem diz que é automático; e o atendido não afirma o estado da máquina.
  for (const l of [aberta, fechada, []]) assert.doesNotMatch(avisoAddonPago("Finanças", "meu-bot-finance", l, true).texto, /avisad|já foi liberado|já está na/i);
  for (const l of [aberta, fechada, []]) assert.doesNotMatch(avisoAddonPago("Finanças", "meu-bot-finance", l, true).texto, /automátic|minuto|hora|segundo|em breve|na hora|\bdia/i);
});

test("oferta do Pro: a vaga do painel abre a Visão geral, o painel nasce na vaga do Plano e mostra de R$ 997 por R$ 97", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../public/console/index.html", import.meta.url), "utf8");
  const visao = html.slice(html.indexOf('<section data-secao="overview"'), html.indexOf('<section data-secao="profile"'));
  assert.ok(visao.indexOf('id="ov-assinar-vaga"') > 0 && visao.indexOf('id="ov-assinar-vaga"') < visao.indexOf('id="ov-cartoes"'));
  assert.match(html, /id="pl-assinar-vaga"><div class="painel" id="pl-assinar" hidden>/);
  assert.match(html, /De <s>R\$ 997<\/s> por <strong>R\$ 97<\/strong> por mês/);
  assert.equal(html.split('id="pl-assinar"').length, 2);
  const js = await readFile(new URL("../public/console/console.js", import.meta.url), "utf8");
  assert.match(js, /vagaDoAssinar\(rota\(\)\?\.secao\)/);
  assert.equal(vagaDoAssinar("plan"), "pl-assinar-vaga");
  assert.equal(vagaDoAssinar("marketplace"), "mk-assinar-vaga");
  for (const s of ["overview", "devices", undefined]) assert.equal(vagaDoAssinar(s), "ov-assinar-vaga");
});

test("oferta do Pro: quem já tem o Pro não vê; volta nos últimos 7 dias; teste e free veem sempre", () => {
  const AGORA = Date.parse("2026-11-19T12:00:00Z"), em = (dias) => new Date(AGORA + dias * 86400000).toISOString();
  assert.equal(ofertaDoProAparece({ ...pro, expiresAt: em(33) }, [], AGORA), false, "Pro liberado com um mês pela frente");
  assert.equal(ofertaDoProAparece({ ...pro, expiresAt: em(8) }, [{ status: "CANCELLED", produto: null }], AGORA), false);
  assert.equal(ofertaDoProAparece({ ...pro, expiresAt: em(7) }, [], AGORA), true, "última semana: assina antes de ficar sem");
  assert.equal(ofertaDoProAparece({ ...pro, expiresAt: em(-1) }, [], AGORA), true, "Pro vencido");
  assert.equal(ofertaDoProAparece(pro, [], AGORA), false, "Pro sem data de fim");
  assert.equal(ofertaDoProAparece({ ...pro, expiresAt: em(2) }, [ativa], AGORA), false, "assinatura em andamento");
  assert.equal(ofertaDoProAparece({ ...pro, expiresAt: em(2), semPrazo: true }, [], AGORA), false, "super admin");
  assert.equal(ofertaDoProAparece({ plan: "pro", status: "trialing", trialEnd: em(3) }, [], AGORA), true, "teste grátis");
  assert.equal(ofertaDoProAparece({ plan: "free", status: "expired" }, [], AGORA), true);
  assert.equal(ofertaDoProAparece({ plan: "free", status: "active" }, [], AGORA), true);
});

test("Visão geral: quem já tem o Pro vê os add-ons que ainda não tem; com a oferta do Pro na tela, nenhum", () => {
  const fin = { nome: "meu-bot-finance", rotulo: "Finanças" }, diego = { nome: "meu-bot-diego", rotulo: "Módulos do Diego" };
  assert.deepEqual(addonsNaVisaoGeral(false, [], [fin, diego]), [fin, diego]);
  assert.deepEqual(addonsNaVisaoGeral(false, ["meu-bot-diego"], [fin, diego]), [fin]);
  assert.deepEqual(addonsNaVisaoGeral(false, ["meu-bot-finance", "meu-bot-diego"], [fin, diego]), []);
  assert.deepEqual(addonsNaVisaoGeral(true, [], [fin, diego]), [], "uma oferta por vez");
  assert.deepEqual(addonsNaVisaoGeral(false, undefined, undefined), []);
});

test("vagasDeDevice: a mesma conta das máquinas, com o texto no masculino", () => {
  assert.deepEqual(vagasDeDevice(1, 0), { total: 1, inclusas: 1, extras: 0, cortesias: 0, detalhe: "" });
  assert.deepEqual(vagasDeDevice(2, 1), { total: 2, inclusas: 1, extras: 1, cortesias: 0, detalhe: "1 incluso + 1 extra" });
  assert.deepEqual(vagasDeDevice(5, 2), { total: 5, inclusas: 3, extras: 2, cortesias: 0, detalhe: "3 inclusos + 2 extras" });
  assert.deepEqual(vagasDeDevice(undefined, undefined), { total: 1, inclusas: 1, extras: 0, cortesias: 0, detalhe: "" }, "API antiga, sem os campos");
});

test("unidade extra: o preço de tabela só aparece riscado quando é maior que o cobrado", () => {
  assert.deepEqual(deParaDoExtra({ centavos: 4700, deCentavos: 9700 }), { de: "R$ 97", por: "R$ 47" });
  assert.equal(deParaDoExtra({ centavos: 9700 }), null, "sem preço de tabela");
  assert.equal(deParaDoExtra({ centavos: 9700, deCentavos: 9700 }), null);
  assert.equal(deParaDoExtra({ centavos: 9700, deCentavos: 4700 }), null);
  assert.equal(deParaDoExtra(null), null);
});

test("máquinas que você usa: as da conta ocupam vaga, as do admin aparecem sem ocupar e sem duplicar", () => {
  const agora = Date.parse("2026-11-19T12:00:00Z");
  const emUso = { id: "aaaaaaaa-1", apelido: "Karen", proAte: "2026-12-18T00:00:00Z", desvinculadaEm: null };
  const presa = { id: "bbbbbbbb-2", apelido: null, proAte: "2026-12-01T00:00:00Z", desvinculadaEm: "2026-11-18T00:00:00Z" };
  const solta = { id: "cccccccc-3", apelido: "Velha", proAte: "2026-11-01T00:00:00Z", desvinculadaEm: "2026-10-20T00:00:00Z" };
  const vistas = [{ id: "dddddddd-4", apelido: "Diego", origem: "admin", vistaEm: "2026-11-19T11:00:00Z" }, { id: "aaaaaaaa-1", apelido: "Karen", origem: "conta", vistaEm: "2026-11-19T11:00:00Z" }];
  const r = linhasDeMaquinas([emUso, presa, solta], vistas, agora);
  assert.deepEqual(r.linhas.map((l) => [l.nome, l.selo, l.acao, l.ocupaVaga]), [
    ["Karen", "Em uso", "tirar-licenca", true],
    ["máquina bbbbbbbb", "Tirada · vaga presa", null, true],
    ["Velha", "Tirada", null, false],
    ["Diego", "Em uso · licença do admin", "tirar-da-lista", false],
  ]);
  assert.equal(r.ocupadas, 2);
  assert.equal(r.semVaga, 1);
  assert.equal(r.linhas[3].valeAte, null);
  assert.deepEqual(linhasDeMaquinas(undefined, undefined), { linhas: [], ocupadas: 0, semVaga: 0 }, "API antiga, sem os campos");
});

test("Marketplace: a seção existe no menu, recebe os painéis de compra e o Plano fica sem eles", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../public/console/index.html", import.meta.url), "utf8");
  assert.match(html, /<a href="\/account\/marketplace" data-secao="marketplace">/);
  const mk = html.slice(html.indexOf('<section data-secao="marketplace"'), html.indexOf('<section data-secao="support"'));
  for (const id of ["mk-lista", "mk-tem", "mk-grade", "mk-ficha", "mk-assinar-vaga", "pl-extras", "pl-addons"]) assert.ok(mk.includes(`id="${id}"`), id);
  const plano = html.slice(html.indexOf('<section data-secao="plan"'), html.indexOf('<section data-secao="marketplace"'));
  assert.ok(!plano.includes('id="pl-extras"') && !plano.includes('id="pl-addons"'));
  assert.match(plano, /href="\/account\/marketplace"/);
  for (const id of ["pl-extras", "pl-addons"]) assert.equal(html.split(`id="${id}"`).length, 2, `${id} uma vez só`);
  const js = await readFile(new URL("../public/console/console.js", import.meta.url), "utf8");
  assert.match(js, /const SECOES = \[[^\]]*"marketplace"/);
  assert.match(js, /marketplace: pintarMarketplace/);
  assert.ok(!js.includes('a.href = "/account/plan"'), "os atalhos de compra levam ao Marketplace");
});

test("Marketplace: o pago chegou? add-on pela licença; unidade extra pela contagem de assinaturas", () => {
  const maq = (status = "ACTIVE") => ({ produto: "extra-maquina", status });
  assert.equal(assinaturasAtivasDe([maq(), maq("CANCELLED"), { produto: null, status: "ACTIVE" }], "extra-maquina"), 1);
  assert.equal(assinaturasAtivasDe(undefined, "extra-maquina"), 0);
  assert.equal(pagoChegou({ licenca: { produtos: ["meu-bot-finance"] } }, "meu-bot-finance", null), true);
  assert.equal(pagoChegou({ licenca: { produtos: [] } }, "meu-bot-finance", null), false);
  assert.equal(pagoChegou({ assinaturas: [maq()] }, "extra-maquina", 0), true, "tinha 0, agora 1");
  assert.equal(pagoChegou({ assinaturas: [maq()] }, "extra-maquina", 1), false, "a segunda ainda não entrou");
  assert.equal(pagoChegou({ assinaturas: [maq(), maq()] }, "extra-maquina", 1), true);
  assert.equal(pagoChegou({ assinaturas: [maq()] }, "extra-maquina", null), false, "sem o número de antes, não afirma");
  assert.equal(pagoChegou({}, null, null), true, "sem produto na volta, nada a esperar");
});

test("Marketplace: o que a conta tem", () => {
  const nomes = { "meu-bot-finance": "Finanças" };
  assert.deepEqual(oQueAContaTem({ licenca: { plan: "pro", status: "active", produtos: ["meu-bot-finance", "meu-bot-x"] }, maquinaExtras: 1, deviceExtras: 2 }, nomes), ["Pro", "Finanças", "meu-bot-x", "1 máquina extra", "2 Macs extras"]);
  assert.deepEqual(oQueAContaTem({ licenca: { plan: "pro", status: "trialing", produtos: [] } }, nomes), ["Pro (teste grátis)"]);
  assert.deepEqual(oQueAContaTem({ licenca: { plan: "free", status: "expired", produtos: [] } }, nomes), []);
  assert.deepEqual(oQueAContaTem(undefined), []);
});

test("Marketplace: o selo de cada item para a conta", () => {
  const AGORA = Date.now(), em = (d) => new Date(AGORA + d * 86400000).toISOString();
  const pro = { tipo: "plano", id: "pro" }, fin = { tipo: "app", id: "meu-bot-finance" }, maq = { tipo: "unidade", id: "extra-maquina" }, mac = { tipo: "unidade", id: "extra-device" };
  const ativa = { licenca: { plan: "pro", status: "active", expiresAt: em(20), produtos: ["meu-bot-finance"] }, maquinaExtras: 2, deviceExtras: 0, liberacoes: [] };
  assert.deepEqual([pro, fin, maq, mac].map((i) => estadoDoItem(ativa, i).texto), ["Você tem", "Você tem", "Você tem 2", "Disponível"]);
  assert.equal(estadoDoItem({ ...ativa, liberacoes: [{ produto: "meu-bot-finance", aberta: true }] }, fin).chave, "falta-liberar");
  const teste = { licenca: { plan: "pro", status: "trialing", trialEnd: em(2), produtos: [] } };
  assert.deepEqual([pro, fin, maq].map((i) => estadoDoItem(teste, i).chave), ["teste", "disponivel", "disponivel"]);
  const free = { licenca: { plan: "free", status: "expired", produtos: [] } };
  assert.deepEqual([pro, fin, maq, mac].map((i) => estadoDoItem(free, i).chave), ["disponivel", "disponivel", "precisa-pro", "precisa-pro"]);
  const sup = { licenca: { plan: "pro", status: "active", semPrazo: true, produtos: [] } };
  for (const i of [pro, fin, maq, mac]) assert.equal(estadoDoItem(sup, i).chave, "tem");
  assert.equal(estadoDoItem(undefined, fin).chave, "disponivel");
});

test("Marketplace: a vitrine não vende, leva à página do item; o endereço do item existe no console", async () => {
  const { readFile } = await import("node:fs/promises");
  const js = await readFile(new URL("../public/console/console.js", import.meta.url), "utf8");
  assert.match(js, /\/account\\\/marketplace\\\/\(\[a-z0-9-\]\{1,60\}\)/, "rota /account/marketplace/<slug>");
  const vitrine = js.slice(js.indexOf('$("mk-grade").replaceChildren'), js.indexOf("const e = estadoDoItem(c, item, data), ficha"));
  assert.ok(vitrine.length > 100 && !vitrine.includes("assinar("), "nenhum botão de compra na vitrine");
});

test("Marketplace: as assinaturas de um item (o Pro é a de produto nulo), ativas primeiro", () => {
  const lista = [{ id: "a", produto: "extra-maquina", status: "CANCELLED" }, { id: "b", produto: null, status: "ACTIVE" }, { id: "c", produto: "extra-maquina", status: "ACTIVE" }, { id: "d", produto: "meu-bot-finance", status: "ACTIVE" }];
  assert.deepEqual(assinaturasDoItem(lista, "extra-maquina").map((a) => a.id), ["c", "a"]);
  assert.deepEqual(assinaturasDoItem(lista, "pro").map((a) => a.id), ["b"]);
  assert.deepEqual(assinaturasDoItem(lista, "meu-bot-diego"), []);
  assert.deepEqual(assinaturasDoItem(undefined, "pro"), []);
});

test("tenho um cupom: o botão manda cupom: true, no lugar da promoção da tela, e nunca num add-on", () => {
  assert.deepEqual(pedidoAssinar(null, null, false, true), { cupom: true });
  assert.deepEqual(pedidoAssinar(null, { cupom: "X", precoCentavos: 100, ate: "2026-12-01" }, false, true), { cupom: true });
  assert.deepEqual(pedidoAssinar("extra-maquina", null, false, true), { produto: "extra-maquina" });
  assert.deepEqual(pedidoAssinar(null, null, false, false), {});
  assert.deepEqual(pedidoAssinar(null, null), {});
});

test("Marketplace: o item do Analytics tem o mesmo item_id que o servidor manda na compra", async () => {
  const { compraGa4, itemIdGa } = await import("../dist/pagamento-core.js");
  assert.deepEqual([itemIdGa(null), itemIdGa("meu-bot-finance"), itemIdGa("extra-maquina")], ["pro-mensal", "meu-bot-finance-mensal", "extra-maquina-mensal"]);
  const base = { clientId: "1.1700000000", sessionId: null, pagamentoId: "p", valorCentavos: 9700, primeira: true, ambiente: "staging" };
  assert.equal(compraGa4(base).events[0].params.items[0].item_id, itemIdGa(null), "a compra do Pro usa a regra");
  // O console repete o formato: cada item da vitrine tem o id que a compra dele terá.
  for (const [id, produto] of [["pro", null], ["meu-bot-finance", "meu-bot-finance"], ["extra-device", "extra-device"]]) assert.equal(itemGa({ id }).item_id, itemIdGa(produto), id);
  assert.deepEqual(itemGa({ id: "meu-bot-finance", nome: "Finanças", tipo: "app" }), { item_id: "meu-bot-finance-mensal", item_name: "Finanças", item_category: "app" });
  // O site não importa módulos: roda o trecho dele e compara o resultado, em vez de conferir o texto do código.
  const { readFile } = await import("node:fs/promises");
  const site = await readFile(new URL("../public/site/site.js", import.meta.url), "utf8");
  const fonte = /const mkItem = (\(e\) => \(\{.*?\}\));/s.exec(site);
  assert.ok(fonte, "site.js define mkItem");
  const mkItem = new Function(`return ${fonte[1]}`)();
  for (const [id, produto] of [["pro", null], ["meu-bot-finance", "meu-bot-finance"]]) assert.equal(mkItem({ dataset: { item: id } }).item_id, itemIdGa(produto), `site: ${id}`);
});

test("Devices: o aviso da lista vazia diz o app do ambiente; a Visão geral resume onde a conta é usada", async () => {
  assert.match(semDevices("staging"), /meu-bot-staging/); assert.match(semDevices("staging"), /produção/);
  assert.doesNotMatch(semDevices("producao"), /staging/); assert.match(semDevices("producao"), /app meu-bot/);
  assert.equal(resumoDeUso([], []), null);
  assert.equal(resumoDeUso([{ id: "a1b2c3d4e5f6", name: "cursor", status: "active" }, { id: "b1b2c3d4e5f6", name: "", status: "pending" }], [{ nome: "meu-box-2" }]), "Macs com o app: cursor, b1b2c3d4 (pendente). Máquinas do agente: meu-box-2.");
  assert.equal(resumoDeUso([], [{ nome: "meu-box-2" }]), "Nenhum Mac com o app. Máquinas do agente: meu-box-2.");
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../public/console/index.html", import.meta.url), "utf8");
  for (const id of ["dv-grade", "dv-aviso", "dv-maquinas-grade", "dv-maquinas", "ov-uso"]) assert.equal(html.split(`id="${id}"`).length, 2, id);
  const js = await readFile(new URL("../public/console/console.js", import.meta.url), "utf8");
  assert.match(js, /api\("DELETE", `\/conta\/devices\//, "o console chama a rota de remover o Mac");
});

test("os scripts do console e do site passam na checagem de sintaxe do Node", async () => {
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  for (const f of ["../public/console/console.js", "../public/console/plano-core.js", "../public/site/site.js", "../public/site/celular.js", "../public/analytics.js"]) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", fileURLToPath(new URL(f, import.meta.url))], { stdio: "pipe" }), f);
  }
});

test("Nova organização: a tela diz por que não dá para criar e para onde ir", async () => {
  const { bloqueioDeOrg } = await import("../public/console/plano-core.js");
  assert.equal(bloqueioDeOrg({ limite: 1, donaDe: 0, motivo: null }), null);
  assert.equal(bloqueioDeOrg(undefined), null, "API antiga: o formulário aparece e o servidor decide");
  const semPro = bloqueioDeOrg({ limite: 1, donaDe: 0, motivo: "sem-pro" });
  assert.match(semPro.texto, /Pro assinado/); assert.equal(semPro.ir.caminho, "/account/plan");
  const cheio = bloqueioDeOrg({ limite: 1, donaDe: 1, motivo: "no-limite" });
  assert.match(cheio.texto, /já tem uma organização/); assert.equal(cheio.ir.caminho, "/account/support");
  assert.match(bloqueioDeOrg({ limite: 3, donaDe: 3, motivo: "no-limite" }).texto, /3 organizações/);
});

test("tenho um cupom: Cartão manda cupom: true; Pix manda o código para o nosso servidor conferir", () => {
  assert.deepEqual(pedidoAssinar(null, null, false, true), { cupom: true });
  assert.deepEqual(pedidoAssinar(null, null, false, { pix: " primeiromes1 " }), { cupom: true, pix: true, codigo: "primeiromes1" });
  assert.deepEqual(pedidoAssinar(null, null, false, { pix: "  " }), {}, "sem código não é pedido de Pix");
  assert.deepEqual(pedidoAssinar("meu-bot-finance", null, false, { pix: "X1Y2" }), { produto: "meu-bot-finance" });
});

test("volta do pagamento: assinatura confirma; Pro sem assinatura (primeiro mês por Pix) diz até quando e segue esperando", () => {
  const dia = (iso) => iso.slice(0, 10);
  assert.deepEqual(voltaDoPagamento({ plan: "pro", status: "active", expiresAt: "2026-12-22T00:00:00Z" }, [{ status: "ACTIVE", produto: null }], dia), { texto: "Pagamento confirmado: o Pro está ativo.", esperar: false });
  const pix = voltaDoPagamento({ plan: "pro", status: "active", expiresAt: "2026-12-22T00:00:00Z" }, [], dia);
  assert.match(pix.texto, /^O Pro está ativo até 2026-12-22\./); assert.equal(pix.esperar, true);
  const antes = voltaDoPagamento({ plan: "pro", status: "trialing", trialEnd: "2026-11-21T00:00:00Z" }, [], dia);
  assert.match(antes.texto, /^Recebemos você de volta/); assert.equal(antes.esperar, true);
});

test("página do item: o painel de contratar não repete o que a ficha já diz", async () => {
  const { situacaoDaUnidade, situacaoDoApp } = await import("../public/console/plano-core.js");
  const { FICHAS } = await import("../dist/marketplace-core.js");
  const maq = situacaoDaUnidade("maquina", { total: 2, detalhe: "1 inclusa + 1 extra" });
  assert.match(maq, /^Hoje o seu plano cobre 2 máquinas \(1 inclusa \+ 1 extra\)\. O pagamento/);
  assert.match(situacaoDaUnidade("maquina", { total: 1, detalhe: "" }), /^Hoje o seu plano cobre 1 máquina\. /);
  const mac = situacaoDaUnidade("device", { total: 2, detalhe: "" }, 1);
  assert.match(mac, /cobre 2 Macs com o app\. Você tem 1 Mac esperando vaga/);
  assert.doesNotMatch(situacaoDaUnidade("device", { total: 2, detalhe: "" }, 0), /esperando vaga/);
  const app = situacaoDoApp("Finanças");
  // Nem o nome pelo uso, nem o resumo, nem o preço: isso é da ficha.
  for (const [texto, id] of [[maq, "extra-maquina"], [mac, "extra-device"], [app, "meu-bot-finance"]]) {
    assert.ok(!texto.includes(FICHAS[id].resumo), `${id}: resumo repetido`);
    assert.ok(id === "meu-bot-finance" || !texto.includes(FICHAS[id].nome), `${id}: nome repetido`);
    assert.doesNotMatch(texto, /R\$/, `${id}: preço repetido`);
  }
  const { readFile } = await import("node:fs/promises");
  const js = await readFile(new URL("../public/console/console.js", import.meta.url), "utf8");
  assert.ok(!js.includes('"Mais uma máquina para o agente"') && !js.includes('"Mais um Mac com o app"'), "os nomes dos itens vêm só das fichas");
});

test("organização: resumo dos usuários, a vaga que chegou, quem gerencia, e o selo do item", async () => {
  const { assentoChegou, estadoDoItem, orgsQueGerencia, pedidoAssinar, proPelaOrgTexto, usuariosDaOrg } = await import("../public/console/plano-core.js");
  const m = (status) => ({ status });
  assert.deepEqual(usuariosDaOrg({ assentos: 1, assentosInclusos: 1, assentosPagos: 0, ocupados: 1, membros: [m("ativo")] }), { livres: 0, semCobertura: 0, texto: "1 de 1 usuário em uso (o seu, incluso)." });
  assert.deepEqual(usuariosDaOrg({ assentos: 3, assentosInclusos: 1, assentosPagos: 2, ocupados: 2, membros: [m("ativo"), m("convidado")] }), { livres: 1, semCobertura: 0, texto: "2 de 3 usuários em uso (1 incluso + 2 pagos) · 1 ainda sem entrar." });
  assert.deepEqual([usuariosDaOrg({ assentos: 1, assentosInclusos: 1, assentosPagos: 0, ocupados: 3, membros: [] }).livres, usuariosDaOrg({ assentos: 1, assentosInclusos: 1, assentosPagos: 0, ocupados: 3, membros: [] }).semCobertura], [0, 2], "uma vaga venceu: duas pessoas além");
  assert.match(usuariosDaOrg({ assentos: 4, assentosInclusos: 4, assentosPagos: 0, ocupados: 1, membros: [] }).texto, /\(4 inclusos\)/, "cortesias do super admin");
  assert.equal(assentoChegou({ assentosPagos: 1 }, 0), true);
  assert.equal(assentoChegou({ assentosPagos: 1 }, 1), false);
  assert.equal(assentoChegou({ assentosPagos: 1 }, null), false, "sem o número de antes, não afirma");
  const conta = { licenca: { plan: "pro", status: "active", produtos: [] }, orgs: [{ slug: "acme", nome: "Acme", papel: "dona" }, { slug: "beta", nome: "Beta", papel: "membro" }, { slug: "gama", nome: "Gama", papel: "admin" }] };
  assert.deepEqual(orgsQueGerencia(conta).map((o) => o.slug), ["acme", "gama"]);
  assert.deepEqual(orgsQueGerencia(undefined), []);
  const item = { id: "extra-assento", tipo: "unidade" };
  assert.equal(estadoDoItem(conta, item).chave, "disponivel");
  assert.equal(estadoDoItem({ ...conta, orgs: [{ slug: "beta", papel: "membro" }] }, item).chave, "precisa-org");
  assert.equal(estadoDoItem({ ...conta, orgs: [] }, item).texto, "Precisa de organização");
  assert.deepEqual(pedidoAssinar("extra-assento", null, false, false, "acme"), { produto: "extra-assento", org: "acme" });
  assert.deepEqual(pedidoAssinar("extra-maquina", null), { produto: "extra-maquina" }, "as outras unidades não levam organização");
  const d = (iso) => iso.slice(0, 10);
  assert.equal(proPelaOrgTexto(null, d), null);
  assert.match(proPelaOrgTexto({ slug: "acme", nome: "Acme", ate: "2026-12-20T00:00:00.000Z" }, d), /^Você usa o Pro pela organização Acme, até 2026-12-20\. /);
  assert.match(proPelaOrgTexto({ slug: "acme", nome: "Acme", ate: null }, d), /^Você usa o Pro pela organização Acme\. /);
});

test("buscaDaVolta: o login no meio do caminho mantém só a marca de quem volta do pagamento", () => {
  assert.equal(buscaDaVolta("?assinatura=paga&produto=extra-assento"), "?assinatura=paga&produto=extra-assento");
  assert.equal(buscaDaVolta("?assinatura=paga"), "?assinatura=paga");
  assert.equal(buscaDaVolta("?produto=extra-assento&assinatura=paga&x=1"), "?assinatura=paga&produto=extra-assento");
  assert.equal(buscaDaVolta("?assinatura=paga&produto=%3Cscript%3E"), "?assinatura=paga");
  assert.equal(buscaDaVolta("?assinatura=cancelada"), "");
  assert.equal(buscaDaVolta(""), "");
  assert.equal(buscaDaVolta(undefined), "");
});

test("cortesias na tela da pessoa: vagas, organização, Marketplace, o que a conta tem e os avisos", () => {
  assert.equal(vagasDeMaquina(3, 1, 1).detalhe, "1 inclusa + 1 de cortesia + 1 extra");
  assert.equal(vagasDeMaquina(2, 0, 1).detalhe, "1 inclusa + 1 de cortesia");
  assert.equal(vagasDeMaquina(2, 1).detalhe, "1 inclusa + 1 extra", "sem cortesia, como antes");
  assert.equal(vagasDeDevice(3, 0, 1).detalhe, "2 inclusos + 1 de cortesia");
  assert.equal(vagasDeDevice(2, 0, 0).detalhe, "");
  assert.match(usuariosDaOrg({ assentos: 4, assentosInclusos: 1, assentosCortesia: 2, assentosPagos: 1, ocupados: 2, membros: [] }).texto, /2 de 4 usuários em uso \(1 incluso \+ 2 de cortesia \+ 1 pago\)/);
  const agora = Date.parse("2026-11-20T12:00:00Z"), d = (n) => new Date(agora + n * 86400000).toISOString(), data = (iso) => iso.slice(0, 10);
  const conta = { origemDoPro: "cortesia", licenca: { plan: "pro", status: "active", expiresAt: d(20), produtos: ["meu-bot-finance"] }, assinaturas: [], maquinaExtras: 0, maquinaCortesias: 2, deviceExtras: 0, deviceCortesias: 0, cortesias: [{ tipo: "pro", fim: d(20), encerradaEm: null }, { tipo: "addon", produto: "meu-bot-finance", fim: d(5), encerradaEm: null }, { tipo: "maquina", quantidade: 2, fim: d(30), encerradaEm: null }, { tipo: "device", quantidade: 1, fim: d(30), encerradaEm: d(-1) }] };
  assert.deepEqual(estadoDoItem(conta, { id: "pro", tipo: "plano" }, data, agora), { chave: "cortesia", texto: `Cortesia até ${d(20).slice(0, 10)}`, tom: "ok" });
  assert.equal(estadoDoItem(conta, { id: "meu-bot-finance", tipo: "app" }, data, agora).chave, "cortesia");
  assert.equal(estadoDoItem({ ...conta, assinaturas: [{ produto: "meu-bot-finance", status: "ACTIVE" }] }, { id: "meu-bot-finance", tipo: "app" }, data, agora).chave, "tem", "pago vale mais que cortesia");
  assert.equal(estadoDoItem(conta, { id: "extra-maquina", tipo: "unidade" }, data, agora).texto, "2 de cortesia");
  const canceladaPaga = { ...conta, assinaturas: [{ produto: "meu-bot-finance", status: "CANCELLED", valeAte: d(25) }] };
  assert.equal(estadoDoItem(canceladaPaga, { id: "meu-bot-finance", tipo: "app" }, data, agora).chave, "tem", "cancelada com o mês pago ainda vale mais que a cortesia");
  assert.ok(oQueAContaTem(canceladaPaga, { "meu-bot-finance": "Finanças" }, agora).includes("Finanças"));
  assert.equal(estadoDoItem({ ...conta, assinaturas: [{ produto: "meu-bot-finance", status: "CANCELLED", valeAte: d(-1) }] }, { id: "meu-bot-finance", tipo: "app" }, data, agora).chave, "cortesia", "pago vencido não conta");
  assert.deepEqual(oQueAContaTem(conta, { "meu-bot-finance": "Finanças" }, agora), ["Pro (cortesia)", "Finanças (cortesia)", "2 máquinas de cortesia"]);
  const linhas = cortesiasNaTela(conta, { "meu-bot-finance": "Finanças" }, data, agora);
  assert.deepEqual(linhas.map((x) => x.acabando), [true, false, false, false]);
  assert.match(linhas[0].texto, /^Cortesia: Finanças até .* Acaba em 5 dias: para continuar, contrate antes\.$/);
  assert.match(linhas[1].texto, /^Cortesia: o Pro até /);
  assert.match(linhas[2].texto, /^Cortesia: 2 máquinas a mais até /);
  assert.match(linhas[3].texto, /^Cortesia de 1 Mac a mais encerrada pelo suporte em /);
  assert.deepEqual(cortesiasNaTela({ cortesias: [] }), []);
});
