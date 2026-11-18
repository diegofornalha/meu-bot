#!/usr/bin/env node
/**
 * crm-job.mjs — um "turno" do CRM pelo WhatsApp (meu-bot, Pro), rodado pelo plugin meu-bot-crm na máquina:
 *   crm-job.mjs <sessionKey> [--comando "texto"]   anota a conversa desse contato (silêncio ou pedido do dono)
 *   crm-job.mjs --dono --comando "texto"            pedido do dono sem contato explícito (o agente descobre)
 *   crm-job.mjs --aplicar [n] | --descartar          responde à última proposta pendente
 *   crm-job.mjs transcricao <+N> [--desde <ms>]      imprime a conversa (usado pelo agente em modo dono)
 *   crm-job.mjs classificar-todos                     contatos do WhatsApp sem caixa → pipeline que já existe (1 vez)
 *   crm-job.mjs contatos-whatsapp                     números das conversas diretas, com o nome do WhatsApp (para o
 *                                                     Google Contatos; completa crm/whatsapp-contatos.json)
 * Lê a conversa com `openclaw gateway call chat.history`, pede ao backend local do meu-bot (perfil "agente",
 * sessão crm:+N) que rode a CLI do CRM e devolva um bloco crm-json; manda o resumo ao dono pelo WhatsApp dele.
 * A CLI depende da licença (licenca.json): plano Pro em vigor — a licença crua "personalizado" conta como Pro, pela
 * mesma regra do backend, sem esperar o server.js regravar o arquivo — ou motor "proprio" gravado em crm.json → crm.mjs
 * (CRM próprio, nesta máquina); senão → streak.mjs (Streak pela API, com a chave em crm.json). Estado em crm/estado.json; log em crm/crm.log.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { avisoSemPipeline, avisoDevido, buildPrompt, confirmIndex, lastTimestamp, mergeEstado, mesclarContatoWhatsapp, nomeDoHistorico, normalizePhone, ownerMessage, parseClassificacao, parseCrmJson, phoneOfSessionKey, promptClassificacao, recuperarDesde, threadFromHistory } from "./regras.mjs";
import { backendEnv, crmApi } from "./backend.mjs";
import { crmProprio as crmProprioDe, motorCrm as motorCrmDe } from "./licenca-crm.mjs";

const HOME = os.homedir();
const BASE = path.join(HOME, ".local", "share", "meu-bot");
const DIR = path.join(BASE, "crm");
const CONFIG = path.join(BASE, "crm.json");
const LICENCA = path.join(BASE, "licenca.json");
const ESTADO = path.join(DIR, "estado.json");
const LOG = path.join(DIR, "crm.log");
const log = (line) => { try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); } catch { /* cortesia */ } };
const readJson = (f, dflt) => { try { const v = JSON.parse(fs.readFileSync(f, "utf8")); return v && typeof v === "object" ? v : dflt; } catch { return dflt; } };
/**
 * A licença crua desta máquina: o espelho em vigor que o backend deixa quando o Pro vem da conta da pessoa
 * (licenca-vigor.json; ele confere a assinatura), senão o licenca.json do admin (personalizado já conta; ver
 * licenca-crm.mjs).
 */
const licencaAtual = () => readJson(path.join(BASE, "licenca-vigor.json"), null) ?? readJson(LICENCA, {});
export const crmProprio = (l = licencaAtual(), now = Date.now()) => crmProprioDe(l, now);
/** Motor do CRM nesta máquina. Sem motor gravado, a licença crua decide (licenca-crm.mjs). */
export const motorCrm = (l = licencaAtual(), c = readJson(path.join(BASE, "crm.json"), {}), now = Date.now()) => motorCrmDe(l, c, now);
let STREAK = path.join(DIR, "streak.mjs");
const PATH_EXTRA = `${HOME}/.openclaw/bin:${HOME}/.local/bin:/opt/node/bin:/usr/local/bin:${process.env.PATH ?? ""}`;

