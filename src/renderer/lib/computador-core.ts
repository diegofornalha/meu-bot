/**
 * Painel "Computador": que estado mostrar, com que texto e qual ação. Puro, testado.
 * Inspirado no computador do Grok Bot (acordando / dormindo / ao vivo / sem acesso, cada um com o "tentar de novo"
 * certo), mas sem juntar motivos diferentes num "não foi possível acessar a tela": plano, máquina fora, tela não
 * instalada e transmissão caída têm cada um o seu texto e a sua saída.
 */
import type { TelaStatus } from "../../shared/ipc";
import type { ProAccess } from "./pro.js";

/** O que o painel está fazendo agora (o resto vem da máquina). */
export type FaseComputador = "parado" | "instalando" | "acordando" | "conectando" | "ao-vivo";
export type AcaoComputador = "status" | "instalar" | "acordar" | "reconectar" | "maquina";
export type EstadoKind = "local" | "sem-plano" | "plano-desconhecido" | "carregando" | "maquina-fora" | "instalando" | "sem-tela" | "precisa-admin" | "acordando" | "dormindo" | "conectando" | "caiu" | "sem-imagem" | "ao-vivo";

export interface EntradaComputador {
  /** Este Mac ("local") não tem tela de bot. */
  local: boolean;
  acesso: ProAccess;
  /** null = ainda não perguntou à máquina. */
  status: TelaStatus | null;
  fase: FaseComputador;
  /** A instalação parou por falta de sudo (código 3): só o admin resolve. */
  instalacaoPrecisaAdmin: boolean;
  /** A transmissão caiu mais de 3 vezes em 60 s: parou de religar sozinha. */
  caiuDemais: boolean;
  /** Conectou mas não apareceu imagem dentro do prazo. */
  semImagem: boolean;
}
export interface EstadoComputador {
  kind: EstadoKind;
  titulo: string;
  texto: string;
  acao: AcaoComputador | null;
  /** Rótulo do botão da ação (null quando não há ação). */
  botao: string | null;
  /** Mostra a tela (o <webview>) atrás do estado. */
  mostrarTela: boolean;
}

const e = (kind: EstadoKind, titulo: string, texto: string, acao: AcaoComputador | null = null, botao: string | null = null, mostrarTela = false): EstadoComputador => ({ kind, titulo, texto, acao, botao, mostrarTela });

export function estadoComputador(x: EntradaComputador): EstadoComputador {
  if (x.local) return e("local", "O Computador mora numa máquina", "Este Mac não tem a tela de um bot. Abra uma janela numa máquina por SSH para ver o computador do agente.", "maquina", "Abrir uma máquina");
  // Plano antes de tudo: sem ele não se pergunta nada à máquina, e o motivo é dito como é (não como falha técnica).
  if (x.acesso === "free" || x.acesso === "expired" || x.acesso === "assinatura") return e("sem-plano", "", "");
  if (x.acesso === "unknown") return e("plano-desconhecido", "Não consegui ler o plano desta máquina", "Pode ser o backend fora do ar ou antigo. Não é cobrança: confira a máquina no seletor e tente de novo.", "status", "Tentar de novo");
  if (x.fase === "instalando") return e("instalando", "Instalando a tela na máquina…", "Leva um ou dois minutos na primeira vez (instala o Xvfb e o noVNC). Pode continuar usando o meu-bot.");
  if (x.status === null) return e("carregando", "Conferindo a tela da máquina…", "");
  if (x.status.erro !== null) return e("maquina-fora", "Não consegui falar com a máquina", `${x.status.erro}. A tela fica na máquina; quando ela responder, é só tentar de novo.`, "status", "Tentar de novo");
  if (x.instalacaoPrecisaAdmin && !x.status.instalada) return e("precisa-admin", "A tela precisa do admin para instalar", "Esta máquina não deixa instalar programas sem senha. O admin instala uma vez (pelo app dele) e aí a tela aparece aqui.", "status", "Conferir de novo");
  if (!x.status.instalada) return e("sem-tela", "A tela ainda não está instalada nesta máquina", "Para ver o computador do bot ao vivo, instale a tela: ela roda só dentro da máquina e chega aqui pelo túnel seguro, sem abrir portas.", "instalar", "Instalar a tela");
  if (x.fase === "acordando") return e("acordando", "Acordando o computador…", "Ligando a tela na máquina. Leva alguns segundos.");
  if (!x.status.rodando) return e("dormindo", "O computador está dormindo", "A tela fica desligada para poupar a máquina. Acorde quando quiser ver o que o agente está fazendo.", "acordar", "Acordar o computador");
  if (x.caiuDemais) return e("caiu", "A transmissão da tela caiu", "Ela caiu algumas vezes seguidas e parei de religar sozinho. A máquina está no ar; reconecte para tentar de novo.", "reconectar", "Reconectar");
  if (x.semImagem) return e("sem-imagem", "A tela conectou, mas não mostrou imagem", "Pode ser só a conexão lenta. Reconecte; se continuar, acorde o computador de novo.", "reconectar", "Reconectar", true);
  if (x.fase === "ao-vivo") return e("ao-vivo", "", "", null, null, true);
  return e("conectando", "Conectando à tela…", "", null, null, true);
}

/** Crashes do <webview> da tela: mais de 3 dentro de 60 s e o painel para de religar sozinho (como o Grok Bot). */
export const LIMITE_QUEDAS = 3;
export const JANELA_QUEDAS_MS = 60_000;
export function registrarQueda(quedas: readonly number[], agora: number): { quedas: number[]; caiuDemais: boolean } {
  const recentes = [...quedas.filter((t) => agora - t < JANELA_QUEDAS_MS), agora];
  return { quedas: recentes, caiuDemais: recentes.length > LIMITE_QUEDAS };
}
/** "Pintou": confere a cada 50 ms, até 20 vezes, se o canvas do noVNC já tem pixel. */
export const PINTOU_INTERVALO_MS = 50;
export const PINTOU_TENTATIVAS = 20;
