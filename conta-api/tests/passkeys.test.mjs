// Passkey (WebAuthn) de ponta a ponta no handler do Worker, contra um D1 local com as migrações do repositório e um
// autenticador de mentira (chave P-256 do WebCrypto): criar no console, entrar pela página de login, trocar o código
// por um token, e as recusas (origem, RP, sem verificação da pessoa, assinatura errada, desafio reusado, outra conta).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto as wc, createHash, randomBytes } from "node:crypto";

const api = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);
const b64u = (b) => Buffer.from(b).toString("base64url");
const sha = (b) => createHash("sha256").update(b).digest();
const RP = "agentesgrok.com";

/** r || s (WebCrypto) para DER (o que um autenticador de verdade manda). */
function rawParaDer(raw) {
  const int = (v) => { let i = 0; while (i < v.length - 1 && v[i] === 0) i++; v = v.subarray(i); if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0]), v]); return Buffer.concat([Buffer.from([0x02, v.length]), v]); };
  const r = int(Buffer.from(raw).subarray(0, 32)), s = int(Buffer.from(raw).subarray(32));
  return Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s]);
}
/** Um autenticador: guarda a chave e responde ao create() e ao get() como o navegador entregaria. */
async function autenticador({ rpId = RP, uv = true } = {}) {
  const par = await wc.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const spki = Buffer.from(await wc.subtle.exportKey("spki", par.publicKey));
  const x = spki.subarray(spki.length - 64, spki.length - 32), y = spki.subarray(spki.length - 32);
  const cose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), x, Buffer.from([0x22, 0x58, 0x20]), y]);
  const credId = randomBytes(20);
  let contador = 0;
  const flags = (at) => 0x01 | (uv ? 0x04 : 0) | (at ? 0x40 : 0);
  const cabeca = (at) => { const c = Buffer.alloc(4); c.writeUInt32BE(contador); return Buffer.concat([sha(rpId), Buffer.from([flags(at)]), c]); };
  const cliente = (type, challenge, origin) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    id: b64u(credId), spki,
    criar(challenge, origin) {
      const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
      const ad = Buffer.concat([cabeca(true), Buffer.alloc(16), len, credId, cose]);
      return { clientDataJSON: b64u(cliente("webauthn.create", challenge, origin)), authenticatorData: b64u(ad), publicKey: b64u(spki), alg: -7, transportes: ["internal", "hybrid", "coisa-estranha"], nome: "MacBook · Chrome" };
    },
    async entrar(challenge, origin, extra = {}) {
      contador += 1;
      const ad = cabeca(false), cd = cliente("webauthn.get", challenge, origin);
      const sig = rawParaDer(await wc.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, par.privateKey, Buffer.concat([ad, sha(cd)])));
      return { id: b64u(credId), clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(sig), ...extra };
    },
  };
}

test("passkey-core: DER para r||s, chave do autenticador e as recusas do cadastro", async () => {
  const { derParaRaw, chaveConfere, conferirCadastro, lerAuthData, validaCadastro } = await import("../dist/passkey-core.js");
  // r com zero à esquerda (33 bytes no DER) e s curto (31 bytes): os dois viram 32.
  const r = Buffer.concat([Buffer.from([0x80]), randomBytes(31)]), s = Buffer.concat([Buffer.from([0x00, 0x01]), randomBytes(30)]);
  assert.deepEqual(Buffer.from(derParaRaw(rawParaDer(Buffer.concat([r, s])))), Buffer.concat([r, s]));
  assert.equal(derParaRaw(Buffer.from([0x30, 0x02, 0x02, 0x00])), null);
  assert.equal(derParaRaw(Buffer.concat([rawParaDer(Buffer.concat([r, s])), Buffer.from([0])])), null, "lixo depois da assinatura");
  assert.equal(lerAuthData(Buffer.alloc(36)), null);

  const rp = { rpId: RP, origens: ["https://auth.agentesgrok.com", "https://console.agentesgrok.com"] };
  const a = await autenticador(), outro = await autenticador();
  const ok = await conferirCadastro(validaCadastro(a.criar("d".repeat(43), rp.origens[1])), rp);
  assert.equal(ok.id, a.id); assert.equal(ok.desafio, "d".repeat(43)); assert.equal(ok.contador, 0); assert.equal(ok.sincronizada, false);
  assert.deepEqual(validaCadastro(a.criar("d".repeat(43), rp.origens[1])).transportes, ["internal", "hybrid"], "transporte fora da lista cai");
  const errado = async (muda, opts) => (await conferirCadastro(validaCadastro({ ...(await autenticador(opts)).criar("d".repeat(43), rp.origens[1]), ...muda }), rp)).erro;
  assert.match((await conferirCadastro(validaCadastro(a.criar("d".repeat(43), "https://console.agentesgrok.com.evil.example")), rp)).erro, /outra página/);
  assert.match(await errado({}, { rpId: "evil.example" }), /outro site/);
  assert.match(await errado({}, { uv: false }), /não conferiu a pessoa/);
  assert.match(await errado({ publicKey: b64u(outro.spki) }), /não é a que o autenticador criou/, "a chave mandada tem de ser a do authenticatorData");
  assert.equal(chaveConfere(a.spki, -257, Buffer.alloc(300)), false);
  assert.match(validaCadastro({ ...a.criar("d".repeat(43), rp.origens[1]), alg: -8 }).erro, /algoritmo/);
  assert.match(validaCadastro({ clientDataJSON: "a" }).erro, /incompleta/);
});

