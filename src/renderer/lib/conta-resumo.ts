/** Selo e linha de prazo da conta meu-bot (menu da conta, molde Rambox): Pro ativo, Trial com dias, Free; vencidos avisam. Puro, testado. */
import type { ContaInfo } from "../../shared/ipc";
const DIA = 24 * 60 * 60 * 1000;
export interface ResumoPlano { selo: "pro" | "trial" | "free"; rotulo: string; prazo: string | null; vencido: boolean }
/** Selo e linha de prazo da conta: Pro (ativo), Trial (com dias), Free; trial ou Pro vencidos avisam; super admin, "∞ sem prazo". */
export function resumoPlano(c: Pick<ContaInfo, "licenca">, agora: number = Date.now()): ResumoPlano {
  const l = c.licenca;
  // Super admin: a API entrega o Pro sem prazo (`semPrazo`); nunca vence e não há data para contar.
  if (l.semPrazo === true) return { selo: "pro", rotulo: "Pro", prazo: "∞ sem prazo", vencido: false };
  const fim = Date.parse(l.expiresAt ?? l.trialEnd ?? "");
  const dias = Number.isNaN(fim) ? null : Math.ceil((fim - agora) / DIA);
  if (l.status === "trialing") {
    if (dias === null) return { selo: "trial", rotulo: "Trial", prazo: "Período de teste", vencido: false };
    if (dias < 0) return { selo: "free", rotulo: "Free", prazo: `Teste venceu há ${-dias} dia${dias === -1 ? "" : "s"}`, vencido: true };
    return { selo: "trial", rotulo: "Trial", prazo: dias === 0 ? "Último dia de teste" : `${dias} dia${dias === 1 ? "" : "s"} de teste restante${dias === 1 ? "" : "s"}`, vencido: false };
  }
  if (l.plan === "pro" && l.status === "active") {
    if (dias !== null && dias < 0) return { selo: "free", rotulo: "Free", prazo: `Pro venceu há ${-dias} dia${dias === -1 ? "" : "s"}`, vencido: true };
    return { selo: "pro", rotulo: "Pro", prazo: dias === null ? null : `Pro até ${new Date(fim).toLocaleDateString("pt-BR")}`, vencido: false };
  }
  if (l.status === "expired") return { selo: "free", rotulo: "Free", prazo: "Plano expirado", vencido: true };
  return { selo: "free", rotulo: "Free", prazo: null, vencido: false };
}
