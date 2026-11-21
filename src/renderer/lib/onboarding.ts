/**
 * Onboarding guiado da primeira vez: a pessoa executa cada ação e o app só orienta. Puro (sem DOM):
 * passos, avanço por evento e o sorteio do feedback, testáveis com node --test.
 */

/** O que o renderer observa acontecer; cada passo espera um deles. */
export type OnboardEvent = "sidebar" | "palette-open" | "palette-close" | "settings-closed" | "new-tab";

export interface OnboardStep {
  id: "sidebar" | "palette" | "settings" | "new";
  title: string;
  text: string;
  /** Evento que conclui o passo. */
  completes: OnboardEvent;
  /** Evento que precisa ter acontecido antes (ex.: abrir a paleta antes de fechá-la contar). */
  after?: OnboardEvent;
}

export const ONBOARD_STEPS: readonly OnboardStep[] = [
  { id: "sidebar", title: "Lista de conversas", text: "Ela fica recolhida por padrão. Abra com o botão ☰ no topo ou com Cmd + B.", completes: "sidebar" },
  { id: "palette", title: "Paleta de comandos", text: "Aperte Cmd + K DUAS vezes: a primeira abre a paleta, que acha conversas e ações pelo nome; a segunda fecha. O passo só conclui quando ela fechar.", completes: "palette-close", after: "palette-open" },
  { id: "settings", title: "Configurações", text: "Aperte Cmd + vírgula (⌘ ,) DUAS vezes: a primeira abre as Configurações, o mesmo atalho de preferências de todo app do Mac; a segunda fecha. Entre uma e outra, espie as seções.", completes: "settings-closed" },
  { id: "new", title: "Primeira conversa", text: "Aperte Cmd + N, ou clique no botão Novo, para criar a primeira conversa. A primeira mensagem vai sozinha.", completes: "new-tab" },
];

/**
 * Boas-vindas no fim do tour: mensagem local (não vai ao agente, não gasta nada e não falha sem login). Com o
 * Claude Code deslogado na máquina, explica que falta entrar; o renderer põe o botão "Entrar no Claude Code".
 * `loggedIn` null = não deu para saber (ex.: este Mac): segue como logado.
 */
export function welcomeMessage(machine: string, loggedIn: boolean | null): string {
  const head = `**Bem-vindo ao meu-bot.** Esta conversa roda na máquina **${machine}**: o agente de lá lê, escreve e executa por você.`;
  if (loggedIn === false) {
    return `${head}\n\nPara o agente responder, falta **entrar no Claude Code** desta máquina: é o **tutorial 1**. O link abre no navegador e você cola o código no passo 1; leva um minuto.`;
  }
  return [
    head, "",
    "Algumas ideias para começar:",
    "- \"O que tem nesta máquina?\"",
    "- \"Resuma o que mudou no projeto hoje.\"",
    "- Conectar o WhatsApp: **Tutoriais**, na lateral.",
    "",
    "Escreva abaixo quando quiser.",
  ].join("\n");
}
/** Aviso ao pular: deixa claro que acabou e como refazer. */
export const SKIPPED_MESSAGE = { title: "Tour pulado", text: "Tudo bem. Para fazer depois: Tutoriais, na lateral, › Tour do meu-bot. Ou ligue \"Onboarding\" no rodapé do seletor." };
/** Convite da primeira abertura: o tour só começa se a pessoa aceitar. */
export const TOUR_INVITE = { title: "Vamos fazer um tour", text: "Quer que eu te mostre a lateral, a paleta de comandos, as configurações e a primeira conversa, ou prefere explorar por conta própria?" };
/** Cartão do tour em Tutoriais (o primeiro da lista). */
export const TOUR_CARD = { title: "Tour do meu-bot", summary: "A lateral, a paleta de comandos, as configurações e a primeira conversa, em quatro ações suas.", minutes: 1 };
/** Transição de encerramento, mostrada no cartão por alguns segundos. */
export const FINAL_MESSAGE = { title: "Isso é tudo", text: "Fim do tour. Agora te levo aos Tutoriais para o próximo passo; a conversa fica na aba dela." };

export interface OnboardState { step: number; armed: boolean }
export const initialOnboardState = (): OnboardState => ({ step: 0, armed: false });

export interface OnboardAdvance { state: OnboardState; advanced: boolean; finished: boolean }

/** Aplica um evento ao estado: só o evento do passo atual avança; os outros são ignorados. */
export function advanceOnboard(state: OnboardState, ev: OnboardEvent): OnboardAdvance {
  const step = ONBOARD_STEPS[state.step];
  if (step === undefined) return { state, advanced: false, finished: true };
  if (step.after !== undefined && ev === step.after) return { state: { ...state, armed: true }, advanced: false, finished: false };
  if (ev !== step.completes || (step.after !== undefined && !state.armed)) return { state, advanced: false, finished: false };
  const next = state.step + 1;
  return { state: { step: next, armed: false }, advanced: true, finished: next >= ONBOARD_STEPS.length };
}

export type Feedback = { kind: "text"; text: string } | { kind: "icon"; text: string } | { kind: "none" };

const PHRASES = ["Isso.", "Boa.", "Simples assim.", "Mais um.", "Fluiu.", "Já era.", "Era só isso."];
const ICONS = ["✓", "✨", "👌", "🎯", "🙌", "⚡"];

