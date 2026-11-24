#!/usr/bin/env node
/**
 * claude-porteiro.js — o porteiro do `claude` nesta máquina. Fica na frente do Claude Code (o shim
 * claude-porteiro.sh em ~/.local/share/meu-bot/bin/claude) e escolhe a conta do Claude pelo mesmo registro do
 * backend (contas-claude.js, ao lado): o login padrão da máquina é a base; as contas extras entram na ordem de
 * preferência quando a atual bate o limite. Vale para quem chamar `claude`: o OpenClaw (WhatsApp), o Terminal do
 * app, a pessoa no shell. O backend não passa por aqui (ele já faz o rodízio com retry no mesmo turno).
 *
 * Dois modos, decididos pelo shim:
 *  --env  args…        imprime `export …` da conta escolhida (interativo: o shim faz eval e exec do claude real).
 *  --run REAL args…    roda o claude real com a conta escolhida repassando a saída stream-json intacta e, nas
 *                      linhas de rate limit, anota o uso; limite rejeitado = marca a conta esgotada, anota o evento e
 *                      sai com 1 depois do `result`, para o OpenClaw não reaproveitar o processo (o próximo turno
 *                      nasce num processo novo, que vem parar aqui e sai na próxima conta com o mesmo --resume).
 *                      Limite antes de qualquer conteúdo (o caso do Claude Code Global esgotado): troca de conta no
 *                      mesmo turno, relançando o claude com os mesmos argumentos, sem a pessoa ver o erro.
 * Regra de ouro: nunca bloquear. Qualquer erro aqui → claude real com o login padrão, como sem o porteiro.
 * Sem dependências npm. Mesmo arquivo em backend-colima/ e backend-vm/services/ (copiar, não editar só um).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MODO = process.argv[2];
const ARGS = process.argv.slice(MODO === '--run' ? 4 : 3);
const REAL = MODO === '--run' ? process.argv[3] : null;
/** Para o filho (e qualquer `claude` chamado por ele) não entrar no porteiro de novo. */
const ENV_FILHO = { MEU_BOT_PORTEIRO: '0' };

const quoteSh = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
const exportar = (env) => Object.entries(env).map(([k, v]) => `export ${k}=${quoteSh(v)}`).join('\n');
const origem = () => (process.env.MEU_BOT_ORIGEM || (process.stdin.isTTY ? 'terminal' : 'cli')).slice(0, 20);
const aviso = (t) => { try { process.stderr.write(`meu-bot: ${t}\n`); } catch (_) { /* sem stderr */ } };

/** Abre o registro de contas; null quando não dá (sem módulo, sem pasta): o chamador segue com o padrão. */
function abrirContas() {
  try {
    const contasClaude = require(path.join(__dirname, 'contas-claude.js'));
    const base = process.env.MEU_BOT_BASE || path.join(os.homedir(), '.local', 'share', 'meu-bot');
    return contasClaude.abrir({ base, log: () => {} });
  } catch (_) { return null; }
}

/** A conta para esta chamada: a melhor livre; sem nenhuma, o padrão mesmo assim (com aviso), nunca "não". */
function escolherConta(contas) {
  const conta = contas.escolher({ permitirAviso: true });
  if (conta !== null) return { conta, semLivre: false };
  return { conta: contas.conta('padrao'), semLivre: true };
}

