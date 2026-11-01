/**
 * OpenClaw, o IO: tudo que fala com a máquina pela CLI `openclaw` (gateway call, config, channels) e pelos arquivos dela
 * (openclaw.json, creds.json, o sqlite do agente). As regras puras ficam em whatsapp-openclaw-core.ts, whatsapp-chats.ts,
 * whatsapp-pause.ts e whatsapp-grupos-core.ts; o contrato é o MotorWhatsapp (whatsapp-motor.ts).
 */
import type { WhatsappChat, WhatsappGroupPatch, WhatsappGroups, WhatsappReplyChoice, WhatsappThreadMessage } from "../../shared/ipc";
import type { Exec, MotorWhatsapp, PlanoLimpeza } from "./whatsapp-motor";
import { runSsh } from "./whatsapp-ssh";
import { jsonOr, kvOf, phoneOf } from "./whatsapp-kv";
import { gatewayByHost, namesOf } from "./whatsapp-estado";
import { log } from "../maquina/backend";
import { chatsFromSessions, gatewayFailures, peerOfSessionKey, politicaGravada, politicaNaoBate, SAFE_KEY, threadFor, type SessionHistory } from "./whatsapp-chats";
import { JID_RE, aplicarPatch, estadoDoGrupo, gruposDaMaquina, patchGrupo, threadDoGrupo } from "./whatsapp-grupos-core";
import { WA_MARKS_FILE, applyWaGroupMarks, applyWaMarks, donosDe, parseWaMarks, quemDe, type WaQuem } from "./whatsapp-marks";
import { SEND_POLICY_READ_SH, localWhenText, pauseNoteSh, pauseNoteText, pauseRulePrefixes, pauseRuleSh, pausedNumbersOfPolicy, sendPolicySh, withPauseRule, type PauseBy } from "./whatsapp-pause";
import { CREDS_ME, OPENCLAW_CHATS_SH, OPENCLAW_GROUPS_SH, OPENCLAW_LOGOUT_SH, OPENCLAW_PAIR_SH, OPENCLAW_RESTART_SH, OPENCLAW_STATUS_SH, WA_CONFIG_SH, WA_GRUPOS_DIR, grupoThreadSh, openclawStatus, ownerLockSh, selfPolicySh } from "./whatsapp-openclaw-core";
import { donoStatus } from "./whatsapp-marks";

const PATH_SH = "export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH";
const ultimaLinha = (s: string): string => s.trim().split("\n").pop() ?? "";
/** `printf 'H<TAB>chave<TAB>'; chat.history …` por sessão; o parse junta o JSON de cada linha. */
const historiasSh = (keys: readonly string[], limit: number): string => keys.map((k) => `printf 'H\t%s\t' '${k}'; timeout 40 openclaw gateway call chat.history --json --params '{"sessionKey":"${k}","limit":${limit}}' 2>/dev/null | tr -d '\n'; echo`).join("\n");
const historiasDe = (stdout: string): SessionHistory[] => {
  const out: SessionHistory[] = [];
  for (const line of stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts[0] !== "H" || parts.length < 3) continue;
    try { out.push({ sessionKey: parts[1]!, history: JSON.parse(parts.slice(2).join("\t")) }); } catch { /* sessão sem resposta */ }
  }
  return out;
};

