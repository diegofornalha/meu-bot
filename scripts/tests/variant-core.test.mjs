import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { resolveVariant, capsFor, titleFor, userDataNameFor, PRODUTOS, produtoDe, CAPS_DE_PLATAFORMA } = createRequire(import.meta.url)("../../dist/main/app/variant-core.js");

test("resolveVariant: em dev manda a variável de ambiente; empacotado manda o variant.json", () => {
  assert.equal(resolveVariant({ packaged: false, env: "admin", variantJson: undefined }), "admin");
  assert.equal(resolveVariant({ packaged: false, env: undefined, variantJson: undefined }), "client");
  assert.equal(resolveVariant({ packaged: false, env: "qualquer", variantJson: { variant: "admin" } }), "client");
  assert.equal(resolveVariant({ packaged: true, env: "admin", variantJson: undefined }), "client", "empacotado ignora o ambiente");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: "admin" } }), "admin");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: "client" } }), "client");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: "lixo" }), "client");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: null }), "client");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: 1 } }), "client");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: "crm" } }), "client", "o antigo meu-bot-crm saiu da tabela");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: "vendas" } }), "client", "produto que não está na tabela cai no cliente");
});

const BOOLS = ["chat", "pair", "login", "manageWa", "tunnel", "install", "supportClient", "supportAdmin", "navegador"];

test("capsFor: o admin só tem supportAdmin; o cliente tem tudo menos isso (o CRM próprio é pela licença, não por caps)", () => {
  const admin = capsFor("admin");
  const client = capsFor("client");
  assert.equal(admin.variant, "admin");
  assert.equal(client.variant, "client");
  for (const k of BOOLS) {
    assert.equal(admin[k], k === "supportAdmin", `admin.${k}`);
    assert.equal(client[k], k !== "supportAdmin", `client.${k}`);
  }
  assert.equal(client.planoExigido, "free"); assert.equal(admin.planoExigido, "free");
  assert.equal(client.produto, "meu-bot"); assert.equal(admin.produto, "meu-bot-admin");
  assert.deepEqual(Object.keys(admin).sort(), Object.keys(client).sort());
});

// De que capacidade do produto cada uma depende fora do Windows (null = de todos os apps, como os canais IPC comuns dela).
const BASE_DA_PLATAFORMA = { hostLocal: null, terminalLocal: null, atalhosMesa: null, agenteNavegador: "navegador", controleRemoto: null, telaComputador: "chat" };

test("capsFor: no macOS (e sem dizer a plataforma) as capacidades de plataforma valem onde o produto já permitia, em todos os produtos", () => {
  assert.deepEqual([...CAPS_DE_PLATAFORMA].sort(), Object.keys(BASE_DA_PLATAFORMA).sort());
  for (const p of PRODUTOS) {
    const mac = capsFor(p.variant, "1.0.0", "darwin");
    assert.deepEqual(capsFor(p.variant, "1.0.0"), mac, `${p.variant}: o padrão é o macOS`);
    assert.deepEqual(capsFor(p.variant, "1.0.0", "linux"), mac, `${p.variant}: o Linux segue o macOS`);
    for (const k of CAPS_DE_PLATAFORMA) {
      const base = BASE_DA_PLATAFORMA[k];
      assert.equal(mac[k], base === null ? true : p.caps[base], `${p.variant}.${k}`);
      assert.equal(k in p.caps, false, `${k} é derivada: não entra na tabela do produto`);
    }
    // O resto é a linha do produto, sem mexer.
    for (const [k, v] of Object.entries(p.caps)) assert.deepEqual(mac[k], v, `${p.variant}.${k}`);
  }
});

test("capsFor: no Windows as seis capacidades de plataforma ficam desligadas e o resto é igual ao macOS", () => {
  for (const p of PRODUTOS) {
    const mac = capsFor(p.variant, "1.0.0", "darwin"), win = capsFor(p.variant, "1.0.0", "win32");
    for (const k of CAPS_DE_PLATAFORMA) assert.equal(win[k], false, `${p.variant}.${k}`);
    assert.deepEqual({ ...win, ...Object.fromEntries(CAPS_DE_PLATAFORMA.map((k) => [k, mac[k]])) }, mac, `${p.variant}: só as de plataforma mudam`);
  }
});

