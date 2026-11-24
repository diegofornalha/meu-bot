#!/usr/bin/env node
/**
 * claude-global.js — o Claude Code Global da máquina: a assinatura do root servindo todos os usuários, sem que o token
 * do root chegue a nenhum deles. Serviço do root (systemd meu-bot-claude-global), só em 127.0.0.1.
 *
 * O `claude` de cada usuário fala com este intermediário (ANTHROPIC_BASE_URL) no modo assinatura, com a chave do
 * usuário no lugar do token (CLAUDE_CODE_OAUTH_TOKEN; ver a conta "global" em contas-claude.js). Aqui a chave é
 * conferida, a autorização vira o token de acesso de uma conta do root e o pedido segue para api.anthropic.com; o
 * streaming e os cabeçalhos de limite voltam intactos, então o backend do usuário vê os rate_limit_event como sempre.
 *
 * - Rodízio do root: o mesmo registro de contas do tutorial 2, na pasta do root. Uma conta do root no limite passa
 *   para a próxima antes de responder; todas no limite, volta um 429 com os cabeçalhos de limite da Anthropic
 *   (status rejected e a hora do reset), e o usuário cai para a conta própria dele na hora.
 * - Renovação: só este processo renova o token (o refreshToken gira a cada renovação; cópias quebrariam), gravando de
 *   volta no mesmo .credentials.json, de forma atômica, então o `claude` do próprio root segue funcionando.
 * - Só passam os caminhos de mensagens. A API OAuth aceita mais coisa com o mesmo token (criar chave de API, por
 *   exemplo): um usuário não pode usar o intermediário para tirar uma credencial da conta do root.
 *
 * Arquivos (root, 700/600): /etc/meu-bot/claude-global/config.json ({porta}), chaves/<usuario> (a chave de cada um),
 * uso.json (chamadas por usuário). Sem dependências npm.
 */
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const contasClaude = require('./contas-claude');

const ETC = process.env.MEU_BOT_CLAUDE_GLOBAL_ETC || '/etc/meu-bot/claude-global';
const CHAVES = path.join(ETC, 'chaves');
const USO = path.join(ETC, 'uso.json');
const ROOT_CLAUDE = process.env.MEU_BOT_CLAUDE_GLOBAL_HOME || '/root/.claude';
const UPSTREAM = process.env.MEU_BOT_CLAUDE_GLOBAL_UPSTREAM || 'api.anthropic.com';
// O mesmo cliente OAuth do Claude Code (TOKEN_URL e CLIENT_ID do binário 2.1.x).
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
/** Renova quando faltam menos de 5 min. */
const MARGEM_MS = 5 * 60_000;
const MAX_CORPO = 64 * 1024 * 1024;
const CHAVE_RE = /^[A-Za-z0-9]{32,128}$/;
const USUARIO_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
/** O que o Claude Code precisa para conversar; o resto da API (OAuth, contas) não passa. */
const PERMITIDO = [/^\/v1\/messages(\/count_tokens)?(\?.*)?$/, /^\/v1\/models(\?.*)?$/];

const log = (m) => process.stdout.write(`${new Date().toISOString()} ${m}\n`);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
function writeJsonAtomico(f, v, mode = 0o600) {
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, typeof v === 'string' ? v : JSON.stringify(v), { mode });
  fs.renameSync(tmp, f);
}

// ---- chaves dos usuários (relidas quando a pasta muda) ----
let chaves = new Map(); // chave → usuário
let carimboChaves = null;
function carregarChaves() {
  let st = null; try { st = fs.statSync(CHAVES); } catch (_) { chaves = new Map(); carimboChaves = null; return; }
  const nomes = fs.readdirSync(CHAVES);
  const carimbo = `${st.mtimeMs}:${nomes.length}:${nomes.map((n) => { try { return fs.statSync(path.join(CHAVES, n)).mtimeMs; } catch (_) { return 0; } }).join(',')}`;
  if (carimbo === carimboChaves) return;
  const m = new Map();
  for (const n of nomes) {
    if (!USUARIO_RE.test(n)) continue;
    const k = String(fs.readFileSync(path.join(CHAVES, n), 'utf8')).trim();
    if (CHAVE_RE.test(k)) m.set(k, n);
  }
  chaves = m; carimboChaves = carimbo;
}
function usuarioDaChave(req) {
  const auth = String(req.headers.authorization || '');
  const k = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : String(req.headers['x-api-key'] || '').trim();
  if (!CHAVE_RE.test(k)) return null;
  carregarChaves();
  return chaves.get(k) || null;
}

