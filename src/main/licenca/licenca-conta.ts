/**
 * A licença da CONTA da pessoa numa máquina por SSH, pedida por ela mesma (sem o admin): o app cria o id da máquina
 * (`maquina.json`), pede à API da conta a licença assinada para esse id, confere a assinatura e grava
 * `licenca-conta.json` ao lado do `licenca.json` do admin. O backend da máquina soma as duas (`licencaEmVigor`).
 * A emissão vale 30 dias; o app renova sozinho ao abrir a janela.
 */
import { randomUUID } from "node:crypto";
import type { LicenseView, PlanoDaContaResultado } from "../../shared/ipc";
import { log } from "../maquina/tunnel";
import { getHostNames, isValidHost } from "../app/settings";
import { contaView, licencaParaMaquina, renovarLicencaDaMaquina, tirarLicencaDaMaquina } from "../conta/conta";
import { verificaLicencaAssinada } from "../conta/licenca-assinada-core";
import { LOCAL_HOST } from "../maquina/localBackend";
import { gravarJsonRemoto } from "../maquina/json-remoto";
import { runSsh } from "../whatsapp/whatsapp";
import { LICENCA_CONTA_PATH, MAQUINA_PATH, deveRenovarLicenca, idDaMaquinaDe, jsonCru } from "./licenca-conta-core";

export { LICENCA_CONTA_PATH, MAQUINA_PATH };
const SEP = "<<<REA-SEP>>>";
const json = jsonCru, idDe = idDaMaquinaDe;

/** O id da máquina e a licença da conta gravada nela; null se a máquina não responde. */
export async function lerLicencaDaContaNaMaquina(host: string): Promise<{ maquina: string | null; arquivo: unknown } | null> {
  const r = await runSsh(host, `cat "${MAQUINA_PATH}" 2>/dev/null; echo "${SEP}"; cat "${LICENCA_CONTA_PATH}" 2>/dev/null; echo\n`, 20_000).catch(() => null);
  if (r === null || r.code !== 0) return null;
  const [maq = "", lic = ""] = r.stdout.split(SEP);
  return { maquina: idDe(json(maq)), arquivo: json(lic) };
}
/** O id desta máquina, criando o `maquina.json` na primeira vez (sem sobrescrever um que outro app tenha criado no mesmo instante). */
async function idDaMaquina(host: string): Promise<string> {
  const novo = JSON.stringify({ id: randomUUID() });
  const script = `set -e\numask 077\nmkdir -p "$HOME/.local/share/meu-bot"\nF="${MAQUINA_PATH}"\n[ -s "$F" ] || (set -C; printf '%s' '${novo}' > "$F") 2>/dev/null || true\ncat "$F"\n`;
  const r = await runSsh(host, script, 20_000);
  const id = r.code === 0 ? idDe(json(r.stdout)) : null;
  if (id === null) throw new Error("não consegui ler o identificador desta máquina (ela está no ar?)");
  return id;
}
const remota = (host: string): boolean => host !== LOCAL_HOST && isValidHost(host);
const apelido = (host: string): string => getHostNames()[host] ?? host;

/**
 * "Usar o meu Pro nesta máquina". `reler` devolve a licença da janela depois de gravar (quem chama passa
 * lerLicencaDaMaquina, para este módulo não depender dele).
 */
export async function usarProDaConta(host: string, reler: () => Promise<LicenseView | null>): Promise<PlanoDaContaResultado> {
  if (!remota(host)) return { ok: false, erro: "Este Mac já usa o plano da sua conta; isto é só para as máquinas por SSH." };
  if (contaView().conta === null) return { ok: false, erro: "Entre na sua conta meu-bot (o avatar no topo) para usar a licença dela aqui." };
  try {
    const id = await idDaMaquina(host);
    const r = await licencaParaMaquina(id, apelido(host));
    if (!r.ok) {
      log(`[licenca] ${host}: a conta não liberou (${r.status}: ${r.erro})`);
      if (r.ocupadas.length > 0) return { ok: false, erro: r.erro, semVaga: r.ocupadas };
      return { ok: false, erro: r.status === 404 ? "a licença da conta na máquina ainda não está disponível; tente mais tarde" : r.erro };
    }
    const v = verificaLicencaAssinada(r.arquivo, { maquina: id });
    if (!v.ok) { log(`[licenca] ${host}: a licença que a API mandou não confere (${v.motivo})`); return { ok: false, erro: "a licença que chegou da sua conta não confere; atualize o meu-bot e tente de novo" }; }
    await gravarJsonRemoto(host, LICENCA_CONTA_PATH, r.arquivo);
    renovadaEm.set(host, Date.now());
    log(`[licenca] ${host}: licença da conta gravada (máquina ${id.slice(0, 8)}, vale até ${v.payload.exp})`);
    return { ok: true, view: await reler() };
  } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : String(e) }; }
}

