/**
 * WhatsApp do agente da máquina: a fachada que o IPC e o resto do app chamam. O app não pressupõe o motor: a regra
 * única (WA_MOTOR_SH) diz qual é, e cada motor (whatsapp-openclaw.ts, whatsapp-hermes.ts, whatsapp-picoclaw.ts) implementa
 * o mesmo contrato (whatsapp-motor.ts). Os scripts de status, lista, grupos e logout continuam UMA viagem de SSH: aqui
 * se monta `case "$MOTOR"` com o fragmento de cada motor, e o parse é despachado pelo `gateway=` que o fragmento imprime.
 * O que é decidido pelos dados (chaves de sessão do Hermes vs. do OpenClaw) fica aqui; o IO de cada motor, no adaptador.
 * Capacidades: a tabela de whatsapp-capacidades.ts decide o que a tela pode oferecer, nunca o nome do motor.
 */
import type { Gateway, WhatsappAgente, WhatsappAlvo, WhatsappAlvoResolvido, WhatsappChat, WhatsappGroupPatch, WhatsappGroups, WhatsappReplyChoice, WhatsappStatus, WhatsappThreadMessage } from "../../shared/ipc";
import { agenteEscolhido, alvoSemAlias, alvoValido, capacidadesDe, parseAlvo, resolverAlvo, WA_AGENTE_FILE, WA_ALVO_FILE, WA_ALVO_SH, WA_MOTOR_SH } from "./whatsapp-capacidades";
import { listSshHostInfos } from "../maquina/sshConfig";
import { ownSessionKeys, grupoToMarkdown, SAFE_KEY, threadToMarkdown, whatsappContextNote } from "./whatsapp-chats";
import { WA_MARKS_FILE, waMarkSh, type WaDonoPatch, type WaGroupMarkPatch, type WaMarkPatch } from "./whatsapp-marks";
import { HERMES_ID_RE, isHermesKey } from "./whatsapp-hermes-core";
import { SEND_POLICY_READ_SH, type PauseBy } from "./whatsapp-pause";
import { createFromWhatsapp, type StoredConversation } from "../conversa/conversation";
import { log } from "../maquina/backend";
import { hermesAudioStatus } from "./hermes-audio";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";
import { runSsh } from "./whatsapp-ssh";
import { jsonOr, kvOf, kvTrimOf } from "./whatsapp-kv";
import { CHATS_VALIDADE_MS, GROUPS_VALIDADE_MS, STATUS_VALIDADE_MS, alvoByHost, chatsCache, esquecerWhatsapp, gatewayByHost, groupsCache, namesOf, statusCache, whatsappPausaModoOf } from "./whatsapp-estado";
import { MOTORES, motorDe, motorPorNome, type MotorWhatsapp } from "./whatsapp-motor";
import { pairingInProgress } from "./whatsapp-pair";

// O que o resto do app importa daqui (IPC, admin, licença, objetivo, CRM…): o executor e os miúdos dos motores.
export { runSsh, scpPara } from "./whatsapp-ssh";
export { CREDS_ME, NON_OWNER_DENY, SELF_POLICY_SH, ownerLockSh } from "./whatsapp-openclaw-core";
export { picoclawStatus } from "./whatsapp-picoclaw";
export { esquecerWhatsapp, whatsappGatewayOf, whatsappPausaModoOf } from "./whatsapp-estado";
export { cancelPairing, pairingInProgress, startPairing } from "./whatsapp-pair";

/** Um script por motor, numa viagem só: `case "$MOTOR"` com o fragmento de cada um. */
const porMotor = (de: (m: MotorWhatsapp) => string, resto = ""): string => `case "$MOTOR" in\nhermes)\n${de(MOTORES.hermes)}\n;;\nopenclaw)\n${de(MOTORES.openclaw)}\n;;\npicoclaw)\n${de(MOTORES.picoclaw)}\n;;\n${resto === "" ? "" : `*)\n${resto}\n;;\n`}esac`;
/** O motor que o script disse ter atendido (`gateway=`), guardado para as próximas chamadas. */
const motorDoScript = (host: string, kv: Map<string, string>): MotorWhatsapp | null => {
  const g = agenteEscolhido(kv.get("gateway")?.trim());
  if (g !== null) gatewayByHost.set(host, g);
  return motorPorNome(g);
};
const ultimaLinha = (s: string): string => s.trim().split("\n").pop() ?? "";

