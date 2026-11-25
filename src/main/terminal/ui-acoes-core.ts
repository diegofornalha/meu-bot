/**
 * Ações da interface que o controle externo pede por nome (25 nov), como trechos que o term-api.ts roda na janela do app
 * por `executeJavaScript`. A paleta de comandos fica em variáveis de módulo do renderer, fora do alcance de quem injeta:
 * o renderer ouve dois eventos do DOM (`meu-bot:comandos`, `meu-bot:comando`, em renderer.ts) e devolve no `detail`.
 * Sem canal de IPC novo: quem consegue disparar estes eventos já roda código na página. Puro, testado.
 */
import { literalJs } from "../navegador/nav-donos-core";

/** A lista inteira da paleta (ações, conversas, tutoriais, modelos), sem o corte de 30 da tela. */
export const LISTAR_COMANDOS = `(() => { const d = {}; document.dispatchEvent(new CustomEvent("meu-bot:comandos", { detail: d })); if (!Array.isArray(d.itens)) throw new Error("a interface não respondeu: a janela ainda está carregando?"); return d.itens; })()`;

/** Roda a ação com esse id (os de `comando_listar`); id desconhecido é erro, não silêncio. */
export const rodarComando = (id: string): string => `(() => { const d = { id: ${literalJs(id)} }; document.dispatchEvent(new CustomEvent("meu-bot:comando", { detail: d })); if (d.achou !== true) throw new Error("comando desconhecido: veja os ids em comando_listar"); return true; })()`;

/**
 * Manda a mensagem na conversa da frente, pelo mesmo caminho da pessoa: o texto na caixa e o clique em Enviar (a bolha
 * aparece e a aba fica ocupada). Com o agente respondendo o botão vira "Parar": aí recusa, em vez de interromper.
 */
export const enviarMensagem = (texto: string): string => `(() => {
  const campo = document.getElementById("input"); const botao = document.getElementById("btn-send");
  if (!campo || !botao) throw new Error("esta janela não tem conversa");
  // Sem conversa na frente (uma página como o Navegador está à vista) o botão fica desligado; com o agente respondendo
  // a caixa fica desligada e o botão vira "Parar".
  if (botao.disabled) throw new Error("nenhuma conversa na frente: traga uma (ui_clicar na aba dela) ou abra outra (comando_rodar a:new)");
  if (campo.disabled || botao.classList.contains("btn-bad")) throw new Error("o agente ainda está respondendo nesta conversa: espere (conversa_ler diz ocupada) ou abra outra (comando_rodar a:new)");
  campo.value = ${literalJs(texto)}; campo.dispatchEvent(new Event("input", { bubbles: true }));
  botao.click();
  return true;
})()`;
