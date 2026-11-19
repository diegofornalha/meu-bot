/**
 * crm-store.js — persistência do CRM próprio em ~/.local/share/meu-bot/crm/db/ (arquivos JSON, sem npm, sem
 * SQLite: o Node da máquina pode ser 18/20). Um único escritor (o server.js): tudo fica em memória depois de
 * `openStore` e cada mutação grava só os arquivos tocados, de forma atômica (tmp + rename, 0600 em pasta 0700),
 * numa fila única. Toda mutação avança `meta.seq`, carimba `updatedAt` e acrescenta uma linha em mudancas.jsonl
 * (feed que a extensão do Gmail consome por polling). Backup diário da pasta na primeira escrita de cada dia.
 *
 *   db/meta.json                 { versao, seq, ultimoBackup }
 *   db/pipelines/<key>.json      definição (etapas, campos, agenteAutonomo; arquivo antigo sem a marca = false)
 *   db/boxes/<pipelineKey>.json  { pipelineKey, boxes: { [key]: Box } }   (um arquivo por pipeline)
 *   db/contatos.json             { contatos: { [key]: Contato } }
 *   db/organizacoes.json         { organizacoes: { [key]: Org } }
 *   db/mudancas.jsonl            feed append-only (rotação em 20 000 linhas → 5 000)
 *   db/lixeira/<pipeline>/<box>.json   boxes apagados (DELETE move, não destrói)
 *   db/arquivos/<box|contato>/<arquivo>  anexos das caixas e conversas do WhatsApp arquivadas nos contatos
 *                                (fora do backup diário: não mudam depois de gravados)
 *   db/backup/<AAAA-MM-DD>/      cópia diária (mantém 7)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const EventEmitter = require('node:events');

const VERSAO = 1;
const FEED_MAX = 20000;
const FEED_KEEP = 5000;
const BACKUPS = 7;
const KEY_FILE_RE = /^[A-Za-z0-9_-]{4,400}$/;

const readJson = (f, fallback) => { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return v && typeof v === 'object' ? v : fallback; } catch (e) { if (e && e.code === 'ENOENT') return fallback; throw new Error(`arquivo do CRM corrompido: ${f} (${e.message}); restaure de db/backup/`); } };
function writeJson(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); }
const dia = (now) => new Date(now).toISOString().slice(0, 10);

/**
 * Abre (ou cria) o store. `deps.now` e `deps.rnd` injetáveis para teste.
 * Devolve leitura em memória + `mutate(por, fn)` como única porta de escrita.
 */
