import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceParts, deviceLine, ADMIN_ACTIONS, actionResultText, agoText, dateInputToIso, gb, healthLines, isoToDateInput, licenseSummary, personSuffix, progressLines, timeAgo, transcriptionNote, visibleActions } from "../../dist/renderer/lib/admin-view.js";

const probe = { reachable: true, user: "box", os: "Ubuntu", error: null, backendInstalled: true, backendListening: false, claudeLoggedIn: true, statusLine: false };
const fmt = (d) => (d === null ? "" : `+${d}`);
const share = { progress: true, whatsapp: true, logs: true, chat: true };
// O catálogo como a janela recebe do main (caps.addons): a fonte é ADDONS em app/variant-core.ts.
const { ADDONS } = createRequire(import.meta.url)("../../dist/main/app/variant-core.js");
const ADDONS_ROTULOS = ADDONS.map((a) => ({ nome: a.nome, rotulo: a.rotulo }));

test("healthLines: sondagem e WhatsApp viram linhas com ✓/✗/•", () => {
  const sem = healthLines({ probe, whatsapp: null, progress: null, share, xai: null }, fmt);
  assert.deepEqual(sem.map((l) => l.ok), [true, false, true, null, false]);
  assert.equal(sem[3].text, "xAI (Grok): não preparada nesta máquina");
  assert.equal(sem.some((l) => /meu-bot .*Mac dela|sem dados ainda/.test(l.text)), false, "versão do app dela fica nos devices da licença");
  assert.equal(sem[0].text, "entra por SSH (box · Ubuntu)");
  assert.equal(sem[1].text, "backend instalado mas parado");
  const wa = { present: true, connected: true, number: "5511999990000", detail: "", dmPolicy: "allowlist", audioIn: false, audioOut: "inbound" };
  const com = healthLines({ probe, whatsapp: wa, progress: null, share: { ...share, progress: false }, xai: { loggedIn: true, email: "d@x.ai" } }, fmt);
  assert.equal(com.length, 9);
  assert.equal(com[3].text, "xAI (Grok) logada (d@x.ai)"); assert.equal(com[3].ok, true);
  com.splice(3, 1);
  assert.equal(com[4].text, "WhatsApp conectado (+5511999990000)");
  assert.equal(com[5].text, "responde: só a dona do número"); assert.equal(com[5].ok, null);
  assert.equal(com[6].text, "não entende áudios (sem transcrição)"); assert.equal(com[6].ok, false);
  assert.equal(com[7].text, "responde em áudio: quando recebe áudio");
  const fora = healthLines({ probe: { ...probe, reachable: false, error: "timeout" }, whatsapp: null, progress: null, share: { ...share, progress: false }, xai: { loggedIn: false, email: null } }, fmt);
  assert.equal(fora[3].text, "xAI (Grok) deslogada: o grok-4 não responde");
  assert.equal(fora[0].text, "não entra por SSH: timeout");
});

test("progressLines: tour e tutoriais, com onde parou", () => {
  const prog = { at: "2026-10-16T12:00:00Z", tour: "skipped", tutorials: [
    { id: "a", title: "Ligar o suporte", done: 2, total: 2, current: null, finished: true, comingSoon: false },
    { id: "statusline", title: "Status line", done: 1, total: 2, current: "instalar", finished: false, comingSoon: false },
    { id: "c", title: "Voz", done: 0, total: 3, current: null, finished: false, comingSoon: true },
    { id: "d", title: "WhatsApp", done: 0, total: 4, current: null, finished: false, comingSoon: false },
  ] };
  const l = progressLines(prog);
  assert.deepEqual(l.map((x) => [x.text, x.ok, x.step]), [
    ["Tour do meu-bot: pulado", false, undefined],
    ["Ligar o suporte: concluído", true, undefined],
    ["17 · Status line: 1 de 2", null, ' · parou em "instalar"'],
    ["Voz: em breve", null, undefined],
    ["WhatsApp: 0 de 4", false, undefined],
  ]);
});

