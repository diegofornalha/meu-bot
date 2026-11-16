/** Contrato IPC entre renderer, preload e processo principal. Só tipos: nada aqui é emitido em runtime. */
// Dividido por domínio em src/shared/ipc/ (26/10); este arquivo só reexporta, então os imports do app não mudam.
export type * from "./ipc/app";
export type * from "./ipc/atualizacao";
export type * from "./ipc/licenca";
export type * from "./ipc/agente";
export type * from "./ipc/maquina";
export type * from "./ipc/google";
export type * from "./ipc/whatsapp";
export type * from "./ipc/crm";
export type * from "./ipc/financeiro";
export type * from "./ipc/suporte";
export type * from "./ipc/usuarios-mac";
export type * from "./ipc/conversa";
export type * from "./ipc/navegador";
export type * from "./ipc/computador";
export type * from "./ipc/inspector";
export type * from "./ipc/seletor";
export type * from "./ipc/depuracao";
export type * from "./ipc/conta";
export type * from "./ipc/api";
