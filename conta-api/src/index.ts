/**
 * Worker da conta meu-bot. Um Worker, três hosts:
 * - auth.agentesgrok.com: a página de login (static assets em public/) e o /config.js com o projeto Firebase;
 * - console.agentesgrok.com: o console da conta (public/console/, uma página para /account/*), que entra pela página
 *   de login com `esquema=web` e fala com a API só com o token de acesso (sem Firebase nem device no console);
 * - agentesgrok.com: a home ("Baixar para macOS", public/site/), com /download/mac apontando para a release mais nova
 *   no GitHub; www. redireciona para ela;
 * - conta.agentesgrok.com: a API (POST /sessao, POST /token, POST /sessao/sair, GET|PATCH|DELETE /conta, POST /conta/senha,
 *   GET /health; organizações GET|POST /orgs, GET /orgs/:slug/publico (sem login), GET|PATCH|DELETE /orgs/:slug, POST /orgs/:slug/membros, PATCH|DELETE /orgs/:slug/membros/:email;
 *   para admins GET /admin/visao, POST /admin/suporte (o admin-gestao envia o resumo de uma janela de suporte), GET /admin/suporte (só super: console /support-window), PATCH /admin/contas/:id/licenca, POST|PUT /admin/contas/:id/senha, POST /admin/pedidos/:id/atender, PUT|DELETE /admin/perfis/:email, PATCH /admin/orgs/:slug).
 * Em staging, *-staging. com D1 próprio. Tudo que chega é dado: as rotas validam campo a campo.
 */
import type { Env } from "./tipos.js";
import { autenticar, cors, json } from "./http.js";
import { postSair, postSessao, postSessaoConsole } from "./rotas/sessao.js";
import { postToken } from "./rotas/token.js";
import { deleteConta, getConta, patchConta, postSenha } from "./rotas/conta.js";
import { getSuporteResumos, postSuporteResumo } from "./rotas/suporte.js";
import { deletePerfil, getAdminFirebase, getAdminVisao, patchLicenca, postAdminSenha, postAtenderPedido, putAdminSenha, putPerfil } from "./rotas/admin.js";
import { downloadMac, REPO } from "./release-github.js";
import { GUIAS, lerReleases, novidadesHtml, sitemapXml } from "./novidades-core.js";
import { CSP_GA, gaIds } from "./analytics-core.js";
import { ehAliasDoSite, paraHttps, semBarraFinal } from "./site-core.js";
import { deleteMembro, deleteOrg, getOrg, getOrgPublico, getOrgs, patchAdminOrg, patchMembro, patchOrg, postMembro, postOrg } from "./rotas/orgs.js";

const SEGURANCA: Record<string, string> = {
  // HSTS: um ano, só este host (auth., console. e conta. passam por aqui e ganham o seu). Sem includeSubDomains de
  // propósito: os subdomínios do `publicar` e as máquinas não são deste Worker.
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/**
 * Google Analytics: GA_ID (lista de IDs) vai no /config.js de cada host como `ga`, e a CSP de cada host libera a tag do
 * Google (gtag.js) e os destinos dos dados só quando há ID. Sem GA_ID, nada muda nas três páginas.
 */
const gaDoEnv = (env: Env): string => gaIds(env.GA_ID).join(",");
const extraGa = (env: Env): { script: string; connect: string; img: string } => (gaIds(env.GA_ID).length > 0 ? { script: ` ${CSP_GA.script}`, connect: ` ${CSP_GA.connect}`, img: ` ${CSP_GA.img}` } : { script: "", connect: "", img: "" });
/** A página de login precisa do SDK do Firebase (gstatic) e de falar com o Firebase Auth e com a API da conta. */
const cspDaPagina = (env: Env): string => [
  "default-src 'self'",
  `script-src 'self' https://www.gstatic.com https://apis.google.com${extraGa(env).script}`,
  `connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://apis.google.com ${env.API_ORIGIN}${extraGa(env).connect}`,
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
  "img-src 'self' data: https:",
  "style-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function comCabecalhos(res: Response, extra: Record<string, string>): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries({ ...SEGURANCA, ...extra })) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

const configJs = (cfg: Record<string, string>): Response =>
  new Response(`window.MEU_BOT_CONTA = ${JSON.stringify(cfg)};\n`, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } });

/**
 * O handler do Firebase Auth no NOSSO domínio: `/__/auth/*` é repassado a `<projeto>.firebaseapp.com`. Sem isso, o
 * popup do Google termina em firebaseapp.com e tenta avisar a página pelo armazenamento desse domínio, que Brave e
 * Safari isolam como terceiro: a janela fica parada no handler. Com `authDomain` = este host, tudo é primeira parte.
 */
async function handlerFirebase(req: Request, env: Env, url: URL): Promise<Response> {
  const destino = new URL(`https://${env.FIREBASE_PROJECT_ID}.firebaseapp.com${url.pathname}${url.search}`);
  const h = new Headers(req.headers);
  h.delete("host"); h.delete("cookie");
  const r = await fetch(new Request(destino.toString(), { method: req.method, headers: h, body: req.method === "GET" || req.method === "HEAD" ? null : req.body, redirect: "manual" }));
  const saida = new Headers(r.headers);
  saida.delete("content-security-policy"); saida.delete("set-cookie");
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: saida });
}

async function pagina(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname.startsWith("/__/auth/") || url.pathname.startsWith("/__/firebase/")) return handlerFirebase(req, env, url);
  // A raiz do host de login não é uma página: quem chega aqui à mão vai para o console da conta.
  if (url.pathname === "/" || url.pathname === "/index.html") return comCabecalhos(Response.redirect(`${env.CONSOLE_ORIGIN}/account/overview`, 302), {});
  if (url.pathname === "/robots.txt") return comCabecalhos(robotsFechado(), {});
  if (url.pathname === "/config.js") return comCabecalhos(configJs({ apiKey: env.FIREBASE_API_KEY, authDomain: env.FIREBASE_AUTH_DOMAIN, projectId: env.FIREBASE_PROJECT_ID, api: env.API_ORIGIN, canal: env.CANAL, console: env.CONSOLE_ORIGIN, site: env.SITE_ORIGIN, ga: gaDoEnv(env) }), {});
  // /enterprise e /enterprise/<slug> (como o Rambox; /org/<slug> é apelido): a mesma página de login; sem slug ela
  // pergunta o endereço da organização, com slug mostra o cabeçalho dela (o JS lê o caminho).
  const alvo = /^\/(?:enterprise|org)(?:\/[a-z0-9-]{1,40})?\/?$/.test(url.pathname) ? new Request(new URL("/entrar", url.origin).toString(), req) : req;
  const res = await env.ASSETS.fetch(alvo);
  return comCabecalhos(res, { "content-security-policy": cspDaPagina(env) });
}

/** O console não carrega Firebase: só o próprio JS e a API. */
const cspDoConsole = (env: Env): string => ["default-src 'self'", `script-src 'self'${extraGa(env).script}`, `connect-src 'self' ${env.API_ORIGIN}${extraGa(env).connect}`, "img-src 'self' data: https:", "style-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");
/**
 * O console é uma página só: /account/*, /organizations/*, /enterprise/<slug> e qualquer outro caminho servem o
 * index.html (o JS escolhe a seção pelo caminho e manda o desconhecido para a visão geral); só o que tem extensão
 * de arquivo é asset de public/console/. Antes, um caminho desconhecido era um 404 vazio, que o navegador mostra
 * como página de erro.
 */
