/** Contrato IPC · CRM da máquina. Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */

/** Tutorial 17 · CRM pelo WhatsApp (Pro): configuração na máquina (crm.json sem a chave) e instalação do plugin. */
/** CRM próprio da máquina (meu-bot-crm): pipelines e o padrão do WhatsApp (null = nenhum: nada é anotado). */
/** O que um modelo pronto acrescenta ao pipeline novo: campos e a marca de autonomia do agente (crm-modelo.js valida). */
export interface CrmPipelineExtras { fields?: { name: string; type: string; options: string[] }[]; agenteAutonomo?: boolean }
export interface CrmLocal { pipelines: { key: string; name: string; boxes: number }[]; padrao: string | null }

export interface CrmInfo {
  /** Janela de máquina por SSH (neste Mac não há agente). */
  available: boolean;
  /** Plugin meu-bot-crm + streak.mjs na máquina. */
  installed: boolean;
  /** Há chave da API do Streak gravada (a chave nunca volta ao app). */
  configured: boolean;
  /** Só a chave do Streak (sem contar pipeline). */
  streakKey: boolean;
  /** Motor gravado em crm.json; null = decidido pela regra (chave do Streak → Streak; senão Pro/produto → próprio). */
  motor: "proprio" | "streak" | null;
  pipelineKey: string | null;
  pipelineName: string | null;
  /** Minutos de silêncio na conversa antes de o agente anotar. */
  silencioMin: number;
  /** Criar box e mudar etapa sem perguntar (padrão: propõe e espera "ok"). */
  criarSemPerguntar: boolean;
  savedAt: string | null;
}
/** `streak.mjs diag` na máquina: a chave funciona? quais pipelines existem? */
export interface CrmDiag { ok: boolean; erro: string | null; usuario: string | null; pipelines: { key: string; name: string }[]; pipeline: { name: string; stages: string[]; fields: string[] } | null }
