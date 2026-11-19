/** A licença da conta numa máquina, a parte pura: quando o app deve pedir outra emissão. */
import { UUID_RE, type VerificacaoLicenca } from "../conta/licenca-assinada-core";

/** A licença da conta da pessoa para a máquina, assinada pela API (ao lado do licenca.json do admin). */
export const LICENCA_CONTA_PATH = "$HOME/.local/share/meu-bot/licenca-conta.json";
/** O id da máquina ({id: uuid}), a que a licença assinada é presa. */
export const MAQUINA_PATH = "$HOME/.local/share/meu-bot/maquina.json";
/** Um JSON lido da máquina por SSH; vazio ou quebrado vira null. */
export const jsonCru = (t: string | undefined): unknown => { try { return JSON.parse((t ?? "").trim() || "null"); } catch { return null; } };
/** O id do maquina.json; null se falta ou não é um uuid. */
export function idDaMaquinaDe(raw: unknown): string | null {
  const id = raw !== null && typeof raw === "object" ? (raw as { id?: unknown }).id : null;
  return typeof id === "string" && UUID_RE.test(id) ? id : null;
}

/** A emissão vale 30 dias; com mais de 7 o app já pede outra, para a máquina nunca chegar perto do prazo. */
export const RENOVAR_APOS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Renova quando a licença gravada na máquina é DESTA conta e está velha (mais de 7 dias) ou já venceu. Arquivo de
 * outra conta (a máquina é usada por outra pessoa), mexido ou de outra máquina: não é o app desta conta que resolve.
 * Vencida não traz o payload conferido, então vale tentar: a API responde 404 se a máquina não é desta conta.
 */
export function deveRenovarLicenca(v: VerificacaoLicenca, contaId: string, now: number = Date.now(), agora = false): boolean {
  if (!v.ok) return v.motivo === "expirada";
  if (v.payload.conta.id !== contaId) return false;
  // `agora`: a pessoa mudou o plano (comprou um device) e pediu para conferir: reemite mesmo recém-emitida.
  return agora || now - Date.parse(v.payload.emitidaEm) > RENOVAR_APOS_MS;
}
/** O app confere a licença de uma máquina no máximo uma vez a cada tanto; `agora` (pedido da pessoa) não espera. */
export const ENTRE_CONFERENCIAS_MS = 6 * 60 * 60 * 1000;
export const conferidaHaPouco = (ultima: number | undefined, now: number, agora = false): boolean => !agora && ultima !== undefined && now - ultima < ENTRE_CONFERENCIAS_MS;
