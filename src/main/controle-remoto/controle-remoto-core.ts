/**
 * Controle remoto (MCP), parte pura: o catálogo de ferramentas que o app oferece a um cliente MCP deste Mac
 * (Claude Code, Cursor…), o roteador que diz para onde cada ferramenta vai (socket do terminal, que também tem as
 * rotas do app, ou socket do Navegador), a conferência de um pedido HTTP (só POST /mcp, loopback, Bearer) e o
 * JSON-RPC do MCP (initialize, ping, tools/list, tools/call). Servidor sem sessão, resposta JSON pura, token de 32
 * bytes, como o Remote Control do Rambox. Segue a revisão 2025-06-18 do MCP: sem lote JSON-RPC (saiu do protocolo
 * nessa revisão), sem `structuredContent` (não declaramos `outputSchema`; o resultado vai só como texto JSON) e
 * nenhum cabeçalho CORS (o `corsHeaders` do CRM fica fora daqui de propósito: Host e Origin são a defesa).
 * Sem Electron: testável com node --test.
 */
import { randomBytes } from "node:crypto";
import { autorizado, hostOk } from "../extensao-gmail/extensao-api-core";

export const CAMINHO = "/mcp";
/** Corpo máximo de um pedido (as chamadas são pequenas; o Rambox aceita 8 MB). */
export const MAX_CORPO = 1024 * 1024;
export const PORTA_MIN = 1024;
export const PORTA_MAX = 65535;
export const isPortaMcp = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= PORTA_MIN && v <= PORTA_MAX;
/** Token = 32 bytes em hex (o mesmo tamanho do backend local). */
export const gerarToken = (): string => randomBytes(32).toString("hex");
export const isToken = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** Anotações do MCP: o cliente mostra o que só lê, o que age e o que destrói. */
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const ACTION = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const OPEN = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

export interface Ferramenta {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  annotations: typeof READ | typeof ACTION | typeof WRITE | typeof DESTRUCTIVE | typeof OPEN;
}
const S = (props: Record<string, unknown>, required: string[] = []): Ferramenta["inputSchema"] => ({ type: "object", properties: props, ...(required.length > 0 ? { required } : {}) });
const MAQ = { maquina: { type: "string", description: "máquina da janela (ex.: agente-box-lv); opcional se só uma janela está aberta" } };
const ABA = { aba: { type: "number", description: "id da aba do Navegador (veja nav_abas); sem ele, a aba deste cliente" } };
/** Páginas que `pagina_abrir` põe na frente (as mesmas que a aba fixada sabe abrir). */
export const PAGINAS_APP = ["tutoriais", "acervo", "financas", "conta-google", "gmail", "computador", "navegador"] as const;
export type PaginaApp = (typeof PAGINAS_APP)[number];
export const TEMAS = ["system", "light", "dark"] as const;

