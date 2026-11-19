import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Lado do backend (CJS, roda na máquina da pessoa) e lado do admin (TS compilado), mesmo esquema.
const be = require("../../backend-colima/licenca.js");
const fe = require("../../dist/main/licenca/licenca.js");

const DEV = (n) => n.toString(16).padStart(12, "0");

test("defaultLicense: grátis, um device, membro desde carimbado", () => {
  const l = be.defaultLicense(0);
  assert.equal(l.plan, "free");
  assert.equal(l.status, "free");
  assert.equal(l.interval, null);
  assert.equal(l.deviceLimit, 1);
  assert.deepEqual(l.produtos, []);
  assert.equal(l.memberSince, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(fe.defaultLicense(0), l, "backend e admin dão o mesmo default");
});

test("parseLicense: campo inválido/ausente cai no default; memberSince preservado", () => {
  const raw = { plan: "ultra", status: "active", interval: "week", memberSince: "2026-10-15T00:00:00.000Z", deviceLimit: 0 };
  for (const parse of [be.parseLicense, fe.parseLicense]) {
    const l = parse(raw, 1000);
    assert.equal(l.plan, "free", "plano desconhecido vira free");
    assert.equal(l.status, "active", "status válido mantido");
    assert.equal(l.interval, null, "intervalo inválido vira null");
    assert.equal(l.memberSince, "2026-10-15T00:00:00.000Z", "memberSince preservado");
    assert.equal(l.deviceLimit, 1, "limite fora da faixa vira 1");
  }
  for (const parse of [be.parseLicense, fe.parseLicense]) assert.equal(parse(null).plan, "free");
});

test("admitDevice: 1º cabe, 2º levanta a mão, conhecido mantém o status", () => {
  const free = be.defaultLicense(0); // deviceLimit 1
  assert.equal(be.admitDevice(free, {}, DEV(1)), "active", "1º device sempre ativo");
  const one = { [DEV(1)]: { status: "active" } };
  assert.equal(be.admitDevice(free, one, DEV(2)), "pending", "2º passa do limite 1 → pendente");
  const two = { ...free, deviceLimit: 2 };
  assert.equal(be.admitDevice(two, one, DEV(2)), "active", "com limite 2 o 2º entra ativo");
  const withPending = { [DEV(2)]: { status: "pending" } };
  assert.equal(be.admitDevice(free, { ...one, ...withPending }, DEV(2)), "pending", "pendente continua pendente enquanto não cabe");
  assert.equal(be.admitDevice(two, { ...one, ...withPending }, DEV(2)), "active", "o limite subiu: o Mac que esperava entra sozinho");
  assert.equal(be.admitDevice(two, withPending, DEV(2)), "active", "pendente sozinho na máquina cabe no limite");
  const tres = { [DEV(1)]: { status: "active" }, [DEV(2)]: { status: "active" }, [DEV(3)]: { status: "active" } };
  const em = (dia) => ({ status: "active", firstSeen: `2026-11-0${dia}T00:00:00.000Z` });
  const porIdade = { [DEV(3)]: em(1), [DEV(1)]: em(2), [DEV(2)]: em(3) };
  assert.equal(be.admitDevice(two, porIdade, DEV(3)), "active", "o limite caiu para 2: o mais antigo fica");
  assert.equal(be.admitDevice(two, porIdade, DEV(1)), "active", "o 2º mais antigo fica");
  assert.equal(be.admitDevice(two, porIdade, DEV(2)), "pending", "o mais novo volta a esperar (device extra venceu)");
  assert.equal(be.admitDevice({ ...free, deviceLimit: 3 }, porIdade, DEV(2)), "active", "com o limite de volta, cabe");
  assert.equal(be.admitDevice(free, { [DEV(1)]: { name: "antigo" }, [DEV(2)]: em(1) }, DEV(1)), "active", "registro antigo sem firstSeen conta como o mais antigo");
  assert.equal(be.admitDevice(free, tres, DEV(1)), "active", "empate de idade: decide o id, de forma estável");
  assert.equal(be.admitDevice(free, tres, DEV(3)), "pending");
  const legacy = { [DEV(1)]: { name: "mac" } }; // registro antigo sem status
  assert.equal(be.admitDevice(free, legacy, DEV(2)), "pending", "registro antigo conta como ativo");
});

test("applyLicensePatch: aplica só o válido e carimba admin", () => {
  for (const apply of [be.applyLicensePatch, fe.applyLicensePatch]) {
    const next = apply(null, { plan: "pro", status: "trialing", deviceLimit: 3, interval: "month", bogus: 1 }, 5000);
    assert.equal(next.plan, "pro");
    assert.equal(next.status, "trialing");
    assert.equal(next.deviceLimit, 3);
    assert.equal(next.interval, "month");
    assert.equal(next.updatedBy, "admin");
    assert.equal(next.updatedAt, "1970-01-01T00:00:05.000Z");
    assert.equal(apply(null, { deviceLimit: 999 }).deviceLimit, 1, "limite fora da faixa é ignorado");
  }
});

test("dois planos (free e pro): o CRM próprio vem do Pro; add-ons por cima, com ou sem o Pro", () => {
  const t = Date.parse("2026-10-19T00:00:00.000Z");
  const lic = (over) => ({ plan: "free", status: "free", expiresAt: null, ...over });
  for (const m of [be, fe]) assert.deepEqual(m.PLANS ?? ["free", "pro"], ["free", "pro"]);
  assert.equal(be.proOk(lic({ plan: "pro", status: "active" }), t), true);
  assert.equal(be.proOk(lic({ plan: "pro", status: "expired" }), t), false);
  assert.equal(be.proOk(lic({ plan: "pro", status: "active", expiresAt: "2026-10-01T00:00:00.000Z" }), t), false, "validade no passado vence");
  assert.equal(be.proOk(lic({ plan: "free", status: "active" }), t), false);
  assert.equal(be.crmOk(lic({ plan: "pro", status: "active" }), t), true, "Pro em vigor libera o CRM próprio");
  assert.equal(be.crmOk(lic({ plan: "pro", status: "trialing" }), t), true, "trial do Pro também");
  assert.equal(be.crmOk(lic({ plan: "pro", status: "expired" }), t), false);
  assert.equal(be.crmOk(lic({ plan: "free", status: "active" }), t), false, "gratuito não");
  assert.equal(be.produtoOk(lic({ produtos: ["meu-bot-fit"] }), "meu-bot-fit", t), true, "add-on sem o Pro");
  assert.equal(be.produtoOk(lic({ plan: "pro", status: "active", produtos: ["meu-bot-fit"] }), "meu-bot-fit", t), true, "add-on com o Pro");
  assert.equal(be.produtoOk(lic({ plan: "pro", status: "expired", produtos: ["meu-bot-fit"] }), "meu-bot-fit", t), false, "licença vencida tranca o add-on");
  assert.equal(be.produtoOk(lic({ plan: "pro", status: "active" }), "meu-bot-fit", t), false, "o Pro sozinho não libera add-on");
  for (const parse of [be.parseLicense, fe.parseLicense]) {
    assert.deepEqual(parse({ produtos: ["meu-bot-crm", "lixo!", "meu-bot-admin", "meu-bot-fit", "meu-bot-fit"] }).produtos, ["meu-bot-fit"], "nomes válidos, únicos, ordenados; admin e o antigo meu-bot-crm não são add-on");
  }
  assert.deepEqual(be.applyLicensePatch(lic({ produtos: ["meu-bot-fit"] }), { produtos: [] }).produtos, [], "patch substitui a lista");
  assert.deepEqual(be.applyLicensePatch(lic({}), { plan: "personalizado" }).plan, "free", "o admin não grava mais o personalizado");
  // Lado do admin: mesmas regras.
  const v = (over) => ({ license: fe.parseLicense(lic(over)), devices: [] });
  assert.equal(fe.acessoAddon(v({ plan: "pro", status: "active" }), "agente-box", "meu-bot-fit", t), "ausente", "Pro sem o add-on");
  assert.equal(fe.acessoAddon(v({ produtos: ["meu-bot-fit"] }), "agente-box", "meu-bot-fit", t), "ok", "free + add-on");
  assert.equal(fe.acessoAddon(v({ plan: "pro", status: "expired", produtos: ["meu-bot-fit"] }), "agente-box", "meu-bot-fit", t), "expirada");
  assert.equal(fe.acessoAddon(null, "agente-box", "meu-bot-fit", t), "unknown");
  assert.equal(fe.acessoAddon(v({ produtos: ["meu-bot-fit"] }), "local", "meu-bot-fit", t), "unknown");
  assert.equal(fe.acessoProduto(null, "agente-box", "free", "meu-bot", t), "ok", "app free nunca bloqueia o app inteiro");
  // crmProprioOk (lado do app): por máquina; Pro em vigor; este Mac e sem licença = não.
  assert.equal(fe.crmProprioOk(v({ plan: "pro", status: "active" }), "agente-box", t), true);
  assert.equal(fe.crmProprioOk(v({ produtos: ["meu-bot-crm"] }), "agente-box", t), false, "o antigo add-on meu-bot-crm não libera mais");
  // crmDaMaquinaOk: a API do CRM mora no nosso backend; Pro lido por SSH (máquina do Hermes, sem o backend) não libera.
  assert.equal(fe.crmDaMaquinaOk({ view: v({ plan: "pro", status: "active" }), viaBackend: true }, "grokbot-1", t), true);
  assert.equal(fe.crmDaMaquinaOk({ view: v({ plan: "pro", status: "active" }), viaBackend: false }, "grokbot-1", t), false, "Pro por SSH sem o backend não tem a API do CRM");
  assert.equal(fe.crmDaMaquinaOk({ view: v({ plan: "free", status: "active" }), viaBackend: true }, "grokbot-1", t), false);
  assert.equal(fe.crmDaMaquinaOk(null, "grokbot-1", t), false);
  assert.equal(fe.crmProprioOk(v({ plan: "pro", status: "expired" }), "agente-box", t), false);
  assert.equal(fe.crmProprioOk(v({}), "agente-box", t), false);
  assert.equal(fe.crmProprioOk(v({ plan: "pro", status: "active" }), "local", t), false, "este Mac não tem CRM próprio");
  assert.equal(fe.crmProprioOk(null, "agente-box", t), false, "sem licença lida: fechado");
});

test("licença de antes de 22 out: personalizado vira Pro + Finance (nos dois lados); legado do CRM é detectado", () => {
  const t = Date.parse("2026-10-19T00:00:00.000Z");
  for (const parse of [be.parseLicense, fe.parseLicense]) {
    const l = parse({ plan: "personalizado", status: "active", produtos: ["meu-bot-crm", "meu-bot-fit"] }, t);
    assert.equal(l.plan, "pro"); assert.equal(l.status, "active");
    assert.deepEqual(l.produtos, ["meu-bot-finance", "meu-bot-fit"], "ganha o Finance, mantém os outros, perde o meu-bot-crm");
  }
  assert.equal(be.crmOk({ plan: "personalizado", status: "active" }, t), true, "quem era personalizado segue com o CRM (agora pelo Pro)");
  assert.equal(be.financeOk({ plan: "personalizado", status: "active" }, t), true, "e com o financeiro");
  assert.equal(be.crmOk({ plan: "personalizado", status: "expired" }, t), false);
  assert.equal(be.legadoCrmContratado({ plan: "personalizado" }), true);
  assert.equal(be.legadoCrmContratado({ plan: "free", produtos: ["meu-bot-crm"] }), true);
  assert.equal(be.legadoCrmContratado({ plan: "pro", produtos: ["meu-bot-finance"] }), false);
  assert.equal(be.legadoCrmContratado(null), false);
});

test("mergeApps: cada app que se apresenta fica em apps[produto]; app antigo sem produto conta como meu-bot", () => {
  const t = Date.parse("2026-10-19T12:00:00.000Z");
  const a = be.mergeApps(undefined, undefined, "0.1.0", t);
  assert.deepEqual(a, { "meu-bot": { version: "0.1.0", lastSeen: "2026-10-19T12:00:00.000Z" } });
  const b = be.mergeApps(a, "meu-bot-crm", "0.2.0", t + 1000);
  assert.deepEqual(Object.keys(b).sort(), ["meu-bot", "meu-bot-crm"]);
  assert.equal(b["meu-bot"].version, "0.1.0", "o outro app fica como estava");
  assert.equal(be.mergeApps({ "x y": { version: "1", lastSeen: "z" } }, "lixo!", "1", t)["meu-bot"].version, "1", "nome inválido vira meu-bot; entrada inválida some");
  const devs = fe.parseDevices({ [DEV(1)]: { name: "mac", apps: b } });
  assert.deepEqual(Object.keys(devs[0].apps).sort(), ["meu-bot", "meu-bot-crm"]);
  // Um app só: quando o meu-bot (sucessor) se apresenta, o meu-bot-crm sai da lista; o inverso não apaga nada.
  assert.deepEqual(Object.keys(be.mergeApps(b, "meu-bot", "0.3.0", t + 2000)), ["meu-bot"]);
  assert.deepEqual(Object.keys(be.mergeApps({ "meu-bot-staging": { version: "1", lastSeen: "z" }, "meu-bot-crm-staging": { version: "1", lastSeen: "z" } }, "meu-bot-staging", "2", t)), ["meu-bot-staging"]);
  assert.deepEqual(fe.parseDevices({ [DEV(1)]: { name: "mac" } })[0].apps, {}, "registro antigo: sem apps");
});

test("buildLicenseView (admin): conta ativos/pendentes e ordena por visto há", () => {
  const machines = {
    [DEV(1)]: { name: "mac", platform: "macOS", app: "3.1.1", lastSeen: "2026-10-17T10:00:00.000Z" }, // sem status = ativo
    [DEV(2)]: { name: "vm", platform: "linux", app: "3.1.1", status: "pending", requestedAt: "2026-10-17T12:00:00.000Z", lastSeen: "2026-10-17T12:00:00.000Z" },
    [DEV(3)]: { name: "grokbot", platform: "linux", app: "3.1.1", status: "active", lastSeen: "2026-10-17T11:00:00.000Z" },
  };
  const view = fe.buildLicenseView({ plan: "pro", status: "active", deviceLimit: 2 }, machines);
  assert.equal(view.activeCount, 2);
  assert.equal(view.pendingCount, 1);
  assert.equal(view.deviceLimit, 2);
  assert.equal(view.devices[0].id, DEV(2), "mais recente primeiro");
  assert.equal(view.devices.find((d) => d.id === DEV(2)).requestedAt, "2026-10-17T12:00:00.000Z");
});

test("parseDevices (admin): ignora ids inválidos e normaliza status", () => {
  const devices = fe.parseDevices({ "nao-hex": { name: "x" }, [DEV(9)]: { name: "ok", status: "weird" } });
  assert.equal(devices.length, 1);
  assert.equal(devices[0].status, "active", "status desconhecido vira ativo");
});

test("financeOk (backend): só o add-on meu-bot-finance, com ou sem o Pro; o Pro sozinho não libera", () => {
  const t = Date.parse("2026-10-22T12:00:00Z");
  const l = (x) => ({ plan: "free", status: "free", produtos: [], ...x });
  assert.equal(be.financeOk(l({ plan: "pro", status: "active" }), t), false, "Pro não libera o financeiro");
  assert.equal(be.financeOk(l({ produtos: ["meu-bot-finance"] }), t), true);
  assert.equal(be.financeOk(l({ produtos: ["meu-bot-finance"], status: "expired" }), t), false);
  assert.equal(be.financeOk(l({ plan: "pro", status: "active", produtos: ["meu-bot-finance"] }), t), true, "Pro + Finance");
  assert.equal(be.financeOk(l({ produtos: ["meu-bot-fit"] }), t), false);
});

test("pagamento: os dois lados normalizam igual; inválido vira null; o patch grava e apaga", () => {
  for (const side of [be, fe]) {
    assert.equal(side.parseLicense({ plan: "pro" }).pagamento, null, "licença antiga sem o campo");
    assert.deepEqual(side.parseLicense({ pagamento: { instrucoes: "  Pix x@y.com  ", link: "https://pague.exemplo/abc" } }).pagamento, { instrucoes: "Pix x@y.com", link: "https://pague.exemplo/abc" });
    assert.deepEqual(side.parseLicense({ pagamento: { instrucoes: "Pix", link: "javascript:alert(1)" } }).pagamento, { instrucoes: "Pix", link: null }, "link só http(s)");
    assert.equal(side.parseLicense({ pagamento: { instrucoes: "   ", link: null } }).pagamento, null, "vazio vira null");
    assert.equal(side.parseLicense({ pagamento: "Pix" }).pagamento, null);
    assert.equal(side.parseLicense({ pagamento: { instrucoes: "x".repeat(3000) } }).pagamento.instrucoes.length, 2000);
    const gravada = side.applyLicensePatch({ plan: "pro" }, { pagamento: { instrucoes: "Pix", link: null } });
    assert.deepEqual(gravada.pagamento, { instrucoes: "Pix", link: null });
    assert.deepEqual(side.applyLicensePatch(gravada, { deviceLimit: 2 }).pagamento, { instrucoes: "Pix", link: null }, "patch sem o campo preserva");
    assert.equal(side.applyLicensePatch(gravada, { pagamento: null }).pagamento, null, "null apaga");
  }
});