export function criarMotorOpenclaw(run: Exec = runSsh): MotorWhatsapp {
  /** Número pareado (creds.json) e o dono gravado (whatsapp-lista.json), numa leitura só. */
  const readQuem = async (host: string): Promise<WaQuem> => {
    const r = await run(host, `echo "self=$(${CREDS_ME})"\necho "marks=$(cat "${WA_MARKS_FILE}" 2>/dev/null | tr -d '\\n')"\n`, 20_000);
    const kv = kvOf(r.stdout);
    return quemDe(parseWaMarks(jsonOr(kv.get("marks"))), phoneOf(kv.get("self") ?? ""));
  };
  /** session.sendPolicy atual do openclaw.json (null se não há ou não deu para ler). */
  const readSendPolicy = async (host: string): Promise<unknown> => {
    const r = await run(host, `${SEND_POLICY_READ_SH}\n`, 30_000);
    const line = r.stdout.split("\n").find((l) => l.startsWith("policy="));
    try { return JSON.parse(line?.slice("policy=".length) || "null"); } catch { return null; }
  };
  /** A sessão do agente neste grupo, saneada; null = ninguém falou com ele no grupo ainda (nada a limpar). */
  const grupoSessionKey = async (jid: string, grupos: () => Promise<WhatsappGroups>): Promise<string | null> => {
    if (!JID_RE.test(jid)) throw new Error("grupo inválido");
    const g = (await grupos()).grupos.find((x) => x.jid === jid);
    return g?.sessionKey !== null && g?.sessionKey !== undefined && SAFE_KEY.test(g.sessionKey) ? g.sessionKey : null;
  };
  /**
   * Zera as sessões com `gateway call sessions.reset` (o mesmo "/reset" do OpenClaw: sessão nova, o transcript antigo vai
   * para o arquivo dele) e esquece as memórias tiradas delas.
   */
  const clearSessions = async (host: string, keys: readonly string[]): Promise<void> => {
    const safe = keys.filter((k) => SAFE_KEY.test(k));
    if (safe.length === 0) throw new Error("não há histórico desta conversa na máquina");
    const lines = safe.map((k) => [
      `printf 'R\t%s\t' '${k}'; timeout 60 openclaw gateway call sessions.reset --json --params '{"key":"${k}","reason":"reset"}' 2>/dev/null | tr -d '\n'; echo`,
      `timeout 60 openclaw memory forget --agent '${k.split(":")[1]}' --session '${k}' >/dev/null 2>&1 || true`,
    ].join("\n")).join("\n");
    const r = await run(host, `${PATH_SH}\n${lines}\n`, 180_000);
    const failed = gatewayFailures(r.stdout, safe);
    if (failed.length > 0) throw new Error(`o OpenClaw não limpou ${failed.length === safe.length ? "o histórico" : `${failed.length} de ${safe.length} sessões`}`);
    log(`whatsapp: histórico limpo em ${host}: ${safe.join(", ")}`);
  };

  return {
    nome: "openclaw",
    statusSh: OPENCLAW_STATUS_SH,
    parseStatus: (_host, kv) => {
      const st = openclawStatus(kv);
      const marks = parseWaMarks(jsonOr(kv.get("marks")));
      return { ...st, ...donoStatus(quemDe(marks, st.number), marks) };
    },
    chatsSh: OPENCLAW_CHATS_SH,
    parseChats: (host, kv) => {
      let list: unknown = null;
      try { list = JSON.parse(kv.get("list") || "null"); } catch { throw new Error("o gateway do OpenClaw não respondeu à lista de conversas"); }
      let marks: unknown = null;
      try { marks = JSON.parse(kv.get("marks") || "null"); } catch { /* arquivo corrompido = sem marcas; a próxima gravação o refaz */ }
      const parsed = parseWaMarks(marks);
      // O cache de nomes semeia a memória (o pushname lido nesta sessão, se houver, continua valendo mais).
      const names = namesOf(host);
      for (const [n, e] of Object.entries(parsed.names)) if (e.name !== null && !names.has(n)) names.set(n, e.name);
      // Pausados pela lista durável do openclaw.json contam mesmo quando a sessão perdeu a marca (conversa limpa).
      let policy: unknown = null;
      try { policy = JSON.parse(kv.get("policy") || "null"); } catch { /* sem lista legível: só a marca da sessão */ }
      const quem = quemDe(parsed, phoneOf(kv.get("self") ?? ""));
      return applyWaMarks(chatsFromSessions(list, quem, names, pausedNumbersOfPolicy(policy)), parsed);
    },
    groupsSh: OPENCLAW_GROUPS_SH,
    parseGroups: (_host, kv) => {
      const marks = parseWaMarks(jsonOr(kv.get("marks")));
      const g = gruposDaMaquina(jsonOr(kv.get("list")), jsonOr(kv.get("wa")), jsonOr(kv.get("cache")), kv.get("self") ?? null, jsonOr(kv.get("banco")));
      // Excluído da lista mora na máquina (whatsapp-lista.json), na mesma leitura: os dois apps veem a mesma lista.
      return { ...g, grupos: applyWaGroupMarks(g.grupos, marks), skill: kv.get("skill") === "1" };
    },
    pairSh: OPENCLAW_PAIR_SH,
    logoutSh: OPENCLAW_LOGOUT_SH,
    restartSh: OPENCLAW_RESTART_SH,
    readQuem,
    thread: async (host, chat, limit) => {
      const keys = chat.sessionKeys.filter((k) => SAFE_KEY.test(k));
      const r = await run(host, `${PATH_SH}\n${historiasSh(keys, Math.min(1000, Math.max(1, Math.trunc(limit))))}\n`, 90_000);
      if (r.code !== 0) throw new Error(`não consegui ler a conversa: ${ultimaLinha(r.stderr) || "ssh falhou"}`);
      const histories = historiasDe(r.stdout);
      // Sessão sem resposta (gateway ocupado: tempo esgotado) é erro, nunca "conversa vazia": senão guardar no CRM antes de
      // limpar via "nada a guardar" e o histórico era zerado sem ir para o CRM.
      if (histories.length < keys.length) throw new Error("o gateway do OpenClaw não devolveu a conversa inteira a tempo; nada foi limpo. Tente de novo em instantes");
      const t = threadFor(chat.number, histories);
      return { messages: t.messages, name: t.name };
    },
    learnNames: async (host, chats, want) => {
      const keys = new Set<string>();
      for (const n of want) {
        const chat = chats.find((c) => c.number === n);
        if (chat === undefined) continue;
        const own = chat.sessionKeys.filter((k) => SAFE_KEY.test(k) && peerOfSessionKey(k) === n);
        for (const k of (own.length > 0 ? own : chat.sessionKeys.filter((k) => SAFE_KEY.test(k)))) keys.add(k);
      }
      if (keys.size === 0) return {};
      const r = await run(host, `${PATH_SH}\n${historiasSh([...keys], 40)}\n`, 120_000);
      if (r.code !== 0) throw new Error(`não consegui ler os nomes: ${ultimaLinha(r.stderr) || "ssh falhou"}`);
      const histories = historiasDe(r.stdout);
      const found: Record<string, string> = {};
      for (const n of want) { const t = threadFor(n, histories); if (t.name !== null) found[n] = t.name; }
      return found;
    },
    clearSessions,
    pause: async (host, want, paused, by, horas, plano) => {
      if (horas !== undefined) throw new Error("no OpenClaw a pausa não tem prazo: use \"Pausar\" e retome quando quiser");
      const quem = await readQuem(host);
      if (donosDe(quem).includes(want)) throw new Error("o dono não é pausado: o agente sempre responde a ele. Para silenciar o agente para todos, use \"Quem o agente responde\"");
      const { own } = await plano();
      // A lista durável (session.sendPolicy do openclaw.json) vale mesmo sem sessão própria e sobrevive a limpar.
      const policy = withPauseRule(await readSendPolicy(host), want, paused, pauseRulePrefixes(want, own));
      const value = paused ? '"deny"' : "null";
      const note = pauseNoteText(paused ? "pause" : "resume", localWhenText(new Date()), by);
      const patch = own.map((k) => `printf 'R\t%s\t' '${k}'; timeout 60 openclaw gateway call sessions.patch --json --params '{"key":"${k}","sendPolicy":${value}}' 2>/dev/null | tr -d '\n'; echo`).join("\n");
      const notes = own.map((k) => pauseNoteSh(k, note)).join("\n");
      const r = await run(host, `${PATH_SH}\n${sendPolicySh(policy)}\n${patch}\n${notes}\n${pauseRuleSh()}\n`, 120_000);
      const failed = gatewayFailures(r.stdout, own);
      if (failed.length > 0 || !/POL=1/.test(r.stdout)) throw new Error(`o OpenClaw não ${paused ? "pausou" : "retomou"} a conversa${failed.length === 0 ? " (lista de pausados do openclaw.json)" : ""}`);
      const noteState = own.length === 0 ? "sem sessão" : /NOTA=(\S+)/.exec(r.stdout)?.[1] ?? "?";
      const rule = /REGRA=(\S+)/.exec(r.stdout)?.[1] ?? "?";
      log(`whatsapp: ${paused ? "pausado" : "retomado"} +${want} em ${host} (${by}); lista do openclaw.json: ok; nota: ${noteState}; regra do AGENTS.md: ${rule}`);
    },
    keepPaused: async (host, want, own) => {
      const cur = await readSendPolicy(host);
      if (pausedNumbersOfPolicy(cur).has(want)) return;
      const r = await run(host, `${PATH_SH}\n${sendPolicySh(withPauseRule(cur, want, true, pauseRulePrefixes(want, own)))}\n`, 90_000);
      if (!/POL=1/.test(r.stdout)) throw new Error("não consegui manter a pausa deste contato (lista de pausados do openclaw.json); nada foi limpo");
      log(`whatsapp: +${want} pausado entrou na lista do openclaw.json antes de limpar (${host})`);
    },
    /**
     * Quem o agente responde nas DMs. "self" = só você: `dmPolicy allowlist` com `allowFrom` vazio e `selfChatMode true` (as
     * mensagens que você manda para o próprio número entram; mais ninguém recebe resposta nem código). "open" = todo mundo:
     * `dmPolicy open` + `allowFrom ["*"]`. "list" = você e os números listados. Grupos ficam desativados nos três. O
     * OpenClaw aplica sem reiniciar o gateway. Relê o que ficou gravado: a política só vale se dmPolicy e allowFrom batem.
     */
    setDmPolicy: async (host, policy, numbers) => {
      let script: string;
      if (policy === "open") {
        const n = (await readQuem(host)).dono;
        // O "*" antes do "open": "open" com allowFrom sem "*" descarta TODAS as mensagens (e foi o que sobrou numa máquina).
        script = `export PATH=$HOME/.local/bin:$PATH; set -e; openclaw config set session.dmScope per-channel-peer && openclaw config set channels.whatsapp.allowFrom '["*"]' --strict-json && openclaw config set channels.whatsapp.dmPolicy open && openclaw config set channels.whatsapp.groupPolicy disabled && openclaw config set channels.whatsapp.responsePrefix '""' --strict-json${n === null ? "" : ` && ${ownerLockSh(n)}`}`;
      } else if (policy === "list") {
        // Você + os números escolhidos: allowlist com allowFrom explícito. O dono entra sempre (sem ele, a pessoa
        // perdia o próprio agente); a trava de ferramentas continua só para o dono.
        const quem = await readQuem(host);
        const list = [...new Set([...donosDe(quem), ...numbers])].map((n) => `+${n}`);
        const allow = JSON.stringify(list).replace(/'/g, "");
        script = `export PATH=$HOME/.local/bin:$PATH; set -e; openclaw config set session.dmScope per-channel-peer && openclaw config set channels.whatsapp.dmPolicy allowlist && openclaw config set channels.whatsapp.allowFrom '${allow}' --strict-json && openclaw config set channels.whatsapp.selfChatMode true --strict-json && openclaw config set channels.whatsapp.groupPolicy disabled && openclaw config set channels.whatsapp.responsePrefix '""' --strict-json${quem.dono === null ? "" : ` && ${ownerLockSh(quem.dono)}`}`;
      } else {
        script = `export PATH=$HOME/.local/bin:$PATH; set -e; ${selfPolicySh(await readQuem(host))}`;
      }
      const confere = `python3 -c 'import json,os;w=((json.load(open(os.path.expanduser("~/.openclaw/openclaw.json"))).get("channels") or {}).get("whatsapp") or {});print("POLICY=%s ALLOW=%s" % (w.get("dmPolicy",""), json.dumps(w.get("allowFrom",[]))))'`;
      const r = await run(host, `${script}\n${confere}\n`, 60_000);
      if (r.code !== 0) throw new Error(`não consegui mudar a política: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout) || "ssh falhou"}`);
      const ficou = politicaGravada(r.stdout);
      const erro = ficou === null ? null : politicaNaoBate(policy, ficou);
      if (erro !== null) throw new Error(`a política não ficou gravada como escolhida: ${erro}. Tente de novo.`);
      log(`[whatsapp] ${host}: dmPolicy=${policy}`);
    },
    groupClearPlan: async (_host, jid, grupos) => ({ sessoes: (await grupoSessionKey(jid, grupos)) === null ? 0 : 1 }),
    groupClear: async (host, jid, grupos) => {
      const key = await grupoSessionKey(jid, grupos);
      if (key === null) throw new Error("o agente ainda não tem histórico neste grupo");
      await clearSessions(host, [key]);
    },
    groupThread: async (host, jid, n, grupos) => {
      const r = await run(host, grupoThreadSh(jid, n), 60_000);
      const ok = /^OK (.*)$/m.exec(r.stdout);
      // O nome do grupo (para filtrar o senderName) vem na mesma leitura: nada espera o gateway.
      if (ok !== null) { const h = jsonOr(ok[1]) as { subject?: unknown } | null; return threadDoGrupo(h, namesOf(host), typeof h?.subject === "string" ? h.subject : null); }
      // Sem o banco legível: o gateway (formato igual); vazio por tempo esgotado vira erro, não "sem mensagens".
      const grupo = (await grupos()).grupos.find((x) => x.jid === jid);
      if (grupo === undefined || grupo.sessionKey === null || !SAFE_KEY.test(grupo.sessionKey)) return [];
      const h = await run(host, `${PATH_SH}\ntimeout 60 openclaw gateway call chat.history --json --params '{"sessionKey":"${grupo.sessionKey}","limit":${n}}' 2>/dev/null | tr -d '\n'\n`, 90_000);
      const hist = jsonOr(h.stdout.trim());
      if (h.code !== 0 || hist === null) throw new Error("não consegui ler a conversa do grupo: o gateway do OpenClaw não respondeu a tempo");
      return threadDoGrupo(hist, namesOf(host), grupo.nome);
    },
    /**
     * Liga/desliga o agente num grupo e/ou muda quem o aciona: `openclaw config patch --stdin` (validado, com recarga do
     * canal, como o habilitar.py da skill), relê e confere. Devolve os grupos já com a mudança.
     */
    setGroup: async (host, jid, pedido: WhatsappGroupPatch, lerGrupos) => {
      const read = await run(host, `echo "self=$(${CREDS_ME})"\n${WA_CONFIG_SH}\n`, 30_000);
      const kv = kvOf(read.stdout);
      const wa = jsonOr(kv.get("wa"));
      if (wa === null) throw new Error("não consegui ler a configuração do WhatsApp nesta máquina (~/.openclaw/openclaw.json)");
      const self = phoneOf(kv.get("self") ?? "");
      const patch = patchGrupo(wa, jid, pedido, self);
      if (patch !== null) {
        const b64 = Buffer.from(JSON.stringify(patch), "utf8").toString("base64");
        const w = await run(host, `${PATH_SH}\nprintf '%s' '${b64}' | base64 -d | timeout 60 openclaw config patch --stdin 2>&1 | tail -n 3\necho "rc=\${PIPESTATUS[2]}"\n`, 90_000);
        if (!/rc=0/.test(w.stdout)) throw new Error(`o OpenClaw recusou a mudança: ${w.stdout.replace(/rc=\d+/, "").trim().split("\n").pop() || ultimaLinha(w.stderr) || "sem resposta"}`);
      }
      const depois = await lerGrupos();
      // Confere pelo openclaw.json relido: o que ficou gravado tem de ser o que o patch pedia.
      const reread = await run(host, `${WA_CONFIG_SH}\n`, 30_000);
      const gravado = jsonOr(kvOf(reread.stdout).get("wa"));
      const esperado = patch === null ? wa : aplicarPatch(wa, patch);
      if (estadoDoGrupo(gravado, jid) !== estadoDoGrupo(esperado, jid)) throw new Error("a mudança não ficou gravada na máquina (o openclaw.json relido não bate); tente de novo");
      log(`whatsapp: grupo ${jid} em ${host}: ${patch === null ? "sem mudança" : JSON.stringify(patch)}`);
      return depois;
    },
    /** Atualiza a lista de grupos pelo WhatsApp (skill whatsapp-grupos: `wa-admin.sh listar`), parando o gateway ~30 s. */
    refreshGroups: async (host) => {
      const r = await run(host, `${PATH_SH}
[ -f "${WA_GRUPOS_DIR}/scripts/wa-admin.sh" ] || { echo "SKILL=0"; exit 0; }
L=$(mktemp); timeout 420 bash "${WA_GRUPOS_DIR}/scripts/wa-admin.sh" listar --json >/dev/null 2>"$L"; echo "RC=$?"
tail -n 2 "$L" 2>/dev/null | sed 's/^/LOG=/'; rm -f "$L"
`, 480_000);
      if (/SKILL=0/.test(r.stdout)) throw new Error("a skill whatsapp-grupos não está nesta máquina: atualize a guarda do WhatsApp pelo seletor");
      if (!/RC=0/.test(r.stdout)) throw new Error(`não consegui listar os grupos: ${r.stdout.split("\n").filter((l) => l.startsWith("LOG=")).map((l) => l.slice(4)).join(" ").trim() || ultimaLinha(r.stderr) || "sem resposta"}`);
      log(`whatsapp: lista de grupos atualizada em ${host}`);
    },
  };
}
// `gatewayByHost` fica para quem quiser marcar o motor visto (a fachada faz isso pelo `gateway=` do script).
void gatewayByHost;
