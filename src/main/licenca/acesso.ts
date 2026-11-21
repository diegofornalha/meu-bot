/**
 * Um só ponto de gate dos módulos pagos no main (o renderer bloqueia na tela; na máquina o backend recusa de
 * novo: três camadas). Produto free (meu-bot): o módulo Pro exige o plano pro → "PRO_REQUIRED". Um app que exigisse
 * mais que o free precisaria do add-on `caps().produto` contratado e em vigor → "ASSINATURA_REQUIRED". Nunca decide
 * por variante: só por caps().planoExigido e caps().produto.
 */
import { lerLicenca, lerLicencaDaMaquina } from "./licenca-maquina";
import { acessoProduto, crmProprioOk, proOk } from "./licenca";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";
import { caps } from "../app/variant";

export async function assertAcesso(host: string): Promise<void> {
  const exige = caps().planoExigido;
  // Este Mac entra: a licença dele é a da conta meu-bot (lerLicenca → licencaDaConta).
  if (!isValidHost(host)) throw new Error(exige === "free" ? "PRO_REQUIRED" : "ASSINATURA_REQUIRED");
  const lic = await lerLicenca(host);
  if (exige !== "free") {
    // Backend antigo/fora do ar ("unknown") não é bloqueio do admin: deixa passar; o backend da máquina recusa se for o caso.
    const a = acessoProduto(lic, host, exige, caps().produto);
    if (a === "ausente" || a === "expirada") throw new Error("ASSINATURA_REQUIRED");
    return;
  }
  if (lic === null || !proOk(lic.license)) throw new Error("PRO_REQUIRED");
}

/**
 * CRM próprio nesta máquina (guardar conversa no CRM…): plano Pro em vigor ("CRM_REQUIRED") E o nosso backend
 * respondendo nela, porque a API do CRM mora nele; Pro sem backend explica o que instalar em vez de deixar o 404 chegar.
 */
export async function assertCrmProprio(host: string): Promise<void> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("CRM_REQUIRED");
  const lic = await lerLicencaDaMaquina(host);
  if (!crmProprioOk(lic.view, host)) throw new Error("CRM_REQUIRED");
  if (!lic.viaBackend) throw new Error("o backend do meu-bot não responde nesta máquina, e o CRM mora nele: instale-o pelo seletor (botão Instalar) e tente de novo");
}
