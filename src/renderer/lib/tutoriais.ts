/**
 * Tutoriais: guias ao vivo do meu-bot, numa aba própria (como o Acervo). Cada um é um cartão com selo
 * ("COMECE POR AQUI · 4 PASSOS · 3 MIN"), título, resumo e "Começar". Ao começar, o cartão vira um guia no
 * estilo do onboarding: cada passo é uma ação da pessoa, o botão certo pulsa, e o passo se marca concluído
 * sozinho pelo estado real da máquina (QR já lido = concluído). Puro: as regras ficam aqui, testáveis.
 */
import type { ContaEstado, CrmLocal, ObjectiveInfo, QuickEntryStatus, StatusLineSegments, SupportInfo, WhatsappGroups, WhatsappStatus, CrmInfo, FinanceInfo, LinkPublicoInfo } from "../../shared/ipc";
import { type FallbackProvider, FALLBACK_PRIMARIES } from "./fallback.js";
import { grupoAlvo, nomeDoGrupo, quemEscolhido, quemResumo } from "./whatsapp-grupos.js";

/**
 * O que mais o guia sabe além do WhatsApp: o suporte nesta máquina (null = ainda não consultado), a status
 * line do Claude (instalada? null = não consultado; `limits` = a conta já mostra Sessão/Semanal) e a conta do
 * Claude Code (`loggedIn` null = não consultado; `firstReply` = alguma conversa desta máquina já teve resposta).
 */
export interface GuideContext {
  support: SupportInfo | null;
  statusLine: { installed: boolean | null; limits: boolean; segments: StatusLineSegments | null };
  /** `contasExtras` = contas isoladas logadas (além do login da máquina); `trocas` = trocas automáticas já vistas (eventos). */
  claude: { loggedIn: boolean | null; email: string | null; /** Responde pelo Claude Code Global do admin (a sessão já existe). */ global: boolean; firstReply: boolean; contasExtras: number; trocas: number };
  /**
   * Grok pelo proxy local da máquina: `possible` = janela de máquina por SSH com o backend do meu-bot (false esconde o
   * tutorial 4); `pronto` = proxy e providers.json preparados nesta conta; `loggedIn` = conta da xAI; `label` = rótulo da credencial.
   */
  xai: { possible: boolean | null; pronto: boolean | null; loggedIn: boolean | null; label: string | null };
  /** Guarda do WhatsApp: `possible` = o agente da máquina aceita a guarda (capacidade `guarda`; null = sem status ainda); `installed` = está lá? (null = não consultado). */
  guarda: { installed: boolean | null; possible: boolean | null };
  /** Tutorial 16: o agente da máquina aceita ligar/desligar o "digitando…" (capacidade `digitando`; null = sem status ainda). */
  digitando: { possible: boolean | null };
  /**
   * Navegador (módulo Pro): `access` = acesso pela licença (null = não consultado); `installed` = lado da máquina
   * (MCP + regra); `tabs` = abas abertas agora; `extensions` = extensões na sessão; `agentOn` = "agente pode usar".
   */
  navegador: { access: "ok" | "free" | "expired" | "unknown" | "assinatura" | null; installed: boolean | null; tabs: number; extensions: number; agentOn: boolean; /** Sites fixos no espaço de trabalho ativo. */ servicos: number; /** A extensão do CRM próprio (meu-bot-crm) está carregada na sessão. */ extensaoEmbutida: boolean };
  /**
   * Fallback entre contas: `primary` = modelo padrão desta máquina (quem responde sempre); `chain` = a corrente de
   * provedores que o backend informa (null = ainda não consultado), com quem está disponível.
   */
  fallback: { primary: string | null; chain: readonly FallbackProvider[] | null };
  /** Tutorial 7: objetivo e nível gravados na máquina e a skill salva (null = ainda não consultado). */
  objective: ObjectiveInfo | null;
  /** Tutorial 18 (Pro): acesso pela licença (como o Navegador) e o estado na máquina (null = não consultado). */
  crm: { access: "ok" | "free" | "expired" | "unknown" | "assinatura" | null; info: CrmInfo | null; /** meu-bot-crm: pipelines do CRM da máquina e o padrão do WhatsApp (null = ainda não lido). */ local: CrmLocal | null };
  /**
   * Tutorial 10: grupos da máquina (null = não consultado), o grupo que a pessoa escolheu (jid; null = nenhum) e se
   * o agente já respondeu nesse grupo.
   */
  grupos: { info: WhatsappGroups | null; alvo: string | null; respondeu: boolean };
  /** Tutorial 11: contas de CLI desta máquina (Cloudflare, GitHub); null = ainda não consultado. */
  contas: readonly ContaEstado[] | null;
  /** Tutorial 13: o link público da pessoa nesta máquina (null = desligado pelo admin, máquina fora ou este Mac). */
  linkPublico: LinkPublicoInfo | null;
  /** Tutorial 13: false = esta conta não tem link por desenho (a janela é do root: o link é das contas de usuário); o tutorial some. */
  linkPublicoPossivel: boolean;
  /**
   * Tutorial 12 (produto meu-bot-finance): `access` = a licença da máquina libera o financeiro (null = não lida);
   * `info` = o módulo na máquina e os números do backend (null = ainda não consultado).
   */
  finance: { access: boolean | null; info: FinanceInfo | null };
  /**
   * Tutorial 15 (Pro): `access` pela licença (como o Navegador; null = não lida); a Conta Google da máquina
   * (`conectado` já desconta `precisaReconectar`; `gmailEscreve` null = sem status) e os fatos que a página Gmail conta
   * ao guia (leu, buscou, mandou para a lixeira, desfez), que viram `lembrar` nos passos.
   */
  gmail: { access: "ok" | "free" | "expired" | "unknown" | "assinatura" | null; conectado: boolean; precisaReconectar: boolean; gmailEscreve: boolean | null; lido: boolean; buscou: boolean; lixeira: boolean; desfez: boolean };
  /** Tutorial 14: o atalho global da entrada rápida e se está registrado (null = as configurações ainda não chegaram). */
  quickEntry: { status: QuickEntryStatus | null; shortcut: string };
  /**
   * O que esta janela oferece de CRM, pela licença da máquina (não pela variante): `crmProprio` = o CRM próprio no Gmail
   * está liberado e é o motor em uso; `crmStreak` = o CRM pelo Streak é o caminho (plano gratuito, ou motor Streak).
   */
  produto: { planoExigido: "free" | "pro"; crmProprio: boolean; crmStreak: boolean };
  /**
   * Que fontes já foram consultadas nesta janela. "Ainda não consultei" não é "não feito": um tutorial cujas fontes
   * não chegaram fica "verificando", fora da contagem e do selo, em vez de aparecer como pendente e sumir depois.
   */
  known: Record<GuideSource, boolean>;
}
/** De onde vêm os fatos que concluem passos; cada tutorial declara as suas em `needs`. */
export type GuideSource = "whatsapp" | "claude" | "statusline" | "xai" | "fallback" | "support" | "objective" | "guarda" | "navegador" | "crm" | "grupos" | "contas" | "finance" | "linkpublico" | "quickentry" | "google";
export const GUIDE_SOURCES: readonly GuideSource[] = ["whatsapp", "claude", "statusline", "xai", "fallback", "support", "objective", "guarda", "navegador", "crm", "grupos", "contas", "finance", "linkpublico", "quickentry", "google"];
const noneKnown = (): Record<GuideSource, boolean> => ({ whatsapp: false, claude: false, statusline: false, xai: false, fallback: false, support: false, objective: false, guarda: false, navegador: false, crm: false, grupos: false, contas: false, finance: false, linkpublico: false, quickentry: false, google: false });
export const emptyContext = (): GuideContext => ({
  support: null,
  statusLine: { installed: null, limits: false, segments: null },
  claude: { loggedIn: null, email: null, global: false, firstReply: false, contasExtras: 0, trocas: 0 },
  xai: { possible: null, pronto: null, loggedIn: null, label: null },
  guarda: { installed: null, possible: null },
  digitando: { possible: null },
  navegador: { access: null, installed: null, tabs: 0, extensions: 0, agentOn: false, servicos: 0, extensaoEmbutida: false },
  fallback: { primary: null, chain: null },
  objective: null,
  quickEntry: { status: null, shortcut: "" },
  crm: { access: null, info: null, local: null },
  grupos: { info: null, alvo: null, respondeu: false },
  contas: null,
  linkPublico: null,
  linkPublicoPossivel: true,
  finance: { access: null, info: null },
  gmail: { access: null, conectado: false, precisaReconectar: false, gmailEscreve: null, lido: false, buscou: false, lixeira: false, desfez: false },
  produto: { planoExigido: "free", crmProprio: false, crmStreak: true },
  known: noneKnown(),
});

