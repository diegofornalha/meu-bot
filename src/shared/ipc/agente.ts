/** Contrato IPC · Contas e ferramentas do agente: Claude, xAI, status line, objetivo, voz. Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */

/** Segmentos da status line (barra do Claude Code na máquina e rodapé do app): ligar/desligar. `espaco` só existe no rodapé (o statusline.sh ignora). */
export interface StatusLineSegments { model: boolean; ctx: boolean; account: boolean; session: boolean; weekly: boolean; espaco: boolean }

/** Nível do espaço da conta na máquina: ok, perto (≥80%), crítico (≥95%), cheio (≥100%, ainda grava por 7 dias com a folga). */
export type CotaNivel = "ok" | "perto" | "critico" | "cheio";
/** O que ocupa espaço: `dela` = conta como uso dela (programas do agente não); `apagavel` = entra no "Liberar espaço". */
export interface CotaItem { id: string; rotulo: string; kb: number; dela: boolean; apagavel: boolean }
/** Cota de disco da conta na máquina, lida pelo backend dela (`quota -wu`): usado, limite macio, duro (null = igual), %, nível, carência quando acima do macio, o que ocupa e quando leu. */
export interface CotaInfo { usadoKb: number; limiteKb: number; hardKb: number | null; pct: number; nivel: CotaNivel; grace: string | null; itens: CotaItem[]; em: string }

export interface AccountStatus {
  /** Preferência de segmentos gravada na máquina (~/.claude/statusline-segments.json); ausente/null = todos. */
  segments?: StatusLineSegments | null;
  email: string | null;
  assento: string | null;
  sessionPct: number | null;
  weeklyPct: number | null;
  /** Epoch em segundos. */
  sessionResets: number | null;
  weeklyResets: number | null;
  updated: number | null;
  /** Corrente de provedores do backend, em ordem de prioridade. */
  providers: { name: string; type: "claude" | "openai"; available: boolean }[];
  /** Modelo que o Claude Code da máquina usa agora ("Fable 5.1", ou "Opus 5.5" durante o limite); null = backend antigo. */
  modelName?: string | null;
  /** Contas do Claude na máquina: a que respondeu por último, quantas há e quantas estão fora (limite/bloqueio); null = backend antigo. */
  contas?: { atual: string | null; rotulo: string | null; total: number; esgotadas: number; proximaEm: number | null } | null;
  /** Cota de disco da conta na máquina; null = sem cota; ausente = backend antigo (antes do 1.9). */
  cota?: CotaInfo | null;
}

/** Grok por OAuth em máquina ainda sem o preparo: há backend do meu-bot nela? (é o que o "entrar"/tutorial 4 prepara). */
export interface XaiKeyStatus { backend: boolean }

/** Quando o agente responde em áudio: nunca, só quando recebe áudio, ou sempre. */
export type VoiceReplyMode = "off" | "inbound" | "always";
/** Instaladores de áudio do agente do WhatsApp: ouvir (transcrição) ou falar (voz, com o modo). */
/** "in" liga a transcrição (padrão do app ao parear); `off: true` desliga. "out" é a voz, pelo modo. */
/** Voz das respostas em áudio: faber (masculina, Piper), dora (feminina, Kokoro), alex (masculina natural, Kokoro). */
export type VozId = "faber" | "dora" | "alex";
export type AudioSetup = { kind: "in"; off?: boolean } | { kind: "out"; mode: VoiceReplyMode; voz?: VozId };

/** Tutorial 7 · objetivo do WhatsApp: a escolha da pessoa (rótulo do cartão + frase livre; "outro" exige a frase). */
export interface ObjectiveChoice { id: string; label: string; text: string }
/** Quanta liberdade o agente tem: só conversa, consulta e organiza, ou age pelo dono. */
export type FreedomLevel = "conversa" | "consulta" | "age";
/** Uma skill do workspace do OpenClaw na máquina (`<workspace>/skills/<nome>/SKILL.md`); `objective` = a do tutorial 7. */
export interface MachineSkill { name: string; description: string; objective: boolean; /** Skill aprendida/instalada para o Claude Code da máquina (~/.claude/skills), não do workspace do OpenClaw. */ learned?: boolean }
/** Estado do tutorial 7 na máquina (objetivo.json + skills do workspace). */
export interface ObjectiveInfo {
  /** Janela de máquina por SSH (neste Mac não há agente). */
  available: boolean;
  objective: ObjectiveChoice | null;
  level: FreedomLevel | null;
  /** Quando a skill foi salva pela última vez; null = ainda não. */
  savedAt: string | null;
  /** Nome fixo da skill do objetivo. */
  skill: string;
  /** O SKILL.md do objetivo existe no workspace. */
  skillPresent: boolean;
  /** Todas as skills do workspace (o Acervo lista; a do objetivo primeiro). */
  skills: MachineSkill[];
}

