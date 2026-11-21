/**
 * Grok (xAI) por OAuth na máquina "local" (este Mac), sem efeitos colaterais: a versão do Hermes, a porta do proxy e
 * o providers.json do backend local. O lado com processos é xaiLocal.ts.
 *
 * Nas máquinas por SSH o install-grok-oauth.sh faz isso com systemd; no Mac o backend local já é um processo filho do
 * app, e o proxy vira mais um, que nasce e morre com ele.
 */

import { mesclarProvider } from "../maquina/providers-local-core";

/** A mesma versão do install-grok-oauth.sh: o proxy da xAI é desta versão. */
export const HERMES_VERSION_LOCAL = "0.22.2";

/**
 * Porta do proxy de cada app: 100 abaixo da porta do backend local (meu-bot 8690, meu-bot-staging 8691,
 * inspector-staging 8693). Fora da 8645 das máquinas, que o Lima do Colima pode encaminhar para o Mac, e diferente
 * entre os apps, que podem ficar abertos juntos.
 */
export const proxyPortaLocal = (portaBackend: number): number => portaBackend - 100;

export const proxyUrlLocal = (porta: number): string => `http://127.0.0.1:${porta}/v1`;

/**
 * providers.json do backend local com o grok-4 pelo proxy (o mesmo conteúdo do install-grok-oauth.sh), mesclado no
 * arquivo atual: as outras entradas (o Ollama do modo grátis) ficam. Sem arquivo, nasce com o agente e o grok-4.
 */
export function providersComGrokLocal(porta: number, raw: string | null = null): string {
  return mesclarProvider(raw, { name: "grok-4", type: "openai", priority: 1, base_url: proxyUrlLocal(porta), model: "grok-4", description: "Grok da xAI pelo proxy local do Hermes (login OAuth: hermes auth add xai-oauth)" });
}

/** O providers.json já aponta o grok-4 para o proxy desta porta (= o Grok está preparado neste app). */
export function providersApontaProxy(raw: string | null, porta: number): boolean {
  if (raw === null) return false;
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) && list.some((p) => typeof p === "object" && p !== null && (p as { name?: unknown }).name === "grok-4" && (p as { base_url?: unknown }).base_url === proxyUrlLocal(porta));
  } catch { return false; }
}

/** `hermes auth status xai-oauth` → logado? ("not logged in"/"logged out" também contêm "logged"). */
export function statusXaiLogado(status: string): boolean {
  return /logged in/i.test(status) && !/not logged in/i.test(status);
}

/** Rótulo da credencial ativa (a linha com ←) de `hermes auth list`, no bloco xai-oauth. */
export function rotuloCredencialXai(list: string): string | null {
  const bloco = list.split("\n");
  const ini = bloco.findIndex((l) => l.startsWith("xai-oauth"));
  if (ini === -1) return null;
  for (const l of bloco.slice(ini + 1)) {
    if (l.trim() === "") break;
    if (l.includes("←")) return /#\d+\s+(\S+)/.exec(l)?.[1] ?? null;
  }
  return null;
}

/** `hermes --version` é da versão pedida? */
export const hermesNaVersao = (versionOut: string, versao: string = HERMES_VERSION_LOCAL): boolean => versionOut.includes(`v${versao}`);

/**
 * Proxy da xAI órfão de uma abertura anterior: o `hermes` do PATH é um wrapper node que sobe um python; o SIGTERM no
 * wrapper deixava o python vivo (adotado pelo launchd) segurando a porta, e cada novo proxy morria em "address already
 * in use" a cada 15 s. É nosso quando roda o Hermes DESTA pasta do meu-bot como `proxy start` na porta deste app
 * (cada app tem a sua, então não derruba o proxy de outro meu-bot aberto). Qualquer outro programa fica intocado.
 */
export function ehNossoProxyOrfao(comando: string, prefixoHermes: string, porta: number): boolean {
  const c = comando.trim();
  if (c === "" || prefixoHermes === "") return false;
  if (!c.includes(`${prefixoHermes.replace(/\/+$/, "")}/`)) return false;
  const t = c.split(/\s+/);
  const i = t.indexOf("proxy");
  if (i < 0 || t[i + 1] !== "start") return false;
  const p = t.indexOf("--port");
  return p >= 0 && t[p + 1] === String(porta);
}
