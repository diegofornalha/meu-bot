import { test } from "node:test";
import assert from "node:assert/strict";
import { LISTAR_COMANDOS, enviarMensagem, rodarComando } from "../../dist/main/terminal/ui-acoes-core.js";

// Roda o trecho contra um `document` de mentira, do jeito que a janela do app responderia.
function rodar(script, doc) { return new Function("document", "CustomEvent", "Event", `return ${script}`)(doc, class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, class { constructor(t) { this.type = t; } }); }

test("comando_listar: devolve o que o renderer pôs no detail; sem resposta é erro, não lista vazia", () => {
  const itens = [{ id: "a:settings", tipo: "ação", rotulo: "Configurações", detalhe: null }];
  assert.deepEqual(rodar(LISTAR_COMANDOS, { dispatchEvent: (e) => { assert.equal(e.type, "meu-bot:comandos"); e.detail.itens = itens; } }), itens);
  assert.throws(() => rodar(LISTAR_COMANDOS, { dispatchEvent: () => {} }), /não respondeu/);
});

test("comando_rodar: o id vai como JSON; id que o renderer não conhece é erro", () => {
  let visto = null;
  assert.equal(rodar(rodarComando('c:"x"'), { dispatchEvent: (e) => { visto = e.detail.id; e.detail.achou = true; } }), true);
  assert.equal(visto, 'c:"x"');
  assert.throws(() => rodar(rodarComando("a:nada"), { dispatchEvent: (e) => { e.detail.achou = false; } }), /desconhecido/);
});

test("conversa_enviar: põe o texto, avisa o campo e clica Enviar; não interrompe o agente", () => {
  const campo = { value: "", disabled: false, eventos: [], dispatchEvent(e) { this.eventos.push(e.type); } };
  const botao = { disabled: false, cliques: 0, classList: { contains: () => false }, click() { this.cliques++; } };
  const doc = { getElementById: (id) => (id === "input" ? campo : id === "btn-send" ? botao : null) };
  assert.equal(rodar(enviarMensagem('diga "oi"\nem duas linhas'), doc), true);
  assert.equal(campo.value, 'diga "oi"\nem duas linhas'); assert.deepEqual(campo.eventos, ["input"]); assert.equal(botao.cliques, 1);
  // Com o agente respondendo o botão é "Parar" (btn-bad): clicar interromperia a resposta.
  const parar = { ...botao, cliques: 0, classList: { contains: (c) => c === "btn-bad" }, click() { this.cliques++; } };
  assert.throws(() => rodar(enviarMensagem("oi"), { getElementById: (id) => (id === "input" ? campo : parar) }), /ainda está respondendo/);
  assert.equal(parar.cliques, 0);
  // Com o agente respondendo a caixa também fica desligada.
  assert.throws(() => rodar(enviarMensagem("oi"), { getElementById: (id) => (id === "input" ? { ...campo, disabled: true } : botao) }), /ainda está respondendo/);
  // Uma página (o Navegador) na frente: não há conversa ativa e o botão fica desligado.
  assert.throws(() => rodar(enviarMensagem("oi"), { getElementById: (id) => (id === "input" ? { ...campo, disabled: true } : { ...botao, disabled: true }) }), /nenhuma conversa na frente/);
  assert.throws(() => rodar(enviarMensagem("oi"), { getElementById: () => null }), /não tem conversa/);
});
