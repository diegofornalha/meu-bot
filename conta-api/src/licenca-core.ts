/**
 * Licença da conta assinada para UMA máquina (Ed25519), a parte pura: o payload, a assinatura e a conta das vagas.
 *
 * O formato é o que o app e o backend da máquina já conferem (src/main/conta/licenca-assinada-core.ts e
 * backend-colima/licenca.js): `payload` são os bytes JSON exatos em base64url, `sig` a assinatura Ed25519 crua em
 * base64 e `kid` o nome da chave pública. O arquivo devolvido (`licencaJsonV2`) é o `licenca-conta.json` que o app
 * grava na máquina, ao lado do `licenca.json` do admin.
 */
import type { License } from "./tipos.js";

/** Quanto a cópia assinada vale sem renovar (LICENCA_VALIDADE_MS do app); o app renova bem antes. */
export const LICENCA_VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;
/** A chave que assina hoje (LICENCA_PUBLIC_KEYS do app e do backend). */
export const LICENCA_KID = "licenca-2026-11";
/** Quantos devices (Macs com o app) todo plano inclui; acima disso, o admin sobe o limite ou a pessoa compra o device extra. */
export const DEVICES_INCLUSOS = 2;
/** Teto do limite de máquinas de uma conta (validaPatchLicenca). */
export const MAQUINA_LIMITE_MAX = 50;
/** Quantas vezes em 30 dias a conta abre a vaga na hora ao tirar a licença pelo app; além disso a vaga espera a emissão vencer. */
export const TROCAS_NA_HORA = 3;

export interface PayloadLicenca {
  v: 2;
  conta: { id: string; email: string };
  maquina: string;
  emitidaEm: string;
  exp: string;
  licenca: License;
  devices: { id: string; status: "active" | "pending" }[];
}
export interface LicencaAssinada { kid: string; payload: string; sig: string }

const b64 = (b: Uint8Array): string => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const deB64 = (s: string): ArrayBuffer => { const t = atob(s); const b = new Uint8Array(new ArrayBuffer(t.length)); for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i); return b.buffer; };
const b64url = (b: Uint8Array): string => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** O que a API assina: a licença em vigor da conta, para esta máquina, válida por LICENCA_VALIDADE_MS. */
export function montarPayload(conta: { id: string; email: string }, maquina: string, licenca: License, devices: readonly { id: string; status: string }[], agoraMs: number): PayloadLicenca {
  return {
    v: 2, conta: { id: conta.id, email: conta.email }, maquina,
    emitidaEm: new Date(agoraMs).toISOString(), exp: new Date(agoraMs + LICENCA_VALIDADE_MS).toISOString(),
    licenca, devices: devices.map((d) => ({ id: d.id, status: d.status === "pending" ? "pending" as const : "active" as const })),
  };
}

/** Assina o payload com a privada (PKCS#8 DER em base64, o secret LICENCA_PRIVATE_KEY); lança se a chave não presta. */
export async function assinarLicenca(p: PayloadLicenca, privadaB64: string, kid: string = LICENCA_KID): Promise<LicencaAssinada> {
  const chave = await crypto.subtle.importKey("pkcs8", deB64(privadaB64.trim()), { name: "Ed25519" }, false, ["sign"]);
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", chave, bytes));
  return { kid, payload: b64url(bytes), sig: b64(sig) };
}

/** O `licenca-conta.json` inteiro: a cópia legível no topo e o bloco assinado (licencaJsonV2 do app). */
export function licencaJsonV2(p: PayloadLicenca, assinada: LicencaAssinada): Record<string, unknown> {
  return { ...p.licenca, v: 2, conta: p.conta, maquina: p.maquina, emitidaEm: p.emitidaEm, exp: p.exp, assinada };
}

/** Até quando a última emissão sustenta a licença na máquina; null se nunca houve emissão. */
export function valeAte(ultimaEmissaoEm: string | null): string | null {
  if (ultimaEmissaoEm === null || Number.isNaN(Date.parse(ultimaEmissaoEm))) return null;
  return new Date(Date.parse(ultimaEmissaoEm) + LICENCA_VALIDADE_MS).toISOString();
}

export interface Vinculo { id: string; ultimaEmissaoEm: string | null; desvinculadaEm: string | null }
/**
 * A máquina ainda ocupa uma vaga da conta? Vinculada, sim. Desvinculada sem o app apagar a licença de lá (pelo
 * console), continua ocupando até a última emissão vencer: senão uma assinatura serviria várias máquinas, bastando
 * alternar o vínculo.
 */