async function consolePagina(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/robots.txt") return comCabecalhos(robotsFechado(), {});
  if (url.pathname === "/config.js") return comCabecalhos(configJs({ api: env.API_ORIGIN, auth: env.AUTH_ORIGIN, console: env.CONSOLE_ORIGIN, site: env.SITE_ORIGIN, canal: env.CANAL, ga: gaDoEnv(env) }), {});
  const caminho = /\.[a-z0-9]{1,8}$/i.test(url.pathname) && !url.pathname.endsWith(".html") ? url.pathname : "/console/index.html";
  const res = await env.ASSETS.fetch(new Request(new URL(caminho, url.origin).toString(), { method: "GET", headers: req.headers }));
  // Tudo sem cache: o console muda junto com a API, e um JS velho de 5 min já mostrou tela errada depois de um deploy.
  return comCabecalhos(res, { "content-security-policy": cspDoConsole(env), "cache-control": "no-store" });
}

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.method === "OPTIONS") return cors(req, env, new Response(null, { status: 204 }));
  const rota = `${req.method} ${url.pathname.replace(/\/+$/, "") || "/"}`;
  let res: Response;
  if (rota === "GET /health") res = json({ ok: true, canal: env.CANAL });
  else if (rota === "POST /sessao") res = await postSessao(req, env);
  else if (/^GET \/orgs\/[a-z0-9-]{1,40}\/publico$/.test(rota)) res = await getOrgPublico(env, rota.split("/")[2]!);
  else if (rota === "POST /token") res = await postToken(req, env);
  else if (rota === "POST /sessao/sair" || rota === "POST /sessao/console" || rota === "GET /conta" || rota === "PATCH /conta" || rota === "DELETE /conta" || rota === "POST /conta/senha" || /^(GET|POST|PATCH|DELETE) \/orgs(\/|$)/.test(rota) || rota.startsWith("GET /admin/") || rota.startsWith("POST /admin/") || rota.startsWith("PATCH /admin/") || rota.startsWith("PUT /admin/") || rota.startsWith("DELETE /admin/")) {
    const auth = await autenticar(req, env);
    const atender = /^POST \/admin\/pedidos\/([A-Za-z0-9-]{1,40})\/atender$/.exec(rota);
    const licenca = /^PATCH \/admin\/contas\/([A-Za-z0-9-]{1,40})\/licenca$/.exec(rota);
    const senhaAdmin = /^(POST|PUT) \/admin\/contas\/([A-Za-z0-9-]{1,40})\/senha$/.exec(rota);
    const firebaseAdmin = /^GET \/admin\/contas\/([A-Za-z0-9-]{1,40})\/firebase$/.exec(rota);
    const perfil = /^(PUT|DELETE) \/admin\/perfis\/([^/]{3,200})$/.exec(rota);
    const org = /^(GET|PATCH|DELETE) \/orgs\/([a-z0-9-]{1,40})$/.exec(rota);
    const membroNovo = /^POST \/orgs\/([a-z0-9-]{1,40})\/membros$/.exec(rota);
    const membro = /^(PATCH|DELETE) \/orgs\/([a-z0-9-]{1,40})\/membros\/([^/]{3,200})$/.exec(rota);
    const adminOrg = /^PATCH \/admin\/orgs\/([a-z0-9-]{1,40})$/.exec(rota);
    if (auth === null) res = json({ erro: "entre de novo" }, 401, { "www-authenticate": "Bearer" });
    else if (rota === "GET /orgs") res = await getOrgs(auth, env);
    else if (rota === "POST /orgs") res = await postOrg(auth, env, req);
    else if (org !== null) res = org[1] === "GET" ? await getOrg(auth, env, org[2]!) : org[1] === "PATCH" ? await patchOrg(auth, env, org[2]!, req) : await deleteOrg(auth, env, org[2]!);
    else if (membroNovo !== null) res = await postMembro(auth, env, membroNovo[1]!, req);
    else if (membro !== null) res = membro[1] === "PATCH" ? await patchMembro(auth, env, membro[2]!, membro[3]!, req) : await deleteMembro(auth, env, membro[2]!, membro[3]!);
    else if (adminOrg !== null) res = await patchAdminOrg(auth, env, adminOrg[1]!, req);
    else if (rota === "GET /conta") res = await getConta(auth, env);
    else if (rota === "PATCH /conta") res = await patchConta(auth, env, req);
    else if (rota === "DELETE /conta") res = await deleteConta(auth, env);
    else if (rota === "POST /conta/senha") res = await postSenha(auth, env);
    else if (rota === "POST /sessao/sair") res = await postSair(auth, env);
    else if (rota === "POST /sessao/console") res = await postSessaoConsole(auth, env, req);
    else if (rota === "GET /admin/visao") res = await getAdminVisao(auth, env, url);
    else if (rota === "POST /admin/suporte") res = await postSuporteResumo(auth, env, req);
    else if (rota === "GET /admin/suporte") res = await getSuporteResumos(auth, env);
    else if (atender !== null) res = await postAtenderPedido(auth, env, atender[1]!);
    else if (licenca !== null) res = await patchLicenca(auth, env, licenca[1]!, req);
    else if (firebaseAdmin !== null) res = await getAdminFirebase(auth, env, firebaseAdmin[1]!);
    else if (senhaAdmin !== null) res = senhaAdmin[1] === "PUT" ? await putAdminSenha(auth, env, senhaAdmin[2]!, req) : await postAdminSenha(auth, env, senhaAdmin[2]!);
    else if (perfil !== null) res = perfil[1] === "PUT" ? await putPerfil(auth, env, perfil[2]!, req) : await deletePerfil(auth, env, perfil[2]!);
    else res = json({ erro: "rota desconhecida" }, 404);
  } else res = json({ erro: "rota desconhecida" }, 404);
  return comCabecalhos(cors(req, env, res), {});
}

