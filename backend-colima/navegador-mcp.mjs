#!/usr/bin/env node
/**
 * navegador-mcp.mjs — servidor MCP (stdio) do Navegador do meu-bot, um arquivo só, sem dependências.
 * Apresenta ao Claude as ações do navegador da pessoa e repassa cada uma por HTTP para 127.0.0.1:<porta>,
 * onde o túnel SSH reverso entrega ao app no Mac. Uso: node navegador-mcp.mjs --port 19123
 * ou --port-file <arquivo>: o agente do WhatsApp (OpenClaw, ligado 24 h) lê a porta a cada chamada do arquivo que o
 * app grava quando o túnel sobe; sem arquivo ou sem resposta, o Navegador está fechado (app fechado no Mac do dono).
 * Protocolo: JSON-RPC 2.0, uma mensagem por linha (initialize, tools/list, tools/call, ping, notifications).
 * Cada pedido leva quem está pedindo (cabeçalho X-Meu-Bot-Dono): cada conversa trabalha nas próprias abas.
 * meu-bot-navegador v5
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';

const arg = (name) => process.argv.find((a, i) => process.argv[i - 1] === name);
const fixedPort = Number(arg('--port') || process.env.MEU_BOT_BROWSER_PORT || 0);
const portFile = arg('--port-file') || '';
if (!fixedPort && !portFile) { process.stderr.write('navegador-mcp: falta --port ou --port-file\n'); process.exit(2); }
const FECHADO = portFile
  ? 'o Navegador do dono está fechado: o app meu-bot precisa estar aberto no Mac dele, com "agente pode usar" ligado na aba Navegador. Avise quem pediu e siga sem o navegador.'
  : 'o Navegador da pessoa não está ligado para o agente (abra a aba Navegador no app e ligue "agente pode usar")';
/**
 * Quem pede: no meu-bot, a conversa (--dono/--rotulo, do backend; com --origem whatsapp é a conversa do WhatsApp num
 * gateway Hermes, onde o próprio backend roda o turno); no agente do WhatsApp do OpenClaw (--port-file), a sessão do
 * OpenClaw se ela vier no ambiente, senão um id deste processo (o Claude Code de cada sessão abre o seu).
 */
const sessaoOpenClaw = (process.env.OPENCLAW_TOOLS_MCP_AGENT_SESSION_KEY || '').trim();
const DONO = arg('--dono')
  ? { id: arg('--dono'), rotulo: arg('--rotulo') || 'conversa do meu-bot', origem: arg('--origem') === 'whatsapp' ? 'whatsapp' : 'meu-bot' }
  : portFile
    ? { id: /^agent:[\w:+.@=-]{1,190}$/.test(sessaoOpenClaw) ? sessaoOpenClaw : `whatsapp-${crypto.randomBytes(4).toString('hex')}`, rotulo: 'WhatsApp', origem: 'whatsapp' }
    : null;
const DONO_HDR = DONO ? Buffer.from(JSON.stringify(DONO), 'utf8').toString('base64') : null;
function porta() {
  if (fixedPort) return fixedPort;
  try { const n = Number(fs.readFileSync(portFile, 'utf8').trim()); return Number.isInteger(n) && n > 1024 && n < 65536 ? n : 0; } catch { return 0; }
}

