/**
 * crm-api.js — rotas /v1/crm/* do CRM próprio (meu-bot-crm), montadas pelo server.js depois do bearer. Só
 * roteamento, validação de entrada e tradução de erros; as regras ficam em crm-modelo.js e a persistência em
 * crm-store.js. Clientes: a extensão do Gmail (pelo proxy do app no Mac), o agente da máquina (crm/crm.mjs), o
 * job do WhatsApp (crm/crm-job.mjs) e o importador do Streak. Payloads enxutos: o agente paga em tokens.
 *
 * Exige o plano Pro em vigor (licenca.crmOk); sem ele, 403 crm_license. `X-Crm-Por` diz quem mudou.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const path = require('node:path');
const modelo = require('./crm-modelo');
const { openStore } = require('./crm-store');
const { createAutenticador } = require('./autenticador');

const POR_RE = /^[a-z]{2,20}$/;
/**
 * Programa de indicação (padrão em todo cliente com o CRM próprio): cada cliente indica até 3 pessoas; cada indicado
 * ganha 1 mês de chip grátis para experimentar o agente. Nasce uma vez por máquina (crm.json › indicacaoSemeada); se
 * a pessoa apagar, não volta. Nunca é o pipeline padrão das conversas do WhatsApp.
 */
const PROGRAMA_INDICACAO = {
  name: 'Programa de Indicação',
  stages: ['Indicado', 'Contato feito', 'Chip ativado (mês grátis)', 'Em experimentação', 'Virou cliente', 'Não seguiu'],
  fields: [
    { name: 'Indicado por', type: 'TEXT' },
    { name: 'Indicação nº', type: 'DROPDOWN', options: ['1', '2', '3'] },
    { name: 'Início do mês grátis', type: 'DATE' },
    { name: 'Fim do mês grátis', type: 'DATE' },
    { name: 'Plano depois do teste', type: 'DROPDOWN', options: ['Chip (R$ 97/mês)', 'Chip + Plano Claude Code', 'Ainda não decidiu', 'Não vai seguir'] },
    { name: 'Observações', type: 'TEXT' },
  ],
  origem: { programa: 'indicacao' },
};
const ehIndicacao = (p) => p?.origem?.programa === 'indicacao';
/** JSON com as chaves em ordem (para comparar objetos sem depender da ordem dos campos). */
const estavel = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((c) => [c, x[c]])) : x));
/** Anexo de caixa: até 15 MB (o corpo vem em base64, ~4/3 disso). */
const ARQUIVO_MAX = 15 * 1024 * 1024;
/** Nome seguro para mostrar e baixar: sem barras nem controles, até 180 caracteres. */
const nomeArquivo = (v) => String(v ?? '').replace(/[\\/\u0000-\u001f]/g, '_').trim().slice(0, 180) || 'arquivo';
const erroHttp = (res, json, status, message, code, type) => json(res, status, { error: { message, type: type ?? (status === 404 ? 'not_found' : status === 409 ? 'conflict' : status === 403 ? 'forbidden' : 'invalid_request_error'), ...(code ? { code } : {}) } });

/**
 * `deps`: dir do db, `configFile` (crm.json: pipeline padrão e regras do WhatsApp), `licenseOk()` (plano
 * Pro em vigor), `readJson/writeJson/json/readBody/log` do server.js.
 */