export function ocupaVaga(m: Vinculo, agoraMs: number): boolean {
  if (m.desvinculadaEm === null) return true;
  const ate = valeAte(m.ultimaEmissaoEm);
  return ate !== null && Date.parse(ate) > agoraMs;
}

export type Admissao = { acao: "renovar" } | { acao: "vincular" } | { erro: string; noLimite: true; ocupadas: string[] };
/**
 * Vincular a máquina `id` à conta: já vinculada só renova; desvinculada que ainda segura a vaga volta sem gastar outra;
 * nova entra enquanto há vaga. Sem vaga, diz quais máquinas a ocupam (o app mostra o nome).
 */
export function admitirMaquina(daConta: readonly Vinculo[], id: string, limite: number, agoraMs: number): Admissao {
  const esta = daConta.find((m) => m.id === id);
  if (esta !== undefined && esta.desvinculadaEm === null) return { acao: "renovar" };
  const ocupadas = daConta.filter((m) => m.id !== id && ocupaVaga(m, agoraMs));
  if (ocupadas.length < limite) return { acao: "vincular" };
  return { erro: limite === 1 ? "a sua conta já usa a licença em outra máquina; tire de lá para usar aqui" : `a sua conta já usa a licença em ${ocupadas.length} de ${limite} máquinas; tire de uma para usar aqui`, noLimite: true, ocupadas: ocupadas.map((m) => m.id) };
}

/**
 * O limite em vigor de máquinas, devices ou usuários de organização: o do plano (`base`) mais uma vaga por unidade
 * extra paga e por unidade de cortesia do admin que ainda não venceram, até `teto` (o das máquinas, DEVICE_LIMITE_MAX
 * ou ASSENTOS_MAX). `extras` diz quantas das vagas são pagas e `cortesias` quantas são cortesia (a tela explica a conta
 * com eles).
 */
export function limiteComExtras(base: number, pagos: readonly { expiresAt: string }[], agoraMs: number, teto: number = MAQUINA_LIMITE_MAX, cortesias: readonly { expiresAt: string }[] = []): { limite: number; extras: number; cortesias: number } {
  const b = Number.isInteger(base) && base >= 1 ? base : 1;
  const emDia = (xs: readonly { expiresAt: string }[]): number => xs.filter((p) => Date.parse(p.expiresAt) > agoraMs).length;
  const pagas = emDia(pagos), deCortesia = emDia(cortesias);
  const limite = Math.min(b + pagas + deCortesia, Math.max(b, teto));
  // No teto, as pagas contam primeiro: a tela não diz "cortesia" de uma vaga que a pessoa pagou.
  const extras = Math.min(pagas, limite - b);
  return { limite, extras, cortesias: limite - b - extras };
}

/**
 * A máquina `id`, já vinculada, ainda cabe no limite para renovar? Cabe sempre que as vinculadas não passam do limite.
 * Quando passam (uma máquina extra venceu ou foi cancelada), renovam as que entraram na conta há mais tempo e as mais
 * novas ficam de fora: sem isso, bastaria pagar um mês de máquina extra e cancelar para ficar com a vaga para sempre.
 * A licença já emitida continua valendo até vencer (LICENCA_VALIDADE_MS), que é a carência.
 */
export function cabeNoLimite(daConta: readonly { id: string; criadaEm: string; desvinculadaEm: string | null }[], id: string, limite: number): boolean {
  const vinculadas = daConta.filter((m) => m.desvinculadaEm === null).sort((a, b) => a.criadaEm.localeCompare(b.criadaEm) || a.id.localeCompare(b.id));
  const posicao = vinculadas.findIndex((m) => m.id === id);
  return posicao !== -1 && posicao < limite;
}

/** Tirar a licença de uma máquina: o app apagou o arquivo de lá e a conta ainda tem trocas → a vaga abre na hora. */
export const abreVagaNaHora = (apagada: boolean, trocasNoPeriodo: number): boolean => apagada && trocasNoPeriodo < TROCAS_NA_HORA;

const APELIDO_RE = /^[^\p{C}]{0,80}$/u;
/** O apelido que o app manda (o nome da máquina na tela); fora do formato vira null. */
export function validaApelido(v: unknown): string | null {
  if (typeof v !== "string" || !APELIDO_RE.test(v)) return null;
  const t = v.trim();
  return t === "" ? null : t;
}
