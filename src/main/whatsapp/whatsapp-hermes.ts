/**
 * Hermes, o IO: o bridge do WhatsApp em ~/.hermes/whatsapp, o .env (quem responde), o config.yaml (grupos, áudio) e o
 * state.db (conversas), tudo por SSH. As regras puras estão em whatsapp-hermes-core.ts e whatsapp-hermes-pausa-core.ts;
 * o contrato é o MotorWhatsapp (whatsapp-motor.ts).
 */
import type { WhatsappChat, WhatsappGroupPatch, WhatsappGroups, WhatsappReplyChoice, WhatsappStatus, WhatsappThreadMessage } from "../../shared/ipc";
import type { Exec, MotorWhatsapp } from "./whatsapp-motor";
import { runSsh } from "./whatsapp-ssh";
import { describeInstall, jsonOr, kvOf, kvTrimOf, phoneOf } from "./whatsapp-kv";
import { namesOf, pausaModoByHost } from "./whatsapp-estado";
import { log } from "../maquina/backend";
import { politicaNaoBate } from "./whatsapp-chats";
import { JID_RE } from "./whatsapp-grupos-core";
import { HERMES_GRUPOS_LISTAR_SH, lerListagemHermes } from "./hermes-grupos-listar";
import { WA_MARKS_FILE, applyWaGroupMarks, applyWaMarks, donoStatus, donosDe, parseWaMarks, pausaVigente, pausadosDe, quemDe, waMarkSh, type WaQuem } from "./whatsapp-marks";
import { chatsComPausados, mensagensDaPausa, parsePausados, waPausadosSh } from "./whatsapp-pausados";
import { HERMES_DIR_SH, chatsFromHermes, gruposHermes, hermesPausaPlano, HERMES_END_SH, HERMES_GROUP_CFG_SH, HERMES_GROUPS_PY, hermesEstadoDoGrupo, hermesGroupCfgPara, hermesGroupCfgSetSh, parseHermesGroupCfg, HERMES_ID_RE, HERMES_LIST_PY, HERMES_SELF_SH, HERMES_THREAD_PY, hermesGroupSessions, threadFromHermes, type HermesGroupSession, HERMES_ENV_SET_PY, HERMES_ENV_VALUE_RE, HERMES_POLICY_PY, HERMES_PATH_SH, HERMES_BRIDGE_PORT_SH, HERMES_RESTART_SH, HERMES_WA_ENSURE_SH, hermesEnvOf, hermesEnvPara, hermesHomeChannelSh, hermesNaoResponde, hermesPausaModo, hermesPrecisaReiniciar, politicaHermes, HERMES_PAUSA_SH, type HermesWaEnv } from "./whatsapp-hermes-core";
import type { PauseBy } from "./whatsapp-pause";

const ultimaLinha = (s: string): string => s.trim().split("\n").pop() ?? "";

/** Ramo do STATUS_SCRIPT: versão, bridge, /health, sessão, "Logged out" no log, política do .env e modo de pausa. */
export const HERMES_STATUS_SH = `${HERMES_PATH_SH}
  S=$HOME/.hermes/whatsapp
  echo gateway=hermes; echo present=1
  echo "bin=$(command -v hermes 2>/dev/null)"
  echo "ver=$(hermes_version | head -1)"
  ${HERMES_DIR_SH}; B=$R/scripts/whatsapp-bridge
  [ -f "$B/bridge.js" ] && echo bridge=1 || echo bridge=0
  ${HERMES_BRIDGE_PORT_SH}
  echo "bridgeport=$HBP"
  echo "health=$(curl -s -m 3 http://127.0.0.1:$HBP/health 2>/dev/null | tr -d '\\n')"
  echo "me=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$S/session/creds.json" 2>/dev/null)"
  echo "loggedout=$(tail -8 "$S/bridge.log" 2>/dev/null | grep -c 'Logged out')"
  ${HERMES_POLICY_PY}
  ${HERMES_PAUSA_SH}
  echo "marks=$(cat "${WA_MARKS_FILE}" 2>/dev/null | tr -d '\\n')"
  exit 0`;

/** Ramo da lista de conversas: state.db em só-leitura, a política do .env, o modo de pausa e o que chegou na pausa. */
export const HERMES_CHATS_SH = `echo gateway=hermes
  echo "self=$(${HERMES_SELF_SH})"
  echo "list=$(${HERMES_LIST_PY} 2>/dev/null | tr -d '\\n')"
  ${HERMES_POLICY_PY}
  ${HERMES_PAUSA_SH}
  ${waPausadosSh()}`;

