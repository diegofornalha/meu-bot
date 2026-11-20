/**
 * meu-bot-guarda: plugin do OpenClaw que roda no gateway da máquina (24 h, sem depender do app).
 * 1. Notas operacionais do OpenClaw ("↪️ Model Fallback…", "↪️ Retried on…") nunca vão ao contato do WhatsApp:
 *    o hook `message_sending` cancela a entrega (o estado de fallback do OpenClaw continua; só a linha não sai).
 * 2. Loop bot-com-bot: `message_received` abre um ciclo, `message_sending` fecha; no 3º ciclo suspeito
 *    (regras.mjs) cancela a resposta, aplica sendPolicy "deny" na sessão (a mesma pausa manual do meu-bot,
 *    que a lista do app mostra como "pausado") e injeta a nota ao agente, como a pausa manual faz.
 * Retomar é manual (menu "…" › Retomar no meu-bot). JS puro: plugin local não recebe npm install.
 * 3. Grupos: o freio de grupo (GroupBrake) segura as respostas por 5 min quando o agente responde demais ou repete
 *    a mesma coisa num grupo (vaivém com outro agente); solta sozinho. Config: grupoMaxRespostas, grupoJanelaMin.
 * 4. Memória do dono (memoria.mjs): no chat do dono consigo mesmo, "lembre que …", "esquece que …" e "o que você
 *    lembra?" gravam/leem ~/.local/share/meu-bot/memoria-dono.md; a memória entra no prompt dos turnos do dono.
 * 5. Modo "sugere e você aprova" (sugestoes.mjs): com o modo ligado, a resposta do agente não sai; vira sugestão na
 *    fila (~/.local/share/meu-bot/whatsapp-sugestoes.jsonl) e a pessoa aprova ou descarta pelo app.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GroupBrake, GRUPO_PADRAO, LoopTracker, autoPauseNoteText, closureVerdict, isOperationalNotice, loopVerdict } from "./regras.mjs";
import * as memoria from "./memoria.mjs";
import * as sugestoes from "./sugestoes.mjs";

const PLUGIN_ID = "meu-bot-guarda";
const MEMORIA_DONO = path.join(os.homedir(), ".local", "share", "meu-bot", "memoria-dono.md");
/** Número do próprio WhatsApp ("+5521…", do me.id do creds.json do OpenClaw); null sem pareamento. */
function donoDoNumero() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".openclaw", "credentials", "whatsapp", "default", "creds.json"), "utf8"));
    const d = String(c?.me?.id ?? "").replace(/@.*$/, "").replace(/:.*$/, "").replace(/\D/g, "");
    return d === "" ? null : `+${d}`;
  } catch { return null; }
}
const telefone = (v) => { const d = String(v ?? "").replace(/@.*$/, "").replace(/:.*$/, "").replace(/\D/g, ""); return d === "" ? null : `+${d}`; };
const tracker = new LoopTracker();
/** Sessões que a guarda pausou e ainda não viu retomadas (evita pausar duas vezes e deixa o tracker quieto). */
const pausedByUs = new Set();

/** Chave de sessão do contato: a do contexto, ou montada de `to` (nos envios do WhatsApp ela pode faltar). */
function sessionKeyOf(ctx, to) {
  if (typeof ctx.sessionKey === "string" && ctx.sessionKey !== "") return ctx.sessionKey;
  const num = String(to ?? "").replace(/@.*$/, "").replace(/[^\d+]/g, "");
  if (num === "") return null;
  return `agent:main:whatsapp:direct:${num.startsWith("+") ? num : `+${num}`}`;
}
const peerOf = (key) => key.split(":").pop() ?? key;
const whenText = () => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" }).format(new Date());

/** A nota ao agente, como na pausa manual: um turno em segundo plano, sem --deliver (nada vai ao WhatsApp). */
function injectNote(key, text, logger) {
  try {
    const f = fs.mkdtempSync(path.join(os.tmpdir(), "meu-bot-nota-"));
    const file = path.join(f, "nota.txt");
    fs.writeFileSync(file, text, "utf8");
    const child = spawn("sh", ["-c", `timeout 180 openclaw agent --session-key "$1" --message-file "$2" >/dev/null 2>&1; rm -rf "$3"`, "sh", key, file, f], { detached: true, stdio: "ignore", env: { ...process.env, PATH: `${os.homedir()}/.openclaw/bin:${os.homedir()}/.local/bin:/opt/node/bin:${process.env.PATH ?? ""}` } });
    child.unref();
  } catch (e) { logger.warn(`${PLUGIN_ID}: nota ao agente não agendada: ${e instanceof Error ? e.message : String(e)}`); }
}

