import assert from "node:assert/strict";
import { test } from "node:test";
import { TUTORIAIS, emptyContext, emptyFlags, guideTabTitle, guideView, parseTutMemory, parseTutPulados, sidebarBadge, tutorialKnown, tutorialState, GUIDE_SOURCES, tutorialBadge, tutorialNumber, visibleTutorials } from "../../dist/renderer/lib/tutoriais.js";
import { quemEscolhido } from "../../dist/renderer/lib/whatsapp-grupos.js";

const wa = (over = {}) => ({ present: true, gateway: "openclaw", agent: "OpenClaw", ready: false, missing: null, connected: false, state: "", number: null, loggedOut: false, detail: "", dmPolicy: null, channelConfig: null, audioIn: false, audioOut: null, ...over });
const t = TUTORIAIS.find((x) => x.id === "whatsapp-openclaw");
const byId = (id) => TUTORIAIS.find((x) => x.id === id);

test("tutoriais: ids únicos e cada passo com título, texto, alvo e regra de conclusão", () => {
  for (const tut of TUTORIAIS) {
    assert.match(tut.id, /^[a-z0-9-]+$/);
    assert.ok(tut.title && tut.short && tut.summary && tut.minutes > 0 && tut.steps.length > 0);
    for (const s of tut.steps) assert.ok(s.id && s.title && s.target && typeof s.done === "function" && (tut.comingSoon === true || s.text));
  }
  assert.equal(new Set(TUTORIAIS.map((x) => x.id)).size, TUTORIAIS.length);
});

test("selo: número, passos e minutos; sem número, só os dois", () => {
  assert.equal(tutorialBadge(t), "Tutorial 3 · 5 passos · 4 min");
  assert.equal(tutorialBadge({ ...t, minutes: 1, steps: [t.steps[0]] }, false), "1 passo · 1 min");
  assert.equal(tutorialBadge(byId("statusline")), "Tutorial 17 · 4 passos · 3 min");
});

test("trilha numerada: números 1..N únicos na ordem; `after` aponta para um tutorial anterior; só o suporte exige o pacote", () => {
  // Renumerados em 31 out (e de novo em 3 nov, quando o "Ouvir áudios" saiu) na ordem da trilha (a lista aparece na
  // ordem do array): os que podem entrar na lista são 1..16, sem buracos; os ocultos por decisão de produto ficam no
  // fim (17 status line; 18 o CRM, em duas versões pela licença/motor, CRM no Gmail com o CRM próprio ou CRM pelo
  // Streak no resto, nunca juntas).
  assert.deepEqual(TUTORIAIS.map((x) => x.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 18]);
  assert.deepEqual(TUTORIAIS.filter((x) => x.oculto !== true).map((x) => x.number), Array.from({ length: 16 }, (_, i) => i + 1), "a lista sai 1, 2, 3… sem buraco");
  for (let i = 1; i < TUTORIAIS.length; i++) assert.ok(TUTORIAIS[i - 1].number <= TUTORIAIS[i].number, `${TUTORIAIS[i].id} fora da ordem dos números`);
  for (const produto of [{ planoExigido: "free", crmProprio: false, crmStreak: true }, { planoExigido: "free", crmProprio: true, crmStreak: false }]) {
    const nums = visibleTutorials({ ...emptyContext(), produto }, () => true).map((x) => x.number);
    assert.deepEqual(nums, [...new Set(nums)], `números únicos no produto ${JSON.stringify(produto)}`);
  }
  assert.deepEqual(TUTORIAIS.slice(0, 8).map((x) => x.id), ["claude-login", "contas-claude", "whatsapp-openclaw", "xai-login", "fallback-contas", "suporte", "whatsapp-objetivo", "guarda-whatsapp"]);
  for (const x of TUTORIAIS) if (x.after !== undefined) { const prev = byId(x.after); assert.ok(prev && prev.number < x.number, `${x.id} depois de ${x.after}`); }
  assert.deepEqual(TUTORIAIS.filter((x) => x.needsSupport).map((x) => x.id), ["suporte"]);
  assert.equal(tutorialNumber("statusline"), 17); assert.equal(tutorialNumber("nada"), null);
});

test("visibleTutorials: 2 e 4 só depois do 1 concluído; 5 só depois do 4; sem pré-requisito, some em vez de ir para arquivados", () => {
  const ids = (finished) => visibleTutorials(emptyContext(), finished).map((x) => x.id);
  assert.deepEqual(ids(() => false), ["claude-login", "whatsapp-openclaw", "whatsapp-objetivo"]);
  assert.deepEqual(ids((x) => x.id === "claude-login"), ["claude-login", "contas-claude", "whatsapp-openclaw", "xai-login", "whatsapp-objetivo", "navegador", "contas-cli", "link-publico", "entrada-rapida", "gmail"], "o 16 (status line) está oculto: o admin instala ao criar a conta");
  assert.ok(!ids((x) => x.id === "claude-login" || x.id === "navegador").includes("crm-whatsapp"), "o 17 (CRM pelo Streak) está oculto, mesmo depois do 9 (Navegador)");
  assert.ok(!ids((x) => x.id === "claude-login" || x.id === "navegador").includes("crm-gmail"), "o CRM no Gmail só com o CRM próprio liberado pela licença");
  const crm = { ...emptyContext(), produto: { planoExigido: "free", crmProprio: true, crmStreak: false } };
  const idsCrm = visibleTutorials(crm, (x) => x.id === "claude-login" || x.id === "navegador").map((x) => x.id);
  assert.ok(!idsCrm.includes("crm-gmail") && !idsCrm.includes("crm-whatsapp"), "o 17 (CRM no Gmail) está oculto e, com o CRM próprio, o do Streak também não entra");
  assert.ok(ids((x) => x.id === "claude-login" || x.id === "xai-login").includes("fallback-contas"));
  assert.deepEqual(ids(), ids(() => false), "sem `finished`, nada da trilha destravado");
});