test("visibleActions: transcrição só com a capacidade audio, Ativar ou Desativar conforme o estado; nota explica quando não há", () => {
  assert.deepEqual(visibleActions(null).map((o) => o.id), ["restart-gateway", "restart-backend", "support-off"]);
  const cap = (audio) => ({ parear: true, listarConversas: true, lerConversa: true, limparHistorico: true, pausar: true, grupos: true, guarda: true, politicaDm: true, audio, politicaReinicia: false, digitando: true, digitandoReinicia: false });
  const wa = (x) => ({ present: true, gateway: "openclaw", connected: true, number: null, detail: "", dmPolicy: null, capacidades: cap(true), ...x });
  const h = (whatsapp, sh = share) => ({ probe, whatsapp, progress: null, share: sh, xai: null });
  assert.deepEqual(visibleActions(h(wa({ audioIn: false }))).map((o) => o.id), ["restart-gateway", "restart-backend", "transcription", "support-off"]);
  const ids = visibleActions(h(wa({ audioIn: true }))).map((o) => o.id);
  assert.ok(!ids.includes("transcription") && ids.includes("transcription-off") && ids.includes("restart-gateway"));
  assert.deepEqual(visibleActions(h({ present: false, gateway: null, capacidades: cap(false) })).map((o) => o.id), ["restart-gateway", "restart-backend", "support-off"]);
  assert.match(transcriptionNote(h({ present: false, gateway: null, capacidades: cap(false) })), /não tem agente com WhatsApp/);
  assert.match(transcriptionNote(h(wa({ gateway: "hermes", audioIn: undefined, capacidades: cap(false) }))), /não transcreve áudio pelo app/);
  assert.ok(!visibleActions(h(wa({ gateway: "hermes", audioIn: false, capacidades: cap(false) }))).some((o) => o.id === "transcription"), "sem a capacidade, nada de Ativar mesmo com audioIn=false");
  assert.match(transcriptionNote(h(null, { ...share, whatsapp: false })), /não compartilha/);
  assert.equal(transcriptionNote(h(wa({ audioIn: false }))), null);
  // Máquina sem o transcritor do root nem ffmpeg: Ativar some (é com a aba Preparar máquina) e a nota diz isso.
  assert.ok(!visibleActions(h(wa({ audioIn: false, audioMaquina: false }))).some((o) => o.id === "transcription"));
  assert.match(transcriptionNote(h(wa({ audioIn: false, audioMaquina: false }))), /Preparar máquina/);
  assert.ok(visibleActions(h(wa({ audioIn: false, audioMaquina: true }))).some((o) => o.id === "transcription"));
  assert.equal(actionResultText("Reiniciar", { ok: true, detail: "" }), "Reiniciar: feito");
  assert.equal(actionResultText("Reiniciar", { ok: false, detail: "exit 1" }), "Reiniciar: falhou · exit 1");
});

test("timeAgo e personSuffix", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  assert.equal(timeAgo("2026-10-16T11:59:40Z", now), "visto agora");
  assert.equal(timeAgo("2026-10-16T11:30:00Z", now), "visto há 30 min");
  assert.equal(timeAgo("2026-10-16T09:00:00Z", now), "visto há 3 h");
  assert.equal(timeAgo("2026-10-13T12:00:00Z", now), "visto há 3 dias");
  assert.equal(timeAgo("lixo", now), "");
  const p = { alias: "suporte-bia-ab12", name: "Bia", machine: null, hostname: "203.0.113.7", port: 2222, local: false, on: true, seenAt: "2026-10-16T11:30:00Z", source: "caixa" };
  assert.equal(personSuffix(p, now), " · 203.0.113.7:2222 · visto há 30 min");
  assert.equal(personSuffix({ ...p, port: 22, local: true, seenAt: "" }, now), " · 203.0.113.7 · só alcançável deste Mac");
  assert.equal(personSuffix({ ...p, machine: "colima", port: 22, seenAt: "" }, now), " · colima · 203.0.113.7");
});