function modoEnv() {
  const contas = abrirContas();
  if (contas === null) { process.stdout.write(`${exportar(ENV_FILHO)}\n`); return 0; }
  const { conta, semLivre } = escolherConta(contas);
  const env = { ...ENV_FILHO, ...contas.ambiente(conta) };
  if (semLivre) {
    const volta = contas.proximaDisponivelEm();
    aviso(`todas as contas do Claude estão no limite${volta ? ` (a próxima volta ${new Date(volta * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})` : ''}; seguindo na conta padrão`);
  } else if (conta.id !== 'padrao') aviso(`usando a conta do Claude "${conta.rotulo}"`);
  process.stdout.write(`${exportar(env)}\n`);
  return 0;
}

function modoRun() {
  const contas = abrirContas();
  const escolha = contas === null ? null : escolherConta(contas);
  const conta = escolha === null ? null : escolha.conta;
  const env = { ...process.env, ...ENV_FILHO, ...(contas === null || conta === null ? {} : contas.ambiente(conta)) };
  if (escolha !== null && escolha.semLivre) aviso('todas as contas do Claude estão no limite; seguindo na conta padrão');
  const contasClaude = (() => { try { return require(path.join(__dirname, 'contas-claude.js')); } catch (_) { return null; } })();
  // MEU_BOT_FORCAR_LIMITE=<id>: teste de rodízio sem gastar cota (mesma semântica do backend): esta chamada dessa conta vira rejeitada.
  const forcar = conta !== null && process.env.MEU_BOT_FORCAR_LIMITE === conta.id;

  // Troca no mesmo turno: se a conta bate o limite antes de qualquer conteúdo (o rate_limit_event rejeitado vem no
  // começo), mata o claude, marca a conta esgotada e relança com a próxima, com os mesmos argumentos (o --resume do
  // OpenClaw inclusive). As linhas do filho ficam seguradas até o primeiro conteúdo, para o result de limite da conta
  // esgotada não chegar ao OpenClaw como resposta. Depois que algum conteúdo saiu, a saída passa intacta como antes.
  const tentadas = [];
  let contaAtual = conta; let envAtual = env;
  let child = null; let resto = ''; let rejeitado = false; let resets = null; let encerrando = false;
  let viuConteudo = false; let fila = [];
  const escrever = (l) => process.stdout.write(`${l}\n`);
  const liberar = () => { viuConteudo = true; for (const l of fila) escrever(l); fila = []; };
  const encerrar = (sig) => { encerrando = true; try { if (child) child.kill(sig); } catch (_) { /* já saiu */ } };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => encerrar(sig));

  function marcarLimite(motivoCurto, motivoEvento) {
    try {
      contas.marcar(contaAtual.id, 'esgotada', motivoCurto, resets);
      const proxima = contas.escolher({ excluir: [...tentadas, contaAtual.id], permitirAviso: true });
      contas.registrarEvento({ origem: origem(), de: contaAtual.rotulo, para: proxima ? proxima.rotulo : null, motivo: motivoEvento, resets });
      return proxima;
    } catch (_) { return null; }
  }

  function olhar(linha, filho) {
    if (filho !== child) return; // filho antigo, já trocado
    let ev = null; try { ev = JSON.parse(linha); } catch (_) { ev = null; }
    if (!ev || typeof ev !== 'object') { if (viuConteudo) escrever(linha); else fila.push(linha); return; }
    const temRegistro = contas !== null && contasClaude !== null && contaAtual !== null;
    const rl = temRegistro && (ev.type === 'rate_limit_event' || ev.type === 'system' || ev.type === 'result' || ev.rate_limit_info) ? contasClaude.analisarRateLimit(ev) : null;
    if (rl !== null) {
      try { if (Object.keys(rl.janelas).length) contas.registrarUso(contaAtual.id, rl.janelas); } catch (_) { /* registro é cortesia */ }
      if (rl.rejeitado) { rejeitado = true; resets = rl.resets; }
    }
    if (rl !== null && rl.rejeitado && !viuConteudo && !forcar) {
      const proxima = marcarLimite('limite de uso (porteiro)', 'limite de uso');
      if (proxima) {
        aviso(`conta "${contaAtual.rotulo}" no limite; seguindo na conta "${proxima.rotulo}" neste mesmo turno`);
        const antigo = child; child = null;
        try { antigo.kill('SIGTERM'); } catch (_) { /* já saiu */ }
        fila = []; rejeitado = false; resets = null;
        contaAtual = proxima; envAtual = { ...process.env, ...ENV_FILHO, ...contas.ambiente(proxima) };
        lancar();
        return;
      }
      aviso(`conta "${contaAtual.rotulo}" no limite; nenhuma outra conta livre`);
    }
    if (!viuConteudo && (ev.type === 'assistant' || ev.type === 'user' || ev.type === 'stream_event')) liberar();
    if (viuConteudo) escrever(linha); else fila.push(linha);
    if (ev.type === 'result') {
      if (!viuConteudo) liberar();
      if (rejeitado || (forcar && ev.is_error !== false)) {
        rejeitado = true;
        if (temRegistro) {
          const proxima = forcar ? marcarLimite('limite forçado (teste)', 'limite forçado') : contas.escolher({ excluir: [...tentadas, contaAtual.id], permitirAviso: true });
          aviso(`conta "${contaAtual.rotulo}" no limite; ${proxima ? `a próxima chamada vai pela conta "${proxima.rotulo}"` : 'nenhuma outra conta livre'}`);
        }
        // Depois do result o OpenClaw manteria este processo vivo por 10 min, preso à conta esgotada: encerra.
        setTimeout(() => encerrar('SIGTERM'), 200);
      }
    }
  }

  function lancar() {
    tentadas.push(contaAtual === null ? 'padrao' : contaAtual.id);
    viuConteudo = false; fila = []; resto = '';
    const filho = spawn(REAL, ARGS, { env: envAtual, stdio: ['inherit', 'pipe', 'inherit'] });
    child = filho;
    filho.stdout.on('data', (d) => {
      if (filho !== child) return;
      resto += d.toString('utf8');
      let i;
      while ((i = resto.indexOf('\n')) >= 0) { const l = resto.slice(0, i).trim(); resto = resto.slice(i + 1); if (l !== '') olhar(l, filho); }
    });
    filho.on('error', (e) => { if (filho !== child) return; aviso(`não consegui iniciar ${REAL}: ${e.message}`); process.exit(127); });
    filho.on('close', (code, sig) => {
      if (filho !== child) return;
      if (resto.trim() !== '') olhar(resto.trim(), filho);
      if (filho !== child) return; // a última linha trocou de conta
      if (!viuConteudo) liberar();
      if (rejeitado) process.exit(1);
      process.exit(code === null ? (sig && !encerrando ? 1 : 0) : code);
    });
  }
  lancar();
  return null;
}

try {
  if (MODO === '--env') process.exitCode = modoEnv();
  else if (MODO === '--run' && REAL) modoRun();
  else { process.stderr.write('uso: claude-porteiro.js --env args… | --run REAL args…\n'); process.exitCode = 2; }
} catch (e) {
  // Nunca bloquear: em --env, sem exports = claude real com o login padrão; em --run, o shim nem chega aqui.
  if (MODO === '--env') { process.stdout.write(`${exportar(ENV_FILHO)}\n`); process.exitCode = 0; } else { aviso(`porteiro falhou (${e && e.message}); rode MEU_BOT_PORTEIRO=0 claude`); process.exitCode = 1; }
}