export const FERRAMENTAS: readonly Ferramenta[] = [
  { name: "app", description: "Este app: nome, versão, tema, as janelas de máquina abertas (qual está em foco) e as máquinas conhecidas.", inputSchema: S({}), annotations: READ },
  { name: "janela_abrir", description: "Abre (ou traz à frente) a janela de uma máquina do ~/.ssh/config, ou \"local\" para este Mac.", inputSchema: S({ maquina: { type: "string" } }, ["maquina"]), annotations: ACTION },
  { name: "pagina_abrir", description: `Põe uma página na frente da janela: ${PAGINAS_APP.join(", ")}.`, inputSchema: S({ ...MAQ, pagina: { type: "string", enum: [...PAGINAS_APP] } }, ["pagina"]), annotations: ACTION },
  { name: "tema", description: "Troca o tema do app (system, light, dark); vale para todas as janelas.", inputSchema: S({ tema: { type: "string", enum: [...TEMAS] } }, ["tema"]), annotations: WRITE },
  { name: "print_janela", description: "Captura a janela inteira do app (a da máquina pedida, ou a em foco) como imagem.", inputSchema: S(MAQ), annotations: READ },
  { name: "terminais", description: "Terminais abertos no app (id, máquina, número).", inputSchema: S({}), annotations: READ },
  { name: "terminal_abrir", description: "Abre uma aba de terminal nova na janela da máquina e devolve o id e o prompt.", inputSchema: S(MAQ), annotations: ACTION },
  { name: "terminal_ler", description: "Últimas linhas da tela de um terminal (sem cores).", inputSchema: S({ id: { type: "string" }, linhas: { type: "number" } }, ["id"]), annotations: READ },
  // Digitar no shell e rodar JavaScript numa página logada são execução arbitrária: destrutivas para o cliente pedir confirmação.
  { name: "terminal_digitar", description: "Digita no terminal (a pessoa vê na hora). texto com enter=true roda o comando; ou tecla: enter, tab, esc, ctrl+c, ctrl+d, cima, baixo…", inputSchema: S({ id: { type: "string" }, texto: { type: "string" }, enter: { type: "boolean" }, tecla: { type: "string" } }, ["id"]), annotations: DESTRUCTIVE },
  { name: "tela_dividir", description: "Mais uma coluna na tela do app: um terminal (id) ou uma página (navegador, tutoriais, acervo, vazia).", inputSchema: S({ ...MAQ, id: { type: "string" }, pagina: { type: "string", enum: ["navegador", "tutoriais", "acervo", "vazia"] } }), annotations: ACTION },
  { name: "tela_juntar", description: "Tira uma coluna (id do terminal ou pagina) ou todas (sem argumentos).", inputSchema: S({ ...MAQ, id: { type: "string" }, pagina: { type: "string", enum: ["navegador", "tutoriais", "acervo"] } }), annotations: ACTION },
  { name: "nav_abas", description: "Abas do Navegador do app (id, url, título, quem usa).", inputSchema: S(MAQ), annotations: READ },
  { name: "nav_abrir", description: "Abre uma url numa aba deste cliente (nova=true força aba nova; aba=N navega naquela).", inputSchema: S({ ...MAQ, url: { type: "string" }, nova: { type: "boolean" }, aba: { type: "number" } }, ["url"]), annotations: OPEN },
  { name: "nav_ler", description: "Texto da página e os elementos clicáveis numerados.", inputSchema: S({ ...MAQ, ...ABA }), annotations: READ },
  { name: "nav_clicar", description: "Clica no elemento n (de nav_ler), ou por texto ou seletor CSS.", inputSchema: S({ ...MAQ, ...ABA, n: { type: "number" }, texto: { type: "string" }, seletor: { type: "string" } }), annotations: ACTION },
  { name: "nav_digitar", description: "Digita texto no campo n (ou seletor); enter=true confirma.", inputSchema: S({ ...MAQ, ...ABA, n: { type: "number" }, seletor: { type: "string" }, texto: { type: "string" }, enter: { type: "boolean" } }, ["texto"]), annotations: ACTION },
  { name: "nav_tecla", description: "Aperta uma tecla na página (enter, tab, esc, down, up…).", inputSchema: S({ ...MAQ, ...ABA, tecla: { type: "string" } }, ["tecla"]), annotations: ACTION },
  { name: "nav_print", description: "Captura a aba como imagem.", inputSchema: S({ ...MAQ, ...ABA }), annotations: READ },
  { name: "nav_recarregar", description: "Recarrega a aba.", inputSchema: S({ ...MAQ, ...ABA }), annotations: ACTION },
  { name: "nav_voltar", description: "Volta uma página.", inputSchema: S({ ...MAQ, ...ABA }), annotations: ACTION },
  { name: "nav_js", description: "Roda JavaScript na página e devolve o resultado (até 8000 caracteres).", inputSchema: S({ ...MAQ, ...ABA, codigo: { type: "string" } }, ["codigo"]), annotations: DESTRUCTIVE },
  { name: "nav_fechar", description: "Fecha uma aba deste cliente.", inputSchema: S({ ...MAQ, ...ABA }), annotations: DESTRUCTIVE },
  { name: "terminal_fechar", description: "Encerra um terminal que você abriu (a aba some, como no × dela).", inputSchema: S({ id: { type: "string" } }, ["id"]), annotations: DESTRUCTIVE },
  { name: "nota", description: "Escreve uma linha na faixa de depuração do app (\"vou pedir ao agente para…\"): a pessoa acompanha de fora o que você vai fazer. Só aparece com o modo de depuração ligado: a resposta traz visivel=false quando ninguém viu (ligue com depuracao on=true).", inputSchema: S({ texto: { type: "string" } }, ["texto"]), annotations: WRITE },
  { name: "depuracao", description: "Liga (on=true), desliga (on=false) ou volta ao padrão da variante (on=null) o modo de depuração do app; sem on, só consulta.", inputSchema: S({ on: { type: ["boolean", "null"] } }), annotations: WRITE },
];
export const ferramenta = (nome: string): Ferramenta | undefined => FERRAMENTAS.find((f) => f.name === nome);
/**
 * Execução arbitrária em sessões já abertas (um comando no shell da pessoa, código numa página logada): o Rambox deixa
 * o equivalente fora do build de produção; aqui ficam atrás de um interruptor próprio, desligado por padrão. Sem ele,
 * nem aparecem em tools/list.
 */
