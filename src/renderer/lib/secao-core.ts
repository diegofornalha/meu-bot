/**
 * Aberto/fechado das seções que abrem (lib/pagina.ts), puro (testado em secao-core.test.mjs). As páginas repintam
 * tudo a cada ação: o que a pessoa escolheu fica guardado por chave e volta igual no repintar. `atencao` é o motivo
 * (texto livre, "" = nenhum) pelo qual a seção deve abrir sozinha: erro, algo faltando, trabalho em curso.
 */

/** O último clique da pessoa na seção, e o motivo de atenção que estava na tela naquela hora. */
export interface SecaoGuardada { aberta: boolean; atencao: string }

/**
 * Decide se a seção nasce aberta e o que fica guardado.
 * - sem clique guardado: abre com motivo de atenção; sem motivo, vale o `padrao`;
 * - mesmo motivo de quando a pessoa clicou: vale o clique (quem fechou vendo o aviso não o vê reabrir a cada repintar);
 * - motivo novo: abre, sem apagar o clique (passado o motivo novo, volta ao que ela escolheu);
 * - motivo sumiu: vale o clique e o motivo guardado é esquecido, para o mesmo aviso abrir a seção se voltar.
 */
export function resolverSecao(guardada: SecaoGuardada | undefined, padrao: boolean, atencao: string): { aberta: boolean; guardar: SecaoGuardada | undefined } {
  if (guardada === undefined) return { aberta: atencao !== "" || padrao, guardar: undefined };
  if (atencao === guardada.atencao) return { aberta: guardada.aberta, guardar: guardada };
  if (atencao === "") return { aberta: guardada.aberta, guardar: { aberta: guardada.aberta, atencao: "" } };
  return { aberta: true, guardar: guardada };
}
