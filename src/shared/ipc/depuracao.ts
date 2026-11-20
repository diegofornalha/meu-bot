/**
 * Modo de depuração (31 out): uma faixa no topo da janela mostra o build, o batimento do processo principal, o
 * túnel e o que chega de fora (ações do agente nos sockets, do Claude Code, hooks). Ligado por padrão no staging;
 * nas outras variantes pela paleta ou `--depuracao`.
 */
export type OrigemDepuracao = "navegador" | "gmail" | "terminal" | "hook" | "nota" | "main" | "atualizacao" | "mcp";
/**
 * Onde a ação aconteceu de verdade, na página de uma aba do Navegador: o centro do elemento clicado ou digitado (px da
 * página) e o tamanho da área visível dela, para a janela converter na tela com o zoom da aba. `aba` = id do webContents.
 */
export interface PontoDepuracao { aba: number; x: number; y: number; vw: number; vh: number }
/** Uma ação vinda de fora, como o main a viu. */
export interface EventoDepuracao { em: number; origem: OrigemDepuracao; dono: string | null; rota: string; ok: boolean; ms: number | null; resumo: string; detalhe?: unknown; ponto?: PontoDepuracao }
/** Tique de 1 s do main; `marca` = a última coisa síncrona que ele anunciou antes de fazer (Chaveiro, ssh). */
export interface BatimentoDepuracao { em: number; marca: string | null; marcaEm: number | null }
/** O que o empacotamento gravou em Resources/build.json; em dev, "dev". */
/** `origem`: "release" quando o empacotamento recebeu `--versao` (scripts/release.mjs); "local" no resto (hook, dist à mão). */
export interface Compilacao { commit: string; branch: string; em: string; origem: "release" | "local" }
export interface EstadoDepuracao {
  ligado: boolean;
  /** O que está gravado nas configurações (null = o padrão da variante decide). */
  gravado: boolean | null;
  padraoDaVariante: boolean;
  /** `--depuracao` na linha de comando: ligado só neste processo. */
  forcado: boolean;
  eventos: EventoDepuracao[];
  batimento: BatimentoDepuracao;
}
