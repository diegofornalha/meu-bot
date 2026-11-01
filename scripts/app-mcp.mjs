#!/usr/bin/env node
/**
 * MCP de controle do app meu-bot neste Mac, para o Claude Code (um arquivo, sem npm). Fala com os sockets que cada app
 * aberto publica em /tmp/<app>-<uid>/: `term.sock` (terminal: term-api.ts) e `nav-<máquina>.sock` (Navegador:
 * nav-api.ts). Só funciona com o app aberto; nada passa pela rede. Quem pede aparece no app como "✳️ Claude Code (Mac)".
 *
 * Registro (uma vez): claude mcp add --scope user meu-bot-app -- node /caminho/scripts/app-mcp.mjs
 * Protocolo: JSON-RPC 2.0, uma mensagem por linha (initialize, tools/list, tools/call, ping, notifications).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const UID = os.userInfo().uid;
const DONO_HDR = Buffer.from(JSON.stringify({ id: 'claude-code:mac', rotulo: 'Claude Code (Mac)', origem: 'claude-code' }), 'utf8').toString('base64');
const APPS_DIR = path.join(os.homedir(), 'Applications');

/** Apps abertos: pasta /tmp/<app>-<uid> com term.sock; as máquinas vêm dos nav-<host>.sock. */
function apps() {
  const out = [];
  for (const d of fs.readdirSync('/tmp')) {
    const m = new RegExp(`^(meu-bot[\\w-]*)-${UID}$`).exec(d); if (!m) continue;
    const dir = path.join('/tmp', d); let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    if (!files.includes('term.sock')) continue;
    out.push({ app: m[1], dir, maquinas: files.filter((f) => /^nav-.+\.sock$/.test(f)).map((f) => f.slice(4, -5)) });
  }
  return out;
}
function appDe(nome) {
  const list = apps();
  if (nome) { const a = list.find((x) => x.app === nome); if (!a) throw new Error(`o app "${nome}" não está aberto (abertos: ${list.map((x) => x.app).join(', ') || 'nenhum'}); use app_abrir`); return a; }
  if (list.length === 1) return list[0];
  if (list.length === 0) throw new Error('nenhum app meu-bot aberto neste Mac: use app_abrir');
  throw new Error(`mais de um app aberto (${list.map((x) => x.app).join(', ')}): diga qual em "app"`);
}
function navSock(a, maquina) {
  if (maquina) { if (!a.maquinas.includes(maquina)) throw new Error(`o Navegador de "${maquina}" não está aberto no ${a.app} (abertos: ${a.maquinas.join(', ') || 'nenhum'}); abra a aba Navegador no app`); return path.join(a.dir, `nav-${maquina}.sock`); }
  if (a.maquinas.length === 1) return path.join(a.dir, `nav-${a.maquinas[0]}.sock`);
  if (a.maquinas.length === 0) throw new Error(`o ${a.app} está aberto, mas sem a aba Navegador (ou o agente não pode usar); abra-a no app`);
  throw new Error(`o ${a.app} tem Navegador de várias máquinas (${a.maquinas.join(', ')}): diga qual em "maquina"`);
}
function pedir(socketPath, route, body) {
  const get = body === undefined; const data = get ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: `/${route}`, method: get ? 'GET' : 'POST', agent: false, headers: { 'X-Meu-Bot-Dono': DONO_HDR, ...(get ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }) }, timeout: 90_000 }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let j; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reject(new Error(`resposta inválida do app (${res.statusCode})`)); } if (res.statusCode !== 200) return reject(new Error(j.erro || `HTTP ${res.statusCode}`)); resolve(j); });
    });
    req.on('timeout', () => { req.destroy(new Error('o app não respondeu em 90 s')); });
    req.on('error', (e) => reject(new Error(e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? 'o app fechou (socket sumiu); use apps para ver o que está aberto' : e.message)));
    if (!get) req.write(data); req.end();
  });
}
const S = (props, required = []) => ({ type: 'object', properties: props, required });
const APP = { app: { type: 'string', description: 'qual app (meu-bot, meu-bot-finance-staging…); opcional se só um está aberto' } };
const MAQ = { maquina: { type: 'string', description: 'máquina da janela (ex.: agente-box-lv); opcional se só uma' } };
const ABA = { aba: { type: 'number', description: 'id da aba do Navegador (veja nav_abas); sem ele, a aba desta conversa' } };
const TOOLS = [
  { name: 'apps', description: 'Apps meu-bot abertos neste Mac e as máquinas com Navegador aberto; também os apps instalados (para app_abrir).', inputSchema: S({}) },
  { name: 'app_abrir', description: 'Abre (ou traz) a janela de uma máquina num app meu-bot instalado. Leva ~10 s até os sockets aparecerem.', inputSchema: S({ app: { type: 'string' }, maquina: { type: 'string' } }, ['app', 'maquina']) },
  { name: 'terminais', description: 'Terminais abertos no app (id, máquina, número).', inputSchema: S(APP) },
  { name: 'terminal_abrir', description: 'Abre uma aba de terminal nova na janela da máquina e devolve o id e o prompt.', inputSchema: S({ ...APP, ...MAQ }) },
  { name: 'terminal_ler', description: 'Últimas linhas da tela de um terminal (sem cores).', inputSchema: S({ ...APP, id: { type: 'string' }, linhas: { type: 'number' } }, ['id']) },
  { name: 'terminal_digitar', description: 'Digita no terminal (a pessoa vê na hora). texto com enter=true roda o comando; ou tecla: enter, tab, esc, ctrl+c, ctrl+d, cima, baixo…', inputSchema: S({ ...APP, id: { type: 'string' }, texto: { type: 'string' }, enter: { type: 'boolean' }, tecla: { type: 'string' } }, ['id']) },
  { name: 'tela_dividir', description: 'Mais uma coluna na tela do app: um terminal (id) ou uma página (navegador, tutoriais, acervo, vazia).', inputSchema: S({ ...APP, ...MAQ, id: { type: 'string' }, pagina: { type: 'string', enum: ['navegador', 'tutoriais', 'acervo', 'vazia'] } }) },
  { name: 'tela_juntar', description: 'Tira uma coluna (id do terminal ou pagina) ou todas (sem argumentos).', inputSchema: S({ ...APP, ...MAQ, id: { type: 'string' }, pagina: { type: 'string', enum: ['navegador', 'tutoriais', 'acervo'] } }) },
  { name: 'nav_abas', description: 'Abas do Navegador do app (id, url, título, quem usa).', inputSchema: S({ ...APP, ...MAQ }) },
  { name: 'nav_abrir', description: 'Abre uma url numa aba desta conversa (nova=true força aba nova; aba=N navega naquela).', inputSchema: S({ ...APP, ...MAQ, url: { type: 'string' }, nova: { type: 'boolean' }, aba: { type: 'number' } }, ['url']) },
  { name: 'nav_ler', description: 'Texto da página e os elementos clicáveis numerados.', inputSchema: S({ ...APP, ...MAQ, ...ABA }) },
  { name: 'nav_clicar', description: 'Clica no elemento n (de nav_ler), ou por texto ou seletor CSS.', inputSchema: S({ ...APP, ...MAQ, ...ABA, n: { type: 'number' }, texto: { type: 'string' }, seletor: { type: 'string' } }) },
  { name: 'nav_digitar', description: 'Digita texto no campo n (ou seletor); enter=true confirma.', inputSchema: S({ ...APP, ...MAQ, ...ABA, n: { type: 'number' }, seletor: { type: 'string' }, texto: { type: 'string' }, enter: { type: 'boolean' } }, ['texto']) },
  { name: 'nav_tecla', description: 'Aperta uma tecla na página (enter, tab, esc, down, up…).', inputSchema: S({ ...APP, ...MAQ, ...ABA, tecla: { type: 'string' } }, ['tecla']) },
  { name: 'nav_print', description: 'Captura a aba como imagem.', inputSchema: S({ ...APP, ...MAQ, ...ABA }) },
  { name: 'nav_recarregar', description: 'Recarrega a aba.', inputSchema: S({ ...APP, ...MAQ, ...ABA }) },
  { name: 'nav_voltar', description: 'Volta uma página.', inputSchema: S({ ...APP, ...MAQ, ...ABA }) },
  { name: 'nav_js', description: 'Roda JavaScript na página e devolve o resultado (até 8000 caracteres).', inputSchema: S({ ...APP, ...MAQ, ...ABA, codigo: { type: 'string' } }, ['codigo']) },
  { name: 'nav_fechar', description: 'Fecha uma aba desta conversa.', inputSchema: S({ ...APP, ...MAQ, ...ABA }) },
  { name: 'nota', description: 'Escreve uma linha na faixa de depuração do app ("vou pedir ao agente para…"): a pessoa acompanha de fora o que você vai fazer. Só aparece com o modo de depuração ligado.', inputSchema: S({ ...APP, texto: { type: 'string' } }, ['texto']) },
  { name: 'depuracao', description: 'Liga (on=true), desliga (on=false) ou volta ao padrão da variante (on=null) o modo de depuração do app; sem on, só consulta.', inputSchema: S({ ...APP, on: { type: ['boolean', 'null'] } }) },
];
const NAV_ROTAS = { nav_abas: 'abas', nav_abrir: 'abrir', nav_ler: 'ler', nav_clicar: 'clicar', nav_digitar: 'digitar', nav_tecla: 'tecla', nav_print: 'print', nav_recarregar: 'recarregar', nav_voltar: 'voltar', nav_js: 'js', nav_fechar: 'fechar' };

