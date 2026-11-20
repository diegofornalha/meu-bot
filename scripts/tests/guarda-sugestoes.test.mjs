// Modo "sugere e você aprova" da guarda do WhatsApp (backend-colima/guarda/sugestoes.mjs): o que passa, o que vira
// sugestão, a aprovação com passe de uso único e a CLI que o app chama.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alvoDe, aprovar, decidir, estado, gastarPasse, guardar, lerLinha, listar, MAX_FILA, mudarModo, PASSE_MS, tirar } from "../../backend-colima/guarda/sugestoes.mjs";

const pasta = () => mkdtempSync(join(tmpdir(), "sugestoes-"));
const DONO = "+5521999990000", ANA = "+5511988887777";

test("alvoDe: contato vira +dígitos, grupo fica com o JID, lixo é null", () => {
  assert.equal(alvoDe("5511988887777@s.whatsapp.net"), ANA);
  assert.equal(alvoDe("+55 11 98888-7777"), ANA);
  assert.equal(alvoDe("5511988887777:12@s.whatsapp.net"), ANA);
  assert.equal(alvoDe("120363041234567890@g.us"), "120363041234567890@g.us");
  for (const x of ["", null, undefined, "abc", "123"]) assert.equal(alvoDe(x), null);
});

test("modo desligado: tudo passa e nada é guardado", () => {
  const d = pasta();
  try {
    assert.deepEqual(decidir(d, { to: ANA, texto: "oi", sessao: null, dono: DONO }), { acao: "passar" });
    assert.deepEqual(listar(d), []);
    assert.deepEqual(estado(d), { ligado: false, desde: null, pendentes: 0 });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("modo ligado: resposta a contato e a grupo vira sugestão; a conversa do dono passa; repetida não duplica", () => {
  const d = pasta();
  try {
    assert.equal(mudarModo(d, true).ligado, true);
    assert.deepEqual(decidir(d, { to: `${DONO.slice(1)}@s.whatsapp.net`, texto: "lembrete", sessao: null, dono: DONO }), { acao: "passar" });
    const r = decidir(d, { to: "5511988887777@s.whatsapp.net", texto: "  Olá, Ana!  ", sessao: "agent:main:whatsapp:direct:+5511988887777", dono: DONO });
    assert.equal(r.acao, "segurar"); assert.equal(r.sugestao.para, ANA); assert.equal(r.sugestao.texto, "Olá, Ana!");
    assert.equal(decidir(d, { to: ANA, texto: "Olá, Ana!", sessao: null, dono: DONO }).sugestao.id, r.sugestao.id, "o gateway repetiu o envio: a mesma sugestão");
    assert.equal(decidir(d, { to: "120363041234567890@g.us", texto: "Bom dia, grupo", sessao: null, dono: DONO }).acao, "segurar");
    assert.deepEqual(decidir(d, { to: "???", texto: "x", sessao: null, dono: DONO }), { acao: "segurar", sugestao: null }, "destino ilegível: não sai sozinho");
    assert.equal(decidir(d, { to: ANA, texto: "oi", sessao: null, dono: null }).acao, "segurar", "sem saber quem é o dono, também segura");
    assert.deepEqual(listar(d).map((s) => [s.para, s.texto]), [[ANA, "Olá, Ana!"], ["120363041234567890@g.us", "Bom dia, grupo"], [ANA, "oi"]]);
    assert.equal(statSync(join(d, "whatsapp-sugestoes.jsonl")).mode & 0o077, 0, "a fila é só da pessoa (0600)");
    assert.equal(estado(d).pendentes, 3);
    assert.equal(mudarModo(d, false).ligado, false);
    assert.equal(decidir(d, { to: ANA, texto: "depois de desligar", sessao: null, dono: DONO }).acao, "passar");
    assert.equal(listar(d).length, 3, "desligar não joga fora o que estava esperando");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("aprovar: o envio aprovado passa uma vez (como está ou editado), sai da fila; falha no envio mantém a sugestão", async () => {
  const d = pasta();
  try {
    mudarModo(d, true);
    const a = guardar(d, { para: ANA, texto: "Posso te ligar às 15h?" }), b = guardar(d, { para: ANA, texto: "Segue o orçamento." });
    // O "WhatsApp" de mentira faz o que o gateway faz: o envio passa pelo hook da guarda.
    const enviados = [];
    const enviar = async (para, texto) => { const r = decidir(d, { to: para, texto, sessao: null, dono: DONO }); if (r.acao === "passar") enviados.push([para, texto]); return { ok: r.acao === "passar", erro: "segurado pela guarda" }; };
    assert.deepEqual(await aprovar(d, a.id, null, enviar), { ok: true, id: a.id, para: ANA, texto: "Posso te ligar às 15h?", editada: false });
    assert.equal(decidir(d, { to: ANA, texto: "Posso te ligar às 15h?", sessao: null, dono: DONO }).acao, "segurar", "o passe vale uma vez: o agente repetindo o mesmo texto volta para a fila");
    tirar(d, listar(d).find((s) => s.texto === "Posso te ligar às 15h?").id);
    const r = await aprovar(d, b.id, "Segue o orçamento, Ana. Qualquer dúvida me chama.", enviar);
    assert.equal(r.editada, true);
    assert.deepEqual(enviados, [[ANA, "Posso te ligar às 15h?"], [ANA, "Segue o orçamento, Ana. Qualquer dúvida me chama."]]);
    assert.deepEqual(listar(d), []);
    assert.match((await aprovar(d, a.id, null, enviar)).erro, /não encontrada/);
    const c = guardar(d, { para: ANA, texto: "terceira" });
    assert.match((await aprovar(d, c.id, "   ", enviar)).erro, /vazio/);
    assert.match((await aprovar(d, c.id, null, async () => ({ ok: false, erro: "gateway fora do ar" }))).erro, /gateway fora do ar/);
    assert.equal(listar(d).length, 1, "o envio falhou: a sugestão continua na fila");
    assert.equal(gastarPasse(d, ANA, "terceira"), false, "e o passe do envio que falhou foi recolhido");
    // Passe vencido não vale.
    const { darPasse } = await import("../../backend-colima/guarda/sugestoes.mjs");
    darPasse(d, ANA, "terceira", 1000);
    assert.equal(gastarPasse(d, ANA, "terceira", 1000 + PASSE_MS + 1), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("fila: linhas estragadas caem, a fila tem teto e a CLI fala JSON", () => {
  const d = pasta();
  try {
    assert.equal(lerLinha("{não é json"), null);
    assert.equal(lerLinha(JSON.stringify({ id: "abcdefghijkl", para: "5511", texto: "x", em: new Date().toISOString() })), null, "destino fora da forma");
    for (let i = 0; i < MAX_FILA + 5; i++) guardar(d, { para: ANA, texto: `m${i}` });
    assert.equal(listar(d).length, MAX_FILA); assert.equal(listar(d)[0].texto, "m5", "saíram as mais antigas");
    writeFileSync(join(d, "whatsapp-sugestoes.jsonl"), `lixo\n${readFileSync(join(d, "whatsapp-sugestoes.jsonl"), "utf8").split("\n")[0]}\n`);
    const cli = (...args) => { try { return JSON.parse(execFileSync(process.execPath, ["backend-colima/guarda/sugestoes.mjs", ...args], { env: { ...process.env, MEU_BOT_DIR: d }, encoding: "utf8" })); } catch (e) { return JSON.parse(e.stdout); } };
    assert.deepEqual(cli("ligar").ligado, true);
    const l = cli("listar");
    assert.equal(l.sugestoes.length, 1); assert.equal(l.pendentes, 1);
    assert.match(cli("aprovar", "nao-e-id").erro, /^uso:/);
    assert.deepEqual(cli("descartar", l.sugestoes[0].id), { ok: true, descartadas: 1 });
    assert.deepEqual(cli("estado").pendentes, 0);
    assert.equal(cli("desligar").ligado, false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
