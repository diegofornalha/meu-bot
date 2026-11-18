/** A licença da conta numa máquina, a parte pura: quando o app deve pedir outra emissão. */
import type { VerificacaoLicenca } from "../conta/licenca-assinada-core";

/** A emissão vale 30 dias; com mais de 7 o app já pede outra, para a máquina nunca chegar perto do prazo. */
export const RENOVAR_APOS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Renova quando a licença gravada na máquina é DESTA conta e está velha (mais de 7 dias) ou já venceu. Arquivo de
 * outra conta (a máquina é usada por outra pessoa), mexido ou de outra máquina: não é o app desta conta que resolve.
 * Vencida não traz o payload conferido, então vale tentar: a API responde 404 se a máquina não é desta conta.
 */
export function deveRenovarLicenca(v: VerificacaoLicenca, contaId: string, now: number = Date.now()): boolean {
  if (!v.ok) return v.motivo === "expirada";
  if (v.payload.conta.id !== contaId) return false;
  return now - Date.parse(v.payload.emitidaEm) > RENOVAR_APOS_MS;
}
