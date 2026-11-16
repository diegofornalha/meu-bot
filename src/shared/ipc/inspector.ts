/** Contrato IPC · Inspector (o MCP Inspector oficial embutido no meu-bot-inspector-staging). Só tipos; reexportado por src/shared/ipc.ts. */

/**
 * Resposta de `inspector:abrir`: a interface subiu (url já no deep link que conecta ao MCP deste app, a partição que
 * o main aceita no <webview> e a versão fixada do pacote) ou o que falta, em pt-BR (sem node/npx, sem rede…).
 */
export type InspectorAbrir =
  | { ok: true; url: string; particao: string; versao: string }
  | { ok: false; erro: string };
