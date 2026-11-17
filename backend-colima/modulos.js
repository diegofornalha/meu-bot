'use strict';
/**
 * Módulos de produto (o app meu-bot-diego e os próximos) na máquina, do lado do backend. O meu-bot só conhece este
 * contrato; o código de cada módulo vem do repositório do produto (submódulo) e o instalador dele grava:
 *   ~/.local/share/meu-bot/modulos/<id>/ligado      (existe = ligado; o desinstalador apaga a pasta)
 *   ~/.local/share/meu-bot/modulos/<id>/turno.json  { produto, perfis: ["whatsapp"…],
 *                                                     mcp: { <nome>: <config do Claude Code> },
 *                                                     regras: "regras.md",
 *                                                     acao: { padroes: [regex…], maxTurns, adendo } }
 *   ~/.config/meu-bot/modulos/<id>.env              (credenciais, 0600; o app grava, ninguém relê pelo app)
 * A cada turno de um perfil, o server.js junta os módulos ligados daquele perfil cujo produto a licença libera:
 * MCPs num arquivo temporário 0600 (as credenciais entram por ${VAR} só ali, nunca na linha de comando), as regras no
 * prompt de sistema e o ajuste de "ação" (mais passos e um adendo quando a mensagem pede uma tarefa). Sem módulos,
 * nada muda.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const BASE = path.join(os.homedir(), '.local', 'share', 'meu-bot', 'modulos');
const CONF = path.join(os.homedir(), '.config', 'meu-bot', 'modulos');
const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;
const NOME_MCP_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_REGRAS = 8000;

/** KEY=valor cru por linha (o app grava assim, sem aspas: modulos-core.ts credenciaisSh); linhas inválidas ficam de fora. */
function lerEnv(arquivo) {
  const out = {};
  let texto = '';
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch (_) { return out; }
  for (const linha of texto.split('\n')) {
    const m = /^\s*([A-Z][A-Z0-9_]{0,63})\s*=\s*(.*)$/.exec(linha);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** Troca ${VAR} pelos valores do módulo em todas as strings (objetos e listas); VAR ausente vira vazio. */
function expandir(v, env) {
  if (typeof v === 'string') return v.replace(/\$\{([A-Z][A-Z0-9_]{0,63})\}/g, (_, k) => (Object.prototype.hasOwnProperty.call(env, k) ? env[k] : ''));
  if (Array.isArray(v)) return v.map((x) => expandir(x, env));
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expandir(x, env)]));
  return v;
}

/** Regex de uma string do turno.json; inválida = null (ignorada, nunca derruba o turno). */
function regex(s) { try { return typeof s === 'string' && s.length <= 300 ? new RegExp(s, 'i') : null; } catch (_) { return null; } }

/**
 * Módulos ligados para `perfil`, já filtrados pela licença (`produtoOk(nome)`). Devolve
 * { mcp: {nome: config}, regras: [texto], acoes: [{ padroes: RegExp[], maxTurns, adendo }], ids: [id] }.
 */
function paraPerfil(perfil, produtoOk, { base = BASE, conf = CONF } = {}) {
  const out = { mcp: {}, regras: [], acoes: [], ids: [] };
  let ids = [];
  try { ids = fs.readdirSync(base).filter((d) => ID_RE.test(d)).sort(); } catch (_) { return out; }
  for (const id of ids) {
    const dir = path.join(base, id);
    if (!fs.existsSync(path.join(dir, 'ligado'))) continue;
    let t;
    try { t = JSON.parse(fs.readFileSync(path.join(dir, 'turno.json'), 'utf8')); } catch (_) { continue; }
    if (t === null || typeof t !== 'object' || typeof t.produto !== 'string' || !produtoOk(t.produto)) continue;
    const perfis = Array.isArray(t.perfis) ? t.perfis : [];
    if (!perfis.includes(perfil) && !perfis.includes('*')) continue;
    out.ids.push(id);
    const env = lerEnv(path.join(conf, `${id}.env`));
    if (t.mcp !== null && typeof t.mcp === 'object') {
      for (const [nome, cfg] of Object.entries(t.mcp)) if (NOME_MCP_RE.test(nome) && cfg !== null && typeof cfg === 'object') out.mcp[nome] = expandir(cfg, env);
    }
    if (typeof t.regras === 'string' && /^[\w.-]+\.md$/.test(t.regras)) {
      try { const r = fs.readFileSync(path.join(dir, t.regras), 'utf8').trim(); if (r !== '') out.regras.push(r.slice(0, MAX_REGRAS)); } catch (_) { /* sem regras */ }
    }
    const a = t.acao;
    if (a !== null && typeof a === 'object' && Array.isArray(a.padroes)) {
      const padroes = a.padroes.map(regex).filter((r) => r !== null);
      const maxTurns = Number.isInteger(a.maxTurns) && a.maxTurns >= 1 && a.maxTurns <= 200 ? a.maxTurns : null;
      if (padroes.length > 0) out.acoes.push({ padroes, maxTurns, adendo: typeof a.adendo === 'string' ? a.adendo.slice(0, 2000) : '' });
    }
  }
  return out;
}

/** A mensagem pede uma ação (bate num padrão de algum módulo)? { maxTurns, adendo } com o maior teto; null = conversa. */
function ajusteDaAcao(acoes, texto) {
  const t = String(texto || '');
  const batem = acoes.filter((a) => a.padroes.some((r) => r.test(t)));
  if (batem.length === 0) return null;
  const tetos = batem.map((a) => a.maxTurns).filter((n) => n !== null);
  return { maxTurns: tetos.length > 0 ? Math.max(...tetos) : null, adendo: batem.map((a) => a.adendo).filter(Boolean).join('\n\n') };
}

/** Grava os MCPs do turno num arquivo 0600 (o --mcp-config lê dele); devolve o caminho. Quem chama apaga no fim. */
function arquivoMcp(mcp, { base = BASE } = {}) {
  const dir = path.join(base, '.turnos');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = path.join(dir, `${crypto.randomBytes(8).toString('hex')}.json`);
  fs.writeFileSync(f, JSON.stringify({ mcpServers: mcp }), { mode: 0o600 });
  return f;
}

module.exports = { BASE, CONF, lerEnv, expandir, paraPerfil, ajusteDaAcao, arquivoMcp };