test("agoText: segundos viram 'agora'", () => {
  const now = Date.now();
  assert.equal(agoText(new Date(now - 20_000).toISOString(), now), "agora");
});

test("healthLines: disco e memória da máquina (REA do Rambox), com aviso de pouco espaço", () => {
  assert.equal(gb(40_960), "40 GB"); assert.equal(gb(1536), "1,5 GB"); assert.equal(gb(820), "820 MB");
  const base = { probe: { ...probe, diskTotalMb: 40_960, diskFreeMb: 12_288, memTotalMb: 4096, memFreeMb: 1536 }, whatsapp: null, progress: null, share: { ...share, progress: false }, xai: null };
  const lines = healthLines(base, fmt);
  const disk = lines.find((l) => l.text.startsWith("disco:")), mem = lines.find((l) => l.text.startsWith("memória:"));
  assert.deepEqual([disk.text, disk.ok], ["disco: 12 GB livres de 40 GB", true]);
  assert.deepEqual([mem.text, mem.ok], ["memória: 1,5 GB livres de 4,0 GB", null]);
  const low = healthLines({ ...base, probe: { ...base.probe, diskFreeMb: 900, memFreeMb: 300 } }, fmt);
  assert.deepEqual([low.find((l) => l.text.startsWith("disco:")).ok, low.find((l) => l.text.startsWith("memória:")).ok], [false, false]);
  assert.match(low.find((l) => l.text.startsWith("disco:")).text, /pouco espaço/);
  // sem os números (máquina antiga/sondagem sem df): nenhuma linha
  assert.equal(healthLines({ ...base, probe }, fmt).some((l) => /^disco:|^memória:|^vigia:/.test(l.text)), false);
});

test("healthLines: swap, a régua de 10% do vigia e o alerta que o backend já mandou", () => {
  const base = { probe: { ...probe, memTotalMb: 8000, memFreeMb: 2400, swapTotalMb: 0, swapFreeMb: 0, backendAlerta: null }, whatsapp: null, progress: null, share: { ...share, progress: false }, xai: null };
  const mem = (h) => healthLines(h, fmt).find((l) => l.text.startsWith("memória:"));
  assert.deepEqual([mem(base).text, mem(base).ok], ["memória: 2,3 GB livres de 7,8 GB · sem swap", null]);
  const comSwap = { ...base, probe: { ...base.probe, swapTotalMb: 8192, swapFreeMb: 8000 } };
  assert.equal(mem(comSwap).text, "memória: 2,3 GB livres de 7,8 GB · swap 7,8 GB livres");
  // 700 MB de 8 GB passa dos 512 MB, mas está abaixo de 10%: apertada
  const baixa = { ...base, probe: { ...base.probe, memFreeMb: 700 } };
  assert.deepEqual([mem(baixa).text, mem(baixa).ok], ["memória: 700 MB livres de 7,8 GB · sem swap · apertada", false]);
  const alerta = healthLines({ ...base, probe: { ...base.probe, backendAlerta: "memoria" } }, fmt).find((l) => l.text.startsWith("vigia:"));
  assert.deepEqual([alerta.text, alerta.ok], ["vigia: memória quase no fim (a pessoa foi avisada)", false]);
  const box = healthLines({ ...base, probe: { ...base.probe, backendAlerta: "box" } }, fmt).find((l) => l.text.startsWith("vigia:"));
  assert.deepEqual([box.text, box.ok], ["vigia: a box dela está no limite de RAM/CPU (a pessoa foi avisada): aumente a RAM máx na aba Usuários ou veja o que pesa", false]);
  assert.equal(healthLines(base, fmt).some((l) => l.text.startsWith("vigia:")), false);
});