/** Feedback pequeno e variado: às vezes frase, às vezes ícone, às vezes nada; nunca repete o anterior. */
export function pickFeedback(rand: () => number = Math.random, previous?: Feedback): Feedback {
  const r = rand();
  const pool = (list: readonly string[]): readonly string[] => (previous !== undefined && previous.kind !== "none" ? list.filter((x) => x !== previous.text) : list);
  const pick = (list: readonly string[]): string => list[Math.min(list.length - 1, Math.floor(rand() * list.length))] ?? list[0]!;
  if (r < 0.4) return { kind: "text", text: pick(pool(PHRASES)) };
  if (r < 0.7) return { kind: "icon", text: pick(pool(ICONS)) };
  if (previous?.kind === "none") return { kind: "icon", text: pick(ICONS) };
  return { kind: "none" };
}

// ---- Primeira abertura (staging): "Você já tem assinatura de IA?" antes do tour. Leva direto ao tutorial da conta
// que a pessoa tem; quem não tem nenhuma vê como assinar (o modo grátis no Mac vem depois).

export type AiChoice = "claude" | "grok" | "ambos" | "nenhuma";

export interface AiChoiceOption { id: AiChoice; title: string; text: string }

export const AI_CHOICE_INVITE = { title: "Você já tem assinatura de IA?", text: "O agente pensa com a sua conta de IA. Escolha a que você tem e eu te levo direto ao passo a passo dela." };

export const AI_CHOICES: readonly AiChoiceOption[] = [
  { id: "claude", title: "Tenho Claude", text: "Plano Pro ou Max da Anthropic. Você entra na sua conta e o agente já responde." },
  { id: "grok", title: "Tenho Grok (xAI)", text: "Conta da xAI. Você prepara o Grok nesta máquina e entra na sua conta." },
  { id: "ambos", title: "Tenho os dois", text: "Claude como principal e Grok como reserva: se um falhar, o outro assume." },
  { id: "nenhuma", title: "Não tenho nenhuma", text: "Eu te mostro como assinar. Um modo grátis, rodando no seu Mac, está a caminho." },
];

/** Painel de quem escolheu "Não tenho nenhuma". */
export const AI_NONE_INFO = {
  title: "Para o agente responder, ele precisa de uma IA",
  text: "Assine uma das duas e volte: a escolha fica em Tutoriais, no tutorial 1 (Claude) ou no 4 (Grok).",
  soon: "Em breve: modo grátis no Mac. Ele sugere as respostas e você aprova antes de enviar.",
  links: [
    { label: "Assinar o Grok", url: "https://grok.com" },
    { label: "Assinar o Claude", url: "https://claude.ai" },
  ],
} as const;

/** "Não tenho nenhuma" quando o modo grátis (tutorial 16) existe nesta janela: leva direto à instalação. */
export const AI_NONE_GRATIS: AiChoiceOption = { id: "nenhuma", title: "Não tenho nenhuma", text: "Comece de graça: eu instalo um modelo que roda no seu Mac. Dá para assinar Claude ou Grok depois." };

/** As opções com o texto certo do "Não tenho nenhuma" (com o modo grátis, ele instala; sem, mostra como assinar). */
export const comModoGratis = (opcoes: readonly AiChoiceOption[], gratis: boolean): readonly AiChoiceOption[] =>
  gratis ? opcoes.map((o) => (o.id === "nenhuma" ? AI_NONE_GRATIS : o)) : opcoes;

/** Tutorial que abre para cada escolha. "ambos" começa pelo Claude: o 4 (Grok) e o fallback vêm depois dele. */
export function tutorialDaEscolha(c: AiChoice): "claude-login" | "xai-login" | null {
  if (c === "claude" || c === "ambos") return "claude-login";
  if (c === "grok") return "xai-login";
  return null;
}

/** Sem Grok possível nesta máquina (`false`), as opções que dependem dele somem; `null` (não consultado) mostra todas. */
export function opcoesVisiveis(xaiPossible: boolean | null): readonly AiChoiceOption[] {
  return xaiPossible === false ? AI_CHOICES.filter((o) => o.id !== "grok" && o.id !== "ambos") : AI_CHOICES;
}

export interface AiAccounts { claude: { loggedIn: boolean | null; global: boolean }; xai: { possible: boolean | null; loggedIn: boolean | null } }

/** Com o Claude Code Global do admin a conta já existe (tutorial 1 concluído): a pergunta não aparece. */
export const pularEscolhaIa = (a: AiAccounts): boolean => a.claude.global;

/** Opção já marcada a partir das contas logadas; nada logado (ou não consultado) = nenhuma marcada. */
export function preselecao(a: AiAccounts): AiChoice | null {
  const claude = a.claude.loggedIn === true;
  const xai = a.xai.possible !== false && a.xai.loggedIn === true;
  if (claude && xai) return "ambos";
  if (claude) return "claude";
  if (xai) return "grok";
  return null;
}

const AI_CHOICE_IDS: readonly string[] = AI_CHOICES.map((o) => o.id);
/** Lê a escolha guardada (localStorage); qualquer outra coisa = sem escolha. */
export const parseAiChoice = (raw: string | null): AiChoice | null => (raw !== null && AI_CHOICE_IDS.includes(raw) ? (raw as AiChoice) : null);
