/**
 * crm-modelo.js — domínio do CRM próprio do meu-bot-crm (pipelines, etapas, campos, boxes, comentários, contatos,
 * threads do Gmail). Puro: sem IO, sem relógio implícito (`now` vem por parâmetro), testável com node --test.
 * O crm-store.js persiste; o crm-api.js expõe em /v1/crm/*; o crm/crm.mjs (CLI do agente) e a extensão do Gmail
 * só falam HTTP. Mesma semântica de valores do antigo streak.mjs (opções pelo nome, datas dd/mm/aaaa, números
 * pt-BR), para o agente e o job do WhatsApp não mudarem de hábito.
 */
'use strict';

const TIPOS = ['TEXT', 'NUMBER', 'DATE', 'DROPDOWN', 'TAG', 'CHECKBOX'];
const KEY_RE = /^[A-Za-z0-9_-]{4,400}$/;
const THREAD_RE = /^[0-9a-f]{10,20}$/i;
const LIMITES = { nome: 200, notes: 20000, comentario: 2000, comentariosPorBox: 500, texto: 2000 };

class ErroCrm extends Error {
  /** @param {string} code  invalido | nao_encontrado | conflito | autonomia_requer_dono (403, só no crm-api) */
  constructor(code, message) { super(message); this.code = code; }
}
const invalido = (m) => new ErroCrm('invalido', m);

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const digits = (s) => String(s ?? '').replace(/\D/g, '');
/** +N com 8 a 15 dígitos; null se não parece telefone. */
function normalizePhone(v) { const d = digits(v); return d.length >= 8 && d.length <= 15 ? `+${d}` : null; }
const isKey = (k) => typeof k === 'string' && KEY_RE.test(k);
/** Chave nova: prefixo + 12 chars base64url (rnd(n) devolve n bytes). */
const novaChave = (prefixo, rnd) => `${prefixo}_${Buffer.from(rnd(9)).toString('base64url')}`;
const str = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');
const lista = (v) => (Array.isArray(v) ? v : []);