/** Onde o guia aponta: o botão que deve pulsar enquanto o passo está pendente. */
/** `chat` leva à conversa do meu-bot (passo que se conclui vendo algo no rodapé). */
export type GuideTarget = "wa-line" | "wa-agent" | "wa-pair" | "wa-policy" | "chat" | "none";

/** O que a pessoa marcou à mão (o app não tem como ver uma mensagem de teste chegar). */
export interface GuideFlags { policyChosen: boolean; tested: boolean; statusTested: boolean; claudeSeen: boolean; grokReplied: boolean; fallbackChosen: boolean; fallbackSeen: boolean; guardaSeen: boolean; navAgentUsed: boolean; crmSeen: boolean; crmImportSeen: boolean; claudeReplied: boolean; gruposTested: boolean; githubPulado: boolean; cloudflareLogado: boolean; financeFotoPulada: boolean; contasOrdemVista: boolean; contasTrocaVista: boolean; linkNomeVisto: boolean; quickUsado: boolean; digitandoVisto: boolean; gmailLido: boolean; gmailBuscou: boolean; gmailLixeira: boolean; /** Passos `lembrar` já vistos concluídos (fato que não se desfaz: abas fechadas não reabrem o tutorial). */ feitos?: string[]; number: string | null }
export const emptyFlags = (): GuideFlags => ({ policyChosen: false, tested: false, statusTested: false, claudeSeen: false, grokReplied: false, fallbackChosen: false, fallbackSeen: false, guardaSeen: false, navAgentUsed: false, crmSeen: false, crmImportSeen: false, claudeReplied: false, gruposTested: false, githubPulado: false, cloudflareLogado: false, financeFotoPulada: false, contasOrdemVista: false, contasTrocaVista: false, linkNomeVisto: false, quickUsado: false, digitandoVisto: false, gmailLido: false, gmailBuscou: false, gmailLixeira: false, number: null });
/**
 * Marcações que um passo pode pedir ("Testei, funcionou") ou que o app grava sozinho (`grokReplied`: resposta com
 * X-Provider grok-4; `fallbackChosen`: a pessoa escolheu o primário; `fallbackSeen`: uma resposta veio da reserva).
 */
export type GuideFlagName = "policyChosen" | "tested" | "statusTested" | "claudeSeen" | "grokReplied" | "fallbackChosen" | "fallbackSeen" | "guardaSeen" | "navAgentUsed" | "crmSeen" | "crmImportSeen" | "claudeReplied" | "gruposTested" | "githubPulado" | "cloudflareLogado" | "financeFotoPulada" | "contasOrdemVista" | "contasTrocaVista" | "linkNomeVisto" | "quickUsado" | "digitandoVisto" | "gmailLido" | "gmailBuscou" | "gmailLixeira";

export interface GuideStep {
  id: string;
  title: string;
  /** Instrução curta de uma ação. */
  text: string;
  target: GuideTarget;
  /** Corpo especial do passo no guia: cartões de quem responder, áudio, suporte ou a status line. */
  body?: "contas-claude" | "agent-choice" | "reply-choice" | "support-name" | "support-switch" | "support-delivery" | "statusline-install" | "statusline-segments" | "statusline-test" | "claude-login" | "xai-prepare" | "xai-login" | "fallback-order" | "objective-choice" | "objective-level" | "objective-skill" | "guarda-install" | "digitando-escolher" | "navegador-pro" | "navegador-install" | "navegador-open" | "crm-pro" | "crm-install" | "crm-config" | "crm-test" | "crm-gmail" | "crm-importar" | "grupos-escolher" | "grupos-quem" | "grupos-modo" | "grupos-teste" | "crm-pipeline" | "cloudflare-entrar" | "conta-cloudflare" | "conta-github" | "finance-install" | "finance-contas" | "finance-renda" | "finance-testar" | "finance-foto" | "finance-pendencias" | "link-publico-ver" | "link-publico-testar" | "link-publico-nome" | "quick-atalho" | "quick-testar" | "gmail-pro" | "gmail-conectar" | "gmail-ler" | "gmail-buscar" | "gmail-lixeira";
  /** Concluído pelo estado real; `null` de status = ainda não consultado. */
  done: (status: WhatsappStatus | null, flags: GuideFlags, ctx: GuideContext) => boolean;
  /** Passo que a pessoa conclui com um botão no próprio cartão ("Testei, funcionou"). */
  manual?: { label: string; flag: GuideFlagName };
  /**
   * Fato que não se desfaz ("abriu um site", "viu os limites"): concluído uma vez, fica concluído (flags.feitos). Sem
   * isso, o estado de agora (abas abertas, resposta recente) faz o tutorial ir e voltar enquanto a janela carrega.
   */
  lembrar?: true;
  /**
   * Concluído, ainda dá para refazer: um "Refazer" ao lado de "concluído" reabre o corpo do passo para remarcar a opção
   * (clicou no grupo errado), sem recomeçar o tutorial; os passos seguintes continuam como estão.
   */
  refazer?: true;
  /** Concluído, a linha mostra o resultado ("Grupo: status") em vez de só "concluído"; null = sem resumo. */
  resumo?: (ctx: GuideContext, status: WhatsappStatus | null) => string | null;
}
/** O passo está concluído: pelo estado real ou, se for um fato `lembrar`, porque já foi visto concluído. */
export const passoFeito = (s: GuideStep, status: WhatsappStatus | null, flags: GuideFlags, ctx: GuideContext): boolean =>
  s.done(status, flags, ctx) || (s.lembrar === true && (flags.feitos ?? []).includes(s.id));

export interface Tutorial {
  /** Identificador estável (kebab-case). */
  id: string;
  /**
   * Número fixo do tutorial (o mesmo no app da pessoa, no admin e no GUIA), na ordem da trilha: o array é a ordem da
   * lista, então os números sobem 1, 2, 3… sem buraco entre os que podem aparecer; os `oculto` ficam no fim (17, 18).
   * Renumerados em 31 out e em 3 nov 2026 (mapas antigo → novo em docs/guia/app.md).
   */
  number: number;
  title: string;
  /** Nome curto para a aba do guia ("WhatsApp"). */
  short: string;
  /** Uma frase: o que a pessoa vai conseguir fazer. */
  summary: string;
  /** Tempo estimado, em minutos. */
  minutes: number;
  /** Selo em caixa alta antes dos passos ("Comece por aqui", "Próximo"); opcional. */
  badge?: string;
  /** Ícone do cartão. */
  icon?: "target" | "chat";
  /** Ainda não existe: o cartão aparece com "Em breve" e não abre guia. */
  comingSoon?: boolean;
  /** Fora da lista de Tutoriais (e do selo) por decisão de produto; o código do guia continua. */
  oculto?: true;
  /** Só aparece quando o meu-bot veio com o pacote de suporte (e a janela é de máquina por SSH). */
  needsSupport?: true;
  /** Só aparece onde o Grok é possível (máquina por SSH com o backend do meu-bot); some neste Mac. */
  needsXai?: true;
  /** Só quando o CRM pelo Streak é o caminho (plano gratuito, ou motor Streak escolhido). */
  needsCrmStreak?: true;
  /** Só quando o CRM próprio no Gmail está liberado pela licença (plano Pro) e é o motor em uso. */
  needsCrmProprio?: true;
  /** Só quando a licença da máquina libera o financeiro (add-on meu-bot-finance). */
  needsFinance?: true;
  /** Só numa conta que pode ter link público (some na janela do root: o link é das contas de usuário). */
  needsLinkPublico?: true;
  /** Só onde o agente da máquina aceita a guarda (capacidade `guarda`); some numa máquina com outro agente. */
  needsGuarda?: true;
  /** Só onde o agente aceita ligar/desligar o "digitando…" (capacidade `digitando`); some no PicoClaw, que não mostra. */
  needsDigitando?: true;
  /** Trilha em ordem: só aparece depois que este tutorial (id) foi concluído. */
  after?: string;
  /** Fontes do contexto que os passos consultam; enquanto alguma não chegou, o tutorial está "verificando". */
  needs: readonly GuideSource[];
  /** "Refazer do zero" (tutorial concluído): o que é desfeito na máquina antes de voltar ao passo 1. */
  reset?: { what: string };
  steps: GuideStep[];
}

