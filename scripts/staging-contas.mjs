#!/usr/bin/env node
// Contas de teste do STAGING nos estados que o roteiro de conferência exige (docs/STAGING.md), pela API de admin
// (GET /admin/visao e PATCH /admin/contas/:id/licenca). Não escreve no banco, não cria conta e não fala com a produção.
//
//   MEU_BOT_STAGING_ADMIN_TOKEN=… node scripts/staging-contas.mjs --api https://conta-staging.agentesgrok.com --base voce@gmail.com --listar
//   MEU_BOT_STAGING_ADMIN_TOKEN=… node scripts/staging-contas.mjs --api https://conta-staging.agentesgrok.com --base voce@gmail.com --aplicar
//
// A parte pura (validar o endereço, montar os e-mails e os patches, dizer se a conta está no estado) é exportada e
// testada em scripts/tests/staging-contas.test.mjs.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { varsDoWrangler } from "./release-core.mjs";

/** O único endereço que o script aceita, e o canal que o /health dele tem de dizer. */
export const API_STAGING = "https://conta-staging.agentesgrok.com";
export const CANAL_STAGING = "staging";
/** A variável de ambiente com o token de acesso de um admin do staging. Nunca vem por argumento nem é impressa. */
export const VAR_TOKEN = "MEU_BOT_STAGING_ADMIN_TOKEN";
/** Os estados, na ordem em que o roteiro os usa. */
export const ESTADOS = ["teste", "teste-vencido", "promo-vencida", "pro-pago"];
/** Quantos dias de Pro a conta `pro-pago` recebe. */
export const DIAS_PRO_PAGO = 30;
const DIA_MS = 24 * 60 * 60 * 1000;
/** O que marca um e-mail como conta de teste deste script: `<você>+mb-staging-<estado>@<domínio>`. */
const MARCA = "+mb-staging-";

export const AJUDA = `Contas de teste do staging nos estados do roteiro (docs/STAGING.md).

uso:
  ${VAR_TOKEN}=<token> node scripts/staging-contas.mjs --api ${API_STAGING} --base <seu e-mail> --listar
  ${VAR_TOKEN}=<token> node scripts/staging-contas.mjs --api ${API_STAGING} --base <seu e-mail> --aplicar

  --listar    só lê: mostra cada conta de teste, se existe e se está no estado certo
  --aplicar   põe cada conta que existe no estado dela (PATCH /admin/contas/:id/licenca)
  --api       tem de ser ${API_STAGING}; qualquer outro endereço é recusado (saída 1),
              e o /health dele tem de dizer canal "${CANAL_STAGING}"
  --base      o seu e-mail; as contas de teste são ele com um sufixo (abaixo)

Estados, e o e-mail de cada um (para --base voce@gmail.com):
  teste          voce+mb-staging-teste@gmail.com           teste grátis em vigor (acaba daqui a TRIAL_DIAS dias)
  teste-vencido  voce+mb-staging-teste-vencido@gmail.com   teste acabou ontem: é quem vê a promoção do primeiro mês
  promo-vencida  voce+mb-staging-promo-vencida@gmail.com   teste acabou há PROMO_DIAS + 1 dias: a promoção já não vale
  pro-pago       voce+mb-staging-pro-pago@gmail.com        Pro ativo por mais ${DIAS_PRO_PAGO} dias (liberado pelo admin, sem assinatura)
TRIAL_DIAS e PROMO_DIAS são os do staging em conta-api/wrangler.toml.

O que o script NÃO faz, e é passo seu, uma vez:
  1. Criar as contas. Conta nasce no primeiro login. Para cada um dos quatro e-mails, abra
     https://console-staging.agentesgrok.com, toque em Entrar e entre com o link por e-mail (o link chega na sua
     caixa de entrada: o Gmail entrega "voce+qualquer-coisa@" para "voce@"). Conta que não existe é só listada como
     "falta"; o script não a cria nem contorna o login.
  2. O token. Entre em https://console-staging.agentesgrok.com com uma conta que tem perfil de acesso (admin ou
     super admin). O token de acesso fica no localStorage do navegador, na chave "meu-bot-console-sessao", campo
     "acesso"; vale 1 hora. Ponha-o em ${VAR_TOKEN} sem colar em chat, commit ou log.

O script só toca contas cujo e-mail é exatamente um dos quatro acima, e nunca uma conta com perfil de acesso.
Ele não apaga pagamentos: uma conta que já pagou o Pro não volta a ver a promoção (docs/STAGING.md diz como zerar).

saída: 0 tudo certo; 1 recusa ou erro; 2 feito, mas falta criar alguma conta (ou alguma foi pulada).`;