export const STATUS_SCRIPT = `
export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$HOME/bin:$PATH
${WA_MOTOR_SH}
echo "escolha=$ESC"
${WA_ALVO_SH}
${porMotor((m) => m.statusSh)}
echo present=0
`;

export function whatsappStatus(host: string, opts: { force?: boolean } = {}): Promise<WhatsappStatus> {
  return statusCache.get(host, STATUS_VALIDADE_MS, () => lerStatusCompleto(host), opts.force === true);
}
/**
 * Estado do WhatsApp da máquina, já com as capacidades anexadas. O invólucro existe para que as capacidades sejam
 * derivadas num ponto só: cada motor devolve o que sabe do seu mundo, e quem decide o que a tela pode oferecer é a
 * tabela de capacidades, não o motor.
 */
async function lerStatusCompleto(host: string): Promise<WhatsappStatus> {
  const st = await lerWhatsappStatus(host);
  // Hermes: ouvir e responder em áudio moram no config.yaml dele (hermes-audio.ts); uma leitura a mais, só com o WhatsApp pronto.
  const audio = st.gateway === "hermes" && st.ready ? await hermesAudioStatus(host) : null;
  const proprio = st.alvo?.proprio !== false;
  return { ...st, ...(audio === null ? {} : { audioIn: audio.audioIn, audioOut: audio.audioOut }), capacidades: capacidadesDe(st.gateway, st.ready, st.connected, { pausaModo: whatsappPausaModoOf(host), proprio }) };
}
/** O alvo que a máquina gravou (whatsapp-alvo.json), resolvido neste Mac e guardado para as próximas chamadas. */
function alvoDoScript(host: string, kv: Map<string, string>): WhatsappAlvoResolvido {
  const alvo = resolverAlvo(parseAlvo(jsonOr(kv.get("alvo"))), host, listSshHostInfos());
  alvoByHost.set(host, alvo);
  return alvo;
}
/** Onde vive o WhatsApp da máquina, pela última consulta; sem ela, o padrão (gateway próprio). */
export const whatsappAlvoDe = (host: string): WhatsappAlvoResolvido => alvoByHost.get(host) ?? { accountId: "default", agentId: "main", gatewayUser: null, gatewayHost: null, proprio: true };
async function lerWhatsappStatus(host: string): Promise<Omit<WhatsappStatus, "capacidades">> {
  const none: Omit<WhatsappStatus, "capacidades"> = { present: false, gateway: null, agent: "", ready: false, missing: null, connected: false, state: "ausente", number: null, loggedOut: false, detail: "", dmPolicy: null, channelConfig: null };
  if (host === LOCAL_HOST || !isValidHost(host)) return none;
  // Normalmente segundos; com o conserto do gateway (gw_fix: install --force + espera) passa de um minuto.
  const r = await runSsh(host, STATUS_SCRIPT, 240_000);
  if (r.code !== 0) return { ...none, detail: `não consegui consultar: ${ultimaLinha(r.stderr) || "ssh falhou"}` };
  const kv = kvTrimOf(r.stdout);
  const escolha = agenteEscolhido(kv.get("escolha"));
  const alvo = alvoDoScript(host, kv);
  if (kv.get("present") !== "1") return { ...none, escolha };
  const motor = motorDoScript(host, kv);
  if (motor === null) return { ...none, escolha };
  const st = { ...motor.parseStatus(host, kv), escolha };
  if (motor.nome !== "openclaw" || alvo.proprio) return st;
  // Conta num gateway de outro usuário da máquina: a tela diz onde o WhatsApp vive; sem alias para o gateway, o que falta.
  const semAlias = alvoSemAlias(alvo);
  const agent = `${st.agent} · gateway de ${alvo.gatewayUser ?? "?"}${alvo.gatewayHost === null ? "" : ` (${alvo.gatewayHost})`}, conta ${alvo.accountId}, agente ${alvo.agentId}`;
  return { ...st, agent, alvo, ...(semAlias === null ? {} : { ready: false, missing: [st.missing, semAlias].filter((x) => x !== null).join("\n") }) };
}