/** "Agente: OpenClaw" / "Agente: Hermes" do passo 1 do tutorial 3 concluído; null = ainda não se sabe. */
export function agenteResumo(st: WhatsappStatus | null): string | null {
  const a = st?.escolha ?? (st?.present === true && (st.gateway === "openclaw" || st.gateway === "hermes") ? st.gateway : null);
  return a === null || a === undefined ? null : `Agente: ${a === "openclaw" ? "OpenClaw" : "Hermes"}`;
}
const WHATSAPP_STEPS: GuideStep[] = [
  {
    id: "escolher", title: "Qual agente atende o seu WhatsApp?", target: "none", body: "agent-choice",
    text: "Os dois fazem tudo deste tutorial: responder e escolher quem. Os dois também entendem áudio: a transcrição liga sozinha depois de parear. Se não souber, fique com o recomendado.",
    // Escolhido, ou a máquina já tem um dos dois atendendo (dá para trocar depois, no WhatsApp).
    done: (st) => st !== null && (st.escolha != null || (st.present && (st.gateway === "openclaw" || st.gateway === "hermes"))),
    // Qual dos dois ficou: o escolhido, senão o que a máquina já tinha (a mesma regra de agenteAtual).
    resumo: (_c, st) => agenteResumo(st),
  },
  {
    id: "preparar", title: "Preparar o WhatsApp nesta máquina", target: "wa-agent",
    text: "O agente da máquina instala o que faltar para o WhatsApp. Abra o WhatsApp e clique em \"Pedir ao agente para preparar\".",
    done: (st) => st !== null && st.present && st.ready,
  },
  {
    id: "qr", title: "Conectar o número pelo QR", target: "wa-pair",
    text: "No celular do número: WhatsApp › Aparelhos conectados › Conectar aparelho › aponte para o QR. O app mostra o ✓ verde ao vincular.",
    done: (st) => st !== null && st.connected,
  },
  {
    id: "quem", title: "Quem o agente responde no WhatsApp?", target: "wa-policy", body: "reply-choice",
    text: "Vale assim que o WhatsApp é pareado. Seus contatos não recebem nenhuma mensagem automática enquanto as respostas estiverem desativadas.",
    done: (st, f) => f.policyChosen || (st !== null && st.dmPolicy === "open"),
    // "Pular" mantém o padrão (só você fala com o agente) e segue; dá para mudar depois na mesma aba.
    manual: { label: "Pular: deixar só eu por enquanto", flag: "policyChosen" },
  },
  {
    id: "teste", title: "Testar com uma mensagem", target: "none",
    text: "Com \"só eu\", mande para o seu próprio número (ou, se o dono é outro número, do celular do dono para o número do agente); com \"todo mundo\", mande de outro celular. Mande um texto: o agente deve responder sobre o que você escreveu.",
    done: (_st, f) => f.tested,
    manual: { label: "Testei, funcionou", flag: "tested" },
  },
];

/** A conta está logada na máquina (pelo último status lido). */
export const contaConectada = (c: GuideContext, id: ContaEstado["id"]): boolean => c.contas?.some((x) => x.id === id && x.conectado) === true;

