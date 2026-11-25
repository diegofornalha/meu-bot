/**
 * Página própria de um app derivado, lado da janela: carrega o módulo que o empacotamento compilou para dentro do
 * asar (dist/renderer/derivado/pagina.js, de scripts/derivado-codigo.mjs) e chama o `montar` dele com a API estreita
 * do contrato (./api.ts). Só quando `caps.extensao` não é null: nos apps da tabela o renderer.ts nem chama isto.
 *
 * A janela nunca quebra por causa da extensão: módulo que falta, que lança ao carregar ou ao montar fica no console,
 * e o app segue sem a página (o botão da lateral continua escondido). Fábrica com dependências explícitas, como as
 * outras páginas; o `importar` é trocável para o teste rodar em Node.
 */
import type { MeuBotApi } from "../../shared/ipc";
import type { PageTab } from "../lib/pages-types.js";
import type { ExtensaoPaginaApi, IdDaPaginaDeExtensao, PaginaDeExtensao } from "./api.js";

/** Id da página de uma extensão: fixo, para o alfinete, o `abreEm` e o `pagina_abrir` saberem abri-la. */
export const ID_DA_PAGINA_DE_EXTENSAO: IdDaPaginaDeExtensao = "extensao";

export interface ExtensaoDeps {
  panelsEl: HTMLElement;
  definePage(id: string, title: string, panel: HTMLElement, render: () => void): PageTab;
  openPage(page: PageTab): void;
  api: Pick<MeuBotApi, "extInvocar" | "zoomFactorNow" | "on">;
  /** Onde a falha fica registrada (o console da janela). */
  registrar(linha: string): void;
}

const motivo = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** O módulo do derivado, ao lado desta pasta no compilado. Calculado: o arquivo não existe em src/, só no pacote. */
const importarDoPacote = (): Promise<unknown> => import(new URL("../derivado/pagina.js", import.meta.url).href);

/** Monta a página da extensão; null quando ela não carregou (já registrado). Não lança. */
export async function montarExtensao(deps: ExtensaoDeps, importar: () => Promise<unknown> = importarDoPacote): Promise<PaginaDeExtensao | null> {
  try {
    const modulo = await importar();
    const montar = typeof modulo === "object" && modulo !== null ? (modulo as { montar?: unknown }).montar : undefined;
    if (typeof montar !== "function") throw new Error("o código do derivado não exporta a função montar");
    let definida = false;
    const api: ExtensaoPaginaApi = {
      panelsEl: deps.panelsEl,
      // Uma página só, e com o id que o resto do app conhece: outro id criaria uma aba que ninguém sabe reabrir.
      definePage: (id, title, panel, render) => {
        if (id !== ID_DA_PAGINA_DE_EXTENSAO) throw new Error(`a página de uma extensão tem o id "${ID_DA_PAGINA_DE_EXTENSAO}"`);
        if (definida) throw new Error("definePage já foi chamado: uma extensão tem uma página só");
        definida = true;
        return deps.definePage(id, title, panel, render);
      },
      openPage: (page) => { deps.openPage(page); },
      invocar: (nome, payload) => deps.api.extInvocar(nome, payload),
      zoomFactorNow: () => deps.api.zoomFactorNow(),
      aoMudarZoom: (ouvinte) => { deps.api.on("window:zoom-changed", (st) => { ouvinte(st.factor); }); },
    };
    const pagina: unknown = (montar as (api: ExtensaoPaginaApi) => unknown)(api);
    const open = typeof pagina === "object" && pagina !== null ? (pagina as { open?: unknown }).open : undefined;
    if (typeof open !== "function") throw new Error("o montar não devolveu { open }");
    return { open: () => { try { open.call(pagina); } catch (e) { deps.registrar(`[extensão] a página não abriu: ${motivo(e)}`); } } };
  } catch (e) {
    deps.registrar(`[extensão] a página não carregou, o app segue sem ela: ${motivo(e)}`);
    return null;
  }
}
