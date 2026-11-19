import { avisoDepoisDo404, pedeReleitura, visaoVelha } from "./admin-core.js";
import { INFINITO, SEM_LIMITE, SEM_PRAZO, TODOS_ADDONS, avisoAddonPago, contagemRegressiva, addonsNaVisaoGeral, estadoAssinaturaPro, fase, linhasDeMaquinas, deParaDoExtra, assinaturasDoItem, estadoDoItem, itemGa, ofertaDoProAparece, oQueAContaTem, pagoChegou, assinaturasAtivasDe, pedidoAssinar, podeAdicionarMaquina, promoNaTela, reaisCurto, semPrazo, vagaDoAssinar, vagasDeDevice, vagasDeMaquina } from "./plano-core.js";
// Console da conta meu-bot (console.agentesgrok.com/account/* e /organizations/<slug>/members|settings, molde Rambox). Entra pela mesma página de
// login do app (auth.agentesgrok.com) com esquema=web: o console gera state + PKCE, a página devolve #code&state, e
// POST /token {grant:"web"} vira um token de acesso de 1 h guardado neste navegador (localStorage: outra aba, inclusive
// a que o app abre, reaproveita). Vindo do app, a URL traz #code&verifier (código emitido com a sessão do app): entra sem login.
const cfg = window.MEU_BOT_CONTA;
const $ = (id) => document.getElementById(id);
// Analytics (public/analytics.js; no-op sem GA_ID). O console é uma página só: cada troca real de seção vira um page_view
// com o caminho anonimizado (/organizations/<slug>/… → /organizations/_/…); repintar a mesma seção não conta.
const ga = window.meuBotGa || { pagina() { /* sem Analytics */ }, evento() { /* sem Analytics */ } };
const caminhoAnonimo = (c) => c.replace(/^\/organizations\/(?!new(?:\/|$))[^/]+/, "/organizations/_").replace(/^\/enterprise\/[^/]+/, "/enterprise/_");
let ultimoCaminhoMedido = null;
function medirPagina(secao) { const cam = caminhoAnonimo(location.pathname); if (cam === ultimoCaminhoMedido) return; ultimoCaminhoMedido = cam; ga.pagina(cam, { secao }); }
const CH_SESSAO = "meu-bot-console-sessao", CH_LOGIN = "meu-bot-console-login";
const SECOES = ["overview", "profile", "devices", "plan", "marketplace", "support", "access", "sales", "audit", "organizations"];
const TITULOS = { sales: "Assinaturas", audit: "Auditoria", janelas: "Janelas de suporte", overview: "Visão geral", profile: "Perfil", devices: "Devices", plan: "Plano", marketplace: "Marketplace", support: "Suporte", access: "Perfis de acesso", orgs: "Organizações", "org-nova": "Nova organização" };
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const PAPEL_ORG = { dona: "dona", admin: "admin", membro: "membro" };
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const aleatorio = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const ss = { get(k) { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } }, set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage: a sessão dura a página */ } } };
const data = (iso) => { const t = Date.parse(iso ?? ""); return Number.isNaN(t) ? "-" : new Date(t).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" }); };
const dataHora = (iso) => { const t = Date.parse(iso ?? ""); return Number.isNaN(t) ? "-" : new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const PLANO = { free: "Free", pro: "Pro" }, STATUS = { free: "Free", trialing: "Trial", active: "Ativo", expired: "Expirado" }, CICLO = { month: "mensal", year: "anual" };
/** Os apps à venda neste ambiente (config.js do Worker): [{nome, rotulo, centavos}]. */
const ADDONS = (() => { try { const a = JSON.parse(cfg.addons ?? "[]"); return Array.isArray(a) ? a.filter((x) => x && typeof x.nome === "string" && typeof x.rotulo === "string" && Number.isInteger(x.centavos)) : []; } catch { return []; } })();
const reais = (centavos) => (typeof centavos === "number" ? (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "-");
/** O nome de um produto pago na tela: null é o Pro; add-on fora do catálogo aparece pelo nome técnico. */
/** As unidades extras à venda (config.js): hoje a máquina extra. Cada assinatura é uma unidade. */
const EXTRAS = (() => { try { const a = JSON.parse(cfg.extras ?? "[]"); return Array.isArray(a) ? a.filter((x) => x && typeof x.tipo === "string" && typeof x.nome === "string" && typeof x.rotulo === "string" && Number.isInteger(x.centavos)) : []; } catch { return []; } })();
const EXTRA_MAQUINA = EXTRAS.find((x) => x.tipo === "maquina") ?? null;
const EXTRA_DEVICE = EXTRAS.find((x) => x.tipo === "device") ?? null;
/** O nome de cada tipo de extra na lista do admin (vale mesmo com o catálogo vazio, para extras já pagos). */
const ROTULO_EXTRA = { maquina: "Máquina extra", device: "Device extra" };
/** As fichas do Marketplace deste ambiente (config.js; marketplace-core.ts no Worker): o texto de cada item à venda, pelo nome técnico. */
/** Os itens do Marketplace, na ordem da vitrine (o Pro primeiro). */
const MKT = (() => { try { const a = JSON.parse(cfg.marketplace ?? "[]"); return (Array.isArray(a) ? a : []).filter((x) => x && typeof x.id === "string" && typeof x.nome === "string" && typeof x.slug === "string"); } catch { return []; } })();
const FICHAS = Object.fromEntries(MKT.map((x) => [x.id, x]));
const rotuloProduto = (p) => (p === null || p === undefined ? "Pro" : ADDONS.find((a) => a.nome === p)?.rotulo ?? EXTRAS.find((x) => x.nome === p)?.rotulo ?? p);
/** Situação de uma assinatura: cancelada; em dia (ativa com prazo no futuro); atrasada (ativa sem renovar). */
const situacaoDe = (a, agora = Date.now()) => (a.status === "CANCELLED" ? { chave: "cancelada", texto: "Cancelada", tom: "" } : a.valeAte && Date.parse(a.valeAte) > agora ? { chave: "em-dia", texto: "Em dia", tom: "ok" } : { chave: "atrasada", texto: "Atrasada", tom: "mau" });
const el = (tag, cls, texto) => { const e = document.createElement(tag); if (cls) e.className = cls; if (texto !== undefined) e.textContent = texto; return e; };
const selo = (texto, tom) => el("span", `selo${tom ? ` ${tom}` : ""}`, texto);
const inicial = (c) => (c.nome ?? c.email).trim().charAt(0).toUpperCase() || "?";

$("canal").textContent = $("entrada-canal").textContent = cfg.canal === "staging" ? "staging" : "";
// Sem sessão, o rodapé do cartão leva à home do ambiente (site-staging. em staging, agentesgrok.com em produção).
if (typeof cfg.site === "string" && cfg.site !== "") $("entrada-home").href = cfg.site;

// ---- sessão
let conta = null;
/** Visão do admin (todas as contas, pedidos, totais); null para quem não é admin ou enquanto não carregou. */
let visao = null, visaoBusca = "";
/** Quando a lista do admin foi lida de fato (ms), e quando o que a tela mostra foi lido (conta ou lista): o "lido às". */
let visaoLidaEm = null, lidoEm = Date.now();
function sessaoGuardada() { const s = ss.get(CH_SESSAO); return s !== null && typeof s.acesso === "string" && Date.parse(s.expiraEm ?? "") > Date.now() + 30_000 ? s : null; }
async function api(metodo, rota, corpo, acesso) {
  const headers = { accept: "application/json" };
  if (corpo !== undefined) headers["content-type"] = "application/json";
  if (acesso) headers.authorization = `Bearer ${acesso}`;
  // Sem rede (ou a API fora do ar) o fetch rejeita: vira status 0 com o motivo, para quem chamou tratar como qualquer
  // resposta que não é 200 (mostrar o erro, soltar o botão) em vez de ficar com a ação travada e sem aviso.
  let r;
  try { r = await fetch(`${cfg.api}${rota}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }); }
  catch (e) { return { status: 0, corpo: { erro: `sem resposta da API (${e?.message ?? e}). Confira a conexão e tente de novo.` } }; }
  const j = await r.json().catch(() => null);
  return { status: r.status, corpo: j };
}
const erroDe = (r) => (r.corpo && typeof r.corpo.erro === "string" ? r.corpo.erro : `a API respondeu ${r.status}`);

/** Começa o login no auth; com `org`, pela página da organização (auth/enterprise/<slug>) e volta em Membros dela. */
async function entrar(org = null) {
  const verifier = aleatorio(48);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = aleatorio(32);
  ss.set(CH_LOGIN, { state, verifier, em: Date.now() });
  const retorno = `${cfg.console}${org !== null ? `/organizations/${org}/members` : secaoAtual() === null ? "/account/overview" : location.pathname}`;
  const q = new URLSearchParams({ esquema: "web", state, challenge, app: "meu-bot-console", retorno });
  location.href = `${cfg.auth}/${org !== null ? `enterprise/${encodeURIComponent(org)}` : "entrar"}?${q.toString()}`;
}
async function trocarCodigo(code, state, verifierDoApp = null) {
  let verifier = verifierDoApp;
  if (verifier === null) {
    const p = ss.get(CH_LOGIN);
    ss.set(CH_LOGIN, null);
    if (p === null || p.state !== state || Date.now() - p.em > 10 * 60 * 1000) throw new Error("o retorno não é deste login (ou passou de 10 min); entre de novo");
    verifier = p.verifier;
  }
  const r = await api("POST", "/token", { grant: "web", code, verifier });
  if (r.status !== 200 || !r.corpo || typeof r.corpo.acesso !== "string") throw new Error(erroDe(r));
  ss.set(CH_SESSAO, { acesso: r.corpo.acesso, expiraEm: r.corpo.expiraEm });
  lidoEm = Date.now();
  return r.corpo.conta;
}
async function lerConta() {
  const s = sessaoGuardada();
  if (s === null) return null;
  const r = await api("GET", "/conta", undefined, s.acesso);
  if (r.status === 401) { ss.set(CH_SESSAO, null); return null; }
  if (r.status !== 200) throw new Error(erroDe(r));
  lidoEm = Date.now();
  return r.corpo;
}
async function carregarVisao(busca) {
  const s = sessaoGuardada();
  if (s === null || conta === null || conta.admin === null) { visao = null; return; }
  const r = await api("GET", `/admin/visao?busca=${encodeURIComponent(busca)}`, undefined, s.acesso);
  if (r.status !== 200) throw new Error(erroDe(r));
  visao = r.corpo; visaoBusca = busca; visaoLidaEm = Date.now(); lidoEm = visaoLidaEm;
}
/**
 * Falha numa ação do admin sobre a conta `c`. Um 404 diz que a lista está velha (a conta ou o device foi removido
 * depois da leitura): relê, redesenha (o que fecha o editor aberto) e avisa. Os outros erros só aparecem.
 */
async function falhaAdmin(r, c) {
  if (!pedeReleitura(r.status)) { mostrarErro(erroDe(r)); return; }
  let relida = true;
  await carregarVisao(visaoBusca).catch(() => { relida = false; });
  if (conta !== null) mostrarConsole(conta);
  mostrarErro(avisoDepoisDo404(erroDe(r), c.id, relida && visao !== null ? visao.contas : null));
}
async function atender(id, botao) {
  const s = sessaoGuardada();
  if (s === null) return;
  botao.disabled = true;
  const r = await api("POST", `/admin/pedidos/${encodeURIComponent(id)}/atender`, {}, s.acesso);
  if (r.status !== 200) { botao.disabled = false; mostrarErro(erroDe(r)); return; }
  await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
  if (conta !== null) mostrarConsole(conta);
}
async function sair() {
  ga.evento("console_saida");
  const s = sessaoGuardada();
  if (s !== null) await api("POST", "/sessao/sair", {}, s.acesso).catch(() => undefined);
  ss.set(CH_SESSAO, null);
  conta = null;
  mostrarEntrada(null);
}

// ---- telas
/** O que o caminho pede: uma seção da conta (/account/plan), a lista do super (/account/organizations → "orgs"),
 *  a criação (/organizations/new) ou uma organização (/organizations/<slug>/members|settings). */
function rota() {
  const mk = /^\/account\/marketplace\/([a-z0-9-]{1,60})\/?$/.exec(location.pathname);
  if (mk !== null) return { secao: "marketplace", slug: mk[1], aba: null };
  const m = /^\/account\/([a-z]+)\/?$/.exec(location.pathname);
  if (m !== null && SECOES.includes(m[1])) return { secao: m[1] === "organizations" ? "orgs" : m[1], slug: null, aba: null };
  if (/^\/organizations\/new\/?$/.test(location.pathname)) return { secao: "org-nova", slug: null, aba: null };
  if (/^\/support-window\/?$/.test(location.pathname)) return { secao: "janelas", slug: null, aba: null };
  const o = /^\/organizations\/([a-z0-9-]{2,40})(?:\/(members|settings))?\/?$/.exec(location.pathname);
  if (o !== null && SLUG_RE.test(o[1])) return { secao: "org", slug: o[1], aba: o[2] ?? "members" };
  return null;
}
function secaoAtual() { const r = rota(); return r === null ? null : r.secao; }
/** A organização aberta (GET /orgs/:slug); null até carregar. */
let orgAtual = null;
async function orgCarregar(slug) {
  const s = sessaoGuardada(); if (s === null) return null;
  const r = await api("GET", `/orgs/${encodeURIComponent(slug)}`, undefined, s.acesso);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error(erroDe(r));
  return r.corpo;
}
function mostrarErro(texto) { $("erro").hidden = texto === null; $("erro").textContent = texto ?? ""; }
function mostrarEntrada(erro) {
  $("console").hidden = true; $("entrada").hidden = false;
  ultimoCaminhoMedido = null; ga.pagina(caminhoAnonimo(location.pathname), { secao: "entrada" });
  $("entrada-erro").hidden = erro === null; $("entrada-erro").textContent = erro ?? "";
}
function mostrarConsole(c) {
  conta = c;
  $("entrada").hidden = true; $("console").hidden = false;
  // Checkout de add-on ou de unidade aberto antes do Marketplace existir volta em /account/plan?…&produto=…: o lugar dele agora é o Marketplace.
  if (rota()?.secao === "plan" && new URLSearchParams(location.search).get("produto")) history.replaceState(null, "", `/account/marketplace${location.search}`);
  const r = rota() ?? { secao: "overview", slug: null, aba: null };
  const secao = r.secao;
  if (rota() === null) history.replaceState(null, "", "/account/overview");
  pintarMenuOrgs(c);
  for (const a of $("menu").querySelectorAll("a")) a.classList.toggle("ativo", a.dataset.secao === secao && (secao !== "org" || a.dataset.slug === r.slug));
  for (const s of document.querySelectorAll("section[data-secao]")) s.hidden = s.dataset.secao !== secao;
  $("titulo").textContent = TITULOS[secao] ?? "";
  document.title = `${TITULOS[secao] ?? "Organização"} · Console meu-bot`;
  medirPagina(secao);
  $("prazo").hidden = secao !== "plan" || $("prazo").textContent === "";
  $("atualizado").textContent = `lido às ${new Date(lidoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  pintarQuem(c);
  const admin = visao !== null;
  $("console").classList.toggle("modo-admin", admin);
  $("menu-access").hidden = !(admin && c.admin === "super");
  $("menu-sales").hidden = !(admin && c.admin === "super");
  $("menu-orgs-todas").hidden = !(admin && c.admin === "super");
  $("menu-janelas").hidden = !(admin && c.admin === "super");
  $("menu-audit").hidden = !(admin && c.admin === "super");
  for (const id of ["ad-overview", "ad-plan", "ad-devices", "ad-support"]) $(id).hidden = !admin;
  for (const d of document.querySelectorAll("details.pessoal")) d.open = !admin;
  if ((secao === "access" || secao === "sales" || secao === "orgs" || secao === "janelas" || secao === "audit") && !(admin && c.admin === "super")) { history.replaceState(null, "", "/account/overview"); mostrarConsole(c); return; }
  if (secao === "org-nova") { pintarOrgNova(); return; }
  if (secao === "janelas") { void pintarJanelas(); return; }
  if (secao === "audit") { void pintarAuditoria(); return; }
  if (secao === "orgs") { pintarAdminOrgs(visao); return; }
  if (secao === "org") { void abrirOrg(r.slug, r.aba); return; }
  ({ overview: pintarOverview, profile: pintarPerfil, devices: pintarDevices, plan: pintarPlano, marketplace: pintarMarketplace, support: pintarSuporte, access: () => undefined, sales: () => undefined })[secao](c);
  if (admin) ({ overview: pintarAdminTotais, profile: () => undefined, devices: pintarAdminDevices, plan: pintarAdminContas, marketplace: () => undefined, support: pintarAdminPedidos, access: pintarAdminPerfis, sales: pintarAdminVendas })[secao](visao);
}

// ---- auditoria (/account/audit, só super admin): as contas apagadas e o registro de ações, que as outras telas não mostram
let auditoria = { apagadas: [], ocultas: [], registro: [] };
function filtrarAuditoria() {
  const q = $("audit-busca").value.trim().toLowerCase();
  const casa = (x) => q === "" || JSON.stringify(x).toLowerCase().includes(q);
  const linha = (tb, celulas) => { const tr = el("tr"); for (const t of celulas) tr.append(el("td", "", t)); tb.append(tr); };
  const vazio = (tb, colunas, texto) => { const tr = el("tr"); const td = el("td", "", texto); td.colSpan = colunas; tr.append(td); tb.append(tr); };
  const apagadas = auditoria.apagadas.filter(casa), ocultas = auditoria.ocultas.filter(casa), registro = auditoria.registro.filter(casa);
  const ta = $("audit-apagadas").querySelector("tbody"); ta.replaceChildren();
  if (apagadas.length === 0) vazio(ta, 6, auditoria.apagadas.length === 0 ? "Nenhuma conta apagada." : "Nenhuma conta apagada com esse filtro.");
  for (const c of apagadas) {
    const licenca = c.plan === null ? "-" : `${c.plan} · ${c.status}${c.expiresAt ? ` até ${data(c.expiresAt)}` : ""}`;
    linha(ta, [c.email, dataHora(c.criadaEm), dataHora(c.apagadaEm), c.apagadaPor === null ? "sem registro" : c.apagadaPor === c.email ? "a própria pessoa" : c.apagadaPor, licenca, reais(c.pagoCentavos)]);
  }
  const to = $("audit-ocultas").querySelector("tbody"); to.replaceChildren();
  if (ocultas.length === 0) vazio(to, 8, auditoria.ocultas.length === 0 ? "Nada ocultado da tela Assinaturas." : "Nada ocultado com esse filtro.");
  for (const v of ocultas) {
    linha(to, [v.tipo === "assinaturas" ? "assinatura" : "pagamento", v.conta.email, rotuloProduto(v.produto), reais(v.valorCentavos), dataHora(v.quando), dataHora(v.ocultaEm), v.ocultaPor ?? "-"]);
    const b = el("button", "btn btn-ghost btn-small", "Mostrar de novo"); b.type = "button"; b.title = "Volta para a tela Assinaturas e para os totais."; b.addEventListener("click", () => { void vendaOculta(v.tipo, v.id, false, b); });
    const td = el("td"); td.append(b); to.lastElementChild.append(td);
  }
  const tr = $("audit-registro").querySelector("tbody"); tr.replaceChildren();
  if (registro.length === 0) vazio(tr, 5, auditoria.registro.length === 0 ? "Nenhuma ação registrada." : "Nenhuma ação com esse filtro.");
  for (const a of registro) linha(tr, [dataHora(a.quando), a.quem, a.acao, a.conta === null ? "-" : `${a.conta.email ?? a.conta.id}${a.conta.apagada ? " (apagada)" : ""}`, a.detalhe ?? "-"]);
  $("audit-estado").textContent = `${ocultas.length} de ${auditoria.ocultas.length} ocultado${auditoria.ocultas.length === 1 ? "" : "s"} · ${apagadas.length} de ${auditoria.apagadas.length} conta${auditoria.apagadas.length === 1 ? "" : "s"} apagada${auditoria.apagadas.length === 1 ? "" : "s"} · ${registro.length} de ${auditoria.registro.length} ações`;
}
/** Oculta da tela Assinaturas (ou traz de volta) uma assinatura ou um pagamento, e redesenha a tela de onde o clique veio. */
async function vendaOculta(tipo, id, ocultar, botao) {
  const s = sessaoGuardada(); if (s === null) return;
  botao.disabled = true; mostrarErro(null);
  const r = await api("POST", `/admin/vendas/${tipo}/${encodeURIComponent(id)}/${ocultar ? "ocultar" : "mostrar"}`, {}, s.acesso);
  // 404: a linha já mudou de lado (outra aba, outro super admin); reler mostra o estado de agora.
  if (r.status !== 200 && r.status !== 404) { botao.disabled = false; mostrarErro(erroDe(r)); return; }
  if (!ocultar) { await pintarAuditoria(); return; }
  await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
  if (conta !== null) mostrarConsole(conta);
}
async function pintarAuditoria() {
  const s = sessaoGuardada(); if (s === null) return;
  $("audit-estado").textContent = "lendo…";
  const r = await api("GET", "/admin/auditoria", undefined, s.acesso);
  if (r.status !== 200) { mostrarErro(erroDe(r)); $("audit-estado").textContent = ""; return; }
  mostrarErro(null);
  auditoria = { apagadas: Array.isArray(r.corpo?.apagadas) ? r.corpo.apagadas : [], ocultas: Array.isArray(r.corpo?.ocultas) ? r.corpo.ocultas : [], registro: Array.isArray(r.corpo?.registro) ? r.corpo.registro : [] };
  filtrarAuditoria();
}
$("audit-busca").addEventListener("input", filtrarAuditoria);
$("audit-recarregar").addEventListener("click", () => { void pintarAuditoria(); });
// "Zerar" só existe no staging (a API recusa em produção): recomeça a auditoria depois de uma rodada de testes.
// Dois cliques: o segundo confirma, em até 5 s.
$("audit-zerar").hidden = cfg.canal !== "staging";
$("audit-zerar").addEventListener("click", (ev) => { void zerarAuditoria(ev.currentTarget); });
async function zerarAuditoria(botao) {
  if (botao.dataset.confirma !== "1") {
    botao.dataset.confirma = "1"; botao.textContent = "Confirmar: apagar tudo desta tela";
    setTimeout(() => { if (!botao.disabled) { delete botao.dataset.confirma; botao.textContent = "Zerar"; } }, 5000);
    return;
  }
  const s = sessaoGuardada(); if (s === null) return;
  botao.disabled = true; mostrarErro(null);
  const r = await api("POST", "/admin/auditoria/zerar", {}, s.acesso);
  botao.disabled = false; delete botao.dataset.confirma; botao.textContent = "Zerar";
  if (r.status !== 200) { mostrarErro(erroDe(r)); return; }
  await pintarAuditoria();
  // As assinaturas apagadas saem também da lista de cada conta e dos totais do admin.
  await carregarVisao(visaoBusca).catch(() => undefined);
  if (r.corpo?.naoCanceladas > 0) mostrarErro(`${r.corpo.naoCanceladas} assinatura(s) ficaram: a AbacatePay não confirmou o cancelamento. Tente zerar de novo.`);
}
// ---- janelas de suporte (/support-window): o último resumo de cada pessoa que o meu-bot-admin-gestao leu
let janelas = [];
const marca = (ok) => (ok === true ? "✓" : ok === false ? "✗" : "•");
const classeOk = (ok) => (ok === true ? "j-ok" : ok === false ? "j-mau" : "j-neutro");
function blocoLinhas(titulo, linhas) {
  const box = el("div", "j-bloco"); box.append(el("div", "j-titulo", titulo));
  const ul = el("ul", "j-linhas");
  for (const l of linhas) { const li = el("li", classeOk(l.ok)); li.append(el("span", "j-marca", marca(l.ok)), document.createTextNode(l.texto)); ul.append(li); }
  box.append(ul); return box;
}
function pintarJanelaCartao(p) {
  const r = p.resumo ?? {}; const card = el("article", "painel j-cartao");
  const topo = el("div", "j-topo");
  topo.append(el("strong", "", p.nome));
  if (p.maquina) topo.append(el("span", "selo", p.maquina));
  const ac = r.acesso;
  if (ac) topo.append(el("span", ac.usuario === "root" ? "selo j-root" : "selo", ac.usuario === "root" ? "root" : `usuário ${ac.usuario}`), el("span", "j-end", `${ac.usuario}@${ac.endereco}${ac.porta !== 22 ? `:${ac.porta}` : ""}`));
  const falhas = (r.saude ?? []).filter((l) => l.ok === false).length;
  topo.append(el("span", falhas > 0 ? "selo j-selo-mau" : "selo ok", falhas > 0 ? `${falhas} alerta${falhas > 1 ? "s" : ""}` : "ok"));
  card.append(topo, el("p", "sub", `lido ${dataHora(p.atualizadoEm)} · pelo app de ${p.enviadoPor}`));
  const grade = el("div", "j-grade");
  grade.append(blocoLinhas("Saúde da máquina", r.saude ?? []));
  if ((r.licenca ?? []).length > 0) grade.append(blocoLinhas("Conta e licença", r.licenca));
  grade.append((r.uso ?? []).length > 0 ? blocoLinhas("Uso do app (última versão de cada app)", r.uso) : blocoLinhas("Uso do app", [{ texto: "sem aberturas registradas (backend antigo ou ninguém abriu ainda)", ok: null }]));
  card.append(grade);
  if ((r.aberturas ?? []).length > 0) {
    const d = el("details", "j-hist"); d.append(el("summary", "", `Aberturas recentes (${r.aberturas.length})`));
    const ul = el("ul", "j-linhas"); for (const t of r.aberturas) ul.append(el("li", "j-neutro", t)); d.append(ul); card.append(d);
  }
  return card;
}
function filtrarJanelas() {
  const q = $("janelas-busca").value.trim().toLowerCase();
  const box = $("ad-janelas"); box.replaceChildren();
  const lista = q === "" ? janelas : janelas.filter((p) => JSON.stringify(p).toLowerCase().includes(q));
  $("janelas-estado").textContent = janelas.length === 0 ? "Nenhuma janela ainda: abra o meu-bot-admin-gestao logado como admin (ele envia em até 1 min)." : `${lista.length} de ${janelas.length} pessoa${janelas.length > 1 ? "s" : ""}`;
  for (const p of lista) box.append(pintarJanelaCartao(p));
}
async function pintarJanelas() {
  const s = sessaoGuardada(); if (s === null) return;
  $("janelas-estado").textContent = "lendo…";
  const r = await api("GET", "/admin/suporte", undefined, s.acesso);
  if (r.status !== 200) { mostrarErro(erroDe(r)); $("janelas-estado").textContent = ""; return; }
  mostrarErro(null);
  janelas = Array.isArray(r.corpo?.pessoas) ? r.corpo.pessoas : [];
  filtrarJanelas();
}
$("janelas-busca").addEventListener("input", filtrarJanelas);
$("janelas-recarregar").addEventListener("click", () => { void pintarJanelas(); });

// ---- organizações (molde Rambox Enterprise)
function pintarMenuOrgs(c) {
  const box = $("menu-orgs"); box.replaceChildren();
  for (const o of c.orgs ?? []) {
    const a = el("a"); a.href = `/organizations/${o.slug}/members`; a.dataset.secao = "org"; a.dataset.slug = o.slug;
    a.append(el("span", "ico", "▣"), document.createTextNode(o.nome), selo(PAPEL_ORG[o.papel] ?? o.papel));
    box.append(a);
  }
}
function pintarOrgNova() {
  const form = $("org-nova-form"); form.reset(); $("org-nova-criar").disabled = false;
  form.elements.slug.dataset.auto = "1"; orgNovaPrevia();
}
const slugDoNome = (nome) => nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
function orgNovaPrevia() {
  const slug = $("org-nova-form").elements.slug.value;
  const base = (cfg.console || "").replace(/^https:\/\/console(-staging)?\./, "");
  $("org-nova-previa").textContent = slug ? `O console do time fica em ${cfg.console}/organizations/${slug}/members. Endereço próprio ${slug}.${base} na próxima versão.` : "O endereço vira a URL do time (letras minúsculas, dígitos e hífen).";
}
async function orgCriar() {
  const s = sessaoGuardada(); if (s === null) return;
  const form = $("org-nova-form");
  const nome = form.elements.nome.value.trim(), slug = form.elements.slug.value.trim();
  if (!SLUG_RE.test(slug) || slug.length < 2) { mostrarErro("Endereço: letras minúsculas, dígitos e hífen, 2 a 40 caracteres."); return; }
  $("org-nova-criar").disabled = true;
  const r = await api("POST", "/orgs", { nome, slug }, s.acesso);
  if (r.status !== 200) { $("org-nova-criar").disabled = false; mostrarErro(erroDe(r)); return; }
  mostrarErro(null);
  ga.evento("org_criada");
  orgAtual = r.corpo;
  await recarregarConta();
  history.pushState(null, "", `/organizations/${slug}/members`);
  if (conta !== null) mostrarConsole(conta);
}
/** Relê a conta (as organizações mudaram) sem sair da página. */
async function recarregarConta() {
  try { const c = await lerConta(); if (c !== null) conta = c; } catch { /* a tela segue com o que tem */ }
}
async function abrirOrg(slug, aba) {
  if (orgAtual === null || orgAtual.slug !== slug) {
    orgAtual = null;
    try { orgAtual = await orgCarregar(slug); } catch (e) { mostrarErro(e?.message ?? String(e)); return; }
    if (orgAtual === null) { mostrarErro("Organização não encontrada (ou você não faz parte dela)."); history.replaceState(null, "", "/account/overview"); if (conta !== null) mostrarConsole(conta); return; }
  }
  if (rota()?.slug !== slug) return; // a pessoa já foi para outro lugar enquanto carregava
  pintarOrg(orgAtual, aba);
}
function pintarOrg(o, aba) {
  const gerencia = o.meuPapel === "dona" || o.meuPapel === "admin" || o.meuPapel === "super";
  $("titulo").textContent = o.nome; document.title = `${o.nome} · Console meu-bot`;
  $("org-slug").textContent = o.slug;
  $("org-papel").textContent = o.meuPapel === "super" ? "você vê como super admin" : `você é ${PAPEL_ORG[o.meuPapel]}`;
  for (const a of $("org-abas").querySelectorAll("a")) { a.classList.toggle("ativo", a.dataset.aba === aba); a.href = `/organizations/${o.slug}/${a.dataset.aba}`; }
  $("org-membros").hidden = aba !== "members"; $("org-config").hidden = aba !== "settings";
  if (aba === "members") pintarOrgMembros(o, gerencia); else pintarOrgConfig(o, gerencia);
}
function pintarOrgMembros(o, gerencia) {
  const livres = Math.max(0, o.assentos - o.ocupados), convidados = o.membros.filter((m) => m.status !== "ativo").length;
  $("org-resumo").textContent = `${o.ocupados} ${o.ocupados === 1 ? "pessoa" : "pessoas"} nesta organização${convidados > 0 ? ` (${convidados} ainda sem entrar)` : ""} · ${livres} ${livres === 1 ? "assento livre" : "assentos livres"} de ${o.assentos}.`;
  const form = $("org-convite-form"); form.hidden = !gerencia;
  $("org-convidar").disabled = livres === 0; $("org-convite-email").disabled = livres === 0;
  $("org-convite-nota").textContent = !gerencia ? "" : livres === 0 ? "Sem assentos livres: remova alguém ou peça mais assentos ao suporte." : o.dominioEmail ? `Só e-mails @${o.dominioEmail} (Configurações).` : "";
  const tb = $("org-tabela").querySelector("tbody"); tb.replaceChildren();
  for (const m of o.membros) {
    const tr = el("tr");
    const nomeCol = m.nome ? `${m.nome}${m.eu ? " (você)" : ""}` : m.eu ? "você" : null;
    tr.append(contaCelula(m.email, nomeCol));
    const tdPapel = el("td");
    if (gerencia && !m.eu) {
      const sel = el("select");
      for (const [v, t] of Object.entries(PAPEL_ORG)) { const op = el("option", "", t); op.value = v; op.selected = v === m.papel; if (v === "dona" && (o.meuPapel === "admin" || m.status !== "ativo")) op.disabled = true; sel.append(op); }
      if (o.meuPapel === "admin" && m.papel === "dona") sel.disabled = true;
      sel.addEventListener("change", () => { void membroPapel(o.slug, m.email, sel.value, sel); });
      tdPapel.append(sel);
    } else tdPapel.append(selo(PAPEL_ORG[m.papel] ?? m.papel, m.papel === "dona" ? "ok" : ""));
    tr.append(tdPapel);
    const st = el("td"); st.append(selo(m.status === "ativo" ? "Ativo" : "Convidado", m.status === "ativo" ? "ok" : ""));
    if (m.status !== "ativo" && gerencia) { const b = el("button", "btn btn-ghost copiar", "Copiar link"); b.type = "button"; b.title = "Mande este link para a pessoa: ao entrar com o e-mail convidado, ela já cai aqui."; b.addEventListener("click", () => { void copiarLink(o.url, b); }); st.append(b); }
    tr.append(st);
    tr.append(el("td", "", m.entrouEm ? data(m.entrouEm) : `convidado em ${data(m.convidadoEm)}${m.convidadoPor ? ` por ${m.convidadoPor}` : ""}`));
    const td = el("td");
    if ((gerencia && !m.eu && !(o.meuPapel === "admin" && m.papel === "dona")) || (m.eu && o.meuPapel !== "dona" && o.meuPapel !== "super")) { const b = el("button", "btn btn-ghost", m.eu ? "Sair" : "Remover"); b.type = "button"; b.addEventListener("click", () => { void membroRemover(o.slug, m.email, m.eu, b); }); td.append(b); }
    tr.append(td);
    tb.append(tr);
  }
}
function pintarOrgConfig(o, gerencia) {
  const form = $("org-form");
  form.elements.nome.value = o.nome; form.elements.dominioEmail.value = o.dominioEmail ?? ""; form.elements.assentos.value = String(o.assentos);
  form.elements.nome.disabled = form.elements.dominioEmail.disabled = !gerencia; $("org-salvar").hidden = !gerencia; $("org-salvo").hidden = true; $("org-salvar").disabled = false;
  form.elements.assentos.disabled = o.meuPapel !== "super";
  $("org-url").textContent = o.url; $("org-url").href = o.url;
  const loginUrl = `${cfg.auth}/enterprise/${o.slug}`;
  $("org-login-url").textContent = loginUrl; $("org-login-url").href = loginUrl;
  $("org-login-copiar").onclick = () => { void copiarLink(loginUrl, $("org-login-copiar")); };
  $("org-host").textContent = `${o.slug}.${(cfg.console || "").replace(/^https:\/\/console(-staging)?\./, "")}`;
  const dona = o.meuPapel === "dona" || o.meuPapel === "super";
  $("org-perigo-titulo").textContent = dona ? "Apagar organização" : "Sair da organização";
  $("org-perigo-texto").textContent = dona ? "Remove todos os membros e libera as contas deles; o endereço não pode ser reutilizado. Não dá para desfazer." : "Você deixa de ver esta organização; a dona pode convidar você de novo.";
  const b = $("org-apagar"); b.disabled = false; b.dataset.confirma = ""; b.textContent = dona ? "Apagar esta organização" : "Sair desta organização";
}
async function orgSalvar() {
  const s = sessaoGuardada(); if (s === null || orgAtual === null) return;
  const form = $("org-form");
  const patch = { nome: form.elements.nome.value.trim(), dominioEmail: form.elements.dominioEmail.value.trim() || null };
  $("org-salvar").disabled = true; $("org-salvo").hidden = true;
  const r = await api("PATCH", `/orgs/${encodeURIComponent(orgAtual.slug)}`, patch, s.acesso);
  if (r.status !== 200) { $("org-salvar").disabled = false; mostrarErro(erroDe(r)); return; }
  mostrarErro(null); orgAtual = r.corpo;
  if (orgAtual.meuPapel === "super" && Number(form.elements.assentos.value) !== orgAtual.assentos) {
    const ra = await api("PATCH", `/admin/orgs/${encodeURIComponent(orgAtual.slug)}`, { assentos: Number(form.elements.assentos.value) }, s.acesso);
    if (ra.status !== 200) { mostrarErro(erroDe(ra)); } else orgAtual.assentos = ra.corpo.assentos;
  }
  await recarregarConta();
  if (conta !== null) mostrarConsole(conta);
  $("org-salvo").hidden = false;
}
async function orgApagar(botao) {
  const s = sessaoGuardada(); if (s === null || orgAtual === null) return;
  const dona = orgAtual.meuPapel === "dona" || orgAtual.meuPapel === "super";
  if (botao.dataset.confirma !== "1") { botao.dataset.confirma = "1"; botao.textContent = dona ? "Confirmar: apagar a organização agora" : "Confirmar: sair agora"; return; }
  botao.disabled = true;
  const r = dona ? await api("DELETE", `/orgs/${encodeURIComponent(orgAtual.slug)}`, undefined, s.acesso) : await api("DELETE", `/orgs/${encodeURIComponent(orgAtual.slug)}/membros/${encodeURIComponent(conta.email)}`, undefined, s.acesso);
  if (r.status !== 200) { botao.disabled = false; botao.dataset.confirma = ""; mostrarErro(erroDe(r)); return; }
  mostrarErro(null); orgAtual = null;
  if (dona) ga.evento("org_apagada"); else ga.evento("membro_removido", { eu: true });
  await recarregarConta();
  if (visao !== null) await carregarVisao(visaoBusca).catch(() => undefined);
  history.pushState(null, "", "/account/overview");
  if (conta !== null) mostrarConsole(conta);
}
async function convidar() {
  const s = sessaoGuardada(); if (s === null || orgAtual === null) return;
  const email = $("org-convite-email").value.trim().toLowerCase(); if (!email) return;
  $("org-convidar").disabled = true;
  const r = await api("POST", `/orgs/${encodeURIComponent(orgAtual.slug)}/membros`, { email, papel: $("org-convite-papel").value }, s.acesso);
  if (r.status !== 200) { $("org-convidar").disabled = false; mostrarErro(erroDe(r)); return; }
  mostrarErro(null); orgAtual = r.corpo; $("org-convite-email").value = "";
  ga.evento("convite_enviado", { papel: $("org-convite-papel").value, status: (r.corpo.membros || []).find((m) => m.email === email)?.status ?? "convidado" });
  pintarOrg(orgAtual, "members");
}
async function membroPapel(slug, email, papel, controle) {
  const s = sessaoGuardada(); if (s === null) return;
  controle.disabled = true;
  const r = await api("PATCH", `/orgs/${encodeURIComponent(slug)}/membros/${encodeURIComponent(email)}`, { papel }, s.acesso);
  if (r.status !== 200) { mostrarErro(erroDe(r)); if (orgAtual !== null) pintarOrg(orgAtual, "members"); return; }
  mostrarErro(null); orgAtual = r.corpo; pintarOrg(orgAtual, "members");
}
async function membroRemover(slug, email, eu, botao) {
  const s = sessaoGuardada(); if (s === null) return;
  if (botao.dataset.confirma !== "1") { botao.dataset.confirma = "1"; botao.textContent = eu ? "Confirmar saída" : "Confirmar remoção"; return; }
  botao.disabled = true;
  const r = await api("DELETE", `/orgs/${encodeURIComponent(slug)}/membros/${encodeURIComponent(email)}`, undefined, s.acesso);
  if (r.status !== 200) { botao.disabled = false; botao.dataset.confirma = ""; botao.textContent = eu ? "Sair" : "Remover"; mostrarErro(erroDe(r)); return; }
  mostrarErro(null);
  ga.evento("membro_removido", { eu });
  if (eu) { orgAtual = null; await recarregarConta(); history.pushState(null, "", "/account/overview"); if (conta !== null) mostrarConsole(conta); return; }
  orgAtual = r.corpo; pintarOrg(orgAtual, "members");
}
async function copiarLink(url, botao) {
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch { ok = false; }
  if (!ok) { const i = el("input"); i.value = url; i.readOnly = true; botao.replaceWith(i); i.select(); return; }
  const antes = botao.textContent; botao.textContent = "Copiado"; setTimeout(() => { botao.textContent = antes; }, 1500);
}
function pintarAdminOrgs(v) {
  const tb = $("ad-orgs").querySelector("tbody"); tb.replaceChildren();
  if (v.orgs.length === 0) { const tr = el("tr"); const td = el("td", "", "Nenhuma organização ainda."); td.colSpan = 7; tr.append(td); tb.append(tr); }
  for (const o of v.orgs) {
    const tr = el("tr");
    const tdSlug = el("td"); const a = el("a", "", o.slug); a.href = `/organizations/${o.slug}/members`; a.addEventListener("click", (ev) => { ev.preventDefault(); history.pushState(null, "", a.getAttribute("href")); if (conta !== null) mostrarConsole(conta); }); tdSlug.append(a); tr.append(tdSlug);
    tr.append(el("td", "", o.nome), el("td", "", o.dona), el("td", "", String(o.membros)));
    const tdA = el("td"); const inp = el("input"); inp.type = "number"; inp.min = "1"; inp.max = "1000"; inp.value = String(o.assentos); inp.style.width = "80px"; tdA.append(inp); tr.append(tdA);
    tr.append(el("td", "", data(o.criadaEm)));
    const td = el("td", "acoes-linha"); const b = el("button", "btn btn-ghost", "Salvar"); b.type = "button"; b.addEventListener("click", () => { void adminAssentos(o.slug, Number(inp.value), b); });
    const rm = el("button", "btn btn-ghost btn-perigo", "Remover"); rm.type = "button"; rm.title = `Apaga a organização ${o.nome} e tira todos os membros dela. Não dá para desfazer.`;
    rm.addEventListener("click", () => { void adminRemoverOrg(o, rm); });
    td.append(b, rm); tr.append(td);
    tb.append(tr);
  }
}
/** O super admin apaga uma organização (DELETE /orgs/:slug aceita o papel super): dois cliques, como nos perfis. */
async function adminRemoverOrg(o, botao) {
  const s = sessaoGuardada(); if (s === null) return;
  if (botao.dataset.confirma !== "1") { botao.dataset.confirma = "1"; botao.textContent = `Confirmar: apagar ${o.slug}`; return; }
  botao.disabled = true;
  const r = await api("DELETE", `/orgs/${encodeURIComponent(o.slug)}`, undefined, s.acesso);
  if (r.status !== 200) { botao.disabled = false; botao.dataset.confirma = ""; botao.textContent = "Remover"; mostrarErro(erroDe(r)); return; }
  mostrarErro(null); if (orgAtual !== null && orgAtual.slug === o.slug) orgAtual = null;
  const c = await lerConta().catch(() => null); if (c !== null) conta = c;
  await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
  if (conta !== null) mostrarConsole(conta);
}
async function adminAssentos(slug, assentos, botao) {
  const s = sessaoGuardada(); if (s === null) return;
  botao.disabled = true;
  const r = await api("PATCH", `/admin/orgs/${encodeURIComponent(slug)}`, { assentos }, s.acesso);
  botao.disabled = false;
  if (r.status !== 200) { mostrarErro(erroDe(r)); return; }
  mostrarErro(null); if (orgAtual !== null && orgAtual.slug === slug) orgAtual = null;
  await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
  if (conta !== null) mostrarConsole(conta);
}
function pintarAdminPerfis(v) {
  const tb = $("ad-perfis").querySelector("tbody"); tb.replaceChildren();
  for (const p of v.perfis) {
    const tr = el("tr");
    tr.append(el("td", "", p.email));
    const papel = el("td"); const sel = el("select"); for (const [val, t] of [["admin", "admin"], ["super", "super admin"]]) { const o = el("option", "", t); o.value = val; o.selected = val === p.papel; sel.append(o); }
    sel.disabled = p.email === conta.email || p.fixo === true; if (p.fixo === true) sel.title = "O admin inicial é sempre super admin."; sel.addEventListener("change", () => { void perfilGravar(p.email, sel.value, sel); }); papel.append(sel); tr.append(papel);
    tr.append(el("td", "", p.entrou ? "sim" : "ainda não"), el("td", "", data(p.criadoEm)));
    const td = el("td"); if (p.fixo === true) td.append(el("span", "sub", "admin inicial")); else if (p.email !== conta.email) { const b = el("button", "btn btn-ghost", "Remover"); b.type = "button"; b.addEventListener("click", () => { void perfilRemover(p.email, b); }); td.append(b); } tr.append(td);
    tb.append(tr);
  }
}
async function perfilGravar(email, papel, controle) {
  const s = sessaoGuardada(); if (s === null) return;
  controle.disabled = true;
  const r = await api("PUT", `/admin/perfis/${encodeURIComponent(email)}`, { papel }, s.acesso);
  if (r.status !== 200) { controle.disabled = false; mostrarErro(erroDe(r)); return; }
  mostrarErro(null);
  await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
  if (conta !== null) mostrarConsole(conta);
}
async function perfilRemover(email, botao) {
  const s = sessaoGuardada(); if (s === null) return;
  if (botao.dataset.confirma !== "1") { botao.dataset.confirma = "1"; botao.textContent = "Confirmar remoção"; return; }
  botao.disabled = true;
  const r = await api("DELETE", `/admin/perfis/${encodeURIComponent(email)}`, undefined, s.acesso);
  if (r.status !== 200) { botao.disabled = false; mostrarErro(erroDe(r)); return; }
  mostrarErro(null);
  await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
  if (conta !== null) mostrarConsole(conta);
}
/** O "∞" no lugar de uma data: o Pro sem prazo do super admin, com o texto para quem passa o mouse ou usa leitor de tela. */
const infinito = (significado = SEM_PRAZO) => { const s = el("span", "", INFINITO); s.title = significado; s.setAttribute("role", "img"); s.setAttribute("aria-label", significado); return s; };
const contaCelula = (email, nome) => { const td = el("td"); const box = el("div", "conta"); box.append(el("strong", "", nome ?? email)); if (nome) box.append(el("span", "", email)); td.append(box); return td; };
function pintarAdminTotais(v) {
  const fases = v.contas.map((c) => fase(c.licenca));
  const n = (re) => fases.filter((f) => re.test(f.texto)).length;
  $("ad-totais").replaceChildren(
    cartao("◉", "Contas", document.createTextNode(String(v.totais.contas))),
    cartao("◷", "Em trial", document.createTextNode(String(n(/^Trial ·|^Trial$/)))),
    cartao("◷", "Trial vencido", document.createTextNode(String(n(/^Trial venceu/))), ...(n(/^Trial venceu/) > 0 ? [selo("converter ou liberar", "mau")] : [])),
    cartao("⬢", "Pro ativo", document.createTextNode(String(n(/^Pro ativo|^Pro ·/)))),
    cartao("▭", "Devices pendentes", document.createTextNode(String(v.totais.devicesPendentes)), ...(v.totais.devicesPendentes > 0 ? [selo("liberar", "mau")] : [])),
    cartao("✉", "Pedidos abertos", document.createTextNode(String(v.totais.pedidosAbertos)), ...(v.totais.pedidosAbertos > 0 ? [selo("ver em Suporte", "mau")] : [])),
    ...(v.vendas ? cartoesVendas(v.vendas) : []),
  );
}
/** Os cartões de receita (só o super admin recebe `vendas`): Pro pago, cada add-on pago, receita mensal e a revisar. */
function cartoesVendas(vd) {
  const nomes = [...new Set([...ADDONS.map((a) => a.nome), ...Object.keys(vd.totais.addons)])];
  return [
    cartao("$", "Pro pago", document.createTextNode(String(vd.totais.proPago))),
    ...nomes.map((n) => cartao("$", `${rotuloProduto(n)} pago`, document.createTextNode(String(vd.totais.addons[n] ?? 0)))),
    cartao("↻", "Receita mensal", document.createTextNode(reais(vd.totais.mensalCentavos))),
    cartao("!", "Pagamentos a revisar", document.createTextNode(String(vd.totais.aRevisar)), ...(vd.totais.aRevisar > 0 ? [selo("ver em Suporte", "mau")] : [])),
  ];
}
/** Super admin › Assinaturas: quem paga o quê, com filtro por produto e situação, e os últimos pagamentos. */
/** Lista de espera do site (Windows): os contatos mais novos, para o super admin avisar no lançamento. */
let listaContatos = [];
function pintarListaEspera(le) {
  const tb = $("ad-lista").querySelector("tbody"); tb.replaceChildren();
  listaContatos = le ? le.contatos.map((c) => (c.tipo === "whatsapp" ? `+${c.contato}` : c.contato)) : [];
  $("ad-lista-total").textContent = le ? `${le.total} contato${le.total === 1 ? "" : "s"}${le.semAviso < le.total ? ` · ${le.semAviso} sem aviso` : ""}` : "";
  $("ad-lista-copiar").hidden = listaContatos.length === 0;
  if (!le || le.contatos.length === 0) { const tr = el("tr"); const td = el("td", "", "Ninguém na lista ainda."); td.colSpan = 6; tr.append(td); tb.append(tr); return; }
  for (const c of le.contatos) {
    const tr = el("tr");
    tr.append(el("td", "", dataHora(c.criadoEm)), el("td", "", c.tipo === "whatsapp" ? `+${c.contato}` : c.contato), el("td", "", c.tipo === "whatsapp" ? "WhatsApp" : "e-mail"), el("td", "", c.origem), el("td", "", c.viaAnuncio ? "anúncio" : "-"), el("td", "", c.avisadoEm ? data(c.avisadoEm) : "-"));
    tb.append(tr);
  }
}
/** A célula "Ocultar" de uma linha da tela Assinaturas: some daqui e dos totais, e fica na Auditoria. */
function botaoOcultar(tipo, id) {
  const b = el("button", "btn btn-ghost btn-small", "Ocultar"); b.type = "button"; b.title = "Tira desta tela e dos totais e manda para a Auditoria, de onde volta. A assinatura e a cobrança não mudam.";
  b.addEventListener("click", () => { void vendaOculta(tipo, id, true, b); });
  const td = el("td"); td.append(b); return td;
}
/**
 * A célula "Remover" de uma assinatura: cancela a cobrança na AbacatePay e apaga a assinatura daqui (sai da lista e da
 * receita, sem volta). Dois cliques: o segundo confirma, em até 5 s.
 */
function botaoRemoverAssinatura(a) {
  const b = el("button", "btn btn-ghost btn-small", "Remover"); b.type = "button";
  b.title = "Cancela a cobrança na AbacatePay e apaga a assinatura daqui: sai desta lista e da receita mensal, sem volta. Os pagamentos dela vão para a Auditoria. O acesso já pago não muda.";
  b.addEventListener("click", () => { void removerAssinatura(a, b); });
  const td = el("td"); td.append(b); return td;
}
async function removerAssinatura(a, botao) {
  if (botao.dataset.confirma !== "1") {
    botao.dataset.confirma = "1"; botao.textContent = "Confirmar: cancelar e apagar";
    setTimeout(() => { if (botao.isConnected && !botao.disabled) { delete botao.dataset.confirma; botao.textContent = "Remover"; } }, 5000);
    return;
  }
  const s = sessaoGuardada(); if (s === null) return;
  botao.disabled = true; mostrarErro(null);
  const r = await api("DELETE", `/admin/vendas/assinaturas/${encodeURIComponent(a.id)}`, undefined, s.acesso);
  // 404: já foi removida (outra aba, outro super admin); reler mostra o estado de agora.
  if (r.status !== 200 && r.status !== 404) { botao.disabled = false; delete botao.dataset.confirma; botao.textContent = "Remover"; mostrarErro(erroDe(r)); return; }
  await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
  if (conta !== null) mostrarConsole(conta);
}
function pintarAdminVendas(v) {
  const vd = v.vendas; if (!vd) return;
  $("ad-vendas-totais").replaceChildren(...cartoesVendas(vd));
  const selP = $("ad-vendas-produto"), escolhido = selP.value;
  const produtos = [...new Set(["", "pro", ...ADDONS.map((a) => a.nome), ...vd.assinaturas.map((a) => a.produto ?? "pro")])];
  selP.replaceChildren(...produtos.map((p) => { const o = el("option", "", p === "" ? "Todos os produtos" : rotuloProduto(p === "pro" ? null : p)); o.value = p; o.selected = p === escolhido; return o; }));
  const sit = $("ad-vendas-situacao").value;
  const linhas = vd.assinaturas.filter((a) => (selP.value === "" || (a.produto ?? "pro") === selP.value) && (sit === "" || situacaoDe(a).chave === sit));
  const tb = $("ad-assinaturas").querySelector("tbody"); tb.replaceChildren();
  if (linhas.length === 0) { const tr = el("tr"); const td = el("td", "", vd.assinaturas.length === 0 ? "Nenhuma assinatura paga ainda." : "Nenhuma assinatura com esse filtro."); td.colSpan = 8; tr.append(td); tb.append(tr); }
  for (const a of linhas) {
    const s = situacaoDe(a); const tr = el("tr");
    const tdP = el("td"); tdP.append(selo(rotuloProduto(a.produto), a.produto === null ? "ok" : ""));
    const tdS = el("td"); tdS.append(selo(s.texto, s.tom));
    tr.append(contaCelula(a.conta.email, a.conta.nome), tdP, tdS, el("td", "", `${reais(a.valorCentavos)}/mês`), el("td", "", data(a.criadaEm)), el("td", "", a.ultimoPagamentoEm ? dataHora(a.ultimoPagamentoEm) : "-"), el("td", "", a.valeAte ? data(a.valeAte) : "-"), botaoRemoverAssinatura(a));
    tb.append(tr);
  }
  pintarListaEspera(v.listaEspera);
  const tp = $("ad-pagamentos").querySelector("tbody"); tp.replaceChildren();
  if (vd.pagamentos.length === 0) { const tr = el("tr"); const td = el("td", "", "Nenhum pagamento ainda."); td.colSpan = 7; tr.append(td); tp.append(tr); }
  for (const p of vd.pagamentos) {
    const tr = el("tr");
    tr.append(el("td", "", dataHora(p.pagoEm)), contaCelula(p.conta.email, p.conta.nome), el("td", "", rotuloProduto(p.produto)), el("td", "", reais(p.valorCentavos)), el("td", "", p.primeira ? "primeira" : "renovação"), el("td", "", p.noAnalytics ? "registrada" : "não foi"), botaoOcultar("pagamentos", p.id));
    tp.append(tr);
  }
}
function pintarAdminContas(v) {
  $("ad-busca").value = visaoBusca;
  const tb = $("ad-contas").querySelector("tbody"); tb.replaceChildren();
  if (v.contas.length === 0) { const tr = el("tr"); const td = el("td", "", visaoBusca ? "Nenhuma conta com esse e-mail ou nome." : "Ninguém entrou ainda."); td.colSpan = 9; tr.append(td); tb.append(tr); }
  for (const c of v.contas) {
    const l = c.licenca, ativos = c.devices.filter((d) => d.status !== "pending").length, pend = c.devices.length - ativos;
    const tr = el("tr");
    tr.append(contaCelula(c.email, c.nome));
    const plano = el("td"); plano.append(selo(PLANO[l.plan] ?? l.plan, l.plan === "pro" ? "ok" : "")); if (c.admin) plano.append(document.createTextNode(" "), selo(c.admin === "super" ? "super admin" : "admin")); tr.append(plano);
    const f = fase(l); const tdFase = el("td"); tdFase.append(selo(f.texto, f.tom)); tr.append(tdFase);
    if (semPrazo(l)) { const tdAte = el("td"); tdAte.append(infinito()); tr.append(tdAte); }
    else tr.append(el("td", "", l.expiresAt ? data(l.expiresAt) : l.trialEnd ? data(l.trialEnd) : "-"));
    const dv = el("td", "", semPrazo(l) ? `${ativos}/` : `${ativos}/${l.deviceLimit}`); if (semPrazo(l)) dv.append(infinito(SEM_LIMITE)); if (pend > 0) dv.append(document.createTextNode(" "), selo(`${pend} pendente${pend === 1 ? "" : "s"}`, "mau")); tr.append(dv);
    tr.append(el("td", "", String(c.maquinas)), el("td", "", String(c.pedidos)), el("td", "", data(c.criadaEm)));
    const acao = el("td"); const b = el("button", "btn btn-ghost", "Editar"); b.type = "button"; b.addEventListener("click", () => editorLicenca(tr, c)); acao.append(b); tr.append(acao);
    tb.append(tr);
  }
}
/**
 * Os add-ons da conta `c`, para o editor da conta: os pagos com o prazo (vencido fica marcado) e o Encerrar, as
 * máquinas extras pagas, e os concedidos pelo admin, que valem junto com a licença. Lê a licença em vigor.
 */
function addonsDaConta(c) {
  const l = c.licenca;
  // Add-ons: os pagos com o prazo (vencido fica marcado) e os concedidos pelo admin, que valem junto com a licença.
  // Super admin tem tudo pela regra: o que venceu ou foi encerrado não diz nada sobre o acesso dele e não aparece; o
  // que ainda está pago em dia aparece, porque é cobrança que se pode encerrar.
  const vale = (x) => !semPrazo(l) || Date.parse(x.expiresAt) > Date.now();
  const bloco = el("p", "sub"); bloco.append(el("strong", "", "Add-ons: ")); const pagosC = (c.addonsPagos ?? []).filter(vale);
  for (const a of pagosC) {
    const emDia = Date.parse(a.expiresAt) > Date.now();
    bloco.append(selo(`${rotuloProduto(a.produto)} · ${emDia ? "pago até" : "venceu em"} ${data(a.expiresAt)}`, emDia ? "ok" : "mau"), document.createTextNode(" "));
    if (emDia) { const b = el("button", "btn btn-ghost", "Encerrar"); b.type = "button"; b.title = "Encerra agora o acesso a este add-on pago (reembolso ou disputa). A assinatura na AbacatePay é cancelada à parte."; b.addEventListener("click", () => { void encerrarPago(c, `addons/${encodeURIComponent(a.produto)}`, b); }); bloco.append(b, document.createTextNode(" ")); }
  }
  // Máquinas extras pagas: uma por assinatura, cada uma com o seu prazo e o seu Encerrar.
  const extrasC = (c.extrasPagos ?? []).filter(vale);
  for (const x of extrasC) {
    const emDia = Date.parse(x.expiresAt) > Date.now();
    bloco.append(selo(`${ROTULO_EXTRA[x.tipo] ?? x.tipo} · ${emDia ? "paga até" : "venceu em"} ${data(x.expiresAt)}`, emDia ? "ok" : "mau"), document.createTextNode(" "));
    if (emDia) { const b = el("button", "btn btn-ghost", "Encerrar"); b.type = "button"; b.title = "Encerra agora esta máquina extra paga (reembolso ou disputa): a vaga sai do limite da conta. A assinatura na AbacatePay é cancelada à parte."; b.addEventListener("click", () => { void encerrarPago(c, `extras/${encodeURIComponent(x.assinaturaId)}`, b); }); bloco.append(b, document.createTextNode(" ")); }
  }
  // Super admin: tem todos os add-ons pela regra, não por concessão; um "∞" no lugar da lista.
  if (semPrazo(l)) bloco.append(infinito(TODOS_ADDONS));
  else for (const p of l.produtos) bloco.append(selo(`${rotuloProduto(p)} · concedido`), document.createTextNode(" "));
  if (pagosC.length === 0 && extrasC.length === 0 && l.produtos.length === 0 && !semPrazo(l)) bloco.append(document.createTextNode("nenhum"));
  return bloco;
}
/** O admin manda o e-mail de senha de uma conta; o botão vira "enviado" por um tempo. */
async function adminSenha(c, botao) {
  const s = sessaoGuardada(); if (s === null) return;
  botao.disabled = true;
  const r = await api("POST", `/admin/contas/${encodeURIComponent(c.id)}/senha`, {}, s.acesso);
  if (r.status !== 200) { botao.disabled = false; await falhaAdmin(r, c); return; }
  mostrarErro(null);
  const texto = botao.textContent; botao.textContent = "E-mail enviado";
  setTimeout(() => { botao.textContent = texto; botao.disabled = false; }, 8000);
}
/** Super admin apaga a conta `c` (mesma exclusão do perfil): o primeiro clique pede a confirmação, o segundo apaga. */
async function adminExcluirConta(c, botao) {
  if (botao.dataset.confirma !== "1") {
    botao.dataset.confirma = "1"; botao.textContent = `Confirmar: excluir ${c.email}`;
    setTimeout(() => { if (botao.isConnected && !botao.disabled) { delete botao.dataset.confirma; botao.textContent = "Excluir conta"; } }, 5000);
    return;
  }
  const s = sessaoGuardada(); if (s === null) return;
  botao.disabled = true; mostrarErro(null);
  const r = await api("DELETE", `/admin/contas/${encodeURIComponent(c.id)}`, undefined, s.acesso);
  if (r.status !== 200) { botao.disabled = false; delete botao.dataset.confirma; botao.textContent = "Excluir conta"; await falhaAdmin(r, c); return; }
  ga.evento("conta_apagada_pelo_admin");
  await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
  if (conta !== null) mostrarConsole(conta);
}
/**
 * Linha de edição abaixo da conta (botão "Editar"): plano, status, vale até, limite de devices e de máquinas, salvos
 * com PATCH; e os add-ons da conta, só para ver e encerrar um pago (`addonsDaConta`).
 * Add-ons concedidos e "Como pagar" não se editam aqui (a pessoa assina sozinha pela AbacatePay): o PATCH não os manda,
 * e o que estiver gravado fica como está.
 */
function editorLicenca(tr, c) {
  const existente = tr.nextElementSibling;
  if (existente !== null && existente.classList.contains("editor")) { existente.remove(); return; }
  // De um super admin a lista traz a licença em vigor (Pro sem prazo) e, à parte, a gravada: o formulário mostra e muda a gravada.
  const l = c.licencaGravada ?? c.licenca;
  const linha = el("tr", "editor"); const td = el("td"); td.colSpan = 9;
  const form = el("form", "editor-form");
  const campo = (rotulo, input) => { const lb = el("label"); lb.append(el("span", "", rotulo), input); return lb; };
  const select = (nome, opcoes, atual) => { const s = el("select"); s.name = nome; for (const [v, t] of opcoes) { const o = el("option", "", t); o.value = v; o.selected = v === atual; s.append(o); } return s; };
  const input = (nome, tipo, valor, ph) => { const i = el("input"); i.name = nome; i.type = tipo; i.value = valor ?? ""; if (ph) i.placeholder = ph; return i; };
  const plan = select("plan", [["free", "Free"], ["pro", "Pro"]], l.plan);
  const status = select("status", [["free", "Free"], ["trialing", "Trial"], ["active", "Ativo"], ["expired", "Expirado"]], l.status);
  const ate = input("ate", "date", (l.expiresAt ?? l.trialEnd ?? "").slice(0, 10));
  // Mês grátis dado à mão: põe Trial no Pro com fim daqui a 30 dias; só vale depois do Salvar.
  const mais30 = el("button", "btn btn-ghost btn-small", "+30 dias de teste"); mais30.type = "button"; mais30.title = "Preenche Pro, Trial e a data de hoje mais 30 dias. Só vale depois de Salvar.";
  mais30.addEventListener("click", () => { plan.value = "pro"; status.value = "trialing"; ate.value = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10); });
  const limite = input("deviceLimit", "number", String(l.deviceLimit)); limite.min = "1"; limite.max = "50";
  const maquinas = input("maquinaLimit", "number", String(c.maquinaLimite ?? 1)); maquinas.min = "1"; maquinas.max = "50"; maquinas.title = "Em quantas máquinas (VMs) a pessoa pode usar a licença da conta ao mesmo tempo";
  form.append(campo("Plano", plan), campo("Status", status), campo("Vale até", ate), mais30, campo("Devices", limite), campo("Máquinas", maquinas));
  // Senha: o super admin define na hora (em branco não muda); qualquer admin manda o e-mail de redefinição.
  const superAdmin = conta !== null && conta.admin === "super";
  const senha = input("senha", "password", "", superAdmin ? "nova senha (em branco: não muda)" : "só o super admin define"); senha.autocomplete = "new-password"; senha.minLength = 8; senha.maxLength = 128; senha.disabled = !superAdmin;
  form.append(campo("Senha", senha));
  // Ao lado da senha, só para o super admin: o mesmo "Apagar conta" do perfil, na conta de qualquer pessoa.
  if (superAdmin) {
    const excluir = el("button", "btn btn-ghost btn-small btn-perigo", "Excluir conta"); excluir.type = "button";
    if (c.admin !== null && c.admin !== undefined) { excluir.disabled = true; excluir.title = "Esta conta tem perfil de acesso: remova o perfil (Perfis de acesso) antes de excluir."; }
    else { excluir.title = `Apaga a conta de ${c.email}: ela some daqui e a pessoa sai de todos os Macs. Licença, pagamentos, pedidos e auditoria ficam guardados.`; excluir.addEventListener("click", () => { void adminExcluirConta(c, excluir); }); }
    form.append(excluir);
  }
  const salvar = el("button", "btn btn-primary", "Salvar"); salvar.type = "submit";
  const emailSenha = el("button", "btn btn-ghost", "E-mail de senha"); emailSenha.type = "button"; emailSenha.title = `Manda a ${c.email} o e-mail para criar ou redefinir a senha (o mesmo de "Esqueci a senha").`; emailSenha.addEventListener("click", () => { void adminSenha(c, emailSenha); });
  const cancelar = el("button", "btn btn-ghost", "Cancelar"); cancelar.type = "button"; cancelar.addEventListener("click", () => linha.remove());
  const acoes = el("div", "acoes"); acoes.append(salvar, emailSenha, cancelar); form.append(acoes);
  // Os add-ons da conta (pagos, com o Encerrar; extras; concedidos) ficam aqui, não mais numa coluna da lista.
  form.append(addonsDaConta(c));
  const aviso = el("p", "sub", `Vale na conta e em Este Mac; numa máquina por SSH, a pessoa aplica pelo app ("Usar o meu Pro nesta máquina"), ou o admin grava a licença da máquina (meu-bot-admin › Suporte). Senha preenchida: troca no Firebase e desconecta a pessoa de todos os Macs.`);
  form.append(aviso);
  if (c.admin === "super") form.prepend(el("p", "sub", "Super admin: Pro sem prazo. O que está gravado aqui só volta a valer se a pessoa deixar de ser super admin."));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault(); salvar.disabled = true;
    const ateIso = ate.value ? `${ate.value}T23:59:59.000Z` : null;
    const patch = { plan: plan.value, status: status.value, deviceLimit: Number(limite.value), maquinaLimit: Number(maquinas.value) };
    if (status.value === "trialing") { patch.trialEnd = ateIso; patch.expiresAt = ateIso; } else { patch.expiresAt = ateIso; patch.trialEnd = null; }
    const s = sessaoGuardada(); if (s === null) return;
    const r = await api("PATCH", `/admin/contas/${encodeURIComponent(c.id)}/licenca`, patch, s.acesso);
    if (r.status !== 200) { salvar.disabled = false; await falhaAdmin(r, c); return; }
    if (senha.value !== "") {
      // Troca a senha no Firebase e desconecta a pessoa de todos os Macs; ela passa a entrar com e-mail e senha.
      const rs = await api("PUT", `/admin/contas/${encodeURIComponent(c.id)}/senha`, { senha: senha.value }, s.acesso);
      if (rs.status !== 200) { salvar.disabled = false; if (pedeReleitura(rs.status)) await falhaAdmin(rs, c); else mostrarErro(`Licença salva, mas a senha não: ${erroDe(rs)}`); return; }
    }
    mostrarErro(null);
    ga.evento("plano_alterado", { plan: plan.value, status: status.value });
    await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
    if (conta !== null) mostrarConsole(conta);
  });
  td.append(form); linha.append(td); tr.after(linha);
}
function pintarAdminDevices(v) {
  const tb = $("ad-devices-tabela").querySelector("tbody"); tb.replaceChildren();
  const linhas = v.contas.flatMap((c) => c.devices.map((d) => ({ c, d })));
  if (linhas.length === 0) { const tr = el("tr"); const td = el("td", "", "Nenhum device em conta nenhuma."); td.colSpan = 8; tr.append(td); tb.append(tr); }
  for (const { c, d } of linhas) {
    const tr = el("tr");
    // Uso da conta ao lado de cada Mac: ativos/limite, com aviso quando um Mac novo já cairia em Pendente.
    const ativos = c.devices.filter((x) => x.status !== "pending").length, limite = c.licenca.deviceLimit;
    const semLimite = semPrazo(c.licenca);
    const uso = el("td", "", semLimite ? `${ativos}/` : `${ativos}/${limite}`); if (semLimite) uso.append(infinito(SEM_LIMITE)); else if (ativos >= limite) uso.append(document.createTextNode(" "), selo("no limite", "mau"));
    tr.append(contaCelula(c.email, c.nome), uso, el("td", "", `${d.name || d.id.slice(0, 8)}${d.platform ? ` · ${d.platform}` : ""}`), el("td", "", d.user || "-"), el("td", "", Object.entries(d.apps ?? {}).map(([a, x]) => `${a} ${x.version}`).join(", ") || "-"));
    const st = el("td"); st.append(selo(d.status === "pending" ? "Pendente" : "Ativo", d.status === "pending" ? "mau" : "ok")); tr.append(st);
    tr.append(el("td", "", dataHora(d.lastSeen)));
    const acoes = el("td");
    if (d.status === "pending") { const b = el("button", "btn btn-primary", "Liberar"); b.type = "button"; b.addEventListener("click", () => { void liberarDevice(c, d, b); }); acoes.append(b, document.createTextNode(" ")); }
    const r = el("button", "btn btn-ghost", "Remover"); r.type = "button"; r.addEventListener("click", () => { void removerDevice(c, d, r); }); acoes.append(r);
    tr.append(acoes);
    tb.append(tr);
  }
}
/** "Encerrar" um add-on pago: dois cliques (o segundo confirma, em até 5 s), porque a pessoa perde o acesso na hora. */
/** Encerrar um add-on pago (`addons/<produto>`) ou uma máquina extra paga (`extras/<assinatura>`), com confirmação em dois toques. */
async function encerrarPago(c, caminho, botao) {
  if (botao.dataset.confirma !== "1") {
    botao.dataset.confirma = "1"; botao.textContent = "Confirmar encerramento";
    setTimeout(() => { if (botao.isConnected && !botao.disabled) { delete botao.dataset.confirma; botao.textContent = "Encerrar"; } }, 5000);
    return;
  }
  const s = sessaoGuardada(); if (s === null) return;
  botao.disabled = true; mostrarErro(null);
  const r = await api("POST", `/admin/contas/${encodeURIComponent(c.id)}/${caminho}/encerrar`, {}, s.acesso);
  if (r.status !== 200) { botao.disabled = false; delete botao.dataset.confirma; botao.textContent = "Encerrar"; await falhaAdmin(r, c); return; }
  await depoisDeDevice();
}
/** Relê a visão do admin e redesenha a seção depois de uma ação em devices. */
async function depoisDeDevice() {
  await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
  if (conta !== null) mostrarConsole(conta);
}
/** "Liberar": ativa o Mac pendente. Conta no limite: o botão passa a oferecer subir o limite, e o segundo clique confirma. */
async function liberarDevice(c, d, botao) {
  const s = sessaoGuardada(); if (s === null) return;
  const subir = botao.dataset.subir === "1";
  botao.disabled = true; mostrarErro(null);
  const r = await api("POST", `/admin/contas/${encodeURIComponent(c.id)}/devices/${encodeURIComponent(d.id)}/liberar`, subir ? { subirLimite: true } : {}, s.acesso);
  if (r.status === 409 && r.corpo && r.corpo.noLimite === true && !subir) {
    const ativos = c.devices.filter((x) => x.status !== "pending").length;
    botao.disabled = false; botao.dataset.subir = "1"; botao.textContent = `Liberar e subir o limite para ${ativos + 1}`; botao.title = erroDe(r);
    mostrarErro(erroDe(r));
    return;
  }
  if (r.status !== 200) { botao.disabled = false; await falhaAdmin(r, c); return; }
  await depoisDeDevice();
}
/** "Remover": dois cliques (o segundo confirma, em até 5 s), porque o Mac perde o acesso e precisa entrar de novo. */
async function removerDevice(c, d, botao) {
  if (botao.dataset.confirma !== "1") {
    botao.dataset.confirma = "1"; botao.textContent = "Confirmar remoção";
    setTimeout(() => { if (botao.isConnected && !botao.disabled) { delete botao.dataset.confirma; botao.textContent = "Remover"; } }, 5000);
    return;
  }
  const s = sessaoGuardada(); if (s === null) return;
  botao.disabled = true; mostrarErro(null);
  const r = await api("DELETE", `/admin/contas/${encodeURIComponent(c.id)}/devices/${encodeURIComponent(d.id)}`, undefined, s.acesso);
  if (r.status !== 200) { botao.disabled = false; delete botao.dataset.confirma; botao.textContent = "Remover"; await falhaAdmin(r, c); return; }
  await depoisDeDevice();
}
const TIPO_PEDIDO = { "pagamento.liberar": "Liberar na máquina", "pagamento.revisar": "Revisar pagamento", "plano.pedir": "Pro", "addon.pedir": "Add-on", "device.pedir": "Device", "importar": "Importar licença" };
function pintarAdminPedidos(v) {
  const tb = $("ad-pedidos").querySelector("tbody"); tb.replaceChildren();
  if (v.pedidos.length === 0) { const tr = el("tr"); const td = el("td", "", "Nenhum pedido aberto."); td.colSpan = 5; tr.append(td); tb.append(tr); }
  for (const p of v.pedidos) {
    const tr = el("tr");
    tr.append(el("td", "", dataHora(p.criadoEm)), contaCelula(p.conta.email, p.conta.nome), el("td", "", TIPO_PEDIDO[p.tipo] ?? p.tipo), el("td", "", p.detalhe ?? "-"));
    const td = el("td"); const b = el("button", "btn btn-ghost", "Atender"); b.type = "button"; b.addEventListener("click", () => { void atender(p.id, b); }); td.append(b); tr.append(td);
    tb.append(tr);
  }
}
function pintarQuem(c) {
  $("quem-nome").textContent = c.nome ?? c.email; $("quem-email").textContent = c.nome ? c.email : (c.admin ? `admin (${c.admin})` : "");
  const foto = typeof c.foto === "string" && /^https:\/\//.test(c.foto);
  $("quem-foto").hidden = !foto; $("quem-inicial").hidden = foto; if (foto) $("quem-foto").src = c.foto; $("quem-inicial").textContent = inicial(c);
}
function cartao(ico, rotulo, ...valor) {
  const box = el("div", "cartao-info"); box.append(el("span", "ico", ico));
  const t = el("div"); t.append(el("div", "rotulo", rotulo)); const v = el("div", "valor"); v.append(...valor); t.append(v); box.append(t);
  return box;
}
const statusTom = (l) => (l.status === "active" || l.status === "trialing" ? "ok" : l.status === "expired" ? "mau" : "");
function pintarOverview(c) {
  pintarAssinar(c);
  // Quem já tem o Pro vê no topo o que ainda pode somar (plano-core.js, addonsNaVisaoGeral), com o caminho do Marketplace.
  const faltam = cfg.pagamentos === "1" ? addonsNaVisaoGeral(!$("pl-assinar").hidden, c.licenca.produtos, ADDONS) : [];
  $("ov-addons").replaceChildren();
  if (faltam.length > 0) {
    const painel = el("div", "painel"), a = el("a", "btn btn-primary", "Ver o Marketplace"); a.href = "/account/marketplace";
    const p = el("p"); p.append(a);
    painel.append(el("h2", "", "Some mais à sua conta"), el("p", "", `Disponível para você: ${faltam.map((x) => FICHAS[x.nome]?.nome ?? x.rotulo).join(", ")}.`), p);
    $("ov-addons").append(painel);
  }
  const l = c.licenca, ativos = c.devices.filter((d) => d.status !== "pending").length, pendentes = c.devices.length - ativos;
  $("ov-cartoes").replaceChildren(
    cartao("⬢", "Plano", selo(PLANO[l.plan] ?? l.plan, l.plan === "pro" ? "ok" : "")),
    cartao("✓", "Status", document.createTextNode(STATUS[l.status] ?? l.status), selo(l.status === "expired" ? "venceu" : "OK", statusTom(l) || "")),
    cartao("▦", "Membro desde", document.createTextNode(data(l.memberSince))),
    // A Visão geral não mostra prazo para as outras contas (ele está em Plano); para o super admin, o "∞" aparece já aqui.
    ...(semPrazo(l) ? [cartao("▦", "Vale até", infinito())] : []),
    cartao("↻", "Ciclo de cobrança", document.createTextNode(l.interval ? CICLO[l.interval] : "-")),
    cartao("▭", "Devices", ...(semPrazo(l) ? [document.createTextNode(`${ativos} de `), infinito(SEM_LIMITE)] : [document.createTextNode(`${ativos} de ${l.deviceLimit}`)]), ...(pendentes > 0 ? [selo(`${pendentes} pendente${pendentes === 1 ? "" : "s"}`, "mau")] : [])),
    cartao("⌂", "Máquinas", document.createTextNode(String(linhasDeMaquinas(c.maquinas, c.maquinasVistas).linhas.filter((l) => l.selo.startsWith("Em uso")).length))),
    ...(semPrazo(l) ? [cartao("+", "Add-ons", infinito(TODOS_ADDONS))] : l.produtos.length > 0 ? [cartao("+", "Add-ons", ...l.produtos.map((p) => selo(rotuloProduto(p))))] : []),
    ...(c.pedidos > 0 ? [cartao("✉", "Pedidos abertos", document.createTextNode(String(c.pedidos)))] : []),
  );
}
const CAMPOS_PERFIL = ["nomeProprio", "sobrenome"];
/** Perfil (molde Rambox): cabeçalho, formulário editável, login e segurança, dados de uso, apagar conta. */
function pintarPerfil(c) {
  $("pf-nome").textContent = c.nome ?? "(sem nome)"; $("pf-email").textContent = c.admin ? `${c.email} · admin (${c.admin})` : c.email;
  const foto = typeof c.foto === "string" && /^https:\/\//.test(c.foto);
  $("pf-foto").hidden = !foto; $("pf-inicial").hidden = foto; if (foto) $("pf-foto").src = c.foto; $("pf-inicial").textContent = inicial(c);
  const form = $("pf-form"), perfil = c.perfil ?? {};
  for (const k of CAMPOS_PERFIL) form.elements[k].value = perfil[k] ?? "";
  $("pf-email-campo").value = c.email;
  $("pf-salvo").hidden = true; $("pf-salvar").disabled = false;
  const digitado = (perfil.nomeProprio ?? "") !== "" || (perfil.sobrenome ?? "") !== "";
  $("pf-login").textContent = c.nomeLogin && digitado && c.nomeLogin !== c.nome ? `No login (Google ou e-mail) você aparece como "${c.nomeLogin}"; aqui e no app vale o nome que você digitou. A foto vem do Google.` : "Nome e foto vêm do login até você digitar o seu aqui; o que você digitar vale no app e para o admin.";
  // Login e segurança
  const provs = Array.isArray(c.provedores) ? c.provedores : [];
  const dl = $("pf-seguranca"); dl.replaceChildren();
  const linha = (rotulo, ...conteudo) => { dl.append(el("dt", "", rotulo)); const dd = el("dd"); dd.append(...conteudo); dl.append(dd); };
  linha("Google", provs.includes("google.com") ? selo("conectado", "ok") : selo("não conectado"), el("span", "sub", provs.includes("google.com") ? "" : `Entre com o Google (${c.email}) na próxima vez para conectar.`));
  linha("Link por e-mail", provs.includes("emailLink") ? selo("já usado", "ok") : selo("disponível"), el("span", "sub", `Um link de entrada vai para ${c.email} sempre que você pedir na página de login.`));
  const temSenha = provs.includes("password");
  const bSenha = el("button", "btn btn-ghost", temSenha ? "Redefinir senha" : "Criar senha"); bSenha.type = "button"; bSenha.id = "pf-senha";
  bSenha.addEventListener("click", () => { void senhaPedir(bSenha, c.email); });
  linha("Senha", temSenha ? selo("configurada", "ok") : selo("não configurada"), bSenha, el("span", "sub", temSenha ? "Na página de login, use e-mail e senha." : "Mandamos um e-mail com o link para criar a senha; depois entre com e-mail e senha na página de login."));
  // Dados de uso
  const cb = $("pf-dados-uso"); cb.checked = c.dadosUso !== false; cb.disabled = false;
  // Apagar
  const ap = $("pf-apagar"); ap.disabled = c.admin !== null; ap.dataset.confirma = ""; ap.textContent = "Apagar minha conta";
  ap.title = c.admin !== null ? "Um admin não apaga a própria conta: peça ao super admin para remover seu perfil de acesso antes." : "";
}
/** Salva o formulário do perfil (PATCH /conta devolve a conta inteira). */
async function perfilSalvar() {
  const s = sessaoGuardada(); if (s === null) return;
  const form = $("pf-form"), patch = {};
  for (const k of CAMPOS_PERFIL) patch[k] = form.elements[k].value.trim() === "" ? null : form.elements[k].value;
  $("pf-salvar").disabled = true; $("pf-salvo").hidden = true;
  const r = await api("PATCH", "/conta", patch, s.acesso);
  if (r.status !== 200) { $("pf-salvar").disabled = false; mostrarErro(erroDe(r)); return; }
  mostrarErro(null);
  ga.evento("perfil_salvo");
  mostrarConsole(r.corpo);
  $("pf-editar").open = true; $("pf-salvo").hidden = false;
}
async function dadosUsoMudar(cb) {
  const s = sessaoGuardada(); if (s === null) return;
  const querido = cb.checked; cb.disabled = true;
  const r = await api("PATCH", "/conta", { dadosUso: querido }, s.acesso);
  if (r.status !== 200) { cb.checked = !querido; cb.disabled = false; mostrarErro(erroDe(r)); return; }
  mostrarErro(null);
  ga.evento("dados_uso_alterado", { ligado: querido });
  mostrarConsole(r.corpo);
}
async function senhaPedir(botao, email) {
  const s = sessaoGuardada(); if (s === null) return;
  botao.disabled = true;
  const r = await api("POST", "/conta/senha", {}, s.acesso);
  if (r.status !== 200) { botao.disabled = false; mostrarErro(erroDe(r)); return; }
  mostrarErro(null);
  ga.evento("senha_pedida");
  botao.replaceWith(el("span", "sub", `E-mail enviado para ${email}. Abra o link para definir a senha; depois entre com e-mail e senha na página de login, e ela aparece aqui como configurada.`));
}
async function contaApagar(botao) {
  const s = sessaoGuardada(); if (s === null) return;
  if (botao.dataset.confirma !== "1") { botao.dataset.confirma = "1"; botao.textContent = "Confirmar: apagar a conta agora"; return; }
  botao.disabled = true;
  const r = await api("DELETE", "/conta", undefined, s.acesso);
  if (r.status !== 200) { botao.disabled = false; botao.dataset.confirma = ""; botao.textContent = "Apagar minha conta"; mostrarErro(erroDe(r)); return; }
  ga.evento("conta_apagada");
  ss.set(CH_SESSAO, null); conta = null; visao = null;
  history.replaceState(null, "", "/account/overview");
  mostrarEntrada("Conta apagada. Entrar de novo cria uma conta nova.");
}
function pintarDevices(c) {
  const l = c.licenca, ativos = c.devices.filter((d) => d.status !== "pending").length;
  const vagasDv = vagasDeDevice(l.deviceLimit, c.deviceExtras), pendentes = c.devices.length - ativos;
  $("dv-resumo").textContent = `${c.devices.length} device${c.devices.length === 1 ? "" : "s"} · ${ativos} ativo${ativos === 1 ? "" : "s"}${semPrazo(l) ? `, sem limite (${INFINITO})` : ` de ${l.deviceLimit} do plano${vagasDv.detalhe === "" ? "" : ` (${vagasDv.detalhe})`}`}.`;
  // Mac esperando vaga e o device extra à venda: o caminho para liberá-lo fica ao lado da conta.
  if (pendentes > 0 && EXTRA_DEVICE !== null && cfg.pagamentos === "1" && podeAdicionarMaquina(l)) { const a = el("a", "", `Adicionar um Mac por ${reais(EXTRA_DEVICE.centavos)}/mês`); a.href = "/account/marketplace"; $("dv-resumo").append(document.createTextNode(` ${pendentes === 1 ? "O Mac pendente entra" : "Os Macs pendentes entram"} quando houver vaga. `), a); }
  const tb = $("dv-tabela").querySelector("tbody"); tb.replaceChildren();
  if (c.devices.length === 0) { const tr = el("tr"); const td = el("td", "", "Nenhum device ainda: entre com a conta no app meu-bot de um Mac."); td.colSpan = 5; tr.append(td); tb.append(tr); }
  for (const d of c.devices) {
    const tr = el("tr");
    const apps = Object.entries(d.apps ?? {}).map(([a, v]) => `${a} ${v.version}`).join(", ") || "-";
    tr.append(el("td", "", `${d.name || d.id.slice(0, 8)}${d.platform ? ` · ${d.platform}` : ""}`), el("td", "", d.user || "-"), el("td", "", apps));
    const st = el("td"); st.append(selo(d.status === "pending" ? "Pendente" : "Ativo", d.status === "pending" ? "mau" : "ok")); tr.append(st);
    tr.append(el("td", "", dataHora(d.lastSeen)));
    tb.append(tr);
  }
  pintarMaquinas(c);
}
/** A máquina ainda ocupa uma vaga: vinculada, ou tirada por aqui com a última licença ainda valendo lá. */
const ocupaVaga = (m) => !m.desvinculadaEm || (m.proAte && Date.parse(m.proAte) > Date.now());
/** As máquinas (VMs) que usam a licença da conta, com até quando ela vale lá e o botão de tirar. */
function pintarMaquinas(c) {
  const tb = $("dv-maquinas-tabela").querySelector("tbody"); tb.replaceChildren();
  const maquinas = c.maquinas ?? [], limite = c.maquinaLimite ?? 1;
  const { linhas, ocupadas, semVaga } = linhasDeMaquinas(maquinas, c.maquinasVistas);
  const vagas = vagasDeMaquina(limite, c.maquinaExtras);
  $("dv-maquinas").textContent = semPrazo(c.licenca) ? `${ocupadas} máquina${ocupadas === 1 ? "" : "s"} em uso, sem limite (${INFINITO}).` : `${ocupadas} de ${limite} máquina${limite === 1 ? "" : "s"} em uso${vagas.detalhe === "" ? "" : ` (${vagas.detalhe})`}.`;
  if (semVaga > 0 && !semPrazo(c.licenca)) $("dv-maquinas").append(document.createTextNode(" Máquina com licença do admin não ocupa vaga."));
  // No limite e com a máquina extra à venda: o caminho para ter mais uma fica ao lado da conta.
  if (ocupadas >= limite && EXTRA_MAQUINA !== null && cfg.pagamentos === "1" && podeAdicionarMaquina(c.licenca)) { const a = el("a", "", `Adicionar uma máquina por ${reais(EXTRA_MAQUINA.centavos)}/mês`); a.href = "/account/marketplace"; $("dv-maquinas").append(document.createTextNode(" "), a); }
  if (linhas.length === 0) { const tr = el("tr"); const td = el("td", "", "Nenhuma máquina em uso ainda. Abra a janela de uma máquina no app, com a conta logada, e ela aparece aqui."); td.colSpan = 4; tr.append(td); tb.append(tr); return; }
  for (const l of linhas) {
    const tr = el("tr");
    const st = el("td"); st.append(selo(l.selo, l.tom));
    const acao = el("td");
    if (l.acao === "tirar-licenca") { const m = maquinas.find((x) => x.id === l.id); const b = el("button", "btn btn-ghost", "Tirar a licença"); b.type = "button"; b.addEventListener("click", () => { void tirarMaquina(m, b); }); acao.append(b); }
    else if (l.acao === "tirar-da-lista") { const b = el("button", "btn btn-ghost", "Tirar da lista"); b.type = "button"; b.title = "Só tira daqui; a máquina e a licença dela não mudam. Ela volta se você a abrir de novo pelo app."; b.addEventListener("click", () => { void esquecerMaquina(l.id, b); }); acao.append(b); }
    tr.append(el("td", "", l.nome), st, el("td", "", l.valeAte ? data(l.valeAte) : "-"), acao);
    tb.append(tr);
  }
}
/** "Tirar da lista" uma máquina que só aparece porque o app a viu (licença do admin): não mexe na máquina nem em vaga. */
async function esquecerMaquina(id, botao) {
  const s = sessaoGuardada(); if (s === null) { void entrar(); return; }
  botao.disabled = true;
  const r = await api("DELETE", `/conta/maquinas/${encodeURIComponent(id)}/visto`, undefined, s.acesso);
  if (r.status !== 200 && r.status !== 404) { botao.disabled = false; $("dv-maquinas").textContent = erroDe(r); return; }
  const c2 = await lerConta().catch(() => null);
  if (c2) pintarDevices(c2);
}
/**
 * "Tirar a licença" de uma máquina: dois cliques (o segundo confirma, em até 5 s). Daqui ninguém apaga o arquivo da
 * máquina, então ela segue com o plano até a data de "Vale até" e a vaga só abre nesse dia. Pelo app, na janela da
 * máquina (Configurações › Sua conta), a vaga abre na hora.
 */
async function tirarMaquina(m, botao) {
  if (botao.dataset.confirma !== "1") {
    botao.dataset.confirma = "1"; botao.textContent = "Confirmar";
    $("dv-maquinas").textContent = `Por aqui, ${m.apelido ?? "a máquina"} segue com o plano até ${m.proAte ? data(m.proAte) : "a licença vencer"} e a vaga só abre nesse dia. Para abrir a vaga na hora, tire pelo app, na janela da máquina (Configurações › Sua conta).`;
    setTimeout(() => { if (botao.isConnected && !botao.disabled) { delete botao.dataset.confirma; botao.textContent = "Tirar a licença"; } }, 5000);
    return;
  }
  const s = sessaoGuardada(); if (s === null) { void entrar(); return; }
  botao.disabled = true;
  const r = await api("DELETE", `/conta/maquinas/${encodeURIComponent(m.id)}`, {}, s.acesso);
  if (r.status !== 200) { botao.disabled = false; delete botao.dataset.confirma; botao.textContent = "Tirar a licença"; $("dv-maquinas").textContent = erroDe(r); return; }
  ga.evento("maquina_tirada", {});
  const c2 = await lerConta().catch(() => null);
  if (c2) pintarDevices(c2);
}
let esperasPagamento = 0;
/** A promoção do primeiro mês que o painel "Assinar o Pro" está mostrando agora (null = preço normal, ou super admin). */
let promoMostrada = null;
const ASSINAR_NORMAL = $("pl-assinar-btn").textContent;
/** Copia o cupom da promoção; false se o navegador não deixou (a pessoa ainda pode selecionar o código na tela). */
async function copiarCupom(cupom) { try { await navigator.clipboard.writeText(cupom); return true; } catch { return false; } }
/**
 * O aviso da promoção acima do "Assinar": preço, prazo e o cupom. A página da AbacatePay NÃO aplica o cupom sozinha
 * (conferido no Modo Teste em 18 nov 2026): mostra o campo "Código do cupom" e a pessoa cola e toca em Aplicar. Por
 * isso o aviso diz onde colar e tem o "Copiar cupom"; o "Assinar" tenta copiar o código também (nem todo navegador
 * deixa, então a tela não promete isso); quem prefere o Pix tem o caminho do preço normal.
 */
function pintarPromo(c) {
  promoMostrada = semPrazo(c.licenca) ? null : promoNaTela(c.promo);
  const caixa = $("pl-promo"); caixa.hidden = promoMostrada === null; caixa.replaceChildren();
  $("pl-assinar-btn").textContent = promoMostrada === null ? ASSINAR_NORMAL : `Assinar por ${reaisCurto(promoMostrada.precoCentavos)} no primeiro mês`;
  if (promoMostrada === null) return;
  const { precoCentavos, ate, cupom } = promoMostrada;
  // "R$ 97" é o preço do Pro que este painel já escreve no index.html.
  const regra = el("p"); regra.append(el("strong", "", `Seu teste acabou: o primeiro mês do Pro sai por ${reaisCurto(precoCentavos)}.`), document.createTextNode(` Depois, R$ 97 por mês. Só no cartão. Vale até ${dataHora(ate)}.`));
  const passo = el("p"); passo.append(document.createTextNode("Na página de pagamento, cole o cupom "), el("code", "", cupom), document.createTextNode(` em "Código do cupom" e toque em Aplicar: o total cai para ${reaisCurto(precoCentavos)}. `));
  const copiar = el("button", "btn btn-ghost btn-small", "Copiar cupom"); copiar.type = "button";
  copiar.addEventListener("click", () => { void copiarCupom(cupom).then((ok) => { copiar.textContent = ok ? "✓ Cupom copiado" : "Selecione o código e copie"; }); });
  passo.append(copiar);
  // Quem só paga por Pix: o cupom não vale, mas o caminho do preço normal continua aberto.
  const pix = el("button", "promo-link", "Prefiro pagar com Pix: R$ 97 por mês, sem o desconto"); pix.type = "button";
  pix.addEventListener("click", () => { void assinar(null, $("pl-assinar-btn"), $("pl-assinar-aviso"), true); });
  const rodape = el("p", "sub"); rodape.append(pix);
  // As regras ficam numa página do site que só este link abre (noindex, fora do menu).
  if (typeof cfg.site === "string" && cfg.site !== "") { const a = el("a", "", "Ver as regras"); a.href = `${cfg.site}/promocao`; a.target = "_blank"; a.rel = "noopener"; rodape.append(document.createTextNode(" · "), a); }
  caixa.append(regra, passo, rodape);
}
/**
 * "Assinar": pede o checkout à API (com o client_id/session_id do GA4, para a compra ir à mesma visita) e vai para a
 * página da AbacatePay. Com a promoção na tela, copia o cupom antes (ainda dentro do clique, senão o navegador recusa);
 * `semPromo` é o "Prefiro pagar com Pix".
 */
async function assinar(produto = null, btn = $("pl-assinar-btn"), aviso = $("pl-assinar-aviso"), semPromo = false) {
  const s = sessaoGuardada();
  if (s === null) { void entrar(); return; }
  const pedido = pedidoAssinar(produto, promoMostrada, semPromo);
  // Desabilita ANTES de copiar: a cópia pode demorar (o navegador pede permissão) e um segundo clique abriria outro checkout.
  btn.disabled = true;
  const copiou = pedido.promo === true ? await copiarCupom(promoMostrada.cupom) : false;
  aviso.textContent = copiou ? "Cupom copiado. Abrindo a página de pagamento…" : "Abrindo a página de pagamento…";
  const v = typeof ga.visita === "function" ? await ga.visita() : { clientId: null, sessionId: null };
  const r = await api("POST", "/conta/assinatura", { gaClientId: v.clientId, gaSessionId: v.sessionId, ...pedido }, s.acesso);
  // Unidade extra: guarda quantas a conta já tinha, para a volta do pagamento saber quando a nova chegou (pagoChegou).
  if (r.status === 200 && produto !== null && conta !== null) { try { sessionStorage.setItem(`mb-antes-${produto}`, String(assinaturasAtivasDe(conta.assinaturas, produto))); } catch { /* sem sessionStorage: a tela espera o tempo todo */ } }
  if (r.status === 200 && r.corpo && typeof r.corpo.url === "string") { ga.evento("checkout_iniciado", { plano: produto ?? "chip-coflow", ...(r.corpo.promo === true ? { promo: "primeiro-mes" } : {}) }); location.assign(r.corpo.url); return; }
  btn.disabled = false;
  // O prazo acabou com a tela aberta: repinta o painel com o preço normal e mantém o aviso da API.
  if (pedido.promo === true && r.corpo && r.corpo.promoAcabou === true) { const c2 = await lerConta().catch(() => null); if (c2) pintarPlano(c2); }
  aviso.textContent = erroDe(r);
}
/**
 * Um painel "Assinar" por app à venda que a conta ainda não tem. O que ela já tem ganha o painel dos dois passos
 * (pago na conta; liberado ou não na máquina) na volta do pagamento e enquanto o pedido de liberação está aberto
 * (`avisoAddonPago`, plano-core.js).
 */
function pintarAddons(l, voltouDe, liberacoes, caixaId = "pl-addons", lista = ADDONS) {
  const caixa = $(caixaId); caixa.replaceChildren();
  if (cfg.pagamentos !== "1") return;
  for (const a of lista) {
    const tem = l.produtos.includes(a.nome);
    const pago = tem ? avisoAddonPago(a.rotulo, a.nome, liberacoes, voltouDe === a.nome) : null;
    if (tem && pago === null) continue;
    const painel = el("div", "painel"); const aviso = el("p", "sub"); aviso.setAttribute("role", "status");
    painel.append(el("h2", "", tem ? a.rotulo : `Assinar o ${a.rotulo}`));
    if (pago !== null) { aviso.textContent = pago.texto; painel.append(aviso); caixa.append(painel); continue; }
    // O que o app é, pela ficha do Marketplace (a mesma da página pública).
    if (FICHAS[a.nome]?.resumo) painel.append(el("p", "", FICHAS[a.nome].resumo));
    painel.append(el("p", "", `${reais(a.centavos)} por mês, à parte do Pro. O pagamento é feito na página segura da AbacatePay, e o ${a.rotulo} entra nesta conta assim que o pagamento é confirmado; para ele aparecer no app, o suporte ainda o libera na sua máquina. Você cancela quando quiser e o acesso continua até o fim do mês pago.`));
    if (voltouDe === a.nome) aviso.textContent = `Recebemos você de volta. Assim que a AbacatePay confirmar o pagamento, o ${a.rotulo} aparece aqui (costuma levar alguns segundos).`;
    const p = el("p"); const b = el("button", "btn btn-primary", `Assinar por ${reais(a.centavos)}/mês`); b.type = "button"; b.addEventListener("click", () => { void assinar(a.nome, b, aviso); }); p.append(b);
    painel.append(aviso, p); caixa.append(painel);
  }
}
/**
 * Os painéis das unidades extras, no Marketplace: quanto o plano cobre agora e o botão para adicionar mais uma unidade
 * (os extras de ABACATEPAY_EXTRAS). Cada assinatura soma uma unidade; quem não tem o Pro valendo não vê os painéis,
 * porque as duas valem junto com o Pro. Cada painel só aparece se o seu extra está à venda no ambiente.
 */
function pintarExtras(c, voltouDe, so = null) {
  const caixa = $("pl-extras"); caixa.replaceChildren();
  // As duas unidades valem junto com o Pro (mesma regra: podeAdicionarMaquina).
  if (cfg.pagamentos !== "1" || !podeAdicionarMaquina(c.licenca)) return;
  const painelDe = (x, titulo, texto, botao) => {
    const painel = el("div", "painel"); const aviso = el("p", "sub"); aviso.setAttribute("role", "status");
    painel.append(el("h2", "", titulo));
    // Preço de tabela riscado, quando o catálogo traz um (plano-core.js, deParaDoExtra).
    const dp = deParaDoExtra(x);
    if (dp !== null) { const o = el("p", "oferta"); o.append("De ", el("s", "", dp.de), " por ", el("strong", "", dp.por), " por mês"); painel.append(o); }
    painel.append(el("p", "", texto));
    if (voltouDe === x.nome) aviso.textContent = "Recebemos você de volta. Assim que a AbacatePay confirmar o pagamento, a vaga nova aparece aqui (costuma levar alguns segundos).";
    const p = el("p"); const b = el("button", "btn btn-primary", botao); b.type = "button"; b.addEventListener("click", () => { void assinar(x.nome, b, aviso); }); p.append(b);
    painel.append(aviso, p); caixa.append(painel);
  };
  const pagamento = "O pagamento é feito na página segura da AbacatePay, a vaga abre assim que ele é confirmado, e você cancela quando quiser.";
  if (EXTRA_MAQUINA !== null && (so === null || so === EXTRA_MAQUINA.nome)) {
    const vagas = vagasDeMaquina(c.maquinaLimite, c.maquinaExtras), preco = reais(EXTRA_MAQUINA.centavos);
    painelDe(EXTRA_MAQUINA, "Mais uma máquina para o agente", `É mais um computador remoto para o agente rodar; não é um Mac a mais com o app. O seu plano cobre ${vagas.total} máquina${vagas.total === 1 ? "" : "s"}${vagas.detalhe === "" ? "" : ` (${vagas.detalhe})`}. Cada máquina a mais custa ${preco} por mês: o agente passa a rodar em mais um computador remoto com a mesma conta. ${pagamento}`, `Adicionar uma máquina por ${preco}/mês`);
  }
  if (EXTRA_DEVICE !== null && (so === null || so === EXTRA_DEVICE.nome)) {
    const vagas = vagasDeDevice(c.licenca.deviceLimit, c.deviceExtras), preco = reais(EXTRA_DEVICE.centavos);
    const pendentes = c.devices.filter((d) => d.status === "pending").length;
    painelDe(EXTRA_DEVICE, "Mais um Mac com o app", `É um Mac a mais para você entrar com a conta no app; não é a máquina onde o agente roda. O seu plano cobre ${vagas.total} device${vagas.total === 1 ? "" : "s"}${vagas.detalhe === "" ? "" : ` (${vagas.detalhe})`}: cada device é um Mac com o app na sua conta. Cada Mac a mais custa ${preco} por mês.${pendentes > 0 ? ` Você tem ${pendentes} Mac${pendentes === 1 ? "" : "s"} esperando vaga: com o pagamento confirmado, o que pediu primeiro entra sozinho.` : ""} ${pagamento}`, `Adicionar um Mac por ${preco}/mês`);
  }
}
/** O último endereço do Marketplace medido no Analytics (view_item_list ou view_item saem uma vez por endereço). */
let mkMedido = null;
/** Navega dentro do console sem recarregar (os cartões e o "voltar" do Marketplace). */
function irPara(ev, caminho) { ev.preventDefault(); history.pushState(null, "", caminho); if (conta !== null) mostrarConsole(conta); }
const avatarDe = (item) => el("div", "mk-avatar", item.nome.replace(/^Mais um[a]? /, "").slice(0, 1).toUpperCase());
const TIPO_ITEM = { plano: "Plano", app: "App", unidade: "Extra" };
/** A linha do preço de um item: "De R$ 997 por R$ 97 por mês" quando há preço de tabela; senão "R$ 97 por mês". */
function precoDoItem(item, classe) {
  const p = el("p", classe), dp = deParaDoExtra(item);
  if (dp !== null) p.append("De ", el("s", "", dp.de), " por ", el("strong", "", dp.por), " por mês"); else p.append(el("strong", "", reaisCurto(item.centavos)), " por mês");
  return p;
}
/**
 * A página Marketplace. Sem item no caminho é a vitrine: o que a conta tem e um cartão por item à venda no ambiente,
 * com o selo do estado (estadoDoItem); o cartão não vende, leva à página do item. Com item (/account/marketplace/<slug>)
 * é a página dele: o que é, o que inclui, o preço e, só ali, o painel de contratar (o do Pro, o do app ou o da
 * unidade extra). É para a página do item que volta quem pagou (`?assinatura=paga&produto=…`): a tela relê a conta até
 * o que foi pago aparecer (pagoChegou), no máximo 10 vezes.
 */
function pintarMarketplace(c) {
  const l = c.licenca, qs = new URLSearchParams(location.search);
  const voltouDe = qs.get("assinatura") === "paga" ? qs.get("produto") : null;
  // A AbacatePay devolve em /account/marketplace?…&produto=…: o lugar do aviso é a página do item pago.
  if (!rota()?.slug && voltouDe !== null && FICHAS[voltouDe]) history.replaceState(null, "", `/account/marketplace/${FICHAS[voltouDe].slug}${location.search}`);
  const slug = rota()?.slug ?? null, item = slug === null ? null : MKT.find((x) => x.slug === slug) ?? null;
  // Item que o ambiente não vende (ou endereço errado): volta para a vitrine.
  if (slug !== null && item === null) { history.replaceState(null, "", "/account/marketplace"); }
  pintarAssinar(c);
  $("mk-lista").hidden = item !== null; $("mk-ficha").hidden = item === null;
  $("mk-assinar-vaga").hidden = item === null || item.tipo !== "plano";
  $("pl-extras").replaceChildren(); $("pl-addons").replaceChildren(); $("mk-ficha").replaceChildren();
  // Analytics, uma vez por endereço (a página é repintada várias vezes): a vitrine vista, ou o item visto.
  if (mkMedido !== location.pathname) { mkMedido = location.pathname; if (item === null) ga.evento("view_item_list", { item_list_id: "marketplace", items: MKT.map(itemGa) }); else ga.evento("view_item", { currency: "BRL", value: item.centavos / 100, items: [itemGa(item)] }); }
  if (item === null) {
    const nomes = Object.fromEntries(MKT.map((x) => [x.id, x.nome]));
    const tem = semPrazo(l) ? [`Pro ${INFINITO}`, TODOS_ADDONS] : oQueAContaTem(c, nomes);
    $("mk-tem").textContent = tem.length === 0 ? "Ainda nada além da conta gratuita. Comece pelo Pro." : `${tem.join(" · ")}.`;
    $("mk-grade").replaceChildren(...MKT.map((x) => {
      const a = el("a", "mk-cartao"), topo = el("div", "mk-topo"), e = estadoDoItem(c, x);
      a.href = `/account/marketplace/${x.slug}`; a.addEventListener("click", (ev) => { ga.evento("select_item", { item_list_id: "marketplace", items: [itemGa(x)] }); irPara(ev, a.getAttribute("href")); });
      topo.append(avatarDe(x), selo(e.texto, e.tom));
      a.append(topo, el("h3", "", x.nome), el("p", "mk-tipo", TIPO_ITEM[x.tipo] ?? ""), el("p", "mk-resumo", x.resumo ?? ""), precoDoItem(x, "mk-preco"));
      return a;
    }));
    return;
  }
  const e = estadoDoItem(c, item), ficha = $("mk-ficha"), painel = el("div", "painel"), cabeca = el("div", "mk-cabeca"), voltar = el("a", "mk-voltar", "← Marketplace");
  voltar.href = "/account/marketplace"; voltar.addEventListener("click", (ev) => irPara(ev, "/account/marketplace"));
  cabeca.append(avatarDe(item), el("h2", "", item.nome), selo(e.texto, e.tom));
  painel.append(cabeca, el("p", "", item.resumo ?? ""), precoDoItem(item, "oferta"));
  if (item.descricao) painel.append(el("h3", "", "Como funciona"), el("p", "", item.descricao));
  if (Array.isArray(item.inclui) && item.inclui.length > 0) { const ul = el("ul"); ul.append(...item.inclui.map((x) => el("li", "", x))); painel.append(el("h3", "", "O que você passa a ter"), ul); }
  if (item.exige) painel.append(el("h3", "", "O que é preciso"), el("p", "", item.exige));
  // O que fazer agora, por tipo: o Pro usa o painel de assinar (pintarAssinar já o trouxe para cá); sem oferta, diz o que a conta tem.
  if (item.tipo === "plano" && $("pl-assinar").hidden) painel.append(el("p", "sub", e.chave === "disponivel" ? "A assinatura do Pro não está disponível neste momento." : semPrazo(l) ? "A sua conta já tem o Pro, sem prazo." : `A sua conta já tem o Pro${l.expiresAt ? ` até ${data(l.expiresAt)}` : ""}. A assinatura e o prazo ficam na página Plano.`));
  if (item.tipo === "unidade" && e.chave === "precisa-pro") painel.append(el("p", "sub", "Esta unidade vale junto com o Pro: assine o Pro primeiro, e ela aparece aqui para contratar."));
  if (item.tipo === "app" && e.chave === "tem") painel.append(el("p", "sub", "A sua conta já tem este app. Ele aparece na página Módulos do app."));
  ficha.append(voltar, painel);
  // O que a conta paga por este item: a situação, até quando vale e o "Cancelar", como em Plano › Suas assinaturas.
  const minhas = assinaturasDoItem(c.assinaturas, item.id);
  if (minhas.length > 0) {
    const caixa = el("div", "painel"), aviso = el("p", "sub"); aviso.id = "mk-assinatura-aviso"; aviso.setAttribute("role", "status");
    caixa.append(el("h2", "", minhas.length === 1 ? "Sua assinatura" : "Suas assinaturas"));
    for (const a of minhas) {
      const sit = situacaoDe(a), linha = el("p", "mk-assinatura"), acao = el("span");
      linha.append(el("strong", "", `${reais(a.valorCentavos)}/mês`), " ", selo(sit.texto, sit.tom), ` ${a.valeAte ? `vale até ${data(a.valeAte)}` : ""} `, acao);
      if (a.status === "ACTIVE" && typeof a.id === "string") { const b = el("button", "btn btn-ghost btn-small", "Cancelar"); b.type = "button"; b.addEventListener("click", () => { pedirCancelamento(a, acao, aviso); }); acao.append(b); }
      caixa.append(linha);
    }
    aviso.textContent = "Você cancela quando quiser. O acesso continua até o fim do mês já pago.";
    caixa.append(aviso); ficha.append(caixa);
  }
  if (item.tipo === "unidade") pintarExtras(c, voltouDe, item.id);
  if (item.tipo === "app") pintarAddons(l, voltouDe, c.liberacoes, "pl-addons", ADDONS.filter((a) => a.nome === item.id));
  let antes = null; try { const bruto = voltouDe === null ? null : sessionStorage.getItem(`mb-antes-${voltouDe}`); antes = bruto !== null && Number.isInteger(Number(bruto)) ? Number(bruto) : null; } catch { antes = null; }
  const esperando = voltouDe !== null && !pagoChegou(c, voltouDe, antes);
  if (esperando && esperasPagamento < 10) { esperasPagamento++; setTimeout(() => { void lerConta().then((c2) => { if (c2 && rota()?.secao === "marketplace") pintarMarketplace(c2); }).catch(() => undefined); }, 3000); }
}
/** "Suas assinaturas": o que a conta paga pela AbacatePay, com a situação e até quando vale. */
function pintarAssinaturas(c) {
  const lista = c.assinaturas ?? [];
  $("pl-assinaturas").hidden = lista.length === 0;
  const tb = $("pl-assinaturas").querySelector("tbody"); tb.replaceChildren();
  for (const a of lista) {
    const s = situacaoDe(a); const tr = el("tr"); const tdS = el("td"); tdS.append(selo(s.texto, s.tom));
    const tdA = el("td");
    if (a.status === "ACTIVE" && typeof a.id === "string") {
      const b = el("button", "btn btn-ghost btn-small", "Cancelar"); b.type = "button";
      b.addEventListener("click", () => { pedirCancelamento(a, tdA); });
      tdA.append(b);
    }
    tr.append(el("td", "", rotuloProduto(a.produto)), el("td", "", `${reais(a.valorCentavos)}/mês`), tdS, el("td", "", a.valeAte ? data(a.valeAte) : "-"), tdA);
    tb.append(tr);
  }
}
/** Repinta a página de assinaturas que está aberta: o Plano ou a página de um item do Marketplace. */
const repintarAssinaturas = (c) => { if (rota()?.secao === "marketplace") pintarMarketplace(c); else pintarPlano(c); };
/**
 * Confirmação na própria linha (sem confirm()): diz até quando vale e só então cancela. `aviso` é onde a frase e o
 * resultado aparecem: o do Plano por padrão; na página de um item do Marketplace, o do painel "Sua assinatura".
 */
function pedirCancelamento(a, td, aviso = $("pl-assinaturas-aviso")) {
  const nome = rotuloProduto(a.produto);
  aviso.textContent = a.valeAte ? `Cancelar o ${nome}: ele continua até ${data(a.valeAte)} e depois nada mais é cobrado.` : `Cancelar o ${nome}: nada mais é cobrado.`;
  const sim = el("button", "btn btn-primary btn-small", "Confirmar cancelamento"); sim.type = "button";
  const nao = el("button", "btn btn-ghost btn-small", "Manter"); nao.type = "button";
  nao.addEventListener("click", () => { void lerConta().then((c) => { if (c) repintarAssinaturas(c); }); });
  sim.addEventListener("click", () => { void cancelarAssinatura(a, sim, nao); });
  td.replaceChildren(sim, document.createTextNode(" "), nao);
}
async function cancelarAssinatura(a, sim, nao) {
  const s = sessaoGuardada(); if (s === null) { void entrar(); return; }
  sim.disabled = nao.disabled = true; sim.textContent = "Cancelando…";
  let r;
  try { r = await api("POST", "/conta/assinatura/cancelar", { id: a.id }, s.acesso); }
  catch { r = { status: 0, corpo: { erro: "sem conexão; tente de novo" } }; }
  const c = await lerConta().catch(() => null);
  if (c) repintarAssinaturas(c);
  // Depois de repintar: o aviso da página aberta (o painel do item foi refeito, então pega o elemento novo).
  const aviso = (rota()?.secao === "marketplace" ? $("mk-assinatura-aviso") : null) ?? $("pl-assinaturas-aviso");
  aviso.textContent = r.status === 200 ? `Assinatura do ${rotuloProduto(a.produto)} cancelada.${a.valeAte ? ` O acesso continua até ${data(a.valeAte)}.` : ""}` : `Não cancelou: ${erroDe(r)}.`;
}
/**
 * O painel "Assinar o Pro" é um só e aparece em duas páginas: no topo da Visão geral (a primeira coisa que a pessoa vê
 * ao abrir o console) e no Plano (onde a página /promocao e o atendimento mandam procurar). Cada página o puxa para a
 * sua vaga ao ser pintada. A vaga sai da página aberta, não de quem chamou: os repintes do Plano (promoção que acabou,
 * volta do pagamento) também rodam com a pessoa na Visão geral, e o painel não pode sumir da tela dela.
 */
function pintarAssinar(c) {
  const vaga = vagaDoAssinar(rota()?.secao);
  const l = c.licenca, estado = estadoAssinaturaPro(l, c.assinaturas);
  $(vaga).append($("pl-assinar"));
  $("pl-assinar").hidden = cfg.pagamentos !== "1" || !ofertaDoProAparece(l, c.assinaturas, Date.now());
  $("pl-assinar-ja").hidden = !estado.proSemAssinatura;
  pintarPromo(c);
  $("pl-assinar-ja").textContent = estado.proSemAssinatura ? `Você já tem o Pro${l.expiresAt ? ` até ${data(l.expiresAt)}` : ""}, sem assinatura ativa. Assinando, a cobrança passa a ser mensal e o prazo que você já tem não é encurtado.` : "";
  return estado;
}
function pintarPlano(c) {
  const l = c.licenca;
  // Contagem regressiva no cabeçalho, ao lado do "lido às": quanto falta do teste ou do Pro (plano-core.js).
  const falta = contagemRegressiva(l, Date.now());
  $("prazo").textContent = falta === null ? "" : falta.texto;
  $("prazo").className = `selo${falta !== null && falta.tom ? ` ${falta.tom}` : ""}`;
  $("prazo").title = falta === null ? "" : semPrazo(l) ? SEM_PRAZO : `Vale até ${data(l.expiresAt ?? l.trialEnd)}`;
  $("prazo").hidden = falta === null || rota()?.secao !== "plan";
  $("pl-cartoes").replaceChildren(
    cartao("⬢", "Plano", selo(PLANO[l.plan] ?? l.plan, l.plan === "pro" ? "ok" : "")),
    cartao("✓", "Status", document.createTextNode(STATUS[l.status] ?? l.status)),
    cartao("▦", "Vale até", semPrazo(l) ? infinito() : document.createTextNode(l.expiresAt ? data(l.expiresAt) : l.trialEnd ? `trial até ${data(l.trialEnd)}` : "sem prazo")),
    cartao("↻", "Ciclo", document.createTextNode(l.interval ? CICLO[l.interval] : "-")),
    cartao("▭", "Limite de devices", semPrazo(l) ? infinito(SEM_LIMITE) : document.createTextNode(`${l.deviceLimit}${vagasDeDevice(l.deviceLimit, c.deviceExtras).detalhe === "" ? "" : ` (${vagasDeDevice(l.deviceLimit, c.deviceExtras).detalhe})`}`)),
    cartao("⌂", "Máquinas com a licença", semPrazo(l) ? infinito(SEM_LIMITE) : document.createTextNode(`${(c.maquinas ?? []).filter(ocupaVaga).length} de ${c.maquinaLimite ?? 1}${vagasDeMaquina(c.maquinaLimite, c.maquinaExtras).detalhe === "" ? "" : ` (${vagasDeMaquina(c.maquinaLimite, c.maquinaExtras).detalhe})`}`)),
    cartao("+", "Add-ons", ...(semPrazo(l) ? [infinito(TODOS_ADDONS)] : l.produtos.length > 0 ? l.produtos.map((p) => selo(rotuloProduto(p))) : [document.createTextNode("nenhum")])),
  );
  // Assinar pela AbacatePay: só com os pagamentos ligados no Worker (config.js) e enquanto não há Pro pago ativo.
  // Pro ativo sem assinatura (liberado pelo admin, ou assinatura cancelada com o mês ainda valendo) continua podendo
  // assinar: o painel só some para quem tem a assinatura do Pro em andamento e o Pro valendo (plano-core.js).
  // Super admin (Pro sem prazo) não tem o que assinar: o painel e a promoção somem; os add-ons continuam abaixo.
  const { pagoAtivo } = pintarAssinar(c);
  const qs = new URLSearchParams(location.search);
  const voltou = qs.get("assinatura") === "paga" && !qs.get("produto");
  if (voltou) $("pl-assinar-aviso").textContent = pagoAtivo ? "Pagamento confirmado: o Pro está ativo." : "Recebemos você de volta. Assim que a AbacatePay confirmar o pagamento, o Pro aparece aqui (costuma levar alguns segundos).";
  pintarAssinaturas(c);
  const esperando = voltou && !pagoAtivo;
  if (esperando && esperasPagamento < 10) { esperasPagamento++; setTimeout(() => { void lerConta().then((c2) => { if (c2) pintarPlano(c2); }).catch(() => undefined); }, 3000); }
  const pg = l.pagamento;
  $("pl-pagamento").hidden = !pg;
  if (pg) { $("pl-instrucoes").textContent = pg.instrucoes; const link = typeof pg.link === "string" && /^https?:\/\//.test(pg.link); $("pl-link").hidden = !link; if (link) $("pl-link").href = pg.link; }
}
function pintarSuporte(c) {
  $("sp-pedidos").textContent = c.pedidos > 0 ? `Você tem ${c.pedidos} pedido${c.pedidos === 1 ? "" : "s"} aberto${c.pedidos === 1 ? "" : "s"} com o admin.` : "Nenhum pedido aberto com o admin.";
  $("sp-conta").textContent = c.id;
}

// ---- arranque
$("pl-assinar-btn").addEventListener("click", () => { void assinar(); });
// Tema: o seletor mostra a escolha guardada (tema.js já a aplicou no <html>) e troca na hora.
if (window.MEU_BOT_TEMA) { $("tema").value = window.MEU_BOT_TEMA.atual(); $("tema").addEventListener("change", () => window.MEU_BOT_TEMA.definir($("tema").value)); }
for (const id of ["ad-vendas-produto", "ad-vendas-situacao"]) $(id).addEventListener("change", () => { if (visao !== null) pintarAdminVendas(visao); });
$("ad-vendas-filtro").addEventListener("submit", (ev) => ev.preventDefault());
$("ad-lista-copiar").addEventListener("click", () => {
  navigator.clipboard.writeText(listaContatos.join("\n")).then(() => { $("ad-lista-aviso").textContent = `${listaContatos.length} copiados.`; }, () => { $("ad-lista-aviso").textContent = "Não copiou."; });
});
$("btn-entrar").addEventListener("click", () => { $("btn-entrar").disabled = true; void entrar(); });
$("btn-sair").addEventListener("click", () => { void sair(); });
$("pf-form").addEventListener("submit", (ev) => { ev.preventDefault(); void perfilSalvar(); });
$("pf-dados-uso").addEventListener("change", (ev) => { void dadosUsoMudar(ev.currentTarget); });
$("pf-apagar").addEventListener("click", (ev) => { void contaApagar(ev.currentTarget); });
$("ad-perfil-form").addEventListener("submit", (ev) => { ev.preventDefault(); const email = $("ad-perfil-email").value.trim().toLowerCase(); if (!email) return; void perfilGravar(email, $("ad-perfil-papel").value, $("ad-perfil-form").querySelector("button")).then(() => { $("ad-perfil-email").value = ""; }); });
$("ad-busca-form").addEventListener("submit", (ev) => { ev.preventDefault(); void carregarVisao($("ad-busca").value.trim()).then(() => { if (conta !== null) mostrarConsole(conta); }).catch((e) => mostrarErro(e?.message ?? String(e))); });
// Os links do menu são caminhos reais (o Worker serve a mesma página para /account/* e /organizations/*), mas trocar de seção não precisa recarregar.
$("menu").addEventListener("click", (ev) => { const a = ev.target.closest("a[data-secao]"); if (a === null || conta === null) return; ev.preventDefault(); history.pushState(null, "", a.getAttribute("href")); mostrarConsole(conta); });
$("org-abas").addEventListener("click", (ev) => { const a = ev.target.closest("a[data-aba]"); if (a === null || conta === null) return; ev.preventDefault(); history.pushState(null, "", a.getAttribute("href")); mostrarConsole(conta); });
$("org-nova-form").addEventListener("submit", (ev) => { ev.preventDefault(); void orgCriar(); });
$("org-nova-form").elements.nome.addEventListener("input", (ev) => { const f = $("org-nova-form"); if (f.elements.slug.dataset.auto === "1") f.elements.slug.value = slugDoNome(ev.currentTarget.value); orgNovaPrevia(); });
$("org-nova-form").elements.slug.addEventListener("input", (ev) => { ev.currentTarget.dataset.auto = ev.currentTarget.value === "" ? "1" : ""; orgNovaPrevia(); });
$("org-convite-form").addEventListener("submit", (ev) => { ev.preventDefault(); void convidar(); });
$("org-form").addEventListener("submit", (ev) => { ev.preventDefault(); void orgSalvar(); });
$("org-apagar").addEventListener("click", (ev) => { void orgApagar(ev.currentTarget); });
window.addEventListener("popstate", () => { if (conta !== null) mostrarConsole(conta); });
// A lista do admin só é lida na entrada e depois de uma ação: de volta à aba, uma lista velha é relida. Com um
// editor de conta aberto não relê, para não apagar o que o admin está digitando (a ação dele trata o 404).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || conta === null || visao === null || !visaoVelha(visaoLidaEm, Date.now())) return;
  if (document.querySelector("#console tr.editor") !== null) return;
  void carregarVisao(visaoBusca).then(() => { if (conta !== null) mostrarConsole(conta); }).catch(() => undefined);
});

(async () => {
  const hash = new URLSearchParams(location.hash.slice(1));
  const code = hash.get("code"), state = hash.get("state"), verifier = hash.get("verifier");
  // /enterprise/<slug> (como o Rambox): porta de entrada da organização pelo site. Já entrado, vai para Membros;
  // senão começa o login pela página da organização. /enterprise sem endereço pergunta o endereço no auth.
  const ent = /^\/enterprise\/([a-z0-9-]{2,40})\/?$/.exec(location.pathname)?.[1] ?? null;
  if (/^\/enterprise\/?$/.test(location.pathname)) { location.replace(`${cfg.auth}/enterprise`); return; }
  try {
    if (ent !== null && code === null) {
      const c = await lerConta();
      if (c === null) { await entrar(ent); return; }
      history.replaceState(null, "", `/organizations/${ent}/members`);
      conta = c;
      await carregarVisao("").catch((e) => mostrarErro(`Visão do admin: ${e?.message ?? e}`));
      mostrarConsole(c);
      return;
    }
    if (code !== null && (state !== null || verifier !== null)) {
      history.replaceState(null, "", location.pathname);
      if (!TOKEN_RE.test(code) || (state !== null && !TOKEN_RE.test(state)) || (verifier !== null && !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))) throw new Error("retorno do login fora do formato");
      conta = await trocarCodigo(code, state ?? "", verifier);
      ga.evento("console_entrada", { via: verifier !== null ? "app" : "login", admin: conta.admin !== null });
      await carregarVisao("").catch((e) => mostrarErro(`Visão do admin: ${e?.message ?? e}`));
      mostrarConsole(conta);
      return;
    }
    const c = await lerConta();
    if (c === null) { mostrarEntrada(null); return; }
    conta = c;
    await carregarVisao("").catch((e) => mostrarErro(`Visão do admin: ${e?.message ?? e}`));
    mostrarConsole(c);
  } catch (e) { mostrarEntrada(`Não deu para entrar: ${e?.message ?? e}`); }
})();
