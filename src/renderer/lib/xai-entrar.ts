/**
 * "Entrar na xAI" abre o guia (tutorial 4) ou vai direto ao login? Puro, com teste.
 *
 * Vai ao guia quem ainda não concluiu o tutorial, e também quem o concluiu mas está numa máquina sem o preparo do
 * Grok (o login direto ali só terminava em "código 127"). "Sem o preparo" só vale quando a consulta da conta já
 * TERMINOU sem erro e voltou vazia: antes do primeiro carregamento, ou com a consulta por SSH falhando por um
 * instante, o estado também é vazio, e mandar ao guia quem já tem o Grok pronto seria um passo atrás.
 */
export interface XaiEntrar {
  /** O Grok pode ser preparado por este app nesta janela (caps.install). */
  podeInstalar: boolean;
  /** O tutorial 4 está lembrado como concluído. */
  tutorialFeito: boolean;
  /** A consulta da conta da xAI já terminou sem erro nesta janela. */
  conferida: boolean;
  /** A consulta trouxe a conta (o programa do login existe na máquina). */
  preparado: boolean;
}
export const xaiVaiAoGuia = (e: XaiEntrar): boolean => e.podeInstalar && (!e.tutorialFeito || (e.conferida && !e.preparado));
