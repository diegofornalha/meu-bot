import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { normalizeSettings, defaultSettings } = createRequire(import.meta.url)("../../dist/main/app/settings-normalize.js");

test("arquivo v2 migra sshHost para lastHost e descarta sshHost", () => {
  const s = normalizeSettings({ version: 1, sshHost: "colima", backendModel: "rene-dm", backendPort: 8080 });
  assert.equal(s.lastHost, "colima");
  assert.equal("sshHost" in s, false);
  assert.equal(s.backendModel, "rene-dm");
});

test("lastHost explícito vence sshHost; inválido vira null", () => {
  assert.equal(normalizeSettings({ lastHost: "local", sshHost: "colima" }).lastHost, "local");
  assert.equal(normalizeSettings({ sshHost: "bad host!" }).lastHost, null);
  assert.equal(normalizeSettings(null).lastHost, null);
});

test("defaults e modelo por máquina; a posição antiga das janelas (windowBounds) é descartada", () => {
  const s = normalizeSettings({ defaultModelByHost: { colima: "agente", "x y": "agente", local: "nope" }, windowBounds: { colima: { x: 1, y: 2, width: 800, height: 600 } } });
  assert.deepEqual(s.defaultModelByHost, { colima: "agente" });
  assert.equal("windowBounds" in s, false, "as janelas nascem no canto (app/janela-core.ts), sem memória de posição");
  assert.deepEqual(normalizeSettings({}), defaultSettings());
});

test("porta por máquina: só hosts válidos com porta válida; padrão continua a global", () => {
  const s = normalizeSettings({ backendPort: 8080, backendPortByHost: { "agente-openclaw": 8081, "x y": 8082, colima: 0, vm: "8083", outra: 70000 } });
  assert.deepEqual(s.backendPortByHost, { "agente-openclaw": 8081 });
  assert.equal(s.backendPort, 8080);
  assert.deepEqual(normalizeSettings({ backendPortByHost: "nope" }).backendPortByHost, {});
  assert.deepEqual(defaultSettings().backendPortByHost, {});
});

test("onboarding: pendente por padrão, inválido vira pendente, done/skipped ficam", () => {
  assert.equal(normalizeSettings({}).onboarding, "pending");
  assert.equal(normalizeSettings({ onboarding: "x" }).onboarding, "pending");
  assert.equal(normalizeSettings({ onboarding: "done" }).onboarding, "done");
  assert.equal(normalizeSettings({ onboarding: "skipped" }).onboarding, "skipped");
});

test("openDirect: true por padrão, respeita false", () => {
  assert.equal(normalizeSettings({}).openDirect, true);
  assert.equal(normalizeSettings({ openDirect: false }).openDirect, false);
  assert.equal(normalizeSettings({ openDirect: "x" }).openDirect, true);
});

test("abaFixa: padrão até escolher (Tutoriais ou a do produto); conversa desafixa; lixo volta ao padrão", () => {
  assert.equal(normalizeSettings({}).abaFixa, "padrao");
  assert.equal(defaultSettings().abaFixa, "padrao");
  for (const v of ["conversa", "tutoriais", "acervo", "conta-google", "financas", "inspector", "navegador"]) assert.equal(normalizeSettings({ abaFixa: v }).abaFixa, v);
  assert.equal(normalizeSettings({ abaFixa: "terminal" }).abaFixa, "padrao");
  assert.equal(normalizeSettings({ abaFixa: 3 }).abaFixa, "padrao");
});

test("hostNames: apelidos válidos por host; lixo fora", async () => {
  const { normalizeHostNames } = await import("../../dist/main/app/settings-normalize.js");
  assert.deepEqual(normalizeHostNames({ colima: "  VM de  teste ", "a b": "x", agente: "", n: 3 }), { colima: "VM de teste" });
  assert.deepEqual(normalizeHostNames(["colima"]), {});
  assert.equal(normalizeHostNames({ vm: "x".repeat(80) }).vm.length, 40);
  assert.deepEqual(normalizeSettings({}).hostNames, {});
});

test("navFavoritos: por máquina válida; url http(s), título ≤ 60, url repetida fica com a primeira, id ruim ganha outro", () => {
  const s = normalizeSettings({ navFavoritos: { colima: [
    { id: "ok1", titulo: "  Pipeline   X ", url: "https://a.com/p" },
    { id: "ok2", titulo: "repetido", url: "https://a.com/p" },
    { id: "bad id!", titulo: "x".repeat(80), url: "http://b.com" },
    { id: "ok3", titulo: "sem esquema", url: "ftp://c" },
  ], "x y": [{ id: "z", titulo: "", url: "https://d.com" }] } });
  assert.deepEqual(Object.keys(s.navFavoritos), ["colima"]);
  assert.equal(s.navFavoritos.colima.length, 2);
  assert.deepEqual(s.navFavoritos.colima[0], { id: "ok1", titulo: "Pipeline X", url: "https://a.com/p" });
  assert.equal(s.navFavoritos.colima[1].titulo.length, 60);
  assert.notEqual(s.navFavoritos.colima[1].id, "bad id!");
  assert.deepEqual(normalizeSettings({ navFavoritos: [] }).navFavoritos, {});
});

