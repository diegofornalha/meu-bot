/**
 * Conexões, parte pura: o catálogo de MCPs de terceiros que o meu-bot sabe registrar no Claude Code deste Mac, e o
 * estado de cada um lido do `~/.claude.json`. Um conector novo é uma linha em CONEXOES. O registro é só
 * `{ type: "http", url }`: o login (OAuth com registro dinâmico + PKCE) o próprio Claude Code faz no primeiro `/mcp`,
 * e o token fica no Chaveiro dele, onde o app não lê. Por isso o estado é "registrado", nunca "logado".
 * Sem Electron: testável com node --test.
 */
import { entradasLocais, lerConfig, objeto } from "../claude-code/config-core";

export interface Conexao {
  /** Também o nome do servidor no `claude mcp` (as ferramentas viram mcp__<id>__…). */
  id: string;
  nome: string;
  descricao: string;
  /** MCP remoto, Streamable HTTP. */
  url: string;
  /** Página de instruções do fornecedor (o botão Guia só abre esta). */
  guia: string;
  /** Aviso que a tela mostra junto (ex.: o que cobra). */
  aviso: string;
}

export const CONEXOES: readonly Conexao[] = [
  {
    id: "salvy",
    nome: "Salvy",
    descricao: "Linhas, faturas, centros de custo e equipamentos da telefonia da empresa.",
    url: "https://mcp.salvy.com.br/mcp",
    guia: "https://docs.salvy.com.br/mcp-guide",
    aviso: "Entra com a conta do painel do Salvy; o que custa dinheiro (linha nova, dados extras, troca de plano) vem com orçamento e só cobra depois de confirmado.",
  },
];

export const conexao = (id: unknown): Conexao | undefined => (typeof id === "string" ? CONEXOES.find((c) => c.id === id) : undefined);

/** A entrada que o Conectar grava no escopo user. */
export const entradaConexao = (c: Conexao): { type: "http"; url: string } => ({ type: "http", url: c.url });

const ehDoCatalogo = (e: unknown, c: Conexao): boolean => objeto(e) && e["type"] === "http" && e["url"] === c.url;
const descrever = (e: unknown): string => (objeto(e) ? (typeof e["url"] === "string" ? e["url"] : typeof e["command"] === "string" ? `comando ${e["command"]}` : "outra configuração") : "outra configuração");

/**
 * ausente: nada com esse nome. registrado: a entrada user é a do catálogo e nenhuma local a encobre.
 * outra-config: há uma entrada com esse nome que não é a do catálogo (user ou local, que vence a user na pasta dela);
 * `atual` diz o que está lá, e Conectar vira "Substituir". ilegivel: `~/.claude.json` quebrado, não mexemos.
 */
export type EstadoConexao =
  | { estado: "ausente" }
  | { estado: "registrado"; locais: string[] }
  | { estado: "outra-config"; atual: string; user: boolean; locais: string[] }
  | { estado: "ilegivel" };

export function estadoConexao(conteudo: string | null, c: Conexao, pastaExiste: (pasta: string) => boolean = () => true): EstadoConexao {
  const j = lerConfig(conteudo);
  if (j === null) return { estado: "ausente" };
  if (j === "ilegivel") return { estado: "ilegivel" };
  const servidores = j["mcpServers"];
  if (servidores !== undefined && !objeto(servidores)) return { estado: "ilegivel" };
  const user = servidores === undefined ? undefined : servidores[c.id];
  const locais = entradasLocais(j, c.id, pastaExiste);
  const estranha = [...(user === undefined || ehDoCatalogo(user, c) ? [] : [user]), ...locais.filter((l) => !ehDoCatalogo(l.entrada, c)).map((l) => l.entrada)];
  if (estranha.length > 0) return { estado: "outra-config", atual: descrever(estranha[0]), user: user !== undefined, locais: locais.map((l) => l.pasta) };
  if (user === undefined) return locais.length > 0 ? { estado: "registrado", locais: locais.map((l) => l.pasta) } : { estado: "ausente" };
  return { estado: "registrado", locais: locais.map((l) => l.pasta) };
}
