/**
 * Licença da máquina lida pelo app (os dois): primeiro pelo backend (`GET /v1/meu-bot/license`, backend-colima),
 * e, quando ele não tem a rota (a máquina do Hermes roda o backend original dele) ou está fora do ar, direto dos
 * arquivos por SSH (`licenca.json` + `maquinas.json`), do mesmo jeito que o admin lê e grava. Sem isso, o Pro que o
 * admin libera numa máquina sem backend-colima nunca chegava à tela da pessoa.
 */
import type { LicenseView } from "../../shared/ipc";
import { fetchLicense } from "../maquina/backend";
import { buildLicenseView, type LicencaDaMaquina } from "./licenca";
import { licencaEmVigor } from "../conta/licenca-assinada-core";
import { LICENCA_CONTA_PATH, MAQUINA_PATH, idDaMaquinaDe, jsonCru } from "./licenca-conta-core";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";
import { runSsh } from "../whatsapp/whatsapp";
import { contaView } from "../conta/conta";

export const LICENSE_PATH = "$HOME/.local/share/meu-bot/licenca.json";
export const MACHINES_PATH = "$HOME/.local/share/meu-bot/maquinas.json";

/**
 * A licença em vigor da máquina lida por SSH: o `licenca.json` do admin somado à licença da conta da pessoa
 * (`licenca-conta.json`, conferida aqui com o id do `maquina.json`), mais os devices do `maquinas.json`. É o que o
 * backend da máquina faz; aqui serve às máquinas sem ele (Hermes) ou com ele fora do ar. null se ela não responde.
 */
export async function readLicenseViewSsh(host: string): Promise<LicenseView | null> {
  const r = await runSsh(host, `cat "${LICENSE_PATH}" 2>/dev/null; echo "<<<REA-SEP>>>"; cat "${MACHINES_PATH}" 2>/dev/null; echo "<<<REA-SEP>>>"; cat "${LICENCA_CONTA_PATH}" 2>/dev/null; echo "<<<REA-SEP>>>"; cat "${MAQUINA_PATH}" 2>/dev/null; echo\n`, 20_000).catch(() => null);
  if (r === null || r.code !== 0) return null;
  const [licPart, maqPart, contaPart, idPart] = r.stdout.split("<<<REA-SEP>>>");
  const vigor = licencaEmVigor(jsonCru(licPart), jsonCru(contaPart), idDaMaquinaDe(jsonCru(idPart)));
  return { ...buildLicenseView(vigor.license, jsonCru(maqPart)), origem: vigor.origem };
}

/**
 * A licença como o app da pessoa deve ver, com a origem: backend (`viaBackend`), senão os arquivos por SSH; `view`
 * null só quando nada responde. Quem decide sobre o CRM próprio precisa da origem (crmDaMaquinaOk): a API do CRM
 * mora no nosso backend, e licença lida por SSH não prova que ele existe na máquina.
 */
export async function lerLicencaDaMaquina(host: string): Promise<LicencaDaMaquina> {
  // Este Mac: o plano é o da conta meu-bot (veio da API da conta, com sessão), nunca o licenca.json local, que o
  // dono do Mac edita à mão. Sem conta, sem plano. viaBackend fica false: o CRM e o financeiro seguem só nas máquinas.
  if (host === LOCAL_HOST) return { view: licencaDaConta(), viaBackend: false };
  const pelaApi = await fetchLicense(host);
  if (pelaApi !== null) return { view: pelaApi, viaBackend: true };
  if (host === LOCAL_HOST || !isValidHost(host)) return { view: null, viaBackend: false };
  return { view: await readLicenseViewSsh(host), viaBackend: false };
}
/** A licença da conta meu-bot deste Mac como LicenseView (sem a lista de devices: ela é da máquina); null sem conta. */
export function licencaDaConta(): LicenseView | null {
  const c = contaView().conta;
  return c === null ? null : buildLicenseView(c.licenca, null);
}
/** Só a vista da licença (telas e gates que não dependem do backend). */
export async function lerLicenca(host: string): Promise<LicenseView | null> { return (await lerLicencaDaMaquina(host)).view; }
