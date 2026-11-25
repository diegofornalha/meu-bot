import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const { literalJs, DONO_SEM_IDENTIDADE, parseDono, limpar, abasDe, escolherAba, decidirAbrir, tomar, donoTexto, podeFechar, abasParaRecarregar, POSSE_TTL_MS, MAX_ABAS } = createRequire(import.meta.url)("../../dist/main/navegador/nav-donos-core.js");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const WA = { id: "agent:main:whatsapp:direct:+5516992294486", rotulo: "WhatsApp", origem: "whatsapp" };
const BOT = { id: "meu-bot:conv-1", rotulo: "Análise do Instagram", origem: "meu-bot" };

test("identidade: base64 de {id, rotulo, origem}; inválida vira null (regra antiga)", () => {
  assert.deepEqual(parseDono(b64(WA)), WA);
  assert.deepEqual(parseDono(b64({ id: "x:1" })), { id: "x:1", rotulo: "meu-bot", origem: "meu-bot" });
  assert.deepEqual(parseDono(b64({ id: "claude-code:mac", origem: "claude-code" })), { id: "claude-code:mac", rotulo: "Claude Code", origem: "claude-code" });
  assert.equal(parseDono(b64({ id: "x:2", origem: "outra" })).origem, "meu-bot");
  for (const ruim of [undefined, "", "@@@", b64({ id: "a b; rm" }), b64({ rotulo: "x" })]) assert.equal(parseDono(ruim), null);
});

test("sem identificação: quem chega sem cabeçalho vira uma conversa só, com o selo que diz isso e o id que o renderer lê", () => {
  assert.deepEqual(DONO_SEM_IDENTIDADE, { id: "meu-bot:sem-identificacao", rotulo: "sem identificação", origem: "meu-bot" });
  // O id tem de passar na mesma regra dos ids identificados (vai e volta pelo cabeçalho sem virar null).
  assert.deepEqual(parseDono(b64(DONO_SEM_IDENTIDADE)), DONO_SEM_IDENTIDADE);
  // navDonoView (renderer) reconhece este id pelo texto: se um mudar, o outro tem de mudar junto.
  const renderer = readFileSync(new URL("../../src/renderer/navegador/navegador.ts", import.meta.url), "utf8");
  assert.ok(renderer.includes(`d.id === "${DONO_SEM_IDENTIDADE.id}"`));
});

test("sem aba indicada: a conversa trabalha na aba dela; sem aba própria, mexer usa a da frente (e a toma), ler também", () => {
  const posses = new Map();
  assert.deepEqual(escolherAba({ posses, vivas: [1, 2], ativa: 1, dono: BOT, tipo: "mexe" }), { aba: 1 });
  tomar(posses, 1, BOT, 1000);
  tomar(posses, 2, WA, 2000);
  assert.deepEqual(escolherAba({ posses, vivas: [1, 2], ativa: 1, dono: WA, tipo: "mexe" }), { aba: 2 });
  assert.deepEqual(escolherAba({ posses, vivas: [1, 2], ativa: 2, dono: BOT, tipo: "leitura" }), { aba: 1 });
  // Sem aba própria e a da frente é de outra conversa: ler pode, mexer não.
  const outro = { id: "meu-bot:conv-2", rotulo: "Outra", origem: "meu-bot" };
  assert.deepEqual(escolherAba({ posses, vivas: [1, 2], ativa: 2, dono: outro, tipo: "leitura" }), { aba: 2 });
  assert.match(escolherAba({ posses, vivas: [1, 2], ativa: 2, dono: outro, tipo: "mexe" }).erro, /em uso por outra conversa \(WhatsApp\)/);
});

test("aba indicada: ler qualquer uma; mexer na de outra conversa é recusado; aba que não existe também", () => {
  const posses = new Map([[5, { ...WA, em: 1 }]]);
  assert.deepEqual(escolherAba({ posses, vivas: [5, 6], ativa: 6, dono: BOT, aba: 5, tipo: "leitura" }), { aba: 5 });
  assert.match(escolherAba({ posses, vivas: [5, 6], ativa: 6, dono: BOT, aba: 5, tipo: "mexe" }).erro, /use abrir com nova=true/);
  assert.deepEqual(escolherAba({ posses, vivas: [5, 6], ativa: 6, dono: WA, aba: 5, tipo: "mexe" }), { aba: 5 });
  assert.match(escolherAba({ posses, vivas: [5], ativa: 5, dono: BOT, aba: 9, tipo: "leitura" }).erro, /não existe/);
  assert.match(escolherAba({ posses, vivas: [], ativa: null, dono: BOT, tipo: "leitura" }).erro, /sem abas/);
});

