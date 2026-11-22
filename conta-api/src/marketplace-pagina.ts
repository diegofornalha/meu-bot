/**
 * As páginas públicas do Marketplace (parte pura): /marketplace (a lista) e /marketplace/<slug> (um item), montadas a
 * partir de `public/site/marketplace.html` e dos itens à venda no ambiente (`itensDoMarketplace`). O modelo é a página
 * da lista com dois marcadores (`<!--JSONLD-->` e `<!--CORPO-->`); para um item, o título, a descrição e o endereço
 * canônico do modelo são trocados pelos do item. Nada aqui toca rede nem banco.
 */
import { ITEM_PRO, rotuloDoGrupo, type ItemMarketplace } from "./marketplace-core.js";
import { textoDeBusca } from "./ferramentas-core.js";

/** O endereço canônico é sempre o da produção, como nas outras páginas do site (o staging é noindex). */
export const SITE_CANONICO = "https://agentesgrok.com";
/** Título, descrição e caminho da página da lista: os mesmos que estão escritos no modelo (o teste confere). */
export const LISTA = { titulo: "Marketplace do meu-bot · apps e extras para o seu agente de IA", descricao: "O que dá para somar ao meu-bot: apps como o Finanças, mais máquinas para o agente e mais Macs na conta. Preço de cada item e como contratar.", caminho: "/marketplace" } as const;
/** Data da última mudança de texto das páginas do Marketplace (lastmod do sitemap); quem mexer nas fichas atualiza. */
export const REVISAO_MARKETPLACE = "2026-11-21";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** "R$ 97" para valor redondo, "R$ 97,50" para o resto. */
export const reais = (centavos: number): string => `R$ ${centavos % 100 === 0 ? String(centavos / 100) : (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const precoHtml = (i: ItemMarketplace): string => (i.deCentavos !== null ? `De <s>${reais(i.deCentavos)}</s> por <strong>${reais(i.centavos)}</strong> por mês` : `<strong>${reais(i.centavos)}</strong> por mês`);
const TIPO = { plano: "Plano", app: "App", unidade: "Extra", ferramenta: "Ferramenta" } as const;
/** "Ferramenta · Pronta para uso" nas ferramentas; nos outros itens, só o tipo. */
const tipoHtml = (i: ItemMarketplace): string => { const g = rotuloDoGrupo(i); return g === null ? TIPO[i.tipo] : `${TIPO[i.tipo]} · ${esc(g)}`; };
/** Onde o botão de contratar leva: o Pro se assina na página Plano do console; o resto, na página do próprio item no Marketplace do console (é lá que fica o painel de contratar). O site redireciona /account* para o console do ambiente. */
export const caminhoDeContratar = (i: ItemMarketplace): string => (i.id === ITEM_PRO ? "/account/plan" : `/account/marketplace/${i.slug}`);

/** A letra do avatar do cartão: a inicial do nome, sem o "Mais um(a)" das unidades extras. */
const inicial = (nome: string): string => esc(nome.replace(/^Mais uma? /, "").slice(0, 1).toUpperCase());
/**
 * A vitrine: uma grade de cartões no desenho da página Módulos do app (avatar, tipo, nome, resumo e preço). O cartão
 * inteiro é o link para a página do item; ninguém compra daqui. Em cima, a busca: cada cartão leva em `data-busca` o
 * texto em que ela procura (nome, resumo, categoria e exemplo de pedido), e o site.js esconde os que não combinam.
 */
export function corpoDaLista(itens: readonly ItemMarketplace[]): string {
  const cartao = (i: ItemMarketplace): string => `      <a class="mk-cartao" href="/marketplace/${i.slug}" data-mk="ver" data-item="${esc(i.id)}" data-nome="${esc(i.nome)}" data-tipo="${i.tipo}" data-busca="${esc(textoDeBusca(i))}">
        <span class="mk-topo"><span class="mk-avatar" aria-hidden="true">${inicial(i.nome)}</span><span class="mk-tipo">${tipoHtml(i)}</span></span>
        <h2>${esc(i.nome)}</h2>
        <p>${esc(i.resumo)}</p>
        <p class="mk-preco">${precoHtml(i)}</p>
        <span class="mk-mais">Saber mais →</span>
      </a>`;
  return `<h1>Marketplace</h1>
    <p class="meta">O que dá para somar ao meu-bot. O Pro é a base; os apps e os extras são assinaturas mensais à parte, que você contrata e cancela pelo console da conta. Toque num item para saber mais.</p>
    <p class="mk-busca"><input type="search" id="mk-busca" placeholder="Buscar no Marketplace: Gmail, planilha, agenda…" aria-label="Buscar no Marketplace" autocomplete="off"></p>
    <p class="meta" id="mk-busca-vazio" hidden>Nada no Marketplace combina com essa busca.</p>
    <div class="mk-grade">
