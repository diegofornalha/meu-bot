// Cortesias: o que o admin libera de graça (tabela `cortesias`, migração 0023), separado do que a pessoa paga. Toda
// cortesia tem prazo (`fim`, até CORTESIA_DIAS_MAX dias), quem liberou e o motivo, e acaba sozinha no prazo. Puro (sem
// D1): a gravação fica em db.ts, as rotas em rotas/cortesias.ts. A licença assinada que vai para a máquina não muda de
// formato: a cortesia entra pelos mesmos caminhos do que é pago (o Pro como um prazo, o add-on e as unidades como itens
// com `expiresAt`), e só o `GET /conta` e a visão do admin dizem de onde cada coisa vem.

export const TIPOS_CORTESIA = ["pro", "addon", "maquina", "device", "assento"] as const;
export type TipoCortesia = (typeof TIPOS_CORTESIA)[number];
/** Prazo máximo de uma cortesia, e o que a tela sugere. */
export const CORTESIA_DIAS_MAX = 365, CORTESIA_DIAS_PADRAO = 30;
/** Quantas unidades (máquinas, devices, usuários) uma cortesia pode dar de uma vez. */
export const CORTESIA_QTD_MAX = 50;
const MOTIVO_MIN = 3, MOTIVO_MAX = 300;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Uma cortesia como a API a devolve (console da pessoa e do admin). `orgId` só no tipo "assento". */
export interface Cortesia { id: string; tipo: TipoCortesia; produto: string | null; orgId: string | null; quantidade: number; inicio: string; fim: string; motivo: string; por: string; encerradaEm: string | null }
/** O que o admin pede em `POST /admin/contas/:id/cortesias`; `org` é o endereço (slug) da organização, só no "assento". */
export interface PedidoCortesia { tipo: TipoCortesia; produto: string | null; org: string | null; quantidade: number; fim: string; motivo: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const ehTipoCortesia = (v: unknown): v is TipoCortesia => typeof v === "string" && (TIPOS_CORTESIA as readonly string[]).includes(v);

/** A cortesia vale agora: não foi encerrada e o prazo está no futuro. */
export const cortesiaValida = (c: Pick<Cortesia, "fim" | "encerradaEm">, agoraMs: number): boolean => c.encerradaEm === null && Date.parse(c.fim) > agoraMs;

/** O prazo de uma cortesia: data ISO no futuro, até CORTESIA_DIAS_MAX dias a partir de agora. Devolve o ISO normalizado ou null. */
export function validaFimCortesia(v: unknown, agoraMs: number): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(v)) return null;
  const t = Date.parse(v);
  if (Number.isNaN(t) || t <= agoraMs || t > agoraMs + CORTESIA_DIAS_MAX * DIA_MS) return null;
  return new Date(t).toISOString();
}
/** O motivo escrito pelo admin: de MOTIVO_MIN a MOTIVO_MAX caracteres, sem caracteres de controle. */
export function validaMotivo(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= MOTIVO_MIN && t.length <= MOTIVO_MAX && !/\p{C}/u.test(t) ? t : null;
}

/**
 * O pedido de cortesia do admin. `catalogo` são os add-ons do ambiente: só eles podem ser dados. Pro e add-on são uma
 * unidade só; máquina, device e usuário aceitam de 1 a CORTESIA_QTD_MAX. O usuário de organização precisa do endereço
 * da organização (a rota confere que a conta é a dona dela).
 */
export function validaCortesia(raw: unknown, agoraMs: number, catalogo: readonly string[]): PedidoCortesia | { erro: string } {
  if (!isObj(raw)) return { erro: "corpo inválido" };
  if (!ehTipoCortesia(raw.tipo)) return { erro: `tipo: ${TIPOS_CORTESIA.join(", ")}` };
  const tipo = raw.tipo;
  let produto: string | null = null, org: string | null = null, quantidade = 1;
  if (tipo === "addon") {
    if (typeof raw.produto !== "string" || !catalogo.includes(raw.produto)) return { erro: "produto: um add-on à venda neste ambiente" };
    produto = raw.produto;
  }
  if (tipo === "assento") {
    if (typeof raw.org !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(raw.org)) return { erro: "org: o endereço da organização" };
    org = raw.org;
  }
  if (tipo === "maquina" || tipo === "device" || tipo === "assento") {
    const q = raw.quantidade ?? 1;
    if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > CORTESIA_QTD_MAX) return { erro: `quantidade: inteiro de 1 a ${CORTESIA_QTD_MAX}` };
    quantidade = q;
  }
  const fim = validaFimCortesia(raw.fim, agoraMs);
  if (fim === null) return { erro: `fim: uma data no futuro, até ${CORTESIA_DIAS_MAX} dias a partir de hoje` };
  const motivo = validaMotivo(raw.motivo);
  if (motivo === null) return { erro: `motivo: de ${MOTIVO_MIN} a ${MOTIVO_MAX} caracteres` };
  return { tipo, produto, org, quantidade, fim, motivo };
}

