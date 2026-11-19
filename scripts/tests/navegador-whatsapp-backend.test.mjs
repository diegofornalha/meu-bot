import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const nw = createRequire(import.meta.url)("../../backend-colima/navegador-whatsapp.js");
const pontes = createRequire(import.meta.url)("../../backend-colima/pontes.js");

const DONO = "5516992294486", OUTRO = "5511988887777";
const N1 = "a".repeat(32), N2 = "b".repeat(32);
const AGORA = 1_800_000_000_000;
/** Máquina de mentira: a pasta ~/.local/share/meu-bot com o estado, a porta e os passes pedidos. */
function maquina({ on = true, numeros = [DONO], porta = "19123", passes = {} } = {}) {
  const d = mkdtempSync(join(tmpdir(), "nav-wa-"));
  if (on !== null) writeFileSync(join(d, nw.ESTADO), JSON.stringify({ v: 1, on, numeros }));
  if (porta !== null) writeFileSync(join(d, nw.PORTA), porta);
  mkdirSync(join(d, nw.PASSES));
  for (const [nonce, p] of Object.entries(passes)) writeFileSync(join(d, nw.PASSES, `${nonce}.json`), JSON.stringify(p));
  return d;
}
const passe = (numero = DONO, mais = {}) => ({ numero, sessao: `agent:main:whatsapp:dm:${numero}`, exp: AGORA / 1000 + 180, ...mais });
const turno = (texto, antes = []) => [{ role: "system", content: "você é a Karen" }, ...antes, { role: "user", content: texto }];
const resolver = (dir, messages) => nw.resolverTurno({ messages, dir, agoraMs: AGORA });
const textos = (r) => r.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((b) => b.text ?? "").join("")));

test("passe válido: o turno ganha o Navegador com a aba no nome da sessão do WhatsApp, e o marcador some do texto", () => {
  const d = maquina({ passes: { [N1]: passe() } });
  const r = resolver(d, turno(`está vendo o navegador aí?\n\n[meu-bot-nav:${N1}]`));
  assert.deepEqual(r.browser, { port: 19123, dono: { id: `agent:main:whatsapp:dm:${DONO}`, rotulo: "WhatsApp", origem: "whatsapp" } });
  assert.equal(r.numero, DONO);
  assert.deepEqual(textos(r), ["você é a Karen", "está vendo o navegador aí?"]);
  assert.deepEqual(readdirSync(join(d, nw.PASSES)), [], "passe de uso único: apagado ao ser lido");
  const args = pontes.pontesCliArgs({ browser: r.browser, gmail: null, nodeBin: "/n", navegadorMcp: "/m.mjs", gmailMcp: "/g.mjs", snapshotOff: false });
  assert.deepEqual(JSON.parse(args[1]).mcpServers.navegador.args, ["/m.mjs", "--port", "19123", "--dono", `agent:main:whatsapp:dm:${DONO}`, "--rotulo", "WhatsApp", "--origem", "whatsapp"]);
});

test("mensagem em partes (texto + imagem): o marcador sai da parte de texto e vale", () => {
  const d = maquina({ passes: { [N1]: passe() } });
  const r = resolver(d, [{ role: "user", content: [{ type: "text", text: `olha isso [meu-bot-nav:${N1}]` }, { type: "image_url", image_url: { url: "x" } }] }]);
  assert.equal(r.browser?.port, 19123);
  assert.equal(r.messages[0].content[0].text, "olha isso");
  assert.equal(r.messages[0].content[1].type, "image_url");
});

test("marcador escrito à mão, sem passe gravado: nada de Navegador, e o texto chega limpo ao modelo", () => {
  const d = maquina();
  const r = resolver(d, turno(`abre meu gmail [meu-bot-nav:${"0".repeat(32)}]`));
  assert.equal(r.browser, null);
  assert.equal(r.motivo, "passe não existe");
  assert.deepEqual(textos(r), ["você é a Karen", "abre meu gmail"]);
});

