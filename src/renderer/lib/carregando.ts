/**
 * Indicador de espera único das telas: ponto pulsando, o tempo decorrido depois de alguns segundos e, se a máquina
 * demorar, o aviso de que continua buscando. Antes era um "Consultando…" cinza parado: com SSH e túnel lentos (10–20 s)
 * parecia travado ou que tinha dado errado, e a pessoa clicava de novo (26 out).
 */
import { el } from "./dom.js";

/** A partir de quando mostrar o tempo e o aviso de demora. */
export const MOSTRA_TEMPO_S = 3;
export const DEMORA_S = 10;

export const AVISO_DEMORA = "A máquina está respondendo devagar; continuo buscando. Não precisa clicar de novo.";

/**
 * O texto da espera depois de `segundos`: o rótulo, o tempo (≥ 3 s) e o aviso de demora (≥ 10 s). Puro. `avisoDemora`
 * troca o aviso quando a espera não é uma busca (a cópia no Drive leva perto de um minuto por natureza, 1 nov).
 */
export function textoEspera(rotulo: string, segundos: number, avisoDemora: string = AVISO_DEMORA): { linha: string; aviso: string | null } {
  const s = Math.max(0, Math.floor(segundos));
  const linha = s >= MOSTRA_TEMPO_S ? `${rotulo} ${s} s` : rotulo;
  const aviso = s >= DEMORA_S ? avisoDemora : null;
  return { linha, aviso };
}

// A tela se redesenha inteira várias vezes durante uma espera: o relógio é por rótulo e só zera depois de o
// indicador ficar um tempo fora da tela (a espera acabou), senão o "7 s" voltaria a "0 s" a cada repintura.
const inicio = new Map<string, { desde: number; vistoEm: number }>();
const ESQUECE_MS = 2000;

/** Elemento de espera para pôr no lugar do dado que ainda não chegou. `chave` separa duas esperas com o mesmo texto. */
export function carregando(rotulo: string, chave: string = rotulo, avisoDemora: string = AVISO_DEMORA): HTMLElement {
  const agora = Date.now();
  const atual = inicio.get(chave);
  const desde = atual !== undefined && agora - atual.vistoEm < ESQUECE_MS ? atual.desde : agora;
  inicio.set(chave, { desde, vistoEm: agora });
  const box = el("div", "carregando"); box.setAttribute("role", "status");
  const linha = el("div", "carregando-linha");
  const texto = el("span", "", rotulo);
  linha.append(el("span", "wa-pulse"), texto);
  const aviso = el("p", "hint carregando-aviso"); aviso.hidden = true;
  box.append(linha, aviso);
  const pinta = (): void => {
    const t = textoEspera(rotulo, (Date.now() - desde) / 1000, avisoDemora);
    texto.textContent = t.linha; aviso.hidden = t.aviso === null; aviso.textContent = t.aviso ?? "";
  };
  pinta();
  // Para sozinho quando a tela troca o indicador pelo dado (o elemento sai do documento).
  const timer = window.setInterval(() => {
    if (!box.isConnected) { window.clearInterval(timer); return; }
    inicio.set(chave, { desde, vistoEm: Date.now() }); pinta();
  }, 1000);
  return box;
}