/** Ramo dos grupos: config.yaml (platforms.whatsapp), sessões de grupo do state.db, .env e o cache da skill. */
export const HERMES_GROUPS_SH = `echo gateway=hermes
  echo "skill=$([ -f "$HOME/.hermes/whatsapp/session/creds.json" ] && echo 1 || echo 0)"
  echo "self=$(${HERMES_SELF_SH})"
  echo "hgroups=$(${HERMES_GROUPS_PY} | tr -d '\\n')"
  ${HERMES_GROUP_CFG_SH}
  ${HERMES_POLICY_PY}
  echo "cache=$(cat "$HOME/.claude/skills/whatsapp-grupos/data/grupos-live.json" 2>/dev/null | tr -d '\\n')"`;

/**
 * Ramo do PAIR_SCRIPT: bridge oficial em modo `--pair-only --pair-json` (JSON por linha: started, qr, connected,
 * disconnected, error). Para o gateway durante o pareamento (senão o bridge dele disputa a sessão) e o sobe de novo no
 * fim ou no cancelamento (trap).
 */
export const HERMES_PAIR_SH = `S=$HOME/.hermes/whatsapp
command -v hermes >/dev/null 2>&1 || { echo '{"event":"error","error":"o Hermes não está instalado nesta máquina; use \\"Preparar\\" antes de gerar o QR"}'; exit 2; }
# O bridge é Node: o SSH não interativo nem sempre tem o Node no PATH (o Hermes traz o dele em ~/.hermes/tools).
${HERMES_PATH_SH}
command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || { echo '{"event":"error","error":"não achei o Node.js (node e npm) nesta máquina; o bridge do WhatsApp do Hermes precisa dele"}'; exit 2; }
${HERMES_DIR_SH}; B=$R/scripts/whatsapp-bridge
if [ ! -f "$B/bridge.js" ]; then echo '{"event":"error","error":"bridge do Hermes não encontrado nesta máquina"}'; exit 2; fi
# Hermes de todos (/opt/hermes): o root deixa as dependências prontas; este usuário não grava lá.
if [ ! -d "$B/node_modules" ] && [ ! -w "$B" ]; then echo '{"event":"error","error":"o Hermes desta máquina é compartilhado e o bridge do WhatsApp está sem as dependências: no meu-bot-admin, aba Usuários, use \\"Instalar Hermes para todos\\" de novo"}'; exit 2; fi
# Dependências do bridge (o "hermes whatsapp" faz o mesmo npm install na primeira vez).
if [ ! -d "$B/node_modules" ]; then
  echo '{"event":"meu-bot","step":"bridge-deps"}'
  ( cd "$B" && npm install --no-audit --no-fund >/dev/null 2>&1 ) || { echo '{"event":"error","error":"não consegui instalar as dependências do bridge do WhatsApp do Hermes (npm install)"}'; exit 2; }
fi
# O gateway do Hermes: serviço de usuário do systemd (o normal hoje), PM2 em instalações antigas, ou o próprio CLI.
if pm2 describe hermes-gateway >/dev/null 2>&1; then GW=pm2; elif systemctl --user cat hermes-gateway >/dev/null 2>&1; then GW=systemd; else GW=cli; fi
gw_stop() { case "$GW" in pm2) pm2 stop hermes-gateway ;; systemd) systemctl --user stop hermes-gateway ;; *) hermes gateway stop ;; esac >/dev/null 2>&1; }
gw_start() { case "$GW" in pm2) pm2 start hermes-gateway ;; systemd) systemctl --user reset-failed hermes-gateway; systemctl --user start hermes-gateway ;; *) hermes gateway start || hermes gateway install ;; esac >/dev/null 2>&1; }
gw_stop
echo '{"event":"meu-bot","step":"gateway-stopped"}'
hermes_wa_ensure() {
${HERMES_WA_ENSURE_SH}
}
restart() {
  # Pareou: liga o WhatsApp no .env e, sem modelo escolhido, responde pelo backend do meu-bot (HERMES_WA_ENSURE_SH).
  if [ -s "$S/session/creds.json" ]; then HWA=$(hermes_wa_ensure); echo '{"event":"meu-bot","step":"ensure"}'; echo "$HWA" >&2; fi
  gw_start
  # Hermes vindo do npm sem o ambiente de dependências: o serviço cai em loop pedindo "hermes pm repair". Conserta e sobe de novo.
  if [ "$GW" != pm2 ] && ! hermes_gw_ok && journalctl --user -u hermes-gateway -n 30 --no-pager 2>/dev/null | grep -q 'pm repair'; then
    echo '{"event":"meu-bot","step":"gateway-repair"}'
    timeout 600 hermes pm repair >/dev/null 2>&1
    gw_stop; gw_start
    hermes_gw_ok || echo '{"event":"meu-bot","step":"gateway-down"}'
  fi
  echo '{"event":"meu-bot","step":"gateway-started"}'
}
# O bridge do gateway responde /health em até ~30 s depois de subir.
hermes_gw_ok() { ${HERMES_BRIDGE_PORT_SH}; i=0; while [ $i -lt 15 ]; do curl -s -m 2 http://127.0.0.1:$HBP/health 2>/dev/null | grep -q '"status"' && return 0; sleep 2; i=$((i+1)); done; return 1; }
# Sessão que o celular desconectou ("Logged out" no bridge.log): o bridge a reusaria, levaria 401 e sairia sem QR.
# Vale o mesmo que pedir sessão nova: ela vai para o lado (não apaga) e o QR sai do zero.
if [ "$RESET" != "1" ] && [ -d "$S/session" ] && tail -8 "$S/bridge.log" 2>/dev/null | grep -q 'Logged out'; then RESET=1; fi
if [ "$RESET" = "1" ] && [ -d "$S/session" ]; then mv "$S/session" "$S/session.loggedout-$(date +%s)"; echo '{"event":"meu-bot","step":"session-moved"}'; fi
mkdir -p "$S/session"
cd "$B" || { restart; exit 2; }
node bridge.js --pair-only --pair-json --session "$S/session" --mode bot 2>&1 &
NODE=$!
# O bridge só diz "connected" quando a conexão inteira fecha (5–20 s depois da leitura). Vinculou de verdade quando o
# creds.json ganhou o número depois de o pareamento começar: o mesmo vigia do OpenClaw, para o ✓ vir na hora.
CREDS=$S/session/creds.json; T0=$(date +%s)
linked_now() { [ -f "$CREDS" ] || return 1; [ "$(stat -c %Y "$CREDS" 2>/dev/null || echo 0)" -ge "$T0" ] || return 1; ME=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$CREDS" 2>/dev/null); [ -n "$ME" ]; }
( while kill -0 $NODE 2>/dev/null; do if linked_now; then echo "{\\"event\\":\\"connected\\",\\"user\\":{\\"id\\":\\"$ME\\"}}"; break; fi; sleep 1; done ) & W=$!
trap 'kill $NODE $W 2>/dev/null; restart; exit 130' HUP TERM INT
# O sleep do cronômetro não pode herdar a saída: um sleep órfão seguraria o ssh aberto até o fim dos 5 min.
( sleep 300 >/dev/null 2>&1; kill $NODE 2>/dev/null ) >/dev/null 2>&1 & T=$!
wait $NODE; rc=$?
pkill -P $T 2>/dev/null; pkill -P $W 2>/dev/null; kill $T $W 2>/dev/null
trap - HUP TERM INT
restart
exit $rc`;

