// Modo de fumaça (MEU_BOT_FUMACA): a decisão do relatório (src/main/app/fumaca-core.ts) e a conferência dele
// (scripts/fumaca-conferir.mjs), com o contrato das capacidades do Windows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { arquivoDaFumaca, codigoDeSaida, fumacaPronta, fumacaWslPedida, janelaDaFumaca, montarRelatorio, prazoDaFumaca, PRAZO_FUMACA_MS, PRAZO_FUMACA_WSL_MS, textoDoErro } = require("../../dist/main/app/fumaca-core.js");
const { capsFor, CAPS_DE_PLATAFORMA, CAPS_SO_WINDOWS } = require("../../dist/main/app/variant-core.js");
const { conferirFumaca, resumoDaFumaca } = await import("../fumaca-conferir.mjs");

const SELETOR = { arquivo: "picker.html", titulo: "meu-bot-staging 1.3.0", carregou: true, visivel: true };
const ENTRADA_RAPIDA = { arquivo: "quick-entry.html", titulo: "", carregou: true, visivel: false };
const base = (extra = {}) => ({
  versao: "1.3.0", plataforma: "win32", arch: "x64", variante: "client-staging", empacotado: true,
  caps: capsFor("client-staging", "1.3.0", "win32"), janelas: [SELETOR], erros: [], avisos: [], prazoVencido: false, duracaoMs: 2100, em: "2026-11-22T12:00:00.000Z", ...extra,
});

test("fumaça: só liga com MEU_BOT_FUMACA apontando para um arquivo", () => {
  assert.equal(arquivoDaFumaca({}), null);
  assert.equal(arquivoDaFumaca({ MEU_BOT_FUMACA: "  " }), null);
  assert.equal(arquivoDaFumaca({ MEU_BOT_FUMACA: " C:\\tmp\\f.json " }), "C:\\tmp\\f.json");
});

test("fumaça: a janela que conta é a primeira à vista carregada; a entrada rápida escondida não conta", () => {
  assert.equal(janelaDaFumaca([ENTRADA_RAPIDA, SELETOR]).arquivo, "picker.html");
  assert.equal(fumacaPronta([ENTRADA_RAPIDA]), false, "janela escondida carregada não conclui a fumaça");
  assert.equal(fumacaPronta([ENTRADA_RAPIDA, { ...SELETOR, carregou: false }]), false);
  assert.equal(fumacaPronta([ENTRADA_RAPIDA, SELETOR]), true);
  assert.equal(janelaDaFumaca([]).carregou, false);
});

test("fumaça: janela carregada e sem erro é ok e sai com 0", () => {
  const r = montarRelatorio(base());
  assert.equal(r.ok, true);
  assert.equal(codigoDeSaida(r), 0);
  assert.deepEqual(r.erros, []);
  assert.equal(r.janela.arquivo, "picker.html");
  assert.equal(r.janelas, 1);
});

test("fumaça: erro, janela que não carregou, prazo vencido ou nenhuma janela reprovam e saem com 1", () => {
  const comErro = montarRelatorio(base({ erros: ["exceção não tratada: Error: x"] }));
  assert.equal(comErro.ok, false); assert.equal(codigoDeSaida(comErro), 1);
  const prazo = montarRelatorio(base({ janelas: [{ ...SELETOR, carregou: false }], prazoVencido: true }));
  assert.equal(prazo.ok, false); assert.match(prazo.erros[0], /não terminou de carregar em 60 s/);
  const nenhuma = montarRelatorio(base({ janelas: [] }));
  assert.equal(nenhuma.ok, false); assert.deepEqual(nenhuma.erros, ["nenhuma janela abriu"]);
  const escondida = montarRelatorio(base({ janelas: [ENTRADA_RAPIDA] }));
  assert.equal(escondida.ok, false, "só a janela escondida carregou: o app não mostrou nada");
  assert.equal(escondida.janela.carregou, false);
  // Erro do console da página fica no relatório, mas não reprova.
  assert.equal(montarRelatorio(base({ avisos: ["console (picker.js:1): x"] })).ok, true);
});