const writeJson = (f, v) => { const tmp = `${f}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); };
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const optv = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : null; };

let cfg = {};
let estado = {};
/** IO só quando o arquivo é o programa (o teste importa `crmProprio`/`motorCrm` sem mexer na licença da máquina). */
function boot() {
  fs.mkdirSync(DIR, { recursive: true });
  cfg = readJson(CONFIG, {});
  estado = readJson(ESTADO, {});
  STREAK = path.join(DIR, motorCrm() === "proprio" ? "crm.mjs" : "streak.mjs");
}
function ownerPhone() {
  if (typeof cfg.dono === "string" && cfg.dono !== "") return cfg.dono;
  const creds = readJson(path.join(HOME, ".openclaw", "credentials", "whatsapp", "default", "creds.json"), {});
  return normalizePhone(creds?.me?.id ?? "");
}
function proOk() { return crmProprio(); }
function openclaw(args, timeoutMs = 60_000) { return execFileSync("openclaw", args, { encoding: "utf8", timeout: timeoutMs, env: { ...process.env, PATH: PATH_EXTRA }, stdio: ["ignore", "pipe", "pipe"] }); }
function sendOwner(text) {
  const to = ownerPhone(); if (to === null) { log("sem número do dono: mensagem não enviada"); return; }
  try { openclaw(["message", "send", "--channel", "whatsapp", "--target", to, "--message", text, "--json"], 90_000); log(`→ dono: ${text.slice(0, 120).replace(/\n/g, " | ")}`); }
  catch (e) { log(`falha ao avisar o dono: ${e instanceof Error ? e.message : String(e)}`); }
}
function streak(args) {
  const r = spawnSync("node", [STREAK, ...args], { encoding: "utf8", timeout: 60_000, env: { ...process.env, PATH: PATH_EXTRA } });
  const line = (r.stdout || "").trim().split("\n").pop() || "";
  try { return JSON.parse(line); } catch { return { erro: (r.stderr || line || "sem resposta").slice(0, 300) }; }
}
function history(sessionKey, limit = 200) {
  const raw = openclaw(["gateway", "call", "chat.history", "--json", "--params", JSON.stringify({ sessionKey, limit })], 60_000);
  const i = raw.indexOf("{"); return JSON.parse(i >= 0 ? raw.slice(i) : raw);
}
function askAgent(prompt, convId, model = "agente") {
  const be = backendEnv(); if (be.key === "") throw new Error("backend do meu-bot não encontrado nesta máquina (.env do backend)");
  const body = JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: false });
  return new Promise((resolve, reject) => {
    const req = http.request({ host: be.host, port: be.port, path: "/v1/chat/completions", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${be.key}`, "X-Conversation-Id": convId }, timeout: 10 * 60_000 }, (res) => {
      let s = ""; res.setEncoding("utf8"); res.on("data", (c) => { s += c; });
      res.on("end", () => { try { const j = JSON.parse(s); if (res.statusCode !== 200) reject(new Error(j.error?.message ?? `backend ${res.statusCode}`)); else resolve(String(j.choices?.[0]?.message?.content ?? "")); } catch (e) { reject(new Error(`resposta inválida do backend: ${e.message}`)); } });
    });
    req.on("timeout", () => req.destroy(new Error("o agente não respondeu em 10 min")));
    req.on("error", reject); req.write(body); req.end();
  });
}
function withLock(name, fn) {
  const lock = path.join(DIR, `lock-${name.replace(/[^\w+]/g, "_")}`);
  try { fs.writeFileSync(lock, String(process.pid), { flag: "wx" }); } catch { const age = Date.now() - (fs.statSync(lock).mtimeMs || 0); if (age < 15 * 60_000) { log(`${name}: já há um job rodando; saio`); return Promise.resolve(); } fs.unlinkSync(lock); fs.writeFileSync(lock, String(process.pid)); }
  return Promise.resolve().then(fn).finally(() => { try { fs.unlinkSync(lock); } catch { /* ok */ } });
}

