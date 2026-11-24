/**
 * Login do Claude Code como passo a passo, não como saída de terminal. Os eventos crus que o
 * main manda (url, waiting-code, log, done) viram passos com estado (pendente, em andamento, feito, falhou), um
 * título em português, o código do dispositivo (quando o login traz um) em destaque e o resto em "detalhes técnicos". Puro: testável.
 */
import type { ClaudeLoginEvent } from "../../shared/ipc";

export type LoginProvider = "claude";
export type StepState = "pending" | "active" | "done" | "bad";
export interface LoginStepView { id: string; title: string; detail: string | null; state: StepState }
export interface LoginView {
  steps: LoginStepView[];
  /** Frase de cima: o que está acontecendo ou como terminou. */
  headline: string;
  /** Código do dispositivo, quando o login traz um, para mostrar grande. */
  code: string | null;
  /** Linhas cruas que sobraram, para quem quiser abrir "detalhes técnicos". */
  details: string[];
  result: "ok" | "fail" | null;
}
export interface LoginContext {
  /** Nome da máquina, para as frases. */
  machine: string;
  running: boolean;
  /** Claude: a pessoa já enviou o código colado. */
  codeSent?: boolean;
}

export const LOGIN_STEPS: Record<LoginProvider, readonly { id: string; title: string }[]> = {
  claude: [
    { id: "conectar", title: "Conectar à máquina" },
    { id: "link", title: "Abrir o link de autorização" },
    { id: "codigo", title: "Colar o código da página" },
    { id: "conferir", title: "Conferir o login" },
  ],
};

/** Linhas do SSH e do CLI que não dizem nada à pessoa. */
const NOISE_RE = /^Connection to .+ closed\.?$|^Waiting for approval|^código do dispositivo:|^conectando a |^iniciando claude auth login/i;
const CODE_RE = /código do dispositivo:\s*([A-Z0-9][A-Z0-9-]{3,})/i;

const INTRO: Record<LoginProvider, (m: string) => string> = {
  claude: (m) => `Abre o link de autorização no navegador; você entra na conta e cola aqui o código que aparece. Máquina: ${m}.`,
};
const HEADLINES: Record<LoginProvider, string[]> = {
  claude: ["Conectando à máquina…", "Abrindo o link de autorização…", "Abri o link no navegador. Entre na conta e cole aqui o código que a página mostra.", "Código enviado; conferindo o login…"],
};

export function loginView(provider: LoginProvider, events: readonly ClaudeLoginEvent[], ctx: LoginContext): LoginView {
  const defs = LOGIN_STEPS[provider];
  let stage = 0; // índice do passo em andamento
  let started = false; let code: string | null = null; let detail: string | null = null;
  let result: "ok" | "fail" | null = null; let doneText = "";
  const details: string[] = [];
  for (const ev of events) {
    if (ev.kind === "log") {
      if (!started) { started = true; stage = Math.max(stage, 1); }
      const m = CODE_RE.exec(ev.text); if (m !== null) code = m[1] ?? null;
      if (/^Waiting for approval/i.test(ev.text)) detail = "Esperando você aprovar na página…";
      if (!NOISE_RE.test(ev.text)) details.push(ev.text);
    } else if (ev.kind === "url") { started = true; stage = Math.max(stage, 2); }
    else if (ev.kind === "waiting-code") { started = true; stage = Math.max(stage, 2); detail = "Cole o código abaixo e envie."; }
    else if (ev.kind === "done") { result = ev.ok ? "ok" : "fail"; doneText = ev.text; }
  }
  if (provider === "claude" && ctx.codeSent === true && result === null) { stage = Math.max(stage, 3); detail = null; }
  const steps: LoginStepView[] = defs.map((d, i) => ({
    id: d.id, title: d.title,
    detail: i === stage && result === null ? detail : null,
    state: result === "ok" ? "done" : result === "fail" ? (i < stage ? "done" : i === stage ? "bad" : "pending") : i < stage ? "done" : i === stage && (started || ctx.running) ? "active" : "pending",
  }));
  const headline = result === "ok" ? `✓ ${doneText}` : result === "fail" ? `✗ ${doneText}` : !started && !ctx.running ? INTRO[provider](ctx.machine) : (HEADLINES[provider][stage] ?? "");
  return { steps, headline, code: result === "ok" ? null : code, details, result };
}