/** Registro de auditoria da máquina (quem: "agente"), pelo auditoria.py que o backend do meu-bot deixa na pasta dele. */
function auditar(peer, reason, logger, acao = "whatsapp.pausa-automatica") {
  const py = path.join(os.homedir(), ".local", "share", "meu-bot", "auditoria.py");
  if (!fs.existsSync(py)) return;
  const b64 = Buffer.from(JSON.stringify({ quem: { tipo: "agente", nome: "guarda do WhatsApp" }, app: "plugin", acao, alvo: String(peer ?? ""), detalhe: String(reason ?? "").slice(0, 300) }), "utf8").toString("base64url");
  const p = spawn("python3", [py, "gravar", b64], { stdio: "ignore" });
  p.on("error", (e) => logger.warn(`${PLUGIN_ID}: auditoria: ${e.message}`));
}

export default {
  id: PLUGIN_ID,
  name: "meu-bot · guarda do WhatsApp",
  register(api) {
    const logger = api.logger;
    const agentIdOf = (key) => key.split(":")[1] || "main";
    const conf = api.pluginConfig && typeof api.pluginConfig === "object" ? api.pluginConfig : {};
    const freioGrupo = new GroupBrake({
      maxRespostas: Number.isInteger(conf.grupoMaxRespostas) && conf.grupoMaxRespostas >= 2 ? conf.grupoMaxRespostas : GRUPO_PADRAO.maxRespostas,
      janelaMs: typeof conf.grupoJanelaMin === "number" && conf.grupoJanelaMin >= 1 ? conf.grupoJanelaMin * 60_000 : GRUPO_PADRAO.janelaMs,
    });
    /** Grupo do envio: a chave de sessão de grupo do contexto, ou o JID @g.us do destino; null = não é grupo. */
    const grupoDe = (event, ctx) => (typeof ctx.sessionKey === "string" && ctx.sessionKey.includes(":group:") ? ctx.sessionKey : /@g\.us$/.test(String(event.to ?? "")) ? `grupo:${event.to}` : null);

    async function pause(key, reason) {
      pausedByUs.add(key);
      tracker.forget(key);
      await api.runtime.agent.session.patchSessionEntry({ agentId: agentIdOf(key), sessionKey: key, preserveActivity: true, update: () => ({ sendPolicy: "deny" }) });
      logger.warn(`${PLUGIN_ID}: loop com ${peerOf(key)} (${reason}); conversa pausada (sendPolicy deny)`);
      injectNote(key, autoPauseNoteText(reason, whenText(), peerOf(key)), logger);
      auditar(peerOf(key), reason, logger);
    }

    // Confirmação no log de que o hook de entrada chega (exige plugins.entries.meu-bot-guarda.hooks.allowConversationAccess).
    const seenIn = new Set();
    api.on("message_received", (event, ctx) => {
      if (ctx.channelId !== "whatsapp") return;
      const key = sessionKeyOf(ctx, event.from);
      if (key === null || !key.includes(":direct:")) return;
      if (!seenIn.has(key)) { seenIn.add(key); logger.info(`${PLUGIN_ID}: observando ${peerOf(key)} (entrada recebida)`); }
      if (pausedByUs.has(key)) return;
      tracker.received(key, event.content ?? "", typeof event.timestamp === "number" ? event.timestamp : Date.now());
    });

    api.on("message_sending", async (event, ctx) => {
      if (ctx.channelId !== "whatsapp") return;
      const text = event.content ?? "";
      if (isOperationalNotice(text)) {
        logger.info(`${PLUGIN_ID}: nota operacional não entregue a ${event.to}: ${text.slice(0, 80)}`);
        return { cancel: true, cancelReason: `${PLUGIN_ID}: nota operacional do OpenClaw` };
      }
      // Modo "sugere e você aprova" (sugestoes.mjs): nada sai sozinho; a resposta vira sugestão na fila que o app
      // mostra. Passa só a conversa do dono consigo mesmo e o que a pessoa aprovou (passe de uso único).
      try {
        const d = sugestoes.decidir(sugestoes.DIR_PADRAO, { to: event.to, texto: text, sessao: typeof ctx.sessionKey === "string" ? ctx.sessionKey : null, dono: donoDoNumero() });
        if (d.acao === "segurar") {
          logger.info(`${PLUGIN_ID}: modo sugestão: resposta a ${event.to} guardada para aprovação${d.sugestao ? ` (${d.sugestao.id})` : " (destino ilegível, não guardada)"}`);
          return { cancel: true, cancelReason: `${PLUGIN_ID}: modo sugestão (a pessoa aprova antes de enviar)` };
        }
        if (d.aprovado) { logger.info(`${PLUGIN_ID}: modo sugestão: envio aprovado pela pessoa para ${event.to}`); return; }
      } catch (e) {
        // Fila ilegível ou ocupada com o modo ligado: na dúvida, não manda sozinho.
        if (sugestoes.modoLigado()) { logger.error(`${PLUGIN_ID}: modo sugestão: ${e instanceof Error ? e.message : String(e)}; envio a ${event.to} cancelado`); return { cancel: true, cancelReason: `${PLUGIN_ID}: modo sugestão (fila indisponível)` }; }
      }
      const grupo = grupoDe(event, ctx);
      if (grupo !== null) {
        const f = freioGrupo.sending(grupo, text, Date.now());
        if (!f.segurar) return;
        if (f.novo) {
          logger.warn(`${PLUGIN_ID}: freio no grupo ${grupo} (${f.motivo}); respostas seguradas por ${Math.round(freioGrupo.o.janelaMs / 60_000)} min`);
          auditar(grupo.split(":").pop(), f.motivo, logger, "whatsapp.grupo.freio");
        }
        return { cancel: true, cancelReason: `${PLUGIN_ID}: freio de grupo (${f.motivo})` };
      }
      const key = sessionKeyOf(ctx, event.to);
      if (key === null || !key.includes(":direct:")) return;
      if (pausedByUs.has(key)) return; // o gateway já descarta pelo sendPolicy; nada a fazer
      const r = tracker.sending(key, text, Date.now());
      if (!r.loop) return;
      try { await pause(key, r.reason); }
      catch (e) { logger.error(`${PLUGIN_ID}: não consegui pausar ${key}: ${e instanceof Error ? e.message : String(e)}`); return; }
      return { cancel: true, cancelReason: `${PLUGIN_ID}: ${r.reason}` };
    });

    // Fim de cada turno do agente: o OpenClaw entrega a conversa inteira (`event.messages`). É o único hook em que a
    // entrada do contato aparece (message_received não chega a plugins de fora), então o loop é reavaliado com os
    // dois lados (3 ciclos) e, além dele, a conversa encerrada: o agente se despediu e ficou em silêncio 2 vezes →
    // pausa de verdade (sendPolicy deny), que o app mostra como "pausado", como se o dono tivesse clicado.
    api.on("agent_end", async (event, ctx) => {
      if (ctx?.channelId !== "whatsapp") return;
      const key = sessionKeyOf(ctx, null);
      if (key === null || !key.includes(":direct:") || pausedByUs.has(key)) return;
      const msgs = Array.isArray(event?.messages) ? event.messages : [];
      if (msgs.length === 0) return;
      const loop = loopVerdict(msgs);
      const closed = loop.loop ? { closed: false } : closureVerdict(msgs);
      if (!loop.loop && !closed.closed) return;
      try { await pause(key, loop.loop ? loop.reason : closed.reason); }
      catch (e) { logger.error(`${PLUGIN_ID}: não consegui pausar ${key} (agent_end): ${e instanceof Error ? e.message : String(e)}`); }
    });
    // Memória do dono: a mensagem dele para si mesmo com um atalho grava na hora; a nota daquele turno (e a memória
    // em todos os turnos do dono) entra pelo before_prompt_build. O dono é relido a cada mensagem (pareamento novo).
    const notaDono = { texto: null, em: 0 };
    api.on("message_received", (event, ctx) => {
      if (ctx.channelId !== "whatsapp") return;
      const dono = donoDoNumero(); const de = telefone(event.from);
      if (dono === null || de !== dono) return;
      const a = memoria.atalho(event.content ?? "");
      if (a === null) return;
      try { notaDono.texto = memoria.aplicar(MEMORIA_DONO, a); notaDono.em = Date.now(); logger.info(`${PLUGIN_ID}: memória do dono: ${a.tipo}`); }
      catch (e) { logger.warn(`${PLUGIN_ID}: memória do dono: ${e instanceof Error ? e.message : String(e)}`); }
    });
    api.on("before_prompt_build", (_event, ctx) => {
      const canal = ctx?.channel ?? ctx?.messageProvider;
      if (typeof canal === "string" && canal !== "" && canal !== "whatsapp") return undefined;
      const m = /:direct:(\+?\d{6,20})$/.exec(String(ctx?.sessionKey ?? ""));
      const dono = donoDoNumero();
      if (m === null || dono === null || telefone(m[1]) !== dono) return undefined;
      const partes = [memoria.contexto(MEMORIA_DONO)];
      if (notaDono.texto !== null && Date.now() - notaDono.em < 120_000) partes.push(notaDono.texto);
      notaDono.texto = null;
      const texto = partes.filter((x) => x !== null).join("\n\n");
      return texto === "" ? undefined : { prependContext: texto };
    }, { timeoutMs: 2000 });

    // Retomada manual (sendPolicy volta a null pelo meu-bot): esquecer a sessão para a guarda voltar a observar.
    api.on("session_start", (_event, ctx) => { if (typeof ctx?.sessionKey === "string") pausedByUs.delete(ctx.sessionKey); });
    logger.info(`${PLUGIN_ID}: ativo (nota de fallback bloqueada; pausa automática em loop de 3 ciclos; freio de grupo: ${freioGrupo.o.maxRespostas} respostas em ${Math.round(freioGrupo.o.janelaMs / 60_000)} min)`);
  },
};
