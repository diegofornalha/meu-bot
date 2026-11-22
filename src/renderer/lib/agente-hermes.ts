/**
 * O cartão "Hermes" do passo 1 do tutorial 3 pode ser escolhido nesta janela? Puro, com teste.
 *
 * Nas máquinas por SSH, sempre (o passo "Preparar" instala o que faltar). Em Este Mac ("local"), só com o `hermes` já
 * instalado: o app não instala o Hermes no Mac, e o gateway dele sobe pelo launchd (`hermes gateway install`). Antes
 * (até 22 nov 2026) o cartão ficava sempre desligado no Mac, com a escolha feita impossível de desfazer pelo tutorial.
 */
import type { WhatsappStatus } from "../../shared/ipc";

export const HERMES_FALTA_NO_MAC = "Neste Mac o Hermes ainda não está instalado. Instale o Hermes (o comando hermes) e toque em Trocar de novo; até lá, o OpenClaw atende o WhatsApp daqui.";

/** null = pode escolher; texto = por que não (vai no cartão, no lugar da descrição). */
export function hermesBloqueado(host: string, st: Pick<WhatsappStatus, "hermesCli"> | null): string | null {
  if (host !== "local") return null;
  return st?.hermesCli === true ? null : HERMES_FALTA_NO_MAC;
}
