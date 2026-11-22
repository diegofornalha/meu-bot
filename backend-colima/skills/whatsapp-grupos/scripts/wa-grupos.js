#!/usr/bin/env node
/**
 * wa-grupos.js — administração de grupos WhatsApp da conta do OpenClaw (Baileys direto).
 *
 * Usa o MESMO pacote baileys e o MESMO diretório de credenciais do plugin WhatsApp
 * do OpenClaw. Por isso só pode rodar com o gateway PARADO — duas conexões com a
 * mesma credencial derrubam uma à outra (stream error 440 "connection replaced").
 * Use sempre pelo wrapper: scripts/wa-admin.sh <comando> [...]  (ele para/religa o gateway).
 *
 * Comandos:
 *   listar [filtro] [--json]          lista grupos da conta (nome, membros, criação, JID) e
 *                                     salva cache em data/grupos-live.json
 *   info <jid>                        metadados de 1 grupo (participantes com número)
 *   criar "<nome>" <fone> [<fone>...]  cria grupo com esses participantes (13 dígitos, ex. 5511999998888)
 *                                     e salva o cache atualizado
 *   add <jid> <fone> [...]            adiciona participantes
 *
 * Saída "listar" padrão: • <Nome> — <N> membros — criado <YYYY-MM-DD> — <JID>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

/**
 * node_modules do plugin do WhatsApp, onde estão o baileys e o pino: o layout antigo (~/.openclaw/extensions/whatsapp)
 * ou o novo do OpenClaw (~/.openclaw/npm/projects/openclaw-whatsapp-<hash>/…, a instalação mais recente primeiro).
 * null = não achou (wa-admin.sh confere com "checar" antes de parar o gateway).
 */
function pluginNodeModules() {
  const home = os.homedir();
  const cands = [path.join(home, '.openclaw/extensions/whatsapp/node_modules')];
  const proj = path.join(home, '.openclaw/npm/projects');
  try {
    const dirs = fs.readdirSync(proj).filter((n) => n.startsWith('openclaw-whatsapp-')).map((n) => path.join(proj, n));
    dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const d of dirs) cands.push(path.join(d, 'node_modules/@openclaw/whatsapp/node_modules'), path.join(d, 'node_modules'));
  } catch { /* sem o layout novo */ }
  return cands.find((c) => fs.existsSync(path.join(c, 'baileys'))) || null;
}
const PLUGIN_NM = pluginNodeModules();
/**
 * O plugin está em outra pasta de estado do OpenClaw (~/.openclaw-<perfil>, gateway com OPENCLAW_STATE_DIR)? Devolve a
 * pasta, ou null. Só para o diagnóstico do "checar": mandar "reinstale o plugin" a quem já o tem noutro perfil criaria
 * uma segunda instalação e não resolveria nada.
 */
function pluginEmOutroPerfil() {
  const home = os.homedir();
  let nomes = [];
  try { nomes = fs.readdirSync(home).filter((n) => /^\.openclaw-[\w.-]+$/.test(n)).sort(); } catch { return null; }
  for (const n of nomes) {
    const d = path.join(home, n);
    if (fs.existsSync(path.join(d, 'extensions/whatsapp/node_modules/baileys'))) return d;
    try { if (fs.readdirSync(path.join(d, 'npm/projects')).some((x) => x.startsWith('openclaw-whatsapp-'))) return d; } catch { /* sem o layout novo */ }
  }
  return null;
}
const AUTH_DIR = path.join(os.homedir(), '.openclaw/credentials/whatsapp/default');
const CACHE = path.join(__dirname, '..', 'data', 'grupos-live.json');
const OPENCLAW_VERSION = '2026.7.1-2'; // igual ao browser[] que o plugin anuncia

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const pos = args.filter((a) => !a.startsWith('--'));
const cmd = pos[0];

function die(msg, code = 1) {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

if (!cmd || flags.has('--help')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?\n?/, ''));
  process.exit(0);
}