test("tutorial 1 · Entrar no Claude Code: login → e-mail (ou \"Vi minha conta\") → primeira resposta; sequencial", () => {
  const t1 = byId("claude-login");
  const c = (claude) => ({ ...emptyContext(), claude: { loggedIn: null, email: null, firstReply: false, ...claude } });
  assert.equal(guideView(t1, null, emptyFlags(), c({})).current, 0, "não consultado ainda");
  assert.equal(guideView(t1, null, emptyFlags(), c({ loggedIn: false })).current, 0);
  assert.equal(guideView(t1, null, emptyFlags(), c({ loggedIn: true })).current, 1, "logado sem e-mail: conferir");
  assert.equal(guideView(t1, null, { ...emptyFlags(), claudeSeen: true }, c({ loggedIn: true })).current, 2, "\"Vi minha conta\" destrava");
  assert.equal(guideView(t1, null, emptyFlags(), c({ loggedIn: true, email: "a@b" })).current, 2);
  assert.equal(guideView(t1, null, emptyFlags(), c({ loggedIn: true, email: "a@b", firstReply: true })).finished, true);
  assert.equal(guideView(t1, null, emptyFlags(), c({ loggedIn: false, email: "a@b", firstReply: true })).current, 0, "deslogou: volta ao passo 1");
  assert.equal(t1.steps[0].body, "claude-login"); assert.equal(t1.steps[2].target, "chat");
  assert.equal(guideTabTitle(t1, guideView(t1, null, emptyFlags(), c({ loggedIn: true, email: "a@b" }))), "1 · Claude 2/3");
});

test("tutorial 4 · Entrar na xAI (Grok): preparar → entrar → grok-4 respondeu; some onde o Grok não é possível", () => {
  const t4 = byId("xai-login");
  assert.equal(t4.after, "claude-login"); assert.equal(t4.needsXai, true); assert.ok(t4.comingSoon !== true);
  const c = (xai) => ({ ...emptyContext(), xai: { possible: null, pronto: null, loggedIn: null, label: null, ...xai } });
  assert.equal(guideView(t4, null, emptyFlags(), c({})).current, 0, "não consultado: preparar");
  assert.equal(guideView(t4, null, emptyFlags(), c({ pronto: false })).current, 0);
  assert.equal(guideView(t4, null, emptyFlags(), c({ pronto: true, loggedIn: false })).current, 1, "proxy pronto: entrar");
  assert.equal(guideView(t4, null, emptyFlags(), c({ pronto: false, loggedIn: true })).current, 0, "logada sem o proxy (Hermes global da máquina, conta sem preparo): volta ao preparar");
  assert.equal(guideView(t4, null, emptyFlags(), c({ pronto: true, loggedIn: true })).current, 2, "logada: ver o grok-4 responder");
  assert.equal(guideView(t4, null, { ...emptyFlags(), grokReplied: true }, c({ pronto: true, loggedIn: true })).finished, true);
  assert.equal(guideView(t4, null, { ...emptyFlags(), grokReplied: true }, c({ pronto: true, loggedIn: false })).current, 1, "deslogou: volta a entrar");
  assert.equal(t4.steps[0].body, "xai-prepare"); assert.equal(t4.steps[1].body, "xai-login"); assert.equal(t4.steps[2].target, "chat");
  assert.equal(tutorialBadge(t4), "Tutorial 4 · 3 passos · 3 min");
  assert.equal(guideTabTitle(t4, guideView(t4, null, emptyFlags(), c({ pronto: true }))), "4 · Grok 1/3");
  const done1 = (x) => x.id === "claude-login";
  const ids = (xai, fin = done1) => visibleTutorials(c(xai), fin).map((x) => x.id);
  assert.ok(ids({ possible: null }).includes("xai-login"), "sem consultar ainda, mostra");
  assert.ok(ids({ possible: true }).includes("xai-login"));
  assert.ok(!ids({ possible: false }).includes("xai-login"), "este Mac / sem backend: some");
  assert.ok(!ids({ possible: false }, (x) => x.id === "claude-login" || x.id === "xai-login").includes("fallback-contas"), "o 5 some junto com o 4");
  assert.ok(ids({ possible: true }, (x) => x.id === "claude-login" || x.id === "xai-login").includes("fallback-contas"));
});

test("tutorial 5 · Fallback: duas contas → escolher primário → ver a reserva assumir (ou \"Entendi\")", () => {
  const t5 = byId("fallback-contas");
  assert.equal(t5.after, "xai-login"); assert.equal(t5.needsXai, true); assert.ok(t5.comingSoon !== true, "não é mais 'em breve'");
  const chain = [{ name: "agente", available: true }, { name: "grok-4", available: true }];
  const c = (over) => ({ ...emptyContext(), claude: { loggedIn: true, email: "a@b", firstReply: true }, xai: { possible: true, pronto: true, loggedIn: true, label: "x" }, fallback: { primary: "agente", chain }, ...over });
  assert.equal(guideView(t5, null, emptyFlags(), c({ xai: { possible: true, pronto: true, loggedIn: false, label: null } })).current, 0, "sem a xAI: passo 1");
  assert.equal(guideView(t5, null, emptyFlags(), c({ claude: { loggedIn: false, email: null, firstReply: false } })).current, 0, "sem o Claude: passo 1");
  assert.equal(guideView(t5, null, emptyFlags(), c({})).current, 1, "duas contas: escolher");
  assert.equal(guideView(t5, null, { ...emptyFlags(), fallbackChosen: true }, c({ fallback: { primary: "claudecode", chain } })).current, 1, "primário fora da corrente não conta");
  assert.equal(guideView(t5, null, { ...emptyFlags(), fallbackChosen: true }, c({ fallback: { primary: "grok-4", chain } })).current, 2, "escolheu grok-4: ver a reserva");
  assert.equal(guideView(t5, null, { ...emptyFlags(), fallbackChosen: true, fallbackSeen: true }, c({})).finished, true);
  assert.equal(t5.steps[1].body, "fallback-order"); assert.deepEqual(t5.steps[2].manual, { label: "Entendi como funciona", flag: "fallbackSeen" });
  assert.equal(tutorialBadge(t5), "Tutorial 5 · 3 passos · 2 min");
  // a linha da corrente, igual em Configurações e no guia
});

