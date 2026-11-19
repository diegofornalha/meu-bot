/**
 * Registro dos handlers IPC por variante. O canal tem de estar numa lista de ipc-policy.ts (o tipo do parâmetro
 * garante). No meu-bot-admin os canais de cliente viram stubs que recusam; nos apps da pessoa (meu-bot,
 * meu-bot-crm: `caps.chat`) os de admin recusam. O mesmo canal registrado duas vezes acusa na subida, em vez do erro opaco do Electron.
 */
import { ipcMain } from "electron";
import { ADMIN_READONLY_MSG, NOT_ADMIN_MSG, SEM_CAPACIDADE_MSG, type AdminChannel, type ClientChannel, type MacChannel, type SharedChannel } from "./ipc-policy";
import { caps } from "../app/variant";
import { gestaoLiberada } from "../conta/conta";
import { SEM_PAPEL_GESTAO } from "../conta/conta-core";
import type { CapDePlataforma } from "../app/variant-core";

export type InvokeHandler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => unknown;
export type EventHandler = (event: Electron.IpcMainEvent, payload: unknown) => void;

const registered = new Set<string>();
function register(channel: string, fn: InvokeHandler): void {
  if (registered.has(channel)) throw new Error(`canal IPC registrado duas vezes: ${channel}`);
  registered.add(channel);
  ipcMain.handle(channel, fn);
}
const refusing = (message: string): InvokeHandler => () => { throw new Error(message); };

export const handleShared = (channel: SharedChannel, fn: InvokeHandler): void => register(channel, fn);
export const handleClient = (channel: ClientChannel, fn: InvokeHandler): void =>
  register(channel, caps().chat ? fn : refusing(ADMIN_READONLY_MSG));
/**
 * Só no meu-bot-admin-gestao, e só com uma conta de admin ou super admin logada (gestaoLiberada, conferido a cada
 * chamada): é o ponto único por onde a tela da gestão pede algo às máquinas das pessoas.
 */
export const handleAdmin = (channel: AdminChannel, fn: InvokeHandler): void =>
  register(channel, caps().supportAdmin ? (event, payload) => { if (!gestaoLiberada()) throw new Error(SEM_PAPEL_GESTAO); return fn(event, payload); } : refusing(NOT_ADMIN_MSG));
/** Contas deste Mac: só no meu-bot-admin-mac. */
export const handleMac = (channel: MacChannel, fn: InvokeHandler): void =>
  register(channel, caps().usuariosMac ? fn : refusing(NOT_ADMIN_MSG));
/** Handler que só vale com a capacidade de plataforma (caps().atalhosMesa, controleRemoto…); sem ela recusa, como os de variante: botão escondido não é portão. */
export const exigeCap = (cap: CapDePlataforma, fn: InvokeHandler): InvokeHandler => (caps()[cap] ? fn : refusing(SEM_CAPACIDADE_MSG));
/** `ipcMain.on` (sem resposta), só para canais comuns. */
export const onShared = (channel: SharedChannel, fn: EventHandler): void => { ipcMain.on(channel, fn); };
/** `ipcMain.on` (sem resposta) só no app da pessoa; no admin o evento é ignorado. */
export const onClient = (channel: ClientChannel, fn: EventHandler): void => { if (caps().chat) ipcMain.on(channel, fn); };