/** O endereço é o da API de staging, e só ele: https, sem porta, sem usuário, sem caminho. Devolve a origem ou o erro. */
export function validarApi(bruto) {
  if (typeof bruto !== "string" || bruto.trim() === "") return { erro: `diga o endereço: --api ${API_STAGING}` };
  let u;
  try { u = new URL(bruto.trim()); } catch { return { erro: `"${bruto}" não é um endereço. Este script só fala com ${API_STAGING}` }; }
  const limpo = u.protocol === "https:" && u.host === new URL(API_STAGING).host && u.username === "" && u.password === "" && (u.pathname === "/" || u.pathname === "") && u.search === "" && u.hash === "";
  if (!limpo) return { erro: `recusado: ${u.host || bruto} não é o staging. Este script só fala com ${API_STAGING}` };
  return { ok: true, origem: API_STAGING };
}

/** O /health é o do staging? `{ok: true, canal: "staging"}`; qualquer outra resposta recusa. */
export function saudeDeStaging(corpo) {
  const c = corpo !== null && typeof corpo === "object" ? corpo : {};
  if (c.ok !== true) return { erro: "o /health não respondeu ok" };
  if (c.canal !== CANAL_STAGING) return { erro: `o /health diz canal "${String(c.canal)}", não "${CANAL_STAGING}": nada foi feito` };
  return { ok: true };
}

/** Os e-mails das contas de teste a partir do e-mail-base (sem "+"), em minúsculas: `{estado: e-mail}` ou `{erro}`. */
export function emailsDeTeste(base) {
  const m = typeof base === "string" ? /^([^\s@+]{1,60})@([^\s@]{1,100}\.[^\s@]{1,50})$/.exec(base.trim().toLowerCase()) : null;
  if (m === null) return { erro: "diga o seu e-mail, sem \"+\": --base voce@gmail.com" };
  return { ok: true, emails: Object.fromEntries(ESTADOS.map((e) => [e, `${m[1]}${MARCA}${e}@${m[2]}`])) };
}

/** Um inteiro de 1 a `max` lido de uma var do wrangler.toml; null fora disso. */
const dias = (v, max) => { const n = Number(String(v ?? "").trim()); return Number.isInteger(n) && n >= 1 && n <= max ? n : null; };
/** TRIAL_DIAS e PROMO_DIAS do staging, lidos do texto do wrangler.toml (varsDoWrangler). Sem um deles, erro. */
export function diasDoStaging(toml) {
  const v = varsDoWrangler(toml).staging;
  const trialDias = dias(v.TRIAL_DIAS, 365), promoDias = dias(v.PROMO_DIAS, 30);
  if (trialDias === null) return { erro: "TRIAL_DIAS do staging não é um número de dias (ou é 0: teste desligado). Sem ele não há estado \"teste\"" };
  if (promoDias === null) return { erro: "PROMO_DIAS do staging não é um número de 1 a 30" };
  return { ok: true, trialDias, promoDias };
}

/**
 * O corpo do PATCH /admin/contas/:id/licenca de cada estado, a partir de `agoraMs`. O teste grava `trialEnd` e
 * `expiresAt` iguais, como o primeiro login (`iniciarTrialSeNovo`) e o editor do admin; o Pro pago grava o que o
 * editor do admin grava para "Pro, Ativo" (`trialEnd` nulo). Só os campos do plano e do prazo: limites, add-ons e
 * "como pagar" ficam como estão.
 */
