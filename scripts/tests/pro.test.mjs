import { test } from "node:test";
import assert from "node:assert/strict";
import { acessoAddon, acessoProduto, browserAccess, crmProprioOk, displayUrl, financeOk, modulosNaLicenca, pagamentoDoBloqueio, planoLiberaPro, proBlockText, tabLabel } from "../../dist/renderer/lib/pro.js";

const lic = (over) => ({ license: { plan: "free", status: "free", interval: null, memberSince: "2026-10-18T00:00:00Z", trialEnd: null, expiresAt: null, deviceLimit: 1, produtos: [], updatedAt: "2026-10-18T00:00:00Z", updatedBy: "admin", ...over }, devices: [] });

test("browserAccess: pro ativo abre; free e vencido bloqueiam; este Mac e backend antigo são unknown", () => {
  assert.equal(browserAccess(lic({ plan: "pro", status: "active" }), "agente-box"), "ok");
  assert.equal(browserAccess(lic({ plan: "pro", status: "trialing", trialEnd: "2027-01-01T00:00:00Z" }), "agente-box"), "ok");
  assert.equal(browserAccess(lic({}), "agente-colima"), "free");
  assert.equal(browserAccess(lic({ plan: "pro", status: "expired" }), "agente-box"), "expired");
  assert.equal(browserAccess(lic({ plan: "pro", status: "active", expiresAt: "2020-01-01T00:00:00Z" }), "agente-box"), "expired", "expiresAt no passado vence mesmo com status active");
  assert.equal(browserAccess(null, "agente-box"), "unknown");
  // Este Mac: o main manda a licença da conta meu-bot; com ela Pro, o Navegador abre; sem conta (null), não.
  assert.equal(browserAccess(lic({ plan: "pro", status: "active" }), "local"), "ok");
  assert.equal(browserAccess(lic({}), "local"), "free");
  assert.equal(browserAccess(null, "local"), "unknown");
});

test("planoLiberaPro: só o pro", () => {
  assert.equal(planoLiberaPro("free"), false); assert.equal(planoLiberaPro("pro"), true);
});

test("add-on (meu-bot-finance…): acumulativo por cima do plano, com ou sem o Pro; o CRM próprio vem do Pro", () => {
  const P = "meu-bot-finance";
  assert.equal(acessoAddon(lic({ produtos: [P] }), "agente-box", P), "ok", "free + add-on");
  assert.equal(acessoAddon(lic({ plan: "pro", status: "active", produtos: [P] }), "agente-box", P), "ok", "pro + add-on");
  assert.equal(acessoAddon(lic({ plan: "pro", status: "active" }), "agente-box", P), "ausente", "o Pro sozinho não basta");
  assert.equal(acessoAddon(lic({ produtos: [P], expiresAt: "2020-01-01T00:00:00Z" }), "agente-box", P), "expirada");
  assert.equal(acessoAddon(null, "agente-box", P), "unknown");
  assert.equal(acessoAddon(lic({ produtos: [P] }), "local", P), "unknown");
  assert.equal(financeOk(lic({ produtos: [P] }), "agente-box"), true);
  assert.equal(financeOk(lic({ plan: "pro", status: "active" }), "agente-box"), false);
  assert.equal(acessoProduto(lic({}), "agente-box", "free", "meu-bot"), "ok", "app free nunca bloqueia");
  // App que exigisse mais que o free: ou tudo aberto, ou "assinatura" (uma tela só).
  assert.equal(browserAccess(lic({ produtos: ["meu-bot-fit"] }), "agente-box", "pro", "meu-bot-fit"), "ok");
  assert.equal(browserAccess(lic({ plan: "pro", status: "active" }), "agente-box", "pro", "meu-bot-fit"), "assinatura");
  const t = proBlockText("assinatura", lic({ plan: "pro", status: "active" }), "navegador", "meu-bot-fit");
  assert.equal(t.askAdmin, true); assert.match(t.title, /meu-bot-fit/); assert.doesNotMatch(t.text, /plano Pro/);
  assert.equal(crmProprioOk(lic({ plan: "pro", status: "active" }), "agente-box"), true);
  assert.equal(crmProprioOk(lic({ produtos: ["meu-bot-crm"] }), "agente-box"), false, "o antigo add-on meu-bot-crm não libera");
});

test("proBlockText: free pede ao admin; unknown não; vencido traz a data", () => {
  assert.equal(proBlockText("free", lic({})).askAdmin, true);
  assert.equal(proBlockText("unknown", null).askAdmin, false);
  const e = proBlockText("expired", lic({ plan: "pro", status: "expired", expiresAt: "2026-09-30T12:00:00Z" }));
  assert.equal(e.askAdmin, true); assert.match(e.text, /venceu em \d{2}\/\d{2}\/\d{4}/);
});

test("tabLabel e displayUrl", () => {
  assert.equal(tabLabel("Gmail", "https://mail.google.com/mail/u/0/"), "Gmail");
  assert.equal(tabLabel("Caixa de entrada (3) - box@agentesgrok.com - Gmail", "https://mail.google.com/mail/u/0/#inbox"), "Gmail"); // o site do Gmail tem nome fixo
  assert.equal(tabLabel("Caixa de entrada", "https://outlook.live.com/"), "Caixa de entrada");
  assert.equal(tabLabel("", "https://www.google.com/"), "google.com");
  assert.equal(tabLabel("https://x.com/a", "https://x.com/a"), "x.com");
  assert.equal(tabLabel("", "about:blank"), "Nova aba");
  assert.equal(tabLabel("Um título muito comprido que não cabe na aba interna", "https://a.b"), "Um título muito comprido qu…");
  assert.equal(displayUrl("https://mail.google.com/"), "mail.google.com");
  assert.equal(displayUrl("http://localhost:3000/x"), "http://localhost:3000/x");
});

