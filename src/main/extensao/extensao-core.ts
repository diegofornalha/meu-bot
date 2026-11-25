/**
 * Página própria de um app derivado (a "extensão"), parte pura do processo principal: o registro do que o código do
 * derivado declara no `ativar` (canais e o `<webview>`), o despacho do canal IPC único `ext:invoke` e a regra de
 * navegação do `<webview>`. Sem Electron: testável com node --test. Quem carrega o código é o extensao.ts; o contrato
 * está em src/shared/ipc/derivado.ts e em docs/guia/derivados.md.
 *
 * Por que um canal só: os canais IPC do app são listas literais (ipc-policy.ts, preload.ts), e canal de derivado não
 * pode entrar nelas. O `ext:invoke` leva `{ nome, payload }`, e o nome escolhe o handler que a extensão registrou.
 */
import type { ExtensaoHandler, ExtensaoWebview } from "../../shared/ipc";

/** Nome de um canal de extensão: curto, minúsculo, sem nada que lembre um caminho ou um canal do core. */
export const NOME_DE_CANAL_RE = /^[a-z][a-z0-9-]{0,40}$/;
/**
 * Partição do `<webview>` de uma extensão. O prefixo `ext-` é obrigatório: assim ela nunca coincide com uma partição
 * do core (`persist:navegador-…`, `computador-…`, `modulo-…`, `inspector`), cujos cookies e regras não são dela. Sem
 * `persist:`, a sessão é só de memória.
 */
export const PARTICAO_DE_EXTENSAO_RE = /^ext-[a-z0-9-]{1,40}$/;
/** Toda partição com este prefixo é de extensão: a que não foi declarada é recusada ao anexar (windows.ts). */
export const PREFIXO_PARTICAO_DE_EXTENSAO = "ext-";

export const ERRO_SEM_EXTENSAO = "este app não tem página de extensão";
export const ERRO_EXTENSAO_NAO_CARREGOU = "a extensão deste app não carregou (veja o log do app)";

export interface RegistroDeExtensao {
  /** `api.canal` do contrato: lança se o nome é inválido, repetido, ou se o `ativar` já terminou. */
  canal(nome: string, handler: ExtensaoHandler): void;
  /** `api.webview` do contrato: lança se a partição é inválida, se já houve uma declaração ou se o `ativar` já terminou. */
  webview(w: ExtensaoWebview): void;
  /** Fim do `ativar`: daqui em diante nada mais é registrado. */
  fechar(): void;
  handler(nome: string): ExtensaoHandler | undefined;
  /** O `<webview>` declarado, com o predicado já protegido (`urlDeExtensaoPermitida`); null = a extensão não tem `<webview>`. */
  webviewDeclarado(): ExtensaoWebview | null;
  nomes(): string[];
}

/**
 * O predicado da extensão não é a única barreira: o core só deixa passar http(s) (nada de file:, data:, javascript:,
 * chrome:…), e um predicado que lança ou devolve algo que não é `true` conta como não.
 */
export function urlDeExtensaoPermitida(url: string, predicado: (url: string) => boolean): boolean {
  let protocolo: string;
  try { protocolo = new URL(url).protocol; } catch { return false; }
  if (protocolo !== "http:" && protocolo !== "https:") return false;
  try { return predicado(url) === true; } catch { return false; }
}