test("fumaça: o texto do erro traz a origem e a pilha", () => {
  assert.match(textoDoErro("exceção não tratada", new Error("quebrou")), /^exceção não tratada: Error: quebrou\n/);
  assert.equal(textoDoErro("promessa", "texto"), "promessa: texto");
  assert.equal(textoDoErro("promessa", { a: 1 }), 'promessa: {"a":1}');
});

const ESPERADO = { versao: "1.3.0", plataforma: "win32", variante: "client-staging" };

test("conferir: relatório do Windows no contrato passa", () => {
  assert.deepEqual(conferirFumaca(montarRelatorio(base()), ESPERADO, capsFor), []);
});

test("conferir: versão, plataforma e variante erradas viram frases", () => {
  const p = conferirFumaca(montarRelatorio(base({ versao: "1.2.0", plataforma: "darwin", variante: "client", caps: capsFor("client", "1.2.0", "darwin") })), ESPERADO, capsFor);
  assert.equal(p.length, 3);
  assert.match(p[0], /versão: o app diz "1.2.0", esperava "1.3.0"/);
  assert.match(p[1], /plataforma: o app diz "darwin", esperava "win32"/);
  assert.match(p[2], /variante: o app diz "client"/);
});

test("conferir: janela não carregada e erro do app reprovam, com a primeira linha do erro", () => {
  const p = conferirFumaca(montarRelatorio(base({ janelas: [], erros: ["exceção não tratada: Error: x\n    at y"] })), ESPERADO, capsFor);
  assert.ok(p.includes("a janela não carregou"));
  assert.ok(p.includes("erro no app: exceção não tratada: Error: x"));
  assert.ok(p.includes("erro no app: nenhuma janela abriu"));
});

test("conferir: capacidade ligada no app sem estar no contrato não passa (e a desligada que o contrato promete também não)", () => {
  // O app do Windows passou a oferecer o painel Computador sem a tabela (capsFor) dizer: é o que o contrato segura.
  const ligada = montarRelatorio(base({ caps: { ...capsFor("client-staging", "1.3.0", "win32"), telaComputador: true } }));
  assert.deepEqual(conferirFumaca(ligada, ESPERADO, capsFor), ['capacidade "telaComputador": o app diz true, o contrato (capsFor) diz false']);
  // O inverso: o contrato promete (macOS) e o app não entrega.
  const mac = { versao: "1.3.0", plataforma: "darwin", variante: "client-staging" };
  const faltando = montarRelatorio(base({ plataforma: "darwin", caps: { ...capsFor("client-staging", "1.3.0", "darwin"), controleRemoto: false } }));
  assert.deepEqual(conferirFumaca(faltando, mac, capsFor), ['capacidade "controleRemoto": o app diz false, o contrato (capsFor) diz true']);
  // Capacidade que o relatório não traz, ou que o contrato não conhece.
  const { chat: _fora, ...semChat } = capsFor("client-staging", "1.3.0", "win32");
  assert.match(conferirFumaca(montarRelatorio(base({ caps: { ...semChat, inventada: true } })), ESPERADO, capsFor).join("\n"), /"chat": o app diz \(ausente\)[^\n]*\n[^\n]*"inventada": o app diz true, o contrato \(capsFor\) diz \(ausente\)/);
});

test("conferir: no Windows de hoje, nenhuma capacidade de plataforma está ligada (religar uma muda este teste e a prova)", () => {
  const caps = capsFor("client-staging", "1.3.0", "win32");
  assert.deepEqual(CAPS_DE_PLATAFORMA.filter((k) => caps[k] === true), []);
});

test("conferir: no Windows, a única de plataforma ligada é o Este Windows (hostWsl)", () => {
  const caps = capsFor("client-staging", "1.3.0", "win32");
  assert.deepEqual(CAPS_SO_WINDOWS.filter((k) => caps[k] === true), ["hostWsl"]);
  assert.match(resumoDaFumaca(montarRelatorio(base()), [], [...CAPS_DE_PLATAFORMA, ...CAPS_SO_WINDOWS]), /ligadas \| `hostWsl`/);
});