/** Os tutoriais, na ordem em que aparecem (e dos números). */
export const TUTORIAIS: readonly Tutorial[] = [
  {
    id: "claude-login",
    number: 1,
    needs: ["claude"],
    title: "Entrar no Claude Code",
    short: "Claude",
    summary: "Confirma que esta máquina tem uma sessão do Claude: a sua conta ou o Claude Code Global do admin. Com o global, já vem concluído.",
    minutes: 2,
    icon: "chat",
    reset: { what: "sai da conta do Claude Code nesta máquina (o agente para de responder até entrar de novo)" },
    steps: [
      {
        id: "entrar", title: "Entrar na conta do Claude", target: "none", body: "claude-login",
        text: "Clique em Entrar: o link de autorização abre no navegador, você entra na conta e cola aqui o código que a página mostra. Leva um minuto.",
        done: (_st, _f, c) => c.claude.loggedIn === true,
      },
      {
        id: "conferir", title: "Conferir quem está logado", target: "none",
        text: "Na lateral, a linha \"Claude Code\" passa a mostrar o e-mail da conta. É essa conta que paga as respostas do agente nesta máquina.",
        done: (_st, f, c) => c.claude.loggedIn === true && (c.claude.email !== null || f.claudeSeen),
        manual: { label: "Vi minha conta", flag: "claudeSeen" },
      },
      {
        id: "resposta", title: "Primeira resposta do agente", target: "chat",
        text: "Vá para a conversa e mande uma mensagem: a resposta vem da sua conta do Claude, nesta máquina.",
        // A primeira resposta é um fato que não se desfaz: fica lembrada na flag (apagar as conversas não reabre o
        // tutorial). "Não exibir" marca a mesma flag à mão, para quem não quer passar por aqui.
        // Com o global do admin a sessão já existe e responde: o tutorial 1 só confirma, sem pedir a primeira resposta.
        done: (_st, f, c) => c.claude.loggedIn === true && (c.claude.global || c.claude.firstReply || f.claudeReplied),
        manual: { label: "Não exibir", flag: "claudeReplied" },
      },
    ],
  },
  {
    // Desmembrado do tutorial 1 (27 out): entrar é obrigatório; contas extras e o rodízio são opcionais e têm outro momento
    // (a primeira vez que o limite bate). Vale para o app, o WhatsApp (porteiro do claude) e o Terminal.
    id: "contas-claude",
    number: 2,
    needs: ["claude"],
    after: "claude-login",
    title: "Mais contas do Claude",
    short: "Contas",
    summary: "Gerencie as suas contas e a ordem de preferência. Quando uma bate o limite, a próxima assume sozinha (no app, no WhatsApp e no Terminal); com o Claude Code Global do admin, as suas contas são a reserva dele.",
    minutes: 3,
    icon: "chat",
    steps: [
      {
        id: "adicionar", title: "Adicionar outra conta do Claude", target: "none", body: "contas-claude",
        text: "Clique em \"Adicionar conta\" e entre nela como no tutorial 1. Cada conta fica no próprio cantinho desta máquina; o histórico das conversas é um só, então a conversa continua de onde parou em qualquer uma.",
        done: (_st, _f, c) => c.claude.contasExtras > 0,
      },
      {
        id: "ordem", title: "Ordem de preferência", target: "none",
        text: "A primeira da lista atende; quando ela bate o limite, a próxima assume. O login desta máquina é a base: fica por último e volta quando o limite dele renova. Arraste para mudar a ordem.",
        done: (_st, f, c) => c.claude.contasExtras > 0 && f.contasOrdemVista,
        manual: { label: "Entendi a ordem", flag: "contasOrdemVista" },
      },
      {
        id: "troca", title: "Ver a troca acontecer", target: "none",
        text: "Nada a fazer agora. Na primeira vez que uma conta bater o limite, a próxima assume sem você mexer, e aqui aparece \"Últimas trocas\" dizendo onde foi (app, WhatsApp ou Terminal). Este passo se marca sozinho na primeira troca.",
        done: (_st, f, c) => c.claude.trocas > 0 || f.contasTrocaVista,
        manual: { label: "Entendi como funciona", flag: "contasTrocaVista" },
      },
    ],
  },
  {
    id: "whatsapp-openclaw",
    number: 3,
    needs: ["whatsapp"],
    title: "Conectar o WhatsApp ao agente",
    short: "WhatsApp",
    summary: "Escolha o agente, conecte um número, decida quem ele responde e teste de verdade.",
    minutes: 4,
    icon: "target",
    reset: { what: "desconecta o número desta máquina (o agente para de responder no WhatsApp) e esquece \"escolhi\" e \"testei\"" },
    steps: WHATSAPP_STEPS,
  },
  {
    id: "xai-login",
    number: 4,
    needs: ["xai"],
    after: "claude-login",
    needsXai: true,
    title: "Entrar na xAI (Grok)",
    short: "Grok",
    summary: "Com a conta da xAI logada nesta máquina, o modelo grok-4 responde e pode servir de reserva do Claude.",
    minutes: 3,
    icon: "chat",
    reset: { what: "sai da conta da xAI nesta máquina (o proxy fica) e esquece a resposta de teste" },
    steps: [
      {
        id: "preparar", title: "Preparar o Grok nesta máquina", target: "none", body: "xai-prepare",
        text: "O grok-4 responde por um proxy local desta conta, com a sua conta da xAI. O app instala o proxy e aponta o backend para ele; na primeira vez pode levar alguns minutos.",
        done: (_st, _f, c) => c.xai.pronto === true,
      },
      {
        id: "entrar", title: "Entrar na conta da xAI", target: "none", body: "xai-login",
        text: "Clique em Entrar: a página da xAI abre no navegador com um código já preenchido; você aprova por lá e volta. Aqui não há nada para colar.",
        done: (_st, _f, c) => c.xai.pronto === true && c.xai.loggedIn === true,
      },
      {
        id: "resposta", title: "Ver o grok-4 responder", target: "chat",
        text: "Vá para a conversa: ela muda para o modelo grok-4 e manda uma mensagem; a resposta vem da xAI, e a pill do túnel mostra \"respondeu grok-4\".",
        done: (_st, f, c) => c.xai.loggedIn === true && f.grokReplied,
      },
    ],
  },
  {
    id: "fallback-contas",
    number: 5,
    needs: ["claude", "xai", "fallback"],
    after: "xai-login",
    needsXai: true,
    title: "Fallback: Claude e Grok",
    short: "Fallback",
    summary: "Com as duas contas logadas nesta máquina, se uma falhar a outra responde. Escolha quem é o primário e quem é a reserva.",
    minutes: 2,
    icon: "chat",
    reset: { what: "esquece a escolha do primário e a reserva vista (as contas continuam logadas; o modelo padrão não muda)" },
    steps: [
      {
        id: "contas", title: "As duas contas nesta máquina", target: "none",
        text: "O fallback precisa das duas contas logadas nesta máquina: Claude (tutorial 1) e xAI (tutorial 4). Se uma falhar antes de responder, a outra assume sem você fazer nada.",
        done: (_st, _f, c) => c.claude.loggedIn === true && c.xai.loggedIn === true,
      },
      {
        id: "ordem", title: "Escolher primário e reserva", target: "none", body: "fallback-order",
        text: "O primário responde sempre e gasta o orçamento da conta dele. A reserva só entra se o primário falhar antes de começar a responder, e não gasta nada até lá. Escolha quem é o primário; a reserva é quem sobrar.",
        done: (_st, f, c) => f.fallbackChosen && c.fallback.primary !== null && FALLBACK_PRIMARIES.includes(c.fallback.primary),
      },
      {
        id: "reserva", title: "Ver a reserva assumir", target: "none",
        text: "Nada a fazer agora. Na primeira vez que o primário falhar antes de responder, a conversa recebe um aviso amarelo e a resposta vem da reserva, com \"fallback\" no pé da mensagem. Este passo se marca sozinho quando isso acontecer; se preferir, marque que entendeu.",
        done: (_st, f) => f.fallbackSeen,
        manual: { label: "Entendi como funciona", flag: "fallbackSeen" },
      },
    ],
  },
  {
    id: "suporte",
    number: 6,
    needs: ["support"],
    title: "Ligar o suporte",
    short: "Suporte",
    summary: "Deixe o admin do seu meu-bot ver a sua máquina e te ajudar. Você escolhe o que ele vê e acompanha tudo o que ele fizer; só o admin desliga.",
    minutes: 1,
    icon: "target",
    needsSupport: true,
    steps: [
      {
        id: "nome", title: "Dizer seu nome", target: "none", body: "support-name",
        text: "Como você prefere ser chamado. Ao salvar, o admin passa a poder entrar nesta máquina para ver a saúde, o WhatsApp e os registros, e fazer ajustes de suporte. Tudo o que ele fizer aparece no passo seguinte.",
        done: (_st, _f, c) => (c.support?.name ?? "") !== "" && c.support?.on === true,
      },
      {
        id: "entrega", title: "O que o admin recebe", target: "none", body: "support-delivery",
        text: "A sua máquina avisa o admin sozinha, sem você precisar mandar nada; este passo se marca quando o aviso chegar. Abaixo, tudo o que o suporte fez aqui.",
        done: (_st, _f, c) => c.support?.on === true && (c.support.deliveredAt ?? null) !== null,
      },
    ],
  },
  {
    id: "whatsapp-objetivo",
    number: 7,
    needs: ["objective"],
    title: "O que você quer resolver pelo WhatsApp?",
    short: "Objetivo",
    summary: "Escolha um objetivo, diga quanta liberdade o agente tem e salve como skill no Acervo: o agente passa a trabalhar em cima disso.",
    minutes: 2,
    icon: "chat",
    reset: { what: "apaga a skill do objetivo no workspace do agente e devolve a liberdade total ao dono (os outros contatos continuam sem ferramentas)" },
    steps: [
      {
        id: "objetivo", title: "Escolher o objetivo", target: "none", body: "objective-choice",
        text: "O que o agente resolve pelo WhatsApp. Escolha um cartão e, se quiser, complete em uma frase (em \"Outro\" a frase é obrigatória). Fica gravado na máquina.",
        done: (_st, _f, c) => c.objective?.objective !== null && c.objective?.objective !== undefined,
      },
      {
        id: "liberdade", title: "Dizer quanta liberdade o agente tem", target: "none", body: "objective-level",
        text: "Até onde o agente vai sozinho. Vale para você, o dono do número; os outros contatos nunca têm ferramentas que mudem a máquina.",
        done: (_st, _f, c) => c.objective?.level !== null && c.objective?.level !== undefined,
      },
      {
        id: "skill", title: "Salvar como skill no Acervo", target: "none", body: "objective-skill",
        text: "Grava uma skill de verdade no workspace do agente (o OpenClaw carrega sozinho) e ajusta as ferramentas ao nível escolhido. Ela aparece no Acervo; salvar de novo substitui.",
        done: (_st, _f, c) => c.objective?.savedAt !== null && c.objective?.savedAt !== undefined && c.objective.skillPresent,
      },
    ],
  },
  {
    id: "guarda-whatsapp",
    number: 8,
    needs: ["guarda"],
    needsGuarda: true,
    after: "whatsapp-openclaw",
    title: "Guarda do WhatsApp",
    short: "Guarda",
    summary: "Um plugin no agente desta máquina: avisos técnicos do agente nunca vão ao contato, e uma conversa bot-com-bot que entra em loop é pausada sozinha.",
    minutes: 2,
    icon: "target",
    reset: { what: "tira a guarda do agente desta máquina (ele volta a entregar tudo e nada é pausado sozinho)" },
    steps: [
      {
        id: "ativar", title: "Ativar a guarda nesta máquina", target: "none", body: "guarda-install",
        text: "Ela já vem ligada: toda máquina cujo agente aceita a guarda a recebe sozinha quando o app a encontra. É um plugin pequeno do meu-bot dentro do agente, roda 24 horas mesmo com o app fechado; se por algum motivo não estiver aqui, o botão instala.",
        done: (_st, _f, c) => c.guarda.installed === true,
      },
      {
        id: "entender", title: "O que ela faz por você", target: "none",
        text: "1) Linhas técnicas como \"↪️ Model Fallback: …\" (o agente trocou de modelo) não são entregues ao contato. 2) Se outro bot ficar trocando despedidas com o seu agente (\"Até mais!\" → \"Até.\" → …) por 3 ciclos em poucos minutos, a conversa é pausada sozinha: a resposta não sai, o contato aparece como \"pausado\" na lista do WhatsApp e o agente recebe uma nota explicando. Para voltar, é o menu \"…\" do contato › Retomar. Pessoas de verdade não são afetadas: a regra exige mensagens curtas, quase iguais ou de despedida, em menos de 3 minutos entre uma e outra.",
        done: (_st, f) => f.guardaSeen,
        manual: { label: "Entendi", flag: "guardaSeen" },
      },
    ],
  },
  {
    id: "navegador",
    number: 9,
    needs: ["navegador"],
    after: "claude-login",
    title: "Navegador do agente (Pro)",
    short: "Navegador",
    summary: "Um navegador dentro do meu-bot, com abas e cookies desta máquina. O agente da conversa pode abrir, ler e clicar por você, avisando antes.",
    reset: { what: "esquece \"o agente navegou\" nesta máquina (o plano, a instalação e as abas continuam)" },
    minutes: 4,
    icon: "chat",
    steps: [
      {
        id: "pro", title: "Ter o plano Pro nesta máquina", target: "none", body: "navegador-pro",
        text: "O Navegador é do plano Pro. Se a sua máquina ainda é free, peça ao admin por aqui: ele libera e o tutorial continua sozinho.",
        done: (_st, _f, c) => c.navegador.access === "ok",
      },
      {
        id: "instalar", title: "Preparar a máquina para o agente", target: "none", body: "navegador-install",
        text: "Um arquivo pequeno na máquina apresenta as ações do navegador ao agente (abrir, ler, clicar, digitar…) e grava a regra de conduta: ele avisa antes de agir e nunca compra, paga ou envia nada sem você confirmar.",
        // O agente já usou o Navegador com sucesso: a máquina está preparada (sem esperar a consulta por SSH).
        done: (_st, f, c) => c.navegador.access === "ok" && (c.navegador.installed === true || f.navAgentUsed),
      },
      {
        id: "abrir", title: "Abrir o Navegador e entrar num site", target: "none", body: "navegador-open", lembrar: true,
        text: "Abra a aba Navegador, digite um endereço e navegue. Cookies e logins ficam guardados só nesta máquina; \"abrir no Mac\" leva a página para o seu navegador de sempre. ☆ guarda a página na barra de favoritos (Cmd+Shift+F mostra ou esconde a barra); o agente também pode favoritar um link para você.",
        // Idem: o agente abriu um site, então há aba (antes o tutorial esperava a contagem de abas e só concluía depois).
        done: (_st, f, c) => c.navegador.access === "ok" && (c.navegador.tabs > 0 || f.navAgentUsed),
      },
      {
        id: "agente", title: "Deixar o agente navegar", target: "chat",
        text: "Na barra do Navegador, clique no 🤖 para ligar (ele acende quando o agente pode usar). Depois vá para a conversa e peça algo como \"abra o site google.com e me diga o título\": cada ação aparece na conversa com 🌐.",
        done: (_st, f, c) => c.navegador.access === "ok" && f.navAgentUsed,
      },
    ],
  },
  {
    id: "whatsapp-grupos",
    number: 10,
    needs: ["grupos"],
    after: "whatsapp-openclaw",
    title: "O agente nos grupos do WhatsApp",
    short: "Grupos",
    summary: "Ligue o agente num grupo interno sem virar bagunça: só quem você escolher conversa com ele, e ele responde só quando for chamado.",
    minutes: 3,
    icon: "chat",
    steps: [
      {
        id: "grupo", title: "Escolher o grupo", target: "none", body: "grupos-escolher", refazer: true,
        resumo: (c) => { const g = grupoAlvo(c.grupos.info, c.grupos.alvo); return g === null ? null : `Grupo: ${nomeDoGrupo(g)}`; },
        text: "Escolha um grupo interno (só gente de casa) em que o número do agente está.",
        done: (_st, _f, c) => grupoAlvo(c.grupos.info, c.grupos.alvo) !== null,
      },
      {
        id: "quem", title: "Quem pode conversar com o agente no grupo", target: "none", body: "grupos-quem", refazer: true,
        resumo: (c) => quemResumo(c.grupos.info),
        text: "Comece só por você: o número pessoal que você usa no grupo. Acrescente quem mais de casa pode chamar o agente.",
        done: (_st, _f, c) => grupoAlvo(c.grupos.info, c.grupos.alvo) !== null && quemEscolhido(c.grupos.info),
      },
      {
        id: "modo", title: "Como ele responde", target: "none", body: "grupos-modo", refazer: true,
        resumo: (c) => { const g = grupoAlvo(c.grupos.info, c.grupos.alvo); return g === null || g.agente === "desligado" ? null : g.agente === "sempre" ? "Responde sempre que tiver algo útil" : "Responde só quando chamado"; },
        text: "Ligue o agente neste grupo. Ele responde só quando alguém da lista o chama.",
        done: (_st, _f, c) => (grupoAlvo(c.grupos.info, c.grupos.alvo)?.agente ?? "desligado") !== "desligado",
      },
      {
        id: "teste", title: "Testar no grupo", target: "none", body: "grupos-teste", lembrar: true,
        text: "No grupo, mencione o número do agente: \"@agente oi\". O passo se marca sozinho quando ele responder.",
        done: (_st, f, c) => c.grupos.respondeu || f.gruposTested,
        manual: { label: "Testei, funcionou", flag: "gruposTested" },
      },
    ],
  },
  {
    id: "contas-cli",
    number: 11,
    needs: ["contas"],
    after: "claude-login",
    needsXai: true,
    title: "Conectar contas na máquina",
    short: "Contas",
    summary: "Um clique e a conta fica ligada na máquina: o agente passa a subir sites no Cloudflare e mexer no GitHub por você, sem terminal.",
    minutes: 2,
    icon: "target",
    steps: [
      {
        // A autorização do wrangler só completa com a pessoa logada no Cloudflare (27 out): entrar vem antes.
        id: "cloudflare-entrar", title: "Entrar no Cloudflare", target: "none", body: "cloudflare-entrar",
        text: "Antes de conectar, entre na sua conta do Cloudflare aqui no Navegador (se não tem, crie uma: é grátis). Sem estar logado, a autorização do próximo passo não termina.",
        done: (_st, f, c) => contaConectada(c, "cloudflare") || f.cloudflareLogado,
        manual: { label: "Já entrei", flag: "cloudflareLogado" },
      },
      {
        id: "cloudflare", title: "Conectar o Cloudflare (subir sites)", target: "none", body: "conta-cloudflare",
        text: "Clique em Conectar: a página do Cloudflare abre aqui no Navegador, você entra e autoriza. O acesso é só para sites (Pages) e ver os domínios; nada de e-mail, bancos ou o resto da conta.",
        done: (_st, _f, c) => contaConectada(c, "cloudflare"),
      },
      {
        id: "github", title: "Conectar o GitHub (opcional)", target: "none", body: "conta-github",
        text: "Clique em Conectar: a página do GitHub abre no Navegador e pede um código de 8 letras, que aparece aqui com o botão de copiar. Se você não usa GitHub, pule.",
        done: (_st, f, c) => contaConectada(c, "github") || f.githubPulado,
        manual: { label: "Não uso GitHub", flag: "githubPulado" },
      },
    ],
  },
  {
    id: "financeiro",
    number: 12,
    needs: ["finance"],
    after: "claude-login",
    needsFinance: true,
    title: "Seu financeiro no WhatsApp",
    short: "Financeiro",
    summary: "O agente vira o seu financeiro: você conta o gasto (ou manda a foto do comprovante) e ele lança, categoriza e só pede o que depende de você.",
    minutes: 5,
    icon: "target",
    steps: [
      {
        id: "ativar", title: "Ativar o financeiro nesta máquina", target: "none", body: "finance-install",
        text: "Instala na máquina a ferramenta do agente e o financeiro do WhatsApp. Seus números ficam só nela.",
        done: (_st, _f, c) => c.finance.info?.modulo === true,
      },
      {
        id: "contas", title: "Cadastrar suas contas", target: "none", body: "finance-contas",
        text: "Diga quais contas você usa: o banco, o cartão de crédito e o dinheiro vivo. O agente lança em cada uma pelo jeito de pagar (\"no crédito\", \"em dinheiro\").",
        done: (_st, _f, c) => (c.finance.info?.estado?.contas.length ?? 0) > 0,
      },
      {
        id: "orcamento", title: "Dizer quanto quer gastar no mês", target: "none", body: "finance-renda",
        text: "Só você decide o orçamento: quanto quer gastar no mês. O agente acompanha os gastos contra ele e avisa aos 80% e se estourar. No mês seguinte ele continua o mesmo até você mudar.",
        done: (_st, _f, c) => c.finance.info?.estado?.orcamentoDefinido === true, lembrar: true,
      },
      {
        id: "primeiro", title: "Lançar o primeiro gasto pelo agente", target: "none", body: "finance-testar",
        text: "Mande no WhatsApp, para você mesmo, ou aqui no chat: \"gastei 48 no mercado\". O agente lança, categoriza e responde.",
        done: (_st, _f, c) => { const o = c.finance.info?.estado?.porOrigem ?? {}; return (o.whatsapp ?? 0) + (o.agente ?? 0) + (o.chat ?? 0) + (o.foto ?? 0) > 0; }, lembrar: true,
      },
      {
        id: "foto", title: "Mandar a foto de um comprovante", target: "none", body: "finance-foto",
        text: "Tire foto de uma nota ou comprovante e mande para o agente no WhatsApp. Ele lê o valor, a data e o lugar e deixa para você confirmar.",
        done: (_st, f, c) => (c.finance.info?.estado?.porOrigem.foto ?? 0) > 0 || f.financeFotoPulada, lembrar: true,
        manual: { label: "Pular por agora", flag: "financeFotoPulada" },
      },
      {
        id: "pendencias", title: "Confirmar o que ficou pendente", target: "none", body: "finance-pendencias",
        text: "Quando o agente fica na dúvida (categoria nova, foto, possível repetição), o lançamento espera você. Confirme na página Finanças: ele aprende e da próxima vez acerta sozinho.",
        done: (_st, _f, c) => { const e = c.finance.info?.estado; return e !== undefined && e !== null && e.pendencias === 0 && e.totalLancamentos > 0; },
      },
    ],
  },
  {
    id: "link-publico",
    number: 13,
    needs: ["linkpublico"],
    after: "claude-login",
    needsXai: true,
    needsLinkPublico: true,
    title: "Seu link público",
    short: "Link público",
    summary: "Um endereço só seu na internet (https://<nome>.agentesgrok.com/): peça ao agente o link de qualquer arquivo ou página e mande para quem quiser.",
    minutes: 2,
    icon: "target",
    steps: [
      {
        id: "ligado", title: "Ver o seu link", target: "none", body: "link-publico-ver",
        text: "O admin liga o seu link no meu-bot-admin (Link Público Global). Quando estiver ligado, o endereço aparece aqui e o agente passa a saber publicar.",
        done: (_st, _f, c) => c.linkPublico !== null,
      },
      {
        id: "publicar", title: "Colocar algo no ar", target: "none", body: "link-publico-testar",
        text: "Escolha um arquivo deste Mac e ele vai para o ar no seu link (um .md vira uma página pronta). Ou peça no chat: \"me dá um link público deste arquivo\". Aqui aparece tudo o que está no ar, para abrir ou tirar. Tudo ali é público na internet.",
        done: (_st, _f, c) => c.linkPublico !== null && c.linkPublico.arquivos > 0,
        lembrar: true,
        refazer: true,
      },
      {
        id: "nome", title: "Escolher o nome do link", target: "none", body: "link-publico-nome",
        text: "O link nasce com o seu nome de login (box-2.agentesgrok.com). Troque por um nome seu, como daniel.agentesgrok.com, ou deixe como está. Os links já mandados com o nome antigo param de abrir.",
        done: (_st, f, c) => f.linkNomeVisto || (c.linkPublico !== null && c.linkPublico.nome !== c.linkPublico.usuario),
        manual: { label: "Deixar como está", flag: "linkNomeVisto" },
        refazer: true,
      },
    ],
  },
  {
    // Saiu das Configurações (30 out): a janela flutuante é sempre ativa; aqui a pessoa escolhe o atalho e experimenta.
    id: "entrada-rapida",
    number: 14,
    needs: ["quickentry"],
    after: "claude-login",
    title: "Entrada rápida",
    short: "Entrada rápida",
    summary: "Pressione um atalho em qualquer app e mande uma mensagem ao agente sem procurar a janela do meu-bot. Está sempre ligada; aqui você escolhe o atalho.",
    minutes: 1,
    icon: "chat",
    steps: [
      {
        id: "atalho", title: "Escolher o atalho", target: "none", body: "quick-atalho",
        text: "Clique no campo e pressione a combinação desejada (ex.: Cmd+Shift+Espaço). Backspace limpa. Se outro app já usa a combinação, o status mostra \"em uso\": escolha outra.",
        done: (_st, _f, c) => c.quickEntry.status === "registered",
      },
      {
        id: "usar", title: "Mandar uma mensagem pela janela flutuante", target: "none", body: "quick-testar",
        text: "Com o meu-bot em segundo plano, pressione o atalho: uma janelinha aparece por cima de tudo. Digite uma mensagem e Enter: ela vai para a conversa ativa e o meu-bot volta para a frente.",
        done: (_st, f) => f.quickUsado,
        lembrar: true,
        manual: { label: "Funcionou", flag: "quickUsado" },
      },
    ],
  },
  {
    id: "gmail",
    number: 15,
    needs: ["google"],
    after: "claude-login",
    title: "Gmail (Pro)",
    short: "Gmail",
    summary: "Leia, busque e mande para a lixeira os e-mails da Conta Google desta máquina, dentro do meu-bot. O que vai para a lixeira volta com um clique.",
    minutes: 4,
    icon: "target",
    steps: [
      {
        id: "pro", title: "Ter o plano Pro nesta máquina", target: "none", body: "gmail-pro",
        text: "O Gmail é do plano Pro. Se a sua máquina ainda é free, peça ao admin por aqui: ele libera e o tutorial continua sozinho.",
        done: (_st, _f, c) => c.gmail.access === "ok",
      },
      {
        id: "conectar", title: "Conectar a Conta Google", target: "none", body: "gmail-conectar",
        text: "O Gmail usa a conta conectada na página Conta Google. Entre lá uma vez; a conta fica nesta máquina e a página Gmail passa a abrir a caixa de entrada.",
        done: (_st, _f, c) => c.gmail.conectado,
      },
      {
        id: "ler", title: "Abrir o Gmail e ler uma mensagem", target: "none", body: "gmail-ler", lembrar: true,
        text: "Abra a página Gmail e clique numa mensagem: o texto aparece aqui dentro, com os anexos pelo nome e um botão para abrir no Gmail.",
        done: (_st, f, c) => c.gmail.lido || f.gmailLido,
        manual: { label: "Li uma mensagem", flag: "gmailLido" },
      },
      {
        id: "buscar", title: "Buscar como no Gmail", target: "none", body: "gmail-buscar", lembrar: true,
        text: "Na caixa de busca vale a sintaxe do próprio Gmail: from:ana is:unread has:attachment. Faça uma busca qualquer.",
        done: (_st, f, c) => c.gmail.buscou || f.gmailBuscou,
        manual: { label: "Fiz uma busca", flag: "gmailBuscou" },
      },
      {
        id: "lixeira", title: "Mandar para a lixeira e desfazer", target: "none", body: "gmail-lixeira", lembrar: true,
        text: "Abra uma mensagem, clique em \"Mover para a lixeira\" (duas vezes, para confirmar) e depois em \"Desfazer\". Nada se perde: a lixeira guarda por 30 dias.",
        done: (_st, f, c) => (c.gmail.lixeira && c.gmail.desfez) || f.gmailLixeira,
        manual: { label: "Testei, funcionou", flag: "gmailLixeira" },
      },
    ],
  },
  {
    // O "digitando…" é do próprio gateway (OpenClaw: `agents.defaults.typingMode`, sem reiniciar; Hermes:
    // `platforms.whatsapp.typing_indicator`, com reinício); vazio = a
    // regra automática do motor, que a pessoa não vê. O tutorial pede uma escolha explícita: mostrar sempre ou nunca.
    id: "digitando-whatsapp",
    number: 16,
    needs: ["whatsapp"],
    after: "whatsapp-openclaw",
    needsDigitando: true,
    title: "Digitando… no WhatsApp",
    short: "Digitando",
    summary: "Quem conversa com o agente vê \"digitando…\" enquanto ele prepara a resposta, como numa conversa com uma pessoa. Você escolhe se mostra ou não; vale no privado e nos grupos.",
    minutes: 1,
    icon: "chat",
    steps: [
      {
        id: "escolher", title: "Mostrar ou não o \"digitando…\"", target: "none", body: "digitando-escolher", refazer: true,
        text: "Escolha um dos cartões. Aplica na hora e dá para trocar quando quiser.",
        done: (st) => st !== null && st.connected && (st.typingMode === "instant" || st.typingMode === "never"),
      },
      {
        id: "teste", title: "Conferir no celular", target: "none",
        text: "Mande uma mensagem para o agente e olhe o topo da conversa enquanto ele responde: com \"Mostrar\", aparece \"digitando…\" até a resposta chegar; com \"Não mostrar\", nada aparece.",
        done: (_st, f) => f.digitandoVisto,
        manual: { label: "Conferi no celular", flag: "digitandoVisto" },
      },
    ],
  },
  {
    id: "statusline",
    number: 17,
    needs: ["statusline"],
    after: "claude-login",
    title: "Status line do Claude",
    short: "Status line",
    summary: "Veja no rodapé de cada conversa quanto da sua sessão e da sua semana do Claude você já usou, e escolha o que aparece.",
    minutes: 3,
    icon: "target",
    // Fora da lista (30 out): o admin instala a status line ao criar a conta (prepararUsuario), sem passo para a pessoa.
    oculto: true,
    reset: { what: "desinstala a status line desta máquina (o settings.json anterior volta) e apaga a escolha de segmentos" },
    steps: [
      {
        id: "instalar", title: "Instalar a status line nesta máquina", target: "none", body: "statusline-install",
        text: "É um pequeno script do Claude Code que anota os seus limites de uso. O meu-bot lê essa anotação e mostra no rodapé.",
        done: (_st, _f, c) => c.statusLine.installed === true,
      },
      {
        id: "segmentos", title: "Escolher o que aparece", target: "none", body: "statusline-segments",
        text: "Ligue e desligue cada parte da barra: modelo, contexto, conta, sessão (5 horas) e semanal (7 dias). Vale na barra do Claude Code no terminal desta máquina e no rodapé do meu-bot, ao mesmo tempo.",
        done: (_st, _f, c) => c.statusLine.installed === true && c.statusLine.segments !== null,
      },
      {
        id: "conferir", title: "Conferir no terminal", target: "none", body: "statusline-test",
        text: "O botão abre um terminal desta máquina e roda um teste do script com um JSON de exemplo; a linha aparece com as cores. Avisos de \"/dev/tty\" nesse teste são normais fora do Claude Code.",
        done: (_st, f) => f.statusTested,
        manual: { label: "Apareceu certo", flag: "statusTested" },
      },
      {
        id: "limites", title: "Ver os limites na conversa", target: "chat", lembrar: true,
        text: "Vá para a conversa e mande uma mensagem ao agente: quando a resposta chegar, o rodapé dela mostra Sessão e Semanal, os limites da sua conta do Claude nesta máquina.",
        done: (_st, _f, c) => c.statusLine.installed === true && c.statusLine.limits,
      },
    ],
  },
  {
    id: "crm-gmail",
    number: 18,
    needs: ["crm", "navegador"],
    after: "navegador",
    needsCrmProprio: true,
    // 27 out: fora da lista; o cartão ficava parado em "verificando a máquina…" para quem nem conhece o CRM.
    oculto: true,
    title: "CRM no Gmail e no WhatsApp",
    short: "CRM",
    summary: "O CRM do meu-bot mora na sua máquina e aparece dentro do Gmail: pipelines, caixas e conversas. O agente anota pelo WhatsApp e pela conversa; sem Streak, sem chave de API.",
    minutes: 5,
    icon: "chat",
    steps: [
      {
        id: "instalar", title: "Instalar o CRM na máquina", target: "none", body: "crm-install",
        text: "Entra um plugin no OpenClaw da máquina (vê as conversas do WhatsApp e percebe o silêncio) e a ferramenta que o agente usa para anotar. Os dados ficam só na sua máquina; funciona com o app fechado.",
        done: (_st, _f, c) => c.crm.access === "ok" && c.crm.info?.installed === true,
      },
      {
        id: "gmail", title: "Abrir o Gmail web no Navegador (com a barra do CRM)", target: "none", body: "crm-gmail", lembrar: true,
        text: "Abra o Navegador: o Gmail abre com a barra do CRM (entre na sua conta do Google, se ainda não entrou). Numa conversa, o painel \"CRM\" à direita mostra em que caixa ela está ou deixa adicionar a um pipeline; o botão \"CRM\" na lista abre o pipeline inteiro.",
        done: (_st, _f, c) => c.navegador.extensaoEmbutida && c.navegador.tabs > 0,
      },
      {
        id: "pipeline", title: "Criar o primeiro pipeline", target: "none", body: "crm-pipeline",
        text: "O CRM anota cada conversa do WhatsApp numa caixa de um pipeline (as etapas da sua operação de mídia paga). Sem pipeline, nada é anotado. Escolha um modelo, ajuste o nome e as etapas e crie: ele vira o pipeline do WhatsApp.",
        done: (_st, _f, c) => (c.crm.local?.padrao ?? null) !== null,
      },
      {
        id: "importar", title: "Trazer os dados do Streak (opcional)", target: "none", body: "crm-importar",
        text: "Tem pipelines no Streak? Peça ao agente: \"importa do Streak o pipeline X\" com a sua chave da API do Streak. É só uma vez, as chaves e os boxes são preservados, e a chave não fica gravada.",
        done: (_st, f) => f.crmImportSeen,
        manual: { label: "Importei (ou não preciso)", flag: "crmImportSeen" },
      },
      {
        id: "testar", title: "Testar pelo seu WhatsApp", target: "none", body: "crm-test",
        text: "No WhatsApp, abra a conversa com você mesmo e mande: \"anota no CRM: <nome do contato> <o que aconteceu>\". Em até um minuto chega a confirmação 📇; a mudança aparece no Gmail em segundos.",
        done: (_st, f) => f.crmSeen,
        manual: { label: "Recebi a confirmação", flag: "crmSeen" },
      },
    ],
  },
  {
    id: "crm-whatsapp",
    number: 18,
    needs: ["crm"],
    after: "navegador",
    needsCrmStreak: true,
    // 27 out: fora da lista, como o CRM no Gmail; aparecia (e sumia) assim que o 10 (Navegador) contava como concluído.
    oculto: true,
    title: "CRM pelo WhatsApp (Pro)",
    short: "CRM",
    summary: "O agente da máquina anota no seu Streak CRM, pela API, o que acontece nas conversas do WhatsApp: comentários e campos sozinho; box novo e mudança de etapa só com o seu \"ok\".",
    minutes: 6,
    icon: "chat",
    steps: [
      {
        id: "pro", title: "Ter o plano Pro nesta máquina", target: "none", body: "crm-pro",
        text: "O CRM pelo WhatsApp é do plano Pro, como o Navegador. Se já liberou o Navegador, este passo já está feito.",
        done: (_st, _f, c) => c.crm.access === "ok",
      },
      {
        id: "instalar", title: "Instalar o CRM na máquina", target: "none", body: "crm-install",
        text: "Entra um plugin no OpenClaw da máquina (vê as conversas e percebe quando uma fica em silêncio) e uma ferramenta que fala com o Streak pela API. Nada passa pelo seu computador: funciona com o app fechado.",
        done: (_st, _f, c) => c.crm.access === "ok" && c.crm.info?.installed === true,
      },
      {
        id: "config", title: "Chave da API do Streak, pipeline e regras", target: "none", body: "crm-config",
        text: "Peça ao agente: ele gera a chave no Gmail pelo Navegador (botão do Streak › Integrações e Automações › Integrações personalizadas) e guarda direto na máquina. Ou faça você: copie a chave lá e cole aqui. Nos dois casos ela fica só na máquina (arquivo 0600) e nunca volta ao app. Depois escolha o pipeline (um só, o app escolhe sozinho) e quanto tempo de silêncio na conversa dispara a anotação.",
        done: (_st, _f, c) => c.crm.access === "ok" && c.crm.info?.configured === true && c.crm.info.pipelineKey !== null,
      },
      {
        id: "testar", title: "Testar pelo seu WhatsApp", target: "none", body: "crm-test",
        text: "No WhatsApp, abra a conversa com você mesmo (seu próprio número) e mande: \"anota no CRM: <nome do contato> <o que aconteceu>\". Em até um minuto chega a confirmação 📇. Se ele propuser algo (mudar de etapa, criar box), responda \"ok\" ou \"não\".",
        done: (_st, f) => f.crmSeen,
        manual: { label: "Recebi a confirmação", flag: "crmSeen" },
      },
    ],
  },
];