/** Conta do Claude Code na máquina. */
/** `global`: a máquina responde pelo Claude Code Global do admin (a assinatura do root); a pessoa vê, sem mexer. */
export interface ClaudeAuthInfo { loggedIn: boolean; email: string | null; global?: boolean;
  /** xAI: o proxy local do grok-4 (meu-bot-xai-proxy.service + providers.json) está nesta conta; sem ele o grok-4 não responde mesmo logada. */
  proxy?: boolean }

/** Janela de uso de uma conta do Claude: % usado e quando reseta (epoch s). */
export interface ContaClaudeJanela { pct: number; resets: number | null }
/** Estado efetivo de uma conta: `aviso` = acima do limiar (derivado), `esgotada` = limite batido até `ate`, `bloqueada` = login vencido ou conta com problema. */
export type ContaClaudeEstado = "ok" | "aviso" | "esgotada" | "bloqueada" | "desconhecida";
/** Uma conta do Claude Code na máquina (contas-claude.js no backend). `padrao` = o login normal de ~/.claude. */
export interface ContaClaude {
  id: string;
  rotulo: string;
  email: string | null;
  padrao: boolean;
  /** O Claude Code Global do admin: primeiro da fila, travado (a gestão é do admin). */
  global?: boolean;
  /** Pasta isolada (CLAUDE_CONFIG_DIR); null na padrão. */
  home: string | null;
  ordem: number;
  ativa: boolean;
  logada: boolean;
  uso: { sessao: ContaClaudeJanela | null; semanal: ContaClaudeJanela | null; estado: ContaClaudeEstado; motivo: string | null; ate: number | null; vistoEm: number | null };
}
/** Limiares do rodízio: % da sessão (5 h) e da semana a partir dos quais a conta sai de preferência; estratégia de ordem. */
export interface LimiaresClaude { sessao: number; semanal: number; estrategia: "ordem" | "folga" }
/** GET /v1/meu-bot/contas-claude. `atual` = a conta que responderia agora; `proximaEm` = quando alguma volta (epoch s) se nenhuma serve. */
export interface ContasClaudeView { contas: ContaClaude[]; limiares: LimiaresClaude; atual: string | null; proximaEm: number | null; eventos?: ContaClaudeEvento[] }
/** Troca de conta feita fora do backend (porteiro do claude: WhatsApp pelo OpenClaw, Terminal); `em` em epoch s. */
export interface ContaClaudeEvento { em: number; origem: string; de: string | null; para: string | null; motivo: string; resets: number | null }

/** Eventos do login do Claude Code numa máquina (claude auth login por SSH). */
export type ClaudeLoginEvent =
  | { kind: "url"; url: string }
  | { kind: "waiting-code" }
  | { kind: "log"; text: string }
  | { kind: "done"; ok: boolean; text: string };

/** Contas de CLI na máquina (tutorial 11). */
export type ContaId = "cloudflare" | "github";
/** `presente` = a ferramenta existe na máquina; `amplo` = logada com mais acesso que o necessário (refazer limita). */
export interface ContaEstado { id: ContaId; presente: boolean; conectado: boolean; conta: string | null; amplo: boolean }
/** Link público da pessoa (tutorial 13): a URL, o nome (subdomínio), o domínio e quantos arquivos estão no ar. */
export interface LinkPublicoInfo { url: string; nome: string; dominio: string; arquivos: number; /** O nome de login dela (o nome inicial do link). */ usuario: string }
/** Estado do link dela: `info` null = desligado, máquina fora ou este Mac; `possivel` false = esta conta não tem link por desenho (o root: o link é das contas de usuário). */
export interface LinkPublicoStatus { info: LinkPublicoInfo | null; possivel: boolean; /** A máquina tem o Link Público Global (instalado pelo admin); false = nem o admin instalou ainda. */ global: boolean }
/** Um item no ar no link dela (`publicar --lista`): a URL, o nome (último segmento) e se é pasta ou página (termina em /). */
export interface LinkPublicoItem { url: string; nome: string; pasta: boolean }
/** O link dela e o que está no ar. */
export interface LinkPublicoLista { info: LinkPublicoInfo; itens: LinkPublicoItem[] }
/** Depois de publicar: a URL do que acabou de ir ao ar, mais o link e a lista novos. */
export interface LinkPublicoPublicado extends LinkPublicoLista { url: string }
/** Login de uma conta de CLI: o link (e o código de dispositivo, se a página pedir) e o fim, com o estado conferido. */
export type ContaEvento =
  | { kind: "url"; id: ContaId; url: string; codigo: string | null }
  | { kind: "log"; id: ContaId; text: string }
  | { kind: "done"; id: ContaId; ok: boolean; text: string; estado?: ContaEstado | null };