test("isoToDateInput / dateInputToIso: ida e volta, vazio e inválido", () => {
  assert.equal(isoToDateInput("2027-10-15T00:00:00.000Z"), "2027-10-15");
  assert.equal(isoToDateInput(null), "");
  assert.equal(isoToDateInput("não-data"), "");
  assert.equal(dateInputToIso("2027-10-15"), "2027-10-15T00:00:00.000Z");
  assert.equal(dateInputToIso(""), null, "vazio limpa a validade");
  assert.equal(dateInputToIso("15/10/2027"), null, "formato errado vira null");
  // Round-trip: input → ISO → input.
  assert.equal(isoToDateInput(dateInputToIso("2026-01-02")), "2026-01-02");
});

test("licenseSummary: mostra validade e marca expirada no passado", () => {
  const lic = { plan: "pro", status: "active", interval: "year", memberSince: "2026-10-15T00:00:00.000Z", trialEnd: null, expiresAt: "2020-01-01T00:00:00.000Z", deviceLimit: 2, updatedAt: "2026-10-17T00:00:00.000Z", updatedBy: "admin" };
  const view = { license: lic, devices: [], activeCount: 0, pendingCount: 0, deviceLimit: 2 };
  const lines = licenseSummary(view, Date.parse("2026-10-17T00:00:00.000Z"));
  const exp = lines.find((l) => l.text.startsWith("Expira:"));
  assert.ok(exp, "tem linha de validade");
  assert.equal(exp.ok, false, "validade no passado marca vermelho");
  assert.match(lines[0].text, /^Plano: Pro$/, "backend antigo sem `produtos` não quebra");
  const comProdutos = licenseSummary({ ...view, license: { ...lic, produtos: ["meu-bot-finance", "meu-bot-fit"] } }, Date.now(), ADDONS_ROTULOS);
  assert.equal(comProdutos[0].text, "Plano: Pro + Financeiro, meu-bot-fit");
});

test("visibleActions: Instalar o backend só sem backend (com ele, Reiniciar); sem saúde, não aparece", () => {
  const h = (backendInstalled) => ({ probe: { reachable: true, backendInstalled }, whatsapp: null, share: {}, progress: null, xai: null, license: null });
  const ids = (x) => visibleActions(x).map((o) => o.id);
  assert.ok(ids(h(false)).includes("install-backend")); assert.ok(!ids(h(false)).includes("restart-backend"));
  assert.ok(!ids(h(true)).includes("install-backend")); assert.ok(ids(h(true)).includes("restart-backend"));
  assert.ok(!ids(null).includes("install-backend"));
});

test("deviceParts separa nome, metadados, status e visto há; deviceLine é a junção", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const d = { id: "abc", name: "cursor", platform: "macOS 25.6.0", app: "", apps: { "meu-bot-staging": { version: "0.1.0" } }, status: "active", lastSeen: "2026-10-22T11:55:00Z" };
  const p = deviceParts(d, now);
  assert.equal(p.name, "cursor"); assert.equal(p.meta, "macOS 25.6.0 · meu-bot-staging 0.1.0"); assert.equal(p.status, "Ativo"); assert.ok(p.ok); assert.ok(p.seen !== "");
  assert.equal(deviceLine(d, now).text, `cursor · macOS 25.6.0 · meu-bot-staging 0.1.0 · Ativo · ${p.seen}`);
  const q = deviceParts({ ...d, name: "", status: "pending", lastSeen: "" }, now);
  assert.equal(q.name, "abc"); assert.equal(q.seen, "mão levantada"); assert.equal(q.ok, false);
});

test("add-ons com nome para o admin: o rótulo vem do catálogo da janela (caps.addons); MVP fora dele fica com o id", async () => {
  const { produtoLabel } = await import("../../dist/renderer/lib/admin-view.js");
  assert.equal(produtoLabel("meu-bot-finance", ADDONS_ROTULOS), "Financeiro"); assert.equal(produtoLabel("meu-bot-fit", ADDONS_ROTULOS), "meu-bot-fit");
  assert.equal(produtoLabel("meu-bot-finance"), "meu-bot-finance", "sem catálogo, o id");
  const view = { license: { plan: "pro", status: "active", produtos: ["meu-bot-finance"], memberSince: null, interval: null, trialEnd: null, expiresAt: null }, activeCount: 1, deviceLimit: 1, pendingCount: 0 };
  assert.equal(licenseSummary(view, Date.now(), ADDONS_ROTULOS)[0].text, "Plano: Pro + Financeiro");
});