// ---- uso por usuário (o admin mostra quem gasta o global) ----
const uso = readJson(USO) || {};
let usoSujo = false;
function anotarUso(usuario, conta, status) {
  const u = uso[usuario] || { chamadas: 0, limites: 0 };
  u.chamadas += 1; u.ultima = Math.floor(Date.now() / 1000); u.conta = conta;
  if (status === 429) u.limites = (u.limites || 0) + 1;
  uso[usuario] = u; usoSujo = true;
}
setInterval(() => { if (!usoSujo) return; usoSujo = false; try { writeJsonAtomico(USO, uso); } catch (e) { log(`uso: não gravei (${e.message})`); } }, 30_000).unref();

// ---- contas do root e tokens ----
const contas = contasClaude.abrir({ log: (m) => log(`contas: ${m}`) });
const credDe = (c) => path.join(c.home || ROOT_CLAUDE, '.credentials.json');
const renovando = new Map(); // arquivo → Promise

/**
 * Erro que é do login da conta (sem login, sem refreshToken, renovação recusada pela Anthropic): só este bloqueia a
 * conta até o admin entrar de novo. Queda de rede, timeout e 5xx não dizem nada sobre o login.
 */
function erroDeLogin(msg) { const e = new Error(msg); e.login = true; return e; }
/** A renovação foi recusada por causa do login (4xx, fora 408 e 429)? 5xx, 408 e 429 são do servidor ou passageiros. */
const recusaDeLogin = (status) => status >= 400 && status < 500 && status !== 408 && status !== 429;

async function renovar(arq) {
  const doc = readJson(arq);
  const o = doc && doc.claudeAiOauth;
  if (!o || !o.refreshToken) throw erroDeLogin('sem refreshToken no login do root');
  const r = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: CLIENT_ID, scope: (o.scopes || []).join(' ') }),
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok || !corpo.access_token) { const e = new Error(`renovação recusada (${r.status})`); e.login = recusaDeLogin(r.status); throw e; }
  // Relê antes de gravar: o `claude` do root pode ter renovado nesse meio tempo; o mais novo vence.
  const atual = readJson(arq) || doc;
  const a = atual.claudeAiOauth || o;
  if (typeof a.expiresAt === 'number' && a.expiresAt - Date.now() > MARGEM_MS && a.accessToken !== o.accessToken) return a.accessToken;
  a.accessToken = corpo.access_token;
  if (corpo.refresh_token) a.refreshToken = corpo.refresh_token;
  if (corpo.expires_in) a.expiresAt = Date.now() + corpo.expires_in * 1000;
  if (corpo.refresh_token_expires_in) a.refreshTokenExpiresAt = Date.now() + corpo.refresh_token_expires_in * 1000;
  atual.claudeAiOauth = a;
  writeJsonAtomico(arq, atual);
  log(`token renovado (${path.dirname(arq)})`);
  return a.accessToken;
}
async function tokenDe(c, forcar = false) {
  const arq = credDe(c);
  const o = (readJson(arq) || {}).claudeAiOauth;
  if (!o || !o.accessToken) throw erroDeLogin('conta do root sem login');
  if (!forcar && typeof o.expiresAt === 'number' && o.expiresAt - Date.now() > MARGEM_MS) return o.accessToken;
  if (!renovando.has(arq)) renovando.set(arq, renovar(arq).finally(() => renovando.delete(arq)));
  try { return await renovando.get(arq); } catch (e) {
    // Renovar falhou mas o token ainda vale alguns minutos: usa.
    if (!forcar && typeof o.expiresAt === 'number' && o.expiresAt > Date.now()) return o.accessToken;
    throw e;
  }
}

// ---- repasse ----
function cabecalhos(req, token, tamanho) {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (['host', 'connection', 'content-length', 'authorization', 'x-api-key', 'cookie', 'proxy-authorization'].includes(k)) continue;
    h[k] = v;
  }
  h.authorization = `Bearer ${token}`;
  const beta = new Set(String(h['anthropic-beta'] || '').split(',').map((s) => s.trim()).filter(Boolean));
  beta.add('oauth-2025-04-20');
  h['anthropic-beta'] = [...beta].join(',');
  h['content-length'] = String(tamanho);
  return h;
}
function enviar(req, corpo, token) {
  return new Promise((resolve, reject) => {
    const up = https.request({ host: UPSTREAM, path: req.url, method: req.method, headers: cabecalhos(req, token, corpo.length) }, resolve);
    up.on('error', reject);
    up.end(corpo);
  });
}
/**
 * Uso da conta do root pelos cabeçalhos da resposta (anthropic-ratelimit-unified-5h/7d-utilization 0..1 e -reset em
 * epoch s): anotado no registro, ele faz valer os limiares do rodízio (sessão/semana %), e a conta que passou do
 * limiar sai da frente antes de bater o limite.
 */
