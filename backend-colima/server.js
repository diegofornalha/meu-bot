/**
 * server.js — backend OpenAI-compatível mínimo para o meu-bot, rodando na VM local do Colima.
 *
 * Sem dependências npm: só node:http. Cada turno spawna a CLI do Claude Code (login de assinatura,
 * sem API key) em modo -p com stream-json. Contrato igual ao backend da grokbot-1:
 *  - Authorization: Bearer $OPENAI_COMPAT_KEY (lido do .env ao lado deste arquivo).
 *  - GET /v1/models; POST /v1/chat/completions {model, messages, stream}.
 *  - stream=true sem cabeçalho → SSE legado (texto inteiro num chunk).
 *  - stream=true + X-Stream-Mode: live → SSE token a token, ": ping" a cada 15 s, finish_reason,
 *    usage e [DONE]; fechar a conexão aborta a CLI.
 *  - X-Conversation-Id + X-Conversation-Seen → retoma a sessão da CLI com --resume quando possível;
 *    resposta leva X-Session-Resumed: true|false.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { motorWhatsapp } = require('./motor-whatsapp');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const sessions = require('./session-map');
const toolEvents = require('./tool-events');
const navegador = require('./navegador');
const gmailPonte = require('./gmail');
const pontes = require('./pontes');
const NAVEGADOR_MCP = path.join(os.homedir(), '.local/share/meu-bot/navegador-mcp.mjs');
const GMAIL_MCP = path.join(os.homedir(), '.local/share/meu-bot/gmail-mcp.mjs');
/** Passos por mensagem quando o Navegador está ligado (o perfil "agente" tem 30 sem ele). */
const BROWSER_MAX_TURNS = 100;
const providers = require('./providers');
const nivel = require('./nivel-ferramentas');
const modulos = require('./modulos');
const { readClaudeStatus, refreshRateLimits } = require('./account-status');
const contasClaude = require('./contas-claude');
const licenca = require('./licenca');
const { createCrmApi } = require('./crm-api');
const { createFinanceApi } = require('./finance-api');
const { sincronizarInvestimentos } = require('./finance-crm-sync');
const { sincronizarVendas } = require('./crm-finance-vendas');
const saudeMaquina = require('./saude-maquina');
const cotaMod = require('./cota');
const { faxinar } = require('./faxina');

const ROOT = __dirname;
const ENV = loadEnv(path.join(ROOT, '.env'));
const KEY = ENV.OPENAI_COMPAT_KEY || process.env.OPENAI_COMPAT_KEY || '';
/** Chave própria do agente do WhatsApp (CRM_AGENT_KEY): identifica quem chama; o CRM recusa exclusão vinda dela. */
const AGENT_KEY = ENV.CRM_AGENT_KEY || process.env.CRM_AGENT_KEY || '';
/** Chave dos módulos de produto (MODULOS_KEY): só abre a rota /v1/meu-bot/avisar (modulos.js). */
const MODULOS_KEY = ENV.MODULOS_KEY || process.env.MODULOS_KEY || '';
const HOST = ENV.HOST || '127.0.0.1';
const PORT = Number(ENV.PORT || 8080);
const CLAUDE_BIN = ENV.CLAUDE_BIN || path.join(os.homedir(), '.local', 'bin', 'claude');
/** Versão da CLI (para saber se aceita --system-prompt-snapshot off); lida uma vez, em segundo plano. */
let CLAUDE_VERSION = '';
try { require('node:child_process').execFile(CLAUDE_BIN, ['--version'], { timeout: 10000 }, (e, out) => { if (!e) CLAUDE_VERSION = String(out).trim(); }); } catch (_) { /* fica vazio: sem a flag */ }
const WORKSPACE = ENV.WORKSPACE || path.join(os.homedir(), 'chat-workspace');
const TURN_TIMEOUT_MS = Number(ENV.TURN_TIMEOUT_MS || 10 * 60 * 1000);

const AGENT_WORKSPACE = ENV.AGENT_WORKSPACE || path.join(os.homedir(), 'agent-workspace');
/**
 * Diário das conversas que não passam pelo Claude Code (Grok, Hermes): sem ele, elas só existiriam no app. Uma
 * conversa por arquivo, uma linha JSON por mensagem ({at, role, model, provider, text}). O meu-bot-admin lista e lê;
 * "Copiar ID" aponta para cá; "Excluir" no app apaga (rota DELETE abaixo).
 */
const APP_CONVERSAS = path.join(os.homedir(), '.local', 'share', 'meu-bot', 'conversas');
/**
 * Segurança: quais Macs já usaram o meu-bot desta máquina (maquinas.json) e como avisar quando aparece um novo
 * (alertas.json: WhatsApp da própria pessoa; o e-mail saiu em 30 out). Como o aviso de "login numa máquina nova"
 * do Rambox. O app se apresenta em POST /v1/meu-bot/hello a cada abertura; o primeiro Mac de todos não avisa
 * (é a instalação), os seguintes avisam e ficam no registro de auditoria da máquina (auditoria.py).
 */
const MEU_BOT_DIR = path.join(os.homedir(), '.local', 'share', 'meu-bot');
const MACHINES_FILE = path.join(MEU_BOT_DIR, 'maquinas.json');
const ALERTS_FILE = path.join(MEU_BOT_DIR, 'alertas.json');
/** Licença da conta (plano, status, validade, limite de devices): o admin é dono e grava por SSH; o app só lê. */
const LICENSE_FILE = path.join(MEU_BOT_DIR, 'licenca.json');
/**
 * Versão mínima do meu-bot que este backend atende (vai na resposta do hello e no /health): abaixo dela o app
 * mostra "Atualização necessária" e só volta ao normal depois de reiniciar na versão nova. A constante acompanha
 * o backend (sobe quando uma rota muda de forma); o admin força uma mínima maior gravando por SSH
 * ~/.local/share/meu-bot/app-minima.json com {"versao": "x.y.z"}.
 */
