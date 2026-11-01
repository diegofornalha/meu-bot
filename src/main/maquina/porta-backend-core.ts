/**
 * Porta para instalar o backend numa máquina (regra única do seletor e do admin), sem electron: testável.
 */
import type { HostProbe } from "../../shared/ipc";

/**
 * A do serviço meu-bot-backend que ainda roda sem os arquivos no disco (reinstalar fica na mesma porta; o install.sh para
 * esse serviço antes); a do backend já instalado (reinstalar não muda o .env); a primeira livre quando a do app está
 * tomada (outra conta da mesma máquina); senão a do app.
 */
export function portaParaInstalar(probe: Pick<HostProbe, "backendInstalled" | "backendSumiu" | "backendUnitPort" | "backendPort" | "portBusy" | "freePort">, configurada: number): number {
  if (probe.backendSumiu && probe.backendUnitPort !== null) return probe.backendUnitPort;
  if (probe.backendInstalled && probe.backendPort !== null) return probe.backendPort;
  if (!probe.backendInstalled && !probe.backendSumiu && probe.portBusy && probe.freePort !== null) return probe.freePort;
  return configurada;
}
