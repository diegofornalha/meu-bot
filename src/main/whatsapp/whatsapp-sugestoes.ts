/**
 * Modo "sugere e você aprova" do WhatsApp: fala com a CLI da guarda na máquina (ou neste Mac). O que é puro (a chamada
 * e a leitura da resposta) está em whatsapp-sugestoes-core.ts.
 */
import type { WhatsappSugestoes } from "../../shared/ipc";
import { isValidHost } from "../app/settings";
import { execHostDe } from "./whatsapp-estado";
import { runSsh } from "./whatsapp-ssh";
import { erroDaAcao, lerSaida, parseSugestoes, sugestoesSh, type SugestaoComando } from "./whatsapp-sugestoes-core";

/** O estado do modo e a fila pendente. Máquina sem a guarda nova: `disponivel: false`, sem erro. */
export async function whatsappSugestoes(host: string): Promise<WhatsappSugestoes> {
  if (!isValidHost(host)) throw new Error("máquina inválida");
  const r = await runSsh(execHostDe(host), sugestoesSh({ acao: "listar" }), 30_000);
  if (r.code !== 0) throw new Error(r.code === null ? "a máquina não respondeu a tempo" : "não consegui ler as sugestões na máquina");
  return parseSugestoes(lerSaida(r.stdout, "sugestoes"));
}

/** Liga/desliga o modo, aprova (como está ou com o texto editado) ou descarta; devolve o estado e a fila depois. */
export async function whatsappSugestaoAcao(host: string, c: Exclude<SugestaoComando, { acao: "listar" }>): Promise<WhatsappSugestoes> {
  if (!isValidHost(host)) throw new Error("máquina inválida");
  // Aprovar manda a mensagem pelo OpenClaw (até 2 min lá); o resto é ler e gravar um arquivo.
  const r = await runSsh(execHostDe(host), sugestoesSh(c), c.acao === "aprovar" ? 180_000 : 30_000);
  if (r.code !== 0) throw new Error(r.code === null ? "a máquina não respondeu a tempo" : "a máquina recusou o comando");
  const erro = erroDaAcao(lerSaida(r.stdout, "acao"));
  if (erro !== null) throw new Error(erro);
  return parseSugestoes(lerSaida(r.stdout, "sugestoes"));
}
