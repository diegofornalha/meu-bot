// Página de login da conta meu-bot. O app abre esta página com ?state&challenge&esquema&app&v; a pessoa entra com
// Google (popup), com e-mail e senha, ou com um link por e-mail; o ID token do Firebase vai para a API (POST /sessao), que devolve um
// código de uso único; e a página manda a pessoa de volta com <esquema>://auth?code&state. Sem os parâmetros do app
// a página oferece baixar o app (SITE_ORIGIN) ou ir ao console (não há "entrar no site": a conta vive no app). Com esquema=web (o console da conta),
// a volta é para `retorno` (só a origem do console) com #code&state, em vez de um deep link.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, getAdditionalUserInfo, signOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signInWithEmailAndPassword, sendPasswordResetEmail, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const cfg = window.MEU_BOT_CONTA;
const $ = (id) => document.getElementById(id);
const secoes = ["escolha", "aguardando", "email-enviado", "senha-enviada", "pronto", "erro", "sem-app", "org-nao-achada", "org-qual"];
// /enterprise/<slug> (ou /org/<slug>): login pela página da organização; só membro entra, e a API confere.
// /enterprise sem slug: pergunta o endereço da organização e vai para /enterprise/<slug>.
const orgSlug = /^\/(?:enterprise|org)\/([a-z0-9-]{1,40})\/?$/.exec(location.pathname)?.[1] ?? null;
const perguntaOrg = orgSlug === null && /^\/(?:enterprise|org)\/?$/.test(location.pathname);
const mostrar = (id) => { for (const s of secoes) $(s).hidden = s !== id; };
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/, CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/, ESQUEMA_RE = /^(?:web|meu-bot(?:-[a-z0-9]+){0,6})$/; // = ESQUEMA_RE de src/sessao-core.ts
const CHAVE_EMAIL = "meu-bot-conta-email";

// Os parâmetros do app ficam na URL (o link do e-mail volta para esta mesma URL, então sobrevivem).
const q = new URLSearchParams(location.search);
const pedido = { state: q.get("state") ?? "", challenge: q.get("challenge") ?? "", esquema: q.get("esquema") ?? "", app: q.get("app") ?? "", v: q.get("v") ?? "", retorno: q.get("retorno") ?? "" };
const paraConsole = pedido.esquema === "web";
const retornoOk = !paraConsole || (typeof cfg.console === "string" && cfg.console !== "" && (pedido.retorno === cfg.console || pedido.retorno.startsWith(`${cfg.console}/`)) && !pedido.retorno.includes("#"));
const pedidoOk = TOKEN_RE.test(pedido.state) && CHALLENGE_RE.test(pedido.challenge) && ESQUEMA_RE.test(pedido.esquema) && retornoOk;
// Analytics (public/analytics.js; no-op sem GA_ID): só listas fechadas nos parâmetros, nunca e-mail, slug, code ou state.
const ga = window.meuBotGa || { pagina() { /* sem Analytics */ }, evento() { /* sem Analytics */ } };
const destino = paraConsole ? "console" : "app";
const comOrg = orgSlug !== null ? { org: true } : {};

$("canal").textContent = cfg.canal === "staging" ? "staging" : "";
$("app-info").textContent = paraConsole ? "console da conta" : pedido.app ? `${pedido.app}${pedido.v ? ` ${pedido.v}` : ""}` : "";
if (paraConsole) $("sub").textContent = "Você volta ao console sozinho depois de entrar.";

function falhou(texto, motivo = "outro", metodo = null) { ga.evento("login_falhou", { motivo, destino, ...(metodo === null ? {} : { metodo }), ...comOrg }); $("erro-texto").textContent = texto; mostrar("erro"); }