test("tutorial 8 · Guarda do WhatsApp: depois do 3; ativa → entendi", () => {
  const t8 = byId("guarda-whatsapp");
  assert.equal(t8.after, "whatsapp-openclaw"); assert.equal(t8.steps[0].body, "guarda-install");
  const c = (g) => ({ ...emptyContext(), guarda: { installed: g } });
  assert.equal(guideView(t8, null, emptyFlags(), c(null)).current, 0);
  assert.equal(guideView(t8, null, emptyFlags(), c(true)).current, 1);
  assert.equal(guideView(t8, null, { ...emptyFlags(), guardaSeen: true }, c(true)).finished, true);
  assert.equal(guideView(t8, null, { ...emptyFlags(), guardaSeen: true }, c(false)).current, 0, "tirou a guarda: volta ao passo 1");
  const comGuarda = { ...emptyContext(), guarda: { installed: null, possible: true } };
  assert.ok(!visibleTutorials(comGuarda, () => false).map((x) => x.id).includes("guarda-whatsapp"));
  assert.ok(visibleTutorials(comGuarda, (x) => x.id === "whatsapp-openclaw").map((x) => x.id).includes("guarda-whatsapp"));
});

test("selo da lateral: número = pendências (interruptor desliga); pulso = novidade (não obedece ao interruptor)", () => {
  assert.deepEqual(sidebarBadge({ todo: 3, novos: 0, avisar: true }), { text: "3", pulse: false });
  assert.deepEqual(sidebarBadge({ todo: 3, novos: 2, avisar: true }), { text: "3", pulse: true });
  assert.equal(sidebarBadge({ todo: 3, novos: 0, avisar: false }), null);
  assert.deepEqual(sidebarBadge({ todo: 3, novos: 2, avisar: false }), { text: "2", pulse: true });
  assert.equal(sidebarBadge({ todo: 0, novos: 0, avisar: true }), null);
});

test("guia do WhatsApp: o estado real marca os passos; QR já lido pula direto para a escolha", () => {
  assert.deepEqual(guideView(t, null, emptyFlags()), { done: [false, false, false, false, false], current: 0, finished: false });
  // Escolher o agente: feito com a escolha gravada ou com um dos dois já atendendo; sem nada na máquina, é o passo 1.
  assert.equal(guideView(t, wa({ present: false, gateway: null }), emptyFlags()).current, 0);
  assert.equal(guideView(t, wa({ present: false, gateway: null, escolha: "hermes" }), emptyFlags()).current, 1);
  assert.equal(guideView(t, wa({ gateway: "hermes", escolha: null }), emptyFlags()).current, 1);
  assert.equal(guideView(t, wa({ ready: true }), emptyFlags()).current, 2);
  // Pareado: direto para quem o agente responde (a transcrição liga sozinha; saiu dos tutoriais em 3 nov).
  const v = guideView(t, wa({ ready: true, connected: true, dmPolicy: "allowlist" }), emptyFlags());
  assert.deepEqual(v.done, [true, true, true, false, false]);
  assert.equal(v.current, 3, "o padrão gravado sozinho não conta como escolha");
  assert.ok(!t.steps.some((s) => s.id === "audio"), "a transcrição não é mais passo do tutorial 3");
  const pareado = { ready: true, connected: true, dmPolicy: "allowlist" };
  assert.equal(guideView(t, wa({ ...pareado, dmPolicy: "open" }), emptyFlags()).current, 4, "open é escolha explícita");
  assert.equal(guideView(t, wa(pareado), { policyChosen: true, tested: false }).current, 4, "escolheu quem responde: falta o teste");
  assert.equal(guideView(t, wa(pareado), { policyChosen: true, tested: true }).finished, true, "sem transcrição, o tutorial 3 conclui");
});