/**
 * Grava na máquina onde vive o WhatsApp dela (whatsapp-alvo.json): conta e agente no gateway de outro usuário, ou null
 * para voltar ao padrão (gateway próprio). Só muda o arquivo: registrar a conta no gateway é o passo do admin.
 */
export async function whatsappDefinirAlvo(host: string, alvo: WhatsappAlvo | null): Promise<WhatsappStatus> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  if (alvo !== null) { const erro = alvoValido(alvo); if (erro !== null) throw new Error(erro); }
  const b64 = alvo === null ? "" : Buffer.from(JSON.stringify(alvo), "utf8").toString("base64");
  const script = alvo === null
    ? `rm -f "${WA_ALVO_FILE}" && echo ALVO=1
`
    : `umask 077; mkdir -p "$(dirname "${WA_ALVO_FILE}")" && printf '%s' '${b64}' | base64 -d > "${WA_ALVO_FILE}.tmp" && mv "${WA_ALVO_FILE}.tmp" "${WA_ALVO_FILE}" && echo ALVO=1
`;
  const r = await runSsh(host, script, 20_000);
  if (!r.stdout.includes("ALVO=1")) throw new Error(`não consegui gravar o alvo na máquina: ${ultimaLinha(r.stderr) || "ssh falhou"}`);
  alvoByHost.delete(host); esquecerWhatsapp(host);
  log(`[whatsapp] ${host}: alvo ${alvo === null ? "padrão (gateway próprio)" : `conta ${alvo.accountId}, agente ${alvo.agentId}, gateway de ${alvo.gatewayUser ?? "(próprio)"}`}`);
  return whatsappStatus(host);
}

/**
 * Grava qual agente atende o WhatsApp desta máquina. Trocar com um número conectado no outro desconecta esse número
 * antes (os dois no mesmo número responderiam em dobro); o QR é lido de novo no agente novo.
 */
export async function whatsappEscolherAgente(host: string, agente: WhatsappAgente): Promise<WhatsappStatus> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  const antes = await whatsappStatus(host);
  if (antes.present && antes.gateway !== agente && (antes.gateway === "hermes" || antes.gateway === "openclaw") && antes.number !== null) await whatsappLogout(host, antes.gateway);
  const r = await runSsh(host, `mkdir -p "$(dirname "${WA_AGENTE_FILE}")" && printf '%s\n' ${agente} > "${WA_AGENTE_FILE}" && echo OK=1\n`, 20_000);
  if (!r.stdout.includes("OK=1")) throw new Error(`não consegui gravar a escolha na máquina: ${ultimaLinha(r.stderr) || "ssh falhou"}`);
  gatewayByHost.delete(host); esquecerWhatsapp(host);
  log(`[whatsapp] ${host}: agente escolhido ${agente}${antes.gateway !== null && antes.gateway !== agente ? ` (antes ${antes.gateway})` : ""}`);
  return whatsappStatus(host);
}

/** O motor da máquina, só os que deixam mudar quem responde e o dono pelo app. */
async function motorQueResponde(host: string, oque: string): Promise<MotorWhatsapp> {
  const m = await motorDe(host);
  if (m.nome !== "hermes" && m.nome !== "openclaw") throw new Error(`esta máquina (${m.nome}) não permite ${oque} pelo app`);
  return m;
}

/** Quem o agente responde nas DMs (whatsapp-motor.ts › setDmPolicy de cada motor). Devolve o estado novo. */
export async function setDmPolicy(host: string, policy: WhatsappReplyChoice, numbers: readonly string[] = []): Promise<WhatsappStatus> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  const motor = await motorQueResponde(host, "escolher quem responde");
  await motor.setDmPolicy(host, policy, numbers, {});
  esquecerWhatsapp(host);
  return whatsappStatus(host);
}

/**
 * Define quem manda no agente desta máquina (null = volta ao número pareado): grava a marca, reaplica "quem responde"
 * com o dono dentro (no Hermes, "só eu" com dono de fora vira bot + allowlist) e, no Hermes, aponta o home channel
 * para ele (reinicia o gateway). Devolve o estado novo.
 */