/** Login e console não são para indexar: robots.txt fecha tudo nesses hosts (a home tem o dela em public/site/). */
const robotsFechado = (): Response => new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
/** A home: página, "obrigado" (que dispara o download), a versão mais nova em JSON e o redirecionamento ao asset do GitHub. */
const cspDoSite = (env: Env): string => {
  const ga = extraGa(env);
  return [
    "default-src 'self'",
    `script-src 'self'${ga.script}`,
    `connect-src 'self'${ga.connect}`,
    `img-src 'self' data:${ga.img}`,
    "style-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join("; ");
};
/** Data da última revisão das páginas de texto (privacidade, termos, Grok no WhatsApp, parceria, perguntas; vai no sitemap). */
const REVISAO_PAGINAS = "2026-11-12";
/** As releases estáveis do GitHub para /novidades (mesmo cache de 10 min do download). [] = GitHub fora ou sem release. */
async function listarReleases(): Promise<ReturnType<typeof lerReleases>> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { accept: "application/vnd.github+json", "user-agent": "meu-bot-site (conta-api)" }, cf: { cacheTtl: 600, cacheEverything: true } });
    return r.ok ? lerReleases(await r.json()) : [];
  } catch { return []; }
}
async function sitePagina(req: Request, env: Env, url: URL): Promise<Response> {
  // "/baixar/" e afins: 301 para o caminho sem a barra (a versão que está no sitemap e nos canonicals), com a query.
  const sem = semBarraFinal(url.pathname);
  if (sem !== null) return comCabecalhos(Response.redirect(`${env.SITE_ORIGIN}${sem}${url.search}`, 301), {});
  if (url.pathname === "/config.js") return comCabecalhos(configJs({ console: env.CONSOLE_ORIGIN, canal: env.CANAL, ga: gaDoEnv(env) }), {});
  // "Console da conta" e "Não tem uma conta?" na home: sem depender de JS, o site manda ao console do ambiente certo.
  if (url.pathname === "/console" || url.pathname.startsWith("/account")) return comCabecalhos(Response.redirect(`${env.CONSOLE_ORIGIN}${url.pathname.startsWith("/account") ? url.pathname : "/account/overview"}`, 302), { "cache-control": "no-store" });
  if (url.pathname === "/download/mac" || url.pathname === "/download/mac.json") {
    const d = await downloadMac(fetch, env.CANAL === "staging" ? "staging" : "producao");
    if (url.pathname.endsWith(".json")) return comCabecalhos(json(d ?? { erro: "release não encontrada" }, d === null ? 503 : 200, { "cache-control": "public, max-age=300" }), {});
    return comCabecalhos(Response.redirect(d?.url ?? `https://github.com/${REPO}/releases/latest`, 302), { "cache-control": "no-store" });
  }
  // /sitemap.xml é montado aqui: a home e /novidades levam a data da release mais nova; privacidade e termos, a da revisão.
  if (url.pathname === "/sitemap.xml") {
    const d = await downloadMac();
    return comCabecalhos(new Response(sitemapXml(env.SITE_ORIGIN, d?.publicadoEm ?? null, REVISAO_PAGINAS), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } }), {});
  }
  // /novidades: as releases estáveis do GitHub (cache de 10 min no edge) dentro de public/site/novidades.html.
  if (url.pathname === "/novidades") {
    const [modelo, releases] = await Promise.all([env.ASSETS.fetch(new Request(new URL("/site/novidades.html", url.origin).toString())).then((r) => r.text()), listarReleases()]);
    return comCabecalhos(new Response(modelo.replace("<!--RELEASES-->", novidadesHtml(releases)), { headers: { "content-type": "text/html; charset=utf-8" } }), { "content-security-policy": cspDoSite(env), "cache-control": "no-store" });
  }
  // robots.txt e llms.txt vivem em public/site/ e saem na raiz do host; privacidade e termos também.
  const raiz: Record<string, string> = { "/robots.txt": "/site/robots.txt", "/llms.txt": "/site/llms.txt", "/privacidade": "/site/privacidade.html", "/termos": "/site/termos.html", "/grok-no-whatsapp": "/site/grok-no-whatsapp.html", "/parceria-xai": "/site/parceria-xai.html", "/baixar": "/site/baixar.html", "/perguntas": "/site/perguntas.html", "/grok-bot-e-meu-bot": "/site/grok-bot-e-meu-bot.html", "/guias": "/site/guias/index.html" };
  // Guias: só os da lista GUIAS (o resto cai na 404 do site).
  const guia = /^\/guias\/([a-z0-9-]+)$/.exec(url.pathname)?.[1];
  if (guia && (GUIAS as readonly string[]).includes(guia)) raiz[url.pathname] = `/site/guias/${guia}.html`;
  const caminho = url.pathname === "/" || url.pathname === "/index.html" ? "/site/index.html" : url.pathname === "/obrigado" ? "/site/obrigado.html" : raiz[url.pathname] ?? url.pathname;
  let res = await env.ASSETS.fetch(new Request(new URL(caminho, url.origin).toString(), { method: "GET", headers: req.headers }));
  // Caminho que não existe: a página 404 do site (com status 404), em vez do corpo vazio dos assets.
  if (res.status === 404 && !url.pathname.startsWith("/site/")) res = new Response((await env.ASSETS.fetch(new Request(new URL("/site/404.html", url.origin).toString()))).body, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  // A home é um HTML só para os dois canais, mas cada host entrega só a sua parte: em produção os blocos do ensaio
  // (data-canal="staging" e a faixa) saem do HTML, porque o Google lê o que está escondido; em staging saem os de produção.
  if (caminho === "/site/index.html") res = porCanal(res, env.CANAL === "staging" ? "staging" : "producao");
  // Sempre revalida (no-cache + ETag dos assets): o site muda junto com o Worker, e um CSS velho de 5 min já mostrou a
  // página quebrada; no-store desligava também o voltar/avançar instantâneo do navegador.
  // Staging é a mesma home em revisão: fora do Google, para não competir com agentesgrok.com.
  const robos = env.CANAL === "staging" ? { "x-robots-tag": "noindex, nofollow" } : {};
  return comCabecalhos(res, { "content-security-policy": cspDoSite(env), "cache-control": "no-cache", ...robos });
}
/** Tira do HTML os blocos do outro canal e, em staging, mostra os do ensaio e a faixa (o site.js faz o mesmo, mas o Google não roda JS). */
function porCanal(res: Response, canal: "staging" | "producao"): Response {
  const outro = canal === "staging" ? "producao" : "staging";
  const rw = new HTMLRewriter().on(`[data-canal="${outro}"]`, { element(e) { e.remove(); } });
  if (canal === "staging") rw.on(`[data-canal="staging"], #rascunho`, { element(e) { e.removeAttribute("hidden"); } });
  else rw.on("#rascunho", { element(e) { e.remove(); } });
  return rw.transform(res);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origem = `https://${url.host}`;
    try {
      // http:// chega aqui com o conteúdo inteiro (o Worker atende os dois): vira 301 para o https antes de qualquer rota.
      const seguro = paraHttps(req.url);
      if (seguro !== null) return comCabecalhos(Response.redirect(seguro, 301), {});
      if (origem === env.SITE_ORIGIN) return await sitePagina(req, env, url);
      // www. e o .com.br (com e sem www) só redirecionam para o site principal, com o caminho e a query (utm, gclid).
      if (ehAliasDoSite(url.host, env.SITE_ORIGIN)) return comCabecalhos(Response.redirect(`${env.SITE_ORIGIN}${url.pathname}${url.search}`, 301), {});
      return origem === env.AUTH_ORIGIN ? await pagina(req, env, url) : origem === env.CONSOLE_ORIGIN ? await consolePagina(req, env, url) : await api(req, env, url);
    } catch (e) {
      console.log(`[conta-api] ${req.method} ${url.pathname}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      return comCabecalhos(json({ erro: "falha interna; tente de novo" }, 500), {});
    }
  },
} satisfies ExportedHandler<Env>;
