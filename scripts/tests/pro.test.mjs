import { test } from "node:test";
import assert from "node:assert/strict";
import { acessoAddon, acessoProduto, browserAccess, crmProprioOk, displayUrl, modulosNaLicenca, pagamentoDoBloqueio, planoLiberaPro, proBlockText, tabLabel, fraseDaLicencaDaConta } from "../../dist/renderer/lib/pro.js";

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
  assert.equal(acessoAddon(lic({ produtos: [P] }), "agente-box", P) === "ok", true);
  assert.equal(acessoAddon(lic({ plan: "pro", status: "active" }), "agente-box", P) === "ok", false);
  assert.equal(acessoProduto(lic({}), "agente-box", "free", "meu-bot"), "ok", "app free nunca bloqueia");
  // App que exigisse mais que o free: ou tudo aberto, ou "assinatura" (uma tela só).
  assert.equal(browserAccess(lic({ produtos: ["meu-bot-fit"] }), "agente-box", "pro", "meu-bot-fit"), "ok");
  assert.equal(browserAccess(lic({ plan: "pro", status: "active" }), "agente-box", "pro", "meu-bot-fit"), "assinatura");
  const t = proBlockText("assinatura", lic({ plan: "pro", status: "active", pagamento: { instrucoes: "Pix do admin", link: null } }), "navegador", "meu-bot-fit");
  assert.equal(t.askAdmin, true); assert.match(t.title, /meu-bot-fit/); assert.doesNotMatch(t.text, /plano Pro/);
  assert.equal(crmProprioOk(lic({ plan: "pro", status: "active" }), "agente-box"), true);
  assert.equal(crmProprioOk(lic({ produtos: ["meu-bot-crm"] }), "agente-box"), false, "o antigo add-on meu-bot-crm não libera");
});

const PIX = { pagamento: { instrucoes: "Pix do admin", link: null } };
test("proBlockText: a pessoa assina pelo site; só pede ao admin quando ele gravou um Como pagar próprio", () => {
  const f = proBlockText("free", lic({}));
  assert.equal(f.askAdmin, false); assert.match(f.text, /Assine o Pro pelo site/); assert.doesNotMatch(f.text, /admin/);
  const fa = proBlockText("free", lic(PIX));
  assert.equal(fa.askAdmin, true); assert.match(fa.text, /Peça o Pro ao admin/);
  assert.equal(proBlockText("unknown", null).askAdmin, false);
  const e = proBlockText("expired", lic({ plan: "pro", status: "expired", expiresAt: "2026-09-30T12:00:00Z" }));
  assert.equal(e.askAdmin, false); assert.match(e.text, /venceu em \d{2}\/\d{2}\/\d{4}/); assert.match(e.text, /Renove pelo site/);
  assert.equal(proBlockText("expired", lic({ plan: "pro", status: "expired", ...PIX })).askAdmin, true);
  const ad = proBlockText("assinatura", lic({}), "crm", "meu-bot-finance");
  assert.equal(ad.askAdmin, false); assert.match(ad.text, /Assine pelo site/);
});

test("caminho do plano: com a licença na conta, a máquina por SSH oferece usá-la; senão, assinar", async () => {
  const { caminhoDoPlano, contaTemLicenca } = await import("../../dist/renderer/lib/pro.js");
  const t = Date.parse("2026-11-18T12:00:00Z");
  const L = (x = {}) => lic(x).license;
  const pro = L({ plan: "pro", status: "active", expiresAt: "2026-12-18T00:00:00Z" });
  assert.equal(contaTemLicenca(pro, t), true);
  assert.equal(contaTemLicenca(L({ plan: "pro", status: "trialing" }), t), true);
  assert.equal(contaTemLicenca(L({}), t), false, "conta free não tem o que levar");
  assert.equal(contaTemLicenca(L({ plan: "pro", status: "active", expiresAt: "2026-11-01T00:00:00Z" }), t), false, "Pro vencido");
  assert.equal(contaTemLicenca(L({ plan: "pro", status: "expired" }), t), false);
  assert.equal(contaTemLicenca(L({ produtos: ["meu-bot-finance"] }), t), true, "só um add-on pago também vai para a máquina");
  assert.equal(contaTemLicenca(null, t), false, "sem conta");
  const c = (o) => caminhoDoPlano({ remoto: true, conta: pro, maquinaLimite: 1, origem: "admin", ...o }, t);
  assert.equal(c({}), "usar-da-conta");
  assert.equal(c({ origem: undefined }), "usar-da-conta", "backend antigo não diz a origem");
  assert.equal(c({ remoto: false }), "assinar", "este Mac já usa o plano da conta");
  assert.equal(c({ conta: L({}) }), "assinar", "a conta ainda não assinou");
  assert.equal(c({ conta: null }), "assinar", "não entrou na conta");
  assert.equal(c({ maquinaLimite: null }), "assinar", "a API da conta ainda não leva a licença a máquinas");
  assert.equal(c({ origem: "conta" }), "assinar", "a máquina já usa a da conta e ainda falta algo: é assinar o que falta");
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
  const t = proBlockText("free", lic({ pagamento: { instrucoes: "Pix do admin", link: null } }), "google", "meu-bot");
  assert.ok(t.title.includes("Conta Google") && t.askAdmin, t.title);
  assert.ok(proBlockText("expired", lic({ plan: "pro", status: "expired" }), "google").title.includes("venceu"));
});