async function call(name, args) {
  const { app, maquina, ...resto } = args;
  if (name === 'apps') {
    let instalados = []; try { instalados = fs.readdirSync(APPS_DIR).filter((f) => /^meu-bot.*\.app$/.test(f)).map((f) => f.slice(0, -4)); } catch { /* sem pasta */ }
    return { abertos: apps().map(({ app: a, maquinas }) => ({ app: a, maquinas })), instalados };
  }
  if (name === 'app_abrir') {
    if (!/^meu-bot[\w-]*$/.test(app) || !/^[\w.-]+$/.test(maquina)) throw new Error('app ou máquina inválidos');
    const bin = path.join(APPS_DIR, `${app}.app`); if (!fs.existsSync(bin)) throw new Error(`${bin} não existe`);
    await new Promise((res, rej) => execFile('open', ['-n', '-a', bin, '--args', `--host=${maquina}`], (e) => (e ? rej(e) : res())));
    const t0 = Date.now(); while (Date.now() - t0 < 25_000) { if (apps().some((x) => x.app === app)) break; await new Promise((r) => setTimeout(r, 500)); }
    return { ok: apps().some((x) => x.app === app), app, maquina };
  }
  const a = appDe(app);
  if (name === 'terminais') return pedir(path.join(a.dir, 'term.sock'), 'terminais');
  if (name === 'terminal_abrir') return pedir(path.join(a.dir, 'term.sock'), 'abrir', { maquina });
  if (name === 'terminal_ler') return pedir(path.join(a.dir, 'term.sock'), 'ler', resto);
  if (name === 'terminal_digitar') return pedir(path.join(a.dir, 'term.sock'), 'digitar', resto);
  if (name === 'tela_dividir') return pedir(path.join(a.dir, 'term.sock'), 'dividir', { ...resto, maquina });
  if (name === 'tela_juntar') return pedir(path.join(a.dir, 'term.sock'), 'juntar', { ...resto, maquina });
  if (name === 'nota') return pedir(path.join(a.dir, 'term.sock'), 'nota', { texto: resto.texto });
  if (name === 'depuracao') return pedir(path.join(a.dir, 'term.sock'), 'depuracao', 'on' in resto ? { on: resto.on } : {});
  const rota = NAV_ROTAS[name]; if (!rota) throw new Error(`ferramenta desconhecida: ${name}`);
  return pedir(navSock(a, maquina), rota, rota === 'abas' ? undefined : resto);
}

const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const rl = readline.createInterface({ input: process.stdin });
/** Chamadas em andamento: ao fechar a entrada, espera-as terminar (app_abrir leva segundos) antes de sair. */
let pendentes = 0; let fechando = false;
const terminou = () => { pendentes -= 1; if (fechando && pendentes === 0) process.exit(0); };
rl.on('line', async (line) => {
  pendentes += 1;
  try { await tratar(line); } finally { terminou(); }
});
async function tratar(line) {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'meu-bot-app', version: '1.0.0' } } });
  if (typeof method === 'string' && method.startsWith('notifications/')) return;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const name = params?.name; const args = params?.arguments || {};
    try {
      if (!TOOLS.some((t) => t.name === name)) throw new Error(`ferramenta desconhecida: ${name}`);
      const r = await call(name, args);
      if (name === 'nav_print') return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'image', data: r.png_base64, mimeType: 'image/png' }] } });
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(r) }] } });
    } catch (e) { return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true } }); }
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `método não suportado: ${method}` } });
}
rl.on('close', () => { fechando = true; if (pendentes === 0) process.exit(0); });
