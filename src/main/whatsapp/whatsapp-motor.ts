/**
 * O contrato que cada motor de WhatsApp (OpenClaw, Hermes, PicoClaw) implementa, e `motorDe(host)`: a fachada
 * whatsapp.ts não pergunta mais "é Hermes?" função por função; pede ao motor da máquina. Os scripts de status, lista,
 * grupos, pareamento e logout continuam UMA viagem de SSH: cada motor contribui o seu fragmento de shell e a fachada
 * monta `case "$MOTOR"` com a regra única (WA_MOTOR_SH); o parse é despachado pelo `gateway=` que o fragmento imprime.
 * O que é decidido pelos dados (chaves de sessão do Hermes vs. do OpenClaw) fica na fachada; o que é IO do motor, aqui.
 */
import type { Gateway, WhatsappAlvoResolvido, WhatsappChat, WhatsappGroupPatch, WhatsappGroups, WhatsappReplyChoice, WhatsappStatus, WhatsappThreadMessage } from "../../shared/ipc";
import type { WaQuem } from "./whatsapp-marks";
import type { PauseBy } from "./whatsapp-pause";
import { agenteEscolhido, WA_ALVO_SH, WA_MOTOR_SH } from "./whatsapp-capacidades";
import { runSsh } from "./whatsapp-ssh";
import { alvoDoScript, gatewayByHost } from "./whatsapp-estado";
import { kvTrimOf } from "./whatsapp-kv";
import { criarMotorOpenclaw } from "./whatsapp-openclaw";
import { criarMotorHermes } from "./whatsapp-hermes";
import { criarMotorPicoclaw } from "./whatsapp-picoclaw";

/** Quem roda um script na máquina: o runSsh de verdade, ou um falso no teste. */
export type Exec = (host: string, script: string, timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string }>;
/** O que "Limpar histórico" de um contato vai zerar: sessões só dele, a principal (de todos) e se ele está pausado. */
export interface PlanoLimpeza { own: string[]; shared: string[]; paused: boolean }
export interface DonoHome { numero: string; nome: string | null }

export interface MotorWhatsapp {
  readonly nome: Gateway;
  /** Fragmento do STATUS_SCRIPT: imprime `gateway=<nome>`, `present=1` e o resto em chave=valor, e termina com `exit 0`. */
  readonly statusSh: string;
  parseStatus(host: string, kv: Map<string, string>): Omit<WhatsappStatus, "capacidades">;
  /** Fragmento da lista de conversas (imprime `gateway=`, `self=`, `list=`…); a fachada acrescenta marcas e política. */
  readonly chatsSh: string;
  parseChats(host: string, kv: Map<string, string>): WhatsappChat[];
  /** Fragmento dos grupos; a fachada acrescenta as marcas. */
  readonly groupsSh: string;
  parseGroups(host: string, kv: Map<string, string>): WhatsappGroups;
  /** Ramo do PAIR_SCRIPT (eventos JSON por linha; sai com o código do pareamento). */
  readonly pairSh: string;
  /** Ramo do logout: imprime `OUT=<motor>` (desconectou), `OUT=still` (não conseguiu) ou `OUT=none` (nada configurado). */
  readonly logoutSh: string;
  /** Reinicia o gateway do motor (admin › reiniciar gateway). */
  readonly restartSh: string;
  /** Quem manda: o número pareado e o dono gravado (whatsapp-lista.json). */
  readQuem(host: string): Promise<WaQuem>;
  /** Mensagens de um contato; `name` = pushname visto nesta leitura (null quando o motor não o traz). */
  thread(host: string, chat: WhatsappChat, limit: number): Promise<{ messages: WhatsappThreadMessage[]; name: string | null }>;
  /** Nomes dos contatos sem nome, lendo o histórico; {} quando o motor já traz o nome na lista. */
  learnNames(host: string, chats: readonly WhatsappChat[], want: readonly string[]): Promise<Record<string, string>>;
  /** Zera sessões (chaves do OpenClaw ou ids do Hermes, já saneadas). */
  clearSessions(host: string, keys: readonly string[]): Promise<void>;
  /** Pausa/retoma um contato. `plano` lê (uma vez, se o motor precisar) as sessões dele. */
  pause(host: string, want: string, paused: boolean, by: PauseBy, horas: 2 | 24 | undefined, plano: () => Promise<PlanoLimpeza>): Promise<void>;
  /** Contato pausado que vai ter a conversa limpa: garante a pausa na lista durável antes. */
  keepPaused(host: string, want: string, own: readonly string[]): Promise<void>;
  /** Quem o agente responde nas DMs; `home` (Hermes) aponta o home channel para o dono. A fachada devolve o estado. */
  setDmPolicy(host: string, policy: WhatsappReplyChoice, numbers: readonly string[], opts: { home?: DonoHome }): Promise<void>;
  groupClearPlan(host: string, jid: string, grupos: () => Promise<WhatsappGroups>): Promise<{ sessoes: number }>;
  groupClear(host: string, jid: string, grupos: () => Promise<WhatsappGroups>): Promise<void>;
  groupThread(host: string, jid: string, n: number, grupos: () => Promise<WhatsappGroups>): Promise<WhatsappThreadMessage[]>;
  /** Liga/desliga o agente num grupo; `lerGrupos` relê (sem cache) para devolver o estado novo. */
  setGroup(host: string, jid: string, pedido: WhatsappGroupPatch, lerGrupos: () => Promise<WhatsappGroups>): Promise<WhatsappGroups>;
  /** Atualiza a lista de grupos pelo WhatsApp (para o gateway uns 30 s). */
  refreshGroups(host: string): Promise<void>;
  /**
   * Os mesmos fragmentos, para um alvo (conta e agente num gateway que pode ser de outro usuário): a fachada os roda no
   * alias do gateway quando a máquina tem um alvo gravado. Só o OpenClaw tem contas.
   */
  readonly porAlvo?: { statusSh(a: WhatsappAlvoResolvido): string; chatsSh(a: WhatsappAlvoResolvido): string; groupsSh(a: WhatsappAlvoResolvido): string; pairSh(a: WhatsappAlvoResolvido): string; logoutSh(a: WhatsappAlvoResolvido): string };
}

export const MOTORES: Record<Gateway, MotorWhatsapp> = { openclaw: criarMotorOpenclaw(), hermes: criarMotorHermes(), picoclaw: criarMotorPicoclaw() };
export const motorPorNome = (g: Gateway | null | undefined): MotorWhatsapp | null => (g === null || g === undefined ? null : MOTORES[g]);

/**
 * O motor da máquina: o visto na última consulta (status, lista ou grupos); sem ela, a regra única (WA_MOTOR_SH) numa
 * sonda curta, que fica em cache. Sem motor = a máquina não tem agente com WhatsApp.
 */
export async function motorDe(host: string, run: Exec = runSsh): Promise<MotorWhatsapp> {
  let g = gatewayByHost.get(host) ?? null;
  if (g === null) {
    const r = await run(host, `${WA_MOTOR_SH}\necho "motor=$MOTOR"\n${WA_ALVO_SH}\n`, 20_000);
    g = agenteEscolhido(/^motor=(\S*)$/m.exec(r.stdout)?.[1]);
    if (r.code === 0 && g !== null) { gatewayByHost.set(host, g); alvoDoScript(host, kvTrimOf(r.stdout)); }
  }
  if (g === null) throw new Error("esta máquina não tem agente com WhatsApp (Hermes, OpenClaw ou PicoClaw)");
  return MOTORES[g];
}
