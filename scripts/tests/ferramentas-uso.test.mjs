import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const u = require("../../dist/main/ferramentas/uso-core.js");
const p = require("../../dist/main/ferramentas/permissoes-core.js");

// O agente quer usar uma ferramenta: o que o app decide, e as permissões que a pessoa dá no cartão da conversa.
const pedido = (over = {}) => ({ estado: "pronta", tipo: "leitura", permissao: null, origem: "meu-bot", ...over });
const d = (over) => u.decidirUso(pedido(over));

test("decidirUso, numa conversa do app: cada situação vira executar, um cartão ou recusa", () => {
  assert.deepEqual(d(), { acao: "executar" }, "leitura em app conectado roda sem cartão");
  assert.deepEqual(d({ tipo: "escrita" }), { acao: "cartao", cartao: "confirmar" });
  assert.deepEqual(d({ tipo: "desconhecido" }), { acao: "cartao", cartao: "confirmar" }, "na dúvida, pergunta");
  assert.deepEqual(d({ tipo: "escrita", permissao: "sempre" }), { acao: "executar" });
  assert.deepEqual(d({ tipo: "leitura", permissao: "nunca" }), { acao: "recusar", motivo: "nunca" }, "o 'nunca' vale até para leitura");
  assert.deepEqual(d({ estado: "falta-conectar" }), { acao: "cartao", cartao: "conectar" });
  assert.deepEqual(d({ estado: "falta-conectar", tipo: "escrita", permissao: "sempre" }), { acao: "cartao", cartao: "conectar" }, "primeiro a conexão, depois a permissão");
  assert.deepEqual(d({ estado: "a-venda" }), { acao: "cartao", cartao: "comprar" });
  assert.deepEqual(d({ estado: "a-venda", permissao: "sempre" }), { acao: "cartao", cartao: "comprar" }, "permissão antiga não libera o que não está contratado");
  assert.deepEqual(d({ estado: "desconhecida" }), { acao: "recusar", motivo: "desconhecida" });
});

test("decidirUso, vindo do WhatsApp (sem tela): nada de cartão; escrita só com 'Permitir sempre' dado antes", () => {
  const wa = (over) => d({ origem: "whatsapp", ...over });
  assert.deepEqual(wa(), { acao: "executar" });
  assert.deepEqual(wa({ tipo: "escrita" }), { acao: "recusar", motivo: "sem-tela" });
  assert.deepEqual(wa({ tipo: "desconhecido" }), { acao: "recusar", motivo: "sem-tela" });
  assert.deepEqual(wa({ tipo: "escrita", permissao: "sempre" }), { acao: "executar" });
  assert.deepEqual(wa({ estado: "falta-conectar" }), { acao: "recusar", motivo: "falta-conectar" });
  assert.deepEqual(wa({ estado: "a-venda" }), { acao: "recusar", motivo: "nao-contratada" });
  assert.deepEqual(d({ origem: "claude-code", tipo: "escrita" }), { acao: "recusar", motivo: "sem-tela" }, "quem não é conversa do app não tem cartão");
});

test("depois do cartão: permitir executa, cancelar e nunca recusam; cartão sem resposta expira em 5 minutos", () => {
  assert.deepEqual(u.depoisDeConfirmar("agora"), { acao: "executar" });
  assert.deepEqual(u.depoisDeConfirmar("sempre"), { acao: "executar" });
  assert.deepEqual(u.depoisDeConfirmar("cancelar"), { acao: "recusar", motivo: "cancelado" });
  assert.deepEqual(u.depoisDeConfirmar("nunca"), { acao: "recusar", motivo: "nunca" });
  assert.equal(u.ESPERA_DO_CARTAO_MS, 300_000);
  assert.equal(u.cartaoExpirou(1000, 1000 + 299_999), false);
  assert.equal(u.cartaoExpirou(1000, 1000 + 300_000), true);
});

test("frases para o agente: dizem o que houve e que não é para tentar outro caminho", () => {
  for (const m of ["desconhecida", "nao-contratada", "falta-conectar", "sem-tela", "nunca", "cancelado", "expirou"]) {
    const f = u.fraseDaRecusa(m, "Gmail");
    assert.ok(f.length > 30 && f.includes("Gmail"), m);
  }
  assert.match(u.fraseDaRecusa("cancelado", "Gmail"), /Não tente de novo nem por outro caminho/);
  assert.match(u.fraseDaRecusa("sem-tela", "Gmail"), /app meu-bot/);
  assert.match(u.fraseDaRecusa("expirou", "Gmail"), /5 minutos/);
  assert.match(u.fraseDoCartao("conectar", "Google Analytics"), /é só autorizar ali/);
  assert.match(u.fraseDoCartao("comprar", "Notion"), /Marketplace/);
});