test("meu-bot traz as duas extensões e funde a pasta do antigo meu-bot-crm", () => {
  const client = produtoDe("client");
  assert.deepEqual(client.extensoes, ["extensao-crm", "extensao-autenticador"]);
  assert.equal(client.fundeDe, "meu-bot-crm");
  assert.equal(PRODUTOS.some((p) => p.nome === "meu-bot-crm"), false, "o app meu-bot-crm saiu: o CRM vem no meu-bot");
});

test("titleFor e userDataNameFor", () => {
  assert.equal(titleFor("admin"), "meu-bot-admin-gestao");
  assert.equal(titleFor("client"), "meu-bot");
  assert.equal(userDataNameFor("client"), null, "o meu-bot fica na pasta padrão do Electron");
  assert.equal(userDataNameFor("admin"), "meu-bot-admin-gestao");
});

test("PRODUTOS: ids, nomes e bundle ids únicos; bundle id = local.<nome>; ícone .icns", () => {
  const ids = PRODUTOS.map((p) => p.variant), nomes = PRODUTOS.map((p) => p.nome), bundles = PRODUTOS.map((p) => p.bundleId);
  assert.equal(new Set(ids).size, ids.length); assert.equal(new Set(nomes).size, nomes.length); assert.equal(new Set(bundles).size, bundles.length);
  for (const p of PRODUTOS) {
    assert.equal(p.bundleId, p.canal === "staging" ? `local.${p.nome.replace(/-staging$/, "")}.staging` : `local.${p.nome}`);
    assert.match(p.icone, /^assets\/icon(-[a-z]+)*\.icns$/);
    for (const e of p.extensoes) assert.doesNotMatch(e, /[\/]/, "pasta da extensão sem barras");
    assert.equal(produtoDe(p.variant), p);
  }
  assert.throws(() => produtoDe("vendas"));
});

test("canal staging: as linhas saem da estável (nome, bundle, ícone, dados, porta, herança, licença)", () => {
  const st = produtoDe("client-staging");
  assert.deepEqual([st.nome, st.bundleId, st.icone, st.userData, st.herdaDe, st.portaLocal, st.licenca, st.canal], ["meu-bot-staging", "local.meu-bot.staging", "assets/icon-staging.icns", "meu-bot-staging", "meu-bot", 8791, "meu-bot", "staging"]);
  assert.deepEqual(st.extensoes, produtoDe("client").extensoes, "as extensões do estável");
  assert.equal(st.fundeDe, "meu-bot-crm-staging", "funde a pasta do antigo crm-staging");
  assert.equal(PRODUTOS.some((p) => p.variant === "crm-staging"), false, "o crm não tem staging");
  assert.equal(PRODUTOS.some((p) => p.variant === "admin-staging"), false, "o admin é só estável");
  // A licença libera pelo produto do estável; o nome do app e o título são outros.
  const c = capsFor("client-staging", "0.2.0-staging.3");
  assert.deepEqual([c.produto, c.canal, c.nome, c.titulo], ["meu-bot", "staging", "meu-bot-staging", "meu-bot-staging 0.2.0-staging.3"]);
  assert.equal(capsFor("client", "0.2.0").titulo, "meu-bot", "o estável não mostra a versão no título");
  assert.equal(resolveVariant({ packaged: true, env: undefined, variantJson: { variant: "crm-staging" } }), "client", "variante que saiu da tabela cai no cliente");
  assert.equal(resolveVariant({ packaged: false, env: "client-staging", variantJson: undefined }), "client-staging");
  // Portas: os apps que podem abrir juntos com o estável não dividem a dele.
  assert.notEqual(st.portaLocal, produtoDe("client").portaLocal);
});

test("meu-bot-finance-staging: cópia do staging com nome, ícone, dados e porta próprios; a licença continua a do meu-bot", () => {
  const f = produtoDe("finance-staging");
  assert.deepEqual([f.nome, f.bundleId, f.icone, f.userData, f.herdaDe, f.canal, f.licenca, f.fundeDe], ["meu-bot-finance-staging", "local.meu-bot-finance.staging", "assets/icon-finance-staging.icns", "meu-bot-finance-staging", "meu-bot-staging", "staging", "meu-bot", null]);
  const portas = PRODUTOS.filter((p) => p.caps.chat).map((p) => p.portaLocal);
  assert.equal(new Set(portas).size, portas.length, "meu-bot, staging e finance-staging abrem juntos");
  assert.deepEqual(f.caps, produtoDe("client").caps);
});
