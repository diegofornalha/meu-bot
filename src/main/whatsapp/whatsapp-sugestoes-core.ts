/**
 * Modo "sugere e você aprova" do WhatsApp, lado do app (puro; o IO fica em whatsapp-sugestoes.ts). A fila mora na
 * máquina, no plugin de guarda do OpenClaw (backend-colima/guarda/sugestoes.mjs): aqui só montamos a chamada da CLI
 * dele e lemos o JSON que ela imprime. Plano: docs/planos/modo-gratis-sugestoes.md.
 */
import type { WhatsappSugestao, WhatsappSugestoes } from "../../shared/ipc";

const CLI = '"$HOME/.local/share/meu-bot/guarda/sugestoes.mjs"';
const ID_RE = /^[a-z0-9]{6,40}$/;
export const SUGESTAO_TEXTO_MAX = 4000;
export const SEM_SUGESTOES: WhatsappSugestoes = { disponivel: false, ligado: false, desde: null, sugestoes: [] };

export type SugestaoComando =
  | { acao: "listar" } | { acao: "ligar" } | { acao: "desligar" }
  | { acao: "aprovar"; id: string; texto?: string }
  | { acao: "descartar"; id: string };

/** O que a tela pediu, saneado; null = pedido inválido. */
export function parseSugestaoComando(raw: unknown): SugestaoComando | null {
  if (raw === null || typeof raw !== "object") return null;
  const p = raw as { acao?: unknown; id?: unknown; texto?: unknown };
  if (p.acao === "ligar" || p.acao === "desligar") return { acao: p.acao };
  if (p.acao !== "aprovar" && p.acao !== "descartar") return null;
  if (typeof p.id !== "string" || !(ID_RE.test(p.id) || (p.acao === "descartar" && p.id === "todas"))) return null;
  if (p.acao === "descartar") return { acao: "descartar", id: p.id };
  if (p.texto === undefined) return { acao: "aprovar", id: p.id };
  if (typeof p.texto !== "string" || p.texto.trim() === "" || p.texto.length > SUGESTAO_TEXTO_MAX) return null;
  return { acao: "aprovar", id: p.id, texto: p.texto.trim() };
}

/**
 * Roda a CLI da guarda na máquina. Imprime `acao=<json>` (o resultado do comando, quando não é só listar) e sempre
 * `sugestoes=<json>` com o estado e a fila depois dele. Sem o arquivo (guarda antiga ou máquina sem OpenClaw), as duas
 * linhas dizem `indisponivel`. O texto editado vai em base64url: nada da pessoa entra no shell.
 */
export function sugestoesSh(c: SugestaoComando): string {
  const args = c.acao === "aprovar" ? `aprovar ${c.id}${c.texto === undefined ? "" : ` --texto-b64 ${Buffer.from(c.texto, "utf8").toString("base64url")}`}`
    : c.acao === "descartar" ? `descartar ${c.id}` : c.acao;
  return `export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ ! -f ${CLI} ] || ! command -v node >/dev/null 2>&1; then echo "acao=indisponivel"; echo "sugestoes=indisponivel"; exit 0; fi
${c.acao === "listar" ? "" : `echo "acao=$(node ${CLI} ${args} 2>/dev/null | tail -n 1 | tr -d '\\n')"
`}echo "sugestoes=$(node ${CLI} listar 2>/dev/null | tail -n 1 | tr -d '\\n')"`;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const iso = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);

/** A linha `<chave>=` da saída; null se a máquina não respondeu no formato. "indisponivel" = sem a CLI. */
export function lerSaida(stdout: string, chave: "acao" | "sugestoes"): Record<string, unknown> | "indisponivel" | null {
  const linha = stdout.split("\n").reverse().find((l) => l.startsWith(`${chave}=`));
  if (linha === undefined) return null;
  const v = linha.slice(chave.length + 1).trim();
  if (v === "indisponivel") return "indisponivel";
  try { const j: unknown = JSON.parse(v); return isObj(j) ? j : null; } catch { return null; }
}

/** Uma sugestão da fila, saneada: destino é "+dígitos" ou JID de grupo; o que vier fora disso cai. */
function parseSugestao(d: unknown): WhatsappSugestao | null {
  if (!isObj(d)) return null;
  const em = iso(d.em);
  if (typeof d.id !== "string" || !ID_RE.test(d.id) || em === null) return null;
  if (typeof d.para !== "string" || !(/^\+\d{8,15}$/.test(d.para) || /^\d{6,40}@g\.us$/.test(d.para))) return null;
  if (typeof d.texto !== "string" || d.texto === "") return null;
  return { id: d.id, para: d.para, texto: d.texto.slice(0, SUGESTAO_TEXTO_MAX), em };
}

/** O estado e a fila que a CLI devolveu (`listar`, `estado`, `ligar`, `desligar`). */
export function parseSugestoes(saida: Record<string, unknown> | "indisponivel" | null): WhatsappSugestoes {
  if (saida === null || saida === "indisponivel") return SEM_SUGESTOES;
  const lista = Array.isArray(saida.sugestoes) ? saida.sugestoes.map(parseSugestao).filter((s): s is WhatsappSugestao => s !== null) : [];
  return { disponivel: true, ligado: saida.ligado === true, desde: iso(saida.desde), sugestoes: lista.sort((a, b) => a.em.localeCompare(b.em)) };
}

/** A frase de erro de `aprovar`/`descartar`, ou null se deu certo. */
export function erroDaAcao(saida: Record<string, unknown> | "indisponivel" | null): string | null {
  if (saida === "indisponivel") return "a guarda desta máquina ainda não tem o modo sugestão; reinstale a guarda (tutorial 8)";
  if (saida === null) return "a máquina não respondeu";
  if (typeof saida.erro === "string" && saida.erro !== "") return saida.erro.slice(0, 300);
  return saida.ok === true || typeof saida.ligado === "boolean" ? null : "resposta inesperada da máquina";
}
