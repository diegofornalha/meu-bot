// As rotas /conta/maquinas de ponta a ponta: o handler do Worker chamado direto, contra um D1 local (miniflare) com as
// migrações do repositório. O backend da máquina (backend-colima/licenca.js) confere cada licença emitida.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);

test("rotas da licença na máquina: vincular, vaga, renovar, tirar, limite do admin", async () => {
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
  const be = req("../../backend-colima/licenca.js");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const chaves = [{ id: "licenca-2026-11", chave: publicKey.export({ format: "der", type: "spki" }).toString("base64") }];
  const HMAC = Buffer.from("k".repeat(32)).toString("base64");
  const env = { ...px.env, DB, ADMIN_BOOTSTRAP_EMAIL: "Dona@Exemplo.com ", SESSAO_HMAC_KEY: HMAC, LICENCA_PRIVATE_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") };
  const agora = new Date().toISOString();
  const A = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", B = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22";
  for (const [id, email] of [[A, "ana@exemplo.com"], [B, "bia@exemplo.com"]]) await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
  await DB.prepare("INSERT INTO licencas (conta_id, plan, status, interval, member_since, expires_at, device_limit, produtos, updated_at, updated_by) VALUES (?1, 'pro', 'active', 'month', ?2, ?3, 1, '[]', ?2, 'system')").bind(A, agora, new Date(Date.now() + 20 * 864e5).toISOString()).run();
  await DB.prepare("INSERT INTO pedidos (id, conta_id, tipo, detalhe, maquina_id, criado_em) VALUES ('p1', ?1, 'pagamento.liberar', 'liberar na máquina: Pro', NULL, ?2)").bind(A, agora).run();
  const s = Math.floor(Date.now() / 1000);
  const tok = async (sub, adm = null) => assinarJwt({ sub, sid: "s", dev: null, adm, iat: s, exp: s + 3600 }, HMAC);
  const chamar = async (metodo, caminho, corpo, t, e = env) => { const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), e, { waitUntil() {} }); return { status: r.status, corpo: await r.json() }; };
  const M1 = "5d2c1c0a-3f1b-4a52-8b8e-1f2a3b4c5d6e", M2 = "7e3d2d1b-4a2c-4b63-9c9f-2a3b4c5d6e7f";
  const ta = await tok(A), tb = await tok(B), tadm = await tok(A, "super");
  const diz = (nome, ok, extra = "") => assert.ok(ok, `${nome}${extra ? " :: " + extra : ""}`);
  let r = await chamar("POST", "/conta/maquinas", { id: M1, apelido: "Karen" }, ta, { ...env, LICENCA_PRIVATE_KEY: undefined });
  diz("sem o secret responde 503", r.status === 503, r.corpo.erro);
  r = await chamar("POST", "/conta/maquinas", { id: "nao-e-uuid" }, ta); diz("id fora do formato: 400", r.status === 400);
  r = await chamar("POST", "/conta/maquinas", { id: M1, apelido: "Karen" }, ta);
  const v = be.verificaLicencaAssinada(r.corpo.licenca, { chaves, maquina: M1 });
  diz("vincula e o backend da máquina aceita a licença", r.status === 200 && v.ok === true && v.payload.licenca.plan === "pro", `maquinas=${JSON.stringify(r.corpo.maquinas?.map((m) => m.apelido))}`);
  diz("o pedido 'liberar na máquina' fechou sozinho", (await DB.prepare("SELECT atendido_por FROM pedidos WHERE id='p1'").first()).atendido_por === "system");
  r = await chamar("POST", "/conta/maquinas", { id: M2, apelido: "Outra" }, ta);
  diz("segunda máquina: 409 com quem ocupa", r.status === 409 && r.corpo.noLimite === true && r.corpo.ocupadas?.[0]?.apelido === "Karen", r.corpo.erro);
  r = await chamar("POST", "/conta/maquinas", { id: M1 }, tb); diz("outra conta não toma a máquina: 409", r.status === 409, r.corpo.erro);
  r = await chamar("POST", `/conta/maquinas/${M1}/licenca`, undefined, ta); diz("renova a da própria conta", r.status === 200 && be.verificaLicencaAssinada(r.corpo.licenca, { chaves, maquina: M1 }).ok);
  r = await chamar("POST", `/conta/maquinas/${M1}/licenca`, undefined, tb); diz("renovar máquina de outra conta: 404", r.status === 404);
  r = await chamar("GET", "/conta", undefined, ta); diz("GET /conta traz a máquina e o limite", r.corpo.maquinas?.length === 1 && r.corpo.maquinaLimite === 1 && typeof r.corpo.maquinas[0].proAte === "string", `proAte=${r.corpo.maquinas?.[0]?.proAte}`);
  r = await chamar("DELETE", `/conta/maquinas/${M1}`, {}, ta); diz("tirar pelo console prende a vaga", r.status === 200 && r.corpo.naHora === false && r.corpo.maquinas[0].desvinculadaEm !== null);
  r = await chamar("POST", "/conta/maquinas", { id: M2 }, ta); diz("com a vaga presa, a segunda continua recusada", r.status === 409);
  r = await chamar("POST", `/conta/maquinas/${M1}/licenca`, undefined, ta); diz("desvinculada não renova: 404", r.status === 404);
  r = await chamar("DELETE", `/conta/maquinas/${M1}`, { apagada: true }, ta); diz("o app apagou o arquivo: a vaga abre na hora", r.status === 200 && r.corpo.naHora === true && r.corpo.maquinas.length === 0);
  r = await chamar("POST", "/conta/maquinas", { id: M2, apelido: "Outra" }, ta); diz("agora a segunda entra", r.status === 200);
  r = await chamar("PATCH", `/admin/contas/${A}/licenca`, { maquinaLimit: 2, motivo: "ajuste de teste" }, tadm); diz("o admin sobe o limite de máquinas", r.status === 200 && r.corpo.licenca.maquinaLimit === undefined, JSON.stringify(Object.keys(r.corpo.licenca ?? {})).slice(0, 40));
  r = await chamar("POST", "/conta/maquinas", { id: M1, apelido: "Karen" }, ta); diz("com limite 2, as duas ficam", r.status === 200 && r.corpo.maquinas.length === 2);
  r = await chamar("GET", "/admin/visao", undefined, tadm); const ca = r.corpo.contas?.find((c) => c.id === A); diz("a visão do admin mostra máquinas e limite", ca?.maquinas === 2 && ca?.maquinaLimite === 2);
  // Conta que o painel ainda lista mas o banco já não tem (removida depois da leitura): as ações do admin respondem 404,
  // que é o que faz o painel reler a lista (public/console/admin-core.js).
  const FANTASMA = "0613dc2c-0000-4000-8000-000000000000";
  r = await chamar("PATCH", `/admin/contas/${FANTASMA}/licenca`, { deviceLimit: 2, motivo: "ajuste de teste" }, tadm); diz("licença de conta que não existe: 404", r.status === 404 && r.corpo.erro === "conta não existe", `${r.status} ${r.corpo.erro}`);
  r = await chamar("POST", `/admin/contas/${FANTASMA}/senha`, {}, tadm); diz("e-mail de senha de conta que não existe: 404", r.status === 404, `${r.status} ${r.corpo.erro}`);
  r = await chamar("PUT", `/admin/contas/${FANTASMA}/senha`, { senha: "uma-senha-longa" }, tadm, { ...env, FIREBASE_ADMIN_SA: "{}" }); diz("definir senha de conta que não existe: 404, antes de falar com o Firebase", r.status === 404, `${r.status} ${r.corpo.erro}`);
  r = await chamar("GET", "/admin/visao", undefined, tadm); diz("a visão do admin não lista a conta que não existe", r.status === 200 && !r.corpo.contas.some((c) => c.id === FANTASMA));
  r = await chamar("POST", "/conta/maquinas", { id: M1 }, tb); const vb = be.verificaLicencaAssinada((await chamar("POST", "/conta/maquinas", { id: "9a5f4f3d-6c4e-4d85-8e1b-4c5d6e7f8a9b" }, tb)).corpo.licenca, { chaves });
  diz("conta free também emite, e a licença sai free", vb.ok === true && vb.payload.licenca.plan === "free");
  const aud = (await DB.prepare("SELECT acao, detalhe FROM auditoria ORDER BY rowid").all()).results.map((a) => a.acao);
  diz("auditoria registra", aud.filter((a) => a.startsWith("maquina.")).length >= 5, [...new Set(aud)].join(","));
  // O admin inicial (ADMIN_BOOTSTRAP_EMAIL) não é removido nem rebaixado por outro super admin; os outros perfis, sim.
  await DB.prepare("INSERT INTO admins (email, papel, criado_em) VALUES ('dona@exemplo.com', 'super', ?1), ('outro@exemplo.com', 'super', ?1)").bind(agora).run();
  r = await chamar("DELETE", "/admin/perfis/dona%40exemplo.com", undefined, tadm); diz("remover o admin inicial: 403", r.status === 403, `${r.status} ${r.corpo.erro}`);
  r = await chamar("PUT", "/admin/perfis/dona%40exemplo.com", { papel: "admin" }, tadm); diz("rebaixar o admin inicial: 403", r.status === 403, `${r.status} ${r.corpo.erro}`);
  diz("o admin inicial continua super no banco", (await DB.prepare("SELECT papel FROM admins WHERE email = 'dona@exemplo.com'").first())?.papel === "super");
  r = await chamar("GET", "/admin/visao", undefined, tadm); diz("a visão marca só o admin inicial como fixo", r.corpo.perfis.find((p) => p.email === "dona@exemplo.com")?.fixo === true && r.corpo.perfis.find((p) => p.email === "outro@exemplo.com")?.fixo === false, JSON.stringify(r.corpo.perfis));
  r = await chamar("DELETE", "/admin/perfis/outro%40exemplo.com", undefined, tadm); diz("outro super admin continua removível", r.status === 200, `${r.status} ${r.corpo.erro}`);
  // Chave que não é Ed25519: 503, e nada foi gravado (a máquina não ocupa vaga sem licença).
  const M9 = "8b4e3e2c-5b3d-4c74-8d0a-3b4c5d6e7f8a";
  await chamar("DELETE", "/conta/maquinas/9a5f4f3d-6c4e-4d85-8e1b-4c5d6e7f8a9b", { apagada: true }, tb);
  const antes = (await DB.prepare("SELECT COUNT(*) AS n FROM maquinas").first()).n;
  r = await chamar("POST", "/conta/maquinas", { id: M9 }, tb, { ...env, LICENCA_PRIVATE_KEY: "bm9wZQ==" });
  diz("chave inválida responde 503 sem gravar nada", r.status === 503 && (await DB.prepare("SELECT COUNT(*) AS n FROM maquinas").first()).n === antes);
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
