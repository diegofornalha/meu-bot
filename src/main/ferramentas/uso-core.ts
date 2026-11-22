/**
 * O agente quer usar uma ferramenta: o que o app faz (parte pura, testada). A cada `usar` do conector da máquina
 * (backend-colima/ferramentas-mcp.js) o app decide entre executar, mostrar um cartão na conversa (comprar, conectar,
 * confirmar) ou recusar, e devolve ao agente uma frase que ele repete à pessoa. A dinâmica é toda no chat: a pessoa
 * conecta um app e autoriza uma ação sem sair da conversa.
 */
import type { DecisaoDoCartao } from "./permissoes-core";

/** Onde a ferramenta está para esta conta: fora do catálogo, à venda (não contratada), contratada e sem conexão, ou pronta. */
export type EstadoDaFerramenta = "desconhecida" | "a-venda" | "falta-conectar" | "pronta";
/** A ação só lê, ou altera, envia ou apaga. Sem a informação, vale o mais cauteloso: perguntar. */
export type TipoDeAcao = "leitura" | "escrita" | "desconhecido";
/** De onde veio o pedido: uma conversa do app (tem tela para o cartão) ou o agente do WhatsApp (não tem). */
export type OrigemDoPedido = "meu-bot" | "whatsapp" | "claude-code";

export interface PedidoDeUso { estado: EstadoDaFerramenta; tipo: TipoDeAcao; permissao: "sempre" | "nunca" | null; origem: OrigemDoPedido }
export type Decisao =
  | { acao: "executar" }
  | { acao: "cartao"; cartao: "comprar" | "conectar" | "confirmar" }
  | { acao: "recusar"; motivo: MotivoDaRecusa };
export type MotivoDaRecusa = "desconhecida" | "nao-contratada" | "falta-conectar" | "sem-tela" | "nunca" | "cancelado" | "expirou";

/** O cartão fica esperando a pessoa por este tempo; depois o pedido é cancelado (o conector da máquina espera 6 min). */
export const ESPERA_DO_CARTAO_MS = 5 * 60_000;
export const cartaoExpirou = (criadoEm: number, agora: number): boolean => agora - criadoEm >= ESPERA_DO_CARTAO_MS;

/**
 * A decisão. A ordem importa: primeiro o que a conta tem (o servidor também trava, isto só evita a viagem), depois a
 * conexão, depois a permissão. Sem tela (WhatsApp), nada que precise de cartão acontece: leitura de app conectado
 * roda, e escrita só com um "Permitir sempre" dado antes pelo app.
 */
export function decidirUso(p: PedidoDeUso): Decisao {
  const temTela = p.origem === "meu-bot";
  if (p.estado === "desconhecida") return { acao: "recusar", motivo: "desconhecida" };
  if (p.estado === "a-venda") return temTela ? { acao: "cartao", cartao: "comprar" } : { acao: "recusar", motivo: "nao-contratada" };
  if (p.estado === "falta-conectar") return temTela ? { acao: "cartao", cartao: "conectar" } : { acao: "recusar", motivo: "falta-conectar" };
  if (p.permissao === "nunca") return { acao: "recusar", motivo: "nunca" };
  if (p.tipo === "leitura" || p.permissao === "sempre") return { acao: "executar" };
  return temTela ? { acao: "cartao", cartao: "confirmar" } : { acao: "recusar", motivo: "sem-tela" };
}

/** Depois do cartão de confirmar: executa ou recusa. */
export function depoisDeConfirmar(d: DecisaoDoCartao): Decisao {
  return d === "sempre" || d === "agora" ? { acao: "executar" } : { acao: "recusar", motivo: d === "nunca" ? "nunca" : "cancelado" };
}