// "checar": só confere o que a listagem precisa (sem parar nada). O wa-admin.sh roda isto ANTES de parar o gateway.
if (cmd === 'checar') {
  if (!PLUGIN_NM) {
    const outro = pluginEmOutroPerfil();
    if (outro) die(`o OpenClaw desta máquina guarda o WhatsApp em outro perfil (${outro.replace(os.homedir(), '~')}), e o meu-bot só trabalha com o perfil padrão (~/.openclaw): a lista de grupos não funciona enquanto o gateway usar esse perfil`);
    die('não achei o baileys do plugin do WhatsApp (procurei em ~/.openclaw/extensions/whatsapp e ~/.openclaw/npm/projects/openclaw-whatsapp-*): reinstale o plugin com openclaw plugins install');
  }
  if (!fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) die(`creds.json não encontrado em ${AUTH_DIR}`);
  console.log(`ok: ${PLUGIN_NM}`);
  process.exit(0);
}
if (!PLUGIN_NM) die('não achei o baileys do plugin do WhatsApp');

// Guarda: gateway precisa estar parado (a menos que --forcar, por sua conta e risco).
try {
  const st = process.platform === 'darwin' ? '' : execSync('systemctl --user is-active openclaw-gateway.service', { encoding: 'utf8' }).trim();
  if (st === 'active' && !flags.has('--forcar')) {
    die('openclaw-gateway.service está ATIVO. Use scripts/wa-admin.sh (para/religa o gateway) ou pare-o antes.');
  }
} catch (e) {
  /* inactive → is-active sai com código != 0; segue */
}
// No Mac (launchd, sem systemctl): o serviço ai.openclaw.gateway em "state = running".
if (process.platform === 'darwin' && !flags.has('--forcar')) {
  let rodando = false;
  try { rodando = /state = running/.test(execSync(`launchctl print gui/${process.getuid()}/ai.openclaw.gateway`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { /* serviço fora do launchd: parado */ }
  if (rodando) die('o gateway do OpenClaw está rodando. Use scripts/wa-admin.sh (para/religa o gateway) ou pare-o antes.');
}

if (!fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) die(`creds.json não encontrado em ${AUTH_DIR}`);

const baileys = require(require.resolve('baileys', { paths: [PLUGIN_NM] }));
const makeWASocket = baileys.default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, DisconnectReason } = baileys;

let pino;
try {
  pino = require(require.resolve('pino', { paths: [PLUGIN_NM] }));
} catch {
  pino = null;
}
const logger = pino ? pino({ level: 'silent' }) : mkSilentLogger();
function mkSilentLogger() {
  const l = { level: 'silent', child: () => l };
  for (const m of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) l[m] = () => {};
  return l;
}

const onlyDigits = (s) => String(s).replace(/\D/g, '');
function toUserJid(fone) {
  const d = onlyDigits(fone);
  if (d.length < 10 || d.length > 15) die(`número inválido: ${fone} (esperado 13 dígitos BR, ex. 5511999998888)`);
  if (d.startsWith('55') && d.length !== 13) console.error(`⚠️  ${fone}: número BR sem 13 dígitos (55+DDD+9+8 dígitos). Seguindo mesmo assim.`);
  return `${d}@s.whatsapp.net`;
}
function fmtDate(ts) {
  if (!ts) return '?';
  const d = new Date(Number(ts) * 1000);
  return isNaN(d) ? '?' : d.toISOString().slice(0, 10);
}
function summarize(meta) {
  return {
    jid: meta.id,
    nome: meta.subject || '',
    membros: (meta.participants || []).length,
    criado: fmtDate(meta.creation),
    owner: meta.owner || meta.subjectOwner || null,
    descricao: meta.desc || null,
    participantes: (meta.participants || []).map((p) => ({
      jid: p.id,
      phone: p.phoneNumber || (p.id && p.id.endsWith('@s.whatsapp.net') ? p.id : null),
      admin: p.admin || null,
    })),
  };
}
function saveCache(groups) {
  const list = Object.values(groups).map(summarize).sort((a, b) => (b.criado > a.criado ? 1 : -1));
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify({ atualizadoEm: new Date().toISOString(), conta: SELF, grupos: list }, null, 2));
  return list;
}
function printList(list, filtro) {
  const f = (filtro || '').toLowerCase();
  const sel = list.filter((g) => !f || g.nome.toLowerCase().includes(f) || g.jid.includes(f));
  if (flags.has('--json')) {
    console.log(JSON.stringify(sel, null, 2));
    return;
  }
  if (!sel.length) console.log(f ? `(nenhum grupo casa com "${filtro}")` : '(a conta não está em nenhum grupo)');
  for (const g of sel) console.log(`• ${g.nome} — ${g.membros} membros — criado ${g.criado} — ${g.jid}`);
  console.error(`\n(${sel.length}/${list.length} grupos; cache salvo em ${CACHE})`);
}

let SELF = null;

(async () => {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    printQRInTerminal: false,
    browser: ['openclaw', 'cli', OPENCLAW_VERSION],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });
  sock.ev.on('creds.update', saveCreds);

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout (45s) aguardando conexão')), 45000);
    sock.ev.on('connection.update', (u) => {
      if (u.qr) {
        clearTimeout(t);
        reject(new Error('WhatsApp pediu QR — a sessão não está pareada. Não escaneie por aqui; use `openclaw channels login --channel whatsapp`.'));
      }
      if (u.connection === 'open') {
        clearTimeout(t);
        resolve();
      }
      if (u.connection === 'close') {
        clearTimeout(t);
        const code = u.lastDisconnect?.error?.output?.statusCode;
        const why = code === DisconnectReason.connectionReplaced ? 'connection replaced (440) — o gateway ainda está conectado?' : `close code=${code}`;
        reject(new Error(`conexão fechada: ${why}`));
      }
    });
  });

  SELF = sock.user?.id || null;
  console.error(`✅ conectado como ${SELF}`);

  let exitCode = 0;
  try {
    if (cmd === 'listar') {
      const groups = await sock.groupFetchAllParticipating();
      printList(saveCache(groups), pos[1]);
    } else if (cmd === 'info') {
      const jid = pos[1];
      if (!jid || !jid.endsWith('@g.us')) die('uso: info <jid@g.us>');
      const meta = await sock.groupMetadata(jid);
      console.log(JSON.stringify(summarize(meta), null, 2));
    } else if (cmd === 'criar') {
      const nome = pos[1];
      const fones = pos.slice(2);
      if (!nome || !fones.length) die('uso: criar "<nome>" <fone> [<fone>...]');
      const jids = fones.map(toUserJid);
      const meta = await sock.groupCreate(nome, jids);
      console.error(`✅ grupo criado: ${meta.subject} — ${meta.id}`);
      // confere quem realmente entrou (número inexistente no WhatsApp fica de fora, sem erro)
      const entraram = new Set((meta.participants || []).map((p) => onlyDigits(p.phoneNumber || p.id)));
      for (const f of fones) {
        const d = onlyDigits(f);
        if (![...entraram].some((e) => e.endsWith(d.slice(-8)))) console.error(`⚠️  ${f} NÃO aparece entre os participantes — número sem WhatsApp ou privacidade de grupo bloqueia adição. Mande convite pelo app.`);
      }
      const groups = await sock.groupFetchAllParticipating();
      saveCache(groups);
      console.log(JSON.stringify(summarize(meta), null, 2));
    } else if (cmd === 'add') {
      const jid = pos[1];
      const fones = pos.slice(2);
      if (!jid || !jid.endsWith('@g.us') || !fones.length) die('uso: add <jid@g.us> <fone> [...]');
      const r = await sock.groupParticipantsUpdate(jid, fones.map(toUserJid), 'add');
      console.log(JSON.stringify(r, null, 2));
      saveCache(await sock.groupFetchAllParticipating());
    } else {
      die(`comando desconhecido: ${cmd}`);
    }
  } catch (e) {
    console.error(`❌ ${e.message || e}`);
    exitCode = 1;
  }

  // dá tempo do creds.update ser gravado e fecha limpo
  await new Promise((r) => setTimeout(r, 1500));
  try {
    sock.end(undefined);
  } catch {}
  try {
    fs.chmodSync(path.join(AUTH_DIR, 'creds.json'), 0o600);
  } catch {}
  process.exit(exitCode);
})().catch((e) => die(e.message || String(e)));
