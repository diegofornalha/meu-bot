/**
 * Navegador do meu-bot para o agente do WhatsApp, qualquer que seja o gateway da máquina. Esta é a fachada: descobre o
 * gateway (`motorDe`) e chama o caminho dele.
 *
 * - OpenClaw (aqui embaixo, IO sobre navegador-whatsapp-core.ts): ligar instala o lado da máquina se faltar (o mesmo do
 *   tutorial 9), grava o servidor MCP e a trava por remetente do gateway, recarrega e confere.
 * - Hermes (navegador-whatsapp-hermes.ts): o backend do meu-bot roda o turno, então o que se grava é o estado com a
 *   lista de números marcada pelo dono; o plugin do Hermes entrega um passe por turno a quem está nela.
 * - PicoClaw ou sem agente: não há o recurso; a leitura diz por quê e o botão fica apagado.
 *
 * O arquivo da porta é do browser.ts (grava quando o túnel reverso sobe) e serve aos dois.
 */
import { CREDS_ME, runSsh } from "../whatsapp/whatsapp";
import { WORKSPACE_SH } from "../agente/objetivo-core";
import { installNavegador } from "../maquina/hostProbe";
import { liberadosDoNavegador, navegadorNoWhatsapp, navWhatsappAplicarSh, navWhatsappLerSh, patchNavegadorWhatsapp, travaNavegador } from "./navegador-whatsapp-core";
import { log } from "../maquina/backend";
import { motorDe } from "../whatsapp/whatsapp-motor";
import { navHermesInfo, setNavHermes } from "./navegador-whatsapp-hermes";
import type { Gateway, NavWhatsappInfo } from "../../shared/ipc";

const jsonOr = (v: string | undefined): unknown => { try { return JSON.parse(v || "null"); } catch { return null; } };
async function ler(host: string): Promise<Map<string, string>> {
  const r = await runSsh(host, navWhatsappLerSh(CREDS_ME), 30_000);
  if (r.code !== 0) throw new Error(`não consegui ler a máquina: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
  const kv = new Map<string, string>();
  for (const line of r.stdout.split("\n")) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1)); }
  return kv;
}
const selfOf = (kv: Map<string, string>): string | null => { const m = /^(\d{8,15})[:@]/.exec(kv.get("self") ?? ""); return m === null ? null : m[1]!; };

export type { NavWhatsappInfo };
/** O gateway do WhatsApp desta máquina; null = não tem agente com WhatsApp (ou não deu para saber). */
async function gatewayDe(host: string): Promise<Gateway | null> { try { return (await motorDe(host)).nome; } catch { return null; } }
const semRecurso = (gateway: Gateway | null): NavWhatsappInfo => ({ on: false, liberados: [], gateway, suportado: false, editavel: false, motivo: gateway === null ? "esta máquina não tem agente com WhatsApp" : "o Navegador pelo WhatsApp ainda não existe para o PicoClaw" });

export async function navWhatsappInfo(host: string): Promise<NavWhatsappInfo> {
  const g = await gatewayDe(host);
  if (g === "hermes") return { ...(await navHermesInfo(host)), gateway: g, suportado: true, editavel: true };
  if (g !== "openclaw") return semRecurso(g);
  const kv = await ler(host);
  return { on: navegadorNoWhatsapp(jsonOr(kv.get("mcp"))), liberados: liberadosDoNavegador(jsonOr(kv.get("wa")), selfOf(kv)), gateway: g, suportado: true, editavel: false };
}

/**
 * Liga/desliga. `"sincronizar"` = só refaz a trava do OpenClaw com a lista atual (se estiver ligado); no Hermes a lista é
 * a gravada e não há o que refazer. `numeros` troca a lista onde ela é do app (Hermes).
 */
export async function setNavWhatsapp(host: string, ligar: boolean | "sincronizar", numeros?: readonly string[]): Promise<NavWhatsappInfo> {
  const g = await gatewayDe(host);
  if (g === "hermes") {
    if (ligar === "sincronizar") return { ...(await navHermesInfo(host)), gateway: g, suportado: true, editavel: true };
    return { ...(await setNavHermes(host, ligar, numeros)), gateway: g, suportado: true, editavel: true };
  }
  if (g !== "openclaw") {
    if (ligar === "sincronizar") return semRecurso(g);
    throw new Error(semRecurso(g).motivo);
  }
  return { ...(await setNavOpenclaw(host, ligar)), gateway: g, suportado: true, editavel: false };
}

/** OpenClaw: liga/desliga; `"sincronizar"` = só refaz a trava com a lista atual (se estiver ligado), sem mexer no resto. */
async function setNavOpenclaw(host: string, ligar: boolean | "sincronizar"): Promise<{ on: boolean; liberados: string[] }> {
  let kv = await ler(host);
  const ligado = navegadorNoWhatsapp(jsonOr(kv.get("mcp")));
  if (ligar === "sincronizar" && !ligado) return { on: false, liberados: [] };
  const on = ligar === "sincronizar" ? true : ligar;
  if (on && kv.get("mcpfile") !== "1") {
    const r = await installNavegador(host);
    if (!r.ok) throw new Error(`não consegui preparar a máquina para o Navegador: ${r.log.at(-1) ?? "falhou"}`);
    kv = await ler(host);
  }
  const liberados = liberadosDoNavegador(jsonOr(kv.get("wa")), selfOf(kv));
  const patch = patchNavegadorWhatsapp(on, jsonOr(kv.get("tbs")), liberados, kv.get("node") ?? "", kv.get("home") ?? "");
  const w = await runSsh(host, navWhatsappAplicarSh(patch, on, WORKSPACE_SH), 120_000);
  if (!/rc=0/.test(w.stdout)) throw new Error(`o OpenClaw recusou a mudança: ${w.stdout.split("\n").filter((l) => l.startsWith("ERR=")).map((l) => l.slice(4)).join(" ") || "sem resposta"}`);
  // Confere pelo openclaw.json relido: servidor como pedido e a trava com o Navegador negado no "*".
  const depois = await ler(host);
  const tbs = jsonOr(depois.get("tbs"));
  const esperado = travaNavegador(jsonOr(kv.get("tbs")), liberados, on);
  if (navegadorNoWhatsapp(jsonOr(depois.get("mcp"))) !== on || JSON.stringify(tbs) !== JSON.stringify(esperado)) throw new Error("a mudança não ficou gravada na máquina (o openclaw.json relido não bate); tente de novo");
  log(`navegador no whatsapp: ${on ? "ligado" : "desligado"} em ${host}; liberados: ${liberados.map((n) => `+${n}`).join(", ") || "ninguém"}; regra do AGENTS.md: ${/REGRA=1/.test(w.stdout) ? "ok" : "falhou"}`);
  return { on, liberados };
}

/** Porta do túnel reverso para o servidor do Navegador do agente do WhatsApp (null = túnel caiu: apaga). */
export async function gravarPortaNavegador(host: string, port: number | null): Promise<void> {
  const f = "$HOME/.local/share/meu-bot/navegador-porta";
  const sh = port === null ? `rm -f "${f}"` : `mkdir -p "$HOME/.local/share/meu-bot" && printf '%s' '${Math.trunc(port)}' > "${f}.tmp" && mv "${f}.tmp" "${f}"`;
  await runSsh(host, `${sh}\n`, 15_000).catch(() => undefined);
}