test("tutorial 16 (digitando…): depois do 3, só onde o agente aceita o ajuste; a escolha gravada conclui o passo 1, conferir é à mão", () => {
  const d = TUTORIAIS.find((x) => x.id === "digitando-whatsapp");
  assert.equal(d.number, 16); assert.equal(d.after, "whatsapp-openclaw"); assert.deepEqual(d.needs, ["whatsapp"]); assert.equal(d.needsDigitando, true);
  assert.deepEqual(d.steps.map((s) => s.body), ["digitando-escolher", undefined]);
  assert.equal(guideView(d, null, emptyFlags()).current, 0);
  assert.equal(guideView(d, wa({ ready: true, connected: true }), emptyFlags()).current, 0, "chave vazia (automático) ainda não é escolha");
  assert.equal(guideView(d, wa({ ready: true, connected: true, typingMode: null }), emptyFlags()).current, 0);
  assert.equal(guideView(d, wa({ ready: true, connected: true, typingMode: "thinking" }), emptyFlags()).current, 0, "modo ajustado à mão fora dos dois cartões não conclui");
  assert.equal(guideView(d, wa({ ready: true, connected: false, typingMode: "instant" }), emptyFlags()).current, 0, "desconectado não conta");
  assert.equal(guideView(d, wa({ ready: true, connected: true, typingMode: "instant" }), emptyFlags()).current, 1, "mostrar: falta conferir");
  assert.equal(guideView(d, wa({ ready: true, connected: true, typingMode: "never" }), emptyFlags()).current, 1, "não mostrar também é escolha");
  assert.equal(guideView(d, wa({ ready: true, connected: true, typingMode: "never" }), { ...emptyFlags(), digitandoVisto: true }).finished, true);
  assert.equal(guideView(d, wa({ ready: true, connected: true }), { ...emptyFlags(), digitandoVisto: true }).finished, false, "conferir não pula a escolha");
  const done = (x) => x.id === "claude-login" || x.id === "whatsapp-openclaw";
  const ids = (possible) => visibleTutorials({ ...emptyContext(), digitando: { possible } }, done).map((x) => x.id);
  assert.ok(ids(true).includes("digitando-whatsapp"));
  assert.ok(!ids(null).includes("digitando-whatsapp"), "sem status ainda, fica de fora (senão aparecia e sumia)");
  assert.ok(!ids(false).includes("digitando-whatsapp"), "agente sem o ajuste (PicoClaw) não vê o tutorial");
  assert.ok(!visibleTutorials({ ...emptyContext(), digitando: { possible: true } }, (x) => x.id === "claude-login").map((x) => x.id).includes("digitando-whatsapp"), "só com o 3 concluído");
  for (const st of d.steps) assert.ok(!/OpenClaw/.test(st.title) && !/OpenClaw/.test(st.text), `passo ${st.id} sem nome de produto`);
  assert.ok(!/OpenClaw/.test(d.summary));
});

test("título da aba do guia: progresso, e ✓ quando termina", () => {
  assert.equal(guideTabTitle(t, guideView(t, wa({ ready: true, connected: true }), emptyFlags())), "3 · WhatsApp 3/5");
  assert.equal(guideTabTitle(t, guideView(t, wa({ ready: true, connected: true, dmPolicy: "open" }), { policyChosen: true, tested: true })), "3 · WhatsApp ✓");
});

test("guia é sequencial: marcações antigas não acendem passos à frente de um pendente", () => {
  const v = guideView(t, wa({ ready: true, connected: false }), { policyChosen: true, tested: true });
  assert.deepEqual(v.done, [true, true, false, false, false]);
  assert.equal(v.current, 2);
  assert.equal(guideTabTitle(t, v), "3 · WhatsApp 2/5");
});

test("tutorial do suporte: some sem o pacote; passos pelo estado real; conclui quando a entrega chega", async () => {

  const sup = TUTORIAIS.find((x) => x.id === "suporte");
  assert.equal(sup.number, 6, "depois do fallback: o buraco de quem não tem o pacote fica entre os opcionais");
  const s = (over) => ({ ...emptyContext(), support: { available: true, admin: "Lucas", on: false, name: "", log: [], deliveredAt: null, ...over } });
  assert.ok(!visibleTutorials(emptyContext()).includes(sup));
  assert.ok(!visibleTutorials(s({ available: false })).includes(sup));
  assert.ok(visibleTutorials(s({})).includes(sup));
  const wa0 = wa();
  // Dois passos: "Dizer seu nome" (salvar liga; só o admin desliga) e "O que o admin recebe" (conclui com a entrega).
  assert.equal(sup.steps.length, 2);
  assert.equal(guideView(sup, wa0, emptyFlags(), s({})).current, 0);
  assert.equal(guideView(sup, wa0, emptyFlags(), s({ name: "Bia" })).current, 0, "nome sem suporte ligado ainda é o passo 1");
  assert.equal(guideView(sup, wa0, emptyFlags(), s({ name: "Bia", on: true })).current, 1, "ligado, falta a entrega");
  assert.equal(guideView(sup, wa0, emptyFlags(), s({ name: "Bia", on: true, deliveredAt: "2026-10-16T12:00:00Z" })).finished, true);
  assert.equal(guideView(sup, wa0, emptyFlags(), s({ name: "Bia", on: false, deliveredAt: "2026-10-16T12:00:00Z" })).current, 0, "desligado pelo admin volta ao começo");
  for (const st of sup.steps) assert.doesNotMatch(`${st.title} ${st.text}`, /Lucas|\{admin\}/, "sem o nome de quem dá o suporte");
});

test("tutorial da status line: oculto da lista (o admin instala ao criar a conta); o guia continua existindo: instalar, depois os limites no rodapé", async () => {
  const sl = TUTORIAIS.find((x) => x.id === "statusline");
  assert.equal(sl.number, 17); assert.equal(sl.oculto, true);
  assert.ok(!visibleTutorials(emptyContext()).includes(sl), "sem o 1 concluído não aparece");
  assert.ok(!visibleTutorials(emptyContext(), (x) => x.id === "claude-login").includes(sl), "nem com o 1 concluído: saiu da lista em 30 out");
  assert.ok(!visibleTutorials(emptyContext(), () => true).includes(sl));
  const ALL = { model: true, ctx: true, account: true, session: true, weekly: true };
  const c = (installed, limits, segments = null) => ({ ...emptyContext(), statusLine: { installed, limits, segments } });
  assert.equal(guideView(sl, null, emptyFlags(), c(null, false)).current, 0, "ainda não consultado");
  assert.equal(guideView(sl, null, emptyFlags(), c(false, true)).current, 0);
  assert.equal(guideView(sl, null, emptyFlags(), c(true, false)).current, 1, "instalada: falta escolher o que aparece");
  assert.equal(guideView(sl, null, emptyFlags(), c(true, false, ALL)).current, 2, "escolheu: falta conferir no terminal");
  assert.equal(guideView(sl, null, { ...emptyFlags(), statusTested: true }, c(true, false, ALL)).current, 3, "conferiu: faltam os limites");
  assert.equal(guideView(sl, null, { ...emptyFlags(), statusTested: true }, c(true, true, ALL)).finished, true);
  assert.equal(guideView(sl, null, { ...emptyFlags(), statusTested: true }, c(true, true)).current, 1, "sem escolher não pula");
  const { GUIDE_ACTION_LABEL } = await import("../../dist/renderer/lib/tutoriais.js");
  assert.equal(sl.steps.at(-1).target, "chat", "o último passo leva à conversa, onde a status line aparece");
  assert.equal(GUIDE_ACTION_LABEL.chat, "Ir para a conversa");
});

