// Sessão da conta, a parte pura: PKCE, JWT HS256, validação dos pedidos, admissão de device.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validaPatchLicenca, validaBusca, admitirDevice, assinarJwt, b64url, deB64url, janelaMinuto, pkceConfere, segredo, sha256Hex, validaDevice, validaPedidoSessao, validaPedidoToken, verificarJwt, nomeExibicao, parseProvedores, provedoresDoLogin, unirProvedores, validaPatchPerfil, decidirLiberarDevice } from "../dist/sessao-core.js";

const CHAVE = b64url(crypto.getRandomValues(new Uint8Array(32)));
const DEV = { id: "33333333-3333-4333-8333-333333333333", alias: "0123456789ab", name: "Mac da Ana", user: "ana", platform: "darwin", app: "meu-bot-staging", versao: "0.79.0" };

test("base64url ida e volta; segredo tem 43 caracteres sem padding", () => {
  const b = new Uint8Array([0, 1, 250, 251, 255]);
  assert.deepEqual([...deB64url(b64url(b))], [...b]);
  assert.equal(deB64url("a+b"), null);
  assert.match(segredo(), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(segredo(), segredo());
});

test("PKCE S256: challenge = base64url(sha256(verifier)); fora do formato não confere", async () => {
  const verifier = segredo(32) + segredo(32);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  assert.equal(await pkceConfere(verifier, challenge), true);
  assert.equal(await pkceConfere(`${verifier}x`, challenge), false);
  assert.equal(await pkceConfere("curto", challenge), false);
  assert.equal((await sha256Hex("abc")).length, 64);
});

test("JWT HS256: assina e verifica; vencido, outra chave ou mexido não passam", async () => {
  const agora = 1_800_000_000;
  const t = await assinarJwt({ sub: "c1", sid: "s1", dev: null, adm: null, iat: agora, exp: agora + 3600 }, CHAVE);
  const c = await verificarJwt(t, CHAVE, agora + 10);
  assert.equal(c.sub, "c1"); assert.equal(c.sid, "s1");
  assert.equal(await verificarJwt(t, CHAVE, agora + 3601), null, "vencido");
  assert.equal(await verificarJwt(t, b64url(crypto.getRandomValues(new Uint8Array(32))), agora), null, "outra chave");
  const [h, p, s] = t.split(".");
  assert.equal(await verificarJwt(`${h}.${p}x.${s}`, CHAVE, agora), null, "payload mexido");
  assert.equal(await verificarJwt("lixo", CHAVE, agora), null);
  await assert.rejects(assinarJwt({ exp: 1 }, "curta"), /32 bytes/);
});

test("validaPedidoSessao: campos do app e o idToken no formato de JWT", () => {
  const ok = validaPedidoSessao({ idToken: "a.b.c", state: segredo(), challenge: segredo(), esquema: "meu-bot-staging", app: "meu-bot-staging", v: "0.79.0" });
  assert.equal(ok.esquema, "meu-bot-staging"); assert.equal(ok.app, "meu-bot-staging"); assert.equal(ok.versao, "0.79.0");
  assert.equal(validaPedidoSessao({ idToken: "a.b.c", state: segredo(), challenge: segredo(), esquema: "meu-bot" }).app, null, "app é opcional");
  assert.equal(validaPedidoSessao({ idToken: "a.b.c", state: segredo(), challenge: segredo(), esquema: "meu-bot", metodo: "emailLink" }).metodo, "emailLink");
  assert.equal(validaPedidoSessao({ idToken: "a.b.c", state: segredo(), challenge: segredo(), esquema: "meu-bot", metodo: "facebook" }).metodo, null, "método fora da lista é ignorado");
  assert.equal(validaPedidoSessao({ idToken: "a.b.c", state: segredo(), challenge: segredo(), esquema: "meu-bot", org: "coflow" }).org, "coflow");
  assert.equal(validaPedidoSessao({ idToken: "a.b.c", state: segredo(), challenge: segredo(), esquema: "meu-bot", org: "" }).org, null, "org vazia é como ausente");
  assert.match(validaPedidoSessao({ idToken: "a.b.c", state: segredo(), challenge: segredo(), esquema: "meu-bot", org: "Co Flow" }).erro, /org/);
  assert.match(validaPedidoSessao({ idToken: "x", state: segredo(), challenge: segredo(), esquema: "meu-bot" }).erro, /idToken/);
  assert.match(validaPedidoSessao({ idToken: "a.b.c", state: "s", challenge: segredo(), esquema: "meu-bot" }).erro, /state/);
  assert.match(validaPedidoSessao({ idToken: "a.b.c", state: segredo(), challenge: "c", esquema: "meu-bot" }).erro, /challenge/);
  assert.match(validaPedidoSessao({ idToken: "a.b.c", state: segredo(), challenge: segredo(), esquema: "Meu Bot" }).erro, /esquema/);
  assert.match(validaPedidoSessao("x").erro, /corpo/);
});

test("validaDevice e validaPedidoToken: uuid ou alias, campos livres sem controle, grant code|refresh", () => {
  const d = validaDevice(DEV);
  assert.equal(d.id, DEV.id); assert.equal(d.alias, DEV.alias); assert.equal(d.name, "Mac da Ana");
  assert.equal(validaDevice({ ...DEV, alias: undefined }).alias, null);
  assert.match(validaDevice({ ...DEV, id: "nope" }).erro, /id do device/);
  assert.match(validaDevice({ ...DEV, alias: "zz" }).erro, /alias/);
  assert.match(validaDevice({ ...DEV, app: "outro" }).erro, /app ou versão/);
  assert.equal(validaDevice({ ...DEV, name: "a\u0007b" }).name, "", "nome com caractere de controle vira vazio");
  assert.equal(validaDevice({ ...DEV, platform: "beos" }).platform, "");
  const code = validaPedidoToken({ grant: "code", code: segredo(), verifier: segredo(32) + segredo(32), device: DEV });
  assert.equal(code.grant, "code"); assert.equal(code.device.id, DEV.id);
  assert.match(validaPedidoToken({ grant: "code", code: "x", verifier: segredo(32) + segredo(32), device: DEV }).erro, /code/);
  assert.match(validaPedidoToken({ grant: "code", code: segredo(), verifier: "curto", device: DEV }).erro, /verifier/);
  assert.equal(validaPedidoToken({ grant: "refresh", refresh: segredo() }).grant, "refresh");
  const web = validaPedidoToken({ grant: "web", code: segredo(), verifier: segredo(32) + segredo(32) });
  assert.equal(web.grant, "web"); assert.equal("device" in web, false, "o console não tem device");
  assert.match(validaPedidoToken({ grant: "web", code: segredo(), verifier: "curto" }).erro, /verifier/);
  assert.match(validaPedidoToken({ grant: "senha" }).erro, /grant/);
});

test("admitirDevice: ativo continua ativo; novo e pendente entram quando cabem no limite", () => {
  assert.equal(admitirDevice(null, 0, 1), "active");
  assert.equal(admitirDevice(null, 1, 1), "pending");
  assert.equal(admitirDevice(null, 1, 2), "active");
  assert.equal(admitirDevice({ status: "pending" }, 1, 2), "active", "pendente entra sozinho quando o limite passa a caber");
  assert.equal(admitirDevice({ status: "pending" }, 2, 2), "pending", "sem vaga, continua pendente");
  assert.equal(admitirDevice({ status: "active" }, 9, 1), "active", "ativo não vira pendente ao reaparecer");
});

test("janelaMinuto: minuto corrente em ISO", () => {
  assert.equal(janelaMinuto(Date.parse("2026-11-06T12:34:56Z")), "2026-11-06T12:34");
});

test("validaPatchLicenca: só os campos mandados, nos formatos; validaBusca limpa", () => {
  const p = validaPatchLicenca({ plan: "pro", expiresAt: "2027-01-31", deviceLimit: 3, produtos: ["meu-bot-finance", "meu-bot-finance"], pagamento: { instrucoes: "Pix 123", link: null } });
  assert.deepEqual(p, { plan: "pro", expiresAt: "2027-01-31T00:00:00.000Z", deviceLimit: 3, produtos: ["meu-bot-finance"], pagamento: { instrucoes: "Pix 123", link: null } });
  assert.deepEqual(validaPatchLicenca({ expiresAt: null, pagamento: null }), { expiresAt: null, pagamento: null });
  assert.match(validaPatchLicenca({ plan: "ouro" }).erro, /plan/);
  assert.match(validaPatchLicenca({ deviceLimit: 0 }).erro, /deviceLimit/);
  assert.match(validaPatchLicenca({ expiresAt: "amanhã" }).erro, /expiresAt/);
  assert.match(validaPatchLicenca({ produtos: ["Maiúsculo"] }).erro, /produtos/);
  assert.match(validaPatchLicenca({ pagamento: { instrucoes: "x", link: "ftp://x" } }).erro, /link/);
  assert.match(validaPatchLicenca({}).erro, /nada/);
  assert.equal(validaBusca("  Ana@Exemplo.com "), "ana@exemplo.com");
  assert.equal(validaBusca("a\u0007b"), ""); assert.equal(validaBusca(5), "");
});

test("validaPatchPerfil: só nome, sobrenome e dadosUso; aparado; vazio limpa; controle e dadosUso não-booleano recusam", () => {
  assert.deepEqual(validaPatchPerfil({ nomeProprio: "  Ana ", sobrenome: "", dadosUso: false, cidade: "Rio", outro: 1 }), { nomeProprio: "Ana", sobrenome: null, dadosUso: false }, "campos que saíram (cidade…) são ignorados");
  assert.deepEqual(validaPatchPerfil({ sobrenome: null }), { sobrenome: null });
  assert.match(validaPatchPerfil({ nomeProprio: "a\u0007b" }).erro, /nomeProprio/);
  assert.match(validaPatchPerfil({ sobrenome: "x".repeat(81) }).erro, /sobrenome/);
  assert.match(validaPatchPerfil({ dadosUso: "sim" }).erro, /dadosUso/);
  assert.match(validaPatchPerfil({}).erro, /nada/); assert.match(validaPatchPerfil({ outro: 1 }).erro, /nada/);
  assert.match(validaPatchPerfil("x").erro, /corpo/);
});

test("nomeExibicao: o digitado vence; só nome próprio serve; senão o do login; nada vira null", () => {
  assert.equal(nomeExibicao({ nome_proprio: "Ana", sobrenome: "Souza", nome: "Ana S. (Google)" }), "Ana Souza");
  assert.equal(nomeExibicao({ nome_proprio: " Ana ", sobrenome: null, nome: "Outro" }), "Ana");
  assert.equal(nomeExibicao({ nome_proprio: null, sobrenome: "", nome: "Do Login" }), "Do Login");
  assert.equal(nomeExibicao({ nome_proprio: null, sobrenome: null, nome: null }), null);
});

test("provedores: JSON com defesa, união ordenada, e o metodo da página desempata password/emailLink", () => {
  assert.deepEqual(parseProvedores('["password","google.com","lixo","google.com"]'), ["google.com", "password"]);
  assert.deepEqual(parseProvedores("{"), []); assert.deepEqual(parseProvedores(null), []);
  assert.equal(unirProvedores('["google.com"]', ["password", "emailLink"]), '["emailLink","google.com","password"]');
  assert.equal(unirProvedores("lixo", ["facebook.com", "google.com"]), '["google.com"]');
  assert.deepEqual(provedoresDoLogin(["password"], "emailLink"), ["emailLink"]);
  assert.deepEqual(provedoresDoLogin(["password"], "password"), ["password"]);
  assert.deepEqual(provedoresDoLogin(["google.com", "password"], null), ["google.com", "password"]);
});

test("validaSenhaNova: 8 a 128 sem caracteres de controle", async () => {
  const { validaSenhaNova } = await import("../dist/sessao-core.js");
  assert.equal(validaSenhaNova("abcdefgh"), "abcdefgh"); assert.equal(validaSenhaNova("curta"), null);
  assert.equal(validaSenhaNova("a".repeat(129)), null); assert.equal(validaSenhaNova("abc\u0007defgh"), null); assert.equal(validaSenhaNova(8), null);
});

test("decidirLiberarDevice: com vaga ativa; no limite só com o admin pedindo para subir, e só o bastante", () => {
  assert.deepEqual(decidirLiberarDevice("active", 1, 1, false), { acao: "ja-ativo" });
  assert.deepEqual(decidirLiberarDevice("pending", 1, 2, false), { acao: "liberar", novoLimite: null });
  const cheio = decidirLiberarDevice("pending", 2, 2, false);
  assert.equal(cheio.noLimite, true); assert.match(cheio.erro, /2 de 2/);
  assert.deepEqual(decidirLiberarDevice("pending", 2, 2, true), { acao: "liberar", novoLimite: 3 });
  assert.deepEqual(decidirLiberarDevice("pending", 3, 1, true), { acao: "liberar", novoLimite: 4 }, "limite abaixo dos ativos: cabe este e nada além");
  assert.equal(decidirLiberarDevice("pending", 50, 50, true).noLimite, true, "não passa do teto");
});
