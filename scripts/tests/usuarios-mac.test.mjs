import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const m = require("../../dist/main/usuarios-mac/usuarios-mac-core.js");
const { capsFor, produtoDe, nomesReservados } = require("../../dist/main/app/variant-core.js");
const { MAC_CHANNELS, ADMIN_CHANNELS, CLIENT_CHANNELS } = require("../../dist/main/ipc/ipc-policy.js");
const here = dirname(fileURLToPath(import.meta.url));

test("nome novo: regra do Linux, reservados do macOS e conta que já existe", () => {
  assert.equal(m.nomeNovoInvalido("meu-box", ["box", "lv-box"]), null);
  assert.match(m.nomeNovoInvalido("lv-box", ["box", "lv-box"]), /já existe/);
  for (const n of ["guest", "root", "svc", "admin"]) assert.match(m.nomeNovoInvalido(n, []), /reservado/, n);
  for (const n of ["Maria", "1abc", "a", "x y", "_spotlight", "a;rm"]) assert.match(m.nomeNovoInvalido(n, []), /nome inválido/, n);
});

test("senha: a gerada é forte e sem ambiguidade; a escolhida tem regra que não quebra o script", () => {
  const s = m.senhaDe(new Uint8Array(32).map((_, i) => i * 37));
  assert.match(s, /^[A-Za-z0-9]{24}$/);
  assert.doesNotMatch(s, /[0O1lI]/, "sem caracteres que se confundem");
  assert.throws(() => m.senhaDe(new Uint8Array(4)), /insuficientes/);
  assert.equal(m.senhaEscolhidaInvalida("minha senha 2026!"), null);
  assert.match(m.senhaEscolhidaInvalida("curta"), /8 a 64/);
  for (const x of ["tem'aspas", "barra\\invertida", "acentuação1", "linha\nnova"]) assert.match(m.senhaEscolhidaInvalida(x), /não pode/, x);
});

test("lista: lê a saída do dscl, protege você, quem está na tela, sistema e serviço", () => {
  const b64 = (s) => Buffer.from(s).toString("base64");
  const out = ["ATUAL=box", "TELA=lv-box", `U\tbox\t501\t1\t${b64("Box")}`, `U\tsvc\t502\t0\t${b64("svc")}`, `U\tlv-box\t507\t1\t${b64("LV")}`, `U\tbianca-box\t505\t1\t${b64("bianca-box")}`, "U\t../x\t9\t1\t", "lixo"].join("\n");
  const v = m.lerUsuariosMac(out);
  assert.equal(v.atual, "box"); assert.equal(v.naTela, "lv-box");
  assert.deepEqual(v.usuarios.map((u) => [u.nome, u.apelido, u.admin, u.protegida]), [
    ["box", "Box", true, "é a sua conta"], ["svc", "", false, "conta de serviço deste Mac"], ["bianca-box", "", true, null], ["lv-box", "LV", true, "está usando o Mac agora"],
  ]);
  assert.equal(m.lerUsuariosMac("ATUAL=box\nTELA=root\n").naTela, null, "tela de login (root) não protege ninguém");
});

test("criar: conta administrador com a senha só dentro do script, home e o meu-bot clonado na mesa como a conta nova", () => {
  const sh = m.criarMacSh({ nome: "meu-box", senha: "Abcdefghjk23456789mnpqrs" });
  assert.match(sh, /sysadminctl -addUser "meu-box" -fullName "meu-box" -shell \/bin\/zsh -home "\/Users\/meu-box" -admin -password 'Abcdefghjk23456789mnpqrs'/);
  assert.match(m.criarMacSh({ nome: "meu-box", senha: "minha senha 2026!" }), /-password 'minha senha 2026!'/, "a escolhida também vai");
  assert.match(sh, /createhomedir -c -u "meu-box"/);
  assert.match(sh, /sudo -u "meu-box" -H git clone -q 'https:\/\/github\.com\/diegofornalha\/meu-bot\.git' "\/Users\/meu-box\/Desktop\/meu-bot"/);
  assert.match(sh, /xcode-select -p/, "sem as ferramentas do Xcode, não dispara o instalador do git");
  assert.ok(sh.indexOf("CRIADO=") < sh.indexOf("git clone"), "o clone que falhar não desfaz a conta");
  assert.ok(sh.indexOf("cd /") < sh.indexOf("git clone"), "o git como a conta nova parte de uma pasta que ela lê");
  assert.throws(() => m.criarMacSh({ nome: "meu-box", senha: "curta" }), /senha/);
  assert.throws(() => m.criarMacSh({ nome: "meu-box", senha: "x'; rm -rf /; '" }), /senha/);
  assert.throws(() => m.criarMacSh({ nome: "x';rm -rf /;'", senha: "Abcdefghjk23456789mnpqrs" }), /nome/);
  assert.throws(() => m.criarMacSh({ nome: "meu-box", senha: "Abcdefghjk23456789mnpqrs", repo: "https://evil.example/x.git" }), /repositório/);
});

test("apagar e apelido: nomes e textos que não quebram o script", () => {
  assert.match(m.apelidoMacSh("meu-box", "Meu Box"), /RealName 'Meu Box'/);
  assert.throws(() => m.apelidoMacSh("meu-box", "x'; rm -rf ~"), /apelido/);
  assert.throws(() => m.apelidoMacSh("meu-box", ""), /apelido/);
  assert.throws(() => m.saidaMac("ERRO=já existe\n", /CRIADO/, "?"), /já existe/);
  assert.throws(() => m.saidaMac("nada\n", /CRIADO/, "sem confirmação"), /sem confirmação/);
});