const APP_MINIMA = '0.3.0';
const APP_MINIMA_FILE = path.join(MEU_BOT_DIR, 'app-minima.json');
const VERSAO_RE = /^\d+(\.\d+){1,3}(-[0-9A-Za-z.-]+)?$/;
function appMinima() {
  const v = readJson(APP_MINIMA_FILE, {}).versao;
  return typeof v === 'string' && VERSAO_RE.test(v) ? v : APP_MINIMA;
}
/** CRM próprio: rotas /v1/crm/* sobre ~/.local/share/meu-bot/crm/db (crm-api.js); exige o plano Pro (licenca.crmOk). */
const CRM_CONFIG = path.join(MEU_BOT_DIR, 'crm.json');
const CRM_DB = process.env.MEU_BOT_CRM_DB || path.join(MEU_BOT_DIR, 'crm', 'db');
/** Financeiro (produto meu-bot-finance): rotas /v1/finance/* sobre ~/.local/share/meu-bot/finance/db (finance-api.js). */
const FINANCE_DB = process.env.MEU_BOT_FINANCE_DB || path.join(MEU_BOT_DIR, 'finance', 'db');
const readJson = (f, fallback) => { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return v && typeof v === 'object' ? v : fallback; } catch (_) { return fallback; } };
function writeJson(f, v) { fs.mkdirSync(MEU_BOT_DIR, { recursive: true, mode: 0o700 }); const tmp = `${f}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); }
const alertPrefs = () => { const a = readJson(ALERTS_FILE, {}); return { whatsapp: a.whatsapp !== false }; };
/**
 * Registro de auditoria da máquina (quem: "sistema"): o auditoria.py ao lado é o dono do formato e da corrente. Na
 * subida, uma cópia vai para ~/.local/share/meu-bot/auditoria.py, que os plugins do OpenClaw usam (pausa automática).
 */
const AUDITORIA_PY = path.join(__dirname, 'auditoria.py');
try { fs.mkdirSync(MEU_BOT_DIR, { recursive: true, mode: 0o700 }); fs.copyFileSync(AUDITORIA_PY, path.join(MEU_BOT_DIR, 'auditoria.py')); } catch (_) { /* sem o arquivo (backend antigo): sem registro */ }
function auditar(acao, alvo) {
  const b64 = Buffer.from(JSON.stringify({ quem: { tipo: 'sistema', nome: 'backend' }, app: 'backend', acao, alvo: String(alvo ?? '').slice(0, 120) }), 'utf8').toString('base64url');
  require('node:child_process').execFile('python3', [AUDITORIA_PY, 'gravar', b64], { timeout: 15_000 }, (err) => { if (err) log(`auditoria: não gravou ${acao}: ${err.message}`); });
}
/** Número do próprio WhatsApp (creds do OpenClaw); null sem pareamento. */
function selfWhatsappNumber() {
  try { const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openclaw', 'credentials', 'whatsapp', 'default', 'creds.json'), 'utf8')); const m = /^(\d{8,15})[:@]/.exec((c.me && c.me.id) || ''); return m ? m[1] : null; } catch (_) { return null; }
}
/** Aviso ao próprio dono (Mac novo, vigia): pelo gateway da máquina, OpenClaw ou Hermes (sendWhatsapp). */
const sendWhatsappSelf = (text) => sendWhatsapp({ texto: text });
/**
 * WhatsApp pelo motor da máquina, pela mesma regra do app (motor-whatsapp.js: a escolha em whatsapp-agente; sem ela, o
 * Hermes com WhatsApp configurado, senão o binário que existir). `para` = número E.164 sem o "+" (padrão: o próprio
 * dono); `midia` = caminho de arquivo na máquina. OpenClaw: `openclaw message send` (--media). Hermes:
 * `hermes send --to whatsapp[:<número>]` (MEDIA:<caminho>). PicoClaw ainda não envia por aqui.
 */
const PATH_MOTORES = `${os.homedir()}/.openclaw/bin:${os.homedir()}/.local/bin:${process.env.PATH || ''}`;
const usaHermes = () => motorWhatsapp({ PATH: PATH_MOTORES }).motor === 'hermes';
function sendWhatsapp({ texto, para, midia }) {
  const env = { ...process.env, PATH: PATH_MOTORES };
  const hermes = usaHermes();
  const num = para || (hermes ? null : selfWhatsappNumber());
  if (!hermes && !num) return Promise.resolve(false);
  const [cmd, args] = hermes
    ? ['hermes', ['send', '--to', num ? `whatsapp:${num}` : 'whatsapp', '-q', midia ? `${texto}\nMEDIA:${midia}` : texto]]
    : ['openclaw', ['message', 'send', '--channel', 'whatsapp', '--target', `+${num}`, '-m', texto, ...(midia ? ['--media', midia] : [])]];
  return new Promise((resolve) => {
    execFile(cmd, args, { env, timeout: 120000 }, (err, _out, stderr) => {
      if (err) log(`WhatsApp (${cmd}) falhou: ${(stderr || err.message).toString().trim().split('\n').pop()}`);
      resolve(!err);
    });
  });
}
/** IPs com sessão SSH aberta agora (quem está entrando nesta máquina), melhor esforço. */
function sshPeers() {
  try { return [...new Set(require('child_process').execSync("ss -Htn state established '( sport = :22 )' 2>/dev/null | awk '{print $NF}' | sed 's/:[0-9]*$//'", { encoding: 'utf8', timeout: 3000 }).split('\n').map((s) => s.trim()).filter(Boolean))]; } catch (_) { return []; }
}
/** Licença da conta, criando o arquivo com os defaults (e carimbando "membro desde") na 1ª vez. */
function ensureLicense() {
  const raw = readJson(LICENSE_FILE, null);
  if (raw === null) { const lic = licenca.defaultLicense(); writeJson(LICENSE_FILE, lic); return lic; }
  const lic = licenca.parseLicense(raw);
  if (licenca.legadoCrmContratado(raw)) migrarLicencaLegada(raw, lic);
  return lic;
}
/**
 * Uma vez por máquina: a licença de antes de 22 out (plano personalizado ou add-on meu-bot-crm) é regravada já no
 * formato novo (personalizado → Pro + Finance; meu-bot-crm sai, o CRM vem do Pro). Quem tinha o CRM contratado seguia
 * no CRM próprio mesmo com a chave do Streak; sem motor gravado, ele é fixado no próprio para nada mudar em silêncio.
 */
function migrarLicencaLegada(raw, lic) {
  try {
    const crm = readJson(CRM_CONFIG, null);
    if (raw.status !== 'expired' && crm !== null && crm.motor !== 'proprio' && crm.motor !== 'streak') writeJson(CRM_CONFIG, { ...crm, motor: 'proprio' });
    writeJson(LICENSE_FILE, { ...lic, updatedAt: new Date().toISOString(), updatedBy: 'system' });
    log(`licença migrada: plano ${raw.plan} → ${lic.plan}; add-ons ${JSON.stringify(lic.produtos)}`);
  } catch (e) { log(`licença: migração falhou (${e.message}); segue lendo o formato antigo`); }
}
/** Licença + devices (ativos/pendentes) da conta, como o app e o admin veem. */
function licenseView() {
  const license = ensureLicense();
  const all = readJson(MACHINES_FILE, {}) || {};
  const devices = Object.entries(all).map(([id, v]) => ({
    id, name: v.name, user: v.user, platform: v.platform, app: v.app, apps: v.apps && typeof v.apps === 'object' ? v.apps : {},
    firstSeen: v.firstSeen, lastSeen: v.lastSeen,
    status: licenca.deviceStatus(v), requestedAt: typeof v.requestedAt === 'string' ? v.requestedAt : null,
  })).sort((a, b) => (Date.parse(b.lastSeen) || 0) - (Date.parse(a.lastSeen) || 0));
  const activeCount = devices.filter((d) => d.status === 'active').length;
  const pendingCount = devices.filter((d) => d.status === 'pending').length;
  return { license, devices, activeCount, pendingCount, deviceLimit: license.deviceLimit };
}
let crmApiInst = null;
/** Instância única da API do CRM (abre o db na 1ª chamada; sem CRM instalado só cria a pasta vazia). */
/**
 * Texto gerado pelo mesmo motor do chat (perfil "claudecode": só texto, sem ferramentas), para o resumo da caixa
 * no CRM. Chama este próprio servidor, então segue o fallback de provedores do chat. Conversa nova a cada pedido.
 */
function iaTexto(prompt, convId) {
  const body = JSON.stringify({ model: 'claudecode', messages: [{ role: 'user', content: prompt }], stream: false });
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${KEY}`, 'X-Conversation-Id': convId }, timeout: 3 * 60_000 }, (res) => {
      let t = ''; res.setEncoding('utf8'); res.on('data', (c) => { t += c; });
      res.on('end', () => { try { const j = JSON.parse(t); if (res.statusCode !== 200) reject(new Error(j.error?.message ?? `motor respondeu ${res.statusCode}`)); else resolve(String(j.choices?.[0]?.message?.content ?? '')); } catch (e) { reject(new Error(`resposta inválida do motor: ${e.message}`)); } });
    });
    req.on('timeout', () => req.destroy(new Error('o motor não respondeu em 3 min')));
    req.on('error', reject); req.write(body); req.end();
  });
}
function crmApi() {
  if (crmApiInst === null) {
    crmApiInst = createCrmApi({ dir: CRM_DB, configFile: CRM_CONFIG, licenseOk: () => licenca.crmOk(ensureLicense()), readJson, writeJson, json, readBody, log, iaTexto, semearIndicacao: true });
    crmApiInst.store.onChange(() => agendarSyncVendas());
  }
  return crmApiInst;
}
let financeApiInst = null;
/** Instância única da API do financeiro (abre o db na 1ª chamada). */
function financeApi() {
  if (financeApiInst === null) financeApiInst = createFinanceApi({ dir: FINANCE_DB, licenseOk: () => licenca.financeOk(ensureLicense()), json, readBody, log });
  return financeApiInst;
}
// Sincronização financeiro → CRM, com debounce: depois de uma rajada de escritas do financeiro, um upsert no pipeline
// "Investimentos & ROI". Só quando o financeiro e o CRM estão liberados. Falha de sync nunca atrapalha o financeiro.
// Sincronização CRM → financeiro (vendas): box que chega a "Vendido" num pipeline de vendas vira entrada com produto e
// peças (crm-finance-vendas.js). Disparada por qualquer mudança do CRM, com debounce; sem diferença, não grava nada.
let syncVendasTimer = null;
function agendarSyncVendas(espera = 2000) {
  if (syncVendasTimer !== null) return;
  syncVendasTimer = setTimeout(() => {
    syncVendasTimer = null;
    let lic; try { lic = ensureLicense(); } catch { return; }
    if (!licenca.financeOk(lic) || !licenca.crmOk(lic)) return;
    Promise.resolve().then(() => sincronizarVendas(crmApi(), financeApi())).then((r) => {
      if (r.criados || r.atualizados || r.removidos || r.pipelineCriado || r.erros.length) log(`sync crm→financeiro (vendas): ${r.criados} novas, ${r.atualizados} atualizadas, ${r.removidos} removidas${r.pipelineCriado ? `; pipeline ${r.pipelineCriado} criado` : ''}${r.erros.length ? `; erros: ${r.erros.slice(0, 3).map((e) => `${e.ref} ${e.motivo}`).join('; ')}` : ''}`);
    }).catch((e) => log(`sync crm→financeiro (vendas) falhou: ${e.message}`));
  }, espera);
  if (typeof syncVendasTimer.unref === 'function') syncVendasTimer.unref();
}
let syncCrmTimer = null;
function agendarSyncInvestimentos() {
  if (syncCrmTimer !== null) return;
  syncCrmTimer = setTimeout(() => {
    syncCrmTimer = null;
    let lic; try { lic = ensureLicense(); } catch { return; }
    if (!licenca.financeOk(lic) || !licenca.crmOk(lic)) return;
    Promise.resolve().then(() => sincronizarInvestimentos(financeApi(), crmApi())).catch((e) => log(`sync financeiro→crm falhou: ${e.message}`));
  }, 1500);
  if (typeof syncCrmTimer.unref === 'function') syncCrmTimer.unref();
}
async function announceMachine(m) {
  const machines = readJson(MACHINES_FILE, null);
  const first = machines === null; // primeiro Mac de todos: a própria instalação, sem aviso
  const all = machines || {};
  const now = new Date().toISOString();
  const known = all[m.id];
  const license = ensureLicense();
  // Device conhecido mantém o status; device novo entra ativo se cabe no limite, senão "pending" (mão levantada).
  const status = licenca.admitDevice(license, all, m.id);
  const prev = known || {};
  all[m.id] = {
    name: m.name, user: m.user, platform: m.platform, app: m.app,
    // Um Mac pode ter o meu-bot e o meu-bot-crm: cada app que se apresenta fica em apps[produto].
    apps: licenca.mergeApps(prev.apps, m.produto, m.app),
    firstSeen: known ? known.firstSeen : now, lastSeen: now, ips: sshPeers().slice(0, 5),
    status,
    ...(status === 'pending' ? { requestedAt: prev.requestedAt || now } : {}),
  };
  writeJson(MACHINES_FILE, all);
  if (known || first) return { fresh: false, status, deviceLimit: license.deviceLimit };
  const when = new Date().toLocaleString('pt-BR', { timeZone: process.env.TZ || 'America/Sao_Paulo' });
  const ips = all[m.id].ips.length ? ` · IP ${all[m.id].ips.join(', ')}` : '';
  const extra = status === 'pending'
    ? `\n\nEste device passou do limite do seu plano (${license.deviceLimit}). O pedido foi enviado ao admin para liberar um device a mais.`
    : '';
  const produto = typeof m.produto === 'string' && m.produto !== '' ? m.produto : 'meu-bot';
  const text = `${produto}: um Mac novo acabou de usar a sua máquina.\n\nNome: ${m.name} (${m.user})\nSistema: ${m.platform}\n${produto} ${m.app}${ips}\nQuando: ${when}${extra}\n\nSe não foi você, abra o meu-bot em Configurações › Suporte e peça ajuda ao admin.`;
  auditar(status === 'pending' ? 'device.pedido' : 'device.novo', `${m.name} (${m.user}, ${m.platform})`);
  const ok = alertPrefs().whatsapp ? await sendWhatsappSelf(text) : null;
  log(`máquina nova ${m.name} (${m.id}) status=${status}: whatsapp=${ok}`);
  return { fresh: true, status, deviceLimit: license.deviceLimit };
}
const MACHINE_FIELD_RE = /^[\p{L}\p{N} ._()-]{1,60}$/u;
const appConvFile = (convId) => path.join(APP_CONVERSAS, `${convId}.jsonl`);
function appendAppTranscript(convId, messages, model, provider, text) {
  try {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const at = new Date().toISOString();
    const lines = [];
    if (lastUser) lines.push(JSON.stringify({ at, role: 'user', model, provider, text: messageText(lastUser) }));
    lines.push(JSON.stringify({ at, role: 'assistant', model, provider, text }));
    fs.mkdirSync(APP_CONVERSAS, { recursive: true, mode: 0o700 });
    const f = appConvFile(convId);
    const fresh = !fs.existsSync(f);
    fs.appendFileSync(f, `${lines.join('\n')}\n`, { mode: 0o600 });
    if (fresh) fs.chmodSync(f, 0o600);
  } catch (e) { log(`diário ${convId}: não gravei (${e.message})`); }
}
const MODELS = {
  claudecode: { maxTurns: 8, cwd: WORKSPACE, bypass: false, description: 'chat puro via Claude Code (assinatura)' },
  agente: { maxTurns: 30, cwd: AGENT_WORKSPACE, bypass: true, description: 'agente com ferramentas, sem pedir permissão (--dangerously-skip-permissions), cwd ~/agent-workspace' },
  // O WhatsApp do Hermes chama este: o agente, com as ferramentas do nível do tutorial 7 (nivel-ferramentas.js).
  whatsapp: { maxTurns: 30, cwd: AGENT_WORKSPACE, bypass: true, nivel: true, description: 'agente do WhatsApp (Hermes): como o agente, com as ferramentas do nível de liberdade do tutorial 7' },
};

