/**
 * licenca.js — dono do formato da licença do meu-bot (plano, status, validade, limite de devices).
 *
 * Puro, sem IO: o server.js lê/grava o arquivo (~/.local/share/meu-bot/licenca.json) e o admin grava por SSH.
 * A licença é da conta (a máquina da pessoa); os devices vivem no maquinas.json, cada um com status
 * "active" | "pending". O 1º device cabe sempre; acima do deviceLimit o device entra "pending" (a pessoa
 * "levanta a mão" e o admin libera subindo o limite ou aprovando o device). Mesmo esquema do src/main/licenca.ts
 * (o admin valida lá o que lê por SSH); são lados diferentes do mesmo contrato — mudar os dois juntos.
 */
'use strict';

// Planos: free (a base) e pro (Navegador e CRM). Os módulos pagos à parte (meu-bot-finance…) são add-ons em `produtos`,
// contratados com ou sem o Pro.
const PLANS = ['free', 'pro'];
const STATUSES = ['free', 'trialing', 'active', 'expired'];
const INTERVALS = ['month', 'year'];
const DEVICE_STATUSES = ['active', 'pending'];
/** Add-ons contratados por cima do plano (acumulativos): meu-bot-finance, meu-bot-fit… O meu-bot em si não entra. */
const PRODUTO_NOME_RE = /^meu-bot-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Nomes que não são add-on: o admin, e o meu-bot-crm (o CRM veio para o Pro em 22 out). */
const NAO_ADDON = new Set(['meu-bot-admin', 'meu-bot-crm']);
const parseProdutos = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && PRODUTO_NOME_RE.test(x) && !NAO_ADDON.has(x)))].sort() : []);
/** O plano "personalizado" (removido em 22 out) liberava o Pro e todos os add-ons; quem o tinha vira Pro com estes. */
const ADDONS_DO_PERSONALIZADO = ['meu-bot-finance'];
/**
 * Licença gravada antes de 22 out que ainda dava o CRM próprio sem passar pelo Pro (plano personalizado ou add-on
 * meu-bot-crm). O server.js usa isto uma vez, ao migrar o arquivo, para fixar o motor do CRM no próprio.
 */
const legadoCrmContratado = (raw) => raw !== null && typeof raw === 'object' && (raw.plan === 'personalizado' || (Array.isArray(raw.produtos) && raw.produtos.includes('meu-bot-crm')));

/**
 * Orientação de pagamento que o admin grava para a conta (chave Pix, link, contato). Aparece no aviso de plano do app.
 * Texto livre até 2000 caracteres; link só http(s). Inválido ou vazio vira null (sem orientação: só "pedir ao admin").
 */
const parsePagamento = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const instrucoes = typeof v.instrucoes === 'string' ? v.instrucoes.trim().slice(0, 2000) : '';
  const link = typeof v.link === 'string' && /^https?:\/\/\S+$/i.test(v.link.trim()) ? v.link.trim() : null;
  return instrucoes === '' && link === null ? null : { instrucoes, link };
};

const isIso = (v) => typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v));
const nowIso = (now = Date.now()) => new Date(now).toISOString();

/** Licença de uma conta que ainda não foi configurada: plano grátis, um device. */
function defaultLicense(now = Date.now()) {
  const at = nowIso(now);
  return {
    plan: 'free',
    status: 'free',
    interval: null,
    memberSince: at,
    trialEnd: null,
    expiresAt: null,
    deviceLimit: 1,
    produtos: [],
    pagamento: null,
    updatedAt: at,
    updatedBy: 'system',
  };
}

/**
 * Normaliza o que veio do arquivo (ou do admin): cada campo inválido/ausente cai no default, preservando
 * `memberSince` quando já existe. Nunca lança; o que entra é dado, não comando.
 */
