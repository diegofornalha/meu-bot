import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { deveHerdar, entradaHerdavel, carimboDe, settingsHerdados } = createRequire(import.meta.url)("../../dist/main/app/user-data-core.js");

test("deveHerdar: só sem carimbo e sem conversas de verdade", () => {
  assert.equal(deveHerdar(false, null), true, "pasta nova");
  assert.equal(deveHerdar(false, "[]"), true); assert.equal(deveHerdar(false, '{"conversations":[]}'), true); assert.equal(deveHerdar(false, "lixo"), true);
  assert.equal(deveHerdar(false, '{"conversations":[{"id":"x","messages":[]}]}'), true, "só a conversa em branco que o app cria ao abrir");
  assert.equal(deveHerdar(false, '{"conversations":[{"id":"x","messages":[{"role":"user","text":"oi"}]}]}'), false, "já conversou: nunca sobrescreve");
  assert.equal(deveHerdar(true, null), false, "carimbo: já herdou");
});
test("entradaHerdavel: dados sim; caches, logs, backend local, travas e o que é do admin não", () => {
  for (const ok of ["settings.json", "memory.json", "conversations.json", "transcripts", "Local Storage", "Session Storage", "IndexedDB", "Partitions", "Navegador", "Preferences", "Network", "suporte.json"]) assert.equal(entradaHerdavel(ok), true, ok);
  for (const nao of ["meu-bot.log", "backend-local", "backend-local.log", "update", "SingletonLock", "SingletonSocket", "Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "GraphiteDawnCache", "GPUPersistentCache", "blob_storage", "DIPS", "DevToolsActivePort", "Crashpad", "declarative_performance_observer.db", "declarative_performance_observer.db-journal", "pessoas.json", "produtos.json", "settings.json.tmp"]) assert.equal(entradaHerdavel(nao), false, nao);
});

test("herança: carimbo por origem; o que o chaveiro cifra com o nome do app não é copiado", () => {
  assert.equal(carimboDe("meu-bot"), ".herdado-de-meu-bot", "o carimbo antigo do meu-bot-crm continua valendo");
  assert.equal(carimboDe("meu-bot-crm"), ".herdado-de-meu-bot-crm");
  assert.equal(entradaHerdavel("google-contatos.bin"), false);
  assert.equal(entradaHerdavel("tailscale-oauth.bin"), false);
  assert.equal(entradaHerdavel("google-oauth.json"), true, "o client OAuth (não cifrado) vai junto");
});

const { fundirConversas, fundirSettings, fundirMemoria, fundirGoogleWhatsapp, carimboFusao, COPIAR_SE_FALTAR } = createRequire(import.meta.url)("../../dist/main/app/user-data-core.js");
const conv = (id, updatedAt, extra = {}) => ({ id, model: "agente", host: "h", messages: [{ role: "user", content: "oi" }], createdAt: updatedAt, updatedAt, order: 0, archived: false, openAsTab: true, ...extra });
const j = (o) => JSON.stringify(o);

test("fundirConversas: união por id; id repetido fica com o updatedAt maior; ordem mantida; origem vazia = nada", () => {
  const destino = j({ version: 1, conversations: [conv("a", "2026-10-01T00:00:00Z", { order: 1 }), conv("b", "2026-10-05T00:00:00Z", { order: 2, title: "do destino" })] });
  const origem = j({ version: 1, conversations: [conv("b", "2026-10-09T00:00:00Z", { order: 2, title: "da origem" }), conv("c", "2026-10-02T00:00:00Z", { order: 3 })] });
  const r = fundirConversas(destino, origem);
  const lista = JSON.parse(r.json).conversations;
  assert.deepEqual(lista.map((c) => c.id), ["a", "b", "c"]);
  assert.equal(lista[1].title, "da origem", "mais recente vence");
  assert.deepEqual(r.vindas, ["b", "c"]);
  assert.equal(fundirConversas(destino, j({ version: 1, conversations: [conv("b", "2026-10-01T00:00:00Z", { title: "velha" })] })).vindas.length, 0, "origem mais antiga não substitui");
  assert.equal(fundirConversas(destino, null), null); assert.equal(fundirConversas(destino, "lixo"), null);
  assert.equal(JSON.parse(fundirConversas(null, origem).json).conversations.length, 2, "destino sem arquivo recebe tudo");
});

test("fundirSettings: origem prevalece; mapas por máquina unem; listas unem (favoritos por url); onboarding done se qualquer", () => {
  const destino = j({ theme: "dark", onboarding: "done", podHosts: ["a"], navFavoritos: { h1: [{ url: "https://x", titulo: "X" }], h2: [{ url: "https://y" }] }, lastHost: "h1" });
  const origem = j({ theme: "light", onboarding: "skipped", podHosts: ["b"], navFavoritos: { h1: [{ url: "https://z" }, { url: "https://x", titulo: "X2" }] }, backendPort: 9000 });
  const r = JSON.parse(fundirSettings(destino, origem));
  assert.equal(r.theme, "light"); assert.equal(r.onboarding, "done"); assert.equal(r.backendPort, 9000); assert.equal(r.lastHost, "h1");
  assert.deepEqual(r.podHosts, ["b", "a"]);
  assert.deepEqual(r.navFavoritos.h1.map((f) => f.url), ["https://z", "https://x"], "origem primeiro, sem repetir a url");
  assert.equal(r.navFavoritos.h1[1].titulo, "X2", "na url repetida vale a da origem");
  assert.deepEqual(r.navFavoritos.h2, [{ url: "https://y" }], "máquina só do destino fica");
  assert.equal(fundirSettings(destino, null), null);
});

test("fundirMemoria e fundirGoogleWhatsapp", () => {
  assert.equal(fundirMemoria(j({ notas: "d", perfil: "", updatedAt: "2026-10-09T00:00:00Z" }), j({ notas: "o", perfil: "", updatedAt: "2026-10-01T00:00:00Z" })), null, "destino mais recente fica");
  assert.match(fundirMemoria(j({ notas: "", perfil: "", updatedAt: "2026-10-09T00:00:00Z" }), j({ notas: "o", perfil: "", updatedAt: "2026-10-01T00:00:00Z" })), /"notas": "o"/, "destino vazio recebe a origem");
  assert.match(fundirMemoria(null, j({ notas: "o", perfil: "p", updatedAt: "" })), /"perfil": "p"/);
  const g = JSON.parse(fundirGoogleWhatsapp(j({ criados: ["+1", "+2"], grupo: null }), j({ criados: ["+2", "+3"], grupo: "WhatsApp" })));
  assert.deepEqual(g.criados, ["+1", "+2", "+3"]); assert.equal(g.grupo, "WhatsApp");
  assert.equal(carimboFusao("meu-bot-crm"), ".fundido-de-meu-bot-crm");
  assert.ok(COPIAR_SE_FALTAR.includes("google-oauth.json") && !COPIAR_SE_FALTAR.includes("google-contatos.bin"), "o .bin do chaveiro nunca");
});

test("settingsHerdados: produto com página própria não herda a aba fixada do app de origem", () => {
  const out = JSON.parse(settingsHerdados('{"abaFixa":"conversa","tema":"escuro"}'));
  assert.equal(out.abaFixa, "padrao");
  assert.equal(out.tema, "escuro", "o resto das preferências vem junto");
  assert.equal(JSON.parse(settingsHerdados("{}")).abaFixa, "padrao");
  assert.equal(settingsHerdados("lixo"), "lixo");
  assert.equal(settingsHerdados("[1]"), "[1]");
});
