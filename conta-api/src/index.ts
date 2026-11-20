/**
 * Worker da conta meu-bot. Um Worker, três hosts:
 * - auth.agentesgrok.com: a página de login (static assets em public/) e o /config.js com o projeto Firebase;
 * - console.agentesgrok.com: o console da conta (public/console/, uma página para /account/*), que entra pela página
 *   de login com `esquema=web` e fala com a API só com o token de acesso (sem Firebase nem device no console);
 * - agentesgrok.com: a home ("Baixar para macOS", public/site/), com /download/mac apontando para a release mais nova
 *   no GitHub; www. redireciona para ela;
 * - conta.agentesgrok.com: a API (POST /sessao, POST /token, POST /sessao/sair, GET|PATCH|DELETE /conta, POST /conta/senha,
 *   GET /health; organizações GET|POST /orgs, GET /orgs/:slug/publico (sem login), GET|PATCH|DELETE /orgs/:slug, POST /orgs/:slug/membros, PATCH|DELETE /orgs/:slug/membros/:email;
 *   para admins GET /admin/visao, GET /admin/conta (uma conta, pela máquina, id ou e-mail: a página Suporte do admin-gestao), POST /admin/suporte (o admin-gestao envia o resumo de uma janela de suporte), GET /admin/suporte (só super: console /support-window), GET /admin/auditoria (só super: contas apagadas, vendas ocultadas e o registro de ações), POST /admin/vendas/(assinaturas|pagamentos)/:id/(ocultar|mostrar) (só super: tira da tela Assinaturas ou traz de volta), PATCH /admin/contas/:id/licenca, DELETE /admin/contas/:id (só super: apaga a conta), POST /admin/contas/:id/(pro|addons/:produto|extras/:assinatura)/encerrar {motivo, detalhe}, POST /admin/contas/:id/cortesias, POST /admin/contas/:id/cortesias/:c/(renovar|encerrar), POST /admin/contas/:id/devices/:device/liberar, DELETE /admin/contas/:id/devices/:device, POST|PUT /admin/contas/:id/senha, POST /admin/pedidos/:id/atender, PUT|DELETE /admin/perfis/:email, PATCH /admin/orgs/:slug).
 * Código por visita (rotas/leads.ts): POST /lead-ref no host do site (sem login) e, na API, GET /leads/:codigo e
 * POST /leads/:codigo/qualificar (Bearer LEADS_TOKEN, sem login de conta).
 * Assinatura do Pro pela AbacatePay: POST /conta/assinatura (logado, devolve a url do pagamento), POST
 * /conta/assinatura/cancelar (logado, cancela a própria) e o webhook
 * POST /pagamentos/abacatepay (src/rotas/pagamentos.ts); desligados sem os secrets ABACATEPAY_*.
 * Em staging, *-staging. com D1 próprio. Tudo que chega é dado: as rotas validam campo a campo.
 */