test("crmProprioOk: plano Pro em vigor; nunca neste Mac nem sem licença", () => {
  assert.equal(crmProprioOk(lic({ plan: "pro", status: "active" }), "agente-box"), true);
  assert.equal(crmProprioOk(lic({ plan: "pro", status: "trialing", trialEnd: "2027-01-01T00:00:00Z" }), "agente-box"), true);
  assert.equal(crmProprioOk(lic({ produtos: ["meu-bot-crm"] }), "agente-box"), false, "o antigo add-on não libera mais");
  assert.equal(crmProprioOk(lic({ plan: "pro", status: "expired" }), "agente-box"), false);
  assert.equal(crmProprioOk(lic({ plan: "pro", status: "active", expiresAt: "2020-01-01T00:00:00Z" }), "agente-box"), false);
  assert.equal(crmProprioOk(lic({}), "agente-box"), false);
  assert.equal(crmProprioOk(lic({ plan: "pro", status: "active" }), "local"), false);
  assert.equal(crmProprioOk(null, "agente-box"), false);
});

test("proBlockText: Conta Google é módulo Pro, com o mesmo pedido ao admin", () => {
  const t = proBlockText("free", lic({}), "google", "meu-bot");
  assert.ok(t.title.includes("Conta Google") && t.askAdmin, t.title);
  assert.ok(proBlockText("expired", lic({ plan: "pro", status: "expired" }), "google").title.includes("venceu"));
});

test("pagamentoDoBloqueio: só mostra a orientação quando pagar resolve e o admin gravou uma", () => {
  const pg = { instrucoes: "Pix financeiro@exemplo.com", link: null };
  assert.deepEqual(pagamentoDoBloqueio("free", lic({ pagamento: pg })), pg);
  assert.deepEqual(pagamentoDoBloqueio("expired", lic({ plan: "pro", status: "expired", pagamento: pg })), pg);
  assert.deepEqual(pagamentoDoBloqueio("assinatura", lic({ pagamento: pg })), pg);
  assert.equal(pagamentoDoBloqueio("unknown", lic({ pagamento: pg })), null, "problema técnico: pagar não resolve");
  assert.equal(pagamentoDoBloqueio("free", lic({})), null, "licença antiga sem o campo");
  assert.equal(pagamentoDoBloqueio("free", null), null);
});

test("proBlockText: módulo Computador tem texto próprio e oferece pedir ao admin", () => {
  const t = proBlockText("free", lic({}), "computador");
  assert.match(t.title, /Computador/);
  assert.equal(t.askAdmin, true);
});

test("modulosNaLicenca: só add-on com módulos e liberado nesta máquina traz a página Módulos", () => {
  const addons = [{ nome: "meu-bot-finance", modulos: true }, { nome: "meu-bot-diego", modulos: false }];
  assert.equal(modulosNaLicenca(lic({ produtos: ["meu-bot-finance"] }), "agente-box", addons), true);
  assert.equal(modulosNaLicenca(lic({ produtos: ["meu-bot-diego"] }), "agente-box", addons), false, "add-on sem módulos");
  assert.equal(modulosNaLicenca(lic({ produtos: ["meu-bot-finance"], expiresAt: "2020-01-01T00:00:00Z" }), "agente-box", addons), false, "vencida");
  assert.equal(modulosNaLicenca(lic({ produtos: ["meu-bot-finance"] }), "local", addons), false, "este Mac");
  assert.equal(modulosNaLicenca(null, "agente-box", addons), false, "licença ainda não lida");
});

test("pagamento padrão: sem nada gravado pelo admin, o aviso manda assinar pelo site do canal do app", async () => {
  const { pagamentoPadrao, linkDeAssinatura, usarCanalDaAssinatura } = await import("../../dist/renderer/lib/pro.js");
  assert.equal(linkDeAssinatura("estavel"), "https://console.agentesgrok.com/account/plan");
  assert.equal(linkDeAssinatura("staging"), "https://console-staging.agentesgrok.com/account/plan");
  assert.equal(pagamentoPadrao(null), null);
  const url = linkDeAssinatura("estavel");
  // Sem canal informado (como antes desta mudança): nada gravado = nada a mostrar.
  usarCanalDaAssinatura(null);
  assert.equal(pagamentoDoBloqueio("free", lic({})), null);
  // Com o canal: o caminho padrão, marcado como tal, com o link do console › Plano.
  usarCanalDaAssinatura("estavel");
  const p = pagamentoDoBloqueio("free", lic({}));
  assert.equal(p.padrao, true); assert.equal(p.link, url); assert.match(p.instrucoes, /Assine pelo site/);
  assert.equal(pagamentoDoBloqueio("expired", lic({ plan: "pro", status: "expired" })).link, url);
  // O que o admin gravou manda mais que o padrão, e não vem marcado.
  const pg = { instrucoes: "Pix financeiro@exemplo.com", link: null };
  assert.deepEqual(pagamentoDoBloqueio("free", lic({ pagamento: pg })), pg);
  // Plano ilegível continua sem orientação: pagar não resolve o que é técnico.
  assert.equal(pagamentoDoBloqueio("unknown", lic({})), null);
  assert.equal(pagamentoDoBloqueio("free", null), null);
  usarCanalDaAssinatura(null);
});