test("tutorial 7 · objetivo do WhatsApp: objetivo → nível → skill salva (tudo lido da máquina); deixou de ser Em breve", () => {
  const t7 = byId("whatsapp-objetivo");
  assert.ok(t7.comingSoon !== true); assert.equal(t7.number, 7); assert.ok(t7.reset !== undefined);
  assert.deepEqual(t7.steps.map((s) => s.body), ["objective-choice", "objective-level", "objective-skill"]);
  const c = (objective) => ({ ...emptyContext(), objective: objective === null ? null : { available: true, objective: null, level: null, savedAt: null, skill: "objetivo-whatsapp", skillPresent: false, skills: [], ...objective } });
  assert.equal(guideView(t7, null, emptyFlags(), c(null)).current, 0, "não consultado");
  assert.equal(guideView(t7, null, emptyFlags(), c({})).current, 0);
  const obj = { id: "vendas", label: "Vender", text: "" };
  assert.equal(guideView(t7, null, emptyFlags(), c({ objective: obj })).current, 1, "objetivo salvo: nível");
  assert.equal(guideView(t7, null, emptyFlags(), c({ objective: obj, level: "conversa" })).current, 2, "nível salvo: skill");
  assert.equal(guideView(t7, null, emptyFlags(), c({ objective: obj, level: "conversa", savedAt: "2026-10-17T03:00:00Z" })).finished, false, "savedAt sem o arquivo na máquina não conclui");
  assert.equal(guideView(t7, null, emptyFlags(), c({ objective: obj, level: "conversa", savedAt: "2026-10-17T03:00:00Z", skillPresent: true })).finished, true);
});

test("fontes: todo tutorial declara de onde vêm os fatos; antes de chegarem, o estado é 'verificando' ou o lembrado", () => {
  for (const x of TUTORIAIS) { assert.ok(x.needs.length > 0, `${x.id} sem needs`); for (const s of x.needs) assert.ok(GUIDE_SOURCES.includes(s), `${x.id}: fonte ${s}`); }
  const nav = TUTORIAIS.find((x) => x.id === "navegador");
  const ctx = emptyContext();
  assert.equal(tutorialKnown(nav, ctx), false);
  assert.equal(tutorialState(nav, null, emptyFlags(), ctx, null), "unknown");
  assert.equal(tutorialState(nav, null, emptyFlags(), ctx, true), "done", "sem a fonte, vale a lembrança");
  assert.equal(tutorialState(nav, null, emptyFlags(), ctx, false), "todo");
  const known = { ...ctx, known: { ...ctx.known, navegador: true }, navegador: { access: "free", installed: null, tabs: 0, extensions: 0, agentOn: false } };
  assert.equal(tutorialKnown(nav, known), true);
  assert.equal(tutorialState(nav, null, emptyFlags(), known, true), "done", "concluído fica concluído mesmo com a fonte dizendo outra coisa (só Refazer apaga)");
  assert.equal(tutorialState(nav, null, emptyFlags(), known, false), "todo", "lembrança de 'a fazer' não segura nada: vale o estado real");
  const soon = { ...nav, comingSoon: true };
  assert.equal(tutorialState(soon, null, emptyFlags(), known, true), "todo");
});

test("parseTutMemory: só ids válidos com booleano; lixo vira vazio", () => {
  assert.deepEqual(parseTutMemory('{"navegador":true,"statusline":false,"x y":true,"crm-whatsapp":"sim"}'), { navegador: true, statusline: false });
  assert.deepEqual(parseTutMemory("nope"), {});
  assert.deepEqual(parseTutMemory(null), {});
  assert.deepEqual(parseTutMemory("[true]"), {});
});

