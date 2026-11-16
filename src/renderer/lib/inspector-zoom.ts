/**
 * Escala da interface do MCP Inspector dentro da página. A interface oficial tem largura mínima fixa (`#root
 * { min-width: 1280px }` no CSS dela): num painel mais estreito ela não se ajusta, só corta à direita. A página reduz
 * o zoom do <webview> para a interface inteira caber. Puro, com teste.
 */

/** Largura mínima da interface do Inspector (CSS dela, versão 2.13.0). */
export const INSPECTOR_LARGURA_MIN = 1280;
/** Abaixo disso o texto fica ilegível: daí para baixo a página deixa rolar para o lado. */
export const INSPECTOR_ZOOM_MIN = 0.5;

/** Teto do zoom final: acima disso a interface vira uma lupa. */
export const INSPECTOR_ZOOM_MAX = 3;

/**
 * Zoom do <webview> para um painel de `larguraCss` px, com a janela do app em `zoomJanela` (Cmd+= / Cmd+-; 1 = 100%).
 * · Sem zoom da janela: a interface encolhe até caber (de 0.5 a 1).
 * · Com zoom: o painel mede menos px de CSS, mas a tela é a mesma; a conta de caber usa a largura de verdade
 *   (`larguraCss × zoomJanela`) e o resultado é multiplicado pelo zoom da janela. Assim Cmd+= aumenta a letra do
 *   Inspector como aumenta o resto do app (a interface passa a rolar para o lado), em vez de encolhê-la ainda mais.
 * Medida inválida = 1.
 */
export function zoomDoInspector(larguraCss: number, zoomJanela = 1): number {
  const z = Number.isFinite(zoomJanela) && zoomJanela > 0 ? zoomJanela : 1;
  if (!Number.isFinite(larguraCss) || larguraCss <= 0) return 1;
  const largura = larguraCss * z;
  const caber = largura >= INSPECTOR_LARGURA_MIN ? 1 : Math.max(INSPECTOR_ZOOM_MIN, largura / INSPECTOR_LARGURA_MIN);
  return Math.min(INSPECTOR_ZOOM_MAX, Math.round(caber * z * 100) / 100);
}