/** A frase que volta ao agente quando a ação não roda: ele a repete à pessoa, sem tentar outro caminho. */
export function fraseDaRecusa(motivo: MotivoDaRecusa, app: string): string {
  switch (motivo) {
    case "desconhecida": return `"${app}" não é uma ferramenta do meu-bot. Chame "apps" para ver as que esta conta tem.`;
    case "nao-contratada": return `A ferramenta ${app} não foi contratada nesta conta. Ela está no Marketplace do meu-bot; a conversa mostra o cartão com o preço quando a pessoa pede pelo app.`;
    case "falta-conectar": return `A ferramenta ${app} está contratada, mas ainda não foi conectada. Peça à pessoa que conecte pelo app meu-bot (o cartão "Conectar" aparece na conversa do app).`;
    case "sem-tela": return `Esta ação altera dados no ${app} e precisa da autorização da pessoa, que só dá para pedir no app meu-bot. Peça a ela que faça o pedido por uma conversa do app; lá ela pode escolher "Permitir sempre" para as próximas vezes.`;
    case "nunca": return `A pessoa escolheu nunca permitir esta ação no ${app}. Ela pode mudar isso na página Ferramentas do app.`;
    case "cancelado": return `A pessoa cancelou esta ação no ${app}. Não tente de novo nem por outro caminho; pergunte o que ela prefere.`;
    case "expirou": return `A pessoa não respondeu ao pedido de autorização no ${app} em 5 minutos, e ele foi cancelado. Avise e pergunte se quer tentar de novo.`;
  }
}
/** A frase para o agente enquanto a pessoa ainda não conectou ou não contratou e o cartão ficou na conversa. */
export function fraseDoCartao(cartao: "comprar" | "conectar", app: string): string {
  return cartao === "comprar"
    ? `A ferramenta ${app} não foi contratada nesta conta. A conversa mostrou o cartão com o preço e o caminho para contratar no Marketplace. Diga isso à pessoa.`
    : `A pessoa ainda não conectou o ${app}. O cartão "Conectar" continua na conversa: diga que é só autorizar ali e pedir de novo.`;
}

/**
 * Lê ou altera? Pela marca que o serviço de ferramentas dá a cada ação (`somenteLeitura`). Sem ela, pelo nome, e a
 * leitura é a exceção estrita, porque é ela que roda sem cartão: só conta quando o verbo logo depois do nome do app
 * (GMAIL_FETCH_…) é de consulta, nenhuma outra parte é verbo que altera e o nome não junta duas ações (…_AND_…). A
 * lista de verbos de escrita nunca é completa: o que não se encaixa é "desconhecido", e a pessoa confirma.
 */
export function tipoDaAcao(a: { nome: string; somenteLeitura?: boolean | undefined }): TipoDeAcao {
  if (a.somenteLeitura === true) return "leitura";
  if (a.somenteLeitura === false) return "escrita";
  const partes = a.nome.toUpperCase().split(/[_\s.:-]+/).filter((x) => x !== "");
  if (partes.some((x) => VERBOS_DE_ESCRITA.has(x))) return "escrita";
  if (partes.some((x) => x === "AND" || x === "THEN")) return "desconhecido";
  return partes.length >= 2 && VERBOS_DE_LEITURA.has(partes[1]!) ? "leitura" : "desconhecido";
}
const VERBOS_DE_LEITURA = new Set(["GET", "LIST", "FETCH", "SEARCH", "FIND", "READ", "QUERY", "LOOKUP", "RETRIEVE", "COUNT", "CHECK", "DESCRIBE", "INSPECT"]);
const VERBOS_DE_ESCRITA = new Set(["CREATE", "UPDATE", "DELETE", "REMOVE", "SEND", "POST", "PUT", "PATCH", "ADD", "INSERT", "MOVE", "COPY", "UPLOAD", "SHARE", "REPLY", "FORWARD", "PUBLISH", "CANCEL", "ARCHIVE", "TRASH", "RENAME", "INVITE", "MERGE", "CLOSE", "OPEN", "SET", "CLEAR", "APPEND", "WRITE", "EDIT", "MODIFY", "RUN", "EXECUTE", "TRIGGER", "MARK", "ASSIGN", "IMPORT", "EXPORT", "DUPLICATE", "RESTORE", "BATCH", "REPLACE", "SUBMIT", "TRANSFER", "PAY", "BOOK", "SCHEDULE", "LABEL", "UNSUBSCRIBE", "SUBSCRIBE", "APPROVE", "REJECT", "ACCEPT", "DECLINE", "REFUND", "CHARGE", "CONNECT", "DISCONNECT", "ENABLE", "DISABLE", "RESET", "REVOKE", "GRANT", "LOCK", "UNLOCK", "START", "STOP", "DEPLOY", "PURCHASE", "ORDER"]);
