/**
 * Navegador do meu-bot para o agente do WhatsApp quando o gateway é o Hermes (parte pura; o IO fica em
 * navegador-whatsapp-hermes.ts). No Hermes quem roda o modelo é o backend do meu-bot na própria máquina, então não há
 * servidor MCP para cadastrar no gateway nem trava por remetente pronta, como no OpenClaw. O que existe:
 *
 * - o ESTADO na máquina (`navegador-whatsapp.json`): ligado e a lista de números que o dono marcou no app;
 * - o plugin `meu-bot-navegador` do Hermes, que a cada turno confere quem escreveu e, se o número está na lista, entrega
 *   ao backend um passe de uso único (backend-colima/hermes-plugins/meu-bot-navegador/);
 * - o backend (navegador-whatsapp.js, a partir da BACKEND_MINIMO), que confere o passe e liga o Navegador no turno.
 *
 * Só conversa direta. A lista começa com o dono gravado e o número pareado; o resto o dono acrescenta pelo 📱.
 */
import { BACKEND_DIR_SH } from "../maquina/backend-dir-core";
import { NAV_MCP_VERSAO, NAV_RULE_END, NAV_RULE_START } from "./navegador-whatsapp-core";

export const HERMES_NAV_PLUGIN = "meu-bot-navegador";
/** Primeira versão do backend que entende o passe: com uma anterior, o marcador do plugin iria parar no texto da conversa. */
export const BACKEND_MINIMO = "1.13.0";
export const NAV_WA_MAX_NUMEROS = 20;

/** Números só com dígitos (8 a 15), sem repetição, na ordem em que vieram; o que não for número sai. */
export function numerosOk(xs: unknown): string[] {
  const out: string[] = [];
  for (const x of Array.isArray(xs) ? xs : []) {
    const n = typeof x === "string" ? x.replace(/\D/g, "") : "";
    if (/^\d{8,15}$/.test(n) && !out.includes(n)) out.push(n);
  }
  return out.slice(0, NAV_WA_MAX_NUMEROS);
}

/** "1.12.1" < "1.13.0"? Versão ilegível conta como anterior (máquina sem VERSION = backend antigo). */
export function versaoAnterior(tem: string, minima: string): boolean {
  const p = (v: string): number[] | null => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim()); return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])]; };
  const a = p(tem), b = p(minima);
  if (a === null || b === null) return true;
  for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  return false;
}

/** Leitura da máquina: o estado, o plugin (`.ok` = versão instalada), o servidor do Navegador e a versão do backend. */
export const NAV_HERMES_LER_SH = `M="$HOME/.local/share/meu-bot"
echo "estado=$(tr -d '\\n' < "$M/navegador-whatsapp.json" 2>/dev/null)"
echo "plugin=$(cat "$HOME/.hermes/plugins/${HERMES_NAV_PLUGIN}/.ok" 2>/dev/null)"
echo "mcpfile=$(grep -qs "${NAV_MCP_VERSAO}" "$M/navegador-mcp.mjs" && echo 1 || echo 0)"
${BACKEND_DIR_SH}
echo "backendver=$(cat "$BD/VERSION" 2>/dev/null)"
`;

export interface NavHermesLido { on: boolean; numeros: string[]; gravado: boolean; plugin: string; mcpfile: boolean; backend: string }
export function lerNavHermes(kv: ReadonlyMap<string, string>): NavHermesLido {
  let j: Record<string, unknown> = {};
  const cru = kv.get("estado") ?? "";
  try { const v = JSON.parse(cru || "{}") as unknown; if (v !== null && typeof v === "object" && !Array.isArray(v)) j = v as Record<string, unknown>; } catch { /* ilegível = desligado */ }
  return { on: j.on === true, numeros: numerosOk(j.numeros), gravado: cru.trim() !== "", plugin: (kv.get("plugin") ?? "").trim(), mcpfile: kv.get("mcpfile") === "1", backend: (kv.get("backendver") ?? "").trim() };
}

/**
 * Grava o estado (0600, troca atômica). Desligar apaga os passes pendentes. Ligar tira do ~/.hermes/AGENTS.md o bloco de
 * conduta do OpenClaw, se uma versão antiga do app o deixou lá (no Hermes a regra vai no próprio turno, pelo backend, e
 * aquele bloco cita nomes de ferramenta que não existem aqui). Imprime `estado=ok`.
 */
export function navHermesGravarSh(on: boolean, numeros: readonly string[]): string {
  const b64 = Buffer.from(JSON.stringify({ v: 1, on, numeros: numerosOk([...numeros]) }), "utf8").toString("base64");
  return `M="$HOME/.local/share/meu-bot"; mkdir -p "$M"
printf '%s' '${b64}' | base64 -d | python3 -c '
import json, os, sys, time
m, ini, fim = sys.argv[1], sys.argv[2], sys.argv[3]
e = json.load(sys.stdin); e["em"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
f = os.path.join(m, "navegador-whatsapp.json"); tmp = f + ".tmp"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as h: json.dump(e, h)
os.chmod(tmp, 0o600); os.replace(tmp, f)
d = os.path.join(m, "navegador-passes")
if not e["on"] and os.path.isdir(d):
    for n in os.listdir(d):
        try: os.unlink(os.path.join(d, n))
        except OSError: pass
a = os.path.join(os.path.expanduser("~"), ".hermes", "AGENTS.md")
try: t = open(a, encoding="utf-8").read()
except OSError: t = None
if t is not None and ini in t:
    i = t.find(ini); j = t.find(fim, i)
    novo = (t[:i] + (t[j + len(fim):] if j >= 0 else "")).strip(chr(10))
    with open(a + ".tmp", "w", encoding="utf-8") as h: h.write(novo + chr(10) if novo else "")
    os.replace(a + ".tmp", a)
print("estado=ok")
' "$M" '${NAV_RULE_START}' '${NAV_RULE_END}'
`;
}