/** "Tirar o Pro desta máquina": apaga o arquivo de lá (a máquina volta ao que o admin deixou) e abre a vaga na conta. */
export async function tirarProDaConta(host: string, reler: () => Promise<LicenseView | null>): Promise<PlanoDaContaResultado> {
  if (!remota(host)) return { ok: false, erro: "isto é só para as máquinas por SSH" };
  try {
    const atual = await lerLicencaDaContaNaMaquina(host);
    if (atual === null) return { ok: false, erro: "a máquina não respondeu; tente de novo" };
    const r = await runSsh(host, `rm -f "${LICENCA_CONTA_PATH}"\n`, 20_000);
    if (r.code !== 0) return { ok: false, erro: "não consegui apagar a licença da máquina; tente de novo" };
    if (atual.maquina !== null) { const t = await tirarLicencaDaMaquina(atual.maquina, true); if (!t.ok) log(`[licenca] ${host}: apagada da máquina, mas a conta não abriu a vaga (${t.erro})`); }
    log(`[licenca] ${host}: licença da conta tirada da máquina`);
    return { ok: true, view: await reler() };
  } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : String(e) }; }
}

/** Uma conferência por máquina a cada 6 h por sessão do app: a renovação não pode pesar em cada leitura da licença. */
const renovadaEm = new Map<string, number>();
const ENTRE_CONFERENCIAS_MS = 6 * 60 * 60 * 1000;
/**
 * Ao ler a licença da janela: se a máquina usa a licença DESTA conta e a emissão já tem dias, pede outra e grava.
 * A conta respondeu que a máquina não é mais dela (tirada pelo console): o arquivo sai de lá e a vaga abre.
 * Melhor esforço, em segundo plano; devolve true quando o arquivo da máquina mudou (quem chama relê a licença).
 */
export async function renovarSePreciso(host: string, now: number = Date.now()): Promise<boolean> {
  const conta = contaView().conta;
  if (!remota(host) || conta === null) return false;
  const ultima = renovadaEm.get(host);
  if (ultima !== undefined && now - ultima < ENTRE_CONFERENCIAS_MS) return false;
  renovadaEm.set(host, now);
  try {
    const atual = await lerLicencaDaContaNaMaquina(host);
    if (atual === null) { renovadaEm.delete(host); return false; }
    if (atual.maquina === null || atual.arquivo === null) return false;
    const v = verificaLicencaAssinada(atual.arquivo, { maquina: atual.maquina, now });
    if (!deveRenovarLicenca(v, conta.id, now)) return false;
    const r = await renovarLicencaDaMaquina(atual.maquina);
    if (r.ok) {
      if (!verificaLicencaAssinada(r.arquivo, { maquina: atual.maquina, now }).ok) return false;
      await gravarJsonRemoto(host, LICENCA_CONTA_PATH, r.arquivo);
      log(`[licenca] ${host}: licença da conta renovada`);
      return true;
    }
    if (r.status === 404) {
      // Só abre a vaga na conta depois de o arquivo sair de fato da máquina; senão tenta de novo na próxima leitura.
      const rm = await runSsh(host, `rm -f "${LICENCA_CONTA_PATH}"\n`, 20_000);
      if (rm.code !== 0) { log(`[licenca] ${host}: a conta não leva mais a licença a esta máquina, mas não consegui apagar o arquivo`); renovadaEm.delete(host); return false; }
      const t = await tirarLicencaDaMaquina(atual.maquina, true);
      if (!t.ok) log(`[licenca] ${host}: arquivo apagado, mas a conta não abriu a vaga (${t.erro})`);
      log(`[licenca] ${host}: a conta não leva mais a licença a esta máquina; arquivo apagado`);
      return true;
    }
    log(`[licenca] ${host}: não renovei agora (${r.status}: ${r.erro})`);
    // 409: a conta usa a licença em mais máquinas do que o plano cobre (uma máquina extra venceu) e esta ficou de fora.
    // Tentar de novo a cada leitura só gastaria o limite de emissões por minuto: a próxima conferência é no intervalo normal.
    if (r.status !== 409) renovadaEm.delete(host);
    return false;
  } catch (e) { log(`[licenca] ${host}: renovação falhou (${e instanceof Error ? e.message : String(e)})`); renovadaEm.delete(host); return false; }
}