import type { Env } from "./tipos.js";
import { autenticar, cors, json } from "./http.js";
import { postSair, postSessao, postSessaoConsole } from "./rotas/sessao.js";
import { postToken } from "./rotas/token.js";
import { deletePasskey, getPasskeys, passkeyLigada, postLoginOpcoes, postLoginPasskey, postPasskey, postPasskeyOpcoes } from "./rotas/passkeys.js";
import { postEncerrarAddon, postEncerrarExtra, postEncerrarPro } from "./rotas/encerrar.js";
import { postCortesia, postEncerrarCortesia, postRenovarCortesia } from "./rotas/cortesias.js";
import { deleteConta, getConta, patchConta, postSenha } from "./rotas/conta.js";
import { getSuporteResumos, postSuporteResumo } from "./rotas/suporte.js";
import { deleteAdminConta, deleteDevice, deletePerfil, getAdminAuditoria, postVendaOculta, postZerarAuditoria, getAdminConta, getAdminFirebase, getAdminVisao, patchLicenca, postAdminSenha, postAtenderPedido,  postLiberarDevice, putAdminSenha, putPerfil, postAtribuirMaquina, deleteAtribuirMaquina } from "./rotas/admin.js";
import { downloadMac, downloadWindows, REPO } from "./release-github.js";
import { GUIAS, lerReleases, novidadesHtml, sitemapXml } from "./novidades-core.js";
import { CSP_ADS, CSP_GA, gaIds } from "./analytics-core.js";
import { caminhoCanonico, llmsPorPagamentos, paginaDaPromoDesligada, redirecionamentoInicial, paginaForaDoAr } from "./site-core.js";
import { postListaEspera } from "./rotas/lista.js";
import { postLeadRef, rotaLeads } from "./rotas/leads.js";
import { deleteDeviceDaConta } from "./rotas/devices.js";
import { deleteMaquina, deleteMaquinaVista, postMaquina, postMaquinaVista, postRenovarLicenca } from "./rotas/maquinas.js";
import { marketplaceDoEnv, addonsAVenda, extrasAVenda, pagamentosLigados, cupomPixLigado, deleteAdminAssinatura, postAssinatura, postCancelarAssinatura, postWebhookAbacate, promoLigada } from "./rotas/pagamentos.js";
import { itemPorSlug } from "./marketplace-core.js";
import { REVISAO_MARKETPLACE, llmsDoMarketplace, paginaDoMarketplace } from "./marketplace-pagina.js";
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
  if (url.pathname === "/config.js") return comCabecalhos(configJs({ apiKey: env.FIREBASE_API_KEY, authDomain: env.FIREBASE_AUTH_DOMAIN, projectId: env.FIREBASE_PROJECT_ID, api: env.API_ORIGIN, canal: env.CANAL, console: env.CONSOLE_ORIGIN, site: env.SITE_ORIGIN, ga: gaDoEnv(env), passkey: passkeyLigada(env) ? "1" : "" }), {});
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
  if (url.pathname === "/config.js") return comCabecalhos(configJs({ api: env.API_ORIGIN, auth: env.AUTH_ORIGIN, console: env.CONSOLE_ORIGIN, site: env.SITE_ORIGIN, canal: env.CANAL, ga: gaDoEnv(env), passkey: passkeyLigada(env) ? "1" : "", pagamentos: pagamentosLigados(env) ? "1" : "", cupomPix: cupomPixLigado(env) ? "1" : "", addons: JSON.stringify(addonsAVenda(env).map((a) => ({ nome: a.nome, rotulo: a.rotulo, centavos: a.centavos }))), extras: JSON.stringify(extrasAVenda(env).map((x) => ({ tipo: x.tipo, nome: x.nome, rotulo: x.rotulo, centavos: x.centavos, ...(x.deCentavos === undefined ? {} : { deCentavos: x.deCentavos }) }))), marketplace: JSON.stringify(marketplaceDoEnv(env)) }), {});
  const caminho = /\.[a-z0-9]{1,8}$/i.test(url.pathname) && !url.pathname.endsWith(".html") ? url.pathname : "/console/index.html";
  const res = await env.ASSETS.fetch(new Request(new URL(caminho, url.origin).toString(), { method: "GET", headers: req.headers }));
  // Tudo sem cache: o console muda junto com a API, e um JS velho de 5 min já mostrou tela errada depois de um deploy.
  return comCabecalhos(res, { "content-security-policy": cspDoConsole(env), "cache-control": "no-store" });
}

