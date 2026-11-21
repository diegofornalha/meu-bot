/**
 * Acesso aos módulos Pro (aba Navegador, CRM pelo WhatsApp) a partir da licença da máquina. Puro, testado.
 * Produto free (meu-bot), `exige === "free"`:
 * - "ok": plano pro em vigor;
 * - "free": plano grátis → a aba abre bloqueada, com "Assinar pelo site" (ou "Usar o meu Pro nesta máquina");
 * - "expired": tinha o plano e venceu → bloqueada, com a data;
 * - "unknown": backend antigo/fora do ar, ou este Mac sem conta (sem licença para ler) → bloqueada. Este Mac usa o
 *   plano da conta meu-bot (o main manda a licença da conta, nunca o arquivo local).
 * App que exigisse mais que o free (`exige !== "free"`): sem etiqueta Pro; ou está tudo aberto ("ok") ou o add-on
 * `produto` falta/venceu ("assinatura"), uma tela só. Mesmas regras do src/main/licenca.ts (lado do main).
 */
import type { License, LicenseView, Pagamento, PlanName } from "../../shared/ipc";

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
 * (tutorial 16, home do Navegador, "guardar no CRM"); o main e o backend conferem de novo.
 */
export const crmProprioOk = (view: LicenseView | null, host: string, now: number = Date.now()): boolean =>
  host !== "local" && view !== null && planoLiberaPro(view.license.plan) && (view.license.status === "active" || view.license.status === "trialing") && !vencida(view.license, now);


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
export type ProModule = "navegador" | "crm" | "google" | "computador";
const MODULE_TEXT: Record<ProModule, { name: string; pitch: string; back: string }> = {
  navegador: { name: "Navegador", pitch: "Um navegador dentro do meu-bot, com abas, cookies separados por máquina e extensões do Chrome (como o Streak CRM no Gmail). E o agente da conversa pode navegar por você.", back: "a aba volta a abrir" },
  google: { name: "Conta Google", pitch: "A conta Google da máquina dentro do meu-bot: o agente lê o Gmail, a Agenda e as planilhas por você, e o backup dos seus dados vai para o seu Drive.", back: "a página Conta Google abre" },
  computador: { name: "Computador", pitch: "A tela da máquina do seu bot, ao vivo dentro do meu-bot: você vê o que o agente está fazendo, sem abrir nada.", back: "a tela aparece aqui" },
  crm: { name: "CRM pelo WhatsApp", pitch: "O agente da máquina anota no seu Streak CRM, pela API, o que acontece nas conversas do WhatsApp: cria e atualiza boxes, campos e comentários, e pede sua confirmação antes de mudar de etapa.", back: "o tutorial continua" },
};
/**
 * Orientação de pagamento a mostrar junto do bloqueio: só quando pagar resolve (grátis, venceu, add-on faltando) e o
 * admin gravou uma (sem nada gravado, o caminho padrão: assinar pelo site). "unknown" (não deu para ler o plano) nunca mostra: pagar não resolve o que é técnico.
 */
export function pagamentoDoBloqueio(a: Exclude<ProAccess, "ok">, view: LicenseView | null): Pagamento | null {
  if (a === "unknown" || view === null) return null;
  return view.license.pagamento ?? pagamentoPadrao();
}

/**
 * A conta meu-bot da pessoa tem o que levar a uma máquina: Pro em vigor, ou um add-on pago numa licença não vencida.
 * É a licença da CONTA (a API já soma os add-ons pagos em dia), não a da máquina.
 */
export function contaTemLicenca(l: License | null, now: number = Date.now()): boolean {
  if (l === null || vencida(l, now)) return false;
  return (planoLiberaPro(l.plan) && (l.status === "active" || l.status === "trialing")) || (l.produtos ?? []).length > 0;
}
/**
 * O que o aviso de plano oferece quando o admin não gravou um "Como pagar" próprio (o caminho padrão), agora que a
 * pessoa assina sozinha pelo site:
 * - "usar-da-conta": a conta já tem a licença e esta janela é de uma máquina por SSH que ainda não a usa → o botão
 *   principal leva a licença da conta à máquina;
 * - "assinar": falta assinar (ou a máquina já usa a da conta e ainda falta algo) → o botão principal abre o site.
 * Este Mac nunca é "usar-da-conta": ele já usa o plano da conta. `maquinaLimite` null = a API da conta ainda não leva
 * a licença a máquinas.
 */
