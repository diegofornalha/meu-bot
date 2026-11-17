/**
 * Fontes do GuideContext. Cada módulo dono registra, no próprio `ligar…()`, a fatia do contexto que ele conhece: os
 * dados dos campos dele e se a fonte já respondeu nesta janela (`known`). `montarGuideCtx()` junta as fatias; o
 * guia não sabe de onde vem cada campo. Sem import de módulo de domínio aqui (não há ciclo).
 */
import { emptyContext, GUIDE_SOURCES, type GuideContext, type GuideSource } from "../lib/tutoriais.js";

export type DadosGuia = Omit<GuideContext, "known">;
export type FatiaGuia = { known: boolean; dados: Partial<DadosGuia> };
/** Que campos do contexto cada fonte preenche. Puro e testado: cada campo tem exatamente uma fonte dona. */
export const CAMPOS_POR_FONTE: Record<GuideSource, readonly (keyof DadosGuia)[]> = {
  whatsapp: ["digitando"], claude: ["claude"], statusline: ["statusLine"], xai: ["xai"], fallback: ["fallback"], support: ["support"],
  objective: ["objective"], guarda: ["guarda"], navegador: ["navegador"], crm: ["crm", "produto"], grupos: ["grupos"],
  contas: ["contas"], finance: ["finance"], linkpublico: ["linkPublico", "linkPublicoPossivel"], quickentry: ["quickEntry"], google: ["gmail"],
};

const fontes = new Map<GuideSource, () => FatiaGuia>();
/** Registra a fatia de uma fonte; a mesma fonte duas vezes é erro de programação. */
export function registrarFonte(fonte: GuideSource, f: () => FatiaGuia): void {
  if (fontes.has(fonte)) throw new Error(`fonte ${fonte} registrada duas vezes`);
  fontes.set(fonte, f);
}
/** O contexto inteiro, montado das fatias registradas (fonte sem registro fica no vazio de `emptyContext`, desconhecida). */
export function montarGuideCtx(): GuideContext {
  const c = emptyContext();
  for (const [fonte, f] of fontes) { const { known, dados } = f(); Object.assign(c, dados); c.known[fonte] = known; }
  return c;
}
/** Fontes que ninguém registrou (o renderer confere no fim da montagem da janela). */
export const conferirFontes = (): GuideSource[] => GUIDE_SOURCES.filter((f) => !fontes.has(f));
/** Só para os testes. */
export function limparFontes(): void { fontes.clear(); }
