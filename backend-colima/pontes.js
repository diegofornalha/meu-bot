/**
 * pontes.js — as pontes do app para o agente (Navegador, Gmail e Ferramentas) num só `--mcp-config` e num só
 * `--allowedTools`. Puro, testado. Antes o Navegador montava os dois flags sozinho (navegador.js › browserCliArgs); com
 * o Gmail (31 out) a CLI recebe uma configuração só, com os servidores que estão ligados neste turno. As Ferramentas
 * (os apps que a pessoa contratou, 21 nov) são a terceira ponte, no mesmo molde.
 */
'use strict';

/**
 * `--dono`/`--rotulo` do MCP: a conversa dona das abas (Navegador) e o rótulo da auditoria (Gmail). `--origem whatsapp`
 * quando quem pede é o agente do WhatsApp (Hermes): a aba abre em segundo plano e ganha o selo do WhatsApp.
 */
const dono = (d) => (d && typeof d.id === 'string' ? ['--dono', d.id, '--rotulo', String(d.rotulo || 'conversa do meu-bot').slice(0, 80), ...(d.origem === 'whatsapp' ? ['--origem', 'whatsapp'] : [])] : []);

/**
 * Argumentos extras da CLI para o turno. `browser`/`gmail`/`ferramentas`: `{ port, dono? }` ou null. `navegadorMcp`/
 * `gmailMcp`/`ferramentasMcp`: os .mjs na máquina; `nodeBin` o node do backend. Sem ponte ligada, nada. `snapshotOff`
 * só em CLI ≥ 2.1.257.
 */
function pontesCliArgs({ browser, gmail, ferramentas, nodeBin, navegadorMcp, gmailMcp, ferramentasMcp, snapshotOff }) {
  const servers = {}; const allowed = [];
  if (browser) { servers.navegador = { command: nodeBin, args: [navegadorMcp, '--port', String(browser.port), ...dono(browser.dono)] }; allowed.push('mcp__navegador'); }
  if (gmail) { servers.gmail = { command: nodeBin, args: [gmailMcp, '--port', String(gmail.port), ...dono(gmail.dono)] }; allowed.push('mcp__gmail'); }
  if (ferramentas) { servers.ferramentas = { command: nodeBin, args: [ferramentasMcp, '--port', String(ferramentas.port), ...dono(ferramentas.dono)] }; allowed.push('mcp__ferramentas'); }
  if (allowed.length === 0) return [];
  const args = ['--mcp-config', JSON.stringify({ mcpServers: servers }), '--allowedTools', allowed.join(',')];
  if (snapshotOff) args.push('--system-prompt-snapshot', 'off');
  return args;
}

/** O que entra antes do prompt do turno: as notas das pontes ligadas, uma por linha. */
function pontesTurnoNotas({ browser, gmail, ferramentas, browserNote, gmailNote, ferramentasNote }) {
  return [browser ? browserNote() : null, gmail ? gmailNote() : null, ferramentas ? ferramentasNote() : null].filter(Boolean);
}

module.exports = { pontesCliArgs, pontesTurnoNotas };
