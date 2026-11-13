// Google Analytics 4 das páginas do meu-bot (site, login, console). Script clássico carregado logo depois de /config.js:
// expõe window.meuBotGa = { pagina, evento } para as páginas. Sem `ga` no config (GA_ID vazio no Worker), as duas
// funções não fazem nada e nenhum script de fora é carregado.
// Regras: nunca mandar fragmento da URL (o console recebe #code&verifier) nem a query, a não ser as chaves de campanha
// (utm_*, gclid, gbraid, wbraid: a mesma lista de CHAVES_CAMPANHA em src/analytics-core.ts; o login tem ?state&challenge), nem
// e-mail, nome, slug de organização ou id de conta nos parâmetros; sem sinais de anúncios; em staging, debug_mode (o
// DebugView do Analytics mostra os eventos na hora) e todo evento leva `ambiente`.
(() => {
  const cfg = window.MEU_BOT_CONTA || {};
  const ids = typeof cfg.ga === "string" ? [...new Set(cfg.ga.split(",").map((x) => x.trim()).filter((x) => /^G-[A-Z0-9]{6,12}$/.test(x)))] : [];
  const ambiente = cfg.canal === "staging" ? "staging" : "producao";
  const nada = { pagina() { /* sem Analytics */ }, evento() { /* sem Analytics */ }, visita: () => Promise.resolve({ clientId: null, sessionId: null }), ligado: false, ambiente };
  if (ids.length === 0) { window.meuBotGa = nada; return; }
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  /** O caminho sem o endereço de uma organização (/organizations/<slug>/… → /organizations/_/…). */
  const anonimo = (c) => c.replace(/^\/organizations\/(?!new(?:\/|$))[^/]+/, "/organizations/_").replace(/^\/enterprise\/[^/]+/, "/enterprise/_");
  /** A query só com as chaves de campanha (cópia de campanhaDaQuery, src/analytics-core.ts): o clique do anúncio chega ao GA4. */
  const CAMPANHA = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "gclid", "gbraid", "wbraid"];
  const campanha = () => { const p = new URLSearchParams(location.search); const q = new URLSearchParams(); for (const k of CAMPANHA) { const v = p.get(k); if (v) q.set(k, v.slice(0, 200)); } const s = q.toString(); return s ? `?${s}` : ""; };
  /**
   * Volta do login do Google (accounts.google.com, <projeto>.firebaseapp.com): não é uma origem de visita, é o meio do
   * login. Sem isto, a sessão do console vira "accounts.google.com / referral" e a campanha do anúncio se perde (o mesmo
   * que a lista de "referências indesejadas" do GA4, mas no código). Cópia de HOSTS_LOGIN em src/analytics-core.ts.
   */
  const HOSTS_LOGIN = /(^|\.)accounts\.google\.com$|(^|\.)accounts\.youtube\.com$|\.firebaseapp\.com$/;
  const veioDoLogin = (() => { try { return document.referrer !== "" && HOSTS_LOGIN.test(new URL(document.referrer).hostname); } catch { return false; } })();
  const semQuery = (url) => { try { const u = new URL(url, location.href); return `${u.origin}${anonimo(u.pathname)}`; } catch { return ""; } };
  /**
   * Fixa a URL limpa para TODO evento (os automáticos da medição otimizada e os de mudança de histórico usam a URL real
   * se nada for fixado): origem + caminho anonimizado + só as chaves de campanha, sem fragmento; o referrer sem query.
   */
  const fixar = (caminho) => { const cam = anonimo(caminho || location.pathname); window.gtag("set", { page_location: `${location.origin}${cam}${campanha()}`, page_path: cam, page_referrer: veioDoLogin ? "" : semQuery(document.referrer) }); return cam; };
  fixar();
  // Antes de o gtag carregar: o pushState/replaceState da página passa por aqui primeiro, e a URL fixada já é a nova (limpa).
  for (const m of ["pushState", "replaceState"]) { const original = history[m]; history[m] = function (st, titulo, url) { const r = original.apply(this, arguments); if (url !== undefined && url !== null) { try { fixar(new URL(String(url), location.href).pathname); } catch { /* url estranha: fica a anterior */ } } return r; }; }
  const base = { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false };
  if (veioDoLogin) base.ignore_referrer = true;
  if (ambiente === "staging") base.debug_mode = true;
  // `set` vale para todos os IDs; o config de cada ID repete as opções num objeto próprio, porque o gtag guarda a referência.
  // A tag da propriedade de produção (criada pelo Firebase) ainda manda um page_view automático com a URL real, ignorando
  // tudo isto (testado: set, config antes/depois do carregamento, URL trocada durante o carregamento). Por isso o nosso
  // page_view leva `manual: true`, e no Analytics uma regra "Modificar eventos" renomeia o automático para page_view_tag;
  // as chaves sensíveis da query (state, challenge, code…) são encobertas na propriedade. O fragmento (#code&verifier)
  // nunca vai: o gtag não manda fragmento.
  window.gtag("set", { ...base });
  for (const id of ids) window.gtag("config", id, { ...base });
  const s = document.createElement("script"); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids[0])}`; document.head.append(s);
  /** Um evento com `ambiente`; os parâmetros vêm de listas fechadas (nada pessoal). */
  const evento = (nome, params) => { window.gtag("event", nome, { ambiente, ...(params || {}) }); };
  /** Uma visualização de página com a URL limpa (SPA do console chama a cada troca de seção). */
  const pagina = (caminho, params) => { const cam = fixar(caminho); window.gtag("event", "page_view", { ambiente, manual: true, page_location: `${location.origin}${cam}${campanha()}`, page_path: cam, page_title: document.title, ...(params || {}) }); };
  /**
   * O client_id e o session_id do GA4 desta pessoa (os dos cookies _ga), para o servidor mandar a compra paga à mesma
   * visita pelo Measurement Protocol. Não são dados pessoais: são os números aleatórios que o próprio GA4 cria. Até 1,5 s;
   * sem resposta (bloqueador), null.
   */
  const visita = () => new Promise((ok) => {
    const r = { clientId: null, sessionId: null }; let n = 0;
    const fim = setTimeout(() => ok(r), 1500);
    const um = () => { if (++n === 2) { clearTimeout(fim); ok(r); } };
    window.gtag("get", ids[0], "client_id", (v) => { r.clientId = typeof v === "string" ? v : null; um(); });
    window.gtag("get", ids[0], "session_id", (v) => { r.sessionId = v === undefined || v === null ? null : String(v); um(); });
  });
  window.meuBotGa = { pagina, evento, visita, ligado: true, ambiente };
})();