export const FERRAMENTAS_EXECUCAO: readonly string[] = ["terminal_digitar", "nav_js"];
export const ferramentasVisiveis = (execucao: boolean): Ferramenta[] => FERRAMENTAS.filter((f) => execucao || !FERRAMENTAS_EXECUCAO.includes(f.name));

/**
 * Qual Navegador atende um pedido do MCP: o socket só existe com a aba Navegador aberta e o 🤖 ligado (`abertos`), mas
 * uma janela de máquina aberta (`janelas`) basta para o app abrir a aba sozinho e o socket subir. Puro, testado.
 */
export type DecisaoNavegador = { acao: "socket" | "abrir"; host: string } | { acao: "erro"; erro: string };
export function decidirNavegador(maquina: string | undefined, abertos: readonly string[], janelas: readonly string[]): DecisaoNavegador {
  const lista = (xs: readonly string[]): string => xs.join(", ") || "nenhuma";
  if (maquina !== undefined) {
    if (abertos.includes(maquina)) return { acao: "socket", host: maquina };
    if (janelas.includes(maquina)) return { acao: "abrir", host: maquina };
    return { acao: "erro", erro: `a máquina "${maquina}" não está aberta no app (abertas: ${lista(janelas)}); abra a janela dela` };
  }
  if (abertos.length === 1) return { acao: "socket", host: abertos[0]! };
  if (abertos.length > 1) return { acao: "erro", erro: `o Navegador está aberto em várias máquinas (${lista(abertos)}): diga qual em "maquina"` };
  if (janelas.length === 1) return { acao: "abrir", host: janelas[0]! };
  if (janelas.length === 0) return { acao: "erro", erro: "nenhuma janela de máquina aberta no app; abra uma pelo seletor" };
  return { acao: "erro", erro: `o app tem várias máquinas abertas (${lista(janelas)}): diga qual em "maquina"` };
}

/** Para onde cada ferramenta vai: socket do terminal (term-api.ts, que também tem as rotas do app) ou do Navegador (nav-api.ts). */
export type Destino =
  | { alvo: "terminal"; rota: string; corpo?: Record<string, unknown> }
  | { alvo: "navegador"; rota: string; corpo?: Record<string, unknown>; maquina?: string };