const WSL_OK = { ok: true, estado: "pronto", alias: "meu-bot-staging-wsl", erro: null, log: ["✓ meu-bot-staging-wsl responde por SSH"], ms: 240_000 };
test("fumaça com MEU_BOT_FUMACA_WSL: prazo longo, o preparo entra no relatório e a conferência --wsl exige pronto", () => {
  assert.equal(fumacaWslPedida({}), false);
  assert.equal(fumacaWslPedida({ MEU_BOT_FUMACA_WSL: "1" }), true);
  assert.equal(prazoDaFumaca({}), PRAZO_FUMACA_MS);
  assert.equal(prazoDaFumaca({ MEU_BOT_FUMACA_WSL: "1" }), PRAZO_FUMACA_WSL_MS);
  const ESP = { versao: "1.3.0", plataforma: "win32", variante: "client-staging", wsl: true };
  const ok = montarRelatorio(base({ wsl: WSL_OK }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.wsl, WSL_OK);
  assert.deepEqual(conferirFumaca(ok, ESP, capsFor), []);
  assert.match(resumoDaFumaca(ok, []), /Este Windows \| pronto: alias `meu-bot-staging-wsl`, 240 s/);
  // Parou no meio: o app reprova e a conferência diz onde.
  const parou = montarRelatorio(base({ wsl: { ...WSL_OK, ok: false, estado: "sem-sshd", erro: "os pacotes da distro não instalaram" } }));
  assert.equal(parou.ok, false);
  assert.ok(conferirFumaca(parou, ESP, capsFor).some((x) => /parou em "sem-sshd": os pacotes/.test(x)));
  // Pedido e não terminou no prazo.
  assert.ok(montarRelatorio(base({ wsl: null })).erros.some((x) => /não terminou em 30 min/.test(x)));
  // --wsl sem o preparo no relatório (rodou sem a variável) não passa; sem --wsl, o relatório de sempre passa.
  assert.ok(conferirFumaca(montarRelatorio(base()), ESP, capsFor).some((x) => /não traz o preparo do este Windows/.test(x)));
  assert.deepEqual(conferirFumaca(montarRelatorio(base()), { ...ESP, wsl: false }, capsFor), []);
});

test("conferir: relatório que não é do app empacotado, ou lixo, não passa", () => {
  assert.ok(conferirFumaca(montarRelatorio(base({ empacotado: false })), ESPERADO, capsFor).includes("o relatório não veio de um app empacotado"));
  assert.deepEqual(conferirFumaca(null, ESPERADO, capsFor), ["o relatório não é um objeto JSON"]);
  assert.ok(conferirFumaca({}, ESPERADO, capsFor).length > 3);
});

test("resumo: diz se passou, a versão, a janela e as capacidades de plataforma", () => {
  const r = montarRelatorio(base());
  const ok = resumoDaFumaca(r, [], CAPS_DE_PLATAFORMA);
  assert.match(ok, /Fumaça do app: passou/);
  assert.match(ok, /`1\.3\.0`/);
  assert.match(ok, /carregou: `picker\.html`/);
  assert.match(ok, /ligadas \| nenhuma/);
  assert.match(resumoDaFumaca(r, ["versão: x"], CAPS_DE_PLATAFORMA), /FALHOU[\s\S]*- versão: x/);
  assert.match(resumoDaFumaca(null, ["o app não gravou o relatório"]), /FALHOU/);
});

test("main.ts liga a fumaça antes da trava de instância, e o workflow Windows usa o modo e a conferência", () => {
  const main = readFileSync(new URL("../../src/main/main.ts", import.meta.url), "utf8");
  assert.ok(main.indexOf("ligarFumaca();") > 0 && main.indexOf("ligarFumaca();") < main.indexOf("requestSingleInstanceLock"));
  const wf = readFileSync(new URL("../../.github/workflows/windows.yml", import.meta.url), "utf8");
  assert.match(wf, /MEU_BOT_FUMACA/);
  assert.match(wf, /fumaca-conferir\.mjs/);
  assert.match(wf, /windows-latest/);
  // O modo "Este Windows": o preparo de verdade no app instalado e o ssh conferido de fora.
  assert.match(wf, /MEU_BOT_FUMACA_WSL/);
  assert.match(wf, /fumaca-conferir\.mjs[^\n]*--wsl/);
  assert.match(wf, /ssh(\.exe)? [^\n]*\$env:ALIAS_WSL[^\n]*true/);
});