export async function whatsappSetDono(host: string, numero: string | null): Promise<WhatsappStatus> {
  esquecerWhatsapp(host);
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  if (numero !== null && !/^\d{8,15}$/.test(numero)) throw new Error("número inválido (só dígitos, com DDI, 8 a 15)");
  const motor = await motorQueResponde(host, "definir o dono");
  const antes = await motor.readQuem(host);
  if (numero !== null && numero === antes.self) numero = null; // o pareado é o padrão: gravar explícito só confunde
  await whatsappSetMarks(host, [{ dono: numero ?? "" }]);
  const st = await whatsappStatus(host);
  const quem = { self: st.number, dono: numero ?? st.number };
  // Mesma leitura dos cartões (renderer/lib/whatsapp-resposta.ts replyChoiceOf/listedNumbers): fora o aparelho e o dono, o que sobra é "lista".
  const fora = (donos: readonly (string | null)[]): string[] => [...new Set((st.allowFrom ?? []).filter((n) => n !== "*").map((n) => n.replace(/\D/g, "")).filter((n) => n !== "" && !donos.includes(n)))];
  const choice: WhatsappReplyChoice = st.dmPolicy === "open" ? "open" : st.dmPolicy !== "allowlist" ? "self" : fora([antes.self, antes.dono]).length > 0 ? "list" : "self";
  const numbers = fora([quem.self, quem.dono]);
  const nome = st.dono?.numero === quem.dono ? st.dono.nome : null;
  log(`[whatsapp] ${host}: dono ${numero === null ? "volta ao pareado" : `+${numero}`} (antes ${antes.dono ?? "?"}); reaplicando ${choice}`);
  await motor.setDmPolicy(host, choice, numbers, motor.nome === "hermes" && quem.dono !== null ? { home: { numero: quem.dono, nome } } : {});
  esquecerWhatsapp(host);
  return whatsappStatus(host);
}

// ---- Espelho só-leitura das conversas do WhatsApp. O parse fica em whatsapp-chats.ts (OpenClaw) e
// whatsapp-hermes-core.ts (Hermes); aqui só o script, o despacho e as marcas da máquina.
export function whatsappChats(host: string, opts: { force?: boolean } = {}): Promise<WhatsappChat[]> {
  return chatsCache.get(host, CHATS_VALIDADE_MS, () => lerChats(host), opts.force === true);
}
async function lerChats(host: string): Promise<WhatsappChat[]> {
  if (host === LOCAL_HOST || !isValidHost(host)) return [];
  // Arquivado/excluído/nomes moram na máquina (whatsapp-lista.json), na mesma leitura: os dois apps veem a mesma lista.
  // A lista de pausados do openclaw.json (sendPolicy) vem junto; o Hermes a ignora.
  const script = `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH
${WA_MOTOR_SH}
${porMotor((m) => m.chatsSh, MOTORES.openclaw.chatsSh)}
echo "marks=$(cat "${WA_MARKS_FILE}" 2>/dev/null | tr -d '\n')"
${SEND_POLICY_READ_SH}
`;
  const r = await runSsh(host, script, 60_000);
  if (r.code !== 0) throw new Error(`não consegui ler as conversas do WhatsApp: ${ultimaLinha(r.stderr) || "ssh falhou"}`);
  const kv = kvOf(r.stdout);
  const motor = motorDoScript(host, kv) ?? MOTORES.openclaw;
  return motor.parseChats(host, kv);
}

/**
 * Nomes dos contatos ainda sem nome, de uma vez: lê o histórico recente de cada um (a sessão própria; sem ela, a
 * principal, uma vez só), tira o pushname com `threadFor` e guarda na máquina para as próximas aberturas, dos dois
 * apps. Devolve só os achados. Quem não escreveu ainda fica sem nome (a tela não insiste nesta abertura).
 */
export async function whatsappLearnNames(host: string, numbers: readonly string[]): Promise<Record<string, string>> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  const want = [...new Set(numbers.map((n) => n.replace(/\D/g, "")))].filter((n) => /^\d{8,15}$/.test(n)).slice(0, 20);
  if (want.length === 0) return {};
  const chats = await whatsappChats(host);
  // Hermes: o nome é o display_name da sessão, já na lista; não há histórico do OpenClaw para ler.
  if (chats.some((c) => c.sessionKeys.some(isHermesKey))) return {};
  const found = await (await motorDe(host)).learnNames(host, chats, want);
  const names = namesOf(host);
  for (const [n, name] of Object.entries(found)) names.set(n, name);
  const patches = Object.entries(found).map(([number, name]) => ({ number, name }));
  if (patches.length > 0) await whatsappSetMarks(host, patches).catch((e: unknown) => log(`whatsapp: nomes não gravados em ${host}: ${e instanceof Error ? e.message : String(e)}`));
  log(`whatsapp: nomes descobertos em ${host}: ${patches.length} de ${want.length}`);
  return found;
}