function createCrmApi(deps) {
  const { json, readBody, log } = deps;
  const store = openStore(deps.dir, { log });
  // A chave dos segredos fica fora do db/ (o backup diário copia o db/ inteiro).
  const autenticador = createAutenticador({ dir: deps.dir, chaveFile: deps.autenticadorChave ?? path.join(path.dirname(deps.dir), 'autenticador.chave'), log });
  const cfg = () => { const c = deps.readJson(deps.configFile, {}); return c && typeof c === 'object' ? c : {}; };
  // Pipeline padrão que não existe no CRM próprio (chave antiga do Streak no crm.json, ou pipeline apagado) não vale:
  // devolve null para a CLI e o importador tratarem como "nenhum escolhido", em vez de errar em toda busca.
  /**
   * Pipeline padrão (dono único da regra; CLI, job do WhatsApp e busca leem daqui): a chave gravada, se o pipeline
   * existe; senão, havendo um pipeline só, ele — e o crm.json é corrigido para não ficar apontando para o nada
   * (ex.: chave antiga do Streak). Com vários e nenhum válido: null, e a chave quebrada volta em `invalido`.
   */
  function pipelinePadrao() {
    const c = cfg();
    if (typeof c.pipelineKey === 'string' && store.getPipeline(c.pipelineKey) !== null) return { key: c.pipelineKey, invalido: null };
    const invalido = typeof c.pipelineKey === 'string' && c.pipelineKey !== '' ? c.pipelineKey : null;
    // O programa de indicação não conta: sozinho, ele não vira o pipeline das conversas do WhatsApp.
    const ps = store.listPipelines().filter((p) => !ehIndicacao(p));
    if (ps.length !== 1) return { key: null, invalido };
    const unico = ps[0];
    try { deps.writeJson(deps.configFile, { ...c, pipelineKey: unico.key, pipelineName: unico.name, savedAt: new Date().toISOString() }); log(`crm: pipeline padrão ${invalido ? `inválido (${invalido.slice(0, 12)}…)` : 'vazio'} → "${unico.name}" (${unico.key}), o único do CRM`); } catch (e) { log(`crm: não consegui corrigir o crm.json: ${e.message}`); }
    return { key: unico.key, invalido: null };
  }
  const configView = () => { const c = cfg(); const { key: pk, invalido } = pipelinePadrao(); return { pipelineKey: pk, pipelineName: pk !== null ? store.getPipeline(pk)?.name ?? null : null, ...(invalido !== null ? { pipelineKeyInvalido: invalido } : {}), silencioMin: Number.isInteger(c.silencioMin) ? c.silencioMin : 10, criarSemPerguntar: c.criarSemPerguntar === true, contextoWhatsapp: c.contextoWhatsapp !== false, savedAt: typeof c.savedAt === 'string' ? c.savedAt : null }; };

  const pipelineOr404 = (key) => { const p = store.getPipeline(key); if (p === null) throw new modelo.ErroCrm('nao_encontrado', `pipeline ${key} não existe`); return p; };
  const boxOr404 = (key) => { const b = store.getBox(key); if (b === null) throw new modelo.ErroCrm('nao_encontrado', `box ${key} não existe`); return b; };
  const contatosDe = (b) => b.contatos.map((k) => store.getContato(k)).filter(Boolean);
  const view = (b) => modelo.boxView(b, pipelineOr404(b.pipelineKey), store.listContatos());
  const boxFull = (b, n = 200) => ({ box: view(b), pipelineKey: b.pipelineKey, resumoIA: b.resumoIA ? { ...b.resumoIA, geradoEm: new Date(b.resumoIA.geradoEm).toISOString() } : null, arquivos: (b.arquivos ?? []).map(arquivoView), orgs: (b.orgs ?? []).map((k) => store.getOrg(k)).filter(Boolean).map((o) => ({ key: o.key, nome: o.nome, dominios: o.dominios })), comentarios: modelo.commentsView(b, n, modelo.LIMITES.comentario), threads: b.threads.map(modelo.threadView), contatos: contatosDe(b).map((c) => ({ key: c.key, nome: c.nome, telefones: c.telefones, emails: c.emails, ...(c.whatsapp ? { whatsapp: c.whatsapp } : {}) })), notes: b.notes });
  const resumo = (b) => ({ key: b.key, name: b.name, stageKey: b.stageKey, updatedAt: b.updatedAt, fields: b.fields, contatos: b.contatos.length, threads: b.threads.length, responsaveis: b.responsaveis ?? [], pessoas: contatosDe(b).slice(0, 3).map((c) => c.nome || c.emails[0] || c.telefones[0] || '') });

  /** Caixa entre pipelines (Home, contato, organização): nome, pipeline e etapa já resolvidos. */
  const caixaHome = (bx, extra = {}) => { const pl = store.getPipeline(bx.pipelineKey); const i = pl ? pl.stages.findIndex((s) => s.key === bx.stageKey) : -1; return { key: bx.key, name: bx.name, pipelineKey: bx.pipelineKey, pipelineName: pl?.name ?? '', stageKey: bx.stageKey, stage: i >= 0 ? pl.stages[i].name : '', stageIndex: i, updatedAt: bx.updatedAt, ...extra }; };
  /** Linha da lista de contatos: dados + organização + caixas/pipelines em que está. */
  const contatoLinha = (k, boxes) => { const bxs = boxes.filter((x) => x.contatos.includes(k.key)); const org = k.orgKey ? store.getOrg(k.orgKey) : null; return { ...modelo.contatoView(k), orgNome: org?.nome ?? null, caixas: bxs.length, pipelines: [...new Set(bxs.map((x) => store.getPipeline(x.pipelineKey)?.name).filter(Boolean))] }; };
  const orgLinha = (o) => { const cs = store.listContatos().filter((k) => k.orgKey === o.key); const ks = new Set(cs.map((k) => k.key)); const bxs = store.allBoxes().filter((x) => (x.orgs ?? []).includes(o.key) || x.contatos.some((k) => ks.has(k))); return { key: o.key, nome: o.nome, dominios: o.dominios, setor: o.setor ?? '', funcionarios: o.funcionarios ?? '', site: o.site ?? '', endereco: o.endereco ?? '', telefones: o.telefones ?? [], linkedin: o.linkedin ?? '', instagram: o.instagram ?? '', notas: o.notas ?? '', contatos: cs.length, caixas: bxs.length, pipelines: [...new Set(bxs.map((x) => store.getPipeline(x.pipelineKey)?.name).filter(Boolean))], createdAt: o.createdAt, updatedAt: o.updatedAt }; };
  /** Conversas do Gmail (já ligadas a caixas) com algum destes e-mails. */
  const threadsDe = (emails) => { const es = new Set(emails); if (es.size === 0) return []; const out = new Map(); for (const bx of store.allBoxes()) for (const t of bx.threads) if (t.emails.some((e) => es.has(e)) && !out.has(t.gid)) out.set(t.gid, { ...modelo.threadView(t), boxKey: bx.key, boxName: bx.name }); return [...out.values()].sort((x, y) => String(y.em).localeCompare(String(x.em))).slice(0, 50); };
  /** Contatos sem organização escolhida à mão, com e-mail do domínio da org, passam a ser dela (vínculo automático). */
  function vincularPorDominio(tx, org) {
    if (org.dominios.length === 0) return;
    for (const k of tx.listContatos()) {
      if (k.orgKey && k.orgAuto !== true) continue;
      if (k.orgKey === org.key) continue;
      if (k.emails.some((e) => org.dominios.includes(modelo.dominioDoEmail(e)))) { tx.setContato({ ...k, orgKey: org.key, orgAuto: true, updatedAt: tx.now }); tx.mudar('contato.update', { contato: k.key }); }
    }
  }

  let cacheWa = null;
  async function body(req, max = 256 * 1024) {
    const raw = await readBody(req, max);
    if (raw === '' || raw === undefined) return {};
    try { const v = JSON.parse(raw); if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('objeto'); return v; } catch { throw new modelo.ErroCrm('invalido', 'JSON inválido'); }
  }
  const int = (v, dflt, min, max) => { const n = Number.parseInt(String(v ?? ''), 10); return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : dflt; };

  /** Vincula um contato (por telefone/e-mail/nome) ao box dentro de uma transação já aberta. */
  function vincularContato(tx, box, input) {
    let { contato, novo } = modelo.upsertContato(tx.listContatos(), input, tx.now, tx.rnd);
    const auto = modelo.orgAutomatica(contato, tx.listOrgs()); if (auto && contato.orgKey !== auto.key) contato = { ...contato, orgKey: auto.key, orgAuto: true };
    tx.setContato(contato);
    tx.mudar(novo ? 'contato.create' : 'contato.update', { contato: contato.key });
    if (box !== null && !box.contatos.includes(contato.key)) { const b = { ...box, contatos: [...box.contatos, contato.key], updatedAt: tx.now }; tx.setBox(b); return { contato, box: b, vinculado: true }; }
    return { contato, box, vinculado: box !== null };
  }

  /** Grava um anexo em db/arquivos/<dono>/ (caixa ou contato) e devolve o metadado; quem chama o põe no dono. */
  function gravarArquivo(tx, dono, input, dados, por, extra = {}) {
    const pasta = path.join(deps.dir, 'arquivos', dono);
    const x = { key: modelo.novaChave('f', tx.rnd), nome: nomeArquivo(input.nome), tipo: typeof input.tipo === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(input.tipo) ? input.tipo : 'application/octet-stream', tamanho: dados.length, em: tx.now, por, ...extra };
    fs.mkdirSync(pasta, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(pasta, x.key), dados, { mode: 0o600 });
    return x;
  }
  const arquivoView = (x) => ({ ...x, em: new Date(x.em).toISOString().slice(0, 16) });
  /** Baixar ou apagar (vai para a lixeira) um anexo de `dono`; `salvar(lista)` grava a lista sem ele. */
  async function arquivoDe(m, dono, lista, d, por, salvar) {
    const x = lista.find((y) => y.key === d);
    if (!x) throw new modelo.ErroCrm('nao_encontrado', 'arquivo não existe');
    const pasta = path.join(deps.dir, 'arquivos', dono);
    if (m === 'GET') { let dados; try { dados = fs.readFileSync(path.join(pasta, x.key)); } catch { throw new modelo.ErroCrm('nao_encontrado', 'o arquivo sumiu da máquina'); } return { nome: x.nome, tipo: x.tipo, tamanho: x.tamanho, base64: dados.toString('base64') }; }
    if (m === 'DELETE') {
      await store.mutate(por, (tx) => {
        try { const lx = path.join(deps.dir, 'lixeira', 'arquivos', dono); fs.mkdirSync(lx, { recursive: true, mode: 0o700 }); fs.renameSync(path.join(pasta, x.key), path.join(lx, `${x.key}-${x.nome}`)); } catch { /* já não estava lá */ }
        salvar(tx);
      });
      return { ok: true };
    }
    throw new modelo.ErroCrm('nao_encontrado', `rota desconhecida: ${m}`);
  }

  async function rota(req, res, url, por) {
    const p = url.pathname.replace(/^\/v1\/crm\/?/, '').replace(/\/+$/, '');
    const seg = p === '' ? [] : p.split('/').map((s) => decodeURIComponent(s));
    const m = req.method;
    const [a, b, c, d] = seg;
    const sp = url.searchParams;
    if (seg.length > 4) throw new modelo.ErroCrm('nao_encontrado', `rota desconhecida: ${m} ${url.pathname}`);
    for (const s of [b, d]) if (s !== undefined && !modelo.isKey(s) && !modelo.KEY_RE.test(s) && !/^[0-9a-f]{10,20}$/i.test(s)) throw new modelo.ErroCrm('invalido', 'chave inválida na rota');

    // ---- autenticador (TOTP): o segredo nunca sai; só os códigos ----
    if (a === 'autenticador') {
      if (b === undefined && m === 'GET') return autenticador.listar(por);
      if (b === undefined && m === 'POST') return autenticador.criar(await body(req, 8192), por);
      if (b === 'codigos' && c === undefined && m === 'GET') return autenticador.codigos(por);
      if (b !== undefined && c === undefined && m === 'PATCH') return autenticador.editar(b, await body(req, 8192), por);
      if (b !== undefined && c === undefined && m === 'DELETE') return autenticador.apagar(b, por);
      if (b !== undefined && c === 'codigo' && d === undefined && m === 'GET') return autenticador.codigo(b, por);
      throw new modelo.ErroCrm('nao_encontrado', `rota desconhecida: ${m} ${url.pathname}`);
    }

    // ---- status / config ----
    if (a === 'status' && m === 'GET') { const meta = store.meta(); return { ok: true, seq: meta.seq, pipelines: store.listPipelines().length, boxes: store.allBoxes().length, contatos: store.listContatos().length, config: configView() }; }
    if (a === 'config' && m === 'GET') return configView();
    if (a === 'config' && m === 'PUT') {
      const pz = await body(req); const cur = cfg(); const next = { ...cur };
      if ('pipelineKey' in pz) { if (pz.pipelineKey === null) { next.pipelineKey = null; next.pipelineName = null; } else { const pl = pipelineOr404(String(pz.pipelineKey)); next.pipelineKey = pl.key; next.pipelineName = pl.name; } }
      if ('silencioMin' in pz) { const n = Number(pz.silencioMin); if (!Number.isInteger(n) || n < 1 || n > 240) throw new modelo.ErroCrm('invalido', 'o silêncio vai de 1 a 240 minutos'); next.silencioMin = n; }
      if ('contextoWhatsapp' in pz) { if (typeof pz.contextoWhatsapp !== 'boolean') throw new modelo.ErroCrm('invalido', 'contextoWhatsapp deve ser true/false'); next.contextoWhatsapp = pz.contextoWhatsapp; }
      if ('criarSemPerguntar' in pz) { if (typeof pz.criarSemPerguntar !== 'boolean') throw new modelo.ErroCrm('invalido', 'criarSemPerguntar deve ser true/false'); next.criarSemPerguntar = pz.criarSemPerguntar; }
      next.savedAt = new Date().toISOString();
      deps.writeJson(deps.configFile, next);
      return configView();
    }

    // Contexto para o agente do WhatsApp (plugin do OpenClaw, antes de cada resposta ao contato): só o essencial.
    if (a === 'contexto' && b === undefined && m === 'GET') {
      if (cfg().contextoWhatsapp === false) return { texto: null };
      const tel = modelo.normalizePhone(sp.get('phone')); if (tel === null) throw new modelo.ErroCrm('invalido', 'telefone inválido');
      const c = store.listContatos().find((k) => k.telefones.includes(tel)) ?? null;
      if (c === null) return { texto: null };
      const boxes = store.allBoxes().filter((x) => x.contatos.includes(c.key));
      return { texto: modelo.contextoWhatsapp({ boxes, pipelines: new Map(store.listPipelines().map((p) => [p.key, p])), contato: c, agora: Date.now() }) };
    }

    // ---- pipelines ----
    // Ligar ou desligar a autonomia do agente num pipeline é do dono (app). Vinda do agente, a marca não é gravada:
    // o pedido fica no feed (`autonomia.pedida`) e a resposta é 403, no mesmo molde de `exclusao_requer_dono`.
    const autonomiaSoDoDono = async (input, alvo) => {
      if (por !== 'agente' || input === null || typeof input !== 'object' || !('agenteAutonomo' in input)) return;
      await store.mutate(por, (tx) => { tx.mudar('autonomia.pedida', { alvo, valor: input.agenteAutonomo === true }); });
      throw new modelo.ErroCrm('autonomia_requer_dono', 'ligar ou desligar a autonomia do agente num pipeline é do dono: o pedido ficou registrado, ele decide no app');
    };
    if (a === 'pipelines' && b === undefined) {
      if (m === 'GET') return { pipelines: store.listPipelines().map((pl) => ({ key: pl.key, name: pl.name, boxes: store.listBoxes(pl.key).length, agenteAutonomo: pl.agenteAutonomo === true, updatedAt: pl.updatedAt })) };
      if (m === 'POST') { const input = await body(req); await autonomiaSoDoDono(input, 'pipelines'); const pl = await store.mutate(por, (tx) => { const novo = modelo.novoPipeline(input, tx.now, tx.rnd); if (tx.getPipeline(novo.key)) throw new modelo.ErroCrm('conflito', `pipeline ${novo.key} já existe`); tx.setPipeline(novo); tx.mudar('pipeline.create', { pipeline: novo.key }); return novo; }); return { pipeline: modelo.pipelineView(pl) }; }
    }
    if (a === 'pipelines' && b !== undefined && c === undefined) {
      if (m === 'GET') return modelo.pipelineView(pipelineOr404(b));
      if (m === 'PATCH') {
        const patch = await body(req);
        await autonomiaSoDoDono(patch, `pipelines/${b}`);
        const pl = await store.mutate(por, (tx) => {
          const cur = pipelineOr404(b);
          const r = modelo.patchPipeline(cur, patch, tx.listBoxes(b), tx.now, tx.rnd);
          tx.setPipeline(r.pipeline);
          for (const bx of tx.listBoxes(b)) {
            let nb = bx; let mudou = false;
            if (r.moverEtapas[bx.stageKey]) { nb = { ...nb, stageKey: r.moverEtapas[bx.stageKey], updatedAt: tx.now }; mudou = true; }
            for (const fk of r.removerCampos) if (fk in nb.fields) { nb = { ...nb, fields: { ...nb.fields }, updatedAt: tx.now }; delete nb.fields[fk]; mudou = true; }
            if (mudou) { tx.setBox(nb); tx.mudar('box.update', { pipeline: b, box: nb.key }); }
          }
          tx.mudar('pipeline.update', { pipeline: b });
          return r.pipeline;
        });
        return { pipeline: modelo.pipelineView(pl) };
      }
      if (m === 'DELETE') {
        await store.mutate(por, (tx) => {
          const pl = pipelineOr404(b);
          if (tx.listBoxes(b).length > 0) throw new modelo.ErroCrm('conflito', 'o pipeline tem boxes; apague ou mova antes');
          tx.trashPipeline(pl); tx.mudar('pipeline.delete', { pipeline: b });
          // O pipeline padrão do WhatsApp não pode apontar para um pipeline que não existe mais.
          const c = cfg(); if (c.pipelineKey === b) deps.writeJson(deps.configFile, { ...c, pipelineKey: null, pipelineName: null, savedAt: new Date().toISOString() });
        });
        return { ok: true };
      }
    }
    if (a === 'pipelines' && b !== undefined && c === 'boxes' && d === undefined) {
      const pl = pipelineOr404(b);
      if (m === 'GET') {
        let list = store.listBoxes(b);
        const stage = sp.get('stage'); if (stage) { const s = modelo.findStage(pl, stage); if (!s) throw new modelo.ErroCrm('invalido', `etapa "${stage}" não existe`); list = list.filter((x) => x.stageKey === s.key); }
        const q = sp.get('q'); if (q) list = modelo.buscar({ boxes: list, contatos: store.listContatos(), legacyPhones: cfg().telefones }, { query: q }, 100000).boxes;
        const since = int(sp.get('since'), 0, 0, Number.MAX_SAFE_INTEGER); if (since > 0) list = list.filter((x) => x.updatedAt > since);
        list.sort((x, y) => y.updatedAt - x.updatedAt);
        const limit = int(sp.get('limit'), 100, 1, 1000); const offset = int(sp.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
        return { boxes: list.slice(offset, offset + limit).map(resumo), total: list.length, stages: pl.stages };
      }
      if (m === 'POST') {
        const input = await body(req);
        const out = await store.mutate(por, (tx) => {
          let bx = modelo.novoBox(pl, input, tx.now, tx.rnd);
          if (tx.getBox(bx.key)) throw new modelo.ErroCrm('conflito', `box ${bx.key} já existe`);
          tx.setBox(bx); tx.mudar('box.create', { pipeline: b, box: bx.key });
          if (typeof input.phone === 'string' || typeof input.email === 'string') bx = vincularContato(tx, bx, { phone: input.phone, email: input.email, name: input.contactName }).box;
          return bx;
        });
        return { ok: true, box: view(out) };
      }
    }

    // ---- boxes ----
    // Lista entre pipelines, para a Home: `keys=a,b` (as que o usuário abriu, nessa ordem) ou `ordem=atividade`
    // (mais mudanças nos últimos 7 dias; desempate pela última atualização).
    if (a === 'boxes' && b === undefined && m === 'GET') {
      const limit = int(sp.get('limit'), 20, 1, 100);
      const item = caixaHome;
      const keys = sp.get('keys');
      if (keys !== null) {
        const ks = keys.split(',').filter((k) => modelo.isKey(k)).slice(0, 100);
        return { boxes: ks.map((k) => store.getBox(k)).filter(Boolean).slice(0, limit).map((bx) => item(bx)) };
      }
      const desde = Date.now() - 7 * 86_400_000; const n = new Map();
      for (const l of store.feedDesde(desde)) if (typeof l.box === 'string') n.set(l.box, (n.get(l.box) ?? 0) + 1);
      const todas = store.allBoxes().map((bx) => ({ bx, atividade: n.get(bx.key) ?? 0 }));
      todas.sort((x, y) => y.atividade - x.atividade || y.bx.updatedAt - x.bx.updatedAt);
      return { boxes: todas.slice(0, limit).map(({ bx, atividade }) => item(bx, { atividade })) };
    }
    if (a === 'boxes' && b !== undefined && c === undefined) {
      if (m === 'GET') return boxFull(boxOr404(b), int(sp.get('comentarios'), 20, 0, 500));
      if (m === 'PATCH') { const patch = await body(req); const out = await store.mutate(por, (tx) => { const cur = boxOr404(b); const nb = modelo.patchBox(pipelineOr404(cur.pipelineKey), cur, patch, tx.now); tx.setBox(nb); tx.mudar('box.update', { pipeline: nb.pipelineKey, box: nb.key }); return nb; }); return { ok: true, box: view(out) }; }
      if (m === 'DELETE') { await store.mutate(por, (tx) => { const cur = boxOr404(b); tx.trashBox(cur); tx.mudar('box.delete', { pipeline: cur.pipelineKey, box: cur.key }); }); return { ok: true }; }
    }
    if (a === 'boxes' && b !== undefined && c === 'comments' && d === undefined) {
      if (m === 'GET') return { box: b, comentarios: modelo.commentsView(boxOr404(b), int(sp.get('limit'), 20, 1, 500)) };
      if (m === 'POST') { const input = await body(req); const r = await store.mutate(por, (tx) => { const cur = boxOr404(b); const { box, comentario } = modelo.addComment(cur, input.texto ?? input.text ?? input.message, input.autor ?? por, tx.now, tx.rnd); tx.setBox(box); tx.mudar('box.comment', { pipeline: box.pipelineKey, box: box.key }); return comentario; }); return { ok: true, box: b, comentario: r.key, em: new Date(r.at).toISOString() }; }
    }
    if (a === 'boxes' && b !== undefined && c === 'comments' && d !== undefined && (m === 'PATCH' || m === 'DELETE')) {
      const input = m === 'PATCH' ? await body(req) : {};
      await store.mutate(por, (tx) => {
        const cur = boxOr404(b); const i = cur.comentarios.findIndex((x) => x.key === d);
        if (i < 0) throw new modelo.ErroCrm('nao_encontrado', 'registro não existe');
        const comentarios = [...cur.comentarios];
        if (m === 'DELETE') comentarios.splice(i, 1);
        else { const texto = typeof input.texto === 'string' ? input.texto.replace(/\r\n?/g, '\n').trim().slice(0, modelo.LIMITES.comentario) : ''; if (texto === '') throw new modelo.ErroCrm('invalido', 'o registro não pode ficar vazio'); comentarios[i] = { ...comentarios[i], texto, editadoEm: tx.now }; }
        tx.setBox({ ...cur, comentarios, updatedAt: tx.now }); tx.mudar('box.comment', { pipeline: cur.pipelineKey, box: cur.key });
      });
      return { ok: true };
    }
    // Resumo com IA (botão ↻ do cartão "Resumo"): o motor do chat lê a caixa toda e devolve três partes curtas.
    if (a === 'boxes' && b !== undefined && c === 'resumo' && d === undefined && m === 'POST') {
      if (typeof deps.iaTexto !== 'function') throw new modelo.ErroCrm('invalido', 'o motor de IA não está disponível nesta máquina');
      const cur = boxOr404(b); const pl = pipelineOr404(cur.pipelineKey);
      const prompt = modelo.promptResumo({ box: cur, pipeline: pl, contatos: contatosDe(cur), orgs: (cur.orgs ?? []).map((k) => store.getOrg(k)).filter(Boolean), agora: Date.now() });
      let texto; try { texto = await deps.iaTexto(prompt, `crm-resumo-${b}-${Date.now()}`); } catch (e) { throw new modelo.ErroCrm('invalido', `não consegui gerar o resumo: ${e.message}`); }
      const r = modelo.parseResumo(texto);
      const resumoIA = await store.mutate(por, (tx) => { const atual = boxOr404(b); const x = { ...r, geradoEm: tx.now }; tx.setBox({ ...atual, resumoIA: x }); tx.mudar('box.update', { pipeline: atual.pipelineKey, box: atual.key }); return x; });
      return { ok: true, resumoIA: { ...resumoIA, geradoEm: new Date(resumoIA.geradoEm).toISOString() } };
    }
    // Anexos da caixa: o arquivo fica em db/arquivos/<box>/<chave>; a caixa guarda nome, tipo, tamanho e quem anexou.
    if (a === 'boxes' && b !== undefined && c === 'files') {
      if (m === 'GET' && d === undefined) return { arquivos: (boxOr404(b).arquivos ?? []).map(arquivoView) };
      if (m === 'POST' && d === undefined) {
        const input = await body(req, Math.ceil(ARQUIVO_MAX * 1.4) + 4096);
        const dados = typeof input.base64 === 'string' ? Buffer.from(input.base64, 'base64') : null;
        if (!dados || dados.length === 0) throw new modelo.ErroCrm('invalido', 'arquivo vazio');
        if (dados.length > ARQUIVO_MAX) throw new modelo.ErroCrm('invalido', 'arquivo maior que 15 MB');
        const meta = await store.mutate(por, (tx) => {
          const cur = boxOr404(b);
          const x = gravarArquivo(tx, b, input, dados, por);
          tx.setBox({ ...cur, arquivos: [...(cur.arquivos ?? []), x], updatedAt: tx.now }); tx.mudar('box.update', { pipeline: cur.pipelineKey, box: cur.key });
          return x;
        });
        return { ok: true, arquivo: arquivoView(meta) };
      }
      if (d !== undefined) return arquivoDe(m, b, boxOr404(b).arquivos ?? [], d, por, (tx) => { const atual = boxOr404(b); tx.setBox({ ...atual, arquivos: (atual.arquivos ?? []).filter((y) => y.key !== d), updatedAt: tx.now }); tx.mudar('box.update', { pipeline: atual.pipelineKey, box: atual.key }); });
    }
    // Organização ligada direto à caixa (além das que vêm pelos contatos), como no Streak.
    if (a === 'boxes' && b !== undefined && c === 'orgs') {
      if (m === 'POST' && d === undefined) { const input = await body(req); await store.mutate(por, (tx) => { const cur = boxOr404(b); const o = tx.getOrg(String(input.key ?? '')); if (!o) throw new modelo.ErroCrm('nao_encontrado', 'organização não existe'); if ((cur.orgs ?? []).includes(o.key)) return; tx.setBox({ ...cur, orgs: [...(cur.orgs ?? []), o.key], updatedAt: tx.now }); tx.mudar('box.update', { pipeline: cur.pipelineKey, box: cur.key }); }); return { ok: true }; }
      if (m === 'DELETE' && d !== undefined) { await store.mutate(por, (tx) => { const cur = boxOr404(b); if (!(cur.orgs ?? []).includes(d)) return; tx.setBox({ ...cur, orgs: cur.orgs.filter((x) => x !== d), updatedAt: tx.now }); tx.mudar('box.update', { pipeline: cur.pipelineKey, box: cur.key }); }); return { ok: true }; }
    }
    if (a === 'boxes' && b !== undefined && c === 'contacts' && d !== undefined && m === 'DELETE') {
      await store.mutate(por, (tx) => { const cur = boxOr404(b); if (!cur.contatos.includes(d)) throw new modelo.ErroCrm('nao_encontrado', 'contato não está nesta caixa'); tx.setBox({ ...cur, contatos: cur.contatos.filter((k) => k !== d), updatedAt: tx.now }); tx.mudar('box.update', { pipeline: cur.pipelineKey, box: cur.key }); });
      return { ok: true };
    }
    if (a === 'boxes' && b !== undefined && c === 'threads') {
      if (m === 'GET' && d === undefined) return { box: b, threads: boxOr404(b).threads.map(modelo.threadView) };
      if ((m === 'PUT' || m === 'POST') && d === undefined) {
        const input = await body(req);
        const out = await store.mutate(por, (tx) => {
          const cur = boxOr404(b); const gid = modelo.validarThreadId(input.threadGmailId ?? input.gid);
          const dono = tx.allBoxes().find((x) => x.key !== cur.key && x.threads.some((t) => t.gid === gid));
          if (dono) { const e = new modelo.ErroCrm('conflito', `a conversa já está no box "${dono.name}" (${dono.key}); uma conversa só pode estar em um box`); e.box = { key: dono.key, name: dono.name }; throw e; }
          const nb = modelo.addThread(cur, { ...input, threadGmailId: gid }, tx.now); tx.setBox(nb); tx.mudar('box.thread', { pipeline: nb.pipelineKey, box: nb.key, thread: gid });
          if (Array.isArray(input.emails)) for (const em of input.emails.slice(0, 5)) { if (typeof em === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) && !tx.listContatos().some((k) => k.emails.includes(em.toLowerCase()))) { /* contatos só com pedido explícito */ } }
          return nb;
        });
        return { ok: true, box: b, threads: out.threads.map(modelo.threadView) };
      }
      if (m === 'DELETE' && d !== undefined) { await store.mutate(por, (tx) => { const cur = boxOr404(b); const nb = modelo.removeThread(cur, d, tx.now); tx.setBox(nb); tx.mudar('box.thread', { pipeline: nb.pipelineKey, box: nb.key, thread: d.toLowerCase() }); }); return { ok: true }; }
    }

    // ---- threads ----
    if (a === 'threads' && b !== undefined && c === undefined && m === 'GET') {
      const gid = modelo.validarThreadId(b);
      const bx = store.allBoxes().find((x) => x.threads.some((t) => t.gid === gid));
      if (!bx) throw new modelo.ErroCrm('nao_encontrado', 'conversa sem box');
      return { box: view(bx), pipelineKey: bx.pipelineKey };
    }
    if (a === 'threads' && b === 'lookup' && m === 'POST') {
      const input = await body(req); const ids = Array.isArray(input.ids) ? input.ids.slice(0, 200) : [];
      const idx = modelo.buildIndex(store.allBoxes(), store.listContatos()); const out = {};
      for (const id of ids) { const g = String(id).toLowerCase(); const k = idx.porThread.get(g); if (!k) continue; const bx = store.getBox(k); if (!bx) continue; const pl = store.getPipeline(bx.pipelineKey); out[g] = { key: bx.key, name: bx.name, stageKey: bx.stageKey, stage: pl?.stages.find((s) => s.key === bx.stageKey)?.name ?? bx.stageKey, pipelineKey: bx.pipelineKey }; }
      return { boxes: out };
    }

    // ---- contatos ----
    if (a === 'contacts' && b === undefined) {
      if (m === 'GET') {
        const q = modelo.norm(sp.get('q') ?? ''); const ph = modelo.digits(sp.get('phone') ?? ''); const em = modelo.norm(sp.get('email') ?? ''); const ok = sp.get('org');
        const lim = int(sp.get('limit'), 100, 1, 2000); const boxes = store.allBoxes();
        const lista = store.listContatos().filter((k) => (q === '' || modelo.norm(k.nome).includes(q) || k.emails.some((e) => e.includes(q)) || modelo.norm(k.cargo ?? '').includes(q)) && (ph === '' || k.telefones.some((t) => modelo.digits(t).includes(ph))) && (em === '' || k.emails.some((e) => e.includes(em))) && (ok === null || k.orgKey === ok));
        lista.sort((x, y) => (x.nome || x.emails[0] || '').localeCompare(y.nome || y.emails[0] || '', 'pt-BR'));
        return { total: lista.length, contatos: lista.slice(0, lim).map((k) => contatoLinha(k, boxes)) };
      }
      if (m === 'POST') {
        const input = await body(req);
        const r = await store.mutate(por, (tx) => { const bx = typeof input.box === 'string' ? boxOr404(input.box) : null; const out = vincularContato(tx, bx, input); if (out.box && bx) tx.mudar('box.update', { pipeline: out.box.pipelineKey, box: out.box.key }); return out; });
        return { ok: true, contato: r.contato.key, nome: r.contato.nome, vinculado: r.vinculado };
      }
    }
    // Resumo da conversa do WhatsApp com um telefone (gravado pelo crm-job): vai para o contato desse número
    // (criado e ligado à caixa, se vier `box`, quando ainda não existe). O consolidado das conversas arquivadas fica.
    if (a === 'contacts' && b === 'whatsapp' && m === 'PUT') {
      const input = await body(req);
      const tel = modelo.normalizePhone(input.phone); if (tel === null) throw new modelo.ErroCrm('invalido', 'telefone inválido');
      const resumo = typeof input.resumo === 'string' ? input.resumo.trim().slice(0, 1200) : '';
      const k = await store.mutate(por, (tx) => {
        let c = tx.listContatos().find((x) => x.telefones.includes(tel)) ?? null;
        const bx = typeof input.box === 'string' ? tx.getBox(input.box) : null;
        if (c === null) { if (bx === null) throw new modelo.ErroCrm('nao_encontrado', 'nenhum contato com esse telefone'); c = vincularContato(tx, bx, { phone: tel }).contato; if (!bx.contatos.includes(c.key)) tx.mudar('box.update', { pipeline: bx.pipelineKey, box: bx.key }); }
        const w = { resumo, mensagens: Number.isInteger(input.mensagens) && input.mensagens >= 0 ? input.mensagens : (c.whatsapp?.mensagens ?? 0), ultimaEm: Number.isFinite(input.ultimaEm) && input.ultimaEm > 0 ? input.ultimaEm : tx.now, atualizadoEm: tx.now, ...(c.whatsapp?.arquivo ? { arquivo: c.whatsapp.arquivo } : {}) };
        const n = { ...tx.getContato(c.key), whatsapp: w, updatedAt: tx.now };
        tx.setContato(n); tx.mudar('contato.update', { contato: n.key });
        for (const x of tx.allBoxes()) if (x.contatos.includes(n.key)) tx.mudar('box.update', { pipeline: x.pipelineKey, box: x.key });
        return n;
      });
      return { ok: true, contato: k.key };
    }
    // Conversa do WhatsApp que o dono vai limpar no app: antes, fica no CRM. A transcrição (Markdown montado
    // no app) vira anexo da caixa mais recente do contato, com um registro na linha do tempo, ou fica no próprio
    // contato se ele não tem caixa; depois o motor soma a conversa ao resumo do contato. O mesmo texto duas vezes
    // (tentou de novo depois de uma limpeza que falhou) não duplica. Sem IA, o arquivo fica e `resumo` volta false.
    if (a === 'whatsapp' && b === 'arquivar' && m === 'POST') {
      const input = await body(req, ARQUIVO_MAX * 2 + 4096);
      // Grupo: nao tem contato unico, entao a conversa vai para a caixa fixa do grupo (fields.whatsappGrupo).
      // Na primeira vez ela nasce sozinha no pipeline padrao, com o nome do grupo, na primeira etapa: o dono nao
      // escolhe numa lista. Sem pipeline padrao nao da para abrir a caixa, e nada e gravado nem limpo.
      const grupo = input.grupo && typeof input.grupo === 'object' ? input.grupo : null;
      if (grupo !== null) {
        const jid = typeof grupo.jid === 'string' && /^\d{10,25}(-\d+)?@g\.us$/.test(grupo.jid) ? grupo.jid : null;
        if (jid === null) throw new modelo.ErroCrm('invalido', 'grupo invalido');
        const transcricao = typeof input.transcricao === 'string' ? input.transcricao : '';
        if (transcricao.trim() === '') throw new modelo.ErroCrm('invalido', 'conversa vazia');
        const dados = Buffer.from(transcricao, 'utf8');
        if (dados.length > ARQUIVO_MAX) throw new modelo.ErroCrm('invalido', 'conversa maior que 15 MB');
        const sha256 = crypto.createHash('sha256').update(dados).digest('hex');
        const mensagens = Number.isInteger(input.mensagens) && input.mensagens > 0 ? input.mensagens : 0;
        const de = Number.isFinite(input.primeiraEm) && input.primeiraEm > 0 ? input.primeiraEm : 0;
        const ate = Number.isFinite(input.ultimaEm) && input.ultimaEm > 0 ? input.ultimaEm : 0;
        const dia = (x) => new Date(x).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const titulo = typeof grupo.nome === 'string' && grupo.nome.trim() !== '' ? grupo.nome.trim().slice(0, 120) : jid;
        const ligada = store.allBoxes().find((x) => (x.fields ?? {}).whatsappGrupo === jid) ?? null;
        const pk = ligada === null ? pipelinePadrao().key : null;
        if (ligada === null && pk === null) throw new modelo.ErroCrm('invalido', 'o CRM nao tem pipeline padrao para abrir a caixa deste grupo: escolha um nas configuracoes do CRM');
        const g = await store.mutate(por, (tx) => {
          let bx = ligada === null ? null : tx.getBox(ligada.key);
          let criada = false;
          if (bx === null) {
            const pl = pipelineOr404(pk ?? ligada.pipelineKey);
            const novo = modelo.novoBox(pl, { name: titulo }, tx.now, tx.rnd);
            bx = { ...novo, fields: { ...novo.fields, whatsappGrupo: jid } };
            tx.setBox(bx); tx.mudar('box.create', { pipeline: pl.key, box: bx.key }); criada = true;
          }
          const ja = (bx.arquivos ?? []).find((x) => x.sha256 === sha256);
          if (ja) return { box: bx, arquivo: ja, repetido: true, criada };
          const nome = `conversa-grupo-${new Date(ate || tx.now).toISOString().slice(0, 10)}.md`;
          const x = gravarArquivo(tx, bx.key, { nome, tipo: 'text/markdown' }, dados, por, { sha256, mensagens, de, ate });
          const periodo = de && ate ? `, de ${dia(de)} a ${dia(ate)}` : '';
          const { box } = modelo.addComment(
            { ...bx, arquivos: [...(bx.arquivos ?? []), x], fields: { ...(bx.fields ?? {}), whatsappGrupo: jid }, updatedAt: tx.now },
            `${criada ? `\u{1F4E6} Caixa aberta para o grupo "${titulo}". ` : ''}\u{1F4E6} Conversa do grupo "${titulo}" arquivada antes de limpar: ${mensagens} mensagens${periodo}. Transcricao no anexo "${nome}".`,
            'whatsapp', tx.now, tx.rnd,
          );
          tx.setBox(box); tx.mudar('box.comment', { pipeline: box.pipelineKey, box: box.key });
          return { box: bx, arquivo: x, repetido: false, criada };
        });
        const saida = { ok: true, criada: g.criada, box: { key: g.box.key, nome: g.box.name }, arquivo: arquivoView(g.arquivo), repetido: g.repetido };
        if (g.repetido || typeof deps.iaTexto !== 'function') return { ...saida, resumo: false, ...(g.repetido ? {} : { aviso: 'o motor de IA nao esta disponivel nesta maquina' }) };
        let resumo;
        const anterior = (g.box.fields ?? {}).whatsappGrupoResumo;
        try {
          resumo = modelo.parseConsolidacao(await deps.iaTexto(
            modelo.promptConsolidacao({ nome: typeof grupo.nome === 'string' ? grupo.nome : jid, telefone: jid, resumoAnterior: typeof anterior === 'string' ? anterior : '', transcricao }),
            `crm-consolidar-grupo-${jid}-${Date.now()}`,
          ));
        } catch (e) {
          log(`crm: resumo da conversa de grupo ${jid} falhou: ${e.message}`);
          return { ...saida, resumo: false, aviso: `resumo nao atualizado: ${e.message}` };
        }
        await store.mutate(por, (tx) => {
          const cur = boxOr404(g.box.key);
          tx.setBox({ ...cur, fields: { ...(cur.fields ?? {}), whatsappGrupo: jid, whatsappGrupoResumo: resumo }, updatedAt: tx.now });
          tx.mudar('box.update', { pipeline: cur.pipelineKey, box: cur.key });
        });
        return { ...saida, resumo: true };
      }
      const tel = modelo.normalizePhone(input.phone); if (tel === null) throw new modelo.ErroCrm('invalido', 'telefone inválido');
      const transcricao = typeof input.transcricao === 'string' ? input.transcricao : '';
      if (transcricao.trim() === '') throw new modelo.ErroCrm('invalido', 'conversa vazia');
      const dados = Buffer.from(transcricao, 'utf8');
      if (dados.length > ARQUIVO_MAX) throw new modelo.ErroCrm('invalido', 'conversa maior que 15 MB');
      const sha256 = crypto.createHash('sha256').update(dados).digest('hex');
      const mensagens = Number.isInteger(input.mensagens) && input.mensagens > 0 ? input.mensagens : 0;
      const de = Number.isFinite(input.primeiraEm) && input.primeiraEm > 0 ? input.primeiraEm : 0;
      const ate = Number.isFinite(input.ultimaEm) && input.ultimaEm > 0 ? input.ultimaEm : 0;
      const dia = (t) => new Date(t).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const g = await store.mutate(por, (tx) => {
        let k = tx.listContatos().find((x) => x.telefones.includes(tel)) ?? null;
        if (k === null) k = vincularContato(tx, null, { phone: tel, name: typeof input.nome === 'string' && !/^\+?\d+$/.test(input.nome.trim()) ? input.nome : undefined }).contato;
        const caixas = tx.allBoxes().filter((x) => x.contatos.includes(k.key)).sort((x, y) => y.updatedAt - x.updatedAt);
        const bx = caixas[0] ?? null;
        const base = { contato: k.key, nome: k.nome, resumoAnterior: [k.whatsapp?.arquivo?.resumo, k.whatsapp?.resumo].filter(Boolean).join('\n'), arquivadoEm: k.whatsapp?.arquivo?.em ?? 0 };
        const ja = [...(k.arquivos ?? []).map((x) => ({ x, box: null })), ...caixas.flatMap((c) => (c.arquivos ?? []).map((x) => ({ x, box: c })))].find((y) => y.x.sha256 === sha256);
        if (ja) return { ...base, box: ja.box, arquivo: ja.x, repetido: true };
        // Hora no nome: dois arquivamentos no mesmo dia não se confundem; data em São Paulo, igual ao comentário.
        const sp = new Date(ate || tx.now).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' });
        const nome = `conversa-whatsapp-${sp.slice(0, 10)}-${sp.slice(11, 13)}${sp.slice(14, 16)}.md`;
        const extra = { sha256, mensagens, de, ate };
        if (bx !== null) {
          const x = gravarArquivo(tx, bx.key, { nome, tipo: 'text/markdown' }, dados, por, extra);
          const periodo = de && ate ? `, de ${dia(de)} a ${dia(ate)}` : '';
          const { box } = modelo.addComment({ ...bx, arquivos: [...(bx.arquivos ?? []), x], updatedAt: tx.now }, `📦 Conversa do WhatsApp arquivada antes de limpar: ${mensagens} mensagens${periodo}. Transcrição no anexo "${nome}".`, 'whatsapp', tx.now, tx.rnd);
          tx.setBox(box); tx.mudar('box.comment', { pipeline: box.pipelineKey, box: box.key });
          return { ...base, box: bx, arquivo: x, repetido: false };
        }
        const x = gravarArquivo(tx, k.key, { nome, tipo: 'text/markdown' }, dados, por, extra);
        const n = { ...tx.getContato(k.key), arquivos: [...(tx.getContato(k.key).arquivos ?? []), x], updatedAt: tx.now };
        tx.setContato(n); tx.mudar('contato.update', { contato: n.key });
        return { ...base, box: null, arquivo: x, repetido: false };
      });
      const saida = { ok: true, contato: g.contato, box: g.box ? { key: g.box.key, nome: g.box.name } : null, arquivo: arquivoView(g.arquivo), repetido: g.repetido };
      // Repetido e o resumo já saiu depois daquele arquivamento: nada a refazer.
      if (g.repetido && g.arquivadoEm >= g.arquivo.em) return { ...saida, resumo: true };
      if (typeof deps.iaTexto !== 'function') return { ...saida, resumo: false, aviso: 'o motor de IA não está disponível nesta máquina' };
      let resumo;
      try { resumo = modelo.parseConsolidacao(await deps.iaTexto(modelo.promptConsolidacao({ nome: g.nome, telefone: tel, resumoAnterior: g.resumoAnterior, transcricao }), `crm-consolidar-${tel}-${Date.now()}`)); }
      catch (e) { log(`crm: resumo da conversa arquivada de ${tel} falhou: ${e.message}`); return { ...saida, resumo: false, aviso: `resumo não atualizado: ${e.message}` }; }
      // `arquivo` guarda o consolidado das conversas apagadas; a conversa atual (resumo/mensagens, do crm-job) recomeça.
      await store.mutate(por, (tx) => {
        const cur = tx.getContato(g.contato); if (!cur) return;
        const total = (cur.whatsapp?.arquivo?.mensagens ?? 0) + (g.repetido ? 0 : mensagens);
        const n = { ...cur, whatsapp: { resumo: '', mensagens: 0, ultimaEm: Math.max(cur.whatsapp?.ultimaEm ?? 0, ate), atualizadoEm: tx.now, arquivo: { resumo, mensagens: total, em: tx.now } }, updatedAt: tx.now };
        tx.setContato(n); tx.mudar('contato.update', { contato: n.key });
        for (const x of tx.allBoxes()) if (x.contatos.includes(n.key)) tx.mudar('box.update', { pipeline: x.pipelineKey, box: x.key });
      });
      return { ...saida, resumo: true };
    }
    // Contatos do WhatsApp (o app do Mac salva no Google Contatos): crm-job.mjs contatos-whatsapp, cache de 5 min.
    if (a === 'whatsapp' && b === 'contatos' && m === 'GET') {
      if (cacheWa && Date.now() - cacheWa.em < 5 * 60_000) return { contatos: cacheWa.contatos };
      const job = path.join(path.dirname(deps.dir), 'crm-job.mjs');
      const saida = await new Promise((resolve, reject) => execFile(process.execPath, [job, 'contatos-whatsapp'], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PATH: `${require('node:os').homedir()}/.openclaw/bin:/opt/node/bin:${process.env.PATH ?? ''}` } }, (err, out) => (err ? reject(err) : resolve(out))));
      let contatos; try { contatos = JSON.parse(String(saida).trim().split('\n').pop()).contatos; } catch { throw new modelo.ErroCrm('invalido', 'lista de contatos do WhatsApp ilegível'); }
      cacheWa = { em: Date.now(), contatos };
      return { contatos };
    }
    // Importar contatos em lote (CSV do Google Contatos lido na extensão): acha pelo e-mail/telefone e completa sem
    // apagar; "empresa" vira a organização com esse nome (criada se não existir). Uma transação só.
    if (a === 'contacts' && b === 'import' && m === 'POST') {
      const input = await body(req, 8 * 1024 * 1024);
      const lista = Array.isArray(input.contatos) ? input.contatos.slice(0, 5000) : [];
      if (lista.length === 0) throw new modelo.ErroCrm('invalido', 'nenhum contato para importar');
      return store.mutate(por, (tx) => {
        const r = { criados: 0, atualizados: 0, ignorados: 0, orgsCriadas: 0, iguais: 0 };
        for (const it of lista) {
          const emails = Array.isArray(it?.emails) ? it.emails.filter((e) => typeof e === 'string') : [];
          const telefones = Array.isArray(it?.telefones) ? it.telefones.filter((t) => typeof t === 'string') : [];
          const nome = typeof it?.nome === 'string' ? it.nome.trim() : '';
          const existentes = tx.listContatos();
          const tels = telefones.map(modelo.normalizePhone).filter(Boolean); const mails = emails.map((e) => e.trim().toLowerCase());
          const gid = typeof it?.googleId === 'string' && /^people\/[A-Za-z0-9_-]{1,80}$/.test(it.googleId) ? it.googleId : null;
          let prev = (gid ? existentes.find((k) => k.google?.id === gid) : null) ?? existentes.find((k) => k.telefones.some((t) => tels.includes(t)) || k.emails.some((e) => mails.includes(e))) ?? null;
          if (!prev && tels.length === 0 && mails.length === 0) prev = nome !== '' ? existentes.find((k) => modelo.norm(k.nome) === modelo.norm(nome)) ?? null : null;
          let k;
          try { k = modelo.parseContato({ nome: prev?.nome ? '' : nome, emails, telefones }, tx.now, tx.rnd, prev); } catch { r.ignorados++; continue; }
          if (typeof it.cargo === 'string' && it.cargo.trim() !== '' && !k.cargo) k = { ...k, cargo: it.cargo.trim().slice(0, modelo.LIMITES.nome) };
          if (typeof it.notas === 'string' && it.notas.trim() !== '' && !k.notas) k = { ...k, notas: it.notas.trim().slice(0, modelo.LIMITES.notes) };
          for (const campo of ['instagram', 'linkedin']) if (typeof it[campo] === 'string' && it[campo].trim() !== '' && !k[campo]) k = { ...k, [campo]: it[campo].trim().slice(0, modelo.LIMITES.nome) };
          // Vínculo com o Google Contatos (a ficha mostra o link; a próxima sincronização acha a pessoa por ele).
          if (gid) k = { ...k, google: { id: gid, url: `https://contacts.google.com/person/${gid.slice(7)}` } };
          const empresa = typeof it.empresa === 'string' ? it.empresa.trim() : '';
          if (empresa !== '' && (!k.orgKey || k.orgAuto === true)) {
            let o = tx.listOrgs().find((x) => modelo.norm(x.nome) === modelo.norm(empresa)) ?? null;
            if (!o) { o = modelo.parseOrg({ nome: empresa }, tx.now, tx.rnd); tx.setOrg(o); tx.mudar('org.create', { org: o.key }); r.orgsCriadas++; }
            k = { ...k, orgKey: o.key, orgAuto: false };
          } else { const auto = modelo.orgAutomatica(k, tx.listOrgs()); if (auto) k = { ...k, orgKey: auto.key, orgAuto: true }; }
          // Sincronização periódica: quem não mudou não é regravado (nem polui o feed).
          if (prev && estavel({ ...prev, updatedAt: 0 }) === estavel({ ...k, updatedAt: 0 })) { r.iguais = (r.iguais ?? 0) + 1; continue; }
          tx.setContato(k); tx.mudar(prev ? 'contato.update' : 'contato.create', { contato: k.key });
          if (prev) r.atualizados++; else r.criados++;
        }
        return { ok: true, ...r };
      });
    }
    // Conversas do WhatsApp arquivadas num contato sem caixa (POST /whatsapp/arquivar): baixar ou apagar.
    if (a === 'contacts' && b !== undefined && c === 'files' && d !== undefined) {
      const k = store.getContato(b); if (!k) throw new modelo.ErroCrm('nao_encontrado', 'contato não existe');
      return arquivoDe(m, b, k.arquivos ?? [], d, por, (tx) => { const cur = tx.getContato(b); if (!cur) return; const n = { ...cur, arquivos: (cur.arquivos ?? []).filter((y) => y.key !== d), updatedAt: tx.now }; tx.setContato(n); tx.mudar('contato.update', { contato: b }); });
    }
    if (a === 'contacts' && b !== undefined && c === undefined) {
      if (m === 'GET') {
        const k = store.getContato(b); if (!k) throw new modelo.ErroCrm('nao_encontrado', 'contato não existe');
        const bxs = store.allBoxes().filter((x) => x.contatos.includes(k.key));
        const org = k.orgKey ? store.getOrg(k.orgKey) : null;
        return { contato: { ...modelo.contatoView(k), orgNome: org?.nome ?? null, arquivos: (k.arquivos ?? []).map(arquivoView) }, org: org ? orgLinha(org) : null, boxes: bxs.map(caixaHome), threads: threadsDe(k.emails) };
      }
      if (m === 'PATCH') {
        const patch = await body(req);
        const k = await store.mutate(por, (tx) => {
          const cur = tx.getContato(b); if (!cur) throw new modelo.ErroCrm('nao_encontrado', 'contato não existe');
          if (modelo.isKey(patch.orgKey) && !tx.getOrg(patch.orgKey)) throw new modelo.ErroCrm('nao_encontrado', 'organização não existe');
          let n = modelo.editarContato(cur, patch, tx.now);
          const auto = patch.orgKey === undefined ? modelo.orgAutomatica(n, tx.listOrgs()) : null; if (auto) n = { ...n, orgKey: auto.key, orgAuto: true };
          tx.setContato(n); tx.mudar('contato.update', { contato: n.key }); return n;
        });
        return { ok: true, contato: modelo.contatoView(k) };
      }
      if (m === 'DELETE') {
        await store.mutate(por, (tx) => {
          const cur = tx.getContato(b); if (!cur) throw new modelo.ErroCrm('nao_encontrado', 'contato não existe');
          for (const bx of tx.allBoxes()) if (bx.contatos.includes(b)) { tx.setBox({ ...bx, contatos: bx.contatos.filter((x) => x !== b), updatedAt: tx.now }); tx.mudar('box.update', { pipeline: bx.pipelineKey, box: bx.key }); }
          tx.trashContato(cur); tx.mudar('contato.delete', { contato: b });
        });
        return { ok: true };
      }
    }

    // ---- organizações ----
    if (a === 'orgs' && b === undefined) {
      if (m === 'GET') {
        const q = modelo.norm(sp.get('q') ?? ''); const lim = int(sp.get('limit'), 100, 1, 2000);
        const lista = store.listOrgs().filter((o) => q === '' || modelo.norm(o.nome).includes(q) || o.dominios.some((d) => d.includes(q)) || modelo.norm(o.setor ?? '').includes(q));
        lista.sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
        return { total: lista.length, orgs: lista.slice(0, lim).map(orgLinha) };
      }
      if (m === 'POST') {
        const input = await body(req);
        const r = await store.mutate(por, (tx) => {
          const novo = modelo.parseOrg(input, tx.now, tx.rnd);
          // Mesmo domínio = mesma empresa: devolve a existente em vez de duplicar.
          for (const d of novo.dominios) { const ja = modelo.orgDoDominio(tx.listOrgs(), d); if (ja) return { org: ja, nova: false }; }
          tx.setOrg(novo); tx.mudar('org.create', { org: novo.key });
          vincularPorDominio(tx, novo);
          return { org: novo, nova: true };
        });
        return { ok: true, nova: r.nova, org: orgLinha(r.org) };
      }
    }
    if (a === 'orgs' && b !== undefined && c === undefined) {
      if (m === 'GET') {
        const o = store.getOrg(b); if (!o) throw new modelo.ErroCrm('nao_encontrado', 'organização não existe');
        const cs = store.listContatos().filter((k) => k.orgKey === o.key); const ks = new Set(cs.map((k) => k.key));
        const bxs = store.allBoxes().filter((x) => (x.orgs ?? []).includes(o.key) || x.contatos.some((k) => ks.has(k)));
        return { org: orgLinha(o), contatos: cs.map((k) => contatoLinha(k, bxs)), boxes: bxs.map(caixaHome), threads: threadsDe(cs.flatMap((k) => k.emails)) };
      }
      if (m === 'PATCH') {
        const patch = await body(req);
        const o = await store.mutate(por, (tx) => {
          const cur = tx.getOrg(b); if (!cur) throw new modelo.ErroCrm('nao_encontrado', 'organização não existe');
          const n = modelo.parseOrg(patch, tx.now, tx.rnd, cur);
          for (const d of n.dominios) { const ja = modelo.orgDoDominio(tx.listOrgs(), d); if (ja && ja.key !== n.key) throw new modelo.ErroCrm('conflito', `o domínio ${d} já é da organização "${ja.nome}"`); }
          tx.setOrg(n); tx.mudar('org.update', { org: n.key }); vincularPorDominio(tx, n); return n;
        });
        return { ok: true, org: orgLinha(o) };
      }
      if (m === 'DELETE') {
        await store.mutate(por, (tx) => {
          const cur = tx.getOrg(b); if (!cur) throw new modelo.ErroCrm('nao_encontrado', 'organização não existe');
          for (const k of tx.listContatos()) if (k.orgKey === b) { tx.setContato({ ...k, orgKey: null, orgAuto: false, updatedAt: tx.now }); tx.mudar('contato.update', { contato: k.key }); }
          for (const bx of tx.allBoxes()) if ((bx.orgs ?? []).includes(b)) { tx.setBox({ ...bx, orgs: bx.orgs.filter((x) => x !== b), updatedAt: tx.now }); tx.mudar('box.update', { pipeline: bx.pipelineKey, box: bx.key }); }
          tx.trashOrg(cur); tx.mudar('org.delete', { org: b });
        });
        return { ok: true };
      }
    }

    // ---- busca ----
    if (a === 'search' && b === undefined && m === 'GET') {
      const pk = sp.get('pipeline') || pipelinePadrao().key;
      // pipeline=* : em todos (o job do WhatsApp acha a caixa da pessoa em qualquer pipeline, para não duplicar).
      const boxes = sp.get('pipeline') === '*' ? store.allBoxes() : typeof pk === 'string' && pk !== '' ? store.listBoxes(pipelineOr404(pk).key) : store.allBoxes();
      const q = {}; for (const k of ['phone', 'name', 'query', 'q', 'email', 'thread']) if (sp.has(k)) q[k] = sp.get(k);
      const r = modelo.buscar({ boxes, contatos: store.listContatos(), legacyPhones: cfg().telefones }, q, int(sp.get('limit'), 10, 1, 100));
      const views = r.boxes.map(view);
      if (views.length === 1) views[0].comentarios = modelo.commentsView(r.boxes[0], 5);
      return { boxes: views, total: r.total };
    }

    // ---- feed ----
    if (a === 'changes' && b === undefined && m === 'GET') {
      const since = int(sp.get('since'), 0, 0, Number.MAX_SAFE_INTEGER); const limit = int(sp.get('limit'), 200, 1, 1000); const wait = int(sp.get('wait'), 0, 0, 25);
      let r = store.changes(since, limit);
      if (r.mudancas.length === 0 && !r.reset && wait > 0) {
        await new Promise((resolve) => { let off = () => {}; const t = setTimeout(() => { off(); resolve(); }, wait * 1000); off = store.onChange(() => { clearTimeout(t); off(); resolve(); }); req.on('close', () => { clearTimeout(t); off(); resolve(); }); });
        r = store.changes(since, limit);
      }
      return r;
    }

    // ---- importação / exportação ----
    if (a === 'import' && b === undefined && m === 'POST') return importar(await body(req, 48 * 1024 * 1024), por);
    if (a === 'export' && b === undefined && m === 'GET') return { versao: 1, seq: store.meta().seq, pipelines: store.listPipelines(), boxes: store.allBoxes(), contatos: store.listContatos() };
    if (a === 'reindex' && b === undefined && m === 'POST') { store.reload(); return { ok: true, seq: store.meta().seq }; }
    throw new modelo.ErroCrm('nao_encontrado', `rota desconhecida: ${m} ${url.pathname}`);
  }

  /**
   * Importação idempotente (importar-streak.mjs): `{ pipeline: {key, name, stages, fields, origem}, boxes: [{key, …,
   * comentarios, threads, contatoKeys}], contatos: [...] }`. Chaves vindas do Streak são preservadas; o que já
   * existe é atualizado quando `forcar` ou quando o `updatedAt` de origem é mais novo. Devolve o relatório.
   */
  async function importar(bundle, por) {
    const rel = { pipeline: null, etapas: 0, campos: 0, boxes: { novos: 0, atualizados: 0, iguais: 0 }, comentarios: 0, threads: { vinculadas: 0, conflitos: [] }, contatos: { novos: 0, atualizados: 0 }, avisos: Array.isArray(bundle.avisos) ? bundle.avisos.slice(0, 50) : [] };
    await store.mutate(por, (tx) => {
      const pin = bundle.pipeline; if (!pin || typeof pin !== 'object') throw new modelo.ErroCrm('invalido', 'falta pipeline');
      let pl = modelo.isKey(pin.key) ? tx.getPipeline(pin.key) : null;
      if (pl === null) { pl = modelo.novoPipeline(pin, tx.now, tx.rnd); tx.setPipeline(pl); tx.mudar('pipeline.create', { pipeline: pl.key }); }
      else {
        // Definição: etapas e campos novos entram; os locais extras ficam (sem moverPara: nada some).
        const stages = [...pl.stages]; for (const s of Array.isArray(pin.stages) ? pin.stages : []) if (!stages.some((x) => x.key === s?.key)) stages.push({ key: modelo.isKey(s?.key) ? s.key : modelo.novaChave('s', tx.rnd), name: String(s?.name ?? s) });
        const fields = [...pl.fields]; for (const f of Array.isArray(pin.fields) ? pin.fields : []) if (!fields.some((x) => x.key === f?.key)) fields.push(f);
        const r = modelo.patchPipeline(pl, { name: pin.name ?? pl.name, stages, fields }, tx.listBoxes(pl.key), tx.now, tx.rnd);
        pl = r.pipeline; tx.setPipeline(pl); tx.mudar('pipeline.update', { pipeline: pl.key });
      }
      rel.pipeline = { key: pl.key, name: pl.name }; rel.etapas = pl.stages.length; rel.campos = pl.fields.length;
      for (const cin of Array.isArray(bundle.contatos) ? bundle.contatos : []) {
        const prev = (modelo.isKey(cin?.key) ? tx.getContato(cin.key) : null) ?? null;
        const { contato, novo } = prev ? { contato: modelo.parseContato(cin, tx.now, tx.rnd, prev), novo: false } : modelo.upsertContato(tx.listContatos(), cin, tx.now, tx.rnd);
        tx.setContato(contato); tx.mudar(novo ? 'contato.create' : 'contato.update', { contato: contato.key });
        if (novo) rel.contatos.novos++; else rel.contatos.atualizados++;
      }
      for (const bin of Array.isArray(bundle.boxes) ? bundle.boxes : []) {
        const cur = modelo.isKey(bin?.key) ? tx.getBox(bin.key) : null;
        let bx;
        if (cur === null) { bx = modelo.novoBox(pl, bin, tx.now, tx.rnd); rel.boxes.novos++; tx.mudar('box.create', { pipeline: pl.key, box: bx.key }); }
        else if (bundle.forcar === true || (Number(bin.updatedAt) || 0) > (cur.origem?.updatedAt ?? 0)) { bx = modelo.patchBox(pl, cur, { name: bin.name, notes: bin.notes, stageKey: bin.stageKey, fields: bin.fields }, tx.now); rel.boxes.atualizados++; tx.mudar('box.update', { pipeline: pl.key, box: bx.key }); }
        else { bx = cur; rel.boxes.iguais++; }
        if (bin.origem && typeof bin.origem === 'object') bx = { ...bx, origem: { ...bin.origem, updatedAt: Number(bin.updatedAt) || bx.origem?.updatedAt || 0 } };
        for (const ck of Array.isArray(bin.contatoKeys) ? bin.contatoKeys : []) if (modelo.isKey(ck) && tx.getContato(ck) && !bx.contatos.includes(ck)) bx = { ...bx, contatos: [...bx.contatos, ck] };
        for (const cm of Array.isArray(bin.comentarios) ? bin.comentarios : []) {
          if (bx.comentarios.some((x) => x.key === cm?.key)) continue;
          const texto = String(cm?.texto ?? '').trim().slice(0, modelo.LIMITES.comentario); if (texto === '') continue;
          bx = { ...bx, comentarios: [...bx.comentarios, { key: modelo.isKey(cm?.key) ? cm.key : modelo.novaChave('c', tx.rnd), at: Number(cm?.at) || tx.now, autor: String(cm?.autor ?? 'importado').slice(0, 40), texto }] }; rel.comentarios++;
        }
        bx.comentarios.sort((x, y) => x.at - y.at);
        for (const t of Array.isArray(bin.threads) ? bin.threads : []) {
          let gid; try { gid = modelo.validarThreadId(t?.threadGmailId ?? t?.gid); } catch { continue; }
          const dono = tx.allBoxes().find((x) => x.key !== bx.key && x.threads.some((y) => y.gid === gid));
          if (dono) { rel.threads.conflitos.push({ gid, box: dono.key }); continue; }
          if (!bx.threads.some((y) => y.gid === gid)) { bx = modelo.addThread(bx, { ...t, threadGmailId: gid }, Number(t?.em) || tx.now); rel.threads.vinculadas++; }
        }
        tx.setBox(bx);
      }
      tx.mudar('import', { pipeline: pl.key });
    });
    return { ok: true, ...rel };
  }

  /** Cria o pipeline do programa de indicação uma vez por máquina (só com o CRM liberado; deps.semearIndicacao). */
  let semeando = null;
  function semearIndicacao() {
    if (deps.semearIndicacao !== true || semeando !== null) return semeando ?? Promise.resolve();
    const c = cfg();
    if (c.indicacaoSemeada === true) { semeando = Promise.resolve(); return semeando; }
    const marcar = () => { try { deps.writeJson(deps.configFile, { ...cfg(), indicacaoSemeada: true }); } catch (e) { log(`crm: não marquei o programa de indicação: ${e.message}`); } };
    if (store.listPipelines().some(ehIndicacao)) { marcar(); semeando = Promise.resolve(); return semeando; }
    semeando = store.mutate('sistema', (tx) => { const pl = modelo.novoPipeline(PROGRAMA_INDICACAO, tx.now, tx.rnd); tx.setPipeline(pl); tx.mudar('pipeline.create', { pipeline: pl.key }); })
      .then(() => { marcar(); log('crm: pipeline "Programa de Indicação" criado (padrão de todo cliente)'); })
      .catch((e) => { semeando = null; log(`crm: não criei o programa de indicação: ${e.message}`); });
    return semeando;
  }

  /** Trata uma requisição /v1/crm/*; sempre responde. */
  async function handle(req, res, url, papel = 'app') {
    // O Autenticador (códigos 2FA) vem com todo meu-bot e não é CRM: passa sem a licença do CRM (a API key já foi conferida).
    const livre = /^\/v1\/crm\/autenticador(\/|$)/.test(url.pathname);
    if (!livre && !deps.licenseOk()) return erroHttp(res, json, 403, 'o CRM próprio precisa do plano Pro (ou superior) ou do produto meu-bot-crm nesta máquina, ou a licença venceu', 'crm_license', 'forbidden');
    if (!livre) await semearIndicacao();
    // Identidade carimbada pelo servidor (server.js, pela chave usada). X-Crm-Por não eleva mais ninguém: vira só
    // sub-rótulo do app (ex.: "google"), para o feed continuar dizendo de onde a mudança veio.
    const porHdr = String(req.headers['x-crm-por'] || '').toLowerCase();
    const por = papel === 'app' && POR_RE.test(porHdr) && porHdr !== 'agente' ? porHdr : papel;
    // Apagar é do dono. Pedido do agente vira registro (e comentário no box, quando há box) para o dono confirmar no app.
    if (papel === 'agente' && req.method === 'DELETE') {
      const alvo = url.pathname.replace(/^\/v1\/crm\//, '');
      const mb = /^\/v1\/crm\/boxes\/([^/]+)/.exec(url.pathname);
      await store.mutate(papel, (tx) => {
        const bx = mb ? tx.allBoxes().find((x) => x.key === mb[1]) : undefined;
        if (bx) { const { box } = modelo.addComment(bx, `🗑 O agente pediu para apagar: ${alvo}. Confirme no app se for para valer.`, 'agente', tx.now, tx.rnd); tx.setBox(box); tx.mudar('box.comment', { pipeline: box.pipelineKey, box: box.key }); }
        tx.mudar('exclusao.pedida', { alvo });
      });
      log(`crm DELETE ${url.pathname} → 403 (agente; pedido registrado)`);
      return erroHttp(res, json, 403, 'apagar é do dono: o pedido ficou registrado, confirme no app', 'exclusao_requer_dono');
    }
    const t0 = Date.now();
    try {
      const out = await rota(req, res, url, por);
      log(`crm ${req.method} ${url.pathname} → 200 (${Date.now() - t0} ms, ${por})`);
      return json(res, 200, out);
    } catch (e) {
      if (e instanceof modelo.ErroCrm && e.code === 'autonomia_requer_dono') {
        log(`crm ${req.method} ${url.pathname} → 403 (agente; pedido registrado)`);
        return erroHttp(res, json, 403, e.message, e.code);
      }
      if (e instanceof modelo.ErroCrm) {
        const status = e.code === 'nao_encontrado' ? 404 : e.code === 'conflito' ? 409 : 400;
        log(`crm ${req.method} ${url.pathname} → ${status}: ${e.message}`);
        return json(res, status, { error: { message: e.message, type: status === 404 ? 'not_found' : status === 409 ? 'conflict' : 'invalid_request_error', code: e.code, ...(e.box ? { box: e.box } : {}) } });
      }
      log(`crm ${req.method} ${url.pathname} → 500: ${e && e.stack ? e.stack : e}`);
      return json(res, 500, { error: { message: e instanceof Error ? e.message : String(e), type: 'server_error' } });
    }
  }

  return { handle, store, importar };
}

module.exports = { createCrmApi };
