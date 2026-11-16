/**
 * Inspector (meu-bot-inspector-staging), parte pura: como subir a interface oficial do MCP Inspector
 * (`@modelcontextprotocol/inspector`, linha v2) com o `npx` e deixá-la já conectada ao controle externo (MCP) deste
 * app. Sem Electron: testável com node --test. Quem sobe o processo é o inspector.ts.
 *
 * Como a v2 funciona (lido no README e nos guias do pacote, e provado contra o `pedidoOk` de verdade):
 * · `--web` sobe um servidor Node em 127.0.0.1:<CLIENT_PORT> que serve a interface e é ELE quem fala com o servidor
 *   MCP (não há mais o proxy separado da v1). O pedido ao app sai do Node, sem `Origin`, com `Host` de loopback: passa
 *   no `pedidoOk` sem mexer em nada. Depois do `initialize` o cliente tenta um `GET /mcp` (SSE); o 405 do app é
 *   aceito pelo transporte streamable-http e a conexão segue só com POST.
 * · Cabeçalhos: a interface não recebe cabeçalho pela URL. Eles vêm do arquivo de sessão (`--config`, só leitura: o
 *   Inspector não escreve nele), no campo `headers` do servidor. Por isso o `Authorization: Bearer` do app vai num
 *   arquivo 0600 na pasta de dados, nunca na linha de comando (que qualquer conta deste Mac lê com `ps`).
 * · Conectar sozinho: o deep link `?serverUrl=…&transport=http&autoConnect=<token da API>` conecta na linha de id
 *   `deep-link` do catálogo; se ela já existe com o mesmo tipo e a mesma url, usa a linha como está, cabeçalhos
 *   inclusive. O arquivo de sessão traz exatamente essa linha.
 */
import { urlMcp } from "../controle-remoto/controle-remoto-core";

/**
 * Versão fixa do pacote. Regra: só uma publicada há mais de duas semanas (a 2.13.0 é de 28 out 2026; a 2.14.0, de
 * 5 nov, e a 2.15.0, de 12 nov, eram novas demais em 15 nov). Subir a versão é uma PR, com a prova na tela.
 */
export const INSPECTOR_VERSAO = "2.13.0";
export const INSPECTOR_PACOTE = `@modelcontextprotocol/inspector@${INSPECTOR_VERSAO}`;
/** O Inspector v2 pede Node >= 22.19.0 (README do pacote). */
export const NODE_MINIMO: readonly [number, number, number] = [22, 19, 0];
/** Id da linha do catálogo em que o deep link do Inspector conecta (constante dele: `deep-link`). */
export const SERVIDOR_ID = "deep-link";
/** Nome que o app mostra no selo de quem mexeu ("Inspector (MCP) · abriu…"). */
export const CLIENTE_INSPECTOR = "Inspector";
/** Partição (em memória) do <webview> da página: fora das sessões do Navegador e do Computador. */
export const PARTICAO_INSPECTOR = "inspector";
/** A primeira subida baixa o pacote pelo npx (dezenas de MB): prazo folgado antes de desistir. */
export const PRAZO_SUBIDA_MS = 180_000;

/** `npx -y <pacote fixo> --web --config <arquivo de sessão>`: nada de token na linha de comando. */
export const argsNpx = (arquivoSessao: string): string[] => ["-y", INSPECTOR_PACOTE, "--web", "--config", arquivoSessao];

export interface AmbienteInspector {
  /** Porta da interface (fixa: o Inspector recusa 0, porque a lista de origens sai dela). */
  porta: number;
  /** Token da API da interface (o do deep link); gerado a cada subida. */
  tokenApi: string;
  /** Pasta própria dentro dos dados do app: o Inspector não toca no ~/.mcp-inspector da pessoa. */
  pastaDados: string;
  /** PATH com a pasta do node na frente (app de GUI no macOS tem PATH mínimo, e o npx é um script `env node`). */
  path: string;
}
/**
 * Ambiente do processo: só loopback, sem abrir o navegador do sistema, portas auxiliares escolhidas pelo sistema,
 * segredos só em memória (nada no Chaveiro) e o armazenamento dentro da pasta de dados do app.
 */
export function ambienteNpx(base: Record<string, string | undefined>, a: AmbienteInspector): Record<string, string> {
  const limpo: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) limpo[k] = v;
  // Nomes antigos (v1) e chaves que mudariam o que está decidido aqui não entram por herança do ambiente de quem abriu o app.
  for (const k of ["MCP_PROXY_AUTH_TOKEN", "DANGEROUSLY_OMIT_AUTH", "DANGEROUSLY_BIND_ALL_INTERFACES", "ALLOWED_ORIGINS", "SERVER_PORT", "MCP_CATALOG_PATH", "INSPECTOR_TLS_KEY_PATH", "INSPECTOR_TLS_CERT_PATH"]) delete limpo[k];
  return {
    ...limpo,
    PATH: a.path,
    HOST: "127.0.0.1",
    CLIENT_PORT: String(a.porta),
    MCP_SANDBOX_PORT: "0",
    MCP_APP_ORIGIN_PORT: "0",
    MCP_AUTO_OPEN_ENABLED: "false",
    MCP_INSPECTOR_API_TOKEN: a.tokenApi,
    MCP_INSPECTOR_SECRET_STORE: "memory",
    MCP_STORAGE_DIR: a.pastaDados,
  };
}

/** O arquivo de sessão (`--config`): uma linha só, a do deep link, com o Bearer do controle externo deste app. */
export function sessaoJson(portaMcp: number, tokenMcp: string): string {
  return `${JSON.stringify({ mcpServers: { [SERVIDOR_ID]: { type: "streamable-http", url: urlMcp(portaMcp), headers: { Authorization: `Bearer ${tokenMcp}`, "X-Meu-Bot-Cliente": CLIENTE_INSPECTOR } } } }, null, 2)}\n`;
}