test("variante meu-bot-admin-mac: só a janela das contas; canais próprios, só no preload dela", () => {
  const c = capsFor("admin-mac");
  assert.deepEqual([c.usuariosMac, c.chat, c.supportAdmin, c.tunnel], [true, false, false, false]);
  for (const v of ["client", "client-staging", "finance-staging", "admin"]) assert.equal(capsFor(v).usuariosMac, false, v);
  assert.equal(produtoDe("admin-mac").nome, "meu-bot-admin-mac");
  assert.ok(nomesReservados().has("meu-bot-admin-mac"));
  for (const ch of MAC_CHANNELS) assert.ok(!ADMIN_CHANNELS.includes(ch) && !CLIENT_CHANNELS.includes(ch), ch);
  const src = readFileSync(join(here, "..", "..", "dist", "preload", "usuarios-mac-preload.js"), "utf8");
  const chans = [...src.matchAll(/ipcRenderer\.(?:invoke|send)\("([a-z:-]+)"/g)].map((x) => x[1]);
  assert.deepEqual(chans.sort(), [...MAC_CHANNELS].sort());
});

test("apagar: o comando do Terminal (sudo sysadminctl) só com nome válido, e diz no fim se a conta saiu", () => {
  const c = m.apagarNoTerminalCmd("meu-box");
  assert.match(c, /sudo sysadminctl -deleteUser meu-box;/);
  assert.match(c, /✓ conta meu-box apagada/);
  for (const n of ["root", "svc", "x;rm -rf ~", "Meu"]) assert.throws(() => m.apagarNoTerminalCmd(n), /nome inválido/, n);
});

test("criar: o Claude Code global vai junto (copia a versão de quem administra só quando falta ou é outra)", () => {
  const sh = m.criarMacSh({ nome: "meu-box", senha: "Abcdefghjk23456789mnpqrs", claude: "/Users/box/.local/share/claude/versions/2.1.312" });
  assert.match(sh, /cmp -s '\/Users\/box\/\.local\/share\/claude\/versions\/2\.1\.312' \/usr\/local\/bin\/claude/);
  assert.match(sh, /install -m 755 -o root -g wheel/);
  assert.doesNotMatch(m.criarMacSh({ nome: "meu-box", senha: "Abcdefghjk23456789mnpqrs", claude: null }), /CLAUDE=/);
  assert.throws(() => m.criarMacSh({ nome: "meu-box", senha: "Abcdefghjk23456789mnpqrs", claude: "/tmp/x'; rm -rf /" }), /Claude Code/);
});

test("usuário na VM (meu-bot-admin e admin-mac): todas as chaves entram, inclusive a última; nome e chave validados", () => {
  const c = require("../../dist/main/admin/usuarios-core.js");
  const k1 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExemploUmExemploUmExemplo meu-box@meu-bot-admin-mac";
  const k2 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExemploDoisExemploDois meu-bot-admin";
  const sh = c.usuarioComChavesSh("meu-box", [k1, k2], "chaves");
  const b64 = /printf '%s' '([^']+)'/.exec(sh)[1];
  assert.equal(Buffer.from(b64, "base64").toString("utf8"), `${k1}\n${k2}\n`, "termina com quebra: o read não pula a última");
  assert.match(sh, /ACAO=JAEXISTIA/);
  assert.match(c.usuarioComChavesSh("meu-box", [k1], "erro"), /ERRO=já existe um usuário/);
  assert.throws(() => c.usuarioComChavesSh("root", [k1], "erro"), /nome inválido/);
  assert.throws(() => c.usuarioComChavesSh("meu-box", ["ssh-ed25519 x'; rm -rf /"], "erro"), /chave/);
});

test("conta nova leva os clients do Google (issue #36): para o config/ do clone e para a pasta de dados, como ela, 0600", async () => {
  const { criarMacSh, oauthContaNovaSh } = await import("../../dist/main/usuarios-mac/usuarios-mac-core.js");
  const b64 = Buffer.from('{"installed":{}}').toString("base64");
  const sh = oauthContaNovaSh("ana", [{ nome: "google-oauth.json", base64: b64 }]);
  assert.match(sh, /mktemp \/tmp\/meu-bot-oauth\./, "temporário que a conta nova consegue ler");
  assert.match(sh, /sudo -u "ana" -H sh -c 'umask 077;/);
  assert.match(sh, /Desktop\/meu-bot\/config/); assert.match(sh, /Library\/Application Support\/meu-bot/);
  assert.match(sh, /rm -f "\$T"\necho "OAUTH=ok"$/);
  assert.equal(oauthContaNovaSh("ana", []), 'echo "OAUTH=sem-origem"');
  assert.throws(() => oauthContaNovaSh("ana", [{ nome: "outro.json", base64: b64 }]), /inválido/);
  assert.throws(() => oauthContaNovaSh("ana", [{ nome: "google-oauth.json", base64: "x' ; rm -rf / ; '" }]), /inválido/);
  const tudo = criarMacSh({ nome: "ana", senha: "Abcdef12345!xyz", oauth: [{ nome: "google-oauth.json", base64: b64 }] });
  assert.ok(tudo.indexOf("REPO=") < tudo.indexOf("OAUTH=ok"), "depois do clone, para cair também no config/ dele");
});
