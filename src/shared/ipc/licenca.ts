/** Contrato IPC · Licença da máquina (plano, add-ons, devices). Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */

/**
 * Licença da conta (a máquina da pessoa): plano, status, validade e limite de devices. Mora em licenca.json na
 * máquina; o admin é o dono e grava por SSH. Mesmo esquema do backend-colima/licenca.js e do src/main/licenca.ts.
 */
/** Planos da licença: free (a base) e pro (Navegador e CRM). Módulos pagos à parte (meu-bot-finance…) são add-ons em `produtos`. */
export type PlanName = "free" | "pro";
/** Como pagar, gravado pelo admin (chave Pix, link, contato); aparece no aviso de plano. */
export interface Pagamento {
  instrucoes: string;
  /** Link de pagamento (http/https) ou null. */
  link: string | null;
  /** true = ninguém gravou nada: é o caminho padrão (assinar pelo site), montado pelo app; nunca vem da licença. */
  padrao?: true;
}
export interface License {
  plan: PlanName;
  status: "free" | "trialing" | "active" | "expired";
  /** Ciclo de cobrança; null (ex.: em trial) vira "-" na tela. */
  interval: "month" | "year" | null;
  /** "Membro desde" (ISO), carimbado na 1ª vez. */
  memberSince: string;
  trialEnd: string | null;
  expiresAt: string | null;
  deviceLimit: number;
  /** Produtos contratados por cima do plano, acumulativos (meu-bot-crm, meu-bot-fit…); vazio = só o plano. */
  produtos: string[];
  /** Orientação de pagamento desta conta; null = sem orientação (o aviso só oferece "pedir ao admin"). */
  pagamento: Pagamento | null;
  updatedAt: string;
  updatedBy: "admin" | "system";
  /**
   * Só na licença da CONTA que a API entrega (nunca no licenca.json de uma máquina): a conta é de super admin e o Pro
   * não tem prazo. A API já manda `status: "active"` e `expiresAt: null`; isto só troca o texto do prazo por "∞".
   */
  semPrazo?: true;
}
/** Um device registrado na conta (uma entrada do maquinas.json). Pendente = a pessoa "levantou a mão". */
export interface LicenseDevice {
  id: string;
  name: string;
  user: string;
  platform: string;
  app: string;
  firstSeen: string;
  lastSeen: string;
  status: "active" | "pending";
  requestedAt: string | null;
  /** Apps que já se apresentaram deste device (meu-bot, meu-bot-crm…), com versão e último visto; vazio em registro antigo. */
  apps: Record<string, { version: string; lastSeen: string }>;
}
/** Licença + devices de uma conta, como o app da pessoa e o admin veem. */
export interface LicenseView {
  license: License;
  devices: LicenseDevice[];
  activeCount: number;
  pendingCount: number;
  deviceLimit: number;
  /** De onde vem o plano em vigor nesta máquina: o que o admin gravou, ou a licença da conta da pessoa. Ausente em backend antigo. */
  origem?: "admin" | "conta";
}
/**
 * "Usar o meu Pro nesta máquina" e "Tirar": `semVaga` traz os nomes das máquinas que já usam a licença da conta
 * (o limite de máquinas dela); `view` é a licença da janela relida depois da ação.
 */
export type PlanoDaContaResultado = { ok: true; view: LicenseView | null } | { ok: false; erro: string; semVaga?: string[] };
/** O que o admin pode mudar na licença de uma pessoa (campos omitidos ficam como estão). */
export interface LicensePatch {
  plan?: PlanName;
  status?: "free" | "trialing" | "active" | "expired";
  interval?: "month" | "year" | null;
  trialEnd?: string | null;
  expiresAt?: string | null;
  deviceLimit?: number;
  /** A lista inteira de produtos contratados (substitui a atual). */
  produtos?: string[];
  /** Orientação de pagamento (null apaga). */
  pagamento?: Pagamento | null;
}