const CONV_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** providers.json: ordem de fallback (agente → grok-4 por padrão) e os provedores OpenAI-compatíveis (xAI). */
const PROVIDERS = providers.load(path.join(ROOT, 'providers.json'), { ...process.env, ...ENV }, log);
const listedModels = () => [
  ...Object.entries(MODELS).map(([id, p]) => ({ id, object: 'model', created: 0, owned_by: 'meu-bot', description: p.description })),
  ...providers.openaiModels(PROVIDERS).map((p) => ({ id: p.name, object: 'model', created: 0, owned_by: p.base_url, description: p.description })),
];

function loadEnv(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  } catch (_) { /* sem .env: só variáveis de ambiente */ }
  return out;
}

function log(...a) { console.log(new Date().toISOString(), '[backend]', ...a); }
let lastLimitsWhy = null;
/** Conta do Claude que respondeu por último (id); é a que o /status descreve. */
let ultimaConta = 'padrao';
/**
 * Renova o cache de limites da conta pela API de uso (quando está velho) e passa o resultado ao registro de contas.
 * Devolve o motivo de refreshRateLimits. O `claude -p` não roda a status line; é daqui (e dos rate_limit_event do
 * stream) que o uso de cada conta vem.
 */
async function atualizarUsoPelaApi(c, maxAgeS) {
  // Global: o token é do root e nunca chega aqui; o uso vem dos rate_limit_event que passam pelo intermediário.
  if (c && c.global) return 'global';
  const configDir = contas.configDir(c);
  const why = await refreshRateLimits(maxAgeS === undefined ? { configDir } : { configDir, maxAgeS });
  const s = readClaudeStatus(os.homedir(), configDir);
  if (s.sessionPct !== null || s.weeklyPct !== null) {
    contas.registrarUso(c.id, { sessao: s.sessionPct !== null ? { pct: s.sessionPct, resets: s.sessionResets } : undefined, semanal: s.weeklyPct !== null ? { pct: s.weeklyPct, resets: s.weeklyResets } : undefined });
  }
  return why;
}
/** O /status da conta global: e-mail do admin e as janelas vistas nos rate_limit_event (sem ler o ~/.claude do usuário). */
function statusGlobal(c) {
  const u = contas.usoEfetivo(c.id);
  return { email: contas.emailDe(c), assento: 'global', sessionPct: u.sessao ? u.sessao.pct : null, weeklyPct: u.semanal ? u.semanal.pct : null, sessionResets: u.sessao ? u.sessao.resets : null, weeklyResets: u.semanal ? u.semanal.resets : null, updated: u.vistoEm || null, segments: readClaudeStatus(os.homedir()).segments };
}
/** "HH:MM" no fuso da máquina para um epoch em segundos. */
const horaLocal = (epochS) => new Date(epochS * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'America/Sao_Paulo' });

function json(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), ...extraHeaders });
  res.end(data);
}

/**
 * Quem está chamando, pela chave que usou: 'app' (OPENAI_COMPAT_KEY), 'agente' (CRM_AGENT_KEY) ou 'modulo'
 * (MODULOS_KEY, só a rota de aviso). null = inválida.
 * É o servidor que carimba a identidade; nenhum cabeçalho do cliente eleva ninguém.
 */
function papelDe(req) {
  if (!KEY) return 'app';
  const hdr = req.headers['authorization'] || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  const bate = (k) => k !== '' && token.length === k.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(k));
  if (bate(KEY)) return 'app';
  if (bate(AGENT_KEY)) return 'agente';
  if (bate(MODULOS_KEY)) return 'modulo';
  return null;
}
function authOk(req) { return papelDe(req) !== null; }

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('corpo grande demais')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function messageText(m) {
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('');
  return '';
}

/** Achata mensagens OpenAI num prompt único; 'system' vai para --append-system-prompt. */
function flatten(messages) {
  const sys = []; const convo = [];
  for (const m of messages) {
    const text = messageText(m);
    if (!text) continue;
    if (m.role === 'system') sys.push(text);
    else if (m.role === 'assistant') convo.push(`Assistant: ${text}`);
    else convo.push(`User: ${text}`);
  }
  return { system: sys.join('\n\n'), prompt: convo.join('\n\n') };
}