function anotarUsoDaConta(c, r) {
  const janela = (k) => {
    const u = Number(r.headers[`anthropic-ratelimit-unified-${k}-utilization`]);
    if (!Number.isFinite(u)) return undefined;
    const t = Number(r.headers[`anthropic-ratelimit-unified-${k}-reset`]);
    return { pct: u <= 1 ? Math.round(u * 100) : Math.round(u), resets: Number.isFinite(t) && t > 0 ? Math.floor(t > 1e12 ? t / 1000 : t) : null };
  };
  const sessao = janela('5h'); const semanal = janela('7d');
  if (sessao || semanal) { try { contas.registrarUso(c.id, { sessao, semanal }); } catch (_) { /* uso é cortesia */ } }
}
const resetDe = (r) => { const v = Number(r.headers['anthropic-ratelimit-unified-reset']); return Number.isFinite(v) && v > 0 ? Math.floor(v > 1e12 ? v / 1000 : v) : null; };
/**
 * O 429 é o limite da assinatura (e não um aperto passageiro do servidor)? A Anthropic marca o limite de verdade com
 * `anthropic-ratelimit-unified-status: rejected` (ou a janela 5h/7d rejeitada); o passageiro vem sem isso.
 */
function limiteDaAssinatura(r) {
  const h = (r && r.headers) || {};
  return ['anthropic-ratelimit-unified-status', 'anthropic-ratelimit-unified-5h-status', 'anthropic-ratelimit-unified-7d-status']
    .some((k) => String(h[k] || '').toLowerCase() === 'rejected');
}
function erro(res, status, tipo, msg) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type: tipo, message: msg } }));
}
const hora = (epochS) => new Date(epochS * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
/**
 * Todas as contas do root no limite: responde como a Anthropic responde um limite de verdade (429 com
 * `anthropic-ratelimit-unified-status: rejected` e o reset), e não um 429 qualquer. Com o 429 nu, o Claude Code
 * entendia "transitório" e ficava tentando de novo por minutos, sem emitir o rate_limit_event rejeitado que faz o
 * porteiro (OpenClaw, terminal) e o backend (app) caírem para a próxima conta; a pessoa via "trabalhando" sem fim.
 * `ate` é o epoch (s) em que a primeira conta volta; sem ele, o padrão do rodízio.
 */
function respostaEsgotado(res, ate) {
  const agora = Math.floor(Date.now() / 1000);
  const reset = Number.isFinite(ate) && ate > agora ? Math.floor(ate) : agora + contasClaude.ESGOTADA_PADRAO_S;
  res.writeHead(429, {
    'content-type': 'application/json',
    'retry-after': String(Math.max(1, reset - agora)),
    'anthropic-ratelimit-unified-status': 'rejected',
    'anthropic-ratelimit-unified-reset': String(reset),
    'anthropic-ratelimit-unified-representative-window': 'five_hour',
    'anthropic-ratelimit-unified-5h-status': 'rejected',
    'anthropic-ratelimit-unified-5h-utilization': '1',
    'anthropic-ratelimit-unified-5h-reset': String(reset),
  });
  res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: `o Claude Code Global está no limite até ${hora(reset)}; quem tem conta própria segue por ela` } }));
  return reset;
}

/**
 * Um pedido pelo rodízio das contas do root. `dep` troca o registro das contas, o envio e o token: é por onde o teste
 * encena a queda de rede e o login recusado sem falar com a Anthropic.
 */