async function runForContact(sessionKey, command) {
  const phone = phoneOfSessionKey(sessionKey); if (phone === null) { log(`chave sem telefone: ${sessionKey}`); return; }
  const prev = estado[phone] ?? {};
  const h = history(sessionKey);
  const info = streak(["pipeline"]);
  if (info.erro) {
    log(`${phone}: pipeline: ${info.erro}`);
    // Sem pipeline padrão a conversa não é anotada: o dono precisa saber (no máximo um aviso por dia, não a cada contato).
    if (command !== null || avisoDevido(estado.avisoPipelineEm, Date.now())) { sendOwner(avisoSemPipeline(info.erro, crmProprio())); writeJson(ESTADO, { ...estado, avisoPipelineEm: Date.now() }); }
    return;
  }
  // A caixa da pessoa em qualquer pipeline (não só no padrão): senão a classificação criaria outra.
  let found = streak(["box-find", "--phone", phone, "--todos"]);
  let knownBox = !found.erro && Array.isArray(found.boxes) && found.boxes.length === 1 ? found.boxes[0] : null;
  // Número que estava "sem caixa" e agora tem (alguém vinculou o contato): o que foi dito antes também conta.
  const desde = recuperarDesde(prev, knownBox !== null, Date.now());
  const delta = threadFromHistory(h, desde);
  if (delta.length === 0 && command === null) { log(`${phone}: nada novo`); return; }
  if (prev.semBox === true && knownBox !== null) log(`${phone}: agora tem caixa (${knownBox.name}); relendo desde ${new Date(desde).toISOString()}`);
  // Sem caixa: se a conversa encaixa claramente num pipeline que já existe, a caixa nasce lá (classificação automática).
  if (knownBox === null && command === null && cfg.classificarAutomatico !== false && (found.total ?? 0) === 0 && !found.erro) {
    const c = await classificarContato(phone, h);
    if (c !== null) { found = streak(["box-find", "--phone", phone, "--todos"]); knownBox = Array.isArray(found.boxes) && found.boxes.length === 1 ? found.boxes[0] : null; }
  }
  if (knownBox !== null && knownBox.pipelineKey && knownBox.pipelineKey !== info.key) { const outro = streak(["pipeline", "--pipeline", knownBox.pipelineKey]); if (!outro.erro) Object.assign(info, outro); }
  if (knownBox === null && command === null && cfg.criarSemPerguntar !== true && (found.total ?? 0) === 0) {
    // Sem box (e sem pipeline que encaixe) e sem pedido do dono: não cria nada sozinho; só lembra para a próxima.
    log(`${phone}: sem box no pipeline; ignorado (peça "anota no CRM" para criar)`);
    writeJson(ESTADO, mergeEstado(estado, phone, { marca: lastTimestamp(delta) || prev.marca || 0, semBox: true }));
    return;
  }
  const prompt = buildPrompt({ phone, contactName: knownBox?.name ?? h?.sessionInfo?.createdActor?.identity?.displayName ?? null, pipeline: { name: info.name, stages: info.stages, fields: (info.fields ?? []).map((f) => ({ name: f.name, type: f.type, options: (f.options ?? []).map((o) => o.name) })) }, delta, command, allowCreate: cfg.criarSemPerguntar === true, streakCli: `node ${STREAK}`, knownBox: knownBox ? { name: knownBox.name, key: knownBox.key, stage: knownBox.stage } : null });
  log(`${phone}: pedindo ao agente (${delta.length} msgs novas${command !== null ? ", com pedido do dono" : ""})`);
  const answer = await askAgent(prompt, `crm:${phone}`);
  const parsed = parseCrmJson(answer);
  const marca = lastTimestamp(delta) || prev.marca || 0;
  if (parsed === null) { log(`${phone}: resposta sem crm-json: ${answer.slice(0, 200).replace(/\n/g, " ")}`); writeJson(ESTADO, mergeEstado(estado, phone, { marca, semBox: knownBox === null })); if (command !== null) sendOwner(`📇 CRM · ${knownBox?.name ?? phone}: não consegui estruturar a anotação desta vez. Resposta do agente:\n${answer.slice(0, 500)}`); return; }
  const next = mergeEstado(estado, phone, { marca, semBox: knownBox === null, nome: knownBox?.name ?? prev.nome ?? null, propostas: parsed.propostas, propostasEm: parsed.propostas.length > 0 ? Date.now() : null });
  if (parsed.propostas.length > 0) next.ultimaProposta = phone;
  writeJson(ESTADO, next);
  log(`${phone}: aplicado ${parsed.aplicado.length}, propostas ${parsed.propostas.length}`);
  // Cartão "Conversa no WhatsApp" do contato no Gmail (só no CRM próprio): resumo da conversa toda, nº de mensagens, última.
  if (crmProprio()) {
    const todas = threadFromHistory(h, 0);
    const r = streak(["whatsapp-set", phone, "--resumo", parsed.resumoConversa || parsed.resumo, "--mensagens", String(todas.length), "--ultima", String(lastTimestamp(todas) || Date.now()), ...(knownBox ? ["--box", knownBox.key] : [])]);
    if (r.erro) log(`${phone}: whatsapp-set: ${r.erro}`);
  }
  if (parsed.aplicado.length > 0 || parsed.propostas.length > 0 || command !== null) sendOwner(ownerMessage(knownBox?.name ?? prev.nome ?? phone, parsed));
}