function sysHash(messages) {
  const s = messages.filter((m) => m && m.role === 'system').map(messageText).join('\n');
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/**
 * Roda a CLI uma vez. onDelta recebe texto incremental. Resolve {text, usage, sessionId, deltas}.
 * Rejeita com Error({code:'resume_failed'|'cli_failed'|'aborted'|'timeout'}).
 */
/**
 * Limite do modelo da conta (ex.: "You've reached your Fable limit"): a CLI devolve isso como texto de resposta.
 * Reconhecido antes de chegar ao cliente (as primeiras ~120 letras ficam retidas até descartar a hipótese) e vira
 * erro `model_limit`; o chamador refaz o turno com o modelo reserva (MODEL_FALLBACK, padrão Opus 5.5) e fica nele
 * até o limite passar (LIMIT_HOLD_MS), sem bater de novo no limite a cada mensagem.
 */
const LIMIT_RE = /you(?:'|’)?ve (?:reached|hit) your [\w .-]{1,40}limit/i;
const MODEL_FALLBACK = process.env.MODEL_FALLBACK || 'claude-opus-5-5';
const MODEL_FALLBACK_LABEL = process.env.MODEL_FALLBACK_LABEL || 'Opus 5.5';
const LIMIT_HOLD_MS = Number(process.env.LIMIT_HOLD_MS) > 0 ? Number(process.env.LIMIT_HOLD_MS) : 60 * 60 * 1000;
/** Limite do modelo por conta (id → {until, what}): o reserva de uma conta não vaza para as outras. */
const limiteModelo = new Map();
const limiteModeloAtivo = (contaId) => { const l = limiteModelo.get(contaId); return !!l && Date.now() < l.until; };
/**
 * Contas do Claude Code desta máquina (contas-claude.js): a padrão (~/.claude) e as isoladas, com rodízio ao bater
 * o limite. A ordem de reação num turno é: próxima conta (mesmo modelo, mesma sessão) → Opus na mesma conta → Grok.
 */
const contas = contasClaude.abrir({ log });
/** Só para teste: MEU_BOT_FORCAR_LIMITE=<id da conta>[:<n>] faz a n-ésima chamada daquela conta (padrão: a 1ª) parecer "limite atingido". */
const forcar = /^(padrao|c-[a-f0-9]{8})(?::(\d+))?$/.exec(ENV.MEU_BOT_FORCAR_LIMITE || process.env.MEU_BOT_FORCAR_LIMITE || '');
let forcarLimite = forcar ? forcar[1] : '';
let forcarNa = forcar && forcar[2] ? Number(forcar[2]) : 1;
/** Nome legível do modelo que o Claude Code usa agora: o reserva durante o limite; senão o da conta (settings.json). */
const MODEL_LABELS = { fable: 'Fable 5.1', 'claude-fable-5-1': 'Fable 5.1', opus: 'Opus 5.5', 'claude-opus-5-5': 'Opus 5.5', sonnet: 'Sonnet 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', haiku: 'Haiku 5.5', 'claude-haiku-5-5': 'Haiku 5.5' };
function currentModelLabel(conta) {
  if (limiteModeloAtivo(conta ? conta.id : 'padrao')) return MODEL_FALLBACK_LABEL;
  const dir = contas.configDir(conta) || path.join(os.homedir(), '.claude');
  let m = ''; try { m = String(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).model || ''); } catch (_) { /* sem settings */ }
  const k = m.toLowerCase().replace(/\[.*\]$/, '');
  return MODEL_LABELS[k] || (m || null);
}

function runClaude({ prompt, system, cwd, maxTurns, bypass, resume, signal, onDelta, onTool, browser, gmail, model, conta, bloqueadas, mcpModulos }) {
  return new Promise((resolve, reject) => {
    const contaId = conta ? conta.id : 'padrao';
    // Limite forçado (teste): a conta parece esgotada antes de a CLI subir.
    if (forcarLimite !== '' && forcarLimite === contaId && --forcarNa <= 0) { forcarLimite = ''; const e = new Error('limite de uso forçado (MEU_BOT_FORCAR_LIMITE)'); e.code = 'conta_limite'; e.resets = Math.floor(Date.now() / 1000) + 5 * 60; reject(e); return; }
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--max-turns', String(maxTurns)];
    args.push(...(bypass ? ['--dangerously-skip-permissions'] : ['--permission-mode', 'default']));
    // Pontes do app ligadas neste turno (Navegador, Gmail): os MCPs entram pela porta do túnel reverso de cada um (pontes.js).
    args.push(...pontes.pontesCliArgs({ browser, gmail, nodeBin: process.execPath, navegadorMcp: NAVEGADOR_MCP, gmailMcp: GMAIL_MCP, snapshotOff: navegador.cliSupportsSnapshotOff(CLAUDE_VERSION) }));
    // Módulos de produto ligados para este perfil (modulos.js): os MCPs deles vêm de um arquivo 0600 do turno.
    if (mcpModulos) args.push('--mcp-config', mcpModulos);
    if (Array.isArray(bloqueadas) && bloqueadas.length > 0) args.push('--disallowedTools', bloqueadas.join(','));
    if (system) args.push('--append-system-prompt', system);
    if (resume) args.push('--resume', resume);
    if (model) args.push('--model', model);
    fs.mkdirSync(cwd, { recursive: true });
    // MEU_BOT_PORTEIRO=0: se CLAUDE_BIN for o porteiro (claude-porteiro.sh), ele passa direto; o rodízio aqui já escolheu a conta.
    // Backend como root (VPS dedicada, ex.: meu-root): o Claude Code recusa --dangerously-skip-permissions como root, e
    // todo turno do agente caía no Grok. IS_SANDBOX=1 é o jeito dele de aceitar numa máquina dedicada (28 out).
    const sandbox = bypass && typeof process.getuid === 'function' && process.getuid() === 0 ? { IS_SANDBOX: '1' } : {};
    const child = spawn(CLAUDE_BIN, args, { cwd, env: { ...process.env, HOME: os.homedir(), MEU_BOT_PORTEIRO: '0', ...sandbox, ...contas.ambiente(conta) }, stdio: ['pipe', 'pipe', 'pipe'] });
    let text = ''; let deltas = 0; let usage = null; let sessionId = resume || null; let stderr = '';
    let limiteVisto = null; // último rate_limit_event (para o `ate` da conta)
    let resultText = null; let finished = false; let blockOpen = false; let sawTextBlock = false;
    const toolNames = new Map(); // tool_use_id → nome (o tool_result só traz o id)
    const timer = setTimeout(() => { fail('timeout', `CLI excedeu ${TURN_TIMEOUT_MS} ms`); }, TURN_TIMEOUT_MS);
    const onAbort = () => fail('aborted', 'cliente fechou a conexão');
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }

    function fail(code, msg) {
      if (finished) return; finished = true; clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 3000).unref();
      const e = new Error(msg); e.code = code; e.stderr = stderr.slice(-2000);
      if (code === 'conta_limite' && limiteVisto && limiteVisto.resets) e.resets = limiteVisto.resets;
      reject(e);
    }
    // As primeiras letras ficam retidas: se forem o aviso de limite do modelo, o turno falha sem nada ter saído.
    let held = ''; let released = false;
    function release() { if (released) return; released = true; if (held && onDelta) onDelta(held); held = ''; }
    function emit(t) {
      if (!t) return; text += t; deltas++;
      if (released) { if (onDelta) onDelta(t); return; }
      held += t;
      if (LIMIT_RE.test(held)) { fail('model_limit', held.trim().split('\n')[0].slice(0, 200)); return; }
      if (held.length >= 120) release();
    }

    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch (_) { continue; }
        handle(ev);
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.stdin.on('error', () => {});
    const notas = pontes.pontesTurnoNotas({ browser, gmail, browserNote: navegador.browserTurnNote, gmailNote: gmailPonte.gmailTurnNote });
    child.stdin.end(notas.length > 0 ? `${notas.join('\n')}\n\n${prompt}` : prompt);

    function handle(ev) {
      if (ev.session_id && !sessionId) sessionId = ev.session_id;
      // Uso da conta, direto do Claude Code (system/rate_limit_event): registra as janelas; `rejected` é o limite duro,
      // e o turno falha como `conta_limite` antes de qualquer texto sair — quem chama tenta a próxima conta.
      if (ev.type === 'rate_limit_event' || ev.rate_limit_info || ev.type === 'system' || ev.type === 'result') {
        const rl = contasClaude.analisarRateLimit(ev);
        if (rl !== null) {
          limiteVisto = rl;
          if (Object.keys(rl.janelas).length) contas.registrarUso(contaId, rl.janelas);
          if (rl.rejeitado) { fail('conta_limite', `limite de uso da conta (${rl.tipo})`); return; }
        }
      }
      if (onTool && (ev.type === 'assistant' || ev.type === 'user')) { for (const t of toolEvents.toolEventsFrom(ev, toolNames)) onTool(t); }
      if (ev.type === 'system' && ev.session_id) sessionId = ev.session_id;
      if (ev.type === 'stream_event' && ev.event) {
        const e = ev.event;
        if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'text') {
          if (sawTextBlock && text && !text.endsWith('\n\n')) emit('\n\n');
          blockOpen = true; sawTextBlock = true;
        } else if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') {
          emit(e.delta.text);
        } else if (e.type === 'content_block_stop') {
          blockOpen = false;
        }
      } else if (ev.type === 'result') {
        if (ev.session_id) sessionId = ev.session_id;
        usage = ev.usage || null;
        if (typeof ev.result === 'string') resultText = ev.result;
        if (resultText && LIMIT_RE.test(resultText) && !released) { fail('model_limit', resultText.trim().split('\n')[0].slice(0, 200)); return; }
        // Limite de passos desta mensagem: a resposta parava no meio sem dizer nada. Avisa e diz como seguir.
        if (ev.subtype === 'error_max_turns' && text) emit(`\n\n_(Parei aqui: cheguei ao limite de ${maxTurns} passos desta mensagem. Mande "continua" que eu sigo de onde parei.)_`);
        if (ev.is_error && !text) { fail(looksLikeResumeFailure(ev, stderr) ? 'resume_failed' : 'cli_failed', resultText || ev.subtype || 'erro da CLI'); }
      }
    }

    child.on('error', (e) => fail('cli_failed', `não consegui iniciar a CLI: ${e.message}`));
    child.on('close', (code) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (!deltas && resultText) { text = resultText; }
      if (LIMIT_RE.test(text.slice(0, 300))) { const e = new Error(text.trim().split('\n')[0].slice(0, 200)); e.code = 'model_limit'; return reject(e); }
      release();
      if (!text) {
        const code2 = looksLikeResumeFailure(null, stderr) ? 'resume_failed' : 'cli_failed';
        const e = new Error(`CLI saiu com código ${code} sem texto`); e.code = code2; e.stderr = stderr.slice(-2000); return reject(e);
      }
      if (/^\s*not logged in/i.test(text) || /please run \/?login/i.test(text) || /authentication_failed|invalid.*(oauth|token)|login expired/i.test(`${text.slice(0, 300)}\n${stderr.slice(-500)}`)) {
        contas.marcar(contaId, 'bloqueada', contaId === 'global' ? 'o Claude Code Global recusou: o admin precisa conferir' : 'login vencido: entre de novo nesta conta');
        const e = new Error(conta && conta.home ? `Claude Code deslogado na conta "${conta.rotulo}": entre de novo` : 'Claude Code deslogado na VM: rode `claude /login` lá'); e.code = 'auth'; return reject(e);
      }
      resolve({ text, usage, sessionId, deltas, blockOpen });
    });
  });
}

function looksLikeResumeFailure(ev, stderr) {
  const s = `${ev && ev.result ? ev.result : ''}\n${stderr || ''}`;
  return /no conversation found|session.*not found|could not resume|invalid session|unable to resume/i.test(s);
}

/** Decide prompt e --resume a partir dos cabeçalhos de conversa (mesma regra do backend original). */
function planPrompt({ messages, convId, seenHdr, key, cwd, hash }) {
  const flat = flatten(messages);
  const fallback = { prompt: flat.prompt, system: flat.system, resume: null };
  if (!convId) return fallback;
  const entry = sessions.get(key);
  if (!entry) return fallback;
  if (entry.cwd !== cwd || entry.sysHash !== hash || !sessions.sessionFileExists(cwd, entry.sessionId)) { sessions.del(key); return fallback; }
  const convo = messages.filter((m) => m.role !== 'system' && messageText(m));
  const hdr = Number.parseInt(String(seenHdr ?? ''), 10);
  const seen = Number.isInteger(hdr) ? hdr : entry.seen;
  if (!(seen > 0 && seen < convo.length)) return fallback;
  const fresh = convo.slice(seen);
  if (!fresh.some((m) => m.role === 'user')) return fallback;
  const prompt = fresh.length === 1 ? messageText(fresh[0]) : flatten(fresh).prompt;
  return { prompt, system: flat.system, resume: entry.sessionId };
}

function convoCount(messages) { return messages.filter((m) => m.role !== 'system' && messageText(m)).length; }

function chunk(id, created, model, delta, finish_reason = null) {
  return { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason }] };
}
function usageChunk(id, created, model, usage) {
  const input = (usage && usage.input_tokens) || 0; const output = (usage && usage.output_tokens) || 0;
  return { id, object: 'chat.completion.chunk', created, model, choices: [], usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } };
}
function usageObj(usage) {
  const input = (usage && usage.input_tokens) || 0; const output = (usage && usage.output_tokens) || 0;
  return { prompt_tokens: input, completion_tokens: output, total_tokens: input + output };
}

