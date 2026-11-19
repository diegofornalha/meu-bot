/**
 * Cartão do CRM no bloco "Já incluído" da página Módulos, a parte pura (testada): o que o cartão diz e que botões
 * oferece, pelo estado do CRM na máquina. O CRM é do próprio meu-bot, não um módulo de produto: sem ligar e desligar,
 * sem licença à parte e sem repositório. Sem DOM.
 */
import type { CrmInfo, CrmLocal } from "../../shared/ipc";
import type { ProAccess } from "../lib/pro.js";

/** O que a página recebe do renderer (dep `crm`): o estado que o guia do CRM já mantém, lido na hora. */
export interface CrmCartaoEstado {
  /** Janela de uma máquina por SSH; em "Este Mac" o CRM não existe. */
  remoto: boolean;
  /** Acesso pelo plano da máquina (o mesmo gate do guia e do main); null = a licença ainda não foi lida. */
  acesso: ProAccess | null;
  /** Nome do produto do app, para a frase da assinatura. */
  produto: string;
  info: CrmInfo | null;
  /** Pipelines do CRM próprio; null = não lidos (ou o motor é o Streak). */
  local: CrmLocal | null;
  erroConsulta: string | null;
  instalando: boolean;
  /** Últimas linhas do instalador (evento crm:progress). */
  log: readonly string[];
  erroInstalacao: string | null;
}
export type CrmCartaoAcao = "instalar" | "gmail" | "configurar";
export interface CrmCartaoVista {
  /** null = sem selo (Este Mac). */
  selo: { texto: string; classe: "" | "pill-on" | "pill-off" } | null;
  linhas: string[];
  aviso: { texto: string; ruim: boolean } | null;
  acoes: CrmCartaoAcao[];
  log: string[];
}

export const CRM_SO_SSH = "O CRM funciona nas máquinas por SSH.";
const n = (q: number, um: string, varios: string): string => (q === 1 ? `1 ${um}` : `${q} ${varios}`);

/** Sem o plano, o cartão diz por quê em vez de oferecer instalar (o main recusaria o crm:install do mesmo jeito). */
function semPlano(a: Exclude<ProAccess, "ok">, produto: string): string {
  if (a === "assinatura") return `A assinatura do ${produto} não está ativa nesta máquina.`;
  if (a === "expired") return "O plano Pro desta máquina venceu: o CRM volta quando ele for renovado.";
  if (a === "unknown") return "Não deu para ler o plano desta máquina.";
  return "O CRM faz parte do plano Pro, e esta máquina não tem o Pro.";
}

/** Pipeline padrão, quantos pipelines e quantas caixas, quando a máquina já respondeu. */
function numeros(info: CrmInfo, local: CrmLocal | null): string[] {
  if (local === null) return info.pipelineName !== null ? [`Pipeline padrão: ${info.pipelineName}`] : [];
  if (local.pipelines.length === 0) return ["Nenhum pipeline ainda: crie o primeiro em Configurar."];
  const padrao = local.padrao === null ? null : local.pipelines.find((p) => p.key === local.padrao)?.name ?? local.padrao;
  const caixas = local.pipelines.reduce((s, p) => s + p.boxes, 0);
  return [padrao === null ? "Nenhum pipeline padrão: escolha um em Configurar." : `Pipeline padrão: ${padrao}`, `${n(local.pipelines.length, "pipeline", "pipelines")} · ${n(caixas, "caixa", "caixas")}`];
}

export function cartaoCrm(e: CrmCartaoEstado): CrmCartaoVista {
  const v: CrmCartaoVista = { selo: null, linhas: [], aviso: null, acoes: [], log: [] };
  if (!e.remoto) return { ...v, aviso: { texto: CRM_SO_SSH, ruim: false } };
  const instalado = e.info === null ? null : e.info.installed;
  const selo: CrmCartaoVista["selo"] = instalado === null ? { texto: "Verificando…", classe: "" } : instalado ? { texto: "Instalado", classe: "pill-on" } : { texto: "Não instalado", classe: "" };
  if (e.instalando) return { ...v, selo: { texto: "Instalando…", classe: "" }, log: [...e.log] };
  if (e.acesso === null) return { ...v, selo };
  if (e.acesso !== "ok") return { ...v, selo, aviso: { texto: semPlano(e.acesso, e.produto), ruim: false } };
  if (e.info === null) return { ...v, selo, aviso: e.erroConsulta === null ? null : { texto: `Não deu para consultar a máquina: ${e.erroConsulta}`, ruim: true } };
  if (!e.info.installed) return { ...v, selo, aviso: e.erroInstalacao === null ? null : { texto: `A instalação falhou: ${e.erroInstalacao}`, ruim: true }, acoes: ["instalar"] };
  return { ...v, selo, linhas: numeros(e.info, e.local), acoes: ["gmail", "configurar"] };
}
