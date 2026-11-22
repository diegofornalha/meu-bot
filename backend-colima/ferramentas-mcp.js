#!/usr/bin/env node
/**
 * ferramentas-mcp.js — servidor MCP (stdio) das Ferramentas do meu-bot, um arquivo só, sem dependências. É .js (e
 * não .mjs como os do Navegador e do Gmail) porque vai junto com o backend, e o install.sh copia os *.js da pasta.
 * Ferramenta é a conexão do agente com um app da pessoa (Gmail, Google Search Console, Notion…). Este conector só
 * apresenta três ações ao Claude e repassa cada uma por HTTP para 127.0.0.1:<porta>, onde o túnel SSH reverso entrega
 * ao app no Mac. É o app que sabe o que a conta comprou, mostra na conversa o cartão de conectar ou de confirmar e
 * pede a execução ao servidor da conta; a máquina não guarda credencial nenhuma. O molde é o gmail-mcp.mjs.
 * Uso: node ferramentas-mcp.js --port 19125 [--dono <id> --rotulo <texto> --origem whatsapp]
 * Protocolo: JSON-RPC 2.0, uma mensagem por linha (initialize, tools/list, tools/call, ping, notifications).
 * meu-bot-ferramentas v1
 */
'use strict';
const http = require('node:http');
const readline = require('node:readline');

const arg = (name) => process.argv.find((a, i) => process.argv[i - 1] === name);
const PORTA = Number(arg('--port') || process.env.MEU_BOT_FERRAMENTAS_PORT || 0);
if (!Number.isInteger(PORTA) || PORTA <= 1024 || PORTA >= 65536) { process.stderr.write('ferramentas-mcp: falta --port\n'); process.exit(2); }
const FECHADO = 'as ferramentas não estão ligadas para o agente agora: o app meu-bot precisa estar aberto no computador da pessoa, com a conta entrada. Avise a pessoa com esta frase.';
const DONO = arg('--dono') ? { id: arg('--dono'), rotulo: arg('--rotulo') || 'conversa do meu-bot', origem: arg('--origem') === 'whatsapp' ? 'whatsapp' : 'meu-bot' } : null;
const DONO_HDR = DONO ? Buffer.from(JSON.stringify(DONO), 'utf8').toString('base64') : null;
/** `usar` pode esperar a pessoa responder a um cartão na conversa (conectar, confirmar): o app expira em 5 min. */
const ESPERA_MS = { apps: 30_000, buscar: 60_000, usar: 6 * 60_000 };

const TOOLS = [
  { name: 'apps', description: 'Lista as ferramentas (apps) desta conta e a situação de cada uma: "pronta" (pode usar agora), "falta conectar" (a pessoa precisa autorizar; ao usar, o app mostra o cartão de conectar na conversa) ou "à venda" (não contratada). Chame antes de dizer que não tem acesso a um app.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'buscar', description: 'Acha as ações disponíveis para um pedido, em linguagem natural (ex.: "relatório de visitas do site na última semana", "criar evento na agenda"). Devolve o nome de cada ação, o app, o que ela faz, se lê ou se altera dados, e os argumentos que aceita. Use o nome da ação em "usar". `app` (opcional) restringe a um app pelo slug.', inputSchema: { type: 'object', properties: { pedido: { type: 'string' }, app: { type: 'string' } }, additionalProperties: false, required: ['pedido'] } },
  { name: 'usar', description: 'Executa uma ação de um app da pessoa. `acao` é o nome que veio de "buscar"; `argumentos` os dela; `motivo` é UMA frase em português, para a pessoa, dizendo o que vai acontecer (ex.: "Ler as visitas do site de 7 a 20 de novembro, sem alterar nada"): é o que ela lê no cartão antes de permitir. Se a ação altera, envia ou apaga algo, o app pede a confirmação dela na conversa e esta chamada espera a resposta. Se responder que foi cancelada, que falta conectar ou que não foi contratada, diga isso à pessoa com a frase que veio e não tente de outro jeito.', inputSchema: { type: 'object', properties: { acao: { type: 'string' }, argumentos: { type: 'object' }, motivo: { type: 'string' } }, additionalProperties: false, required: ['acao', 'motivo'] } },
];

function call(route, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request({ host: '127.0.0.1', port: PORTA, path: `/${route}`, method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...(DONO_HDR ? { 'X-Meu-Bot-Dono': DONO_HDR } : {}) }, timeout: ESPERA_MS[route] ?? 60_000 }, (res) => {
      let out = ''; res.setEncoding('utf8'); res.on('data', (c) => { out += c; });
      res.on('end', () => {
        let j; try { j = JSON.parse(out || '{}'); } catch { reject(new Error(`o app respondeu algo que não é JSON (HTTP ${res.statusCode})`)); return; }
        if (res.statusCode !== 200) reject(new Error(typeof j.erro === 'string' ? j.erro : `o app recusou o pedido (HTTP ${res.statusCode})`)); else resolve(j);
      });
    });
    req.on('timeout', () => { req.destroy(new Error(route === 'usar' ? 'a pessoa não respondeu a tempo no app; o pedido foi cancelado' : 'o app não respondeu a tempo')); });
    req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? FECHADO : e.message)));
    req.write(data);
    req.end();
  });
}