/** Ramo do logout: guarda a sessão como session.loggedout-… com o gateway parado. */
export const HERMES_LOGOUT_SH = `S=$HOME/.hermes/whatsapp
${HERMES_PATH_SH}
[ -d "$S/session" ] || { echo OUT=hermes; exit 0; }
if pm2 describe hermes-gateway >/dev/null 2>&1; then GW=pm2; elif systemctl --user cat hermes-gateway >/dev/null 2>&1; then GW=systemd; else GW=cli; fi
case "$GW" in pm2) pm2 stop hermes-gateway ;; systemd) systemctl --user stop hermes-gateway ;; *) hermes gateway stop ;; esac >/dev/null 2>&1
mv "$S/session" "$S/session.loggedout-$(date +%s)"
case "$GW" in pm2) pm2 start hermes-gateway ;; systemd) systemctl --user start hermes-gateway ;; *) hermes gateway start ;; esac >/dev/null 2>&1
echo OUT=hermes; exit 0`;

export function criarMotorHermes(run: Exec = runSsh): MotorWhatsapp {
  /** Número pareado no Hermes (creds.json do bridge); null sem sessão. */
  const readSelfNumber = async (host: string): Promise<string | null> => phoneOf((await run(host, `${HERMES_SELF_SH}\n`, 15_000)).stdout.trim());
  const readQuem = async (host: string): Promise<WaQuem> => {
    const r = await run(host, `echo "self=$(${HERMES_SELF_SH})"\necho "marks=$(cat "${WA_MARKS_FILE}" 2>/dev/null | tr -d '\\n')"\n`, 20_000);
    const kv = kvOf(r.stdout);
    return quemDe(parseWaMarks(jsonOr(kv.get("marks"))), phoneOf(kv.get("self") ?? ""));
  };
  /** Sessões de um grupo no Hermes (todas; `ended` marca as já encerradas). */
  const groupSessionsOf = async (host: string, jid: string): Promise<HermesGroupSession[]> => {
    if (!JID_RE.test(jid)) throw new Error("grupo inválido");
    const r = await run(host, `${HERMES_GROUPS_PY} 2>/dev/null\n`, 60_000);
    if (r.code !== 0) throw new Error(`não consegui ler as sessões do grupo: ${ultimaLinha(r.stderr) || "ssh falhou"}`);
    return hermesGroupSessions(jsonOr(r.stdout.trim()), jid);
  };
  /** Ids de sessão (sem ":"), encerrados pelo próprio Python do Hermes; o gateway abre outra na próxima mensagem. */
  const clearSessions = async (host: string, keys: readonly string[]): Promise<void> => {
    const safe = keys.filter((k) => HERMES_ID_RE.test(k) && !k.includes(":"));
    if (safe.length === 0) throw new Error("não há histórico desta conversa na máquina");
    const r = await run(host, `${HERMES_END_SH} ${safe.map((id) => `'${id}'`).join(" ")}\n`, 120_000);
    if (r.code !== 0 || !/^ok$/m.test(r.stdout)) throw new Error(`o Hermes não encerrou a sessão: ${ultimaLinha(r.stderr) || "sem resposta"}`);
    log(`whatsapp: histórico limpo em ${host} (hermes): ${safe.join(", ")}`);
  };
  /**
   * CONTORNO #1 (Hermes): sem pausa por contato (NousResearch/hermes-agent#146672), pausar é tirar o número da
   * WHATSAPP_ALLOWED_USERS e reiniciar o gateway (whatsapp-hermes-core.ts hermesPausaPlano); o agente nem vê as
   * mensagens nesse período. Confere a lista relida antes de devolver (a marca só vale depois de a lista valer).
   * Sai quando: toda máquina Hermes do mapa estiver com o plugin (pausaplugin) ou com pausanativa=1 — aí o ramo
   * "allowlist" de hermesPausaModo some e esta função com ele. Tabela: docs/guia/contornos.md.
   */
  const aplicarPlanoAllowlist = async (host: string, env: HermesWaEnv, quem: WaQuem, want: string, paused: boolean, pausados: readonly string[]): Promise<string> => {
    const { patch, reinicia } = hermesPausaPlano(env, quem, want, paused, pausados);
    for (const [k, v] of Object.entries(patch)) if (!HERMES_ENV_VALUE_RE.test(v)) throw new Error(`valor inválido para ${k}`);
    const args = Object.entries(patch).map(([k, v]) => `'${k}=${v}'`).join(" ");
    const r = await run(host, `set -e\n${HERMES_ENV_SET_PY} ${args}\n${reinicia ? HERMES_RESTART_SH : 'echo "restart=nao-precisou"'}\n${HERMES_POLICY_PY}\n`, 120_000);
    if (r.code !== 0 || !r.stdout.includes("envset=ok")) throw new Error(`não consegui gravar o .env do Hermes: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout) || "ssh falhou"}`);
    const restart = /restart=(.*)/.exec(r.stdout)?.[1]?.trim() ?? "";
    if (restart.startsWith("falhou")) throw new Error(`gravei, mas não consegui reiniciar o gateway do Hermes (${restart.slice(8)}); reinicie-o na máquina para valer`);
    const lista = (kvOf(r.stdout).get("waallow") ?? "").split(",").map((s) => s.trim());
    if (lista.includes(want) === paused) throw new Error(`a lista relida do Hermes não bate (${paused ? "o contato continua" : "o contato não voltou"}); tente de novo`);
    return restart;
  };
  /** Grava marcas na máquina (merge lá); a fachada tem o whatsappSetMarks com log; aqui é o mínimo para a pausa. */
  const gravarMarcas = async (host: string, patches: Parameters<typeof waMarkSh>[0]): Promise<void> => {
    const r = await run(host, waMarkSh(patches), 20_000);
    if (r.code !== 0 || !r.stdout.includes("MARKS=1")) throw new Error(`não deu para gravar na máquina: ${ultimaLinha(r.stderr) || "ssh falhou"}`);
  };

  const motor: MotorWhatsapp = {
    nome: "hermes",
    statusSh: HERMES_STATUS_SH,
    parseStatus: (host, kv): Omit<WhatsappStatus, "capacidades"> => {
      const gateway = "hermes" as const;
      const marks = parseWaMarks(jsonOr(kv.get("marks")));
      const agent = describeInstall("Hermes", kv);
      if ((kv.get("bin") ?? "") === "") return { present: true, gateway, agent: "Hermes (não instalado)", ready: false, missing: "o Hermes ainda não está instalado nesta máquina", connected: false, state: "sem instalar", number: null, loggedOut: false, detail: "Hermes escolhido, ainda não instalado", dmPolicy: null, channelConfig: null };
      const ready = kv.get("bridge") === "1";
      if (!ready) return { present: true, gateway, agent, ready, missing: "o bridge do WhatsApp não está nesta instalação do Hermes", connected: false, state: "sem bridge", number: null, loggedOut: false, detail: "Hermes sem o bridge do WhatsApp", dmPolicy: null, channelConfig: null };
      let state = "sem bridge";
      try { const h = JSON.parse(kv.get("health") || "{}") as { status?: unknown }; if (typeof h.status === "string") state = h.status; } catch { /* bridge fora do ar */ }
      const number = phoneOf(kv.get("me") ?? "");
      const loggedOut = Number(kv.get("loggedout") ?? "0") > 0;
      // O bridge do Hermes reporta "connected"/"disconnected" (não o "open" do Baileys).
      const connected = state === "connected" || state === "open";
      const detail = connected ? "conectado" : loggedOut ? "deslogado no WhatsApp; precisa parear de novo" : number === null ? "sem sessão; precisa parear" : `bridge ${state}`;
      // Quem o agente responde: o .env do Hermes, traduzido para o mesmo contrato do OpenClaw (whatsapp-hermes-core.ts).
      const env = hermesEnvOf(kv);
      const quem = quemDe(marks, number);
      const politica = politicaHermes(env, quem);
      const pausaModo = hermesPausaModo(kv);
      pausaModoByHost.set(host, pausaModo);
      // Sem o plugin, pausado = fora da lista gravada enquanto durar; para a tela ele continua "quem o agente responde".
      // Com o plugin a lista não muda ao pausar, então não há o que repor.
      const pausados = pausadosDe(marks);
      const allowFrom = politica.dmPolicy === "allowlist" && pausaModo === "allowlist" ? [...new Set([...politica.allowFrom, ...pausados.map((n) => `+${n}`)])] : politica.allowFrom;
      const channelConfig = JSON.stringify({ WHATSAPP_MODE: env.mode, WHATSAPP_DM_POLICY: env.dm, WHATSAPP_ALLOWED_USERS: env.allow, WHATSAPP_ALLOW_ALL_USERS: env.all, pausados, pausaModo }, null, 2);
      return { present: true, gateway, agent, ready, missing: null, connected, state, number, loggedOut, detail, dmPolicy: politica.dmPolicy, channelConfig, allowFrom, ...donoStatus(quem, marks) };
    },
    chatsSh: HERMES_CHATS_SH,
    parseChats: (host, kv) => {
      pausaModoByHost.set(host, hermesPausaModo(kv));
      let list: unknown = null;
      try { list = JSON.parse(kv.get("list") || "null"); } catch { throw new Error("não consegui ler o banco de sessões do Hermes (~/.hermes/state.db)"); }
      if (list === null) throw new Error("o Hermes desta máquina ainda não tem o banco de sessões (~/.hermes/state.db)");
      let marks: unknown = null;
      try { marks = JSON.parse(kv.get("marks") || "null"); } catch { /* arquivo corrompido = sem marcas */ }
      const parsed = parseWaMarks(marks);
      const names = namesOf(host);
      for (const [n, e] of Object.entries(parsed.names)) if (e.name !== null && !names.has(n)) names.set(n, e.name);
      // No Hermes "pausado" é a marca da máquina (fora da lista enquanto durar) e também quem a política de hoje não
      // responde ("só você" = todo mundo; lista = quem está fora): Retomar nesses põe o contato na lista.
      const quem = quemDe(parsed, phoneOf(kv.get("self") ?? ""));
      const env = hermesEnvOf(kv);
      const chats = chatsFromHermes(list, quem, names).map((c) => { const p = pausaVigente(parsed, c.number); return { ...c, paused: p !== null || hermesNaoResponde(env, quem, c.number), pausaAte: p?.ate ?? null }; });
      // O que chegou durante a pausa (plugin meu-bot-pausa) entra antes das marcas: mensagem nova traz excluída de volta.
      return applyWaMarks(chatsComPausados(chats, parsePausados(jsonOr(kv.get("pausados"))), parsed), parsed);
    },
    groupsSh: HERMES_GROUPS_SH,
    parseGroups: (_host, kv) => {
      const marks = parseWaMarks(jsonOr(kv.get("marks")));
      const self = phoneOf(kv.get("self") ?? "");
      const pol = politicaHermes(hermesEnvOf(kv), quemDe(marks, self));
      const quem: string[] | "todos" = pol.dmPolicy === "open" ? "todos" : pol.allowFrom.map((n) => n.replace(/\D/g, "")).filter((n) => n !== "");
      const g = gruposHermes(parseHermesGroupCfg(jsonOr(kv.get("gcfg"))), jsonOr(kv.get("hgroups")), self, quem, jsonOr(kv.get("cache")));
      // `skill` aqui = o bridge pareado: "Atualizar lista" lista pelo WhatsApp (hermes-grupos-listar.ts). Sem isto ficava
      // false e a tela desabilitava o botão com a dica "não está pareado" mesmo com a lista cheia.
      return { ...g, grupos: applyWaGroupMarks(g.grupos, marks), skill: kv.get("skill") === "1" };
    },
    pairSh: HERMES_PAIR_SH,
    logoutSh: HERMES_LOGOUT_SH,
    restartSh: HERMES_RESTART_SH,
    readQuem,
    /**
     * Conversa de um contato: as mensagens das sessões dele (state.db) mais o que chegou enquanto ele estava pausado
     * (whatsapp-pausados.jsonl, que o agente não viu), em ordem de hora. O nome vem na lista (display_name), não daqui.
     */
    thread: async (host, chat: WhatsappChat, limit) => {
      const ids = Object.values(chat.sessionIds).filter((id) => HERMES_ID_RE.test(id));
      const n = Math.min(1000, Math.max(1, Math.trunc(limit)));
      const thread = ids.length === 0 ? 'echo "thread=[]"' : `echo "thread=$(${HERMES_THREAD_PY} ${ids.map((id) => `'${id}'`).join(" ")} ${n} | tr -d '\\n')"`;
      const r = await run(host, `${thread}\n${waPausadosSh(chat.number)}\n`, 90_000);
      if (r.code !== 0) throw new Error(`não consegui ler a conversa: ${ultimaLinha(r.stderr) || "ssh falhou"}`);
      const kv = kvOf(r.stdout);
      let data: unknown;
      try { data = JSON.parse(kv.get("thread") || "null"); } catch { throw new Error("o banco de sessões do Hermes não respondeu"); }
      if (ids.length > 0 && data === null) throw new Error("o banco de sessões do Hermes não respondeu");
      const daPausa = mensagensDaPausa(parsePausados(jsonOr(kv.get("pausados"))), chat.number);
      return { messages: [...threadFromHermes(data), ...daPausa].sort((a, b) => a.at.localeCompare(b.at)), name: null };
    },
    // Hermes: o nome é o display_name da sessão, já na lista; não há histórico do OpenClaw para ler.
    learnNames: async () => ({}),
    clearSessions,
    /**
     * Pausa no Hermes, por dois caminhos conforme a máquina (whatsapp-hermes-core.ts hermesPausaModo):
     * - com o plugin meu-bot-pausa carregado (ou pausa nativa): só a marca em whatsapp-lista.json, com prazo se pedido;
     *   vale em qualquer política e sem reiniciar. Retomar quem a política de hoje não responde ("só você"/fora da lista)
     *   também o põe na lista, como a PR #16 fez para o menu.
     * - sem o plugin: tirar/devolver o contato na WHATSAPP_ALLOWED_USERS com reinício (aplicarPlanoAllowlist). Sem prazo:
     *   ninguém na máquina devolveria o contato ao vencer.
     */
    pause: async (host, want, paused, by: PauseBy, horas) => {
      if (!/^\d{8,15}$/.test(want)) throw new Error("número inválido");
      const self = await readSelfNumber(host);
      const antes = await run(host, `${HERMES_PATH_SH}\n${HERMES_POLICY_PY}\n${HERMES_PAUSA_SH}\necho "marks=$(cat "${WA_MARKS_FILE}" 2>/dev/null | tr -d '\\n')"\n`, 30_000);
      if (antes.code !== 0) throw new Error(`não consegui ler o .env do Hermes: ${ultimaLinha(antes.stderr) || ultimaLinha(antes.stdout) || "ssh falhou"}`);
      const kvAntes = kvOf(antes.stdout);
      const quem = quemDe(parseWaMarks(jsonOr(kvAntes.get("marks"))), self);
      if (donosDe(quem).includes(want)) throw new Error("o dono não é pausado: o agente sempre responde a ele. Para silenciar o agente para todos, use \"Quem o agente responde\"");
      const env = hermesEnvOf(kvAntes);
      const modo = hermesPausaModo(kvAntes);
      pausaModoByHost.set(host, modo);
      if (modo !== "allowlist") {
        if (modo === "nativa") log(`whatsapp: ${host} tem pausa nativa no Hermes; o app ainda usa a marca (docs/guia/contornos.md #2)`);
        await gravarMarcas(host, [{ number: want, paused, ...(paused && horas !== undefined ? { pausaHoras: horas } : {}) }]);
        if (!paused && hermesNaoResponde(env, quem, want)) await aplicarPlanoAllowlist(host, env, quem, want, false, []);
        log(`whatsapp: ${paused ? "pausado" : "retomado"} +${want} em ${host} (hermes/${modo}, ${by})${paused && horas !== undefined ? ` por ${horas} h` : ""}`);
        return;
      }
      if (horas !== undefined) throw new Error("pausa com prazo precisa do plugin de pausa do meu-bot nesta máquina (o app o instala ao abrir o WhatsApp); por ora use \"Até eu retomar\"");
      const pausados = pausadosDe(parseWaMarks(jsonOr(kvAntes.get("marks"))));
      const restart = await aplicarPlanoAllowlist(host, env, quem, want, paused, pausados);
      await gravarMarcas(host, [{ number: want, paused }]);
      log(`whatsapp: ${paused ? "pausado" : "retomado"} +${want} em ${host} (hermes/allowlist, ${by}): fora da lista enquanto durar; restart=${restart || "?"}`);
    },
    // Hermes: a pausa é a marca (ou a lista do .env); não há lista durável de sessões a preservar antes de limpar.
    keepPaused: async () => { /* nada a fazer */ },
    /**
     * Quem o agente responde numa máquina com Hermes: grava modo, política e lista em ~/.hermes/.env (com backup) e
     * reinicia o gateway só quando modo, política ou opt-in mudaram (a lista é relida ao vivo). Confere o que ficou
     * gravado antes de devolver. `home` aponta o home channel (avisos do Hermes) para o dono, que é lido na subida.
     */
    setDmPolicy: async (host, policy: WhatsappReplyChoice, numbers, opts) => {
      const bad = numbers.filter((n) => !/^\d{8,15}$/.test(n));
      if (bad.length > 0) throw new Error(`número inválido na lista: ${bad.join(", ")} (só dígitos, com DDI, 8 a 15)`);
      const quem = await readQuem(host);
      const antes = await run(host, `${HERMES_PATH_SH}\n${HERMES_POLICY_PY}\n${HERMES_PAUSA_SH}\necho "marks=$(cat "${WA_MARKS_FILE}" 2>/dev/null | tr -d '\\n')"\n`, 30_000);
      if (antes.code !== 0) throw new Error(`não consegui ler o .env do Hermes: ${ultimaLinha(antes.stderr) || ultimaLinha(antes.stdout) || "ssh falhou"}`);
      const kvAntes = kvTrimOf(antes.stdout);
      const envAntes = hermesEnvOf(kvAntes);
      // Sem o plugin, quem está pausado fica fora da lista gravada (a pausa no Hermes é isso); a tela continua mostrando o
      // número. Com o plugin a pausa é só a marca: a lista leva todo mundo (tirar daqui deixaria o contato fora depois do prazo).
      const modo = hermesPausaModo(kvAntes);
      pausaModoByHost.set(host, modo);
      const pausados = modo === "allowlist" ? pausadosDe(parseWaMarks(jsonOr(kvAntes.get("marks")))) : [];
      const patch = hermesEnvPara(policy, quem, numbers.filter((n) => !pausados.includes(n)));
      for (const [k, v] of Object.entries(patch)) if (!HERMES_ENV_VALUE_RE.test(v)) throw new Error(`valor inválido para ${k}`);
      const args = Object.entries(patch).map(([k, v]) => `'${k}=${v}'`).join(" ");
      const home = opts.home === undefined ? "" : `${hermesHomeChannelSh(opts.home.numero, opts.home.nome)}\n`;
      const reinicia = hermesPrecisaReiniciar(envAntes, patch) || opts.home !== undefined;
      const script = `set -e\n${HERMES_ENV_SET_PY} ${args}\n${home}${reinicia ? HERMES_RESTART_SH : 'echo "restart=nao-precisou"'}\n${HERMES_POLICY_PY}\n`;
      const r = await run(host, script, 120_000);
      if (r.code !== 0 || !r.stdout.includes("envset=ok")) throw new Error(`não consegui gravar o .env do Hermes: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout) || "ssh falhou"}`);
      const restart = /restart=(.*)/.exec(r.stdout)?.[1]?.trim() ?? "";
      if (restart.startsWith("falhou")) throw new Error(`gravei, mas não consegui reiniciar o gateway do Hermes (${restart.slice(8)}); reinicie-o na máquina para valer`);
      if (opts.home !== undefined && !r.stdout.includes("home=ok")) throw new Error("gravei a política, mas o home channel do Hermes não ficou gravado; tente de novo");
      const ficou = politicaHermes(hermesEnvOf(kvTrimOf(r.stdout)), quem);
      const erro = politicaNaoBate(policy, ficou);
      if (erro !== null) throw new Error(`a política não ficou gravada como escolhida: ${erro}. Tente de novo.`);
      log(`[whatsapp] ${host} (hermes): dmPolicy=${policy} restart=${restart || "?"}`);
    },
    groupClearPlan: async (host, jid) => ({ sessoes: (await groupSessionsOf(host, jid)).filter((s) => !s.ended).length }),
    groupClear: async (host, jid) => {
      const vivas = (await groupSessionsOf(host, jid)).filter((s) => !s.ended).map((s) => s.id);
      if (vivas.length === 0) throw new Error("o agente ainda não tem histórico neste grupo");
      await clearSessions(host, vivas);
    },
    // As sessões do grupo (uma por remetente), lidas do state.db; o nome de quem falou vem da própria sessão.
    groupThread: async (host, jid, n) => {
      const sessoes = await groupSessionsOf(host, jid);
      if (sessoes.length === 0) return [];
      const r = await run(host, `${HERMES_THREAD_PY} ${sessoes.map((s) => `'${s.id}'`).join(" ")} ${n}\n`, 90_000);
      if (r.code !== 0) throw new Error(`não consegui ler a conversa do grupo: ${ultimaLinha(r.stderr) || "ssh falhou"}`);
      const autores = new Map(sessoes.map((s) => [s.id, s.nome ?? `+${s.sender}`]));
      return threadFromHermes(jsonOr(r.stdout.trim()), autores).slice(-n) as WhatsappThreadMessage[];
    },
    /**
     * Liga/desliga o agente num grupo: config.yaml relido, config nova pela regra pura, gravação com backup, reinício do
     * gateway (a política é lida na subida) e conferência pelo config relido. "Quem aciona" é recusado com a explicação
     * (é a lista única das conversas diretas).
     */
    setGroup: async (host, jid, pedido: WhatsappGroupPatch, lerGrupos) => {
      const antes = await run(host, `${HERMES_GROUP_CFG_SH}\n`, 30_000);
      const cfg = parseHermesGroupCfg(jsonOr(kvOf(antes.stdout).get("gcfg")));
      if (antes.code !== 0 || cfg === null) throw new Error(`não consegui ler a política de grupos do Hermes (~/.hermes/config.yaml): ${ultimaLinha(antes.stderr) || ultimaLinha(antes.stdout) || "ssh falhou"}`);
      const novo = hermesGroupCfgPara(cfg, jid, pedido);
      if (novo === null) { log(`whatsapp: grupo ${jid} em ${host} (hermes): sem mudança`); return lerGrupos(); }
      const r = await run(host, `set -e\n${hermesGroupCfgSetSh(novo)}\n${HERMES_RESTART_SH}\n${HERMES_GROUP_CFG_SH}\n`, 120_000);
      if (r.code !== 0 || !r.stdout.includes("cfgset=ok")) throw new Error(`não consegui gravar o config.yaml do Hermes: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout) || "ssh falhou"}`);
      const restart = /restart=(.*)/.exec(r.stdout)?.[1]?.trim() ?? "";
      if (restart.startsWith("falhou")) throw new Error(`gravei, mas não consegui reiniciar o gateway do Hermes (${restart.slice(8)}); reinicie-o na máquina para valer`);
      const gravado = parseHermesGroupCfg(jsonOr(kvOf(r.stdout).get("gcfg")));
      if (hermesEstadoDoGrupo(gravado, jid) !== hermesEstadoDoGrupo(novo, jid)) throw new Error("a mudança não ficou gravada na máquina (o config.yaml relido não bate); tente de novo");
      log(`whatsapp: grupo ${jid} em ${host} (hermes): ${JSON.stringify(pedido)} → ${JSON.stringify(novo)} restart=${restart || "?"}`);
      return lerGrupos();
    },
    // Pelo próprio bridge (hermes-grupos-listar.ts), também parando o gateway uns 30 s.
    refreshGroups: async (host) => {
      const h = await run(host, HERMES_GRUPOS_LISTAR_SH, 240_000);
      const l = lerListagemHermes(h.stdout);
      if (!l.ok) throw new Error(`não consegui listar os grupos: ${l.erro}`);
      log(`whatsapp: lista de grupos atualizada em ${host} (hermes: ${l.grupos})`);
    },
  };
  return motor;
}
