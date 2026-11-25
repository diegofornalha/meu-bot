/**
 * A casca da janela (lateral, abas e caixa de mensagem), a parte pura: o resumo do grupo "Agente", qual linha da
 * lateral é a da página na frente, a etiqueta "Pro" e o texto de exemplo da caixa. Sem DOM: testável com node --test.
 * Regra de desenho: resumo em uma linha → clique abre o detalhe; nada some, só fica a um clique.
 */

/** Uma linha de estado do grupo "Agente" (WhatsApp, Claude Code, Ollama), como o DOM a mostra agora. */
export interface LinhaAgente { visivel: boolean; pronto: boolean }
export interface ResumoAgente {
  /** Linhas à mostra (as `hidden` não contam: máquina sem WhatsApp, Ollama não instalado…). */
  total: number;
  prontos: number;
  /** "2 de 3 prontos". Vazio quando não há resumo a mostrar. */
  texto: string;
  /** Verde só com tudo pronto; âmbar no resto (vermelho assustaria: o detalhe a um clique diz o que falta). */
  tom: "ok" | "warn";
  /** "grupo-vazio": nada a mostrar, nem o título; "linha": uma linha só, direto, sem resumo; "resumo": duas ou mais. */
  modo: "grupo-vazio" | "linha" | "resumo";
}

export function resumoAgente(linhas: readonly LinhaAgente[]): ResumoAgente {
  const visiveis = linhas.filter((l) => l.visivel);
  const total = visiveis.length;
  const prontos = visiveis.filter((l) => l.pronto).length;
  const tom = total > 0 && prontos === total ? "ok" : "warn";
  if (total < 2) return { total, prontos, texto: "", tom, modo: total === 0 ? "grupo-vazio" : "linha" };
  return { total, prontos, texto: `${prontos} de ${total} ${prontos === 1 ? "pronto" : "prontos"}`, tom, modo: "resumo" };
}

/** Páginas cujo id é o da linha da lateral sem o sufixo (`gmail` → `#gmail-line`). */
const COM_LINHA = new Set(["tutoriais", "acervo", "conta-google", "gmail", "computador", "inspector", "modulos", "navegador", "suporte", "auditoria", "preparar", "usuarios", "claude-global", "link-publico"]);
/**
 * O id da linha da lateral que leva à página na frente, para o realce de "você está aqui"; null quando a página não
 * tem linha (conversa do WhatsApp, atividade do agente, coluna vazia). Páginas filhas realçam a linha de onde saíram:
 * o guia de um tutorial (`tut-…`), cada terminal (`term-…`) e a página de um módulo (`modulo-…`).
 */
export function linhaDaPagina(pageId: string | null): string | null {
  if (pageId === null) return null;
  if (COM_LINHA.has(pageId)) return `${pageId}-line`;
  if (pageId.startsWith("tut-")) return "tutoriais-line";
  if (pageId.startsWith("term-")) return "terminal-line";
  if (pageId.startsWith("modulo-")) return "modulos-line";
  return null;
}

/**
 * Etiqueta "Pro" de uma linha da lateral: só no produto free (nos apps com assinatura tudo é um pacote só) e só para
 * quem não tem o acesso. `acesso` null = a licença ainda não foi lida: fica em branco, para quem é Pro não ver a
 * etiqueta piscar a cada abertura.
 */
export const etiquetaPro = (planoExigido: string, acesso: string | null): string => (planoExigido === "free" && acesso !== null && acesso !== "ok" ? "Pro" : "");

/** O que a linha do Navegador mostra à direita: as abas abertas; sem nenhuma, a etiqueta do plano (ou nada). */
export const contagemNavegador = (abas: number, etiqueta: string): string => (abas <= 0 ? etiqueta : abas === 1 ? "1 aba" : `${abas} abas`);

const TECLAS = "(Enter envia, Shift+Enter quebra linha)";
/**
 * Texto de exemplo da caixa de mensagem, conforme a janela: "na VM" era mentira na janela deste computador. `host`
 * vazio = a janela ainda não disse de quem é (antes do window:info): fica o texto neutro, o mesmo do HTML.
 * `neste` é "neste Mac" ou "neste Windows" (lib/plataforma.ts).
 */
export function placeholderDaCaixa(host: string, neste: string = "neste Mac"): string {
  const onde = host === "" ? "" : host === "local" ? ` ${neste}` : " na máquina";
  return `Pergunte algo ou peça pra rodar um comando${onde}… ${TECLAS}`;
}
