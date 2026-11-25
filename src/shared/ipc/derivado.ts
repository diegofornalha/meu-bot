/**
 * Contrato · Página própria de um app derivado (a "extensão"), lado do processo principal. Só tipos; reexportado por
 * src/shared/ipc.ts. O lado da janela está em src/renderer/extensao/api.ts (ele usa tipos do DOM, que o main não tem).
 *
 * Um derivado (docs/guia/derivados.md) pode trazer UMA página: `codigo/main.ts` roda no processo principal e
 * `codigo/pagina.ts` na janela. Do core, os dois só fazem `import type` deste contrato; o que precisam chega por
 * argumento, e fora isso importam só arquivos da própria pasta `codigo/`. O código é compilado pelo core no
 * empacotamento (scripts/derivado-codigo.mjs) e vai dentro do asar.
 */

/**
 * Versão deste contrato. A ficha do derivado diz qual ela fala (`extensao.api`); o core recusa a ficha que pede outra.
 * O valor em tempo de execução é `DERIVADO_API` (src/main/app/variant-core.ts), amarrado a este tipo.
 */
export type DerivadoApiVersao = 1;

/** O controle externo (MCP) deste app de pé (porta, chave e endereço para um cliente falar com ele), ou o que falta, em pt-BR. */
export type ControleRemotoGarantido =
  | { ok: true; porta: number; token: string; url: string }
  | { ok: false; erro: string };

/** Handler de um canal da extensão: recebe o que a página mandou (não confie: valide) e devolve o que ela recebe. */
export type ExtensaoHandler = (payload: unknown) => Promise<unknown>;

/** O único `<webview>` que a extensão pode usar. */
export interface ExtensaoWebview {
  /** Partição do `<webview>`: `ext-<nome>` (minúsculas, dígitos e hífen). Sempre em memória: nada dela fica no disco. */
  particao: string;
  /** A URL que o `<webview>` pode carregar ao nascer. Daí em diante ele só navega dentro da origem em que está. */
  urlPermitida(url: string): boolean;
}

/** O que o core entrega a `ativar`, no processo principal. Estreito de propósito: o que faltar entra no core, para todos. */
export interface ExtensaoMainApi {
  /** Pasta só da extensão, dentro dos dados do app (`<dados>/extensao`). O core não a cria. */
  readonly pastaDados: string;
  /** Uma linha no log do app (o mesmo arquivo do resto). */
  log(linha: string): void;
  /** Caminho do `node` deste computador (Homebrew, /usr/local, ~/.local, nvm…), ou null. */
  acharNode(): string | null;
  readonly controleRemoto: {
    /** Liga o controle externo (MCP) deste app se ainda não está de pé e devolve como falar com ele. */
    garantir(): Promise<ControleRemotoGarantido>;
  };
  /**
   * Registra um canal que a página chama com `invocar(nome, payload)`. Nome: `^[a-z][a-z0-9-]{0,40}$`, uma vez só.
   * Só durante o `ativar`: depois dele a lista de canais está fechada.
   */
  canal(nome: string, handler: ExtensaoHandler): void;
  /** Declara o `<webview>` da extensão (um só, e só durante o `ativar`). Sem declarar, a página não tem `<webview>`. */
  webview(w: ExtensaoWebview): void;
}

/** O que `ativar` devolve: o core chama `encerrar` ao sair do app (processos filhos, arquivos temporários). */
export interface ExtensaoMain {
  encerrar(): void;
}

/** `codigo/main.ts` exporta `ativar` com esta assinatura. */
export type AtivarExtensao = (api: ExtensaoMainApi) => ExtensaoMain;

/** Payload do canal IPC `ext:invoke`, o único por onde a página de uma extensão fala com o processo principal. */
export interface ExtInvoke {
  nome: string;
  payload: unknown;
}