export function patchesDosEstados({ agoraMs, trialDias, promoDias }) {
  const em = (d) => new Date(agoraMs + d * DIA_MS).toISOString();
  const teste = (d) => ({ plan: "pro", status: "trialing", interval: null, trialEnd: em(d), expiresAt: em(d) });
  return {
    teste: teste(trialDias),
    "teste-vencido": teste(-1),
    "promo-vencida": teste(-(promoDias + 1)),
    "pro-pago": { plan: "pro", status: "active", interval: "month", trialEnd: null, expiresAt: em(DIAS_PRO_PAGO) },
  };
}

/** A licença está no estado? Pelo sentido (a mesma conta de `direitoPromo`), não pela data exata: o tempo anda entre uma aplicação e a conferência. */
export function noEstado(licenca, estado, { agoraMs, promoDias }) {
  const l = licenca !== null && typeof licenca === "object" ? licenca : {};
  const fimTeste = Date.parse(l.trialEnd ?? ""), fim = Date.parse(l.expiresAt ?? "");
  const emTeste = l.plan === "pro" && l.status === "trialing" && !Number.isNaN(fimTeste);
  if (estado === "teste") return emTeste && fimTeste > agoraMs;
  if (estado === "teste-vencido") return emTeste && fimTeste <= agoraMs && agoraMs <= fimTeste + promoDias * DIA_MS;
  if (estado === "promo-vencida") return emTeste && agoraMs > fimTeste + promoDias * DIA_MS;
  if (estado === "pro-pago") return l.plan === "pro" && l.status === "active" && !Number.isNaN(fim) && fim > agoraMs;
  return false;
}

/**
 * O que fazer com cada estado, a partir da lista do admin (`contas` de GET /admin/visao): `falta` (a conta não existe:
 * passo humano), `pulada` (existe, mas tem perfil de acesso: o script não mexe em admin), ou a conta com o patch e se
 * já está no estado. Só entra conta cujo e-mail é exatamente o esperado.
 */
export function planejar({ contas, emails, patches, agoraMs, promoDias }) {
  const lista = Array.isArray(contas) ? contas : [];
  return ESTADOS.map((estado) => {
    const email = emails[estado];
    const c = lista.find((x) => x !== null && typeof x === "object" && x.email === email) ?? null;
    if (c === null) return { estado, email, situacao: "falta" };
    if (c.admin !== null && c.admin !== undefined) return { estado, email, situacao: "pulada", motivo: "tem perfil de acesso" };
    if (typeof c.id !== "string" || !/^[0-9a-f-]{36}$/.test(c.id)) return { estado, email, situacao: "pulada", motivo: "id fora do formato" };
    return { estado, email, situacao: "existe", id: c.id, licenca: c.licenca ?? null, noEstado: noEstado(c.licenca, estado, { agoraMs, promoDias }), patch: patches[estado] };
  });
}

/** Lê os argumentos: um modo só, `--api` e `--base` com valor, nada desconhecido. */
export function lerArgumentos(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { ajuda: true };
  const valor = (nome) => { const i = argv.indexOf(nome); const v = i >= 0 ? argv[i + 1] : undefined; return typeof v === "string" && !v.startsWith("--") ? v : null; };
  const conhecidos = new Set(["--listar", "--aplicar", "--api", "--base"]);
  const estranho = argv.find((a, i) => a.startsWith("-") ? !conhecidos.has(a) : !["--api", "--base"].includes(argv[i - 1] ?? ""));
  if (estranho !== undefined) return { erro: `argumento desconhecido: ${estranho.startsWith("-") ? estranho : "(valor solto)"}. O token vai em ${VAR_TOKEN}, nunca por argumento` };
  const listar = argv.includes("--listar"), aplicar = argv.includes("--aplicar");
  if (listar === aplicar) return { erro: "escolha um: --listar ou --aplicar" };
  return { modo: aplicar ? "aplicar" : "listar", api: valor("--api"), base: valor("--base") };
}

const linhaDaLicenca = (l) => (l === null || typeof l !== "object" ? "sem licença" : `${l.plan}/${l.status}, teste até ${l.trialEnd ?? "-"}, vale até ${l.expiresAt ?? "-"}`);

