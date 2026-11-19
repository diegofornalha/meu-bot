// Regra do painel "Assinar o Pro" no console › Plano. Puro (sem DOM): o console.js importa, o teste também.
// A API (postAssinatura, src/rotas/pagamentos.ts) só recusa quando há assinatura ACTIVE do Pro E o Pro está ativo;
// a tela segue a mesma regra.

/** O símbolo que entra no lugar da data e da contagem para quem tem o Pro sem prazo, e o texto que o explica. */
export const INFINITO = "∞", SEM_PRAZO = "sem prazo (super admin)";
/** O "∞" nos add-ons do super admin: a API já entrega todos os do catálogo (licencaDoSuper), os de hoje e os que entrarem. */
export const TODOS_ADDONS = "todos os add-ons, os de hoje e os que vierem (super admin)";
/** O "∞" nos limites de devices e de máquinas do super admin: a API não aplica limite a ele (limiteDoPapel). */
export const SEM_LIMITE = "sem limite (super admin)";
/** A licença entregue é a de um super admin (`semPrazo: true`, licencaDoSuper na API): Pro que nunca vence. */
export const semPrazo = (licenca) => licenca?.semPrazo === true;

/**
 * `pagoAtivo`: a conta tem a assinatura do Pro em andamento e o Pro valendo (o painel some).
 * `proSemAssinatura`: Pro valendo sem assinatura ativa (liberado pelo admin, ou cancelado com o mês ainda pago):
 * o painel aparece com o aviso de que o prazo atual não é encurtado.
 * `semPrazo` (só vem quando é true): conta de super admin, com o Pro sem prazo; o painel some e não há aviso, porque
 * não há o que assinar (a API recusa com 409).
 */
export function estadoAssinaturaPro(licenca, assinaturas) {
  if (semPrazo(licenca)) return { pagoAtivo: false, proSemAssinatura: false, semPrazo: true };
  const proAtivo = licenca?.plan === "pro" && licenca?.status === "active";
  const assina = (Array.isArray(assinaturas) ? assinaturas : []).some((a) => a?.status === "ACTIVE" && (a.produto === null || a.produto === undefined));
  return { pagoAtivo: proAtivo && assina, proSemAssinatura: proAtivo && !assina };
}

/**
 * A promoção do primeiro mês que a API mandou em `conta.promo` ({precoCentavos, ate, cupom}), conferida campo a campo;
 * null quando não veio, veio fora da forma ou o prazo já passou (a tela fica aberta e o prazo acaba).
 */
export function promoNaTela(promo, agoraMs = Date.now()) {
  if (promo === null || typeof promo !== "object") return null;
  const { precoCentavos, ate, cupom } = promo;
  if (!Number.isInteger(precoCentavos) || precoCentavos <= 0 || typeof cupom !== "string" || cupom === "" || typeof ate !== "string") return null;
  const fim = Date.parse(ate);
  if (Number.isNaN(fim) || fim < agoraMs) return null;
  return { precoCentavos, ate, cupom };
}