/** Selo do cartão: "TUTORIAL 3 · 4 PASSOS · 3 MIN" (o renderer põe em caixa alta); sem número, só passos e minutos. */
export function tutorialBadge(t: Tutorial, withNumber = true): string {
  const n = t.steps.length;
  return [withNumber ? `Tutorial ${t.number}` : undefined, t.badge, `${n} ${n === 1 ? "passo" : "passos"}`, `${t.minutes} min`].filter((x): x is string => x !== undefined && x !== "").join(" · ");
}
/** Número fixo de um tutorial pelo id (o admin recebe só ids); null para id desconhecido. */
export const tutorialNumber = (id: string): number | null => TUTORIAIS.find((t) => t.id === id)?.number ?? null;

/** Rótulo do botão do passo atual, por alvo: o guia leva a pessoa ao lugar certo em vez de pedir para procurar. */
export const GUIDE_ACTION_LABEL: Record<Exclude<GuideTarget, "none">, string> = {
  "wa-line": "Abrir o WhatsApp", "wa-agent": "Pedir ao agente para preparar", "wa-pair": "Gerar QR", "wa-policy": "Escolher no WhatsApp", "chat": "Ir para a conversa",
};

/** Título da aba do guia: "2 · WhatsApp 2/4", ou "2 · WhatsApp ✓" quando tudo está feito. */
export function guideTabTitle(t: Tutorial, v: GuideView): string {
  return v.finished ? `${t.number} · ${t.short} ✓` : `${t.number} · ${t.short} ${v.done.filter(Boolean).length}/${t.steps.length}`;
}

