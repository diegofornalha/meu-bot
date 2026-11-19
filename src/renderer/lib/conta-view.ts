/**
 * A conta de uma pessoa na página Suporte do meu-bot-admin-gestao, com as mesmas regras e os mesmos textos do console
 * (conta-api/public/console/plano-core.js): `fase`, `contagemRegressiva`, `semPrazo`, `vagasDeMaquina`, `diasAteOFim`
 * e `fimDoPlano` são porte linha a linha de lá, e o teste scripts/tests/conta-view.test.mjs roda os dois sobre a mesma
 * tabela de casos. Mudou um, mude o outro. Puro, sem DOM.
 */
import type { Abertura, ContaDaPessoa, License, LicenseView } from "../../shared/ipc";
import { PLAN_LABEL, STATUS_LABEL, fmtDate, produtoLabel, type AddonRotulo, type HealthLine } from "./admin-view.js";

export const INFINITO = "∞", SEM_PRAZO = "sem prazo (super admin)", TODOS_ADDONS = "todos os add-ons, os de hoje e os que vierem (super admin)", SEM_LIMITE = "sem limite (super admin)";
type Prazo = Pick<License, "plan" | "status" | "trialEnd" | "expiresAt"> & { semPrazo?: boolean };
export interface Selo { texto: string; tom: "ok" | "mau" | "" }
const HORA = 60 * 60 * 1000, DIA = 24 * HORA;

export const semPrazo = (l: Prazo | null | undefined): boolean => l?.semPrazo === true;
export function fimDoPlano(l: Prazo | null | undefined): number | null { const fim = Date.parse(l?.expiresAt ?? l?.trialEnd ?? ""); return Number.isNaN(fim) ? null : fim; }
export function diasAteOFim(l: Prazo | null | undefined, agoraMs: number): number | null { const fim = fimDoPlano(l); return fim === null ? null : Math.ceil((fim - agoraMs) / DIA); }
export function contagemRegressiva(l: Prazo | null | undefined, agoraMs: number): Selo | null {
  if (semPrazo(l)) return { texto: `${INFINITO} sem prazo`, tom: "ok" };
  const fim = fimDoPlano(l);
  if (fim === null) return null;
  const teste = l?.status === "trialing";
  if (!teste && !(l?.plan === "pro" && l?.status === "active")) return null;
  const de = teste ? "de teste" : "do Pro";
  const falta = fim - agoraMs;
  if (falta <= 0) { const d = Math.floor(-falta / DIA); return { texto: d === 0 ? `${teste ? "teste" : "Pro"} venceu hoje` : `${teste ? "teste" : "Pro"} venceu há ${d} dia${d === 1 ? "" : "s"}`, tom: "mau" }; }
  if (falta <= DIA) { const h = Math.ceil(falta / HORA); return { texto: h <= 1 ? `falta menos de 1 hora ${de}` : `faltam ${h} horas ${de}`, tom: "mau" }; }
  return { texto: `faltam ${diasAteOFim(l, agoraMs)} dias ${de}`, tom: "ok" };
}
export function fase(l: Prazo, agora: number = Date.now()): Selo {
  if (semPrazo(l)) return { texto: `Pro · ${INFINITO}`, tom: "ok" };
  const dias = diasAteOFim(l, agora);
  if (l.status === "trialing") return dias === null ? { texto: "Trial", tom: "ok" } : dias >= 0 ? { texto: `Trial · ${dias === 0 ? "último dia" : `${dias} dia${dias === 1 ? "" : "s"}`}`, tom: "ok" } : { texto: `Trial venceu há ${-dias} dia${dias === -1 ? "" : "s"}`, tom: "mau" };
  if (l.status === "active" && l.plan === "pro") return dias !== null && dias < 0 ? { texto: `Pro venceu há ${-dias} dia${dias === -1 ? "" : "s"}`, tom: "mau" } : { texto: dias === null ? "Pro ativo" : `Pro · ${dias} dia${dias === 1 ? "" : "s"}`, tom: "ok" };
  if (l.status === "expired") return { texto: "Expirado", tom: "mau" };
  return { texto: "Free", tom: "" };
}
export function vagasDeMaquina(limite: unknown, extras: unknown): { total: number; inclusas: number; extras: number; detalhe: string } {
  const total = typeof limite === "number" && Number.isInteger(limite) && limite >= 1 ? limite : 1;
  const pagas = typeof extras === "number" && Number.isInteger(extras) && extras >= 0 ? Math.min(extras, total - 1) : 0;
  const inclusas = total - pagas;
  const detalhe = pagas === 0 ? "" : `${inclusas} inclusa${inclusas === 1 ? "" : "s"} + ${pagas} extra${pagas === 1 ? "" : "s"}`;
  return { total, inclusas, extras: pagas, detalhe };
}

