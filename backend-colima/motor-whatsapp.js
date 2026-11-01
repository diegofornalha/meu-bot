'use strict';
/**
 * Qual motor atende o WhatsApp desta máquina: o espelho em JS da regra única do app (WA_MOTOR_SH em
 * src/main/whatsapp/whatsapp-capacidades.ts), para o backend decidir por onde mandar mensagem (server.js › sendWhatsapp).
 * Precedência: a escolha gravada em ~/.local/share/meu-bot/whatsapp-agente (hermes, openclaw ou picoclaw, exata, como no
 * shell) > Hermes já com o WhatsApp configurado (~/.hermes/whatsapp) > binário openclaw (no PATH ou ~/.openclaw/bin)
 * > binário hermes (PATH ou ~/.local/bin) > picoclaw (PATH ou ~/.local/bin) com ~/.picoclaw/config.json.
 * scripts/tests/motor-whatsapp.test.mjs roda o shell e este módulo lado a lado e exige o mesmo resultado.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MOTORES = ['hermes', 'openclaw', 'picoclaw'];
const existeDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };
const existeArq = (p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };
const executavel = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch (_) { return false; } };
/** `command -v <bin>`: um executável com esse nome em alguma pasta do PATH. */
const noPath = (bin, PATH) => String(PATH || '').split(':').some((d) => d !== '' && executavel(path.join(d, bin)));

/** `{ motor, escolha }`: `motor` = hermes | openclaw | picoclaw | null; `escolha` = o que está gravado (ou ''). */
function motorWhatsapp({ home = os.homedir(), PATH = process.env.PATH } = {}) {
  let escolha = '';
  try { escolha = fs.readFileSync(path.join(home, '.local', 'share', 'meu-bot', 'whatsapp-agente'), 'utf8').replace(/[ \n]/g, ''); } catch (_) { /* sem escolha */ }
  let motor = MOTORES.includes(escolha) ? escolha : null;
  if (motor === null && existeDir(path.join(home, '.hermes', 'whatsapp'))) motor = 'hermes';
  if (motor === null && (noPath('openclaw', PATH) || executavel(path.join(home, '.openclaw', 'bin', 'openclaw')))) motor = 'openclaw';
  if (motor === null && (noPath('hermes', PATH) || executavel(path.join(home, '.local', 'bin', 'hermes')))) motor = 'hermes';
  if (motor === null && (noPath('picoclaw', PATH) || executavel(path.join(home, '.local', 'bin', 'picoclaw'))) && existeArq(path.join(home, '.picoclaw', 'config.json'))) motor = 'picoclaw';
  return { motor, escolha };
}

module.exports = { motorWhatsapp };