test("navEspacos: ids e nomes válidos, urls http(s), ícone http(s)/data, ativo existente; lixo cai fora", () => {
  const { normalizeNavWorkspaces } = createRequire(import.meta.url)("../../dist/main/app/settings-normalize.js");
  const w = normalizeNavWorkspaces({ ativo: "nope", lista: [
    { id: "w1", nome: "  ACME  ", servicos: [{ id: "s1", nome: "", url: "https://mail.google.com/", icone: "javascript:x" }, { id: "s1", nome: "dup", url: "https://a.com" }, { id: "s2", nome: "ftp", url: "ftp://x" }] },
    { id: "bad id!", nome: "x", servicos: [] },
    { id: "w2", nome: "", servicos: [] },
  ] });
  assert.deepEqual(w, { ativo: "w1", lista: [{ id: "w1", nome: "ACME", servicos: [{ id: "s1", nome: "mail.google.com", url: "https://mail.google.com/", icone: null }] }] });
  assert.deepEqual(normalizeNavWorkspaces("nope"), { ativo: null, lista: [] });
  const s = normalizeSettings({ navEspacos: { colima: { ativo: "a", lista: [{ id: "a", nome: "Site", servicos: [] }] }, "x y": { lista: [] }, vazio: { lista: [] } } });
  assert.deepEqual(Object.keys(s.navEspacos), ["colima"]);
  assert.equal(s.navEspacos.colima.ativo, "a");
  // Oculto: fica na lista (nada se apaga), mas nunca é o ativo; sem visível, ativo é null.
  const h = normalizeNavWorkspaces({ ativo: "x", lista: [{ id: "x", nome: "Oculto", servicos: [], oculto: true }, { id: "y", nome: "Vivo", servicos: [] }] });
  assert.deepEqual(h, { ativo: "y", lista: [{ id: "x", nome: "Oculto", servicos: [], oculto: true }, { id: "y", nome: "Vivo", servicos: [] }] });
  assert.equal(normalizeNavWorkspaces({ lista: [{ id: "x", nome: "Oculto", servicos: [], oculto: true }] }).ativo, null);
});

test("zoomLevel: inteiro -8..8 fica; o resto vira 0", () => {
  assert.equal(normalizeSettings({ zoomLevel: 3 }).zoomLevel, 3);
  assert.equal(normalizeSettings({ zoomLevel: -8 }).zoomLevel, -8);
  for (const bad of [9, -9, 1.5, "2", null]) assert.equal(normalizeSettings({ zoomLevel: bad }).zoomLevel, 0, String(bad));
  assert.equal(defaultSettings().zoomLevel, 0);
});

test("atualizarOcioso: ligado por padrão (como o Grok Bot); só um boolean muda", () => {
  assert.equal(normalizeSettings({}).atualizarOcioso, true);
  assert.equal(normalizeSettings({ atualizarOcioso: false }).atualizarOcioso, false);
  assert.equal(normalizeSettings({ atualizarOcioso: "nao" }).atualizarOcioso, true);
});

test("notificações e som: ligados por padrão; só um boolean muda", () => {
  for (const k of ["notifications", "notificacaoSom"]) {
    assert.equal(defaultSettings()[k], true, k);
    assert.equal(normalizeSettings({})[k], true, k);
    assert.equal(normalizeSettings({ [k]: false })[k], false, k);
    assert.equal(normalizeSettings({ [k]: "nao" })[k], true, k);
  }
});

test("agente do Gmail: ligado por padrão; só a lista de desligados é lembrada; a lista antiga de ligados é ignorada", () => {
  assert.deepEqual(defaultSettings().gmailAgentDesligados, []);
  const s = normalizeSettings({ version: 1, gmailAgentHosts: ["meu-root-root"], gmailAgentDesligados: ["box-2", "box-2", 7, "inválido host"] });
  assert.deepEqual(s.gmailAgentDesligados, ["box-2"]);
  assert.equal("gmailAgentHosts" in s, false);
});

test("modo de depuração: null por padrão (a variante decide); true/false gravados; lixo vira null", () => {
  assert.equal(defaultSettings().depuracao, null);
  assert.equal(normalizeSettings({ version: 1, depuracao: true }).depuracao, true);
  assert.equal(normalizeSettings({ version: 1, depuracao: false }).depuracao, false);
  assert.equal(normalizeSettings({ version: 1, depuracao: "sim" }).depuracao, null);
});

test("modelo padrão por máquina aceita o ollama-local (modo grátis, tutorial 17)", () => {
  const s = normalizeSettings({ defaultModelByHost: { local: "ollama-local", colima: "grok-4" } });
  assert.deepEqual(s.defaultModelByHost, { local: "ollama-local", colima: "grok-4" });
});