test("tutorial 10 (grupos): escolher, quem aciona (nunca herdado), ligar e testar; pelo estado real da máquina", () => {
  const t12 = byId("whatsapp-grupos");
  assert.equal(t12.number, 10);
  assert.equal(t12.after, "whatsapp-openclaw");
  assert.deepEqual(t12.steps.map((s) => s.id), ["grupo", "quem", "modo", "teste"]);
  const G1 = { jid: "120363000000000001@g.us", nome: "Casa", membros: 2, participantes: [], agente: "desligado", sessionKey: null, updatedAt: null };
  const G2 = { ...G1, jid: "120363000000000002@g.us", nome: "Time", agente: "mencao" };
  const info = (over = {}) => ({ grupos: [G1], quemAciona: [], quemAcionaHerdado: true, todosAdmitidos: false, cacheEm: null, skill: true, self: null, ...over });
  const ctx = (grupos) => ({ ...emptyContext(), grupos });
  const at = (c, f = emptyFlags()) => guideView(t12, null, f, c).current;
  // Sem grupos lidos ou sem escolha: passo 1.
  assert.equal(at(ctx({ info: null, alvo: null, respondeu: false })), 0);
  assert.equal(at(ctx({ info: info(), alvo: null, respondeu: false })), 0);
  // Escolheu, mas a lista é herdada das diretas (com "todo mundo" seria ["*"]): passo 2.
  assert.equal(at(ctx({ info: info({ quemAciona: "todos" }), alvo: G1.jid, respondeu: false })), 1);
  // Lista própria: passo 3 até ligar; ligado: passo 4; respondeu (ou "Testei"): concluído.
  assert.equal(at(ctx({ info: info({ quemAciona: ["5511999998888"], quemAcionaHerdado: false }), alvo: G1.jid, respondeu: false })), 2);
  const ligado = info({ grupos: [G1, G2], quemAciona: ["5511999998888"], quemAcionaHerdado: false });
  assert.equal(at(ctx({ info: ligado, alvo: G2.jid, respondeu: false })), 3);
  assert.equal(guideView(t12, null, emptyFlags(), ctx({ info: ligado, alvo: G2.jid, respondeu: true })).finished, true);
  assert.equal(guideView(t12, null, { ...emptyFlags(), gruposTested: true }, ctx({ info: ligado, alvo: G2.jid, respondeu: false })).finished, true);
  // Sem escolha guardada, o primeiro grupo com o agente ligado é o do tutorial; escolha que sumiu também cai nele.
  assert.equal(quemEscolhido(info({ quemAciona: "todos", quemAcionaHerdado: false })), true);
  assert.equal(quemEscolhido(info({ quemAciona: ["5511999998888"], quemAcionaHerdado: true })), false);
});

test("tutorial 18 (CRM no Gmail): passo do primeiro pipeline antes do teste; conclui pelo pipeline padrão do WhatsApp", () => {
  const t10 = byId("crm-gmail");
  assert.deepEqual(t10.steps.map((s) => s.id), ["instalar", "gmail", "pipeline", "importar", "testar"]);
  const base = { ...emptyContext(), crm: { access: "ok", info: { installed: true }, local: null }, navegador: { ...emptyContext().navegador, extensaoEmbutida: true, tabs: 1 } };
  const feito = { ...emptyFlags(), crmImportSeen: true, crmSeen: true };
  const comLocal = (local) => ({ ...base, crm: { ...base.crm, local } });
  // Sem pipeline (box-lv): para no passo novo, mesmo com "importei" e "recebi" marcados.
  assert.equal(guideView(t10, null, feito, comLocal({ pipelines: [], padrao: null })).current, 2);
  // Vários pipelines e nenhum padrão: ainda pendente.
  assert.equal(guideView(t10, null, feito, comLocal({ pipelines: [{ key: "p_a", name: "A", boxes: 0 }, { key: "p_b", name: "B", boxes: 0 }], padrao: null })).current, 2);
  // Com padrão (agente-box): concluído.
  assert.equal(guideView(t10, null, feito, comLocal({ pipelines: [{ key: "p_a", name: "A", boxes: 3 }], padrao: "p_a" })).finished, true);
});

test("passos que são fatos (abriu um site, viu o Gmail, o agente respondeu no grupo) ficam lembrados: a janela carregando não reabre o tutorial", () => {
  const t9 = byId("navegador");
  const abrir = t9.steps.find((s) => s.id === "abrir");
  assert.equal(abrir.lembrar, true);
  const ctx = (tabs) => ({ ...emptyContext(), navegador: { ...emptyContext().navegador, access: "ok", installed: true, tabs } });
  const f = emptyFlags();
  // Ainda sem abas nesta janela (o Navegador está restaurando): sem a lembrança, o tutorial voltava a "falta fazer".
  assert.equal(guideView(t9, null, f, ctx(0)).current, 2);
  assert.equal(guideView(t9, null, { ...f, feitos: ["abrir"] }, ctx(0)).current, 3);
  assert.equal(guideView(t9, null, f, ctx(2)).current, 3);
  // O agente navegou com sucesso: conclui na hora, sem esperar a consulta da instalação nem a contagem de abas.
  const semConsulta = { ...emptyContext(), navegador: { ...emptyContext().navegador, access: "ok", installed: null, tabs: 0 } };
  assert.equal(guideView(t9, null, { ...f, navAgentUsed: true }, semConsulta).finished, true);
  for (const [tut, passo] of [["crm-gmail", "gmail"], ["statusline", "limites"], ["whatsapp-grupos", "teste"]]) assert.equal(byId(tut).steps.find((s) => s.id === passo).lembrar, true, `${tut}/${passo}`);
});

test("tutorial 11 · contas: entrar no Cloudflare, Cloudflare conectado; GitHub conectado ou \"Não uso GitHub\"; some neste Mac", () => {
  const t = byId("contas-cli");
  const c = (contas) => ({ ...emptyContext(), contas });
  const cf = (conectado) => ({ id: "cloudflare", presente: true, conectado, conta: conectado ? "a@b" : null, amplo: false });
  const gh = (conectado) => ({ id: "github", presente: true, conectado, conta: conectado ? "lv" : null, amplo: false });
  assert.equal(guideView(t, null, emptyFlags(), c(null)).current, 0, "não consultado ainda");
  assert.equal(guideView(t, null, emptyFlags(), c([cf(false), gh(true)])).current, 0, "sequencial: primeiro entrar no Cloudflare");
  assert.equal(guideView(t, null, { ...emptyFlags(), cloudflareLogado: true }, c([cf(false), gh(true)])).current, 1, "logado: falta conectar; o GitHub não pula o Cloudflare");
  assert.equal(guideView(t, null, emptyFlags(), c([cf(true), gh(false)])).current, 2, "conectado já conta como logado");
  assert.equal(guideView(t, null, { ...emptyFlags(), githubPulado: true }, c([cf(true), gh(false)])).finished, true);
  assert.equal(guideView(t, null, emptyFlags(), c([cf(true), gh(true)])).finished, true);
  assert.deepEqual(t.steps.map((s) => s.body), ["cloudflare-entrar", "conta-cloudflare", "conta-github"]);
  const mac = { ...emptyContext(), xai: { possible: false, pronto: null, loggedIn: null, label: null } };
  assert.ok(!visibleTutorials(mac, () => true).some((x) => x.id === "contas-cli"), "só em máquina por SSH");
});

