import { test } from "node:test";
import assert from "node:assert/strict";
import { combinaComABusca, filtrarItens, semAcento, textoDeBusca } from "../../conta-api/public/console/busca-core.js";

// Busca do Marketplace no console (conta-api/public/console/busca-core.js): o mesmo critério da página pública.
const ITENS = [
  { id: "pro", tipo: "plano", nome: "Pro", resumo: "O plano base: o agente de IA atendendo no WhatsApp, com Navegador, Gmail e CRM." },
  { id: "ferramenta-googlesheets", tipo: "ferramenta", nome: "Google Sheets", resumo: "Lê e preenche planilhas do Google: linhas, fórmulas e abas.", categoria: "Google", exemplo: "Some o faturamento de outubro na planilha de vendas e me diga o total." },
  { id: "ferramenta-googlecalendar", tipo: "ferramenta", nome: "Google Calendar", resumo: "Consulta a sua agenda, cria e remarca compromissos e convida pessoas.", categoria: "Google", exemplo: "Marque uma reunião de 30 minutos com a Ana na quinta à tarde." },
];
const ids = (termo) => filtrarItens(ITENS, termo).map((i) => i.id);

test("busca do console: sem acento, todas as palavras, em nome, resumo, categoria e exemplo", () => {
  assert.equal(semAcento("Reunião À TARDE"), "reuniao a tarde");
  assert.equal(semAcento(null), "");
  assert.deepEqual(ids(""), ITENS.map((i) => i.id), "busca vazia mostra tudo, na ordem");
  assert.deepEqual(ids("   "), ITENS.map((i) => i.id));
  assert.deepEqual(ids("planilha"), ["ferramenta-googlesheets"]);
  assert.deepEqual(ids("PLANILHAS"), ["ferramenta-googlesheets"]);
  assert.deepEqual(ids("google"), ["ferramenta-googlesheets", "ferramenta-googlecalendar"], "pela categoria");
  assert.deepEqual(ids("reuniao ana"), ["ferramenta-googlecalendar"], "pelo exemplo de pedido, sem acento e em qualquer ordem");
  assert.deepEqual(ids("whatsapp"), ["pro"], "os itens que não são ferramenta também são achados");
  assert.deepEqual(ids("google zebra"), [], "todas as palavras têm de aparecer");
  assert.equal(textoDeBusca({ nome: "Pro", resumo: "x", categoria: undefined, exemplo: null }), "Pro x", "campos ausentes não viram texto");
  assert.equal(combinaComABusca("Calendário", "calendario"), true);
});