async function api(req: Request, env: Env, url: URL, espera: (p: Promise<unknown>) => void): Promise<Response> {
  if (req.method === "OPTIONS") return cors(req, env, new Response(null, { status: 204 }));
  const rota = `${req.method} ${url.pathname.replace(/\/+$/, "") || "/"}`;
  let res: Response;
  // `commit`: o sha que o scripts/site-publicar.mjs passou no deploy (--var COMMIT:<sha>); null = deploy antigo ou à mão.
  if (rota === "GET /health") res = json({ ok: true, canal: env.CANAL, commit: /^[0-9a-f]{40}$/.test(env.COMMIT ?? "") ? env.COMMIT : null });
  else if (rota === "POST /sessao") res = await postSessao(req, env);
  else if (rota === "POST /sessao/passkey/opcoes") res = await postLoginOpcoes(req, env);
  else if (rota === "POST /sessao/passkey") res = await postLoginPasskey(req, env);
  else if (/^GET \/orgs\/[a-z0-9-]{1,40}\/publico$/.test(rota)) res = await getOrgPublico(env, rota.split("/")[2]!);
  else if (rota === "POST /token") res = await postToken(req, env);
  // Leads do site: sem login de conta (prova quem chama pelo LEADS_TOKEN) e sem CORS.
  else if (rota.startsWith("GET /leads/") || rota.startsWith("POST /leads/")) return comCabecalhos((await rotaLeads(rota, req, env)) ?? json({ erro: "rota desconhecida" }, 404), {});
  // Webhook da AbacatePay: sem login (prova a origem pelo secret e o corpo pela assinatura) e sem CORS.
  else if (rota === "POST /pagamentos/abacatepay") return comCabecalhos(await postWebhookAbacate(req, env, url, espera), {});
  else if (rota === "POST /sessao/sair" || rota === "POST /sessao/console" || rota === "GET /conta/passkeys" || rota === "POST /conta/passkeys" || rota === "POST /conta/passkeys/opcoes" || /^DELETE \/conta\/passkeys\/[A-Za-z0-9_-]{1,1400}$/.test(rota) || rota === "GET /conta" || rota === "PATCH /conta" || rota === "DELETE /conta" || rota === "POST /conta/senha" || rota === "POST /conta/assinatura" || rota === "POST /conta/assinatura/cancelar" || /^(POST|DELETE) \/conta\/maquinas(\/|$)/.test(rota) || /^DELETE \/conta\/devices\//.test(rota) || /^(GET|POST|PATCH|DELETE) \/orgs(\/|$)/.test(rota) || rota.startsWith("GET /admin/") || rota.startsWith("POST /admin/") || rota.startsWith("PATCH /admin/") || rota.startsWith("PUT /admin/") || rota.startsWith("DELETE /admin/")) {
    const auth = await autenticar(req, env);
    const atender = /^POST \/admin\/pedidos\/([A-Za-z0-9-]{1,40})\/atender$/.exec(rota);
    const licenca = /^PATCH \/admin\/contas\/([A-Za-z0-9-]{1,40})\/licenca$/.exec(rota);
    const encerrarAddon = /^POST \/admin\/contas\/([A-Za-z0-9-]{1,40})\/addons\/([a-z0-9-]{1,40})\/encerrar$/.exec(rota);
    const cortesiaNova = /^POST \/admin\/contas\/([A-Za-z0-9-]{1,40})\/cortesias$/.exec(rota);
    const cortesiaAcao = /^POST \/admin\/contas\/([A-Za-z0-9-]{1,40})\/cortesias\/([A-Za-z0-9-]{1,40})\/(renovar|encerrar)$/.exec(rota);
    const encerrarPro = /^POST \/admin\/contas\/([A-Za-z0-9-]{1,40})\/pro\/encerrar$/.exec(rota);
    const encerrarExtra = /^POST \/admin\/contas\/([A-Za-z0-9-]{1,40})\/extras\/(subs_[A-Za-z0-9_-]{1,90})\/encerrar$/.exec(rota);
    const liberarDevice = /^POST \/admin\/contas\/([A-Za-z0-9-]{1,40})\/devices\/([a-f0-9-]{12,36})\/liberar$/.exec(rota);
    const removerDevice = /^DELETE \/admin\/contas\/([A-Za-z0-9-]{1,40})\/devices\/([a-f0-9-]{12,36})$/.exec(rota);
    const apagarContaAdmin = /^DELETE \/admin\/contas\/([A-Za-z0-9-]{1,40})$/.exec(rota);
    const removerVenda = /^DELETE \/admin\/vendas\/assinaturas\/([A-Za-z0-9_-]{1,100})$/.exec(rota);
    const vendaOculta = /^POST \/admin\/vendas\/(assinaturas|pagamentos)\/([A-Za-z0-9_-]{1,80})\/(ocultar|mostrar)$/.exec(rota);
    const senhaAdmin = /^(POST|PUT) \/admin\/contas\/([A-Za-z0-9-]{1,40})\/senha$/.exec(rota);
    const firebaseAdmin = /^GET \/admin\/contas\/([A-Za-z0-9-]{1,40})\/firebase$/.exec(rota);
    const renovarLicenca = /^POST \/conta\/maquinas\/([a-f0-9-]{36})\/licenca$/.exec(rota);
    const tirarMaquina = /^DELETE \/conta\/maquinas\/([a-f0-9-]{36})$/.exec(rota);
    const tirarPasskey = /^DELETE \/conta\/passkeys\/([A-Za-z0-9_-]{1,1400})$/.exec(rota);
    const tirarDevice = /^DELETE \/conta\/devices\/([a-f0-9-]{12,36})$/.exec(rota);
    const atribuirMaquina = /^(POST|DELETE) \/admin\/maquinas\/([a-f0-9-]{36})\/conta$/.exec(rota);
    const maquinaVista = /^(POST|DELETE) \/conta\/maquinas\/([a-f0-9-]{36})\/visto$/.exec(rota);
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
    else if (rota === "POST /conta/assinatura") res = await postAssinatura(auth, env, req);
    else if (rota === "POST /conta/assinatura/cancelar") res = await postCancelarAssinatura(auth, env, req);
    else if (rota === "POST /conta/maquinas") res = await postMaquina(auth, env, req);
    else if (renovarLicenca !== null) res = await postRenovarLicenca(auth, env, renovarLicenca[1]!);
    else if (tirarMaquina !== null) res = await deleteMaquina(auth, env, tirarMaquina[1]!, req);
    else if (tirarDevice !== null) res = await deleteDeviceDaConta(auth, env, tirarDevice[1]!);
    else if (maquinaVista !== null) res = maquinaVista[1] === "POST" ? await postMaquinaVista(auth, env, maquinaVista[2]!, req) : await deleteMaquinaVista(auth, env, maquinaVista[2]!);
    else if (rota === "GET /conta/passkeys") res = await getPasskeys(auth, env);
    else if (rota === "POST /conta/passkeys/opcoes") res = await postPasskeyOpcoes(auth, env);
    else if (rota === "POST /conta/passkeys") res = await postPasskey(auth, env, req);
    else if (tirarPasskey !== null) res = await deletePasskey(auth, env, tirarPasskey[1]!);
    else if (rota === "POST /sessao/sair") res = await postSair(auth, env);
    else if (rota === "POST /sessao/console") res = await postSessaoConsole(auth, env, req);
    else if (rota === "GET /admin/visao") res = await getAdminVisao(auth, env, url);
    else if (rota === "GET /admin/conta") res = await getAdminConta(auth, env, url);
    else if (atribuirMaquina !== null) res = atribuirMaquina[1] === "POST" ? await postAtribuirMaquina(auth, env, atribuirMaquina[2]!, req) : await deleteAtribuirMaquina(auth, env, atribuirMaquina[2]!, req);
    else if (rota === "POST /admin/suporte") res = await postSuporteResumo(auth, env, req);
    else if (removerVenda !== null) res = await deleteAdminAssinatura(auth, env, removerVenda[1]!);
    else if (vendaOculta !== null) res = await postVendaOculta(auth, env, vendaOculta[1] === "assinaturas" ? "assinaturas" : "pagamentos", vendaOculta[2]!, vendaOculta[3] === "ocultar");
    else if (rota === "GET /admin/auditoria") res = await getAdminAuditoria(auth, env);
    else if (rota === "POST /admin/auditoria/zerar") res = await postZerarAuditoria(auth, env);
    else if (rota === "GET /admin/suporte") res = await getSuporteResumos(auth, env);
    else if (atender !== null) res = await postAtenderPedido(auth, env, atender[1]!);
    else if (licenca !== null) res = await patchLicenca(auth, env, licenca[1]!, req);
    else if (encerrarAddon !== null) res = await postEncerrarAddon(auth, env, encerrarAddon[1]!, encerrarAddon[2]!, req);
    else if (cortesiaNova !== null) res = await postCortesia(auth, env, cortesiaNova[1]!, req);
    else if (cortesiaAcao !== null) res = cortesiaAcao[3] === "renovar" ? await postRenovarCortesia(auth, env, cortesiaAcao[1]!, cortesiaAcao[2]!, req) : await postEncerrarCortesia(auth, env, cortesiaAcao[1]!, cortesiaAcao[2]!, req);
    else if (encerrarPro !== null) res = await postEncerrarPro(auth, env, encerrarPro[1]!, req);
    else if (encerrarExtra !== null) res = await postEncerrarExtra(auth, env, encerrarExtra[1]!, encerrarExtra[2]!, req);
    else if (liberarDevice !== null) res = await postLiberarDevice(auth, env, liberarDevice[1]!, liberarDevice[2]!, req);
    else if (removerDevice !== null) res = await deleteDevice(auth, env, removerDevice[1]!, removerDevice[2]!);
    else if (apagarContaAdmin !== null) res = await deleteAdminConta(auth, env, apagarContaAdmin[1]!);
    else if (firebaseAdmin !== null) res = await getAdminFirebase(auth, env, firebaseAdmin[1]!);
    else if (senhaAdmin !== null) res = senhaAdmin[1] === "PUT" ? await putAdminSenha(auth, env, senhaAdmin[2]!, req) : await postAdminSenha(auth, env, senhaAdmin[2]!);
    else if (perfil !== null) res = perfil[1] === "PUT" ? await putPerfil(auth, env, perfil[2]!, req) : await deletePerfil(auth, env, perfil[2]!);
    else res = json({ erro: "rota desconhecida" }, 404);
  } else res = json({ erro: "rota desconhecida" }, 404);
  return comCabecalhos(cors(req, env, res), {});
}

