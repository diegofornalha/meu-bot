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
const SECOES = ["overview", "profile", "devices", "plan", "support", "access", "organizations"];
const TITULOS = { janelas: "Janelas de suporte", overview: "Visão geral", profile: "Perfil", devices: "Devices", plan: "Plano", support: "Suporte", access: "Perfis de acesso", orgs: "Organizações", "org-nova": "Nova organização" };
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const PAPEL_ORG = { dona: "dona", admin: "admin", membro: "membro" };
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const aleatorio = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const ss = { get(k) { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } }, set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage: a sessão dura a página */ } } };
const data = (iso) => { const t = Date.parse(iso ?? ""); return Number.isNaN(t) ? "-" : new Date(t).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" }); };
const dataHora = (iso) => { const t = Date.parse(iso ?? ""); return Number.isNaN(t) ? "-" : new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const PLANO = { free: "Free", pro: "Pro" }, STATUS = { free: "Free", trialing: "Trial", active: "Ativo", expired: "Expirado" }, CICLO = { month: "mensal", year: "anual" };
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
function sessaoGuardada() { const s = ss.get(CH_SESSAO); return s !== null && typeof s.acesso === "string" && Date.parse(s.expiraEm ?? "") > Date.now() + 30_000 ? s : null; }
async function api(metodo, rota, corpo, acesso) {
  const headers = { accept: "application/json" };
  if (corpo !== undefined) headers["content-type"] = "application/json";
  if (acesso) headers.authorization = `Bearer ${acesso}`;
  const r = await fetch(`${cfg.api}${rota}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
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
  return r.corpo.conta;
}
async function lerConta() {
  const s = sessaoGuardada();
  if (s === null) return null;
  const r = await api("GET", "/conta", undefined, s.acesso);
  if (r.status === 401) { ss.set(CH_SESSAO, null); return null; }
  if (r.status !== 200) throw new Error(erroDe(r));
  return r.corpo;
}
async function carregarVisao(busca) {
  const s = sessaoGuardada();
  if (s === null || conta === null || conta.admin === null) { visao = null; return; }
  const r = await api("GET", `/admin/visao?busca=${encodeURIComponent(busca)}`, undefined, s.acesso);
  if (r.status !== 200) throw new Error(erroDe(r));
  visao = r.corpo; visaoBusca = busca;
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
  const r = rota() ?? { secao: "overview", slug: null, aba: null };
  const secao = r.secao;
  if (rota() === null) history.replaceState(null, "", "/account/overview");
  pintarMenuOrgs(c);
  for (const a of $("menu").querySelectorAll("a")) a.classList.toggle("ativo", a.dataset.secao === secao && (secao !== "org" || a.dataset.slug === r.slug));
  for (const s of document.querySelectorAll("section[data-secao]")) s.hidden = s.dataset.secao !== secao;
  $("titulo").textContent = TITULOS[secao] ?? "";
  document.title = `${TITULOS[secao] ?? "Organização"} · Console meu-bot`;
  medirPagina(secao);
  $("atualizado").textContent = `lido às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  pintarQuem(c);
  const admin = visao !== null;
  $("console").classList.toggle("modo-admin", admin);
  $("menu-access").hidden = !(admin && c.admin === "super");
  $("menu-orgs-todas").hidden = !(admin && c.admin === "super");
  $("menu-janelas").hidden = !(admin && c.admin === "super");
  for (const id of ["ad-overview", "ad-plan", "ad-devices", "ad-support"]) $(id).hidden = !admin;
  for (const d of document.querySelectorAll("details.pessoal")) d.open = !admin;
  if ((secao === "access" || secao === "orgs" || secao === "janelas") && !(admin && c.admin === "super")) { history.replaceState(null, "", "/account/overview"); mostrarConsole(c); return; }
  if (secao === "org-nova") { pintarOrgNova(); return; }
  if (secao === "janelas") { void pintarJanelas(); return; }
  if (secao === "orgs") { pintarAdminOrgs(visao); return; }
  if (secao === "org") { void abrirOrg(r.slug, r.aba); return; }
  ({ overview: pintarOverview, profile: pintarPerfil, devices: pintarDevices, plan: pintarPlano, support: pintarSuporte, access: () => undefined })[secao](c);
  if (admin) ({ overview: pintarAdminTotais, profile: () => undefined, devices: pintarAdminDevices, plan: pintarAdminContas, support: pintarAdminPedidos, access: pintarAdminPerfis })[secao](visao);
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
    sel.disabled = p.email === conta.email; sel.addEventListener("change", () => { void perfilGravar(p.email, sel.value, sel); }); papel.append(sel); tr.append(papel);
    tr.append(el("td", "", p.entrou ? "sim" : "ainda não"), el("td", "", data(p.criadoEm)));
    const td = el("td"); if (p.email !== conta.email) { const b = el("button", "btn btn-ghost", "Remover"); b.type = "button"; b.addEventListener("click", () => { void perfilRemover(p.email, b); }); td.append(b); } tr.append(td);
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
const DIA = 24 * 60 * 60 * 1000;
/** A fase da conta, para o admin acompanhar: trial (dias restantes), trial vencido, Pro ativo, expirado, free. */
function fase(l, agora = Date.now()) {
  const fim = Date.parse(l.expiresAt ?? l.trialEnd ?? "");
  const dias = Number.isNaN(fim) ? null : Math.ceil((fim - agora) / DIA);
  if (l.status === "trialing") return dias === null ? { texto: "Trial", tom: "ok" } : dias >= 0 ? { texto: `Trial · ${dias === 0 ? "último dia" : `${dias} dia${dias === 1 ? "" : "s"}`}`, tom: "ok" } : { texto: `Trial venceu há ${-dias} dia${dias === -1 ? "" : "s"}`, tom: "mau" };
  if (l.status === "active" && l.plan === "pro") return dias !== null && dias < 0 ? { texto: `Pro venceu há ${-dias} dia${dias === -1 ? "" : "s"}`, tom: "mau" } : { texto: dias === null ? "Pro ativo" : `Pro · ${dias} dia${dias === 1 ? "" : "s"}`, tom: "ok" };
  if (l.status === "expired") return { texto: "Expirado", tom: "mau" };
  return { texto: "Free", tom: "" };
}
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
  );
}
function pintarAdminContas(v) {
  $("ad-busca").value = visaoBusca;
  const tb = $("ad-contas").querySelector("tbody"); tb.replaceChildren();
  if (v.contas.length === 0) { const tr = el("tr"); const td = el("td", "", visaoBusca ? "Nenhuma conta com esse e-mail ou nome." : "Ninguém entrou ainda."); td.colSpan = 8; tr.append(td); tb.append(tr); }
  for (const c of v.contas) {
    const l = c.licenca, ativos = c.devices.filter((d) => d.status !== "pending").length, pend = c.devices.length - ativos;
    const tr = el("tr");
    tr.append(contaCelula(c.email, c.nome));
    const plano = el("td"); plano.append(selo(PLANO[l.plan] ?? l.plan, l.plan === "pro" ? "ok" : "")); if (c.admin) plano.append(document.createTextNode(" "), selo(c.admin === "super" ? "super admin" : "admin")); tr.append(plano);
    const f = fase(l); const tdFase = el("td"); tdFase.append(selo(f.texto, f.tom)); tr.append(tdFase);
    tr.append(el("td", "", l.expiresAt ? data(l.expiresAt) : l.trialEnd ? data(l.trialEnd) : "-"));
    const dv = el("td", "", `${ativos}/${l.deviceLimit}`); if (pend > 0) dv.append(document.createTextNode(" "), selo(`${pend} pendente${pend === 1 ? "" : "s"}`, "mau")); tr.append(dv);
    tr.append(el("td", "", String(c.maquinas)), el("td", "", String(c.pedidos)), el("td", "", data(c.criadaEm)));
    const acao = el("td"); const b = el("button", "btn btn-ghost", "Mudar"); b.type = "button"; b.addEventListener("click", () => editorLicenca(tr, c)); acao.append(b); tr.append(acao);
    tb.append(tr);
  }
}
/** O admin manda o e-mail de senha de uma conta; o botão vira "enviado" por um tempo. */
async function adminSenha(c, botao) {
  const s = sessaoGuardada(); if (s === null) return;
  botao.disabled = true;
  const r = await api("POST", `/admin/contas/${encodeURIComponent(c.id)}/senha`, {}, s.acesso);
  if (r.status !== 200) { botao.disabled = false; mostrarErro(erroDe(r)); return; }
  mostrarErro(null);
  const texto = botao.textContent; botao.textContent = "E-mail enviado";
  setTimeout(() => { botao.textContent = texto; botao.disabled = false; }, 8000);
}
/** Linha de edição abaixo da conta: plano, status, vale até, limite de devices, add-ons, pagamento. Salva com PATCH. */
function editorLicenca(tr, c) {
  const existente = tr.nextElementSibling;
  if (existente !== null && existente.classList.contains("editor")) { existente.remove(); return; }
  const l = c.licenca;
  const linha = el("tr", "editor"); const td = el("td"); td.colSpan = 10;
  const form = el("form", "editor-form");
  const campo = (rotulo, input) => { const lb = el("label"); lb.append(el("span", "", rotulo), input); return lb; };
  const select = (nome, opcoes, atual) => { const s = el("select"); s.name = nome; for (const [v, t] of opcoes) { const o = el("option", "", t); o.value = v; o.selected = v === atual; s.append(o); } return s; };
  const input = (nome, tipo, valor, ph) => { const i = el("input"); i.name = nome; i.type = tipo; i.value = valor ?? ""; if (ph) i.placeholder = ph; return i; };
  const plan = select("plan", [["free", "Free"], ["pro", "Pro"]], l.plan);
  const status = select("status", [["free", "Free"], ["trialing", "Trial"], ["active", "Ativo"], ["expired", "Expirado"]], l.status);
  const ate = input("ate", "date", (l.expiresAt ?? l.trialEnd ?? "").slice(0, 10));
  const limite = input("deviceLimit", "number", String(l.deviceLimit)); limite.min = "1"; limite.max = "50";
  const produtos = input("produtos", "text", l.produtos.join(", "), "meu-bot-finance, …");
  const instrucoes = input("instrucoes", "text", l.pagamento?.instrucoes ?? "", "Pix, link, contato…");
  const link = input("link", "url", l.pagamento?.link ?? "", "https://…");
  form.append(campo("Plano", plan), campo("Status", status), campo("Vale até", ate), campo("Devices", limite), campo("Add-ons", produtos), campo("Como pagar", instrucoes), campo("Link", link));
  // Senha: o super admin define na hora (em branco não muda); qualquer admin manda o e-mail de redefinição.
  const superAdmin = conta !== null && conta.admin === "super";
  const senha = input("senha", "password", "", superAdmin ? "nova senha (em branco: não muda)" : "só o super admin define"); senha.autocomplete = "new-password"; senha.minLength = 8; senha.maxLength = 128; senha.disabled = !superAdmin;
  form.append(campo("Senha", senha));
  const salvar = el("button", "btn btn-primary", "Salvar"); salvar.type = "submit";
  const emailSenha = el("button", "btn btn-ghost", "E-mail de senha"); emailSenha.type = "button"; emailSenha.title = `Manda a ${c.email} o e-mail para criar ou redefinir a senha (o mesmo de "Esqueci a senha").`; emailSenha.addEventListener("click", () => { void adminSenha(c, emailSenha); });
  const cancelar = el("button", "btn btn-ghost", "Cancelar"); cancelar.type = "button"; cancelar.addEventListener("click", () => linha.remove());
  const acoes = el("div", "acoes"); acoes.append(salvar, emailSenha, cancelar); form.append(acoes);
  const aviso = el("p", "sub", "Vale na conta e no console; o que libera o Pro no app ainda é a licença da máquina (próxima versão). Senha preenchida: troca no Firebase e desconecta a pessoa de todos os Macs.");
  form.append(aviso);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault(); salvar.disabled = true;
    const ateIso = ate.value ? `${ate.value}T23:59:59.000Z` : null;
    const patch = { plan: plan.value, status: status.value, deviceLimit: Number(limite.value), produtos: produtos.value.split(",").map((x) => x.trim()).filter(Boolean), pagamento: instrucoes.value.trim() ? { instrucoes: instrucoes.value.trim(), link: link.value.trim() || null } : null };
    if (status.value === "trialing") { patch.trialEnd = ateIso; patch.expiresAt = ateIso; } else { patch.expiresAt = ateIso; patch.trialEnd = null; }
    const s = sessaoGuardada(); if (s === null) return;
    const r = await api("PATCH", `/admin/contas/${encodeURIComponent(c.id)}/licenca`, patch, s.acesso);
    if (r.status !== 200) { salvar.disabled = false; mostrarErro(erroDe(r)); return; }
    if (senha.value !== "") {
      // Troca a senha no Firebase e desconecta a pessoa de todos os Macs; ela passa a entrar com e-mail e senha.
      const rs = await api("PUT", `/admin/contas/${encodeURIComponent(c.id)}/senha`, { senha: senha.value }, s.acesso);
      if (rs.status !== 200) { salvar.disabled = false; mostrarErro(`Licença salva, mas a senha não: ${erroDe(rs)}`); return; }
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
  if (linhas.length === 0) { const tr = el("tr"); const td = el("td", "", "Nenhum device em conta nenhuma."); td.colSpan = 7; tr.append(td); tb.append(tr); }
  for (const { c, d } of linhas) {
    const tr = el("tr");
    // Uso da conta ao lado de cada Mac: ativos/limite, com aviso quando um Mac novo já cairia em Pendente.
    const ativos = c.devices.filter((x) => x.status !== "pending").length, limite = c.licenca.deviceLimit;
    const uso = el("td", "", `${ativos}/${limite}`); if (ativos >= limite) uso.append(document.createTextNode(" "), selo("no limite", "mau"));
    tr.append(contaCelula(c.email, c.nome), uso, el("td", "", `${d.name || d.id.slice(0, 8)}${d.platform ? ` · ${d.platform}` : ""}`), el("td", "", d.user || "-"), el("td", "", Object.entries(d.apps ?? {}).map(([a, x]) => `${a} ${x.version}`).join(", ") || "-"));
    const st = el("td"); st.append(selo(d.status === "pending" ? "Pendente" : "Ativo", d.status === "pending" ? "mau" : "ok")); tr.append(st);
    tr.append(el("td", "", dataHora(d.lastSeen)));
    tb.append(tr);
  }
}
const TIPO_PEDIDO = { "plano.pedir": "Pro", "addon.pedir": "Add-on", "device.pedir": "Device", "importar": "Importar licença" };
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
  const l = c.licenca, ativos = c.devices.filter((d) => d.status !== "pending").length, pendentes = c.devices.length - ativos;
  $("ov-cartoes").replaceChildren(
    cartao("⬢", "Plano", selo(PLANO[l.plan] ?? l.plan, l.plan === "pro" ? "ok" : "")),
    cartao("✓", "Status", document.createTextNode(STATUS[l.status] ?? l.status), selo(l.status === "expired" ? "venceu" : "OK", statusTom(l) || "")),
    cartao("▦", "Membro desde", document.createTextNode(data(l.memberSince))),
    cartao("↻", "Ciclo de cobrança", document.createTextNode(l.interval ? CICLO[l.interval] : "-")),
    cartao("▭", "Devices", document.createTextNode(`${ativos} de ${l.deviceLimit}`), ...(pendentes > 0 ? [selo(`${pendentes} pendente${pendentes === 1 ? "" : "s"}`, "mau")] : [])),
    cartao("⌂", "Máquinas", document.createTextNode(String(c.maquinas.length))),
    ...(l.produtos.length > 0 ? [cartao("+", "Add-ons", ...l.produtos.map((p) => selo(p)))] : []),
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
  $("dv-resumo").textContent = `${c.devices.length} device${c.devices.length === 1 ? "" : "s"} · ${ativos} ativo${ativos === 1 ? "" : "s"} de ${l.deviceLimit} do plano.`;
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
  $("dv-maquinas").textContent = c.maquinas.length === 0 ? "Nenhuma máquina (VM) vinculada à conta ainda." : `Máquinas vinculadas: ${c.maquinas.map((m) => m.apelido ?? m.id.slice(0, 8)).join(", ")}.`;
}
let esperasPagamento = 0;
/** "Assinar": pede o checkout à API (com o client_id/session_id do GA4, para a compra ir à mesma visita) e vai para a página da AbacatePay. */
async function assinar() {
  const s = sessaoGuardada();
  if (s === null) { void entrar(); return; }
  const btn = $("pl-assinar-btn"); btn.disabled = true; $("pl-assinar-aviso").textContent = "Abrindo a página de pagamento…";
  const v = typeof ga.visita === "function" ? await ga.visita() : { clientId: null, sessionId: null };
  const r = await api("POST", "/conta/assinatura", { gaClientId: v.clientId, gaSessionId: v.sessionId }, s.acesso);
  if (r.status === 200 && r.corpo && typeof r.corpo.url === "string") { ga.evento("checkout_iniciado", { plano: "chip-coflow" }); location.assign(r.corpo.url); return; }
  btn.disabled = false; $("pl-assinar-aviso").textContent = erroDe(r);
}
function pintarPlano(c) {
  const l = c.licenca;
  $("pl-cartoes").replaceChildren(
    cartao("⬢", "Plano", selo(PLANO[l.plan] ?? l.plan, l.plan === "pro" ? "ok" : "")),
    cartao("✓", "Status", document.createTextNode(STATUS[l.status] ?? l.status)),
    cartao("▦", "Vale até", document.createTextNode(l.expiresAt ? data(l.expiresAt) : l.trialEnd ? `trial até ${data(l.trialEnd)}` : "sem prazo")),
    cartao("↻", "Ciclo", document.createTextNode(l.interval ? CICLO[l.interval] : "-")),
    cartao("▭", "Limite de devices", document.createTextNode(String(l.deviceLimit))),
    cartao("+", "Add-ons", ...(l.produtos.length > 0 ? l.produtos.map((p) => selo(p)) : [document.createTextNode("nenhum")])),
  );
  // Assinar pela AbacatePay: só com os pagamentos ligados no Worker (config.js) e enquanto não há Pro pago ativo.
  const pagoAtivo = l.plan === "pro" && l.status === "active";
  $("pl-assinar").hidden = cfg.pagamentos !== "1" || pagoAtivo;
  const voltou = new URLSearchParams(location.search).get("assinatura") === "paga";
  if (voltou) $("pl-assinar-aviso").textContent = pagoAtivo ? "Pagamento confirmado: o Pro está ativo." : "Recebemos você de volta. Assim que a AbacatePay confirmar o pagamento, o Pro aparece aqui (costuma levar alguns segundos).";
  if (voltou && !pagoAtivo && esperasPagamento < 10) { esperasPagamento++; setTimeout(() => { void lerConta().then((c2) => { if (c2) pintarPlano(c2); }).catch(() => undefined); }, 3000); }
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