test("tutorial 12 (financeiro): só com a licença do financeiro; passos concluídos pelo estado da máquina", () => {
  const t = byId("financeiro");
  const sem = { ...emptyContext(), finance: { access: false, info: null } };
  assert.ok(!visibleTutorials(sem, () => true).some((x) => x.id === "financeiro"), "sem o produto, some");
  const com = (estado, modulo = true) => ({ ...emptyContext(), finance: { access: true, info: { modulo, estado, erro: null } } });
  assert.ok(visibleTutorials(com(null), (x) => x.id === "claude-login").some((x) => x.id === "financeiro"));
  const est = (o) => ({ contas: [], orcamentoDefinido: false, porOrigem: {}, pendencias: 0, totalLancamentos: 0, ...o });
  assert.equal(guideView(t, null, emptyFlags(), com(null, false)).current, 0);
  assert.equal(guideView(t, null, emptyFlags(), com(est({}))).current, 1);
  assert.equal(guideView(t, null, emptyFlags(), com(est({ contas: [{}], orcamentoDefinido: true, porOrigem: { whatsapp: 1 }, totalLancamentos: 2, pendencias: 1 }))).current, 4, "foto");
  const pronto = est({ contas: [{}], orcamentoDefinido: true, porOrigem: { whatsapp: 1, foto: 1 }, totalLancamentos: 2, pendencias: 0 });
  assert.equal(guideView(t, null, emptyFlags(), com(pronto)).finished, true);
});

test("parseTutPulados: só ids válidos, sem repetir; lixo vira vazio", () => {
  assert.deepEqual([...parseTutPulados('["fallback-contas","xai-login","fallback-contas","X Y",3]')], ["fallback-contas", "xai-login"]);
  assert.equal(parseTutPulados(null).size, 0); assert.equal(parseTutPulados("").size, 0);
  assert.equal(parseTutPulados("lixo").size, 0); assert.equal(parseTutPulados('{"a":1}').size, 0);
});

test("tutorial 8 (guarda) só aparece onde o agente aceita a guarda; sem status ainda, não aparece (senão aparecia e sumia)", () => {
  const done = (x) => x.id === "claude-login" || x.id === "whatsapp-openclaw";
  const ids = (possible) => visibleTutorials({ ...emptyContext(), guarda: { installed: null, possible } }, done).map((x) => x.id);
  assert.ok(ids(true).includes("guarda-whatsapp"));
  assert.ok(!ids(null).includes("guarda-whatsapp"), "ainda consultando a máquina: fica de fora até confirmar");
  assert.ok(!ids(false).includes("guarda-whatsapp"), "máquina com agente sem guarda (Hermes) não vê o tutorial");
  const t8 = TUTORIAIS.find((x) => x.id === "guarda-whatsapp");
  for (const st of t8.steps) assert.ok(!/OpenClaw/.test(st.title) && !/toda máquina com OpenClaw/.test(st.text), `passo ${st.id} sem nome de produto`);
  assert.ok(!/OpenClaw/.test(t8.summary) && !/OpenClaw/.test(t8.reset.what));
});

test("tutorial 10 enxuto: etapa feita mostra o resultado numa linha (com 'Trocar'); grupo, quem chama e modo", async () => {
  const { nomeDoGrupo, quemResumo } = await import("../../dist/renderer/lib/whatsapp-grupos.js");
  const t = byId("whatsapp-grupos");
  const g = { jid: "123@g.us", nome: "status", apelido: null, agente: "mencao" };
  const info = { grupos: [g], quemAciona: ["5521999990000"], quemAcionaHerdado: false, self: "5521888880000", todosAdmitidos: false, cacheEm: null, skill: true };
  const c = { ...emptyContext(), grupos: { info, alvo: "123@g.us", respondeu: false } };
  assert.equal(nomeDoGrupo(g), "status"); assert.equal(nomeDoGrupo({ ...g, apelido: "Casa" }), "Casa");
  const [grupo, quem, modo] = t.steps;
  assert.equal(grupo.resumo(c), "Grupo: status");
  assert.equal(quem.resumo(c), "Quem chama: só você");
  assert.equal(quemResumo({ ...info, quemAciona: ["5521999990000", "5511777770000", "5511666660000"] }), "Quem chama: você + 2");
  assert.equal(quemResumo({ ...info, quemAciona: "todos" }), "Quem chama: todo mundo do grupo");
  assert.equal(modo.resumo(c), "Responde só quando chamado");
  assert.equal(modo.resumo({ ...c, grupos: { ...c.grupos, info: { ...info, grupos: [{ ...g, agente: "sempre" }] } } }), "Responde sempre que tiver algo útil");
  for (const s of [grupo, quem, modo]) assert.equal(s.refazer, true, `${s.id} com "Trocar"`);
});

