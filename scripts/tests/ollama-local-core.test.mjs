import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Modo grátis no Mac (tutorial 16): o providers.json local com dono único (merge) e a parte pura do Ollama.
const req = createRequire(import.meta.url);
const p = req("../../dist/main/maquina/providers-local-core.js");
const o = req("../../dist/main/agente/ollamaLocal-core.js");
const x = req("../../dist/main/agente/xaiLocal-core.js");
const nomes = (raw) => JSON.parse(raw).map((e) => e.name);

test("mesclarProvider: põe ou troca pelo nome e preserva os outros na ordem", () => {
  assert.deepEqual(nomes(p.mesclarProvider(null, { name: "ollama-local", type: "openai", priority: 9 })), ["agente", "ollama-local"], "sem arquivo: o agente e o novo");
  assert.deepEqual(nomes(p.mesclarProvider("{lixo", { name: "x", type: "openai", priority: 1 })), ["agente", "x"], "ilegível: recomeça do agente");
  const raw = JSON.stringify([{ name: "agente", type: "claude", priority: 0 }, { name: "rene", type: "claude", priority: 3 }]);
  const um = p.mesclarProvider(raw, { name: "ollama-local", type: "openai", priority: 9, model: "a" });
  const dois = p.mesclarProvider(um, { name: "ollama-local", type: "openai", priority: 9, model: "b" });
  assert.deepEqual(nomes(dois), ["agente", "rene", "ollama-local"], "trocar não duplica");
  assert.equal(p.providerPorNome(dois, "ollama-local").model, "b");
  assert.deepEqual(nomes(p.semProvider(dois, "ollama-local")), ["agente", "rene"]);
  assert.equal(p.providerPorNome(null, "agente"), null);
});

test("Grok e Ollama convivem: preparar o Grok não apaga o modo grátis, e vice-versa", () => {
  const comOllama = o.providersComOllama(null, 8591, "qwen2.5:7b");
  const depoisDoGrok = x.providersComGrokLocal(8691, comOllama);
  assert.deepEqual(nomes(depoisDoGrok), ["agente", "ollama-local", "grok-4"]);
  assert.equal(o.modeloNoProviders(depoisDoGrok, 8591), "qwen2.5:7b");
  assert.equal(x.providersApontaProxy(depoisDoGrok, 8691), true);
  const depoisDoOllama = o.providersComOllama(x.providersComGrokLocal(8691), 8591, "qwen2.5:3b");
  assert.equal(x.providersApontaProxy(depoisDoOllama, 8691), true, "o grok-4 continua apontado");
  assert.deepEqual(nomes(x.providersComGrokLocal(8691)), ["agente", "grok-4"], "sem arquivo, como antes");
});

test("ollama: porta própria por app, fora da 11434 padrão (um Ollama da pessoa fica intocado)", () => {
  assert.deepEqual([8790, 8791, 8792, 8793].map(o.ollamaPortaLocal), [8590, 8591, 8592, 8593]);
  assert.ok(![8790, 8791].map(o.ollamaPortaLocal).includes(11434));
  const e = o.entradaOllama(8591, "qwen2.5:7b");
  assert.equal(e.base_url, "http://127.0.0.1:8591/v1"); assert.equal(e.type, "openai"); assert.ok(e.key === undefined, "local: sem chave");
});

test("modeloNoProviders: só conta o ollama-local apontado para a porta deste app", () => {
  const raw = o.providersComOllama(null, 8591, "qwen2.5:3b");
  assert.equal(o.modeloNoProviders(raw, 8591), "qwen2.5:3b");
  assert.equal(o.modeloNoProviders(raw, 8590), null, "o do outro app não serve");
  assert.equal(o.modeloNoProviders(null, 8591), null);
  assert.equal(o.temOllamaNoProviders(raw), true);
  assert.equal(o.temOllamaNoProviders(o.providersSemOllama(raw)), false);
});

test("modeloParaMemoria: até 8 GB o leve, acima o 7B; sem saber, o leve", () => {
  assert.equal(o.modeloParaMemoria(8192).id, "qwen2.5:3b");
  assert.equal(o.modeloParaMemoria(16384).id, "qwen2.5:7b");
  assert.equal(o.modeloParaMemoria(null).id, "qwen2.5:3b");
  assert.ok(o.espacoNecessarioMb(o.modeloParaMemoria(16384)) > o.modeloParaMemoria(16384).downloadMb);
});

test("versão fixa com sha256 e URL do GitHub Releases da mesma versão", () => {
  assert.match(o.OLLAMA_SHA256_LOCAL, /^[0-9a-f]{64}$/);
  assert.ok(o.OLLAMA_URL_LOCAL.includes(`/v${o.OLLAMA_VERSION_LOCAL}/ollama-darwin.tgz`));
});

test("ehNossoOllamaOrfao: só o `ollama serve` da pasta do meu-bot", () => {
  const pre = "/Users/a/.local/share/meu-bot/ollama";
  assert.equal(o.ehNossoOllamaOrfao(`${pre}/v0.40.15/ollama serve`, pre), true);
  assert.equal(o.ehNossoOllamaOrfao("/Applications/Ollama.app/Contents/Resources/ollama serve", pre), false, "o Ollama da pessoa não");
  assert.equal(o.ehNossoOllamaOrfao(`${pre}/v0.40.15/ollama runner --model x`, pre), false);
});

test("linhaDoPull: status legíveis, progresso de 5 em 5% no blob grande, erro em texto", () => {
  assert.deepEqual(o.linhaDoPull({ status: "pulling manifest" }, -5), { texto: "pulling manifest", pct: -5 });
  assert.equal(o.linhaDoPull({ status: "pulling 2bada8a74506", total: 1000, completed: 10 }, -5), null, "camada pequena: nada");
  const G = 1_073_741_824;
  const a = o.linhaDoPull({ status: "pulling 2bada8a74506", total: 4 * G, completed: 1 * G }, -5);
  assert.equal(a.pct, 25); assert.match(a.texto, /25% \(1,0 de 4,0 GB\)/);
  assert.equal(o.linhaDoPull({ status: "pulling 2bada8a74506", total: 4 * G, completed: 1.1 * G }, 25), null, "menos de 5% depois: nada");
  assert.deepEqual(o.linhaDoPull({ error: "pull model manifest: file does not exist" }, 10), { texto: "erro: pull model manifest: file does not exist", pct: 10 });
  assert.equal(o.linhaDoPull("lixo", 0), null);
});
