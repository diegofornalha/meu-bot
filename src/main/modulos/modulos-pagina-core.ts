/**
 * Página própria de um módulo (puro, testado): o módulo declara `pagina: {rotulo, porta, caminho}` no modulos.json e o
 * instalador dele sobe um serviço web na máquina, só em 127.0.0.1:<porta>. O app abre um forward SSH até essa porta
 * (o mesmo túnel da tela do Computador) e mostra a página num <webview> isolado: partição em memória por módulo e
 * máquina, sem preload (logo sem IPC), sandbox, e só a origem do forward (windows.ts confere ao anexar e a cada
 * navegação). O serviço só atende quem traz o token desta instalação: o app grava o token na máquina ao ligar o módulo
 * (0600, `MODULO_PAGINA_TOKEN`, que o instalador recebe) e o passa na URL ao abrir; sem ele, outro processo deste Mac
 * que ache a porta do forward não usa a página. O IO é o modulos.ts.
 */
import type { ModuloPagina } from "../../shared/ipc";

/** A mesma pasta de estado do modulos-core.ts (repetida aqui para o modulos-core poder importar o parsePagina). */
const MODULOS_DIR = "$HOME/.local/share/meu-bot/modulos";

const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;
const CAMINHO_RE = /^\/[A-Za-z0-9._~/-]{0,200}$/;
const TOKEN_RE = /^[A-Za-z0-9]{32,128}$/;

/** `pagina` do manifesto → a página validada; ausente = null. Erro com a frase do que está errado (o manifesto todo cai). */
export function parsePagina(v: unknown, onde: string): ModuloPagina | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${onde}: pagina precisa ser {rotulo, porta, caminho}`);
  const o = v as Record<string, unknown>;
  const rotulo = typeof o.rotulo === "string" ? o.rotulo.trim().slice(0, 30) : "";
  const porta = o.porta;
  const caminho = typeof o.caminho === "string" && o.caminho !== "" ? o.caminho : "/";
  if (rotulo === "") throw new Error(`${onde}: pagina sem rotulo`);
  if (typeof porta !== "number" || !Number.isInteger(porta) || porta < 1024 || porta > 65535) throw new Error(`${onde}: pagina.porta precisa ser um inteiro entre 1024 e 65535`);
  if (!CAMINHO_RE.test(caminho) || caminho.includes("..") || caminho.includes("//")) throw new Error(`${onde}: pagina.caminho precisa começar com / e ter só letras, números e . _ ~ / -`);
  return { rotulo, porta, caminho };
}

/** Arquivo do token da página na máquina (dentro da pasta de estado do módulo). */
export const arquivoToken = (id: string): string => `${MODULOS_DIR}/${id}/pagina.token`;

/**
 * Antes do instalador: garante o token (cria uma vez, 0600; religar não troca, para a página aberta não cair) e o
 * exporta como MODULO_PAGINA_TOKEN, o caminho do arquivo, que o serviço do módulo lê.
 */
export function tokenSh(id: string): string {
  if (!ID_RE.test(id)) throw new Error("módulo inválido");
  const t = arquivoToken(id);
  return `mkdir -p "${MODULOS_DIR}/${id}" && { [ -s "${t}" ] || ( umask 077; LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48 > "${t}.tmp" && mv "${t}.tmp" "${t}" ); } && export MODULO_PAGINA_TOKEN="${t}"`;
}

/** Status da página: uma linha `pagina token=<t>|- rodando=0|1`. Não muda nada na máquina; o token só vai ao app. */
export function paginaStatusSh(id: string, porta: number): string {
  if (!ID_RE.test(id) || !Number.isInteger(porta) || porta < 1024 || porta > 65535) throw new Error("módulo inválido");
  return `t=$(head -c 200 "${arquivoToken(id)}" 2>/dev/null | tr -cd 'A-Za-z0-9'); r=0; if (exec 3<>"/dev/tcp/127.0.0.1/${porta}") 2>/dev/null; then r=1; fi; echo "pagina token=\${t:--} rodando=$r"`;
}

/** Lê a linha do status (a última que casar: um .bashrc pode imprimir antes). null = resposta estranha. */
export function parsePaginaStatus(stdout: string): { token: string | null; rodando: boolean } | null {
  const l = stdout.split("\n").map((x) => x.trim()).filter((x) => /^pagina token=\S+ rodando=[01]$/.test(x)).at(-1);
  if (l === undefined) return null;
  const m = /^pagina token=(\S+) rodando=([01])$/.exec(l)!;
  return { token: TOKEN_RE.test(m[1]!) ? m[1]! : null, rodando: m[2] === "1" };
}

/** Prefixo das partições das páginas de módulo (em memória: nada da página fica no disco do Mac). */
export const PARTICAO_MODULO = "modulo-";
/** Partição da página de um módulo numa máquina: uma por par, para cookies de uma máquina não valerem em outra. */
export const particaoModulo = (id: string, host: string): string => `${PARTICAO_MODULO}${id}-${host.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
/** Origem do forward local (o que a página pode carregar). */
export const origemForward = (localPort: number): string => `http://127.0.0.1:${localPort}`;
/** Endereço que o <webview> abre: a origem do forward, o caminho do manifesto e o token. */
export const urlPagina = (localPort: number, caminho: string, token: string): string => `${origemForward(localPort)}${caminho}?token=${encodeURIComponent(token)}`;
/** A URL é da origem registrada para a partição (mesmo esquema, host e porta)? */
export function urlNaOrigem(url: string, origem: string): boolean {
  try { return new URL(url).origin === origem; } catch { return false; }
}

/**
 * Ações que a página de um módulo pode pedir ao app (a única ponte: a página não tem preload nem IPC). A página abre
 * `/__meu-bot/acao?…` na própria origem (window.open); o main intercepta antes de abrir qualquer janela, lê com
 * `lerAcao` e entrega à janela do app. Lista fechada; tudo o mais é recusado.
 * - `chat`: põe um texto (até 500 caracteres) na caixa do chat do agente. Só preenche: quem envia é a pessoa.
 * - `planilha`: pede para ler uma planilha do Google Sheets com a Conta Google da máquina. O app só pergunta: nada é
 *   lido sem a pessoa confirmar no cartão acima da página (modulos-page.ts), e o que for lido vai só para o serviço do
 *   módulo (POST /__meu-bot/planilha, com o token), que devolve a prévia e importa.
 */
export type AcaoPagina = { acao: "chat"; texto: string } | { acao: "planilha"; link: string; aba: string; tipo: string };
export const CAMINHO_ACAO = "/__meu-bot/acao";
export function lerAcao(url: string, origem: string): AcaoPagina | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.origin !== origem || u.pathname !== CAMINHO_ACAO) return null;
  if (u.searchParams.get("acao") === "chat") {
    const texto = (u.searchParams.get("texto") ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
    return texto === "" ? null : { acao: "chat", texto };
  }
  if (u.searchParams.get("acao") === "planilha") {
    const link = (u.searchParams.get("link") ?? "").trim().slice(0, 500);
    const aba = (u.searchParams.get("aba") ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100);
    const tipo = u.searchParams.get("tipo") ?? "";
    if (link === "" || !/^[a-z]{1,20}$/.test(tipo)) return null;
    return { acao: "planilha", link, aba, tipo };
  }
  return null;
}