// ---- etapas e campos -------------------------------------------------------------------------------------------
function findStage(pipeline, want) {
  const w = norm(want);
  if (w === '') return null;
  return pipeline.stages.find((s) => s.key === want || norm(s.name) === w) ?? pipeline.stages.find((s) => norm(s.name).startsWith(w)) ?? pipeline.stages.find((s) => norm(s.name).includes(w)) ?? null;
}
function findField(pipeline, want) {
  const w = norm(want);
  if (w === '') return null;
  return pipeline.fields.find((f) => f.key === want || norm(f.name) === w) ?? pipeline.fields.find((f) => norm(f.name).includes(w)) ?? null;
}
/** Valor bruto (texto do agente ou JSON da extensão) → valor guardado, conforme o tipo. Lança com a mensagem para a pessoa. */
function parseValue(field, raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const opts = lista(field.options);
  if (field.type === 'DROPDOWN' || field.type === 'TAG') {
    const um = (v) => {
      if (typeof v === 'string' && opts.some((o) => o.key === v)) return v;
      const w = norm(v);
      const o = opts.find((x) => norm(x.name) === w) ?? opts.find((x) => norm(x.name).startsWith(w)) ?? opts.find((x) => norm(x.name).includes(w));
      if (!o) throw invalido(`opção "${v}" não existe em "${field.name}"; opções: ${opts.map((x) => x.name).join(' | ')}`);
      return o.key;
    };
    if (field.type === 'TAG') return [...new Set((Array.isArray(raw) ? raw : String(raw).split(/\s*[,;|]\s*/)).filter((v) => v !== '').map(um))];
    return um(Array.isArray(raw) ? raw[0] : raw);
  }
  if (field.type === 'DATE') {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw).trim());
    const t = m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12) : Date.parse(String(raw));
    if (Number.isNaN(t)) throw invalido(`data inválida em "${field.name}": ${raw} (use dd/mm/aaaa)`);
    return t;
  }
  if (field.type === 'NUMBER') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) throw invalido(`número inválido em "${field.name}": ${raw}`);
    return n;
  }
  if (field.type === 'CHECKBOX') return typeof raw === 'boolean' ? raw : /^(1|sim|true|yes|x)$/i.test(String(raw).trim());
  return str(raw, LIMITES.texto);
}
/** Valor guardado → texto para a pessoa/agente (opções pelo nome, data dd/mm/aaaa). */
function formatValue(field, value) {
  if (value === null || value === undefined || value === '') return '';
  const opts = lista(field.options);
  if (field.type === 'DROPDOWN' || field.type === 'TAG') return (Array.isArray(value) ? value : [value]).map((k) => opts.find((o) => o.key === k)?.name ?? String(k)).join(', ');
  if (field.type === 'DATE') { const d = new Date(Number(value)); return Number.isNaN(d.getTime()) ? '' : `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; }
  if (field.type === 'CHECKBOX') return value ? 'sim' : 'não';
  return String(value);
}

// ---- pipeline --------------------------------------------------------------------------------------------------
function validarNome(v, oQue) { const n = str(v, LIMITES.nome); if (n === '') throw invalido(`${oQue} precisa de nome`); return n; }
/** Opções de uma lista: strings ou {key?, name}; chaves preservadas quando vêm (importação) e únicas. */
function parseOptions(raw, rnd, prev = []) {
  const out = []; const seen = new Set();
  for (const o of lista(raw)) {
    const name = validarNome(typeof o === 'string' ? o : o?.name, 'opção');
    const key = isKey(o?.key) ? o.key : prev.find((p) => norm(p.name) === norm(name))?.key ?? novaChave('o', rnd);
    if (seen.has(key) || out.some((x) => norm(x.name) === norm(name))) continue;
    seen.add(key); out.push({ key, name });
  }
  return out;
}
function parseField(raw, rnd, prev = null) {
  const name = validarNome(raw?.name, 'campo');
  const type = TIPOS.includes(raw?.type) ? raw.type : prev?.type ?? 'TEXT';
  const key = isKey(raw?.key) ? raw.key : prev?.key ?? novaChave('f', rnd);
  const options = type === 'DROPDOWN' || type === 'TAG' ? parseOptions(raw?.options ?? prev?.options ?? [], rnd, prev?.options ?? []) : [];
  return { key, name, type, options };
}
function parseStage(raw, rnd, prev = null) {
  const name = validarNome(typeof raw === 'string' ? raw : raw?.name, 'etapa');
  const key = isKey(raw?.key) ? raw.key : prev?.key ?? novaChave('s', rnd);
  return { key, name };
}
/**
 * Marca `agenteAutonomo` do pipeline: com ela, o agente cria caixa, preenche campos e muda etapa sem pedir ao dono
 * (a regra é da skill crm-api; apagar continua sendo só do dono). Ausente = false; o que não é boolean é recusado.
 */
function parseAutonomo(v) { if (v === undefined) return false; if (typeof v !== 'boolean') throw invalido('agenteAutonomo precisa ser true ou false'); return v; }
/** Pipeline novo a partir do que veio (nome, etapas, campos, agenteAutonomo). Chaves vindas de fora (importação) são preservadas. */
function novoPipeline(input, now, rnd) {
  const name = validarNome(input?.name, 'pipeline');
  const key = isKey(input?.key) ? input.key : novaChave('p', rnd);
  const stages = lista(input?.stages).map((s) => parseStage(s, rnd));
  if (stages.length === 0) stages.push({ key: novaChave('s', rnd), name: 'Novo' });
  const nomes = new Set(); for (const s of stages) { if (nomes.has(norm(s.name))) throw invalido(`etapa repetida: ${s.name}`); nomes.add(norm(s.name)); }
  const fields = lista(input?.fields).map((f) => parseField(f, rnd));
  const fn = new Set(); for (const f of fields) { if (fn.has(norm(f.name))) throw invalido(`campo repetido: ${f.name}`); fn.add(norm(f.name)); }
  return { key, name, stages, fields, agenteAutonomo: parseAutonomo(input?.agenteAutonomo), createdAt: now, updatedAt: now, ...(input?.origem && typeof input.origem === 'object' ? { origem: input.origem } : {}) };
}
/**
 * Patch do pipeline: `name`, `agenteAutonomo` (boolean), `stages` (lista completa e ordenada: sem key = etapa nova; etapa que some precisa de
 * `moverPara` se tiver boxes), `fields` (idem; campo que some perde o valor nos boxes). `boxes` = os boxes do
 * pipeline (para checar etapas com box). Devolve { pipeline, removerCampos, moverEtapas: {de: para} }.
 */
function patchPipeline(cur, patch, boxes, now, rnd) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = { ...cur, updatedAt: now };
  if (p.name !== undefined) next.name = validarNome(p.name, 'pipeline');
  if (p.agenteAutonomo !== undefined) next.agenteAutonomo = parseAutonomo(p.agenteAutonomo);
  const moverEtapas = {};
  if (p.stages !== undefined) {
    const stages = lista(p.stages).map((s) => parseStage(s, rnd, cur.stages.find((x) => x.key === s?.key) ?? null));
    if (stages.length === 0) throw invalido('o pipeline precisa de ao menos uma etapa');
    const nomes = new Set(); for (const s of stages) { if (nomes.has(norm(s.name))) throw invalido(`etapa repetida: ${s.name}`); nomes.add(norm(s.name)); }
    for (const old of cur.stages) {
      if (stages.some((s) => s.key === old.key)) continue;
      const n = boxes.filter((b) => b.stageKey === old.key).length;
      if (n === 0) continue;
      const para = p.moverPara && typeof p.moverPara === 'object' ? p.moverPara[old.key] : p.moverPara;
      const alvo = typeof para === 'string' ? findStage({ stages }, para) : null;
      if (alvo === null) throw new ErroCrm('conflito', `a etapa "${old.name}" tem ${n} box(es); informe moverPara`);
      moverEtapas[old.key] = alvo.key;
    }
    next.stages = stages;
  }
  const removerCampos = [];
  if (p.fields !== undefined) {
    const fields = lista(p.fields).map((f) => parseField(f, rnd, cur.fields.find((x) => x.key === f?.key) ?? null));
    const fn = new Set(); for (const f of fields) { if (fn.has(norm(f.name))) throw invalido(`campo repetido: ${f.name}`); fn.add(norm(f.name)); }
    for (const old of cur.fields) if (!fields.some((f) => f.key === old.key)) removerCampos.push(old.key);
    next.fields = fields;
  }
  return { pipeline: next, removerCampos, moverEtapas };
}

// ---- box -------------------------------------------------------------------------------------------------------
/** `fields` do patch: por chave ou por nome do campo; valor bruto → parseValue. Devolve o mapa só com o que veio. */
function parseFields(pipeline, raw) {
  const out = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const f = findField(pipeline, k);
    if (f === null) throw invalido(`campo "${k}" não existe; campos: ${pipeline.fields.map((x) => x.name).join(' | ') || '(nenhum)'}`);
    out[f.key] = parseValue(f, v);
  }
  return out;
}
/** Responsáveis da caixa (como no Streak): e-mails, com nome opcional; sem repetir; até 10. */
function parseResponsaveis(v) {
  const out = []; const vistos = new Set();
  for (const r of lista(v)) {
    const email = str(typeof r === 'string' ? r : r?.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || vistos.has(email)) continue;
    vistos.add(email); out.push({ email, nome: typeof r === 'object' && r !== null ? str(r.nome ?? r.name, LIMITES.nome) : '' });
  }
  if (out.length > 10) throw invalido('no máximo 10 responsáveis por caixa');
  return out;
}
function novoBox(pipeline, input, now, rnd) {
  const name = validarNome(input?.name, 'box');
  const etapa = input?.stageKey ?? input?.stage;
  const s = etapa === undefined || etapa === null || etapa === '' ? pipeline.stages[0] : findStage(pipeline, etapa);
  if (!s) throw invalido(`etapa "${etapa}" não existe; etapas: ${pipeline.stages.map((x) => x.name).join(' | ')}`);
  const key = isKey(input?.key) ? input.key : novaChave('b', rnd);
  return {
    key, pipelineKey: pipeline.key, name, stageKey: s.key, etapaDesde: now, notes: str(input?.notes, LIMITES.notes),
    fields: parseFields(pipeline, input?.fields), responsaveis: parseResponsaveis(input?.responsaveis), contatos: [], orgs: [], arquivos: [], threads: [], comentarios: [],
    createdAt: now, updatedAt: now, ...(input?.origem && typeof input.origem === 'object' ? { origem: input.origem } : {}),
  };
}
function patchBox(pipeline, box, patch, now) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = { ...box, fields: { ...box.fields }, updatedAt: now };
  let mudou = false;
  if (p.name !== undefined) { next.name = validarNome(p.name, 'box'); mudou = true; }
  if (p.notes !== undefined) { next.notes = str(p.notes, LIMITES.notes); mudou = true; }
  const etapa = p.stageKey ?? p.stage;
  if (etapa !== undefined) { const s = findStage(pipeline, etapa); if (!s) throw invalido(`etapa "${etapa}" não existe; etapas: ${pipeline.stages.map((x) => x.name).join(' | ')}`); if (s.key !== box.stageKey) next.etapaDesde = now; next.stageKey = s.key; mudou = true; }
  if (p.fields !== undefined) { for (const [k, v] of Object.entries(parseFields(pipeline, p.fields))) { if (v === null) delete next.fields[k]; else next.fields[k] = v; } mudou = true; }
  if (p.responsaveis !== undefined) { next.responsaveis = parseResponsaveis(p.responsaveis); mudou = true; }
  if (!mudou) throw invalido('nada para mudar (name, notes, stage, fields, responsaveis)');
  return next;
}
function addComment(box, texto, autor, now, rnd) {
  const t = str(texto, LIMITES.comentario);
  if (t === '') throw invalido('comentário vazio');
  const c = { key: novaChave('c', rnd), at: now, autor: str(autor, 40) || 'app', texto: t };
  const comentarios = [...box.comentarios, c];
  // Teto por box: os mais antigos saem (o feed e o backup diário guardam a história).
  while (comentarios.length > LIMITES.comentariosPorBox) comentarios.shift();
  return { box: { ...box, comentarios, updatedAt: now }, comentario: c };
}
function validarThreadId(gid) { const g = String(gid ?? '').trim().toLowerCase(); if (!THREAD_RE.test(g)) throw invalido('threadGmailId deve ser o id hexadecimal da conversa no Gmail (10 a 20 caracteres), ex. 1a1544925ace5958'); return g; }
function addThread(box, input, now) {
  const gid = validarThreadId(input?.threadGmailId ?? input?.gid);
  const t = { gid, assunto: str(input?.assunto ?? input?.subject, LIMITES.nome), emails: lista(input?.emails).map((e) => str(e, 200).toLowerCase()).filter(Boolean).slice(0, 20), nomes: lista(input?.nomes ?? input?.names).map((n) => str(n, 100)).filter(Boolean).slice(0, 20), mensagens: Number.isInteger(input?.mensagens) ? input.mensagens : null, em: now };
  const threads = box.threads.filter((x) => x.gid !== gid); threads.push(t);
  return { ...box, threads, updatedAt: now };
}
function removeThread(box, gid, now) { const g = validarThreadId(gid); return { ...box, threads: box.threads.filter((x) => x.gid !== g), updatedAt: now }; }

// ---- contatos --------------------------------------------------------------------------------------------------
function parseContato(input, now, rnd, prev = null) {
  const emails = [...new Set([...(prev?.emails ?? []), ...lista(input?.emails), ...(typeof input?.email === 'string' ? [input.email] : [])].map((e) => str(e, 200).toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
  const telefones = [...new Set([...(prev?.telefones ?? []), ...lista(input?.telefones), ...(typeof input?.phone === 'string' ? [input.phone] : [])].map(normalizePhone).filter(Boolean))];
  const nome = str(input?.nome ?? input?.name, LIMITES.nome) || prev?.nome || '';
  if (nome === '' && emails.length === 0 && telefones.length === 0) throw invalido('contato precisa de nome, e-mail ou telefone');
  const extra = {}; for (const k of ['cargo', 'notas', 'orgKey', 'orgAuto', 'linkedin', 'instagram', 'whatsapp', 'google', 'arquivos']) { if (prev && prev[k] !== undefined) extra[k] = prev[k]; } for (const k of ['cargo', 'linkedin', 'instagram']) if (typeof input?.[k] === 'string' && input[k].trim() !== '') extra[k] = str(input[k], LIMITES.nome);
  return { key: prev?.key ?? (isKey(input?.key) ? input.key : novaChave('k', rnd)), nome, emails, telefones, ...extra, createdAt: prev?.createdAt ?? now, updatedAt: now, ...(prev?.origem ? { origem: prev.origem } : input?.origem && typeof input.origem === 'object' ? { origem: input.origem } : {}) };
}
/**
 * Edição da página do contato: o que vier substitui (inclusive listas de e-mails/telefones, que aqui podem
 * encolher), ao contrário do upsert, que só acrescenta. `orgKey: null` tira da organização.
 */
function editarContato(cur, patch, now) {
  const n = { ...cur, updatedAt: now };
  if (patch?.nome !== undefined || patch?.name !== undefined) n.nome = str(patch.nome ?? patch.name, LIMITES.nome);
  if (Array.isArray(patch?.emails)) n.emails = [...new Set(patch.emails.map((e) => str(e, 200).toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
  if (Array.isArray(patch?.telefones)) n.telefones = [...new Set(patch.telefones.map(normalizePhone).filter(Boolean))];
  for (const k of ['cargo', 'linkedin', 'instagram']) if (typeof patch?.[k] === 'string') n[k] = str(patch[k], LIMITES.nome);
  if (typeof patch?.notas === 'string') n.notas = str(patch.notas, LIMITES.notes);
  if (patch?.orgKey === null) { n.orgKey = null; n.orgAuto = false; } else if (isKey(patch?.orgKey)) { n.orgKey = patch.orgKey; n.orgAuto = false; }
  if (n.nome === '' && n.emails.length === 0 && n.telefones.length === 0) throw invalido('contato precisa de nome, e-mail ou telefone');
  return n;
}
/** Contato completo (lista/página): campos opcionais com padrão. */
const contatoView = (c) => ({ key: c.key, nome: c.nome, emails: c.emails, telefones: c.telefones, cargo: c.cargo ?? '', notas: c.notas ?? '', orgKey: c.orgKey ?? null, orgAuto: c.orgAuto === true, linkedin: c.linkedin ?? '', instagram: c.instagram ?? '', whatsapp: c.whatsapp ?? null, google: c.google ?? null, createdAt: c.createdAt, updatedAt: c.updatedAt });

// ---- organizações ----------------------------------------------------------------------------------------------
/** Provedores de e-mail gratuitos (qualquer final: gmail.com, hotmail.com.br…): não identificam uma empresa. */
const PROVEDORES_GRATIS = ['gmail', 'googlemail', 'hotmail', 'outlook', 'live', 'msn', 'yahoo', 'ymail', 'icloud', 'me', 'mac', 'aol', 'uol', 'bol', 'terra', 'ig', 'globo', 'globomail', 'r7', 'zipmail', 'oi', 'protonmail', 'proton', 'pm', 'gmx', 'mail', 'yandex', 'zoho', 'tutanota', 'hey', 'fastmail', 'comcast', 'att', 'calendly', 'facebook'];
/** "Site", "@empresa.com.br", "https://www.empresa.com/x" → "empresa.com"; vazio se não parece domínio. */
function normDominio(v) {
  let d = String(v ?? '').trim().toLowerCase().replace(/^@/, '').replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  d = d.split(/[/?#:]/)[0] ?? '';
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : '';
}
const dominioGratis = (d) => PROVEDORES_GRATIS.includes(d.split('.')[0]);
/** Domínio de empresa de um e-mail (null para provedor gratuito ou endereço automático). */
function dominioDoEmail(email) {
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(String(email ?? '').trim().toLowerCase());
  if (!m) return null;
  if (/^(no-?reply|notifications?|mailer-daemon|postmaster)$/.test(m[1])) return null;
  const d = normDominio(m[2]);
  return d === '' || dominioGratis(d) ? null : d;
}
function parseOrg(input, now, rnd, prev = null) {
  const doms = Array.isArray(input?.dominios) ? input.dominios : prev?.dominios ?? [];
  const dominios = [...new Set([...doms, ...(typeof input?.dominio === 'string' ? [input.dominio] : [])].map(normDominio).filter(Boolean))].slice(0, 20);
  const nome = input?.nome !== undefined || input?.name !== undefined ? str(input.nome ?? input.name, LIMITES.nome) : prev?.nome ?? '';
  const o = { key: prev?.key ?? (isKey(input?.key) ? input.key : novaChave('o', rnd)), nome: nome || (dominios[0] ?? ''), dominios, createdAt: prev?.createdAt ?? now, updatedAt: now };
  for (const k of ['setor', 'funcionarios', 'site', 'endereco', 'linkedin', 'instagram']) o[k] = typeof input?.[k] === 'string' ? str(input[k], LIMITES.nome) : prev?.[k] ?? '';
  o.telefones = Array.isArray(input?.telefones) ? [...new Set(input.telefones.map(normalizePhone).filter(Boolean))] : prev?.telefones ?? [];
  o.notas = typeof input?.notas === 'string' ? str(input.notas, LIMITES.notes) : prev?.notas ?? '';
  if (o.nome === '') throw invalido('organização precisa de nome ou domínio');
  return o;
}
/** Organização dona do domínio (para não duplicar e para o vínculo automático). */
const orgDoDominio = (orgs, d) => (d ? orgs.find((o) => o.dominios.includes(d)) ?? null : null);
/** Org que o contato deveria ter pelo e-mail (só quando ele não tem uma escolhida à mão). */
function orgAutomatica(contato, orgs) {
  if (contato.orgKey && contato.orgAuto !== true) return null;
  for (const e of contato.emails) { const o = orgDoDominio(orgs, dominioDoEmail(e)); if (o) return o; }
  return null;
}

/** Acha pelo telefone, senão pelo e-mail, senão pela chave; mescla sem apagar. `contatos` = lista atual. */
function upsertContato(contatos, input, now, rnd) {
  const tel = normalizePhone(input?.phone ?? lista(input?.telefones)[0]);
  const mail = str(input?.email ?? lista(input?.emails)[0], 200).toLowerCase();
  const prev = contatos.find((c) => tel !== null && c.telefones.includes(tel)) ?? contatos.find((c) => mail !== '' && c.emails.includes(mail)) ?? contatos.find((c) => isKey(input?.key) && c.key === input.key) ?? null;
  return { contato: parseContato(input, now, rnd, prev), novo: prev === null };
}

// ---- busca e visões --------------------------------------------------------------------------------------------
/** Índice derivado (memória): telefone/e-mail/thread → boxes. `boxes` = todos os boxes (todos os pipelines). */
function buildIndex(boxes, contatos) {
  const porTelefone = new Map(); const porEmail = new Map(); const porThread = new Map();
  const add = (m, k, v) => { if (!k) return; const l = m.get(k) ?? []; if (!l.includes(v)) l.push(v); m.set(k, l); };
  const cmap = new Map(contatos.map((c) => [c.key, c]));
  for (const b of boxes) {
    for (const ck of b.contatos) { const c = cmap.get(ck); if (!c) continue; for (const t of c.telefones) add(porTelefone, digits(t), b.key); for (const e of c.emails) add(porEmail, e, b.key); }
    for (const t of b.threads) { porThread.set(t.gid, b.key); for (const e of t.emails) add(porEmail, e, b.key); }
  }
  return { porTelefone, porEmail, porThread };
}
/**
 * Mesma busca do antigo `box-find`: telefone (contatos → mapa legado `telefones` do crm.json → dígitos em
 * notes/nome), nome, texto livre (nome/notes), e-mail (contatos/threads/notes; aceita "@dominio"), thread.
 */
function buscar({ boxes, contatos, legacyPhones }, q, limit = 10) {
  const idx = buildIndex(boxes, contatos);
  let hits = [];
  if (typeof q.thread === 'string') { const k = idx.porThread.get(String(q.thread).toLowerCase()); hits = k ? boxes.filter((b) => b.key === k) : []; }
  else if (typeof q.phone === 'string') {
    const d = digits(q.phone); if (d === '') throw invalido('telefone vazio');
    const mapped = legacyPhones && typeof legacyPhones === 'object' ? legacyPhones[`+${d}`] : undefined;
    const keys = new Set(idx.porTelefone.get(d) ?? []);
    hits = boxes.filter((b) => keys.has(b.key) || (mapped !== undefined && b.key === mapped) || digits(b.notes).includes(d) || digits(b.name).includes(d));
  }
  else if (typeof q.name === 'string') { const w = norm(q.name); hits = w === '' ? [] : boxes.filter((b) => norm(b.name).includes(w)); }
  else if (typeof q.email === 'string') {
    const w = norm(q.email); if (w === '') throw invalido('e-mail vazio');
    const keys = new Set(); for (const [e, ks] of idx.porEmail) if (e.includes(w)) for (const k of ks) keys.add(k);
    hits = boxes.filter((b) => keys.has(b.key) || norm(b.notes).includes(w) || norm(b.name).includes(w));
  }
  else if (typeof q.query === 'string' || typeof q.q === 'string') { const w = norm(q.query ?? q.q); hits = w === '' ? boxes : boxes.filter((b) => norm(b.name).includes(w) || norm(b.notes).includes(w)); }
  else throw invalido('use phone, name, query, email ou thread');
  return { boxes: hits.slice(0, limit), total: hits.length };
}
/** Visão enxuta do box (mesma forma do antigo streak.mjs), para o agente gastar poucos tokens. */
function boxView(b, pipeline, contatos = []) {
  const fields = {};
  for (const f of pipeline.fields) { const v = b.fields[f.key]; if (v !== undefined && v !== null && v !== '') fields[f.name] = formatValue(f, v); }
  const cs = b.contatos.map((k) => contatos.find((c) => c.key === k)).filter(Boolean).map((c) => ({ key: c.key, nome: c.nome, telefones: c.telefones, emails: c.emails }));
  return { key: b.key, pipelineKey: b.pipelineKey, name: b.name, stage: pipeline.stages.find((s) => s.key === b.stageKey)?.name ?? b.stageKey, stageKey: b.stageKey, notes: b.notes.slice(0, 600), fields, contatos: cs, responsaveis: b.responsaveis ?? [], threads: b.threads.length, lastUpdated: new Date(b.updatedAt).toISOString(), criadoEm: new Date(b.createdAt).toISOString(), etapaDesde: new Date(b.etapaDesde || b.createdAt).toISOString() };
}
const commentsView = (b, n = 5, max = 300) => b.comentarios.slice(-n).map((c) => ({ key: c.key, em: new Date(c.at).toISOString().slice(0, 16), autor: c.autor, texto: c.texto.slice(0, max), ...(c.editadoEm ? { editadoEm: new Date(c.editadoEm).toISOString().slice(0, 16) } : {}) }));
const threadView = (t) => ({ threadGmailId: t.gid, assunto: t.assunto, nomes: t.nomes, emails: t.emails, mensagens: t.mensagens, em: new Date(t.em).toISOString().slice(0, 16) });
// ---- contexto para o agente do WhatsApp -----------------------------------------------------------------------
/**
 * O que o agente que responde no WhatsApp sabe do CRM sobre quem está falando: só o essencial (caixa, pipeline,
 * etapa, próximo passo e visão geral do resumo com IA). Anotações, registros e histórico ficam de fora: podem ter
 * coisa interna do dono. `boxes` = caixas do contato; `pipelines` = Map key→pipeline. Sem caixa → null.
 */
const CONTEXTO_MAX = 800;
function contextoWhatsapp({ boxes, pipelines, contato, agora }) {
  if (!Array.isArray(boxes) || boxes.length === 0) return null;
  const linhas = [];
  for (const b of [...boxes].sort((x, y) => y.updatedAt - x.updatedAt).slice(0, 3)) {
    const p = pipelines.get(b.pipelineKey); if (!p) continue;
    const etapa = p.stages.find((s) => s.key === b.stageKey)?.name ?? '';
    const dias = Math.max(0, Math.floor((agora - (b.etapaDesde || b.createdAt)) / 86_400_000));
    linhas.push(`- "${b.name}" · ${p.name} · etapa ${etapa} (${dias === 0 ? 'desde hoje' : `há ${dias} dia${dias === 1 ? '' : 's'}`})`);
    if (b.resumoIA?.proximoPasso) linhas.push(`  Próximo passo: ${b.resumoIA.proximoPasso}`);
    if (b.resumoIA?.visaoGeral) linhas.push(`  Visão geral: ${b.resumoIA.visaoGeral}`);
  }
  if (linhas.length === 0) return null;
  const cab = `Contexto interno do CRM do dono sobre esta pessoa${contato?.nome ? ` (${contato.nome})` : ''}. Use só para responder com coerência; não cite o CRM, etapas, nem estes dados ao contato.`;
  const texto = [cab, ...linhas].join('\n');
  return texto.length > CONTEXTO_MAX ? `${texto.slice(0, CONTEXTO_MAX - 1)}…` : texto;
}

// ---- resumo com IA -------------------------------------------------------------------------------------------
/**
 * Pedido ao motor do chat: tudo o que se sabe da caixa, em texto, e a resposta em JSON com três partes curtas.
 * `ctx` = { box, pipeline, contatos, orgs, agora }. Puro (testado); a chamada fica no crm-api.
 */
function promptResumo(ctx) {
  const { box: b, pipeline: p, contatos, orgs, agora } = ctx;
  const data = (t) => new Date(t).toISOString().slice(0, 10);
  const etapa = p.stages.find((s) => s.key === b.stageKey)?.name ?? '';
  const campos = p.fields.map((f) => { const v = b.fields[f.key]; return v === undefined || v === null || v === '' ? null : `${f.name}: ${formatValue(f, v)}`; }).filter(Boolean);
  const linhas = [
    `Caixa "${b.name}" no pipeline "${p.name}", etapa "${etapa}" desde ${data(b.etapaDesde || b.createdAt)} (criada em ${data(b.createdAt)}; hoje é ${data(agora)}).`,
    campos.length > 0 ? `Campos: ${campos.join('; ')}.` : 'Campos: nenhum preenchido.',
    b.notes ? `Anotações fixas:\n${b.notes.slice(0, 3000)}` : 'Anotações fixas: nenhuma.',
    (b.responsaveis ?? []).length > 0 ? `Responsáveis: ${b.responsaveis.map((r) => r.nome || r.email).join(', ')}.` : '',
    contatos.length > 0 ? `Contatos:\n${contatos.map((c) => `- ${c.nome || '(sem nome)'} ${[...c.emails, ...c.telefones].join(' ')}${c.cargo ? ` (${c.cargo})` : ''}${c.whatsapp?.resumo ? `\n  Conversa no WhatsApp (${c.whatsapp.mensagens} mensagens, última em ${data(c.whatsapp.ultimaEm)}): ${c.whatsapp.resumo}` : ''}${c.whatsapp?.arquivo?.resumo ? `\n  Conversas do WhatsApp já arquivadas (${c.whatsapp.arquivo.mensagens} mensagens): ${c.whatsapp.arquivo.resumo}` : ''}`).join('\n')}` : 'Contatos: nenhum.',
    orgs.length > 0 ? `Organizações: ${orgs.map((o) => `${o.nome}${o.dominios[0] ? ` (${o.dominios[0]})` : ''}${o.notas ? ` — ${o.notas.slice(0, 300)}` : ''}`).join('; ')}.` : '',
    b.comentarios.length > 0 ? `Registros (do mais antigo ao mais novo):\n${b.comentarios.slice(-40).map((c) => `- ${data(c.at)} [${c.autor}] ${c.texto.slice(0, 600)}`).join('\n')}` : 'Registros: nenhum.',
    b.threads.length > 0 ? `Conversas do Gmail ligadas: ${b.threads.slice(-15).map((t) => `"${t.assunto || '(sem assunto)'}" (${data(t.em)})`).join('; ')}.` : '',
    (b.arquivos ?? []).length > 0 ? `Arquivos anexados: ${b.arquivos.map((a) => a.nome).join(', ')}.` : '',
  ].filter(Boolean);
  return [
    'Você resume uma caixa de CRM para o dono do negócio. Use só os dados abaixo; não invente nada. Português do Brasil, frases curtas e diretas.',
    '', ...linhas, '',
    'Responda SOMENTE com um bloco JSON, sem texto antes ou depois:',
    '{"visaoGeral":"1 frase: quem é e o que quer","proximoPasso":"1 frase com a próxima ação concreta (ou vazio se não der para saber)","historico":"2 a 4 frases com o que já aconteceu, em ordem"}',
    'Se quase não houver dados, diga isso em visaoGeral e deixe proximoPasso vazio.',
  ].join('\n');
}
/** Resposta do motor → { visaoGeral, proximoPasso, historico } (aceita o JSON solto ou num bloco ```json). */
function parseResumo(texto) {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(String(texto ?? '')); const bruto = m ? m[1] : String(texto ?? '');
  const i = bruto.indexOf('{'); const j = bruto.lastIndexOf('}');
  if (i < 0 || j <= i) throw invalido('o motor não devolveu o resumo no formato esperado');
  let v; try { v = JSON.parse(bruto.slice(i, j + 1)); } catch { throw invalido('o motor não devolveu o resumo no formato esperado'); }
  const s = (x) => (typeof x === 'string' ? x.trim().slice(0, 1500) : '');
  const r = { visaoGeral: s(v.visaoGeral), proximoPasso: s(v.proximoPasso), historico: s(v.historico) };
  if (r.visaoGeral === '' && r.historico === '') throw invalido('o motor devolveu um resumo vazio');
  return r;
}

/**
 * Consolidação de uma conversa do WhatsApp que vai ser limpa: o resumo do contato soma o anterior com a conversa
 * inteira (os fatos antigos não se perdem). A transcrição é cortada no fim (o mais recente é o que mais importa).
 */
function promptConsolidacao({ nome, telefone, resumoAnterior, transcricao }) {
  const t = String(transcricao ?? '');
  const corte = t.length > 60000 ? `[… início cortado …]\n${t.slice(-60000)}` : t;
  return [
    `Você mantém o resumo de um contato num CRM. A conversa do WhatsApp com ${nome || telefone} (${telefone}) vai ser apagada do agente; o que ficar no resumo é o que o dono vai lembrar dela.`,
    'Use só os dados abaixo; não invente nada. Português do Brasil, frases curtas e diretas.',
    '', resumoAnterior ? `Resumo anterior (mantenha os fatos que continuam valendo):\n${resumoAnterior}` : 'Resumo anterior: nenhum.',
    '', 'Conversa:', corte, '',
    'Responda SOMENTE com o resumo novo, até 6 linhas, sem título nem markdown: quem é, o que quer, o que já foi combinado (preços, datas, valores), em que pé está e o próximo passo.',
  ].join('\n');
}
/** Resposta do motor → resumo limpo (até 1200 caracteres, o limite do cartão "Conversa no WhatsApp"). */
function parseConsolidacao(texto) {
  const r = String(texto ?? '').replace(/```[a-z]*\n?|```/g, '').trim().slice(0, 1200);
  if (r === '') throw invalido('o motor devolveu um resumo vazio');
  return r;
}

/** Definição do pipeline como a CLI `pipeline` sempre devolveu (etapas em ordem, campos com opções). */
const pipelineView = (p) => ({ key: p.key, name: p.name, agenteAutonomo: p.agenteAutonomo === true, stages: p.stages.map((s) => ({ key: s.key, name: s.name })), fields: p.fields.map((f) => ({ key: f.key, name: f.name, type: f.type, options: f.options.map((o) => ({ key: o.key, name: o.name })) })) });

module.exports = {
  TIPOS, KEY_RE, LIMITES, ErroCrm,
  norm, digits, normalizePhone, isKey, novaChave, validarThreadId,
  findStage, findField, parseValue, formatValue,
  novoPipeline, patchPipeline, novoBox, patchBox, parseResponsaveis, parseFields, addComment, addThread, removeThread,
  parseContato, upsertContato, editarContato, contatoView,
  PROVEDORES_GRATIS, normDominio, dominioDoEmail, parseOrg, orgDoDominio, orgAutomatica,
  promptResumo, parseResumo, promptConsolidacao, parseConsolidacao, contextoWhatsapp,
  buildIndex, buscar, boxView, commentsView, threadView, pipelineView,
};
