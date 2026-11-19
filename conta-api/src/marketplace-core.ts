/**
 * Marketplace (parte pura): a ficha de cada item que se contrata no meu-bot e a lista do que está à venda num
 * ambiente. A ficha é o texto (um dono só: o console e as páginas públicas leem daqui); preço e disponibilidade vêm
 * do catálogo do ambiente (`ABACATEPAY_PRODUTO`, `ABACATEPAY_ADDONS`, `ABACATEPAY_EXTRAS`). Item sem produto no
 * catálogo do ambiente não entra na lista: o Marketplace só mostra o que se vende ali.
 */
import type { OfertaAddon, OfertaExtra } from "./pagamento-core.js";

/** `plano`: a assinatura base; `app`: função completa que roda em cima do plano (add-on); `unidade`: mais uma vaga (cada assinatura soma 1). */
export type TipoItem = "plano" | "app" | "unidade";
export interface Ficha {
  /** O caminho público do item: /marketplace/<slug>. */
  slug: string;
  tipo: TipoItem;
  /** O nome pelo uso, como aparece no cartão e no título da página. */
  nome: string;
  /** Uma linha: o que é. */
  resumo: string;
  /** Um parágrafo: para que serve e como funciona. */
  descricao: string;
  /** O que a pessoa passa a ter. */
  inclui: readonly string[];
  /** O que é preciso ter antes; null quando não exige nada. */
  exige: string | null;
}
/** O nome técnico do Pro na lista (os add-ons e extras usam o nome do catálogo: "meu-bot-finance", "extra-maquina"). */
export const ITEM_PRO = "pro";
/** O preço de tabela do Pro, em centavos (o "De R$ 997" da oferta; o preço cobrado é ABACATEPAY_PRECO_CENTAVOS). */
export const PRO_DE_CENTAVOS = 99700;
const COM_O_PRO = "Vale junto com o Pro: precisa do plano ativo na mesma conta.";

export const FICHAS: Readonly<Record<string, Ficha>> = {
  [ITEM_PRO]: {
    slug: "pro", tipo: "plano", nome: "Pro",
    resumo: "O plano base: o agente de IA atendendo no WhatsApp, com Navegador, Gmail e CRM.",
    descricao: "O agente atende os seus clientes no WhatsApp com as regras que você define, pelo app para Mac. O plano traz um número dedicado da Coflow para o agente, e libera o Navegador, o Gmail e o CRM do agente.",
    inclui: ["Agente de IA no WhatsApp, com um número dedicado", "Navegador, Gmail e CRM do agente", "2 Macs com o app na mesma conta", "1 máquina para o agente rodar"],
    exige: null,
  },
  "meu-bot-finance": {
    slug: "financas", tipo: "app", nome: "Finanças",
    resumo: "O agente vira o financeiro da empresa no WhatsApp e no chat.",
    descricao: "O agente cuida do financeiro da empresa pelo WhatsApp e pelo chat, e o app ganha a página Finanças e a Curva ABC. É uma assinatura à parte do plano do agente.",
    inclui: ["Financeiro pelo WhatsApp e pelo chat", "Página Finanças no app para Mac", "Curva ABC"],
    exige: "Depois do pagamento, o suporte libera o app na sua máquina.",
  },
  "meu-bot-diego": {
    slug: "modulos-do-diego", tipo: "app", nome: "Módulos do Diego",
    resumo: "Módulos extras para o agente, ligados um a um na página Módulos do app.",
    descricao: "Um conjunto de módulos para o agente, no WhatsApp, no chat e no app para Mac. Cada módulo é ligado separadamente na página Módulos, com o seu próprio tutorial.",
    inclui: ["Módulos ligados um a um, cada um com tutorial", "Uso pelo WhatsApp, pelo chat e pelo app"],
    exige: "Depois do pagamento, o suporte libera os módulos na sua máquina.",
  },
  "extra-maquina": {
    slug: "maquina-extra", tipo: "unidade", nome: "Mais uma máquina para o agente",
    resumo: "Mais um computador remoto para o agente rodar; não é um Mac a mais com o app.",
    descricao: "O agente passa a rodar em mais um computador remoto com a mesma conta. Cada assinatura soma uma máquina ao plano, e a vaga abre assim que o pagamento é confirmado.",
    inclui: ["Mais 1 máquina com a licença da conta", "Vaga aberta na confirmação do pagamento"],
    exige: COM_O_PRO,
  },
  "extra-device": {
    slug: "mac-extra", tipo: "unidade", nome: "Mais um Mac com o app",
    resumo: "Um Mac a mais para você entrar com a conta no app; não é a máquina onde o agente roda.",
    descricao: "O plano inclui 2 Macs com o app. Cada assinatura soma mais um, e o Mac que estava esperando vaga entra sozinho quando o pagamento é confirmado.",
    inclui: ["Mais 1 Mac com o app na mesma conta", "O Mac pendente entra sozinho"],
    exige: COM_O_PRO,
  },
};

/** Um item à venda no ambiente: a ficha mais o preço. `id` é o nome técnico (o `produto` do checkout; "pro" para o plano). */
export interface ItemMarketplace extends Ficha { id: string; centavos: number; deCentavos: number | null }

/** Ficha de reserva para um item do catálogo que ainda não tem texto: aparece pelo rótulo, em vez de sumir da venda. */
const fichaDeReserva = (id: string, rotulo: string, tipo: TipoItem): Ficha => ({ slug: id.replace(/^meu-bot-/, "").replace(/[^a-z0-9-]/g, "-"), tipo, nome: rotulo, resumo: `${rotulo}, em assinatura mensal.`, descricao: `${rotulo}, em assinatura mensal à parte do plano.`, inclui: [], exige: tipo === "unidade" ? COM_O_PRO : null });

/**
 * O que está à venda: o Pro primeiro (a base), depois os apps e as unidades, na ordem do catálogo. `precoPro` null =
 * pagamentos desligados no ambiente: lista vazia. `addons` e `extras` são os que estão à venda (`addonsAVenda`,
 * `extrasAVenda`).
 */
export function itensDoMarketplace(p: { precoPro: number | null; addons: readonly OfertaAddon[]; extras: readonly OfertaExtra[] }): ItemMarketplace[] {
  if (p.precoPro === null) return [];
  const de = (cobrado: number, tabela: number | null | undefined): number | null => (typeof tabela === "number" && tabela > cobrado ? tabela : null);
  const out: ItemMarketplace[] = [{ ...FICHAS[ITEM_PRO]!, id: ITEM_PRO, centavos: p.precoPro, deCentavos: de(p.precoPro, PRO_DE_CENTAVOS) }];
  for (const a of p.addons) out.push({ ...(FICHAS[a.nome] ?? fichaDeReserva(a.nome, a.rotulo, "app")), id: a.nome, centavos: a.centavos, deCentavos: null });
  for (const x of p.extras) out.push({ ...(FICHAS[x.nome] ?? fichaDeReserva(x.nome, x.rotulo, "unidade")), id: x.nome, centavos: x.centavos, deCentavos: de(x.centavos, x.deCentavos) });
  return out;
}
/** O item de um slug público, ou null (slug desconhecido ou item fora do catálogo do ambiente). */
export const itemPorSlug = (itens: readonly ItemMarketplace[], slug: string): ItemMarketplace | null => itens.find((i) => i.slug === slug) ?? null;