function parseLicense(raw, now = Date.now()) {
  const base = defaultLicense(now);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw;
  const personalizado = o.plan === 'personalizado';
  const plan = personalizado ? 'pro' : PLANS.includes(o.plan) ? o.plan : base.plan;
  const status = STATUSES.includes(o.status) ? o.status : base.status;
  const interval = INTERVALS.includes(o.interval) ? o.interval : null;
  const memberSince = isIso(o.memberSince) ? o.memberSince : base.memberSince;
  const trialEnd = isIso(o.trialEnd) ? o.trialEnd : null;
  const expiresAt = isIso(o.expiresAt) ? o.expiresAt : null;
  const deviceLimit = Number.isInteger(o.deviceLimit) && o.deviceLimit >= 1 && o.deviceLimit <= 100 ? o.deviceLimit : base.deviceLimit;
  const updatedAt = isIso(o.updatedAt) ? o.updatedAt : base.updatedAt;
  const updatedBy = o.updatedBy === 'admin' || o.updatedBy === 'system' ? o.updatedBy : base.updatedBy;
  const produtos = parseProdutos(personalizado ? [...(Array.isArray(o.produtos) ? o.produtos : []), ...ADDONS_DO_PERSONALIZADO] : o.produtos);
  const pagamento = parsePagamento(o.pagamento);
  return { plan, status, interval, memberSince, trialEnd, expiresAt, deviceLimit, produtos, pagamento, updatedAt, updatedBy };
}

/** Aplica uma mudança do admin (só campos válidos) e carimba updatedAt/updatedBy=admin. */
function applyLicensePatch(current, patch, now = Date.now()) {
  const lic = parseLicense(current, now);
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const next = { ...lic };
  if (PLANS.includes(p.plan)) next.plan = p.plan;
  if (STATUSES.includes(p.status)) next.status = p.status;
  if (p.interval === null || INTERVALS.includes(p.interval)) next.interval = p.interval ?? null;
  if (p.trialEnd === null || isIso(p.trialEnd)) next.trialEnd = p.trialEnd ?? null;
  if (p.expiresAt === null || isIso(p.expiresAt)) next.expiresAt = p.expiresAt ?? null;
  if (Number.isInteger(p.deviceLimit) && p.deviceLimit >= 1 && p.deviceLimit <= 100) next.deviceLimit = p.deviceLimit;
  if (Array.isArray(p.produtos)) next.produtos = parseProdutos(p.produtos);
  if ('pagamento' in p) next.pagamento = parsePagamento(p.pagamento);
  next.updatedAt = nowIso(now);
  next.updatedBy = 'admin';
  return next;
}

/** Status de um device do maquinas.json; ausente (registro antigo) conta como ativo. */
const deviceStatus = (entry) => (entry && DEVICE_STATUSES.includes(entry.status) ? entry.status : 'active');

/** Quantos devices ativos a conta tem hoje (ignora o id passado, para medir "os outros"). */
function activeCount(machines, exceptId = null) {
  const all = machines && typeof machines === 'object' ? machines : {};
  let n = 0;
  for (const [id, entry] of Object.entries(all)) {
    if (id === exceptId) continue;
    if (deviceStatus(entry) === 'active') n += 1;
  }
  return n;
}

/**
 * Decide o status de um device ao se apresentar.
 * - Novo, ou pendente: entra "active" se cabe no deviceLimit, senão "pending" (mão levantada). Quando o limite sobe (o
 *   admin subiu, ou a conta ganhou um device extra), o Mac que esperava entra sozinho na próxima abertura.
 * - Ativo: continua ativo enquanto está entre os `deviceLimit` ativos mais antigos (por firstSeen). Quando o limite
 *   cai (um device extra venceu ou foi cancelado), ficam os que entraram há mais tempo e os mais novos voltam a
 *   esperar: sem isso, bastaria pagar um mês de device extra e cancelar para ficar com a vaga para sempre.
 *   Registro antigo sem firstSeen conta como o mais antigo.
 */
function admitDevice(license, machines, id) {
  const lic = parseLicense(license);
  const all = machines && typeof machines === 'object' ? machines : {};
  const known = all[id];
  if (known && deviceStatus(known) === 'active') {
    const desde = (e) => (e && typeof e.firstSeen === 'string' ? e.firstSeen : '');
    const ativos = Object.entries(all).filter(([, e]) => deviceStatus(e) === 'active').sort((a, b) => desde(a[1]).localeCompare(desde(b[1])) || a[0].localeCompare(b[0]));
    return ativos.findIndex(([k]) => k === id) < lic.deviceLimit ? 'active' : 'pending';
  }
  return activeCount(all, id) < lic.deviceLimit ? 'active' : 'pending';
}

