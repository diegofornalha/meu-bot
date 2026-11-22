/**
 * O cartão "Hermes" do passo 1 do tutorial 3 pode ser escolhido nesta janela? Puro, com teste.
 *
 * Nas máquinas por SSH, sempre (o passo "Preparar" instala o que faltar). Em Este Mac ("local"), só com o `hermes` já
 * instalado: o app não instala o Hermes no Mac, e o gateway dele sobe pelo launchd (`hermes gateway install`). Antes
 * (até 22 nov 2026) o cartão ficava sempre desligado no Mac, com a escolha feita impossível de desfazer pelo tutorial.
 */
import type { WhatsappStatus } from "../../shared/ipc";

export const HERMES_FALTA_NO_MAC = "Neste Mac o Hermes ainda não está instalado. Instale o Hermes (o comando hermes) e toque em Trocar de novo; até lá, o OpenClaw atende o WhatsApp daqui.";
/** O status não veio (ainda lendo, ou a consulta falhou): não dá para afirmar que o Hermes falta. */
export const HERMES_NAO_CONFERIDO = "Não consegui conferir agora se o Hermes está instalado neste Mac. Tente de novo em instantes.";

/** null = pode escolher; texto = por que não (vai no cartão, no lugar da descrição). */
export function hermesBloqueado(host: string, st: Pick<WhatsappStatus, "hermesCli"> | null): string | null {
  if (host !== "local") return null;
  if (st?.hermesCli === true) return null;
  // `false` só quando a consulta rodou e não achou o comando; sem o campo (status com erro), o motivo é outro.
  return st?.hermesCli === false ? HERMES_FALTA_NO_MAC : HERMES_NAO_CONFERIDO;
}

/**
 * O cartão de um agente está desligado? Só enquanto uma troca está sendo gravada, ou pelo bloqueio do próprio cartão.
 * Pareamento em andamento (QR na tela) NÃO desliga: quem se arrependeu da escolha troca sem ler o QR nem esperar ele
 * expirar; o clique cancela o pareamento e grava a troca (agente-whatsapp.ts, escolherAgente).
 */
export const cartaoAgenteDesligado = (e: { salvando: boolean; bloqueio: string | null }): boolean => e.salvando || e.bloqueio !== null;
