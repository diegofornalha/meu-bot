/**
 * Erros da Conta Google vindos do main, em frase e em decisão (parte pura, testada). O main lança códigos
 * (GOOGLE_CONTA_DESCONECTADA, PRO_REQUIRED, GMAIL_SEM_PERMISSAO); as páginas E-mail e Conta Google mapeavam cada uma
 * por si e, quando o token caía no meio da sessão, continuavam com o status "conectada" em cache mostrando só o texto.
 * Aqui o mesmo mapa serve a todas e `statusAposErro` vira o status para "desconectada", para a página desenhar o
 * cartão com "Abrir a Conta Google / Entrar com Google" em vez de uma frase sem saída.
 */
import type { GoogleContaStatus } from "../../shared/ipc";
import { ipcErrorText } from "./ipc-error.js";

export const CODIGO_DESCONECTADA = "GOOGLE_CONTA_DESCONECTADA";

export const ehContaDesconectada = (e: unknown): boolean => ipcErrorText(e) === CODIGO_DESCONECTADA;

/** O código do main em frase; o que não é código passa como veio (já sem o prefixo do Electron). */
export const erroGoogleTexto = (e: unknown): string => ipcErrorText(e)
  .replace(/^GOOGLE_CONTA_DESCONECTADA$/, "a conta Google desconectou; entre de novo")
  .replace(/^PRO_REQUIRED$/, "esta máquina não tem o plano Pro")
  .replace(/^GMAIL_SEM_PERMISSAO$/, "a autorização desta conta é de antes da lixeira: reconecte a Conta Google uma vez");

/** Depois de um erro de conta desconectada, o status que a página deve mostrar (o main já apagou o token). */
export function statusAposErro(status: GoogleContaStatus | null, e: unknown): GoogleContaStatus | null {
  if (status === null || !ehContaDesconectada(e)) return status;
  return { ...status, conectado: false, conectando: false, precisaReconectar: false, perfil: null, escopos: [] };
}