async function chatCompletions(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { error: { message: `JSON inválido: ${e.message}`, type: 'invalid_request_error' } }); }
  const model = String(body.model || 'claudecode');
  const openaiProvider = providers.byName(PROVIDERS, model);
  if (!MODELS[model] && !(openaiProvider && openaiProvider.type === 'openai' && openaiProvider.available)) {
    return json(res, 404, { error: { message: `modelo desconhecido: ${model}`, type: 'invalid_request_error', code: 'model_not_found' } });
  }
  const messages = Array.isArray(body.messages) ? body.messages.filter((m) => m && typeof m.role === 'string') : [];
  if (!messages.some((m) => m.role === 'user')) return json(res, 400, { error: { message: 'messages precisa ter ao menos um user', type: 'invalid_request_error' } });
  const stream = body.stream === true;
  const live = stream && String(req.headers['x-stream-mode'] || '').toLowerCase() === 'live';

  // Navegador do agente (módulo Pro): só com a porta válida, licença Pro ativa e o MCP instalado na máquina.
  let browser = null;
  const browserPort = navegador.parseBrowserPort(req.headers['x-meu-bot-browser-port']);
  if (browserPort !== null) {
    const lic = licenseView().license;
    if (!licenca.proOk(lic)) log(`navegador pedido sem Pro (plano ${lic.plan}/${lic.status}); ignorado`);
    else if (!fs.existsSync(NAVEGADOR_MCP)) log(`navegador pedido, mas ${NAVEGADOR_MCP} não existe; ignorado`);
    else browser = { port: browserPort };
  }
  // Gmail do agente (módulo Pro, 31 out): a mesma regra do Navegador, com o próprio MCP e a própria porta.
  let gmail = null;
  const gmailPort = gmailPonte.parseGmailPort(req.headers['x-meu-bot-gmail-port']);
  if (gmailPort !== null) {
    const lic = licenseView().license;
    if (!licenca.proOk(lic)) log(`gmail pedido sem Pro (plano ${lic.plan}/${lic.status}); ignorado`);
    else if (!fs.existsSync(GMAIL_MCP)) log(`gmail pedido, mas ${GMAIL_MCP} não existe; ignorado`);
    else gmail = { port: gmailPort };
  }
  const convRaw = req.headers['x-conversation-id'];
  const convId = typeof convRaw === 'string' && CONV_ID_RE.test(convRaw) ? convRaw : null;
  // Dono das abas que este turno abrir no Navegador (cada conversa trabalha nas próprias abas): id da conversa + título.
  if (browser !== null && convId !== null) browser.dono = { id: `meu-bot:${convId}`, rotulo: navegador.parseRotulo(req.headers['x-meu-bot-browser-rotulo']) };
  if (gmail !== null && convId !== null) gmail.dono = { id: `meu-bot:${convId}`, rotulo: navegador.parseRotulo(req.headers['x-meu-bot-browser-rotulo']) };
  const hash = sysHash(messages);
  const id = `chatcmpl-${crypto.randomBytes(8).toString('hex')}`;
  const created = Math.floor(Date.now() / 1000);
  const t0 = Date.now();
  // Corrente: o pedido primeiro, depois os outros por prioridade. Fora do providers.json → só ele.
  // "whatsapp" segue a mesma corrente do "agente" (o Grok de reserva), começando por ele.
  const attempts = model === 'whatsapp' ? ['whatsapp', ...providers.chain(PROVIDERS, 'agente').slice(1)] : providers.chain(PROVIDERS, model);
  if (attempts.length === 0) attempts.push(model);
  const env = { ...process.env, ...ENV };

  const run = async () => {
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableFinished) abort.abort(); });

    let used = model; let resumed = false; let usedKey = null; let usedProfile = null; let contaUsada = null;
    let headersSent = false; let heartbeat = null; let firstDeltaAt = 0;
    const pendingNotes = []; // fallbacks ocorridos antes de abrir o SSE ({from, to, reason, tipo?})

    const startSse = () => {
      if (headersSent) return;
      headersSent = true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', 'X-Session-Resumed': resumed ? 'true' : 'false', 'X-Provider': used,
      });
      res.flushHeaders && res.flushHeaders();
      res.write(`data: ${JSON.stringify(chunk(id, created, used, { role: 'assistant', content: '' }))}\n\n`);
      for (const n of pendingNotes.splice(0)) res.write(`data: ${JSON.stringify(providers.fallbackChunk(id, created, used, n.from, n.to, n.reason, n.tipo))}\n\n`);
      heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
    };
    const onDelta = live ? (t) => { if (!firstDeltaAt) firstDeltaAt = Date.now(); startSse(); res.write(`data: ${JSON.stringify(chunk(id, created, used, { content: t }))}\n\n`); } : null;
    // Atividade do agente (ferramentas): só no modo live, como chunk próprio; não conta como texto para o fallback.
    const onTool = live ? (t) => { startSse(); res.write(`data: ${JSON.stringify(toolEvents.toolChunk(id, created, used, t))}\n\n`); } : null;

    /** Aviso de troca (provedor, modelo ou conta) no stream, ou guardado até abrir o SSE. */
    const avisar = (from, to, reason, tipo) => {
      const note = { from, to, reason, ...(tipo ? { tipo } : {}) };
      if (headersSent) res.write(`data: ${JSON.stringify(providers.fallbackChunk(id, created, used, note.from, note.to, note.reason, note.tipo))}\n\n`);
      else pendingNotes.push(note);
    };

    /**
     * Um provedor claude: escolhe a conta, planeja resume pela chave dele e refaz sem resume se a sessão sumiu.
     * No limite de uso, a ordem é: próxima conta com a mesma sessão (o histórico é compartilhado, o --resume continua
     * a conversa) → Opus na mesma conta por LIMIT_HOLD_MS → quem chamou desce para o próximo provedor (Grok).
     */
    const runClaudeProvider = async (name) => {
      const profile = MODELS[name];
      const key = convId ? `${name}:${convId}` : null;
      let plan = planPrompt({ messages, convId, seenHdr: req.headers['x-conversation-seen'], key, cwd: profile.cwd, hash });
      // WhatsApp do Hermes: o nível do tutorial 7, lido a cada turno (mudou no app, vale na próxima mensagem).
      const nivelTurno = profile.nivel ? nivel.nivelAtual() : 'age';
      const bloqueadas = profile.nivel ? nivel.ferramentasBloqueadas(nivelTurno) : [];
      const avisoNivel = profile.nivel ? nivel.avisoDoNivel(nivelTurno) : '';
      // O modelo sabe quem é (a pergunta "qual modelo é você?" não depende do que ele acha de si).
      // Módulos de produto (meu-bot-diego…) ligados para este perfil e liberados pela licença: regras, MCPs e o ajuste
      // de "ação" (mensagem que pede uma tarefa ganha mais passos e um adendo). Sem módulos, tudo como antes.
      let doModulo = { mcp: {}, regras: [], acoes: [], ids: [] };
      try { const lic = licenseView().license; doModulo = modulos.paraPerfil(name, (produto) => licenca.produtoOk(lic, produto)); } catch (e) { log(`módulos: ${e.message}`); }
      const ultimaFala = [...messages].reverse().find((m) => m.role === 'user');
      const acao = modulos.ajusteDaAcao(doModulo.acoes, ultimaFala ? messageText(ultimaFala) : '');
      const regrasModulos = [...doModulo.regras, ...(acao && acao.adendo ? [acao.adendo] : [])].join('\n\n');
      const identity = `Você responde dentro do meu-bot pelo Claude Code, perfil "${name}" (Anthropic). Se perguntarem qual modelo ou IA você é, diga exatamente isso.${browser ? `\n\n${navegador.BROWSER_RULE}` : ''}${gmail ? `\n\n${gmailPonte.GMAIL_RULE}` : ''}${avisoNivel ? `\n\n${avisoNivel}` : ''}${regrasModulos ? `\n\n${regrasModulos}` : ''}`;
      plan = { ...plan, system: plan.system ? `${identity}\n\n${plan.system}` : identity };
      resumed = Boolean(plan.resume);
      // A melhor conta agora (uma em aviso só se não há outra). Sem nenhuma: erro com a hora em que a próxima volta;
      // o chamador desce para o próximo provedor, como em qualquer falha antes de sair texto.
      const tentadas = [];
      let conta = contas.escolher({ permitirAviso: true });
      if (conta === null) {
        const volta = contas.proximaDisponivelEm();
        const e = new Error(volta ? `todas as contas do Claude estão no limite; a próxima volta às ${horaLocal(volta)}` : 'nenhuma conta do Claude logada nesta máquina');
        e.code = 'sem_conta'; throw e;
      }
      // Limite do modelo desta conta recente: vai direto ao reserva até passar.
      let model = limiteModeloAtivo(conta.id) ? MODEL_FALLBACK : undefined;
      // No reserva, o modelo sabe que é ele (a identidade padrão não diz o modelo).
      const withModel = (p) => (model ? { ...p, system: `${p.system}\n\nNeste turno o modelo é o ${MODEL_FALLBACK_LABEL} (${MODEL_FALLBACK}): o modelo padrão da conta bateu o limite de uso.` } : p);
      // Com o Navegador, cada clique, leitura e print é um passo: 30 acabava no meio de um formulário (Cloudflare, 22 out).
      const maxTurns = Math.max(browser ? Math.max(profile.maxTurns, BROWSER_MAX_TURNS) : profile.maxTurns, acao && acao.maxTurns ? acao.maxTurns : 0);
      let mcpModulos = null;
      if (Object.keys(doModulo.mcp).length > 0) { try { mcpModulos = modulos.arquivoMcp(doModulo.mcp); } catch (e) { log(`módulos: MCP do turno não gravado (${e.message})`); } }
      if (doModulo.ids.length > 0) log(`módulos no turno ${name}: ${doModulo.ids.join(', ')}${acao ? ' (ação)' : ''}`);
      const call = () => runClaude({ ...withModel(plan), cwd: profile.cwd, maxTurns, bypass: profile.bypass, signal: abort.signal, onDelta, onTool, browser, gmail, model, conta, bloqueadas, mcpModulos });
      let out;
      try {
      for (let tries = 0; ; tries++) {
        try { out = await call(); break; }
        catch (e) {
          if (e.code === 'resume_failed' && plan.resume && !headersSent && tries < 3) {
            log(`resume falhou para ${key}; refazendo sem resume`);
            if (key) sessions.del(key);
            plan = { ...flatten(messages), resume: null }; resumed = false;
            plan = { ...plan, system: plan.system ? `${identity}\n\n${plan.system}` : identity };
            continue;
          }
          const limite = e.code === 'conta_limite' || (e.code === 'model_limit' && model === undefined);
          if (limite && !firstDeltaAt && tries < 8) {
            tentadas.push(conta.id);
            const proxima = contas.escolher({ excluir: tentadas, permitirAviso: true });
            // 1) Outra conta: esta sai de rotação (limite duro até o reset; limite de texto pelo tempo do reserva) e o
            //    mesmo turno segue na próxima, com o mesmo --resume.
            if (proxima !== null) {
              contas.marcar(conta.id, 'esgotada', e.code === 'conta_limite' ? e.message : `limite do modelo: ${e.message}`, e.code === 'conta_limite' ? e.resets : Math.floor((Date.now() + LIMIT_HOLD_MS) / 1000));
              log(`conta ${conta.id} (${conta.rotulo}) no limite (${e.message}); continuando na conta ${proxima.id} (${proxima.rotulo})`);
              avisar(conta.rotulo, proxima.rotulo, 'limite de uso da conta; a conversa continua na próxima conta', 'conta');
              conta = proxima; model = limiteModeloAtivo(conta.id) ? MODEL_FALLBACK : undefined;
              continue;
            }
            // 2) Sem outra conta: o reserva (Opus) nesta mesma conta, como antes.
            if (model === undefined) {
              limiteModelo.set(conta.id, { until: Date.now() + LIMIT_HOLD_MS, what: e.message });
              log(`limite (${e.message}) e nenhuma outra conta; refazendo com ${MODEL_FALLBACK} e mantendo por ${Math.round(LIMIT_HOLD_MS / 60000)} min`);
              model = MODEL_FALLBACK;
              // Aviso curto em português: "Fable falhou (limite de uso da conta); respondendo com Opus 5.5".
              const which = (/your ([\w .-]{1,30}?) limit/i.exec(e.message) || [])[1] || 'modelo da conta';
              avisar(which, MODEL_FALLBACK_LABEL, `limite de uso da conta; o ${MODEL_FALLBACK_LABEL} segue por ${Math.round(LIMIT_HOLD_MS / 60000)} min`);
              continue;
            }
          }
          throw e;
        }
      }
      } finally { if (mcpModulos) fs.rm(mcpModulos, { force: true }, () => {}); }
      usedKey = key; usedProfile = profile; contaUsada = conta;
      return out;
    };

    let out;
    try {
      for (let i = 0; i < attempts.length; i++) {
        const name = attempts[i];
        const next = attempts[i + 1];
        used = name;
        try {
          if (MODELS[name]) out = await runClaudeProvider(name);
          else { resumed = false; usedKey = null; usedProfile = null; out = await providers.openaiCompletion({ provider: providers.byName(PROVIDERS, name), env, messages, signal: abort.signal, onDelta }); }
          break;
        } catch (e) {
          // Já saiu texto para o cliente, ou não há próximo: o erro é definitivo.
          if (e.code === 'aborted' || firstDeltaAt || next === undefined) throw e;
          log(`${name} falhou (${e.code || '?'}: ${e.message}); caindo para ${next}`);
          const note = { from: name, to: next, reason: e.message };
          if (headersSent) res.write(`data: ${JSON.stringify(providers.fallbackChunk(id, created, next, note.from, note.to, note.reason))}\n\n`);
          else pendingNotes.push(note);
        }
      }
    } catch (e) {
      if (heartbeat) clearInterval(heartbeat);
      if (e.code === 'aborted') { log(`abortado pelo cliente após ${Date.now() - t0} ms`); try { res.end(); } catch (_) {} return; }
      log(`erro: ${e.code || '?'} ${e.message}${e.stderr ? ` | stderr: ${e.stderr.slice(-300).replace(/\s+/g, ' ')}` : ''}`);
      if (headersSent) {
        res.write(`data: ${JSON.stringify(chunk(id, created, used, { content: `\n\n[erro ${used}: ${e.message}]` }, 'stop'))}\n\n`);
        res.write('data: [DONE]\n\n'); res.end(); return;
      }
      const status = e.code === 'auth' ? 401 : 503;
      return json(res, status, { error: { message: e.message, type: e.code === 'auth' ? 'authentication_error' : 'server_error', code: e.code || 'cli_failed' } }, { 'X-Session-Resumed': 'false' });
    }

    if (usedKey && out.sessionId) sessions.put(usedKey, { sessionId: out.sessionId, cwd: usedProfile.cwd, sysHash: hash, seen: convoCount(messages) + 1, contaId: contaUsada ? contaUsada.id : 'padrao' });
    if (contaUsada !== null) ultimaConta = contaUsada.id;
    log(`${used}${used !== model ? ` (fallback de ${model})` : ''}${contaUsada ? ` conta=${contaUsada.id}` : ''} ${live ? 'live' : stream ? 'stream' : 'json'} resumed=${resumed} first_delta_ms=${firstDeltaAt ? firstDeltaAt - t0 : '-'} total_ms=${Date.now() - t0} chars=${out.text.length} deltas=${out.deltas}`);
    // Fora do Claude Code não há .jsonl: o diário é a transcrição desta conversa na máquina.
    if (!MODELS[used] && convId) appendAppTranscript(convId, messages, model, used, out.text);

    if (live) {
      startSse();
      if (!out.deltas) res.write(`data: ${JSON.stringify(chunk(id, created, used, { content: out.text }))}\n\n`);
      clearInterval(heartbeat);
      res.write(`data: ${JSON.stringify(chunk(id, created, used, {}, 'stop'))}\n\n`);
      res.write(`data: ${JSON.stringify(usageChunk(id, created, used, out.usage))}\n\n`);
      res.write('data: [DONE]\n\n'); res.end(); return;
    }
    const extra = { 'X-Session-Resumed': resumed ? 'true' : 'false', 'X-Provider': used };
    if (stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...extra });
      res.write(`data: ${JSON.stringify(chunk(id, created, used, { role: 'assistant', content: '' }))}\n\n`);
      for (const n of pendingNotes.splice(0)) res.write(`data: ${JSON.stringify(providers.fallbackChunk(id, created, used, n.from, n.to, n.reason, n.tipo))}\n\n`);
      res.write(`data: ${JSON.stringify(chunk(id, created, used, { content: out.text }))}\n\n`);
      res.write(`data: ${JSON.stringify(chunk(id, created, used, {}, 'stop'))}\n\n`);
      res.write('data: [DONE]\n\n'); res.end(); return;
    }
    json(res, 200, {
      id, object: 'chat.completion', created, model: used,
      choices: [{ index: 0, message: { role: 'assistant', content: out.text }, finish_reason: 'stop' }],
      usage: usageObj(out.usage),
      ...(pendingNotes.length ? { x_meu_bot: { fallback: pendingNotes[pendingNotes.length - 1] } } : {}),
    }, extra);
  };

  // Lock por conversa+modelo pedido: dois turnos da mesma conversa não correm em paralelo.
  const lockKey = convId ? `${model}:${convId}` : null;
  if (lockKey) return sessions.withLock(lockKey, run);
  return run();
}

