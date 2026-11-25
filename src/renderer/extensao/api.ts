/**
 * Contrato · Página própria de um app derivado (a "extensão"), lado da janela. Só tipos. O lado do processo principal
 * está em src/shared/ipc/derivado.ts. `codigo/pagina.ts` do derivado faz `import type` daqui e recebe tudo por
 * argumento: não importa módulo nenhum do app, só arquivos da própria pasta `codigo/` (docs/guia/derivados.md).
 */
import type { PageTab } from "../lib/pages-types.js";

export type { PageTab };

/** Id fixo da página de uma extensão: aba, alfinete (📌), `abreEm` da ficha e `pagina_abrir` do controle externo usam este. */
export type IdDaPaginaDeExtensao = "extensao";

/** O que o core entrega a `montar`, na janela. Estreito de propósito: o que faltar entra no core, para todos. */
export interface ExtensaoPaginaApi {
  /** Onde os painéis das páginas moram: a extensão acrescenta o dela aqui. */
  panelsEl: HTMLElement;
  /** Registra a página (uma só, de id "extensao"); `render` roda a cada vez que ela vem para a frente. */
  definePage(id: IdDaPaginaDeExtensao, title: string, panel: HTMLElement, render: () => void): PageTab;
  /** Põe a página na frente. */
  openPage(page: PageTab): void;
  /** Chama um canal que o `codigo/main.ts` registrou; a resposta é o que o handler devolveu (não confie no formato: confira). */
  invocar(nome: string, payload: unknown): Promise<unknown>;
  /** Zoom da janela agora (Cmd+= / Cmd+-; 1 = 100%). */
  zoomFactorNow(): number;
  /** Avisa a cada mudança do zoom da janela, com o fator novo (o `zoomFactorNow` ainda pode devolver o antigo nessa hora). */
  aoMudarZoom(ouvinte: (fator: number) => void): void;
}

/** O que `montar` devolve: o core chama `open` no clique do botão da lateral, no `abreEm`, no alfinete e no `pagina_abrir`. */
export interface PaginaDeExtensao {
  open(): void;
}

/** `codigo/pagina.ts` exporta `montar` com esta assinatura. */
export type MontarExtensao = (api: ExtensaoPaginaApi) => PaginaDeExtensao;
