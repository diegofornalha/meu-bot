/**
 * Quais modelos existem para uma máquina: os perfis do Claude, que todo backend tem, mais os provedores que o backend
 * dela informa em GET /v1/meu-bot/status (os do providers.json e os que os módulos ligados trazem). Nenhum provedor
 * tem nome escrito aqui: rótulo, cor, tempo-limite e reserva saem de regra. Puro (main e renderer usam), com teste.
 */

/** Perfis do Claude Code no backend: existem em toda máquina e não dependem do providers.json. */
export const PERFIS_CLAUDE: readonly string[] = ["claudecode", "agente", "rene-dm", "rene"];
export const MODELO_PADRAO = "agente";
/** A mesma regra de nome de provedor do backend (NAME_RE em backend-colima/providers.js). */
const NOME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** Um provedor como o /status o informa. Backend antigo não manda `reserva` nem `rotulo`: reserva vale, rótulo é o nome. */
export interface ProvedorDaMaquina {
  name: string;
  type: "claude" | "openai";
  available: boolean;
  /** false = não é reserva de outro modelo; só responde quando escolhido. */
  reserva?: boolean;
  /** Nome para a pessoa ler ("Grok (xAI)"); sem ele vale o `name`. */
  rotulo?: string;
  /** Módulo que trouxe o provedor; ausente = é do providers.json da máquina. */
  modulo?: string;
}

/** Um modelo escolhível numa conversa desta máquina. */
export interface ModeloDaMaquina {
  nome: string;
  rotulo: string;
  /** Perfil do Claude (conta e limites do Claude valem para ele). */
  claude: boolean;
  /** false = a máquina o conhece mas ele não responde agora (sem chave), ou a conversa o usa e a máquina não o tem mais. */
  disponivel: boolean;
}

/**
 * Nome aceitável de modelo. As configurações são validadas sem a máquina à mão, então vale a regra de nome; o modelo
 * que a máquina não tem (mais) se resolve no uso: o backend responde `model_not_found` e a conversa cai no recuo.
 */
export const nomeDeModeloValido = (v: unknown): v is string => typeof v === "string" && NOME_RE.test(v);
export const ehPerfilClaude = (nome: string): boolean => PERFIS_CLAUDE.includes(nome);

