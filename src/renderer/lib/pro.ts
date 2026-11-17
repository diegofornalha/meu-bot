/**
 * Acesso aos módulos Pro (aba Navegador, CRM pelo WhatsApp) a partir da licença da máquina. Puro, testado.
 * Produto free (meu-bot), `exige === "free"`:
 * - "ok": plano pro em vigor;
 * - "free": plano grátis → a aba abre bloqueada, com "Pedir o Pro ao admin";
 * - "expired": tinha o plano e venceu → bloqueada, com a data;
 * - "unknown": backend antigo/fora do ar, ou este Mac sem conta (sem licença para ler) → bloqueada. Este Mac usa o
 *   plano da conta meu-bot (o main manda a licença da conta, nunca o arquivo local).
 * App que exigisse mais que o free (`exige !== "free"`): sem etiqueta Pro; ou está tudo aberto ("ok") ou o add-on
 * `produto` falta/venceu ("assinatura"), uma tela só. Mesmas regras do src/main/licenca.ts (lado do main).
 */
import type { LicenseView, Pagamento, PlanName } from "../../shared/ipc";

export type ProAccess = "ok" | "free" | "expired" | "unknown" | "assinatura";

const RANK: Record<PlanName, number> = { free: 0, pro: 1 };
export const planoLibera = (tem: PlanName, exige: PlanName): boolean => RANK[tem] >= RANK[exige];
/** Plano que libera os módulos Pro. */
export const planoLiberaPro = (p: PlanName): boolean => planoLibera(p, "pro");
const vencida = (l: LicenseView["license"], now: number): boolean => l.status === "expired" || (l.expiresAt !== null && !Number.isNaN(Date.parse(l.expiresAt)) && Date.parse(l.expiresAt) < now);

export type AcessoProduto = "ok" | "ausente" | "expirada" | "unknown";
/**
 * Add-on (meu-bot-finance…): acumulativo por cima do plano, com ou sem o Pro; basta estar em `licenca.produtos` e a
 * licença não estar vencida. Mesma regra do src/main/licenca.ts.
 */
export function acessoAddon(view: LicenseView | null, host: string, produto: string, now: number = Date.now()): AcessoProduto {
  if (host === "local" || view === null) return "unknown";
  const l = view.license;
  // `produtos` pode faltar num backend antigo (licença sem o campo): trata como nenhum.
  if (!(l.produtos ?? []).includes(produto)) return "ausente";
  return vencida(l, now) ? "expirada" : "ok";
}
/** O app inteiro (caps.planoExigido): "free" nunca bloqueia; acima disso, o add-on `produto`. */
export const acessoProduto = (view: LicenseView | null, host: string, exige: PlanName, produto: string, now: number = Date.now()): AcessoProduto =>
  exige === "free" ? "ok" : acessoAddon(view, host, produto, now);

/**
 * CRM próprio (no Gmail e no WhatsApp) nesta máquina: faz parte do plano Pro em vigor. Decide o que a janela mostra
 * (tutorial 17, home do Navegador, "guardar no CRM"); o main e o backend conferem de novo.
 */
export const crmProprioOk = (view: LicenseView | null, host: string, now: number = Date.now()): boolean =>
  host !== "local" && view !== null && planoLiberaPro(view.license.plan) && (view.license.status === "active" || view.license.status === "trialing") && !vencida(view.license, now);

/** Financeiro: o add-on meu-bot-finance contratado, com ou sem o Pro. Mesma regra do main e do backend. */
export const financeOk = (view: LicenseView | null, host: string, now: number = Date.now()): boolean =>
  host !== "local" && acessoAddon(view, host, "meu-bot-finance", now) === "ok";

/**
 * Página Módulos por licença: algum add-on com módulos (caps.addons[].modulos) liberado nesta máquina. O app com produto
 * fixo (caps.modulos) mostra a página sempre. Mesma regra do main (produtosDeModulos, modulos-fonte-core.ts).
 */
export const modulosNaLicenca = (view: LicenseView | null, host: string, addons: readonly { nome: string; modulos: boolean }[], now: number = Date.now()): boolean =>
  addons.some((a) => a.modulos && acessoAddon(view, host, a.nome, now) === "ok");

export function browserAccess(view: LicenseView | null, host: string, exige: PlanName = "free", produto: string = "meu-bot", now: number = Date.now()): ProAccess {
  if (exige !== "free") { const a = acessoProduto(view, host, exige, produto, now); return a === "ok" ? "ok" : a === "unknown" ? "unknown" : "assinatura"; }
  if (view === null) return "unknown";
  const l = view.license;
  if (!planoLiberaPro(l.plan)) return "free";
  if (vencida(l, now)) return "expired";
  return "ok";
}