// Cabeçalho da organização: nome e endereço vêm da API (sem login); endereço desconhecido vira a tela "não encontrada".
let orgOk = true;
if (perguntaOrg) {
  orgOk = false;
  $("org-pessoal").href = `/entrar${location.search}`; $("org-pessoal").hidden = false;
  $("titulo").textContent = "Entrar numa organização"; $("sub").textContent = "O endereço é o que aparece no console dela (ex.: coflow).";
  $("form-org").addEventListener("submit", (ev) => { ev.preventDefault(); const slug = $("org-id").value.trim().toLowerCase().replace(/^https?:\/\/[^/]+\/(?:enterprise|org)\//, "").replace(/\/.*$/, ""); if (slug === "") return; ga.evento("login_org_perguntado"); location.href = `/enterprise/${encodeURIComponent(slug)}${location.search}`; });
  mostrar("org-qual");
  ga.pagina("/enterprise", { tipo: "org-pergunta" });
  ga.evento("login_org_visto", { com_slug: false, achada: false });
}
if (orgSlug !== null) {
  for (const id of ["org-pessoal", "org-entrar"]) $(id).href = `/entrar${location.search}`;
  $("org-criar").href = `/signup${location.search}`;
  $("org-pessoal").hidden = false;
  let org = null;
  try { const r = await fetch(`${cfg.api}/orgs/${encodeURIComponent(orgSlug)}/publico`); if (r.ok) org = await r.json(); } catch { org = null; }
  if (org === null || typeof org.nome !== "string") { orgOk = false; $("org-slug-errado").textContent = orgSlug; $("titulo").textContent = "Entrar numa organização"; $("sub").textContent = ""; mostrar("org-nao-achada"); }
  else { $("titulo").textContent = `Entrar na ${org.nome}`; $("org-slug").textContent = orgSlug; $("org-selo").hidden = false; document.title = `Entrar na ${org.nome} · meu-bot`; }
  // O caminho vai anonimizado (/enterprise/_): o endereço da organização não é dado do Analytics.
  ga.pagina("/enterprise/_", { tipo: !orgOk ? "org-nao-achada" : pedidoOk ? destino : "org-redirect" });
  ga.evento("login_org_visto", { com_slug: true, achada: orgOk });
}

if (!orgOk) {
  // A tela "organização não encontrada" já está na frente; nada de Firebase.
} else if (!pedidoOk && orgSlug !== null && typeof cfg.console === "string" && cfg.console !== "") {
  // Página da organização aberta à mão (link que o admin mandou): o console começa o login dela e volta em Membros.
  location.replace(`${cfg.console}/enterprise/${encodeURIComponent(orgSlug)}`);
} else if (!pedidoOk) {
  // Sem os parâmetros do app (URL digitada, link velho): em vez de um erro, o caminho para baixar o app ou ir ao console.
  $("sub").textContent = "Abra o meu-bot e clique em Entrar: ele volta para cá já com o seu login.";
  if (typeof cfg.site === "string" && cfg.site !== "") $("baixar-app").href = cfg.site;
  $("ir-signup").href = "/signup";
  const ic = $("ir-console");
  if (typeof cfg.console === "string" && cfg.console !== "") ic.href = `${cfg.console}/account/overview`; else ic.hidden = true;
  mostrar("sem-app");
  ga.pagina(undefined, { tipo: "sem-app" });
  ga.evento("sem_app_visto", { acao: "visto" });
  for (const [id, acao] of [["baixar-app", "baixar"], ["ir-console", "console"], ["ir-signup", "signup"]]) $(id).addEventListener("click", () => ga.evento("sem_app_visto", { acao }));
} else {
  if (orgSlug === null) ga.pagina(undefined, { tipo: destino });
  const app = initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId });
  const auth = getAuth(app);
  auth.languageCode = "pt-BR";
  // Lembra quem entrou neste navegador (como o Rambox): da próxima vez, "Continuar como …" sem a janela do Google.
  await setPersistence(auth, browserLocalPersistence).catch(() => undefined);

  // O Firebase chama senha e link por e-mail de "password": a página diz qual foi, e a conta registra o provedor certo.
  const metodoDe = (user) => ((user.providerData ?? []).some((p) => p.providerId === "google.com") ? "google" : "emailLink");
  // `metodo` é o que a API registra (google, password, emailLink); `metodoGa` é o passo da pessoa (google, lembrado, senha, link).
  // `novo`: a conta Firebase nasceu neste login (Google ou link); é o cadastro de quem veio direto do app, sem passar pelo /signup.
  async function concluir(user, metodo = metodoDe(user), metodoGa = metodo === "password" ? "senha" : metodo === "emailLink" ? "link" : metodo, novo = false) {
    mostrar("aguardando");
    let idToken;
    try { idToken = await user.getIdToken(true); } catch (e) { pintarLembrado(null); falhou("A sessão lembrada venceu; entre de novo.", "sessao-vencida", metodoGa); return; }
    const r = await fetch(`${cfg.api}/sessao`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken, state: pedido.state, challenge: pedido.challenge, esquema: pedido.esquema, app: pedido.app || undefined, v: pedido.v || undefined, metodo, org: orgSlug ?? undefined }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || typeof j.code !== "string") { falhou(j.erro ?? `a API respondeu ${r.status}`, "api", metodoGa); return; }
    // O evento sai antes de navegar (o gtag usa sendBeacon; mesmo assim, nunca depois da linha que sai da página).
    if (novo) ga.evento("cadastro_concluido", { metodo: metodoGa === "link" ? "link" : metodoGa, via: "login" });
    ga.evento("login_concluido", { metodo: metodoGa, destino, ...comOrg });
    if (paraConsole) { location.replace(`${pedido.retorno}#code=${encodeURIComponent(j.code)}&state=${encodeURIComponent(pedido.state)}`); return; }
    const volta = `${pedido.esquema}://auth?code=${encodeURIComponent(j.code)}&state=${encodeURIComponent(pedido.state)}`;
    $("abrir-app").href = volta;
    $("codigo").textContent = j.code;
    mostrar("pronto");
    // O navegador pergunta "abrir o meu-bot?" e o app recebe a URL; a página fica como está, com o botão para repetir.
    ga.evento("app_aberto", { repeticao: false, ...comOrg });
    location.href = volta;
  }
  $("abrir-app").addEventListener("click", () => ga.evento("app_aberto", { repeticao: true, ...comOrg }));

  // Quem já entrou neste navegador: cartão com nome, e-mail e "Continuar"; "Não é você?" esquece e mostra as opções.
  function pintarLembrado(user) {
    const tem = user !== null && typeof user.email === "string";
    $("lembrado").hidden = !tem;
    if (!tem) return;
    const nome = user.displayName || user.email;
    $("lembrado-nome").textContent = nome; $("lembrado-email").textContent = user.displayName ? user.email : "";
    const foto = typeof user.photoURL === "string" && /^https:\/\//.test(user.photoURL);
    $("lembrado-foto").hidden = !foto; $("lembrado-inicial").hidden = foto;
    if (foto) $("lembrado-foto").src = user.photoURL; else $("lembrado-inicial").textContent = nome.trim().charAt(0).toUpperCase();
    $("btn-lembrado").textContent = `Continuar como ${(user.displayName || user.email).split(" ")[0]}`;
  }
  const lembrado = await new Promise((r) => { const parar = auth.onAuthStateChanged((u) => { parar(); r(u); }); });
  pintarLembrado(lembrado);
  $("btn-lembrado").addEventListener("click", async () => { const u = auth.currentUser; if (u === null) { pintarLembrado(null); return; } ga.evento("login_iniciado", { metodo: "lembrado", destino, ...comOrg }); try { await concluir(u, undefined, "lembrado"); } catch (e) { falhou(`${e?.message ?? e}`, "outro", "lembrado"); } });
  $("lembrado-nao").addEventListener("click", async () => { try { await signOut(auth); } catch { /* ok */ } pintarLembrado(null); });

  $("btn-google").addEventListener("click", async () => {
    mostrar("aguardando");
    ga.evento("login_iniciado", { metodo: "google", destino, ...comOrg });
    try { const prov = new GoogleAuthProvider(); prov.setCustomParameters({ prompt: "select_account" }); const cred = await signInWithPopup(auth, prov); await concluir(cred.user, "google", undefined, getAdditionalUserInfo(cred)?.isNewUser === true); }
    catch (e) { const fechado = e?.code === "auth/popup-closed-by-user"; falhou(fechado ? "A janela do Google foi fechada antes de terminar." : `Google: ${e?.message ?? e}`, fechado ? "popup-fechado" : "google", "google"); }
  });

  // E-mail com senha entra na hora; sem senha, vai um link por e-mail (o que a pessoa sempre teve).
  $("form-email").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("email").value.trim().toLowerCase(), senha = $("senha").value;
    if (!email) return;
    $("btn-email").disabled = true;
    try {
      if (senha !== "") {
        mostrar("aguardando");
        ga.evento("login_iniciado", { metodo: "senha", destino, ...comOrg });
        try { const cred = await signInWithEmailAndPassword(auth, email, senha); await concluir(cred.user, "password"); }
        catch (e) {
          const c = e?.code ?? "";
          if (c === "auth/invalid-credential" || c === "auth/wrong-password" || c === "auth/user-not-found" || c === "auth/invalid-login-credentials") { ga.evento("login_falhou", { motivo: "senha", metodo: "senha", destino, ...comOrg }); mostrar("escolha"); $("senha").value = ""; $("senha").focus(); $("senha").placeholder = "Senha errada, ou esta conta ainda não tem senha"; }
          else if (c === "auth/too-many-requests") falhou("Muitas tentativas de senha; espere um pouco ou peça um link por e-mail.", "muitas-tentativas", "senha");
          else falhou(`Senha: ${e?.message ?? e}`, "outro", "senha");
        }
        return;
      }
      ga.evento("login_iniciado", { metodo: "link", destino, ...comOrg });
      await sendSignInLinkToEmail(auth, email, { url: location.href, handleCodeInApp: true });
      try { localStorage.setItem(CHAVE_EMAIL, email); } catch { /* sem localStorage: a volta pede o e-mail */ }
      $("email-destino").textContent = email;
      mostrar("email-enviado");
      ga.evento("link_enviado", { destino, ...comOrg });
    } catch (e) { falhou(`E-mail: ${e?.message ?? e}`, "outro", "link"); }
    finally { $("btn-email").disabled = false; }
  });
  // "Esqueci a senha" (também serve para criar a primeira): o e-mail do Firebase leva ao formulário de definir senha.
  $("esqueci").addEventListener("click", async () => {
    const email = $("email").value.trim().toLowerCase();
    if (!email) { $("email").focus(); $("email").reportValidity(); return; }
    $("esqueci").disabled = true;
    try { await sendPasswordResetEmail(auth, email); $("senha-destino").textContent = email; mostrar("senha-enviada"); ga.evento("senha_recuperar", { destino, ...comOrg }); }
    catch (e) { const semConta = e?.code === "auth/user-not-found"; falhou(semConta ? "Não há conta com esse e-mail: entre com o Google ou peça um link." : `Senha: ${e?.message ?? e}`, semConta ? "sem-conta" : "outro", "senha"); }
    finally { $("esqueci").disabled = false; }
  });
  $("senha-voltar").addEventListener("click", () => mostrar("escolha"));

  $("tentar").addEventListener("click", () => mostrar("escolha"));
  $("ir-signup").href = `/signup${location.search}`;

  if (isSignInWithEmailLink(auth, location.href)) {
    // Voltou pelo link do e-mail: o e-mail fica guardado neste navegador; se não está (outro navegador), pergunta.
    let email = null;
    try { email = localStorage.getItem(CHAVE_EMAIL); } catch { email = null; }
    if (!email) email = window.prompt("Confirme o e-mail que recebeu o link:");
    if (!email) { mostrar("escolha"); }
    else {
      mostrar("aguardando");
      try { const cred = await signInWithEmailLink(auth, email.trim().toLowerCase(), location.href); try { localStorage.removeItem(CHAVE_EMAIL); } catch { /* ok */ } await concluir(cred.user, "emailLink", undefined, getAdditionalUserInfo(cred)?.isNewUser === true); }
      catch (e) { falhou(`O link não serviu (${e?.code ?? e}). Peça um novo.`, "link-invalido", "link"); }
    }
  } else {
    mostrar("escolha");
  }
}