test("tipoDaAcao: a marca do serviço manda; sem ela, só o que é claramente consulta conta como leitura", () => {
  assert.equal(u.tipoDaAcao({ nome: "GMAIL_SEND_EMAIL", somenteLeitura: true }), "leitura", "a marca vence o nome");
  assert.equal(u.tipoDaAcao({ nome: "GMAIL_FETCH_EMAILS", somenteLeitura: false }), "escrita");
  for (const n of ["GMAIL_FETCH_EMAILS", "GOOGLESHEETS_GET_SPREADSHEET_INFO", "NOTION_SEARCH_PAGES", "GOOGLECALENDAR_LIST_EVENTS", "hubspot.find.contact"]) assert.equal(u.tipoDaAcao({ nome: n }), "leitura", n);
  for (const n of ["GMAIL_SEND_EMAIL", "GOOGLECALENDAR_CREATE_EVENT", "NOTION_UPDATE_PAGE", "GOOGLEDRIVE_DELETE_FILE", "SLACK_POST_MESSAGE"]) assert.equal(u.tipoDaAcao({ nome: n }), "escrita", n);
  // "Buscar e apagar": um verbo de escrita no nome basta.
  assert.equal(u.tipoDaAcao({ nome: "GMAIL_GET_AND_DELETE_DRAFT" }), "escrita");
  // Relatório que "roda", ou nome sem verbo conhecido: pergunta.
  assert.equal(u.tipoDaAcao({ nome: "GOOGLEANALYTICS_RUN_REPORT" }), "escrita");
  assert.equal(u.tipoDaAcao({ nome: "STRIPE_BALANCE" }), "desconhecido");
});

test("permissões: 'sempre' e 'nunca' ficam guardados por conta, app e ação; 'uma vez' e 'cancelar', não", () => {
  let g = {};
  g = p.guardarPermissao(g, "c1", "gmail", "GMAIL_SEND_EMAIL", "agora");
  g = p.guardarPermissao(g, "c1", "gmail", "GMAIL_SEND_EMAIL", "cancelar");
  assert.deepEqual(g, {}, "nada guardado");
  const antes = g;
  g = p.guardarPermissao(g, "c1", "gmail", "GMAIL_SEND_EMAIL", "sempre");
  assert.deepEqual(antes, {}, "o objeto de entrada não muda");
  g = p.guardarPermissao(g, "c1", "gmail", "GMAIL_DELETE_EMAIL", "nunca");
  g = p.guardarPermissao(g, "c1", "notion", "NOTION_UPDATE_PAGE", "sempre");
  g = p.guardarPermissao(g, "c2", "gmail", "GMAIL_SEND_EMAIL", "nunca");
  assert.equal(p.permissaoGuardada(g, "c1", "gmail", "GMAIL_SEND_EMAIL"), "sempre");
  assert.equal(p.permissaoGuardada(g, "c1", "gmail", "GMAIL_DELETE_EMAIL"), "nunca");
  assert.equal(p.permissaoGuardada(g, "c2", "gmail", "GMAIL_SEND_EMAIL"), "nunca", "outra conta, outra resposta");
  assert.equal(p.permissaoGuardada(g, "c1", "gmail", "GMAIL_REPLY"), null, "permitir uma ação não libera as outras do app");
  assert.equal(p.permissaoGuardada(g, "c3", "gmail", "GMAIL_SEND_EMAIL"), null);
  assert.deepEqual(p.permissoesDaConta(g, "c1"), [{ app: "gmail", acao: "GMAIL_DELETE_EMAIL", permite: false }, { app: "gmail", acao: "GMAIL_SEND_EMAIL", permite: true }, { app: "notion", acao: "NOTION_UPDATE_PAGE", permite: true }]);

  // Revogar: a ação volta a perguntar, e o que ficou vazio some.
  g = p.revogarPermissao(g, "c1", "notion", "NOTION_UPDATE_PAGE");
  assert.equal(p.permissaoGuardada(g, "c1", "notion", "NOTION_UPDATE_PAGE"), null);
  assert.equal(g.c1.notion, undefined);
  g = p.revogarPermissao(g, "c2", "gmail", "GMAIL_SEND_EMAIL");
  assert.equal(g.c2, undefined);
  assert.equal(p.revogarPermissao(g, "c9", "x", "y"), g, "revogar o que não existe não mexe em nada");
});

test("permissões lidas do disco: o que está fora da forma é descartado", () => {
  const lido = p.lerPermissoes({ c1: { gmail: { GMAIL_SEND_EMAIL: true, "ruim acao!": true, OUTRA: "sim" }, "App Ruim": { X: true }, notion: "x" }, c2: [], c3: { slack: { SLACK_POST_MESSAGE: false } } });
  assert.deepEqual(lido, { c1: { gmail: { GMAIL_SEND_EMAIL: true } }, c3: { slack: { SLACK_POST_MESSAGE: false } } });
  for (const lixo of [null, undefined, [], "x", 3]) assert.deepEqual(p.lerPermissoes(lixo), {});
});