/** Grava na máquina os ajustes de arquivado/excluído, de conversas e de grupos (merge lá, para o admin e a pessoa não se sobrescreverem). */
export async function whatsappSetMarks(host: string, patches: readonly (WaMarkPatch | WaGroupMarkPatch | WaDonoPatch)[]): Promise<void> {
  esquecerWhatsapp(host);
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  const r = await runSsh(host, waMarkSh(patches), 20_000);
  if (r.code !== 0 || !r.stdout.includes("MARKS=1")) throw new Error(`não deu para gravar na máquina: ${ultimaLinha(r.stderr) || "ssh falhou"}`);
  log(`whatsapp: marcações gravadas em ${host}: ${patches.map((p) => ("dono" in p ? `dono=${p.dono === "" ? "(pareado)" : `+${p.dono}`}` : "jid" in p ? `grupo ${p.jid}${p.deleted !== undefined ? ` d=${p.deleted}` : ""}${p.alias !== undefined ? ` apelido=${p.alias === "" ? "(apagado)" : "sim"}` : ""}` : `${p.number}${p.archived !== undefined ? ` a=${p.archived}` : ""}${p.deleted !== undefined ? ` d=${p.deleted}` : ""}`)).join(", ")}`);
}

export async function whatsappThread(host: string, number: string, limit = 200): Promise<WhatsappThreadMessage[]> {
  if (host === LOCAL_HOST || !isValidHost(host)) return [];
  const want = number.replace(/\D/g, "");
  if (want.length < 8) throw new Error("número inválido");
  const chat = (await whatsappChats(host)).find((c) => c.number === want);
  if (chat === undefined) return [];
  // Hermes pelas chaves ou pelo motor da máquina: quem só escreveu durante a pausa ainda não tem sessão.
  const motor = chat.sessionKeys.some(isHermesKey) ? MOTORES.hermes : await motorDe(host);
  const t = await motor.thread(host, chat, limit);
  // Pushname novo ou mudado: memória e cache na máquina acompanham (em segundo plano; a conversa já está lida).
  if (t.name !== null && namesOf(host).get(want) !== t.name) {
    namesOf(host).set(want, t.name);
    void whatsappSetMarks(host, [{ number: want, name: t.name }]).catch(() => { /* cache é opcional */ });
  }
  return t.messages;
}

/**
 * "Conversar com o meu-bot" (menu "…"): conversa nova do meu-bot nesta máquina com a conversa do WhatsApp
 * como contexto. Relê o histórico aqui (a fonte é o gateway, não o que o renderer mostrou).
 */
export async function whatsappBranch(host: string, number: string): Promise<StoredConversation> {
  const want = number.replace(/\D/g, "");
  const msgs = await whatsappThread(host, want);
  if (msgs.length === 0) throw new Error("não há mensagens para levar");
  // O título da conversa nova usa o apelido que a pessoa deu, se houver; senão o pushname; senão o número.
  const chat = (await whatsappChats(host).catch(() => [] as WhatsappChat[])).find((c) => c.number === want);
  const name = chat?.alias ?? namesOf(host).get(want) ?? `+${want}`;
  const ctx = whatsappContextNote(name, want, msgs);
  log(`whatsapp: conversa nova do meu-bot com ${ctx.count} mensagens de +${want} em ${host}`);
  return createFromWhatsapp(host, { number: want, name, count: ctx.count, until: msgs.at(-1)!.at, messages: msgs.slice(msgs.length - ctx.count) }, ctx.note);
}

/** Conversa inteira para exportar: Markdown legível ou JSON com contato, máquina e mensagens. */
export async function whatsappExportBody(host: string, number: string, format: "md" | "json", limit = 200): Promise<{ name: string; body: string; messages: WhatsappThreadMessage[] }> {
  const want = number.replace(/\D/g, "");
  const messages = await whatsappThread(host, want, limit);
  const name = namesOf(host).get(want) ?? `+${want}`;
  const exportedAt = new Date().toISOString();
  const body = format === "md"
    ? threadToMarkdown(name, want, host, messages, exportedAt)
    : `${JSON.stringify({ channel: "whatsapp", contact: { name, number: `+${want}` }, host, exportedAt, messages }, null, 2)}\n`;
  return { name, body, messages };
}