function openStore(dir, deps = {}) {
  const now = deps.now ?? (() => Date.now());
  const rnd = deps.rnd ?? ((n) => crypto.randomBytes(n));
  const log = deps.log ?? (() => {});
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const P = { meta: path.join(dir, 'meta.json'), pipelines: path.join(dir, 'pipelines'), boxes: path.join(dir, 'boxes'), contatos: path.join(dir, 'contatos.json'), orgs: path.join(dir, 'organizacoes.json'), feed: path.join(dir, 'mudancas.jsonl'), lixeira: path.join(dir, 'lixeira'), backup: path.join(dir, 'backup') };
  const events = new EventEmitter();
  events.setMaxListeners(0);

  // ---- carga -----------------------------------------------------------------------------------------------
  const state = { meta: null, pipelines: new Map(), boxes: new Map(), contatos: new Map(), orgs: new Map() };
  function load() {
    const m = readJson(P.meta, null);
    state.meta = m && Number.isInteger(m.seq) ? { versao: VERSAO, seq: m.seq, ultimoBackup: typeof m.ultimoBackup === 'string' ? m.ultimoBackup : '' } : { versao: VERSAO, seq: 0, ultimoBackup: '' };
    state.pipelines.clear(); state.boxes.clear(); state.contatos.clear(); state.orgs.clear();
    if (fs.existsSync(P.pipelines)) for (const f of fs.readdirSync(P.pipelines)) {
      if (!f.endsWith('.json')) continue;
      const p = readJson(path.join(P.pipelines, f), null);
      if (p && KEY_FILE_RE.test(p.key)) state.pipelines.set(p.key, normPipeline(p));
    }
    for (const key of state.pipelines.keys()) {
      const b = readJson(path.join(P.boxes, `${key}.json`), { pipelineKey: key, boxes: {} });
      const map = new Map();
      for (const [k, v] of Object.entries(b.boxes ?? {})) if (KEY_FILE_RE.test(k) && v && typeof v === 'object') map.set(k, normBox(v, key));
      state.boxes.set(key, map);
    }
    const c = readJson(P.contatos, { contatos: {} });
    for (const [k, v] of Object.entries(c.contatos ?? {})) if (KEY_FILE_RE.test(k) && v && typeof v === 'object') state.contatos.set(k, normContato(v));
    const o = readJson(P.orgs, { organizacoes: {} });
    for (const [k, v] of Object.entries(o.organizacoes ?? {})) if (KEY_FILE_RE.test(k) && v && typeof v === 'object') state.orgs.set(k, normOrg(v));
  }
  const arr = (v) => (Array.isArray(v) ? v : []);
  const normPipeline = (p) => ({ key: p.key, name: String(p.name ?? ''), stages: arr(p.stages).map((s) => ({ key: String(s.key), name: String(s.name ?? '') })), fields: arr(p.fields).map((f) => ({ key: String(f.key), name: String(f.name ?? ''), type: String(f.type ?? 'TEXT'), options: arr(f.options).map((o) => ({ key: String(o.key), name: String(o.name ?? '') })) })), agenteAutonomo: p.agenteAutonomo === true, createdAt: Number(p.createdAt) || 0, updatedAt: Number(p.updatedAt) || 0, ...(p.origem ? { origem: p.origem } : {}) });
  /** Metadados de anexo (caixa ou contato); conversa do WhatsApp arquivada traz também hash, nº de mensagens e período. */
  const normArquivos = (v) => arr(v).filter((a) => a && KEY_FILE_RE.test(String(a.key))).map((a) => ({ key: String(a.key), nome: String(a.nome ?? 'arquivo'), tipo: String(a.tipo ?? 'application/octet-stream'), tamanho: Number(a.tamanho) || 0, em: Number(a.em) || 0, por: String(a.por ?? 'app'), ...(typeof a.sha256 === 'string' ? { sha256: a.sha256, mensagens: Number(a.mensagens) || 0, de: Number(a.de) || 0, ate: Number(a.ate) || 0 } : {}) }));
  const normBox = (b, pipelineKey) => ({ key: b.key, pipelineKey, name: String(b.name ?? ''), stageKey: String(b.stageKey ?? ''), etapaDesde: Number(b.etapaDesde) || Number(b.createdAt) || 0, notes: String(b.notes ?? ''), fields: b.fields && typeof b.fields === 'object' ? b.fields : {}, ...(b.resumoIA && typeof b.resumoIA === 'object' ? { resumoIA: { visaoGeral: String(b.resumoIA.visaoGeral ?? ''), proximoPasso: String(b.resumoIA.proximoPasso ?? ''), historico: String(b.resumoIA.historico ?? ''), geradoEm: Number(b.resumoIA.geradoEm) || 0 } } : {}), responsaveis: arr(b.responsaveis).filter((r) => r && typeof r.email === 'string').map((r) => ({ email: String(r.email), nome: String(r.nome ?? '') })), contatos: arr(b.contatos).map(String), orgs: arr(b.orgs).map(String), arquivos: normArquivos(b.arquivos), threads: arr(b.threads).map((t) => ({ gid: String(t.gid), assunto: String(t.assunto ?? ''), emails: arr(t.emails).map(String), nomes: arr(t.nomes).map(String), mensagens: Number.isInteger(t.mensagens) ? t.mensagens : null, em: Number(t.em) || 0 })), comentarios: arr(b.comentarios).map((c) => ({ key: String(c.key), at: Number(c.at) || 0, autor: String(c.autor ?? 'app'), texto: String(c.texto ?? ''), ...(Number(c.editadoEm) > 0 ? { editadoEm: Number(c.editadoEm) } : {}) })), createdAt: Number(b.createdAt) || 0, updatedAt: Number(b.updatedAt) || 0, ...(b.origem ? { origem: b.origem } : {}) });
  const opc = (c, ks) => Object.fromEntries(ks.filter((k) => typeof c[k] === 'string').map((k) => [k, c[k]]));
  const normOrg = (o) => ({ key: o.key, nome: String(o.nome ?? ''), dominios: arr(o.dominios).map(String), telefones: arr(o.telefones).map(String), ...opc(o, ['setor', 'funcionarios', 'site', 'endereco', 'linkedin', 'instagram', 'notas']), createdAt: Number(o.createdAt) || 0, updatedAt: Number(o.updatedAt) || 0 });
  const normContato = (c) => ({ key: c.key, nome: String(c.nome ?? ''), emails: arr(c.emails).map(String), telefones: arr(c.telefones).map(String), ...opc(c, ['cargo', 'notas', 'linkedin', 'instagram']), ...(typeof c.orgKey === 'string' ? { orgKey: c.orgKey, orgAuto: c.orgAuto === true } : {}), ...(c.google && typeof c.google === 'object' && typeof c.google.id === 'string' ? { google: { id: c.google.id, url: String(c.google.url ?? '') } } : {}), ...(c.whatsapp && typeof c.whatsapp === 'object' ? { whatsapp: { resumo: String(c.whatsapp.resumo ?? ''), mensagens: Number(c.whatsapp.mensagens) || 0, ultimaEm: Number(c.whatsapp.ultimaEm) || 0, atualizadoEm: Number(c.whatsapp.atualizadoEm) || 0, ...(c.whatsapp.arquivo && typeof c.whatsapp.arquivo === 'object' ? { arquivo: { resumo: String(c.whatsapp.arquivo.resumo ?? ''), mensagens: Number(c.whatsapp.arquivo.mensagens) || 0, em: Number(c.whatsapp.arquivo.em) || 0 } } : {}) } } : {}), ...(arr(c.arquivos).length > 0 ? { arquivos: normArquivos(c.arquivos) } : {}), createdAt: Number(c.createdAt) || 0, updatedAt: Number(c.updatedAt) || 0, ...(c.origem ? { origem: c.origem } : {}) });
  load();

  // ---- leitura ---------------------------------------------------------------------------------------------
  const listPipelines = () => [...state.pipelines.values()];
  const getPipeline = (key) => state.pipelines.get(key) ?? null;
  const listBoxes = (pipelineKey) => [...(state.boxes.get(pipelineKey)?.values() ?? [])];
  const allBoxes = () => [...state.boxes.values()].flatMap((m) => [...m.values()]);
  const getBox = (boxKey) => { for (const m of state.boxes.values()) { const b = m.get(boxKey); if (b) return b; } return null; };
  const listContatos = () => [...state.contatos.values()];
  const getContato = (key) => state.contatos.get(key) ?? null;
  const listOrgs = () => [...state.orgs.values()];
  const getOrg = (key) => state.orgs.get(key) ?? null;
  const meta = () => ({ ...state.meta });

  // ---- escrita ---------------------------------------------------------------------------------------------
  let fila = Promise.resolve();
  function backupDiario(t) {
    const hoje = dia(t);
    if (state.meta.ultimoBackup === hoje) return;
    try {
      const dest = path.join(P.backup, hoje);
      fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
      for (const f of fs.readdirSync(dir)) { if (f === 'backup' || f === 'arquivos' || f.endsWith('.tmp')) continue; fs.cpSync(path.join(dir, f), path.join(dest, f), { recursive: true }); }
      const dias = fs.readdirSync(P.backup).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
      for (const d of dias.slice(0, Math.max(0, dias.length - BACKUPS))) fs.rmSync(path.join(P.backup, d), { recursive: true, force: true });
      state.meta.ultimoBackup = hoje;
    } catch (e) { log(`backup do CRM falhou: ${e.message}`); }
  }
  function appendFeed(linhas) {
    fs.appendFileSync(P.feed, linhas.map((l) => `${JSON.stringify(l)}\n`).join(''), { mode: 0o600 });
    let n = 0; try { n = fs.readFileSync(P.feed, 'utf8').split('\n').length - 1; } catch { n = 0; }
    if (n > FEED_MAX) { const all = fs.readFileSync(P.feed, 'utf8').split('\n').filter(Boolean); const tmp = `${P.feed}.tmp`; fs.writeFileSync(tmp, `${all.slice(-FEED_KEEP).join('\n')}\n`, { mode: 0o600 }); fs.renameSync(tmp, P.feed); }
  }
  /**
   * Uma transação: `fn(tx)` recebe `tx.mudar(tipo, refs)` (registra uma mudança e devolve o seq dela) e os
   * setters; no fim os arquivos tocados são gravados. Erros dentro de fn deixam tudo como estava (memória
   * restaurada do disco). `por` = quem mudou (agente | extensao | whatsapp | importador | app).
   */
  function mutate(por, fn) {
    const run = async () => {
      const t = now();
      const tocados = { pipelines: new Set(), boxes: new Set(), contatos: false, orgs: false };
      const linhas = [];
      const remover = [];
      const tx = {
        now: t, rnd,
        getPipeline, listBoxes, getBox, listContatos, getContato, allBoxes, listOrgs, getOrg,
        setPipeline(p) { state.pipelines.set(p.key, p); if (!state.boxes.has(p.key)) state.boxes.set(p.key, new Map()); tocados.pipelines.add(p.key); },
        setBox(b) { let m = state.boxes.get(b.pipelineKey); if (!m) { m = new Map(); state.boxes.set(b.pipelineKey, m); } m.set(b.key, b); tocados.boxes.add(b.pipelineKey); },
        trashBox(b) { const m = state.boxes.get(b.pipelineKey); if (m) m.delete(b.key); tocados.boxes.add(b.pipelineKey); writeJson(path.join(P.lixeira, b.pipelineKey, `${b.key}.json`), { ...b, apagadoEm: t }); },
        setContato(c) { state.contatos.set(c.key, c); tocados.contatos = true; },
        trashContato(c) { state.contatos.delete(c.key); tocados.contatos = true; writeJson(path.join(P.lixeira, 'contatos', `${c.key}.json`), { ...c, apagadoEm: t }); },
        setOrg(o) { state.orgs.set(o.key, o); tocados.orgs = true; },
        trashOrg(o) { state.orgs.delete(o.key); tocados.orgs = true; writeJson(path.join(P.lixeira, 'organizacoes', `${o.key}.json`), { ...o, apagadoEm: t }); },
        /** Pipeline sem boxes vai para a lixeira (definição guardada em lixeira/pipelines/), sai da memória e do disco. */
        trashPipeline(pl) { state.pipelines.delete(pl.key); state.boxes.delete(pl.key); writeJson(path.join(P.lixeira, 'pipelines', `${pl.key}.json`), { ...pl, apagadoEm: t }); remover.push(path.join(P.pipelines, `${pl.key}.json`), path.join(P.boxes, `${pl.key}.json`)); tocados.pipelines.delete(pl.key); tocados.boxes.delete(pl.key); },
        mudar(tipo, refs = {}) { const seq = ++state.meta.seq; linhas.push({ seq, at: t, tipo, ...refs, por }); return seq; },
      };
      let out;
      try { out = await fn(tx); }
      catch (e) { load(); throw e; }
      if (linhas.length === 0) return out;
      try {
        backupDiario(t);
        for (const f of remover) fs.rmSync(f, { force: true });
        for (const k of tocados.pipelines) writeJson(path.join(P.pipelines, `${k}.json`), state.pipelines.get(k));
        for (const k of tocados.boxes) writeJson(path.join(P.boxes, `${k}.json`), { pipelineKey: k, boxes: Object.fromEntries(state.boxes.get(k) ?? new Map()) });
        if (tocados.contatos) writeJson(P.contatos, { contatos: Object.fromEntries(state.contatos) });
        if (tocados.orgs) writeJson(P.orgs, { organizacoes: Object.fromEntries(state.orgs) });
        appendFeed(linhas);
        writeJson(P.meta, state.meta);
      } catch (e) { load(); throw new Error(`não consegui gravar o CRM: ${e.message}`); }
      events.emit('mudanca', linhas);
      return out;
    };
    const p = fila.then(run, run);
    fila = p.catch(() => {});
    return p;
  }

  // ---- feed --------------------------------------------------------------------------------------------------
  /** Mudanças depois de `since` (seq). `reset: true` quando `since` saiu da janela retida (cliente recarrega tudo). */
  function changes(since, limit = 200) {
    const seqAtual = state.meta.seq;
    if (since >= seqAtual) return { seq: seqAtual, mudancas: [] };
    let linhas = [];
    try { linhas = fs.readFileSync(P.feed, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { linhas = []; }
    const primeira = linhas.length > 0 ? linhas[0].seq : seqAtual + 1;
    if (since > 0 && since < primeira - 1) return { seq: seqAtual, mudancas: [], reset: true };
    if (since === 0 && linhas.length > 0 && primeira > 1) return { seq: seqAtual, mudancas: [], reset: true };
    const sel = linhas.filter((l) => l.seq > since);
    return { seq: seqAtual, mudancas: sel.slice(0, limit), more: sel.length > limit };
  }
  /** Linhas do feed a partir de um instante (ms): para a atividade recente das caixas ("Tendências"). */
  function feedDesde(at) {
    try { return fs.readFileSync(P.feed, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((l) => l !== null && l.at >= at); } catch { return []; }
  }
  const onChange = (fn) => { events.on('mudanca', fn); return () => events.off('mudanca', fn); };

  return { dir, meta, listPipelines, getPipeline, listBoxes, allBoxes, getBox, listContatos, getContato, listOrgs, getOrg, mutate, changes, feedDesde, onChange, reload: load };
}

module.exports = { openStore, VERSAO };