export interface GuideView { done: boolean[]; current: number; finished: boolean }

/**
 * Estado do guia: quais passos estão concluídos e qual é o atual (o primeiro pendente). Sequencial: um passo
 * só conta como concluído se todos os anteriores também estão; assim uma marcação antiga ("testei") não
 * acende o passo 4 enquanto o número está desconectado.
 */
/** Todas as fontes do tutorial já chegaram nesta janela? */
export const tutorialKnown = (t: Tutorial, ctx: GuideContext): boolean => t.needs.every((s) => ctx.known[s]);
export type TutorialState = "done" | "todo" | "unknown";
/**
 * Estado do tutorial para a lista e o selo. Concluído uma vez, fica concluído (`remembered` true): o estado real da
 * máquina oscila (SSH devagar, números de limite ainda não carregados) e fazia o cartão da status line aparecer e sumir
 * depois de feito; só "Refazer do zero" apaga a lembrança. Sem lembrança: o estado real quando as fontes chegaram;
 * antes disso, "unknown" (verificando). "Em breve" nunca conta como feito.
 */
export function tutorialState(t: Tutorial, status: WhatsappStatus | null, flags: GuideFlags, ctx: GuideContext, remembered: boolean | null): TutorialState {
  if (t.comingSoon === true) return "todo";
  if (remembered === true) return "done";
  if (!tutorialKnown(t, ctx)) return remembered === null ? "unknown" : "todo";
  return guideView(t, status, flags, ctx).finished ? "done" : "todo";
}
/** Lembrança por máquina (`tutLembrado:<host>`): id → concluído na última vez em que as fontes chegaram. */
/** Tutoriais que a pessoa pulou nesta máquina (localStorage): ids válidos, sem repetir; lixo vira vazio. */
export function parseTutPulados(json: string | null): Set<string> {
  if (json === null || json === "") return new Set();
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]+$/.test(x))) : new Set();
  } catch { return new Set(); }
}
export function parseTutMemory(json: string | null): Record<string, boolean> {
  if (json === null || json === "") return {};
  try {
    const v = JSON.parse(json) as unknown;
    if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, b] of Object.entries(v as Record<string, unknown>)) if (typeof b === "boolean" && /^[a-z0-9-]+$/.test(k)) out[k] = b;
    return out;
  } catch { return {}; }
}
export function guideView(t: Tutorial, status: WhatsappStatus | null, flags: GuideFlags, ctx: GuideContext = emptyContext()): GuideView {
  const done: boolean[] = [];
  let chain = true;
  for (const s of t.steps) { chain = chain && passoFeito(s, status, flags, ctx); done.push(chain); }
  const current = done.indexOf(false);
  return { done, current, finished: current === -1 };
}