test("tutorial 13 (link público): só em máquina por SSH; ligado pelo admin → passo 1; algo no ar → passo 2; nome trocado ou \"deixar como está\" → concluído", () => {
  const t = byId("link-publico");
  assert.equal(t.number, 13); assert.deepEqual(t.needs, ["linkpublico"]); assert.equal(t.after, "claude-login"); assert.equal(t.needsXai, true);
  const mac = { ...emptyContext(), xai: { ...emptyContext().xai, possible: false } };
  assert.ok(!visibleTutorials(mac, () => true).some((x) => x.id === "link-publico"), "só em máquina por SSH");
  assert.ok(!visibleTutorials({ ...emptyContext(), linkPublicoPossivel: false }, () => true).some((x) => x.id === "link-publico"), "na janela do root não aparece: o link é das contas de usuário");
  assert.ok(visibleTutorials(emptyContext(), () => true).some((x) => x.id === "link-publico"));
  const ctx = (lp) => ({ ...emptyContext(), linkPublico: lp, known: { ...emptyContext().known, linkpublico: true } });
  const lp = { url: "https://box-2.agentesgrok.com/", nome: "box-2", dominio: "agentesgrok.com", arquivos: 0, usuario: "box-2" };
  assert.equal(guideView(t, null, emptyFlags(), ctx(null)).current, 0, "desligado: espera o admin");
  assert.equal(guideView(t, null, emptyFlags(), ctx(lp)).current, 1, "ligado, nada no ar: pedir o primeiro link");
  assert.equal(guideView(t, null, emptyFlags(), ctx({ ...lp, arquivos: 2 })).current, 2, "algo no ar: escolher o nome");
  assert.equal(guideView(t, null, emptyFlags(), ctx({ ...lp, arquivos: 2, nome: "daniel", url: "https://daniel.agentesgrok.com/" })).finished, true, "nome trocado");
  assert.equal(guideView(t, null, { ...emptyFlags(), linkNomeVisto: true }, ctx({ ...lp, arquivos: 1 })).finished, true, "deixou como está");
  assert.equal(tutorialKnown(t, emptyContext()), false, "sem a consulta, verificando");
});

test("registro de passos (tutoriais/passos.ts): cada body dos tutoriais tem quem desenhe; repetir é erro; `false` devolve o botão de ação", async () => {
  const { registrarPassos, renderPasso, conferirPassos, limparPassos } = await import("../../dist/renderer/tutoriais/passos.js");
  limparPassos();
  const bodies = [...new Set(TUTORIAIS.flatMap((t) => t.steps.map((s) => s.body)).filter((b) => b !== undefined))];
  assert.deepEqual(conferirPassos(TUTORIAIS).sort(), [...bodies].sort(), "sem registro, falta tudo");
  const chamados = [];
  registrarPassos(Object.fromEntries(bodies.map((b) => [b, (_txt, step) => { chamados.push(step.body); return b === "reply-choice" ? false : undefined; }])));
  assert.deepEqual(conferirPassos(TUTORIAIS), []);
  assert.throws(() => registrarPassos({ "crm-pro": () => undefined }), /duas vezes/);
  const txt = { append() {} };
  const passo = (b) => TUTORIAIS.flatMap((t) => t.steps.map((s) => [t, s])).find(([, s]) => s.body === b);
  const [t1, s1] = passo("crm-pro"); assert.equal(renderPasso("crm-pro", txt, s1, t1), true);
  const [t2, s2] = passo("reply-choice"); assert.equal(renderPasso("reply-choice", txt, s2, t2), false, "sem status do WhatsApp, o passo deixa o botão de ação aparecer");
  assert.deepEqual(chamados, ["crm-pro", "reply-choice"]);
  limparPassos();
});

test("tutorial 15 · Gmail (Pro): Pro → Conta Google → ler, buscar, lixeira + desfazer; os três últimos são fatos lembrados", () => {
  const g = byId("gmail");
  assert.equal(g.number, 15); assert.equal(g.after, "claude-login"); assert.deepEqual(g.needs, ["google"]);
  assert.deepEqual(g.steps.map((s) => s.id), ["pro", "conectar", "ler", "buscar", "lixeira"]);
  assert.deepEqual(g.steps.map((s) => s.body), ["gmail-pro", "gmail-conectar", "gmail-ler", "gmail-buscar", "gmail-lixeira"]);
  assert.deepEqual(g.steps.map((s) => s.lembrar === true), [false, false, true, true, true]);
  const c = (gmail) => ({ ...emptyContext(), known: { ...emptyContext().known, google: true }, gmail: { ...emptyContext().gmail, ...gmail } });
  assert.equal(guideView(g, null, emptyFlags(), c({})).current, 0);
  assert.equal(guideView(g, null, emptyFlags(), c({ access: "free" })).current, 0, "free: parado no Pro");
  assert.equal(guideView(g, null, emptyFlags(), c({ access: "ok" })).current, 1);
  assert.equal(guideView(g, null, emptyFlags(), c({ access: "ok", conectado: true })).current, 2);
  assert.equal(guideView(g, null, emptyFlags(), c({ access: "ok", conectado: true, lido: true, buscou: true })).current, 4);
  assert.equal(guideView(g, null, emptyFlags(), c({ access: "ok", conectado: true, lido: true, buscou: true, lixeira: true })).current, 4, "lixeira sem desfazer não conclui");
  assert.equal(guideView(g, null, emptyFlags(), c({ access: "ok", conectado: true, lido: true, buscou: true, lixeira: true, desfez: true })).finished, true);
  assert.equal(guideView(g, null, { ...emptyFlags(), feitos: ["ler", "buscar", "lixeira"] }, c({ access: "ok", conectado: true })).finished, true, "fatos lembrados valem mesmo com a janela recém-aberta");
  assert.equal(tutorialState(g, null, emptyFlags(), emptyContext(), null), "unknown", "sem a fonte google, verificando");
  assert.ok(visibleTutorials(emptyContext(), (x) => x.id === "claude-login").some((x) => x.id === "gmail"), "entra na trilha depois do 1");
  assert.equal(byId("crm-gmail").steps.find((s) => s.body === "crm-gmail").title, "Abrir o Gmail web no Navegador (com a barra do CRM)");
});