/**
 * Login e console não são para indexar. Quem tira os dois do Google é o cabeçalho `X-Robots-Tag: noindex` (`semIndice`),
 * e o robots.txt desses hosts deixa visitar: com `Disallow: /` o Google não lia o noindex e mantinha no índice o
 * endereço que o site linka (console/account/overview), como "Indexada, mas bloqueada pelo robots.txt" (14/11/2026).
 */
const semIndice = (res: Response): Response => { const h = new Headers(res.headers); h.set("x-robots-tag", "noindex"); return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h }); };
const robotsFechado = (): Response => new Response("# Fora do índice pelo cabeçalho X-Robots-Tag: noindex de cada resposta. Sem Disallow: o Google só lê o noindex\n# de quem pode visitar, e bloqueado aqui o endereço ficava \"indexado, mas bloqueado pelo robots.txt\".\nUser-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
/** A home: página, "obrigado" (que dispara o download), a versão mais nova em JSON e o redirecionamento ao asset do GitHub. */
const cspDoSite = (env: Env): string => {
  const ga = extraGa(env);
  // A medição de conversão do Google Ads entra junto com o Analytics (sem GA_ID, nada): só conversão, sem remarketing.
  const ads = ga.script === "" ? "" : ` ${CSP_ADS}`;
  return [
    "default-src 'self'",
    // static.cloudflareinsights.com: o beacon do Web Analytics que a Cloudflare injeta no site (era bloqueado pela CSP).
    `script-src 'self'${ga.script} https://static.cloudflareinsights.com`,
    `connect-src 'self'${ga.connect}${ads} https://cloudflareinsights.com`,
    `img-src 'self' data:${ga.img}${ads}`,
    "style-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join("; ");
};
/** As releases estáveis do GitHub para /novidades (mesmo cache de 10 min do download). [] = GitHub fora ou sem release. */
async function listarReleases(): Promise<ReturnType<typeof lerReleases>> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { accept: "application/vnd.github+json", "user-agent": "meu-bot-site (conta-api)" }, cf: { cacheTtl: 600, cacheEverything: true } });
    return r.ok ? lerReleases(await r.json()) : [];
  } catch { return []; }
}
async function sitePagina(req: Request, env: Env, url: URL): Promise<Response> {
  // "/baixar/" e afins, e "/index.html": 301 para o caminho canônico (o do sitemap e dos canonicals), com a query.
  const sem = caminhoCanonico(url.pathname);
  if (sem !== null) return comCabecalhos(Response.redirect(`${env.SITE_ORIGIN}${sem}${url.search}`, 301), {});
  if (url.pathname === "/config.js") return comCabecalhos(configJs({ console: env.CONSOLE_ORIGIN, canal: env.CANAL, ga: gaDoEnv(env) }), {});
  // Lista de espera (hoje: quem chega de Windows): o único POST do site, na mesma origem das páginas.
  // Código por visita: o clique num botão de WhatsApp grava o código que vai na mensagem pronta.
  if (url.pathname === "/lead-ref") return comCabecalhos(req.method === "POST" ? await postLeadRef(req, env) : json({ erro: "use POST" }, 405), { "cache-control": "no-store" });
  if (url.pathname === "/lista-espera") return comCabecalhos(req.method === "POST" ? await postListaEspera(req, env) : json({ erro: "use POST" }, 405), { "cache-control": "no-store" });
  // "Console da conta" e "Não tem uma conta?" na home: sem depender de JS, o site manda ao console do ambiente certo.
  if (url.pathname === "/console" || url.pathname.startsWith("/account")) return comCabecalhos(Response.redirect(`${env.CONSOLE_ORIGIN}${url.pathname.startsWith("/account") ? url.pathname : "/account/overview"}`, 302), { "cache-control": "no-store" });
  if (url.pathname === "/download/mac" || url.pathname === "/download/mac.json") {
    const d = await downloadMac(fetch, env.CANAL === "staging" ? "staging" : "producao");
    if (url.pathname.endsWith(".json")) return comCabecalhos(json(d ?? { erro: "release não encontrada" }, d === null ? 503 : 200, { "cache-control": "public, max-age=300" }), {});
    return comCabecalhos(Response.redirect(d?.url ?? `https://github.com/${REPO}/releases/latest`, 302), { "cache-control": "no-store" });
  }
  // Windows: a versão de teste (instalador do meu-bot-staging, ainda sem assinatura da Microsoft) sai nos dois sites
  // desde 17 nov 2026, a pedido do dono; a página diz que é teste e não entra no sitemap nem nos botões da home.
  if ((url.pathname === "/download/windows" || url.pathname === "/download/windows.json")) {
    const d = await downloadWindows();
    if (url.pathname.endsWith(".json")) return comCabecalhos(json(d ?? { erro: "nenhuma versão de teste trouxe o instalador do Windows ainda" }, d === null ? 503 : 200, { "cache-control": "public, max-age=300" }), {});
    return comCabecalhos(Response.redirect(d?.url ?? `https://github.com/${REPO}/releases`, 302), { "cache-control": "no-store" });
  }
  // /sitemap.xml é montado aqui: a home, /baixar e /novidades levam a data da release mais nova; as outras, a de REVISAO_PAGINAS.
  if (url.pathname === "/sitemap.xml") {
    const d = await downloadMac();
    return comCabecalhos(new Response(sitemapXml(env.SITE_ORIGIN, d?.publicadoEm ?? null, undefined, { slugs: marketplaceDoEnv(env).map((i) => i.slug), revisao: REVISAO_MARKETPLACE }), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } }), {});
  }
  // /novidades: as releases estáveis do GitHub (cache de 10 min no edge) dentro de public/site/novidades.html.
  if (url.pathname === "/novidades") {
    const [modelo, releases] = await Promise.all([env.ASSETS.fetch(new Request(new URL("/site/novidades.html", url.origin).toString())).then((r) => r.text()), listarReleases()]);
    return comCabecalhos(new Response(modelo.replace("<!--RELEASES-->", novidadesHtml(releases)), { headers: { "content-type": "text/html; charset=utf-8" } }), { "content-security-policy": cspDoSite(env), "cache-control": "no-store" });
  }
  // Marketplace público: a lista e uma página por item à venda neste ambiente, montadas de public/site/marketplace.html
  // e das fichas (marketplace-pagina.ts). Sem nada à venda, ou slug fora do catálogo: segue para a 404 do site.
  const mk = /^\/marketplace(?:\/([a-z0-9-]{1,60}))?$/.exec(url.pathname);
  if (mk !== null) {
    const itens = marketplaceDoEnv(env);
    const item = mk[1] === undefined ? null : itemPorSlug(itens, mk[1]);
    if (itens.length > 0 && (mk[1] === undefined || item !== null)) {
      const modelo = await env.ASSETS.fetch(new Request(new URL("/site/marketplace.html", url.origin).toString())).then((r) => r.text());
      return comCabecalhos(new Response(paginaDoMarketplace(modelo, itens, item), { headers: { "content-type": "text/html; charset=utf-8" } }), { "content-security-policy": cspDoSite(env), "cache-control": "no-cache", ...(env.CANAL === "staging" ? { "x-robots-tag": "noindex, nofollow" } : {}) });
    }
  }
  // llms.txt: as linhas da assinatura só saem com os pagamentos ligados (llmsPorPagamentos).
  if (url.pathname === "/llms.txt") {
    const t = await env.ASSETS.fetch(new Request(new URL("/site/llms.txt", url.origin).toString())).then((r) => r.text());
    return comCabecalhos(new Response(llmsPorPagamentos(t, pagamentosLigados(env)) + llmsDoMarketplace(marketplaceDoEnv(env)), { headers: { "content-type": "text/plain; charset=utf-8" } }), { "cache-control": "no-cache" });
  }
  // robots.txt e llms.txt vivem em public/site/ e saem na raiz do host; privacidade e termos também.
  const raiz: Record<string, string> = { "/robots.txt": "/site/robots.txt", "/llms.txt": "/site/llms.txt", "/privacidade": "/site/privacidade.html", "/termos": "/site/termos.html", "/grok-no-whatsapp": "/site/grok-no-whatsapp.html", "/parceria-xai": "/site/parceria-xai.html", "/baixar": "/site/baixar.html", "/perguntas": "/site/perguntas.html", "/grok-bot-e-meu-bot": "/site/grok-bot-e-meu-bot.html", "/guias": "/site/guias/index.html" };
  // Guias: só os da lista GUIAS (o resto cai na 404 do site).
  // A página do Windows (versão de teste, noindex): nos dois sites, fora do sitemap.
  raiz["/baixar-windows"] = "/site/baixar-windows.html";
  // A página das regras da promoção do primeiro mês (noindex; só o console a linka, fora do sitemap e do llms.txt):
  // existe com a promoção ligada (PROMO_CUPOM preenchido e pagamentos ligados); desligada, /promocao cai na 404 do site.
  const promo = promoLigada(env) !== null;
  if (promo) raiz["/promocao"] = "/site/promocao.html";
  const guia = /^\/guias\/([a-z0-9-]+)$/.exec(url.pathname)?.[1];
  if (guia && (GUIAS as readonly string[]).includes(guia)) raiz[url.pathname] = `/site/guias/${guia}.html`;
  const caminho = url.pathname === "/" ? "/site/index.html" : url.pathname === "/obrigado" ? "/site/obrigado.html" : raiz[url.pathname] ?? url.pathname;
  // O rascunho dos planos (suporte.html) não sai em nenhum ambiente, nem pelo caminho direto do arquivo; a página da
  // promoção desligada, idem. /suporte não está no mapa de páginas: cai na 404 do site.
  const foraDoAr = paginaForaDoAr(caminho) || paginaDaPromoDesligada(caminho, promo);
  let res = foraDoAr ? new Response(null, { status: 404 }) : await env.ASSETS.fetch(new Request(new URL(caminho, url.origin).toString(), { method: "GET", headers: req.headers }));
  // Caminho que não existe: a página 404 do site (com status 404), em vez do corpo vazio dos assets.
  if (res.status === 404 && (foraDoAr || !url.pathname.startsWith("/site/"))) res = new Response((await env.ASSETS.fetch(new Request(new URL("/site/404.html", url.origin).toString()))).body, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  // Sempre revalida (no-cache + ETag dos assets): o site muda junto com o Worker, e um CSS velho de 5 min já mostrou a
  // página quebrada; no-store desligava também o voltar/avançar instantâneo do navegador.
  // O HTML é o mesmo nos dois canais (o staging mostra o que a produção vai mostrar; a faixa e o selo vêm do site.js).
  // Staging fica fora do Google, para não competir com agentesgrok.com.
  const robos = env.CANAL === "staging" ? { "x-robots-tag": "noindex, nofollow" } : {};
  return comCabecalhos(res, { "content-security-policy": cspDoSite(env), "cache-control": "no-cache", ...robos });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const origem = `https://${url.host}`;
    try {
      // Antes de qualquer rota, num salto só: www. e o .com.br (com e sem www, http ou https) vão direto para o site
      // principal, com o caminho e a query (utm, gclid); o resto que chega por http:// (o Worker atende os dois) vira https.
      const destino = redirecionamentoInicial(req.url, env.SITE_ORIGIN);
      if (destino !== null) return comCabecalhos(Response.redirect(destino, 301), {});
      if (origem === env.SITE_ORIGIN) return await sitePagina(req, env, url);
      return origem === env.AUTH_ORIGIN ? semIndice(await pagina(req, env, url)) : origem === env.CONSOLE_ORIGIN ? semIndice(await consolePagina(req, env, url)) : await api(req, env, url, (p) => ctx.waitUntil(p));
    } catch (e) {
      console.log(`[conta-api] ${req.method} ${url.pathname}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      return comCabecalhos(json({ erro: "falha interna; tente de novo" }, 500), {});
    }
  },
} satisfies ExportedHandler<Env>;