async function runForOwner(command) {
  const list = (() => { try { const raw = openclaw(["gateway", "call", "sessions.list", "--json", "--params", JSON.stringify({ limit: 60 })]); const i = raw.indexOf("{"); const j = JSON.parse(raw.slice(i)); return Array.isArray(j.sessions) ? j.sessions : []; } catch { return []; } })();
  const dono = ownerPhone();
  const recentes = list.map((s) => ({ key: s.key ?? s.sessionKey, at: s.updatedAt ?? 0 })).filter((s) => typeof s.key === "string" && s.key.includes(":direct:") && phoneOfSessionKey(s.key) !== dono).sort((a, b) => b.at - a.at).slice(0, 15);
  const info = streak(["pipeline"]); if (info.erro) { sendOwner(`📇 CRM: ${info.erro}`); return; }
  const prompt = [
    `O dono pediu agora, pelo WhatsApp: "${command}".`,
    `Descubra de qual contato ele fala: use \`node ${STREAK} box-find --name "..."\` no pipeline "${info.name}" e, se precisar da conversa recente do contato, \`node ${path.join(DIR, "crm-job.mjs")} transcricao +N\` (devolve JSON com as mensagens).`,
    `Contatos com conversa recente (telefone · quando): ${recentes.map((s) => `${phoneOfSessionKey(s.key)} · ${new Date(s.at).toISOString().slice(0, 16)}`).join("; ") || "(nenhum)"}.`,
    buildPrompt({ phone: "(a descobrir)", contactName: null, pipeline: { name: info.name, stages: info.stages, fields: (info.fields ?? []).map((f) => ({ name: f.name, type: f.type, options: (f.options ?? []).map((o) => o.name) })) }, delta: [], command, allowCreate: cfg.criarSemPerguntar === true, streakCli: `node ${STREAK}`, knownBox: null }).split("\n\n").slice(1).join("\n\n"),
    "Se o pedido do dono for explícito (ex.: \"crie o box do Fulano\", \"mova para Acordo\"), isso vale como confirmação: faça e relate em `aplicado`.",
  ].join("\n\n");
  log(`dono: pedido "${command.slice(0, 80)}"`);
  const answer = await askAgent(prompt, "crm:dono");
  const parsed = parseCrmJson(answer);
  if (parsed === null) { sendOwner(`📇 CRM: não consegui estruturar. Resposta do agente:\n${answer.slice(0, 600)}`); return; }
  if (parsed.propostas.length > 0) { const next = mergeEstado(estado, "dono", { propostas: parsed.propostas, propostasEm: Date.now() }); next.ultimaProposta = "dono"; writeJson(ESTADO, next); }
  sendOwner(ownerMessage("pedido", parsed));
}

function applyPending(index) {
  const who = estado.ultimaProposta; const pend = who ? estado[who]?.propostas ?? [] : [];
  if (!who || pend.length === 0) { sendOwner("📇 CRM: não há proposta pendente."); return; }
  const chosen = index === null ? pend : pend.filter((_, i) => i + 1 === index);
  if (chosen.length === 0) { sendOwner(`📇 CRM: não existe a proposta ${index}.`); return; }
  const lines = [];
  for (const p of chosen) { const r = streak([p.acao, ...p.args]); lines.push(r.erro ? `✗ ${p.texto}: ${r.erro}` : `✓ ${p.texto}`); log(`aplicar ${p.acao} ${JSON.stringify(p.args)} → ${r.erro ?? "ok"}`); }
  const rest = index === null ? [] : pend.filter((_, i) => i + 1 !== index);
  const next = mergeEstado(estado, who, { propostas: rest, propostasEm: rest.length > 0 ? estado[who].propostasEm : null }); if (rest.length === 0) delete next.ultimaProposta; writeJson(ESTADO, next);
  sendOwner(`📇 CRM · ${estado[who]?.nome ?? who}\n${lines.join("\n")}`);
}
/**
 * Classificação automática: contato sem caixa → pipeline que já existe (motor do chat, só texto). Encaixe claro
 * (confiança ≥ 0,7) cria a caixa na 1ª etapa, com a pessoa vinculada, e avisa o dono; senão não faz nada.
 * Devolve { key, nome, motivo, box } ou null.
 */
