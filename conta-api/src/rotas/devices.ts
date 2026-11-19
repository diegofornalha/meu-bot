/**
 * Os devices da conta (Macs com o app), pedidos pela própria pessoa no console:
 * - `DELETE /conta/devices/:id`: tira um Mac da conta. A linha sai e as sessões dele são revogadas na mesma transação
 *   (`removerDevice`): o app daquele Mac precisa entrar de novo. A vaga abre na hora, e o Mac pendente que pediu
 *   primeiro entra sozinho se couber no limite em vigor. É o mesmo efeito do "Remover" do admin, sem depender dele.
 */
import type { Env } from "../tipos.js";
import { auditar, contarLimite, limiteDeDevicesComExtras, papelAdmin, promoverDevicesPendentes, removerDevice } from "../db.js";
import { DEVICE_ID_RE, janelaMinuto } from "../sessao-core.js";
import { limiteDoPapel } from "../pagamento-core.js";
import { json, type Autenticado } from "../http.js";

const LIMITE_POR_MIN = 10;

export async function deleteDeviceDaConta(auth: Autenticado, env: Env, deviceId: string): Promise<Response> {
  if (!DEVICE_ID_RE.test(deviceId)) return json({ erro: "id do device fora do formato" }, 400);
  if (await contarLimite(env.DB, `device:${auth.conta.id}`, janelaMinuto()) > LIMITE_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  if (!(await removerDevice(env.DB, auth.conta.id, deviceId))) return json({ erro: "este Mac não está na sua conta" }, 404);
  await auditar(env.DB, auth.conta.email, "device.removido", auth.conta.id, `${deviceId} · pela própria pessoa`);
  // A vaga abriu: quem estava na fila entra, do pedido mais antigo para o mais novo.
  const papel = await papelAdmin(env.DB, auth.conta.email, env.ADMIN_BOOTSTRAP_EMAIL);
  const limite = limiteDoPapel((await limiteDeDevicesComExtras(env.DB, auth.conta)).limite, papel);
  const promovidos = Number.isFinite(limite) ? await promoverDevicesPendentes(env.DB, auth.conta.id, limite) : [];
  for (const id of promovidos) await auditar(env.DB, "system", "device.liberado", auth.conta.id, `${id} · vaga aberta pela remoção de ${deviceId}`);
  return json({ ok: true, promovidos: promovidos.length });
}
