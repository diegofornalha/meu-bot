// `DELETE /admin/contas/:id` de ponta a ponta: o handler do Worker chamado direto, contra um D1 local (miniflare) com
// as migrações do repositório. Só o super admin apaga; é a mesma exclusão do perfil (a conta some das telas, o
// histórico fica) e vale para qualquer conta, menos quem tem perfil de acesso ou é dona de organização.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);

test("super admin apaga a conta de outra pessoa: some da lista, o histórico fica, e os impedimentos do perfil valem", async () => {
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
    const env = { ...px.env, DB, SESSAO_HMAC_KEY: HMAC, ADMIN_BOOTSTRAP_EMAIL: "ninguem@exemplo.com" };
    const agora = new Date().toISOString();
    const S = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", A = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22", C = "2d2f8e3f-8f3f-4d9f-9e77-2f8c5f3e4f33", D = "3e3f9f4f-9a4f-4e0f-8f88-3a9d6f4f5a44";
    for (const [id, email] of [[S, "super@exemplo.com"], [A, "admin@exemplo.com"], [C, "comum@exemplo.com"], [D, "dona@exemplo.com"]]) {
      await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, nome, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, 'Fulana', ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
      await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, '2099-01-01T00:00:00.000Z', 2, '[]', ?2, 'system')").bind(id, agora).run();
    }
    await DB.prepare("INSERT INTO admins (email, papel, criado_em) VALUES ('super@exemplo.com', 'super', ?1), ('admin@exemplo.com', 'admin', ?1)").bind(agora).run();
    const s = Math.floor(Date.now() / 1000);
    const tok = async (sub, adm = null) => assinarJwt({ sub, sid: "s", dev: null, adm, iat: s, exp: s + 3600 }, HMAC);
    const chamar = async (metodo, caminho, corpo, t) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env, { waitUntil() {} }); return { status: r.status, corpo: await r.json() }; };
    const ts = await tok(S, "super"), ta = await tok(A, "admin"), tc = await tok(C);
    const viva = async (id) => (await DB.prepare("SELECT apagada_em FROM contas WHERE id = ?1").bind(id).first()).apagada_em === null;

    // Quem não é super admin não apaga ninguém: admin comum e conta sem papel recebem 403 e nada muda.
    for (const t of [ta, tc]) assert.equal((await chamar("DELETE", `/admin/contas/${C}`, undefined, t)).status, 403);
    assert.equal(await viva(C), true);

    // Id fora do formato e conta que não existe.
    assert.equal((await chamar("DELETE", "/admin/contas/nao-e-uuid", undefined, ts)).status, 400);
    assert.equal((await chamar("DELETE", "/admin/contas/9f9f9f9f-9f9f-4f9f-9f9f-9f9f9f9f9f9f", undefined, ts)).status, 404);

    // Os impedimentos do perfil: quem tem perfil de acesso (o próprio super e o admin) e a dona de uma organização.
    for (const id of [S, A]) {
      const r = await chamar("DELETE", `/admin/contas/${id}`, undefined, ts);
      assert.equal(r.status, 403); assert.match(r.corpo.erro, /perfil de acesso/);
      assert.equal(await viva(id), true);
    }
    let r = await chamar("POST", "/orgs", { nome: "Org da Dona", slug: "org-da-dona" }, await tok(D));
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    r = await chamar("DELETE", `/admin/contas/${D}`, undefined, ts);
    assert.equal(r.status, 403); assert.match(r.corpo.erro, /dona de Org da Dona/);
    assert.equal(await viva(D), true);

    // A conta comum é apagada: some da lista do admin, o e-mail fica livre, o histórico e a auditoria ficam.
    r = await chamar("DELETE", `/admin/contas/${C}`, undefined, ts);
    assert.deepEqual([r.status, r.corpo], [200, { ok: true }]);
    const linha = await DB.prepare("SELECT email, nome, apagada_em FROM contas WHERE id = ?1").bind(C).first();
    assert.equal(linha.email, `apagada:${C}:comum@exemplo.com`, "o e-mail original fica guardado para a auditoria");
    assert.equal(linha.nome, null); assert.notEqual(linha.apagada_em, null);
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM licencas WHERE conta_id = ?1").bind(C).first()).n, 1, "a licença fica no histórico");
    const aud = await DB.prepare("SELECT quem, detalhe FROM auditoria WHERE acao = 'conta.apagada' AND conta_id = ?1").bind(C).first();
    assert.deepEqual(aud, { quem: "super@exemplo.com", detalhe: "pelo super admin; era comum@exemplo.com" });
    r = await chamar("GET", "/admin/visao", undefined, ts);
    assert.deepEqual(r.corpo.contas.map((c) => c.id).sort(), [A, D, S].sort());

    // A Auditoria (só super admin) mostra o que as telas escondem: a conta apagada, com o e-mail que tinha e quem apagou.
    assert.equal((await chamar("GET", "/admin/auditoria", undefined, ta)).status, 403, "admin comum não vê");
    assert.equal((await chamar("GET", "/admin/auditoria", undefined, tc)).status, 401, "a conta apagada não entra mais");
    r = await chamar("GET", "/admin/auditoria", undefined, ts);
    assert.equal(r.status, 200);
    assert.equal(r.corpo.apagadas.length, 1);
    const { criadaEm, apagadaEm, ...apagada } = r.corpo.apagadas[0];
    assert.deepEqual(apagada, { id: C, email: "comum@exemplo.com", apagadaPor: "super@exemplo.com", plan: "pro", status: "active", expiresAt: "2099-01-01T00:00:00.000Z", pagoCentavos: 0 });
    assert.equal(criadaEm, agora); assert.equal(apagadaEm, linha.apagada_em);
    const acao = r.corpo.registro.find((a) => a.acao === "conta.apagada");
    assert.deepEqual([acao.quem, acao.conta, acao.detalhe], ["super@exemplo.com", { id: C, email: "comum@exemplo.com", apagada: true }, "pelo super admin; era comum@exemplo.com"]);
    assert.deepEqual(r.corpo.registro.find((a) => a.acao === "org.criada").conta, { id: D, email: "dona@exemplo.com", apagada: false }, "conta viva: o próprio e-mail");
    assert.equal(r.corpo.registro[0].id > r.corpo.registro.at(-1).id, true, "das mais novas para as antigas");

    // Apagar de novo: a conta não existe mais (404, que faz o console reler a lista).
    assert.equal((await chamar("DELETE", `/admin/contas/${C}`, undefined, ts)).status, 404);
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