const NAV_ROTAS: Record<string, string> = { nav_abas: "abas", nav_abrir: "abrir", nav_ler: "ler", nav_clicar: "clicar", nav_digitar: "digitar", nav_tecla: "tecla", nav_print: "print", nav_recarregar: "recarregar", nav_voltar: "voltar", nav_js: "js", nav_fechar: "fechar" };
/** As rotas do app no term.sock (as mesmas que o scripts/app-mcp.mjs usa). */
const APP_ROTAS: Record<string, string> = { app: "app", janela_abrir: "janela", pagina_abrir: "pagina", tema: "tema", print_janela: "print" };
export function roteador(nome: string, args: Record<string, unknown>): Destino {
  const { maquina, ...resto } = args;
  const maq = typeof maquina === "string" && maquina !== "" ? maquina : undefined;
  const comMaq = (c: Record<string, unknown>): Record<string, unknown> => ({ ...c, ...(maq === undefined ? {} : { maquina: maq }) });
  const rotaApp = APP_ROTAS[nome];
  if (rotaApp !== undefined) return { alvo: "terminal", rota: rotaApp, corpo: comMaq(resto) };
  switch (nome) {
    case "terminais": return { alvo: "terminal", rota: "terminais" };
    case "terminal_abrir": return { alvo: "terminal", rota: "abrir", corpo: comMaq({}) };
    case "terminal_ler": return { alvo: "terminal", rota: "ler", corpo: resto };
    case "terminal_digitar": return { alvo: "terminal", rota: "digitar", corpo: resto };
    case "terminal_fechar": return { alvo: "terminal", rota: "fechar", corpo: { id: resto["id"] } };
    case "tela_dividir": return { alvo: "terminal", rota: "dividir", corpo: comMaq(resto) };
    case "tela_juntar": return { alvo: "terminal", rota: "juntar", corpo: comMaq(resto) };
    case "nota": return { alvo: "terminal", rota: "nota", corpo: { texto: resto["texto"] } };
    case "depuracao": return { alvo: "terminal", rota: "depuracao", corpo: "on" in resto ? { on: resto["on"] } : {} };
    default: {
      const rota = NAV_ROTAS[nome];
      if (rota === undefined) throw new Error(`ferramenta desconhecida: ${nome}`);
      return { alvo: "navegador", rota, ...(rota === "abas" ? {} : { corpo: resto }), ...(maq === undefined ? {} : { maquina: maq }) };
    }
  }
}

/** Quem está pedindo, como o app mostra ("✳️ Cursor (MCP) · digitou"): o cliente diz o nome em `X-Meu-Bot-Cliente`. */
export function donoDe(cliente: string | string[] | undefined): { id: string; rotulo: string; origem: "claude-code" } {
  const c = (Array.isArray(cliente) ? cliente[0] ?? "" : cliente ?? "").replace(/[^\w .-]/g, "").trim().slice(0, 30);
  return c === "" ? { id: "mcp:cliente", rotulo: "Cliente MCP (Mac)", origem: "claude-code" } : { id: `mcp:${c.toLowerCase().replace(/\s+/g, "-")}`, rotulo: `${c} (MCP)`, origem: "claude-code" };
}

export interface PedidoHttp { method?: string | undefined; url?: string | undefined; headers: Record<string, string | string[] | undefined> }
/**
 * O pedido pode entrar? Só `POST /mcp`, de um cliente deste Mac (Host e Origin no loopback), com o token. Nunca
 * responde CORS (nem a OPTIONS): uma página no navegador não tem como falar com o servidor, e é assim que deve ser.
 */
export function pedidoOk(req: PedidoHttp, porta: number, token: string): { ok: true } | { ok: false; status: number; erro: string } {
  const caminho = (req.url ?? "/").split("?")[0];
  if (caminho !== CAMINHO) return { ok: false, status: 404, erro: `não existe; o MCP fica em ${CAMINHO}` };
  if (req.method !== "POST") return { ok: false, status: 405, erro: "só POST (servidor sem sessão; GET/SSE não existe)" };
  if (!hostOk(req.headers["host"], porta)) return { ok: false, status: 421, erro: "host inválido" };
  const origin = req.headers["origin"]; const o = Array.isArray(origin) ? origin[0] ?? "" : origin ?? "";
  if (o !== "" && o !== "null" && o !== `http://127.0.0.1:${porta}` && o !== `http://localhost:${porta}`) return { ok: false, status: 403, erro: "origem não permitida" };
  if (token === "" || !autorizado(req.headers["authorization"], token)) return { ok: false, status: 401, erro: "token inválido; copie o token em Configurações › Controle externo (MCP)" };
  const ct = req.headers["content-type"]; const tipo = (Array.isArray(ct) ? ct[0] ?? "" : ct ?? "").toLowerCase();
  if (!tipo.startsWith("application/json")) return { ok: false, status: 415, erro: "Content-Type precisa ser application/json" };
  return { ok: true };
}