export type CaminhoPlano = "usar-da-conta" | "assinar";
export function caminhoDoPlano(o: { remoto: boolean; conta: License | null; maquinaLimite: number | null; origem: "admin" | "conta" | undefined }, now: number = Date.now()): CaminhoPlano {
  return o.remoto && o.maquinaLimite !== null && o.origem !== "conta" && contaTemLicenca(o.conta, now) ? "usar-da-conta" : "assinar";
}

/**
 * A frase da tela da conta para uma máquina que usa a licença da conta. Sem aviso, ela se renova sozinha. Com aviso (a
 * conta recusou a renovação: máquina fora do limite), diz o motivo e que a licença daqui só vale até vencer.
 */
export function fraseDaLicencaDaConta(onde: string, avisoRenovacao: string | undefined): { texto: string; alerta: boolean } {
  const aviso = (avisoRenovacao ?? "").trim();
  if (aviso === "") return { texto: `${onde} usa a licença da sua conta. Ela se renova sozinha enquanto a assinatura estiver em dia.`, alerta: false };
  return { texto: `${onde} usa a licença da sua conta, mas ela parou de ser renovada: ${aviso.replace(/[.\s]+$/, "")}. A licença que já está aqui vale até vencer.`, alerta: true };
}

/** Página do console onde se assina (a cobrança é pela AbacatePay, no conta-api). O main monta o endereço do canal e entra logado (`contaAbrirConsole`). */
export const CAMINHO_ASSINATURA = "/account/plan";
/** Página do console com o que dá para somar à conta (apps, máquinas e Macs a mais): a vitrine e a página de cada item. */
export const CAMINHO_MARKETPLACE = "/account/marketplace";
/**
 * Sem nada gravado pelo admin na licença, o aviso de plano mostra o caminho padrão: assinar pelo site. O admin só
 * precisa preencher "Como pagar" em caso especial (Pix direto, preço combinado). Sem link: o botão abre o console.
 */
export function pagamentoPadrao(): Pagamento {
  return { instrucoes: "Assine pelo site do meu-bot, com Pix ou cartão. O plano fica na sua conta; depois de pagar, toque em \"Já assinei\" e ele passa a valer aqui.", link: null, padrao: true };
}
/**
 * Título e texto do bloqueio. `askAdmin` = mostrar "Pedir ao admin": só quando o admin gravou um "Como pagar" próprio
 * para esta máquina (acordo à parte). Sem isso a pessoa resolve sozinha, assinando pelo site, e o botão do admin não
 * aparece.
 */
export function proBlockText(a: Exclude<ProAccess, "ok">, view: LicenseView | null, modulo: ProModule = "navegador", produto: string = "meu-bot"): { title: string; text: string; askAdmin: boolean } {
  const m = MODULE_TEXT[modulo];
  // `pagamento` pode faltar num backend antigo (licença sem o campo): conta como não gravado.
  const comAdmin = view !== null && view.license.pagamento != null;
  if (a === "assinatura") return { title: `${produto}: produto não liberado nesta máquina`, text: `O ${produto} é contratado por cima do seu plano${view !== null && (view.license.produtos ?? []).includes(produto) ? `, e a licença desta máquina venceu${view.license.expiresAt ? ` em ${new Date(view.license.expiresAt).toLocaleDateString("pt-BR")}` : ""}` : ", e esta máquina ainda não o tem"}. ${comAdmin ? `Fale com o admin para liberar; assim que ele gravar, ${m.back}.` : `Assine pelo site; com o pagamento confirmado, ${m.back}.`}`, askAdmin: comAdmin };
  if (a === "unknown") return { title: `${m.name} · Pro`, text: "Não consegui ler o plano desta máquina (backend antigo, fora do ar, ou este Mac). Reinstale o backend pelo seletor e tente de novo.", askAdmin: false };
  if (a === "expired") return { title: "Seu Pro venceu", text: `O plano Pro desta máquina venceu${view?.license.expiresAt ? ` em ${new Date(view.license.expiresAt).toLocaleDateString("pt-BR")}` : ""}. ${comAdmin ? "Peça ao admin para renovar" : "Renove pelo site"} e ${m.back}.`, askAdmin: comAdmin };
  return { title: `${m.name} é do plano Pro`, text: `${m.pitch} ${comAdmin ? `Peça o Pro ao admin: ele libera e ${m.back} aqui mesmo.` : `Assine o Pro pelo site e ${m.back} aqui mesmo.`}`, askAdmin: comAdmin };
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