/** Texto do bloqueio, por situação. */
export type ProModule = "navegador" | "crm" | "finance" | "google" | "computador";
const MODULE_TEXT: Record<ProModule, { name: string; pitch: string; back: string }> = {
  navegador: { name: "Navegador", pitch: "Um navegador dentro do meu-bot, com abas, cookies separados por máquina e extensões do Chrome (como o Streak CRM no Gmail). E o agente da conversa pode navegar por você.", back: "a aba volta a abrir" },
  finance: { name: "Financeiro", pitch: "Seu financeiro no WhatsApp: o agente lança os gastos que você conta ou fotografa, categoriza sozinho e só pede o que depende de você.", back: "a página Finanças abre" },
  google: { name: "Conta Google", pitch: "A conta Google da máquina dentro do meu-bot: o agente lê o Gmail, a Agenda e as planilhas por você, e o backup dos seus dados vai para o seu Drive.", back: "a página Conta Google abre" },
  computador: { name: "Computador", pitch: "A tela da máquina do seu bot, ao vivo dentro do meu-bot: você vê o que o agente está fazendo, sem abrir nada.", back: "a tela aparece aqui" },
  crm: { name: "CRM pelo WhatsApp", pitch: "O agente da máquina anota no seu Streak CRM, pela API, o que acontece nas conversas do WhatsApp: cria e atualiza boxes, campos e comentários, e pede sua confirmação antes de mudar de etapa.", back: "o tutorial continua" },
};
/**
 * Orientação de pagamento a mostrar junto do bloqueio: só quando pagar resolve (grátis, venceu, add-on faltando) e o
 * admin gravou uma. "unknown" (não deu para ler o plano) nunca mostra: pagar não resolve o que é técnico.
 */
export function pagamentoDoBloqueio(a: Exclude<ProAccess, "ok">, view: LicenseView | null, assinatura: string | null = linkAssinatura): Pagamento | null {
  if (a === "unknown" || view === null) return null;
  return view.license.pagamento ?? pagamentoPadrao(assinatura);
}

/** Onde se assina pelo site: console › Plano, do canal do app (a cobrança é pela AbacatePay, no conta-api). */
export const linkDeAssinatura = (canal: "estavel" | "staging"): string => `https://console${canal === "staging" ? "-staging" : ""}.agentesgrok.com/account/plan`;
/**
 * Sem nada gravado pelo admin na licença, o aviso de plano mostra o caminho padrão: assinar pelo site. O admin só
 * precisa preencher "Como pagar" em caso especial (Pix direto, preço combinado). Sem link conhecido, null (como antes).
 */
export function pagamentoPadrao(assinatura: string | null): Pagamento | null {
  if (assinatura === null) return null;
  return { instrucoes: "Assine pelo site do meu-bot, com Pix ou cartão. Depois de pagar, toque em \"Já paguei\": o admin libera nesta máquina.", link: assinatura, padrao: true };
}
/** O link do canal deste app; o renderer informa uma vez, ao receber as capacidades (`usarCanalDaAssinatura`). */
let linkAssinatura: string | null = null;
export function usarCanalDaAssinatura(canal: "estavel" | "staging" | null): void { linkAssinatura = canal === null ? null : linkDeAssinatura(canal); }
export function proBlockText(a: Exclude<ProAccess, "ok">, view: LicenseView | null, modulo: ProModule = "navegador", produto: string = "meu-bot"): { title: string; text: string; askAdmin: boolean } {
  const m = MODULE_TEXT[modulo];
  if (a === "assinatura") return { title: `${produto}: produto não liberado nesta máquina`, text: `O ${produto} é contratado por cima do seu plano${view !== null && (view.license.produtos ?? []).includes(produto) ? `, e a licença desta máquina venceu${view.license.expiresAt ? ` em ${new Date(view.license.expiresAt).toLocaleDateString("pt-BR")}` : ""}` : ", e esta máquina ainda não o tem"}. Fale com o admin para liberar; assim que ele gravar, ${m.back}.`, askAdmin: true };
  if (a === "unknown") return { title: `${m.name} · Pro`, text: "Não consegui ler o plano desta máquina (backend antigo, fora do ar, ou este Mac). Reinstale o backend pelo seletor e tente de novo.", askAdmin: false };
  if (a === "expired") return { title: "Seu Pro venceu", text: `O plano Pro desta máquina venceu${view?.license.expiresAt ? ` em ${new Date(view.license.expiresAt).toLocaleDateString("pt-BR")}` : ""}. Peça ao admin para renovar e ${m.back}.`, askAdmin: true };
  return { title: `${m.name} é do plano Pro`, text: `${m.pitch} Peça o Pro ao admin: ele libera e ${m.back} aqui mesmo.`, askAdmin: true };
}

/** Título curto de uma aba interna (favicon à parte): o título da página, senão o domínio, senão "Nova aba". */
export function tabLabel(title: string, url: string): string {
  // O site do Gmail no Navegador chama-se "Gmail", fixo: o título dele ("Caixa de entrada - … - Gmail") varia e se
  // confunde com a página E-mail do app.
  try { if (new URL(url).hostname === "mail.google.com") return "Gmail"; } catch { /* sem url */ }
  const t = title.trim();
  if (t !== "" && t !== url) return t.length > 28 ? `${t.slice(0, 27)}…` : t;
  try { const h = new URL(url).hostname.replace(/^www\./, ""); if (h !== "") return h; } catch { /* sem url */ }
  return "Nova aba";
}
/** O que aparece no campo de endereço: sem "https://" e sem a barra final solitária. */
export const displayUrl = (url: string): string => url.replace(/^https:\/\//, "").replace(/\/$/, "");