const TOOLS = [
  { name: 'abas', description: 'Lista as abas abertas no Navegador da pessoa (id, url, título, qual está ativa e de quem é: esta conversa, outra conversa ou da pessoa).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'abrir', description: 'Abre uma url (http/https) numa aba desta conversa (a primeira vez cria uma; depois reaproveita), ou numa aba nova com nova=true. Nunca na aba que a pessoa está usando. Espera carregar e devolve título/url.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, nova: { type: 'boolean' }, aba: { type: 'number' } }, required: ['url'], additionalProperties: false } },
  { name: 'ler', description: 'Lê a página: título, url, texto visível e a lista numerada de links, botões e campos. Use os números em clicar/digitar. Leia de novo depois de cada ação.', inputSchema: { type: 'object', properties: { aba: { type: 'number' } }, additionalProperties: false } },
  { name: 'clicar', description: 'Clica num elemento: por número da última leitura (n), por texto visível (texto) ou por seletor CSS (seletor).', inputSchema: { type: 'object', properties: { n: { type: 'number' }, texto: { type: 'string' }, seletor: { type: 'string' }, aba: { type: 'number' } }, additionalProperties: false } },
  { name: 'digitar', description: 'Digita texto num campo (por número n, seletor, ou no campo focado), apagando o que havia; enter=true confirma com Enter.', inputSchema: { type: 'object', properties: { texto: { type: 'string' }, n: { type: 'number' }, seletor: { type: 'string' }, enter: { type: 'boolean' }, aba: { type: 'number' } }, required: ['texto'], additionalProperties: false } },
  { name: 'tecla', description: 'Aperta uma tecla na página: enter, tab, esc, backspace, space, up, down, left, right, pageup, pagedown ou um caractere.', inputSchema: { type: 'object', properties: { tecla: { type: 'string' }, aba: { type: 'number' } }, required: ['tecla'], additionalProperties: false } },
  { name: 'print', description: 'Tira uma captura da aba (imagem PNG), para ver o layout quando o texto não basta.', inputSchema: { type: 'object', properties: { aba: { type: 'number' } }, additionalProperties: false } },
  { name: 'voltar', description: 'Volta uma página no histórico da aba.', inputSchema: { type: 'object', properties: { aba: { type: 'number' } }, additionalProperties: false } },
  { name: 'avancar', description: 'Avança uma página no histórico da aba.', inputSchema: { type: 'object', properties: { aba: { type: 'number' } }, additionalProperties: false } },
  { name: 'recarregar', description: 'Recarrega a aba.', inputSchema: { type: 'object', properties: { aba: { type: 'number' } }, additionalProperties: false } },
  { name: 'favoritos', description: 'Lista a barra de favoritos do Navegador da pessoa (id, título, url).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'favoritar', description: 'Adiciona uma url à barra de favoritos do Navegador da pessoa (título opcional; url repetida só atualiza o título).', inputSchema: { type: 'object', properties: { url: { type: 'string' }, titulo: { type: 'string' } }, required: ['url'], additionalProperties: false } },
  { name: 'desfavoritar', description: 'Tira um favorito da barra, pelo id (veja favoritos) ou pela url.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, url: { type: 'string' } }, additionalProperties: false } },
  { name: 'fechar', description: 'Fecha uma aba desta conversa (sem aba: a mais recente dela). Abas da pessoa ou de outra conversa não fecham. Feche as suas quando terminar: as abas da pessoa no mesmo site recarregam sozinhas, então ela vê o que você mudou.', inputSchema: { type: 'object', properties: { aba: { type: 'number' } }, additionalProperties: false } },
  { name: 'guardar', description: 'Guarda um segredo da página (token, chave de API) direto num arquivo desta máquina, SEM que o valor passe pela conversa: devolve só quantos caracteres gravou. Diga onde está o valor: seletor CSS (o value/texto do elemento) ou padrao (expressão regular no texto da página; o grupo 1, se houver). arquivo: caminho dentro de ~/.config/ (ex.: ~/.config/cloudflare/token); gravado com permissão 600. Use sempre que for salvar uma credencial.', inputSchema: { type: 'object', properties: { aba: { type: 'number' }, seletor: { type: 'string' }, padrao: { type: 'string' }, arquivo: { type: 'string' } }, required: ['arquivo'], additionalProperties: false } },
  { name: 'js', description: 'Roda JavaScript na página e devolve o resultado (último recurso; prefira ler/clicar/digitar).', inputSchema: { type: 'object', properties: { codigo: { type: 'string' }, aba: { type: 'number' } }, required: ['codigo'], additionalProperties: false } },
];

function call(route, body) {
  return new Promise((resolve, reject) => {
    const port = porta();
    if (!port) { reject(new Error(FECHADO)); return; }
    const data = JSON.stringify(body || {});
    // GET sem corpo não declara Content-Length (declarar 2 bytes e não mandar fazia o app engolir o começo do pedido
    // seguinte na mesma conexão: "abas" e depois "ler" dava HTTP 400). E uma conexão por pedido (agent: false).
    const get = route === 'abas';
    const req = http.request({ host: '127.0.0.1', port, path: `/${route}`, method: get ? 'GET' : 'POST', agent: false, headers: { ...(get ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }), ...(DONO_HDR ? { 'X-Meu-Bot-Dono': DONO_HDR } : {}) }, timeout: 60_000 }, (res) => {
      let out = ''; res.setEncoding('utf8'); res.on('data', (c) => { out += c; });
      res.on('end', () => { try { const j = JSON.parse(out || '{}'); if (res.statusCode !== 200) reject(new Error(j.erro || `o app recusou o pedido (HTTP ${res.statusCode}${out ? `: ${out.slice(0, 120)}` : ''}); tente de novo`)); else resolve(j); } catch (e) { reject(new Error(`resposta inválida do app: ${e.message}`)); } });
    });
    req.on('timeout', () => { req.destroy(new Error('o app não respondeu em 60 s')); });
    req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? FECHADO : e.message)));
    if (route !== 'abas') req.write(data);
    req.end();
  });
}