test("abrir: nunca na aba da frente da pessoa; reaproveita a da conversa; nova até o máximo, depois a mais antiga", () => {
  const posses = new Map();
  assert.deepEqual(decidirAbrir({ posses, vivas: [1], ativa: 1, dono: WA, nova: false }), { modo: "nova" });
  tomar(posses, 7, WA, 100);
  assert.deepEqual(decidirAbrir({ posses, vivas: [1, 7], ativa: 1, dono: WA, nova: false }), { modo: "navegar", aba: 7 });
  tomar(posses, 8, WA, 200); tomar(posses, 9, WA, 300);
  assert.equal(abasDe(posses, WA).length, MAX_ABAS);
  assert.deepEqual(decidirAbrir({ posses, vivas: [1, 7, 8, 9], ativa: 1, dono: WA, nova: true }), { modo: "navegar", aba: 7 });
  // Servidor antigo (sem identidade): regra de antes.
  assert.deepEqual(decidirAbrir({ posses, vivas: [1, 7], ativa: 1, dono: null, nova: false }), { modo: "navegar", aba: 1 });
  assert.match(decidirAbrir({ posses, vivas: [1, 7], ativa: 1, dono: BOT, aba: 7, nova: false }).erro, /em uso/);
});

test("posse vence em 10 min sem uso e some quando a aba fecha; fechar só a própria; /abas diz de quem é", () => {
  const posses = new Map();
  tomar(posses, 1, WA, 0); tomar(posses, 2, BOT, 0);
  limpar(posses, [1], POSSE_TTL_MS - 1);
  assert.deepEqual([...posses.keys()], [1]);
  limpar(posses, [1], POSSE_TTL_MS + 1);
  assert.equal(posses.size, 0);
  tomar(posses, 3, WA, 10);
  assert.equal(donoTexto(posses, 3, WA), "esta conversa");
  assert.equal(donoTexto(posses, 3, BOT), "outra conversa: WhatsApp");
  assert.equal(donoTexto(posses, 4, BOT), "da pessoa");
  assert.equal(podeFechar(posses, 3, WA), null);
  assert.match(podeFechar(posses, 3, BOT), /outra conversa/);
  assert.match(podeFechar(posses, 4, BOT), /da pessoa/);
});

test("fechar: as abas da pessoa no mesmo site recarregam; as de conversas, de outros sites, a própria e about:blank não", () => {
  const dono = { id: "a:1", rotulo: "a", origem: "meu-bot" };
  const posses = new Map([[7, { ...dono, em: 0 }], [9, { id: "b:2", rotulo: "b", origem: "whatsapp", em: 0 }]]);
  const abas = [
    { id: 3, url: "https://dalefit.cloud/" },            // da pessoa, mesmo site → recarrega
    { id: 4, url: "https://dalefit.cloud/sobre?x=1" },   // da pessoa, mesmo site, outro caminho → recarrega
    { id: 5, url: "http://dalefit.cloud/" },             // outro esquema = outra origem → não
    { id: 6, url: "https://google.com/" },               // outro site → não
    { id: 7, url: "https://dalefit.cloud/?v=nofooter" }, // a aba do agente, que está fechando → não
    { id: 8, url: "about:blank" },                       // sem origem → não
    { id: 9, url: "https://dalefit.cloud/x" },           // aba de outra conversa → não (no meio de uma ação dela)
  ];
  assert.deepEqual(abasParaRecarregar("https://dalefit.cloud/?v=nofooter", abas, 7, posses), [3, 4]);
  assert.deepEqual(abasParaRecarregar("about:blank", abas, 7, posses), [], "aba fechada sem origem: nada");
  assert.deepEqual(abasParaRecarregar("não é url", abas, 7, posses), []);
  assert.deepEqual(abasParaRecarregar("https://dalefit.cloud:8443/", abas, 7, posses), [], "porta diferente é outra origem");
});

test("literalJs: o texto do agente vira literal que não fecha o script e volta igual ao ser lido", () => {
  for (const t of ['a[href="x"] > b', "</script><script>alert(1)//", "linha\u2028outra\u2029fim", "aspas \" e \\ barra", "ação <ok>"]) {
    const lit = literalJs(t);
    assert.equal(/[<>\u2028\u2029]/.test(lit), false, lit);
    assert.equal(new Function(`return ${lit}`)(), t);
  }
});
