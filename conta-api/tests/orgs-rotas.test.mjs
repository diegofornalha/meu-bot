// Organizações no handler do Worker, contra um D1 local com as migrações do repositório: quem pode criar e quantas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { podeCriarOrg } from "../dist/sessao-core.js";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);

test("podeCriarOrg: só com o Pro valendo (teste grátis não), até o limite; super admin sem limite", () => {
  const AGORA = Date.parse("2026-11-19T12:00:00Z"), em = (d) => new Date(AGORA + d * 86400000).toISOString();
  const base = { papel: null, donaDe: 0, limite: 1, agoraMs: AGORA };
  const pro = { plan: "pro", status: "active", expiresAt: em(20) };
  assert.equal(podeCriarOrg({ ...base, licenca: pro }), null);
  assert.equal(podeCriarOrg({ ...base, licenca: { ...pro, expiresAt: null } }), null, "Pro sem prazo");
  assert.equal(podeCriarOrg({ ...base, licenca: { ...pro, expiresAt: em(-1) } }).motivo, "sem-pro", "Pro vencido");
  const teste = podeCriarOrg({ ...base, licenca: { plan: "pro", status: "trialing", expiresAt: em(2) } });
  assert.equal(teste.motivo, "sem-pro"); assert.match(teste.erro, /teste grátis/);
  for (const l of [{ plan: "free", status: "free", expiresAt: null }, { plan: "free", status: "expired", expiresAt: null }]) assert.equal(podeCriarOrg({ ...base, licenca: l }).motivo, "sem-pro");
  assert.equal(podeCriarOrg({ ...base, licenca: pro, donaDe: 1 }).motivo, "no-limite");
  assert.equal(podeCriarOrg({ ...base, licenca: pro, donaDe: 1, limite: 2 }), null, "o admin subiu o limite");
  assert.equal(podeCriarOrg({ ...base, licenca: pro, donaDe: 2, limite: 2 }).motivo, "no-limite");
  assert.equal(podeCriarOrg({ ...base, papel: "super", licenca: { plan: "free", status: "free", expiresAt: null }, donaDe: 9 }), null);
  assert.equal(podeCriarOrg({ ...base, papel: "admin", licenca: { plan: "free", status: "free", expiresAt: null } }).motivo, "sem-pro", "admin comum segue a regra");
});