test("passkey: criar no console, entrar pela página de login e as recusas", async () => {
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
    const { assinarJwt, b64url, sha256 } = await import("../dist/sessao-core.js");
    const HMAC = Buffer.from("k".repeat(32)).toString("base64");
    const env = { ...px.env, DB, GA_ID: "", SESSAO_HMAC_KEY: HMAC };
    assert.equal(env.PASSKEY_RP_ID, RP, "o wrangler.toml liga a passkey no staging");
    const AUTH = env.AUTH_ORIGIN, CONSOLE = env.CONSOLE_ORIGIN;
    const agora = new Date().toISOString();
    const A = "0b0f6c1e-6d1f-4b7e-9c55-0d6a3f1c2e11", B = "1c1f7d2f-7e2f-4c8f-8d66-1e7b4f2d3f22";
    for (const [id, email] of [[A, "ana@exemplo.com"], [B, "bia@exemplo.com"]]) await DB.prepare("INSERT INTO contas (id, firebase_uid, email, email_verificado, criada_em, atualizada_em) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(id, "uid-" + id, email, agora).run();
    const s = Math.floor(Date.now() / 1000);
    const token = (sub) => assinarJwt({ sub, sid: "web:x", dev: null, adm: null, iat: s, exp: s + 3600 }, HMAC);
    const ta = await token(A), tb = await token(B);
    const chamar = async (metodo, caminho, corpo, t, e = env) => {
      const r = await worker.fetch(new Request("https://api.local" + caminho, { method: metodo, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), e, { waitUntil() {} });
      return { status: r.status, corpo: await r.json().catch(() => null) };
    };

    // --- Console: lista vazia, opções, cadastro.
    assert.equal((await chamar("GET", "/conta/passkeys")).status, 401, "sem login");
    assert.deepEqual((await chamar("GET", "/conta/passkeys", undefined, ta)).corpo, { passkeys: [], limite: 10 });
    const op = (await chamar("POST", "/conta/passkeys/opcoes", {}, ta)).corpo;
    assert.equal(op.rp.id, RP); assert.equal(op.user.name, "ana@exemplo.com (staging)");
    assert.equal(Buffer.from(op.user.id, "base64url").toString(), A, "o id da pessoa no autenticador é o id da conta");
    assert.deepEqual(op.authenticatorSelection, { residentKey: "required", userVerification: "required" });
    const chave = await autenticador();
    // O desafio é da Ana: a Bia não cadastra com ele.
    assert.equal((await chamar("POST", "/conta/passkeys", chave.criar(op.challenge, CONSOLE), tb)).status, 400);
    // ...e a tentativa da Bia não gastou o desafio da Ana.
    const criada = await chamar("POST", "/conta/passkeys", chave.criar(op.challenge, CONSOLE), ta);
    assert.equal(criada.status, 200);
    assert.deepEqual(criada.corpo.passkeys.map((p) => [p.id, p.nome, p.usadaEm, p.sincronizada]), [[chave.id, "MacBook · Chrome", null, false]]);
    assert.equal((await chamar("POST", "/conta/passkeys", chave.criar(op.challenge, CONSOLE), ta)).status, 400, "o desafio vale uma vez");
    const op2 = (await chamar("POST", "/conta/passkeys/opcoes", {}, ta)).corpo;
    assert.deepEqual(op2.excludeCredentials, [{ type: "public-key", id: chave.id }]);
    assert.equal((await chamar("POST", "/conta/passkeys", chave.criar(op2.challenge, CONSOLE), ta)).status, 409, "a mesma credencial não entra duas vezes");

    // --- Página de login: desafio, assinatura, código, token.
    const verifier = "v".repeat(43), challenge = b64url(await sha256(verifier));
    const pedido = { state: "s".repeat(32), challenge, esquema: "web" };
    const desafio = async () => (await chamar("POST", "/sessao/passkey/opcoes", {})).corpo.challenge;
    const handle = b64u(Buffer.from(A));
    const d1 = await desafio();
    const resposta = await chave.entrar(d1, AUTH, { ...pedido, userHandle: handle });
    const entrou = await chamar("POST", "/sessao/passkey", resposta);
    assert.equal(entrou.status, 200); assert.equal(typeof entrou.corpo.code, "string");
    const tk = await chamar("POST", "/token", { grant: "web", code: entrou.corpo.code, verifier });
    assert.equal(tk.status, 200); assert.equal(tk.corpo.conta.email, "ana@exemplo.com");
    assert.equal((await chamar("POST", "/sessao/passkey", resposta)).status, 401, "a mesma resposta de novo: o desafio já foi gasto");
    const usada = (await chamar("GET", "/conta/passkeys", undefined, ta)).corpo.passkeys[0];
    assert.ok(usada.usadaEm, "o uso fica registrado");
    assert.equal((await DB.prepare("SELECT contador FROM passkeys WHERE id = ?1").bind(chave.id).first()).contador, 1);

    // --- Recusas do login, todas 401 com o mesmo texto.
    const recusa = async (corpo) => { const r = await chamar("POST", "/sessao/passkey", corpo); return [r.status, /não reconhecida/.test(r.corpo.erro)]; };
    const impostor = await autenticador();
    assert.deepEqual(await recusa(await impostor.entrar(await desafio(), AUTH, pedido)), [401, true], "credencial desconhecida");
    // A chave do impostor assinando com o id da credencial da Ana.
    assert.deepEqual(await recusa({ ...(await impostor.entrar(await desafio(), AUTH, pedido)), id: chave.id }), [401, true], "assinatura de outra chave");
    assert.deepEqual(await recusa(await chave.entrar(await desafio(), "https://evil.example", pedido)), [401, true], "outra origem");
    assert.deepEqual(await recusa(await chave.entrar(await desafio(), AUTH, { ...pedido, userHandle: b64u(Buffer.from(B)) })), [401, true], "userHandle de outra conta");
    assert.equal((await chamar("POST", "/sessao/passkey", await chave.entrar("x".repeat(43), AUTH, pedido))).status, 401, "desafio que a API não emitiu");
    assert.equal((await chamar("POST", "/sessao/passkey", { ...(await chave.entrar(await desafio(), AUTH, pedido)), esquema: "javascript" })).status, 400);
    // Depois das recusas, a passkey da Ana continua entrando (o contador do autenticador subiu a cada tentativa).
    assert.equal((await chamar("POST", "/sessao/passkey", await chave.entrar(await desafio(), AUTH, pedido))).status, 200);
    // Contador que volta (cópia da chave): recusa.
    await DB.prepare("UPDATE passkeys SET contador = 999 WHERE id = ?1").bind(chave.id).run();
    assert.deepEqual(await recusa(await chave.entrar(await desafio(), AUTH, pedido)), [401, true], "contador voltou");
    await DB.prepare("UPDATE passkeys SET contador = 0 WHERE id = ?1").bind(chave.id).run();

    // --- Organização: pela página dela só membro entra.
    assert.equal((await chamar("POST", "/sessao/passkey", await chave.entrar(await desafio(), AUTH, { ...pedido, org: "nao-existe" }))).status, 404);

    // --- Remover: só a dona; depois disso a passkey não entra mais.
    assert.equal((await chamar("DELETE", "/conta/passkeys/" + chave.id, undefined, tb)).status, 404, "a Bia não remove a passkey da Ana");
    assert.deepEqual((await chamar("DELETE", "/conta/passkeys/" + chave.id, undefined, ta)).corpo.passkeys, []);
    assert.deepEqual(await recusa(await chave.entrar(await desafio(), AUTH, pedido)), [401, true], "removida");
    const audit = (await DB.prepare("SELECT acao, detalhe FROM auditoria WHERE conta_id = ?1 AND (acao LIKE 'passkey.%' OR detalhe LIKE '%passkey') ORDER BY id").bind(A).all()).results.map((x) => `${x.acao} ${x.detalhe}`);
    assert.deepEqual(audit, ["passkey.criada MacBook · Chrome", "login.codigo web · passkey", "login.codigo web · passkey", "passkey.removida MacBook · Chrome"]);

    // --- Apagar a conta leva as passkeys junto.
    const daBia = await autenticador();
    const opb = (await chamar("POST", "/conta/passkeys/opcoes", {}, tb)).corpo;
    assert.equal((await chamar("POST", "/conta/passkeys", daBia.criar(opb.challenge, CONSOLE), tb)).status, 200);
    assert.equal((await chamar("DELETE", "/conta", undefined, tb)).status, 200);
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM passkeys").first()).n, 0);
    assert.deepEqual(await recusa(await daBia.entrar(await desafio(), AUTH, pedido)), [401, true], "conta apagada");

    // --- Desligada (sem PASSKEY_RP_ID): 503 em tudo.
    const sem = { ...env, PASSKEY_RP_ID: "" };
    for (const [m, c, t] of [["GET", "/conta/passkeys", ta], ["POST", "/conta/passkeys/opcoes", ta], ["POST", "/sessao/passkey/opcoes", null]]) assert.equal((await chamar(m, c, m === "GET" ? undefined : {}, t, sem)).status, 503, `${m} ${c}`);
  } finally { await px.dispose(); rmSync(persist, { recursive: true, force: true }); }
});
