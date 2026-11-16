import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Grok na máquina "local" (este Mac): porta do proxy por app, providers.json do backend local e leitura do `hermes auth`.
const c = createRequire(import.meta.url)("../../dist/main/agente/xaiLocal-core.js");

test("proxyPortaLocal: uma porta por app, fora da 8645 das máquinas", () => {
  assert.deepEqual([8790, 8791, 8792, 8793].map(c.proxyPortaLocal), [8690, 8691, 8692, 8693]);
  assert.ok(![8790, 8791, 8792, 8793].map(c.proxyPortaLocal).includes(8645));
});

test("providersComGrokLocal: agente primeiro, grok-4 pelo proxy local sem chave", () => {
  const list = JSON.parse(c.providersComGrokLocal(8691));
  assert.deepEqual(list.map((p) => [p.name, p.priority]), [["agente", 0], ["grok-4", 1]]);
  assert.equal(list[1].base_url, "http://127.0.0.1:8691/v1");
  assert.equal(list[1].key_env, undefined);
});

test("providersApontaProxy: só o providers.json com o grok-4 nesta porta conta como preparado", () => {
  assert.equal(c.providersApontaProxy(c.providersComGrokLocal(8691), 8691), true);
  assert.equal(c.providersApontaProxy(c.providersComGrokLocal(8690), 8691), false, "o proxy de outro app não serve");
  assert.equal(c.providersApontaProxy(JSON.stringify([{ name: "grok-4", base_url: "https://api.x.ai/v1" }]), 8691), false, "o padrão do bundle (chave de API)");
  assert.equal(c.providersApontaProxy(null, 8691), false);
  assert.equal(c.providersApontaProxy("{lixo", 8691), false);
});

test("statusXaiLogado: \"logged out\" e \"not logged in\" não são logado", () => {
  assert.equal(c.statusXaiLogado("xai-oauth: logged in (conta@x.ai)"), true);
  assert.equal(c.statusXaiLogado("xai-oauth: logged out (No xAI OAuth credentials stored.)"), false);
  assert.equal(c.statusXaiLogado("xai-oauth: not logged in"), false);
});

test("rotuloCredencialXai: a credencial ativa do bloco xai-oauth, não a de outro provedor", () => {
  const list = [
    "copilot (1 credentials):",
    "  #1  gh auth token        api_key id=462632 priority=0 gh_cli ←",
    "",
    "xai-oauth (2 credentials):",
    "  #1  velha@x.ai   oauth id=aa11 priority=0",
    "  #2  nova@x.ai    oauth id=bb22 priority=1 ←",
    "",
  ].join("\n");
  assert.equal(c.rotuloCredencialXai(list), "nova@x.ai");
  assert.equal(c.rotuloCredencialXai(list.split("xai-oauth")[0]), null);
});

test("hermesNaVersao", () => {
  assert.equal(c.hermesNaVersao("Hermes Agent v0.22.2 (2026.9.24) · stable"), true);
  assert.equal(c.hermesNaVersao("Hermes Agent v0.21.0"), false);
  assert.equal(c.hermesNaVersao(""), false);
});

test("ehNossoProxyOrfao: só o proxy do Hermes do meu-bot na porta deste app", () => {
  const pre = "/Users/box/.local/share/meu-bot/hermes";
  const py = `${pre}/lib/node_modules/hermes-agent/runtime/hermes-agent/venv/bin/python3 ${pre}/lib/node_modules/hermes-agent/runtime/hermes-agent/venv/bin/hermes proxy start --provider xai --host 127.0.0.1 --port 8691`;
  assert.equal(c.ehNossoProxyOrfao(py, pre, 8691), true);
  assert.equal(c.ehNossoProxyOrfao(py + "\n", pre + "/", 8691), true);
  // Outro app (outra porta), outro Hermes (o da pessoa), outro subcomando, porta parecida: intocados.
  assert.equal(c.ehNossoProxyOrfao(py, pre, 8690), false);
  assert.equal(c.ehNossoProxyOrfao(py.replace(/--port 8691/, "--port 86910"), pre, 8691), false);
  assert.equal(c.ehNossoProxyOrfao("/opt/homebrew/bin/hermes proxy start --provider xai --port 8691", pre, 8691), false);
  assert.equal(c.ehNossoProxyOrfao(`${pre}/bin/hermes auth add xai-oauth --port 8691`, pre, 8691), false);
  assert.equal(c.ehNossoProxyOrfao(`${pre}-velho/bin/hermes proxy start --port 8691`, pre, 8691), false);
  assert.equal(c.ehNossoProxyOrfao("", pre, 8691), false);
  assert.equal(c.ehNossoProxyOrfao(py, "", 8691), false);
});