/** Pedidos de chat em andamento: o app só reinstala o backend (que reinicia o serviço) com zero. */
let chatsAtivos = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health' && req.method === 'GET') return json(res, 200, { ok: true, models: listedModels().map((m) => m.id), ativos: chatsAtivos, appMinima: appMinima(), ...(vigia.ultima ? { maquina: vigia.ultima } : {}), ...(vigiaCota.ultima ? { cota: vigiaCota.ultima } : {}) });
  if (!authOk(req)) return json(res, 401, { error: { message: 'chave inválida', type: 'authentication_error', code: 'invalid_api_key' } });
  // Módulos de produto (MODULOS_KEY): só a rota de aviso. Manda texto (e um arquivo) pelo WhatsApp da máquina ao dono
  // ou a um número; quem decide o destino é a opção do módulo, gravada pela pessoa no app.
  if (papelDe(req) === 'modulo') {
    if (url.pathname !== '/v1/meu-bot/avisar' || req.method !== 'POST') return json(res, 403, { error: { message: 'a chave dos módulos só abre /v1/meu-bot/avisar', type: 'permission_error' } });
    let b; try { b = JSON.parse(await readBody(req, 64 * 1024)); } catch (_) { return json(res, 400, { error: { message: 'JSON inválido', type: 'invalid_request_error' } }); }
    const texto = typeof b.texto === 'string' ? b.texto.trim().slice(0, 4000) : '';
    const para = typeof b.para === 'string' ? b.para.replace(/\D/g, '') : '';
    const midia = typeof b.midia === 'string' ? b.midia : '';
    if (texto === '' && midia === '') return json(res, 400, { error: { message: 'texto ou midia', type: 'invalid_request_error' } });
    if (para !== '' && !/^\d{10,15}$/.test(para)) return json(res, 400, { error: { message: 'para: número com DDI e DDD', type: 'invalid_request_error' } });
    if (midia !== '' && !(path.isAbsolute(midia) && path.normalize(midia).startsWith(`${os.homedir()}/`) && fs.existsSync(midia))) return json(res, 400, { error: { message: 'midia: arquivo dentro do HOME', type: 'invalid_request_error' } });
    const ok = await sendWhatsapp({ texto, para: para || null, midia: midia || null });
    log(`aviso de módulo ${ok ? 'enviado' : 'falhou'}${para ? ` para +${para.slice(0, 4)}…` : ' ao dono'}${midia ? ' com arquivo' : ''}`);
    return json(res, ok ? 200 : 502, { ok });
  }
  // Status line do app: conta e limites do Claude Code desta máquina. O cache de limites é renovado aqui
  // quando está velho (o claude -p não roda a status line); o motivo de não renovar vai ao log quando muda.
  if (url.pathname === '/v1/meu-bot/status' && req.method === 'GET') {
    // A conta descrita é a que respondeu por último (ou a que responderia agora): e-mail e limites dela.
    const c = contas.conta(ultimaConta) || contas.escolher({ permitirAviso: true }) || contas.conta('padrao');
    atualizarUsoPelaApi(c).then((why) => {
      if (why !== lastLimitsWhy) { lastLimitsWhy = why; if (why !== 'fresh') log(`limites da conta ${c.id}: ${why}`); }
      json(res, 200, { claude: c.global ? statusGlobal(c) : readClaudeStatus(os.homedir(), contas.configDir(c)), model: currentModelLabel(c), providers: PROVIDERS.map((p) => ({ name: p.name, type: p.type, available: p.available })), contas: contas.resumo(c.id), cota: vigiaCota.ultima });
    });
    return;
  }
  // Espaço da conta (Configurações › Espaço): a cota relida agora (`fresco=1` ignora o cache de 30 s, depois de apagar algo).
  if (url.pathname === '/v1/meu-bot/cota' && req.method === 'GET') { lerCota({ forcar: url.searchParams.get('fresco') === '1' }).then((c) => json(res, 200, { cota: c })); return; }
  // Contas do Claude desta máquina (contas-claude.js): listar, criar (pasta isolada com o histórico compartilhado),
  // ajustar, reordenar, remover, "usar agora", conferir o login e os limiares do rodízio. O app roda o
  // `claude auth login` na pasta que o POST devolve.
  // `eventos`: trocas feitas fora do backend (porteiro do claude: WhatsApp pelo OpenClaw, Terminal), as 20 últimas.
  if (url.pathname === '/v1/meu-bot/contas-claude' && req.method === 'GET') return json(res, 200, { ...contas.listar(), eventos: contas.eventos(20) });
  if (url.pathname.startsWith('/v1/meu-bot/contas-claude') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    let p = {};
    if (req.method !== 'DELETE') { try { p = JSON.parse(await readBody(req, 16 * 1024) || '{}'); } catch (_) { return json(res, 400, { error: { message: 'JSON inválido', type: 'invalid_request_error' } }); } }
    const erro = (e) => json(res, 400, { error: { message: e.message, type: 'invalid_request_error' } });
    try {
      if (url.pathname === '/v1/meu-bot/contas-claude' && req.method === 'POST') {
        const c = contas.criar(typeof p.rotulo === 'string' ? p.rotulo : '');
        auditar('conta-claude.criada', c.rotulo);
        return json(res, 200, { conta: contas.vista(c), ...contas.listar() });
      }
      if (url.pathname === '/v1/meu-bot/contas-claude/limiares' && req.method === 'PUT') { contas.definirLimiares(p); return json(res, 200, contas.listar()); }
      if (url.pathname === '/v1/meu-bot/contas-claude/ordem' && req.method === 'PUT') { contas.reordenar(p.ids); return json(res, 200, contas.listar()); }
      const m = /^\/v1\/meu-bot\/contas-claude\/(padrao|c-[a-f0-9]{8})(?:\/(usar-agora|conferir))?$/.exec(url.pathname);
      if (m === null) return json(res, 404, { error: { message: 'conta inválida', type: 'invalid_request_error' } });
      const c = contas.conta(m[1]);
      if (c === null) return json(res, 404, { error: { message: 'conta não existe', type: 'invalid_request_error' } });
      if (m[2] === 'usar-agora' && req.method === 'POST') { contas.usarAgora(c.id); auditar('conta-claude.usar-agora', c.rotulo); return json(res, 200, contas.listar()); }
      if (m[2] === 'conferir' && req.method === 'POST') { contas.conferir(c.id); await atualizarUsoPelaApi(c, 0); return json(res, 200, contas.listar()); }
      if (m[2] === undefined && req.method === 'PATCH') { contas.atualizar(c.id, p); return json(res, 200, contas.listar()); }
      if (m[2] === undefined && req.method === 'DELETE') { contas.remover(c.id); auditar('conta-claude.removida', c.rotulo); return json(res, 200, contas.listar()); }
      return json(res, 404, { error: { message: `rota desconhecida: ${req.method} ${url.pathname}`, type: 'invalid_request_error' } });
    } catch (e) { return erro(e); }
  }
  if (url.pathname === '/v1/models' && req.method === 'GET') {
    return json(res, 200, { object: 'list', data: listedModels() });
  }
  // O app se apresenta: qual Mac está usando esta máquina. Novo → aviso à pessoa (WhatsApp/e-mail) e registro.
  if (url.pathname === '/v1/meu-bot/hello' && req.method === 'POST') {
    let m;
    try { m = JSON.parse(await readBody(req, 64 * 1024) || '{}'); } catch (_) { return json(res, 400, { error: { message: 'JSON inválido', type: 'invalid_request_error' } }); }
    const ok = m && /^[a-f0-9]{12}$/.test(m.id) && [m.name, m.user, m.platform, m.app].every((v) => typeof v === 'string' && MACHINE_FIELD_RE.test(v))
      && (m.produto === undefined || (typeof m.produto === 'string' && /^meu-bot(-[a-z0-9-]{1,30})?$/.test(m.produto)));
    if (!ok) return json(res, 400, { error: { message: 'máquina inválida', type: 'invalid_request_error' } });
    const r = await announceMachine({ id: m.id, name: m.name, user: m.user, platform: m.platform, app: m.app, produto: m.produto });
    return json(res, 200, { ...r, appMinima: appMinima() });
  }
  // Licença e devices da conta: o app mostra o próprio painel (plano/status/membro desde) e a tabela de máquinas.
  if (url.pathname === '/v1/meu-bot/license' && req.method === 'GET') return json(res, 200, licenseView());
  // CRM próprio (meu-bot-crm): extensão do Gmail (pelo app), agente (crm.mjs), job do WhatsApp e importador.
  if (url.pathname.startsWith('/v1/finance/') || url.pathname === '/v1/finance') { const mut = req.method === 'POST' || req.method === 'PUT'; financeApi().handle(req, res, url).then(() => { if (mut) agendarSyncInvestimentos(); }, (e) => { log(`finance falhou: ${e.stack || e.message}`); if (!res.headersSent) json(res, 500, { error: { message: e.message, type: 'server_error' } }); }); return; }
  if (url.pathname.startsWith('/v1/crm/') || url.pathname === '/v1/crm') { crmApi().handle(req, res, url, papelDe(req)).catch((e) => { log(`crm falhou: ${e.stack || e.message}`); if (!res.headersSent) json(res, 500, { error: { message: e.message, type: 'server_error' } }); }); return; }
  if (url.pathname === '/v1/meu-bot/alerts' && req.method === 'GET') return json(res, 200, alertPrefs());
  if (url.pathname === '/v1/meu-bot/alerts' && req.method === 'PUT') {
    let p;
    try { p = JSON.parse(await readBody(req, 16 * 1024) || '{}'); } catch (_) { return json(res, 400, { error: { message: 'JSON inválido', type: 'invalid_request_error' } }); }
    writeJson(ALERTS_FILE, { whatsapp: p.whatsapp !== false });
    return json(res, 200, { ok: true, ...alertPrefs() });
  }
  // A pessoa excluiu a conversa no app: a transcrição do Claude Code desta máquina vai junto (nos dois perfis),
  // e o mapa esquece a sessão. Mantém o histórico da máquina só com o que ainda existe no app.
  // "Copiar referência" no app: a sessão do Claude Code (o .jsonl nesta máquina) por trás da conversa, por perfil.
  if (url.pathname === '/v1/meu-bot/session' && req.method === 'GET') {
    const convId = url.searchParams.get('conv') || '';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(convId)) return json(res, 400, { error: { message: 'conv inválido', type: 'invalid_request_error' } });
    const out = [];
    for (const name of Object.keys(MODELS)) {
      const entry = sessions.get(`${name}:${convId}`);
      if (!entry || !entry.sessionId || !entry.cwd) continue;
      out.push({ profile: name, sessionId: entry.sessionId, cwd: entry.cwd, file: path.join(sessions.projectDir(entry.cwd), `${entry.sessionId}.jsonl`) });
    }
    // Diário (Grok/Hermes): a conversa tem arquivo aqui mesmo sem sessão do Claude Code.
    if (fs.existsSync(appConvFile(convId))) out.push({ profile: 'app', sessionId: convId, cwd: APP_CONVERSAS, file: appConvFile(convId) });
    return json(res, 200, { sessions: out });
  }
  if (url.pathname === '/v1/meu-bot/session' && req.method === 'DELETE') {
    const convId = url.searchParams.get('conv') || '';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(convId)) return json(res, 400, { error: { message: 'conv inválido', type: 'invalid_request_error' } });
    let removed = 0;
    for (const name of Object.keys(MODELS)) {
      const key = `${name}:${convId}`;
      const entry = sessions.get(key);
      if (!entry) continue;
      try { fs.unlinkSync(path.join(sessions.projectDir(entry.cwd), `${entry.sessionId}.jsonl`)); removed++; } catch (_) { /* já não havia */ }
      sessions.del(key);
    }
    try { fs.unlinkSync(appConvFile(convId)); removed++; } catch (_) { /* sem diário */ }
    if (removed) log(`conversa ${convId}: ${removed} transcrição(ões) apagada(s) a pedido do app`);
    return json(res, 200, { removed });
  }
  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    chatsAtivos += 1; res.once('close', () => { chatsAtivos -= 1; });
    // Limite de devices: um device "pending" (passou do limite, aguarda o admin) não usa o agente ainda.
    const devId = String(req.headers['x-device-id'] || '');
    if (/^[a-f0-9]{12}$/.test(devId)) {
      const entry = (readJson(MACHINES_FILE, {}) || {})[devId];
      if (entry && licenca.deviceStatus(entry) === 'pending') {
        return json(res, 403, { error: { message: 'device aguardando liberação do admin (limite do plano)', type: 'forbidden', code: 'device_pending' } });
      }
    }
    chatCompletions(req, res).catch((e) => { log(`falha inesperada: ${e.stack || e.message}`); if (!res.headersSent) json(res, 500, { error: { message: e.message, type: 'server_error' } }); else { try { res.end(); } catch (_) {} } });
    return;
  }
  json(res, 404, { error: { message: `rota desconhecida: ${req.method} ${url.pathname}`, type: 'invalid_request_error' } });
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
server.requestTimeout = 0;
// Na subida: migra a licença de antes de 22 out (personalizado/meu-bot-crm) antes que o job do CRM a leia crua.
try { ensureLicense(); } catch (e) { log(`licença: ${e.message}`); }
server.listen(PORT, HOST, () => log(`ouvindo em http://${HOST}:${PORT} modelos=${listedModels().map((m) => m.id).join(',')} fallback=${PROVIDERS.map((p) => `${p.name}${p.available ? '' : '(indisponível)'}`).join('→')} claude=${CLAUDE_BIN} workspace=${WORKSPACE} auth=${KEY ? 'bearer' : 'DESLIGADA'}`));
// Primeira rodada CRM → financeiro depois de subir: cria o pipeline Vendas onde falta e espelha o que já está vendido.
agendarSyncVendas(15000);