const SITUACAO = { pronta: 'pronta', 'falta-conectar': 'falta conectar', 'a-venda': 'à venda (não contratada)' };
function textoDeApps(r) {
  const apps = Array.isArray(r.apps) ? r.apps : [];
  if (apps.length === 0) return 'Esta conta ainda não tem nenhuma ferramenta. A pessoa contrata no Marketplace do meu-bot (página Ferramentas do app).';
  return apps.map((a) => `- ${a.nome} (${a.slug}) · ${SITUACAO[a.estado] || a.estado}${a.resumo ? `\n  ${String(a.resumo).slice(0, 160)}` : ''}`).join('\n');
}
function textoDeBuscar(r) {
  const acoes = Array.isArray(r.acoes) ? r.acoes : [];
  if (acoes.length === 0) return 'Nenhuma ação encontrada para esse pedido nas ferramentas desta conta. Chame "apps" para ver o que ela tem.';
  return acoes.map((a) => `- ${a.acao} · ${a.app} · ${a.tipo === 'leitura' ? 'só lê' : 'altera dados: a pessoa confirma antes'}\n  ${String(a.descricao || '').slice(0, 300)}${a.argumentos ? `\n  argumentos: ${JSON.stringify(a.argumentos).slice(0, 1500)}` : ''}`).join('\n');
}
/** O app responde `{ ok: true, resultado }` ou `{ ok: false, mensagem }` (cancelado, falta conectar, não contratada…). */
function textoDeUsar(r) {
  if (r.ok !== true) throw new Error(typeof r.mensagem === 'string' && r.mensagem !== '' ? r.mensagem : 'o app não executou a ação');
  const t = typeof r.resultado === 'string' ? r.resultado : JSON.stringify(r.resultado ?? null, null, 1);
  return t.length > 60_000 ? `${t.slice(0, 60_000)}\n(resultado cortado: peça menos dados por vez)` : t;
}

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'meu-bot-ferramentas', version: '1.0.0' } } });
  if (typeof method === 'string' && method.startsWith('notifications/')) return;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const name = params?.name; const args = params?.arguments || {};
    try {
      if (!TOOLS.some((t) => t.name === name)) throw new Error(`ação desconhecida: ${name}`);
      if (name === 'usar' && (typeof args.motivo !== 'string' || args.motivo.trim().length < 8)) throw new Error('falta o `motivo`: uma frase em português, para a pessoa, dizendo o que vai acontecer');
      const r = await call(name, args);
      const text = name === 'apps' ? textoDeApps(r) : name === 'buscar' ? textoDeBuscar(r) : textoDeUsar(r);
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    } catch (e) {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true } });
    }
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `método não suportado: ${method}` } });
});
rl.on('close', () => process.exit(0));
