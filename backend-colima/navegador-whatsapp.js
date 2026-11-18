/**
 * navegador-whatsapp.js — o Navegador do dono para o agente do WhatsApp quando o gateway é o Hermes. Testado.
 *
 * No Hermes quem roda o Claude é este backend (modelo "whatsapp"), e o pedido não diz quem escreveu. Quem sabe é o
 * gateway: o plugin meu-bot-navegador (hook pre_llm_call) confere o remetente e, se ele está na lista marcada pelo dono
 * no app, grava um PASSE de uso único (navegador-passes/<nonce>.json) e põe `[meu-bot-nav:<nonce>]` no fim da mensagem
 * do turno. Aqui o marcador sai de TODAS as mensagens (o modelo nunca o vê) e só vale o da última fala: com passe
 * existente e não vencido, estado ligado, número ainda na lista e a porta do túnel no lugar, o turno ganha o Navegador.
 * Qualquer dúvida = sem Navegador (falha fechada). Escrever o marcador à mão no WhatsApp não adianta: só o plugin grava
 * passes, numa pasta 0700 do usuário.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ESTADO = 'navegador-whatsapp.json';
const PASSES = 'navegador-passes';
const PORTA = 'navegador-porta';
const MARCA_RE = /\s*\[meu-bot-nav:([0-9a-f]{32})\]/g;
const NUMERO_RE = /^\d{8,15}$/;
const SESSAO_RE = /^[\w:+.@=-]{1,160}$/;

function lerJson(f) { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (_) { return null; } }

/** O estado gravado pelo app: ligado e a lista de números marcados (só dígitos). Sem arquivo = desligado, ninguém. */
function lerEstado(dir) {
  const j = lerJson(path.join(dir, ESTADO)) || {};
  const numeros = Array.isArray(j.numeros) ? [...new Set(j.numeros.filter((n) => typeof n === 'string' && NUMERO_RE.test(n)))] : [];
  return { on: j.on === true, numeros };
}

/** Porta do túnel reverso (o app grava quando o túnel sobe e apaga quando cai); null = app fechado. */
function lerPorta(dir) {
  try { const n = Number(fs.readFileSync(path.join(dir, PORTA), 'utf8').trim()); return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : null; } catch (_) { return null; }
}

const semMarca = (t) => t.replace(MARCA_RE, '');
function noncesDe(t) { const out = []; for (const m of t.matchAll(MARCA_RE)) out.push(m[1]); return out; }

/**
 * Tira o marcador de todas as mensagens (texto simples ou partes) e devolve o nonce da ÚLTIMA fala do usuário, se ela
 * tiver exatamente um (dois = alguém colou um; não vale nenhum). Não altera as mensagens recebidas.
 */
function tirarMarcas(messages) {
  let ultimoUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i] && messages[i].role === 'user') { ultimoUser = i; break; }
  let nonce = null;
  const limpas = messages.map((m, i) => {
    if (!m) return m;
    const achados = [];
    let content = m.content;
    if (typeof content === 'string') { achados.push(...noncesDe(content)); content = semMarca(content); }
    else if (Array.isArray(content)) {
      content = content.map((b) => {
        if (!b || typeof b.text !== 'string') return b;
        achados.push(...noncesDe(b.text));
        return { ...b, text: semMarca(b.text) };
      });
    }
    if (i === ultimoUser && achados.length === 1) nonce = achados[0];
    return achados.length > 0 ? { ...m, content } : m;
  });
  return { messages: limpas, nonce };
}

/**
 * Confere e consome o passe do turno. Devolve `{ numero, sessao }` ou `{ motivo }`. O arquivo é apagado ao ser lido
 * (uso único), valha ou não.
 */
function consumirPasse(dir, nonce, agoraMs) {
  if (typeof nonce !== 'string' || !/^[0-9a-f]{32}$/.test(nonce)) return { motivo: 'sem passe' };
  const f = path.join(dir, PASSES, `${nonce}.json`);
  const p = lerJson(f);
  try { fs.unlinkSync(f); } catch (_) { /* não havia */ }
  if (p === null) return { motivo: 'passe não existe' };
  if (typeof p.exp !== 'number' || !(p.exp * 1000 > agoraMs)) return { motivo: 'passe vencido' };
  if (typeof p.numero !== 'string' || !NUMERO_RE.test(p.numero)) return { motivo: 'passe sem número' };
  const estado = lerEstado(dir);
  if (!estado.on) return { motivo: 'desligado' };
  if (!estado.numeros.includes(p.numero)) return { motivo: 'número fora da lista' };
  const sessao = typeof p.sessao === 'string' && SESSAO_RE.test(p.sessao) ? p.sessao : `whatsapp:dm:${p.numero}`;
  return { numero: p.numero, sessao };
}

/** Passes vencidos que ninguém consumiu (turno que caiu antes de chegar aqui): some com eles. */
function faxinarPasses(dir, agoraMs) {
  const d = path.join(dir, PASSES);
  let nomes = [];
  try { nomes = fs.readdirSync(d); } catch (_) { return 0; }
  let n = 0;
  for (const nome of nomes) {
    const f = path.join(d, nome);
    const p = lerJson(f);
    if (p === null || typeof p.exp !== 'number' || !(p.exp * 1000 > agoraMs)) { try { fs.unlinkSync(f); n++; } catch (_) { /* outro turno apagou */ } }
  }
  return n;
}

/**
 * O turno do WhatsApp (Hermes): as mensagens sem marcador e, se o passe vale e o app está aberto, o Navegador do turno
 * (`{ port, dono }`, no formato que o pontes.js espera). `motivo` explica o "não" para o log.
 */
function resolverTurno({ messages, dir, agoraMs }) {
  const { messages: limpas, nonce } = tirarMarcas(messages);
  if (nonce === null) return { messages: limpas, browser: null, motivo: null };
  const passe = consumirPasse(dir, nonce, agoraMs);
  faxinarPasses(dir, agoraMs);
  if (passe.motivo) return { messages: limpas, browser: null, motivo: passe.motivo };
  const port = lerPorta(dir);
  if (port === null) return { messages: limpas, browser: null, motivo: 'app fechado (sem a porta do túnel)', numero: passe.numero };
  return { messages: limpas, browser: { port, dono: { id: passe.sessao, rotulo: 'WhatsApp', origem: 'whatsapp' } }, motivo: null, numero: passe.numero };
}

module.exports = { ESTADO, PASSES, PORTA, lerEstado, lerPorta, tirarMarcas, consumirPasse, faxinarPasses, resolverTurno };
