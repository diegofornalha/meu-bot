'use strict';
/**
 * Quanto um turno da CLI pode durar. Até 25 nov 2026 era um relógio só, de 10 min corridos: um trabalho longo (vários
 * agentes em segundo plano renderizando vídeo) era morto no meio, com a CLI viva e produzindo. Agora são dois:
 *
 *  - silêncio (TURN_IDLE_MS, padrão 15 min): a CLI não escreveu nada no stdout nesse tempo. É o sinal de travada. Todo
 *    evento conta, inclusive os dos subagentes e os `task_progress` das tarefas em segundo plano; o que fica calado é
 *    uma ferramenta só rodando, e o Bash da CLI não passa de 10 min. Por isso o padrão fica acima disso.
 *  - total (TURN_TIMEOUT_MS, padrão 2 h): teto para um turno que não para de produzir. Máquina que já tinha
 *    TURN_TIMEOUT_MS no .env continua com o valor dela.
 */
const MIN = 60 * 1000;
const OCIOSO_PADRAO_MS = 15 * MIN;
const TOTAL_PADRAO_MS = 120 * MIN;

const positivo = (v, padrao) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : padrao; };

/** Os dois limites, lidos do .env do backend. Valor ausente, zero ou inválido vira o padrão. */
function limitesDoTurno(env) {
  const e = env || {};
  return { ociosoMs: positivo(e.TURN_IDLE_MS, OCIOSO_PADRAO_MS), totalMs: positivo(e.TURN_TIMEOUT_MS, TOTAL_PADRAO_MS) };
}

/** "45 s", "15 min", "2 h", "1 h 30 min": para a mensagem que a pessoa lê. */
function duracao(ms) {
  if (ms < MIN) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const min = Math.round(ms / MIN);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60); const resto = min % 60;
  return resto === 0 ? `${h} h` : `${h} h ${resto} min`;
}

/** O texto do erro, que chega à conversa como `[erro agente: …]`. */
function mensagemDoLimite(qual, limites) {
  const como = 'Mande "continua" para eu seguir de onde parei.';
  if (qual === 'ocioso') return `o Claude Code ficou ${duracao(limites.ociosoMs)} sem dar sinal e foi encerrado. ${como}`;
  return `o trabalho passou de ${duracao(limites.totalMs)} numa mensagem só e foi encerrado. ${como}`;
}

/**
 * Vigia um turno: chama `aoEstourar('ocioso' | 'total')` uma vez, no primeiro limite que vencer. `sinal()` a cada
 * dado que a CLI escreve zera o relógio do silêncio; `parar()` quando o turno acaba.
 */
function vigiarTurno(limites, aoEstourar) {
  let parado = false; let ocioso = null;
  const parar = () => { parado = true; clearTimeout(ocioso); clearTimeout(total); };
  const estourar = (qual) => { if (parado) return; parar(); aoEstourar(qual); };
  const total = setTimeout(() => estourar('total'), limites.totalMs);
  const sinal = () => { if (parado) return; clearTimeout(ocioso); ocioso = setTimeout(() => estourar('ocioso'), limites.ociosoMs); };
  sinal();
  return { sinal, parar };
}

module.exports = { OCIOSO_PADRAO_MS, TOTAL_PADRAO_MS, limitesDoTurno, duracao, mensagemDoLimite, vigiarTurno };
