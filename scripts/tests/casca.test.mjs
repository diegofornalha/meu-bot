// A casca (lateral, abas, caixa de mensagem): a lógica pura e as amarras de HTML/CSS que o resto do código usa por id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resumoAgente, linhaDaPagina, etiquetaPro, contagemNavegador, placeholderDaCaixa } from "../../dist/renderer/lib/casca.js";

const ler = (arquivo) => readFileSync(new URL(`../../src/renderer/${arquivo}`, import.meta.url), "utf8");
const l = (visivel, pronto) => ({ visivel, pronto });

test("resumo do Agente: conta só as linhas à mostra e fica verde só com tudo pronto", () => {
  const r = resumoAgente([l(true, false), l(true, true), l(true, true)]);
  assert.deepEqual([r.modo, r.texto, r.tom, r.total, r.prontos], ["resumo", "2 de 3 prontos", "warn", 3, 2]);
  const todas = resumoAgente([l(true, true), l(true, true), l(false, false)]);
  assert.deepEqual([todas.modo, todas.texto, todas.tom], ["resumo", "2 de 2 prontos", "ok"]);
  assert.equal(resumoAgente([l(true, true), l(true, false)]).texto, "1 de 2 pronto");
  assert.equal(resumoAgente([l(true, false), l(true, false)]).texto, "0 de 2 prontos");
});

test("resumo do Agente: uma linha só aparece direto; nenhuma esconde o grupo", () => {
  const uma = resumoAgente([l(false, true), l(true, true), l(false, false)]);
  assert.deepEqual([uma.modo, uma.texto, uma.tom], ["linha", "", "ok"]);
  assert.equal(resumoAgente([l(true, false)]).tom, "warn");
  assert.equal(resumoAgente([l(false, true), l(false, true)]).modo, "grupo-vazio");
  assert.equal(resumoAgente([]).modo, "grupo-vazio");
});

test("linha da lateral da página na frente", () => {
  assert.equal(linhaDaPagina("gmail"), "gmail-line");
  assert.equal(linhaDaPagina("conta-google"), "conta-google-line");
  assert.equal(linhaDaPagina("tut-whatsapp"), "tutoriais-line");
  assert.equal(linhaDaPagina("term-2"), "terminal-line");
  assert.equal(linhaDaPagina("modulo-crm"), "modulos-line");
  for (const sem of [null, "atividade", "wa-5511999999999", "vazia-1"]) assert.equal(linhaDaPagina(sem), null);
});

test("toda linha que linhaDaPagina devolve existe no index.html", () => {
  const html = ler("index.html");
  for (const id of ["tutoriais", "acervo", "conta-google", "gmail", "computador", "inspector", "modulos", "extensao", "navegador", "suporte", "auditoria", "preparar", "usuarios", "claude-global", "link-publico", "term-1"]) {
    assert.ok(html.includes(`id="${linhaDaPagina(id)}"`), `falta a linha de ${id}`);
  }
});

test("etiqueta Pro: só no produto free e só para quem não tem o acesso", () => {
  assert.equal(etiquetaPro("free", "ok"), "");
  for (const a of ["free", "expired", "unknown"]) assert.equal(etiquetaPro("free", a), "Pro");
  assert.equal(etiquetaPro("free", null), "", "licença ainda não lida: em branco, sem piscar");
  assert.equal(etiquetaPro("pro", "assinatura"), "");
});

test("linha do Navegador: abas abertas; sem nenhuma, a etiqueta do plano", () => {
  assert.equal(contagemNavegador(0, "Pro"), "Pro");
  assert.equal(contagemNavegador(0, ""), "");
  assert.equal(contagemNavegador(1, "Pro"), "1 aba");
  assert.equal(contagemNavegador(4, ""), "4 abas");
});

test("texto de exemplo da caixa segue a janela", () => {
  assert.match(placeholderDaCaixa("local"), /comando neste Mac… \(Enter envia/);
  assert.match(placeholderDaCaixa("local", "neste Windows"), /comando neste Windows…/);
  assert.match(placeholderDaCaixa("grokbot-1"), /comando na máquina…/);
  assert.doesNotMatch(placeholderDaCaixa("local"), /VM/);
  // Antes de a janela dizer de quem é: o mesmo texto neutro que o HTML traz.
  assert.ok(ler("index.html").includes(`placeholder="${placeholderDaCaixa("")}"`));
});

test("o grupo Agente guarda as três linhas de estado, com os ids de sempre, dentro de #atalhos", () => {
  const html = ler("index.html");
  const atalhos = /<div id="atalhos"[^>]*>([\s\S]*?)<!-- Seletor de lista/.exec(html);
  assert.ok(atalhos, "#atalhos existe");
  const linhas = /<div id="agente-linhas"[^>]*>([\s\S]*?)\n {12}<\/div>/.exec(atalhos[1]);
  assert.ok(linhas, "#agente-linhas existe dentro de #atalhos");
  for (const id of ["wa-line", "cl-line", "ollama-line", "cl-line-btn", "ollama-line-btn"]) assert.ok(linhas[1].includes(`id="${id}"`), `${id} no grupo Agente`);
  assert.match(atalhos[1], /<button[^>]*id="agente-resumo"[^>]*aria-controls="agente-linhas"/);
  // As páginas ficam fora do grupo recolhível: nenhuma linha de navegação some atrás do resumo.
  assert.ok(!linhas[1].includes("acervo-line"));
});

test("os dois botões redondos da caixa têm nome para leitor de tela", () => {
  const html = ler("index.html");
  for (const id of ["mode-btn", "list-mode-btn"]) assert.match(html, new RegExp(`<button[^>]*id="${id}"[^>]*aria-label="[^"]+"`));
});