export function criarRegistro(): RegistroDeExtensao {
  // Map, não objeto: um canal chamado "constructor" ou "__proto__" não acha nada herdado.
  const canais = new Map<string, ExtensaoHandler>();
  let wv: ExtensaoWebview | null = null;
  let aberto = true;
  const exigeAberto = (o: string): void => { if (!aberto) throw new Error(`${o} só pode ser chamado durante o ativar`); };
  return {
    canal(nome, handler) {
      exigeAberto("canal()");
      if (typeof nome !== "string" || !NOME_DE_CANAL_RE.test(nome)) throw new Error(`nome de canal inválido (${JSON.stringify(nome)}): use minúsculas, dígitos e hífen, começando por letra, até 41 caracteres`);
      if (typeof handler !== "function") throw new Error(`canal "${nome}": falta o handler`);
      if (canais.has(nome)) throw new Error(`canal "${nome}" registrado duas vezes`);
      canais.set(nome, handler);
    },
    webview(w) {
      exigeAberto("webview()");
      if (wv !== null) throw new Error("webview() já foi chamado: uma extensão tem um <webview> só");
      if (typeof w !== "object" || w === null || typeof w.particao !== "string" || !PARTICAO_DE_EXTENSAO_RE.test(w.particao)) throw new Error(`partição de <webview> inválida: use ${PREFIXO_PARTICAO_DE_EXTENSAO}<nome> (minúsculas, dígitos e hífen)`);
      if (typeof w.urlPermitida !== "function") throw new Error("webview(): falta urlPermitida");
      const predicado = w.urlPermitida.bind(w);
      wv = { particao: w.particao, urlPermitida: (url) => urlDeExtensaoPermitida(url, predicado) };
    },
    fechar() { aberto = false; },
    handler: (nome) => canais.get(nome),
    webviewDeclarado: () => wv,
    nomes: () => [...canais.keys()],
  };
}

/** Em que pé está a extensão deste app: o que o `ext:invoke` precisa saber para despachar ou recusar. */
export type EstadoDaExtensao =
  | { kind: "sem" }
  | { kind: "falhou" }
  | { kind: "ativa"; registro: RegistroDeExtensao };

/**
 * O despacho do `ext:invoke`. O payload vem da janela: nada nele é confiável além do formato conferido aqui. Recusa
 * (lançando, como todo handler IPC do app) quando o app não tem extensão, quando ela não carregou, quando o nome não
 * tem o formato de um canal e quando ninguém registrou esse nome. O payload em si vai cru ao handler: validar é dele.
 */
export async function despacharExtInvoke(estado: EstadoDaExtensao, raw: unknown): Promise<unknown> {
  if (estado.kind === "sem") throw new Error(ERRO_SEM_EXTENSAO);
  if (estado.kind === "falhou") throw new Error(ERRO_EXTENSAO_NAO_CARREGOU);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("ext:invoke: payload inválido");
  const nome = (raw as { nome?: unknown }).nome;
  if (typeof nome !== "string" || !NOME_DE_CANAL_RE.test(nome)) throw new Error("ext:invoke: nome de canal inválido");
  const handler = estado.registro.handler(nome);
  if (handler === undefined) throw new Error(`ext:invoke: a extensão não tem o canal "${nome}"`);
  return handler((raw as { payload?: unknown }).payload);
}

/**
 * O `<webview>` da extensão pode navegar para `url`? A mesma regra do Inspector: antes da primeira página, só a URL
 * que o predicado da extensão aceita; depois, só dentro da origem em que ele está. Link para fora não navega (o
 * windows.ts abre os https no navegador do sistema).
 */
export function navegacaoDeExtensaoPermitida(url: string, atual: string, urlPermitida: (url: string) => boolean): boolean {
  if (atual === "") return urlPermitida(url);
  try { const a = new URL(url), b = new URL(atual); return (a.protocol === "http:" || a.protocol === "https:") && a.origin === b.origin; } catch { return false; }
}

/**
 * O módulo compilado do derivado (dist/main/derivado/index.js) exporta `ativar`? Devolve a função, ou null. Separado
 * para o carregador não confiar no formato do que o `require` devolveu.
 */
export function ativarDoModulo(m: unknown): ((api: unknown) => unknown) | null {
  if (typeof m !== "object" || m === null) return null;
  const f = (m as { ativar?: unknown }).ativar;
  return typeof f === "function" ? (f as (api: unknown) => unknown) : null;
}
/**
 * O `encerrar` do que o `ativar` devolveu, já ligado ao objeto; null se o retorno não tem um (o contrato exige
 * `{ encerrar }`). Separado para o carregador usar igual no caminho normal e na limpeza depois de uma falha.
 */
export function encerrarDoRetorno(r: unknown): (() => void) | null {
  if (typeof r !== "object" || r === null) return null;
  const f = (r as { encerrar?: unknown }).encerrar;
  return typeof f === "function" ? () => { (f as () => void).call(r); } : null;
}
