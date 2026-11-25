/**
 * Derivado de exemplo (testes do core): a parte do processo principal da página própria. Só `import type` do contrato;
 * tudo o que usa chega em `api`. Um canal, `eco`, que devolve o que recebeu.
 */
import type { AtivarExtensao } from "meu-bot/extensao-main";

export const ativar: AtivarExtensao = (api) => {
  api.canal("eco", async (payload) => payload);
  api.log("[exemplo] extensão ativada");
  return { encerrar: () => { api.log("[exemplo] extensão encerrada"); } };
};