/**
 * Vigia da máquina (saude-maquina.js): memória, swap, disco do HOME, atraso do event loop e a própria box (o cgroup
 * da fatia deste usuário, lido de /proc/self/cgroup) a cada 30 s; o resultado vai no /health (`maquina`) e os avisos
 * pelo mesmo caminho do "Mac novo" (alertas.json, só WhatsApp). Os horários dos últimos avisos ficam em
 * saude-avisos.json (o intervalo de 6 h vale depois de reiniciar; a chave `cota` é do vigia da cota, abaixo). Testes:
 * MEU_BOT_VIGIA_MEM_PCT=100 faz a memória parecer sempre abaixo do limite; MEU_BOT_VIGIA_BOX_PCT=1 faz a box parecer
 * sempre no limite. Uma vez por dia, a faxina (faxina.js) dos arquivos que crescem.
 */
const SAUDE_AVISOS = path.join(MEU_BOT_DIR, 'saude-avisos.json');
const avisosGravados = readJson(SAUDE_AVISOS, {});
const memMinTeste = Number(ENV.MEU_BOT_VIGIA_MEM_PCT || process.env.MEU_BOT_VIGIA_MEM_PCT || '');
const boxPctTeste = Number(ENV.MEU_BOT_VIGIA_BOX_PCT || process.env.MEU_BOT_VIGIA_BOX_PCT || '');
const vigia = new saudeMaquina.Vigia({ ...(memMinTeste > 0 ? { memMinPct: memMinTeste } : {}), ...(boxPctTeste > 0 ? { boxPct: boxPctTeste } : {}) }, { ...avisosGravados, cota: undefined });
const vigiaCota = new cotaMod.VigiaCota(avisosGravados.cota && typeof avisosGravados.cota === 'object' ? avisosGravados.cota : {});
/** Os dois vigias dividem o arquivo: os tipos do vigia da máquina na raiz e os níveis da cota em `cota`. */
function gravarAvisos() { try { writeJson(SAUDE_AVISOS, { ...vigia.avisadoEm, cota: vigiaCota.avisado }); } catch (_) { /* sem disco: avisa mesmo assim */ } }
const BOX_DIR = (() => { try { const p = saudeMaquina.caminhoDaBox(fs.readFileSync('/proc/self/cgroup', 'utf8')); return p ? `/sys/fs/cgroup${p}` : null; } catch (_) { return null; } })();
function lerBoxAgora() {
  if (BOX_DIR === null) return null;
  const ler = (f) => { try { return fs.readFileSync(`${BOX_DIR}/${f}`, 'utf8'); } catch (_) { return ''; } };
  return saudeMaquina.lerBox({ current: ler('memory.current'), stat: ler('memory.stat'), high: ler('memory.high'), max: ler('memory.max'), swapCurrent: ler('memory.swap.current'), events: ler('memory.events'), pressure: ler('memory.pressure'), cpuPressure: ler('cpu.pressure'), cpuStat: ler('cpu.stat') });
}
const atraso = require('node:perf_hooks').monitorEventLoopDelay({ resolution: 50 });
atraso.enable();
function lerSaude() {
  let mem = null;
  try { mem = saudeMaquina.lerMeminfo(fs.readFileSync('/proc/meminfo', 'utf8')); } catch (_) { /* fora do Linux */ }
  if (mem === null) return;
  let disco = null;
  try { disco = saudeMaquina.discoLivrePct(fs.statfsSync(os.homedir())); } catch (_) { /* Node sem statfs */ }
  const lagMs = Math.round(atraso.max / 1e6); atraso.reset();
  const box = lerBoxAgora();
  const { avisar } = vigia.registrar({ ...mem, discoLivrePct: disco, lagMs, box, em: new Date().toISOString() });
  if (avisar.length === 0) return;
  gravarAvisos();
  const prefs = alertPrefs();
  for (const a of avisar) {
    const text = `meu-bot: ${a.texto}`;
    log(`vigia: ${a.tipo}: ${a.texto}`);
    auditar(`maquina.${a.tipo}`, a.tipo === 'box' && box ? `${box.anonMB}/${box.tetoMB === null ? 'sem teto' : `${box.tetoMB} MB`}, psi mem ${box.psiMem60}% cpu ${box.psiCpu60}%` : a.tipo === 'disco' ? `${disco}% livre` : a.tipo === 'lag' ? `${lagMs} ms` : `${mem.memLivreMB}/${mem.memTotalMB} MB`);
    (prefs.whatsapp ? sendWhatsappSelf(text) : Promise.resolve(null)).then((r) => log(`vigia: aviso ${a.tipo} whatsapp=${r}`));
  }
}

