import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import http from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { createCrmApi } = createRequire(import.meta.url)("../../backend-colima/crm-api.js");

// Harness: o que o server.js dá ao crm-api (json/readBody/readJson/writeJson/log), com licença controlável.
const dir = mkdtempSync(join(tmpdir(), "crm-api-"));
const cfgFile = join(dir, "crm.json");
let licenca = true;
const readJson = (f, fb) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return fb; } };
const writeJson = (f, v) => { mkdirSync(dir, { recursive: true }); writeFileSync(f, JSON.stringify(v)); };
const json = (res, status, body) => { const data = JSON.stringify(body); res.writeHead(status, { "Content-Type": "application/json" }); res.end(data); };
const readBody = (req, limit = 1e6) => new Promise((resolve, reject) => { const c = []; let n = 0; req.on("data", (d) => { n += d.length; if (n > limit) { reject(new Error("grande")); req.destroy(); } c.push(d); }); req.on("end", () => resolve(Buffer.concat(c).toString("utf8"))); req.on("error", reject); });
let iaFake = async () => "";
const api = createCrmApi({ dir: join(dir, "db"), configFile: cfgFile, licenseOk: () => licenca, readJson, writeJson, json, readBody, log: () => {}, iaTexto: (p, c) => iaFake(p, c) });
const server = http.createServer((req, res) => { const url = new URL(req.url, "http://x"); if (url.pathname.startsWith("/v1/crm")) api.handle(req, res, url); else json(res, 404, {}); });
let base = "";
before(async () => { await new Promise((r) => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });
async function call(method, path, body, headers = {}) {
  const r = await fetch(`${base}/v1/crm${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, j: await r.json() };
}

let P, S, F, B1, B2;
test("sem o plano Pro: 403 crm_license em qualquer rota", async () => {
  licenca = false;
  const r = await call("GET", "/status"); assert.equal(r.status, 403); assert.equal(r.j.error.code, "crm_license");
  licenca = true;
});

test("pipeline: criar, ler, listar; patch com moverPara; campos por nome", async () => {
  const r = await call("POST", "/pipelines", { name: "Parceiros", stages: ["Prospecção", "Qualificação", "Acordo"], fields: [{ name: "Origem", type: "DROPDOWN", options: ["Redes sociais", "Indicação"] }, { name: "Valor", type: "NUMBER" }] }, { "x-crm-por": "app" });
  assert.equal(r.status, 200); P = r.j.pipeline; S = P.stages; F = P.fields;
  assert.deepEqual(S.map((s) => s.name), ["Prospecção", "Qualificação", "Acordo"]);
  const g = await call("GET", `/pipelines/${P.key}`); assert.equal(g.j.name, "Parceiros"); assert.equal(g.j.fields[0].options.length, 2);
  const l = await call("GET", "/pipelines"); assert.equal(l.j.pipelines[0].boxes, 0);
  assert.equal((await call("GET", "/pipelines/p_naoexiste")).status, 404);
  assert.equal((await call("POST", "/pipelines", { name: "" })).status, 400);
  const st = await call("GET", "/status"); assert.equal(st.j.pipelines, 1); assert.equal(st.j.seq, 1);
});

test("boxes: criar com telefone (contato vinculado), listar por etapa/q, patch por nome de campo, comentário, 409 de thread", async () => {
  const c = await call("POST", `/pipelines/${P.key}/boxes`, { name: "Junior Rezende", stage: "qualif", notes: "primeiro contato", fields: { Origem: "indicação" }, phone: "+595 994 402 904", contactName: "Junior" }, { "x-crm-por": "agente" });
  assert.equal(c.status, 200); B1 = c.j.box; assert.equal(B1.stage, "Qualificação"); assert.equal(B1.fields.Origem, "Indicação"); assert.equal(B1.contatos[0].telefones[0], "+595994402904");
  B2 = (await call("POST", `/pipelines/${P.key}/boxes`, { name: "Kommo deal" })).j.box;
  const l = await call("GET", `/pipelines/${P.key}/boxes?stage=Qualificação`); assert.equal(l.j.total, 1); assert.equal(l.j.boxes[0].key, B1.key); assert.equal(l.j.boxes[0].contatos, 1);
  assert.equal((await call("GET", `/pipelines/${P.key}/boxes?q=kommo`)).j.total, 1);
  assert.equal((await call("GET", `/pipelines/${P.key}/boxes?stage=Nada`)).status, 400);
  const u = await call("PATCH", `/boxes/${B1.key}`, { stage: "Acordo", fields: { valor: "1.500,00" } }); assert.equal(u.j.box.stage, "Acordo"); assert.equal(u.j.box.fields.Valor, "1500");
  assert.equal((await call("PATCH", `/boxes/${B1.key}`, { fields: { Origem: "Outra" } })).status, 400);
  const cm = await call("POST", `/boxes/${B1.key}/comments`, { texto: "16/10: pediu os links" }, { "x-crm-por": "whatsapp" }); assert.equal(cm.status, 200); assert.match(cm.j.comentario, /^c_/);
  const full = await call("GET", `/boxes/${B1.key}`); assert.equal(full.j.comentarios[0].autor, "whatsapp"); assert.equal(full.j.notes, "primeiro contato");
  const t = await call("PUT", `/boxes/${B1.key}/threads`, { threadGmailId: "1A1544925ACE5958", assunto: "Oi", emails: ["junior@empresa.com"] }); assert.equal(t.status, 200); assert.equal(t.j.threads[0].threadGmailId, "1a1544925ace5958");
  const dup = await call("PUT", `/boxes/${B2.key}/threads`, { threadGmailId: "1a1544925ace5958" }); assert.equal(dup.status, 409); assert.equal(dup.j.error.box.key, B1.key);
  assert.equal((await call("PUT", `/boxes/${B2.key}/threads`, { threadGmailId: "zzz" })).status, 400);
  const th = await call("GET", "/threads/1a1544925ace5958"); assert.equal(th.j.box.key, B1.key);
  assert.equal((await call("GET", "/threads/ffffffffffff")).status, 404);
  const lk = await call("POST", "/threads/lookup", { ids: ["1a1544925ace5958", "ffffffffffff"] }); assert.deepEqual(Object.keys(lk.j.boxes), ["1a1544925ace5958"]); assert.equal(lk.j.boxes["1a1544925ace5958"].stage, "Acordo");
});

test("search: mesma forma do box-find (telefone, nome, e-mail, texto); um só resultado traz comentários", async () => {
  await call("PUT", "/config", { pipelineKey: P.key, silencioMin: 15 });
  const r = await call("GET", "/search?phone=595994402904"); assert.equal(r.j.total, 1); assert.equal(r.j.boxes[0].key, B1.key); assert.equal(r.j.boxes[0].comentarios.length, 1);
  assert.equal((await call("GET", "/search?name=kommo")).j.boxes[0].key, B2.key);
  assert.equal((await call("GET", "/search?email=@empresa.com")).j.boxes[0].key, B1.key, "e-mail da thread");
  assert.equal((await call("GET", "/search?query=x")).j.total, 0);
  assert.equal((await call("GET", "/search")).status, 400);
  const cfg = await call("GET", "/config"); assert.equal(cfg.j.pipelineName, "Parceiros"); assert.equal(cfg.j.silencioMin, 15);
  assert.equal((await call("PUT", "/config", { silencioMin: 999 })).status, 400);
});

test("contatos: upsert por telefone vincula ao box; listar com filtro", async () => {
  const r = await call("POST", "/contacts", { phone: "+595994402904", email: "junior@empresa.com", box: B2.key }); assert.equal(r.j.vinculado, true);
  const b2 = await call("GET", `/boxes/${B2.key}`); assert.equal(b2.j.contatos.length, 1); assert.equal(b2.j.contatos[0].emails[0], "junior@empresa.com");
  assert.equal((await call("GET", "/contacts?phone=994402")).j.contatos.length, 1);
  assert.equal((await call("GET", "/contacts?q=ninguem")).j.contatos.length, 0);
  const k = r.j.contato; const g = await call("GET", `/contacts/${k}`); assert.equal(g.j.boxes.length, 2, "contato em dois boxes");
  assert.equal((await call("PATCH", `/contacts/${k}`, { name: "Junior Silva" })).j.contato.nome, "Junior Silva");
});

test("pipeline PATCH: remover etapa com box sem moverPara → 409; com moverPara move; campo removido some do box", async () => {
  const r = await call("PATCH", `/pipelines/${P.key}`, { stages: [S[0], S[1]] }); assert.equal(r.status, 409);
  const ok = await call("PATCH", `/pipelines/${P.key}`, { stages: [S[0], S[1]], moverPara: "Qualificação", fields: [F[0]] });
  assert.equal(ok.status, 200); assert.equal(ok.j.pipeline.stages.length, 2);
  const b1 = await call("GET", `/boxes/${B1.key}`); assert.equal(b1.j.box.stage, "Qualificação"); assert.equal(b1.j.box.fields.Valor, undefined);
  assert.equal((await call("DELETE", `/pipelines/${P.key}`)).status, 409, "pipeline com boxes não apaga");
});

test("changes: desde um seq, long-poll acorda com mudança; delete manda para a lixeira", async () => {
  const c0 = await call("GET", "/changes?since=0"); assert.equal(c0.j.mudancas[0].tipo, "pipeline.create"); assert.ok(c0.j.mudancas.some((l) => l.tipo === "box.comment" && l.por === "whatsapp"));
  const seq = c0.j.seq;
  const waiting = call("GET", `/changes?since=${seq}&wait=5`);
  await new Promise((r) => setTimeout(r, 50));
  await call("DELETE", `/boxes/${B2.key}`);
  const w = await waiting; assert.equal(w.j.mudancas.length, 1); assert.equal(w.j.mudancas[0].tipo, "box.delete");
  assert.equal((await call("GET", `/boxes/${B2.key}`)).status, 404);
  assert.equal((await call("GET", `/changes?since=${w.j.seq}`)).j.mudancas.length, 0);
});

test("import: idempotente (chaves do Streak preservadas), 2ª rodada = iguais; export devolve tudo", async () => {
  const bundle = { pipeline: { key: "agxzStreak", name: "Importado", stages: [{ key: "5001", name: "A" }, { key: "5002", name: "B" }], fields: [{ key: "1001", name: "Origem", type: "DROPDOWN", options: [{ key: "9001", name: "Site" }] }], origem: { streak: "agxzStreak" } },
    contatos: [{ key: "ct01", nome: "Maria", emails: ["maria@x.com"], telefones: ["+5511999990000"] }],
    boxes: [{ key: "bx01", name: "Maria Lima", stageKey: "5002", notes: "n", fields: { "1001": "9001" }, updatedAt: 1000, origem: { streak: "bx01" }, contatoKeys: ["ct01"], comentarios: [{ key: "cm01", at: 500, autor: "streak", texto: "oi" }], threads: [{ threadGmailId: "abcdefabcdef", assunto: "T" }] }] };
  const r1 = await call("POST", "/import", bundle, { "x-crm-por": "importador" });
  assert.equal(r1.status, 200); assert.equal(r1.j.boxes.novos, 1); assert.equal(r1.j.contatos.novos, 1); assert.equal(r1.j.comentarios, 1); assert.equal(r1.j.threads.vinculadas, 1);
  const r2 = await call("POST", "/import", bundle); assert.equal(r2.j.boxes.iguais, 1); assert.equal(r2.j.boxes.novos, 0); assert.equal(r2.j.comentarios, 0); assert.equal(r2.j.contatos.atualizados, 1);
  const bx = await call("GET", "/boxes/bx01"); assert.equal(bx.j.box.stage, "B"); assert.equal(bx.j.box.fields.Origem, "Site"); assert.equal(bx.j.contatos[0].nome, "Maria"); assert.equal(bx.j.comentarios.length, 1);
  const r3 = await call("POST", "/import", { ...bundle, boxes: [{ ...bundle.boxes[0], name: "Maria L.", updatedAt: 2000 }] }); assert.equal(r3.j.boxes.atualizados, 1);
  assert.equal((await call("GET", "/boxes/bx01")).j.box.name, "Maria L.");
  const ex = await call("GET", "/export"); assert.equal(ex.j.pipelines.length, 2); assert.ok(ex.j.boxes.some((b) => b.key === "bx01"));
  assert.equal((await call("GET", "/search?pipeline=agxzStreak&phone=5511999990000")).j.boxes[0].key, "bx01");
});

test("caixa: etapaDesde muda só quando a etapa muda; contato sai da caixa sem ser apagado", async () => {
  const p = (await call("POST", "/pipelines", { name: "Etapas", stages: ["A", "B"] })).j.pipeline;
  const b = (await call("POST", `/pipelines/${p.key}/boxes`, { name: "x", phone: "+5511911112222" })).j.box;
  assert.ok(b.etapaDesde && b.criadoEm);
  await new Promise((r) => setTimeout(r, 5));
  const n = (await call("PATCH", `/boxes/${b.key}`, { notes: "só nota" })).j.box; assert.equal(n.etapaDesde, b.etapaDesde, "sem mudar etapa");
  await new Promise((r) => setTimeout(r, 5));
  const e = (await call("PATCH", `/boxes/${b.key}`, { stage: "B" })).j.box; assert.ok(e.etapaDesde > b.etapaDesde, "mudou de etapa");
  const k = b.contatos[0].key;
  assert.equal((await call("DELETE", `/boxes/${b.key}/contacts/${k}`)).status, 200);
  assert.equal((await call("GET", `/boxes/${b.key}`)).j.contatos.length, 0); assert.equal((await call("GET", `/contacts/${k}`)).status, 200, "o contato continua existindo");
  assert.equal((await call("DELETE", `/boxes/${b.key}/contacts/${k}`)).status, 404);
});

test("config: pipeline padrão que não existe no CRM próprio (chave antiga do Streak) volta como null", async () => {
  writeJson(cfgFile, { ...readJson(cfgFile, {}), pipelineKey: "agxzChaveDoStreakQueNaoExiste", pipelineName: "Parceiros Grok" });
  const c = (await call("GET", "/config")).j;
  assert.equal(c.pipelineKey, null); assert.equal(c.pipelineName, null); assert.equal(c.pipelineKeyInvalido, "agxzChaveDoStreakQueNaoExiste");
});

test("pipeline DELETE: só sem boxes; some da lista, do disco e de uma reabertura; vai para a lixeira", async () => {
  const p = (await call("POST", "/pipelines", { name: "Descartável", stages: ["A"] })).j.pipeline;
  await call("PUT", "/config", { pipelineKey: p.key });
  const b = (await call("POST", `/pipelines/${p.key}/boxes`, { name: "x" })).j.box;
  assert.equal((await call("DELETE", `/pipelines/${p.key}`)).status, 409, "com box não apaga");
  await call("DELETE", `/boxes/${b.key}`);
  assert.equal((await call("DELETE", `/pipelines/${p.key}`)).status, 200);
  assert.ok(!(await call("GET", "/pipelines")).j.pipelines.some((x) => x.key === p.key));
  assert.equal((await call("GET", `/pipelines/${p.key}`)).status, 404);
  assert.equal((await call("GET", "/config")).j.pipelineKey, null, "o padrão que apontava para ele foi limpo");
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(join(dir, "db", "pipelines", `${p.key}.json`)), false); assert.equal(existsSync(join(dir, "db", "lixeira", "pipelines", `${p.key}.json`)), true);
  const { openStore } = createRequire(import.meta.url)("../../backend-colima/crm-store.js");
  assert.equal(openStore(join(dir, "db")).getPipeline(p.key), null, "reabrir o store não traz de volta");
});

test("boxes entre pipelines (Home): por chaves na ordem pedida; por atividade dos últimos 7 dias; lista do pipeline traz nomes dos contatos", async () => {
  const p = (await call("POST", "/pipelines", { name: "Home", stages: ["A", "B"] })).j.pipeline;
  const x = (await call("POST", `/pipelines/${p.key}/boxes`, { name: "Quieta" })).j.box;
  const y = (await call("POST", `/pipelines/${p.key}/boxes`, { name: "Agitada", phone: "+55 11 98888-7777", contactName: "Rita" })).j.box;
  for (const n of ["um", "dois", "três"]) await call("POST", `/boxes/${y.key}/comments`, { texto: n });
  const k = await call("GET", `/boxes?keys=${x.key},${y.key},naoexiste`);
  assert.deepEqual(k.j.boxes.map((b) => b.name), ["Quieta", "Agitada"]);
  assert.equal(k.j.boxes[0].pipelineName, "Home"); assert.equal(k.j.boxes[0].stage, "A"); assert.equal(k.j.boxes[0].stageIndex, 0);
  const t = (await call("GET", "/boxes?ordem=atividade&limit=100")).j.boxes; const pos = (n) => t.findIndex((b) => b.name === n);
  assert.ok(pos("Agitada") < pos("Quieta")); assert.ok(t[pos("Agitada")].atividade >= 4);
  assert.equal((await call("GET", "/boxes?ordem=atividade&limit=1")).j.boxes.length, 1);
  const l = await call("GET", `/pipelines/${p.key}/boxes`);
  assert.deepEqual(l.j.boxes.find((b) => b.key === y.key).pessoas, ["Rita"]);
});

test("organizações e contatos: domínio único, vínculo automático por e-mail (não por gmail), edição substitui, apagar desvincula", async () => {
  const p = (await call("POST", "/pipelines", { name: "Orgs", stages: ["A"] })).j.pipeline;
  const bx = (await call("POST", `/pipelines/${p.key}/boxes`, { name: "Negócio Acme", email: "ana@acme.com.br", contactName: "Ana" })).j.box;
  const o = await call("POST", "/orgs", { nome: "Acme", dominios: ["https://www.acme.com.br/contato"], setor: "Varejo" });
  assert.equal(o.status, 200); assert.equal(o.j.nova, true); assert.deepEqual(o.j.org.dominios, ["acme.com.br"]);
  assert.equal(o.j.org.contatos, 1); assert.equal(o.j.org.caixas, 1); assert.deepEqual(o.j.org.pipelines, ["Orgs"]);
  assert.equal((await call("POST", "/orgs", { nome: "ACME de novo", dominio: "@acme.com.br" })).j.nova, false);
  // contato novo com e-mail da empresa entra sozinho; gmail não
  await call("POST", "/contacts", { name: "Beto", email: "beto@acme.com.br" });
  await call("POST", "/contacts", { name: "Caio", email: "caio@gmail.com" });
  const lista = (await call("GET", `/contacts?org=${o.j.org.key}`)).j;
  assert.deepEqual(lista.contatos.map((k) => k.nome).sort(), ["Ana", "Beto"]); assert.equal(lista.contatos[0].orgNome, "Acme");
  const ana = lista.contatos.find((k) => k.nome === "Ana");
  const g = (await call("GET", `/contacts/${ana.key}`)).j; assert.equal(g.org.nome, "Acme"); assert.equal(g.boxes[0].name, "Negócio Acme");
  const ed = (await call("PATCH", `/contacts/${ana.key}`, { cargo: "Compras", emails: ["ana@outra.com"], telefones: ["11 99999-0000"], orgKey: null })).j.contato;
  assert.equal(ed.cargo, "Compras"); assert.deepEqual(ed.emails, ["ana@outra.com"]); assert.deepEqual(ed.telefones, ["+11999990000"]); assert.equal(ed.orgKey, null);
  const go = (await call("GET", `/orgs/${o.j.org.key}`)).j; assert.deepEqual(go.contatos.map((k) => k.nome), ["Beto"]);
  const o2 = (await call("POST", "/orgs", { nome: "Outra" })).j.org;
  assert.equal((await call("PATCH", `/orgs/${o2.key}`, { dominios: ["acme.com.br"] })).status, 409);
  assert.equal((await call("DELETE", `/orgs/${o.j.org.key}`)).status, 200);
  const beto = (await call("GET", "/contacts?q=beto")).j.contatos[0]; assert.equal(beto.orgKey, null);
  assert.equal((await call("DELETE", `/contacts/${beto.key}`)).status, 200);
  assert.equal((await call("GET", `/contacts/${beto.key}`)).status, 404);
  assert.equal((await call("GET", `/boxes/${bx.key}`)).status, 200);
});

test("registros: editar (texto inteiro, marca editadoEm) e apagar; organização ligada direto à caixa", async () => {
  const p = (await call("POST", "/pipelines", { name: "Reg", stages: ["A"] })).j.pipeline;
  const bx = (await call("POST", `/pipelines/${p.key}/boxes`, { name: "Cx" })).j.box;
  const longo = "x".repeat(900);
  const c = (await call("POST", `/boxes/${bx.key}/comments`, { texto: longo })).j.comentario;
  assert.equal((await call("GET", `/boxes/${bx.key}`)).j.comentarios[0].texto.length, 900);
  assert.equal((await call("PATCH", `/boxes/${bx.key}/comments/${c}`, { texto: "corrigido" })).status, 200);
  const f = (await call("GET", `/boxes/${bx.key}`)).j; assert.equal(f.comentarios[0].texto, "corrigido"); assert.ok(f.comentarios[0].editadoEm);
  assert.equal((await call("PATCH", `/boxes/${bx.key}/comments/${c}`, { texto: "  " })).status, 400);
  assert.equal((await call("DELETE", `/boxes/${bx.key}/comments/${c}`)).status, 200);
  assert.equal((await call("GET", `/boxes/${bx.key}`)).j.comentarios.length, 0);
  const o = (await call("POST", "/orgs", { nome: "Loja do Junior" })).j.org;
  await call("POST", `/boxes/${bx.key}/orgs`, { key: o.key }); await call("POST", `/boxes/${bx.key}/orgs`, { key: o.key });
  assert.deepEqual((await call("GET", `/boxes/${bx.key}`)).j.orgs.map((x) => x.nome), ["Loja do Junior"]);
  assert.equal((await call("GET", `/orgs/${o.key}`)).j.boxes[0].name, "Cx");
  await call("DELETE", `/boxes/${bx.key}/orgs/${o.key}`);
  assert.deepEqual((await call("GET", `/boxes/${bx.key}`)).j.orgs, []);
});

test("importar contatos (Google Contatos): cria, completa sem apagar, empresa vira organização, ignora vazios", async () => {
  await call("POST", "/contacts", { name: "Zé Existente", email: "ze@firma.com.br" });
  const r = await call("POST", "/contacts/import", { contatos: [
    { nome: "Zé da Firma", emails: ["ze@firma.com.br"], telefones: ["+55 11 97777-6666"], cargo: "Gerente", empresa: "Firma SA", notas: "" },
    { nome: "Nova Pessoa", emails: [], telefones: ["11 95555-4444"], cargo: "", empresa: "Firma SA", notas: "conheci na feira" },
    { nome: "", emails: [], telefones: [], cargo: "", empresa: "", notas: "" },
  ] });
  assert.equal(r.status, 200); assert.deepEqual([r.j.criados, r.j.atualizados, r.j.ignorados, r.j.orgsCriadas], [1, 1, 1, 1]);
  const ze = (await call("GET", "/contacts?q=ze@firma")).j.contatos[0];
  assert.equal(ze.nome, "Zé Existente"); assert.equal(ze.cargo, "Gerente"); assert.equal(ze.orgNome, "Firma SA"); assert.deepEqual(ze.telefones, ["+5511977776666"]);
  assert.equal((await call("GET", `/contacts?org=${ze.orgKey}`)).j.total, 2);
  assert.equal((await call("POST", "/contacts/import", { contatos: [] })).status, 400);
});

test("vincular contato existente à caixa só pela chave (contato só com telefone)", async () => {
  const p = (await call("POST", "/pipelines", { name: "Vinc", stages: ["A"] })).j.pipeline;
  const bx = (await call("POST", `/pipelines/${p.key}/boxes`, { name: "Cx" })).j.box;
  const k = (await call("POST", "/contacts", { name: "Manager Martins", phone: "+55 11 98869-8139" })).j.contato;
  const r = await call("POST", "/contacts", { key: k, box: bx.key }); assert.equal(r.j.vinculado, true); assert.equal(r.j.contato, k);
  const f = (await call("GET", `/boxes/${bx.key}`)).j; assert.deepEqual(f.contatos.map((c) => c.nome), ["Manager Martins"]);
  assert.equal((await call("GET", "/contacts?phone=98869")).j.contatos[0].key, k);
});

test("whatsapp: resumo da conversa vai para o contato do telefone (e aparece na caixa); sem contato e sem caixa → 404", async () => {
  const p = (await call("POST", "/pipelines", { name: "Zap", stages: ["A"] })).j.pipeline;
  const bx = (await call("POST", `/pipelines/${p.key}/boxes`, { name: "Cx Zap", phone: "+55 11 91234-5678", contactName: "Zeca" })).j.box;
  const r = await call("PUT", "/contacts/whatsapp", { phone: "+5511912345678", resumo: "Quer CRM para clientes; aguarda proposta.", mensagens: 28, ultimaEm: 1792433746876 });
  assert.equal(r.status, 200);
  const c = (await call("GET", `/contacts/${r.j.contato}`)).j.contato;
  assert.equal(c.whatsapp.resumo, "Quer CRM para clientes; aguarda proposta."); assert.equal(c.whatsapp.mensagens, 28);
  assert.equal((await call("GET", `/boxes/${bx.key}`)).j.contatos[0].whatsapp.mensagens, 28);
  await call("PATCH", `/contacts/${r.j.contato}`, { cargo: "Gestor" });
  assert.equal((await call("GET", `/contacts/${r.j.contato}`)).j.contato.whatsapp.mensagens, 28);
  assert.equal((await call("PUT", "/contacts/whatsapp", { phone: "+5511900001111", resumo: "x" })).status, 404);
  const novo = await call("PUT", "/contacts/whatsapp", { phone: "+5511900001111", resumo: "novo", box: bx.key });
  assert.equal(novo.status, 200); assert.equal((await call("GET", `/boxes/${bx.key}`)).j.contatos.length, 2);
});

test("anexos: enviar, listar na ficha, baixar igual, apagar (vai para a lixeira); vazio e grande demais → 400", async () => {
  const p = (await call("POST", "/pipelines", { name: "Anexos", stages: ["A"] })).j.pipeline;
  const bx = (await call("POST", `/pipelines/${p.key}/boxes`, { name: "Cx" })).j.box;
  const conteudo = Buffer.from("proposta comercial\n");
  const up = await call("POST", `/boxes/${bx.key}/files`, { nome: "../proposta.pdf", tipo: "application/pdf", base64: conteudo.toString("base64") });
  assert.equal(up.status, 200); assert.equal(up.j.arquivo.nome, ".._proposta.pdf"); assert.equal(up.j.arquivo.tamanho, conteudo.length);
  const f = (await call("GET", `/boxes/${bx.key}`)).j; assert.equal(f.arquivos.length, 1);
  const baixa = (await call("GET", `/boxes/${bx.key}/files/${up.j.arquivo.key}`)).j;
  assert.equal(Buffer.from(baixa.base64, "base64").toString(), "proposta comercial\n"); assert.equal(baixa.tipo, "application/pdf");
  assert.equal((await call("DELETE", `/boxes/${bx.key}/files/${up.j.arquivo.key}`)).status, 200);
  assert.equal((await call("GET", `/boxes/${bx.key}/files`)).j.arquivos.length, 0);
  assert.equal((await call("GET", `/boxes/${bx.key}/files/${up.j.arquivo.key}`)).status, 404);
  assert.equal((await call("POST", `/boxes/${bx.key}/files`, { nome: "x", base64: "" })).status, 400);
});

test("responsáveis da caixa: criar com um, adicionar outro e-mail, tirar; inválidos e repetidos ignorados", async () => {
  const p = (await call("POST", "/pipelines", { name: "Resp", stages: ["A"] })).j.pipeline;
  const bx = (await call("POST", `/pipelines/${p.key}/boxes`, { name: "Cx", responsaveis: [{ email: "Box@AgentesGrok.com", nome: "Agentes G" }] })).j.box;
  assert.deepEqual(bx.responsaveis, [{ email: "box@agentesgrok.com", nome: "Agentes G" }]);
  const r = await call("PATCH", `/boxes/${bx.key}`, { responsaveis: [...bx.responsaveis, "diegofornalha@gmail.com", "lixo", "BOX@agentesgrok.com"] });
  assert.deepEqual(r.j.box.responsaveis.map((x) => x.email), ["box@agentesgrok.com", "diegofornalha@gmail.com"]);
  assert.deepEqual((await call("GET", `/pipelines/${p.key}/boxes`)).j.boxes[0].responsaveis.length, 2);
  const t = await call("PATCH", `/boxes/${bx.key}`, { responsaveis: [] }); assert.deepEqual(t.j.box.responsaveis, []);
});

test("resumo com IA: o prompt leva a caixa (registros, WhatsApp), a resposta fica guardada; formato ruim → 400", async () => {
  const p = (await call("POST", "/pipelines", { name: "IA", stages: ["Prospecção", "Onboarding"] })).j.pipeline;
  const bx = (await call("POST", `/pipelines/${p.key}/boxes`, { name: "Junior", notes: "Site: lvlingerie.com.br", phone: "+595 994 402904", contactName: "Junior Rezende" })).j.box;
  await call("POST", `/boxes/${bx.key}/comments`, { texto: "quer integrar agente ao WhatsApp via Kommo" });
  await call("PUT", "/contacts/whatsapp", { phone: "+595994402904", resumo: "Vai contratar o Kommo depois do fim de semana." });
  let visto = ""; let conv = "";
  iaFake = async (prompt, c) => { visto = prompt; conv = c; return 'Aqui está:\n```json\n{"visaoGeral":"Junior quer IA no WhatsApp.","proximoPasso":"Pedir o token do Kommo.","historico":"Pediu os planos."}\n```'; };
  const r = await call("POST", `/boxes/${bx.key}/resumo`);
  assert.equal(r.status, 200); assert.equal(r.j.resumoIA.proximoPasso, "Pedir o token do Kommo.");
  assert.match(visto, /Kommo depois do fim de semana/); assert.match(visto, /integrar agente/); assert.match(visto, /lvlingerie/); assert.match(conv, /^crm-resumo-/);
  assert.equal((await call("GET", `/boxes/${bx.key}`)).j.resumoIA.visaoGeral, "Junior quer IA no WhatsApp.");
  await call("PATCH", `/boxes/${bx.key}`, { name: "Junior R." });
  assert.ok((await call("GET", `/boxes/${bx.key}`)).j.resumoIA);
  iaFake = async () => "não sei";
  assert.equal((await call("POST", `/boxes/${bx.key}/resumo`)).status, 400);
  iaFake = async () => { throw new Error("sem provedor"); };
  const e = await call("POST", `/boxes/${bx.key}/resumo`); assert.equal(e.status, 400); assert.match(e.j.error.message, /sem provedor/);
});

test("contexto para o WhatsApp: só caixa/etapa/próximo passo/visão geral; nada de notas, registros, histórico; desligável", async () => {
  const p = (await call("POST", "/pipelines", { name: "Ctx", stages: ["Prospecção", "Onboarding"] })).j.pipeline;
  const bx = (await call("POST", `/pipelines/${p.key}/boxes`, { name: "Martins", notes: "cobrado a preço de custo", phone: "+55 11 97777-1212", contactName: "Manager Martins" })).j.box;
  await call("POST", `/boxes/${bx.key}/comments`, { texto: "registro interno sigiloso" });
  iaFake = async () => '{"visaoGeral":"Quer CRM para clientes.","proximoPasso":"Perguntar volume de leads.","historico":"segredo do histórico"}';
  await call("POST", `/boxes/${bx.key}/resumo`);
  const r = (await call("GET", "/contexto?phone=%2B5511977771212")).j.texto;
  assert.match(r, /Contexto interno do CRM/); assert.match(r, /"Martins" · Ctx · etapa Prospecção/); assert.match(r, /Manager Martins/);
  assert.match(r, /Próximo passo: Perguntar volume de leads\./); assert.match(r, /Visão geral: Quer CRM para clientes\./);
  assert.doesNotMatch(r, /preço de custo|sigiloso|segredo/);
  assert.equal((await call("GET", "/contexto?phone=%2B5511900009999")).j.texto, null);
  assert.equal((await call("GET", "/contexto?phone=abc")).status, 400);
  await call("PUT", "/config", { contextoWhatsapp: false });
  assert.equal((await call("GET", "/contexto?phone=%2B5511977771212")).j.texto, null);
  assert.equal((await call("GET", "/config")).j.contextoWhatsapp, false);
  await call("PUT", "/config", { contextoWhatsapp: true });
});

test("importar do Google: vínculo pelo id do Google (link na ficha), Instagram, e reimportar igual não regrava", async () => {
  const lote = [{ nome: "Junior Google", emails: [], telefones: ["+595 994 400000"], cargo: "", empresa: "", notas: "", instagram: "juniorrezende.br.py", googleId: "people/c31759494540309252" }];
  const r1 = (await call("POST", "/contacts/import", { contatos: lote })).j; assert.equal(r1.criados, 1);
  const k = (await call("GET", "/contacts?q=junior google")).j.contatos[0];
  assert.deepEqual(k.google, { id: "people/c31759494540309252", url: "https://contacts.google.com/person/c31759494540309252" }); assert.equal(k.instagram, "juniorrezende.br.py");
  const r2 = (await call("POST", "/contacts/import", { contatos: lote })).j; assert.deepEqual([r2.criados, r2.atualizados, r2.iguais], [0, 0, 1]);
  // telefone trocado no Google: acha pelo id do Google e completa (não cria outra ficha)
  const r3 = (await call("POST", "/contacts/import", { contatos: [{ ...lote[0], telefones: ["+595 991 111111"] }] })).j; assert.deepEqual([r3.criados, r3.atualizados], [0, 1]);
  assert.deepEqual((await call("GET", `/contacts/${k.key}`)).j.contato.telefones, ["+595994400000", "+595991111111"]);
});

test("pipeline padrão: chave quebrada (ex.: do Streak) com um pipeline só se corrige sozinha no crm.json; com vários fica null", async () => {
  const d2 = mkdtempSync(join(tmpdir(), "crm-padrao-")); const cfg2 = join(d2, "crm.json");
  writeFileSync(cfg2, JSON.stringify({ pipelineKey: "agxzfm1haWxmb29nYWVy-antiga-do-streak", apiKey: "fica" }));
  const api2 = createCrmApi({ dir: join(d2, "db"), configFile: cfg2, licenseOk: () => true, readJson, writeJson: (f, v) => writeFileSync(f, JSON.stringify(v)), json, readBody, log: () => {} });
  const srv2 = http.createServer((req, res) => api2.handle(req, res, new URL(req.url, "http://x")));
  await new Promise((r) => srv2.listen(0, "127.0.0.1", r)); const b2 = `http://127.0.0.1:${srv2.address().port}/v1/crm`;
  const j = async (m, p, body) => (await fetch(`${b2}${p}`, { method: m, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json();
  try {
    assert.equal((await j("GET", "/config")).pipelineKey, null); // nenhum pipeline ainda
    const p1 = (await j("POST", "/pipelines", { name: "Parceiros Grok", stages: ["Prospecção"] })).pipeline;
    const c = await j("GET", "/config");
    assert.equal(c.pipelineKey, p1.key); assert.equal(c.pipelineName, "Parceiros Grok"); assert.equal(c.pipelineKeyInvalido, undefined);
    const gravado = JSON.parse(readFileSync(cfg2, "utf8")); assert.equal(gravado.pipelineKey, p1.key); assert.equal(gravado.apiKey, "fica");
    await j("PATCH", `/pipelines/${p1.key}`, { name: "Parceiros" }); assert.equal((await j("GET", "/config")).pipelineName, "Parceiros");
    writeFileSync(cfg2, JSON.stringify({ pipelineKey: "quebrada-xyz" })); await j("POST", "/pipelines", { name: "Outro", stages: ["A"] });
    const c2 = await j("GET", "/config"); assert.equal(c2.pipelineKey, null); assert.equal(c2.pipelineKeyInvalido, "quebrada-xyz");
  } finally { srv2.close(); rmSync(d2, { recursive: true, force: true }); }
});

test("autenticador pela API: cria por otpauth, códigos sem o segredo; agente só vê as liberadas", async () => {
  const ext = { "x-crm-por": "extensao" };
  const uri = "otpauth://totp/Banco:lucas?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Banco";
  const r = await call("POST", "/autenticador", { uri }, ext); assert.equal(r.status, 200);
  const k = r.j.conta.key;
  const c = await call("GET", "/autenticador/codigos", undefined, ext);
  assert.equal(c.j.contas.length, 1); assert.match(c.j.contas[0].codigo, /^\d{6}$/); assert.equal(JSON.stringify(c.j).includes("GEZDGNBV"), false);
  assert.equal((await call("GET", "/autenticador/codigos", undefined, { "x-crm-por": "agente" })).j.contas.length, 0);
  assert.equal((await call("GET", `/autenticador/${k}/codigo`, undefined, { "x-crm-por": "agente" })).status, 404);
  assert.equal((await call("PATCH", `/autenticador/${k}`, { agente: true }, ext)).status, 200);
  assert.match((await call("GET", `/autenticador/${k}/codigo`, undefined, { "x-crm-por": "agente" })).j.codigo, /^\d{6}$/);
  assert.equal((await call("POST", "/autenticador", { uri: "otpauth://hotp/x?secret=GEZDGNBVGY3TQOJQ" }, ext)).status, 400);
  assert.equal((await call("DELETE", `/autenticador/${k}`, undefined, ext)).status, 200);
});

test("whatsapp/arquivar: transcrição vira anexo + registro na caixa, ou fica no contato sem caixa; resumo consolidado; sem duplicar", async () => {
  const pl = (await call("POST", "/pipelines", { name: "Arquivo", stages: ["Novo"] })).j.pipeline;
  const bx = (await call("POST", `/pipelines/${pl.key}/boxes`, { name: "Locadora X", phone: "+595981000111" })).j.box;
  await call("PUT", "/contacts/whatsapp", { phone: "+595981000111", resumo: "Pediu tabela de preços.", mensagens: 4 });
  let prompt = "";
  iaFake = async (p) => { prompt = p; return "Locadora em Assunção; mandou a tabela (US$ 40/dia). Próximo passo: reservar."; };
  const md = "# Conversa\n\n**Locadora X** 10:00 — oi\n**você** 10:01 — tabela?\n";
  const r = await call("POST", "/whatsapp/arquivar", { phone: "+595 981 000 111", nome: "Locadora X", transcricao: md, mensagens: 2, primeiraEm: 1792433746876, ultimaEm: 1792437346876 }, { "x-crm-por": "app" });
  assert.equal(r.status, 200); assert.equal(r.j.resumo, true); assert.equal(r.j.box.key, bx.key); assert.equal(r.j.repetido, false);
  assert.match(prompt, /Pediu tabela de preços\./); assert.match(prompt, /tabela\?/);
  const full = (await call("GET", `/boxes/${bx.key}`)).j;
  assert.equal(full.arquivos.length, 1); assert.match(full.arquivos[0].nome, /^conversa-whatsapp-\d{4}-\d{2}-\d{2}-\d{4}\.md$/, "nome com data e hora (SP): dois arquivamentos no mesmo dia nao se confundem"); assert.equal(full.arquivos[0].mensagens, 2);
  assert.match(full.comentarios[0].texto, /arquivada antes de limpar: 2 mensagens/);
  assert.equal(Buffer.from((await call("GET", `/boxes/${bx.key}/files/${full.arquivos[0].key}`)).j.base64, "base64").toString("utf8"), md);
  const w = full.contatos[0].whatsapp;
  assert.equal(w.resumo, ""); assert.equal(w.mensagens, 0); assert.match(w.arquivo.resumo, /US\$ 40/); assert.equal(w.arquivo.mensagens, 2);
  // Tentar de novo (a limpeza falhou depois): não duplica nem chama o motor outra vez.
  prompt = "";
  const de2 = await call("POST", "/whatsapp/arquivar", { phone: "+595981000111", transcricao: md, mensagens: 2 });
  assert.equal(de2.j.repetido, true); assert.equal(de2.j.resumo, true); assert.equal(prompt, "");
  assert.equal((await call("GET", `/boxes/${bx.key}`)).j.arquivos.length, 1);
  // O crm-job grava a conversa nova: o consolidado continua.
  await call("PUT", "/contacts/whatsapp", { phone: "+595981000111", resumo: "Voltou a falar.", mensagens: 1 });
  assert.match((await call("GET", `/boxes/${bx.key}`)).j.contatos[0].whatsapp.arquivo.resumo, /US\$ 40/);

  // Número desconhecido: o contato nasce com o nome do WhatsApp e guarda a conversa nele; motor fora → resumo false.
  iaFake = async () => { throw new Error("motor ocupado"); };
  const s = await call("POST", "/whatsapp/arquivar", { phone: "+5511955554444", nome: "Maria", transcricao: "oi", mensagens: 1 });
  assert.equal(s.status, 200); assert.equal(s.j.box, null); assert.equal(s.j.resumo, false); assert.match(s.j.aviso, /motor ocupado/);
  const k = (await call("GET", `/contacts/${s.j.contato}`)).j.contato;
  assert.equal(k.nome, "Maria"); assert.equal(k.arquivos.length, 1);
  assert.equal(Buffer.from((await call("GET", `/contacts/${k.key}/files/${k.arquivos[0].key}`)).j.base64, "base64").toString("utf8"), "oi");
  // Persistência: outra instância lendo o mesmo db mantém anexos do contato e o consolidado.
  const api2 = createCrmApi({ dir: join(dir, "db"), configFile: cfgFile, licenseOk: () => true, readJson, writeJson, json, readBody, log: () => {} });
  const srv2 = http.createServer((req, res) => api2.handle(req, res, new URL(req.url, "http://x")));
  await new Promise((ok) => srv2.listen(0, "127.0.0.1", ok));
  const r2 = await (await fetch(`http://127.0.0.1:${srv2.address().port}/v1/crm/contacts/${k.key}`)).json();
  const b2 = await (await fetch(`http://127.0.0.1:${srv2.address().port}/v1/crm/boxes/${bx.key}`)).json();
  srv2.close();
  assert.equal(r2.contato.arquivos[0].mensagens, 1); assert.match(b2.contatos[0].whatsapp.arquivo.resumo, /US\$ 40/); assert.ok(b2.arquivos[0].sha256);
  assert.equal((await call("DELETE", `/contacts/${k.key}/files/${k.arquivos[0].key}`)).status, 200);
  assert.equal((await call("GET", `/contacts/${k.key}`)).j.contato.arquivos.length, 0);
  assert.equal((await call("POST", "/whatsapp/arquivar", { phone: "+5511955554444", transcricao: "  " })).status, 400);
  iaFake = async () => "";
});

test("programa de indicação: nasce uma vez com semearIndicacao, nunca vira o pipeline do WhatsApp, apagado não volta", async () => {
  const d2 = mkdtempSync(join(tmpdir(), "crm-ind-")); const cfg2 = join(d2, "crm.json");
  const mk = () => createCrmApi({ dir: join(d2, "db"), configFile: cfg2, licenseOk: () => true, readJson, writeJson: (f, v) => writeFileSync(f, JSON.stringify(v)), json, readBody, log: () => {}, iaTexto: async () => "", semearIndicacao: true });
  const a2 = mk();
  const srv = http.createServer((req, res) => a2.handle(req, res, new URL(req.url, "http://x"))); await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const u = `http://127.0.0.1:${srv.address().port}/v1/crm`;
  const ps = (await (await fetch(`${u}/pipelines`)).json()).pipelines;
  assert.deepEqual(ps.map((p) => p.name), ["Programa de Indicação"]);
  const cfgv = await (await fetch(`${u}/config`)).json();
  assert.equal(cfgv.pipelineKey, null, "sozinho, o programa não vira o padrão do WhatsApp");
  const full = a2.store.listPipelines()[0];
  assert.deepEqual(full.stages.map((s) => s.name).slice(0, 3), ["Indicado", "Contato feito", "Chip ativado (mês grátis)"]);
  assert.deepEqual(full.fields.find((f) => f.name === "Indicação nº").options.map((o) => o.name), ["1", "2", "3"]);
  assert.equal(JSON.parse(readFileSync(cfg2, "utf8")).indicacaoSemeada, true);
  srv.close(); rmSync(d2, { recursive: true, force: true });
});

test("whatsapp/arquivar de grupo: sem pipeline padrão → 400; na 1ª vez abre a caixa fixa do grupo (nome do grupo, 1ª etapa, ligada pelo jid); depois reaproveita e não duplica", async () => {
  const d3 = mkdtempSync(join(tmpdir(), "crm-grp-")); const cfg3 = join(d3, "crm.json");
  const a3 = createCrmApi({ dir: join(d3, "db"), configFile: cfg3, licenseOk: () => true, readJson, writeJson: (f, v) => writeFileSync(f, JSON.stringify(v)), json, readBody, log: () => {}, iaTexto: async () => "", semearIndicacao: true });
  const srv = http.createServer((req, res) => a3.handle(req, res, new URL(req.url, "http://x"))); await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const u = `http://127.0.0.1:${srv.address().port}/v1/crm`;
  const post = async (path, body) => { const r = await fetch(`${u}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-crm-por": "app" }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };
  const grupo = { jid: "120363000000000001@g.us", nome: "(LV) - agente" };
  // Só o programa de indicação: não há pipeline padrão, então não dá para abrir a caixa e nada é gravado.
  const sem = await post("/whatsapp/arquivar", { grupo, transcricao: "oi", mensagens: 1 });
  assert.equal(sem.status, 400); assert.match(sem.j.error.message, /pipeline padrao/);
  assert.equal(a3.store.allBoxes().length, 0);
  const p = (await post("/pipelines", { name: "Operação", stages: ["Novo", "Em curso"] })).j.pipeline;
  const r1 = await post("/whatsapp/arquivar", { grupo, transcricao: "oi\ntudo bem", mensagens: 2, primeiraEm: 1792433746876, ultimaEm: 1792433846876 });
  assert.equal(r1.status, 200); assert.equal(r1.j.criada, true); assert.equal(r1.j.box.nome, "(LV) - agente"); assert.equal(r1.j.repetido, false);
  const bx = a3.store.getBox(r1.j.box.key);
  assert.equal(bx.pipelineKey, p.key); assert.equal(bx.stageKey, p.stages[0].key); assert.equal(bx.fields.whatsappGrupo, grupo.jid);
  assert.equal(bx.arquivos.length, 1); assert.match(bx.comentarios[0].texto, /Caixa aberta para o grupo/);
  // Segunda limpeza: mesma caixa, sem criar outra; o mesmo texto de novo não duplica o anexo.
  const r2 = await post("/whatsapp/arquivar", { grupo: { jid: grupo.jid }, transcricao: "outra conversa", mensagens: 1 });
  assert.equal(r2.status, 200); assert.equal(r2.j.criada, false); assert.equal(r2.j.box.key, r1.j.box.key);
  assert.equal(a3.store.allBoxes().length, 1); assert.equal(a3.store.getBox(r1.j.box.key).arquivos.length, 2);
  const r3 = await post("/whatsapp/arquivar", { grupo, transcricao: "outra conversa", mensagens: 1 });
  assert.equal(r3.j.repetido, true); assert.equal(a3.store.getBox(r1.j.box.key).arquivos.length, 2);
  srv.close(); rmSync(d3, { recursive: true, force: true });
});

test("exclusao pelo agente: 403, pedido registrado e comentario no box; pelo app continua apagando", async () => {
  // Servidor que carimba papel=agente, como o server.js faz quando a chave usada e a CRM_AGENT_KEY.
  const srvA = http.createServer((req, res) => api.handle(req, res, new URL(req.url, "http://x"), "agente"));
  await new Promise((r) => srvA.listen(0, "127.0.0.1", r));
  const baseA = `http://127.0.0.1:${srvA.address().port}`;
  try {
    const c = await call("POST", `/pipelines/${P.key}/boxes`, { name: "Caixa de teste do bloqueio", stage: S[0].name });
    assert.equal(c.status, 200); const bx = c.j.box;
    // O agente tenta apagar: 403 com codigo proprio, e o box continua la.
    const r = await fetch(`${baseA}/v1/crm/boxes/${bx.key}`, { method: "DELETE", headers: { "x-crm-por": "app" } });
    assert.equal(r.status, 403); const j = await r.json(); assert.equal(j.error.code, "exclusao_requer_dono");
    const g = await call("GET", `/boxes/${bx.key}`); assert.equal(g.status, 200, "o box nao foi apagado");
    assert.ok(g.j.comentarios.some((x) => /pediu para apagar/.test(x.texto) && x.autor === "agente"), "o pedido virou comentario no box");
    // Forjar X-Crm-Por: app com a chave do agente nao eleva: o feed carimba 'agente', nao 'app'.
    const feed = readFileSync(join(dir, "db", "mudancas.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const ped = feed.filter((m) => m.tipo === "exclusao.pedida"); assert.ok(ped.length >= 1, "exclusao.pedida no feed");
    assert.equal(ped.at(-1).por, "agente", "identidade vem da chave, nao do cabecalho");
    // Pelo app (papel padrao), apagar segue funcionando.
    assert.equal((await call("DELETE", `/boxes/${bx.key}`)).status, 200);
    assert.equal((await call("GET", `/boxes/${bx.key}`)).status, 404);
  } finally { srvA.close(); }
});

test("agenteAutonomo: nasce false, cria e edita com true, a lista devolve a marca, não booleano → 400", async () => {
  const sem = await call("POST", "/pipelines", { name: "Sem marca", stages: ["A", "B"] }, { "x-crm-por": "app" });
  assert.equal(sem.status, 200); assert.equal(sem.j.pipeline.agenteAutonomo, false);
  const com = await call("POST", "/pipelines", { name: "Leads do site", stages: ["Novo", "Respondido"], agenteAutonomo: true }, { "x-crm-por": "app" });
  assert.equal(com.status, 200); assert.equal(com.j.pipeline.agenteAutonomo, true);
  assert.equal((await call("GET", `/pipelines/${com.j.pipeline.key}`)).j.agenteAutonomo, true);
  const marca = async (k) => (await call("GET", "/pipelines")).j.pipelines.find((p) => p.key === k).agenteAutonomo;
  assert.equal(await marca(sem.j.pipeline.key), false); assert.equal(await marca(com.j.pipeline.key), true);
  const liga = await call("PATCH", `/pipelines/${sem.j.pipeline.key}`, { agenteAutonomo: true });
  assert.equal(liga.status, 200); assert.equal(liga.j.pipeline.agenteAutonomo, true); assert.equal(await marca(sem.j.pipeline.key), true);
  const outro = await call("PATCH", `/pipelines/${sem.j.pipeline.key}`, { name: "Sem marca 2" });
  assert.equal(outro.j.pipeline.agenteAutonomo, true, "editar outra coisa não desliga");
  assert.equal((await call("PATCH", `/pipelines/${sem.j.pipeline.key}`, { agenteAutonomo: false })).j.pipeline.agenteAutonomo, false);
  assert.equal((await call("PATCH", `/pipelines/${sem.j.pipeline.key}`, { agenteAutonomo: "true" })).status, 400);
  assert.equal((await call("POST", "/pipelines", { name: "Ruim", agenteAutonomo: 1 })).status, 400);
  assert.equal(await marca(sem.j.pipeline.key), false, "a recusa não gravou nada");
});
