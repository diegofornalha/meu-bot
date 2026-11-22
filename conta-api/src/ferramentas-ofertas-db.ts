/**
 * As ferramentas à venda, lidas do banco (`ferramentas_ofertas`, que o super admin preenche pelo console). Quem
 * pergunta é o Marketplace: o /config.js do console, as páginas públicas, o sitemap e o llms.txt. Para não consultar o
 * banco a cada página, a resposta fica um minuto na memória do Worker; uma mudança de preço neste mesmo Worker a
 * esquece na hora (`esquecerOfertasEmMemoria`), e nos outros ela aparece em até um minuto.
 */
import { CATALOGO } from "./ferramentas-catalogo.js";
import { lerOfertasDeFerramentas, type OfertaFerramenta } from "./ferramentas-core.js";

export const MEMORIA_DAS_OFERTAS_MS = 60_000;
let memoria: { em: number; db: D1Database; ofertas: OfertaFerramenta[] } | null = null;
export function esquecerOfertasEmMemoria(): void { memoria = null; }

/**
 * As ofertas com `a_venda = 1`, validadas contra o catálogo, na ordem dele. Tabela ausente (migração ainda não
 * aplicada) = nenhuma. Banco fora do ar = a última resposta boa (mesmo vencida), para o Marketplace não esvaziar.
 */
export async function ofertasAVendaNoBanco(db: D1Database, agora = Date.now()): Promise<OfertaFerramenta[]> {
  if (memoria !== null && memoria.db === db && agora - memoria.em < MEMORIA_DAS_OFERTAS_MS) return memoria.ofertas;
  let linhas: { slug: string; produto: string; centavos: number }[] = [];
  try { linhas = (await db.prepare("SELECT slug, produto, centavos FROM ferramentas_ofertas WHERE a_venda = 1").all<{ slug: string; produto: string; centavos: number }>()).results; }
  catch (e) {
    // Só a tabela ausente (ambiente sem a migração 0025) é "nenhuma ferramenta", e essa resposta pode ficar na memória.
    // Qualquer outra falha do banco não pode esvaziar o Marketplace por um minuto: vale a última resposta boa, se
    // houver, e a próxima consulta tenta de novo (nada é guardado aqui).
    if (!/no such table/i.test(String(e))) { console.error(`ofertas das ferramentas: o banco falhou (${String(e).slice(0, 200)})`); return memoria !== null && memoria.db === db ? memoria.ofertas : []; }
    linhas = [];
  }
  const ofertas = lerOfertasDeFerramentas(Object.fromEntries(linhas.map((l) => [l.slug, { produto: l.produto, centavos: l.centavos }])), CATALOGO);
  memoria = { em: agora, db, ofertas };
  return ofertas;
}