async function atender(req, res, corpo, usuario, dep = {}) {
  const cs = dep.contas || contas; const mandar = dep.enviar || enviar; const token = dep.tokenDe || tokenDe;
  const tentadas = [];
  let ultimo429 = null;
  let semRede = null; // a última falha de rede (não é da conta): sem nenhuma resposta, vira 502 e o Claude Code tenta de novo
  for (;;) {
    const c = cs.escolher({ excluir: tentadas, permitirAviso: true });
    if (!c) {
      // O 429 da própria Anthropic traz os cabeçalhos de limite: passa intacto. Sem ele (todas já marcadas antes
      // deste pedido), a resposta sintética leva os mesmos cabeçalhos, senão o Claude Code fica tentando de novo.
      if (ultimo429) { anotarUso(usuario, null, 429); res.writeHead(ultimo429.statusCode, ultimo429.headers); return ultimo429.pipe(res); }
      // Nenhuma conta respondeu e o motivo foi a rede: não é limite. Dizer "no limite" faria o backend desistir do
      // Claude; o 502 o Claude Code repete sozinho.
      if (semRede) { anotarUso(usuario, null, 502); return erro(res, 502, 'api_error', 'o Claude Code Global não conseguiu falar com a Anthropic'); }
      anotarUso(usuario, null, 429);
      let ate = null; try { ate = cs.proximaDisponivelEm(); } catch (_) { ate = null; }
      log(`${usuario}: todas as contas do root no limite${ate ? ` (a primeira volta ${hora(ate)})` : ''}`);
      return respostaEsgotado(res, ate);
    }
    tentadas.push(c.id);
    let r;
    try {
      r = await mandar(req, corpo, await token(c));
      if (r.statusCode === 401) { r.resume(); r = await mandar(req, corpo, await token(c, true)); }
    } catch (e) {
      // Só o erro do login bloqueia a conta. Um `read ECONNRESET` no meio do pedido era gravado como "login do root"
      // e a conta ficava bloqueada até alguém desbloquear no admin: em 23 nov 2026, 21 h sem Claude na máquina.
      if (e && e.login) cs.marcar(c.id, 'bloqueada', `login do root: ${e.message}`);
      else semRede = e;
      log(`conta ${c.id}: ${e.message}${e && e.login ? '' : ' (falha de rede; conta mantida no rodízio)'}`);
      continue;
    }
    if (r.statusCode === 401) { r.resume(); cs.marcar(c.id, 'bloqueada', 'login do root recusado: entre de novo no admin'); continue; }
    if (r.statusCode === 429) {
      // Só o 429 de limite da assinatura tira a conta do rodízio. O passageiro ("Server is temporarily limiting
      // requests (not your usage limit)") não diz nada sobre a conta: marcado, deixava a máquina inteira uma hora
      // sem Claude com as contas em 13% de uso. Ele tenta a próxima conta e, sem nenhuma, volta intacto ao Claude
      // Code, que sabe esperar e tentar de novo.
      if (limiteDaAssinatura(r)) cs.marcar(c.id, 'esgotada', 'limite da assinatura', resetDe(r));
      else log(`conta ${c.id}: 429 passageiro da Anthropic (não é o limite da assinatura); conta mantida no rodízio`);
      if (ultimo429) ultimo429.resume();
      ultimo429 = r;
      continue;
    }
    if (ultimo429) ultimo429.resume();
    anotarUsoDaConta(c, r);
    anotarUso(usuario, c.id, r.statusCode);
    res.writeHead(r.statusCode, r.headers);
    return r.pipe(res);
  }
}

function servir(porta) {
  const srv = http.createServer((req, res) => {
    // Teste de conexão do Claude Code: responde aqui, sem levar nada para fora.
    if (req.method === 'HEAD' && req.url === '/api/hello') { res.writeHead(200); return res.end(); }
    if (req.method === 'GET' && req.url === '/saude') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
    const usuario = usuarioDaChave(req);
    if (!usuario) return erro(res, 401, 'authentication_error', 'chave do Claude Code Global inválida: o admin precisa ligar o global para este usuário');
    if (!PERMITIDO.some((re) => re.test(req.url))) { log(`${usuario}: recusado ${req.method} ${req.url}`); return erro(res, 403, 'permission_error', 'o Claude Code Global só atende conversas'); }
    const partes = []; let tam = 0;
    req.on('data', (d) => { tam += d.length; if (tam > MAX_CORPO) { req.destroy(); return; } partes.push(d); });
    req.on('end', () => {
      atender(req, res, Buffer.concat(partes), usuario).catch((e) => { log(`${usuario}: ${e.message}`); if (!res.headersSent) erro(res, 502, 'api_error', 'o Claude Code Global não conseguiu falar com a Anthropic'); else res.end(); });
    });
  });
  srv.listen(porta, '127.0.0.1', () => log(`ouvindo 127.0.0.1:${porta}`));
  return srv;
}

if (require.main === module) {
  const cfg = readJson(path.join(ETC, 'config.json')) || {};
  const porta = Number(process.env.MEU_BOT_CLAUDE_GLOBAL_PORTA || cfg.porta);
  if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) { log(`porta inválida em ${ETC}/config.json`); process.exit(1); }
  servir(porta);
}

module.exports = { servir, atender, usuarioDaChave, cabecalhos, anotarUsoDaConta, respostaEsgotado, limiteDaAssinatura, erroDeLogin, recusaDeLogin, PERMITIDO, CHAVE_RE, USUARIO_RE, carregarChaves };