/**
 * Vigia da cota (cota.js): a cota de disco desta conta (`quota -wu`, como a pessoa) e o que ocupa (du de uma lista fixa
 * de pastas), a cada 10 min e nunca com uma resposta em andamento; avisa o dono pelo WhatsApp ao cruzar 80, 95 e 100%,
 * uma vez por cruzamento (rearma 5 pontos abaixo), com o que ocupa, como liberar e como ter mais (o link de pagamento
 * da licença, se houver). O resultado vai no /health e no /v1/meu-bot/status (`cota`) e em GET /v1/meu-bot/cota.
 * A cota macia é o limite que a pessoa vê; a dura (folga de 10%, 7 dias) é o que deixa este aviso ainda sair.
 */
let lendoCota = null;
function lerCota({ forcar = false } = {}) {
  if (lendoCota !== null) return lendoCota;
  const u = vigiaCota.ultima;
  if (!forcar && u !== null && Date.now() - Date.parse(u.em) < 30_000) return Promise.resolve(u);
  if (!forcar && chatsAtivos > 0) return Promise.resolve(u);
  const home = os.homedir();
  const exec = (cmd, args, timeout) => new Promise((resolve) => execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err, out) => resolve(err && !out ? null : String(out || ''))));
  lendoCota = (async () => {
    const q = cotaMod.lerQuota(await exec('quota', ['-wu', os.userInfo().username], 10_000));
    let leitura = null;
    if (q !== null) {
      const args = cotaMod.duArgs(home);
      const du = `${(await exec('nice', ['-n', '10', 'du', ...args.normal], 60_000)) || ''}\n${args.link.length > 1 ? (await exec('nice', ['-n', '10', 'du', ...args.link], 30_000)) || '' : ''}`;
      const limiteKb = cotaMod.limiteKbDe(q);
      const pct = cotaMod.pctDe(q.usadoKb, limiteKb);
      leitura = { usadoKb: q.usadoKb, limiteKb, hardKb: q.hardKb > 0 && q.hardKb !== limiteKb ? q.hardKb : null, pct, nivel: cotaMod.nivelDe(pct), grace: q.grace, itens: cotaMod.montarItens(cotaMod.lerDu(du), home, q.usadoKb), em: new Date().toISOString() };
    }
    let link = null; try { const lic = ensureLicense(); link = lic.pagamento && typeof lic.pagamento.link === 'string' && lic.pagamento.link !== '' ? lic.pagamento.link : null; } catch (_) { /* sem licença */ }
    const antes = JSON.stringify(vigiaCota.avisado);
    const { avisar } = vigiaCota.registrar(leitura, Date.now(), { link });
    // Grava também quando só rearmou (baixou 5 pontos): senão um reinício traria o nível velho e o próximo cruzamento passaria em silêncio.
    if (avisar.length > 0 || JSON.stringify(vigiaCota.avisado) !== antes) gravarAvisos();
    if (avisar.length > 0) {
      const prefs = alertPrefs();
      for (const a of avisar) {
        log(`cota: aviso ${a.nivel}: ${leitura.pct}% de ${cotaMod.fmtGb(leitura.limiteKb)}`);
        auditar('cota.aviso', `${leitura.pct}% de ${cotaMod.fmtGb(leitura.limiteKb)}`);
        (prefs.whatsapp ? sendWhatsappSelf(a.texto) : Promise.resolve(null)).then((r) => log(`cota: aviso ${a.nivel} whatsapp=${r}`));
      }
    }
    return vigiaCota.ultima;
  })().catch((e) => { log(`cota: não li a cota: ${e.message}`); return vigiaCota.ultima; }).finally(() => { lendoCota = null; });
  return lendoCota;
}
// Módulos de produto: onde está este backend e a chave da rota de aviso (0600, como o .env), para os serviços dos
// módulos (automações, vídeos) mandarem WhatsApp sem conhecer a pasta do backend.
if (MODULOS_KEY) { try { fs.mkdirSync(modulos.BASE, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(modulos.BASE, 'backend.json'), JSON.stringify({ url: `http://127.0.0.1:${PORT}`, chave: MODULOS_KEY }), { mode: 0o600 }); } catch (e) { log(`módulos: backend.json não gravado (${e.message})`); } }
setTimeout(lerSaude, 5000).unref();
setInterval(lerSaude, 30_000).unref();
setTimeout(() => { void lerCota(); }, 20_000).unref();
setInterval(() => { void lerCota(); }, 10 * 60_000).unref();
const faxinaDiaria = () => {
  for (const f of faxinar({ eventos: [contas.EVENTOS], logs: [path.join(__dirname, 'backend.log'), path.join(os.homedir(), '.cache', 'meu-bot', 'vigia-gateway.log')] })) log(`faxina: ${f}`);
};
setTimeout(faxinaDiaria, 60_000).unref();
setInterval(faxinaDiaria, 24 * 3600_000).unref();

process.on('SIGTERM', () => { log('SIGTERM; encerrando'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
