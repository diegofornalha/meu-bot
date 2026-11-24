import { test } from "node:test";
import assert from "node:assert/strict";
import { ONBOARD_STEPS, advanceOnboard, initialOnboardState, pickFeedback, welcomeMessage } from "../../dist/renderer/lib/onboarding.js";

test("só o evento do passo atual avança; os outros são ignorados", () => {
  let s = initialOnboardState();
  let r = advanceOnboard(s, "new-tab");
  assert.equal(r.advanced, false);
  assert.equal(r.state.step, 0);
  r = advanceOnboard(r.state, "sidebar");
  assert.equal(r.advanced, true);
  assert.equal(r.state.step, 1);
  assert.equal(r.finished, false);
});

test("fechar a paleta só conta depois de abrir", () => {
  const s = { step: 1, armed: false };
  assert.equal(advanceOnboard(s, "palette-close").advanced, false);
  const armed = advanceOnboard(s, "palette-open").state;
  assert.equal(armed.armed, true);
  const r = advanceOnboard(armed, "palette-close");
  assert.equal(r.advanced, true);
  assert.equal(r.state.step, 2);
  assert.equal(r.state.armed, false);
});

test("a sequência inteira termina em finished ao criar a primeira conversa", () => {
  let s = initialOnboardState();
  const seq = ["sidebar", "palette-open", "palette-close", "settings-closed", "new-tab"];
  let last;
  for (const ev of seq) { last = advanceOnboard(s, ev); s = last.state; }
  assert.equal(last.finished, true);
  assert.equal(s.step, ONBOARD_STEPS.length);
  assert.equal(advanceOnboard(s, "new-tab").finished, true);
  assert.equal(ONBOARD_STEPS.length, 4);
});

test("feedback varia conforme o sorteio e não repete o anterior", () => {
  const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  assert.equal(pickFeedback(seq(0.1, 0)).kind, "text");
  assert.equal(pickFeedback(seq(0.5, 0)).kind, "icon");
  assert.equal(pickFeedback(seq(0.9)).kind, "none");
  // dois "nada" seguidos viram ícone, para a sequência não ficar previsível
  assert.equal(pickFeedback(seq(0.9, 0), { kind: "none" }).kind, "icon");
  const first = pickFeedback(seq(0.1, 0));
  const second = pickFeedback(seq(0.1, 0), first);
  assert.notEqual(second.text, first.text);
});

test("boas-vindas: deslogado pede o login; logado ou desconhecido sugere o que fazer", () => {
  const off = welcomeMessage("agente-box", false);
  assert.match(off, /\*\*agente-box\*\*/);
  assert.match(off, /entrar no Claude Code/);
  assert.doesNotMatch(off, /ideias para começar/);
  for (const v of [true, null]) {
    const on = welcomeMessage("este Mac", v);
    assert.match(on, /ideias para começar/);
    assert.doesNotMatch(on, /falta \*\*entrar/);
  }
});

import { AI_CHOICES, AI_NONE_INFO, parseAiChoice, preselecao, pularEscolhaIa, tutorialDaEscolha } from "../../dist/renderer/lib/onboarding.js";

const contas = (claude, { global = false } = {}) => ({ claude: { loggedIn: claude, global } });

test("escolha de IA: só o Claude e \"não tenho nenhuma\"; cada opção leva ao tutorial certo", () => {
  assert.deepEqual(AI_CHOICES.map((o) => o.id), ["claude", "nenhuma"], "o Grok saiu do app (virou módulo): não é mais uma escolha da primeira abertura");
  assert.equal(tutorialDaEscolha("claude"), "claude-login");
  assert.equal(tutorialDaEscolha("nenhuma"), null);
  assert.deepEqual(AI_NONE_INFO.links.map((l) => l.url), ["https://claude.ai"]);
  for (const o of AI_CHOICES) assert.doesNotMatch(`${o.title} ${o.text}`, /Grok|xAI/);
  assert.doesNotMatch(AI_NONE_INFO.text, /Grok|tutorial 4/);
});

test("escolha de IA: pré-seleção pela conta logada", () => {
  assert.equal(preselecao(contas(null)), null);
  assert.equal(preselecao(contas(false)), null);
  assert.equal(preselecao(contas(true)), "claude");
});

test("escolha de IA: Claude Global pula a pergunta", () => {
  assert.equal(pularEscolhaIa(contas(true, { global: true })), true);
  assert.equal(pularEscolhaIa(contas(true)), false);
});

test("escolha de IA: escolha guardada por uma versão anterior não prende ninguém", () => {
  assert.equal(parseAiChoice("claude"), "claude");
  assert.equal(parseAiChoice("nenhuma"), "nenhuma");
  assert.equal(parseAiChoice("ambos"), "claude", "quem tinha os dois tem o Claude");
  assert.equal(parseAiChoice("grok"), null, "a opção não existe mais: a pergunta volta sem nada marcado");
  assert.equal(parseAiChoice("outra"), null);
  assert.equal(parseAiChoice(null), null);
});

import { comModoGratis } from "../../dist/renderer/lib/onboarding.js";

test("escolha de IA: com o modo grátis, \"Não tenho nenhuma\" promete instalar; sem ele, o texto de assinar", () => {
  const com = comModoGratis(AI_CHOICES, true).find((o) => o.id === "nenhuma");
  const sem = comModoGratis(AI_CHOICES, false).find((o) => o.id === "nenhuma");
  assert.match(com.text, /de graça/);
  assert.match(sem.text, /como assinar/);
  assert.equal(comModoGratis(AI_CHOICES, true).length, AI_CHOICES.length);
});
