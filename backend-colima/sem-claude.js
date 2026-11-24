/**
 * sem-claude.js — a marca de que o Claude desta conta está fora do ar, para o WhatsApp ficar em silêncio.
 *
 * Quando o agente do WhatsApp (perfil "whatsapp", Hermes) não consegue resposta de nenhum provedor, o Hermes manda ao
 * contato "Your request was not processed. Send it again…", a cada mensagem. Ele não tem como ser calado depois que o
 * turno abriu: rejeita o marcador de silêncio numa conversa com uma pessoa e não tem gancho na mensagem de saída. O
 * que dá é não abrir o turno: o backend grava esta marca ao ver a falha, e o plugin meu-bot-pausa (gancho
 * pre_gateway_dispatch) guarda a mensagem que chega e a descarta enquanto a marca vale, como faz com o contato pausado.
 *
 * A marca vale pouco (VALE_MS) e quem a renova é a sonda do server.js, que tenta o Claude sozinha: com o backend
 * parado ou a sonda morta ela vence e as mensagens voltam a passar (fail-open). Nenhuma mensagem de cliente serve de
 * teste. Arquivo: ~/.local/share/meu-bot/sem-claude.json = { desde, ate, motivo } (ISO 8601).
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ARQUIVO = path.join(os.homedir(), '.local', 'share', 'meu-bot', 'sem-claude.json');
/** Quanto a marca vale sem ser renovada. A sonda renova a cada SONDA_MS; três falhas seguidas dela ainda cabem. */
const VALE_MS = 10 * 60 * 1000;
const SONDA_MS = 2 * 60 * 1000;
const PAUSADOS = path.join(os.homedir(), '.local', 'share', 'meu-bot', 'whatsapp-pausados.jsonl');
/** O `motivo` das linhas que o plugin guarda por esta marca (as da pausa de contato não têm). */
const MOTIVO_LINHA = 'sem-claude';

const ler = (arq) => { try { const v = JSON.parse(fs.readFileSync(arq, 'utf8')); return v && typeof v === 'object' ? v : null; } catch (_) { return null; } };

/** A marca em vigor ({desde, ate, motivo}), ou null (sem arquivo, ilegível ou vencida). */
function estado(agora = Date.now(), arq = ARQUIVO) {
  const v = ler(arq);
  if (!v || typeof v.desde !== 'string' || typeof v.ate !== 'string') return null;
  const ate = Date.parse(v.ate);
  if (!Number.isFinite(ate) || ate <= agora || !Number.isFinite(Date.parse(v.desde))) return null;
  return { desde: v.desde, ate: v.ate, motivo: typeof v.motivo === 'string' ? v.motivo : '' };
}

/** Grava (ou renova) a marca. Devolve { novo, desde }: `novo` quando a queda começou agora. */
function marcar(motivo, agora = Date.now(), arq = ARQUIVO) {
  const antes = estado(agora, arq);
  const v = { desde: antes ? antes.desde : new Date(agora).toISOString(), ate: new Date(agora + VALE_MS).toISOString(), motivo: String(motivo || '').replace(/\s+/g, ' ').slice(0, 200) };
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(v)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, arq);
  return { novo: antes === null, desde: v.desde };
}

/** Tira a marca. Devolve a que valia (para avisar que voltou) ou null. */
function limpar(agora = Date.now(), arq = ARQUIVO) {
  const antes = estado(agora, arq);
  try { fs.unlinkSync(arq); } catch (_) { /* já não havia */ }
  return antes;
}

/** Quantas mensagens o plugin guardou por causa da marca desde `desde` (ISO). */
function guardadasDesde(desde, arq = PAUSADOS) {
  const t0 = Date.parse(desde);
  let texto;
  try { texto = fs.readFileSync(arq, 'utf8'); } catch (_) { return 0; }
  let n = 0;
  for (const linha of texto.split('\n')) {
    if (!linha.includes(MOTIVO_LINHA)) continue;
    try { const d = JSON.parse(linha); if (d.motivo === MOTIVO_LINHA && Date.parse(d.em) >= t0) n += 1; } catch (_) { /* linha quebrada */ }
  }
  return n;
}

const hora = (iso, fuso) => { try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: fuso }); } catch (_) { return new Date(iso).toISOString().slice(11, 16); } };
/** O aviso ao dono quando a queda começa. */
const avisoCaiu = (m, fuso) => `⚠️ meu-bot: o Claude desta máquina parou de responder às ${hora(m.desde, fuso)}${m.motivo ? ` (${m.motivo})` : ''}. Enquanto isso, quem escrever no WhatsApp não recebe resposta nem mensagem de erro; o que chegar fica guardado. Eu aviso quando ele voltar.`;
/** O aviso ao dono quando o Claude volta, com quantas mensagens ficaram guardadas. */
const avisoVoltou = (m, guardadas, agora, fuso) => `✅ meu-bot: o Claude voltou às ${hora(new Date(agora).toISOString(), fuso)} (estava fora desde ${hora(m.desde, fuso)}). ${guardadas === 0 ? 'Nenhuma mensagem chegou nesse tempo.' : guardadas === 1 ? '1 mensagem chegou nesse tempo e ficou sem resposta; o agente a recebe quando a pessoa escrever de novo.' : `${guardadas} mensagens chegaram nesse tempo e ficaram sem resposta; o agente as recebe quando cada pessoa escrever de novo.`}`;

module.exports = { ARQUIVO, VALE_MS, SONDA_MS, MOTIVO_LINHA, estado, marcar, limpar, guardadasDesde, avisoCaiu, avisoVoltou };