/** Endereço que o <webview> carrega: a interface já no deep link, que conecta sozinha no MCP do app. */
export function urlPagina(portaUi: number, portaMcp: number, tokenApi: string): string {
  return `http://127.0.0.1:${portaUi}/?${new URLSearchParams({ serverUrl: urlMcp(portaMcp), transport: "http", autoConnect: tokenApi }).toString()}`;
}
/** O <webview> do Inspector só carrega (e só navega para) a interface em 127.0.0.1; o main confere ao anexar. */
export const urlInspectorPermitida = (url: string): boolean => /^http:\/\/127\.0\.0\.1:\d{2,5}\/(\?|#|$)/.test(url);
/** Mesma origem da interface? (as navegações do <webview> ficam nela; o resto abre no navegador do sistema). */
export function mesmaOrigem(url: string, base: string): boolean {
  try { return new URL(url).origin === new URL(base).origin; } catch { return false; }
}

/**
 * A interface subiu? O Inspector escreve "MCP Inspector Web is up and running at:" e, na linha seguinte, o endereço
 * com a porta. Devolve a porta anunciada, ou null enquanto o aviso não veio (a saída chega aos pedaços).
 */
export function lerSaida(saida: string): { porta: number } | null {
  const m = /up and running at:\s*https?:\/\/(?:127\.0\.0\.1|localhost):(\d{2,5})\b/.exec(saida);
  return m === null ? null : { porta: Number(m[1]) };
}

/** "v22.19.0" → dá para rodar o Inspector? Saída que não é versão conta como não. */
export function nodeServe(versao: string): boolean {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(versao.trim());
  if (m === null) return false;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) { if (v[i]! > NODE_MINIMO[i]!) return true; if (v[i]! < NODE_MINIMO[i]!) return false; }
  return true;
}

const NODE_MIN_TXT = NODE_MINIMO.join(".");
export const ERRO_SEM_NPX = `Não achei o Node.js (comandos node e npx) neste Mac: procurei em Homebrew, /usr/local, ~/.local e nvm. O Inspector roda pelo npx; instale o Node ${NODE_MIN_TXT} ou mais novo (por exemplo, brew install node) e clique em Tentar de novo.`;
export const erroNodeAntigo = (versao: string): string => `O Node.js deste Mac é o ${versao.trim() || "de versão desconhecida"}, e o MCP Inspector ${INSPECTOR_VERSAO} pede o ${NODE_MIN_TXT} ou mais novo. Atualize o Node (por exemplo, brew upgrade node) e clique em Tentar de novo.`;

/**
 * Onde está o npx: ao lado do node achado (o npm o instala na mesma pasta). `forcado` é a variável
 * MEU_BOT_INSPECTOR_NPX, para quem tem o npx em outro lugar (e para provar a mensagem de erro na tela).
 */
export function acharNpx(node: string | null, existe: (caminho: string) => boolean, forcado?: string): { npx: string; pasta: string } | { erro: string } {
  const barra = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf("/")));
  if (forcado !== undefined && forcado !== "") return existe(forcado) ? { npx: forcado, pasta: barra(forcado) } : { erro: ERRO_SEM_NPX };
  if (node === null) return { erro: ERRO_SEM_NPX };
  const npx = `${barra(node)}/npx`;
  return existe(npx) ? { npx, pasta: barra(node) } : { erro: ERRO_SEM_NPX };
}

/** Última linha com texto da saída (o motivo cru, para ir junto da frase em pt-BR). */
const ultimaLinha = (saida: string): string => saida.split("\n").map((l) => l.trim()).filter((l) => l !== "").at(-1)?.slice(0, 300) ?? "";

/**
 * O processo saiu (ou passou do prazo) antes de a interface subir: o que falta, em pt-BR, a partir da saída do
 * npx/Inspector. `codigo` null = não saiu (prazo). O motivo cru vai no fim, entre parênteses, quando ajuda.
 */
export function erroDaSubida(saida: string, codigo: number | null): string {
  const cru = ultimaLinha(saida);
  const com = (frase: string): string => (cru === "" ? frase : `${frase} (${cru})`);
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|network request|getaddrinfo/i.test(saida)) {
    return com(`Sem internet para baixar o MCP Inspector: na primeira vez o npx busca o pacote ${INSPECTOR_PACOTE} no registro do npm. Confira a rede e clique em Tentar de novo.`);
  }
  if (/EBADENGINE|Unsupported engine|requires Node|not supported.*node/i.test(saida)) return com(`O Node.js deste Mac é antigo para o MCP Inspector ${INSPECTOR_VERSAO} (pede o ${NODE_MIN_TXT} ou mais novo). Atualize o Node e clique em Tentar de novo.`);
  if (/EADDRINUSE|address already in use/i.test(saida)) return com("A porta escolhida para o Inspector foi ocupada por outro programa neste meio-tempo. Clique em Tentar de novo.");
  if (/E404|404 Not Found|ETARGET|No matching version/i.test(saida)) return com(`O registro do npm não tem o pacote ${INSPECTOR_PACOTE}.`);
  if (/EACCES|EPERM/i.test(saida)) return com("O npx não conseguiu escrever na pasta dele (~/.npm): confira as permissões dessa pasta e clique em Tentar de novo.");
  if (codigo === null) return com(`O MCP Inspector não subiu em ${Math.round(PRAZO_SUBIDA_MS / 1000)} s (a primeira vez baixa o pacote; rede lenta?). Clique em Tentar de novo.`);
  return com(`O MCP Inspector parou ao subir (npx saiu com ${codigo}).`);
}
