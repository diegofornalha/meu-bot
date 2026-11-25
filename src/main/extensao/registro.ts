/**
 * O estado da extensão deste processo (ver extensao-core.ts). Módulo à parte, sem dependências do app, para o
 * windows.ts (que confere o `<webview>`) e o ipc/client.ts (que despacha o `ext:invoke`) lerem sem importar o
 * carregador, que por sua vez importa meio app.
 */
import type { ExtensaoWebview } from "../../shared/ipc";
import type { EstadoDaExtensao } from "./extensao-core";

let estado: EstadoDaExtensao = { kind: "sem" };

export const estadoDaExtensao = (): EstadoDaExtensao => estado;
export function definirEstadoDaExtensao(e: EstadoDaExtensao): void { estado = e; }
/** O `<webview>` que a extensão declarou; null sem extensão ativa ou sem declaração. */
export const webviewDaExtensao = (): ExtensaoWebview | null => (estado.kind === "ativa" ? estado.registro.webviewDeclarado() : null);
