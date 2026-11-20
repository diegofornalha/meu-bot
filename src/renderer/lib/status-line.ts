/** Status line do chat (modelo da box: modelo | Ctx | conta | Sessão | Semanal | Espaço). Puro: testável. */
import type { AccountStatus, StatusLineSegments } from "../../shared/ipc";
import { tam } from "./espaco.js";

export interface Segment { kind: "model" | "ctx" | "turn" | "account" | "session" | "weekly" | "age" | "espaco"; text: string; title?: string; /** Cor de aviso (amarelo) ou de perigo (vermelho): o Espaço a partir de 80% e 95%. */ tone?: "warn" | "bad" }

/** 1234 → "1.2k", 2500000 → "2.5M" (igual ao fmt do statusline.sh). */
export const fmtK = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

/** Tempo até um epoch (s): "now", "35min", "1h35m", "4d23h". */
export function timeUntil(resetEpochSec: number, nowMs = Date.now()): string {
  const mins = Math.floor((resetEpochSec * 1000 - nowMs) / 60_000);
  if (mins <= 0) return "now";
  if (mins >= 1440) return `${Math.floor(mins / 1440)}d${Math.floor((mins % 1440) / 60)}h`;
  if (mins >= 60) return `${Math.floor(mins / 60)}h${mins % 60}m`;
  return `${mins}min`;
}

/** "há 12 min" para o updated (epoch s) do cache; "" se não há. */
export function ageText(updatedEpochSec: number | null, nowMs = Date.now()): string {
  if (updatedEpochSec === null) return "";
  const mins = Math.floor((nowMs - updatedEpochSec * 1000) / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  if (mins < 1440) return `há ${Math.floor(mins / 60)} h`;
  return `há ${Math.floor(mins / 1440)} d`;
}

/** Limiares de aviso (os mesmos do alerta do Hermes no WhatsApp). */
export const SESSION_THRESHOLDS = [80, 90, 95] as const;
/** Limiares do espaço da conta na máquina (os mesmos do aviso do backend no WhatsApp). */
export const ESPACO_THRESHOLDS = [80, 95] as const;

/** Maior limiar cruzado por `pct` que ainda não foi avisado (`warned` = último avisado). */
export function thresholdToWarn(pct: number | null, warned: number, thresholds: readonly number[] = SESSION_THRESHOLDS): number | null {
  if (pct === null) return null;
  let hit: number | null = null;
  for (const t of thresholds) if (pct >= t && t > warned) hit = t;
  return hit;
}

export const isClaudeModel = (model: string): boolean => model !== "grok-4" && model !== "ollama-local";

export interface StatusInput {
  model: string;
  ctx: { tokens: number; budget: number } | null;
  turn: { ms: number; completion: number } | null;
  account: AccountStatus | null;
  nowMs?: number;
  /** Segmentos ligados (Tutoriais › Status line); ausente/null = todos. `turn` e `age` não entram na escolha. */
  segments?: StatusLineSegments | null;
}

/** Prévia do que a barra mostra com uma escolha de segmentos (texto de exemplo, como o do teste do script). */
export function previewLine(segments: StatusLineSegments | null): string {
  const on = (k: keyof StatusLineSegments): boolean => segments === null || segments[k] !== false;
  const parts: string[] = [];
  if (on("model")) parts.push("Opus 4.8");
  if (on("ctx")) parts.push("Ctx: 12% · 24.0k/200.0k");
  if (on("account")) parts.push("você@exemplo.com (Premium)");
  if (on("session")) parts.push("Sessão: 57% · 1h4m");
  if (on("weekly")) parts.push("Semanal: 12% · 3d");
  if (on("espaco")) parts.push("Espaço: 72%");
  return parts.join(" | ");
}

export function buildSegments(input: StatusInput): Segment[] {
  const now = input.nowMs ?? Date.now();
  const segs = input.segments ?? null;
  const on = (k: keyof StatusLineSegments): boolean => segs === null || segs[k] !== false;
  // O modelo que está respondendo de fato (o backend informa; "Opus 5.5" durante o limite do Fable); sem isso, o modo.
  const real = isClaudeModel(input.model) ? input.account?.modelName ?? null : null;
  const out: Segment[] = on("model") ? [{ kind: "model", text: real ?? input.model }] : [];
  if (on("ctx") && input.ctx !== null && input.ctx.budget > 0) {
    const pct = Math.min(999, Math.round((input.ctx.tokens / input.ctx.budget) * 100));
    out.push({ kind: "ctx", text: `Ctx: ${pct}% · ${fmtK(input.ctx.tokens)}/${fmtK(input.ctx.budget)}`, title: "tokens estimados enviados ao backend / orçamento de contexto" });
  }
  if (input.turn !== null && input.turn.ms > 0) {
    const tps = input.turn.completion > 0 ? ` · ${Math.round(input.turn.completion / (input.turn.ms / 1000))} t/s` : "";
    out.push({ kind: "turn", text: `${(input.turn.ms / 1000).toFixed(1)} s${input.turn.completion > 0 ? ` · ${fmtK(input.turn.completion)} tok` : ""}${tps}`, title: "último turno" });
  }
  const a = input.account;
  if (a !== null && isClaudeModel(input.model)) {
    if (on("account") && a.email !== null) out.push({ kind: "account", text: a.assento !== null ? `${a.email} (${a.assento})` : a.email });
    if (on("session") && a.sessionPct !== null) out.push({ kind: "session", text: `Sessão: ${Math.round(a.sessionPct)}%${a.sessionResets !== null ? ` · ${timeUntil(a.sessionResets, now)}` : ""}`, title: "limite de 5 horas do Claude" });
    if (on("weekly") && a.weeklyPct !== null) out.push({ kind: "weekly", text: `Semanal: ${Math.round(a.weeklyPct)}%${a.weeklyResets !== null ? ` · ${timeUntil(a.weeklyResets, now)}` : ""}`, title: "limite de 7 dias do Claude" });
    const age = ageText(a.updated, now);
    if (age !== "" && (a.sessionPct !== null || a.weeklyPct !== null)) out.push({ kind: "age", text: age, title: "idade do cache do statusline.sh na máquina" });
  }
  // Espaço da conta na máquina (cota de disco), de qualquer modelo: é da máquina, não do Claude.
  const c = input.account?.cota ?? null;
  if (on("espaco") && c !== null) out.push({ kind: "espaco", text: `Espaço: ${c.pct}%`, title: `espaço da sua conta na máquina: ${tam(c.usadoKb)} de ${tam(c.limiteKb)} (Configurações › Espaço)`, ...(c.pct >= 95 ? { tone: "bad" as const } : c.pct >= 80 ? { tone: "warn" as const } : {}) });
  return out;
}

/** O teste do statusline.sh (JSON simulado do Claude Code), digitado no terminal pelo tutorial. */
export const SL_TEST_COMMAND = `MEU_BOT_STATUSLINE_TEST=1; export MEU_BOT_STATUSLINE_TEST; echo '{"model":{"display_name":"Opus 4.8"},"context_window":{"used_percentage":12,"context_window_size":200000,"current_usage":{"input_tokens":24000}},"rate_limits":{"five_hour":{"used_percentage":57},"seven_day":{"used_percentage":12}}}' | bash ~/.claude/statusline.sh`;