test("admin: backendAtras compara número a número e trata sem versão como antigo", async () => {
  const { backendAtras } = await import("../../dist/renderer/lib/admin-view.js");
  assert.equal(backendAtras("1.8.2", "1.9.0"), true); assert.equal(backendAtras("1.9.0", "1.9.0"), false); assert.equal(backendAtras("1.10.0", "1.9.0"), false);
  assert.equal(backendAtras("1.9", "1.9.0"), false); assert.equal(backendAtras(null, "1.9.0"), true); assert.equal(backendAtras("1.8.2", null), false);
});

test("admin: toda ação oferecida em ADMIN_ACTIONS é aceita pelo handler admin:action do main", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../../dist/main/admin/ipc.js", import.meta.url), "utf8");
  const guard = /admin:action[\s\S]*?ação inválida/.exec(src)?.[0] ?? "";
  for (const a of ADMIN_ACTIONS) assert.ok(guard.includes(`"${a.id}"`), `o main recusa a ação ${a.id} que a tela oferece`);
});

test("admin: linhasPreparar vira ✓ / ✗ / • com o detalhe no passo", async () => {
  const { linhasPreparar } = await import("../../dist/renderer/lib/admin-view.js");
  const l = linhasPreparar({ itens: [{ id: "swap", titulo: "Swap", estado: "ok", detalhe: "8 GB", opcional: false }, { id: "gh", titulo: "gh", estado: "falta", detalhe: "", opcional: false }, { id: "link-publico", titulo: "Link", estado: "humano", detalhe: "entre na Cloudflare", opcional: false, pagina: "link-publico" }] });
  assert.deepEqual(l, [{ text: "Swap", ok: true, step: " · 8 GB" }, { text: "gh", ok: false }, { text: "Link", ok: null, step: " · entre na Cloudflare" }]);
});

test("maquinasParaAdotar: todo alias do ~/.ssh/config menos local, suporte-* e quem já é pessoa", async () => {
  const { maquinasParaAdotar } = await import("../../dist/renderer/lib/admin-view.js");
  const people = [{ alias: "suporte-box-ab12", machine: "meu-root" }, { alias: "suporte-lv-cd34", machine: null }];
  assert.deepEqual(
    maquinasParaAdotar(["local", "grokbot-1", "suporte-box-ab12", "meu-root", "meu-root-hermes", "grokbot-1", "agente-box"], people),
    ["grokbot-1", "meu-root-hermes", "agente-box"],
  );
  assert.deepEqual(maquinasParaAdotar([], people), []);
});

test("visibleActions: este Mac não tem Instalar nem Reiniciar o backend (o backend é o dos apps)", () => {
  const h = { probe: { reachable: true, backendInstalled: false }, whatsapp: null };
  assert.ok(visibleActions(h).some((o) => o.id === "install-backend"), "outra pessoa sem backend: Instalar aparece");
  const ids = visibleActions(h, true).map((o) => o.id);
  assert.ok(!ids.includes("install-backend") && !ids.includes("restart-backend"));
  assert.ok(ids.includes("restart-gateway") && ids.includes("support-off"));
});

test("visibleActions: Religar o suporte só no este Mac desligado; desligado nas outras pessoas não sobra ação", () => {
  const h = { probe: { reachable: true, backendInstalled: true }, whatsapp: null };
  assert.ok(!visibleActions(h, true).some((o) => o.id === "support-on"), "ligado: sem Religar");
  assert.deepEqual(visibleActions(h, true, true).map((o) => o.id), ["support-on"], "este Mac desligado: só Religar");
  assert.deepEqual(visibleActions(h, false, true).map((o) => o.id), [], "outra pessoa desligada: quem religa é ela");
  assert.ok(!visibleActions(h).some((o) => o.id === "support-on"));
});