/** Licença em vigor: status active/trialing e, se houver validade, ainda não vencida. */
function isActive(license, now = Date.now()) {
  const lic = parseLicense(license, now);
  if (lic.status !== 'active' && lic.status !== 'trialing') return false;
  return !(lic.expiresAt !== null && Date.parse(lic.expiresAt) < now);
}
/** Módulos Pro do meu-bot (Navegador, CRM no Gmail e no WhatsApp): plano pro em vigor. */
function proOk(license, now = Date.now()) {
  const lic = parseLicense(license, now);
  return lic.plan === 'pro' && isActive(lic, now);
}
/**
 * Um add-on (meu-bot-finance…) está liberado? Add-ons são acumulativos por cima do plano, com ou sem o Pro: basta
 * estar na lista e a licença não estar vencida (status expired ou validade passada).
 */
function produtoOk(license, nome, now = Date.now()) {
  const lic = parseLicense(license, now);
  if (lic.status === 'expired') return false;
  if (lic.expiresAt !== null && Date.parse(lic.expiresAt) < now) return false;
  return lic.produtos.includes(nome);
}
/** O CRM próprio (no Gmail e no WhatsApp) faz parte do Pro. */
const crmOk = proOk;
/**
 * Add-ons que este backend conhece (cópia de ADDONS em src/main/app/variant-core.ts; o teste produtos-alinhados confere).
 * O backend roda na máquina, sem acesso ao código do app: por isso a cópia.
 */
const ADDONS = ['meu-bot-finance', 'meu-bot-diego', 'meu-bot-grok'];
/**
 * Produtos de módulos que não pedem o add-on na licença: a trava é o acesso git ao repositório privado (cópia de
 * `Addon.semLicenca` em src/main/app/variant-core.ts; o teste produtos-alinhados confere).
 */
const MODULOS_SEM_LICENCA = ['meu-bot-diego'];
/** Os módulos de um produto valem nesta máquina (turno do agente): sem licença por desenho, ou o add-on liberado. */
const moduloOk = (license, nome, now = Date.now()) => MODULOS_SEM_LICENCA.includes(nome) || produtoOk(license, nome, now);
/** O financeiro: o add-on meu-bot-finance contratado (o Pro sozinho não libera). */
const financeOk = (license, now = Date.now()) => produtoOk(license, 'meu-bot-finance', now);

const PRODUTO_RE = /^meu-bot(-[a-z0-9-]{1,30})?$/;
/**
 * Apps que já se apresentaram deste device (um Mac pode ter o meu-bot e o meu-bot-crm): `apps[produto] =
 * {version, lastSeen}`. `produto` inválido/ausente (app antigo) conta como "meu-bot".
 */
const SUCEDE = { 'meu-bot': ['meu-bot-crm'], 'meu-bot-staging': ['meu-bot-crm-staging'] };
function mergeApps(prev, produto, version, now = Date.now()) {
  const apps = {};
  if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
    for (const [k, v] of Object.entries(prev)) {
      if (PRODUTO_RE.test(k) && v && typeof v === 'object' && typeof v.version === 'string' && typeof v.lastSeen === 'string') apps[k] = { version: v.version, lastSeen: v.lastSeen };
    }
  }
  const nome = typeof produto === 'string' && PRODUTO_RE.test(produto) ? produto : 'meu-bot';
  // O meu-bot sucedeu o meu-bot-crm (um app só): quando o sucessor se apresenta, o antecessor sai (senão ficaria fantasma para sempre).
  for (const antigo of SUCEDE[nome] || []) delete apps[antigo];
  apps[nome] = { version: typeof version === 'string' ? version : '', lastSeen: nowIso(now) };
  return apps;
}

