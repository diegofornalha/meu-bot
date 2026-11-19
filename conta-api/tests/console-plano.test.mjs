// Painel "Assinar o Pro" do console (public/console/plano-core.js): quando some e quando avisa do prazo atual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoAddonPago, contagemRegressiva, diasAteOFim, estadoAssinaturaPro, fase, pedidoAssinar, promoNaTela, reaisCurto, semPrazo, podeAdicionarMaquina, vagaDoAssinar, vagasDeMaquina } from "../public/console/plano-core.js";

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
  assert.deepEqual(vagasDeMaquina(1, 0), { total: 1, inclusas: 1, extras: 0, detalhe: "" });
  assert.deepEqual(vagasDeMaquina(2, 1), { total: 2, inclusas: 1, extras: 1, detalhe: "1 inclusa + 1 extra" });
  assert.deepEqual(vagasDeMaquina(5, 3), { total: 5, inclusas: 2, extras: 3, detalhe: "2 inclusas + 3 extras" });
  assert.deepEqual(vagasDeMaquina(undefined, undefined), { total: 1, inclusas: 1, extras: 0, detalhe: "" }, "API antiga, sem os campos");
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
  for (const s of ["overview", "devices", undefined]) assert.equal(vagaDoAssinar(s), "ov-assinar-vaga");
});