async function pedir(origem, metodo, rota, token, corpo) {
  // redirect: "error": uma resposta que mandasse a outro endereço não leva o token junto.
  const r = await fetch(`${origem}${rota}`, { method: metodo, redirect: "error", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(corpo === undefined ? {} : { "content-type": "application/json" }) }, body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(20_000) });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}
const erroDe = (r) => `HTTP ${r.status}${typeof r.corpo?.erro === "string" ? `: ${r.corpo.erro}` : ""}`;

async function principal(argv, env) {
  const args = lerArgumentos(argv);
  if (args.ajuda) { console.log(AJUDA); return 0; }
  if (args.erro) { console.error(`✗ ${args.erro}\n\n${AJUDA}`); return 1; }
  const api = validarApi(args.api);
  if (api.erro) { console.error(`✗ ${api.erro}`); return 1; }
  const emails = emailsDeTeste(args.base);
  if (emails.erro) { console.error(`✗ ${emails.erro}`); return 1; }
  const toml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "conta-api", "wrangler.toml"), "utf8");
  const d = diasDoStaging(toml);
  if (d.erro) { console.error(`✗ ${d.erro}`); return 1; }
  const token = (env[VAR_TOKEN] ?? "").trim();
  if (!/^[A-Za-z0-9_.-]{20,4096}$/.test(token)) { console.error(`✗ falta o token de admin do staging em ${VAR_TOKEN} (veja --help: de onde ele vem). Nada foi pedido à API.`); return 1; }

  const saude = await pedir(api.origem, "GET", "/health");
  const s = saude.status === 200 ? saudeDeStaging(saude.corpo) : { erro: `o /health respondeu HTTP ${saude.status}` };
  if (s.erro) { console.error(`✗ ${s.erro}`); return 1; }

  const visao = await pedir(api.origem, "GET", `/admin/visao?busca=${encodeURIComponent(MARCA)}`, token);
  if (visao.status !== 200 || !Array.isArray(visao.corpo?.contas)) { console.error(`✗ não li a lista do admin (${erroDe(visao)}). 401: o token venceu (vale 1 h); 403: a conta do token não é admin.`); return 1; }
  const agoraMs = Date.now();
  const plano = planejar({ contas: visao.corpo.contas, emails: emails.emails, patches: patchesDosEstados({ agoraMs, ...d }), agoraMs, promoDias: d.promoDias });

  console.log(`staging (${api.origem}), TRIAL_DIAS ${d.trialDias}, PROMO_DIAS ${d.promoDias}`);
  let falhas = 0;
  for (const p of plano) {
    if (p.situacao === "falta") { console.log(`· ${p.estado}: falta criar ${p.email} (entre uma vez em https://console-staging.agentesgrok.com com esse e-mail)`); continue; }
    if (p.situacao === "pulada") { console.log(`· ${p.estado}: ${p.email} pulada (${p.motivo})`); continue; }
    if (args.modo === "listar") { console.log(`${p.noEstado ? "✓" : "⚠"} ${p.estado}: ${p.email} ${p.noEstado ? "está no estado" : "NÃO está no estado"} (${linhaDaLicenca(p.licenca)})`); continue; }
    const r = await pedir(api.origem, "PATCH", `/admin/contas/${p.id}/licenca`, token, p.patch);
    const ok = r.status === 200 && noEstado(r.corpo?.licenca, p.estado, { agoraMs: Date.now(), promoDias: d.promoDias });
    if (!ok) falhas++;
    console.log(`${ok ? "✓" : "✗"} ${p.estado}: ${p.email} ${ok ? `aplicado (${linhaDaLicenca(r.corpo.licenca)})` : r.status === 200 ? "a API aceitou, mas a licença devolvida não está no estado" : `não aplicado (${erroDe(r)})`}`);
  }
  if (falhas > 0) return 1;
  const incompletas = plano.filter((p) => p.situacao !== "existe").length;
  if (incompletas > 0) { console.log(`${incompletas} de ${plano.length} contas ficaram de fora: veja --help (o passo que é seu).`); return 2; }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2), process.env).then((codigo) => process.exit(codigo), (e) => { console.error(`✗ ${e?.message ?? e}`); process.exit(1); });
}