/** "R$ 1" para valor redondo, "R$ 1,50" para o resto: o preço como o site o escreve. */
export const reaisCurto = (centavos) => `R$ ${centavos % 100 === 0 ? String(centavos / 100) : (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const HORA = 60 * 60 * 1000, DIA = 24 * HORA;
/**
 * Quando o plano acaba, em ms: o `expiresAt` e, sem ele, o `trialEnd` só enquanto o plano está em teste (num plano
 * ativo sem vencimento a data do teste é sobra antiga; a licença vale por `expiresAt`); null sem data válida.
 */
export function fimDoPlano(licenca) { const fim = Date.parse(licenca?.expiresAt ?? (licenca?.status === "trialing" ? licenca?.trialEnd : null) ?? ""); return Number.isNaN(fim) ? null : fim; }
/**
 * Quantos dias faltam para o plano acabar, arredondando para cima (negativo depois de vencido); null sem data.
 * É a conta única de "dias que faltam" do console: a página Plano e a lista do admin (`fase`) usam esta.
 */
export function diasAteOFim(licenca, agoraMs) { const fim = fimDoPlano(licenca); return fim === null ? null : Math.ceil((fim - agoraMs) / DIA); }
/**
 * A contagem regressiva do plano, para o cabeçalho da página Plano: quanto falta para o teste ou o Pro acabar.
 * Conta dias cheios que ainda faltam (arredonda para cima); no último dia conta as horas; vencido, diz há quanto tempo.
 * Sem prazo (free, ou Pro sem data) devolve null. `tom`: "mau" vencido ou nas últimas 24 h, "ok" no resto.
 * Super admin (`semPrazo`): "∞ sem prazo", sejam quais forem as datas.
 */
export function contagemRegressiva(licenca, agoraMs) {
  if (semPrazo(licenca)) return { texto: `${INFINITO} sem prazo`, tom: "ok" };
  const fim = fimDoPlano(licenca);
  if (fim === null) return null;
  const teste = licenca?.status === "trialing";
  if (!teste && !(licenca?.plan === "pro" && licenca?.status === "active")) return null;
  const de = teste ? "de teste" : "do Pro";
  const falta = fim - agoraMs;
  if (falta <= 0) { const d = Math.floor(-falta / DIA); return { texto: d === 0 ? `${teste ? "teste" : "Pro"} venceu hoje` : `${teste ? "teste" : "Pro"} venceu há ${d} dia${d === 1 ? "" : "s"}`, tom: "mau" }; }
  if (falta <= DIA) { const h = Math.ceil(falta / HORA); return { texto: h <= 1 ? `falta menos de 1 hora ${de}` : `faltam ${h} horas ${de}`, tom: "mau" }; }
  return { texto: `faltam ${diasAteOFim(licenca, agoraMs)} dias ${de}`, tom: "ok" };
}

/**
 * A fase da conta, para o admin acompanhar na lista: trial (dias restantes), trial vencido, Pro ativo, expirado, free.
 * Conta de super admin (`semPrazo`): "Pro · ∞".
 */
export function fase(l, agora = Date.now()) {
  if (semPrazo(l)) return { texto: `Pro · ${INFINITO}`, tom: "ok" };
  const dias = diasAteOFim(l, agora); // a mesma conta da contagem regressiva da página Plano
  if (l.status === "trialing") return dias === null ? { texto: "Trial", tom: "ok" } : dias >= 0 ? { texto: `Trial · ${dias === 0 ? "último dia" : `${dias} dia${dias === 1 ? "" : "s"}`}`, tom: "ok" } : { texto: `Trial venceu há ${-dias} dia${dias === -1 ? "" : "s"}`, tom: "mau" };
  if (l.status === "active" && l.plan === "pro") return dias !== null && dias < 0 ? { texto: `Pro venceu há ${-dias} dia${dias === -1 ? "" : "s"}`, tom: "mau" } : { texto: dias === null ? "Pro ativo" : `Pro · ${dias} dia${dias === 1 ? "" : "s"}`, tom: "ok" };
  if (l.status === "expired") return { texto: "Expirado", tom: "mau" };
  return { texto: "Free", tom: "" };
}

/**
 * O que o "Assinar" manda à API além dos ids do GA4. Add-on: só o `produto`. Pro com a promoção na tela: `promo: true`
 * (se o prazo acabou, a API recusa em vez de abrir o preço cheio sem avisar), ou `semPromo: true` quando a pessoa
 * escolheu pagar por Pix, sem o desconto (o cupom só vale no cartão).
 */
export function pedidoAssinar(produto, promoMostrada, semPromo = false, cupom = false) {
  if (produto !== null && produto !== undefined) return { produto };
  // "Tenho um cupom" › Cartão (`true`): a pessoa vai direto à página de pagamento e digita o código lá.
  // "Tenho um cupom" › Pix (`{pix: código}`): o nosso servidor confere o código e abre o Pix do primeiro mês.
  // Os dois valem no lugar da promoção da tela.
  if (cupom === true) return { cupom: true };
  if (cupom !== null && typeof cupom === "object" && typeof cupom.pix === "string" && cupom.pix.trim() !== "") return { cupom: true, pix: true, codigo: cupom.pix.trim() };
  if (promoMostrada === null || promoMostrada === undefined) return {};
  return semPromo ? { semPromo: true } : { promo: true };
}

/**
 * As vagas de máquina da conta, para a tela explicar a conta: `limite` é o total em vigor e `extras` quantas delas
 * são máquinas extras pagas; o resto é o que o plano inclui. Valores fora da forma (API antiga) viram 1 e 0.
 */
export function vagasDeMaquina(limite, extras) {
  const total = Number.isInteger(limite) && limite >= 1 ? limite : 1;
  const pagas = Number.isInteger(extras) && extras >= 0 ? Math.min(extras, total - 1) : 0;
  const inclusas = total - pagas;
  const detalhe = pagas === 0 ? "" : `${inclusas} inclusa${inclusas === 1 ? "" : "s"} + ${pagas} extra${pagas === 1 ? "" : "s"}`;
  return { total, inclusas, extras: pagas, detalhe };
}

/**
 * As vagas de device da conta, como `vagasDeMaquina`: `limite` é o total em vigor (licenca.deviceLimit, que a API já
 * entrega somado) e `extras` quantas delas são devices extras pagos.
 */
export function vagasDeDevice(limite, extras) {
  const v = vagasDeMaquina(limite, extras);
  return { ...v, detalhe: v.extras === 0 ? "" : `${v.inclusas} incluso${v.inclusas === 1 ? "" : "s"} + ${v.extras} extra${v.extras === 1 ? "" : "s"}` };
}

/**
 * Por que a conta não pode criar uma organização agora, para a tela "Nova organização": o texto e o caminho (`ir`).
 * `orgCriar` é o `conta.orgCriar` da API ({limite, donaDe, motivo}); null quando pode criar (ou a API é antiga).
 */
export function bloqueioDeOrg(orgCriar) {
  if (orgCriar?.motivo === "sem-pro") return { texto: "Criar organização faz parte do Pro assinado. O teste grátis não inclui: assine o Pro e crie a sua.", ir: { rotulo: "Ver o Pro", caminho: "/account/plan" } };
  if (orgCriar?.motivo === "no-limite") return { texto: orgCriar.limite === 1 ? "A sua conta já tem uma organização, e o plano inclui uma. Para criar outra, fale com o suporte." : `A sua conta já tem ${orgCriar.donaDe} organizações, o limite dela. Para criar outra, fale com o suporte.`, ir: { rotulo: "Falar com o suporte", caminho: "/account/support" } };
  return null;
}

/**
 * O aviso da lista de Macs vazia: como um Mac entra na conta e que cada ambiente tem a sua lista. O console de staging
 * só conhece quem entrou pelo app de teste; o de produção, quem entrou pelo app meu-bot.
 */
export function semDevices(canal) {
  return canal === "staging"
    ? "Nenhum Mac ainda neste ambiente de teste. Um Mac aparece aqui quando você entra com esta conta no app meu-bot-staging. Quem entrou só pelo app meu-bot (produção) aparece no console de produção, não aqui."
    : "Nenhum Mac ainda. Um Mac aparece aqui quando você entra com esta conta no app meu-bot desse Mac. Se o app está aberto e nada aparece, saia da conta no app e entre de novo.";
}
/**
 * "Macs: cursor, notebook. Máquinas: meu-box-2." para a Visão geral; null quando a conta não é usada em lugar nenhum.
 * `linhas` são as de `linhasDeMaquinas`; Mac pendente entra com "(pendente)".
 */
export function resumoDeUso(devices, linhas) {
  const macs = (Array.isArray(devices) ? devices : []).map((d) => `${d.name || String(d.id).slice(0, 8)}${d.status === "pending" ? " (pendente)" : ""}`);
  const maqs = (Array.isArray(linhas) ? linhas : []).map((l) => l.nome);
  if (macs.length === 0 && maqs.length === 0) return null;
  return [macs.length > 0 ? `Macs com o app: ${macs.join(", ")}.` : "Nenhum Mac com o app.", maqs.length > 0 ? `Máquinas do agente: ${maqs.join(", ")}.` : "Nenhuma máquina do agente."].join(" ");
}

/**
 * As linhas da lista "Máquinas que você usa" (Devices): primeiro as que usam a licença da conta (`maquinas`), depois as
 * que a pessoa abre pelo app e rodam com a licença do admin (`maquinasVistas`). Só as primeiras ocupam vaga; `ocupadas`
 * é a conta de vagas, igual à do servidor (tirada segura a vaga até a última emissão vencer).
 */
export function linhasDeMaquinas(maquinas, vistas, agoraMs = Date.now()) {
  const ocupa = (m) => !m.desvinculadaEm || (typeof m.proAte === "string" && Date.parse(m.proAte) > agoraMs);
  const nome = (m) => (typeof m.apelido === "string" && m.apelido !== "" ? m.apelido : `máquina ${String(m.id).slice(0, 8)}`);
  const daConta = (Array.isArray(maquinas) ? maquinas : []).map((m) => ({ id: m.id, nome: nome(m), selo: !m.desvinculadaEm ? "Em uso" : ocupa(m) ? "Tirada · vaga presa" : "Tirada", tom: !m.desvinculadaEm ? "ok" : "", valeAte: m.proAte ?? null, acao: !m.desvinculadaEm ? "tirar-licenca" : null, ocupaVaga: ocupa(m) }));
  const ids = new Set(daConta.map((l) => l.id));
  const doAdmin = (Array.isArray(vistas) ? vistas : []).filter((v) => v && !ids.has(v.id)).map((v) => ({ id: v.id, nome: nome(v), selo: "Em uso · licença do admin", tom: "ok", valeAte: null, acao: "tirar-da-lista", ocupaVaga: false }));
  return { linhas: [...daConta, ...doAdmin], ocupadas: daConta.filter((l) => l.ocupaVaga).length, semVaga: doAdmin.length };
}

/** A máquina extra vale junto com o Pro: só quem tem o Pro valendo (pago ou em teste, sem ter vencido) pode adicionar. O super admin não: já não tem limite. */
export function podeAdicionarMaquina(licenca, agoraMs = Date.now()) {
  if (semPrazo(licenca)) return false; // super admin: máquinas sem limite, nada a comprar
  if (licenca?.plan !== "pro" || (licenca.status !== "active" && licenca.status !== "trialing")) return false;
  const fim = fimDoPlano(licenca);
  return fim === null || fim > agoraMs;
}

/**
 * O painel de um add-on que a conta JÁ tem, na página Plano. Pagar um add-on tem dois passos: o pagamento o ativa na
 * conta na hora, mas ele só aparece no app depois de liberado na máquina, e isso é um pedido que o suporte atende
 * ("Liberar na máquina"). `liberacoes` é o `conta.liberacoes` da API ({produto, aberta}, um item por add-on que teve
 * esse pedido). O Pro não passa por aqui: ele não tem o segundo passo.
 * - pedido aberto: o painel aparece sempre (não só na volta do pagamento), dizendo o que falta e com quem está;
 * - pedido atendido: só na volta do pagamento (`voltou`), dizendo que o suporte marcou a liberação como feita (o
 *   "Atender" do admin só fecha o pedido: a tela não afirma o estado da máquina);
 * - sem pedido conhecido (API antiga, add-on concedido pelo admin): só na volta do pagamento, sem afirmar em que pé
 *   está a máquina.
 * Devolve null quando não há o que mostrar. Nenhum texto promete prazo nem aviso (não existe envio automático).
 */
export function avisoAddonPago(rotulo, nome, liberacoes, voltou) {
  const l = (Array.isArray(liberacoes) ? liberacoes : []).find((x) => x && x.produto === nome) ?? null;
  const pago = `Pagamento confirmado: o ${rotulo} está ativo nesta conta.`;
  if (l !== null && l.aberta === true) return { estado: "falta-maquina", texto: `${pago} Falta um passo para ele aparecer no app: a liberação na sua máquina. O pedido já está com o suporte. Quando for liberado, ele aparece na página Módulos do app.` };
  if (voltou !== true) return null;
  if (l !== null && l.aberta === false) return { estado: "liberado", texto: `${pago} O suporte já marcou a liberação na sua máquina como feita: ele deve aparecer na página Módulos do app. Se não aparecer, fale com o suporte.` };
  return { estado: "sem-pedido", texto: `${pago} Ele aparece no app depois de liberado na sua máquina; se não aparecer, fale com o suporte.` };
}

/** Com o Pro valendo sem assinatura, a oferta só volta quando faltam estes dias ou menos para ele acabar. */
export const DIAS_PARA_OFERTAR = 7;
/**
 * O painel "Assinar o Pro" aparece? Quem já tem o Pro não vê oferta do que já tem:
 * - super admin (sem prazo) e assinatura em andamento: nunca;
 * - Pro valendo sem assinatura (liberado pelo admin, ou cancelado com o mês pago): só nos últimos DIAS_PARA_OFERTAR
 *   dias, para a pessoa assinar antes de ficar sem; Pro sem data de fim não vê;
 * - teste grátis, teste vencido, expirado e free: sempre.
 */
export function ofertaDoProAparece(licenca, assinaturas, agoraMs) {
  const e = estadoAssinaturaPro(licenca, assinaturas);
  if (e.semPrazo === true || e.pagoAtivo) return false;
  if (!e.proSemAssinatura) return true;
  const dias = diasAteOFim(licenca, agoraMs);
  return dias !== null && dias <= DIAS_PARA_OFERTAR;
}

/**
 * O que a Visão geral oferece no topo a quem já não vê a oferta do Pro: os add-ons do catálogo que a conta ainda não
 * tem (Finanças e os que vierem). Enquanto a oferta do Pro está na tela, nada: uma oferta por vez.
 */
export function addonsNaVisaoGeral(ofertaDoPro, produtos, addons) {
  if (ofertaDoPro) return [];
  const tem = Array.isArray(produtos) ? produtos : [];
  return (Array.isArray(addons) ? addons : []).filter((a) => a && !tem.includes(a.nome));
}

/**
 * A linha "De R$ 97 por R$ 47 por mês" de uma unidade extra: só quando o catálogo traz o preço de tabela (`deCentavos`)
 * e ele é maior que o preço cobrado; senão null (a tela mostra só o preço).
 */
export function deParaDoExtra(extra) {
  const de = extra?.deCentavos, por = extra?.centavos;
  return Number.isInteger(de) && Number.isInteger(por) && de > por && por > 0 ? { de: reaisCurto(de), por: reaisCurto(por) } : null;
}

/** Onde o painel "Assinar o Pro" fica na página aberta: na vaga do Plano ou do Marketplace quando a pessoa está numa delas; no topo da Visão geral em qualquer outra. */
export function vagaDoAssinar(secao) {
  return secao === "plan" ? "pl-assinar-vaga" : secao === "marketplace" ? "mk-assinar-vaga" : "ov-assinar-vaga";
}

/**
 * O texto do painel de contratar uma unidade extra, na página do item: só o que a ficha acima não diz. A ficha já tem
 * o nome, o que é e o preço; aqui fica a situação desta conta (quanto o plano cobre agora, quem está esperando vaga) e
 * como o pagamento funciona. `tipo`: "maquina" ou "device"; `vagas` vem de vagasDeMaquina/vagasDeDevice.
 */
export function situacaoDaUnidade(tipo, vagas, pendentes = 0) {
  const total = vagas?.total ?? 1, detalhe = vagas?.detalhe ? ` (${vagas.detalhe})` : "";
  const cobre = tipo === "device" ? `Hoje o seu plano cobre ${total} Mac${total === 1 ? "" : "s"} com o app${detalhe}.` : `Hoje o seu plano cobre ${total} máquina${total === 1 ? "" : "s"}${detalhe}.`;
  const fila = tipo === "device" && pendentes > 0 ? ` Você tem ${pendentes} Mac${pendentes === 1 ? "" : "s"} esperando vaga: com o pagamento confirmado, o que pediu primeiro entra sozinho.` : "";
  return `${cobre}${fila} O pagamento é feito na página segura da AbacatePay, a vaga abre assim que ele é confirmado, e você cancela quando quiser.`;
}
/** O texto do painel de contratar um app, na página do item: o que a ficha não diz (como paga, quando entra, como cancela). */
export function situacaoDoApp(rotulo) {
  return `Assinatura à parte do Pro. O pagamento é feito na página segura da AbacatePay, e o ${rotulo} entra nesta conta assim que o pagamento é confirmado; para ele aparecer no app, o suporte ainda o libera na sua máquina. Você cancela quando quiser e o acesso continua até o fim do mês pago.`;
}

/**
 * O item do Marketplace como o Analytics o conhece: o mesmo `item_id` que o servidor manda no `purchase` (compraGa4:
 * "pro-mensal", "meu-bot-finance-mensal", "extra-maquina-mensal"), para a vitrine, o clique e a compra se ligarem.
 */
export function itemGa(item) {
  const id = typeof item?.id === "string" ? item.id : "";
  return { item_id: `${id}-mensal`, item_name: typeof item?.nome === "string" ? item.nome : id, item_category: typeof item?.tipo === "string" ? item.tipo : "" };
}

/**
 * O selo de um item do Marketplace para esta conta: `tem` (já tem), `teste` (o Pro em teste grátis), `falta-liberar`
 * (app pago que o suporte ainda não liberou na máquina), `precisa-pro` (unidade extra sem o Pro valendo) ou
 * `disponivel`. `item` é a ficha entregue pelo config.js ({id, tipo}); super admin tem tudo.
 */
export function estadoDoItem(conta, item) {
  const l = conta?.licenca ?? {};
  const tem = (texto = "Você tem") => ({ chave: "tem", texto, tom: "ok" }), disponivel = { chave: "disponivel", texto: "Disponível", tom: "" };
  if (semPrazo(l)) return tem();
  const proValendo = l.plan === "pro" && (l.status === "active" || l.status === "trialing");
  if (item?.tipo === "plano") return !proValendo ? disponivel : l.status === "trialing" ? { chave: "teste", texto: "Em teste grátis", tom: "ok" } : tem();
  if (item?.tipo === "unidade") {
    const n = item.id === "extra-maquina" ? conta?.maquinaExtras : item.id === "extra-device" ? conta?.deviceExtras : 0;
    if (Number.isInteger(n) && n > 0) return tem(`Você tem ${n}`);
    return podeAdicionarMaquina(l) ? disponivel : { chave: "precisa-pro", texto: "Precisa do Pro", tom: "" };
  }
  if (!(Array.isArray(l.produtos) ? l.produtos : []).includes(item?.id)) return disponivel;
  const lib = (Array.isArray(conta?.liberacoes) ? conta.liberacoes : []).find((x) => x && x.produto === item.id);
  return lib && lib.aberta === true ? { chave: "falta-liberar", texto: "Falta liberar na máquina", tom: "" } : tem();
}

/**
 * As assinaturas da conta para um item do Marketplace: o Pro é a de `produto` nulo; os outros, a do nome técnico. As
 * ativas primeiro; as canceladas ficam para a pessoa ver até quando o acesso vale.
 */
export function assinaturasDoItem(assinaturas, itemId) {
  const minhas = (Array.isArray(assinaturas) ? assinaturas : []).filter((a) => a && (itemId === "pro" ? a.produto === null || a.produto === undefined : a.produto === itemId));
  return [...minhas.filter((a) => a.status === "ACTIVE"), ...minhas.filter((a) => a.status !== "ACTIVE")];
}

/** Quantas assinaturas ativas de um produto a conta tem (cada unidade extra é uma assinatura). */
export function assinaturasAtivasDe(assinaturas, produto) {
  return (Array.isArray(assinaturas) ? assinaturas : []).filter((a) => a && a.produto === produto && a.status === "ACTIVE").length;
}
/**
 * Na volta do pagamento de um item do Marketplace: o que foi pago já chegou à conta? Add-on: está em
 * `licenca.produtos`. Unidade extra ("extra-…"): há mais assinaturas ativas dela do que havia antes de a pessoa sair
 * para pagar (`antes`, guardado na aba); sem esse número, não dá para saber (false: a tela espera o tempo todo).
 */
export function pagoChegou(conta, produto, antes) {
  if (typeof produto !== "string" || produto === "") return true;
  if (!produto.startsWith("extra-")) return (conta?.licenca?.produtos ?? []).includes(produto);
  return Number.isInteger(antes) && assinaturasAtivasDe(conta?.assinaturas, produto) > antes;
}
/**
 * O que a conta já tem, para o topo do Marketplace: o Pro (quando vale), cada add-on em vigor e as unidades extras
 * pagas. `nomes` traduz o nome técnico para o nome do item (`{"meu-bot-finance": "Finanças"}`).
 */
export function oQueAContaTem(conta, nomes = {}) {
  const l = conta?.licenca ?? {}, out = [];
  if (l.plan === "pro" && (l.status === "active" || l.status === "trialing")) out.push(l.status === "trialing" ? "Pro (teste grátis)" : "Pro");
  for (const p of Array.isArray(l.produtos) ? l.produtos : []) out.push(nomes[p] ?? p);
  const mq = Number.isInteger(conta?.maquinaExtras) ? conta.maquinaExtras : 0, dv = Number.isInteger(conta?.deviceExtras) ? conta.deviceExtras : 0;
  if (mq > 0) out.push(`${mq} máquina${mq === 1 ? "" : "s"} extra${mq === 1 ? "" : "s"}`);
  if (dv > 0) out.push(`${dv} Mac${dv === 1 ? "" : "s"} extra${dv === 1 ? "" : "s"}`);
  return out;
}

/**
 * O aviso da página Plano para quem volta do pagamento (`?assinatura=paga`): com a assinatura do Pro em andamento, está
 * confirmado. Pro ativo sem assinatura é o primeiro mês pago por Pix (compra avulsa, sem assinatura) ou um Pro que a
 * conta já tinha antes de assinar: a tela diz até quando vale e continua esperando a assinatura aparecer, se houver.
 * `data` formata o dia como o resto do console.
 */
export function voltaDoPagamento(licenca, assinaturas, data = (iso) => iso) {
  const { pagoAtivo, proSemAssinatura } = estadoAssinaturaPro(licenca, assinaturas);
  if (pagoAtivo) return { texto: "Pagamento confirmado: o Pro está ativo.", esperar: false };
  if (proSemAssinatura) return { texto: `O Pro está ativo${licenca?.expiresAt ? ` até ${data(licenca.expiresAt)}` : ""}. Se você acabou de assinar, a assinatura aparece aqui em alguns segundos.`, esperar: true };
  return { texto: "Recebemos você de volta. Assim que a AbacatePay confirmar o pagamento, o Pro aparece aqui (costuma levar alguns segundos).", esperar: true };
}