/**
 * As vagas que as cortesias de `tipo` dão, no formato dos extras pagos (uma por unidade, com o prazo), para entrarem em
 * `limiteComExtras`. `orgId` filtra as de usuário de uma organização. Encerradas não entram; vencidas entram e o prazo
 * as descarta, como nos extras pagos.
 */
export function unidadesDeCortesia(cs: readonly Cortesia[], tipo: "maquina" | "device" | "assento", orgId: string | null = null): { expiresAt: string }[] {
  return cs.filter((c) => c.tipo === tipo && c.encerradaEm === null && (tipo !== "assento" || c.orgId === orgId)).flatMap((c) => Array.from({ length: c.quantidade }, () => ({ expiresAt: c.fim })));
}
/** Os add-ons de cortesia no formato dos add-ons pagos (`licencaEmVigor`), para valerem pelas mesmas regras. */
export function addonsDeCortesia(cs: readonly Cortesia[]): { produto: string; expiresAt: string }[] {
  return cs.filter((c) => c.tipo === "addon" && c.produto !== null && c.encerradaEm === null).map((c) => ({ produto: c.produto!, expiresAt: c.fim }));
}
/** Até quando vale o Pro de cortesia (o prazo mais longo entre as válidas); null quando não há nenhuma valendo. */
export function fimDoProDeCortesia(cs: readonly Cortesia[], agoraMs: number): string | null {
  let fim: string | null = null;
  for (const c of cs) if (c.tipo === "pro" && cortesiaValida(c, agoraMs) && (fim === null || Date.parse(c.fim) > Date.parse(fim))) fim = c.fim;
  return fim;
}

/**
 * De onde vem o Pro que a conta tem agora, para as telas dizerem "Pago", "Cortesia até …", "Teste", "Pela organização"
 * ou "∞": `super` (super admin), `teste` (teste grátis), `organizacao` (usuário coberto), `cortesia` (o admin deu),
 * `pago` (assinatura ou Pix) e `admin` (gravado à mão pelo super admin no ajuste técnico, sem pagamento). null sem Pro.
 * `pelaOrg` e `porCortesia` dizem se a licença final veio da organização ou da cortesia; `pagou` se há pagamento do Pro.
 */
export type OrigemPro = "super" | "teste" | "organizacao" | "cortesia" | "pago" | "admin";
export function origemDoPro(p: { papel: "super" | "admin" | null; licenca: { plan: string; status: string; expiresAt: string | null }; pelaOrg: boolean; porCortesia: boolean; pagou: boolean; agoraMs: number }): OrigemPro | null {
  if (p.papel === "super") return "super";
  const l = p.licenca;
  const valendo = l.plan === "pro" && (l.status === "active" || l.status === "trialing") && (l.expiresAt === null || Date.parse(l.expiresAt) > p.agoraMs);
  if (!valendo) return null;
  if (l.status === "trialing") return "teste";
  if (p.pelaOrg) return "organizacao";
  if (p.porCortesia) return "cortesia";
  return p.pagou ? "pago" : "admin";
}

/** Por que o admin encerra algo (Pro, add-on, unidade extra, usuário de organização ou cortesia) antes do prazo. */
export const MOTIVOS_ENCERRAMENTO = ["reembolso", "disputa", "pedido-da-pessoa", "erro-ou-teste", "outro"] as const;
export type MotivoEncerramento = (typeof MOTIVOS_ENCERRAMENTO)[number];
/** `{motivo, detalhe}` do encerramento: o motivo da lista; o detalhe é livre (até MOTIVO_MAX) e obrigatório em "outro". */
export function validaEncerramento(raw: unknown): { motivo: MotivoEncerramento; detalhe: string | null } | { erro: string } {
  if (!isObj(raw) || typeof raw.motivo !== "string" || !(MOTIVOS_ENCERRAMENTO as readonly string[]).includes(raw.motivo)) return { erro: `motivo: ${MOTIVOS_ENCERRAMENTO.join(", ")}` };
  const motivo = raw.motivo as MotivoEncerramento;
  const vazio = raw.detalhe === undefined || raw.detalhe === null || (typeof raw.detalhe === "string" && raw.detalhe.trim() === "");
  if (vazio) return motivo === "outro" ? { erro: "detalhe: diga o motivo" } : { motivo, detalhe: null };
  const detalhe = validaMotivo(raw.detalhe);
  return detalhe === null ? { erro: `detalhe: de ${MOTIVO_MIN} a ${MOTIVO_MAX} caracteres` } : { motivo, detalhe };
}