async function classificarContato(phone, h, avisar = true) {
  let pipelines;
  try {
    const lista = (await crmApi("GET", "/pipelines", undefined, { por: "whatsapp" })).pipelines ?? [];
    pipelines = await Promise.all(lista.map(async (p) => {
      const def = await crmApi("GET", `/pipelines/${encodeURIComponent(p.key)}`, undefined, { por: "whatsapp" });
      const cx = await crmApi("GET", `/pipelines/${encodeURIComponent(p.key)}/boxes?limit=6`, undefined, { por: "whatsapp" });
      return { key: p.key, name: p.name, stages: (def.stages ?? []).map((st) => st.name), exemplos: (cx.boxes ?? []).map((b) => b.name) };
    }));
  } catch (e) { log(`${phone}: classificar: ${e instanceof Error ? e.message : String(e)}`); return null; }
  if (pipelines.length === 0) return null;
  const nomeWa = nomeDoHistorico(h);
  const mensagens = threadFromHistory(h, 0).slice(-30).map((m) => ({ papel: m.role, texto: m.text }));
  let resp; try { resp = await askAgent(promptClassificacao({ pipelines, nome: nomeWa, telefone: phone, mensagens }), `crm-classificar:${phone}`, "claudecode"); } catch (e) { log(`${phone}: classificar: ${e instanceof Error ? e.message : String(e)}`); return null; }
  const c = parseClassificacao(resp, pipelines.map((p) => p.key));
  writeJson(ESTADO, mergeEstado(readJson(ESTADO, {}), phone, { classificadoEm: Date.now(), classificacao: c ? c.key : null }));
  if (c === null) { log(`${phone}: classificação: nenhum pipeline claro`); return null; }
  // Sem nome no WhatsApp, o nome que a conversa revela (ex.: "Rent a Car - WM"); em último caso o telefone.
  const nome = nomeWa || c.nome;
  const p = pipelines.find((x) => x.key === c.key);
  const r = streak(["box-create", "--pipeline", c.key, "--name", nome || phone, "--phone", phone]);
  if (r.erro) { log(`${phone}: classificação → ${p?.name}: box-create falhou: ${r.erro}`); return null; }
  log(`${phone}: classificado em "${p?.name}" (${Math.round(c.confianca * 100)}%: ${c.motivo})`);
  if (avisar) sendOwner(`📇 CRM: coloquei ${nome || phone} no pipeline "${p?.name}" (${c.motivo}). Se não for, apague a caixa no CRM.`);
  return { key: c.key, nome: nome || phone, pipeline: p?.name ?? c.key, motivo: c.motivo, box: r.box?.key ?? null };
}
/** Uma vez: todos os contatos do WhatsApp sem caixa passam pela classificação; o dono recebe um resumo só. */
async function classificarTodos() {
  const lista = contatosWhatsapp(); const feitos = []; let vistos = 0;
  for (const c of lista) {
    if (vistos >= 60) break;
    const f = streak(["box-find", "--phone", c.telefone, "--todos"]); if (f.erro || (f.total ?? 0) > 0) continue;
    vistos++;
    let h; try { h = history(`agent:main:whatsapp:direct:${c.telefone}`, 40); } catch { continue; }
    const r = await classificarContato(c.telefone, h, false); if (r) feitos.push(r);
  }
  const msg = feitos.length === 0 ? `📇 CRM: olhei ${vistos} contatos do WhatsApp sem caixa; nenhum encaixa claramente num pipeline.` : `📇 CRM: olhei ${vistos} contatos sem caixa e coloquei ${feitos.length} em pipelines:\n${feitos.map((f) => `• ${f.nome} → ${f.pipeline} (${f.motivo})`).join("\n")}`;
  log(msg.replace(/\n/g, " | ")); sendOwner(msg);
  console.log(JSON.stringify({ vistos, colocados: feitos }));
}
/**
 * Lista de contatos do WhatsApp: o que o plugin já anotou + toda conversa direta do OpenClaw (backfill), com o
 * nome tirado do histórico quando faltar (no máximo 1 tentativa por número a cada 24 h; 40 por rodada).
 */