test("pagamentoDoBloqueio: só mostra a orientação quando pagar resolve; a do admin, ou a padrão", () => {
  const pg = { instrucoes: "Pix financeiro@exemplo.com", link: null };
  assert.deepEqual(pagamentoDoBloqueio("free", lic({ pagamento: pg })), pg);
  assert.deepEqual(pagamentoDoBloqueio("expired", lic({ plan: "pro", status: "expired", pagamento: pg })), pg);
  assert.deepEqual(pagamentoDoBloqueio("assinatura", lic({ pagamento: pg })), pg);
  assert.equal(pagamentoDoBloqueio("unknown", lic({ pagamento: pg })), null, "problema técnico: pagar não resolve");
  assert.equal(pagamentoDoBloqueio("free", lic({})).padrao, true, "sem nada gravado (ou licença antiga sem o campo): o caminho padrão, assinar pelo site");
  assert.equal(pagamentoDoBloqueio("free", null), null);
});

test("proBlockText: módulo Computador tem texto próprio e manda assinar pelo site", () => {
  const t = proBlockText("free", lic({}), "computador");
  assert.match(t.title, /Computador/);
  assert.equal(t.askAdmin, false); assert.match(t.text, /Assine o Pro pelo site/);
});

test("modulosNaLicenca: só add-on com módulos e liberado nesta máquina traz a página Módulos", () => {
  const addons = [{ nome: "meu-bot-finance", modulos: true }, { nome: "meu-bot-diego", modulos: false }, { nome: "meu-bot-grok", modulos: true }];
  assert.equal(modulosNaLicenca(lic({ produtos: ["meu-bot-finance"] }), "agente-box", addons), true);
  assert.equal(modulosNaLicenca(lic({ produtos: ["meu-bot-diego"] }), "agente-box", addons), false, "add-on sem módulos");
  assert.equal(modulosNaLicenca(lic({ produtos: ["meu-bot-grok"] }), "agente-box", addons), true, "só o Grok (xAI) já abre a página Módulos");
  assert.equal(modulosNaLicenca(lic({ produtos: ["meu-bot-finance"], expiresAt: "2020-01-01T00:00:00Z" }), "agente-box", addons), false, "vencida");
  assert.equal(modulosNaLicenca(lic({ produtos: ["meu-bot-finance"] }), "local", addons), false, "este Mac");
  assert.equal(modulosNaLicenca(null, "agente-box", addons), false, "licença ainda não lida");
});

test("pagamento padrão: sem nada gravado pelo admin, o aviso manda assinar pelo site (console › Plano)", async () => {
  const { pagamentoPadrao, CAMINHO_ASSINATURA } = await import("../../dist/renderer/lib/pro.js");
  assert.equal(CAMINHO_ASSINATURA, "/account/plan");
  assert.match(CAMINHO_ASSINATURA, /^\/[A-Za-z0-9/_-]{0,80}$/, "o main (abrirConsole) só aceita caminho neste formato");
  // O Marketplace do console: a vitrine e a página de um item passam na mesma validação do main.
  const { CAMINHO_MARKETPLACE } = await import("../../dist/renderer/lib/pro.js");
  assert.equal(CAMINHO_MARKETPLACE, "/account/marketplace");
  for (const c of [CAMINHO_MARKETPLACE, `${CAMINHO_MARKETPLACE}/financas`, `${CAMINHO_MARKETPLACE}/maquina-extra`]) assert.match(c, /^\/[A-Za-z0-9/_-]{0,80}$/, c);
  const p = pagamentoDoBloqueio("free", lic({}));
  assert.deepEqual(p, pagamentoPadrao());
  assert.equal(p.padrao, true); assert.equal(p.link, null); assert.match(p.instrucoes, /Assine pelo site/);
  assert.equal(pagamentoDoBloqueio("expired", lic({ plan: "pro", status: "expired" })).padrao, true);
  assert.equal(pagamentoDoBloqueio("assinatura", lic({})).padrao, true);
  // O que o admin gravou manda mais que o padrão, e não vem marcado.
  const pg = { instrucoes: "Pix financeiro@exemplo.com", link: null };
  assert.deepEqual(pagamentoDoBloqueio("free", lic({ pagamento: pg })), pg);
  // Plano ilegível continua sem orientação: pagar não resolve o que é técnico.
  assert.equal(pagamentoDoBloqueio("unknown", lic({})), null);
  assert.equal(pagamentoDoBloqueio("free", null), null);
});

test("licença da conta na máquina: renova sozinha; recusada, a tela diz o motivo e que vale até vencer", () => {
  assert.deepEqual(fraseDaLicencaDaConta("meu-box-2", undefined), { texto: "meu-box-2 usa a licença da sua conta. Ela se renova sozinha enquanto a assinatura estiver em dia.", alerta: false });
  assert.equal(fraseDaLicencaDaConta("meu-box-2", "  ").alerta, false);
  const r = fraseDaLicencaDaConta("meu-box-2", "a sua conta usa a licença em mais máquinas do que o plano cobre agora (1): uma máquina extra venceu ou o limite mudou. Tire a licença de outra máquina.");
  assert.equal(r.alerta, true);
  assert.equal(r.texto, "meu-box-2 usa a licença da sua conta, mas ela parou de ser renovada: a sua conta usa a licença em mais máquinas do que o plano cobre agora (1): uma máquina extra venceu ou o limite mudou. Tire a licença de outra máquina. A licença que já está aqui vale até vencer.");
});
