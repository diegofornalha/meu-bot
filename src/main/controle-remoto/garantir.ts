/**
 * "Preciso do controle externo (MCP) de pé": liga se ainda não está e devolve como falar com ele (porta, chave,
 * endereço), ou o que falta, em pt-BR. É o que a página própria de um derivado recebe em `api.controleRemoto.garantir`
 * (src/main/extensao). Faz o mesmo que o Inspector faz por conta própria em inspector.ts (`garantirControle`): liga e
 * grava "ligado", gera a chave se ainda não havia e avisa as janelas; o `pedidoOk` não muda (loopback e Bearer).
 */
import type { ControleRemotoGarantido } from "../../shared/ipc";
import { getControleRemoto, setControleRemoto } from "../app/settings";
import { caps } from "../app/variant";
import { broadcast } from "../app/windows";
import { SEM_CAPACIDADE_MSG } from "../ipc/ipc-policy";
import { estadoControleRemoto, portaControleRemoto, startControleRemoto } from "./controle-remoto";
import { gerarToken, urlMcp } from "./controle-remoto-core";

export async function garantirControleRemoto(): Promise<ControleRemotoGarantido> {
  // Onde o app não tem o controle externo (Windows), não é uma extensão que o liga.
  if (!caps().controleRemoto) return { ok: false, erro: SEM_CAPACIDADE_MSG };
  if (!estadoControleRemoto().rodando) {
    const c = getControleRemoto();
    if (!c.ligado || c.token === "") setControleRemoto({ ligado: true, ...(c.token === "" ? { token: gerarToken() } : {}) });
    await startControleRemoto();
    broadcast("controle-remoto:changed", estadoControleRemoto());
  }
  const e = estadoControleRemoto();
  if (!e.rodando) return { ok: false, erro: `O controle externo (MCP) deste app não subiu: ${e.erro ?? "motivo desconhecido"}. Veja em Configurações › Controle externo (MCP).` };
  const porta = portaControleRemoto();
  return { ok: true, porta, token: getControleRemoto().token, url: urlMcp(porta) };
}
