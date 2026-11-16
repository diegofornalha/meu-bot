/**
 * Escala da interface do MCP Inspector dentro da página. A interface oficial tem largura mínima fixa (`#root
 * { min-width: 1280px }` no CSS dela): num painel mais estreito ela não se ajusta, só corta à direita. A página reduz
 * o zoom do <webview> para a interface inteira caber. Puro, com teste.
 */

/** Largura mínima da interface do Inspector (CSS dela, versão 2.13.0). */
export const INSPECTOR_LARGURA_MIN = 1280;
/** Abaixo disso o texto fica ilegível: daí para baixo a página deixa rolar para o lado. */
export const INSPECTOR_ZOOM_MIN = 0.5;

/** Zoom (0.5 a 1) para a interface caber em `largura` px; largura inválida ou folgada = 1. */
export function zoomDoInspector(largura: number): number {
  if (!Number.isFinite(largura) || largura <= 0 || largura >= INSPECTOR_LARGURA_MIN) return 1;
  return Math.max(INSPECTOR_ZOOM_MIN, Math.round((largura / INSPECTOR_LARGURA_MIN) * 100) / 100);
}