function contatosWhatsapp() {
  const ARQ = path.join(DIR, "whatsapp-contatos.json");
  let lista = readJson(ARQ, {}).contatos ?? {};
  const dono = ownerPhone();
  try {
    const raw = openclaw(["gateway", "call", "sessions.list", "--json", "--params", JSON.stringify({ limit: 1000 })], 90_000);
    for (const s of JSON.parse(raw.slice(raw.indexOf("{"))).sessions ?? []) {
      const key = s.key ?? s.sessionKey; const tel = phoneOfSessionKey(key);
      if (typeof key !== "string" || !key.includes(":whatsapp") || !key.includes(":direct:") || tel === null || tel === dono || s.createdVia === "run") continue;
      lista = mesclarContatoWhatsapp(lista, { telefone: tel, em: s.createdAt ?? s.updatedAt });
    }
  } catch (e) { log(`contatos-whatsapp: sessions.list falhou: ${e instanceof Error ? e.message : String(e)}`); }
  let tentativas = 0;
  for (const [tel, c] of Object.entries(lista)) {
    if (c.nome || tentativas >= 40 || (c.nomeTentadoEm && Date.now() - c.nomeTentadoEm < 86_400_000)) continue;
    tentativas++;
    let nome = ""; try { nome = nomeDoHistorico(history(`agent:main:whatsapp:direct:${tel}`, 30)); } catch { /* sem histórico */ }
    lista = { ...mesclarContatoWhatsapp(lista, { telefone: tel, nome, em: c.ultimaEm }) };
    lista[tel] = { ...lista[tel], nomeTentadoEm: Date.now() };
  }
  writeJson(ARQ, { contatos: lista });
  return Object.entries(lista).map(([telefone, c]) => ({ telefone, nome: c.nome ?? "", primeiraEm: c.primeiraEm ?? 0, ultimaEm: c.ultimaEm ?? 0 }));
}
function discardPending() {
  const who = estado.ultimaProposta; if (!who) { sendOwner("📇 CRM: não há proposta pendente."); return; }
  const next = mergeEstado(estado, who, { propostas: [], propostasEm: null }); delete next.ultimaProposta; writeJson(ESTADO, next);
  log(`${who}: propostas descartadas`); sendOwner("📇 CRM: proposta descartada.");
}

const ranAsScript = (() => {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry === "") return false;
  try { return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url)); }
})();
if (ranAsScript) {
  boot();
  (async () => {
  if (argv[0] === "transcricao") {
    const phone = normalizePhone(argv[1]); if (phone === null) { console.log(JSON.stringify({ erro: "uso: transcricao +N" })); process.exit(1); }
    const since = Number(optv("desde") ?? 0) || 0;
    const h = history(`agent:main:whatsapp:direct:${phone}`);
    console.log(JSON.stringify({ telefone: phone, mensagens: threadFromHistory(h, since).slice(-80) })); return;
  }
  if (argv[0] === "contatos-whatsapp") { console.log(JSON.stringify({ contatos: contatosWhatsapp() })); return; }
  if (argv[0] === "classificar-todos") return withLock("classificar", () => classificarTodos());
  if (!proOk()) { log("sem plano Pro em vigor nesta máquina; nada feito"); return; }
  if (motorCrm() === "streak" && (typeof cfg.apiKey !== "string" || cfg.apiKey === "")) { log("crm.json sem apiKey (Streak); nada feito"); return; }
  if (flag("aplicar")) { const n = optv("aplicar"); const idx = n !== null && /^\d+$/.test(n) ? Number(n) : confirmIndex(optv("texto") ?? ""); return withLock("aplicar", () => applyPending(idx)); }
  if (flag("descartar")) return withLock("aplicar", () => discardPending());
  const command = optv("comando");
  if (flag("dono")) return withLock("dono", () => runForOwner(command ?? ""));
  const sessionKey = argv.find((a) => a.startsWith("agent:")); if (!sessionKey) { console.error("uso: crm-job.mjs <sessionKey> [--comando txt] | --dono --comando txt | --aplicar [n] | --descartar"); process.exit(2); }
  return withLock(phoneOfSessionKey(sessionKey) ?? sessionKey, () => runForContact(sessionKey, command));
  })().catch((e) => { log(`erro: ${e instanceof Error ? e.stack ?? e.message : String(e)}`); process.exit(1); });
}
