/**
 * O estado do app sem depender da tela, para o controle externo (rotas /estado, /conversas e /conversa/ler do term.sock):
 * as mesmas funções que as páginas chamam pelo IPC, reunidas num retrato só. Só leitura.
 */
import { claudeAuthInfo } from "../agente/claudeLogin";
import { ollamaStatusLocal } from "../agente/ollamaLocal";
import { settingsView } from "../app/settings";
import { caps } from "../app/variant";
import { getConversation, listConversationsForHost } from "../conversa/conversation";
import { contaStatus } from "../google/conta-google";
import { estadoDadosDrive } from "../google/dados-drive";
import { lerLicencaDaMaquina } from "../licenca/licenca-maquina";
import { LOCAL_HOST } from "../maquina/localBackend";
import { listarModulos } from "../modulos/modulos";
import { whatsappStatus } from "../whatsapp/whatsapp";
import { parte, resumoDaConversa, semSegredos, ultimasMensagens } from "./estado-core";

/** O retrato da máquina da janela. Cada parte responde por si: a que falha ou demora vem como `{ erro }`. */
export async function estadoDaMaquina(host: string): Promise<Record<string, unknown>> {
  const [configuracoes, whatsapp, claude, ollama, google, backup, licenca, modulos] = await Promise.all([
    parte(() => settingsView(host)),
    parte(() => whatsappStatus(host)),
    parte(() => claudeAuthInfo(host)),
    parte(() => (host === LOCAL_HOST ? ollamaStatusLocal() : null)),
    parte(() => contaStatus(host)),
    parte(() => estadoDadosDrive(host)),
    parte(() => lerLicencaDaMaquina(host)),
    parte(() => listarModulos(host)),
  ]);
  return semSegredos({ maquina: host, configuracoes, whatsapp, claude, ollama, google, backup, licenca, modulos }) as Record<string, unknown>;
}

const exigeConversa = (): void => { if (!caps().chat) throw new Error("este app não tem conversas com o agente"); };

export function conversasDaMaquina(host: string): Record<string, unknown>[] {
  exigeConversa();
  return listConversationsForHost(host).map((c) => resumoDaConversa(c, getConversation(c.id)?.busy === true));
}

export function lerConversa(host: string, id: unknown, ultimas: unknown): Record<string, unknown> {
  exigeConversa();
  const c = typeof id === "string" ? listConversationsForHost(host).find((x) => x.id === id) : undefined;
  if (c === undefined) throw new Error("conversa não encontrada nesta máquina: veja os ids em conversas_listar");
  return { ...resumoDaConversa(c, getConversation(c.id)?.busy === true), ultimas: ultimasMensagens(c.messages, ultimas) };
}
