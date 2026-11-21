#!/usr/bin/env node
/**
 * sugestoes.mjs — modo "sugere e você aprova" do WhatsApp (modo grátis, docs/planos/modo-gratis-sugestoes.md).
 * Com o modo ligado, a guarda (index.js, hook `message_sending`) não deixa o agente mandar nada sozinho: a resposta
 * vira uma sugestão na fila e a pessoa aprova (como está ou editada) ou descarta pelo app. Só a conversa do dono
 * consigo mesmo continua direta.
 *
 * Arquivos, todos em ~/.local/share/meu-bot (0600):
 *  - whatsapp-sugerir.json        {"ligado": true, "desde": iso}: o modo. Sem arquivo = desligado.
 *  - whatsapp-sugestoes.jsonl     a fila, uma sugestão por linha: {id, para, texto, em, sessao}.
 *  - whatsapp-sugestoes-passes.json  passes de uso único (2 min): o que a pessoa aprovou e a guarda deixa sair.
 *
 * CLI (o app chama na máquina; saída JSON numa linha, erro → {"erro": …} e código 1):
 *   estado | ligar | desligar | listar | aprovar <id> [--texto-b64 <base64url do texto editado>] | descartar <id|todas>
 * JS puro, sem dependência: o plugin local não recebe npm install.
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DIR_PADRAO = path.join(os.homedir(), ".local", "share", "meu-bot");
export const MAX_FILA = 500;
export const MAX_TEXTO = 4000;
export const PASSE_MS = 2 * 60_000;
const arq = (dir, nome) => path.join(dir, nome);
const MODO = "whatsapp-sugerir.json", FILA = "whatsapp-sugestoes.jsonl", PASSES = "whatsapp-sugestoes-passes.json";
const ID_RE = /^[a-z0-9]{12}$/;

/** Destino normalizado: grupo fica com o JID (…@g.us); contato vira "+dígitos". null = não dá para saber. */
export function alvoDe(to) {
  const s = String(to ?? "").trim();
  if (/^[0-9-]{5,40}@g\.us$/.test(s)) return s;
  const d = s.replace(/@.*$/, "").replace(/:.*$/, "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}
const hashDe = (para, texto) => createHash("sha256").update(`${para}\n${texto}`).digest("hex");

function lerJson(f, padrao) { try { const j = JSON.parse(fs.readFileSync(f, "utf8")); return j !== null && typeof j === "object" ? j : padrao; } catch { return padrao; } }
function gravar(f, texto) { fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, texto, { mode: 0o600 }); fs.renameSync(tmp, f); }

/** Uma operação por vez na fila (o gateway e a CLI escrevem nos mesmos arquivos): trava por pasta, com prazo. */
export function comTrava(dir, fn) {
  const trava = arq(dir, "whatsapp-sugestoes.lock");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fim = Date.now() + 3000;
  for (;;) {
    try { fs.mkdirSync(trava); break; }
    catch {
      // Trava velha (processo morto no meio): mais de 10 s, some.
      try { if (Date.now() - fs.statSync(trava).mtimeMs > 10_000) fs.rmdirSync(trava); } catch { /* outro já tirou */ }
      if (Date.now() > fim) throw new Error("a fila de sugestões está ocupada; tente de novo");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(trava); } catch { /* já saiu */ } }
}

export function modoLigado(dir = DIR_PADRAO) { return lerJson(arq(dir, MODO), {}).ligado === true; }
export function estado(dir = DIR_PADRAO) { const m = lerJson(arq(dir, MODO), {}); return { ligado: m.ligado === true, desde: typeof m.desde === "string" ? m.desde : null, pendentes: listar(dir).length }; }
export function mudarModo(dir, ligado, agora = Date.now()) { gravar(arq(dir, MODO), `${JSON.stringify({ ligado, desde: new Date(agora).toISOString() })}\n`); return estado(dir); }

/** Uma linha da fila, saneada; null para o que não é sugestão. */
export function lerLinha(l) {
  let d; try { d = JSON.parse(l); } catch { return null; }
  if (d === null || typeof d !== "object" || !ID_RE.test(String(d.id)) || typeof d.texto !== "string" || d.texto === "" || alvoDe(d.para) !== d.para || Number.isNaN(Date.parse(d.em))) return null;
  return { id: d.id, para: d.para, texto: d.texto.slice(0, MAX_TEXTO), em: d.em, sessao: typeof d.sessao === "string" ? d.sessao.slice(0, 200) : null };
}
export function listar(dir = DIR_PADRAO) {
  let bruto = ""; try { bruto = fs.readFileSync(arq(dir, FILA), "utf8"); } catch { return []; }
  return bruto.split("\n").map(lerLinha).filter((x) => x !== null);
}
const gravarFila = (dir, itens) => gravar(arq(dir, FILA), itens.map((i) => `${JSON.stringify(i)}\n`).join(""));

/**
 * Guarda a resposta do agente como sugestão. A mesma resposta para o mesmo destino, ainda pendente, não entra duas
 * vezes (o gateway repete o envio quando acha que falhou). Fila cheia: sai a mais antiga.
 */
export function guardar(dir, { para, texto, sessao = null }, agora = Date.now()) {
  const alvo = alvoDe(para), t = String(texto ?? "").trim().slice(0, MAX_TEXTO);
  if (alvo === null || t === "") return null;
  return comTrava(dir, () => {
    const fila = listar(dir);
    const igual = fila.find((i) => i.para === alvo && i.texto === t);
    if (igual !== undefined) return igual;
    const nova = { id: randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x").slice(0, 12), para: alvo, texto: t, em: new Date(agora).toISOString(), sessao };
    gravarFila(dir, [...fila, nova].slice(-MAX_FILA));
    return nova;
  });
}
export function tirar(dir, id) {
  return comTrava(dir, () => {
    const fila = listar(dir);
    const fica = id === "todas" ? [] : fila.filter((i) => i.id !== id);
    if (fica.length !== fila.length) gravarFila(dir, fica);
    return fila.length - fica.length;
  });
}

const lerPasses = (dir, agora) => (Array.isArray(lerJson(arq(dir, PASSES), {}).passes) ? lerJson(arq(dir, PASSES), {}).passes : []).filter((p) => p !== null && typeof p === "object" && typeof p.hash === "string" && typeof p.ate === "number" && p.ate > agora);
/** A pessoa aprovou este texto para este destino: a guarda deixa passar um envio igual, uma vez, por 2 min. */
export function darPasse(dir, para, texto, agora = Date.now()) {
  comTrava(dir, () => gravar(arq(dir, PASSES), JSON.stringify({ passes: [...lerPasses(dir, agora), { hash: hashDe(para, texto), ate: agora + PASSE_MS }] })));
}
/** O envio tem passe? Se tem, gasta e devolve true. */
export function gastarPasse(dir, para, texto, agora = Date.now()) {
  const alvo = alvoDe(para); if (alvo === null) return false;
  return comTrava(dir, () => {
    const passes = lerPasses(dir, agora), h = hashDe(alvo, String(texto ?? "").trim());
    const i = passes.findIndex((p) => p.hash === h);
    if (i === -1) return false;
    passes.splice(i, 1); gravar(arq(dir, PASSES), JSON.stringify({ passes }));
    return true;
  });
}
function tirarPasse(dir, para, texto) { try { gastarPasse(dir, para, texto); } catch { /* fica até vencer */ } }

/**
 * O que a guarda faz com um envio do WhatsApp: "passar" (modo desligado, conversa do dono, ou aprovado pela pessoa)
 * ou "segurar" (virou sugestão). Destino ilegível com o modo ligado também segura: na dúvida, nada sai sozinho.
 */
export function decidir(dir, { to, texto, sessao, dono }, agora = Date.now()) {
  if (!modoLigado(dir)) return { acao: "passar" };
  const alvo = alvoDe(to);
  if (alvo !== null && dono !== null && alvo === dono) return { acao: "passar" };
  if (alvo === null) return { acao: "segurar", sugestao: null };
  if (gastarPasse(dir, alvo, texto, agora)) return { acao: "passar", aprovado: true };
  return { acao: "segurar", sugestao: guardar(dir, { para: alvo, texto, sessao }, agora) };
}

/** Manda pelo OpenClaw (o mesmo comando do backend do meu-bot). `enviar` entra por parâmetro nos testes. */
const enviarOpenclaw = (para, texto) => new Promise((ok) => {
  const env = { ...process.env, PATH: `${os.homedir()}/.openclaw/bin:${os.homedir()}/.local/bin:/opt/node/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` };
  execFile("openclaw", ["message", "send", "--channel", "whatsapp", "--target", para, "-m", texto], { env, timeout: 120_000 }, (err, _o, stderr) => ok(err ? { ok: false, erro: String(stderr || err.message).trim().split("\n").pop() } : { ok: true }));
});
/** Aprova: dá o passe, manda (com o texto editado, se veio) e tira da fila. Falhou o envio: a sugestão fica. */
export async function aprovar(dir, id, textoEditado = null, enviar = enviarOpenclaw) {
  const s = listar(dir).find((i) => i.id === id);
  if (s === undefined) return { erro: "sugestão não encontrada (já aprovada ou descartada)" };
  const texto = textoEditado === null ? s.texto : String(textoEditado).trim().slice(0, MAX_TEXTO);
  if (texto === "") return { erro: "o texto ficou vazio; descarte a sugestão em vez de aprovar" };
  darPasse(dir, s.para, texto);
  const r = await enviar(s.para, texto);
  if (!r.ok) { tirarPasse(dir, s.para, texto); return { erro: `o WhatsApp não mandou: ${r.erro ?? "falha no envio"}` }; }
  tirar(dir, id);
  return { ok: true, id, para: s.para, texto, editada: texto !== s.texto };
}

async function cli(argv) {
  const [cmd, a, ...resto] = argv, dir = process.env.MEU_BOT_DIR || DIR_PADRAO;
  const sai = (o, code = 0) => { process.stdout.write(`${JSON.stringify(o)}\n`); process.exit(code); };
  try {
    if (cmd === "estado") sai(estado(dir));
    if (cmd === "ligar" || cmd === "desligar") sai(mudarModo(dir, cmd === "ligar"));
    if (cmd === "listar") sai({ ...estado(dir), sugestoes: listar(dir) });
    if (cmd === "descartar" && (a === "todas" || ID_RE.test(a ?? ""))) sai({ ok: true, descartadas: tirar(dir, a) });
    if (cmd === "aprovar" && ID_RE.test(a ?? "")) {
      const i = resto.indexOf("--texto-b64");
      const editado = i === -1 ? null : Buffer.from(String(resto[i + 1] ?? ""), "base64url").toString("utf8");
      const r = await aprovar(dir, a, editado);
      sai(r, "erro" in r ? 1 : 0);
    }
    sai({ erro: "uso: estado | ligar | desligar | listar | aprovar <id> [--texto-b64 <texto>] | descartar <id|todas>" }, 1);
  } catch (e) { sai({ erro: e instanceof Error ? e.message : String(e) }, 1); }
}
// Só roda a CLI quando este arquivo é o programa; carregado pelo gateway (import do index.js), não faz nada.
const ehPrograma = () => { try { return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; } };
if (ehPrograma()) await cli(process.argv.slice(2));