const okDoTom = (tom: Selo["tom"]): boolean | null => (tom === "ok" ? true : tom === "mau" ? false : null);
const PISTA: Record<"maquina" | "id" | "email", string> = {
  maquina: "esta máquina está vinculada a ela",
  id: "pela licença da conta guardada nesta máquina",
  email: "conta provável: é o e-mail que o app dela declarou ao abrir; a máquina não está vinculada a uma conta",
};
/** As linhas do bloco "Conta (como no console)": os mesmos campos da lista de contas do console, na mesma régua. */
export function contaLinhas(c: Extract<ContaDaPessoa, { estado: "ok" }>, now: number = Date.now(), addons: readonly AddonRotulo[] = []): HealthLine[] {
  const k = c.conta, l = k.licenca, sp = semPrazo(l);
  const papel = k.admin === "super" ? " · super admin" : k.admin === "admin" ? " · admin" : "";
  const f = fase(l, now), cr = contagemRegressiva(l, now);
  const ativos = k.devices.filter((d) => d.status !== "pending").length, pend = k.devices.length - ativos;
  const usadas = k.maquinas.filter((m) => m.desvinculadaEm === null).length;
  const vagas = vagasDeMaquina(k.maquinaLimite, c.maquinaExtras);
  const lines: HealthLine[] = [
    { text: `Conta: ${k.email}${k.nome !== null ? ` (${k.nome})` : ""}${papel} · ${PISTA[c.achadaPor]}`, ok: c.achadaPor === "email" ? null : true },
    { text: `Plano: ${PLAN_LABEL[l.plan]} · ${f.texto}${cr !== null && !sp ? ` · ${cr.texto}` : ""}`, ok: okDoTom(f.tom) },
    { text: `Até: ${sp ? `${INFINITO} ${SEM_PRAZO}` : fmtDate(l.expiresAt ?? l.trialEnd)}`, ok: null },
    { text: `Devices: ${ativos}/${sp ? INFINITO : l.deviceLimit} ativos${pend > 0 ? ` · ${pend} pendente${pend === 1 ? "" : "s"}` : ""}`, ok: pend > 0 ? false : null },
    { text: `Máquinas com a licença: ${usadas} de ${sp ? INFINITO : vagas.total}${!sp && vagas.detalhe !== "" ? ` (${vagas.detalhe})` : ""}`, ok: null },
  ];
  if (sp) lines.push({ text: `Add-ons: ${TODOS_ADDONS}`, ok: null });
  else if (l.produtos.length > 0) lines.push({ text: `Add-ons: ${l.produtos.map((p) => { const pago = c.addonsPagos.find((a) => a.produto === p); return `${produtoLabel(p, addons)} (${pago === undefined ? "concedido" : pago.valeAte === null ? "pago" : `pago até ${fmtDate(pago.valeAte)}`})`; }).join(", ")}`, ok: null });
  if (k.pedidos > 0) lines.push({ text: `Pedidos abertos: ${k.pedidos}`, ok: false });
  return lines;
}
/**
 * Onde a máquina e a conta discordam (plano, status ou o dia em que vence): uma linha por diferença, com os dois
 * lados. Só com ligação confirmada: conta achada só pelo e-mail declarado pode nem ser a desta máquina.
 */
export function diferencasDaConta(c: Extract<ContaDaPessoa, { estado: "ok" }>, view: LicenseView | null): HealthLine[] {
  if (view === null || c.achadaPor === "email") return [];
  const m = view.license, k = c.conta.licenca, out: HealthLine[] = [];
  if (m.plan !== k.plan) out.push({ text: `Diferença no plano: na máquina está ${PLAN_LABEL[m.plan]}, na conta ${PLAN_LABEL[k.plan]}`, ok: false });
  if (m.status !== k.status) out.push({ text: `Diferença no status: na máquina está ${STATUS_LABEL[m.status]}, na conta ${STATUS_LABEL[k.status]}`, ok: false });
  const dia = (l: Prazo): string => (semPrazo(l) ? INFINITO : fmtDate(l.expiresAt ?? l.trialEnd));
  if (dia(m) !== dia(k)) out.push({ text: `Diferença na validade: na máquina vai até ${dia(m)}, na conta até ${dia(k)}`, ok: false });
  return out;
}
/** O texto do bloco quando não há conta para mostrar. */
export function contaSemDadosTexto(c: Exclude<ContaDaPessoa, { estado: "ok" }>, quem: string): string {
  if (c.estado === "sem-ligacao") return `Esta máquina ainda não está ligada a uma conta meu-bot: ${quem} não entrou com a conta no app nem usou "Usar o meu Pro nesta máquina". Vale só a licença gravada aqui embaixo. Se você sabe de quem ela é, atribua pelo e-mail.`;
  if (c.estado === "nao-achada") return "A máquina aponta para uma conta que a API não tem (apagada, ou de outro ambiente: o Gestão lê só a produção).";
  return `Não consegui ler a conta agora: ${c.motivo}.`;
}

/**
 * O que o bloco "Atribuir a uma conta" da gestão mostra: a máquina já está atribuída (o e-mail, com "Desfazer"), ou o
 * campo para atribuir, já com o e-mail mais provável (a conta lida, senão o da abertura mais recente do app). Máquina
 * que usa a licença da própria conta já está ligada a ela: não há o que atribuir.
 */
export function atribuicaoDaTela(conta: ContaDaPessoa | undefined, aberturas: readonly Abertura[] | null | undefined): { modo: "atribuida"; email: string } | { modo: "atribuir"; sugestao: string } | { modo: "ligada"; email: string } {
  if (conta?.estado === "ok" && conta.achadaPor === "maquina") return conta.atribuida === true ? { modo: "atribuida", email: conta.conta.email } : { modo: "ligada", email: conta.conta.email };
  const daAbertura = (aberturas ?? []).find((a) => a.conta !== "")?.conta ?? "";
  return { modo: "atribuir", sugestao: conta?.estado === "ok" ? conta.conta.email : daAbertura };
}
