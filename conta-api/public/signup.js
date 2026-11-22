// Criar conta no meu-bot (auth.agentesgrok.com/signup): nome, e-mail e senha no Firebase, e-mail de confirmação, e a
// volta pela página de login (/entrar com os mesmos parâmetros do app): lá o cartão "Continuar como …" termina o
// login e manda a pessoa de volta ao app ou ao console. Com o Google, a conta nasce confirmada e vai direto ao /entrar.
// Sem os parâmetros do app a conta é criada do mesmo jeito; a pessoa entra depois pelo app.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, getAdditionalUserInfo, createUserWithEmailAndPassword, updateProfile, sendEmailVerification, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const cfg = window.MEU_BOT_CONTA;
const $ = (id) => document.getElementById(id);
const ga = window.meuBotGa || { pagina() { /* sem Analytics */ }, evento() { /* sem Analytics */ } };
const secoes = ["formulario", "aguardando", "confirmar", "erro"];
const mostrar = (id) => { for (const s of secoes) $(s).hidden = s !== id; };

// Os parâmetros do app (state, challenge, esquema…) só passam adiante: quem os confere é o /entrar.
const q = new URLSearchParams(location.search);
const entrarUrl = `${location.origin}/entrar${location.search}`;
$("ir-entrar").href = entrarUrl; $("continuar").href = entrarUrl;
$("canal").textContent = cfg.canal === "staging" ? "staging" : "";
const app = q.get("app") ?? "", v = q.get("v") ?? "";
$("app-info").textContent = q.get("esquema") === "web" ? "console da conta" : app ? `${app}${v ? ` ${v}` : ""}` : "";
if (!q.has("esquema")) $("sub").textContent = "Com e-mail e senha. Depois de confirmar o e-mail, entre pelo app meu-bot.";
ga.pagina(undefined, { tipo: q.get("esquema") === "web" ? "console" : q.has("esquema") ? "app" : "sem-app" });

const fb = initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId });
const auth = getAuth(fb);
auth.languageCode = "pt-BR";
await setPersistence(auth, browserLocalPersistence).catch(() => undefined);

function falhou(texto) { $("erro-texto").textContent = texto; mostrar("erro"); }
function erroCampo(texto) { $("erro-campo").textContent = texto ?? ""; $("erro-campo").hidden = !texto; }
const nomeCompleto = () => [$("nome").value.trim(), $("sobrenome").value.trim()].filter(Boolean).join(" ").slice(0, 120);

$("form-cadastro").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  erroCampo(null);
  const email = $("email").value.trim().toLowerCase(), senha = $("senha").value;
  ga.evento("cadastro_iniciado", { metodo: "senha" });
  if (senha.length < 8) { ga.evento("cadastro_falhou", { metodo: "senha", motivo: "senha-curta" }); erroCampo("A senha precisa ter pelo menos 8 caracteres."); return; }
  $("btn-criar").disabled = true;
  mostrar("aguardando");
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    try { await updateProfile(cred.user, { displayName: nomeCompleto() }); } catch { /* o nome pode ser mudado no console */ }
    await sendEmailVerification(cred.user, { url: entrarUrl });
    $("confirmar-email").textContent = email;
    mostrar("confirmar");
    ga.evento("cadastro_concluido", { metodo: "senha" });
  } catch (e) {
    const c = e?.code ?? "";
    mostrar("formulario");
    const motivo = c === "auth/email-already-in-use" ? "email-em-uso" : c === "auth/weak-password" ? "senha-fraca" : c === "auth/invalid-email" ? "email-invalido" : "outro";
    ga.evento("cadastro_falhou", { metodo: "senha", motivo });
    if (c === "auth/email-already-in-use") erroCampo("Já existe uma conta com esse e-mail: entre com a senha, com o Google ou peça um link em Entrar.");
    else if (c === "auth/weak-password") erroCampo("Senha fraca: use pelo menos 8 caracteres, misturando letras e números.");
    else if (c === "auth/invalid-email") erroCampo("Esse e-mail não parece válido.");
    else falhou(`${e?.message ?? e}`);
  } finally { $("btn-criar").disabled = false; }
});

$("reenviar").addEventListener("click", async () => {
  const u = auth.currentUser;
  if (u === null) { mostrar("formulario"); return; }
  $("reenviar").disabled = true;
  try { await sendEmailVerification(u, { url: entrarUrl }); $("reenviado").hidden = false; }
  catch (e) { falhou(e?.code === "auth/too-many-requests" ? "Muitos envios seguidos; espere um pouco." : `${e?.message ?? e}`); }
  finally { $("reenviar").disabled = false; }
});

$("btn-google").addEventListener("click", async () => {
  mostrar("aguardando");
  ga.evento("cadastro_iniciado", { metodo: "google" });
  try { const prov = new GoogleAuthProvider(); prov.setCustomParameters({ prompt: "select_account" }); const cred = await signInWithPopup(auth, prov);
    // Conta Google que já existia não é cadastro novo: sem isto, quem já tinha conta e passou pelo /signup contava
    // como conversão "cadastro_concluido" (meta principal do Google Ads), inflando os cadastros.
    if (getAdditionalUserInfo(cred)?.isNewUser === true) ga.evento("cadastro_concluido", { metodo: "google" });
    else ga.evento("cadastro_conta_existente", { metodo: "google" });
    location.href = entrarUrl; }
  catch (e) { const fechado = e?.code === "auth/popup-closed-by-user"; ga.evento("cadastro_falhou", { metodo: "google", motivo: fechado ? "popup-fechado" : "google" }); falhou(fechado ? "A janela do Google foi fechada antes de terminar." : `Google: ${e?.message ?? e}`); }
});

$("tentar").addEventListener("click", () => mostrar("formulario"));
mostrar("formulario");
