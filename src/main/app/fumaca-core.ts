/**
 * Modo de fumaça (`MEU_BOT_FUMACA=<arquivo>`): o app sobe normal, espera a primeira janela à vista (o seletor)
 * terminar de carregar, grava um relatório JSON nesse arquivo e sai com 0 (ok) ou 1. É a prova automática do app
 * empacotado: o workflow "Windows" (.github/workflows/windows.yml) instala, abre assim e confere o relatório com
 * scripts/fumaca-conferir.mjs. Aqui só a decisão, pura (testável com node --test); o Electron fica em fumaca.ts.
 */

/** Prazo para a primeira janela carregar; passou disso, o relatório sai com o erro do prazo e o app sai com 1. */
export const PRAZO_FUMACA_MS = 60_000;
/**
 * Com `MEU_BOT_FUMACA_WSL=1` (só no Windows) a fumaça também roda o "Preparar este Windows" de verdade, o mesmo código
 * do botão (maquina/wsl.ts), e espera ele terminar: baixar o Ubuntu e instalar os pacotes leva minutos.
 */
export const PRAZO_FUMACA_WSL_MS = 30 * 60_000;
export const fumacaWslPedida = (env: Record<string, string | undefined>): boolean => (env.MEU_BOT_FUMACA_WSL ?? "").trim() === "1";
export const prazoDaFumaca = (env: Record<string, string | undefined>): number => (fumacaWslPedida(env) ? PRAZO_FUMACA_WSL_MS : PRAZO_FUMACA_MS);

/** O que o preparo do "Este Windows" deixou no relatório (MEU_BOT_FUMACA_WSL). */
export interface WslNaFumaca { ok: boolean; estado: string; alias: string; erro: string | null; log: string[]; ms: number }

/** Depois de a janela carregar, o app ainda espera isto antes de gravar: erro que estoura logo após o load entra. */
export const ASSENTAR_FUMACA_MS = 1_500;

/** Uma janela que o app abriu durante a fumaça, como o main a viu. */
export interface JanelaVista {
  /** Nome do arquivo carregado (picker.html, index.html…); "" enquanto não se sabe. */
  arquivo: string;
  titulo: string;
  /** `did-finish-load` chegou. */
  carregou: boolean;
  /** À vista (a entrada rápida nasce escondida e não conta como a janela do app). */
  visivel: boolean;
}

export interface RelatorioFumaca {
  /** A decisão: uma janela à vista carregou e não houve erro. É o código de saída (0 se true). */
  ok: boolean;
  versao: string;
  plataforma: string;
  arch: string;
  variante: string;
  /** app.isPackaged: false é `npm start` com a variável ligada. */
  empacotado: boolean;
  /** As capacidades que o app calculou (caps()): o contrato que o fumaca-conferir.mjs compara com capsFor. */
  caps: Record<string, unknown>;
  /** A janela que conta: a primeira à vista que carregou (ou, sem nenhuma, a primeira que abriu). */
  janela: JanelaVista & { carregou: boolean };
  /** Quantas janelas o app abriu até o relatório. */
  janelas: number;
  /** O que faz a fumaça falhar: exceção não tratada no main, promessa rejeitada, página que não carregou, prazo. */
  erros: string[];
  /** Erros do console das páginas: ajudam a ler um relato, mas não reprovam. */
  avisos: string[];
  duracaoMs: number;
  /** Quando o relatório foi gravado (ISO). */
  em: string;
  /** Só com MEU_BOT_FUMACA_WSL: o resultado do "Preparar este Windows". */
  wsl?: WslNaFumaca;
}

/** Caminho do relatório pedido no ambiente; null = modo desligado (o app se comporta como sempre). */
export function arquivoDaFumaca(env: Record<string, string | undefined>): string | null {
  const v = (env.MEU_BOT_FUMACA ?? "").trim();
  return v === "" ? null : v;
}

/** A janela que conta para a fumaça: a primeira à vista já carregada; sem ela, a primeira à vista; sem ela, a primeira. */
export function janelaDaFumaca(janelas: readonly JanelaVista[]): JanelaVista {
  return janelas.find((j) => j.visivel && j.carregou) ?? janelas.find((j) => j.visivel) ?? janelas[0] ?? { arquivo: "", titulo: "", carregou: false, visivel: false };
}

/** Pode concluir: já existe janela à vista carregada (o prazo conclui de qualquer jeito, pelo fumaca.ts). */
export const fumacaPronta = (janelas: readonly JanelaVista[]): boolean => janelas.some((j) => j.visivel && j.carregou);

export interface EntradaRelatorio {
  versao: string; plataforma: string; arch: string; variante: string; empacotado: boolean;
  caps: Record<string, unknown>;
  janelas: readonly JanelaVista[];
  erros: readonly string[];
  avisos: readonly string[];
  /** O prazo venceu sem janela carregada. */
  prazoVencido: boolean;
  duracaoMs: number;
  em: string;
  /** MEU_BOT_FUMACA_WSL: o resultado do preparo; null = foi pedido e não terminou no prazo; undefined = não foi pedido. */
  wsl?: WslNaFumaca | null;
}

const LIMITE_LINHAS = 50;
const curto = (s: string): string => (s.length > 2000 ? `${s.slice(0, 2000)}…` : s);

export function montarRelatorio(i: EntradaRelatorio): RelatorioFumaca {
  const janela = janelaDaFumaca(i.janelas);
  const carregou = janela.visivel && janela.carregou;
  const erros = i.erros.map(curto);
  if (!carregou) erros.push(i.janelas.length === 0 ? "nenhuma janela abriu" : i.prazoVencido ? `a janela não terminou de carregar em ${Math.round(PRAZO_FUMACA_MS / 1000)} s` : "a janela não carregou");
  if (i.wsl === null) erros.push(`o preparo do este Windows não terminou em ${Math.round(PRAZO_FUMACA_WSL_MS / 60_000)} min`);
  else if (i.wsl !== undefined && !i.wsl.ok) erros.push(`este Windows: o preparo parou em "${i.wsl.estado}": ${i.wsl.erro ?? "sem detalhes"}`);
  return {
    ok: carregou && erros.length === 0,
    versao: i.versao, plataforma: i.plataforma, arch: i.arch, variante: i.variante, empacotado: i.empacotado,
    caps: i.caps,
    janela: { ...janela, carregou },
    janelas: i.janelas.length,
    erros: erros.slice(0, LIMITE_LINHAS),
    avisos: i.avisos.map(curto).slice(0, LIMITE_LINHAS),
    duracaoMs: i.duracaoMs,
    em: i.em,
    ...(i.wsl === undefined || i.wsl === null ? {} : { wsl: { ...i.wsl, log: i.wsl.log.map(curto).slice(-LIMITE_LINHAS) } }),
  };
}

export const codigoDeSaida = (r: Pick<RelatorioFumaca, "ok">): number => (r.ok ? 0 : 1);

/** Texto de um erro qualquer, com a pilha quando houver (é o que se lê no relatório). */
export function textoDoErro(origem: string, e: unknown): string {
  const corpo = e instanceof Error ? (e.stack ?? e.message) : typeof e === "string" ? e : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
  return `${origem}: ${corpo}`;
}