/**
 * Os tutoriais desta janela: o do suporte só com o pacote de suporte disponível; o do Grok só onde ele é
 * possível, inclusive na máquina "local" (null = ainda não consultado = mostra); o da guarda só onde ela é possível (null = esconde); os da trilha (`after`) só depois que o anterior foi
 * concluído (`finished` é do chamador: concluir depende de flags e da máquina). Um `after` escondido esconde
 * quem depende dele (o 6 some junto com o 5).
 */
export function visibleTutorials(ctx: GuideContext, finished: (t: Tutorial) => boolean = () => false): Tutorial[] {
  const visible = (t: Tutorial): boolean => {
    if (t.oculto === true) return false;
    if (t.needsSupport === true && ctx.support?.available !== true) return false;
    if (t.needsXai === true && ctx.xai.possible === false) return false;
    if (t.needsLinkPublico === true && !ctx.linkPublicoPossivel) return false;
    if (t.needsCrmStreak === true && !ctx.produto.crmStreak) return false;
    if (t.needsCrmProprio === true && !ctx.produto.crmProprio) return false;
    if (t.needsFinance === true && ctx.finance.access !== true) return false;
    // Só quando a máquina já confirmou que o agente aceita a guarda: com null (ainda consultando) o cartão aparecia e
    // sumia assim que a resposta dizia "sem guarda" (Hermes).
    if (t.needsGuarda === true && ctx.guarda.possible !== true) return false;
    if (t.needsDigitando === true && ctx.digitando.possible !== true) return false;
    if (t.after === undefined) return true;
    const prev = TUTORIAIS.find((x) => x.id === t.after);
    return prev !== undefined && visible(prev) && finished(prev);
  };
  return TUTORIAIS.filter(visible);
}

/**
 * Selo ao lado de "Tutoriais" na lateral. Duas notificações distintas: o número são as pendências (tutoriais
 * disponíveis não concluídos; o interruptor "avisar na lateral" desliga isso) e o pulso é novidade (tutorial
 * que apareceu depois da última vez que a pessoa abriu Tutoriais). A novidade não obedece ao interruptor:
 * com o aviso desligado, o selo mostra só as novidades, pulsando, até a pessoa abrir Tutoriais. null = nada.
 */
export function sidebarBadge(c: { todo: number; novos: number; avisar: boolean }): { text: string; pulse: boolean } | null {
  if (c.avisar) return c.todo > 0 ? { text: String(c.todo), pulse: c.novos > 0 } : null;
  return c.novos > 0 ? { text: String(c.novos), pulse: true } : null;
}