// ---- Licença da CONTA assinada (licenca.json v2). Cópia de src/main/conta/licenca-assinada-core.ts: a API da conta
// (conta.agentesgrok.com) assina os bytes JSON exatos do payload com Ed25519; `payload` guarda esses bytes em
// base64url e `sig` a assinatura crua em base64. O backend verifica com as públicas abaixo e usa o payload como
// verdade; os campos de topo do arquivo são só espelho legível. O teste licenca-assinada-core confere que as duas
// cópias (chaves e decisão) batem.
const { createPublicKey, verify } = require('node:crypto');
/** Chaves públicas Ed25519 da licença (SPKI DER em base64): a principal assina; a reserva serve para trocar de chave. */
const LICENCA_PUBLIC_KEYS = [
  { id: 'licenca-2026-11', chave: 'MCowBQYDK2VwAyEA+E6wqc9j/NjhAhNLnLtDT1GLmA0cchXaepFJ0rLt3Zg=' },
];
const DEVICE_ID_RE = /^(?:[a-f0-9]{12}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

/** A assinatura Ed25519 crua (base64) confere com alguma das chaves (SPKI DER base64)? Qualquer erro = não. */
function verificaAssinatura(bytes, sig, chaves) {
  let s;
  try { s = Buffer.from(String(sig).trim(), 'base64'); } catch { return false; }
  if (s.length !== 64) return false;
  for (const chave of chaves) {
    try { if (verify(null, bytes, createPublicKey({ key: Buffer.from(chave, 'base64'), format: 'der', type: 'spki' }), s)) return true; } catch { /* chave inválida: tenta a próxima */ }
  }
  return false;
}
function parseLicencaAssinada(raw) {
  if (!isObj(raw)) return null;
  const { kid, payload, sig } = raw;
  if (typeof kid !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(kid)) return null;
  if (typeof payload !== 'string' || payload === '' || !B64URL_RE.test(payload)) return null;
  if (typeof sig !== 'string' || !/^[A-Za-z0-9+/]{86}==\s*$/.test(sig)) return null;
  return { kid, payload, sig: sig.trim() };
}
/** O payload decodificado, validado campo a campo; null se não é o que a API emite. */
function parsePayloadLicenca(raw, now = Date.now()) {
  if (!isObj(raw) || raw.v !== 2) return null;
  const { conta, maquina, emitidaEm, exp, devices } = raw;
  if (!isObj(conta) || typeof conta.id !== 'string' || !UUID_RE.test(conta.id) || typeof conta.email !== 'string' || conta.email === '') return null;
  if (typeof maquina !== 'string' || !UUID_RE.test(maquina)) return null;
  if (!isIso(emitidaEm) || !isIso(exp) || Date.parse(exp) < Date.parse(emitidaEm)) return null;
  if (!isObj(raw.licenca) || !Array.isArray(devices)) return null;
  const ds = [];
  for (const d of devices) {
    if (!isObj(d) || typeof d.id !== 'string' || !DEVICE_ID_RE.test(d.id)) return null;
    if (d.status !== 'active' && d.status !== 'pending') return null;
    ds.push({ id: d.id, status: d.status });
  }
  return { v: 2, conta: { id: conta.id, email: conta.email }, maquina, emitidaEm, exp, licenca: parseLicense(raw.licenca, now), devices: ds };
}
/**
 * Verifica um licenca.json (o objeto inteiro, ou só o bloco `assinada`): assinatura pela chave `kid` (ou qualquer
 * aceita), payload no formato da API e ainda não vencido; `maquina` dado = tem de ser desta máquina. Nunca lança.
 * Devolve { ok: true, payload, kid } ou { ok: false, motivo: 'sem-assinatura' | 'formato' | 'assinatura' | 'expirada' }.
 */
function verificaLicencaAssinada(raw, opts = {}) {
  const chaves = opts.chaves || LICENCA_PUBLIC_KEYS, now = opts.now === undefined ? Date.now() : opts.now;
  if (!isObj(raw)) return { ok: false, motivo: 'sem-assinatura' };
  // O licenca.json inteiro (bloco em `assinada`; v1 legado não o tem) ou o bloco sozinho (tem `payload` e `sig`).
  const bloco = 'assinada' in raw ? raw.assinada : 'payload' in raw && 'sig' in raw ? raw : undefined;
  if (bloco === undefined || bloco === null) return { ok: false, motivo: 'sem-assinatura' };
  const a = parseLicencaAssinada(bloco);
  if (a === null) return { ok: false, motivo: 'formato' };
  const bytes = Buffer.from(a.payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const daKid = chaves.filter((k) => k.id === a.kid).map((k) => k.chave);
  if (!verificaAssinatura(bytes, a.sig, daKid.length > 0 ? daKid : chaves.map((k) => k.chave))) return { ok: false, motivo: 'assinatura' };
  let json;
  try { json = JSON.parse(bytes.toString('utf8')); } catch { return { ok: false, motivo: 'formato' }; }
  const payload = parsePayloadLicenca(json, now);
  if (payload === null) return { ok: false, motivo: 'formato' };
  if (opts.maquina !== undefined && payload.maquina !== opts.maquina) return { ok: false, motivo: 'formato' };
  if (Date.parse(payload.exp) < now) return { ok: false, motivo: 'expirada' };
  return { ok: true, payload, kid: a.kid };
}

/** Licença vencida: status expired ou validade no passado (o plano free, sem validade, não está vencido). */
const vencida = (l, now) => l.status === 'expired' || (l.expiresAt !== null && Date.parse(l.expiresAt) < now);
/**
 * A licença em vigor nesta máquina: a que o admin gravou (`licenca.json`) somada à da conta da pessoa
 * (`licenca-conta.json`, assinada pela API para a máquina `maquina`). A máquina tem o Pro se uma das duas der; os
 * add-ons são a união dos que cada licença não vencida traz. O limite de devices é o MAIOR entre o do admin e o da
 * conta não vencida (que já vem somado aos devices extras pagos): a conta só amplia, nunca tira o que o admin deu. A
 * orientação de pagamento segue a do admin. Arquivo da conta ausente, mexido, de outra máquina ou vencido não conta:
 * vale só a do admin. Cópia de `licencaEmVigor` em src/main/conta/licenca-assinada-core.ts (o teste compara as duas).
 */
function licencaEmVigor(admin, rawConta, maquina, opts = {}) {
  const now = opts.now === undefined ? Date.now() : opts.now;
  const base = parseLicense(admin, now);
  if (typeof maquina !== 'string' || !UUID_RE.test(maquina)) return { license: base, origem: 'admin', exp: null };
  const v = verificaLicencaAssinada(rawConta, { chaves: opts.chaves, now, maquina });
  if (!v.ok) return { license: base, origem: 'admin', exp: null };
  const conta = v.payload.licenca;
  const produtos = [...new Set([...(vencida(base, now) ? [] : base.produtos), ...(vencida(conta, now) ? [] : conta.produtos)])].sort();
  // A da conta entra quando dá o que a do admin não dá: o Pro, ou (sem Pro em nenhuma) add-ons com a do admin vencida.
  const usaConta = proOk(base, now) ? false : proOk(conta, now) || (vencida(base, now) && !vencida(conta, now));
  const deviceLimit = vencida(conta, now) ? base.deviceLimit : Math.max(base.deviceLimit, conta.deviceLimit);
  if (!usaConta) return { license: { ...base, deviceLimit, produtos }, origem: 'admin', exp: null };
  return { license: { ...conta, deviceLimit, pagamento: base.pagamento, produtos }, origem: 'conta', exp: v.payload.exp };
}

module.exports = {
  LICENCA_PUBLIC_KEYS, DEVICE_ID_RE, UUID_RE, verificaLicencaAssinada, parsePayloadLicenca, parseLicencaAssinada, licencaEmVigor,
  ADDONS, ADDONS_DO_PERSONALIZADO, NAO_ADDON: [...NAO_ADDON], MODULOS_SEM_LICENCA, moduloOk,
  PLANS,
  isActive,
  proOk,
  produtoOk,
  crmOk,
  financeOk,
  legadoCrmContratado,
  parseProdutos,
  mergeApps,
  STATUSES,
  INTERVALS,
  DEVICE_STATUSES,
  defaultLicense,
  parseLicense,
  applyLicensePatch,
  deviceStatus,
  activeCount,
  admitDevice,
};