/* ---------- JSON-RPC do MCP ---------- */
/** Revisões do protocolo que este servidor fala; a última é a que anuncia quando o cliente pede outra. */
export const VERSOES_PROTOCOLO: readonly string[] = ["2024-11-05", "2025-03-26", "2025-06-18"];
export const VERSAO_PROTOCOLO = "2025-06-18";
export const negociarVersao = (pedida: unknown): string => (typeof pedida === "string" && VERSOES_PROTOCOLO.includes(pedida) ? pedida : VERSAO_PROTOCOLO);
export type Chamar = (nome: string, args: Record<string, unknown>) => Promise<unknown>;
export interface ServidorInfo { nome: string; versao: string; execucao: boolean }
interface Msg { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
const resposta = (id: unknown, result: unknown): Record<string, unknown> => ({ jsonrpc: "2.0", id, result });
export const erroRpc = (id: unknown, code: number, message: string): Record<string, unknown> => ({ jsonrpc: "2.0", id, error: { code, message } });

/** Uma mensagem: devolve a resposta, ou null quando é notificação (sem id). Lote (array) não existe mais no MCP: recusa. */
export async function responderJsonRpc(raw: unknown, chamar: Chamar, info: ServidorInfo): Promise<unknown | null> {
  if (Array.isArray(raw)) return erroRpc(null, -32600, "lote JSON-RPC saiu do MCP (revisão 2025-06-18): mande uma mensagem por pedido");
  if (raw === null || typeof raw !== "object") return erroRpc(null, -32600, "pedido inválido");
  const m = raw as Msg;
  const id = m.id === undefined ? undefined : m.id;
  const method = typeof m.method === "string" ? m.method : null;
  if (method === null) return id === undefined ? null : erroRpc(id, -32600, "falta method");
  if (method.startsWith("notifications/")) return null;
  if (id === undefined) return null; // notificação de método qualquer: sem resposta
  const params = (m.params !== null && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;
  switch (method) {
    case "initialize":
      return resposta(id, { protocolVersion: negociarVersao(params["protocolVersion"]), capabilities: { tools: {} }, serverInfo: { name: info.nome, version: info.versao }, instructions: `Controle do ${info.nome} neste Mac: o que você faz aparece na hora na tela da pessoa, com o seu nome. Antes de agir, anuncie com 'nota'.` });
    case "ping": return resposta(id, {});
    case "tools/list": return resposta(id, { tools: ferramentasVisiveis(info.execucao) });
    case "tools/call": {
      const nome = typeof params["name"] === "string" ? params["name"] : "";
      const args = (params["arguments"] !== null && typeof params["arguments"] === "object" ? params["arguments"] : {}) as Record<string, unknown>;
      if (ferramenta(nome) === undefined) return erroRpc(id, -32602, `ferramenta desconhecida: ${nome}`);
      if (!info.execucao && FERRAMENTAS_EXECUCAO.includes(nome)) return resposta(id, { content: [{ type: "text", text: `Erro: ${nome} está desligada; a pessoa liga em Configurações › Controle externo (MCP) › "Executar comandos e código".` }], isError: true });
      try {
        const r = await chamar(nome, args);
        const png = r !== null && typeof r === "object" && typeof (r as { png_base64?: unknown }).png_base64 === "string" ? (r as { png_base64: string }).png_base64 : null;
        if (png !== null) return resposta(id, { content: [{ type: "image", data: png, mimeType: "image/png" }], isError: false });
        return resposta(id, { content: [{ type: "text", text: JSON.stringify(r === undefined ? { ok: true } : r) }], isError: false });
      } catch (e) {
        const texto = e instanceof Error ? e.message : String(e);
        return resposta(id, { content: [{ type: "text", text: `Erro: ${texto}` }], isError: true });
      }
    }
    default: return erroRpc(id, -32601, `método não suportado: ${method}`);
  }
}

/* ---------- Configuração pronta para os clientes ---------- */
export const urlMcp = (porta: number): string => `http://127.0.0.1:${porta}${CAMINHO}`;
/** Clientes que o botão Instalar sabe registrar; o rótulo vai no `X-Meu-Bot-Cliente` (o selo "Claude Code (MCP)"). */
export type ClienteMcp = "claude-code" | "cursor";
export const CLIENTES_MCP: readonly ClienteMcp[] = ["claude-code", "cursor"];
export const isClienteMcp = (v: unknown): v is ClienteMcp => typeof v === "string" && (CLIENTES_MCP as readonly string[]).includes(v);
export const ROTULO_CLIENTE: Record<ClienteMcp, string> = { "claude-code": "Claude Code", cursor: "Cursor" };
const cabecalhos = (token: string, cliente: ClienteMcp): Record<string, string> => ({ Authorization: `Bearer ${token}`, "X-Meu-Bot-Cliente": ROTULO_CLIENTE[cliente] });
/** A entrada do servidor na config do cliente: Claude Code pede `type: "http"`; o Cursor só url + headers. */
export function entradaMcp(porta: number, token: string, cliente: ClienteMcp): Record<string, unknown> {
  const base = { url: urlMcp(porta), headers: cabecalhos(token, cliente) };
  return cliente === "claude-code" ? { type: "http", ...base } : base;
}
/** O comando do Claude Code, no escopo do usuário (vale em qualquer pasta), o mesmo que o botão Instalar roda; o nome do servidor é o do app. */
export const configClaudeCode = (nome: string, porta: number, token: string): string =>
  `claude mcp add --scope user --transport http ${nome} ${urlMcp(porta)} --header "Authorization: Bearer ${token}" --header "X-Meu-Bot-Cliente: ${ROTULO_CLIENTE["claude-code"]}"`;
/** O trecho do mcp.json do Cursor (ou de qualquer cliente que aceite url + headers). */
export const configCursor = (nome: string, porta: number, token: string): string => JSON.stringify({ mcpServers: { [nome]: entradaMcp(porta, token, "cursor") } }, null, 2);
/** Link que abre o Cursor no pedido de instalação do servidor (a pessoa confirma lá; o app não escreve o mcp.json dele). */
export const deeplinkCursor = (nome: string, porta: number, token: string): string =>
  `cursor://anysphere.cursor-deeplink/mcp/install?${new URLSearchParams({ name: nome, config: Buffer.from(JSON.stringify(entradaMcp(porta, token, "cursor")), "utf8").toString("base64") }).toString()}`;

/**
 * Este app já está no cliente? Lê o JSON de config dele (`~/.claude.json`, cujo `mcpServers` de topo é o escopo
 * user; `~/.cursor/mcp.json`) e compara url e chave com as atuais: trocar a chave ou a porta deixa o cliente
 * "desatualizado", não um falso "instalado". `null` = o arquivo não existe; JSON quebrado = "ilegivel" (não mexemos).
 */
export type EstadoClienteMcp = "ausente" | "instalado" | "desatualizado" | "ilegivel";
export function estadoCliente(conteudo: string | null, nome: string, porta: number, token: string): EstadoClienteMcp {
  if (conteudo === null) return "ausente";
  let j: unknown;
  try { j = JSON.parse(conteudo); } catch { return "ilegivel"; }
  if (j === null || typeof j !== "object" || Array.isArray(j)) return "ilegivel";
  const servidores = (j as { mcpServers?: unknown }).mcpServers;
  if (servidores === undefined) return "ausente";
  if (servidores === null || typeof servidores !== "object" || Array.isArray(servidores)) return "ilegivel";
  const e = (servidores as Record<string, unknown>)[nome];
  if (e === undefined) return "ausente";
  if (e === null || typeof e !== "object") return "desatualizado";
  const { url, headers } = e as { url?: unknown; headers?: unknown };
  const auth = headers !== null && typeof headers === "object" ? (headers as Record<string, unknown>)["Authorization"] : undefined;
  return token !== "" && url === urlMcp(porta) && auth === `Bearer ${token}` ? "instalado" : "desatualizado";
}