/**
 * "guardar": lê o valor na página (pela mesma ação js do app) e grava direto no arquivo desta máquina. O valor nunca volta
 * ao modelo; só o tamanho. Só dentro de ~/.config/ (sem "..", sem link), pasta 0700 e arquivo 0600, troca atômica.
 */
async function guardar(a) {
  const home = os.homedir();
  const alvo = path.resolve(String(a.arquivo || '').replace(/^~(?=\/)/, home));
  const base = path.join(home, '.config') + path.sep;
  if (!alvo.startsWith(base) || alvo.includes(`${path.sep}..`) || path.basename(alvo).startsWith('.')) throw new Error('arquivo precisa ficar dentro de ~/.config/ (ex.: ~/.config/cloudflare/token)');
  if (typeof a.seletor !== 'string' && typeof a.padrao !== 'string') throw new Error('diga onde está o valor: seletor ou padrao');
  const codigo = typeof a.seletor === 'string'
    ? `(() => { const e = document.querySelector(${JSON.stringify(a.seletor)}); if (!e) return ""; return String(("value" in e && e.value) || e.innerText || e.textContent || "").trim(); })()`
    : `(() => { const m = document.body.innerText.match(new RegExp(${JSON.stringify(a.padrao)})); return m ? String(m[1] ?? m[0]).trim() : ""; })()`;
  const r = await call('js', { aba: a.aba, codigo });
  const valor = typeof r.resultado === 'string' ? r.resultado.replace(/^"|"$/g, '') : '';
  if (valor === '' || valor === 'null') throw new Error('não achei o valor na página (confira o seletor ou o padrão com "ler", sem copiar o valor)');
  if (valor.length > 4096) throw new Error('o valor achado é grande demais para ser uma credencial: confira o seletor');
  const pasta = path.dirname(alvo);
  fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
  for (let p = pasta; p.startsWith(base); p = path.dirname(p)) { if (fs.lstatSync(p).isSymbolicLink()) throw new Error('caminho com link simbólico: recusado'); }
  const tmp = `${alvo}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, valor, { mode: 0o600 });
  fs.renameSync(tmp, alvo);
  return { ok: true, arquivo: alvo.replace(home, '~'), caracteres: valor.length };
}

function textOfRead(r) {
  const head = `# ${r.title || '(sem título)'}\n${r.url}\n\n`;
  const els = r.elements && r.elements.length ? `## Elementos (use o número em clicar/digitar)\n${r.elements.join('\n')}\n\n` : '## Elementos\n(nenhum interativo visível)\n\n';
  return `${head}${els}## Texto\n${r.text || '(vazio)'}${r.truncated ? '\n…(texto cortado)' : ''}`;
}

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'meu-bot-navegador', version: '4.0.0' } } });
  if (method === 'notifications/initialized' || (typeof method === 'string' && method.startsWith('notifications/'))) return;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const name = params?.name; const args = params?.arguments || {};
    try {
      if (!TOOLS.some((t) => t.name === name)) throw new Error(`ferramenta desconhecida: ${name}`);
      if (name === 'guardar') return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(await guardar(args)) }] } });
      const r = await call(name, args);
      if (name === 'print') return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'image', data: r.png_base64, mimeType: 'image/png' }] } });
      const text = name === 'ler' ? textOfRead(r) : JSON.stringify(r, null, 1);
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    } catch (e) {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true } });
    }
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `método não suportado: ${method}` } });
});
rl.on('close', () => process.exit(0));