/** Lê o campo `providers` do /status, de qualquer versão de backend; o que não é um provedor válido fica de fora. */
export function lerProvedores(raw: unknown): ProvedorDaMaquina[] {
  if (!Array.isArray(raw)) return [];
  const out: ProvedorDaMaquina[] = [];
  for (const item of raw as unknown[]) {
    const p = (item !== null && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const name = p["name"];
    if (!nomeDeModeloValido(name)) continue;
    const rotulo = typeof p["rotulo"] === "string" ? p["rotulo"].trim().slice(0, 60) : "";
    const modulo = typeof p["modulo"] === "string" ? p["modulo"].slice(0, 80) : "";
    out.push({ name, type: p["type"] === "openai" ? "openai" : "claude", available: p["available"] === true, reserva: p["reserva"] !== false, ...(rotulo !== "" ? { rotulo } : {}), ...(modulo !== "" ? { modulo } : {}) });
  }
  return out;
}

/** O nome que a pessoa lê: o rótulo que o provedor traz, ou o próprio nome. */
export function rotuloDoModelo(nome: string, provedores: readonly ProvedorDaMaquina[] | null): string {
  return (provedores ?? []).find((p) => p.name === nome)?.rotulo ?? nome;
}

export interface EntradaDeModelos {
  /** `providers` do /status; null = ainda não chegou, ou o backend não tem o endpoint. */
  provedores: readonly ProvedorDaMaquina[] | null;
  /** Modelos do GET /v1/models (sondagem da abertura): só valem enquanto o /status não chegou. */
  anunciados?: readonly string[];
  /** Modelo da conversa aberta: não some da lista mesmo que a máquina não o tenha mais. */
  atual?: string | null;
}

/**
 * A lista de modelos de uma máquina, na ordem do seletor: os perfis do Claude e depois os provedores que não são
 * Claude, na ordem (de prioridade) em que o backend os informa.
 */
export function modelosDaMaquina(e: EntradaDeModelos): ModeloDaMaquina[] {
  const out: ModeloDaMaquina[] = PERFIS_CLAUDE.map((nome) => ({ nome, rotulo: nome, claude: true, disponivel: true }));
  const tem = (nome: string): boolean => out.some((m) => m.nome === nome);
  // Backend que informa provedores traz ao menos o agente; lista vazia é o /status de antes de existir o campo.
  const sabe = e.provedores !== null && e.provedores.length > 0;
  for (const p of e.provedores ?? []) {
    if (p.type !== "openai" || tem(p.name)) continue;
    out.push({ nome: p.name, rotulo: p.rotulo ?? p.name, claude: false, disponivel: p.available });
  }
  if (!sabe) for (const nome of e.anunciados ?? []) if (nomeDeModeloValido(nome) && !tem(nome)) out.push({ nome, rotulo: nome, claude: false, disponivel: true });
  // Com a lista da máquina na mão, o modelo da conversa que não está nela sumiu; sem a lista, ainda não se sabe.
  const atual = e.atual ?? null;
  if (atual !== null && nomeDeModeloValido(atual) && !tem(atual)) out.push({ nome: atual, rotulo: atual, claude: false, disponivel: !sabe });
  return out;
}

/** Entra como reserva de outro modelo? Só não entra quem diz `reserva: false`. */
export const serveDeReserva = (p: { reserva?: boolean }): boolean => p.reserva !== false;

/** Cores (matiz HSL) dos modos que vêm com o app; os outros ganham a sua pela regra de `matizDoModelo`. */
const MATIZ_DO_APP: Readonly<Record<string, number>> = { agente: 145, claudecode: 220, "rene-dm": 330, rene: 270, "ollama-local": 190 };
/** Matiz do modo (anel do botão, mascote do aviso de troca): fixa para os modos do app, derivada do nome para o resto. */
export function matizDoModelo(nome: string): number {
  const fixa = MATIZ_DO_APP[nome];
  if (fixa !== undefined) return fixa;
  let h = 0;
  for (const c of nome) h = (h * 31 + (c.codePointAt(0) ?? 0)) % 360;
  return h;
}

/**
 * Tempo-limite de um turno no app. Só o chat puro do Claude (claudecode) é curto. Os perfis com ferramentas levam
 * minutos; e um provedor de fora tem o tempo dele cortado pelo backend (`timeout_ms` do provedor) e ainda pode cair
 * para a reserva, que pode ser o agente: o app não pode desistir antes.
 */
export const tempoLimiteMs = (nome: string): number => (nome === "claudecode" ? 120_000 : 600_000);

/**
 * A máquina respondeu que não tem o modelo pedido (`model_not_found`: módulo desligado, provedor removido). Para qual
 * modelo a conversa volta: o padrão da máquina, ou o agente quando o padrão é o próprio que sumiu. null = não há para
 * onde voltar (quem sumiu foi o agente; o erro segue como veio).
 */
export function modeloDeRecuo(sumiu: string, padraoDaMaquina: string): string | null {
  const recuo = padraoDaMaquina !== sumiu ? padraoDaMaquina : MODELO_PADRAO;
  return recuo === sumiu ? null : recuo;
}

/** O que o turno sabe quando o backend devolve erro. */
export interface ErroDoTurno {
  /** `code` do erro do backend ("model_not_found", "model_limit"…). */
  codigo: unknown;
  modelo: string;
  padraoDaMaquina: string;
  /** Texto que já chegou da resposta: com algum, o modelo existe e respondeu. */
  parcial: string;
  /** A conversa foi fechada no meio. */
  cancelado: boolean;
  /** Este turno já é a segunda tentativa (no recuo): não recua de novo. */
  jaRecuou: boolean;
}
/** O turno deve ser refeito noutro modelo? Só quando a máquina disse que não tem o da conversa, uma vez por turno. */
export function recuoDoTurno(e: ErroDoTurno): string | null {
  if (e.jaRecuou || e.cancelado || e.codigo !== "model_not_found" || e.parcial.trim() !== "") return null;
  return modeloDeRecuo(e.modelo, e.padraoDaMaquina);
}

/** Nota de troca que o próximo turno leva ao novo modelo: de quem foram as respostas anteriores. */
export interface TrocaDeModelo { from: string; to: string }
/**
 * A troca pendente depois de a conversa passar de `atual` para `novo`. Sem histórico não há o que avisar; trocas em
 * sequência sem turno no meio guardam a origem da primeira; voltar ao modelo de origem desfaz a nota.
 */
export function trocaPendente(atual: string, novo: string, pendente: TrocaDeModelo | undefined, temHistorico: boolean): TrocaDeModelo | undefined {
  if (!temHistorico) return pendente;
  const from = pendente?.from ?? atual;
  return from === novo ? undefined : { from, to: novo };
}