/** Transcrição de um grupo para guardar no CRM, no mesmo formato do export de contato. */
export async function whatsappGroupExportBody(host: string, jid: string, limit = 200): Promise<{ nome: string; body: string; messages: WhatsappThreadMessage[] }> {
  const messages = await whatsappGroupThread(host, jid, limit);
  const g = (await whatsappGroups(host)).grupos.find((x) => x.jid === jid);
  const nome = g?.nome ?? jid;
  return { nome, body: grupoToMarkdown(nome, jid, host, messages, new Date().toISOString()), messages };
}

/** O que "Limpar histórico" de um grupo vai zerar: a sessão do agente nele (grupo não tem sessão principal). No Hermes, uma por remetente. */
export async function whatsappGroupClearPlan(host: string, jid: string): Promise<{ sessoes: number }> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  return (await motorDe(host)).groupClearPlan(host, jid, () => whatsappGroups(host));
}

/** Zera a sessão do agente no grupo (a mesma chamada de limpar do contato, ou o encerrar do Hermes). */
export async function whatsappGroupClear(host: string, jid: string): Promise<void> {
  esquecerWhatsapp(host);
  await (await motorDe(host)).groupClear(host, jid, () => whatsappGroups(host));
}

/** O que "Limpar histórico" vai zerar: sessões só do contato e, se houver, a principal (de todos); e se ele está pausado. */
export async function whatsappClearPlan(host: string, number: string): Promise<{ own: string[]; shared: string[]; paused: boolean }> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  const want = number.replace(/\D/g, "");
  const chat = (await whatsappChats(host)).find((c) => c.number === want);
  // Hermes: a sessão é sempre só do contato; o que se limpa é o id da sessão viva (não há "principal" compartilhada).
  if (chat !== undefined && chat.sessionKeys.some(isHermesKey)) return { own: Object.values(chat.sessionIds).filter((id) => HERMES_ID_RE.test(id)), shared: [], paused: false };
  const keys = (chat?.sessionKeys ?? []).filter((k) => SAFE_KEY.test(k));
  const own = ownSessionKeys(want, keys);
  return { own, shared: keys.filter((k) => !own.includes(k)), paused: chat?.paused === true };
}

/** Zera sessões: ids do Hermes (sem ":") pelo próprio Hermes; chaves do OpenClaw pelo gateway. As chaves dizem o motor. */
export async function whatsappClearSessions(host: string, keys: readonly string[]): Promise<void> {
  esquecerWhatsapp(host);
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  const safe = keys.filter((k) => SAFE_KEY.test(k));
  if (safe.length === 0) throw new Error("não há histórico desta conversa na máquina");
  const motor = safe.every((k) => HERMES_ID_RE.test(k) && !k.includes(":")) ? MOTORES.hermes : MOTORES.openclaw;
  await motor.clearSessions(host, safe);
}

/**
 * Pausa ou retoma o agente para um contato. OpenClaw: `sendPolicy` da sessão só dele (`deny` = o OpenClaw não entrega
 * respostas nem mostra "digitando"; `null` volta à regra geral) mais a lista durável do openclaw.json, uma nota na
 * conversa e a regra no AGENTS.md (whatsapp-pause.ts). Hermes: a marca na máquina (com o plugin de pausa) ou a lista
 * do .env com reinício. O dono nunca é pausado.
 */
export async function whatsappPause(host: string, number: string, paused: boolean, by: PauseBy, horas?: 2 | 24): Promise<void> {
  esquecerWhatsapp(host);
  const want = number.replace(/\D/g, "");
  await (await motorDe(host)).pause(host, want, paused, by, horas, () => whatsappClearPlan(host, want));
}

/**
 * Contato pausado que vai ter a conversa limpa: garante a regra dele na lista durável antes (pausas
 * antigas só tinham a marca na sessão, que o reset leva). Já na lista: não grava nada.
 */
