/** Textos da seção "Contas do Claude" (tutorial 1): estado, uso e aviso de "todas no limite". Puro: testável. */
import type { ContaClaudeEvento, ContaClaude, ContasClaudeView } from "../../shared/ipc";
import { timeUntil } from "./status-line.js";

/** "17:05" no fuso deste Mac para um epoch em segundos. */
export const horaLocal = (epochS: number): string => new Date(epochS * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Rótulo curto do estado da conta, como aparece na lista. */
export function estadoTexto(c: ContaClaude, atual: string | null, nowMs = Date.now()): { text: string; tone: "ok" | "warn" | "err" | "muted" } {
  if (!c.ativa) return { text: "desligada", tone: "muted" };
  if (!c.logada) return { text: "não logada", tone: "err" };
  const u = c.uso;
  if (u.estado === "bloqueada") return { text: u.motivo !== null ? `bloqueada: ${u.motivo}` : "bloqueada", tone: "err" };
  if (u.estado === "esgotada") return { text: u.ate !== null ? `no limite · volta ${timeUntil(u.ate, nowMs) === "now" ? "agora" : `em ${timeUntil(u.ate, nowMs)}`}` : "no limite", tone: "err" };
  if (u.estado === "aviso") return { text: "acima do limiar", tone: "warn" };
  if (c.id === atual) return { text: "em uso", tone: "ok" };
  return { text: "pronta", tone: "ok" };
}

/** "Sessão 42% · 1h20m · Semanal 10% · 3d2h"; "" sem dado. */
export function usoTexto(c: ContaClaude, nowMs = Date.now()): string {
  const parts: string[] = [];
  const j = (nome: string, w: { pct: number; resets: number | null } | null): void => { if (w !== null) parts.push(`${nome} ${Math.round(w.pct)}%${w.resets !== null && w.resets * 1000 > nowMs ? ` · ${timeUntil(w.resets, nowMs)}` : ""}`); };
  j("Sessão", c.uso.sessao); j("Semanal", c.uso.semanal);
  return parts.join(" · ");
}

/** Aviso quando nenhuma conta serve agora; null quando há conta disponível. */
/** "27/10 14:02 · WhatsApp · Segunda → Login padrão (limite de uso)". */
export function eventoTexto(ev: ContaClaudeEvento): string {
  const d = new Date(ev.em * 1000);
  const quando = Number.isNaN(d.getTime()) ? "" : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const origem = ev.origem === "whatsapp" ? "WhatsApp" : ev.origem === "terminal" ? "Terminal" : ev.origem === "cli" ? "linha de comando" : ev.origem;
  const para = ev.para ?? "nenhuma conta livre";
  return `${quando} · ${origem} · ${ev.de ?? "?"} → ${para}${ev.motivo ? ` (${ev.motivo})` : ""}`;
}
/** `grok`: a xAI está logada nesta máquina (true), não está (false) ou não se sabe (null): só com true se promete o grok-4. */
export function avisoSemConta(view: ContasClaudeView, grok: boolean | null = null): string | null {
  if (view.atual !== null) return null;
  if (view.contas.every((c) => !c.logada || !c.ativa)) return "Nenhuma conta logada e ligada: entre em uma conta para o agente responder pelo Claude.";
  const ateLa = grok === true ? "até lá o grok-4 responde" : "até lá o agente não responde";
  return view.proximaEm !== null ? `Todas as contas estão no limite de uso. A próxima volta às ${horaLocal(view.proximaEm)}; ${ateLa}.` : "Todas as contas estão no limite ou bloqueadas.";
}

/** Nome exibido: o rótulo e, quando há, o e-mail. */
export const nomeConta = (c: ContaClaude): string => (c.email !== null && !c.rotulo.includes(c.email) ? `${c.rotulo} · ${c.email}` : c.rotulo);

/**
 * Erro do chat por limite de uso (o backend já tentou todas as contas e o reserva): o motivo em português e o que
 * fazer, no lugar de "Backend indisponível: You've hit your limit". null = não é limite (fica o aviso de sempre).
 */
export function avisoLimiteNoChat(code: string | undefined): { title: string; text: string } | null {
  if (code !== "model_limit" && code !== "conta_limite") return null;
  return {
    title: "As contas do Claude desta máquina chegaram no limite de uso",
    text: "Não é falha do meu-bot nem da máquina: o Claude limita o uso por conta e o reserva também esgotou. Dá para esperar a volta do limite, entrar com outra conta do Claude (tutorial 1, «Contas do Claude nesta máquina») ou pedir ao admin uma conta a mais.",
  };
}
