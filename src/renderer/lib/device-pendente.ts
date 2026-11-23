/**
 * O computador (Mac ou Windows) que passou do limite de devices do plano (o backend da máquina recusa o chat com `device_pending`): em vez de
 * "pedido recusado", o aviso diz o que aconteceu e como resolver sem depender do admin. Puro, testado.
 */
export const DEVICE_PENDENTE = "device_pending";
/** Onde se adiciona um device: a página Plano do console (o preço está lá, não no app). */
export const CAMINHO_DEVICE = "/account/plan";
export const ehDevicePendente = (code: string | undefined): boolean => code === DEVICE_PENDENTE;
export const DEVICE_PENDENTE_TITULO = "Este computador passou do limite de devices do seu plano";
export const DEVICE_PENDENTE_TEXTO = "O agente não responde por este computador enquanto não houver vaga. Adicione um device no console da conta, ou tire de lá um computador que você não usa mais. Depois, toque em \"Já adicionei: conferir\".";
/** O que dizer depois de conferir: `status` é o que o backend da máquina deu a este computador. */
export function resultadoDaConferencia(status: "active" | "pending" | null): { texto: string; ok: boolean } {
  if (status === "active") return { texto: "Pronto: este computador entrou. Pode mandar a mensagem de novo.", ok: true };
  if (status === "pending") return { texto: "Ainda não há vaga para este computador. Se você acabou de pagar, espere alguns segundos e confira de novo; a vaga abre quando o pagamento é confirmado.", ok: false };
  return { texto: "A máquina não respondeu agora. Tente conferir de novo em instantes.", ok: false };
}