export async function whatsappKeepPaused(host: string, number: string, own: readonly string[]): Promise<void> {
  esquecerWhatsapp(host);
  await (await motorDe(host)).keepPaused(host, number.replace(/\D/g, ""), own);
}

/**
 * Desconecta o número desta máquina sem parear de novo. OpenClaw: `channels logout` (apaga as credenciais;
 * o gateway para o canal). Hermes: guarda a sessão como session.loggedout-… com o gateway parado.
 */
export async function whatsappLogout(host: string, qual?: WhatsappAgente): Promise<void> {
  esquecerWhatsapp(host);
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  if (pairingInProgress() !== null) throw new Error("há um pareamento em andamento; feche o QR antes de desconectar");
  // `qual`: desconecta esse agente mesmo que a escolha gravada já seja outra (trocar de agente).
  const script = `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$HOME/bin:$PATH
${WA_MOTOR_SH}
${qual === undefined ? "" : `MOTOR=${qual}`}
${porMotor((m) => m.logoutSh, "echo OUT=none")}
`;
  const r = await runSsh(host, script, 90_000);
  const out = /OUT=(\w+)/.exec(r.stdout)?.[1];
  if (out === "none") throw new Error("não achei WhatsApp configurado nesta máquina");
  if (out === "still" || out === undefined) throw new Error(`não consegui desconectar${r.stderr.trim() !== "" ? `: ${ultimaLinha(r.stderr)}` : ""}`);
  log(`[whatsapp] desconectado em ${host} (${out})`);
}

// ── Grupos (área "Grupos" da lista e tutorial 11). As regras ficam em whatsapp-grupos-core.ts (e no core do Hermes). ──
export function whatsappGroups(host: string, opts: { force?: boolean } = {}): Promise<WhatsappGroups> {
  return groupsCache.get(host, GROUPS_VALIDADE_MS, () => lerGroups(host), opts.force === true);
}
/** Grupos da máquina: sessões de grupo, a config de grupos e o cache da skill, numa leitura só. */
async function lerGroups(host: string): Promise<WhatsappGroups> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  const script = `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH
${WA_MOTOR_SH}
${porMotor((m) => m.groupsSh, MOTORES.openclaw.groupsSh)}
echo "marks=$(cat "${WA_MARKS_FILE}" 2>/dev/null | tr -d '\n')"
`;
  const r = await runSsh(host, script, 60_000);
  if (r.code !== 0) throw new Error(`não consegui ler os grupos do WhatsApp: ${ultimaLinha(r.stderr) || "ssh falhou"}`);
  const kv = kvOf(r.stdout);
  const motor = motorDoScript(host, kv) ?? MOTORES.openclaw;
  return motor.parseGroups(host, kv);
}

/** Conversa de um grupo (só leitura), com o autor de cada mensagem. */
export async function whatsappGroupThread(host: string, jid: string, limit = 200): Promise<WhatsappThreadMessage[]> {
  if (!/^\d{6,30}@g\.us$/.test(jid)) throw new Error("grupo inválido");
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  const n = Math.min(1000, Math.max(1, Math.trunc(limit)));
  return (await motorDe(host)).groupThread(host, jid, n, () => whatsappGroups(host));
}

/** Liga/desliga o agente num grupo e/ou muda quem o aciona. Devolve os grupos já com a mudança. */
export async function whatsappSetGroup(host: string, jid: string, pedido: WhatsappGroupPatch): Promise<WhatsappGroups> {
  esquecerWhatsapp(host);
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  if (!/^\d{6,30}@g\.us$/.test(jid)) throw new Error("grupo inválido");
  return (await motorDe(host)).setGroup(host, jid, pedido, () => whatsappGroups(host, { force: true }));
}

/**
 * Atualiza a lista de grupos pelo WhatsApp (skill whatsapp-grupos no OpenClaw; o bridge no Hermes). PARA o gateway
 * ~30 s (o WhatsApp do agente fica parado; as mensagens chegam quando ele volta): a tela pede confirmação antes.
 */
export async function whatsappRefreshGroups(host: string): Promise<WhatsappGroups> {
  esquecerWhatsapp(host);
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("este Mac não tem agente com WhatsApp");
  await (await motorDe(host)).refreshGroups(host);
  esquecerWhatsapp(host);
  return whatsappGroups(host);
}

// Tipos que o IPC usa por este módulo.
export type { Gateway };
