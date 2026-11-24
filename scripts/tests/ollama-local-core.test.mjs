import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Modo grátis no Mac (tutorial 16): o providers.json local com dono único (merge) e a parte pura do Ollama.
const req = createRequire(import.meta.url);
const p = req("../../dist/main/maquina/providers-local-core.js");
const o = req("../../dist/main/agente/ollamaLocal-core.js");
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

test("o modo grátis convive com outro provedor do providers.json: preparar um não apaga o outro", () => {
  const nuvem = { name: "nuvem", type: "openai", priority: 1, base_url: "https://api.exemplo.invalid/v1", model: "nuvem-1" };
  const comOllama = o.providersComOllama(null, 8591, "qwen2.5:7b");
  const depoisDaNuvem = p.mesclarProvider(comOllama, nuvem);
  assert.deepEqual(nomes(depoisDaNuvem), ["agente", "ollama-local", "nuvem"]);
  assert.equal(o.modeloNoProviders(depoisDaNuvem, 8591), "qwen2.5:7b");
  const depoisDoOllama = o.providersComOllama(p.mesclarProvider(null, nuvem), 8591, "qwen2.5:3b");
  assert.deepEqual(nomes(depoisDoOllama), ["agente", "nuvem", "ollama-local"]);
  assert.equal(p.providerPorNome(depoisDoOllama, "nuvem").base_url, nuvem.base_url, "a outra entrada continua como estava");
});

test("herança do Grok no Mac: só sai o grok-4 que o app apontava para o proxy dele (porta do backend - 100)", () => {
  const doApp = { name: "grok-4", type: "openai", priority: 1, base_url: "http://127.0.0.1:8691/v1", model: "grok-4" };
  const comOllama = o.providersComOllama(p.mesclarProvider(null, doApp), 8591, "qwen2.5:7b");
  assert.deepEqual(nomes(p.semProviderDoProxyAntigo(comOllama, 8791)), ["agente", "ollama-local"], "sai a entrada do app; o modo grátis fica");
  assert.equal(p.semProviderDoProxyAntigo(comOllama, 8790), null, "outro app (outra porta): a entrada não é deste, fica");
  const daPessoa = p.mesclarProvider(null, { ...doApp, base_url: "https://api.x.ai/v1", key_env: "XAI_API_KEY" });
  assert.equal(p.semProviderDoProxyAntigo(daPessoa, 8791), null, "grok-4 por chave de API não é o do proxy do app: fica");
  assert.equal(p.semProviderDoProxyAntigo(o.providersComOllama(null, 8591, "qwen2.5:7b"), 8791), null, "nada a tirar: não reescreve o arquivo");
  assert.equal(p.semProviderDoProxyAntigo(null, 8791), null);
  assert.equal(p.semProviderDoProxyAntigo("{lixo", 8791), null, "arquivo ilegível fica como está");
});

test("herança do Grok no Mac: o grok-4 do padrão antigo (API da xAI) só sai sem chave, e só a entrada exata", () => {
  const agente = { name: "agente", type: "claude", priority: 0 };
  const padrao = { name: "grok-4", type: "openai", priority: 1, base_url: "https://api.x.ai/v1", model: "grok-4", key_env: "XAI_API_KEY", description: "Grok da xAI" };
  const ollama = { name: "ollama-local", type: "openai", priority: 9, base_url: "http://127.0.0.1:8591/v1", model: "qwen2.5:7b" };
  const arq = (...l) => JSON.stringify(l, null, 2);
  // sem chave: sai, e as outras entradas ficam na mesma ordem
  assert.deepEqual(JSON.parse(p.semProviderDoPadraoAntigo(arq(agente, padrao, ollama), false)), [agente, ollama]);
  // com chave: a pessoa configurou de propósito, nada muda
  assert.equal(p.semProviderDoPadraoAntigo(arq(agente, padrao, ollama), true), null);
  // outro nome, outro endereço, outra variável ou chave literal: não é a entrada do padrão, fica
  for (const outra of [{ ...padrao, name: "grok-5" }, { ...padrao, base_url: "https://meu-proxy.exemplo.invalid/v1" }, { ...padrao, key_env: "OUTRA_KEY" }, { ...padrao, key: "literal" }]) {
    assert.equal(p.semProviderDoPadraoAntigo(arq(agente, outra), false), null, JSON.stringify(outra));
  }
  // arquivo ilegível, fora do formato ou ausente: não toca
  assert.equal(p.semProviderDoPadraoAntigo("{lixo", false), null);
  assert.equal(p.semProviderDoPadraoAntigo('{"name":"grok-4"}', false), null);
  assert.equal(p.semProviderDoPadraoAntigo(null, false), null);
  assert.equal(p.semProviderDoPadraoAntigo(arq(agente, ollama), false), null, "nada a tirar: não reescreve");
  assert.equal(p.temGrokDoPadraoAntigo(arq(agente, padrao)), true); assert.equal(p.temGrokDoPadraoAntigo(arq(agente)), false);
});

test("herança do Grok no Mac: XAI_API_KEY vale do .env do backend local ou do ambiente; vazia ou comentada não conta", () => {
  assert.equal(p.temChaveXai(null, {}), false);
  assert.equal(p.temChaveXai("OPENAI_COMPAT_KEY=abc\nPORT=8791\n", {}), false);
  assert.equal(p.temChaveXai("PORT=8791\nXAI_API_KEY=xai-123\n", {}), true);
  assert.equal(p.temChaveXai('export XAI_API_KEY="xai-123"\n', {}), true);
  assert.equal(p.temChaveXai("XAI_API_KEY=\n", {}), false, "vazia");
  assert.equal(p.temChaveXai("# XAI_API_KEY=xai-123\n", {}), false, "comentada");
  assert.equal(p.temChaveXai(null, { XAI_API_KEY: "xai-123" }), true, "do ambiente");
  assert.equal(p.temChaveXai(null, { XAI_API_KEY: "  " }), false);
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

test("modoGratisDoMac: só no staging e no Mac com chip Apple; instalado ou possível", () => {
  const mac = { staging: true, plataforma: "darwin", arch: "arm64", preparado: false };
  assert.equal(o.modoGratisDoMac(mac), "possivel");
  assert.equal(o.modoGratisDoMac({ ...mac, preparado: true }), "instalado");
  assert.equal(o.modoGratisDoMac({ ...mac, staging: false }), null, "estável: ainda não é oferecido");
  assert.equal(o.modoGratisDoMac({ ...mac, arch: "x64" }), null, "Mac Intel");
  assert.equal(o.modoGratisDoMac({ ...mac, plataforma: "win32", arch: "arm64" }), null, "Windows");
  assert.equal(o.modoGratisDoMac({ ...mac, staging: false, preparado: true }), null, "instalado no staging não vale no estável");
});