${itens.map(cartao).join("\n")}
    </div>`;
}

export function corpoDoItem(i: ItemMarketplace): string {
  const inclui = i.inclui.length === 0 ? "" : `\n    <h2>O que você passa a ter</h2>\n    <ul>\n${i.inclui.map((x) => `      <li>${esc(x)}</li>`).join("\n")}\n    </ul>`;
  const exige = i.exige === null ? "" : `\n    <h2>O que é preciso</h2>\n    <p>${esc(i.exige)}</p>`;
  const pedir = i.exemplo === undefined ? "" : `\n    <h2>O que dá para pedir</h2>\n    <p>Por exemplo: “${esc(i.exemplo)}”</p>`;
  return `<p class="meta"><a href="/marketplace">Marketplace</a> › ${tipoHtml(i)}</p>
    <h1>${esc(i.nome)}</h1>
    <p>${esc(i.resumo)}</p>
    <p class="mk-preco">${precoHtml(i)}</p>
    <p><a class="btn btn-primary" href="${caminhoDeContratar(i)}" data-mk="contratar" data-item="${esc(i.id)}" data-nome="${esc(i.nome)}" data-tipo="${i.tipo}" data-valor="${(i.centavos / 100).toFixed(2)}">Contratar pelo console</a></p>
    <h2>Como funciona</h2>
    <p>${esc(i.descricao)}</p>${pedir}${inclui}${exige}
    <p class="meta">Assinatura mensal, paga na página segura da AbacatePay. Você cancela quando quiser, pelo console da conta, e o acesso continua até o fim do mês pago.</p>`;
}

const migalhas = (trilha: readonly { nome: string; caminho: string }[]): Record<string, unknown> => ({ "@type": "BreadcrumbList", itemListElement: trilha.map((t, n) => ({ "@type": "ListItem", position: n + 1, name: t.nome, item: `${SITE_CANONICO}${t.caminho}` })) });
const pagina = (titulo: string, descricao: string, caminho: string): Record<string, unknown> => ({ "@type": "WebPage", "@id": `${SITE_CANONICO}${caminho}`, url: `${SITE_CANONICO}${caminho}`, name: titulo, description: descricao, inLanguage: "pt-BR", isPartOf: { "@id": `${SITE_CANONICO}/#website` }, publisher: { "@id": `${SITE_CANONICO}/#coflow` } });
const oferta = (i: ItemMarketplace): Record<string, unknown> => ({ "@type": "Offer", price: (i.centavos / 100).toFixed(2), priceCurrency: "BRL", availability: "https://schema.org/InStock", url: `${SITE_CANONICO}/marketplace/${i.slug}`, priceSpecification: { "@type": "UnitPriceSpecification", price: (i.centavos / 100).toFixed(2), priceCurrency: "BRL", billingDuration: "P1M", unitCode: "MON" } });

/** Os dados estruturados da lista: a página, as migalhas e a lista de itens. */
export function jsonLdDaLista(itens: readonly ItemMarketplace[]): Record<string, unknown> {
  return { "@context": "https://schema.org", "@graph": [pagina(LISTA.titulo, LISTA.descricao, LISTA.caminho), migalhas([{ nome: "Início", caminho: "/" }, { nome: "Marketplace", caminho: "/marketplace" }]), { "@type": "ItemList", itemListElement: itens.map((i, n) => ({ "@type": "ListItem", position: n + 1, name: i.nome, url: `${SITE_CANONICO}/marketplace/${i.slug}` })) }] };
}
export const tituloDoItem = (i: ItemMarketplace): string => `${i.nome} · Marketplace do meu-bot`;
/** Os dados estruturados de um item: a página, as migalhas e o produto com a oferta (preço mensal em reais). */
export function jsonLdDoItem(i: ItemMarketplace): Record<string, unknown> {
  const caminho = `/marketplace/${i.slug}`;
  return { "@context": "https://schema.org", "@graph": [pagina(tituloDoItem(i), i.resumo, caminho), migalhas([{ nome: "Início", caminho: "/" }, { nome: "Marketplace", caminho: "/marketplace" }, { nome: i.nome, caminho }]), { "@type": "Product", name: i.nome, description: i.descricao, brand: { "@type": "Brand", name: "meu-bot" }, image: `${SITE_CANONICO}/site/capa-v2.jpg`, offers: oferta(i) }] };
}

/**
 * A página pronta. `item` null = a lista. No modelo, o título, a descrição e o caminho da lista aparecem escritos
 * (LISTA): para um item, cada ocorrência deles é trocada pelos do item. O JSON-LD vai num bloco de dados
 * (`application/ld+json`), com `<` escapado para nunca fechar a tag.
 */
export function paginaDoMarketplace(modelo: string, itens: readonly ItemMarketplace[], item: ItemMarketplace | null): string {
  const jsonld = JSON.stringify(item === null ? jsonLdDaLista(itens) : jsonLdDoItem(item)).replace(/</g, "\\u003c");
  let html = modelo.replace("<!--JSONLD-->", `<script type="application/ld+json">${jsonld}</script>`).replace("<!--CORPO-->", item === null ? corpoDaLista(itens) : corpoDoItem(item));
  if (item !== null) {
    html = html.split(esc(LISTA.titulo)).join(esc(tituloDoItem(item))).split(esc(LISTA.descricao)).join(esc(item.resumo)).split(`${SITE_CANONICO}${LISTA.caminho}"`).join(`${SITE_CANONICO}/marketplace/${item.slug}"`);
  }
  return html;
}

/** A seção "Marketplace" do llms.txt: um item por linha, com o preço; "" quando não há nada à venda. */
export function llmsDoMarketplace(itens: readonly ItemMarketplace[]): string {
  if (itens.length === 0) return "";
  return `\n## Marketplace\n\nO que se contrata no meu-bot, em assinatura mensal, pelo console da conta.\n\n${itens.map((i) => `- [${i.nome}](${SITE_CANONICO}/marketplace/${i.slug}): ${i.resumo} ${reais(i.centavos)} por mês.`).join("\n")}\n`;
}