/** O que o módulo devolve de POST /__meu-bot/planilha, como o app mostra (texto puro, cortado). null = resposta estranha. */
export function lerRespostaPlanilha(j: unknown): { mensagem: string; linhas: string[]; podeImportar: boolean } | null {
  if (j === null || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  if (typeof o.mensagem !== "string" || o.mensagem.trim() === "") return null;
  const linhas = Array.isArray(o.linhas) ? o.linhas.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, 8) : [];
  return { mensagem: o.mensagem.trim().slice(0, 600), linhas, podeImportar: o.podeImportar === true };
}

/**
 * O pedido ao serviço do módulo não teve resposta HTTP: a frase para a pessoa, pelo que o `fetch` lançou. São três
 * causas com saídas diferentes: passou do tempo (`AbortSignal.timeout` → TimeoutError), o módulo respondeu com um
 * redirecionamento que `redirect: "error"` barrou (a causa diz "redirect"), ou não houve conexão (serviço parado, túnel caído).
 */
export function fraseSemRespostaDoModulo(e: unknown): string {
  if (e instanceof Error && e.name === "TimeoutError") return "o módulo demorou mais de 60 s para responder; tente de novo com uma planilha menor";
  if (e instanceof TypeError && /redirect/i.test(String((e as { cause?: unknown }).cause ?? e.message))) return "o módulo tentou redirecionar o pedido; por segurança a planilha não foi enviada";
  return "o módulo não respondeu (o serviço parou ou o túnel caiu); abra a página do módulo de novo";
}