test("criar organização: sem Pro não cria, com Pro cria uma, a segunda é recusada até o admin subir o limite; super admin cria sem limite", async () => {
  const persist = mkdtempSync(join(tmpdir(), "conta-d1-"));
  const { getPlatformProxy } = req("wrangler");
  const px = await getPlatformProxy({ configPath: api + "/wrangler.toml", environment: "staging", persist: { path: persist } });
  try {
    const DB = px.env.DB;
    for (const f of readdirSync(api + "/migrations").sort()) {
      const sql = readFileSync(api + "/migrations/" + f, "utf8").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
      for (const st of sql.split(";").map((x) => x.trim()).filter(Boolean)) await DB.prepare(st).run();
    }
    const worker = (await import("../dist/index.js")).default;
    const { assinarJwt } = await import("../dist/sessao-core.js");
    const HMAC = Buffer.from("k".repeat(32)).toString("base64");
    const env = { ...px.env, DB, GA_ID: "", SESSAO_HMAC_KEY: HMAC, ADMIN_BOOTSTRAP_EMAIL: "ninguem@exemplo.com" };
    const agora = new Date().toISOString(), em = (d) => new Date(Date.now() + d * 86400000).toISOString();
    const P = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", T = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22", F = "2d2f8e3f-8f3f-4d9f-9e77-2f8c5f3e4f33", S = "3e3f9f4f-9a4f-4e0f-8f88-3a9d6f4f5a44";
    for (const [id, email] of [[P, "pro@exemplo.com"], [T, "teste@exemplo.com"], [F, "free@exemplo.com"], [S, "super@exemplo.com"]]) await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
    await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, ?3, 2, '[]', ?2, 'system')").bind(P, agora, em(20)).run();
    await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, trial_end, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'trialing', NULL, ?2, ?3, ?3, 2, '[]', ?2, 'system')").bind(T, agora, em(2)).run();
    await DB.prepare("INSERT INTO admins (email, papel, criado_em) VALUES ('super@exemplo.com', 'super', ?1)").bind(agora).run();
    const s = Math.floor(Date.now() / 1000);
    const tok = (id, adm = null) => assinarJwt({ sub: id, sid: "s", dev: null, adm, iat: s, exp: s + 3600 }, HMAC);
    const chamar = async (metodo, caminho, corpo, t) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env, { waitUntil() {} }); return { status: r.status, corpo: await r.json().catch(() => null) }; };
    const tp = await tok(P), tt = await tok(T), tf = await tok(F), ts = await tok(S, "super");
    const conta = async (t) => (await chamar("GET", "/conta", undefined, t)).corpo.orgCriar;

    // A tela sabe antes de tentar.
    assert.deepEqual(await conta(tp), { limite: 1, donaDe: 0, motivo: null });
    assert.deepEqual(await conta(tt), { limite: 1, donaDe: 0, motivo: "sem-pro" });
    assert.deepEqual(await conta(tf), { limite: 1, donaDe: 0, motivo: "sem-pro" });

    let r = await chamar("POST", "/orgs", { nome: "Do Teste", slug: "do-teste" }, tt);
    assert.equal(r.status, 403); assert.equal(r.corpo.motivo, "sem-pro"); assert.match(r.corpo.erro, /teste grátis/);
    assert.equal((await chamar("POST", "/orgs", { nome: "Do Free", slug: "do-free" }, tf)).status, 403);
    assert.equal((await chamar("POST", "/orgs", { nome: "x", slug: "do-pro" }, tp)).status, 400, "nome curto: a validação vem antes");

    r = await chamar("POST", "/orgs", { nome: "Do Pro", slug: "do-pro" }, tp);
    assert.equal(r.status, 200); assert.equal(r.corpo.slug, "do-pro");
    assert.deepEqual(await conta(tp), { limite: 1, donaDe: 1, motivo: "no-limite" });
    r = await chamar("POST", "/orgs", { nome: "Segunda", slug: "segunda" }, tp);
    assert.equal(r.status, 403); assert.equal(r.corpo.motivo, "no-limite"); assert.match(r.corpo.erro, /já tem uma organização/);

    // O admin sobe o limite pela licença: a segunda passa, a terceira não.
    assert.equal((await chamar("PATCH", `/admin/contas/${P}/licenca`, { orgLimit: 0, motivo: "ajuste de teste" }, ts)).status, 400);
    assert.equal((await chamar("PATCH", `/admin/contas/${P}/licenca`, { orgLimit: 2, motivo: "ajuste de teste" }, ts)).status, 200);
    assert.equal((await chamar("POST", "/orgs", { nome: "Segunda", slug: "segunda" }, tp)).status, 200);
    assert.equal((await chamar("POST", "/orgs", { nome: "Terceira", slug: "terceira" }, tp)).status, 403);
    const visao = (await chamar("GET", "/admin/visao", undefined, ts)).corpo;
    assert.equal(visao.contas.find((c) => c.id === P).orgLimite, 2);

    // Apagar uma organização devolve a vaga.
    assert.equal((await chamar("DELETE", "/orgs/segunda", undefined, tp)).status, 200);
    assert.equal((await chamar("POST", "/orgs", { nome: "Terceira", slug: "terceira" }, tp)).status, 200);

    // Super admin: sem Pro gravado e sem limite.
    for (const slug of ["do-super-um", "do-super-dois"]) assert.equal((await chamar("POST", "/orgs", { nome: "Do Super", slug }, ts)).status, 200, slug);
    assert.deepEqual((await conta(ts)).motivo, null);
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
