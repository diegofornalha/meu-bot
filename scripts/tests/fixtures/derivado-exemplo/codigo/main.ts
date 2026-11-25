/**
 * Derivado de exemplo (testes do core): a parte do processo principal da página própria. Só `import type` do contrato;
 * tudo o que usa chega em `api`, fora o que é da própria pasta `codigo/` (./comum.js). Um canal, `eco`, que devolve o
 * que recebeu.
 */
import type { AtivarExtensao } from "meu-bot/extensao-main";
import { CANAL_ECO } from "./comum.js";

export const ativar: AtivarExtensao = (api) => {
  api.canal(CANAL_ECO, async (payload) => payload);
  api.log("[exemplo] extensão ativada");
  return { encerrar: () => { api.log("[exemplo] extensão encerrada"); } };
};
