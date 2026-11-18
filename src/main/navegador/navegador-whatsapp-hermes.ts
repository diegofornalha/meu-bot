/**
 * Navegador para o agente do WhatsApp no Hermes: o IO (SSH) sobre navegador-whatsapp-hermes-core.ts. Ligar confere o
 * backend, instala o que faltar na máquina (servidor do Navegador e plugin do Hermes), grava o estado e relê.
 */
import { runSsh } from "../whatsapp/whatsapp";
import { LOCAL_WA_HOST } from "../whatsapp/whatsapp-local-core";
import { donosDe } from "../whatsapp/whatsapp-marks";
import { MOTORES } from "../whatsapp/whatsapp-motor";
import { hermesPluginSh, lerPausaPlugin, versaoDoPluginYaml, type PausaPluginFonte } from "../whatsapp/whatsapp-hermes-pausa-core";
import { installNavegador, pluginHermesFonte } from "../maquina/hostProbe";
import { log } from "../maquina/backend";
import { BACKEND_MINIMO, HERMES_NAV_PLUGIN, lerNavHermes, NAV_HERMES_LER_SH, navHermesGravarSh, numerosOk, versaoAnterior, type NavHermesLido } from "./navegador-whatsapp-hermes-core";

async function ler(host: string): Promise<NavHermesLido> {
  const r = await runSsh(host, NAV_HERMES_LER_SH, 30_000);
  if (r.code !== 0) throw new Error(`não consegui ler a máquina: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
  const kv = new Map<string, string>();
  for (const line of r.stdout.split("\n")) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1)); }
  return lerNavHermes(kv);
}

export interface NavHermesEstado { on: boolean; liberados: string[] }
export async function navHermesInfo(host: string): Promise<NavHermesEstado> {
  const l = await ler(host);
  return { on: l.on, liberados: l.numeros };
}

/**
 * Liga, desliga ou troca a lista (`numeros`; sem ela vale a gravada e, na primeira vez, o dono e o número pareado).
 * Lista vazia com o Navegador ligado é recusada: ligado sem ninguém não serve para nada e confunde.
 */
export async function setNavHermes(host: string, on: boolean, numeros?: readonly string[]): Promise<NavHermesEstado> {
  if (host === LOCAL_WA_HOST) throw new Error("o Navegador para o agente do WhatsApp com Hermes é de uma máquina por SSH");
  let l = await ler(host);
  let lista = numeros !== undefined ? numerosOk([...numeros]) : l.numeros;
  if (on) {
    if (versaoAnterior(l.backend, BACKEND_MINIMO)) throw new Error(`o backend desta máquina (${l.backend || "sem versão"}) é anterior ao ${BACKEND_MINIMO}: atualize o backend e ligue de novo`);
    if (numeros === undefined && !l.gravado) lista = numerosOk(donosDe(await MOTORES.hermes.readQuem(host)));
    if (lista.length === 0) throw new Error("marque ao menos um número que pode usar o Navegador pelo WhatsApp");
    if (!l.mcpfile) {
      const r = await installNavegador(host);
      if (!r.ok) throw new Error(`não consegui preparar a máquina para o Navegador: ${r.log.at(-1) ?? "falhou"}`);
    }
    const fonte: PausaPluginFonte | null = pluginHermesFonte(HERMES_NAV_PLUGIN);
    if (fonte === null || versaoDoPluginYaml(fonte.yaml) === null) throw new Error("este pacote do app veio sem o plugin do Navegador para o Hermes");
    if (l.plugin !== fonte.versao) {
      const p = await runSsh(host, hermesPluginSh(HERMES_NAV_PLUGIN, fonte), 3 * 60_000);
      const s = lerPausaPlugin(p.stdout);
      if (p.code !== 0 || !s.ok) throw new Error(`não consegui instalar o plugin do Navegador no Hermes (plugin=${s.plugin}, enabled=${s.enabled})`);
      log(`navegador no whatsapp (hermes): plugin ${s.plugin} em ${host}; gateway: ${s.restart}`);
    }
  }
  const w = await runSsh(host, navHermesGravarSh(on, lista), 30_000);
  if (!/^estado=ok$/m.test(w.stdout)) throw new Error(`não consegui gravar na máquina: ${w.stderr.trim().split("\n").pop() ?? "sem resposta"}`);
  l = await ler(host);
  if (l.on !== on || JSON.stringify(l.numeros) !== JSON.stringify(lista)) throw new Error("a mudança não ficou gravada na máquina (o estado relido não bate); tente de novo");
  log(`navegador no whatsapp (hermes): ${on ? "ligado" : "desligado"} em ${host}; liberados: ${lista.map((n) => `+${n}`).join(", ") || "ninguém"}`);
  return { on, liberados: l.numeros };
}