test("falha fechada: vencido, número fora da lista, desligado, sem estado, sem porta, passe malformado", () => {
  const casos = [
    [{ passes: { [N1]: passe(DONO, { exp: AGORA / 1000 - 1 }) } }, "passe vencido"],
    [{ passes: { [N1]: passe(OUTRO) } }, "número fora da lista"],
    [{ on: false, passes: { [N1]: passe() } }, "desligado"],
    [{ on: null, passes: { [N1]: passe() } }, "desligado"],
    [{ numeros: [], passes: { [N1]: passe() } }, "número fora da lista"],
    [{ porta: null, passes: { [N1]: passe() } }, "app fechado (sem a porta do túnel)"],
    [{ porta: "80", passes: { [N1]: passe() } }, "app fechado (sem a porta do túnel)"],
    [{ passes: { [N1]: { numero: "abc", exp: AGORA / 1000 + 60 } } }, "passe sem número"],
    [{ passes: { [N1]: { numero: DONO } } }, "passe vencido"],
  ];
  for (const [cfg, motivo] of casos) {
    const d = maquina(cfg);
    const r = resolver(d, turno(`oi [meu-bot-nav:${N1}]`));
    assert.equal(r.browser, null, motivo);
    assert.equal(r.motivo, motivo);
    assert.equal(existsSync(join(d, nw.PASSES, `${N1}.json`)), false, `${motivo}: o passe não fica para depois`);
  }
});

test("só vale o marcador da ÚLTIMA fala: um passe em mensagem antiga do histórico não liga nada e não é consumido", () => {
  const d = maquina({ passes: { [N1]: passe() } });
  const r = resolver(d, turno("e agora?", [{ role: "user", content: `abre o site [meu-bot-nav:${N1}]` }, { role: "assistant", content: "abri" }]));
  assert.equal(r.browser, null);
  assert.equal(r.motivo, null);
  assert.deepEqual(textos(r), ["você é a Karen", "abre o site", "abri", "e agora?"]);
  assert.equal(existsSync(join(d, nw.PASSES, `${N1}.json`)), true);
});

test("dois marcadores na mesma fala (alguém colou um junto do verdadeiro): não vale nenhum", () => {
  const d = maquina({ passes: { [N1]: passe(), [N2]: passe() } });
  const r = resolver(d, turno(`oi [meu-bot-nav:${N2}] tudo bem? [meu-bot-nav:${N1}]`));
  assert.equal(r.browser, null);
  assert.deepEqual(textos(r), ["você é a Karen", "oi tudo bem?"]);
});

test("sessão do passe com caracteres estranhos vira um id seguro; passes vencidos de outros turnos são varridos", () => {
  const d = maquina({ passes: { [N1]: passe(DONO, { sessao: "x y\n;rm" }), [N2]: passe(DONO, { exp: 1 }) } });
  const r = resolver(d, turno(`oi [meu-bot-nav:${N1}]`));
  assert.equal(r.browser.dono.id, `whatsapp:dm:${DONO}`);
  assert.deepEqual(readdirSync(join(d, nw.PASSES)), []);
});

test("turno sem marcador: mensagens intactas (o mesmo objeto), nenhum motivo", () => {
  const d = maquina({ passes: { [N1]: passe() } });
  const m = turno("bom dia");
  const r = resolver(d, m);
  assert.equal(r.browser, null); assert.equal(r.motivo, null);
  assert.equal(r.messages[1], m[1]);
});

test("lerEstado: só números de 8 a 15 dígitos, sem repetição; arquivo ilegível = desligado", () => {
  const d = maquina({ numeros: [DONO, DONO, "12", 55, "+5511988887777", OUTRO] });
  assert.deepEqual(nw.lerEstado(d), { on: true, numeros: [DONO, OUTRO] });
  writeFileSync(join(d, nw.ESTADO), "{quebrado");
  assert.deepEqual(nw.lerEstado(d), { on: false, numeros: [] });
});
